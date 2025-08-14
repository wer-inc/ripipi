/**
 * Booking Lock Management Utility
 * Implements distributed locking with Redis for double-booking prevention
 */

import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { logger } from '../config/logger.js';
import { BookingLockInfo } from '../types/booking.js';
import { InternalServerError, ConflictError } from './errors.js';

/**
 * Lock priority levels for handling deadlock prevention
 */
export enum LockPriority {
  LOW = 1,
  NORMAL = 2,
  HIGH = 3,
  CRITICAL = 4
}

/**
 * Lock configuration options
 */
export interface BookingLockConfig {
  defaultTtlSeconds: number;
  maxRetries: number;
  retryDelayMs: number;
  deadlockDetectionEnabled: boolean;
  lockTimeoutMs: number;
  maxConcurrentLocks: number;
}

/**
 * Lock acquisition options
 */
export interface LockAcquisitionOptions {
  ttlSeconds?: number;
  priority?: LockPriority;
  timeoutMs?: number;
  retries?: number;
  waitForLock?: boolean;
  metadata?: Record<string, any>;
}

/**
 * Lock result information
 */
export interface LockResult {
  success: boolean;
  lockInfo?: BookingLockInfo;
  error?: string;
  waitTime?: number;
  retryCount?: number;
}

/**
 * Deadlock detection information
 */
interface DeadlockInfo {
  lockKey: string;
  waitingFor: string[];
  heldBy: string;
  detectedAt: Date;
}

/**
 * Lock statistics
 */
export interface LockStatistics {
  totalLocks: number;
  activeLocks: number;
  lockAcquisitions: number;
  lockReleases: number;
  lockTimeouts: number;
  lockConflicts: number;
  averageLockTime: number;
  deadlocksDetected: number;
  peakConcurrentLocks: number;
}

/**
 * Distributed booking lock manager using Redis
 */
export class BookingLockManager {
  private readonly redis: any;
  private readonly config: BookingLockConfig;
  private readonly lockStats: LockStatistics;
  private readonly activeLocks: Map<string, BookingLockInfo>;
  private readonly lockWaiters: Map<string, Array<{
    resolve: (result: LockResult) => void;
    reject: (error: Error) => void;
    priority: LockPriority;
    requestedAt: Date;
  }>>;

  // Lua scripts for atomic operations
  private readonly luaScripts = {
    ACQUIRE_LOCK: `
      local key = KEYS[1]
      local value = ARGV[1]
      local ttl = tonumber(ARGV[2])
      local current_time = tonumber(ARGV[3])
      
      -- Check if lock exists
      local current = redis.call('GET', key)
      if current == false then
        -- Lock doesn't exist, acquire it
        redis.call('SET', key, value, 'EX', ttl)
        return {1, value, ttl}
      elseif current == value then
        -- Same lock holder, extend TTL
        redis.call('EXPIRE', key, ttl)
        return {1, value, ttl}
      else
        -- Lock held by someone else
        local remaining_ttl = redis.call('TTL', key)
        return {0, current, remaining_ttl}
      end
    `,

    RELEASE_LOCK: `
      local key = KEYS[1]
      local value = ARGV[1]
      
      local current = redis.call('GET', key)
      if current == value then
        redis.call('DEL', key)
        return 1
      else
        return 0
      end
    `,

    EXTEND_LOCK: `
      local key = KEYS[1]
      local value = ARGV[1]
      local ttl = tonumber(ARGV[2])
      
      local current = redis.call('GET', key)
      if current == value then
        redis.call('EXPIRE', key, ttl)
        return 1
      else
        return 0
      end
    `,

    MULTI_LOCK_ACQUIRE: `
      local keys = KEYS
      local value = ARGV[1]
      local ttl = tonumber(ARGV[2])
      local current_time = tonumber(ARGV[3])
      
      -- Check all locks first
      for i = 1, #keys do
        local current = redis.call('GET', keys[i])
        if current ~= false and current ~= value then
          return {0, i, current}
        end
      end
      
      -- All locks available, acquire them
      for i = 1, #keys do
        redis.call('SET', keys[i], value, 'EX', ttl)
      end
      
      return {1, #keys, value}
    `,

    MULTI_LOCK_RELEASE: `
      local keys = KEYS
      local value = ARGV[1]
      local released = 0
      
      for i = 1, #keys do
        local current = redis.call('GET', keys[i])
        if current == value then
          redis.call('DEL', keys[i])
          released = released + 1
        end
      end
      
      return released
    `
  };

