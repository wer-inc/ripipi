/**
 * Migration: Enhance Users Table
 * Adds additional fields required for comprehensive user management
 */

exports.up = pgm => {
  // First, add the new columns to the existing users table
  pgm.addColumns('users', {
    tenant_id: {
      type: 'bigint',
      references: 'tenants(id)',
      onDelete: 'CASCADE'
    },
    first_name: {
      type: 'text'
    },
    last_name: {
      type: 'text'
    },
    phone: {
      type: 'text'
    },
    role: {
      type: 'text',
      notNull: true,
      default: 'customer',
      check: "role IN ('super_admin','tenant_admin','manager','staff','customer')"
    },
    is_active: {
      type: 'boolean',
      notNull: true,
      default: true
    },
    is_email_verified: {
      type: 'boolean',
      notNull: true,
      default: false
    },
    email_verified_at: {
      type: 'timestamptz'
    },
    last_login_at: {
      type: 'timestamptz'
    },
    password_changed_at: {
      type: 'timestamptz'
    },
    failed_login_attempts: {
      type: 'integer',
      notNull: true,
      default: 0
    },
    locked_until: {
      type: 'timestamptz'
    },
    preferences: {
      type: 'jsonb',
      default: '{}'
    },
    deleted_at: {
      type: 'timestamptz'
    },
    created_by: {
      type: 'bigint',
      references: 'users(id)'
    },
    updated_by: {
      type: 'bigint',
      references: 'users(id)'
    },
    version: {
      type: 'integer',
      notNull: true,
      default: 1
    }
  });

  // Split the existing 'name' field into first_name and last_name
  pgm.sql(`
    UPDATE users 
    SET 
      first_name = CASE 
        WHEN position(' ' in name) > 0 
        THEN substring(name from 1 for position(' ' in name) - 1)
        ELSE name
      END,
      last_name = CASE 
        WHEN position(' ' in name) > 0 
        THEN substring(name from position(' ' in name) + 1)
        ELSE ''
      END,
      password_changed_at = created_at
  `);

  // Make first_name and last_name not null after populating them
  pgm.alterColumn('users', 'first_name', {
    notNull: true
  });
  
  pgm.alterColumn('users', 'last_name', {
    notNull: true
  });

  // Update tenant_id for existing users (assuming tenant with id=1 exists)
  pgm.sql(`
    UPDATE users 
    SET tenant_id = 1 
    WHERE tenant_id IS NULL
  `);

  // Make tenant_id not null after populating it
  pgm.alterColumn('users', 'tenant_id', {
    notNull: true
  });

  // Drop the old 'name' column
  pgm.dropColumn('users', 'name');

  // Create additional indexes for performance
  pgm.createIndex('users', ['tenant_id']);
  pgm.createIndex('users', ['tenant_id', 'email']);
  pgm.createIndex('users', ['tenant_id', 'phone']);
  pgm.createIndex('users', ['tenant_id', 'role']);
  pgm.createIndex('users', ['tenant_id', 'is_active']);
  pgm.createIndex('users', ['tenant_id', 'is_email_verified']);
  pgm.createIndex('users', ['tenant_id', 'deleted_at']);
  pgm.createIndex('users', ['last_login_at']);
  pgm.createIndex('users', ['locked_until']);

  // Create partial indexes for better performance
  pgm.createIndex('users', ['tenant_id', 'email'], {
    name: 'idx_users_tenant_email_active',
    where: 'deleted_at IS NULL'
  });

  pgm.createIndex('users', ['tenant_id', 'phone'], {
    name: 'idx_users_tenant_phone_active',
    where: 'phone IS NOT NULL AND deleted_at IS NULL'
  });

  // Add unique constraints
  pgm.addConstraint('users', 'users_tenant_email_unique', {
    unique: ['tenant_id', 'email'],
    where: 'deleted_at IS NULL'
  });

  pgm.addConstraint('users', 'users_tenant_phone_unique', {
    unique: ['tenant_id', 'phone'],
    where: 'phone IS NOT NULL AND deleted_at IS NULL'
  });

  // Add check constraints
  pgm.addConstraint('users', 'users_failed_attempts_check', {
    check: 'failed_login_attempts >= 0'
  });

  pgm.addConstraint('users', 'users_version_check', {
    check: 'version >= 1'
  });

  pgm.addConstraint('users', 'users_name_length_check', {
    check: 'length(first_name) > 0 AND length(last_name) > 0'
  });

  // Create user_sessions table for session management
  pgm.createTable('user_sessions', {
    id: {
      type: 'text',
      primaryKey: true
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
    refresh_token_hash: {
      type: 'text',
      notNull: true
    },
    ip_address: {
      type: 'inet'
    },
    user_agent: {
      type: 'text'
    },
    last_activity: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()')
    },
    expires_at: {
      type: 'timestamptz',
      notNull: true
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()')
    },
    is_active: {
      type: 'boolean',
      notNull: true,
      default: true
    }
  });

  // Create indexes for user_sessions
  pgm.createIndex('user_sessions', ['user_id']);
  pgm.createIndex('user_sessions', ['tenant_id']);
  pgm.createIndex('user_sessions', ['expires_at']);
  pgm.createIndex('user_sessions', ['last_activity']);
  pgm.createIndex('user_sessions', ['refresh_token_hash']);

  // Create user_invitations table for invitation management
  pgm.createTable('user_invitations', {
    id: {
      type: 'text',
      primaryKey: true
    },
    tenant_id: {
      type: 'bigint',
      notNull: true,
      references: 'tenants(id)',
      onDelete: 'CASCADE'
    },
    email: {
      type: 'citext',
      notNull: true
    },
    first_name: {
      type: 'text',
      notNull: true
    },
    last_name: {
      type: 'text',
      notNull: true
    },
    role: {
      type: 'text',
      notNull: true,
      check: "role IN ('super_admin','tenant_admin','manager','staff','customer')"
    },
    invited_by: {
      type: 'bigint',
      notNull: true,
      references: 'users(id)'
    },
    invitation_token: {
      type: 'text',
      notNull: true,
      unique: true
    },
    message: {
      type: 'text'
    },
    expires_at: {
      type: 'timestamptz',
      notNull: true
    },
    accepted_at: {
      type: 'timestamptz'
    },
    accepted_by: {
      type: 'bigint',
      references: 'users(id)'
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()')
    },
    status: {
      type: 'text',
      notNull: true,
      default: 'pending',
      check: "status IN ('pending','accepted','expired','cancelled')"
    }
  });

  // Create indexes for user_invitations
  pgm.createIndex('user_invitations', ['tenant_id']);
  pgm.createIndex('user_invitations', ['email']);
  pgm.createIndex('user_invitations', ['invited_by']);
  pgm.createIndex('user_invitations', ['expires_at']);
  pgm.createIndex('user_invitations', ['status']);
  pgm.createIndex('user_invitations', ['invitation_token']);

  // Create user_activity_logs table for audit logging
  pgm.createTable('user_activity_logs', {
    id: {
      type: 'bigint',
      primaryKey: true,
      generated: 'BY DEFAULT AS IDENTITY'
    },
    user_id: {
      type: 'bigint',
      references: 'users(id)',
      onDelete: 'SET NULL'
    },
    tenant_id: {
      type: 'bigint',
      notNull: true,
      references: 'tenants(id)',
      onDelete: 'CASCADE'
    },
    action: {
      type: 'text',
      notNull: true
    },
    resource: {
      type: 'text'
    },
    resource_id: {
      type: 'text'
    },
    ip_address: {
      type: 'inet'
    },
    user_agent: {
      type: 'text'
    },
    metadata: {
      type: 'jsonb',
      default: '{}'
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()')
    }
  });

  // Create indexes for user_activity_logs
  pgm.createIndex('user_activity_logs', ['user_id']);
  pgm.createIndex('user_activity_logs', ['tenant_id']);
  pgm.createIndex('user_activity_logs', ['action']);
  pgm.createIndex('user_activity_logs', ['created_at']);
  pgm.createIndex('user_activity_logs', ['resource', 'resource_id']);

  // Create function to automatically update last_activity in user_sessions
  pgm.createFunction(
    'update_session_activity',
    [],
    {
      returns: 'trigger',
      language: 'plpgsql'
    },
    `
    BEGIN
      NEW.last_activity = NOW();
      RETURN NEW;
    END;
    `
  );

  // Create trigger for user_sessions
  pgm.createTrigger('user_sessions', 'trg_update_session_activity', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'update_session_activity'
  });

  // Create function to clean up expired sessions
  pgm.createFunction(
    'cleanup_expired_sessions',
    [],
    {
      returns: 'integer',
      language: 'plpgsql'
    },
    `
    DECLARE
      deleted_count integer;
    BEGIN
      DELETE FROM user_sessions 
      WHERE expires_at < NOW() OR is_active = false;
      
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
      RETURN deleted_count;
    END;
    `
  );

  // Create function to clean up expired invitations
  pgm.createFunction(
    'cleanup_expired_invitations',
    [],
    {
      returns: 'integer',
      language: 'plpgsql'
    },
    `
    DECLARE
      updated_count integer;
    BEGIN
      UPDATE user_invitations 
      SET status = 'expired'
      WHERE expires_at < NOW() AND status = 'pending';
      
      GET DIAGNOSTICS updated_count = ROW_COUNT;
      RETURN updated_count;
    END;
    `
  );
};

