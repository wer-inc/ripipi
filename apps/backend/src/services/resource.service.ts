/**
 * Resource Management Service
 * Core business logic for resource CRUD operations with multi-language support,
 * service relationships, scheduling, and utilization tracking
 */

import { FastifyInstance } from 'fastify';
import { BaseRepository } from '../repositories/base.repository.js';
import { withTransaction, TransactionContext } from '../db/transaction.js';
import { logger } from '../config/logger.js';
import { 
  BadRequestError, 
  NotFoundError, 
  ConflictError,
  InternalServerError 
} from '../utils/errors.js';
import { 
  ResourceResponse,
  ResourceKind,
  CreateResourceRequest,
  UpdateResourceRequest,
  ResourceSearchQuery,
  ResourceAvailabilityRequest,
  ResourceAvailabilityResponse,
  ResourceScheduleRequest
} from '../schemas/resource.js';
import { BaseEntity, TenantContext, PaginatedResult } from '../types/database.js';

/**
 * Resource entity interface matching database schema
 */
interface ResourceEntity extends BaseEntity {
  kind: ResourceKind;
  name: Record<string, string>; // Multi-language name
  description?: Record<string, string>; // Multi-language description  
  capacity: number;
  active: boolean;
  deleted_at?: Date;
}

/**
 * Business hours entity
 */
interface BusinessHoursEntity extends BaseEntity {
  resource_id?: string;
  day_of_week: number;
  open_time: string;
  close_time: string;
  effective_from?: Date;
  effective_to?: Date;
}

/**
 * Resource operation result
 */
interface ResourceOperationResult {
  success: boolean;
  resource?: ResourceResponse;
  error?: string;
  code?: string;
}

/**
 * Resource search criteria for internal queries
 */
interface ResourceSearchCriteria {
  tenantId: string;
  name?: string;
  kind?: ResourceKind | ResourceKind[];
  active?: boolean;
  minCapacity?: number;
  maxCapacity?: number;
  serviceId?: string;
  groupId?: string;
  available?: boolean;
  availableAt?: Date;
  includeServices?: boolean;
  includeUtilization?: boolean;
  includeInactive?: boolean;
  search?: string;
  limit: number;
  offset: number;
  sortBy: string;
  sortOrder: 'ASC' | 'DESC';
}

/**
 * Resource repository extending base repository with resource-specific operations
 */
class ResourceRepository extends BaseRepository<ResourceEntity> {
  constructor() {
    super({
      tableName: 'resources',
      primaryKey: 'id',
      tenantKey: 'tenant_id',
      auditFields: true,
      optimisticLocking: false
    });
  }

  /**
   * Find resource with service relationships and utilization
   */
  async findByIdWithDetails(
    id: string, 
    tenantId: string, 
    includeServices = true,
    includeUtilization = false
  ): Promise<ResourceResponse | null> {
    try {
      let query = `
        SELECT 
          r.*
          ${includeServices ? `,
          COALESCE(
            json_agg(
              json_build_object(
                'serviceId', s.id,
                'serviceName', s.name,
                'durationMin', s.duration_min,
                'priceJpy', s.price_jpy,
                'active', sr.active
              ) ORDER BY s.name
            ) FILTER (WHERE s.id IS NOT NULL), 
            '[]'::json
          ) as available_services` : ''}
          ${includeUtilization ? `,
          (
            SELECT COUNT(*) 
            FROM timeslots ts 
            WHERE ts.resource_id = r.id 
              AND ts.tenant_id = r.tenant_id
              AND DATE(ts.start_at) = CURRENT_DATE
          ) as total_slots_today,
          (
            SELECT COUNT(*) 
            FROM timeslots ts 
            WHERE ts.resource_id = r.id 
              AND ts.tenant_id = r.tenant_id
              AND DATE(ts.start_at) = CURRENT_DATE
              AND ts.available_capacity < r.capacity
          ) as booked_slots_today` : ''}
        FROM resources r
        ${includeServices ? `
        LEFT JOIN service_resources sr ON r.id = sr.resource_id AND sr.tenant_id = r.tenant_id
        LEFT JOIN services s ON sr.service_id = s.id AND s.tenant_id = r.tenant_id AND s.deleted_at IS NULL
        ` : ''}
        WHERE r.id = $1 AND r.tenant_id = $2 AND r.deleted_at IS NULL
        ${includeServices ? 'GROUP BY r.id' : ''}
      `;

      const result = await this.fastify.db.query(query, [id, tenantId]);
      
      if (result.rows.length === 0) {
        return null;
      }

      return this.mapToResourceResponse(result.rows[0], includeUtilization);
    } catch (error) {
      logger.error('Failed to find resource with details', { id, tenantId, error });
      throw new InternalServerError('Failed to retrieve resource');
    }
  }

