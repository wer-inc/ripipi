/**
 * Booking Validator Service
 * Handles comprehensive validation of booking requests including business rules,
 * resource availability, time constraints, and policy compliance
 */

import { FastifyInstance } from 'fastify';
import {
  BookingRequest,
  MultiSlotBookingRequest,
  BookingValidationResult,
  BookingConflict,
  BookingPolicyConfig,
  BookingAvailabilityRequest,
  BookingAvailabilityResponse,
  CancellationReason
} from '../types/booking.js';
import { SlotConfig, BusinessHours, Holiday, ResourceTimeOff } from '../types/availability.js';
import { AvailabilityRepository } from '../repositories/availability.repository.js';
import { SlotService } from './slot.service.js';
import { CacheService } from './cache.service.js';
import { logger } from '../config/logger.js';
import { BadRequestError, ConflictError, NotFoundError } from '../utils/errors.js';
import { TimeSlotUtils } from '../utils/time-slot.js';

/**
 * Resource availability information
 */
interface ResourceInfo {
  id: string;
  name: string;
  capacity: number;
  isActive: boolean;
  businessHours: BusinessHours[];
  holidays: Holiday[];
  timeOffs: ResourceTimeOff[];
}

/**
 * Service requirements for validation
 */
interface ServiceRequirements {
  id: string;
  name: string;
  duration: number; // minutes
  capacity: number;
  bufferTime: number; // minutes
  isActive: boolean;
  requirements: {
    minAdvanceHours: number;
    maxAdvanceDays: number;
    allowWeekends: boolean;
    allowHolidays: boolean;
    requiresApproval: boolean;
  };
}

/**
 * Customer booking constraints
 */
interface CustomerConstraints {
  id: string;
  maxConcurrentBookings: number;
  maxBookingsPerDay: number;
  maxBookingsPerWeek: number;
  canBookWeekends: boolean;
  canBookHolidays: boolean;
  isBlacklisted: boolean;
  creditLimit: number;
  preferredLanguage: string;
}

/**
 * Comprehensive booking validator
 */
export class BookingValidatorService {
  private availabilityRepo: AvailabilityRepository;
  private slotService: SlotService;
  private cache: CacheService;

  constructor(private fastify: FastifyInstance) {
    this.availabilityRepo = new AvailabilityRepository();
    this.slotService = new SlotService(fastify);
    this.cache = new CacheService(fastify, {
      defaultTTL: 300, // 5 minutes
      memory: {
        enabled: true,
        maxSize: 16 * 1024 * 1024, // 16MB
        maxItems: 1000,
        ttlRatio: 0.3
      }
    });
  }

