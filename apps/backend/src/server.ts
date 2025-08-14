import { buildApp } from './app';
import { config, validateConfig } from './config';

/**
 * Start the server
 */
async function start() {
  try {
    // Validate configuration
    validateConfig();
    
    // Build the app
    const app = await buildApp();
    
    // Start listening
    await app.listen({
      host: config.HOST,
      port: config.PORT,
    });
    
    app.log.info(
      `🚀 Server is running at http://${config.HOST}:${config.PORT}`
    );
    app.log.info(`📝 Environment: ${config.NODE_ENV}`);
    
    if (config.ENABLE_SWAGGER) {
      app.log.info(
        `📚 API documentation available at http://${config.HOST}:${config.PORT}/documentation`
      );
    }
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Start the server
start();