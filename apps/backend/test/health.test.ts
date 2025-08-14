import tap from 'tap';
import { buildApp } from '../src/app';
import { FastifyInstance } from 'fastify';

tap.test('Health check endpoint', async (t) => {
  let app: FastifyInstance;

  t.beforeEach(async () => {
    app = await buildApp({ logger: false });
  });

  t.afterEach(async () => {
    await app.close();
  });

  t.test('GET /health returns 200', async (t) => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    t.equal(response.statusCode, 200, 'returns 200 OK');
    
    const body = JSON.parse(response.body);
    t.ok(body.status, 'has status field');
    t.ok(body.timestamp, 'has timestamp field');
    t.ok(body.environment, 'has environment field');
  });

  t.test('GET /v1/meta returns API metadata', async (t) => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/meta',
    });

    t.equal(response.statusCode, 200, 'returns 200 OK');
    
    const body = JSON.parse(response.body);
    t.equal(body.version, '1.0.0', 'has correct version');
    t.ok(body.environment, 'has environment field');
    t.ok(body.features, 'has features field');
  });
});