  /**
   * Validate a single booking request
   */
  async validateBookingRequest(
    request: BookingRequest,
    policyConfig?: BookingPolicyConfig
  ): Promise<BookingValidationResult> {
    const startTime = Date.now();

    try {
      const errors: string[] = [];
      const warnings: string[] = [];
      const suggestedAlternatives: Array<{
        resourceId: string;
        startTime: Date;
        endTime: Date;
        reason: string;
      }> = [];

      logger.debug('Starting booking validation', {
        tenantId: request.tenantId,
        customerId: request.customerId,
        resourceId: request.resourceId,
        startTime: request.startTime,
        endTime: request.endTime
      });

      // 1. Basic request validation
      const basicValidation = this.validateBasicRequest(request);
      if (!basicValidation.isValid) {
        errors.push(...basicValidation.errors);
      }
      warnings.push(...basicValidation.warnings);

      // 2. Get policy configuration
      const policy = policyConfig || await this.getBookingPolicy(request.tenantId);

      // 3. Time-based validation
      const timeValidation = await this.validateTimeConstraints(request, policy);
      if (!timeValidation.isValid) {
        errors.push(...timeValidation.errors);
      }
      warnings.push(...timeValidation.warnings);

      // 4. Resource validation
      const resourceValidation = await this.validateResourceAvailability(request);
      if (!resourceValidation.isValid) {
        errors.push(...resourceValidation.errors);
      }
      warnings.push(...resourceValidation.warnings);

      // 5. Service requirements validation
      const serviceValidation = await this.validateServiceRequirements(request);
      if (!serviceValidation.isValid) {
        errors.push(...serviceValidation.errors);
      }
      warnings.push(...serviceValidation.warnings);

      // 6. Customer constraints validation
      const customerValidation = await this.validateCustomerConstraints(request, policy);
      if (!customerValidation.isValid) {
        errors.push(...customerValidation.errors);
      }
      warnings.push(...customerValidation.warnings);

      // 7. Business hours validation
      const businessHoursValidation = await this.validateBusinessHours(request);
      if (!businessHoursValidation.isValid) {
        errors.push(...businessHoursValidation.errors);
        // Add suggested alternatives for business hours violations
        if (businessHoursValidation.suggestedAlternatives) {
          suggestedAlternatives.push(...businessHoursValidation.suggestedAlternatives);
        }
      }
      warnings.push(...businessHoursValidation.warnings);

      // 8. Capacity validation
      const capacityValidation = await this.validateCapacity(request);
      if (!capacityValidation.isValid) {
        errors.push(...capacityValidation.errors);
        // Add suggested alternatives for capacity issues
        if (capacityValidation.suggestedAlternatives) {
          suggestedAlternatives.push(...capacityValidation.suggestedAlternatives);
        }
      }
      warnings.push(...capacityValidation.warnings);

      // 9. Double booking prevention check
      if (policy.preventDoubleBooking) {
        const doubleBookingValidation = await this.validateDoubleBookingPrevention(request);
        if (!doubleBookingValidation.isValid) {
          errors.push(...doubleBookingValidation.errors);
        }
        warnings.push(...doubleBookingValidation.warnings);
      }

      const isValid = errors.length === 0;

      logger.debug('Booking validation completed', {
        tenantId: request.tenantId,
        duration: Date.now() - startTime,
        isValid,
        errorCount: errors.length,
        warningCount: warnings.length
      });

      return {
        isValid,
        errors: [...new Set(errors)], // Remove duplicates
        warnings: [...new Set(warnings)], // Remove duplicates
        suggestedAlternatives: suggestedAlternatives.slice(0, 5) // Limit to 5 suggestions
      };

    } catch (error) {
      logger.error('Booking validation failed', {
        tenantId: request.tenantId,
        error
      });

      return {
        isValid: false,
        errors: [`Validation failed: ${error.message}`],
        warnings: []
      };
    }
  }

  /**
   * Validate multiple slot booking request
   */
  async validateMultiSlotBooking(
    request: MultiSlotBookingRequest,
    policyConfig?: BookingPolicyConfig
  ): Promise<BookingValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestedAlternatives: Array<{
      resourceId: string;
      startTime: Date;
      endTime: Date;
      reason: string;
    }> = [];

