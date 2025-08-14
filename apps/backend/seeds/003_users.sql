-- =========================================================
-- Seed Data: Sample Users and Roles
-- =========================================================

-- Insert sample users with bcrypt hashed passwords
-- Note: All passwords are 'password123' hashed with bcrypt rounds=10
-- Hash: $2b$10$E7DqJyVyKhOgE7EQ5Q5QdOZGNqHzP9LjP6vGX5i5TfKqFx5v5vVK2
INSERT INTO users (email, password_hash, name) VALUES
-- Beauty Salon Users
('admin@beauty-salon-tokyo.com', '$2b$10$E7DqJyVyKhOgE7EQ5Q5QdOZGNqHzP9LjP6vGX5i5TfKqFx5v5vVK2', 'Salon Owner'),
('staff1@beauty-salon-tokyo.com', '$2b$10$E7DqJyVyKhOgE7EQ5Q5QdOZGNqHzP9LjP6vGX5i5TfKqFx5v5vVK2', 'Hairstylist Yuki'),
('staff2@beauty-salon-tokyo.com', '$2b$10$E7DqJyVyKhOgE7EQ5Q5QdOZGNqHzP9LjP6vGX5i5TfKqFx5v5vVK2', 'Nail Artist Mika'),

-- Medical Clinic Users
('doctor@medical-clinic-osaka.com', '$2b$10$E7DqJyVyKhOgE7EQ5Q5QdOZGNqHzP9LjP6vGX5i5TfKqFx5v5vVK2', 'Dr. Tanaka'),
('nurse@medical-clinic-osaka.com', '$2b$10$E7DqJyVyKhOgE7EQ5Q5QdOZGNqHzP9LjP6vGX5i5TfKqFx5v5vVK2', 'Nurse Suzuki'),
('admin@medical-clinic-osaka.com', '$2b$10$E7DqJyVyKhOgE7EQ5Q5QdOZGNqHzP9LjP6vGX5i5TfKqFx5v5vVK2', 'Clinic Administrator'),

-- Restaurant Users
('chef@restaurant-kyoto.com', '$2b$10$E7DqJyVyKhOgE7EQ5Q5QdOZGNqHzP9LjP6vGX5i5TfKqFx5v5vVK2', 'Chef Yamada'),
('manager@restaurant-kyoto.com', '$2b$10$E7DqJyVyKhOgE7EQ5Q5QdOZGNqHzP9LjP6vGX5i5TfKqFx5v5vVK2', 'Restaurant Manager'),
('waiter@restaurant-kyoto.com', '$2b$10$E7DqJyVyKhOgE7EQ5Q5QdOZGNqHzP9LjP6vGX5i5TfKqFx5v5vVK2', 'Waiter Sato')
ON CONFLICT (email) DO NOTHING;

-- Assign users to tenants with appropriate roles
INSERT INTO user_tenant_roles (user_id, tenant_id, role)
SELECT 
  u.id,
  t.id,
  CASE 
    -- Beauty Salon roles
    WHEN u.email = 'admin@beauty-salon-tokyo.com' AND t.code = 'beauty-salon-tokyo' THEN 'owner'
    WHEN u.email LIKE 'staff%@beauty-salon-tokyo.com' AND t.code = 'beauty-salon-tokyo' THEN 'staff'
    
    -- Medical Clinic roles
    WHEN u.email = 'admin@medical-clinic-osaka.com' AND t.code = 'medical-clinic-osaka' THEN 'owner'
    WHEN u.email = 'doctor@medical-clinic-osaka.com' AND t.code = 'medical-clinic-osaka' THEN 'manager'
    WHEN u.email = 'nurse@medical-clinic-osaka.com' AND t.code = 'medical-clinic-osaka' THEN 'staff'
    
    -- Restaurant roles
    WHEN u.email = 'manager@restaurant-kyoto.com' AND t.code = 'restaurant-kyoto' THEN 'owner'
    WHEN u.email = 'chef@restaurant-kyoto.com' AND t.code = 'restaurant-kyoto' THEN 'manager'
    WHEN u.email = 'waiter@restaurant-kyoto.com' AND t.code = 'restaurant-kyoto' THEN 'staff'
    
    ELSE NULL
  END
FROM users u
CROSS JOIN tenants t
WHERE (
  (u.email LIKE '%beauty-salon-tokyo%' AND t.code = 'beauty-salon-tokyo') OR
  (u.email LIKE '%medical-clinic-osaka%' AND t.code = 'medical-clinic-osaka') OR
  (u.email LIKE '%restaurant-kyoto%' AND t.code = 'restaurant-kyoto')
)
AND NOT EXISTS (
  SELECT 1 FROM user_tenant_roles utr 
  WHERE utr.user_id = u.id AND utr.tenant_id = t.id
);