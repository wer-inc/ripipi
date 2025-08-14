import { FastifyRequest, FastifyReply, RouteHandlerMethod } from 'fastify';
import { TimeoutError, InternalServerError, BaseError } from './errors';
import { logger } from '../config/logger';

/**
 * Options for async handler wrapper
 */
interface AsyncHandlerOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  retryOn?: (error: Error) => boolean;
  correlationId?: string;
}

/**
 * Result of retry operation
 */
interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
}

/**
 * Wraps an async route handler to provide automatic error handling
 * and timeout functionality
 */
export function asyncHandler<TRequest = any, TReply = any>(
  handler: (request: FastifyRequest<TRequest>, reply: FastifyReply) => Promise<TReply>,
  options?: AsyncHandlerOptions
): RouteHandlerMethod {
  return async (request: FastifyRequest<TRequest>, reply: FastifyReply): Promise<void> => {
    const correlationId = options?.correlationId || 
      request.headers['x-correlation-id'] as string ||
      generateCorrelationId();

    try {
      let result: TReply;

      if (options?.timeout) {
        result = await withTimeout(
          handler(request, reply),
          options.timeout,
          correlationId
        );
      } else {
        result = await handler(request, reply);
      }

      // Only send response if reply hasn't been sent yet
      if (!reply.sent) {
        reply.send(result);
      }
    } catch (error) {
      // Log error with correlation ID
      logger.error({
        err: error,
        correlationId,
        request: {
          method: request.method,
          url: request.url,
          params: request.params,
          query: request.query,
        },
      }, 'Async handler error');

      // Handle error through Fastify's error handler
      if (!reply.sent) {
        throw error;
      }
    }
  };
}

/**
 * Wraps a promise with timeout functionality
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  correlationId?: string,
  operation?: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new TimeoutError(
        `Operation timed out after ${timeoutMs}ms`,
        timeoutMs,
        operation,
        correlationId
      ));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

/**
 * Retry function with exponential backoff
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffFactor?: number;
    retryOn?: (error: Error) => boolean;
    correlationId?: string;
    operationName?: string;
  } = {}
): Promise<RetryResult<T>> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffFactor = 2,
    retryOn = (error) => !(error instanceof BaseError && error.isOperational),
    correlationId,
    operationName = 'unknown'
  } = options;

  let lastError: Error;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const result = await operation();
      
      if (attempt > 1) {
        logger.info({
          correlationId,
          operationName,
          attempt,
          totalAttempts: maxRetries + 1,
        }, 'Operation succeeded after retry');
      }
      
      return {
        success: true,
        result,
        attempts: attempt,
      };
    } catch (error) {
      lastError = error as Error;
      
      logger.warn({
        err: error,
        correlationId,
        operationName,
        attempt,
        maxRetries: maxRetries + 1,
        nextRetryIn: delay,
      }, 'Operation failed, will retry');

      // Don't retry if this is the last attempt
      if (attempt > maxRetries) {
        break;
      }

      // Don't retry if the error is not retryable
      if (!retryOn(lastError)) {
        logger.info({
          err: error,
          correlationId,
          operationName,
        }, 'Error is not retryable, stopping retry attempts');
        break;
      }

      // Wait before retrying
      await sleep(delay);
      
      // Exponential backoff with max delay cap
      delay = Math.min(delay * backoffFactor, maxDelay);
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: maxRetries + 1,
  };
}

/**
 * Circuit breaker implementation for external service calls
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime: number | null = null;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  constructor(
    private readonly options: {
      failureThreshold?: number;
      recoveryTimeout?: number;
      monitoringPeriod?: number;
      correlationId?: string;
      name?: string;
    } = {}
  ) {
    this.options = {
      failureThreshold: 5,
      recoveryTimeout: 60000, // 1 minute
      monitoringPeriod: 10000,  // 10 seconds
      ...options,
    };
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (this.shouldAttemptReset()) {
        this.state = 'HALF_OPEN';
        logger.info({
          correlationId: this.options.correlationId,
          circuitBreakerName: this.options.name,
          state: this.state,
        }, 'Circuit breaker attempting reset');
      } else {
        throw new InternalServerError(
          'Circuit breaker is OPEN - service temporarily unavailable',
          this.options.correlationId
        );
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) return true;
    return Date.now() - this.lastFailureTime >= (this.options.recoveryTimeout || 60000);
  }

  private onSuccess(): void {
    this.failures = 0;
    this.lastFailureTime = null;
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      logger.info({
        correlationId: this.options.correlationId,
        circuitBreakerName: this.options.name,
        state: this.state,
      }, 'Circuit breaker reset to CLOSED state');
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= (this.options.failureThreshold || 5)) {
      this.state = 'OPEN';
      logger.warn({
        correlationId: this.options.correlationId,
        circuitBreakerName: this.options.name,
        state: this.state,
        failures: this.failures,
        threshold: this.options.failureThreshold,
      }, 'Circuit breaker opened due to failures');
    }
  }

  getState(): { state: string; failures: number; lastFailureTime: number | null } {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime,
    };
  }
}

/**
 * Promise-based sleep function
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generates a unique correlation ID for request tracking
 */
