-- =========================================================
-- Test Data Generation - Timeslots Generation
-- =========================================================

-- Function to generate timeslots for a resource within business hours
-- This is a simplified version - in production you'd want more sophisticated logic

-- Generate timeslots for the next 30 days for all active resources
INSERT INTO timeslots (tenant_id, resource_id, start_at, end_at, available_capacity)
SELECT 
  r.tenant_id,
  r.id as resource_id,
  slot_start,
  slot_start + (ts.granularity_min * INTERVAL '1 minute') as slot_end,
  r.capacity as available_capacity
FROM resources r
JOIN tenant_settings ts ON r.tenant_id = ts.tenant_id
CROSS JOIN LATERAL (
  -- Generate time slots for each day
  SELECT 
    date_series::date + time_series::time as slot_start
  FROM 
    generate_series(
      CURRENT_DATE, 
      CURRENT_DATE + INTERVAL '30 days', 
      INTERVAL '1 day'
    ) as date_series
  CROSS JOIN LATERAL (
    -- For each day, generate time slots based on business hours
    SELECT 
      generate_series(
        bh.open_time,
        bh.close_time - (ts.granularity_min * INTERVAL '1 minute'),
        (ts.granularity_min * INTERVAL '1 minute')
      ) as time_series
    FROM business_hours bh
    WHERE bh.tenant_id = r.tenant_id
      AND (bh.resource_id IS NULL OR bh.resource_id = r.id)
      AND bh.day_of_week = EXTRACT(dow FROM date_series)
    LIMIT 1 -- Take first matching business hour
  ) slots
) slot_times
WHERE r.active = true
  -- Exclude holidays
  AND NOT EXISTS (
    SELECT 1 FROM holidays h 
    WHERE h.tenant_id = r.tenant_id 
      AND (h.resource_id IS NULL OR h.resource_id = r.id)
      AND h.date = slot_start::date
  )
  -- Exclude resource time-offs
  AND NOT EXISTS (
    SELECT 1 FROM resource_time_offs rto
    WHERE rto.tenant_id = r.tenant_id
      AND rto.resource_id = r.id
      AND slot_start >= rto.start_at
      AND slot_start < rto.end_at
  )
  -- Only generate for future dates
  AND slot_start > NOW()
ON CONFLICT (tenant_id, resource_id, start_at, end_at) DO NOTHING;

-- Update some timeslots to simulate bookings (reduce available capacity)
-- This simulates existing bookings in the system
UPDATE timeslots 
SET available_capacity = GREATEST(0, available_capacity - 1)
WHERE id IN (
  SELECT id 
  FROM timeslots 
  WHERE start_at > NOW() 
    AND start_at < NOW() + INTERVAL '7 days'
    AND random() < 0.3 -- 30% chance of being "booked"
  LIMIT 100
);

-- Create some fully booked slots (popular times)
UPDATE timeslots 
SET available_capacity = 0
WHERE id IN (
  SELECT id 
  FROM timeslots 
  WHERE start_at > NOW() 
    AND start_at < NOW() + INTERVAL '3 days'
    AND EXTRACT(hour FROM start_at) IN (10, 11, 14, 15, 16) -- Popular hours
    AND EXTRACT(dow FROM start_at) IN (5, 6) -- Friday, Saturday
    AND random() < 0.2 -- 20% chance
  LIMIT 20
);