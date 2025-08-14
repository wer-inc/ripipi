/**
 * Distributed Transaction Manager
 * Implementation of 2-Phase Commit and Saga patterns for distributed transactions
 */

import { EventEmitter } from 'events';
import { Redis } from 'ioredis';
import { withTransaction, TransactionContext } from '../db/transaction.js';
import { logger } from '../config/logger.js';
import {
  DistributedTransactionStatus,
  DistributedTransactionContext,
  DistributedTransactionParticipant,
  IdempotencyError
} from '../types/idempotency.js';

export interface DistributedTransactionConfig {
  // Timeouts
  transactionTimeoutMs: number;
  participantTimeoutMs: number;
  compensationTimeoutMs: number;
  
  // Retry settings
  maxRetries: number;
  retryDelayMs: number;
  retryMultiplier: number;
  
  // Storage settings
  useRedis: boolean;
  usePostgreSQL: boolean;
  redisKeyPrefix: string;
  
  // Performance
  enableMetrics: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  
  // Recovery settings
  recoveryEnabled: boolean;
  recoveryIntervalMs: number;
  maxRecoveryAttempts: number;
}

export interface TransactionOperation {
  participantId: string;
  service: string;
  operation: string;
  data: any;
  idempotencyKey?: string;
  
  // Operation callbacks
  prepare?: (data: any) => Promise<any>;
  commit?: (data: any) => Promise<any>;
  abort?: (reason: string) => Promise<void>;
  compensate?: (data: any) => Promise<void>;
}

export interface SagaStep {
  stepId: string;
  service: string;
  operation: string;
  data: any;
  idempotencyKey?: string;
  
  // Saga callbacks
  execute: (data: any) => Promise<any>;
  compensate: (data: any) => Promise<void>;
  
  // Step configuration
  retryable: boolean;
  timeout: number;
  dependencies?: string[];
}

export class DistributedTransactionError extends IdempotencyError {
  constructor(
    message: string,
    public readonly transactionId: string,
    public readonly status: DistributedTransactionStatus,
    details?: any
  ) {
    super(message, 'DISTRIBUTED_TRANSACTION_ERROR', { transactionId, status, ...details });
    this.name = 'DistributedTransactionError';
  }
}

/**
 * 2-Phase Commit Coordinator
 */
export class TwoPhaseCommitCoordinator extends EventEmitter {
  private redis?: Redis;
  private config: DistributedTransactionConfig;
  private activeTransactions: Map<string, DistributedTransactionContext> = new Map();
  private recoveryTimer?: NodeJS.Timeout;

  constructor(redis?: Redis, config: Partial<DistributedTransactionConfig> = {}) {
    super();
    this.redis = redis;
    this.config = {
      transactionTimeoutMs: 300000, // 5 minutes
      participantTimeoutMs: 30000,  // 30 seconds
      compensationTimeoutMs: 60000, // 1 minute
      maxRetries: 3,
      retryDelayMs: 1000,
      retryMultiplier: 2,
      useRedis: !!redis,
      usePostgreSQL: true,
      redisKeyPrefix: 'dtx:2pc:',
      enableMetrics: true,
      logLevel: 'info',
      recoveryEnabled: true,
      recoveryIntervalMs: 60000, // 1 minute
      maxRecoveryAttempts: 10,
      ...config
    };

    if (this.config.recoveryEnabled) {
      this.startRecoveryProcess();
    }
  }

