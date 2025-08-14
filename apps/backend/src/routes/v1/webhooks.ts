/**
 * Webhook Routes
 * API endpoints for handling Stripe webhook events
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { 
  WebhookEvent,
  WebhookRequestSchema,
  WebhookResponseSchema,
  WebhookErrorResponseSchema,
  SupportedWebhookEventSchema
} from '../../schemas/webhook.js';
import { WebhookSignatureVerifier } from '../../utils/webhook-signature.js';
import WebhookService, { WebhookProcessingResult } from '../../services/webhook.service.js';
import { TenantContext } from '../../types/database.js';
import { logger } from '../../config/logger.js';
import { 
  BadRequestError, 
  InternalServerError,
  UnauthorizedError 
} from '../../utils/errors.js';
import { asyncHandler } from '../../utils/async-handler.js';

/**
 * Webhook request interface
 */
interface WebhookRequest extends FastifyRequest {
  body: string;
  headers: {
    'stripe-signature': string;
    'content-type'?: string;
  };
  raw?: Buffer;
  webhookSignature?: {
    verified: boolean;
    timestamp: number;
  };
}

/**
 * Webhook response interface
 */
interface WebhookResponse {
  received: boolean;
  eventId: string;
  eventType: string;
  processed: boolean;
  timestamp: number;
}

/**
 * Register webhook routes
 */
