-- =========================================================
-- Test Data Generation - Services and Resources
-- =========================================================

-- Insert services for demo salon
INSERT INTO services (tenant_id, name, description, duration_min, price_jpy, buffer_before_min, buffer_after_min)
SELECT 
  t.id,
  service.name,
  service.description,
  service.duration_min,
  service.price_jpy,
  service.buffer_before_min,
  service.buffer_after_min
FROM tenants t
CROSS JOIN (
  VALUES 
    ('Hair Cut', 'Basic hair cutting service', 60, 3000, 10, 10),
    ('Hair Color', 'Professional hair coloring', 120, 8000, 15, 15),
    ('Hair Perm', 'Permanent wave treatment', 180, 12000, 15, 20),
    ('Facial Treatment', 'Deep cleansing facial', 90, 6000, 5, 10),
    ('Manicure', 'Professional nail care', 45, 2500, 5, 5),
    ('Pedicure', 'Professional foot care', 60, 3500, 5, 10)
) AS service(name, description, duration_min, price_jpy, buffer_before_min, buffer_after_min)
WHERE t.code = 'demo-salon';

-- Insert services for test clinic
INSERT INTO services (tenant_id, name, description, duration_min, price_jpy, buffer_before_min, buffer_after_min)
SELECT 
  t.id,
  service.name,
  service.description,
  service.duration_min,
  service.price_jpy,
  service.buffer_before_min,
  service.buffer_after_min
FROM tenants t
CROSS JOIN (
  VALUES 
    ('General Consultation', 'Regular medical consultation', 30, 3000, 5, 5),
    ('Health Checkup', 'Comprehensive health examination', 60, 8000, 10, 10),
    ('Blood Test', 'Laboratory blood analysis', 15, 2000, 5, 0),
    ('X-Ray Examination', 'Radiological examination', 20, 4000, 5, 5),
    ('Physical Therapy', 'Rehabilitation session', 45, 5000, 5, 5),
    ('Vaccination', 'Immunization service', 15, 1500, 5, 15)
) AS service(name, description, duration_min, price_jpy, buffer_before_min, buffer_after_min)
WHERE t.code = 'test-clinic';

-- Insert services for dev restaurant
INSERT INTO services (tenant_id, name, description, duration_min, price_jpy, buffer_before_min, buffer_after_min)
SELECT 
  t.id,
  service.name,
  service.description,
  service.duration_min,
  service.price_jpy,
  service.buffer_before_min,
  service.buffer_after_min
FROM tenants t
CROSS JOIN (
  VALUES 
    ('Dinner Reservation', 'Evening dining experience', 120, 5000, 0, 15),
    ('Lunch Reservation', 'Lunch dining service', 90, 2500, 0, 10),
    ('Private Dining', 'Exclusive private room dining', 150, 15000, 15, 15),
    ('Chef Table Experience', 'Interactive chef table', 180, 25000, 15, 30),
    ('Wine Tasting', 'Curated wine tasting session', 90, 8000, 5, 10)
) AS service(name, description, duration_min, price_jpy, buffer_before_min, buffer_after_min)
WHERE t.code = 'dev-restaurant';

-- Insert resources for demo salon
INSERT INTO resources (tenant_id, kind, name, capacity)
SELECT 
  t.id,
  resource.kind,
  resource.name,
  resource.capacity
FROM tenants t
CROSS JOIN (
  VALUES 
    ('staff', 'Stylist A - Sarah', 1),
    ('staff', 'Stylist B - Mike', 1),
    ('staff', 'Colorist - Emma', 1),
    ('seat', 'Styling Chair 1', 1),
    ('seat', 'Styling Chair 2', 1),
    ('seat', 'Styling Chair 3', 1),
    ('room', 'Color Room A', 1),
    ('room', 'Color Room B', 1),
    ('seat', 'Manicure Station 1', 1),
    ('seat', 'Manicure Station 2', 1)
) AS resource(kind, name, capacity)
WHERE t.code = 'demo-salon';

-- Insert resources for test clinic
INSERT INTO resources (tenant_id, kind, name, capacity)
SELECT 
  t.id,
  resource.kind,
  resource.name,
  resource.capacity
FROM tenants t
CROSS JOIN (
  VALUES 
    ('staff', 'Dr. Smith', 1),
    ('staff', 'Dr. Johnson', 1),
    ('staff', 'Nurse Alice', 1),
    ('staff', 'Nurse Bob', 1),
    ('room', 'Consultation Room 1', 1),
    ('room', 'Consultation Room 2', 1),
    ('room', 'Examination Room A', 1),
    ('room', 'Examination Room B', 1),
    ('room', 'X-Ray Room', 1),
    ('room', 'Physical Therapy Room', 1)
) AS resource(kind, name, capacity)
WHERE t.code = 'test-clinic';

-- Insert resources for dev restaurant
INSERT INTO resources (tenant_id, kind, name, capacity)
SELECT 
  t.id,
  resource.kind,
  resource.name,
  resource.capacity
FROM tenants t
CROSS JOIN (
  VALUES 
    ('staff', 'Chef Tanaka', 1),
    ('staff', 'Server Team A', 1),
    ('staff', 'Server Team B', 1),
    ('table', 'Table 1 (2 seats)', 2),
    ('table', 'Table 2 (4 seats)', 4),
    ('table', 'Table 3 (4 seats)', 4),
    ('table', 'Table 4 (6 seats)', 6),
    ('room', 'Private Room A', 8),
    ('room', 'Private Room B', 12),
    ('table', 'Chef Table', 6)
) AS resource(kind, name, capacity)
WHERE t.code = 'dev-restaurant';