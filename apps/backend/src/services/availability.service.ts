/**
 * Availability Service
 * Handles complex availability searches, cross-resource coordination,
 * optimal time slot suggestions, congestion calculations, and calendar views
 */

import { FastifyInstance } from 'fastify';
import { 
  AvailabilityQuery,
  TimeSlot,
  SlotGranularity,
  InventoryStats,
  BatchAvailabilityRequest,
  BatchAvailabilityResult,
  BusinessHours,
  Holiday,
  ResourceTimeOff
} from '../types/availability.js';
import { 
  CalendarUtils, 
  CalendarMonth, 
  CalendarWeek, 
  CalendarDay,
  CalendarStaticUtils,
  CalendarView 
} from '../utils/calendar.js';
import { SlotService } from './slot.service.js';
import { InventoryService } from './inventory.service.js';
import { CacheService } from './cache.service.js';
import { AvailabilityRepository } from '../repositories/availability.repository.js';
import { CacheKeyUtils, CacheNamespace, CacheTTL } from '../utils/cache-keys.js';
import { logger } from '../config/logger.js';
import { InternalServerError, BadRequestError, NotFoundError } from '../utils/errors.js';

/**
 * Optimal time slot suggestion
 */
export interface OptimalTimeSlot {
  startTime: Date;
  endTime: Date;
  resourceId: string;
  availableCapacity: number;
  score: number; // 0-100, higher is better
  reasons: string[];
  alternatives?: OptimalTimeSlot[];
}

/**
 * Congestion level calculation
 */
export interface CongestionLevel {
  resourceId: string;
  timeSlot: TimeSlot;
  level: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  score: number; // 0-100, higher is more congested
  factors: {
    utilizationRate: number;
    demandTrend: number;
    seasonalFactor: number;
    timeOfDayFactor: number;
  };
}

/**
 * Cross-resource availability result
 */
export interface CrossResourceAvailability {
  combinedAvailability: TimeSlot[];
  resourceBreakdown: Record<string, {
    available: boolean;
    slots: TimeSlot[];
    utilizationRate: number;
    nextAvailable?: Date;
  }>;
  optimalCombinations: Array<{
    resources: string[];
    timeSlot: TimeSlot;
    totalCapacity: number;
    combinedScore: number;
  }>;
}

/**
 * Performance metrics for availability operations
 */
interface AvailabilityMetrics {
  operation: string;
  duration: number;
  resourceCount: number;
  slotCount: number;
  cacheHit: boolean;
  timestamp: Date;
  tenantId: string;
}

/**
 * Availability Service Implementation
 */
export class AvailabilityService {
  private slotService: SlotService;
  private inventoryService: InventoryService;
  private cache: CacheService;
  private repository: AvailabilityRepository;
  private calendarUtils: CalendarUtils;
  private performanceMetrics: AvailabilityMetrics[] = [];

  constructor(private fastify: FastifyInstance) {
    this.slotService = new SlotService(fastify);
    this.inventoryService = new InventoryService(fastify);
    this.repository = new AvailabilityRepository();
    this.cache = new CacheService(fastify, {
      defaultTTL: CacheTTL.MINUTE_5,
      memory: {
        enabled: true,
        maxSize: 128 * 1024 * 1024, // 128MB
        maxItems: 10000,
        ttlRatio: 0.3
      }
    });
    this.calendarUtils = new CalendarUtils();
  }

