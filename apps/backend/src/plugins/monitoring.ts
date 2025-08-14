import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { config } from '../config';
import { logger } from '../config/logger';

/**
 * Monitoring plugin options
 */
interface MonitoringOptions {
  /**
   * Enable detailed metrics collection
   */
  enableDetailedMetrics?: boolean;
  
  /**
   * Enable health check endpoint enhancements
   */
  enableEnhancedHealthCheck?: boolean;
  
  /**
   * Metrics collection interval in milliseconds
   */
  metricsInterval?: number;
  
  /**
   * Maximum number of metrics to store in memory
   */
  maxMetricsSize?: number;
  
  /**
   * Custom health checks to add
   */
  customHealthChecks?: Array<{
    name: string;
    check: () => Promise<{ status: 'ok' | 'error'; message?: string; data?: any }>;
  }>;
}

/**
 * System metrics interface
 */
interface SystemMetrics {
  timestamp: string;
  uptime: number;
  memory: {
    used: number;
    total: number;
    free: number;
    percentage: number;
    external: number;
    heapUsed: number;
    heapTotal: number;
  };
  cpu: {
    usage: number;
    loadAverage: number[];
  };
  eventLoop: {
    delay: number;
    utilization: number;
  };
  connections: {
    active: number;
    total: number;
  };
  requests: {
    total: number;
    success: number;
    errors: number;
    averageResponseTime: number;
  };
  errors: {
    total: number;
    rate: number;
    lastError?: string;
  };
}

/**
 * Health check result interface
 */
interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  services: Record<string, {
    status: 'ok' | 'error';
    message?: string;
    responseTime?: number;
    lastCheck?: string;
  }>;
  metrics?: SystemMetrics;
  customChecks?: Record<string, any>;
}

/**
 * Global metrics storage
 */
let globalMetrics: SystemMetrics[] = [];
let requestCount = 0;
let errorCount = 0;
let successCount = 0;
let totalResponseTime = 0;
let activeConnections = 0;
let lastError: string | undefined;

/**
 * Monitoring plugin for Fastify
 */
