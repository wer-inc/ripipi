import { Pool, PoolClient, PoolConfig } from 'pg';
import { config } from '../config/index.js';
import { logger } from '../config/logger.js';

export interface DatabaseMetrics {
  totalConnections: number;
  idleConnections: number;
  waitingClients: number;
}

export interface DatabaseConfig extends PoolConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean | object;
  min: number;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  statement_timeout: number;
  query_timeout: number;
  application_name: string;
}

/**
 * PostgreSQL connection pool
 */
export class DatabaseClient {
  private pool: Pool;
  private isConnected = false;

  constructor() {
    const dbConfig = this.createDatabaseConfig();
    this.pool = new Pool(dbConfig);
    this.setupEventHandlers();
  }

  /**
   * Create database configuration from environment variables
   */
  private createDatabaseConfig(): DatabaseConfig {
    // Use DATABASE_URL if available, otherwise construct from individual values
    if (config.DATABASE_URL) {
      return {
        connectionString: config.DATABASE_URL,
        ssl: config.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        min: config.DB_POOL_MIN,
        max: config.DB_POOL_MAX,
        idleTimeoutMillis: config.DB_IDLE_TIMEOUT,
        connectionTimeoutMillis: config.DB_CONNECTION_TIMEOUT,
        statement_timeout: config.DB_STATEMENT_TIMEOUT,
        query_timeout: config.DB_QUERY_TIMEOUT,
        application_name: config.DB_APPLICATION_NAME,
      } as DatabaseConfig;
    }

    return {
      host: config.DB_HOST,
      port: config.DB_PORT,
      database: config.DB_NAME,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      ssl: config.DB_SSL 
        ? (config.NODE_ENV === 'production' ? { rejectUnauthorized: false } : true)
        : false,
      min: config.DB_POOL_MIN,
      max: config.DB_POOL_MAX,
      idleTimeoutMillis: config.DB_IDLE_TIMEOUT,
      connectionTimeoutMillis: config.DB_CONNECTION_TIMEOUT,
      statement_timeout: config.DB_STATEMENT_TIMEOUT,
      query_timeout: config.DB_QUERY_TIMEOUT,
      application_name: config.DB_APPLICATION_NAME,
    };
  }

  /**
   * Setup event handlers for connection pool
   */
  private setupEventHandlers(): void {
    this.pool.on('connect', (client: PoolClient) => {
      logger.debug('New client connected to database');
      
      // Set session-level configuration
      client.query(`
        SET timezone = '${config.DEFAULT_TIMEZONE}';
        SET statement_timeout = '${config.DB_STATEMENT_TIMEOUT}ms';
      `).catch((error) => {
        logger.error('Failed to set session configuration', { error });
      });
    });

    this.pool.on('acquire', (client: PoolClient) => {
      logger.debug('Client acquired from pool');
    });

    this.pool.on('release', (error: Error | undefined, client: PoolClient) => {
      if (error) {
        logger.error('Client released with error', { error });
      } else {
        logger.debug('Client released back to pool');
      }
    });

    this.pool.on('remove', (client: PoolClient) => {
      logger.debug('Client removed from pool');
    });

    this.pool.on('error', (error: Error, client?: PoolClient) => {
      logger.error('Unexpected error on idle client', { 
        error,
        clientProcessId: client?.processID 
      });
    });
  }

  /**
   * Connect to the database and verify connection
   */
  async connect(): Promise<void> {
    try {
      logger.info('Connecting to PostgreSQL database...');
      
      // Test connection
      const client = await this.pool.connect();
      try {
        const result = await client.query('SELECT NOW(), version()');
        logger.info('Database connection established', {
          timestamp: result.rows[0].now,
          version: result.rows[0].version.split(' ')[0] + ' ' + result.rows[0].version.split(' ')[1],
          poolConfig: {
            min: this.pool.options.min,
            max: this.pool.options.max,
            idleTimeoutMillis: this.pool.options.idleTimeoutMillis
          }
        });
        this.isConnected = true;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('Failed to connect to database', { error });
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Get a client from the connection pool
   */
  async getClient(): Promise<PoolClient> {
    if (!this.isConnected) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.pool.connect();
  }

  /**
   * Execute a query with parameters
   */
  async query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }> {
    if (!this.isConnected) {
      throw new Error('Database not connected. Call connect() first.');
    }

    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      
      logger.debug('Query executed', {
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
      logger.error('Query failed', {
        query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        duration,
        error
      });
      throw error;
    }
  }

  /**
   * Execute a query for a specific tenant
   */
  async queryForTenant<T = any>(
    tenantId: string, 
    text: string, 
    params?: any[]
  ): Promise<{ rows: T[]; rowCount: number }> {
    // Add tenant_id filter to queries that don't already have WHERE clause
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
  }

  /**
   * Get connection pool metrics
   */
  getMetrics(): DatabaseMetrics {
    return {
      totalConnections: this.pool.totalCount,
      idleConnections: this.pool.idleCount,
      waitingClients: this.pool.waitingCount
    };
  }

  /**
   * Check if database is connected
   */
  isHealthy(): boolean {
    return this.isConnected && this.pool.totalCount > 0;
  }

  /**
   * Gracefully close all connections
   */
  async disconnect(): Promise<void> {
    try {
      logger.info('Disconnecting from database...');
      await this.pool.end();
      this.isConnected = false;
      logger.info('Database disconnected successfully');
    } catch (error) {
      logger.error('Error disconnecting from database', { error });
      throw error;
    }
  }

  /**
   * Get the underlying pool instance
   */
  getPool(): Pool {
    return this.pool;
  }
}

// Global database instance
export const db = new DatabaseClient();

// Helper functions for common operations
export const connectDatabase = () => db.connect();
export const disconnectDatabase = () => db.disconnect();
export const getDatabaseMetrics = () => db.getMetrics();
export const isDatabaseHealthy = () => db.isHealthy();

// Export types
export type { PoolClient } from 'pg';