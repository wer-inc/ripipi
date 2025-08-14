/**
 * WebSocket Fastify Plugin
 * Provides authenticated WebSocket support with tenant-based room functionality,
 * heartbeat management, and automatic reconnection handling
 */

import { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import fastifyWebSocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { logger } from '../config/logger.js';
import { config } from '../config/index.js';
import { InternalServerError, UnauthorizedError } from '../utils/errors.js';

declare module 'fastify' {
  interface FastifyInstance {
    websocket: {
      server: import('@fastify/websocket').WebSocketServer;
      // Connection management
      connections: Map<string, WebSocketConnection>;
      rooms: Map<string, Set<string>>;
      userConnections: Map<string, Set<string>>;
      
      // Utility methods
      broadcast: (roomId: string, message: any, excludeConnectionId?: string) => void;
      broadcastToUser: (userId: string, message: any) => void;
      joinRoom: (connectionId: string, roomId: string) => void;
      leaveRoom: (connectionId: string, roomId: string) => void;
      leaveAllRooms: (connectionId: string) => void;
      closeConnection: (connectionId: string, code?: number, reason?: string) => void;
      
      // Stats and monitoring
      getConnectionCount: () => number;
      getRoomStats: () => { [roomId: string]: number };
      getUserConnectionCount: (userId: string) => number;
      
      // Health and performance
      ping: (connectionId?: string) => void;
      getConnectionInfo: (connectionId: string) => WebSocketConnectionInfo | undefined;
    };
  }
}

/**
 * WebSocket connection information
 */
export interface WebSocketConnection {
  id: string;
  socket: WebSocket;
  userId?: string;
  tenantId?: string;
  userRole?: string;
  rooms: Set<string>;
  isAuthenticated: boolean;
  connectedAt: Date;
  lastActivity: Date;
  heartbeatInterval?: NodeJS.Timeout;
  reconnectCount: number;
  metadata: Record<string, any>;
}

export interface WebSocketConnectionInfo {
  id: string;
  userId?: string;
  tenantId?: string;
  userRole?: string;
  rooms: string[];
  isAuthenticated: boolean;
  connectedAt: Date;
  lastActivity: Date;
  reconnectCount: number;
  uptime: number;
}

/**
 * WebSocket message types
 */
export type WebSocketMessageType = 
  | 'auth'
  | 'join_room'
  | 'leave_room'
  | 'heartbeat'
  | 'inventory_update'
  | 'cache_invalidation'
  | 'system_notification'
  | 'error'
  | 'success';

export interface WebSocketMessage {
  type: WebSocketMessageType;
  data?: any;
  timestamp?: number;
  requestId?: string;
}

export interface AuthMessage {
  token: string;
  tenantId?: string;
}

export interface RoomMessage {
  roomId: string;
}

/**
 * WebSocket configuration
 */
export interface WebSocketConfig {
  heartbeatInterval: number;
  connectionTimeout: number;
  maxConnections: number;
  maxReconnectAttempts: number;
  roomPrefix: string;
  cleanupInterval: number;
}

// Default configuration
const defaultConfig: WebSocketConfig = {
  heartbeatInterval: parseInt(process.env.WS_HEARTBEAT_INTERVAL || '30000', 10), // 30 seconds
  connectionTimeout: parseInt(process.env.WS_CONNECTION_TIMEOUT || '300000', 10), // 5 minutes
  maxConnections: parseInt(process.env.WS_MAX_CONNECTIONS || '10000', 10),
  maxReconnectAttempts: parseInt(process.env.WS_MAX_RECONNECT_ATTEMPTS || '5', 10),
  roomPrefix: process.env.WS_ROOM_PREFIX || 'room:',
  cleanupInterval: parseInt(process.env.WS_CLEANUP_INTERVAL || '60000', 10), // 1 minute
};

/**
 * Generate unique connection ID
 */
function generateConnectionId(): string {
  return `conn_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

/**
 * Validate JWT token and extract user information
 */
async function validateToken(token: string): Promise<{ userId: string; tenantId?: string; userRole?: string }> {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as any;
    
    return {
      userId: decoded.userId || decoded.sub,
      tenantId: decoded.tenantId,
      userRole: decoded.role
    };
  } catch (error) {
    throw new UnauthorizedError('Invalid authentication token');
  }
}

/**
 * WebSocket connection manager
 */
class WebSocketManager {
  private connections = new Map<string, WebSocketConnection>();
  private rooms = new Map<string, Set<string>>();
  private userConnections = new Map<string, Set<string>>();
  private cleanupInterval?: NodeJS.Timeout;
  
  constructor(private config: WebSocketConfig) {
    this.startCleanup();
  }

  /**
   * Add new connection
   */
  addConnection(socket: WebSocket): string {
    const connectionId = generateConnectionId();
    const connection: WebSocketConnection = {
      id: connectionId,
      socket,
      rooms: new Set(),
      isAuthenticated: false,
      connectedAt: new Date(),
      lastActivity: new Date(),
      reconnectCount: 0,
      metadata: {}
    };

    this.connections.set(connectionId, connection);
    this.startHeartbeat(connectionId);
    
    logger.debug(`WebSocket connection added: ${connectionId}`);
    return connectionId;
  }

  /**
   * Remove connection
   */
  removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    // Clean up heartbeat
    if (connection.heartbeatInterval) {
      clearInterval(connection.heartbeatInterval);
    }

    // Leave all rooms
    this.leaveAllRooms(connectionId);

    // Remove from user connections
    if (connection.userId) {
      const userConns = this.userConnections.get(connection.userId);
      if (userConns) {
        userConns.delete(connectionId);
        if (userConns.size === 0) {
          this.userConnections.delete(connection.userId);
        }
      }
    }

    this.connections.delete(connectionId);
    logger.debug(`WebSocket connection removed: ${connectionId}`);
  }

  /**
   * Authenticate connection
   */
  async authenticateConnection(connectionId: string, token: string, tenantId?: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      throw new Error('Connection not found');
    }

    try {
      const userInfo = await validateToken(token);
      
      // Validate tenant access if specified
      if (tenantId && userInfo.tenantId && userInfo.tenantId !== tenantId) {
        throw new UnauthorizedError('Insufficient tenant access');
      }

      // Update connection info
      connection.userId = userInfo.userId;
      connection.tenantId = tenantId || userInfo.tenantId;
      connection.userRole = userInfo.userRole;
      connection.isAuthenticated = true;
      connection.lastActivity = new Date();

      // Track user connections
      if (!this.userConnections.has(connection.userId)) {
        this.userConnections.set(connection.userId, new Set());
      }
      this.userConnections.get(connection.userId)!.add(connectionId);

      logger.debug(`WebSocket connection authenticated: ${connectionId} for user ${connection.userId}`);
    } catch (error) {
      logger.error('WebSocket authentication failed:', { connectionId, error });
      throw error;
    }
  }

  /**
   * Join room
   */
  joinRoom(connectionId: string, roomId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.isAuthenticated) {
      throw new Error('Connection not found or not authenticated');
    }

    // Add connection to room
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
    }
    this.rooms.get(roomId)!.add(connectionId);
    connection.rooms.add(roomId);

    connection.lastActivity = new Date();
    logger.debug(`Connection ${connectionId} joined room ${roomId}`);
  }

  /**
   * Leave room
   */
  leaveRoom(connectionId: string, roomId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.rooms.delete(roomId);
    }

    const room = this.rooms.get(roomId);
    if (room) {
      room.delete(connectionId);
      if (room.size === 0) {
        this.rooms.delete(roomId);
      }
    }

    logger.debug(`Connection ${connectionId} left room ${roomId}`);
  }

  /**
   * Leave all rooms
   */
  leaveAllRooms(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    for (const roomId of connection.rooms) {
      this.leaveRoom(connectionId, roomId);
    }
  }

  /**
   * Broadcast to room
   */
  broadcast(roomId: string, message: any, excludeConnectionId?: string): void {
    const room = this.rooms.get(roomId);
    if (!room || room.size === 0) {
      return;
    }

    const serializedMessage = JSON.stringify({
      ...message,
      timestamp: Date.now()
    });

    let sent = 0;
    let failed = 0;

    for (const connectionId of room) {
      if (connectionId === excludeConnectionId) continue;

      const connection = this.connections.get(connectionId);
      if (connection && connection.socket.readyState === WebSocket.OPEN) {
        try {
          connection.socket.send(serializedMessage);
          connection.lastActivity = new Date();
          sent++;
        } catch (error) {
          logger.error(`Failed to send message to connection ${connectionId}:`, error);
          failed++;
        }
      } else {
        failed++;
      }
    }

    logger.debug(`Broadcast to room ${roomId}: sent=${sent}, failed=${failed}`);
  }

  /**
   * Broadcast to user (all connections)
   */
  broadcastToUser(userId: string, message: any): void {
    const userConns = this.userConnections.get(userId);
    if (!userConns || userConns.size === 0) {
      return;
    }

    const serializedMessage = JSON.stringify({
      ...message,
      timestamp: Date.now()
    });

    let sent = 0;
    let failed = 0;

    for (const connectionId of userConns) {
      const connection = this.connections.get(connectionId);
      if (connection && connection.socket.readyState === WebSocket.OPEN) {
        try {
          connection.socket.send(serializedMessage);
          connection.lastActivity = new Date();
          sent++;
        } catch (error) {
          logger.error(`Failed to send message to user connection ${connectionId}:`, error);
          failed++;
        }
      } else {
        failed++;
      }
    }

    logger.debug(`Broadcast to user ${userId}: sent=${sent}, failed=${failed}`);
  }

  /**
   * Send message to specific connection
   */
  sendToConnection(connectionId: string, message: any): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      connection.socket.send(JSON.stringify({
        ...message,
        timestamp: Date.now()
      }));
      connection.lastActivity = new Date();
      return true;
    } catch (error) {
      logger.error(`Failed to send message to connection ${connectionId}:`, error);
      return false;
    }
  }

  /**
   * Close connection
   */
  closeConnection(connectionId: string, code = 1000, reason = 'Normal closure'): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      try {
        connection.socket.close(code, reason);
      } catch (error) {
        logger.error(`Error closing connection ${connectionId}:`, error);
      }
    }
  }

  /**
   * Ping connection
   */
  ping(connectionId?: string): void {
    const connections = connectionId 
      ? [this.connections.get(connectionId)].filter(Boolean)
      : Array.from(this.connections.values());

    for (const connection of connections) {
      if (connection && connection.socket.readyState === WebSocket.OPEN) {
        try {
          connection.socket.ping();
        } catch (error) {
          logger.error(`Failed to ping connection ${connection.id}:`, error);
        }
      }
    }
  }

  /**
   * Get connection stats
   */
  getStats(): { 
    totalConnections: number;
    authenticatedConnections: number;
    totalRooms: number;
    roomStats: { [roomId: string]: number };
    userStats: { totalUsers: number; avgConnectionsPerUser: number };
  } {
    const totalConnections = this.connections.size;
    const authenticatedConnections = Array.from(this.connections.values())
      .filter(conn => conn.isAuthenticated).length;
    
    const roomStats: { [roomId: string]: number } = {};
    for (const [roomId, connections] of this.rooms) {
      roomStats[roomId] = connections.size;
    }

    const totalUsers = this.userConnections.size;
    const avgConnectionsPerUser = totalUsers > 0 
      ? Array.from(this.userConnections.values())
          .reduce((sum, conns) => sum + conns.size, 0) / totalUsers
      : 0;

    return {
      totalConnections,
      authenticatedConnections,
      totalRooms: this.rooms.size,
      roomStats,
      userStats: {
        totalUsers,
        avgConnectionsPerUser
      }
    };
  }

  /**
   * Get connection info
   */
  getConnectionInfo(connectionId: string): WebSocketConnectionInfo | undefined {
    const connection = this.connections.get(connectionId);
    if (!connection) return undefined;

    return {
      id: connection.id,
      userId: connection.userId,
      tenantId: connection.tenantId,
      userRole: connection.userRole,
      rooms: Array.from(connection.rooms),
      isAuthenticated: connection.isAuthenticated,
      connectedAt: connection.connectedAt,
      lastActivity: connection.lastActivity,
      reconnectCount: connection.reconnectCount,
      uptime: Date.now() - connection.connectedAt.getTime()
    };
  }

  /**
   * Start heartbeat for connection
   */
  private startHeartbeat(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    connection.heartbeatInterval = setInterval(() => {
      if (connection.socket.readyState === WebSocket.OPEN) {
        try {
          connection.socket.ping();
        } catch (error) {
          logger.error(`Heartbeat failed for connection ${connectionId}:`, error);
          this.removeConnection(connectionId);
        }
      } else {
        this.removeConnection(connectionId);
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Start cleanup process
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const connectionsToRemove: string[] = [];

      for (const [connectionId, connection] of this.connections) {
        // Remove dead connections
        if (connection.socket.readyState === WebSocket.CLOSED || 
            connection.socket.readyState === WebSocket.CLOSING) {
          connectionsToRemove.push(connectionId);
          continue;
        }

        // Remove inactive connections
        const inactiveTime = now - connection.lastActivity.getTime();
        if (inactiveTime > this.config.connectionTimeout) {
          connectionsToRemove.push(connectionId);
          logger.info(`Removing inactive connection: ${connectionId}`);
        }
      }

      for (const connectionId of connectionsToRemove) {
        this.removeConnection(connectionId);
      }

      // Clean up empty rooms
      for (const [roomId, connections] of this.rooms) {
        if (connections.size === 0) {
          this.rooms.delete(roomId);
        }
      }

    }, this.config.cleanupInterval);
  }

  /**
   * Shutdown cleanup
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Close all connections
    for (const connection of this.connections.values()) {
      if (connection.heartbeatInterval) {
        clearInterval(connection.heartbeatInterval);
      }
      try {
        connection.socket.close(1001, 'Server shutdown');
      } catch (error) {
        logger.error('Error closing connection during shutdown:', error);
      }
    }

    this.connections.clear();
    this.rooms.clear();
    this.userConnections.clear();
  }
}

/**
 * WebSocket Fastify plugin
 */
const websocketPlugin: FastifyPluginAsync = async (fastify) => {
  const wsConfig = { ...defaultConfig };
  const manager = new WebSocketManager(wsConfig);

  // Register WebSocket support
  await fastify.register(fastifyWebSocket, {
    options: {
      maxPayload: 1024 * 1024, // 1MB max payload
      perMessageDeflate: true,
    }
  });

  // WebSocket route handler
  fastify.register(async function (fastify) {
    fastify.get('/ws', { websocket: true }, async (socket, request) => {
      const connectionId = manager.addConnection(socket);

      // Handle messages
      socket.on('message', async (rawData) => {
        try {
          const message: WebSocketMessage = JSON.parse(rawData.toString());
          
          await handleWebSocketMessage(connectionId, message, manager);
          
        } catch (error) {
          logger.error(`WebSocket message handling error for ${connectionId}:`, error);
          
          manager.sendToConnection(connectionId, {
            type: 'error',
            data: { 
              message: 'Invalid message format',
              details: error.message 
            }
          });
        }
      });

      // Handle connection close
      socket.on('close', (code, reason) => {
        logger.debug(`WebSocket connection closed: ${connectionId}, code=${code}, reason=${reason}`);
        manager.removeConnection(connectionId);
      });

      // Handle errors
      socket.on('error', (error) => {
        logger.error(`WebSocket error for ${connectionId}:`, error);
        manager.removeConnection(connectionId);
      });

      // Handle pong responses
      socket.on('pong', () => {
        const connection = manager['connections'].get(connectionId);
        if (connection) {
          connection.lastActivity = new Date();
        }
      });

      // Send initial connection confirmation
      manager.sendToConnection(connectionId, {
        type: 'success',
        data: { 
          message: 'WebSocket connection established',
          connectionId,
          serverTime: Date.now()
        }
      });
    });
  });

  // Decorate fastify instance
  fastify.decorate('websocket', {
    server: fastify.websocketServer,
    connections: manager['connections'],
    rooms: manager['rooms'],
    userConnections: manager['userConnections'],
    
    broadcast: (roomId: string, message: any, excludeConnectionId?: string) => 
      manager.broadcast(roomId, message, excludeConnectionId),
    broadcastToUser: (userId: string, message: any) => 
      manager.broadcastToUser(userId, message),
    joinRoom: (connectionId: string, roomId: string) => 
      manager.joinRoom(connectionId, roomId),
    leaveRoom: (connectionId: string, roomId: string) => 
      manager.leaveRoom(connectionId, roomId),
    leaveAllRooms: (connectionId: string) => 
      manager.leaveAllRooms(connectionId),
    closeConnection: (connectionId: string, code?: number, reason?: string) => 
      manager.closeConnection(connectionId, code, reason),
    
    getConnectionCount: () => manager['connections'].size,
    getRoomStats: () => manager.getStats().roomStats,
    getUserConnectionCount: (userId: string) => 
      manager['userConnections'].get(userId)?.size || 0,
    
    ping: (connectionId?: string) => manager.ping(connectionId),
    getConnectionInfo: (connectionId: string) => 
      manager.getConnectionInfo(connectionId)
  });

  // Graceful shutdown
  fastify.addHook('onClose', async () => {
    logger.info('Shutting down WebSocket manager...');
    manager.shutdown();
  });

  logger.info('WebSocket plugin initialized successfully');
};

/**
 * Handle WebSocket messages
 */
async function handleWebSocketMessage(
  connectionId: string, 
  message: WebSocketMessage, 
  manager: WebSocketManager
): Promise<void> {
  const { type, data, requestId } = message;

  const sendResponse = (response: any) => {
    manager.sendToConnection(connectionId, {
      ...response,
      requestId
    });
  };

  switch (type) {
    case 'auth':
      try {
        const authData = data as AuthMessage;
        await manager.authenticateConnection(connectionId, authData.token, authData.tenantId);
        
        sendResponse({
          type: 'success',
          data: { message: 'Authentication successful' }
        });
      } catch (error) {
        sendResponse({
          type: 'error',
          data: { 
            message: 'Authentication failed',
            details: error.message 
          }
        });
      }
      break;

    case 'join_room':
      try {
        const roomData = data as RoomMessage;
        manager.joinRoom(connectionId, roomData.roomId);
        
        sendResponse({
          type: 'success',
          data: { message: `Joined room: ${roomData.roomId}` }
        });
      } catch (error) {
        sendResponse({
          type: 'error',
          data: { 
            message: 'Failed to join room',
            details: error.message 
          }
        });
      }
      break;

    case 'leave_room':
      try {
        const roomData = data as RoomMessage;
        manager.leaveRoom(connectionId, roomData.roomId);
        
        sendResponse({
          type: 'success',
          data: { message: `Left room: ${roomData.roomId}` }
        });
      } catch (error) {
        sendResponse({
          type: 'error',
          data: { 
            message: 'Failed to leave room',
            details: error.message 
          }
        });
      }
      break;

    case 'heartbeat':
      sendResponse({
        type: 'heartbeat',
        data: { timestamp: Date.now() }
      });
      break;

    default:
      sendResponse({
        type: 'error',
        data: { message: `Unknown message type: ${type}` }
      });
  }
}

export default fastifyPlugin(websocketPlugin, {
  name: 'websocket',
  fastify: '4.x',
});

export { WebSocketManager, generateConnectionId, validateToken };