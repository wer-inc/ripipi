import fp from 'fastify-plugin';
import jwt, { FastifyJWTOptions } from '@fastify/jwt';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config/index.js';
import { 
  TokenPayload, 
  TokenType, 
  AuthContext,
  UserRole,
  Permission 
} from '../types/auth.js';
import { 
  parseExpirationToSeconds,
  calculateExpirationTime 
} from '../utils/auth.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    generateTokens: (payload: Omit<TokenPayload, 'iat' | 'exp' | 'type'>) => Promise<{
      accessToken: string;
      refreshToken: string;
      accessExpiresIn: number;
      refreshExpiresIn: number;
    }>;
    verifyToken: (token: string, type: TokenType) => Promise<TokenPayload>;
    requirePermissions: (permissions: Permission[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (roles: UserRole[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    user?: AuthContext['user'];
    session?: AuthContext['session'];
    token?: AuthContext['token'];
  }
}

/**
 * JWT plugin configuration
 */
const jwtOptions: FastifyJWTOptions = {
  secret: config.JWT_SECRET,
  sign: {
    algorithm: 'HS256',
    issuer: 'ripipi-backend',
    audience: 'ripipi-app'
  },
  verify: {
    algorithms: ['HS256'],
    issuer: 'ripipi-backend',
    audience: 'ripipi-app'
  }
};

/**
 * JWT authentication plugin for Fastify
 */
export default fp(async function jwtPlugin(fastify: FastifyInstance) {
  // Register JWT plugin
  await fastify.register(jwt, jwtOptions);

  /**
   * Generate access and refresh tokens
   */
  fastify.decorate('generateTokens', async function(
    payload: Omit<TokenPayload, 'iat' | 'exp' | 'type'>
  ) {
    const now = Math.floor(Date.now() / 1000);
    
    // Generate access token
    const accessExpiresIn = parseExpirationToSeconds(config.JWT_EXPIRES_IN);
    const accessTokenPayload: TokenPayload = {
      ...payload,
      iat: now,
      exp: now + accessExpiresIn,
      type: TokenType.ACCESS
    };

    // Generate refresh token
    const refreshExpiresIn = parseExpirationToSeconds(config.JWT_REFRESH_EXPIRES_IN);
    const refreshTokenPayload: TokenPayload = {
      ...payload,
      iat: now,
      exp: now + refreshExpiresIn,
      type: TokenType.REFRESH
    };

    const accessToken = this.jwt.sign(accessTokenPayload);
    const refreshToken = this.jwt.sign(refreshTokenPayload);

    return {
      accessToken,
      refreshToken,
      accessExpiresIn,
      refreshExpiresIn
    };
  });

  /**
   * Verify JWT token
   */
  fastify.decorate('verifyToken', async function(
    token: string,
    type: TokenType
  ): Promise<TokenPayload> {
    try {
      const payload = this.jwt.verify(token) as TokenPayload;
      
      // Verify token type matches expected
      if (payload.type !== type) {
        throw new Error(`Invalid token type. Expected ${type}, got ${payload.type}`);
      }

      // Check if token is expired
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp <= now) {
        throw new Error('Token has expired');
      }

      return payload;
    } catch (error) {
      throw new Error(`Token verification failed: ${error.message}`);
    }
  });

  /**
   * Authentication hook - verify access token
   */
  fastify.decorate('authenticate', async function(
    request: FastifyRequest, 
    reply: FastifyReply
  ) {
    try {
      // Extract token from Authorization header
      const authHeader = request.headers.authorization;
      if (!authHeader) {
        return reply.code(401).send({
          error: 'MISSING_TOKEN',
          message: 'Authorization header is required'
        });
      }

      const [scheme, token] = authHeader.split(' ');
      if (scheme !== 'Bearer' || !token) {
        return reply.code(401).send({
          error: 'INVALID_TOKEN_FORMAT',
          message: 'Authorization header must be in format: Bearer <token>'
        });
      }

      // Verify the access token
      const payload = await this.verifyToken(token, TokenType.ACCESS);

      // Set user context in request
      request.user = {
        id: payload.sub,
        email: '', // Will be populated by auth service if needed
        role: payload.role,
        tenant_id: payload.tenant_id,
        permissions: payload.permissions
      };

      request.token = {
        type: payload.type,
        expires_at: new Date(payload.exp * 1000)
      };

    } catch (error) {
      fastify.log.error('Authentication failed', { error: error.message });
      
      return reply.code(401).send({
        error: 'TOKEN_INVALID',
        message: 'Invalid or expired token'
      });
    }
  });

  /**
   * Authorization hook - require specific permissions
   */
  fastify.decorate('requirePermissions', function(permissions: Permission[]) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        return reply.code(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required'
        });
      }

      const userPermissions = request.user.permissions;
      const hasPermission = permissions.some(permission => 
        userPermissions.includes(permission)
      );

      if (!hasPermission) {
        return reply.code(403).send({
          error: 'INSUFFICIENT_PERMISSIONS',
          message: 'Insufficient permissions to access this resource',
          required_permissions: permissions,
          user_permissions: userPermissions
        });
      }
    };
  });

  /**
   * Authorization hook - require specific roles
   */
  fastify.decorate('requireRole', function(roles: UserRole[]) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        return reply.code(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required'
        });
      }

      const userRole = request.user.role;
      if (!roles.includes(userRole)) {
        return reply.code(403).send({
          error: 'INSUFFICIENT_ROLE',
          message: 'Insufficient role to access this resource',
          required_roles: roles,
          user_role: userRole
        });
      }
    };
  });

  /**
   * Helper to extract token from cookie (for refresh tokens)
   */
  function extractTokenFromCookie(request: FastifyRequest, cookieName: string): string | null {
    const cookies = request.cookies;
    return cookies[cookieName] || null;
  }

  /**
   * Helper to set secure cookie
   */
  function setSecureCookie(
    reply: FastifyReply,
    name: string,
    value: string,
    options: {
      maxAge?: number;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: 'strict' | 'lax' | 'none';
    } = {}
  ) {
    const cookieOptions = {
      maxAge: options.maxAge || parseExpirationToSeconds(config.JWT_REFRESH_EXPIRES_IN) * 1000,
      httpOnly: options.httpOnly !== false,
      secure: options.secure || config.NODE_ENV === 'production',
      sameSite: options.sameSite || 'strict' as const,
      path: '/'
    };

    reply.setCookie(name, value, cookieOptions);
  }

  /**
   * Helper to clear cookie
   */
  function clearCookie(reply: FastifyReply, name: string) {
    reply.clearCookie(name, { path: '/' });
  }

  // Add helper methods to fastify instance
  fastify.decorate('extractTokenFromCookie', extractTokenFromCookie);
  fastify.decorate('setSecureCookie', setSecureCookie);
  fastify.decorate('clearCookie', clearCookie);

}, {
  name: 'jwt-auth',
  dependencies: ['@fastify/jwt']
});

