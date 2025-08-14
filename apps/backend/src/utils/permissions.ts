import { 
  UserRole, 
  Permission, 
  AuthContext,
  ROLE_PERMISSIONS 
} from '../types/auth.js';
import { db } from '../db/index.js';

/**
 * Permission cache configuration
 */
interface PermissionCacheConfig {
  enabled: boolean;
  ttl: number; // Time to live in milliseconds
  maxEntries: number;
}

/**
 * Cached permission entry
 */
interface CachedPermission {
  permissions: Permission[];
  expiresAt: number;
  tenantId: string;
  userId: string;
}

/**
 * Resource-based permission context
 */
export interface ResourcePermissionContext {
  resourceType: string;
  resourceId: string;
  action: Permission;
  userId: string;
  tenantId: string;
  userRole: UserRole;
  userPermissions: Permission[];
}

/**
 * Permission inheritance rule
 */
export interface PermissionInheritanceRule {
  fromRole: UserRole;
  toRole: UserRole;
  conditions?: (context: ResourcePermissionContext) => boolean;
}

/**
 * Global permission cache
 */
const permissionCache = new Map<string, CachedPermission>();

/**
 * Default cache configuration
 */
const DEFAULT_CACHE_CONFIG: PermissionCacheConfig = {
  enabled: true,
  ttl: 5 * 60 * 1000, // 5 minutes
  maxEntries: 1000
};

/**
 * Role hierarchy for permission inheritance
 * Higher roles inherit permissions from lower roles
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
 * Resource-specific permission rules
 */
const RESOURCE_PERMISSION_RULES: Record<string, {
  ownerPermissions: Permission[];
  tenantPermissions: Permission[];
  globalPermissions: Permission[];
}> = {
  booking: {
    ownerPermissions: [
      Permission.BOOKING_READ,
      Permission.BOOKING_UPDATE
    ],
    tenantPermissions: [
      Permission.BOOKING_READ,
      Permission.BOOKING_UPDATE,
      Permission.BOOKING_DELETE
    ],
    globalPermissions: [
      Permission.BOOKING_CREATE,
      Permission.BOOKING_READ,
      Permission.BOOKING_UPDATE,
      Permission.BOOKING_DELETE
    ]
  },
  service: {
    ownerPermissions: [
      Permission.SERVICE_READ
    ],
    tenantPermissions: [
      Permission.SERVICE_CREATE,
      Permission.SERVICE_READ,
      Permission.SERVICE_UPDATE,
      Permission.SERVICE_DELETE
    ],
    globalPermissions: [
      Permission.SERVICE_CREATE,
      Permission.SERVICE_READ,
      Permission.SERVICE_UPDATE,
      Permission.SERVICE_DELETE
    ]
  },
  user: {
    ownerPermissions: [
      Permission.USER_READ,
      Permission.USER_UPDATE
    ],
    tenantPermissions: [
      Permission.USER_CREATE,
      Permission.USER_READ,
      Permission.USER_UPDATE,
      Permission.USER_DELETE
    ],
    globalPermissions: [
      Permission.USER_CREATE,
      Permission.USER_READ,
      Permission.USER_UPDATE,
      Permission.USER_DELETE
    ]
  },
  customer: {
    ownerPermissions: [
      Permission.USER_READ,
      Permission.USER_UPDATE
    ],
    tenantPermissions: [
      Permission.USER_CREATE,
      Permission.USER_READ,
      Permission.USER_UPDATE,
      Permission.USER_DELETE
    ],
    globalPermissions: [
      Permission.USER_CREATE,
      Permission.USER_READ,
      Permission.USER_UPDATE,
      Permission.USER_DELETE
    ]
  }
};

/**
 * Get effective permissions for a user including inheritance
 */
