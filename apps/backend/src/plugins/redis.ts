/**
 * Redis Fastify Plugin
 * Provides Redis connection management, pub/sub, Lua scripts, and failover handling
 */

import { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import Redis, { Cluster, RedisOptions, ClusterOptions } from 'ioredis';
import { config } from '../config/index.js';
import { ServiceUnavailableError } from '../utils/errors.js';

declare module 'fastify' {
  interface FastifyInstance {
    redis: {
      primary: Redis | Cluster;
      replica?: Redis | Cluster;
      publisher: Redis;
      subscriber: Redis;
      isCluster: boolean;
      isConnected: boolean;
      connectionPool: Map<string, Redis>;
      // Utility methods
      disconnect: () => Promise<void>;
      getConnection: (name?: string) => Redis | Cluster;
      executeScript: (script: string, keys: string[], args: string[]) => Promise<any>;
      // Health check
      healthCheck: () => Promise<boolean>;
      // Stats
      getStats: () => Promise<RedisStats>;
    };
  }
}

export interface RedisConfig {
  // Connection
  host: string;
  port: number;
  password?: string;
  db: number;
  url?: string;
  
  // Cluster config
  cluster?: {
    enabled: boolean;
    nodes: Array<{ host: string; port: number }>;
  };
  
  // Pool settings
  pool: {
    min: number;
    max: number;
    acquireTimeoutMs: number;
    createTimeoutMs: number;
    destroyTimeoutMs: number;
    idleTimeoutMs: number;
    reapIntervalMs: number;
  };
  
  // Connection settings
  connection: {
    connectTimeout: number;
    commandTimeout: number;
    retryDelayOnFailover: number;
    maxRetriesPerRequest: number;
    lazyConnect: boolean;
    keepAlive: number;
    family: 4 | 6;
  };
  
  // Sentinel (if using)
  sentinel?: {
    sentinels: Array<{ host: string; port: number }>;
    name: string;
  };
  
  // Performance
  keyPrefix?: string;
  enableReadyCheck: boolean;
  maxLoadingTimeout: number;
}

export interface RedisStats {
  connections: {
    total: number;
    active: number;
    idle: number;
  };
  memory: {
    used: number;
    peak: number;
    fragmentation: number;
  };
  operations: {
    totalCommands: number;
    instantaneousOps: number;
    keyspaceHits: number;
    keyspaceMisses: number;
  };
  replication: {
    role: string;
    connectedReplicas: number;
  };
}

// Default configuration
const getRedisConfig = (): RedisConfig => ({
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD || undefined,
  db: config.REDIS_DB,
  url: config.REDIS_URL || undefined,
  
  pool: {
    min: parseInt(process.env.REDIS_POOL_MIN || '5', 10),
    max: parseInt(process.env.REDIS_POOL_MAX || '20', 10),
    acquireTimeoutMs: parseInt(process.env.REDIS_ACQUIRE_TIMEOUT || '10000', 10),
    createTimeoutMs: parseInt(process.env.REDIS_CREATE_TIMEOUT || '5000', 10),
    destroyTimeoutMs: parseInt(process.env.REDIS_DESTROY_TIMEOUT || '5000', 10),
    idleTimeoutMs: parseInt(process.env.REDIS_IDLE_TIMEOUT || '300000', 10), // 5 minutes
    reapIntervalMs: parseInt(process.env.REDIS_REAP_INTERVAL || '60000', 10), // 1 minute
  },
  
  connection: {
    connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT || '10000', 10),
    commandTimeout: parseInt(process.env.REDIS_COMMAND_TIMEOUT || '5000', 10),
    retryDelayOnFailover: parseInt(process.env.REDIS_RETRY_DELAY || '100', 10),
    maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES || '3', 10),
    lazyConnect: process.env.REDIS_LAZY_CONNECT === 'true',
    keepAlive: parseInt(process.env.REDIS_KEEP_ALIVE || '30000', 10),
    family: (process.env.REDIS_IP_FAMILY as '4' | '6') || 4,
  },
  
  keyPrefix: process.env.REDIS_KEY_PREFIX || 'ripipi:',
  enableReadyCheck: process.env.REDIS_ENABLE_READY_CHECK !== 'false',
  maxLoadingTimeout: parseInt(process.env.REDIS_MAX_LOADING_TIMEOUT || '30000', 10),
});

