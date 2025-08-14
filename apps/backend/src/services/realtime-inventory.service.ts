/**
 * Real-time Inventory Service
 * Provides WebSocket/SSE-based real-time inventory updates with differential updates,
 * subscription management, and automatic failover capabilities
 */

import { FastifyInstance } from 'fastify';
import { InventoryService } from './inventory.service.js';
import { CacheService } from './cache.service.js';
import { DistributedEventEmitter, getEventEmitter, EventEmitters } from '../utils/event-emitter.js';
import { InventoryStatus, TimeSlot } from '../types/availability.js';
import { logger } from '../config/logger.js';
import { InternalServerError, BadRequestError } from '../utils/errors.js';

/**
 * Real-time subscription configuration
 */
export interface RealtimeSubscription {
  id: string;
  connectionId: string;
  tenantId: string;
  userId?: string;
  resourceIds: string[];
  startDate: Date;
  endDate: Date;
  includeDetails: boolean;
  filters?: {
    minCapacity?: number;
    maxUtilization?: number;
    onlyAvailable?: boolean;
  };
  createdAt: Date;
  lastUpdate: Date;
  updateCount: number;
}

/**
 * Differential update data
 */
export interface InventoryDiff {
  resourceId: string;
  changes: {
    totalCapacity?: { old: number; new: number };
    availableCapacity?: { old: number; new: number };
    bookedCapacity?: { old: number; new: number };
    utilization?: { old: number; new: number };
    timeSlots?: {
      added: TimeSlot[];
      updated: TimeSlot[];
      removed: string[]; // slot IDs
    };
  };
  changeReason: string;
  timestamp: Date;
}

/**
 * Real-time update message
 */
export interface RealtimeUpdateMessage {
  type: 'full_update' | 'differential_update' | 'heartbeat' | 'error';
  subscriptionId: string;
  timestamp: number;
  data?: {
    inventoryStatus?: InventoryStatus[];
    diffs?: InventoryDiff[];
    stats?: {
      totalResources: number;
      updatedResources: number;
      changesSince: Date;
    };
  };
  error?: string;
}

/**
 * Performance metrics
 */
export interface RealtimeMetrics {
  activeSubscriptions: number;
  totalUpdates: number;
  averageUpdateLatency: number;
  differentialUpdates: number;
  fullUpdates: number;
  errorsCount: number;
  bandwidthSaved: number; // bytes saved through differential updates
  peakConcurrentSubscriptions: number;
  lastUpdateTime?: Date;
}

/**
 * Real-time Inventory Service
 */
export class RealtimeInventoryService {
  private subscriptions = new Map<string, RealtimeSubscription>();
  private lastKnownState = new Map<string, Map<string, InventoryStatus>>(); // tenantId -> resourceId -> status
  private inventoryService: InventoryService;
  private cache: CacheService;
  private eventEmitter: DistributedEventEmitter;
  private updateInterval?: NodeJS.Timeout;
  private heartbeatInterval?: NodeJS.Timeout;
  private metrics: RealtimeMetrics = {
    activeSubscriptions: 0,
    totalUpdates: 0,
    averageUpdateLatency: 0,
    differentialUpdates: 0,
    fullUpdates: 0,
    errorsCount: 0,
    bandwidthSaved: 0,
    peakConcurrentSubscriptions: 0
  };
  private latencyHistory: number[] = [];

  constructor(private fastify: FastifyInstance) {
    this.inventoryService = new InventoryService(fastify);
    this.cache = new CacheService(fastify, {
      defaultTTL: 30, // 30 seconds for real-time data
      memory: {
        enabled: true,
        maxSize: 64 * 1024 * 1024, // 64MB
        maxItems: 5000,
        ttlRatio: 0.8 // Keep in memory for 80% of Redis TTL
      }
    });
    this.eventEmitter = getEventEmitter();
    
    this.initializeEventHandlers();
    this.startBackgroundTasks();
  }

