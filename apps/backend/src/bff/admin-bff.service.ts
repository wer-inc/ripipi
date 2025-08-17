/**
 * Admin BFF Service
 * Backend for Frontend layer for admin/management interfaces
 * Aggregates and optimizes data for admin dashboard and operations
 */

import { FastifyInstance } from 'fastify';
import { CacheService } from '../services/cache.service.js';
import { logger } from '../config/logger.js';
import { withTransaction, TransactionContext } from '../db/transaction.js';

/**
 * Dashboard overview data
 */
export interface DashboardOverviewBFF {
  stats: {
    todayReservations: number;
    weekReservations: number;
    monthRevenue: number;
    activeCustomers: number;
    averageRating?: number;
    trends: {
      reservations: 'UP' | 'DOWN' | 'STABLE';
      revenue: 'UP' | 'DOWN' | 'STABLE';
      percentChange: number;
    };
  };
  todaySchedule: Array<{
    time: string;
    bookingId: number;
    customerName: string;
    serviceName: string;
    status: string;
    staffName?: string;
  }>;
  upcomingAlerts: Array<{
    type: 'NO_SHOW' | 'LATE' | 'CONFLICT' | 'MAINTENANCE';
    message: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
    timestamp: string;
  }>;
  performanceMetrics: {
    utilizationRate: number;
    noShowRate: number;
    averageServiceTime: number;
    customerSatisfaction?: number;
  };
}

/**
 * Reservation management data (aggregated)
 */
export interface ReservationManagementBFF {
  reservations: Array<{
    id: number;
    customerName: string;
    customerPhone?: string;
    serviceName: string;
    startTime: string;
    duration: number;
    status: string;
    staffName?: string;
    amount: number;
    paymentStatus: string;
    notes?: string;
    tags?: string[];
    history?: Array<{
      action: string;
      timestamp: string;
      user: string;
    }>;
  }>;
  filters: {
    statuses: string[];
    services: Array<{ id: number; name: string }>;
    staff: Array<{ id: number; name: string }>;
    dateRange: { min: string; max: string };
  };
  summary: {
    total: number;
    byStatus: Record<string, number>;
    revenue: number;
  };
}

/**
 * Customer insights data
 */
export interface CustomerInsightsBFF {
  customer: {
    id: number;
    name: string;
    phone?: string;
    email?: string;
    registeredAt: string;
    tags?: string[];
  };
  metrics: {
    totalVisits: number;
    totalSpent: number;
    averageSpent: number;
    lastVisit?: string;
    favoriteService?: string;
    preferredStaff?: string;
    noShowCount: number;
    cancellationRate: number;
  };
  history: Array<{
    date: string;
    service: string;
    amount: number;
    status: string;
    rating?: number;
  }>;
  recommendations: Array<{
    type: 'SERVICE' | 'PROMOTION' | 'FOLLOW_UP';
    title: string;
    description: string;
    action?: string;
  }>;
}

/**
 * Staff performance data
 */
export interface StaffPerformanceBFF {
  staff: Array<{
    id: number;
    name: string;
    role: string;
    avatar?: string;
    status: 'AVAILABLE' | 'BUSY' | 'OFF_DUTY';
    currentBooking?: {
      customerName: string;
      serviceName: string;
      endTime: string;
    };
    todayStats: {
      completedBookings: number;
      revenue: number;
      utilizationRate: number;
      averageRating?: number;
    };
    weeklySchedule: Array<{
      date: string;
      bookings: number;
      hours: number;
    }>;
  }>;
  teamMetrics: {
    totalRevenue: number;
    averageUtilization: number;
    topPerformer?: string;
  };
}

/**
 * Admin BFF Service
 */
export class AdminBFFService {
  private cache: CacheService;
  
  constructor(private fastify: FastifyInstance) {
    this.cache = new CacheService(fastify);
  }

