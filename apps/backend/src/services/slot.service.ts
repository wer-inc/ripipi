/**
 * Slot Management Service
 * Handles tenant-specific slot granularity, slot generation, and validation
 */

import { FastifyInstance } from 'fastify';
import { 
  SlotGranularity,
  SlotConfig,
  TimeSlot,
  BusinessHours,
  Holiday,
  ResourceTimeOff,
  AvailabilityQuery,
  SlotBookingRequest,
  SlotBookingResult,
  SlotGenerationParams,
  SlotValidationResult,
  BatchAvailabilityRequest,
  BatchAvailabilityResult,
  SlotAdjustment,
  ContinuousSlotRequirement,
  InventoryStats,
  SlotPerformanceMetrics
} from '../types/availability.js';
import { TimeSlotUtils, SlotTimingUtils } from '../utils/time-slot.js';
import { withTransaction, TransactionContext } from '../db/transaction.js';
import { CacheService } from './cache.service.js';
import { logger } from '../config/logger.js';
import { InternalServerError, BadRequestError, NotFoundError } from '../utils/errors.js';

/**
 * Slot Management Service
 */
export class SlotService {
  private cache: CacheService;
  private performanceMetrics: SlotPerformanceMetrics[] = [];

  constructor(private fastify: FastifyInstance) {
    this.cache = new CacheService(fastify, {
      defaultTTL: 300, // 5 minutes
      memory: {
        enabled: true,
        maxSize: 64 * 1024 * 1024, // 64MB
        maxItems: 5000,
        ttlRatio: 0.2
      }
    });
  }

