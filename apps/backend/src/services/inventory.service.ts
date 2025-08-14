/**
 * Inventory Management Service
 * Handles real-time inventory calculation, multi-resource coordination, 
 * cancellation inventory restoration, and prediction features
 */

import { FastifyInstance } from 'fastify';
import { 
  InventoryStatus,
  ResourceCapacity,
  InventoryUpdateRequest,
  InventoryUpdateResult,
  BatchAvailabilityRequest,
  BatchAvailabilityResult,
  InventoryStats,
  TimeSlot,
  OptimisticLock,
  SlotPerformanceMetrics
} from '../types/availability.js';
import { AvailabilityRepository } from '../repositories/availability.repository.js';
import { CacheService } from './cache.service.js';
import { withTransaction } from '../db/transaction.js';
import { logger } from '../config/logger.js';
import { InternalServerError, BadRequestError, NotFoundError } from '../utils/errors.js';

/**
 * Configuration for inventory predictions
 */
interface PredictionConfig {
  historicalDays: number;
  predictionHorizonDays: number;
  minimumDataPoints: number;
  confidenceThreshold: number;
}

/**
 * Inventory prediction result
 */
interface InventoryPrediction {
  resourceId: string;
  date: Date;
  predictedDemand: number;
  confidence: number;
  recommendedCapacity: number;
  factors: {
    historicalAverage: number;
    seasonalFactor: number;
    trendFactor: number;
    dayOfWeekFactor: number;
  };
}

/**
 * Inventory alert configuration
 */
interface InventoryAlert {
  resourceId: string;
  alertType: 'LOW_AVAILABILITY' | 'HIGH_DEMAND' | 'OVERBOOKED' | 'UNDERUTILIZED';
  threshold: number;
  currentValue: number;
  message: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  timestamp: Date;
}

/**
 * Advanced Inventory Management Service
 */
export class InventoryService {
  private repository: AvailabilityRepository;
  private cache: CacheService;
  private performanceMetrics: SlotPerformanceMetrics[] = [];
  private predictionConfig: PredictionConfig;

  constructor(private fastify: FastifyInstance) {
    this.repository = new AvailabilityRepository();
    this.cache = new CacheService(fastify, {
      defaultTTL: 60, // 1 minute for real-time inventory
      memory: {
        enabled: true,
        maxSize: 32 * 1024 * 1024, // 32MB
        maxItems: 2000,
        ttlRatio: 0.5 // Keep in memory for 50% of Redis TTL
      }
    });

    this.predictionConfig = {
      historicalDays: 30,
      predictionHorizonDays: 7,
      minimumDataPoints: 10,
      confidenceThreshold: 0.7
    };
  }

  /**
   * Get real-time inventory status for multiple resources
   */
  async getInventoryStatus(
    tenantId: string,
    resourceIds: string[],
    startDate: Date,
    endDate: Date
  ): Promise<InventoryStatus[]> {
    const startTime = Date.now();

    try {
      const cacheKey = `inventory_status:${tenantId}:${resourceIds.sort().join(',')}:${startDate.toISOString()}:${endDate.toISOString()}`;
      
      // Try cache first
      let inventoryStatuses = await this.cache.get<InventoryStatus[]>(cacheKey);
      if (inventoryStatuses) {
        this.recordPerformanceMetric('getInventoryStatus', Date.now() - startTime, inventoryStatuses.length, true, tenantId);
        return inventoryStatuses;
      }

      // Get real-time data
      const utilizationData = await this.repository.getSlotUtilization(
        tenantId,
        resourceIds,
        startDate,
        endDate
      );

      // Get detailed slot information
      const availableSlots = await this.repository.getAvailableSlots({
        tenantId,
        resourceIds,
        startDate,
        endDate
      });

      // Group slots by resource
      const slotsByResource = availableSlots.reduce((acc, slot) => {
        if (!acc[slot.resourceId]) {
          acc[slot.resourceId] = [];
        }
        acc[slot.resourceId].push(slot);
        return acc;
      }, {} as Record<string, TimeSlot[]>);

      // Build inventory status for each resource
      inventoryStatuses = resourceIds.map(resourceId => {
        const utilization = utilizationData.find(u => u.resourceId === resourceId);
        const resourceSlots = slotsByResource[resourceId] || [];
        
        const totalCapacity = resourceSlots.reduce((sum, slot) => sum + slot.capacity, 0);
        const availableCapacity = resourceSlots.reduce((sum, slot) => sum + slot.availableCapacity, 0);
        const bookedCapacity = totalCapacity - availableCapacity;

        return {
          tenantId,
          resourceId,
          timeSlots: resourceSlots,
          totalCapacity,
          availableCapacity,
          bookedCapacity,
          utilization: utilization?.utilizationRate || 0,
          lastUpdated: new Date()
        };
      });

      // Cache the result for a short time
      await this.cache.set(cacheKey, inventoryStatuses, 60); // 1 minute

      this.recordPerformanceMetric('getInventoryStatus', Date.now() - startTime, inventoryStatuses.length, false, tenantId);
      return inventoryStatuses;

    } catch (error) {
      logger.error('Failed to get inventory status', { tenantId, resourceIds, error });
      throw new InternalServerError('Failed to get inventory status');
    }
  }

