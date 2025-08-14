/**
 * Resource API Routes
 * RESTful API endpoints for resource management with comprehensive
 * validation, multi-language support, scheduling, and utilization tracking
 */

import { FastifyInstance } from 'fastify';
import {
  ResourceParamsSchema,
  CreateResourceRequestSchema,
  UpdateResourceRequestSchema,
  ResourceSearchQuerySchema,
  ResourceAvailabilityRequestSchema,
  ResourceScheduleRequestSchema,
  ResourceSuccessResponseSchema,
  ResourceListResponseSchema,
  ResourceAvailabilityResponseSchema,
  ResourceErrorResponseSchema,
  CreateResourceRequest,
  UpdateResourceRequest,
  ResourceSearchQuery,
  ResourceAvailabilityRequest,
  ResourceScheduleRequest
} from '../../schemas/resource.js';
import { ResourceService } from '../../services/resource.service.js';
import { asyncHandler } from '../../utils/async-handler.js';
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
  ValidationError,
  InternalServerError
} from '../../utils/errors.js';
import { logger } from '../../config/logger.js';

// Extend FastifyRequest type to include tenant context
declare module 'fastify' {
  interface FastifyRequest {
    tenantContext: {
      tenantId: string;
      userId?: string;
      permissions?: string[];
    };
  }
}

/**
 * Resource routes configuration
 */
export interface ResourceRoutesOptions {
  enableCaching?: boolean;
  enableRateLimit?: boolean;
  enableAnalytics?: boolean;
  defaultPageSize?: number;
  maxPageSize?: number;
}

/**
 * Register resource API routes
 */
