import { FastifyRequest, FastifyReply } from 'fastify';
import { verify } from 'jsonwebtoken';
import { config } from '../config/index.js';
import { logger } from '../config/logger.js';
import { TenantContext } from '../types/database.js';

/**
 * Extended FastifyRequest with tenant context
 */
declare module 'fastify' {
  interface FastifyRequest {
    tenant?: TenantContext;
  }
}

/**
 * JWT payload interface
 */
interface JWTPayload {
  userId: string;
  tenantId: string;
  permissions?: string[];
  exp?: number;
  iat?: number;
}

/**
 * Tenant extraction strategies
 */
export enum TenantExtractionStrategy {
  HEADER = 'header',              // X-Tenant-ID header
  JWT = 'jwt',                   // Extract from JWT token
  SUBDOMAIN = 'subdomain',       // Extract from subdomain
  PATH = 'path',                 // Extract from URL path
  QUERY = 'query'                // Extract from query parameter
}

/**
 * Tenant middleware options
 */
export interface TenantMiddlewareOptions {
  strategy: TenantExtractionStrategy;
  required?: boolean;
  headerName?: string;
  queryParam?: string;
  pathPosition?: number;
  jwtSecret?: string;
  allowedTenants?: string[];
  defaultTenant?: string;
}

/**
 * Tenant validation error
 */
export class TenantValidationError extends Error {
  constructor(message: string, public readonly code: string = 'TENANT_VALIDATION_ERROR') {
    super(message);
    this.name = 'TenantValidationError';
  }
}

/**
 * Tenant middleware factory
 */
export function createTenantMiddleware(options: TenantMiddlewareOptions) {
  return async function tenantMiddleware(request: FastifyRequest, reply: FastifyReply) {
    try {
      const tenantContext = await extractTenantContext(request, options);
      
      // Validate tenant if required
      if (options.required && !tenantContext.tenantId) {
        throw new TenantValidationError('Tenant ID is required');
      }

      // Validate against allowed tenants
      if (tenantContext.tenantId && options.allowedTenants && options.allowedTenants.length > 0) {
        if (!options.allowedTenants.includes(tenantContext.tenantId)) {
          throw new TenantValidationError(`Tenant '${tenantContext.tenantId}' is not allowed`);
        }
      }

      // Set tenant context on request
      request.tenant = tenantContext;

      logger.debug('Tenant context extracted', {
        tenantId: tenantContext.tenantId,
        userId: tenantContext.userId,
        strategy: options.strategy,
        url: request.url
      });

    } catch (error) {
      logger.error('Tenant middleware error', {
        error: error.message,
        strategy: options.strategy,
        url: request.url
      });

      if (error instanceof TenantValidationError) {
        return reply.status(400).send({
          error: 'Tenant Validation Error',
          message: error.message,
          code: error.code
        });
      }

      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to process tenant information'
      });
    }
  };
}

/**
 * Extract tenant context based on strategy
 */
async function extractTenantContext(
  request: FastifyRequest,
  options: TenantMiddlewareOptions
): Promise<TenantContext> {
  let tenantId: string | undefined;
  let userId: string | undefined;
  let permissions: string[] | undefined;

  switch (options.strategy) {
    case TenantExtractionStrategy.HEADER:
      tenantId = extractFromHeader(request, options.headerName || 'x-tenant-id');
      break;

    case TenantExtractionStrategy.JWT:
      const jwtResult = await extractFromJWT(request, options.jwtSecret || config.JWT_SECRET);
      tenantId = jwtResult.tenantId;
      userId = jwtResult.userId;
      permissions = jwtResult.permissions;
      break;

    case TenantExtractionStrategy.SUBDOMAIN:
      tenantId = extractFromSubdomain(request);
      break;

    case TenantExtractionStrategy.PATH:
      tenantId = extractFromPath(request, options.pathPosition || 1);
      break;

    case TenantExtractionStrategy.QUERY:
      tenantId = extractFromQuery(request, options.queryParam || 'tenant');
      break;

    default:
      throw new TenantValidationError(`Unknown tenant extraction strategy: ${options.strategy}`);
  }

  // Use default tenant if none found and default is specified
  if (!tenantId && options.defaultTenant) {
    tenantId = options.defaultTenant;
  }

  return {
    tenantId: tenantId || '',
    userId,
    permissions
  };
}

/**
 * Extract tenant ID from header
 */
function extractFromHeader(request: FastifyRequest, headerName: string): string | undefined {
  const value = request.headers[headerName.toLowerCase()];
  
  if (Array.isArray(value)) {
    return value[0];
  }
  
  return typeof value === 'string' ? value : undefined;
}

/**
 * Extract tenant context from JWT token
 */
async function extractFromJWT(request: FastifyRequest, jwtSecret: string): Promise<{
  tenantId?: string;
  userId?: string;
  permissions?: string[];
}> {
  const authHeader = request.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {};
  }

  const token = authHeader.substring(7);
  
  try {
    const payload = verify(token, jwtSecret) as JWTPayload;
    
    return {
      tenantId: payload.tenantId,
      userId: payload.userId,
      permissions: payload.permissions
    };
  } catch (error) {
    logger.warn('Failed to verify JWT token', { error: error.message });
    return {};
  }
}

/**
 * Extract tenant ID from subdomain
 */
function extractFromSubdomain(request: FastifyRequest): string | undefined {
  const host = request.headers.host;
  
  if (!host) {
    return undefined;
  }

  // Extract subdomain (assuming format: tenant.domain.com)
  const parts = host.split('.');
  
  if (parts.length >= 3) {
    const subdomain = parts[0];
    
    // Filter out common non-tenant subdomains
    const excludedSubdomains = ['www', 'api', 'admin', 'app', 'staging', 'dev'];
    
    if (!excludedSubdomains.includes(subdomain.toLowerCase())) {
      return subdomain;
    }
  }

  return undefined;
}

