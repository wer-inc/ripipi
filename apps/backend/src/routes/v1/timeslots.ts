/**
 * Timeslot API Routes
 * RESTful API endpoints for timeslot generation and management
 * Implements POST /timeslots/generate and GET /timeslots
 */

import { FastifyInstance } from 'fastify';
import { 
  TimeslotGenerateRequestSchema,
  TimeslotGenerateResponseSchema,
  TimeslotGenerateDryRunResponseSchema,
  TimeslotQuerySchema,
  TimeslotSchema,
  ErrorResponseSchema,
  TimeslotGenerateRequest,
  TimeslotQuery
} from '../../schemas/timeslot.js';
import { TimeslotService } from '../../services/timeslot.service.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { 
  BadRequestError, 
  NotFoundError, 
  InternalServerError,
  ForbiddenError
} from '../../utils/errors.js';
import { logger } from '../../config/logger.js';

/**
 * Timeslot routes configuration
 */
export interface TimeslotRoutesOptions {
  enableRateLimit?: boolean;
  enableAnalytics?: boolean;
  maxGenerationRange?: number; // days
  defaultPageSize?: number;
  maxPageSize?: number;
}

/**
 * Register timeslot API routes
 */
export async function timeslotRoutes(
  fastify: FastifyInstance,
  options: TimeslotRoutesOptions = {}
): Promise<void> {
  const {
    enableRateLimit = true,
    enableAnalytics = true,
    maxGenerationRange = 120, // days
    defaultPageSize = 50,
    maxPageSize = 200
  } = options;

  // Initialize services
  const timeslotService = new TimeslotService(fastify);

  /**
   * POST /timeslots/generate - Generate time slots
   */
  fastify.route({
    method: 'POST',
    url: '/timeslots/generate',
    schema: {
      tags: ['Timeslots'],
      summary: 'Generate time slots',
      description: 'Generate time slots based on business hours, holidays, and availability patterns',
      body: TimeslotGenerateRequestSchema,
      response: {
        200: TimeslotGenerateResponseSchema,
        400: ErrorResponseSchema,
        403: ErrorResponseSchema,
        500: ErrorResponseSchema
      }
    },
    preHandler: [
      fastify.authenticate,
      fastify.tenantContext,
      fastify.authorize(['manager', 'owner', 'support']),
      ...(enableRateLimit ? [fastify.rateLimit({ max: 10, timeWindow: '5 minutes' })] : [])
    ],
    handler: asyncHandler(async (request, reply) => {
      const body = request.body as TimeslotGenerateRequest;
      const context = request.tenantContext;
      const correlationId = request.headers['x-correlation-id'] as string || `generate_${Date.now()}`;

      logger.info('Generating timeslots', {
        tenantId: context.tenantId,
        resourceId: body.resourceId,
        dateRange: `${body.startDate} to ${body.endDate}`,
        duration: body.duration,
        dryRun: body.dry_run,
        correlationId
      });

      try {
        // Validate tenant ID matches
        if (body.tenant_id !== parseInt(context.tenantId)) {
          throw new ForbiddenError('Tenant ID mismatch');
        }

        // Additional validation for date range
        const startDate = new Date(body.startDate);
        const endDate = new Date(body.endDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Prevent generating slots in the past (except for today)
        if (startDate < today) {
          throw new BadRequestError('Cannot generate slots for past dates');
        }

        // Limit generation range
        const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff > maxGenerationRange) {
          throw new BadRequestError(`Date range cannot exceed ${maxGenerationRange} days`);
        }

        // Check if resource exists and belongs to tenant
        await validateResourceAccess(fastify, context.tenantId, body.resourceId);

        // Generate slots
        const result = await timeslotService.generateSlots(body);

        // Record analytics if enabled
        if (enableAnalytics && !body.dry_run) {
          await recordTimeslotAnalytics('slots_generated', result, context, correlationId);
        }

        reply.send({
          ...result,
          metadata: {
            timestamp: new Date().toISOString(),
            correlation_id: correlationId,
            version: 'v1'
          }
        });

        logger.info('Timeslots generated successfully', {
          tenantId: context.tenantId,
          resourceId: body.resourceId,
          ...result,
          correlationId
        });

      } catch (error) {
        logger.error('Failed to generate timeslots', {
          tenantId: context.tenantId,
          resourceId: body.resourceId,
          error: error.message,
          correlationId
        });

        if (error instanceof BadRequestError || error instanceof ForbiddenError || error instanceof NotFoundError) {
          throw error;
        }

        throw new InternalServerError('Failed to generate timeslots');
      }
    })
  });

  /**
   * GET /timeslots - Search and list timeslots
   */
  fastify.route({
    method: 'GET',
    url: '/timeslots',
    schema: {
      tags: ['Timeslots'],
      summary: 'List timeslots',
      description: 'Retrieve timeslots with filtering and pagination',
      querystring: TimeslotQuerySchema,
      response: {
        200: {
          type: 'array',
          items: TimeslotSchema
        },
        400: ErrorResponseSchema,
        500: ErrorResponseSchema
      }
    },
    preHandler: [
      fastify.authenticate,
      fastify.tenantContext,
      fastify.authorize(['staff', 'manager', 'owner', 'support']),
      ...(enableRateLimit ? [fastify.rateLimit({ max: 100, timeWindow: '1 minute' })] : [])
    ],
    handler: asyncHandler(async (request, reply) => {
      const query = request.query as TimeslotQuery;
      const context = request.tenantContext;
      const correlationId = request.headers['x-correlation-id'] as string || `list_${Date.now()}`;

      logger.info('Retrieving timeslots', {
        tenantId: context.tenantId,
        serviceId: query.service_id,
        resourceId: query.resource_id,
        dateRange: `${query.from} to ${query.to}`,
        correlationId
      });

      try {
        // Validate tenant ID matches
        if (query.tenant_id !== parseInt(context.tenantId)) {
          throw new ForbiddenError('Tenant ID mismatch');
        }

        // Validate date parameters
        const fromDate = new Date(query.from);
        const toDate = new Date(query.to);

        if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
          throw new BadRequestError('Invalid date format. Use ISO 8601 format');
        }

        if (fromDate >= toDate) {
          throw new BadRequestError('From date must be before to date');
        }

        // Limit query range to prevent performance issues
        const daysDiff = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff > 90) {
          throw new BadRequestError('Date range cannot exceed 90 days');
        }

        // Validate pagination
        const limit = Math.min(query.limit || defaultPageSize, maxPageSize);
        
        // Check resource access if resource_id is provided
        if (query.resource_id) {
          await validateResourceAccess(fastify, context.tenantId, query.resource_id.toString());
        }

        // Get timeslots
        const result = await timeslotService.getTimeslots(
          query.tenant_id,
          query.service_id,
          query.resource_id,
          fromDate,
          toDate,
          query.cursor,
          limit
        );

        // Set pagination headers as per API specification
        if (result.nextCursor) {
          reply.header('X-Next-Cursor', result.nextCursor);
        }
        
        if (result.totalCount !== undefined) {
          reply.header('X-Total-Count', result.totalCount.toString());
        }

        // Return flat array as per API specification
        reply.send(result.slots);

        logger.info('Timeslots retrieved successfully', {
          tenantId: context.tenantId,
          count: result.slots.length,
          totalCount: result.totalCount,
          hasMore: !!result.nextCursor,
          correlationId
        });

      } catch (error) {
        logger.error('Failed to retrieve timeslots', {
          tenantId: context.tenantId,
          error: error.message,
          correlationId
        });

        if (error instanceof BadRequestError || error instanceof ForbiddenError) {
          throw error;
        }

        throw new InternalServerError('Failed to retrieve timeslots');
      }
    })
  });

  // Helper functions

  /**
   * Validate that the resource belongs to the tenant
   */
  async function validateResourceAccess(
    fastify: FastifyInstance, 
    tenantId: string, 
    resourceId: string
  ): Promise<void> {
    try {
      const result = await fastify.db.queryForTenant<{ id: string }>(
        tenantId,
        'SELECT id FROM resources WHERE id = $1',
        [resourceId]
      );

      if (result.rows.length === 0) {
        throw new NotFoundError(`Resource ${resourceId} not found`);
      }
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      
      logger.error('Failed to validate resource access', {
        tenantId,
        resourceId,
        error
      });
      
      throw new InternalServerError('Failed to validate resource access');
    }
  }

  /**
   * Record timeslot analytics
   */
  async function recordTimeslotAnalytics(
    event: string,
    result: any,
    context: any,
    correlationId: string
  ): Promise<void> {
    try {
      // Implementation would send analytics data to tracking service
      logger.debug('Recording timeslot analytics', {
        event,
        tenantId: context.tenantId,
        generated: result.generated || 0,
        updated: result.updated || 0,
        deleted: result.deleted || 0,
        processingTime: result.processingTime || 0,
        correlationId
      });
    } catch (error) {
      logger.warn('Failed to record timeslot analytics', { error, correlationId });
      // Don't throw - analytics failure shouldn't fail the operation
    }
  }

  logger.info('Timeslot routes registered successfully', {
    enableRateLimit,
    enableAnalytics,
    maxGenerationRange,
    defaultPageSize,
    maxPageSize
  });
}

export default timeslotRoutes;