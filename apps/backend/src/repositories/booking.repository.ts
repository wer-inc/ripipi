/**
 * Booking Repository
 * Handles booking data persistence with high-performance queries,
 * transaction management, and data integrity features
 */

import { BaseRepository, FilterCondition, QueryOptions } from './base.repository.js';
import { withTransaction, TransactionContext } from '../db/transaction.js';
import { logger } from '../config/logger.js';
import {
  BookingEntity,
  BookingItemEntity,
  BookingCancellationEntity,
  BookingChangeHistoryEntity,
  BookingStatus,
  BookingChangeType,
  CancellationReason,
  BookingRequest,
  BookingResponse,
  BookingSearchCriteria,
  BookingStatistics
} from '../types/booking.js';
import { TimeSlot } from '../types/availability.js';
import { db } from '../db/index.js';
import { InternalServerError, NotFoundError, ConflictError, BadRequestError } from '../utils/errors.js';
import { TenantContext, PaginatedResult } from '../types/database.js';

/**
 * Booking creation options
 */
interface BookingCreationOptions {
  skipValidation?: boolean;
  autoConfirm?: boolean;
  tentativeTimeoutMinutes?: number;
  allowOverbooking?: boolean;
}

/**
 * Booking update options
 */
interface BookingUpdateOptions {
  skipValidation?: boolean;
  notifyCustomer?: boolean;
  recordHistory?: boolean;
  reason?: string;
}

/**
 * Booking search result with additional metadata
 */
interface BookingSearchResult extends PaginatedResult<BookingResponse> {
  statistics: {
    totalValue: number;
    averageDuration: number;
    statusDistribution: Record<BookingStatus, number>;
  };
}

/**
 * Comprehensive booking repository
 */
export class BookingRepository extends BaseRepository<BookingEntity> {
  constructor() {
    super({
      tableName: 'bookings',
      primaryKey: 'id',
      tenantKey: 'tenant_id',
      auditFields: true,
      optimisticLocking: true
    });
  }

  /**
   * Create a new booking with booking items atomically
   */
  async createBooking(
    request: BookingRequest,
    timeSlots: TimeSlot[],
    context: TenantContext,
    options: BookingCreationOptions = {}
  ): Promise<BookingResponse> {
    const startTime = Date.now();

    return withTransaction(async (ctx) => {
      try {
        logger.debug('Creating booking', {
          tenantId: request.tenantId,
          customerId: request.customerId,
          resourceId: request.resourceId,
          slotsCount: timeSlots.length,
          idempotencyKey: request.idempotencyKey
        });

        // 1. Check for existing booking with same idempotency key
        const existingBooking = await this.findByIdempotencyKey(
          request.tenantId,
          request.idempotencyKey,
          ctx
        );

        if (existingBooking) {
          logger.info('Returning existing booking for idempotency key', {
            bookingId: existingBooking.id,
            idempotencyKey: request.idempotencyKey
          });
          return existingBooking;
        }

        // 2. Calculate total amount (simplified - should be from service pricing)
        const totalJpy = this.calculateBookingAmount(request, timeSlots);
        const maxPenaltyJpy = Math.round(totalJpy * 0.1); // 10% penalty

        // 3. Determine initial status
        const status: BookingStatus = options.autoConfirm ? 'confirmed' : 'tentative';
        const expiresAt = status === 'tentative' 
          ? new Date(Date.now() + (options.tentativeTimeoutMinutes || 15) * 60 * 1000)
          : undefined;

        // 4. Create booking record
        const bookingData: Omit<BookingEntity, 'id' | 'created_at' | 'updated_at'> = {
          tenant_id: request.tenantId,
          customer_id: request.customerId,
          service_id: request.serviceId,
          start_at: request.startTime,
          end_at: request.endTime,
          status,
          total_jpy: totalJpy,
          max_penalty_jpy: maxPenaltyJpy,
          idempotency_key: request.idempotencyKey,
          expires_at: expiresAt,
          metadata: request.metadata
        };

        const booking = await this.createBookingRecord(bookingData, ctx, context);

        // 5. Create booking items for each time slot
        const bookingItems = await this.createBookingItems(
          booking.id,
          request.resourceId,
          timeSlots,
          ctx,
          context
        );

        // 6. Reserve capacity for each time slot
        await this.reserveSlotCapacity(
          request.tenantId,
          timeSlots,
          request.capacity || 1,
          ctx
        );

        // 7. Record creation history
        await this.recordBookingHistory(
          booking.id,
          'CREATED',
          undefined,
          status,
          'Booking created',
          context.userId,
          ctx
        );

        // 8. Build response
        const response: BookingResponse = {
          id: booking.id.toString(),
          tenantId: request.tenantId,
          customerId: request.customerId,
          serviceId: request.serviceId,
          resourceId: request.resourceId,
          startTime: request.startTime,
          endTime: request.endTime,
          status,
          totalJpy,
          maxPenaltyJpy,
          idempotencyKey: request.idempotencyKey,
          bookedSlots: timeSlots,
          createdAt: booking.created_at,
          updatedAt: booking.updated_at,
          expiresAt,
          metadata: request.metadata
        };

        logger.info('Booking created successfully', {
          bookingId: booking.id,
          tenantId: request.tenantId,
          duration: Date.now() - startTime,
          status,
          totalJpy
        });

        return response;

      } catch (error) {
        logger.error('Failed to create booking', {
          tenantId: request.tenantId,
          idempotencyKey: request.idempotencyKey,
          error
        });

        if (error.code === '23505') { // Unique constraint violation
          if (error.constraint?.includes('idempotency_key')) {
            // Try to find existing booking again
            const existingBooking = await this.findByIdempotencyKey(
              request.tenantId,
              request.idempotencyKey,
              ctx
            );
            if (existingBooking) {
              return existingBooking;
            }
          }
          throw new ConflictError('Booking already exists or conflicts with existing data');
        }

        throw new InternalServerError(`Failed to create booking: ${error.message}`);
      }
    });
  }

