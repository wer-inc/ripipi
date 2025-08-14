import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { db } from '../db/index.js';
import { withTransaction } from '../db/transaction.js';
import { logger } from '../config/logger.js';
import { config } from '../config/index.js';

/**
 * Extended FastifyRequest with idempotency context
 */
declare module 'fastify' {
  interface FastifyRequest {
    idempotencyKey?: string;
    idempotencyContext?: IdempotencyContext;
  }
}

/**
 * Idempotency context
 */
export interface IdempotencyContext {
  key: string;
  fingerprint: string;
  tenantId?: string;
  userId?: string;
  createdAt: Date;
  expiresAt: Date;
  requestHash: string;
}

/**
 * Idempotency response record
 */
export interface IdempotencyRecord {
  id: string;
  idempotency_key: string;
  request_fingerprint: string;
  response_status: number;
  response_headers: Record<string, any>;
  response_body: any;
  tenant_id?: string;
  user_id?: string;
  created_at: Date;
  expires_at: Date;
}

/**
 * Idempotency options
 */
export interface IdempotencyOptions {
  headerName?: string;
  ttlMinutes?: number;
  enableFingerprinting?: boolean;
  excludePaths?: string[];
  includePaths?: string[];
  methods?: string[];
  maxResponseSize?: number;
  onDuplicateRequest?: (record: IdempotencyRecord) => void;
}

/**
 * Idempotency error types
 */
export class IdempotencyError extends Error {
  constructor(message: string, public readonly code: string = 'IDEMPOTENCY_ERROR') {
    super(message);
    this.name = 'IdempotencyError';
  }
}

export class IdempotencyKeyConflictError extends IdempotencyError {
  constructor(key: string, conflictingFingerprint: string) {
    super(`Idempotency key '${key}' already used with different request`, 'IDEMPOTENCY_KEY_CONFLICT');
    this.name = 'IdempotencyKeyConflictError';
  }
}

/**
 * Idempotency manager class
 */
export class IdempotencyManager {
  private readonly ttlMinutes: number;
  private readonly maxResponseSize: number;

  constructor(options: IdempotencyOptions = {}) {
    this.ttlMinutes = options.ttlMinutes || config.IDEMPOTENCY_KEY_TTL_MIN || 15;
    this.maxResponseSize = options.maxResponseSize || 1024 * 1024; // 1MB default
  }

  /**
   * Create idempotency record
   */
  async createRecord(context: IdempotencyContext): Promise<void> {
    await withTransaction(async (ctx) => {
      const query = `
        INSERT INTO idempotency_keys (
          idempotency_key,
          request_fingerprint,
          tenant_id,
          user_id,
          created_at,
          expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (idempotency_key) DO NOTHING
      `;

      await ctx.query(query, [
        context.key,
        context.fingerprint,
        context.tenantId,
        context.userId,
        context.createdAt,
        context.expiresAt
      ]);
    });
  }

  /**
   * Get existing idempotency record
   */
  async getRecord(key: string, tenantId?: string): Promise<IdempotencyRecord | null> {
    const query = tenantId
      ? `SELECT * FROM idempotency_keys WHERE idempotency_key = $1 AND tenant_id = $2 AND expires_at > NOW()`
      : `SELECT * FROM idempotency_keys WHERE idempotency_key = $1 AND expires_at > NOW()`;
    
    const params = tenantId ? [key, tenantId] : [key];
    const result = await db.query<IdempotencyRecord>(query, params);
    
    return result.rows[0] || null;
  }

  /**
   * Update record with response
   */
  async updateRecord(
    key: string,
    status: number,
    headers: Record<string, any>,
    body: any,
    tenantId?: string
  ): Promise<void> {
    // Check response size
    const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
    if (bodyString.length > this.maxResponseSize) {
      logger.warn('Response too large for idempotency caching', {
        key,
        size: bodyString.length,
        maxSize: this.maxResponseSize
      });
      return;
    }

    await withTransaction(async (ctx) => {
      const query = tenantId
        ? `
          UPDATE idempotency_keys
          SET response_status = $1, response_headers = $2, response_body = $3, updated_at = NOW()
          WHERE idempotency_key = $4 AND tenant_id = $5
        `
        : `
          UPDATE idempotency_keys
          SET response_status = $1, response_headers = $2, response_body = $3, updated_at = NOW()
          WHERE idempotency_key = $4
        `;

      const params = tenantId
        ? [status, JSON.stringify(headers), bodyString, key, tenantId]
        : [status, JSON.stringify(headers), bodyString, key];

      await ctx.query(query, params);
    });
  }

  /**
   * Clean up expired records
   */
  async cleanupExpired(): Promise<number> {
    const query = `DELETE FROM idempotency_keys WHERE expires_at <= NOW()`;
    const result = await db.query(query);
    
    logger.debug('Cleaned up expired idempotency keys', {
      count: result.rowCount
    });
    
    return result.rowCount;
  }
}

/**
 * Create request fingerprint for duplicate detection
 */