export async function resourceRoutes(
  fastify: FastifyInstance,
  options: ResourceRoutesOptions = {}
): Promise<void> {
  const {
    enableCaching = true,
    enableRateLimit = true,
    enableAnalytics = true,
    defaultPageSize = 20,
    maxPageSize = 100
  } = options;

  // Initialize service
  const resourceService = new ResourceService(fastify);

  /**
   * GET /resources - List resources with filtering and pagination
   */
  fastify.route({
    method: 'GET',
    url: '/resources',
    schema: {
      tags: ['Resources'],
      summary: 'List resources',
      description: 'Retrieve resources with filtering, searching, and pagination',
      querystring: ResourceSearchQuerySchema,
      response: {
        200: ResourceListResponseSchema,
        400: ResourceErrorResponseSchema,
        500: ResourceErrorResponseSchema
      }
    },
    preHandler: [
      fastify.authenticate,
      fastify.tenantContext,
      ...(enableRateLimit ? [fastify.rateLimit({ max: 200, timeWindow: '1 minute' })] : [])
    ],
    handler: asyncHandler(async (request, reply) => {
      const query = request.query as ResourceSearchQuery;
      const context = request.tenantContext;

      logger.info('Searching resources', {
        tenantId: context.tenantId,
        filters: {
          name: query.name,
          kind: query.kind,
          active: query.active,
          minCapacity: query.minCapacity,
          maxCapacity: query.maxCapacity,
          serviceId: query.serviceId,
          groupId: query.groupId
        }
      });

      // Validate pagination parameters
      const page = query.page || 1;
      const limit = Math.min(query.limit || defaultPageSize, maxPageSize);

      if (page < 1) {
        throw new BadRequestError('Page must be greater than 0');
      }

      if (limit < 1) {
        throw new BadRequestError('Limit must be greater than 0');
      }

      // Validate capacity range
      if (query.minCapacity !== undefined && query.maxCapacity !== undefined && query.minCapacity > query.maxCapacity) {
        throw new BadRequestError('minCapacity cannot be greater than maxCapacity');
      }

      // Validate availableAt date format
      if (query.availableAt) {
        const availableAtDate = new Date(query.availableAt);
        if (isNaN(availableAtDate.getTime())) {
          throw new BadRequestError('Invalid availableAt date format');
        }
      }

      // Build search criteria with pagination
      const searchQuery = {
        ...query,
        offset: (page - 1) * limit,
        limit
      };

      const result = await resourceService.searchResources(searchQuery, context.tenantId);

      // Calculate pagination metadata
      const totalPages = Math.ceil(result.total / limit);

      reply.send({
        data: result.data,
        pagination: {
          page,
          limit,
          total: result.total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        },
        statistics: result.statistics,
        metadata: {
          timestamp: new Date().toISOString(),
          version: 'v1'
        }
      });
    })
  });

  /**
   * GET /resources/:id - Get resource details
   */
  fastify.route({
    method: 'GET',
    url: '/resources/:id',
    schema: {
      tags: ['Resources'],
      summary: 'Get resource details',
      description: 'Retrieve detailed information about a specific resource',
      params: ResourceParamsSchema,
      querystring: {
        type: 'object',
        properties: {
          includeServices: { type: 'boolean', default: true },
          includeUtilization: { type: 'boolean', default: false }
        }
      },
      response: {
        200: ResourceSuccessResponseSchema,
        404: ResourceErrorResponseSchema,
        500: ResourceErrorResponseSchema
      }
    },
    preHandler: [
      fastify.authenticate,
      fastify.tenantContext
    ],
    handler: asyncHandler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const query = request.query as { includeServices?: boolean; includeUtilization?: boolean };
      const context = request.tenantContext;

      logger.info('Getting resource details', {
        resourceId: id,
        tenantId: context.tenantId,
        includeServices: query.includeServices,
        includeUtilization: query.includeUtilization
      });

      const resource = await resourceService.getResourceById(
        id, 
        context.tenantId, 
        query.includeServices !== false,
        query.includeUtilization === true
      );

      if (!resource) {
        throw new NotFoundError(`Resource ${id} not found`);
      }

      reply.send({
        success: true,
        data: resource,
        metadata: {
          timestamp: new Date().toISOString(),
          version: 'v1'
        }
      });

      logger.info('Resource details retrieved successfully', {
        resourceId: id,
        tenantId: context.tenantId
      });
    })
  });

  /**
   * POST /resources - Create new resource
   */
  fastify.route({
    method: 'POST',
    url: '/resources',
    schema: {
      tags: ['Resources'],
      summary: 'Create new resource',
      description: 'Create a new resource with multi-language support, service relationships, and scheduling',
      body: CreateResourceRequestSchema,
      response: {
        201: ResourceSuccessResponseSchema,
        400: ResourceErrorResponseSchema,
        409: ResourceErrorResponseSchema,
        500: ResourceErrorResponseSchema
      }
    },
    preHandler: [
      fastify.authenticate,
      fastify.tenantContext,
      fastify.authorize(['admin', 'manager']),
      ...(enableRateLimit ? [fastify.rateLimit({ max: 50, timeWindow: '1 minute' })] : [])
    ],
    handler: asyncHandler(async (request, reply) => {
      const body = request.body as CreateResourceRequest;
      const context = request.tenantContext;
      const correlationId = request.headers['x-correlation-id'] as string || `resource_create_${Date.now()}`;

      logger.info('Creating new resource', {
        tenantId: context.tenantId,
        resourceName: body.name,
        resourceKind: body.kind,
        capacity: body.capacity,
        correlationId
      });

      // Validate multi-language name
      if (!body.name || typeof body.name !== 'object') {
        throw new BadRequestError('Resource name must be a multi-language object');
      }

      if (!body.name.ja && !body.name.en) {
        throw new BadRequestError('Resource name must include at least Japanese (ja) or English (en)');
      }

      // Validate capacity
      if (body.capacity <= 0) {
        throw new BadRequestError('Resource capacity must be greater than 0');
      }

      // Validate resource kind
      const validKinds = ['staff', 'seat', 'room', 'table'];
      if (!validKinds.includes(body.kind)) {
        throw new BadRequestError(`Resource kind must be one of: ${validKinds.join(', ')}`);
      }

      // Validate business hours if provided
      if (body.businessHours) {
        for (const hours of body.businessHours) {
          if (hours.dayOfWeek < 0 || hours.dayOfWeek > 6) {
            throw new BadRequestError('Day of week must be between 0 (Sunday) and 6 (Saturday)');
          }

          // Validate time format (HH:MM)
          const timePattern = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
          if (!timePattern.test(hours.openTime)) {
            throw new BadRequestError('Invalid openTime format. Use HH:MM format');
          }
          if (!timePattern.test(hours.closeTime)) {
            throw new BadRequestError('Invalid closeTime format. Use HH:MM format');
          }

          // Validate time range
          if (hours.openTime >= hours.closeTime) {
            throw new BadRequestError('Opening time must be before closing time');
          }
        }
      }

      const result = await resourceService.createResource(
        body,
        context.tenantId,
        {
          tenantId: context.tenantId,
          userId: context.userId
        }
      );

      if (!result.success) {
        if (result.code === 'CONFLICT') {
          throw new ConflictError(result.error || 'Resource creation conflict');
        }
        throw new BadRequestError(result.error || 'Failed to create resource');
      }

      reply.status(201).send({
        success: true,
        data: result.resource!,
        metadata: {
          timestamp: new Date().toISOString(),
          correlation_id: correlationId,
          version: 'v1'
        }
      });

      logger.info('Resource created successfully', {
        resourceId: result.resource!.id,
        tenantId: context.tenantId,
        correlationId
      });
    })
  });

  /**
   * PUT /resources/:id - Update resource
   */
  fastify.route({
    method: 'PUT',
    url: '/resources/:id',
    schema: {
      tags: ['Resources'],
      summary: 'Update resource',
      description: 'Update resource details, service relationships, and scheduling',
      params: ResourceParamsSchema,
      body: UpdateResourceRequestSchema,
      response: {
        200: ResourceSuccessResponseSchema,
        400: ResourceErrorResponseSchema,
        404: ResourceErrorResponseSchema,
        409: ResourceErrorResponseSchema,
        500: ResourceErrorResponseSchema
      }
    },
    preHandler: [
      fastify.authenticate,
      fastify.tenantContext,
      fastify.authorize(['admin', 'manager']),
      ...(enableRateLimit ? [fastify.rateLimit({ max: 100, timeWindow: '1 minute' })] : [])
    ],
    handler: asyncHandler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as UpdateResourceRequest;
      const context = request.tenantContext;
      const correlationId = request.headers['x-correlation-id'] as string || `resource_update_${Date.now()}`;

      logger.info('Updating resource', {
        resourceId: id,
        tenantId: context.tenantId,
        updates: Object.keys(body),
        correlationId
      });

      // Validate resource ID
      if (!id || id.trim() === '') {
        throw new BadRequestError('Resource ID is required');
      }

      // Validate request body has some updates
      if (!body || Object.keys(body).length === 0) {
        throw new BadRequestError('At least one field must be provided for update');
      }

      // Validate multi-language name if provided
      if (body.name) {
        if (typeof body.name !== 'object') {
          throw new BadRequestError('Resource name must be a multi-language object');
        }
        if (!body.name.ja && !body.name.en) {
          throw new BadRequestError('Resource name must include at least Japanese (ja) or English (en)');
        }
      }

      // Validate capacity if provided
      if (body.capacity !== undefined && body.capacity <= 0) {
        throw new BadRequestError('Resource capacity must be greater than 0');
      }

      // Validate resource kind if provided
      if (body.kind) {
        const validKinds = ['staff', 'seat', 'room', 'table'];
        if (!validKinds.includes(body.kind)) {
          throw new BadRequestError(`Resource kind must be one of: ${validKinds.join(', ')}`);
        }
      }

      // Validate business hours if provided
      if (body.businessHours) {
        for (const hours of body.businessHours) {
          if (hours.dayOfWeek < 0 || hours.dayOfWeek > 6) {
            throw new BadRequestError('Day of week must be between 0 (Sunday) and 6 (Saturday)');
          }

          // Validate time format (HH:MM)
          const timePattern = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
          if (!timePattern.test(hours.openTime)) {
            throw new BadRequestError('Invalid openTime format. Use HH:MM format');
          }
          if (!timePattern.test(hours.closeTime)) {
            throw new BadRequestError('Invalid closeTime format. Use HH:MM format');
          }

          // Validate time range
          if (hours.openTime >= hours.closeTime) {
            throw new BadRequestError('Opening time must be before closing time');
          }
        }
      }

      const result = await resourceService.updateResource(
        id,
        body,
        context.tenantId,
        {
          tenantId: context.tenantId,
          userId: context.userId
        }
      );

      if (!result.success) {
        if (result.code === 'RESOURCE_NOT_FOUND') {
          throw new NotFoundError(`Resource ${id} not found`);
        }
        if (result.code === 'CONFLICT') {
          throw new ConflictError(result.error || 'Resource update conflict');
        }
        throw new BadRequestError(result.error || 'Failed to update resource');
      }

      reply.send({
        success: true,
        data: result.resource!,
        metadata: {
          timestamp: new Date().toISOString(),
          correlation_id: correlationId,
          version: 'v1'
        }
      });

      logger.info('Resource updated successfully', {
        resourceId: id,
        tenantId: context.tenantId,
        correlationId
      });
    })
  });

  /**
   * DELETE /resources/:id - Delete resource
   */
  fastify.route({
    method: 'DELETE',
    url: '/resources/:id',
    schema: {
      tags: ['Resources'],
      summary: 'Delete resource',
      description: 'Soft delete a resource (cannot delete resources with active bookings)',
      params: ResourceParamsSchema,
      response: {
        200: ResourceSuccessResponseSchema,
        400: ResourceErrorResponseSchema,
        404: ResourceErrorResponseSchema,
        409: ResourceErrorResponseSchema,
        500: ResourceErrorResponseSchema
      }
    },
    preHandler: [
      fastify.authenticate,
      fastify.tenantContext,
      fastify.authorize(['admin', 'manager']),
      ...(enableRateLimit ? [fastify.rateLimit({ max: 30, timeWindow: '1 minute' })] : [])
    ],
    handler: asyncHandler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const context = request.tenantContext;
      const correlationId = request.headers['x-correlation-id'] as string || `resource_delete_${Date.now()}`;

      logger.info('Deleting resource', {
        resourceId: id,
        tenantId: context.tenantId,
        correlationId
      });

      // Validate resource ID
      if (!id || id.trim() === '') {
        throw new BadRequestError('Resource ID is required');
      }

      const result = await resourceService.deleteResource(
        id,
        context.tenantId,
        {
          tenantId: context.tenantId,
          userId: context.userId
        }
      );

      if (!result.success) {
        if (result.code === 'RESOURCE_NOT_FOUND') {
          throw new NotFoundError(`Resource ${id} not found`);
        }
        if (result.code === 'RESOURCE_HAS_ACTIVE_BOOKINGS') {
          throw new ConflictError(result.error || 'Cannot delete resource with active bookings');
        }
        throw new BadRequestError(result.error || 'Failed to delete resource');
      }

      reply.send({
        success: true,
        data: result.resource!,
        metadata: {
          timestamp: new Date().toISOString(),
          correlation_id: correlationId,
          version: 'v1'
        }
      });

      logger.info('Resource deleted successfully', {
        resourceId: id,
        tenantId: context.tenantId,
        correlationId
      });
    })
  });

  /**
   * POST /resources/:id/availability - Check resource availability
   */
  fastify.route({
    method: 'POST',
    url: '/resources/:id/availability',
    schema: {
      tags: ['Resources'],
      summary: 'Check resource availability',
      description: 'Get available time slots for a resource within a date range',
      params: ResourceParamsSchema,
      body: ResourceAvailabilityRequestSchema,
      response: {
        200: ResourceAvailabilityResponseSchema,
        400: ResourceErrorResponseSchema,
        404: ResourceErrorResponseSchema,
        500: ResourceErrorResponseSchema
      }
    },
    preHandler: [
      fastify.authenticate,
      fastify.tenantContext,
      ...(enableRateLimit ? [fastify.rateLimit({ max: 100, timeWindow: '1 minute' })] : [])
    ],
    handler: asyncHandler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as ResourceAvailabilityRequest;
      const context = request.tenantContext;

      logger.info('Checking resource availability', {
        resourceId: id,
        tenantId: context.tenantId,
        startDate: body.startDate,
        endDate: body.endDate,
        serviceId: body.serviceId,
        capacity: body.capacity
      });

      // Validate date range
      const startDate = new Date(body.startDate);
      const endDate = new Date(body.endDate);

      if (isNaN(startDate.getTime())) {
        throw new BadRequestError('Invalid startDate format');
      }

      if (isNaN(endDate.getTime())) {
        throw new BadRequestError('Invalid endDate format');
      }

      if (startDate >= endDate) {
        throw new BadRequestError('Start date must be before end date');
      }

      // Validate date range is not too large (prevent performance issues)
      const daysDiff = Math.abs(endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff > 90) {
        throw new BadRequestError('Date range cannot exceed 90 days');
      }

      // Validate capacity if provided
      if (body.capacity !== undefined && body.capacity <= 0) {
        throw new BadRequestError('Required capacity must be greater than 0');
      }

      const availability = await resourceService.getResourceAvailability(
        id,
        body,
        context.tenantId
      );

      reply.send(availability);

      logger.info('Resource availability retrieved successfully', {
        resourceId: id,
        tenantId: context.tenantId,
        totalSlots: availability.totalAvailableSlots,
        utilizationRate: availability.utilizationRate
      });
    })
  });

  /**
   * PUT /resources/:id/schedule - Update resource schedule
   */
  fastify.route({
    method: 'PUT',
    url: '/resources/:id/schedule',
    schema: {
      tags: ['Resources'],
      summary: 'Update resource schedule',
      description: 'Update resource business hours, holidays, and time offs',
      params: ResourceParamsSchema,
      body: ResourceScheduleRequestSchema,
      response: {
        200: ResourceSuccessResponseSchema,
        400: ResourceErrorResponseSchema,
        404: ResourceErrorResponseSchema,
        500: ResourceErrorResponseSchema
      }
    },
    preHandler: [
      fastify.authenticate,
      fastify.tenantContext,
      fastify.authorize(['admin', 'manager']),
      ...(enableRateLimit ? [fastify.rateLimit({ max: 50, timeWindow: '1 minute' })] : [])
    ],
    handler: asyncHandler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as ResourceScheduleRequest;
      const context = request.tenantContext;
      const correlationId = request.headers['x-correlation-id'] as string || `resource_schedule_${Date.now()}`;

      logger.info('Updating resource schedule', {
        resourceId: id,
        tenantId: context.tenantId,
        hasBusinessHours: !!body.businessHours,
        hasHolidays: !!body.holidays,
        hasTimeOffs: !!body.timeOffs,
        correlationId
      });

      // Validate business hours if provided
      if (body.businessHours) {
        for (const hours of body.businessHours) {
          if (hours.dayOfWeek < 0 || hours.dayOfWeek > 6) {
            throw new BadRequestError('Day of week must be between 0 (Sunday) and 6 (Saturday)');
          }

          // Validate time format (HH:MM)
          const timePattern = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
          if (!timePattern.test(hours.openTime)) {
            throw new BadRequestError('Invalid openTime format. Use HH:MM format');
          }
          if (!timePattern.test(hours.closeTime)) {
            throw new BadRequestError('Invalid closeTime format. Use HH:MM format');
          }

          // Validate time range
          if (hours.openTime >= hours.closeTime) {
            throw new BadRequestError('Opening time must be before closing time');
          }

          // Validate effective dates if provided
          if (hours.effectiveFrom && hours.effectiveTo) {
            const fromDate = new Date(hours.effectiveFrom);
            const toDate = new Date(hours.effectiveTo);
            
            if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
              throw new BadRequestError('Invalid effective date format');
            }
            
            if (fromDate >= toDate) {
              throw new BadRequestError('Effective from date must be before effective to date');
            }
          }
        }
      }

      // Validate holidays if provided
      if (body.holidays) {
        for (const holiday of body.holidays) {
          const holidayDate = new Date(holiday.date);
          if (isNaN(holidayDate.getTime())) {
            throw new BadRequestError('Invalid holiday date format');
          }
          
          if (!holiday.name || holiday.name.trim() === '') {
            throw new BadRequestError('Holiday name is required');
          }
        }
      }

      // Validate time offs if provided
      if (body.timeOffs) {
        for (const timeOff of body.timeOffs) {
          const startAt = new Date(timeOff.startAt);
          const endAt = new Date(timeOff.endAt);
          
          if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
            throw new BadRequestError('Invalid time off date format');
          }
          
          if (startAt >= endAt) {
            throw new BadRequestError('Time off start must be before end');
          }
          
          if (!timeOff.reason || timeOff.reason.trim() === '') {
            throw new BadRequestError('Time off reason is required');
          }
        }
      }

      const result = await resourceService.updateResourceSchedule(
        id,
        body,
        context.tenantId,
        {
          tenantId: context.tenantId,
          userId: context.userId
        }
      );

      if (!result.success) {
        if (result.code === 'RESOURCE_NOT_FOUND') {
          throw new NotFoundError(`Resource ${id} not found`);
        }
        throw new BadRequestError(result.error || 'Failed to update resource schedule');
      }

      reply.send({
        success: true,
        data: result.resource!,
        metadata: {
          timestamp: new Date().toISOString(),
          correlation_id: correlationId,
          version: 'v1'
        }
      });

      logger.info('Resource schedule updated successfully', {
        resourceId: id,
        tenantId: context.tenantId,
        correlationId
      });
    })
  });

  logger.info('Resource routes registered successfully', {
    enableCaching,
    enableRateLimit,
    enableAnalytics
  });
}

export default resourceRoutes;