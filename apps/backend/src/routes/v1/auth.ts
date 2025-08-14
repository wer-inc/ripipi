import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { 
  LoginRequestSchema,
  LoginResponseSchema,
  RefreshTokenRequestSchema,
  RefreshTokenResponseSchema,
  LogoutRequestSchema,
  CurrentUserResponseSchema,
  AuthError
} from '../../types/auth.js';
import { AuthService } from '../../services/auth.service.js';
import { extractIpAddress, sanitizeUserAgent } from '../../utils/auth.js';

/**
 * Authentication routes plugin
 */
const authRoutes: FastifyPluginAsync = async function (fastify: FastifyInstance) {
  // Initialize auth service
  const authService = new AuthService({ 
    fastify,
    redis: fastify.redis // Assuming Redis plugin is registered
  });

  /**
   * POST /auth/login
   * Authenticate user and return tokens
   */
  fastify.post('/login', {
    schema: {
      description: 'Authenticate user with email and password',
      tags: ['Authentication'],
      body: LoginRequestSchema,
      response: {
        200: LoginResponseSchema,
        400: Type.Object({
          error: Type.String(),
          message: Type.String(),
          details: Type.Optional(Type.Array(Type.String()))
        }),
        401: Type.Object({
          error: Type.String(),
          message: Type.String()
        }),
        429: Type.Object({
          error: Type.String(),
          message: Type.String(),
          retryAfter: Type.Optional(Type.Number())
        })
      }
    }
  }, async (request: FastifyRequest<{ Body: typeof LoginRequestSchema }>, reply: FastifyReply) => {
    try {
      const clientIp = extractIpAddress(request);
      const userAgent = sanitizeUserAgent(request.headers['user-agent']);

      // Perform login
      const loginResponse = await authService.login(request.body, clientIp, userAgent);

      // Set refresh token as httpOnly cookie
      reply.setCookie('refresh_token', loginResponse.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/api/v1/auth'
      });

      // Remove refresh token from response body for security
      const { refresh_token, ...responseBody } = loginResponse;

      return reply.code(200).send({
        ...responseBody,
        message: 'Login successful'
      });

    } catch (error) {
      request.log.error('Login error', { 
        email: request.body.email,
        error: error.message,
        ip: extractIpAddress(request)
      });

      // Map authentication errors to appropriate HTTP codes
      switch (error.message) {
        case AuthError.INVALID_CREDENTIALS:
          return reply.code(401).send({
            error: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password'
          });

        case AuthError.ACCOUNT_LOCKED:
          return reply.code(401).send({
            error: 'ACCOUNT_LOCKED',
            message: 'Account is temporarily locked due to too many failed attempts'
          });

        case AuthError.ACCOUNT_DISABLED:
          return reply.code(401).send({
            error: 'ACCOUNT_DISABLED',
            message: 'Account is disabled. Please contact support'
          });

        case AuthError.TENANT_NOT_FOUND:
          return reply.code(400).send({
            error: 'TENANT_NOT_FOUND',
            message: 'Invalid tenant'
          });

        default:
          return reply.code(500).send({
            error: 'INTERNAL_SERVER_ERROR',
            message: 'An unexpected error occurred'
          });
      }
    }
  });

  /**
   * POST /auth/refresh
   * Refresh access token using refresh token
   */
  fastify.post('/refresh', {
    schema: {
      description: 'Refresh access token using refresh token',
      tags: ['Authentication'],
      body: Type.Optional(RefreshTokenRequestSchema),
      response: {
        200: RefreshTokenResponseSchema,
        401: Type.Object({
          error: Type.String(),
          message: Type.String()
        })
      }
    }
  }, async (request: FastifyRequest<{ Body?: typeof RefreshTokenRequestSchema }>, reply: FastifyReply) => {
    try {
      // Try to get refresh token from body, then from cookie
      let refreshToken = request.body?.refresh_token;
      
      if (!refreshToken) {
        refreshToken = request.cookies.refresh_token;
      }

      if (!refreshToken) {
        return reply.code(401).send({
          error: 'MISSING_REFRESH_TOKEN',
          message: 'Refresh token is required'
        });
      }

      // Refresh the token
      const refreshResponse = await authService.refreshToken({ refresh_token: refreshToken });

      // Update refresh token cookie
      reply.setCookie('refresh_token', refreshResponse.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/api/v1/auth'
      });

      // Remove refresh token from response body
      const { refresh_token, ...responseBody } = refreshResponse;

      return reply.code(200).send(responseBody);

    } catch (error) {
      request.log.error('Token refresh error', { error: error.message });

      return reply.code(401).send({
        error: 'INVALID_REFRESH_TOKEN',
        message: 'Invalid or expired refresh token'
      });
    }
  });

  /**
   * POST /auth/logout
   * Logout user and invalidate tokens
   */
  fastify.post('/logout', {
    preHandler: [fastify.authenticate],
    schema: {
      description: 'Logout user and invalidate tokens',
      tags: ['Authentication'],
      body: Type.Optional(LogoutRequestSchema),
      response: {
        200: Type.Object({
          message: Type.String()
        }),
        401: Type.Object({
          error: Type.String(),
          message: Type.String()
        })
      }
    }
  }, async (request: FastifyRequest<{ Body?: typeof LogoutRequestSchema }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      
      // Get refresh token from body or cookie
      let refreshToken = request.body?.refresh_token;
      if (!refreshToken) {
        refreshToken = request.cookies.refresh_token;
      }

      const logoutRequest = {
        refresh_token: refreshToken,
        all_devices: request.body?.all_devices || false
      };

      // Perform logout
      await authService.logout(logoutRequest, user.id, user.tenant_id);

      // Clear refresh token cookie
      reply.clearCookie('refresh_token', { path: '/api/v1/auth' });

      return reply.code(200).send({
        message: 'Logout successful'
      });

    } catch (error) {
      request.log.error('Logout error', { 
        userId: request.user?.id,
        error: error.message 
      });

      return reply.code(500).send({
        error: 'LOGOUT_FAILED',
        message: 'Failed to logout'
      });
    }
  });

  /**
   * GET /auth/me
   * Get current authenticated user information
   */
  fastify.get('/me', {
    preHandler: [fastify.authenticate],
    schema: {
      description: 'Get current authenticated user information',
      tags: ['Authentication'],
      response: {
        200: CurrentUserResponseSchema,
        401: Type.Object({
          error: Type.String(),
          message: Type.String()
        })
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      
      // Get current user information
      const currentUser = await authService.getCurrentUser(user.id, user.tenant_id);

      return reply.code(200).send(currentUser);

    } catch (error) {
      request.log.error('Get current user error', { 
        userId: request.user?.id,
        error: error.message 
      });

      switch (error.message) {
        case AuthError.USER_NOT_FOUND:
          return reply.code(401).send({
            error: 'USER_NOT_FOUND',
            message: 'User not found or inactive'
          });

        default:
          return reply.code(500).send({
            error: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to get user information'
          });
      }
    }
  });

  /**
   * GET /auth/sessions
   * Get user's active sessions
   */
  fastify.get('/sessions', {
    preHandler: [fastify.authenticate],
    schema: {
      description: 'Get user\'s active sessions',
      tags: ['Authentication'],
      response: {
        200: Type.Object({
          sessions: Type.Array(Type.Object({
            id: Type.String(),
            ip_address: Type.Optional(Type.String()),
            user_agent: Type.Optional(Type.String()),
            last_activity: Type.String({ format: 'date-time' }),
            expires_at: Type.String({ format: 'date-time' }),
            created_at: Type.String({ format: 'date-time' }),
            is_active: Type.Boolean(),
            is_current: Type.Boolean()
          }))
        }),
        401: Type.Object({
          error: Type.String(),
          message: Type.String()
        })
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const currentIp = extractIpAddress(request);
      
      // Get user sessions
      const sessions = await authService.getUserSessions(user.id, user.tenant_id);

      // Mark current session
      const sessionsWithCurrent = sessions.map(session => ({
        ...session,
        is_current: session.ip_address === currentIp
      }));

      return reply.code(200).send({
        sessions: sessionsWithCurrent
      });

    } catch (error) {
      request.log.error('Get user sessions error', { 
        userId: request.user?.id,
        error: error.message 
      });

      return reply.code(500).send({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get user sessions'
      });
    }
  });

  /**
   * DELETE /auth/sessions/:sessionId
   * Revoke a specific session
   */
  fastify.delete('/sessions/:sessionId', {
    preHandler: [fastify.authenticate],
    schema: {
      description: 'Revoke a specific user session',
      tags: ['Authentication'],
      params: Type.Object({
        sessionId: Type.String()
      }),
      response: {
        200: Type.Object({
          message: Type.String()
        }),
        401: Type.Object({
          error: Type.String(),
          message: Type.String()
        }),
        404: Type.Object({
          error: Type.String(),
          message: Type.String()
        })
      }
    }
  }, async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { sessionId } = request.params;

      // Find and revoke the specific session
      const result = await fastify.pg.query(
        `UPDATE user_sessions 
         SET is_active = false, updated_at = NOW()
         WHERE id = $1 AND user_id = $2 AND tenant_id = $3 AND is_active = true`,
        [sessionId, user.id, user.tenant_id]
      );

      if (result.rowCount === 0) {
        return reply.code(404).send({
          error: 'SESSION_NOT_FOUND',
          message: 'Session not found or already revoked'
        });
      }

      // Remove from Redis cache
      if (fastify.redis) {
        await fastify.redis.del(`refresh_token:${sessionId}`);
      }

      return reply.code(200).send({
        message: 'Session revoked successfully'
      });

    } catch (error) {
      request.log.error('Revoke session error', { 
        userId: request.user?.id,
        sessionId: request.params.sessionId,
        error: error.message 
      });

      return reply.code(500).send({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to revoke session'
      });
    }
  });

  /**
   * POST /auth/change-password
   * Change user password
   */
  fastify.post('/change-password', {
    preHandler: [fastify.authenticate],
    schema: {
      description: 'Change user password',
      tags: ['Authentication'],
      body: Type.Object({
        current_password: Type.String({ minLength: 1 }),
        new_password: Type.String({ minLength: 8 }),
        logout_all_devices: Type.Optional(Type.Boolean())
      }),
      response: {
        200: Type.Object({
          message: Type.String()
        }),
        400: Type.Object({
          error: Type.String(),
          message: Type.String(),
          details: Type.Optional(Type.Array(Type.String()))
        }),
        401: Type.Object({
          error: Type.String(),
          message: Type.String()
        })
      }
    }
  }, async (request: FastifyRequest<{ 
    Body: { 
      current_password: string; 
      new_password: string; 
      logout_all_devices?: boolean;
    } 
  }>, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { current_password, new_password, logout_all_devices } = request.body;

      // This would be implemented in a password service
      // For now, just return a placeholder response
      return reply.code(200).send({
        message: 'Password change endpoint - implementation pending'
      });

    } catch (error) {
      request.log.error('Change password error', { 
        userId: request.user?.id,
        error: error.message 
      });

      return reply.code(500).send({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to change password'
      });
    }
  });
};

export default authRoutes;