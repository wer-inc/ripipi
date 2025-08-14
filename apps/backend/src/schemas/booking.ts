/**
 * Booking API Schema Definitions
 * TypeBox schemas for booking endpoints with comprehensive validation,
 * pagination, filtering, and multi-language support
 */

import { Type, Static } from '@sinclair/typebox';
import { 
  PaginationSchema, 
  SortSchema, 
  FilterSchema, 
  DateRangeSchema,
  IDSchema,
  ResponseMetadataSchema,
  MultiLangTextSchema
} from './common.js';

/**
 * Booking status enum schema
 */
export const BookingStatusSchema = Type.Union([
  Type.Literal('tentative'),
  Type.Literal('confirmed'),
  Type.Literal('cancelled'),
  Type.Literal('noshow'),
  Type.Literal('completed')
], {
  description: 'Booking status values'
});

export type BookingStatus = Static<typeof BookingStatusSchema>;

/**
 * Cancellation reason schema
 */
export const CancellationReasonSchema = Type.Union([
  Type.Literal('CUSTOMER_REQUEST'),
  Type.Literal('BUSINESS_CLOSURE'),
  Type.Literal('RESOURCE_UNAVAILABLE'),
  Type.Literal('EMERGENCY'),
  Type.Literal('SYSTEM_ERROR'),
  Type.Literal('DUPLICATE_BOOKING'),
  Type.Literal('PAYMENT_FAILED')
], {
  description: 'Cancellation reason codes'
});

export type CancellationReason = Static<typeof CancellationReasonSchema>;

/**
 * Time slot schema for booking details
 */
export const TimeSlotSchema = Type.Object({
  id: IDSchema,
  tenantId: IDSchema,
  resourceId: IDSchema,
  startTime: Type.String({
    format: 'date-time',
    description: 'Slot start time (ISO 8601)'
  }),
  endTime: Type.String({
    format: 'date-time',
    description: 'Slot end time (ISO 8601)'
  }),
  duration: Type.Integer({
    minimum: 1,
    maximum: 1440, // 24 hours in minutes
    description: 'Duration in minutes'
  }),
  isAvailable: Type.Boolean({
    description: 'Whether the slot is available'
  }),
  capacity: Type.Integer({
    minimum: 1,
    maximum: 100,
    description: 'Total slot capacity'
  }),
  availableCapacity: Type.Integer({
    minimum: 0,
    maximum: 100,
    description: 'Available capacity'
  }),
  bookedCount: Type.Integer({
    minimum: 0,
    description: 'Number of bookings for this slot'
  })
}, {
  description: 'Time slot information'
});

export type TimeSlot = Static<typeof TimeSlotSchema>;

/**
 * Base booking information schema
 */
export const BookingBaseSchema = Type.Object({
  id: IDSchema,
  tenantId: IDSchema,
  customerId: IDSchema,
  serviceId: IDSchema,
  resourceId: IDSchema,
  startTime: Type.String({
    format: 'date-time',
    description: 'Booking start time (ISO 8601)'
  }),
  endTime: Type.String({
    format: 'date-time',
    description: 'Booking end time (ISO 8601)'
  }),
  status: BookingStatusSchema,
  totalJpy: Type.Integer({
    minimum: 0,
    maximum: 10000000, // 10M JPY
    description: 'Total amount in JPY'
  }),
  maxPenaltyJpy: Type.Integer({
    minimum: 0,
    maximum: 1000000, // 1M JPY
    description: 'Maximum penalty amount in JPY'
  }),
  idempotencyKey: Type.String({
    minLength: 10,
    maxLength: 64,
    pattern: '^[a-zA-Z0-9_-]+$',
    description: 'Unique idempotency key'
  }),
  notes: Type.Optional(Type.String({
    maxLength: 1000,
    description: 'Customer notes'
  })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Any(), {
    description: 'Additional booking metadata'
  })),
  createdAt: Type.String({
    format: 'date-time',
    description: 'Creation timestamp'
  }),
  updatedAt: Type.String({
    format: 'date-time',
    description: 'Last update timestamp'
  }),
  expiresAt: Type.Optional(Type.String({
    format: 'date-time',
    description: 'Expiration time for tentative bookings'
  }))
}, {
  description: 'Base booking information'
});

/**
 * Full booking response schema with time slots
 */
