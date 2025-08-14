import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { config } from '../config';
import { logger } from '../config/logger';
import { generateCorrelationId } from '../utils/async-handler';

/**
 * Request logger options
 */
interface RequestLoggerOptions {
  /**
   * Enable request/response body logging
   */
  logBodies?: boolean;
  
  /**
   * Maximum body size to log (in bytes)
   */
  maxBodySize?: number;
  
  /**
   * Sensitive fields to mask in logs
   */
  sensitiveFields?: string[];
  
  /**
   * Headers to exclude from logs
   */
  excludeHeaders?: string[];
  
  /**
   * Log level for successful requests
   */
  successLevel?: 'debug' | 'info' | 'warn';
  
  /**
   * Log level for client errors (4xx)
   */
  clientErrorLevel?: 'debug' | 'info' | 'warn' | 'error';
  
  /**
   * Log level for server errors (5xx)
   */
  serverErrorLevel?: 'debug' | 'info' | 'warn' | 'error';
  
  /**
   * Skip logging for specific routes (health checks, metrics, etc.)
   */
  skipRoutes?: string[];
  
  /**
   * Custom formatter for request logs
   */
  requestFormatter?: (req: FastifyRequest) => Record<string, any>;
  
  /**
   * Custom formatter for response logs
   */
  responseFormatter?: (req: FastifyRequest, reply: FastifyReply, responseTime: number) => Record<string, any>;
}

/**
 * Request metrics for performance monitoring
 */
interface RequestMetrics {
  method: string;
  route: string;
  statusCode: number;
  responseTime: number;
  timestamp: string;
  correlationId: string;
  userAgent?: string;
  ip?: string;
  userId?: string;
  tenantId?: string;
}

/**
 * In-memory metrics storage (use Redis or external service in production)
 */
const requestMetrics: RequestMetrics[] = [];
const MAX_METRICS_SIZE = 10000;

/**
 * Request logger plugin for Fastify
 */
async function requestLoggerPlugin(
  fastify: FastifyInstance,
  options: RequestLoggerOptions = {}
): Promise<void> {
  const {
    logBodies = config.NODE_ENV === 'development',
    maxBodySize = 10240, // 10KB
    sensitiveFields = [
      'password',
      'passwordHash',
      'token',
      'refreshToken',
      'accessToken',
      'apiKey',
      'secret',
      'creditCard',
      'ssn',
      'authorization'
    ],
    excludeHeaders = [
      'authorization',
      'cookie',
      'x-api-key',
      'x-forwarded-for'
    ],
    successLevel = 'info',
    clientErrorLevel = 'warn',
    serverErrorLevel = 'error',
    skipRoutes = ['/health', '/metrics', '/documentation'],
    requestFormatter,
    responseFormatter
  } = options;

  // Add correlation ID to all requests
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const correlationId = getOrCreateCorrelationId(request);
    
    // Store correlation ID in request context
    (request as any).correlationId = correlationId;
    
    // Add correlation ID to response headers
    reply.header('X-Correlation-ID', correlationId);
    
    // Store request start time
    (request as any).startTime = process.hrtime.bigint();
  });

  // Log incoming requests
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip logging for certain routes
    if (shouldSkipLogging(request.url, skipRoutes)) {
      return;
    }

    const correlationId = (request as any).correlationId;
    const requestData = requestFormatter ? 
      requestFormatter(request) : 
      formatRequestLog(request, logBodies, maxBodySize, sensitiveFields, excludeHeaders);

    logger.info({
      ...requestData,
      correlationId,
      type: 'request',
    }, `Incoming ${request.method} ${request.url}`);
  });

  // Log outgoing responses
  fastify.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload: any) => {
    // Skip logging for certain routes
    if (shouldSkipLogging(request.url, skipRoutes)) {
      return payload;
    }

    const correlationId = (request as any).correlationId;
    const startTime = (request as any).startTime;
    const responseTime = startTime ? Number(process.hrtime.bigint() - startTime) / 1000000 : 0; // Convert to milliseconds

    const responseData = responseFormatter ?
      responseFormatter(request, reply, responseTime) :
      formatResponseLog(request, reply, responseTime, payload, logBodies, maxBodySize, sensitiveFields);

    // Determine log level based on status code
    const statusCode = reply.statusCode;
    let logLevel: 'debug' | 'info' | 'warn' | 'error' = successLevel;
    
    if (statusCode >= 500) {
      logLevel = serverErrorLevel;
    } else if (statusCode >= 400) {
      logLevel = clientErrorLevel;
    }

    logger[logLevel]({
      ...responseData,
      correlationId,
      type: 'response',
    }, `${request.method} ${request.url} - ${statusCode} - ${responseTime.toFixed(2)}ms`);

    // Record metrics
    recordRequestMetrics({
      method: request.method,
      route: extractRoutePattern(request),
      statusCode,
      responseTime,
      timestamp: new Date().toISOString(),
      correlationId,
      userAgent: request.headers['user-agent'] as string,
      ip: request.ip,
      userId: (request as any).user?.id,
      tenantId: (request as any).tenantId,
    });

    return payload;
  });

  // Add metrics endpoint if metrics are enabled
  if (config.ENABLE_METRICS) {
    fastify.get('/metrics/requests', async () => {
      const now = Date.now();
      const oneHourAgo = now - (60 * 60 * 1000);
      
      const recentMetrics = requestMetrics.filter(
        metric => new Date(metric.timestamp).getTime() > oneHourAgo
      );

      const summary = generateMetricsSummary(recentMetrics);
      
      return {
        timestamp: new Date().toISOString(),
        period: '1h',
        summary,
        recentRequests: recentMetrics.slice(-100), // Last 100 requests
      };
    });
  }
}

