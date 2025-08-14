import { FastifyRequest } from 'fastify';
import { TypeBoxValidatorCompiler } from '@fastify/type-provider-typebox';
import { Type, Static } from '@sinclair/typebox';
import { 
  CreateUserRequestSchema,
  UpdateUserRequestSchema,
  ChangePasswordRequestSchema,
  ResetPasswordRequestSchema,
  UserListQuerySchema,
  ActivateUserRequestSchema,
  BulkUserOperationSchema,
  UpdateProfileRequestSchema,
  InviteUserRequestSchema,
  UserError
} from '../types/user.js';
import { UserRole } from '../types/auth.js';
import { userRepository } from '../repositories/user.repository.js';
import { 
  validatePassword, 
  DEFAULT_PASSWORD_POLICY 
} from '../utils/auth.js';
import { logger } from '../config/logger.js';

/**
 * Validation error class
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * User validator class with comprehensive validation rules
 */
export class UserValidator {
  /**
   * Validate create user request
   */
  static async validateCreateUser(
    request: FastifyRequest,
    tenantId: string
  ): Promise<void> {
    const body = request.body as any;

    // Basic schema validation is handled by TypeBox
    // Additional business rule validation
    await this.validateEmail(body.email, tenantId);
    
    if (body.phone) {
      await this.validatePhone(body.phone, tenantId);
    }

    this.validatePassword(body.password);
    this.validateUserRole(body.role, request.user?.role);
    this.validateName(body.first_name, 'first_name');
    this.validateName(body.last_name, 'last_name');

    if (body.preferences) {
      this.validatePreferences(body.preferences);
    }
  }

  /**
   * Validate update user request
   */
  static async validateUpdateUser(
    request: FastifyRequest,
    userId: string,
    tenantId: string
  ): Promise<void> {
    const body = request.body as any;

    // Validate phone if provided
    if (body.phone !== undefined && body.phone !== null) {
      await this.validatePhone(body.phone, tenantId, userId);
    }

    // Validate role change
    if (body.role !== undefined) {
      this.validateUserRole(body.role, request.user?.role);
      await this.validateRoleChange(userId, body.role, tenantId, request.user?.role);
    }

    // Validate names if provided
    if (body.first_name !== undefined) {
      this.validateName(body.first_name, 'first_name');
    }
    if (body.last_name !== undefined) {
      this.validateName(body.last_name, 'last_name');
    }

    // Validate preferences
    if (body.preferences !== undefined) {
      this.validatePreferences(body.preferences);
    }

    // Validate version for optimistic locking
    if (body.version !== undefined) {
      this.validateVersion(body.version);
    }
  }

  /**
   * Validate change password request
   */
  static validateChangePassword(request: FastifyRequest): void {
    const body = request.body as any;

    // Validate current password is provided
    if (!body.current_password) {
      throw new ValidationError(
        'Current password is required',
        'current_password',
        'REQUIRED'
      );
    }

    // Validate new password
    this.validatePassword(body.new_password);

    // Validate password confirmation
    if (body.new_password !== body.confirm_password) {
      throw new ValidationError(
        'New password and confirmation do not match',
        'confirm_password',
        'PASSWORD_MISMATCH'
      );
    }

    // Ensure new password is different from current
    if (body.current_password === body.new_password) {
      throw new ValidationError(
        'New password must be different from current password',
        'new_password',
        'SAME_PASSWORD'
      );
    }
  }

  /**
   * Validate reset password request
   */
  static validateResetPassword(request: FastifyRequest): void {
    const body = request.body as any;

    // Validate new password
    this.validatePassword(body.new_password);

    // Validate password confirmation
    if (body.new_password !== body.confirm_password) {
      throw new ValidationError(
        'New password and confirmation do not match',
        'confirm_password',
        'PASSWORD_MISMATCH'
      );
    }
  }

