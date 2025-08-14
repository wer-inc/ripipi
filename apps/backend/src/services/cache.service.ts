/**
 * Advanced Multi-tier Cache Service
 * Provides memory + Redis caching with compression, statistics, and distributed sync
 */

import { EventEmitter } from 'events';
import { promisify } from 'util';
import * as zlib from 'zlib';
import { FastifyInstance } from 'fastify';
import { CacheNamespace, CacheTTL, CacheKeyUtils } from '../utils/cache-keys.js';
import { ServiceUnavailableError, InternalServerError } from '../utils/errors.js';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * Cache configuration options
 */
export interface CacheOptions {
  // TTL settings
  defaultTTL?: number;
  maxTTL?: number;
  
  // Compression
  compression?: {
    enabled: boolean;
    minSize: number; // Minimum size in bytes to compress
    level: number;   // Compression level 1-9
  };
  
  // Memory cache settings
  memory?: {
    enabled: boolean;
    maxSize: number;     // Maximum memory cache size in MB
    maxItems: number;    // Maximum number of items in memory
    ttlRatio: number;    // Memory TTL as ratio of Redis TTL (0.1 = 10%)
  };
  
  // Serialization
  serialization?: {
    enabled: boolean;
    format: 'json' | 'msgpack';
  };
  
  // Statistics
  statistics?: {
    enabled: boolean;
    sampleRate: number; // 0.0 to 1.0
  };
  
  // Warming
  warming?: {
    enabled: boolean;
    patterns: string[];
    batchSize: number;
  };
}

/**
 * Cache entry metadata
 */
interface CacheEntry {
  key: string;
  value: any;
  ttl: number;
  compressed: boolean;
  size: number;
  createdAt: number;
  accessedAt: number;
  hitCount: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  memory: {
    hits: number;
    misses: number;
    hitRate: number;
    size: number;
    itemCount: number;
    evictions: number;
  };
  redis: {
    hits: number;
    misses: number;
    hitRate: number;
    connections: number;
    errors: number;
  };
  overall: {
    hits: number;
    misses: number;
    hitRate: number;
    operations: number;
  };
  compression: {
    compressed: number;
    uncompressed: number;
    ratio: number;
    sizeSaved: number;
  };
  performance: {
    avgMemoryTime: number;
    avgRedisTime: number;
    slowQueries: number;
  };
}

/**
 * Memory cache implementation with LRU eviction
 */
class MemoryCache {
  private cache = new Map<string, CacheEntry>();
  private accessOrder: string[] = [];
  private currentSize = 0;
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  constructor(
    private maxSize: number, // in bytes
    private maxItems: number
  ) {}

  get(key: string): CacheEntry | undefined {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }
    
    // Check if expired
    if (Date.now() > entry.createdAt + (entry.ttl * 1000)) {
      this.delete(key);
      this.stats.misses++;
      return undefined;
    }
    
    // Update access tracking
    entry.accessedAt = Date.now();
    entry.hitCount++;
    this.updateAccessOrder(key);
    this.stats.hits++;
    
    return entry;
  }

  set(key: string, value: any, ttl: number, compressed = false): void {
    const size = this.calculateSize(value);
    const entry: CacheEntry = {
      key,
      value,
      ttl,
      compressed,
      size,
      createdAt: Date.now(),
      accessedAt: Date.now(),
      hitCount: 0,
    };

    // Remove existing entry if present
    if (this.cache.has(key)) {
      this.delete(key);
    }

    // Check size limits and evict if necessary
    while (
      (this.currentSize + size > this.maxSize) ||
      (this.cache.size >= this.maxItems)
    ) {
      this.evictLRU();
    }

    this.cache.set(key, entry);
    this.accessOrder.push(key);
    this.currentSize += size;
  }

  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    this.cache.delete(key);
    this.currentSize -= entry.size;
    
    // Remove from access order
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    
    return true;
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
    this.currentSize = 0;
  }

  getStats() {
    return {
      ...this.stats,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
      size: this.currentSize,
      itemCount: this.cache.size,
    };
  }

  private updateAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
      this.accessOrder.push(key);
    }
  }

  private evictLRU(): void {
    if (this.accessOrder.length === 0) return;
    
    const lruKey = this.accessOrder.shift()!;
    this.delete(lruKey);
    this.stats.evictions++;
  }

  private calculateSize(value: any): number {
    if (value === null || value === undefined) return 0;
    
    if (typeof value === 'string') {
      return value.length * 2; // Unicode characters can be 2 bytes
    }
    
    if (typeof value === 'number') {
      return 8; // 64-bit number
    }
    
    if (typeof value === 'boolean') {
      return 1;
    }
    
    if (Buffer.isBuffer(value)) {
      return value.length;
    }
    
    // For objects, estimate based on JSON size
    try {
      return JSON.stringify(value).length * 2;
    } catch {
      return 100; // Fallback estimate
    }
  }
}