/**
 * Get or create correlation ID from request
 */
function getOrCreateCorrelationId(request: FastifyRequest): string {
  return (request.headers['x-correlation-id'] as string) ||
         (request.headers['x-request-id'] as string) ||
         generateCorrelationId();
}

/**
 * Check if logging should be skipped for a route
 */
function shouldSkipLogging(url: string, skipRoutes: string[]): boolean {
  return skipRoutes.some(route => url.startsWith(route));
}

/**
 * Format request data for logging
 */
function formatRequestLog(
  request: FastifyRequest,
  logBodies: boolean,
  maxBodySize: number,
  sensitiveFields: string[],
  excludeHeaders: string[]
): Record<string, any> {
  const headers = { ...request.headers };
  
  // Remove excluded headers
  excludeHeaders.forEach(header => {
    delete headers[header.toLowerCase()];
  });

  const requestData: Record<string, any> = {
    method: request.method,
    url: request.url,
    headers,
    params: maskSensitiveData({ ...request.params }, sensitiveFields),
    query: maskSensitiveData({ ...request.query }, sensitiveFields),
    ip: request.ip,
    userAgent: request.headers['user-agent'],
    contentLength: request.headers['content-length'],
  };

  // Add body if enabled and within size limit
  if (logBodies && request.body) {
    const bodyStr = JSON.stringify(request.body);
    if (bodyStr.length <= maxBodySize) {
      requestData.body = maskSensitiveData(request.body, sensitiveFields);
    } else {
      requestData.body = '[BODY_TOO_LARGE]';
      requestData.bodySize = bodyStr.length;
    }
  }

  return requestData;
}

/**
 * Format response data for logging
 */
function formatResponseLog(
  request: FastifyRequest,
  reply: FastifyReply,
  responseTime: number,
  payload: any,
  logBodies: boolean,
  maxBodySize: number,
  sensitiveFields: string[]
): Record<string, any> {
  const responseData: Record<string, any> = {
    method: request.method,
    url: request.url,
    statusCode: reply.statusCode,
    responseTime: Math.round(responseTime * 100) / 100, // Round to 2 decimal places
    contentLength: reply.getHeader('content-length'),
    contentType: reply.getHeader('content-type'),
  };

  // Add response body if enabled and within size limit
  if (logBodies && payload && reply.statusCode < 400) {
    try {
      const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
      if (payloadStr.length <= maxBodySize) {
        const parsedPayload = typeof payload === 'string' ? JSON.parse(payload) : payload;
        responseData.body = maskSensitiveData(parsedPayload, sensitiveFields);
      } else {
        responseData.body = '[BODY_TOO_LARGE]';
        responseData.bodySize = payloadStr.length;
      }
    } catch (error) {
      responseData.body = '[UNPARSEABLE_BODY]';
    }
  }

  return responseData;
}