export async function getEffectivePermissions(
  userId: string,
  tenantId: string,
  role: UserRole,
  cacheConfig: PermissionCacheConfig = DEFAULT_CACHE_CONFIG
): Promise<Permission[]> {
  const cacheKey = `${userId}:${tenantId}:${role}`;

  // Check cache first
  if (cacheConfig.enabled) {
    const cached = permissionCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.permissions;
    }
  }

  try {
    // Start with base role permissions
    let permissions = new Set<Permission>(ROLE_PERMISSIONS[role] || []);

    // Add inherited permissions from role hierarchy
    const inheritedRoles = ROLE_HIERARCHY[role] || [];
    for (const inheritedRole of inheritedRoles) {
      const inheritedPermissions = ROLE_PERMISSIONS[inheritedRole] || [];
      inheritedPermissions.forEach(permission => permissions.add(permission));
    }

    // Get dynamic permissions from database
    const dynamicPermissions = await getDynamicPermissions(userId, tenantId);
    dynamicPermissions.forEach(permission => permissions.add(permission));

    // Get tenant-specific permissions
    const tenantPermissions = await getTenantPermissions(userId, tenantId);
    tenantPermissions.forEach(permission => permissions.add(permission));

    const effectivePermissions = Array.from(permissions);

    // Cache the result
    if (cacheConfig.enabled) {
      cleanupCache(cacheConfig.maxEntries);
      permissionCache.set(cacheKey, {
        permissions: effectivePermissions,
        expiresAt: Date.now() + cacheConfig.ttl,
        tenantId,
        userId
      });
    }

    return effectivePermissions;

  } catch (error) {
    console.error('Error getting effective permissions:', error);
    // Fallback to base role permissions
    return ROLE_PERMISSIONS[role] || [];
  }
}

/**
 * Get dynamic permissions assigned to a user
 */
async function getDynamicPermissions(
  userId: string,
  tenantId: string
): Promise<Permission[]> {
  try {
    const result = await db.query(`
      SELECT DISTINCT permission_name
      FROM user_permissions up
      JOIN permissions p ON up.permission_id = p.id
      WHERE up.user_id = $1 AND up.tenant_id = $2 AND up.is_active = true
    `, [userId, tenantId]);

    return result.rows
      .map(row => row.permission_name as Permission)
      .filter(permission => Object.values(Permission).includes(permission));
  } catch (error) {
    console.error('Error fetching dynamic permissions:', error);
    return [];
  }
}

/**
 * Get tenant-specific permission overrides
 */
async function getTenantPermissions(
  userId: string,
  tenantId: string
): Promise<Permission[]> {
  try {
    const result = await db.query(`
      SELECT DISTINCT permission_name
      FROM tenant_user_permissions tup
      JOIN permissions p ON tup.permission_id = p.id
      WHERE tup.user_id = $1 AND tup.tenant_id = $2 AND tup.is_active = true
    `, [userId, tenantId]);

    return result.rows
      .map(row => row.permission_name as Permission)
      .filter(permission => Object.values(Permission).includes(permission));
  } catch (error) {
    console.error('Error fetching tenant permissions:', error);
    return [];
  }
}

/**
 * Check if user has permission for a specific resource
 */
export async function hasResourcePermission(
  context: ResourcePermissionContext
): Promise<boolean> {
  const {
    resourceType,
    resourceId,
    action,
    userId,
    tenantId,
    userRole,
    userPermissions
  } = context;

  try {
    // Super admin has all permissions
    if (userRole === UserRole.SUPER_ADMIN) {
      return true;
    }

    // Check if user has the permission globally
    if (userPermissions.includes(action)) {
      // Verify tenant boundary
      return await isResourceInTenant(resourceType, resourceId, tenantId);
    }

    // Check resource-specific permissions
    const resourceRules = RESOURCE_PERMISSION_RULES[resourceType];
    if (!resourceRules) {
      return false;
    }

    // Check if user is the resource owner
    if (resourceRules.ownerPermissions.includes(action)) {
      const isOwner = await isResourceOwner(resourceType, resourceId, userId);
      if (isOwner) {
        return true;
      }
    }

    // Check tenant-level permissions for tenant admin
    if (userRole === UserRole.TENANT_ADMIN && 
        resourceRules.tenantPermissions.includes(action)) {
      return await isResourceInTenant(resourceType, resourceId, tenantId);
    }

    return false;

  } catch (error) {
    console.error('Error checking resource permission:', error);
    return false;
  }
}

