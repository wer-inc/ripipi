/**
 * Outbox Worker
 * Background process for reliable event processing
 */

import { FastifyInstance } from 'fastify';
import { OutboxService } from './outbox.service.js';
import { EventHandlerFactory } from './event-handlers.js';
import { logger } from '../config/logger.js';
import { NotificationService } from '../services/notification.service.js';
import { EmailService } from '../services/email.service.js';
import { LineNotificationService } from '../services/line-notification.service.js';
import { WebhookService } from '../services/webhook.service.js';

export interface WorkerConfig {
  processInterval: number;  // Milliseconds between processing runs
  batchSize: number;        // Number of events to process in each batch
  retryInterval: number;    // Milliseconds between retry attempts
  cleanupInterval: number;  // Milliseconds between cleanup runs
  cleanupDays: number;      // Days to retain completed events
  enableMetrics: boolean;   // Enable metrics collection
}

/**
 * Outbox Worker for processing events
 */
export class OutboxWorker {
  private outboxService: OutboxService;
  private eventHandlerFactory: EventHandlerFactory;
  private isRunning = false;
  private cleanupInterval?: NodeJS.Timeout;
  private metricsInterval?: NodeJS.Timeout;
  private retryInterval?: NodeJS.Timeout;
  
  private readonly defaultConfig: WorkerConfig = {
    processInterval: 5000,    // 5 seconds
    batchSize: 100,
    retryInterval: 60000,     // 1 minute
    cleanupInterval: 3600000, // 1 hour
    cleanupDays: 7,
    enableMetrics: true
  };
  
  constructor(
    private fastify: FastifyInstance,
    private config: Partial<WorkerConfig> = {}
  ) {
    this.config = { ...this.defaultConfig, ...config };
    this.outboxService = new OutboxService(fastify);
    
    // Initialize services
    const notificationService = new NotificationService(fastify);
    const emailService = new EmailService(fastify);
    const lineService = new LineNotificationService(fastify);
    const webhookService = new WebhookService(fastify);
    
    // Create event handler factory
    this.eventHandlerFactory = new EventHandlerFactory(
      notificationService,
      emailService,
      lineService,
      webhookService
    );
    
    // Register event handlers with outbox service
    this.registerEventHandlers();
  }

  /**
   * Register all event handlers
   */
  private registerEventHandlers(): void {
    const handlers = this.eventHandlerFactory.getAllHandlers();
    
    for (const [eventType, handler] of handlers) {
      this.outboxService.registerHandler(
        eventType,
        async (event) => await handler.handle(event)
      );
      
      logger.info('Registered event handler', { eventType });
    }
  }

  /**
   * Start the worker
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Outbox worker is already running');
      return;
    }
    
    logger.info('Starting outbox worker', this.config);
    this.isRunning = true;
    
    // Start event processing
    this.outboxService.startProcessing(this.config.processInterval);
    
    // Start retry processing
    this.startRetryProcessing();
    
    // Start cleanup process
    this.startCleanupProcess();
    
    // Start metrics collection
    if (this.config.enableMetrics) {
      this.startMetricsCollection();
    }
    
    // Handle graceful shutdown
    this.setupShutdownHandlers();
    
    logger.info('Outbox worker started successfully');
  }

  /**
   * Stop the worker
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Outbox worker is not running');
      return;
    }
    
    logger.info('Stopping outbox worker');
    this.isRunning = false;
    
    // Stop all processes
    this.outboxService.stopProcessing();
    
    if (this.retryInterval) {
      clearInterval(this.retryInterval);
      this.retryInterval = undefined;
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = undefined;
    }
    
    logger.info('Outbox worker stopped');
  }

  /**
   * Start retry processing for failed events
   */
  private startRetryProcessing(): void {
    // Retry immediately
    this.retryFailedEvents();
    
    // Then retry at intervals
    this.retryInterval = setInterval(
      () => this.retryFailedEvents(),
      this.config.retryInterval!
    );
  }

  /**
   * Retry failed events
   */
  private async retryFailedEvents(): Promise<void> {
    try {
      const count = await this.outboxService.retryFailedEvents(this.config.batchSize!);
      
      if (count > 0) {
        logger.info('Retrying failed events', { count });
      }
    } catch (error) {
      logger.error('Failed to retry events', { error });
    }
  }

  /**
   * Start cleanup process for old events
   */
  private startCleanupProcess(): void {
    // Clean up immediately
    this.cleanupOldEvents();
    
    // Then clean up at intervals
    this.cleanupInterval = setInterval(
      () => this.cleanupOldEvents(),
      this.config.cleanupInterval!
    );
  }

  /**
   * Clean up old completed events
   */
  private async cleanupOldEvents(): Promise<void> {
    try {
      const count = await this.outboxService.cleanupCompletedEvents(
        this.config.cleanupDays!
      );
      
      if (count > 0) {
        logger.info('Cleaned up old events', { count });
      }
    } catch (error) {
      logger.error('Failed to clean up events', { error });
    }
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    // Collect metrics immediately
    this.collectMetrics();
    
    // Then collect at intervals (every minute)
    this.metricsInterval = setInterval(
      () => this.collectMetrics(),
      60000
    );
  }

  /**
   * Collect and log metrics
   */
  private async collectMetrics(): Promise<void> {
    try {
      const stats = await this.outboxService.getStatistics();
      
      // Log metrics
      logger.info('Outbox metrics', {
        ...stats,
        timestamp: new Date().toISOString()
      });
      
      // Send metrics to monitoring system (if configured)
      // This could be Prometheus, CloudWatch, etc.
      await this.sendMetrics(stats);
      
    } catch (error) {
      logger.error('Failed to collect metrics', { error });
    }
  }

  /**
   * Send metrics to monitoring system
   */
  private async sendMetrics(stats: any): Promise<void> {
    // Implement integration with your monitoring system
    // Example: Prometheus, CloudWatch, DataDog, etc.
    
    // For now, just log them
    if (stats.failed > 10 || stats.deadLetter > 5) {
      logger.warn('High failure rate detected', stats);
    }
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupShutdownHandlers(): void {
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully`);
      
      await this.stop();
      
      // Give some time for cleanup
      setTimeout(() => {
        process.exit(0);
      }, 5000);
    };
    
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  /**
   * Get worker status
   */
  getStatus(): {
    running: boolean;
    config: Partial<WorkerConfig>;
    uptime: number;
  } {
    return {
      running: this.isRunning,
      config: this.config,
      uptime: process.uptime()
    };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    details: any;
  }> {
    try {
      const stats = await this.outboxService.getStatistics();
      
      // Consider unhealthy if too many failures
      const healthy = stats.failed < 100 && stats.deadLetter < 50;
      
      return {
        healthy,
        details: {
          ...stats,
          worker: this.getStatus()
        }
      };
      
    } catch (error) {
      logger.error('Health check failed', { error });
      
      return {
        healthy: false,
        details: {
          error: (error as Error).message
        }
      };
    }
  }
}

/**
 * Create and start the outbox worker
 */
export async function startOutboxWorker(
  fastify: FastifyInstance,
  config?: Partial<WorkerConfig>
): Promise<OutboxWorker> {
  const worker = new OutboxWorker(fastify, config);
  await worker.start();
  return worker;
}