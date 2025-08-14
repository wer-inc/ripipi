/**
 * Inventory Management API Routes
 * RESTful endpoints for inventory management and statistics
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  InventorySchemas,
  InventoryQuery,
  InventoryUpdate,
  BulkInventoryUpdate,
  InventoryStatsQuery
} from '../../schemas/availability.js';
import { InventoryService } from '../../services/inventory.service.js';
import { createPresetCache, CachePresets } from '../../middleware/cache.js';
import { CacheService } from '../../services/cache.service.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { authenticateJWT } from '../../decorators/auth.js';
import { logger } from '../../config/logger.js';
import { BadRequestError, NotFoundError, ForbiddenError } from '../../utils/errors.js';

/**
 * Pagination helper
 */
interface PaginationParams {
  page: number;
  limit: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

/**
 * Register inventory routes
 */
export async function inventoryRoutes(fastify: FastifyInstance) {
  const inventoryService = new InventoryService(fastify);
  const cacheService = new CacheService(fastify);
  
  // Apply authentication to all routes
  await fastify.register(authenticateJWT);

  // Apply caching middleware to GET routes
  const readCacheMiddleware = createPresetCache(cacheService, 'api', {
    ttl: 60, // 1 minute for inventory data (more frequent updates)
    tags: (request: FastifyRequest) => {
      const user = request.user;
      return user ? [`tenant:${user.tenant_id}`, 'inventory'] : ['inventory'];
    },
    keyStrategy: {
      includeQuery: true,
      includeHeaders: ['authorization']
    }
  });

  // Apply shorter cache for statistics
  const statsCacheMiddleware = createPresetCache(cacheService, 'api', {
    ttl: 300, // 5 minutes for statistics
    tags: (request: FastifyRequest) => {
      const user = request.user;
      return user ? [`tenant:${user.tenant_id}`, 'inventory-stats'] : ['inventory-stats'];
    }
  });

  /**
   * GET /inventory - Get inventory list with filtering and pagination
   * Query parameters: resourceIds?, includeStats?, includeAlerts?, page?, limit?, sort?, order?, startDate?, endDate?
   */
  fastify.get('/inventory', {
    schema: {
      querystring: InventorySchemas.inventoryQuery,
      response: {
        200: InventorySchemas.inventoryResponse,
        400: InventorySchemas.validationErrorResponse,
        500: InventorySchemas.errorResponse
      },
      tags: ['Inventory'],
      summary: 'Get inventory list with filtering and pagination',
      description: 'Returns paginated list of inventory status for resources with optional statistics and alerts'
    },
    preHandler: [readCacheMiddleware]
  }, asyncHandler(async (request: FastifyRequest<{ Querystring: InventoryQuery }>, reply: FastifyReply) => {
    const tenantId = request.user?.tenant_id;
    if (!tenantId) {
      throw new BadRequestError('Tenant ID is required');
    }

    const {
      resourceIds,
      includeStats = false,
      includeAlerts = false,
      page = 1,
      limit = 20,
      sort = 'resourceId',
      order = 'asc',
      startDate,
      endDate
    } = request.query;

    // Validate pagination parameters
    if (page < 1 || limit < 1 || limit > 100) {
      throw new BadRequestError('Invalid pagination parameters');
    }

    // Set date range (default to current week)
    const queryStartDate = startDate ? new Date(startDate) : new Date();
    const queryEndDate = endDate ? new Date(endDate) : 
      new Date(queryStartDate.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Get all resources if none specified
    const targetResourceIds = resourceIds || await getAllResourceIds(fastify, tenantId);
    
    if (targetResourceIds.length === 0) {
      reply.send({
        success: true,
        data: {
          inventory: [],
          pagination: {
            page,
            limit,
            total: 0,
            totalPages: 0,
            hasNext: false,
            hasPrev: false
          },
          summary: {
            totalResources: 0,
            activeResources: 0,
            totalCapacity: 0,
            availableCapacity: 0,
            averageUtilization: 0,
            criticalAlerts: 0,
            highAlerts: 0
          }
        }
      });
      return;
    }

    // Get inventory status
    const inventoryStatuses = await inventoryService.getInventoryStatus(
      tenantId,
      targetResourceIds,
      queryStartDate,
      queryEndDate
    );

    // Get alerts if requested
    let alertsMap: Record<string, any[]> = {};
    if (includeAlerts) {
      const alerts = await inventoryService.generateInventoryAlerts(
        tenantId,
        targetResourceIds,
        queryStartDate
      );
      
      for (const alert of alerts) {
        if (!alertsMap[alert.resourceId]) {
          alertsMap[alert.resourceId] = [];
        }
        alertsMap[alert.resourceId].push({
          type: alert.alertType,
          severity: alert.severity,
          message: alert.message,
          threshold: alert.threshold,
          currentValue: alert.currentValue,
          timestamp: alert.timestamp.toISOString()
        });
      }
    }

    // Transform to response format
    const inventoryItems = await Promise.all(
      inventoryStatuses.map(async (status) => {
        const resourceDetails = await getResourceDetails(fastify, tenantId, status.resourceId);
        
        return {
          tenantId: status.tenantId,
          resourceId: status.resourceId,
          resourceName: resourceDetails.name,
          resourceType: resourceDetails.type,
          totalCapacity: status.totalCapacity,
          availableCapacity: status.availableCapacity,
          bookedCapacity: status.bookedCapacity,
          maintenanceCapacity: 0, // Would be calculated from maintenance bookings
          utilization: status.utilization,
          status: resourceDetails.status,
          lastUpdated: status.lastUpdated.toISOString(),
          alerts: alertsMap[status.resourceId] || []
        };
      })
    );

    // Apply sorting
    inventoryItems.sort((a, b) => {
      let aValue: any = a[sort as keyof typeof a];
      let bValue: any = b[sort as keyof typeof b];
      
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }
      
      if (order === 'desc') {
        return bValue > aValue ? 1 : bValue < aValue ? -1 : 0;
      }
      return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
    });

    // Apply pagination
    const total = inventoryItems.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const paginatedItems = inventoryItems.slice(offset, offset + limit);

    // Calculate summary statistics
    const summary = {
      totalResources: total,
      activeResources: inventoryItems.filter(item => item.status === 'active').length,
      totalCapacity: inventoryItems.reduce((sum, item) => sum + item.totalCapacity, 0),
      availableCapacity: inventoryItems.reduce((sum, item) => sum + item.availableCapacity, 0),
      averageUtilization: total > 0 
        ? inventoryItems.reduce((sum, item) => sum + item.utilization, 0) / total 
        : 0,
      criticalAlerts: Object.values(alertsMap).flat().filter(alert => alert.severity === 'CRITICAL').length,
      highAlerts: Object.values(alertsMap).flat().filter(alert => alert.severity === 'HIGH').length
    };

    reply.send({
      success: true,
      data: {
        inventory: paginatedItems,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        },
        summary
      }
    });
  }));

