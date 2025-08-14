/**
 * Advanced Response Caching Middleware
 * Provides intelligent HTTP response caching with cache invalidation,
 * conditional caching, and high-performance cache key strategies
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { CacheService } from '../services/cache.service.js';
import { CacheKeyUtils, CacheNamespace, CacheTTL } from '../utils/cache-keys.js';

/**
 * Cache configuration options
 */
export interface CacheMiddlewareConfig {
  // TTL settings
  ttl?: number;
  maxTTL?: number;
  
  // Cache conditions
  methods?: string[];
  statusCodes?: number[];
  contentTypes?: string[];
  
  // Cache key strategy
  keyStrategy?: {
    includeHeaders?: string[];
    includeQuery?: boolean;
    includeBody?: boolean;
    customKeyGenerator?: (request: FastifyRequest) => string | Promise<string>;
  };
  
  // Cache conditions
  shouldCache?: (
    request: FastifyRequest, 
    reply: FastifyReply,
    body?: any
  ) => boolean | Promise<boolean>;
  
  shouldServeStale?: boolean;
  staleTTL?: number;
  
  // Vary headers
  varyHeaders?: string[];
  
  // Cache invalidation
  invalidateOn?: {
    methods?: string[];
    patterns?: string[];
    headers?: Record<string, string>;
  };
  
  // Response transformation
  beforeCache?: (body: any) => any | Promise<any>;
  afterCache?: (body: any) => any | Promise<any>;
  
  // Tags for cache invalidation
  tags?: string[] | ((request: FastifyRequest) => string[] | Promise<string[]>);
  
  // Compression
  compress?: boolean;
  
  // Privacy
  private?: boolean;
  
  // Debug
  debug?: boolean;
}

/**
 * Cached response data
 */
interface CachedResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: any;
  timestamp: number;
  etag?: string;
  tags?: string[];
  compressed?: boolean;
}

/**
 * Default cache configuration
 */
const DEFAULT_CONFIG: Required<Omit<CacheMiddlewareConfig, 
  'shouldCache' | 'beforeCache' | 'afterCache' | 'tags' | 'keyStrategy'
>> = {
  ttl: CacheTTL.MINUTE_5,
  maxTTL: CacheTTL.HOUR_1,
  methods: ['GET', 'HEAD'],
  statusCodes: [200, 203, 300, 301, 302, 304, 410],
  contentTypes: [
    'application/json',
    'application/javascript',
    'text/css',
    'text/html',
    'text/plain',
    'application/xml',
    'text/xml',
  ],
  keyStrategy: {},
  shouldServeStale: true,
  staleTTL: CacheTTL.HOUR_1,
  varyHeaders: ['Accept', 'Accept-Encoding', 'Accept-Language'],
  invalidateOn: {},
  compress: true,
  private: false,
  debug: false,
};

/**
 * Response cache middleware class
 */
export class CacheMiddleware {
  private config: CacheMiddlewareConfig;
  private cacheService: CacheService;
  private tagMap = new Map<string, Set<string>>(); // tag -> keys mapping

  constructor(
    cacheService: CacheService,
    config: CacheMiddlewareConfig = {}
  ) {
    this.cacheService = cacheService;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Main cache middleware function
   */
  middleware() {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      // Check if request should be cached
      if (!await this.shouldCacheRequest(request)) {
        return;
      }

      const cacheKey = await this.generateCacheKey(request);
      
      // Try to serve from cache
      const cached = await this.getFromCache(cacheKey, request);
      if (cached && await this.isCacheValid(cached, request)) {
        await this.serveCachedResponse(cached, request, reply);
        return;
      }

      // Set up response caching
      await this.setupResponseCaching(cacheKey, request, reply);
    };
  }

  /**
   * Check if request should be cached
   */
  private async shouldCacheRequest(request: FastifyRequest): Promise<boolean> {
    // Check method
    if (!this.config.methods?.includes(request.method)) {
      return false;
    }

    // Check custom condition
    if (this.config.shouldCache) {
      // Reply is not available at this point, pass undefined
      return await this.config.shouldCache(request, undefined as any);
    }

    // Check cache-control headers
    const cacheControl = request.headers['cache-control'];
    if (cacheControl?.includes('no-cache') || cacheControl?.includes('no-store')) {
      return false;
    }

    return true;
  }

