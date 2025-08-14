/**
 * Notification Service
 * Comprehensive notification system supporting multiple channels with
 * template management, scheduling, retry logic, rate limiting, and audit trails
 */

import { FastifyInstance } from 'fastify';
import { 
  NotificationRequest,
  NotificationResponse,
  BulkNotificationRequest,
  BulkNotificationResponse,
  NotificationTemplate,
  NotificationTemplateType,
  NotificationChannel,
  NotificationStatus,
  NotificationPriority,
  NotificationLanguage,
  NotificationVariables,
  NotificationDeliveryResult,
  NotificationStatistics,
  NotificationPreferences,
  NotificationProviderConfig,
  NotificationQueueConfig,
  MultiLangTemplateContent
} from '../types/notification.js';
import { TenantContext } from '../types/database.js';
import { logger } from '../config/logger.js';
import { withTransaction, TransactionContext } from '../db/transaction.js';
import { CacheService } from './cache.service.js';
import { 
  InternalServerError, 
  BadRequestError, 
  NotFoundError,
  ValidationError 
} from '../utils/errors.js';

/**
 * Email provider interfaces
 */
interface EmailProvider {
  send(params: EmailSendParams): Promise<NotificationDeliveryResult>;
  verifyConfiguration(): Promise<boolean>;
}

interface EmailSendParams {
  to: string;
  from: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType: string;
  }>;
}

/**
 * SMS provider interfaces
 */
interface SmsProvider {
  send(params: SmsSendParams): Promise<NotificationDeliveryResult>;
  verifyConfiguration(): Promise<boolean>;
}

interface SmsSendParams {
  to: string;
  from: string;
  message: string;
  messageType?: 'text' | 'unicode';
}

/**
 * Push notification provider interfaces
 */
interface PushProvider {
  send(params: PushSendParams): Promise<NotificationDeliveryResult>;
  verifyConfiguration(): Promise<boolean>;
}

interface PushSendParams {
  deviceTokens: string[];
  title?: string;
  body: string;
  data?: Record<string, any>;
  badge?: number;
  sound?: string;
  priority?: 'normal' | 'high';
  ttl?: number;
}

/**
 * LINE provider interfaces
 */
interface LineProvider {
  send(params: LineSendParams): Promise<NotificationDeliveryResult>;
  verifyConfiguration(): Promise<boolean>;
}

interface LineSendParams {
  to: string;
  message: string;
  messageType?: 'text' | 'sticker' | 'template';
  altText?: string;
}

/**
 * Template rendering result
 */
interface RenderedTemplate {
  subject?: string;
  title?: string;
  body: string;
  htmlBody?: string;
  smsBody?: string;
  pushBody?: string;
  lineBody?: string;
}

/**
 * Rate limiting result
 */
interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number;
  remaining?: number;
  resetAt?: Date;
}

/**
 * Notification service configuration
 */
interface NotificationServiceConfig {
  providers: NotificationProviderConfig;
  queue: NotificationQueueConfig;
  templates: {
    cacheTTL: number;
    defaultLanguage: NotificationLanguage;
    variablePrefix: string;
    variableSuffix: string;
  };
  rateLimiting: {
    enabled: boolean;
    perTenant: {
      perMinute: number;
      perHour: number;
      perDay: number;
    };
    perChannel: Record<NotificationChannel, {
      perSecond: number;
      perMinute: number;
      perHour: number;
    }>;
  };
  retry: {
    maxRetries: number;
    backoffStrategy: 'FIXED' | 'LINEAR' | 'EXPONENTIAL';
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
  };
  monitoring: {
    enableMetrics: boolean;
    slowDeliveryThresholdMs: number;
    enableDeliveryTracking: boolean;
  };
}

/**
 * Main notification service
 */
export class NotificationService {
  private cache: CacheService;
  private config: NotificationServiceConfig;
  private templates: Map<string, NotificationTemplate> = new Map();
  private emailProviders: Map<string, EmailProvider> = new Map();
  private smsProviders: Map<string, SmsProvider> = new Map();
  private pushProviders: Map<string, PushProvider> = new Map();
  private lineProviders: Map<string, LineProvider> = new Map();

  // Rate limiting tracking
  private rateLimitCounters: Map<string, {
    count: number;
    resetAt: number;
    window: number;
  }> = new Map();

