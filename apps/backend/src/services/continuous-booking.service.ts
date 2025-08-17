/**
 * Continuous Timeslot Booking Service
 * Implements atomic, continuous k-slot reservation with double-booking prevention
 * as specified in the improvement requirements
 */

import { FastifyInstance } from 'fastify';
import { withTransaction, TransactionContext } from '../db/transaction.js';
import { logger } from '../config/logger.js';
import { 
  ConflictError, 
  BadRequestError,
  InternalServerError 
} from '../utils/errors.js';
import { EventPublisherService } from './event-publisher.service.js';

/**
 * Booking request for continuous slots
 */
export interface ContinuousBookingRequest {
  tenantId: number;
  serviceId: number;
  resourceId: number;
  startTime: Date;
  durationMinutes: number;
  customerId: number;
  capacity?: number;
  metadata?: Record<string, any>;
}

/**
 * Timeslot data
 */
export interface Timeslot {
  id: number;
  tenant_id: number;
  resource_id: number;
  start_at: Date;
  end_at: Date;
  available_capacity: number;
}

/**
 * Service configuration from database
 */
export interface ServiceConfig {
  id: number;
  duration_min: number;
  buffer_before_min: number;
  buffer_after_min: number;
}

/**
 * Tenant settings
 */
export interface TenantSettings {
  granularity_min: number;
  currency_code: string;
}

/**
 * Continuous booking result
 */
export interface ContinuousBookingResult {
  bookingId: number;
  reservedSlots: number[];
  totalDuration: number;
  startTime: Date;
  endTime: Date;
}

/**
 * Service for handling continuous timeslot bookings
 */
export class ContinuousBookingService {
  private eventPublisher: EventPublisherService;
  
  constructor(private fastify: FastifyInstance) {
    this.eventPublisher = new EventPublisherService(fastify);
  }

  /**
   * Book continuous k timeslots with atomic capacity reduction
   * Implements the algorithm from 追加要件.md
   */
  async bookContinuousSlots(
    request: ContinuousBookingRequest
  ): Promise<ContinuousBookingResult> {
    const startTime = Date.now();
    
    logger.info('Starting continuous slot booking', {
      tenantId: request.tenantId,
      serviceId: request.serviceId,
      resourceId: request.resourceId,
      startTime: request.startTime,
      durationMinutes: request.durationMinutes
    });

    return await withTransaction(async (ctx: TransactionContext) => {
      // 1. Get tenant settings for granularity
      const tenantSettings = await this.getTenantSettings(ctx, request.tenantId);
      
      // 2. Get service configuration for buffers
      const serviceConfig = await this.getServiceConfig(ctx, request.serviceId);
      
      // 3. Validate duration is multiple of granularity
      this.validateDurationGranularity(
        request.durationMinutes,
        serviceConfig,
        tenantSettings.granularity_min
      );
      
      // 4. Calculate required continuous slots (k)
      const k = this.calculateRequiredSlots(
        request.durationMinutes,
        serviceConfig,
        tenantSettings.granularity_min
      );
      
      logger.debug('Calculated slot requirements', {
        requestedDuration: request.durationMinutes,
        bufferBefore: serviceConfig.buffer_before_min,
        bufferAfter: serviceConfig.buffer_after_min,
        granularity: tenantSettings.granularity_min,
        requiredSlots: k
      });

      // 5. Lock k continuous timeslots in ascending order (FOR UPDATE)
      const slots = await this.lockContinuousSlots(
        ctx,
        request.tenantId,
        request.resourceId,
        request.startTime,
        k,
        tenantSettings.granularity_min
      );

      // 6. Validate we got exactly k slots
      if (slots.length !== k) {
        throw new ConflictError('Not enough continuous slots available', {
          code: 'insufficient_continuous_slots',
          required: k,
          available: slots.length
        });
      }

      // 7. Atomically decrement capacity for all k slots
      const updatedCount = await this.decrementSlotCapacity(
        ctx,
        slots.map(s => s.id),
        request.capacity || 1
      );

      // 8. Verify all slots were successfully updated
      if (updatedCount !== k) {
        throw new ConflictError('One or more timeslots are no longer available', {
          code: 'timeslot_sold_out',
          required: k,
          updated: updatedCount
        });
      }

      // 9. Create the booking record
      const booking = await this.createBookingRecord(
        ctx,
        request,
        slots,
        serviceConfig
      );

      // 10. Create booking_items for each slot
      await this.createBookingItems(ctx, booking.id, slots);

      // 11. Publish booking created event
      const confirmationCode = this.generateConfirmationCode(booking.id);
      const traceId = request.metadata?.traceId || `booking-${booking.id}-${Date.now()}`;
      
      // Get customer details for event
      const customerQuery = `
        SELECT name, phone, email, line_user_id 
        FROM customers 
        WHERE id = $1
      `;
      const customerResult = await ctx.query(customerQuery, [request.customerId]);
      const customer = customerResult.rows[0] || {};
      
      // Get service details
      const serviceQuery = `
        SELECT name, price 
        FROM services 
        WHERE id = $1
      `;
      const serviceResult = await ctx.query(serviceQuery, [request.serviceId]);
      const service = serviceResult.rows[0] || {};
      
      await this.eventPublisher.publishBookingCreated(
        ctx,
        request.tenantId,
        {
          bookingId: booking.id,
          customerId: request.customerId,
          serviceId: request.serviceId,
          startTime: slots[0].start_at,
          customerEmail: customer.email,
          customerPhone: customer.phone,
          lineUserId: customer.line_user_id,
          serviceName: service.name || 'Service',
          confirmationCode,
          amount: service.price || 0,
          metadata: request.metadata
        },
        traceId
      );

      // 12. Log success metrics
      const processingTime = Date.now() - startTime;
      logger.info('Continuous slot booking completed', {
        bookingId: booking.id,
        slotsReserved: k,
        processingTimeMs: processingTime,
        traceId
      });

      return {
        bookingId: booking.id,
        reservedSlots: slots.map(s => s.id),
        totalDuration: request.durationMinutes + 
                      serviceConfig.buffer_before_min + 
                      serviceConfig.buffer_after_min,
        startTime: slots[0].start_at,
        endTime: slots[slots.length - 1].end_at
      };
    });
  }