export default async function webhookRoutes(fastify: FastifyInstance) {
  const webhookService = new WebhookService(fastify);

  // Configure raw body parsing for webhook signature verification
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    function (req: any, body: Buffer, done: Function) {
      try {
        // Store raw body for signature verification
        req.raw = body;
        // Parse JSON for processing
        const json = JSON.parse(body.toString('utf8'));
        done(null, json);
      } catch (err) {
        done(err);
      }
    }
  );

  /**
   * POST /v1/webhooks/stripe
   * Main webhook endpoint for Stripe events
   */
  fastify.post<{
    Body: WebhookEvent;
    Headers: { 'stripe-signature': string };
  }>(
    '/stripe',
    {
      schema: {
        description: 'Handle Stripe webhook events',
        tags: ['webhooks'],
        headers: {
          type: 'object',
          properties: {
            'stripe-signature': {
              type: 'string',
              description: 'Stripe webhook signature header'
            }
          },
          required: ['stripe-signature']
        },
        body: {
          type: 'object',
          description: 'Stripe webhook event payload',
          additionalProperties: true
        },
        response: {
          200: {
            type: 'object',
            properties: {
              received: { type: 'boolean' },
              eventId: { type: 'string' },
              eventType: { type: 'string' },
              processed: { type: 'boolean' },
              timestamp: { type: 'number' }
            }
          },
          400: {
            type: 'object',
            properties: {
              error: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  message: { type: 'string' },
                  eventId: { type: 'string' },
                  eventType: { type: 'string' }
                }
              }
            }
          },
          401: {
            type: 'object',
            properties: {
              error: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  message: { type: 'string' }
                }
              }
            }
          },
          500: {
            type: 'object',
            properties: {
              error: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  message: { type: 'string' },
                  eventId: { type: 'string' },
                  eventType: { type: 'string' }
                }
              }
            }
          }
        }
      },
      // Disable CSRF protection for webhooks
      config: {
        rateLimit: {
          max: 1000,
          timeWindow: '1 minute'
        }
      },
      preHandler: [
        // Raw body preservation and signature verification
        async function verifyWebhookSignature(request: WebhookRequest, reply: FastifyReply) {
          try {
            const signature = request.headers['stripe-signature'];
            if (!signature) {
              throw new BadRequestError('Missing Stripe-Signature header');
            }

            // Get raw body for signature verification
            const rawBody = request.raw;
            if (!rawBody) {
              throw new BadRequestError('Missing request body');
            }

            const payload = rawBody.toString('utf8');

            // Verify signature
            const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
            const verificationResult = WebhookSignatureVerifier.verifySignature(
              payload,
              signature,
              webhookSecret
            );

            if (!verificationResult.isValid) {
              logger.warn('Webhook signature verification failed', {
                error: verificationResult.error,
                signature: signature.substring(0, 20) + '...',
                payloadLength: payload.length
              });
              throw new UnauthorizedError(`Webhook signature verification failed: ${verificationResult.error}`);
            }

            // Store verification result for later use
            request.webhookSignature = {
              verified: true,
              timestamp: verificationResult.timestamp || Math.floor(Date.now() / 1000)
            };

            logger.debug('Webhook signature verified successfully', {
              eventId: verificationResult.eventId,
              timestamp: verificationResult.timestamp
            });

          } catch (error) {
            logger.error('Webhook signature verification error', {
              error: error.message,
              headers: request.headers
            });
            throw error;
          }
        }
      ]
    },
    asyncHandler(async (request: WebhookRequest, reply: FastifyReply) => {
      const startTime = Date.now();
      let eventId = 'unknown';
      let eventType = 'unknown';

      try {
        // Parse webhook event
        const webhookEvent = request.body as WebhookEvent;
        eventId = webhookEvent.id;
        eventType = webhookEvent.type;

        logger.info('Received webhook event', {
          eventId,
          eventType,
          livemode: webhookEvent.livemode,
          apiVersion: webhookEvent.api_version,
          timestamp: request.webhookSignature?.timestamp
        });

        // Validate event structure
        const validatedEvent = SupportedWebhookEventSchema.parse(webhookEvent);

        // Create tenant context (webhooks don't have explicit tenant, derive from metadata or config)
        const tenantContext: TenantContext = {
          tenantId: webhookEvent.data.object.metadata?.tenant_id || 
                   process.env.DEFAULT_TENANT_ID || 
                   'default',
          userId: 'webhook-system',
          db: fastify.db
        };

        // Process the webhook event
        const result: WebhookProcessingResult = await webhookService.processWebhookEvent(
          validatedEvent,
          tenantContext
        );

        // Prepare response
        const response: WebhookResponse = {
          received: true,
          eventId: result.eventId,
          eventType: result.eventType,
          processed: result.processed,
          timestamp: startTime
        };

        logger.info('Webhook event processed successfully', {
          eventId,
          eventType,
          processed: result.processed,
          duration: Date.now() - startTime,
          actions: result.actions
        });

        // Return 200 OK for successful processing
        reply.status(200).send(response);

      } catch (error) {
        const duration = Date.now() - startTime;
        
        logger.error('Webhook processing failed', {
          eventId,
          eventType,
          error: error.message,
          stack: error.stack,
          duration
        });

        // Determine error status code
        let statusCode = 500;
        let errorType = 'internal_error';

        if (error instanceof BadRequestError) {
          statusCode = 400;
          errorType = 'invalid_request';
        } else if (error instanceof UnauthorizedError) {
          statusCode = 401;
          errorType = 'authentication_error';
        }

        // Send error response
        reply.status(statusCode).send({
          error: {
            type: errorType,
            message: error.message,
            eventId,
            eventType
          }
        });
      }
    })
  );

  /**
   * GET /v1/webhooks/stripe/events/:eventId
   * Retrieve webhook event details
   */
  fastify.get<{
    Params: { eventId: string };
  }>(
    '/stripe/events/:eventId',
    {
      schema: {
        description: 'Get webhook event details',
        tags: ['webhooks'],
        params: {
          type: 'object',
          properties: {
            eventId: { type: 'string' }
          },
          required: ['eventId']
        },
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              tenantId: { type: 'string' },
              provider: { type: 'string' },
              eventId: { type: 'string' },
              receivedAt: { type: 'string', format: 'date-time' },
              payload: { type: 'object' },
              handledAt: { type: 'string', format: 'date-time' },
              status: { type: 'string' },
              errorMessage: { type: 'string' }
            }
          },
          404: {
            type: 'object',
            properties: {
              error: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  message: { type: 'string' }
                }
              }
            }
          }
        }
      },
      preHandler: [fastify.authenticate, fastify.authorize(['webhook:read'])]
    },
    asyncHandler(async (request, reply) => {
      const { eventId } = request.params;
      const context = request.tenantContext as TenantContext;

      logger.debug('Retrieving webhook event', {
        eventId,
        tenantId: context.tenantId,
        userId: context.userId
      });

      const webhookEvent = await webhookService.getWebhookEvent(eventId, context);

      if (!webhookEvent) {
        reply.status(404).send({
          error: {
            type: 'not_found',
            message: `Webhook event not found: ${eventId}`
          }
        });
        return;
      }

      reply.send(webhookEvent);
    })
  );

  /**
   * GET /v1/webhooks/stripe/metrics
   * Get webhook processing metrics
   */
  fastify.get(
    '/stripe/metrics',
    {
      schema: {
        description: 'Get webhook processing metrics',
        tags: ['webhooks'],
        response: {
          200: {
            type: 'object',
            properties: {
              totalEvents: { type: 'number' },
              processedEvents: { type: 'number' },
              failedEvents: { type: 'number' },
              duplicateEvents: { type: 'number' },
              eventsByType: { type: 'object' },
              lastReset: { type: 'string', format: 'date-time' }
            }
          }
        }
      },
      preHandler: [fastify.authenticate, fastify.authorize(['webhook:read', 'admin'])]
    },
    asyncHandler(async (request, reply) => {
      logger.debug('Retrieving webhook metrics', {
        userId: request.tenantContext?.userId
      });

      const metrics = webhookService.getWebhookMetrics();
      reply.send(metrics);
    })
  );

  /**
   * POST /v1/webhooks/stripe/metrics/reset
   * Reset webhook processing metrics
   */
  fastify.post(
    '/stripe/metrics/reset',
    {
      schema: {
        description: 'Reset webhook processing metrics',
        tags: ['webhooks'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              resetAt: { type: 'string', format: 'date-time' }
            }
          }
        }
      },
      preHandler: [fastify.authenticate, fastify.authorize(['webhook:write', 'admin'])]
    },
    asyncHandler(async (request, reply) => {
      logger.info('Resetting webhook metrics', {
        userId: request.tenantContext?.userId
      });

      webhookService.resetWebhookMetrics();

      reply.send({
        success: true,
        message: 'Webhook metrics reset successfully',
        resetAt: new Date().toISOString()
      });
    })
  );

  /**
   * POST /v1/webhooks/stripe/test
   * Test webhook endpoint with mock event (development only)
   */
  if (process.env.NODE_ENV === 'development') {
    fastify.post<{
      Body: {
        eventType: string;
        data?: any;
      };
    }>(
      '/stripe/test',
      {
        schema: {
          description: 'Test webhook with mock event (development only)',
          tags: ['webhooks'],
          body: {
            type: 'object',
            properties: {
              eventType: { type: 'string' },
              data: { type: 'object' }
            },
            required: ['eventType']
          },
          response: {
            200: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                mockEvent: { type: 'object' },
                signature: { type: 'string' },
                processingResult: { type: 'object' }
              }
            }
          }
        },
        preHandler: [fastify.authenticate, fastify.authorize(['webhook:test', 'admin'])]
      },
      asyncHandler(async (request, reply) => {
        const { eventType, data } = request.body;

        logger.info('Creating test webhook event', {
          eventType,
          userId: request.tenantContext?.userId
        });

        // Create mock webhook event
        const mockEvent: WebhookEvent = {
          id: `evt_test_${Date.now()}`,
          object: 'event',
          api_version: '2020-08-27',
          created: Math.floor(Date.now() / 1000),
          data: {
            object: data || {
              id: `test_${Date.now()}`,
              object: eventType.includes('payment_intent') ? 'payment_intent' : 'test',
              status: 'succeeded'
            }
          },
          livemode: false,
          pending_webhooks: 1,
          request: {
            id: `req_test_${Date.now()}`
          },
          type: eventType
        };

        // Generate mock signature
        const payload = JSON.stringify(mockEvent);
        const signature = WebhookSignatureVerifier.generateMockSignature(payload);

        // Process the mock event
        const tenantContext: TenantContext = {
          tenantId: request.tenantContext?.tenantId || 'test',
          userId: request.tenantContext?.userId || 'test-user',
          db: fastify.db
        };

        try {
          const processingResult = await webhookService.processWebhookEvent(
            mockEvent,
            tenantContext
          );

          reply.send({
            success: true,
            mockEvent,
            signature,
            processingResult
          });

        } catch (error) {
          reply.send({
            success: false,
            mockEvent,
            signature,
            processingResult: {
              error: error.message,
              eventId: mockEvent.id,
              eventType: mockEvent.type,
              processed: false,
              timestamp: Date.now()
            }
          });
        }
      })
    );
  }

  logger.info('Webhook routes registered successfully');
}