  /**
   * Subscribe to real-time inventory updates
   */
  async subscribe(
    connectionId: string,
    tenantId: string,
    resourceIds: string[],
    options: {
      userId?: string;
      startDate: Date;
      endDate: Date;
      includeDetails?: boolean;
      filters?: RealtimeSubscription['filters'];
    }
  ): Promise<string> {
    const startTime = Date.now();

    try {
      // Validate inputs
      if (!connectionId || !tenantId || !resourceIds.length) {
        throw new BadRequestError('Missing required subscription parameters');
      }

      if (resourceIds.length > 50) {
        throw new BadRequestError('Too many resources in subscription (max 50)');
      }

      const subscriptionId = this.generateSubscriptionId();
      const subscription: RealtimeSubscription = {
        id: subscriptionId,
        connectionId,
        tenantId,
        userId: options.userId,
        resourceIds: [...resourceIds],
        startDate: options.startDate,
        endDate: options.endDate,
        includeDetails: options.includeDetails || false,
        filters: options.filters,
        createdAt: new Date(),
        lastUpdate: new Date(),
        updateCount: 0
      };

      this.subscriptions.set(subscriptionId, subscription);
      this.metrics.activeSubscriptions = this.subscriptions.size;
      this.metrics.peakConcurrentSubscriptions = Math.max(
        this.metrics.peakConcurrentSubscriptions,
        this.metrics.activeSubscriptions
      );

      // Join WebSocket room for this tenant
      if (this.fastify.websocket) {
        const roomId = `inventory:${tenantId}`;
        try {
          this.fastify.websocket.joinRoom(connectionId, roomId);
        } catch (error) {
          logger.warn(`Failed to join WebSocket room ${roomId}:`, error);
        }
      }

      // Send initial full update
      await this.sendFullUpdate(subscriptionId);

      // Record subscription event
      await EventEmitters.systemNotification({
        tenantId,
        userId: options.userId,
        source: 'realtime-inventory',
        level: 'info',
        message: `Real-time inventory subscription created: ${subscriptionId}`,
        metadata: { 
          resourceIds,
          subscriptionId,
          connectionId
        }
      }, { broadcast: false });

      const latency = Date.now() - startTime;
      this.recordLatency(latency);

      logger.info(`Created real-time inventory subscription: ${subscriptionId}`, {
        tenantId,
        userId: options.userId,
        resourceCount: resourceIds.length,
        latency
      });

      return subscriptionId;

    } catch (error) {
      this.metrics.errorsCount++;
      logger.error('Failed to create real-time inventory subscription:', error);
      throw error;
    }
  }

  /**
   * Unsubscribe from real-time inventory updates
   */
  async unsubscribe(subscriptionId: string): Promise<void> {
    try {
      const subscription = this.subscriptions.get(subscriptionId);
      if (!subscription) {
        return; // Already unsubscribed
      }

      // Leave WebSocket room
      if (this.fastify.websocket) {
        const roomId = `inventory:${subscription.tenantId}`;
        try {
          this.fastify.websocket.leaveRoom(subscription.connectionId, roomId);
        } catch (error) {
          logger.warn(`Failed to leave WebSocket room ${roomId}:`, error);
        }
      }

      this.subscriptions.delete(subscriptionId);
      this.metrics.activeSubscriptions = this.subscriptions.size;

      // Clean up state for this subscription if no other subscriptions exist for the tenant
      const hasOtherTenantSubscriptions = Array.from(this.subscriptions.values())
        .some(sub => sub.tenantId === subscription.tenantId);
      
      if (!hasOtherTenantSubscriptions) {
        this.lastKnownState.delete(subscription.tenantId);
      }

      logger.info(`Removed real-time inventory subscription: ${subscriptionId}`);

    } catch (error) {
      logger.error(`Failed to unsubscribe: ${subscriptionId}:`, error);
    }
  }

  /**
   * Unsubscribe all subscriptions for a connection
   */
  async unsubscribeByConnection(connectionId: string): Promise<void> {
    const subscriptionsToRemove = Array.from(this.subscriptions.entries())
      .filter(([, sub]) => sub.connectionId === connectionId)
      .map(([id]) => id);

    for (const subscriptionId of subscriptionsToRemove) {
      await this.unsubscribe(subscriptionId);
    }
  }

  /**
   * Get subscription information
   */
  getSubscription(subscriptionId: string): RealtimeSubscription | undefined {
    return this.subscriptions.get(subscriptionId);
  }

