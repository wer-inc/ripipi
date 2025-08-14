import { FastifyRequest, FastifyReply } from 'fastify';
import { 
  UserRole, 
  Permission, 
  AuthContext,
  ROLE_PERMISSIONS 
} from '../types/auth.js';
import { 
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  getPermissionsForRole 
} from '../utils/auth.js';
import { db } from '../db/index.js';

/**
 * RBAC middleware options
 */
export interface RBACOptions {
  roles?: UserRole[];
  permissions?: Permission[];
  requireAll?: boolean; // For permissions: require all (AND) vs any (OR)
  allowOwner?: boolean; // Allow resource owner even without explicit permission
  allowTenantAdmin?: boolean; // Allow tenant admin override
  allowSuperAdmin?: boolean; // Allow super admin override
  resourceIdParam?: string; // Parameter name for resource ID
  ownershipCheck?: OwnershipCheckFunction;
}

/**
 * Function to check resource ownership
 */
export type OwnershipCheckFunction = (
  request: FastifyRequest,
  resourceId: string,
  userId: string,
  tenantId: string
) => Promise<boolean>;

/**
 * Built-in ownership checkers for common resources
 */
export const OwnershipCheckers = {
  /**
   * Check if user owns a booking
   */
  booking: async (
    request: FastifyRequest,
    bookingId: string,
    userId: string,
    tenantId: string
  ): Promise<boolean> => {
    try {
      const result = await db.query(
        `SELECT user_id FROM bookings 
         WHERE id = $1 AND tenant_id = $2 AND user_id = $3`,
        [bookingId, tenantId, userId]
      );
      return result.rows.length > 0;
    } catch {
      return false;
    }
  },

  /**
   * Check if user owns a customer record
   */
  customer: async (
    request: FastifyRequest,
    customerId: string,
    userId: string,
    tenantId: string
  ): Promise<boolean> => {
    try {
      const result = await db.query(
        `SELECT created_by FROM customers 
         WHERE id = $1 AND tenant_id = $2 AND created_by = $3`,
        [customerId, tenantId, userId]
      );
      return result.rows.length > 0;
    } catch {
      return false;
    }
  },

  /**
   * Check if user belongs to tenant
   */
  tenant: async (
    request: FastifyRequest,
    tenantId: string,
    userId: string,
    userTenantId: string
  ): Promise<boolean> => {
    return tenantId === userTenantId;
  },

  /**
   * Check if user can access another user's data
   */
  user: async (
    request: FastifyRequest,
    targetUserId: string,
    userId: string,
    tenantId: string
  ): Promise<boolean> => {
    // Users can access their own data
    if (targetUserId === userId) {
      return true;
    }

    // Check if target user is in same tenant
    try {
      const result = await db.query(
        `SELECT id FROM users 
         WHERE id = $1 AND tenant_id = $2`,
        [targetUserId, tenantId]
      );
      return result.rows.length > 0;
    } catch {
      return false;
    }
  }
};

/**
 * Role hierarchy for permission inheritance
 */
const ROLE_HIERARCHY: Record<UserRole, UserRole[]> = {
  [UserRole.SUPER_ADMIN]: [
    UserRole.SUPER_ADMIN,
    UserRole.TENANT_ADMIN,
    UserRole.MANAGER,
    UserRole.STAFF,
    UserRole.CUSTOMER
  ],
  [UserRole.TENANT_ADMIN]: [
    UserRole.TENANT_ADMIN,
    UserRole.MANAGER,
    UserRole.STAFF,
    UserRole.CUSTOMER
  ],
  [UserRole.MANAGER]: [
    UserRole.MANAGER,
    UserRole.STAFF,
    UserRole.CUSTOMER
  ],
  [UserRole.STAFF]: [
    UserRole.STAFF,
    UserRole.CUSTOMER
  ],
  [UserRole.CUSTOMER]: [
    UserRole.CUSTOMER
  ]
};

/**
 * Create RBAC middleware with specified options
 */