  /**
   * Complex availability search with cross-resource coordination
   */
  async searchAvailability(query: AvailabilityQuery): Promise<{
    slots: TimeSlot[];
    totalCount: number;
    availableCount: number;
    resourceCounts: Record<string, number>;
    optimalSuggestions: OptimalTimeSlot[];
    congestionLevels: CongestionLevel[];
  }> {
    const startTime = Date.now();

    try {
      // Validate and normalize query
      const normalizedQuery = this.normalizeAvailabilityQuery(query);
      
      // Generate cache key
      const cacheKey = CacheKeyUtils.generateAvailability(
        normalizedQuery.tenantId,
        normalizedQuery.resourceIds.join(','),
        normalizedQuery.startDate,
        normalizedQuery.endDate,
        normalizedQuery.duration?.toString() || 'any'
      );

      // Try cache first
      let result = await this.cache.get<any>(cacheKey);
      if (result) {
        this.recordMetrics('searchAvailability', Date.now() - startTime, 
          normalizedQuery.resourceIds.length, result.slots.length, true, normalizedQuery.tenantId);
        return result;
      }

      // Get available slots from slot service
      const availableSlots = await this.slotService.getAvailableSlots(normalizedQuery);

      // Calculate resource counts
      const resourceCounts: Record<string, number> = {};
      for (const resourceId of normalizedQuery.resourceIds) {
        resourceCounts[resourceId] = availableSlots.filter(slot => 
          slot.resourceId === resourceId
        ).length;
      }

      // Generate optimal suggestions
      const optimalSuggestions = await this.generateOptimalSuggestions(
        normalizedQuery,
        availableSlots
      );

      // Calculate congestion levels
      const congestionLevels = await this.calculateCongestionLevels(
        normalizedQuery.tenantId,
        availableSlots
      );

      result = {
        slots: availableSlots,
        totalCount: availableSlots.length,
        availableCount: availableSlots.filter(slot => slot.isAvailable).length,
        resourceCounts,
        optimalSuggestions,
        congestionLevels
      };

      // Cache the result
      await this.cache.set(
        cacheKey, 
        result, 
        CacheTTL.MINUTE_2,
        {
          namespace: CacheNamespace.AVAILABILITY,
          compress: true
        }
      );

      this.recordMetrics('searchAvailability', Date.now() - startTime, 
        normalizedQuery.resourceIds.length, result.slots.length, false, normalizedQuery.tenantId);

      return result;

    } catch (error) {
      logger.error('Failed to search availability', { query, error });
      throw new InternalServerError('Failed to search availability');
    }
  }

  /**
   * Get slots for a specific date and resource
   */
  async getSlots(
    tenantId: string,
    resourceId: string,
    date: Date,
    granularity: SlotGranularity = 15,
    requiredCapacity?: number
  ): Promise<{
    resourceId: string;
    date: Date;
    slots: TimeSlot[];
    businessHours: BusinessHours[];
    holidays: Holiday[];
    totalCapacity: number;
    availableCapacity: number;
  }> {
    const startTime = Date.now();

    try {
      const cacheKey = CacheKeyUtils.generateSlots(
        tenantId,
        resourceId,
        date,
        granularity
      );

      // Try cache first
      let result = await this.cache.get<any>(cacheKey);
      if (result) {
        this.recordMetrics('getSlots', Date.now() - startTime, 1, result.slots.length, true, tenantId);
        return result;
      }

      // Get slots from slot service
      const endDate = new Date(date.getTime() + 24 * 60 * 60 * 1000); // Next day
      const slots = await this.slotService.getAvailableSlots({
        tenantId,
        resourceIds: [resourceId],
        startDate: date,
        endDate,
        granularity,
        capacity: requiredCapacity
      });

      // Get business hours and holidays
      const businessHours = await this.getBusinessHours(tenantId, resourceId);
      const holidays = await this.getHolidays(tenantId, date, endDate);

      const totalCapacity = slots.reduce((sum, slot) => sum + slot.capacity, 0);
      const availableCapacity = slots.reduce((sum, slot) => sum + slot.availableCapacity, 0);

      result = {
        resourceId,
        date,
        slots,
        businessHours,
        holidays,
        totalCapacity,
        availableCapacity
      };

      // Cache the result
      await this.cache.set(
        cacheKey,
        result,
        CacheTTL.MINUTE_5,
        {
          namespace: CacheNamespace.SLOTS,
          compress: true
        }
      );

      this.recordMetrics('getSlots', Date.now() - startTime, 1, result.slots.length, false, tenantId);
      return result;

    } catch (error) {
      logger.error('Failed to get slots', { tenantId, resourceId, date, error });
      throw new InternalServerError('Failed to get slots');
    }
  }

