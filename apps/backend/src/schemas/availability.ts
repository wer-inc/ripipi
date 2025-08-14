/**
 * Availability API Schemas
 * TypeBox schemas for availability and inventory management endpoints
 */

import { Type, Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

// Base schemas
const TenantId = Type.String({ minLength: 1, maxLength: 50 });
const ResourceId = Type.String({ minLength: 1, maxLength: 50 });
const TimeSlotId = Type.String({ minLength: 1, maxLength: 100 });
const UserId = Type.String({ minLength: 1, maxLength: 50 });
const CustomerId = Type.String({ minLength: 1, maxLength: 50 });
const ServiceId = Type.String({ minLength: 1, maxLength: 50 });
const ISODateString = Type.String({ format: 'date-time' });
const PositiveInteger = Type.Integer({ minimum: 1 });
const NonNegativeInteger = Type.Integer({ minimum: 0 });
const PercentageFloat = Type.Number({ minimum: 0, maximum: 100 });

// Common query parameters
export const PaginationSchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  sort: Type.Optional(Type.String()),
  order: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')], { default: 'asc' }))
});

export const DateRangeSchema = Type.Object({
  startDate: ISODateString,
  endDate: ISODateString
});

// Availability query schemas
export const AvailabilityQuerySchema = Type.Object({
  resourceIds: Type.Array(ResourceId, { minItems: 1, maxItems: 20 }),
  startDate: ISODateString,
  endDate: ISODateString,
  duration: Type.Optional(Type.Integer({ minimum: 5, maximum: 480 })), // 5 min to 8 hours
  capacity: Type.Optional(PositiveInteger),
  granularity: Type.Optional(Type.Union([Type.Literal(5), Type.Literal(15)], { default: 15 }))
});

export const SlotsQuerySchema = Type.Object({
  resourceId: ResourceId,
  date: ISODateString,
  granularity: Type.Optional(Type.Union([Type.Literal(5), Type.Literal(15)], { default: 15 })),
  capacity: Type.Optional(PositiveInteger)
});

export const CalendarQuerySchema = Type.Object({
  resourceIds: Type.Array(ResourceId, { minItems: 1, maxItems: 10 }),
  year: Type.Integer({ minimum: 2020, maximum: 2030 }),
  month: Type.Integer({ minimum: 1, maximum: 12 }),
  view: Type.Optional(Type.Union([
    Type.Literal('month'),
    Type.Literal('week'),
    Type.Literal('day')
  ], { default: 'month' }))
});

export const ResourceAvailabilityParamsSchema = Type.Object({
  id: ResourceId
});

export const BatchAvailabilitySchema = Type.Object({
  requests: Type.Array(
    Type.Object({
      resourceId: ResourceId,
      startTime: ISODateString,
      endTime: ISODateString,
      requiredCapacity: PositiveInteger
    }),
    { minItems: 1, maxItems: 50 }
  )
});

// Inventory query schemas
export const InventoryQuerySchema = Type.Object({
  resourceIds: Type.Optional(Type.Array(ResourceId, { maxItems: 20 })),
  includeStats: Type.Optional(Type.Boolean({ default: false })),
  includeAlerts: Type.Optional(Type.Boolean({ default: false })),
  ...Type.Partial(PaginationSchema).properties,
  ...Type.Partial(DateRangeSchema).properties
});

export const InventoryParamsSchema = Type.Object({
  id: ResourceId
});

export const InventoryUpdateSchema = Type.Object({
  capacity: Type.Optional(NonNegativeInteger),
  status: Type.Optional(Type.Union([
    Type.Literal('active'),
    Type.Literal('maintenance'),
    Type.Literal('inactive')
  ])),
  reason: Type.Optional(Type.String({ minLength: 1, maxLength: 200 }))
});

export const BulkInventoryUpdateSchema = Type.Object({
  updates: Type.Array(
    Type.Object({
      resourceId: ResourceId,
      timeSlotId: TimeSlotId,
      capacityChange: Type.Integer({ minimum: -100, maximum: 100 }),
      operation: Type.Union([
        Type.Literal('RESERVE'),
        Type.Literal('RELEASE'),
        Type.Literal('SET')
      ]),
      reason: Type.Optional(Type.String({ maxLength: 200 }))
    }),
    { minItems: 1, maxItems: 100 }
  )
});