  /**
   * Reserve capacity with atomic multi-resource coordination
   */
  async reserveCapacity(
    tenantId: string,
    reservations: Array<{
      resourceId: string;
      timeSlotId: string;
      capacity: number;
      customerId?: string;
      serviceId?: string;
    }>
  ): Promise<{ success: boolean; reservationIds: string[]; errors: string[] }> {
    const startTime = Date.now();

    if (reservations.length === 0) {
      return { success: true, reservationIds: [], errors: [] };
    }

    try {
      const result = await withTransaction(async (ctx) => {
        const reservationIds: string[] = [];
        const errors: string[] = [];

        // Sort reservations by resourceId and timeSlotId to prevent deadlocks
        const sortedReservations = [...reservations].sort((a, b) => {
          if (a.resourceId !== b.resourceId) {
            return a.resourceId.localeCompare(b.resourceId);
          }
          return a.timeSlotId.localeCompare(b.timeSlotId);
        });

        // Process each reservation
        for (const reservation of sortedReservations) {
          try {
            // Get current slot state with lock
            const slotResult = await ctx.queryForTenant(
              tenantId,
              `
              SELECT 
                id, 
                available_capacity,
                EXTRACT(EPOCH FROM updated_at)::bigint as version
              FROM timeslots
              WHERE id = $1 AND resource_id = $2
              FOR UPDATE
              `,
              [reservation.timeSlotId, reservation.resourceId]
            );

            if (slotResult.rows.length === 0) {
              errors.push(`Time slot ${reservation.timeSlotId} not found`);
              continue;
            }

            const slot = slotResult.rows[0];

            if (slot.available_capacity < reservation.capacity) {
              errors.push(`Insufficient capacity for slot ${reservation.timeSlotId}. Available: ${slot.available_capacity}, Required: ${reservation.capacity}`);
              continue;
            }

            // Reserve the capacity
            const updateRequest: InventoryUpdateRequest = {
              tenantId,
              resourceId: reservation.resourceId,
              timeSlotId: reservation.timeSlotId,
              capacityChange: reservation.capacity,
              operation: 'RESERVE',
              optimisticLock: {
                version: slot.version,
                lastModified: new Date()
              },
              reason: `Reservation for ${reservation.customerId || 'unknown customer'}`
            };

            const updateResult = await this.repository.updateInventory(updateRequest);

            if (!updateResult.success) {
              errors.push(`Failed to reserve capacity for slot ${reservation.timeSlotId}: ${updateResult.message}`);
              continue;
            }

            // Create reservation record
            const reservationResult = await ctx.queryForTenant(
              tenantId,
              `
              INSERT INTO reservations (tenant_id, resource_id, timeslot_id, customer_id, service_id, capacity, status, created_at)
              VALUES ($1, $2, $3, $4, $5, $6, 'CONFIRMED', NOW())
              RETURNING id
              `,
              [
                tenantId,
                reservation.resourceId,
                reservation.timeSlotId,
                reservation.customerId,
                reservation.serviceId,
                reservation.capacity
              ]
            );

            reservationIds.push(reservationResult.rows[0].id.toString());

          } catch (error) {
            logger.error('Failed to process individual reservation', { reservation, error });
            errors.push(`Failed to process reservation for slot ${reservation.timeSlotId}: ${error.message}`);
          }
        }

        // If any errors occurred, the transaction will rollback
        if (errors.length > 0) {
          throw new Error(`Reservation failed: ${errors.join('; ')}`);
        }

        return { success: true, reservationIds, errors: [] };
      });

      // Invalidate relevant cache entries
      await this.invalidateInventoryCache(tenantId, reservations.map(r => r.resourceId));

      this.recordPerformanceMetric('reserveCapacity', Date.now() - startTime, reservations.length, false, tenantId);
      return result;

    } catch (error) {
      logger.error('Failed to reserve capacity', { tenantId, reservations: reservations.length, error });
      return {
        success: false,
        reservationIds: [],
        errors: [error.message]
      };
    }
  }

