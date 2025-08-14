/**
 * Cache Key Management Utilities
 * Provides standardized cache key generation, namespace management, and TTL helpers
 */

import { config } from '../config/index.js';

/**
 * Cache namespaces for different types of data
 */
export enum CacheNamespace {
  // User related
  USER_SESSION = 'user:session',
  USER_PROFILE = 'user:profile',
  USER_PERMISSIONS = 'user:permissions',
  
  // Authentication
  AUTH_TOKEN = 'auth:token',
  AUTH_REFRESH = 'auth:refresh',
  AUTH_ATTEMPTS = 'auth:attempts',
  
  // API responses
  API_RESPONSE = 'api:response',
  API_RATE_LIMIT = 'api:rate_limit',
  
  // Business data
  TENANT_CONFIG = 'tenant:config',
  SERVICE_DATA = 'service:data',
  RESOURCE_DATA = 'resource:data',
  BOOKING_DATA = 'booking:data',
  
  // System
  SYSTEM_CONFIG = 'system:config',
  SYSTEM_STATS = 'system:stats',
  SYSTEM_HEALTH = 'system:health',
  
  // Temporary data
  TEMP_DATA = 'temp:data',
  TEMP_TOKEN = 'temp:token',
  
  // Locks
  DISTRIBUTED_LOCK = 'lock:distributed',
  
  // Analytics
  ANALYTICS_DATA = 'analytics:data',
  ANALYTICS_EVENTS = 'analytics:events',
  
  // Availability and Inventory
  AVAILABILITY = 'availability',
  SLOTS = 'slots',
  CALENDAR = 'calendar',
  RESOURCE_AVAILABILITY = 'resource:availability',
}

/**
 * TTL presets for different types of data (in seconds)
 */
export enum CacheTTL {
  // Very short
  SECONDS_5 = 5,
  SECONDS_15 = 15,
  SECONDS_30 = 30,
  
  // Short
  MINUTE_1 = 60,
  MINUTE_5 = 300,
  MINUTE_15 = 900,
  MINUTE_30 = 1800,
  
  // Medium
  HOUR_1 = 3600,
  HOUR_6 = 21600,
  HOUR_12 = 43200,
  
  // Long
  DAY_1 = 86400,
  DAY_3 = 259200,
  WEEK_1 = 604800,
  
  // Permanent (1 year)
  PERMANENT = 31536000,
}

/**
 * Cache key generation options
 */
export interface CacheKeyOptions {
  namespace?: CacheNamespace | string;
  tenant?: string;
  user?: string;
  version?: string | number;
  environment?: string;
  separator?: string;
}

/**
 * Cache invalidation pattern options
 */
export interface InvalidationPattern {
  namespace?: CacheNamespace | string;
  tenant?: string;
  user?: string;
  prefix?: string;
  suffix?: string;
  wildcard?: boolean;
}

/**
 * Generate standardized cache key
 */
export function generateCacheKey(
  identifier: string,
  options: CacheKeyOptions = {}
): string {
  const {
    namespace,
    tenant,
    user,
    version = '1',
    environment = config.NODE_ENV,
    separator = ':',
  } = options;

  const keyPrefix = config.REDIS_KEY_PREFIX || 'ripipi';
  const parts: string[] = [keyPrefix];

  // Add environment if not production
  if (environment !== 'production') {
    parts.push(environment);
  }

  // Add namespace
  if (namespace) {
    parts.push(namespace);
  }

  // Add tenant if provided
  if (tenant) {
    parts.push(`tenant${separator}${tenant}`);
  }

  // Add user if provided
  if (user) {
    parts.push(`user${separator}${user}`);
  }

  // Add version
  parts.push(`v${version}`);

  // Add identifier
  parts.push(identifier);

  return parts.join(separator);
}

/**
 * Generate session cache key
 */
export function generateSessionKey(
  userId: string,
  sessionId?: string,
  tenantId?: string
): string {
  const identifier = sessionId ? `${userId}:${sessionId}` : userId;
  return generateCacheKey(identifier, {
    namespace: CacheNamespace.USER_SESSION,
    tenant: tenantId,
  });
}

