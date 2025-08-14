/**
 * Idempotency Service
 * Core service for managing idempotency keys with 24-hour retention,
 * distributed transaction support, and comprehensive monitoring
 */

import { EventEmitter } from 'events';
import { Redis } from 'ioredis';
import { FastifyInstance } from 'fastify';
import { withTransaction } from '../db/transaction.js';
import { logger } from '../config/logger.js';
import { IdempotencyRepository } from '../repositories/idempotency.repository.js';
import {
  TwoPhaseCommitCoordinator,
  SagaOrchestrator,
  TransactionOperation,
  SagaStep
} from '../utils/distributed-transaction.js';
import {
  IdempotencyRecord,
  IdempotencyStatus,
  CreateIdempotencyKeyRequest,
  UpdateIdempotencyKeyRequest,
  IdempotencyCheckResult,
  IdempotencyServiceConfig,
  IdempotencyStatistics,
  IdempotencyError,
  IdempotencyStorageError,
  IdempotencyTimeoutError,
  IdempotencyRequestMetadata,
  IdempotencyResponseMetadata,
  IdempotencyEventType,
  IdempotencyEvent,
  DistributedTransactionContext
} from '../types/idempotency.js';

export interface IdempotencyServiceOptions {
  config?: Partial<IdempotencyServiceConfig>;
  repository?: IdempotencyRepository;
  enableDistributedTransactions?: boolean;
  enableEventEmission?: boolean;
}

/**
 * Enhanced Idempotency Service with distributed transaction support
 */
export class IdempotencyService extends EventEmitter {
  private repository: IdempotencyRepository;
  private config: IdempotencyServiceConfig;
  private redis?: Redis;
  private fastify: FastifyInstance;
  
  // Distributed transaction coordinators
  private twoPhaseCommitCoordinator?: TwoPhaseCommitCoordinator;
  private sagaOrchestrator?: SagaOrchestrator;
  
  // Background processes
  private cleanupTimer?: NodeJS.Timeout;
  private statisticsTimer?: NodeJS.Timeout;
  private monitoringTimer?: NodeJS.Timeout;
  
  // Performance tracking
  private performanceMetrics: Map<string, number[]> = new Map();
  private activeOperations: Map<string, { startTime: number; operation: string }> = new Map();
  
  // Concurrent request handling
  private pendingRequests: Map<string, Promise<IdempotencyCheckResult>> = new Map();

  constructor(fastify: FastifyInstance, options: IdempotencyServiceOptions = {}) {
    super();
    
    this.fastify = fastify;
    this.redis = fastify.redis?.primary as Redis;
    
    // Initialize configuration
    this.config = {
      defaultTtlHours: 24,
      maxTtlHours: 168, // 7 days
      minTtlMinutes: 5,
      maxConcurrentRequests: 1000,
      waitTimeoutMs: 30000,
      pollingIntervalMs: 100,
      maxWaitRetries: 50,
      maxResponseSizeBytes: 1024 * 1024, // 1MB
      enableResponseCompression: true,
      compressResponsesLargerThan: 1024, // 1KB
      cleanupEnabled: true,
      cleanupIntervalMinutes: 5,
      batchSize: 100,
      useRedis: !!this.redis,
      usePostgreSQL: true,
      preferredStorage: this.redis ? 'both' : 'postgresql',
      enableMetrics: true,
      enableDetailedLogging: false,
      slowOperationThresholdMs: 2000,
      validateFingerprints: true,
      requireSecureKeys: false,
      enableRetries: true,
      defaultMaxRetries: 3,
      retryBackoffMs: 1000,
      retryMultiplier: 2,
      ...options.config
    };

    // Initialize repository
    this.repository = options.repository || new IdempotencyRepository(
      this.redis,
      {
        useRedis: this.config.useRedis,
        usePostgreSQL: this.config.usePostgreSQL,
        preferredStorage: this.config.preferredStorage,
        enableCompression: this.config.enableResponseCompression,
        maxRetries: this.config.defaultMaxRetries,
        operationTimeoutMs: this.config.waitTimeoutMs
      }
    );

    // Initialize distributed transaction coordinators if enabled
    if (options.enableDistributedTransactions) {
      this.twoPhaseCommitCoordinator = new TwoPhaseCommitCoordinator(this.redis, {
        transactionTimeoutMs: this.config.waitTimeoutMs * 2,
        useRedis: this.config.useRedis,
        usePostgreSQL: this.config.usePostgreSQL,
        enableMetrics: this.config.enableMetrics
      });

      this.sagaOrchestrator = new SagaOrchestrator(this.redis, {
        transactionTimeoutMs: this.config.waitTimeoutMs * 2,
        useRedis: this.config.useRedis,
        usePostgreSQL: this.config.usePostgreSQL,
        enableMetrics: this.config.enableMetrics
      });
    }

    // Start background processes
    this.startBackgroundProcesses();

    logger.info('Idempotency service initialized', {
      useRedis: this.config.useRedis,
      usePostgreSQL: this.config.usePostgreSQL,
      preferredStorage: this.config.preferredStorage,
      distributedTransactions: !!options.enableDistributedTransactions
    });
  }

