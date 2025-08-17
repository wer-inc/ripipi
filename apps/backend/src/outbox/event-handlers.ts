/**
 * Event Handlers for Outbox Events
 * Implements specific business logic for each event type
 */

import { ProcessedEvent } from './outbox.service.js';
import { logger } from '../config/logger.js';
import { NotificationService } from '../services/notification.service.js';
import { WebhookService } from '../services/webhook.service.js';
import { EmailService } from '../services/email.service.js';
import { LineNotificationService } from '../services/line-notification.service.js';

/**
 * Base event handler interface
 */
export interface IEventHandler {
  handle(event: ProcessedEvent): Promise<void>;
}

/**
 * Booking Created Event Handler
 */
export class BookingCreatedHandler implements IEventHandler {
  constructor(
    private notificationService: NotificationService,
    private emailService: EmailService,
    private lineService: LineNotificationService
  ) {}

  async handle(event: ProcessedEvent): Promise<void> {
    const { bookingId, customerId, serviceId, startTime } = event.payload;
    
    logger.info('Handling BOOKING_CREATED event', {
      eventId: event.eventId,
      bookingId,
      traceId: event.traceId
    });

    try {
      // Send confirmation email
      if (event.payload.customerEmail) {
        await this.emailService.sendBookingConfirmation({
          to: event.payload.customerEmail,
          bookingId,
          serviceName: event.payload.serviceName,
          startTime,
          confirmationCode: event.payload.confirmationCode
        });
      }

      // Send LINE notification
      if (event.payload.lineUserId) {
        await this.lineService.sendBookingConfirmation({
          lineUserId: event.payload.lineUserId,
          bookingId,
          startTime
        });
      }

      // Schedule reminder notifications
      await this.scheduleReminders(event);

      // Update analytics
      await this.updateAnalytics(event);

    } catch (error) {
      logger.error('Failed to handle BOOKING_CREATED event', {
        error,
        eventId: event.eventId,
        bookingId
      });
      throw error;
    }
  }

  private async scheduleReminders(event: ProcessedEvent): Promise<void> {
    const { bookingId, startTime } = event.payload;
    
    // Schedule 24-hour reminder
    const reminder24h = new Date(startTime);
    reminder24h.setHours(reminder24h.getHours() - 24);
    
    if (reminder24h > new Date()) {
      await this.notificationService.scheduleNotification({
        type: 'REMINDER_24H',
        bookingId,
        scheduledAt: reminder24h,
        tenantId: event.tenantId
      });
    }

    // Schedule 2-hour reminder
    const reminder2h = new Date(startTime);
    reminder2h.setHours(reminder2h.getHours() - 2);
    
    if (reminder2h > new Date()) {
      await this.notificationService.scheduleNotification({
        type: 'REMINDER_2H',
        bookingId,
        scheduledAt: reminder2h,
        tenantId: event.tenantId
      });
    }
  }

  private async updateAnalytics(event: ProcessedEvent): Promise<void> {
    // Update booking analytics
    // This would typically update a separate analytics database or service
    logger.debug('Updating analytics for booking', {
      bookingId: event.payload.bookingId,
      tenantId: event.tenantId
    });
  }
}

/**
 * Booking Confirmed Event Handler
 */
export class BookingConfirmedHandler implements IEventHandler {
  constructor(
    private webhookService: WebhookService,
    private lineService: LineNotificationService
  ) {}

  async handle(event: ProcessedEvent): Promise<void> {
    const { bookingId, confirmationCode } = event.payload;
    
    logger.info('Handling BOOKING_CONFIRMED event', {
      eventId: event.eventId,
      bookingId,
      traceId: event.traceId
    });

    try {
      // Send webhook notification
      await this.webhookService.sendWebhook({
        tenantId: event.tenantId,
        eventType: 'booking.confirmed',
        payload: {
          bookingId,
          confirmationCode,
          confirmedAt: new Date().toISOString()
        }
      });

      // Send LINE confirmation
      if (event.payload.lineUserId) {
        await this.lineService.sendMessage({
          lineUserId: event.payload.lineUserId,
          message: `予約が確定しました。確認コード: ${confirmationCode}`
        });
      }

    } catch (error) {
      logger.error('Failed to handle BOOKING_CONFIRMED event', {
        error,
        eventId: event.eventId,
        bookingId
      });
      throw error;
    }
  }
}

/**
 * Booking Cancelled Event Handler
 */
export class BookingCancelledHandler implements IEventHandler {
  constructor(
    private notificationService: NotificationService,
    private emailService: EmailService,
    private webhookService: WebhookService
  ) {}