export const BookingResponseSchema = Type.Intersect([
  BookingBaseSchema,
  Type.Object({
    bookedSlots: Type.Array(TimeSlotSchema, {
      description: 'Booked time slots'
    }),
    customerInfo: Type.Optional(Type.Object({
      name: Type.String({ description: 'Customer name' }),
      email: Type.Optional(Type.String({ format: 'email', description: 'Customer email' })),
      phone: Type.Optional(Type.String({ description: 'Customer phone' }))
    }, {
      description: 'Customer information'
    })),
    serviceInfo: Type.Optional(Type.Object({
      name: MultiLangTextSchema,
      description: Type.Optional(MultiLangTextSchema),
      duration: Type.Integer({ minimum: 1, description: 'Service duration in minutes' }),
      priceJpy: Type.Integer({ minimum: 0, description: 'Service price in JPY' })
    }, {
      description: 'Service information'
    })),
    resourceInfo: Type.Optional(Type.Object({
      name: MultiLangTextSchema,
      description: Type.Optional(MultiLangTextSchema),
      capacity: Type.Integer({ minimum: 1, description: 'Resource capacity' })
    }, {
      description: 'Resource information'
    }))
  })
], {
  description: 'Complete booking information'
});

export type BookingResponse = Static<typeof BookingResponseSchema>;

/**
 * Create booking request schema
 */
export const CreateBookingRequestSchema = Type.Object({
  customerId: IDSchema,
  serviceId: IDSchema,
  resourceId: IDSchema,
  startTime: Type.String({
    format: 'date-time',
    description: 'Requested start time (ISO 8601)'
  }),
  endTime: Type.String({
    format: 'date-time',
    description: 'Requested end time (ISO 8601)'
  }),
  capacity: Type.Optional(Type.Integer({
    minimum: 1,
    maximum: 10,
    default: 1,
    description: 'Required capacity (default: 1)'
  })),
  notes: Type.Optional(Type.String({
    maxLength: 1000,
    description: 'Customer notes'
  })),
  idempotencyKey: Type.String({
    minLength: 10,
    maxLength: 64,
    pattern: '^[a-zA-Z0-9_-]+$',
    description: 'Unique idempotency key for duplicate prevention'
  }),
  notificationPreferences: Type.Optional(Type.Object({
    email: Type.Optional(Type.Boolean({ default: true, description: 'Send email notifications' })),
    sms: Type.Optional(Type.Boolean({ default: false, description: 'Send SMS notifications' })),
    push: Type.Optional(Type.Boolean({ default: false, description: 'Send push notifications' })),
    line: Type.Optional(Type.Boolean({ default: false, description: 'Send LINE notifications' })),
    language: Type.Optional(Type.Union([
      Type.Literal('ja'),
      Type.Literal('en')
    ], {
      default: 'ja',
      description: 'Notification language'
    }))
  }, {
    description: 'Notification preferences'
  })),
  autoConfirm: Type.Optional(Type.Boolean({
    default: false,
    description: 'Auto-confirm booking (skip tentative status)'
  })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Any(), {
    description: 'Additional booking metadata'
  }))
}, {
  description: 'Create booking request'
});

export type CreateBookingRequest = Static<typeof CreateBookingRequestSchema>;

/**
 * Update booking request schema
 */
export const UpdateBookingRequestSchema = Type.Object({
  startTime: Type.Optional(Type.String({
    format: 'date-time',
    description: 'New start time (ISO 8601)'
  })),
  endTime: Type.Optional(Type.String({
    format: 'date-time',
    description: 'New end time (ISO 8601)'
  })),
  resourceId: Type.Optional(IDSchema),
  notes: Type.Optional(Type.String({
    maxLength: 1000,
    description: 'Updated customer notes'
  })),
  status: Type.Optional(BookingStatusSchema),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Any(), {
    description: 'Updated booking metadata'
  })),
  reason: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 200,
    description: 'Reason for the update'
  })),
  notifyCustomer: Type.Optional(Type.Boolean({
    default: true,
    description: 'Send notification to customer'
  }))
}, {
  minProperties: 1,
  description: 'Update booking request'
});

export type UpdateBookingRequest = Static<typeof UpdateBookingRequestSchema>;

/**
 * Cancel booking request schema
 */
export const CancelBookingRequestSchema = Type.Object({
  reason: CancellationReasonSchema,
  note: Type.Optional(Type.String({
    maxLength: 500,
    description: 'Cancellation note'
  })),
  refundAmount: Type.Optional(Type.Integer({
    minimum: 0,
    description: 'Refund amount in JPY'
  })),
  notifyCustomer: Type.Optional(Type.Boolean({
    default: true,
    description: 'Send cancellation notification to customer'
  }))
}, {
  description: 'Cancel booking request'
});

