import bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'crypto';
import { 
  PasswordPolicy, 
  AuthError, 
  UserRole, 
  Permission, 
  ROLE_PERMISSIONS 
} from '../types/auth.js';

/**
 * Default password policy configuration
 */
export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSymbols: true,
  disallowCommonPasswords: true,
  maxAge: 90 // 90 days
};

/**
 * Common weak passwords to disallow
 */
const COMMON_PASSWORDS = new Set([
  'password', 'password123', '123456', '123456789', 'qwerty',
  'abc123', 'password1', 'admin', 'letmein', 'welcome',
  '1234567890', 'qwerty123', 'password!', 'admin123',
  'root', 'toor', 'pass', 'test', 'guest', 'user'
]);

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string, saltRounds: number = 12): Promise<string> {
  try {
    return await bcrypt.hash(password, saltRounds);
  } catch (error) {
    throw new Error('Failed to hash password');
  }
}

/**
 * Verify a password against its hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch (error) {
    return false;
  }
}

/**
 * Generate a secure random token
 */
export function generateSecureToken(length: number = 32): string {
  return randomBytes(length).toString('hex');
}

/**
 * Hash a token for storage (e.g., refresh tokens)
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Validate password against policy
 */
export function validatePassword(
  password: string, 
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check minimum length
  if (password.length < policy.minLength) {
    errors.push(`Password must be at least ${policy.minLength} characters long`);
  }

  // Check uppercase requirement
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  // Check lowercase requirement
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  // Check numbers requirement
  if (policy.requireNumbers && !/\d/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  // Check symbols requirement
  if (policy.requireSymbols && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  // Check against common passwords
  if (policy.disallowCommonPasswords && COMMON_PASSWORDS.has(password.toLowerCase())) {
    errors.push('Password is too common and not allowed');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Calculate password strength score (0-100)
 */
export function calculatePasswordStrength(password: string): number {
  let score = 0;

  // Length bonus
  score += Math.min(password.length * 2, 20);

  // Character variety bonuses
  if (/[a-z]/.test(password)) score += 10;
  if (/[A-Z]/.test(password)) score += 10;
  if (/\d/.test(password)) score += 10;
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) score += 15;

  // Pattern penalties
  if (/(.)\1{2,}/.test(password)) score -= 10; // Repeated characters
  if (/123|abc|qwe/i.test(password)) score -= 10; // Sequential patterns

  // Common password penalty
  if (COMMON_PASSWORDS.has(password.toLowerCase())) score -= 30;

  // Entropy bonus for longer passwords
  if (password.length >= 12) score += 10;
  if (password.length >= 16) score += 10;

  return Math.max(0, Math.min(100, score));
}

/**
 * Get permissions for a user role
 */
export function getPermissionsForRole(role: UserRole): Permission[] {
  return ROLE_PERMISSIONS[role] || [];
}

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  const permissions = getPermissionsForRole(role);
  return permissions.includes(permission);
}

/**
 * Check if user has any of the required permissions
 */
export function hasAnyPermission(userPermissions: Permission[], requiredPermissions: Permission[]): boolean {
  return requiredPermissions.some(permission => userPermissions.includes(permission));
}

/**
 * Check if user has all required permissions
 */
export function hasAllPermissions(userPermissions: Permission[], requiredPermissions: Permission[]): boolean {
  return requiredPermissions.every(permission => userPermissions.includes(permission));
}

/**
 * Generate session ID
 */
export function generateSessionId(): string {
  return generateSecureToken(24);
}

/**
 * Calculate token expiration time
 */
export function calculateExpirationTime(expiresIn: string): Date {
  const now = new Date();
  const match = expiresIn.match(/^(\d+)([smhdw])$/);
  
  if (!match) {
    throw new Error(`Invalid expiration format: ${expiresIn}`);
  }

  const [, amount, unit] = match;
  const value = parseInt(amount, 10);

  switch (unit) {
    case 's': // seconds
      return new Date(now.getTime() + value * 1000);
    case 'm': // minutes
      return new Date(now.getTime() + value * 60 * 1000);
    case 'h': // hours
      return new Date(now.getTime() + value * 60 * 60 * 1000);
    case 'd': // days
      return new Date(now.getTime() + value * 24 * 60 * 60 * 1000);
    case 'w': // weeks
      return new Date(now.getTime() + value * 7 * 24 * 60 * 60 * 1000);
    default:
      throw new Error(`Unsupported time unit: ${unit}`);
  }
}

/**
 * Parse JWT expiration to seconds
 */
export function parseExpirationToSeconds(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([smhdw])$/);
  
  if (!match) {
    throw new Error(`Invalid expiration format: ${expiresIn}`);
  }

  const [, amount, unit] = match;
  const value = parseInt(amount, 10);

  switch (unit) {
    case 's': // seconds
      return value;
    case 'm': // minutes
      return value * 60;
    case 'h': // hours
      return value * 60 * 60;
    case 'd': // days
      return value * 24 * 60 * 60;
    case 'w': // weeks
      return value * 7 * 24 * 60 * 60;
    default:
      throw new Error(`Unsupported time unit: ${unit}`);
  }
}

/**
 * Sanitize user agent string
 */
export function sanitizeUserAgent(userAgent?: string): string | undefined {
  if (!userAgent) return undefined;
  
  // Remove any potentially harmful characters and limit length
  return userAgent
    .replace(/[<>'"]/g, '')
    .substring(0, 255);
}

/**
 * Extract IP address from request
 */
export function extractIpAddress(request: any): string | undefined {
  // Check various headers for real IP
  const headers = [
    'x-forwarded-for',
    'x-real-ip',
    'cf-connecting-ip',
    'x-client-ip',
    'x-forwarded',
    'forwarded-for',
    'forwarded'
  ];

  for (const header of headers) {
    const value = request.headers[header];
    if (value) {
      // Take the first IP if comma-separated
      const ip = Array.isArray(value) ? value[0] : value.split(',')[0];
      return ip.trim();
    }
  }

  // Fallback to connection remote address
  return request.socket?.remoteAddress || request.connection?.remoteAddress;
}

/**
 * Check if IP address is rate limited
 */
export function isIpRateLimited(
  ipAddress: string,
  attempts: Map<string, { count: number; resetTime: number }>,
  maxAttempts: number = 5,
  windowMs: number = 15 * 60 * 1000 // 15 minutes
): boolean {
  const now = Date.now();
  const attempt = attempts.get(ipAddress);

  if (!attempt) {
    return false;
  }

  // Reset if window has passed
  if (now > attempt.resetTime) {
    attempts.delete(ipAddress);
    return false;
  }

  return attempt.count >= maxAttempts;
}

/**
 * Record failed login attempt
 */
export function recordFailedAttempt(
  ipAddress: string,
  attempts: Map<string, { count: number; resetTime: number }>,
  windowMs: number = 15 * 60 * 1000 // 15 minutes
): void {
  const now = Date.now();
  const attempt = attempts.get(ipAddress);

  if (!attempt || now > attempt.resetTime) {
    // New or expired attempt
    attempts.set(ipAddress, {
      count: 1,
      resetTime: now + windowMs
    });
  } else {
    // Increment existing attempt
    attempt.count++;
  }
}

/**
 * Clear failed attempts for IP
 */
export function clearFailedAttempts(
  ipAddress: string,
  attempts: Map<string, { count: number; resetTime: number }>
): void {
  attempts.delete(ipAddress);
}

/**
 * Generate CSRF token
 */
export function generateCsrfToken(): string {
  return generateSecureToken(16);
}

/**
 * Validate CSRF token
 */
export function validateCsrfToken(provided: string, expected: string): boolean {
  if (!provided || !expected) {
    return false;
  }
  
  // Use constant-time comparison to prevent timing attacks
  return provided.length === expected.length && 
         createHash('sha256').update(provided).digest('hex') === 
         createHash('sha256').update(expected).digest('hex');
}

/**
 * Create secure cookie options
 */
export function getSecureCookieOptions(isProduction: boolean = false) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict' as const,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds
  };
}

/**
 * Mask sensitive data for logging
 */
export function maskSensitiveData(data: any): any {
  if (typeof data !== 'object' || data === null) {
    return data;
  }

  const masked = { ...data };
  const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth', 'credential'];

  for (const key in masked) {
    if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
      masked[key] = '***MASKED***';
    } else if (typeof masked[key] === 'object') {
      masked[key] = maskSensitiveData(masked[key]);
    }
  }

  return masked;
}