/**
 * Migration: Create Booking Tables
 * Creates tables for managing bookings and booking items
 */

exports.up = pgm => {
  // Create bookings table
  pgm.createTable('bookings', {
    id: {
      type: 'bigint',
      primaryKey: true,
      generated: 'BY DEFAULT AS IDENTITY'
    },
    tenant_id: {
      type: 'bigint',
      notNull: true,
      references: 'tenants(id)',
      onDelete: 'CASCADE'
    },
    customer_id: {
      type: 'bigint',
      notNull: true,
      references: 'customers(id)',
      onDelete: 'RESTRICT'
    },
    service_id: {
      type: 'bigint',
      notNull: true,
      references: 'services(id)',
      onDelete: 'RESTRICT'
    },
    start_at: {
      type: 'timestamptz',
      notNull: true
    },
    end_at: {
      type: 'timestamptz',
      notNull: true
    },
    status: {
      type: 'text',
      notNull: true,
      check: "status IN ('tentative','confirmed','cancelled','noshow','completed')"
    },
    total_jpy: {
      type: 'integer',
      notNull: true,
      check: 'total_jpy >= 0'
    },
    max_penalty_jpy: {
      type: 'integer',
      notNull: true,
      default: 0,
      check: 'max_penalty_jpy >= 0'
    },
    idempotency_key: {
      type: 'text',
      notNull: true
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()')
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()')
    }
  });

  // Create booking_items table
  pgm.createTable('booking_items', {
    id: {
      type: 'bigint',
      primaryKey: true,
      generated: 'BY DEFAULT AS IDENTITY'
    },
    booking_id: {
      type: 'bigint',
      notNull: true,
      references: 'bookings(id)',
      onDelete: 'CASCADE'
    },
    timeslot_id: {
      type: 'bigint',
      notNull: true,
      references: 'timeslots(id)',
      onDelete: 'RESTRICT'
    },
    resource_id: {
      type: 'bigint',
      notNull: true,
      references: 'resources(id)',
      onDelete: 'RESTRICT'
    }
  });

  // Create booking_cancellations table
  pgm.createTable('booking_cancellations', {
    id: {
      type: 'bigint',
      primaryKey: true,
      generated: 'BY DEFAULT AS IDENTITY'
    },
    booking_id: {
      type: 'bigint',
      notNull: true,
      references: 'bookings(id)',
      onDelete: 'CASCADE'
    },
    reason_code: {
      type: 'text',
      references: 'cancel_reasons(code)',
      onDelete: 'SET NULL'
    },
    note: {
      type: 'text',
      notNull: true,
      default: ''
    },
    cancelled_by: {
      type: 'text',
      notNull: true,
      default: 'customer'
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()')
    }
  });

  // Add constraints
  pgm.addConstraint('bookings', 'bookings_time_check', {
    check: 'start_at < end_at'
  });

  pgm.addConstraint('bookings', 'bookings_tenant_idempotency_key', {
    unique: ['tenant_id', 'idempotency_key']
  });

  pgm.addConstraint('booking_items', 'booking_items_booking_timeslot_resource_key', {
    unique: ['booking_id', 'timeslot_id', 'resource_id']
  });

  // Add trigger for updated_at
  pgm.createTrigger('bookings', 'trg_bookings_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at'
  });
};

exports.down = pgm => {
  pgm.dropTable('booking_cancellations');
  pgm.dropTable('booking_items');
  pgm.dropTable('bookings');
};