  /**
   * Update booking fields (notes, metadata, etc.)
   */
  async updateBookingFields(
    bookingId: string,
    tenantId: string,
    updates: Partial<BookingEntity>,
    context: TenantContext,
    options: BookingUpdateOptions = {}
  ): Promise<BookingResponse | null> {
    return withTransaction(async (ctx) => {
      try {
        // Get current booking
        const current = await this.findByIdInTransaction(bookingId, tenantId, ctx);
        if (!current) {
          throw new NotFoundError(bookingId, 'bookings');
        }

        // Update booking
        const updateData: Partial<BookingEntity> = {
          ...updates,
          updated_at: new Date()
        };

        // Remove fields that shouldn't be updated
        delete (updateData as any).id;
        delete (updateData as any).tenant_id;
        delete (updateData as any).created_at;
        delete (updateData as any).status; // Use updateBookingStatus for status changes

        const updated = await this.updateInTransaction(
          bookingId,
          updateData,
          tenantId,
          ctx,
          context
        );

        if (!updated) {
          throw new InternalServerError('Failed to update booking');
        }

        // Record history if enabled
        if (options.recordHistory !== false) {
          await this.recordBookingHistory(
            bookingId,
            'MODIFIED',
            current.status,
            current.status,
            options.reason || 'Booking updated',
            context.userId,
            ctx
          );
        }

        const response = await this.buildBookingResponse(updated, ctx);

        logger.info('Booking fields updated', {
          bookingId,
          tenantId,
          updatedFields: Object.keys(updates),
          userId: context.userId
        });

        return response;

      } catch (error) {
        logger.error('Failed to update booking fields', {
          bookingId,
          tenantId,
          updates,
          error
        });
        throw error;
      }
    });
  }

  /**
   * Update booking status and record history
   */
  async updateBookingStatus(
    bookingId: string,
    tenantId: string,
    newStatus: BookingStatus,
    context: TenantContext,
    options: BookingUpdateOptions = {}
  ): Promise<BookingResponse | null> {
    return withTransaction(async (ctx) => {
      try {
        // Get current booking
        const current = await this.findByIdInTransaction(bookingId, tenantId, ctx);
        if (!current) {
          throw new NotFoundError(bookingId, 'bookings');
        }

        const oldStatus = current.status;

        // Validate status transition
        if (!this.isValidStatusTransition(oldStatus, newStatus)) {
          throw new BadRequestError(`Invalid status transition from ${oldStatus} to ${newStatus}`);
        }

        // Update booking
        const updateData: Partial<BookingEntity> = {
          status: newStatus,
          updated_at: new Date()
        };

        // Clear expiration for confirmed bookings
        if (newStatus === 'confirmed') {
          updateData.expires_at = null;
        }

        const updated = await this.updateInTransaction(
          bookingId,
          updateData,
          tenantId,
          ctx,
          context
        );

        if (!updated) {
          throw new InternalServerError('Failed to update booking status');
        }

        // Record history if enabled
        if (options.recordHistory !== false) {
          await this.recordBookingHistory(
            bookingId,
            this.getChangeTypeFromStatus(newStatus),
            oldStatus,
            newStatus,
            options.reason || `Status changed to ${newStatus}`,
            context.userId,
            ctx
          );
        }

        // Handle capacity release for cancelled bookings
        if (newStatus === 'cancelled') {
          await this.releaseBookingCapacity(bookingId, tenantId, ctx);
        }

        const response = await this.buildBookingResponse(updated, ctx);

        logger.info('Booking status updated', {
          bookingId,
          tenantId,
          oldStatus,
          newStatus,
          userId: context.userId
        });

        return response;

      } catch (error) {
        logger.error('Failed to update booking status', {
          bookingId,
          tenantId,
          newStatus,
          error
        });
        throw error;
      }
    });
  }

