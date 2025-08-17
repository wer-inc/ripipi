/**
 * Webhook Service
 * Handles webhook notifications to external systems
 */

import { FastifyInstance } from 'fastify';
import { logger } from '../config/logger.js';

export class WebhookService {
  constructor(private fastify: FastifyInstance) {}

  async sendWebhook(params: {
    tenantId: number;
    eventType: string;
    payload: any;
  }): Promise<void> {
    logger.info('Sending webhook', {
      tenantId: params.tenantId,
      eventType: params.eventType
    });
    // Implementation would send HTTP request to configured webhook URL
    // This is a placeholder implementation
  }
}