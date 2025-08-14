/**
 * Booking Types
 * Comprehensive type definitions for booking system with double-booking prevention
 */

import { BaseEntity } from './database.js';
import { TimeSlot } from './availability.js';

/**
 * Booking status enum
 */
export type BookingStatus = 
  | 'tentative'    // Temporary reservation (has time limit)
  | 'confirmed'    // Confirmed booking
  | 'cancelled'    // Cancelled booking
  | 'noshow'       // Customer didn't show up
  | 'completed';   // Service completed

/**
 * Booking change type for history tracking
 */
export type BookingChangeType =
  | 'CREATED'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'RESCHEDULED'
  | 'MODIFIED'
  | 'COMPLETED'
  | 'MARKED_NOSHOW';

/**
 * Cancellation reason codes
 */
export type CancellationReason =
  | 'CUSTOMER_REQUEST'
  | 'BUSINESS_CLOSURE'
  | 'RESOURCE_UNAVAILABLE'
  | 'EMERGENCY'
  | 'SYSTEM_ERROR'
  | 'DUPLICATE_BOOKING'
  | 'PAYMENT_FAILED';

/**
 * Notification types for booking events
 */
export type NotificationType =
  | 'EMAIL'
  | 'SMS'
  | 'PUSH'
  | 'WEBHOOK';

/**
 * Basic booking request structure
 */
export interface BookingRequest {
  tenantId: string;
  customerId: string;
  serviceId: string;
  resourceId: string;
  startTime: Date;
  endTime: Date;
  capacity?: number;
  notes?: string;
  idempotencyKey: string;
  metadata?: Record<string, any>;
}

/**
 * Booking response structure
 */
export interface BookingResponse {
  id: string;
  tenantId: string;
  customerId: string;
  serviceId: string;
  resourceId: string;
  startTime: Date;
  endTime: Date;
  status: BookingStatus;
  totalJpy: number;
  maxPenaltyJpy: number;
  idempotencyKey: string;
  bookedSlots: TimeSlot[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date; // For tentative bookings
  metadata?: Record<string, any>;
}

/**
 * Multi-slot booking request for complex services
 */
export interface MultiSlotBookingRequest {
  tenantId: string;
  customerId: string;
  serviceId: string;
  slots: Array<{
    resourceId: string;
    startTime: Date;
    endTime: Date;
    capacity?: number;
  }>;
  notes?: string;
  idempotencyKey: string;
  requireAllSlots?: boolean; // If true, all slots must be available
  metadata?: Record<string, any>;
}

/**
 * Booking validation result
 */
export interface BookingValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestedAlternatives?: Array<{
    resourceId: string;
    startTime: Date;
    endTime: Date;
    reason: string;
  }>;
}

/**
 * Booking conflict information
 */
export interface BookingConflict {
  type: 'TIME_OVERLAP' | 'CAPACITY_EXCEEDED' | 'RESOURCE_UNAVAILABLE' | 'BUSINESS_HOURS_VIOLATION';
  message: string;
  conflictingBookingId?: string;
  suggestedStartTime?: Date;
  suggestedEndTime?: Date;
  availableCapacity?: number;
  requiredCapacity?: number;
}

/**
 * Tentative booking configuration
 */
export interface TentativeBookingConfig {
  enabled: boolean;
  timeoutMinutes: number;
  autoConfirmOnPayment: boolean;
  maxTentativePerCustomer: number;
  cleanupIntervalMinutes: number;
}

/**
 * Booking policy configuration
 */
export interface BookingPolicyConfig {
  // Time constraints
  minBookingDuration: number; // minutes
  maxBookingDuration: number; // minutes
  advanceBookingDays: number;
  maxConcurrentBookings: number;
  
  // Cancellation policy
  cancellationPolicy: {
    allowedUntilHours: number; // hours before start time
    penaltyPercentage: number; // 0-100
    refundPolicy: 'FULL' | 'PARTIAL' | 'NONE';
  };
  
  // Business rules
  preventDoubleBooking: boolean;
  allowOverbooking: boolean;
  overbookingPercentage?: number;
  requirePaymentConfirmation: boolean;
  autoReleaseUnconfirmedMinutes: number;
}

/**
 * Booking change history entry
 */
export interface BookingChangeHistory {
  id: string;
  bookingId: string;
  changeType: BookingChangeType;
  oldStatus?: BookingStatus;
  newStatus?: BookingStatus;
  oldStartTime?: Date;
  newStartTime?: Date;
  oldEndTime?: Date;
  newEndTime?: Date;
  reason: string;
  metadata?: Record<string, any>;
  changedBy: string; // user ID
  changedAt: Date;
}

/**
 * Notification settings for booking events
 */
export interface BookingNotificationSettings {
  customerId: string;
  enabledTypes: NotificationType[];
  preferences: {
    confirmationNotification: boolean;
    reminderNotification: boolean;
    cancellationNotification: boolean;
    rescheduleNotification: boolean;
    reminderHoursBefore: number[];
  };
  contactInfo: {
    email?: string;
    phone?: string;
    deviceTokens?: string[]; // for push notifications
    webhookUrl?: string;
  };
}

/**
 * Booking availability check request
 */