  /**
   * Get tenant settings including granularity
   */
  private async getTenantSettings(
    ctx: TransactionContext,
    tenantId: number
  ): Promise<TenantSettings> {
    const query = `
      SELECT 
        COALESCE(ts.granularity_min, 15) as granularity_min,
        COALESCE(ts.currency_code, 'JPY') as currency_code
      FROM tenants t
      LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
      WHERE t.id = $1
    `;
    
    const result = await ctx.query(query, [tenantId]);
    
    if (result.rows.length === 0) {
      throw new NotFoundError('Tenant not found');
    }
    
    return result.rows[0];
  }

  /**
   * Get service configuration
   */
  private async getServiceConfig(
    ctx: TransactionContext,
    serviceId: number
  ): Promise<ServiceConfig> {
    const query = `
      SELECT 
        id,
        duration_min,
        COALESCE(buffer_before_min, 0) as buffer_before_min,
        COALESCE(buffer_after_min, 0) as buffer_after_min
      FROM services
      WHERE id = $1 AND active = true
    `;
    
    const result = await ctx.query(query, [serviceId]);
    
    if (result.rows.length === 0) {
      throw new NotFoundError('Service not found or inactive');
    }
    
    return result.rows[0];
  }

  /**
   * Validate duration is multiple of granularity
   */
  private validateDurationGranularity(
    durationMin: number,
    serviceConfig: ServiceConfig,
    granularityMin: number
  ): void {
    const totalDuration = durationMin + 
                         serviceConfig.buffer_before_min + 
                         serviceConfig.buffer_after_min;
    
    if (totalDuration % granularityMin !== 0) {
      throw new BadRequestError(
        `Total duration (${totalDuration} min) must be a multiple of granularity (${granularityMin} min)`,
        {
          code: 'invalid_duration_granularity',
          totalDuration,
          granularity: granularityMin
        }
      );
    }
  }

  /**
   * Calculate number of required continuous slots
   */
  private calculateRequiredSlots(
    durationMin: number,
    serviceConfig: ServiceConfig,
    granularityMin: number
  ): number {
    const totalDuration = durationMin + 
                         serviceConfig.buffer_before_min + 
                         serviceConfig.buffer_after_min;
    
    return Math.ceil(totalDuration / granularityMin);
  }