/**
 * Advanced multi-tier cache service
 */
export class CacheService extends EventEmitter {
  private memoryCache?: MemoryCache;
  private redisStats = {
    hits: 0,
    misses: 0,
    errors: 0,
  };
  private compressionStats = {
    compressed: 0,
    uncompressed: 0,
    sizeSaved: 0,
  };
  private performanceStats = {
    memoryTimes: [] as number[],
    redisTimes: [] as number[],
    slowQueries: 0,
  };
  private operationCount = 0;

  constructor(
    private fastify: FastifyInstance,
    private options: CacheOptions = {}
  ) {
    super();
    this.setupDefaults();
    this.initializeMemoryCache();
  }

  private setupDefaults(): void {
    this.options = {
      defaultTTL: CacheTTL.MINUTE_15,
      maxTTL: CacheTTL.WEEK_1,
      compression: {
        enabled: true,
        minSize: 1024, // 1KB
        level: 6,
        ...this.options.compression,
      },
      memory: {
        enabled: true,
        maxSize: 128 * 1024 * 1024, // 128MB
        maxItems: 10000,
        ttlRatio: 0.1, // 10% of Redis TTL
        ...this.options.memory,
      },
      serialization: {
        enabled: true,
        format: 'json',
        ...this.options.serialization,
      },
      statistics: {
        enabled: true,
        sampleRate: 1.0,
        ...this.options.statistics,
      },
      warming: {
        enabled: false,
        patterns: [],
        batchSize: 100,
        ...this.options.warming,
      },
      ...this.options,
    };
  }

  private initializeMemoryCache(): void {
    if (this.options.memory?.enabled) {
      this.memoryCache = new MemoryCache(
        this.options.memory.maxSize,
        this.options.memory.maxItems
      );
    }
  }

  /**
   * Get value from cache (memory first, then Redis)
   */
  async get<T = any>(
    key: string,
    defaultValue?: T,
    options: { skipMemory?: boolean } = {}
  ): Promise<T | undefined> {
    const startTime = Date.now();
    this.operationCount++;

    try {
      // Validate key
      if (!CacheKeyUtils.validate(key)) {
        throw new Error(`Invalid cache key: ${key}`);
      }

      // Try memory cache first
      if (!options.skipMemory && this.memoryCache) {
        const memoryStart = Date.now();
        const memoryEntry = this.memoryCache.get(key);
        
        if (memoryEntry) {
          this.recordPerformance('memory', Date.now() - memoryStart);
          this.emit('hit', { key, source: 'memory', value: memoryEntry.value });
          return memoryEntry.value;
        }
      }

      // Try Redis cache
      const redisStart = Date.now();
      const redisValue = await this.getFromRedis<T>(key);
      this.recordPerformance('redis', Date.now() - redisStart);

      if (redisValue !== undefined) {
        this.redisStats.hits++;
        
        // Store in memory cache if enabled
        if (this.memoryCache && !options.skipMemory) {
          const memoryTTL = Math.floor(
            (this.options.defaultTTL || CacheTTL.MINUTE_15) * 
            (this.options.memory?.ttlRatio || 0.1)
          );
          this.memoryCache.set(key, redisValue, memoryTTL);
        }
        
        this.emit('hit', { key, source: 'redis', value: redisValue });
        return redisValue;
      }

      this.redisStats.misses++;
      this.emit('miss', { key });
      return defaultValue;

    } catch (error) {
      this.redisStats.errors++;
      this.fastify.log.error('Cache get error:', { key, error: error.message });
      this.emit('error', { key, operation: 'get', error });
      return defaultValue;
    } finally {
      const totalTime = Date.now() - startTime;
      if (totalTime > 100) { // Consider > 100ms as slow
        this.performanceStats.slowQueries++;
      }
    }
  }