export const InventoryStatsQuerySchema = Type.Object({
  resourceIds: Type.Optional(Type.Array(ResourceId, { maxItems: 20 })),
  ...DateRangeSchema.properties,
  groupBy: Type.Optional(Type.Union([
    Type.Literal('day'),
    Type.Literal('week'),
    Type.Literal('month'),
    Type.Literal('resource')
  ], { default: 'day' })),
  metrics: Type.Optional(Type.Array(
    Type.Union([
      Type.Literal('utilization'),
      Type.Literal('capacity'),
      Type.Literal('bookings'),
      Type.Literal('revenue')
    ]),
    { default: ['utilization', 'capacity'] }
  ))
});

// Response schemas
export const TimeSlotSchema = Type.Object({
  id: Type.String(),
  tenantId: TenantId,
  resourceId: ResourceId,
  startTime: ISODateString,
  endTime: ISODateString,
  duration: PositiveInteger,
  isAvailable: Type.Boolean(),
  capacity: NonNegativeInteger,
  bookedCount: NonNegativeInteger,
  availableCapacity: NonNegativeInteger
});

export const AvailabilityResponseSchema = Type.Object({
  success: Type.Boolean(),
  data: Type.Object({
    slots: Type.Array(TimeSlotSchema),
    totalCount: NonNegativeInteger,
    availableCount: NonNegativeInteger,
    resourceCounts: Type.Record(ResourceId, NonNegativeInteger),
    query: AvailabilityQuerySchema,
    generatedAt: ISODateString
  }),
  meta: Type.Optional(Type.Object({
    cached: Type.Boolean(),
    cacheKey: Type.String(),
    processingTimeMs: NonNegativeInteger
  }))
});

export const SlotsResponseSchema = Type.Object({
  success: Type.Boolean(),
  data: Type.Object({
    resourceId: ResourceId,
    date: ISODateString,
    slots: Type.Array(TimeSlotSchema),
    businessHours: Type.Array(Type.Object({
      openTime: Type.String(),
      closeTime: Type.String(),
      dayOfWeek: Type.Integer({ minimum: 0, maximum: 6 })
    })),
    holidays: Type.Array(Type.Object({
      date: ISODateString,
      name: Type.String()
    })),
    totalCapacity: NonNegativeInteger,
    availableCapacity: NonNegativeInteger
  })
});

export const CalendarDaySchema = Type.Object({
  date: ISODateString,
  dayOfWeek: Type.Integer({ minimum: 0, maximum: 6 }),
  isBusinessDay: Type.Boolean(),
  isHoliday: Type.Boolean(),
  holidayName: Type.Optional(Type.String()),
  totalSlots: NonNegativeInteger,
  availableSlots: NonNegativeInteger,
  utilizationRate: PercentageFloat,
  peakHours: Type.Array(Type.Object({
    hour: Type.Integer({ minimum: 0, maximum: 23 }),
    utilization: PercentageFloat
  }))
});

export const CalendarResponseSchema = Type.Object({
  success: Type.Boolean(),
  data: Type.Object({
    year: Type.Integer(),
    month: Type.Integer(),
    view: Type.String(),
    resourceIds: Type.Array(ResourceId),
    calendar: Type.Array(CalendarDaySchema),
    summary: Type.Object({
      totalDays: NonNegativeInteger,
      businessDays: NonNegativeInteger,
      holidays: NonNegativeInteger,
      averageUtilization: PercentageFloat,
      peakUtilizationDay: Type.Optional(ISODateString),
      lowUtilizationDays: Type.Array(ISODateString)
    })
  })
});

export const ResourceAvailabilityResponseSchema = Type.Object({
  success: Type.Boolean(),
  data: Type.Object({
    resourceId: ResourceId,
    resourceName: Type.String(),
    resourceType: Type.String(),
    totalCapacity: NonNegativeInteger,
    currentUtilization: PercentageFloat,
    nextAvailableSlot: Type.Optional(Type.Object({
      startTime: ISODateString,
      endTime: ISODateString,
      availableCapacity: NonNegativeInteger
    })),
    upcomingBookings: Type.Array(Type.Object({
      startTime: ISODateString,
      endTime: ISODateString,
      bookedCapacity: PositiveInteger,
      customerId: Type.Optional(CustomerId),
      serviceId: Type.Optional(ServiceId)
    })),
    dailyStats: Type.Array(Type.Object({
      date: ISODateString,
      totalSlots: NonNegativeInteger,
      bookedSlots: NonNegativeInteger,
      utilization: PercentageFloat
    }))
  })
});

