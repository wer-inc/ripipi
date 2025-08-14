/**
 * Timeslot Service
 * Handles time slot generation with business hours, holidays, and availability patterns
 * Implements the POST /timeslots/generate endpoint functionality
 */

import { FastifyInstance } from 'fastify';
import { 
  TimeslotGenerateRequest, 
  TimeslotGenerateResponse,
  TimeslotGenerateDryRunResponse,
  BusinessHours,
  Holiday,
  ResourceTimeOff,
  SlotGranularity
} from '../schemas/timeslot.js';
import { 
  TimeSlotUtils, 
  SlotTimingUtils 
} from '../utils/time-slot.js';
import { 
  BusinessHours as BusinessHoursType,
  Holiday as HolidayType,
  ResourceTimeOff as ResourceTimeOffType,
  SlotGenerationParams
} from '../types/availability.js';
import { logger } from '../config/logger.js';
import { BadRequestError, InternalServerError, NotFoundError } from '../utils/errors.js';

/**
 * Generated slot information
 */
interface GeneratedSlot {
  resourceId: string;
  startTime: Date;
  endTime: Date;
  capacity: number;
  availableCapacity: number;
}

/**
 * Slot generation statistics
 */
interface SlotGenerationStats {
  generated: number;
  updated: number;
  deleted: number;
  skipped: number;
  conflictCount: number;
  processingTime: number;
}

/**
 * Existing slot information from database
 */
interface ExistingSlot {
  timeslot_id: number;
  resource_id: string;
  start_at: Date;
  end_at: Date;
  available_capacity: number;
}

/**
 * Timeslot Service Implementation
 */
export class TimeslotService {
  constructor(private fastify: FastifyInstance) {}

  /**
   * Generate time slots based on request parameters
   */
  async generateSlots(request: TimeslotGenerateRequest): Promise<TimeslotGenerateResponse | TimeslotGenerateDryRunResponse> {
    const startTime = Date.now();
    
    try {
      // Validate request parameters
      this.validateGenerateRequest(request);
      
      // Convert schema types to internal types
      const businessHours = this.convertBusinessHours(request.businessHours);
      const holidays = this.convertHolidays(request.holidays || []);
      const timeOffs = this.convertTimeOffs(request.timeOffs || []);
      
      // Parse dates
      const startDate = new Date(request.startDate);
      const endDate = new Date(request.endDate);
      
      // Get tenant's slot granularity if not provided
      const granularity = request.granularity || await this.getTenantSlotGranularity(request.tenant_id);
      
      // Generate slot times based on business hours and constraints
      const slotTimes = await this.generateSlotTimes({
        tenantId: request.tenant_id.toString(),
        resourceId: request.resourceId,
        startDate,
        endDate,
        granularity,
        businessHours,
        holidays,
        timeOffs,
        capacity: request.capacity || 1
      });
      
      // Filter slots based on duration and buffer requirements
      const validSlots = this.filterSlotsByDurationAndBuffer(
        slotTimes, 
        request.duration, 
        request.buffer || 0, 
        granularity
      );
      
      // Get existing slots if skipExisting is true
      let existingSlots: ExistingSlot[] = [];
      if (request.skipExisting) {
        existingSlots = await this.getExistingSlots(
          request.tenant_id,
          request.resourceId,
          startDate,
          endDate
        );
      }
      
      // Generate slots to create/update
      const slotsToProcess = this.calculateSlotsToProcess(
        validSlots,
        existingSlots,
        request.skipExisting || true,
        request.capacity || 1
      );
      
      const processingTime = Date.now() - startTime;
      
      // Handle dry run
      if (request.dry_run) {
        return this.generateDryRunResponse(slotsToProcess, processingTime);
      }
      
      // Process slots (create/update/delete)
      const stats = await this.processSlotsInDatabase(
        request.tenant_id,
        slotsToProcess,
        existingSlots
      );
      
      stats.processingTime = Date.now() - startTime;
      
      logger.info('Slots generated successfully', {
        tenantId: request.tenant_id,
        resourceId: request.resourceId,
        dateRange: `${request.startDate} to ${request.endDate}`,
        stats
      });
      
      return stats;
      
    } catch (error) {
      logger.error('Failed to generate slots', {
        request,
        error: error.message,
        stack: error.stack
      });
      
      if (error instanceof BadRequestError || error instanceof NotFoundError) {
        throw error;
      }
      
      throw new InternalServerError('Failed to generate time slots');
    }
  }