exports.down = pgm => {
  // Drop new tables
  pgm.dropTable('user_activity_logs');
  pgm.dropTable('user_invitations');  
  pgm.dropTable('user_sessions');

  // Drop functions
  pgm.dropFunction('cleanup_expired_invitations', []);
  pgm.dropFunction('cleanup_expired_sessions', []);
  pgm.dropFunction('update_session_activity', []);

  // Add back the name column
  pgm.addColumn('users', 'name', {
    type: 'text',
    notNull: true,
    default: ''
  });

  // Restore name from first_name and last_name
  pgm.sql(`
    UPDATE users 
    SET name = CONCAT(first_name, ' ', last_name)
  `);

  // Remove the new columns (in reverse order due to dependencies)
  pgm.dropColumn('users', 'version');
  pgm.dropColumn('users', 'updated_by');
  pgm.dropColumn('users', 'created_by');
  pgm.dropColumn('users', 'deleted_at');
  pgm.dropColumn('users', 'preferences');
  pgm.dropColumn('users', 'locked_until');
  pgm.dropColumn('users', 'failed_login_attempts');
  pgm.dropColumn('users', 'password_changed_at');
  pgm.dropColumn('users', 'last_login_at');
  pgm.dropColumn('users', 'email_verified_at');
  pgm.dropColumn('users', 'is_email_verified');
  pgm.dropColumn('users', 'is_active');
  pgm.dropColumn('users', 'role');
  pgm.dropColumn('users', 'phone');
  pgm.dropColumn('users', 'last_name');
  pgm.dropColumn('users', 'first_name');
  pgm.dropColumn('users', 'tenant_id');
};