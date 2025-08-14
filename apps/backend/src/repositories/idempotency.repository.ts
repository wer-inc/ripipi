/**
 * Idempotency Repository
 * Database operations for idempotency key management with Redis and PostgreSQL support
 */

import { PoolClient } from 'pg';
import { Redis } from 'ioredis';
import { withTransaction, TransactionContext } from '../db/transaction.js';
import { db } from '../db/index.js';
import { logger } from '../config/logger.js';
import {
  IdempotencyRecord,
  IdempotencyStatus,
  CreateIdempotencyKeyRequest,
  UpdateIdempotencyKeyRequest,
  IdempotencyCheckResult,
  IdempotencyStatistics,
  IdempotencyStorageError,
  IdempotencyConflictType,
  IdempotencyServiceConfig,
  IdempotencyRequestMetadata,
  IdempotencyResponseMetadata
} from '../types/idempotency.js';

export interface IdempotencyRepositoryOptions {
  useRedis: boolean;
  usePostgreSQL: boolean;
  preferredStorage: 'redis' | 'postgresql' | 'both';
  redisKeyPrefix: string;
  enableCompression: boolean;
  maxRetries: number;
  operationTimeoutMs: number;
}

/**
 * Enhanced Idempotency Repository with dual storage support
 */
export class IdempotencyRepository {
  private redis?: Redis;
  private options: IdempotencyRepositoryOptions;
  
  private readonly TABLE_NAME = 'idempotency_keys';
  private readonly REDIS_KEY_PREFIX: string;
  private readonly LOCK_PREFIX: string;
  private readonly STATS_PREFIX: string;

  constructor(
    redis?: Redis,
    options: Partial<IdempotencyRepositoryOptions> = {}
  ) {
    this.redis = redis;
    this.options = {
      useRedis: !!redis,
      usePostgreSQL: true,
      preferredStorage: 'both',
      redisKeyPrefix: 'idempotency:',
      enableCompression: true,
      maxRetries: 3,
      operationTimeoutMs: 5000,
      ...options
    };

    this.REDIS_KEY_PREFIX = this.options.redisKeyPrefix;
    this.LOCK_PREFIX = `${this.REDIS_KEY_PREFIX}lock:`;
    this.STATS_PREFIX = `${this.REDIS_KEY_PREFIX}stats:`;
  }

  /**
   * Create a new idempotency key record
   */
  async createIdempotencyKey(
    request: CreateIdempotencyKeyRequest
  ): Promise<IdempotencyRecord> {
    const startTime = Date.now();
    
    try {
      logger.debug('Creating idempotency key', {
        key: request.key,
        tenantId: request.tenantId,
        userId: request.userId
      });

      const expiresAt = new Date(
        Date.now() + (request.expirationMinutes || 1440) * 60 * 1000 // Default 24 hours
      );

      const record: IdempotencyRecord = {
        id: this.generateId(),
        idempotencyKey: request.key,
        requestFingerprint: this.createFingerprint(request.requestMetadata),
        status: IdempotencyStatus.PENDING,
        tenantId: request.tenantId,
        userId: request.userId,
        sessionId: request.sessionId,
        requestMetadata: request.requestMetadata,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt,
        retryCount: 0,
        maxRetries: request.maxRetries || 3,
        transactionId: request.transactionId,
        sagaId: request.sagaId
      };

      // Try to create in both storages based on configuration
      let created = false;
      
      if (this.options.preferredStorage === 'redis' && this.redis) {
        created = await this.createInRedis(record);
        if (created && this.options.usePostgreSQL) {
          // Async replication to PostgreSQL
          setImmediate(() => this.createInPostgreSQL(record).catch(err => 
            logger.warn('Failed to replicate to PostgreSQL', { error: err.message })
          ));
        }
      } else if (this.options.preferredStorage === 'postgresql') {
        created = await this.createInPostgreSQL(record);
        if (created && this.options.useRedis && this.redis) {
          // Async cache in Redis
          setImmediate(() => this.createInRedis(record).catch(err =>
            logger.warn('Failed to cache in Redis', { error: err.message })
          ));
        }
      } else {
        // Both storages - ensure consistency
        const [redisResult, pgResult] = await Promise.allSettled([
          this.options.useRedis && this.redis ? this.createInRedis(record) : Promise.resolve(false),
          this.options.usePostgreSQL ? this.createInPostgreSQL(record) : Promise.resolve(false)
        ]);

        created = (redisResult.status === 'fulfilled' && redisResult.value) ||
                  (pgResult.status === 'fulfilled' && pgResult.value);
      }

      if (!created) {
        throw new IdempotencyStorageError('Failed to create idempotency key in any storage');
      }

      // Update statistics
      await this.updateStatistics('key_created', record.tenantId);

      const duration = Date.now() - startTime;
      logger.debug('Idempotency key created successfully', {
        key: request.key,
        duration,
        recordId: record.id
      });

      return record;

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Failed to create idempotency key', {
        key: request.key,
        duration,
        error: error.message
      });
      