// Common Lua scripts for atomic operations
const LUA_SCRIPTS = {
  // Rate limiting with sliding window
  RATE_LIMIT_SLIDING_WINDOW: `
    local key = KEYS[1]
    local window = tonumber(ARGV[1])
    local limit = tonumber(ARGV[2])
    local current_time = tonumber(ARGV[3])
    local identifier = ARGV[4]
    
    -- Remove expired entries
    redis.call('ZREMRANGEBYSCORE', key, '-inf', current_time - window)
    
    -- Count current requests
    local current_count = redis.call('ZCARD', key)
    
    if current_count < limit then
        -- Add current request
        redis.call('ZADD', key, current_time, identifier)
        redis.call('EXPIRE', key, window)
        return {1, limit - current_count - 1}
    else
        return {0, 0, redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')[2]}
    end
  `,
  
  // Cache with TTL
  SET_WITH_TTL: `
    local key = KEYS[1]
    local value = ARGV[1]
    local ttl = tonumber(ARGV[2])
    
    redis.call('SET', key, value, 'EX', ttl)
    return 'OK'
  `,
  
  // Distributed lock
  ACQUIRE_LOCK: `
    local key = KEYS[1]
    local value = ARGV[1]
    local ttl = tonumber(ARGV[2])
    
    local current = redis.call('GET', key)
    if current == false then
        redis.call('SET', key, value, 'EX', ttl)
        return 1
    elseif current == value then
        redis.call('EXPIRE', key, ttl)
        return 1
    else
        return 0
    end
  `,
  
  // Release distributed lock
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
  
  // Multi-key cache invalidation
  DELETE_BY_PATTERN: `
    local pattern = ARGV[1]
    local keys = redis.call('KEYS', pattern)
    local deleted = 0
    
    for i = 1, #keys do
        redis.call('DEL', keys[i])
        deleted = deleted + 1
    end
    
    return deleted
  `,
};

/**
 * Create Redis connection with proper configuration
 */
function createRedisConnection(
  redisConfig: RedisConfig,
  options: Partial<RedisOptions> = {}
): Redis | Cluster {
  const baseOptions: RedisOptions = {
    host: redisConfig.host,
    port: redisConfig.port,
    password: redisConfig.password,
    db: redisConfig.db,
    keyPrefix: redisConfig.keyPrefix,
    connectTimeout: redisConfig.connection.connectTimeout,
    commandTimeout: redisConfig.connection.commandTimeout,
    retryDelayOnFailover: redisConfig.connection.retryDelayOnFailover,
    maxRetriesPerRequest: redisConfig.connection.maxRetriesPerRequest,
    lazyConnect: redisConfig.connection.lazyConnect,
    keepAlive: redisConfig.connection.keepAlive,
    family: redisConfig.connection.family,
    enableReadyCheck: redisConfig.enableReadyCheck,
    maxLoadingTimeout: redisConfig.maxLoadingTimeout,
    ...options,
  };

  // Use URL if provided
  if (redisConfig.url) {
    return new Redis(redisConfig.url, baseOptions);
  }

  // Check for cluster configuration
  if (redisConfig.cluster?.enabled && redisConfig.cluster.nodes.length > 0) {
    const clusterOptions: ClusterOptions = {
      ...baseOptions,
      enableOfflineQueue: false,
      redisOptions: baseOptions,
    };
    return new Cluster(redisConfig.cluster.nodes, clusterOptions);
  }

  // Single instance
  return new Redis(baseOptions);
}

/**
 * Connection pool manager
 */
class RedisConnectionPool {
  private pool: Map<string, Redis> = new Map();
  private config: RedisConfig;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config: RedisConfig) {
    this.config = config;
    this.startCleanup();
  }

  getConnection(name: string = 'default'): Redis {
    let connection = this.pool.get(name);
    
    if (!connection) {
      connection = createRedisConnection(this.config) as Redis;
      this.pool.set(name, connection);
      
      // Handle connection events
      connection.on('error', (error) => {
        console.error(`Redis connection error (${name}):`, error);
        this.pool.delete(name);
      });
      
      connection.on('close', () => {
        console.info(`Redis connection closed (${name})`);
        this.pool.delete(name);
      });
    }
    
    return connection;
  }

  async disconnect(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    const promises = Array.from(this.pool.values()).map(conn => 
      conn.disconnect().catch(err => console.error('Error disconnecting Redis:', err))
    );
    
    await Promise.all(promises);
    this.pool.clear();
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      for (const [name, connection] of this.pool.entries()) {
        if (connection.status === 'end' || connection.status === 'close') {
          this.pool.delete(name);
        }
      }
    }, this.config.pool.reapIntervalMs);
  }

  get size(): number {
    return this.pool.size;
  }
}

/**
 * Redis Fastify plugin
 */
