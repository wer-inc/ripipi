import { Type, Static } from '@sinclair/typebox';

/**
 * User roles for role-based access control
 */
export enum UserRole {
  SUPER_ADMIN = 'super_admin',
  TENANT_ADMIN = 'tenant_admin', 
  MANAGER = 'manager',
  STAFF = 'staff',
  CUSTOMER = 'customer'
}

/**
 * Permission types
 */
export enum Permission {
  // Booking permissions
  BOOKING_CREATE = 'booking:create',
  BOOKING_READ = 'booking:read',
  BOOKING_UPDATE = 'booking:update',
  BOOKING_DELETE = 'booking:delete',
  
  // Service permissions
  SERVICE_CREATE = 'service:create',
  SERVICE_READ = 'service:read',
  SERVICE_UPDATE = 'service:update',
  SERVICE_DELETE = 'service:delete',
  
  // Resource permissions
  RESOURCE_CREATE = 'resource:create',
  RESOURCE_READ = 'resource:read',
  RESOURCE_UPDATE = 'resource:update',
  RESOURCE_DELETE = 'resource:delete',
  
  // User permissions
  USER_CREATE = 'user:create',
  USER_READ = 'user:read',
  USER_UPDATE = 'user:update',
  USER_DELETE = 'user:delete',
  
  // Admin permissions
  TENANT_MANAGE = 'tenant:manage',
  SETTINGS_MANAGE = 'settings:manage',
  ANALYTICS_VIEW = 'analytics:view'
}

/**
 * JWT Token payload schema
 */
export const TokenPayloadSchema = Type.Object({
  sub: Type.String({ description: 'User ID' }),
  tenant_id: Type.String({ description: 'Tenant ID' }),
  role: Type.Enum(UserRole, { description: 'User role' }),
  permissions: Type.Array(Type.Enum(Permission), { description: 'User permissions' }),
  iat: Type.Number({ description: 'Issued at timestamp' }),
  exp: Type.Number({ description: 'Expiration timestamp' }),
  type: Type.Union([
    Type.Literal('access'),
    Type.Literal('refresh')
  ], { description: 'Token type' })
});

export type TokenPayload = Static<typeof TokenPayloadSchema>;

/**
 * Login request schema
 */
export const LoginRequestSchema = Type.Object({
  email: Type.String({ 
    format: 'email',
    description: 'User email address'
  }),
  password: Type.String({ 
    minLength: 8,
    description: 'User password (minimum 8 characters)'
  }),
  tenant_id: Type.Optional(Type.String({ 
    description: 'Tenant ID (optional for multi-tenant login)'
  })),
  remember_me: Type.Optional(Type.Boolean({
    description: 'Whether to extend refresh token lifetime'
  }))
});

export type LoginRequest = Static<typeof LoginRequestSchema>;

/**
 * Login response schema
 */
export const LoginResponseSchema = Type.Object({
  access_token: Type.String({ description: 'JWT access token' }),
  refresh_token: Type.String({ description: 'JWT refresh token' }),
  expires_in: Type.Number({ description: 'Access token expiration in seconds' }),
  token_type: Type.Literal('Bearer', { description: 'Token type' }),
  user: Type.Object({
    id: Type.String({ description: 'User ID' }),
    email: Type.String({ description: 'User email' }),
    first_name: Type.String({ description: 'User first name' }),
    last_name: Type.String({ description: 'User last name' }),
    role: Type.Enum(UserRole, { description: 'User role' }),
    tenant_id: Type.String({ description: 'Tenant ID' }),
    tenant_name: Type.String({ description: 'Tenant name' }),
    last_login_at: Type.Optional(Type.String({ format: 'date-time' }))
  })
});

export type LoginResponse = Static<typeof LoginResponseSchema>;

/**
 * Refresh token request schema
 */
export const RefreshTokenRequestSchema = Type.Object({
  refresh_token: Type.String({ description: 'Refresh token' })
});

export type RefreshTokenRequest = Static<typeof RefreshTokenRequestSchema>;

/**
 * Refresh token response schema
 */
export const RefreshTokenResponseSchema = Type.Object({
  access_token: Type.String({ description: 'New JWT access token' }),
  refresh_token: Type.String({ description: 'New JWT refresh token' }),
  expires_in: Type.Number({ description: 'Access token expiration in seconds' }),
  token_type: Type.Literal('Bearer', { description: 'Token type' })
});

export type RefreshTokenResponse = Static<typeof RefreshTokenResponseSchema>;

/**
 * Logout request schema
 */
export const LogoutRequestSchema = Type.Object({
  refresh_token: Type.Optional(Type.String({ 
    description: 'Refresh token to invalidate'
  })),
  all_devices: Type.Optional(Type.Boolean({
    description: 'Logout from all devices'
  }))
});

export type LogoutRequest = Static<typeof LogoutRequestSchema>;

/**
 * User session information
 */