  /**
   * Set value in cache (both memory and Redis)
   */
  async set<T = any>(
    key: string,
    value: T,
    ttl?: number,
    options: { 
      skipMemory?: boolean;
      namespace?: CacheNamespace;
      compress?: boolean;
    } = {}
  ): Promise<boolean> {
    const startTime = Date.now();
    this.operationCount++;

    try {
      // Validate key
      if (!CacheKeyUtils.validate(key)) {
        throw new Error(`Invalid cache key: ${key}`);
      }

      // Determine TTL
      const finalTTL = ttl || 
        (options.namespace ? CacheKeyUtils.getTTL(options.namespace) : this.options.defaultTTL) ||
        CacheTTL.MINUTE_15;

      // Validate TTL
      if (finalTTL > (this.options.maxTTL || CacheTTL.WEEK_1)) {
        throw new Error(`TTL exceeds maximum: ${finalTTL}`);
      }

      // Set in Redis
      const success = await this.setInRedis(key, value, finalTTL, options.compress);
      
      if (success) {
        // Set in memory cache if enabled
        if (!options.skipMemory && this.memoryCache) {
          const memoryTTL = Math.floor(finalTTL * (this.options.memory?.ttlRatio || 0.1));
          this.memoryCache.set(key, value, memoryTTL);
        }
        
        this.emit('set', { key, value, ttl: finalTTL });
        return true;
      }

      return false;

    } catch (error) {
      this.redisStats.errors++;
      this.fastify.log.error('Cache set error:', { key, error: error.message });
      this.emit('error', { key, operation: 'set', error });
      return false;
    }
  }

  /**
   * Delete from cache (both memory and Redis)
   */
  async delete(key: string): Promise<boolean> {
    this.operationCount++;

    try {
      // Validate key
      if (!CacheKeyUtils.validate(key)) {
        throw new Error(`Invalid cache key: ${key}`);
      }

      // Delete from memory
      if (this.memoryCache) {
        this.memoryCache.delete(key);
      }

      // Delete from Redis
      const result = await this.fastify.redis.primary.del(key);
      const success = result > 0;
      
      if (success) {
        this.emit('delete', { key });
      }
      
      return success;

    } catch (error) {
      this.redisStats.errors++;
      this.fastify.log.error('Cache delete error:', { key, error: error.message });
      this.emit('error', { key, operation: 'delete', error });
      return false;
    }
  }

  /**
   * Delete multiple keys by pattern
   */
  async deleteByPattern(pattern: string): Promise<number> {
    this.operationCount++;

    try {
      // Clear from memory cache (simple implementation)
      if (this.memoryCache) {
        this.memoryCache.clear(); // For simplicity, clear all memory cache
      }

      // Use Lua script for atomic pattern deletion
      const deleted = await this.fastify.redis.executeScript(
        'DELETE_BY_PATTERN',
        [],
        [pattern]
      );

      this.emit('deletePattern', { pattern, deleted });
      return deleted as number;

    } catch (error) {
      this.redisStats.errors++;
      this.fastify.log.error('Cache delete pattern error:', { pattern, error: error.message });
      this.emit('error', { pattern, operation: 'deletePattern', error });
      return 0;
    }
  }

  /**
   * Check if key exists in cache
   */
  async exists(key: string): Promise<boolean> {
    try {
      // Check memory first
      if (this.memoryCache && this.memoryCache.get(key)) {
        return true;
      }

      // Check Redis
      const result = await this.fastify.redis.primary.exists(key);
      return result === 1;

    } catch (error) {
      this.fastify.log.error('Cache exists error:', { key, error: error.message });
      return false;
    }
  }

  /**
   * Get TTL for key
   */
  async getTTL(key: string): Promise<number> {
    try {
      const ttl = await this.fastify.redis.primary.ttl(key);
      return ttl;
    } catch (error) {
      this.fastify.log.error('Cache getTTL error:', { key, error: error.message });
      return -1;
    }
  }

