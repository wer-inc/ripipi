import { Type, Static } from '@sinclair/typebox';
import { IDSchema } from './common.js';

/**
 * Timeslot schemas for validation and API documentation
 * Based on API specification for slot generation endpoint
 */

/**
 * Slot granularity type
 */
export const SlotGranularitySchema = Type.Union([
  Type.Literal(5),
  Type.Literal(15)
], {
  description: 'Slot granularity in minutes (5 or 15)'
});

export type SlotGranularity = Static<typeof SlotGranularitySchema>;

/**
 * Business hours schema for slot generation
 */
export const BusinessHoursSchema = Type.Object({
  dayOfWeek: Type.Integer({
    minimum: 0,
    maximum: 6,
    description: 'Day of week (0=Sunday, 1=Monday, ..., 6=Saturday)'
  }),
  openTime: Type.String({
    pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$',
    description: 'Opening time in HH:MM format'
  }),
  closeTime: Type.String({
    pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$',
    description: 'Closing time in HH:MM format'
  }),
  effectiveFrom: Type.Optional(Type.String({
    format: 'date-time',
    description: 'Effective start date for these business hours'
  })),
  effectiveTo: Type.Optional(Type.String({
    format: 'date-time',
    description: 'Effective end date for these business hours'
  }))
}, {
  description: 'Business hours configuration for slot generation'
});

export type BusinessHours = Static<typeof BusinessHoursSchema>;

/**
 * Holiday schema for slot generation
 */
export const HolidaySchema = Type.Object({
  date: Type.String({
    format: 'date',
    description: 'Holiday date in YYYY-MM-DD format'
  }),
  name: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Holiday name'
  })
}, {
  description: 'Holiday configuration for slot generation'
});

export type Holiday = Static<typeof HolidaySchema>;

/**
 * Resource time-off schema for slot generation
 */
export const ResourceTimeOffSchema = Type.Object({
  resourceId: IDSchema,
  startTime: Type.String({
    format: 'date-time',
    description: 'Time-off start time in ISO 8601 format'
  }),
  endTime: Type.String({
    format: 'date-time',
    description: 'Time-off end time in ISO 8601 format'
  }),
  reason: Type.String({
    minLength: 1,
    maxLength: 200,
    description: 'Reason for time-off'
  })
}, {
  description: 'Resource time-off configuration for slot generation'
});

export type ResourceTimeOff = Static<typeof ResourceTimeOffSchema>;

/**
 * Timeslot generate request schema (POST /timeslots/generate)
 */
export const TimeslotGenerateRequestSchema = Type.Object({
  tenant_id: Type.Integer({
    minimum: 1,
    description: 'Tenant ID'
  }),
  resourceId: IDSchema,
  startDate: Type.String({
    format: 'date',
    description: 'Start date for slot generation (YYYY-MM-DD)'
  }),
  endDate: Type.String({
    format: 'date', 
    description: 'End date for slot generation (YYYY-MM-DD)'
  }),
  duration: Type.Integer({
    minimum: 5,
    maximum: 1440,
    description: 'Service duration in minutes'
  }),
  businessHours: Type.Array(BusinessHoursSchema, {
    minItems: 1,
    maxItems: 7,
    description: 'Business hours configuration for the week'
  }),
  buffer: Type.Optional(Type.Integer({
    minimum: 0,
    maximum: 60,
    default: 0,
    description: 'Buffer time between slots in minutes'
  })),
  skipExisting: Type.Optional(Type.Boolean({
    default: true,
    description: 'Whether to skip already created slots'
  })),
  holidays: Type.Optional(Type.Array(HolidaySchema, {
    maxItems: 365,
    description: 'Holiday calendar'
  })),
  timeOffs: Type.Optional(Type.Array(ResourceTimeOffSchema, {
    maxItems: 100,
    description: 'Resource availability patterns/time-offs'
  })),
  granularity: Type.Optional(SlotGranularitySchema),
  capacity: Type.Optional(Type.Integer({
    minimum: 1,
    maximum: 1000,
    default: 1,
    description: 'Slot capacity'
  })),
  dry_run: Type.Optional(Type.Boolean({
    default: false,
    description: 'If true, only return count without creating slots'
  }))
}, {
  description: 'Request body for generating time slots',
  additionalProperties: false
});

export type TimeslotGenerateRequest = Static<typeof TimeslotGenerateRequestSchema>;

/**
 * Timeslot generate response schema
 */
export const TimeslotGenerateResponseSchema = Type.Object({
  generated: Type.Integer({
    minimum: 0,
    description: 'Number of slots generated'
  }),
  updated: Type.Integer({
    minimum: 0,
    description: 'Number of existing slots updated'
  }),
  deleted: Type.Integer({
    minimum: 0,
    description: 'Number of slots deleted'
  }),
  skipped: Type.Optional(Type.Integer({
    minimum: 0,
    description: 'Number of slots skipped (when skipExisting is true)'
  })),
  conflictCount: Type.Optional(Type.Integer({
    minimum: 0,
    description: 'Number of slots with conflicts'
  })),
  processingTime: Type.Optional(Type.Number({
    minimum: 0,
    description: 'Processing time in milliseconds'
  }))
}, {
  description: 'Response for timeslot generation'
});

