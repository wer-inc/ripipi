-- =========================================================
-- Test Data Generation - Basic Data
-- =========================================================

-- Insert cancel reasons
INSERT INTO cancel_reasons (code, label) VALUES
('customer_request', 'Customer Request'),
('weather', 'Weather Conditions'),
('overbook_fix', 'Overbooking Correction'),
('staff_unavailable', 'Staff Unavailable'),
('facility_maintenance', 'Facility Maintenance'),
('emergency', 'Emergency Situation'),
('no_show', 'Customer No-Show'),
('system_error', 'System Error');

-- Insert test tenants
INSERT INTO tenants (code, name, tz) VALUES
('demo-salon', 'Demo Beauty Salon', 'Asia/Tokyo'),
('test-clinic', 'Test Medical Clinic', 'Asia/Tokyo'),
('dev-restaurant', 'Dev Restaurant', 'Asia/Tokyo');

-- Get tenant IDs for further inserts
-- (In a real migration, you'd use the actual IDs or use variables)

-- Insert tenant settings
INSERT INTO tenant_settings (
  tenant_id, 
  currency_code, 
  cancel_cutoff_min, 
  noshow_grace_min, 
  reminder_1_min, 
  reminder_2_min, 
  granularity_min,
  allow_public_booking
) 
SELECT 
  t.id,
  'JPY',
  1440, -- 24 hours
  15,   -- 15 minutes
  1440, -- 24 hours
  120,  -- 2 hours
  30,   -- 30 minute slots
  true
FROM tenants t;

-- Insert test users
INSERT INTO users (email, password_hash, name) VALUES
('admin@demo-salon.com', '$2b$10$dummy.hash.for.testing', 'Salon Admin'),
('staff@demo-salon.com', '$2b$10$dummy.hash.for.testing', 'Salon Staff'),
('manager@test-clinic.com', '$2b$10$dummy.hash.for.testing', 'Clinic Manager'),
('doctor@test-clinic.com', '$2b$10$dummy.hash.for.testing', 'Dr. Smith'),
('owner@dev-restaurant.com', '$2b$10$dummy.hash.for.testing', 'Restaurant Owner');

-- Insert user-tenant roles
INSERT INTO user_tenant_roles (user_id, tenant_id, role)
SELECT 
  u.id,
  t.id,
  CASE 
    WHEN u.email LIKE '%admin%' OR u.email LIKE '%owner%' THEN 'owner'
    WHEN u.email LIKE '%manager%' THEN 'manager'
    WHEN u.email LIKE '%staff%' OR u.email LIKE '%doctor%' THEN 'staff'
    ELSE 'viewer'
  END
FROM users u
CROSS JOIN tenants t
WHERE 
  (u.email LIKE '%demo-salon%' AND t.code = 'demo-salon') OR
  (u.email LIKE '%test-clinic%' AND t.code = 'test-clinic') OR
  (u.email LIKE '%dev-restaurant%' AND t.code = 'dev-restaurant');