import { Type, Static } from '@sinclair/typebox';

/**
 * Log levels for structured logging
 */
export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
  TRACE = 'trace'
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low'
}

/**
 * Error categories for classification
 */
export enum ErrorCategory {
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  VALIDATION = 'validation',
  BUSINESS_LOGIC = 'business_logic',
  DATABASE = 'database',
  EXTERNAL_SERVICE = 'external_service',
  NETWORK = 'network',
  TIMEOUT = 'timeout',
  RATE_LIMIT = 'rate_limit',
  SYSTEM = 'system',
  UNKNOWN = 'unknown'
}

/**
 * Request/Response log entry schema
 */
export const LogEntrySchema = Type.Object({
  timestamp: Type.String({ format: 'date-time' }),
  level: Type.Enum(LogLevel),
  message: Type.String(),
  correlationId: Type.Optional(Type.String()),
  module: Type.Optional(Type.String()),
  userId: Type.Optional(Type.String()),
  tenantId: Type.Optional(Type.String()),
  request: Type.Optional(Type.Object({
    method: Type.String(),
    url: Type.String(),
    headers: Type.Record(Type.String(), Type.String()),
    params: Type.Optional(Type.Record(Type.String(), Type.Any())),
    query: Type.Optional(Type.Record(Type.String(), Type.Any())),
    body: Type.Optional(Type.Any()),
    ip: Type.Optional(Type.String()),
    userAgent: Type.Optional(Type.String())
  })),
  response: Type.Optional(Type.Object({
    statusCode: Type.Number(),
    responseTime: Type.Number(),
    contentLength: Type.Optional(Type.Number()),
    body: Type.Optional(Type.Any())
  })),
  error: Type.Optional(Type.Object({
    name: Type.String(),
    message: Type.String(),
    code: Type.Optional(Type.String()),
    stack: Type.Optional(Type.String()),
    category: Type.Optional(Type.Enum(ErrorCategory)),
    severity: Type.Optional(Type.Enum(ErrorSeverity))
  })),
  context: Type.Optional(Type.Record(Type.String(), Type.Any()))
});

export type LogEntry = Static<typeof LogEntrySchema>;

/**
 * Error metrics schema
 */
export const ErrorMetricsSchema = Type.Object({
  timestamp: Type.String({ format: 'date-time' }),
  period: Type.String(), // e.g., '1h', '24h'
  totalErrors: Type.Number(),
  errorsByCode: Type.Record(Type.String(), Type.Number()),
  errorsByCategory: Type.Record(Type.String(), Type.Number()),
  errorsBySeverity: Type.Record(Type.String(), Type.Number()),
  errorRate: Type.Number(), // errors per request
  topErrors: Type.Array(Type.Object({
    code: Type.String(),
    message: Type.String(),
    count: Type.Number(),
    lastOccurred: Type.String({ format: 'date-time' })
  }))
});

export type ErrorMetrics = Static<typeof ErrorMetricsSchema>;

/**
 * Performance metrics schema
 */
export const PerformanceMetricsSchema = Type.Object({
  timestamp: Type.String({ format: 'date-time' }),
  period: Type.String(),
  requests: Type.Object({
    total: Type.Number(),
    successful: Type.Number(),
    failed: Type.Number(),
    averageResponseTime: Type.Number(),
    percentiles: Type.Object({
      p50: Type.Number(),
      p95: Type.Number(),
      p99: Type.Number()
    })
  }),
  throughput: Type.Object({
    requestsPerSecond: Type.Number(),
    peakRps: Type.Number(),
    avgRps: Type.Number()
  }),
  endpoints: Type.Array(Type.Object({
    path: Type.String(),
    method: Type.String(),
    requestCount: Type.Number(),
    averageResponseTime: Type.Number(),
    errorRate: Type.Number()
  }))
});

export type PerformanceMetrics = Static<typeof PerformanceMetricsSchema>;

/**
 * System health schema
 */
export const SystemHealthSchema = Type.Object({
  timestamp: Type.String({ format: 'date-time' }),
  status: Type.Union([
    Type.Literal('healthy'),
    Type.Literal('degraded'),
    Type.Literal('unhealthy')
  ]),
  uptime: Type.Number(),
  version: Type.String(),
  environment: Type.String(),
  services: Type.Record(Type.String(), Type.Object({
    status: Type.Union([
      Type.Literal('ok'),
      Type.Literal('warning'),
      Type.Literal('error')
    ]),
    message: Type.Optional(Type.String()),
    responseTime: Type.Optional(Type.Number()),
    lastCheck: Type.String({ format: 'date-time' })
  })),
  resources: Type.Object({
    memory: Type.Object({
      used: Type.Number(),
      total: Type.Number(),
      percentage: Type.Number()
    }),
    cpu: Type.Object({
      usage: Type.Number(),
      loadAverage: Type.Array(Type.Number())
    }),
    disk: Type.Optional(Type.Object({
      used: Type.Number(),
      total: Type.Number(),
      percentage: Type.Number()
    })),
    connections: Type.Object({
      active: Type.Number(),
      total: Type.Number(),
      poolSize: Type.Optional(Type.Number())
    })
  })
});

export type SystemHealth = Static<typeof SystemHealthSchema>;

/**
 * Alert severity levels
 */
export enum AlertSeverity {
  CRITICAL = 'critical',
  WARNING = 'warning',
  INFO = 'info'
}

/**
 * Alert types
 */