  /**
   * Start a new distributed transaction
   */
  async beginTransaction(
    transactionId: string,
    operations: TransactionOperation[],
    tenantId?: string
  ): Promise<DistributedTransactionContext> {
    const startTime = Date.now();
    
    try {
      logger.info('Beginning 2PC transaction', {
        transactionId,
        participantCount: operations.length,
        tenantId
      });

      // Validate operations
      this.validateOperations(operations);

      // Create transaction context
      const context: DistributedTransactionContext = {
        transactionId,
        participantId: 'coordinator',
        status: DistributedTransactionStatus.INITIATED,
        idempotencyKeys: operations.map(op => op.idempotencyKey).filter(Boolean) as string[],
        createdAt: new Date(),
        lastUpdatedAt: new Date(),
        expiresAt: new Date(Date.now() + this.config.transactionTimeoutMs),
        metadata: {
          tenantId,
          operationCount: operations.length,
          startTime
        }
      };

      // Create participants
      const participants: DistributedTransactionParticipant[] = operations.map(op => ({
        participantId: op.participantId,
        service: op.service,
        operation: op.operation,
        idempotencyKey: op.idempotencyKey || '',
        status: DistributedTransactionStatus.INITIATED,
        compensationRequired: true
      }));

      // Store transaction context
      await this.saveTransactionContext(context);
      await this.saveParticipants(transactionId, participants);

      this.activeTransactions.set(transactionId, context);

      // Emit event
      this.emit('transactionStarted', { transactionId, context, participants });

      logger.info('2PC transaction initiated successfully', {
        transactionId,
        duration: Date.now() - startTime
      });

      return context;

    } catch (error) {
      logger.error('Failed to begin 2PC transaction', {
        transactionId,
        error: error.message,
        duration: Date.now() - startTime
      });
      
      throw new DistributedTransactionError(
        `Failed to begin transaction: ${error.message}`,
        transactionId,
        DistributedTransactionStatus.FAILED
      );
    }
  }

  /**
   * Execute 2-Phase Commit protocol
   */
  async commitTransaction(
    transactionId: string,
    operations: TransactionOperation[]
  ): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      logger.info('Starting 2PC commit', { transactionId });

      const context = await this.getTransactionContext(transactionId);
      if (!context) {
        throw new Error('Transaction context not found');
      }

      // Phase 1: Prepare all participants
      const prepareResults = await this.preparePhase(transactionId, operations);
      const allPrepared = prepareResults.every(result => result.success);

      if (!allPrepared) {
        logger.warn('Prepare phase failed, aborting transaction', {
          transactionId,
          failures: prepareResults.filter(r => !r.success)
        });

        await this.abortTransaction(transactionId, operations);
        return false;
      }

      // Phase 2: Commit all participants
      const commitResults = await this.commitPhase(transactionId, operations);
      const allCommitted = commitResults.every(result => result.success);