/**
 * Authentication middleware factory
 */
export const createAuthMiddleware = (options: {
  required?: boolean;
  permissions?: Permission[];
  roles?: UserRole[];
} = {}) => {
  const { required = true, permissions = [], roles = [] } = options;

  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Always try to authenticate if token is present
    const authHeader = request.headers.authorization;
    if (authHeader) {
      try {
        await request.server.authenticate(request, reply);
      } catch (error) {
        if (required) {
          throw error;
        }
        // If not required, continue without user context
      }
    } else if (required) {
      return reply.code(401).send({
        error: 'MISSING_TOKEN',
        message: 'Authentication required'
      });
    }

    // Check permissions if user is authenticated and permissions are specified
    if (request.user && permissions.length > 0) {
      const hasPermission = permissions.some(permission => 
        request.user!.permissions.includes(permission)
      );

      if (!hasPermission) {
        return reply.code(403).send({
          error: 'INSUFFICIENT_PERMISSIONS',
          message: 'Insufficient permissions to access this resource'
        });
      }
    }

    // Check roles if user is authenticated and roles are specified
    if (request.user && roles.length > 0) {
      if (!roles.includes(request.user.role)) {
        return reply.code(403).send({
          error: 'INSUFFICIENT_ROLE',
          message: 'Insufficient role to access this resource'
        });
      }
    }
  };
};

/**
 * Optional authentication middleware (doesn't require token)
 */
export const optionalAuth = createAuthMiddleware({ required: false });

/**
 * Required authentication middleware
 */
export const requireAuth = createAuthMiddleware({ required: true });

/**
 * Permission-based authorization middleware
 */
export const requirePermissions = (permissions: Permission[]) => 
  createAuthMiddleware({ required: true, permissions });

/**
 * Role-based authorization middleware
 */
export const requireRoles = (roles: UserRole[]) => 
  createAuthMiddleware({ required: true, roles });