  // Performance metrics
  private metrics: {
    totalNotifications: number;
    successfulDeliveries: number;
    failedDeliveries: number;
    averageDeliveryTime: number;
    channelStats: Record<NotificationChannel, {
      total: number;
      successful: number;
      failed: number;
      averageTime: number;
    }>;
    lastReset: Date;
  } = {
    totalNotifications: 0,
    successfulDeliveries: 0,
    failedDeliveries: 0,
    averageDeliveryTime: 0,
    channelStats: {
      EMAIL: { total: 0, successful: 0, failed: 0, averageTime: 0 },
      SMS: { total: 0, successful: 0, failed: 0, averageTime: 0 },
      PUSH: { total: 0, successful: 0, failed: 0, averageTime: 0 },
      LINE: { total: 0, successful: 0, failed: 0, averageTime: 0 },
      WEBHOOK: { total: 0, successful: 0, failed: 0, averageTime: 0 }
    },
    lastReset: new Date()
  };

  constructor(private fastify: FastifyInstance) {
    this.cache = new CacheService(fastify, {
      defaultTTL: 3600, // 1 hour
      memory: {
        enabled: true,
        maxSize: 64 * 1024 * 1024, // 64MB
        maxItems: 10000,
        ttlRatio: 0.5
      }
    });

    this.config = this.loadConfiguration();
    this.initializeProviders();
    this.startBackgroundTasks();
  }

  /**
   * Send a single notification
   */
  async sendNotification(
    request: NotificationRequest,
    context: TenantContext
  ): Promise<NotificationResponse> {
    const startTime = Date.now();

    try {
      logger.info('Sending notification', {
        tenantId: request.tenantId,
        templateType: request.templateType,
        channel: request.channel,
        recipientId: request.recipient.id,
        priority: request.priority,
        correlationId: request.correlationId
      });

      // Validate request
      await this.validateNotificationRequest(request);

      // Check rate limits
      if (this.config.rateLimiting.enabled) {
        const rateLimitResult = await this.checkRateLimit(
          request.tenantId,
          request.channel,
          request.priority
        );

        if (!rateLimitResult.allowed) {
          throw new BadRequestError(
            `Rate limit exceeded. Retry after ${rateLimitResult.retryAfter} seconds`
          );
        }
      }

      // Check for duplicate (idempotency)
      if (request.idempotencyKey) {
        const existing = await this.findNotificationByIdempotencyKey(
          request.tenantId,
          request.idempotencyKey
        );

        if (existing) {
          logger.info('Returning existing notification for idempotency key', {
            notificationId: existing.id,
            idempotencyKey: request.idempotencyKey
          });
          return existing;
        }
      }

      // Get or create notification template
      const template = await this.getNotificationTemplate(
        request.tenantId,
        request.templateType,
        request.templateId
      );

      // Render template with variables
      const rendered = await this.renderTemplate(
        template,
        request.variables,
        request.recipient.language || 'ja'
      );

      // Create notification record
      const notification = await this.createNotificationRecord(
        request,
        rendered,
        context
      );

      // Handle immediate vs scheduled delivery
      if (request.schedule?.sendAt && request.schedule.sendAt > new Date()) {
        await this.scheduleNotification(notification, request.schedule.sendAt);
        logger.info('Notification scheduled', {
          notificationId: notification.id,
          scheduledAt: request.schedule.sendAt
        });
      } else {
        // Send immediately
        await this.deliverNotification(notification, rendered, context);
      }

      // Record metrics
      this.recordMetrics(request.channel, startTime, true);

      logger.info('Notification processed successfully', {
        notificationId: notification.id,
        tenantId: request.tenantId,
        channel: request.channel,
        status: notification.status,
        duration: Date.now() - startTime
      });

      return notification;

    } catch (error) {
      this.recordMetrics(request.channel, startTime, false);

      logger.error('Failed to send notification', {
        tenantId: request.tenantId,
        templateType: request.templateType,
        channel: request.channel,
        error,
        correlationId: request.correlationId
      });

      throw error;
    }
  }