  /**
   * Generate cache key for request
   */
  private async generateCacheKey(request: FastifyRequest): Promise<string> {
    const keyStrategy = this.config.keyStrategy || {};
    
    if (keyStrategy.customKeyGenerator) {
      return await keyStrategy.customKeyGenerator(request);
    }

    // Build key components
    const components: string[] = [];
    
    // Method and URL
    components.push(request.method.toLowerCase());
    components.push(request.url);
    
    // Query parameters
    if (keyStrategy.includeQuery !== false) {
      const queryHash = this.hashObject(request.query);
      if (queryHash) {
        components.push(`q:${queryHash}`);
      }
    }
    
    // Body hash (for POST/PUT requests)
    if (keyStrategy.includeBody && request.body) {
      const bodyHash = this.hashObject(request.body);
      components.push(`b:${bodyHash}`);
    }
    
    // Headers
    if (keyStrategy.includeHeaders) {
      const headerValues: Record<string, any> = {};
      for (const header of keyStrategy.includeHeaders) {
        headerValues[header] = request.headers[header.toLowerCase()];
      }
      const headerHash = this.hashObject(headerValues);
      components.push(`h:${headerHash}`);
    }

    // User context
    const userId = request.user?.id;
    const tenantId = request.user?.tenant_id;

    // Generate the final key
    const identifier = components.join('|');
    
    return CacheKeyUtils.generateApiResponse(
      request.method,
      request.routerPath || request.url,
      this.hashString(identifier),
      tenantId,
      userId
    );
  }

  /**
   * Get response from cache
   */
  private async getFromCache(
    key: string, 
    request: FastifyRequest
  ): Promise<CachedResponse | undefined> {
    try {
      const cached = await this.cacheService.get<CachedResponse>(key);
      
      if (cached && this.config.debug) {
        request.server.log.info('Cache hit:', { key, url: request.url });
      }
      
      return cached;
    } catch (error) {
      if (this.config.debug) {
        request.server.log.error('Cache get error:', { key, error });
      }
      return undefined;
    }
  }

  /**
   * Check if cached response is still valid
   */
  private async isCacheValid(
    cached: CachedResponse, 
    request: FastifyRequest
  ): Promise<boolean> {
    // Check If-None-Match header (ETag)
    const ifNoneMatch = request.headers['if-none-match'];
    if (ifNoneMatch && cached.etag && ifNoneMatch === cached.etag) {
      return true;
    }

    // Check If-Modified-Since header
    const ifModifiedSince = request.headers['if-modified-since'];
    if (ifModifiedSince) {
      const modifiedTime = new Date(ifModifiedSince).getTime();
      if (cached.timestamp <= modifiedTime) {
        return true;
      }
    }

    return true;
  }