/**
 * Generate user profile cache key
 */
export function generateUserProfileKey(
  userId: string,
  tenantId?: string
): string {
  return generateCacheKey(userId, {
    namespace: CacheNamespace.USER_PROFILE,
    tenant: tenantId,
  });
}

/**
 * Generate API response cache key
 */
export function generateApiResponseKey(
  method: string,
  path: string,
  queryHash?: string,
  tenantId?: string,
  userId?: string
): string {
  const identifier = queryHash 
    ? `${method.toLowerCase()}:${path}:${queryHash}`
    : `${method.toLowerCase()}:${path}`;
    
  return generateCacheKey(identifier, {
    namespace: CacheNamespace.API_RESPONSE,
    tenant: tenantId,
    user: userId,
  });
}

/**
 * Generate rate limit cache key
 */
export function generateRateLimitKey(
  identifier: string,
  type: 'ip' | 'user' | 'api_key' | 'endpoint' = 'ip',
  window?: string
): string {
  const keyIdentifier = window 
    ? `${type}:${identifier}:${window}`
    : `${type}:${identifier}`;
    
  return generateCacheKey(keyIdentifier, {
    namespace: CacheNamespace.API_RATE_LIMIT,
  });
}

/**
 * Generate distributed lock key
 */
export function generateLockKey(
  resource: string,
  operation?: string
): string {
  const identifier = operation ? `${resource}:${operation}` : resource;
  return generateCacheKey(identifier, {
    namespace: CacheNamespace.DISTRIBUTED_LOCK,
  });
}

/**
 * Generate tenant configuration cache key
 */
export function generateTenantConfigKey(
  tenantId: string,
  configType?: string
): string {
  const identifier = configType ? `${tenantId}:${configType}` : tenantId;
  return generateCacheKey(identifier, {
    namespace: CacheNamespace.TENANT_CONFIG,
  });
}

/**
 * Generate business data cache key
 */
export function generateBusinessDataKey(
  dataType: 'service' | 'resource' | 'booking',
  id: string,
  tenantId: string,
  subType?: string
): string {
  const namespace = {
    service: CacheNamespace.SERVICE_DATA,
    resource: CacheNamespace.RESOURCE_DATA,
    booking: CacheNamespace.BOOKING_DATA,
  }[dataType];

  const identifier = subType ? `${id}:${subType}` : id;
  
  return generateCacheKey(identifier, {
    namespace,
    tenant: tenantId,
  });
}

/**
 * Generate temporary data cache key
 */
export function generateTempDataKey(
  identifier: string,
  type: 'data' | 'token' = 'data'
): string {
  const namespace = type === 'token' 
    ? CacheNamespace.TEMP_TOKEN 
    : CacheNamespace.TEMP_DATA;
    
  return generateCacheKey(identifier, {
    namespace,
  });
}

/**
 * Generate analytics cache key
 */
export function generateAnalyticsKey(
  type: 'data' | 'events',
  identifier: string,
  tenantId?: string,
  timeWindow?: string
): string {
  const namespace = type === 'events'
    ? CacheNamespace.ANALYTICS_EVENTS
    : CacheNamespace.ANALYTICS_DATA;
    
  const keyIdentifier = timeWindow 
    ? `${identifier}:${timeWindow}`
    : identifier;
    
  return generateCacheKey(keyIdentifier, {
    namespace,
    tenant: tenantId,
  });
}

/**
 * Parse cache key to extract components
 */