  /**
   * Send bulk notifications
   */
  async sendBulkNotifications(
    request: BulkNotificationRequest,
    context: TenantContext
  ): Promise<BulkNotificationResponse> {
    const startTime = Date.now();

    try {
      logger.info('Starting bulk notification send', {
        tenantId: request.tenantId,
        templateType: request.templateType,
        channel: request.channel,
        recipientCount: request.recipients.length,
        correlationId: request.correlationId
      });

      // Validate bulk request
      await this.validateBulkNotificationRequest(request);

      // Create batch record
      const batchId = await this.createNotificationBatch(request, context);

      // Get template
      const template = await this.getNotificationTemplate(
        request.tenantId,
        request.templateType,
        request.templateId
      );

      const notifications: NotificationResponse[] = [];
      let successCount = 0;
      let failedCount = 0;

      // Process in batches to manage memory and rate limits
      const batchSize = request.batchConfig?.batchSize || 100;
      const intervalMs = request.batchConfig?.intervalMs || 1000;

      for (let i = 0; i < request.recipients.length; i += batchSize) {
        const batch = request.recipients.slice(i, i + batchSize);

        for (const recipient of batch) {
          try {
            // Combine shared and recipient-specific variables
            const variables = {
              ...request.sharedVariables,
              ...request.recipientVariables?.[recipient.id]
            };

            // Create individual notification request
            const individualRequest: NotificationRequest = {
              tenantId: request.tenantId,
              templateType: request.templateType,
              templateId: request.templateId,
              channel: request.channel,
              recipient,
              variables,
              priority: request.priority,
              schedule: request.schedule,
              channelConfig: request.channelConfig,
              retryConfig: request.retryConfig,
              tags: request.tags,
              correlationId: request.correlationId,
              metadata: {
                ...request.metadata,
                batchId,
                batchIndex: i + batch.indexOf(recipient)
              }
            };

            const notification = await this.sendNotification(individualRequest, context);
            notifications.push(notification);

            if (notification.status === 'SENT' || notification.status === 'DELIVERED') {
              successCount++;
            } else {
              failedCount++;
            }

          } catch (error) {
            failedCount++;
            logger.error('Failed to send notification in batch', {
              recipientId: recipient.id,
              batchId,
              error
            });
          }
        }

        // Delay between batches to respect rate limits
        if (i + batchSize < request.recipients.length) {
          await this.delay(intervalMs);
        }
      }

      // Update batch status
      await this.updateNotificationBatchStatus(
        batchId,
        'COMPLETED',
        notifications.length,
        successCount,
        failedCount
      );

      const response: BulkNotificationResponse = {
        id: batchId,
        tenantId: request.tenantId,
        totalRecipients: request.recipients.length,
        processedCount: notifications.length,
        successCount,
        failedCount,
        pendingCount: notifications.filter(n => n.status === 'PENDING').length,
        notifications,
        batchStatus: 'COMPLETED',
        startedAt: new Date(startTime),
        completedAt: new Date(),
        correlationId: request.correlationId,
        metadata: request.metadata
      };

      logger.info('Bulk notification completed', {
        batchId,
        tenantId: request.tenantId,
        totalRecipients: request.recipients.length,
        successCount,
        failedCount,
        duration: Date.now() - startTime
      });

      return response;

    } catch (error) {
      logger.error('Failed to send bulk notifications', {
        tenantId: request.tenantId,
        templateType: request.templateType,
        error,
        correlationId: request.correlationId
      });

      throw error;
    }
  }

