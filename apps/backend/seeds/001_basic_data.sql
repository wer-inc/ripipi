-- =========================================================
-- Seed Data: Basic System Data
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
('system_error', 'System Error')
ON CONFLICT (code) DO NOTHING;