/**
 * Calendar Display Utilities
 * Provides calendar view generation, business day calculations,
 * holiday handling, and timezone conversions for availability display
 */

import { 
  TimeSlot, 
  BusinessHours, 
  Holiday, 
  InventoryStats 
} from '../types/availability.js';
import { logger } from '../config/logger.js';

/**
 * Calendar view type
 */
export type CalendarView = 'month' | 'week' | 'day';

/**
 * Calendar day information
 */
export interface CalendarDay {
  date: Date;
  dateString: string; // YYYY-MM-DD format
  dayOfWeek: number; // 0=Sunday, 1=Monday, etc.
  dayName: string;
  isBusinessDay: boolean;
  isHoliday: boolean;
  holidayName?: string;
  isToday: boolean;
  isWeekend: boolean;
  totalSlots: number;
  availableSlots: number;
  bookedSlots: number;
  utilizationRate: number;
  peakHours: Array<{
    hour: number;
    utilization: number;
    availableCapacity: number;
  }>;
}

/**
 * Calendar week structure
 */
export interface CalendarWeek {
  weekNumber: number;
  startDate: Date;
  endDate: Date;
  days: CalendarDay[];
  totalUtilization: number;
  businessDays: number;
}

/**
 * Calendar month structure
 */
export interface CalendarMonth {
  year: number;
  month: number; // 1-12
  monthName: string;
  startDate: Date;
  endDate: Date;
  weeks: CalendarWeek[];
  totalDays: number;
  businessDays: number;
  holidays: number;
  averageUtilization: number;
  peakUtilizationDay?: Date;
  lowUtilizationDays: Date[];
}

/**
 * Business day configuration
 */
export interface BusinessDayConfig {
  workingDays: number[]; // 0=Sunday, 1=Monday, etc.
  holidays: Holiday[];
  businessHours: BusinessHours[];
}

/**
 * Timezone configuration
 */
export interface TimezoneConfig {
  timezone: string; // IANA timezone identifier
  offsetMinutes?: number; // UTC offset in minutes
}

/**
 * Default business day configuration (Monday to Friday)
 */
const DEFAULT_BUSINESS_CONFIG: BusinessDayConfig = {
  workingDays: [1, 2, 3, 4, 5], // Monday to Friday
  holidays: [],
  businessHours: []
};

/**
 * Day names for localization
 */
const DAY_NAMES = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  ja: ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日']
};

/**
 * Month names for localization
 */
const MONTH_NAMES = {
  en: ['January', 'February', 'March', 'April', 'May', 'June',
       'July', 'August', 'September', 'October', 'November', 'December'],
  ja: ['1月', '2月', '3月', '4月', '5月', '6月',
       '7月', '8月', '9月', '10月', '11月', '12月']
};

/**
 * Calendar utility class
 */
export class CalendarUtils {
  private businessConfig: BusinessDayConfig;
  private timezoneConfig: TimezoneConfig;
  private locale: 'en' | 'ja';

  constructor(
    businessConfig: Partial<BusinessDayConfig> = {},
    timezoneConfig: TimezoneConfig = { timezone: 'Asia/Tokyo' },
    locale: 'en' | 'ja' = 'ja'
  ) {
    this.businessConfig = { ...DEFAULT_BUSINESS_CONFIG, ...businessConfig };
    this.timezoneConfig = timezoneConfig;
    this.locale = locale;
  }

  /**
   * Generate monthly calendar view
   */
  generateMonthlyCalendar(
    year: number,
    month: number, // 1-12
    timeSlots: TimeSlot[] = [],
    resourceIds: string[] = []
  ): CalendarMonth {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    const monthName = MONTH_NAMES[this.locale][month - 1];

    // Group time slots by date
    const slotsByDate = this.groupSlotsByDate(timeSlots);

    // Generate weeks
    const weeks = this.generateWeeks(startDate, endDate, slotsByDate);

    // Calculate month statistics
    const totalDays = endDate.getDate();
    const businessDays = weeks.reduce((sum, week) => sum + week.businessDays, 0);
    const holidays = weeks.reduce((sum, week) => 
      sum + week.days.filter(day => day.isHoliday).length, 0
    );

    const allDays = weeks.flatMap(week => week.days);
    const validDays = allDays.filter(day => day.totalSlots > 0);
    const averageUtilization = validDays.length > 0 
      ? validDays.reduce((sum, day) => sum + day.utilizationRate, 0) / validDays.length 
      : 0;

    const peakUtilizationDay = validDays.reduce((peak, day) => 
      day.utilizationRate > (peak?.utilizationRate || 0) ? day : peak,
      null as CalendarDay | null
    )?.date;

    const lowUtilizationDays = validDays
      .filter(day => day.utilizationRate < 30)
      .map(day => day.date);

    return {
      year,
      month,
      monthName,
      startDate,
      endDate,
      weeks,
      totalDays,
      businessDays,
      holidays,
      averageUtilization,
      peakUtilizationDay,
      lowUtilizationDays
    };
  }

