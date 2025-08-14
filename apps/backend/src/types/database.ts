import { PoolClient } from 'pg';

/**
 * Database query result interface
 */
export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

/**
 * Database connection metrics
 */
export interface DatabaseMetrics {
  totalConnections: number;
  idleConnections: number;
  waitingClients: number;
}

/**
 * Multi-tenant query context
 */
export interface TenantContext {
  tenantId: string;
  userId?: string;
  permissions?: string[];
}

/**
 * Base entity interface for all database entities
 */
export interface BaseEntity {
  id: string;
  tenant_id: string;
  created_at: Date;
  updated_at: Date;
  created_by?: string;
  updated_by?: string;
}

/**
 * Pagination parameters
 */
export interface PaginationParams {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'ASC' | 'DESC';
}

/**
 * Paginated query result
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Database transaction isolation levels
 */
export type IsolationLevel = 
  | 'READ UNCOMMITTED'
  | 'READ COMMITTED'
  | 'REPEATABLE READ'
  | 'SERIALIZABLE';

/**
 * Query builder interface for type-safe queries
 */
export interface QueryBuilder<T = any> {
  select(columns?: string[]): QueryBuilder<T>;
  from(table: string): QueryBuilder<T>;
  where(condition: string, ...params: any[]): QueryBuilder<T>;
  whereIn(column: string, values: any[]): QueryBuilder<T>;
  whereNotNull(column: string): QueryBuilder<T>;
  join(table: string, condition: string): QueryBuilder<T>;
  leftJoin(table: string, condition: string): QueryBuilder<T>;
  orderBy(column: string, direction?: 'ASC' | 'DESC'): QueryBuilder<T>;
  limit(count: number): QueryBuilder<T>;
  offset(count: number): QueryBuilder<T>;
  build(): { text: string; params: any[] };
  execute(): Promise<QueryResult<T>>;
}

/**
 * Repository interface for data access
 */
export interface Repository<T extends BaseEntity> {
  findById(id: string, tenantId: string): Promise<T | null>;
  findByTenant(tenantId: string, params?: PaginationParams): Promise<PaginatedResult<T>>;
  create(data: Omit<T, 'id' | 'created_at' | 'updated_at'>, tenantId: string): Promise<T>;
  update(id: string, data: Partial<T>, tenantId: string): Promise<T | null>;
  delete(id: string, tenantId: string): Promise<boolean>;
  count(tenantId: string): Promise<number>;
}

/**
 * Database migration interface
 */
export interface Migration {
  id: string;
  name: string;
  up(client: PoolClient): Promise<void>;
  down(client: PoolClient): Promise<void>;
}

/**
 * Audit log entry
 */
export interface AuditLog extends BaseEntity {
  table_name: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  old_values?: Record<string, any>;
  new_values?: Record<string, any>;
  changed_fields?: string[];
  user_id?: string;
  session_id?: string;
  ip_address?: string;
  user_agent?: string;
}

/**
 * Database health check result
 */
export interface HealthCheckResult {
  status: 'ok' | 'error';
  message: string;
  metrics?: DatabaseMetrics;
  timestamp: Date;
  uptime?: number;
  version?: string;
}

/**
 * Query performance metrics
 */
export interface QueryMetrics {
  query: string;
  duration: number;
  rowCount: number;
  timestamp: Date;
  successful: boolean;
  error?: string;
}

export { PoolClient } from 'pg';