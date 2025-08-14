/**
 * Booking Service
 * Core business logic for booking management with double-booking prevention,
 * atomic transactions, and comprehensive error handling
 */

import { FastifyInstance } from 'fastify';
import {
  BookingRequest,
  MultiSlotBookingRequest,
  BookingResponse,
  BookingOperationResult,
  BookingValidationResult,
  BookingAvailabilityRequest,
  BookingAvailabilityResponse,
  BookingSearchCriteria,
  BookingStatistics,
  BookingRescheduleRequest,
  BookingCancellationRequest,
  CancellationReason,
  BookingStatus,
  BatchBookingRequest,
  BatchBookingResponse,
  TentativeBookingConfig,
  BookingPolicyConfig,
  BookingCleanupConfig,
  BookingPerformanceMetrics
} from '../types/booking.js';
import { TimeSlot } from '../types/availability.js';
import { TenantContext } from '../types/database.js';
import { BookingRepository } from '../repositories/booking.repository.js';
import { BookingValidatorService } from './booking-validator.service.js';
import { SlotService } from './slot.service.js';
import { InventoryService } from './inventory.service.js';
import { CacheService } from './cache.service.js';
import BookingLockManager, { LockPriority, LockResult } from '../utils/booking-lock.js';
import { withTransaction, TransactionContext } from '../db/transaction.js';
import { logger } from '../config/logger.js';
import { InternalServerError, ConflictError, BadRequestError, NotFoundError } from '../utils/errors.js';

/**
 * Booking service configuration
 */
interface BookingServiceConfig {
  tentativeBooking: TentativeBookingConfig;
  bookingPolicy: BookingPolicyConfig;
  cleanup: BookingCleanupConfig;
  performance: {
    enableMetrics: boolean;
    maxMetricsHistory: number;
    slowOperationThresholdMs: number;
  };
}

/**
 * Booking operation context
 */
interface BookingOperationContext {
  tenantId: string;
  userId?: string;
  sessionId?: string;
  requestId?: string;
  clientInfo?: {
    userAgent?: string;
    ipAddress?: string;
  };
}

/**
 * Main booking service with comprehensive business logic
 */
export class BookingService {
  private repository: BookingRepository;
  private validator: BookingValidatorService;
  private slotService: SlotService;
  private inventoryService: InventoryService;
  private lockManager: BookingLockManager;
  private cache: CacheService;
  private config: BookingServiceConfig;
  private performanceMetrics: BookingPerformanceMetrics[] = [];

  constructor(private fastify: FastifyInstance) {
    this.repository = new BookingRepository();
    this.validator = new BookingValidatorService(fastify);
    this.slotService = new SlotService(fastify);
    this.inventoryService = new InventoryService(fastify);
    this.lockManager = new BookingLockManager(fastify, {
      defaultTtlSeconds: 300,
      maxRetries: 3,
      retryDelayMs: 100,
      deadlockDetectionEnabled: true,
      lockTimeoutMs: 10000,
      maxConcurrentLocks: 1000
    });
    
    this.cache = new CacheService(fastify, {
      defaultTTL: 300, // 5 minutes
      memory: {
        enabled: true,
        maxSize: 32 * 1024 * 1024, // 32MB
        maxItems: 2000,
        ttlRatio: 0.4
      }
    });

    this.config = {
      tentativeBooking: {
        enabled: true,
        timeoutMinutes: 15,
        autoConfirmOnPayment: true,
        maxTentativePerCustomer: 3,
        cleanupIntervalMinutes: 5
      },
      bookingPolicy: {
        minBookingDuration: 15,
        maxBookingDuration: 480,
        advanceBookingDays: 30,
        maxConcurrentBookings: 5,
        cancellationPolicy: {
          allowedUntilHours: 24,
          penaltyPercentage: 10,
          refundPolicy: 'PARTIAL'
        },
        preventDoubleBooking: true,
        allowOverbooking: false,
        requirePaymentConfirmation: false,
        autoReleaseUnconfirmedMinutes: 15
      },
      cleanup: {
        enabled: true,
        intervalMinutes: 5,
        tentativeBookingTimeoutMinutes: 15,
        expiredBookingRetentionDays: 30,
        notificationBeforeCleanupHours: 1
      },
      performance: {
        enableMetrics: true,
        maxMetricsHistory: 1000,
        slowOperationThresholdMs: 2000
      }
    };

    // Start background processes
    this.startBackgroundProcesses();
  }