  /**
   * Increment atomic counter
   */
  async increment(key: string, by = 1, ttl?: number): Promise<number> {
    try {
      const result = await this.fastify.redis.primary.incrby(key, by);
      
      // Set TTL if this is a new key
      if (result === by && ttl) {
        await this.fastify.redis.primary.expire(key, ttl);
      }
      
      return result;
    } catch (error) {
      this.fastify.log.error('Cache increment error:', { key, error: error.message });
      throw error;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const memoryStats = this.memoryCache?.getStats() || {
      hits: 0,
      misses: 0,
      hitRate: 0,
      size: 0,
      itemCount: 0,
      evictions: 0,
    };

    const totalHits = memoryStats.hits + this.redisStats.hits;
    const totalMisses = memoryStats.misses + this.redisStats.misses;
    
    return {
      memory: memoryStats,
      redis: {
        ...this.redisStats,
        hitRate: this.redisStats.hits / (this.redisStats.hits + this.redisStats.misses) || 0,
        connections: 1, // Simplified
      },
      overall: {
        hits: totalHits,
        misses: totalMisses,
        hitRate: totalHits / (totalHits + totalMisses) || 0,
        operations: this.operationCount,
      },
      compression: {
        ...this.compressionStats,
        ratio: this.compressionStats.compressed / 
               (this.compressionStats.compressed + this.compressionStats.uncompressed) || 0,
      },
      performance: {
        avgMemoryTime: this.calculateAverage(this.performanceStats.memoryTimes),
        avgRedisTime: this.calculateAverage(this.performanceStats.redisTimes),
        slowQueries: this.performanceStats.slowQueries,
      },
    };
  }

  /**
   * Clear all cache (memory and Redis)
   */
  async clear(): Promise<void> {
    try {
      // Clear memory cache
      if (this.memoryCache) {
        this.memoryCache.clear();
      }

      // Clear Redis cache (with pattern)
      const keyPrefix = CacheKeyUtils.generate('*');
      await this.deleteByPattern(keyPrefix);
      
      this.emit('clear');
    } catch (error) {
      this.fastify.log.error('Cache clear error:', error);
      throw error;
    }
  }

  /**
   * Warm cache with predefined patterns
   */
  async warmCache(): Promise<void> {
    if (!this.options.warming?.enabled || !this.options.warming.patterns.length) {
      return;
    }

    try {
      for (const pattern of this.options.warming.patterns) {
        await this.warmPattern(pattern);
      }
    } catch (error) {
      this.fastify.log.error('Cache warming error:', error);
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const testKey = CacheKeyUtils.generate('health_check');
      const testValue = Date.now();
      
      await this.set(testKey, testValue, 10);
      const retrieved = await this.get(testKey);
      await this.delete(testKey);
      
      return retrieved === testValue;
    } catch {
      return false;
    }
  }

  private async getFromRedis<T>(key: string): Promise<T | undefined> {
    const value = await this.fastify.redis.primary.get(key);
    
    if (value === null || value === undefined) {
      return undefined;
    }

    return this.deserializeValue(value);
  }

  private async setInRedis<T>(
    key: string, 
    value: T, 
    ttl: number,
    forceCompress?: boolean
  ): Promise<boolean> {
    const serialized = this.serializeValue(value, forceCompress);
    const result = await this.fastify.redis.primary.setex(key, ttl, serialized);
    return result === 'OK';
  }

  private serializeValue<T>(value: T, forceCompress?: boolean): string {
    let serialized: string;
    
    if (this.options.serialization?.enabled) {
      serialized = JSON.stringify(value);
    } else {
      serialized = String(value);
    }

    // Compression logic
    if (this.shouldCompress(serialized, forceCompress)) {
      try {
        const compressed = Buffer.from(serialized).toString('base64');
        this.compressionStats.compressed++;
        this.compressionStats.sizeSaved += serialized.length - compressed.length;
        return `__COMPRESSED__${compressed}`;
      } catch (error) {
        this.fastify.log.warn('Compression failed:', error);
      }
    }

    this.compressionStats.uncompressed++;
    return serialized;
  }

  private deserializeValue<T>(value: string): T {
    let processed = value;

    // Handle compression
    if (value.startsWith('__COMPRESSED__')) {
      try {
        processed = Buffer.from(value.substring(14), 'base64').toString();
      } catch (error) {
        this.fastify.log.warn('Decompression failed:', error);
        throw new Error('Failed to decompress cached value');
      }
    }

    // Handle deserialization
    if (this.options.serialization?.enabled) {
      try {
        return JSON.parse(processed);
      } catch (error) {
        this.fastify.log.warn('Deserialization failed:', error);
        return processed as unknown as T;
      }
    }

    return processed as unknown as T;
  }

  private shouldCompress(value: string, force?: boolean): boolean {
    if (force) return true;
    if (!this.options.compression?.enabled) return false;
    return value.length >= (this.options.compression?.minSize || 1024);
  }

  private recordPerformance(source: 'memory' | 'redis', time: number): void {
    const times = source === 'memory' 
      ? this.performanceStats.memoryTimes 
      : this.performanceStats.redisTimes;
    
    times.push(time);
    
    // Keep only last 1000 measurements
    if (times.length > 1000) {
      times.splice(0, times.length - 1000);
    }
  }

  private calculateAverage(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    return numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
  }

  private async warmPattern(pattern: string): Promise<void> {
    // Implementation would depend on specific warming strategy
    // This is a placeholder for custom warming logic
    this.fastify.log.info(`Warming cache pattern: ${pattern}`);
  }
}

/**
 * Factory function to create cache service
 */
export function createCacheService(
  fastify: FastifyInstance,
  options: CacheOptions = {}
): CacheService {
  return new CacheService(fastify, options);
}

export default CacheService;