  /**
   * Get existing timeslots for querying
   */
  async getTimeslots(
    tenantId: number,
    serviceId?: number,
    resourceId?: number,
    from?: Date,
    to?: Date,
    cursor?: string,
    limit: number = 50
  ): Promise<{
    slots: Array<{
      timeslot_id: number;
      tenant_id: number;
      service_id?: number;
      resource_id: number;
      start_at: string;
      end_at: string;
      available_capacity: number;
      total_capacity?: number;
      created_at?: string;
      updated_at?: string;
    }>;
    nextCursor?: string;
    totalCount: number;
  }> {
    try {
      // Build query conditions
      const conditions: string[] = ['tenant_id = $1'];
      const params: any[] = [tenantId];
      let paramIndex = 1;

      if (serviceId !== undefined) {
        conditions.push(`service_id = $${++paramIndex}`);
        params.push(serviceId);
      }

      if (resourceId !== undefined) {
        conditions.push(`resource_id = $${++paramIndex}`);
        params.push(resourceId);
      }

      if (from) {
        conditions.push(`start_at >= $${++paramIndex}`);
        params.push(from);
      }

      if (to) {
        conditions.push(`end_at <= $${++paramIndex}`);
        params.push(to);
      }

      // Handle cursor-based pagination
      if (cursor) {
        try {
          const cursorData = JSON.parse(Buffer.from(cursor, 'base64').toString());
          conditions.push(`start_at > $${++paramIndex}`);
          params.push(new Date(cursorData.timestamp));
        } catch (error) {
          logger.warn('Invalid cursor provided', { cursor, error });
        }
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Get total count
      const countQuery = `
        SELECT COUNT(*) as total
        FROM timeslots 
        ${whereClause}
      `;
      const countResult = await this.fastify.db.query<{ total: string }>(countQuery, params);
      const totalCount = parseInt(countResult.rows[0].total);

      // Get paginated results
      const query = `
        SELECT 
          id as timeslot_id,
          tenant_id,
          service_id,
          resource_id,
          start_at,
          end_at,
          available_capacity,
          available_capacity as total_capacity,
          created_at,
          updated_at
        FROM timeslots 
        ${whereClause}
        ORDER BY start_at ASC, resource_id ASC
        LIMIT $${++paramIndex}
      `;
      params.push(limit + 1); // Get one extra to determine if there's a next page

      const result = await this.fastify.db.query<any>(query, params);

      // Check if there are more results
      const hasMore = result.rows.length > limit;
      const slots = hasMore ? result.rows.slice(0, limit) : result.rows;

      // Generate next cursor
      let nextCursor: string | undefined;
      if (hasMore && slots.length > 0) {
        const lastSlot = slots[slots.length - 1];
        const cursorData = { timestamp: lastSlot.start_at.toISOString() };
        nextCursor = Buffer.from(JSON.stringify(cursorData)).toString('base64');
      }

      // Format response
      const formattedSlots = slots.map(slot => ({
        timeslot_id: slot.timeslot_id,
        tenant_id: slot.tenant_id,
        service_id: slot.service_id,
        resource_id: slot.resource_id,
        start_at: slot.start_at.toISOString(),
        end_at: slot.end_at.toISOString(),
        available_capacity: slot.available_capacity,
        total_capacity: slot.total_capacity,
        created_at: slot.created_at?.toISOString(),
        updated_at: slot.updated_at?.toISOString()
      }));

      return {
        slots: formattedSlots,
        nextCursor,
        totalCount
      };

    } catch (error) {
      logger.error('Failed to get timeslots', { tenantId, serviceId, resourceId, error });
      throw new InternalServerError('Failed to retrieve timeslots');
    }
  }

  // Private helper methods

  /**
   * Validate generate request parameters
   */
  private validateGenerateRequest(request: TimeslotGenerateRequest): void {
    const startDate = new Date(request.startDate);
    const endDate = new Date(request.endDate);

    // Validate date range
    if (startDate >= endDate) {
      throw new BadRequestError('Start date must be before end date');
    }

    // Validate date range is not too large (max 120 days as per API spec)
    const daysDiff = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysDiff > 120) {
      throw new BadRequestError('Date range cannot exceed 120 days');
    }

    // Validate duration
    if (request.duration < 5 || request.duration > 1440) {
      throw new BadRequestError('Duration must be between 5 and 1440 minutes');
    }

    // Validate business hours
    if (!request.businessHours || request.businessHours.length === 0) {
      throw new BadRequestError('Business hours are required');
    }

    // Validate business hours format
    for (const bh of request.businessHours) {
      if (bh.dayOfWeek < 0 || bh.dayOfWeek > 6) {
        throw new BadRequestError('Day of week must be between 0 (Sunday) and 6 (Saturday)');
      }

      // Validate time format
      const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
      if (!timeRegex.test(bh.openTime) || !timeRegex.test(bh.closeTime)) {
        throw new BadRequestError('Invalid time format. Use HH:MM format');
      }

      // Validate open time is before close time
      const [openHour, openMin] = bh.openTime.split(':').map(Number);
      const [closeHour, closeMin] = bh.closeTime.split(':').map(Number);
      const openMinutes = openHour * 60 + openMin;
      const closeMinutes = closeHour * 60 + closeMin;

      if (openMinutes >= closeMinutes) {
        throw new BadRequestError('Open time must be before close time');
      }
    }
  }

