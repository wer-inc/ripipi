import { PoolClient } from 'pg';
import { db } from '../db/index.js';
import { withTransaction, TransactionContext } from '../db/transaction.js';
import { logger } from '../config/logger.js';
import { config } from '../config/index.js';

/**
 * Query builder for type-safe SQL construction
 */
export class QueryBuilder {
  private selectColumns: string[] = ['*'];
  private fromTable: string = '';
  private whereClauses: string[] = [];
  private joinClauses: string[] = [];
  private orderClauses: string[] = [];
  private limitValue?: number;
  private offsetValue?: number;
  private params: any[] = [];
  private paramCounter = 0;

  /**
   * Add SELECT columns
   */
  select(columns: string[] = ['*']): this {
    this.selectColumns = columns;
    return this;
  }

  /**
   * Set FROM table
   */
  from(table: string): this {
    this.fromTable = table;
    return this;
  }

  /**
   * Add WHERE condition
   */
  where(condition: string, ...values: any[]): this {
    let modifiedCondition = condition;
    
    // Replace ? placeholders with PostgreSQL $n placeholders
    values.forEach((value) => {
      this.paramCounter++;
      modifiedCondition = modifiedCondition.replace('?', `$${this.paramCounter}`);
      this.params.push(value);
    });

    this.whereClauses.push(modifiedCondition);
    return this;
  }

  /**
   * Add WHERE IN condition
   */
  whereIn(column: string, values: any[]): this {
    if (values.length === 0) {
      this.whereClauses.push('1=0'); // False condition
      return this;
    }

    const placeholders: string[] = [];
    values.forEach((value) => {
      this.paramCounter++;
      placeholders.push(`$${this.paramCounter}`);
      this.params.push(value);
    });

    this.whereClauses.push(`${column} IN (${placeholders.join(', ')})`);
    return this;
  }

  /**
   * Add WHERE NOT NULL condition
   */
  whereNotNull(column: string): this {
    this.whereClauses.push(`${column} IS NOT NULL`);
    return this;
  }

  /**
   * Add WHERE NULL condition
   */
  whereNull(column: string): this {
    this.whereClauses.push(`${column} IS NULL`);
    return this;
  }

  /**
   * Add INNER JOIN
   */
  join(table: string, condition: string): this {
    this.joinClauses.push(`INNER JOIN ${table} ON ${condition}`);
    return this;
  }

  /**
   * Add LEFT JOIN
   */
  leftJoin(table: string, condition: string): this {
    this.joinClauses.push(`LEFT JOIN ${table} ON ${condition}`);
    return this;
  }

  /**
   * Add RIGHT JOIN
   */
  rightJoin(table: string, condition: string): this {
    this.joinClauses.push(`RIGHT JOIN ${table} ON ${condition}`);
    return this;
  }

  /**
   * Add ORDER BY clause
   */
  orderBy(column: string, direction: 'ASC' | 'DESC' = 'ASC'): this {
    this.orderClauses.push(`${column} ${direction}`);
    return this;
  }

  /**
   * Set LIMIT
   */
  limit(count: number): this {
    this.limitValue = Math.max(0, Math.min(count, 10000)); // Max 10k records
    return this;
  }

  /**
   * Set OFFSET
   */
  offset(count: number): this {
    this.offsetValue = Math.max(0, count);
    return this;
  }

  /**
   * Build the SQL query and parameters
   */
  build(): { text: string; params: any[] } {
    if (!this.fromTable) {
      throw new Error('FROM table is required');
    }

    let query = `SELECT ${this.selectColumns.join(', ')} FROM ${this.fromTable}`;

    if (this.joinClauses.length > 0) {
      query += ` ${this.joinClauses.join(' ')}`;
    }

    if (this.whereClauses.length > 0) {
      query += ` WHERE ${this.whereClauses.join(' AND ')}`;
    }

    if (this.orderClauses.length > 0) {
      query += ` ORDER BY ${this.orderClauses.join(', ')}`;
    }

    if (this.limitValue !== undefined) {
      query += ` LIMIT ${this.limitValue}`;
    }

    if (this.offsetValue !== undefined) {
      query += ` OFFSET ${this.offsetValue}`;
    }

    return {
      text: query,
      params: this.params
    };
  }