export interface BookingAvailabilityRequest {
  tenantId: string;
  resourceId: string;
  startTime: Date;
  endTime: Date;
  capacity?: number;
  excludeBookingId?: string; // For rescheduling
}

/**
 * Booking availability response
 */
export interface BookingAvailabilityResponse {
  available: boolean;
  conflicts: BookingConflict[];
  availableCapacity: number;
  totalCapacity: number;
  suggestedSlots?: Array<{
    startTime: Date;
    endTime: Date;
    availableCapacity: number;
  }>;
}

/**
 * Batch booking request for multiple bookings
 */
export interface BatchBookingRequest {
  tenantId: string;
  bookings: BookingRequest[];
  atomicMode: boolean; // If true, all bookings must succeed or all fail
  allowPartialFailure?: boolean;
}

/**
 * Batch booking response
 */
export interface BatchBookingResponse {
  success: boolean;
  successfulBookings: BookingResponse[];
  failedBookings: Array<{
    request: BookingRequest;
    error: string;
    conflicts?: BookingConflict[];
  }>;
  totalProcessed: number;
  totalSuccessful: number;
  totalFailed: number;
}

/**
 * Booking statistics
 */
export interface BookingStatistics {
  tenantId: string;
  period: {
    startDate: Date;
    endDate: Date;
  };
  totalBookings: number;
  confirmedBookings: number;
  cancelledBookings: number;
  noShowBookings: number;
  completedBookings: number;
  utilizationRate: number; // percentage
  averageBookingDuration: number; // minutes
  peakHours: Array<{
    hour: number;
    bookingCount: number;
  }>;
  topResources: Array<{
    resourceId: string;
    bookingCount: number;
    utilizationRate: number;
  }>;
}

/**
 * Database entity for bookings table
 */
export interface BookingEntity extends BaseEntity {
  customer_id: string;
  service_id: string;
  start_at: Date;
  end_at: Date;
  status: BookingStatus;
  total_jpy: number;
  max_penalty_jpy: number;
  idempotency_key: string;
  expires_at?: Date;
  metadata?: Record<string, any>;
}

/**
 * Database entity for booking_items table
 */
export interface BookingItemEntity extends BaseEntity {
  booking_id: string;
  timeslot_id: string;
  resource_id: string;
}

/**
 * Database entity for booking_cancellations table
 */
export interface BookingCancellationEntity extends BaseEntity {
  booking_id: string;
  reason_code?: string;
  note: string;
  cancelled_by: string;
}

/**
 * Database entity for booking_change_history table
 */
export interface BookingChangeHistoryEntity extends BaseEntity {
  booking_id: string;
  change_type: BookingChangeType;
  old_status?: BookingStatus;
  new_status?: BookingStatus;
  old_start_at?: Date;
  new_start_at?: Date;
  old_end_at?: Date;
  new_end_at?: Date;
  reason: string;
  metadata?: Record<string, any>;
  changed_by: string;
  changed_at: Date;
}

/**
 * Lock information for double-booking prevention
 */
export interface BookingLockInfo {
  lockKey: string;
  lockValue: string;
  ttlSeconds: number;
  acquiredAt: Date;
  expiresAt: Date;
  resourceId: string;
  timeSlotIds: string[];
}

/**
 * Booking operation result
 */
export interface BookingOperationResult {
  success: boolean;
  booking?: BookingResponse;
  error?: string;
  conflicts?: BookingConflict[];
  lockInfo?: BookingLockInfo;
  metadata?: Record<string, any>;
}

/**
 * Booking search criteria
 */
export interface BookingSearchCriteria {
  tenantId: string;
  customerId?: string;
  serviceId?: string;
  resourceId?: string;
  status?: BookingStatus[];
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
  sortBy?: 'start_time' | 'created_at' | 'status';
  sortOrder?: 'ASC' | 'DESC';
}

/**
 * Booking reschedule request
 */
export interface BookingRescheduleRequest {
  bookingId: string;
  tenantId: string;
  newStartTime: Date;
  newEndTime: Date;
  newResourceId?: string;
  reason: string;
  notifyCustomer?: boolean;
}

/**
 * Booking cancellation request
 */
export interface BookingCancellationRequest {
  bookingId: string;
  tenantId: string;
  reason: CancellationReason;
  note?: string;
  cancelledBy: string;
  refundAmount?: number;
  notifyCustomer?: boolean;
}

/**
 * Auto-cleanup configuration for expired bookings
 */
export interface BookingCleanupConfig {
  enabled: boolean;
  intervalMinutes: number;
  tentativeBookingTimeoutMinutes: number;
  expiredBookingRetentionDays: number;
  notificationBeforeCleanupHours: number;
}

/**
 * Performance metrics for booking operations
 */
export interface BookingPerformanceMetrics {
  operation: string;
  duration: number;
  success: boolean;
  lockAcquisitionTime?: number;
  validationTime?: number;
  databaseTime?: number;
  cacheHits?: number;
  cacheMisses?: number;
  conflictsDetected?: number;
  timestamp: Date;
  tenantId: string;
  resourceId?: string;
}

export {
  BookingStatus,
  BookingChangeType,
  CancellationReason,
  NotificationType
};