/**
 * Distributed Event Emitter
 * Provides event-driven architecture with Redis Pub/Sub support for distributed environments
 * Handles inventory changes, cache invalidation, and system events
 */

import { EventEmitter } from 'events';
import { FastifyInstance } from 'fastify';
import { logger } from '../config/logger.js';
import { config } from '../config/index.js';

/**
 * Event types for the system
 */
export type SystemEventType = 
  // Inventory events
  | 'inventory.updated'
  | 'inventory.reserved'
  | 'inventory.released'
  | 'inventory.low_stock'
  | 'inventory.overbooked'
  
  // Cache events
  | 'cache.invalidated'
  | 'cache.warmed'
  | 'cache.miss'
  | 'cache.hit'
  | 'cache.evicted'
  
  // System events
  | 'system.notification'
  | 'system.health_check'
  | 'system.performance_alert'
  | 'system.error'
  
  // User events
  | 'user.connected'
  | 'user.disconnected'
  | 'user.room_joined'
  | 'user.room_left'
  
  // Booking events
  | 'booking.created'
  | 'booking.updated'
  | 'booking.cancelled';

/**
 * Base event data interface
 */
export interface BaseEventData {
  eventId: string;
  timestamp: number;
  tenantId?: string;
  userId?: string;
  source: string;
  metadata?: Record<string, any>;
}

/**
 * Inventory event data
 */
export interface InventoryEventData extends BaseEventData {
  resourceId: string;
  timeSlotId?: string;
  oldCapacity?: number;
  newCapacity?: number;
  changeAmount?: number;
  operation: 'RESERVE' | 'RELEASE' | 'UPDATE' | 'ALERT';
  reason?: string;
}

/**
 * Cache event data
 */
export interface CacheEventData extends BaseEventData {
  key?: string;
  pattern?: string;
  namespace?: string;
  hitRate?: number;
  size?: number;
  operation: 'SET' | 'GET' | 'DELETE' | 'INVALIDATE' | 'WARM' | 'EVICT';
}

/**
 * System event data
 */
export interface SystemEventData extends BaseEventData {
  level: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  details?: any;
  component?: string;
}

/**
 * User event data
 */
export interface UserEventData extends BaseEventData {
  connectionId?: string;
  roomId?: string;
  userRole?: string;
  action: string;
}

/**
 * Booking event data
 */
export interface BookingEventData extends BaseEventData {
  bookingId: string;
  resourceId: string;
  timeSlotId: string;
  customerId?: string;
  serviceId?: string;
  status: string;
  operation: 'CREATE' | 'UPDATE' | 'CANCEL' | 'CONFIRM';
}

/**
 * Event data union type
 */
export type EventData = 
  | InventoryEventData 
  | CacheEventData 
  | SystemEventData 
  | UserEventData 
  | BookingEventData;

/**
 * Event listener function type
 */
export type EventListener<T extends EventData = EventData> = (data: T) => void | Promise<void>;

/**
 * Event subscription options
 */
export interface EventSubscriptionOptions {
  tenantId?: string;
  userId?: string;
  pattern?: string;
  local?: boolean; // Only listen to local events, not distributed
  persistent?: boolean; // Keep subscription active across reconnections
}

/**
 * Event emission options
 */
export interface EventEmissionOptions {
  local?: boolean; // Only emit locally, not to distributed system
  broadcast?: boolean; // Broadcast via WebSocket to connected clients
  persistent?: boolean; // Store event for replay/history
  delay?: number; // Delay emission in milliseconds
}

/**
 * Event statistics
 */
export interface EventStats {
  totalEvents: number;
  eventsByType: { [type: string]: number };
  localEvents: number;
  distributedEvents: number;
  subscriberCount: number;
  averageProcessingTime: number;
  errors: number;
  lastEventTime?: Date;
}

/**
 * Distributed Event Emitter class
 */