  /**
   * Cancel booking with reason and capacity restoration
   */
  async cancelBooking(
    bookingId: string,
    tenantId: string,
    reason: CancellationReason,
    note: string,
    cancelledBy: string,
    context: TenantContext
  ): Promise<BookingResponse | null> {
    return withTransaction(async (ctx) => {
      try {
        // Update booking status
        const booking = await this.updateBookingStatus(
          bookingId,
          tenantId,
          'cancelled',
          context,
          {
            reason: `Cancelled: ${reason}`,
            recordHistory: true
          }
        );

        if (!booking) {
          return null;
        }

        // Create cancellation record
        await this.createCancellationRecord(
          bookingId,
          reason,
          note,
          cancelledBy,
          ctx
        );

        logger.info('Booking cancelled', {
          bookingId,
          tenantId,
          reason,
          cancelledBy
        });

        return booking;

      } catch (error) {
        logger.error('Failed to cancel booking', {
          bookingId,
          tenantId,
          reason,
          error
        });
        throw error;
      }
    });
  }

  /**
   * Reschedule booking to new time slots
   */
  async rescheduleBooking(
    bookingId: string,
    tenantId: string,
    newStartTime: Date,
    newEndTime: Date,
    newTimeSlots: TimeSlot[],
    reason: string,
    context: TenantContext
  ): Promise<BookingResponse | null> {
    return withTransaction(async (ctx) => {
      try {
        // Get current booking
        const current = await this.findByIdInTransaction(bookingId, tenantId, ctx);
        if (!current) {
          throw new NotFoundError(bookingId, 'bookings');
        }

        if (current.status === 'cancelled' || current.status === 'completed') {
          throw new BadRequestError(`Cannot reschedule ${current.status} booking`);
        }

        const oldStartTime = current.start_at;
        const oldEndTime = current.end_at;

        // Release old capacity
        await this.releaseBookingCapacity(bookingId, tenantId, ctx);

        // Reserve new capacity
        await this.reserveSlotCapacity(
          tenantId,
          newTimeSlots,
          1, // TODO: Get actual capacity from booking
          ctx
        );

        // Update booking times
        const updateData: Partial<BookingEntity> = {
          start_at: newStartTime,
          end_at: newEndTime,
          updated_at: new Date()
        };

        const updated = await this.updateInTransaction(
          bookingId,
          updateData,
          tenantId,
          ctx,
          context
        );

        if (!updated) {
          throw new InternalServerError('Failed to reschedule booking');
        }

        // Update booking items
        await this.updateBookingItems(
          bookingId,
          current.resource_id,
          newTimeSlots,
          ctx
        );

        // Record history
        await this.recordBookingHistory(
          bookingId,
          'RESCHEDULED',
          current.status,
          current.status,
          reason,
          context.userId,
          ctx,
          {
            oldStartTime,
            newStartTime,
            oldEndTime,
            newEndTime
          }
        );

        const response = await this.buildBookingResponse(updated, ctx);

        logger.info('Booking rescheduled', {
          bookingId,
          tenantId,
          oldStartTime,
          newStartTime,
          reason
        });

        return response;

      } catch (error) {
        logger.error('Failed to reschedule booking', {
          bookingId,
          tenantId,
          error
        });
        throw error;
      }
    });
  }

