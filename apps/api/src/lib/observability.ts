import { FastifyRequest, FastifyReply } from 'fastify';
import { performance } from 'perf_hooks';
import crypto from 'crypto';

// メトリクス収集
interface Metrics {
  requestCount: number;
  errorCount: number;
  responseTime: number[];
  statusCodes: Map<number, number>;
}

class MetricsCollector {
  private metrics: Map<string, Metrics> = new Map();

  recordRequest(endpoint: string, statusCode: number, responseTime: number) {
    if (!this.metrics.has(endpoint)) {
      this.metrics.set(endpoint, {
        requestCount: 0,
        errorCount: 0,
        responseTime: [],
        statusCodes: new Map()
      });
    }

    const metric = this.metrics.get(endpoint)!;
    metric.requestCount++;
    metric.responseTime.push(responseTime);
    
    if (statusCode >= 400) {
      metric.errorCount++;
    }
    
    metric.statusCodes.set(
      statusCode,
      (metric.statusCodes.get(statusCode) || 0) + 1
    );
  }

  getMetrics() {
    const result: any = {};
    
    for (const [endpoint, metric] of this.metrics.entries()) {
      const p95 = this.calculatePercentile(metric.responseTime, 0.95);
      const p99 = this.calculatePercentile(metric.responseTime, 0.99);
      const avg = metric.responseTime.reduce((a, b) => a + b, 0) / metric.responseTime.length;
      
      result[endpoint] = {
        requestCount: metric.requestCount,
        errorCount: metric.errorCount,
        errorRate: metric.errorCount / metric.requestCount,
        responseTime: {
          avg: Math.round(avg),
          p95: Math.round(p95),
          p99: Math.round(p99)
        },
        statusCodes: Object.fromEntries(metric.statusCodes)
      };
    }
    
    return result;
  }

  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[index];
  }

  reset() {
    this.metrics.clear();
  }
}

// グローバルインスタンス
export const metricsCollector = new MetricsCollector();

// トレーシング用のコンテキスト
interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startTime: number;
  attributes: Record<string, any>;
}

// リクエストトレーシング
export function createTraceContext(parentTraceId?: string): TraceContext {
  return {
    traceId: parentTraceId || crypto.randomBytes(16).toString('hex'),
    spanId: crypto.randomBytes(8).toString('hex'),
    parentSpanId: undefined,
    startTime: performance.now(),
    attributes: {}
  };
}

// 構造化ログ
export interface StructuredLog {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  traceId?: string;
  spanId?: string;
  userId?: string;
  requestId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  responseTime?: number;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
  metadata?: Record<string, any>;
}

export function structuredLog(log: StructuredLog): void {
  console.log(JSON.stringify({
    ...log,
    timestamp: log.timestamp || new Date().toISOString(),
    service: 'reservation-api',
    environment: process.env.NODE_ENV || 'development'
  }));
}

// 可観測性ミドルウェア
export async function observabilityMiddleware(req: FastifyRequest, reply: FastifyReply) {
  // トレース情報の生成
  const traceId = (req.headers['x-trace-id'] as string) || crypto.randomBytes(16).toString('hex');
  const requestId = crypto.randomBytes(8).toString('hex');
  const startTime = performance.now();
  
  // リクエストコンテキストに追加
  (req as any).trace = {
    traceId,
    requestId,
    startTime
  };
  
  // レスポンスヘッダーに追加
  reply.header('X-Trace-Id', traceId);
  reply.header('X-Request-Id', requestId);
  
  // リクエストログ
  structuredLog({
    timestamp: new Date().toISOString(),
    level: 'info',
    message: 'Request received',
    traceId,
    requestId,
    userId: (req as any).auth?.sub,
    method: req.method,
    path: req.url,
    metadata: {
      headers: req.headers,
      query: req.query,
      ip: req.ip
    }
  });
  
  // レスポンス処理のフック
  reply.addHook('onSend', async (request, reply, payload) => {
    const endTime = performance.now();
    const responseTime = endTime - startTime;
    const endpoint = request.routeOptions?.url || 'unknown';
    
    // メトリクス記録
    metricsCollector.recordRequest(endpoint, reply.statusCode, responseTime);
    
    // レスポンスログ
    structuredLog({
      timestamp: new Date().toISOString(),
      level: reply.statusCode >= 400 ? 'error' : 'info',
      message: 'Request completed',
      traceId,
      requestId,
      userId: (request as any).auth?.sub,
      method: request.method,
      path: request.url,
      statusCode: reply.statusCode,
      responseTime: Math.round(responseTime),
      metadata: {
        endpoint,
        responseSize: payload ? JSON.stringify(payload).length : 0
      }
    });
    
    return payload;
  });
}