export enum AlertType {
  ERROR_RATE_HIGH = 'error_rate_high',
  RESPONSE_TIME_HIGH = 'response_time_high',
  MEMORY_USAGE_HIGH = 'memory_usage_high',
  CPU_USAGE_HIGH = 'cpu_usage_high',
  DATABASE_SLOW = 'database_slow',
  SERVICE_DOWN = 'service_down',
  DISK_SPACE_LOW = 'disk_space_low',
  CONNECTION_LIMIT = 'connection_limit'
}

/**
 * Alert schema
 */
export const AlertSchema = Type.Object({
  id: Type.String(),
  type: Type.Enum(AlertType),
  severity: Type.Enum(AlertSeverity),
  title: Type.String(),
  message: Type.String(),
  timestamp: Type.String({ format: 'date-time' }),
  resolvedAt: Type.Optional(Type.String({ format: 'date-time' })),
  correlationId: Type.Optional(Type.String()),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Any())),
  thresholds: Type.Optional(Type.Object({
    warning: Type.Optional(Type.Number()),
    critical: Type.Optional(Type.Number())
  })),
  actualValue: Type.Optional(Type.Number()),
  tags: Type.Optional(Type.Array(Type.String()))
});

export type Alert = Static<typeof AlertSchema>;

/**
 * Monitoring configuration schema
 */
export const MonitoringConfigSchema = Type.Object({
  logging: Type.Object({
    level: Type.Enum(LogLevel),
    structured: Type.Boolean(),
    includeStackTrace: Type.Boolean(),
    maskSensitiveFields: Type.Boolean(),
    sensitiveFields: Type.Array(Type.String())
  }),
  metrics: Type.Object({
    enabled: Type.Boolean(),
    collectionInterval: Type.Number(), // seconds
    retentionPeriod: Type.Number(), // hours
    detailedMetrics: Type.Boolean()
  }),
  alerts: Type.Object({
    enabled: Type.Boolean(),
    thresholds: Type.Object({
      errorRate: Type.Number(), // percentage
      responseTime: Type.Number(), // milliseconds
      memoryUsage: Type.Number(), // percentage
      cpuUsage: Type.Number(), // percentage
      diskUsage: Type.Number() // percentage
    }),
    notifications: Type.Object({
      email: Type.Optional(Type.Array(Type.String())),
      webhook: Type.Optional(Type.String()),
      slack: Type.Optional(Type.String())
    })
  }),
  healthChecks: Type.Object({
    enabled: Type.Boolean(),
    interval: Type.Number(), // seconds
    timeout: Type.Number(), // seconds
    retries: Type.Number()
  })
});

export type MonitoringConfig = Static<typeof MonitoringConfigSchema>;

/**
 * Audit log event types
 */
export enum AuditEventType {
  USER_LOGIN = 'user_login',
  USER_LOGOUT = 'user_logout',
  USER_CREATE = 'user_create',
  USER_UPDATE = 'user_update',
  USER_DELETE = 'user_delete',
  PERMISSION_CHANGE = 'permission_change',
  DATA_ACCESS = 'data_access',
  DATA_MODIFY = 'data_modify',
  DATA_DELETE = 'data_delete',
  SYSTEM_CONFIG = 'system_config',
  SECURITY_EVENT = 'security_event',
  API_ACCESS = 'api_access'
}

/**
 * Audit log entry schema
 */
export const AuditLogSchema = Type.Object({
  id: Type.String(),
  timestamp: Type.String({ format: 'date-time' }),
  event: Type.Enum(AuditEventType),
  userId: Type.Optional(Type.String()),
  tenantId: Type.Optional(Type.String()),
  sessionId: Type.Optional(Type.String()),
  correlationId: Type.Optional(Type.String()),
  resource: Type.Optional(Type.String()),
  resourceId: Type.Optional(Type.String()),
  action: Type.String(),
  outcome: Type.Union([
    Type.Literal('success'),
    Type.Literal('failure'),
    Type.Literal('partial')
  ]),
  details: Type.Optional(Type.Record(Type.String(), Type.Any())),
  oldValues: Type.Optional(Type.Record(Type.String(), Type.Any())),
  newValues: Type.Optional(Type.Record(Type.String(), Type.Any())),
  clientInfo: Type.Optional(Type.Object({
    ip: Type.String(),
    userAgent: Type.String(),
    location: Type.Optional(Type.String())
  })),
  risk: Type.Optional(Type.Union([
    Type.Literal('low'),
    Type.Literal('medium'),
    Type.Literal('high'),
    Type.Literal('critical')
  ]))
});

export type AuditLog = Static<typeof AuditLogSchema>;

/**
 * Request tracing context
 */
export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  correlationId: string;
  userId?: string;
  tenantId?: string;
  operation: string;
  startTime: bigint;
  metadata?: Record<string, any>;
}

/**
 * Performance tracking interface
 */
export interface PerformanceTracker {
  startTimer(operation: string): void;
  endTimer(operation: string): number;
  recordMetric(name: string, value: number, tags?: Record<string, string>): void;
  increment(counter: string, tags?: Record<string, string>): void;
  histogram(name: string, value: number, tags?: Record<string, string>): void;
}

/**
 * Circuit breaker state
 */
export enum CircuitBreakerState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open'
}

/**
 * Circuit breaker metrics
 */
export interface CircuitBreakerMetrics {
  name: string;
  state: CircuitBreakerState;
  failures: number;
  successes: number;
  lastFailureTime?: Date;
  nextAttemptTime?: Date;
  requestCount: number;
  errorRate: number;
}