  /**
   * Execute the query
   */
  async execute<T = any>(): Promise<{ rows: T[]; rowCount: number }> {
    const { text, params } = this.build();
    return db.query<T>(text, params);
  }

  /**
   * Execute the query within a transaction
   */
  async executeInTransaction<T = any>(ctx: TransactionContext): Promise<{ rows: T[]; rowCount: number }> {
    const { text, params } = this.build();
    return ctx.query<T>(text, params);
  }
}

/**
 * Dynamic WHERE clause builder
 */
export interface WhereCondition {
  field: string;
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'ILIKE' | 'IN' | 'NOT IN' | 'IS NULL' | 'IS NOT NULL' | 'BETWEEN';
  value?: any;
  values?: any[];
}

export function buildWhereClause(conditions: WhereCondition[]): { clause: string; params: any[] } {
  if (conditions.length === 0) {
    return { clause: '', params: [] };
  }

  const clauses: string[] = [];
  const params: any[] = [];
  let paramCounter = 0;

  conditions.forEach((condition) => {
    switch (condition.operator) {
      case 'IN':
        if (condition.values && condition.values.length > 0) {
          const placeholders = condition.values.map(() => `$${++paramCounter}`).join(', ');
          clauses.push(`${condition.field} IN (${placeholders})`);
          params.push(...condition.values);
        } else {
          clauses.push('1=0'); // False condition for empty IN
        }
        break;

      case 'NOT IN':
        if (condition.values && condition.values.length > 0) {
          const placeholders = condition.values.map(() => `$${++paramCounter}`).join(', ');
          clauses.push(`${condition.field} NOT IN (${placeholders})`);
          params.push(...condition.values);
        } else {
          clauses.push('1=1'); // True condition for empty NOT IN
        }
        break;

      case 'BETWEEN':
        if (condition.values && condition.values.length === 2) {
          clauses.push(`${condition.field} BETWEEN $${++paramCounter} AND $${++paramCounter}`);
          params.push(condition.values[0], condition.values[1]);
        }
        break;

      case 'IS NULL':
        clauses.push(`${condition.field} IS NULL`);
        break;

      case 'IS NOT NULL':
        clauses.push(`${condition.field} IS NOT NULL`);
        break;

      default:
        clauses.push(`${condition.field} ${condition.operator} $${++paramCounter}`);
        params.push(condition.value);
        break;
    }
  });

  return {
    clause: clauses.join(' AND '),
    params
  };
}

/**
 * Parameter binding helpers
 */
export function bindParameters(query: string, params: Record<string, any>): { text: string; values: any[] } {
  const values: any[] = [];
  let paramIndex = 1;
  
  const text = query.replace(/:(\w+)/g, (match, paramName) => {
    if (paramName in params) {
      values.push(params[paramName]);
      return `$${paramIndex++}`;
    }
    throw new Error(`Parameter '${paramName}' not found in params object`);
  });

  return { text, values };
}

/**
 * Date and time helpers with timezone support
 */
export class DateTimeHelpers {
  private static defaultTimezone = config.DEFAULT_TIMEZONE;

  /**
   * Convert date to PostgreSQL timestamp with timezone
   */
  static toTimestamp(date: Date | string, timezone: string = this.defaultTimezone): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return `'${d.toISOString()}'::timestamptz`;
  }

  /**
   * Get current timestamp in specified timezone
   */
  static now(timezone: string = this.defaultTimezone): string {
    return `NOW() AT TIME ZONE '${timezone}'`;
  }

  /**
   * Create date range condition
   */
  static dateRange(field: string, startDate?: Date, endDate?: Date, timezone: string = this.defaultTimezone): WhereCondition[] {
    const conditions: WhereCondition[] = [];

    if (startDate) {
      conditions.push({
        field: `${field} AT TIME ZONE '${timezone}'`,
        operator: '>=',
        value: startDate
      });
    }

    if (endDate) {
      conditions.push({
        field: `${field} AT TIME ZONE '${timezone}'`,
        operator: '<=',
        value: endDate
      });
    }

    return conditions;
  }

  /**
   * Create time range for today
   */
  static today(field: string, timezone: string = this.defaultTimezone): WhereCondition[] {
    return [
      {
        field,
        operator: '>=',
        value: `date_trunc('day', NOW() AT TIME ZONE '${timezone}')`
      },
      {
        field,
        operator: '<',
        value: `date_trunc('day', NOW() AT TIME ZONE '${timezone}') + INTERVAL '1 day'`
      }
    ];
  }
}

