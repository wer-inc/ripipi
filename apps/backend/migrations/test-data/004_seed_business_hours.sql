-- =========================================================
-- Test Data Generation - Business Hours and Schedules
-- =========================================================

-- Insert business hours for demo salon (Tuesday-Saturday, 9 AM - 7 PM)
INSERT INTO business_hours (tenant_id, resource_id, day_of_week, open_time, close_time)
SELECT 
  t.id,
  NULL, -- NULL means applies to all resources in tenant
  dow.day_of_week,
  dow.open_time,
  dow.close_time
FROM tenants t
CROSS JOIN (
  VALUES 
    (2, '09:00'::time, '19:00'::time), -- Tuesday
    (3, '09:00'::time, '19:00'::time), -- Wednesday  
    (4, '09:00'::time, '19:00'::time), -- Thursday
    (5, '09:00'::time, '19:00'::time), -- Friday
    (6, '09:00'::time, '19:00'::time)  -- Saturday
) AS dow(day_of_week, open_time, close_time)
WHERE t.code = 'demo-salon';

-- Insert business hours for test clinic (Monday-Friday, 9 AM - 6 PM)
INSERT INTO business_hours (tenant_id, resource_id, day_of_week, open_time, close_time)
SELECT 
  t.id,
  NULL,
  dow.day_of_week,
  dow.open_time,
  dow.close_time
FROM tenants t
CROSS JOIN (
  VALUES 
    (1, '09:00'::time, '18:00'::time), -- Monday
    (2, '09:00'::time, '18:00'::time), -- Tuesday
    (3, '09:00'::time, '18:00'::time), -- Wednesday
    (4, '09:00'::time, '18:00'::time), -- Thursday
    (5, '09:00'::time, '18:00'::time)  -- Friday
) AS dow(day_of_week, open_time, close_time)
WHERE t.code = 'test-clinic';

-- Insert business hours for dev restaurant (Wednesday-Sunday)
-- Lunch: 11:30 AM - 2:30 PM, Dinner: 5:30 PM - 10:30 PM
INSERT INTO business_hours (tenant_id, resource_id, day_of_week, open_time, close_time)
SELECT 
  t.id,
  NULL,
  dow.day_of_week,
  dow.open_time,
  dow.close_time
FROM tenants t
CROSS JOIN (
  VALUES 
    -- Lunch service
    (3, '11:30'::time, '14:30'::time), -- Wednesday
    (4, '11:30'::time, '14:30'::time), -- Thursday
    (5, '11:30'::time, '14:30'::time), -- Friday
    (6, '11:30'::time, '14:30'::time), -- Saturday
    (0, '11:30'::time, '14:30'::time), -- Sunday
    -- Dinner service
    (3, '17:30'::time, '22:30'::time), -- Wednesday
    (4, '17:30'::time, '22:30'::time), -- Thursday
    (5, '17:30'::time, '22:30'::time), -- Friday
    (6, '17:30'::time, '22:30'::time), -- Saturday
    (0, '17:30'::time, '22:30'::time)  -- Sunday
) AS dow(day_of_week, open_time, close_time)
WHERE t.code = 'dev-restaurant';

-- Insert some holidays for all tenants
INSERT INTO holidays (tenant_id, resource_id, date, name)
SELECT 
  t.id,
  NULL, -- Applies to all resources
  holiday.date,
  holiday.name
FROM tenants t
CROSS JOIN (
  VALUES 
    ('2024-01-01'::date, 'New Year Day'),
    ('2024-01-08'::date, 'Coming of Age Day'),
    ('2024-02-11'::date, 'National Foundation Day'),
    ('2024-02-23'::date, 'Emperor Birthday'),
    ('2024-03-20'::date, 'Vernal Equinox Day'),
    ('2024-04-29'::date, 'Showa Day'),
    ('2024-05-03'::date, 'Constitution Memorial Day'),
    ('2024-05-04'::date, 'Greenery Day'),
    ('2024-05-05'::date, 'Children Day'),
    ('2024-07-15'::date, 'Marine Day'),
    ('2024-08-11'::date, 'Mountain Day'),
    ('2024-09-16'::date, 'Respect for the Aged Day'),
    ('2024-09-23'::date, 'Autumnal Equinox Day'),
    ('2024-10-14'::date, 'Sports Day'),
    ('2024-11-03'::date, 'Culture Day'),
    ('2024-11-23'::date, 'Labor Thanksgiving Day'),
    ('2024-12-29'::date, 'Year End Holiday'),
    ('2024-12-30'::date, 'Year End Holiday'),
    ('2024-12-31'::date, 'Year End Holiday')
) AS holiday(date, name);

-- Insert some specific resource time-offs (staff vacations, maintenance)
INSERT INTO resource_time_offs (tenant_id, resource_id, start_at, end_at, reason)
SELECT 
  r.tenant_id,
  r.id,
  timeoff.start_at,
  timeoff.end_at,
  timeoff.reason
FROM resources r
JOIN tenants t ON r.tenant_id = t.id
CROSS JOIN (
  VALUES 
    ('2024-08-10 09:00:00+09'::timestamptz, '2024-08-16 19:00:00+09'::timestamptz, 'Summer Vacation'),
    ('2024-12-25 09:00:00+09'::timestamptz, '2024-12-28 19:00:00+09'::timestamptz, 'Christmas Holiday'),
    ('2025-01-02 09:00:00+09'::timestamptz, '2025-01-05 19:00:00+09'::timestamptz, 'New Year Holiday')
) AS timeoff(start_at, end_at, reason)
WHERE r.kind = 'staff' 
  AND r.name LIKE '%A%' -- Only apply to some staff members
LIMIT 10; -- Limit to avoid too much test data