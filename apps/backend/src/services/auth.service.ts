import { FastifyInstance } from 'fastify';
import { PoolClient } from 'pg';
import { 
  LoginRequest, 
  LoginResponse, 
  RefreshTokenRequest,
  RefreshTokenResponse,
  LogoutRequest,
  CurrentUserResponse,
  UserSession,
  TokenPayload,
  UserRole,
  Permission,
  AuthError,
  TokenType
} from '../types/auth.js';
import {
  verifyPassword,
  hashToken,
  generateSessionId,
  calculateExpirationTime,
  getPermissionsForRole,
  extractIpAddress,
  sanitizeUserAgent
} from '../utils/auth.js';
import { db } from '../db/index.js';
import { config } from '../config/index.js';

export interface AuthServiceDependencies {
  fastify: FastifyInstance;
  redis?: any; // Redis client for session storage
}

/**
 * Authentication service for handling login, logout, token refresh
 */
export class AuthService {
  private fastify: FastifyInstance;
  private redis?: any;

  constructor(dependencies: AuthServiceDependencies) {
    this.fastify = dependencies.fastify;
    this.redis = dependencies.redis;
  }

  /**
   * Authenticate user with email and password
   */
  async login(request: LoginRequest, clientIp?: string, userAgent?: string): Promise<LoginResponse> {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');

      // Find user by email
      const userQuery = `
        SELECT 
          u.id, u.email, u.password_hash, u.first_name, u.last_name, 
          u.role, u.tenant_id, u.is_active, u.is_email_verified,
          u.failed_login_attempts, u.locked_until, u.last_login_at,
          t.name as tenant_name, t.is_active as tenant_active
        FROM users u
        JOIN tenants t ON u.tenant_id = t.id
        WHERE u.email = $1
          AND ($2::text IS NULL OR u.tenant_id = $2)
      `;
      
      const userResult = await client.query(userQuery, [request.email, request.tenant_id]);
      
      if (userResult.rows.length === 0) {
        throw new Error(AuthError.INVALID_CREDENTIALS);
      }

      const user = userResult.rows[0];

      // Check if user account is active
      if (!user.is_active) {
        throw new Error(AuthError.ACCOUNT_DISABLED);
      }

      // Check if tenant is active
      if (!user.tenant_active) {
        throw new Error(AuthError.TENANT_NOT_FOUND);
      }

      // Check if account is locked
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        throw new Error(AuthError.ACCOUNT_LOCKED);
      }

      // Verify password
      const isValidPassword = await verifyPassword(request.password, user.password_hash);
      
      if (!isValidPassword) {
        // Increment failed login attempts
        await this.incrementFailedLoginAttempts(client, user.id);
        throw new Error(AuthError.INVALID_CREDENTIALS);
      }

      // Reset failed login attempts on successful login
      await this.resetFailedLoginAttempts(client, user.id);

      // Get user permissions
      const permissions = getPermissionsForRole(user.role);

      // Generate tokens
      const tokenPayload: Omit<TokenPayload, 'iat' | 'exp' | 'type'> = {
        sub: user.id,
        tenant_id: user.tenant_id,
        role: user.role,
        permissions
      };

      const tokens = await this.fastify.generateTokens(tokenPayload);

      // Create user session
      const sessionId = generateSessionId();
      const refreshTokenHash = hashToken(tokens.refreshToken);
      const expiresAt = calculateExpirationTime(
        request.remember_me ? config.JWT_REFRESH_EXPIRES_IN : config.JWT_EXPIRES_IN
      );

      const sessionInsertQuery = `
        INSERT INTO user_sessions (
          id, user_id, tenant_id, refresh_token_hash, ip_address, 
          user_agent, expires_at, last_activity, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), true)
      `;

      await client.query(sessionInsertQuery, [
        sessionId,
        user.id,
        user.tenant_id,
        refreshTokenHash,
        clientIp,
        sanitizeUserAgent(userAgent),
        expiresAt
      ]);

      // Update last login timestamp
      await client.query(
        'UPDATE users SET last_login_at = NOW() WHERE id = $1',
        [user.id]
      );

      // Store refresh token in Redis if available
      if (this.redis) {
        const ttl = Math.floor(expiresAt.getTime() / 1000) - Math.floor(Date.now() / 1000);
        await this.redis.setex(`refresh_token:${sessionId}`, ttl, refreshTokenHash);
      }

      await client.query('COMMIT');

