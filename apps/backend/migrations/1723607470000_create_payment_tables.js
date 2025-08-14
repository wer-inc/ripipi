/**
 * Migration: Create Payment Tables
 * Creates tables for managing payments, payment methods, and webhooks
 */

exports.up = pgm => {
  // Create payment_methods table
  pgm.createTable('payment_methods', {
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
      onDelete: 'CASCADE'
    },
    provider: {
      type: 'text',
      notNull: true,
      default: 'stripe'
    },
    provider_customer_id: {
      type: 'text'
    },
    provider_pm_id: {
      type: 'text'
    },
    is_default: {
      type: 'boolean',
      notNull: true,
      default: false
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()')
    }
  });

  // Create payments table
  pgm.createTable('payments', {
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
    kind: {
      type: 'text',
      notNull: true,
      check: "kind IN ('deposit','charge','penalty','refund')"
    },
    amount_jpy: {
      type: 'integer',
      notNull: true,
      check: 'amount_jpy >= 0'
    },
    currency: {
      type: 'text',
      notNull: true,
      default: 'JPY'
    },
    status: {
      type: 'text',
      notNull: true,
      check: "status IN ('requires_action','succeeded','failed','refunded','canceled','pending')"
    },
    provider: {
      type: 'text',
      notNull: true,
      default: 'stripe'
    },
    provider_payment_intent_id: {
      type: 'text'
    },
    provider_charge_id: {
      type: 'text'
    },
    failure_code: {
      type: 'text'
    },
    failure_message: {
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

  // Create webhook_events table
  pgm.createTable('webhook_events', {
    id: {
      type: 'bigint',
      primaryKey: true,
      generated: 'BY DEFAULT AS IDENTITY'
    },
    provider: {
      type: 'text',
      notNull: true,
      default: 'stripe'
    },
    event_id: {
      type: 'text',
      notNull: true
    },
    received_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()')
    },
    payload: {
      type: 'jsonb',
      notNull: true
    },
    handled_at: {
      type: 'timestamptz'
    },
    status: {
      type: 'text',
      notNull: true,
      default: 'received'
    },
    error_message: {
      type: 'text'
    }
  });

  // Add constraints
  pgm.addConstraint('payment_methods', 'payment_methods_provider_pm_id_key', {
    unique: ['provider', 'provider_pm_id']
  });

  pgm.addConstraint('payments', 'payments_provider_payment_intent_id_key', {
    unique: ['provider', 'provider_payment_intent_id']
  });

  pgm.addConstraint('webhook_events', 'webhook_events_provider_event_id_key', {
    unique: ['provider', 'event_id']
  });

  // Add trigger for updated_at
  pgm.createTrigger('payments', 'trg_payments_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at'
  });
};

exports.down = pgm => {
  pgm.dropTable('webhook_events');
  pgm.dropTable('payments');
  pgm.dropTable('payment_methods');
};