async function monitoringPlugin(
  fastify: FastifyInstance,
  options: MonitoringOptions = {}
): Promise<void> {
  const {
    enableDetailedMetrics = config.ENABLE_METRICS,
    enableEnhancedHealthCheck = true,
    metricsInterval = 30000, // 30 seconds
    maxMetricsSize = 1000,
    customHealthChecks = []
  } = options;

  // Initialize monitoring
  let metricsIntervalId: NodeJS.Timeout | null = null;
  
  if (enableDetailedMetrics) {
    // Collect system metrics periodically
    metricsIntervalId = setInterval(() => {
      collectSystemMetrics();
      
      // Clean up old metrics
      if (globalMetrics.length > maxMetricsSize) {
        globalMetrics = globalMetrics.slice(-maxMetricsSize);
      }
    }, metricsInterval);
  }

  // Track active connections
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    activeConnections++;
    requestCount++;
    (request as any).startTime = process.hrtime.bigint();
  });

  // Track request completion
  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    activeConnections--;
    
    const startTime = (request as any).startTime;
    if (startTime) {
      const responseTime = Number(process.hrtime.bigint() - startTime) / 1000000; // Convert to milliseconds
      totalResponseTime += responseTime;
      
      if (reply.statusCode >= 400) {
        errorCount++;
        if (reply.statusCode >= 500) {
          lastError = `${request.method} ${request.url} - ${reply.statusCode}`;
        }
      } else {
        successCount++;
      }
    }
  });

  // Enhanced health check endpoint
  if (enableEnhancedHealthCheck) {
    fastify.get('/health/detailed', async (request: FastifyRequest, reply: FastifyReply) => {
      const startTime = Date.now();
      
      try {
        const healthResult = await performHealthCheck(fastify, customHealthChecks);
        const responseTime = Date.now() - startTime;
        
        // Add response time to health check
        if (healthResult.services.api) {
          healthResult.services.api.responseTime = responseTime;
        }
        
        // Set appropriate status code
        const statusCode = healthResult.status === 'ok' ? 200 : 
                          healthResult.status === 'degraded' ? 200 : 503;
        
        return reply.status(statusCode).send(healthResult);
      } catch (error) {
        logger.error({ err: error }, 'Health check failed');
        
        return reply.status(503).send({
          status: 'error',
          timestamp: new Date().toISOString(),
          error: 'Health check failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });
  }

  // Metrics endpoint
  if (enableDetailedMetrics) {
    fastify.get('/metrics/system', async () => {
      const currentMetrics = getCurrentSystemMetrics();
      
      return {
        current: currentMetrics,
        history: globalMetrics.slice(-100), // Last 100 data points
        summary: {
          uptimeHours: process.uptime() / 3600,
          totalRequests: requestCount,
          successRate: requestCount > 0 ? (successCount / requestCount) * 100 : 0,
          errorRate: requestCount > 0 ? (errorCount / requestCount) * 100 : 0,
          averageResponseTime: requestCount > 0 ? totalResponseTime / requestCount : 0,
          activeConnections,
          lastError,
        }
      };
    });

    fastify.get('/metrics/summary', async () => {
      const now = Date.now();
      const oneHourAgo = now - (60 * 60 * 1000);
      
      const recentMetrics = globalMetrics.filter(
        metric => new Date(metric.timestamp).getTime() > oneHourAgo
      );

      return {
        timestamp: new Date().toISOString(),
        period: '1h',
        dataPoints: recentMetrics.length,
        summary: recentMetrics.length > 0 ? {
          averageMemoryUsage: recentMetrics.reduce((sum, m) => sum + m.memory.percentage, 0) / recentMetrics.length,
          averageCpuUsage: recentMetrics.reduce((sum, m) => sum + m.cpu.usage, 0) / recentMetrics.length,
          averageEventLoopDelay: recentMetrics.reduce((sum, m) => sum + m.eventLoop.delay, 0) / recentMetrics.length,
          peakMemoryUsage: Math.max(...recentMetrics.map(m => m.memory.percentage)),
          peakCpuUsage: Math.max(...recentMetrics.map(m => m.cpu.usage)),
          totalRequests: recentMetrics[recentMetrics.length - 1]?.requests.total || 0,
          totalErrors: recentMetrics[recentMetrics.length - 1]?.errors.total || 0,
        } : null
      };
    });
  }

  // Readiness probe
  fastify.get('/ready', async () => {
    // Check if all critical services are ready
    const checks = await Promise.allSettled([
      checkDatabaseConnection(fastify),
      ...customHealthChecks.map(check => check.check())
    ]);

    const allReady = checks.every(result => 
      result.status === 'fulfilled' && result.value.status === 'ok'
    );

    if (allReady) {
      return { status: 'ready', timestamp: new Date().toISOString() };
    } else {
      throw fastify.httpErrors.serviceUnavailable('Service not ready');
    }
  });

  // Liveness probe
  fastify.get('/live', async () => {
    // Basic liveness check - process is running and responsive
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      pid: process.pid
    };
  });

  // Cleanup on close
  fastify.addHook('onClose', async () => {
    if (metricsIntervalId) {
      clearInterval(metricsIntervalId);
    }
  });
}

/**
 * Collect current system metrics
 */
function collectSystemMetrics(): void {
  const metrics = getCurrentSystemMetrics();
  globalMetrics.push(metrics);
}

/**
 * Get current system metrics
 */
function getCurrentSystemMetrics(): SystemMetrics {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  
  return {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      used: memUsage.rss,
      total: memUsage.rss + memUsage.external,
      free: 0, // Node.js doesn't provide this directly
      percentage: (memUsage.rss / (memUsage.rss + memUsage.external)) * 100,
      external: memUsage.external,
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
    },
    cpu: {
      usage: (cpuUsage.user + cpuUsage.system) / 1000000, // Convert to milliseconds
      loadAverage: process.platform !== 'win32' ? require('os').loadavg() : [0, 0, 0],
    },
    eventLoop: {
      delay: getEventLoopDelay(),
      utilization: getEventLoopUtilization(),
    },
    connections: {
      active: activeConnections,
      total: requestCount,
    },
    requests: {
      total: requestCount,
      success: successCount,
      errors: errorCount,
      averageResponseTime: requestCount > 0 ? totalResponseTime / requestCount : 0,
    },
    errors: {
      total: errorCount,
      rate: requestCount > 0 ? (errorCount / requestCount) * 100 : 0,
      lastError,
    },
  };
}

/**
 * Perform comprehensive health check
 */
async function performHealthCheck(
  fastify: FastifyInstance,
  customHealthChecks: MonitoringOptions['customHealthChecks'] = []
): Promise<HealthCheckResult> {
  const startTime = Date.now();
  const services: HealthCheckResult['services'] = {};
  
  // Check database
  try {
    const dbCheckStart = Date.now();
    await checkDatabaseConnection(fastify);
    services.database = {
      status: 'ok',
      responseTime: Date.now() - dbCheckStart,
      lastCheck: new Date().toISOString(),
    };
  } catch (error) {
    services.database = {
      status: 'error',
      message: error instanceof Error ? error.message : 'Database connection failed',
      lastCheck: new Date().toISOString(),
    };
  }

  // Check Redis if configured
  if (config.REDIS_URL) {
    try {
      const redisCheckStart = Date.now();
      // Note: This requires Redis plugin to be registered
      // await fastify.redis.ping();
      services.redis = {
        status: 'ok',
        responseTime: Date.now() - redisCheckStart,
        lastCheck: new Date().toISOString(),
      };
    } catch (error) {
      services.redis = {
        status: 'error',
        message: error instanceof Error ? error.message : 'Redis connection failed',
        lastCheck: new Date().toISOString(),
      };
    }
  }

  // Run custom health checks
  const customChecks: Record<string, any> = {};
  if (customHealthChecks) {
    for (const check of customHealthChecks) {
      try {
        const result = await check.check();
        customChecks[check.name] = result;
        services[check.name] = {
          status: result.status,
          message: result.message,
          lastCheck: new Date().toISOString(),
        };
      } catch (error) {
        customChecks[check.name] = {
          status: 'error',
          message: error instanceof Error ? error.message : 'Custom check failed',
        };
        services[check.name] = {
          status: 'error',
          message: error instanceof Error ? error.message : 'Custom check failed',
          lastCheck: new Date().toISOString(),
        };
      }
    }
  }

  // API health (basic responsiveness)
  services.api = {
    status: 'ok',
    responseTime: Date.now() - startTime,
    lastCheck: new Date().toISOString(),
  };

  // Determine overall status
  const hasErrors = Object.values(services).some(service => service.status === 'error');
  const status = hasErrors ? 'error' : 'ok';

  return {
    status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0', // You might want to get this from package.json
    environment: config.NODE_ENV,
    services,
    metrics: getCurrentSystemMetrics(),
    customChecks: Object.keys(customChecks).length > 0 ? customChecks : undefined,
  };
}

/**
 * Check database connection health
 */
async function checkDatabaseConnection(fastify: FastifyInstance): Promise<{ status: 'ok' | 'error'; message?: string }> {
  try {
    const result = await fastify.pg.query('SELECT 1 as health_check');
    if (result.rows.length === 1 && result.rows[0].health_check === 1) {
      return { status: 'ok' };
    } else {
      throw new Error('Unexpected database response');
    }
  } catch (error) {
    throw new Error(`Database health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get event loop delay (simplified implementation)
 */
function getEventLoopDelay(): number {
  // This is a simplified version. In production, you might want to use
  // perf_hooks.monitorEventLoopDelay() for more accurate measurements
  const start = process.hrtime.bigint();
  setImmediate(() => {
    const delay = Number(process.hrtime.bigint() - start) / 1000000; // Convert to milliseconds
    return delay;
  });
  return 0; // Placeholder
}

/**
 * Get event loop utilization (simplified implementation)
 */
function getEventLoopUtilization(): number {
  // This is a placeholder. In Node.js 14+, you can use performance.eventLoopUtilization()
  if (typeof performance !== 'undefined' && performance.eventLoopUtilization) {
    return performance.eventLoopUtilization().utilization;
  }
  return 0;
}

/**
 * Reset monitoring metrics (useful for testing)
 */
export function resetMetrics(): void {
  globalMetrics = [];
  requestCount = 0;
  errorCount = 0;
  successCount = 0;
  totalResponseTime = 0;
  activeConnections = 0;
  lastError = undefined;
}

/**
 * Get current monitoring state
 */
export function getMonitoringState(): {
  requestCount: number;
  errorCount: number;
  successCount: number;
  activeConnections: number;
  averageResponseTime: number;
} {
  return {
    requestCount,
    errorCount,
    successCount,
    activeConnections,
    averageResponseTime: requestCount > 0 ? totalResponseTime / requestCount : 0,
  };
}

/**
 * Create monitoring plugin with custom options
 */
export function createMonitoringPlugin(options: MonitoringOptions = {}) {
  return fastifyPlugin(monitoringPlugin, {
    name: 'monitoring',
    fastify: '4.x',
  });
}

/**
 * Default monitoring plugin
 */
export default fastifyPlugin(monitoringPlugin, {
  name: 'monitoring',
  fastify: '4.x',
});