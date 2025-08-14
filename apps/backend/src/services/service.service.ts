/**
 * Service Management Service
 * Core business logic for service CRUD operations with multi-language support,
 * resource relationships, and comprehensive validation
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
  ServiceResponse,
  CreateServiceRequest,
  UpdateServiceRequest,
  ServiceSearchQuery,
  ServiceAvailabilityRequest,
  ServiceAvailabilityResponse
} from '../schemas/service.js';
import { BaseEntity, TenantContext, PaginatedResult } from '../types/database.js';

/**
 * Service entity interface matching database schema
 */
interface ServiceEntity extends BaseEntity {
  name: Record<string, string>; // Multi-language name
  description?: Record<string, string>; // Multi-language description  
  duration_min: number;
  price_jpy: number;
  buffer_before_min: number;
  buffer_after_min: number;
  active: boolean;
  deleted_at?: Date;
}

/**
 * Service-Resource relationship entity
 */
interface ServiceResourceEntity extends BaseEntity {
  service_id: string;
  resource_id: string;
  active: boolean;
}

/**
 * Service operation result
 */
interface ServiceOperationResult {
  success: boolean;
  service?: ServiceResponse;
  error?: string;
  code?: string;
}

/**
 * Service search criteria for internal queries
 */
interface ServiceSearchCriteria {
  tenantId: string;
  name?: string;
  active?: boolean;
  minPrice?: number;
  maxPrice?: number;
  minDuration?: number;
  maxDuration?: number;
  resourceId?: string;
  includeResources?: boolean;
  includeInactive?: boolean;
  search?: string;
  limit: number;
  offset: number;
  sortBy: string;
  sortOrder: 'ASC' | 'DESC';
}

/**
 * Service repository extending base repository with service-specific operations
 */
class ServiceRepository extends BaseRepository<ServiceEntity> {
  constructor() {
    super({
      tableName: 'services',
      primaryKey: 'id',
      tenantKey: 'tenant_id',
      auditFields: true,
      optimisticLocking: false
    });
  }

  /**
   * Find service with resource relationships
   */
  async findByIdWithResources(id: string, tenantId: string): Promise<ServiceResponse | null> {
    try {
      const query = `
        SELECT 
          s.*,
          COALESCE(
            json_agg(
              json_build_object(
                'resourceId', r.id,
                'resourceName', r.name,
                'resourceKind', r.kind,
                'capacity', r.capacity,
                'active', sr.active
              ) ORDER BY r.name
            ) FILTER (WHERE r.id IS NOT NULL), 
            '[]'::json
          ) as available_resources
        FROM services s
        LEFT JOIN service_resources sr ON s.id = sr.service_id AND sr.tenant_id = s.tenant_id
        LEFT JOIN resources r ON sr.resource_id = r.id AND r.tenant_id = s.tenant_id AND r.deleted_at IS NULL
        WHERE s.id = $1 AND s.tenant_id = $2 AND s.deleted_at IS NULL
        GROUP BY s.id
      `;

      const result = await this.fastify.db.query(query, [id, tenantId]);
      
      if (result.rows.length === 0) {
        return null;
      }

      return this.mapToServiceResponse(result.rows[0]);
    } catch (error) {
      logger.error('Failed to find service with resources', { id, tenantId, error });
      throw new InternalServerError('Failed to retrieve service');
    }
  }

