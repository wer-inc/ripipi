/**
 * Event Publisher Service
 * Facade for publishing domain events to the outbox
 */

import { FastifyInstance } from 'fastify';
import { OutboxService, OutboxEvent } from '../outbox/outbox.service.js';
import { TransactionContext } from '../db/transaction.js';
import { logger } from '../config/logger.js';

export interface BookingEvent {
  bookingId: number;
  customerId: number;
  serviceId: number;
  startTime: Date;
  customerEmail?: string;
  customerPhone?: string;
  lineUserId?: string;
  serviceName: string;
  confirmationCode: string;
  amount: number;
  metadata?: any;
}

export interface PaymentEvent {
  paymentId: string;
  bookingId: number;
  amount: number;
  currency: string;
  paymentMethod: string;
  customerEmail?: string;
  metadata?: any;
}

/**
 * Service for publishing domain events
 */
export class EventPublisherService {
  private outboxService: OutboxService;
  
  constructor(private fastify: FastifyInstance) {
    this.outboxService = new OutboxService(fastify);
  }

  /**
   * Publish booking created event
   */
  async publishBookingCreated(
    ctx: TransactionContext,
    tenantId: number,
    booking: BookingEvent,
    traceId?: string
  ): Promise<string> {
    const event: OutboxEvent = {
      eventType: 'BOOKING_CREATED',
      aggregateType: 'BOOKING',
      aggregateId: booking.bookingId.toString(),
      payload: {
        bookingId: booking.bookingId,
        customerId: booking.customerId,
        serviceId: booking.serviceId,
        startTime: booking.startTime.toISOString(),
        customerEmail: booking.customerEmail,
        customerPhone: booking.customerPhone,
        lineUserId: booking.lineUserId,
        serviceName: booking.serviceName,
        confirmationCode: booking.confirmationCode,
        amount: booking.amount
      },
      metadata: {
        ...booking.metadata,
        publishedAt: new Date().toISOString(),
        version: '1.0'
      },
      traceId,
      correlationId: `booking-${booking.bookingId}`,
      causationId: `create-booking-${booking.bookingId}`
    };
    
    const eventId = await this.outboxService.publishEvent(ctx, tenantId, event);
    
    logger.info('Published BOOKING_CREATED event', {
      eventId,
      bookingId: booking.bookingId,
      tenantId,
      traceId
    });
    
    return eventId;
  }

  /**
   * Publish booking confirmed event
   */
  async publishBookingConfirmed(
    ctx: TransactionContext,
    tenantId: number,
    bookingId: number,
    confirmationCode: string,
    lineUserId?: string,
    traceId?: string
  ): Promise<string> {
    const event: OutboxEvent = {
      eventType: 'BOOKING_CONFIRMED',
      aggregateType: 'BOOKING',
      aggregateId: bookingId.toString(),
      payload: {
        bookingId,
        confirmationCode,
        lineUserId,
        confirmedAt: new Date().toISOString()
      },
      metadata: {
        publishedAt: new Date().toISOString(),
        version: '1.0'
      },
      traceId,
      correlationId: `booking-${bookingId}`,
      causationId: `confirm-booking-${bookingId}`
    };
    
    const eventId = await this.outboxService.publishEvent(ctx, tenantId, event);
    
    logger.info('Published BOOKING_CONFIRMED event', {
      eventId,
      bookingId,
      tenantId,
      traceId
    });
    
    return eventId;
  }

  /**
   * Publish booking cancelled event
   */
  async publishBookingCancelled(
    ctx: TransactionContext,
    tenantId: number,
    bookingId: number,
    reason: string,
    cancelledBy: string,
    customerEmail?: string,
    refundAmount?: number,
    traceId?: string
  ): Promise<string> {
    const event: OutboxEvent = {
      eventType: 'BOOKING_CANCELLED',
      aggregateType: 'BOOKING',
      aggregateId: bookingId.toString(),
      payload: {
        bookingId,
        reason,
        cancelledBy,
        customerEmail,
        refundAmount,
        cancelledAt: new Date().toISOString()
      },
      metadata: {
        publishedAt: new Date().toISOString(),
        version: '1.0'
      },
      traceId,
      correlationId: `booking-${bookingId}`,
      causationId: `cancel-booking-${bookingId}`
    };
    
    const eventId = await this.outboxService.publishEvent(ctx, tenantId, event);
    
    logger.info('Published BOOKING_CANCELLED event', {
      eventId,
      bookingId,
      reason,
      tenantId,
      traceId
    });
    
    return eventId;
  }

