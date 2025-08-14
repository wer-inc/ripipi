/**
 * OWASP-compliant validation middleware for Fastify
 * Integrates TypeBox schemas with custom validation logic and caching
 */

import { FastifyInstance, FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { FastifySchema } from '@fastify/type-provider-typebox';
import { TSchema, Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import fastifyPlugin from 'fastify-plugin';

import { ValidationError, ErrorFactory } from '../utils/errors';
import { logger } from '../config/logger';
import { config } from '../config';
import { 
  ValidationResult, 
  ValidationOptions, 
  validateMultiple,
  createValidationError 
} from '../utils/validators';

/**
 * Validation cache interface
 */
interface ValidationCache {
  key: string;
  result: ValidationResult;
  timestamp: number;
  expiresAt: number;
}

/**
 * Validation middleware options
 */
interface ValidationMiddlewareOptions {
  enableCache?: boolean;
  cacheTimeout?: number;
  strict?: boolean;
  sanitizeAfterValidation?: boolean;
  customValidators?: Record<string, (value: any) => ValidationResult>;
  onValidationError?: (error: ValidationError, request: FastifyRequest) => Promise<void>;
  performanceMetrics?: boolean;
  rateLimiting?: {
    enabled: boolean;
    maxAttempts: number;
    windowMs: number;
  };
}

/**
 * Validation context for custom validators
 */
interface ValidationContext {
  request: FastifyRequest;
  field: string;
  value: any;
  allValues: Record<string, any>;
  correlationId: string;
}

/**
 * In-memory validation cache (in production, use Redis)
 */
const validationCache = new Map<string, ValidationCache>();

/**
 * Rate limiting for validation attempts
 */
const validationAttempts = new Map<string, { count: number; resetAt: number }>();

/**
 * Performance metrics
 */
interface ValidationMetrics {
  totalValidations: number;
  cacheHits: number;
  cacheMisses: number;
  averageValidationTime: number;
  validationErrors: number;
  lastReset: number;
}

let metrics: ValidationMetrics = {
  totalValidations: 0,
  cacheHits: 0,
  cacheMisses: 0,
  averageValidationTime: 0,
  validationErrors: 0,
  lastReset: Date.now()
};

/**
 * Enhanced validation middleware plugin
 */
async function validationMiddlewarePlugin(
  fastify: FastifyInstance,
  options: ValidationMiddlewareOptions = {}
): Promise<void> {
  const {
    enableCache = config.NODE_ENV !== 'development',
    cacheTimeout = 60000, // 1 minute
    strict = true,
    sanitizeAfterValidation = true,
    customValidators = {},
    performanceMetrics = true,
    rateLimiting = {
      enabled: true,
      maxAttempts: 100,
      windowMs: 60000 // 1 minute
    }
  } = options;

  // Register validation decorators
  fastify.decorateRequest('validatedData', {});
  fastify.decorateRequest('validationWarnings', []);
  fastify.decorate('validateCustom', validateCustomField);
  fastify.decorate('getValidationMetrics', getValidationMetrics);

  // Pre-handler hook for validation
  fastify.addHook('preHandler', createValidationHandler({
    enableCache,
    cacheTimeout,
    strict,
    sanitizeAfterValidation,
    customValidators,
    onValidationError: options.onValidationError,
    performanceMetrics,
    rateLimiting
  }));

  // Clean up cache periodically
  if (enableCache) {
    setInterval(cleanupValidationCache, cacheTimeout);
  }

  // Clean up rate limiting data
  if (rateLimiting.enabled) {
    setInterval(cleanupRateLimitData, rateLimiting.windowMs);
  }
}

/**
 * Create validation handler with options
 */
function createValidationHandler(options: ValidationMiddlewareOptions): preHandlerHookHandler {
  return async function validationHandler(request: FastifyRequest, reply: FastifyReply) {
    const startTime = Date.now();
    const correlationId = getCorrelationId(request);
    
    try {
      // Rate limiting check
      if (options.rateLimiting?.enabled) {
        const rateLimitResult = checkRateLimit(request, options.rateLimiting);
        if (!rateLimitResult.allowed) {
          throw ErrorFactory.rateLimit(
            'Validation rate limit exceeded',
            rateLimitResult.limit,
            rateLimitResult.windowMs,
            rateLimitResult.retryAfter,
            correlationId
          );
        }
      }

      // Get route schema
      const schema = getRouteSchema(request);
      if (!schema) {
        return; // No validation required
      }

      // Validate request data
      const validationResult = await validateRequest(request, schema, {
        enableCache: options.enableCache,
        cacheTimeout: options.cacheTimeout,
        strict: options.strict,
        customValidators: options.customValidators,
        correlationId
      });

      // Handle validation result
      if (!validationResult.isValid) {
        const validationError = new ValidationError(
          'Request validation failed',
          undefined,
          validationResult.errors?.map(error => ({
            field: error.field || 'unknown',
            message: error.message,
            value: error.value
          })),
          correlationId
        );

        if (options.onValidationError) {
          await options.onValidationError(validationError, request);
        }

        throw validationError;
      }

      // Store validated and sanitized data
      request.validatedData = validationResult.sanitizedValue || {};
      request.validationWarnings = validationResult.warnings || [];

      // Record metrics
      if (options.performanceMetrics) {
        recordValidationMetrics(startTime, true);
      }

      logger.debug({
        correlationId,
        validationTime: Date.now() - startTime,
        warnings: request.validationWarnings
      }, 'Request validation completed');

    } catch (error) {
      // Record error metrics
      if (options.performanceMetrics) {
        recordValidationMetrics(startTime, false);
      }

      logger.error({
        err: error,
        correlationId,
        method: request.method,
        url: request.url,
        validationTime: Date.now() - startTime
      }, 'Request validation failed');

      throw error;
    }
  };
}

/**
 * Validate request against schema
 */
async function validateRequest(
  request: FastifyRequest,
  schema: FastifySchema,
  options: {
    enableCache?: boolean;
    cacheTimeout?: number;
    strict?: boolean;
    customValidators?: Record<string, (value: any) => ValidationResult>;
    correlationId: string;
  }
): Promise<ValidationResult & { warnings?: string[] }> {
  const { enableCache, cacheTimeout, strict, customValidators, correlationId } = options;
  
  // Collect all data to validate
  const dataToValidate = {
    ...(request.params as Record<string, any>),
    ...(request.query as Record<string, any>),
    ...(request.body as Record<string, any>)
  };

  // Generate cache key
  const cacheKey = enableCache ? generateCacheKey(request, dataToValidate) : null;

  // Check cache first
  if (cacheKey && enableCache) {
    const cached = validationCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      metrics.cacheHits++;
      return {
        ...cached.result,
        warnings: [`Validation result from cache (${new Date(cached.timestamp).toISOString()})`]
      };
    }
  }

  metrics.cacheMisses++;
  const warnings: string[] = [];

  // TypeBox schema validation
  const schemaValidationResult = await validateWithTypeBoxSchema(
    request,
    schema,
    dataToValidate,
    strict || false
  );

  if (!schemaValidationResult.isValid) {
    return schemaValidationResult;
  }

  // Custom validation
  let customValidationResult: ValidationResult = { isValid: true, errors: [] };
  if (customValidators && Object.keys(customValidators).length > 0) {
    customValidationResult = await validateWithCustomValidators(
      dataToValidate,
      customValidators,
      {
        request,
        correlationId
      }
    );
  }

  // Combine results
  const finalResult: ValidationResult = {
    isValid: schemaValidationResult.isValid && customValidationResult.isValid,
    errors: [
      ...(schemaValidationResult.errors || []),
      ...(customValidationResult.errors || [])
    ],
    sanitizedValue: {
      ...schemaValidationResult.sanitizedValue,
      ...customValidationResult.sanitizedValue
    }
  };

  // Cache successful results
  if (enableCache && cacheKey && finalResult.isValid) {
    validationCache.set(cacheKey, {
      key: cacheKey,
      result: finalResult,
      timestamp: Date.now(),
      expiresAt: Date.now() + (cacheTimeout || 60000)
    });

    warnings.push('Validation result cached for future requests');
  }

  return {
    ...finalResult,
    warnings
  };
}

/**
 * Validate using TypeBox schema
 */
async function validateWithTypeBoxSchema(
  request: FastifyRequest,
  schema: FastifySchema,
  data: Record<string, any>,
  strict: boolean
): Promise<ValidationResult> {
  const errors: Array<{ field: string; message: string; value?: any }> = [];
  const sanitizedData: Record<string, any> = {};

  // Validate params
  if (schema.params && request.params) {
    const result = validateSchemaSection(
      schema.params as TSchema,
      request.params,
      'params',
      strict
    );
    errors.push(...result.errors);
    Object.assign(sanitizedData, result.sanitizedValue);
  }

  // Validate query
  if (schema.querystring && request.query) {
    const result = validateSchemaSection(
      schema.querystring as TSchema,
      request.query,
      'query',
      strict
    );
    errors.push(...result.errors);
    Object.assign(sanitizedData, result.sanitizedValue);
  }

  // Validate body
  if (schema.body && request.body) {
    const result = validateSchemaSection(
      schema.body as TSchema,
      request.body,
      'body',
      strict
    );
    errors.push(...result.errors);
    Object.assign(sanitizedData, result.sanitizedValue);
  }

  // Validate headers if specified
  if (schema.headers && request.headers) {
    const result = validateSchemaSection(
      schema.headers as TSchema,
      request.headers,
      'headers',
      strict
    );
    errors.push(...result.errors);
    // Don't include headers in sanitized data for security
  }

  return {
    isValid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
    sanitizedValue: Object.keys(sanitizedData).length > 0 ? sanitizedData : undefined
  };
}

/**
 * Validate a specific schema section
 */
function validateSchemaSection(
  schema: TSchema,
  data: any,
  section: string,
  strict: boolean
): ValidationResult & { sanitizedValue: any } {
  const errors: Array<{ field: string; message: string; value?: any }> = [];
  
  try {
    // TypeBox validation
    const isValid = Value.Check(schema, data);
    
    if (!isValid) {
      const validationErrors = [...Value.Errors(schema, data)];
      
      for (const error of validationErrors) {
        errors.push({
          field: `${section}.${error.path}`,
          message: error.message,
          value: error.value
        });
      }
    }

    // Clean and convert data according to schema
    let sanitizedValue = data;
    
    if (isValid || !strict) {
      try {
        // Apply TypeBox transformations and defaults
        sanitizedValue = Value.Clean(schema, Value.Default(schema, data));
      } catch (cleanError) {
        logger.warn({
          err: cleanError,
          section,
          data
        }, 'Failed to clean/transform data');
      }
    }

    return {
      isValid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      sanitizedValue
    };

  } catch (error) {
    logger.error({
      err: error,
      section,
      schema: typeof schema,
      data: typeof data
    }, 'Schema validation failed');

    errors.push({
      field: section,
      message: 'Schema validation error',
      value: data
    });

    return {
      isValid: false,
      errors,
      sanitizedValue: data
    };
  }
}

/**
 * Validate using custom validators
 */
async function validateWithCustomValidators(
  data: Record<string, any>,
  validators: Record<string, (value: any) => ValidationResult>,
  context: { request: FastifyRequest; correlationId: string }
): Promise<ValidationResult> {
  const errors: Array<{ field: string; message: string; value?: any }> = [];
  const sanitizedData: Record<string, any> = {};

  for (const [field, validator] of Object.entries(validators)) {
    if (data.hasOwnProperty(field)) {
      try {
        const result = validator(data[field]);
        
        if (!result.isValid) {
          errors.push(...result.errors.map(error => ({
            field,
            message: error,
            value: data[field]
          })));
        } else if (result.sanitizedValue !== undefined) {
          sanitizedData[field] = result.sanitizedValue;
        }
      } catch (error) {
        logger.error({
          err: error,
          field,
          value: data[field],
          correlationId: context.correlationId
        }, 'Custom validator failed');

        errors.push({
          field,
          message: 'Custom validation failed',
          value: data[field]
        });
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
    sanitizedValue: Object.keys(sanitizedData).length > 0 ? sanitizedData : undefined
  };
}

/**
 * Custom field validation function (decorator)
 */
function validateCustomField(
  field: string,
  value: any,
  validator: (value: any) => ValidationResult
): ValidationResult {
  try {
    return validator(value);
  } catch (error) {
    logger.error({ err: error, field, value }, 'Custom field validation failed');
    return {
      isValid: false,
      errors: ['Custom validation failed']
    };
  }
}

/**
 * Get route schema from request
 */
function getRouteSchema(request: FastifyRequest): FastifySchema | null {
  // Access the route schema through Fastify's internal context
  const routeContext = (request as any).routeConfig || (request as any).context?.config;
  return routeContext?.schema || null;
}

/**
 * Generate cache key for validation result
 */
function generateCacheKey(request: FastifyRequest, data: Record<string, any>): string {
  const routeKey = `${request.method}:${request.routerPath}`;
  const dataHash = generateDataHash(data);
  return `validation:${routeKey}:${dataHash}`;
}

/**
 * Generate hash from data for cache key
 */
function generateDataHash(data: Record<string, any>): string {
  const sortedData = JSON.stringify(data, Object.keys(data).sort());
  let hash = 0;
  
  for (let i = 0; i < sortedData.length; i++) {
    const char = sortedData.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return Math.abs(hash).toString(36);
}

/**
 * Get correlation ID from request
 */
function getCorrelationId(request: FastifyRequest): string {
  return (request.headers['x-correlation-id'] as string) ||
         (request.headers['x-request-id'] as string) ||
         `val_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Check rate limiting for validation
 */
function checkRateLimit(
  request: FastifyRequest,
  rateLimitConfig: { maxAttempts: number; windowMs: number }
): { allowed: boolean; limit: number; windowMs: number; retryAfter?: number } {
  const identifier = request.ip || 'unknown';
  const now = Date.now();
  const windowStart = Math.floor(now / rateLimitConfig.windowMs) * rateLimitConfig.windowMs;
  const key = `${identifier}:${windowStart}`;

  let attempts = validationAttempts.get(key);
  
  if (!attempts) {
    attempts = { count: 0, resetAt: windowStart + rateLimitConfig.windowMs };
    validationAttempts.set(key, attempts);
  }

  attempts.count++;

  if (attempts.count > rateLimitConfig.maxAttempts) {
    const retryAfter = Math.ceil((attempts.resetAt - now) / 1000);
    return {
      allowed: false,
      limit: rateLimitConfig.maxAttempts,
      windowMs: rateLimitConfig.windowMs,
      retryAfter
    };
  }

  return {
    allowed: true,
    limit: rateLimitConfig.maxAttempts,
    windowMs: rateLimitConfig.windowMs
  };
}

/**
 * Record validation performance metrics
 */
function recordValidationMetrics(startTime: number, success: boolean): void {
  const duration = Date.now() - startTime;
  
  metrics.totalValidations++;
  
  if (success) {
    // Update rolling average
    const totalTime = (metrics.averageValidationTime * (metrics.totalValidations - 1)) + duration;
    metrics.averageValidationTime = totalTime / metrics.totalValidations;
  } else {
    metrics.validationErrors++;
  }
}

/**
 * Get validation performance metrics
 */
function getValidationMetrics(): ValidationMetrics {
  return { ...metrics };
}

/**
 * Clean up expired cache entries
 */
function cleanupValidationCache(): void {
  const now = Date.now();
  let cleanedCount = 0;

  for (const [key, cache] of validationCache.entries()) {
    if (cache.expiresAt <= now) {
      validationCache.delete(key);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    logger.debug({ cleanedCount }, 'Cleaned up validation cache');
  }
}

/**
 * Clean up expired rate limit data
 */
function cleanupRateLimitData(): void {
  const now = Date.now();
  let cleanedCount = 0;

  for (const [key, data] of validationAttempts.entries()) {
    if (data.resetAt <= now) {
      validationAttempts.delete(key);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    logger.debug({ cleanedCount }, 'Cleaned up rate limit data');
  }
}

/**
 * Reset validation metrics
 */
function resetValidationMetrics(): void {
  metrics = {
    totalValidations: 0,
    cacheHits: 0,
    cacheMisses: 0,
    averageValidationTime: 0,
    validationErrors: 0,
    lastReset: Date.now()
  };
}

/**
 * Create validation middleware with custom options
 */
export function createValidationMiddleware(options: ValidationMiddlewareOptions = {}) {
  return fastifyPlugin(validationMiddlewarePlugin, {
    name: 'validation-middleware',
    fastify: '4.x',
  });
}

/**
 * Default validation middleware plugin
 */
export default fastifyPlugin(validationMiddlewarePlugin, {
  name: 'validation-middleware',
  fastify: '4.x',
});

/**
 * Utility functions for external use
 */
export {
  validateCustomField,
  getValidationMetrics,
  resetValidationMetrics,
  cleanupValidationCache,
  type ValidationContext,
  type ValidationMiddlewareOptions,
  type ValidationMetrics
};

/**
 * Validation middleware for specific routes
 */
export function validateRoute(
  customValidators?: Record<string, (value: any) => ValidationResult>,
  options: Partial<ValidationMiddlewareOptions> = {}
) {
  return async function routeValidationHandler(request: FastifyRequest, reply: FastifyReply) {
    const handler = createValidationHandler({
      ...options,
      customValidators,
      enableCache: options.enableCache ?? false, // Disable cache for route-specific validation
    });

    await handler(request, reply);
  };
}

/**
 * TypeScript type augmentation for Fastify
 */
declare module 'fastify' {
  interface FastifyRequest {
    validatedData: Record<string, any>;
    validationWarnings: string[];
  }

  interface FastifyInstance {
    validateCustom: (
      field: string,
      value: any,
      validator: (value: any) => ValidationResult
    ) => ValidationResult;
    getValidationMetrics: () => ValidationMetrics;
  }
}