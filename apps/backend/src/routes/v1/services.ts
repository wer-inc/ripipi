/**
 * Service API Routes
 * RESTful API endpoints for service management with comprehensive
 * validation, multi-language support, and resource relationships
 */

import { FastifyInstance } from 'fastify';
import {
  ServiceParamsSchema,
  CreateServiceRequestSchema,
  UpdateServiceRequestSchema,
  ServiceSearchQuerySchema,
  ServiceAvailabilityRequestSchema,
  ServiceResourceRequestSchema,
  ServiceSuccessResponseSchema,
  ServiceListResponseSchema,
  ServiceAvailabilityResponseSchema,
  ServiceErrorResponseSchema,
  CreateServiceRequest,
  UpdateServiceRequest,
  ServiceSearchQuery,
  ServiceAvailabilityRequest,
  ServiceResourceRequest
} from '../../schemas/service.js';
import { ServiceService } from '../../services/service.service.js';
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
 * Service routes configuration
 */
export interface ServiceRoutesOptions {
  enableCaching?: boolean;
  enableRateLimit?: boolean;
  enableAnalytics?: boolean;
  defaultPageSize?: number;
  maxPageSize?: number;
}

/**
 * Register service API routes
 */
export async function serviceRoutes(
  fastify: FastifyInstance,
  options: ServiceRoutesOptions = {}
): Promise<void> {
  const {
    enableCaching = true,
    enableRateLimit = true,
    enableAnalytics = true,
    defaultPageSize = 20,
    maxPageSize = 100
  } = options;

  // Initialize service
  const serviceService = new ServiceService(fastify);

  /**
   * GET /services - List services with filtering and pagination
   */
  fastify.route({
    method: 'GET',
    url: '/services',
    schema: {
      tags: ['Services'],
      summary: 'List services',
      description: 'Retrieve services with filtering, searching, and pagination',
      querystring: ServiceSearchQuerySchema,
      response: {
        200: ServiceListResponseSchema,
        400: ServiceErrorResponseSchema,
        500: ServiceErrorResponseSchema
      }
    },
    preHandler: [
      fastify.authenticate,
      fastify.tenantContext,
      ...(enableRateLimit ? [fastify.rateLimit({ max: 200, timeWindow: '1 minute' })] : [])
    ],
    handler: asyncHandler(async (request, reply) => {
      const query = request.query as ServiceSearchQuery;
      const context = request.tenantContext;

      logger.info('Searching services', {
        tenantId: context.tenantId,
        filters: {
          name: query.name,
          active: query.active,
          minPrice: query.minPrice,
          maxPrice: query.maxPrice,
          resourceId: query.resourceId
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

      // Validate price range
      if (query.minPrice !== undefined && query.maxPrice !== undefined && query.minPrice > query.maxPrice) {
        throw new BadRequestError('minPrice cannot be greater than maxPrice');
      }

      // Validate duration range
      if (query.minDuration !== undefined && query.maxDuration !== undefined && query.minDuration > query.maxDuration) {
        throw new BadRequestError('minDuration cannot be greater than maxDuration');
      }

      // Build search criteria with pagination
      const searchQuery = {
        ...query,
        offset: (page - 1) * limit,
        limit
      };

      const result = await serviceService.searchServices(searchQuery, context.tenantId);

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
   * GET /services/:id - Get service details
   */
  fastify.route({
    method: 'GET',
    url: '/services/:id',
    schema: {
      tags: ['Services'],
      summary: 'Get service details',
      description: 'Retrieve detailed information about a specific service',
      params: ServiceParamsSchema,
      response: {
        200: ServiceSuccessResponseSchema,
        404: ServiceErrorResponseSchema,
        500: ServiceErrorResponseSchema
      }
    },
    preHandler: [
      fastify.authenticate,
      fastify.tenantContext
    ],
    handler: asyncHandler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const context = request.tenantContext;

      logger.info('Getting service details', {
        serviceId: id,
        tenantId: context.tenantId
      });

      const service = await serviceService.getServiceById(id, context.tenantId, true);

      if (!service) {
        throw new NotFoundError(`Service ${id} not found`);
      }

      reply.send({
        success: true,
        data: service,
        metadata: {
          timestamp: new Date().toISOString(),
          version: 'v1'
        }
      });

      logger.info('Service details retrieved successfully', {
        serviceId: id,
        tenantId: context.tenantId
      });
    })
  });

  /**
   * POST /services - Create new service
   */
  fastify.route({
    method: 'POST',
    url: '/services',
    schema: {
      tags: ['Services'],
      summary: 'Create new service',
      description: 'Create a new service with multi-language support and resource relationships',
      body: CreateServiceRequestSchema,
      response: {
        201: ServiceSuccessResponseSchema,
        400: ServiceErrorResponseSchema,
        409: ServiceErrorResponseSchema,
        500: ServiceErrorResponseSchema
      }
    },
    preHandler: [
      fastify.authenticate,
      fastify.tenantContext,
      fastify.authorize(['admin', 'manager']),
      ...(enableRateLimit ? [fastify.rateLimit({ max: 50, timeWindow: '1 minute' })] : [])
    ],
    handler: asyncHandler(async (request, reply) => {
      const body = request.body as CreateServiceRequest;
      const context = request.tenantContext;
      const correlationId = request.headers['x-correlation-id'] as string || `service_create_${Date.now()}`;

      logger.info('Creating new service', {
        tenantId: context.tenantId,
        serviceName: body.name,
        durationMin: body.durationMin,
        priceJpy: body.priceJpy,
        correlationId
      });

      // Validate multi-language name
      if (!body.name || typeof body.name !== 'object') {
        throw new BadRequestError('Service name must be a multi-language object');
      }

      if (!body.name.ja && !body.name.en) {
        throw new BadRequestError('Service name must include at least Japanese (ja) or English (en)');
      }

      // Validate duration and price
      if (body.durationMin <= 0) {
        throw new BadRequestError('Service duration must be greater than 0');
      }

      if (body.priceJpy < 0) {
        throw new BadRequestError('Service price cannot be negative');
      }

      // Validate buffer times
      if (body.bufferBeforeMin && body.bufferBeforeMin < 0) {
        throw new BadRequestError('Buffer before time cannot be negative');
      }

      if (body.bufferAfterMin && body.bufferAfterMin < 0) {
        throw new BadRequestError('Buffer after time cannot be negative');
      }

      const result = await serviceService.createService(
        body,
        context.tenantId,
        {
          tenantId: context.tenantId,
          userId: context.userId
        }
      );

      if (!result.success) {
        if (result.code === 'CONFLICT') {
          throw new ConflictError(result.error || 'Service creation conflict');
        }
        throw new BadRequestError(result.error || 'Failed to create service');
      }

      reply.status(201).send({
        success: true,
        data: result.service!,
        metadata: {
          timestamp: new Date().toISOString(),
          correlation_id: correlationId,
          version: 'v1'
        }
      });

      logger.info('Service created successfully', {
        serviceId: result.service!.id,
        tenantId: context.tenantId,
        correlationId
      });
    })
  });

  /**
   * PUT /services/:id - Update service
   */
  fastify.route({
    method: 'PUT',
    url: '/services/:id',
    schema: {
      tags: ['Services'],
      summary: 'Update service',
      description: 'Update service details and resource relationships',
      params: ServiceParamsSchema,
      body: UpdateServiceRequestSchema,
      response: {
        200: ServiceSuccessResponseSchema,
        400: ServiceErrorResponseSchema,
        404: ServiceErrorResponseSchema,
        409: ServiceErrorResponseSchema,
        500: ServiceErrorResponseSchema
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
      const body = request.body as UpdateServiceRequest;
      const context = request.tenantContext;
      const correlationId = request.headers['x-correlation-id'] as string || `service_update_${Date.now()}`;

      logger.info('Updating service', {
        serviceId: id,
        tenantId: context.tenantId,
        updates: Object.keys(body),
        correlationId
      });

      // Validate service ID
      if (!id || id.trim() === '') {
        throw new BadRequestError('Service ID is required');
      }

      // Validate request body has some updates
      if (!body || Object.keys(body).length === 0) {
        throw new BadRequestError('At least one field must be provided for update');
      }

      // Validate multi-language name if provided
      if (body.name) {
        if (typeof body.name !== 'object') {
          throw new BadRequestError('Service name must be a multi-language object');
        }
        if (!body.name.ja && !body.name.en) {
          throw new BadRequestError('Service name must include at least Japanese (ja) or English (en)');
        }
      }

      // Validate duration and price if provided
      if (body.durationMin !== undefined && body.durationMin <= 0) {
        throw new BadRequestError('Service duration must be greater than 0');
      }

      if (body.priceJpy !== undefined && body.priceJpy < 0) {
        throw new BadRequestError('Service price cannot be negative');
      }

      // Validate buffer times if provided
      if (body.bufferBeforeMin !== undefined && body.bufferBeforeMin < 0) {
        throw new BadRequestError('Buffer before time cannot be negative');
      }

      if (body.bufferAfterMin !== undefined && body.bufferAfterMin < 0) {
        throw new BadRequestError('Buffer after time cannot be negative');
      }

      const result = await serviceService.updateService(
        id,
        body,
        context.tenantId,
        {
          tenantId: context.tenantId,
          userId: context.userId
        }
      );

      if (!result.success) {
        if (result.code === 'SERVICE_NOT_FOUND') {
          throw new NotFoundError(`Service ${id} not found`);
        }
        if (result.code === 'CONFLICT') {
          throw new ConflictError(result.error || 'Service update conflict');
        }
        throw new BadRequestError(result.error || 'Failed to update service');
      }

      reply.send({
        success: true,
        data: result.service!,
        metadata: {
          timestamp: new Date().toISOString(),
          correlation_id: correlationId,
          version: 'v1'
        }
      });

      logger.info('Service updated successfully', {
        serviceId: id,
        tenantId: context.tenantId,
        correlationId
      });
    })
  });

  /**
   * DELETE /services/:id - Delete service
   */
  fastify.route({
    method: 'DELETE',
    url: '/services/:id',
    schema: {
      tags: ['Services'],
      summary: 'Delete service',
      description: 'Soft delete a service (cannot delete services with active bookings)',
      params: ServiceParamsSchema,
      response: {
        200: ServiceSuccessResponseSchema,
        400: ServiceErrorResponseSchema,
        404: ServiceErrorResponseSchema,
        409: ServiceErrorResponseSchema,
        500: ServiceErrorResponseSchema
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
      const correlationId = request.headers['x-correlation-id'] as string || `service_delete_${Date.now()}`;

      logger.info('Deleting service', {
        serviceId: id,
        tenantId: context.tenantId,
        correlationId
      });

      // Validate service ID
      if (!id || id.trim() === '') {
        throw new BadRequestError('Service ID is required');
      }

      const result = await serviceService.deleteService(
        id,
        context.tenantId,
        {
          tenantId: context.tenantId,
          userId: context.userId
        }
      );

      if (!result.success) {
        if (result.code === 'SERVICE_NOT_FOUND') {
          throw new NotFoundError(`Service ${id} not found`);
        }
        if (result.code === 'SERVICE_HAS_ACTIVE_BOOKINGS') {
          throw new ConflictError(result.error || 'Cannot delete service with active bookings');
        }
        throw new BadRequestError(result.error || 'Failed to delete service');
      }

      reply.send({
        success: true,
        data: result.service!,
        metadata: {
          timestamp: new Date().toISOString(),
          correlation_id: correlationId,
          version: 'v1'
        }
      });

      logger.info('Service deleted successfully', {
        serviceId: id,
        tenantId: context.tenantId,
        correlationId
      });
    })
  });

  /**
   * POST /services/:id/availability - Check service availability
   */
  fastify.route({
    method: 'POST',
    url: '/services/:id/availability',
    schema: {
      tags: ['Services'],
      summary: 'Check service availability',
      description: 'Get available time slots for a service within a date range',
      params: ServiceParamsSchema,
      body: ServiceAvailabilityRequestSchema,
      response: {
        200: ServiceAvailabilityResponseSchema,
        400: ServiceErrorResponseSchema,
        404: ServiceErrorResponseSchema,
        500: ServiceErrorResponseSchema
      }
    },
    preHandler: [
      fastify.authenticate,
      fastify.tenantContext,
      ...(enableRateLimit ? [fastify.rateLimit({ max: 100, timeWindow: '1 minute' })] : [])
    ],
    handler: asyncHandler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as ServiceAvailabilityRequest;
      const context = request.tenantContext;

      logger.info('Checking service availability', {
        serviceId: id,
        tenantId: context.tenantId,
        startDate: body.startDate,
        endDate: body.endDate,
        resourceId: body.resourceId
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

      const availability = await serviceService.getServiceAvailability(
        id,
        body,
        context.tenantId
      );

      reply.send(availability);

      logger.info('Service availability retrieved successfully', {
        serviceId: id,
        tenantId: context.tenantId,
        totalSlots: availability.totalAvailableSlots
      });
    })
  });

  /**
   * POST /services/:id/resources - Manage service-resource relationships
   */
  fastify.route({
    method: 'POST',
    url: '/services/:id/resources',
    schema: {
      tags: ['Services'],
      summary: 'Manage service-resource relationships',
      description: 'Add or update resources that can provide this service',
      params: ServiceParamsSchema,
      body: ServiceResourceRequestSchema,
      response: {
        200: ServiceSuccessResponseSchema,
        400: ServiceErrorResponseSchema,
        404: ServiceErrorResponseSchema,
        500: ServiceErrorResponseSchema
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
      const body = request.body as ServiceResourceRequest;
      const context = request.tenantContext;
      const correlationId = request.headers['x-correlation-id'] as string || `service_resources_${Date.now()}`;

      logger.info('Managing service-resource relationships', {
        serviceId: id,
        tenantId: context.tenantId,
        resourceIds: body.resourceIds,
        correlationId
      });

      // Validate resource IDs
      if (!body.resourceIds || body.resourceIds.length === 0) {
        throw new BadRequestError('At least one resource ID is required');
      }

      // Check for duplicate resource IDs
      const uniqueResourceIds = [...new Set(body.resourceIds)];
      if (uniqueResourceIds.length !== body.resourceIds.length) {
        throw new BadRequestError('Duplicate resource IDs are not allowed');
      }

      // Update service with new resource relationships
      const result = await serviceService.updateService(
        id,
        { resourceIds: body.resourceIds },
        context.tenantId,
        {
          tenantId: context.tenantId,
          userId: context.userId
        }
      );

      if (!result.success) {
        if (result.code === 'SERVICE_NOT_FOUND') {
          throw new NotFoundError(`Service ${id} not found`);
        }
        throw new BadRequestError(result.error || 'Failed to update service resources');
      }

      reply.send({
        success: true,
        data: result.service!,
        metadata: {
          timestamp: new Date().toISOString(),
          correlation_id: correlationId,
          version: 'v1'
        }
      });

      logger.info('Service-resource relationships updated successfully', {
        serviceId: id,
        tenantId: context.tenantId,
        resourceCount: body.resourceIds.length,
        correlationId
      });
    })
  });

  logger.info('Service routes registered successfully', {
    enableCaching,
    enableRateLimit,
    enableAnalytics
  });
}

export default serviceRoutes;