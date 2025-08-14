/**
 * Idempotency Middleware
 * HTTP middleware for handling idempotency keys with request deduplication,
 * fingerprinting, and response caching
 */

import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { IdempotencyService } from '../services/idempotency.service.js';
import { logger } from '../config/logger.js';
import {
  IdempotencyMiddlewareOptions,
  IdempotencyRequestMetadata,
  IdempotencyResponseMetadata,
  IdempotencyStatus,
  IdempotencyError,
  IdempotencyKeyConflictError,
  IdempotencyTimeoutError,
  CreateIdempotencyKeyRequest,
  UpdateIdempotencyKeyRequest,
  IdempotencyConflictType
} from '../types/idempotency.js';

// Extend FastifyRequest with idempotency context
declare module 'fastify' {
  interface FastifyRequest {
    idempotency?: {
      key: string;
      enabled: boolean;
      operationId: string;
      startTime: number;
      fingerprint: string;
      metadata: IdempotencyRequestMetadata;
      skipResponseCaching?: boolean;
    };
  }
}

/**
 * Default middleware options
 */
const DEFAULT_OPTIONS: IdempotencyMiddlewareOptions = {
  headerName: 'idempotency-key',
  requiredForPaths: [],
  excludedPaths: ['/health', '/metrics', '/status'],
  allowedMethods: ['POST', 'PUT', 'PATCH'],
  enforceKeyFormat: true,
  allowCustomKeyFormat: true,
  keyMinLength: 8,
  keyMaxLength: 128,
  enableFingerprinting: true,
  fingerprintFields: ['method', 'url', 'body', 'contentType'],
  includeBodyInFingerprint: true,
  returnDetailedErrors: false,
  logConflicts: true,
  notifyOnViolations: true,
  maxConcurrentChecks: 100,
  timeoutMs: 30000
};

/**
 * Enhanced Idempotency Middleware
 */
export class IdempotencyMiddleware {
  private service: IdempotencyService;
  private options: IdempotencyMiddlewareOptions;
  private activeChecks: Map<string, Promise<any>> = new Map();
  private requestCount: Map<string, number> = new Map();

  constructor(service: IdempotencyService, options: Partial<IdempotencyMiddlewareOptions> = {}) {
    this.service = service;
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // Start cleanup for tracking maps
    setInterval(() => {
      this.cleanup();
    }, 60000); // Every minute
  }

  /**
   * Main middleware function
   */
  async handle(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const startTime = Date.now();
    const operationId = this.generateOperationId();

    try {
      // Check if idempotency should be applied
      if (!this.shouldApplyIdempotency(request)) {
        return;
      }

      // Extract idempotency key
      const idempotencyKey = this.extractIdempotencyKey(request);
      
      // Initialize request context
      request.idempotency = {
        key: idempotencyKey || '',
        enabled: !!idempotencyKey,
        operationId,
        startTime,
        fingerprint: '',
        metadata: this.createRequestMetadata(request),
        skipResponseCaching: false
      };

      // If no key provided but required, return error
      if (!idempotencyKey && this.isIdempotencyRequired(request)) {
        return this.sendError(reply, 400, 'IDEMPOTENCY_KEY_REQUIRED', 
          'Idempotency key is required for this operation');
      }

      // If no key provided and not required, continue normally
      if (!idempotencyKey) {
        return;
      }

      // Validate key format
      if (!this.validateKeyFormat(idempotencyKey)) {
        return this.sendError(reply, 400, 'INVALID_IDEMPOTENCY_KEY_FORMAT',
          `Idempotency key must be ${this.options.keyMinLength}-${this.options.keyMaxLength} characters`);
      }

      // Create fingerprint
      request.idempotency.fingerprint = this.createFingerprint(request.idempotency.metadata);

      // Rate limiting check
      if (!this.checkRateLimit(request)) {
        return this.sendError(reply, 429, 'TOO_MANY_REQUESTS',
          'Too many concurrent idempotency checks');
      }

      // Process idempotency
      await this.processIdempotency(request, reply);

    } catch (error) {
      logger.error('Idempotency middleware error', {
        operationId,
        error: error.message,
        url: request.url,
        method: request.method,
        idempotencyKey: request.idempotency?.key,
        duration: Date.now() - startTime
      });

      await this.handleError(request, reply, error);
    }
  }

