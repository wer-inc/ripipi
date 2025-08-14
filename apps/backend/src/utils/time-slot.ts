/**
 * Time Slot Utilities
 * Provides utilities for 5-minute/15-minute slot calculations and validation
 */

import { 
  SlotGranularity, 
  SlotBoundary, 
  ContinuousSlotRequirement, 
  SlotAdjustment,
  BusinessHours,
  Holiday,
  ResourceTimeOff,
  SlotValidationResult
} from '../types/availability.js';

/**
 * Time slot calculation utilities
 */
export class TimeSlotUtils {
  /**
   * Round time to slot boundary (5 or 15 minutes)
   */
  static roundToSlotBoundary(date: Date, granularity: SlotGranularity, direction: 'up' | 'down' = 'up'): Date {
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();
    const milliseconds = date.getMilliseconds();
    
    // Calculate the current minute offset within the granularity
    const offset = minutes % granularity;
    
    const rounded = new Date(date);
    
    // Clear seconds and milliseconds
    rounded.setSeconds(0, 0);
    
    if (offset === 0 && seconds === 0 && milliseconds === 0) {
      // Already at boundary
      return rounded;
    }
    
    if (direction === 'up') {
      // Round up to next slot boundary
      const minutesToAdd = granularity - offset;
      rounded.setMinutes(minutes + minutesToAdd);
    } else {
      // Round down to previous slot boundary
      rounded.setMinutes(minutes - offset);
    }
    
    return rounded;
  }

  /**
   * Calculate slot boundaries for a booking request
   */
  static calculateSlotBoundary(
    startTime: Date, 
    duration: number, 
    granularity: SlotGranularity
  ): SlotBoundary {
    const originalStart = new Date(startTime);
    const originalEnd = new Date(startTime.getTime() + duration * 60 * 1000);
    
    // Round start time up to next slot boundary
    const alignedStart = this.roundToSlotBoundary(originalStart, granularity, 'up');
    
    // Calculate aligned end time
    const alignedEnd = new Date(alignedStart.getTime() + duration * 60 * 1000);
    
    // Ensure end time is also on slot boundary
    const finalAlignedEnd = this.roundToSlotBoundary(alignedEnd, granularity, 'up');
    
    // Calculate number of slots required
    const totalDuration = (finalAlignedEnd.getTime() - alignedStart.getTime()) / (60 * 1000);
    const requiredSlots = Math.ceil(totalDuration / granularity);
    
    // Check if adjustment was made
    const adjustmentMade = alignedStart.getTime() !== originalStart.getTime() ||
                          finalAlignedEnd.getTime() !== originalEnd.getTime();
    
    // Validate the boundary calculation
    const isValid = this.validateSlotBoundary(alignedStart, finalAlignedEnd, granularity);
    
    return {
      alignedStart,
      alignedEnd: finalAlignedEnd,
      requiredSlots,
      isValid,
      adjustmentMade
    };
  }

  /**
   * Validate slot boundary alignment
   */
  static validateSlotBoundary(startTime: Date, endTime: Date, granularity: SlotGranularity): boolean {
    const startMinutes = startTime.getMinutes();
    const endMinutes = endTime.getMinutes();
    
    // Check if both start and end are aligned to slot boundaries
    const startAligned = (startMinutes % granularity) === 0 && 
                        startTime.getSeconds() === 0 && 
                        startTime.getMilliseconds() === 0;
    
    const endAligned = (endMinutes % granularity) === 0 && 
                      endTime.getSeconds() === 0 && 
                      endTime.getMilliseconds() === 0;
    
    return startAligned && endAligned && endTime > startTime;
  }

  /**
   * Calculate continuous slot requirements
   */
  static calculateContinuousSlotRequirement(
    duration: number, 
    granularity: SlotGranularity
  ): ContinuousSlotRequirement {
    const requiredSlots = Math.ceil(duration / granularity);
    
    return {
      duration,
      requiredSlots,
      granularity
    };
  }

  /**
   * Generate slot times for a given period
   */
  static generateSlotTimes(
    startDate: Date, 
    endDate: Date, 
    granularity: SlotGranularity
  ): Date[] {
    const slots: Date[] = [];
    const current = this.roundToSlotBoundary(new Date(startDate), granularity, 'up');
    const end = this.roundToSlotBoundary(new Date(endDate), granularity, 'down');
    
    while (current < end) {
      slots.push(new Date(current));
      current.setMinutes(current.getMinutes() + granularity);
    }
    
    return slots;
  }