  /**
   * Search resources with advanced filtering
   */
  async searchResources(criteria: ResourceSearchCriteria): Promise<PaginatedResult<ResourceResponse>> {
    try {
      const conditions: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      // Base conditions
      conditions.push(`r.tenant_id = $${paramIndex++}`);
      params.push(criteria.tenantId);

      if (!criteria.includeInactive) {
        conditions.push('r.deleted_at IS NULL');
      }

      if (criteria.active !== undefined) {
        conditions.push(`r.active = $${paramIndex++}`);
        params.push(criteria.active);
      }

      if (criteria.name) {
        conditions.push(`(r.name->>'ja' ILIKE $${paramIndex} OR r.name->>'en' ILIKE $${paramIndex})`);
        params.push(`%${criteria.name}%`);
        paramIndex++;
      }

      if (criteria.search) {
        conditions.push(`(
          r.name->>'ja' ILIKE $${paramIndex} OR 
          r.name->>'en' ILIKE $${paramIndex} OR 
          r.description->>'ja' ILIKE $${paramIndex} OR 
          r.description->>'en' ILIKE $${paramIndex}
        )`);
        params.push(`%${criteria.search}%`);
        paramIndex++;
      }

      if (criteria.kind) {
        if (Array.isArray(criteria.kind)) {
          conditions.push(`r.kind = ANY($${paramIndex++})`);
          params.push(criteria.kind);
        } else {
          conditions.push(`r.kind = $${paramIndex++}`);
          params.push(criteria.kind);
        }
      }

      if (criteria.minCapacity !== undefined) {
        conditions.push(`r.capacity >= $${paramIndex++}`);
        params.push(criteria.minCapacity);
      }

      if (criteria.maxCapacity !== undefined) {
        conditions.push(`r.capacity <= $${paramIndex++}`);
        params.push(criteria.maxCapacity);
      }

      if (criteria.serviceId) {
        conditions.push(`EXISTS (
          SELECT 1 FROM service_resources sr 
          WHERE sr.resource_id = r.id 
            AND sr.service_id = $${paramIndex++}
            AND sr.active = true
        )`);
        params.push(criteria.serviceId);
      }

      if (criteria.groupId) {
        conditions.push(`EXISTS (
          SELECT 1 FROM resource_group_members rgm
          JOIN resource_groups rg ON rgm.group_id = rg.id
          WHERE rgm.resource_id = r.id 
            AND rg.id = $${paramIndex++}
            AND rg.tenant_id = r.tenant_id
        )`);
        params.push(criteria.groupId);
      }

      if (criteria.available !== undefined && criteria.available) {
        conditions.push(`r.active = true`);
      }

      if (criteria.availableAt) {
        conditions.push(`EXISTS (
          SELECT 1 FROM timeslots ts
          WHERE ts.resource_id = r.id
            AND ts.tenant_id = r.tenant_id
            AND ts.start_at <= $${paramIndex}
            AND ts.end_at > $${paramIndex}
            AND ts.available_capacity > 0
        )`);
        params.push(criteria.availableAt);
        paramIndex++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Build sort clause
      const sortField = this.mapSortField(criteria.sortBy);
      const sortOrder = criteria.sortOrder || 'ASC';
      const orderClause = `ORDER BY ${sortField} ${sortOrder}`;

      // Count query
      const countQuery = `
        SELECT COUNT(*) as total
        FROM resources r
        ${whereClause}
      `;

      // Data query
      const dataQuery = `
        SELECT 
          r.*
          ${criteria.includeServices ? `,
          COALESCE(
            json_agg(
              json_build_object(
                'serviceId', s.id,
                'serviceName', s.name,
                'durationMin', s.duration_min,
                'priceJpy', s.price_jpy,
                'active', sr.active
              ) ORDER BY s.name
            ) FILTER (WHERE s.id IS NOT NULL), 
            '[]'::json
          ) as available_services` : ''}
          ${criteria.includeUtilization ? `,
          (
            SELECT COUNT(*) 
            FROM timeslots ts 
            WHERE ts.resource_id = r.id 
              AND ts.tenant_id = r.tenant_id
              AND DATE(ts.start_at) = CURRENT_DATE
          ) as total_slots_today,
          (
            SELECT COUNT(*) 
            FROM timeslots ts 
            WHERE ts.resource_id = r.id 
              AND ts.tenant_id = r.tenant_id
              AND DATE(ts.start_at) = CURRENT_DATE
              AND ts.available_capacity < r.capacity
          ) as booked_slots_today` : ''}
        FROM resources r
        ${criteria.includeServices ? `
        LEFT JOIN service_resources sr ON r.id = sr.resource_id AND sr.tenant_id = r.tenant_id
        LEFT JOIN services s ON sr.service_id = s.id AND s.tenant_id = r.tenant_id AND s.deleted_at IS NULL
        ` : ''}
        ${whereClause}
        ${criteria.includeServices ? 'GROUP BY r.id' : ''}
        ${orderClause}
        LIMIT $${paramIndex++} OFFSET $${paramIndex++}
      `;

      params.push(criteria.limit, criteria.offset);

      const [countResult, dataResult] = await Promise.all([
        this.fastify.db.query(countQuery, params.slice(0, -2)),
        this.fastify.db.query(dataQuery, params)
      ]);

      const total = parseInt(countResult.rows[0]?.total || '0', 10);

      return {
        data: dataResult.rows.map(row => this.mapToResourceResponse(row, criteria.includeUtilization)),
        total,
        limit: criteria.limit,
        offset: criteria.offset,
        hasMore: criteria.offset + dataResult.rows.length < total
      };
    } catch (error) {
      logger.error('Failed to search resources', { criteria, error });
      throw new InternalServerError('Failed to search resources');
    }
  }

  /**
   * Map database row to ResourceResponse
   */
  private mapToResourceResponse(row: any, includeUtilization = false): ResourceResponse {
    const resource: ResourceResponse = {
      id: row.id,
      tenantId: row.tenant_id,
      kind: row.kind,
      name: row.name || {},
      description: row.description || {},
      capacity: row.capacity,
      active: row.active,
      metadata: row.metadata || {},
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      deletedAt: row.deleted_at?.toISOString(),
      availableServices: row.available_services || []
    };

    if (includeUtilization && row.total_slots_today !== undefined) {
      const totalSlots = parseInt(row.total_slots_today || '0', 10);
      const bookedSlots = parseInt(row.booked_slots_today || '0', 10);
      
      resource.currentUtilization = {
        totalSlots,
        bookedSlots,
        utilizationRate: totalSlots > 0 ? Math.round((bookedSlots / totalSlots) * 100) : 0
      };
    }

    return resource;
  }

  /**
   * Map sort field for security
   */
  private mapSortField(sortBy: string): string {
    const fieldMap: Record<string, string> = {
      name: "r.name->>'ja'",
      kind: 'r.kind',
      capacity: 'r.capacity',
      createdAt: 'r.created_at',
      updatedAt: 'r.updated_at'
    };
    return fieldMap[sortBy] || "r.name->>'ja'";
  }
}

/**
 * Main Resource management service
 */
export class ResourceService {
  private repository: ResourceRepository;

