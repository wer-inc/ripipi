/**
 * Public Booking API Routes
 * Public-facing endpoints for booking creation with mandatory idempotency
 * and optimized for high-throughput with caching
 */

import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { BookingService } from '../../services/booking.service.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { 
  BadRequestError, 
  ConflictError,
  ValidationError 
} from '../../utils/errors.js';
import { logger } from '../../config/logger.js';

/**
 * Public booking request schema
 */
const PublicBookingRequestSchema = Type.Object({
  tenant_id: Type.Integer({ description: 'Tenant ID' }),
  service_id: Type.Integer({ description: 'Service ID' }),
  timeslot_ids: Type.Array(Type.Integer(), { description: 'Array of timeslot IDs to book' }),
  customer: Type.Object({
    name: Type.String({ minLength: 1, maxLength: 255 }),
    phone: Type.Optional(Type.String({ pattern: '^\\+?[1-9]\\d{1,14}$' })),
    email: Type.Optional(Type.String({ format: 'email' })),
    line_user_id: Type.Optional(Type.String())
  }),
  notes: Type.Optional(Type.String({ maxLength: 1000 })),
  consent_version: Type.Optional(Type.String()),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Any()))
});

/**
 * Public booking response schema
 */
const PublicBookingResponseSchema = Type.Object({
  booking_id: Type.Integer(),
  tenant_id: Type.Integer(),
  service_id: Type.Integer(),
  customer_id: Type.Integer(),
  start_at: Type.String({ format: 'date-time' }),
  end_at: Type.String({ format: 'date-time' }),
  status: Type.String(),
  total_jpy: Type.Integer(),
  created_at: Type.String({ format: 'date-time' }),
  updated_at: Type.String({ format: 'date-time' })
});

/**
 * Error response schema (problem+json)
 */
const ProblemDetailSchema = Type.Object({
  type: Type.Optional(Type.String({ format: 'uri' })),
  title: Type.String(),
  status: Type.Integer(),
  detail: Type.Optional(Type.String()),
  instance: Type.Optional(Type.String({ format: 'uri' })),
  code: Type.String(),
  message: Type.String(),
  details: Type.Optional(Type.Array(Type.Object({
    field: Type.Optional(Type.String()),
    reason: Type.String()
  })))
});

/**
 * Register public booking routes
 */
export async function publicBookingRoutes(
  fastify: FastifyInstance,
  options: Record<string, any> = {}
): Promise<void> {
  const bookingService = new BookingService(fastify);

  /**
   * POST /v1/public/bookings - Create a public booking
   * Idempotency-Key header is REQUIRED
   */
  fastify.route({
    method: 'POST',
    url: '/v1/public/bookings',
    schema: {
      tags: ['Public Bookings'],
      summary: 'Create a new booking (public)',
      description: 'Creates a new booking with mandatory idempotency key for duplicate prevention',
      headers: Type.Object({
        'idempotency-key': Type.String({ 
          minLength: 8, 
          maxLength: 128,
          description: 'Required idempotency key (UUID recommended)'
        }),
        'content-type': Type.Literal('application/json')
      }),
      body: PublicBookingRequestSchema,
      response: {
        201: PublicBookingResponseSchema,
        400: ProblemDetailSchema,
        409: ProblemDetailSchema,
        429: ProblemDetailSchema,
        500: ProblemDetailSchema
      }
    },
    preHandler: [
      // Rate limiting for public endpoints
      fastify.rateLimit({
        max: 5,
        timeWindow: '1 minute',
        keyGenerator: (request) => {
          // Rate limit by IP + tenant combination
          const tenantId = (request.body as any)?.tenant_id || 'unknown';
          return `${request.ip}:${tenantId}`;
        },
        errorResponseBuilder: (request, context) => {
          return {
            type: '/errors/rate-limited',
            title: 'Too Many Requests',
            status: 429,
            detail: `Rate limit exceeded. Max ${context.max} requests per ${context.after}`,
            code: 'rate_limited',
            message: 'Too many booking attempts. Please try again later.',
            details: []
          };
        }
      })
    ],
    handler: asyncHandler(async (request, reply) => {
      const body = request.body as any;
      const idempotencyKey = request.headers['idempotency-key'] as string;

      // This is enforced by schema, but double-check
      if (!idempotencyKey) {
        throw new BadRequestError('Idempotency-Key header is required');
      }

      logger.info('Processing public booking request', {
        tenantId: body.tenant_id,
        serviceId: body.service_id,
        timeslotCount: body.timeslot_ids.length,
        idempotencyKey
      });

      try {
        // Create booking with atomic timeslot capacity reduction
        const booking = await bookingService.createPublicBooking({
          ...body,
          idempotencyKey
        });

        // Set response headers
        reply.header('X-Idempotency-Key', idempotencyKey);
        reply.header('Cache-Control', 'no-store');
        reply.header('ETag', `"${booking.booking_id}-${booking.updated_at}"`);

        return reply.status(201).send(booking);

      } catch (error: any) {
        // Handle specific errors with problem+json format
        if (error.code === 'TIMESLOT_SOLD_OUT') {
          throw new ConflictError('Selected timeslot is no longer available', {
            code: 'timeslot_sold_out',
            details: error.details
          });
        }

        if (error.code === 'DOUBLE_BOOKING') {
          throw new ConflictError('Double booking detected', {
            code: 'double_booking',
            details: error.details
          });
        }

        if (error.code === 'IDEMPOTENCY_CONFLICT') {
          throw new ConflictError('Idempotency key already used with different request', {
            code: 'idempotency_conflict',
            details: error.details
          });
        }

        throw error;
      }
    })
  });
}

export default publicBookingRoutes;