/**
 * Bulk operation helpers
 */
export class BulkOperations {
  /**
   * Bulk insert with conflict resolution
   */
  static async bulkUpsert<T>(
    tableName: string,
    records: T[],
    conflictColumns: string[],
    updateColumns: string[],
    ctx?: TransactionContext
  ): Promise<{ rows: T[]; rowCount: number }> {
    if (records.length === 0) {
      return { rows: [], rowCount: 0 };
    }

    const columns = Object.keys(records[0] as any);
    const values: any[] = [];
    const valuePlaceholders: string[] = [];

    records.forEach((record, recordIndex) => {
      const recordValues = columns.map(col => (record as any)[col]);
      const recordPlaceholders = recordValues.map((_, valueIndex) => {
        return `$${values.length + valueIndex + 1}`;
      });
      
      valuePlaceholders.push(`(${recordPlaceholders.join(', ')})`);
      values.push(...recordValues);
    });

    const conflictClause = conflictColumns.length > 0 
      ? `ON CONFLICT (${conflictColumns.join(', ')}) DO UPDATE SET ${updateColumns.map(col => `${col} = EXCLUDED.${col}`).join(', ')}`
      : '';

    const query = `
      INSERT INTO ${tableName} (${columns.join(', ')})
      VALUES ${valuePlaceholders.join(', ')}
      ${conflictClause}
      RETURNING *
    `;

    if (ctx) {
      return ctx.query<T>(query, values);
    } else {
      return db.query<T>(query, values);
    }
  }

  /**
   * Bulk delete with conditions
   */
  static async bulkDelete(
    tableName: string,
    conditions: WhereCondition[],
    ctx?: TransactionContext
  ): Promise<number> {
    const { clause, params } = buildWhereClause(conditions);
    
    const query = `
      DELETE FROM ${tableName}
      ${clause ? `WHERE ${clause}` : ''}
    `;

    const result = ctx 
      ? await ctx.query(query, params)
      : await db.query(query, params);

    return result.rowCount;
  }

  /**
   * Bulk update with conditions
   */
  static async bulkUpdate(
    tableName: string,
    updates: Record<string, any>,
    conditions: WhereCondition[],
    ctx?: TransactionContext
  ): Promise<number> {
    const updateEntries = Object.entries(updates);
    if (updateEntries.length === 0) {
      return 0;
    }

    const { clause, params } = buildWhereClause(conditions);
    
    let paramCounter = params.length;
    const setClauses = updateEntries.map(([key, value]) => {
      params.push(value);
      return `${key} = $${++paramCounter}`;
    });

    const query = `
      UPDATE ${tableName}
      SET ${setClauses.join(', ')}
      ${clause ? `WHERE ${clause}` : ''}
    `;

    const result = ctx 
      ? await ctx.query(query, params)
      : await db.query(query, params);

    return result.rowCount;
  }
}

/**
 * Database utility functions
 */