  /**
   * Convert schema business hours to internal type
   */
  private convertBusinessHours(businessHours: BusinessHours[]): BusinessHoursType[] {
    return businessHours.map(bh => ({
      id: `temp-${Date.now()}-${Math.random()}`,
      tenantId: '',
      dayOfWeek: bh.dayOfWeek,
      openTime: bh.openTime,
      closeTime: bh.closeTime,
      effectiveFrom: bh.effectiveFrom ? new Date(bh.effectiveFrom) : undefined,
      effectiveTo: bh.effectiveTo ? new Date(bh.effectiveTo) : undefined
    }));
  }

  /**
   * Convert schema holidays to internal type
   */
  private convertHolidays(holidays: Holiday[]): HolidayType[] {
    return holidays.map(h => ({
      id: `temp-${Date.now()}-${Math.random()}`,
      tenantId: '',
      date: new Date(h.date),
      name: h.name
    }));
  }

  /**
   * Convert schema time-offs to internal type
   */
  private convertTimeOffs(timeOffs: ResourceTimeOff[]): ResourceTimeOffType[] {
    return timeOffs.map(t => ({
      id: `temp-${Date.now()}-${Math.random()}`,
      tenantId: '',
      resourceId: t.resourceId,
      startTime: new Date(t.startTime),
      endTime: new Date(t.endTime),
      reason: t.reason
    }));
  }

  /**
   * Get tenant's slot granularity setting
   */
  private async getTenantSlotGranularity(tenantId: number): Promise<SlotGranularity> {
    try {
      const result = await this.fastify.db.query<{ slot_granularity: number }>(
        'SELECT slot_granularity FROM tenants WHERE id = $1',
        [tenantId]
      );

      if (result.rows.length === 0) {
        throw new NotFoundError(`Tenant ${tenantId} not found`);
      }

      const granularity = result.rows[0].slot_granularity;
      return granularity === 5 ? 5 : 15; // Default to 15 if not 5
    } catch (error) {
      logger.warn('Failed to get tenant slot granularity, using default 15', { tenantId, error });
      return 15;
    }
  }

