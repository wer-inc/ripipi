/**
 * Idempotency Type Definitions
 * Comprehensive types for idempotency management system
 */

/**
 * Idempotency key status states
 */
export enum IdempotencyStatus {
  PENDING = 'pending',           // Key created, request in progress
  PROCESSING = 'processing',     // Currently being processed
  COMPLETED = 'completed',       // Successfully completed
  FAILED = 'failed',            // Processing failed
  EXPIRED = 'expired',          // Key expired
  CANCELLED = 'cancelled'       // Request was cancelled
}

/**
 * Idempotency conflict types
 */
export enum IdempotencyConflictType {
  DUPLICATE_KEY = 'DUPLICATE_KEY',              // Same key, different fingerprint
  CONCURRENT_PROCESSING = 'CONCURRENT_PROCESSING', // Same key being processed
  KEY_EXPIRED = 'KEY_EXPIRED',                  // Key has expired
  INVALID_STATE = 'INVALID_STATE',              // Key in invalid state
  FINGERPRINT_MISMATCH = 'FINGERPRINT_MISMATCH' // Request fingerprint doesn't match
}

/**
 * Request metadata for fingerprinting
 */
export interface IdempotencyRequestMetadata {
  method: string;
  url: string;
  contentType?: string;
  userAgent?: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  clientId?: string;
  body?: any;
  headers?: Record<string, string>;
}

/**
 * Response metadata for caching
 */
export interface IdempotencyResponseMetadata {
  statusCode: number;
  headers: Record<string, any>;
  body: any;
  contentLength: number;
  contentType?: string;
  cacheControlHeaders?: Record<string, string>;
}

/**
 * Idempotency record in database
 */
export interface IdempotencyRecord {
  id: string;
  idempotencyKey: string;
  requestFingerprint: string;
  status: IdempotencyStatus;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  
  // Request metadata
  requestMetadata: IdempotencyRequestMetadata;
  
  // Response data (when completed)
  responseMetadata?: IdempotencyResponseMetadata;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  completedAt?: Date;
  
  // Processing metadata
  processingStartedAt?: Date;
  processingCompletedAt?: Date;
  processingDurationMs?: number;
  
  // Error information
  errorMessage?: string;
  errorCode?: string;
  errorDetails?: any;
  
  // Retry information
  retryCount: number;
  maxRetries: number;
  
  // Distributed transaction support
  transactionId?: string;
  sagaId?: string;
  compensationRequired?: boolean;
  
  // Metrics
  lockAcquisitionTimeMs?: number;
  databaseTimeMs?: number;
  totalProcessingTimeMs?: number;
}

/**
 * Idempotency key creation request
 */
export interface CreateIdempotencyKeyRequest {
  key: string;
  requestMetadata: IdempotencyRequestMetadata;
  expirationMinutes?: number;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  maxRetries?: number;
  transactionId?: string;
  sagaId?: string;
}

/**
 * Idempotency key update request
 */
export interface UpdateIdempotencyKeyRequest {
  key: string;
  status: IdempotencyStatus;
  responseMetadata?: IdempotencyResponseMetadata;
  errorMessage?: string;
  errorCode?: string;
  errorDetails?: any;
  processingDurationMs?: number;
  lockAcquisitionTimeMs?: number;
  databaseTimeMs?: number;
  compensationRequired?: boolean;
}

/**
 * Idempotency check result
 */
export interface IdempotencyCheckResult {
  exists: boolean;
  record?: IdempotencyRecord;
  conflict?: {
    type: IdempotencyConflictType;
    message: string;
    details?: any;
  };
  shouldProceed: boolean;
  shouldWait: boolean;
  waitTimeMs?: number;
  cachedResponse?: IdempotencyResponseMetadata;
}

/**
 * Idempotency service configuration
 */
export interface IdempotencyServiceConfig {
  // Key retention
  defaultTtlHours: number;
  maxTtlHours: number;
  minTtlMinutes: number;
  
  // Concurrency control
  maxConcurrentRequests: number;
  waitTimeoutMs: number;
  pollingIntervalMs: number;
  maxWaitRetries: number;
  
  // Response caching
  maxResponseSizeBytes: number;
  enableResponseCompression: boolean;
  compressResponsesLargerThan: number;
  
  // Cleanup
  cleanupEnabled: boolean;
  cleanupIntervalMinutes: number;
  batchSize: number;
  
  // Distributed storage
  useRedis: boolean;
  usePostgreSQL: boolean;
  preferredStorage: 'redis' | 'postgresql' | 'both';
  
  // Performance
  enableMetrics: boolean;
  enableDetailedLogging: boolean;
  slowOperationThresholdMs: number;
  
  // Security
  validateFingerprints: boolean;
  requireSecureKeys: boolean;
  keyValidationPattern?: RegExp;
  
  // Retry policy
  enableRetries: boolean;
  defaultMaxRetries: number;
  retryBackoffMs: number;
  retryMultiplier: number;
}

/**
 * Idempotency middleware options
 */
export interface IdempotencyMiddlewareOptions {
  headerName: string;
  requiredForPaths?: string[];
  excludedPaths?: string[];
  allowedMethods: string[];
  
  // Key validation
  enforceKeyFormat: boolean;
  allowCustomKeyFormat: boolean;
  keyMinLength: number;
  keyMaxLength: number;
  
  // Fingerprinting
  enableFingerprinting: boolean;
  fingerprintFields: string[];
  ignoreHeaders?: string[];
  includeBodyInFingerprint: boolean;
  
  // Error handling
  returnDetailedErrors: boolean;
  logConflicts: boolean;
  notifyOnViolations: boolean;
  
  // Performance
  maxConcurrentChecks: number;
  timeoutMs: number;
  
