import { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { config } from '../config';
import { logger } from '../config/logger';
import { BaseError, isCustomError, isOperationalError, InternalServerError } from '../utils/errors';

/**
 * Error response format for API
 */
interface ErrorResponse {
  error: {
    message: string;
    code: string;
    statusCode: number;
    timestamp: string;
    correlationId?: string;
    details?: any;
    stack?: string;
  };
}

/**
 * Error metrics for monitoring
 */
interface ErrorMetrics {
  code: string;
  statusCode: number;
  count: number;
  lastOccurred: string;
  correlationId?: string;
}

/**
 * Error handler plugin options
 */
interface ErrorHandlerOptions {
  includeStackTrace?: boolean;
  enableMetrics?: boolean;
  customErrorCodes?: Record<string, { statusCode: number; message: string }>;
  sensitiveFields?: string[];
}

/**
 * In-memory error metrics storage (in production, use Redis or external service)
 */
const errorMetrics = new Map<string, ErrorMetrics>();

/**
 * Enhanced error handler plugin for Fastify
 */
async function errorHandlerPlugin(
  fastify: FastifyInstance,
  options: ErrorHandlerOptions = {}
): Promise<void> {
  const {
    includeStackTrace = config.NODE_ENV !== 'production',
    enableMetrics = config.ENABLE_METRICS,
    customErrorCodes = {},
    sensitiveFields = ['password', 'token', 'apiKey', 'secret']
  } = options;

  // Register error handler
  fastify.setErrorHandler(async (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const correlationId = getCorrelationId(request);
    const startTime = Date.now();

    try {
      // Sanitize request data for logging
      const sanitizedRequest = sanitizeRequestData(request, sensitiveFields);

      // Determine if this is a custom error or system error
      const processedError = processError(error, correlationId);

      // Log the error with appropriate level
      logError(processedError, sanitizedRequest, correlationId);

      // Record metrics if enabled
      if (enableMetrics) {
        recordErrorMetrics(processedError, correlationId);
      }

      // Send error response
      const errorResponse = createErrorResponse(processedError, correlationId, includeStackTrace);
      
      // Set appropriate headers
      setErrorHeaders(reply, processedError);

      const responseTime = Date.now() - startTime;
      
      // Log response time for error handling
      logger.debug({
        correlationId,
        responseTime,
        statusCode: processedError.statusCode,
      }, 'Error handler response time');

      await reply.status(processedError.statusCode).send(errorResponse);

    } catch (handlerError) {
      // If error handler itself fails, log and send basic error
      logger.error({
        err: handlerError,
        originalError: error,
        correlationId,
      }, 'Error handler failed');

      const fallbackResponse: ErrorResponse = {
        error: {
          message: 'Internal server error',
          code: 'ERR_HANDLER_FAILURE',
          statusCode: 500,
          timestamp: new Date().toISOString(),
          correlationId,
        },
      };

      if (!reply.sent) {
        await reply.status(500).send(fallbackResponse);
      }
    }
  });

  // Add not found handler
  fastify.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const correlationId = getCorrelationId(request);
    
    logger.warn({
      correlationId,
      method: request.method,
      url: request.url,
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    }, 'Resource not found');

    const errorResponse: ErrorResponse = {
      error: {
        message: `Route ${request.method} ${request.url} not found`,
        code: 'ERR_NOT_FOUND_ROUTE',
        statusCode: 404,
        timestamp: new Date().toISOString(),
        correlationId,
      },
    };

    await reply.status(404).send(errorResponse);
  });

  // Add metrics endpoint if enabled
  if (enableMetrics) {
    fastify.get('/metrics/errors', async (request: FastifyRequest, reply: FastifyReply) => {
      const metrics = Array.from(errorMetrics.values());
      return {
        timestamp: new Date().toISOString(),
        totalErrors: metrics.reduce((sum, metric) => sum + metric.count, 0),
        uniqueErrors: metrics.length,
        metrics: metrics.sort((a, b) => b.count - a.count),
      };
    });
  }
}

