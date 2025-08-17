/**
 * Public Availability API Routes
 * Public-facing endpoints for checking availability with ETag support
 * and aggressive caching for optimal performance
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from '@sinclair/typebox';
import { AvailabilityService } from '../../services/availability.service.js';
import { CacheService } from '../../services/cache.service.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { BadRequestError, NotFoundError } from '../../utils/errors.js';
import { logger } from '../../config/logger.js';
import crypto from 'crypto';

/**
 * Availability query schema
 */
const AvailabilityQuerySchema = Type.Object({
  tenant_id: Type.Integer({ description: 'Tenant ID' }),
  service_id: Type.Integer({ description: 'Service ID' }),
  from: Type.String({ 
    format: 'date-time',
    description: 'Start of availability range (ISO8601)'
  }),
  to: Type.String({ 
    format: 'date-time',
    description: 'End of availability range (ISO8601)'
  }),
  resource_id: Type.Optional(Type.Integer({ description: 'Optional specific resource ID' })),
  granularity_min: Type.Optional(Type.Integer({ 
    minimum: 5,
    maximum: 60,
    default: 15,
    description: 'Display granularity in minutes'
  }))
});

/**
 * Timeslot response schema
 */
const TimeslotSchema = Type.Object({
  timeslot_id: Type.Integer(),
  tenant_id: Type.Integer(),
  service_id: Type.Integer(),
  resource_id: Type.Integer(),
  start_at: Type.String({ format: 'date-time' }),
  end_at: Type.String({ format: 'date-time' }),
  available_capacity: Type.Integer()
});

/**
 * Error response schema
 */
const ErrorResponseSchema = Type.Object({
  code: Type.String(),
  message: Type.String(),
  details: Type.Optional(Type.Array(Type.Object({
    field: Type.Optional(Type.String()),
    reason: Type.String()
  })))
});

/**
 * Generate ETag for availability data
 */
function generateETag(
  tenantId: number,
  serviceId: number,
  from: string,
  to: string,
  resourceId?: number,
  lastModified?: Date
): string {
  const data = {
    tenantId,
    serviceId,
    from,
    to,
    resourceId,
    lastModified: lastModified?.toISOString() || new Date().toISOString()
  };
  
  const hash = crypto
    .createHash('md5')
    .update(JSON.stringify(data))
    .digest('hex');
  
  return `W/"${hash}"`;
}

/**
 * Parse date range and validate
 */
function validateDateRange(from: string, to: string): { fromDate: Date; toDate: Date } {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    throw new BadRequestError('Invalid date format');
  }
  
  if (fromDate >= toDate) {
    throw new BadRequestError('From date must be before to date');
  }
  
  // Max range of 90 days
  const maxRangeMs = 90 * 24 * 60 * 60 * 1000;
  if (toDate.getTime() - fromDate.getTime() > maxRangeMs) {
    throw new BadRequestError('Date range cannot exceed 90 days');
  }
  
  return { fromDate, toDate };
}

/**
 * Register public availability routes
 */