  /**
   * Cancel reservations and restore inventory
   */
  async cancelReservations(
    tenantId: string,
    reservationIds: string[]
  ): Promise<{ success: boolean; cancelledCount: number; errors: string[] }> {
    const startTime = Date.now();

    if (reservationIds.length === 0) {
      return { success: true, cancelledCount: 0, errors: [] };
    }

    try {
      const result = await withTransaction(async (ctx) => {
        // Get reservation details
        const reservationsResult = await ctx.queryForTenant(
          tenantId,
          `
          SELECT 
            id,
            resource_id,
            timeslot_id,
            capacity,
            status
          FROM reservations
          WHERE id = ANY($1) AND status = 'CONFIRMED'
          FOR UPDATE
          `,
          [reservationIds]
        );

        const activeReservations = reservationsResult.rows;
        const errors: string[] = [];
        let cancelledCount = 0;

        // Group by timeslot for efficient updates
        const capacityUpdates = new Map<string, { resourceId: string; capacity: number }>();

        for (const reservation of activeReservations) {
          const key = reservation.timeslot_id;
          const existing = capacityUpdates.get(key);
          
          capacityUpdates.set(key, {
            resourceId: reservation.resource_id.toString(),
            capacity: (existing?.capacity || 0) + reservation.capacity
          });
        }

        // Release capacity for each timeslot
        for (const [timeSlotId, update] of capacityUpdates) {
          try {
            const releaseRequest: InventoryUpdateRequest = {
              tenantId,
              resourceId: update.resourceId,
              timeSlotId,
              capacityChange: update.capacity,
              operation: 'RELEASE',
              optimisticLock: {
                version: Date.now(), // Use current timestamp as version for releases
                lastModified: new Date()
              },
              reason: 'Reservation cancellation'
            };

            const releaseResult = await this.repository.updateInventory(releaseRequest);

            if (!releaseResult.success) {
              errors.push(`Failed to release capacity for slot ${timeSlotId}: ${releaseResult.message}`);
              continue;
            }

            cancelledCount += update.capacity;

          } catch (error) {
            logger.error('Failed to release capacity for slot', { timeSlotId, error });
            errors.push(`Failed to release capacity for slot ${timeSlotId}: ${error.message}`);
          }
        }

        // Mark reservations as cancelled
        if (activeReservations.length > 0) {
          await ctx.queryForTenant(
            tenantId,
            `
            UPDATE reservations
            SET 
              status = 'CANCELLED',
              cancelled_at = NOW(),
              updated_at = NOW()
            WHERE id = ANY($1)
            `,
            [activeReservations.map(r => r.id)]
          );
        }

        return {
          success: errors.length === 0,
          cancelledCount: activeReservations.length,
          errors
        };
      });

      // Invalidate cache for affected resources
      const resourceIds = await this.getResourceIdsFromReservations(tenantId, reservationIds);
      await this.invalidateInventoryCache(tenantId, resourceIds);

      this.recordPerformanceMetric('cancelReservations', Date.now() - startTime, reservationIds.length, false, tenantId);
      return result;

    } catch (error) {
      logger.error('Failed to cancel reservations', { tenantId, reservationIds, error });
      return {
        success: false,
        cancelledCount: 0,
        errors: [error.message]
      };
    }
  }

  /**
   * Predict inventory demand and generate recommendations
   */
  async predictInventoryDemand(
    tenantId: string,
    resourceIds: string[],
    predictionDate: Date
  ): Promise<InventoryPrediction[]> {
    const startTime = Date.now();

    try {
      const predictions: InventoryPrediction[] = [];

      for (const resourceId of resourceIds) {
        const prediction = await this.calculateResourcePrediction(tenantId, resourceId, predictionDate);
        if (prediction) {
          predictions.push(prediction);
        }
      }

      this.recordPerformanceMetric('predictInventoryDemand', Date.now() - startTime, predictions.length, false, tenantId);
      return predictions;

    } catch (error) {
      logger.error('Failed to predict inventory demand', { tenantId, resourceIds, predictionDate, error });
      throw new InternalServerError('Failed to predict inventory demand');
    }
  }

