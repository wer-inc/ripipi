/**
 * Payment Service
 * High-level payment service that integrates mock Stripe service with our database
 */

import { Database } from '../db/index.js';
import { logger } from '../config/logger.js';
import { stripeMarkService } from './stripe-mock.service.js';
import {
  PaymentEntity,
  PaymentMethodEntity,
  WebhookEventEntity,
  CreatePaymentIntentRequest,
  CreateSetupIntentRequest,
  CreateCustomerRequest,
  CreatePaymentMethodRequest,
  PaymentServiceResponse,
  PaymentIntent,
  SetupIntent,
  StripeCustomer,
  PaymentMethod,
  WebhookEvent,
  PaymentKind,
  PaymentStatus,
  Currency,
  PaymentProvider
} from '../types/payment.js';

export interface PaymentServiceConfig {
  provider: PaymentProvider;
  currency: Currency;
  webhookEndpoint?: string;
  retryAttempts?: number;
  timeoutMs?: number;
}

export interface ProcessPaymentRequest {
  tenantId: string;
  bookingId?: string;
  customerId: string;
  amount: number;
  currency: Currency;
  paymentMethodId?: string;
  kind: PaymentKind;
  description?: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
}

export interface SavePaymentMethodRequest {
  tenantId: string;
  customerId: string;
  paymentMethodData: CreatePaymentMethodRequest;
  setAsDefault?: boolean;
}

export interface RefundPaymentRequest {
  tenantId: string;
  paymentId: string;
  amount?: number;
  reason?: string;
  metadata?: Record<string, string>;
}

/**
 * Payment Service Implementation
 */
export class PaymentService {
  private db: Database;
  private config: PaymentServiceConfig;

  constructor(db: Database, config: PaymentServiceConfig) {
    this.db = db;
    this.config = config;
    logger.info('Payment service initialized', { provider: config.provider });
  }

  /**
   * Create or retrieve a Stripe customer
   */
  public async createOrGetCustomer(
    tenantId: string,
    customerId: string,
    customerData?: CreateCustomerRequest
  ): Promise<PaymentServiceResponse<StripeCustomer>> {
    try {
      logger.info('Creating or retrieving customer', { tenantId, customerId });

      // Check if we already have a payment method record for this customer
      const existingPM = await this.db.query(`
        SELECT provider_customer_id 
        FROM payment_methods 
        WHERE tenant_id = $1 AND customer_id = $2 AND provider = $3 
        LIMIT 1
      `, [tenantId, customerId, this.config.provider]);

      let stripeCustomer: StripeCustomer;

      if (existingPM.rows.length > 0 && existingPM.rows[0].provider_customer_id) {
        // Retrieve existing customer
        stripeCustomer = await stripeMarkService.retrieveCustomer(existingPM.rows[0].provider_customer_id);
      } else {
        // Create new customer
        const createRequest: CreateCustomerRequest = {
          email: customerData?.email,
          name: customerData?.name,
          phone: customerData?.phone,
          metadata: {
            tenant_id: tenantId,
            customer_id: customerId,
            ...customerData?.metadata
          }
        };

        stripeCustomer = await stripeMarkService.createCustomer(createRequest);
      }

      return {
        success: true,
        data: stripeCustomer
      };
    } catch (error) {
      logger.error('Failed to create or get customer', { error: error.message, tenantId, customerId });
      return {
        success: false,
        error: {
          type: 'api_error',
          message: error.message
        }
      };
    }
  }

