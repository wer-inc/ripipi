-- Outbox Events Table
-- Stores domain events that need to be published to external systems
-- Ensures at-least-once delivery guarantee

CREATE TABLE IF NOT EXISTS outbox_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  
  -- Event metadata
  event_id UUID NOT NULL DEFAULT gen_random_uuid(),
  event_type VARCHAR(100) NOT NULL,
  aggregate_type VARCHAR(100) NOT NULL,
  aggregate_id VARCHAR(100) NOT NULL,
  
  -- Event payload
  payload JSONB NOT NULL,
  metadata JSONB DEFAULT '{}',
  
  -- Processing status
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  -- PENDING: Not yet processed
  -- PROCESSING: Being processed by worker
  -- COMPLETED: Successfully published
  -- FAILED: Failed to publish (will retry)
  -- DEAD_LETTER: Max retries exceeded
  
  -- Retry management
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  last_error TEXT,
  
  -- Scheduling
  scheduled_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  
  -- Tracking
  correlation_id VARCHAR(100),
  causation_id VARCHAR(100),
  trace_id VARCHAR(100),
  created_by VARCHAR(100),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT unique_event_id UNIQUE (event_id)
);

-- Indexes for efficient querying
CREATE INDEX idx_outbox_events_status ON outbox_events (status, scheduled_at) 
  WHERE status IN ('PENDING', 'FAILED');
  
CREATE INDEX idx_outbox_events_tenant_aggregate ON outbox_events (tenant_id, aggregate_type, aggregate_id);

CREATE INDEX idx_outbox_events_created_at ON outbox_events (created_at);

CREATE INDEX idx_outbox_events_trace_id ON outbox_events (trace_id) 
  WHERE trace_id IS NOT NULL;

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_outbox_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER update_outbox_events_updated_at_trigger
  BEFORE UPDATE ON outbox_events
  FOR EACH ROW
  EXECUTE FUNCTION update_outbox_events_updated_at();

-- Dead Letter Queue Table
-- Stores events that failed after max retries
CREATE TABLE IF NOT EXISTS outbox_dead_letter (
  id BIGSERIAL PRIMARY KEY,
  original_event_id UUID NOT NULL,
  tenant_id INTEGER NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  aggregate_type VARCHAR(100) NOT NULL,
  aggregate_id VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  metadata JSONB DEFAULT '{}',
  error_message TEXT,
  retry_count INTEGER,
  moved_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT unique_dead_letter_event UNIQUE (original_event_id)
);

CREATE INDEX idx_outbox_dead_letter_tenant ON outbox_dead_letter (tenant_id);
CREATE INDEX idx_outbox_dead_letter_moved_at ON outbox_dead_letter (moved_at);

-- Function to move failed events to dead letter queue
CREATE OR REPLACE FUNCTION move_to_dead_letter(event_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO outbox_dead_letter (
    original_event_id, tenant_id, event_type, aggregate_type, 
    aggregate_id, payload, metadata, error_message, retry_count
  )
  SELECT 
    event_id, tenant_id, event_type, aggregate_type,
    aggregate_id, payload, metadata, last_error, retry_count
  FROM outbox_events
  WHERE outbox_events.event_id = $1;
  
  UPDATE outbox_events 
  SET status = 'DEAD_LETTER' 
  WHERE outbox_events.event_id = $1;
END;
$$ LANGUAGE plpgsql;

-- Event type registry for validation
CREATE TABLE IF NOT EXISTS outbox_event_types (
  event_type VARCHAR(100) PRIMARY KEY,
  schema_version INTEGER DEFAULT 1,
  schema JSONB NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Common event types
INSERT INTO outbox_event_types (event_type, schema, description) VALUES
  ('BOOKING_CREATED', '{"type": "object", "properties": {"bookingId": {"type": "number"}}}', 'New booking created'),
  ('BOOKING_CONFIRMED', '{"type": "object", "properties": {"bookingId": {"type": "number"}}}', 'Booking confirmed'),
  ('BOOKING_CANCELLED', '{"type": "object", "properties": {"bookingId": {"type": "number"}}}', 'Booking cancelled'),
  ('PAYMENT_COMPLETED', '{"type": "object", "properties": {"paymentId": {"type": "string"}}}', 'Payment completed'),
  ('NOTIFICATION_REQUESTED', '{"type": "object", "properties": {"type": {"type": "string"}}}', 'Notification requested')
ON CONFLICT (event_type) DO NOTHING;