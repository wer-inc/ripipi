/**
 * Webhook Service
 * Handles processing of Stripe webhook events with idempotency, logging, and monitoring
 */

import { FastifyInstance } from 'fastify';
import { 
  WebhookEvent,
  SupportedWebhookEvent,
  WEBHOOK_EVENT_TYPES,
  WebhookEventType,
  PaymentIntentWebhookData,
  SetupIntentWebhookData,
  ChargeWebhookData,
  SubscriptionWebhookData,
  SupportedWebhookEventSchema
} from '../schemas/webhook.js';
import { 
  WebhookEventEntity,
  PaymentStatus,
  PaymentProvider
} from '../types/payment.js';
import { TenantContext } from '../types/database.js';
import { logger } from '../config/logger.js';
import { withTransaction, TransactionContext } from '../db/transaction.js';
import { 
  InternalServerError, 
  BadRequestError, 
  NotFoundError,
  ConflictError 
} from '../utils/errors.js';
import { NotificationService } from './notification.service.js';
import { BookingService } from './booking.service.js';
import { CacheService } from './cache.service.js';
import { IdempotencyService } from './idempotency.service.js';

/**
 * Webhook processing result
 */
export interface WebhookProcessingResult {
  eventId: string;
  eventType: string;
  processed: boolean;
  timestamp: number;
  error?: string;
  actions?: string[];
}

/**
 * Webhook processing configuration
 */
interface WebhookServiceConfig {
  maxRetries: number;
  retryDelayMs: number;
  eventTimeout: number;
  enableIdempotency: boolean;
  enableMonitoring: boolean;
  supportedEvents: Set<WebhookEventType>;
}

/**
 * Webhook event handler interface
 */
interface WebhookEventHandler {
  handle(event: SupportedWebhookEvent, context: TenantContext): Promise<void>;
}

/**
 * Main webhook service
 */
export class WebhookService {
  private cache: CacheService;
  private notificationService: NotificationService;
  private bookingService: BookingService;
  private idempotencyService: IdempotencyService;
  private config: WebhookServiceConfig;
  private eventHandlers: Map<WebhookEventType, WebhookEventHandler> = new Map();

  // Metrics tracking
  private metrics = {
    totalEvents: 0,
    processedEvents: 0,
    failedEvents: 0,
    duplicateEvents: 0,
    eventsByType: new Map<string, number>(),
    lastReset: new Date()
  };

  constructor(private fastify: FastifyInstance) {
    this.cache = new CacheService(fastify, {
      defaultTTL: 3600, // 1 hour
      memory: {
        enabled: true,
        maxSize: 16 * 1024 * 1024, // 16MB
        maxItems: 5000,
        ttlRatio: 0.5
      }
    });

    this.notificationService = new NotificationService(fastify);
    this.bookingService = new BookingService(fastify);
    this.idempotencyService = new IdempotencyService(fastify);

    this.config = {
      maxRetries: 3,
      retryDelayMs: 1000,
      eventTimeout: 30000, // 30 seconds
      enableIdempotency: true,
      enableMonitoring: true,
      supportedEvents: new Set([
        WEBHOOK_EVENT_TYPES.PAYMENT_INTENT_SUCCEEDED,
        WEBHOOK_EVENT_TYPES.PAYMENT_INTENT_PAYMENT_FAILED,
        WEBHOOK_EVENT_TYPES.PAYMENT_INTENT_REQUIRES_ACTION,
        WEBHOOK_EVENT_TYPES.SETUP_INTENT_SUCCEEDED,
        WEBHOOK_EVENT_TYPES.CHARGE_REFUNDED,
        WEBHOOK_EVENT_TYPES.CUSTOMER_SUBSCRIPTION_CREATED,
        WEBHOOK_EVENT_TYPES.CUSTOMER_SUBSCRIPTION_UPDATED,
        WEBHOOK_EVENT_TYPES.CUSTOMER_SUBSCRIPTION_DELETED
      ])
    };

    this.initializeEventHandlers();
  }

