import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/index.js';
import { withTransaction, TransactionContext, TransactionError } from '../db/transaction.js';
import { logger } from '../config/logger.js';
import { getTenantContext, TenantValidationError } from '../middleware/tenant.js';
import { QueryPerformanceMonitor } from '../utils/db-helpers.js';

/**
 * Extended FastifyRequest with database context
 */
declare module 'fastify' {
  interface FastifyRequest {
    dbContext?: DatabaseRequestContext;
    transaction?: TransactionContext;
  }
}

/**
 * Database request context
 */
export interface DatabaseRequestContext {
  tenantId?: string;
  userId?: string;
  transactionId?: string;
  startTime: number;
  queryCount: number;
  permissions?: string[];
}

/**
 * Transaction configuration options
 */
export interface TransactionOptions {
  autoCommit?: boolean;
  isolationLevel?: 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
  readOnly?: boolean;
  timeout?: number;
}

/**
 * Hook options
 */
export interface DatabaseHookOptions {
  enableQueryMonitoring?: boolean;
  enableTransactionSupport?: boolean;
  enableTenantValidation?: boolean;
  queryTimeoutMs?: number;
  maxQueriesPerRequest?: number;
  enablePerformanceLogging?: boolean;
}

/**
 * Database hooks plugin for Fastify
 */
