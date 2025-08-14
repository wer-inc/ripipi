/**
 * Custom error classes for the application
 * Provides structured error handling with consistent error codes and messages
 */

/**
 * Base error class that all custom errors extend
 */
export abstract class BaseError extends Error {
  public abstract readonly statusCode: number;
  public abstract readonly code: string;
  public abstract readonly isOperational: boolean;
  public readonly timestamp: string;
  public readonly correlationId?: string;
  public readonly context?: Record<string, any>;

  constructor(
    message: string,
    correlationId?: string,
    context?: Record<string, any>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date().toISOString();
    this.correlationId = correlationId;
    this.context = context;

    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Serializes the error for logging and API responses
   */
  public toJSON(): Record<string, any> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      timestamp: this.timestamp,
      correlationId: this.correlationId,
      context: this.context,
      stack: this.stack,
    };
  }

  /**
   * Returns a safe version of the error for API responses
   * Excludes sensitive information like stack traces in production
   */
  public toSafeJSON(includeStack = false): Record<string, any> {
    const safeError = {
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      timestamp: this.timestamp,
      correlationId: this.correlationId,
    };

    if (includeStack) {
      return { ...safeError, stack: this.stack };
    }

    return safeError;
  }
}

/**
 * Validation error - 400 Bad Request
 * Used when request data doesn't meet validation requirements
 */
export class ValidationError extends BaseError {
  public readonly statusCode = 400;
  public readonly code = 'ERR_VALIDATION_001';
  public readonly isOperational = true;
  public readonly field?: string;
  public readonly validationErrors?: Array<{
    field: string;
    message: string;
    value?: any;
  }>;

  constructor(
    message: string,
    field?: string,
    validationErrors?: Array<{ field: string; message: string; value?: any }>,
    correlationId?: string,
    context?: Record<string, any>
  ) {
    super(message, correlationId, context);
    this.field = field;
    this.validationErrors = validationErrors;
  }

  public toSafeJSON(includeStack = false): Record<string, any> {
    const safeError = super.toSafeJSON(includeStack);
    return {
      ...safeError,
      field: this.field,
      validationErrors: this.validationErrors,
    };
  }
}

/**
 * Authentication error - 401 Unauthorized
 * Used when authentication credentials are missing or invalid
 */
export class AuthenticationError extends BaseError {
  public readonly statusCode = 401;
  public readonly code = 'ERR_AUTH_001';
  public readonly isOperational = true;

  constructor(
    message = 'Authentication required',
    correlationId?: string,
    context?: Record<string, any>
  ) {
    super(message, correlationId, context);
  }
}

/**
 * Authorization error - 403 Forbidden
 * Used when user is authenticated but lacks required permissions
 */
export class AuthorizationError extends BaseError {
  public readonly statusCode = 403;
  public readonly code = 'ERR_AUTH_002';
  public readonly isOperational = true;
  public readonly requiredPermission?: string;
  public readonly userPermissions?: string[];

  constructor(
    message = 'Insufficient permissions',
    requiredPermission?: string,
    userPermissions?: string[],
    correlationId?: string,
    context?: Record<string, any>
  ) {
    super(message, correlationId, context);
    this.requiredPermission = requiredPermission;
    this.userPermissions = userPermissions;
  }

  public toSafeJSON(includeStack = false): Record<string, any> {
    const safeError = super.toSafeJSON(includeStack);
    return {
      ...safeError,
      requiredPermission: this.requiredPermission,
    };
  }
}

/**
 * Not found error - 404 Not Found
 * Used when requested resource doesn't exist
 */
export class NotFoundError extends BaseError {
  public readonly statusCode = 404;
  public readonly code = 'ERR_NOT_FOUND_001';
  public readonly isOperational = true;
  public readonly resourceType?: string;
  public readonly resourceId?: string;

  constructor(
    message = 'Resource not found',
    resourceType?: string,
    resourceId?: string,
    correlationId?: string,
    context?: Record<string, any>
  ) {
    super(message, correlationId, context);
    this.resourceType = resourceType;
    this.resourceId = resourceId;
  }

  public toSafeJSON(includeStack = false): Record<string, any> {
    const safeError = super.toSafeJSON(includeStack);
    return {
      ...safeError,
      resourceType: this.resourceType,
      resourceId: this.resourceId,
    };
  }
}

/**
 * Conflict error - 409 Conflict
 * Used when request conflicts with current resource state
 */