  /**
   * Save a payment method for future use
   */
  public async savePaymentMethod(request: SavePaymentMethodRequest): Promise<PaymentServiceResponse<PaymentMethod>> {
    const client = await this.db.getClient();
    
    try {
      await client.query('BEGIN');
      logger.info('Saving payment method', { tenantId: request.tenantId, customerId: request.customerId });

      // Create or get Stripe customer
      const customerResult = await this.createOrGetCustomer(request.tenantId, request.customerId);
      if (!customerResult.success || !customerResult.data) {
        throw new Error(customerResult.error?.message || 'Failed to create customer');
      }

      const stripeCustomer = customerResult.data;

      // Create SetupIntent for saving the payment method
      const setupIntentRequest: CreateSetupIntentRequest = {
        customer: stripeCustomer.id,
        usage: 'off_session',
        metadata: {
          tenant_id: request.tenantId,
          customer_id: request.customerId
        }
      };

      const setupIntent = await stripeMarkService.createSetupIntent(setupIntentRequest);

      // If payment method data is provided, create and attach it
      if (request.paymentMethodData) {
        const paymentMethod = await stripeMarkService.createPaymentMethod(request.paymentMethodData);
        const attachedPM = await stripeMarkService.attachPaymentMethod(paymentMethod.id, stripeCustomer.id);

        // Update the SetupIntent with the payment method
        await stripeMarkService.updateSetupIntent(setupIntent.id, {
          payment_method: attachedPM.id
        });

        // Confirm the SetupIntent
        const confirmedSetupIntent = await stripeMarkService.confirmSetupIntent(setupIntent.id);

        if (confirmedSetupIntent.status === 'succeeded') {
          // Save payment method to our database
          await this.savePaymentMethodToDb(
            client,
            request.tenantId,
            request.customerId,
            stripeCustomer.id,
            attachedPM.id,
            request.setAsDefault || false
          );

          await client.query('COMMIT');
          
          return {
            success: true,
            data: attachedPM,
            webhookEvents: stripeMarkService.getWebhookEvents().slice(-3) // Return recent webhook events
          };
        } else {
          throw new Error(`SetupIntent failed with status: ${confirmedSetupIntent.status}`);
        }
      }

      await client.query('COMMIT');
      
      // Return SetupIntent for client-side completion
      return {
        success: true,
        data: setupIntent as any // SetupIntent will be handled client-side
      };

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to save payment method', { error: error.message, request });
      return {
        success: false,
        error: {
          type: 'api_error',
          message: error.message
        }
      };
    } finally {
      client.release();
    }
  }

  /**
   * Process a payment
   */
  public async processPayment(request: ProcessPaymentRequest): Promise<PaymentServiceResponse<PaymentIntent>> {
    const client = await this.db.getClient();
    
    try {
      await client.query('BEGIN');
      logger.info('Processing payment', { 
        tenantId: request.tenantId, 
        amount: request.amount, 
        kind: request.kind 
      });

      // Create or get Stripe customer
      const customerResult = await this.createOrGetCustomer(request.tenantId, request.customerId);
      if (!customerResult.success || !customerResult.data) {
        throw new Error(customerResult.error?.message || 'Failed to create customer');
      }

      const stripeCustomer = customerResult.data;

      // Create PaymentIntent
      const paymentIntentRequest: CreatePaymentIntentRequest = {
        amount: request.amount,
        currency: request.currency,
        customer: stripeCustomer.id,
        payment_method: request.paymentMethodId,
        confirmation_method: 'automatic',
        confirm: !!request.paymentMethodId,
        description: request.description,
        metadata: {
          tenant_id: request.tenantId,
          customer_id: request.customerId,
          booking_id: request.bookingId || '',
          kind: request.kind,
          ...request.metadata
        }
      };

      const paymentIntent = await stripeMarkService.createPaymentIntent(paymentIntentRequest);

      // Save payment record to our database
      const paymentId = await this.savePaymentToDb(
        client,
        request.tenantId,
        request.bookingId,
        request.kind,
        request.amount,
        request.currency,
        paymentIntent.status,
        paymentIntent.id
      );

      await client.query('COMMIT');

      // If payment requires action, return the PaymentIntent for client handling
      if (paymentIntent.status === 'requires_action') {
        return {
          success: true,
          data: paymentIntent,
          webhookEvents: stripeMarkService.getWebhookEvents().slice(-2)
        };
      }

      // If payment succeeded immediately
      if (paymentIntent.status === 'succeeded') {
        await this.updatePaymentStatus(paymentId, 'succeeded');
        return {
          success: true,
          data: paymentIntent,
          webhookEvents: stripeMarkService.getWebhookEvents().slice(-2)
        };
      }

      // If payment failed
      if (paymentIntent.status === 'failed') {
        await this.updatePaymentStatus(
          paymentId, 
          'failed', 
          paymentIntent.last_payment_error?.code, 
          paymentIntent.last_payment_error?.message
        );
        return {
          success: false,
          data: paymentIntent,
          error: paymentIntent.last_payment_error
        };
      }

      // Payment is processing
      return {
        success: true,
        data: paymentIntent,
        webhookEvents: stripeMarkService.getWebhookEvents().slice(-2)
      };

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to process payment', { error: error.message, request });
      return {
        success: false,
        error: {
          type: 'api_error',
          message: error.message
        }
      };
    } finally {
      client.release();
    }
  }