  constructor(
    fastify: FastifyInstance,
    config: Partial<BookingLockConfig> = {}
  ) {
    this.redis = fastify.redis.primary;
    this.config = {
      defaultTtlSeconds: config.defaultTtlSeconds || 300, // 5 minutes
      maxRetries: config.maxRetries || 3,
      retryDelayMs: config.retryDelayMs || 100,
      deadlockDetectionEnabled: config.deadlockDetectionEnabled !== false,
      lockTimeoutMs: config.lockTimeoutMs || 10000, // 10 seconds
      maxConcurrentLocks: config.maxConcurrentLocks || 1000,
      ...config
    };

    this.lockStats = {
      totalLocks: 0,
      activeLocks: 0,
      lockAcquisitions: 0,
      lockReleases: 0,
      lockTimeouts: 0,
      lockConflicts: 0,
      averageLockTime: 0,
      deadlocksDetected: 0,
      peakConcurrentLocks: 0
    };

    this.activeLocks = new Map();
    this.lockWaiters = new Map();

    // Start deadlock detection if enabled
    if (this.config.deadlockDetectionEnabled) {
      this.startDeadlockDetection();
    }

    // Start lock cleanup
    this.startLockCleanup();
  }

  /**
   * Acquire a lock for specific resource and time slots
   */
  async acquireLock(
    resourceId: string,
    timeSlotIds: string[],
    tenantId: string,
    options: LockAcquisitionOptions = {}
  ): Promise<LockResult> {
    const startTime = Date.now();
    const lockValue = this.generateLockValue(tenantId);
    const ttlSeconds = options.ttlSeconds || this.config.defaultTtlSeconds;
    const priority = options.priority || LockPriority.NORMAL;
    const timeoutMs = options.timeoutMs || this.config.lockTimeoutMs;
    const maxRetries = options.retries || this.config.maxRetries;

    try {
      // Check concurrent lock limit
      if (this.activeLocks.size >= this.config.maxConcurrentLocks) {
        return {
          success: false,
          error: 'Maximum concurrent locks exceeded'
        };
      }

      // Generate ordered lock keys to prevent deadlocks
      const lockKeys = this.generateLockKeys(resourceId, timeSlotIds);
      const sortedKeys = lockKeys.sort(); // Consistent ordering

      let retryCount = 0;
      let lastError: string | undefined;

      while (retryCount <= maxRetries) {
        try {
          // Try to acquire all locks atomically
          const result = await this.acquireMultipleLocks(
            sortedKeys,
            lockValue,
            ttlSeconds
          );

          if (result.success) {
            const lockInfo: BookingLockInfo = {
              lockKey: sortedKeys[0], // Primary lock key
              lockValue,
              ttlSeconds,
              acquiredAt: new Date(),
              expiresAt: new Date(Date.now() + ttlSeconds * 1000),
              resourceId,
              timeSlotIds
            };

            // Track the lock
            this.activeLocks.set(lockValue, lockInfo);
            this.updateStats('acquire', startTime, true);

            logger.debug('Lock acquired successfully', {
              resourceId,
              timeSlotIds,
              lockValue: lockValue.substring(0, 8) + '...',
              ttlSeconds,
              retryCount
            });

            return {
              success: true,
              lockInfo,
              waitTime: Date.now() - startTime,
              retryCount
            };
          }

          lastError = result.error;

          // Handle lock conflicts
          if (options.waitForLock && retryCount < maxRetries) {
            // Add to waiters queue with priority
            const waitResult = await this.waitForLockRelease(
              sortedKeys,
              priority,
              timeoutMs - (Date.now() - startTime)
            );

            if (waitResult.success) {
              // Try again after waiting
              retryCount++;
              continue;
            } else {
              lastError = waitResult.error;
              break;
            }
          }

          break;

        } catch (error) {
          lastError = `Lock acquisition failed: ${error.message}`;
          logger.error('Lock acquisition error', {
            resourceId,
            timeSlotIds,
            retryCount,
            error
          });

          if (retryCount < maxRetries) {
            await this.sleep(this.config.retryDelayMs * Math.pow(2, retryCount));
            retryCount++;
          } else {
            break;
          }
        }
      }

      this.updateStats('acquire', startTime, false);
      this.lockStats.lockConflicts++;

      return {
        success: false,
        error: lastError || 'Failed to acquire lock after retries',
        waitTime: Date.now() - startTime,
        retryCount
      };

    } catch (error) {
      logger.error('Lock acquisition failed', {
        resourceId,
        timeSlotIds,
        error
      });

      this.updateStats('acquire', startTime, false);

      return {
        success: false,
        error: `Lock acquisition failed: ${error.message}`
      };
    }
  }