export class ConflictError extends BaseError {
  public readonly statusCode = 409;
  public readonly code = 'ERR_CONFLICT_001';
  public readonly isOperational = true;
  public readonly conflictType?: string;
  public readonly existingResource?: Record<string, any>;

  constructor(
    message = 'Resource conflict',
    conflictType?: string,
    existingResource?: Record<string, any>,
    correlationId?: string,
    context?: Record<string, any>
  ) {
    super(message, correlationId, context);
    this.conflictType = conflictType;
    this.existingResource = existingResource;
  }

  public toSafeJSON(includeStack = false): Record<string, any> {
    const safeError = super.toSafeJSON(includeStack);
    return {
      ...safeError,
      conflictType: this.conflictType,
    };
  }
}

/**
 * Rate limit error - 429 Too Many Requests
 * Used when request rate limits are exceeded
 */
export class RateLimitError extends BaseError {
  public readonly statusCode = 429;
  public readonly code = 'ERR_RATE_LIMIT_001';
  public readonly isOperational = true;
  public readonly limit?: number;
  public readonly windowMs?: number;
  public readonly retryAfter?: number;

  constructor(
    message = 'Rate limit exceeded',
    limit?: number,
    windowMs?: number,
    retryAfter?: number,
    correlationId?: string,
    context?: Record<string, any>
  ) {
    super(message, correlationId, context);
    this.limit = limit;
    this.windowMs = windowMs;
    this.retryAfter = retryAfter;
  }

  public toSafeJSON(includeStack = false): Record<string, any> {
    const safeError = super.toSafeJSON(includeStack);
    return {
      ...safeError,
      limit: this.limit,
      windowMs: this.windowMs,
      retryAfter: this.retryAfter,
    };
  }
}

/**
 * Business logic error - 422 Unprocessable Entity
 * Used when request is valid but violates business rules
 */
export class BusinessLogicError extends BaseError {
  public readonly statusCode = 422;
  public readonly code = 'ERR_BUSINESS_001';
  public readonly isOperational = true;
  public readonly businessRule?: string;

  constructor(
    message = 'Business rule violation',
    businessRule?: string,
    correlationId?: string,
    context?: Record<string, any>
  ) {
    super(message, correlationId, context);
    this.businessRule = businessRule;
  }

  public toSafeJSON(includeStack = false): Record<string, any> {
    const safeError = super.toSafeJSON(includeStack);
    return {
      ...safeError,
      businessRule: this.businessRule,
    };
  }
}

/**
 * External service error - 502 Bad Gateway
 * Used when external service calls fail
 */
export class ExternalServiceError extends BaseError {
  public readonly statusCode = 502;
  public readonly code = 'ERR_EXTERNAL_001';
  public readonly isOperational = true;
  public readonly serviceName?: string;
  public readonly serviceResponse?: any;

  constructor(
    message = 'External service error',
    serviceName?: string,
    serviceResponse?: any,
    correlationId?: string,
    context?: Record<string, any>
  ) {
    super(message, correlationId, context);
    this.serviceName = serviceName;
    this.serviceResponse = serviceResponse;
  }

  public toSafeJSON(includeStack = false): Record<string, any> {
    const safeError = super.toSafeJSON(includeStack);
    return {
      ...safeError,
      serviceName: this.serviceName,
    };
  }
}

/**
 * Database error - 500 Internal Server Error
 * Used when database operations fail
 */
export class DatabaseError extends BaseError {
  public readonly statusCode = 500;
  public readonly code = 'ERR_DATABASE_001';
  public readonly isOperational = false;
  public readonly query?: string;
  public readonly dbErrorCode?: string;

  constructor(
    message = 'Database operation failed',
    query?: string,
    dbErrorCode?: string,
    correlationId?: string,
    context?: Record<string, any>
  ) {
    super(message, correlationId, context);
    this.query = query;
    this.dbErrorCode = dbErrorCode;
  }

  public toSafeJSON(includeStack = false): Record<string, any> {
    const safeError = super.toSafeJSON(includeStack);
    return {
      ...safeError,
      dbErrorCode: this.dbErrorCode,
    };
  }
}

/**
 * Internal server error - 500 Internal Server Error
 * Used for unexpected errors that shouldn't be exposed to clients
 */
export class InternalServerError extends BaseError {
  public readonly statusCode = 500;
  public readonly code = 'ERR_INTERNAL_001';
  public readonly isOperational = false;

