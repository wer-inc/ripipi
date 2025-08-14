/**
 * OWASP-compliant sanitization middleware for Fastify
 * Automated input sanitization to prevent XSS, SQL injection, and other attacks
 */

import { FastifyInstance, FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { logger } from '../config/logger';
import { config } from '../config';
import { 
  SanitizationResult, 
  SanitizationOptions,
  sanitizeComprehensive,
  sanitizeBatch,
  sanitizeUrl,
  sanitizeEmail,
  sanitizePhoneNumber,
  sanitizeJson,
  toSafeString,
  sanitizePath,
  createSanitizationError
} from '../utils/sanitizers';

/**
 * Sanitization middleware options
 */
interface SanitizationMiddlewareOptions {
  enableRequestBodySanitization?: boolean;
  enableQueryParameterSanitization?: boolean;
  enableHeaderSanitization?: boolean;
  enablePathParameterSanitization?: boolean;
  enableFileSanitization?: boolean;
  strictMode?: boolean;
  preserveOriginalData?: boolean;
  customRules?: Record<string, {
    fields: string[];
    sanitizer: (value: any, options?: SanitizationOptions) => SanitizationResult;
    options?: SanitizationOptions;
  }>;
  fieldMappings?: Record<string, {
    sanitizer: 'html' | 'url' | 'email' | 'phone' | 'path' | 'json' | 'comprehensive' | 'custom';
    options?: SanitizationOptions;
    customSanitizer?: (value: any) => SanitizationResult;
  }>;
  excludeFields?: string[];
  maxFieldLength?: number;
  logSanitization?: boolean;
  performanceMetrics?: boolean;
  rateLimiting?: {
    enabled: boolean;
    maxAttempts: number;
    windowMs: number;
  };
}

/**
 * Sanitization context
 */
interface SanitizationContext {
  request: FastifyRequest;
  correlationId: string;
  sanitizedData: Record<string, any>;
  warnings: string[];
  originalData: Record<string, any>;
}

/**
 * Sanitization metrics
 */
interface SanitizationMetrics {
  totalRequests: number;
  sanitizedFields: number;
  warningsGenerated: number;
  averageProcessingTime: number;
  errorCount: number;
  lastReset: number;
}

/**
 * Rate limiting for sanitization
 */
const sanitizationAttempts = new Map<string, { count: number; resetAt: number }>();

/**
 * Performance metrics
 */
let metrics: SanitizationMetrics = {
  totalRequests: 0,
  sanitizedFields: 0,
  warningsGenerated: 0,
  averageProcessingTime: 0,
  errorCount: 0,
  lastReset: Date.now()
};

/**
 * Default field mappings for common field names
 */
const DEFAULT_FIELD_MAPPINGS: Record<string, {
  sanitizer: 'html' | 'url' | 'email' | 'phone' | 'path' | 'json' | 'comprehensive';
  options?: SanitizationOptions;
}> = {
  // Email fields
  email: { sanitizer: 'email' },
  email_address: { sanitizer: 'email' },
  user_email: { sanitizer: 'email' },
  contact_email: { sanitizer: 'email' },

  // URL fields
  url: { sanitizer: 'url' },
  website: { sanitizer: 'url' },
  homepage: { sanitizer: 'url' },
  link: { sanitizer: 'url' },
  callback_url: { sanitizer: 'url' },
  redirect_url: { sanitizer: 'url' },

  // Phone fields
  phone: { sanitizer: 'phone' },
  phone_number: { sanitizer: 'phone' },
  telephone: { sanitizer: 'phone' },
  mobile: { sanitizer: 'phone' },
  contact_number: { sanitizer: 'phone' },

  // Path fields
  filename: { sanitizer: 'path' },
  file_path: { sanitizer: 'path' },
  upload_path: { sanitizer: 'path' },
  image_path: { sanitizer: 'path' },

  // HTML content fields
  content: { sanitizer: 'html', options: { allowBasicFormatting: true } },
  description: { sanitizer: 'html', options: { allowBasicFormatting: true } },
  notes: { sanitizer: 'html', options: { allowBasicFormatting: true } },
  comment: { sanitizer: 'html', options: { allowBasicFormatting: true } },
  message: { sanitizer: 'html', options: { allowBasicFormatting: true } },

  // JSON fields
  metadata: { sanitizer: 'json' },
  config: { sanitizer: 'json' },
  settings: { sanitizer: 'json' },
  options: { sanitizer: 'json' },
  properties: { sanitizer: 'json' }
};

/**
 * Enhanced sanitization middleware plugin
 */
async function sanitizationMiddlewarePlugin(
  fastify: FastifyInstance,
  options: SanitizationMiddlewareOptions = {}
): Promise<void> {
  const {
    enableRequestBodySanitization = true,
    enableQueryParameterSanitization = true,
    enableHeaderSanitization = false, // Headers are usually handled by reverse proxy
    enablePathParameterSanitization = true,
    enableFileSanitization = true,
    strictMode = config.NODE_ENV === 'production',
    preserveOriginalData = config.NODE_ENV !== 'production',
    customRules = {},
    fieldMappings = {},
    excludeFields = ['password', 'token', 'api_key', 'secret'],
    maxFieldLength = 10000,
    logSanitization = config.NODE_ENV !== 'production',
    performanceMetrics = true,
    rateLimiting = {
      enabled: true,
      maxAttempts: 200,
      windowMs: 60000 // 1 minute
    }
  } = options;

  // Combine default and custom field mappings
  const allFieldMappings = { ...DEFAULT_FIELD_MAPPINGS, ...fieldMappings };

  // Register sanitization decorators
  fastify.decorateRequest('sanitizedData', {});
  fastify.decorateRequest('sanitizationWarnings', []);
  fastify.decorateRequest('originalUnsanitizedData', {});
  fastify.decorate('sanitizeField', sanitizeField);
  fastify.decorate('getSanitizationMetrics', getSanitizationMetrics);

  // Pre-handler hook for sanitization
  fastify.addHook('preHandler', createSanitizationHandler({
    enableRequestBodySanitization,
    enableQueryParameterSanitization,
    enableHeaderSanitization,
    enablePathParameterSanitization,
    enableFileSanitization,
    strictMode,
    preserveOriginalData,
    customRules,
    fieldMappings: allFieldMappings,
    excludeFields,
    maxFieldLength,
    logSanitization,
    performanceMetrics,
    rateLimiting
  }));

  // Clean up rate limiting data periodically
  if (rateLimiting.enabled) {
    setInterval(cleanupRateLimitData, rateLimiting.windowMs);
  }

  // Add metrics endpoint
  if (performanceMetrics) {
    fastify.get('/metrics/sanitization', async (request, reply) => {
      return getSanitizationMetrics();
    });
  }
}

/**
 * Create sanitization handler with options
 */
function createSanitizationHandler(options: SanitizationMiddlewareOptions): preHandlerHookHandler {
  return async function sanitizationHandler(request: FastifyRequest, reply: FastifyReply) {
    const startTime = Date.now();
    const correlationId = getCorrelationId(request);

    try {
      // Rate limiting check
      if (options.rateLimiting?.enabled) {
        const rateLimitResult = checkRateLimit(request, options.rateLimiting);
        if (!rateLimitResult.allowed) {
          logger.warn({
            correlationId,
            ip: request.ip,
            retryAfter: rateLimitResult.retryAfter
          }, 'Sanitization rate limit exceeded');
          
          reply.code(429).header('Retry-After', rateLimitResult.retryAfter?.toString() || '60');
          throw new Error('Sanitization rate limit exceeded');
        }
      }

      const context: SanitizationContext = {
        request,
        correlationId,
        sanitizedData: {},
        warnings: [],
        originalData: {}
      };

      // Preserve original data if requested
      if (options.preserveOriginalData) {
        context.originalData = {
          body: deepClone(request.body),
          query: deepClone(request.query),
          params: deepClone(request.params),
          headers: deepClone(request.headers)
        };
      }

      // Sanitize different parts of the request
      await sanitizeRequestParts(context, options);

      // Store sanitized data in request
      request.sanitizedData = context.sanitizedData;
      request.sanitizationWarnings = context.warnings;
      
      if (options.preserveOriginalData) {
        request.originalUnsanitizedData = context.originalData;
      }

      // Override request data with sanitized versions
      if (context.sanitizedData.body) {
        (request as any).body = context.sanitizedData.body;
      }
      if (context.sanitizedData.query) {
        (request as any).query = context.sanitizedData.query;
      }
      if (context.sanitizedData.params) {
        (request as any).params = context.sanitizedData.params;
      }

      // Record metrics
      if (options.performanceMetrics) {
        recordSanitizationMetrics(startTime, context.warnings.length, true);
      }

      // Log sanitization activity
      if (options.logSanitization && context.warnings.length > 0) {
        logger.info({
          correlationId,
          warnings: context.warnings,
          sanitizedFields: Object.keys(context.sanitizedData).length,
          processingTime: Date.now() - startTime
        }, 'Request sanitization completed with warnings');
      }

    } catch (error) {
      // Record error metrics
      if (options.performanceMetrics) {
        recordSanitizationMetrics(startTime, 0, false);
      }

      logger.error({
        err: error,
        correlationId,
        method: request.method,
        url: request.url,
        processingTime: Date.now() - startTime
      }, 'Request sanitization failed');

      if (options.strictMode) {
        throw error;
      }

      // In non-strict mode, continue with original data but log warning
      logger.warn({
        correlationId,
        error: error.message
      }, 'Continuing with original data due to sanitization error');
    }
  };
}

/**
 * Sanitize different parts of the request
 */
async function sanitizeRequestParts(
  context: SanitizationContext,
  options: SanitizationMiddlewareOptions
): Promise<void> {
  const { request } = context;

  // Sanitize request body
  if (options.enableRequestBodySanitization && request.body) {
    const sanitizedBody = await sanitizeRequestData(
      request.body,
      'body',
      context,
      options
    );
    if (sanitizedBody !== request.body) {
      context.sanitizedData.body = sanitizedBody;
    }
  }

  // Sanitize query parameters
  if (options.enableQueryParameterSanitization && request.query) {
    const sanitizedQuery = await sanitizeRequestData(
      request.query,
      'query',
      context,
      options
    );
    if (sanitizedQuery !== request.query) {
      context.sanitizedData.query = sanitizedQuery;
    }
  }

  // Sanitize path parameters
  if (options.enablePathParameterSanitization && request.params) {
    const sanitizedParams = await sanitizeRequestData(
      request.params,
      'params',
      context,
      options
    );
    if (sanitizedParams !== request.params) {
      context.sanitizedData.params = sanitizedParams;
    }
  }

  // Sanitize headers (careful - only specific headers)
  if (options.enableHeaderSanitization && request.headers) {
    const headersToSanitize = [
      'user-agent',
      'referer',
      'x-forwarded-for',
      'x-real-ip'
    ];
    
    const sanitizedHeaders: Record<string, any> = {};
    let headersSanitized = false;

    for (const header of headersToSanitize) {
      if (request.headers[header]) {
        const result = sanitizeComprehensive(
          String(request.headers[header]),
          { maxLength: 500 }
        );
        
        if (result.modified) {
          sanitizedHeaders[header] = result.sanitized;
          context.warnings.push(...result.warnings.map(w => `Header ${header}: ${w}`));
          headersSanitized = true;
        }
      }
    }

    if (headersSanitized) {
      context.sanitizedData.headers = {
        ...request.headers,
        ...sanitizedHeaders
      };
    }
  }
}

/**
 * Sanitize request data object
 */
async function sanitizeRequestData(
  data: any,
  section: string,
  context: SanitizationContext,
  options: SanitizationMiddlewareOptions
): Promise<any> {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const sanitized = Array.isArray(data) ? [...data] : { ...data };
  const { fieldMappings = {}, customRules = {}, excludeFields = [], maxFieldLength } = options;

  // Apply custom rules first
  for (const [ruleName, rule] of Object.entries(customRules)) {
    for (const fieldPath of rule.fields) {
      const value = getNestedValue(sanitized, fieldPath);
      if (value !== undefined && !excludeFields.includes(fieldPath)) {
        try {
          const result = rule.sanitizer(value, rule.options);
          if (result.modified) {
            setNestedValue(sanitized, fieldPath, result.sanitized);
            context.warnings.push(...result.warnings.map(w => `${section}.${fieldPath}: ${w} (${ruleName})`));
          }
        } catch (error) {
          logger.error({
            err: error,
            field: fieldPath,
            rule: ruleName,
            correlationId: context.correlationId
          }, 'Custom sanitization rule failed');
          
          if (options.strictMode) {
            throw error;
          }
        }
      }
    }
  }

  // Apply field-specific sanitization
  await sanitizeObjectFields(sanitized, '', section, context, {
    fieldMappings,
    excludeFields,
    maxFieldLength
  });

  return sanitized;
}

/**
 * Recursively sanitize object fields
 */
async function sanitizeObjectFields(
  obj: any,
  currentPath: string,
  section: string,
  context: SanitizationContext,
  config: {
    fieldMappings: Record<string, any>;
    excludeFields: string[];
    maxFieldLength?: number;
  }
): Promise<void> {
  if (!obj || typeof obj !== 'object') {
    return;
  }

  for (const [key, value] of Object.entries(obj)) {
    const fieldPath = currentPath ? `${currentPath}.${key}` : key;
    
    // Skip excluded fields
    if (config.excludeFields.includes(key) || config.excludeFields.includes(fieldPath)) {
      continue;
    }

    if (typeof value === 'string') {
      // Apply field-specific sanitization
      const mapping = config.fieldMappings[key] || config.fieldMappings[fieldPath];
      let result: SanitizationResult;

      if (mapping) {
        result = await applySanitizationMapping(value, mapping);
      } else {
        // Default comprehensive sanitization
        result = sanitizeComprehensive(value, {
          maxLength: config.maxFieldLength,
          enableHtmlEscape: true,
          enableControlCharRemoval: true,
          enableWhitespaceNormalization: true,
          enableUnicodeNormalization: true
        });
      }

      if (result.modified) {
        obj[key] = result.sanitized;
        context.warnings.push(...result.warnings.map(w => `${section}.${fieldPath}: ${w}`));
      }

    } else if (Array.isArray(value)) {
      // Recursively sanitize array elements
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] === 'object') {
          await sanitizeObjectFields(
            value[i], 
            `${fieldPath}[${i}]`, 
            section, 
            context, 
            config
          );
        } else if (typeof value[i] === 'string') {
          const result = sanitizeComprehensive(value[i], {
            maxLength: config.maxFieldLength
          });
          if (result.modified) {
            value[i] = result.sanitized;
            context.warnings.push(...result.warnings.map(w => `${section}.${fieldPath}[${i}]: ${w}`));
          }
        }
      }

    } else if (typeof value === 'object' && value !== null) {
      // Recursively sanitize nested objects
      await sanitizeObjectFields(value, fieldPath, section, context, config);
    }
  }
}

