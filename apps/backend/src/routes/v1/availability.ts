/**
 * Availability API Routes
 * RESTful endpoints for availability and slot management
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  AvailabilitySchemas,
  AvailabilityQuery,
  SlotsQuery,
  CalendarQuery,
  BatchAvailabilityRequest
} from '../../schemas/availability.js';
import { AvailabilityService } from '../../services/availability.service.js';
import { createPresetCache, CachePresets } from '../../middleware/cache.js';
import { CacheService } from '../../services/cache.service.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { authenticateJWT } from '../../decorators/auth.js';
import { CalendarView } from '../../utils/calendar.js';
import { logger } from '../../config/logger.js';
import { BadRequestError, NotFoundError } from '../../utils/errors.js';

/**
 * Register availability routes
 */
export async function availabilityRoutes(fastify: FastifyInstance) {
  const availabilityService = new AvailabilityService(fastify);
  const cacheService = new CacheService(fastify);
  
  // Apply authentication to all routes
  await fastify.register(authenticateJWT);

  // Apply caching middleware to GET routes
  const cacheMiddleware = createPresetCache(cacheService, 'api', {
    ttl: 300, // 5 minutes for availability data
    tags: (request: FastifyRequest) => {
      const user = request.user;
      return user ? [`tenant:${user.tenant_id}`, 'availability'] : ['availability'];
    },
    keyStrategy: {
      includeQuery: true,
      includeHeaders: ['authorization']
    }
  });

  /**
   * GET /availability - Search availability across resources
   * Query parameters: resourceIds[], startDate, endDate, duration?, capacity?, granularity?
   */
  fastify.get('/availability', {
    schema: {
      querystring: AvailabilitySchemas.availabilityQuery,
      response: {
        200: AvailabilitySchemas.availabilityResponse,
        400: AvailabilitySchemas.validationErrorResponse,
        500: AvailabilitySchemas.errorResponse
      },
      tags: ['Availability'],
      summary: 'Search availability across multiple resources',
      description: 'Returns available time slots for specified resources within a date range with optional filtering'
    },
    preHandler: [cacheMiddleware]
  }, asyncHandler(async (request: FastifyRequest<{ Querystring: AvailabilityQuery }>, reply: FastifyReply) => {
    const tenantId = request.user?.tenant_id;
    if (!tenantId) {
      throw new BadRequestError('Tenant ID is required');
    }

    const query = {
      ...request.query,
      tenantId,
      startDate: new Date(request.query.startDate),
      endDate: new Date(request.query.endDate)
    };

    // Validate date range
    if (query.startDate >= query.endDate) {
      throw new BadRequestError('Start date must be before end date');
    }

    // Limit search to 30 days maximum
    const maxRange = 30 * 24 * 60 * 60 * 1000;
    if (query.endDate.getTime() - query.startDate.getTime() > maxRange) {
      throw new BadRequestError('Date range cannot exceed 30 days');
    }

    const result = await availabilityService.searchAvailability(query);

    reply.send({
      success: true,
      data: {
        slots: result.slots,
        totalCount: result.totalCount,
        availableCount: result.availableCount,
        resourceCounts: result.resourceCounts,
        query: request.query,
        generatedAt: new Date().toISOString()
      },
      meta: {
        cached: false,
        cacheKey: reply.getHeader('X-Cache-Key') as string || '',
        processingTimeMs: 0 // Will be calculated by response hook
      }
    });
  }));

  /**
   * GET /availability/slots - Get slots for a specific resource and date
   * Query parameters: resourceId, date, granularity?, capacity?
   */
  fastify.get('/availability/slots', {
    schema: {
      querystring: AvailabilitySchemas.slotsQuery,
      response: {
        200: AvailabilitySchemas.slotsResponse,
        400: AvailabilitySchemas.validationErrorResponse,
        404: AvailabilitySchemas.errorResponse,
        500: AvailabilitySchemas.errorResponse
      },
      tags: ['Availability'],
      summary: 'Get available slots for a specific resource and date',
      description: 'Returns detailed slot information including business hours and holidays'
    },
    preHandler: [cacheMiddleware]
  }, asyncHandler(async (request: FastifyRequest<{ Querystring: SlotsQuery }>, reply: FastifyReply) => {
    const tenantId = request.user?.tenant_id;
    if (!tenantId) {
      throw new BadRequestError('Tenant ID is required');
    }

    const { resourceId, date, granularity = 15, capacity } = request.query;
    const queryDate = new Date(date);

    // Validate date is not in the past (allow today)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (queryDate < today) {
      throw new BadRequestError('Cannot query slots for past dates');
    }

    const result = await availabilityService.getSlots(
      tenantId,
      resourceId,
      queryDate,
      granularity,
      capacity
    );

    reply.send({
      success: true,
      data: {
        resourceId: result.resourceId,
        date: result.date.toISOString(),
        slots: result.slots,
        businessHours: result.businessHours,
        holidays: result.holidays.map(h => ({
          date: h.date.toISOString(),
          name: h.name
        })),
        totalCapacity: result.totalCapacity,
        availableCapacity: result.availableCapacity
      }
    });
  }));

  /**
   * GET /availability/calendar - Get calendar view with availability data
   * Query parameters: resourceIds[], year, month, view?
   */
  fastify.get('/availability/calendar', {
    schema: {
      querystring: AvailabilitySchemas.calendarQuery,
      response: {
        200: AvailabilitySchemas.calendarResponse,
        400: AvailabilitySchemas.validationErrorResponse,
        500: AvailabilitySchemas.errorResponse
      },
      tags: ['Availability'],
      summary: 'Get calendar view with availability data',
      description: 'Returns calendar view (month/week/day) with availability statistics'
    },
    preHandler: [cacheMiddleware]
  }, asyncHandler(async (request: FastifyRequest<{ Querystring: CalendarQuery }>, reply: FastifyReply) => {
    const tenantId = request.user?.tenant_id;
    if (!tenantId) {
      throw new BadRequestError('Tenant ID is required');
    }

    const { resourceIds, year, month, view = 'month' } = request.query;

    // Validate year and month
    if (year < 2020 || year > 2030) {
      throw new BadRequestError('Year must be between 2020 and 2030');
    }
    if (month < 1 || month > 12) {
      throw new BadRequestError('Month must be between 1 and 12');
    }

    const calendarData = await availabilityService.generateCalendarView(
      tenantId,
      resourceIds,
      year,
      month,
      view as CalendarView
    );

    // Transform calendar data for response
    const transformedData = {
      year,
      month,
      view,
      resourceIds,
      calendar: [],
      summary: {
        totalDays: 0,
        businessDays: 0,
        holidays: 0,
        averageUtilization: 0,
        peakUtilizationDay: undefined as string | undefined,
        lowUtilizationDays: [] as string[]
      }
    };

    if ('weeks' in calendarData) {
      // Monthly view
      transformedData.calendar = calendarData.weeks.flatMap(week => 
        week.days.map(day => ({
          date: day.date.toISOString(),
          dayOfWeek: day.dayOfWeek,
          isBusinessDay: day.isBusinessDay,
          isHoliday: day.isHoliday,
          holidayName: day.holidayName,
          totalSlots: day.totalSlots,
          availableSlots: day.availableSlots,
          utilizationRate: day.utilizationRate,
          peakHours: day.peakHours
        }))
      );
      transformedData.summary = {
        totalDays: calendarData.totalDays,
        businessDays: calendarData.businessDays,
        holidays: calendarData.holidays,
        averageUtilization: calendarData.averageUtilization,
        peakUtilizationDay: calendarData.peakUtilizationDay?.toISOString(),
        lowUtilizationDays: calendarData.lowUtilizationDays.map(d => d.toISOString())
      };
    } else if ('days' in calendarData) {
      // Weekly view
      transformedData.calendar = calendarData.days.map(day => ({
        date: day.date.toISOString(),
        dayOfWeek: day.dayOfWeek,
        isBusinessDay: day.isBusinessDay,
        isHoliday: day.isHoliday,
        holidayName: day.holidayName,
        totalSlots: day.totalSlots,
        availableSlots: day.availableSlots,
        utilizationRate: day.utilizationRate,
        peakHours: day.peakHours
      }));
    } else {
      // Daily view
      transformedData.calendar = [{
        date: calendarData.date.toISOString(),
        dayOfWeek: calendarData.dayOfWeek,
        isBusinessDay: calendarData.isBusinessDay,
        isHoliday: calendarData.isHoliday,
        holidayName: calendarData.holidayName,
        totalSlots: calendarData.totalSlots,
        availableSlots: calendarData.availableSlots,
        utilizationRate: calendarData.utilizationRate,
        peakHours: calendarData.peakHours
      }];
    }

    reply.send({
      success: true,
      data: transformedData
    });
  }));

  /**
   * GET /availability/resources/:id - Get resource-specific availability
   * Path parameters: id (resource ID)
   * Query parameters: startDate?, endDate?
   */
  fastify.get('/availability/resources/:id', {
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 }
        },
        required: ['id']
      },
      querystring: {
        type: 'object',
        properties: {
          startDate: { type: 'string', format: 'date-time' },
          endDate: { type: 'string', format: 'date-time' }
        }
      },
      response: {
        200: AvailabilitySchemas.resourceAvailabilityResponse,
        400: AvailabilitySchemas.validationErrorResponse,
        404: AvailabilitySchemas.errorResponse,
        500: AvailabilitySchemas.errorResponse
      },
      tags: ['Availability'],
      summary: 'Get detailed availability for a specific resource',
      description: 'Returns comprehensive availability data including upcoming bookings and daily statistics'
    },
    preHandler: [cacheMiddleware]
  }, asyncHandler(async (request: FastifyRequest<{ 
    Params: { id: string };
    Querystring: { startDate?: string; endDate?: string }
  }>, reply: FastifyReply) => {
    const tenantId = request.user?.tenant_id;
    if (!tenantId) {
      throw new BadRequestError('Tenant ID is required');
    }

    const resourceId = request.params.id;
    const startDate = request.query.startDate ? new Date(request.query.startDate) : new Date();
    const endDate = request.query.endDate ? new Date(request.query.endDate) : 
      new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000); // Default to 7 days

    // Validate date range
    if (startDate >= endDate) {
      throw new BadRequestError('Start date must be before end date');
    }

    const result = await availabilityService.getResourceAvailability(
      tenantId,
      resourceId,
      startDate,
      endDate
    );

    reply.send({
      success: true,
      data: {
        resourceId: result.resourceId,
        resourceName: result.resourceName,
        resourceType: result.resourceType,
        totalCapacity: result.totalCapacity,
        currentUtilization: result.currentUtilization,
        nextAvailableSlot: result.nextAvailableSlot ? {
          startTime: result.nextAvailableSlot.startTime.toISOString(),
          endTime: result.nextAvailableSlot.endTime.toISOString(),
          availableCapacity: result.nextAvailableSlot.availableCapacity
        } : undefined,
        upcomingBookings: result.upcomingBookings.map(booking => ({
          startTime: booking.startTime.toISOString(),
          endTime: booking.endTime.toISOString(),
          bookedCapacity: booking.bookedCapacity,
          customerId: booking.customerId,
          serviceId: booking.serviceId
        })),
        dailyStats: result.dailyStats.map(stat => ({
          date: stat.date.toISOString(),
          totalSlots: stat.totalSlots,
          bookedSlots: stat.bookedSlots,
          utilization: stat.utilization
        }))
      }
    });
  }));

  /**
   * POST /availability/batch - Batch availability check
   * Body: { requests: [{ resourceId, startTime, endTime, requiredCapacity }] }
   */
  fastify.post('/availability/batch', {
    schema: {
      body: AvailabilitySchemas.batchAvailabilityQuery,
      response: {
        200: AvailabilitySchemas.batchAvailabilityResponse,
        400: AvailabilitySchemas.validationErrorResponse,
        500: AvailabilitySchemas.errorResponse
      },
      tags: ['Availability'],
      summary: 'Check availability for multiple resources at once',
      description: 'Batch check availability across multiple resources and time ranges'
    }
  }, asyncHandler(async (request: FastifyRequest<{ Body: BatchAvailabilityRequest }>, reply: FastifyReply) => {
    const tenantId = request.user?.tenant_id;
    if (!tenantId) {
      throw new BadRequestError('Tenant ID is required');
    }

    const { requests } = request.body;

    // Validate batch size
    if (requests.length > 50) {
      throw new BadRequestError('Maximum 50 batch requests allowed');
    }

    // Convert date strings to Date objects
    const processedRequests = requests.map(req => ({
      ...req,
      startTime: new Date(req.startTime),
      endTime: new Date(req.endTime)
    }));

    // Validate each request
    for (const req of processedRequests) {
      if (req.startTime >= req.endTime) {
        throw new BadRequestError(`Invalid date range for resource ${req.resourceId}`);
      }
      if (req.requiredCapacity <= 0) {
        throw new BadRequestError(`Invalid capacity for resource ${req.resourceId}`);
      }
    }

    const result = await availabilityService.checkBatchAvailability(tenantId, processedRequests);

    reply.send({
      success: true,
      data: {
        results: result.results.map(res => ({
          resourceId: res.resourceId,
          available: res.available,
          availableCapacity: res.availableCapacity,
          conflictReason: res.conflictReason,
          alternativeSlots: res.alternativeSlots?.map(slot => ({
            startTime: slot.startTime.toISOString(),
            endTime: slot.endTime.toISOString(),
            availableCapacity: slot.availableCapacity
          }))
        })),
        timestamp: result.timestamp.toISOString(),
        totalRequests: result.totalRequests,
        successfulRequests: result.successfulRequests
      }
    });
  }));

  /**
   * GET /availability/health - Health check endpoint
   */
  fastify.get('/availability/health', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
            metrics: {
              type: 'object',
              properties: {
                totalOperations: { type: 'number' },
                averageResponseTime: { type: 'number' },
                cacheHitRate: { type: 'number' },
                errorRate: { type: 'number' }
              }
            }
          }
        }
      },
      tags: ['Availability'],
      summary: 'Health check for availability service'
    }
  }, asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const metrics = availabilityService.getPerformanceMetrics();
    
    const totalOperations = metrics.length;
    const averageResponseTime = metrics.length > 0 
      ? metrics.reduce((sum, m) => sum + m.duration, 0) / metrics.length 
      : 0;
    const cacheHitRate = metrics.length > 0 
      ? (metrics.filter(m => m.cacheHit).length / metrics.length) * 100 
      : 0;
    const errorRate = 0; // Would calculate from error metrics in production

    reply.send({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      metrics: {
        totalOperations,
        averageResponseTime: Math.round(averageResponseTime),
        cacheHitRate: Math.round(cacheHitRate * 100) / 100,
        errorRate
      }
    });
  }));

  // Add rate limiting specifically for batch operations
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.routeOptions.url === '/availability/batch') {
      // Implement custom rate limiting for batch requests
      // This could be done with fastify-rate-limit plugin
    }
  });

  // Add response time header
  fastify.addHook('onSend', async (request, reply, payload) => {
    if (request.routeOptions.url?.startsWith('/availability/')) {
      const responseTime = Date.now() - (request as any).startTime;
      reply.header('X-Response-Time', `${responseTime}ms`);
    }
  });

  // Track request start time
  fastify.addHook('onRequest', async (request, reply) => {
    if (request.routeOptions.url?.startsWith('/availability/')) {
      (request as any).startTime = Date.now();
    }
  });
}

export default availabilityRoutes;