/**
 * Migration: Create Core Tables
 * Creates fundamental tables with no dependencies: tenants, users, cancel_reasons
 */

exports.up = pgm => {
  // Create tenants table
  pgm.createTable('tenants', {
    id: {
      type: 'bigint',
      primaryKey: true,
      generated: 'BY DEFAULT AS IDENTITY'
    },
    code: {
      type: 'text',
      unique: true,
      notNull: true
    },
    name: {
      type: 'text',
      notNull: true
    },
    tz: {
      type: 'text',
      notNull: true,
      default: 'Asia/Tokyo'
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

  // Create users table
  pgm.createTable('users', {
    id: {
      type: 'bigint',
      primaryKey: true,
      generated: 'BY DEFAULT AS IDENTITY'
    },
    email: {
      type: 'citext',
      unique: true,
      notNull: true
    },
    password_hash: {
      type: 'text',
      notNull: true
    },
    name: {
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

  // Create cancel_reasons table
  pgm.createTable('cancel_reasons', {
    code: {
      type: 'text',
      primaryKey: true
    },
    label: {
      type: 'text',
      notNull: true
    }
  });

  // Add updated_at triggers
  pgm.createTrigger('tenants', 'trg_tenants_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at'
  });

  pgm.createTrigger('users', 'trg_users_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at'
  });
};

exports.down = pgm => {
  pgm.dropTable('cancel_reasons');
  pgm.dropTable('users');
  pgm.dropTable('tenants');
};