export class DistributedEventEmitter extends EventEmitter {
  private fastify?: FastifyInstance;
  private subscriptions = new Map<string, Set<EventListener>>();
  private eventHistory: Array<{ type: SystemEventType; data: EventData; timestamp: Date }> = [];
  private stats: EventStats = {
    totalEvents: 0,
    eventsByType: {},
    localEvents: 0,
    distributedEvents: 0,
    subscriberCount: 0,
    averageProcessingTime: 0,
    errors: 0
  };
  private processingTimes: number[] = [];
  private isRedisConnected = false;
  private redisSubscriber?: any;

  constructor(fastify?: FastifyInstance) {
    super();
    this.fastify = fastify;
    this.setMaxListeners(1000); // Allow many listeners
    
    if (fastify) {
      this.initializeRedisSubscriber();
    }
  }

  /**
   * Initialize Redis subscriber for distributed events
   */
  private async initializeRedisSubscriber(): Promise<void> {
    try {
      if (!this.fastify?.redis?.subscriber) {
        logger.warn('Redis subscriber not available, falling back to local events only');
        return;
      }

      this.redisSubscriber = this.fastify.redis.subscriber;
      this.isRedisConnected = true;

      // Subscribe to all system events
      await this.redisSubscriber.psubscribe('events:*');
      
      this.redisSubscriber.on('pmessage', async (pattern: string, channel: string, message: string) => {
        try {
          const eventType = channel.split(':')[1] as SystemEventType;
          const eventData = JSON.parse(message) as EventData;
          
          // Emit locally (but mark as distributed to avoid re-publishing)
          await this.emitLocal(eventType, eventData, { fromDistributed: true });
          this.stats.distributedEvents++;
          
        } catch (error) {
          logger.error('Error processing distributed event:', { channel, error });
          this.stats.errors++;
        }
      });

      this.redisSubscriber.on('error', (error: Error) => {
        logger.error('Redis subscriber error:', error);
        this.isRedisConnected = false;
        this.stats.errors++;
      });

      this.redisSubscriber.on('ready', () => {
        logger.info('Redis subscriber ready for distributed events');
        this.isRedisConnected = true;
      });

      logger.info('Distributed event emitter initialized with Redis');
      
    } catch (error) {
      logger.error('Failed to initialize Redis subscriber:', error);
      this.isRedisConnected = false;
    }
  }

  /**
   * Subscribe to events
   */
  subscribe<T extends EventData>(
    eventType: SystemEventType,
    listener: EventListener<T>,
    options: EventSubscriptionOptions = {}
  ): () => void {
    const wrappedListener = this.wrapListener(listener, options);
    
    // Add to internal subscriptions
    if (!this.subscriptions.has(eventType)) {
      this.subscriptions.set(eventType, new Set());
    }
    this.subscriptions.get(eventType)!.add(wrappedListener);
    
    // Add to EventEmitter
    this.on(eventType, wrappedListener);
    
    this.stats.subscriberCount++;
    logger.debug(`Subscribed to event: ${eventType}`, options);
    
    // Return unsubscribe function
    return () => {
      this.subscriptions.get(eventType)?.delete(wrappedListener);
      this.off(eventType, wrappedListener);
      this.stats.subscriberCount = Math.max(0, this.stats.subscriberCount - 1);
      logger.debug(`Unsubscribed from event: ${eventType}`);
    };
  }

