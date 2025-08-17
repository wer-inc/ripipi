/**
 * Outbox Service
 * Manages event publishing with at-least-once delivery guarantee
 */

import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { logger } from '../config/logger.js';
import { withTransaction, TransactionContext } from '../db/transaction.js';
import { v4 as uuidv4 } from 'uuid';

export interface OutboxEvent {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: any;
  metadata?: any;
  correlationId?: string;
  causationId?: string;
  traceId?: string;
  scheduledAt?: Date;
}

export interface ProcessedEvent {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: any;
  metadata: any;
  tenantId: number;
  correlationId?: string;
  causationId?: string;
  traceId?: string;
}

export type EventHandler = (event: ProcessedEvent) => Promise<void>;

/**
 * Outbox Service for reliable event publishing
 */
export class OutboxService {
  private pool: Pool;
  private eventHandlers: Map<string, EventHandler[]> = new Map();
  private isProcessing = false;
  private processingInterval?: NodeJS.Timeout;
  
  constructor(private fastify: FastifyInstance) {
    this.pool = fastify.pg.pool;
  }

  /**
   * Publish an event to the outbox
   * This should be called within the same transaction as the business operation
   */
  async publishEvent(
    ctx: TransactionContext,
    tenantId: number,
    event: OutboxEvent
  ): Promise<string> {
    const eventId = uuidv4();
    
    const query = `
      INSERT INTO outbox_events (
        event_id, tenant_id, event_type, aggregate_type, aggregate_id,
        payload, metadata, correlation_id, causation_id, trace_id, scheduled_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id
    `;
    
    const values = [
      eventId,
      tenantId,
      event.eventType,
      event.aggregateType,
      event.aggregateId,
      JSON.stringify(event.payload),
      JSON.stringify(event.metadata || {}),
      event.correlationId || null,
      event.causationId || null,
      event.traceId || null,
      event.scheduledAt || new Date()
    ];
    
    try {
      await ctx.query(query, values);
      
      logger.info('Event published to outbox', {
        eventId,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        tenantId,
        traceId: event.traceId
      });
      
      return eventId;
    } catch (error) {
      logger.error('Failed to publish event to outbox', {
        error,
        event,
        tenantId
      });
      throw error;
    }
  }

  /**
   * Publish multiple events atomically
   */
  async publishEvents(
    ctx: TransactionContext,
    tenantId: number,
    events: OutboxEvent[]
  ): Promise<string[]> {
    const eventIds: string[] = [];
    
    for (const event of events) {
      const eventId = await this.publishEvent(ctx, tenantId, event);
      eventIds.push(eventId);
    }
    
    return eventIds;
  }

  /**
   * Register an event handler
   */
  registerHandler(eventType: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    
    this.eventHandlers.get(eventType)!.push(handler);
    
    logger.info('Event handler registered', { eventType });
  }

  /**
   * Start processing outbox events
   */
  startProcessing(intervalMs: number = 5000): void {
    if (this.processingInterval) {
      logger.warn('Outbox processing already started');
      return;
    }
    
    logger.info('Starting outbox processing', { intervalMs });
    
    // Process immediately
    this.processEvents();
    
    // Then process at intervals
    this.processingInterval = setInterval(() => {
      if (!this.isProcessing) {
        this.processEvents();
      }
    }, intervalMs);
  }