  constructor(private fastify: FastifyInstance) {
    this.repository = new ResourceRepository();
    // Inject fastify instance for database access
    (this.repository as any).fastify = fastify;
  }

  /**
   * Create a new resource
   */
  async createResource(
    request: CreateResourceRequest,
    tenantId: string,
    context: TenantContext
  ): Promise<ResourceOperationResult> {
    try {
      logger.info('Creating resource', { tenantId, name: request.name, kind: request.kind });

      return withTransaction(async (ctx) => {
        // Validate resource name uniqueness within kind
        await this.validateResourceNameUniqueness(request.name, request.kind, tenantId);

        // Create resource data
        const resourceData = {
          tenant_id: tenantId,
          kind: request.kind,
          name: request.name,
          description: request.description || {},
          capacity: request.capacity,
          active: request.active !== false,
          metadata: request.metadata || {}
        };

        // Insert resource
        const query = `
          INSERT INTO resources (tenant_id, kind, name, description, capacity, active, metadata, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
          RETURNING *
        `;

        const result = await ctx.query(query, [
          resourceData.tenant_id,
          resourceData.kind,
          JSON.stringify(resourceData.name),
          JSON.stringify(resourceData.description),
          resourceData.capacity,
          resourceData.active,
          JSON.stringify(resourceData.metadata)
        ]);

        const resource = result.rows[0];

        // Create service relationships if provided
        if (request.serviceIds && request.serviceIds.length > 0) {
          await this.createResourceServiceRelationships(
            resource.id,
            tenantId,
            request.serviceIds,
            ctx
          );
        }

        // Set business hours if provided
        if (request.businessHours && request.businessHours.length > 0) {
          await this.setResourceBusinessHours(
            resource.id,
            tenantId,
            request.businessHours,
            ctx
          );
        }

        // Add to groups if provided
        if (request.groupIds && request.groupIds.length > 0) {
          await this.addResourceToGroups(
            resource.id,
            request.groupIds,
            ctx
          );
        }

        logger.info('Resource created successfully', { 
          resourceId: resource.id, 
          tenantId 
        });

        // Fetch complete resource with relationships
        const completeResource = await this.repository.findByIdWithDetails(resource.id, tenantId, true, false);

        return {
          success: true,
          resource: completeResource!
        };
      });
    } catch (error) {
      logger.error('Failed to create resource', { tenantId, error });

      if (error instanceof BadRequestError || error instanceof ConflictError) {
        return {
          success: false,
          error: error.message,
          code: error.code
        };
      }

      return {
        success: false,
        error: 'Failed to create resource',
        code: 'RESOURCE_CREATION_ERROR'
      };
    }
  }