  /**
   * Get notification status
   */
  async getNotificationStatus(
    tenantId: string,
    notificationId: string
  ): Promise<NotificationResponse | null> {
    try {
      const cacheKey = `notification_status:${tenantId}:${notificationId}`;
      const cached = await this.cache.get<NotificationResponse>(cacheKey);

      if (cached) {
        return cached;
      }

      const result = await this.fastify.db.queryForTenant(
        tenantId,
        `
        SELECT * FROM notifications 
        WHERE id = $1 AND tenant_id = $2
        `,
        [notificationId, tenantId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const notification = this.mapToNotificationResponse(result.rows[0]);

      // Cache for 5 minutes
      await this.cache.set(cacheKey, notification, 300);

      return notification;

    } catch (error) {
      logger.error('Failed to get notification status', {
        tenantId,
        notificationId,
        error
      });
      throw new InternalServerError('Failed to get notification status');
    }
  }

  /**
   * Retry failed notification
   */
  async retryNotification(
    tenantId: string,
    notificationId: string,
    context: TenantContext
  ): Promise<NotificationResponse> {
    return withTransaction(async (ctx) => {
      try {
        const notification = await this.getNotificationForRetry(
          tenantId,
          notificationId,
          ctx
        );

        if (!notification) {
          throw new NotFoundError(`Notification ${notificationId} not found`);
        }

        if (notification.status !== 'FAILED') {
          throw new BadRequestError('Only failed notifications can be retried');
        }

        if (notification.retryCount >= (notification.retryConfig?.maxRetries || this.config.retry.maxRetries)) {
          throw new BadRequestError('Maximum retry attempts exceeded');
        }

        // Get template and render
        const template = await this.getNotificationTemplate(
          tenantId,
          notification.templateType,
          notification.templateId
        );

        const rendered = await this.renderTemplate(
          template,
          notification.variables,
          notification.recipient.language || 'ja'
        );

        // Attempt delivery
        await this.deliverNotification(notification, rendered, context, ctx);

        logger.info('Notification retry completed', {
          notificationId,
          tenantId,
          retryCount: notification.retryCount + 1,
          status: notification.status
        });

        return notification;

      } catch (error) {
        logger.error('Failed to retry notification', {
          tenantId,
          notificationId,
          error
        });
        throw error;
      }
    });
  }

  /**
   * Get notification statistics
   */
  async getNotificationStatistics(
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<NotificationStatistics> {
    try {
      const cacheKey = `notification_stats:${tenantId}:${startDate.getTime()}:${endDate.getTime()}`;
      const cached = await this.cache.get<NotificationStatistics>(cacheKey);

      if (cached) {
        return cached;
      }

      // Channel statistics query
      const channelStatsQuery = `
        SELECT 
          channel,
          COUNT(*) as total,
          SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) as sent,
          SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END) as delivered,
          SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
          AVG(CASE WHEN delivered_at IS NOT NULL THEN EXTRACT(EPOCH FROM (delivered_at - created_at)) * 1000 ELSE NULL END) as avg_delivery_time
        FROM notifications 
        WHERE tenant_id = $1 
          AND created_at >= $2 
          AND created_at <= $3
        GROUP BY channel
      `;

      // Template statistics query
      const templateStatsQuery = `
        SELECT 
          template_type,
          COUNT(*) as total,
          SUM(CASE WHEN status IN ('SENT', 'DELIVERED') THEN 1 ELSE 0 END) as sent
        FROM notifications 
        WHERE tenant_id = $1 
          AND created_at >= $2 
          AND created_at <= $3
        GROUP BY template_type
      `;

      // Priority statistics query
      const priorityStatsQuery = `
        SELECT 
          priority,
          COUNT(*) as total,
          SUM(CASE WHEN status IN ('SENT', 'DELIVERED') THEN 1 ELSE 0 END) as sent,
          AVG(CASE WHEN sent_at IS NOT NULL THEN EXTRACT(EPOCH FROM (sent_at - created_at)) * 1000 ELSE NULL END) as avg_processing_time
        FROM notifications 
        WHERE tenant_id = $1 
          AND created_at >= $2 
          AND created_at <= $3
        GROUP BY priority
      `;

      // Peak hours query
      const peakHoursQuery = `
        SELECT 
          EXTRACT(HOUR FROM created_at) as hour,
          COUNT(*) as count
        FROM notifications 
        WHERE tenant_id = $1 
          AND created_at >= $2 
          AND created_at <= $3
        GROUP BY EXTRACT(HOUR FROM created_at)
        ORDER BY count DESC
        LIMIT 24
      `;

      const params = [tenantId, startDate, endDate];

      const [channelResults, templateResults, priorityResults, peakHoursResults] = await Promise.all([
        this.fastify.db.queryForTenant(tenantId, channelStatsQuery, params),
        this.fastify.db.queryForTenant(tenantId, templateStatsQuery, params),
        this.fastify.db.queryForTenant(tenantId, priorityStatsQuery, params),
        this.fastify.db.queryForTenant(tenantId, peakHoursQuery, params)
      ]);

      // Build statistics object
      const channelStats = {} as any;
      for (const row of channelResults.rows) {
        const deliveryRate = row.total > 0 ? (row.delivered / row.total) * 100 : 0;
        channelStats[row.channel] = {
          total: parseInt(row.total),
          sent: parseInt(row.sent),
          delivered: parseInt(row.delivered),
          failed: parseInt(row.failed),
          deliveryRate,
          averageDeliveryTime: parseFloat(row.avg_delivery_time) || 0
        };
      }

      const templateStats = {} as any;
      for (const row of templateResults.rows) {
        const deliveryRate = row.total > 0 ? (row.sent / row.total) * 100 : 0;
        templateStats[row.template_type] = {
          total: parseInt(row.total),
          sent: parseInt(row.sent),
          deliveryRate
        };
      }

      const priorityStats = {} as any;
      for (const row of priorityResults.rows) {
        priorityStats[row.priority] = {
          total: parseInt(row.total),
          sent: parseInt(row.sent),
          averageProcessingTime: parseFloat(row.avg_processing_time) || 0
        };
      }

      const peakHours = peakHoursResults.rows.map(row => ({
        hour: parseInt(row.hour),
        count: parseInt(row.count)
      }));

      const statistics: NotificationStatistics = {
        tenantId,
        period: { startDate, endDate },
        channelStats,
        templateStats,
        priorityStats,
        totalCost: 0, // TODO: Implement cost tracking
        peakHours
      };

      // Cache for 30 minutes
      await this.cache.set(cacheKey, statistics, 1800);

      return statistics;

    } catch (error) {
      logger.error('Failed to get notification statistics', {
        tenantId,
        startDate,
        endDate,
        error
      });
      throw new InternalServerError('Failed to get notification statistics');
    }
  }

  /**
   * Update user notification preferences
   */
  async updateUserPreferences(
    tenantId: string,
    userId: string,
    preferences: Partial<NotificationPreferences>,
    context: TenantContext
  ): Promise<NotificationPreferences> {
    return withTransaction(async (ctx) => {
      try {
        // Get current preferences
        const currentPrefs = await this.getUserPreferences(tenantId, userId, ctx);

        // Merge with updates
        const updatedPrefs: NotificationPreferences = {
          ...currentPrefs,
          ...preferences,
          userId,
          tenantId,
          updatedAt: new Date()
        };

        // Save to database
        await ctx.queryForTenant(
          tenantId,
          `
          INSERT INTO user_notification_preferences (user_id, tenant_id, preferences, updated_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (user_id, tenant_id) 
          DO UPDATE SET preferences = $3, updated_at = $4
          `,
          [userId, tenantId, JSON.stringify(updatedPrefs), updatedPrefs.updatedAt]
        );

        // Clear cache
        const cacheKey = `user_preferences:${tenantId}:${userId}`;
        await this.cache.delete(cacheKey);

        logger.info('User notification preferences updated', {
          tenantId,
          userId
        });

        return updatedPrefs;

      } catch (error) {
        logger.error('Failed to update user notification preferences', {
          tenantId,
          userId,
          error
        });
        throw new InternalServerError('Failed to update notification preferences');
      }
    });
  }

  // Private helper methods

  private loadConfiguration(): NotificationServiceConfig {
    return {
      providers: {
        email: {
          provider: 'SENDGRID',
          apiKey: process.env.SENDGRID_API_KEY || '',
          fromAddress: process.env.NOTIFICATION_FROM_EMAIL || 'noreply@example.com',
          fromName: process.env.NOTIFICATION_FROM_NAME || 'Booking System'
        },
        sms: {
          provider: 'TWILIO',
          accountSid: process.env.TWILIO_ACCOUNT_SID || '',
          authToken: process.env.TWILIO_AUTH_TOKEN || '',
          fromNumber: process.env.TWILIO_FROM_NUMBER || ''
        },
        push: {
          provider: 'FCM',
          apiKey: process.env.FCM_SERVER_KEY || '',
          production: process.env.NODE_ENV === 'production'
        },
        line: {
          channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
          channelSecret: process.env.LINE_CHANNEL_SECRET || ''
        }
      },
      queue: {
        redis: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          db: parseInt(process.env.REDIS_DB || '0'),
          keyPrefix: 'notifications:'
        },
        queues: {
          immediate: { name: 'immediate', concurrency: 10 },
          scheduled: { name: 'scheduled', concurrency: 5 },
          retry: { name: 'retry', concurrency: 3 },
          bulk: { name: 'bulk', concurrency: 2 }
        },
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 50,
          attempts: 3,
          backoff: {
            type: 'exponential',
            settings: { factor: 2, delay: 2000 }
          }
        }
      },
      templates: {
        cacheTTL: 3600,
        defaultLanguage: 'ja',
        variablePrefix: '{{',
        variableSuffix: '}}'
      },
      rateLimiting: {
        enabled: true,
        perTenant: {
          perMinute: 100,
          perHour: 1000,
          perDay: 10000
        },
        perChannel: {
          EMAIL: { perSecond: 5, perMinute: 100, perHour: 1000 },
          SMS: { perSecond: 1, perMinute: 10, perHour: 100 },
          PUSH: { perSecond: 10, perMinute: 500, perHour: 5000 },
          LINE: { perSecond: 2, perMinute: 50, perHour: 500 },
          WEBHOOK: { perSecond: 3, perMinute: 100, perHour: 1000 }
        }
      },
      retry: {
        maxRetries: 3,
        backoffStrategy: 'EXPONENTIAL',
        initialDelayMs: 1000,
        maxDelayMs: 300000,
        backoffMultiplier: 2
      },
      monitoring: {
        enableMetrics: true,
        slowDeliveryThresholdMs: 5000,
        enableDeliveryTracking: true
      }
    };
  }

  private initializeProviders(): void {
    // Initialize email providers
    if (this.config.providers.email) {
      // Implementation would initialize actual providers
      logger.info('Email provider initialized', {
        provider: this.config.providers.email.provider
      });
    }

    // Initialize other providers...
    logger.info('Notification providers initialized');
  }

  private async validateNotificationRequest(request: NotificationRequest): Promise<void> {
    if (!request.tenantId) {
      throw new BadRequestError('Tenant ID is required');
    }

    if (!request.recipient.id) {
      throw new BadRequestError('Recipient ID is required');
    }

    if (!request.templateType) {
      throw new BadRequestError('Template type is required');
    }

    if (!request.variables) {
      request.variables = {};
    }

    // Validate channel-specific requirements
    switch (request.channel) {
      case 'EMAIL':
        if (!request.recipient.email) {
          throw new BadRequestError('Email address is required for email notifications');
        }
        break;
      case 'SMS':
        if (!request.recipient.phone) {
          throw new BadRequestError('Phone number is required for SMS notifications');
        }
        break;
      case 'PUSH':
        if (!request.recipient.deviceTokens || request.recipient.deviceTokens.length === 0) {
          throw new BadRequestError('Device tokens are required for push notifications');
        }
        break;
      case 'LINE':
        if (!request.recipient.lineUserId) {
          throw new BadRequestError('LINE user ID is required for LINE notifications');
        }
        break;
    }
  }

  private async validateBulkNotificationRequest(request: BulkNotificationRequest): Promise<void> {
    if (!request.recipients || request.recipients.length === 0) {
      throw new BadRequestError('Recipients list cannot be empty');
    }

    if (request.recipients.length > 10000) {
      throw new BadRequestError('Maximum 10,000 recipients per bulk request');
    }

    for (const recipient of request.recipients) {
      // Basic validation for each recipient
      if (!recipient.id) {
        throw new BadRequestError('All recipients must have an ID');
      }
    }
  }

  private async getNotificationTemplate(
    tenantId: string,
    templateType: NotificationTemplateType,
    templateId?: string
  ): Promise<NotificationTemplate> {
    const cacheKey = templateId 
      ? `template:${tenantId}:${templateId}`
      : `template:${tenantId}:${templateType}`;

    let template = await this.cache.get<NotificationTemplate>(cacheKey);

    if (!template) {
      const query = templateId
        ? 'SELECT * FROM notification_templates WHERE id = $1 AND tenant_id = $2 AND is_active = true'
        : 'SELECT * FROM notification_templates WHERE type = $1 AND tenant_id = $2 AND is_active = true ORDER BY version DESC LIMIT 1';

      const params = templateId ? [templateId, tenantId] : [templateType, tenantId];
      
      const result = await this.fastify.db.queryForTenant(tenantId, query, params);

      if (result.rows.length === 0) {
        // Try to get default template
        const defaultTemplate = await this.getDefaultTemplate(templateType);
        if (!defaultTemplate) {
          throw new NotFoundError(`Template not found: ${templateType}`);
        }
        template = defaultTemplate;
      } else {
        template = this.mapToNotificationTemplate(result.rows[0]);
      }

      await this.cache.set(cacheKey, template, this.config.templates.cacheTTL);
    }

    return template;
  }

  private async renderTemplate(
    template: NotificationTemplate,
    variables: NotificationVariables,
    language: NotificationLanguage
  ): Promise<RenderedTemplate> {
    try {
      const content = template.content[language] || 
                    template.content[this.config.templates.defaultLanguage] ||
                    template.content.default;

      if (!content) {
        throw new Error(`No content found for language: ${language}`);
      }

      const rendered: RenderedTemplate = {
        subject: content.subject ? this.replaceVariables(content.subject, variables) : undefined,
        title: content.title ? this.replaceVariables(content.title, variables) : undefined,
        body: this.replaceVariables(content.body, variables),
        htmlBody: content.htmlBody ? this.replaceVariables(content.htmlBody, variables) : undefined,
        smsBody: content.smsBody ? this.replaceVariables(content.smsBody, variables) : undefined,
        pushBody: content.pushBody ? this.replaceVariables(content.pushBody, variables) : undefined,
        lineBody: content.lineBody ? this.replaceVariables(content.lineBody, variables) : undefined
      };

      return rendered;

    } catch (error) {
      logger.error('Failed to render template', {
        templateId: template.id,
        templateType: template.type,
        language,
        error
      });
      throw new InternalServerError('Failed to render notification template');
    }
  }

  private replaceVariables(content: string, variables: NotificationVariables): string {
    let result = content;
    
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `${this.config.templates.variablePrefix}${key}${this.config.templates.variableSuffix}`;
      const stringValue = value !== null && value !== undefined ? String(value) : '';
      result = result.replace(new RegExp(placeholder, 'g'), stringValue);
    }
    
    return result;
  }

