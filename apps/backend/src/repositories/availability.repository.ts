/**
 * Availability Repository
 * Handles high-performance queries for slot availability and inventory management
 */

import { BaseRepository, RepositoryOptions, FilterCondition, QueryOptions } from './base.repository.js';
import { withTransaction, TransactionContext } from '../db/transaction.js';
import { logger } from '../config/logger.js';
import {
  TimeslotEntity,
  BusinessHoursEntity,
  HolidayEntity,
  ResourceTimeOffEntity,
  OptimisticLock,
  InventoryUpdateRequest,
  InventoryUpdateResult,
  DeadlockPreventionConfig,
  BatchAvailabilityRequest,
  BatchAvailabilityResult,
  TimeSlot,
  AvailabilityQuery
} from '../types/availability.js';
import { db } from '../db/index.js';
import { InternalServerError, BadRequestError, NotFoundError } from '../utils/errors.js';
import { TenantContext, PaginatedResult } from '../types/database.js';

/**
 * Specialized repository for availability and inventory management
 */
export class AvailabilityRepository extends BaseRepository<TimeslotEntity> {
  private deadlockConfig: DeadlockPreventionConfig;

  constructor() {
    super({
      tableName: 'timeslots',
      primaryKey: 'id',
      tenantKey: 'tenant_id',
      auditFields: true,
      optimisticLocking: true
    } as RepositoryOptions);

    this.deadlockConfig = {
      maxRetries: 3,
      backoffMs: 100,
      lockOrder: 'RESOURCE_ID',
      timeoutMs: 5000
    };
  }

  /**
   * Get available slots for multiple resources with high performance
   */
  async getAvailableSlots(query: AvailabilityQuery): Promise<TimeSlot[]> {
    const startTime = Date.now();

    try {
      // Build optimized query with proper indexing
      let whereConditions = [
        't.start_at >= $2',
        't.end_at <= $3',
        't.available_capacity > 0'
      ];
      
      let params: any[] = [query.tenantId, query.startDate, query.endDate];
      
      // Add resource filter
      if (query.resourceIds.length > 0) {
        const resourcePlaceholders = query.resourceIds.map((_, index) => `$${params.length + index + 1}`).join(',');
        whereConditions.push(`t.resource_id IN (${resourcePlaceholders})`);
        params.push(...query.resourceIds);
      }

      // Add capacity filter
      if (query.capacity && query.capacity > 0) {
        whereConditions.push(`t.available_capacity >= $${params.length + 1}`);
        params.push(query.capacity);
      }

      const whereClause = whereConditions.join(' AND ');

      const queryText = `
        SELECT 
          t.id,
          t.resource_id,
          t.start_at,
          t.end_at,
          t.available_capacity,
          r.capacity as total_capacity,
          (r.capacity - t.available_capacity) as booked_count
        FROM timeslots t
        INNER JOIN resources r ON t.resource_id = r.id AND r.tenant_id = t.tenant_id
        WHERE t.tenant_id = $1 AND ${whereClause}
        ORDER BY t.resource_id, t.start_at
      `;

      const result = await db.queryForTenant<any>(query.tenantId, queryText, params);

      const slots = result.rows.map(row => ({
        id: row.id.toString(),
        tenantId: query.tenantId,
        resourceId: row.resource_id.toString(),
        startTime: row.start_at,
        endTime: row.end_at,
        duration: Math.round((row.end_at - row.start_at) / (1000 * 60)), // minutes
        isAvailable: row.available_capacity > 0,
        capacity: row.total_capacity,
        bookedCount: row.booked_count,
        availableCapacity: row.available_capacity
      }));

      const duration = Date.now() - startTime;
      logger.debug('Available slots query completed', {
        tenantId: query.tenantId,
        resourceIds: query.resourceIds,
        duration,
        slotsFound: slots.length
      });

      return slots;

    } catch (error) {
      logger.error('Failed to get available slots', { query, error });
      throw new InternalServerError('Failed to get available slots');
    }
  }