export function generateCorrelationId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Wraps multiple async operations to execute in parallel with error handling
 */
export async function parallelWithErrorHandling<T>(
  operations: Array<() => Promise<T>>,
  options: {
    maxConcurrency?: number;
    failFast?: boolean;
    correlationId?: string;
  } = {}
): Promise<Array<{ success: boolean; result?: T; error?: Error; index: number }>> {
  const { maxConcurrency = operations.length, failFast = false, correlationId } = options;
  
  const results: Array<{ success: boolean; result?: T; error?: Error; index: number }> = [];
  const semaphore = new Semaphore(maxConcurrency);

  const executeOperation = async (operation: () => Promise<T>, index: number) => {
    await semaphore.acquire();
    
    try {
      const result = await operation();
      const successResult = { success: true, result, index };
      results[index] = successResult;
      return successResult;
    } catch (error) {
      const errorResult = { success: false, error: error as Error, index };
      results[index] = errorResult;
      
      if (failFast) {
        throw error;
      }
      
      return errorResult;
    } finally {
      semaphore.release();
    }
  };

  try {
    await Promise.all(
      operations.map((operation, index) => executeOperation(operation, index))
    );
  } catch (error) {
    if (failFast) {
      logger.error({
        err: error,
        correlationId,
        completedOperations: results.filter(r => r).length,
        totalOperations: operations.length,
      }, 'Parallel operations failed fast');
    }
  }

  return results;
}

/**
 * Simple semaphore implementation for controlling concurrency
 */
class Semaphore {
  private tokens: number;
  private waitingResolvers: Array<() => void> = [];

  constructor(private maxTokens: number) {
    this.tokens = maxTokens;
  }

  async acquire(): Promise<void> {
    if (this.tokens > 0) {
      this.tokens--;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.waitingResolvers.push(resolve);
    });
  }

  release(): void {
    this.tokens++;
    
    if (this.waitingResolvers.length > 0) {
      const resolve = this.waitingResolvers.shift();
      if (resolve) {
        this.tokens--;
        resolve();
      }
    }
  }
}

/**
 * Graceful degradation helper for non-critical operations
 */
export async function gracefulDegradation<T>(
  primaryOperation: () => Promise<T>,
  fallbackOperation: () => Promise<T> | T,
  options: {
    timeout?: number;
    retries?: number;
    correlationId?: string;
    operationName?: string;
  } = {}
): Promise<T> {
  const { timeout, retries = 1, correlationId, operationName = 'graceful-degradation' } = options;

  try {
    let operation = primaryOperation;
    
    if (timeout) {
      operation = () => withTimeout(primaryOperation(), timeout, correlationId, operationName);
    }

    if (retries > 1) {
      const retryResult = await retryWithBackoff(operation, {
        maxRetries: retries - 1,
        correlationId,
        operationName,
      });
      
      if (retryResult.success && retryResult.result !== undefined) {
        return retryResult.result;
      } else {
        throw retryResult.error || new Error('Unknown retry failure');
      }
    } else {
      return await operation();
    }
  } catch (error) {
    logger.warn({
      err: error,
      correlationId,
      operationName,
    }, 'Primary operation failed, using fallback');

    const fallbackResult = await fallbackOperation();
    return fallbackResult;
  }
}

/**
 * Utility for batch processing with error handling
 */
export async function batchProcess<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  options: {
    batchSize?: number;
    concurrency?: number;
    continueOnError?: boolean;
    correlationId?: string;
  } = {}
): Promise<Array<{ success: boolean; result?: R; error?: Error; item: T; index: number }>> {
  const {
    batchSize = 10,
    concurrency = 3,
    continueOnError = true,
    correlationId
  } = options;

  const results: Array<{ success: boolean; result?: R; error?: Error; item: T; index: number }> = [];
  
  // Process items in batches
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchOperations = batch.map((item, batchIndex) => {
      const globalIndex = i + batchIndex;
      return async () => {
        try {
          const result = await processor(item, globalIndex);
          return { success: true, result, item, index: globalIndex };
        } catch (error) {
          return { success: false, error: error as Error, item, index: globalIndex };
        }
      };
    });

    const batchResults = await parallelWithErrorHandling(batchOperations, {
      maxConcurrency: concurrency,
      failFast: !continueOnError,
      correlationId,
    });

    results.push(...batchResults.map(r => ({
      success: r.success,
      result: r.result?.result,
      error: r.error || r.result?.error,
      item: r.result?.item || batch[r.index - i],
      index: r.result?.index || r.index,
    })));
  }

  return results;
}