  /**
   * Generate slot times using TimeSlotUtils
   */
  private async generateSlotTimes(params: SlotGenerationParams): Promise<Date[]> {
    // Use the optimized slot generation from TimeSlotUtils
    const slotTimes = SlotTimingUtils.generateOptimizedSlotTimes(
      params.startDate,
      params.endDate,
      params.granularity,
      params.businessHours
    );

    // Filter out slots that fall on holidays
    const filteredSlots = slotTimes.filter(slotTime => {
      return !TimeSlotUtils.isHoliday(slotTime, params.holidays);
    });

    // Filter out slots that conflict with resource time-offs
    const finalSlots = filteredSlots.filter(slotTime => {
      const slotEnd = new Date(slotTime.getTime() + params.granularity * 60 * 1000);
      return !TimeSlotUtils.intersectsWithTimeOff(slotTime, slotEnd, params.timeOffs);
    });

    return finalSlots;
  }

  /**
   * Filter slots by duration and buffer requirements
   */
  private filterSlotsByDurationAndBuffer(
    slotTimes: Date[],
    duration: number,
    buffer: number,
    granularity: SlotGranularity
  ): GeneratedSlot[] {
    const generatedSlots: GeneratedSlot[] = [];
    const totalSlotDuration = duration + buffer;
    const requiredSlots = Math.ceil(totalSlotDuration / granularity);

    for (let i = 0; i <= slotTimes.length - requiredSlots; i++) {
      const startTime = slotTimes[i];
      const endTime = new Date(startTime.getTime() + duration * 60 * 1000);

      // Validate that we have continuous slots for the required duration
      let continuous = true;
      for (let j = 1; j < requiredSlots; j++) {
        const expectedTime = new Date(startTime.getTime() + j * granularity * 60 * 1000);
        if (i + j >= slotTimes.length || slotTimes[i + j].getTime() !== expectedTime.getTime()) {
          continuous = false;
          break;
        }
      }

      if (continuous) {
        generatedSlots.push({
          resourceId: '', // Will be set by caller
          startTime,
          endTime,
          capacity: 1,
          availableCapacity: 1
        });
      }
    }

    return generatedSlots;
  }

  /**
   * Get existing slots from database
   */
  private async getExistingSlots(
    tenantId: number,
    resourceId: string,
    startDate: Date,
    endDate: Date
  ): Promise<ExistingSlot[]> {
    try {
      const result = await this.fastify.db.query<ExistingSlot>(
        `
        SELECT 
          id as timeslot_id,
          resource_id,
          start_at,
          end_at,
          available_capacity
        FROM timeslots
        WHERE tenant_id = $1 
          AND resource_id = $2 
          AND start_at >= $3 
          AND end_at <= $4
        ORDER BY start_at
        `,
        [tenantId, resourceId, startDate, endDate]
      );

      return result.rows;
    } catch (error) {
      logger.error('Failed to get existing slots', { tenantId, resourceId, error });
      return [];
    }
  }

  /**
   * Calculate slots to process (create/update/skip)
   */
  private calculateSlotsToProcess(
    generatedSlots: GeneratedSlot[],
    existingSlots: ExistingSlot[],
    skipExisting: boolean,
    capacity: number
  ): {
    toCreate: GeneratedSlot[];
    toUpdate: Array<{ existing: ExistingSlot; generated: GeneratedSlot }>;
    toSkip: GeneratedSlot[];
    toDelete: ExistingSlot[];
  } {
    const toCreate: GeneratedSlot[] = [];
    const toUpdate: Array<{ existing: ExistingSlot; generated: GeneratedSlot }> = [];
    const toSkip: GeneratedSlot[] = [];
    const toDelete: ExistingSlot[] = [...existingSlots]; // Start with all existing, remove matches

    for (const generated of generatedSlots) {
      const existing = existingSlots.find(slot => 
        slot.start_at.getTime() === generated.startTime.getTime() &&
        slot.end_at.getTime() === generated.endTime.getTime()
      );

      if (existing) {
        // Remove from delete list since it matches
        const deleteIndex = toDelete.findIndex(slot => 
          slot.timeslot_id === existing.timeslot_id
        );
        if (deleteIndex >= 0) {
          toDelete.splice(deleteIndex, 1);
        }

        if (skipExisting) {
          toSkip.push(generated);
        } else {
          // Check if update is needed
          if (existing.available_capacity !== capacity) {
            toUpdate.push({ existing, generated: { ...generated, capacity, availableCapacity: capacity } });
          } else {
            toSkip.push(generated);
          }
        }
      } else {
        toCreate.push({ ...generated, capacity, availableCapacity: capacity });
      }
    }

    return { toCreate, toUpdate, toSkip, toDelete };
  }

