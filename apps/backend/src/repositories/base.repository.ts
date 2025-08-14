import { db } from '../db/index.js';
import { withTransaction, TransactionContext } from '../db/transaction.js';
import { logger } from '../config/logger.js';
import {
  BaseEntity,
  Repository,
  PaginatedResult,
  PaginationParams,
  QueryResult,
  TenantContext
} from '../types/database.js';

/**
 * Repository options for configuration
 */
export interface RepositoryOptions {
  tableName: string;
  primaryKey?: string;
  tenantKey?: string;
  auditFields?: boolean;
  optimisticLocking?: boolean;
}

/**
 * Filter condition for queries
 */
export interface FilterCondition {
  field: string;
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'ILIKE' | 'IN' | 'NOT IN' | 'IS NULL' | 'IS NOT NULL';
  value?: any;
  values?: any[];
}

/**
 * Sort option for queries
 */
export interface SortOption {
  field: string;
  direction: 'ASC' | 'DESC';
}

/**
 * Advanced query options
 */
export interface QueryOptions {
  filters?: FilterCondition[];
  sort?: SortOption[];
  pagination?: PaginationParams;
  includeDeleted?: boolean;
  forUpdate?: boolean;
}

/**
 * Repository error types
 */
export class RepositoryError extends Error {
  constructor(message: string, public readonly code?: string, public readonly originalError?: Error) {
    super(message);
    this.name = 'RepositoryError';
  }
}

