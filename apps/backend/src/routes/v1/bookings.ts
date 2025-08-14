/**
 * Booking API Routes
 * RESTful API endpoints for booking management with comprehensive
 * validation, notification integration, error handling, and monitoring
 */

import { FastifyInstance } from 'fastify';
import { 
  BookingParamsSchema,
  CreateBookingRequestSchema,
  UpdateBookingRequestSchema,
  CancelBookingRequestSchema,
  ConfirmBookingRequestSchema,
  BookingSearchQuerySchema,
  UpcomingBookingsQuerySchema,
  CheckAvailabilityRequestSchema,
  BatchBookingRequestSchema,
  BookingSuccessResponseSchema,
  BookingListResponseSchema,
  CheckAvailabilityResponseSchema,
  BatchBookingResponseSchema,
  BookingStatisticsResponseSchema,
  BookingErrorResponseSchema
} from '../../schemas/booking.js';
import { 
  CreateBookingRequest,
  UpdateBookingRequest,
  CancelBookingRequest,
  ConfirmBookingRequest,
  BookingSearchQuery,
  UpcomingBookingsQuery,
  CheckAvailabilityRequest,
  BatchBookingRequest
} from '../../schemas/booking.js';
import { BookingService } from '../../services/booking.service.js';
import { NotificationService } from '../../services/notification.service.js';
import { NotificationWorker } from '../../workers/notification.worker.js';
import { IdempotencyService } from '../../services/idempotency.service.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { 
  BadRequestError, 
  NotFoundError, 
  ConflictError,
  ValidationError,
  InternalServerError 
} from '../../utils/errors.js';
import { logger } from '../../config/logger.js';
import { 
  NotificationRequest,
  NotificationTemplateType,
  NotificationChannel,
  NotificationPriority
} from '../../types/notification.js';

/**
 * Booking routes configuration
 */
export interface BookingRoutesOptions {
  enableNotifications?: boolean;
  enableIdempotency?: boolean;
  enableRateLimit?: boolean;
  enableAnalytics?: boolean;
  defaultPageSize?: number;
  maxPageSize?: number;
}

/**
 * Register booking API routes
 */
