import { Type, Static } from '@sinclair/typebox';
import { UserRole } from './auth.js';
import { BaseEntity } from './database.js';

/**
 * User entity interface extending base entity
 */
export interface User extends BaseEntity {
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  phone?: string;
  role: UserRole;
  is_active: boolean;
  is_email_verified: boolean;
  email_verified_at?: Date;
  last_login_at?: Date;
  password_changed_at?: Date;
  failed_login_attempts: number;
  locked_until?: Date;
  preferences?: Record<string, any>;
  deleted_at?: Date;
  version: number;
}

/**
 * User create request schema
 */
export const CreateUserRequestSchema = Type.Object({
  email: Type.String({ 
    format: 'email',
    description: 'User email address'
  }),
  password: Type.String({ 
    minLength: 8,
    description: 'User password (minimum 8 characters)'
  }),
  first_name: Type.String({ 
    minLength: 1,
    maxLength: 100,
    description: 'User first name'
  }),
  last_name: Type.String({ 
    minLength: 1,
    maxLength: 100,
    description: 'User last name'
  }),
  phone: Type.Optional(Type.String({ 
    pattern: '^\\+?[1-9]\\d{1,14}$',
    description: 'Phone number in international format'
  })),
  role: Type.Enum(UserRole, { 
    description: 'User role within the tenant'
  }),
  send_welcome_email: Type.Optional(Type.Boolean({
    default: true,
    description: 'Whether to send welcome email to new user'
  })),
  preferences: Type.Optional(Type.Record(Type.String(), Type.Any(), {
    description: 'User preferences object'
  }))
});

export type CreateUserRequest = Static<typeof CreateUserRequestSchema>;

/**
 * User update request schema
 */
export const UpdateUserRequestSchema = Type.Object({
  first_name: Type.Optional(Type.String({ 
    minLength: 1,
    maxLength: 100,
    description: 'User first name'
  })),
  last_name: Type.Optional(Type.String({ 
    minLength: 1,
    maxLength: 100,
    description: 'User last name'
  })),
  phone: Type.Optional(Type.Union([
    Type.String({ 
      pattern: '^\\+?[1-9]\\d{1,14}$',
      description: 'Phone number in international format'
    }),
    Type.Null()
  ])),
  role: Type.Optional(Type.Enum(UserRole, { 
    description: 'User role within the tenant'
  })),
  is_active: Type.Optional(Type.Boolean({
    description: 'Whether user account is active'
  })),
  preferences: Type.Optional(Type.Record(Type.String(), Type.Any(), {
    description: 'User preferences object'
  })),
  version: Type.Optional(Type.Number({
    description: 'Version for optimistic locking'
  }))
});

export type UpdateUserRequest = Static<typeof UpdateUserRequestSchema>;

/**
 * Change password request schema
 */
export const ChangePasswordRequestSchema = Type.Object({
  current_password: Type.String({ 
    minLength: 1,
    description: 'Current password for verification'
  }),
  new_password: Type.String({ 
    minLength: 8,
    description: 'New password (minimum 8 characters)'
  }),
  confirm_password: Type.String({ 
    minLength: 8,
    description: 'Confirmation of new password'
  })
});

export type ChangePasswordRequest = Static<typeof ChangePasswordRequestSchema>;

/**
 * Reset password request schema
 */
export const ResetPasswordRequestSchema = Type.Object({
  new_password: Type.String({ 
    minLength: 8,
    description: 'New password (minimum 8 characters)'
  }),
  confirm_password: Type.String({ 
    minLength: 8,
    description: 'Confirmation of new password'
  }),
  force_change: Type.Optional(Type.Boolean({
    default: false,
    description: 'Force user to change password on next login'
  }))
});

export type ResetPasswordRequest = Static<typeof ResetPasswordRequestSchema>;

/**
 * User response schema (excludes sensitive fields)
 */
export const UserResponseSchema = Type.Object({
  id: Type.String({ description: 'User ID' }),
  email: Type.String({ description: 'User email address' }),
  first_name: Type.String({ description: 'User first name' }),
  last_name: Type.String({ description: 'User last name' }),
  phone: Type.Optional(Type.String({ description: 'User phone number' })),
  role: Type.Enum(UserRole, { description: 'User role' }),
  tenant_id: Type.String({ description: 'Tenant ID' }),
  is_active: Type.Boolean({ description: 'Whether user is active' }),
  is_email_verified: Type.Boolean({ description: 'Whether email is verified' }),
  email_verified_at: Type.Optional(Type.String({ 
    format: 'date-time',
    description: 'Email verification timestamp'
  })),
  last_login_at: Type.Optional(Type.String({ 
    format: 'date-time',
    description: 'Last login timestamp'
  })),
  password_changed_at: Type.Optional(Type.String({ 
    format: 'date-time',
    description: 'Password last changed timestamp'
  })),
  failed_login_attempts: Type.Number({ 
    description: 'Number of failed login attempts'
  }),
  locked_until: Type.Optional(Type.String({ 
    format: 'date-time',
    description: 'Account locked until timestamp'
  })),
  preferences: Type.Optional(Type.Record(Type.String(), Type.Any(), {
    description: 'User preferences'
  })),
  created_at: Type.String({ 
    format: 'date-time',
    description: 'Creation timestamp'
  }),
  updated_at: Type.String({ 
    format: 'date-time',
    description: 'Last update timestamp'
  }),
  created_by: Type.Optional(Type.String({ 
    description: 'ID of user who created this user'
  })),
  updated_by: Type.Optional(Type.String({ 
    description: 'ID of user who last updated this user'
  })),
  version: Type.Number({ description: 'Version for optimistic locking' })
});

