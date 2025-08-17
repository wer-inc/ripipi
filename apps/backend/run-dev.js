#!/usr/bin/env node

// Simple development runner for the backend
require('dotenv').config();

// Check required environment variables
const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET',
  'NODE_ENV'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  console.error('Missing required environment variables:', missingVars.join(', '));
  console.log('\nSetting default values for development...');
  
  // Set default values for development
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ripipi';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-change-in-production';
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
  process.env.API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
  process.env.PORT = process.env.PORT || '3000';
}

console.log('Starting backend server...');
console.log('Environment:', process.env.NODE_ENV);
console.log('Database URL:', process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@'));
console.log('API Port:', process.env.PORT);

// For now, just show the configuration since we have TypeScript compilation issues
console.log('\nTo run the backend server manually:');
console.log('1. Fix npm install issues');
console.log('2. Run: npx tsx src/server.ts');
console.log('3. Or compile with: npx tsc && node dist/server.js');

console.log('\nFrontend is running at: http://localhost:5174');
console.log('Backend should run at: http://localhost:3000');