const redisPlugin: FastifyPluginAsync = async (fastify) => {
  const redisConfig = getRedisConfig();
  const connectionPool = new RedisConnectionPool(redisConfig);
  
  // Create primary connections
  const primary = createRedisConnection(redisConfig);
  const replica = createRedisConnection(redisConfig, { 
    enableOfflineQueue: false,
    readOnly: true 
  });
  
  // Create pub/sub connections
  const publisher = createRedisConnection(redisConfig, { 
    enableOfflineQueue: false 
  }) as Redis;
  const subscriber = createRedisConnection(redisConfig, { 
    enableOfflineQueue: false 
  }) as Redis;

  // Define Lua scripts
  const scriptShas: Map<string, string> = new Map();

  // Load Lua scripts
  async function loadScripts(): Promise<void> {
    try {
      for (const [name, script] of Object.entries(LUA_SCRIPTS)) {
        const sha = await (primary as Redis).script('LOAD', script);
        scriptShas.set(name, sha);
        fastify.log.debug(`Loaded Lua script: ${name} (${sha})`);
      }
    } catch (error) {
      fastify.log.error('Failed to load Lua scripts:', error);
      throw error;
    }
  }

  // Execute Lua script
  async function executeScript(
    scriptName: string, 
    keys: string[], 
    args: string[]
  ): Promise<any> {
    const sha = scriptShas.get(scriptName);
    if (!sha) {
      throw new Error(`Script not found: ${scriptName}`);
    }

    try {
      return await (primary as Redis).evalsha(sha, keys.length, ...keys, ...args);
    } catch (error) {
      // Try to reload script if it's not found in Redis
      if (error.message.includes('NOSCRIPT')) {
        const script = LUA_SCRIPTS[scriptName as keyof typeof LUA_SCRIPTS];
        const result = await (primary as Redis).eval(script, keys.length, ...keys, ...args);
        // Reload the script SHA
        const newSha = await (primary as Redis).script('LOAD', script);
        scriptShas.set(scriptName, newSha);
        return result;
      }
      throw error;
    }
  }

  // Health check function
  async function healthCheck(): Promise<boolean> {
    try {
      const result = await (primary as Redis).ping();
      return result === 'PONG';
    } catch (error) {
      fastify.log.error('Redis health check failed:', error);
      return false;
    }
  }

  // Get Redis stats
  async function getStats(): Promise<RedisStats> {
    try {
      const info = await (primary as Redis).info();
      const lines = info.split('\r\n');
      const stats: any = {};

      for (const line of lines) {
        if (line.includes(':')) {
          const [key, value] = line.split(':');
          stats[key] = isNaN(Number(value)) ? value : Number(value);
        }
      }

      return {
        connections: {
          total: stats.connected_clients || 0,
          active: stats.connected_clients || 0,
          idle: 0,
        },
        memory: {
          used: stats.used_memory || 0,
          peak: stats.used_memory_peak || 0,
          fragmentation: stats.mem_fragmentation_ratio || 0,
        },
        operations: {
          totalCommands: stats.total_commands_processed || 0,
          instantaneousOps: stats.instantaneous_ops_per_sec || 0,
          keyspaceHits: stats.keyspace_hits || 0,
          keyspaceMisses: stats.keyspace_misses || 0,
        },
        replication: {
          role: stats.role || 'unknown',
          connectedReplicas: stats.connected_slaves || 0,
        },
      };
    } catch (error) {
      fastify.log.error('Failed to get Redis stats:', error);
      throw new ServiceUnavailableError('Redis stats unavailable');
    }
  }

  // Disconnect function
  async function disconnect(): Promise<void> {
    await connectionPool.disconnect();
    
    const connections = [primary, replica, publisher, subscriber].filter(Boolean);
    const promises = connections.map(conn => 
      conn.disconnect().catch(err => 
        fastify.log.error('Error disconnecting Redis connection:', err)
      )
    );
    
    await Promise.all(promises);
    fastify.log.info('All Redis connections closed');
  }

  // Connection event handlers
  primary.on('connect', () => {
    fastify.log.info('Redis primary connected');
  });

  primary.on('ready', async () => {
    fastify.log.info('Redis primary ready');
    try {
      await loadScripts();
    } catch (error) {
      fastify.log.error('Failed to load scripts on ready:', error);
    }
  });

  primary.on('error', (error) => {
    fastify.log.error('Redis primary error:', error);
  });

  primary.on('close', () => {
    fastify.log.warn('Redis primary connection closed');
  });

  // Replica event handlers
  replica?.on('connect', () => {
    fastify.log.info('Redis replica connected');
  });

  replica?.on('error', (error) => {
    fastify.log.error('Redis replica error:', error);
  });

  // Publisher/Subscriber event handlers
  publisher.on('error', (error) => {
    fastify.log.error('Redis publisher error:', error);
  });

  subscriber.on('error', (error) => {
    fastify.log.error('Redis subscriber error:', error);
  });

  // Register the redis instance
  fastify.decorate('redis', {
    primary,
    replica,
    publisher,
    subscriber,
    isCluster: primary instanceof Cluster,
    isConnected: primary.status === 'ready',
    connectionPool: connectionPool.pool,
    disconnect,
    getConnection: (name?: string) => connectionPool.getConnection(name || 'default'),
    executeScript: (script: string, keys: string[], args: string[]) => 
      executeScript(script, keys, args),
    healthCheck,
    getStats,
  });

  // Graceful shutdown
  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing Redis connections...');
    await disconnect();
  });

  // Wait for primary connection to be ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Redis connection timeout'));
    }, redisConfig.connection.connectTimeout);

    if (primary.status === 'ready') {
      clearTimeout(timeout);
      resolve();
    } else {
      primary.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
      
      primary.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    }
  });

  fastify.log.info('Redis plugin initialized successfully');
};

export default fastifyPlugin(redisPlugin, {
  name: 'redis',
  fastify: '4.x',
});

export { LUA_SCRIPTS };