import pino from 'pino';
import { config } from './index';

// Create logger instance
export const logger = pino({
  level: config.LOG_LEVEL,
  ...(config.LOG_PRETTY && config.NODE_ENV !== 'production'
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
            colorize: true,
          },
        },
      }
    : {}),
  
  // Redact sensitive information
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'passwordHash',
      'token',
      'refreshToken',
      'accessToken',
      'apiKey',
      'secret',
      'creditCard',
      'ssn',
    ],
    censor: '[REDACTED]',
  },
  
  // Serializers
  serializers: {
    req: (request) => ({
      method: request.method,
      url: request.url,
      headers: request.headers,
      hostname: request.hostname,
      remoteAddress: request.ip,
      remotePort: request.socket?.remotePort,
    }),
    res: (reply) => ({
      statusCode: reply.statusCode,
    }),
    err: pino.stdSerializers.err,
  },
  
  // Base properties
  base: {
    env: config.NODE_ENV,
    revision: process.env.GIT_REVISION || null,
  },
});

// Child logger for different modules
export const createLogger = (name: string) => {
  return logger.child({ module: name });
};