  /**
   * Validate user list query parameters
   */
  static validateUserListQuery(request: FastifyRequest): void {
    const query = request.query as any;

    // Validate pagination parameters
    if (query.limit !== undefined) {
      const limit = parseInt(query.limit);
      if (isNaN(limit) || limit < 1 || limit > 1000) {
        throw new ValidationError(
          'Limit must be between 1 and 1000',
          'limit',
          'INVALID_RANGE'
        );
      }
    }

    if (query.offset !== undefined) {
      const offset = parseInt(query.offset);
      if (isNaN(offset) || offset < 0) {
        throw new ValidationError(
          'Offset must be a non-negative number',
          'offset',
          'INVALID_VALUE'
        );
      }
    }

    // Validate search term
    if (query.search !== undefined) {
      if (typeof query.search !== 'string' || query.search.trim().length < 1) {
        throw new ValidationError(
          'Search term must be a non-empty string',
          'search',
          'INVALID_VALUE'
        );
      }
      if (query.search.length > 100) {
        throw new ValidationError(
          'Search term cannot exceed 100 characters',
          'search',
          'TOO_LONG'
        );
      }
    }

    // Validate role filter
    if (query.role !== undefined) {
      if (!Object.values(UserRole).includes(query.role)) {
        throw new ValidationError(
          `Invalid role: ${query.role}`,
          'role',
          'INVALID_ENUM'
        );
      }
    }

    // Validate boolean filters
    if (query.is_active !== undefined) {
      this.validateBoolean(query.is_active, 'is_active');
    }
    if (query.is_email_verified !== undefined) {
      this.validateBoolean(query.is_email_verified, 'is_email_verified');
    }
    if (query.include_deleted !== undefined) {
      this.validateBoolean(query.include_deleted, 'include_deleted');
    }

    // Validate date filters
    if (query.created_since !== undefined) {
      this.validateDateString(query.created_since, 'created_since');
    }
    if (query.last_login_since !== undefined) {
      this.validateDateString(query.last_login_since, 'last_login_since');
    }

    // Validate sort parameters
    if (query.sort_by !== undefined) {
      const validSortFields = [
        'created_at', 'updated_at', 'last_login_at', 
        'email', 'first_name', 'last_name'
      ];
      if (!validSortFields.includes(query.sort_by)) {
        throw new ValidationError(
          `Invalid sort field: ${query.sort_by}`,
          'sort_by',
          'INVALID_ENUM'
        );
      }
    }

    if (query.sort_order !== undefined) {
      if (!['ASC', 'DESC'].includes(query.sort_order)) {
        throw new ValidationError(
          'Sort order must be ASC or DESC',
          'sort_order',
          'INVALID_ENUM'
        );
      }
    }
  }

  /**
   * Validate activate user request
   */
  static validateActivateUser(request: FastifyRequest): void {
    const body = request.body as any;

    // Validate is_active field
    if (typeof body.is_active !== 'boolean') {
      throw new ValidationError(
        'is_active must be a boolean value',
        'is_active',
        'INVALID_TYPE'
      );
    }

    // Validate reason if provided
    if (body.reason !== undefined) {
      if (typeof body.reason !== 'string') {
        throw new ValidationError(
          'Reason must be a string',
          'reason',
          'INVALID_TYPE'
        );
      }
      if (body.reason.length > 500) {
        throw new ValidationError(
          'Reason cannot exceed 500 characters',
          'reason',
          'TOO_LONG'
        );
      }
    }
  }