  /**
   * Emit event (both locally and distributed if enabled)
   */
  async emit(
    eventType: SystemEventType,
    data: Partial<EventData>,
    options: EventEmissionOptions = {}
  ): Promise<boolean> {
    const fullEventData = this.enrichEventData(data);
    const startTime = Date.now();

    try {
      // Emit locally first
      const localResult = await this.emitLocal(eventType, fullEventData, options);

      // Emit to distributed system if not local-only and not already from distributed
      if (!options.local && this.isRedisConnected && !options.fromDistributed) {
        await this.emitDistributed(eventType, fullEventData);
      }

      // Broadcast via WebSocket if requested
      if (options.broadcast && this.fastify?.websocket) {
        this.broadcastToWebSocket(eventType, fullEventData);
      }

      // Store in history if persistent
      if (options.persistent) {
        this.addToHistory(eventType, fullEventData);
      }

      // Update stats
      this.updateStats(eventType, Date.now() - startTime);
      
      return localResult;

    } catch (error) {
      logger.error('Error emitting event:', { eventType, error });
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Emit event locally only
   */
  private async emitLocal(
    eventType: SystemEventType,
    data: EventData,
    options: any = {}
  ): Promise<boolean> {
    try {
      const result = super.emit(eventType, data);
      this.stats.localEvents++;
      return result;
    } catch (error) {
      logger.error('Error emitting local event:', { eventType, error });
      this.stats.errors++;
      return false;
    }
  }

  /**
   * Emit event to distributed system via Redis
   */
  private async emitDistributed(eventType: SystemEventType, data: EventData): Promise<void> {
    try {
      if (!this.fastify?.redis?.publisher) {
        throw new Error('Redis publisher not available');
      }

      const channel = `events:${eventType}`;
      const message = JSON.stringify(data);
      
      await this.fastify.redis.publisher.publish(channel, message);
      logger.debug(`Published distributed event: ${eventType}`);
      
    } catch (error) {
      logger.error('Error publishing distributed event:', { eventType, error });
      throw error;
    }
  }

  /**
   * Broadcast event to WebSocket clients
   */
  private broadcastToWebSocket(eventType: SystemEventType, data: EventData): void {
    try {
      if (!this.fastify?.websocket) return;

      const message = {
        type: eventType,
        data,
        timestamp: Date.now()
      };

      // Broadcast to tenant room if tenantId is present
      if (data.tenantId) {
        const roomId = `tenant:${data.tenantId}`;
        this.fastify.websocket.broadcast(roomId, message);
      }

      // Broadcast to specific user if userId is present
      if (data.userId) {
        this.fastify.websocket.broadcastToUser(data.userId, message);
      }

      // Broadcast to global system room for system events
      if (eventType.startsWith('system.')) {
        this.fastify.websocket.broadcast('system', message);
      }

    } catch (error) {
      logger.error('Error broadcasting to WebSocket:', { eventType, error });
    }
  }

  /**
   * Wrap listener with filtering and error handling
   */
  private wrapListener<T extends EventData>(
    listener: EventListener<T>,
    options: EventSubscriptionOptions
  ): EventListener<T> {
    return async (data: T) => {
      try {
        // Apply tenant filtering
        if (options.tenantId && data.tenantId !== options.tenantId) {
          return;
        }

        // Apply user filtering
        if (options.userId && data.userId !== options.userId) {
          return;
        }

        // Apply pattern filtering
        if (options.pattern && !this.matchesPattern(data, options.pattern)) {
          return;
        }

        await listener(data);
        
      } catch (error) {
        logger.error('Error in event listener:', { error, data });
        this.stats.errors++;
      }
    };
  }

  /**
   * Enrich event data with default values
   */
  private enrichEventData(data: Partial<EventData>): EventData {
    return {
      eventId: data.eventId || this.generateEventId(),
      timestamp: data.timestamp || Date.now(),
      source: data.source || 'system',
      metadata: data.metadata || {},
      ...data
    } as EventData;
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Check if event data matches pattern
   */
  private matchesPattern(data: EventData, pattern: string): boolean {
    try {
      // Simple pattern matching - can be enhanced with more sophisticated matching
      const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
      const searchString = JSON.stringify(data).toLowerCase();
      return regex.test(searchString);
    } catch {
      return false;
    }
  }

  /**
   * Add event to history
   */
  private addToHistory(eventType: SystemEventType, data: EventData): void {
    this.eventHistory.push({
      type: eventType,
      data,
      timestamp: new Date()
    });

    // Keep only last 1000 events
    if (this.eventHistory.length > 1000) {
      this.eventHistory = this.eventHistory.slice(-1000);
    }
  }

  /**
   * Update statistics
   */
  private updateStats(eventType: SystemEventType, processingTime: number): void {
    this.stats.totalEvents++;
    this.stats.eventsByType[eventType] = (this.stats.eventsByType[eventType] || 0) + 1;
    this.stats.lastEventTime = new Date();

    // Update processing time stats
    this.processingTimes.push(processingTime);
    if (this.processingTimes.length > 1000) {
      this.processingTimes = this.processingTimes.slice(-1000);
    }
    this.stats.averageProcessingTime = this.processingTimes.reduce((sum, time) => sum + time, 0) / this.processingTimes.length;
  }

  /**
   * Get event statistics
   */
  getStats(): EventStats {
    return { ...this.stats };
  }

  /**
   * Get event history
   */
  getHistory(limit = 100): Array<{ type: SystemEventType; data: EventData; timestamp: Date }> {
    return this.eventHistory.slice(-limit);
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const testEventType: SystemEventType = 'system.health_check';
      const testData: SystemEventData = {
        eventId: this.generateEventId(),
        timestamp: Date.now(),
        source: 'health_check',
        level: 'info',
        message: 'Health check event'
      };

      let received = false;
      const timeout = setTimeout(() => {
        received = false;
      }, 5000); // 5 second timeout

      // Subscribe to test event
      const unsubscribe = this.subscribe(testEventType, () => {
        received = true;
        clearTimeout(timeout);
      });

      // Emit test event
      await this.emit(testEventType, testData, { local: true });

      // Wait for response
      await new Promise(resolve => {
        const interval = setInterval(() => {
          if (received || !timeout) {
            clearInterval(interval);
            resolve(received);
          }
        }, 100);
      });

      unsubscribe();
      return received;

    } catch (error) {
      logger.error('Event emitter health check failed:', error);
      return false;
    }
  }

  /**
   * Shutdown and cleanup
   */
  async shutdown(): Promise<void> {
    try {
      if (this.redisSubscriber) {
        await this.redisSubscriber.punsubscribe('events:*');
        logger.info('Unsubscribed from distributed events');
      }

      this.removeAllListeners();
      this.subscriptions.clear();
      this.eventHistory = [];
      
      logger.info('Distributed event emitter shut down');
      
    } catch (error) {
      logger.error('Error shutting down event emitter:', error);
    }
  }
}

/**
 * Global event emitter instance
 */
let globalEventEmitter: DistributedEventEmitter;

/**
 * Initialize global event emitter
 */
export function initializeEventEmitter(fastify?: FastifyInstance): DistributedEventEmitter {
  if (!globalEventEmitter) {
    globalEventEmitter = new DistributedEventEmitter(fastify);
  }
  return globalEventEmitter;
}

/**
 * Get global event emitter instance
 */
export function getEventEmitter(): DistributedEventEmitter {
  if (!globalEventEmitter) {
    globalEventEmitter = new DistributedEventEmitter();
  }
  return globalEventEmitter;
}

/**
 * Event emitter helper functions
 */
export const EventEmitters = {
  // Inventory events
  inventoryUpdated: (data: Partial<InventoryEventData>, options?: EventEmissionOptions) => 
    getEventEmitter().emit('inventory.updated', data, options),
  
  inventoryReserved: (data: Partial<InventoryEventData>, options?: EventEmissionOptions) =>
    getEventEmitter().emit('inventory.reserved', data, options),
  
  inventoryReleased: (data: Partial<InventoryEventData>, options?: EventEmissionOptions) =>
    getEventEmitter().emit('inventory.released', data, options),

  // Cache events
  cacheInvalidated: (data: Partial<CacheEventData>, options?: EventEmissionOptions) =>
    getEventEmitter().emit('cache.invalidated', data, options),
  
  cacheWarmed: (data: Partial<CacheEventData>, options?: EventEmissionOptions) =>
    getEventEmitter().emit('cache.warmed', data, options),

  // System events
  systemNotification: (data: Partial<SystemEventData>, options?: EventEmissionOptions) =>
    getEventEmitter().emit('system.notification', data, options),
  
  systemError: (data: Partial<SystemEventData>, options?: EventEmissionOptions) =>
    getEventEmitter().emit('system.error', data, options),

  // User events
  userConnected: (data: Partial<UserEventData>, options?: EventEmissionOptions) =>
    getEventEmitter().emit('user.connected', data, options),
  
  userDisconnected: (data: Partial<UserEventData>, options?: EventEmissionOptions) =>
    getEventEmitter().emit('user.disconnected', data, options),
};

export default DistributedEventEmitter;