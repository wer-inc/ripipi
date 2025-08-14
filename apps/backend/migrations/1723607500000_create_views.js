/**
 * Migration: Create Views
 * Creates useful views for application queries
 */

exports.up = pgm => {
  // Create view for available timeslots
  pgm.createView('v_available_timeslots', {}, `
    SELECT
      t.id           AS timeslot_id,
      t.tenant_id,
      t.resource_id,
      t.start_at,
      t.end_at,
      t.available_capacity
    FROM timeslots t
    WHERE t.available_capacity > 0
  `);

  // Create view for active services with resources
  pgm.createView('v_active_service_resources', {}, `
    SELECT 
      s.id AS service_id,
      s.tenant_id,
      s.name AS service_name,
      s.duration_min,
      s.price_jpy,
      s.buffer_before_min,
      s.buffer_after_min,
      r.id AS resource_id,
      r.name AS resource_name,
      r.kind AS resource_kind,
      r.capacity AS resource_capacity
    FROM services s
    JOIN service_resources sr ON s.id = sr.service_id AND s.tenant_id = sr.tenant_id
    JOIN resources r ON sr.resource_id = r.id AND sr.tenant_id = r.tenant_id
    WHERE s.active = true 
      AND r.active = true 
      AND sr.active = true
  `);

  // Create view for upcoming bookings
  pgm.createView('v_upcoming_bookings', {}, `
    SELECT 
      b.id AS booking_id,
      b.tenant_id,
      b.start_at,
      b.end_at,
      b.status,
      b.total_jpy,
      c.name AS customer_name,
      c.email AS customer_email,
      c.phone AS customer_phone,
      s.name AS service_name,
      s.duration_min,
      array_agg(r.name ORDER BY r.name) AS resource_names
    FROM bookings b
    JOIN customers c ON b.customer_id = c.id
    JOIN services s ON b.service_id = s.id
    JOIN booking_items bi ON b.id = bi.booking_id
    JOIN resources r ON bi.resource_id = r.id
    WHERE b.start_at > NOW()
      AND b.status IN ('tentative', 'confirmed')
    GROUP BY b.id, b.tenant_id, b.start_at, b.end_at, b.status, b.total_jpy,
             c.name, c.email, c.phone, s.name, s.duration_min
  `);

  // Create view for resource utilization
  pgm.createView('v_resource_utilization', {}, `
    SELECT 
      r.id AS resource_id,
      r.tenant_id,
      r.name AS resource_name,
      r.kind AS resource_kind,
      r.capacity,
      COUNT(DISTINCT ts.id) AS total_slots,
      COUNT(DISTINCT CASE WHEN ts.available_capacity = 0 THEN ts.id END) AS booked_slots,
      COUNT(DISTINCT CASE WHEN ts.available_capacity > 0 THEN ts.id END) AS available_slots,
      CASE 
        WHEN COUNT(DISTINCT ts.id) > 0 THEN
          ROUND(COUNT(DISTINCT CASE WHEN ts.available_capacity = 0 THEN ts.id END)::numeric / COUNT(DISTINCT ts.id) * 100, 2)
        ELSE 0
      END AS utilization_percentage
    FROM resources r
    LEFT JOIN timeslots ts ON r.id = ts.resource_id 
      AND ts.start_at >= CURRENT_DATE 
      AND ts.start_at < CURRENT_DATE + INTERVAL '30 days'
    WHERE r.active = true
    GROUP BY r.id, r.tenant_id, r.name, r.kind, r.capacity
  `);
};

exports.down = pgm => {
  pgm.dropView('v_resource_utilization');
  pgm.dropView('v_upcoming_bookings');
  pgm.dropView('v_active_service_resources');
  pgm.dropView('v_available_timeslots');
};