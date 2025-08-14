import { Type, Static } from '@sinclair/typebox';

/**
 * Common schemas for validation and sanitization
 * OWASP-compliant shared schema definitions for reusability and consistency
 */

/**
 * Pagination schema for list endpoints
 */
export const PaginationSchema = Type.Object({
  page: Type.Optional(Type.Integer({ 
    minimum: 1, 
    maximum: 10000,
    default: 1,
    description: 'Page number (1-based)' 
  })),
  limit: Type.Optional(Type.Integer({ 
    minimum: 1, 
    maximum: 100,
    default: 20,
    description: 'Items per page (max 100)' 
  })),
  offset: Type.Optional(Type.Integer({ 
    minimum: 0,
    description: 'Number of items to skip (calculated if not provided)' 
  }))
}, {
  description: 'Pagination parameters'
});

export type Pagination = Static<typeof PaginationSchema>;

/**
 * Sort schema with field validation
 */
export const SortSchema = Type.Object({
  field: Type.String({
    minLength: 1,
    maxLength: 50,
    pattern: '^[a-zA-Z][a-zA-Z0-9_]*$',
    description: 'Field name to sort by (alphanumeric with underscores)'
  }),
  order: Type.Optional(Type.Union([
    Type.Literal('asc'),
    Type.Literal('desc')
  ], {
    default: 'asc',
    description: 'Sort order'
  }))
}, {
  description: 'Sort parameters'
});

export type Sort = Static<typeof SortSchema>;

/**
 * Multi-field sort schema
 */
export const MultiSortSchema = Type.Array(SortSchema, {
  minItems: 1,
  maxItems: 5,
  description: 'Multiple sort fields (max 5)'
});

export type MultiSort = Static<typeof MultiSortSchema>;

/**
 * Filter schema for search operations
 */
export const FilterSchema = Type.Object({
  field: Type.String({
    minLength: 1,
    maxLength: 50,
    pattern: '^[a-zA-Z][a-zA-Z0-9_]*$',
    description: 'Field name to filter by'
  }),
  operator: Type.Union([
    Type.Literal('eq'),      // equals
    Type.Literal('ne'),      // not equals
    Type.Literal('gt'),      // greater than
    Type.Literal('gte'),     // greater than or equal
    Type.Literal('lt'),      // less than
    Type.Literal('lte'),     // less than or equal
    Type.Literal('in'),      // in array
    Type.Literal('nin'),     // not in array
    Type.Literal('like'),    // SQL LIKE
    Type.Literal('ilike'),   // case-insensitive LIKE
    Type.Literal('regex'),   // regex match
    Type.Literal('exists'),  // field exists
    Type.Literal('null'),    // is null
    Type.Literal('notnull')  // is not null
  ], {
    description: 'Filter operator'
  }),
  value: Type.Any({
    description: 'Filter value (type depends on operator and field)'
  })
}, {
  description: 'Single filter condition'
});

export type Filter = Static<typeof FilterSchema>;

/**
 * Multi-filter schema with logical operators
 */
export const MultiFilterSchema = Type.Object({
  logic: Type.Optional(Type.Union([
    Type.Literal('and'),
    Type.Literal('or')
  ], {
    default: 'and',
    description: 'Logical operator between filters'
  })),
  filters: Type.Array(FilterSchema, {
    minItems: 1,
    maxItems: 10,
    description: 'Filter conditions (max 10)'
  })
}, {
  description: 'Multiple filter conditions with logical operator'
});

export type MultiFilter = Static<typeof MultiFilterSchema>;

/**
 * Date range schema with timezone support
 */
export const DateRangeSchema = Type.Object({
  start: Type.Optional(Type.String({
    format: 'date-time',
    description: 'Start date/time (ISO 8601 format)'
  })),
  end: Type.Optional(Type.String({
    format: 'date-time',
    description: 'End date/time (ISO 8601 format)'
  })),
  timezone: Type.Optional(Type.String({
    minLength: 3,
    maxLength: 50,
    pattern: '^[a-zA-Z]{1,4}\/[a-zA-Z_]{1,30}$|^UTC$|^GMT$|^[+-]([0-1][0-9]|2[0-3]):[0-5][0-9]$',
    default: 'UTC',
    description: 'Timezone (IANA format, UTC, GMT, or offset like +09:00)'
  }))
}, {
  description: 'Date range with optional timezone'
});

export type DateRange = Static<typeof DateRangeSchema>;

/**
 * Time range schema for daily schedules
 */
export const TimeRangeSchema = Type.Object({
  start: Type.String({
    pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$',
    description: 'Start time (HH:MM format)'
  }),
  end: Type.String({
    pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$',
    description: 'End time (HH:MM format)'
  })
}, {
  description: 'Time range in 24-hour format'
});

export type TimeRange = Static<typeof TimeRangeSchema>;

/**
 * Multi-language text schema
 */
