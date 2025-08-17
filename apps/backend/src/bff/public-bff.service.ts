/**
 * Public BFF Service
 * Backend for Frontend layer for public-facing APIs
 * Aggregates and optimizes data for LIFF and public endpoints
 */

import { FastifyInstance } from 'fastify';
import { CacheService } from '../services/cache.service.js';
import { AvailabilityService } from '../services/availability.service.js';
import { BookingService } from '../services/booking.service.js';
import { ContinuousBookingService } from '../services/continuous-booking.service.js';
import { logger } from '../config/logger.js';
import crypto from 'crypto';

/**
 * Public booking creation request (aggregated)
 */
export interface PublicBookingRequestBFF {
  tenantId: number;
  serviceId: number;
  startTime: Date;
  customer: {
    name: string;
    phone?: string;
    email?: string;
    lineUserId?: string;
  };
  notes?: string;
  consentVersion?: string;
  specialRequests?: string[];
}

/**
 * Public availability response (optimized)
 */
export interface PublicAvailabilityResponseBFF {
  serviceId: number;
  serviceName: string;
  duration: number;
  price: number;
  currency: string;
  availableSlots: Array<{
    startTime: string;
    endTime: string;
    resourceId: number;
    resourceName: string;
    capacity: number;
    isOptimal?: boolean;
    congestionLevel?: 'LOW' | 'MODERATE' | 'HIGH';
  }>;
  nextAvailable?: string;
  recommendedTimes?: string[];
}

/**
 * Public menu/service response (aggregated)
 */
export interface PublicMenuResponseBFF {
  categories: Array<{
    id: string;
    name: string;
    displayOrder: number;
    services: Array<{
      id: number;
      name: string;
      description: string;
      duration: number;
      price: number;
      images?: string[];
      tags?: string[];
      availability: 'AVAILABLE' | 'LIMITED' | 'UNAVAILABLE';
    }>;
  }>;
  promotions?: Array<{
    id: string;
    title: string;
    description: string;
    discountPercent?: number;
    validUntil: string;
  }>;
}

/**
 * Public BFF Service
 */
export class PublicBFFService {
  private cache: CacheService;
  private availability: AvailabilityService;
  private booking: BookingService;
  private continuousBooking: ContinuousBookingService;
  
  constructor(private fastify: FastifyInstance) {
    this.cache = new CacheService(fastify);
    this.availability = new AvailabilityService(fastify);
    this.booking = new BookingService(fastify);
    this.continuousBooking = new ContinuousBookingService(fastify);
  }

  /**
   * Get aggregated availability with recommendations
   */
  async getAggregatedAvailability(params: {
    tenantId: number;
    serviceId: number;
    date: Date;
    partySize?: number;
  }): Promise<PublicAvailabilityResponseBFF> {
    const cacheKey = `bff:availability:${params.tenantId}:${params.serviceId}:${params.date.toISOString()}`;
    
    // Check cache first
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      logger.debug('BFF cache hit for availability', { cacheKey });
      return cached;
    }
    
