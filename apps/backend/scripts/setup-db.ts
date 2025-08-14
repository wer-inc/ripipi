#!/usr/bin/env tsx

/**
 * Development Database Setup Script
 * 
 * This script sets up a complete development database environment:
 * 1. Creates database if it doesn't exist
 * 2. Runs all migrations
 * 3. Inserts seed data for development/testing
 * 
 * Usage:
 *   tsx scripts/setup-db.ts
 *   tsx scripts/setup-db.ts --reset  # Drop and recreate database
 */

import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import { Client } from 'pg';
import { promises as fs } from 'fs';
import { runMigrations, getDatabaseConfig } from './migrate';

// Load environment variables
dotenvConfig({ path: join(__dirname, '../.env') });

interface SetupOptions {
  reset?: boolean;
  skipSeeds?: boolean;
  verbose?: boolean;
}

/**
 * Get database connection without specifying database name
 * (for creating databases)
 */
function getSystemDatabaseConfig() {
  const config = getDatabaseConfig();
  return {
    ...config,
    database: 'postgres', // Connect to system database
  };
}

/**
 * Check if database exists
 */
async function databaseExists(dbName: string): Promise<boolean> {
  const client = new Client(getSystemDatabaseConfig());
  
  try {
    await client.connect();
    const result = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName]
    );
    return result.rows.length > 0;
  } finally {
    await client.end();
  }
}

/**
 * Create database if it doesn't exist
 */
