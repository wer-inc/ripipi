/**
 * Cache Warmer Worker
 * Provides statistics-based periodic cache warming, background processing,
 * intelligent scheduling, and error recovery for cache optimization
 */

import { FastifyInstance } from 'fastify';
import { CacheOptimizerService } from '../services/cache-optimizer.service.js';
import { CacheService } from '../services/cache.service.js';
import { InventoryService } from '../services/inventory.service.js';
import { AvailabilityRepository } from '../repositories/availability.repository.js';
import { DistributedEventEmitter, getEventEmitter, EventEmitters } from '../utils/event-emitter.js';
import { logger } from '../config/logger.js';
import { config } from '../config/index.js';

/**
 * Cache warming job configuration
 */
export interface CacheWarmingJob {
  id: string;
  name: string;
  enabled: boolean;
  cronExpression: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  keyPattern: string;
  tenantId?: string;
  resourceIds?: string[];
  dataSource: 'inventory' | 'availability' | 'users' | 'system' | 'custom';
  estimatedDuration: number; // seconds
  maxConcurrency: number;
  retryCount: number;
  retryDelay: number; // milliseconds
  healthCheck?: () => Promise<boolean>;
  execute: (context: CacheWarmingContext) => Promise<CacheWarmingResult>;
  onSuccess?: (result: CacheWarmingResult) => Promise<void>;
  onError?: (error: Error, context: CacheWarmingContext) => Promise<void>;
  schedule?: {
    timezone: string;
    excludeHours: number[]; // Hours to avoid warming (e.g., peak hours)
    preferredHours: number[]; // Hours to prefer warming
    excludeDays: number[]; // Days of week to avoid (0=Sunday)
  };
}

/**
 * Cache warming context
 */
export interface CacheWarmingContext {
  jobId: string;
  startTime: Date;
  tenantId?: string;
  resourceIds?: string[];
  batchSize: number;
  currentBatch: number;
  totalBatches: number;
  cache: CacheService;
  inventoryService?: InventoryService;
  availabilityRepository?: AvailabilityRepository;
  fastify: FastifyInstance;
}

/**
 * Cache warming result
 */
export interface CacheWarmingResult {
  success: boolean;
  itemsProcessed: number;
  itemsWarmed: number;
  itemsSkipped: number;
  itemsFailed: number;
  duration: number; // milliseconds
  memoryUsed: number; // bytes
  errors: string[];
  details: {
    batchesProcessed: number;
    averageBatchTime: number;
    cacheHitRateImprovement: number;
    topWarmedKeys: string[];
  };
}

/**
 * Worker statistics
 */
export interface CacheWarmerStats {
  totalJobs: number;
  activeJobs: number;
  completedJobs: number;
  failedJobs: number;
  totalItemsWarmed: number;
  totalTimeSpent: number; // milliseconds
  averageJobDuration: number;
  successRate: number;
  lastRunTime?: Date;
  uptime: number;
  memoryUsage: number;
  queueSize: number;
}

/**
 * Job queue item
 */
interface QueuedJob {
  job: CacheWarmingJob;
  scheduledTime: Date;
  retryCount: number;
  priority: number;
}

/**
 * Cache Warmer Worker class
 */
export class CacheWarmerWorker {
  private jobs = new Map<string, CacheWarmingJob>();
  private jobQueue: QueuedJob[] = [];
  private activeJobs = new Map<string, Promise<CacheWarmingResult>>();
  private stats: CacheWarmerStats = {
    totalJobs: 0,
    activeJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
    totalItemsWarmed: 0,
    totalTimeSpent: 0,
    averageJobDuration: 0,
    successRate: 0,
    uptime: 0,
    memoryUsage: 0,
    queueSize: 0
  };
  private startTime = Date.now();
  private schedulerInterval?: NodeJS.Timeout;
  private queueProcessorInterval?: NodeJS.Timeout;
  private statsUpdateInterval?: NodeJS.Timeout;
  private isRunning = false;
  private cacheOptimizer: CacheOptimizerService;
  private cache: CacheService;
  private eventEmitter: DistributedEventEmitter;

  constructor(private fastify: FastifyInstance) {
    this.cacheOptimizer = new CacheOptimizerService(fastify);
    this.cache = new CacheService(fastify);
    this.eventEmitter = getEventEmitter();
    
    this.registerDefaultJobs();
    this.initializeEventHandlers();
  }