/**
 * Extract tenant ID from URL path
 */
function extractFromPath(request: FastifyRequest, position: number): string | undefined {
  const pathSegments = request.url.split('/').filter(segment => segment.length > 0);
  
  if (pathSegments.length > position - 1) {
    return pathSegments[position - 1];
  }

  return undefined;
}

/**
 * Extract tenant ID from query parameter
 */
function extractFromQuery(request: FastifyRequest, paramName: string): string | undefined {
  const query = request.query as Record<string, any>;
  const value = query[paramName];
  
  return typeof value === 'string' ? value : undefined;
}

/**
 * Multi-strategy tenant middleware
 * Tries multiple strategies in order until one succeeds
 */
export function createMultiStrategyTenantMiddleware(
  strategies: Array<{ strategy: TenantExtractionStrategy; options?: Partial<TenantMiddlewareOptions> }>,
  baseOptions: Partial<TenantMiddlewareOptions> = {}
) {
  return async function multiStrategyTenantMiddleware(request: FastifyRequest, reply: FastifyReply) {
    let tenantContext: TenantContext | null = null;
    let lastError: Error | null = null;

    // Try each strategy in order
    for (const { strategy, options = {} } of strategies) {
      try {
        const strategyOptions: TenantMiddlewareOptions = {
          ...baseOptions,
          ...options,
          strategy,
          required: false // Don't fail on individual strategies
        };

        const context = await extractTenantContext(request, strategyOptions);
        
        if (context.tenantId) {
          tenantContext = context;
          break;
        }
      } catch (error) {
        lastError = error as Error;
        logger.debug(`Tenant extraction failed for strategy ${strategy}`, { error: error.message });
      }
    }

    // Check if tenant is required
    if (baseOptions.required && (!tenantContext || !tenantContext.tenantId)) {
      logger.error('Failed to extract tenant from all strategies', { lastError });
      return reply.status(400).send({
        error: 'Tenant Required',
        message: 'Unable to determine tenant from request',
        strategies: strategies.map(s => s.strategy)
      });
    }

    // Set tenant context (may be empty if not required)
    request.tenant = tenantContext || { tenantId: '' };

    logger.debug('Multi-strategy tenant extraction completed', {
      tenantId: request.tenant.tenantId,
      userId: request.tenant.userId,
      url: request.url
    });
  };
}

/**
 * Tenant validation decorator for route handlers
 */
export function requireTenant(allowedTenants?: string[]) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const request = args[0] as FastifyRequest;
      const reply = args[1] as FastifyReply;

      if (!request.tenant || !request.tenant.tenantId) {
        return reply.status(400).send({
          error: 'Tenant Required',
          message: 'This endpoint requires a valid tenant context'
        });
      }

      if (allowedTenants && !allowedTenants.includes(request.tenant.tenantId)) {
        return reply.status(403).send({
          error: 'Tenant Forbidden',
          message: `Tenant '${request.tenant.tenantId}' is not allowed to access this resource`
        });
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * Get tenant context from request
 */
export function getTenantContext(request: FastifyRequest): TenantContext {
  if (!request.tenant) {
    throw new TenantValidationError('Tenant context not available. Ensure tenant middleware is configured.');
  }
  return request.tenant;
}

/**
 * Validate tenant permissions
 */
export function hasPermission(context: TenantContext, requiredPermission: string): boolean {
  if (!context.permissions) {
    return false;
  }
  
  return context.permissions.includes(requiredPermission) || context.permissions.includes('*');
}

/**
 * Permission validation decorator
 */
export function requirePermission(permission: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const request = args[0] as FastifyRequest;
      const reply = args[1] as FastifyReply;

      const tenantContext = getTenantContext(request);
      
      if (!hasPermission(tenantContext, permission)) {
        return reply.status(403).send({
          error: 'Permission Denied',
          message: `Required permission '${permission}' not found`,
          requiredPermission: permission,
          userPermissions: tenantContext.permissions || []
        });
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * Common tenant middleware configurations
 */
export const CommonTenantConfigurations = {
  /**
   * Header-based tenant identification (most common for APIs)
   */
  headerBased: createTenantMiddleware({
    strategy: TenantExtractionStrategy.HEADER,
    required: true,
    headerName: 'x-tenant-id'
  }),

  /**
   * JWT-based tenant identification with user context
   */
  jwtBased: createTenantMiddleware({
    strategy: TenantExtractionStrategy.JWT,
    required: true,
    jwtSecret: config.JWT_SECRET
  }),

  /**
   * Subdomain-based tenant identification
   */
  subdomainBased: createTenantMiddleware({
    strategy: TenantExtractionStrategy.SUBDOMAIN,
    required: false
  }),

  /**
   * Multi-strategy with fallback
   */
  multiStrategy: createMultiStrategyTenantMiddleware([
    { strategy: TenantExtractionStrategy.JWT },
    { strategy: TenantExtractionStrategy.HEADER, options: { headerName: 'x-tenant-id' } },
    { strategy: TenantExtractionStrategy.SUBDOMAIN }
  ], { required: true })
};

// Export everything
export {
  TenantExtractionStrategy,
  TenantValidationError,
  createTenantMiddleware,
  createMultiStrategyTenantMiddleware,
  requireTenant,
  getTenantContext,
  hasPermission,
  requirePermission,
  CommonTenantConfigurations
};