  /**
   * Process a webhook event
   */
  async processWebhookEvent(
    event: WebhookEvent,
    context: TenantContext
  ): Promise<WebhookProcessingResult> {
    const startTime = Date.now();
    this.metrics.totalEvents++;

    try {
      logger.info('Processing webhook event', {
        eventId: event.id,
        eventType: event.type,
        tenantId: context.tenantId,
        livemode: event.livemode,
        apiVersion: event.api_version
      });

      // Validate event structure
      const validatedEvent = await this.validateEvent(event);

      // Check if event type is supported
      if (!this.config.supportedEvents.has(validatedEvent.type as WebhookEventType)) {
        logger.warn('Unsupported webhook event type', {
          eventId: event.id,
          eventType: event.type
        });
        
        await this.recordWebhookEvent(
          validatedEvent,
          'ignored',
          'Unsupported event type',
          context
        );

        return {
          eventId: event.id,
          eventType: event.type,
          processed: false,
          timestamp: startTime,
          error: 'Unsupported event type'
        };
      }

      // Check for duplicate processing (idempotency)
      if (this.config.enableIdempotency) {
        const isDuplicate = await this.checkEventDuplicate(validatedEvent, context);
        if (isDuplicate) {
          this.metrics.duplicateEvents++;
          logger.info('Duplicate webhook event detected', {
            eventId: event.id,
            eventType: event.type
          });

          return {
            eventId: event.id,
            eventType: event.type,
            processed: true,
            timestamp: startTime,
            actions: ['skipped_duplicate']
          };
        }
      }

      // Record webhook event in database
      await this.recordWebhookEvent(validatedEvent, 'received', null, context);

      // Process the event
      const actions = await this.handleEvent(validatedEvent, context);

      // Mark as processed
      await this.updateWebhookEventStatus(
        validatedEvent.id,
        'processed',
        null,
        context
      );

      this.metrics.processedEvents++;
      this.updateEventTypeMetrics(event.type);

      const result: WebhookProcessingResult = {
        eventId: event.id,
        eventType: event.type,
        processed: true,
        timestamp: startTime,
        actions
      };

      logger.info('Webhook event processed successfully', {
        eventId: event.id,
        eventType: event.type,
        duration: Date.now() - startTime,
        actions
      });

      return result;

    } catch (error) {
      this.metrics.failedEvents++;
      
      logger.error('Failed to process webhook event', {
        eventId: event.id,
        eventType: event.type,
        error: error.message,
        stack: error.stack,
        duration: Date.now() - startTime
      });

      // Record the failure
      try {
        await this.recordWebhookEvent(
          event,
          'failed',
          error.message,
          context
        );
      } catch (recordError) {
        logger.error('Failed to record webhook event failure', {
          eventId: event.id,
          recordError: recordError.message
        });
      }

      // Re-throw for proper error handling
      throw error;
    }
  }