  /**
   * Create a new booking with double-booking prevention
   */
  async createBooking(
    request: BookingRequest,
    context: BookingOperationContext
  ): Promise<BookingOperationResult> {
    const startTime = Date.now();
    const operationId = `create_${request.idempotencyKey}`;

    try {
      logger.info('Starting booking creation', {
        tenantId: request.tenantId,
        customerId: request.customerId,
        resourceId: request.resourceId,
        startTime: request.startTime,
        endTime: request.endTime,
        idempotencyKey: request.idempotencyKey,
        operationId
      });

      // 1. Check for existing booking with same idempotency key
      const existingBooking = await this.repository.findByIdempotencyKey(
        request.tenantId,
        request.idempotencyKey
      );

      if (existingBooking) {
        logger.info('Returning existing booking for idempotency key', {
          bookingId: existingBooking.id,
          idempotencyKey: request.idempotencyKey
        });

        this.recordPerformanceMetric('createBooking', startTime, true, 0, 0, context.tenantId);
        return {
          success: true,
          booking: existingBooking,
          metadata: { fromCache: true, operationId }
        };
      }

      // 2. Validate booking request
      const validation = await this.validator.validateBookingRequest(
        request,
        this.config.bookingPolicy
      );

      if (!validation.isValid) {
        logger.warn('Booking validation failed', {
          tenantId: request.tenantId,
          errors: validation.errors,
          operationId
        });

        this.recordPerformanceMetric('createBooking', startTime, false, 0, 0, context.tenantId);
        return {
          success: false,
          error: `Validation failed: ${validation.errors.join('; ')}`,
          conflicts: validation.errors.map(error => ({
            type: 'BUSINESS_RULE_VIOLATION',
            message: error
          }))
        };
      }

      // 3. Get required time slots
      const timeSlots = await this.getRequiredTimeSlots(request);
      if (timeSlots.length === 0) {
        this.recordPerformanceMetric('createBooking', startTime, false, 0, 0, context.tenantId);
        return {
          success: false,
          error: 'No time slots available for the requested period'
        };
      }

      // 4. Acquire distributed locks to prevent double booking
      const lockResult = await this.acquireBookingLocks(
        request.resourceId,
        timeSlots,
        request.tenantId,
        operationId
      );

      if (!lockResult.success) {
        logger.warn('Failed to acquire booking locks', {
          tenantId: request.tenantId,
          resourceId: request.resourceId,
          error: lockResult.error,
          operationId
        });

        this.recordPerformanceMetric('createBooking', startTime, false, lockResult.waitTime || 0, 0, context.tenantId);
        return {
          success: false,
          error: 'Resource is currently being booked by another request',
          conflicts: [{
            type: 'CAPACITY_EXCEEDED',
            message: 'Resource temporarily unavailable due to concurrent booking'
          }]
        };
      }

      try {
        // 5. Perform final availability check within the lock
        const finalAvailabilityCheck = await this.checkFinalAvailability(request, timeSlots);
        if (!finalAvailabilityCheck.available) {
          await this.releaseLocks(lockResult.lockInfo!);
          
          this.recordPerformanceMetric('createBooking', startTime, false, lockResult.waitTime || 0, 0, context.tenantId);
          return {
            success: false,
            error: 'Slots no longer available',
            conflicts: finalAvailabilityCheck.conflicts
          };
        }

        // 6. Create booking atomically
        const booking = await this.repository.createBooking(
          request,
          timeSlots,
          {
            tenantId: request.tenantId,
            userId: context.userId
          },
          {
            autoConfirm: !this.config.tentativeBooking.enabled,
            tentativeTimeoutMinutes: this.config.tentativeBooking.timeoutMinutes
          }
        );

        // 7. Success - release locks
        await this.releaseLocks(lockResult.lockInfo!);

        // 8. Invalidate relevant caches
        await this.invalidateBookingCaches(request.tenantId, request.resourceId, timeSlots);

        // 9. Schedule tentative booking cleanup if needed
        if (booking.status === 'tentative' && booking.expiresAt) {
          this.scheduleTentativeBookingCleanup(booking.id, booking.expiresAt);
        }

        logger.info('Booking created successfully', {
          bookingId: booking.id,
          tenantId: request.tenantId,
          status: booking.status,
          duration: Date.now() - startTime,
          operationId
        });

        this.recordPerformanceMetric(
          'createBooking', 
          startTime, 
          true, 
          lockResult.waitTime || 0, 
          Date.now() - startTime - (lockResult.waitTime || 0), 
          context.tenantId,
          request.resourceId
        );

        return {
          success: true,
          booking,
          lockInfo: lockResult.lockInfo,
          metadata: { operationId, lockTime: lockResult.waitTime }
        };

      } catch (error) {
        // Ensure locks are released on error
        await this.releaseLocks(lockResult.lockInfo!);
        throw error;
      }

    } catch (error) {
      logger.error('Booking creation failed', {
        tenantId: request.tenantId,
        idempotencyKey: request.idempotencyKey,
        error,
        operationId
      });

      this.recordPerformanceMetric('createBooking', startTime, false, 0, 0, context.tenantId);

      // Categorize error for better client handling
      let errorMessage = 'Booking creation failed';
      let errorCode = 'BOOKING_CREATION_ERROR';

      if (error.message.includes('capacity')) {
        errorMessage = 'Insufficient capacity available';
        errorCode = 'CAPACITY_ERROR';
      } else if (error.message.includes('conflict')) {
        errorMessage = 'Booking conflicts detected';
        errorCode = 'CONFLICT_ERROR';
      } else if (error.message.includes('validation')) {
        errorMessage = 'Invalid booking data provided';
        errorCode = 'VALIDATION_ERROR';
      } else if (error.message.includes('timeout')) {
        errorMessage = 'Booking creation timed out';
        errorCode = 'TIMEOUT_ERROR';
      }

      return {
        success: false,
        error: errorMessage,
        code: errorCode,
        details: error.message,
        metadata: { operationId }
      };
    }
  }

