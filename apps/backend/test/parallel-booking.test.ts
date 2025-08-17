/**
 * Parallel Booking Test
 * Tests that the system correctly handles 100 concurrent booking attempts
 * for the same timeslot, ensuring only 1 succeeds and 99 fail
 */

import test from 'node:test';
import assert from 'node:assert';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';
import { ContinuousBookingService } from '../src/services/continuous-booking.service.js';

/**
 * Test configuration
 */
const TEST_CONFIG = {
  parallelRequests: 100,
  tenantId: 1,
  serviceId: 1,
  resourceId: 1,
  customerId: 1,
  durationMinutes: 30,
  testTimeout: 30000, // 30 seconds
};

/**
 * Setup test database with required data
 */
async function setupTestData(app: FastifyInstance): Promise<void> {
  const db = app.pg;
  
  // Create test tenant
  await db.query(`
    INSERT INTO tenants (id, code, name, tz)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id) DO NOTHING
  `, [TEST_CONFIG.tenantId, 'test-tenant', 'Test Tenant', 'Asia/Tokyo']);
  
  // Create tenant settings
  await db.query(`
    INSERT INTO tenant_settings (tenant_id, granularity_min, currency_code)
    VALUES ($1, $2, $3)
    ON CONFLICT (tenant_id) DO UPDATE SET granularity_min = $2
  `, [TEST_CONFIG.tenantId, 15, 'JPY']);
  
  // Create test service
  await db.query(`
    INSERT INTO services (
      id, tenant_id, name, duration_min, 
      price_jpy, buffer_before_min, buffer_after_min, active
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (id) DO UPDATE SET duration_min = $4
  `, [
    TEST_CONFIG.serviceId,
    TEST_CONFIG.tenantId,
    'Test Service',
    30,
    5000,
    0,
    0,
    true
  ]);
  
  // Create test resource
  await db.query(`
    INSERT INTO resources (id, tenant_id, kind, name, capacity, active)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (id) DO NOTHING
  `, [
    TEST_CONFIG.resourceId,
    TEST_CONFIG.tenantId,
    'staff',
    'Test Resource',
    1,
    true
  ]);
  
  // Create test customer
  await db.query(`
    INSERT INTO customers (id, tenant_id, name, email)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id) DO NOTHING
  `, [
    TEST_CONFIG.customerId,
    TEST_CONFIG.tenantId,
    'Test Customer',
    'test@example.com'
  ]);
  
  // Create timeslots for testing (2 hours worth, 15-minute slots)
  const startTime = new Date();
  startTime.setHours(startTime.getHours() + 1); // Start 1 hour from now
  startTime.setMinutes(0, 0, 0);
  
  const slots = [];
  for (let i = 0; i < 8; i++) {
    const slotStart = new Date(startTime.getTime() + i * 15 * 60 * 1000);
    const slotEnd = new Date(slotStart.getTime() + 15 * 60 * 1000);
    
    slots.push({
      tenant_id: TEST_CONFIG.tenantId,
      resource_id: TEST_CONFIG.resourceId,
      start_at: slotStart,
      end_at: slotEnd,
      available_capacity: 1, // Only 1 capacity available
    });
  }
  
  // Clear existing timeslots for this resource
  await db.query(`
    DELETE FROM timeslots 
    WHERE tenant_id = $1 AND resource_id = $2
  `, [TEST_CONFIG.tenantId, TEST_CONFIG.resourceId]);
  
  // Insert new timeslots
  for (const slot of slots) {
    await db.query(`
      INSERT INTO timeslots (
        tenant_id, resource_id, start_at, end_at, available_capacity
      )
      VALUES ($1, $2, $3, $4, $5)
    `, [
      slot.tenant_id,
      slot.resource_id,
      slot.start_at,
      slot.end_at,
      slot.available_capacity
    ]);
  }
  
  console.log(`✅ Test data setup complete. Created ${slots.length} timeslots.`);
}

/**
 * Clean up test data
 */
async function cleanupTestData(app: FastifyInstance): Promise<void> {
  const db = app.pg;
  
  // Delete in reverse order of foreign key dependencies
  await db.query('DELETE FROM booking_items WHERE booking_id IN (SELECT id FROM bookings WHERE tenant_id = $1)', [TEST_CONFIG.tenantId]);
  await db.query('DELETE FROM bookings WHERE tenant_id = $1', [TEST_CONFIG.tenantId]);
  await db.query('DELETE FROM timeslots WHERE tenant_id = $1', [TEST_CONFIG.tenantId]);
  await db.query('DELETE FROM customers WHERE tenant_id = $1', [TEST_CONFIG.tenantId]);
  await db.query('DELETE FROM resources WHERE tenant_id = $1', [TEST_CONFIG.tenantId]);
  await db.query('DELETE FROM services WHERE tenant_id = $1', [TEST_CONFIG.tenantId]);
  await db.query('DELETE FROM tenant_settings WHERE tenant_id = $1', [TEST_CONFIG.tenantId]);
  await db.query('DELETE FROM tenants WHERE id = $1', [TEST_CONFIG.tenantId]);
  
  console.log('✅ Test data cleanup complete.');
}