  constructor(
    message = 'Internal server error',
    correlationId?: string,
    context?: Record<string, any>
  ) {
    super(message, correlationId, context);
  }
}

/**
 * Service unavailable error - 503 Service Unavailable
 * Used when service is temporarily unavailable
 */
export class ServiceUnavailableError extends BaseError {
  public readonly statusCode = 503;
  public readonly code = 'ERR_SERVICE_001';
  public readonly isOperational = true;
  public readonly retryAfter?: number;

  constructor(
    message = 'Service temporarily unavailable',
    retryAfter?: number,
    correlationId?: string,
    context?: Record<string, any>
  ) {
    super(message, correlationId, context);
    this.retryAfter = retryAfter;
  }

  public toSafeJSON(includeStack = false): Record<string, any> {
    const safeError = super.toSafeJSON(includeStack);
    return {
      ...safeError,
      retryAfter: this.retryAfter,
    };
  }
}

/**
 * Timeout error - 408 Request Timeout
 * Used when operations exceed timeout limits
 */
export class TimeoutError extends BaseError {
  public readonly statusCode = 408;
  public readonly code = 'ERR_TIMEOUT_001';
  public readonly isOperational = true;
  public readonly timeoutMs?: number;
  public readonly operation?: string;

  constructor(
    message = 'Operation timeout',
    timeoutMs?: number,
    operation?: string,
    correlationId?: string,
    context?: Record<string, any>
  ) {
    super(message, correlationId, context);
    this.timeoutMs = timeoutMs;
    this.operation = operation;
  }

  public toSafeJSON(includeStack = false): Record<string, any> {
    const safeError = super.toSafeJSON(includeStack);
    return {
      ...safeError,
      timeoutMs: this.timeoutMs,
      operation: this.operation,
    };
  }
}

/**
 * Utility function to check if an error is a custom application error
 */
export function isCustomError(error: any): error is BaseError {
  return error instanceof BaseError;
}

/**
 * Utility function to check if an error is operational (safe to expose to clients)
 */
export function isOperationalError(error: any): boolean {
  if (isCustomError(error)) {
    return error.isOperational;
  }
  return false;
}

/**
 * Error factory functions for common scenarios
 */
export const ErrorFactory = {
  validation: (message: string, field?: string, correlationId?: string) =>
    new ValidationError(message, field, undefined, correlationId),

  validationWithDetails: (
    message: string,
    validationErrors: Array<{ field: string; message: string; value?: any }>,
    correlationId?: string
  ) => new ValidationError(message, undefined, validationErrors, correlationId),

  authentication: (message?: string, correlationId?: string) =>
    new AuthenticationError(message, correlationId),

  authorization: (
    message?: string,
    requiredPermission?: string,
    correlationId?: string
  ) => new AuthorizationError(message, requiredPermission, undefined, correlationId),

  notFound: (
    message?: string,
    resourceType?: string,
    resourceId?: string,
    correlationId?: string
  ) => new NotFoundError(message, resourceType, resourceId, correlationId),

  conflict: (
    message?: string,
    conflictType?: string,
    correlationId?: string
  ) => new ConflictError(message, conflictType, undefined, correlationId),

  rateLimit: (
    message?: string,
    limit?: number,
    windowMs?: number,
    retryAfter?: number,
    correlationId?: string
  ) => new RateLimitError(message, limit, windowMs, retryAfter, correlationId),

  businessLogic: (
    message?: string,
    businessRule?: string,
    correlationId?: string
  ) => new BusinessLogicError(message, businessRule, correlationId),

  externalService: (
    message?: string,
    serviceName?: string,
    correlationId?: string
  ) => new ExternalServiceError(message, serviceName, undefined, correlationId),

  database: (
    message?: string,
    query?: string,
    dbErrorCode?: string,
    correlationId?: string
  ) => new DatabaseError(message, query, dbErrorCode, correlationId),

  internal: (message?: string, correlationId?: string) =>
    new InternalServerError(message, correlationId),

  serviceUnavailable: (
    message?: string,
    retryAfter?: number,
    correlationId?: string
  ) => new ServiceUnavailableError(message, retryAfter, correlationId),

  timeout: (
    message?: string,
    timeoutMs?: number,
    operation?: string,
    correlationId?: string
  ) => new TimeoutError(message, timeoutMs, operation, correlationId),
};