// エラーロギング
export function logError(error: Error, context: any = {}) {
  structuredLog({
    timestamp: new Date().toISOString(),
    level: 'error',
    message: error.message,
    traceId: context.traceId,
    requestId: context.requestId,
    error: {
      message: error.message,
      stack: error.stack,
      code: (error as any).code
    },
    metadata: context
  });
}

// メトリクスエンドポイント（Prometheus形式）
export function formatPrometheusMetrics(): string {
  const metrics = metricsCollector.getMetrics();
  let output = '';
  
  // ヘルプとタイプ定義
  output += '# HELP http_requests_total Total number of HTTP requests\n';
  output += '# TYPE http_requests_total counter\n';
  output += '# HELP http_request_duration_seconds HTTP request duration in seconds\n';
  output += '# TYPE http_request_duration_seconds summary\n';
  output += '# HELP http_errors_total Total number of HTTP errors\n';
  output += '# TYPE http_errors_total counter\n';
  
  for (const [endpoint, metric] of Object.entries(metrics)) {
    const sanitizedEndpoint = endpoint.replace(/[^a-zA-Z0-9_]/g, '_');
    
    // リクエスト数
    output += `http_requests_total{endpoint="${endpoint}"} ${(metric as any).requestCount}\n`;
    
    // エラー数
    output += `http_errors_total{endpoint="${endpoint}"} ${(metric as any).errorCount}\n`;
    
    // レスポンスタイム
    const responseTime = (metric as any).responseTime;
    output += `http_request_duration_seconds{endpoint="${endpoint}",quantile="0.5"} ${responseTime.avg / 1000}\n`;
    output += `http_request_duration_seconds{endpoint="${endpoint}",quantile="0.95"} ${responseTime.p95 / 1000}\n`;
    output += `http_request_duration_seconds{endpoint="${endpoint}",quantile="0.99"} ${responseTime.p99 / 1000}\n`;
  }
  
  return output;
}

// ヘルスチェック用の詳細ステータス
export async function getHealthStatus() {
  const metrics = metricsCollector.getMetrics();
  const totalRequests = Object.values(metrics).reduce((sum, m: any) => sum + m.requestCount, 0);
  const totalErrors = Object.values(metrics).reduce((sum, m: any) => sum + m.errorCount, 0);
  
  return {
    status: totalErrors / totalRequests > 0.05 ? 'degraded' : 'healthy',
    timestamp: new Date().toISOString(),
    metrics: {
      totalRequests,
      totalErrors,
      errorRate: totalRequests > 0 ? totalErrors / totalRequests : 0,
      endpoints: metrics
    },
    checks: {
      database: await checkDatabase(),
      memory: checkMemory(),
      cpu: checkCPU()
    }
  };
}

async function checkDatabase() {
  try {
    // DBヘルスチェック（実装は省略）
    return { status: 'healthy', latency: 5 };
  } catch (error) {
    return { status: 'unhealthy', error: (error as Error).message };
  }
}

function checkMemory() {
  const used = process.memoryUsage();
  const heapUsedPercent = (used.heapUsed / used.heapTotal) * 100;
  
  return {
    status: heapUsedPercent > 90 ? 'warning' : 'healthy',
    heapUsed: Math.round(used.heapUsed / 1024 / 1024),
    heapTotal: Math.round(used.heapTotal / 1024 / 1024),
    external: Math.round(used.external / 1024 / 1024),
    percentage: Math.round(heapUsedPercent)
  };
}

function checkCPU() {
  const cpuUsage = process.cpuUsage();
  return {
    status: 'healthy',
    user: Math.round(cpuUsage.user / 1000),
    system: Math.round(cpuUsage.system / 1000)
  };
}