export async function bookingRoutes(
  fastify: FastifyInstance,
  options: BookingRoutesOptions = {}
): Promise<void> {
  const {
    enableNotifications = true,
    enableIdempotency = true,
    enableRateLimit = true,
    enableAnalytics = true,
    defaultPageSize = 20,
    maxPageSize = 100
  } = options;

  // Initialize services
  const bookingService = new BookingService(fastify);
  const notificationService = enableNotifications ? new NotificationService(fastify) : null;
  const notificationWorker = enableNotifications ? new NotificationWorker(fastify) : null;
  const idempotencyService = enableIdempotency ? new IdempotencyService(fastify) : null;

  // Start notification worker if enabled
  if (notificationWorker) {
    await notificationWorker.start();
  }

  /**
   * POST /bookings - Create a new booking
   */
  fastify.route({
    method: 'POST',
    url: '/bookings',
    schema: {
      tags: ['Bookings'],
      summary: 'Create a new booking',
      description: 'Creates a new booking with automatic conflict detection and notification sending',
      body: CreateBookingRequestSchema,
      response: {
        201: BookingSuccessResponseSchema,
        400: BookingErrorResponseSchema,
        409: BookingErrorResponseSchema,
        500: BookingErrorResponseSchema
      }
    },
    preHandler: [
      fastify.authenticate,
      fastify.tenantContext,
      ...(enableRateLimit ? [fastify.rateLimit({ max: 100, timeWindow: '1 minute' })] : []),
      ...(enableIdempotency ? [fastify.idempotencyCheck] : [])
    ],
    handler: asyncHandler(async (request, reply) => {
      const body = request.body as CreateBookingRequest;
      const context = request.tenantContext;
      const correlationId = request.headers['x-correlation-id'] as string || `booking_${Date.now()}`;

      logger.info('Creating new booking', {
        tenantId: context.tenantId,
        customerId: body.customerId,
        serviceId: body.serviceId,
        resourceId: body.resourceId,
        startTime: body.startTime,
        endTime: body.endTime,
        correlationId
      });

      try {
        // Create booking request object
        const bookingRequest = {
          tenantId: context.tenantId,
          customerId: body.customerId,
          serviceId: body.serviceId,
          resourceId: body.resourceId,
          startTime: new Date(body.startTime),
          endTime: new Date(body.endTime),
          capacity: body.capacity || 1,
          notes: body.notes,
          idempotencyKey: body.idempotencyKey,
          metadata: {
            ...body.metadata,
            notificationPreferences: body.notificationPreferences,
            autoConfirm: body.autoConfirm,
            correlationId
          }
        };

        // Create booking
        const result = await bookingService.createBooking(bookingRequest, {
          tenantId: context.tenantId,
          userId: context.userId,
          sessionId: request.session?.id,
          requestId: correlationId,
          clientInfo: {
            userAgent: request.headers['user-agent'],
            ipAddress: request.ip
          }
        });

        if (!result.success) {
          if (result.conflicts && result.conflicts.length > 0) {
            throw new ConflictError('Booking conflicts detected', result.conflicts);
          }
          throw new BadRequestError(result.error || 'Failed to create booking');
        }

        const booking = result.booking!;

        // Send notification if enabled and booking was created successfully
        if (enableNotifications && notificationService && notificationWorker) {
          await sendBookingNotification(
            notificationService,
            notificationWorker,
            booking,
            'BOOKING_CONFIRMATION',
            body.notificationPreferences || {},
            correlationId,
            context
          );
        }

        // Record analytics if enabled
        if (enableAnalytics) {
          await recordBookingAnalytics('booking_created', booking, context);
        }

        reply.status(201).send({
          success: true,
          data: booking,
          metadata: {
            timestamp: new Date().toISOString(),
            correlation_id: correlationId,
            version: 'v1'
          }
        });

        logger.info('Booking created successfully', {
          bookingId: booking.id,
          tenantId: context.tenantId,
          status: booking.status,
          correlationId
        });

      } catch (error) {
        logger.error('Failed to create booking', {
          tenantId: context.tenantId,
          error: error.message,
          correlationId
        });

        if (error instanceof ConflictError || error instanceof ValidationError) {
          reply.status(error.statusCode).send({
            error: {
              code: error.code,
              message: error.message,
              details: error.details,
              correlationId,
              timestamp: new Date().toISOString()
            },
            conflicts: error.conflicts,
            suggestions: generateBookingSuggestions(error.conflicts || [], body)
          });
        } else {
          throw error;
        }
      }
    })
  });

  /**
   * GET /bookings - List bookings with search and filtering
   */
  fastify.route({
    method: 'GET',
    url: '/bookings',
    schema: {
      tags: ['Bookings'],
      summary: 'List bookings',
      description: 'Retrieve bookings with filtering, searching, and pagination',
      querystring: BookingSearchQuerySchema,
      response: {
        200: BookingListResponseSchema,
        400: BookingErrorResponseSchema,
        500: BookingErrorResponseSchema
      }
    },
    preHandler: [
      fastify.authenticate,
      fastify.tenantContext,
      ...(enableRateLimit ? [fastify.rateLimit({ max: 200, timeWindow: '1 minute' })] : [])
    ],
    handler: asyncHandler(async (request, reply) => {
      const query = request.query as BookingSearchQuery;
      const context = request.tenantContext;

      logger.info('Searching bookings', {
        tenantId: context.tenantId,
        filters: {
          customerId: query.customerId,
          serviceId: query.serviceId,
          resourceId: query.resourceId,
          status: query.status,
          startDate: query.startDate,
          endDate: query.endDate
        }
      });

      // Validate date parameters
      let startDate: Date | undefined;
      let endDate: Date | undefined;

      if (query.startDate) {
        startDate = new Date(query.startDate);
        if (isNaN(startDate.getTime())) {
          throw new BadRequestError('Invalid startDate format');
        }
      } else if (query.dateRange?.start) {
        startDate = new Date(query.dateRange.start);
        if (isNaN(startDate.getTime())) {
          throw new BadRequestError('Invalid dateRange.start format');
        }
      }

      if (query.endDate) {
        endDate = new Date(query.endDate);
        if (isNaN(endDate.getTime())) {
          throw new BadRequestError('Invalid endDate format');
        }
      } else if (query.dateRange?.end) {
        endDate = new Date(query.dateRange.end);
        if (isNaN(endDate.getTime())) {
          throw new BadRequestError('Invalid dateRange.end format');
        }
      }

      // Validate date range
      if (startDate && endDate && startDate > endDate) {
        throw new BadRequestError('Start date must be before end date');
      }

      // Validate date range is not too large (prevent performance issues)
      if (startDate && endDate) {
        const daysDiff = Math.abs(endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysDiff > 365) {
          throw new BadRequestError('Date range cannot exceed 365 days');
        }
      }

      // Validate pagination parameters
      const page = query.page || 1;
      const limit = query.limit || defaultPageSize;
      
      if (page < 1) {
        throw new BadRequestError('Page must be greater than 0');
      }
      
      if (limit < 1 || limit > maxPageSize) {
        throw new BadRequestError(`Limit must be between 1 and ${maxPageSize}`);
      }

      // Build search criteria
      const searchCriteria = {
        tenantId: context.tenantId,
        customerId: query.customerId,
        serviceId: query.serviceId,
        resourceId: query.resourceId,
        status: Array.isArray(query.status) ? query.status : (query.status ? [query.status] : undefined),
        startDate,
        endDate,
        limit: Math.min(limit, maxPageSize),
        offset: query.offset || (page - 1) * limit,
        sortBy: query.sortBy as any || 'startTime',
        sortOrder: query.sortOrder?.toUpperCase() as any || 'ASC'
      };

      const result = await bookingService.searchBookings(searchCriteria);

      // Calculate pagination
      const totalPages = Math.ceil(result.total / searchCriteria.limit);
      const currentPage = Math.floor(searchCriteria.offset / searchCriteria.limit) + 1;

      reply.send({
        data: result.data,
        pagination: {
          page: currentPage,
          limit: searchCriteria.limit,
          total: result.total,
          totalPages,
          hasNext: currentPage < totalPages,
          hasPrev: currentPage > 1
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
   * GET /bookings/:id - Get booking details
   */
  fastify.route({
    method: 'GET',
    url: '/bookings/:id',
    schema: {
      tags: ['Bookings'],
      summary: 'Get booking details',
      description: 'Retrieve detailed information about a specific booking',
      params: BookingParamsSchema,
      response: {
        200: BookingSuccessResponseSchema,
        404: BookingErrorResponseSchema,
        500: BookingErrorResponseSchema
      }
    },
    preHandler: [
      fastify.authenticate,
      fastify.tenantContext
    ],
    handler: asyncHandler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const context = request.tenantContext;

      logger.info('Getting booking details', {
        bookingId: id,
        tenantId: context.tenantId
      });

      const booking = await bookingService.getBookingById(id, context.tenantId);

      if (!booking) {
        throw new NotFoundError(`Booking ${id} not found`);
      }

      reply.send({
        success: true,
        data: booking,
        metadata: {
          timestamp: new Date().toISOString(),
          version: 'v1'
        }
      });

      logger.info('Booking details retrieved successfully', {
        bookingId: id,
        tenantId: context.tenantId
      });
    })
  });

  /**
   * PUT /bookings/:id - Update booking
   */
  fastify.route({
    method: 'PUT',
    url: '/bookings/:id',
    schema: {
      tags: ['Bookings'],
      summary: 'Update booking',
      description: 'Update booking details with automatic rescheduling and notification',
      params: BookingParamsSchema,
      body: UpdateBookingRequestSchema,
      response: {
        200: BookingSuccessResponseSchema,
        400: BookingErrorResponseSchema,
        404: BookingErrorResponseSchema,
        409: BookingErrorResponseSchema,
        500: BookingErrorResponseSchema
      }
    },
    preHandler: [
      fastify.authenticate,
      fastify.tenantContext,
      ...(enableRateLimit ? [fastify.rateLimit({ max: 50, timeWindow: '1 minute' })] : [])
    ],
    handler: asyncHandler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as UpdateBookingRequest;
      const context = request.tenantContext;
      const correlationId = request.headers['x-correlation-id'] as string || `update_${Date.now()}`;

      // Validate booking ID
      if (!id || id.trim() === '') {
        throw new BadRequestError('Booking ID is required');
      }

      // Validate request body has some updates
      if (!body || Object.keys(body).length === 0) {
        throw new BadRequestError('At least one field must be provided for update');
      }

      // Validate date formats if provided
      if (body.startTime) {
        const startTime = new Date(body.startTime);
        if (isNaN(startTime.getTime())) {
          throw new BadRequestError('Invalid startTime format');
        }
        if (startTime < new Date()) {
          throw new BadRequestError('Cannot update booking to a past time');
        }
      }

      if (body.endTime) {
        const endTime = new Date(body.endTime);
        if (isNaN(endTime.getTime())) {
          throw new BadRequestError('Invalid endTime format');
        }
      }

      // Validate time range if both provided
      if (body.startTime && body.endTime) {
        const startTime = new Date(body.startTime);
        const endTime = new Date(body.endTime);
        if (startTime >= endTime) {
          throw new BadRequestError('Start time must be before end time');
        }

        const durationHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
        if (durationHours > 24) {
          throw new BadRequestError('Booking duration cannot exceed 24 hours');
        }
      }

      // Validate status if provided
      if (body.status) {
        const validStatuses = ['tentative', 'confirmed', 'cancelled', 'noshow', 'completed'];
        if (!validStatuses.includes(body.status)) {
          throw new BadRequestError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
        }
      }

      logger.info('Updating booking', {
        bookingId: id,
        tenantId: context.tenantId,
        updates: Object.keys(body),
        correlationId
      });

      // Handle rescheduling if time changes
      if (body.startTime || body.endTime) {
        // Get current booking to determine missing time values
        const currentBooking = await bookingService.getBookingById(id, context.tenantId);
        if (!currentBooking) {
          throw new NotFoundError(`Booking ${id} not found`);
        }

        const rescheduleRequest = {
          bookingId: id,
          tenantId: context.tenantId,
          newStartTime: body.startTime ? new Date(body.startTime) : currentBooking.startTime,
          newEndTime: body.endTime ? new Date(body.endTime) : currentBooking.endTime,
          newResourceId: body.resourceId,
          reason: body.reason || 'Booking updated',
          notifyCustomer: body.notifyCustomer !== false
        };

        const result = await bookingService.rescheduleBooking(rescheduleRequest, {
          tenantId: context.tenantId,
          userId: context.userId,
          requestId: correlationId
        });

        if (!result.success) {
          if (result.conflicts && result.conflicts.length > 0) {
            throw new ConflictError('Rescheduling conflicts detected', result.conflicts);
          }
          throw new BadRequestError(result.error || 'Failed to reschedule booking');
        }

        const booking = result.booking!;

        // Send rescheduling notification
        if (enableNotifications && notificationService && notificationWorker && body.notifyCustomer !== false) {
          await sendBookingNotification(
            notificationService,
            notificationWorker,
            booking,
            'BOOKING_RESCHEDULED',
            {},
            correlationId,
            context
          );
        }

        reply.send({
          success: true,
          data: booking,
          metadata: {
            timestamp: new Date().toISOString(),
            correlation_id: correlationId,
            version: 'v1'
          }
        });

      } else {
        // Handle general updates (status, notes, metadata)
        const updateRequest = {
          bookingId: id,
          tenantId: context.tenantId,
          status: body.status,
          notes: body.notes,
          metadata: body.metadata,
          reason: body.reason || 'Booking updated',
          notifyCustomer: body.notifyCustomer !== false
        };

        const result = await bookingService.updateBooking(updateRequest, {
          tenantId: context.tenantId,
          userId: context.userId,
          requestId: correlationId
        });

        if (!result.success) {
          throw new BadRequestError(result.error || 'Failed to update booking');
        }

        const booking = result.booking!;

        // Send update notification if status changed
        if (enableNotifications && notificationService && notificationWorker && body.notifyCustomer !== false && body.status) {
          const notificationType = body.status === 'confirmed' ? 'BOOKING_CONFIRMATION' : 'BOOKING_UPDATED';
          await sendBookingNotification(
            notificationService,
            notificationWorker,
            booking,
            notificationType,
            {},
            correlationId,
            context
          );
        }

        reply.send({
          success: true,
          data: booking,
          metadata: {
            timestamp: new Date().toISOString(),
            correlation_id: correlationId,
            version: 'v1'
          }
        });
      }
    })
  });

  /**
   * DELETE /bookings/:id - Cancel booking
   */
  fastify.route({
    method: 'DELETE',
    url: '/bookings/:id',
    schema: {
      tags: ['Bookings'],
      summary: 'Cancel booking',
      description: 'Cancel a booking with automatic refund calculation and notification',
      params: BookingParamsSchema,
      body: CancelBookingRequestSchema,
      response: {
        200: BookingSuccessResponseSchema,
        400: BookingErrorResponseSchema,
        404: BookingErrorResponseSchema,
        500: BookingErrorResponseSchema
      }
    },
    preHandler: [
      fastify.authenticate,
      fastify.tenantContext,
      ...(enableRateLimit ? [fastify.rateLimit({ max: 30, timeWindow: '1 minute' })] : [])
    ],
    handler: asyncHandler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as CancelBookingRequest;
      const context = request.tenantContext;
      const correlationId = request.headers['x-correlation-id'] as string || `cancel_${Date.now()}`;

      // Validate booking ID
      if (!id || id.trim() === '') {
        throw new BadRequestError('Booking ID is required');
      }

      // Validate reason if provided
      if (body.reason) {
        const validReasons = [
          'CUSTOMER_REQUEST',
          'BUSINESS_CLOSURE',
          'EMERGENCY',
          'RESOURCE_UNAVAILABLE',
          'WEATHER',
          'OTHER'
        ];
        if (!validReasons.includes(body.reason)) {
          throw new BadRequestError(`Invalid cancellation reason. Must be one of: ${validReasons.join(', ')}`);
        }
      }

      // Validate refund amount if provided
      if (body.refundAmount !== undefined) {
        if (typeof body.refundAmount !== 'number' || body.refundAmount < 0) {
          throw new BadRequestError('Refund amount must be a non-negative number');
        }
      }

      logger.info('Cancelling booking', {
        bookingId: id,
        tenantId: context.tenantId,
        reason: body.reason,
        correlationId
      });

      const cancelRequest = {
        bookingId: id,
        tenantId: context.tenantId,
        reason: body.reason,
        note: body.note,
        cancelledBy: context.userId || 'system',
        refundAmount: body.refundAmount,
        notifyCustomer: body.notifyCustomer !== false
      };

      const result = await bookingService.cancelBooking(cancelRequest, {
        tenantId: context.tenantId,
        userId: context.userId,
        requestId: correlationId
      });

      if (!result.success) {
        throw new BadRequestError(result.error || 'Failed to cancel booking');
      }

      const booking = result.booking!;

      // Send cancellation notification
      if (enableNotifications && notificationService && notificationWorker && body.notifyCustomer !== false) {
        await sendBookingNotification(
          notificationService,
          notificationWorker,
          booking,
          'BOOKING_CANCELLATION',
          {},
          correlationId,
          context,
          { refundAmount: result.metadata?.refundAmount }
        );
      }

      reply.send({
        success: true,
        data: booking,
        metadata: {
          timestamp: new Date().toISOString(),
          correlation_id: correlationId,
          refundAmount: result.metadata?.refundAmount,
          penaltyAmount: result.metadata?.penaltyAmount,
          version: 'v1'
        }
      });

      logger.info('Booking cancelled successfully', {
        bookingId: id,
        tenantId: context.tenantId,
        refundAmount: result.metadata?.refundAmount,
        correlationId
      });
    })
  });

  /**
   * POST /bookings/:id/confirm - Confirm tentative booking
   */
  fastify.route({
    method: 'POST',
    url: '/bookings/:id/confirm',
    schema: {
      tags: ['Bookings'],
      summary: 'Confirm booking',
      description: 'Confirm a tentative booking and send confirmation notification',
      params: BookingParamsSchema,
      body: ConfirmBookingRequestSchema,
      response: {
        200: BookingSuccessResponseSchema,
        400: BookingErrorResponseSchema,
        404: BookingErrorResponseSchema,
        500: BookingErrorResponseSchema
      }
    },
    preHandler: [
      fastify.authenticate,
      fastify.tenantContext,
      ...(enableRateLimit ? [fastify.rateLimit({ max: 50, timeWindow: '1 minute' })] : [])
    ],
    handler: asyncHandler(async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as ConfirmBookingRequest;
      const context = request.tenantContext;
      const correlationId = request.headers['x-correlation-id'] as string || `confirm_${Date.now()}`;

      logger.info('Confirming booking', {
        bookingId: id,
        tenantId: context.tenantId,
        correlationId
      });

      const result = await bookingService.confirmBooking(id, context.tenantId, {
        tenantId: context.tenantId,
        userId: context.userId,
        requestId: correlationId
      });

      if (!result.success) {
        throw new BadRequestError(result.error || 'Failed to confirm booking');
      }

      const booking = result.booking!;

      // Send confirmation notification
      if (enableNotifications && notificationService && notificationWorker && body.notifyCustomer !== false) {
        await sendBookingNotification(
          notificationService,
          notificationWorker,
          booking,
          'BOOKING_CONFIRMATION',
          {},
          correlationId,
          context,
          { paymentConfirmation: body.paymentConfirmation }
        );
      }

      reply.send({
        success: true,
        data: booking,
        metadata: {
          timestamp: new Date().toISOString(),
          correlation_id: correlationId,
          version: 'v1'
        }
      });

      logger.info('Booking confirmed successfully', {
        bookingId: id,
        tenantId: context.tenantId,
        correlationId
      });
    })
  });

  /**
   * GET /bookings/upcoming - Get upcoming bookings
   */
  fastify.route({
    method: 'GET',
    url: '/bookings/upcoming',
    schema: {
      tags: ['Bookings'],
      summary: 'Get upcoming bookings',
      description: 'Retrieve upcoming bookings for reminders and scheduling',
      querystring: UpcomingBookingsQuerySchema,
      response: {
        200: BookingListResponseSchema,
        400: BookingErrorResponseSchema,
        500: BookingErrorResponseSchema
      }
    },
    preHandler: [
      fastify.authenticate,
      fastify.tenantContext
    ],
    handler: asyncHandler(async (request, reply) => {
      const query = request.query as UpcomingBookingsQuery;
      const context = request.tenantContext;

      const days = query.days || 7;
      const now = new Date();
      const futureDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

      const searchCriteria = {
        tenantId: context.tenantId,
        customerId: query.customerId,
        resourceId: query.resourceId,
        status: ['confirmed', 'tentative'],
        startDate: now,
        endDate: futureDate,
        limit: Math.min(query.limit || defaultPageSize, maxPageSize),
        offset: query.offset || ((query.page || 1) - 1) * (query.limit || defaultPageSize),
        sortBy: 'startTime' as any,
        sortOrder: 'ASC' as any
      };

      const result = await bookingService.searchBookings(searchCriteria);

      reply.send({
        data: result.data,
        pagination: {
          page: Math.floor((searchCriteria.offset || 0) / searchCriteria.limit) + 1,
          limit: searchCriteria.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / searchCriteria.limit),
          hasNext: (searchCriteria.offset || 0) + searchCriteria.limit < result.total,
          hasPrev: (searchCriteria.offset || 0) > 0
        },
        metadata: {
          timestamp: new Date().toISOString(),
          lookAheadDays: days,
          version: 'v1'
        }
      });
    })
  });

  /**
   * POST /bookings/check-availability - Check booking availability
   */
  fastify.route({
    method: 'POST',
    url: '/bookings/check-availability',
    schema: {
      tags: ['Bookings'],
      summary: 'Check availability',
      description: 'Check if a time slot is available for booking',
      body: CheckAvailabilityRequestSchema,
      response: {
        200: CheckAvailabilityResponseSchema,
        400: BookingErrorResponseSchema,
        500: BookingErrorResponseSchema
      }
    },
    preHandler: [
      fastify.authenticate,
      fastify.tenantContext,
      ...(enableRateLimit ? [fastify.rateLimit({ max: 100, timeWindow: '1 minute' })] : [])
    ],
    handler: asyncHandler(async (request, reply) => {
      const body = request.body as CheckAvailabilityRequest;
      const context = request.tenantContext;

      const availabilityRequest = {
        tenantId: context.tenantId,
        resourceId: body.resourceId,
        startTime: new Date(body.startTime),
        endTime: new Date(body.endTime),
        capacity: body.capacity || 1,
        excludeBookingId: body.excludeBookingId
      };

      const result = await bookingService.checkAvailability(availabilityRequest);

      reply.send({
        ...result,
        metadata: {
          timestamp: new Date().toISOString(),
          version: 'v1'
        }
      });
    })
  });

  /**
   * POST /bookings/batch - Create multiple bookings
   */
  fastify.route({
    method: 'POST',
    url: '/bookings/batch',
    schema: {
      tags: ['Bookings'],
      summary: 'Create multiple bookings',
      description: 'Create multiple bookings atomically or with partial failure handling',
      body: BatchBookingRequestSchema,
      response: {
        201: BatchBookingResponseSchema,
        400: BookingErrorResponseSchema,
        409: BookingErrorResponseSchema,
        500: BookingErrorResponseSchema
      }
    },
    preHandler: [
      fastify.authenticate,
      fastify.tenantContext,
      ...(enableRateLimit ? [fastify.rateLimit({ max: 10, timeWindow: '1 minute' })] : [])
    ],
    handler: asyncHandler(async (request, reply) => {
      const body = request.body as BatchBookingRequest;
      const context = request.tenantContext;
      const correlationId = request.headers['x-correlation-id'] as string || `batch_${Date.now()}`;

      logger.info('Creating batch bookings', {
        tenantId: context.tenantId,
        bookingCount: body.bookings.length,
        atomicMode: body.atomicMode,
        correlationId
      });

      // Convert to batch booking request
      const batchRequest = {
        tenantId: context.tenantId,
        bookings: body.bookings.map(b => ({
          ...b,
          tenantId: context.tenantId,
          startTime: new Date(b.startTime),
          endTime: new Date(b.endTime),
          metadata: { 
            ...b.metadata, 
            correlationId,
            batchOperation: true 
          }
        })),
        atomicMode: body.atomicMode || false,
        allowPartialFailure: body.allowPartialFailure !== false
      };

      const result = await bookingService.createBatchBookings(batchRequest, {
        tenantId: context.tenantId,
        userId: context.userId,
        requestId: correlationId
      });

      // Send notifications for successful bookings
      if (enableNotifications && notificationService && notificationWorker && result.successfulBookings.length > 0) {
        for (const booking of result.successfulBookings) {
          await sendBookingNotification(
            notificationService,
            notificationWorker,
            booking,
            'BOOKING_CONFIRMATION',
            {},
            correlationId,
            context
          ).catch(error => {
            logger.error('Failed to send batch booking notification', {
              bookingId: booking.id,
              error
            });
          });
        }
      }

      reply.status(201).send({
        ...result,
        metadata: {
          timestamp: new Date().toISOString(),
          correlation_id: correlationId,
          version: 'v1'
        }
      });

      logger.info('Batch booking completed', {
        tenantId: context.tenantId,
        totalProcessed: result.totalProcessed,
        successful: result.totalSuccessful,
        failed: result.totalFailed,
        correlationId
      });
    })
  });

  /**
   * GET /bookings/statistics - Get booking statistics
   */
  fastify.route({
    method: 'GET',
    url: '/bookings/statistics',
    schema: {
      tags: ['Bookings'],
      summary: 'Get booking statistics',
      description: 'Retrieve comprehensive booking statistics for reporting and analytics',
      querystring: {
        type: 'object',
        properties: {
          startDate: { type: 'string', format: 'date-time' },
          endDate: { type: 'string', format: 'date-time' },
          resourceId: { type: 'string' }
        },
        required: ['startDate', 'endDate']
      },
      response: {
        200: BookingStatisticsResponseSchema,
        400: BookingErrorResponseSchema,
        500: BookingErrorResponseSchema
      }
    },
    preHandler: [
      fastify.authenticate,
      fastify.tenantContext,
      fastify.authorize(['admin', 'manager'])
    ],
    handler: asyncHandler(async (request, reply) => {
      const query = request.query as {
        startDate: string;
        endDate: string;
        resourceId?: string;
      };
      const context = request.tenantContext;

      const statistics = await bookingService.getBookingStatistics(
        context.tenantId,
        new Date(query.startDate),
        new Date(query.endDate),
        query.resourceId
      );

      reply.send({
        ...statistics,
        metadata: {
          timestamp: new Date().toISOString(),
          version: 'v1'
        }
      });
    })
  });

  // Helper functions

  /**
   * Send booking notification
   */
  async function sendBookingNotification(
    notificationService: NotificationService,
    notificationWorker: NotificationWorker,
    booking: any,
    templateType: NotificationTemplateType,
    preferences: any = {},
    correlationId: string,
    context: any,
    additionalData?: any
  ): Promise<void> {
    try {
      // Determine notification channels based on preferences
      const channels: NotificationChannel[] = [];
      
      if (preferences.email !== false) channels.push('EMAIL');
      if (preferences.sms === true) channels.push('SMS');
      if (preferences.push === true) channels.push('PUSH');
      if (preferences.line === true) channels.push('LINE');
      
      // Default to email if no preferences specified
      if (channels.length === 0) channels.push('EMAIL');

      // Create notification variables
      const variables = {
        customerName: booking.customerInfo?.name || 'Customer',
        bookingId: booking.id,
        serviceName: booking.serviceInfo?.name?.ja || booking.serviceInfo?.name?.en || 'Service',
        resourceName: booking.resourceInfo?.name?.ja || booking.resourceInfo?.name?.en || 'Resource',
        startTime: new Date(booking.startTime).toLocaleString('ja-JP'),
        endTime: new Date(booking.endTime).toLocaleString('ja-JP'),
        duration: Math.round((new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime()) / (1000 * 60)) + ' minutes',
        totalAmount: `¥${booking.totalJpy.toLocaleString()}`,
        bookingStatus: booking.status,
        confirmationUrl: `${process.env.FRONTEND_URL}/bookings/${booking.id}`,
        cancellationUrl: `${process.env.FRONTEND_URL}/bookings/${booking.id}/cancel`,
        businessName: process.env.BUSINESS_NAME || 'Booking System',
        systemName: process.env.SYSTEM_NAME || 'Booking Platform',
        currentDate: new Date().toLocaleDateString('ja-JP'),
        ...additionalData
      };

      // Get recipient information
      const recipient = {
        id: booking.customerId,
        name: booking.customerInfo?.name,
        email: booking.customerInfo?.email,
        phone: booking.customerInfo?.phone,
        language: (preferences.language || 'ja') as any,
        timezone: 'Asia/Tokyo'
      };

      // Send notification for each channel
      for (const channel of channels) {
        const notificationRequest: NotificationRequest = {
          tenantId: context.tenantId,
          templateType,
          channel,
          recipient: {
            ...recipient,
            ...(channel === 'EMAIL' && !recipient.email ? { email: 'customer@example.com' } : {}),
            ...(channel === 'SMS' && !recipient.phone ? { phone: '+819012345678' } : {}),
            ...(channel === 'PUSH' ? { deviceTokens: ['dummy_token'] } : {}),
            ...(channel === 'LINE' ? { lineUserId: 'dummy_line_id' } : {})
          },
          variables,
          priority: templateType === 'BOOKING_CONFIRMATION' ? 'HIGH' : 'NORMAL',
          tags: ['booking', templateType.toLowerCase(), channel.toLowerCase()],
          correlationId,
          metadata: {
            bookingId: booking.id,
            templateType,
            channel
          }
        };

        await notificationWorker.addImmediateNotification(
          notificationRequest,
          context,
          { priority: notificationRequest.priority === 'HIGH' ? 1 : 5 }
        );
      }

      logger.info('Booking notification queued', {
        bookingId: booking.id,
        templateType,
        channels,
        correlationId
      });

    } catch (error) {
      logger.error('Failed to queue booking notification', {
        bookingId: booking.id,
        templateType,
        error,
        correlationId
      });
      // Don't throw - notification failure shouldn't fail the booking operation
    }
  }

  /**
   * Generate booking suggestions for conflicts
   */
  function generateBookingSuggestions(conflicts: any[], request: CreateBookingRequest): any[] {
    const suggestions = [];

    // Suggest alternative times based on conflicts
    for (const conflict of conflicts) {
      if (conflict.suggestedStartTime && conflict.suggestedEndTime) {
        suggestions.push({
          action: 'reschedule',
          description: 'Try this alternative time slot',
          alternativeSlots: [{
            startTime: conflict.suggestedStartTime,
            endTime: conflict.suggestedEndTime,
            availableCapacity: conflict.availableCapacity || 1
          }]
        });
      }
    }

    // Default suggestions
    if (suggestions.length === 0) {
      suggestions.push({
        action: 'check_availability',
        description: 'Check available time slots for this resource',
        alternativeSlots: []
      });
    }

    return suggestions;
  }

  /**
   * Record booking analytics
   */
  async function recordBookingAnalytics(
    event: string,
    booking: any,
    context: any
  ): Promise<void> {
    try {
      // Implementation would send analytics data to tracking service
      logger.debug('Recording booking analytics', {
        event,
        bookingId: booking.id,
        tenantId: context.tenantId,
        serviceId: booking.serviceId,
        resourceId: booking.resourceId,
        totalJpy: booking.totalJpy
      });
    } catch (error) {
      logger.warn('Failed to record booking analytics', { error });
      // Don't throw - analytics failure shouldn't fail the booking operation
    }
  }

  logger.info('Booking routes registered successfully', {
    enableNotifications,
    enableIdempotency,
    enableRateLimit,
    enableAnalytics
  });
}

export default bookingRoutes;