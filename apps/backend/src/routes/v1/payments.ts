/**
 * Payments API Routes
 * Handles payment processing, payment intents, and payment management
 */

import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import {
  ProcessPaymentRequestSchema,
  ProcessPaymentResponseSchema,
  GetPaymentResponseSchema,
  RefundPaymentRequestSchema,
  RefundPaymentResponseSchema,
  CapturePaymentResponseSchema,
  CreatePaymentIntentRequestSchema,
  CreatePaymentIntentResponseSchema,
  ConfirmPaymentIntentRequestSchema,
  ConfirmPaymentIntentResponseSchema,
  CancelPaymentIntentResponseSchema,
  PaymentIdParamSchema,
  PaymentIntentIdParamSchema,
  PaymentListQuerySchema,
  ErrorSchema,
  RateLimitHeadersSchema,
  type ProcessPaymentRequest,
  type RefundPaymentRequest,
  type CreatePaymentIntentRequest,
  type ConfirmPaymentIntentRequest,
  type PaymentIdParam,
  type PaymentIntentIdParam,
  type PaymentListQuery
} from '../../schemas/payment.js';
import { createPaymentService } from '../../services/payment.service.js';
import { logger } from '../../config/logger.js';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';

/**
 * Rate limiting configuration for payment operations
 */
const RATE_LIMITS = {
  PROCESS_PAYMENT: { max: 20, window: '1h' }, // 20 payment attempts per hour
  REFUND_PAYMENT: { max: 10, window: '1h' }, // 10 refunds per hour
  CREATE_PAYMENT_INTENT: { max: 30, window: '1h' }, // 30 intents per hour
  CAPTURE_PAYMENT: { max: 50, window: '1h' }, // 50 captures per hour
  GENERAL: { max: 100, window: '1h' } // General operations
};

/**
 * Payments routes plugin
 */
