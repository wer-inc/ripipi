/**
 * Service API Schema Definitions
 * TypeBox schemas for service endpoints with comprehensive validation,
 * multi-language support, and business rule enforcement
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
 * Service base schema for core service information
 */
export const ServiceBaseSchema = Type.Object({
  id: IDSchema,
  tenantId: IDSchema,
  name: MultiLangTextSchema,
  description: Type.Optional(MultiLangTextSchema),
  durationMin: Type.Integer({
    minimum: 5,
    maximum: 1440, // 24 hours max
    description: 'Service duration in minutes'
  }),
  priceJpy: Type.Integer({
    minimum: 0,
    maximum: 10000000, // 10M JPY max
    description: 'Service price in Japanese Yen'
  }),
  bufferBeforeMin: Type.Optional(Type.Integer({
    minimum: 0,
    maximum: 240, // 4 hours max
    default: 0,
    description: 'Buffer time before service starts (minutes)'
  })),
  bufferAfterMin: Type.Optional(Type.Integer({
    minimum: 0,
    maximum: 240, // 4 hours max  
    default: 0,
    description: 'Buffer time after service ends (minutes)'
  })),
  active: Type.Boolean({
    default: true,
    description: 'Whether the service is active'
  }),
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
  description: 'Base service information'
});

/**
 * Service response schema with resource relationships
 */
export const ServiceResponseSchema = Type.Intersect([
  ServiceBaseSchema,
  Type.Object({
    availableResources: Type.Optional(Type.Array(Type.Object({
      resourceId: IDSchema,
      resourceName: MultiLangTextSchema,
      resourceKind: Type.Union([
        Type.Literal('staff'),
        Type.Literal('seat'),
        Type.Literal('room'),
        Type.Literal('table')
      ]),
      capacity: Type.Integer({ minimum: 1, description: 'Resource capacity' }),
      active: Type.Boolean({ description: 'Whether resource is active' })
    }), {
      description: 'Resources that can provide this service'
    })),
    totalBookings: Type.Optional(Type.Integer({
      minimum: 0,
      description: 'Total number of bookings for this service'
    })),
    metadata: Type.Optional(Type.Record(Type.String(), Type.Any(), {
      description: 'Additional service metadata'
    }))
  })
], {
  description: 'Complete service information with relationships'
});

export type ServiceResponse = Static<typeof ServiceResponseSchema>;

/**
 * Create service request schema
 */
export const CreateServiceRequestSchema = Type.Object({
  name: MultiLangTextSchema,
  description: Type.Optional(MultiLangTextSchema),
  durationMin: Type.Integer({
    minimum: 5,
    maximum: 1440,
    description: 'Service duration in minutes'
  }),
  priceJpy: Type.Integer({
    minimum: 0,
    maximum: 10000000,
    description: 'Service price in Japanese Yen'
  }),
  bufferBeforeMin: Type.Optional(Type.Integer({
    minimum: 0,
    maximum: 240,
    default: 0,
    description: 'Buffer time before service (minutes)'
  })),
  bufferAfterMin: Type.Optional(Type.Integer({
    minimum: 0,
    maximum: 240,
    default: 0,
    description: 'Buffer time after service (minutes)'
  })),
  active: Type.Optional(Type.Boolean({
    default: true,
    description: 'Whether the service should be active'
  })),
  resourceIds: Type.Optional(Type.Array(IDSchema, {
    minItems: 0,
    maxItems: 50,
    description: 'Resource IDs that can provide this service'
  })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Any(), {
    description: 'Additional service metadata'
  }))
}, {
  description: 'Create service request'
});

export type CreateServiceRequest = Static<typeof CreateServiceRequestSchema>;

/**
 * Update service request schema
 */
export const UpdateServiceRequestSchema = Type.Object({
  name: Type.Optional(MultiLangTextSchema),
  description: Type.Optional(MultiLangTextSchema),
  durationMin: Type.Optional(Type.Integer({
    minimum: 5,
    maximum: 1440,
    description: 'Service duration in minutes'
  })),
  priceJpy: Type.Optional(Type.Integer({
    minimum: 0,
    maximum: 10000000,
    description: 'Service price in Japanese Yen'
  })),
  bufferBeforeMin: Type.Optional(Type.Integer({
    minimum: 0,
    maximum: 240,
    description: 'Buffer time before service (minutes)'
  })),
  bufferAfterMin: Type.Optional(Type.Integer({
    minimum: 0,
    maximum: 240,
    description: 'Buffer time after service (minutes)'
  })),
  active: Type.Optional(Type.Boolean({
    description: 'Whether the service should be active'
  })),
  resourceIds: Type.Optional(Type.Array(IDSchema, {
    minItems: 0,
    maxItems: 50,
    description: 'Resource IDs that can provide this service'
  })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Any(), {
    description: 'Additional service metadata'
  }))
}, {
  minProperties: 1,
  description: 'Update service request'
});

export type UpdateServiceRequest = Static<typeof UpdateServiceRequestSchema>;

/**
 * Service search/filter query schema
 */