      if (allCommitted) {
        await this.updateTransactionStatus(transactionId, DistributedTransactionStatus.COMMITTED);
        this.activeTransactions.delete(transactionId);

        logger.info('2PC transaction committed successfully', {
          transactionId,
          duration: Date.now() - startTime
        });

        this.emit('transactionCommitted', { transactionId, duration: Date.now() - startTime });
        return true;
      } else {
        // Some commits failed - this is a serious inconsistency
        logger.error('Commit phase partially failed - system inconsistency detected', {
          transactionId,
          failures: commitResults.filter(r => !r.success)
        });

        await this.updateTransactionStatus(transactionId, DistributedTransactionStatus.FAILED);
        this.emit('transactionInconsistent', { transactionId, commitResults });
        
        throw new DistributedTransactionError(
          'Partial commit failure detected',
          transactionId,
          DistributedTransactionStatus.FAILED,
          { commitResults }
        );
      }

    } catch (error) {
      logger.error('2PC commit failed', {
        transactionId,
        error: error.message,
        duration: Date.now() - startTime
      });

      await this.updateTransactionStatus(transactionId, DistributedTransactionStatus.FAILED);
      this.emit('transactionFailed', { transactionId, error: error.message });
      
      if (error instanceof DistributedTransactionError) {
        throw error;
      }
      
      throw new DistributedTransactionError(
        `Transaction commit failed: ${error.message}`,
        transactionId,
        DistributedTransactionStatus.FAILED
      );
    }
  }

  /**
   * Abort a transaction
   */
  async abortTransaction(
    transactionId: string,
    operations: TransactionOperation[]
  ): Promise<void> {
    const startTime = Date.now();
    
    try {
      logger.info('Aborting 2PC transaction', { transactionId });

      await this.updateTransactionStatus(transactionId, DistributedTransactionStatus.ABORTING);

      // Abort all participants
      const abortPromises = operations.map(async (op) => {
        try {
          if (op.abort) {
            await op.abort('Transaction aborted');
          }
          
          await this.updateParticipantStatus(
            transactionId,
            op.participantId,
            DistributedTransactionStatus.ABORTED
          );
          
          return { participantId: op.participantId, success: true };
        } catch (error) {
          logger.error('Failed to abort participant', {
            transactionId,
            participantId: op.participantId,
            error: error.message
          });
          
          return { participantId: op.participantId, success: false, error: error.message };
        }
      });

      const results = await Promise.all(abortPromises);
      const allAborted = results.every(result => result.success);

      await this.updateTransactionStatus(
        transactionId,
        allAborted ? DistributedTransactionStatus.ABORTED : DistributedTransactionStatus.FAILED
      );

      this.activeTransactions.delete(transactionId);

      logger.info('2PC transaction aborted', {
        transactionId,
        allAborted,
        duration: Date.now() - startTime
      });

      this.emit('transactionAborted', { transactionId, results });

    } catch (error) {
      logger.error('Failed to abort 2PC transaction', {
        transactionId,
        error: error.message
      });
      
      throw new DistributedTransactionError(
        `Failed to abort transaction: ${error.message}`,
        transactionId,
        DistributedTransactionStatus.FAILED
      );
    }
  }

  // Private methods for 2PC

  private async preparePhase(
    transactionId: string,
    operations: TransactionOperation[]
  ): Promise<Array<{ participantId: string; success: boolean; error?: string }>> {
    logger.debug('Starting prepare phase', { transactionId });

    await this.updateTransactionStatus(transactionId, DistributedTransactionStatus.PREPARING);

    const preparePromises = operations.map(async (op) => {
      try {
        await this.updateParticipantStatus(
          transactionId,
          op.participantId,
          DistributedTransactionStatus.PREPARING
        );

        let prepareResult = null;
        if (op.prepare) {
          prepareResult = await this.executeWithTimeout(
            () => op.prepare!(op.data),
            this.config.participantTimeoutMs,
            `Prepare timeout for ${op.participantId}`
          );
        }

        await this.updateParticipantStatus(
          transactionId,
          op.participantId,
          DistributedTransactionStatus.PREPARED,
          prepareResult
        );

        return { participantId: op.participantId, success: true };
      } catch (error) {
        logger.error('Prepare failed for participant', {
          transactionId,
          participantId: op.participantId,
          error: error.message
        });

        await this.updateParticipantStatus(
          transactionId,
          op.participantId,
          DistributedTransactionStatus.FAILED,
          null,
          error.message
        );

        return { participantId: op.participantId, success: false, error: error.message };
      }
    });

    const results = await Promise.all(preparePromises);

    const allPrepared = results.every(result => result.success);
    await this.updateTransactionStatus(
      transactionId,
      allPrepared ? DistributedTransactionStatus.PREPARED : DistributedTransactionStatus.ABORTING
    );

    logger.debug('Prepare phase completed', {
      transactionId,
      prepared: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    });

    return results;
  }

  private async commitPhase(
    transactionId: string,
    operations: TransactionOperation[]
  ): Promise<Array<{ participantId: string; success: boolean; error?: string }>> {
    logger.debug('Starting commit phase', { transactionId });

    await this.updateTransactionStatus(transactionId, DistributedTransactionStatus.COMMITTING);

    const commitPromises = operations.map(async (op) => {
      try {
        await this.updateParticipantStatus(
          transactionId,
          op.participantId,
          DistributedTransactionStatus.COMMITTING
        );

        let commitResult = null;
        if (op.commit) {
          commitResult = await this.executeWithTimeout(
            () => op.commit!(op.data),
            this.config.participantTimeoutMs,
            `Commit timeout for ${op.participantId}`
          );
        }

        await this.updateParticipantStatus(
          transactionId,
          op.participantId,
          DistributedTransactionStatus.COMMITTED,
          commitResult
        );

        return { participantId: op.participantId, success: true };
      } catch (error) {
        logger.error('Commit failed for participant', {
          transactionId,
          participantId: op.participantId,
          error: error.message
        });

        // Note: In commit phase, we can't abort - this creates inconsistency
        await this.updateParticipantStatus(
          transactionId,
          op.participantId,
          DistributedTransactionStatus.FAILED,
          null,
          error.message
        );

        return { participantId: op.participantId, success: false, error: error.message };
      }
    });

    const results = await Promise.all(commitPromises);

    logger.debug('Commit phase completed', {
      transactionId,
      committed: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    });

    return results;
  }

  private validateOperations(operations: TransactionOperation[]): void {
    if (!operations || operations.length === 0) {
      throw new Error('No operations provided');
    }

    const participantIds = new Set();
    for (const op of operations) {
      if (!op.participantId || !op.service || !op.operation) {
        throw new Error('Invalid operation: missing required fields');
      }
      
      if (participantIds.has(op.participantId)) {
        throw new Error(`Duplicate participant ID: ${op.participantId}`);
      }
      
      participantIds.add(op.participantId);
    }
  }

  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);

      operation()
        .then(result => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  // Storage operations

  private async saveTransactionContext(context: DistributedTransactionContext): Promise<void> {
    const promises = [];

    if (this.config.useRedis && this.redis) {
      promises.push(this.saveContextInRedis(context));
    }

    if (this.config.usePostgreSQL) {
      promises.push(this.saveContextInPostgreSQL(context));
    }

    await Promise.all(promises);
  }

  private async saveContextInRedis(context: DistributedTransactionContext): Promise<void> {
    if (!this.redis) return;

    const key = `${this.config.redisKeyPrefix}ctx:${context.transactionId}`;
    const ttl = Math.floor((context.expiresAt.getTime() - Date.now()) / 1000);

    await this.redis.setex(key, ttl, JSON.stringify(context));
  }

  private async saveContextInPostgreSQL(context: DistributedTransactionContext): Promise<void> {
    await withTransaction(async (ctx: TransactionContext) => {
      const query = `
        INSERT INTO distributed_transaction_contexts (
          transaction_id, participant_id, status, idempotency_keys,
          created_at, last_updated_at, expires_at, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (transaction_id) DO UPDATE SET
          status = EXCLUDED.status,
          last_updated_at = EXCLUDED.last_updated_at
      `;

      await ctx.query(query, [
        context.transactionId,
        context.participantId,
        context.status,
        JSON.stringify(context.idempotencyKeys),
        context.createdAt,
        context.lastUpdatedAt,
        context.expiresAt,
        JSON.stringify(context.metadata)
      ]);
    });
  }

  private async getTransactionContext(transactionId: string): Promise<DistributedTransactionContext | null> {
    // Try Redis first
    if (this.config.useRedis && this.redis) {
      const cached = await this.getContextFromRedis(transactionId);
      if (cached) return cached;
    }

    // Fallback to PostgreSQL
    if (this.config.usePostgreSQL) {
      return this.getContextFromPostgreSQL(transactionId);
    }

    return null;
  }

  private async getContextFromRedis(transactionId: string): Promise<DistributedTransactionContext | null> {
    if (!this.redis) return null;

    const key = `${this.config.redisKeyPrefix}ctx:${transactionId}`;
    const data = await this.redis.get(key);

    if (!data) return null;

    const context = JSON.parse(data) as DistributedTransactionContext;
    // Convert date strings back to Date objects
    context.createdAt = new Date(context.createdAt);
    context.lastUpdatedAt = new Date(context.lastUpdatedAt);
    context.expiresAt = new Date(context.expiresAt);

    return context;
  }

  private async getContextFromPostgreSQL(transactionId: string): Promise<DistributedTransactionContext | null> {
    const query = `
      SELECT * FROM distributed_transaction_contexts 
      WHERE transaction_id = $1
    `;

    const result = await db.query(query, [transactionId]);
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      transactionId: row.transaction_id,
      participantId: row.participant_id,
      status: row.status,
      idempotencyKeys: JSON.parse(row.idempotency_keys || '[]'),
      createdAt: row.created_at,
      lastUpdatedAt: row.last_updated_at,
      expiresAt: row.expires_at,
      metadata: JSON.parse(row.metadata || '{}')
    };
  }

  private async updateTransactionStatus(
    transactionId: string,
    status: DistributedTransactionStatus
  ): Promise<void> {
    const context = this.activeTransactions.get(transactionId);
    if (context) {
      context.status = status;
      context.lastUpdatedAt = new Date();
    }

    const promises = [];

    if (this.config.useRedis && this.redis) {
      promises.push(this.updateStatusInRedis(transactionId, status));
    }

    if (this.config.usePostgreSQL) {
      promises.push(this.updateStatusInPostgreSQL(transactionId, status));
    }

    await Promise.all(promises);
  }

  private async updateStatusInRedis(
    transactionId: string,
    status: DistributedTransactionStatus
  ): Promise<void> {
    if (!this.redis) return;

    const key = `${this.config.redisKeyPrefix}ctx:${transactionId}`;
    const context = await this.getContextFromRedis(transactionId);
    
    if (context) {
      context.status = status;
      context.lastUpdatedAt = new Date();
      
      const ttl = Math.floor((context.expiresAt.getTime() - Date.now()) / 1000);
      await this.redis.setex(key, ttl, JSON.stringify(context));
    }
  }

  private async updateStatusInPostgreSQL(
    transactionId: string,
    status: DistributedTransactionStatus
  ): Promise<void> {
    const query = `
      UPDATE distributed_transaction_contexts
      SET status = $1, last_updated_at = $2
      WHERE transaction_id = $3
    `;

    await db.query(query, [status, new Date(), transactionId]);
  }

  private async saveParticipants(
    transactionId: string,
    participants: DistributedTransactionParticipant[]
  ): Promise<void> {
    if (this.config.usePostgreSQL) {
      await withTransaction(async (ctx: TransactionContext) => {
        for (const participant of participants) {
          const query = `
            INSERT INTO distributed_transaction_participants (
              transaction_id, participant_id, service, operation, idempotency_key,
              status, compensation_required
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (transaction_id, participant_id) DO UPDATE SET
              status = EXCLUDED.status
          `;

          await ctx.query(query, [
            transactionId,
            participant.participantId,
            participant.service,
            participant.operation,
            participant.idempotencyKey,
            participant.status,
            participant.compensationRequired
          ]);
        }
      });
    }
  }

  private async updateParticipantStatus(
    transactionId: string,
    participantId: string,
    status: DistributedTransactionStatus,
    data?: any,
    error?: string
  ): Promise<void> {
    if (!this.config.usePostgreSQL) return;

    const now = new Date();
    let updateFields = ['status = $3', 'last_updated_at = $4'];
    let params = [transactionId, participantId, status, now];
    let paramIndex = 4;

    if (data) {
      updateFields.push(`${status === DistributedTransactionStatus.PREPARED ? 'prepare_data' : 'commit_data'} = $${++paramIndex}`);
      params.push(JSON.stringify(data));
    }

    if (error) {
      updateFields.push(`abort_reason = $${++paramIndex}`);
      params.push(error);
    }

    // Set timestamp fields based on status
    switch (status) {
      case DistributedTransactionStatus.PREPARED:
        updateFields.push(`prepared_at = $${++paramIndex}`);
        params.push(now);
        break;
      case DistributedTransactionStatus.COMMITTED:
        updateFields.push(`committed_at = $${++paramIndex}`);
        params.push(now);
        break;
      case DistributedTransactionStatus.ABORTED:
        updateFields.push(`aborted_at = $${++paramIndex}`);
        params.push(now);
        break;
    }

    const query = `
      UPDATE distributed_transaction_participants
      SET ${updateFields.join(', ')}
      WHERE transaction_id = $1 AND participant_id = $2
    `;

    await db.query(query, params);
  }

  private startRecoveryProcess(): void {
    this.recoveryTimer = setInterval(async () => {
      try {
        await this.recoverStaleTransactions();
      } catch (error) {
        logger.error('Recovery process error', { error: error.message });
      }
    }, this.config.recoveryIntervalMs);
  }

  private async recoverStaleTransactions(): Promise<void> {
    if (!this.config.usePostgreSQL) return;

    try {
      // Find transactions that are expired or stuck
      const query = `
        SELECT DISTINCT transaction_id, status, expires_at
        FROM distributed_transaction_contexts
        WHERE (expires_at < NOW() OR last_updated_at < NOW() - INTERVAL '10 minutes')
          AND status NOT IN ('committed', 'aborted', 'failed')
        LIMIT 10
      `;

      const result = await db.query(query);

      for (const row of result.rows) {
        const transactionId = row.transaction_id;
        const status = row.status as DistributedTransactionStatus;

        logger.info('Recovering stale transaction', { transactionId, status });

        try {
          switch (status) {
            case DistributedTransactionStatus.PREPARING:
            case DistributedTransactionStatus.PREPARED:
              // These can be safely aborted
              await this.updateTransactionStatus(transactionId, DistributedTransactionStatus.ABORTED);
              break;
            
            case DistributedTransactionStatus.COMMITTING:
              // This requires manual intervention or compensating actions
              logger.error('Transaction stuck in committing state - manual intervention required', {
                transactionId
              });
              await this.updateTransactionStatus(transactionId, DistributedTransactionStatus.FAILED);
              break;
            
            default:
              logger.warn('Unknown transaction status during recovery', {
                transactionId,
                status
              });
          }
        } catch (error) {
          logger.error('Failed to recover transaction', {
            transactionId,
            error: error.message
          });
        }
      }
    } catch (error) {
      logger.error('Recovery query failed', { error: error.message });
    }
  }

  async destroy(): Promise<void> {
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
    }
    
    this.activeTransactions.clear();
  }
}

