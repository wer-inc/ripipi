/**
 * Notification Worker
 * Handles asynchronous notification processing with job queues,
 * retry logic, batch processing, and monitoring
 */

import { FastifyInstance } from 'fastify';
import Bull, { Job, JobOptions, Queue } from 'bull';
import { 
  NotificationRequest,
  NotificationResponse,
  BulkNotificationRequest,
  NotificationChannel,
  NotificationPriority,
  NotificationStatus,
  NotificationTemplateType,
  NotificationQueueConfig
} from '../types/notification.js';
import { TenantContext } from '../types/database.js';
import { NotificationService } from '../services/notification.service.js';
import { logger } from '../config/logger.js';
import { withTransaction } from '../db/transaction.js';

/**
 * Job types for the notification system
 */
export type NotificationJobType = 
  | 'SEND_IMMEDIATE'     // Send notification immediately
  | 'SEND_SCHEDULED'     // Send notification at scheduled time
  | 'SEND_BULK'          // Process bulk notification batch
  | 'RETRY_FAILED'       // Retry failed notification
  | 'CLEANUP_EXPIRED'    // Clean up expired notifications
  | 'PROCESS_WEBHOOK'    // Process webhook callbacks
  | 'DELIVERY_STATUS';   // Update delivery status

/**
 * Job data interfaces
 */
export interface SendImmediateJobData {
  request: NotificationRequest;
  context: TenantContext;
  priority: NotificationPriority;
  correlationId?: string;
}

export interface SendScheduledJobData {
  notificationId: string;
  tenantId: string;
  scheduledAt: Date;
  context: TenantContext;
}

export interface SendBulkJobData {
  request: BulkNotificationRequest;
  batchId: string;
  context: TenantContext;
  batchIndex?: number;
  batchSize?: number;
}

export interface RetryFailedJobData {
  notificationId: string;
  tenantId: string;
  retryAttempt: number;
  context: TenantContext;
  originalError?: string;
}

export interface CleanupExpiredJobData {
  tenantId?: string;
  olderThanHours: number;
  batchSize: number;
}

export interface WebhookJobData {
  notificationId: string;
  tenantId: string;
  webhookData: any;
  webhookType: 'delivery_status' | 'bounce' | 'complaint' | 'click' | 'open';
}

export interface DeliveryStatusJobData {
  notificationId: string;
  tenantId: string;
  externalId: string;
  status: NotificationStatus;
  deliveredAt?: Date;
  errorMessage?: string;
}

/**
 * Queue configuration with priorities
 */
interface QueueConfig {
  name: string;
  concurrency: number;
  priority: number;
  rateLimiter?: {
    max: number;
    duration: number;
  };
  defaultJobOptions: JobOptions;
}

/**
 * Job processing result
 */
interface JobResult {
  success: boolean;
  notificationId?: string;
  processedCount?: number;
  error?: string;
  retryable?: boolean;
  metadata?: Record<string, any>;
}

/**
 * Worker metrics
 */
interface WorkerMetrics {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  retriedJobs: number;
  averageProcessingTime: number;
  queueStats: Record<string, {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }>;
  lastUpdated: Date;
}

/**
 * Main notification worker class
 */
export class NotificationWorker {
  private queues: Map<NotificationJobType, Queue> = new Map();
  private notificationService: NotificationService;
  private config: NotificationQueueConfig;
  private isShuttingDown: boolean = false;
  private metrics: WorkerMetrics;

  constructor(
    private fastify: FastifyInstance,
    config?: Partial<NotificationQueueConfig>
  ) {
    this.notificationService = new NotificationService(fastify);
    this.config = this.mergeConfig(config);
    this.initializeMetrics();
    this.initializeQueues();
    this.setupEventHandlers();
    this.startMonitoring();
  }

  /**
   * Initialize and start all queues
   */
  async start(): Promise<void> {
    try {
      logger.info('Starting notification worker');

      // Start processing each queue
      for (const [jobType, queue] of this.queues) {
        await this.startQueueProcessing(jobType, queue);
      }

      // Schedule recurring jobs
      await this.scheduleRecurringJobs();

      logger.info('Notification worker started successfully', {
        queues: Array.from(this.queues.keys()),
        totalQueues: this.queues.size
      });

    } catch (error) {
      logger.error('Failed to start notification worker', { error });
      throw error;
    }
  }

