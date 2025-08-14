/**
 * Migration: Create Schedule Tables
 * Creates tables for managing business hours, holidays, and resource time-offs
 */

exports.up = pgm => {
  // Create business_hours table
  pgm.createTable('business_hours', {
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
    resource_id: {
      type: 'bigint',
      references: 'resources(id)',
      onDelete: 'CASCADE'
    },
    day_of_week: {
      type: 'smallint',
      notNull: true,
      check: 'day_of_week BETWEEN 0 AND 6'
    },
    open_time: {
      type: 'time',
      notNull: true
    },
    close_time: {
      type: 'time',
      notNull: true
    },
    effective_from: {
      type: 'date'
    },
    effective_to: {
      type: 'date'
    }
  });

  // Create holidays table
  pgm.createTable('holidays', {
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
    resource_id: {
      type: 'bigint',
      references: 'resources(id)',
      onDelete: 'CASCADE'
    },
    date: {
      type: 'date',
      notNull: true
    },
    name: {
      type: 'text',
      notNull: true,
      default: ''
    }
  });

  // Create resource_time_offs table
  pgm.createTable('resource_time_offs', {
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
    resource_id: {
      type: 'bigint',
      notNull: true,
      references: 'resources(id)',
      onDelete: 'CASCADE'
    },
    start_at: {
      type: 'timestamptz',
      notNull: true
    },
    end_at: {
      type: 'timestamptz',
      notNull: true
    },
    reason: {
      type: 'text',
      notNull: true,
      default: ''
    }
  });

  // Add constraints
  pgm.addConstraint('business_hours', 'business_hours_time_check', {
    check: 'open_time < close_time'
  });

  pgm.addConstraint('resource_time_offs', 'resource_time_offs_time_check', {
    check: 'start_at < end_at'
  });

  pgm.addConstraint('holidays', 'holidays_tenant_resource_date_key', {
    unique: ['tenant_id', 'resource_id', 'date']
  });
};

exports.down = pgm => {
  pgm.dropTable('resource_time_offs');
  pgm.dropTable('holidays');
  pgm.dropTable('business_hours');
};