/**
 * Saga Pattern Implementation
 */
export class SagaOrchestrator extends EventEmitter {
  private redis?: Redis;
  private config: DistributedTransactionConfig;
  private activeSagas: Map<string, any> = new Map();

  constructor(redis?: Redis, config: Partial<DistributedTransactionConfig> = {}) {
    super();
    this.redis = redis;
    this.config = {
      transactionTimeoutMs: 300000, // 5 minutes
      participantTimeoutMs: 30000,  // 30 seconds
      compensationTimeoutMs: 60000, // 1 minute
      maxRetries: 3,
      retryDelayMs: 1000,
      retryMultiplier: 2,
      useRedis: !!redis,
      usePostgreSQL: true,
      redisKeyPrefix: 'dtx:saga:',
      enableMetrics: true,
      logLevel: 'info',
      recoveryEnabled: true,
      recoveryIntervalMs: 60000,
      maxRecoveryAttempts: 10,
      ...config
    };
  }

  /**
   * Execute a saga with automatic compensation on failure
   */
  async executeSaga(
    sagaId: string,
    steps: SagaStep[],
    tenantId?: string
  ): Promise<any[]> {
    const startTime = Date.now();
    
    try {
      logger.info('Starting saga execution', {
        sagaId,
        stepCount: steps.length,
        tenantId
      });

      this.validateSagaSteps(steps);

      const results: any[] = [];
      const completedSteps: SagaStep[] = [];
      const compensationData: any[] = [];

      // Save saga state
      await this.saveSagaState(sagaId, {
        status: 'executing',
        steps,
        completedSteps: [],
        results: [],
        createdAt: new Date(),
        tenantId
      });

      // Execute steps sequentially
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        
        try {
          logger.debug('Executing saga step', {
            sagaId,
            stepId: step.stepId,
            stepIndex: i
          });

          // Check dependencies
          if (step.dependencies) {
            const dependenciesMet = step.dependencies.every(depId =>
              completedSteps.some(completed => completed.stepId === depId)
            );
            
            if (!dependenciesMet) {
              throw new Error(`Dependencies not met for step ${step.stepId}`);
            }
          }

          // Execute step with timeout
          const result = await this.executeWithTimeout(
            () => step.execute(step.data),
            step.timeout || this.config.participantTimeoutMs,
            `Step timeout for ${step.stepId}`
          );

          results.push(result);
          completedSteps.push(step);
          compensationData.push(result);

          // Update saga state
          await this.updateSagaState(sagaId, {
            completedSteps,
            results,
            lastUpdatedAt: new Date()
          });

          logger.debug('Saga step completed successfully', {
            sagaId,
            stepId: step.stepId,
            stepIndex: i
          });

        } catch (error) {
          logger.error('Saga step failed, starting compensation', {
            sagaId,
            stepId: step.stepId,
            stepIndex: i,
            error: error.message
          });

          // Compensate completed steps in reverse order
          await this.compensateCompletedSteps(sagaId, completedSteps, compensationData);

          await this.updateSagaState(sagaId, {
            status: 'failed',
            error: error.message,
            failedAt: new Date()
          });

          throw new DistributedTransactionError(
            `Saga failed at step ${step.stepId}: ${error.message}`,
            sagaId,
            DistributedTransactionStatus.FAILED,
            { failedStep: step.stepId, stepIndex: i }
          );
        }
      }

      // All steps completed successfully
      await this.updateSagaState(sagaId, {
        status: 'completed',
        completedAt: new Date()
      });

      logger.info('Saga execution completed successfully', {
        sagaId,
        stepCount: steps.length,
        duration: Date.now() - startTime
      });

      this.emit('sagaCompleted', { sagaId, results, duration: Date.now() - startTime });

      return results;

    } catch (error) {
      logger.error('Saga execution failed', {
        sagaId,
        error: error.message,
        duration: Date.now() - startTime
      });

      this.emit('sagaFailed', { sagaId, error: error.message });
      
      if (error instanceof DistributedTransactionError) {
        throw error;
      }
      
      throw new DistributedTransactionError(
        `Saga execution failed: ${error.message}`,
        sagaId,
        DistributedTransactionStatus.FAILED
      );
    }
  }

  private validateSagaSteps(steps: SagaStep[]): void {
    if (!steps || steps.length === 0) {
      throw new Error('No saga steps provided');
    }

    const stepIds = new Set();
    for (const step of steps) {
      if (!step.stepId || !step.execute) {
        throw new Error('Invalid saga step: missing required fields');
      }
      
      if (stepIds.has(step.stepId)) {
        throw new Error(`Duplicate step ID: ${step.stepId}`);
      }
      
      stepIds.add(step.stepId);

      // Validate dependencies
      if (step.dependencies) {
        for (const depId of step.dependencies) {
          if (!stepIds.has(depId)) {
            // Check if dependency is in previous steps
            const dependencyExists = steps.some((s, index) => 
              s.stepId === depId && steps.indexOf(s) < steps.indexOf(step)
            );
            if (!dependencyExists) {
              throw new Error(`Invalid dependency: ${depId} for step ${step.stepId}`);
            }
          }
        }
      }
    }
  }

  private async compensateCompletedSteps(
    sagaId: string,
    completedSteps: SagaStep[],
    compensationData: any[]
  ): Promise<void> {
    logger.info('Starting saga compensation', {
      sagaId,
      stepsToCompensate: completedSteps.length
    });

    // Compensate in reverse order
    for (let i = completedSteps.length - 1; i >= 0; i--) {
      const step = completedSteps[i];
      const data = compensationData[i];

      try {
        if (step.compensate) {
          await this.executeWithTimeout(
            () => step.compensate!(data),
            this.config.compensationTimeoutMs,
            `Compensation timeout for ${step.stepId}`
          );

          logger.debug('Step compensated successfully', {
            sagaId,
            stepId: step.stepId
          });
        }
      } catch (error) {
        logger.error('Compensation failed for step', {
          sagaId,
          stepId: step.stepId,
          error: error.message
        });
        
        // Continue compensating other steps even if one fails
      }
    }

    await this.updateSagaState(sagaId, {
      status: 'compensated',
      compensatedAt: new Date()
    });

    logger.info('Saga compensation completed', { sagaId });
  }

  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);

      operation()
        .then(result => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  private async saveSagaState(sagaId: string, state: any): Promise<void> {
    this.activeSagas.set(sagaId, state);

    if (this.config.usePostgreSQL) {
      await withTransaction(async (ctx: TransactionContext) => {
        const query = `
          INSERT INTO saga_executions (
            saga_id, status, steps_data, completed_steps_data, results_data,
            created_at, tenant_id, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (saga_id) DO UPDATE SET
            status = EXCLUDED.status,
            completed_steps_data = EXCLUDED.completed_steps_data,
            results_data = EXCLUDED.results_data,
            last_updated_at = NOW()
        `;

        await ctx.query(query, [
          sagaId,
          state.status,
          JSON.stringify(state.steps || []),
          JSON.stringify(state.completedSteps || []),
          JSON.stringify(state.results || []),
          state.createdAt,
          state.tenantId,
          JSON.stringify(state)
        ]);
      });
    }

    if (this.config.useRedis && this.redis) {
      const key = `${this.config.redisKeyPrefix}${sagaId}`;
      await this.redis.setex(key, 3600, JSON.stringify(state)); // 1 hour TTL
    }
  }

  private async updateSagaState(sagaId: string, updates: any): Promise<void> {
    const currentState = this.activeSagas.get(sagaId) || {};
    const newState = { ...currentState, ...updates };
    
    await this.saveSagaState(sagaId, newState);
  }

  async destroy(): Promise<void> {
    this.activeSagas.clear();
  }
}

// Export factory functions
export function createTwoPhaseCommitCoordinator(
  redis?: Redis,
  config?: Partial<DistributedTransactionConfig>
): TwoPhaseCommitCoordinator {
  return new TwoPhaseCommitCoordinator(redis, config);
}

export function createSagaOrchestrator(
  redis?: Redis,
  config?: Partial<DistributedTransactionConfig>
): SagaOrchestrator {
  return new SagaOrchestrator(redis, config);
}