/**
 * Apply sanitization mapping to a value
 */
async function applySanitizationMapping(
  value: any,
  mapping: {
    sanitizer: string;
    options?: SanitizationOptions;
    customSanitizer?: (value: any) => SanitizationResult;
  }
): Promise<SanitizationResult> {
  const { sanitizer, options = {}, customSanitizer } = mapping;

  switch (sanitizer) {
    case 'html':
      return sanitizeComprehensive(value, {
        ...options,
        enableHtmlEscape: true,
        enableStripHtml: false
      });

    case 'url':
      return sanitizeUrl(value, options);

    case 'email':
      return sanitizeEmail(value);

    case 'phone':
      return sanitizePhoneNumber(value);

    case 'path':
      return sanitizePath(value, options);

    case 'json':
      return sanitizeJson(value, options);

    case 'comprehensive':
      return sanitizeComprehensive(value, options);

    case 'custom':
      if (customSanitizer) {
        return customSanitizer(value);
      }
      throw new Error('Custom sanitizer function not provided');

    default:
      return sanitizeComprehensive(value, options);
  }
}

/**
 * Field sanitization function (decorator)
 */
function sanitizeField(
  value: any,
  sanitizer: 'html' | 'url' | 'email' | 'phone' | 'path' | 'json' | 'comprehensive',
  options: SanitizationOptions = {}
): SanitizationResult {
  const mapping = { sanitizer, options };
  return applySanitizationMapping(value, mapping);
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : undefined;
  }, obj);
}