export function createRBACMiddleware(options: RBACOptions = {}) {
  const {
    roles = [],
    permissions = [],
    requireAll = false,
    allowOwner = false,
    allowTenantAdmin = true,
    allowSuperAdmin = true,
    resourceIdParam = 'id',
    ownershipCheck
  } = options;

  return async function rbacMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      // Ensure user is authenticated
      if (!request.user) {
        return reply.code(401).send({
          error: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required to access this resource'
        });
      }

      const user = request.user;
      const userRole = user.role;
      const userPermissions = user.permissions;
      const tenantId = user.tenant_id;

      // Log access attempt for audit
      request.server.log.info('RBAC access check', {
        userId: user.id,
        userRole,
        tenantId,
        requiredRoles: roles,
        requiredPermissions: permissions,
        url: request.url,
        method: request.method
      });

      // Super admin override (if enabled)
      if (allowSuperAdmin && userRole === UserRole.SUPER_ADMIN) {
        request.server.log.debug('Access granted: Super admin override', { userId: user.id });
        return;
      }

      // Tenant admin override (if enabled and same tenant)
      if (allowTenantAdmin && userRole === UserRole.TENANT_ADMIN && 
          await isWithinTenantBoundary(request, tenantId)) {
        request.server.log.debug('Access granted: Tenant admin override', { 
          userId: user.id, 
          tenantId 
        });
        return;
      }

      // Check role requirements
      if (roles.length > 0) {
        const hasRequiredRole = await checkRoleAccess(userRole, roles, user.id, tenantId);
        if (!hasRequiredRole) {
          return reply.code(403).send({
            error: 'INSUFFICIENT_ROLE',
            message: 'User role does not have access to this resource',
            required_roles: roles,
            user_role: userRole
          });
        }
      }

      // Check permission requirements
      if (permissions.length > 0) {
        const hasRequiredPermissions = requireAll 
          ? hasAllPermissions(userPermissions, permissions)
          : hasAnyPermission(userPermissions, permissions);

        if (!hasRequiredPermissions) {
          // Check if ownership allows access
          if (allowOwner && ownershipCheck) {
            const resourceId = getResourceId(request, resourceIdParam);
            if (resourceId) {
              const isOwner = await ownershipCheck(request, resourceId, user.id, tenantId);
              if (isOwner) {
                request.server.log.debug('Access granted: Resource ownership', { 
                  userId: user.id, 
                  resourceId,
                  tenantId 
                });
                return;
              }
            }
          }

          return reply.code(403).send({
            error: 'INSUFFICIENT_PERMISSIONS',
            message: 'User does not have required permissions for this resource',
            required_permissions: permissions,
            user_permissions: userPermissions,
            require_all: requireAll
          });
        }
      }

      // Check tenant boundary for resource access
      if (!(await isWithinTenantBoundary(request, tenantId))) {
        return reply.code(403).send({
          error: 'TENANT_BOUNDARY_VIOLATION',
          message: 'Access to resource outside tenant boundary is not allowed'
        });
      }

      request.server.log.debug('RBAC access granted', { 
        userId: user.id,
        userRole,
        tenantId,
        permissions: userPermissions
      });

    } catch (error) {
      request.server.log.error('RBAC middleware error', {
        error: error.message,
        userId: request.user?.id,
        tenantId: request.user?.tenant_id,
        url: request.url
      });

      return reply.code(500).send({
        error: 'AUTHORIZATION_ERROR',
        message: 'An error occurred during authorization'
      });
    }
  };
}

/**
 * Check if user role has access (considering hierarchy)
 */
async function checkRoleAccess(
  userRole: UserRole,
  requiredRoles: UserRole[],
  userId: string,
  tenantId: string
): Promise<boolean> {
  // Check direct role match
  if (requiredRoles.includes(userRole)) {
    return true;
  }

  // Check role hierarchy
  const allowedRoles = ROLE_HIERARCHY[userRole] || [];
  return requiredRoles.some(role => allowedRoles.includes(role));
}

/**
 * Extract resource ID from request parameters
 */
function getResourceId(request: FastifyRequest, paramName: string): string | null {
  const params = request.params as Record<string, string>;
  return params[paramName] || null;
}

/**
 * Check if request is within tenant boundary
 */
async function isWithinTenantBoundary(
  request: FastifyRequest,
  userTenantId: string
): Promise<boolean> {
  // Check if request contains tenant-specific data
  const params = request.params as Record<string, string>;
  const body = request.body as Record<string, any> || {};
  const query = request.query as Record<string, any> || {};

  // Extract tenant IDs from various sources
  const tenantIds = [
    params.tenantId,
    params.tenant_id,
    body.tenant_id,
    query.tenant_id,
    request.headers['x-tenant-id']
  ].filter(Boolean);

  // If no tenant ID in request, allow (will be validated by other middleware)
  if (tenantIds.length === 0) {
    return true;
  }

  // All tenant IDs in request must match user's tenant
  return tenantIds.every(id => id === userTenantId);
}

/**
 * Pre-configured RBAC middleware for common scenarios
 */

/**
 * Require specific role(s)
 */
export const requireRole = (roles: UserRole | UserRole[]) => 
  createRBACMiddleware({ 
    roles: Array.isArray(roles) ? roles : [roles] 
  });

/**
 * Require specific permission(s) - any permission matches
 */
export const requirePermission = (permissions: Permission | Permission[]) => 
  createRBACMiddleware({ 
    permissions: Array.isArray(permissions) ? permissions : [permissions],
    requireAll: false 
  });