export function parseCacheKey(key: string): {
  prefix: string;
  environment?: string;
  namespace?: string;
  tenant?: string;
  user?: string;
  version?: string;
  identifier: string;
} {
  const parts = key.split(':');
  
  if (parts.length < 2) {
    throw new Error(`Invalid cache key format: ${key}`);
  }

  let index = 0;
  const prefix = parts[index++];
  
  // Check for environment (non-production)
  let environment: string | undefined;
  if (parts[index] && !parts[index].startsWith('v') && 
      !Object.values(CacheNamespace).includes(parts[index] as CacheNamespace)) {
    environment = parts[index++];
  }

  // Check for namespace
  let namespace: string | undefined;
  if (parts[index] && Object.values(CacheNamespace).includes(parts[index] as CacheNamespace)) {
    namespace = parts[index++];
  }

  // Check for tenant
  let tenant: string | undefined;
  if (parts[index] && parts[index].startsWith('tenant:')) {
    tenant = parts[index++].replace('tenant:', '');
  }

  // Check for user
  let user: string | undefined;
  if (parts[index] && parts[index].startsWith('user:')) {
    user = parts[index++].replace('user:', '');
  }

  // Check for version
  let version: string | undefined;
  if (parts[index] && parts[index].startsWith('v')) {
    version = parts[index++].substring(1);
  }

  // Remaining parts are the identifier
  const identifier = parts.slice(index).join(':');

  return {
    prefix,
    environment,
    namespace,
    tenant,
    user,
    version,
    identifier,
  };
}

/**
 * Generate invalidation pattern for bulk deletion
 */
export function generateInvalidationPattern(
  pattern: InvalidationPattern
): string {
  const {
    namespace,
    tenant,
    user,
    prefix,
    suffix,
    wildcard = true,
  } = pattern;

  const keyPrefix = config.REDIS_KEY_PREFIX || 'ripipi';
  const parts: string[] = [keyPrefix];

  // Add environment if not production
  if (config.NODE_ENV !== 'production') {
    parts.push(config.NODE_ENV);
  }

  // Add namespace
  if (namespace) {
    parts.push(namespace);
  }

  // Add tenant if provided
  if (tenant) {
    parts.push(`tenant:${tenant}`);
  }

  // Add user if provided
  if (user) {
    parts.push(`user:${user}`);
  }

  // Add prefix if provided
  if (prefix) {
    parts.push(prefix);
  }

  // Add wildcard
  if (wildcard) {
    parts.push('*');
  }

  // Add suffix if provided
  if (suffix) {
    parts.push(suffix);
  }

  return parts.join(':');
}

/**
 * Get TTL for specific cache type
 */
export function getTTLForType(
  namespace: CacheNamespace,
  customTTL?: number
): number {
  if (customTTL !== undefined) {
    return customTTL;
  }

  // Default TTL based on namespace
  const ttlMap: Record<CacheNamespace, number> = {
    // User related - medium TTL
    [CacheNamespace.USER_SESSION]: CacheTTL.HOUR_12,
    [CacheNamespace.USER_PROFILE]: CacheTTL.HOUR_6,
    [CacheNamespace.USER_PERMISSIONS]: CacheTTL.HOUR_1,
    
    // Authentication - short to medium TTL
    [CacheNamespace.AUTH_TOKEN]: CacheTTL.HOUR_1,
    [CacheNamespace.AUTH_REFRESH]: CacheTTL.DAY_3,
    [CacheNamespace.AUTH_ATTEMPTS]: CacheTTL.MINUTE_15,
    
    // API responses - short TTL
    [CacheNamespace.API_RESPONSE]: CacheTTL.MINUTE_5,
    [CacheNamespace.API_RATE_LIMIT]: CacheTTL.MINUTE_1,
    
    // Business data - medium TTL
    [CacheNamespace.TENANT_CONFIG]: CacheTTL.HOUR_6,
    [CacheNamespace.SERVICE_DATA]: CacheTTL.HOUR_1,
    [CacheNamespace.RESOURCE_DATA]: CacheTTL.HOUR_1,
    [CacheNamespace.BOOKING_DATA]: CacheTTL.MINUTE_30,
    
    // System - long TTL
    [CacheNamespace.SYSTEM_CONFIG]: CacheTTL.DAY_1,
    [CacheNamespace.SYSTEM_STATS]: CacheTTL.MINUTE_5,
    [CacheNamespace.SYSTEM_HEALTH]: CacheTTL.MINUTE_1,
    
    // Temporary - very short TTL
    [CacheNamespace.TEMP_DATA]: CacheTTL.MINUTE_15,
    [CacheNamespace.TEMP_TOKEN]: CacheTTL.MINUTE_5,
    
    // Locks - very short TTL
    [CacheNamespace.DISTRIBUTED_LOCK]: CacheTTL.MINUTE_5,
    
    // Analytics - medium TTL
    [CacheNamespace.ANALYTICS_DATA]: CacheTTL.HOUR_1,
    [CacheNamespace.ANALYTICS_EVENTS]: CacheTTL.HOUR_6,
    
    // Availability and Inventory - short TTL for real-time data
    [CacheNamespace.AVAILABILITY]: CacheTTL.MINUTE_5,
    [CacheNamespace.SLOTS]: CacheTTL.MINUTE_5,
    [CacheNamespace.CALENDAR]: CacheTTL.MINUTE_10,
    [CacheNamespace.RESOURCE_AVAILABILITY]: CacheTTL.MINUTE_3,
  };

  return ttlMap[namespace] || CacheTTL.MINUTE_15;
}