  /**
   * Stop processing outbox events
   */
  stopProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
      logger.info('Outbox processing stopped');
    }
  }

  /**
   * Process pending events from the outbox
   */
  private async processEvents(): Promise<void> {
    if (this.isProcessing) {
      return;
    }
    
    this.isProcessing = true;
    
    try {
      // Get batch of pending events
      const events = await this.getPendingEvents(100);
      
      if (events.length === 0) {
        return;
      }
      
      logger.debug('Processing outbox events', { count: events.length });
      
      // Process each event
      for (const event of events) {
        await this.processEvent(event);
      }
      
    } catch (error) {
      logger.error('Failed to process outbox events', { error });
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Get pending events from the outbox
   */
  private async getPendingEvents(limit: number): Promise<ProcessedEvent[]> {
    const query = `
      UPDATE outbox_events
      SET status = 'PROCESSING', processed_at = NOW()
      WHERE id IN (
        SELECT id FROM outbox_events
        WHERE status IN ('PENDING', 'FAILED')
          AND scheduled_at <= NOW()
          AND retry_count < max_retries
        ORDER BY scheduled_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING 
        event_id as "eventId",
        tenant_id as "tenantId",
        event_type as "eventType",
        aggregate_type as "aggregateType",
        aggregate_id as "aggregateId",
        payload,
        metadata,
        correlation_id as "correlationId",
        causation_id as "causationId",
        trace_id as "traceId"
    `;
    
    const result = await this.pool.query(query, [limit]);
    return result.rows;
  }

  /**
   * Process a single event
   */
  private async processEvent(event: ProcessedEvent): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Get handlers for this event type
      const handlers = this.eventHandlers.get(event.eventType) || [];
      
      if (handlers.length === 0) {
        logger.warn('No handlers registered for event type', {
          eventType: event.eventType,
          eventId: event.eventId
        });
      }
      
      // Execute all handlers
      await Promise.all(
        handlers.map(handler => this.executeHandler(handler, event))
      );
      
      // Mark as completed
      await this.markEventCompleted(event.eventId);
      
      const duration = Date.now() - startTime;
      logger.info('Event processed successfully', {
        eventId: event.eventId,
        eventType: event.eventType,
        duration,
        traceId: event.traceId
      });
      
    } catch (error) {
      await this.handleEventError(event, error as Error);
    }
  }

  /**
   * Execute a handler with error handling
   */
  private async executeHandler(
    handler: EventHandler,
    event: ProcessedEvent
  ): Promise<void> {
    try {
      await handler(event);
    } catch (error) {
      logger.error('Event handler failed', {
        error,
        eventId: event.eventId,
        eventType: event.eventType
      });
      throw error;
    }
  }

  /**
   * Mark an event as completed
   */
  private async markEventCompleted(eventId: string): Promise<void> {
    const query = `
      UPDATE outbox_events
      SET status = 'COMPLETED', processed_at = NOW()
      WHERE event_id = $1
    `;
    
    await this.pool.query(query, [eventId]);
  }

  /**
   * Handle event processing error
   */
  private async handleEventError(
    event: ProcessedEvent,
    error: Error
  ): Promise<void> {
    logger.error('Failed to process event', {
      error,
      eventId: event.eventId,
      eventType: event.eventType,
      traceId: event.traceId
    });
    
    const query = `
      UPDATE outbox_events
      SET 
        status = CASE 
          WHEN retry_count + 1 >= max_retries THEN 'FAILED'
          ELSE 'FAILED'
        END,
        retry_count = retry_count + 1,
        last_error = $2,
        scheduled_at = NOW() + INTERVAL '1 minute' * POWER(2, retry_count + 1)
      WHERE event_id = $1
      RETURNING retry_count, max_retries
    `;
    
    const result = await this.pool.query(query, [event.eventId, error.message]);
    
    if (result.rows.length > 0) {
      const { retry_count, max_retries } = result.rows[0];
      
      if (retry_count >= max_retries) {
        // Move to dead letter queue
        await this.moveToDeadLetter(event.eventId);
        
        logger.error('Event moved to dead letter queue', {
          eventId: event.eventId,
          eventType: event.eventType,
          retryCount: retry_count
        });
      }
    }
  }

  /**
   * Move event to dead letter queue
   */
  private async moveToDeadLetter(eventId: string): Promise<void> {
    const query = `SELECT move_to_dead_letter($1)`;
    await this.pool.query(query, [eventId]);
  }

  /**
   * Retry failed events
   */
  async retryFailedEvents(limit: number = 100): Promise<number> {
    const query = `
      UPDATE outbox_events
      SET status = 'PENDING', scheduled_at = NOW()
      WHERE id IN (
        SELECT id FROM outbox_events
        WHERE status = 'FAILED'
          AND retry_count < max_retries
        LIMIT $1
      )
    `;
    
    const result = await this.pool.query(query, [limit]);
    const count = result.rowCount || 0;
    
    if (count > 0) {
      logger.info('Failed events marked for retry', { count });
    }
    
    return count;
  }

  /**
   * Get event statistics
   */
  async getStatistics(): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    deadLetter: number;
  }> {
    const query = `
      SELECT 
        status,
        COUNT(*) as count
      FROM outbox_events
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY status
    `;
    
    const deadLetterQuery = `
      SELECT COUNT(*) as count
      FROM outbox_dead_letter
      WHERE moved_at > NOW() - INTERVAL '24 hours'
    `;
    
    const [statusResult, deadLetterResult] = await Promise.all([
      this.pool.query(query),
      this.pool.query(deadLetterQuery)
    ]);
    
    const stats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      deadLetter: parseInt(deadLetterResult.rows[0]?.count || '0')
    };
    
    for (const row of statusResult.rows) {
      const status = row.status.toLowerCase();
      if (status in stats) {
        stats[status as keyof typeof stats] = parseInt(row.count);
      }
    }
    
    return stats;
  }

  /**
   * Clean up old completed events
   */
  async cleanupCompletedEvents(olderThanDays: number = 7): Promise<number> {
    const query = `
      DELETE FROM outbox_events
      WHERE status = 'COMPLETED'
        AND processed_at < NOW() - INTERVAL '$1 days'
    `;
    
    const result = await this.pool.query(query, [olderThanDays]);
    const count = result.rowCount || 0;
    
    if (count > 0) {
      logger.info('Cleaned up completed events', { count, olderThanDays });
    }
    
    return count;
  }
}