  /**
   * Get slot configuration for a tenant
   */
  async getSlotConfig(tenantId: string): Promise<SlotConfig> {
    const cacheKey = `slot_config:${tenantId}`;
    
    // Try cache first
    let config = await this.cache.get<SlotConfig>(cacheKey);
    if (config) {
      return config;
    }

    // Query database
    const result = await this.fastify.db.queryForTenant<any>(
      tenantId,
      `
      SELECT 
        COALESCE(settings.slot_granularity, 15)::integer as granularity,
        COALESCE(settings.min_booking_duration, 15)::integer as min_booking_duration,
        COALESCE(settings.max_booking_duration, 480)::integer as max_booking_duration,
        COALESCE(settings.advance_booking_days, 30)::integer as advance_booking_days,
        COALESCE(settings.buffer_time, 0)::integer as buffer_time
      FROM tenants t
      LEFT JOIN tenant_settings settings ON t.id = settings.tenant_id
      WHERE t.id = $1
      `,
      [tenantId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError(`Tenant ${tenantId} not found`);
    }

    config = {
      granularity: result.rows[0].granularity as SlotGranularity,
      minBookingDuration: result.rows[0].min_booking_duration,
      maxBookingDuration: result.rows[0].max_booking_duration,
      advanceBookingDays: result.rows[0].advance_booking_days,
      bufferTime: result.rows[0].buffer_time
    };

    // Validate granularity
    if (config.granularity !== 5 && config.granularity !== 15) {
      config.granularity = 15; // Default to 15 minutes
    }

    // Cache the result
    await this.cache.set(cacheKey, config, 3600); // Cache for 1 hour

    return config;
  }

  /**
   * Update slot configuration for a tenant
   */
  async updateSlotConfig(tenantId: string, config: Partial<SlotConfig>): Promise<SlotConfig> {
    const startTime = Date.now();

    try {
      const updatedConfig = await withTransaction(async (ctx) => {
        // Get current config
        const currentConfig = await this.getSlotConfig(tenantId);
        const newConfig = { ...currentConfig, ...config };

        // Validate new configuration
        this.validateSlotConfig(newConfig);

        // Update in database
        await ctx.queryForTenant(
          tenantId,
          `
          INSERT INTO tenant_settings (tenant_id, slot_granularity, min_booking_duration, max_booking_duration, advance_booking_days, buffer_time)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (tenant_id)
          DO UPDATE SET
            slot_granularity = EXCLUDED.slot_granularity,
            min_booking_duration = EXCLUDED.min_booking_duration,
            max_booking_duration = EXCLUDED.max_booking_duration,
            advance_booking_days = EXCLUDED.advance_booking_days,
            buffer_time = EXCLUDED.buffer_time,
            updated_at = NOW()
          `,
          [
            tenantId,
            newConfig.granularity,
            newConfig.minBookingDuration,
            newConfig.maxBookingDuration,
            newConfig.advanceBookingDays,
            newConfig.bufferTime || 0
          ]
        );

        return newConfig;
      });

      // Invalidate cache
      const cacheKey = `slot_config:${tenantId}`;
      await this.cache.delete(cacheKey);

      this.recordPerformanceMetric('updateSlotConfig', Date.now() - startTime, 1, false, tenantId);
      return updatedConfig;

    } catch (error) {
      logger.error('Failed to update slot configuration', { tenantId, config, error });
      throw new InternalServerError('Failed to update slot configuration');
    }
  }

  /**
   * Generate time slots for a resource within a date range
   */
  async generateSlots(params: SlotGenerationParams): Promise<TimeSlot[]> {
    const startTime = Date.now();

    try {
      const cacheKey = `slots:${params.tenantId}:${params.resourceId}:${params.startDate.toISOString()}:${params.endDate.toISOString()}:${params.granularity}`;
      
      // Try cache first
      let slots = await this.cache.get<TimeSlot[]>(cacheKey);
      if (slots) {
        this.recordPerformanceMetric('generateSlots', Date.now() - startTime, slots.length, true, params.tenantId, params.resourceId);
        return slots;
      }

      // Generate optimized slot times
      const slotTimes = SlotTimingUtils.generateOptimizedSlotTimes(
        params.startDate,
        params.endDate,
        params.granularity,
        params.businessHours
      );

      // Filter out holidays and time-offs
      const availableSlotTimes = slotTimes.filter(slotTime => {
        const slotEnd = new Date(slotTime.getTime() + params.granularity * 60 * 1000);
        
        return !TimeSlotUtils.isHoliday(slotTime, params.holidays) &&
               !TimeSlotUtils.intersectsWithTimeOff(slotTime, slotEnd, params.timeOffs);
      });

      // Convert to TimeSlot objects
      slots = availableSlotTimes.map((slotTime, index) => ({
        id: `${params.resourceId}_${slotTime.getTime()}`,
        tenantId: params.tenantId,
        resourceId: params.resourceId,
        startTime: slotTime,
        endTime: new Date(slotTime.getTime() + params.granularity * 60 * 1000),
        duration: params.granularity,
        isAvailable: true,
        capacity: params.capacity,
        bookedCount: 0,
        availableCapacity: params.capacity
      }));

      // Cache the result
      await this.cache.set(cacheKey, slots, 300); // Cache for 5 minutes

      this.recordPerformanceMetric('generateSlots', Date.now() - startTime, slots.length, false, params.tenantId, params.resourceId);
      return slots;

    } catch (error) {
      logger.error('Failed to generate slots', { params, error });
      throw new InternalServerError('Failed to generate slots');
    }
  }

  /**
   * Get available slots for booking
   */
  async getAvailableSlots(query: AvailabilityQuery): Promise<TimeSlot[]> {
    const startTime = Date.now();

    try {
      // Get slot configuration
      const config = await this.getSlotConfig(query.tenantId);
      const granularity = query.granularity || config.granularity;

      // Validate query parameters
      this.validateAvailabilityQuery(query, config);

      const availableSlots: TimeSlot[] = [];

      // Process each resource
      for (const resourceId of query.resourceIds) {
        const resourceSlots = await this.getResourceAvailableSlots(
          query.tenantId,
          resourceId,
          query.startDate,
          query.endDate,
          granularity,
          query.capacity
        );

        availableSlots.push(...resourceSlots);
      }

      // Filter by duration if specified
      if (query.duration) {
        const continuousSlots = this.filterContinuousSlots(availableSlots, query.duration, granularity);
        this.recordPerformanceMetric('getAvailableSlots', Date.now() - startTime, continuousSlots.length, false, query.tenantId);
        return continuousSlots;
      }

      this.recordPerformanceMetric('getAvailableSlots', Date.now() - startTime, availableSlots.length, false, query.tenantId);
      return availableSlots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    } catch (error) {
      logger.error('Failed to get available slots', { query, error });
      throw new InternalServerError('Failed to get available slots');
    }
  }

  /**
   * Validate continuous slot requirements
   */
  async validateContinuousSlots(
    tenantId: string,
    resourceId: string,
    startTime: Date,
    duration: number
  ): Promise<SlotValidationResult> {
    const startTimeMs = Date.now();

    try {
      const config = await this.getSlotConfig(tenantId);
      
      // Calculate slot boundary
      const boundary = TimeSlotUtils.calculateSlotBoundary(startTime, duration, config.granularity);
      
      if (!boundary.isValid) {
        return {
          isValid: false,
          errors: ['Invalid slot boundary calculation'],
          warnings: []
        };
      }

      // Generate required slot times
      const slotTimes = TimeSlotUtils.generateSlotTimes(
        boundary.alignedStart,
        boundary.alignedEnd,
        config.granularity
      );

      // Validate slot continuity
      const continuityResult = TimeSlotUtils.validateSlotContinuity(slotTimes, config.granularity);
      
      if (!continuityResult.isValid) {
        return continuityResult;
      }

      // Check actual availability
      const availability = await this.checkSlotsAvailability(tenantId, resourceId, slotTimes);
      
      const unavailableSlots = availability.filter(a => !a.available);
      if (unavailableSlots.length > 0) {
        return {
          isValid: false,
          errors: [`Slots not available: ${unavailableSlots.map(s => s.slotTime.toISOString()).join(', ')}`],
          warnings: []
        };
      }

      this.recordPerformanceMetric('validateContinuousSlots', Date.now() - startTimeMs, slotTimes.length, false, tenantId, resourceId);
      
      return {
        isValid: true,
        errors: [],
        warnings: boundary.adjustmentMade ? ['Start time was adjusted to slot boundary'] : []
      };

    } catch (error) {
      logger.error('Failed to validate continuous slots', { tenantId, resourceId, startTime, duration, error });
      throw new InternalServerError('Failed to validate continuous slots');
    }
  }

  /**
   * Book multiple slots atomically
   */
  async bookSlots(request: SlotBookingRequest): Promise<SlotBookingResult> {
    const startTime = Date.now();

    try {
      const result = await withTransaction(async (ctx) => {
        // Validate booking request
        const validation = await this.validateContinuousSlots(
          request.tenantId,
          request.resourceId,
          request.startTime,
          request.duration
        );

        if (!validation.isValid) {
          return {
            success: false,
            slotIds: [],
            message: 'Validation failed',
            error: validation.errors.join('; ')
          };
        }

        const config = await this.getSlotConfig(request.tenantId);
        const boundary = TimeSlotUtils.calculateSlotBoundary(
          request.startTime,
          request.duration,
          config.granularity
        );

        // Generate slot times
        const slotTimes = TimeSlotUtils.generateSlotTimes(
          boundary.alignedStart,
          boundary.alignedEnd,
          config.granularity
        );

        const bookedSlotIds: string[] = [];

        // Book each slot
        for (const slotTime of slotTimes) {
          const slotId = await this.bookSingleSlot(
            ctx,
            request.tenantId,
            request.resourceId,
            slotTime,
            config.granularity,
            request.capacity
          );

          if (slotId) {
            bookedSlotIds.push(slotId);
          } else {
            // Rollback will happen automatically due to transaction
            return {
              success: false,
              slotIds: [],
              message: 'Failed to book slot',
              error: `Slot at ${slotTime.toISOString()} is not available`
            };
          }
        }

        // Invalidate relevant cache entries
        await this.invalidateSlotCache(request.tenantId, request.resourceId, slotTimes);

        return {
          success: true,
          slotIds: bookedSlotIds,
          message: `Successfully booked ${bookedSlotIds.length} slots`
        };
      });

      this.recordPerformanceMetric('bookSlots', Date.now() - startTime, result.slotIds.length, false, request.tenantId, request.resourceId);
      return result;

    } catch (error) {
      logger.error('Failed to book slots', { request, error });
      return {
        success: false,
        slotIds: [],
        message: 'Internal error occurred',
        error: error.message
      };
    }
  }

  /**
   * Cancel booked slots
   */
  async cancelSlots(tenantId: string, resourceId: string, slotIds: string[]): Promise<boolean> {
    const startTime = Date.now();

    try {
      const result = await withTransaction(async (ctx) => {
        // Update slot capacities
        const updateResult = await ctx.queryForTenant(
          tenantId,
          `
          UPDATE timeslots 
          SET available_capacity = available_capacity + 1,
              updated_at = NOW()
          WHERE id = ANY($1) AND resource_id = $2
          RETURNING id, start_at
          `,
          [slotIds, resourceId]
        );

        if (updateResult.rows.length !== slotIds.length) {
          throw new BadRequestError('Some slots could not be cancelled');
        }

        // Invalidate cache for affected time range
        const slotTimes = updateResult.rows.map(row => row.start_at);
        await this.invalidateSlotCache(tenantId, resourceId, slotTimes);

        return true;
      });

      this.recordPerformanceMetric('cancelSlots', Date.now() - startTime, slotIds.length, false, tenantId, resourceId);
      return result;

    } catch (error) {
      logger.error('Failed to cancel slots', { tenantId, resourceId, slotIds, error });
      return false;
    }
  }

  /**
   * Batch availability check for multiple resources
   */
  async checkBatchAvailability(request: BatchAvailabilityRequest): Promise<BatchAvailabilityResult> {
    const startTime = Date.now();

    try {
      const results = await Promise.all(
        request.requests.map(async (req) => {
          try {
            const slots = await this.getResourceAvailableSlots(
              request.tenantId,
              req.resourceId,
              req.startTime,
              req.endTime,
              15, // Default granularity
              req.requiredCapacity
            );

            const totalAvailableCapacity = slots.reduce((sum, slot) => sum + slot.availableCapacity, 0);

            return {
              resourceId: req.resourceId,
              available: totalAvailableCapacity >= req.requiredCapacity,
              availableCapacity: totalAvailableCapacity,
              conflictReason: totalAvailableCapacity < req.requiredCapacity ? 'Insufficient capacity' : undefined
            };

          } catch (error) {
            return {
              resourceId: req.resourceId,
              available: false,
              availableCapacity: 0,
              conflictReason: error.message
            };
          }
        })
      );

      this.recordPerformanceMetric('checkBatchAvailability', Date.now() - startTime, results.length, false, request.tenantId);

      return {
        results,
        timestamp: new Date()
      };

    } catch (error) {
      logger.error('Failed to check batch availability', { request, error });
      throw new InternalServerError('Failed to check batch availability');
    }
  }

  /**
   * Get slot statistics for a tenant
   */
  async getSlotStatistics(tenantId: string, resourceId?: string, startDate?: Date, endDate?: Date): Promise<InventoryStats> {
    const startTime = Date.now();

    try {
      const period = {
        startDate: startDate || new Date(),
        endDate: endDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // Default to 1 week
      };

      let resourceFilter = '';
      const params: any[] = [tenantId];

      if (resourceId) {
        resourceFilter = 'AND resource_id = $2';
        params.push(resourceId);
        params.push(period.startDate, period.endDate);
      } else {
        params.push(period.startDate, period.endDate);
      }

      const result = await this.fastify.db.queryForTenant<any>(
        tenantId,
        `
        SELECT 
          COUNT(*) as total_slots,
          SUM(CASE WHEN available_capacity > 0 THEN 1 ELSE 0 END) as available_slots,
          SUM(CASE WHEN available_capacity = 0 THEN 1 ELSE 0 END) as booked_slots,
          AVG(EXTRACT(EPOCH FROM (end_at - start_at))/60) as avg_duration_minutes,
          MAX(available_capacity) as peak_capacity,
          AVG(available_capacity) as avg_capacity
        FROM timeslots
        WHERE start_at >= $${params.length - 1} AND end_at <= $${params.length}
        ${resourceFilter}
        `,
        params
      );

      const stats = result.rows[0];
      const totalSlots = parseInt(stats.total_slots) || 0;
      const availableSlots = parseInt(stats.available_slots) || 0;
      const bookedSlots = parseInt(stats.booked_slots) || 0;
      
      const utilizationRate = totalSlots > 0 ? (bookedSlots / totalSlots) * 100 : 0;
      const peakUtilization = totalSlots > 0 ? (stats.peak_capacity || 0) : 0;

      this.recordPerformanceMetric('getSlotStatistics', Date.now() - startTime, 1, false, tenantId, resourceId);

      return {
        tenantId,
        resourceId,
        period,
        totalSlots,
        availableSlots,
        bookedSlots,
        utilizationRate,
        peakUtilization,
        averageBookingDuration: parseFloat(stats.avg_duration_minutes) || 0,
        popularTimeSlots: [] // TODO: Implement popular time slots analysis
      };

    } catch (error) {
      logger.error('Failed to get slot statistics', { tenantId, resourceId, startDate, endDate, error });
      throw new InternalServerError('Failed to get slot statistics');
    }
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): SlotPerformanceMetrics[] {
    return [...this.performanceMetrics];
  }

  /**
   * Clear performance metrics
   */
  clearPerformanceMetrics(): void {
    this.performanceMetrics = [];
  }

  // Private helper methods

  private validateSlotConfig(config: SlotConfig): void {
    if (config.granularity !== 5 && config.granularity !== 15) {
      throw new BadRequestError('Slot granularity must be 5 or 15 minutes');
    }

    if (config.minBookingDuration < config.granularity) {
      throw new BadRequestError('Minimum booking duration must be at least one slot');
    }

    if (config.maxBookingDuration < config.minBookingDuration) {
      throw new BadRequestError('Maximum booking duration must be greater than minimum');
    }

    if (config.advanceBookingDays < 0 || config.advanceBookingDays > 365) {
      throw new BadRequestError('Advance booking days must be between 0 and 365');
    }
  }

  private validateAvailabilityQuery(query: AvailabilityQuery, config: SlotConfig): void {
    if (query.startDate >= query.endDate) {
      throw new BadRequestError('Start date must be before end date');
    }

    const maxRange = config.advanceBookingDays * 24 * 60 * 60 * 1000;
    const queryRange = query.endDate.getTime() - query.startDate.getTime();
    
    if (queryRange > maxRange) {
      throw new BadRequestError(`Query range exceeds maximum allowed range of ${config.advanceBookingDays} days`);
    }

    if (query.resourceIds.length === 0) {
      throw new BadRequestError('At least one resource ID must be specified');
    }

    if (query.capacity && query.capacity <= 0) {
      throw new BadRequestError('Capacity must be greater than 0');
    }
  }

  private async getResourceAvailableSlots(
    tenantId: string,
    resourceId: string,
    startDate: Date,
    endDate: Date,
    granularity: SlotGranularity,
    requiredCapacity?: number
  ): Promise<TimeSlot[]> {
    const capacityFilter = requiredCapacity ? 'AND t.available_capacity >= $5' : '';
    const params = [resourceId, startDate, endDate, granularity];
    if (requiredCapacity) {
      params.push(requiredCapacity);
    }

    const result = await this.fastify.db.queryForTenant<any>(
      tenantId,
      `
      SELECT 
        t.id,
        t.resource_id,
        t.start_at,
        t.end_at,
        t.available_capacity,
        r.capacity as total_capacity
      FROM timeslots t
      JOIN resources r ON t.resource_id = r.id
      WHERE t.resource_id = $1 
        AND t.start_at >= $2 
        AND t.end_at <= $3
        AND t.available_capacity > 0
        ${capacityFilter}
      ORDER BY t.start_at
      `,
      params
    );

    return result.rows.map(row => ({
      id: row.id.toString(),
      tenantId,
      resourceId: row.resource_id.toString(),
      startTime: row.start_at,
      endTime: row.end_at,
      duration: granularity,
      isAvailable: row.available_capacity > 0,
      capacity: row.total_capacity,
      bookedCount: row.total_capacity - row.available_capacity,
      availableCapacity: row.available_capacity
    }));
  }

  private filterContinuousSlots(slots: TimeSlot[], duration: number, granularity: SlotGranularity): TimeSlot[] {
    const requiredSlots = Math.ceil(duration / granularity);
    const continuousSlots: TimeSlot[] = [];

    // Group by resource
    const slotsByResource = slots.reduce((groups, slot) => {
      if (!groups[slot.resourceId]) {
        groups[slot.resourceId] = [];
      }
      groups[slot.resourceId].push(slot);
      return groups;
    }, {} as Record<string, TimeSlot[]>);

    // Find continuous sequences for each resource
    Object.values(slotsByResource).forEach(resourceSlots => {
      const sortedSlots = resourceSlots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

      for (let i = 0; i <= sortedSlots.length - requiredSlots; i++) {
        const sequence = sortedSlots.slice(i, i + requiredSlots);
        
        // Check if sequence is continuous
        let isContinuous = true;
        for (let j = 1; j < sequence.length; j++) {
          const expectedStart = new Date(sequence[j - 1].endTime.getTime());
          if (expectedStart.getTime() !== sequence[j].startTime.getTime()) {
            isContinuous = false;
            break;
          }
        }

        if (isContinuous) {
          continuousSlots.push(...sequence);
        }
      }
    });

    return continuousSlots;
  }

  private async checkSlotsAvailability(
    tenantId: string,
    resourceId: string,
    slotTimes: Date[]
  ): Promise<Array<{ slotTime: Date; available: boolean; capacity: number }>> {
    if (slotTimes.length === 0) return [];

    const result = await this.fastify.db.queryForTenant<any>(
      tenantId,
      `
      SELECT start_at, available_capacity
      FROM timeslots
      WHERE resource_id = $1 AND start_at = ANY($2)
      `,
      [resourceId, slotTimes]
    );

    const availabilityMap = new Map<string, number>();
    result.rows.forEach(row => {
      availabilityMap.set(row.start_at.toISOString(), row.available_capacity);
    });

    return slotTimes.map(slotTime => ({
      slotTime,
      available: (availabilityMap.get(slotTime.toISOString()) || 0) > 0,
      capacity: availabilityMap.get(slotTime.toISOString()) || 0
    }));
  }

  private async bookSingleSlot(
    ctx: TransactionContext,
    tenantId: string,
    resourceId: string,
    startTime: Date,
    duration: number,
    requiredCapacity: number
  ): Promise<string | null> {
    const endTime = new Date(startTime.getTime() + duration * 60 * 1000);

    const result = await ctx.queryForTenant(
      tenantId,
      `
      UPDATE timeslots
      SET available_capacity = available_capacity - $1,
          updated_at = NOW()
      WHERE resource_id = $2 
        AND start_at = $3 
        AND end_at = $4
        AND available_capacity >= $1
      RETURNING id
      `,
      [requiredCapacity, resourceId, startTime, endTime]
    );

    return result.rows.length > 0 ? result.rows[0].id.toString() : null;
  }

  private async invalidateSlotCache(tenantId: string, resourceId: string, slotTimes: Date[]): Promise<void> {
    // Simple cache invalidation - in production, this could be more sophisticated
    const patterns = [
      `slots:${tenantId}:${resourceId}:*`,
      `availability:${tenantId}:${resourceId}:*`
    ];

    for (const pattern of patterns) {
      await this.cache.deleteByPattern(pattern);
    }
  }

  private recordPerformanceMetric(
    operation: string,
    duration: number,
    recordsProcessed: number,
    cacheHit: boolean,
    tenantId: string,
    resourceId?: string
  ): void {
    const metric: SlotPerformanceMetrics = {
      operation,
      duration,
      recordsProcessed,
      cacheHit,
      timestamp: new Date(),
      tenantId,
      resourceId
    };

    this.performanceMetrics.push(metric);

    // Keep only last 1000 metrics
    if (this.performanceMetrics.length > 1000) {
      this.performanceMetrics = this.performanceMetrics.slice(-1000);
    }

    // Log slow operations
    if (duration > 1000) { // More than 1 second
      logger.warn('Slow slot operation detected', metric);
    }
  }
}

export default SlotService;