  /**
   * Publish payment completed event
   */
  async publishPaymentCompleted(
    ctx: TransactionContext,
    tenantId: number,
    payment: PaymentEvent,
    traceId?: string
  ): Promise<string> {
    const event: OutboxEvent = {
      eventType: 'PAYMENT_COMPLETED',
      aggregateType: 'PAYMENT',
      aggregateId: payment.paymentId,
      payload: {
        paymentId: payment.paymentId,
        bookingId: payment.bookingId,
        amount: payment.amount,
        currency: payment.currency,
        paymentMethod: payment.paymentMethod,
        customerEmail: payment.customerEmail,
        completedAt: new Date().toISOString()
      },
      metadata: {
        ...payment.metadata,
        publishedAt: new Date().toISOString(),
        version: '1.0'
      },
      traceId,
      correlationId: `booking-${payment.bookingId}`,
      causationId: `payment-${payment.paymentId}`
    };
    
    const eventId = await this.outboxService.publishEvent(ctx, tenantId, event);
    
    logger.info('Published PAYMENT_COMPLETED event', {
      eventId,
      paymentId: payment.paymentId,
      bookingId: payment.bookingId,
      tenantId,
      traceId
    });
    
    return eventId;
  }

  /**
   * Publish notification requested event
   */
  async publishNotificationRequested(
    ctx: TransactionContext,
    tenantId: number,
    notification: {
      type: string;
      recipientId: string;
      message: string;
      channel: 'EMAIL' | 'SMS' | 'LINE' | 'PUSH';
      metadata?: any;
    },
    traceId?: string
  ): Promise<string> {
    const event: OutboxEvent = {
      eventType: 'NOTIFICATION_REQUESTED',
      aggregateType: 'NOTIFICATION',
      aggregateId: `${notification.type}-${notification.recipientId}`,
      payload: {
        notificationType: notification.type,
        recipientId: notification.recipientId,
        message: notification.message,
        channel: notification.channel,
        metadata: notification.metadata,
        requestedAt: new Date().toISOString()
      },
      metadata: {
        publishedAt: new Date().toISOString(),
        version: '1.0'
      },
      traceId,
      correlationId: `notification-${notification.recipientId}`,
      causationId: `request-notification-${Date.now()}`
    };
    
    const eventId = await this.outboxService.publishEvent(ctx, tenantId, event);
    
    logger.info('Published NOTIFICATION_REQUESTED event', {
      eventId,
      notificationType: notification.type,
      channel: notification.channel,
      tenantId,
      traceId
    });
    
    return eventId;
  }

  /**
   * Publish multiple events atomically
   */
  async publishBatch(
    ctx: TransactionContext,
    tenantId: number,
    events: Array<{
      type: 'BOOKING_CREATED' | 'BOOKING_CONFIRMED' | 'BOOKING_CANCELLED' | 'PAYMENT_COMPLETED' | 'NOTIFICATION_REQUESTED';
      data: any;
    }>,
    traceId?: string
  ): Promise<string[]> {
    const eventIds: string[] = [];
    
    for (const { type, data } of events) {
      let eventId: string;
      
      switch (type) {
        case 'BOOKING_CREATED':
          eventId = await this.publishBookingCreated(ctx, tenantId, data, traceId);
          break;
          
        case 'BOOKING_CONFIRMED':
          eventId = await this.publishBookingConfirmed(
            ctx,
            tenantId,
            data.bookingId,
            data.confirmationCode,
            data.lineUserId,
            traceId
          );
          break;
          
        case 'BOOKING_CANCELLED':
          eventId = await this.publishBookingCancelled(
            ctx,
            tenantId,
            data.bookingId,
            data.reason,
            data.cancelledBy,
            data.customerEmail,
            data.refundAmount,
            traceId
          );
          break;
          
        case 'PAYMENT_COMPLETED':
          eventId = await this.publishPaymentCompleted(ctx, tenantId, data, traceId);
          break;
          
        case 'NOTIFICATION_REQUESTED':
          eventId = await this.publishNotificationRequested(ctx, tenantId, data, traceId);
          break;
          
        default:
          throw new Error(`Unknown event type: ${type}`);
      }
      
      eventIds.push(eventId);
    }
    
    logger.info('Published batch of events', {
      count: eventIds.length,
      tenantId,
      traceId
    });
    
    return eventIds;
  }

  /**
   * Create event metadata with standard fields
   */
  private createEventMetadata(additionalData?: any): any {
    return {
      ...additionalData,
      publishedAt: new Date().toISOString(),
      publisher: 'event-publisher-service',
      environment: process.env.NODE_ENV || 'development',
      version: '1.0'
    };
  }
}