  /**
   * Generate calendar view with availability data
   */
  async generateCalendarView(
    tenantId: string,
    resourceIds: string[],
    year: number,
    month: number,
    view: CalendarView = 'month'
  ): Promise<CalendarMonth | CalendarWeek | CalendarDay> {
    const startTime = Date.now();

    try {
      const cacheKey = CalendarStaticUtils.generateCacheKey(view, new Date(year, month - 1), resourceIds, tenantId);
      
      // Try cache first
      let result = await this.cache.get<any>(cacheKey);
      if (result) {
        this.recordMetrics('generateCalendarView', Date.now() - startTime, resourceIds.length, 0, true, tenantId);
        return result;
      }

      let startDate: Date, endDate: Date;

      if (view === 'month') {
        startDate = new Date(year, month - 1, 1);
        endDate = new Date(year, month, 0);
      } else if (view === 'week') {
        const date = new Date(year, month - 1, 1);
        const day = date.getDay();
        const diff = date.getDate() - day;
        startDate = new Date(date.setDate(diff));
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate.getTime() + 6 * 24 * 60 * 60 * 1000);
      } else {
        startDate = new Date(year, month - 1, 1);
        endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
      }

      // Get time slots for the period
      const timeSlots = await this.slotService.getAvailableSlots({
        tenantId,
        resourceIds,
        startDate,
        endDate
      });

      // Generate calendar view
      if (view === 'month') {
        result = this.calendarUtils.generateMonthlyCalendar(year, month, timeSlots, resourceIds);
      } else if (view === 'week') {
        result = this.calendarUtils.generateWeeklyCalendar(startDate, timeSlots);
      } else {
        result = this.calendarUtils.generateDailyCalendar(startDate, timeSlots);
      }

      // Cache the result
      await this.cache.set(
        cacheKey,
        result,
        CacheTTL.MINUTE_10,
        {
          namespace: CacheNamespace.CALENDAR,
          compress: true
        }
      );

      this.recordMetrics('generateCalendarView', Date.now() - startTime, resourceIds.length, timeSlots.length, false, tenantId);
      return result;

    } catch (error) {
      logger.error('Failed to generate calendar view', { tenantId, resourceIds, year, month, view, error });
      throw new InternalServerError('Failed to generate calendar view');
    }
  }

  /**
   * Get resource-specific availability with upcoming bookings
   */
  async getResourceAvailability(
    tenantId: string,
    resourceId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    resourceId: string;
    resourceName: string;
    resourceType: string;
    totalCapacity: number;
    currentUtilization: number;
    nextAvailableSlot?: {
      startTime: Date;
      endTime: Date;
      availableCapacity: number;
    };
    upcomingBookings: Array<{
      startTime: Date;
      endTime: Date;
      bookedCapacity: number;
      customerId?: string;
      serviceId?: string;
    }>;
    dailyStats: Array<{
      date: Date;
      totalSlots: number;
      bookedSlots: number;
      utilization: number;
    }>;
  }> {
    const startTime = Date.now();

    try {
      const cacheKey = CacheKeyUtils.generateResourceAvailability(tenantId, resourceId, startDate, endDate);
      
      // Try cache first
      let result = await this.cache.get<any>(cacheKey);
      if (result) {
        this.recordMetrics('getResourceAvailability', Date.now() - startTime, 1, 0, true, tenantId);
        return result;
      }

      // Get resource details
      const resourceDetails = await this.getResourceDetails(tenantId, resourceId);
      
      // Get availability slots
      const slots = await this.slotService.getAvailableSlots({
        tenantId,
        resourceIds: [resourceId],
        startDate,
        endDate
      });

      // Calculate utilization
      const totalCapacity = slots.reduce((sum, slot) => sum + slot.capacity, 0);
      const bookedCapacity = slots.reduce((sum, slot) => sum + slot.bookedCount, 0);
      const currentUtilization = totalCapacity > 0 ? (bookedCapacity / totalCapacity) * 100 : 0;

      // Find next available slot
      const now = new Date();
      const nextAvailable = slots
        .filter(slot => slot.startTime > now && slot.isAvailable)
        .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())[0];

      const nextAvailableSlot = nextAvailable ? {
        startTime: nextAvailable.startTime,
        endTime: nextAvailable.endTime,
        availableCapacity: nextAvailable.availableCapacity
      } : undefined;

      // Get upcoming bookings
      const upcomingBookings = await this.getUpcomingBookings(tenantId, resourceId, startDate, endDate);

      // Calculate daily stats
      const dailyStats = this.calculateDailyStats(slots);

      result = {
        resourceId,
        resourceName: resourceDetails.name,
        resourceType: resourceDetails.type,
        totalCapacity,
        currentUtilization,
        nextAvailableSlot,
        upcomingBookings,
        dailyStats
      };

      // Cache the result
      await this.cache.set(
        cacheKey,
        result,
        CacheTTL.MINUTE_3,
        {
          namespace: CacheNamespace.RESOURCE_AVAILABILITY,
          compress: true
        }
      );

      this.recordMetrics('getResourceAvailability', Date.now() - startTime, 1, slots.length, false, tenantId);
      return result;

    } catch (error) {
      logger.error('Failed to get resource availability', { tenantId, resourceId, error });
      throw new InternalServerError('Failed to get resource availability');
    }
  }

  /**
   * Batch availability check for multiple resources
   */
  async checkBatchAvailability(
    tenantId: string,
    requests: BatchAvailabilityRequest['requests']
  ): Promise<{
    results: Array<{
      resourceId: string;
      available: boolean;
      availableCapacity: number;
      conflictReason?: string;
      alternativeSlots?: Array<{
        startTime: Date;
        endTime: Date;
        availableCapacity: number;
      }>;
    }>;
    timestamp: Date;
    totalRequests: number;
    successfulRequests: number;
  }> {
    const startTime = Date.now();

    try {
      const results = await Promise.all(
        requests.map(async (request) => {
          try {
            const slots = await this.slotService.getAvailableSlots({
              tenantId,
              resourceIds: [request.resourceId],
              startDate: request.startTime,
              endDate: request.endTime,
              capacity: request.requiredCapacity
            });

            const totalAvailableCapacity = slots.reduce((sum, slot) => sum + slot.availableCapacity, 0);
            const available = totalAvailableCapacity >= request.requiredCapacity;

            let alternativeSlots: Array<{
              startTime: Date;
              endTime: Date;
              availableCapacity: number;
            }> | undefined;

            if (!available) {
              // Find alternative slots in nearby time ranges
              const alternativeStartDate = new Date(request.startTime.getTime() - 2 * 60 * 60 * 1000); // 2 hours before
              const alternativeEndDate = new Date(request.endTime.getTime() + 2 * 60 * 60 * 1000); // 2 hours after
              
              const alternativeSlotsList = await this.slotService.getAvailableSlots({
                tenantId,
                resourceIds: [request.resourceId],
                startDate: alternativeStartDate,
                endDate: alternativeEndDate,
                capacity: request.requiredCapacity
              });

              alternativeSlots = alternativeSlotsList
                .filter(slot => slot.availableCapacity >= request.requiredCapacity)
                .slice(0, 3) // Top 3 alternatives
                .map(slot => ({
                  startTime: slot.startTime,
                  endTime: slot.endTime,
                  availableCapacity: slot.availableCapacity
                }));
            }

            return {
              resourceId: request.resourceId,
              available,
              availableCapacity: totalAvailableCapacity,
              conflictReason: available ? undefined : 'Insufficient capacity',
              alternativeSlots
            };

          } catch (error) {
            logger.error('Failed to check availability for resource', { request, error });
            return {
              resourceId: request.resourceId,
              available: false,
              availableCapacity: 0,
              conflictReason: error.message
            };
          }
        })
      );

      const successfulRequests = results.filter(r => r.available).length;

      this.recordMetrics('checkBatchAvailability', Date.now() - startTime, results.length, 0, false, tenantId);

      return {
        results,
        timestamp: new Date(),
        totalRequests: requests.length,
        successfulRequests
      };

    } catch (error) {
      logger.error('Failed to check batch availability', { tenantId, requestCount: requests.length, error });
      throw new InternalServerError('Failed to check batch availability');
    }
  }

  /**
   * Generate optimal time slot suggestions
   */
  private async generateOptimalSuggestions(
    query: AvailabilityQuery,
    availableSlots: TimeSlot[]
  ): Promise<OptimalTimeSlot[]> {
    const suggestions: OptimalTimeSlot[] = [];

    // Group slots by time range
    const slotGroups = this.groupSlotsByTimeRange(availableSlots, query.duration || 60);

    for (const [timeRange, slots] of slotGroups) {
      for (const resourceId of query.resourceIds) {
        const resourceSlots = slots.filter(slot => slot.resourceId === resourceId);
        
        if (resourceSlots.length === 0) continue;

        const totalCapacity = resourceSlots.reduce((sum, slot) => sum + slot.availableCapacity, 0);
        const avgUtilization = resourceSlots.reduce((sum, slot) => 
          sum + ((slot.capacity - slot.availableCapacity) / slot.capacity * 100), 0
        ) / resourceSlots.length;

        // Calculate score based on multiple factors
        let score = 100;
        const reasons: string[] = [];

        // Factor 1: Available capacity (higher is better)
        if (totalCapacity >= (query.capacity || 1) * 2) {
          score += 10;
          reasons.push('Ample capacity available');
        } else if (totalCapacity < (query.capacity || 1)) {
          score -= 20;
          reasons.push('Limited capacity');
        }

        // Factor 2: Utilization (moderate is better)
        if (avgUtilization >= 50 && avgUtilization <= 70) {
          score += 5;
          reasons.push('Optimal utilization level');
        } else if (avgUtilization > 90) {
          score -= 15;
          reasons.push('High utilization');
        }

        // Factor 3: Time of day preferences
        const hour = resourceSlots[0].startTime.getHours();
        if (hour >= 9 && hour <= 11) {
          score += 8;
          reasons.push('Popular morning slot');
        } else if (hour >= 14 && hour <= 16) {
          score += 5;
          reasons.push('Good afternoon slot');
        }

        if (score >= 70) { // Only include high-scoring suggestions
          suggestions.push({
            startTime: resourceSlots[0].startTime,
            endTime: resourceSlots[resourceSlots.length - 1].endTime,
            resourceId,
            availableCapacity: totalCapacity,
            score: Math.min(100, score),
            reasons
          });
        }
      }
    }

    // Sort by score and return top suggestions
    return suggestions
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  /**
   * Calculate congestion levels for time slots
   */
  private async calculateCongestionLevels(
    tenantId: string,
    timeSlots: TimeSlot[]
  ): Promise<CongestionLevel[]> {
    const congestionLevels: CongestionLevel[] = [];

    for (const slot of timeSlots.slice(0, 20)) { // Limit to first 20 slots for performance
      const utilizationRate = ((slot.capacity - slot.availableCapacity) / slot.capacity) * 100;
      
      // Simple congestion calculation (in production, use more sophisticated algorithms)
      const hour = slot.startTime.getHours();
      const dayOfWeek = slot.startTime.getDay();
      
      const timeOfDayFactor = this.getTimeOfDayFactor(hour);
      const seasonalFactor = this.getSeasonalFactor(slot.startTime);
      const demandTrend = 1.0; // Simplified - would calculate from historical data
      
      const congestionScore = Math.min(100, 
        utilizationRate * 0.4 + 
        timeOfDayFactor * 20 + 
        seasonalFactor * 20 + 
        demandTrend * 20
      );

      let level: CongestionLevel['level'];
      if (congestionScore < 25) level = 'LOW';
      else if (congestionScore < 50) level = 'MODERATE';
      else if (congestionScore < 75) level = 'HIGH';
      else level = 'CRITICAL';

      congestionLevels.push({
        resourceId: slot.resourceId,
        timeSlot: slot,
        level,
        score: congestionScore,
        factors: {
          utilizationRate,
          demandTrend,
          seasonalFactor,
          timeOfDayFactor
        }
      });
    }

    return congestionLevels;
  }

  // Helper methods

  private normalizeAvailabilityQuery(query: AvailabilityQuery): AvailabilityQuery {
    // Validate date range
    if (query.startDate >= query.endDate) {
      throw new BadRequestError('Start date must be before end date');
    }

    // Limit resource count
    if (query.resourceIds.length > 20) {
      throw new BadRequestError('Maximum 20 resources allowed per query');
    }

    // Set default granularity
    return {
      ...query,
      granularity: query.granularity || 15
    };
  }

  private groupSlotsByTimeRange(
    slots: TimeSlot[], 
    durationMinutes: number
  ): Map<string, TimeSlot[]> {
    const groups = new Map<string, TimeSlot[]>();
    
    for (const slot of slots) {
      const rangeStart = new Date(slot.startTime);
      rangeStart.setMinutes(Math.floor(rangeStart.getMinutes() / durationMinutes) * durationMinutes);
      
      const key = rangeStart.toISOString();
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(slot);
    }

    return groups;
  }

  private getTimeOfDayFactor(hour: number): number {
    // Peak hours have higher congestion factor
    if (hour >= 9 && hour <= 11) return 1.2; // Morning peak
    if (hour >= 14 && hour <= 16) return 1.1; // Afternoon peak
    if (hour >= 18 && hour <= 20) return 1.3; // Evening peak
    return 0.8; // Off-peak
  }

  private getSeasonalFactor(date: Date): number {
    const month = date.getMonth();
    // Summer months tend to be busier
    if (month >= 5 && month <= 8) return 1.2;
    // Winter months are quieter
    if (month >= 11 || month <= 2) return 0.9;
    return 1.0;
  }

  private async getBusinessHours(tenantId: string, resourceId?: string): Promise<BusinessHours[]> {
    try {
      const result = await this.fastify.db.queryForTenant<any>(
        tenantId,
        `
        SELECT 
          id,
          resource_id,
          day_of_week,
          open_time,
          close_time,
          effective_from,
          effective_to
        FROM business_hours 
        WHERE (resource_id IS NULL OR resource_id = $1)
        ORDER BY day_of_week, open_time
        `,
        [resourceId]
      );

      return result.rows.map(row => ({
        id: row.id.toString(),
        tenantId,
        resourceId: row.resource_id?.toString(),
        dayOfWeek: row.day_of_week,
        openTime: row.open_time,
        closeTime: row.close_time,
        effectiveFrom: row.effective_from,
        effectiveTo: row.effective_to
      }));
    } catch (error) {
      logger.error('Failed to get business hours', { tenantId, resourceId, error });
      return [];
    }
  }

  private async getHolidays(tenantId: string, startDate: Date, endDate: Date): Promise<Holiday[]> {
    try {
      const result = await this.fastify.db.queryForTenant<any>(
        tenantId,
        `
        SELECT id, resource_id, date, name
        FROM holidays 
        WHERE date >= $1 AND date <= $2
        ORDER BY date
        `,
        [startDate, endDate]
      );

      return result.rows.map(row => ({
        id: row.id.toString(),
        tenantId,
        resourceId: row.resource_id?.toString(),
        date: row.date,
        name: row.name
      }));
    } catch (error) {
      logger.error('Failed to get holidays', { tenantId, startDate, endDate, error });
      return [];
    }
  }

  private async getResourceDetails(tenantId: string, resourceId: string): Promise<{
    name: string;
    type: string;
  }> {
    try {
      const result = await this.fastify.db.queryForTenant<any>(
        tenantId,
        'SELECT name, resource_type FROM resources WHERE id = $1',
        [resourceId]
      );

      if (result.rows.length === 0) {
        throw new NotFoundError(`Resource ${resourceId} not found`);
      }

      return {
        name: result.rows[0].name,
        type: result.rows[0].resource_type
      };
    } catch (error) {
      logger.error('Failed to get resource details', { tenantId, resourceId, error });
      return { name: 'Unknown', type: 'Unknown' };
    }
  }

  private async getUpcomingBookings(
    tenantId: string,
    resourceId: string,
    startDate: Date,
    endDate: Date
  ): Promise<Array<{
    startTime: Date;
    endTime: Date;
    bookedCapacity: number;
    customerId?: string;
    serviceId?: string;
  }>> {
    try {
      const result = await this.fastify.db.queryForTenant<any>(
        tenantId,
        `
        SELECT 
          b.start_at,
          b.end_at,
          b.capacity as booked_capacity,
          b.customer_id,
          b.service_id
        FROM bookings b
        WHERE b.resource_id = $1 
          AND b.start_at >= $2 
          AND b.end_at <= $3
          AND b.status = 'confirmed'
        ORDER BY b.start_at
        `,
        [resourceId, startDate, endDate]
      );

      return result.rows.map(row => ({
        startTime: row.start_at,
        endTime: row.end_at,
        bookedCapacity: row.booked_capacity,
        customerId: row.customer_id?.toString(),
        serviceId: row.service_id?.toString()
      }));
    } catch (error) {
      logger.error('Failed to get upcoming bookings', { tenantId, resourceId, error });
      return [];
    }
  }

  private calculateDailyStats(slots: TimeSlot[]): Array<{
    date: Date;
    totalSlots: number;
    bookedSlots: number;
    utilization: number;
  }> {
    const dailyMap = new Map<string, {
      totalSlots: number;
      bookedSlots: number;
    }>();

    for (const slot of slots) {
      const dateKey = slot.startTime.toISOString().split('T')[0];
      const existing = dailyMap.get(dateKey) || { totalSlots: 0, bookedSlots: 0 };
      
      existing.totalSlots++;
      if (!slot.isAvailable) {
        existing.bookedSlots++;
      }
      
      dailyMap.set(dateKey, existing);
    }

    return Array.from(dailyMap.entries()).map(([dateKey, stats]) => ({
      date: new Date(dateKey),
      totalSlots: stats.totalSlots,
      bookedSlots: stats.bookedSlots,
      utilization: stats.totalSlots > 0 ? (stats.bookedSlots / stats.totalSlots) * 100 : 0
    }));
  }

  private recordMetrics(
    operation: string,
    duration: number,
    resourceCount: number,
    slotCount: number,
    cacheHit: boolean,
    tenantId: string
  ): void {
    const metric: AvailabilityMetrics = {
      operation,
      duration,
      resourceCount,
      slotCount,
      cacheHit,
      timestamp: new Date(),
      tenantId
    };

    this.performanceMetrics.push(metric);

    // Keep only last 1000 metrics
    if (this.performanceMetrics.length > 1000) {
      this.performanceMetrics = this.performanceMetrics.slice(-1000);
    }

    // Log slow operations
    if (duration > 1000) {
      logger.warn('Slow availability operation detected', metric);
    }
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): AvailabilityMetrics[] {
    return [...this.performanceMetrics];
  }

  /**
   * Clear performance metrics
   */
  clearPerformanceMetrics(): void {
    this.performanceMetrics = [];
  }
}

export default AvailabilityService;