  /**
   * Refund a payment
   */
  public async refundPayment(request: RefundPaymentRequest): Promise<PaymentServiceResponse<any>> {
    const client = await this.db.getClient();
    
    try {
      await client.query('BEGIN');
      logger.info('Processing refund', { tenantId: request.tenantId, paymentId: request.paymentId });

      // Get the original payment
      const paymentResult = await client.query(`
        SELECT * FROM payments 
        WHERE id = $1 AND tenant_id = $2 AND status = 'succeeded'
      `, [request.paymentId, request.tenantId]);

      if (paymentResult.rows.length === 0) {
        throw new Error('Payment not found or not in succeeded status');
      }

      const payment = paymentResult.rows[0];
      const refundAmount = request.amount || payment.amount_jpy;

      // Create refund payment record
      const refundPaymentId = await this.savePaymentToDb(
        client,
        request.tenantId,
        payment.booking_id,
        'refund',
        refundAmount,
        payment.currency,
        'succeeded', // Assuming refund succeeds immediately in mock
        null, // No payment intent for refunds
        payment.provider_charge_id
      );

      // In a real Stripe integration, we would create a refund via Stripe API
      // For mock purposes, we'll simulate a successful refund
      const mockRefund = {
        id: `re_mock_${Date.now()}`,
        amount: refundAmount,
        currency: payment.currency,
        payment_intent: payment.provider_payment_intent_id,
        status: 'succeeded',
        created: Math.floor(Date.now() / 1000)
      };

      // Generate webhook event for refund
      stripeMarkService.generateWebhookEvent('charge.refunded', mockRefund);

      await client.query('COMMIT');

      logger.info('Refund processed successfully', { refundPaymentId, originalPaymentId: request.paymentId });

      return {
        success: true,
        data: mockRefund,
        webhookEvents: stripeMarkService.getWebhookEvents().slice(-1)
      };

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to process refund', { error: error.message, request });
      return {
        success: false,
        error: {
          type: 'api_error',
          message: error.message
        }
      };
    } finally {
      client.release();
    }
  }