export const BatchAvailabilityResponseSchema = Type.Object({
  success: Type.Boolean(),
  data: Type.Object({
    results: Type.Array(Type.Object({
      resourceId: ResourceId,
      available: Type.Boolean(),
      availableCapacity: NonNegativeInteger,
      conflictReason: Type.Optional(Type.String()),
      alternativeSlots: Type.Optional(Type.Array(Type.Object({
        startTime: ISODateString,
        endTime: ISODateString,
        availableCapacity: NonNegativeInteger
      })))
    })),
    timestamp: ISODateString,
    totalRequests: NonNegativeInteger,
    successfulRequests: NonNegativeInteger
  })
});

// Inventory response schemas
export const InventoryStatusSchema = Type.Object({
  tenantId: TenantId,
  resourceId: ResourceId,
  resourceName: Type.String(),
  resourceType: Type.String(),
  totalCapacity: NonNegativeInteger,
  availableCapacity: NonNegativeInteger,
  bookedCapacity: NonNegativeInteger,
  maintenanceCapacity: NonNegativeInteger,
  utilization: PercentageFloat,
  status: Type.Union([
    Type.Literal('active'),
    Type.Literal('maintenance'),
    Type.Literal('inactive')
  ]),
  lastUpdated: ISODateString,
  alerts: Type.Array(Type.Object({
    type: Type.Union([
      Type.Literal('LOW_AVAILABILITY'),
      Type.Literal('HIGH_DEMAND'),
      Type.Literal('OVERBOOKED'),
      Type.Literal('UNDERUTILIZED')
    ]),
    severity: Type.Union([
      Type.Literal('LOW'),
      Type.Literal('MEDIUM'),
      Type.Literal('HIGH'),
      Type.Literal('CRITICAL')
    ]),
    message: Type.String(),
    threshold: NonNegativeInteger,
    currentValue: Type.Number(),
    timestamp: ISODateString
  }))
});

export const InventoryResponseSchema = Type.Object({
  success: Type.Boolean(),
  data: Type.Object({
    inventory: Type.Array(InventoryStatusSchema),
    pagination: Type.Object({
      page: PositiveInteger,
      limit: PositiveInteger,
      total: NonNegativeInteger,
      totalPages: NonNegativeInteger,
      hasNext: Type.Boolean(),
      hasPrev: Type.Boolean()
    }),
    summary: Type.Object({
      totalResources: NonNegativeInteger,
      activeResources: NonNegativeInteger,
      totalCapacity: NonNegativeInteger,
      availableCapacity: NonNegativeInteger,
      averageUtilization: PercentageFloat,
      criticalAlerts: NonNegativeInteger,
      highAlerts: NonNegativeInteger
    })
  })
});

export const InventoryDetailResponseSchema = Type.Object({
  success: Type.Boolean(),
  data: InventoryStatusSchema
});

export const InventoryUpdateResponseSchema = Type.Object({
  success: Type.Boolean(),
  data: Type.Object({
    resourceId: ResourceId,
    previousCapacity: NonNegativeInteger,
    newCapacity: NonNegativeInteger,
    updatedAt: ISODateString,
    reason: Type.Optional(Type.String())
  }),
  message: Type.String()
});

export const BulkInventoryUpdateResponseSchema = Type.Object({
  success: Type.Boolean(),
  data: Type.Object({
    processedCount: NonNegativeInteger,
    successfulCount: NonNegativeInteger,
    failedCount: NonNegativeInteger,
    results: Type.Array(Type.Object({
      resourceId: ResourceId,
      timeSlotId: TimeSlotId,
      success: Type.Boolean(),
      error: Type.Optional(Type.String()),
      newCapacity: Type.Optional(NonNegativeInteger)
    }))
  }),
  message: Type.String()
});