  /**
   * Gracefully shutdown the worker
   */
  async stop(): Promise<void> {
    try {
      logger.info('Stopping notification worker');
      this.isShuttingDown = true;

      // Stop accepting new jobs
      const shutdownPromises = Array.from(this.queues.values()).map(queue => 
        queue.close()
      );

      await Promise.all(shutdownPromises);

      logger.info('Notification worker stopped successfully');

    } catch (error) {
      logger.error('Error stopping notification worker', { error });
      throw error;
    }
  }

  /**
   * Add immediate notification job
   */
  async addImmediateNotification(
    request: NotificationRequest,
    context: TenantContext,
    options?: Partial<JobOptions>
  ): Promise<Job<SendImmediateJobData>> {
    const queue = this.queues.get('SEND_IMMEDIATE');
    if (!queue) {
      throw new Error('Immediate notification queue not initialized');
    }

    const jobData: SendImmediateJobData = {
      request,
      context,
      priority: request.priority,
      correlationId: request.correlationId
    };

    const jobOptions: JobOptions = {
      ...this.getJobOptionsForPriority(request.priority),
      ...options,
      // Add delay for rate limiting if needed
      delay: this.calculateDelay(request.channel, request.priority)
    };

    const job = await queue.add('send-immediate', jobData, jobOptions);

    logger.debug('Added immediate notification job', {
      jobId: job.id,
      tenantId: request.tenantId,
      templateType: request.templateType,
      channel: request.channel,
      priority: request.priority
    });

    return job;
  }

  /**
   * Add scheduled notification job
   */
  async addScheduledNotification(
    notificationId: string,
    tenantId: string,
    scheduledAt: Date,
    context: TenantContext,
    options?: Partial<JobOptions>
  ): Promise<Job<SendScheduledJobData>> {
    const queue = this.queues.get('SEND_SCHEDULED');
    if (!queue) {
      throw new Error('Scheduled notification queue not initialized');
    }

    const jobData: SendScheduledJobData = {
      notificationId,
      tenantId,
      scheduledAt,
      context
    };

    const delay = scheduledAt.getTime() - Date.now();
    const jobOptions: JobOptions = {
      ...this.config.defaultJobOptions,
      ...options,
      delay: Math.max(0, delay)
    };

    const job = await queue.add('send-scheduled', jobData, jobOptions);

    logger.debug('Added scheduled notification job', {
      jobId: job.id,
      notificationId,
      tenantId,
      scheduledAt,
      delay
    });

    return job;
  }

  /**
   * Add bulk notification job
   */
  async addBulkNotification(
    request: BulkNotificationRequest,
    batchId: string,
    context: TenantContext,
    options?: Partial<JobOptions>
  ): Promise<Job<SendBulkJobData>> {
    const queue = this.queues.get('SEND_BULK');
    if (!queue) {
      throw new Error('Bulk notification queue not initialized');
    }

    const jobData: SendBulkJobData = {
      request,
      batchId,
      context,
      batchSize: request.batchConfig?.batchSize || 100
    };

    const jobOptions: JobOptions = {
      ...this.getJobOptionsForPriority(request.priority),
      ...options
    };

    const job = await queue.add('send-bulk', jobData, jobOptions);

    logger.debug('Added bulk notification job', {
      jobId: job.id,
      batchId,
      tenantId: request.tenantId,
      recipientCount: request.recipients.length,
      channel: request.channel
    });

    return job;
  }

  /**
   * Add retry job for failed notification
   */
  async addRetryJob(
    notificationId: string,
    tenantId: string,
    retryAttempt: number,
    context: TenantContext,
    originalError?: string
  ): Promise<Job<RetryFailedJobData>> {
    const queue = this.queues.get('RETRY_FAILED');
    if (!queue) {
      throw new Error('Retry queue not initialized');
    }

    const jobData: RetryFailedJobData = {
      notificationId,
      tenantId,
      retryAttempt,
      context,
      originalError
    };

    const delay = this.calculateRetryDelay(retryAttempt);
    const jobOptions: JobOptions = {
      ...this.config.defaultJobOptions,
      delay,
      attempts: 1 // Don't retry retry jobs
    };

    const job = await queue.add('retry-failed', jobData, jobOptions);

    logger.debug('Added retry job', {
      jobId: job.id,
      notificationId,
      tenantId,
      retryAttempt,
      delay
    });

    return job;
  }

  /**
   * Get worker metrics
   */
  async getMetrics(): Promise<WorkerMetrics> {
    await this.updateQueueStats();
    return { ...this.metrics };
  }