  /**
   * Create or retrieve an idempotency key
   */
  async createIdempotencyKey(
    request: CreateIdempotencyKeyRequest
  ): Promise<IdempotencyRecord> {
    const operationId = this.generateOperationId('create');
    const startTime = Date.now();
    
    try {
      this.activeOperations.set(operationId, { startTime, operation: 'create' });

      logger.debug('Creating idempotency key', {
        key: request.key,
        tenantId: request.tenantId,
        operationId
      });

      // Validate request
      this.validateCreateRequest(request);

      // Check if key already exists
      const existingRecord = await this.repository.getIdempotencyKey(
        request.key,
        request.tenantId
      );

      if (existingRecord) {
        // Key already exists - check fingerprint
        const requestFingerprint = this.createFingerprint(request.requestMetadata);
        
        if (this.config.validateFingerprints && 
            existingRecord.requestFingerprint !== requestFingerprint) {
          throw new IdempotencyError(
            'Idempotency key already exists with different request fingerprint',
            'FINGERPRINT_MISMATCH',
            {
              key: request.key,
              existingFingerprint: existingRecord.requestFingerprint,
              requestFingerprint
            }
          );
        }

        this.recordMetric('key_reused', Date.now() - startTime);
        this.emitEvent(IdempotencyEventType.KEY_REUSED, request.key, request.tenantId, {
          record: existingRecord,
          operationId
        });

        return existingRecord;
      }

      // Create new key
      const record = await this.repository.createIdempotencyKey(request);

      this.recordMetric('key_created', Date.now() - startTime);
      this.emitEvent(IdempotencyEventType.KEY_CREATED, request.key, request.tenantId, {
        record,
        operationId
      });

      logger.debug('Idempotency key created successfully', {
        key: request.key,
        recordId: record.id,
        operationId,
        duration: Date.now() - startTime
      });

      return record;

    } catch (error) {
      this.recordMetric('key_create_error', Date.now() - startTime);
      
      logger.error('Failed to create idempotency key', {
        key: request.key,
        error: error.message,
        operationId,
        duration: Date.now() - startTime
      });

      if (error instanceof IdempotencyError) {
        throw error;
      }

      throw new IdempotencyStorageError('create', error);
    } finally {
      this.activeOperations.delete(operationId);
    }
  }

