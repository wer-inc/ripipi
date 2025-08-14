/**
 * Resource API Schema Definitions
 * TypeBox schemas for resource endpoints with comprehensive validation,
 * multi-language support, and resource management capabilities
 */

import { Type, Static } from '@sinclair/typebox';
import { 
  PaginationSchema, 
  SortSchema, 
  FilterSchema, 
  IDSchema,
  ResponseMetadataSchema,
  MultiLangTextSchema
} from './common.js';

/**
 * Resource kind enum schema
 */
export const ResourceKindSchema = Type.Union([
  Type.Literal('staff'),
  Type.Literal('seat'),
  Type.Literal('room'),
  Type.Literal('table')
], {
  description: 'Resource type classification'
});

export type ResourceKind = Static<typeof ResourceKindSchema>;

/**
 * Resource base schema for core resource information
 */
export const ResourceBaseSchema = Type.Object({
  id: IDSchema,
  tenantId: IDSchema,
  kind: ResourceKindSchema,
  name: MultiLangTextSchema,
  description: Type.Optional(MultiLangTextSchema),
  capacity: Type.Integer({
    minimum: 1,
    maximum: 1000,
    description: 'Maximum capacity of the resource'
  }),
  active: Type.Boolean({
    default: true,
    description: 'Whether the resource is active'
  }),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Any(), {
    description: 'Additional resource metadata'
  })),
  createdAt: Type.String({
    format: 'date-time',
    description: 'Creation timestamp'
  }),
  updatedAt: Type.String({
    format: 'date-time',
    description: 'Last update timestamp'
  }),
  deletedAt: Type.Optional(Type.String({
    format: 'date-time',
    description: 'Soft deletion timestamp'
  }))
}, {
  description: 'Base resource information'
});

/**
 * Resource response schema with service relationships and availability
 */