  /**
   * Create multiple bookings atomically
   */
  async createBatchBookings(
    request: BatchBookingRequest,
    context: BookingOperationContext
  ): Promise<BatchBookingResponse> {
    const startTime = Date.now();

    try {
      logger.info('Starting batch booking creation', {
        tenantId: request.tenantId,
        bookingCount: request.bookings.length,
        atomicMode: request.atomicMode
      });

      const successfulBookings: BookingResponse[] = [];
      const failedBookings: Array<{
        request: BookingRequest;
        error: string;
        conflicts?: any[];
      }> = [];

      if (request.atomicMode) {
        // All bookings must succeed or all fail
        return withTransaction(async (ctx) => {
          for (const bookingRequest of request.bookings) {
            const result = await this.createBooking(bookingRequest, context);
            
            if (result.success && result.booking) {
              successfulBookings.push(result.booking);
            } else {
              failedBookings.push({
                request: bookingRequest,
                error: result.error || 'Unknown error',
                conflicts: result.conflicts
              });
              
              // In atomic mode, fail all if one fails
              throw new ConflictError(`Batch booking failed: ${result.error}`);
            }
          }

          return {
            success: true,
            successfulBookings,
            failedBookings: [],
            totalProcessed: request.bookings.length,
            totalSuccessful: successfulBookings.length,
            totalFailed: 0
          };
        });

      } else {
        // Process each booking independently
        for (const bookingRequest of request.bookings) {
          try {
            const result = await this.createBooking(bookingRequest, context);
            
            if (result.success && result.booking) {
              successfulBookings.push(result.booking);
            } else {
              failedBookings.push({
                request: bookingRequest,
                error: result.error || 'Unknown error',
                conflicts: result.conflicts
              });
            }
          } catch (error) {
            failedBookings.push({
              request: bookingRequest,
              error: error.message
            });
          }
        }

        return {
          success: failedBookings.length === 0,
          successfulBookings,
          failedBookings,
          totalProcessed: request.bookings.length,
          totalSuccessful: successfulBookings.length,
          totalFailed: failedBookings.length
        };
      }

    } catch (error) {
      logger.error('Batch booking creation failed', {
        tenantId: request.tenantId,
        error
      });

      return {
        success: false,
        successfulBookings: [],
        failedBookings: request.bookings.map(req => ({
          request: req,
          error: error.message
        })),
        totalProcessed: request.bookings.length,
        totalSuccessful: 0,
        totalFailed: request.bookings.length
      };
    }
  }

