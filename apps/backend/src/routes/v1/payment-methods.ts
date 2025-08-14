/**
 * Payment Methods API Routes
 * Handles payment method management operations
 */

import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import {
  AddPaymentMethodRequestSchema,
  AddPaymentMethodResponseSchema,
  ListPaymentMethodsResponseSchema,
  SetDefaultPaymentMethodRequestSchema,
  SetDefaultPaymentMethodResponseSchema,
  DeletePaymentMethodResponseSchema,
  PaymentMethodIdParamSchema,
  ErrorSchema,
  RateLimitHeadersSchema,
  type AddPaymentMethodRequest,
  type SetDefaultPaymentMethodRequest,
  type PaymentMethodIdParam
} from '../../schemas/payment.js';
import { createPaymentService } from '../../services/payment.service.js';
import { logger } from '../../config/logger.js';
import { Type } from '@sinclair/typebox';

/**
 * Rate limiting configuration for payment method operations
 */
const RATE_LIMITS = {
  ADD_PAYMENT_METHOD: { max: 10, window: '1h' }, // 10 per hour
  DELETE_PAYMENT_METHOD: { max: 20, window: '1h' }, // 20 per hour
  LIST_PAYMENT_METHODS: { max: 100, window: '1h' }, // 100 per hour
  SET_DEFAULT: { max: 50, window: '1h' } // 50 per hour
};

/**
 * Payment Methods routes plugin
 */