  /**
   * Search services with advanced filtering
   */
  async searchServices(criteria: ServiceSearchCriteria): Promise<PaginatedResult<ServiceResponse>> {
    try {
      const conditions: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      // Base conditions
      conditions.push(`s.tenant_id = $${paramIndex++}`);
      params.push(criteria.tenantId);

      if (!criteria.includeInactive) {
        conditions.push('s.deleted_at IS NULL');
      }

      if (criteria.active !== undefined) {
        conditions.push(`s.active = $${paramIndex++}`);
        params.push(criteria.active);
      }

      if (criteria.name) {
        conditions.push(`(s.name->>'ja' ILIKE $${paramIndex} OR s.name->>'en' ILIKE $${paramIndex})`);
        params.push(`%${criteria.name}%`);
        paramIndex++;
      }

      if (criteria.search) {
        conditions.push(`(
          s.name->>'ja' ILIKE $${paramIndex} OR 
          s.name->>'en' ILIKE $${paramIndex} OR 
          s.description->>'ja' ILIKE $${paramIndex} OR 
          s.description->>'en' ILIKE $${paramIndex}
        )`);
        params.push(`%${criteria.search}%`);
        paramIndex++;
      }

      if (criteria.minPrice !== undefined) {
        conditions.push(`s.price_jpy >= $${paramIndex++}`);
        params.push(criteria.minPrice);
      }

      if (criteria.maxPrice !== undefined) {
        conditions.push(`s.price_jpy <= $${paramIndex++}`);
        params.push(criteria.maxPrice);
      }

      if (criteria.minDuration !== undefined) {
        conditions.push(`s.duration_min >= $${paramIndex++}`);
        params.push(criteria.minDuration);
      }

      if (criteria.maxDuration !== undefined) {
        conditions.push(`s.duration_min <= $${paramIndex++}`);
        params.push(criteria.maxDuration);
      }

      if (criteria.resourceId) {
        conditions.push(`EXISTS (
          SELECT 1 FROM service_resources sr 
          WHERE sr.service_id = s.id 
            AND sr.resource_id = $${paramIndex++}
            AND sr.active = true
        )`);
        params.push(criteria.resourceId);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Build sort clause
      const sortField = this.mapSortField(criteria.sortBy);
      const sortOrder = criteria.sortOrder || 'ASC';
      const orderClause = `ORDER BY ${sortField} ${sortOrder}`;

      // Count query
      const countQuery = `
        SELECT COUNT(*) as total
        FROM services s
        ${whereClause}
      `;

      // Data query
      const dataQuery = `
        SELECT 
          s.*
          ${criteria.includeResources ? `,
          COALESCE(
            json_agg(
              json_build_object(
                'resourceId', r.id,
                'resourceName', r.name,
                'resourceKind', r.kind,
                'capacity', r.capacity,
                'active', sr.active
              ) ORDER BY r.name
            ) FILTER (WHERE r.id IS NOT NULL), 
            '[]'::json
          ) as available_resources` : ''}
        FROM services s
        ${criteria.includeResources ? `
        LEFT JOIN service_resources sr ON s.id = sr.service_id AND sr.tenant_id = s.tenant_id
        LEFT JOIN resources r ON sr.resource_id = r.id AND r.tenant_id = s.tenant_id AND r.deleted_at IS NULL
        ` : ''}
        ${whereClause}
        ${criteria.includeResources ? 'GROUP BY s.id' : ''}
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
        data: dataResult.rows.map(row => this.mapToServiceResponse(row)),
        total,
        limit: criteria.limit,
        offset: criteria.offset,
        hasMore: criteria.offset + dataResult.rows.length < total
      };
    } catch (error) {
      logger.error('Failed to search services', { criteria, error });
      throw new InternalServerError('Failed to search services');
    }
  }

  /**
   * Map database row to ServiceResponse
   */
  private mapToServiceResponse(row: any): ServiceResponse {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name || {},
      description: row.description || {},
      durationMin: row.duration_min,
      priceJpy: row.price_jpy,
      bufferBeforeMin: row.buffer_before_min,
      bufferAfterMin: row.buffer_after_min,
      active: row.active,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      deletedAt: row.deleted_at?.toISOString(),
      availableResources: row.available_resources || [],
      metadata: row.metadata || {}
    };
  }

  /**
   * Map sort field for security
   */
  private mapSortField(sortBy: string): string {
    const fieldMap: Record<string, string> = {
      name: "s.name->>'ja'",
      priceJpy: 's.price_jpy',
      durationMin: 's.duration_min',
      createdAt: 's.created_at',
      updatedAt: 's.updated_at'
    };
    return fieldMap[sortBy] || "s.name->>'ja'";
  }
}

/**
 * Main Service management service
 */
export class ServiceService {
  private repository: ServiceRepository;

  constructor(private fastify: FastifyInstance) {
    this.repository = new ServiceRepository();
    // Inject fastify instance for database access
    (this.repository as any).fastify = fastify;
  }

  /**
   * Create a new service
   */
  async createService(
    request: CreateServiceRequest,
    tenantId: string,
    context: TenantContext
  ): Promise<ServiceOperationResult> {
    try {
      logger.info('Creating service', { tenantId, name: request.name });

      return withTransaction(async (ctx) => {
        // Validate service name uniqueness
        await this.validateServiceNameUniqueness(request.name, tenantId);

        // Create service data
        const serviceData = {
          tenant_id: tenantId,
          name: request.name,
          description: request.description || {},
          duration_min: request.durationMin,
          price_jpy: request.priceJpy,
          buffer_before_min: request.bufferBeforeMin || 0,
          buffer_after_min: request.bufferAfterMin || 0,
          active: request.active !== false,
          metadata: request.metadata || {}
        };

        // Insert service
        const query = `
          INSERT INTO services (tenant_id, name, description, duration_min, price_jpy, 
                               buffer_before_min, buffer_after_min, active, metadata, 
                               created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
          RETURNING *
        `;

        const result = await ctx.query(query, [
          serviceData.tenant_id,
          JSON.stringify(serviceData.name),
          JSON.stringify(serviceData.description),
          serviceData.duration_min,
          serviceData.price_jpy,
          serviceData.buffer_before_min,
          serviceData.buffer_after_min,
          serviceData.active,
          JSON.stringify(serviceData.metadata)
        ]);

        const service = result.rows[0];

        // Create resource relationships if provided
        if (request.resourceIds && request.resourceIds.length > 0) {
          await this.createServiceResourceRelationships(
            service.id,
            tenantId,
            request.resourceIds,
            ctx
          );
        }

        logger.info('Service created successfully', { 
          serviceId: service.id, 
          tenantId 
        });

        // Fetch complete service with relationships
        const completeService = await this.repository.findByIdWithResources(service.id, tenantId);

        return {
          success: true,
          service: completeService!
        };
      });
    } catch (error) {
      logger.error('Failed to create service', { tenantId, error });

      if (error instanceof BadRequestError || error instanceof ConflictError) {
        return {
          success: false,
          error: error.message,
          code: error.code
        };
      }

      return {
        success: false,
        error: 'Failed to create service',
        code: 'SERVICE_CREATION_ERROR'
      };
    }
  }

  /**
   * Get service by ID
   */
  async getServiceById(
    id: string,
    tenantId: string,
    includeResources = true
  ): Promise<ServiceResponse | null> {
    try {
      logger.debug('Getting service by ID', { id, tenantId });

      if (includeResources) {
        return await this.repository.findByIdWithResources(id, tenantId);
      } else {
        const service = await this.repository.findById(id, tenantId);
        return service ? this.mapToServiceResponse(service) : null;
      }
    } catch (error) {
      logger.error('Failed to get service by ID', { id, tenantId, error });
      throw new InternalServerError('Failed to retrieve service');
    }
  }

  /**
   * Search services
   */
  async searchServices(query: ServiceSearchQuery, tenantId: string): Promise<any> {
    try {
      const criteria: ServiceSearchCriteria = {
        tenantId,
        name: query.name,
        active: query.active,
        minPrice: query.minPrice,
        maxPrice: query.maxPrice,
        minDuration: query.minDuration,
        maxDuration: query.maxDuration,
        resourceId: query.resourceId,
        includeResources: query.includeResources,
        includeInactive: query.includeInactive,
        search: query.search,
        limit: Math.min(query.limit || 50, 100),
        offset: query.offset || 0,
        sortBy: query.sortBy || 'name',
        sortOrder: (query.sortOrder?.toUpperCase() as 'ASC' | 'DESC') || 'ASC'
      };

      const result = await this.repository.searchServices(criteria);

      // Calculate statistics if requested
      let statistics;
      if (result.data.length > 0) {
        const prices = result.data.map(s => s.priceJpy);
        const durations = result.data.map(s => s.durationMin);
        
        statistics = {
          totalActive: result.data.filter(s => s.active).length,
          totalInactive: result.data.filter(s => !s.active).length,
          averagePrice: prices.reduce((a, b) => a + b, 0) / prices.length,
          averageDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
          priceRange: {
            min: Math.min(...prices),
            max: Math.max(...prices)
          }
        };
      }

      return {
        ...result,
        statistics
      };
    } catch (error) {
      logger.error('Failed to search services', { query, tenantId, error });
      throw new InternalServerError('Failed to search services');
    }
  }

  /**
   * Update service
   */
  async updateService(
    id: string,
    request: UpdateServiceRequest,
    tenantId: string,
    context: TenantContext
  ): Promise<ServiceOperationResult> {
    try {
      logger.info('Updating service', { id, tenantId });

      return withTransaction(async (ctx) => {
        // Check if service exists
        const existingService = await this.repository.findById(id, tenantId);
        if (!existingService) {
          return {
            success: false,
            error: 'Service not found',
            code: 'SERVICE_NOT_FOUND'
          };
        }

        // Validate name uniqueness if name is being changed
        if (request.name) {
          await this.validateServiceNameUniqueness(request.name, tenantId, id);
        }

        // Build update data
        const updateData: any = {};
        if (request.name) updateData.name = JSON.stringify(request.name);
        if (request.description) updateData.description = JSON.stringify(request.description);
        if (request.durationMin) updateData.duration_min = request.durationMin;
        if (request.priceJpy !== undefined) updateData.price_jpy = request.priceJpy;
        if (request.bufferBeforeMin !== undefined) updateData.buffer_before_min = request.bufferBeforeMin;
        if (request.bufferAfterMin !== undefined) updateData.buffer_after_min = request.bufferAfterMin;
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
          UPDATE services
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
            error: 'Service not found or already deleted',
            code: 'SERVICE_NOT_FOUND'
          };
        }

        // Update resource relationships if provided
        if (request.resourceIds !== undefined) {
          await this.updateServiceResourceRelationships(
            id,
            tenantId,
            request.resourceIds,
            ctx
          );
        }

        logger.info('Service updated successfully', { id, tenantId });

        // Fetch updated service with relationships
        const updatedService = await this.repository.findByIdWithResources(id, tenantId);

        return {
          success: true,
          service: updatedService!
        };
      });
    } catch (error) {
      logger.error('Failed to update service', { id, tenantId, error });

      if (error instanceof BadRequestError || error instanceof ConflictError) {
        return {
          success: false,
          error: error.message,
          code: error.code
        };
      }

      return {
        success: false,
        error: 'Failed to update service',
        code: 'SERVICE_UPDATE_ERROR'
      };
    }
  }

  /**
   * Delete service (soft delete)
   */
  async deleteService(
    id: string,
    tenantId: string,
    context: TenantContext
  ): Promise<ServiceOperationResult> {
    try {
      logger.info('Deleting service', { id, tenantId });

      return withTransaction(async (ctx) => {
        // Check if service has active bookings
        const bookingCheckQuery = `
          SELECT COUNT(*) as count
          FROM bookings
          WHERE service_id = $1 
            AND tenant_id = $2 
            AND status IN ('tentative', 'confirmed')
            AND start_at > NOW()
        `;

        const bookingResult = await ctx.query(bookingCheckQuery, [id, tenantId]);
        const activeBookings = parseInt(bookingResult.rows[0]?.count || '0', 10);

        if (activeBookings > 0) {
          return {
            success: false,
            error: `Cannot delete service with ${activeBookings} active bookings`,
            code: 'SERVICE_HAS_ACTIVE_BOOKINGS'
          };
        }

        // Soft delete service
        const deleteQuery = `
          UPDATE services
          SET deleted_at = NOW(), updated_at = NOW(), active = false
          WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
          RETURNING *
        `;

        const result = await ctx.query(deleteQuery, [id, tenantId]);

        if (result.rows.length === 0) {
          return {
            success: false,
            error: 'Service not found',
            code: 'SERVICE_NOT_FOUND'
          };
        }

        // Deactivate service-resource relationships
        await ctx.query(`
          UPDATE service_resources 
          SET active = false 
          WHERE service_id = $1 AND tenant_id = $2
        `, [id, tenantId]);

        logger.info('Service deleted successfully', { id, tenantId });

        return {
          success: true,
          service: this.mapToServiceResponse(result.rows[0])
        };
      });
    } catch (error) {
      logger.error('Failed to delete service', { id, tenantId, error });

      return {
        success: false,
        error: 'Failed to delete service',
        code: 'SERVICE_DELETION_ERROR'
      };
    }
  }

  /**
   * Get service availability
   */
  async getServiceAvailability(
    id: string,
    request: ServiceAvailabilityRequest,
    tenantId: string
  ): Promise<ServiceAvailabilityResponse> {
    try {
      const service = await this.getServiceById(id, tenantId);
      if (!service) {
        throw new NotFoundError(`Service ${id} not found`);
      }

      // Query available slots for this service
      const query = `
        SELECT 
          r.id as resource_id,
          r.name as resource_name,
          ts.start_at,
          ts.end_at,
          r.capacity,
          ts.available_capacity
        FROM timeslots ts
        JOIN resources r ON ts.resource_id = r.id
        JOIN service_resources sr ON r.id = sr.resource_id AND sr.service_id = $1
        WHERE ts.tenant_id = $2
          AND sr.tenant_id = $2
          AND sr.active = true
          AND r.active = true
          AND r.deleted_at IS NULL
          AND ts.start_at >= $3
          AND ts.end_at <= $4
          AND ts.available_capacity > 0
          ${request.resourceId ? 'AND r.id = $5' : ''}
        ORDER BY ts.start_at, r.name
      `;

      const params = [id, tenantId, request.startDate, request.endDate];
      if (request.resourceId) {
        params.push(request.resourceId);
      }

      const result = await this.fastify.db.query(query, params);

      const availableSlots = result.rows.map(row => ({
        resourceId: row.resource_id,
        resourceName: row.resource_name || {},
        startTime: row.start_at.toISOString(),
        endTime: row.end_at.toISOString(),
        capacity: row.capacity,
        availableCapacity: row.available_capacity
      }));

      return {
        serviceId: id,
        serviceName: service.name,
        availableSlots,
        totalAvailableSlots: availableSlots.length,
        metadata: {
          timestamp: new Date().toISOString(),
          version: 'v1'
        }
      };
    } catch (error) {
      logger.error('Failed to get service availability', { id, tenantId, error });
      throw new InternalServerError('Failed to get service availability');
    }
  }

  // Private helper methods

  /**
   * Map database row to ServiceResponse
   */
  private mapToServiceResponse(row: any): ServiceResponse {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name || {},
      description: row.description || {},
      durationMin: row.duration_min,
      priceJpy: row.price_jpy,
      bufferBeforeMin: row.buffer_before_min,
      bufferAfterMin: row.buffer_after_min,
      active: row.active,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      deletedAt: row.deleted_at?.toISOString(),
      availableResources: row.available_resources || [],
      metadata: row.metadata || {}
    };
  }

  /**
   * Validate service name uniqueness
   */
  private async validateServiceNameUniqueness(
    name: Record<string, string>,
    tenantId: string,
    excludeId?: string
  ): Promise<void> {
    const query = `
      SELECT id FROM services 
      WHERE tenant_id = $1 
        AND (name->>'ja' = $2 OR name->>'en' = $3)
        AND deleted_at IS NULL
        ${excludeId ? 'AND id != $4' : ''}
    `;

    const params = [tenantId, name.ja || '', name.en || ''];
    if (excludeId) params.push(excludeId);

    const result = await this.fastify.db.query(query, params);
    
    if (result.rows.length > 0) {
      throw new ConflictError('Service name already exists');
    }
  }

  /**
   * Create service-resource relationships
   */
  private async createServiceResourceRelationships(
    serviceId: string,
    tenantId: string,
    resourceIds: string[],
    ctx: TransactionContext
  ): Promise<void> {
    if (resourceIds.length === 0) return;

    // Validate resources exist
    const resourceQuery = `
      SELECT id FROM resources 
      WHERE tenant_id = $1 AND id = ANY($2) AND deleted_at IS NULL
    `;
    
    const resourceResult = await ctx.query(resourceQuery, [tenantId, resourceIds]);
    const validResourceIds = resourceResult.rows.map(r => r.id);

    if (validResourceIds.length !== resourceIds.length) {
      throw new BadRequestError('One or more resources not found');
    }

    // Insert relationships
    const values = validResourceIds.map((resourceId, index) => 
      `($1, $${index + 3}, $2, true, NOW())`
    ).join(', ');

    const insertQuery = `
      INSERT INTO service_resources (service_id, resource_id, tenant_id, active, created_at)
      VALUES ${values}
      ON CONFLICT (tenant_id, service_id, resource_id) 
      DO UPDATE SET active = true, updated_at = NOW()
    `;

    await ctx.query(insertQuery, [serviceId, tenantId, ...validResourceIds]);
  }

  /**
   * Update service-resource relationships
   */
  private async updateServiceResourceRelationships(
    serviceId: string,
    tenantId: string,
    resourceIds: string[],
    ctx: TransactionContext
  ): Promise<void> {
    // Remove existing relationships
    await ctx.query(
      `DELETE FROM service_resources WHERE service_id = $1 AND tenant_id = $2`,
      [serviceId, tenantId]
    );

    // Add new relationships
    if (resourceIds.length > 0) {
      await this.createServiceResourceRelationships(serviceId, tenantId, resourceIds, ctx);
    }
  }
}

export default ServiceService;