export const MultiLangTextSchema = Type.Object({
  ja: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 1000,
    description: 'Japanese text'
  })),
  en: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 1000,
    description: 'English text'
  })),
  ko: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 1000,
    description: 'Korean text'
  })),
  zh: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 1000,
    description: 'Chinese text'
  })),
  default: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 1000,
    description: 'Default/fallback text'
  }))
}, {
  minProperties: 1,
  description: 'Multi-language text content'
});

export type MultiLangText = Static<typeof MultiLangTextSchema>;

/**
 * File upload schema with security validation
 */
export const FileUploadSchema = Type.Object({
  filename: Type.String({
    minLength: 1,
    maxLength: 255,
    pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]*\\.[a-zA-Z0-9]{1,10}$',
    description: 'Secure filename with extension'
  }),
  mimetype: Type.String({
    pattern: '^[a-zA-Z]+\/[a-zA-Z0-9][a-zA-Z0-9!#$&\-\^_]*$',
    description: 'MIME type (RFC 2046 compliant)'
  }),
  size: Type.Integer({
    minimum: 1,
    maximum: 52428800, // 50MB
    description: 'File size in bytes (max 50MB)'
  }),
  checksum: Type.Optional(Type.String({
    minLength: 64,
    maxLength: 64,
    pattern: '^[a-f0-9]{64}$',
    description: 'SHA-256 checksum for integrity verification'
  }))
}, {
  description: 'File upload metadata'
});

export type FileUpload = Static<typeof FileUploadSchema>;

/**
 * Address schema for Japanese addresses
 */
export const AddressSchema = Type.Object({
  postal_code: Type.String({
    pattern: '^[0-9]{3}-[0-9]{4}$',
    description: 'Japanese postal code (XXX-XXXX format)'
  }),
  prefecture: Type.String({
    minLength: 2,
    maxLength: 10,
    pattern: '^[ぁ-ヿ一-龯ー]{2,10}$',
    description: 'Prefecture name in Japanese'
  }),
  city: Type.String({
    minLength: 1,
    maxLength: 50,
    pattern: '^[ぁ-ヿ一-龯ーa-zA-Z0-9\\s]{1,50}$',
    description: 'City name'
  }),
  address_line1: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Primary address line'
  }),
  address_line2: Type.Optional(Type.String({
    maxLength: 100,
    description: 'Secondary address line (building, apartment, etc.)'
  })),
  country_code: Type.Optional(Type.String({
    pattern: '^[A-Z]{2}$',
    default: 'JP',
    description: 'ISO 3166-1 alpha-2 country code'
  }))
}, {
  description: 'Japanese address format'
});

export type Address = Static<typeof AddressSchema>;

/**
 * Phone number schema for Japanese numbers
 */
export const PhoneNumberSchema = Type.Object({
  number: Type.String({
    pattern: '^(0[1-9][0-9]{8,9}|\\+81[1-9][0-9]{8,9})$',
    description: 'Japanese phone number (domestic or international format)'
  }),
  type: Type.Optional(Type.Union([
    Type.Literal('mobile'),
    Type.Literal('landline'),
    Type.Literal('fax'),
    Type.Literal('toll_free')
  ], {
    description: 'Phone number type'
  })),
  verified: Type.Optional(Type.Boolean({
    default: false,
    description: 'Whether the phone number has been verified'
  }))
}, {
  description: 'Phone number with validation'
});

export type PhoneNumber = Static<typeof PhoneNumberSchema>;

/**
 * Email schema with enhanced validation
 */
export const EmailSchema = Type.Object({
  address: Type.String({
    format: 'email',
    minLength: 5,
    maxLength: 320, // RFC 5321 limit
    transform: ['trim', 'lowercase'],
    description: 'Email address (RFC 5322 compliant)'
  }),
  verified: Type.Optional(Type.Boolean({
    default: false,
    description: 'Whether the email has been verified'
  })),
  primary: Type.Optional(Type.Boolean({
    default: false,
    description: 'Whether this is the primary email'
  }))
}, {
  description: 'Email with verification status'
});

export type Email = Static<typeof EmailSchema>;

/**
 * Currency amount schema
 */
export const CurrencyAmountSchema = Type.Object({
  amount: Type.Integer({
    minimum: 0,
    maximum: 999999999, // 9.99M in smallest unit
    description: 'Amount in smallest currency unit (e.g., yen)'
  }),
  currency: Type.String({
    pattern: '^[A-Z]{3}$',
    default: 'JPY',
    description: 'ISO 4217 currency code'
  })
}, {
  description: 'Currency amount with code'
});

export type CurrencyAmount = Static<typeof CurrencyAmountSchema>;

/**
 * Geolocation schema
 */
export const GeolocationSchema = Type.Object({
  latitude: Type.Number({
    minimum: -90,
    maximum: 90,
    description: 'Latitude coordinate'
  }),
  longitude: Type.Number({
    minimum: -180,
    maximum: 180,
    description: 'Longitude coordinate'
  }),
  accuracy: Type.Optional(Type.Number({
    minimum: 0,
    description: 'Accuracy in meters'
  })),
  altitude: Type.Optional(Type.Number({
    description: 'Altitude in meters'
  }))
}, {
  description: 'Geographic coordinates'
});