  /**
   * Get webhook event by ID
   */
  async getWebhookEvent(
    eventId: string,
    context: TenantContext
  ): Promise<WebhookEventEntity | null> {
    try {
      const cacheKey = `webhook_event:${context.tenantId}:${eventId}`;
      const cached = await this.cache.get<WebhookEventEntity>(cacheKey);

      if (cached) {
        return cached;
      }

      const result = await this.fastify.db.queryForTenant(
        context.tenantId,
        `
        SELECT * FROM webhook_events 
        WHERE event_id = $1 AND tenant_id = $2
        ORDER BY received_at DESC
        LIMIT 1
        `,
        [eventId, context.tenantId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const webhookEvent = this.mapToWebhookEventEntity(result.rows[0]);

      // Cache for 30 minutes
      await this.cache.set(cacheKey, webhookEvent, 1800);

      return webhookEvent;

    } catch (error) {
      logger.error('Failed to get webhook event', {
        eventId,
        tenantId: context.tenantId,
        error: error.message
      });
      throw new InternalServerError('Failed to retrieve webhook event');
    }
  }

  /**
   * Get webhook metrics
   */
  getWebhookMetrics() {
    return {
      ...this.metrics,
      eventsByType: Object.fromEntries(this.metrics.eventsByType)
    };
  }

  /**
   * Reset webhook metrics
   */
  resetWebhookMetrics() {
    this.metrics = {
      totalEvents: 0,
      processedEvents: 0,
      failedEvents: 0,
      duplicateEvents: 0,
      eventsByType: new Map(),
      lastReset: new Date()
    };
  }

  // Private methods

  /**
   * Initialize event handlers
   */
  private initializeEventHandlers(): void {
    // Payment Intent handlers
    this.eventHandlers.set(
      WEBHOOK_EVENT_TYPES.PAYMENT_INTENT_SUCCEEDED,
      new PaymentIntentSucceededHandler(this.fastify, this.notificationService, this.bookingService)
    );

    this.eventHandlers.set(
      WEBHOOK_EVENT_TYPES.PAYMENT_INTENT_PAYMENT_FAILED,
      new PaymentIntentFailedHandler(this.fastify, this.notificationService, this.bookingService)
    );

    this.eventHandlers.set(
      WEBHOOK_EVENT_TYPES.PAYMENT_INTENT_REQUIRES_ACTION,
      new PaymentIntentRequiresActionHandler(this.fastify, this.notificationService, this.bookingService)
    );

    // Setup Intent handlers
    this.eventHandlers.set(
      WEBHOOK_EVENT_TYPES.SETUP_INTENT_SUCCEEDED,
      new SetupIntentSucceededHandler(this.fastify, this.notificationService)
    );

    // Charge handlers
    this.eventHandlers.set(
      WEBHOOK_EVENT_TYPES.CHARGE_REFUNDED,
      new ChargeRefundedHandler(this.fastify, this.notificationService, this.bookingService)
    );

    // Subscription handlers
    this.eventHandlers.set(
      WEBHOOK_EVENT_TYPES.CUSTOMER_SUBSCRIPTION_CREATED,
      new SubscriptionCreatedHandler(this.fastify, this.notificationService)
    );

    this.eventHandlers.set(
      WEBHOOK_EVENT_TYPES.CUSTOMER_SUBSCRIPTION_UPDATED,
      new SubscriptionUpdatedHandler(this.fastify, this.notificationService)
    );

    this.eventHandlers.set(
      WEBHOOK_EVENT_TYPES.CUSTOMER_SUBSCRIPTION_DELETED,
      new SubscriptionDeletedHandler(this.fastify, this.notificationService)
    );
  }

  /**
   * Validate webhook event
   */
  private async validateEvent(event: WebhookEvent): Promise<SupportedWebhookEvent> {
    try {
      return SupportedWebhookEventSchema.parse(event);
    } catch (error) {
      logger.error('Webhook event validation failed', {
        eventId: event.id,
        eventType: event.type,
        error: error.message
      });
      throw new BadRequestError(`Invalid webhook event structure: ${error.message}`);
    }
  }

  /**
   * Check if event is duplicate
   */
  private async checkEventDuplicate(
    event: SupportedWebhookEvent,
    context: TenantContext
  ): Promise<boolean> {
    const existingEvent = await this.getWebhookEvent(event.id, context);
    return existingEvent !== null && existingEvent.status === 'processed';
  }

  /**
   * Handle webhook event with appropriate handler
   */
  private async handleEvent(
    event: SupportedWebhookEvent,
    context: TenantContext
  ): Promise<string[]> {
    const handler = this.eventHandlers.get(event.type as WebhookEventType);
    
    if (!handler) {
      throw new InternalServerError(`No handler found for event type: ${event.type}`);
    }

    return withTransaction(async (ctx) => {
      await handler.handle(event, { ...context, db: ctx });
      return [`handled_${event.type}`];
    });
  }

  /**
   * Record webhook event in database
   */
  private async recordWebhookEvent(
    event: WebhookEvent,
    status: 'received' | 'processed' | 'failed' | 'ignored',
    errorMessage: string | null,
    context: TenantContext
  ): Promise<void> {
    return withTransaction(async (ctx) => {
      const now = new Date();
      
      await ctx.queryForTenant(
        context.tenantId,
        `
        INSERT INTO webhook_events (
          tenant_id,
          provider,
          event_id,
          received_at,
          payload,
          handled_at,
          status,
          error_message,
          created_at,
          updated_at,
          created_by,
          updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (tenant_id, event_id) DO UPDATE SET
          status = EXCLUDED.status,
          error_message = EXCLUDED.error_message,
          handled_at = EXCLUDED.handled_at,
          updated_at = EXCLUDED.updated_at,
          updated_by = EXCLUDED.updated_by
        `,
        [
          context.tenantId,
          'stripe' as PaymentProvider,
          event.id,
          now,
          JSON.stringify(event),
          status === 'processed' ? now : null,
          status,
          errorMessage,
          now,
          now,
          context.userId || 'system',
          context.userId || 'system'
        ]
      );
    });
  }

  /**
   * Update webhook event status
   */
  private async updateWebhookEventStatus(
    eventId: string,
    status: 'received' | 'processed' | 'failed' | 'ignored',
    errorMessage: string | null,
    context: TenantContext
  ): Promise<void> {
    return withTransaction(async (ctx) => {
      await ctx.queryForTenant(
        context.tenantId,
        `
        UPDATE webhook_events 
        SET status = $1, error_message = $2, handled_at = $3, updated_at = $4, updated_by = $5
        WHERE event_id = $6 AND tenant_id = $7
        `,
        [
          status,
          errorMessage,
          status === 'processed' ? new Date() : null,
          new Date(),
          context.userId || 'system',
          eventId,
          context.tenantId
        ]
      );
    });
  }

  /**
   * Update event type metrics
   */
  private updateEventTypeMetrics(eventType: string): void {
    const current = this.metrics.eventsByType.get(eventType) || 0;
    this.metrics.eventsByType.set(eventType, current + 1);
  }

  /**
   * Map database row to webhook event entity
   */
  private mapToWebhookEventEntity(row: any): WebhookEventEntity {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      provider: row.provider,
      eventId: row.event_id,
      receivedAt: row.received_at,
      payload: row.payload,
      handledAt: row.handled_at,
      status: row.status,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by,
      updatedBy: row.updated_by
    };
  }
}

/**
 * Payment Intent Succeeded Handler
 */
class PaymentIntentSucceededHandler implements WebhookEventHandler {
  constructor(
    private fastify: FastifyInstance,
    private notificationService: NotificationService,
    private bookingService: BookingService
  ) {}