      if (error instanceof IdempotencyStorageError) {
        throw error;
      }
      
      throw new IdempotencyStorageError('create', error);
    }
  }

  /**
   * Get idempotency key record
   */
  async getIdempotencyKey(
    key: string,
    tenantId?: string
  ): Promise<IdempotencyRecord | null> {
    const startTime = Date.now();
    
    try {
      logger.debug('Getting idempotency key', { key, tenantId });

      let record: IdempotencyRecord | null = null;

      // Try Redis first if configured
      if (this.options.useRedis && this.redis) {
        record = await this.getFromRedis(key, tenantId);
      }

      // Fallback to PostgreSQL if not found in Redis
      if (!record && this.options.usePostgreSQL) {
        record = await this.getFromPostgreSQL(key, tenantId);
        
        // Cache in Redis if found and Redis is enabled
        if (record && this.options.useRedis && this.redis) {
          setImmediate(() => this.cacheInRedis(record!).catch(err =>
            logger.warn('Failed to cache record in Redis', { error: err.message })
          ));
        }
      }

      const duration = Date.now() - startTime;
      logger.debug('Idempotency key retrieval completed', {
        key,
        found: !!record,
        duration,
        status: record?.status
      });

      return record;

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Failed to get idempotency key', {
        key,
        duration,
        error: error.message
      });
      
      throw new IdempotencyStorageError('get', error);
    }
  }

  /**
   * Update idempotency key record
   */
  async updateIdempotencyKey(
    request: UpdateIdempotencyKeyRequest
  ): Promise<IdempotencyRecord | null> {
    const startTime = Date.now();
    
    try {
      logger.debug('Updating idempotency key', {
        key: request.key,
        status: request.status
      });

      // Get current record first
      const currentRecord = await this.getIdempotencyKey(request.key);
      if (!currentRecord) {
        logger.warn('Attempted to update non-existent idempotency key', {
          key: request.key
        });
        return null;
      }

      // Prepare updated record
      const updatedRecord: IdempotencyRecord = {
        ...currentRecord,
        status: request.status,
        updatedAt: new Date(),
        responseMetadata: request.responseMetadata,
        errorMessage: request.errorMessage,
        errorCode: request.errorCode,
        errorDetails: request.errorDetails,
        processingDurationMs: request.processingDurationMs,
        lockAcquisitionTimeMs: request.lockAcquisitionTimeMs,
        databaseTimeMs: request.databaseTimeMs,
        compensationRequired: request.compensationRequired
      };

      if (request.status === IdempotencyStatus.COMPLETED) {
        updatedRecord.completedAt = new Date();
        updatedRecord.processingCompletedAt = new Date();
      }

      // Update in configured storages
      const updatePromises = [];
      
      if (this.options.useRedis && this.redis) {
        updatePromises.push(this.updateInRedis(updatedRecord));
      }
      
      if (this.options.usePostgreSQL) {
        updatePromises.push(this.updateInPostgreSQL(updatedRecord));
      }

      const results = await Promise.allSettled(updatePromises);
      const hasSuccessful = results.some(result => 
        result.status === 'fulfilled' && result.value
      );

      if (!hasSuccessful) {
        throw new IdempotencyStorageError('Failed to update idempotency key in any storage');
      }

      // Log failed updates
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const storage = index === 0 ? 'Redis' : 'PostgreSQL';
          logger.warn(`Failed to update in ${storage}`, {
            key: request.key,
            error: result.reason?.message
          });
        }
      });

      // Update statistics
      await this.updateStatistics('key_updated', updatedRecord.tenantId, request.status);

      const duration = Date.now() - startTime;
      logger.debug('Idempotency key updated successfully', {
        key: request.key,
        status: request.status,
        duration
      });

      return updatedRecord;

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Failed to update idempotency key', {
        key: request.key,
        duration,
        error: error.message
      });
      
      if (error instanceof IdempotencyStorageError) {
        throw error;
      }
      
      throw new IdempotencyStorageError('update', error);
    }
  }

  /**
   * Check idempotency key and return processing instructions
   */
  async checkIdempotencyKey(
    key: string,
    requestMetadata: IdempotencyRequestMetadata,
    tenantId?: string
  ): Promise<IdempotencyCheckResult> {
    const startTime = Date.now();
    
    try {
      logger.debug('Checking idempotency key', { key, tenantId });

      const record = await this.getIdempotencyKey(key, tenantId);
      
      if (!record) {
        const duration = Date.now() - startTime;
        logger.debug('Idempotency key not found', { key, duration });
        
        return {
          exists: false,
          shouldProceed: true,
          shouldWait: false
        };
      }

      // Check if key is expired
      if (record.expiresAt && record.expiresAt < new Date()) {
        const duration = Date.now() - startTime;
        logger.debug('Idempotency key expired', { key, expiresAt: record.expiresAt, duration });
        
        // Mark as expired and clean up
        setImmediate(() => this.expireKey(key, tenantId));
        
        return {
          exists: true,
          record,
          conflict: {
            type: IdempotencyConflictType.KEY_EXPIRED,
            message: 'Idempotency key has expired'
          },
          shouldProceed: true,
          shouldWait: false
        };
      }

      // Check fingerprint match
      const requestFingerprint = this.createFingerprint(requestMetadata);
      if (record.requestFingerprint !== requestFingerprint) {
        const duration = Date.now() - startTime;
        logger.warn('Idempotency fingerprint mismatch', {
          key,
          existing: record.requestFingerprint,
          request: requestFingerprint,
          duration
        });
        
        return {
          exists: true,
          record,
          conflict: {
            type: IdempotencyConflictType.FINGERPRINT_MISMATCH,
            message: 'Request fingerprint does not match existing key',
            details: {
              existingFingerprint: record.requestFingerprint,
              requestFingerprint
            }
          },
          shouldProceed: false,
          shouldWait: false
        };
      }

      // Handle different statuses
      switch (record.status) {
        case IdempotencyStatus.COMPLETED:
          const duration = Date.now() - startTime;
          logger.debug('Returning cached response for completed key', {
            key,
            duration
          });
          
          return {
            exists: true,
            record,
            shouldProceed: false,
            shouldWait: false,
            cachedResponse: record.responseMetadata
          };

        case IdempotencyStatus.PROCESSING:
        case IdempotencyStatus.PENDING:
          const waitDuration = Date.now() - startTime;
          logger.debug('Idempotency key is being processed', {
            key,
            status: record.status,
            duration: waitDuration
          });
          
          return {
            exists: true,
            record,
            conflict: {
              type: IdempotencyConflictType.CONCURRENT_PROCESSING,
              message: 'Request is currently being processed'
            },
            shouldProceed: false,
            shouldWait: true,
            waitTimeMs: 100 // Suggest 100ms wait
          };

        case IdempotencyStatus.FAILED:
          // Allow retry if within retry limits
          if (record.retryCount < record.maxRetries) {
            const retryDuration = Date.now() - startTime;
            logger.debug('Allowing retry for failed idempotency key', {
              key,
              retryCount: record.retryCount,
              maxRetries: record.maxRetries,
              duration: retryDuration
            });
            
            return {
              exists: true,
              record,
              shouldProceed: true,
              shouldWait: false
            };
          } else {
            const failedDuration = Date.now() - startTime;
            logger.debug('Max retries exceeded for failed key', {
              key,
              retryCount: record.retryCount,
              duration: failedDuration
            });
            
            return {
              exists: true,
              record,
              conflict: {
                type: IdempotencyConflictType.INVALID_STATE,
                message: 'Maximum retries exceeded for failed request'
              },
              shouldProceed: false,
              shouldWait: false
            };
          }

        default:
          const invalidDuration = Date.now() - startTime;
          logger.warn('Invalid idempotency key status', {
            key,
            status: record.status,
            duration: invalidDuration
          });
          
          return {
            exists: true,
            record,
            conflict: {
              type: IdempotencyConflictType.INVALID_STATE,
              message: `Invalid key status: ${record.status}`
            },
            shouldProceed: false,
            shouldWait: false
          };
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Failed to check idempotency key', {
        key,
        duration,
        error: error.message
      });
      
      throw new IdempotencyStorageError('check', error);
    }
  }

  /**
   * Delete expired idempotency keys
   */
  async cleanupExpiredKeys(
    tenantId?: string,
    batchSize: number = 100
  ): Promise<number> {
    const startTime = Date.now();
    
    try {
      logger.debug('Starting cleanup of expired keys', { tenantId, batchSize });

      let totalDeleted = 0;

      // Cleanup from PostgreSQL
      if (this.options.usePostgreSQL) {
        const pgDeleted = await this.cleanupExpiredFromPostgreSQL(tenantId, batchSize);
        totalDeleted += pgDeleted;
      }

      // Cleanup from Redis
      if (this.options.useRedis && this.redis) {
        const redisDeleted = await this.cleanupExpiredFromRedis(tenantId, batchSize);
        totalDeleted += redisDeleted;
      }

      // Update statistics
      if (totalDeleted > 0) {
        await this.updateStatistics('keys_cleaned', tenantId, totalDeleted);
      }

      const duration = Date.now() - startTime;
      logger.debug('Cleanup completed', {
        tenantId,
        totalDeleted,
        duration
      });

      return totalDeleted;

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Failed to cleanup expired keys', {
        tenantId,
        duration,
        error: error.message
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
      logger.debug('Getting idempotency statistics', { tenantId, startDate, endDate });

      // Get from PostgreSQL (more reliable for statistics)
      const stats = await this.getStatisticsFromPostgreSQL(tenantId, startDate, endDate);

      const duration = Date.now() - startTime;
      logger.debug('Statistics retrieved successfully', {
        tenantId,
        duration,
        totalKeys: stats.totalKeys
      });

      return stats;

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Failed to get statistics', {
        tenantId,
        duration,
        error: error.message
      });
      
      throw new IdempotencyStorageError('statistics', error);
    }
  }

  // Private helper methods

  private generateId(): string {
    return `idem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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

  // Redis operations
  private async createInRedis(record: IdempotencyRecord): Promise<boolean> {
    if (!this.redis) return false;
    
    try {
      const key = `${this.REDIS_KEY_PREFIX}${record.idempotencyKey}`;
      const ttl = Math.floor((record.expiresAt.getTime() - Date.now()) / 1000);
      
      const result = await this.redis.set(
        key,
        JSON.stringify(record),
        'EX',
        ttl,
        'NX'
      );
      
      return result === 'OK';
    } catch (error) {
      logger.error('Failed to create in Redis', { error: error.message });
      return false;
    }
  }

  private async getFromRedis(
    key: string,
    tenantId?: string
  ): Promise<IdempotencyRecord | null> {
    if (!this.redis) return null;
    
    try {
      const redisKey = `${this.REDIS_KEY_PREFIX}${key}`;
      const data = await this.redis.get(redisKey);
      
      if (!data) return null;
      
      const record = JSON.parse(data) as IdempotencyRecord;
      
      // Convert date strings back to Date objects
      record.createdAt = new Date(record.createdAt);
      record.updatedAt = new Date(record.updatedAt);
      record.expiresAt = new Date(record.expiresAt);
      if (record.completedAt) record.completedAt = new Date(record.completedAt);
      if (record.processingStartedAt) record.processingStartedAt = new Date(record.processingStartedAt);
      if (record.processingCompletedAt) record.processingCompletedAt = new Date(record.processingCompletedAt);
      
      return record;
    } catch (error) {
      logger.error('Failed to get from Redis', { key, error: error.message });
      return null;
    }
  }

  private async updateInRedis(record: IdempotencyRecord): Promise<boolean> {
    if (!this.redis) return false;
    
    try {
      const key = `${this.REDIS_KEY_PREFIX}${record.idempotencyKey}`;
      const ttl = Math.floor((record.expiresAt.getTime() - Date.now()) / 1000);
      
      const result = await this.redis.set(
        key,
        JSON.stringify(record),
        'EX',
        ttl
      );
      
      return result === 'OK';
    } catch (error) {
      logger.error('Failed to update in Redis', { error: error.message });
      return false;
    }
  }

  private async cacheInRedis(record: IdempotencyRecord): Promise<boolean> {
    return this.updateInRedis(record);
  }

  private async cleanupExpiredFromRedis(
    tenantId?: string,
    batchSize: number
  ): Promise<number> {
    if (!this.redis) return 0;
    
    try {
      // Redis TTL handles expiration automatically, but we can scan for expired keys
      const pattern = `${this.REDIS_KEY_PREFIX}*`;
      let cursor = '0';
      let deleted = 0;
      let processed = 0;
      
      do {
        const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', batchSize);
        cursor = nextCursor;
        
        for (const key of keys) {
          if (processed >= batchSize) break;
          
          const ttl = await this.redis.ttl(key);
          if (ttl === -2) { // Key doesn't exist (expired)
            deleted++;
          }
          processed++;
        }
        
        if (processed >= batchSize) break;
      } while (cursor !== '0');
      
      return deleted;
    } catch (error) {
      logger.error('Failed to cleanup from Redis', { error: error.message });
      return 0;
    }
  }

  // PostgreSQL operations
  private async createInPostgreSQL(record: IdempotencyRecord): Promise<boolean> {
    try {
      return await withTransaction(async (ctx: TransactionContext) => {
        const query = `
          INSERT INTO ${this.TABLE_NAME} (
            id, idempotency_key, request_fingerprint, status, tenant_id, user_id, session_id,
            request_metadata, created_at, updated_at, expires_at, retry_count, max_retries,
            transaction_id, saga_id
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
          )
          ON CONFLICT (idempotency_key, COALESCE(tenant_id, '')) DO NOTHING
          RETURNING id
        `;
        
        const result = await ctx.query(query, [
          record.id,
          record.idempotencyKey,
          record.requestFingerprint,
          record.status,
          record.tenantId,
          record.userId,
          record.sessionId,
          JSON.stringify(record.requestMetadata),
          record.createdAt,
          record.updatedAt,
          record.expiresAt,
          record.retryCount,
          record.maxRetries,
          record.transactionId,
          record.sagaId
        ]);
        
        return result.rows.length > 0;
      });
    } catch (error) {
      logger.error('Failed to create in PostgreSQL', { error: error.message });
      return false;
    }
  }

  private async getFromPostgreSQL(
    key: string,
    tenantId?: string
  ): Promise<IdempotencyRecord | null> {
    try {
      const query = tenantId
        ? `SELECT * FROM ${this.TABLE_NAME} WHERE idempotency_key = $1 AND tenant_id = $2`
        : `SELECT * FROM ${this.TABLE_NAME} WHERE idempotency_key = $1 AND tenant_id IS NULL`;
      
      const params = tenantId ? [key, tenantId] : [key];
      const result = await db.query(query, params);
      
      if (result.rows.length === 0) return null;
      
      const row = result.rows[0];
      return this.mapRowToRecord(row);
    } catch (error) {
      logger.error('Failed to get from PostgreSQL', { key, error: error.message });
      return null;
    }
  }

  private async updateInPostgreSQL(record: IdempotencyRecord): Promise<boolean> {
    try {
      return await withTransaction(async (ctx: TransactionContext) => {
        const query = `
          UPDATE ${this.TABLE_NAME}
          SET status = $1, updated_at = $2, response_metadata = $3, error_message = $4,
              error_code = $5, error_details = $6, processing_duration_ms = $7,
              lock_acquisition_time_ms = $8, database_time_ms = $9, completed_at = $10,
              processing_completed_at = $11, compensation_required = $12
          WHERE idempotency_key = $13 AND (tenant_id = $14 OR (tenant_id IS NULL AND $14 IS NULL))
          RETURNING id
        `;
        
        const result = await ctx.query(query, [
          record.status,
          record.updatedAt,
          record.responseMetadata ? JSON.stringify(record.responseMetadata) : null,
          record.errorMessage,
          record.errorCode,
          record.errorDetails ? JSON.stringify(record.errorDetails) : null,
          record.processingDurationMs,
          record.lockAcquisitionTimeMs,
          record.databaseTimeMs,
          record.completedAt,
          record.processingCompletedAt,
          record.compensationRequired,
          record.idempotencyKey,
          record.tenantId
        ]);
        
        return result.rows.length > 0;
      });
    } catch (error) {
      logger.error('Failed to update in PostgreSQL', { error: error.message });
      return false;
    }
  }

  private async cleanupExpiredFromPostgreSQL(
    tenantId?: string,
    batchSize: number
  ): Promise<number> {
    try {
      return await withTransaction(async (ctx: TransactionContext) => {
        const query = tenantId
          ? `DELETE FROM ${this.TABLE_NAME} WHERE tenant_id = $1 AND expires_at <= NOW() AND id IN (
               SELECT id FROM ${this.TABLE_NAME} WHERE tenant_id = $1 AND expires_at <= NOW() LIMIT $2
             )`
          : `DELETE FROM ${this.TABLE_NAME} WHERE expires_at <= NOW() AND id IN (
               SELECT id FROM ${this.TABLE_NAME} WHERE expires_at <= NOW() LIMIT $1
             )`;
        
        const params = tenantId ? [tenantId, batchSize] : [batchSize];
        const result = await ctx.query(query, params);
        
        return result.rowCount || 0;
      });
    } catch (error) {
      logger.error('Failed to cleanup from PostgreSQL', { error: error.message });
      return 0;
    }
  }

  private async getStatisticsFromPostgreSQL(
    tenantId?: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<IdempotencyStatistics> {
    try {
      // Build base query with optional filters
      let whereClause = '1=1';
      const params: any[] = [];
      let paramCount = 0;

      if (tenantId) {
        whereClause += ` AND tenant_id = $${++paramCount}`;
        params.push(tenantId);
      }

      if (startDate) {
        whereClause += ` AND created_at >= $${++paramCount}`;
        params.push(startDate);
      }

      if (endDate) {
        whereClause += ` AND created_at <= $${++paramCount}`;
        params.push(endDate);
      }

      const query = `
        SELECT 
          COUNT(*) as total_keys,
          COUNT(CASE WHEN status = 'pending' OR status = 'processing' THEN 1 END) as active_keys,
          COUNT(CASE WHEN expires_at <= NOW() THEN 1 END) as expired_keys,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_keys,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_keys,
          AVG(CASE WHEN processing_duration_ms IS NOT NULL THEN processing_duration_ms END) as avg_processing_time,
          AVG(CASE WHEN lock_acquisition_time_ms IS NOT NULL THEN lock_acquisition_time_ms END) as avg_lock_time,
          AVG(CASE WHEN database_time_ms IS NOT NULL THEN database_time_ms END) as avg_database_time,
          SUM(CASE WHEN response_metadata IS NOT NULL THEN LENGTH(response_metadata::text) ELSE 0 END) as total_storage_bytes
        FROM ${this.TABLE_NAME}
        WHERE ${whereClause}
      `;

      const result = await db.query(query, params);
      const row = result.rows[0];

      const totalKeys = parseInt(row.total_keys || '0');
      const completedKeys = parseInt(row.completed_keys || '0');
      const failedKeys = parseInt(row.failed_keys || '0');

      return {
        totalKeys,
        activeKeys: parseInt(row.active_keys || '0'),
        expiredKeys: parseInt(row.expired_keys || '0'),
        completedKeys,
        failedKeys,
        successRate: totalKeys > 0 ? (completedKeys / totalKeys) * 100 : 0,
        conflictRate: 0, // TODO: Track conflicts separately
        expirationRate: totalKeys > 0 ? (parseInt(row.expired_keys || '0') / totalKeys) * 100 : 0,
        averageProcessingTimeMs: parseFloat(row.avg_processing_time || '0'),
        averageLockAcquisitionTimeMs: parseFloat(row.avg_lock_time || '0'),
        averageDatabaseTimeMs: parseFloat(row.avg_database_time || '0'),
        totalStorageBytes: parseInt(row.total_storage_bytes || '0'),
        averageResponseSize: 0, // TODO: Calculate this
        requestsPerHour: 0, // TODO: Calculate this
        peakConcurrency: 0, // TODO: Track this
        errorsByType: {},
        conflictsByType: {},
        collectedAt: new Date(),
        periodStart: startDate || new Date(0),
        periodEnd: endDate || new Date()
      };

    } catch (error) {
      logger.error('Failed to get statistics from PostgreSQL', { error: error.message });
      throw error;
    }
  }

  private mapRowToRecord(row: any): IdempotencyRecord {
    return {
      id: row.id,
      idempotencyKey: row.idempotency_key,
      requestFingerprint: row.request_fingerprint,
      status: row.status,
      tenantId: row.tenant_id,
      userId: row.user_id,
      sessionId: row.session_id,
      requestMetadata: row.request_metadata,
      responseMetadata: row.response_metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      completedAt: row.completed_at,
      processingStartedAt: row.processing_started_at,
      processingCompletedAt: row.processing_completed_at,
      processingDurationMs: row.processing_duration_ms,
      errorMessage: row.error_message,
      errorCode: row.error_code,
      errorDetails: row.error_details,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      transactionId: row.transaction_id,
      sagaId: row.saga_id,
      compensationRequired: row.compensation_required,
      lockAcquisitionTimeMs: row.lock_acquisition_time_ms,
      databaseTimeMs: row.database_time_ms,
      totalProcessingTimeMs: row.total_processing_time_ms
    };
  }

  private async updateStatistics(
    operation: string,
    tenantId?: string,
    additionalData?: any
  ): Promise<void> {
    try {
      if (!this.redis) return;

      const statsKey = `${this.STATS_PREFIX}${tenantId || 'global'}:${new Date().toISOString().split('T')[0]}`;
      const field = operation;
      
      await this.redis.hincrby(statsKey, field, 1);
      await this.redis.expire(statsKey, 7 * 24 * 60 * 60); // 7 days
      
      if (additionalData) {
        await this.redis.hset(statsKey, `${field}_data`, JSON.stringify(additionalData));
      }
    } catch (error) {
      // Don't throw for statistics updates
      logger.warn('Failed to update statistics', { error: error.message });
    }
  }

  private async expireKey(key: string, tenantId?: string): Promise<void> {
    try {
      await this.updateIdempotencyKey({
        key,
        status: IdempotencyStatus.EXPIRED
      });
    } catch (error) {
      logger.error('Failed to expire key', { key, error: error.message });
    }
  }
}

export default IdempotencyRepository;