/**
 * Set nested value in object using dot notation
 */
function setNestedValue(obj: any, path: string, value: any): void {
  const keys = path.split('.');
  const lastKey = keys.pop()!;
  
  const target = keys.reduce((current, key) => {
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    return current[key];
  }, obj);
  
  target[lastKey] = value;
}

/**
 * Deep clone object
 */
function deepClone(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (obj instanceof Date) {
    return new Date(obj.getTime());
  }
  
  if (Array.isArray(obj)) {
    return obj.map(deepClone);
  }
  
  const cloned: any = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  
  return cloned;
}

/**
 * Get correlation ID from request
 */
function getCorrelationId(request: FastifyRequest): string {
  return (request.headers['x-correlation-id'] as string) ||
         (request.headers['x-request-id'] as string) ||
         `san_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Check rate limiting for sanitization
 */
function checkRateLimit(
  request: FastifyRequest,
  rateLimitConfig: { maxAttempts: number; windowMs: number }
): { allowed: boolean; retryAfter?: number } {
  const identifier = request.ip || 'unknown';
  const now = Date.now();
  const windowStart = Math.floor(now / rateLimitConfig.windowMs) * rateLimitConfig.windowMs;
  const key = `${identifier}:${windowStart}`;

  let attempts = sanitizationAttempts.get(key);
  
  if (!attempts) {
    attempts = { count: 0, resetAt: windowStart + rateLimitConfig.windowMs };
    sanitizationAttempts.set(key, attempts);
  }

  attempts.count++;

  if (attempts.count > rateLimitConfig.maxAttempts) {
    const retryAfter = Math.ceil((attempts.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

/**
 * Record sanitization performance metrics
 */
function recordSanitizationMetrics(startTime: number, warningCount: number, success: boolean): void {
  const duration = Date.now() - startTime;
  
  metrics.totalRequests++;
  metrics.warningsGenerated += warningCount;
  
  if (success) {
    // Update rolling average
    const totalTime = (metrics.averageProcessingTime * (metrics.totalRequests - 1)) + duration;
    metrics.averageProcessingTime = totalTime / metrics.totalRequests;
  } else {
    metrics.errorCount++;
  }
}

/**
 * Get sanitization performance metrics
 */
function getSanitizationMetrics(): SanitizationMetrics {
  return { ...metrics };
}

/**
 * Clean up expired rate limit data
 */
function cleanupRateLimitData(): void {
  const now = Date.now();
  let cleanedCount = 0;

  for (const [key, data] of sanitizationAttempts.entries()) {
    if (data.resetAt <= now) {
      sanitizationAttempts.delete(key);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    logger.debug({ cleanedCount }, 'Cleaned up sanitization rate limit data');
  }
}

/**
 * Reset sanitization metrics
 */
function resetSanitizationMetrics(): void {
  metrics = {
    totalRequests: 0,
    sanitizedFields: 0,
    warningsGenerated: 0,
    averageProcessingTime: 0,
    errorCount: 0,
    lastReset: Date.now()
  };
}

/**
 * Create sanitization middleware with custom options
 */
export function createSanitizationMiddleware(options: SanitizationMiddlewareOptions = {}) {
  return fastifyPlugin(sanitizationMiddlewarePlugin, {
    name: 'sanitization-middleware',
    fastify: '4.x',
  });
}

/**
 * Default sanitization middleware plugin
 */
export default fastifyPlugin(sanitizationMiddlewarePlugin, {
  name: 'sanitization-middleware',
  fastify: '4.x',
});

/**
 * Utility functions for external use
 */
export {
  sanitizeField,
  getSanitizationMetrics,
  resetSanitizationMetrics,
  type SanitizationContext,
  type SanitizationMiddlewareOptions,
  type SanitizationMetrics
};

/**
 * Route-specific sanitization middleware
 */
export function sanitizeRoute(
  customFieldMappings?: Record<string, {
    sanitizer: 'html' | 'url' | 'email' | 'phone' | 'path' | 'json' | 'comprehensive';
    options?: SanitizationOptions;
  }>,
  options: Partial<SanitizationMiddlewareOptions> = {}
) {
  return async function routeSanitizationHandler(request: FastifyRequest, reply: FastifyReply) {
    const handler = createSanitizationHandler({
      ...options,
      fieldMappings: { ...DEFAULT_FIELD_MAPPINGS, ...customFieldMappings },
      preserveOriginalData: false, // Don't preserve for route-specific sanitization
    });

    await handler(request, reply);
  };
}

/**
 * TypeScript type augmentation for Fastify
 */
declare module 'fastify' {
  interface FastifyRequest {
    sanitizedData: Record<string, any>;
    sanitizationWarnings: string[];
    originalUnsanitizedData: Record<string, any>;
  }

  interface FastifyInstance {
    sanitizeField: (
      value: any,
      sanitizer: 'html' | 'url' | 'email' | 'phone' | 'path' | 'json' | 'comprehensive',
      options?: SanitizationOptions
    ) => SanitizationResult;
    getSanitizationMetrics: () => SanitizationMetrics;
  }
}