export async function databaseHooksPlugin(
  fastify: FastifyInstance,
  options: DatabaseHookOptions = {}
) {
  const {
    enableQueryMonitoring = true,
    enableTransactionSupport = true,
    enableTenantValidation = true,
    queryTimeoutMs = 30000,
    maxQueriesPerRequest = 100,
    enablePerformanceLogging = true
  } = options;

  // Store active transactions for cleanup
  const activeTransactions = new Map<string, TransactionContext>();

  /**
   * onRequest hook - Initialize database context
   */
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Initialize database context
      const dbContext: DatabaseRequestContext = {
        startTime: Date.now(),
        queryCount: 0
      };

      // Extract tenant information if available
      if (request.tenant) {
        dbContext.tenantId = request.tenant.tenantId;
        dbContext.userId = request.tenant.userId;
        dbContext.permissions = request.tenant.permissions;
      }

      request.dbContext = dbContext;

      if (enablePerformanceLogging) {
        logger.debug('Database request context initialized', {
          url: request.url,
          method: request.method,
          tenantId: dbContext.tenantId,
          userId: dbContext.userId
        });
      }

    } catch (error) {
      logger.error('Failed to initialize database context', {
        error: error.message,
        url: request.url
      });
      
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to initialize database context'
      });
    }
  });

  /**
   * preHandler hook - Setup transaction if needed and validate tenant
   */
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Validate tenant access if enabled
      if (enableTenantValidation && request.tenant) {
        await validateTenantAccess(request);
      }

      // Setup automatic transaction for write operations if enabled
      if (enableTransactionSupport && isWriteOperation(request)) {
        const transactionId = generateTransactionId();
        
        const transactionContext = await createRequestTransaction(request, {
          isolationLevel: 'READ COMMITTED',
          timeout: queryTimeoutMs
        });

        request.transaction = transactionContext;
        request.dbContext!.transactionId = transactionId;
        
        activeTransactions.set(transactionId, transactionContext);

        logger.debug('Transaction started for request', {
          transactionId,
          url: request.url,
          method: request.method,
          tenantId: request.dbContext?.tenantId
        });
      }

    } catch (error) {
      logger.error('PreHandler hook failed', {
        error: error.message,
        url: request.url,
        method: request.method
      });

      if (error instanceof TenantValidationError) {
        return reply.status(403).send({
          error: 'Tenant Access Denied',
          message: error.message
        });
      }

      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to setup database context'
      });
    }
  });

  /**
   * onSend hook - Commit/rollback transactions and log performance
   */
  fastify.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload) => {
    const dbContext = request.dbContext;
    if (!dbContext) return payload;

    const duration = Date.now() - dbContext.startTime;

    try {
      // Handle transaction completion
      if (request.transaction && dbContext.transactionId) {
        const isSuccessResponse = reply.statusCode < 400;
        
        if (isSuccessResponse) {
          await request.transaction.commit();
          logger.debug('Transaction committed successfully', {
            transactionId: dbContext.transactionId,
            statusCode: reply.statusCode,
            duration
          });
        } else {
          await request.transaction.rollback();
          logger.debug('Transaction rolled back due to error response', {
            transactionId: dbContext.transactionId,
            statusCode: reply.statusCode,
            duration
          });
        }

        // Cleanup active transaction
        activeTransactions.delete(dbContext.transactionId);
      }

      // Log performance metrics
      if (enablePerformanceLogging) {
        logger.info('Request completed', {
          url: request.url,
          method: request.method,
          statusCode: reply.statusCode,
          duration,
          queryCount: dbContext.queryCount,
          tenantId: dbContext.tenantId,
          userId: dbContext.userId,
          transactionId: dbContext.transactionId
        });
      }

      // Record query performance if monitoring is enabled
      if (enableQueryMonitoring) {
        const querySignature = `${request.method} ${request.url}`;
        QueryPerformanceMonitor.recordQuery(querySignature, duration);
      }

    } catch (error) {
      logger.error('Failed to complete database operations', {
        error: error.message,
        transactionId: dbContext.transactionId,
        url: request.url
      });

      // Force rollback on error
      if (request.transaction) {
        try {
          await request.transaction.rollback();
          if (dbContext.transactionId) {
            activeTransactions.delete(dbContext.transactionId);
          }
        } catch (rollbackError) {
          logger.error('Failed to rollback transaction', {
            error: rollbackError.message,
            transactionId: dbContext.transactionId
          });
        }
      }
    }

    return payload;
  });

  /**
   * onError hook - Handle database-related errors
   */
  fastify.addHook('onError', async (request: FastifyRequest, reply: FastifyReply, error) => {
    const dbContext = request.dbContext;
    
    // Log database errors
    logger.error('Request error occurred', {
      error: error.message,
      stack: error.stack,
      url: request.url,
      method: request.method,
      tenantId: dbContext?.tenantId,
      userId: dbContext?.userId,
      transactionId: dbContext?.transactionId,
      queryCount: dbContext?.queryCount
    });

    // Rollback transaction if active
    if (request.transaction && dbContext?.transactionId) {
      try {
        await request.transaction.rollback();
        activeTransactions.delete(dbContext.transactionId);
        
        logger.debug('Transaction rolled back due to error', {
          transactionId: dbContext.transactionId,
          error: error.message
        });
      } catch (rollbackError) {
        logger.error('Failed to rollback transaction on error', {
          rollbackError: rollbackError.message,
          originalError: error.message,
          transactionId: dbContext.transactionId
        });
      }
    }

    // Handle specific database errors
    if (error instanceof TransactionError) {
      reply.status(409).send({
        error: 'Transaction Error',
        message: error.message,
        code: 'TRANSACTION_ERROR'
      });
    }
  });

  /**
   * onClose hook - Cleanup active transactions
   */
  fastify.addHook('onClose', async () => {
    logger.info('Cleaning up active transactions on server close');
    
    const cleanupPromises = Array.from(activeTransactions.entries()).map(
      async ([transactionId, transaction]) => {
        try {
          await transaction.rollback();
          logger.debug('Transaction cleaned up on server close', { transactionId });
        } catch (error) {
          logger.error('Failed to cleanup transaction on server close', {
            transactionId,
            error: error.message
          });
        }
      }
    );

    await Promise.allSettled(cleanupPromises);
    activeTransactions.clear();
  });

  // Helper methods for request context
  fastify.decorate('getDatabaseContext', function(request: FastifyRequest): DatabaseRequestContext | undefined {
    return request.dbContext;
  });

  fastify.decorate('getTransaction', function(request: FastifyRequest): TransactionContext | undefined {
    return request.transaction;
  });

  fastify.decorate('requireTransaction', function(request: FastifyRequest): TransactionContext {
    if (!request.transaction) {
      throw new Error('Transaction context not available. Ensure request uses write operations.');
    }
    return request.transaction;
  });

  // Statistics endpoint
  fastify.get('/db-stats', async (request, reply) => {
    try {
      const metrics = db.getMetrics();
      const poolStats = db.getPool().options;
      const queryStats = enableQueryMonitoring ? QueryPerformanceMonitor.getStats() : {};
      
      return {
        pool: {
          total: metrics.totalConnections,
          idle: metrics.idleConnections,
          waiting: metrics.waitingClients,
          max: poolStats.max
        },
        activeTransactions: activeTransactions.size,
        queryStats: Object.keys(queryStats).length,
        slowQueries: enableQueryMonitoring ? QueryPerformanceMonitor.getSlowQueries().length : 0
      };
    } catch (error) {
      logger.error('Failed to get database statistics', { error });
      return reply.status(500).send({ error: 'Failed to get database statistics' });
    }
  });
}