/**
 * Mask sensitive data in objects
 */
function maskSensitiveData(obj: any, sensitiveFields: string[]): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => maskSensitiveData(item, sensitiveFields));
  }

  const masked = { ...obj };
  
  for (const key in masked) {
    if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
      masked[key] = '[REDACTED]';
    } else if (typeof masked[key] === 'object') {
      masked[key] = maskSensitiveData(masked[key], sensitiveFields);
    }
  }

  return masked;
}

/**
 * Extract route pattern from request (remove IDs and dynamic segments)
 */
function extractRoutePattern(request: FastifyRequest): string {
  const url = request.url.split('?')[0]; // Remove query string
  
  // Replace UUIDs and numeric IDs with placeholders
  return url
    .replace(/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '/:id')
    .replace(/\/\d+/g, '/:id')
    .replace(/\/[a-zA-Z0-9_-]{8,}/g, '/:id'); // Generic long alphanumeric segments
}

/**
 * Record request metrics
 */
function recordRequestMetrics(metrics: RequestMetrics): void {
  requestMetrics.push(metrics);
  
  // Keep only the most recent metrics to prevent memory bloat
  if (requestMetrics.length > MAX_METRICS_SIZE) {
    requestMetrics.splice(0, requestMetrics.length - MAX_METRICS_SIZE);
  }
}

/**
 * Generate metrics summary
 */
function generateMetricsSummary(metrics: RequestMetrics[]): Record<string, any> {
  if (metrics.length === 0) {
    return {
      totalRequests: 0,
      averageResponseTime: 0,
      statusCodes: {},
      methods: {},
      routes: {},
      errors: 0,
    };
  }

  const summary = {
    totalRequests: metrics.length,
    averageResponseTime: metrics.reduce((sum, m) => sum + m.responseTime, 0) / metrics.length,
    statusCodes: {} as Record<string, number>,
    methods: {} as Record<string, number>,
    routes: {} as Record<string, { count: number; avgResponseTime: number }>,
    errors: metrics.filter(m => m.statusCode >= 400).length,
    slowestRequests: metrics
      .sort((a, b) => b.responseTime - a.responseTime)
      .slice(0, 10)
      .map(m => ({
        method: m.method,
        route: m.route,
        responseTime: m.responseTime,
        statusCode: m.statusCode,
        timestamp: m.timestamp,
      })),
  };

  // Group by status codes
  metrics.forEach(metric => {
    const statusGroup = `${Math.floor(metric.statusCode / 100)}xx`;
    summary.statusCodes[statusGroup] = (summary.statusCodes[statusGroup] || 0) + 1;
  });

  // Group by methods
  metrics.forEach(metric => {
    summary.methods[metric.method] = (summary.methods[metric.method] || 0) + 1;
  });

  // Group by routes
  metrics.forEach(metric => {
    if (!summary.routes[metric.route]) {
      summary.routes[metric.route] = { count: 0, avgResponseTime: 0 };
    }
    summary.routes[metric.route].count++;
  });

  // Calculate average response time per route
  Object.keys(summary.routes).forEach(route => {
    const routeMetrics = metrics.filter(m => m.route === route);
    summary.routes[route].avgResponseTime = 
      routeMetrics.reduce((sum, m) => sum + m.responseTime, 0) / routeMetrics.length;
  });

  return summary;
}

/**
 * Create request logger middleware with custom options
 */
export function createRequestLogger(options: RequestLoggerOptions = {}) {
  return fastifyPlugin(requestLoggerPlugin, {
    name: 'request-logger',
    fastify: '4.x',
  });
}

/**
 * Default request logger plugin
 */
export default fastifyPlugin(requestLoggerPlugin, {
  name: 'request-logger',
  fastify: '4.x',
});

/**
 * Get current request metrics (useful for monitoring)
 */
export function getRequestMetrics(): RequestMetrics[] {
  return [...requestMetrics];
}

/**
 * Clear request metrics (useful for testing)
 */
export function clearRequestMetrics(): void {
  requestMetrics.length = 0;
}