  /**
   * Validate bulk user operation request
   */
  static validateBulkUserOperation(request: FastifyRequest): void {
    const body = request.body as any;

    // Validate user_ids array
    if (!Array.isArray(body.user_ids)) {
      throw new ValidationError(
        'user_ids must be an array',
        'user_ids',
        'INVALID_TYPE'
      );
    }

    if (body.user_ids.length === 0) {
      throw new ValidationError(
        'user_ids array cannot be empty',
        'user_ids',
        'EMPTY_ARRAY'
      );
    }

    if (body.user_ids.length > 100) {
      throw new ValidationError(
        'Cannot perform bulk operation on more than 100 users at once',
        'user_ids',
        'TOO_MANY_ITEMS'
      );
    }

    // Validate each user ID
    body.user_ids.forEach((id: any, index: number) => {
      if (typeof id !== 'string' || !id.trim()) {
        throw new ValidationError(
          `Invalid user ID at index ${index}`,
          'user_ids',
          'INVALID_ID'
        );
      }
    });

    // Check for duplicates
    const uniqueIds = new Set(body.user_ids);
    if (uniqueIds.size !== body.user_ids.length) {
      throw new ValidationError(
        'Duplicate user IDs are not allowed',
        'user_ids',
        'DUPLICATE_VALUES'
      );
    }

    // Validate operation
    const validOperations = ['activate', 'deactivate', 'delete', 'verify_email'];
    if (!validOperations.includes(body.operation)) {
      throw new ValidationError(
        `Invalid operation: ${body.operation}`,
        'operation',
        'INVALID_ENUM'
      );
    }

    // Validate reason if provided
    if (body.reason !== undefined) {
      if (typeof body.reason !== 'string') {
        throw new ValidationError(
          'Reason must be a string',
          'reason',
          'INVALID_TYPE'
        );
      }
      if (body.reason.length > 500) {
        throw new ValidationError(
          'Reason cannot exceed 500 characters',
          'reason',
          'TOO_LONG'
        );
      }
    }
  }

  /**
   * Validate invite user request
   */
  static async validateInviteUser(
    request: FastifyRequest,
    tenantId: string
  ): Promise<void> {
    const body = request.body as any;

    // Validate email
    await this.validateEmail(body.email, tenantId);

    // Validate names
    this.validateName(body.first_name, 'first_name');
    this.validateName(body.last_name, 'last_name');

    // Validate role
    this.validateUserRole(body.role, request.user?.role);

    // Validate message if provided
    if (body.message !== undefined) {
      if (typeof body.message !== 'string') {
        throw new ValidationError(
          'Message must be a string',
          'message',
          'INVALID_TYPE'
        );
      }
      if (body.message.length > 1000) {
        throw new ValidationError(
          'Message cannot exceed 1000 characters',
          'message',
          'TOO_LONG'
        );
      }
    }

    // Validate expiration days
    if (body.expires_in_days !== undefined) {
      if (!Number.isInteger(body.expires_in_days) || 
          body.expires_in_days < 1 || 
          body.expires_in_days > 30) {
        throw new ValidationError(
          'Expiration days must be between 1 and 30',
          'expires_in_days',
          'INVALID_RANGE'
        );
      }
    }
  }

  /**
   * Validate email address and check for duplicates
   */
  private static async validateEmail(
    email: string, 
    tenantId: string, 
    excludeUserId?: string
  ): Promise<void> {
    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new ValidationError(
        'Invalid email address format',
        'email',
        'INVALID_FORMAT'
      );
    }

    // Email length validation
    if (email.length > 255) {
      throw new ValidationError(
        'Email address cannot exceed 255 characters',
        'email',
        'TOO_LONG'
      );
    }

    // Check for duplicates
    try {
      const exists = await userRepository.emailExists(email, tenantId, excludeUserId);
      if (exists) {
        throw new ValidationError(
          'Email address already exists in this tenant',
          'email',
          'DUPLICATE_VALUE'
        );
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      logger.error('Failed to validate email uniqueness', { email, tenantId, error });
      throw new ValidationError(
        'Unable to validate email uniqueness',
        'email',
        'VALIDATION_ERROR'
      );
    }
  }

