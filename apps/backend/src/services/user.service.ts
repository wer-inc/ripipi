import { 
  User,
  CreateUserRequest,
  UpdateUserRequest,
  ChangePasswordRequest,
  ResetPasswordRequest,
  UserListQuery,
  UserResponse,
  UserListResponse,
  ActivateUserRequest,
  BulkUserOperation,
  UpdateProfileRequest,
  InviteUserRequest,
  UserStatsResponse,
  UserError
} from '../types/user.js';
import { 
  UserRole, 
  Permission,
  ROLE_PERMISSIONS 
} from '../types/auth.js';
import { 
  TenantContext,
  PaginatedResult 
} from '../types/database.js';
import { userRepository } from '../repositories/user.repository.js';
import { 
  hashPassword, 
  verifyPassword, 
  validatePassword,
  DEFAULT_PASSWORD_POLICY,
  hasPermission,
  generateSecureToken
} from '../utils/auth.js';
import { logger } from '../config/logger.js';
import { RepositoryError, NotFoundError, DuplicateError } from '../repositories/base.repository.js';

/**
 * User service error class
 */
export class UserServiceError extends Error {
  constructor(
    message: string, 
    public readonly code: UserError,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'UserServiceError';
  }
}

/**
 * User service class for business logic and operations
 */