export type TimeslotGenerateResponse = Static<typeof TimeslotGenerateResponseSchema>;

/**
 * Dry run response schema
 */
export const TimeslotGenerateDryRunResponseSchema = Type.Object({
  will_generate: Type.Integer({
    minimum: 0,
    description: 'Number of slots that would be generated'
  }),
  will_update: Type.Integer({
    minimum: 0,
    description: 'Number of slots that would be updated'
  }),
  will_delete: Type.Integer({
    minimum: 0,
    description: 'Number of slots that would be deleted'
  }),
  will_skip: Type.Optional(Type.Integer({
    minimum: 0,
    description: 'Number of slots that would be skipped'
  })),
  estimatedTime: Type.Optional(Type.Number({
    minimum: 0,
    description: 'Estimated processing time in milliseconds'
  })),
  potentialConflicts: Type.Optional(Type.Array(Type.Object({
    slotTime: Type.String({
      format: 'date-time',
      description: 'Time of conflicting slot'
    }),
    reason: Type.String({
      description: 'Conflict reason'
    })
  }), {
    description: 'Potential conflicts that would be encountered'
  }))
}, {
  description: 'Response for dry run slot generation'
});

export type TimeslotGenerateDryRunResponse = Static<typeof TimeslotGenerateDryRunResponseSchema>;

/**
 * Timeslot entity schema (for responses)
 */
export const TimeslotSchema = Type.Object({
  timeslot_id: Type.Integer({
    description: 'Timeslot ID'
  }),
  tenant_id: Type.Integer({
    description: 'Tenant ID'
  }),
  service_id: Type.Optional(Type.Integer({
    description: 'Service ID'
  })),
  resource_id: Type.Integer({
    description: 'Resource ID'
  }),
  start_at: Type.String({
    format: 'date-time',
    description: 'Slot start time in ISO 8601 format'
  }),
  end_at: Type.String({
    format: 'date-time',
    description: 'Slot end time in ISO 8601 format'
  }),
  available_capacity: Type.Integer({
    minimum: 0,
    description: 'Available capacity for this slot'
  }),
  total_capacity: Type.Optional(Type.Integer({
    minimum: 0,
    description: 'Total capacity for this slot'
  })),
  created_at: Type.Optional(Type.String({
    format: 'date-time',
    description: 'Creation timestamp'
  })),
  updated_at: Type.Optional(Type.String({
    format: 'date-time',
    description: 'Last update timestamp'
  }))
}, {
  description: 'Timeslot entity',
  additionalProperties: false
});

export type Timeslot = Static<typeof TimeslotSchema>;

/**
 * Timeslot query parameters schema (GET /timeslots)
 */
export const TimeslotQuerySchema = Type.Object({
  tenant_id: Type.Integer({
    minimum: 1,
    description: 'Tenant ID (required)'
  }),
  service_id: Type.Optional(Type.Integer({
    minimum: 1,
    description: 'Service ID filter'
  })),
  resource_id: Type.Optional(Type.Integer({
    minimum: 1,
    description: 'Resource ID filter'
  })),
  from: Type.String({
    format: 'date-time',
    description: 'Start date/time filter (ISO 8601)'
  }),
  to: Type.String({
    format: 'date-time',
    description: 'End date/time filter (ISO 8601)'
  }),
  cursor: Type.Optional(Type.String({
    description: 'Pagination cursor'
  })),
  limit: Type.Optional(Type.Integer({
    minimum: 1,
    maximum: 200,
    default: 50,
    description: 'Number of items to return (max 200)'
  }))
}, {
  description: 'Query parameters for timeslot search',
  additionalProperties: false
});

export type TimeslotQuery = Static<typeof TimeslotQuerySchema>;

/**
 * Validation error detail schema
 */
export const ValidationErrorDetailSchema = Type.Object({
  field: Type.String({
    description: 'Field name that failed validation'
  }),
  reason: Type.String({
    description: 'Reason for validation failure'
  }),
  value: Type.Optional(Type.Any({
    description: 'The invalid value (omitted for sensitive data)'
  }))
}, {
  description: 'Validation error detail'
});

export type ValidationErrorDetail = Static<typeof ValidationErrorDetailSchema>;

/**
 * API error response schema
 */
export const ErrorResponseSchema = Type.Object({
  code: Type.String({
    description: 'Error code'
  }),
  message: Type.String({
    description: 'Human-readable error message'
  }),
  details: Type.Optional(Type.Array(ValidationErrorDetailSchema, {
    description: 'Detailed error information'
  })),
  timestamp: Type.Optional(Type.String({
    format: 'date-time',
    description: 'Error timestamp'
  })),
  correlation_id: Type.Optional(Type.String({
    description: 'Request correlation ID for debugging'
  }))
}, {
  description: 'Standard API error response'
});

export type ErrorResponse = Static<typeof ErrorResponseSchema>;