  /**
   * Generate weekly calendar view
   */
  generateWeeklyCalendar(
    startDate: Date,
    timeSlots: TimeSlot[] = []
  ): CalendarWeek {
    const weekStartDate = this.getWeekStartDate(startDate);
    const weekEndDate = new Date(weekStartDate.getTime() + 6 * 24 * 60 * 60 * 1000);
    
    const slotsByDate = this.groupSlotsByDate(timeSlots);
    
    const days: CalendarDay[] = [];
    let businessDays = 0;
    let totalUtilization = 0;
    let validDays = 0;

    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStartDate.getTime() + i * 24 * 60 * 60 * 1000);
      const day = this.generateCalendarDay(date, slotsByDate[this.formatDate(date)] || []);
      
      days.push(day);
      
      if (day.isBusinessDay) {
        businessDays++;
      }
      
      if (day.totalSlots > 0) {
        totalUtilization += day.utilizationRate;
        validDays++;
      }
    }

    const averageUtilization = validDays > 0 ? totalUtilization / validDays : 0;

    return {
      weekNumber: this.getWeekNumber(startDate),
      startDate: weekStartDate,
      endDate: weekEndDate,
      days,
      totalUtilization: averageUtilization,
      businessDays
    };
  }

  /**
   * Generate daily calendar view with hourly breakdown
   */
  generateDailyCalendar(
    date: Date,
    timeSlots: TimeSlot[] = []
  ): CalendarDay {
    const daySlots = timeSlots.filter(slot => 
      this.isSameDate(slot.startTime, date)
    );

    return this.generateCalendarDay(date, daySlots);
  }

  /**
   * Check if a date is a business day
   */
  isBusinessDay(date: Date): boolean {
    const dayOfWeek = date.getDay();
    
    // Check if it's a working day
    if (!this.businessConfig.workingDays.includes(dayOfWeek)) {
      return false;
    }

    // Check if it's a holiday
    const holiday = this.getHolidayForDate(date);
    if (holiday) {
      return false;
    }

    return true;
  }

  /**
   * Get holiday information for a specific date
   */
  getHolidayForDate(date: Date): Holiday | null {
    const dateString = this.formatDate(date);
    
    return this.businessConfig.holidays.find(holiday => 
      this.formatDate(holiday.date) === dateString
    ) || null;
  }

  /**
   * Get business hours for a specific date
   */
  getBusinessHoursForDate(date: Date, resourceId?: string): BusinessHours | null {
    const dayOfWeek = date.getDay();
    
    return this.businessConfig.businessHours.find(hours => 
      hours.dayOfWeek === dayOfWeek && 
      (!resourceId || hours.resourceId === resourceId) &&
      (!hours.effectiveFrom || date >= hours.effectiveFrom) &&
      (!hours.effectiveTo || date <= hours.effectiveTo)
    ) || null;
  }

  /**
   * Calculate peak hours for a day
   */
  calculatePeakHours(timeSlots: TimeSlot[]): Array<{
    hour: number;
    utilization: number;
    availableCapacity: number;
  }> {
    const hourlyStats = new Map<number, {
      totalCapacity: number;
      availableCapacity: number;
      bookedCapacity: number;
    }>();

    // Group slots by hour
    for (const slot of timeSlots) {
      const hour = slot.startTime.getHours();
      const existing = hourlyStats.get(hour) || {
        totalCapacity: 0,
        availableCapacity: 0,
        bookedCapacity: 0
      };

      existing.totalCapacity += slot.capacity;
      existing.availableCapacity += slot.availableCapacity;
      existing.bookedCapacity += slot.bookedCount;

      hourlyStats.set(hour, existing);
    }

    // Convert to peak hours array
    const peakHours: Array<{
      hour: number;
      utilization: number;
      availableCapacity: number;
    }> = [];

    for (const [hour, stats] of hourlyStats) {
      const utilization = stats.totalCapacity > 0 
        ? (stats.bookedCapacity / stats.totalCapacity) * 100 
        : 0;

      peakHours.push({
        hour,
        utilization,
        availableCapacity: stats.availableCapacity
      });
    }

    // Sort by hour
    return peakHours.sort((a, b) => a.hour - b.hour);
  }

  /**
   * Get next available business day
   */
  getNextBusinessDay(date: Date, daysToAdd: number = 1): Date {
    let currentDate = new Date(date);
    let addedDays = 0;

    while (addedDays < daysToAdd) {
      currentDate.setDate(currentDate.getDate() + 1);
      
      if (this.isBusinessDay(currentDate)) {
        addedDays++;
      }
    }

    return currentDate;
  }

  /**
   * Get previous business day
   */
  getPreviousBusinessDay(date: Date, daysToSubtract: number = 1): Date {
    let currentDate = new Date(date);
    let subtractedDays = 0;

    while (subtractedDays < daysToSubtract) {
      currentDate.setDate(currentDate.getDate() - 1);
      
      if (this.isBusinessDay(currentDate)) {
        subtractedDays++;
      }
    }

    return currentDate;
  }

  /**
   * Convert date to different timezone
   */
  convertTimezone(date: Date, targetTimezone: string): Date {
    try {
      const utcTime = date.getTime() + (date.getTimezoneOffset() * 60000);
      const targetOffset = this.getTimezoneOffset(targetTimezone, date);
      return new Date(utcTime + (targetOffset * 60000));
    } catch (error) {
      logger.warn('Failed to convert timezone', { date, targetTimezone, error });
      return date;
    }
  }

  /**
   * Get timezone offset for a specific timezone and date
   */
  private getTimezoneOffset(timezone: string, date: Date): number {
    try {
      const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
      const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
      return (tzDate.getTime() - utcDate.getTime()) / (1000 * 60);
    } catch (error) {
      logger.warn('Failed to get timezone offset', { timezone, error });
      return 0;
    }
  }

  // Private helper methods

  private generateWeeks(
    startDate: Date, 
    endDate: Date, 
    slotsByDate: Record<string, TimeSlot[]>
  ): CalendarWeek[] {
    const weeks: CalendarWeek[] = [];
    
    // Start from the first Sunday of the month view
    const firstDay = new Date(startDate);
    firstDay.setDate(1);
    const firstSunday = this.getWeekStartDate(firstDay);
    
    let currentDate = new Date(firstSunday);
    let weekNumber = 1;

    while (currentDate <= endDate || currentDate.getMonth() === startDate.getMonth()) {
      const weekEndDate = new Date(currentDate.getTime() + 6 * 24 * 60 * 60 * 1000);
      const days: CalendarDay[] = [];
      let businessDays = 0;
      let totalUtilization = 0;
      let validDays = 0;

      for (let i = 0; i < 7; i++) {
        const date = new Date(currentDate.getTime() + i * 24 * 60 * 60 * 1000);
        const day = this.generateCalendarDay(
          date, 
          slotsByDate[this.formatDate(date)] || []
        );
        
        days.push(day);
        
        if (day.isBusinessDay) {
          businessDays++;
        }
        
        if (day.totalSlots > 0) {
          totalUtilization += day.utilizationRate;
          validDays++;
        }
      }

      const averageUtilization = validDays > 0 ? totalUtilization / validDays : 0;

      weeks.push({
        weekNumber: weekNumber++,
        startDate: new Date(currentDate),
        endDate: weekEndDate,
        days,
        totalUtilization: averageUtilization,
        businessDays
      });

      currentDate.setDate(currentDate.getDate() + 7);
      
      // Break if we've gone too far past the end date
      if (currentDate.getMonth() !== endDate.getMonth() && 
          currentDate.getMonth() !== startDate.getMonth()) {
        break;
      }
    }

    return weeks;
  }

  private generateCalendarDay(date: Date, timeSlots: TimeSlot[]): CalendarDay {
    const dateString = this.formatDate(date);
    const dayOfWeek = date.getDay();
    const dayName = DAY_NAMES[this.locale][dayOfWeek];
    const isBusinessDay = this.isBusinessDay(date);
    const holiday = this.getHolidayForDate(date);
    const isToday = this.isSameDate(date, new Date());
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    const totalSlots = timeSlots.length;
    const availableSlots = timeSlots.filter(slot => slot.isAvailable).length;
    const bookedSlots = totalSlots - availableSlots;
    const utilizationRate = totalSlots > 0 ? (bookedSlots / totalSlots) * 100 : 0;
    const peakHours = this.calculatePeakHours(timeSlots);

    return {
      date,
      dateString,
      dayOfWeek,
      dayName,
      isBusinessDay,
      isHoliday: !!holiday,
      holidayName: holiday?.name,
      isToday,
      isWeekend,
      totalSlots,
      availableSlots,
      bookedSlots,
      utilizationRate,
      peakHours
    };
  }

  private groupSlotsByDate(timeSlots: TimeSlot[]): Record<string, TimeSlot[]> {
    const grouped: Record<string, TimeSlot[]> = {};
    
    for (const slot of timeSlots) {
      const dateKey = this.formatDate(slot.startTime);
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(slot);
    }

    return grouped;
  }

  private getWeekStartDate(date: Date): Date {
    const day = date.getDay();
    const diff = date.getDate() - day;
    const sunday = new Date(date.setDate(diff));
    sunday.setHours(0, 0, 0, 0);
    return sunday;
  }

  private getWeekNumber(date: Date): number {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private isSameDate(date1: Date, date2: Date): boolean {
    return this.formatDate(date1) === this.formatDate(date2);
  }
}

