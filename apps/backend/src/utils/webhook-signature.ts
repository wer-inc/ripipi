/**
 * Webhook Signature Verification Utility
 * Mock implementation for Stripe webhook signature verification
 * Can be easily replaced with actual Stripe signature verification in production
 */

import crypto from 'crypto';
import { logger } from '../config/logger.js';
import { BadRequestError } from './errors.js';

/**
 * Webhook signature verification result
 */
export interface SignatureVerificationResult {
  isValid: boolean;
  timestamp?: number;
  eventId?: string;
  error?: string;
}

/**
 * Mock webhook signature verifier
 * This simulates Stripe's webhook signature verification process
 */
export class WebhookSignatureVerifier {
  private static readonly MOCK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_mock_test_secret';
  private static readonly TIMESTAMP_TOLERANCE_SECONDS = 300; // 5 minutes
  
  /**
   * Verify webhook signature (mock implementation)
   * In production, this would use Stripe's signature verification
   */
  static verifySignature(
    payload: string,
    signature: string,
    secret: string = this.MOCK_SECRET
  ): SignatureVerificationResult {
    try {
      logger.debug('Verifying webhook signature', {
        payloadLength: payload.length,
        signatureLength: signature.length
      });

      // Parse the signature header
      const elements = this.parseSignatureHeader(signature);
      if (!elements.timestamp || !elements.signature) {
        return {
          isValid: false,
          error: 'Invalid signature format'
        };
      }

      const timestamp = parseInt(elements.timestamp);
      
      // Check timestamp tolerance
      const currentTime = Math.floor(Date.now() / 1000);
      if (currentTime - timestamp > this.TIMESTAMP_TOLERANCE_SECONDS) {
        return {
          isValid: false,
          error: 'Timestamp outside tolerance window'
        };
      }

      // Verify signature (mock implementation)
      const expectedSignature = this.computeSignature(payload, timestamp, secret);
      const isValid = this.secureCompare(elements.signature, expectedSignature);

      // Extract event ID from payload for tracking
      let eventId: string | undefined;
      try {
        const eventData = JSON.parse(payload);
        eventId = eventData.id;
      } catch {
        // Ignore parsing errors
      }

      return {
        isValid,
        timestamp,
        eventId,
        error: isValid ? undefined : 'Signature verification failed'
      };

    } catch (error) {
      logger.error('Webhook signature verification error', { error });
      return {
        isValid: false,
        error: 'Signature verification error'
      };
    }
  }

  /**
   * Parse Stripe signature header format
   * Format: t=timestamp,v1=signature,v1=signature
   */
  private static parseSignatureHeader(signature: string): { timestamp?: string; signature?: string } {
    const elements: { timestamp?: string; signature?: string } = {};
    
    const parts = signature.split(',');
    for (const part of parts) {
      const [key, value] = part.split('=', 2);
      if (key === 't') {
        elements.timestamp = value;
      } else if (key === 'v1') {
        elements.signature = value;
      }
    }

    return elements;
  }

  /**
   * Compute expected signature (mock implementation)
   * In production, this would match Stripe's signature algorithm
   */
  private static computeSignature(payload: string, timestamp: number, secret: string): string {
    const signedPayload = `${timestamp}.${payload}`;
    return crypto
      .createHmac('sha256', secret)
      .update(signedPayload, 'utf8')
      .digest('hex');
  }

  /**
   * Secure string comparison to prevent timing attacks
   */
  private static secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    
    return result === 0;
  }

  /**
   * Generate mock signature for testing
   * This is used in tests and mock scenarios
   */
  static generateMockSignature(payload: string, secret: string = this.MOCK_SECRET): string {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = this.computeSignature(payload, timestamp, secret);
    return `t=${timestamp},v1=${signature}`;
  }

  /**
   * Validate webhook signature and throw error if invalid
   */
  static validateSignatureOrThrow(payload: string, signature: string, secret?: string): void {
    const result = this.verifySignature(payload, signature, secret);
    
    if (!result.isValid) {
      throw new BadRequestError(`Invalid webhook signature: ${result.error}`);
    }
  }
}

/**
 * Middleware helper for webhook signature verification
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret?: string
): SignatureVerificationResult {
  return WebhookSignatureVerifier.verifySignature(payload, signature, secret);
}

/**
 * Express/Fastify middleware for webhook signature verification
 */
export function webhookSignatureMiddleware(secret?: string) {
  return (request: any, reply: any, done: any) => {
    try {
      const signature = request.headers['stripe-signature'];
      if (!signature) {
        throw new BadRequestError('Missing Stripe-Signature header');
      }

      const payload = request.body;
      if (!payload) {
        throw new BadRequestError('Missing request body');
      }

      const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
      
      WebhookSignatureVerifier.validateSignatureOrThrow(
        payloadString,
        signature,
        secret
      );

      // Add signature verification result to request for later use
      request.webhookSignature = {
        verified: true,
        timestamp: Math.floor(Date.now() / 1000)
      };

      done();
    } catch (error) {
      logger.error('Webhook signature verification failed', {
        error: error.message,
        headers: request.headers
      });
      done(error);
    }
  };
}

export default WebhookSignatureVerifier;