import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';

// Load environment variables
dotenvConfig({ path: join(__dirname, '../../.env') });

/**
 * Application configuration
 * All environment variables are validated and typed here
 */
export const config = {
  // Server
  NODE_ENV: process.env.NODE_ENV || 'development',
  HOST: process.env.HOST || '0.0.0.0',
  PORT: parseInt(process.env.PORT || '3000', 10),
  
  // Database
  DATABASE_URL: process.env.DATABASE_URL || '',
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: parseInt(process.env.DB_PORT || '5432', 10),
  DB_NAME: process.env.DB_NAME || 'ripipi_dev',
  DB_USER: process.env.DB_USER || 'ripipi_user',
  DB_PASSWORD: process.env.DB_PASSWORD || '',
  DB_SSL: process.env.DB_SSL === 'true',
  
  // Connection Pool Settings
  DB_POOL_MIN: parseInt(process.env.DB_POOL_MIN || '10', 10),
  DB_POOL_MAX: parseInt(process.env.DB_POOL_MAX || '50', 10),
  DB_IDLE_TIMEOUT: parseInt(process.env.DB_IDLE_TIMEOUT || '30000', 10), // 30 seconds
  DB_CONNECTION_TIMEOUT: parseInt(process.env.DB_CONNECTION_TIMEOUT || '10000', 10), // 10 seconds
  DB_STATEMENT_TIMEOUT: parseInt(process.env.DB_STATEMENT_TIMEOUT || '30000', 10), // 30 seconds
  DB_QUERY_TIMEOUT: parseInt(process.env.DB_QUERY_TIMEOUT || '30000', 10), // 30 seconds
  DB_APPLICATION_NAME: process.env.DB_APPLICATION_NAME || 'ripipi-backend',
  
  // Legacy compatibility
  DB_MAX_CONNECTIONS: parseInt(process.env.DB_MAX_CONNECTIONS || '50', 10),
  
  // Redis
  REDIS_URL: process.env.REDIS_URL || '',
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: parseInt(process.env.REDIS_PORT || '6379', 10),
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || '',
  REDIS_DB: parseInt(process.env.REDIS_DB || '0', 10),
  
  // Redis Connection Pool
  REDIS_POOL_MIN: parseInt(process.env.REDIS_POOL_MIN || '5', 10),
  REDIS_POOL_MAX: parseInt(process.env.REDIS_POOL_MAX || '20', 10),
  REDIS_CONNECT_TIMEOUT: parseInt(process.env.REDIS_CONNECT_TIMEOUT || '10000', 10),
  REDIS_COMMAND_TIMEOUT: parseInt(process.env.REDIS_COMMAND_TIMEOUT || '5000', 10),
  REDIS_IDLE_TIMEOUT: parseInt(process.env.REDIS_IDLE_TIMEOUT || '300000', 10),
  REDIS_KEY_PREFIX: process.env.REDIS_KEY_PREFIX || 'ripipi:',
  
  // Cache Settings
  CACHE_DEFAULT_TTL: parseInt(process.env.CACHE_DEFAULT_TTL || '300', 10), // 5 minutes
  CACHE_MAX_TTL: parseInt(process.env.CACHE_MAX_TTL || '3600', 10), // 1 hour
  CACHE_MEMORY_ENABLED: process.env.CACHE_MEMORY_ENABLED !== 'false',
  CACHE_MEMORY_MAX_SIZE: parseInt(process.env.CACHE_MEMORY_MAX_SIZE || '134217728', 10), // 128MB
  CACHE_MEMORY_MAX_ITEMS: parseInt(process.env.CACHE_MEMORY_MAX_ITEMS || '10000', 10),
  CACHE_COMPRESSION_ENABLED: process.env.CACHE_COMPRESSION_ENABLED !== 'false',
  CACHE_COMPRESSION_MIN_SIZE: parseInt(process.env.CACHE_COMPRESSION_MIN_SIZE || '1024', 10), // 1KB
  
  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'your-super-secret-jwt-key',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  
  // Rate Limiting
  RATE_LIMIT_PUBLIC_MAX: parseInt(process.env.RATE_LIMIT_PUBLIC_MAX || '20', 10),
  RATE_LIMIT_PUBLIC_WINDOW: parseInt(process.env.RATE_LIMIT_PUBLIC_WINDOW || '60000', 10), // 1 minute in ms
  RATE_LIMIT_API_MAX: parseInt(process.env.RATE_LIMIT_API_MAX || '100', 10),
  RATE_LIMIT_API_WINDOW: parseInt(process.env.RATE_LIMIT_API_WINDOW || '60000', 10), // 1 minute in ms
  RATE_LIMIT_AUTH_MAX: parseInt(process.env.RATE_LIMIT_AUTH_MAX || '5', 10),
  RATE_LIMIT_AUTH_WINDOW: parseInt(process.env.RATE_LIMIT_AUTH_WINDOW || '900000', 10), // 15 minutes in ms
  RATE_LIMIT_ADMIN_MAX: parseInt(process.env.RATE_LIMIT_ADMIN_MAX || '30', 10),
  RATE_LIMIT_ADMIN_WINDOW: parseInt(process.env.RATE_LIMIT_ADMIN_WINDOW || '60000', 10), // 1 minute in ms
  RATE_LIMIT_STORE: process.env.RATE_LIMIT_STORE || 'redis',
  RATE_LIMIT_SKIP_SUCCESSFUL: process.env.RATE_LIMIT_SKIP_SUCCESSFUL === 'true',
  RATE_LIMIT_SKIP_FAILED: process.env.RATE_LIMIT_SKIP_FAILED === 'true',
  
  // CORS
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  CORS_CREDENTIALS: process.env.CORS_CREDENTIALS === 'true',
  
  // Stripe
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
  
  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  LOG_PRETTY: process.env.LOG_PRETTY === 'true',
  
  // Business Logic
  DEFAULT_TIMEZONE: process.env.DEFAULT_TIMEZONE || 'Asia/Tokyo',
  DEFAULT_CANCEL_CUTOFF_MIN: parseInt(process.env.DEFAULT_CANCEL_CUTOFF_MIN || '1440', 10),
  DEFAULT_NOSHOW_GRACE_MIN: parseInt(process.env.DEFAULT_NOSHOW_GRACE_MIN || '15', 10),
  IDEMPOTENCY_KEY_TTL_MIN: parseInt(process.env.IDEMPOTENCY_KEY_TTL_MIN || '15', 10),
  
  // Feature Flags
  ENABLE_SWAGGER: process.env.ENABLE_SWAGGER === 'true',
  ENABLE_METRICS: process.env.ENABLE_METRICS === 'true',
  ENABLE_CACHE: process.env.ENABLE_CACHE !== 'false',
  ENABLE_RATE_LIMITING: process.env.ENABLE_RATE_LIMITING !== 'false',
  ENABLE_CACHE_COMPRESSION: process.env.ENABLE_CACHE_COMPRESSION !== 'false',
} as const;

// Type for the config object
export type Config = typeof config;

// Validate required configuration
export function validateConfig(): void {
  const required = [
    'DATABASE_URL',
    'JWT_SECRET',
  ];
  
  const missing = required.filter(key => !config[key as keyof Config]);
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required configuration: ${missing.join(', ')}. ` +
      'Please check your .env file.'
    );
  }
  
  // Additional validation
  if (config.NODE_ENV === 'production') {
    if (config.JWT_SECRET === 'your-super-secret-jwt-key') {
      throw new Error('Please set a secure JWT_SECRET in production');
    }
    if (!config.STRIPE_SECRET_KEY) {
      console.warn('Warning: STRIPE_SECRET_KEY not set in production');
    }
  }
}