/**
 * Validate tenant access permissions
 */
async function validateTenantAccess(request: FastifyRequest): Promise<void> {
  const dbContext = request.dbContext;
  if (!dbContext?.tenantId) {
    return; // No tenant context, skip validation
  }

  // Check if tenant exists and is active
  try {
    const result = await db.query(
      'SELECT id, status FROM tenants WHERE id = $1 AND deleted_at IS NULL',
      [dbContext.tenantId]
    );

    if (result.rows.length === 0) {
      throw new TenantValidationError(`Tenant '${dbContext.tenantId}' not found`);
    }

    const tenant = result.rows[0];
    if (tenant.status !== 'active') {
      throw new TenantValidationError(`Tenant '${dbContext.tenantId}' is not active`);
    }

  } catch (error) {
    if (error instanceof TenantValidationError) {
      throw error;
    }
    logger.error('Failed to validate tenant access', {
      tenantId: dbContext.tenantId,
      error: error.message
    });
    throw new TenantValidationError('Failed to validate tenant access');
  }
}

/**
 * Check if request is a write operation
 */
function isWriteOperation(request: FastifyRequest): boolean {
  const writeHttpMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  return writeHttpMethods.includes(request.method);
}

/**
 * Generate unique transaction ID
 */
function generateTransactionId(): string {
  return `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create transaction context for request
 */
async function createRequestTransaction(
  request: FastifyRequest,
  options: TransactionOptions
): Promise<TransactionContext> {
  const dbContext = request.dbContext!;
  
  return new Promise((resolve, reject) => {
    withTransaction(async (ctx) => {
      // Set tenant context if available
      if (dbContext.tenantId) {
        await ctx.query('SET LOCAL app.current_tenant_id = $1', [dbContext.tenantId]);
      }

      // Set user context if available
      if (dbContext.userId) {
        await ctx.query('SET LOCAL app.current_user_id = $1', [dbContext.userId]);
      }

      // Set request timeout
      if (options.timeout) {
        await ctx.query('SET LOCAL statement_timeout = $1', [`${options.timeout}ms`]);
      }

      resolve(ctx);
      
      // Keep transaction open by waiting for external completion
      return new Promise(() => {}); // This will be resolved externally
    }, {
      isolationLevel: options.isolationLevel,
      readOnly: options.readOnly
    }).catch(reject);
  });
}

/**
 * Transaction decorator for route handlers
 */
export function withRequestTransaction(options: TransactionOptions = {}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const request = args[0] as FastifyRequest;
      const reply = args[1] as FastifyReply;

      // Check if transaction already exists
      if (request.transaction) {
        return originalMethod.apply(this, args);
      }

      // Create new transaction for this handler
      return withTransaction(async (ctx) => {
        // Temporarily assign transaction to request
        const originalTransaction = request.transaction;
        request.transaction = ctx;

        try {
          const result = await originalMethod.apply(this, args);
          return result;
        } finally {
          // Restore original transaction
          request.transaction = originalTransaction;
        }
      }, {
        isolationLevel: options.isolationLevel || 'READ COMMITTED',
        readOnly: options.readOnly,
        retryAttempts: options.autoCommit === false ? 1 : 3
      });
    };

    return descriptor;
  };
}

/**
 * Require database context decorator
 */
export function requireDatabaseContext(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  const originalMethod = descriptor.value;

  descriptor.value = async function (...args: any[]) {
    const request = args[0] as FastifyRequest;
    const reply = args[1] as FastifyReply;

    if (!request.dbContext) {
      return reply.status(500).send({
        error: 'Database Context Missing',
        message: 'Database context not available. Ensure database hooks are properly configured.'
      });
    }

    return originalMethod.apply(this, args);
  };

  return descriptor;
}

/**
 * Query counter middleware for rate limiting
 */
export function trackQueryCount(request: FastifyRequest): void {
  if (request.dbContext) {
    request.dbContext.queryCount++;
  }
}

/**
 * Get database performance metrics
 */
export function getDatabaseMetrics(): {
  pool: any;
  queries: any;
  transactions: number;
} {
  return {
    pool: db.getMetrics(),
    queries: QueryPerformanceMonitor.getStats(),
    transactions: 0 // This would be tracked by the plugin
  };
}

// Export types and functions
export {
  DatabaseRequestContext,
  TransactionOptions,
  DatabaseHookOptions,
  withRequestTransaction,
  requireDatabaseContext,
  trackQueryCount,
  getDatabaseMetrics
};