  /**
   * Get dashboard overview with all aggregated data
   */
  async getDashboardOverview(
    tenantId: number,
    date: Date = new Date()
  ): Promise<DashboardOverviewBFF> {
    const cacheKey = `bff:admin:dashboard:${tenantId}:${date.toISOString().split('T')[0]}`;
    
    // Check cache (short TTL for real-time data)
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    try {
      // Parallel fetch all dashboard data
      const [
        stats,
        todaySchedule,
        upcomingAlerts,
        performanceMetrics
      ] = await Promise.all([
        this.getAggregatedStats(tenantId, date),
        this.getTodaySchedule(tenantId, date),
        this.getUpcomingAlerts(tenantId),
        this.getPerformanceMetrics(tenantId, date)
      ]);
      
      const response: DashboardOverviewBFF = {
        stats,
        todaySchedule,
        upcomingAlerts,
        performanceMetrics
      };
      
      // Cache for 30 seconds (real-time data)
      await this.cache.set(cacheKey, response, 30);
      
      return response;
      
    } catch (error) {
      logger.error('Failed to get dashboard overview', { error, tenantId });
      throw error;
    }
  }

  /**
   * Get aggregated reservation management data
   */
  async getReservationManagement(params: {
    tenantId: number;
    from: Date;
    to: Date;
    status?: string;
    serviceId?: number;
    staffId?: number;
    page?: number;
    limit?: number;
  }): Promise<ReservationManagementBFF> {
    try {
      const [reservations, filters, summary] = await Promise.all([
        this.getDetailedReservations(params),
        this.getAvailableFilters(params.tenantId),
        this.getReservationSummary(params)
      ]);
      
      return {
        reservations,
        filters,
        summary
      };
      
    } catch (error) {
      logger.error('Failed to get reservation management data', { error, params });
      throw error;
    }
  }

  /**
   * Get comprehensive customer insights
   */
  async getCustomerInsights(
    tenantId: number,
    customerId: number
  ): Promise<CustomerInsightsBFF> {
    const cacheKey = `bff:admin:customer:${tenantId}:${customerId}`;
    
    // Check cache
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    try {
      const [customer, metrics, history, recommendations] = await Promise.all([
        this.getCustomerDetails(tenantId, customerId),
        this.getCustomerMetrics(tenantId, customerId),
        this.getCustomerHistory(tenantId, customerId),
        this.generateCustomerRecommendations(tenantId, customerId)
      ]);
      
      const response: CustomerInsightsBFF = {
        customer,
        metrics,
        history,
        recommendations
      };
      
      // Cache for 5 minutes
      await this.cache.set(cacheKey, response, 300);
      
      return response;
      
    } catch (error) {
      logger.error('Failed to get customer insights', { error, tenantId, customerId });
      throw error;
    }
  }

  /**
   * Get staff performance analytics
   */
  async getStaffPerformance(
    tenantId: number,
    date: Date = new Date()
  ): Promise<StaffPerformanceBFF> {
    try {
      const [staff, teamMetrics] = await Promise.all([
        this.getStaffDetails(tenantId, date),
        this.getTeamMetrics(tenantId, date)
      ]);
      
      return {
        staff,
        teamMetrics
      };
      
    } catch (error) {
      logger.error('Failed to get staff performance', { error, tenantId });
      throw error;
    }
  }

  /**
   * Bulk update reservation statuses
   */
  async bulkUpdateReservations(
    tenantId: number,
    updates: Array<{ id: number; status: string; notes?: string }>
  ): Promise<{ success: number; failed: number; errors: any[] }> {
    const results = {
      success: 0,
      failed: 0,
      errors: [] as any[]
    };
    
    await withTransaction(async (ctx: TransactionContext) => {
      for (const update of updates) {
        try {
          await this.updateReservationStatus(ctx, tenantId, update);
          results.success++;
        } catch (error: any) {
          results.failed++;
          results.errors.push({
            id: update.id,
            error: error.message
          });
        }
      }
    });
    
    // Invalidate relevant caches
    await this.invalidateReservationCaches(tenantId);
    
    return results;
  }

