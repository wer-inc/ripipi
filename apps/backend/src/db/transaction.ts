import { PoolClient } from 'pg';
import { db } from './index.js';
import { logger } from '../config/logger.js';

export interface TransactionOptions {
  isolationLevel?: 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
  readOnly?: boolean;
  deferrable?: boolean;
  retryAttempts?: number;
  retryDelay?: number;
}

export interface TransactionContext {
  client: PoolClient;
  query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }>;
  queryForTenant<T = any>(tenantId: string, text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }>;
  rollback(): Promise<void>;
  commit(): Promise<void>;
}

/**
 * Error types for transaction handling
 */
export class TransactionError extends Error {
  constructor(message: string, public readonly originalError?: Error) {
    super(message);
    this.name = 'TransactionError';
  }
}

export class DeadlockError extends TransactionError {
  constructor(originalError: Error) {
    super('Transaction deadlock detected', originalError);
    this.name = 'DeadlockError';
  }
}

export class SerializationError extends TransactionError {
  constructor(originalError: Error) {
    super('Transaction serialization failure', originalError);
    this.name = 'SerializationError';
  }
}

/**
 * Check if an error is retryable (deadlock or serialization failure)
 */
function isRetryableError(error: any): boolean {
  const retryableCodes = ['40001', '40P01']; // Serialization failure, deadlock detected
  return error && error.code && retryableCodes.includes(error.code);
}

/**
 * Check if an error is a deadlock
 */
function isDeadlockError(error: any): boolean {
  return error && error.code === '40P01';
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function within a database transaction with automatic retry logic
 */
export async function withTransaction<T>(
  callback: (ctx: TransactionContext) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const {
    isolationLevel = 'READ COMMITTED',
    readOnly = false,
    deferrable = false,
    retryAttempts = 3,
    retryDelay = 100
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    const client = await db.getClient();
    let transactionStarted = false;

    try {
      // Build transaction start command
      let transactionCommand = 'BEGIN';
      const transactionOptions: string[] = [];

      if (isolationLevel !== 'READ COMMITTED') {
        transactionOptions.push(`ISOLATION LEVEL ${isolationLevel}`);
      }
      if (readOnly) {
        transactionOptions.push('READ ONLY');
      }
      if (deferrable) {
        transactionOptions.push('DEFERRABLE');
      }

      if (transactionOptions.length > 0) {
        transactionCommand += ` ${transactionOptions.join(' ')}`;
      }

      // Start transaction
      await client.query(transactionCommand);
      transactionStarted = true;

      logger.debug(`Transaction started (attempt ${attempt}/${retryAttempts})`, {
        isolationLevel,
        readOnly,
        deferrable,
        command: transactionCommand
      });

      // Create transaction context
      const context: TransactionContext = {
        client,
        
        async query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }> {
          const start = Date.now();
          try {
            const result = await client.query(text, params);
            const duration = Date.now() - start;
            
            logger.debug('Transaction query executed', {
              query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
              duration,
              rowCount: result.rowCount
            });

            return {
              rows: result.rows,
              rowCount: result.rowCount || 0
            };
          } catch (error) {
            const duration = Date.now() - start;
            logger.error('Transaction query failed', {
              query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
              duration,
              error
            });
            throw error;
          }
        },

        async queryForTenant<T = any>(
          tenantId: string,
          text: string,
          params?: any[]
        ): Promise<{ rows: T[]; rowCount: number }> {
          // Add tenant_id filter similar to the main db class
          let modifiedQuery = text;
          const hasWhere = /\bWHERE\b/i.test(text);
          
          if (!hasWhere && /\bFROM\s+\w+/i.test(text)) {
            modifiedQuery = text.replace(
              /(\bFROM\s+\w+)/i,
              `$1 WHERE tenant_id = $${(params?.length || 0) + 1}`
            );
            params = [...(params || []), tenantId];
          } else if (hasWhere) {
            modifiedQuery = text.replace(
              /(\bWHERE\b)/i,
              `$1 tenant_id = $${(params?.length || 0) + 1} AND`
            );
            params = [...(params || []), tenantId];
          }

          return this.query<T>(modifiedQuery, params);
        },

        async rollback(): Promise<void> {
          if (transactionStarted) {
            await client.query('ROLLBACK');
            logger.debug('Transaction rolled back explicitly');
          }
        },

        async commit(): Promise<void> {
          if (transactionStarted) {
            await client.query('COMMIT');
            logger.debug('Transaction committed explicitly');
            transactionStarted = false;
          }
        }
      };

      // Execute the callback
      const result = await callback(context);

      // Commit transaction if not already committed
      if (transactionStarted) {
        await client.query('COMMIT');
        logger.debug(`Transaction committed successfully (attempt ${attempt})`);
      }

      return result;

    } catch (error: any) {
      lastError = error;

      // Rollback transaction if it was started
      if (transactionStarted) {
        try {
          await client.query('ROLLBACK');
          logger.debug(`Transaction rolled back due to error (attempt ${attempt})`, { error: error.message });
        } catch (rollbackError) {
          logger.error('Failed to rollback transaction', { rollbackError });
        }
      }

      // Check if this is a retryable error
      if (isRetryableError(error)) {
        if (isDeadlockError(error)) {
          logger.warn(`Deadlock detected on attempt ${attempt}/${retryAttempts}`, {
            error: error.message,
            code: error.code
          });
          lastError = new DeadlockError(error);
        } else {
          logger.warn(`Serialization failure on attempt ${attempt}/${retryAttempts}`, {
            error: error.message,
            code: error.code
          });
          lastError = new SerializationError(error);
        }

        // Retry if we have attempts left
        if (attempt < retryAttempts) {
          const delay = retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
          logger.debug(`Retrying transaction in ${delay}ms...`);
          await sleep(delay);
          continue;
        }
      } else {
        // Non-retryable error, wrap and throw immediately
        logger.error('Non-retryable transaction error', {
          error: error.message,
          code: error.code,
          attempt
        });
        throw new TransactionError(`Transaction failed: ${error.message}`, error);
      }

    } finally {
      // Always release the client back to the pool
      client.release();
    }
  }

  // All retry attempts exhausted
  logger.error(`Transaction failed after ${retryAttempts} attempts`, {
    lastError: lastError?.message
  });
  
  throw lastError || new TransactionError('Transaction failed after maximum retry attempts');
}