export class DatabaseUtils {
  /**
   * Check if table exists
   */
  static async tableExists(tableName: string, schemaName: string = 'public'): Promise<boolean> {
    const query = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = $1 AND table_name = $2
      ) as exists
    `;
    
    const result = await db.query<{ exists: boolean }>(query, [schemaName, tableName]);
    return result.rows[0]?.exists || false;
  }

  /**
   * Get table column information
   */
  static async getTableColumns(tableName: string, schemaName: string = 'public'): Promise<Array<{
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>> {
    const query = `
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
    `;
    
    const result = await db.query(query, [schemaName, tableName]);
    return result.rows;
  }

  /**
   * Get database size
   */
  static async getDatabaseSize(): Promise<string> {
    const query = `SELECT pg_size_pretty(pg_database_size(current_database())) as size`;
    const result = await db.query<{ size: string }>(query);
    return result.rows[0]?.size || '0 bytes';
  }

  /**
   * Get table sizes
   */
  static async getTableSizes(limit: number = 10): Promise<Array<{
    table_name: string;
    size: string;
    row_count: number;
  }>> {
    const query = `
      SELECT 
        schemaname||'.'||tablename as table_name,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
        n_tup_ins - n_tup_del as row_count
      FROM pg_tables t
      LEFT JOIN pg_stat_user_tables s ON s.relname = t.tablename
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
      LIMIT $1
    `;
    
    const result = await db.query(query, [limit]);
    return result.rows;
  }

  /**
   * Analyze table for query optimization
   */
  static async analyzeTable(tableName: string): Promise<void> {
    const query = `ANALYZE ${tableName}`;
    await db.query(query);
    logger.debug(`Table ${tableName} analyzed for query optimization`);
  }

  /**
   * Vacuum table
   */
  static async vacuumTable(tableName: string, full: boolean = false): Promise<void> {
    const query = full ? `VACUUM FULL ${tableName}` : `VACUUM ${tableName}`;
    await db.query(query);
    logger.debug(`Table ${tableName} vacuumed (full: ${full})`);
  }
}

/**
 * Query performance monitoring
 */
export class QueryPerformanceMonitor {
  private static queryStats: Map<string, {
    count: number;
    totalDuration: number;
    minDuration: number;
    maxDuration: number;
    averageDuration: number;
  }> = new Map();

  /**
   * Record query execution time
   */
  static recordQuery(querySignature: string, duration: number): void {
    const stats = this.queryStats.get(querySignature) || {
      count: 0,
      totalDuration: 0,
      minDuration: Infinity,
      maxDuration: 0,
      averageDuration: 0
    };

    stats.count++;
    stats.totalDuration += duration;
    stats.minDuration = Math.min(stats.minDuration, duration);
    stats.maxDuration = Math.max(stats.maxDuration, duration);
    stats.averageDuration = stats.totalDuration / stats.count;

    this.queryStats.set(querySignature, stats);
  }

  /**
   * Get query statistics
   */
  static getStats(): Record<string, any> {
    const result: Record<string, any> = {};
    
    this.queryStats.forEach((stats, query) => {
      result[query] = {
        ...stats,
        minDuration: stats.minDuration === Infinity ? 0 : stats.minDuration
      };
    });

    return result;
  }

  /**
   * Get slow queries (above threshold)
   */
  static getSlowQueries(thresholdMs: number = 1000): Array<{ query: string; stats: any }> {
    const slowQueries: Array<{ query: string; stats: any }> = [];
    
    this.queryStats.forEach((stats, query) => {
      if (stats.averageDuration > thresholdMs) {
        slowQueries.push({
          query,
          stats: {
            ...stats,
            minDuration: stats.minDuration === Infinity ? 0 : stats.minDuration
          }
        });
      }
    });

    return slowQueries.sort((a, b) => b.stats.averageDuration - a.stats.averageDuration);
  }

  /**
   * Clear statistics
   */
  static clearStats(): void {
    this.queryStats.clear();
  }
}

/**
 * Connection pool monitoring
 */
export async function getPoolStats(): Promise<{
  totalConnections: number;
  idleConnections: number;
  waitingClients: number;
  maxConnections: number;
}> {
  const pool = db.getPool();
  
  return {
    totalConnections: pool.totalCount,
    idleConnections: pool.idleCount,
    waitingClients: pool.waitingCount,
    maxConnections: pool.options.max || 10
  };
}

/**
 * Database health check
 */
export async function healthCheck(): Promise<{
  status: 'ok' | 'error';
  latency: number;
  connections: any;
  timestamp: Date;
}> {
  const start = Date.now();
  
  try {
    await db.query('SELECT 1');
    const latency = Date.now() - start;
    const connections = await getPoolStats();
    
    return {
      status: 'ok',
      latency,
      connections,
      timestamp: new Date()
    };
  } catch (error) {
    logger.error('Database health check failed', { error });
    return {
      status: 'error',
      latency: Date.now() - start,
      connections: await getPoolStats(),
      timestamp: new Date()
    };
  }
}

// Export the main classes and functions
export {
  QueryBuilder,
  DateTimeHelpers,
  BulkOperations,
  DatabaseUtils,
  QueryPerformanceMonitor
};