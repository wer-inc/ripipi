/**
 * Create Idempotency and Distributed Transaction Tables
 * Migration for idempotency key management and distributed transaction support
 */

export const up = async (knex) => {
  console.log('Creating idempotency and distributed transaction tables...');

  // 1. Create idempotency_keys table
  await knex.schema.createTable('idempotency_keys', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('idempotency_key', 128).notNullable();
    table.string('request_fingerprint', 64);
    table.enum('status', ['pending', 'processing', 'completed', 'failed', 'expired', 'cancelled']).notNullable().defaultTo('pending');
    table.uuid('tenant_id');
    table.uuid('user_id');
    table.string('session_id', 128);
    
    // Request metadata
    table.jsonb('request_metadata').notNullable();
    
    // Response data (when completed)
    table.jsonb('response_metadata');
    table.integer('response_status_code');
    
    // Timestamps
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.timestamp('expires_at').notNullable();
    table.timestamp('completed_at');
    
    // Processing metadata
    table.timestamp('processing_started_at');
    table.timestamp('processing_completed_at');
    table.integer('processing_duration_ms');
    
    // Error information
    table.text('error_message');
    table.string('error_code', 50);
    table.jsonb('error_details');
    
    // Retry information
    table.integer('retry_count').notNullable().defaultTo(0);
    table.integer('max_retries').notNullable().defaultTo(3);
    
    // Distributed transaction support
    table.string('transaction_id', 128);
    table.string('saga_id', 128);
    table.boolean('compensation_required').defaultTo(false);
    
    // Performance metrics
    table.integer('lock_acquisition_time_ms');
    table.integer('database_time_ms');
    table.integer('total_processing_time_ms');
    
    // Constraints and indexes
    table.unique(['idempotency_key', knex.raw('COALESCE(tenant_id, \'\')')]);
    table.index(['tenant_id', 'idempotency_key'], 'idx_idempotency_tenant_key');
    table.index(['expires_at'], 'idx_idempotency_expires');
    table.index(['status'], 'idx_idempotency_status');
    table.index(['created_at'], 'idx_idempotency_created');
    table.index(['user_id'], 'idx_idempotency_user');
    table.index(['transaction_id'], 'idx_idempotency_transaction');
    table.index(['saga_id'], 'idx_idempotency_saga');
    
    // Foreign key constraints (if tenant/user tables exist)
    // Uncomment if you have these tables
    // table.foreign('tenant_id').references('tenants.id').onDelete('CASCADE');
    // table.foreign('user_id').references('users.id').onDelete('SET NULL');
  });

  // 2. Create distributed_transaction_contexts table
  await knex.schema.createTable('distributed_transaction_contexts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('transaction_id', 128).notNullable().unique();
    table.string('participant_id', 128).notNullable();
    table.enum('status', [
      'initiated', 'preparing', 'prepared', 'committing', 'committed',
      'aborting', 'aborted', 'compensating', 'compensated', 'failed'
    ]).notNullable().defaultTo('initiated');
    
    // Idempotency keys involved
    table.jsonb('idempotency_keys').defaultTo('[]');
    
    // Compensation data
    table.jsonb('compensation_data');
    table.text('compensation_script');
    
    // Timing
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('last_updated_at').defaultTo(knex.fn.now());
    table.timestamp('expires_at').notNullable();
    
    // Metadata
    table.jsonb('metadata').defaultTo('{}');
    
    // Indexes
    table.index(['transaction_id'], 'idx_dtx_context_transaction_id');
    table.index(['status'], 'idx_dtx_context_status');
    table.index(['expires_at'], 'idx_dtx_context_expires');
    table.index(['created_at'], 'idx_dtx_context_created');
  });

  // 3. Create distributed_transaction_participants table
  await knex.schema.createTable('distributed_transaction_participants', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('transaction_id', 128).notNullable();
    table.string('participant_id', 128).notNullable();
    table.string('service', 100).notNullable();
    table.string('operation', 100).notNullable();
    table.string('idempotency_key', 128);
    table.enum('status', [
      'initiated', 'preparing', 'prepared', 'committing', 'committed',
      'aborting', 'aborted', 'compensating', 'compensated', 'failed'
    ]).notNullable().defaultTo('initiated');
    
    // Prepare/commit/abort operations
    table.jsonb('prepare_data');
    table.jsonb('commit_data');
    table.string('abort_reason');
    
    // Compensation
    table.boolean('compensation_required').defaultTo(true);
    table.jsonb('compensation_data');
    table.boolean('compensation_completed').defaultTo(false);
    
    // Timing
    table.timestamp('prepared_at');
    table.timestamp('committed_at');
    table.timestamp('aborted_at');
    table.timestamp('compensated_at');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('last_updated_at').defaultTo(knex.fn.now());
    
    // Constraints
    table.unique(['transaction_id', 'participant_id']);
    table.index(['transaction_id'], 'idx_dtx_participant_transaction_id');
    table.index(['participant_id'], 'idx_dtx_participant_id');
    table.index(['status'], 'idx_dtx_participant_status');
    table.index(['service'], 'idx_dtx_participant_service');
    
    // Foreign key to transaction context
    table.foreign('transaction_id').references('distributed_transaction_contexts.transaction_id').onDelete('CASCADE');
  });

  // 4. Create saga_executions table
  await knex.schema.createTable('saga_executions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('saga_id', 128).notNullable().unique();
    table.enum('status', [
      'executing', 'completed', 'failed', 'compensated'
    ]).notNullable().defaultTo('executing');
    
    // Steps data
    table.jsonb('steps_data').notNullable().defaultTo('[]');
    table.jsonb('completed_steps_data').defaultTo('[]');
    table.jsonb('results_data').defaultTo('[]');
    
    // Error information
    table.text('error_message');
    table.string('error_code', 50);
    table.jsonb('error_details');
    
    // Timing
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('last_updated_at').defaultTo(knex.fn.now());
    table.timestamp('completed_at');
    table.timestamp('failed_at');
    table.timestamp('compensated_at');
    
    // Metadata
    table.uuid('tenant_id');
    table.jsonb('metadata').defaultTo('{}');
    
    // Indexes
    table.index(['saga_id'], 'idx_saga_execution_id');
    table.index(['status'], 'idx_saga_execution_status');
    table.index(['tenant_id'], 'idx_saga_execution_tenant');
    table.index(['created_at'], 'idx_saga_execution_created');
  });

  // 5. Create idempotency_statistics table for metrics
  await knex.schema.createTable('idempotency_statistics', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id');
    table.date('date').notNullable();
    
    // Counters
    table.integer('total_keys').defaultTo(0);
    table.integer('active_keys').defaultTo(0);
    table.integer('expired_keys').defaultTo(0);
    table.integer('completed_keys').defaultTo(0);
    table.integer('failed_keys').defaultTo(0);
    table.integer('conflict_count').defaultTo(0);
    table.integer('cache_hits').defaultTo(0);
    table.integer('cache_misses').defaultTo(0);
    
    // Performance metrics
    table.float('average_processing_time_ms').defaultTo(0);
    table.float('average_lock_acquisition_time_ms').defaultTo(0);
    table.float('average_database_time_ms').defaultTo(0);
    table.integer('peak_concurrent_requests').defaultTo(0);
    
    // Storage metrics
    table.bigint('total_storage_bytes').defaultTo(0);
    table.float('average_response_size_bytes').defaultTo(0);
    table.float('compression_ratio').defaultTo(1.0);
    
    // Timestamps
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Constraints and indexes
    table.unique(['tenant_id', 'date'], 'idx_statistics_tenant_date');
    table.index(['date'], 'idx_statistics_date');
    table.index(['tenant_id'], 'idx_statistics_tenant');
  });

  // 6. Create function to automatically update updated_at timestamps
  await knex.raw(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ language 'plpgsql';
  `);

  // Add triggers for updated_at columns
  const tablesWithUpdatedAt = [
    'idempotency_keys',
    'distributed_transaction_contexts', 
    'distributed_transaction_participants',
    'saga_executions',
    'idempotency_statistics'
  ];

  for (const tableName of tablesWithUpdatedAt) {
    await knex.raw(`
      CREATE TRIGGER update_${tableName}_updated_at
        BEFORE UPDATE ON ${tableName}
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    `);
  }

  // 7. Create cleanup function for expired idempotency keys
  await knex.raw(`
    CREATE OR REPLACE FUNCTION cleanup_expired_idempotency_keys(batch_size INTEGER DEFAULT 100)
    RETURNS INTEGER AS $$
    DECLARE
      deleted_count INTEGER;
    BEGIN
      -- Delete expired keys in batches
      WITH expired_keys AS (
        SELECT id FROM idempotency_keys 
        WHERE expires_at <= NOW() 
        LIMIT batch_size
      )
      DELETE FROM idempotency_keys 
      WHERE id IN (SELECT id FROM expired_keys);
      
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
      RETURN deleted_count;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // 8. Create indexes for better query performance
  await knex.raw(`
    -- Partial indexes for active records
    CREATE INDEX CONCURRENTLY idx_idempotency_active 
      ON idempotency_keys (tenant_id, status) 
      WHERE status IN ('pending', 'processing');
    
    CREATE INDEX CONCURRENTLY idx_idempotency_recent 
      ON idempotency_keys (tenant_id, created_at) 
      WHERE created_at > NOW() - INTERVAL '7 days';
      
    -- Composite index for common queries
    CREATE INDEX CONCURRENTLY idx_idempotency_lookup 
      ON idempotency_keys (idempotency_key, tenant_id, status, expires_at);
      
    -- Index for cleanup operations
    CREATE INDEX CONCURRENTLY idx_idempotency_cleanup 
      ON idempotency_keys (expires_at, status) 
      WHERE expires_at <= NOW();
  `);

  console.log('✅ Idempotency and distributed transaction tables created successfully');
};

export const down = async (knex) => {
  console.log('Dropping idempotency and distributed transaction tables...');

  // Drop indexes first (they might not exist if created concurrently)
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_idempotency_active');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_idempotency_recent');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_idempotency_lookup');
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_idempotency_cleanup');

  // Drop functions
  await knex.raw('DROP FUNCTION IF EXISTS cleanup_expired_idempotency_keys(INTEGER)');
  await knex.raw('DROP FUNCTION IF EXISTS update_updated_at_column()');

  // Drop tables (in reverse order due to foreign keys)
  await knex.schema.dropTableIfExists('idempotency_statistics');
  await knex.schema.dropTableIfExists('saga_executions');
  await knex.schema.dropTableIfExists('distributed_transaction_participants');
  await knex.schema.dropTableIfExists('distributed_transaction_contexts');
  await knex.schema.dropTableIfExists('idempotency_keys');

  console.log('✅ Idempotency and distributed transaction tables dropped successfully');
};