/**
 * Get correlation ID from request headers or generate one
 */
function getCorrelationId(request: FastifyRequest): string {
  return (request.headers['x-correlation-id'] as string) ||
         (request.headers['x-request-id'] as string) ||
         `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Sanitize request data to remove sensitive information
 */
function sanitizeRequestData(request: FastifyRequest, sensitiveFields: string[]): any {
  const sanitized = {
    method: request.method,
    url: request.url,
    params: { ...request.params },
    query: { ...request.query },
    headers: { ...request.headers },
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  };

  // Remove sensitive headers
  delete sanitized.headers.authorization;
  delete sanitized.headers.cookie;
  delete sanitized.headers['x-api-key'];

  // Remove sensitive fields from params and query
  sensitiveFields.forEach(field => {
    if (sanitized.params && sanitized.params[field]) {
      sanitized.params[field] = '[REDACTED]';
    }
    if (sanitized.query && sanitized.query[field]) {
      sanitized.query[field] = '[REDACTED]';
    }
  });

  return sanitized;
}

/**
 * Process error to ensure consistent format
 */
function processError(error: any, correlationId: string): BaseError {
  // If it's already a custom error, return as is
  if (isCustomError(error)) {
    return error;
  }

  // Handle Fastify validation errors
  if (error.validation) {
    const { ValidationError } = require('../utils/errors');
    return new ValidationError(
      'Request validation failed',
      undefined,
      error.validation.map((v: any) => ({
        field: v.instancePath || v.dataPath,
        message: v.message,
        value: v.data,
      })),
      correlationId
    );
  }

  // Handle Fastify errors
  if (error.statusCode) {
    const errorMap: Record<number, any> = {
      400: () => {
        const { ValidationError } = require('../utils/errors');
        return new ValidationError(error.message, undefined, undefined, correlationId);
      },
      401: () => {
        const { AuthenticationError } = require('../utils/errors');
        return new AuthenticationError(error.message, correlationId);
      },
      403: () => {
        const { AuthorizationError } = require('../utils/errors');
        return new AuthorizationError(error.message, undefined, undefined, correlationId);
      },
      404: () => {
        const { NotFoundError } = require('../utils/errors');
        return new NotFoundError(error.message, undefined, undefined, correlationId);
      },
      409: () => {
        const { ConflictError } = require('../utils/errors');
        return new ConflictError(error.message, undefined, undefined, correlationId);
      },
      429: () => {
        const { RateLimitError } = require('../utils/errors');
        return new RateLimitError(error.message, undefined, undefined, undefined, correlationId);
      },
    };

    const errorConstructor = errorMap[error.statusCode];
    if (errorConstructor) {
      return errorConstructor();
    }
  }

  // Handle database errors
  if (error.code && error.code.startsWith('23')) { // PostgreSQL constraint violations
    const { ConflictError, ValidationError } = require('../utils/errors');
    
    if (error.code === '23505') { // Unique violation
      return new ConflictError(
        'Resource already exists',
        'duplicate_key',
        undefined,
        correlationId,
        { dbError: error.code, constraint: error.constraint }
      );
    }
    
    if (error.code === '23503') { // Foreign key violation
      return new ValidationError(
        'Referenced resource does not exist',
        error.column,
        undefined,
        correlationId,
        { dbError: error.code, constraint: error.constraint }
      );
    }
    
    if (error.code === '23502') { // Not null violation
      return new ValidationError(
        'Required field is missing',
        error.column,
        undefined,
        correlationId,
        { dbError: error.code }
      );
    }
  }

  // Handle timeout errors
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
    const { TimeoutError } = require('../utils/errors');
    return new TimeoutError(
      'Operation timed out',
      undefined,
      undefined,
      correlationId,
      { originalError: error.code }
    );
  }

  // Default to internal server error
  return new InternalServerError(
    config.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    correlationId,
    {
      originalError: {
        name: error.name,
        message: error.message,
        code: error.code,
        stack: config.NODE_ENV !== 'production' ? error.stack : undefined,
      },
    }
  );
}

/**
 * Log error with appropriate level and details
 */
function logError(error: BaseError, request: any, correlationId: string): void {
  const logContext = {
    err: error,
    correlationId,
    request,
    errorCode: error.code,
    statusCode: error.statusCode,
    isOperational: error.isOperational,
  };

  if (error.statusCode >= 500) {
    logger.error(logContext, 'Server error occurred');
  } else if (error.statusCode >= 400) {
    logger.warn(logContext, 'Client error occurred');
  } else {
    logger.info(logContext, 'Error handled');
  }
}

/**
 * Record error metrics for monitoring
 */
function recordErrorMetrics(error: BaseError, correlationId: string): void {
  const key = `${error.code}_${error.statusCode}`;
  const existing = errorMetrics.get(key);

  if (existing) {
    existing.count++;
    existing.lastOccurred = new Date().toISOString();
    existing.correlationId = correlationId;
  } else {
    errorMetrics.set(key, {
      code: error.code,
      statusCode: error.statusCode,
      count: 1,
      lastOccurred: new Date().toISOString(),
      correlationId,
    });
  }

  // Cleanup old metrics (keep last 1000 entries)
  if (errorMetrics.size > 1000) {
    const entries = Array.from(errorMetrics.entries());
    entries.sort((a, b) => new Date(b[1].lastOccurred).getTime() - new Date(a[1].lastOccurred).getTime());
    
    errorMetrics.clear();
    entries.slice(0, 1000).forEach(([key, value]) => {
      errorMetrics.set(key, value);
    });
  }
}

/**
 * Create standardized error response
 */
function createErrorResponse(
  error: BaseError,
  correlationId: string,
  includeStackTrace: boolean
): ErrorResponse {
  const response: ErrorResponse = {
    error: {
      message: error.message,
      code: error.code,
      statusCode: error.statusCode,
      timestamp: error.timestamp,
      correlationId,
    },
  };

  // Add error details if it's a custom error with safe details
  if (isCustomError(error)) {
    const safeDetails = error.toSafeJSON(includeStackTrace);
    response.error.details = safeDetails;
  }

  // Include stack trace only in development or when explicitly requested
  if (includeStackTrace && error.stack) {
    response.error.stack = error.stack;
  }

  return response;
}

/**
 * Set appropriate response headers for errors
 */
function setErrorHeaders(reply: FastifyReply, error: BaseError): void {
  // Add CORS headers for error responses
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Correlation-ID');

  // Add retry-after header for rate limiting errors
  if (error.statusCode === 429) {
    const retryAfter = (error as any).retryAfter || 60;
    reply.header('Retry-After', retryAfter.toString());
  }

  // Add cache control for errors
  reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  reply.header('Pragma', 'no-cache');
  reply.header('Expires', '0');

  // Content type
  reply.header('Content-Type', 'application/json; charset=utf-8');
}

/**
 * Create error handler middleware with custom options
 */
export function createErrorHandler(options: ErrorHandlerOptions = {}) {
  return fastifyPlugin(errorHandlerPlugin, {
    name: 'error-handler',
    fastify: '4.x',
  });
}

/**
 * Default error handler plugin
 */
export default fastifyPlugin(errorHandlerPlugin, {
  name: 'error-handler',
  fastify: '4.x',
});

/**
 * Utility function to clear error metrics (useful for testing)
 */
export function clearErrorMetrics(): void {
  errorMetrics.clear();
}

/**
 * Get current error metrics (useful for monitoring)
 */
export function getErrorMetrics(): ErrorMetrics[] {
  return Array.from(errorMetrics.values());
}