  /**
   * Generate dry run response
   */
  private generateDryRunResponse(
    slotsToProcess: {
      toCreate: GeneratedSlot[];
      toUpdate: Array<{ existing: ExistingSlot; generated: GeneratedSlot }>;
      toSkip: GeneratedSlot[];
      toDelete: ExistingSlot[];
    },
    estimatedTime: number
  ): TimeslotGenerateDryRunResponse {
    return {
      will_generate: slotsToProcess.toCreate.length,
      will_update: slotsToProcess.toUpdate.length,
      will_delete: slotsToProcess.toDelete.length,
      will_skip: slotsToProcess.toSkip.length,
      estimatedTime,
      potentialConflicts: [] // TODO: Implement conflict detection
    };
  }

  /**
   * Process slots in database (create/update/delete)
   */
  private async processSlotsInDatabase(
    tenantId: number,
    slotsToProcess: {
      toCreate: GeneratedSlot[];
      toUpdate: Array<{ existing: ExistingSlot; generated: GeneratedSlot }>;
      toSkip: GeneratedSlot[];
      toDelete: ExistingSlot[];
    }
  ): Promise<SlotGenerationStats> {
    const client = await this.fastify.db.getClient();
    
    try {
      await client.query('BEGIN');

      let generated = 0;
      let updated = 0;
      let deleted = 0;

      // Create new slots in batches
      if (slotsToProcess.toCreate.length > 0) {
        generated = await this.batchCreateSlots(client, tenantId, slotsToProcess.toCreate);
      }

      // Update existing slots
      for (const { existing, generated: generatedSlot } of slotsToProcess.toUpdate) {
        await client.query(
          `
          UPDATE timeslots 
          SET available_capacity = $1, updated_at = NOW()
          WHERE id = $2 AND tenant_id = $3
          `,
          [generatedSlot.availableCapacity, existing.timeslot_id, tenantId]
        );
        updated++;
      }

      // Delete obsolete slots
      for (const obsoleteSlot of slotsToProcess.toDelete) {
        await client.query(
          'DELETE FROM timeslots WHERE id = $1 AND tenant_id = $2',
          [obsoleteSlot.timeslot_id, tenantId]
        );
        deleted++;
      }

      await client.query('COMMIT');

      return {
        generated,
        updated,
        deleted,
        skipped: slotsToProcess.toSkip.length,
        conflictCount: 0, // TODO: Implement conflict tracking
        processingTime: 0  // Will be set by caller
      };

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to process slots in database', { error });
      throw new InternalServerError('Failed to process time slots in database');
    } finally {
      client.release();
    }
  }

  /**
   * Batch create slots for better performance
   */
  private async batchCreateSlots(
    client: any,
    tenantId: number,
    slots: GeneratedSlot[]
  ): Promise<number> {
    if (slots.length === 0) return 0;

    // Build VALUES clause for batch insert
    const values: string[] = [];
    const params: any[] = [];
    let paramIndex = 0;

    for (const slot of slots) {
      values.push(`($${++paramIndex}, $${++paramIndex}, $${++paramIndex}, $${++paramIndex}, $${++paramIndex}, NOW(), NOW())`);
      params.push(
        tenantId,
        slot.resourceId,
        slot.startTime,
        slot.endTime,
        slot.availableCapacity
      );
    }

    const query = `
      INSERT INTO timeslots (tenant_id, resource_id, start_at, end_at, available_capacity, created_at, updated_at)
      VALUES ${values.join(', ')}
    `;

    const result = await client.query(query, params);
    return result.rowCount || 0;
  }
}

export default TimeslotService;