  /**
   * Check if a time range intersects with business hours
   */
  static intersectsWithBusinessHours(
    startTime: Date,
    endTime: Date,
    businessHours: BusinessHours[]
  ): boolean {
    const dayOfWeek = startTime.getDay();
    const dayBusinessHours = businessHours.filter(bh => bh.dayOfWeek === dayOfWeek);
    
    if (dayBusinessHours.length === 0) {
      return false; // No business hours defined for this day
    }
    
    const startTimeStr = this.formatTimeHHMM(startTime);
    const endTimeStr = this.formatTimeHHMM(endTime);
    
    return dayBusinessHours.some(bh => {
      // Check if the effective date range is valid
      if (bh.effectiveFrom && startTime < bh.effectiveFrom) return false;
      if (bh.effectiveTo && startTime > bh.effectiveTo) return false;
      
      // Check time intersection
      return this.timeRangesOverlap(
        startTimeStr, endTimeStr,
        bh.openTime, bh.closeTime
      );
    });
  }

  /**
   * Check if a date is a holiday
   */
  static isHoliday(date: Date, holidays: Holiday[]): boolean {
    const dateStr = this.formatDateYYYYMMDD(date);
    return holidays.some(holiday => 
      this.formatDateYYYYMMDD(holiday.date) === dateStr
    );
  }

  /**
   * Check if a time range intersects with resource time-off
   */
  static intersectsWithTimeOff(
    startTime: Date,
    endTime: Date,
    timeOffs: ResourceTimeOff[]
  ): boolean {
    return timeOffs.some(timeOff => 
      this.dateRangesOverlap(startTime, endTime, timeOff.startTime, timeOff.endTime)
    );
  }

  /**
   * Validate slot continuity for multi-slot bookings
   */
  static validateSlotContinuity(
    slotTimes: Date[],
    granularity: SlotGranularity
  ): SlotValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    if (slotTimes.length === 0) {
      errors.push('No slots provided');
      return { isValid: false, errors, warnings };
    }
    
    if (slotTimes.length === 1) {
      // Single slot, just validate boundary alignment
      const slot = slotTimes[0];
      if (!this.validateSlotBoundary(slot, new Date(slot.getTime() + granularity * 60 * 1000), granularity)) {
        errors.push('Slot is not aligned to boundary');
      }
      return { isValid: errors.length === 0, errors, warnings };
    }
    
    // Sort slots by time
    const sortedSlots = [...slotTimes].sort((a, b) => a.getTime() - b.getTime());
    
    // Check for continuity
    for (let i = 1; i < sortedSlots.length; i++) {
      const prevSlot = sortedSlots[i - 1];
      const currentSlot = sortedSlots[i];
      
      const expectedNext = new Date(prevSlot.getTime() + granularity * 60 * 1000);
      
      if (currentSlot.getTime() !== expectedNext.getTime()) {
        errors.push(`Gap between slots at ${prevSlot.toISOString()} and ${currentSlot.toISOString()}`);
      }
    }
    