  /**
   * GET /inventory/:id - Get detailed inventory status for a specific resource
   * Path parameters: id (resource ID)
   */
  fastify.get('/inventory/:id', {
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 }
        },
        required: ['id']
      },
      response: {
        200: InventorySchemas.inventoryDetailResponse,
        400: InventorySchemas.validationErrorResponse,
        404: InventorySchemas.errorResponse,
        500: InventorySchemas.errorResponse
      },
      tags: ['Inventory'],
      summary: 'Get detailed inventory status for a specific resource',
      description: 'Returns comprehensive inventory information including alerts and statistics'
    },
    preHandler: [readCacheMiddleware]
  }, asyncHandler(async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const tenantId = request.user?.tenant_id;
    if (!tenantId) {
      throw new BadRequestError('Tenant ID is required');
    }

    const resourceId = request.params.id;

    // Verify resource exists and belongs to tenant
    const resourceDetails = await getResourceDetails(fastify, tenantId, resourceId);
    if (!resourceDetails) {
      throw new NotFoundError(`Resource ${resourceId} not found`);
    }

    // Get inventory status for the next 7 days
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    const inventoryStatuses = await inventoryService.getInventoryStatus(
      tenantId,
      [resourceId],
      startDate,
      endDate
    );

    if (inventoryStatuses.length === 0) {
      throw new NotFoundError(`Inventory data for resource ${resourceId} not found`);
    }

    const status = inventoryStatuses[0];

    // Get alerts for this resource
    const alerts = await inventoryService.generateInventoryAlerts(
      tenantId,
      [resourceId],
      startDate
    );

    const inventoryDetail = {
      tenantId: status.tenantId,
      resourceId: status.resourceId,
      resourceName: resourceDetails.name,
      resourceType: resourceDetails.type,
      totalCapacity: status.totalCapacity,
      availableCapacity: status.availableCapacity,
      bookedCapacity: status.bookedCapacity,
      maintenanceCapacity: 0, // Would be calculated from maintenance records
      utilization: status.utilization,
      status: resourceDetails.status,
      lastUpdated: status.lastUpdated.toISOString(),
      alerts: alerts.map(alert => ({
        type: alert.alertType,
        severity: alert.severity,
        message: alert.message,
        threshold: alert.threshold,
        currentValue: alert.currentValue,
        timestamp: alert.timestamp.toISOString()
      }))
    };

    reply.send({
      success: true,
      data: inventoryDetail
    });
  }));

  /**
   * PUT /inventory/:id - Update inventory settings for a specific resource
   * Path parameters: id (resource ID)
   * Body: { capacity?, status?, reason? }
   */
  fastify.put('/inventory/:id', {
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 }
        },
        required: ['id']
      },
      body: InventorySchemas.inventoryUpdate,
      response: {
        200: InventorySchemas.inventoryUpdateResponse,
        400: InventorySchemas.validationErrorResponse,
        403: InventorySchemas.errorResponse,
        404: InventorySchemas.errorResponse,
        500: InventorySchemas.errorResponse
      },
      tags: ['Inventory'],
      summary: 'Update inventory settings for a specific resource',
      description: 'Updates capacity or status for a resource with audit trail'
    }
  }, asyncHandler(async (request: FastifyRequest<{ 
    Params: { id: string };
    Body: InventoryUpdate
  }>, reply: FastifyReply) => {
    const tenantId = request.user?.tenant_id;
    const userId = request.user?.id;
    if (!tenantId || !userId) {
      throw new BadRequestError('Tenant ID and User ID are required');
    }

    const resourceId = request.params.id;
    const updateData = request.body;

    // Validate user permissions for inventory updates
    const hasPermission = await checkInventoryPermission(fastify, tenantId, userId, 'update');
    if (!hasPermission) {
      throw new ForbiddenError('Insufficient permissions to update inventory');
    }

    // Get current resource details
    const resourceDetails = await getResourceDetails(fastify, tenantId, resourceId);
    if (!resourceDetails) {
      throw new NotFoundError(`Resource ${resourceId} not found`);
    }

    const previousCapacity = resourceDetails.capacity;
    let newCapacity = previousCapacity;

    // Update resource capacity if specified
    if (updateData.capacity !== undefined) {
      if (updateData.capacity < 0) {
        throw new BadRequestError('Capacity cannot be negative');
      }
      
      await fastify.db.queryForTenant(
        tenantId,
        `
        UPDATE resources 
        SET 
          capacity = $1,
          updated_at = NOW()
        WHERE id = $2
        `,
        [updateData.capacity, resourceId]
      );
      
      newCapacity = updateData.capacity;
    }

    // Update resource status if specified
    if (updateData.status) {
      await fastify.db.queryForTenant(
        tenantId,
        `
        UPDATE resources 
        SET 
          status = $1,
          updated_at = NOW()
        WHERE id = $2
        `,
        [updateData.status, resourceId]
      );
    }

    // Create audit log entry
    await fastify.db.queryForTenant(
      tenantId,
      `
      INSERT INTO audit_logs (tenant_id, user_id, entity_type, entity_id, action, details, created_at)
      VALUES ($1, $2, 'resource', $3, 'inventory_update', $4, NOW())
      `,
      [
        tenantId,
        userId,
        resourceId,
        JSON.stringify({
          previousCapacity,
          newCapacity,
          previousStatus: resourceDetails.status,
          newStatus: updateData.status,
          reason: updateData.reason
        })
      ]
    );

    // Invalidate cache
    await cacheService.deleteByPattern(`inventory:*:${tenantId}:*`);

    reply.send({
      success: true,
      data: {
        resourceId,
        previousCapacity,
        newCapacity,
        updatedAt: new Date().toISOString(),
        reason: updateData.reason
      },
      message: 'Inventory updated successfully'
    });
  }));

  /**
   * POST /inventory/bulk-update - Bulk update inventory for multiple resources
   * Body: { updates: [{ resourceId, timeSlotId, capacityChange, operation, reason? }] }
   */
  fastify.post('/inventory/bulk-update', {
    schema: {
      body: InventorySchemas.bulkInventoryUpdate,
      response: {
        200: InventorySchemas.bulkInventoryUpdateResponse,
        400: InventorySchemas.validationErrorResponse,
        403: InventorySchemas.errorResponse,
        500: InventorySchemas.errorResponse
      },
      tags: ['Inventory'],
      summary: 'Bulk update inventory for multiple resources',
      description: 'Process multiple inventory updates atomically with rollback on failure'
    }
  }, asyncHandler(async (request: FastifyRequest<{ Body: BulkInventoryUpdate }>, reply: FastifyReply) => {
    const tenantId = request.user?.tenant_id;
    const userId = request.user?.id;
    if (!tenantId || !userId) {
      throw new BadRequestError('Tenant ID and User ID are required');
    }

    const { updates } = request.body;

    // Validate user permissions
    const hasPermission = await checkInventoryPermission(fastify, tenantId, userId, 'bulk_update');
    if (!hasPermission) {
      throw new ForbiddenError('Insufficient permissions for bulk inventory updates');
    }

    // Validate batch size
    if (updates.length > 100) {
      throw new BadRequestError('Maximum 100 updates allowed per batch');
    }

    // Convert to inventory update requests
    const inventoryUpdates = updates.map(update => ({
      tenantId,
      resourceId: update.resourceId,
      timeSlotId: update.timeSlotId,
      capacityChange: update.capacityChange,
      operation: update.operation,
      optimisticLock: {
        version: Date.now(),
        lastModified: new Date()
      },
      reason: update.reason || 'Bulk update operation'
    }));

    // Process bulk update
    const results = await inventoryService.batchUpdateInventory(tenantId, inventoryUpdates);

    // Create audit log for bulk operation
    await fastify.db.queryForTenant(
      tenantId,
      `
      INSERT INTO audit_logs (tenant_id, user_id, entity_type, entity_id, action, details, created_at)
      VALUES ($1, $2, 'inventory', 'bulk', 'bulk_inventory_update', $3, NOW())
      `,
      [
        tenantId,
        userId,
        JSON.stringify({
          totalUpdates: updates.length,
          successfulUpdates: results.filter(r => r.success).length,
          failedUpdates: results.filter(r => !r.success).length
        })
      ]
    );

    // Invalidate cache
    await cacheService.deleteByPattern(`inventory:*:${tenantId}:*`);

    const processedCount = results.length;
    const successfulCount = results.filter(r => r.success).length;
    const failedCount = processedCount - successfulCount;

    reply.send({
      success: failedCount === 0,
      data: {
        processedCount,
        successfulCount,
        failedCount,
        results: results.map((result, index) => ({
          resourceId: updates[index].resourceId,
          timeSlotId: updates[index].timeSlotId,
          success: result.success,
          error: result.success ? undefined : result.message,
          newCapacity: result.success ? result.newCapacity : undefined
        }))
      },
      message: `Bulk update completed: ${successfulCount} successful, ${failedCount} failed`
    });
  }));

  /**
   * GET /inventory/statistics - Get inventory statistics with aggregation
   * Query parameters: resourceIds?, startDate, endDate, groupBy?, metrics?
   */
  fastify.get('/inventory/statistics', {
    schema: {
      querystring: InventorySchemas.inventoryStatsQuery,
      response: {
        200: InventorySchemas.inventoryStatsResponse,
        400: InventorySchemas.validationErrorResponse,
        500: InventorySchemas.errorResponse
      },
      tags: ['Inventory'],
      summary: 'Get inventory statistics with aggregation',
      description: 'Returns comprehensive inventory statistics grouped by specified criteria'
    },
    preHandler: [statsCacheMiddleware]
  }, asyncHandler(async (request: FastifyRequest<{ Querystring: InventoryStatsQuery }>, reply: FastifyReply) => {
    const tenantId = request.user?.tenant_id;
    if (!tenantId) {
      throw new BadRequestError('Tenant ID is required');
    }

    const {
      resourceIds,
      startDate: startDateStr,
      endDate: endDateStr,
      groupBy = 'day',
      metrics = ['utilization', 'capacity']
    } = request.query;

    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    // Validate date range
    if (startDate >= endDate) {
      throw new BadRequestError('Start date must be before end date');
    }

    // Limit date range to prevent performance issues
    const maxDays = groupBy === 'day' ? 90 : groupBy === 'week' ? 365 : 1095; // 3 years for month
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff > maxDays) {
      throw new BadRequestError(`Date range too large for ${groupBy} grouping (max ${maxDays} days)`);
    }

    // Get target resource IDs
    const targetResourceIds = resourceIds || await getAllResourceIds(fastify, tenantId);
    
    if (targetResourceIds.length === 0) {
      reply.send({
        success: true,
        data: {
          period: { startDate: startDateStr, endDate: endDateStr },
          groupBy,
          stats: [],
          aggregated: {
            totalUtilization: 0,
            averageUtilization: 0,
            peakUtilization: 0,
            totalCapacity: 0,
            totalBookings: 0,
            totalRevenue: 0
          }
        }
      });
      return;
    }

    // Get inventory statistics
    const inventoryStats = await inventoryService.getInventoryStatistics(
      tenantId,
      targetResourceIds,
      startDate,
      endDate
    );

    // Group statistics by the specified criteria
    const groupedStats = groupStatsByPeriod(inventoryStats, groupBy, startDate, endDate);

    // Calculate aggregated statistics
    const aggregated = calculateAggregatedStats(inventoryStats);

    reply.send({
      success: true,
      data: {
        period: { startDate: startDateStr, endDate: endDateStr },
        groupBy,
        stats: groupedStats,
        aggregated
      }
    });
  }));

  /**
   * GET /inventory/health - Health check for inventory service
   */
  fastify.get('/inventory/health', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
            metrics: {
              type: 'object',
              properties: {
                totalOperations: { type: 'number' },
                averageResponseTime: { type: 'number' },
                errorRate: { type: 'number' },
                cacheHitRate: { type: 'number' }
              }
            }
          }
        }
      },
      tags: ['Inventory'],
      summary: 'Health check for inventory service'
    }
  }, asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const metrics = inventoryService.getPerformanceMetrics();
    
    const totalOperations = metrics.length;
    const averageResponseTime = metrics.length > 0 
      ? metrics.reduce((sum, m) => sum + m.duration, 0) / metrics.length 
      : 0;
    const cacheHitRate = metrics.length > 0 
      ? (metrics.filter(m => m.cacheHit).length / metrics.length) * 100 
      : 0;
    const errorRate = 0; // Would calculate from error metrics in production

    reply.send({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      metrics: {
        totalOperations,
        averageResponseTime: Math.round(averageResponseTime),
        errorRate,
        cacheHitRate: Math.round(cacheHitRate * 100) / 100
      }
    });
  }));

  // Add response time tracking
  fastify.addHook('onSend', async (request, reply, payload) => {
    if (request.routeOptions.url?.startsWith('/inventory/')) {
      const responseTime = Date.now() - (request as any).startTime;
      reply.header('X-Response-Time', `${responseTime}ms`);
    }
  });

  fastify.addHook('onRequest', async (request, reply) => {
    if (request.routeOptions.url?.startsWith('/inventory/')) {
      (request as any).startTime = Date.now();
    }
  });
}