export type CancelBookingRequest = Static<typeof CancelBookingRequestSchema>;

/**
 * Confirm booking request schema
 */
export const ConfirmBookingRequestSchema = Type.Object({
  paymentConfirmation: Type.Optional(Type.Object({
    transactionId: Type.String({ description: 'Payment transaction ID' }),
    amount: Type.Integer({ minimum: 0, description: 'Confirmed payment amount' }),
    method: Type.String({ description: 'Payment method' })
  }, {
    description: 'Payment confirmation details'
  })),
  notes: Type.Optional(Type.String({
    maxLength: 500,
    description: 'Confirmation notes'
  })),
  notifyCustomer: Type.Optional(Type.Boolean({
    default: true,
    description: 'Send confirmation notification to customer'
  }))
}, {
  description: 'Confirm booking request'
});

export type ConfirmBookingRequest = Static<typeof ConfirmBookingRequestSchema>;

/**
 * Booking search/list query schema
 */
export const BookingSearchQuerySchema = Type.Object({
  customerId: Type.Optional(IDSchema),
  serviceId: Type.Optional(IDSchema),
  resourceId: Type.Optional(IDSchema),
  status: Type.Optional(Type.Union([
    BookingStatusSchema,
    Type.Array(BookingStatusSchema, {
      minItems: 1,
      maxItems: 5,
      description: 'Multiple status values'
    })
  ], {
    description: 'Filter by booking status'
  })),
  startDate: Type.Optional(Type.String({
    format: 'date-time',
    description: 'Filter bookings starting from this date'
  })),
  endDate: Type.Optional(Type.String({
    format: 'date-time',
    description: 'Filter bookings ending before this date'
  })),
  dateRange: Type.Optional(DateRangeSchema),
  includeDetails: Type.Optional(Type.Boolean({
    default: false,
    description: 'Include customer, service, and resource details'
  })),
  search: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Search in customer names, notes, etc.'
  })),
  ...PaginationSchema.properties,
  sortBy: Type.Optional(Type.Union([
    Type.Literal('startTime'),
    Type.Literal('createdAt'),
    Type.Literal('status'),
    Type.Literal('totalJpy')
  ], {
    default: 'startTime',
    description: 'Sort field'
  })),
  sortOrder: Type.Optional(Type.Union([
    Type.Literal('asc'),
    Type.Literal('desc')
  ], {
    default: 'asc',
    description: 'Sort order'
  }))
}, {
  description: 'Booking search parameters'
});

export type BookingSearchQuery = Static<typeof BookingSearchQuerySchema>;

/**
 * Upcoming bookings query schema
 */
export const UpcomingBookingsQuerySchema = Type.Object({
  customerId: Type.Optional(IDSchema),
  resourceId: Type.Optional(IDSchema),
  days: Type.Optional(Type.Integer({
    minimum: 1,
    maximum: 90,
    default: 7,
    description: 'Number of days to look ahead'
  })),
  includeDetails: Type.Optional(Type.Boolean({
    default: true,
    description: 'Include customer, service, and resource details'
  })),
  ...PaginationSchema.properties
}, {
  description: 'Upcoming bookings query parameters'
});

export type UpcomingBookingsQuery = Static<typeof UpcomingBookingsQuerySchema>;

/**
 * Booking list response schema
 */
export const BookingListResponseSchema = Type.Object({
  data: Type.Array(BookingResponseSchema, {
    description: 'Booking list'
  }),
  pagination: Type.Object({
    page: Type.Integer({ minimum: 1, description: 'Current page' }),
    limit: Type.Integer({ minimum: 1, description: 'Items per page' }),
    total: Type.Integer({ minimum: 0, description: 'Total items' }),
    totalPages: Type.Integer({ minimum: 0, description: 'Total pages' }),
    hasNext: Type.Boolean({ description: 'Has next page' }),
    hasPrev: Type.Boolean({ description: 'Has previous page' })
  }, {
    description: 'Pagination information'
  }),
  statistics: Type.Optional(Type.Object({
    totalValue: Type.Integer({ minimum: 0, description: 'Total booking value in JPY' }),
    averageDuration: Type.Number({ minimum: 0, description: 'Average booking duration in minutes' }),
    statusDistribution: Type.Record(BookingStatusSchema, Type.Integer({ minimum: 0 }), {
      description: 'Distribution of booking statuses'
    })
  }, {
    description: 'List statistics'
  })),
  metadata: ResponseMetadataSchema
}, {
  description: 'Booking list response'
});

export type BookingListResponse = Static<typeof BookingListResponseSchema>;