export class NotFoundError extends RepositoryError {
  constructor(id: string, tableName: string) {
    super(`Record with id '${id}' not found in table '${tableName}'`, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class OptimisticLockError extends RepositoryError {
  constructor(id: string, expectedVersion: number, actualVersion: number) {
    super(
      `Optimistic lock failed for record '${id}'. Expected version ${expectedVersion}, got ${actualVersion}`,
      'OPTIMISTIC_LOCK_FAILED'
    );
    this.name = 'OptimisticLockError';
  }
}

export class DuplicateError extends RepositoryError {
  constructor(field: string, value: any, tableName: string) {
    super(`Duplicate value '${value}' for field '${field}' in table '${tableName}'`, 'DUPLICATE_ERROR');
    this.name = 'DuplicateError';
  }
}

/**
 * Base repository class providing common CRUD operations
 * with multi-tenant support, pagination, and optimistic locking
 */
export abstract class BaseRepository<T extends BaseEntity> implements Repository<T> {
  protected readonly tableName: string;
  protected readonly primaryKey: string;
  protected readonly tenantKey: string;
  protected readonly auditFields: boolean;
  protected readonly optimisticLocking: boolean;

  constructor(options: RepositoryOptions) {
    this.tableName = options.tableName;
    this.primaryKey = options.primaryKey || 'id';
    this.tenantKey = options.tenantKey || 'tenant_id';
    this.auditFields = options.auditFields !== false;
    this.optimisticLocking = options.optimisticLocking !== false;
  }

  /**
   * Find a record by ID for a specific tenant
   */
  async findById(id: string, tenantId: string, options?: { includeDeleted?: boolean }): Promise<T | null> {
    try {
      let whereClause = `${this.primaryKey} = $1 AND ${this.tenantKey} = $2`;
      const params = [id, tenantId];

      if (!options?.includeDeleted) {
        whereClause += ' AND deleted_at IS NULL';
      }

      const query = `
        SELECT * FROM ${this.tableName}
        WHERE ${whereClause}
        LIMIT 1
      `;

      const result = await db.query<T>(query, params);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Failed to find record by ID', {
        tableName: this.tableName,
        id,
        tenantId,
        error
      });
      throw new RepositoryError(`Failed to find record: ${error}`, undefined, error as Error);
    }
  }

  /**
   * Find records by tenant with advanced filtering and pagination
   */
  async findByTenant(
    tenantId: string,
    options?: QueryOptions
  ): Promise<PaginatedResult<T>> {
    try {
      const { whereClause, params } = this.buildWhereClause(
        [{ field: this.tenantKey, operator: '=', value: tenantId }],
        options?.filters || [],
        options?.includeDeleted || false
      );

      const orderClause = this.buildOrderClause(options?.sort);
      const { limitClause, offset } = this.buildLimitClause(options?.pagination);

      // Count query
      const countQuery = `
        SELECT COUNT(*) as total
        FROM ${this.tableName}
        WHERE ${whereClause}
      `;

      // Data query
      const dataQuery = `
        SELECT * FROM ${this.tableName}
        WHERE ${whereClause}
        ${orderClause}
        ${limitClause}
        ${options?.forUpdate ? 'FOR UPDATE' : ''}
      `;

      const [countResult, dataResult] = await Promise.all([
        db.query<{ total: string }>(countQuery, params),
        db.query<T>(dataQuery, params)
      ]);

      const total = parseInt(countResult.rows[0]?.total || '0', 10);
      const limit = options?.pagination?.limit || 50;

      return {
        data: dataResult.rows,
        total,
        limit,
        offset,
        hasMore: offset + dataResult.rows.length < total
      };
    } catch (error) {
      logger.error('Failed to find records by tenant', {
        tableName: this.tableName,
        tenantId,
        options,
        error
      });
      throw new RepositoryError(`Failed to find records: ${error}`, undefined, error as Error);
    }
  }

  /**
   * Create a new record
   */
  async create(
    data: Omit<T, 'id' | 'created_at' | 'updated_at'>,
    tenantId: string,
    context?: TenantContext
  ): Promise<T> {
    return withTransaction(async (ctx) => {
      try {
        const now = new Date();
        const userId = context?.userId;

        const createData = {
          ...data,
          [this.tenantKey]: tenantId,
          created_at: now,
          updated_at: now,
          ...(this.auditFields && userId && { created_by: userId, updated_by: userId }),
          ...(this.optimisticLocking && { version: 1 })
        };

        const { columns, placeholders, values } = this.buildInsertClause(createData);

        const query = `
          INSERT INTO ${this.tableName} (${columns})
          VALUES (${placeholders})
          RETURNING *
        `;

        const result = await ctx.query<T>(query, values);
        const created = result.rows[0];

        if (!created) {
          throw new RepositoryError('Failed to create record - no data returned');
        }

        logger.debug('Record created successfully', {
          tableName: this.tableName,
          id: created.id,
          tenantId
        });

        return created;
      } catch (error: any) {
        if (error.code === '23505') { // Unique violation
          const match = error.detail?.match(/Key \(([^)]+)\)=\(([^)]+)\)/);
          const field = match?.[1] || 'unknown';
          const value = match?.[2] || 'unknown';
          throw new DuplicateError(field, value, this.tableName);
        }
        throw new RepositoryError(`Failed to create record: ${error}`, error.code, error);
      }
    });
  }

  /**
   * Update a record with optimistic locking support
   */
  async update(
    id: string,
    data: Partial<T>,
    tenantId: string,
    context?: TenantContext
  ): Promise<T | null> {
    return withTransaction(async (ctx) => {
      try {
        // First, get the current record for optimistic locking
        const current = await this.findById(id, tenantId);
        if (!current) {
          throw new NotFoundError(id, this.tableName);
        }

        // Check version for optimistic locking
        if (this.optimisticLocking && 'version' in data && 'version' in current) {
          const expectedVersion = (current as any).version;
          const providedVersion = (data as any).version;
          
          if (providedVersion !== expectedVersion) {
            throw new OptimisticLockError(id, providedVersion, expectedVersion);
          }
        }

        const now = new Date();
        const userId = context?.userId;

        const updateData = {
          ...data,
          updated_at: now,
          ...(this.auditFields && userId && { updated_by: userId }),
          ...(this.optimisticLocking && { version: ((current as any).version || 0) + 1 })
        };

        // Remove fields that shouldn't be updated
        delete (updateData as any).id;
        delete (updateData as any).created_at;
        delete (updateData as any).created_by;
        delete (updateData as any)[this.tenantKey];

        const { setClause, values } = this.buildUpdateClause(updateData);
        values.push(id, tenantId);

        let whereClause = `${this.primaryKey} = $${values.length - 1} AND ${this.tenantKey} = $${values.length}`;
        
        // Add version check for optimistic locking
        if (this.optimisticLocking && 'version' in current) {
          values.push((current as any).version);
          whereClause += ` AND version = $${values.length}`;
        }

        const query = `
          UPDATE ${this.tableName}
          SET ${setClause}
          WHERE ${whereClause}
          RETURNING *
        `;

        const result = await ctx.query<T>(query, values);
        const updated = result.rows[0];

        if (!updated) {
          if (this.optimisticLocking) {
            throw new OptimisticLockError(id, (data as any).version, -1);
          }
          throw new NotFoundError(id, this.tableName);
        }

        logger.debug('Record updated successfully', {
          tableName: this.tableName,
          id,
          tenantId,
          changedFields: Object.keys(updateData)
        });

        return updated;
      } catch (error: any) {
        if (error instanceof RepositoryError) {
          throw error;
        }
        if (error.code === '23505') {
          const match = error.detail?.match(/Key \(([^)]+)\)=\(([^)]+)\)/);
          const field = match?.[1] || 'unknown';
          const value = match?.[2] || 'unknown';
          throw new DuplicateError(field, value, this.tableName);
        }
        throw new RepositoryError(`Failed to update record: ${error}`, error.code, error);
      }
    });
  }

  /**
   * Soft delete a record (sets deleted_at)
   */
  async delete(id: string, tenantId: string, context?: TenantContext): Promise<boolean> {
    return withTransaction(async (ctx) => {
      try {
        const now = new Date();
        const userId = context?.userId;

        const updateData: any = {
          deleted_at: now,
          updated_at: now,
          ...(this.auditFields && userId && { updated_by: userId })
        };

        const { setClause, values } = this.buildUpdateClause(updateData);
        values.push(id, tenantId);

        const query = `
          UPDATE ${this.tableName}
          SET ${setClause}
          WHERE ${this.primaryKey} = $${values.length - 1} 
            AND ${this.tenantKey} = $${values.length}
            AND deleted_at IS NULL
          RETURNING ${this.primaryKey}
        `;

        const result = await ctx.query(query, values);
        const deleted = result.rowCount > 0;

        if (deleted) {
          logger.debug('Record soft deleted successfully', {
            tableName: this.tableName,
            id,
            tenantId
          });
        }

        return deleted;
      } catch (error) {
        logger.error('Failed to delete record', {
          tableName: this.tableName,
          id,
          tenantId,
          error
        });
        throw new RepositoryError(`Failed to delete record: ${error}`, undefined, error as Error);
      }
    });
  }

  /**
   * Hard delete a record (permanently removes from database)
   */
  async hardDelete(id: string, tenantId: string): Promise<boolean> {
    return withTransaction(async (ctx) => {
      try {
        const query = `
          DELETE FROM ${this.tableName}
          WHERE ${this.primaryKey} = $1 AND ${this.tenantKey} = $2
        `;

        const result = await ctx.query(query, [id, tenantId]);
        const deleted = result.rowCount > 0;

        if (deleted) {
          logger.debug('Record hard deleted successfully', {
            tableName: this.tableName,
            id,
            tenantId
          });
        }

        return deleted;
      } catch (error) {
        logger.error('Failed to hard delete record', {
          tableName: this.tableName,
          id,
          tenantId,
          error
        });
        throw new RepositoryError(`Failed to hard delete record: ${error}`, undefined, error as Error);
      }
    });
  }

  /**
   * Count records for a tenant
   */
  async count(tenantId: string, filters?: FilterCondition[]): Promise<number> {
    try {
      const { whereClause, params } = this.buildWhereClause(
        [{ field: this.tenantKey, operator: '=', value: tenantId }],
        filters || [],
        false
      );

      const query = `
        SELECT COUNT(*) as total
        FROM ${this.tableName}
        WHERE ${whereClause}
      `;

      const result = await db.query<{ total: string }>(query, params);
      return parseInt(result.rows[0]?.total || '0', 10);
    } catch (error) {
      logger.error('Failed to count records', {
        tableName: this.tableName,
        tenantId,
        error
      });
      throw new RepositoryError(`Failed to count records: ${error}`, undefined, error as Error);
    }
  }

  /**
   * Bulk insert records
   */
  async bulkCreate(
    dataArray: Array<Omit<T, 'id' | 'created_at' | 'updated_at'>>,
    tenantId: string,
    context?: TenantContext
  ): Promise<T[]> {
    if (dataArray.length === 0) {
      return [];
    }

    return withTransaction(async (ctx) => {
      try {
        const now = new Date();
        const userId = context?.userId;

        // Prepare all records with audit fields
        const records = dataArray.map(data => ({
          ...data,
          [this.tenantKey]: tenantId,
          created_at: now,
          updated_at: now,
          ...(this.auditFields && userId && { created_by: userId, updated_by: userId }),
          ...(this.optimisticLocking && { version: 1 })
        }));

        const { columns, values, placeholders } = this.buildBulkInsertClause(records);

        const query = `
          INSERT INTO ${this.tableName} (${columns})
          VALUES ${placeholders}
          RETURNING *
        `;

        const result = await ctx.query<T>(query, values);

        logger.debug('Bulk insert completed successfully', {
          tableName: this.tableName,
          count: result.rows.length,
          tenantId
        });

        return result.rows;
      } catch (error: any) {
        if (error.code === '23505') {
          const match = error.detail?.match(/Key \(([^)]+)\)=\(([^)]+)\)/);
          const field = match?.[1] || 'unknown';
          const value = match?.[2] || 'unknown';
          throw new DuplicateError(field, value, this.tableName);
        }
        throw new RepositoryError(`Failed to bulk create records: ${error}`, error.code, error);
      }
    });
  }

  /**
   * Restore a soft-deleted record
   */
  async restore(id: string, tenantId: string, context?: TenantContext): Promise<T | null> {
    return withTransaction(async (ctx) => {
      try {
        const now = new Date();
        const userId = context?.userId;

        const updateData: any = {
          deleted_at: null,
          updated_at: now,
          ...(this.auditFields && userId && { updated_by: userId })
        };

        const { setClause, values } = this.buildUpdateClause(updateData);
        values.push(id, tenantId);

        const query = `
          UPDATE ${this.tableName}
          SET ${setClause}
          WHERE ${this.primaryKey} = $${values.length - 1} 
            AND ${this.tenantKey} = $${values.length}
            AND deleted_at IS NOT NULL
          RETURNING *
        `;

        const result = await ctx.query<T>(query, values);
        const restored = result.rows[0] || null;

        if (restored) {
          logger.debug('Record restored successfully', {
            tableName: this.tableName,
            id,
            tenantId
          });
        }

        return restored;
      } catch (error) {
        logger.error('Failed to restore record', {
          tableName: this.tableName,
          id,
          tenantId,
          error
        });
        throw new RepositoryError(`Failed to restore record: ${error}`, undefined, error as Error);
      }
    });
  }

  /**
   * Build WHERE clause with filters
   */
  protected buildWhereClause(
    baseConditions: FilterCondition[],
    additionalFilters: FilterCondition[],
    includeDeleted: boolean
  ): { whereClause: string; params: any[] } {
    const conditions = [...baseConditions, ...additionalFilters];
    
    if (!includeDeleted) {
      conditions.push({ field: 'deleted_at', operator: 'IS NULL' });
    }

    const clauses: string[] = [];
    const params: any[] = [];

    conditions.forEach((condition) => {
      const paramIndex = params.length + 1;
      
      switch (condition.operator) {
        case 'IN':
          if (condition.values && condition.values.length > 0) {
            const placeholders = condition.values.map((_, index) => `$${paramIndex + index}`).join(',');
            clauses.push(`${condition.field} IN (${placeholders})`);
            params.push(...condition.values);
          }
          break;
        case 'NOT IN':
          if (condition.values && condition.values.length > 0) {
            const placeholders = condition.values.map((_, index) => `$${paramIndex + index}`).join(',');
            clauses.push(`${condition.field} NOT IN (${placeholders})`);
            params.push(...condition.values);
          }
          break;
        case 'IS NULL':
          clauses.push(`${condition.field} IS NULL`);
          break;
        case 'IS NOT NULL':
          clauses.push(`${condition.field} IS NOT NULL`);
          break;
        default:
          clauses.push(`${condition.field} ${condition.operator} $${paramIndex}`);
          params.push(condition.value);
          break;
      }
    });

    return {
      whereClause: clauses.length > 0 ? clauses.join(' AND ') : '1=1',
      params
    };
  }

  /**
   * Build ORDER BY clause
   */
  protected buildOrderClause(sortOptions?: SortOption[]): string {
    if (!sortOptions || sortOptions.length === 0) {
      return 'ORDER BY created_at DESC';
    }

    const orderParts = sortOptions.map(sort => `${sort.field} ${sort.direction}`);
    return `ORDER BY ${orderParts.join(', ')}`;
  }

  /**
   * Build LIMIT and OFFSET clause
   */
  protected buildLimitClause(pagination?: PaginationParams): { limitClause: string; offset: number } {
    const limit = Math.min(pagination?.limit || 50, 1000); // Max 1000 records
    const offset = pagination?.offset || 0;

    return {
      limitClause: `LIMIT ${limit} OFFSET ${offset}`,
      offset
    };
  }

  /**
   * Build INSERT clause
   */
  protected buildInsertClause(data: any): { columns: string; placeholders: string; values: any[] } {
    const entries = Object.entries(data).filter(([_, value]) => value !== undefined);
    const columns = entries.map(([key]) => key).join(', ');
    const placeholders = entries.map((_, index) => `$${index + 1}`).join(', ');
    const values = entries.map(([_, value]) => value);

    return { columns, placeholders, values };
  }

  /**
   * Build UPDATE SET clause
   */
  protected buildUpdateClause(data: any): { setClause: string; values: any[] } {
    const entries = Object.entries(data).filter(([_, value]) => value !== undefined);
    const setClauses = entries.map(([key], index) => `${key} = $${index + 1}`);
    const values = entries.map(([_, value]) => value);

    return {
      setClause: setClauses.join(', '),
      values
    };
  }

  /**
   * Build bulk INSERT clause
   */
  protected buildBulkInsertClause(records: any[]): { columns: string; values: any[]; placeholders: string } {
    if (records.length === 0) {
      throw new Error('No records provided for bulk insert');
    }

    const columns = Object.keys(records[0]).join(', ');
    const values: any[] = [];
    const rowPlaceholders: string[] = [];

    records.forEach((record, recordIndex) => {
      const recordValues = Object.values(record);
      const recordPlaceholders = recordValues.map((_, valueIndex) => {
        return `$${values.length + valueIndex + 1}`;
      });
      
      rowPlaceholders.push(`(${recordPlaceholders.join(', ')})`);
      values.push(...recordValues);
    });

    return {
      columns,
      values,
      placeholders: rowPlaceholders.join(', ')
    };
  }
}

// Export error types
export {
  RepositoryError,
  NotFoundError,
  OptimisticLockError,
  DuplicateError
};