  /**
   * Validate phone number and check for duplicates
   */
  private static async validatePhone(
    phone: string, 
    tenantId: string, 
    excludeUserId?: string
  ): Promise<void> {
    if (!phone) return; // Phone is optional

    // International phone number format validation
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    if (!phoneRegex.test(phone)) {
      throw new ValidationError(
        'Invalid phone number format. Use international format (e.g., +1234567890)',
        'phone',
        'INVALID_FORMAT'
      );
    }

    // Check for duplicates
    try {
      const exists = await userRepository.phoneExists(phone, tenantId, excludeUserId);
      if (exists) {
        throw new ValidationError(
          'Phone number already exists in this tenant',
          'phone',
          'DUPLICATE_VALUE'
        );
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      logger.error('Failed to validate phone uniqueness', { phone, tenantId, error });
      throw new ValidationError(
        'Unable to validate phone uniqueness',
        'phone',
        'VALIDATION_ERROR'
      );
    }
  }

  /**
   * Validate password against policy
   */
  private static validatePassword(password: string): void {
    const validation = validatePassword(password, DEFAULT_PASSWORD_POLICY);
    if (!validation.isValid) {
      throw new ValidationError(
        `Password policy violation: ${validation.errors.join(', ')}`,
        'password',
        'POLICY_VIOLATION'
      );
    }
  }

  /**
   * Validate user role and permissions
   */
  private static validateUserRole(
    targetRole: UserRole, 
    userRole?: UserRole
  ): void {
    // Validate role exists
    if (!Object.values(UserRole).includes(targetRole)) {
      throw new ValidationError(
        `Invalid role: ${targetRole}`,
        'role',
        'INVALID_ENUM'
      );
    }

    // Role hierarchy validation
    if (userRole) {
      const canAssignRole = this.canAssignRole(userRole, targetRole);
      if (!canAssignRole) {
        throw new ValidationError(
          `Cannot assign role ${targetRole}. Insufficient privileges.`,
          'role',
          'INSUFFICIENT_PRIVILEGES'
        );
      }
    }
  }

  /**
   * Validate role change permissions
   */
  private static async validateRoleChange(
    userId: string,
    newRole: UserRole,
    tenantId: string,
    userRole?: UserRole
  ): Promise<void> {
    if (!userRole) return;

    try {
      // Get current user to check existing role
      const currentUser = await userRepository.findById(userId, tenantId);
      if (!currentUser) {
        throw new ValidationError(
          'User not found',
          'user_id',
          'NOT_FOUND'
        );
      }

      // Cannot modify users with equal or higher roles (except super admin)
      if (userRole !== UserRole.SUPER_ADMIN) {
        const canModify = this.canModifyRole(userRole, currentUser.role);
        if (!canModify) {
          throw new ValidationError(
            'Cannot modify user with equal or higher role',
            'role',
            'INSUFFICIENT_PRIVILEGES'
          );
        }
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      logger.error('Failed to validate role change', { userId, newRole, tenantId, error });
      throw new ValidationError(
        'Unable to validate role change',
        'role',
        'VALIDATION_ERROR'
      );
    }
  }

  /**
   * Validate name fields
   */
  private static validateName(name: string, field: string): void {
    if (!name || !name.trim()) {
      throw new ValidationError(
        `${field} cannot be empty`,
        field,
        'REQUIRED'
      );
    }

    if (name.length > 100) {
      throw new ValidationError(
        `${field} cannot exceed 100 characters`,
        field,
        'TOO_LONG'
      );
    }

    // Check for invalid characters
    const nameRegex = /^[a-zA-Z\s\-'.]+$/;
    if (!nameRegex.test(name)) {
      throw new ValidationError(
        `${field} contains invalid characters`,
        field,
        'INVALID_CHARACTERS'
      );
    }
  }

  /**
   * Validate user preferences object
   */
  private static validatePreferences(preferences: any): void {
    if (preferences === null || preferences === undefined) {
      return; // Null/undefined is allowed
    }

    if (typeof preferences !== 'object' || Array.isArray(preferences)) {
      throw new ValidationError(
        'Preferences must be an object',
        'preferences',
        'INVALID_TYPE'
      );
    }

    // Validate preferences size (JSON serialized)
    try {
      const serialized = JSON.stringify(preferences);
      if (serialized.length > 10000) { // 10KB limit
        throw new ValidationError(
          'Preferences object is too large (max 10KB)',
          'preferences',
          'TOO_LARGE'
        );
      }
    } catch (error) {
      throw new ValidationError(
        'Preferences object is not JSON serializable',
        'preferences',
        'NOT_SERIALIZABLE'
      );
    }

    // Validate preference keys
    Object.keys(preferences).forEach(key => {
      if (key.length > 50) {
        throw new ValidationError(
          `Preference key "${key}" is too long (max 50 characters)`,
          'preferences',
          'KEY_TOO_LONG'
        );
      }
      if (!/^[a-zA-Z0-9_.-]+$/.test(key)) {
        throw new ValidationError(
          `Preference key "${key}" contains invalid characters`,
          'preferences',
          'INVALID_KEY'
        );
      }
    });
  }

  /**
   * Validate version for optimistic locking
   */
  private static validateVersion(version: any): void {
    if (!Number.isInteger(version) || version < 1) {
      throw new ValidationError(
        'Version must be a positive integer',
        'version',
        'INVALID_VALUE'
      );
    }
  }

  /**
   * Validate boolean values
   */
  private static validateBoolean(value: any, field: string): void {
    if (typeof value === 'string') {
      if (!['true', 'false'].includes(value.toLowerCase())) {
        throw new ValidationError(
          `${field} must be a boolean value`,
          field,
          'INVALID_TYPE'
        );
      }
    } else if (typeof value !== 'boolean') {
      throw new ValidationError(
        `${field} must be a boolean value`,
        field,
        'INVALID_TYPE'
      );
    }
  }

  /**
   * Validate date string format
   */
  private static validateDateString(dateString: string, field: string): void {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      throw new ValidationError(
        `${field} must be a valid ISO date string`,
        field,
        'INVALID_DATE'
      );
    }

    // Check if date is not too far in the future
    const maxFutureDate = new Date();
    maxFutureDate.setFullYear(maxFutureDate.getFullYear() + 1);
    if (date > maxFutureDate) {
      throw new ValidationError(
        `${field} cannot be more than 1 year in the future`,
        field,
        'DATE_TOO_FAR'
      );
    }
  }

  /**
   * Check if a role can assign another role
   */
  private static canAssignRole(assignerRole: UserRole, targetRole: UserRole): boolean {
    const roleHierarchy = {
      [UserRole.SUPER_ADMIN]: 5,
      [UserRole.TENANT_ADMIN]: 4,
      [UserRole.MANAGER]: 3,
      [UserRole.STAFF]: 2,
      [UserRole.CUSTOMER]: 1
    };

    return roleHierarchy[assignerRole] > roleHierarchy[targetRole];
  }

  /**
   * Check if a role can modify another role
   */
  private static canModifyRole(modifierRole: UserRole, targetRole: UserRole): boolean {
    const roleHierarchy = {
      [UserRole.SUPER_ADMIN]: 5,
      [UserRole.TENANT_ADMIN]: 4,
      [UserRole.MANAGER]: 3,
      [UserRole.STAFF]: 2,
      [UserRole.CUSTOMER]: 1
    };

    return roleHierarchy[modifierRole] > roleHierarchy[targetRole];
  }
}

/**
 * Pre-validation hook for request body validation
 */
export const validateRequestBody = (schema: any) => {
  return async (request: FastifyRequest): Promise<void> => {
    try {
      // TypeBox validation is handled by Fastify automatically
      // This is for additional custom validation
    } catch (error) {
      logger.error('Request body validation failed', {
        url: request.url,
        method: request.method,
        error
      });
      throw new ValidationError(
        'Invalid request body',
        undefined,
        'VALIDATION_ERROR'
      );
    }
  };
};

/**
 * Error handler for validation errors
 */
export const handleValidationError = (error: ValidationError) => {
  return {
    error: error.code || 'VALIDATION_ERROR',
    message: error.message,
    field: error.field
  };
};

/**
 * Schema validation schemas for FastifyTypeProvider
 */
export const UserValidationSchemas = {
  CreateUser: {
    body: CreateUserRequestSchema
  },
  UpdateUser: {
    body: UpdateUserRequestSchema
  },
  ChangePassword: {
    body: ChangePasswordRequestSchema
  },
  ResetPassword: {
    body: ResetPasswordRequestSchema
  },
  UserListQuery: {
    querystring: UserListQuerySchema
  },
  ActivateUser: {
    body: ActivateUserRequestSchema
  },
  BulkUserOperation: {
    body: BulkUserOperationSchema
  },
  InviteUser: {
    body: InviteUserRequestSchema
  },
  UpdateProfile: {
    body: UpdateProfileRequestSchema
  }
};

export { UserValidator };