  /**
   * Generate inventory alerts based on thresholds and patterns
   */
  async generateInventoryAlerts(
    tenantId: string,
    resourceIds: string[],
    checkDate: Date = new Date()
  ): Promise<InventoryAlert[]> {
    const startTime = Date.now();

    try {
      const alerts: InventoryAlert[] = [];
      const endDate = new Date(checkDate.getTime() + 7 * 24 * 60 * 60 * 1000); // Next 7 days

      // Get current inventory status
      const inventoryStatuses = await this.getInventoryStatus(tenantId, resourceIds, checkDate, endDate);

      for (const status of inventoryStatuses) {
        // Low availability alert
        if (status.utilization > 85) {
          alerts.push({
            resourceId: status.resourceId,
            alertType: 'LOW_AVAILABILITY',
            threshold: 85,
            currentValue: status.utilization,
            message: `Resource ${status.resourceId} has high utilization (${status.utilization.toFixed(1)}%)`,
            severity: status.utilization > 95 ? 'CRITICAL' : 'HIGH',
            timestamp: new Date()
          });
        }

        // Underutilized alert
        if (status.utilization < 20 && status.totalCapacity > 0) {
          alerts.push({
            resourceId: status.resourceId,
            alertType: 'UNDERUTILIZED',
            threshold: 20,
            currentValue: status.utilization,
            message: `Resource ${status.resourceId} is underutilized (${status.utilization.toFixed(1)}%)`,
            severity: 'LOW',
            timestamp: new Date()
          });
        }

        // Check for overbooking
        if (status.bookedCapacity > status.totalCapacity) {
          alerts.push({
            resourceId: status.resourceId,
            alertType: 'OVERBOOKED',
            threshold: status.totalCapacity,
            currentValue: status.bookedCapacity,
            message: `Resource ${status.resourceId} is overbooked (${status.bookedCapacity}/${status.totalCapacity})`,
            severity: 'CRITICAL',
            timestamp: new Date()
          });
        }
      }

      // Get demand predictions for high-demand alerts
      const predictions = await this.predictInventoryDemand(tenantId, resourceIds, checkDate);
      for (const prediction of predictions) {
        if (prediction.predictedDemand > prediction.recommendedCapacity * 0.9 && prediction.confidence > 0.8) {
          alerts.push({
            resourceId: prediction.resourceId,
            alertType: 'HIGH_DEMAND',
            threshold: prediction.recommendedCapacity * 0.9,
            currentValue: prediction.predictedDemand,
            message: `High demand predicted for resource ${prediction.resourceId} (${prediction.predictedDemand} vs capacity ${prediction.recommendedCapacity})`,
            severity: 'MEDIUM',
            timestamp: new Date()
          });
        }
      }

      this.recordPerformanceMetric('generateInventoryAlerts', Date.now() - startTime, alerts.length, false, tenantId);
      return alerts;

    } catch (error) {
      logger.error('Failed to generate inventory alerts', { tenantId, resourceIds, error });
      throw new InternalServerError('Failed to generate inventory alerts');
    }
  }

  /**
   * Get comprehensive inventory statistics
   */
  async getInventoryStatistics(
    tenantId: string,
    resourceIds: string[],
    startDate: Date,
    endDate: Date
  ): Promise<InventoryStats[]> {
    const startTime = Date.now();

    try {
      const stats: InventoryStats[] = [];

      for (const resourceId of resourceIds) {
        const resourceStats = await this.calculateResourceStatistics(
          tenantId,
          resourceId,
          startDate,
          endDate
        );
        stats.push(resourceStats);
      }

      this.recordPerformanceMetric('getInventoryStatistics', Date.now() - startTime, stats.length, false, tenantId);
      return stats;

    } catch (error) {
      logger.error('Failed to get inventory statistics', { tenantId, resourceIds, startDate, endDate, error });
      throw new InternalServerError('Failed to get inventory statistics');
    }
  }

