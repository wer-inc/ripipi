/**
 * Migration: Create Performance Indexes
 * Creates indexes for optimal query performance
 */

exports.up = pgm => {
  // Customers indexes
  pgm.createIndex('customers', ['tenant_id', 'created_at'], {
    name: 'idx_customers_tenant_created',
    order: ['ASC', 'DESC']
  });

  // Services indexes
  pgm.createIndex('services', ['tenant_id', 'active'], {
    name: 'idx_services_tenant_active'
  });

  // Resources indexes
  pgm.createIndex('resources', ['tenant_id', 'kind', 'active'], {
    name: 'idx_resources_tenant_kind'
  });

  // Service resources indexes
  pgm.createIndex('service_resources', ['tenant_id', 'service_id', 'active'], {
    name: 'idx_srv_res_tenant_service'
  });

  // Business hours indexes
  pgm.createIndex('business_hours', ['tenant_id', 'resource_id', 'day_of_week'], {
    name: 'idx_bhours_tenant_resource'
  });

  // Resource time offs indexes
  pgm.createIndex('resource_time_offs', ['tenant_id', 'resource_id', 'start_at', 'end_at'], {
    name: 'idx_timeoffs_res_time'
  });

  // Timeslots indexes - critical for performance
  pgm.createIndex('timeslots', ['tenant_id', 'resource_id', 'start_at'], {
    name: 'idx_timeslots_search'
  });

  pgm.createIndex('timeslots', ['tenant_id', 'start_at', 'available_capacity'], {
    name: 'idx_timeslots_available'
  });

  // Bookings indexes
  pgm.createIndex('bookings', ['tenant_id', 'start_at'], {
    name: 'idx_bookings_tenant_time'
  });

  pgm.createIndex('bookings', ['tenant_id', 'status', 'start_at'], {
    name: 'idx_bookings_status'
  });

  // Booking items indexes
  pgm.createIndex('booking_items', ['booking_id'], {
    name: 'idx_bitems_booking'
  });

  pgm.createIndex('booking_items', ['timeslot_id'], {
    name: 'idx_bitems_timeslot'
  });

  // Payment methods indexes
  pgm.createIndex('payment_methods', ['tenant_id', 'customer_id', 'is_default'], {
    name: 'idx_pm_tenant_customer'
  });

  // Payments indexes
  pgm.createIndex('payments', ['tenant_id', 'booking_id', 'status'], {
    name: 'idx_payments_booking'
  });

  // Notifications indexes
  pgm.createIndex('notifications', ['tenant_id', 'status', 'send_at'], {
    name: 'idx_notifications_queue'
  });

  // Outbox events indexes
  pgm.createIndex('outbox_events', ['status', 'next_attempt_at'], {
    name: 'idx_outbox_dispatch'
  });

  // Idempotency keys expiry index
  pgm.createIndex('idempotency_keys', ['expires_at'], {
    name: 'idx_idem_expiry'
  });
};

exports.down = pgm => {
  // Drop all indexes in reverse order
  pgm.dropIndex('idempotency_keys', ['expires_at'], { name: 'idx_idem_expiry' });
  pgm.dropIndex('outbox_events', ['status', 'next_attempt_at'], { name: 'idx_outbox_dispatch' });
  pgm.dropIndex('notifications', ['tenant_id', 'status', 'send_at'], { name: 'idx_notifications_queue' });
  pgm.dropIndex('payments', ['tenant_id', 'booking_id', 'status'], { name: 'idx_payments_booking' });
  pgm.dropIndex('payment_methods', ['tenant_id', 'customer_id', 'is_default'], { name: 'idx_pm_tenant_customer' });
  pgm.dropIndex('booking_items', ['timeslot_id'], { name: 'idx_bitems_timeslot' });
  pgm.dropIndex('booking_items', ['booking_id'], { name: 'idx_bitems_booking' });
  pgm.dropIndex('bookings', ['tenant_id', 'status', 'start_at'], { name: 'idx_bookings_status' });
  pgm.dropIndex('bookings', ['tenant_id', 'start_at'], { name: 'idx_bookings_tenant_time' });
  pgm.dropIndex('timeslots', ['tenant_id', 'start_at', 'available_capacity'], { name: 'idx_timeslots_available' });
  pgm.dropIndex('timeslots', ['tenant_id', 'resource_id', 'start_at'], { name: 'idx_timeslots_search' });
  pgm.dropIndex('resource_time_offs', ['tenant_id', 'resource_id', 'start_at', 'end_at'], { name: 'idx_timeoffs_res_time' });
  pgm.dropIndex('business_hours', ['tenant_id', 'resource_id', 'day_of_week'], { name: 'idx_bhours_tenant_resource' });
  pgm.dropIndex('service_resources', ['tenant_id', 'service_id', 'active'], { name: 'idx_srv_res_tenant_service' });
  pgm.dropIndex('resources', ['tenant_id', 'kind', 'active'], { name: 'idx_resources_tenant_kind' });
  pgm.dropIndex('services', ['tenant_id', 'active'], { name: 'idx_services_tenant_active' });
  pgm.dropIndex('customers', ['tenant_id', 'created_at'], { name: 'idx_customers_tenant_created' });
};