// Helper functions

async function getAllResourceIds(fastify: FastifyInstance, tenantId: string): Promise<string[]> {
  try {
    const result = await fastify.db.queryForTenant<{ id: string }>(
      tenantId,
      'SELECT id FROM resources WHERE status != $1 ORDER BY id',
      ['deleted']
    );
    return result.rows.map(row => row.id.toString());
  } catch (error) {
    logger.error('Failed to get all resource IDs', { tenantId, error });
    return [];
  }
}

async function getResourceDetails(fastify: FastifyInstance, tenantId: string, resourceId: string): Promise<{
  name: string;
  type: string;
  status: 'active' | 'maintenance' | 'inactive';
  capacity: number;
} | null> {
  try {
    const result = await fastify.db.queryForTenant<any>(
      tenantId,
      'SELECT name, resource_type, status, capacity FROM resources WHERE id = $1',
      [resourceId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      name: row.name,
      type: row.resource_type,
      status: row.status,
      capacity: row.capacity
    };
  } catch (error) {
    logger.error('Failed to get resource details', { tenantId, resourceId, error });
    return null;
  }
}

async function checkInventoryPermission(
  fastify: FastifyInstance,
  tenantId: string,
  userId: string,
  action: string
): Promise<boolean> {
  try {
    // Simplified permission check - in production, implement proper RBAC
    const result = await fastify.db.queryForTenant<any>(
      tenantId,
      `
      SELECT COUNT(*) as count
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      JOIN role_permissions rp ON r.id = rp.role_id
      JOIN permissions p ON rp.permission_id = p.id
      WHERE ur.user_id = $1 
        AND p.resource_type = 'inventory'
        AND p.action = $2
      `,
      [userId, action]
    );

    return parseInt(result.rows[0]?.count || '0') > 0;
  } catch (error) {
    logger.error('Failed to check inventory permission', { tenantId, userId, action, error });
    return false; // Fail closed
  }
}

function groupStatsByPeriod(
  stats: any[],
  groupBy: string,
  startDate: Date,
  endDate: Date
): any[] {
  // Simplified implementation - in production, implement proper grouping logic
  const grouped: any[] = [];
  
  for (const stat of stats) {
    grouped.push({
      resourceId: stat.resourceId,
      period: formatPeriod(stat.period.startDate, groupBy),
      metrics: {
        totalSlots: stat.totalSlots,
        availableSlots: stat.availableSlots,
        bookedSlots: stat.bookedSlots,
        utilization: stat.utilizationRate,
        capacity: stat.totalSlots, // Assuming each slot represents 1 capacity unit
        bookings: stat.bookedSlots,
        revenue: stat.bookedSlots * 100 // Simplified revenue calculation
      }
    });
  }
  
  return grouped;
}

function calculateAggregatedStats(stats: any[]): {
  totalUtilization: number;
  averageUtilization: number;
  peakUtilization: number;
  totalCapacity: number;
  totalBookings: number;
  totalRevenue: number;
} {
  if (stats.length === 0) {
    return {
      totalUtilization: 0,
      averageUtilization: 0,
      peakUtilization: 0,
      totalCapacity: 0,
      totalBookings: 0,
      totalRevenue: 0
    };
  }

  const totalCapacity = stats.reduce((sum, stat) => sum + stat.totalSlots, 0);
  const totalBookings = stats.reduce((sum, stat) => sum + stat.bookedSlots, 0);
  const totalUtilization = totalCapacity > 0 ? (totalBookings / totalCapacity) * 100 : 0;
  const averageUtilization = stats.reduce((sum, stat) => sum + stat.utilizationRate, 0) / stats.length;
  const peakUtilization = Math.max(...stats.map(stat => stat.peakUtilization || stat.utilizationRate));
  const totalRevenue = totalBookings * 100; // Simplified calculation

  return {
    totalUtilization,
    averageUtilization,
    peakUtilization,
    totalCapacity,
    totalBookings,
    totalRevenue
  };
}

function formatPeriod(date: Date, groupBy: string): string {
  switch (groupBy) {
    case 'day':
      return date.toISOString().split('T')[0];
    case 'week':
      const weekStart = new Date(date);
      const day = weekStart.getDay();
      const diff = weekStart.getDate() - day;
      weekStart.setDate(diff);
      return weekStart.toISOString().split('T')[0];
    case 'month':
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    case 'resource':
      return 'all';
    default:
      return date.toISOString().split('T')[0];
  }
}

export default inventoryRoutes;