/**
 * Execute multiple operations in a single transaction
 * Useful for batch operations that need to be atomic
 */
export async function withBatchTransaction<T>(
  operations: Array<(ctx: TransactionContext) => Promise<T>>,
  options?: TransactionOptions
): Promise<T[]> {
  return withTransaction(async (ctx) => {
    const results: T[] = [];
    
    for (const operation of operations) {
      const result = await operation(ctx);
      results.push(result);
    }
    
    return results;
  }, options);
}

/**
 * Execute a tenant-scoped transaction
 * Automatically adds tenant filtering to all queries
 */
export async function withTenantTransaction<T>(
  tenantId: string,
  callback: (ctx: TransactionContext) => Promise<T>,
  options?: TransactionOptions
): Promise<T> {
  if (!tenantId) {
    throw new TransactionError('Tenant ID is required for tenant transactions');
  }

  return withTransaction(async (ctx) => {
    // Set the tenant context at the beginning of the transaction
    await ctx.query('SET LOCAL app.current_tenant_id = $1', [tenantId]);
    
    return callback(ctx);
  }, options);
}

/**
 * Create a savepoint within an existing transaction
 */
export async function withSavepoint<T>(
  ctx: TransactionContext,
  name: string,
  callback: () => Promise<T>
): Promise<T> {
  await ctx.query(`SAVEPOINT ${name}`);
  
  try {
    const result = await callback();
    await ctx.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    await ctx.query(`ROLLBACK TO SAVEPOINT ${name}`);
    throw error;
  }
}

// Export error types
export { TransactionError, DeadlockError, SerializationError };