    // Validate each slot boundary
    sortedSlots.forEach((slot, index) => {
      const slotEnd = new Date(slot.getTime() + granularity * 60 * 1000);
      if (!this.validateSlotBoundary(slot, slotEnd, granularity)) {
        errors.push(`Slot ${index} is not aligned to boundary: ${slot.toISOString()}`);
      }
    });
    
    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Calculate optimal slot adjustment
   */
  static calculateSlotAdjustment(
    requestedStart: Date,
    requestedEnd: Date,
    granularity: SlotGranularity,
    businessHours: BusinessHours[],
    holidays: Holiday[],
    timeOffs: ResourceTimeOff[]
  ): SlotAdjustment | null {
    // Calculate boundary-aligned times
    const boundaryResult = this.calculateSlotBoundary(
      requestedStart, 
      (requestedEnd.getTime() - requestedStart.getTime()) / (60 * 1000), 
      granularity
    );
    
    let adjustedStart = boundaryResult.alignedStart;
    let adjustedEnd = boundaryResult.alignedEnd;
    let reason: SlotAdjustment['reason'] = 'BOUNDARY_ALIGNMENT';
    
    // Check business hours constraints
    if (!this.intersectsWithBusinessHours(adjustedStart, adjustedEnd, businessHours)) {
      // Find next available business hours slot
      const nextAvailable = this.findNextAvailableSlot(
        adjustedStart, granularity, businessHours, holidays, timeOffs
      );
      
      if (nextAvailable) {
        const duration = adjustedEnd.getTime() - adjustedStart.getTime();
        adjustedStart = nextAvailable;
        adjustedEnd = new Date(nextAvailable.getTime() + duration);
        reason = 'BUSINESS_HOURS';
      }
    }
    
    // Check holiday constraints
    if (this.isHoliday(adjustedStart, holidays)) {
      // Skip to next business day
      const nextBusinessDay = this.findNextBusinessDay(adjustedStart, holidays);
      if (nextBusinessDay) {
        const duration = adjustedEnd.getTime() - adjustedStart.getTime();
        adjustedStart = nextBusinessDay;
        adjustedEnd = new Date(nextBusinessDay.getTime() + duration);
        reason = 'BUSINESS_HOURS';
      }
    }
    
    // Check time-off constraints
    if (this.intersectsWithTimeOff(adjustedStart, adjustedEnd, timeOffs)) {
      // Find next available time after time-off
      const nextAvailable = this.findNextAvailableAfterTimeOff(
        adjustedStart, adjustedEnd, timeOffs, granularity
      );
      
      if (nextAvailable) {
        const duration = adjustedEnd.getTime() - adjustedStart.getTime();
        adjustedStart = nextAvailable;
        adjustedEnd = new Date(nextAvailable.getTime() + duration);
        reason = 'BUSINESS_HOURS';
      }
    }
    
    // Only return adjustment if changes were made
    if (adjustedStart.getTime() !== requestedStart.getTime() || 
        adjustedEnd.getTime() !== requestedEnd.getTime()) {
      return {
        originalStart: requestedStart,
        originalEnd: requestedEnd,
        adjustedStart,
        adjustedEnd,
        reason,
        granularity
      };
    }
    
    return null;
  }

  /**
   * Get timezone offset for a date
   */
  static getTimezoneOffset(date: Date, timezone?: string): number {
    if (!timezone) {
      return date.getTimezoneOffset();
    }
    
    // Use Intl.DateTimeFormat to get timezone offset
    try {
      const utc = new Date(date.toUTCString());
      const local = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
      return (utc.getTime() - local.getTime()) / (60 * 1000);
    } catch {
      return date.getTimezoneOffset();
    }
  }

  /**
   * Convert time to specific timezone
   */
  static convertToTimezone(date: Date, timezone: string): Date {
    try {
      return new Date(date.toLocaleString('en-US', { timeZone: timezone }));
    } catch {
      return date;
    }
  }

  // Private helper methods

  private static formatTimeHHMM(date: Date): string {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }

  private static formatDateYYYYMMDD(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private static timeRangesOverlap(
    start1: string, end1: string,
    start2: string, end2: string
  ): boolean {
    const timeToMinutes = (time: string): number => {
      const [hours, minutes] = time.split(':').map(Number);
      return hours * 60 + minutes;
    };
    
    const start1Min = timeToMinutes(start1);
    const end1Min = timeToMinutes(end1);
    const start2Min = timeToMinutes(start2);
    const end2Min = timeToMinutes(end2);
    
    return start1Min < end2Min && end1Min > start2Min;
  }

  private static dateRangesOverlap(
    start1: Date, end1: Date,
    start2: Date, end2: Date
  ): boolean {
    return start1 < end2 && end1 > start2;
  }

  private static findNextAvailableSlot(
    startTime: Date,
    granularity: SlotGranularity,
    businessHours: BusinessHours[],
    holidays: Holiday[],
    timeOffs: ResourceTimeOff[]
  ): Date | null {
    const current = new Date(startTime);
    const maxDaysToCheck = 30; // Prevent infinite loop
    
    for (let day = 0; day < maxDaysToCheck; day++) {
      const checkDate = new Date(current.getTime() + day * 24 * 60 * 60 * 1000);
      
      // Skip holidays
      if (this.isHoliday(checkDate, holidays)) {
        continue;
      }
      
      // Find business hours for this day
      const dayBusinessHours = businessHours.filter(bh => bh.dayOfWeek === checkDate.getDay());
      
      for (const bh of dayBusinessHours) {
        // Check effective date range
        if (bh.effectiveFrom && checkDate < bh.effectiveFrom) continue;
        if (bh.effectiveTo && checkDate > bh.effectiveTo) continue;
        
        // Create start time for this business day
        const [openHours, openMinutes] = bh.openTime.split(':').map(Number);
        const businessStart = new Date(checkDate);
        businessStart.setHours(openHours, openMinutes, 0, 0);
        
        // Round to slot boundary
        const slotStart = this.roundToSlotBoundary(businessStart, granularity, 'up');
        
        // Check if this slot is not in time-off period
        const slotEnd = new Date(slotStart.getTime() + granularity * 60 * 1000);
        if (!this.intersectsWithTimeOff(slotStart, slotEnd, timeOffs)) {
          return slotStart;
        }
      }
    }
    
    return null;
  }

  private static findNextBusinessDay(date: Date, holidays: Holiday[]): Date | null {
    const current = new Date(date);
    const maxDaysToCheck = 365; // Check up to a year
    
    for (let day = 1; day <= maxDaysToCheck; day++) {
      current.setDate(current.getDate() + 1);
      
      // Skip weekends (assuming business days are Mon-Fri)
      if (current.getDay() === 0 || current.getDay() === 6) {
        continue;
      }
      
      // Skip holidays
      if (!this.isHoliday(current, holidays)) {
        return new Date(current);
      }
    }
    
    return null;
  }

  private static findNextAvailableAfterTimeOff(
    requestedStart: Date,
    requestedEnd: Date,
    timeOffs: ResourceTimeOff[],
    granularity: SlotGranularity
  ): Date | null {
    // Find the latest end time among overlapping time-offs
    let latestEndTime = requestedStart;
    
    for (const timeOff of timeOffs) {
      if (this.dateRangesOverlap(requestedStart, requestedEnd, timeOff.startTime, timeOff.endTime)) {
        if (timeOff.endTime > latestEndTime) {
          latestEndTime = timeOff.endTime;
        }
      }
    }
    
    // Round to next slot boundary after the latest time-off
    return this.roundToSlotBoundary(latestEndTime, granularity, 'up');
  }
}

/**
 * Slot timing utilities for performance optimization
 */
export class SlotTimingUtils {
  /**
   * Batch process slot boundary calculations
   */
  static batchCalculateSlotBoundaries(
    requests: Array<{ startTime: Date; duration: number; granularity: SlotGranularity }>
  ): SlotBoundary[] {
    return requests.map(req => 
      TimeSlotUtils.calculateSlotBoundary(req.startTime, req.duration, req.granularity)
    );
  }