  async handle(event: SupportedWebhookEvent, context: TenantContext): Promise<void> {
    const paymentIntent = event.data.object as PaymentIntentWebhookData;
    
    logger.info('Processing payment_intent.succeeded', {
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      customer: paymentIntent.customer
    });

    // Update payment status in database
    await this.updatePaymentStatus(
      paymentIntent.id,
      'succeeded' as PaymentStatus,
      context
    );

    // Update booking status if payment is linked to a booking
    await this.updateBookingForPayment(paymentIntent, 'payment_completed', context);

    // Send success notification
    await this.sendPaymentNotification(paymentIntent, 'payment_succeeded', context);
  }

  private async updatePaymentStatus(
    paymentIntentId: string,
    status: PaymentStatus,
    context: TenantContext
  ): Promise<void> {
    await this.fastify.db.queryForTenant(
      context.tenantId,
      `
      UPDATE payments 
      SET status = $1, updated_at = $2, updated_by = $3
      WHERE provider_payment_intent_id = $4 AND tenant_id = $5
      `,
      [status, new Date(), context.userId || 'system', paymentIntentId, context.tenantId]
    );
  }

  private async updateBookingForPayment(
    paymentIntent: PaymentIntentWebhookData,
    newStatus: string,
    context: TenantContext
  ): Promise<void> {
    // Find booking associated with this payment
    const result = await this.fastify.db.queryForTenant(
      context.tenantId,
      `
      SELECT b.id, b.status 
      FROM bookings b
      JOIN payments p ON p.booking_id = b.id
      WHERE p.provider_payment_intent_id = $1 AND b.tenant_id = $2
      `,
      [paymentIntent.id, context.tenantId]
    );

    if (result.rows.length > 0) {
      const bookingId = result.rows[0].id;
      
      // Update booking status
      await this.fastify.db.queryForTenant(
        context.tenantId,
        `
        UPDATE bookings 
        SET status = $1, updated_at = $2, updated_by = $3
        WHERE id = $4 AND tenant_id = $5
        `,
        [newStatus, new Date(), context.userId || 'system', bookingId, context.tenantId]
      );

      logger.info('Updated booking status after payment success', {
        bookingId,
        newStatus,
        paymentIntentId: paymentIntent.id
      });
    }
  }

  private async sendPaymentNotification(
    paymentIntent: PaymentIntentWebhookData,
    notificationType: string,
    context: TenantContext
  ): Promise<void> {
    // Implementation would send notification
    // This is a simplified version
    logger.info('Sending payment notification', {
      paymentIntentId: paymentIntent.id,
      notificationType,
      customer: paymentIntent.customer
    });
  }
}

/**
 * Payment Intent Failed Handler
 */
class PaymentIntentFailedHandler implements WebhookEventHandler {
  constructor(
    private fastify: FastifyInstance,
    private notificationService: NotificationService,
    private bookingService: BookingService
  ) {}