  /**
   * Check idempotency key and get processing instructions
   */
  async checkIdempotencyKey(
    key: string,
    requestMetadata: IdempotencyRequestMetadata,
    tenantId?: string
  ): Promise<IdempotencyCheckResult> {
    const operationId = this.generateOperationId('check');
    const startTime = Date.now();
    
    try {
      this.activeOperations.set(operationId, { startTime, operation: 'check' });

      logger.debug('Checking idempotency key', {
        key,
        tenantId,
        operationId
      });

      // Check for concurrent request to same key
      const pendingKey = this.getPendingKey(key, tenantId);
      const pendingRequest = this.pendingRequests.get(pendingKey);
      
      if (pendingRequest) {
        logger.debug('Concurrent request detected, waiting for existing check', {
          key,
          tenantId,
          operationId
        });

        try {
          return await pendingRequest;
        } catch (error) {
          // If the concurrent request failed, proceed with our own check
          logger.debug('Concurrent request failed, proceeding with new check', {
            key,
            tenantId,
            operationId
          });
        }
      }

      // Create promise for this check to handle future concurrent requests
      const checkPromise = this.repository.checkIdempotencyKey(key, requestMetadata, tenantId);
      this.pendingRequests.set(pendingKey, checkPromise);

      try {
        const result = await checkPromise;

        this.recordMetric('key_checked', Date.now() - startTime);

        // Emit appropriate events
        if (result.exists && result.cachedResponse) {
          this.emitEvent(IdempotencyEventType.KEY_REUSED, key, tenantId, {
            record: result.record,
            operationId
          });
        } else if (result.conflict) {
          this.emitEvent(IdempotencyEventType.CONFLICT_DETECTED, key, tenantId, {
            conflict: result.conflict,
            operationId
          });
        }

        logger.debug('Idempotency key check completed', {
          key,
          exists: result.exists,
          shouldProceed: result.shouldProceed,
          shouldWait: result.shouldWait,
          operationId,
          duration: Date.now() - startTime
        });

        return result;

      } finally {
        this.pendingRequests.delete(pendingKey);
      }

    } catch (error) {
      this.recordMetric('key_check_error', Date.now() - startTime);
      
      logger.error('Failed to check idempotency key', {
        key,
        error: error.message,
        operationId,
        duration: Date.now() - startTime
      });

      throw new IdempotencyStorageError('check', error);
    } finally {
      this.activeOperations.delete(operationId);
    }
  }

  /**
   * Update idempotency key with response or error
   */
  async updateIdempotencyKey(
    request: UpdateIdempotencyKeyRequest
  ): Promise<IdempotencyRecord | null> {
    const operationId = this.generateOperationId('update');
    const startTime = Date.now();
    
    try {
      this.activeOperations.set(operationId, { startTime, operation: 'update' });

      logger.debug('Updating idempotency key', {
        key: request.key,
        status: request.status,
        operationId
      });

      // Validate response size if provided
      if (request.responseMetadata) {
        this.validateResponseSize(request.responseMetadata);
      }

      // Update the record
      const record = await this.repository.updateIdempotencyKey(request);

      if (!record) {
        logger.warn('Attempted to update non-existent idempotency key', {
          key: request.key,
          operationId
        });
        return null;
      }

      this.recordMetric('key_updated', Date.now() - startTime);

      // Emit appropriate events
      if (request.status === IdempotencyStatus.COMPLETED) {
        this.emitEvent(IdempotencyEventType.PROCESSING_COMPLETED, request.key, record.tenantId, {
          record,
          operationId
        });
      } else if (request.status === IdempotencyStatus.FAILED) {
        this.emitEvent(IdempotencyEventType.PROCESSING_FAILED, request.key, record.tenantId, {
          record,
          error: request.errorMessage,
          operationId
        });
      } else {
        this.emitEvent(IdempotencyEventType.KEY_UPDATED, request.key, record.tenantId, {
          record,
          operationId
        });
      }

      logger.debug('Idempotency key updated successfully', {
        key: request.key,
        status: request.status,
        operationId,
        duration: Date.now() - startTime
      });

      return record;

    } catch (error) {
      this.recordMetric('key_update_error', Date.now() - startTime);
      
      logger.error('Failed to update idempotency key', {
        key: request.key,
        error: error.message,
        operationId,
        duration: Date.now() - startTime
      });

      throw new IdempotencyStorageError('update', error);
    } finally {
      this.activeOperations.delete(operationId);
    }
  }