async function createDatabase(dbName: string): Promise<void> {
  const client = new Client(getSystemDatabaseConfig());
  
  try {
    await client.connect();
    
    const exists = await databaseExists(dbName);
    if (exists) {
      console.log(`✅ Database '${dbName}' already exists`);
      return;
    }
    
    console.log(`🏗️  Creating database '${dbName}'...`);
    await client.query(`CREATE DATABASE "${dbName}"`);
    console.log(`✅ Database '${dbName}' created successfully`);
    
  } catch (error) {
    console.error(`❌ Failed to create database '${dbName}':`, error);
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * Drop database if it exists
 */
async function dropDatabase(dbName: string): Promise<void> {
  const client = new Client(getSystemDatabaseConfig());
  
  try {
    await client.connect();
    
    const exists = await databaseExists(dbName);
    if (!exists) {
      console.log(`ℹ️  Database '${dbName}' doesn't exist`);
      return;
    }
    
    console.log(`🗑️  Dropping database '${dbName}'...`);
    
    // Terminate all connections to the database first
    await client.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()
    `, [dbName]);
    
    await client.query(`DROP DATABASE "${dbName}"`);
    console.log(`✅ Database '${dbName}' dropped successfully`);
    
  } catch (error) {
    console.error(`❌ Failed to drop database '${dbName}':`, error);
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * Execute SQL file
 */
async function executeSqlFile(filePath: string, dbConfig: ReturnType<typeof getDatabaseConfig>): Promise<void> {
  const client = new Client(dbConfig);
  
  try {
    console.log(`📄 Executing SQL file: ${filePath}`);
    
    const sql = await fs.readFile(filePath, 'utf8');
    if (!sql.trim()) {
      console.log(`⚠️  SQL file is empty: ${filePath}`);
      return;
    }
    
    await client.connect();
    await client.query(sql);
    console.log(`✅ Successfully executed: ${filePath}`);
    
  } catch (error) {
    console.error(`❌ Failed to execute SQL file ${filePath}:`, error);
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * Run seed data files
 */
async function runSeedData(dbConfig: ReturnType<typeof getDatabaseConfig>): Promise<void> {
  const seedDir = join(__dirname, '../seeds');
  
  try {
    // Check if seeds directory exists
    const seedExists = await fs.access(seedDir).then(() => true).catch(() => false);
    if (!seedExists) {
      console.log('📁 Creating seeds directory...');
      await fs.mkdir(seedDir, { recursive: true });
    }
    
    // Check if there are any .sql files in seeds directory
    const files = await fs.readdir(seedDir);
    const sqlFiles = files.filter(file => file.endsWith('.sql')).sort();
    
    if (sqlFiles.length === 0) {
      console.log('ℹ️  No seed files found in seeds/ directory');
      return;
    }
    
    console.log('🌱 Running seed data...');
    for (const file of sqlFiles) {
      const filePath = join(seedDir, file);
      await executeSqlFile(filePath, dbConfig);
    }
    
    console.log('✅ All seed data executed successfully');
    
  } catch (error) {
    console.error('❌ Failed to run seed data:', error);
    throw error;
  }
}

/**
 * Setup database environment
 */
async function setupDatabase(options: SetupOptions = {}): Promise<void> {
  const dbConfig = getDatabaseConfig();
  const dbName = dbConfig.database;
  
  console.log('🗄️  RIPIPI Database Setup');
  console.log('=========================');
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🎯 Database: ${dbName}`);
  console.log(`🏠 Host: ${dbConfig.host}:${dbConfig.port}`);
  
  try {
    // Step 1: Handle database creation/reset
    if (options.reset) {
      console.log('\n🔄 Resetting database...');
      await dropDatabase(dbName);
      await createDatabase(dbName);
    } else {
      console.log('\n🏗️  Ensuring database exists...');
      await createDatabase(dbName);
    }
    
    // Step 2: Run migrations
    console.log('\n📦 Running migrations...');
    await runMigrations({
      direction: 'up',
      verbose: options.verbose,
    });
    
    // Step 3: Run seed data
    if (!options.skipSeeds) {
      console.log('\n🌱 Setting up seed data...');
      await runSeedData(dbConfig);
    } else {
      console.log('\n⏭️  Skipping seed data');
    }
    
    console.log('\n✅ Database setup completed successfully!');
    console.log('\n🎉 Your development database is ready to use.');
    
  } catch (error) {
    console.error('\n❌ Database setup failed:', error);
    throw error;
  }
}

/**
 * Verify database setup
 */
async function verifySetup(): Promise<void> {
  const dbConfig = getDatabaseConfig();
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    
    console.log('\n🔍 Verifying database setup...');
    
    // Check if key tables exist
    const tables = ['tenants', 'users', 'services', 'customers', 'bookings'];
    for (const table of tables) {
      const result = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = $1
        )
      `, [table]);
      
      if (result.rows[0].exists) {
        console.log(`✅ Table '${table}' exists`);
      } else {
        console.log(`❌ Table '${table}' missing`);
      }
    }
    
    // Check if there's sample data
    const tenantCount = await client.query('SELECT COUNT(*) FROM tenants');
    const userCount = await client.query('SELECT COUNT(*) FROM users');
    
    console.log(`📊 Sample data: ${tenantCount.rows[0].count} tenants, ${userCount.rows[0].count} users`);
    
  } catch (error) {
    console.error('❌ Verification failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const reset = args.includes('--reset') || args.includes('-r');
  const skipSeeds = args.includes('--skip-seeds') || args.includes('-s');
  const verbose = args.includes('--verbose') || args.includes('-v');
  const verify = args.includes('--verify');
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
🗄️  RIPIPI Database Setup Script

Usage:
  tsx scripts/setup-db.ts [options]

Options:
  --reset, -r       Drop and recreate database
  --skip-seeds, -s  Skip running seed data
  --verbose, -v     Verbose output
  --verify          Only verify existing setup
  --help, -h        Show this help

Examples:
  tsx scripts/setup-db.ts              # Setup development database
  tsx scripts/setup-db.ts --reset      # Reset and setup database
  tsx scripts/setup-db.ts --verify     # Verify current setup
`);
    return;
  }
  
  try {
    if (verify) {
      await verifySetup();
    } else {
      await setupDatabase({ reset, skipSeeds, verbose });
      await verifySetup();
    }
    
  } catch (error) {
    console.error('💥 Setup failed:', error);
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

export { setupDatabase, createDatabase, dropDatabase, runSeedData, verifySetup };