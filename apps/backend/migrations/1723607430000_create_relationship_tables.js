/**
 * Migration: Create Relationship Tables
 * Creates tables that establish relationships between core entities
 */

exports.up = pgm => {
  // Create user_tenant_roles table
  pgm.createTable('user_tenant_roles', {
    id: {
      type: 'bigint',
      primaryKey: true,
      generated: 'BY DEFAULT AS IDENTITY'
    },
    user_id: {
      type: 'bigint',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE'
    },
    tenant_id: {
      type: 'bigint',
      notNull: true,
      references: 'tenants(id)',
      onDelete: 'CASCADE'
    },
    role: {
      type: 'text',
      notNull: true,
      check: "role IN ('owner','manager','staff','viewer','support')"
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()')
    }
  });

  // Create consents table
  pgm.createTable('consents', {
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
    version: {
      type: 'text',
      notNull: true
    },
    text_sha256: {
      type: 'text',
      notNull: true
    },
    accepted_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()')
    },
    accept_ip: {
      type: 'inet'
    }
  });

  // Create service_resources table
  pgm.createTable('service_resources', {
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
    service_id: {
      type: 'bigint',
      notNull: true,
      references: 'services(id)',
      onDelete: 'CASCADE'
    },
    resource_id: {
      type: 'bigint',
      notNull: true,
      references: 'resources(id)',
      onDelete: 'CASCADE'
    },
    active: {
      type: 'boolean',
      notNull: true,
      default: true
    }
  });

  // Create resource_group_members table
  pgm.createTable('resource_group_members', {
    id: {
      type: 'bigint',
      primaryKey: true,
      generated: 'BY DEFAULT AS IDENTITY'
    },
    group_id: {
      type: 'bigint',
      notNull: true,
      references: 'resource_groups(id)',
      onDelete: 'CASCADE'
    },
    resource_id: {
      type: 'bigint',
      notNull: true,
      references: 'resources(id)',
      onDelete: 'CASCADE'
    }
  });

  // Add unique constraints
  pgm.addConstraint('user_tenant_roles', 'user_tenant_roles_user_tenant_key', {
    unique: ['user_id', 'tenant_id']
  });

  pgm.addConstraint('consents', 'consents_tenant_customer_version_key', {
    unique: ['tenant_id', 'customer_id', 'version']
  });

  pgm.addConstraint('service_resources', 'service_resources_tenant_service_resource_key', {
    unique: ['tenant_id', 'service_id', 'resource_id']
  });

  pgm.addConstraint('resource_group_members', 'resource_group_members_group_resource_key', {
    unique: ['group_id', 'resource_id']
  });
};

exports.down = pgm => {
  pgm.dropTable('resource_group_members');
  pgm.dropTable('service_resources');
  pgm.dropTable('consents');
  pgm.dropTable('user_tenant_roles');
};