export const InventoryStatsResponseSchema = Type.Object({
  success: Type.Boolean(),
  data: Type.Object({
    period: DateRangeSchema,
    groupBy: Type.String(),
    stats: Type.Array(Type.Object({
      resourceId: Type.Optional(ResourceId),
      period: Type.String(), // Date or date range depending on groupBy
      metrics: Type.Object({
        totalSlots: NonNegativeInteger,
        availableSlots: NonNegativeInteger,
        bookedSlots: NonNegativeInteger,
        utilization: PercentageFloat,
        capacity: NonNegativeInteger,
        bookings: NonNegativeInteger,
        revenue: Type.Optional(Type.Number({ minimum: 0 }))
      })
    })),
    aggregated: Type.Object({
      totalUtilization: PercentageFloat,
      averageUtilization: PercentageFloat,
      peakUtilization: PercentageFloat,
      totalCapacity: NonNegativeInteger,
      totalBookings: NonNegativeInteger,
      totalRevenue: Type.Optional(Type.Number({ minimum: 0 }))
    })
  })
});

// Error response schemas
export const ErrorResponseSchema = Type.Object({
  success: Type.Literal(false),
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    details: Type.Optional(Type.Any()),
    timestamp: ISODateString,
    requestId: Type.Optional(Type.String())
  })
});

export const ValidationErrorResponseSchema = Type.Object({
  success: Type.Literal(false),
  error: Type.Object({
    code: Type.Literal('VALIDATION_ERROR'),
    message: Type.String(),
    details: Type.Array(Type.Object({
      field: Type.String(),
      message: Type.String(),
      value: Type.Any()
    })),
    timestamp: ISODateString
  })
});

// Type exports for use in handlers
export type AvailabilityQuery = Static<typeof AvailabilityQuerySchema>;
export type SlotsQuery = Static<typeof SlotsQuerySchema>;
export type CalendarQuery = Static<typeof CalendarQuerySchema>;
export type BatchAvailabilityRequest = Static<typeof BatchAvailabilitySchema>;
export type InventoryQuery = Static<typeof InventoryQuerySchema>;
export type InventoryUpdate = Static<typeof InventoryUpdateSchema>;
export type BulkInventoryUpdate = Static<typeof BulkInventoryUpdateSchema>;
export type InventoryStatsQuery = Static<typeof InventoryStatsQuerySchema>;

// Validation utilities
export const validateAvailabilityQuery = (data: unknown): AvailabilityQuery => {
  if (!Value.Check(AvailabilityQuerySchema, data)) {
    const errors = [...Value.Errors(AvailabilityQuerySchema, data)];
    throw new Error(`Validation failed: ${errors.map(e => `${e.path}: ${e.message}`).join(', ')}`);
  }
  return data as AvailabilityQuery;
};

export const validateInventoryUpdate = (data: unknown): InventoryUpdate => {
  if (!Value.Check(InventoryUpdateSchema, data)) {
    const errors = [...Value.Errors(InventoryUpdateSchema, data)];
    throw new Error(`Validation failed: ${errors.map(e => `${e.path}: ${e.message}`).join(', ')}`);
  }
  return data as InventoryUpdate;
};

// Schema registry for route registration
export const AvailabilitySchemas = {
  // Queries
  availabilityQuery: AvailabilityQuerySchema,
  slotsQuery: SlotsQuerySchema,
  calendarQuery: CalendarQuerySchema,
  batchAvailabilityQuery: BatchAvailabilitySchema,
  
  // Responses
  availabilityResponse: AvailabilityResponseSchema,
  slotsResponse: SlotsResponseSchema,
  calendarResponse: CalendarResponseSchema,
  resourceAvailabilityResponse: ResourceAvailabilityResponseSchema,
  batchAvailabilityResponse: BatchAvailabilityResponseSchema,
  
  // Common
  errorResponse: ErrorResponseSchema,
  validationErrorResponse: ValidationErrorResponseSchema
};

export const InventorySchemas = {
  // Queries
  inventoryQuery: InventoryQuerySchema,
  inventoryUpdate: InventoryUpdateSchema,
  bulkInventoryUpdate: BulkInventoryUpdateSchema,
  inventoryStatsQuery: InventoryStatsQuerySchema,
  
  // Responses
  inventoryResponse: InventoryResponseSchema,
  inventoryDetailResponse: InventoryDetailResponseSchema,
  inventoryUpdateResponse: InventoryUpdateResponseSchema,
  bulkInventoryUpdateResponse: BulkInventoryUpdateResponseSchema,
  inventoryStatsResponse: InventoryStatsResponseSchema,
  
  // Common
  errorResponse: ErrorResponseSchema,
  validationErrorResponse: ValidationErrorResponseSchema
};

export default {
  AvailabilitySchemas,
  InventorySchemas,
  // Validation functions
  validateAvailabilityQuery,
  validateInventoryUpdate
};