  /**
   * Get resource by ID
   */
  async getResourceById(
    id: string,
    tenantId: string,
    includeServices = true,
    includeUtilization = false
  ): Promise<ResourceResponse | null> {
    try {
      logger.debug('Getting resource by ID', { id, tenantId });
      return await this.repository.findByIdWithDetails(id, tenantId, includeServices, includeUtilization);
    } catch (error) {
      logger.error('Failed to get resource by ID', { id, tenantId, error });
      throw new InternalServerError('Failed to retrieve resource');
    }
  }

  /**
   * Search resources
   */
  async searchResources(query: ResourceSearchQuery, tenantId: string): Promise<any> {
    try {
      const criteria: ResourceSearchCriteria = {
        tenantId,
        name: query.name,
        kind: query.kind,
        active: query.active,
        minCapacity: query.minCapacity,
        maxCapacity: query.maxCapacity,
        serviceId: query.serviceId,
        groupId: query.groupId,
        available: query.available,
        availableAt: query.availableAt ? new Date(query.availableAt) : undefined,
        includeServices: query.includeServices,
        includeUtilization: query.includeUtilization,
        includeInactive: query.includeInactive,
        search: query.search,
        limit: Math.min(query.limit || 50, 100),
        offset: query.offset || 0,
        sortBy: query.sortBy || 'name',
        sortOrder: (query.sortOrder?.toUpperCase() as 'ASC' | 'DESC') || 'ASC'
      };

      const result = await this.repository.searchResources(criteria);

      // Calculate statistics if requested
      let statistics;
      if (result.data.length > 0) {
        const kindCounts = result.data.reduce((acc, r) => {
          acc[r.kind] = (acc[r.kind] || 0) + 1;
          return acc;
        }, {} as Record<ResourceKind, number>);

        const capacities = result.data.map(r => r.capacity);
        const utilizations = result.data
          .filter(r => r.currentUtilization)
          .map(r => r.currentUtilization!.utilizationRate);
        
        statistics = {
          totalByKind: kindCounts,
          totalActive: result.data.filter(r => r.active).length,
          totalInactive: result.data.filter(r => !r.active).length,
          totalCapacity: capacities.reduce((a, b) => a + b, 0),
          averageCapacity: capacities.reduce((a, b) => a + b, 0) / capacities.length,
          ...(utilizations.length > 0 && {
            utilizationStats: {
              averageUtilization: utilizations.reduce((a, b) => a + b, 0) / utilizations.length,
              highestUtilization: Math.max(...utilizations),
              lowestUtilization: Math.min(...utilizations)
            }
          })
        };
      }

      return {
        ...result,
        statistics
      };
    } catch (error) {
      logger.error('Failed to search resources', { query, tenantId, error });
      throw new InternalServerError('Failed to search resources');
    }
  }