  /**
   * Confirm a tentative booking
   */
  async confirmBooking(
    bookingId: string,
    tenantId: string,
    context: BookingOperationContext
  ): Promise<BookingOperationResult> {
    const startTime = Date.now();

    try {
      logger.info('Confirming booking', { bookingId, tenantId });

      const booking = await this.repository.updateBookingStatus(
        bookingId,
        tenantId,
        'confirmed',
        {
          tenantId,
          userId: context.userId
        },
        {
          reason: 'Booking confirmed by user',
          recordHistory: true
        }
      );

      if (!booking) {
        this.recordPerformanceMetric('confirmBooking', startTime, false, 0, 0, tenantId);
        return {
          success: false,
          error: 'Booking not found'
        };
      }

      // Invalidate caches
      await this.invalidateBookingCaches(tenantId, booking.resourceId, booking.bookedSlots);

      logger.info('Booking confirmed successfully', {
        bookingId,
        tenantId
      });

      this.recordPerformanceMetric('confirmBooking', startTime, true, 0, 0, tenantId, booking.resourceId);

      return {
        success: true,
        booking
      };

    } catch (error) {
      logger.error('Failed to confirm booking', { bookingId, tenantId, error });
      this.recordPerformanceMetric('confirmBooking', startTime, false, 0, 0, tenantId);

      return {
        success: false,
        error: `Failed to confirm booking: ${error.message}`
      };
    }
  }

  /**
   * Cancel a booking
   */
  async cancelBooking(
    request: BookingCancellationRequest,
    context: BookingOperationContext
  ): Promise<BookingOperationResult> {
    const startTime = Date.now();

    try {
      logger.info('Cancelling booking', {
        bookingId: request.bookingId,
        tenantId: request.tenantId,
        reason: request.reason
      });

      // Validate cancellation
      const cancellationValidation = await this.validator.validateCancellation(
        request.bookingId,
        request.tenantId,
        request.reason
      );

      if (!cancellationValidation.allowed) {
        this.recordPerformanceMetric('cancelBooking', startTime, false, 0, 0, request.tenantId);
        return {
          success: false,
          error: `Cancellation not allowed: ${cancellationValidation.errors.join('; ')}`
        };
      }

      // Cancel booking
      const booking = await this.repository.cancelBooking(
        request.bookingId,
        request.tenantId,
        request.reason,
        request.note || '',
        request.cancelledBy,
        {
          tenantId: request.tenantId,
          userId: context.userId
        }
      );

      if (!booking) {
        this.recordPerformanceMetric('cancelBooking', startTime, false, 0, 0, request.tenantId);
        return {
          success: false,
          error: 'Booking not found'
        };
      }

      // Invalidate caches
      await this.invalidateBookingCaches(request.tenantId, booking.resourceId, booking.bookedSlots);

      logger.info('Booking cancelled successfully', {
        bookingId: request.bookingId,
        tenantId: request.tenantId,
        refundAmount: cancellationValidation.refundAmount
      });

      this.recordPerformanceMetric('cancelBooking', startTime, true, 0, 0, request.tenantId, booking.resourceId);

      return {
        success: true,
        booking,
        metadata: {
          refundAmount: cancellationValidation.refundAmount,
          penaltyAmount: cancellationValidation.penaltyAmount
        }
      };

    } catch (error) {
      logger.error('Failed to cancel booking', {
        bookingId: request.bookingId,
        tenantId: request.tenantId,
        error
      });

      this.recordPerformanceMetric('cancelBooking', startTime, false, 0, 0, request.tenantId);

      return {
        success: false,
        error: `Failed to cancel booking: ${error.message}`
      };
    }
  }