  /**
   * Get queue status
   */
  async getQueueStatus(): Promise<Record<string, any>> {
    const status: Record<string, any> = {};

    for (const [jobType, queue] of this.queues) {
      const counts = await queue.getJobCounts();
      status[jobType] = {
        name: queue.name,
        ...counts,
        isPaused: await queue.isPaused(),
        isReady: queue.client.status === 'ready'
      };
    }

    return status;
  }

  // Private methods

  private mergeConfig(config?: Partial<NotificationQueueConfig>): NotificationQueueConfig {
    return {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        db: parseInt(process.env.NOTIFICATION_REDIS_DB || '1'),
        password: process.env.REDIS_PASSWORD,
        keyPrefix: 'notifications:',
        ...config?.redis
      },
      queues: {
        immediate: {
          name: 'notification:immediate',
          concurrency: 10,
          rateLimiter: { max: 100, duration: 60000 }
        },
        scheduled: {
          name: 'notification:scheduled',
          concurrency: 5,
          rateLimiter: { max: 50, duration: 60000 }
        },
        retry: {
          name: 'notification:retry',
          concurrency: 3,
          rateLimiter: { max: 30, duration: 60000 }
        },
        bulk: {
          name: 'notification:bulk',
          concurrency: 2,
          rateLimiter: { max: 10, duration: 60000 }
        },
        ...config?.queues
      },
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          settings: { factor: 2, delay: 2000 }
        },
        ...config?.defaultJobOptions
      }
    };
  }

  private initializeMetrics(): void {
    this.metrics = {
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      retriedJobs: 0,
      averageProcessingTime: 0,
      queueStats: {},
      lastUpdated: new Date()
    };
  }

  private initializeQueues(): void {
    const queueConfigs: Record<NotificationJobType, QueueConfig> = {
      'SEND_IMMEDIATE': {
        name: this.config.queues.immediate.name,
        concurrency: this.config.queues.immediate.concurrency,
        priority: 1,
        rateLimiter: this.config.queues.immediate.rateLimiter,
        defaultJobOptions: { ...this.config.defaultJobOptions, priority: 1 }
      },
      'SEND_SCHEDULED': {
        name: this.config.queues.scheduled.name,
        concurrency: this.config.queues.scheduled.concurrency,
        priority: 2,
        rateLimiter: this.config.queues.scheduled.rateLimiter,
        defaultJobOptions: { ...this.config.defaultJobOptions, priority: 2 }
      },
      'SEND_BULK': {
        name: this.config.queues.bulk.name,
        concurrency: this.config.queues.bulk.concurrency,
        priority: 3,
        rateLimiter: this.config.queues.bulk.rateLimiter,
        defaultJobOptions: { ...this.config.defaultJobOptions, priority: 3 }
      },
      'RETRY_FAILED': {
        name: this.config.queues.retry.name,
        concurrency: this.config.queues.retry.concurrency,
        priority: 4,
        rateLimiter: this.config.queues.retry.rateLimiter,
        defaultJobOptions: { ...this.config.defaultJobOptions, priority: 4 }
      },
      'CLEANUP_EXPIRED': {
        name: 'notification:cleanup',
        concurrency: 1,
        priority: 10,
        defaultJobOptions: { ...this.config.defaultJobOptions, priority: 10 }
      },
      'PROCESS_WEBHOOK': {
        name: 'notification:webhook',
        concurrency: 5,
        priority: 5,
        defaultJobOptions: { ...this.config.defaultJobOptions, priority: 5 }
      },
      'DELIVERY_STATUS': {
        name: 'notification:delivery',
        concurrency: 10,
        priority: 6,
        defaultJobOptions: { ...this.config.defaultJobOptions, priority: 6 }
      }
    };

    // Create Bull queues
    for (const [jobType, config] of Object.entries(queueConfigs)) {
      const queue = new Bull(config.name, {
        redis: this.config.redis,
        defaultJobOptions: config.defaultJobOptions,
        settings: {
          stalledInterval: 30000,
          maxStalledCount: 1,
          retryDelayOnFailure: 5000
        }
      });

      // Set rate limiter if configured
      if (config.rateLimiter) {
        queue.on('error', (error) => {
          logger.error(`Queue ${config.name} error`, { error });
        });
      }

      this.queues.set(jobType as NotificationJobType, queue);
    }

    logger.debug('Notification queues initialized', {
      queues: Array.from(this.queues.keys())
    });
  }

  private setupEventHandlers(): void {
    // Global event handlers for all queues
    for (const [jobType, queue] of this.queues) {
      queue.on('completed', (job: Job, result: JobResult) => {
        this.metrics.completedJobs++;
        this.updateAverageProcessingTime(Date.now() - job.timestamp);

        logger.debug('Job completed', {
          jobId: job.id,
          jobType,
          processingTime: Date.now() - job.timestamp,
          result
        });
      });

      queue.on('failed', (job: Job, error: Error) => {
        this.metrics.failedJobs++;

        logger.error('Job failed', {
          jobId: job.id,
          jobType,
          error: error.message,
          attempts: job.attemptsMade,
          data: job.data
        });

        // Handle retryable errors
        this.handleJobFailure(job, error, jobType);
      });

      queue.on('stalled', (job: Job) => {
        logger.warn('Job stalled', {
          jobId: job.id,
          jobType,
          data: job.data
        });
      });

      queue.on('progress', (job: Job, progress: any) => {
        logger.debug('Job progress', {
          jobId: job.id,
          jobType,
          progress
        });
      });

      queue.on('active', (job: Job) => {
        logger.debug('Job started', {
          jobId: job.id,
          jobType
        });
      });
    }
  }

  private async startQueueProcessing(jobType: NotificationJobType, queue: Queue): Promise<void> {
    const concurrency = this.getConcurrencyForJobType(jobType);

    switch (jobType) {
      case 'SEND_IMMEDIATE':
        queue.process('send-immediate', concurrency, this.processSendImmediate.bind(this));
        break;
      case 'SEND_SCHEDULED':
        queue.process('send-scheduled', concurrency, this.processSendScheduled.bind(this));
        break;
      case 'SEND_BULK':
        queue.process('send-bulk', concurrency, this.processSendBulk.bind(this));
        break;
      case 'RETRY_FAILED':
        queue.process('retry-failed', concurrency, this.processRetryFailed.bind(this));
        break;
      case 'CLEANUP_EXPIRED':
        queue.process('cleanup-expired', concurrency, this.processCleanupExpired.bind(this));
        break;
      case 'PROCESS_WEBHOOK':
        queue.process('process-webhook', concurrency, this.processWebhook.bind(this));
        break;
      case 'DELIVERY_STATUS':
        queue.process('delivery-status', concurrency, this.processDeliveryStatus.bind(this));
        break;
    }

    logger.debug('Started queue processing', {
      jobType,
      concurrency,
      queueName: queue.name
    });
  }

  // Job processors

  private async processSendImmediate(job: Job<SendImmediateJobData>): Promise<JobResult> {
    const { request, context, correlationId } = job.data;

    try {
      job.progress(10);

      const result = await this.notificationService.sendNotification(request, context);

      job.progress(90);

      return {
        success: true,
        notificationId: result.id,
        metadata: { correlationId }
      };

    } catch (error) {
      logger.error('Failed to process immediate notification', {
        jobId: job.id,
        tenantId: request.tenantId,
        templateType: request.templateType,
        error
      });

      return {
        success: false,
        error: error.message,
        retryable: this.isRetryableError(error)
      };
    }
  }

  private async processSendScheduled(job: Job<SendScheduledJobData>): Promise<JobResult> {
    const { notificationId, tenantId, context } = job.data;

    try {
      job.progress(10);

      // Get notification details
      const notification = await this.notificationService.getNotificationStatus(tenantId, notificationId);

      if (!notification) {
        throw new Error(`Notification ${notificationId} not found`);
      }

      if (notification.status !== 'PENDING') {
        logger.warn('Scheduled notification is not in pending status', {
          notificationId,
          status: notification.status
        });
        return { success: true, notificationId };
      }

      job.progress(50);

      // Process the scheduled notification
      // This would trigger the actual sending logic
      await this.processScheduledNotificationSend(notification, context);

      job.progress(100);

      return {
        success: true,
        notificationId
      };

    } catch (error) {
      logger.error('Failed to process scheduled notification', {
        jobId: job.id,
        notificationId,
        tenantId,
        error
      });

      return {
        success: false,
        error: error.message,
        retryable: this.isRetryableError(error)
      };
    }
  }

  private async processSendBulk(job: Job<SendBulkJobData>): Promise<JobResult> {
    const { request, batchId, context, batchSize = 100 } = job.data;

    try {
      job.progress(5);

      const result = await this.notificationService.sendBulkNotifications(request, context);

      job.progress(90);

      return {
        success: result.batchStatus === 'COMPLETED',
        processedCount: result.processedCount,
        metadata: {
          batchId,
          successCount: result.successCount,
          failedCount: result.failedCount
        }
      };

    } catch (error) {
      logger.error('Failed to process bulk notification', {
        jobId: job.id,
        batchId,
        tenantId: request.tenantId,
        error
      });

      return {
        success: false,
        error: error.message,
        retryable: this.isRetryableError(error)
      };
    }
  }

  private async processRetryFailed(job: Job<RetryFailedJobData>): Promise<JobResult> {
    const { notificationId, tenantId, retryAttempt, context } = job.data;

    try {
      job.progress(10);

      const result = await this.notificationService.retryNotification(
        tenantId,
        notificationId,
        context
      );

      job.progress(90);

      this.metrics.retriedJobs++;

      return {
        success: result.status === 'SENT' || result.status === 'DELIVERED',
        notificationId: result.id,
        metadata: { retryAttempt }
      };

    } catch (error) {
      logger.error('Failed to process retry', {
        jobId: job.id,
        notificationId,
        tenantId,
        retryAttempt,
        error
      });

      return {
        success: false,
        error: error.message,
        retryable: false // Don't retry retry jobs
      };
    }
  }

  private async processCleanupExpired(job: Job<CleanupExpiredJobData>): Promise<JobResult> {
    const { tenantId, olderThanHours, batchSize } = job.data;

    try {
      job.progress(10);

      const cutoffDate = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
      
      // Implementation would clean up expired notifications
      const cleanedCount = await this.cleanupExpiredNotifications(tenantId, cutoffDate, batchSize);

      job.progress(90);

      return {
        success: true,
        processedCount: cleanedCount,
        metadata: { cutoffDate }
      };

    } catch (error) {
      logger.error('Failed to process cleanup', {
        jobId: job.id,
        tenantId,
        olderThanHours,
        error
      });

      return {
        success: false,
        error: error.message,
        retryable: true
      };
    }
  }

  private async processWebhook(job: Job<WebhookJobData>): Promise<JobResult> {
    const { notificationId, tenantId, webhookData, webhookType } = job.data;

    try {
      job.progress(10);

      // Process webhook data based on type
      await this.handleWebhookData(notificationId, tenantId, webhookType, webhookData);

      job.progress(90);

      return {
        success: true,
        notificationId,
        metadata: { webhookType }
      };

    } catch (error) {
      logger.error('Failed to process webhook', {
        jobId: job.id,
        notificationId,
        tenantId,
        webhookType,
        error
      });

      return {
        success: false,
        error: error.message,
        retryable: this.isRetryableError(error)
      };
    }
  }

  private async processDeliveryStatus(job: Job<DeliveryStatusJobData>): Promise<JobResult> {
    const { notificationId, tenantId, externalId, status, deliveredAt, errorMessage } = job.data;

    try {
      job.progress(10);

      // Update notification status in database
      await this.updateNotificationDeliveryStatus(
        notificationId,
        tenantId,
        status,
        deliveredAt,
        errorMessage
      );

      job.progress(90);

      return {
        success: true,
        notificationId,
        metadata: { status, externalId }
      };

    } catch (error) {
      logger.error('Failed to process delivery status', {
        jobId: job.id,
        notificationId,
        tenantId,
        status,
        error
      });

      return {
        success: false,
        error: error.message,
        retryable: true
      };
    }
  }

  // Helper methods

  private getJobOptionsForPriority(priority: NotificationPriority): Partial<JobOptions> {
    const priorityMap = {
      'URGENT': { priority: 1, delay: 0 },
      'HIGH': { priority: 2, delay: 0 },
      'NORMAL': { priority: 5, delay: 1000 },
      'LOW': { priority: 10, delay: 5000 }
    };

    return priorityMap[priority] || priorityMap.NORMAL;
  }

  private calculateDelay(channel: NotificationChannel, priority: NotificationPriority): number {
    if (priority === 'URGENT') return 0;

    // Add slight delays for rate limiting
    const channelDelays = {
      'EMAIL': 100,
      'SMS': 1000,
      'PUSH': 50,
      'LINE': 500,
      'WEBHOOK': 200
    };

    return channelDelays[channel] || 100;
  }

  private calculateRetryDelay(retryAttempt: number): number {
    // Exponential backoff with jitter
    const baseDelay = 2000; // 2 seconds
    const maxDelay = 300000; // 5 minutes
    const exponentialDelay = baseDelay * Math.pow(2, retryAttempt);
    const jitter = Math.random() * 1000; // Add up to 1 second jitter
    
    return Math.min(exponentialDelay + jitter, maxDelay);
  }

  private getConcurrencyForJobType(jobType: NotificationJobType): number {
    const concurrencyMap = {
      'SEND_IMMEDIATE': this.config.queues.immediate.concurrency,
      'SEND_SCHEDULED': this.config.queues.scheduled.concurrency,
      'SEND_BULK': this.config.queues.bulk.concurrency,
      'RETRY_FAILED': this.config.queues.retry.concurrency,
      'CLEANUP_EXPIRED': 1,
      'PROCESS_WEBHOOK': 5,
      'DELIVERY_STATUS': 10
    };

    return concurrencyMap[jobType] || 1;
  }

  private isRetryableError(error: any): boolean {
    // Determine if error is retryable based on type/message
    const retryablePatterns = [
      /network/i,
      /timeout/i,
      /rate limit/i,
      /temporary/i,
      /service unavailable/i,
      /502/,
      /503/,
      /504/
    ];

    const errorMessage = error.message || error.toString();
    return retryablePatterns.some(pattern => pattern.test(errorMessage));
  }

  private async handleJobFailure(job: Job, error: Error, jobType: NotificationJobType): Promise<void> {
    // Custom failure handling logic
    if (job.attemptsMade >= job.opts.attempts) {
      logger.error('Job exceeded maximum attempts', {
        jobId: job.id,
        jobType,
        attempts: job.attemptsMade,
        error: error.message
      });

      // Handle permanent failure
      await this.handlePermanentFailure(job, error, jobType);
    }
  }

  private async handlePermanentFailure(job: Job, error: Error, jobType: NotificationJobType): Promise<void> {
    // Mark notification as permanently failed, send alerts, etc.
    logger.error('Permanent job failure', {
      jobId: job.id,
      jobType,
      error: error.message,
      data: job.data
    });
  }

  private updateAverageProcessingTime(processingTime: number): void {
    const totalTime = (this.metrics.averageProcessingTime * this.metrics.completedJobs) + processingTime;
    this.metrics.averageProcessingTime = totalTime / (this.metrics.completedJobs + 1);
  }

  private async updateQueueStats(): Promise<void> {
    for (const [jobType, queue] of this.queues) {
      const counts = await queue.getJobCounts();
      this.metrics.queueStats[jobType] = {
        waiting: counts.waiting,
        active: counts.active,
        completed: counts.completed,
        failed: counts.failed,
        delayed: counts.delayed
      };
    }
    this.metrics.lastUpdated = new Date();
  }

  private async scheduleRecurringJobs(): Promise<void> {
    // Schedule cleanup job every hour
    const cleanupQueue = this.queues.get('CLEANUP_EXPIRED');
    if (cleanupQueue) {
      await cleanupQueue.add(
        'cleanup-expired',
        { olderThanHours: 24, batchSize: 1000 },
        { repeat: { cron: '0 * * * *' } }
      );
    }

    logger.debug('Scheduled recurring jobs');
  }

  private startMonitoring(): void {
    // Update metrics every 30 seconds
    setInterval(async () => {
      try {
        await this.updateQueueStats();
      } catch (error) {
        logger.error('Failed to update queue stats', { error });
      }
    }, 30000);

    // Log metrics every 5 minutes
    setInterval(() => {
      logger.info('Worker metrics', this.metrics);
    }, 300000);
  }

  // Placeholder implementations for complex operations
  private async processScheduledNotificationSend(notification: NotificationResponse, context: TenantContext): Promise<void> {
    // Implementation would trigger the actual sending
  }

  private async cleanupExpiredNotifications(tenantId: string | undefined, cutoffDate: Date, batchSize: number): Promise<number> {
    // Implementation would clean up expired notifications
    return 0;
  }

  private async handleWebhookData(notificationId: string, tenantId: string, webhookType: string, webhookData: any): Promise<void> {
    // Implementation would process webhook callbacks
  }

  private async updateNotificationDeliveryStatus(
    notificationId: string,
    tenantId: string,
    status: NotificationStatus,
    deliveredAt?: Date,
    errorMessage?: string
  ): Promise<void> {
    // Implementation would update notification status
  }
}

export default NotificationWorker;