  private async createNotificationRecord(
    request: NotificationRequest,
    rendered: RenderedTemplate,
    context: TenantContext
  ): Promise<NotificationResponse> {
    return withTransaction(async (ctx) => {
      const notificationData = {
        tenant_id: request.tenantId,
        template_type: request.templateType,
        template_id: request.templateId,
        channel: request.channel,
        status: 'PENDING' as NotificationStatus,
        priority: request.priority,
        recipient_id: request.recipient.id,
        recipient_data: JSON.stringify(request.recipient),
        variables: JSON.stringify(request.variables),
        channel_config: request.channelConfig ? JSON.stringify(request.channelConfig) : null,
        retry_config: JSON.stringify(request.retryConfig || this.config.retry),
        scheduled_at: request.schedule?.sendAt || null,
        expires_at: this.calculateExpirationTime(request),
        retry_count: 0,
        tags: JSON.stringify(request.tags || []),
        correlation_id: request.correlationId,
        idempotency_key: request.idempotencyKey,
        metadata: request.metadata ? JSON.stringify(request.metadata) : null,
        created_at: new Date(),
        updated_at: new Date(),
        created_by: context.userId,
        updated_by: context.userId
      };

      const result = await ctx.queryForTenant(
        request.tenantId,
        `
        INSERT INTO notifications (${Object.keys(notificationData).join(', ')})
        VALUES (${Object.keys(notificationData).map((_, i) => `$${i + 1}`).join(', ')})
        RETURNING *
        `,
        Object.values(notificationData)
      );

      return this.mapToNotificationResponse(result.rows[0]);
    });
  }