  /**
   * Process idempotency logic
   */
  private async processIdempotency(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { key, metadata, operationId } = request.idempotency!;
    const tenantId = this.extractTenantId(request);

    try {
      // Check for concurrent processing of same key
      const concurrentKey = `${tenantId || 'global'}:${key}`;
      const existingCheck = this.activeChecks.get(concurrentKey);

      if (existingCheck) {
        logger.debug('Concurrent idempotency check detected', {
          key,
          tenantId,
          operationId
        });

        try {
          // Wait for existing check to complete
          await existingCheck;
        } catch (error) {
          // If concurrent check failed, proceed with our own
          logger.debug('Concurrent check failed, proceeding', {
            key,
            error: error.message
          });
        }
      }

      // Create promise for this check
      const checkPromise = this.performIdempotencyCheck(key, metadata, tenantId, operationId);
      this.activeChecks.set(concurrentKey, checkPromise);

      try {
        const checkResult = await checkPromise;

        // Handle the result
        if (checkResult.cachedResponse) {
          // Return cached response
          await this.returnCachedResponse(reply, checkResult.cachedResponse);
          return;
        }

        if (checkResult.shouldWait) {
          // Wait for concurrent processing
          await this.waitForCompletion(key, tenantId, reply);
          return;
        }

        if (!checkResult.shouldProceed) {
          // Handle conflicts
          await this.handleConflict(reply, checkResult);
          return;
        }

        // Create or update key for processing
        if (!checkResult.exists) {
          await this.createIdempotencyKey(key, metadata, tenantId);
        } else {
          // Update existing key to processing status
          await this.service.updateIdempotencyKey({
            key,
            status: IdempotencyStatus.PROCESSING
          });
        }

        // Set up response interception
        this.setupResponseInterception(request, reply, key, tenantId);

      } finally {
        this.activeChecks.delete(concurrentKey);
      }

    } catch (error) {
      logger.error('Idempotency processing failed', {
        key,
        tenantId,
        operationId,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Perform idempotency check
   */
  private async performIdempotencyCheck(
    key: string,
    metadata: IdempotencyRequestMetadata,
    tenantId: string | undefined,
    operationId: string
  ) {
    try {
      return await this.service.checkIdempotencyKey(key, metadata, tenantId);
    } catch (error) {
      logger.error('Idempotency check failed', {
        key,
        tenantId,
        operationId,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Wait for concurrent request completion
   */
  private async waitForCompletion(
    key: string,
    tenantId: string | undefined,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const result = await this.service.waitForCompletion(key, tenantId, this.options.timeoutMs);

      if (result.cachedResponse) {
        await this.returnCachedResponse(reply, result.cachedResponse);
      } else if (result.shouldProceed) {
        // Can proceed now
        return;
      } else {
        await this.handleConflict(reply, result);
      }
    } catch (error) {
      if (error instanceof IdempotencyTimeoutError) {
        this.sendError(reply, 408, 'IDEMPOTENCY_TIMEOUT',
          'Request timeout while waiting for concurrent operation');
      } else {
        throw error;
      }
    }
  }

  /**
   * Create new idempotency key
   */
  private async createIdempotencyKey(
    key: string,
    metadata: IdempotencyRequestMetadata,
    tenantId?: string
  ): Promise<void> {
    const request: CreateIdempotencyKeyRequest = {
      key,
      requestMetadata: metadata,
      expirationMinutes: 24 * 60, // 24 hours
      tenantId,
      userId: metadata.userId,
      sessionId: metadata.sessionId
    };

    await this.service.createIdempotencyKey(request);
  }

  /**
   * Set up response interception for caching
   */
  private setupResponseInterception(
    request: FastifyRequest,
    reply: FastifyReply,
    key: string,
    tenantId?: string
  ): void {
    if (request.idempotency?.skipResponseCaching) {
      return;
    }

    const originalSend = reply.send.bind(reply);
    let responseCached = false;

    reply.send = function(payload: any) {
      // Cache successful responses only
      if (!responseCached && reply.statusCode >= 200 && reply.statusCode < 400) {
        responseCached = true;

        // Extract response metadata
        const responseMetadata: IdempotencyResponseMetadata = {
          statusCode: reply.statusCode,
          headers: reply.getHeaders() as Record<string, any>,
          body: payload,
          contentLength: Buffer.byteLength(JSON.stringify(payload)),
          contentType: reply.getHeader('content-type') as string
        };

        // Cache response asynchronously
        setImmediate(async () => {
          try {
            await this.service.updateIdempotencyKey({
              key,
              status: IdempotencyStatus.COMPLETED,
              responseMetadata,
              processingDurationMs: Date.now() - request.idempotency!.startTime
            });

            logger.debug('Response cached for idempotency key', {
              key,
              statusCode: reply.statusCode,
              contentLength: responseMetadata.contentLength
            });

          } catch (error) {
            logger.error('Failed to cache response', {
              key,
              error: error.message
            });

            // Try to update status to failed
            try {
              await this.service.updateIdempotencyKey({
                key,
                status: IdempotencyStatus.FAILED,
                errorMessage: `Failed to cache response: ${error.message}`,
                errorCode: 'CACHE_ERROR'
              });
            } catch (updateError) {
              logger.error('Failed to update key status after cache error', {
                key,
                error: updateError.message
              });
            }
          }
        });
      }

      return originalSend(payload);
    };

    // Handle errors by updating idempotency key
    reply.addHook('onError', async (request, reply, error) => {
      if (!responseCached) {
        try {
          await this.service.updateIdempotencyKey({
            key,
            status: IdempotencyStatus.FAILED,
            errorMessage: error.message,
            errorCode: error.code || 'UNKNOWN_ERROR',
            errorDetails: { stack: error.stack },
            processingDurationMs: Date.now() - request.idempotency!.startTime
          });
        } catch (updateError) {
          logger.error('Failed to update key status on error', {
            key,
            error: updateError.message
          });
        }
      }
    });
  }

  /**
   * Return cached response
   */
  private async returnCachedResponse(
    reply: FastifyReply,
    responseMetadata: IdempotencyResponseMetadata
  ): Promise<void> {
    try {
      // Set status code
      reply.status(responseMetadata.statusCode);

      // Set headers
      if (responseMetadata.headers) {
        Object.entries(responseMetadata.headers).forEach(([name, value]) => {
          if (name.toLowerCase() !== 'content-length') {
            reply.header(name, value);
          }
        });
      }

      // Add idempotency headers
      reply.header('x-idempotent-replayed', 'true');
      reply.header('x-cache-status', 'hit');

      // Send cached body
      const body = typeof responseMetadata.body === 'string' 
        ? JSON.parse(responseMetadata.body)
        : responseMetadata.body;

      await reply.send(body);

      logger.debug('Returned cached idempotent response', {
        statusCode: responseMetadata.statusCode,
        contentLength: responseMetadata.contentLength
      });

    } catch (error) {
      logger.error('Failed to return cached response', {
        error: error.message,
        statusCode: responseMetadata.statusCode
      });

      throw error;
    }
  }

  /**
   * Handle idempotency conflicts
   */
  private async handleConflict(reply: FastifyReply, checkResult: any): Promise<void> {
    const conflict = checkResult.conflict;

    if (!conflict) {
      return this.sendError(reply, 500, 'UNKNOWN_CONFLICT', 'Unknown idempotency conflict');
    }

    // Log conflict
    if (this.options.logConflicts) {
      logger.warn('Idempotency conflict detected', {
        type: conflict.type,
        message: conflict.message,
        details: conflict.details
      });
    }

    // Notify about violations
    if (this.options.notifyOnViolations && this.options.onConflictDetected) {
      try {
        await this.options.onConflictDetected(conflict);
      } catch (error) {
        logger.error('Conflict notification failed', { error: error.message });
      }
    }

    // Return appropriate error
    switch (conflict.type) {
      case IdempotencyConflictType.FINGERPRINT_MISMATCH:
        return this.sendError(reply, 409, 'IDEMPOTENCY_KEY_CONFLICT',
          'Idempotency key already used with different request');

      case IdempotencyConflictType.CONCURRENT_PROCESSING:
        return this.sendError(reply, 409, 'CONCURRENT_REQUEST',
          'Request is currently being processed');

      case IdempotencyConflictType.KEY_EXPIRED:
        return this.sendError(reply, 410, 'IDEMPOTENCY_KEY_EXPIRED',
          'Idempotency key has expired');

      case IdempotencyConflictType.INVALID_STATE:
        return this.sendError(reply, 422, 'INVALID_KEY_STATE',
          conflict.message);

      default:
        return this.sendError(reply, 409, 'IDEMPOTENCY_CONFLICT',
          conflict.message);
    }
  }

  /**
   * Handle middleware errors
   */
  private async handleError(
    request: FastifyRequest,
    reply: FastifyReply,
    error: Error
  ): Promise<void> {
    if (error instanceof IdempotencyError) {
      return this.sendError(reply, 400, error.code, error.message);
    }

    if (error instanceof IdempotencyTimeoutError) {
      return this.sendError(reply, 408, error.code, error.message);
    }

    // Generic error
    const errorCode = this.options.returnDetailedErrors ? error.message : 'Internal server error';
    return this.sendError(reply, 500, 'INTERNAL_ERROR', errorCode);
  }

  /**
   * Send error response
   */
  private async sendError(
    reply: FastifyReply,
    statusCode: number,
    code: string,
    message: string,
    details?: any
  ): Promise<void> {
    const errorResponse: any = {
      error: true,
      code,
      message
    };

    if (this.options.returnDetailedErrors && details) {
      errorResponse.details = details;
    }

    await reply.status(statusCode).send(errorResponse);
  }

  // Utility methods

  private shouldApplyIdempotency(request: FastifyRequest): boolean {
    // Check method
    if (!this.options.allowedMethods.includes(request.method)) {
      return false;
    }

    // Check excluded paths
    if (this.options.excludedPaths?.some(path => request.url.startsWith(path))) {
      return false;
    }

    return true;
  }

  private isIdempotencyRequired(request: FastifyRequest): boolean {
    return this.options.requiredForPaths?.some(path => request.url.startsWith(path)) || false;
  }

  private extractIdempotencyKey(request: FastifyRequest): string | undefined {
    const headerValue = request.headers[this.options.headerName.toLowerCase()];
    
    if (Array.isArray(headerValue)) {
      return headerValue[0];
    }
    
    return typeof headerValue === 'string' ? headerValue : undefined;
  }

  private validateKeyFormat(key: string): boolean {
    if (!this.options.enforceKeyFormat) {
      return true;
    }

    if (key.length < this.options.keyMinLength || key.length > this.options.keyMaxLength) {
      return false;
    }

    // Allow custom format or use default UUID/alphanumeric pattern
    if (this.options.allowCustomKeyFormat) {
      return /^[a-zA-Z0-9_-]+$/.test(key);
    }

    // Strict UUID v4 format
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key);
  }

  private createRequestMetadata(request: FastifyRequest): IdempotencyRequestMetadata {
    const metadata: IdempotencyRequestMetadata = {
      method: request.method,
      url: request.url,
      contentType: request.headers['content-type'],
      userAgent: request.headers['user-agent'],
      tenantId: this.extractTenantId(request),
      userId: this.extractUserId(request),
      sessionId: this.extractSessionId(request),
      clientId: this.extractClientId(request)
    };

    // Include body if enabled
    if (this.options.includeBodyInFingerprint && request.body) {
      metadata.body = request.body;
    }

    // Include selected headers
    if (this.options.fingerprintFields.includes('headers')) {
      const headers: Record<string, string> = {};
      Object.entries(request.headers).forEach(([key, value]) => {
        if (!this.options.ignoreHeaders?.includes(key.toLowerCase())) {
          headers[key] = Array.isArray(value) ? value[0] : (value as string);
        }
      });
      metadata.headers = headers;
    }

    return metadata;
  }

  private createFingerprint(metadata: IdempotencyRequestMetadata): string {
    if (!this.options.enableFingerprinting) {
      return '';
    }

    const fingerprintData: any = {};
    
    this.options.fingerprintFields.forEach(field => {
      if (field in metadata) {
        fingerprintData[field] = (metadata as any)[field];
      }
    });

    const crypto = require('crypto');
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(fingerprintData, Object.keys(fingerprintData).sort()))
      .digest('hex');
  }

  private extractTenantId(request: FastifyRequest): string | undefined {
    // Try multiple sources for tenant ID
    return (request as any).tenant?.tenantId || 
           request.headers['x-tenant-id'] as string ||
           (request.user as any)?.tenantId;
  }

  private extractUserId(request: FastifyRequest): string | undefined {
    return (request as any).tenant?.userId || 
           (request.user as any)?.id ||
           request.headers['x-user-id'] as string;
  }

  private extractSessionId(request: FastifyRequest): string | undefined {
    return request.headers['x-session-id'] as string ||
           (request as any).session?.id;
  }

  private extractClientId(request: FastifyRequest): string | undefined {
    return request.headers['x-client-id'] as string;
  }

  private checkRateLimit(request: FastifyRequest): boolean {
    const clientKey = this.extractClientId(request) || 
                     this.extractUserId(request) || 
                     (request.ip || 'unknown');

    const currentCount = this.requestCount.get(clientKey) || 0;
    
    if (currentCount >= this.options.maxConcurrentChecks) {
      return false;
    }

    this.requestCount.set(clientKey, currentCount + 1);
    
    // Cleanup count after processing
    setImmediate(() => {
      const count = this.requestCount.get(clientKey) || 0;
      if (count > 1) {
        this.requestCount.set(clientKey, count - 1);
      } else {
        this.requestCount.delete(clientKey);
      }
    });

    return true;
  }

  private generateOperationId(): string {
    return `idem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private cleanup(): void {
    // Clear old active checks (should be handled by promise completion)
    const now = Date.now();
    const threshold = 5 * 60 * 1000; // 5 minutes

    // Clean up request counts that might be stuck
    for (const [key, count] of this.requestCount.entries()) {
      if (count === 0) {
        this.requestCount.delete(key);
      }
    }
  }
}

/**
 * Fastify plugin for idempotency middleware
 */
async function idempotencyPlugin(
  fastify: FastifyInstance,
  options: {
    service?: IdempotencyService;
    middleware?: Partial<IdempotencyMiddlewareOptions>;
  }
) {
  // Create or use provided service
  const service = options.service || new IdempotencyService(fastify, {
    enableDistributedTransactions: true,
    enableEventEmission: true
  });

  // Create middleware
  const middleware = new IdempotencyMiddleware(service, options.middleware);

  // Register middleware
  fastify.addHook('preHandler', async (request, reply) => {
    await middleware.handle(request, reply);
  });

  // Decorate fastify with service for direct access
  fastify.decorate('idempotencyService', service);

  // Graceful shutdown
  fastify.addHook('onClose', async () => {
    await service.shutdown();
  });

  fastify.log.info('Idempotency plugin registered successfully');
}

// Export plugin with fastify-plugin wrapper
export default fastifyPlugin(idempotencyPlugin, {
  fastify: '4.x',
  name: 'idempotency'
});

export { IdempotencyMiddleware, idempotencyPlugin };