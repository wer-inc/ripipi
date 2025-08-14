import { FastifyRequest, FastifyReply } from 'fastify';
import { 
  UserRole, 
  Permission, 
  AuthContext 
} from '../types/auth.js';
import { 
  requireAuth,
  optionalAuth,
  publicEndpoint 
} from '../middleware/auth.js';
import { 
  createRBACMiddleware,
  requireRole,
  requirePermission,
  requireAllPermissions 
} from '../middleware/rbac.js';

/**
 * Metadata storage for decorator information
 */
const METADATA_KEYS = {
  AUTH_REQUIRED: 'auth:required',
  ROLES: 'auth:roles',
  PERMISSIONS: 'auth:permissions',
  TENANT_REQUIRED: 'auth:tenant_required',
  PUBLIC_ROUTE: 'auth:public_route',
  OWNERSHIP_CHECK: 'auth:ownership_check'
} as const;

/**
 * Route metadata storage
 */
const routeMetadata = new Map<string, any>();

/**
 * Store metadata for a route handler
 */
function setMetadata(target: any, propertyKey: string, key: string, value: any): void {
  const methodKey = `${target.constructor.name}.${propertyKey}`;
  if (!routeMetadata.has(methodKey)) {
    routeMetadata.set(methodKey, {});
  }
  const metadata = routeMetadata.get(methodKey);
  metadata[key] = value;
}

/**
 * Get metadata for a route handler
 */
function getMetadata(target: any, propertyKey: string, key: string): any {
  const methodKey = `${target.constructor.name}.${propertyKey}`;
  const metadata = routeMetadata.get(methodKey);
  return metadata ? metadata[key] : undefined;
}

/**
 * @RequireAuth - Require authentication for this route
 * 
 * @param options Authentication options
 */