export async function publicAvailabilityRoutes(
  fastify: FastifyInstance,
  options: Record<string, any> = {}
): Promise<void> {
  const availabilityService = new AvailabilityService(fastify);
  const cacheService = new CacheService(fastify);

  /**
   * GET /v1/public/availability - Check availability
   * Supports ETag and conditional requests
   */
  fastify.route({
    method: 'GET',
    url: '/v1/public/availability',
    schema: {
      tags: ['Public Availability'],
      summary: 'Check service availability',
      description: 'Returns available timeslots with ETag support for efficient caching',
      querystring: AvailabilityQuerySchema,
      headers: Type.Object({
        'if-none-match': Type.Optional(Type.String({ 
          description: 'ETag for conditional request'
        }))
      }),
      response: {
        200: Type.Array(TimeslotSchema),
        304: Type.Null({ description: 'Not Modified - cached data is still valid' }),
        400: ErrorResponseSchema,
        404: ErrorResponseSchema,
        429: ErrorResponseSchema
      }
    },
    preHandler: [
      // Rate limiting for public endpoints
      fastify.rateLimit({
        max: 20,
        timeWindow: '1 minute',
        keyGenerator: (request) => {
          const query = request.query as any;
          return `${request.ip}:${query.tenant_id}`;
        }
      })
    ],
    handler: asyncHandler(async (request: FastifyRequest, reply) => {
      const query = request.query as any;
      const ifNoneMatch = request.headers['if-none-match'];

      // Validate date range
      const { fromDate, toDate } = validateDateRange(query.from, query.to);

      logger.debug('Processing availability request', {
        tenantId: query.tenant_id,
        serviceId: query.service_id,
        from: query.from,
        to: query.to,
        resourceId: query.resource_id,
        ifNoneMatch
      });

      // Generate cache key
      const cacheKey = `availability:${query.tenant_id}:${query.service_id}:${query.from}:${query.to}:${query.resource_id || 'all'}`;

      // Check cache first
      const cachedData = await cacheService.get(cacheKey);
      
      if (cachedData) {
        const { data, etag, lastModified } = cachedData;
        
        // Check if client has valid cached version
        if (ifNoneMatch && ifNoneMatch === etag) {
          logger.debug('Returning 304 Not Modified', { etag });
          
          // Set headers
          reply.header('ETag', etag);
          reply.header('Cache-Control', 'private, max-age=15');
          reply.header('Last-Modified', lastModified);
          reply.header('X-Cache-Status', 'hit');
          
          return reply.status(304).send();
        }
        
        // Return cached data with ETag
        reply.header('ETag', etag);
        reply.header('Cache-Control', 'private, max-age=15');
        reply.header('Last-Modified', lastModified);
        reply.header('X-Cache-Status', 'hit');
        
        return data;
      }

      // Fetch fresh data
      const availabilityQuery = {
        tenantId: query.tenant_id,
        serviceId: query.service_id,
        startTime: fromDate,
        endTime: toDate,
        resourceId: query.resource_id,
        granularity: query.granularity_min || 15
      };

      const timeslots = await availabilityService.searchAvailability(availabilityQuery);

      // Generate ETag for new data
      const lastModified = new Date();
      const etag = generateETag(
        query.tenant_id,
        query.service_id,
        query.from,
        query.to,
        query.resource_id,
        lastModified
      );

      // Cache the response (15 seconds TTL)
      await cacheService.set(cacheKey, {
        data: timeslots,
        etag,
        lastModified: lastModified.toUTCString()
      }, 15);

      // Check if client has this version
      if (ifNoneMatch && ifNoneMatch === etag) {
        reply.header('ETag', etag);
        reply.header('Cache-Control', 'private, max-age=15');
        reply.header('Last-Modified', lastModified.toUTCString());
        reply.header('X-Cache-Status', 'miss');
        
        return reply.status(304).send();
      }

      // Set response headers
      reply.header('ETag', etag);
      reply.header('Cache-Control', 'private, max-age=15');
      reply.header('Last-Modified', lastModified.toUTCString());
      reply.header('X-Cache-Status', 'miss');
      reply.header('X-Total-Count', String(timeslots.length));

      // Add rate limit headers
      const rateLimit = (request as any).rateLimit;
      if (rateLimit) {
        reply.header('X-RateLimit-Limit', String(rateLimit.limit));
        reply.header('X-RateLimit-Remaining', String(rateLimit.remaining));
        reply.header('X-RateLimit-Reset', new Date(rateLimit.reset).toISOString());
        
        if (rateLimit.remaining === 0) {
          reply.header('Retry-After', String(Math.ceil((rateLimit.reset - Date.now()) / 1000)));
        }
      }

      return timeslots;
    })
  });
}

export default publicAvailabilityRoutes;