/**
 * Validate cache key format
 */
export function validateCacheKey(key: string): boolean {
  try {
    const parts = key.split(':');
    
    // Must have at least prefix and identifier
    if (parts.length < 2) {
      return false;
    }

    // Check for valid characters (alphanumeric, underscore, hyphen, colon)
    const validKeyRegex = /^[a-zA-Z0-9_:-]+$/;
    if (!validKeyRegex.test(key)) {
      return false;
    }

    // Check length (Redis key limit is 512MB, but we use practical limit)
    if (key.length > 250) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitize key component
 */
export function sanitizeKeyComponent(component: string): string {
  // Remove invalid characters and limit length
  return component
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .substring(0, 50)
    .toLowerCase();
}

/**
 * Generate hash from object for cache key
 */
export function generateHashFromObject(obj: any): string {
  const str = JSON.stringify(obj, Object.keys(obj).sort());
  let hash = 0;
  
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return Math.abs(hash).toString(36);
}

/**
 * Cache key utilities
 */
export const CacheKeyUtils = {
  generate: generateCacheKey,
  generateSession: generateSessionKey,
  generateUserProfile: generateUserProfileKey,
  generateApiResponse: generateApiResponseKey,
  generateRateLimit: generateRateLimitKey,
  generateLock: generateLockKey,
  generateTenantConfig: generateTenantConfigKey,
  generateBusinessData: generateBusinessDataKey,
  generateTempData: generateTempDataKey,
  generateAnalytics: generateAnalyticsKey,
  parse: parseCacheKey,
  generatePattern: generateInvalidationPattern,
  getTTL: getTTLForType,
  validate: validateCacheKey,
  sanitize: sanitizeKeyComponent,
  hash: generateHashFromObject,
  
  // Availability and Inventory specific methods
  generateAvailability: (tenantId: string, resourceIds: string, startDate: Date, endDate: Date, duration: string) => {
    return generateCacheKey(
      `${resourceIds}:${startDate.toISOString()}:${endDate.toISOString()}:${duration}`,
      { namespace: CacheNamespace.AVAILABILITY, tenant: tenantId }
    );
  },
  
  generateSlots: (tenantId: string, resourceId: string, date: Date, granularity: number) => {
    return generateCacheKey(
      `${resourceId}:${date.toISOString().split('T')[0]}:${granularity}`,
      { namespace: CacheNamespace.SLOTS, tenant: tenantId }
    );
  },
  
  generateResourceAvailability: (tenantId: string, resourceId: string, startDate: Date, endDate: Date) => {
    return generateCacheKey(
      `${resourceId}:${startDate.toISOString()}:${endDate.toISOString()}`,
      { namespace: CacheNamespace.RESOURCE_AVAILABILITY, tenant: tenantId }
    );
  },
  
  generateApiResponse: (method: string, path: string, queryHash: string, tenantId?: string, userId?: string) => {
    return generateApiResponseKey(method, path, queryHash, tenantId, userId);
  }
};

export default CacheKeyUtils;