/**
 * Require all specified permissions
 */
export const requireAllPermissions = (permissions: Permission[]) => 
  createRBACMiddleware({ 
    permissions,
    requireAll: true 
  });

/**
 * Admin-only access (tenant admin or super admin)
 */
export const adminOnly = createRBACMiddleware({
  roles: [UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN]
});

/**
 * Super admin only access
 */
export const superAdminOnly = createRBACMiddleware({
  roles: [UserRole.SUPER_ADMIN],
  allowTenantAdmin: false
});

/**
 * Manager or higher access
 */
export const managerOrHigher = createRBACMiddleware({
  roles: [UserRole.MANAGER, UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN]
});

/**
 * Staff or higher access
 */
export const staffOrHigher = createRBACMiddleware({
  roles: [UserRole.STAFF, UserRole.MANAGER, UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN]
});

/**
 * Resource owner or admin access
 */
export const ownerOrAdmin = (
  ownershipCheck: OwnershipCheckFunction,
  resourceIdParam: string = 'id'
) => createRBACMiddleware({
  allowOwner: true,
  allowTenantAdmin: true,
  ownershipCheck,
  resourceIdParam
});

/**
 * Booking access (owner, staff, or admin)
 */
export const bookingAccess = createRBACMiddleware({
  permissions: [Permission.BOOKING_READ],
  allowOwner: true,
  ownershipCheck: OwnershipCheckers.booking,
  resourceIdParam: 'bookingId'
});

/**
 * Customer data access
 */
export const customerAccess = createRBACMiddleware({
  permissions: [Permission.USER_READ],
  allowOwner: true,
  ownershipCheck: OwnershipCheckers.customer,
  resourceIdParam: 'customerId'
});

/**
 * Service management access
 */
export const serviceManagement = createRBACMiddleware({
  permissions: [Permission.SERVICE_CREATE, Permission.SERVICE_UPDATE, Permission.SERVICE_DELETE],
  requireAll: false,
  roles: [UserRole.MANAGER, UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN]
});

/**
 * Resource management access
 */
export const resourceManagement = createRBACMiddleware({
  permissions: [Permission.RESOURCE_CREATE, Permission.RESOURCE_UPDATE, Permission.RESOURCE_DELETE],
  requireAll: false,
  roles: [UserRole.MANAGER, UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN]
});

/**
 * User management access
 */
export const userManagement = createRBACMiddleware({
  permissions: [Permission.USER_CREATE, Permission.USER_UPDATE, Permission.USER_DELETE],
  requireAll: false,
  roles: [UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN]
});

/**
 * Analytics access
 */
export const analyticsAccess = createRBACMiddleware({
  permissions: [Permission.ANALYTICS_VIEW],
  roles: [UserRole.MANAGER, UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN]
});

/**
 * Settings management access
 */
export const settingsAccess = createRBACMiddleware({
  permissions: [Permission.SETTINGS_MANAGE],
  roles: [UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN]
});

/**
 * Tenant management access (super admin only)
 */
export const tenantManagement = createRBACMiddleware({
  permissions: [Permission.TENANT_MANAGE],
  roles: [UserRole.SUPER_ADMIN],
  allowTenantAdmin: false
});

/**
 * Utility function to check if user can perform action on resource
 */
export async function canAccessResource(
  user: AuthContext['user'],
  resourceType: string,
  resourceId: string,
  action: Permission
): Promise<boolean> {
  // Super admin can access everything
  if (user.role === UserRole.SUPER_ADMIN) {
    return true;
  }

  // Check if user has the required permission
  if (!user.permissions.includes(action)) {
    return false;
  }

  // Check tenant boundary
  try {
    switch (resourceType) {
      case 'booking':
        const bookingResult = await db.query(
          'SELECT tenant_id FROM bookings WHERE id = $1',
          [resourceId]
        );
        return bookingResult.rows[0]?.tenant_id === user.tenant_id;

      case 'service':
        const serviceResult = await db.query(
          'SELECT tenant_id FROM services WHERE id = $1',
          [resourceId]
        );
        return serviceResult.rows[0]?.tenant_id === user.tenant_id;

      case 'user':
        const userResult = await db.query(
          'SELECT tenant_id FROM users WHERE id = $1',
          [resourceId]
        );
        return userResult.rows[0]?.tenant_id === user.tenant_id;

      default:
        return false;
    }
  } catch {
    return false;
  }
}

/**
 * Export RBAC utilities
 */
export const rbacUtils = {
  checkRoleAccess,
  isWithinTenantBoundary,
  canAccessResource,
  ROLE_HIERARCHY,
  OwnershipCheckers
};