  /**
   * Wait for a concurrent request to complete
   */
  async waitForCompletion(
    key: string,
    tenantId?: string,
    timeoutMs?: number
  ): Promise<IdempotencyCheckResult> {
    const operationId = this.generateOperationId('wait');
    const startTime = Date.now();
    const timeout = timeoutMs || this.config.waitTimeoutMs;
    
    try {
      this.activeOperations.set(operationId, { startTime, operation: 'wait' });

      logger.debug('Waiting for idempotency key completion', {
        key,
        tenantId,
        timeout,
        operationId
      });

      const maxRetries = Math.floor(timeout / this.config.pollingIntervalMs);
      let retries = 0;

      while (retries < maxRetries) {
        const record = await this.repository.getIdempotencyKey(key, tenantId);
        
        if (!record) {
          // Key disappeared - can proceed
          return {
            exists: false,
            shouldProceed: true,
            shouldWait: false
          };
        }

        switch (record.status) {
          case IdempotencyStatus.COMPLETED:
            this.recordMetric('wait_completed', Date.now() - startTime);
            return {
              exists: true,
              record,
              shouldProceed: false,
              shouldWait: false,
              cachedResponse: record.responseMetadata
            };

          case IdempotencyStatus.FAILED:
            // Allow retry if within retry limits
            if (record.retryCount < record.maxRetries) {
              this.recordMetric('wait_retry_allowed', Date.now() - startTime);
              return {
                exists: true,
                record,
                shouldProceed: true,
                shouldWait: false
              };
            }
            break;

          case IdempotencyStatus.EXPIRED:
            this.recordMetric('wait_expired', Date.now() - startTime);
            return {
              exists: true,
              record,
              shouldProceed: true,
              shouldWait: false
            };
        }

        // Still processing, wait and retry
        await this.sleep(this.config.pollingIntervalMs);
        retries++;
      }

      // Timeout reached
      this.recordMetric('wait_timeout', Date.now() - startTime);
      
      throw new IdempotencyTimeoutError(key, timeout);

    } catch (error) {
      if (!(error instanceof IdempotencyTimeoutError)) {
        this.recordMetric('wait_error', Date.now() - startTime);
      }
      
      logger.error('Failed waiting for idempotency key completion', {
        key,
        error: error.message,
        operationId,
        duration: Date.now() - startTime
      });

      throw error;
    } finally {
      this.activeOperations.delete(operationId);
    }
  }

  /**
   * Execute operation within a distributed transaction
   */
  async executeInDistributedTransaction(
    transactionId: string,
    operations: TransactionOperation[],
    tenantId?: string
  ): Promise<DistributedTransactionContext> {
    if (!this.twoPhaseCommitCoordinator) {
      throw new IdempotencyError(
        'Distributed transactions not enabled',
        'DISTRIBUTED_TRANSACTIONS_DISABLED'
      );
    }

    const startTime = Date.now();
    
    try {
      logger.info('Starting distributed transaction', {
        transactionId,
        operationCount: operations.length,
        tenantId
      });

      // Begin transaction
      const context = await this.twoPhaseCommitCoordinator.beginTransaction(
        transactionId,
        operations,
        tenantId
      );

      // Execute the 2PC protocol
      const success = await this.twoPhaseCommitCoordinator.commitTransaction(
        transactionId,
        operations
      );

      if (success) {
        this.recordMetric('distributed_transaction_committed', Date.now() - startTime);
        logger.info('Distributed transaction committed successfully', {
          transactionId,
          duration: Date.now() - startTime
        });
      } else {
        this.recordMetric('distributed_transaction_aborted', Date.now() - startTime);
        logger.warn('Distributed transaction aborted', {
          transactionId,
          duration: Date.now() - startTime
        });
      }

      return context;

    } catch (error) {
      this.recordMetric('distributed_transaction_error', Date.now() - startTime);
      
      logger.error('Distributed transaction failed', {
        transactionId,
        error: error.message,
        duration: Date.now() - startTime
      });

      throw error;
    }
  }