  async handle(event: ProcessedEvent): Promise<void> {
    const { bookingId, reason, cancelledBy } = event.payload;
    
    logger.info('Handling BOOKING_CANCELLED event', {
      eventId: event.eventId,
      bookingId,
      reason,
      traceId: event.traceId
    });

    try {
      // Cancel scheduled notifications
      await this.notificationService.cancelScheduledNotifications(bookingId);

      // Send cancellation email
      if (event.payload.customerEmail) {
        await this.emailService.sendBookingCancellation({
          to: event.payload.customerEmail,
          bookingId,
          reason,
          refundAmount: event.payload.refundAmount
        });
      }

      // Send webhook notification
      await this.webhookService.sendWebhook({
        tenantId: event.tenantId,
        eventType: 'booking.cancelled',
        payload: {
          bookingId,
          reason,
          cancelledBy,
          cancelledAt: new Date().toISOString()
        }
      });

      // Update inventory/availability
      await this.updateAvailability(event);

    } catch (error) {
      logger.error('Failed to handle BOOKING_CANCELLED event', {
        error,
        eventId: event.eventId,
        bookingId
      });
      throw error;
    }
  }

  private async updateAvailability(event: ProcessedEvent): Promise<void> {
    // Release the reserved timeslots
    logger.debug('Updating availability after cancellation', {
      bookingId: event.payload.bookingId,
      tenantId: event.tenantId
    });
  }
}

/**
 * Payment Completed Event Handler
 */
export class PaymentCompletedHandler implements IEventHandler {
  constructor(
    private emailService: EmailService,
    private webhookService: WebhookService
  ) {}

  async handle(event: ProcessedEvent): Promise<void> {
    const { paymentId, bookingId, amount, paymentMethod } = event.payload;
    
    logger.info('Handling PAYMENT_COMPLETED event', {
      eventId: event.eventId,
      paymentId,
      bookingId,
      traceId: event.traceId
    });

    try {
      // Send payment receipt
      if (event.payload.customerEmail) {
        await this.emailService.sendPaymentReceipt({
          to: event.payload.customerEmail,
          paymentId,
          amount,
          paymentMethod,
          bookingDetails: event.payload.bookingDetails
        });
      }

      // Send webhook notification
      await this.webhookService.sendWebhook({
        tenantId: event.tenantId,
        eventType: 'payment.completed',
        payload: {
          paymentId,
          bookingId,
          amount,
          paymentMethod,
          completedAt: new Date().toISOString()
        }
      });

      // Update booking status
      await this.updateBookingStatus(event);

    } catch (error) {
      logger.error('Failed to handle PAYMENT_COMPLETED event', {
        error,
        eventId: event.eventId,
        paymentId
      });
      throw error;
    }
  }

  private async updateBookingStatus(event: ProcessedEvent): Promise<void> {
    // Update booking payment status
    logger.debug('Updating booking payment status', {
      bookingId: event.payload.bookingId,
      paymentId: event.payload.paymentId
    });
  }
}

/**
 * Notification Requested Event Handler
 */
export class NotificationRequestedHandler implements IEventHandler {
  constructor(
    private notificationService: NotificationService
  ) {}

  async handle(event: ProcessedEvent): Promise<void> {
    const { notificationType, recipientId, message, channel } = event.payload;
    
    logger.info('Handling NOTIFICATION_REQUESTED event', {
      eventId: event.eventId,
      notificationType,
      channel,
      traceId: event.traceId
    });

    try {
      await this.notificationService.sendNotification({
        type: notificationType,
        recipientId,
        message,
        channel,
        tenantId: event.tenantId,
        metadata: event.payload.metadata
      });

    } catch (error) {
      logger.error('Failed to handle NOTIFICATION_REQUESTED event', {
        error,
        eventId: event.eventId,
        notificationType
      });
      throw error;
    }
  }
}

/**
 * Factory for creating event handlers
 */
export class EventHandlerFactory {
  private handlers: Map<string, IEventHandler> = new Map();

  constructor(
    private notificationService: NotificationService,
    private emailService: EmailService,
    private lineService: LineNotificationService,
    private webhookService: WebhookService
  ) {
    this.registerHandlers();
  }

  private registerHandlers(): void {
    this.handlers.set(
      'BOOKING_CREATED',
      new BookingCreatedHandler(
        this.notificationService,
        this.emailService,
        this.lineService
      )
    );

    this.handlers.set(
      'BOOKING_CONFIRMED',
      new BookingConfirmedHandler(
        this.webhookService,
        this.lineService
      )
    );

    this.handlers.set(
      'BOOKING_CANCELLED',
      new BookingCancelledHandler(
        this.notificationService,
        this.emailService,
        this.webhookService
      )
    );

    this.handlers.set(
      'PAYMENT_COMPLETED',
      new PaymentCompletedHandler(
        this.emailService,
        this.webhookService
      )
    );

    this.handlers.set(
      'NOTIFICATION_REQUESTED',
      new NotificationRequestedHandler(
        this.notificationService
      )
    );
  }

  getHandler(eventType: string): IEventHandler | undefined {
    return this.handlers.get(eventType);
  }

  getAllHandlers(): Map<string, IEventHandler> {
    return this.handlers;
  }
}