function createRequestFingerprint(request: FastifyRequest): string {
  const fingerprint = {
    method: request.method,
    url: request.url,
    headers: {
      'content-type': request.headers['content-type'],
      'user-agent': request.headers['user-agent']
    },
    body: request.body,
    tenant: request.tenant?.tenantId,
    user: request.tenant?.userId
  };

  const fingerprintString = JSON.stringify(fingerprint, Object.keys(fingerprint).sort());
  return crypto.createHash('sha256').update(fingerprintString).digest('hex');
}

/**
 * Extract idempotency key from request
 */
function extractIdempotencyKey(request: FastifyRequest, headerName: string): string | undefined {
  const key = request.headers[headerName.toLowerCase()];
  
  if (Array.isArray(key)) {
    return key[0];
  }
  
  return typeof key === 'string' ? key : undefined;
}

/**
 * Validate idempotency key format
 */
function validateIdempotencyKey(key: string): boolean {
  // UUID v4 pattern or custom format
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const customPattern = /^[a-zA-Z0-9_-]{8,128}$/;
  
  return uuidPattern.test(key) || customPattern.test(key);
}

/**
 * Check if request should be processed for idempotency
 */
function shouldProcessIdempotency(
  request: FastifyRequest,
  options: IdempotencyOptions
): boolean {
  // Check method
  const allowedMethods = options.methods || ['POST', 'PUT', 'PATCH'];
  if (!allowedMethods.includes(request.method)) {
    return false;
  }

  // Check excluded paths
  if (options.excludePaths) {
    for (const excludePath of options.excludePaths) {
      if (request.url.startsWith(excludePath)) {
        return false;
      }
    }
  }

  // Check included paths
  if (options.includePaths && options.includePaths.length > 0) {
    const included = options.includePaths.some(includePath => 
      request.url.startsWith(includePath)
    );
    if (!included) {
      return false;
    }
  }

  return true;
}

/**
 * Create idempotency middleware
 */
export function createIdempotencyMiddleware(options: IdempotencyOptions = {}) {
  const {
    headerName = 'idempotency-key',
    ttlMinutes = config.IDEMPOTENCY_KEY_TTL_MIN || 15,
    enableFingerprinting = true,
    onDuplicateRequest
  } = options;

  const manager = new IdempotencyManager({ ttlMinutes, ...options });

  return async function idempotencyMiddleware(request: FastifyRequest, reply: FastifyReply) {
    // Check if this request should be processed
    if (!shouldProcessIdempotency(request, options)) {
      return;
    }

    try {
      // Extract idempotency key
      const idempotencyKey = extractIdempotencyKey(request, headerName);
      
      if (!idempotencyKey) {
        // No idempotency key provided, continue normally
        return;
      }

      // Validate key format
      if (!validateIdempotencyKey(idempotencyKey)) {
        return reply.status(400).send({
          error: 'Invalid Idempotency Key',
          message: 'Idempotency key must be a valid UUID or alphanumeric string (8-128 characters)'
        });
      }

      request.idempotencyKey = idempotencyKey;

      // Create request fingerprint
      const fingerprint = enableFingerprinting ? createRequestFingerprint(request) : '';
      
      // Check for existing record
      const tenantId = request.tenant?.tenantId;
      const existingRecord = await manager.getRecord(idempotencyKey, tenantId);

      if (existingRecord) {
        // Check fingerprint if enabled
        if (enableFingerprinting && existingRecord.request_fingerprint !== fingerprint) {
          throw new IdempotencyKeyConflictError(idempotencyKey, existingRecord.request_fingerprint);
        }

        // Check if response is already cached
        if (existingRecord.response_status) {
          logger.debug('Returning cached idempotent response', {
            key: idempotencyKey,
            status: existingRecord.response_status,
            tenantId
          });

          // Call duplicate request handler if provided
          if (onDuplicateRequest) {
            onDuplicateRequest(existingRecord);
          }

          // Return cached response
          const headers = existingRecord.response_headers 
            ? JSON.parse(existingRecord.response_headers as string)
            : {};

          // Set cached response headers
          Object.entries(headers).forEach(([name, value]) => {
            reply.header(name, value as string);
          });

          reply.header('x-idempotent-replayed', 'true');
          
          const body = existingRecord.response_body;
          const responseBody = typeof body === 'string' ? JSON.parse(body) : body;
          
          return reply.status(existingRecord.response_status).send(responseBody);
        }

        // Response not yet cached, this is a concurrent request
        logger.debug('Concurrent idempotent request detected', {
          key: idempotencyKey,
          tenantId
        });
        
        // Wait a short time and retry
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Check again for response
        const retryRecord = await manager.getRecord(idempotencyKey, tenantId);
        if (retryRecord?.response_status) {
          const headers = retryRecord.response_headers 
            ? JSON.parse(retryRecord.response_headers as string)
            : {};

          Object.entries(headers).forEach(([name, value]) => {
            reply.header(name, value as string);
          });

          reply.header('x-idempotent-replayed', 'true');
          
          const body = retryRecord.response_body;
          const responseBody = typeof body === 'string' ? JSON.parse(body) : body;
          
          return reply.status(retryRecord.response_status).send(responseBody);
        }

        // Still no response, continue with processing but mark as duplicate
        request.idempotencyContext = {
          key: idempotencyKey,
          fingerprint,
          tenantId,
          userId: request.tenant?.userId,
          createdAt: existingRecord.created_at,
          expiresAt: existingRecord.expires_at,
          requestHash: fingerprint
        };
      } else {
        // Create new idempotency record
        const now = new Date();
        const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

        const context: IdempotencyContext = {
          key: idempotencyKey,
          fingerprint,
          tenantId,
          userId: request.tenant?.userId,
          createdAt: now,
          expiresAt,
          requestHash: fingerprint
        };

        await manager.createRecord(context);
        request.idempotencyContext = context;

        logger.debug('Created new idempotency record', {
          key: idempotencyKey,
          tenantId,
          expiresAt
        });
      }

      // Set up response interception to cache the result
      const originalSend = reply.send.bind(reply);
      
      reply.send = function(payload: any) {
        // Only cache successful responses
        if (reply.statusCode < 400 && request.idempotencyKey) {
          const headers: Record<string, any> = {};
          
          // Capture response headers
          const responseHeaders = reply.getHeaders();
          Object.entries(responseHeaders).forEach(([name, value]) => {
            headers[name] = value;
          });

          // Cache the response asynchronously
          setImmediate(async () => {
            try {
              await manager.updateRecord(
                request.idempotencyKey!,
                reply.statusCode,
                headers,
                payload,
                tenantId
              );
              
              logger.debug('Cached idempotent response', {
                key: request.idempotencyKey,
                status: reply.statusCode,
                tenantId
              });
            } catch (error) {
              logger.error('Failed to cache idempotent response', {
                key: request.idempotencyKey,
                error: error.message
              });
            }
          });
        }

        return originalSend(payload);
      };

    } catch (error) {
      logger.error('Idempotency middleware error', {
        error: error.message,
        url: request.url,
        key: request.idempotencyKey
      });

      if (error instanceof IdempotencyKeyConflictError) {
        return reply.status(409).send({
          error: 'Idempotency Key Conflict',
          message: error.message,
          code: error.code
        });
      }

      return reply.status(500).send({
        error: 'Idempotency Error',
        message: 'Failed to process idempotency key'
      });
    }
  };
}