  /**
   * Batch availability check with optimized single query
   */
  async checkBatchAvailability(request: BatchAvailabilityRequest): Promise<BatchAvailabilityResult> {
    const startTime = Date.now();

    try {
      // Create a union query for all availability checks
      const unionQueries: string[] = [];
      const params: any[] = [request.tenantId];
      
      request.requests.forEach((req, index) => {
        const baseIndex = params.length;
        unionQueries.push(`
          SELECT 
            $${baseIndex + 1}::bigint as resource_id,
            COALESCE(SUM(t.available_capacity), 0) as total_available,
            COUNT(t.id) as slot_count,
            $${baseIndex + 4} as required_capacity
          FROM timeslots t
          WHERE t.tenant_id = $1 
            AND t.resource_id = $${baseIndex + 1}
            AND t.start_at >= $${baseIndex + 2}
            AND t.end_at <= $${baseIndex + 3}
            AND t.available_capacity > 0
        `);
        
        params.push(req.resourceId, req.startTime, req.endTime, req.requiredCapacity);
      });

      const queryText = unionQueries.join(' UNION ALL ');

      const result = await db.queryForTenant<any>(request.tenantId, queryText, params);

      const results = result.rows.map(row => {
        const available = row.total_available >= row.required_capacity;
        return {
          resourceId: row.resource_id.toString(),
          available,
          availableCapacity: row.total_available,
          conflictReason: !available ? 
            (row.slot_count === 0 ? 'No slots available' : 'Insufficient capacity') : 
            undefined
        };
      });

      const duration = Date.now() - startTime;
      logger.debug('Batch availability check completed', {
        tenantId: request.tenantId,
        requestCount: request.requests.length,
        duration
      });

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
   * Update inventory with optimistic locking and deadlock prevention
   */
  async updateInventory(request: InventoryUpdateRequest): Promise<InventoryUpdateResult> {
    return this.executeWithDeadlockPrevention(async (ctx) => {
      try {
        // First, get current state with FOR UPDATE lock
        const currentResult = await ctx.queryForTenant(
          request.tenantId,
          `
          SELECT 
            id, 
            available_capacity, 
            updated_at,
            EXTRACT(EPOCH FROM updated_at)::bigint as version_timestamp
          FROM timeslots
          WHERE id = $1 AND resource_id = $2
          FOR UPDATE
          `,
          [request.timeSlotId, request.resourceId]
        );

        if (currentResult.rows.length === 0) {
          return {
            success: false,
            newVersion: 0,
            newCapacity: 0,
            error: 'SLOT_NOT_FOUND',
            message: 'Time slot not found'
          };
        }

        const current = currentResult.rows[0];
        
        // Check optimistic lock version
        const currentVersion = current.version_timestamp;
        if (request.optimisticLock.version !== currentVersion) {
          return {
            success: false,
            newVersion: currentVersion,
            newCapacity: current.available_capacity,
            error: 'VERSION_MISMATCH',
            message: 'Resource was modified by another transaction'
          };
        }

        // Calculate new capacity based on operation
        let newCapacity: number;
        switch (request.operation) {
          case 'RESERVE':
            newCapacity = current.available_capacity - request.capacityChange;
            break;
          case 'RELEASE':
            newCapacity = current.available_capacity + request.capacityChange;
            break;
          case 'SET':
            newCapacity = request.capacityChange;
            break;
          default:
            throw new BadRequestError(`Invalid operation: ${request.operation}`);
        }

        // Validate new capacity
        if (newCapacity < 0) {
          return {
            success: false,
            newVersion: currentVersion,
            newCapacity: current.available_capacity,
            error: 'CAPACITY_EXCEEDED',
            message: 'Insufficient capacity available'
          };
        }

        // Get resource capacity to validate upper bound
        const resourceResult = await ctx.queryForTenant(
          request.tenantId,
          'SELECT capacity FROM resources WHERE id = $1',
          [request.resourceId]
        );

        if (resourceResult.rows.length === 0) {
          return {
            success: false,
            newVersion: currentVersion,
            newCapacity: current.available_capacity,
            error: 'SLOT_NOT_FOUND',
            message: 'Resource not found'
          };
        }

        const resourceCapacity = resourceResult.rows[0].capacity;
        if (newCapacity > resourceCapacity) {
          return {
            success: false,
            newVersion: currentVersion,
            newCapacity: current.available_capacity,
            error: 'BUSINESS_RULE_VIOLATION',
            message: 'Available capacity cannot exceed total resource capacity'
          };
        }

        // Update the slot with new capacity
        const updateResult = await ctx.queryForTenant(
          request.tenantId,
          `
          UPDATE timeslots 
          SET 
            available_capacity = $1,
            updated_at = NOW()
          WHERE id = $2 AND resource_id = $3
          RETURNING 
            available_capacity,
            EXTRACT(EPOCH FROM updated_at)::bigint as new_version
          `,
          [newCapacity, request.timeSlotId, request.resourceId]
        );

        const updated = updateResult.rows[0];

        logger.debug('Inventory updated successfully', {
          tenantId: request.tenantId,
          resourceId: request.resourceId,
          timeSlotId: request.timeSlotId,
          operation: request.operation,
          oldCapacity: current.available_capacity,
          newCapacity: updated.available_capacity,
          reason: request.reason
        });

        return {
          success: true,
          newVersion: updated.new_version,
          newCapacity: updated.available_capacity
        };

      } catch (error) {
        logger.error('Failed to update inventory', { request, error });
        return {
          success: false,
          newVersion: 0,
          newCapacity: 0,
          error: 'BUSINESS_RULE_VIOLATION',
          message: error.message
        };
      }
    });
  }

  /**
   * Bulk inventory update with proper lock ordering to prevent deadlocks
   */
  async bulkUpdateInventory(
    tenantId: string,
    updates: InventoryUpdateRequest[]
  ): Promise<InventoryUpdateResult[]> {
    if (updates.length === 0) {
      return [];
    }

    return this.executeWithDeadlockPrevention(async (ctx) => {
      // Sort updates by resource ID and then by timeSlotId to maintain consistent lock order
      const sortedUpdates = [...updates].sort((a, b) => {
        if (a.resourceId !== b.resourceId) {
          return a.resourceId.localeCompare(b.resourceId);
        }
        return a.timeSlotId.localeCompare(b.timeSlotId);
      });

      const results: InventoryUpdateResult[] = [];

      for (const update of sortedUpdates) {
        const result = await this.updateInventoryInTransaction(ctx, update);
        results.push(result);

        // Stop on first failure to maintain consistency
        if (!result.success) {
          logger.warn('Bulk inventory update stopped due to failure', {
            tenantId,
            failedUpdate: update,
            result
          });
          break;
        }
      }

      return results;
    });
  }

  /**
   * Get business hours for a resource
   */
  async getBusinessHours(tenantId: string, resourceId?: string): Promise<BusinessHoursEntity[]> {
    try {
      let whereClause = 'tenant_id = $1';
      const params: any[] = [tenantId];

      if (resourceId) {
        whereClause += ' AND (resource_id = $2 OR resource_id IS NULL)';
        params.push(resourceId);
      } else {
        whereClause += ' AND resource_id IS NULL';
      }

      const result = await db.queryForTenant<BusinessHoursEntity>(
        tenantId,
        `
        SELECT * FROM business_hours
        WHERE ${whereClause}
        ORDER BY day_of_week, open_time
        `,
        params
      );

      return result.rows;

    } catch (error) {
      logger.error('Failed to get business hours', { tenantId, resourceId, error });
      throw new InternalServerError('Failed to get business hours');
    }
  }

  /**
   * Get holidays for a resource
   */
  async getHolidays(
    tenantId: string, 
    startDate: Date, 
    endDate: Date,
    resourceId?: string
  ): Promise<HolidayEntity[]> {
    try {
      let whereClause = 'tenant_id = $1 AND date >= $2 AND date <= $3';
      const params: any[] = [tenantId, startDate, endDate];

      if (resourceId) {
        whereClause += ' AND (resource_id = $4 OR resource_id IS NULL)';
        params.push(resourceId);
      } else {
        whereClause += ' AND resource_id IS NULL';
      }

      const result = await db.queryForTenant<HolidayEntity>(
        tenantId,
        `
        SELECT * FROM holidays
        WHERE ${whereClause}
        ORDER BY date
        `,
        params
      );

      return result.rows;

    } catch (error) {
      logger.error('Failed to get holidays', { tenantId, resourceId, startDate, endDate, error });
      throw new InternalServerError('Failed to get holidays');
    }
  }

  /**
   * Get resource time-offs
   */
  async getResourceTimeOffs(
    tenantId: string,
    resourceId: string,
    startDate: Date,
    endDate: Date
  ): Promise<ResourceTimeOffEntity[]> {
    try {
      const result = await db.queryForTenant<ResourceTimeOffEntity>(
        tenantId,
        `
        SELECT * FROM resource_time_offs
        WHERE tenant_id = $1 
          AND resource_id = $2
          AND start_at <= $4
          AND end_at >= $3
        ORDER BY start_at
        `,
        [tenantId, resourceId, startDate, endDate]
      );

      return result.rows;

    } catch (error) {
      logger.error('Failed to get resource time-offs', { tenantId, resourceId, startDate, endDate, error });
      throw new InternalServerError('Failed to get resource time-offs');
    }
  }

  /**
   * Create time slots for a resource
   */
  async createTimeSlots(
    tenantId: string,
    resourceId: string,
    slots: Array<{
      startTime: Date;
      endTime: Date;
      capacity: number;
    }>
  ): Promise<TimeslotEntity[]> {
    return withTransaction(async (ctx) => {
      try {
        if (slots.length === 0) {
          return [];
        }

        // Prepare bulk insert data
        const insertData = slots.map(slot => ({
          tenant_id: tenantId,
          resource_id: resourceId,
          start_at: slot.startTime,
          end_at: slot.endTime,
          available_capacity: slot.capacity
        }));

        // Build bulk insert query
        const columns = Object.keys(insertData[0]);
        const values: any[] = [];
        const rowPlaceholders: string[] = [];

        insertData.forEach((row, index) => {
          const rowValues = Object.values(row);
          const placeholders = rowValues.map((_, valueIndex) => 
            `$${values.length + valueIndex + 1}`
          );
          
          rowPlaceholders.push(`(${placeholders.join(', ')})`);
          values.push(...rowValues);
        });

        const queryText = `
          INSERT INTO timeslots (${columns.join(', ')})
          VALUES ${rowPlaceholders.join(', ')}
          ON CONFLICT (tenant_id, resource_id, start_at, end_at) 
          DO UPDATE SET 
            available_capacity = EXCLUDED.available_capacity,
            updated_at = NOW()
          RETURNING *
        `;

        const result = await ctx.query<TimeslotEntity>(queryText, values);

        logger.debug('Time slots created successfully', {
          tenantId,
          resourceId,
          slotsCreated: result.rows.length
        });

        return result.rows;

      } catch (error) {
        logger.error('Failed to create time slots', { tenantId, resourceId, slots: slots.length, error });
        throw new InternalServerError('Failed to create time slots');
      }
    });
  }

  /**
   * Get slot utilization statistics
   */
  async getSlotUtilization(
    tenantId: string,
    resourceIds: string[],
    startDate: Date,
    endDate: Date
  ): Promise<{
    resourceId: string;
    totalSlots: number;
    bookedSlots: number;
    availableSlots: number;
    utilizationRate: number;
  }[]> {
    try {
      const resourcePlaceholders = resourceIds.map((_, index) => `$${index + 4}`).join(',');
      
      const result = await db.queryForTenant<any>(
        tenantId,
        `
        SELECT 
          t.resource_id,
          COUNT(*) as total_slots,
          SUM(CASE WHEN t.available_capacity = 0 THEN 1 ELSE 0 END) as booked_slots,
          SUM(CASE WHEN t.available_capacity > 0 THEN 1 ELSE 0 END) as available_slots,
          AVG(r.capacity - t.available_capacity) * 100.0 / AVG(r.capacity) as utilization_rate
        FROM timeslots t
        INNER JOIN resources r ON t.resource_id = r.id AND r.tenant_id = t.tenant_id
        WHERE t.tenant_id = $1 
          AND t.start_at >= $2 
          AND t.end_at <= $3
          AND t.resource_id IN (${resourcePlaceholders})
        GROUP BY t.resource_id
        ORDER BY t.resource_id
        `,
        [tenantId, startDate, endDate, ...resourceIds]
      );

      return result.rows.map(row => ({
        resourceId: row.resource_id.toString(),
        totalSlots: parseInt(row.total_slots),
        bookedSlots: parseInt(row.booked_slots),
        availableSlots: parseInt(row.available_slots),
        utilizationRate: parseFloat(row.utilization_rate) || 0
      }));

    } catch (error) {
      logger.error('Failed to get slot utilization', { tenantId, resourceIds, startDate, endDate, error });
      throw new InternalServerError('Failed to get slot utilization');
    }
  }

  /**
   * Clean up expired slots
   */
  async cleanupExpiredSlots(tenantId: string, beforeDate: Date): Promise<number> {
    return withTransaction(async (ctx) => {
      try {
        const result = await ctx.queryForTenant(
          tenantId,
          `
          DELETE FROM timeslots
          WHERE tenant_id = $1 AND end_at < $2
          `,
          [tenantId, beforeDate]
        );

        const deletedCount = result.rowCount || 0;

        logger.info('Expired slots cleaned up', {
          tenantId,
          beforeDate,
          deletedCount
        });

        return deletedCount;

      } catch (error) {
        logger.error('Failed to cleanup expired slots', { tenantId, beforeDate, error });
        throw new InternalServerError('Failed to cleanup expired slots');
      }
    });
  }

  // Private helper methods

  private async executeWithDeadlockPrevention<T>(
    operation: (ctx: TransactionContext) => Promise<T>
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= this.deadlockConfig.maxRetries; attempt++) {
      try {
        return await withTransaction(operation, {
          isolationLevel: 'READ COMMITTED',
          retryAttempts: 1, // We handle retries ourselves
          retryDelay: 0
        });
        
      } catch (error: any) {
        lastError = error;
        
        // Check if it's a retryable error (deadlock or serialization failure)
        if (this.isRetryableError(error) && attempt < this.deadlockConfig.maxRetries) {
          const backoffTime = this.deadlockConfig.backoffMs * Math.pow(2, attempt - 1);
          
          logger.warn(`Deadlock detected, retrying in ${backoffTime}ms`, {
            attempt,
            maxAttempts: this.deadlockConfig.maxRetries,
            error: error.message
          });
          
          await this.sleep(backoffTime);
          continue;
        }
        
        throw error;
      }
    }
    
    throw lastError!;
  }

  private async updateInventoryInTransaction(
    ctx: TransactionContext,
    request: InventoryUpdateRequest
  ): Promise<InventoryUpdateResult> {
    // This is similar to updateInventory but operates within an existing transaction
    try {
      const currentResult = await ctx.queryForTenant(
        request.tenantId,
        `
        SELECT 
          id, 
          available_capacity, 
          updated_at,
          EXTRACT(EPOCH FROM updated_at)::bigint as version_timestamp
        FROM timeslots
        WHERE id = $1 AND resource_id = $2
        FOR UPDATE
        `,
        [request.timeSlotId, request.resourceId]
      );

      if (currentResult.rows.length === 0) {
        return {
          success: false,
          newVersion: 0,
          newCapacity: 0,
          error: 'SLOT_NOT_FOUND',
          message: 'Time slot not found'
        };
      }

      const current = currentResult.rows[0];
      const currentVersion = current.version_timestamp;

      if (request.optimisticLock.version !== currentVersion) {
        return {
          success: false,
          newVersion: currentVersion,
          newCapacity: current.available_capacity,
          error: 'VERSION_MISMATCH',
          message: 'Resource was modified by another transaction'
        };
      }

      // Calculate new capacity
      let newCapacity: number;
      switch (request.operation) {
        case 'RESERVE':
          newCapacity = current.available_capacity - request.capacityChange;
          break;
        case 'RELEASE':
          newCapacity = current.available_capacity + request.capacityChange;
          break;
        case 'SET':
          newCapacity = request.capacityChange;
          break;
        default:
          throw new BadRequestError(`Invalid operation: ${request.operation}`);
      }

      if (newCapacity < 0) {
        return {
          success: false,
          newVersion: currentVersion,
          newCapacity: current.available_capacity,
          error: 'CAPACITY_EXCEEDED',
          message: 'Insufficient capacity available'
        };
      }

      const updateResult = await ctx.queryForTenant(
        request.tenantId,
        `
        UPDATE timeslots 
        SET 
          available_capacity = $1,
          updated_at = NOW()
        WHERE id = $2 AND resource_id = $3
        RETURNING 
          available_capacity,
          EXTRACT(EPOCH FROM updated_at)::bigint as new_version
        `,
        [newCapacity, request.timeSlotId, request.resourceId]
      );

      const updated = updateResult.rows[0];

      return {
        success: true,
        newVersion: updated.new_version,
        newCapacity: updated.available_capacity
      };

    } catch (error) {
      return {
        success: false,
        newVersion: 0,
        newCapacity: 0,
        error: 'BUSINESS_RULE_VIOLATION',
        message: error.message
      };
    }
  }

  private isRetryableError(error: any): boolean {
    const retryableCodes = ['40001', '40P01']; // Serialization failure, deadlock detected
    return error && error.code && retryableCodes.includes(error.code);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default AvailabilityRepository;