/**
 * Check if resource belongs to user's tenant
 */
async function isResourceInTenant(
  resourceType: string,
  resourceId: string,
  tenantId: string
): Promise<boolean> {
  try {
    const tableMap: Record<string, string> = {
      booking: 'bookings',
      service: 'services',
      user: 'users',
      customer: 'customers',
      resource: 'resources'
    };

    const tableName = tableMap[resourceType];
    if (!tableName) {
      return false;
    }

    const result = await db.query(
      `SELECT tenant_id FROM ${tableName} WHERE id = $1`,
      [resourceId]
    );

    return result.rows.length > 0 && result.rows[0].tenant_id === tenantId;

  } catch (error) {
    console.error('Error checking tenant boundary:', error);
    return false;
  }
}

/**
 * Check if user owns the resource
 */
async function isResourceOwner(
  resourceType: string,
  resourceId: string,
  userId: string
): Promise<boolean> {
  try {
    const ownershipQueries: Record<string, string> = {
      booking: 'SELECT user_id FROM bookings WHERE id = $1',
      customer: 'SELECT created_by FROM customers WHERE id = $1',
      user: 'SELECT id FROM users WHERE id = $1'
    };

    const query = ownershipQueries[resourceType];
    if (!query) {
      return false;
    }

    const result = await db.query(query, [resourceId]);
    
    if (result.rows.length === 0) {
      return false;
    }

    const ownerField = resourceType === 'customer' ? 'created_by' : 
                      resourceType === 'user' ? 'id' : 'user_id';
    
    return result.rows[0][ownerField] === userId;

  } catch (error) {
    console.error('Error checking resource ownership:', error);
    return false;
  }
}

/**
 * Validate tenant boundary for multi-tenant access
 */
export async function validateTenantBoundary(
  userId: string,
  requestedTenantId: string,
  userTenantId: string,
  userRole: UserRole
): Promise<boolean> {
  // Super admin can access any tenant
  if (userRole === UserRole.SUPER_ADMIN) {
    return true;
  }

  // Users can only access their own tenant
  if (requestedTenantId !== userTenantId) {
    return false;
  }

  // Validate tenant is active
  try {
    const result = await db.query(
      'SELECT is_active FROM tenants WHERE id = $1',
      [requestedTenantId]
    );

    return result.rows.length > 0 && result.rows[0].is_active;
  } catch (error) {
    console.error('Error validating tenant boundary:', error);
    return false;
  }
}

/**
 * Get permissions that can be delegated by a role
 */
export function getDelegatablePermissions(role: UserRole): Permission[] {
  const allPermissions = ROLE_PERMISSIONS[role] || [];
  
  // Define permissions that cannot be delegated
  const nonDelegatablePermissions: Permission[] = [
    Permission.TENANT_MANAGE,
    Permission.USER_DELETE // Sensitive permissions
  ];

  return allPermissions.filter(permission => 
    !nonDelegatablePermissions.includes(permission)
  );
}

/**
 * Check if role can delegate permission to another role
 */
export function canDelegatePermission(
  delegatorRole: UserRole,
  targetRole: UserRole,
  permission: Permission
): boolean {
  // Can only delegate to lower or equal roles
  const delegatorHierarchy = ROLE_HIERARCHY[delegatorRole] || [];
  if (!delegatorHierarchy.includes(targetRole)) {
    return false;
  }

  // Must have the permission to delegate it
  const delegatorPermissions = ROLE_PERMISSIONS[delegatorRole] || [];
  if (!delegatorPermissions.includes(permission)) {
    return false;
  }

  // Check if permission is delegatable
  const delegatablePermissions = getDelegatablePermissions(delegatorRole);
  return delegatablePermissions.includes(permission);
}

