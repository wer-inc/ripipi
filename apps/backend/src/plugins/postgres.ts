import fastifyPostgres from '@fastify/postgres';
import { FastifyPluginAsync, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { db, DatabaseClient, DatabaseMetrics } from '../db/index.js';
import { logger } from '../config/logger.js';
import { config } from '../config/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Database client instance
     */
    db: DatabaseClient;
    
    /**
     * Get database connection metrics
     */
    getDatabaseMetrics(): DatabaseMetrics;
    
    /**
     * Check database health status
     */
    isDatabaseHealthy(): boolean;
    
    /**
     * Execute a tenant-scoped query
     */
    queryForTenant<T = any>(
      tenantId: string,
      text: string,
      params?: any[]
    ): Promise<{ rows: T[]; rowCount: number }>;
  }
}

/**
 * Fastify PostgreSQL plugin
 * Provides database connection and utilities to Fastify instance
 */
const postgresPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  try {
    logger.info('Registering PostgreSQL plugin...');

    // Register the official @fastify/postgres plugin for backward compatibility
    await fastify.register(fastifyPostgres, {
      connectionString: config.DATABASE_URL || 
        `postgresql://${config.DB_USER}:${config.DB_PASSWORD}@${config.DB_HOST}:${config.DB_PORT}/${config.DB_NAME}`,
      ssl: config.DB_SSL 
        ? (config.NODE_ENV === 'production' ? { rejectUnauthorized: false } : true)
        : false,
    });

    // Connect our custom database client
    await db.connect();

    // Decorate Fastify instance with our database client
    fastify.decorate('db', db);

    // Add utility methods
    fastify.decorate('getDatabaseMetrics', () => {
      return db.getMetrics();
    });

    fastify.decorate('isDatabaseHealthy', () => {
      return db.isHealthy();
    });

    fastify.decorate('queryForTenant', async <T = any>(
      tenantId: string,
      text: string,
      params?: any[]
    ): Promise<{ rows: T[]; rowCount: number }> => {
      return db.queryForTenant<T>(tenantId, text, params);
    });

    // Add health check route
    fastify.get('/health/database', async (request, reply) => {
      try {
        const isHealthy = db.isHealthy();
        const metrics = db.getMetrics();

        if (!isHealthy) {
          return reply.status(503).send({
            status: 'error',
            message: 'Database is not healthy',
            metrics
          });
        }

        // Test a simple query
        const result = await db.query('SELECT 1 as test, NOW() as timestamp');
        
        return reply.send({
          status: 'ok',
          message: 'Database is healthy',
          metrics,
          test: result.rows[0]
        });
      } catch (error) {
        logger.error('Database health check failed', { error });
        return reply.status(503).send({
          status: 'error',
          message: 'Database health check failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Add graceful shutdown handler
    fastify.addHook('onClose', async (instance) => {
      logger.info('Closing database connections...');
      try {
        await db.disconnect();
        logger.info('Database connections closed successfully');
      } catch (error) {
        logger.error('Error closing database connections', { error });
        // Don't throw to allow other cleanup to continue
      }
    });

    // Add request logging for database operations
    fastify.addHook('onRequest', async (request) => {
      // Add database metrics to request context for monitoring
      (request as any).startTime = Date.now();
    });

    fastify.addHook('onResponse', async (request, reply) => {
      const duration = Date.now() - ((request as any).startTime || Date.now());
      
      // Log slow requests
      if (duration > 1000) {
        logger.warn('Slow request detected', {
          method: request.method,
          url: request.url,
          duration,
          statusCode: reply.statusCode
        });
      }
    });

    // Add error handling for database errors
    fastify.setErrorHandler(async (error, request, reply) => {
      // Check if it's a database error
      if (error.code && typeof error.code === 'string') {
        const pgErrorCodes: { [key: string]: string } = {
          '23505': 'Duplicate key violation',
          '23503': 'Foreign key violation',
          '23514': 'Check constraint violation',
          '23502': 'Not null violation',
          '42P01': 'Table does not exist',
          '42703': 'Column does not exist',
          '08003': 'Connection does not exist',
          '08006': 'Connection failure',
          '53300': 'Too many connections',
          '40001': 'Serialization failure (deadlock)',
          '25P02': 'Transaction is aborted',
        };

        const errorMessage = pgErrorCodes[error.code] || 'Database error';
        
        logger.error('Database error occurred', {
          code: error.code,
          message: error.message,
          detail: error.detail,
          hint: error.hint,
          position: error.position,
          table: error.table,
          column: error.column,
          constraint: error.constraint,
          url: request.url,
          method: request.method
        });

        // Return appropriate HTTP status based on error type
        let statusCode = 500;
        if (['23505', '23503', '23514', '23502'].includes(error.code)) {
          statusCode = 400; // Bad Request for constraint violations
        } else if (['42P01', '42703'].includes(error.code)) {
          statusCode = 500; // Internal Server Error for schema issues
        } else if (['08003', '08006', '53300'].includes(error.code)) {
          statusCode = 503; // Service Unavailable for connection issues
        }

        return reply.status(statusCode).send({
          error: errorMessage,
          code: error.code,
          statusCode,
          message: config.NODE_ENV === 'development' ? error.message : 'Database operation failed'
        });
      }

      // Re-throw non-database errors
      throw error;
    });

    logger.info('PostgreSQL plugin registered successfully', {
      poolConfig: {
        min: config.DB_POOL_MIN,
        max: config.DB_POOL_MAX,
        idleTimeout: config.DB_IDLE_TIMEOUT
      }
    });

  } catch (error) {
    logger.error('Failed to register PostgreSQL plugin', { error });
    throw error;
  }
};

export default fp(postgresPlugin, {
  name: 'postgres',
  dependencies: []
});

// Export plugin for manual registration if needed
export { postgresPlugin };