  /**
   * Execute operation within a saga
   */
  async executeInSaga(
    sagaId: string,
    steps: SagaStep[],
    tenantId?: string
  ): Promise<any[]> {
    if (!this.sagaOrchestrator) {
      throw new IdempotencyError(
        'Saga orchestration not enabled',
        'SAGA_ORCHESTRATION_DISABLED'
      );
    }

    const startTime = Date.now();
    
    try {
      logger.info('Starting saga execution', {
        sagaId,
        stepCount: steps.length,
        tenantId
      });

      const results = await this.sagaOrchestrator.executeSaga(sagaId, steps, tenantId);

      this.recordMetric('saga_completed', Date.now() - startTime);
      
      logger.info('Saga execution completed successfully', {
        sagaId,
        stepCount: steps.length,
        duration: Date.now() - startTime
      });

      return results;

    } catch (error) {
      this.recordMetric('saga_error', Date.now() - startTime);
      
      logger.error('Saga execution failed', {
        sagaId,
        error: error.message,
        duration: Date.now() - startTime
      });

      throw error;
    }
  }

  /**
   * Cleanup expired idempotency keys
   */
  async cleanupExpiredKeys(tenantId?: string): Promise<number> {
    const startTime = Date.now();
    
    try {
      logger.debug('Starting cleanup of expired keys', { tenantId });

      const deletedCount = await this.repository.cleanupExpiredKeys(
        tenantId,
        this.config.batchSize
      );

      this.recordMetric('cleanup_executed', Date.now() - startTime);

      if (deletedCount > 0) {
        this.emitEvent(IdempotencyEventType.CLEANUP_PERFORMED, '', tenantId, {
          deletedCount
        });

        logger.info('Cleanup completed', {
          tenantId,
          deletedCount,
          duration: Date.now() - startTime
        });
      }

      return deletedCount;

    } catch (error) {
      this.recordMetric('cleanup_error', Date.now() - startTime);
      
      logger.error('Cleanup failed', {
        tenantId,
        error: error.message,
        duration: Date.now() - startTime
      });

      throw new IdempotencyStorageError('cleanup', error);
    }
  }

  /**
   * Get idempotency statistics
   */
  async getStatistics(
    tenantId?: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<IdempotencyStatistics> {
    const startTime = Date.now();
    
    try {
      const stats = await this.repository.getStatistics(tenantId, startDate, endDate);
      
      // Add performance metrics
      const performanceStats = this.getPerformanceStatistics();
      stats.averageProcessingTimeMs = performanceStats.averageProcessingTime;
      
      this.recordMetric('statistics_collected', Date.now() - startTime);
      
      this.emitEvent(IdempotencyEventType.STATISTICS_COLLECTED, '', tenantId, {
        statistics: stats
      });

      return stats;

    } catch (error) {
      this.recordMetric('statistics_error', Date.now() - startTime);
      
      logger.error('Failed to get statistics', {
        tenantId,
        error: error.message
      });

      throw new IdempotencyStorageError('statistics', error);
    }
  }

  /**
   * Get current service health
   */
  async getHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    activeOperations: number;
    pendingRequests: number;
    metrics: Record<string, number>;
    storage: {
      redis: boolean;
      postgresql: boolean;
    };
  }> {
    try {
      const performanceStats = this.getPerformanceStatistics();
      
      // Check storage health
      let redisHealthy = true;
      let pgHealthy = true;
      
      if (this.redis) {
        try {
          await this.redis.ping();
        } catch {
          redisHealthy = false;
        }
      }

      try {
        await this.fastify.db.query('SELECT 1');
      } catch {
        pgHealthy = false;
      }

      const storageIssues = (!redisHealthy && this.config.useRedis) || 
                           (!pgHealthy && this.config.usePostgreSQL);

      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      
      if (storageIssues) {
        status = this.config.preferredStorage === 'both' ? 'degraded' : 'unhealthy';
      } else if (performanceStats.averageProcessingTime > this.config.slowOperationThresholdMs) {
        status = 'degraded';
      }

      return {
        status,
        activeOperations: this.activeOperations.size,
        pendingRequests: this.pendingRequests.size,
        metrics: {
          averageProcessingTime: performanceStats.averageProcessingTime,
          totalOperations: performanceStats.totalOperations,
          errorRate: performanceStats.errorRate
        },
        storage: {
          redis: redisHealthy,
          postgresql: pgHealthy
        }
      };

    } catch (error) {
      logger.error('Health check failed', { error: error.message });
      
      return {
        status: 'unhealthy',
        activeOperations: this.activeOperations.size,
        pendingRequests: this.pendingRequests.size,
        metrics: {},
        storage: { redis: false, postgresql: false }
      };
    }
  }