  /**
   * Lock k continuous timeslots with FOR UPDATE
   * This prevents concurrent bookings from accessing the same slots
   */
  private async lockContinuousSlots(
    ctx: TransactionContext,
    tenantId: number,
    resourceId: number,
    startTime: Date,
    k: number,
    granularityMin: number
  ): Promise<Timeslot[]> {
    // Calculate end time for the range
    const endTime = new Date(startTime.getTime() + k * granularityMin * 60 * 1000);
    
    // Lock slots in ascending order to prevent deadlocks
    const query = `
      SELECT 
        id,
        tenant_id,
        resource_id,
        start_at,
        end_at,
        available_capacity
      FROM timeslots
      WHERE tenant_id = $1
        AND resource_id = $2
        AND start_at >= $3
        AND end_at <= $4
        AND available_capacity > 0
      ORDER BY start_at ASC
      FOR UPDATE
    `;
    
    const result = await ctx.query(query, [
      tenantId,
      resourceId,
      startTime,
      endTime
    ]);
    
    // Verify slots are truly continuous
    const slots = result.rows as Timeslot[];
    
    if (slots.length > 0) {
      for (let i = 1; i < slots.length; i++) {
        const prevEnd = slots[i - 1].end_at.getTime();
        const currStart = slots[i].start_at.getTime();
        
        if (prevEnd !== currStart) {
          logger.warn('Non-continuous slots detected', {
            gap: currStart - prevEnd,
            prevSlot: slots[i - 1].id,
            currSlot: slots[i].id
          });
          
          // Return only the continuous slots up to the gap
          return slots.slice(0, i);
        }
      }
    }
    
    return slots;
  }

  /**
   * Atomically decrement capacity for multiple slots
   */
  private async decrementSlotCapacity(
    ctx: TransactionContext,
    slotIds: number[],
    capacity: number
  ): Promise<number> {
    const query = `
      UPDATE timeslots
      SET 
        available_capacity = available_capacity - $1,
        updated_at = NOW()
      WHERE id = ANY($2::bigint[])
        AND available_capacity >= $1
      RETURNING id
    `;
    
    const result = await ctx.query(query, [capacity, slotIds]);
    
    return result.rowCount;
  }

  /**
   * Create booking record
   */
  private async createBookingRecord(
    ctx: TransactionContext,
    request: ContinuousBookingRequest,
    slots: Timeslot[],
    serviceConfig: ServiceConfig
  ): Promise<{ id: number; created_at: Date }> {
    const query = `
      INSERT INTO bookings (
        tenant_id,
        service_id,
        customer_id,
        resource_id,
        start_at,
        end_at,
        status,
        metadata,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW(), NOW()
      )
      RETURNING id, created_at
    `;
    
    const result = await ctx.query(query, [
      request.tenantId,
      request.serviceId,
      request.customerId,
      request.resourceId,
      slots[0].start_at,
      slots[slots.length - 1].end_at,
      'confirmed',
      JSON.stringify(request.metadata || {})
    ]);
    
    return result.rows[0];
  }

  /**
   * Create booking items for each reserved slot
   */
  private async createBookingItems(
    ctx: TransactionContext,
    bookingId: number,
    slots: Timeslot[]
  ): Promise<void> {
    const values = slots.map((slot, index) => 
      `(${bookingId}, ${slot.id}, ${index + 1}, NOW())`
    ).join(',');
    
    const query = `
      INSERT INTO booking_items (
        booking_id,
        timeslot_id,
        sequence,
        created_at
      ) VALUES ${values}
    `;
    
    await ctx.query(query);
  }

  /**
   * Test method: Attempt 100 parallel bookings for the same slot
   * This is for testing double-booking prevention
   */
  async testParallelBookings(
    request: ContinuousBookingRequest,
    parallelCount: number = 100
  ): Promise<{
    successful: number;
    failed: number;
    errors: Array<{ error: string; code?: string }>;
  }> {
    logger.info('Starting parallel booking test', {
      parallelCount,
      request
    });

    const promises = Array.from({ length: parallelCount }, (_, i) => 
      this.bookContinuousSlots({
        ...request,
        metadata: { ...request.metadata, testIndex: i }
      }).then(
        () => ({ success: true, index: i }),
        (error) => ({ success: false, index: i, error })
      )
    );

    const results = await Promise.all(promises);
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const errors = results
      .filter(r => !r.success)
      .map(r => ({
        error: (r as any).error.message,
        code: (r as any).error.code
      }));

    logger.info('Parallel booking test completed', {
      successful,
      failed,
      successRate: `${(successful / parallelCount * 100).toFixed(2)}%`
    });

    return { successful, failed, errors };
  }
  
  /**
   * Generate confirmation code for booking
   */
  private generateConfirmationCode(bookingId: number): string {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256')
      .update(`${bookingId}-${Date.now()}`)
      .digest('hex');
    return hash.substring(0, 8).toUpperCase();
  }
}