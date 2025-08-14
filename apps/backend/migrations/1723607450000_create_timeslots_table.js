/**
 * Migration: Create Timeslots Table
 * Creates the inventory/timeslots table with capacity enforcement
 */

exports.up = pgm => {
  // Create timeslots table
  pgm.createTable('timeslots', {
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
    available_capacity: {
      type: 'integer',
      notNull: true,
      check: 'available_capacity >= 0'
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

  // Add constraints
  pgm.addConstraint('timeslots', 'timeslots_time_check', {
    check: 'start_at < end_at'
  });

  pgm.addConstraint('timeslots', 'timeslots_tenant_resource_time_key', {
    unique: ['tenant_id', 'resource_id', 'start_at', 'end_at']
  });

  // Add trigger for updated_at
  pgm.createTrigger('timeslots', 'trg_timeslots_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at'
  });

  // Create capacity enforcement function
  pgm.createFunction(
    'enforce_timeslot_capacity',
    [],
    {
      returns: 'trigger',
      language: 'plpgsql',
      replace: true
    },
    `
DECLARE res_cap INT;
BEGIN
  SELECT capacity INTO res_cap FROM resources WHERE id = NEW.resource_id;
  IF NEW.available_capacity > res_cap THEN
    RAISE EXCEPTION 'available_capacity(%) exceeds resource capacity(%)', NEW.available_capacity, res_cap
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
    `
  );

  // Create capacity enforcement trigger
  pgm.createTrigger('timeslots', 'trg_timeslots_capacity', {
    when: 'BEFORE',
    operation: ['INSERT', 'UPDATE'],
    level: 'ROW',
    function: 'enforce_timeslot_capacity'
  });
};

exports.down = pgm => {
  pgm.dropTrigger('timeslots', 'trg_timeslots_capacity');
  pgm.dropFunction('enforce_timeslot_capacity', []);
  pgm.dropTable('timeslots');
};