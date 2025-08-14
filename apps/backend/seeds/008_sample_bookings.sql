-- =========================================================
-- Seed Data: Sample Bookings
-- =========================================================

-- Insert sample bookings for Beauty Salon (upcoming appointments)
WITH beauty_salon AS (
  SELECT id FROM tenants WHERE code = 'beauty-salon-tokyo'
),
hair_cut_service AS (
  SELECT s.id FROM services s, beauty_salon t 
  WHERE s.tenant_id = t.id AND s.name = 'Hair Cut'
),
hair_color_service AS (
  SELECT s.id FROM services s, beauty_salon t 
  WHERE s.tenant_id = t.id AND s.name = 'Hair Color'
),
hanako_customer AS (
  SELECT c.id FROM customers c, beauty_salon t 
  WHERE c.tenant_id = t.id AND c.email = 'hanako.yamada@email.com'
),
yuki_customer AS (
  SELECT c.id FROM customers c, beauty_salon t 
  WHERE c.tenant_id = t.id AND c.email = 'yuki.sato@email.com'
)
INSERT INTO bookings (
  tenant_id, customer_id, service_id, start_at, end_at, 
  status, total_price_jpy, notes, created_at
)
SELECT 
  bs.id,
  customer_id,
  service_id,
  start_time,
  end_time,
  booking_status,
  price,
  booking_notes,
  CURRENT_TIMESTAMP
FROM beauty_salon bs
CROSS JOIN (
  VALUES
    ((SELECT id FROM hanako_customer), (SELECT id FROM hair_cut_service), 
     (CURRENT_DATE + INTERVAL '2 days' + TIME '14:00'), 
     (CURRENT_DATE + INTERVAL '2 days' + TIME '15:00'), 
     'confirmed', 3000, 'Regular appointment'),
    ((SELECT id FROM yuki_customer), (SELECT id FROM hair_color_service), 
     (CURRENT_DATE + INTERVAL '3 days' + TIME '10:00'), 
     (CURRENT_DATE + INTERVAL '3 days' + TIME '12:00'), 
     'confirmed', 8000, 'Color consultation included')
) AS bookings_data(customer_id, service_id, start_time, end_time, booking_status, price, booking_notes)
ON CONFLICT DO NOTHING;

-- Insert sample bookings for Medical Clinic
WITH medical_clinic AS (
  SELECT id FROM tenants WHERE code = 'medical-clinic-osaka'
),
consultation_service AS (
  SELECT s.id FROM services s, medical_clinic t 
  WHERE s.tenant_id = t.id AND s.name = 'General Consultation'
),
checkup_service AS (
  SELECT s.id FROM services s, medical_clinic t 
  WHERE s.tenant_id = t.id AND s.name = 'Health Check-up'
),
hiroshi_customer AS (
  SELECT c.id FROM customers c, medical_clinic t 
  WHERE c.tenant_id = t.id AND c.email = 'hiroshi.kimura@email.com'
),
sachiko_customer AS (
  SELECT c.id FROM customers c, medical_clinic t 
  WHERE c.tenant_id = t.id AND c.email = 'sachiko.nakamura@email.com'
)
INSERT INTO bookings (
  tenant_id, customer_id, service_id, start_at, end_at, 
  status, total_price_jpy, notes, created_at
)
SELECT 
  mc.id,
  customer_id,
  service_id,
  start_time,
  end_time,
  booking_status,
  price,
  booking_notes,
  CURRENT_TIMESTAMP
FROM medical_clinic mc
CROSS JOIN (
  VALUES
    ((SELECT id FROM hiroshi_customer), (SELECT id FROM consultation_service), 
     (CURRENT_DATE + INTERVAL '1 day' + TIME '09:30'), 
     (CURRENT_DATE + INTERVAL '1 day' + TIME '10:00'), 
     'confirmed', 3000, 'Diabetes follow-up'),
    ((SELECT id FROM sachiko_customer), (SELECT id FROM checkup_service), 
     (CURRENT_DATE + INTERVAL '5 days' + TIME '14:00'), 
     (CURRENT_DATE + INTERVAL '5 days' + TIME '15:00'), 
     'confirmed', 8000, 'Annual health check')
) AS bookings_data(customer_id, service_id, start_time, end_time, booking_status, price, booking_notes)
ON CONFLICT DO NOTHING;

-- Insert sample bookings for Restaurant
WITH restaurant AS (
  SELECT id FROM tenants WHERE code = 'restaurant-kyoto'
),
lunch_service AS (
  SELECT s.id FROM services s, restaurant t 
  WHERE s.tenant_id = t.id AND s.name = 'Lunch Course'
),
dinner_service AS (
  SELECT s.id FROM services s, restaurant t 
  WHERE s.tenant_id = t.id AND s.name = 'Dinner Course'
),
john_customer AS (
  SELECT c.id FROM customers c, restaurant t 
  WHERE c.tenant_id = t.id AND c.email = 'john.anderson@email.com'
),
wei_customer AS (
  SELECT c.id FROM customers c, restaurant t 
  WHERE c.tenant_id = t.id AND c.email = 'wei.chen@email.com'
)
INSERT INTO bookings (
  tenant_id, customer_id, service_id, start_at, end_at, 
  status, total_price_jpy, notes, created_at
)
SELECT 
  r.id,
  customer_id,
  service_id,
  start_time,
  end_time,
  booking_status,
  price,
  booking_notes,
  CURRENT_TIMESTAMP
FROM restaurant r
CROSS JOIN (
  VALUES
    ((SELECT id FROM john_customer), (SELECT id FROM lunch_service), 
     (CURRENT_DATE + INTERVAL '1 day' + TIME '12:00'), 
     (CURRENT_DATE + INTERVAL '1 day' + TIME '13:30'), 
     'confirmed', 2500, 'Table for 2, window seat preferred'),
    ((SELECT id FROM wei_customer), (SELECT id FROM dinner_service), 
     (CURRENT_DATE + INTERVAL '2 days' + TIME '18:00'), 
     (CURRENT_DATE + INTERVAL '2 days' + TIME '20:00'), 
     'confirmed', 8000, 'Vegetarian course requested')
) AS bookings_data(customer_id, service_id, start_time, end_time, booking_status, price, booking_notes)
ON CONFLICT DO NOTHING;