export function RequireAuth(options: {
  allowCookie?: boolean;
  strict?: boolean;
} = {}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    // Store metadata
    setMetadata(target, propertyKey, METADATA_KEYS.AUTH_REQUIRED, true);

    descriptor.value = async function (...args: any[]) {
      const request = args[0] as FastifyRequest;
      const reply = args[1] as FastifyReply;

      // Apply authentication middleware
      if (options.strict) {
        await import('../middleware/auth.js').then(({ strictAuth }) => 
          strictAuth(request, reply)
        );
      } else if (options.allowCookie) {
        await import('../middleware/auth.js').then(({ cookieAuth }) => 
          cookieAuth(request, reply)
        );
      } else {
        await requireAuth(request, reply);
      }

      // Check if reply was already sent (authentication failed)
      if (reply.sent) {
        return;
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * @RequireRole - Require specific role(s) for this route
 * 
 * @param roles Required roles (single role or array of roles)
 */
export function RequireRole(roles: UserRole | UserRole[]) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const roleArray = Array.isArray(roles) ? roles : [roles];

    // Store metadata
    setMetadata(target, propertyKey, METADATA_KEYS.ROLES, roleArray);

    descriptor.value = async function (...args: any[]) {
      const request = args[0] as FastifyRequest;
      const reply = args[1] as FastifyReply;

      // Apply authentication first
      await requireAuth(request, reply);
      if (reply.sent) return;

      // Apply role-based authorization
      await requireRole(roleArray)(request, reply);
      if (reply.sent) return;

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * @RequirePermission - Require specific permission(s) for this route
 * 
 * @param permissions Required permissions
 * @param requireAll Whether all permissions are required (default: false - any permission)
 */
export function RequirePermission(
  permissions: Permission | Permission[],
  requireAll: boolean = false
) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const permissionArray = Array.isArray(permissions) ? permissions : [permissions];

    // Store metadata
    setMetadata(target, propertyKey, METADATA_KEYS.PERMISSIONS, {
      permissions: permissionArray,
      requireAll
    });

    descriptor.value = async function (...args: any[]) {
      const request = args[0] as FastifyRequest;
      const reply = args[1] as FastifyReply;

      // Apply authentication first
      await requireAuth(request, reply);
      if (reply.sent) return;

      // Apply permission-based authorization
      if (requireAll) {
        await requireAllPermissions(permissionArray)(request, reply);
      } else {
        await requirePermission(permissionArray)(request, reply);
      }
      if (reply.sent) return;

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * @RequireTenant - Require valid tenant context for this route
 * 
 * @param options Tenant validation options
 */
export function RequireTenant(options: {
  allowedTenants?: string[];
  strict?: boolean;
} = {}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    // Store metadata
    setMetadata(target, propertyKey, METADATA_KEYS.TENANT_REQUIRED, options);

    descriptor.value = async function (...args: any[]) {
      const request = args[0] as FastifyRequest;
      const reply = args[1] as FastifyReply;

      // Apply authentication first
      await requireAuth(request, reply);
      if (reply.sent) return;

      // Validate tenant context
      if (!request.user?.tenant_id) {
        return reply.code(400).send({
          error: 'TENANT_REQUIRED',
          message: 'Valid tenant context is required for this endpoint'
        });
      }

      // Check allowed tenants if specified
      if (options.allowedTenants && options.allowedTenants.length > 0) {
        if (!options.allowedTenants.includes(request.user.tenant_id)) {
          return reply.code(403).send({
            error: 'TENANT_NOT_ALLOWED',
            message: `Tenant '${request.user.tenant_id}' is not allowed to access this resource`,
            allowed_tenants: options.allowedTenants
          });
        }
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * @PublicRoute - Mark route as public (no authentication required)
 * 
 * @param options Public route options
 */
export function PublicRoute(options: {
  extractUser?: boolean; // Extract user info if token is provided
  securityHeaders?: boolean; // Apply security headers (default: true)
} = {}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const { extractUser = true, securityHeaders = true } = options;

    // Store metadata
    setMetadata(target, propertyKey, METADATA_KEYS.PUBLIC_ROUTE, options);

    descriptor.value = async function (...args: any[]) {
      const request = args[0] as FastifyRequest;
      const reply = args[1] as FastifyReply;

      if (extractUser) {
        // Try to extract user context if token is provided
        await optionalAuth(request, reply);
      } else if (securityHeaders) {
        // Apply security headers only
        await publicEndpoint(request, reply);
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * @RequireOwnership - Require resource ownership or admin privileges
 * 
 * @param options Ownership check options
 */
export function RequireOwnership(options: {
  resourceIdParam?: string;
  resourceType?: string;
  allowAdmin?: boolean;
  allowTenantAdmin?: boolean;
  customCheck?: (request: FastifyRequest) => Promise<boolean>;
}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const {
      resourceIdParam = 'id',
      resourceType = 'resource',
      allowAdmin = true,
      allowTenantAdmin = true,
      customCheck
    } = options;

    // Store metadata
    setMetadata(target, propertyKey, METADATA_KEYS.OWNERSHIP_CHECK, options);

    descriptor.value = async function (...args: any[]) {
      const request = args[0] as FastifyRequest;
      const reply = args[1] as FastifyReply;

      // Apply authentication first
      await requireAuth(request, reply);
      if (reply.sent) return;

      const user = request.user!;
      
      // Admin override
      if (allowAdmin && user.role === UserRole.SUPER_ADMIN) {
        return originalMethod.apply(this, args);
      }

      if (allowTenantAdmin && user.role === UserRole.TENANT_ADMIN) {
        return originalMethod.apply(this, args);
      }

      // Custom ownership check
      if (customCheck) {
        const hasAccess = await customCheck(request);
        if (!hasAccess) {
          return reply.code(403).send({
            error: 'ACCESS_DENIED',
            message: 'You do not have permission to access this resource'
          });
        }
        return originalMethod.apply(this, args);
      }

      // Default ownership check - resource belongs to user's tenant
      const params = request.params as Record<string, string>;
      const resourceId = params[resourceIdParam];

      if (!resourceId) {
        return reply.code(400).send({
          error: 'RESOURCE_ID_REQUIRED',
          message: `Resource ID parameter '${resourceIdParam}' is required`
        });
      }

      // Import and use ownership check from RBAC middleware
      const { canAccessResource } = await import('../middleware/rbac.js');
      const hasAccess = await canAccessResource(
        user,
        resourceType,
        resourceId,
        Permission.BOOKING_READ // Default permission for ownership check
      );

      if (!hasAccess) {
        return reply.code(403).send({
          error: 'RESOURCE_ACCESS_DENIED',
          message: 'You do not have permission to access this resource'
        });
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * @AdminOnly - Require admin privileges (tenant admin or super admin)
 */
export function AdminOnly(options: {
  superAdminOnly?: boolean;
} = {}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const { superAdminOnly = false } = options;

    if (superAdminOnly) {
      return RequireRole(UserRole.SUPER_ADMIN)(target, propertyKey, descriptor);
    } else {
      return RequireRole([UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN])(
        target, 
        propertyKey, 
        descriptor
      );
    }
  };
}

/**
 * @ManagerOrHigher - Require manager level access or higher
 */
export function ManagerOrHigher() {
  return RequireRole([
    UserRole.MANAGER,
    UserRole.TENANT_ADMIN,
    UserRole.SUPER_ADMIN
  ]);
}

/**
 * @StaffOrHigher - Require staff level access or higher
 */
export function StaffOrHigher() {
  return RequireRole([
    UserRole.STAFF,
    UserRole.MANAGER,
    UserRole.TENANT_ADMIN,
    UserRole.SUPER_ADMIN
  ]);
}

/**
 * @RateLimited - Apply rate limiting to this route
 * 
 * @param options Rate limiting options
 */
export function RateLimited(options: {
  maxRequests?: number;
  windowMs?: number;
  skipAuthenticated?: boolean;
} = {}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const {
      maxRequests = 10,
      windowMs = 60 * 1000, // 1 minute
      skipAuthenticated = true
    } = options;

    // Simple in-memory rate limiting store
    const requestCounts = new Map<string, { count: number; resetTime: number }>();

    descriptor.value = async function (...args: any[]) {
      const request = args[0] as FastifyRequest;
      const reply = args[1] as FastifyReply;

      // Skip rate limiting for authenticated users if configured
      if (skipAuthenticated && request.user) {
        return originalMethod.apply(this, args);
      }

      const clientIdentifier = request.user?.id || request.ip || 'anonymous';
      const now = Date.now();
      const requestData = requestCounts.get(clientIdentifier);

      if (!requestData || now > requestData.resetTime) {
        // New or expired window
        requestCounts.set(clientIdentifier, {
          count: 1,
          resetTime: now + windowMs
        });
      } else if (requestData.count >= maxRequests) {
        // Rate limit exceeded
        return reply.code(429).send({
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
          retryAfter: Math.ceil((requestData.resetTime - now) / 1000)
        });
      } else {
        // Increment counter
        requestData.count++;
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * @AuditLog - Log access to this route for audit purposes
 * 
 * @param options Audit logging options
 */
export function AuditLog(options: {
  action?: string;
  resourceType?: string;
  sensitiveData?: boolean;
} = {}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const {
      action = propertyKey,
      resourceType = 'unknown',
      sensitiveData = false
    } = options;

    descriptor.value = async function (...args: any[]) {
      const request = args[0] as FastifyRequest;
      const reply = args[1] as FastifyReply;

      // Log the access attempt
      const logData = {
        action,
        resourceType,
        userId: request.user?.id,
        tenantId: request.user?.tenant_id,
        userRole: request.user?.role,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
        url: request.url,
        method: request.method,
        timestamp: new Date().toISOString()
      };

      // Add request parameters if not sensitive
      if (!sensitiveData) {
        (logData as any).params = request.params;
        (logData as any).query = request.query;
      }

      request.server.log.info('Audit log', logData);

      try {
        const result = await originalMethod.apply(this, args);
        
        // Log successful completion
        request.server.log.info('Audit log - Success', {
          ...logData,
          success: true
        });

        return result;
      } catch (error) {
        // Log error
        request.server.log.error('Audit log - Error', {
          ...logData,
          success: false,
          error: error.message
        });
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Utility functions for working with decorator metadata
 */
export const DecoratorUtils = {
  /**
   * Get route metadata
   */
  getRouteMetadata: (target: any, propertyKey: string) => {
    const methodKey = `${target.constructor.name}.${propertyKey}`;
    return routeMetadata.get(methodKey) || {};
  },

  /**
   * Check if route requires authentication
   */
  requiresAuth: (target: any, propertyKey: string): boolean => {
    return getMetadata(target, propertyKey, METADATA_KEYS.AUTH_REQUIRED) === true;
  },

  /**
   * Check if route is public
   */
  isPublicRoute: (target: any, propertyKey: string): boolean => {
    return getMetadata(target, propertyKey, METADATA_KEYS.PUBLIC_ROUTE) !== undefined;
  },

  /**
   * Get required roles for route
   */
  getRequiredRoles: (target: any, propertyKey: string): UserRole[] => {
    return getMetadata(target, propertyKey, METADATA_KEYS.ROLES) || [];
  },

  /**
   * Get required permissions for route
   */
  getRequiredPermissions: (target: any, propertyKey: string): {
    permissions: Permission[];
    requireAll: boolean;
  } => {
    return getMetadata(target, propertyKey, METADATA_KEYS.PERMISSIONS) || {
      permissions: [],
      requireAll: false
    };
  }
};

/**
 * Export all decorators
 */
export {
  RequireAuth,
  RequireRole,
  RequirePermission,
  RequireTenant,
  PublicRoute,
  RequireOwnership,
  AdminOnly,
  ManagerOrHigher,
  StaffOrHigher,
  RateLimited,
  AuditLog
};