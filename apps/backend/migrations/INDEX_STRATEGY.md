# Database Index Strategy

## Overview
This document outlines the indexing strategy for the reservation system database, focusing on performance optimization for critical query patterns.

## Core Indexing Principles

### 1. Multi-Tenant Isolation
- All tenant-scoped queries start with `tenant_id` as the first column in composite indexes
- Ensures efficient data isolation and query performance across tenants

### 2. Time-Based Queries
- Most business queries involve time ranges (availability, bookings, schedules)
- Time columns (`start_at`, `end_at`, `created_at`) are heavily indexed

### 3. Status-Based Filtering
- Active/inactive filtering is common across entities
- Status fields are included in relevant composite indexes

## Index Categories

### Primary Search Indexes

#### Timeslots (Critical for availability queries)
```sql
-- Core availability search
idx_timeslots_search: (tenant_id, resource_id, start_at)

-- Available capacity filtering
idx_timeslots_available: (tenant_id, start_at, available_capacity)
```

#### Bookings (Critical for reservation management)
```sql
-- Time-based booking queries
idx_bookings_tenant_time: (tenant_id, start_at)

-- Status-filtered booking queries
idx_bookings_status: (tenant_id, status, start_at)
```

### Entity Management Indexes

#### Customers
```sql
-- Customer listing with pagination
idx_customers_tenant_created: (tenant_id, created_at DESC)
```

#### Services & Resources
```sql
-- Active service filtering
idx_services_tenant_active: (tenant_id, active)

-- Resource filtering by type and status
idx_resources_tenant_kind: (tenant_id, kind, active)

-- Service-resource relationships
idx_srv_res_tenant_service: (tenant_id, service_id, active)
```

### Operational Indexes

#### Booking Items (Critical for booking management)
```sql
-- Booking to items lookup
idx_bitems_booking: (booking_id)

-- Timeslot utilization tracking
idx_bitems_timeslot: (timeslot_id)
```

#### Payment Processing
```sql
-- Customer payment methods
idx_pm_tenant_customer: (tenant_id, customer_id, is_default)

-- Payment status tracking
idx_payments_booking: (tenant_id, booking_id, status)
```

### System Indexes

#### Notifications & Outbox
```sql
-- Notification queue processing
idx_notifications_queue: (tenant_id, status, send_at)

-- Outbox event processing
idx_outbox_dispatch: (status, next_attempt_at)
```

#### Maintenance
```sql
-- Idempotency key cleanup
idx_idem_expiry: (expires_at)
```

### Schedule Management
```sql
-- Business hours lookup
idx_bhours_tenant_resource: (tenant_id, resource_id, day_of_week)

-- Resource time-off queries
idx_timeoffs_res_time: (tenant_id, resource_id, start_at, end_at)
```

## Query Pattern Optimization

### 1. Availability Search Pattern
The most critical query pattern for the reservation system:

```sql
-- Optimized by: idx_timeslots_search, idx_timeslots_available
SELECT ts.* FROM timeslots ts
JOIN service_resources sr ON ts.resource_id = sr.resource_id
WHERE ts.tenant_id = $1 
  AND sr.service_id = $2 
  AND sr.active = true
  AND ts.start_at >= $3 
  AND ts.end_at <= $4
  AND ts.available_capacity > 0
ORDER BY ts.start_at, ts.resource_id;
```

### 2. Booking Lookup Pattern
```sql
-- Optimized by: idx_bookings_status
SELECT * FROM bookings 
WHERE tenant_id = $1 
  AND status IN ('confirmed', 'tentative')
  AND start_at BETWEEN $2 AND $3
ORDER BY start_at;
```

### 3. Resource Utilization Pattern
```sql
-- Optimized by: idx_timeslots_search
SELECT resource_id, COUNT(*) as total_slots,
       SUM(CASE WHEN available_capacity = 0 THEN 1 ELSE 0 END) as booked_slots
FROM timeslots 
WHERE tenant_id = $1 
  AND start_at >= $2 
  AND start_at < $3
GROUP BY resource_id;
```

## Index Maintenance Guidelines

### 1. Monitoring
- Monitor index usage with `pg_stat_user_indexes`
- Identify unused indexes for potential removal
- Track index bloat and maintenance needs

### 2. Vacuum Strategy
- Regular VACUUM ANALYZE on high-write tables (timeslots, bookings)
- Consider pg_repack for heavily fragmented indexes

### 3. Partition Considerations
For high-volume tenants, consider partitioning:
- `timeslots` by `start_at` (monthly partitions)
- `bookings` by `start_at` (monthly partitions)
- `audit_logs` by `created_at` (monthly partitions)

## Performance Testing

### Key Metrics to Monitor
1. **Availability Query Performance**: < 50ms for 30-day availability search
2. **Booking Creation**: < 100ms for booking with inventory update
3. **Dashboard Queries**: < 200ms for tenant dashboard data

### Load Testing Scenarios
1. Concurrent availability searches during peak hours
2. Simultaneous booking creation for popular time slots
3. Background maintenance operations during business hours

## Future Optimizations

### 1. Materialized Views
Consider materialized views for:
- Daily availability summaries
- Resource utilization reports
- Revenue analytics

### 2. Additional Indexes
Based on usage patterns, consider:
- Partial indexes for specific tenant configurations
- Expression indexes for computed values
- GIN indexes for JSONB payload searches

### 3. Database-Level Optimizations
- Connection pooling optimization
- Query plan caching strategies
- Read replica configurations for reporting queries