  private async deliverNotification(
    notification: NotificationResponse,
    rendered: RenderedTemplate,
    context: TenantContext,
    ctx?: TransactionContext
  ): Promise<void> {
    try {
      // Update status to SENDING
      await this.updateNotificationStatus(
        notification.tenantId,
        notification.id,
        'SENDING',
        ctx
      );

      // Deliver via appropriate channel
      let result: NotificationDeliveryResult;

      switch (notification.channel) {
        case 'EMAIL':
          result = await this.deliverEmail(notification, rendered);
          break;
        case 'SMS':
          result = await this.deliverSms(notification, rendered);
          break;
        case 'PUSH':
          result = await this.deliverPush(notification, rendered);
          break;
        case 'LINE':
          result = await this.deliverLine(notification, rendered);
          break;
        case 'WEBHOOK':
          result = await this.deliverWebhook(notification, rendered);
          break;
        default:
          throw new Error(`Unsupported channel: ${notification.channel}`);
      }

      // Update notification with delivery result
      const finalStatus: NotificationStatus = result.success ? 'SENT' : 'FAILED';
      await this.updateNotificationWithDeliveryResult(
        notification.tenantId,
        notification.id,
        finalStatus,
        result,
        ctx
      );

    } catch (error) {
      logger.error('Failed to deliver notification', {
        notificationId: notification.id,
        tenantId: notification.tenantId,
        channel: notification.channel,
        error
      });

      await this.updateNotificationStatus(
        notification.tenantId,
        notification.id,
        'FAILED',
        ctx
      );

      // Schedule retry if configured
      await this.scheduleRetryIfNeeded(notification, error.message, ctx);
    }
  }