  /**
   * Shutdown the service gracefully
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down idempotency service');

    // Stop background processes
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    if (this.statisticsTimer) {
      clearInterval(this.statisticsTimer);
    }
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
    }

    // Wait for active operations to complete (with timeout)
    const shutdownTimeout = 30000; // 30 seconds
    const startTime = Date.now();
    
    while (this.activeOperations.size > 0 && (Date.now() - startTime) < shutdownTimeout) {
      logger.debug('Waiting for active operations to complete', {
        activeCount: this.activeOperations.size
      });
      await this.sleep(1000);
    }

    // Cleanup coordinators
    if (this.twoPhaseCommitCoordinator) {
      await this.twoPhaseCommitCoordinator.destroy();
    }
    if (this.sagaOrchestrator) {
      await this.sagaOrchestrator.destroy();
    }

    // Clear remaining state
    this.activeOperations.clear();
    this.pendingRequests.clear();
    this.performanceMetrics.clear();

    logger.info('Idempotency service shutdown completed');
  }

  // Private helper methods

  private validateCreateRequest(request: CreateIdempotencyKeyRequest): void {
    if (!request.key || typeof request.key !== 'string') {
      throw new IdempotencyError('Invalid idempotency key', 'INVALID_KEY');
    }

    if (request.key.length < 8 || request.key.length > 128) {
      throw new IdempotencyError('Idempotency key length must be between 8 and 128 characters', 'INVALID_KEY_LENGTH');
    }

    if (this.config.requireSecureKeys && this.config.keyValidationPattern) {
      if (!this.config.keyValidationPattern.test(request.key)) {
        throw new IdempotencyError('Idempotency key format is invalid', 'INVALID_KEY_FORMAT');
      }
    }

    if (!request.requestMetadata) {
      throw new IdempotencyError('Request metadata is required', 'MISSING_METADATA');
    }

    const ttlMinutes = request.expirationMinutes || (this.config.defaultTtlHours * 60);
    if (ttlMinutes < this.config.minTtlMinutes || ttlMinutes > (this.config.maxTtlHours * 60)) {
      throw new IdempotencyError(
        `TTL must be between ${this.config.minTtlMinutes} minutes and ${this.config.maxTtlHours} hours`,
        'INVALID_TTL'
      );
    }
  }

  private validateResponseSize(responseMetadata: IdempotencyResponseMetadata): void {
    const bodySize = typeof responseMetadata.body === 'string' 
      ? Buffer.byteLength(responseMetadata.body, 'utf8')
      : JSON.stringify(responseMetadata.body).length;

    if (bodySize > this.config.maxResponseSizeBytes) {
      throw new IdempotencyError(
        `Response size ${bodySize} exceeds maximum ${this.config.maxResponseSizeBytes} bytes`,
        'RESPONSE_TOO_LARGE'
      );
    }
  }

  private createFingerprint(metadata: IdempotencyRequestMetadata): string {
    const fingerprintData = {
      method: metadata.method,
      url: metadata.url,
      contentType: metadata.contentType,
      tenantId: metadata.tenantId,
      userId: metadata.userId,
      body: metadata.body
    };
    
    const crypto = require('crypto');
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(fingerprintData, Object.keys(fingerprintData).sort()))
      .digest('hex');
  }

  private generateOperationId(operation: string): string {
    return `${operation}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getPendingKey(key: string, tenantId?: string): string {
    return tenantId ? `${tenantId}:${key}` : key;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private recordMetric(operation: string, duration: number): void {
    if (!this.config.enableMetrics) return;

    const metrics = this.performanceMetrics.get(operation) || [];
    metrics.push(duration);
    
    // Keep only recent measurements
    if (metrics.length > 1000) {
      metrics.splice(0, metrics.length - 1000);
    }
    
    this.performanceMetrics.set(operation, metrics);
  }

  private getPerformanceStatistics(): {
    averageProcessingTime: number;
    totalOperations: number;
    errorRate: number;
  } {
    let totalDuration = 0;
    let totalOperations = 0;
    let totalErrors = 0;

    for (const [operation, durations] of this.performanceMetrics.entries()) {
      totalOperations += durations.length;
      totalDuration += durations.reduce((sum, d) => sum + d, 0);
      
      if (operation.endsWith('_error')) {
        totalErrors += durations.length;
      }
    }

    return {
      averageProcessingTime: totalOperations > 0 ? totalDuration / totalOperations : 0,
      totalOperations,
      errorRate: totalOperations > 0 ? (totalErrors / totalOperations) * 100 : 0
    };
  }

  private emitEvent(
    eventType: IdempotencyEventType,
    idempotencyKey: string,
    tenantId?: string,
    metadata?: any
  ): void {
    const event: IdempotencyEvent = {
      eventType,
      idempotencyKey,
      tenantId,
      timestamp: new Date(),
      metadata
    };

    this.emit('idempotencyEvent', event);

    // Log important events
    if (this.config.enableDetailedLogging || 
        [IdempotencyEventType.CONFLICT_DETECTED, IdempotencyEventType.PROCESSING_FAILED].includes(eventType)) {
      logger.info('Idempotency event emitted', event);
    }
  }

  private startBackgroundProcesses(): void {
    // Cleanup timer
    if (this.config.cleanupEnabled) {
      this.cleanupTimer = setInterval(async () => {
        try {
          await this.cleanupExpiredKeys();
        } catch (error) {
          logger.error('Background cleanup failed', { error: error.message });
        }
      }, this.config.cleanupIntervalMinutes * 60 * 1000);
    }

    // Statistics collection timer
    if (this.config.enableMetrics) {
      this.statisticsTimer = setInterval(async () => {
        try {
          // Collect global statistics
          await this.getStatistics();
        } catch (error) {
          logger.error('Statistics collection failed', { error: error.message });
        }
      }, 10 * 60 * 1000); // Every 10 minutes
    }

    // Monitoring timer for active operations
    this.monitoringTimer = setInterval(() => {
      const now = Date.now();
      let staleOperations = 0;

      for (const [operationId, { startTime, operation }] of this.activeOperations.entries()) {
        const duration = now - startTime;
        
        if (duration > this.config.slowOperationThresholdMs * 2) {
          logger.warn('Stale operation detected', {
            operationId,
            operation,
            duration
          });
          staleOperations++;
        }
      }

      if (staleOperations > 0) {
        logger.warn('Multiple stale operations detected', {
          staleCount: staleOperations,
          totalActive: this.activeOperations.size
        });
      }
    }, 60 * 1000); // Every minute
  }
}

export default IdempotencyService;