/**
 * Cache management utilities
 */

/**
 * Clear permission cache for user
 */
export function clearUserPermissionCache(userId: string, tenantId?: string): void {
  const keysToDelete: string[] = [];
  
  for (const [key, cached] of permissionCache.entries()) {
    if (cached.userId === userId && (!tenantId || cached.tenantId === tenantId)) {
      keysToDelete.push(key);
    }
  }
  
  keysToDelete.forEach(key => permissionCache.delete(key));
}

/**
 * Clear permission cache for tenant
 */
export function clearTenantPermissionCache(tenantId: string): void {
  const keysToDelete: string[] = [];
  
  for (const [key, cached] of permissionCache.entries()) {
    if (cached.tenantId === tenantId) {
      keysToDelete.push(key);
    }
  }
  
  keysToDelete.forEach(key => permissionCache.delete(key));
}

/**
 * Cleanup expired cache entries
 */
function cleanupCache(maxEntries: number): void {
  const now = Date.now();
  const keysToDelete: string[] = [];

  // Remove expired entries
  for (const [key, cached] of permissionCache.entries()) {
    if (cached.expiresAt <= now) {
      keysToDelete.push(key);
    }
  }

  keysToDelete.forEach(key => permissionCache.delete(key));

  // Remove oldest entries if over limit
  if (permissionCache.size > maxEntries) {
    const entries = Array.from(permissionCache.entries());
    entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    
    const entriesToRemove = entries.slice(0, permissionCache.size - maxEntries);
    entriesToRemove.forEach(([key]) => permissionCache.delete(key));
  }
}

/**
 * Get cache statistics
 */
export function getPermissionCacheStats(): {
  size: number;
  maxEntries: number;
  hitRate: number;
  expiredEntries: number;
} {
  const now = Date.now();
  let expiredEntries = 0;

  for (const cached of permissionCache.values()) {
    if (cached.expiresAt <= now) {
      expiredEntries++;
    }
  }

  return {
    size: permissionCache.size,
    maxEntries: DEFAULT_CACHE_CONFIG.maxEntries,
    hitRate: 0, // Would need to track hits/misses
    expiredEntries
  };
}

/**
 * Permission utility functions for common scenarios
 */

/**
 * Check if user can perform any of the specified actions
 */
export function hasAnyPermission(
  userPermissions: Permission[],
  requiredPermissions: Permission[]
): boolean {
  return requiredPermissions.some(permission => 
    userPermissions.includes(permission)
  );
}

/**
 * Check if user has all specified permissions
 */
export function hasAllPermissions(
  userPermissions: Permission[],
  requiredPermissions: Permission[]
): boolean {
  return requiredPermissions.every(permission => 
    userPermissions.includes(permission)
  );
}

/**
 * Get missing permissions from required set
 */
export function getMissingPermissions(
  userPermissions: Permission[],
  requiredPermissions: Permission[]
): Permission[] {
  return requiredPermissions.filter(permission => 
    !userPermissions.includes(permission)
  );
}

/**
 * Check if role has higher or equal privileges than another role
 */
export function hasHigherOrEqualRole(
  userRole: UserRole,
  requiredRole: UserRole
): boolean {
  const userHierarchy = ROLE_HIERARCHY[userRole] || [];
  return userHierarchy.includes(requiredRole);
}

/**
 * Export permission utilities
 */
export const PermissionUtils = {
  getEffectivePermissions,
  hasResourcePermission,
  validateTenantBoundary,
  getDelegatablePermissions,
  canDelegatePermission,
  clearUserPermissionCache,
  clearTenantPermissionCache,
  getPermissionCacheStats,
  hasAnyPermission,
  hasAllPermissions,
  getMissingPermissions,
  hasHigherOrEqualRole,
  ROLE_HIERARCHY,
  RESOURCE_PERMISSION_RULES
};