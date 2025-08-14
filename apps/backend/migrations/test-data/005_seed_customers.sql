-- =========================================================
-- Test Data Generation - Customers and Sample Bookings
-- =========================================================

-- Insert test customers for demo salon
INSERT INTO customers (tenant_id, name, phone, email, note)
SELECT 
  t.id,
  customer.name,
  customer.phone,
  customer.email,
  customer.note
FROM tenants t
CROSS JOIN (
  VALUES 
    ('Tanaka Yuki', '090-1234-5678', 'yuki.tanaka@example.com', 'Prefers afternoon appointments'),
    ('Sato Hiroshi', '090-2345-6789', 'hiroshi.sato@example.com', 'Regular customer since 2020'),
    ('Yamada Akiko', '090-3456-7890', 'akiko.yamada@example.com', 'Allergic to certain hair products'),
    ('Suzuki Takeshi', '080-4567-8901', 'takeshi.suzuki@example.com', ''),
    ('Watanabe Mari', '080-5678-9012', 'mari.watanabe@example.com', 'Likes trendy styles'),
    ('Ito Kenji', '070-6789-0123', 'kenji.ito@example.com', 'Business executive - values punctuality'),
    ('Nakamura Yuki', '070-7890-1234', 'yuki.nakamura@example.com', 'Student discount applicable'),
    ('Kobayashi Miki', '090-8901-2345', 'miki.kobayashi@example.com', 'Prefers specific stylist'),
    ('Kato Shinji', '080-9012-3456', 'shinji.kato@example.com', ''),
    ('Yoshida Emi', '070-0123-4567', 'emi.yoshida@example.com', 'Long-time customer')
) AS customer(name, phone, email, note)
WHERE t.code = 'demo-salon';

-- Insert test customers for test clinic
INSERT INTO customers (tenant_id, name, phone, email, note)
SELECT 
  t.id,
  customer.name,
  customer.phone,
  customer.email,
  customer.note
FROM tenants t
CROSS JOIN (
  VALUES 
    ('Honda Takeshi', '090-1111-2222', 'takeshi.honda@example.com', 'Diabetic patient - regular checkups'),
    ('Kimura Sachiko', '080-3333-4444', 'sachiko.kimura@example.com', 'Hypertension monitoring'),
    ('Mori Daichi', '070-5555-6666', 'daichi.mori@example.com', 'Sports injury rehabilitation'),
    ('Hayashi Yuki', '090-7777-8888', 'yuki.hayashi@example.com', ''),
    ('Ishii Ryo', '080-9999-0000', 'ryo.ishii@example.com', 'Prefers Dr. Smith'),
    ('Fujita Misaki', '070-1122-3344', 'misaki.fujita@example.com', 'Anxiety about medical procedures'),
    ('Ogawa Hiroto', '090-5566-7788', 'hiroto.ogawa@example.com', 'Regular health checkups'),
    ('Matsuda Chie', '080-9900-1122', 'chie.matsuda@example.com', 'Pregnant - prenatal care'),
    ('Nishida Kenta', '070-3344-5566', 'kenta.nishida@example.com', ''),
    ('Ueda Yui', '090-7788-9900', 'yui.ueda@example.com', 'Allergy testing required')
) AS customer(name, phone, email, note)
WHERE t.code = 'test-clinic';

-- Insert test customers for dev restaurant
INSERT INTO customers (tenant_id, name, phone, email, note)
SELECT 
  t.id,
  customer.name,
  customer.phone,
  customer.email,
  customer.note
FROM tenants t
CROSS JOIN (
  VALUES 
    ('Johnson Michael', '090-2222-3333', 'michael.johnson@example.com', 'VIP customer - wine enthusiast'),
    ('Smith Emma', '080-4444-5555', 'emma.smith@example.com', 'Vegetarian preferences'),
    ('Brown David', '070-6666-7777', 'david.brown@example.com', 'Anniversary celebrations regular'),
    ('Wilson Sarah', '090-8888-9999', 'sarah.wilson@example.com', ''),
    ('Davis Chris', '080-0000-1111', 'chris.davis@example.com', 'Corporate entertainment bookings'),
    ('Miller Lisa', '070-2222-3333', 'lisa.miller@example.com', 'Food allergies - shellfish'),
    ('Taylor Mark', '090-4444-5555', 'mark.taylor@example.com', 'Wine pairing preferences'),
    ('Anderson Kate', '080-6666-7777', 'kate.anderson@example.com', 'Birthday party regular'),
    ('Garcia Luis', '070-8888-9999', 'luis.garcia@example.com', ''),
    ('Martinez Ana', '090-0000-1111', 'ana.martinez@example.com', 'Prefers private dining')
) AS customer(name, phone, email, note)
WHERE t.code = 'dev-restaurant';

-- Insert some consent records for customers (GDPR compliance)
INSERT INTO consents (tenant_id, customer_id, version, text_sha256, accepted_at, accept_ip)
SELECT 
  c.tenant_id,
  c.id,
  'v1.0',
  'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
  c.created_at + INTERVAL '1 hour',
  '192.168.1.100'::inet
FROM customers c
WHERE c.id % 3 = 0; -- Only some customers for variety