  /**
   * Update a booking (non-time changes)
   */
  async updateBooking(
    request: {
      bookingId: string;
      tenantId: string;
      status?: BookingStatus;
      notes?: string;
      metadata?: any;
      reason?: string;
      notifyCustomer?: boolean;
    },
    context: BookingOperationContext
  ): Promise<BookingOperationResult> {
    const startTime = Date.now();

    try {
      logger.info('Updating booking', {
        bookingId: request.bookingId,
        tenantId: request.tenantId,
        status: request.status,
        reason: request.reason
      });

      // Check if booking exists
      const currentBooking = await this.repository.findByIdWithDetails(request.bookingId, request.tenantId);
      if (!currentBooking) {
        this.recordPerformanceMetric('updateBooking', startTime, false, 0, 0, request.tenantId);
        return {
          success: false,
          error: 'Booking not found'
        };
      }

      let updatedBooking: BookingResponse | null = null;

      // Handle status updates
      if (request.status) {
        updatedBooking = await this.repository.updateBookingStatus(
          request.bookingId,
          request.tenantId,
          request.status,
          {
            tenantId: request.tenantId,
            userId: context.userId
          },
          {
            reason: request.reason,
            recordHistory: true
          }
        );
      } else {
        // Handle other updates (notes, metadata)
        const updateData: any = {};
        
        if (request.notes !== undefined) {
          updateData.notes = request.notes;
        }
        
        if (request.metadata !== undefined) {
          updateData.metadata = request.metadata;
        }

        if (Object.keys(updateData).length > 0) {
          updatedBooking = await this.repository.updateBookingFields(
            request.bookingId,
            request.tenantId,
            updateData,
            {
              tenantId: request.tenantId,
              userId: context.userId
            },
            {
              reason: request.reason,
              recordHistory: true
            }
          );
        } else {
          // No updates provided, return current booking
          updatedBooking = currentBooking;
        }
      }

      if (!updatedBooking) {
        this.recordPerformanceMetric('updateBooking', startTime, false, 0, 0, request.tenantId);
        return {
          success: false,
          error: 'Failed to update booking'
        };
      }

      // Invalidate caches
      await this.invalidateBookingCaches(request.tenantId, updatedBooking.resourceId, updatedBooking.bookedSlots);

      logger.info('Booking updated successfully', {
        bookingId: request.bookingId,
        tenantId: request.tenantId,
        status: request.status
      });

      this.recordPerformanceMetric('updateBooking', startTime, true, 0, 0, request.tenantId, updatedBooking.resourceId);

      return {
        success: true,
        booking: updatedBooking
      };

    } catch (error) {
      logger.error('Failed to update booking', {
        bookingId: request.bookingId,
        tenantId: request.tenantId,
        error
      });

      this.recordPerformanceMetric('updateBooking', startTime, false, 0, 0, request.tenantId);

      return {
        success: false,
        error: `Failed to update booking: ${error.message}`
      };
    }
  }