export type Geolocation = Static<typeof GeolocationSchema>;

/**
 * URL schema with security validation
 */
export const UrlSchema = Type.String({
  format: 'uri',
  minLength: 10,
  maxLength: 2083, // IE limit
  pattern: '^https?://[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?([.][a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*[/]?.*$',
  description: 'HTTP/HTTPS URL with length and format validation'
});

export type Url = Static<typeof UrlSchema>;

/**
 * UUID schema
 */
export const UUIDSchema = Type.String({
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  description: 'UUID v1-5 format'
});

export type UUID = Static<typeof UUIDSchema>;

/**
 * ID schema (UUID or positive integer)
 */
export const IDSchema = Type.Union([
  UUIDSchema,
  Type.String({
    pattern: '^[1-9][0-9]*$',
    description: 'Positive integer as string'
  })
], {
  description: 'Resource identifier (UUID or positive integer)'
});

export type ID = Static<typeof IDSchema>;

/**
 * Search query schema with sanitization
 */
export const SearchQuerySchema = Type.Object({
  q: Type.String({
    minLength: 1,
    maxLength: 500,
    pattern: '^[^<>\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]*$',
    description: 'Search query (no control characters or HTML)'
  }),
  fields: Type.Optional(Type.Array(Type.String({
    pattern: '^[a-zA-Z][a-zA-Z0-9_]*$'
  }), {
    minItems: 1,
    maxItems: 10,
    description: 'Fields to search in'
  })),
  fuzzy: Type.Optional(Type.Boolean({
    default: false,
    description: 'Enable fuzzy search'
  })),
  exact: Type.Optional(Type.Boolean({
    default: false,
    description: 'Require exact match'
  }))
}, {
  description: 'Search parameters'
});

export type SearchQuery = Static<typeof SearchQuerySchema>;

/**
 * Business hours schema
 */
export const BusinessHoursSchema = Type.Object({
  day_of_week: Type.Integer({
    minimum: 0,
    maximum: 6,
    description: 'Day of week (0=Sunday, 6=Saturday)'
  }),
  open_time: Type.String({
    pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$',
    description: 'Opening time (HH:MM format)'
  }),
  close_time: Type.String({
    pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$',
    description: 'Closing time (HH:MM format)'
  }),
  is_closed: Type.Optional(Type.Boolean({
    default: false,
    description: 'Whether the business is closed on this day'
  }))
}, {
  description: 'Business operating hours for a day'
});

export type BusinessHours = Static<typeof BusinessHoursSchema>;

/**
 * Common response metadata
 */
export const ResponseMetadataSchema = Type.Object({
  timestamp: Type.String({
    format: 'date-time',
    description: 'Response timestamp'
  }),
  correlation_id: Type.Optional(Type.String({
    description: 'Request correlation ID'
  })),
  version: Type.Optional(Type.String({
    pattern: '^v[0-9]+$',
    description: 'API version'
  })),
  total: Type.Optional(Type.Integer({
    minimum: 0,
    description: 'Total items count for paginated results'
  }))
}, {
  description: 'Common response metadata'
});

export type ResponseMetadata = Static<typeof ResponseMetadataSchema>;

/**
 * Validation constraint schema for dynamic validation
 */
export const ValidationConstraintSchema = Type.Object({
  field: Type.String({
    pattern: '^[a-zA-Z][a-zA-Z0-9_.]*$',
    description: 'Field path (dot notation supported)'
  }),
  type: Type.Union([
    Type.Literal('required'),
    Type.Literal('min_length'),
    Type.Literal('max_length'),
    Type.Literal('pattern'),
    Type.Literal('min_value'),
    Type.Literal('max_value'),
    Type.Literal('enum'),
    Type.Literal('custom')
  ], {
    description: 'Validation constraint type'
  }),
  value: Type.Any({
    description: 'Constraint value (type depends on constraint type)'
  }),
  message: Type.Optional(Type.String({
    maxLength: 200,
    description: 'Custom error message'
  }))
}, {
  description: 'Dynamic validation constraint'
});

export type ValidationConstraint = Static<typeof ValidationConstraintSchema>;

/**
 * Sanitization rule schema
 */
export const SanitizationRuleSchema = Type.Object({
  field: Type.String({
    pattern: '^[a-zA-Z][a-zA-Z0-9_.]*$',
    description: 'Field path (dot notation supported)'
  }),
  rules: Type.Array(Type.Union([
    Type.Literal('trim'),
    Type.Literal('lowercase'),
    Type.Literal('uppercase'),
    Type.Literal('escape_html'),
    Type.Literal('strip_html'),
    Type.Literal('normalize_space'),
    Type.Literal('remove_control_chars'),
    Type.Literal('encode_uri'),
    Type.Literal('sanitize_filename'),
    Type.Literal('normalize_unicode')
  ]), {
    minItems: 1,
    description: 'List of sanitization rules to apply'
  })
}, {
  description: 'Field sanitization rule'
});

export type SanitizationRule = Static<typeof SanitizationRuleSchema>;