  /**
   * Optimize slot generation for large date ranges
   */
  static generateOptimizedSlotTimes(
    startDate: Date,
    endDate: Date,
    granularity: SlotGranularity,
    businessHours: BusinessHours[]
  ): Date[] {
    const slots: Date[] = [];
    const current = new Date(startDate);
    
    while (current < endDate) {
      const dayOfWeek = current.getDay();
      const dayBusinessHours = businessHours.filter(bh => bh.dayOfWeek === dayOfWeek);
      
      if (dayBusinessHours.length > 0) {
        for (const bh of dayBusinessHours) {
          // Check effective date range
          if (bh.effectiveFrom && current < bh.effectiveFrom) continue;
          if (bh.effectiveTo && current > bh.effectiveTo) continue;
          
          // Generate slots for this business period
          const [openHours, openMinutes] = bh.openTime.split(':').map(Number);
          const [closeHours, closeMinutes] = bh.closeTime.split(':').map(Number);
          
          const dayStart = new Date(current);
          dayStart.setHours(openHours, openMinutes, 0, 0);
          
          const dayEnd = new Date(current);
          dayEnd.setHours(closeHours, closeMinutes, 0, 0);
          
          const daySlots = TimeSlotUtils.generateSlotTimes(dayStart, dayEnd, granularity);
          slots.push(...daySlots);
        }
      }
      
      // Move to next day
      current.setDate(current.getDate() + 1);
      current.setHours(0, 0, 0, 0);
    }
    
    return slots.sort((a, b) => a.getTime() - b.getTime());
  }

  /**
   * Calculate slot utilization statistics
   */
  static calculateSlotUtilization(
    totalSlots: number,
    bookedSlots: number,
    availableSlots: number
  ): {
    utilizationRate: number;
    availabilityRate: number;
    efficiency: number;
  } {
    const utilizationRate = totalSlots > 0 ? (bookedSlots / totalSlots) * 100 : 0;
    const availabilityRate = totalSlots > 0 ? (availableSlots / totalSlots) * 100 : 0;
    const efficiency = (bookedSlots + availableSlots) > 0 ? 
      (bookedSlots / (bookedSlots + availableSlots)) * 100 : 0;
    
    return {
      utilizationRate: Math.round(utilizationRate * 100) / 100,
      availabilityRate: Math.round(availabilityRate * 100) / 100,
      efficiency: Math.round(efficiency * 100) / 100
    };
  }
}

export default TimeSlotUtils;