  /**
   * Update resource
   */
  async updateResource(
    id: string,
    request: UpdateResourceRequest,
    tenantId: string,
    context: TenantContext
  ): Promise<ResourceOperationResult> {
    try {
      logger.info('Updating resource', { id, tenantId });

      return withTransaction(async (ctx) => {
        // Check if resource exists
        const existingResource = await this.repository.findById(id, tenantId);
        if (!existingResource) {
          return {
            success: false,
            error: 'Resource not found',
            code: 'RESOURCE_NOT_FOUND'
          };
        }

        // Validate name uniqueness if name or kind is being changed
        if (request.name || request.kind) {
          await this.validateResourceNameUniqueness(
            request.name || existingResource.name, 
            request.kind || existingResource.kind, 
            tenantId, 
            id
          );
        }

        // Build update data
        const updateData: any = {};
        if (request.kind) updateData.kind = request.kind;
        if (request.name) updateData.name = JSON.stringify(request.name);
        if (request.description) updateData.description = JSON.stringify(request.description);
        if (request.capacity !== undefined) updateData.capacity = request.capacity;
        if (request.active !== undefined) updateData.active = request.active;
        if (request.metadata) updateData.metadata = JSON.stringify(request.metadata);

        updateData.updated_at = 'NOW()';

        if (Object.keys(updateData).length === 1) { // Only updated_at
          return {
            success: false,
            error: 'No fields to update',
            code: 'NO_UPDATES_PROVIDED'
          };
        }

        // Build update query
        const setClauses = Object.keys(updateData)
          .map((key, index) => `${key} = $${index + 3}`)
          .join(', ');

        const updateQuery = `
          UPDATE resources
          SET ${setClauses}
          WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
          RETURNING *
        `;

        const result = await ctx.query(updateQuery, [
          id, 
          tenantId, 
          ...Object.values(updateData)
        ]);

        if (result.rows.length === 0) {
          return {
            success: false,
            error: 'Resource not found or already deleted',
            code: 'RESOURCE_NOT_FOUND'
          };
        }

        // Update service relationships if provided
        if (request.serviceIds !== undefined) {
          await this.updateResourceServiceRelationships(
            id,
            tenantId,
            request.serviceIds,
            ctx
          );
        }

        // Update business hours if provided
        if (request.businessHours !== undefined) {
          await this.updateResourceBusinessHours(
            id,
            tenantId,
            request.businessHours,
            ctx
          );
        }

        // Update group memberships if provided
        if (request.groupIds !== undefined) {
          await this.updateResourceGroupMemberships(
            id,
            request.groupIds,
            ctx
          );
        }

        logger.info('Resource updated successfully', { id, tenantId });

        // Fetch updated resource with relationships
        const updatedResource = await this.repository.findByIdWithDetails(id, tenantId, true, false);

        return {
          success: true,
          resource: updatedResource!
        };
      });
    } catch (error) {
      logger.error('Failed to update resource', { id, tenantId, error });

      if (error instanceof BadRequestError || error instanceof ConflictError) {
        return {
          success: false,
          error: error.message,
          code: error.code
        };
      }

      return {
        success: false,
        error: 'Failed to update resource',
        code: 'RESOURCE_UPDATE_ERROR'
      };
    }
  }

  /**
   * Delete resource (soft delete)
   */
  async deleteResource(
    id: string,
    tenantId: string,
    context: TenantContext
  ): Promise<ResourceOperationResult> {
    try {
      logger.info('Deleting resource', { id, tenantId });

      return withTransaction(async (ctx) => {
        // Check if resource has active bookings
        const bookingCheckQuery = `
          SELECT COUNT(*) as count
          FROM bookings b
          JOIN booking_items bi ON b.id = bi.booking_id
          WHERE bi.resource_id = $1 
            AND b.tenant_id = $2 
            AND b.status IN ('tentative', 'confirmed')
            AND b.start_at > NOW()
        `;

        const bookingResult = await ctx.query(bookingCheckQuery, [id, tenantId]);
        const activeBookings = parseInt(bookingResult.rows[0]?.count || '0', 10);

        if (activeBookings > 0) {
          return {
            success: false,
            error: `Cannot delete resource with ${activeBookings} active bookings`,
            code: 'RESOURCE_HAS_ACTIVE_BOOKINGS'
          };
        }

        // Soft delete resource
        const deleteQuery = `
          UPDATE resources
          SET deleted_at = NOW(), updated_at = NOW(), active = false
          WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
          RETURNING *
        `;

        const result = await ctx.query(deleteQuery, [id, tenantId]);

        if (result.rows.length === 0) {
          return {
            success: false,
            error: 'Resource not found',
            code: 'RESOURCE_NOT_FOUND'
          };
        }

        // Deactivate service-resource relationships
        await ctx.query(`
          UPDATE service_resources 
          SET active = false 
          WHERE resource_id = $1 AND tenant_id = $2
        `, [id, tenantId]);

        // Remove from groups
        await ctx.query(`
          DELETE FROM resource_group_members 
          WHERE resource_id = $1
        `, [id]);

        logger.info('Resource deleted successfully', { id, tenantId });

        return {
          success: true,
          resource: this.mapToResourceResponse(result.rows[0])
        };
      });
    } catch (error) {
      logger.error('Failed to delete resource', { id, tenantId, error });

      return {
        success: false,
        error: 'Failed to delete resource',
        code: 'RESOURCE_DELETION_ERROR'
      };
    }
  }