  /**
   * Release a lock
   */
  async releaseLock(lockInfo: BookingLockInfo): Promise<boolean> {
    const startTime = Date.now();

    try {
      const lockKeys = this.generateLockKeys(
        lockInfo.resourceId,
        lockInfo.timeSlotIds
      );

      // Release all locks atomically
      const released = await this.redis.eval(
        this.luaScripts.MULTI_LOCK_RELEASE,
        lockKeys.length,
        ...lockKeys,
        lockInfo.lockValue
      );

      if (released > 0) {
        // Remove from active locks
        this.activeLocks.delete(lockInfo.lockValue);
        this.updateStats('release', startTime, true);

        // Notify waiters
        this.notifyWaiters(lockKeys);

        logger.debug('Lock released successfully', {
          resourceId: lockInfo.resourceId,
          timeSlotIds: lockInfo.timeSlotIds,
          lockValue: lockInfo.lockValue.substring(0, 8) + '...',
          releasedCount: released
        });

        return true;
      }

      logger.warn('Lock release failed - lock not owned', {
        resourceId: lockInfo.resourceId,
        lockValue: lockInfo.lockValue.substring(0, 8) + '...'
      });

      return false;

    } catch (error) {
      logger.error('Lock release failed', {
        resourceId: lockInfo.resourceId,
        lockValue: lockInfo.lockValue.substring(0, 8) + '...',
        error
      });

      this.updateStats('release', startTime, false);
      return false;
    }
  }

  /**
   * Extend lock TTL
   */
  async extendLock(
    lockInfo: BookingLockInfo,
    additionalSeconds: number
  ): Promise<boolean> {
    try {
      const lockKeys = this.generateLockKeys(
        lockInfo.resourceId,
        lockInfo.timeSlotIds
      );

      let allExtended = true;
      for (const key of lockKeys) {
        const result = await this.redis.eval(
          this.luaScripts.EXTEND_LOCK,
          1,
          key,
          lockInfo.lockValue,
          lockInfo.ttlSeconds + additionalSeconds
        );

        if (result !== 1) {
          allExtended = false;
          break;
        }
      }

      if (allExtended) {
        // Update lock info
        lockInfo.ttlSeconds += additionalSeconds;
        lockInfo.expiresAt = new Date(
          lockInfo.expiresAt.getTime() + additionalSeconds * 1000
        );

        logger.debug('Lock extended successfully', {
          resourceId: lockInfo.resourceId,
          additionalSeconds,
          newExpiresAt: lockInfo.expiresAt
        });

        return true;
      }

      return false;

    } catch (error) {
      logger.error('Lock extension failed', {
        resourceId: lockInfo.resourceId,
        error
      });
      return false;
    }
  }

  /**
   * Check if locks are available without acquiring them
   */
  async checkLocksAvailable(
    resourceId: string,
    timeSlotIds: string[]
  ): Promise<boolean> {
    try {
      const lockKeys = this.generateLockKeys(resourceId, timeSlotIds);

      for (const key of lockKeys) {
        const exists = await this.redis.exists(key);
        if (exists) {
          return false;
        }
      }

      return true;

    } catch (error) {
      logger.error('Lock availability check failed', {
        resourceId,
        timeSlotIds,
        error
      });
      return false;
    }
  }

  /**
   * Get lock statistics
   */
  getStatistics(): LockStatistics {
    return { ...this.lockStats };
  }