  // Integration
  onKeyCreated?: (record: IdempotencyRecord) => Promise<void>;
  onKeyReused?: (record: IdempotencyRecord) => Promise<void>;
  onConflictDetected?: (conflict: any) => Promise<void>;
  onKeyExpired?: (key: string) => Promise<void>;
}

/**
 * Idempotency statistics
 */
export interface IdempotencyStatistics {
  totalKeys: number;
  activeKeys: number;
  expiredKeys: number;
  completedKeys: number;
  failedKeys: number;
  
  // Success rates
  successRate: number;
  conflictRate: number;
  expirationRate: number;
  
  // Performance metrics
  averageProcessingTimeMs: number;
  averageLockAcquisitionTimeMs: number;
  averageDatabaseTimeMs: number;
  
  // Storage metrics
  totalStorageBytes: number;
  averageResponseSize: number;
  compressionRatio?: number;
  
  // By tenant/user
  byTenant?: Record<string, Omit<IdempotencyStatistics, 'byTenant' | 'byUser'>>;
  byUser?: Record<string, Omit<IdempotencyStatistics, 'byTenant' | 'byUser'>>;
  
  // Time-based metrics
  requestsPerHour: number;
  peakConcurrency: number;
  
  // Error breakdown
  errorsByType: Record<string, number>;
  conflictsByType: Record<IdempotencyConflictType, number>;
  
  // Collection metadata
  collectedAt: Date;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Idempotency error types
 */
export class IdempotencyError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'IDEMPOTENCY_ERROR',
    public readonly details?: any
  ) {
    super(message);
    this.name = 'IdempotencyError';
  }
}

export class IdempotencyKeyConflictError extends IdempotencyError {
  constructor(
    key: string,
    conflictType: IdempotencyConflictType,
    details?: any
  ) {
    super(`Idempotency key conflict: ${key}`, 'IDEMPOTENCY_KEY_CONFLICT', {
      key,
      conflictType,
      ...details
    });
    this.name = 'IdempotencyKeyConflictError';
  }
}

export class IdempotencyTimeoutError extends IdempotencyError {
  constructor(key: string, timeoutMs: number) {
    super(`Idempotency operation timeout: ${key}`, 'IDEMPOTENCY_TIMEOUT', {
      key,
      timeoutMs
    });
    this.name = 'IdempotencyTimeoutError';
  }
}

export class IdempotencyStorageError extends IdempotencyError {
  constructor(operation: string, cause?: Error) {
    super(`Idempotency storage error: ${operation}`, 'IDEMPOTENCY_STORAGE_ERROR', {
      operation,
      cause: cause?.message
    });
    this.name = 'IdempotencyStorageError';
  }
}

/**
 * Idempotency distributed transaction types
 */
export enum DistributedTransactionStatus {
  INITIATED = 'initiated',
  PREPARING = 'preparing',
  PREPARED = 'prepared',
  COMMITTING = 'committing',
  COMMITTED = 'committed',
  ABORTING = 'aborting',
  ABORTED = 'aborted',
  COMPENSATING = 'compensating',
  COMPENSATED = 'compensated',
  FAILED = 'failed'
}

export interface DistributedTransactionContext {
  transactionId: string;
  sagaId?: string;
  participantId: string;
  status: DistributedTransactionStatus;
  
  // Idempotency keys involved
  idempotencyKeys: string[];
  
  // Compensation data
  compensationData?: any;
  compensationScript?: string;
  
  // Timing
  createdAt: Date;
  lastUpdatedAt: Date;
  expiresAt: Date;
  
  // Metadata
  metadata?: Record<string, any>;
}

export interface DistributedTransactionParticipant {
  participantId: string;
  service: string;
  operation: string;
  idempotencyKey: string;
  status: DistributedTransactionStatus;
  
  // Prepare/commit/abort operations
  prepareData?: any;
  commitData?: any;
  abortReason?: string;
  
  // Compensation
  compensationRequired: boolean;
  compensationData?: any;
  compensationCompleted?: boolean;
  
  // Timing
  preparedAt?: Date;
  committedAt?: Date;
  abortedAt?: Date;
  compensatedAt?: Date;
}

/**
 * Event types for idempotency system
 */
export enum IdempotencyEventType {
  KEY_CREATED = 'KEY_CREATED',
  KEY_UPDATED = 'KEY_UPDATED',
  KEY_EXPIRED = 'KEY_EXPIRED',
  KEY_REUSED = 'KEY_REUSED',
  CONFLICT_DETECTED = 'CONFLICT_DETECTED',
  PROCESSING_STARTED = 'PROCESSING_STARTED',
  PROCESSING_COMPLETED = 'PROCESSING_COMPLETED',
  PROCESSING_FAILED = 'PROCESSING_FAILED',
  CLEANUP_PERFORMED = 'CLEANUP_PERFORMED',
  STATISTICS_COLLECTED = 'STATISTICS_COLLECTED'
}

export interface IdempotencyEvent {
  eventType: IdempotencyEventType;
  idempotencyKey: string;
  tenantId?: string;
  userId?: string;
  timestamp: Date;
  metadata?: Record<string, any>;
  
  // Related records
  record?: IdempotencyRecord;
  conflict?: any;
  statistics?: Partial<IdempotencyStatistics>;
}

/**
 * Export all types
 */
export type {
  IdempotencyRequestMetadata,
  IdempotencyResponseMetadata,
  IdempotencyRecord,
  CreateIdempotencyKeyRequest,
  UpdateIdempotencyKeyRequest,
  IdempotencyCheckResult,
  IdempotencyServiceConfig,
  IdempotencyMiddlewareOptions,
  IdempotencyStatistics,
  DistributedTransactionContext,
  DistributedTransactionParticipant,
  IdempotencyEvent
};