  /**
   * Reschedule a booking
   */
  async rescheduleBooking(
    request: BookingRescheduleRequest,
    context: BookingOperationContext
  ): Promise<BookingOperationResult> {
    const startTime = Date.now();
    const operationId = `reschedule_${request.bookingId}_${Date.now()}`;

    try {
      logger.info('Rescheduling booking', {
        bookingId: request.bookingId,
        tenantId: request.tenantId,
        newStartTime: request.newStartTime,
        newEndTime: request.newEndTime,
        operationId
      });

      // Get new time slots
      const newTimeSlots = await this.getRequiredTimeSlotsForPeriod(
        request.tenantId,
        request.newResourceId || '', // Will be filled from existing booking
        request.newStartTime,
        request.newEndTime
      );

      if (newTimeSlots.length === 0) {
        this.recordPerformanceMetric('rescheduleBooking', startTime, false, 0, 0, request.tenantId);
        return {
          success: false,
          error: 'No time slots available for the new period'
        };
      }

      // Acquire locks for new time slots
      const lockResult = await this.acquireBookingLocks(
        request.newResourceId || newTimeSlots[0].resourceId,
        newTimeSlots,
        request.tenantId,
        operationId
      );

      if (!lockResult.success) {
        this.recordPerformanceMetric('rescheduleBooking', startTime, false, lockResult.waitTime || 0, 0, request.tenantId);
        return {
          success: false,
          error: 'Resource is currently being booked by another request'
        };
      }

      try {
        // Reschedule booking
        const booking = await this.repository.rescheduleBooking(
          request.bookingId,
          request.tenantId,
          request.newStartTime,
          request.newEndTime,
          newTimeSlots,
          request.reason,
          {
            tenantId: request.tenantId,
            userId: context.userId
          }
        );

        await this.releaseLocks(lockResult.lockInfo!);

        if (!booking) {
          this.recordPerformanceMetric('rescheduleBooking', startTime, false, lockResult.waitTime || 0, 0, request.tenantId);
          return {
            success: false,
            error: 'Booking not found'
          };
        }

        // Invalidate caches
        await this.invalidateBookingCaches(request.tenantId, booking.resourceId, booking.bookedSlots);

        logger.info('Booking rescheduled successfully', {
          bookingId: request.bookingId,
          tenantId: request.tenantId,
          operationId
        });

        this.recordPerformanceMetric(
          'rescheduleBooking', 
          startTime, 
          true, 
          lockResult.waitTime || 0, 
          Date.now() - startTime - (lockResult.waitTime || 0), 
          request.tenantId, 
          booking.resourceId
        );

        return {
          success: true,
          booking,
          lockInfo: lockResult.lockInfo
        };

      } catch (error) {
        await this.releaseLocks(lockResult.lockInfo!);
        throw error;
      }

    } catch (error) {
      logger.error('Failed to reschedule booking', {
        bookingId: request.bookingId,
        tenantId: request.tenantId,
        error,
        operationId
      });

      this.recordPerformanceMetric('rescheduleBooking', startTime, false, 0, 0, request.tenantId);

      return {
        success: false,
        error: `Failed to reschedule booking: ${error.message}`
      };
    }
  }

  /**
   * Check booking availability
   */
  async checkAvailability(
    request: BookingAvailabilityRequest
  ): Promise<BookingAvailabilityResponse> {
    const startTime = Date.now();

    try {
      const response = await this.validator.checkBookingAvailability(request);
      
      this.recordPerformanceMetric('checkAvailability', startTime, true, 0, 0, request.tenantId, request.resourceId);
      
      return response;

    } catch (error) {
      logger.error('Failed to check availability', { request, error });
      this.recordPerformanceMetric('checkAvailability', startTime, false, 0, 0, request.tenantId, request.resourceId);

      return {
        available: false,
        conflicts: [{
          type: 'RESOURCE_UNAVAILABLE',
          message: `Availability check failed: ${error.message}`
        }],
        availableCapacity: 0,
        totalCapacity: 0
      };
    }
  }

