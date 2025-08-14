# Database Migrations

This directory contains all database migrations for the reservation system using `node-pg-migrate`.

## Migration Structure

The migrations are organized in dependency order:

1. **1723607400000_setup_extensions_and_functions.js** - PostgreSQL extensions and utility functions
2. **1723607410000_create_core_tables.js** - Core tables (tenants, users, cancel_reasons)
3. **1723607420000_create_tenant_dependent_tables.js** - Tenant-dependent tables (customers, services, resources)
4. **1723607430000_create_relationship_tables.js** - Junction/relationship tables
5. **1723607440000_create_schedule_tables.js** - Schedule management tables
6. **1723607450000_create_timeslots_table.js** - Inventory/timeslots with capacity enforcement
7. **1723607460000_create_booking_tables.js** - Booking and booking items
8. **1723607470000_create_payment_tables.js** - Payment processing tables
9. **1723607480000_create_system_tables.js** - System tables (notifications, audit, etc.)
10. **1723607490000_create_indexes.js** - Performance indexes
11. **1723607500000_create_views.js** - Utility views

## Running Migrations

### Using npm scripts:
```bash
# Run all pending migrations
npm run migrate:up

# Rollback last migration
npm run migrate:down

# Create new migration
npm run migrate:create my_new_migration
```

### Using the migration script:
```bash
# Run migrations
./scripts/migrate.sh up

# Check status
./scripts/migrate.sh status

# Seed test data (development only)
./scripts/migrate.sh seed

# Reset database (development only)
./scripts/migrate.sh reset
```

## Configuration

Migration settings are configured in:
- `.pgmigraterc.json` - node-pg-migrate configuration
- `.env` - Database connection settings

Required environment variables:
```env
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
MIGRATION_SCHEMA=public
MIGRATION_TABLE=pgmigrations
```

## Test Data

The `test-data/` directory contains SQL scripts to populate the database with sample data:

- **001_seed_basic_data.sql** - Core data (tenants, users, cancel reasons)
- **002_seed_services_resources.sql** - Services and resources for different business types
- **003_seed_service_resources.sql** - Service-resource relationships
- **004_seed_business_hours.sql** - Business hours and schedules
- **005_seed_customers.sql** - Sample customers
- **006_generate_timeslots.sql** - Generated timeslots for testing
- **run_all_seeds.sql** - Executes all seed scripts

To run all test data:
```bash
cd migrations/test-data
psql $DATABASE_URL -f run_all_seeds.sql
```

## Database Schema Overview

### Core Tables
- `tenants` - Multi-tenant isolation
- `users` - System users (admin/staff)
- `customers` - End customers making bookings
- `services` - Bookable services
- `resources` - Staff, rooms, equipment, etc.

### Inventory Management
- `timeslots` - Available time slots per resource
- `business_hours` - Operating hours
- `holidays` - Closed dates
- `resource_time_offs` - Staff unavailability

### Booking System
- `bookings` - Customer reservations
- `booking_items` - Links bookings to specific timeslots/resources
- `booking_cancellations` - Cancellation tracking

### Payment Processing
- `payment_methods` - Stored payment methods (Stripe)
- `payments` - Payment transactions
- `webhook_events` - Stripe webhook processing

### System Tables
- `notifications` - Email/SMS/LINE notifications
- `outbox_events` - Event sourcing/messaging
- `audit_logs` - Change tracking
- `idempotency_keys` - Duplicate request prevention

## Index Strategy

Critical indexes for performance:
- `timeslots`: `(tenant_id, resource_id, start_at)` - availability searches
- `bookings`: `(tenant_id, status, start_at)` - booking queries
- `service_resources`: `(tenant_id, service_id, active)` - service mapping

See `INDEX_STRATEGY.md` for detailed indexing documentation.

## Best Practices

### Creating Migrations
1. Always include both `up` and `down` functions
2. Use descriptive names
3. Keep migrations atomic and reversible
4. Test rollbacks in development
5. Add appropriate indexes for new tables

### Schema Changes
1. Never modify existing migrations after they've been deployed
2. Create new migrations for schema changes
3. Be cautious with data-destructive operations
4. Always backup production data before major changes

### Performance Considerations
1. Add indexes for foreign keys and commonly queried columns
2. Use appropriate data types (bigint for IDs, timestamptz for timestamps)
3. Consider partitioning for high-volume tables
4. Monitor query performance and add indexes as needed

## Troubleshooting

### Migration Fails
1. Check database connection
2. Verify migration syntax
3. Check for conflicting constraints
4. Review previous migration state

### Rollback Issues
1. Ensure down function is properly implemented
2. Check for dependent objects (views, functions)
3. Verify data dependencies

### Performance Issues
1. Run ANALYZE after large data changes
2. Check for missing indexes
3. Monitor slow query logs
4. Consider connection pooling

## Production Deployment

### Pre-deployment Checklist
- [ ] Test migrations in staging environment
- [ ] Backup production database
- [ ] Verify rollback procedures
- [ ] Check for breaking changes
- [ ] Review performance impact

### Deployment Process
1. Backup database
2. Run migrations in maintenance window
3. Verify application functionality
4. Monitor performance metrics
5. Have rollback plan ready