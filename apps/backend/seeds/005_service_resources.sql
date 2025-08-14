-- =========================================================
-- Seed Data: Service-Resource Relationships
-- =========================================================

-- Link Beauty Salon services to resources
INSERT INTO service_resources (service_id, resource_id, required_count)
SELECT 
  s.id,
  r.id,
  CASE
    WHEN s.name IN ('Hair Cut', 'Hair Color', 'Hair Perm') AND r.name = 'Hairstylist Yuki' THEN 1
    WHEN s.name IN ('Hair Cut', 'Hair Color', 'Hair Perm') AND r.name LIKE 'Hair Station%' THEN 1
    WHEN s.name IN ('Manicure', 'Pedicure') AND r.name = 'Nail Artist Mika' THEN 1
    WHEN s.name IN ('Manicure', 'Pedicure') AND r.name = 'Nail Room' THEN 1
    WHEN s.name = 'Facial Treatment' AND r.name = 'Facial Room' THEN 1
    ELSE NULL
  END
FROM services s
CROSS JOIN resources r
INNER JOIN tenants t ON s.tenant_id = t.id AND r.tenant_id = t.id
WHERE t.code = 'beauty-salon-tokyo'
  AND (
    (s.name IN ('Hair Cut', 'Hair Color', 'Hair Perm') AND (r.name = 'Hairstylist Yuki' OR r.name LIKE 'Hair Station%')) OR
    (s.name IN ('Manicure', 'Pedicure') AND (r.name = 'Nail Artist Mika' OR r.name = 'Nail Room')) OR
    (s.name = 'Facial Treatment' AND r.name = 'Facial Room')
  )
ON CONFLICT DO NOTHING;

-- Link Medical Clinic services to resources
INSERT INTO service_resources (service_id, resource_id, required_count)
SELECT 
  s.id,
  r.id,
  CASE
    WHEN s.name IN ('General Consultation', 'Health Check-up') AND r.name = 'Dr. Tanaka' THEN 1
    WHEN s.name IN ('General Consultation', 'Health Check-up') AND r.name LIKE 'Consultation Room%' THEN 1
    WHEN s.name = 'Blood Test' AND r.name = 'Nurse Suzuki' THEN 1
    WHEN s.name = 'X-Ray Examination' AND r.name = 'X-Ray Room' THEN 1
    WHEN s.name = 'Vaccination' AND r.name = 'Nurse Suzuki' THEN 1
    WHEN s.name = 'Vaccination' AND r.name = 'Examination Room' THEN 1
    WHEN s.name = 'Physical Therapy' AND r.name = 'Physical Therapy Room' THEN 1
    ELSE NULL
  END
FROM services s
CROSS JOIN resources r
INNER JOIN tenants t ON s.tenant_id = t.id AND r.tenant_id = t.id
WHERE t.code = 'medical-clinic-osaka'
  AND (
    (s.name IN ('General Consultation', 'Health Check-up') AND (r.name = 'Dr. Tanaka' OR r.name LIKE 'Consultation Room%')) OR
    (s.name = 'Blood Test' AND r.name = 'Nurse Suzuki') OR
    (s.name = 'X-Ray Examination' AND r.name = 'X-Ray Room') OR
    (s.name = 'Vaccination' AND (r.name = 'Nurse Suzuki' OR r.name = 'Examination Room')) OR
    (s.name = 'Physical Therapy' AND r.name = 'Physical Therapy Room')
  )
ON CONFLICT DO NOTHING;

-- Link Restaurant services to resources
INSERT INTO service_resources (service_id, resource_id, required_count)
SELECT 
  s.id,
  r.id,
  CASE
    WHEN s.name = 'Lunch Course' AND r.kind = 'table' THEN 1
    WHEN s.name = 'Dinner Course' AND r.kind = 'table' THEN 1
    WHEN s.name = 'Private Dining' AND r.name LIKE 'Private Room%' THEN 1
    WHEN s.name = 'Tea Ceremony' AND r.name = 'Tea Room' THEN 1
    WHEN s.name = 'Cooking Class' AND r.name = 'Chef Yamada' THEN 1
    WHEN s.name IN ('Lunch Course', 'Dinner Course', 'Private Dining', 'Cooking Class') AND r.name = 'Waiter Sato' THEN 1
    ELSE NULL
  END
FROM services s
CROSS JOIN resources r
INNER JOIN tenants t ON s.tenant_id = t.id AND r.tenant_id = t.id
WHERE t.code = 'restaurant-kyoto'
  AND (
    (s.name IN ('Lunch Course', 'Dinner Course') AND r.kind = 'table') OR
    (s.name = 'Private Dining' AND r.name LIKE 'Private Room%') OR
    (s.name = 'Tea Ceremony' AND r.name = 'Tea Room') OR
    (s.name = 'Cooking Class' AND r.name = 'Chef Yamada') OR
    (s.name IN ('Lunch Course', 'Dinner Course', 'Private Dining', 'Cooking Class') AND r.name = 'Waiter Sato')
  )
ON CONFLICT DO NOTHING;