/**
 * Problem Details for HTTP APIs (RFC 7807)
 * Standardized error response format
 */

import { FastifyReply } from 'fastify';

/**
 * Problem details object as per RFC 7807
 */
export interface ProblemDetail {
  /**
   * A URI reference that identifies the problem type
   */
  type?: string;
  
  /**
   * A short, human-readable summary of the problem type
   */
  title: string;
  
  /**
   * The HTTP status code
   */
  status: number;
  
  /**
   * A human-readable explanation specific to this occurrence
   */
  detail?: string;
  
  /**
   * A URI reference that identifies the specific occurrence
   */
  instance?: string;
  
  /**
   * Application-specific error code
   */
  code: string;
  
  /**
   * Human-readable message (similar to detail but required)
   */
  message: string;
  
  /**
   * Additional details about specific errors
   */
  details?: Array<{
    field?: string;
    reason: string;
    value?: any;
  }>;
  
  /**
   * Trace ID for debugging
   */
  traceId?: string;
  
  /**
   * Timestamp when the error occurred
   */
  timestamp?: string;
}

/**
 * Common problem types (URIs)
 */
export const ProblemTypes = {
  VALIDATION_ERROR: '/problems/validation-error',
  AUTHENTICATION_REQUIRED: '/problems/authentication-required',
  PERMISSION_DENIED: '/problems/permission-denied',
  NOT_FOUND: '/problems/not-found',
  CONFLICT: '/problems/conflict',
  RATE_LIMITED: '/problems/rate-limited',
  INTERNAL_ERROR: '/problems/internal-error',
  SERVICE_UNAVAILABLE: '/problems/service-unavailable',
  
  // Domain-specific problems
  TIMESLOT_SOLD_OUT: '/problems/timeslot-sold-out',
  DOUBLE_BOOKING: '/problems/double-booking',
  IDEMPOTENCY_CONFLICT: '/problems/idempotency-conflict',
  CANCEL_FORBIDDEN: '/problems/cancel-forbidden',
  PAYMENT_REQUIRED: '/problems/payment-required',
  PAYMENT_FAILED: '/problems/payment-failed',
} as const;

/**
 * Create a problem detail object
 */
