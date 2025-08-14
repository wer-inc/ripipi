import { 
  FastifyInstance, 
  FastifyRequest, 
  FastifyReply, 
  HookHandlerDoneFunction,
  onRequestHookHandler,
  preHandlerHookHandler,
  onSendHookHandler,
  onErrorHookHandler
} from 'fastify';
import { 
  TokenPayload, 
  UserRole, 
  Permission,
  AuthError 
} from '../types/auth.js';
import { 
  extractIpAddress,
  sanitizeUserAgent,
  maskSensitiveData 
} from '../utils/auth.js';

/**
 * Authentication hook options
 */
export interface AuthHookOptions {
  enableSecurityHeaders?: boolean;
  enableRequestLogging?: boolean;
  enableAuditLogging?: boolean;
  enableRateLimiting?: boolean;
  enableCSRFProtection?: boolean;
  trustedProxies?: string[];
  maxRequestSize?: number;
}

/**
 * Request tracking for security monitoring
 */
interface RequestTracking {
  startTime: number;
  clientIp?: string;
  userAgent?: string;
  userId?: string;
  tenantId?: string;
  path: string;
  method: string;
}

/**
 * Global request tracking store
 */
const activeRequests = new Map<string, RequestTracking>();

/**
 * Security headers to apply to all responses
 */
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0'
} as const;

/**
 * CSRF protection exempt paths (typically API endpoints)
 */
const CSRF_EXEMPT_PATHS = [
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/refresh',
  '/api/public',
  '/health',
  '/metrics'
];

/**
 * Sensitive endpoints that require enhanced logging
 */
const SENSITIVE_ENDPOINTS = [
  '/api/v1/auth',
  '/api/v1/admin',
  '/api/v1/users',
  '/api/v1/payments',
  '/api/v1/settings'
];

/**
 * Register authentication hooks with Fastify instance
 */
export function registerAuthHooks(
  fastify: FastifyInstance, 
  options: AuthHookOptions = {}
) {
  const {
    enableSecurityHeaders = true,
    enableRequestLogging = true,
    enableAuditLogging = true,
    enableRateLimiting = true,
    enableCSRFProtection = false, // Disabled by default for API-first apps
    trustedProxies = [],
    maxRequestSize = 1024 * 1024 // 1MB
  } = options;

  // onRequest hook - early request processing
  fastify.addHook('onRequest', createOnRequestHook({
    enableRequestLogging,
    enableRateLimiting,
    trustedProxies,
    maxRequestSize
  }));

  // preHandler hook - authentication and authorization
  fastify.addHook('preHandler', createPreHandlerHook({
    enableAuditLogging,
    enableCSRFProtection
  }));

  // onSend hook - response modification
  fastify.addHook('onSend', createOnSendHook({
    enableSecurityHeaders
  }));

  // onError hook - error handling and logging
  fastify.addHook('onError', createOnErrorHook({
    enableAuditLogging
  }));

  // Cleanup hook for graceful shutdown
  fastify.addHook('onClose', async () => {
    activeRequests.clear();
  });
}

/**
 * Create onRequest hook handler
 */
function createOnRequestHook(options: {
  enableRequestLogging: boolean;
  enableRateLimiting: boolean;
  trustedProxies: string[];
  maxRequestSize: number;
}): onRequestHookHandler {
  return async function onRequestHook(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const requestId = generateRequestId();
    const startTime = Date.now();
    const clientIp = extractIpAddress(request);
    const userAgent = sanitizeUserAgent(request.headers['user-agent']);

    // Store request tracking info
    activeRequests.set(requestId, {
      startTime,
      clientIp,
      userAgent,
      path: request.url,
      method: request.method
    });

    // Add request ID to request context
    (request as any).requestId = requestId;

    // Validate request size
    const contentLength = parseInt(request.headers['content-length'] || '0', 10);
    if (contentLength > options.maxRequestSize) {
      throw new Error(`Request too large: ${contentLength} bytes`);
    }

    // Validate trusted proxies
    if (options.trustedProxies.length > 0 && clientIp) {
      const isFromTrustedProxy = options.trustedProxies.some(proxy => 
        clientIp.startsWith(proxy)
      );
      if (!isFromTrustedProxy && request.headers['x-forwarded-for']) {
        request.server.log.warn('Untrusted proxy detected', {
          clientIp,
          forwardedFor: request.headers['x-forwarded-for']
        });
      }
    }

    // Log request if enabled
    if (options.enableRequestLogging) {
      const logLevel = isSensitiveEndpoint(request.url) ? 'info' : 'debug';
      request.server.log[logLevel]('Incoming request', {
        requestId,
        method: request.method,
        url: request.url,
        clientIp,
        userAgent: maskSensitiveData(userAgent),
        contentLength
      });
    }

    // Basic rate limiting check (if enabled)
    if (options.enableRateLimiting && clientIp) {
      await checkGlobalRateLimit(clientIp, reply);
    }
  };
}