  /**
   * Get booking by ID
   */
  async getBookingById(
    bookingId: string,
    tenantId: string
  ): Promise<BookingResponse | null> {
    const startTime = Date.now();

    try {
      logger.debug('Getting booking by ID', { bookingId, tenantId });

      const booking = await this.repository.findByIdWithDetails(bookingId, tenantId);
      
      this.recordPerformanceMetric('getBookingById', startTime, true, 0, 0, tenantId);
      
      return booking;

    } catch (error) {
      logger.error('Failed to get booking by ID', { bookingId, tenantId, error });
      this.recordPerformanceMetric('getBookingById', startTime, false, 0, 0, tenantId);
      
      throw new InternalServerError('Failed to get booking');
    }
  }

  /**
   * Search bookings
   */
  async searchBookings(criteria: BookingSearchCriteria): Promise<any> {
    const startTime = Date.now();

    try {
      const result = await this.repository.searchBookings(criteria);
      
      this.recordPerformanceMetric('searchBookings', startTime, true, 0, 0, criteria.tenantId);
      
      return result;

    } catch (error) {
      logger.error('Failed to search bookings', { criteria, error });
      this.recordPerformanceMetric('searchBookings', startTime, false, 0, 0, criteria.tenantId);
      
      throw new InternalServerError('Failed to search bookings');
    }
  }

  /**
   * Get booking statistics
   */
  async getBookingStatistics(
    tenantId: string,
    startDate: Date,
    endDate: Date,
    resourceId?: string
  ): Promise<BookingStatistics> {
    const startTime = Date.now();

    try {
      const stats = await this.repository.getBookingStatistics(
        tenantId,
        startDate,
        endDate,
        resourceId
      );
      
      this.recordPerformanceMetric('getBookingStatistics', startTime, true, 0, 0, tenantId, resourceId);
      
      return stats;

    } catch (error) {
      logger.error('Failed to get booking statistics', {
        tenantId,
        startDate,
        endDate,
        resourceId,
        error
      });

      this.recordPerformanceMetric('getBookingStatistics', startTime, false, 0, 0, tenantId, resourceId);
      
      throw new InternalServerError('Failed to get booking statistics');
    }
  }

  /**
   * Get service performance metrics
   */
  getPerformanceMetrics(): BookingPerformanceMetrics[] {
    return [...this.performanceMetrics];
  }

  /**
   * Clear performance metrics
   */
  clearPerformanceMetrics(): void {
    this.performanceMetrics = [];
  }

  // Private helper methods

  private async getRequiredTimeSlots(request: BookingRequest): Promise<TimeSlot[]> {
    try {
      const slots = await this.slotService.getAvailableSlots({
        tenantId: request.tenantId,
        resourceIds: [request.resourceId],
        startDate: request.startTime,
        endDate: request.endTime,
        capacity: request.capacity || 1
      });

      // Filter slots that exactly match the requested time period
      return slots.filter(slot => 
        slot.startTime >= request.startTime && 
        slot.endTime <= request.endTime &&
        slot.availableCapacity >= (request.capacity || 1)
      );

    } catch (error) {
      logger.error('Failed to get required time slots', { request, error });
      return [];
    }
  }

  private async getRequiredTimeSlotsForPeriod(
    tenantId: string,
    resourceId: string,
    startTime: Date,
    endTime: Date
  ): Promise<TimeSlot[]> {
    try {
      const slots = await this.slotService.getAvailableSlots({
        tenantId,
        resourceIds: [resourceId],
        startDate: startTime,
        endDate: endTime,
        capacity: 1
      });

      return slots.filter(slot => 
        slot.startTime >= startTime && 
        slot.endTime <= endTime &&
        slot.availableCapacity > 0
      );

    } catch (error) {
      logger.error('Failed to get required time slots for period', {
        tenantId,
        resourceId,
        startTime,
        endTime,
        error
      });
      return [];
    }
  }

  private async acquireBookingLocks(
    resourceId: string,
    timeSlots: TimeSlot[],
    tenantId: string,
    operationId: string
  ): Promise<LockResult> {
    const timeSlotIds = timeSlots.map(slot => slot.id);
    
    return this.lockManager.acquireLock(
      resourceId,
      timeSlotIds,
      tenantId,
      {
        ttlSeconds: 300, // 5 minutes
        priority: LockPriority.HIGH,
        timeoutMs: 10000, // 10 seconds
        waitForLock: true,
        metadata: { operationId }
      }
    );
  }