export class UserService {
  /**
   * Create a new user within a tenant
   */
  async createUser(
    request: CreateUserRequest,
    tenantId: string,
    context: TenantContext
  ): Promise<UserResponse> {
    try {
      // Validate permissions
      await this.validateUserCreationPermissions(request.role, context);

      // Validate password
      const passwordValidation = validatePassword(request.password);
      if (!passwordValidation.isValid) {
        throw new UserServiceError(
          `Password policy violation: ${passwordValidation.errors.join(', ')}`,
          UserError.INVALID_PASSWORD
        );
      }

      // Check for duplicate email
      const existingEmailUser = await userRepository.emailExists(request.email, tenantId);
      if (existingEmailUser) {
        throw new UserServiceError(
          'Email address already exists in this tenant',
          UserError.EMAIL_ALREADY_EXISTS
        );
      }

      // Check for duplicate phone if provided
      if (request.phone) {
        const existingPhoneUser = await userRepository.phoneExists(request.phone, tenantId);
        if (existingPhoneUser) {
          throw new UserServiceError(
            'Phone number already exists in this tenant',
            UserError.PHONE_ALREADY_EXISTS
          );
        }
      }

      // Hash password
      const passwordHash = await hashPassword(request.password);
      const now = new Date();

      // Prepare user data
      const userData = {
        email: request.email.toLowerCase(),
        password_hash: passwordHash,
        first_name: request.first_name,
        last_name: request.last_name,
        phone: request.phone || null,
        role: request.role,
        is_active: true,
        is_email_verified: false,
        failed_login_attempts: 0,
        password_changed_at: now,
        preferences: request.preferences || {},
        version: 1
      };

      // Create user
      const user = await userRepository.create(userData, tenantId, context);

      logger.info('User created successfully', {
        userId: user.id,
        email: user.email,
        role: user.role,
        tenantId,
        createdBy: context.userId
      });

      // TODO: Send welcome email if requested
      if (request.send_welcome_email !== false) {
        await this.sendWelcomeEmail(user, tenantId);
      }

      return this.toUserResponse(user);
    } catch (error) {
      logger.error('Failed to create user', {
        email: request.email,
        role: request.role,
        tenantId,
        error
      });

      if (error instanceof UserServiceError) {
        throw error;
      }
      if (error instanceof DuplicateError) {
        if (error.message.includes('email')) {
          throw new UserServiceError(
            'Email address already exists',
            UserError.EMAIL_ALREADY_EXISTS,
            error
          );
        }
        if (error.message.includes('phone')) {
          throw new UserServiceError(
            'Phone number already exists',
            UserError.PHONE_ALREADY_EXISTS,
            error
          );
        }
      }
      throw new UserServiceError(
        `Failed to create user: ${error.message}`,
        UserError.USER_NOT_FOUND,
        error as Error
      );
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(
    userId: string,
    tenantId: string,
    context: TenantContext
  ): Promise<UserResponse> {
    try {
      // Check read permissions
      if (!hasPermission(context.role || UserRole.CUSTOMER, Permission.USER_READ)) {
        // Allow users to read their own profile
        if (userId !== context.userId) {
          throw new UserServiceError(
            'Insufficient permissions to read user data',
            UserError.INSUFFICIENT_PERMISSIONS
          );
        }
      }

      const user = await userRepository.findById(userId, tenantId);
      if (!user) {
        throw new UserServiceError(
          'User not found',
          UserError.USER_NOT_FOUND
        );
      }

      return this.toUserResponse(user);
    } catch (error) {
      if (error instanceof UserServiceError) {
        throw error;
      }
      throw new UserServiceError(
        `Failed to get user: ${error.message}`,
        UserError.USER_NOT_FOUND,
        error as Error
      );
    }
  }

  /**
   * List users with filtering and pagination
   */
  async listUsers(
    query: UserListQuery,
    tenantId: string,
    context: TenantContext
  ): Promise<UserListResponse> {
    try {
      // Check permissions
      if (!hasPermission(context.role || UserRole.CUSTOMER, Permission.USER_READ)) {
        throw new UserServiceError(
          'Insufficient permissions to list users',
          UserError.INSUFFICIENT_PERMISSIONS
        );
      }

      const result = await userRepository.searchUsers(tenantId, query);
      
      return {
        data: result.data.map(user => this.toUserResponse(user)),
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.hasMore
      };
    } catch (error) {
      if (error instanceof UserServiceError) {
        throw error;
      }
      throw new UserServiceError(
        `Failed to list users: ${error.message}`,
        UserError.USER_NOT_FOUND,
        error as Error
      );
    }
  }

  /**
   * Update user information
   */
  async updateUser(
    userId: string,
    request: UpdateUserRequest,
    tenantId: string,
    context: TenantContext
  ): Promise<UserResponse> {
    try {
      // Check permissions
      const hasUpdatePermission = hasPermission(context.role || UserRole.CUSTOMER, Permission.USER_UPDATE);
      const isOwnProfile = userId === context.userId;

      if (!hasUpdatePermission && !isOwnProfile) {
        throw new UserServiceError(
          'Insufficient permissions to update user',
          UserError.INSUFFICIENT_PERMISSIONS
        );
      }

      // Get current user
      const currentUser = await userRepository.findById(userId, tenantId);
      if (!currentUser) {
        throw new UserServiceError(
          'User not found',
          UserError.USER_NOT_FOUND
        );
      }

      // Validate role change permissions
      if (request.role && request.role !== currentUser.role) {
        await this.validateRoleChangePermissions(currentUser.role, request.role, context);
      }

      // Check for duplicate phone if being updated
      if (request.phone && request.phone !== currentUser.phone) {
        const existingPhoneUser = await userRepository.phoneExists(request.phone, tenantId, userId);
        if (existingPhoneUser) {
          throw new UserServiceError(
            'Phone number already exists in this tenant',
            UserError.PHONE_ALREADY_EXISTS
          );
        }
      }

      // Prepare update data
      const updateData: Partial<User> = {};
      if (request.first_name !== undefined) updateData.first_name = request.first_name;
      if (request.last_name !== undefined) updateData.last_name = request.last_name;
      if (request.phone !== undefined) updateData.phone = request.phone;
      if (request.role !== undefined) updateData.role = request.role;
      if (request.is_active !== undefined && hasUpdatePermission) {
        updateData.is_active = request.is_active;
      }
      if (request.preferences !== undefined) updateData.preferences = request.preferences;
      if (request.version !== undefined) updateData.version = request.version;

      // Update user
      const updatedUser = await userRepository.update(userId, updateData, tenantId, context);
      if (!updatedUser) {
        throw new UserServiceError(
          'Failed to update user - user may have been modified by another process',
          UserError.USER_NOT_FOUND
        );
      }

      logger.info('User updated successfully', {
        userId,
        tenantId,
        updatedBy: context.userId,
        changes: Object.keys(updateData)
      });

      return this.toUserResponse(updatedUser);
    } catch (error) {
      if (error instanceof UserServiceError) {
        throw error;
      }
      throw new UserServiceError(
        `Failed to update user: ${error.message}`,
        UserError.USER_NOT_FOUND,
        error as Error
      );
    }
  }

  /**
   * Change user password
   */
  async changePassword(
    userId: string,
    request: ChangePasswordRequest,
    tenantId: string,
    context: TenantContext
  ): Promise<void> {
    try {
      // Only allow users to change their own password or admins
      const hasUpdatePermission = hasPermission(context.role || UserRole.CUSTOMER, Permission.USER_UPDATE);
      const isOwnPassword = userId === context.userId;

      if (!hasUpdatePermission && !isOwnPassword) {
        throw new UserServiceError(
          'Insufficient permissions to change password',
          UserError.INSUFFICIENT_PERMISSIONS
        );
      }

      // Get current user
      const user = await userRepository.findById(userId, tenantId);
      if (!user) {
        throw new UserServiceError(
          'User not found',
          UserError.USER_NOT_FOUND
        );
      }

      // Verify current password for own account
      if (isOwnPassword) {
        const isCurrentPasswordValid = await verifyPassword(request.current_password, user.password_hash);
        if (!isCurrentPasswordValid) {
          throw new UserServiceError(
            'Current password is incorrect',
            UserError.INVALID_PASSWORD
          );
        }
      }

      // Validate new password matches confirmation
      if (request.new_password !== request.confirm_password) {
        throw new UserServiceError(
          'New password and confirmation do not match',
          UserError.PASSWORD_MISMATCH
        );
      }

      // Validate new password policy
      const passwordValidation = validatePassword(request.new_password);
      if (!passwordValidation.isValid) {
        throw new UserServiceError(
          `Password policy violation: ${passwordValidation.errors.join(', ')}`,
          UserError.INVALID_PASSWORD
        );
      }

      // Hash new password
      const newPasswordHash = await hashPassword(request.new_password);

      // Update password
      const success = await userRepository.updatePassword(userId, newPasswordHash, tenantId, context);
      if (!success) {
        throw new UserServiceError(
          'Failed to update password',
          UserError.USER_NOT_FOUND
        );
      }

      logger.info('User password changed successfully', {
        userId,
        tenantId,
        changedBy: context.userId
      });

      // TODO: Send password change notification email
      await this.sendPasswordChangeNotification(user, tenantId);

    } catch (error) {
      if (error instanceof UserServiceError) {
        throw error;
      }
      throw new UserServiceError(
        `Failed to change password: ${error.message}`,
        UserError.INVALID_PASSWORD,
        error as Error
      );
    }
  }

  /**
   * Reset user password (admin function)
   */
  async resetPassword(
    userId: string,
    request: ResetPasswordRequest,
    tenantId: string,
    context: TenantContext
  ): Promise<void> {
    try {
      // Check permissions - only admins can reset passwords
      if (!hasPermission(context.role || UserRole.CUSTOMER, Permission.USER_UPDATE)) {
        throw new UserServiceError(
          'Insufficient permissions to reset password',
          UserError.INSUFFICIENT_PERMISSIONS
        );
      }

      // Get user
      const user = await userRepository.findById(userId, tenantId);
      if (!user) {
        throw new UserServiceError(
          'User not found',
          UserError.USER_NOT_FOUND
        );
      }

      // Validate new password matches confirmation
      if (request.new_password !== request.confirm_password) {
        throw new UserServiceError(
          'New password and confirmation do not match',
          UserError.PASSWORD_MISMATCH
        );
      }

      // Validate new password policy
      const passwordValidation = validatePassword(request.new_password);
      if (!passwordValidation.isValid) {
        throw new UserServiceError(
          `Password policy violation: ${passwordValidation.errors.join(', ')}`,
          UserError.INVALID_PASSWORD
        );
      }

      // Hash new password
      const newPasswordHash = await hashPassword(request.new_password);

      // Update password
      const success = await userRepository.updatePassword(userId, newPasswordHash, tenantId, context);
      if (!success) {
        throw new UserServiceError(
          'Failed to reset password',
          UserError.USER_NOT_FOUND
        );
      }

      logger.info('User password reset successfully', {
        userId,
        tenantId,
        resetBy: context.userId
      });

      // TODO: Send password reset notification email
      await this.sendPasswordResetNotification(user, tenantId);

    } catch (error) {
      if (error instanceof UserServiceError) {
        throw error;
      }
      throw new UserServiceError(
        `Failed to reset password: ${error.message}`,
        UserError.INVALID_PASSWORD,
        error as Error
      );
    }
  }

  /**
   * Activate or deactivate user
   */
  async activateUser(
    userId: string,
    request: ActivateUserRequest,
    tenantId: string,
    context: TenantContext
  ): Promise<UserResponse> {
    try {
      // Check permissions
      if (!hasPermission(context.role || UserRole.CUSTOMER, Permission.USER_UPDATE)) {
        throw new UserServiceError(
          'Insufficient permissions to activate/deactivate user',
          UserError.INSUFFICIENT_PERMISSIONS
        );
      }

      // Prevent self-deactivation
      if (userId === context.userId && !request.is_active) {
        throw new UserServiceError(
          'Cannot deactivate your own account',
          UserError.CANNOT_DELETE_SELF
        );
      }

      const updateData: Partial<User> = {
        is_active: request.is_active
      };

      const updatedUser = await userRepository.update(userId, updateData, tenantId, context);
      if (!updatedUser) {
        throw new UserServiceError(
          'User not found',
          UserError.USER_NOT_FOUND
        );
      }

      logger.info('User activation status changed', {
        userId,
        isActive: request.is_active,
        reason: request.reason,
        tenantId,
        changedBy: context.userId
      });

      return this.toUserResponse(updatedUser);
    } catch (error) {
      if (error instanceof UserServiceError) {
        throw error;
      }
      throw new UserServiceError(
        `Failed to activate/deactivate user: ${error.message}`,
        UserError.USER_NOT_FOUND,
        error as Error
      );
    }
  }

  /**
   * Delete user (soft delete)
   */
  async deleteUser(
    userId: string,
    tenantId: string,
    context: TenantContext
  ): Promise<boolean> {
    try {
      // Check permissions
      if (!hasPermission(context.role || UserRole.CUSTOMER, Permission.USER_DELETE)) {
        throw new UserServiceError(
          'Insufficient permissions to delete user',
          UserError.INSUFFICIENT_PERMISSIONS
        );
      }

      // Prevent self-deletion
      if (userId === context.userId) {
        throw new UserServiceError(
          'Cannot delete your own account',
          UserError.CANNOT_DELETE_SELF
        );
      }

      const deleted = await userRepository.delete(userId, tenantId, context);
      if (!deleted) {
        throw new UserServiceError(
          'User not found',
          UserError.USER_NOT_FOUND
        );
      }

      logger.info('User deleted successfully', {
        userId,
        tenantId,
        deletedBy: context.userId
      });

      return true;
    } catch (error) {
      if (error instanceof UserServiceError) {
        throw error;
      }
      throw new UserServiceError(
        `Failed to delete user: ${error.message}`,
        UserError.USER_NOT_FOUND,
        error as Error
      );
    }
  }

  /**
   * Get user statistics
   */
  async getUserStatistics(
    tenantId: string,
    context: TenantContext
  ): Promise<UserStatsResponse> {
    try {
      // Check permissions
      if (!hasPermission(context.role || UserRole.CUSTOMER, Permission.ANALYTICS_VIEW)) {
        throw new UserServiceError(
          'Insufficient permissions to view user statistics',
          UserError.INSUFFICIENT_PERMISSIONS
        );
      }

      const stats = await userRepository.getUserStats(tenantId);

      return {
        total_users: stats.total,
        active_users: stats.active,
        inactive_users: stats.inactive,
        unverified_users: stats.unverified,
        locked_users: stats.locked,
        users_by_role: stats.byRole,
        new_users_last_30_days: stats.newLast30Days,
        active_sessions: 0 // TODO: Implement session counting
      };
    } catch (error) {
      if (error instanceof UserServiceError) {
        throw error;
      }
      throw new UserServiceError(
        `Failed to get user statistics: ${error.message}`,
        UserError.USER_NOT_FOUND,
        error as Error
      );
    }
  }

  /**
   * Verify user email
   */
  async verifyUserEmail(
    userId: string,
    tenantId: string,
    context: TenantContext
  ): Promise<UserResponse> {
    try {
      const success = await userRepository.verifyEmail(userId, tenantId, context);
      if (!success) {
        throw new UserServiceError(
          'User not found or email already verified',
          UserError.USER_NOT_FOUND
        );
      }

      const user = await userRepository.findById(userId, tenantId);
      if (!user) {
        throw new UserServiceError(
          'User not found',
          UserError.USER_NOT_FOUND
        );
      }

      logger.info('User email verified', {
        userId,
        tenantId,
        verifiedBy: context.userId
      });

      return this.toUserResponse(user);
    } catch (error) {
      if (error instanceof UserServiceError) {
        throw error;
      }
      throw new UserServiceError(
        `Failed to verify email: ${error.message}`,
        UserError.USER_NOT_FOUND,
        error as Error
      );
    }
  }

  /**
   * Perform bulk operations on users
   */
  async bulkUserOperation(
    request: BulkUserOperation,
    tenantId: string,
    context: TenantContext
  ): Promise<{ affected: number; errors: string[] }> {
    try {
      // Check permissions
      if (!hasPermission(context.role || UserRole.CUSTOMER, Permission.USER_UPDATE)) {
        throw new UserServiceError(
          'Insufficient permissions for bulk operations',
          UserError.INSUFFICIENT_PERMISSIONS
        );
      }

      const errors: string[] = [];
      let affected = 0;

      switch (request.operation) {
        case 'activate':
        case 'deactivate':
          affected = await userRepository.bulkUpdateStatus(
            request.user_ids,
            request.operation === 'activate',
            tenantId,
            context
          );
          break;

        case 'delete':
          // TODO: Implement bulk delete
          for (const userId of request.user_ids) {
            try {
              const deleted = await userRepository.delete(userId, tenantId, context);
              if (deleted) affected++;
            } catch (error) {
              errors.push(`Failed to delete user ${userId}: ${error.message}`);
            }
          }
          break;

        case 'verify_email':
          // TODO: Implement bulk email verification
          for (const userId of request.user_ids) {
            try {
              const verified = await userRepository.verifyEmail(userId, tenantId, context);
              if (verified) affected++;
            } catch (error) {
              errors.push(`Failed to verify email for user ${userId}: ${error.message}`);
            }
          }
          break;

        default:
          throw new UserServiceError(
            `Unknown bulk operation: ${request.operation}`,
            UserError.USER_NOT_FOUND
          );
      }

      logger.info('Bulk user operation completed', {
        operation: request.operation,
        affected,
        errors: errors.length,
        tenantId,
        performedBy: context.userId
      });

      return { affected, errors };
    } catch (error) {
      if (error instanceof UserServiceError) {
        throw error;
      }
      throw new UserServiceError(
        `Failed to perform bulk operation: ${error.message}`,
        UserError.USER_NOT_FOUND,
        error as Error
      );
    }
  }

  /**
   * Convert User entity to UserResponse (excludes sensitive fields)
   */
  private toUserResponse(user: User): UserResponse {
    return {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      phone: user.phone || undefined,
      role: user.role,
      tenant_id: user.tenant_id,
      is_active: user.is_active,
      is_email_verified: user.is_email_verified,
      email_verified_at: user.email_verified_at?.toISOString(),
      last_login_at: user.last_login_at?.toISOString(),
      password_changed_at: user.password_changed_at?.toISOString(),
      failed_login_attempts: user.failed_login_attempts,
      locked_until: user.locked_until?.toISOString(),
      preferences: user.preferences,
      created_at: user.created_at.toISOString(),
      updated_at: user.updated_at.toISOString(),
      created_by: user.created_by,
      updated_by: user.updated_by,
      version: user.version
    };
  }

  /**
   * Validate user creation permissions based on role
   */
  private async validateUserCreationPermissions(
    targetRole: UserRole,
    context: TenantContext
  ): Promise<void> {
    // Check basic permission
    if (!hasPermission(context.role || UserRole.CUSTOMER, Permission.USER_CREATE)) {
      throw new UserServiceError(
        'Insufficient permissions to create users',
        UserError.INSUFFICIENT_PERMISSIONS
      );
    }

    // Role hierarchy validation
    const userRole = context.role || UserRole.CUSTOMER;
    const canCreateRole = this.canCreateRole(userRole, targetRole);
    
    if (!canCreateRole) {
      throw new UserServiceError(
        `Cannot create user with role ${targetRole}. Insufficient privileges.`,
        UserError.ROLE_PERMISSION_DENIED
      );
    }
  }

  /**
   * Validate role change permissions
   */
  private async validateRoleChangePermissions(
    currentRole: UserRole,
    newRole: UserRole,
    context: TenantContext
  ): Promise<void> {
    const userRole = context.role || UserRole.CUSTOMER;
    
    // Cannot promote to a role higher than your own
    if (!this.canCreateRole(userRole, newRole)) {
      throw new UserServiceError(
        `Cannot assign role ${newRole}. Insufficient privileges.`,
        UserError.CANNOT_MODIFY_HIGHER_ROLE
      );
    }

    // Cannot modify users with higher or equal roles (except for super admin)
    if (userRole !== UserRole.SUPER_ADMIN && !this.isRoleLower(currentRole, userRole)) {
      throw new UserServiceError(
        'Cannot modify user with equal or higher role',
        UserError.CANNOT_MODIFY_HIGHER_ROLE
      );
    }
  }

  /**
   * Check if a role can create another role
   */
  private canCreateRole(creatorRole: UserRole, targetRole: UserRole): boolean {
    const roleHierarchy = {
      [UserRole.SUPER_ADMIN]: 5,
      [UserRole.TENANT_ADMIN]: 4,
      [UserRole.MANAGER]: 3,
      [UserRole.STAFF]: 2,
      [UserRole.CUSTOMER]: 1
    };

    return roleHierarchy[creatorRole] > roleHierarchy[targetRole];
  }

  /**
   * Check if a role is lower than another
   */
  private isRoleLower(role1: UserRole, role2: UserRole): boolean {
    const roleHierarchy = {
      [UserRole.SUPER_ADMIN]: 5,
      [UserRole.TENANT_ADMIN]: 4,
      [UserRole.MANAGER]: 3,
      [UserRole.STAFF]: 2,
      [UserRole.CUSTOMER]: 1
    };

    return roleHierarchy[role1] < roleHierarchy[role2];
  }

  /**
   * Send welcome email to new user
   * TODO: Implement email service integration
   */
  private async sendWelcomeEmail(user: User, tenantId: string): Promise<void> {
    logger.info('Sending welcome email', {
      userId: user.id,
      email: user.email,
      tenantId
    });
    // TODO: Integrate with email service
  }

  /**
   * Send password change notification
   * TODO: Implement email service integration
   */
  private async sendPasswordChangeNotification(user: User, tenantId: string): Promise<void> {
    logger.info('Sending password change notification', {
      userId: user.id,
      email: user.email,
      tenantId
    });
    // TODO: Integrate with email service
  }

  /**
   * Send password reset notification
   * TODO: Implement email service integration
   */
  private async sendPasswordResetNotification(user: User, tenantId: string): Promise<void> {
    logger.info('Sending password reset notification', {
      userId: user.id,
      email: user.email,
      tenantId
    });
    // TODO: Integrate with email service
  }
}

// Export singleton instance
export const userService = new UserService();