  /**
   * Generate analytics report
   */
  async generateAnalyticsReport(params: {
    tenantId: number;
    from: Date;
    to: Date;
    metrics: string[];
  }): Promise<any> {
    const report: any = {
      period: {
        from: params.from.toISOString(),
        to: params.to.toISOString()
      },
      metrics: {}
    };
    
    // Generate requested metrics
    for (const metric of params.metrics) {
      switch (metric) {
        case 'revenue':
          report.metrics.revenue = await this.calculateRevenue(params);
          break;
        case 'utilization':
          report.metrics.utilization = await this.calculateUtilization(params);
          break;
        case 'customer_retention':
          report.metrics.customerRetention = await this.calculateRetention(params);
          break;
        case 'service_performance':
          report.metrics.servicePerformance = await this.analyzeServicePerformance(params);
          break;
      }
    }
    
    return report;
  }

  // Private helper methods

  private async getAggregatedStats(tenantId: number, date: Date): Promise<any> {
    // Implement stats aggregation
    return {
      todayReservations: 0,
      weekReservations: 0,
      monthRevenue: 0,
      activeCustomers: 0,
      trends: {
        reservations: 'STABLE' as const,
        revenue: 'UP' as const,
        percentChange: 0
      }
    };
  }

  private async getTodaySchedule(tenantId: number, date: Date): Promise<any[]> {
    // Implement schedule fetching
    return [];
  }

  private async getUpcomingAlerts(tenantId: number): Promise<any[]> {
    // Implement alert generation
    return [];
  }

  private async getPerformanceMetrics(tenantId: number, date: Date): Promise<any> {
    // Implement performance metrics calculation
    return {
      utilizationRate: 0,
      noShowRate: 0,
      averageServiceTime: 0
    };
  }

  private async getDetailedReservations(params: any): Promise<any[]> {
    // Implement detailed reservation fetching
    return [];
  }

  private async getAvailableFilters(tenantId: number): Promise<any> {
    // Implement filter options fetching
    return {
      statuses: [],
      services: [],
      staff: [],
      dateRange: { min: '', max: '' }
    };
  }

  private async getReservationSummary(params: any): Promise<any> {
    // Implement summary calculation
    return {
      total: 0,
      byStatus: {},
      revenue: 0
    };
  }

  private async getCustomerDetails(tenantId: number, customerId: number): Promise<any> {
    // Implement customer details fetching
    return {
      id: customerId,
      name: '',
      registeredAt: new Date().toISOString()
    };
  }

  private async getCustomerMetrics(tenantId: number, customerId: number): Promise<any> {
    // Implement customer metrics calculation
    return {
      totalVisits: 0,
      totalSpent: 0,
      averageSpent: 0,
      noShowCount: 0,
      cancellationRate: 0
    };
  }

  private async getCustomerHistory(tenantId: number, customerId: number): Promise<any[]> {
    // Implement customer history fetching
    return [];
  }

  private async generateCustomerRecommendations(tenantId: number, customerId: number): Promise<any[]> {
    // Implement recommendation generation
    return [];
  }

  private async getStaffDetails(tenantId: number, date: Date): Promise<any[]> {
    // Implement staff details fetching
    return [];
  }

  private async getTeamMetrics(tenantId: number, date: Date): Promise<any> {
    // Implement team metrics calculation
    return {
      totalRevenue: 0,
      averageUtilization: 0
    };
  }

  private async updateReservationStatus(
    ctx: TransactionContext,
    tenantId: number,
    update: any
  ): Promise<void> {
    // Implement status update
  }

  private async invalidateReservationCaches(tenantId: number): Promise<void> {
    // Implement cache invalidation
    const patterns = [
      `bff:admin:dashboard:${tenantId}:*`,
      `bff:admin:reservations:${tenantId}:*`
    ];
    
    for (const pattern of patterns) {
      await this.cache.deletePattern(pattern);
    }
  }

  private async calculateRevenue(params: any): Promise<any> {
    // Implement revenue calculation
    return {};
  }

  private async calculateUtilization(params: any): Promise<any> {
    // Implement utilization calculation
    return {};
  }

  private async calculateRetention(params: any): Promise<any> {
    // Implement retention calculation
    return {};
  }

  private async analyzeServicePerformance(params: any): Promise<any> {
    // Implement service performance analysis
    return {};
  }
}