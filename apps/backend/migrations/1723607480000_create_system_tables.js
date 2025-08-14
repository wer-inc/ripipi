/**
 * Migration: Create System Tables
 * Creates tables for notifications, outbox events, audit logs, and idempotency
 */

exports.up = pgm => {
  // Create notifications table
  pgm.createTable('notifications', {
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
    booking_id: {
      type: 'bigint',
      references: 'bookings(id)',
      onDelete: 'SET NULL'
    },
    channel: {
      type: 'text',
      notNull: true,
      check: "channel IN ('line','email','sms')"
    },
    template: {
      type: 'text',
      notNull: true
    },
    to_address: {
      type: 'text'
    },
    to_line_user: {
      type: 'text'
    },
    payload: {
      type: 'jsonb',
      notNull: true,
      default: '{}'
    },
    status: {
      type: 'text',
      notNull: true,
      default: 'queued'
    },
    send_at: {
      type: 'timestamptz'
    },
    error_message: {
      type: 'text'
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

  // Create outbox_events table
  pgm.createTable('outbox_events', {
    id: {
      type: 'bigint',
      primaryKey: true,
      generated: 'BY DEFAULT AS IDENTITY'
    },
    tenant_id: {
      type: 'bigint',
      references: 'tenants(id)',
      onDelete: 'CASCADE'
    },
    event_type: {
      type: 'text',
      notNull: true
    },
    payload: {
      type: 'jsonb',
      notNull: true
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()')
    },
    next_attempt_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()')
    },
    attempts: {
      type: 'integer',
      notNull: true,
      default: 0
    },
    status: {
      type: 'text',
      notNull: true,
      default: 'pending'
    }
  });

  // Create audit_logs table
  pgm.createTable('audit_logs', {
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
    actor_user_id: {
      type: 'bigint',
      references: 'users(id)',
      onDelete: 'SET NULL'
    },
    action: {
      type: 'text',
      notNull: true,
      check: "action IN ('create','update','delete')"
    },
    table_name: {
      type: 'text',
      notNull: true
    },
    record_id: {
      type: 'bigint',
      notNull: true
    },
    before_data: {
      type: 'jsonb'
    },
    after_data: {
      type: 'jsonb'
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()')
    }
  });

  // Create idempotency_keys table
  pgm.createTable('idempotency_keys', {
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
    key: {
      type: 'text',
      notNull: true
    },
    request_sha256: {
      type: 'text',
      notNull: true
    },
    response_body: {
      type: 'jsonb'
    },
    status: {
      type: 'text',
      notNull: true,
      default: 'in_progress'
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()')
    },
    expires_at: {
      type: 'timestamptz',
      notNull: true
    }
  });

  // Add constraints
  pgm.addConstraint('idempotency_keys', 'idempotency_keys_tenant_key', {
    unique: ['tenant_id', 'key']
  });

  // Add triggers for updated_at
  pgm.createTrigger('notifications', 'trg_notifications_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at'
  });
};

exports.down = pgm => {
  pgm.dropTable('idempotency_keys');
  pgm.dropTable('audit_logs');
  pgm.dropTable('outbox_events');
  pgm.dropTable('notifications');
};