/**
 * Static utility functions
 */
export class CalendarStaticUtils {
  /**
   * Get Japanese holidays for a given year
   */
  static getJapaneseHolidays(year: number): Holiday[] {
    const holidays: Array<{ date: Date; name: string }> = [
      { date: new Date(year, 0, 1), name: '元日' },
      { date: new Date(year, 1, 11), name: '建国記念の日' },
      { date: new Date(year, 2, 20), name: '春分の日' }, // Approximate
      { date: new Date(year, 3, 29), name: '昭和の日' },
      { date: new Date(year, 4, 3), name: '憲法記念日' },
      { date: new Date(year, 4, 4), name: 'みどりの日' },
      { date: new Date(year, 4, 5), name: 'こどもの日' },
      { date: new Date(year, 6, 20), name: '海の日' }, // Third Monday
      { date: new Date(year, 7, 11), name: '山の日' },
      { date: new Date(year, 8, 16), name: '敬老の日' }, // Third Monday
      { date: new Date(year, 8, 22), name: '秋分の日' }, // Approximate
      { date: new Date(year, 9, 14), name: 'スポーツの日' }, // Second Monday
      { date: new Date(year, 10, 3), name: '文化の日' },
      { date: new Date(year, 10, 23), name: '勤労感謝の日' }
    ];

    return holidays.map((holiday, index) => ({
      id: `jp-holiday-${year}-${index + 1}`,
      tenantId: 'system',
      date: holiday.date,
      name: holiday.name
    }));
  }

