/**
 * Migration: Create Tenant Dependent Tables
 * Creates tables that depend on tenants: tenant_settings, customers, services, resources, resource_groups
 */

exports.up = pgm => {
  // Create tenant_settings table
  pgm.createTable('tenant_settings', {
    tenant_id: {
      type: 'bigint',
      primaryKey: true,
      references: 'tenants(id)',
      onDelete: 'CASCADE'
    },
    currency_code: {
      type: 'text',
      notNull: true,
      default: 'JPY'
    },
    cancel_cutoff_min: {
      type: 'integer',
      notNull: true,
      default: 1440
    },
    noshow_grace_min: {
      type: 'integer',
      notNull: true,
      default: 15
    },
    reminder_1_min: {
      type: 'integer',
      notNull: true,
      default: 1440
    },
    reminder_2_min: {
      type: 'integer',
      notNull: true,
      default: 120
    },
    granularity_min: {
      type: 'integer',
      notNull: true,
      default: 15
    },
    allow_public_booking: {
      type: 'boolean',
      notNull: true,
      default: true
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

  // Create customers table
  pgm.createTable('customers', {
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
    name: {
      type: 'text',
      notNull: true
    },
    phone: {
      type: 'text'
    },
    email: {
      type: 'citext'
    },
    line_user_id: {
      type: 'text'
    },
    note: {
      type: 'text',
      notNull: true,
      default: ''
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

  // Create services table
  pgm.createTable('services', {
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
    name: {
      type: 'text',
      notNull: true
    },
    description: {
      type: 'text',
      notNull: true,
      default: ''
    },
    duration_min: {
      type: 'integer',
      notNull: true,
      check: 'duration_min > 0'
    },
    price_jpy: {
      type: 'integer',
      notNull: true,
      check: 'price_jpy >= 0'
    },
    buffer_before_min: {
      type: 'integer',
      notNull: true,
      default: 0,
      check: 'buffer_before_min >= 0'
    },
    buffer_after_min: {
      type: 'integer',
      notNull: true,
      default: 0,
      check: 'buffer_after_min >= 0'
    },
    active: {
      type: 'boolean',
      notNull: true,
      default: true
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

  // Create resources table
  pgm.createTable('resources', {
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
    kind: {
      type: 'text',
      notNull: true,
      check: "kind IN ('staff','seat','room','table')"
    },
    name: {
      type: 'text',
      notNull: true
    },
    capacity: {
      type: 'integer',
      notNull: true,
      default: 1,
      check: 'capacity >= 1'
    },
    active: {
      type: 'boolean',
      notNull: true,
      default: true
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

  // Create resource_groups table
  pgm.createTable('resource_groups', {
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
    name: {
      type: 'text',
      notNull: true
    },
    kind: {
      type: 'text',
      notNull: true,
      default: 'generic'
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()')
    }
  });

  // Add unique constraints
  pgm.addConstraint('customers', 'customers_tenant_email_key', {
    unique: ['tenant_id', 'email']
  });
  pgm.addConstraint('customers', 'customers_tenant_phone_key', {
    unique: ['tenant_id', 'phone']
  });

  // Add triggers for updated_at
  pgm.createTrigger('tenant_settings', 'trg_tenant_settings_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at'
  });

  pgm.createTrigger('customers', 'trg_customers_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at'
  });

  pgm.createTrigger('services', 'trg_services_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at'
  });

  pgm.createTrigger('resources', 'trg_resources_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at'
  });
};

exports.down = pgm => {
  pgm.dropTable('resource_groups');
  pgm.dropTable('resources');
  pgm.dropTable('services');
  pgm.dropTable('customers');
  pgm.dropTable('tenant_settings');
};