  /**
   * Batch process inventory updates
   */
  async batchUpdateInventory(
    tenantId: string,
    updates: InventoryUpdateRequest[]
  ): Promise<InventoryUpdateResult[]> {
    const startTime = Date.now();

    try {
      const results = await this.repository.bulkUpdateInventory(tenantId, updates);

      // Invalidate cache for affected resources
      const affectedResources = [...new Set(updates.map(u => u.resourceId))];
      await this.invalidateInventoryCache(tenantId, affectedResources);

      this.recordPerformanceMetric('batchUpdateInventory', Date.now() - startTime, updates.length, false, tenantId);
      return results;

    } catch (error) {
      logger.error('Failed to batch update inventory', { tenantId, updateCount: updates.length, error });
      throw new InternalServerError('Failed to batch update inventory');
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

  private async calculateResourcePrediction(
    tenantId: string,
    resourceId: string,
    predictionDate: Date
  ): Promise<InventoryPrediction | null> {
    try {
      const historicalStart = new Date(predictionDate.getTime() - this.predictionConfig.historicalDays * 24 * 60 * 60 * 1000);
      
      // Get historical utilization data
      const historicalData = await this.repository.getSlotUtilization(
        tenantId,
        [resourceId],
        historicalStart,
        predictionDate
      );

      if (historicalData.length === 0 || historicalData[0].totalSlots < this.predictionConfig.minimumDataPoints) {
        return null;
      }

      const utilization = historicalData[0];
      const historicalAverage = utilization.utilizationRate / 100;

      // Simple prediction algorithm (in production, use more sophisticated ML models)
      const dayOfWeek = predictionDate.getDay();
      const dayOfWeekFactor = this.getDayOfWeekFactor(dayOfWeek);
      const seasonalFactor = this.getSeasonalFactor(predictionDate);
      const trendFactor = 1.0; // Simplified - no trend analysis

      const predictedUtilization = historicalAverage * dayOfWeekFactor * seasonalFactor * trendFactor;
      const predictedDemand = Math.round(predictedUtilization * utilization.totalSlots);
      
      const confidence = Math.min(0.9, Math.max(0.1, 
        historicalData[0].totalSlots / this.predictionConfig.minimumDataPoints * 0.1 + 0.5
      ));

      return {
        resourceId,
        date: predictionDate,
        predictedDemand,
        confidence,
        recommendedCapacity: Math.ceil(predictedDemand * 1.2), // 20% buffer
        factors: {
          historicalAverage,
          seasonalFactor,
          trendFactor,
          dayOfWeekFactor
        }
      };

    } catch (error) {
      logger.error('Failed to calculate resource prediction', { tenantId, resourceId, predictionDate, error });
      return null;
    }
  }

  private getDayOfWeekFactor(dayOfWeek: number): number {
    // Simple day-of-week factors (0=Sunday, 1=Monday, etc.)
    const factors = [0.8, 1.2, 1.1, 1.1, 1.1, 1.3, 0.9]; // Weekend lower, Friday higher
    return factors[dayOfWeek] || 1.0;
  }

  private getSeasonalFactor(date: Date): number {
    // Simple seasonal adjustment based on month
    const month = date.getMonth(); // 0=January
    const seasonalFactors = [0.9, 0.9, 1.0, 1.1, 1.2, 1.3, 1.3, 1.2, 1.1, 1.0, 0.9, 0.8];
    return seasonalFactors[month] || 1.0;
  }

  private async calculateResourceStatistics(
    tenantId: string,
    resourceId: string,
    startDate: Date,
    endDate: Date
  ): Promise<InventoryStats> {
    const utilization = await this.repository.getSlotUtilization(
      tenantId,
      [resourceId],
      startDate,
      endDate
    );

    const stats = utilization[0] || {
      resourceId,
      totalSlots: 0,
      bookedSlots: 0,
      availableSlots: 0,
      utilizationRate: 0
    };

    return {
      tenantId,
      resourceId,
      period: { startDate, endDate },
      totalSlots: stats.totalSlots,
      availableSlots: stats.availableSlots,
      bookedSlots: stats.bookedSlots,
      utilizationRate: stats.utilizationRate,
      peakUtilization: stats.utilizationRate, // Simplified
      averageBookingDuration: 0, // TODO: Calculate from booking data
      popularTimeSlots: [] // TODO: Implement popular time slots analysis
    };
  }

  private async getResourceIdsFromReservations(
    tenantId: string,
    reservationIds: string[]
  ): Promise<string[]> {
    try {
      const result = await this.fastify.db.queryForTenant<{ resource_id: string }>(
        tenantId,
        'SELECT DISTINCT resource_id FROM reservations WHERE id = ANY($1)',
        [reservationIds]
      );

      return result.rows.map(row => row.resource_id.toString());

    } catch (error) {
      logger.error('Failed to get resource IDs from reservations', { tenantId, reservationIds, error });
      return [];
    }
  }

  private async invalidateInventoryCache(tenantId: string, resourceIds: string[]): Promise<void> {
    try {
      const patterns = [
        `inventory_status:${tenantId}:*`,
        ...resourceIds.map(id => `inventory_status:${tenantId}:*${id}*`)
      ];

      for (const pattern of patterns) {
        await this.cache.deleteByPattern(pattern);
      }

    } catch (error) {
      logger.warn('Failed to invalidate inventory cache', { tenantId, resourceIds, error });
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
    if (duration > 2000) { // More than 2 seconds
      logger.warn('Slow inventory operation detected', metric);
    }
  }
}

export default InventoryService;