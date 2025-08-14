-- =========================================================
-- Seed Data: Sample Tenants
-- =========================================================

-- Insert sample tenants
INSERT INTO tenants (code, name, tz) VALUES
('beauty-salon-tokyo', 'Beauty Salon Tokyo', 'Asia/Tokyo'),
('medical-clinic-osaka', 'Medical Clinic Osaka', 'Asia/Tokyo'),
('restaurant-kyoto', 'Restaurant Kyoto', 'Asia/Tokyo')
ON CONFLICT (code) DO NOTHING;

-- Insert tenant settings for each tenant
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
  CASE 
    WHEN t.code = 'beauty-salon-tokyo' THEN 'JPY'
    WHEN t.code = 'medical-clinic-osaka' THEN 'JPY'
    WHEN t.code = 'restaurant-kyoto' THEN 'JPY'
    ELSE 'JPY'
  END,
  CASE 
    WHEN t.code = 'beauty-salon-tokyo' THEN 1440  -- 24 hours
    WHEN t.code = 'medical-clinic-osaka' THEN 2880  -- 48 hours
    WHEN t.code = 'restaurant-kyoto' THEN 60    -- 1 hour
    ELSE 1440
  END,
  15,   -- 15 minutes grace period
  CASE 
    WHEN t.code = 'beauty-salon-tokyo' THEN 1440  -- 24 hours
    WHEN t.code = 'medical-clinic-osaka' THEN 2880  -- 48 hours
    WHEN t.code = 'restaurant-kyoto' THEN 60    -- 1 hour
    ELSE 1440
  END,
  120,  -- 2 hours
  CASE 
    WHEN t.code = 'beauty-salon-tokyo' THEN 30   -- 30 minute slots
    WHEN t.code = 'medical-clinic-osaka' THEN 15  -- 15 minute slots
    WHEN t.code = 'restaurant-kyoto' THEN 60    -- 1 hour slots
    ELSE 30
  END,
  true
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_settings ts WHERE ts.tenant_id = t.id
);