  /**
   * Get resource availability
   */
  async getResourceAvailability(
    id: string,
    request: ResourceAvailabilityRequest,
    tenantId: string
  ): Promise<ResourceAvailabilityResponse> {
    try {
      const resource = await this.getResourceById(id, tenantId, false, false);
      if (!resource) {
        throw new NotFoundError(`Resource ${id} not found`);
      }

      // Query available slots for this resource
      let query = `
        SELECT 
          ts.start_at,
          ts.end_at,
          ts.available_capacity
          ${request.serviceId ? `,
          CASE WHEN sr.service_id IS NOT NULL THEN 
            json_build_array(sr.service_id)
          ELSE 
            '[]'::json
          END as service_ids` : ''}
        FROM timeslots ts
        ${request.serviceId ? `
        LEFT JOIN service_resources sr ON ts.resource_id = sr.resource_id 
          AND sr.service_id = $5 
          AND sr.active = true
          AND sr.tenant_id = $2
        ` : ''}
        WHERE ts.resource_id = $1
          AND ts.tenant_id = $2
          AND ts.start_at >= $3
          AND ts.end_at <= $4
          AND ts.available_capacity >= ${request.capacity || 1}
          ${request.serviceId ? 'AND sr.service_id IS NOT NULL' : ''}
        ORDER BY ts.start_at
      `;

      const params = [id, tenantId, request.startDate, request.endDate];
      if (request.serviceId) {
        params.push(request.serviceId);
      }

      const result = await this.fastify.db.query(query, params);

      const availableSlots = result.rows.map(row => ({
        startTime: row.start_at.toISOString(),
        endTime: row.end_at.toISOString(),
        availableCapacity: row.available_capacity,
        ...(request.serviceId && { serviceIds: row.service_ids || [] })
      }));

      // Calculate utilization
      const totalSlotsQuery = `
        SELECT COUNT(*) as total
        FROM timeslots
        WHERE resource_id = $1 AND tenant_id = $2 
          AND start_at >= $3 AND end_at <= $4
      `;

      const totalResult = await this.fastify.db.query(totalSlotsQuery, [id, tenantId, request.startDate, request.endDate]);
      const totalSlots = parseInt(totalResult.rows[0]?.total || '0', 10);
      const availableSlotCount = availableSlots.length;
      const utilizationRate = totalSlots > 0 ? Math.round(((totalSlots - availableSlotCount) / totalSlots) * 100) : 0;

      return {
        resourceId: id,
        resourceName: resource.name,
        resourceKind: resource.kind,
        totalCapacity: resource.capacity,
        availableSlots,
        totalAvailableSlots: availableSlotCount,
        utilizationRate,
        metadata: {
          timestamp: new Date().toISOString(),
          version: 'v1'
        }
      };
    } catch (error) {
      logger.error('Failed to get resource availability', { id, tenantId, error });
      throw new InternalServerError('Failed to get resource availability');
    }
  }

  /**
   * Update resource schedule (business hours, holidays, time offs)
   */
  async updateResourceSchedule(
    id: string,
    request: ResourceScheduleRequest,
    tenantId: string,
    context: TenantContext
  ): Promise<ResourceOperationResult> {
    try {
      logger.info('Updating resource schedule', { id, tenantId });

      const resource = await this.getResourceById(id, tenantId, false, false);
      if (!resource) {
        return {
          success: false,
          error: 'Resource not found',
          code: 'RESOURCE_NOT_FOUND'
        };
      }

      return withTransaction(async (ctx) => {
        // Update business hours
        if (request.businessHours !== undefined) {
          await this.updateResourceBusinessHours(id, tenantId, request.businessHours, ctx);
        }

        // Update holidays
        if (request.holidays !== undefined) {
          await this.updateResourceHolidays(id, tenantId, request.holidays, ctx);
        }

        // Update time offs
        if (request.timeOffs !== undefined) {
          await this.updateResourceTimeOffs(id, tenantId, request.timeOffs, ctx);
        }

        logger.info('Resource schedule updated successfully', { id, tenantId });

        return {
          success: true,
          resource: resource
        };
      });
    } catch (error) {
      logger.error('Failed to update resource schedule', { id, tenantId, error });

      return {
        success: false,
        error: 'Failed to update resource schedule',
        code: 'RESOURCE_SCHEDULE_UPDATE_ERROR'
      };
    }
  }