  /**
   * Calculate business days between two dates
   */
  static calculateBusinessDays(
    startDate: Date, 
    endDate: Date, 
    holidays: Holiday[] = [],
    workingDays: number[] = [1, 2, 3, 4, 5]
  ): number {
    let businessDays = 0;
    const currentDate = new Date(startDate);
    
    const holidayDates = new Set(
      holidays.map(h => h.date.toISOString().split('T')[0])
    );

    while (currentDate <= endDate) {
      const dayOfWeek = currentDate.getDay();
      const dateString = currentDate.toISOString().split('T')[0];
      
      if (workingDays.includes(dayOfWeek) && !holidayDates.has(dateString)) {
        businessDays++;
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return businessDays;
  }

  /**
   * Format calendar data for mobile optimization
   */
  static optimizeForMobile<T extends CalendarMonth | CalendarWeek | CalendarDay>(
    data: T
  ): T {
    // Remove detailed data that's not needed on mobile
    if ('weeks' in data) {
      // Monthly view - reduce peak hours data
      const optimized = { ...data };
      optimized.weeks = data.weeks.map(week => ({
        ...week,
        days: week.days.map(day => ({
          ...day,
          peakHours: day.peakHours.slice(0, 3) // Keep only top 3 peak hours
        }))
      }));
      return optimized;
    }
    
    if ('days' in data) {
      // Weekly view - reduce peak hours data
      const optimized = { ...data };
      optimized.days = data.days.map(day => ({
        ...day,
        peakHours: day.peakHours.slice(0, 5) // Keep only top 5 peak hours
      }));
      return optimized;
    }
    
    // Daily view - keep all data
    return data;
  }

  /**
   * Generate cache key for calendar data
   */
  static generateCacheKey(
    view: CalendarView,
    date: Date,
    resourceIds: string[],
    tenantId: string
  ): string {
    const dateKey = date.toISOString().split('T')[0];
    const resourceKey = resourceIds.sort().join(',');
    return `calendar:${view}:${dateKey}:${tenantId}:${resourceKey}`;
  }
}

// Export default calendar utils instance
export const calendarUtils = new CalendarUtils();

export default {
  CalendarUtils,
  CalendarStaticUtils,
  calendarUtils
};