const paymentsRoutes: FastifyPluginAsync = async function (fastify: FastifyInstance) {
  // Initialize payment service
  const paymentService = createPaymentService(fastify.pg, {
    provider: 'mock',
    currency: 'JPY'
  });

  /**
   * POST /v1/payments
   * Process a payment for a booking
   */
  fastify.post('/', {
    preHandler: [
      fastify.authenticate,
      fastify.rateLimit({
        max: RATE_LIMITS.PROCESS_PAYMENT.max,
        timeWindow: RATE_LIMITS.PROCESS_PAYMENT.window,
        keyGenerator: (request) => `process-payment:${request.user?.tenant_id}:${request.user?.id}`,
        errorResponseBuilder: () => ({
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many payment attempts. Please try again later.'
        })
      })
    ],
    schema: {
      description: 'Process a payment for a booking or service',
      tags: ['Payments'],
      security: [{ bearerAuth: [] }],
      body: ProcessPaymentRequestSchema,
      response: {
        201: ProcessPaymentResponseSchema,
        400: ErrorSchema,
        401: Type.Object({
          error: Type.String(),
          message: Type.String()
        }),
        429: Type.Object({
          error: Type.String(),
          message: Type.String(),
          retryAfter: Type.Optional(Type.Number())
        }),
        500: ErrorSchema
      },
      headers: RateLimitHeadersSchema
    }
  }, async (request: FastifyRequest<{ Body: ProcessPaymentRequest }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const {
        booking_id,
        amount,
        currency = 'JPY',
        payment_method_id,
        kind,
        description,
        metadata,
        customer_data,
        idempotency_key
      } = request.body;

      // Generate idempotency key if not provided
      const finalIdempotencyKey = idempotency_key || 
        createHash('sha256')
          .update(`${user.tenant_id}:${user.id}:${booking_id || ''}:${amount}:${Date.now()}`)
          .digest('hex');

      logger.info('Processing payment', {
        tenantId: user.tenant_id,
        userId: user.id,
        bookingId: booking_id,
        amount,
        currency,
        kind,
        idempotencyKey: finalIdempotencyKey
      });

      // Check for existing payment with same idempotency key
      if (idempotency_key) {
        const existingPayment = await fastify.pg.query(`
          SELECT id, status, amount_jpy, currency FROM payments
          WHERE tenant_id = $1 AND provider_payment_intent_id = $2
        `, [user.tenant_id, finalIdempotencyKey]);

        if (existingPayment.rows.length > 0) {
          const payment = existingPayment.rows[0];
          logger.info('Returning existing payment for idempotency key', {
            paymentId: payment.id,
            idempotencyKey: finalIdempotencyKey
          });

          return reply.code(200).send({
            success: true,
            payment: {
              id: payment.id,
              amount: payment.amount_jpy,
              currency: payment.currency,
              status: payment.status,
              kind,
              booking_id,
              created_at: new Date().toISOString()
            },
            message: 'Payment already processed'
          });
        }
      }

      // Determine customer ID
      const customerId = customer_data?.id || user.id;

      // Validate booking ownership if booking_id is provided
      if (booking_id) {
        const bookingResult = await fastify.pg.query(`
          SELECT id FROM bookings
          WHERE id = $1 AND tenant_id = $2 AND user_id = $3
        `, [booking_id, user.tenant_id, user.id]);

        if (bookingResult.rows.length === 0) {
          return reply.code(400).send({
            error: 'BOOKING_NOT_FOUND',
            message: 'Booking not found or does not belong to you'
          });
        }
      }

      // Validate payment method ownership if provided
      if (payment_method_id) {
        const pmResult = await fastify.pg.query(`
          SELECT id FROM payment_methods
          WHERE tenant_id = $1 AND customer_id = $2 AND (id = $3 OR provider_pm_id = $3) AND deleted_at IS NULL
        `, [user.tenant_id, customerId, payment_method_id]);

        if (pmResult.rows.length === 0) {
          return reply.code(400).send({
            error: 'PAYMENT_METHOD_NOT_FOUND',
            message: 'Payment method not found or does not belong to you'
          });
        }
      }

      // Process payment
      const processRequest = {
        tenantId: user.tenant_id,
        bookingId: booking_id,
        customerId,
        amount,
        currency,
        paymentMethodId: payment_method_id,
        kind,
        description,
        metadata: {
          user_id: user.id,
          ...metadata
        },
        idempotencyKey: finalIdempotencyKey
      };

      const result = await paymentService.processPayment(processRequest);

      if (!result.success) {
        logger.error('Payment processing failed', {
          tenantId: user.tenant_id,
          userId: user.id,
          error: result.error?.message
        });

        const statusCode = result.error?.type === 'card_error' ? 400 : 500;
        return reply.code(statusCode).send({
          success: false,
          error: result.error,
          message: result.error?.message || 'Payment processing failed'
        });
      }

      const paymentIntent = result.data;
      const requiresAction = paymentIntent?.status === 'requires_action';

      logger.info('Payment processed successfully', {
        tenantId: user.tenant_id,
        userId: user.id,
        paymentIntentId: paymentIntent?.id,
        status: paymentIntent?.status,
        requiresAction
      });

      return reply.code(201).send({
        success: true,
        payment: {
          id: paymentIntent?.id || uuidv4(),
          amount,
          currency,
          status: paymentIntent?.status || 'processing',
          kind,
          booking_id,
          created_at: new Date().toISOString()
        },
        payment_intent: paymentIntent,
        requires_action: requiresAction,
        next_action: paymentIntent?.next_action,
        message: requiresAction 
          ? 'Payment requires additional authentication'
          : 'Payment processed successfully'
      });

    } catch (error) {
      logger.error('Error processing payment', {
        error: error.message,
        tenantId: request.user?.tenant_id,
        userId: request.user?.id
      });

      return reply.code(500).send({
        success: false,
        error: {
          type: 'api_error',
          message: 'An unexpected error occurred while processing the payment'
        },
        message: 'Payment processing failed'
      });
    }
  });

  /**
   * GET /v1/payments/:id
   * Get payment details
   */
  fastify.get('/:id', {
    preHandler: [
      fastify.authenticate,
      fastify.rateLimit({
        max: RATE_LIMITS.GENERAL.max,
        timeWindow: RATE_LIMITS.GENERAL.window,
        keyGenerator: (request) => `get-payment:${request.user?.tenant_id}:${request.user?.id}`
      })
    ],
    schema: {
      description: 'Get payment details by ID',
      tags: ['Payments'],
      security: [{ bearerAuth: [] }],
      params: PaymentIdParamSchema,
      response: {
        200: GetPaymentResponseSchema,
        401: Type.Object({
          error: Type.String(),
          message: Type.String()
        }),
        404: Type.Object({
          error: Type.String(),
          message: Type.String()
        }),
        500: ErrorSchema
      }
    }
  }, async (request: FastifyRequest<{ Params: PaymentIdParam }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id: paymentId } = request.params;

      logger.info('Getting payment details', {
        tenantId: user.tenant_id,
        userId: user.id,
        paymentId
      });

      // Get payment from database
      const result = await fastify.pg.query(`
        SELECT * FROM payments
        WHERE id = $1 AND tenant_id = $2
      `, [paymentId, user.tenant_id]);

      if (result.rows.length === 0) {
        return reply.code(404).send({
          error: 'PAYMENT_NOT_FOUND',
          message: 'Payment not found'
        });
      }

      const payment = result.rows[0];

      return reply.code(200).send({
        id: payment.id,
        booking_id: payment.booking_id,
        kind: payment.kind,
        amount: payment.amount_jpy,
        currency: payment.currency,
        status: payment.status,
        provider: payment.provider,
        provider_payment_intent_id: payment.provider_payment_intent_id,
        provider_charge_id: payment.provider_charge_id,
        failure_code: payment.failure_code,
        failure_message: payment.failure_message,
        created_at: payment.created_at?.toISOString() || new Date().toISOString(),
        updated_at: payment.updated_at?.toISOString() || new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error getting payment details', {
        error: error.message,
        tenantId: request.user?.tenant_id,
        userId: request.user?.id,
        paymentId: request.params.id
      });

      return reply.code(500).send({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred while retrieving payment details'
      });
    }
  });

  /**
   * POST /v1/payments/:id/refund
   * Process a refund for a payment
   */
  fastify.post('/:id/refund', {
    preHandler: [
      fastify.authenticate,
      fastify.rateLimit({
        max: RATE_LIMITS.REFUND_PAYMENT.max,
        timeWindow: RATE_LIMITS.REFUND_PAYMENT.window,
        keyGenerator: (request) => `refund-payment:${request.user?.tenant_id}:${request.user?.id}`,
        errorResponseBuilder: () => ({
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many refund attempts. Please try again later.'
        })
      })
    ],
    schema: {
      description: 'Process a refund for a payment',
      tags: ['Payments'],
      security: [{ bearerAuth: [] }],
      params: PaymentIdParamSchema,
      body: RefundPaymentRequestSchema,
      response: {
        200: RefundPaymentResponseSchema,
        400: ErrorSchema,
        401: Type.Object({
          error: Type.String(),
          message: Type.String()
        }),
        404: Type.Object({
          error: Type.String(),
          message: Type.String()
        }),
        429: Type.Object({
          error: Type.String(),
          message: Type.String()
        }),
        500: ErrorSchema
      }
    }
  }, async (request: FastifyRequest<{ 
    Params: PaymentIdParam;
    Body: RefundPaymentRequest;
  }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id: paymentId } = request.params;
      const { amount, reason, metadata } = request.body;

      logger.info('Processing refund', {
        tenantId: user.tenant_id,
        userId: user.id,
        paymentId,
        refundAmount: amount,
        reason
      });

      // Validate payment exists and can be refunded
      const paymentResult = await fastify.pg.query(`
        SELECT * FROM payments
        WHERE id = $1 AND tenant_id = $2 AND status = 'succeeded' AND kind != 'refund'
      `, [paymentId, user.tenant_id]);

      if (paymentResult.rows.length === 0) {
        return reply.code(404).send({
          error: 'PAYMENT_NOT_FOUND',
          message: 'Payment not found or cannot be refunded'
        });
      }

      const payment = paymentResult.rows[0];

      // Check refund amount
      if (amount && amount > payment.amount_jpy) {
        return reply.code(400).send({
          error: 'INVALID_REFUND_AMOUNT',
          message: 'Refund amount cannot exceed the original payment amount'
        });
      }

      // Process refund
      const refundRequest = {
        tenantId: user.tenant_id,
        paymentId,
        amount,
        reason,
        metadata: {
          user_id: user.id,
          ...metadata
        }
      };

      const result = await paymentService.refundPayment(refundRequest);

      if (!result.success) {
        logger.error('Refund processing failed', {
          tenantId: user.tenant_id,
          userId: user.id,
          paymentId,
          error: result.error?.message
        });

        return reply.code(500).send({
          success: false,
          message: result.error?.message || 'Refund processing failed'
        });
      }

      logger.info('Refund processed successfully', {
        tenantId: user.tenant_id,
        userId: user.id,
        paymentId,
        refundAmount: result.data?.amount
      });

      return reply.code(200).send({
        success: true,
        refund: result.data,
        message: 'Refund processed successfully'
      });

    } catch (error) {
      logger.error('Error processing refund', {
        error: error.message,
        tenantId: request.user?.tenant_id,
        userId: request.user?.id,
        paymentId: request.params.id
      });

      return reply.code(500).send({
        success: false,
        message: 'An unexpected error occurred while processing the refund'
      });
    }
  });

  /**
   * POST /v1/payments/:id/capture
   * Capture an authorized payment
   */
  fastify.post('/:id/capture', {
    preHandler: [
      fastify.authenticate,
      fastify.rateLimit({
        max: RATE_LIMITS.CAPTURE_PAYMENT.max,
        timeWindow: RATE_LIMITS.CAPTURE_PAYMENT.window,
        keyGenerator: (request) => `capture-payment:${request.user?.tenant_id}:${request.user?.id}`
      })
    ],
    schema: {
      description: 'Capture an authorized payment',
      tags: ['Payments'],
      security: [{ bearerAuth: [] }],
      params: PaymentIdParamSchema,
      response: {
        200: CapturePaymentResponseSchema,
        400: ErrorSchema,
        401: Type.Object({
          error: Type.String(),
          message: Type.String()
        }),
        404: Type.Object({
          error: Type.String(),
          message: Type.String()
        }),
        500: ErrorSchema
      }
    }
  }, async (request: FastifyRequest<{ Params: PaymentIdParam }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id: paymentId } = request.params;

      logger.info('Capturing payment', {
        tenantId: user.tenant_id,
        userId: user.id,
        paymentId
      });

      // Check if payment exists and is in requires_capture status
      const paymentResult = await fastify.pg.query(`
        SELECT * FROM payments
        WHERE id = $1 AND tenant_id = $2 AND status = 'requires_capture'
      `, [paymentId, user.tenant_id]);

      if (paymentResult.rows.length === 0) {
        return reply.code(404).send({
          error: 'PAYMENT_NOT_FOUND',
          message: 'Payment not found or cannot be captured'
        });
      }

      const payment = paymentResult.rows[0];

      // In a real implementation, we would capture via the payment provider
      // For mock, we'll just update the status to succeeded
      await fastify.pg.query(`
        UPDATE payments
        SET status = 'succeeded', updated_at = NOW()
        WHERE id = $1
      `, [paymentId]);

      logger.info('Payment captured successfully', {
        tenantId: user.tenant_id,
        userId: user.id,
        paymentId
      });

      // Create a mock payment intent response
      const paymentIntent = {
        id: payment.provider_payment_intent_id || `pi_mock_${Date.now()}`,
        object: 'payment_intent' as const,
        amount: payment.amount_jpy,
        amount_capturable: 0,
        amount_received: payment.amount_jpy,
        capture_method: 'manual' as const,
        client_secret: `pi_mock_${Date.now()}_secret`,
        confirmation_method: 'automatic' as const,
        created: Math.floor(Date.now() / 1000),
        currency: payment.currency.toLowerCase(),
        customer: user.id,
        description: `Payment for booking ${payment.booking_id}`,
        metadata: {},
        payment_method_types: ['card'],
        status: 'succeeded' as const
      };

      return reply.code(200).send({
        success: true,
        payment_intent: paymentIntent,
        message: 'Payment captured successfully'
      });

    } catch (error) {
      logger.error('Error capturing payment', {
        error: error.message,
        tenantId: request.user?.tenant_id,
        userId: request.user?.id,
        paymentId: request.params.id
      });

      return reply.code(500).send({
        success: false,
        message: 'An unexpected error occurred while capturing the payment'
      });
    }
  });

  /**
   * GET /v1/payments
   * List payments with optional filtering
   */
  fastify.get('/', {
    preHandler: [
      fastify.authenticate,
      fastify.rateLimit({
        max: RATE_LIMITS.GENERAL.max,
        timeWindow: RATE_LIMITS.GENERAL.window,
        keyGenerator: (request) => `list-payments:${request.user?.tenant_id}:${request.user?.id}`
      })
    ],
    schema: {
      description: 'List payments with optional filtering',
      tags: ['Payments'],
      security: [{ bearerAuth: [] }],
      querystring: PaymentListQuerySchema,
      response: {
        200: Type.Object({
          payments: Type.Array(GetPaymentResponseSchema),
          total: Type.Number(),
          limit: Type.Number(),
          offset: Type.Number()
        }),
        401: Type.Object({
          error: Type.String(),
          message: Type.String()
        }),
        500: ErrorSchema
      }
    }
  }, async (request: FastifyRequest<{ Querystring: PaymentListQuery }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const {
        booking_id,
        status,
        kind,
        limit = 20,
        offset = 0
      } = request.query || {};

      logger.info('Listing payments', {
        tenantId: user.tenant_id,
        userId: user.id,
        filters: { booking_id, status, kind },
        pagination: { limit, offset }
      });

      // Build query with filters
      let query = `
        SELECT * FROM payments
        WHERE tenant_id = $1
      `;
      const params: any[] = [user.tenant_id];
      let paramIndex = 2;

      if (booking_id) {
        query += ` AND booking_id = $${paramIndex}`;
        params.push(booking_id);
        paramIndex++;
      }

      if (status) {
        query += ` AND status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }

      if (kind) {
        query += ` AND kind = $${paramIndex}`;
        params.push(kind);
        paramIndex++;
      }

      // Add ordering and pagination
      query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);

      // Execute query
      const result = await fastify.pg.query(query, params);

      // Get total count for pagination
      let countQuery = `
        SELECT COUNT(*) as total FROM payments
        WHERE tenant_id = $1
      `;
      const countParams: any[] = [user.tenant_id];
      let countParamIndex = 2;

      if (booking_id) {
        countQuery += ` AND booking_id = $${countParamIndex}`;
        countParams.push(booking_id);
        countParamIndex++;
      }

      if (status) {
        countQuery += ` AND status = $${countParamIndex}`;
        countParams.push(status);
        countParamIndex++;
      }

      if (kind) {
        countQuery += ` AND kind = $${countParamIndex}`;
        countParams.push(kind);
        countParamIndex++;
      }

      const countResult = await fastify.pg.query(countQuery, countParams);
      const total = parseInt(countResult.rows[0].total);

      // Transform payments
      const payments = result.rows.map(payment => ({
        id: payment.id,
        booking_id: payment.booking_id,
        kind: payment.kind,
        amount: payment.amount_jpy,
        currency: payment.currency,
        status: payment.status,
        provider: payment.provider,
        provider_payment_intent_id: payment.provider_payment_intent_id,
        provider_charge_id: payment.provider_charge_id,
        failure_code: payment.failure_code,
        failure_message: payment.failure_message,
        created_at: payment.created_at?.toISOString() || new Date().toISOString(),
        updated_at: payment.updated_at?.toISOString() || new Date().toISOString()
      }));

      return reply.code(200).send({
        payments,
        total,
        limit,
        offset
      });

    } catch (error) {
      logger.error('Error listing payments', {
        error: error.message,
        tenantId: request.user?.tenant_id,
        userId: request.user?.id
      });

      return reply.code(500).send({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred while retrieving payments'
      });
    }
  });

  // ===============================
  // PAYMENT INTENT ENDPOINTS
  // ===============================

  /**
   * POST /v1/payments/intents
   * Create a payment intent
   */
  fastify.post('/intents', {
    preHandler: [
      fastify.authenticate,
      fastify.rateLimit({
        max: RATE_LIMITS.CREATE_PAYMENT_INTENT.max,
        timeWindow: RATE_LIMITS.CREATE_PAYMENT_INTENT.window,
        keyGenerator: (request) => `create-intent:${request.user?.tenant_id}:${request.user?.id}`,
        errorResponseBuilder: () => ({
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many payment intent creation attempts. Please try again later.'
        })
      })
    ],
    schema: {
      description: 'Create a payment intent for future payment',
      tags: ['Payment Intents'],
      security: [{ bearerAuth: [] }],
      body: CreatePaymentIntentRequestSchema,
      response: {
        201: CreatePaymentIntentResponseSchema,
        400: ErrorSchema,
        401: Type.Object({
          error: Type.String(),
          message: Type.String()
        }),
        429: Type.Object({
          error: Type.String(),
          message: Type.String(),
          retryAfter: Type.Optional(Type.Number())
        }),
        500: ErrorSchema
      },
      headers: RateLimitHeadersSchema
    }
  }, async (request: FastifyRequest<{ Body: CreatePaymentIntentRequest }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const {
        amount,
        currency = 'JPY',
        customer_id,
        payment_method_id,
        booking_id,
        description,
        metadata,
        confirmation_method = 'automatic',
        confirm = false,
        capture_method = 'automatic'
      } = request.body;

      logger.info('Creating payment intent', {
        tenantId: user.tenant_id,
        userId: user.id,
        customerId: customer_id,
        amount,
        currency
      });

      // Create payment intent using the payment service
      const createRequest = {
        tenantId: user.tenant_id,
        bookingId: booking_id,
        customerId: customer_id,
        amount,
        currency,
        paymentMethodId: payment_method_id,
        kind: 'charge' as const,
        description,
        metadata: {
          user_id: user.id,
          confirmation_method,
          capture_method,
          ...metadata
        }
      };

      const result = await paymentService.processPayment(createRequest);

      if (!result.success) {
        logger.error('Payment intent creation failed', {
          tenantId: user.tenant_id,
          userId: user.id,
          error: result.error?.message
        });

        return reply.code(400).send({
          success: false,
          error: result.error,
          message: result.error?.message || 'Failed to create payment intent'
        });
      }

      logger.info('Payment intent created successfully', {
        tenantId: user.tenant_id,
        userId: user.id,
        paymentIntentId: result.data?.id
      });

      return reply.code(201).send({
        success: true,
        payment_intent: result.data,
        message: 'Payment intent created successfully'
      });

    } catch (error) {
      logger.error('Error creating payment intent', {
        error: error.message,
        tenantId: request.user?.tenant_id,
        userId: request.user?.id
      });

      return reply.code(500).send({
        success: false,
        error: {
          type: 'api_error',
          message: 'An unexpected error occurred while creating the payment intent'
        },
        message: 'Payment intent creation failed'
      });
    }
  });

  /**
   * PUT /v1/payments/intents/:id/confirm
   * Confirm a payment intent
   */
  fastify.put('/intents/:id/confirm', {
    preHandler: [
      fastify.authenticate,
      fastify.rateLimit({
        max: RATE_LIMITS.GENERAL.max,
        timeWindow: RATE_LIMITS.GENERAL.window,
        keyGenerator: (request) => `confirm-intent:${request.user?.tenant_id}:${request.user?.id}`
      })
    ],
    schema: {
      description: 'Confirm a payment intent',
      tags: ['Payment Intents'],
      security: [{ bearerAuth: [] }],
      params: PaymentIntentIdParamSchema,
      body: ConfirmPaymentIntentRequestSchema,
      response: {
        200: ConfirmPaymentIntentResponseSchema,
        400: ErrorSchema,
        401: Type.Object({
          error: Type.String(),
          message: Type.String()
        }),
        404: Type.Object({
          error: Type.String(),
          message: Type.String()
        }),
        500: ErrorSchema
      }
    }
  }, async (request: FastifyRequest<{
    Params: PaymentIntentIdParam;
    Body: ConfirmPaymentIntentRequest;
  }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id: paymentIntentId } = request.params;
      const { payment_method_id, return_url } = request.body;

      logger.info('Confirming payment intent', {
        tenantId: user.tenant_id,
        userId: user.id,
        paymentIntentId,
        paymentMethodId: payment_method_id
      });

      // Check if payment exists and belongs to tenant
      const paymentResult = await fastify.pg.query(`
        SELECT * FROM payments
        WHERE provider_payment_intent_id = $1 AND tenant_id = $2
      `, [paymentIntentId, user.tenant_id]);

      if (paymentResult.rows.length === 0) {
        return reply.code(404).send({
          error: 'PAYMENT_INTENT_NOT_FOUND',
          message: 'Payment intent not found'
        });
      }

      const payment = paymentResult.rows[0];

      // In a real implementation, we would confirm via the payment provider
      // For mock, we'll update the payment status based on the current status
      let newStatus = 'succeeded';
      let requiresAction = false;
      let nextAction = null;

      // Simulate different confirmation scenarios
      if (payment.status === 'requires_payment_method' && !payment_method_id) {
        return reply.code(400).send({
          error: 'PAYMENT_METHOD_REQUIRED',
          message: 'Payment method is required to confirm this payment intent'
        });
      }

      // Simulate 3D Secure requirement (5% chance)
      if (Math.random() < 0.05) {
        newStatus = 'requires_action';
        requiresAction = true;
        nextAction = {
          type: 'redirect_to_url' as const,
          redirect_to_url: {
            return_url: return_url || `https://example.com/return`,
            url: `https://hooks.stripe.com/3d_secure_2_eap/begin_test/src_${paymentIntentId}`
          }
        };
      }

      // Update payment status
      await fastify.pg.query(`
        UPDATE payments
        SET status = $1, updated_at = NOW()
        WHERE provider_payment_intent_id = $2 AND tenant_id = $3
      `, [newStatus, paymentIntentId, user.tenant_id]);

      // Create mock payment intent response
      const paymentIntent = {
        id: paymentIntentId,
        object: 'payment_intent' as const,
        amount: payment.amount_jpy,
        amount_capturable: newStatus === 'requires_capture' ? payment.amount_jpy : 0,
        amount_received: newStatus === 'succeeded' ? payment.amount_jpy : 0,
        capture_method: 'automatic' as const,
        client_secret: `${paymentIntentId}_secret_${Date.now()}`,
        confirmation_method: 'automatic' as const,
        created: Math.floor(Date.now() / 1000),
        currency: payment.currency.toLowerCase(),
        customer: user.id,
        description: `Payment for booking ${payment.booking_id}`,
        metadata: {},
        next_action: nextAction,
        payment_method: payment_method_id,
        payment_method_types: ['card'],
        status: newStatus as any
      };

      logger.info('Payment intent confirmed', {
        tenantId: user.tenant_id,
        userId: user.id,
        paymentIntentId,
        status: newStatus,
        requiresAction
      });

      return reply.code(200).send({
        success: true,
        payment_intent: paymentIntent,
        requires_action: requiresAction,
        next_action: nextAction,
        message: requiresAction 
          ? 'Payment requires additional authentication'
          : 'Payment intent confirmed successfully'
      });

    } catch (error) {
      logger.error('Error confirming payment intent', {
        error: error.message,
        tenantId: request.user?.tenant_id,
        userId: request.user?.id,
        paymentIntentId: request.params.id
      });

      return reply.code(500).send({
        success: false,
        error: {
          type: 'api_error',
          message: 'An unexpected error occurred while confirming the payment intent'
        },
        message: 'Payment intent confirmation failed'
      });
    }
  });

  /**
   * POST /v1/payments/intents/:id/cancel
   * Cancel a payment intent
   */
  fastify.post('/intents/:id/cancel', {
    preHandler: [
      fastify.authenticate,
      fastify.rateLimit({
        max: RATE_LIMITS.GENERAL.max,
        timeWindow: RATE_LIMITS.GENERAL.window,
        keyGenerator: (request) => `cancel-intent:${request.user?.tenant_id}:${request.user?.id}`
      })
    ],
    schema: {
      description: 'Cancel a payment intent',
      tags: ['Payment Intents'],
      security: [{ bearerAuth: [] }],
      params: PaymentIntentIdParamSchema,
      response: {
        200: CancelPaymentIntentResponseSchema,
        400: ErrorSchema,
        401: Type.Object({
          error: Type.String(),
          message: Type.String()
        }),
        404: Type.Object({
          error: Type.String(),
          message: Type.String()
        }),
        500: ErrorSchema
      }
    }
  }, async (request: FastifyRequest<{ Params: PaymentIntentIdParam }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id: paymentIntentId } = request.params;

      logger.info('Canceling payment intent', {
        tenantId: user.tenant_id,
        userId: user.id,
        paymentIntentId
      });

      // Check if payment exists and can be canceled
      const paymentResult = await fastify.pg.query(`
        SELECT * FROM payments
        WHERE provider_payment_intent_id = $1 AND tenant_id = $2
        AND status NOT IN ('succeeded', 'canceled', 'failed')
      `, [paymentIntentId, user.tenant_id]);

      if (paymentResult.rows.length === 0) {
        return reply.code(404).send({
          error: 'PAYMENT_INTENT_NOT_FOUND',
          message: 'Payment intent not found or cannot be canceled'
        });
      }

      const payment = paymentResult.rows[0];

      // Update payment status to canceled
      await fastify.pg.query(`
        UPDATE payments
        SET status = 'canceled', updated_at = NOW()
        WHERE provider_payment_intent_id = $1 AND tenant_id = $2
      `, [paymentIntentId, user.tenant_id]);

      // Create mock payment intent response
      const paymentIntent = {
        id: paymentIntentId,
        object: 'payment_intent' as const,
        amount: payment.amount_jpy,
        amount_capturable: 0,
        amount_received: 0,
        capture_method: 'automatic' as const,
        client_secret: `${paymentIntentId}_secret_canceled`,
        confirmation_method: 'automatic' as const,
        created: Math.floor(Date.now() / 1000),
        currency: payment.currency.toLowerCase(),
        customer: user.id,
        description: `Payment for booking ${payment.booking_id}`,
        metadata: {},
        payment_method_types: ['card'],
        status: 'canceled' as const,
        cancellation_reason: 'requested_by_customer'
      };

      logger.info('Payment intent canceled successfully', {
        tenantId: user.tenant_id,
        userId: user.id,
        paymentIntentId
      });

      return reply.code(200).send({
        success: true,
        payment_intent: paymentIntent,
        message: 'Payment intent canceled successfully'
      });

    } catch (error) {
      logger.error('Error canceling payment intent', {
        error: error.message,
        tenantId: request.user?.tenant_id,
        userId: request.user?.id,
        paymentIntentId: request.params.id
      });

      return reply.code(500).send({
        success: false,
        message: 'An unexpected error occurred while canceling the payment intent'
      });
    }
  });

  // Health check endpoint
  fastify.get('/health', {
    schema: {
      description: 'Health check for payments service',
      tags: ['Health'],
      response: {
        200: Type.Object({
          status: Type.String(),
          timestamp: Type.String({ format: 'date-time' }),
          service: Type.String()
        })
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'payments'
    });
  });
};

export default paymentsRoutes;