  // Private helper methods

  /**
   * Map database row to ResourceResponse
   */
  private mapToResourceResponse(row: any, includeUtilization = false): ResourceResponse {
    const resource: ResourceResponse = {
      id: row.id,
      tenantId: row.tenant_id,
      kind: row.kind,
      name: row.name || {},
      description: row.description || {},
      capacity: row.capacity,
      active: row.active,
      metadata: row.metadata || {},
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      deletedAt: row.deleted_at?.toISOString(),
      availableServices: row.available_services || []
    };

    if (includeUtilization && row.total_slots_today !== undefined) {
      const totalSlots = parseInt(row.total_slots_today || '0', 10);
      const bookedSlots = parseInt(row.booked_slots_today || '0', 10);
      
      resource.currentUtilization = {
        totalSlots,
        bookedSlots,
        utilizationRate: totalSlots > 0 ? Math.round((bookedSlots / totalSlots) * 100) : 0
      };
    }

    return resource;
  }

  /**
   * Validate resource name uniqueness within kind
   */
  private async validateResourceNameUniqueness(
    name: Record<string, string>,
    kind: ResourceKind,
    tenantId: string,
    excludeId?: string
  ): Promise<void> {
    const query = `
      SELECT id FROM resources 
      WHERE tenant_id = $1 
        AND kind = $2
        AND (name->>'ja' = $3 OR name->>'en' = $4)
        AND deleted_at IS NULL
        ${excludeId ? 'AND id != $5' : ''}
    `;

    const params = [tenantId, kind, name.ja || '', name.en || ''];
    if (excludeId) params.push(excludeId);

    const result = await this.fastify.db.query(query, params);
    
    if (result.rows.length > 0) {
      throw new ConflictError(`Resource name already exists for kind ${kind}`);
    }
  }

  /**
   * Create resource-service relationships
   */
  private async createResourceServiceRelationships(
    resourceId: string,
    tenantId: string,
    serviceIds: string[],
    ctx: TransactionContext
  ): Promise<void> {
    if (serviceIds.length === 0) return;

    // Validate services exist
    const serviceQuery = `
      SELECT id FROM services 
      WHERE tenant_id = $1 AND id = ANY($2) AND deleted_at IS NULL
    `;
    
    const serviceResult = await ctx.query(serviceQuery, [tenantId, serviceIds]);
    const validServiceIds = serviceResult.rows.map(s => s.id);

    if (validServiceIds.length !== serviceIds.length) {
      throw new BadRequestError('One or more services not found');
    }

    // Insert relationships
    const values = validServiceIds.map((serviceId, index) => 
      `($${index + 3}, $1, $2, true, NOW())`
    ).join(', ');

    const insertQuery = `
      INSERT INTO service_resources (service_id, resource_id, tenant_id, active, created_at)
      VALUES ${values}
      ON CONFLICT (tenant_id, service_id, resource_id) 
      DO UPDATE SET active = true, updated_at = NOW()
    `;

    await ctx.query(insertQuery, [resourceId, tenantId, ...validServiceIds]);
  }

  /**
   * Update resource-service relationships
   */
  private async updateResourceServiceRelationships(
    resourceId: string,
    tenantId: string,
    serviceIds: string[],
    ctx: TransactionContext
  ): Promise<void> {
    // Remove existing relationships
    await ctx.query(
      `DELETE FROM service_resources WHERE resource_id = $1 AND tenant_id = $2`,
      [resourceId, tenantId]
    );

    // Add new relationships
    if (serviceIds.length > 0) {
      await this.createResourceServiceRelationships(resourceId, tenantId, serviceIds, ctx);
    }
  }

  /**
   * Set resource business hours
   */
  private async setResourceBusinessHours(
    resourceId: string,
    tenantId: string,
    businessHours: Array<{
      dayOfWeek: number;
      openTime: string;
      closeTime: string;
      effectiveFrom?: string;
      effectiveTo?: string;
    }>,
    ctx: TransactionContext
  ): Promise<void> {
    if (businessHours.length === 0) return;

    const values = businessHours.map((hours, index) => 
      `($1, $2, $${index * 5 + 4}, $${index * 5 + 5}, $${index * 5 + 6}, $${index * 5 + 7}, $${index * 5 + 8})`
    ).join(', ');

    const params = [tenantId, resourceId];
    businessHours.forEach(hours => {
      params.push(
        hours.dayOfWeek,
        hours.openTime,
        hours.closeTime,
        hours.effectiveFrom || null,
        hours.effectiveTo || null
      );
    });

    const insertQuery = `
      INSERT INTO business_hours (tenant_id, resource_id, day_of_week, open_time, close_time, effective_from, effective_to)
      VALUES ${values}
      ON CONFLICT (tenant_id, resource_id, day_of_week) 
      DO UPDATE SET open_time = EXCLUDED.open_time, close_time = EXCLUDED.close_time,
                    effective_from = EXCLUDED.effective_from, effective_to = EXCLUDED.effective_to
    `;

    await ctx.query(insertQuery, params);
  }