export const ServiceSearchQuerySchema = Type.Object({
  name: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Search by service name'
  })),
  active: Type.Optional(Type.Boolean({
    description: 'Filter by active status'
  })),
  minPrice: Type.Optional(Type.Integer({
    minimum: 0,
    description: 'Minimum price filter'
  })),
  maxPrice: Type.Optional(Type.Integer({
    minimum: 0,
    description: 'Maximum price filter'
  })),
  minDuration: Type.Optional(Type.Integer({
    minimum: 5,
    description: 'Minimum duration filter (minutes)'
  })),
  maxDuration: Type.Optional(Type.Integer({
    minimum: 5,
    description: 'Maximum duration filter (minutes)'
  })),
  resourceId: Type.Optional(IDSchema, {
    description: 'Filter services that can be provided by this resource'
  }),
  includeResources: Type.Optional(Type.Boolean({
    default: false,
    description: 'Include associated resources in response'
  })),
  includeInactive: Type.Optional(Type.Boolean({
    default: false,
    description: 'Include inactive services'
  })),
  search: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'General text search in name/description'
  })),
  ...PaginationSchema.properties,
  sortBy: Type.Optional(Type.Union([
    Type.Literal('name'),
    Type.Literal('priceJpy'),
    Type.Literal('durationMin'),
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
  description: 'Service search parameters'
});

export type ServiceSearchQuery = Static<typeof ServiceSearchQuerySchema>;

/**
 * Service list response schema
 */
export const ServiceListResponseSchema = Type.Object({
  data: Type.Array(ServiceResponseSchema, {
    description: 'Service list'
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
    totalActive: Type.Integer({ minimum: 0, description: 'Total active services' }),
    totalInactive: Type.Integer({ minimum: 0, description: 'Total inactive services' }),
    averagePrice: Type.Number({ minimum: 0, description: 'Average service price' }),
    averageDuration: Type.Number({ minimum: 0, description: 'Average service duration' }),
    priceRange: Type.Object({
      min: Type.Integer({ minimum: 0 }),
      max: Type.Integer({ minimum: 0 })
    })
  }, {
    description: 'List statistics'
  })),
  metadata: ResponseMetadataSchema
}, {
  description: 'Service list response'
});

export type ServiceListResponse = Static<typeof ServiceListResponseSchema>;

/**
 * Service-resource relationship schema
 */
export const ServiceResourceRequestSchema = Type.Object({
  resourceIds: Type.Array(IDSchema, {
    minItems: 1,
    maxItems: 50,
    description: 'Resource IDs to associate with the service'
  }),
  active: Type.Optional(Type.Boolean({
    default: true,
    description: 'Whether the relationship should be active'
  }))
}, {
  description: 'Service-resource relationship request'
});

export type ServiceResourceRequest = Static<typeof ServiceResourceRequestSchema>;

/**
 * Service availability request schema
 */
export const ServiceAvailabilityRequestSchema = Type.Object({
  startDate: Type.String({
    format: 'date-time',
    description: 'Start date for availability check'
  }),
  endDate: Type.String({
    format: 'date-time',
    description: 'End date for availability check'
  }),
  resourceId: Type.Optional(IDSchema, {
    description: 'Check availability for specific resource only'
  })
}, {
  description: 'Service availability request'
});

export type ServiceAvailabilityRequest = Static<typeof ServiceAvailabilityRequestSchema>;

/**
 * Service availability response schema
 */
export const ServiceAvailabilityResponseSchema = Type.Object({
  serviceId: IDSchema,
  serviceName: MultiLangTextSchema,
  availableSlots: Type.Array(Type.Object({
    resourceId: IDSchema,
    resourceName: MultiLangTextSchema,
    startTime: Type.String({ format: 'date-time' }),
    endTime: Type.String({ format: 'date-time' }),
    capacity: Type.Integer({ minimum: 1 }),
    availableCapacity: Type.Integer({ minimum: 0 })
  }), {
    description: 'Available time slots for this service'
  }),
  totalAvailableSlots: Type.Integer({
    minimum: 0,
    description: 'Total number of available slots'
  }),
  metadata: ResponseMetadataSchema
}, {
  description: 'Service availability response'
});

export type ServiceAvailabilityResponse = Static<typeof ServiceAvailabilityResponseSchema>;

/**
 * Route parameter schemas
 */
export const ServiceParamsSchema = Type.Object({
  id: IDSchema
}, {
  description: 'Service route parameters'
});

export type ServiceParams = Static<typeof ServiceParamsSchema>;

/**
 * Success response schema
 */
export const ServiceSuccessResponseSchema = Type.Object({
  success: Type.Boolean({ const: true }),
  data: ServiceResponseSchema,
  metadata: ResponseMetadataSchema
}, {
  description: 'Successful service operation response'
});

export type ServiceSuccessResponse = Static<typeof ServiceSuccessResponseSchema>;

/**
 * Error response schema
 */
export const ServiceErrorResponseSchema = Type.Object({
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
  description: 'Service API error response'
});

export type ServiceErrorResponse = Static<typeof ServiceErrorResponseSchema>;