export function createProblemDetail(
  status: number,
  code: string,
  title: string,
  options?: {
    type?: string;
    detail?: string;
    instance?: string;
    details?: Array<{ field?: string; reason: string; value?: any }>;
    traceId?: string;
  }
): ProblemDetail {
  return {
    type: options?.type,
    title,
    status,
    detail: options?.detail,
    instance: options?.instance,
    code,
    message: options?.detail || title,
    details: options?.details,
    traceId: options?.traceId,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Common problem detail factories
 */
export const Problems = {
  /**
   * 400 Bad Request - Validation Error
   */
  validationError(
    message: string,
    details?: Array<{ field?: string; reason: string; value?: any }>
  ): ProblemDetail {
    return createProblemDetail(
      400,
      'validation_error',
      'Validation Error',
      {
        type: ProblemTypes.VALIDATION_ERROR,
        detail: message,
        details,
      }
    );
  },

  /**
   * 401 Unauthorized - Authentication Required
   */
  authRequired(message = 'Authentication is required'): ProblemDetail {
    return createProblemDetail(
      401,
      'auth_required',
      'Authentication Required',
      {
        type: ProblemTypes.AUTHENTICATION_REQUIRED,
        detail: message,
      }
    );
  },

  /**
   * 403 Forbidden - Permission Denied
   */
  permissionDenied(message = 'You do not have permission to perform this action'): ProblemDetail {
    return createProblemDetail(
      403,
      'permission_denied',
      'Permission Denied',
      {
        type: ProblemTypes.PERMISSION_DENIED,
        detail: message,
      }
    );
  },

  /**
   * 404 Not Found
   */
  notFound(resource: string): ProblemDetail {
    return createProblemDetail(
      404,
      'not_found',
      'Resource Not Found',
      {
        type: ProblemTypes.NOT_FOUND,
        detail: `${resource} not found`,
      }
    );
  },

  /**
   * 409 Conflict
   */
  conflict(
    message: string,
    code: string = 'conflict',
    details?: Array<{ field?: string; reason: string }>
  ): ProblemDetail {
    return createProblemDetail(
      409,
      code,
      'Conflict',
      {
        type: ProblemTypes.CONFLICT,
        detail: message,
        details,
      }
    );
  },

  /**
   * 409 Conflict - Timeslot Sold Out
   */
  timeslotSoldOut(
    timeslotIds: number[],
    details?: Array<{ field?: string; reason: string }>
  ): ProblemDetail {
    return createProblemDetail(
      409,
      'timeslot_sold_out',
      'Timeslot No Longer Available',
      {
        type: ProblemTypes.TIMESLOT_SOLD_OUT,
        detail: 'Selected timeslot is no longer available',
        details: details || timeslotIds.map(id => ({
          field: `timeslot_ids[${id}]`,
          reason: 'no_capacity',
        })),
      }
    );
  },

  /**
   * 409 Conflict - Double Booking
   */
  doubleBooking(
    resourceId: number,
    startTime: string,
    endTime: string
  ): ProblemDetail {
    return createProblemDetail(
      409,
      'double_booking',
      'Double Booking Detected',
      {
        type: ProblemTypes.DOUBLE_BOOKING,
        detail: 'The requested time slot conflicts with an existing booking',
        details: [
          {
            field: 'resource_id',
            reason: 'already_booked',
            value: resourceId,
          },
          {
            field: 'time_range',
            reason: 'overlapping',
            value: `${startTime} - ${endTime}`,
          },
        ],
      }
    );
  },

  /**
   * 409 Conflict - Idempotency Conflict
   */
  idempotencyConflict(
    idempotencyKey: string,
    message = 'Idempotency key already used with different request'
  ): ProblemDetail {
    return createProblemDetail(
      409,
      'idempotency_conflict',
      'Idempotency Key Conflict',
      {
        type: ProblemTypes.IDEMPOTENCY_CONFLICT,
        detail: message,
        details: [
          {
            field: 'idempotency_key',
            reason: 'already_used',
            value: idempotencyKey,
          },
        ],
      }
    );
  },

  /**
   * 429 Too Many Requests - Rate Limited
   */
  rateLimited(
    limit: number,
    windowMs: number,
    retryAfter?: number
  ): ProblemDetail {
    return createProblemDetail(
      429,
      'rate_limited',
      'Too Many Requests',
      {
        type: ProblemTypes.RATE_LIMITED,
        detail: `Rate limit exceeded. Max ${limit} requests per ${windowMs / 1000} seconds`,
        details: [
          {
            field: 'retry_after',
            reason: `Wait ${retryAfter || 60} seconds before retrying`,
            value: retryAfter,
          },
        ],
      }
    );
  },

  /**
   * 500 Internal Server Error
   */
  internalError(
    message = 'An unexpected error occurred',
    traceId?: string
  ): ProblemDetail {
    return createProblemDetail(
      500,
      'internal_error',
      'Internal Server Error',
      {
        type: ProblemTypes.INTERNAL_ERROR,
        detail: message,
        traceId,
      }
    );
  },

  /**
   * 503 Service Unavailable
   */
  serviceUnavailable(
    message = 'Service temporarily unavailable',
    retryAfter?: number
  ): ProblemDetail {
    return createProblemDetail(
      503,
      'service_unavailable',
      'Service Unavailable',
      {
        type: ProblemTypes.SERVICE_UNAVAILABLE,
        detail: message,
        details: retryAfter
          ? [
              {
                field: 'retry_after',
                reason: `Service will be available in ${retryAfter} seconds`,
                value: retryAfter,
              },
            ]
          : undefined,
      }
    );
  },
};

/**
 * Send problem detail response
 */
export function sendProblemDetail(
  reply: FastifyReply,
  problem: ProblemDetail
): void {
  reply
    .code(problem.status)
    .header('Content-Type', 'application/problem+json')
    .send(problem);
}

/**
 * Convert error to problem detail
 */
export function errorToProblemDetail(
  error: any,
  traceId?: string
): ProblemDetail {
  // If already a problem detail, return as-is
  if (error.type && error.title && error.status) {
    return { ...error, traceId };
  }

  // Handle known error types
  if (error.statusCode === 400 || error.validation) {
    return Problems.validationError(
      error.message,
      error.validation || error.details
    );
  }

  if (error.statusCode === 401) {
    return Problems.authRequired(error.message);
  }

  if (error.statusCode === 403) {
    return Problems.permissionDenied(error.message);
  }

  if (error.statusCode === 404) {
    return Problems.notFound(error.message || 'Resource');
  }

  if (error.statusCode === 409) {
    return Problems.conflict(error.message, error.code, error.details);
  }

  if (error.statusCode === 429) {
    return Problems.rateLimited(
      error.limit || 100,
      error.windowMs || 60000,
      error.retryAfter
    );
  }

  if (error.statusCode === 503) {
    return Problems.serviceUnavailable(error.message, error.retryAfter);
  }

  // Default to internal error
  return Problems.internalError(
    process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred'
      : error.message,
    traceId
  );
}

/**
 * Problem detail error handler middleware
 */
export async function problemDetailErrorHandler(
  error: any,
  request: any,
  reply: FastifyReply
): Promise<void> {
  const traceId = request.id || request.headers['x-trace-id'];
  const problem = errorToProblemDetail(error, traceId);
  
  // Log the error
  if (problem.status >= 500) {
    request.log.error({
      err: error,
      problem,
      url: request.url,
      method: request.method,
    });
  } else if (problem.status >= 400) {
    request.log.warn({
      problem,
      url: request.url,
      method: request.method,
    });
  }

  sendProblemDetail(reply, problem);
}