      return {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_in: tokens.accessExpiresIn,
        token_type: 'Bearer',
        user: {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          role: user.role,
          tenant_id: user.tenant_id,
          tenant_name: user.tenant_name,
          last_login_at: user.last_login_at
        }
      };

    } catch (error) {
      await client.query('ROLLBACK');
      this.fastify.log.error('Login failed', { 
        email: request.email,
        error: error.message,
        clientIp,
        userAgent
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(request: RefreshTokenRequest): Promise<RefreshTokenResponse> {
    try {
      // Verify refresh token
      const payload = await this.fastify.verifyToken(request.refresh_token, TokenType.REFRESH);
      
      // Find the session
      const sessionQuery = `
        SELECT id, user_id, tenant_id, refresh_token_hash, expires_at, is_active
        FROM user_sessions
        WHERE user_id = $1 AND tenant_id = $2 AND is_active = true
          AND expires_at > NOW()
      `;
      
      const sessionResult = await db.query(sessionQuery, [payload.sub, payload.tenant_id]);
      
      if (sessionResult.rows.length === 0) {
        throw new Error(AuthError.REFRESH_TOKEN_INVALID);
      }

      const session = sessionResult.rows[0];
      const expectedTokenHash = hashToken(request.refresh_token);

      // Verify the refresh token hash matches
      if (session.refresh_token_hash !== expectedTokenHash) {
        // Invalidate all sessions for security (possible token compromise)
        await this.invalidateAllUserSessions(payload.sub, payload.tenant_id);
        throw new Error(AuthError.REFRESH_TOKEN_INVALID);
      }

      // Get user information
      const userQuery = `
        SELECT id, email, first_name, last_name, role, tenant_id, is_active
        FROM users
        WHERE id = $1 AND tenant_id = $2 AND is_active = true
      `;
      
      const userResult = await db.query(userQuery, [payload.sub, payload.tenant_id]);
      
      if (userResult.rows.length === 0) {
        throw new Error(AuthError.USER_NOT_FOUND);
      }

      const user = userResult.rows[0];
      const permissions = getPermissionsForRole(user.role);

      // Generate new tokens
      const newTokenPayload: Omit<TokenPayload, 'iat' | 'exp' | 'type'> = {
        sub: user.id,
        tenant_id: user.tenant_id,
        role: user.role,
        permissions
      };

      const tokens = await this.fastify.generateTokens(newTokenPayload);

      // Update session with new refresh token hash
      const newRefreshTokenHash = hashToken(tokens.refreshToken);
      await db.query(
        `UPDATE user_sessions 
         SET refresh_token_hash = $1, last_activity = NOW() 
         WHERE id = $2`,
        [newRefreshTokenHash, session.id]
      );

      // Update Redis cache if available
      if (this.redis) {
        const ttl = Math.floor(new Date(session.expires_at).getTime() / 1000) - Math.floor(Date.now() / 1000);
        await this.redis.setex(`refresh_token:${session.id}`, ttl, newRefreshTokenHash);
      }

      return {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_in: tokens.accessExpiresIn,
        token_type: 'Bearer'
      };

    } catch (error) {
      this.fastify.log.error('Token refresh failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Logout user and invalidate tokens
   */
  async logout(request: LogoutRequest, userId: string, tenantId: string): Promise<void> {
    try {
      if (request.all_devices) {
        // Logout from all devices
        await this.invalidateAllUserSessions(userId, tenantId);
      } else if (request.refresh_token) {
        // Logout from specific session
        const refreshTokenHash = hashToken(request.refresh_token);
        
        const sessionQuery = `
          UPDATE user_sessions 
          SET is_active = false, updated_at = NOW()
          WHERE user_id = $1 AND tenant_id = $2 AND refresh_token_hash = $3
        `;
        
        await db.query(sessionQuery, [userId, tenantId, refreshTokenHash]);

        // Remove from Redis if available
        if (this.redis) {
          const sessionResult = await db.query(
            'SELECT id FROM user_sessions WHERE user_id = $1 AND tenant_id = $2 AND refresh_token_hash = $3',
            [userId, tenantId, refreshTokenHash]
          );
          
          if (sessionResult.rows.length > 0) {
            await this.redis.del(`refresh_token:${sessionResult.rows[0].id}`);
          }
        }
      }
    } catch (error) {
      this.fastify.log.error('Logout failed', { 
        userId,
        tenantId,
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Get current user information
   */
  async getCurrentUser(userId: string, tenantId: string): Promise<CurrentUserResponse> {
    try {
      const userQuery = `
        SELECT 
          u.id, u.email, u.first_name, u.last_name, u.role, u.tenant_id,
          u.last_login_at, u.created_at, u.updated_at,
          t.name as tenant_name
        FROM users u
        JOIN tenants t ON u.tenant_id = t.id
        WHERE u.id = $1 AND u.tenant_id = $2 AND u.is_active = true
      `;
      
      const userResult = await db.query(userQuery, [userId, tenantId]);
      
      if (userResult.rows.length === 0) {
        throw new Error(AuthError.USER_NOT_FOUND);
      }

      const user = userResult.rows[0];
      const permissions = getPermissionsForRole(user.role);

      // Get current session information
      const sessionQuery = `
        SELECT id, last_activity, expires_at
        FROM user_sessions
        WHERE user_id = $1 AND tenant_id = $2 AND is_active = true
        ORDER BY last_activity DESC
        LIMIT 1
      `;
      
      const sessionResult = await db.query(sessionQuery, [userId, tenantId]);
      const session = sessionResult.rows[0];

      return {
        user: {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          role: user.role,
          tenant_id: user.tenant_id,
          tenant_name: user.tenant_name,
          permissions,
          last_login_at: user.last_login_at,
          created_at: user.created_at,
          updated_at: user.updated_at
        },
        session: session ? {
          id: session.id,
          last_activity: session.last_activity,
          expires_at: session.expires_at
        } : null
      };
    } catch (error) {
      this.fastify.log.error('Get current user failed', { 
        userId,
        tenantId,
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Invalidate all user sessions
   */
  private async invalidateAllUserSessions(userId: string, tenantId: string): Promise<void> {
    try {
      // Get all active sessions for cleanup
      if (this.redis) {
        const sessionsResult = await db.query(
          'SELECT id FROM user_sessions WHERE user_id = $1 AND tenant_id = $2 AND is_active = true',
          [userId, tenantId]
        );

        // Remove from Redis
        const keys = sessionsResult.rows.map(row => `refresh_token:${row.id}`);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      }

      // Mark all sessions as inactive
      await db.query(
        `UPDATE user_sessions 
         SET is_active = false, updated_at = NOW() 
         WHERE user_id = $1 AND tenant_id = $2`,
        [userId, tenantId]
      );
    } catch (error) {
      this.fastify.log.error('Failed to invalidate all user sessions', {
        userId,
        tenantId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Increment failed login attempts
   */
  private async incrementFailedLoginAttempts(client: PoolClient, userId: string): Promise<void> {
    const maxAttempts = 5; // Move to config
    const lockoutDuration = '15 minutes'; // Move to config

    const updateQuery = `
      UPDATE users 
      SET 
        failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1,
        locked_until = CASE 
          WHEN COALESCE(failed_login_attempts, 0) + 1 >= $2 
          THEN NOW() + INTERVAL '${lockoutDuration}'
          ELSE locked_until
        END,
        updated_at = NOW()
      WHERE id = $1
    `;

    await client.query(updateQuery, [userId, maxAttempts]);
  }

  /**
   * Reset failed login attempts
   */
  private async resetFailedLoginAttempts(client: PoolClient, userId: string): Promise<void> {
    await client.query(
      `UPDATE users 
       SET failed_login_attempts = 0, locked_until = NULL, updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<void> {
    try {
      // Get expired session IDs for Redis cleanup
      if (this.redis) {
        const expiredSessions = await db.query(
          'SELECT id FROM user_sessions WHERE expires_at <= NOW() AND is_active = true'
        );

        const keys = expiredSessions.rows.map(row => `refresh_token:${row.id}`);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      }

      // Mark expired sessions as inactive
      const result = await db.query(
        `UPDATE user_sessions 
         SET is_active = false, updated_at = NOW()
         WHERE expires_at <= NOW() AND is_active = true`
      );

      this.fastify.log.info(`Cleaned up ${result.rowCount} expired sessions`);
    } catch (error) {
      this.fastify.log.error('Failed to cleanup expired sessions', { error: error.message });
    }
  }

  /**
   * Get user sessions
   */
  async getUserSessions(userId: string, tenantId: string): Promise<UserSession[]> {
    try {
      const query = `
        SELECT 
          id, user_id, tenant_id, ip_address, user_agent,
          last_activity, expires_at, created_at, is_active
        FROM user_sessions
        WHERE user_id = $1 AND tenant_id = $2
        ORDER BY last_activity DESC
      `;
      
      const result = await db.query(query, [userId, tenantId]);
      
      return result.rows.map(row => ({
        id: row.id,
        user_id: row.user_id,
        tenant_id: row.tenant_id,
        refresh_token_hash: '***HIDDEN***', // Never expose this
        ip_address: row.ip_address,
        user_agent: row.user_agent,
        last_activity: row.last_activity,
        expires_at: row.expires_at,
        created_at: row.created_at,
        is_active: row.is_active
      }));
    } catch (error) {
      this.fastify.log.error('Failed to get user sessions', {
        userId,
        tenantId,
        error: error.message
      });
      throw error;
    }
  }
}