/**
 * Booking availability check request schema
 */
export const CheckAvailabilityRequestSchema = Type.Object({
  resourceId: IDSchema,
  startTime: Type.String({
    format: 'date-time',
    description: 'Requested start time (ISO 8601)'
  }),
  endTime: Type.String({
    format: 'date-time',
    description: 'Requested end time (ISO 8601)'
  }),
  capacity: Type.Optional(Type.Integer({
    minimum: 1,
    maximum: 10,
    default: 1,
    description: 'Required capacity'
  })),
  excludeBookingId: Type.Optional(IDSchema, {
    description: 'Exclude this booking from availability check (for rescheduling)'
  })
}, {
  description: 'Availability check request'
});

export type CheckAvailabilityRequest = Static<typeof CheckAvailabilityRequestSchema>;

/**
 * Booking conflict information schema
 */
export const BookingConflictSchema = Type.Object({
  type: Type.Union([
    Type.Literal('TIME_OVERLAP'),
    Type.Literal('CAPACITY_EXCEEDED'),
    Type.Literal('RESOURCE_UNAVAILABLE'),
    Type.Literal('BUSINESS_HOURS_VIOLATION')
  ], {
    description: 'Conflict type'
  }),
  message: Type.String({
    description: 'Human-readable conflict message'
  }),
  conflictingBookingId: Type.Optional(IDSchema, {
    description: 'ID of conflicting booking'
  }),
  suggestedStartTime: Type.Optional(Type.String({
    format: 'date-time',
    description: 'Suggested alternative start time'
  })),
  suggestedEndTime: Type.Optional(Type.String({
    format: 'date-time',
    description: 'Suggested alternative end time'
  })),
  availableCapacity: Type.Optional(Type.Integer({
    minimum: 0,
    description: 'Available capacity at requested time'
  })),
  requiredCapacity: Type.Optional(Type.Integer({
    minimum: 1,
    description: 'Required capacity for booking'
  }))
}, {
  description: 'Booking conflict information'
});

export type BookingConflict = Static<typeof BookingConflictSchema>;

/**
 * Booking availability response schema
 */
export const CheckAvailabilityResponseSchema = Type.Object({
  available: Type.Boolean({
    description: 'Whether the requested time is available'
  }),
  conflicts: Type.Array(BookingConflictSchema, {
    description: 'List of conflicts if not available'
  }),
  availableCapacity: Type.Integer({
    minimum: 0,
    description: 'Available capacity at requested time'
  }),
  totalCapacity: Type.Integer({
    minimum: 1,
    description: 'Total resource capacity'
  }),
  suggestedSlots: Type.Optional(Type.Array(Type.Object({
    startTime: Type.String({ format: 'date-time', description: 'Suggested start time' }),
    endTime: Type.String({ format: 'date-time', description: 'Suggested end time' }),
    availableCapacity: Type.Integer({ minimum: 0, description: 'Available capacity for this slot' })
  }), {
    maxItems: 10,
    description: 'Alternative available slots'
  })),
  metadata: ResponseMetadataSchema
}, {
  description: 'Availability check response'
});

export type CheckAvailabilityResponse = Static<typeof CheckAvailabilityResponseSchema>;

/**
 * Batch booking request schema
 */
export const BatchBookingRequestSchema = Type.Object({
  bookings: Type.Array(CreateBookingRequestSchema, {
    minItems: 1,
    maxItems: 50,
    description: 'List of bookings to create'
  }),
  atomicMode: Type.Optional(Type.Boolean({
    default: false,
    description: 'If true, all bookings must succeed or all fail'
  })),
  allowPartialFailure: Type.Optional(Type.Boolean({
    default: true,
    description: 'Allow some bookings to fail in non-atomic mode'
  }))
}, {
  description: 'Batch booking creation request'
});

export type BatchBookingRequest = Static<typeof BatchBookingRequestSchema>;

/**
 * Batch booking response schema
 */
export const BatchBookingResponseSchema = Type.Object({
  success: Type.Boolean({
    description: 'Overall operation success'
  }),
  successfulBookings: Type.Array(BookingResponseSchema, {
    description: 'Successfully created bookings'
  }),
  failedBookings: Type.Array(Type.Object({
    request: CreateBookingRequestSchema,
    error: Type.String({ description: 'Error message' }),
    conflicts: Type.Optional(Type.Array(BookingConflictSchema, {
      description: 'Booking conflicts'
    }))
  }), {
    description: 'Failed booking attempts'
  }),
  statistics: Type.Object({
    totalProcessed: Type.Integer({ minimum: 0, description: 'Total bookings processed' }),
    totalSuccessful: Type.Integer({ minimum: 0, description: 'Total successful bookings' }),
    totalFailed: Type.Integer({ minimum: 0, description: 'Total failed bookings' })
  }),
  metadata: ResponseMetadataSchema
}, {
  description: 'Batch booking operation response'
});