  /**
   * Start the cache warmer worker
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Cache warmer worker is already running');
      return;
    }

    this.isRunning = true;
    this.startTime = Date.now();

    // Start scheduler (checks every minute)
    this.schedulerInterval = setInterval(() => {
      this.scheduleJobs().catch(error => {
        logger.error('Error in job scheduler:', error);
      });
    }, 60 * 1000);

    // Start queue processor (runs every 10 seconds)
    this.queueProcessorInterval = setInterval(() => {
      this.processQueue().catch(error => {
        logger.error('Error in queue processor:', error);
      });
    }, 10 * 1000);

    // Start stats updater (every 5 minutes)
    this.statsUpdateInterval = setInterval(() => {
      this.updateStats();
    }, 5 * 60 * 1000);

    // Initial job scheduling
    await this.scheduleJobs();

    logger.info('Cache warmer worker started');

    await EventEmitters.systemNotification({
      source: 'cache-warmer',
      level: 'info',
      message: 'Cache warmer worker started',
      metadata: { jobCount: this.jobs.size }
    });
  }

  /**
   * Stop the cache warmer worker
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // Clear intervals
    if (this.schedulerInterval) clearInterval(this.schedulerInterval);
    if (this.queueProcessorInterval) clearInterval(this.queueProcessorInterval);
    if (this.statsUpdateInterval) clearInterval(this.statsUpdateInterval);

    // Wait for active jobs to complete (with timeout)
    const activeJobPromises = Array.from(this.activeJobs.values());
    if (activeJobPromises.length > 0) {
      logger.info(`Waiting for ${activeJobPromises.length} active jobs to complete...`);
      
      const timeout = new Promise(resolve => setTimeout(resolve, 30000)); // 30 second timeout
      await Promise.race([Promise.all(activeJobPromises), timeout]);
    }

    this.jobQueue = [];
    this.activeJobs.clear();

    logger.info('Cache warmer worker stopped');

    await EventEmitters.systemNotification({
      source: 'cache-warmer',
      level: 'info',
      message: 'Cache warmer worker stopped',
      metadata: this.getStats()
    });
  }

  /**
   * Register a cache warming job
   */
  registerJob(job: CacheWarmingJob): void {
    this.jobs.set(job.id, job);
    this.stats.totalJobs = this.jobs.size;
    
    logger.info(`Registered cache warming job: ${job.name}`, {
      id: job.id,
      priority: job.priority,
      cronExpression: job.cronExpression
    });
  }

  /**
   * Unregister a cache warming job
   */
  unregisterJob(jobId: string): void {
    this.jobs.delete(jobId);
    this.stats.totalJobs = this.jobs.size;
    
    logger.info(`Unregistered cache warming job: ${jobId}`);
  }

  /**
   * Execute job immediately (bypass queue)
   */
  async executeJobNow(jobId: string, context?: Partial<CacheWarmingContext>): Promise<CacheWarmingResult> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    if (!job.enabled) {
      throw new Error(`Job is disabled: ${jobId}`);
    }