    try {
      // Fetch service details
      const serviceDetails = await this.getServiceDetails(params.serviceId);
      
      // Get availability from multiple sources
      const [availabilityData, congestionData, recommendations] = await Promise.all([
        this.availability.searchAvailability({
          tenantId: params.tenantId,
          serviceId: params.serviceId,
          startTime: params.date,
          endTime: new Date(params.date.getTime() + 24 * 60 * 60 * 1000),
          capacity: params.partySize || 1
        }),
        this.getCongestionLevels(params.tenantId, params.date),
        this.getRecommendedTimes(params.tenantId, params.serviceId, params.date)
      ]);
      
      // Aggregate and optimize data
      const response: PublicAvailabilityResponseBFF = {
        serviceId: serviceDetails.id,
        serviceName: serviceDetails.name,
        duration: serviceDetails.duration,
        price: serviceDetails.price,
        currency: serviceDetails.currency || 'JPY',
        availableSlots: availabilityData.map(slot => ({
          startTime: slot.startTime.toISOString(),
          endTime: slot.endTime.toISOString(),
          resourceId: slot.resourceId,
          resourceName: slot.resourceName || `Resource ${slot.resourceId}`,
          capacity: slot.availableCapacity,
          isOptimal: recommendations.optimal.includes(slot.startTime.toISOString()),
          congestionLevel: congestionData[slot.startTime.toISOString()] || 'LOW'
        })),
        nextAvailable: availabilityData[0]?.startTime.toISOString(),
        recommendedTimes: recommendations.times
      };
      
      // Cache for 30 seconds
      await this.cache.set(cacheKey, response, 30);
      
      return response;
      
    } catch (error) {
      logger.error('Failed to get aggregated availability', { error, params });
      throw error;
    }
  }

  /**
   * Create booking with all necessary aggregations
   */
  async createAggregatedBooking(
    request: PublicBookingRequestBFF,
    idempotencyKey: string
  ): Promise<{
    bookingId: number;
    confirmationCode: string;
    estimatedEndTime: string;
    totalAmount: number;
    paymentStatus: 'PENDING' | 'COMPLETED' | 'NOT_REQUIRED';
    notifications: Array<{
      type: string;
      scheduledAt: string;
    }>;
  }> {
    try {
      // Get or create customer
      const customerId = await this.getOrCreateCustomer(
        request.tenantId,
        request.customer
      );
      
      // Get service details for duration calculation
      const serviceDetails = await this.getServiceDetails(request.serviceId);
      
      // Create booking using continuous slot service
      const bookingResult = await this.continuousBooking.bookContinuousSlots({
        tenantId: request.tenantId,
        serviceId: request.serviceId,
        resourceId: 0, // Will be auto-assigned
        startTime: request.startTime,
        durationMinutes: serviceDetails.duration,
        customerId,
        metadata: {
          notes: request.notes,
          consentVersion: request.consentVersion,
          specialRequests: request.specialRequests,
          source: 'public_bff',
          idempotencyKey
        }
      });
      
      // Generate confirmation code
      const confirmationCode = this.generateConfirmationCode(bookingResult.bookingId);
      
      // Schedule notifications
      const notifications = await this.scheduleNotifications(
        request.tenantId,
        bookingResult.bookingId,
        request.startTime
      );
      
      // Check if payment is required
      const paymentStatus = serviceDetails.requiresPayment 
        ? 'PENDING' 
        : 'NOT_REQUIRED';
      
      return {
        bookingId: bookingResult.bookingId,
        confirmationCode,
        estimatedEndTime: bookingResult.endTime.toISOString(),
        totalAmount: serviceDetails.price,
        paymentStatus,
        notifications
      };
      
    } catch (error) {
      logger.error('Failed to create aggregated booking', { error, request });
      throw error;
    }
  }

  /**
   * Get aggregated menu/services with availability status
   */
  async getAggregatedMenu(params: {
    tenantId: number;
    date?: Date;
    categoryId?: string;
  }): Promise<PublicMenuResponseBFF> {
    const cacheKey = `bff:menu:${params.tenantId}:${params.date?.toISOString() || 'all'}:${params.categoryId || 'all'}`;
    
    // Check cache
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    try {
      // Fetch menu data
      const [categories, services, promotions] = await Promise.all([
        this.getCategories(params.tenantId),
        this.getServices(params.tenantId, params.categoryId),
        this.getActivePromotions(params.tenantId)
      ]);
      
      // Check availability for each service if date is provided
      let serviceAvailability: Map<number, string> = new Map();
      if (params.date) {
        serviceAvailability = await this.checkServicesAvailability(
          params.tenantId,
          services.map(s => s.id),
          params.date
        );
      }
      
      // Aggregate response
      const response: PublicMenuResponseBFF = {
        categories: categories.map(category => ({
          id: category.id,
          name: category.name,
          displayOrder: category.displayOrder,
          services: services
            .filter(s => s.categoryId === category.id)
            .map(service => ({
              id: service.id,
              name: service.name,
              description: service.description,
              duration: service.duration,
              price: service.price,
              images: service.images,
              tags: service.tags,
              availability: (serviceAvailability.get(service.id) || 'AVAILABLE') as any
            }))
        })),
        promotions: promotions.map(promo => ({
          id: promo.id,
          title: promo.title,
          description: promo.description,
          discountPercent: promo.discountPercent,
          validUntil: promo.validUntil.toISOString()
        }))
      };
      
      // Cache for 5 minutes
      await this.cache.set(cacheKey, response, 300);
      
      return response;
      
    } catch (error) {
      logger.error('Failed to get aggregated menu', { error, params });
      throw error;
    }
  }

  /**
   * Get booking status with real-time updates
   */
  async getBookingStatus(
    tenantId: number,
    confirmationCode: string
  ): Promise<{
    status: string;
    currentStep: string;
    estimatedWaitTime?: number;
    queuePosition?: number;
    notifications: Array<{
      type: string;
      sentAt?: string;
      scheduledAt: string;
    }>;
  }> {
    try {
      const bookingId = this.decodeConfirmationCode(confirmationCode);
      
      // Get booking details
      const booking = await this.booking.getBookingById(bookingId, tenantId);
      
      // Get queue position if applicable
      const queueInfo = await this.getQueuePosition(tenantId, bookingId);
      
      // Get notification status
      const notifications = await this.getNotificationStatus(tenantId, bookingId);
      
      return {
        status: booking.status,
        currentStep: this.mapStatusToStep(booking.status),
        estimatedWaitTime: queueInfo?.estimatedWaitTime,
        queuePosition: queueInfo?.position,
        notifications
      };
      
    } catch (error) {
      logger.error('Failed to get booking status', { error, confirmationCode });
      throw error;
    }
  }

  // Private helper methods

  private async getServiceDetails(serviceId: number): Promise<any> {
    // Implement service details fetching
    return {
      id: serviceId,
      name: 'Service Name',
      duration: 30,
      price: 5000,
      currency: 'JPY',
      requiresPayment: false
    };
  }

  private async getCongestionLevels(
    tenantId: number,
    date: Date
  ): Promise<Record<string, 'LOW' | 'MODERATE' | 'HIGH'>> {
    // Implement congestion level calculation
    return {};
  }

  private async getRecommendedTimes(
    tenantId: number,
    serviceId: number,
    date: Date
  ): Promise<{ optimal: string[]; times: string[] }> {
    // Implement recommendation logic
    return {
      optimal: [],
      times: []
    };
  }

  private async getOrCreateCustomer(
    tenantId: number,
    customer: any
  ): Promise<number> {
    // Implement customer creation/retrieval
    return 1;
  }

  private generateConfirmationCode(bookingId: number): string {
    const hash = crypto.createHash('sha256')
      .update(`${bookingId}-${Date.now()}`)
      .digest('hex');
    return hash.substring(0, 8).toUpperCase();
  }

  private decodeConfirmationCode(code: string): number {
    // Implement confirmation code decoding
    return 1;
  }

  private async scheduleNotifications(
    tenantId: number,
    bookingId: number,
    startTime: Date
  ): Promise<Array<{ type: string; scheduledAt: string }>> {
    // Implement notification scheduling
    return [
      {
        type: 'reminder_24h',
        scheduledAt: new Date(startTime.getTime() - 24 * 60 * 60 * 1000).toISOString()
      },
      {
        type: 'reminder_2h',
        scheduledAt: new Date(startTime.getTime() - 2 * 60 * 60 * 1000).toISOString()
      }
    ];
  }

  private async getCategories(tenantId: number): Promise<any[]> {
    // Implement category fetching
    return [];
  }

  private async getServices(tenantId: number, categoryId?: string): Promise<any[]> {
    // Implement service fetching
    return [];
  }

  private async getActivePromotions(tenantId: number): Promise<any[]> {
    // Implement promotion fetching
    return [];
  }

  private async checkServicesAvailability(
    tenantId: number,
    serviceIds: number[],
    date: Date
  ): Promise<Map<number, string>> {
    // Implement availability checking
    return new Map();
  }

  private async getQueuePosition(
    tenantId: number,
    bookingId: number
  ): Promise<{ position: number; estimatedWaitTime: number } | null> {
    // Implement queue position calculation
    return null;
  }

  private async getNotificationStatus(
    tenantId: number,
    bookingId: number
  ): Promise<Array<{ type: string; sentAt?: string; scheduledAt: string }>> {
    // Implement notification status fetching
    return [];
  }

  private mapStatusToStep(status: string): string {
    const statusMap: Record<string, string> = {
      'tentative': '予約確認中',
      'confirmed': '予約確定',
      'arrived': 'チェックイン済み',
      'in_progress': 'サービス中',
      'completed': '完了',
      'cancelled': 'キャンセル済み',
      'no_show': '来店なし'
    };
    return statusMap[status] || status;
  }
}