  async handle(event: SupportedWebhookEvent, context: TenantContext): Promise<void> {
    const paymentIntent = event.data.object as PaymentIntentWebhookData;
    
    logger.info('Processing payment_intent.payment_failed', {
      paymentIntentId: paymentIntent.id,
      lastPaymentError: paymentIntent.last_payment_error
    });

    // Update payment status
    await this.updatePaymentStatus(
      paymentIntent.id,
      'failed' as PaymentStatus,
      paymentIntent.last_payment_error?.message,
      context
    );

    // Update booking status
    await this.updateBookingForPayment(paymentIntent, 'payment_failed', context);

    // Send failure notification
    await this.sendPaymentNotification(paymentIntent, 'payment_failed', context);
  }

  private async updatePaymentStatus(
    paymentIntentId: string,
    status: PaymentStatus,
    errorMessage: string | undefined,
    context: TenantContext
  ): Promise<void> {
    await this.fastify.db.queryForTenant(
      context.tenantId,
      `
      UPDATE payments 
      SET status = $1, failure_message = $2, updated_at = $3, updated_by = $4
      WHERE provider_payment_intent_id = $5 AND tenant_id = $6
      `,
      [status, errorMessage, new Date(), context.userId || 'system', paymentIntentId, context.tenantId]
    );
  }

  private async updateBookingForPayment(
    paymentIntent: PaymentIntentWebhookData,
    newStatus: string,
    context: TenantContext
  ): Promise<void> {
    // Similar to success handler but for failure
    const result = await this.fastify.db.queryForTenant(
      context.tenantId,
      `
      SELECT b.id 
      FROM bookings b
      JOIN payments p ON p.booking_id = b.id
      WHERE p.provider_payment_intent_id = $1 AND b.tenant_id = $2
      `,
      [paymentIntent.id, context.tenantId]
    );

    if (result.rows.length > 0) {
      const bookingId = result.rows[0].id;
      
      await this.fastify.db.queryForTenant(
        context.tenantId,
        `
        UPDATE bookings 
        SET status = $1, updated_at = $2, updated_by = $3
        WHERE id = $4 AND tenant_id = $5
        `,
        [newStatus, new Date(), context.userId || 'system', bookingId, context.tenantId]
      );
    }
  }

  private async sendPaymentNotification(
    paymentIntent: PaymentIntentWebhookData,
    notificationType: string,
    context: TenantContext
  ): Promise<void> {
    logger.info('Sending payment failure notification', {
      paymentIntentId: paymentIntent.id,
      notificationType
    });
  }
}

/**
 * Payment Intent Requires Action Handler
 */
class PaymentIntentRequiresActionHandler implements WebhookEventHandler {
  constructor(
    private fastify: FastifyInstance,
    private notificationService: NotificationService,
    private bookingService: BookingService
  ) {}

  async handle(event: SupportedWebhookEvent, context: TenantContext): Promise<void> {
    const paymentIntent = event.data.object as PaymentIntentWebhookData;
    
    logger.info('Processing payment_intent.requires_action', {
      paymentIntentId: paymentIntent.id,
      nextAction: paymentIntent.next_action
    });

    // Update payment status
    await this.updatePaymentStatus(
      paymentIntent.id,
      'requires_action' as PaymentStatus,
      context
    );

    // Send action required notification
    await this.sendActionRequiredNotification(paymentIntent, context);
  }

  private async updatePaymentStatus(
    paymentIntentId: string,
    status: PaymentStatus,
    context: TenantContext
  ): Promise<void> {
    await this.fastify.db.queryForTenant(
      context.tenantId,
      `
      UPDATE payments 
      SET status = $1, updated_at = $2, updated_by = $3
      WHERE provider_payment_intent_id = $4 AND tenant_id = $5
      `,
      [status, new Date(), context.userId || 'system', paymentIntentId, context.tenantId]
    );
  }