export const ResourceResponseSchema = Type.Intersect([
  ResourceBaseSchema,
  Type.Object({
    availableServices: Type.Optional(Type.Array(Type.Object({
      serviceId: IDSchema,
      serviceName: MultiLangTextSchema,
      durationMin: Type.Integer({ minimum: 1, description: 'Service duration' }),
      priceJpy: Type.Integer({ minimum: 0, description: 'Service price' }),
      active: Type.Boolean({ description: 'Whether service-resource relationship is active' })
    }), {
      description: 'Services that can be provided by this resource'
    })),
    currentUtilization: Type.Optional(Type.Object({
      totalSlots: Type.Integer({ minimum: 0, description: 'Total available slots today' }),
      bookedSlots: Type.Integer({ minimum: 0, description: 'Booked slots today' }),
      utilizationRate: Type.Number({ minimum: 0, maximum: 100, description: 'Utilization percentage' }),
      nextAvailable: Type.Optional(Type.String({
        format: 'date-time',
        description: 'Next available slot start time'
      }))
    }, {
      description: 'Current utilization statistics'
    })),
    businessHours: Type.Optional(Type.Array(Type.Object({
      dayOfWeek: Type.Integer({ minimum: 0, maximum: 6, description: 'Day of week (0=Sunday)' }),
      openTime: Type.String({ pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$', description: 'Opening time (HH:MM)' }),
      closeTime: Type.String({ pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$', description: 'Closing time (HH:MM)' })
    }), {
      description: 'Resource-specific business hours'
    })),
    groups: Type.Optional(Type.Array(Type.Object({
      groupId: IDSchema,
      groupName: Type.String({ description: 'Group name' }),
      groupKind: Type.String({ description: 'Group kind/category' })
    }), {
      description: 'Resource groups this resource belongs to'
    }))
  })
], {
  description: 'Complete resource information with relationships'
});

export type ResourceResponse = Static<typeof ResourceResponseSchema>;

/**
 * Create resource request schema
 */
export const CreateResourceRequestSchema = Type.Object({
  kind: ResourceKindSchema,
  name: MultiLangTextSchema,
  description: Type.Optional(MultiLangTextSchema),
  capacity: Type.Integer({
    minimum: 1,
    maximum: 1000,
    description: 'Maximum capacity of the resource'
  }),
  active: Type.Optional(Type.Boolean({
    default: true,
    description: 'Whether the resource should be active'
  })),
  serviceIds: Type.Optional(Type.Array(IDSchema, {
    minItems: 0,
    maxItems: 50,
    description: 'Service IDs that this resource can provide'
  })),
  businessHours: Type.Optional(Type.Array(Type.Object({
    dayOfWeek: Type.Integer({ minimum: 0, maximum: 6, description: 'Day of week (0=Sunday)' }),
    openTime: Type.String({ pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$', description: 'Opening time (HH:MM)' }),
    closeTime: Type.String({ pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$', description: 'Closing time (HH:MM)' })
  }), {
    minItems: 0,
    maxItems: 7,
    description: 'Resource-specific business hours'
  })),
  groupIds: Type.Optional(Type.Array(IDSchema, {
    minItems: 0,
    maxItems: 10,
    description: 'Group IDs this resource should belong to'
  })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Any(), {
    description: 'Additional resource metadata'
  }))
}, {
  description: 'Create resource request'
});

export type CreateResourceRequest = Static<typeof CreateResourceRequestSchema>;

/**
 * Update resource request schema
 */
export const UpdateResourceRequestSchema = Type.Object({
  kind: Type.Optional(ResourceKindSchema),
  name: Type.Optional(MultiLangTextSchema),
  description: Type.Optional(MultiLangTextSchema),
  capacity: Type.Optional(Type.Integer({
    minimum: 1,
    maximum: 1000,
    description: 'Maximum capacity of the resource'
  })),
  active: Type.Optional(Type.Boolean({
    description: 'Whether the resource should be active'
  })),
  serviceIds: Type.Optional(Type.Array(IDSchema, {
    minItems: 0,
    maxItems: 50,
    description: 'Service IDs that this resource can provide'
  })),
  businessHours: Type.Optional(Type.Array(Type.Object({
    dayOfWeek: Type.Integer({ minimum: 0, maximum: 6, description: 'Day of week (0=Sunday)' }),
    openTime: Type.String({ pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$', description: 'Opening time (HH:MM)' }),
    closeTime: Type.String({ pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$', description: 'Closing time (HH:MM)' })
  }), {
    minItems: 0,
    maxItems: 7,
    description: 'Resource-specific business hours'
  })),
  groupIds: Type.Optional(Type.Array(IDSchema, {
    minItems: 0,
    maxItems: 10,
    description: 'Group IDs this resource should belong to'
  })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Any(), {
    description: 'Additional resource metadata'
  }))
}, {
  minProperties: 1,
  description: 'Update resource request'
});

export type UpdateResourceRequest = Static<typeof UpdateResourceRequestSchema>;

/**
 * Resource search/filter query schema
 */
export const ResourceSearchQuerySchema = Type.Object({
  name: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Search by resource name'
  })),
  kind: Type.Optional(Type.Union([
    ResourceKindSchema,
    Type.Array(ResourceKindSchema, {
      minItems: 1,
      maxItems: 4,
      description: 'Multiple resource kinds'
    })
  ], {
    description: 'Filter by resource kind'
  })),
  active: Type.Optional(Type.Boolean({
    description: 'Filter by active status'
  })),
  minCapacity: Type.Optional(Type.Integer({
    minimum: 1,
    description: 'Minimum capacity filter'
  })),
  maxCapacity: Type.Optional(Type.Integer({
    minimum: 1,
    description: 'Maximum capacity filter'
  })),
  serviceId: Type.Optional(IDSchema, {
    description: 'Filter resources that can provide this service'
  }),
  groupId: Type.Optional(IDSchema, {
    description: 'Filter resources in this group'
  }),
  available: Type.Optional(Type.Boolean({
    description: 'Filter by current availability'
  })),
  availableAt: Type.Optional(Type.String({
    format: 'date-time',
    description: 'Filter resources available at specific time'
  })),
  includeServices: Type.Optional(Type.Boolean({
    default: false,
    description: 'Include associated services in response'
  })),
  includeUtilization: Type.Optional(Type.Boolean({
    default: false,
    description: 'Include utilization statistics'
  })),
  includeInactive: Type.Optional(Type.Boolean({
    default: false,
    description: 'Include inactive resources'
  })),
  search: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'General text search in name/description'
  })),
  ...PaginationSchema.properties,
  sortBy: Type.Optional(Type.Union([
    Type.Literal('name'),
    Type.Literal('kind'),
    Type.Literal('capacity'),
    Type.Literal('createdAt'),
    Type.Literal('updatedAt')
  ], {
    default: 'name',
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
  description: 'Resource search parameters'
});

export type ResourceSearchQuery = Static<typeof ResourceSearchQuerySchema>;

/**
 * Resource list response schema
 */
export const ResourceListResponseSchema = Type.Object({
  data: Type.Array(ResourceResponseSchema, {
    description: 'Resource list'
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
    totalByKind: Type.Record(ResourceKindSchema, Type.Integer({ minimum: 0 }), {
      description: 'Count by resource kind'
    }),
    totalActive: Type.Integer({ minimum: 0, description: 'Total active resources' }),
    totalInactive: Type.Integer({ minimum: 0, description: 'Total inactive resources' }),
    totalCapacity: Type.Integer({ minimum: 0, description: 'Sum of all resource capacities' }),
    averageCapacity: Type.Number({ minimum: 0, description: 'Average resource capacity' }),
    utilizationStats: Type.Optional(Type.Object({
      averageUtilization: Type.Number({ minimum: 0, maximum: 100 }),
      highestUtilization: Type.Number({ minimum: 0, maximum: 100 }),
      lowestUtilization: Type.Number({ minimum: 0, maximum: 100 })
    }))
  }, {
    description: 'List statistics'
  })),
  metadata: ResponseMetadataSchema
}, {
  description: 'Resource list response'
});

export type ResourceListResponse = Static<typeof ResourceListResponseSchema>;

/**
 * Resource availability request schema
 */
export const ResourceAvailabilityRequestSchema = Type.Object({
  startDate: Type.String({
    format: 'date-time',
    description: 'Start date for availability check'
  }),
  endDate: Type.String({
    format: 'date-time',
    description: 'End date for availability check'
  }),
  serviceId: Type.Optional(IDSchema, {
    description: 'Check availability for specific service only'
  }),
  capacity: Type.Optional(Type.Integer({
    minimum: 1,
    description: 'Required capacity'
  }))
}, {
  description: 'Resource availability request'
});

export type ResourceAvailabilityRequest = Static<typeof ResourceAvailabilityRequestSchema>;

/**
 * Resource availability response schema
 */
export const ResourceAvailabilityResponseSchema = Type.Object({
  resourceId: IDSchema,
  resourceName: MultiLangTextSchema,
  resourceKind: ResourceKindSchema,
  totalCapacity: Type.Integer({ minimum: 1, description: 'Total resource capacity' }),
  availableSlots: Type.Array(Type.Object({
    startTime: Type.String({ format: 'date-time' }),
    endTime: Type.String({ format: 'date-time' }),
    availableCapacity: Type.Integer({ minimum: 0 }),
    serviceIds: Type.Optional(Type.Array(IDSchema, {
      description: 'Services that can use this slot'
    }))
  }), {
    description: 'Available time slots for this resource'
  }),
  totalAvailableSlots: Type.Integer({
    minimum: 0,
    description: 'Total number of available slots'
  }),
  utilizationRate: Type.Number({
    minimum: 0,
    maximum: 100,
    description: 'Current utilization percentage'
  }),
  metadata: ResponseMetadataSchema
}, {
  description: 'Resource availability response'
});

export type ResourceAvailabilityResponse = Static<typeof ResourceAvailabilityResponseSchema>;

/**
 * Resource schedule request schema (for setting business hours, holidays, etc.)
 */
export const ResourceScheduleRequestSchema = Type.Object({
  businessHours: Type.Optional(Type.Array(Type.Object({
    dayOfWeek: Type.Integer({ minimum: 0, maximum: 6, description: 'Day of week (0=Sunday)' }),
    openTime: Type.String({ pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$', description: 'Opening time (HH:MM)' }),
    closeTime: Type.String({ pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$', description: 'Closing time (HH:MM)' }),
    effectiveFrom: Type.Optional(Type.String({ format: 'date', description: 'Effective from date' })),
    effectiveTo: Type.Optional(Type.String({ format: 'date', description: 'Effective to date' }))
  }), {
    description: 'Business hours settings'
  })),
  holidays: Type.Optional(Type.Array(Type.Object({
    date: Type.String({ format: 'date', description: 'Holiday date' }),
    name: Type.String({ description: 'Holiday name' })
  }), {
    description: 'Holiday dates'
  })),
  timeOffs: Type.Optional(Type.Array(Type.Object({
    startAt: Type.String({ format: 'date-time', description: 'Time off start' }),
    endAt: Type.String({ format: 'date-time', description: 'Time off end' }),
    reason: Type.String({ description: 'Reason for time off' })
  }), {
    description: 'Time off periods'
  }))
}, {
  description: 'Resource schedule configuration request'
});

export type ResourceScheduleRequest = Static<typeof ResourceScheduleRequestSchema>;

/**
 * Route parameter schemas
 */
export const ResourceParamsSchema = Type.Object({
  id: IDSchema
}, {
  description: 'Resource route parameters'
});

export type ResourceParams = Static<typeof ResourceParamsSchema>;

/**
 * Success response schema
 */
export const ResourceSuccessResponseSchema = Type.Object({
  success: Type.Boolean({ const: true }),
  data: ResourceResponseSchema,
  metadata: ResponseMetadataSchema
}, {
  description: 'Successful resource operation response'
});

export type ResourceSuccessResponse = Static<typeof ResourceSuccessResponseSchema>;

/**
 * Error response schema
 */
export const ResourceErrorResponseSchema = Type.Object({
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
    timestamp: Type.String({ format: 'date-time', description: 'Error timestamp' })
  }),
  suggestions: Type.Optional(Type.Array(Type.Object({
    action: Type.String({ description: 'Suggested action' }),
    description: Type.String({ description: 'Action description' })
  }), {
    description: 'Suggested actions to resolve the issue'
  }))
}, {
  description: 'Resource API error response'
});

export type ResourceErrorResponse = Static<typeof ResourceErrorResponseSchema>;