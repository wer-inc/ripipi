#!/bin/bash

# Migration Management Script
# Provides convenient commands for database migrations

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Default values
ENVIRONMENT=${NODE_ENV:-development}
DATABASE_URL=${DATABASE_URL:-"postgresql://ripipi_user:password@localhost:5432/ripipi_db"}

echo -e "${BLUE}🗃️  Database Migration Management${NC}"
echo -e "Environment: ${YELLOW}${ENVIRONMENT}${NC}"
echo -e "Database: ${YELLOW}${DATABASE_URL}${NC}"
echo ""

# Function to run migrations
migrate_up() {
    echo -e "${GREEN}⬆️  Running migrations up...${NC}"
    npm run migrate:up
    echo -e "${GREEN}✅ Migrations completed successfully${NC}"
}

# Function to rollback migrations
migrate_down() {
    echo -e "${YELLOW}⬇️  Rolling back last migration...${NC}"
    read -p "Are you sure you want to rollback? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        npm run migrate:down
        echo -e "${GREEN}✅ Rollback completed${NC}"
    else
        echo -e "${YELLOW}❌ Rollback cancelled${NC}"
    fi
}

# Function to create new migration
create_migration() {
    if [ -z "$1" ]; then
        echo -e "${RED}❌ Error: Migration name is required${NC}"
        echo "Usage: $0 create <migration_name>"
        exit 1
    fi
    
    echo -e "${GREEN}📝 Creating new migration: $1${NC}"
    npm run migrate:create -- "$1"
    echo -e "${GREEN}✅ Migration file created${NC}"
}

# Function to check migration status
migration_status() {
    echo -e "${BLUE}📊 Checking migration status...${NC}"
    
    # Connect to database and check migrations table
    psql "$DATABASE_URL" -c "
        SELECT 
            name,
            run_on,
            CASE 
                WHEN run_on IS NOT NULL THEN '✅ Applied'
                ELSE '❌ Pending'
            END as status
        FROM pgmigrations 
        ORDER BY id;
    " 2>/dev/null || echo -e "${YELLOW}⚠️  No migrations table found. Run migrations first.${NC}"
}

# Function to seed test data
seed_data() {
    echo -e "${GREEN}🌱 Seeding test data...${NC}"
    
    if [ "$ENVIRONMENT" = "production" ]; then
        echo -e "${RED}❌ Error: Cannot seed data in production environment${NC}"
        exit 1
    fi
    
    read -p "This will add test data to the database. Continue? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cd migrations/test-data
        psql "$DATABASE_URL" -f run_all_seeds.sql
        echo -e "${GREEN}✅ Test data seeded successfully${NC}"
    else
        echo -e "${YELLOW}❌ Seeding cancelled${NC}"
    fi
}

# Function to reset database (development only)
reset_database() {
    if [ "$ENVIRONMENT" = "production" ]; then
        echo -e "${RED}❌ Error: Cannot reset database in production environment${NC}"
        exit 1
    fi
    
    echo -e "${RED}⚠️  WARNING: This will destroy all data in the database!${NC}"
    read -p "Are you absolutely sure? Type 'RESET' to confirm: " -r
    echo
    if [[ $REPLY = "RESET" ]]; then
        echo -e "${YELLOW}🗑️  Dropping all tables...${NC}"
        
        # Drop all tables in reverse dependency order
        psql "$DATABASE_URL" -c "
            DROP TABLE IF EXISTS booking_cancellations CASCADE;
            DROP TABLE IF EXISTS booking_items CASCADE;
            DROP TABLE IF EXISTS bookings CASCADE;
            DROP TABLE IF EXISTS payments CASCADE;
            DROP TABLE IF EXISTS payment_methods CASCADE;
            DROP TABLE IF EXISTS webhook_events CASCADE;
            DROP TABLE IF EXISTS notifications CASCADE;
            DROP TABLE IF EXISTS outbox_events CASCADE;
            DROP TABLE IF EXISTS audit_logs CASCADE;
            DROP TABLE IF EXISTS idempotency_keys CASCADE;
            DROP TABLE IF EXISTS timeslots CASCADE;
            DROP TABLE IF EXISTS resource_time_offs CASCADE;
            DROP TABLE IF EXISTS holidays CASCADE;
            DROP TABLE IF EXISTS business_hours CASCADE;
            DROP TABLE IF EXISTS resource_group_members CASCADE;
            DROP TABLE IF EXISTS service_resources CASCADE;
            DROP TABLE IF EXISTS consents CASCADE;
            DROP TABLE IF EXISTS user_tenant_roles CASCADE;
            DROP TABLE IF EXISTS resource_groups CASCADE;
            DROP TABLE IF EXISTS resources CASCADE;
            DROP TABLE IF EXISTS services CASCADE;
            DROP TABLE IF EXISTS customers CASCADE;
            DROP TABLE IF EXISTS tenant_settings CASCADE;
            DROP TABLE IF EXISTS cancel_reasons CASCADE;
            DROP TABLE IF EXISTS users CASCADE;
            DROP TABLE IF EXISTS tenants CASCADE;
            DROP TABLE IF EXISTS pgmigrations CASCADE;
            DROP FUNCTION IF EXISTS set_updated_at() CASCADE;
            DROP FUNCTION IF EXISTS enforce_timeslot_capacity() CASCADE;
            DROP VIEW IF EXISTS v_resource_utilization CASCADE;
            DROP VIEW IF EXISTS v_upcoming_bookings CASCADE;
            DROP VIEW IF EXISTS v_active_service_resources CASCADE;
            DROP VIEW IF EXISTS v_available_timeslots CASCADE;
        "
        
        echo -e "${GREEN}⬆️  Running migrations...${NC}"
        migrate_up
        echo -e "${GREEN}✅ Database reset completed${NC}"
    else
        echo -e "${YELLOW}❌ Reset cancelled${NC}"
    fi
}

# Function to show help
show_help() {
    echo "Database Migration Management Commands:"
    echo ""
    echo "  up              Run all pending migrations"
    echo "  down            Rollback the last migration"
    echo "  create <name>   Create a new migration file"
    echo "  status          Show migration status"
    echo "  seed            Seed test data (development only)"
    echo "  reset           Reset database (development only)"
    echo "  help            Show this help message"
    echo ""
}

# Main command handler
case "${1:-help}" in
    up)
        migrate_up
        ;;
    down)
        migrate_down
        ;;
    create)
        create_migration "$2"
        ;;
    status)
        migration_status
        ;;
    seed)
        seed_data
        ;;
    reset)
        reset_database
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo -e "${RED}❌ Unknown command: $1${NC}"
        echo ""
        show_help
        exit 1
        ;;
esac