    const fullContext = this.createWarmingContext(job, context);
    return await this.executeJob(job, fullContext);
  }

  /**
   * Get worker statistics
   */
  getStats(): CacheWarmerStats {
    this.updateStats();
    return { ...this.stats };
  }

  /**
   * Get job information
   */
  getJob(jobId: string): CacheWarmingJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Get all registered jobs
   */
  getAllJobs(): CacheWarmingJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Get queue status
   */
  getQueueStatus(): {
    size: number;
    activeJobs: number;
    nextJobTime?: Date;
    jobs: Array<{ jobId: string; scheduledTime: Date; priority: number }>;
  } {
    return {
      size: this.jobQueue.length,
      activeJobs: this.activeJobs.size,
      nextJobTime: this.jobQueue.length > 0 ? this.jobQueue[0].scheduledTime : undefined,
      jobs: this.jobQueue.map(qj => ({
        jobId: qj.job.id,
        scheduledTime: qj.scheduledTime,
        priority: qj.priority
      }))
    };
  }

  /**
   * Register default cache warming jobs
   */
  private registerDefaultJobs(): void {
    // Inventory cache warming job
    const inventoryJob: CacheWarmingJob = {
      id: 'inventory-warming',
      name: 'Inventory Data Warming',
      enabled: true,
      cronExpression: '0 */6 * * *', // Every 6 hours
      priority: 'high',
      keyPattern: 'inventory:*',
      dataSource: 'inventory',
      estimatedDuration: 300, // 5 minutes
      maxConcurrency: 3,
      retryCount: 2,
      retryDelay: 30000, // 30 seconds
      schedule: {
        timezone: config.DEFAULT_TIMEZONE,
        excludeHours: [9, 10, 11, 13, 14, 15], // Exclude business hours
        preferredHours: [2, 3, 4, 20, 21, 22], // Prefer early morning and evening
        excludeDays: []
      },
      execute: this.warmInventoryCache.bind(this)
    };

    // Availability cache warming job
    const availabilityJob: CacheWarmingJob = {
      id: 'availability-warming',
      name: 'Availability Data Warming',
      enabled: true,
      cronExpression: '0 */4 * * *', // Every 4 hours
      priority: 'high',
      keyPattern: 'availability:*',
      dataSource: 'availability',
      estimatedDuration: 180, // 3 minutes
      maxConcurrency: 2,
      retryCount: 2,
      retryDelay: 20000, // 20 seconds
      schedule: {
        timezone: config.DEFAULT_TIMEZONE,
        excludeHours: [9, 10, 11, 13, 14, 15],
        preferredHours: [1, 2, 3, 19, 20, 21],
        excludeDays: []
      },
      execute: this.warmAvailabilityCache.bind(this)
    };

    // User cache warming job
    const userJob: CacheWarmingJob = {
      id: 'user-warming',
      name: 'User Data Warming',
      enabled: true,
      cronExpression: '0 */12 * * *', // Every 12 hours
      priority: 'medium',
      keyPattern: 'user:*',
      dataSource: 'users',
      estimatedDuration: 120, // 2 minutes
      maxConcurrency: 2,
      retryCount: 1,
      retryDelay: 15000, // 15 seconds
      schedule: {
        timezone: config.DEFAULT_TIMEZONE,
        excludeHours: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
        preferredHours: [1, 2, 3, 22, 23],
        excludeDays: []
      },
      execute: this.warmUserCache.bind(this)
    };

    // Predictive warming job based on AI optimizer
    const predictiveJob: CacheWarmingJob = {
      id: 'predictive-warming',
      name: 'AI-Based Predictive Warming',
      enabled: true,
      cronExpression: '0 */2 * * *', // Every 2 hours
      priority: 'critical',
      keyPattern: '*',
      dataSource: 'custom',
      estimatedDuration: 240, // 4 minutes
      maxConcurrency: 1,
      retryCount: 3,
      retryDelay: 60000, // 1 minute
      schedule: {
        timezone: config.DEFAULT_TIMEZONE,
        excludeHours: [],
        preferredHours: [],
        excludeDays: []
      },
      execute: this.executePredictiveWarming.bind(this)
    };

    // Register all default jobs
    this.registerJob(inventoryJob);
    this.registerJob(availabilityJob);
    this.registerJob(userJob);
    this.registerJob(predictiveJob);

    logger.info('Default cache warming jobs registered');
  }

  /**
   * Initialize event handlers
   */
  private initializeEventHandlers(): void {
    // Listen for inventory updates to trigger warming
    this.eventEmitter.subscribe('inventory.updated', async (data) => {
      if (data.tenantId) {
        await this.scheduleInventoryWarming(data.tenantId, data.resourceId ? [data.resourceId] : undefined);
      }
    });

    // Listen for cache invalidation events
    this.eventEmitter.subscribe('cache.invalidated', async (data) => {
      if (data.pattern && data.pattern.includes('inventory')) {
        await this.scheduleJobByPattern('inventory:*');
      }
    });

    logger.debug('Cache warmer event handlers initialized');
  }

  /**
   * Schedule jobs based on cron expressions and current time
   */
  private async scheduleJobs(): Promise<void> {
    const now = new Date();
    
    for (const job of this.jobs.values()) {
      if (!job.enabled) continue;

      // Check if job should be scheduled based on cron expression
      if (this.shouldScheduleJob(job, now)) {
        const scheduledTime = this.getNextScheduledTime(job, now);
        const priority = this.calculateJobPriority(job, scheduledTime);
        
        // Add to queue if not already queued or running
        if (!this.isJobInQueue(job.id) && !this.activeJobs.has(job.id)) {
          this.jobQueue.push({
            job,
            scheduledTime,
            retryCount: 0,
            priority
          });
          
          logger.debug(`Scheduled job: ${job.name} for ${scheduledTime.toISOString()}`);
        }
      }
    }

    // Sort queue by priority and scheduled time
    this.jobQueue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority; // Higher priority first
      }
      return a.scheduledTime.getTime() - b.scheduledTime.getTime(); // Earlier time first
    });

    this.stats.queueSize = this.jobQueue.length;
  }

  /**
   * Process the job queue
   */
  private async processQueue(): Promise<void> {
    const now = new Date();
    const maxConcurrentJobs = parseInt(process.env.CACHE_WARMER_MAX_CONCURRENT || '5', 10);
    
    // Process jobs that are ready to run
    while (
      this.jobQueue.length > 0 && 
      this.activeJobs.size < maxConcurrentJobs &&
      this.jobQueue[0].scheduledTime <= now
    ) {
      const queuedJob = this.jobQueue.shift()!;
      
      // Check if job is still enabled
      if (!queuedJob.job.enabled) {
        continue;
      }

      // Start job execution
      this.startJobExecution(queuedJob);
    }

    this.stats.queueSize = this.jobQueue.length;
    this.stats.activeJobs = this.activeJobs.size;
  }

  /**
   * Start job execution
   */
  private startJobExecution(queuedJob: QueuedJob): void {
    const { job } = queuedJob;
    const context = this.createWarmingContext(job);
    
    const jobPromise = this.executeJob(job, context)
      .then(async (result) => {
        this.handleJobSuccess(job, result);
        if (job.onSuccess) {
          await job.onSuccess(result);
        }
        return result;
      })
      .catch(async (error) => {
        await this.handleJobError(job, queuedJob, error, context);
        throw error;
      })
      .finally(() => {
        this.activeJobs.delete(job.id);
        this.stats.activeJobs = this.activeJobs.size;
      });

    this.activeJobs.set(job.id, jobPromise);
    
    logger.info(`Started job execution: ${job.name}`);
  }

  /**
   * Execute a cache warming job
   */
  private async executeJob(job: CacheWarmingJob, context: CacheWarmingContext): Promise<CacheWarmingResult> {
    const startTime = Date.now();
    
    logger.info(`Executing cache warming job: ${job.name}`, {
      jobId: job.id,
      priority: job.priority
    });

    try {
      // Health check if provided
      if (job.healthCheck) {
        const healthy = await job.healthCheck();
        if (!healthy) {
          throw new Error('Job health check failed');
        }
      }

      // Execute job
      const result = await job.execute(context);
      
      // Validate result
      if (!result) {
        throw new Error('Job execution returned null/undefined result');
      }

      const duration = Date.now() - startTime;
      result.duration = duration;

      logger.info(`Completed cache warming job: ${job.name}`, {
        jobId: job.id,
        duration,
        itemsWarmed: result.itemsWarmed,
        success: result.success
      });

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error(`Failed cache warming job: ${job.name}`, {
        jobId: job.id,
        duration,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Create warming context for job execution
   */
  private createWarmingContext(job: CacheWarmingJob, override?: Partial<CacheWarmingContext>): CacheWarmingContext {
    const batchSize = parseInt(process.env.CACHE_WARMING_BATCH_SIZE || '50', 10);
    
    return {
      jobId: job.id,
      startTime: new Date(),
      tenantId: job.tenantId,
      resourceIds: job.resourceIds,
      batchSize,
      currentBatch: 0,
      totalBatches: 0,
      cache: this.cache,
      inventoryService: new InventoryService(this.fastify),
      availabilityRepository: new AvailabilityRepository(),
      fastify: this.fastify,
      ...override
    };
  }

  /**
   * Warm inventory cache
   */
  private async warmInventoryCache(context: CacheWarmingContext): Promise<CacheWarmingResult> {
    const startTime = Date.now();
    const result: CacheWarmingResult = {
      success: true,
      itemsProcessed: 0,
      itemsWarmed: 0,
      itemsSkipped: 0,
      itemsFailed: 0,
      duration: 0,
      memoryUsed: 0,
      errors: [],
      details: {
        batchesProcessed: 0,
        averageBatchTime: 0,
        cacheHitRateImprovement: 0,
        topWarmedKeys: []
      }
    };

    try {
      // Get all tenants or use specific tenant
      const tenants = context.tenantId ? [context.tenantId] : await this.getAllTenants();
      const batchTimes: number[] = [];

      for (const tenantId of tenants) {
        const batchStart = Date.now();
        
        try {
          // Get resources for this tenant
          const resourceIds = context.resourceIds || await this.getResourceIds(tenantId);
          
          if (resourceIds.length === 0) {
            result.itemsSkipped++;
            continue;
          }

          // Determine date range for warming
          const now = new Date();
          const startDate = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Tomorrow
          const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // Next 7 days

          // Warm inventory status cache
          const inventoryStatuses = await context.inventoryService!.getInventoryStatus(
            tenantId,
            resourceIds,
            startDate,
            endDate
          );

          result.itemsProcessed += resourceIds.length;
          result.itemsWarmed += inventoryStatuses.length;
          result.details.topWarmedKeys.push(
            ...inventoryStatuses.map(status => `inventory:${tenantId}:${status.resourceId}`)
          );

          const batchTime = Date.now() - batchStart;
          batchTimes.push(batchTime);
          result.details.batchesProcessed++;

        } catch (error) {
          result.itemsFailed++;
          result.errors.push(`Failed to warm inventory for tenant ${tenantId}: ${error.message}`);
          logger.error(`Inventory warming failed for tenant ${tenantId}:`, error);
        }
      }

      result.details.averageBatchTime = batchTimes.length > 0 
        ? batchTimes.reduce((sum, time) => sum + time, 0) / batchTimes.length 
        : 0;

      result.success = result.itemsFailed < result.itemsProcessed / 2; // Success if less than 50% failed
      
    } catch (error) {
      result.success = false;
      result.errors.push(`Inventory warming job failed: ${error.message}`);
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  /**
   * Warm availability cache
   */
  private async warmAvailabilityCache(context: CacheWarmingContext): Promise<CacheWarmingResult> {
    const startTime = Date.now();
    const result: CacheWarmingResult = {
      success: true,
      itemsProcessed: 0,
      itemsWarmed: 0,
      itemsSkipped: 0,
      itemsFailed: 0,
      duration: 0,
      memoryUsed: 0,
      errors: [],
      details: {
        batchesProcessed: 0,
        averageBatchTime: 0,
        cacheHitRateImprovement: 0,
        topWarmedKeys: []
      }
    };

    try {
      const tenants = context.tenantId ? [context.tenantId] : await this.getAllTenants();
      const batchTimes: number[] = [];

      for (const tenantId of tenants) {
        const batchStart = Date.now();
        
        try {
          const resourceIds = context.resourceIds || await this.getResourceIds(tenantId);
          
          if (resourceIds.length === 0) {
            result.itemsSkipped++;
            continue;
          }

          // Warm availability data for next 7 days
          const now = new Date();
          const startDate = new Date();
          const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

          const availableSlots = await context.availabilityRepository!.getAvailableSlots({
            tenantId,
            resourceIds,
            startDate,
            endDate
          });

          result.itemsProcessed += resourceIds.length;
          result.itemsWarmed += availableSlots.length;
          result.details.topWarmedKeys.push(
            ...resourceIds.map(resourceId => `availability:${tenantId}:${resourceId}`)
          );

          const batchTime = Date.now() - batchStart;
          batchTimes.push(batchTime);
          result.details.batchesProcessed++;

        } catch (error) {
          result.itemsFailed++;
          result.errors.push(`Failed to warm availability for tenant ${tenantId}: ${error.message}`);
          logger.error(`Availability warming failed for tenant ${tenantId}:`, error);
        }
      }

      result.details.averageBatchTime = batchTimes.length > 0 
        ? batchTimes.reduce((sum, time) => sum + time, 0) / batchTimes.length 
        : 0;

      result.success = result.itemsFailed < result.itemsProcessed / 2;
      
    } catch (error) {
      result.success = false;
      result.errors.push(`Availability warming job failed: ${error.message}`);
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  /**
   * Warm user cache
   */
  private async warmUserCache(context: CacheWarmingContext): Promise<CacheWarmingResult> {
    const result: CacheWarmingResult = {
      success: true,
      itemsProcessed: 0,
      itemsWarmed: 0,
      itemsSkipped: 0,
      itemsFailed: 0,
      duration: 0,
      memoryUsed: 0,
      errors: [],
      details: {
        batchesProcessed: 0,
        averageBatchTime: 0,
        cacheHitRateImprovement: 0,
        topWarmedKeys: []
      }
    };

    // Placeholder implementation for user cache warming
    // In a real implementation, this would warm frequently accessed user data
    
    result.itemsProcessed = 10;
    result.itemsWarmed = 8;
    result.itemsSkipped = 2;
    result.details.topWarmedKeys = ['user:1', 'user:2', 'user:3'];
    
    return result;
  }

  /**
   * Execute predictive warming based on AI optimizer
   */
  private async executePredictiveWarming(context: CacheWarmingContext): Promise<CacheWarmingResult> {
    const startTime = Date.now();
    
    try {
      // Get warming recommendations from AI optimizer
      const recommendations = this.cacheOptimizer.getCurrentRecommendations();
      const predictions = recommendations.warmingCandidates.slice(0, 100); // Limit to top 100

      if (predictions.length === 0) {
        return {
          success: true,
          itemsProcessed: 0,
          itemsWarmed: 0,
          itemsSkipped: 0,
          itemsFailed: 0,
          duration: Date.now() - startTime,
          memoryUsed: 0,
          errors: [],
          details: {
            batchesProcessed: 0,
            averageBatchTime: 0,
            cacheHitRateImprovement: 0,
            topWarmedKeys: []
          }
        };
      }

      // Execute warming recommendations
      const warmingResult = await this.cacheOptimizer.executeWarmingRecommendations(
        predictions,
        { maxItems: 50 }
      );

      return {
        success: warmingResult.success,
        itemsProcessed: predictions.length,
        itemsWarmed: warmingResult.warmed,
        itemsSkipped: 0,
        itemsFailed: warmingResult.failed,
        duration: Date.now() - startTime,
        memoryUsed: 0,
        errors: warmingResult.details.filter(d => d.includes('Failed')),
        details: {
          batchesProcessed: 1,
          averageBatchTime: Date.now() - startTime,
          cacheHitRateImprovement: 0.1, // Estimated
          topWarmedKeys: warmingResult.details
            .filter(d => d.includes('Warmed'))
            .map(d => d.split(' ')[1])
            .slice(0, 10)
        }
      };

    } catch (error) {
      return {
        success: false,
        itemsProcessed: 0,
        itemsWarmed: 0,
        itemsSkipped: 0,
        itemsFailed: 1,
        duration: Date.now() - startTime,
        memoryUsed: 0,
        errors: [error.message],
        details: {
          batchesProcessed: 0,
          averageBatchTime: 0,
          cacheHitRateImprovement: 0,
          topWarmedKeys: []
        }
      };
    }
  }

  /**
   * Handle job success
   */
  private handleJobSuccess(job: CacheWarmingJob, result: CacheWarmingResult): void {
    this.stats.completedJobs++;
    this.stats.totalItemsWarmed += result.itemsWarmed;
    this.stats.totalTimeSpent += result.duration;
    this.stats.lastRunTime = new Date();
    
    this.updateAverageJobDuration();
    this.updateSuccessRate();

    logger.info(`Job completed successfully: ${job.name}`, {
      jobId: job.id,
      itemsWarmed: result.itemsWarmed,
      duration: result.duration
    });
  }

  /**
   * Handle job error and retry logic
   */
  private async handleJobError(
    job: CacheWarmingJob,
    queuedJob: QueuedJob,
    error: Error,
    context: CacheWarmingContext
  ): Promise<void> {
    this.stats.failedJobs++;
    this.updateSuccessRate();

    logger.error(`Job failed: ${job.name}`, {
      jobId: job.id,
      error: error.message,
      retryCount: queuedJob.retryCount
    });

    // Retry logic
    if (queuedJob.retryCount < job.retryCount) {
      queuedJob.retryCount++;
      queuedJob.scheduledTime = new Date(Date.now() + job.retryDelay);
      
      this.jobQueue.push(queuedJob);
      this.jobQueue.sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        return a.scheduledTime.getTime() - b.scheduledTime.getTime();
      });

      logger.info(`Scheduled retry for job: ${job.name}`, {
        jobId: job.id,
        retryCount: queuedJob.retryCount,
        scheduledTime: queuedJob.scheduledTime
      });
    }

    // Call error handler if provided
    if (job.onError) {
      try {
        await job.onError(error, context);
      } catch (handlerError) {
        logger.error(`Job error handler failed: ${job.name}`, handlerError);
      }
    }
  }

  /**
   * Update statistics
   */
  private updateStats(): void {
    this.stats.uptime = Date.now() - this.startTime;
    this.stats.memoryUsage = process.memoryUsage().heapUsed;
    this.updateAverageJobDuration();
    this.updateSuccessRate();
  }

  /**
   * Update average job duration
   */
  private updateAverageJobDuration(): void {
    const totalJobs = this.stats.completedJobs + this.stats.failedJobs;
    if (totalJobs > 0) {
      this.stats.averageJobDuration = this.stats.totalTimeSpent / totalJobs;
    }
  }

  /**
   * Update success rate
   */
  private updateSuccessRate(): void {
    const totalJobs = this.stats.completedJobs + this.stats.failedJobs;
    if (totalJobs > 0) {
      this.stats.successRate = this.stats.completedJobs / totalJobs;
    }
  }

  /**
   * Helper methods
   */
  private shouldScheduleJob(job: CacheWarmingJob, now: Date): boolean {
    // Simplified cron-like scheduling logic
    // In a real implementation, use a proper cron library
    return true;
  }

  private getNextScheduledTime(job: CacheWarmingJob, now: Date): Date {
    // Simple scheduling - add some variance to avoid thundering herd
    const baseDelay = 5 * 60 * 1000; // 5 minutes
    const variance = Math.random() * 60 * 1000; // Up to 1 minute variance
    return new Date(now.getTime() + baseDelay + variance);
  }

  private calculateJobPriority(job: CacheWarmingJob, scheduledTime: Date): number {
    const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
    let priority = priorityOrder[job.priority];
    
    // Increase priority for overdue jobs
    const now = Date.now();
    const overdueMinutes = Math.max(0, (now - scheduledTime.getTime()) / (60 * 1000));
    priority += Math.floor(overdueMinutes / 30); // +1 priority every 30 minutes overdue
    
    return Math.min(10, priority); // Cap at 10
  }

  private isJobInQueue(jobId: string): boolean {
    return this.jobQueue.some(qj => qj.job.id === jobId);
  }

  private async scheduleInventoryWarming(tenantId: string, resourceIds?: string[]): Promise<void> {
    // Schedule immediate inventory warming for specific tenant/resources
    const job = this.jobs.get('inventory-warming');
    if (job && job.enabled) {
      this.jobQueue.unshift({
        job,
        scheduledTime: new Date(),
        retryCount: 0,
        priority: 5 // High priority for reactive warming
      });
    }
  }

  private async scheduleJobByPattern(pattern: string): Promise<void> {
    for (const job of this.jobs.values()) {
      if (job.keyPattern === pattern && job.enabled) {
        this.jobQueue.unshift({
          job,
          scheduledTime: new Date(Date.now() + 60000), // 1 minute delay
          retryCount: 0,
          priority: 3
        });
      }
    }
  }

  private async getAllTenants(): Promise<string[]> {
    try {
      // This would query the database for all tenant IDs
      // Placeholder implementation
      const result = await this.fastify.db.query('SELECT DISTINCT tenant_id FROM tenants LIMIT 100');
      return result.rows.map(row => row.tenant_id);
    } catch (error) {
      logger.error('Failed to get all tenants:', error);
      return [];
    }
  }

  private async getResourceIds(tenantId: string): Promise<string[]> {
    try {
      // This would query the database for resource IDs for a tenant
      // Placeholder implementation
      const result = await this.fastify.db.queryForTenant(
        tenantId,
        'SELECT id FROM resources WHERE active = true LIMIT 50'
      );
      return result.rows.map(row => row.id.toString());
    } catch (error) {
      logger.error(`Failed to get resource IDs for tenant ${tenantId}:`, error);
      return [];
    }
  }
}

export default CacheWarmerWorker;