  /**
   * Handle webhook events
   */
  public async handleWebhookEvent(event: WebhookEvent): Promise<PaymentServiceResponse<boolean>> {
    const client = await this.db.getClient();
    
    try {
      await client.query('BEGIN');
      logger.info('Handling webhook event', { eventId: event.id, type: event.type });

      // Store webhook event for idempotency
      const existingEvent = await client.query(`
        SELECT id FROM webhook_events 
        WHERE provider = $1 AND event_id = $2
      `, [this.config.provider, event.id]);

      if (existingEvent.rows.length > 0) {
        logger.info('Webhook event already processed', { eventId: event.id });
        await client.query('COMMIT');
        return { success: true, data: true };
      }

      // Save webhook event
      await client.query(`
        INSERT INTO webhook_events (provider, event_id, received_at, payload, status)
        VALUES ($1, $2, NOW(), $3, 'received')
      `, [this.config.provider, event.id, JSON.stringify(event)]);

      // Process the event based on type
      let processed = false;
      
      switch (event.type) {
        case 'payment_intent.succeeded':
          processed = await this.handlePaymentIntentSucceeded(client, event);
          break;
        case 'payment_intent.payment_failed':
          processed = await this.handlePaymentIntentFailed(client, event);
          break;
        case 'setup_intent.succeeded':
          processed = await this.handleSetupIntentSucceeded(client, event);
          break;
        default:
          logger.info('Unhandled webhook event type', { type: event.type });
          processed = true; // Mark as processed to avoid retries
      }

      // Update webhook event status
      const status = processed ? 'processed' : 'failed';
      await client.query(`
        UPDATE webhook_events 
        SET status = $1, handled_at = NOW()
        WHERE provider = $2 AND event_id = $3
      `, [status, this.config.provider, event.id]);

      await client.query('COMMIT');

      return { success: true, data: processed };

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to handle webhook event', { error: error.message, eventId: event.id });
      
      // Update webhook event with error
      try {
        await this.db.query(`
          UPDATE webhook_events 
          SET status = 'failed', error_message = $1, handled_at = NOW()
          WHERE provider = $2 AND event_id = $3
        `, [error.message, this.config.provider, event.id]);
      } catch (updateError) {
        logger.error('Failed to update webhook event error', { updateError: updateError.message });
      }

      return {
        success: false,
        error: {
          type: 'api_error',
          message: error.message
        }
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get payment methods for a customer
   */
  public async getPaymentMethods(tenantId: string, customerId: string): Promise<PaymentServiceResponse<PaymentMethodEntity[]>> {
    try {
      const result = await this.db.query(`
        SELECT * FROM payment_methods 
        WHERE tenant_id = $1 AND customer_id = $2 AND provider = $3
        ORDER BY is_default DESC, created_at DESC
      `, [tenantId, customerId, this.config.provider]);

      return {
        success: true,
        data: result.rows
      };
    } catch (error) {
      logger.error('Failed to get payment methods', { error: error.message, tenantId, customerId });
      return {
        success: false,
        error: {
          type: 'api_error',
          message: error.message
        }
      };
    }
  }

  /**
   * Get payments for a booking
   */
  public async getPaymentsForBooking(tenantId: string, bookingId: string): Promise<PaymentServiceResponse<PaymentEntity[]>> {
    try {
      const result = await this.db.query(`
        SELECT * FROM payments 
        WHERE tenant_id = $1 AND booking_id = $2
        ORDER BY created_at DESC
      `, [tenantId, bookingId]);

      return {
        success: true,
        data: result.rows
      };
    } catch (error) {
      logger.error('Failed to get payments for booking', { error: error.message, tenantId, bookingId });
      return {
        success: false,
        error: {
          type: 'api_error',
          message: error.message
        }
      };
    }
  }

  /**
   * Private helper methods
   */
  
  private async savePaymentMethodToDb(
    client: any,
    tenantId: string,
    customerId: string,
    providerCustomerId: string,
    providerPmId: string,
    isDefault: boolean
  ): Promise<string> {
    // If setting as default, unset other default payment methods
    if (isDefault) {
      await client.query(`
        UPDATE payment_methods 
        SET is_default = false 
        WHERE tenant_id = $1 AND customer_id = $2 AND provider = $3
      `, [tenantId, customerId, this.config.provider]);
    }

    const result = await client.query(`
      INSERT INTO payment_methods (
        tenant_id, customer_id, provider, provider_customer_id, 
        provider_pm_id, is_default, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING id
    `, [tenantId, customerId, this.config.provider, providerCustomerId, providerPmId, isDefault]);

    return result.rows[0].id;
  }

  private async savePaymentToDb(
    client: any,
    tenantId: string,
    bookingId: string | undefined,
    kind: PaymentKind,
    amount: number,
    currency: Currency,
    status: PaymentStatus,
    providerPaymentIntentId: string | null,
    providerChargeId?: string | null
  ): Promise<string> {
    const result = await client.query(`
      INSERT INTO payments (
        tenant_id, booking_id, kind, amount_jpy, currency, status, 
        provider, provider_payment_intent_id, provider_charge_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      RETURNING id
    `, [
      tenantId, bookingId, kind, amount, currency, status,
      this.config.provider, providerPaymentIntentId, providerChargeId
    ]);

    return result.rows[0].id;
  }

  private async updatePaymentStatus(
    paymentId: string,
    status: PaymentStatus,
    failureCode?: string,
    failureMessage?: string
  ): Promise<void> {
    await this.db.query(`
      UPDATE payments 
      SET status = $1, failure_code = $2, failure_message = $3, updated_at = NOW()
      WHERE id = $4
    `, [status, failureCode, failureMessage, paymentId]);
  }

  private async handlePaymentIntentSucceeded(client: any, event: WebhookEvent): Promise<boolean> {
    const paymentIntent = event.data.object as PaymentIntent;
    
    await client.query(`
      UPDATE payments 
      SET status = 'succeeded', updated_at = NOW()
      WHERE provider_payment_intent_id = $1 AND provider = $2
    `, [paymentIntent.id, this.config.provider]);

    logger.info('Updated payment status to succeeded', { paymentIntentId: paymentIntent.id });
    return true;
  }

  private async handlePaymentIntentFailed(client: any, event: WebhookEvent): Promise<boolean> {
    const paymentIntent = event.data.object as PaymentIntent;
    
    await client.query(`
      UPDATE payments 
      SET status = 'failed', failure_code = $1, failure_message = $2, updated_at = NOW()
      WHERE provider_payment_intent_id = $3 AND provider = $4
    `, [
      paymentIntent.last_payment_error?.code,
      paymentIntent.last_payment_error?.message,
      paymentIntent.id,
      this.config.provider
    ]);

    logger.info('Updated payment status to failed', { paymentIntentId: paymentIntent.id });
    return true;
  }

  private async handleSetupIntentSucceeded(client: any, event: WebhookEvent): Promise<boolean> {
    const setupIntent = event.data.object as SetupIntent;
    
    // SetupIntent success indicates payment method was saved successfully
    // The payment method should already be saved in our database during the setup process
    logger.info('SetupIntent succeeded', { setupIntentId: setupIntent.id });
    return true;
  }
}

/**
 * Factory function to create payment service
 */
export function createPaymentService(db: Database, config?: Partial<PaymentServiceConfig>): PaymentService {
  const defaultConfig: PaymentServiceConfig = {
    provider: 'mock',
    currency: 'JPY',
    retryAttempts: 3,
    timeoutMs: 30000,
    ...config
  };

  return new PaymentService(db, defaultConfig);
}