export type UserResponse = Static<typeof UserResponseSchema>;

/**
 * User list query parameters schema
 */
export const UserListQuerySchema = Type.Object({
  limit: Type.Optional(Type.Number({ 
    minimum: 1, 
    maximum: 1000, 
    default: 50,
    description: 'Number of users to return'
  })),
  offset: Type.Optional(Type.Number({ 
    minimum: 0, 
    default: 0,
    description: 'Number of users to skip'
  })),
  search: Type.Optional(Type.String({ 
    minLength: 1,
    description: 'Search term for name or email'
  })),
  role: Type.Optional(Type.Enum(UserRole, { 
    description: 'Filter by user role'
  })),
  is_active: Type.Optional(Type.Boolean({
    description: 'Filter by active status'
  })),
  is_email_verified: Type.Optional(Type.Boolean({
    description: 'Filter by email verification status'
  })),
  created_since: Type.Optional(Type.String({ 
    format: 'date-time',
    description: 'Filter users created since this date'
  })),
  last_login_since: Type.Optional(Type.String({ 
    format: 'date-time',
    description: 'Filter users who logged in since this date'
  })),
  sort_by: Type.Optional(Type.Union([
    Type.Literal('created_at'),
    Type.Literal('updated_at'),
    Type.Literal('last_login_at'),
    Type.Literal('email'),
    Type.Literal('first_name'),
    Type.Literal('last_name')
  ], { 
    default: 'created_at',
    description: 'Field to sort by'
  })),
  sort_order: Type.Optional(Type.Union([
    Type.Literal('ASC'),
    Type.Literal('DESC')
  ], { 
    default: 'DESC',
    description: 'Sort order'
  })),
  include_deleted: Type.Optional(Type.Boolean({
    default: false,
    description: 'Include soft-deleted users'
  }))
});

export type UserListQuery = Static<typeof UserListQuerySchema>;

/**
 * User list response schema
 */
export const UserListResponseSchema = Type.Object({
  data: Type.Array(UserResponseSchema, { 
    description: 'Array of users'
  }),
  total: Type.Number({ 
    description: 'Total number of users matching the query'
  }),
  limit: Type.Number({ 
    description: 'Number of users returned'
  }),
  offset: Type.Number({ 
    description: 'Number of users skipped'
  }),
  hasMore: Type.Boolean({ 
    description: 'Whether there are more users to fetch'
  })
});

export type UserListResponse = Static<typeof UserListResponseSchema>;

/**
 * User activation request schema
 */
export const ActivateUserRequestSchema = Type.Object({
  is_active: Type.Boolean({
    description: 'Whether to activate or deactivate the user'
  }),
  reason: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 500,
    description: 'Reason for activation/deactivation'
  }))
});

export type ActivateUserRequest = Static<typeof ActivateUserRequestSchema>;

/**
 * User bulk operation request schemas
 */
export const BulkUserOperationSchema = Type.Object({
  user_ids: Type.Array(Type.String(), {
    minItems: 1,
    maxItems: 100,
    description: 'Array of user IDs to operate on'
  }),
  operation: Type.Union([
    Type.Literal('activate'),
    Type.Literal('deactivate'),
    Type.Literal('delete'),
    Type.Literal('verify_email')
  ], {
    description: 'Bulk operation to perform'
  }),
  reason: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 500,
    description: 'Reason for the bulk operation'
  }))
});

export type BulkUserOperation = Static<typeof BulkUserOperationSchema>;

/**
 * User activity log entry
 */
export const UserActivityLogSchema = Type.Object({
  id: Type.String({ description: 'Activity log entry ID' }),
  user_id: Type.String({ description: 'User ID' }),
  tenant_id: Type.String({ description: 'Tenant ID' }),
  action: Type.String({ description: 'Action performed' }),
  resource: Type.Optional(Type.String({ description: 'Resource affected' })),
  resource_id: Type.Optional(Type.String({ description: 'Resource ID' })),
  ip_address: Type.Optional(Type.String({ description: 'Client IP address' })),
  user_agent: Type.Optional(Type.String({ description: 'Client user agent' })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Any(), {
    description: 'Additional metadata'
  })),
  created_at: Type.String({ 
    format: 'date-time',
    description: 'Activity timestamp'
  })
});