export type BatchBookingResponse = Static<typeof BatchBookingResponseSchema>;

/**
 * Booking statistics response schema
 */
export const BookingStatisticsResponseSchema = Type.Object({
  period: Type.Object({
    startDate: Type.String({ format: 'date-time', description: 'Statistics period start' }),
    endDate: Type.String({ format: 'date-time', description: 'Statistics period end' })
  }),
  totalBookings: Type.Integer({ minimum: 0, description: 'Total number of bookings' }),
  confirmedBookings: Type.Integer({ minimum: 0, description: 'Number of confirmed bookings' }),
  cancelledBookings: Type.Integer({ minimum: 0, description: 'Number of cancelled bookings' }),
  noShowBookings: Type.Integer({ minimum: 0, description: 'Number of no-show bookings' }),
  completedBookings: Type.Integer({ minimum: 0, description: 'Number of completed bookings' }),
  utilizationRate: Type.Number({ minimum: 0, maximum: 100, description: 'Utilization rate percentage' }),
  averageBookingDuration: Type.Number({ minimum: 0, description: 'Average booking duration in minutes' }),
  totalRevenue: Type.Integer({ minimum: 0, description: 'Total revenue in JPY' }),
  peakHours: Type.Array(Type.Object({
    hour: Type.Integer({ minimum: 0, maximum: 23, description: 'Hour of day (0-23)' }),
    bookingCount: Type.Integer({ minimum: 0, description: 'Number of bookings in this hour' })
  }), {
    description: 'Peak booking hours'
  }),
  topResources: Type.Array(Type.Object({
    resourceId: IDSchema,
    resourceName: Type.Optional(Type.String({ description: 'Resource name' })),
    bookingCount: Type.Integer({ minimum: 0, description: 'Number of bookings' }),
    utilizationRate: Type.Number({ minimum: 0, maximum: 100, description: 'Resource utilization rate' })
  }), {
    description: 'Most booked resources'
  }),
  metadata: ResponseMetadataSchema
}, {
  description: 'Booking statistics'
});

export type BookingStatisticsResponse = Static<typeof BookingStatisticsResponseSchema>;

/**
 * Error response schema
 */
export const BookingErrorResponseSchema = Type.Object({
  error: Type.Object({
    code: Type.String({ description: 'Error code' }),
    message: Type.String({ description: 'Error message' }),
    details: Type.Optional(Type.Array(Type.Object({
      field: Type.Optional(Type.String({ description: 'Field name' })),
      message: Type.String({ description: 'Field error message' }),
      value: Type.Optional(Type.Any({ description: 'Field value' }))
    }), {
      description: 'Detailed field errors'
    })),
    correlationId: Type.Optional(Type.String({ description: 'Request correlation ID' })),
    timestamp: Type.String({ format: 'date-time', description: 'Error timestamp' })
  }),
  conflicts: Type.Optional(Type.Array(BookingConflictSchema, {
    description: 'Booking conflicts if applicable'
  })),
  suggestions: Type.Optional(Type.Array(Type.Object({
    action: Type.String({ description: 'Suggested action' }),
    description: Type.String({ description: 'Action description' }),
    alternativeSlots: Type.Optional(Type.Array(Type.Object({
      startTime: Type.String({ format: 'date-time' }),
      endTime: Type.String({ format: 'date-time' }),
      availableCapacity: Type.Integer({ minimum: 0 })
    })))
  }), {
    description: 'Suggested actions to resolve the issue'
  }))
}, {
  description: 'Booking API error response'
});

export type BookingErrorResponse = Static<typeof BookingErrorResponseSchema>;

/**
 * Route parameter schemas
 */
export const BookingParamsSchema = Type.Object({
  id: IDSchema
}, {
  description: 'Booking route parameters'
});

export type BookingParams = Static<typeof BookingParamsSchema>;

/**
 * Success response schema
 */
export const BookingSuccessResponseSchema = Type.Object({
  success: Type.Boolean({ const: true }),
  data: BookingResponseSchema,
  metadata: ResponseMetadataSchema
}, {
  description: 'Successful booking operation response'
});

export type BookingSuccessResponse = Static<typeof BookingSuccessResponseSchema>;