/**
 * Idempotency decorator for route handlers
 */
export function idempotent(options: IdempotencyOptions = {}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const middleware = createIdempotencyMiddleware(options);

    descriptor.value = async function (...args: any[]) {
      const request = args[0] as FastifyRequest;
      const reply = args[1] as FastifyReply;

      // Apply idempotency middleware
      await middleware(request, reply);
      
      // If reply was already sent (cached response), return
      if (reply.sent) {
        return;
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * Periodic cleanup job for expired idempotency keys
 */
export class IdempotencyCleanupJob {
  private manager: IdempotencyManager;
  private intervalId?: NodeJS.Timeout;
  private running = false;

  constructor(options: IdempotencyOptions = {}) {
    this.manager = new IdempotencyManager(options);
  }

  /**
   * Start periodic cleanup
   */
  start(intervalMinutes: number = 60): void {
    if (this.running) {
      return;
    }

    this.running = true;
    
    logger.info('Starting idempotency cleanup job', {
      intervalMinutes
    });

    this.intervalId = setInterval(async () => {
      try {
        const cleanedCount = await this.manager.cleanupExpired();
        
        if (cleanedCount > 0) {
          logger.info('Idempotency cleanup completed', {
            cleanedRecords: cleanedCount
          });
        }
      } catch (error) {
        logger.error('Idempotency cleanup failed', {
          error: error.message
        });
      }
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * Stop periodic cleanup
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    
    this.running = false;
    logger.info('Idempotency cleanup job stopped');
  }

  /**
   * Run cleanup manually
   */
  async runCleanup(): Promise<number> {
    return this.manager.cleanupExpired();
  }
}

/**
 * Create database table for idempotency keys if it doesn't exist
 */
export async function createIdempotencyTable(): Promise<void> {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      idempotency_key VARCHAR(128) NOT NULL,
      request_fingerprint VARCHAR(64),
      response_status INTEGER,
      response_headers JSONB,
      response_body TEXT,
      tenant_id UUID,
      user_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      
      UNIQUE(idempotency_key),
      INDEX idx_idempotency_keys_tenant_key (tenant_id, idempotency_key),
      INDEX idx_idempotency_keys_expires (expires_at)
    );
  `;

  try {
    await db.query(createTableQuery);
    logger.info('Idempotency table created or verified');
  } catch (error) {
    logger.error('Failed to create idempotency table', { error });
    throw error;
  }
}

// Export everything
export {
  IdempotencyManager,
  IdempotencyError,
  IdempotencyKeyConflictError,
  createIdempotencyMiddleware,
  idempotent,
  IdempotencyCleanupJob,
  createIdempotencyTable
};