const paymentMethodsRoutes: FastifyPluginAsync = async function (fastify: FastifyInstance) {
  // Initialize payment service
  const paymentService = createPaymentService(fastify.pg, {
    provider: 'mock',
    currency: 'JPY'
  });

  /**
   * POST /v1/payment-methods
   * Add a new payment method for the authenticated user
   */
  fastify.post('/', {
    preHandler: [
      fastify.authenticate,
      fastify.rateLimit({
        max: RATE_LIMITS.ADD_PAYMENT_METHOD.max,
        timeWindow: RATE_LIMITS.ADD_PAYMENT_METHOD.window,
        keyGenerator: (request) => `add-pm:${request.user?.tenant_id}:${request.user?.id}`,
        errorResponseBuilder: () => ({
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many payment method creation attempts. Please try again later.'
        })
      })
    ],
    schema: {
      description: 'Add a new payment method for the authenticated user',
      tags: ['Payment Methods'],
      security: [{ bearerAuth: [] }],
      body: AddPaymentMethodRequestSchema,
      response: {
        201: AddPaymentMethodResponseSchema,
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
  }, async (request: FastifyRequest<{ Body: AddPaymentMethodRequest }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { payment_method, set_as_default = false, customer_data } = request.body;

      logger.info('Adding payment method', {
        tenantId: user.tenant_id,
        userId: user.id,
        paymentMethodType: payment_method.type
      });

      // Prepare save payment method request
      const saveRequest = {
        tenantId: user.tenant_id,
        customerId: user.id,
        paymentMethodData: payment_method,
        setAsDefault: set_as_default
      };

      // If customer data is provided, include it in the request
      if (customer_data) {
        // Get or create customer with provided data
        await paymentService.createOrGetCustomer(
          user.tenant_id,
          user.id,
          {
            email: customer_data.email,
            name: customer_data.name,
            phone: customer_data.phone,
            metadata: {
              tenant_id: user.tenant_id,
              user_id: user.id
            }
          }
        );
      }

      // Save the payment method
      const result = await paymentService.savePaymentMethod(saveRequest);

      if (!result.success) {
        logger.error('Failed to add payment method', {
          tenantId: user.tenant_id,
          userId: user.id,
          error: result.error?.message
        });

        return reply.code(400).send({
          error: result.error?.type || 'PAYMENT_METHOD_ERROR',
          message: result.error?.message || 'Failed to add payment method'
        });
      }

      // Check if this is a SetupIntent that requires client-side completion
      if (result.data && 'client_secret' in result.data) {
        return reply.code(201).send({
          success: true,
          setup_intent: {
            id: result.data.id,
            client_secret: result.data.client_secret,
            status: result.data.status
          },
          message: 'Payment method setup initiated. Complete the setup on the client side.'
        });
      }

      // Payment method was added successfully
      return reply.code(201).send({
        success: true,
        payment_method: result.data,
        message: 'Payment method added successfully'
      });

    } catch (error) {
      logger.error('Error adding payment method', {
        error: error.message,
        tenantId: request.user?.tenant_id,
        userId: request.user?.id
      });

      return reply.code(500).send({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred while adding the payment method'
      });
    }
  });

  /**
   * GET /v1/payment-methods
   * List all payment methods for the authenticated user
   */
  fastify.get('/', {
    preHandler: [
      fastify.authenticate,
      fastify.rateLimit({
        max: RATE_LIMITS.LIST_PAYMENT_METHODS.max,
        timeWindow: RATE_LIMITS.LIST_PAYMENT_METHODS.window,
        keyGenerator: (request) => `list-pm:${request.user?.tenant_id}:${request.user?.id}`,
        errorResponseBuilder: () => ({
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.'
        })
      })
    ],
    schema: {
      description: 'List all payment methods for the authenticated user',
      tags: ['Payment Methods'],
      security: [{ bearerAuth: [] }],
      response: {
        200: ListPaymentMethodsResponseSchema,
        401: Type.Object({
          error: Type.String(),
          message: Type.String()
        }),
        429: Type.Object({
          error: Type.String(),
          message: Type.String()
        }),
        500: ErrorSchema
      },
      headers: RateLimitHeadersSchema
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;

      logger.info('Listing payment methods', {
        tenantId: user.tenant_id,
        userId: user.id
      });

      // Get payment methods from the database
      const result = await paymentService.getPaymentMethods(user.tenant_id, user.id);

      if (!result.success) {
        logger.error('Failed to list payment methods', {
          tenantId: user.tenant_id,
          userId: user.id,
          error: result.error?.message
        });

        return reply.code(500).send({
          error: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to retrieve payment methods'
        });
      }

      // Transform database entities to API response format
      const paymentMethods = result.data?.map(pm => ({
        id: pm.provider_pm_id || pm.id,
        type: 'card' as const, // Default to card, can be enhanced later
        card: {
          // These would come from the payment provider in a real implementation
          id: pm.provider_pm_id || pm.id,
          brand: 'visa' as const,
          last4: '4242', // Mock data
          exp_month: 12,
          exp_year: 2025,
          country: 'JP'
        },
        billing_details: {
          // Mock billing details - would come from provider
          name: 'Customer Name',
          email: 'customer@example.com'
        },
        is_default: pm.is_default,
        created_at: pm.created_at?.toISOString() || new Date().toISOString(),
        metadata: {}
      })) || [];

      return reply.code(200).send({
        payment_methods: paymentMethods
      });

    } catch (error) {
      logger.error('Error listing payment methods', {
        error: error.message,
        tenantId: request.user?.tenant_id,
        userId: request.user?.id
      });

      return reply.code(500).send({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred while retrieving payment methods'
      });
    }
  });

  /**
   * PUT /v1/payment-methods/:id/default
   * Set a payment method as the default
   */
  fastify.put('/:id/default', {
    preHandler: [
      fastify.authenticate,
      fastify.rateLimit({
        max: RATE_LIMITS.SET_DEFAULT.max,
        timeWindow: RATE_LIMITS.SET_DEFAULT.window,
        keyGenerator: (request) => `set-default-pm:${request.user?.tenant_id}:${request.user?.id}`,
        errorResponseBuilder: () => ({
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.'
        })
      })
    ],
    schema: {
      description: 'Set a payment method as the default for the authenticated user',
      tags: ['Payment Methods'],
      security: [{ bearerAuth: [] }],
      params: PaymentMethodIdParamSchema,
      response: {
        200: SetDefaultPaymentMethodResponseSchema,
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
      },
      headers: RateLimitHeadersSchema
    }
  }, async (request: FastifyRequest<{ Params: PaymentMethodIdParam }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id: paymentMethodId } = request.params;

      logger.info('Setting default payment method', {
        tenantId: user.tenant_id,
        userId: user.id,
        paymentMethodId
      });

      // Check if payment method exists and belongs to the user
      const result = await fastify.pg.query(`
        SELECT id FROM payment_methods
        WHERE tenant_id = $1 AND customer_id = $2 AND (id = $3 OR provider_pm_id = $3)
      `, [user.tenant_id, user.id, paymentMethodId]);

      if (result.rows.length === 0) {
        return reply.code(404).send({
          error: 'PAYMENT_METHOD_NOT_FOUND',
          message: 'Payment method not found or does not belong to you'
        });
      }

      // Start transaction
      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');

        // Unset all current default payment methods for this user
        await client.query(`
          UPDATE payment_methods
          SET is_default = false, updated_at = NOW()
          WHERE tenant_id = $1 AND customer_id = $2
        `, [user.tenant_id, user.id]);

        // Set the specified payment method as default
        const updateResult = await client.query(`
          UPDATE payment_methods
          SET is_default = true, updated_at = NOW()
          WHERE tenant_id = $1 AND customer_id = $2 AND (id = $3 OR provider_pm_id = $3)
        `, [user.tenant_id, user.id, paymentMethodId]);

        await client.query('COMMIT');

        logger.info('Default payment method set successfully', {
          tenantId: user.tenant_id,
          userId: user.id,
          paymentMethodId
        });

        return reply.code(200).send({
          message: 'Default payment method updated successfully',
          updated: updateResult.rowCount > 0
        });

      } catch (dbError) {
        await client.query('ROLLBACK');
        throw dbError;
      } finally {
        client.release();
      }

    } catch (error) {
      logger.error('Error setting default payment method', {
        error: error.message,
        tenantId: request.user?.tenant_id,
        userId: request.user?.id,
        paymentMethodId: request.params.id
      });

      return reply.code(500).send({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred while updating the default payment method'
      });
    }
  });

  /**
   * DELETE /v1/payment-methods/:id
   * Remove a payment method
   */
  fastify.delete('/:id', {
    preHandler: [
      fastify.authenticate,
      fastify.rateLimit({
        max: RATE_LIMITS.DELETE_PAYMENT_METHOD.max,
        timeWindow: RATE_LIMITS.DELETE_PAYMENT_METHOD.window,
        keyGenerator: (request) => `delete-pm:${request.user?.tenant_id}:${request.user?.id}`,
        errorResponseBuilder: () => ({
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many deletion attempts. Please try again later.'
        })
      })
    ],
    schema: {
      description: 'Remove a payment method for the authenticated user',
      tags: ['Payment Methods'],
      security: [{ bearerAuth: [] }],
      params: PaymentMethodIdParamSchema,
      response: {
        200: DeletePaymentMethodResponseSchema,
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
      },
      headers: RateLimitHeadersSchema
    }
  }, async (request: FastifyRequest<{ Params: PaymentMethodIdParam }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id: paymentMethodId } = request.params;

      logger.info('Deleting payment method', {
        tenantId: user.tenant_id,
        userId: user.id,
        paymentMethodId
      });

      // Check if payment method exists and belongs to the user
      const result = await fastify.pg.query(`
        SELECT id, provider_pm_id, is_default FROM payment_methods
        WHERE tenant_id = $1 AND customer_id = $2 AND (id = $3 OR provider_pm_id = $3)
      `, [user.tenant_id, user.id, paymentMethodId]);

      if (result.rows.length === 0) {
        return reply.code(404).send({
          error: 'PAYMENT_METHOD_NOT_FOUND',
          message: 'Payment method not found or does not belong to you'
        });
      }

      const paymentMethod = result.rows[0];

      // Start transaction
      const client = await fastify.pg.connect();
      try {
        await client.query('BEGIN');

        // In a real implementation, we would also detach the payment method from Stripe
        // For mock implementation, we'll just soft delete from our database
        const deleteResult = await client.query(`
          UPDATE payment_methods
          SET deleted_at = NOW(), updated_at = NOW()
          WHERE tenant_id = $1 AND customer_id = $2 AND (id = $3 OR provider_pm_id = $3)
        `, [user.tenant_id, user.id, paymentMethodId]);

        // If this was the default payment method, set another one as default
        if (paymentMethod.is_default) {
          await client.query(`
            UPDATE payment_methods
            SET is_default = true, updated_at = NOW()
            WHERE tenant_id = $1 AND customer_id = $2 AND deleted_at IS NULL AND id != $3
            ORDER BY created_at ASC
            LIMIT 1
          `, [user.tenant_id, user.id, paymentMethod.id]);
        }

        await client.query('COMMIT');

        logger.info('Payment method deleted successfully', {
          tenantId: user.tenant_id,
          userId: user.id,
          paymentMethodId
        });

        return reply.code(200).send({
          message: 'Payment method removed successfully',
          deleted: deleteResult.rowCount > 0
        });

      } catch (dbError) {
        await client.query('ROLLBACK');
        throw dbError;
      } finally {
        client.release();
      }

    } catch (error) {
      logger.error('Error deleting payment method', {
        error: error.message,
        tenantId: request.user?.tenant_id,
        userId: request.user?.id,
        paymentMethodId: request.params.id
      });

      return reply.code(500).send({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred while removing the payment method'
      });
    }
  });

  // Health check endpoint for payment methods service
  fastify.get('/health', {
    schema: {
      description: 'Health check for payment methods service',
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
      service: 'payment-methods'
    });
  });
};

export default paymentMethodsRoutes;