  // Channel-specific delivery methods (simplified implementations)
  private async deliverEmail(
    notification: NotificationResponse,
    rendered: RenderedTemplate
  ): Promise<NotificationDeliveryResult> {
    // This would use the actual email provider
    return {
      success: true,
      messageId: `email_${Date.now()}`,
      deliveredAt: new Date()
    };
  }

  private async deliverSms(
    notification: NotificationResponse,
    rendered: RenderedTemplate
  ): Promise<NotificationDeliveryResult> {
    // This would use the actual SMS provider
    return {
      success: true,
      messageId: `sms_${Date.now()}`,
      deliveredAt: new Date()
    };
  }

  private async deliverPush(
    notification: NotificationResponse,
    rendered: RenderedTemplate
  ): Promise<NotificationDeliveryResult> {
    // This would use the actual push notification provider
    return {
      success: true,
      messageId: `push_${Date.now()}`,
      deliveredAt: new Date()
    };
  }

  private async deliverLine(
    notification: NotificationResponse,
    rendered: RenderedTemplate
  ): Promise<NotificationDeliveryResult> {
    // This would use the actual LINE provider
    return {
      success: true,
      messageId: `line_${Date.now()}`,
      deliveredAt: new Date()
    };
  }

  private async deliverWebhook(
    notification: NotificationResponse,
    rendered: RenderedTemplate
  ): Promise<NotificationDeliveryResult> {
    // This would make HTTP requests to webhook URLs
    return {
      success: true,
      messageId: `webhook_${Date.now()}`,
      deliveredAt: new Date()
    };
  }

  // Helper methods continued...
  private async checkRateLimit(
    tenantId: string,
    channel: NotificationChannel,
    priority: NotificationPriority
  ): Promise<RateLimitResult> {
    // Simplified rate limiting implementation
    return { allowed: true };
  }