export type UserActivityLog = Static<typeof UserActivityLogSchema>;

/**
 * User session information
 */
export const UserSessionInfoSchema = Type.Object({
  id: Type.String({ description: 'Session ID' }),
  ip_address: Type.Optional(Type.String({ description: 'Client IP address' })),
  user_agent: Type.Optional(Type.String({ description: 'Client user agent' })),
  last_activity: Type.String({ 
    format: 'date-time',
    description: 'Last activity timestamp'
  }),
  expires_at: Type.String({ 
    format: 'date-time',
    description: 'Session expiration'
  }),
  created_at: Type.String({ 
    format: 'date-time',
    description: 'Session creation timestamp'
  }),
  is_current: Type.Boolean({ 
    description: 'Whether this is the current session'
  })
});

export type UserSessionInfo = Static<typeof UserSessionInfoSchema>;

/**
 * User profile update request (for self-service)
 */
export const UpdateProfileRequestSchema = Type.Object({
  first_name: Type.Optional(Type.String({ 
    minLength: 1,
    maxLength: 100,
    description: 'User first name'
  })),
  last_name: Type.Optional(Type.String({ 
    minLength: 1,
    maxLength: 100,
    description: 'User last name'
  })),
  phone: Type.Optional(Type.Union([
    Type.String({ 
      pattern: '^\\+?[1-9]\\d{1,14}$',
      description: 'Phone number in international format'
    }),
    Type.Null()
  ])),
  preferences: Type.Optional(Type.Record(Type.String(), Type.Any(), {
    description: 'User preferences object'
  }))
});

export type UpdateProfileRequest = Static<typeof UpdateProfileRequestSchema>;

/**
 * User invite request schema
 */
export const InviteUserRequestSchema = Type.Object({
  email: Type.String({ 
    format: 'email',
    description: 'Email address to invite'
  }),
  first_name: Type.String({ 
    minLength: 1,
    maxLength: 100,
    description: 'User first name'
  }),
  last_name: Type.String({ 
    minLength: 1,
    maxLength: 100,
    description: 'User last name'
  }),
  role: Type.Enum(UserRole, { 
    description: 'Role to assign to the invited user'
  }),
  message: Type.Optional(Type.String({
    maxLength: 1000,
    description: 'Personal message to include in invitation'
  })),
  expires_in_days: Type.Optional(Type.Number({
    minimum: 1,
    maximum: 30,
    default: 7,
    description: 'Number of days until invitation expires'
  }))
});

export type InviteUserRequest = Static<typeof InviteUserRequestSchema>;

/**
 * User statistics response
 */
export const UserStatsResponseSchema = Type.Object({
  total_users: Type.Number({ description: 'Total number of users' }),
  active_users: Type.Number({ description: 'Number of active users' }),
  inactive_users: Type.Number({ description: 'Number of inactive users' }),
  unverified_users: Type.Number({ description: 'Number of unverified users' }),
  locked_users: Type.Number({ description: 'Number of locked users' }),
  users_by_role: Type.Record(Type.String(), Type.Number(), {
    description: 'User count by role'
  }),
  new_users_last_30_days: Type.Number({ 
    description: 'New users in last 30 days'
  }),
  active_sessions: Type.Number({ 
    description: 'Number of active user sessions'
  })
});

export type UserStatsResponse = Static<typeof UserStatsResponseSchema>;

/**
 * Export error types for user operations
 */
export enum UserError {
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  EMAIL_ALREADY_EXISTS = 'EMAIL_ALREADY_EXISTS',
  PHONE_ALREADY_EXISTS = 'PHONE_ALREADY_EXISTS',
  INVALID_PASSWORD = 'INVALID_PASSWORD',
  PASSWORD_MISMATCH = 'PASSWORD_MISMATCH',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  ACCOUNT_INACTIVE = 'ACCOUNT_INACTIVE',
  EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  CANNOT_DELETE_SELF = 'CANNOT_DELETE_SELF',
  CANNOT_MODIFY_HIGHER_ROLE = 'CANNOT_MODIFY_HIGHER_ROLE',
  ROLE_PERMISSION_DENIED = 'ROLE_PERMISSION_DENIED',
  INVITATION_EXPIRED = 'INVITATION_EXPIRED',
  INVITATION_ALREADY_USED = 'INVITATION_ALREADY_USED',
  TOO_MANY_FAILED_ATTEMPTS = 'TOO_MANY_FAILED_ATTEMPTS'
}