  /**
   * Clear expired locks and update statistics
   */
  async cleanupExpiredLocks(): Promise<number> {
    let cleanedCount = 0;

    try {
      const now = new Date();
      for (const [lockValue, lockInfo] of this.activeLocks.entries()) {
        if (lockInfo.expiresAt < now) {
          await this.releaseLock(lockInfo);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        logger.info('Cleaned up expired locks', { cleanedCount });
      }

    } catch (error) {
      logger.error('Lock cleanup failed', { error });
    }

    return cleanedCount;
  }

  // Private helper methods

  private generateLockValue(tenantId: string): string {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    return `${tenantId}:${timestamp}:${random}`;
  }

  private generateLockKeys(resourceId: string, timeSlotIds: string[]): string[] {
    return timeSlotIds.map(slotId => `booking_lock:${resourceId}:${slotId}`);
  }

  private async acquireMultipleLocks(
    keys: string[],
    value: string,
    ttlSeconds: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const currentTime = Date.now();
      const result = await this.redis.eval(
        this.luaScripts.MULTI_LOCK_ACQUIRE,
        keys.length,
        ...keys,
        value,
        ttlSeconds,
        currentTime
      );

      if (result[0] === 1) {
        return { success: true };
      } else {
        const conflictIndex = result[1];
        const conflictValue = result[2];
        return {
          success: false,
          error: `Lock conflict at index ${conflictIndex} (held by ${conflictValue.substring(0, 8)}...)`
        };
      }

    } catch (error) {
      return {
        success: false,
        error: `Redis operation failed: ${error.message}`
      };
    }
  }

  private async waitForLockRelease(
    lockKeys: string[],
    priority: LockPriority,
    timeoutMs: number
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({
          success: false,
          error: 'Lock wait timeout'
        });
      }, timeoutMs);

      // Add to waiters queue (simplified implementation)
      const waiter = {
        resolve: (result: LockResult) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          resolve({
            success: false,
            error: error.message
          });
        },
        priority,
        requestedAt: new Date()
      };

      const waitKey = lockKeys[0]; // Use first key as representative
      if (!this.lockWaiters.has(waitKey)) {
        this.lockWaiters.set(waitKey, []);
      }
      this.lockWaiters.get(waitKey)!.push(waiter);
    });
  }

  private notifyWaiters(lockKeys: string[]): void {
    for (const key of lockKeys) {
      const waiters = this.lockWaiters.get(key);
      if (waiters && waiters.length > 0) {
        // Sort by priority and request time
        waiters.sort((a, b) => {
          if (a.priority !== b.priority) {
            return b.priority - a.priority; // Higher priority first
          }
          return a.requestedAt.getTime() - b.requestedAt.getTime();
        });

        // Notify the highest priority waiter
        const waiter = waiters.shift();
        if (waiter) {
          waiter.resolve({ success: true });
        }

        if (waiters.length === 0) {
          this.lockWaiters.delete(key);
        }
      }
    }
  }

  private updateStats(
    operation: 'acquire' | 'release',
    startTime: number,
    success: boolean
  ): void {
    const duration = Date.now() - startTime;

    if (operation === 'acquire') {
      this.lockStats.lockAcquisitions++;
      if (success) {
        this.lockStats.activeLocks++;
        this.lockStats.peakConcurrentLocks = Math.max(
          this.lockStats.peakConcurrentLocks,
          this.lockStats.activeLocks
        );
      }
    } else if (operation === 'release') {
      this.lockStats.lockReleases++;
      if (success) {
        this.lockStats.activeLocks = Math.max(0, this.lockStats.activeLocks - 1);
      }
    }

    // Update average lock time (simplified)
    this.lockStats.averageLockTime = 
      (this.lockStats.averageLockTime + duration) / 2;
  }

  private startDeadlockDetection(): void {
    setInterval(() => {
      this.detectDeadlocks();
    }, 10000); // Check every 10 seconds
  }

  private startLockCleanup(): void {
    setInterval(() => {
      this.cleanupExpiredLocks();
    }, 60000); // Cleanup every minute
  }

  private async detectDeadlocks(): Promise<void> {
    // Simplified deadlock detection
    // In production, implement more sophisticated graph-based detection
    try {
      const now = new Date();
      for (const [lockValue, lockInfo] of this.activeLocks.entries()) {
        if (lockInfo.expiresAt < now) {
          logger.warn('Potential deadlock detected - expired lock still active', {
            lockValue: lockValue.substring(0, 8) + '...',
            resourceId: lockInfo.resourceId,
            expiresAt: lockInfo.expiresAt
          });

          this.lockStats.deadlocksDetected++;
          await this.releaseLock(lockInfo);
        }
      }
    } catch (error) {
      logger.error('Deadlock detection failed', { error });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default BookingLockManager;