import Fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from './config';
import { logger } from './config/logger';

// Plugins
import postgresPlugin from './plugins/postgres';
import jwtPlugin from './plugins/jwt';
import monitoringPlugin from './plugins/monitoring';
import { databaseHooksPlugin } from './hooks/database';
import { authHooksPlugin } from './hooks/auth';

// Middleware
import errorHandlerPlugin from './middleware/error-handler';
import requestLoggerPlugin from './middleware/request-logger';

// Routes
import authRoutes from './routes/v1/auth';
import userRoutes from './routes/v1/users';
import bookingRoutes from './routes/v1/bookings';
import timeslotRoutes from './routes/v1/timeslots';
import serviceRoutes from './routes/v1/services';
import resourceRoutes from './routes/v1/resources';

/**
 * Build the Fastify application instance
 */
export async function buildApp(opts: FastifyServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger,
    ...opts,
  }).withTypeProvider<TypeBoxTypeProvider>();

  // Register core plugins
  await app.register(sensible);
  
  // Error handling and logging middleware (register early)
  await app.register(errorHandlerPlugin);
  await app.register(requestLoggerPlugin);
  
  // Security plugins
  await app.register(helmet, {
    contentSecurityPolicy: config.NODE_ENV === 'production' ? undefined : false,
  });
  
  await app.register(cors, {
    origin: config.CORS_ORIGIN,
    credentials: config.CORS_CREDENTIALS,
  });

  // Rate limiting
  await app.register(rateLimit, {
    global: false, // We'll use it per-route
    redis: config.REDIS_URL ? config.REDIS_URL : undefined,
  });

  // Database connection
  await app.register(postgresPlugin);

  // JWT authentication
  await app.register(jwtPlugin);

  // Monitoring and metrics
  await app.register(monitoringPlugin);

  // Global hooks
  await app.register(databaseHooksPlugin);
  await app.register(authHooksPlugin);

  // Swagger documentation (development only)
  if (config.ENABLE_SWAGGER) {
    await app.register(swagger, {
      swagger: {
        info: {
          title: 'Ripipi API',
          description: 'Reservation System API Documentation',
          version: '1.0.0',
        },
        externalDocs: {
          url: 'https://github.com/ripipi',
          description: 'Find more info here',
        },
        host: `localhost:${config.PORT}`,
        schemes: ['http', 'https'],
        consumes: ['application/json'],
        produces: ['application/json'],
        tags: [
          { name: 'auth', description: 'Authentication endpoints' },
          { name: 'users', description: 'User management endpoints' },
          { name: 'bookings', description: 'Booking endpoints' },
          { name: 'timeslots', description: 'Timeslot management endpoints' },
          { name: 'services', description: 'Service management endpoints' },
          { name: 'resources', description: 'Resource management endpoints' },
        ],
        securityDefinitions: {
          Bearer: {
            type: 'apiKey',
            name: 'Authorization',
            in: 'header',
            description: 'JWT Authorization header using the Bearer scheme. Example: "Bearer {token}"',
          },
        },
      },
    });

    await app.register(swaggerUi, {
      routePrefix: '/documentation',
      uiConfig: {
        docExpansion: 'none',
        deepLinking: false,
      },
      staticCSP: true,
      transformStaticCSP: (header) => header,
      transformSpecification: (swaggerObject) => {
        return swaggerObject;
      },
    });
  }

  // API Routes
  await app.register(authRoutes, { prefix: '/v1' });
  await app.register(userRoutes, { prefix: '/v1' });
  await app.register(bookingRoutes, { prefix: '/v1' });
  await app.register(timeslotRoutes, { prefix: '/v1' });
  await app.register(serviceRoutes, { prefix: '/v1' });
  await app.register(resourceRoutes, { prefix: '/v1' });

  // Health check
  app.get('/health', async (request, reply) => {
    try {
      // Check database connection
      const dbHealth = await app.pg.query('SELECT 1');
      
      return { 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        environment: config.NODE_ENV,
        services: {
          database: dbHealth ? 'healthy' : 'unhealthy',
          redis: 'healthy' // TODO: Add Redis health check
        }
      };
    } catch (error) {
      reply.code(503).send({
        status: 'error',
        timestamp: new Date().toISOString(),
        environment: config.NODE_ENV,
        services: {
          database: 'unhealthy',
          redis: 'unknown'
        }
      });
    }
  });

  // API version info
  app.get('/v1/meta', async () => {
    return {
      version: '1.0.0',
      environment: config.NODE_ENV,
      features: {
        swagger: config.ENABLE_SWAGGER,
        metrics: config.ENABLE_METRICS,
      },
    };
  });

  // Error handling is now managed by the error-handler middleware

  // Graceful shutdown
  const gracefulShutdown = async () => {
    app.log.info('Received shutdown signal, closing server gracefully...');
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  return app;
}