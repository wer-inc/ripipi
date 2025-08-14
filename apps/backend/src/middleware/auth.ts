import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { 
  TokenPayload, 
  TokenType, 
  AuthContext,
  UserRole,
  Permission,
  AuthError 
} from '../types/auth.js';
import { 
  extractIpAddress,
  sanitizeUserAgent,
  maskSensitiveData 
} from '../utils/auth.js';
import { config } from '../config/index.js';

/**
 * Authentication middleware options
 */
export interface AuthMiddlewareOptions {
  required?: boolean;
  allowCookie?: boolean;
  skipInvalidTokens?: boolean;
  rateLimitByIp?: boolean;
  maxAttemptsPerIp?: number;
  windowMs?: number;
}

/**
 * Rate limiting store for IP addresses
 */
const ipAttempts = new Map<string, { count: number; resetTime: number }>();

/**
 * Security headers to be set on all responses
 */
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'",
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0'
} as const;

/**
 * Enhanced JWT authentication middleware with security best practices
 */
export function createAuthMiddleware(options: AuthMiddlewareOptions = {}) {
  const {
    required = true,
    allowCookie = false,
    skipInvalidTokens = false,
    rateLimitByIp = true,
    maxAttemptsPerIp = 10,
    windowMs = 15 * 60 * 1000 // 15 minutes
  } = options;

  return async function authMiddleware(
    request: FastifyRequest, 
    reply: FastifyReply
  ): Promise<void> {
    const clientIp = extractIpAddress(request);
    const userAgent = sanitizeUserAgent(request.headers['user-agent']);
    
    try {
      // Apply security headers
      applySecurityHeaders(reply);

      // Rate limiting by IP if enabled
      if (rateLimitByIp && clientIp && isRateLimited(clientIp, maxAttemptsPerIp, windowMs)) {
        request.server.log.warn('IP rate limited', { 
          clientIp,
          userAgent,
          url: request.url 
        });
        
        return reply.code(429).send({
          error: 'TOO_MANY_REQUESTS',
          message: 'Too many authentication attempts. Please try again later.',
          retryAfter: Math.ceil(windowMs / 1000)
        });
      }

      // Extract and verify token
      const token = extractToken(request, allowCookie);
      
      if (!token) {
        if (required) {
          recordFailedAttempt(clientIp, 'MISSING_TOKEN');
          return reply.code(401).send({
            error: 'MISSING_TOKEN',
            message: 'Authentication token is required'
          });
        }
        // Optional auth - continue without user context
        return;
      }

      // Verify JWT token
      const payload = await verifyAuthToken(request.server, token);
      
      // Validate token payload
      validateTokenPayload(payload);
      
      // Set user context
      await setUserContext(request, payload);
      
      // Clear rate limit on successful auth
      if (clientIp) {
        clearRateLimit(clientIp);
      }

      request.server.log.debug('Authentication successful', {
        userId: payload.sub,
        tenantId: payload.tenant_id,
        role: payload.role,
        clientIp,
        userAgent: maskSensitiveData(userAgent)
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Record failed attempt for rate limiting
      if (clientIp) {
        recordFailedAttempt(clientIp, 'AUTH_FAILED');
      }

      request.server.log.error('Authentication failed', {
        error: errorMessage,
        clientIp,
        userAgent: maskSensitiveData(userAgent),
        url: request.url,
        method: request.method
      });

      // Handle specific error types
      if (errorMessage.includes('expired')) {
        return reply.code(401).send({
          error: 'TOKEN_EXPIRED',
          message: 'Authentication token has expired'
        });
      }

      if (errorMessage.includes('invalid') || errorMessage.includes('malformed')) {
        return reply.code(401).send({
          error: 'TOKEN_INVALID',
          message: 'Invalid authentication token'
        });
      }

      if (skipInvalidTokens && !required) {
        // Skip invalid tokens for optional auth
        return;
      }

      // Generic authentication error
      return reply.code(401).send({
        error: 'AUTHENTICATION_FAILED',
        message: 'Authentication failed'
      });
    }
  };
}

/**
 * Extract JWT token from request headers or cookies
 */
function extractToken(request: FastifyRequest, allowCookie: boolean): string | null {
  // Try Authorization header first (Bearer token)
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (token && isValidTokenFormat(token)) {
      return token;
    }
  }

  // Try cookie if allowed
  if (allowCookie && request.cookies) {
    const cookieToken = request.cookies['access_token'];
    if (cookieToken && isValidTokenFormat(cookieToken)) {
      return cookieToken;
    }
  }

  return null;
}

/**
 * Validate JWT token format (basic structure check)
 */
function isValidTokenFormat(token: string): boolean {
  // JWT should have 3 parts separated by dots
  const parts = token.split('.');
  if (parts.length !== 3) {
    return false;
  }

  // Each part should be base64url encoded
  try {
    for (const part of parts) {
      if (!part || !/^[A-Za-z0-9_-]+$/.test(part)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify JWT token using Fastify JWT plugin
 */
async function verifyAuthToken(
  fastify: FastifyInstance, 
  token: string
): Promise<TokenPayload> {
  try {
    const payload = await fastify.verifyToken(token, TokenType.ACCESS);
    return payload;
  } catch (error) {
    throw new Error(`Token verification failed: ${error.message}`);
  }
}

/**
 * Validate token payload structure and contents
 */
function validateTokenPayload(payload: TokenPayload): void {
  // Check required fields
  if (!payload.sub || !payload.tenant_id || !payload.role) {
    throw new Error('Invalid token payload: missing required fields');
  }

  // Validate token type
  if (payload.type !== TokenType.ACCESS) {
    throw new Error(`Invalid token type: expected ${TokenType.ACCESS}, got ${payload.type}`);
  }

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    throw new Error('Token has expired');
  }

  // Validate issue time (not too far in the future)
  if (payload.iat > now + 60) { // Allow 60 second clock skew
    throw new Error('Token issued in the future');
  }

  // Validate role
  if (!Object.values(UserRole).includes(payload.role)) {
    throw new Error(`Invalid user role: ${payload.role}`);
  }

  // Validate permissions array
  if (payload.permissions && !Array.isArray(payload.permissions)) {
    throw new Error('Invalid permissions format');
  }
}

/**
 * Set user context on the request object
 */
async function setUserContext(
  request: FastifyRequest, 
  payload: TokenPayload
): Promise<void> {
  // Set user information
  request.user = {
    id: payload.sub,
    email: '', // Will be populated by other services if needed
    role: payload.role,
    tenant_id: payload.tenant_id,
    permissions: payload.permissions || []
  };

  // Set session information
  request.session = {
    id: '', // Session ID from token or generated
    expires_at: new Date(payload.exp * 1000)
  };

  // Set token information
  request.token = {
    type: payload.type,
    expires_at: new Date(payload.exp * 1000)
  };
}

/**
 * Apply security headers to response
 */
function applySecurityHeaders(reply: FastifyReply): void {
  for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
    reply.header(header, value);
  }
}

/**
 * Check if IP is rate limited
 */
function isRateLimited(
  ipAddress: string, 
  maxAttempts: number, 
  windowMs: number
): boolean {
  const now = Date.now();
  const attempt = ipAttempts.get(ipAddress);

  if (!attempt) {
    return false;
  }

  // Reset if window has passed
  if (now > attempt.resetTime) {
    ipAttempts.delete(ipAddress);
    return false;
  }

  return attempt.count >= maxAttempts;
}

/**
 * Record failed authentication attempt
 */
function recordFailedAttempt(
  ipAddress: string | undefined, 
  reason: string,
  windowMs: number = 15 * 60 * 1000
): void {
  if (!ipAddress) return;

  const now = Date.now();
  const attempt = ipAttempts.get(ipAddress);

  if (!attempt || now > attempt.resetTime) {
    // New or expired attempt
    ipAttempts.set(ipAddress, {
      count: 1,
      resetTime: now + windowMs
    });
  } else {
    // Increment existing attempt
    attempt.count++;
  }
}

/**
 * Clear rate limit for IP address
 */
function clearRateLimit(ipAddress: string): void {
  ipAttempts.delete(ipAddress);
}

/**
 * Cleanup expired rate limit entries
 */
function cleanupRateLimits(): void {
  const now = Date.now();
  for (const [ip, attempt] of ipAttempts.entries()) {
    if (now > attempt.resetTime) {
      ipAttempts.delete(ip);
    }
  }
}

// Cleanup expired rate limits every 5 minutes
setInterval(cleanupRateLimits, 5 * 60 * 1000);

/**
 * Pre-configured authentication middleware variants
 */

/**
 * Required authentication - token must be present and valid
 */
export const requireAuth = createAuthMiddleware({
  required: true,
  allowCookie: false,
  skipInvalidTokens: false
});

/**
 * Optional authentication - continues without error if no token
 */
export const optionalAuth = createAuthMiddleware({
  required: false,
  allowCookie: false,
  skipInvalidTokens: true
});

/**
 * Cookie-based authentication for web applications
 */
export const cookieAuth = createAuthMiddleware({
  required: true,
  allowCookie: true,
  skipInvalidTokens: false
});

/**
 * Optional cookie-based authentication
 */
export const optionalCookieAuth = createAuthMiddleware({
  required: false,
  allowCookie: true,
  skipInvalidTokens: true
});

/**
 * Strict authentication with enhanced security
 */
export const strictAuth = createAuthMiddleware({
  required: true,
  allowCookie: false,
  skipInvalidTokens: false,
  rateLimitByIp: true,
  maxAttemptsPerIp: 5,
  windowMs: 30 * 60 * 1000 // 30 minutes
});

/**
 * Public endpoint middleware (no authentication required)
 */
export const publicEndpoint = async (
  request: FastifyRequest, 
  reply: FastifyReply
): Promise<void> => {
  // Apply security headers only
  applySecurityHeaders(reply);
  
  // Optionally extract user context if token is provided
  try {
    const token = extractToken(request, true);
    if (token) {
      const payload = await verifyAuthToken(request.server, token);
      await setUserContext(request, payload);
    }
  } catch {
    // Ignore authentication errors for public endpoints
  }
};

/**
 * Middleware to extract IP and user agent for logging
 */
export const securityLogger = async (
  request: FastifyRequest, 
  reply: FastifyReply
): Promise<void> => {
  const clientIp = extractIpAddress(request);
  const userAgent = sanitizeUserAgent(request.headers['user-agent']);
  
  // Add security context to request
  (request as any).security = {
    clientIp,
    userAgent,
    timestamp: new Date().toISOString()
  };

  // Log security-relevant requests
  if (isSensitiveEndpoint(request.url)) {
    request.server.log.info('Sensitive endpoint access', {
      url: request.url,
      method: request.method,
      clientIp,
      userAgent: maskSensitiveData(userAgent),
      userId: request.user?.id,
      tenantId: request.user?.tenant_id
    });
  }
};

/**
 * Check if endpoint is sensitive and should be logged
 */
function isSensitiveEndpoint(url: string): boolean {
  const sensitivePatterns = [
    '/auth/',
    '/admin/',
    '/users/',
    '/payments/',
    '/settings/',
    '/api/v1/auth',
    '/api/admin'
  ];

  return sensitivePatterns.some(pattern => url.includes(pattern));
}

/**
 * Export rate limiting utilities for external use
 */
export const rateLimitUtils = {
  isRateLimited,
  recordFailedAttempt,
  clearRateLimit,
  cleanupRateLimits
};