  /**
   * Find booking by ID with full details
   */
  async findByIdWithDetails(
    bookingId: string,
    tenantId: string,
    ctx?: TransactionContext
  ): Promise<BookingResponse | null> {
    try {
      const query = `
        SELECT b.*, 
               c.name as customer_name,
               c.email as customer_email,
               c.phone as customer_phone,
               s.name as service_name,
               array_agg(
                 json_build_object(
                   'id', ts.id,
                   'resourceId', ts.resource_id,
                   'resourceName', r.name,
                   'startTime', ts.start_at,
                   'endTime', ts.end_at,
                   'duration', EXTRACT(EPOCH FROM (ts.end_at - ts.start_at)) / 60,
                   'capacity', r.capacity,
                   'availableCapacity', ts.available_capacity
                 )
               ) as time_slots
        FROM bookings b
        LEFT JOIN customers c ON b.customer_id = c.id AND c.tenant_id = b.tenant_id
        LEFT JOIN services s ON b.service_id = s.id AND s.tenant_id = b.tenant_id
        LEFT JOIN booking_items bi ON b.id = bi.booking_id
        LEFT JOIN timeslots ts ON bi.timeslot_id = ts.id
        LEFT JOIN resources r ON ts.resource_id = r.id AND r.tenant_id = b.tenant_id
        WHERE b.id = $1 AND b.tenant_id = $2
        GROUP BY b.id, c.name, c.email, c.phone, s.name
      `;

      const result = ctx 
        ? await ctx.queryForTenant(tenantId, query, [bookingId, tenantId])
        : await db.queryForTenant(tenantId, query, [bookingId, tenantId]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      const response = this.mapToBookingResponse(row);
      
      // Add customer and service info
      if (row.customer_name) {
        response.customerInfo = {
          name: row.customer_name,
          email: row.customer_email,
          phone: row.customer_phone
        };
      }
      
      if (row.service_name) {
        response.serviceInfo = {
          name: row.service_name
        };
      }

      return response;

    } catch (error) {
      logger.error('Failed to find booking by ID', {
        bookingId,
        tenantId,
        error
      });
      return null;
    }
  }

  /**
   * Find booking by idempotency key
   */
  async findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
    ctx?: TransactionContext
  ): Promise<BookingResponse | null> {
    try {
      const query = `
        SELECT b.*, 
               array_agg(
                 json_build_object(
                   'id', ts.id,
                   'resourceId', ts.resource_id,
                   'startTime', ts.start_at,
                   'endTime', ts.end_at,
                   'duration', EXTRACT(EPOCH FROM (ts.end_at - ts.start_at)) / 60,
                   'capacity', r.capacity,
                   'availableCapacity', ts.available_capacity
                 )
               ) as time_slots
        FROM bookings b
        LEFT JOIN booking_items bi ON b.id = bi.booking_id
        LEFT JOIN timeslots ts ON bi.timeslot_id = ts.id
        LEFT JOIN resources r ON ts.resource_id = r.id
        WHERE b.tenant_id = $1 AND b.idempotency_key = $2
        GROUP BY b.id
      `;

      const result = ctx 
        ? await ctx.queryForTenant(tenantId, query, [tenantId, idempotencyKey])
        : await db.queryForTenant(tenantId, query, [tenantId, idempotencyKey]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapToBookingResponse(result.rows[0]);

    } catch (error) {
      logger.error('Failed to find booking by idempotency key', {
        tenantId,
        idempotencyKey,
        error
      });
      return null;
    }
  }

  /**
   * Search bookings with advanced criteria
   */
  async searchBookings(
    criteria: BookingSearchCriteria
  ): Promise<BookingSearchResult> {
    try {
      const startTime = Date.now();
      
      // Build where clause
      const { whereClause, params } = this.buildSearchWhereClause(criteria);
      
      // Build order clause
      const orderClause = this.buildSearchOrderClause(criteria);
      
      // Build limit clause
      const limit = Math.min(criteria.limit || 50, 1000);
      const offset = criteria.offset || 0;

      // Main query
      const dataQuery = `
        SELECT DISTINCT b.*,
               c.name as customer_name,
               s.name as service_name,
               (
                 SELECT string_agg(r.name, ', ' ORDER BY r.name)
                 FROM booking_items bi
                 JOIN timeslots ts ON bi.timeslot_id = ts.id
                 JOIN resources r ON ts.resource_id = r.id
                 WHERE bi.booking_id = b.id
               ) as resource_names
        FROM bookings b
        LEFT JOIN customers c ON b.customer_id = c.id AND c.tenant_id = b.tenant_id
        LEFT JOIN services s ON b.service_id = s.id AND s.tenant_id = b.tenant_id
        ${criteria.resourceId ? 'JOIN booking_items bi_filter ON b.id = bi_filter.booking_id JOIN timeslots ts_filter ON bi_filter.timeslot_id = ts_filter.id' : ''}
        WHERE ${whereClause}
        ${orderClause}
        LIMIT ${limit} OFFSET ${offset}
      `;

      // Count query
      const countQuery = `
        SELECT COUNT(DISTINCT b.id) as total,
               SUM(b.total_jpy) as total_value,
               AVG(EXTRACT(EPOCH FROM (b.end_at - b.start_at)) / 60) as avg_duration
        FROM bookings b
        ${criteria.resourceId ? 'JOIN booking_items bi_filter ON b.id = bi_filter.booking_id JOIN timeslots ts_filter ON bi_filter.timeslot_id = ts_filter.id' : ''}
        WHERE ${whereClause}
      `;

      // Status distribution query
      const statusQuery = `
        SELECT b.status, COUNT(DISTINCT b.id) as count
        FROM bookings b
        ${criteria.resourceId ? 'JOIN booking_items bi_filter ON b.id = bi_filter.booking_id JOIN timeslots ts_filter ON bi_filter.timeslot_id = ts_filter.id' : ''}
        WHERE ${whereClause}
        GROUP BY b.status
      `;

      // Execute queries in parallel
      const [dataResult, countResult, statusResult] = await Promise.all([
        db.queryForTenant(criteria.tenantId, dataQuery, params),
        db.queryForTenant(criteria.tenantId, countQuery, params),
        db.queryForTenant(criteria.tenantId, statusQuery, params)
      ]);

      // Build status distribution
      const statusDistribution: Record<BookingStatus, number> = {
        tentative: 0,
        confirmed: 0,
        cancelled: 0,
        noshow: 0,
        completed: 0
      };

      statusResult.rows.forEach(row => {
        statusDistribution[row.status as BookingStatus] = parseInt(row.count);
      });

      // Map results
      const bookings = dataResult.rows.map(row => this.mapToBookingResponse(row));
      
      const stats = countResult.rows[0];
      const total = parseInt(stats.total);

      const result: BookingSearchResult = {
        data: bookings,
        total,
        limit,
        offset,
        hasMore: offset + bookings.length < total,
        statistics: {
          totalValue: parseFloat(stats.total_value) || 0,
          averageDuration: parseFloat(stats.avg_duration) || 0,
          statusDistribution
        }
      };

      logger.debug('Booking search completed', {
        tenantId: criteria.tenantId,
        duration: Date.now() - startTime,
        resultCount: bookings.length,
        total
      });

      return result;

    } catch (error) {
      logger.error('Failed to search bookings', { criteria, error });
      throw new InternalServerError('Failed to search bookings');
    }
  }

  /**
   * Get booking statistics for a period
   */
  async getBookingStatistics(
    tenantId: string,
    startDate: Date,
    endDate: Date,
    resourceId?: string
  ): Promise<BookingStatistics> {
    try {
      let resourceFilter = '';
      const params: any[] = [tenantId, startDate, endDate];

      if (resourceId) {
        resourceFilter = 'AND b.resource_id = $4';
        params.push(resourceId);
      }

      // Main statistics query
      const statsQuery = `
        SELECT 
          COUNT(*) as total_bookings,
          SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed_bookings,
          SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_bookings,
          SUM(CASE WHEN status = 'noshow' THEN 1 ELSE 0 END) as noshow_bookings,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_bookings,
          AVG(EXTRACT(EPOCH FROM (end_at - start_at)) / 60) as avg_duration,
          SUM(total_jpy) as total_revenue
        FROM bookings b
        WHERE tenant_id = $1 
          AND start_at >= $2 
          AND start_at <= $3
          ${resourceFilter}
      `;

      // Peak hours query
      const peakHoursQuery = `
        SELECT 
          EXTRACT(HOUR FROM start_at) as hour,
          COUNT(*) as booking_count
        FROM bookings b
        WHERE tenant_id = $1 
          AND start_at >= $2 
          AND start_at <= $3
          AND status IN ('confirmed', 'completed')
          ${resourceFilter}
        GROUP BY EXTRACT(HOUR FROM start_at)
        ORDER BY booking_count DESC
        LIMIT 5
      `;

      // Top resources query (only if not filtering by specific resource)
      let topResourcesQuery = '';
      if (!resourceId) {
        topResourcesQuery = `
          SELECT 
            b.resource_id,
            r.name as resource_name,
            COUNT(*) as booking_count,
            AVG(CASE WHEN status IN ('confirmed', 'completed') THEN 1.0 ELSE 0.0 END) * 100 as utilization_rate
          FROM bookings b
          LEFT JOIN resources r ON b.resource_id = r.id AND r.tenant_id = b.tenant_id
          WHERE b.tenant_id = $1 
            AND b.start_at >= $2 
            AND b.start_at <= $3
          GROUP BY b.resource_id, r.name
          ORDER BY booking_count DESC
          LIMIT 10
        `;
      }

      // Execute queries
      const [statsResult, peakHoursResult, topResourcesResult] = await Promise.all([
        db.queryForTenant(tenantId, statsQuery, params),
        db.queryForTenant(tenantId, peakHoursQuery, params),
        topResourcesQuery ? db.queryForTenant(tenantId, topResourcesQuery, params) : Promise.resolve({ rows: [] })
      ]);

      const stats = statsResult.rows[0];
      const totalBookings = parseInt(stats.total_bookings);
      const confirmedBookings = parseInt(stats.confirmed_bookings);
      
      const utilizationRate = totalBookings > 0 
        ? (confirmedBookings / totalBookings) * 100 
        : 0;

      return {
        tenantId,
        period: { startDate, endDate },
        totalBookings,
        confirmedBookings,
        cancelledBookings: parseInt(stats.cancelled_bookings),
        noShowBookings: parseInt(stats.noshow_bookings),
        completedBookings: parseInt(stats.completed_bookings),
        utilizationRate,
        averageBookingDuration: parseFloat(stats.avg_duration) || 0,
        peakHours: peakHoursResult.rows.map(row => ({
          hour: parseInt(row.hour),
          bookingCount: parseInt(row.booking_count)
        })),
        topResources: topResourcesResult.rows.map(row => ({
          resourceId: row.resource_id.toString(),
          bookingCount: parseInt(row.booking_count),
          utilizationRate: parseFloat(row.utilization_rate)
        }))
      };

    } catch (error) {
      logger.error('Failed to get booking statistics', {
        tenantId,
        startDate,
        endDate,
        resourceId,
        error
      });
      throw new InternalServerError('Failed to get booking statistics');
    }
  }

  /**
   * Clean up expired tentative bookings
   */
  async cleanupExpiredBookings(tenantId: string): Promise<number> {
    return withTransaction(async (ctx) => {
      try {
        const now = new Date();

        // Find expired tentative bookings
        const expiredResult = await ctx.queryForTenant(
          tenantId,
          `
          SELECT id, resource_id
          FROM bookings
          WHERE tenant_id = $1 
            AND status = 'tentative'
            AND expires_at <= $2
          `,
          [tenantId, now]
        );

        const expiredBookings = expiredResult.rows;

        if (expiredBookings.length === 0) {
          return 0;
        }

        // Release capacity for expired bookings
        for (const booking of expiredBookings) {
          await this.releaseBookingCapacity(booking.id, tenantId, ctx);
        }

        // Update status to cancelled
        const updateResult = await ctx.queryForTenant(
          tenantId,
          `
          UPDATE bookings
          SET status = 'cancelled',
              updated_at = NOW()
          WHERE tenant_id = $1 
            AND status = 'tentative'
            AND expires_at <= $2
          `,
          [tenantId, now]
        );

        const cleanedCount = updateResult.rowCount || 0;

        logger.info('Cleaned up expired bookings', {
          tenantId,
          cleanedCount
        });

        return cleanedCount;

      } catch (error) {
        logger.error('Failed to cleanup expired bookings', { tenantId, error });
        throw new InternalServerError('Failed to cleanup expired bookings');
      }
    });
  }

  // Private helper methods

  private async createBookingRecord(
    data: Omit<BookingEntity, 'id' | 'created_at' | 'updated_at'>,
    ctx: TransactionContext,
    context: TenantContext
  ): Promise<BookingEntity> {
    const insertData = {
      ...data,
      created_at: new Date(),
      updated_at: new Date(),
      ...(context.userId && { created_by: context.userId, updated_by: context.userId })
    };

    const result = await ctx.queryForTenant(
      data.tenant_id,
      `
      INSERT INTO bookings (${Object.keys(insertData).join(', ')})
      VALUES (${Object.keys(insertData).map((_, i) => `$${i + 1}`).join(', ')})
      RETURNING *
      `,
      Object.values(insertData)
    );

    return result.rows[0];
  }

  private async createBookingItems(
    bookingId: string,
    resourceId: string,
    timeSlots: TimeSlot[],
    ctx: TransactionContext,
    context: TenantContext
  ): Promise<BookingItemEntity[]> {
    if (timeSlots.length === 0) {
      return [];
    }

    const items: BookingItemEntity[] = [];

    for (const slot of timeSlots) {
      const result = await ctx.query(
        `
        INSERT INTO booking_items (booking_id, timeslot_id, resource_id)
        VALUES ($1, $2, $3)
        RETURNING *
        `,
        [bookingId, slot.id, resourceId]
      );

      items.push(result.rows[0]);
    }

    return items;
  }

  private async updateBookingItems(
    bookingId: string,
    resourceId: string,
    newTimeSlots: TimeSlot[],
    ctx: TransactionContext
  ): Promise<void> {
    // Delete existing items
    await ctx.query(
      'DELETE FROM booking_items WHERE booking_id = $1',
      [bookingId]
    );

    // Create new items
    for (const slot of newTimeSlots) {
      await ctx.query(
        `
        INSERT INTO booking_items (booking_id, timeslot_id, resource_id)
        VALUES ($1, $2, $3)
        `,
        [bookingId, slot.id, resourceId]
      );
    }
  }

  private async reserveSlotCapacity(
    tenantId: string,
    timeSlots: TimeSlot[],
    capacity: number,
    ctx: TransactionContext
  ): Promise<void> {
    for (const slot of timeSlots) {
      const result = await ctx.queryForTenant(
        tenantId,
        `
        UPDATE timeslots
        SET available_capacity = available_capacity - $1,
            updated_at = NOW()
        WHERE id = $2 AND available_capacity >= $1
        RETURNING available_capacity
        `,
        [capacity, slot.id]
      );

      if (result.rows.length === 0) {
        throw new ConflictError(`Insufficient capacity for time slot ${slot.id}`);
      }
    }
  }

  private async releaseBookingCapacity(
    bookingId: string,
    tenantId: string,
    ctx: TransactionContext
  ): Promise<void> {
    await ctx.queryForTenant(
      tenantId,
      `
      UPDATE timeslots
      SET available_capacity = available_capacity + 1,
          updated_at = NOW()
      WHERE id IN (
        SELECT bi.timeslot_id
        FROM booking_items bi
        WHERE bi.booking_id = $1
      )
      `,
      [bookingId]
    );
  }

  private async createCancellationRecord(
    bookingId: string,
    reason: CancellationReason,
    note: string,
    cancelledBy: string,
    ctx: TransactionContext
  ): Promise<void> {
    await ctx.query(
      `
      INSERT INTO booking_cancellations (booking_id, reason_code, note, cancelled_by)
      VALUES ($1, $2, $3, $4)
      `,
      [bookingId, reason, note, cancelledBy]
    );
  }

  private async recordBookingHistory(
    bookingId: string,
    changeType: BookingChangeType,
    oldStatus?: BookingStatus,
    newStatus?: BookingStatus,
    reason?: string,
    changedBy?: string,
    ctx?: TransactionContext,
    timeChanges?: {
      oldStartTime?: Date;
      newStartTime?: Date;
      oldEndTime?: Date;
      newEndTime?: Date;
    }
  ): Promise<void> {
    const historyData = {
      booking_id: bookingId,
      change_type: changeType,
      old_status: oldStatus,
      new_status: newStatus,
      old_start_at: timeChanges?.oldStartTime,
      new_start_at: timeChanges?.newStartTime,
      old_end_at: timeChanges?.oldEndTime,
      new_end_at: timeChanges?.newEndTime,
      reason: reason || '',
      changed_by: changedBy || 'system',
      changed_at: new Date()
    };

    const query = `
      INSERT INTO booking_change_history (${Object.keys(historyData).join(', ')})
      VALUES (${Object.keys(historyData).map((_, i) => `$${i + 1}`).join(', ')})
    `;

    if (ctx) {
      await ctx.query(query, Object.values(historyData));
    } else {
      await db.query(query, Object.values(historyData));
    }
  }

  private async findByIdInTransaction(
    id: string,
    tenantId: string,
    ctx: TransactionContext
  ): Promise<BookingEntity | null> {
    const result = await ctx.queryForTenant(
      tenantId,
      'SELECT * FROM bookings WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );

    return result.rows[0] || null;
  }

  private async updateInTransaction(
    id: string,
    data: Partial<BookingEntity>,
    tenantId: string,
    ctx: TransactionContext,
    context: TenantContext
  ): Promise<BookingEntity | null> {
    const updateData = {
      ...data,
      updated_at: new Date(),
      ...(context.userId && { updated_by: context.userId })
    };

    // Remove fields that shouldn't be updated
    delete (updateData as any).id;
    delete (updateData as any).created_at;
    delete (updateData as any).tenant_id;

    const setClauses = Object.keys(updateData).map((key, index) => 
      `${key} = $${index + 1}`
    );

    const values = [...Object.values(updateData), id, tenantId];

    const result = await ctx.queryForTenant(
      tenantId,
      `
      UPDATE bookings
      SET ${setClauses.join(', ')}
      WHERE id = $${values.length - 1} AND tenant_id = $${values.length}
      RETURNING *
      `,
      values
    );

    return result.rows[0] || null;
  }

  private async buildBookingResponse(
    booking: BookingEntity,
    ctx?: TransactionContext
  ): Promise<BookingResponse> {
    // Get booking items and time slots
    const query = `
      SELECT ts.*, r.name as resource_name
      FROM booking_items bi
      JOIN timeslots ts ON bi.timeslot_id = ts.id
      JOIN resources r ON ts.resource_id = r.id
      WHERE bi.booking_id = $1
      ORDER BY ts.start_at
    `;

    const result = ctx 
      ? await ctx.query(query, [booking.id])
      : await db.query(query, [booking.id]);

    const timeSlots: TimeSlot[] = result.rows.map(row => ({
      id: row.id.toString(),
      tenantId: booking.tenant_id,
      resourceId: row.resource_id.toString(),
      startTime: row.start_at,
      endTime: row.end_at,
      duration: Math.round((row.end_at - row.start_at) / (1000 * 60)),
      isAvailable: row.available_capacity > 0,
      capacity: row.capacity || 1,
      bookedCount: 0, // Will be calculated if needed
      availableCapacity: row.available_capacity
    }));

    const resourceId = timeSlots.length > 0 ? timeSlots[0].resourceId : '';

    return {
      id: booking.id.toString(),
      tenantId: booking.tenant_id,
      customerId: booking.customer_id,
      serviceId: booking.service_id,
      resourceId,
      startTime: booking.start_at,
      endTime: booking.end_at,
      status: booking.status,
      totalJpy: booking.total_jpy,
      maxPenaltyJpy: booking.max_penalty_jpy,
      idempotencyKey: booking.idempotency_key,
      bookedSlots: timeSlots,
      createdAt: booking.created_at,
      updatedAt: booking.updated_at,
      expiresAt: booking.expires_at,
      metadata: booking.metadata
    };
  }

  private calculateBookingAmount(request: BookingRequest, timeSlots: TimeSlot[]): number {
    // Simplified calculation - in production, this should use service pricing
    const basePricePerHour = 5000; // 5000 JPY per hour
    const totalMinutes = (request.endTime.getTime() - request.startTime.getTime()) / (1000 * 60);
    const totalHours = totalMinutes / 60;
    return Math.round(basePricePerHour * totalHours);
  }

  private isValidStatusTransition(oldStatus: BookingStatus, newStatus: BookingStatus): boolean {
    const validTransitions: Record<BookingStatus, BookingStatus[]> = {
      tentative: ['confirmed', 'cancelled'],
      confirmed: ['cancelled', 'noshow', 'completed'],
      cancelled: [], // Cannot transition from cancelled
      noshow: ['completed'], // Can mark as completed later
      completed: [] // Cannot transition from completed
    };

    return validTransitions[oldStatus]?.includes(newStatus) || false;
  }

  private getChangeTypeFromStatus(status: BookingStatus): BookingChangeType {
    const mapping: Record<BookingStatus, BookingChangeType> = {
      tentative: 'CREATED',
      confirmed: 'CONFIRMED',
      cancelled: 'CANCELLED',
      noshow: 'MARKED_NOSHOW',
      completed: 'COMPLETED'
    };

    return mapping[status] || 'MODIFIED';
  }

  private buildSearchWhereClause(criteria: BookingSearchCriteria): {
    whereClause: string;
    params: any[];
  } {
    const conditions: string[] = ['b.tenant_id = $1'];
    const params: any[] = [criteria.tenantId];

    if (criteria.customerId) {
      conditions.push(`b.customer_id = $${params.length + 1}`);
      params.push(criteria.customerId);
    }

    if (criteria.serviceId) {
      conditions.push(`b.service_id = $${params.length + 1}`);
      params.push(criteria.serviceId);
    }

    if (criteria.resourceId) {
      conditions.push(`ts_filter.resource_id = $${params.length + 1}`);
      params.push(criteria.resourceId);
    }

    if (criteria.status && criteria.status.length > 0) {
      const statusPlaceholders = criteria.status.map((_, index) => 
        `$${params.length + index + 1}`
      ).join(',');
      conditions.push(`b.status IN (${statusPlaceholders})`);
      params.push(...criteria.status);
    }

    if (criteria.startDate) {
      conditions.push(`b.start_at >= $${params.length + 1}`);
      params.push(criteria.startDate);
    }

    if (criteria.endDate) {
      conditions.push(`b.start_at <= $${params.length + 1}`);
      params.push(criteria.endDate);
    }

    // Always exclude soft-deleted records
    conditions.push('b.deleted_at IS NULL');

    return {
      whereClause: conditions.join(' AND '),
      params
    };
  }

  private buildSearchOrderClause(criteria: BookingSearchCriteria): string {
    const sortBy = criteria.sortBy || 'start_time';
    const sortOrder = criteria.sortOrder || 'ASC';

    const sortMapping: Record<string, string> = {
      start_time: 'b.start_at',
      created_at: 'b.created_at',
      status: 'b.status'
    };

    const sortColumn = sortMapping[sortBy] || 'b.start_at';
    return `ORDER BY ${sortColumn} ${sortOrder}`;
  }

  private mapToBookingResponse(row: any): BookingResponse {
    return {
      id: row.id.toString(),
      tenantId: row.tenant_id,
      customerId: row.customer_id,
      serviceId: row.service_id,
      resourceId: row.resource_id,
      startTime: row.start_at,
      endTime: row.end_at,
      status: row.status,
      totalJpy: row.total_jpy,
      maxPenaltyJpy: row.max_penalty_jpy,
      idempotencyKey: row.idempotency_key,
      bookedSlots: row.time_slots || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      metadata: row.metadata
    };
  }
}

export default BookingRepository;