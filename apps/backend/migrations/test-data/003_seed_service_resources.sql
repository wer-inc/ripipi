-- =========================================================
-- Test Data Generation - Service Resource Relationships
-- =========================================================

-- Map salon services to appropriate resources
INSERT INTO service_resources (tenant_id, service_id, resource_id, active)
SELECT DISTINCT
  s.tenant_id,
  s.id as service_id,
  r.id as resource_id,
  true
FROM services s
JOIN resources r ON s.tenant_id = r.tenant_id
JOIN tenants t ON s.tenant_id = t.id
WHERE t.code = 'demo-salon'
AND (
  -- Hair Cut: Stylists + Styling Chairs
  (s.name = 'Hair Cut' AND (r.name LIKE 'Stylist%' OR r.name LIKE 'Styling Chair%')) OR
  
  -- Hair Color: Colorist + Color Rooms
  (s.name = 'Hair Color' AND (r.name LIKE 'Colorist%' OR r.name LIKE 'Color Room%')) OR
  
  -- Hair Perm: Colorist + Color Rooms (similar to coloring)
  (s.name = 'Hair Perm' AND (r.name LIKE 'Colorist%' OR r.name LIKE 'Color Room%')) OR
  
  -- Facial Treatment: Stylists + Styling Chairs
  (s.name = 'Facial Treatment' AND (r.name LIKE 'Stylist%' OR r.name LIKE 'Styling Chair%')) OR
  
  -- Manicure: Manicure Stations only
  (s.name = 'Manicure' AND r.name LIKE 'Manicure Station%') OR
  
  -- Pedicure: Manicure Stations (can handle both)
  (s.name = 'Pedicure' AND r.name LIKE 'Manicure Station%')
);

-- Map clinic services to appropriate resources
INSERT INTO service_resources (tenant_id, service_id, resource_id, active)
SELECT DISTINCT
  s.tenant_id,
  s.id as service_id,
  r.id as resource_id,
  true
FROM services s
JOIN resources r ON s.tenant_id = r.tenant_id
JOIN tenants t ON s.tenant_id = t.id
WHERE t.code = 'test-clinic'
AND (
  -- General Consultation: Doctors + Consultation Rooms
  (s.name = 'General Consultation' AND (r.name LIKE 'Dr.%' OR r.name LIKE 'Consultation Room%')) OR
  
  -- Health Checkup: Doctors + Examination Rooms
  (s.name = 'Health Checkup' AND (r.name LIKE 'Dr.%' OR r.name LIKE 'Examination Room%')) OR
  
  -- Blood Test: Nurses + Examination Rooms
  (s.name = 'Blood Test' AND (r.name LIKE 'Nurse%' OR r.name LIKE 'Examination Room%')) OR
  
  -- X-Ray: Any staff + X-Ray Room
  (s.name = 'X-Ray Examination' AND (r.kind = 'staff' OR r.name = 'X-Ray Room')) OR
  
  -- Physical Therapy: Nurses + PT Room
  (s.name = 'Physical Therapy' AND (r.name LIKE 'Nurse%' OR r.name = 'Physical Therapy Room')) OR
  
  -- Vaccination: Nurses + Consultation/Examination Rooms
  (s.name = 'Vaccination' AND (r.name LIKE 'Nurse%' OR r.name LIKE '%Room%'))
);

-- Map restaurant services to appropriate resources
INSERT INTO service_resources (tenant_id, service_id, resource_id, active)
SELECT DISTINCT
  s.tenant_id,
  s.id as service_id,
  r.id as resource_id,
  true
FROM services s
JOIN resources r ON s.tenant_id = r.tenant_id
JOIN tenants t ON s.tenant_id = t.id
WHERE t.code = 'dev-restaurant'
AND (
  -- Dinner Reservation: Server Teams + Regular Tables
  (s.name = 'Dinner Reservation' AND (r.name LIKE 'Server Team%' OR (r.kind = 'table' AND r.name NOT LIKE 'Chef%'))) OR
  
  -- Lunch Reservation: Server Teams + Regular Tables
  (s.name = 'Lunch Reservation' AND (r.name LIKE 'Server Team%' OR (r.kind = 'table' AND r.name NOT LIKE 'Chef%'))) OR
  
  -- Private Dining: Server Teams + Private Rooms
  (s.name = 'Private Dining' AND (r.name LIKE 'Server Team%' OR r.name LIKE 'Private Room%')) OR
  
  -- Chef Table: Chef + Chef Table
  (s.name = 'Chef Table Experience' AND (r.name LIKE 'Chef%' OR r.name = 'Chef Table')) OR
  
  -- Wine Tasting: Server Teams + Private Rooms or Chef Table
  (s.name = 'Wine Tasting' AND (r.name LIKE 'Server Team%' OR r.name LIKE 'Private Room%' OR r.name = 'Chef Table'))
);