  private async sendActionRequiredNotification(
    paymentIntent: PaymentIntentWebhookData,
    context: TenantContext
  ): Promise<void> {
    logger.info('Sending action required notification', {
      paymentIntentId: paymentIntent.id,
      nextAction: paymentIntent.next_action?.type
    });
  }
}

/**
 * Setup Intent Succeeded Handler
 */
class SetupIntentSucceededHandler implements WebhookEventHandler {
  constructor(
    private fastify: FastifyInstance,
    private notificationService: NotificationService
  ) {}

  async handle(event: SupportedWebhookEvent, context: TenantContext): Promise<void> {
    const setupIntent = event.data.object as SetupIntentWebhookData;
    
    logger.info('Processing setup_intent.succeeded', {
      setupIntentId: setupIntent.id,
      customer: setupIntent.customer,
      paymentMethod: setupIntent.payment_method
    });

    // Update payment method status
    await this.updatePaymentMethodStatus(setupIntent, context);
  }

  private async updatePaymentMethodStatus(
    setupIntent: SetupIntentWebhookData,
    context: TenantContext
  ): Promise<void> {
    // Implementation would update payment method records
    logger.info('Payment method setup completed', {
      setupIntentId: setupIntent.id,
      paymentMethod: setupIntent.payment_method
    });
  }
}

/**
 * Charge Refunded Handler
 */
class ChargeRefundedHandler implements WebhookEventHandler {
  constructor(
    private fastify: FastifyInstance,
    private notificationService: NotificationService,
    private bookingService: BookingService
  ) {}

  async handle(event: SupportedWebhookEvent, context: TenantContext): Promise<void> {
    const charge = event.data.object as ChargeWebhookData;
    
    logger.info('Processing charge.refunded', {
      chargeId: charge.id,
      amountRefunded: charge.amount_refunded,
      refunded: charge.refunded
    });

    // Create refund record
    await this.createRefundRecord(charge, context);

    // Update booking if applicable
    await this.updateBookingForRefund(charge, context);

    // Send refund notification
    await this.sendRefundNotification(charge, context);
  }

  private async createRefundRecord(
    charge: ChargeWebhookData,
    context: TenantContext
  ): Promise<void> {
    // Implementation would create refund record in payments table
    logger.info('Creating refund record', {
      chargeId: charge.id,
      amountRefunded: charge.amount_refunded
    });
  }

  private async updateBookingForRefund(
    charge: ChargeWebhookData,
    context: TenantContext
  ): Promise<void> {
    // Implementation would update booking status for refund
    logger.info('Updating booking for refund', {
      chargeId: charge.id
    });
  }

  private async sendRefundNotification(
    charge: ChargeWebhookData,
    context: TenantContext
  ): Promise<void> {
    logger.info('Sending refund notification', {
      chargeId: charge.id
    });
  }
}

/**
 * Subscription Created Handler
 */
class SubscriptionCreatedHandler implements WebhookEventHandler {
  constructor(
    private fastify: FastifyInstance,
    private notificationService: NotificationService
  ) {}

  async handle(event: SupportedWebhookEvent, context: TenantContext): Promise<void> {
    const subscription = event.data.object as SubscriptionWebhookData;
    
    logger.info('Processing customer.subscription.created', {
      subscriptionId: subscription.id,
      customer: subscription.customer,
      status: subscription.status
    });

    // Implementation for subscription creation
  }
}

/**
 * Subscription Updated Handler
 */
class SubscriptionUpdatedHandler implements WebhookEventHandler {
  constructor(
    private fastify: FastifyInstance,
    private notificationService: NotificationService
  ) {}

  async handle(event: SupportedWebhookEvent, context: TenantContext): Promise<void> {
    const subscription = event.data.object as SubscriptionWebhookData;
    
    logger.info('Processing customer.subscription.updated', {
      subscriptionId: subscription.id,
      status: subscription.status
    });

    // Implementation for subscription updates
  }
}

/**
 * Subscription Deleted Handler
 */
class SubscriptionDeletedHandler implements WebhookEventHandler {
  constructor(
    private fastify: FastifyInstance,
    private notificationService: NotificationService
  ) {}

  async handle(event: SupportedWebhookEvent, context: TenantContext): Promise<void> {
    const subscription = event.data.object as SubscriptionWebhookData;
    
    logger.info('Processing customer.subscription.deleted', {
      subscriptionId: subscription.id,
      customer: subscription.customer
    });

    // Implementation for subscription deletion
  }
}

export default WebhookService;