  /**
   * Get all subscriptions for a tenant
   */
  getSubscriptionsByTenant(tenantId: string): RealtimeSubscription[] {
    return Array.from(this.subscriptions.values())
      .filter(sub => sub.tenantId === tenantId);
  }

  /**
   * Get metrics
   */
  getMetrics(): RealtimeMetrics {
    return { ...this.metrics };
  }

  /**
   * Force update for specific subscription
   */
  async forceUpdate(subscriptionId: string, fullUpdate = false): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      throw new Error('Subscription not found');
    }

    if (fullUpdate) {
      await this.sendFullUpdate(subscriptionId);
    } else {
      await this.checkAndSendUpdates([subscription]);
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Check if background tasks are running
      if (!this.updateInterval || !this.heartbeatInterval) {
        return false;
      }

      // Check inventory service health
      const inventoryHealth = await this.inventoryService.healthCheck?.() || true;
      if (!inventoryHealth) {
        return false;
      }

      // Check cache service health
      const cacheHealth = await this.cache.healthCheck();
      if (!cacheHealth) {
        return false;
      }

      // Check WebSocket availability
      if (this.fastify.websocket) {
        const connectionCount = this.fastify.websocket.getConnectionCount();
        logger.debug(`WebSocket connections: ${connectionCount}`);
      }

      return true;

    } catch (error) {
      logger.error('Real-time inventory health check failed:', error);
      return false;
    }
  }

  /**
   * Initialize event handlers
   */
  private initializeEventHandlers(): void {
    // Listen for inventory update events
    this.eventEmitter.subscribe('inventory.updated', async (data) => {
      await this.handleInventoryUpdate(data);
    });

    this.eventEmitter.subscribe('inventory.reserved', async (data) => {
      await this.handleInventoryUpdate(data);
    });

    this.eventEmitter.subscribe('inventory.released', async (data) => {
      await this.handleInventoryUpdate(data);
    });

    // Listen for cache invalidation events
    this.eventEmitter.subscribe('cache.invalidated', async (data) => {
      if (data.namespace === 'inventory' || data.key?.includes('inventory')) {
        await this.handleCacheInvalidation(data);
      }
    });

    logger.debug('Real-time inventory event handlers initialized');
  }

  /**
   * Handle inventory update events
   */
  private async handleInventoryUpdate(eventData: any): Promise<void> {
    try {
      const tenantId = eventData.tenantId;
      const resourceId = eventData.resourceId;

      if (!tenantId || !resourceId) {
        return;
      }

      // Find subscriptions that need updates
      const affectedSubscriptions = Array.from(this.subscriptions.values()).filter(sub => 
        sub.tenantId === tenantId && sub.resourceIds.includes(resourceId)
      );

      if (affectedSubscriptions.length === 0) {
        return;
      }

      // Check and send updates
      await this.checkAndSendUpdates(affectedSubscriptions);

    } catch (error) {
      logger.error('Error handling inventory update event:', error);
      this.metrics.errorsCount++;
    }
  }

  /**
   * Handle cache invalidation events
   */
  private async handleCacheInvalidation(eventData: any): Promise<void> {
    try {
      // Clear local state cache when inventory cache is invalidated
      if (eventData.pattern?.includes('inventory_status:')) {
        const tenantMatch = eventData.pattern.match(/inventory_status:([^:]+):/);
        if (tenantMatch) {
          const tenantId = tenantMatch[1];
          this.lastKnownState.delete(tenantId);
          logger.debug(`Cleared local state cache for tenant: ${tenantId}`);
        }
      }

    } catch (error) {
      logger.error('Error handling cache invalidation event:', error);
    }
  }

  /**
   * Start background tasks
   */
  private startBackgroundTasks(): void {
    // Periodic update check (every 5 seconds)
    this.updateInterval = setInterval(async () => {
      try {
        await this.performPeriodicUpdate();
      } catch (error) {
        logger.error('Error in periodic update:', error);
        this.metrics.errorsCount++;
      }
    }, 5000);

    // Heartbeat (every 30 seconds)
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.sendHeartbeat();
      } catch (error) {
        logger.error('Error sending heartbeat:', error);
      }
    }, 30000);

    logger.info('Real-time inventory background tasks started');
  }

  /**
   * Perform periodic update check
   */
  private async performPeriodicUpdate(): Promise<void> {
    if (this.subscriptions.size === 0) {
      return;
    }

    // Group subscriptions by tenant to minimize database queries
    const subscriptionsByTenant = new Map<string, RealtimeSubscription[]>();
    for (const subscription of this.subscriptions.values()) {
      if (!subscriptionsByTenant.has(subscription.tenantId)) {
        subscriptionsByTenant.set(subscription.tenantId, []);
      }
      subscriptionsByTenant.get(subscription.tenantId)!.push(subscription);
    }

    // Process each tenant's subscriptions
    for (const [tenantId, subscriptions] of subscriptionsByTenant) {
      try {
        await this.checkAndSendUpdates(subscriptions);
      } catch (error) {
        logger.error(`Error updating subscriptions for tenant ${tenantId}:`, error);
        this.metrics.errorsCount++;
      }
    }
  }

  /**
   * Check and send updates for subscriptions
   */
  private async checkAndSendUpdates(subscriptions: RealtimeSubscription[]): Promise<void> {
    if (subscriptions.length === 0) return;

    const tenantId = subscriptions[0].tenantId;
    const allResourceIds = [...new Set(subscriptions.flatMap(sub => sub.resourceIds))];

    // Get current inventory status
    const now = new Date();
    const currentStatuses = await this.inventoryService.getInventoryStatus(
      tenantId,
      allResourceIds,
      subscriptions.reduce((min, sub) => min < sub.startDate ? min : sub.startDate, subscriptions[0].startDate),
      subscriptions.reduce((max, sub) => max > sub.endDate ? max : sub.endDate, subscriptions[0].endDate)
    );

    // Get last known state for this tenant
    if (!this.lastKnownState.has(tenantId)) {
      this.lastKnownState.set(tenantId, new Map());
    }
    const lastState = this.lastKnownState.get(tenantId)!;

    // Calculate diffs for each subscription
    for (const subscription of subscriptions) {
      try {
        const relevantStatuses = currentStatuses.filter(status => 
          subscription.resourceIds.includes(status.resourceId)
        );

        const diffs = this.calculateDiffs(relevantStatuses, lastState, subscription);

        if (diffs.length > 0) {
          await this.sendDifferentialUpdate(subscription.id, diffs, relevantStatuses);
          subscription.lastUpdate = now;
          subscription.updateCount++;
        }

      } catch (error) {
        logger.error(`Error processing subscription ${subscription.id}:`, error);
        await this.sendErrorMessage(subscription.id, error.message);
      }
    }

    // Update last known state
    for (const status of currentStatuses) {
      lastState.set(status.resourceId, status);
    }
  }

  /**
   * Calculate inventory differences
   */
  private calculateDiffs(
    currentStatuses: InventoryStatus[],
    lastState: Map<string, InventoryStatus>,
    subscription: RealtimeSubscription
  ): InventoryDiff[] {
    const diffs: InventoryDiff[] = [];

    for (const currentStatus of currentStatuses) {
      const lastStatus = lastState.get(currentStatus.resourceId);
      
      if (!lastStatus) {
        // New resource - treat as full change
        diffs.push({
          resourceId: currentStatus.resourceId,
          changes: {
            totalCapacity: { old: 0, new: currentStatus.totalCapacity },
            availableCapacity: { old: 0, new: currentStatus.availableCapacity },
            bookedCapacity: { old: 0, new: currentStatus.bookedCapacity },
            utilization: { old: 0, new: currentStatus.utilization },
            timeSlots: {
              added: currentStatus.timeSlots || [],
              updated: [],
              removed: []
            }
          },
          changeReason: 'New resource added to subscription',
          timestamp: new Date()
        });
        continue;
      }

      const diff: InventoryDiff = {
        resourceId: currentStatus.resourceId,
        changes: {},
        changeReason: 'Inventory updated',
        timestamp: new Date()
      };

      let hasChanges = false;

      // Check capacity changes
      if (lastStatus.totalCapacity !== currentStatus.totalCapacity) {
        diff.changes.totalCapacity = { old: lastStatus.totalCapacity, new: currentStatus.totalCapacity };
        hasChanges = true;
      }

      if (lastStatus.availableCapacity !== currentStatus.availableCapacity) {
        diff.changes.availableCapacity = { old: lastStatus.availableCapacity, new: currentStatus.availableCapacity };
        hasChanges = true;
      }

      if (lastStatus.bookedCapacity !== currentStatus.bookedCapacity) {
        diff.changes.bookedCapacity = { old: lastStatus.bookedCapacity, new: currentStatus.bookedCapacity };
        hasChanges = true;
      }

      if (Math.abs(lastStatus.utilization - currentStatus.utilization) > 0.1) {
        diff.changes.utilization = { old: lastStatus.utilization, new: currentStatus.utilization };
        hasChanges = true;
      }

      // Check time slot changes if details are requested
      if (subscription.includeDetails && currentStatus.timeSlots && lastStatus.timeSlots) {
        const timeSlotChanges = this.calculateTimeSlotChanges(lastStatus.timeSlots, currentStatus.timeSlots);
        if (timeSlotChanges.added.length > 0 || timeSlotChanges.updated.length > 0 || timeSlotChanges.removed.length > 0) {
          diff.changes.timeSlots = timeSlotChanges;
          hasChanges = true;
        }
      }

      if (hasChanges) {
        diffs.push(diff);
      }
    }

    return diffs;
  }

  /**
   * Calculate time slot changes
   */
  private calculateTimeSlotChanges(oldSlots: TimeSlot[], newSlots: TimeSlot[]): {
    added: TimeSlot[];
    updated: TimeSlot[];
    removed: string[];
  } {
    const oldSlotMap = new Map(oldSlots.map(slot => [slot.id, slot]));
    const newSlotMap = new Map(newSlots.map(slot => [slot.id, slot]));

    const added: TimeSlot[] = [];
    const updated: TimeSlot[] = [];
    const removed: string[] = [];

    // Find added and updated slots
    for (const [slotId, newSlot] of newSlotMap) {
      const oldSlot = oldSlotMap.get(slotId);
      if (!oldSlot) {
        added.push(newSlot);
      } else if (
        oldSlot.availableCapacity !== newSlot.availableCapacity ||
        oldSlot.capacity !== newSlot.capacity
      ) {
        updated.push(newSlot);
      }
    }

    // Find removed slots
    for (const slotId of oldSlotMap.keys()) {
      if (!newSlotMap.has(slotId)) {
        removed.push(slotId);
      }
    }

    return { added, updated, removed };
  }

  /**
   * Send full update to subscription
   */
  private async sendFullUpdate(subscriptionId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) return;

    try {
      const inventoryStatuses = await this.inventoryService.getInventoryStatus(
        subscription.tenantId,
        subscription.resourceIds,
        subscription.startDate,
        subscription.endDate
      );

      // Apply filters if specified
      const filteredStatuses = this.applyFilters(inventoryStatuses, subscription.filters);

      const message: RealtimeUpdateMessage = {
        type: 'full_update',
        subscriptionId,
        timestamp: Date.now(),
        data: {
          inventoryStatus: filteredStatuses,
          stats: {
            totalResources: subscription.resourceIds.length,
            updatedResources: filteredStatuses.length,
            changesSince: subscription.lastUpdate
          }
        }
      };

      await this.sendMessage(subscription.connectionId, message);

      this.metrics.fullUpdates++;
      this.metrics.totalUpdates++;

      logger.debug(`Sent full update for subscription: ${subscriptionId}`);

    } catch (error) {
      await this.sendErrorMessage(subscriptionId, error.message);
      this.metrics.errorsCount++;
    }
  }

  /**
   * Send differential update to subscription
   */
  private async sendDifferentialUpdate(
    subscriptionId: string,
    diffs: InventoryDiff[],
    currentStatuses: InventoryStatus[]
  ): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) return;

    try {
      const message: RealtimeUpdateMessage = {
        type: 'differential_update',
        subscriptionId,
        timestamp: Date.now(),
        data: {
          diffs,
          stats: {
            totalResources: subscription.resourceIds.length,
            updatedResources: diffs.length,
            changesSince: subscription.lastUpdate
          }
        }
      };

      // Calculate bandwidth savings
      const fullSize = JSON.stringify(currentStatuses).length;
      const diffSize = JSON.stringify(diffs).length;
      this.metrics.bandwidthSaved += Math.max(0, fullSize - diffSize);

      await this.sendMessage(subscription.connectionId, message);

      this.metrics.differentialUpdates++;
      this.metrics.totalUpdates++;

      logger.debug(`Sent differential update for subscription: ${subscriptionId}`, {
        changesCount: diffs.length,
        bandwidthSaved: fullSize - diffSize
      });

    } catch (error) {
      await this.sendErrorMessage(subscriptionId, error.message);
      this.metrics.errorsCount++;
    }
  }

  /**
   * Send heartbeat to all subscriptions
   */
  private async sendHeartbeat(): Promise<void> {
    const heartbeatPromises = Array.from(this.subscriptions.entries()).map(async ([subscriptionId, subscription]) => {
      try {
        const message: RealtimeUpdateMessage = {
          type: 'heartbeat',
          subscriptionId,
          timestamp: Date.now()
        };

        await this.sendMessage(subscription.connectionId, message);
      } catch (error) {
        logger.error(`Failed to send heartbeat to subscription ${subscriptionId}:`, error);
      }
    });

    await Promise.allSettled(heartbeatPromises);
  }

  /**
   * Send error message to subscription
   */
  private async sendErrorMessage(subscriptionId: string, error: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) return;

    const message: RealtimeUpdateMessage = {
      type: 'error',
      subscriptionId,
      timestamp: Date.now(),
      error
    };

    await this.sendMessage(subscription.connectionId, message);
  }

  /**
   * Send message via WebSocket
   */
  private async sendMessage(connectionId: string, message: RealtimeUpdateMessage): Promise<void> {
    try {
      if (this.fastify.websocket) {
        const sent = this.fastify.websocket.sendToConnection?.(connectionId, message);
        if (!sent) {
          // Connection might be closed, try to find and remove subscription
          const subscriptionToRemove = Array.from(this.subscriptions.entries())
            .find(([, sub]) => sub.connectionId === connectionId)?.[0];
          
          if (subscriptionToRemove) {
            await this.unsubscribe(subscriptionToRemove);
            logger.info(`Removed subscription for disconnected connection: ${connectionId}`);
          }
        }
      } else {
        logger.warn('WebSocket not available for sending real-time message');
      }
    } catch (error) {
      logger.error('Error sending WebSocket message:', error);
      throw error;
    }
  }

  /**
   * Apply filters to inventory statuses
   */
  private applyFilters(
    statuses: InventoryStatus[],
    filters?: RealtimeSubscription['filters']
  ): InventoryStatus[] {
    if (!filters) return statuses;

    return statuses.filter(status => {
      if (filters.minCapacity && status.totalCapacity < filters.minCapacity) {
        return false;
      }

      if (filters.maxUtilization && status.utilization > filters.maxUtilization) {
        return false;
      }

      if (filters.onlyAvailable && status.availableCapacity <= 0) {
        return false;
      }

      return true;
    });
  }

  /**
   * Generate unique subscription ID
   */
  private generateSubscriptionId(): string {
    return `sub_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Record latency for metrics
   */
  private recordLatency(latency: number): void {
    this.latencyHistory.push(latency);
    if (this.latencyHistory.length > 1000) {
      this.latencyHistory = this.latencyHistory.slice(-1000);
    }
    this.metrics.averageUpdateLatency = this.latencyHistory.reduce((sum, l) => sum + l, 0) / this.latencyHistory.length;
  }

  /**
   * Cleanup and shutdown
   */
  async shutdown(): Promise<void> {
    try {
      // Clear intervals
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
        this.updateInterval = undefined;
      }

      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = undefined;
      }

      // Unsubscribe all
      const subscriptionIds = Array.from(this.subscriptions.keys());
      for (const subscriptionId of subscriptionIds) {
        await this.unsubscribe(subscriptionId);
      }

      // Clear state
      this.lastKnownState.clear();
      
      logger.info('Real-time inventory service shut down');

    } catch (error) {
      logger.error('Error shutting down real-time inventory service:', error);
    }
  }
}

export default RealtimeInventoryService;