/**
 * Create preHandler hook handler
 */
function createPreHandlerHook(options: {
  enableAuditLogging: boolean;
  enableCSRFProtection: boolean;
}): preHandlerHookHandler {
  return async function preHandlerHook(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const requestId = (request as any).requestId;
    const tracking = activeRequests.get(requestId);

    if (tracking && request.user) {
      // Update tracking with user info
      tracking.userId = request.user.id;
      tracking.tenantId = request.user.tenant_id;
    }

    // CSRF protection for state-changing requests
    if (options.enableCSRFProtection && isStateChangingRequest(request)) {
      await validateCSRFToken(request, reply);
    }

    // Audit logging for sensitive endpoints
    if (options.enableAuditLogging && isSensitiveEndpoint(request.url)) {
      request.server.log.info('Sensitive endpoint access', {
        requestId,
        userId: request.user?.id,
        tenantId: request.user?.tenant_id,
        role: request.user?.role,
        permissions: request.user?.permissions,
        method: request.method,
        url: request.url,
        clientIp: tracking?.clientIp,
        userAgent: maskSensitiveData(tracking?.userAgent)
      });
    }

    // Validate tenant context for tenant-scoped endpoints
    if (isTenantScopedEndpoint(request.url) && request.user) {
      await validateTenantContext(request, reply);
    }
  };
}

/**
 * Create onSend hook handler
 */
function createOnSendHook(options: {
  enableSecurityHeaders: boolean;
}): onSendHookHandler {
  return async function onSendHook(
    request: FastifyRequest,
    reply: FastifyReply,
    payload: string
  ): Promise<string> {
    const requestId = (request as any).requestId;
    const tracking = activeRequests.get(requestId);

    // Apply security headers
    if (options.enableSecurityHeaders) {
      applySecurityHeaders(reply, request);
    }

    // Add response timing header
    if (tracking) {
      const responseTime = Date.now() - tracking.startTime;
      reply.header('X-Response-Time', `${responseTime}ms`);
    }

    // Remove sensitive headers for non-admin users
    if (request.user?.role !== UserRole.SUPER_ADMIN) {
      reply.removeHeader('X-Powered-By');
      reply.removeHeader('Server');
    }

    // Add CORS headers for API endpoints
    if (request.url.startsWith('/api/')) {
      addCORSHeaders(reply, request);
    }

    return payload;
  };
}

/**
 * Create onError hook handler
 */
function createOnErrorHook(options: {
  enableAuditLogging: boolean;
}): onErrorHookHandler {
  return async function onErrorHook(
    request: FastifyRequest,
    reply: FastifyReply,
    error: Error
  ): Promise<void> {
    const requestId = (request as any).requestId;
    const tracking = activeRequests.get(requestId);

    // Enhanced error logging
    const errorLog = {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      request: {
        method: request.method,
        url: request.url,
        clientIp: tracking?.clientIp,
        userAgent: maskSensitiveData(tracking?.userAgent),
        userId: tracking?.userId,
        tenantId: tracking?.tenantId
      },
      timing: tracking ? Date.now() - tracking.startTime : 0
    };

    // Log different error types with appropriate levels
    if (isAuthError(error)) {
      request.server.log.warn('Authentication error', errorLog);
    } else if (isValidationError(error)) {
      request.server.log.info('Validation error', errorLog);
    } else if (isRateLimitError(error)) {
      request.server.log.warn('Rate limit error', errorLog);
    } else {
      request.server.log.error('Unhandled error', errorLog);
    }

    // Audit log for security-relevant errors
    if (options.enableAuditLogging && (isAuthError(error) || isSecurityError(error))) {
      request.server.log.warn('Security-related error', {
        ...errorLog,
        severity: 'HIGH',
        category: 'SECURITY'
      });
    }

    // Clean up tracking
    if (requestId) {
      activeRequests.delete(requestId);
    }

    // Standardize error responses for security
    sanitizeErrorResponse(reply, error);
  };
}

