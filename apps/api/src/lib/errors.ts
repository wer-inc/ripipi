import { FastifyReply } from 'fastify';

// RFC 7807 Problem Details for HTTP APIs
interface ProblemDetails {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  [key: string]: any;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: any;

  constructor(message: string, status: number, code: string, details?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// 共通エラータイプ
export const ErrorTypes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_REQUIRED: 'AUTH_REQUIRED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

// エラーレスポンスの標準化（RFC 7807準拠）
export function sendErrorResponse(
  reply: FastifyReply,
  error: ApiError | Error,
  requestId?: string
): FastifyReply {
  let problemDetails: ProblemDetails;

  if (error instanceof ApiError) {
    problemDetails = {
      type: `/errors/${error.code}`,
      title: error.message,
      status: error.status,
      detail: error.details?.message || error.message,
      instance: requestId ? `/requests/${requestId}` : undefined,
      ...error.details,
    };
  } else {
    // デフォルトエラー処理
    const isProduction = process.env.NODE_ENV === 'production';
    problemDetails = {
      type: '/errors/INTERNAL_ERROR',
      title: 'Internal Server Error',
      status: 500,
      detail: isProduction ? 'An unexpected error occurred' : error.message,
      instance: requestId ? `/requests/${requestId}` : undefined,
      stack: isProduction ? undefined : error.stack,
    };
  }

  return reply
    .code(problemDetails.status)
    .header('Content-Type', 'application/problem+json')
    .send(problemDetails);
}

// 一般的なエラー生成ヘルパー
export const Errors = {
  validation: (message: string, details?: any) =>
    new ApiError(message, 400, ErrorTypes.VALIDATION_ERROR, details),

  unauthorized: (message: string = 'Authentication required') =>
    new ApiError(message, 401, ErrorTypes.AUTHENTICATION_REQUIRED),

  invalidToken: (message: string = 'Invalid or expired token') =>
    new ApiError(message, 401, ErrorTypes.INVALID_TOKEN),

  forbidden: (message: string = 'Access denied') =>
    new ApiError(message, 403, ErrorTypes.FORBIDDEN),

  notFound: (resource: string) =>
    new ApiError(`${resource} not found`, 404, ErrorTypes.NOT_FOUND),

  conflict: (message: string, details?: any) =>
    new ApiError(message, 409, ErrorTypes.CONFLICT, details),

  rateLimit: (retryAfter: number) =>
    new ApiError(
      'Too many requests',
      429,
      ErrorTypes.RATE_LIMIT_EXCEEDED,
      { retryAfter }
    ),

  internal: (message: string = 'Internal server error') =>
    new ApiError(message, 500, ErrorTypes.INTERNAL_ERROR),

  unavailable: (message: string = 'Service temporarily unavailable') =>
    new ApiError(message, 503, ErrorTypes.SERVICE_UNAVAILABLE),
};