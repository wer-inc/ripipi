/**
 * Outbox Pattern Test
 * Tests event publishing and processing with at-least-once delivery
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import Fastify from 'fastify';
import { OutboxService } from '../src/outbox/outbox.service.js';
import { OutboxWorker } from '../src/outbox/outbox-worker.js';
import { EventPublisherService } from '../src/services/event-publisher.service.js';
import { withTransaction } from '../src/db/transaction.js';
import { logger } from '../src/config/logger.js';

describe('Outbox Pattern', () => {
  let fastify: any;
  let outboxService: OutboxService;
  let eventPublisher: EventPublisherService;
  let worker: OutboxWorker;

  beforeAll(async () => {
    // Initialize Fastify with database
    fastify = Fastify({ logger: false });
    
    // Register database plugin (mock or test database)
    await fastify.register(require('@fastify/postgres'), {
      connectionString: process.env.DATABASE_URL || 'postgresql://localhost/test'
    });
    
    await fastify.ready();
    
    // Initialize services
    outboxService = new OutboxService(fastify);
    eventPublisher = new EventPublisherService(fastify);
    
    // Initialize worker with test configuration
    worker = new OutboxWorker(fastify, {
      processInterval: 1000,  // 1 second for testing
      batchSize: 10,
      enableMetrics: false
    });
  });

  afterAll(async () => {
    await worker.stop();
    await fastify.close();
  });

  describe('Event Publishing', () => {
    it('should publish event to outbox within transaction', async () => {
      const tenantId = 1;
      const bookingData = {
        bookingId: 123,
        customerId: 456,
        serviceId: 789,
        startTime: new Date(),
        customerEmail: 'test@example.com',
        serviceName: 'Test Service',
        confirmationCode: 'ABC123',
        amount: 5000,
        metadata: { source: 'test' }
      };
      
      let eventId: string;
      
      await withTransaction(async (ctx) => {
        eventId = await eventPublisher.publishBookingCreated(
          ctx,
          tenantId,
          bookingData,
          'test-trace-123'
        );
        
        expect(eventId).toBeDefined();
        expect(typeof eventId).toBe('string');
      });
      
      // Verify event was persisted
      const query = `
        SELECT * FROM outbox_events 
        WHERE event_id = $1
      `;
      const result = await fastify.pg.pool.query(query, [eventId!]);
      
      expect(result.rows.length).toBe(1);
      const event = result.rows[0];
      expect(event.event_type).toBe('BOOKING_CREATED');
      expect(event.status).toBe('PENDING');
      expect(event.aggregate_type).toBe('BOOKING');
      expect(event.aggregate_id).toBe('123');
      expect(event.trace_id).toBe('test-trace-123');
    });

    it('should handle transaction rollback', async () => {
      const tenantId = 1;
      const bookingData = {
        bookingId: 124,
        customerId: 457,
        serviceId: 790,
        startTime: new Date(),
        customerEmail: 'test2@example.com',
        serviceName: 'Test Service 2',
        confirmationCode: 'DEF456',
        amount: 3000,
        metadata: { source: 'test' }
      };
      
      let eventId: string;
      
      try {
        await withTransaction(async (ctx) => {
          eventId = await eventPublisher.publishBookingCreated(
            ctx,
            tenantId,
            bookingData,
            'test-trace-124'
          );
          
          // Force rollback
          throw new Error('Simulated error');
        });
      } catch (error) {
        // Expected error
      }
      
      // Verify event was NOT persisted due to rollback
      const query = `
        SELECT * FROM outbox_events 
        WHERE aggregate_id = '124' AND event_type = 'BOOKING_CREATED'
      `;
      const result = await fastify.pg.pool.query(query);
      
      expect(result.rows.length).toBe(0);
    });
  });

  describe('Event Processing', () => {
    it('should process pending events', async (done) => {
      const tenantId = 1;
      let processedEventId: string | null = null;
      
      // Register a test handler
      outboxService.registerHandler('TEST_EVENT', async (event) => {
        processedEventId = event.eventId;
        logger.info('Test event processed', { eventId: event.eventId });
      });
      
      // Publish a test event
      await withTransaction(async (ctx) => {
        const event = {
          eventType: 'TEST_EVENT',
          aggregateType: 'TEST',
          aggregateId: '999',
          payload: { test: true },
          metadata: { timestamp: Date.now() }
        };
        
        const eventId = await outboxService.publishEvent(ctx, tenantId, event);
        
        // Start processing
        outboxService.startProcessing(100);  // Process every 100ms for testing
        
        // Wait for processing
        setTimeout(async () => {
          // Verify event was processed
          expect(processedEventId).toBeTruthy();
          
          // Check event status
          const query = `
            SELECT status FROM outbox_events 
            WHERE event_id = $1
          `;
          const result = await fastify.pg.pool.query(query, [eventId]);
          
          expect(result.rows[0].status).toBe('COMPLETED');
          
          outboxService.stopProcessing();
          done();
        }, 500);
      });
    });

    it('should handle event processing errors with retry', async (done) => {
      const tenantId = 1;
      let attemptCount = 0;
      
      // Register a handler that fails first time
      outboxService.registerHandler('RETRY_TEST_EVENT', async (event) => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error('First attempt failed');
        }
        logger.info('Event processed on retry', { 
          eventId: event.eventId,
          attempt: attemptCount 
        });
      });
      
      // Publish event
      await withTransaction(async (ctx) => {
        const event = {
          eventType: 'RETRY_TEST_EVENT',
          aggregateType: 'TEST',
          aggregateId: '1000',
          payload: { test: true }
        };
        
        const eventId = await outboxService.publishEvent(ctx, tenantId, event);
        
        // Start processing
        outboxService.startProcessing(100);
        
        // Wait for initial failure
        setTimeout(async () => {
          // Check event status after first failure
          const query = `
            SELECT status, retry_count FROM outbox_events 
            WHERE event_id = $1
          `;
          let result = await fastify.pg.pool.query(query, [eventId]);
          
          expect(result.rows[0].status).toBe('FAILED');
          expect(result.rows[0].retry_count).toBe(1);
          
          // Retry failed events
          await outboxService.retryFailedEvents(10);
          
          // Wait for retry processing
          setTimeout(async () => {
            result = await fastify.pg.pool.query(query, [eventId]);
            
            expect(result.rows[0].status).toBe('COMPLETED');
            expect(attemptCount).toBe(2);
            
            outboxService.stopProcessing();
            done();
          }, 500);
        }, 500);
      });
    });
  });

  describe('Worker Health Check', () => {
    it('should report worker health status', async () => {
      await worker.start();
      
      const health = await worker.healthCheck();
      
      expect(health.healthy).toBe(true);
      expect(health.details).toHaveProperty('pending');
      expect(health.details).toHaveProperty('processing');
      expect(health.details).toHaveProperty('completed');
      expect(health.details).toHaveProperty('failed');
      expect(health.details).toHaveProperty('deadLetter');
      expect(health.details.worker.running).toBe(true);
      
      await worker.stop();
    });
  });

  describe('Event Statistics', () => {
    it('should provide event statistics', async () => {
      const stats = await outboxService.getStatistics();
      
      expect(stats).toHaveProperty('pending');
      expect(stats).toHaveProperty('processing');
      expect(stats).toHaveProperty('completed');
      expect(stats).toHaveProperty('failed');
      expect(stats).toHaveProperty('deadLetter');
      
      expect(typeof stats.pending).toBe('number');
      expect(typeof stats.completed).toBe('number');
    });
  });

  describe('Cleanup', () => {
    it('should clean up old completed events', async () => {
      // Insert an old completed event (mock)
      const query = `
        INSERT INTO outbox_events (
          event_id, tenant_id, event_type, aggregate_type, aggregate_id,
          payload, status, processed_at
        ) VALUES (
          gen_random_uuid(), 1, 'OLD_EVENT', 'TEST', '9999',
          '{}', 'COMPLETED', NOW() - INTERVAL '10 days'
        )
      `;
      await fastify.pg.pool.query(query);
      
      // Run cleanup
      const cleanedCount = await outboxService.cleanupCompletedEvents(7);
      
      expect(cleanedCount).toBeGreaterThan(0);
    });
  });
});

describe('Outbox Performance', () => {
  it('should handle high-volume event publishing', async () => {
    const fastify = Fastify({ logger: false });
    await fastify.register(require('@fastify/postgres'), {
      connectionString: process.env.DATABASE_URL || 'postgresql://localhost/test'
    });
    await fastify.ready();
    
    const eventPublisher = new EventPublisherService(fastify);
    const eventCount = 100;
    const tenantId = 1;
    
    const startTime = Date.now();
    
    await withTransaction(async (ctx) => {
      const promises = [];
      
      for (let i = 0; i < eventCount; i++) {
        const bookingData = {
          bookingId: 10000 + i,
          customerId: 20000 + i,
          serviceId: 1,
          startTime: new Date(),
          customerEmail: `user${i}@example.com`,
          serviceName: 'Performance Test Service',
          confirmationCode: `PERF${i}`,
          amount: 1000 * i,
          metadata: { test: 'performance' }
        };
        
        promises.push(
          eventPublisher.publishBookingCreated(
            ctx,
            tenantId,
            bookingData,
            `perf-trace-${i}`
          )
        );
      }
      
      await Promise.all(promises);
    });
    
    const duration = Date.now() - startTime;
    const eventsPerSecond = (eventCount / duration) * 1000;
    
    logger.info('Performance test completed', {
      eventCount,
      durationMs: duration,
      eventsPerSecond: Math.round(eventsPerSecond)
    });
    
    expect(duration).toBeLessThan(5000);  // Should complete within 5 seconds
    expect(eventsPerSecond).toBeGreaterThan(20);  // At least 20 events/second
    
    await fastify.close();
  });
});