/**
 * Apply security headers to response
 */
function applySecurityHeaders(reply: FastifyReply, request: FastifyRequest): void {
  for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
    reply.header(header, value);
  }

  // Add request-specific headers
  reply.header('X-Request-ID', (request as any).requestId);
  
  // Conditional headers based on environment
  if (process.env.NODE_ENV === 'production') {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
}

/**
 * Add CORS headers for API endpoints
 */
function addCORSHeaders(reply: FastifyReply, request: FastifyRequest): void {
  // Configure CORS based on environment and request origin
  const origin = request.headers.origin;
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
  
  if (origin && allowedOrigins.includes(origin)) {
    reply.header('Access-Control-Allow-Origin', origin);
  }
  
  reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tenant-ID');
  reply.header('Access-Control-Allow-Credentials', 'true');
  reply.header('Access-Control-Max-Age', '86400'); // 24 hours
}

/**
 * Validate CSRF token for state-changing requests
 */
async function validateCSRFToken(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Skip CSRF for exempt paths
  if (CSRF_EXEMPT_PATHS.some(path => request.url.startsWith(path))) {
    return;
  }

  const csrfToken = request.headers['x-csrf-token'] as string;
  const sessionToken = request.cookies?.['csrf-token'];

  if (!csrfToken || !sessionToken || csrfToken !== sessionToken) {
    throw new Error('CSRF token validation failed');
  }
}

/**
 * Validate tenant context
 */
async function validateTenantContext(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.user?.tenant_id) {
    throw new Error('Tenant context required');
  }

  // Validate tenant is active
  const { db } = await import('../db/index.js');
  const result = await db.query(
    'SELECT is_active FROM tenants WHERE id = $1',
    [request.user.tenant_id]
  );

  if (result.rows.length === 0 || !result.rows[0].is_active) {
    throw new Error('Tenant is inactive or not found');
  }
}

/**
 * Global rate limiting check
 */
async function checkGlobalRateLimit(
  clientIp: string,
  reply: FastifyReply
): Promise<void> {
  // Implement basic rate limiting (in production, use Redis)
  const { rateLimitUtils } = await import('../middleware/auth.js');
  
  if (rateLimitUtils.isRateLimited(clientIp, 100, 60 * 1000)) { // 100 requests per minute
    throw new Error('Global rate limit exceeded');
  }
}

/**
 * Utility functions
 */

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function isSensitiveEndpoint(url: string): boolean {
  return SENSITIVE_ENDPOINTS.some(pattern => url.startsWith(pattern));
}

function isTenantScopedEndpoint(url: string): boolean {
  // Most API endpoints except public ones are tenant-scoped
  return url.startsWith('/api/v1/') && !url.startsWith('/api/v1/public/');
}

function isStateChangingRequest(request: FastifyRequest): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
}

function isAuthError(error: Error): boolean {
  return error.message.includes('authentication') || 
         error.message.includes('authorization') ||
         error.message.includes('token') ||
         Object.values(AuthError).some(authError => error.message.includes(authError));
}

function isValidationError(error: Error): boolean {
  return error.name === 'ValidationError' || 
         error.message.includes('validation') ||
         error.message.includes('invalid input');
}

function isRateLimitError(error: Error): boolean {
  return error.message.includes('rate limit') ||
         error.message.includes('too many requests');
}

function isSecurityError(error: Error): boolean {
  return error.message.includes('CSRF') ||
         error.message.includes('XSS') ||
         error.message.includes('injection') ||
         error.message.includes('unauthorized');
}

function sanitizeErrorResponse(reply: FastifyReply, error: Error): void {
  // Don't expose internal error details in production
  if (process.env.NODE_ENV === 'production') {
    if (error.message.includes('database') || error.message.includes('internal')) {
      reply.code(500).send({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'An internal error occurred'
      });
      return;
    }
  }

  // Allow the default error handler to process the error
}

/**
 * Export hook registration and utilities
 */
export {
  registerAuthHooks,
  SECURITY_HEADERS,
  SENSITIVE_ENDPOINTS,
  activeRequests
};

/**
 * Export individual hook creators for custom usage
 */
export {
  createOnRequestHook,
  createPreHandlerHook,
  createOnSendHook,
  createOnErrorHook
};