  /**
   * Serve cached response
   */
  private async serveCachedResponse(
    cached: CachedResponse,
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      // Set status code
      reply.status(cached.statusCode);

      // Set headers
      for (const [name, value] of Object.entries(cached.headers)) {
        reply.header(name, value);
      }

      // Set cache headers
      reply.header('X-Cache', 'HIT');
      reply.header('X-Cache-Key', await this.generateCacheKey(request));
      
      if (cached.etag) {
        reply.header('ETag', cached.etag);
      }

      // Handle conditional requests
      const ifNoneMatch = request.headers['if-none-match'];
      if (ifNoneMatch && cached.etag && ifNoneMatch === cached.etag) {
        return reply.status(304).send();
      }

      // Transform body if needed
      let body = cached.body;
      if (this.config.afterCache) {
        body = await this.config.afterCache(body);
      }

      // Send response
      reply.send(body);
      
    } catch (error) {
      request.server.log.error('Error serving cached response:', error);
      // Continue with normal request processing
    }
  }

  /**
   * Setup response caching hooks
   */
  private async setupResponseCaching(
    cacheKey: string,
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const originalSend = reply.send.bind(reply);
    
    reply.send = (payload: any) => {
      // Cache the response asynchronously
      this.cacheResponse(cacheKey, request, reply, payload)
        .catch(error => {
          request.server.log.error('Error caching response:', { 
            key: cacheKey, 
            error 
          });
        });
        
      return originalSend(payload);
    };

    // Set cache miss header
    reply.header('X-Cache', 'MISS');
    reply.header('X-Cache-Key', cacheKey);
  }

  /**
   * Cache the response
   */
  private async cacheResponse(
    cacheKey: string,
    request: FastifyRequest,
    reply: FastifyReply,
    body: any
  ): Promise<void> {
    try {
      // Check if response should be cached
      if (!await this.shouldCacheResponse(request, reply, body)) {
        return;
      }

      // Transform body if needed
      let processedBody = body;
      if (this.config.beforeCache) {
        processedBody = await this.config.beforeCache(body);
      }

      // Generate ETag
      const etag = this.generateETag(processedBody);

      // Get tags for cache invalidation
      const tags = await this.getCacheTags(request);

      // Create cached response object
      const cachedResponse: CachedResponse = {
        statusCode: reply.statusCode,
        headers: this.extractCacheableHeaders(reply),
        body: processedBody,
        timestamp: Date.now(),
        etag,
        tags,
        compressed: this.config.compress,
      };

      // Cache the response
      const ttl = this.determineTTL(request, reply);
      await this.cacheService.set(
        cacheKey, 
        cachedResponse, 
        ttl,
        {
          namespace: CacheNamespace.API_RESPONSE,
          compress: this.config.compress,
        }
      );

      // Update tag mapping
      if (tags) {
        this.updateTagMapping(cacheKey, tags);
      }

      if (this.config.debug) {
        request.server.log.info('Response cached:', { 
          key: cacheKey, 
          ttl,
          tags,
          url: request.url 
        });
      }

    } catch (error) {
      request.server.log.error('Error caching response:', { 
        key: cacheKey, 
        error 
      });
    }
  }

  /**
   * Check if response should be cached
   */
  private async shouldCacheResponse(
    request: FastifyRequest,
    reply: FastifyReply,
    body: any
  ): Promise<boolean> {
    // Check status code
    if (!this.config.statusCodes?.includes(reply.statusCode)) {
      return false;
    }

    // Check content type
    const contentType = reply.getHeader('content-type') as string;
    if (contentType && this.config.contentTypes) {
      const matches = this.config.contentTypes.some(type => 
        contentType.toLowerCase().includes(type.toLowerCase())
      );
      if (!matches) {
        return false;
      }
    }

    // Check cache-control headers
    const cacheControl = reply.getHeader('cache-control') as string;
    if (cacheControl?.includes('no-cache') || cacheControl?.includes('no-store')) {
      return false;
    }

    // Custom condition
    if (this.config.shouldCache) {
      return await this.config.shouldCache(request, reply, body);
    }

    // Check for errors in response body
    if (body && typeof body === 'object' && body.error) {
      return false;
    }

    return true;
  }

  /**
   * Extract cacheable headers from response
   */
  private extractCacheableHeaders(reply: FastifyReply): Record<string, string | string[]> {
    const headers: Record<string, string | string[]> = {};
    
    // Headers to preserve in cache
    const preserveHeaders = [
      'content-type',
      'content-encoding',
      'content-language',
      'content-disposition',
      'last-modified',
      'etag',
      'expires',
      'cache-control',
    ];

    for (const header of preserveHeaders) {
      const value = reply.getHeader(header);
      if (value !== undefined) {
        headers[header] = value;
      }
    }

    // Add vary headers
    if (this.config.varyHeaders && this.config.varyHeaders.length > 0) {
      headers['vary'] = this.config.varyHeaders.join(', ');
    }

    return headers;
  }

  /**
   * Determine TTL for cache entry
   */
  private determineTTL(request: FastifyRequest, reply: FastifyReply): number {
    // Check Cache-Control header
    const cacheControl = reply.getHeader('cache-control') as string;
    if (cacheControl) {
      const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
      if (maxAgeMatch) {
        const maxAge = parseInt(maxAgeMatch[1], 10);
        return Math.min(maxAge, this.config.maxTTL || CacheTTL.HOUR_1);
      }
    }

    // Check Expires header
    const expires = reply.getHeader('expires') as string;
    if (expires) {
      const expiresTime = new Date(expires).getTime();
      const now = Date.now();
      const ttl = Math.floor((expiresTime - now) / 1000);
      if (ttl > 0) {
        return Math.min(ttl, this.config.maxTTL || CacheTTL.HOUR_1);
      }
    }

    return this.config.ttl || CacheTTL.MINUTE_5;
  }

  /**
   * Get cache tags for invalidation
   */
  private async getCacheTags(request: FastifyRequest): Promise<string[] | undefined> {
    if (!this.config.tags) {
      return undefined;
    }

    if (typeof this.config.tags === 'function') {
      return await this.config.tags(request);
    }

    return this.config.tags;
  }

  /**
   * Update tag to key mapping
   */
  private updateTagMapping(key: string, tags: string[]): void {
    for (const tag of tags) {
      if (!this.tagMap.has(tag)) {
        this.tagMap.set(tag, new Set());
      }
      this.tagMap.get(tag)!.add(key);
    }
  }

  /**
   * Generate ETag for response
   */
  private generateETag(body: any): string {
    const content = typeof body === 'string' ? body : JSON.stringify(body);
    const hash = createHash('md5').update(content).digest('hex');
    return `"${hash}"`;
  }

  /**
   * Hash object for cache key generation
   */
  private hashObject(obj: any): string {
    if (!obj || typeof obj !== 'object') {
      return '';
    }
    
    const str = JSON.stringify(obj, Object.keys(obj).sort());
    return this.hashString(str);
  }

  /**
   * Hash string
   */
  private hashString(str: string): string {
    return createHash('md5').update(str).digest('hex').substring(0, 8);
  }

  /**
   * Invalidate cache by tags
   */
  async invalidateByTags(tags: string[]): Promise<number> {
    let totalInvalidated = 0;
    
    for (const tag of tags) {
      const keys = this.tagMap.get(tag);
      if (keys) {
        for (const key of keys) {
          const deleted = await this.cacheService.delete(key);
          if (deleted) {
            totalInvalidated++;
          }
        }
        this.tagMap.delete(tag);
      }
    }
    
    return totalInvalidated;
  }

  /**
   * Invalidate cache by pattern
   */
  async invalidateByPattern(pattern: string): Promise<number> {
    return await this.cacheService.deleteByPattern(pattern);
  }

  /**
   * Clear all cache
   */
  async clearAll(): Promise<void> {
    await this.cacheService.clear();
    this.tagMap.clear();
  }
}

