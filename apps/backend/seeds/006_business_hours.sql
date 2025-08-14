-- =========================================================
-- Seed Data: Business Hours
-- =========================================================

-- Insert business hours for Beauty Salon (closed on Mondays)
INSERT INTO business_hours (tenant_id, day_of_week, start_time, end_time, active)
SELECT 
  t.id,
  dow,
  start_time::time,
  end_time::time,
  is_active
FROM tenants t
CROSS JOIN (
  VALUES
    (0, '10:00', '19:00', true),  -- Sunday
    (1, '10:00', '19:00', false), -- Monday (closed)
    (2, '10:00', '19:00', true),  -- Tuesday
    (3, '10:00', '19:00', true),  -- Wednesday
    (4, '10:00', '19:00', true),  -- Thursday
    (5, '10:00', '20:00', true),  -- Friday (late)
    (6, '09:00', '18:00', true)   -- Saturday
) AS hours(dow, start_time, end_time, is_active)
WHERE t.code = 'beauty-salon-tokyo'
ON CONFLICT DO NOTHING;

-- Insert business hours for Medical Clinic (closed on Sundays)
INSERT INTO business_hours (tenant_id, day_of_week, start_time, end_time, active)
SELECT 
  t.id,
  dow,
  start_time::time,
  end_time::time,
  is_active
FROM tenants t
CROSS JOIN (
  VALUES
    (0, '09:00', '17:00', false), -- Sunday (closed)
    (1, '09:00', '17:00', true),  -- Monday
    (2, '09:00', '17:00', true),  -- Tuesday
    (3, '09:00', '12:00', true),  -- Wednesday (half day)
    (4, '09:00', '17:00', true),  -- Thursday
    (5, '09:00', '17:00', true),  -- Friday
    (6, '09:00', '15:00', true)   -- Saturday (short day)
) AS hours(dow, start_time, end_time, is_active)
WHERE t.code = 'medical-clinic-osaka'
ON CONFLICT DO NOTHING;

-- Insert business hours for Restaurant (open every day)
INSERT INTO business_hours (tenant_id, day_of_week, start_time, end_time, active)
SELECT 
  t.id,
  dow,
  start_time::time,
  end_time::time,
  is_active
FROM tenants t
CROSS JOIN (
  VALUES
    (0, '11:00', '22:00', true), -- Sunday
    (1, '11:00', '22:00', true), -- Monday
    (2, '11:00', '22:00', true), -- Tuesday
    (3, '11:00', '22:00', true), -- Wednesday
    (4, '11:00', '22:00', true), -- Thursday
    (5, '11:00', '23:00', true), -- Friday (late)
    (6, '11:00', '23:00', true)  -- Saturday (late)
) AS hours(dow, start_time, end_time, is_active)
WHERE t.code = 'restaurant-kyoto'
ON CONFLICT DO NOTHING;