  /**
   * Update resource business hours
   */
  private async updateResourceBusinessHours(
    resourceId: string,
    tenantId: string,
    businessHours: Array<{
      dayOfWeek: number;
      openTime: string;
      closeTime: string;
      effectiveFrom?: string;
      effectiveTo?: string;
    }>,
    ctx: TransactionContext
  ): Promise<void> {
    // Remove existing business hours for this resource
    await ctx.query(
      `DELETE FROM business_hours WHERE resource_id = $1 AND tenant_id = $2`,
      [resourceId, tenantId]
    );

    // Set new business hours
    if (businessHours.length > 0) {
      await this.setResourceBusinessHours(resourceId, tenantId, businessHours, ctx);
    }
  }

  /**
   * Add resource to groups
   */
  private async addResourceToGroups(
    resourceId: string,
    groupIds: string[],
    ctx: TransactionContext
  ): Promise<void> {
    if (groupIds.length === 0) return;

    const values = groupIds.map((groupId, index) => 
      `($${index + 2}, $1)`
    ).join(', ');

    const insertQuery = `
      INSERT INTO resource_group_members (group_id, resource_id)
      VALUES ${values}
      ON CONFLICT (group_id, resource_id) DO NOTHING
    `;

    await ctx.query(insertQuery, [resourceId, ...groupIds]);
  }

  /**
   * Update resource group memberships
   */
  private async updateResourceGroupMemberships(
    resourceId: string,
    groupIds: string[],
    ctx: TransactionContext
  ): Promise<void> {
    // Remove existing group memberships
    await ctx.query(
      `DELETE FROM resource_group_members WHERE resource_id = $1`,
      [resourceId]
    );

    // Add new group memberships
    if (groupIds.length > 0) {
      await this.addResourceToGroups(resourceId, groupIds, ctx);
    }
  }

  /**
   * Update resource holidays
   */
  private async updateResourceHolidays(
    resourceId: string,
    tenantId: string,
    holidays: Array<{ date: string; name: string }>,
    ctx: TransactionContext
  ): Promise<void> {
    // Remove existing holidays for this resource
    await ctx.query(
      `DELETE FROM holidays WHERE resource_id = $1 AND tenant_id = $2`,
      [resourceId, tenantId]
    );

    if (holidays.length > 0) {
      const values = holidays.map((holiday, index) => 
        `($1, $2, $${index * 2 + 3}, $${index * 2 + 4})`
      ).join(', ');

      const params = [tenantId, resourceId];
      holidays.forEach(holiday => {
        params.push(holiday.date, holiday.name);
      });

      const insertQuery = `
        INSERT INTO holidays (tenant_id, resource_id, date, name)
        VALUES ${values}
      `;

      await ctx.query(insertQuery, params);
    }
  }

  /**
   * Update resource time offs
   */
  private async updateResourceTimeOffs(
    resourceId: string,
    tenantId: string,
    timeOffs: Array<{ startAt: string; endAt: string; reason: string }>,
    ctx: TransactionContext
  ): Promise<void> {
    // Remove future time offs for this resource
    await ctx.query(
      `DELETE FROM resource_time_offs WHERE resource_id = $1 AND tenant_id = $2 AND start_at > NOW()`,
      [resourceId, tenantId]
    );

    if (timeOffs.length > 0) {
      const values = timeOffs.map((timeOff, index) => 
        `($1, $2, $${index * 3 + 3}, $${index * 3 + 4}, $${index * 3 + 5})`
      ).join(', ');

      const params = [tenantId, resourceId];
      timeOffs.forEach(timeOff => {
        params.push(timeOff.startAt, timeOff.endAt, timeOff.reason);
      });

      const insertQuery = `
        INSERT INTO resource_time_offs (tenant_id, resource_id, start_at, end_at, reason)
        VALUES ${values}
      `;

      await ctx.query(insertQuery, params);
    }
  }
}

export default ResourceService;