/**
 * Create cache middleware with configuration
 */
export function createCacheMiddleware(
  cacheService: CacheService,
  config: CacheMiddlewareConfig = {}
) {
  const middleware = new CacheMiddleware(cacheService, config);
  return middleware.middleware();
}

/**
 * Predefined cache configurations
 */
export const CachePresets = {
  /**
   * API responses - moderate caching
   */
  api: {
    ttl: CacheTTL.MINUTE_5,
    methods: ['GET'],
    statusCodes: [200],
    contentTypes: ['application/json'],
    varyHeaders: ['Authorization', 'Accept'],
  } satisfies CacheMiddlewareConfig,

  /**
   * Static content - long caching
   */
  static: {
    ttl: CacheTTL.DAY_1,
    methods: ['GET', 'HEAD'],
    statusCodes: [200, 304],
    contentTypes: ['text/css', 'application/javascript', 'image/*'],
    varyHeaders: ['Accept-Encoding'],
  } satisfies CacheMiddlewareConfig,

  /**
   * Public content - medium caching
   */
  public: {
    ttl: CacheTTL.MINUTE_15,
    methods: ['GET'],
    statusCodes: [200, 203],
    varyHeaders: ['Accept', 'Accept-Language'],
    private: false,
  } satisfies CacheMiddlewareConfig,

  /**
   * User-specific content - short caching
   */
  userSpecific: {
    ttl: CacheTTL.MINUTE_2,
    methods: ['GET'],
    statusCodes: [200],
    varyHeaders: ['Authorization'],
    private: true,
    keyStrategy: {
      includeHeaders: ['authorization'],
    },
  } satisfies CacheMiddlewareConfig,

  /**
   * Search results - very short caching
   */
  search: {
    ttl: CacheTTL.SECONDS_30,
    methods: ['GET'],
    statusCodes: [200],
    keyStrategy: {
      includeQuery: true,
    },
  } satisfies CacheMiddlewareConfig,
};

/**
 * Create preset cache middleware
 */
export function createPresetCache(
  cacheService: CacheService,
  preset: keyof typeof CachePresets,
  overrides: CacheMiddlewareConfig = {}
) {
  const config = { ...CachePresets[preset], ...overrides };
  return createCacheMiddleware(cacheService, config);
}

export default {
  createCacheMiddleware,
  createPresetCache,
  CacheMiddleware,
  CachePresets,
};