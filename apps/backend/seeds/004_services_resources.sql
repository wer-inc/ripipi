-- =========================================================
-- Seed Data: Services and Resources
-- =========================================================

-- Insert sample services for Beauty Salon
INSERT INTO services (tenant_id, name, description, duration_min, price_jpy, buffer_before_min, buffer_after_min)
SELECT 
  t.id,
  service_name,
  service_description,
  duration,
  price,
  buffer_before,
  buffer_after
FROM tenants t
CROSS JOIN (
  VALUES
    ('Hair Cut', 'Professional hair cutting service', 60, 3000, 0, 15),
    ('Hair Color', 'Hair coloring and highlighting', 120, 8000, 15, 30),
    ('Hair Perm', 'Professional hair perming service', 180, 12000, 15, 30),
    ('Manicure', 'Basic nail care and polish', 45, 2500, 0, 10),
    ('Pedicure', 'Foot care and nail polish', 60, 3500, 0, 15),
    ('Facial Treatment', 'Deep cleansing facial treatment', 90, 6000, 15, 15)
) AS services(service_name, service_description, duration, price, buffer_before, buffer_after)
WHERE t.code = 'beauty-salon-tokyo'
ON CONFLICT DO NOTHING;

-- Insert sample services for Medical Clinic
INSERT INTO services (tenant_id, name, description, duration_min, price_jpy, buffer_before_min, buffer_after_min)
SELECT 
  t.id,
  service_name,
  service_description,
  duration,
  price,
  buffer_before,
  buffer_after
FROM tenants t
CROSS JOIN (
  VALUES
    ('General Consultation', 'General medical consultation', 30, 3000, 0, 15),
    ('Health Check-up', 'Comprehensive health examination', 60, 8000, 15, 15),
    ('Blood Test', 'Blood sample collection and analysis', 15, 2000, 0, 0),
    ('X-Ray Examination', 'X-ray imaging service', 20, 4000, 10, 5),
    ('Vaccination', 'Various vaccination services', 15, 3000, 0, 15),
    ('Physical Therapy', 'Rehabilitation and physical therapy', 45, 5000, 0, 15)
) AS services(service_name, service_description, duration, price, buffer_before, buffer_after)
WHERE t.code = 'medical-clinic-osaka'
ON CONFLICT DO NOTHING;

-- Insert sample services for Restaurant
INSERT INTO services (tenant_id, name, description, duration_min, price_jpy, buffer_before_min, buffer_after_min)
SELECT 
  t.id,
  service_name,
  service_description,
  duration,
  price,
  buffer_before,
  buffer_after
FROM tenants t
CROSS JOIN (
  VALUES
    ('Lunch Course', 'Traditional Japanese lunch course', 90, 2500, 15, 15),
    ('Dinner Course', 'Premium kaiseki dinner course', 120, 8000, 15, 30),
    ('Private Dining', 'Private room dining experience', 150, 15000, 30, 30),
    ('Tea Ceremony', 'Traditional tea ceremony experience', 60, 3000, 15, 15),
    ('Cooking Class', 'Learn traditional Japanese cooking', 180, 5000, 30, 30)
) AS services(service_name, service_description, duration, price, buffer_before, buffer_after)
WHERE t.code = 'restaurant-kyoto'
ON CONFLICT DO NOTHING;

-- Insert sample resources for Beauty Salon
INSERT INTO resources (tenant_id, kind, name, capacity)
SELECT 
  t.id,
  resource_kind,
  resource_name,
  capacity
FROM tenants t
CROSS JOIN (
  VALUES
    ('staff', 'Hairstylist Yuki', 1),
    ('staff', 'Nail Artist Mika', 1),
    ('seat', 'Hair Station 1', 1),
    ('seat', 'Hair Station 2', 1),
    ('seat', 'Hair Station 3', 1),
    ('room', 'Nail Room', 1),
    ('room', 'Facial Room', 1)
) AS resources(resource_kind, resource_name, capacity)
WHERE t.code = 'beauty-salon-tokyo'
ON CONFLICT DO NOTHING;

-- Insert sample resources for Medical Clinic
INSERT INTO resources (tenant_id, kind, name, capacity)
SELECT 
  t.id,
  resource_kind,
  resource_name,
  capacity
FROM tenants t
CROSS JOIN (
  VALUES
    ('staff', 'Dr. Tanaka', 1),
    ('staff', 'Nurse Suzuki', 1),
    ('room', 'Consultation Room 1', 1),
    ('room', 'Consultation Room 2', 1),
    ('room', 'Examination Room', 1),
    ('room', 'X-Ray Room', 1),
    ('room', 'Physical Therapy Room', 1)
) AS resources(resource_kind, resource_name, capacity)
WHERE t.code = 'medical-clinic-osaka'
ON CONFLICT DO NOTHING;

-- Insert sample resources for Restaurant
INSERT INTO resources (tenant_id, kind, name, capacity)
SELECT 
  t.id,
  resource_kind,
  resource_name,
  capacity
FROM tenants t
CROSS JOIN (
  VALUES
    ('staff', 'Chef Yamada', 1),
    ('staff', 'Waiter Sato', 1),
    ('table', 'Table 1 (2 seats)', 2),
    ('table', 'Table 2 (4 seats)', 4),
    ('table', 'Table 3 (6 seats)', 6),
    ('room', 'Private Room A', 8),
    ('room', 'Private Room B', 12),
    ('room', 'Tea Room', 4)
) AS resources(resource_kind, resource_name, capacity)
WHERE t.code = 'restaurant-kyoto'
ON CONFLICT DO NOTHING;