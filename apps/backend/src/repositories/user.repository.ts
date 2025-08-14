import { 
  BaseRepository, 
  RepositoryOptions, 
  FilterCondition,
  RepositoryError,
  NotFoundError,
  DuplicateError
} from './base.repository.js';
import { 
  User, 
  UserListQuery,
  UserError 
} from '../types/user.js';
import { UserRole } from '../types/auth.js';
import { 
  PaginatedResult,
  TenantContext 
} from '../types/database.js';
import { withTransaction } from '../db/transaction.js';
import { db } from '../db/index.js';
import { logger } from '../config/logger.js';

/**
 * User repository for database operations
 * Extends BaseRepository with user-specific functionality
 */
export class UserRepository extends BaseRepository<User> {
  constructor() {
    super({
      tableName: 'users',
      primaryKey: 'id',
      tenantKey: 'tenant_id',
      auditFields: true,
      optimisticLocking: true
    } as RepositoryOptions);
  }

  /**
   * Find user by email within a tenant
   */
  async findByEmail(
    email: string, 
    tenantId: string, 
    options?: { includeDeleted?: boolean }
  ): Promise<User | null> {
    try {
      let whereClause = 'email = $1 AND tenant_id = $2';
      const params = [email.toLowerCase(), tenantId];

      if (!options?.includeDeleted) {
        whereClause += ' AND deleted_at IS NULL';
      }

      const query = `
        SELECT * FROM ${this.tableName}
        WHERE ${whereClause}
        LIMIT 1
      `;

      const result = await db.query<User>(query, params);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Failed to find user by email', {
        email,
        tenantId,
        error
      });
      throw new RepositoryError(`Failed to find user by email: ${error}`, undefined, error as Error);
    }
  }

  /**
   * Find user by phone number within a tenant
   */
  async findByPhone(
    phone: string, 
    tenantId: string, 
    options?: { includeDeleted?: boolean }
  ): Promise<User | null> {
    try {
      let whereClause = 'phone = $1 AND tenant_id = $2';
      const params = [phone, tenantId];

      if (!options?.includeDeleted) {
        whereClause += ' AND deleted_at IS NULL';
      }

      const query = `
        SELECT * FROM ${this.tableName}
        WHERE ${whereClause}
        LIMIT 1
      `;

      const result = await db.query<User>(query, params);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Failed to find user by phone', {
        phone,
        tenantId,
        error
      });
      throw new RepositoryError(`Failed to find user by phone: ${error}`, undefined, error as Error);
    }
  }

  /**
   * Find users by role within a tenant
   */
  async findByRole(
    role: UserRole,
    tenantId: string,
    options?: { includeDeleted?: boolean; limit?: number }
  ): Promise<User[]> {
    try {
      let whereClause = 'role = $1 AND tenant_id = $2';
      const params = [role, tenantId];

      if (!options?.includeDeleted) {
        whereClause += ' AND deleted_at IS NULL';
      }

      const limitClause = options?.limit ? `LIMIT ${options.limit}` : '';

      const query = `
        SELECT * FROM ${this.tableName}
        WHERE ${whereClause}
        ORDER BY created_at DESC
        ${limitClause}
      `;

      const result = await db.query<User>(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Failed to find users by role', {
        role,
        tenantId,
        error
      });
      throw new RepositoryError(`Failed to find users by role: ${error}`, undefined, error as Error);
    }
  }

  /**
   * Search users with advanced filtering and pagination
   */
  async searchUsers(
    tenantId: string,
    queryParams: UserListQuery
  ): Promise<PaginatedResult<User>> {
    try {
      const filters: FilterCondition[] = [];
      
      // Build search filters
      if (queryParams.search) {
        const searchTerm = `%${queryParams.search.toLowerCase()}%`;
        // Use a custom WHERE clause for search across multiple fields
        const searchQuery = `
          SELECT * FROM ${this.tableName}
          WHERE tenant_id = $1
            AND (
              LOWER(first_name) LIKE $2 
              OR LOWER(last_name) LIKE $2 
              OR LOWER(email) LIKE $2 
              OR LOWER(CONCAT(first_name, ' ', last_name)) LIKE $2
            )
            ${!queryParams.include_deleted ? 'AND deleted_at IS NULL' : ''}
            ${queryParams.role ? 'AND role = $3' : ''}
            ${queryParams.is_active !== undefined ? `AND is_active = $${queryParams.role ? 4 : 3}` : ''}
            ${queryParams.is_email_verified !== undefined ? `AND is_email_verified = $${this.getNextParamIndex(queryParams)}` : ''}
            ${queryParams.created_since ? `AND created_at >= $${this.getNextParamIndex(queryParams)}` : ''}
            ${queryParams.last_login_since ? `AND last_login_at >= $${this.getNextParamIndex(queryParams)}` : ''}
          ORDER BY ${queryParams.sort_by || 'created_at'} ${queryParams.sort_order || 'DESC'}
          LIMIT $${this.getNextParamIndex(queryParams)} OFFSET $${this.getNextParamIndex(queryParams) + 1}
        `;

        const params = [tenantId, searchTerm];
        if (queryParams.role) params.push(queryParams.role);
        if (queryParams.is_active !== undefined) params.push(queryParams.is_active);
        if (queryParams.is_email_verified !== undefined) params.push(queryParams.is_email_verified);
        if (queryParams.created_since) params.push(queryParams.created_since);
        if (queryParams.last_login_since) params.push(queryParams.last_login_since);
        params.push(queryParams.limit || 50);
        params.push(queryParams.offset || 0);

        const countQuery = searchQuery.replace(/SELECT \* FROM/, 'SELECT COUNT(*) as total FROM')
                                    .replace(/ORDER BY.*/, '');
        const countParams = params.slice(0, -2); // Remove limit and offset

        const [dataResult, countResult] = await Promise.all([
          db.query<User>(searchQuery, params),
          db.query<{ total: string }>(countQuery, countParams)
        ]);

        const total = parseInt(countResult.rows[0]?.total || '0', 10);
        const limit = queryParams.limit || 50;
        const offset = queryParams.offset || 0;

        return {
          data: dataResult.rows,
          total,
          limit,
          offset,
          hasMore: offset + dataResult.rows.length < total
        };
      }

      // Build filters for non-search queries
      if (queryParams.role) {
        filters.push({ field: 'role', operator: '=', value: queryParams.role });
      }
      if (queryParams.is_active !== undefined) {
        filters.push({ field: 'is_active', operator: '=', value: queryParams.is_active });
      }
      if (queryParams.is_email_verified !== undefined) {
        filters.push({ field: 'is_email_verified', operator: '=', value: queryParams.is_email_verified });
      }
      if (queryParams.created_since) {
        filters.push({ field: 'created_at', operator: '>=', value: queryParams.created_since });
      }
      if (queryParams.last_login_since) {
        filters.push({ field: 'last_login_at', operator: '>=', value: queryParams.last_login_since });
      }

      // Use base repository for filtered queries
      return await this.findByTenant(tenantId, {
        filters,
        sort: queryParams.sort_by && queryParams.sort_order ? [{
          field: queryParams.sort_by,
          direction: queryParams.sort_order
        }] : undefined,
        pagination: {
          limit: queryParams.limit || 50,
          offset: queryParams.offset || 0
        },
        includeDeleted: queryParams.include_deleted || false
      });

    } catch (error) {
      logger.error('Failed to search users', {
        tenantId,
        queryParams,
        error
      });
      throw new RepositoryError(`Failed to search users: ${error}`, undefined, error as Error);
    }
  }

  /**
   * Check if email exists in tenant (for duplicate checking)
   */
  async emailExists(
    email: string, 
    tenantId: string, 
    excludeUserId?: string
  ): Promise<boolean> {
    try {
      let whereClause = 'email = $1 AND tenant_id = $2 AND deleted_at IS NULL';
      const params = [email.toLowerCase(), tenantId];

      if (excludeUserId) {
        whereClause += ' AND id != $3';
        params.push(excludeUserId);
      }

      const query = `
        SELECT 1 FROM ${this.tableName}
        WHERE ${whereClause}
        LIMIT 1
      `;

      const result = await db.query(query, params);
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Failed to check email existence', {
        email,
        tenantId,
        error
      });
      throw new RepositoryError(`Failed to check email existence: ${error}`, undefined, error as Error);
    }
  }

  /**
   * Check if phone exists in tenant (for duplicate checking)
   */
  async phoneExists(
    phone: string, 
    tenantId: string, 
    excludeUserId?: string
  ): Promise<boolean> {
    try {
      let whereClause = 'phone = $1 AND tenant_id = $2 AND deleted_at IS NULL';
      const params = [phone, tenantId];

      if (excludeUserId) {
        whereClause += ' AND id != $3';
        params.push(excludeUserId);
      }

      const query = `
        SELECT 1 FROM ${this.tableName}
        WHERE ${whereClause}
        LIMIT 1
      `;

      const result = await db.query(query, params);
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Failed to check phone existence', {
        phone,
        tenantId,
        error
      });
      throw new RepositoryError(`Failed to check phone existence: ${error}`, undefined, error as Error);
    }
  }

  /**
   * Update user password
   */
  async updatePassword(
    userId: string,
    passwordHash: string,
    tenantId: string,
    context?: TenantContext
  ): Promise<boolean> {
    return withTransaction(async (ctx) => {
      try {
        const now = new Date();
        const updateData = {
          password_hash: passwordHash,
          password_changed_at: now,
          failed_login_attempts: 0,
          locked_until: null,
          updated_at: now,
          ...(context?.userId && { updated_by: context.userId })
        };

        const { setClause, values } = this.buildUpdateClause(updateData);
        values.push(userId, tenantId);

        const query = `
          UPDATE ${this.tableName}
          SET ${setClause}
          WHERE id = $${values.length - 1} 
            AND tenant_id = $${values.length}
            AND deleted_at IS NULL
          RETURNING id
        `;

        const result = await ctx.query(query, values);
        const updated = result.rowCount > 0;

        if (updated) {
          logger.info('User password updated successfully', {
            userId,
            tenantId,
            updatedBy: context?.userId
          });
        }

        return updated;
      } catch (error) {
        logger.error('Failed to update user password', {
          userId,
          tenantId,
          error
        });
        throw new RepositoryError(`Failed to update password: ${error}`, undefined, error as Error);
      }
    });
  }

  /**
   * Record failed login attempt
   */
  async recordFailedLogin(
    userId: string,
    tenantId: string,
    maxAttempts: number = 5,
    lockoutDuration: number = 30 // minutes
  ): Promise<{ attemptsRemaining: number; lockedUntil: Date | null }> {
    return withTransaction(async (ctx) => {
      try {
        // Get current failed attempts
        const user = await this.findById(userId, tenantId);
        if (!user) {
          throw new NotFoundError(userId, this.tableName);
        }

        const newAttempts = (user.failed_login_attempts || 0) + 1;
        const now = new Date();
        let lockedUntil: Date | null = null;

        // Lock account if max attempts reached
        if (newAttempts >= maxAttempts) {
          lockedUntil = new Date(now.getTime() + lockoutDuration * 60 * 1000);
        }

        const updateData = {
          failed_login_attempts: newAttempts,
          locked_until: lockedUntil,
          updated_at: now
        };

        const { setClause, values } = this.buildUpdateClause(updateData);
        values.push(userId, tenantId);

        const query = `
          UPDATE ${this.tableName}
          SET ${setClause}
          WHERE id = $${values.length - 1} 
            AND tenant_id = $${values.length}
            AND deleted_at IS NULL
        `;

        await ctx.query(query, values);

        return {
          attemptsRemaining: Math.max(0, maxAttempts - newAttempts),
          lockedUntil
        };
      } catch (error) {
        logger.error('Failed to record failed login', {
          userId,
          tenantId,
          error
        });
        throw new RepositoryError(`Failed to record failed login: ${error}`, undefined, error as Error);
      }
    });
  }

  /**
   * Clear failed login attempts (on successful login)
   */
  async clearFailedLogins(
    userId: string,
    tenantId: string
  ): Promise<boolean> {
    return withTransaction(async (ctx) => {
      try {
        const now = new Date();
        const updateData = {
          failed_login_attempts: 0,
          locked_until: null,
          last_login_at: now,
          updated_at: now
        };

        const { setClause, values } = this.buildUpdateClause(updateData);
        values.push(userId, tenantId);

        const query = `
          UPDATE ${this.tableName}
          SET ${setClause}
          WHERE id = $${values.length - 1} 
            AND tenant_id = $${values.length}
            AND deleted_at IS NULL
          RETURNING id
        `;

        const result = await ctx.query(query, values);
        return result.rowCount > 0;
      } catch (error) {
        logger.error('Failed to clear failed logins', {
          userId,
          tenantId,
          error
        });
        throw new RepositoryError(`Failed to clear failed logins: ${error}`, undefined, error as Error);
      }
    });
  }

  /**
   * Verify user email
   */
  async verifyEmail(
    userId: string,
    tenantId: string,
    context?: TenantContext
  ): Promise<boolean> {
    return withTransaction(async (ctx) => {
      try {
        const now = new Date();
        const updateData = {
          is_email_verified: true,
          email_verified_at: now,
          updated_at: now,
          ...(context?.userId && { updated_by: context.userId })
        };

        const { setClause, values } = this.buildUpdateClause(updateData);
        values.push(userId, tenantId);

        const query = `
          UPDATE ${this.tableName}
          SET ${setClause}
          WHERE id = $${values.length - 1} 
            AND tenant_id = $${values.length}
            AND deleted_at IS NULL
            AND is_email_verified = false
          RETURNING id
        `;

        const result = await ctx.query(query, values);
        const updated = result.rowCount > 0;

        if (updated) {
          logger.info('User email verified successfully', {
            userId,
            tenantId,
            verifiedBy: context?.userId
          });
        }

        return updated;
      } catch (error) {
        logger.error('Failed to verify user email', {
          userId,
          tenantId,
          error
        });
        throw new RepositoryError(`Failed to verify email: ${error}`, undefined, error as Error);
      }
    });
  }

  /**
   * Get user statistics for a tenant
   */
  async getUserStats(tenantId: string): Promise<{
    total: number;
    active: number;
    inactive: number;
    verified: number;
    unverified: number;
    locked: number;
    byRole: Record<UserRole, number>;
    newLast30Days: number;
  }> {
    try {
      const queries = [
        // Total users
        `SELECT COUNT(*) as total FROM ${this.tableName} WHERE tenant_id = $1 AND deleted_at IS NULL`,
        
        // Active users
        `SELECT COUNT(*) as active FROM ${this.tableName} WHERE tenant_id = $1 AND deleted_at IS NULL AND is_active = true`,
        
        // Verified users
        `SELECT COUNT(*) as verified FROM ${this.tableName} WHERE tenant_id = $1 AND deleted_at IS NULL AND is_email_verified = true`,
        
        // Locked users
        `SELECT COUNT(*) as locked FROM ${this.tableName} WHERE tenant_id = $1 AND deleted_at IS NULL AND locked_until > NOW()`,
        
        // Users by role
        `SELECT role, COUNT(*) as count FROM ${this.tableName} WHERE tenant_id = $1 AND deleted_at IS NULL GROUP BY role`,
        
        // New users in last 30 days
        `SELECT COUNT(*) as new_users FROM ${this.tableName} WHERE tenant_id = $1 AND deleted_at IS NULL AND created_at >= NOW() - INTERVAL '30 days'`
      ];

      const results = await Promise.all(
        queries.map(query => db.query(query, [tenantId]))
      );

      const [totalRes, activeRes, verifiedRes, lockedRes, byRoleRes, newUsersRes] = results;

      const total = parseInt(totalRes.rows[0]?.total || '0', 10);
      const active = parseInt(activeRes.rows[0]?.active || '0', 10);
      const verified = parseInt(verifiedRes.rows[0]?.verified || '0', 10);
      const locked = parseInt(lockedRes.rows[0]?.locked || '0', 10);
      const newLast30Days = parseInt(newUsersRes.rows[0]?.new_users || '0', 10);

      const byRole: Record<UserRole, number> = {} as Record<UserRole, number>;
      Object.values(UserRole).forEach(role => {
        byRole[role] = 0;
      });
      
      byRoleRes.rows.forEach((row: any) => {
        byRole[row.role as UserRole] = parseInt(row.count, 10);
      });

      return {
        total,
        active,
        inactive: total - active,
        verified,
        unverified: total - verified,
        locked,
        byRole,
        newLast30Days
      };
    } catch (error) {
      logger.error('Failed to get user statistics', {
        tenantId,
        error
      });
      throw new RepositoryError(`Failed to get user statistics: ${error}`, undefined, error as Error);
    }
  }

  /**
   * Bulk activate/deactivate users
   */
  async bulkUpdateStatus(
    userIds: string[],
    isActive: boolean,
    tenantId: string,
    context?: TenantContext
  ): Promise<number> {
    return withTransaction(async (ctx) => {
      try {
        const now = new Date();
        const updateData = {
          is_active: isActive,
          updated_at: now,
          ...(context?.userId && { updated_by: context.userId })
        };

        const { setClause, values } = this.buildUpdateClause(updateData);
        
        // Add user IDs to parameters
        const placeholders = userIds.map((_, index) => `$${values.length + index + 1}`).join(',');
        values.push(...userIds);
        values.push(tenantId);

        const query = `
          UPDATE ${this.tableName}
          SET ${setClause}
          WHERE id IN (${placeholders})
            AND tenant_id = $${values.length}
            AND deleted_at IS NULL
        `;

        const result = await ctx.query(query, values);
        
        logger.info('Bulk user status update completed', {
          updatedCount: result.rowCount,
          isActive,
          tenantId,
          updatedBy: context?.userId
        });

        return result.rowCount || 0;
      } catch (error) {
        logger.error('Failed to bulk update user status', {
          userIds,
          isActive,
          tenantId,
          error
        });
        throw new RepositoryError(`Failed to bulk update status: ${error}`, undefined, error as Error);
      }
    });
  }

  /**
   * Helper method to calculate next parameter index for dynamic queries
   */
  private getNextParamIndex(queryParams: UserListQuery): number {
    let index = 3; // Start after tenantId and searchTerm
    if (queryParams.role) index++;
    if (queryParams.is_active !== undefined) index++;
    if (queryParams.is_email_verified !== undefined) index++;
    if (queryParams.created_since) index++;
    if (queryParams.last_login_since) index++;
    return index;
  }
}

// Export singleton instance
export const userRepository = new UserRepository();