export const UserSessionSchema = Type.Object({
  id: Type.String({ description: 'Session ID' }),
  user_id: Type.String({ description: 'User ID' }),
  tenant_id: Type.String({ description: 'Tenant ID' }),
  refresh_token_hash: Type.String({ description: 'Hashed refresh token' }),
  ip_address: Type.Optional(Type.String({ description: 'Client IP address' })),
  user_agent: Type.Optional(Type.String({ description: 'Client user agent' })),
  last_activity: Type.String({ format: 'date-time', description: 'Last activity timestamp' }),
  expires_at: Type.String({ format: 'date-time', description: 'Session expiration' }),
  created_at: Type.String({ format: 'date-time', description: 'Session creation timestamp' }),
  is_active: Type.Boolean({ description: 'Whether session is active' })
});

export type UserSession = Static<typeof UserSessionSchema>;

/**
 * Current user response schema (for /auth/me endpoint)
 */
export const CurrentUserResponseSchema = Type.Object({
  user: Type.Object({
    id: Type.String({ description: 'User ID' }),
    email: Type.String({ description: 'User email' }),
    first_name: Type.String({ description: 'User first name' }),
    last_name: Type.String({ description: 'User last name' }),
    role: Type.Enum(UserRole, { description: 'User role' }),
    tenant_id: Type.String({ description: 'Tenant ID' }),
    tenant_name: Type.String({ description: 'Tenant name' }),
    permissions: Type.Array(Type.Enum(Permission), { description: 'User permissions' }),
    last_login_at: Type.Optional(Type.String({ format: 'date-time' })),
    created_at: Type.String({ format: 'date-time' }),
    updated_at: Type.String({ format: 'date-time' })
  }),
  session: Type.Object({
    id: Type.String({ description: 'Session ID' }),
    last_activity: Type.String({ format: 'date-time' }),
    expires_at: Type.String({ format: 'date-time' })
  })
});

export type CurrentUserResponse = Static<typeof CurrentUserResponseSchema>;

/**
 * Authentication error types
 */
export enum AuthError {
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  ACCOUNT_DISABLED = 'ACCOUNT_DISABLED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  REFRESH_TOKEN_INVALID = 'REFRESH_TOKEN_INVALID',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  TENANT_NOT_FOUND = 'TENANT_NOT_FOUND',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  PASSWORD_POLICY_VIOLATION = 'PASSWORD_POLICY_VIOLATION'
}

/**
 * Password policy configuration
 */
export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSymbols: boolean;
  disallowCommonPasswords: boolean;
  maxAge: number; // days
}

/**
 * Authentication configuration
 */
export interface AuthConfig {
  accessTokenExpiresIn: string; // e.g., '15m'
  refreshTokenExpiresIn: string; // e.g., '7d'
  rememberMeExpiresIn: string; // e.g., '30d'
  maxLoginAttempts: number;
  lockoutDuration: number; // minutes
  passwordPolicy: PasswordPolicy;
  requireEmailVerification: boolean;
  enableTwoFactor: boolean;
}

/**
 * Role-based access control matrix
 */
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.SUPER_ADMIN]: [
    // All permissions
    ...Object.values(Permission)
  ],
  [UserRole.TENANT_ADMIN]: [
    Permission.BOOKING_CREATE,
    Permission.BOOKING_READ,
    Permission.BOOKING_UPDATE,
    Permission.BOOKING_DELETE,
    Permission.SERVICE_CREATE,
    Permission.SERVICE_READ,
    Permission.SERVICE_UPDATE,
    Permission.SERVICE_DELETE,
    Permission.RESOURCE_CREATE,
    Permission.RESOURCE_READ,
    Permission.RESOURCE_UPDATE,
    Permission.RESOURCE_DELETE,
    Permission.USER_CREATE,
    Permission.USER_READ,
    Permission.USER_UPDATE,
    Permission.USER_DELETE,
    Permission.SETTINGS_MANAGE,
    Permission.ANALYTICS_VIEW
  ],
  [UserRole.MANAGER]: [
    Permission.BOOKING_CREATE,
    Permission.BOOKING_READ,
    Permission.BOOKING_UPDATE,
    Permission.SERVICE_READ,
    Permission.SERVICE_UPDATE,
    Permission.RESOURCE_READ,
    Permission.RESOURCE_UPDATE,
    Permission.USER_READ,
    Permission.ANALYTICS_VIEW
  ],
  [UserRole.STAFF]: [
    Permission.BOOKING_CREATE,
    Permission.BOOKING_READ,
    Permission.BOOKING_UPDATE,
    Permission.SERVICE_READ,
    Permission.RESOURCE_READ
  ],
  [UserRole.CUSTOMER]: [
    Permission.BOOKING_CREATE,
    Permission.BOOKING_READ
  ]
};

/**
 * JWT token types
 */
export enum TokenType {
  ACCESS = 'access',
  REFRESH = 'refresh'
}

/**
 * Authentication context for request handlers
 */
export interface AuthContext {
  user: {
    id: string;
    email: string;
    role: UserRole;
    tenant_id: string;
    permissions: Permission[];
  };
  session: {
    id: string;
    expires_at: Date;
  };
  token: {
    type: TokenType;
    expires_at: Date;
  };
}