  private async releaseLocks(lockInfo: any): Promise<void> {
    try {
      await this.lockManager.releaseLock(lockInfo);
    } catch (error) {
      logger.error('Failed to release locks', { lockInfo, error });
      // Don't throw - locks will expire automatically
    }
  }

  private async checkFinalAvailability(
    request: BookingRequest,
    timeSlots: TimeSlot[]
  ): Promise<BookingAvailabilityResponse> {
    return this.validator.checkBookingAvailability({
      tenantId: request.tenantId,
      resourceId: request.resourceId,
      startTime: request.startTime,
      endTime: request.endTime,
      capacity: request.capacity
    });
  }

  private async invalidateBookingCaches(
    tenantId: string,
    resourceId: string,
    timeSlots: TimeSlot[]
  ): Promise<void> {
    try {
      const patterns = [
        `booking_*:${tenantId}:*`,
        `availability_*:${tenantId}:${resourceId}:*`,
        `slots_*:${tenantId}:${resourceId}:*`
      ];

      for (const pattern of patterns) {
        await this.cache.deleteByPattern(pattern);
      }

    } catch (error) {
      logger.warn('Failed to invalidate booking caches', {
        tenantId,
        resourceId,
        error
      });
    }
  }

  private scheduleTentativeBookingCleanup(bookingId: string, expiresAt: Date): void {
    const timeoutMs = expiresAt.getTime() - Date.now();
    
    if (timeoutMs > 0) {
      setTimeout(async () => {
        try {
          // This will be handled by the background cleanup process
          logger.debug('Tentative booking expired', { bookingId, expiresAt });
        } catch (error) {
          logger.error('Failed to cleanup expired tentative booking', {
            bookingId,
            error
          });
        }
      }, timeoutMs);
    }
  }

  private startBackgroundProcesses(): void {
    if (this.config.cleanup.enabled) {
      setInterval(async () => {
        try {
          await this.runCleanupProcess();
        } catch (error) {
          logger.error('Cleanup process failed', { error });
        }
      }, this.config.cleanup.intervalMinutes * 60 * 1000);
    }
  }

  private async runCleanupProcess(): Promise<void> {
    try {
      // Get all tenants (simplified - in production, this should be more sophisticated)
      const tenantsResult = await this.fastify.db.query(
        'SELECT DISTINCT tenant_id FROM bookings WHERE status = $1 AND expires_at <= NOW()',
        ['tentative']
      );

      for (const row of tenantsResult.rows) {
        const tenantId = row.tenant_id;
        const cleanedCount = await this.repository.cleanupExpiredBookings(tenantId);
        
        if (cleanedCount > 0) {
          logger.info('Cleaned up expired bookings', {
            tenantId,
            cleanedCount
          });
        }
      }

    } catch (error) {
      logger.error('Cleanup process error', { error });
    }
  }

  private recordPerformanceMetric(
    operation: string,
    startTime: number,
    success: boolean,
    lockAcquisitionTime: number,
    databaseTime: number,
    tenantId: string,
    resourceId?: string
  ): void {
    if (!this.config.performance.enableMetrics) {
      return;
    }

    const duration = Date.now() - startTime;
    const metric: BookingPerformanceMetrics = {
      operation,
      duration,
      success,
      lockAcquisitionTime,
      validationTime: 0, // TODO: Measure validation time
      databaseTime,
      timestamp: new Date(),
      tenantId,
      resourceId
    };

    this.performanceMetrics.push(metric);

    // Keep only recent metrics
    if (this.performanceMetrics.length > this.config.performance.maxMetricsHistory) {
      this.performanceMetrics = this.performanceMetrics.slice(-this.config.performance.maxMetricsHistory);
    }

    // Log slow operations
    if (duration > this.config.performance.slowOperationThresholdMs) {
      logger.warn('Slow booking operation detected', metric);
    }
  }
}

export default BookingService;