  private calculateExpirationTime(request: NotificationRequest): Date | null {
    // Calculate when the notification should expire
    const now = new Date();
    const defaultExpirationHours = 24;
    return new Date(now.getTime() + defaultExpirationHours * 60 * 60 * 1000);
  }

  private recordMetrics(channel: NotificationChannel, startTime: number, success: boolean): void {
    const duration = Date.now() - startTime;
    
    this.metrics.totalNotifications++;
    
    if (success) {
      this.metrics.successfulDeliveries++;
    } else {
      this.metrics.failedDeliveries++;
    }

    this.metrics.channelStats[channel].total++;
    if (success) {
      this.metrics.channelStats[channel].successful++;
    } else {
      this.metrics.channelStats[channel].failed++;
    }

    // Update average delivery time
    const channelStats = this.metrics.channelStats[channel];
    channelStats.averageTime = ((channelStats.averageTime * (channelStats.total - 1)) + duration) / channelStats.total;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private startBackgroundTasks(): void {
    // Start periodic tasks for cleanup, metrics, etc.
    setInterval(() => {
      this.cleanupExpiredNotifications().catch(error => {
        logger.error('Failed to cleanup expired notifications', { error });
      });
    }, 60000); // Every minute

    setInterval(() => {
      this.processRetries().catch(error => {
        logger.error('Failed to process retries', { error });
      });
    }, 30000); // Every 30 seconds
  }

  private async cleanupExpiredNotifications(): Promise<void> {
    // Implementation for cleaning up expired notifications
  }

  private async processRetries(): Promise<void> {
    // Implementation for processing retry queue
  }

  // Additional helper methods would be implemented here...
  private async findNotificationByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<NotificationResponse | null> {
    // Implementation
    return null;
  }

  private async scheduleNotification(notification: NotificationResponse, sendAt: Date): Promise<void> {
    // Implementation
  }

  private async createNotificationBatch(request: BulkNotificationRequest, context: TenantContext): Promise<string> {
    // Implementation
    return `batch_${Date.now()}`;
  }

  private async updateNotificationBatchStatus(batchId: string, status: string, processed: number, success: number, failed: number): Promise<void> {
    // Implementation
  }

  private async getNotificationForRetry(tenantId: string, notificationId: string, ctx: TransactionContext): Promise<any> {
    // Implementation
    return null;
  }

  private async updateNotificationStatus(tenantId: string, notificationId: string, status: NotificationStatus, ctx?: TransactionContext): Promise<void> {
    // Implementation
  }

  private async updateNotificationWithDeliveryResult(tenantId: string, notificationId: string, status: NotificationStatus, result: NotificationDeliveryResult, ctx?: TransactionContext): Promise<void> {
    // Implementation
  }

  private async scheduleRetryIfNeeded(notification: NotificationResponse, error: string, ctx?: TransactionContext): Promise<void> {
    // Implementation
  }

  private async getUserPreferences(tenantId: string, userId: string, ctx?: TransactionContext): Promise<NotificationPreferences> {
    // Implementation - return default preferences if not found
    return {
      userId,
      tenantId,
      channels: {
        email: { enabled: true, verified: false, types: [] },
        sms: { enabled: false, verified: false, types: [] },
        push: { enabled: false, deviceTokens: [], types: [] },
        line: { enabled: false, linked: false, types: [] }
      },
      language: 'ja',
      timezone: 'Asia/Tokyo',
      frequency: {
        immediate: [],
        daily: [],
        weekly: [],
        never: []
      },
      updatedAt: new Date()
    };
  }

  private async getDefaultTemplate(templateType: NotificationTemplateType): Promise<NotificationTemplate | null> {
    // Implementation - return hardcoded default templates
    return null;
  }

  private mapToNotificationTemplate(row: any): NotificationTemplate {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      type: row.type,
      name: row.name,
      description: row.description,
      content: JSON.parse(row.content),
      variables: JSON.parse(row.variables),
      channels: JSON.parse(row.channels),
      isActive: row.is_active,
      version: row.version,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapToNotificationResponse(row: any): NotificationResponse {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      status: row.status,
      channel: row.channel,
      templateType: row.template_type,
      recipient: JSON.parse(row.recipient_data),
      scheduledAt: row.scheduled_at,
      sentAt: row.sent_at,
      deliveredAt: row.delivered_at,
      deliveryResult: row.delivery_result ? JSON.parse(row.delivery_result) : undefined,
      retryCount: row.retry_count,
      nextRetryAt: row.next_retry_at,
      expiresAt: row.expires_at,
      tags: JSON.parse(row.tags || '[]'),
      correlationId: row.correlation_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

export default NotificationService;