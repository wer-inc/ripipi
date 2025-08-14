#!/usr/bin/env tsx

/**
 * Database Migration Script
 * 
 * This script handles database migrations using node-pg-migrate
 * with proper environment configuration and error handling.
 * 
 * Usage:
 *   npm run migrate:up     - Run all pending migrations
 *   npm run migrate:down   - Rollback last migration
 *   tsx scripts/migrate.ts up     - Run migrations via script
 *   tsx scripts/migrate.ts down   - Rollback via script
 */

import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import runner from 'node-pg-migrate';
import { Client } from 'pg';

// Load environment variables
dotenvConfig({ path: join(__dirname, '../.env') });

interface MigrationOptions {
  direction: 'up' | 'down';
  count?: number;
  verbose?: boolean;
  dryRun?: boolean;
}

/**
 * Database configuration from environment variables
 */
function getDatabaseConfig() {
  const dbConfig = {
    user: process.env.DB_USER || process.env.POSTGRES_USER || 'postgres',
    password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || '',
    host: process.env.DB_HOST || process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.DB_NAME || process.env.POSTGRES_DB || 'ripipi_dev',
  };

  // Validate required configuration
  if (!dbConfig.password) {
    throw new Error('Database password is required. Set DB_PASSWORD or POSTGRES_PASSWORD.');
  }

  return dbConfig;
}

/**
 * Test database connection
 */
async function testConnection(dbConfig: ReturnType<typeof getDatabaseConfig>): Promise<void> {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    console.log('✅ Database connection successful');
    
    // Test if we can read from the database
    const result = await client.query('SELECT NOW() as current_time');
    console.log(`📅 Database time: ${result.rows[0].current_time}`);
    
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * Run database migrations
 */
async function runMigrations(options: MigrationOptions): Promise<void> {
  const dbConfig = getDatabaseConfig();
  
  console.log('🔍 Testing database connection...');
  await testConnection(dbConfig);
  
  const migrationOptions = {
    databaseUrl: {
      user: dbConfig.user,
      password: dbConfig.password,
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
    },
    migrationsTable: 'pgmigrations',
    dir: join(__dirname, '../migrations'),
    direction: options.direction,
    count: options.count,
    verbose: options.verbose || false,
    dryRun: options.dryRun || false,
    createSchema: true,
    createMigrationsSchema: true,
    noLock: false,
    decamelize: false,
  };

  try {
    console.log(`🚀 Running migrations ${options.direction}...`);
    console.log(`📁 Migration directory: ${migrationOptions.dir}`);
    
    if (options.dryRun) {
      console.log('🧪 Dry run mode - no changes will be made');
    }
    
    const startTime = Date.now();
    const migrations = await runner(migrationOptions);
    const duration = Date.now() - startTime;
    
    if (migrations.length === 0) {
      console.log('✅ No migrations to run');
    } else {
      console.log(`✅ Successfully ran ${migrations.length} migration(s) in ${duration}ms:`);
      migrations.forEach((migration, index) => {
        console.log(`   ${index + 1}. ${migration.name}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'up';
  const count = args.includes('--count') ? parseInt(args[args.indexOf('--count') + 1], 10) : undefined;
  const verbose = args.includes('--verbose') || args.includes('-v');
  const dryRun = args.includes('--dry-run') || args.includes('-d');
  
  console.log('🗄️  RIPIPI Database Migration Tool');
  console.log('================================');
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🎯 Command: ${command}`);
  
  if (count) {
    console.log(`🔢 Count: ${count}`);
  }
  if (verbose) {
    console.log('📝 Verbose mode enabled');
  }
  if (dryRun) {
    console.log('🧪 Dry run mode enabled');
  }
  
  const validCommands = ['up', 'down'];
  if (!validCommands.includes(command)) {
    console.error(`❌ Invalid command: ${command}`);
    console.log('Valid commands: up, down');
    process.exit(1);
  }

  try {
    await runMigrations({
      direction: command as 'up' | 'down',
      count,
      verbose,
      dryRun,
    });
    
    console.log('✅ Migration completed successfully');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch((error) => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });
}

export { runMigrations, getDatabaseConfig, testConnection };