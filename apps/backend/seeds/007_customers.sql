-- =========================================================
-- Seed Data: Sample Customers
-- =========================================================

-- Insert sample customers for Beauty Salon
INSERT INTO customers (tenant_id, name, phone, email, note)
SELECT 
  t.id,
  customer_name,
  phone_number,
  email_address,
  customer_note
FROM tenants t
CROSS JOIN (
  VALUES
    ('Yamada Hanako', '090-1234-5678', 'hanako.yamada@email.com', 'Regular customer, prefers afternoon appointments'),
    ('Sato Yuki', '080-9876-5432', 'yuki.sato@email.com', 'Allergic to certain hair products'),
    ('Tanaka Mei', '070-5555-1234', 'mei.tanaka@email.com', 'New customer, first visit'),
    ('Watanabe Akiko', '090-7777-8888', 'akiko.watanabe@email.com', 'VIP customer, book premium services'),
    ('Kobayashi Rina', '080-3333-4444', 'rina.kobayashi@email.com', 'Prefers Yuki as stylist'),
    ('Suzuki Mana', '070-1111-2222', 'mana.suzuki@email.com', 'Monthly regular for nail services')
) AS customers(customer_name, phone_number, email_address, customer_note)
WHERE t.code = 'beauty-salon-tokyo'
ON CONFLICT (tenant_id, email) DO NOTHING;

-- Insert sample customers for Medical Clinic
INSERT INTO customers (tenant_id, name, phone, email, note)
SELECT 
  t.id,
  customer_name,
  phone_number,
  email_address,
  customer_note
FROM tenants t
CROSS JOIN (
  VALUES
    ('Kimura Hiroshi', '090-2222-3333', 'hiroshi.kimura@email.com', 'Diabetes patient, regular check-ups'),
    ('Nakamura Sachiko', '080-4444-5555', 'sachiko.nakamura@email.com', 'Hypertension monitoring'),
    ('Ito Kenji', '070-6666-7777', 'kenji.ito@email.com', 'Annual health check-up'),
    ('Saito Yoko', '090-8888-9999', 'yoko.saito@email.com', 'Physical therapy patient'),
    ('Takahashi Taro', '080-1010-2020', 'taro.takahashi@email.com', 'Regular vaccination schedule'),
    ('Matsumoto Emi', '070-3030-4040', 'emi.matsumoto@email.com', 'New patient, first consultation')
) AS customers(customer_name, phone_number, email_address, customer_note)
WHERE t.code = 'medical-clinic-osaka'
ON CONFLICT (tenant_id, email) DO NOTHING;

-- Insert sample customers for Restaurant
INSERT INTO customers (tenant_id, name, phone, email, note)
SELECT 
  t.id,
  customer_name,
  phone_number,
  email_address,
  customer_note
FROM tenants t
CROSS JOIN (
  VALUES
    ('Anderson John', '090-5555-6666', 'john.anderson@email.com', 'Foreign customer, speaks basic Japanese'),
    ('Chen Wei', '080-7777-8888', 'wei.chen@email.com', 'Vegetarian preferences'),
    ('Smith Emily', '070-9999-0000', 'emily.smith@email.com', 'Regular for tea ceremony'),
    ('Hayashi Kenta', '090-1212-3434', 'kenta.hayashi@email.com', 'Corporate client, group bookings'),
    ('Fujita Yui', '080-5656-7878', 'yui.fujita@email.com', 'Anniversary dinner regular'),
    ('Morimoto Shinji', '070-9090-1212', 'shinji.morimoto@email.com', 'Cooking class enthusiast')
) AS customers(customer_name, phone_number, email_address, customer_note)
WHERE t.code = 'restaurant-kyoto'
ON CONFLICT (tenant_id, email) DO NOTHING;