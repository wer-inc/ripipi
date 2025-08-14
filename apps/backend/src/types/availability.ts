/**
 * Availability and Slot Management Types
 * Defines types for 5-minute/15-minute slot management system
 */

import { BaseEntity } from './database.js';

/**
 * Slot granularity configuration for tenants
 */
export type SlotGranularity = 5 | 15; // minutes

/**
 * Time slot configuration
 */
export interface SlotConfig {
  granularity: SlotGranularity;
  minBookingDuration: number; // minutes
  maxBookingDuration: number; // minutes
  advanceBookingDays: number;
  bufferTime?: number; // minutes between slots
}

/**
 * Time slot definition
 */
export interface TimeSlot {
  id: string;
  tenantId: string;
  resourceId: string;
  startTime: Date;
  endTime: Date;
  duration: number; // minutes
  isAvailable: boolean;
  capacity: number;
  bookedCount: number;
  availableCapacity: number;
}

/**
 * Business hours definition for slot generation
 */
export interface BusinessHours {
  id: string;
  tenantId: string;
  resourceId?: string;
  dayOfWeek: number; // 0=Sunday, 1=Monday, ..., 6=Saturday
  openTime: string; // HH:mm format
  closeTime: string; // HH:mm format
  effectiveFrom?: Date;
  effectiveTo?: Date;
}

/**
 * Holiday definition
 */
export interface Holiday {
  id: string;
  tenantId: string;
  resourceId?: string;
  date: Date;
  name: string;
}

/**
 * Resource time-off definition
 */
export interface ResourceTimeOff {
  id: string;
  tenantId: string;
  resourceId: string;
  startTime: Date;
  endTime: Date;
  reason: string;
}

/**
 * Slot availability query parameters
 */
export interface AvailabilityQuery {
  tenantId: string;
  resourceIds: string[];
  startDate: Date;
  endDate: Date;
  duration?: number; // minutes
  capacity?: number; // required capacity
  granularity?: SlotGranularity;
}

/**
 * Slot booking request
 */
export interface SlotBookingRequest {
  tenantId: string;
  resourceId: string;
  startTime: Date;
  duration: number; // minutes
  capacity: number;
  customerId?: string;
  serviceId?: string;
}

/**
 * Slot booking result
 */
export interface SlotBookingResult {
  success: boolean;
  slotIds: string[];
  message?: string;
  error?: string;
}

/**
 * Continuous slot requirement
 */
export interface ContinuousSlotRequirement {
  duration: number; // minutes
  requiredSlots: number;
  granularity: SlotGranularity;
}

/**
 * Slot boundary calculation result
 */
export interface SlotBoundary {
  alignedStart: Date;
  alignedEnd: Date;
  requiredSlots: number;
  isValid: boolean;
  adjustmentMade: boolean;
}

/**
 * Resource capacity configuration
 */
export interface ResourceCapacity {
  resourceId: string;
  totalCapacity: number;
  availableCapacity: number;
  bookedCapacity: number;
  maintenanceCapacity?: number;
}

/**
 * Inventory status for a specific time period
 */
export interface InventoryStatus {
  tenantId: string;
  resourceId: string;
  timeSlots: TimeSlot[];
  totalCapacity: number;
  availableCapacity: number;
  bookedCapacity: number;
  utilization: number; // percentage
  lastUpdated: Date;
}

/**
 * Batch availability check request
 */
export interface BatchAvailabilityRequest {
  tenantId: string;
  requests: Array<{
    resourceId: string;
    startTime: Date;
    endTime: Date;
    requiredCapacity: number;
  }>;
}

/**
 * Batch availability check result
 */
export interface BatchAvailabilityResult {
  results: Array<{
    resourceId: string;
    available: boolean;
    conflictReason?: string;
    availableCapacity: number;
  }>;
  timestamp: Date;
}

/**
 * Slot adjustment configuration
 */
export interface SlotAdjustment {
  originalStart: Date;
  originalEnd: Date;
  adjustedStart: Date;
  adjustedEnd: Date;
  reason: 'BOUNDARY_ALIGNMENT' | 'BUSINESS_HOURS' | 'MINIMUM_DURATION';
  granularity: SlotGranularity;
}

/**
 * Inventory statistics
 */
export interface InventoryStats {
  tenantId: string;
  resourceId?: string;
  period: {
    startDate: Date;
    endDate: Date;
  };
  totalSlots: number;
  availableSlots: number;
  bookedSlots: number;
  utilizationRate: number;
  peakUtilization: number;
  averageBookingDuration: number;
  popularTimeSlots: Array<{
    timeSlot: string;
    bookingCount: number;
  }>;
}

/**
 * Slot generation parameters
 */
export interface SlotGenerationParams {
  tenantId: string;
  resourceId: string;
  startDate: Date;
  endDate: Date;
  granularity: SlotGranularity;
  businessHours: BusinessHours[];
  holidays: Holiday[];
  timeOffs: ResourceTimeOff[];
  capacity: number;
}

/**
 * Slot validation result
 */
export interface SlotValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestedAdjustments?: SlotAdjustment[];
}

/**
 * Deadlock prevention configuration
 */
export interface DeadlockPreventionConfig {
  maxRetries: number;
  backoffMs: number;
  lockOrder: 'RESOURCE_ID' | 'TIME_ASC' | 'TIME_DESC';
  timeoutMs: number;
}

/**
 * Optimistic lock for inventory updates
 */
export interface OptimisticLock {
  version: number;
  lastModified: Date;
  lockedBy?: string;
  lockExpiry?: Date;
}

/**
 * Inventory update request
 */
export interface InventoryUpdateRequest {
  tenantId: string;
  resourceId: string;
  timeSlotId: string;
  capacityChange: number;
  operation: 'RESERVE' | 'RELEASE' | 'SET';
  optimisticLock: OptimisticLock;
  reason?: string;
}

/**
 * Inventory update result
 */
export interface InventoryUpdateResult {
  success: boolean;
  newVersion: number;
  newCapacity: number;
  error?: 'VERSION_MISMATCH' | 'CAPACITY_EXCEEDED' | 'SLOT_NOT_FOUND' | 'BUSINESS_RULE_VIOLATION';
  message?: string;
}

/**
 * Database entity for timeslots table
 */
export interface TimeslotEntity extends BaseEntity {
  resource_id: string;
  start_at: Date;
  end_at: Date;
  available_capacity: number;
}

/**
 * Database entity for business hours table
 */
export interface BusinessHoursEntity extends BaseEntity {
  resource_id?: string;
  day_of_week: number;
  open_time: string;
  close_time: string;
  effective_from?: Date;
  effective_to?: Date;
}

/**
 * Database entity for holidays table
 */
export interface HolidayEntity extends BaseEntity {
  resource_id?: string;
  date: Date;
  name: string;
}

/**
 * Database entity for resource time-offs table
 */
export interface ResourceTimeOffEntity extends BaseEntity {
  resource_id: string;
  start_at: Date;
  end_at: Date;
  reason: string;
}

/**
 * Cache key configuration for availability data
 */
export interface AvailabilityCacheConfig {
  keyPrefix: string;
  ttl: number;
  useCompression: boolean;
  invalidationPattern: string;
}

/**
 * Performance metrics for slot operations
 */
export interface SlotPerformanceMetrics {
  operation: string;
  duration: number;
  recordsProcessed: number;
  cacheHit: boolean;
  timestamp: Date;
  tenantId: string;
  resourceId?: string;
}