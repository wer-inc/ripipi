-- =========================================================
-- Run All Test Data Seeds
-- =========================================================
-- Execute this file to populate the database with comprehensive test data
-- Run after all migrations have been applied

\echo 'Starting test data seeding...'

\echo '1. Creating basic data (tenants, users, cancel reasons)...'
\i 001_seed_basic_data.sql

\echo '2. Creating services and resources...'
\i 002_seed_services_resources.sql

\echo '3. Creating service-resource relationships...'
\i 003_seed_service_resources.sql

\echo '4. Creating business hours and schedules...'
\i 004_seed_business_hours.sql

\echo '5. Creating customers...'
\i 005_seed_customers.sql

\echo '6. Generating timeslots...'
\i 006_generate_timeslots.sql

\echo 'Test data seeding completed!'

-- Display summary statistics
\echo ''
\echo 'Test Data Summary:'
\echo '=================='

SELECT 'Tenants' as entity, COUNT(*) as count FROM tenants
UNION ALL
SELECT 'Users', COUNT(*) FROM users
UNION ALL
SELECT 'Services', COUNT(*) FROM services
UNION ALL
SELECT 'Resources', COUNT(*) FROM resources
UNION ALL
SELECT 'Customers', COUNT(*) FROM customers
UNION ALL
SELECT 'Timeslots', COUNT(*) FROM timeslots
UNION ALL
SELECT 'Available Timeslots', COUNT(*) FROM timeslots WHERE available_capacity > 0
UNION ALL
SELECT 'Service-Resource Mappings', COUNT(*) FROM service_resources
UNION ALL
SELECT 'Business Hours', COUNT(*) FROM business_hours
UNION ALL
SELECT 'Holidays', COUNT(*) FROM holidays;

\echo ''
\echo 'Sample Queries to Test:'
\echo '======================'
\echo '-- Available timeslots for next 7 days:'
\echo 'SELECT * FROM v_available_timeslots WHERE start_at BETWEEN NOW() AND NOW() + INTERVAL ''7 days'' LIMIT 10;'
\echo ''
\echo '-- Active services with their resources:'
\echo 'SELECT * FROM v_active_service_resources LIMIT 10;'
\echo ''
\echo '-- Resource utilization:'
\echo 'SELECT * FROM v_resource_utilization LIMIT 10;'