    try {
      logger.debug('Starting multi-slot booking validation', {
        tenantId: request.tenantId,
        slotsCount: request.slots.length
      });

      // Validate each slot individually
      for (let i = 0; i < request.slots.length; i++) {
        const slot = request.slots[i];
        const singleRequest: BookingRequest = {
          tenantId: request.tenantId,
          customerId: request.customerId,
          serviceId: request.serviceId,
          resourceId: slot.resourceId,
          startTime: slot.startTime,
          endTime: slot.endTime,
          capacity: slot.capacity,
          notes: request.notes,
          idempotencyKey: `${request.idempotencyKey}_slot_${i}`,
          metadata: request.metadata
        };

        const slotValidation = await this.validateBookingRequest(singleRequest, policyConfig);
        
        if (!slotValidation.isValid) {
          errors.push(`Slot ${i + 1}: ${slotValidation.errors.join(', ')}`);
          
          if (request.requireAllSlots) {
            // If all slots are required and one fails, stop validation
            return {
              isValid: false,
              errors: [`Multi-slot booking failed - all slots required but slot ${i + 1} is invalid: ${slotValidation.errors.join(', ')}`],
              warnings
            };
          }
        }

        warnings.push(...slotValidation.warnings.map(w => `Slot ${i + 1}: ${w}`));
        
        if (slotValidation.suggestedAlternatives) {
          suggestedAlternatives.push(...slotValidation.suggestedAlternatives);
        }
      }

      // Cross-slot validation
      const crossSlotValidation = this.validateCrossSlotConstraints(request);
      if (!crossSlotValidation.isValid) {
        errors.push(...crossSlotValidation.errors);
      }
      warnings.push(...crossSlotValidation.warnings);

      return {
        isValid: errors.length === 0,
        errors: [...new Set(errors)],
        warnings: [...new Set(warnings)],
        suggestedAlternatives: suggestedAlternatives.slice(0, 10) // More suggestions for multi-slot
      };

    } catch (error) {
      logger.error('Multi-slot booking validation failed', {
        tenantId: request.tenantId,
        error
      });

      return {
        isValid: false,
        errors: [`Multi-slot validation failed: ${error.message}`],
        warnings
      };
    }
  }

  /**
   * Check booking availability without full validation
   */
  async checkBookingAvailability(
    request: BookingAvailabilityRequest
  ): Promise<BookingAvailabilityResponse> {
    try {
      const conflicts: BookingConflict[] = [];
      const capacity = request.capacity || 1;

      // Get resource information
      const resourceInfo = await this.getResourceInfo(request.tenantId, request.resourceId);
      if (!resourceInfo) {
        return {
          available: false,
          conflicts: [{
            type: 'RESOURCE_UNAVAILABLE',
            message: 'Resource not found or inactive'
          }],
          availableCapacity: 0,
          totalCapacity: 0
        };
      }

      // Check time slot availability
      const slots = await this.availabilityRepo.getAvailableSlots({
        tenantId: request.tenantId,
        resourceIds: [request.resourceId],
        startDate: request.startTime,
        endDate: request.endTime,
        capacity
      });

      const availableCapacity = slots.reduce((sum, slot) => sum + slot.availableCapacity, 0);
      const totalCapacity = resourceInfo.capacity;

      // Check for time overlaps with existing bookings
      if (availableCapacity < capacity) {
        conflicts.push({
          type: 'CAPACITY_EXCEEDED',
          message: `Insufficient capacity. Required: ${capacity}, Available: ${availableCapacity}`,
          availableCapacity,
          requiredCapacity: capacity
        });
      }

      // Check business hours
      const businessHoursCheck = this.checkBusinessHours(
        request.startTime,
        request.endTime,
        resourceInfo.businessHours
      );
      
      if (!businessHoursCheck.valid) {
        conflicts.push({
          type: 'BUSINESS_HOURS_VIOLATION',
          message: businessHoursCheck.message,
          suggestedStartTime: businessHoursCheck.suggestedStartTime,
          suggestedEndTime: businessHoursCheck.suggestedEndTime
        });
      }

      // Generate suggested slots if not available
      const suggestedSlots = conflicts.length > 0 
        ? await this.generateSuggestedSlots(request)
        : undefined;

      return {
        available: conflicts.length === 0,
        conflicts,
        availableCapacity,
        totalCapacity,
        suggestedSlots
      };

    } catch (error) {
      logger.error('Availability check failed', {
        tenantId: request.tenantId,
        resourceId: request.resourceId,
        error
      });

      return {
        available: false,
        conflicts: [{
          type: 'RESOURCE_UNAVAILABLE',
          message: `Availability check failed: ${error.message}`
        }],
        availableCapacity: 0,
        totalCapacity: 0
      };
    }
  }

  /**
   * Validate cancellation policy compliance
   */
  async validateCancellation(
    bookingId: string,
    tenantId: string,
    reason: CancellationReason,
    requestedAt: Date = new Date()
  ): Promise<{
    allowed: boolean;
    penaltyAmount: number;
    refundAmount: number;
    errors: string[];
  }> {
    try {
      // Get booking information
      const booking = await this.getBookingInfo(bookingId, tenantId);
      if (!booking) {
        return {
          allowed: false,
          penaltyAmount: 0,
          refundAmount: 0,
          errors: ['Booking not found']
        };
      }

      // Get policy configuration
      const policy = await this.getBookingPolicy(tenantId);
      const { cancellationPolicy } = policy;

      const errors: string[] = [];
      
      // Check if booking can be cancelled
      if (booking.status === 'cancelled') {
        errors.push('Booking is already cancelled');
      }
      
      if (booking.status === 'completed') {
        errors.push('Cannot cancel completed booking');
      }

      // Check timing constraints
      const hoursUntilStart = (booking.startTime.getTime() - requestedAt.getTime()) / (1000 * 60 * 60);
      
      if (hoursUntilStart < cancellationPolicy.allowedUntilHours) {
        if (reason !== 'EMERGENCY' && reason !== 'BUSINESS_CLOSURE') {
          errors.push(`Cancellation not allowed within ${cancellationPolicy.allowedUntilHours} hours of start time`);
        }
      }

      // Calculate penalty and refund
      let penaltyAmount = 0;
      let refundAmount = booking.totalJpy;

      if (cancellationPolicy.refundPolicy === 'NONE') {
        refundAmount = 0;
        penaltyAmount = booking.totalJpy;
      } else if (cancellationPolicy.refundPolicy === 'PARTIAL') {
        penaltyAmount = Math.round(booking.totalJpy * (cancellationPolicy.penaltyPercentage / 100));
        refundAmount = booking.totalJpy - penaltyAmount;
      }

      // Emergency cancellations get full refund
      if (reason === 'EMERGENCY' || reason === 'BUSINESS_CLOSURE') {
        penaltyAmount = 0;
        refundAmount = booking.totalJpy;
      }

      return {
        allowed: errors.length === 0,
        penaltyAmount,
        refundAmount,
        errors
      };

    } catch (error) {
      logger.error('Cancellation validation failed', {
        bookingId,
        tenantId,
        error
      });

      return {
        allowed: false,
        penaltyAmount: 0,
        refundAmount: 0,
        errors: [`Cancellation validation failed: ${error.message}`]
      };
    }
  }

  // Private validation methods

  private validateBasicRequest(request: BookingRequest): BookingValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!request.tenantId) errors.push('Tenant ID is required');
    if (!request.customerId) errors.push('Customer ID is required');
    if (!request.serviceId) errors.push('Service ID is required');
    if (!request.resourceId) errors.push('Resource ID is required');
    if (!request.startTime) errors.push('Start time is required');
    if (!request.endTime) errors.push('End time is required');
    if (!request.idempotencyKey) errors.push('Idempotency key is required');

    // Time validation
    if (request.startTime && request.endTime) {
      if (request.startTime >= request.endTime) {
        errors.push('Start time must be before end time');
      }

      const duration = (request.endTime.getTime() - request.startTime.getTime()) / (1000 * 60);
      if (duration < 5) {
        errors.push('Booking duration must be at least 5 minutes');
      }
      if (duration > 480) { // 8 hours
        warnings.push('Booking duration exceeds 8 hours');
      }
    }

    // Capacity validation
    if (request.capacity && request.capacity < 1) {
      errors.push('Capacity must be at least 1');
    }
    if (request.capacity && request.capacity > 100) {
      warnings.push('Large capacity booking requested');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  private async validateTimeConstraints(
    request: BookingRequest,
    policy: BookingPolicyConfig
  ): Promise<BookingValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const now = new Date();

    // Check if booking is in the past
    if (request.startTime <= now) {
      errors.push('Cannot book in the past');
    }

    // Check advance booking limits
    const daysInAdvance = (request.startTime.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (daysInAdvance > policy.advanceBookingDays) {
      errors.push(`Cannot book more than ${policy.advanceBookingDays} days in advance`);
    }

    // Check duration constraints
    const duration = (request.endTime.getTime() - request.startTime.getTime()) / (1000 * 60);
    if (duration < policy.minBookingDuration) {
      errors.push(`Booking duration must be at least ${policy.minBookingDuration} minutes`);
    }
    if (duration > policy.maxBookingDuration) {
      errors.push(`Booking duration cannot exceed ${policy.maxBookingDuration} minutes`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  private async validateResourceAvailability(
    request: BookingRequest
  ): Promise<BookingValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const resourceInfo = await this.getResourceInfo(request.tenantId, request.resourceId);
      
      if (!resourceInfo) {
        errors.push('Resource not found');
        return { isValid: false, errors, warnings };
      }

      if (!resourceInfo.isActive) {
        errors.push('Resource is not active');
      }

      if (request.capacity && request.capacity > resourceInfo.capacity) {
        errors.push(`Requested capacity (${request.capacity}) exceeds resource capacity (${resourceInfo.capacity})`);
      }

    } catch (error) {
      errors.push(`Resource validation failed: ${error.message}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  private async validateServiceRequirements(
    request: BookingRequest
  ): Promise<BookingValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const serviceInfo = await this.getServiceInfo(request.tenantId, request.serviceId);
      
      if (!serviceInfo) {
        errors.push('Service not found');
        return { isValid: false, errors, warnings };
      }

      if (!serviceInfo.isActive) {
        errors.push('Service is not active');
      }

      // Check duration
      const requestDuration = (request.endTime.getTime() - request.startTime.getTime()) / (1000 * 60);
      if (Math.abs(requestDuration - serviceInfo.duration) > 5) {
        warnings.push(`Booking duration (${requestDuration} min) differs from service duration (${serviceInfo.duration} min)`);
      }

      // Check advance booking requirements
      const now = new Date();
      const hoursInAdvance = (request.startTime.getTime() - now.getTime()) / (1000 * 60 * 60);
      
      if (hoursInAdvance < serviceInfo.requirements.minAdvanceHours) {
        errors.push(`Service requires at least ${serviceInfo.requirements.minAdvanceHours} hours advance booking`);
      }

      const daysInAdvance = hoursInAdvance / 24;
      if (daysInAdvance > serviceInfo.requirements.maxAdvanceDays) {
        errors.push(`Service cannot be booked more than ${serviceInfo.requirements.maxAdvanceDays} days in advance`);
      }

      // Check weekend/holiday restrictions
      const dayOfWeek = request.startTime.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      
      if (isWeekend && !serviceInfo.requirements.allowWeekends) {
        errors.push('Service is not available on weekends');
      }

    } catch (error) {
      errors.push(`Service validation failed: ${error.message}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  private async validateCustomerConstraints(
    request: BookingRequest,
    policy: BookingPolicyConfig
  ): Promise<BookingValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const customerInfo = await this.getCustomerInfo(request.tenantId, request.customerId);
      
      if (!customerInfo) {
        errors.push('Customer not found');
        return { isValid: false, errors, warnings };
      }

      if (customerInfo.isBlacklisted) {
        errors.push('Customer is blacklisted');
      }

      // Check concurrent booking limits
      const activeBokings = await this.getActiveBookingCount(request.tenantId, request.customerId);
      if (activeBokings >= customerInfo.maxConcurrentBookings) {
        errors.push(`Customer has reached maximum concurrent bookings limit (${customerInfo.maxConcurrentBookings})`);
      }

    } catch (error) {
      errors.push(`Customer validation failed: ${error.message}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  private async validateBusinessHours(
    request: BookingRequest
  ): Promise<BookingValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestedAlternatives: Array<{
      resourceId: string;
      startTime: Date;
      endTime: Date;
      reason: string;
    }> = [];

    try {
      const resourceInfo = await this.getResourceInfo(request.tenantId, request.resourceId);
      if (!resourceInfo) {
        return { isValid: false, errors: ['Resource not found'], warnings };
      }

      const businessHoursCheck = this.checkBusinessHours(
        request.startTime,
        request.endTime,
        resourceInfo.businessHours
      );

      if (!businessHoursCheck.valid) {
        errors.push(businessHoursCheck.message);
        
        // Add suggestion for next available slot
        if (businessHoursCheck.suggestedStartTime && businessHoursCheck.suggestedEndTime) {
          suggestedAlternatives.push({
            resourceId: request.resourceId,
            startTime: businessHoursCheck.suggestedStartTime,
            endTime: businessHoursCheck.suggestedEndTime,
            reason: 'Adjusted to business hours'
          });
        }
      }

    } catch (error) {
      errors.push(`Business hours validation failed: ${error.message}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      suggestedAlternatives
    };
  }

  private async validateCapacity(
    request: BookingRequest
  ): Promise<BookingValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestedAlternatives: Array<{
      resourceId: string;
      startTime: Date;
      endTime: Date;
      reason: string;
    }> = [];

    try {
      const capacity = request.capacity || 1;
      
      // Check actual slot availability
      const availableSlots = await this.availabilityRepo.getAvailableSlots({
        tenantId: request.tenantId,
        resourceIds: [request.resourceId],
        startDate: request.startTime,
        endDate: request.endTime,
        capacity
      });

      const totalAvailableCapacity = availableSlots.reduce((sum, slot) => sum + slot.availableCapacity, 0);
      
      if (totalAvailableCapacity < capacity) {
        errors.push(`Insufficient capacity. Requested: ${capacity}, Available: ${totalAvailableCapacity}`);
        
        // Suggest alternative times with available capacity
        const alternatives = await this.findAlternativeSlots(request, 3);
        suggestedAlternatives.push(...alternatives);
      }

    } catch (error) {
      errors.push(`Capacity validation failed: ${error.message}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      suggestedAlternatives
    };
  }

  private async validateDoubleBookingPrevention(
    request: BookingRequest
  ): Promise<BookingValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Check for overlapping bookings for the same customer
      const overlappingBookings = await this.findOverlappingBookings(
        request.tenantId,
        request.customerId,
        request.startTime,
        request.endTime
      );

      if (overlappingBookings.length > 0) {
        errors.push(`Customer already has ${overlappingBookings.length} overlapping booking(s)`);
      }

    } catch (error) {
      errors.push(`Double booking check failed: ${error.message}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  private validateCrossSlotConstraints(
    request: MultiSlotBookingRequest
  ): BookingValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for overlapping time slots
    for (let i = 0; i < request.slots.length; i++) {
      for (let j = i + 1; j < request.slots.length; j++) {
        const slot1 = request.slots[i];
        const slot2 = request.slots[j];

        // Check if slots overlap in time
        const overlap = slot1.startTime < slot2.endTime && slot2.startTime < slot1.endTime;
        if (overlap && slot1.resourceId === slot2.resourceId) {
          errors.push(`Slots ${i + 1} and ${j + 1} overlap on the same resource`);
        }
      }
    }

    // Check total duration
    const totalDuration = request.slots.reduce((sum, slot) => {
      return sum + (slot.endTime.getTime() - slot.startTime.getTime()) / (1000 * 60);
    }, 0);

    if (totalDuration > 480) { // 8 hours
      warnings.push(`Total booking duration (${totalDuration} minutes) is very long`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  // Helper methods for data retrieval

  private async getBookingPolicy(tenantId: string): Promise<BookingPolicyConfig> {
    const cacheKey = `booking_policy:${tenantId}`;
    
    let policy = await this.cache.get<BookingPolicyConfig>(cacheKey);
    if (policy) {
      return policy;
    }

    // Default policy if not found
    policy = {
      minBookingDuration: 15,
      maxBookingDuration: 480,
      advanceBookingDays: 30,
      maxConcurrentBookings: 5,
      cancellationPolicy: {
        allowedUntilHours: 24,
        penaltyPercentage: 10,
        refundPolicy: 'PARTIAL'
      },
      preventDoubleBooking: true,
      allowOverbooking: false,
      requirePaymentConfirmation: false,
      autoReleaseUnconfirmedMinutes: 15
    };

    await this.cache.set(cacheKey, policy, 3600); // Cache for 1 hour
    return policy;
  }

  private async getResourceInfo(tenantId: string, resourceId: string): Promise<ResourceInfo | null> {
    try {
      const cacheKey = `resource_info:${tenantId}:${resourceId}`;
      
      let resourceInfo = await this.cache.get<ResourceInfo>(cacheKey);
      if (resourceInfo) {
        return resourceInfo;
      }

      // Fetch from database (simplified)
      const result = await this.fastify.db.queryForTenant<any>(
        tenantId,
        `
        SELECT r.*, 
               COALESCE(r.capacity, 1) as capacity,
               CASE WHEN r.status = 'active' THEN true ELSE false END as is_active
        FROM resources r
        WHERE r.id = $1
        `,
        [resourceId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const resource = result.rows[0];
      
      // Get business hours, holidays, and time-offs
      const [businessHours, holidays, timeOffs] = await Promise.all([
        this.availabilityRepo.getBusinessHours(tenantId, resourceId),
        this.availabilityRepo.getHolidays(tenantId, new Date(), new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), resourceId),
        this.availabilityRepo.getResourceTimeOffs(tenantId, resourceId, new Date(), new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
      ]);

      resourceInfo = {
        id: resource.id.toString(),
        name: resource.name,
        capacity: resource.capacity,
        isActive: resource.is_active,
        businessHours: businessHours.map(bh => ({
          id: bh.id.toString(),
          tenantId,
          resourceId,
          dayOfWeek: bh.day_of_week,
          openTime: bh.open_time,
          closeTime: bh.close_time,
          effectiveFrom: bh.effective_from,
          effectiveTo: bh.effective_to
        })),
        holidays: holidays.map(h => ({
          id: h.id.toString(),
          tenantId,
          resourceId,
          date: h.date,
          name: h.name
        })),
        timeOffs: timeOffs.map(to => ({
          id: to.id.toString(),
          tenantId,
          resourceId,
          startTime: to.start_at,
          endTime: to.end_at,
          reason: to.reason
        }))
      };

      await this.cache.set(cacheKey, resourceInfo, 1800); // Cache for 30 minutes
      return resourceInfo;

    } catch (error) {
      logger.error('Failed to get resource info', { tenantId, resourceId, error });
      return null;
    }
  }

  private async getServiceInfo(tenantId: string, serviceId: string): Promise<ServiceRequirements | null> {
    try {
      const cacheKey = `service_info:${tenantId}:${serviceId}`;
      
      let serviceInfo = await this.cache.get<ServiceRequirements>(cacheKey);
      if (serviceInfo) {
        return serviceInfo;
      }

      const result = await this.fastify.db.queryForTenant<any>(
        tenantId,
        `
        SELECT s.*,
               CASE WHEN s.status = 'active' THEN true ELSE false END as is_active
        FROM services s
        WHERE s.id = $1
        `,
        [serviceId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const service = result.rows[0];
      
      serviceInfo = {
        id: service.id.toString(),
        name: service.name,
        duration: service.duration_minutes || 60,
        capacity: service.capacity || 1,
        bufferTime: service.buffer_time_minutes || 0,
        isActive: service.is_active,
        requirements: {
          minAdvanceHours: service.min_advance_hours || 1,
          maxAdvanceDays: service.max_advance_days || 30,
          allowWeekends: service.allow_weekends !== false,
          allowHolidays: service.allow_holidays !== false,
          requiresApproval: service.requires_approval === true
        }
      };

      await this.cache.set(cacheKey, serviceInfo, 3600); // Cache for 1 hour
      return serviceInfo;

    } catch (error) {
      logger.error('Failed to get service info', { tenantId, serviceId, error });
      return null;
    }
  }

  private async getCustomerInfo(tenantId: string, customerId: string): Promise<CustomerConstraints | null> {
    try {
      const cacheKey = `customer_info:${tenantId}:${customerId}`;
      
      let customerInfo = await this.cache.get<CustomerConstraints>(cacheKey);
      if (customerInfo) {
        return customerInfo;
      }

      const result = await this.fastify.db.queryForTenant<any>(
        tenantId,
        `
        SELECT c.*,
               CASE WHEN c.status = 'blacklisted' THEN true ELSE false END as is_blacklisted
        FROM customers c
        WHERE c.id = $1
        `,
        [customerId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const customer = result.rows[0];
      
      customerInfo = {
        id: customer.id.toString(),
        maxConcurrentBookings: customer.max_concurrent_bookings || 5,
        maxBookingsPerDay: customer.max_bookings_per_day || 10,
        maxBookingsPerWeek: customer.max_bookings_per_week || 50,
        canBookWeekends: customer.can_book_weekends !== false,
        canBookHolidays: customer.can_book_holidays !== false,
        isBlacklisted: customer.is_blacklisted,
        creditLimit: customer.credit_limit || 0,
        preferredLanguage: customer.preferred_language || 'ja'
      };

      await this.cache.set(cacheKey, customerInfo, 1800); // Cache for 30 minutes
      return customerInfo;

    } catch (error) {
      logger.error('Failed to get customer info', { tenantId, customerId, error });
      return null;
    }
  }

  private async getBookingInfo(bookingId: string, tenantId: string): Promise<any> {
    const result = await this.fastify.db.queryForTenant<any>(
      tenantId,
      `
      SELECT b.*
      FROM bookings b
      WHERE b.id = $1
      `,
      [bookingId]
    );

    return result.rows[0] || null;
  }

  private async getActiveBookingCount(tenantId: string, customerId: string): Promise<number> {
    const result = await this.fastify.db.queryForTenant<any>(
      tenantId,
      `
      SELECT COUNT(*) as count
      FROM bookings b
      WHERE b.customer_id = $1 
        AND b.status IN ('tentative', 'confirmed')
        AND b.end_at > NOW()
      `,
      [customerId]
    );

    return parseInt(result.rows[0]?.count || '0');
  }

  private async findOverlappingBookings(
    tenantId: string,
    customerId: string,
    startTime: Date,
    endTime: Date
  ): Promise<any[]> {
    const result = await this.fastify.db.queryForTenant<any>(
      tenantId,
      `
      SELECT b.*
      FROM bookings b
      WHERE b.customer_id = $1 
        AND b.status IN ('tentative', 'confirmed')
        AND b.start_at < $3
        AND b.end_at > $2
      `,
      [customerId, startTime, endTime]
    );

    return result.rows;
  }

  private checkBusinessHours(
    startTime: Date,
    endTime: Date,
    businessHours: BusinessHours[]
  ): {
    valid: boolean;
    message: string;
    suggestedStartTime?: Date;
    suggestedEndTime?: Date;
  } {
    const dayOfWeek = startTime.getDay();
    const dayBusinessHours = businessHours.filter(bh => bh.dayOfWeek === dayOfWeek);

    if (dayBusinessHours.length === 0) {
      return {
        valid: false,
        message: 'No business hours defined for this day'
      };
    }

    // Check if the booking time falls within any business hours window
    for (const bh of dayBusinessHours) {
      const openTime = this.parseTimeString(bh.openTime);
      const closeTime = this.parseTimeString(bh.closeTime);
      
      const bookingStartHour = startTime.getHours() + startTime.getMinutes() / 60;
      const bookingEndHour = endTime.getHours() + endTime.getMinutes() / 60;

      if (bookingStartHour >= openTime && bookingEndHour <= closeTime) {
        return { valid: true, message: 'Within business hours' };
      }
    }

    // Suggest next available time
    const firstBusinessHour = dayBusinessHours[0];
    const suggestedStartTime = new Date(startTime);
    const suggestedEndTime = new Date(endTime);
    
    const openTime = this.parseTimeString(firstBusinessHour.openTime);
    suggestedStartTime.setHours(Math.floor(openTime), (openTime % 1) * 60, 0, 0);
    
    const duration = endTime.getTime() - startTime.getTime();
    suggestedEndTime.setTime(suggestedStartTime.getTime() + duration);

    return {
      valid: false,
      message: 'Booking time is outside business hours',
      suggestedStartTime,
      suggestedEndTime
    };
  }

  private parseTimeString(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours + minutes / 60;
  }

  private async findAlternativeSlots(
    request: BookingRequest,
    maxSuggestions: number
  ): Promise<Array<{
    resourceId: string;
    startTime: Date;
    endTime: Date;
    reason: string;
  }>> {
    const alternatives: Array<{
      resourceId: string;
      startTime: Date;
      endTime: Date;
      reason: string;
    }> = [];

    try {
      const duration = request.endTime.getTime() - request.startTime.getTime();
      const capacity = request.capacity || 1;

      // Look for alternatives in the next 7 days
      for (let dayOffset = 0; dayOffset < 7 && alternatives.length < maxSuggestions; dayOffset++) {
        const searchDate = new Date(request.startTime.getTime() + dayOffset * 24 * 60 * 60 * 1000);
        const endSearchDate = new Date(searchDate.getTime() + 24 * 60 * 60 * 1000);

        const availableSlots = await this.availabilityRepo.getAvailableSlots({
          tenantId: request.tenantId,
          resourceIds: [request.resourceId],
          startDate: searchDate,
          endDate: endSearchDate,
          capacity
        });

        for (const slot of availableSlots) {
          if (slot.availableCapacity >= capacity) {
            const altEndTime = new Date(slot.startTime.getTime() + duration);
            
            if (altEndTime <= slot.endTime) {
              alternatives.push({
                resourceId: request.resourceId,
                startTime: slot.startTime,
                endTime: altEndTime,
                reason: dayOffset === 0 ? 'Same day alternative' : `Alternative ${dayOffset} day(s) later`
              });

              if (alternatives.length >= maxSuggestions) break;
            }
          }
        }
      }

    } catch (error) {
      logger.error('Failed to find alternative slots', {
        tenantId: request.tenantId,
        resourceId: request.resourceId,
        error
      });
    }

    return alternatives;
  }

  private async generateSuggestedSlots(
    request: BookingAvailabilityRequest
  ): Promise<Array<{
    startTime: Date;
    endTime: Date;
    availableCapacity: number;
  }>> {
    const suggestions: Array<{
      startTime: Date;
      endTime: Date;
      availableCapacity: number;
    }> = [];

    try {
      const duration = request.endTime.getTime() - request.startTime.getTime();
      const searchEndDate = new Date(request.startTime.getTime() + 7 * 24 * 60 * 60 * 1000);

      const availableSlots = await this.availabilityRepo.getAvailableSlots({
        tenantId: request.tenantId,
        resourceIds: [request.resourceId],
        startDate: request.startTime,
        endDate: searchEndDate,
        capacity: request.capacity
      });

      for (const slot of availableSlots.slice(0, 5)) {
        const suggestedEndTime = new Date(slot.startTime.getTime() + duration);
        
        if (suggestedEndTime <= slot.endTime) {
          suggestions.push({
            startTime: slot.startTime,
            endTime: suggestedEndTime,
            availableCapacity: slot.availableCapacity
          });
        }
      }

    } catch (error) {
      logger.error('Failed to generate suggested slots', { request, error });
    }

    return suggestions;
  }
}

export default BookingValidatorService;