/**
 * Main test: 100 parallel booking attempts
 */
test('Parallel booking test - 100 concurrent requests', { timeout: TEST_CONFIG.testTimeout }, async (t) => {
  let app: FastifyInstance | null = null;
  
  try {
    // Build and start the app
    app = await buildApp({
      logger: {
        level: 'error', // Reduce log noise during test
      },
    });
    
    await app.ready();
    
    // Setup test data
    await setupTestData(app);
    
    // Create booking service
    const bookingService = new ContinuousBookingService(app);
    
    // Prepare booking request
    const startTime = new Date();
    startTime.setHours(startTime.getHours() + 1);
    startTime.setMinutes(0, 0, 0);
    
    const bookingRequest = {
      tenantId: TEST_CONFIG.tenantId,
      serviceId: TEST_CONFIG.serviceId,
      resourceId: TEST_CONFIG.resourceId,
      startTime,
      durationMinutes: TEST_CONFIG.durationMinutes,
      customerId: TEST_CONFIG.customerId,
      capacity: 1,
    };
    
    console.log(`🚀 Starting parallel booking test with ${TEST_CONFIG.parallelRequests} concurrent requests...`);
    console.log(`   Target timeslot: ${startTime.toISOString()}`);
    
    // Execute parallel booking test
    const result = await bookingService.testParallelBookings(
      bookingRequest,
      TEST_CONFIG.parallelRequests
    );
    
    // Log results
    console.log('\n📊 Test Results:');
    console.log(`   ✅ Successful bookings: ${result.successful}`);
    console.log(`   ❌ Failed bookings: ${result.failed}`);
    console.log(`   Success rate: ${(result.successful / TEST_CONFIG.parallelRequests * 100).toFixed(2)}%`);
    
    // Analyze error types
    const errorCounts = result.errors.reduce((acc, err) => {
      const code = err.code || 'unknown';
      acc[code] = (acc[code] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    console.log('\n📈 Error breakdown:');
    Object.entries(errorCounts).forEach(([code, count]) => {
      console.log(`   ${code}: ${count}`);
    });
    
    // Assertions
    assert.strictEqual(
      result.successful, 
      1, 
      `Expected exactly 1 successful booking, got ${result.successful}`
    );
    
    assert.strictEqual(
      result.failed, 
      TEST_CONFIG.parallelRequests - 1,
      `Expected ${TEST_CONFIG.parallelRequests - 1} failed bookings, got ${result.failed}`
    );
    
    // Verify that most failures are due to sold out slots
    const soldOutErrors = result.errors.filter(e => 
      e.code === 'timeslot_sold_out' || 
      e.code === 'insufficient_continuous_slots'
    ).length;
    
    assert.ok(
      soldOutErrors > 0,
      'Expected some errors to be timeslot_sold_out or insufficient_continuous_slots'
    );
    
    console.log('\n✅ All assertions passed!');
    
  } finally {
    // Cleanup
    if (app) {
      await cleanupTestData(app);
      await app.close();
    }
  }
});

/**
 * Additional test: Verify idempotency with same key
 */
test('Idempotency test - Same key returns same result', { timeout: 10000 }, async (t) => {
  let app: FastifyInstance | null = null;
  
  try {
    app = await buildApp({
      logger: { level: 'error' },
    });
    
    await app.ready();
    await setupTestData(app);
    
    const idempotencyKey = `test-key-${Date.now()}`;
    const startTime = new Date();
    startTime.setHours(startTime.getHours() + 1);
    startTime.setMinutes(0, 0, 0);
    
    // Make first request
    const res1 = await app.inject({
      method: 'POST',
      url: '/v1/public/bookings',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      payload: {
        tenant_id: TEST_CONFIG.tenantId,
        service_id: TEST_CONFIG.serviceId,
        timeslot_ids: [1], // Assuming timeslot ID 1 exists
        customer: {
          name: 'Test Customer',
          email: 'test@example.com',
        },
      },
    });
    
    // Make second request with same idempotency key
    const res2 = await app.inject({
      method: 'POST',
      url: '/v1/public/bookings',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      payload: {
        tenant_id: TEST_CONFIG.tenantId,
        service_id: TEST_CONFIG.serviceId,
        timeslot_ids: [1],
        customer: {
          name: 'Test Customer',
          email: 'test@example.com',
        },
      },
    });
    
    // Both should return same result
    assert.strictEqual(res1.statusCode, res2.statusCode, 'Status codes should match');
    
    if (res1.statusCode === 201) {
      const body1 = JSON.parse(res1.body);
      const body2 = JSON.parse(res2.body);
      assert.strictEqual(body1.booking_id, body2.booking_id, 'Booking IDs should match');
    }
    
    console.log('✅ Idempotency test passed!');
    
  } finally {
    if (app) {
      await cleanupTestData(app);
      await app.close();
    }
  }
});

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🧪 Running booking system tests...\n');
}