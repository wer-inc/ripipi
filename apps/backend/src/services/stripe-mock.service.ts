/**
 * Mock Stripe Service
 * Simulates Stripe API behavior for development and testing
 */

import { randomBytes, createHash } from 'crypto';
import {
  MockStripeService,
  StripeCustomer,
  PaymentMethod,
  PaymentIntent,
  SetupIntent,
  WebhookEvent,
  PaymentError,
  CreateCustomerRequest,
  CreatePaymentMethodRequest,
  CreatePaymentIntentRequest,
  CreateSetupIntentRequest,
  ConfirmPaymentIntentRequest,
  ConfirmSetupIntentRequest,
  MockPaymentScenario,
  PaymentStatus,
  SetupIntentStatus,
  PaymentErrorCode,
  CardBrand
} from '../types/payment.js';
import { logger } from '../config/logger.js';

/**
 * Mock Stripe Service Implementation
 * Provides realistic simulation of Stripe API with configurable scenarios
 */
export class StripeMarkService implements MockStripeService {
  private customers: Map<string, StripeCustomer> = new Map();
  private paymentMethods: Map<string, PaymentMethod> = new Map();
  private paymentIntents: Map<string, PaymentIntent> = new Map();
  private setupIntents: Map<string, SetupIntent> = new Map();
  private webhookEvents: WebhookEvent[] = [];
  private scenarios: MockPaymentScenario[] = [];
  private webhookSecret: string = 'whsec_mock_secret_key';

  constructor() {
    logger.info('Initializing Mock Stripe Service');
    this.initializeDefaultScenarios();
  }

  /**
   * Initialize default payment scenarios
   */
  private initializeDefaultScenarios(): void {
    this.scenarios = [
      // Success scenarios
      { type: 'success', trigger: '4242424242424242' },
      
      // Card declined scenarios
      { type: 'failure', trigger: '4000000000000002', errorCode: 'card_declined', errorMessage: 'Your card was declined.' },
      { type: 'failure', trigger: '4000000000000069', errorCode: 'expired_card', errorMessage: 'Your card has expired.' },
      { type: 'failure', trigger: '4000000000000127', errorCode: 'incorrect_cvc', errorMessage: 'Your card\'s security code is incorrect.' },
      { type: 'failure', trigger: '4000000000000119', errorCode: 'processing_error', errorMessage: 'An error occurred while processing your card. Try again in a little bit.' },
      
      // Insufficient funds
      { type: 'failure', trigger: '4000000000000341', errorCode: 'insufficient_funds', errorMessage: 'Your card has insufficient funds.' },
      
      // 3D Secure authentication required
      { type: '3d_secure', trigger: '4000000000003220', requiresAction: true },
      { type: '3d_secure', trigger: '4000000000003063', requiresAction: true }, // Always requires authentication
      
      // Network errors
      { type: 'network_error', trigger: 'network_error_customer', errorCode: 'api_error', errorMessage: 'An error occurred with our API.' },
    ];
  }

  /**
   * Generate realistic mock IDs
   */
  private generateId(prefix: string): string {
    const random = randomBytes(12).toString('hex');
    return `${prefix}_mock_${random}`;
  }

  /**
   * Generate client secret
   */
  private generateClientSecret(id: string): string {
    const secret = randomBytes(16).toString('hex');
    return `${id}_secret_${secret}`;
  }

  /**
   * Get current Unix timestamp
   */
  private getCurrentTimestamp(): number {
    return Math.floor(Date.now() / 1000);
  }

  /**
   * Check if a scenario should be triggered
   */
  private getTriggeredScenario(trigger: string): MockPaymentScenario | null {
    return this.scenarios.find(scenario => scenario.trigger === trigger) || null;
  }

  /**
   * Create a payment error
   */
  private createPaymentError(scenario: MockPaymentScenario): PaymentError {
    return {
      type: 'card_error',
      code: scenario.errorCode || 'card_declined',
      message: scenario.errorMessage || 'Your card was declined.',
      decline_code: scenario.errorCode
    };
  }

  /**
   * Determine card brand from card number
   */
  private getCardBrand(cardNumber: string): CardBrand {
    const number = cardNumber.replace(/\s/g, '');
    if (number.startsWith('4')) return 'visa';
    if (number.match(/^5[1-5]/) || number.match(/^2[2-7]/)) return 'mastercard';
    if (number.match(/^3[47]/)) return 'amex';
    if (number.startsWith('6')) return 'discover';
    if (number.match(/^35/)) return 'jcb';
    return 'unknown';
  }

  /**
   * Simulate processing delay
   */
  private async simulateDelay(scenario?: MockPaymentScenario): Promise<void> {
    const delay = scenario?.delayMs || Math.random() * 1000 + 200; // 200-1200ms
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Generate webhook event
   */
  public generateWebhookEvent(eventType: string, data: any): WebhookEvent {
    const event: WebhookEvent = {
      id: this.generateId('evt'),
      object: 'event',
      api_version: '2020-08-27',
      created: this.getCurrentTimestamp(),
      data: {
        object: data
      },
      livemode: false,
      pending_webhooks: 1,
      request: {
        id: this.generateId('req'),
        idempotency_key: randomBytes(16).toString('hex')
      },
      type: eventType
    };

    this.webhookEvents.push(event);
    logger.info(`Generated webhook event: ${eventType}`, { eventId: event.id });
    
    return event;
  }

  /**
   * Customer methods
   */
  public async createCustomer(request: CreateCustomerRequest): Promise<StripeCustomer> {
    logger.info('Creating mock customer', { email: request.email });
    
    // Check for network error scenario
    const scenario = this.getTriggeredScenario(request.email || 'network_error_customer');
    if (scenario && scenario.type === 'network_error') {
      await this.simulateDelay(scenario);
      throw new Error(scenario.errorMessage || 'Network error occurred');
    }

    await this.simulateDelay();

    const customer: StripeCustomer = {
      id: this.generateId('cus'),
      object: 'customer',
      created: this.getCurrentTimestamp(),
      email: request.email,
      name: request.name,
      phone: request.phone,
      metadata: request.metadata || {},
      default_source: request.payment_method,
      invoice_settings: request.invoice_settings || {}
    };

    this.customers.set(customer.id, customer);
    
    // Generate webhook event
    this.generateWebhookEvent('customer.created', customer);

    logger.info('Mock customer created', { customerId: customer.id });
    return customer;
  }

  public async retrieveCustomer(customerId: string): Promise<StripeCustomer> {
    const customer = this.customers.get(customerId);
    if (!customer) {
      throw new Error(`No such customer: ${customerId}`);
    }
    return customer;
  }

  public async updateCustomer(customerId: string, updates: Partial<CreateCustomerRequest>): Promise<StripeCustomer> {
    const customer = await this.retrieveCustomer(customerId);
    const updatedCustomer = { ...customer, ...updates };
    this.customers.set(customerId, updatedCustomer);
    
    this.generateWebhookEvent('customer.updated', updatedCustomer);
    return updatedCustomer;
  }

  public async deleteCustomer(customerId: string): Promise<{ id: string; object: 'customer'; deleted: boolean }> {
    const customer = await this.retrieveCustomer(customerId);
    this.customers.delete(customerId);
    
    this.generateWebhookEvent('customer.deleted', { id: customerId, object: 'customer', deleted: true });
    return { id: customerId, object: 'customer', deleted: true };
  }

  /**
   * Payment method methods
   */
  public async createPaymentMethod(request: CreatePaymentMethodRequest): Promise<PaymentMethod> {
    logger.info('Creating mock payment method', { type: request.type });
    
    await this.simulateDelay();

    const cardNumber = request.card?.number || '4242424242424242';
    const scenario = this.getTriggeredScenario(cardNumber);
    
    if (scenario && (scenario.type === 'failure' || scenario.type === 'card_error')) {
      throw this.createPaymentError(scenario);
    }

    const paymentMethod: PaymentMethod = {
      id: this.generateId('pm'),
      object: 'payment_method',
      type: request.type,
      created: this.getCurrentTimestamp(),
      metadata: request.metadata || {},
      billing_details: request.billing_details
    };

    if (request.type === 'card' && request.card) {
      paymentMethod.card = {
        id: paymentMethod.id,
        brand: this.getCardBrand(request.card.number),
        last4: request.card.number.slice(-4),
        exp_month: request.card.exp_month,
        exp_year: request.card.exp_year,
        country: 'US',
        funding: 'credit',
        fingerprint: createHash('md5').update(request.card.number).digest('hex').slice(0, 16)
      };
    }

    this.paymentMethods.set(paymentMethod.id, paymentMethod);
    
    this.generateWebhookEvent('payment_method.created', paymentMethod);
    
    logger.info('Mock payment method created', { paymentMethodId: paymentMethod.id });
    return paymentMethod;
  }

  public async retrievePaymentMethod(paymentMethodId: string): Promise<PaymentMethod> {
    const paymentMethod = this.paymentMethods.get(paymentMethodId);
    if (!paymentMethod) {
      throw new Error(`No such payment method: ${paymentMethodId}`);
    }
    return paymentMethod;
  }

  public async attachPaymentMethod(paymentMethodId: string, customerId: string): Promise<PaymentMethod> {
    const paymentMethod = await this.retrievePaymentMethod(paymentMethodId);
    const customer = await this.retrieveCustomer(customerId);
    
    const updatedPaymentMethod = { ...paymentMethod, customer: customerId };
    this.paymentMethods.set(paymentMethodId, updatedPaymentMethod);
    
    this.generateWebhookEvent('payment_method.attached', updatedPaymentMethod);
    return updatedPaymentMethod;
  }

  public async detachPaymentMethod(paymentMethodId: string): Promise<PaymentMethod> {
    const paymentMethod = await this.retrievePaymentMethod(paymentMethodId);
    const updatedPaymentMethod = { ...paymentMethod, customer: undefined };
    this.paymentMethods.set(paymentMethodId, updatedPaymentMethod);
    
    this.generateWebhookEvent('payment_method.detached', updatedPaymentMethod);
    return updatedPaymentMethod;
  }

  /**
   * PaymentIntent methods
   */
  public async createPaymentIntent(request: CreatePaymentIntentRequest): Promise<PaymentIntent> {
    logger.info('Creating mock payment intent', { amount: request.amount, currency: request.currency });
    
    await this.simulateDelay();

    const paymentIntent: PaymentIntent = {
      id: this.generateId('pi'),
      object: 'payment_intent',
      amount: request.amount,
      currency: request.currency.toLowerCase(),
      created: this.getCurrentTimestamp(),
      status: 'requires_payment_method',
      client_secret: '',
      confirmation_method: request.confirmation_method || 'automatic',
      capture_method: request.capture_method || 'automatic',
      payment_method_types: request.payment_method_types || ['card'],
      metadata: request.metadata || {},
      customer: request.customer,
      payment_method: request.payment_method,
      description: request.description,
      receipt_email: request.receipt_email,
      setup_future_usage: request.setup_future_usage
    };

    paymentIntent.client_secret = this.generateClientSecret(paymentIntent.id);

    if (request.payment_method) {
      paymentIntent.status = 'requires_confirmation';
    }

    this.paymentIntents.set(paymentIntent.id, paymentIntent);
    
    this.generateWebhookEvent('payment_intent.created', paymentIntent);
    
    // Auto-confirm if requested
    if (request.confirm && request.payment_method) {
      return this.confirmPaymentIntent(paymentIntent.id);
    }

    logger.info('Mock payment intent created', { paymentIntentId: paymentIntent.id });
    return paymentIntent;
  }

  public async retrievePaymentIntent(paymentIntentId: string): Promise<PaymentIntent> {
    const paymentIntent = this.paymentIntents.get(paymentIntentId);
    if (!paymentIntent) {
      throw new Error(`No such payment intent: ${paymentIntentId}`);
    }
    return paymentIntent;
  }

  public async updatePaymentIntent(paymentIntentId: string, updates: Partial<CreatePaymentIntentRequest>): Promise<PaymentIntent> {
    const paymentIntent = await this.retrievePaymentIntent(paymentIntentId);
    const updatedPaymentIntent = { ...paymentIntent, ...updates };
    this.paymentIntents.set(paymentIntentId, updatedPaymentIntent);
    
    this.generateWebhookEvent('payment_intent.updated', updatedPaymentIntent);
    return updatedPaymentIntent;
  }

  public async confirmPaymentIntent(paymentIntentId: string, request?: ConfirmPaymentIntentRequest): Promise<PaymentIntent> {
    logger.info('Confirming mock payment intent', { paymentIntentId });
    
    const paymentIntent = await this.retrievePaymentIntent(paymentIntentId);
    
    if (paymentIntent.status === 'succeeded') {
      return paymentIntent;
    }

    const paymentMethodId = request?.payment_method || paymentIntent.payment_method;
    if (!paymentMethodId) {
      throw new Error('Payment method is required');
    }

    const paymentMethod = await this.retrievePaymentMethod(paymentMethodId);
    const cardNumber = paymentMethod.card?.last4 ? `****${paymentMethod.card.last4}` : '4242424242424242';
    const scenario = this.getTriggeredScenario(cardNumber) || this.getTriggeredScenario(paymentMethod.customer || '');

    await this.simulateDelay(scenario);

    let updatedPaymentIntent = { ...paymentIntent };
    updatedPaymentIntent.payment_method = paymentMethodId;

    if (scenario) {
      switch (scenario.type) {
        case 'failure':
        case 'card_error':
          updatedPaymentIntent.status = 'failed';
          updatedPaymentIntent.last_payment_error = this.createPaymentError(scenario);
          break;
          
        case '3d_secure':
          updatedPaymentIntent.status = 'requires_action';
          updatedPaymentIntent.next_action = {
            type: 'use_stripe_sdk',
            use_stripe_sdk: {
              type: 'three_d_secure_redirect',
              stripe_js: 'https://js.stripe.com/v3'
            }
          };
          break;
          
        case 'network_error':
          throw new Error(scenario.errorMessage || 'Network error occurred');
          
        default:
          updatedPaymentIntent.status = 'processing';
          // Simulate processing -> succeeded
          setTimeout(() => {
            updatedPaymentIntent.status = 'succeeded';
            updatedPaymentIntent.amount_received = updatedPaymentIntent.amount;
            this.paymentIntents.set(paymentIntentId, updatedPaymentIntent);
            this.generateWebhookEvent('payment_intent.succeeded', updatedPaymentIntent);
          }, 2000);
      }
    } else {
      updatedPaymentIntent.status = 'processing';
      // Default success scenario
      setTimeout(() => {
        updatedPaymentIntent.status = 'succeeded';
        updatedPaymentIntent.amount_received = updatedPaymentIntent.amount;
        this.paymentIntents.set(paymentIntentId, updatedPaymentIntent);
        this.generateWebhookEvent('payment_intent.succeeded', updatedPaymentIntent);
      }, 1000);
    }

    this.paymentIntents.set(paymentIntentId, updatedPaymentIntent);
    
    const eventType = updatedPaymentIntent.status === 'failed' ? 'payment_intent.payment_failed' : 'payment_intent.updated';
    this.generateWebhookEvent(eventType, updatedPaymentIntent);

    logger.info('Mock payment intent confirmed', { 
      paymentIntentId, 
      status: updatedPaymentIntent.status 
    });
    
    return updatedPaymentIntent;
  }

  public async cancelPaymentIntent(paymentIntentId: string): Promise<PaymentIntent> {
    const paymentIntent = await this.retrievePaymentIntent(paymentIntentId);
    const updatedPaymentIntent = { ...paymentIntent, status: 'canceled' as PaymentStatus };
    this.paymentIntents.set(paymentIntentId, updatedPaymentIntent);
    
    this.generateWebhookEvent('payment_intent.canceled', updatedPaymentIntent);
    return updatedPaymentIntent;
  }

  /**
   * SetupIntent methods
   */
  public async createSetupIntent(request: CreateSetupIntentRequest): Promise<SetupIntent> {
    logger.info('Creating mock setup intent', { customer: request.customer });
    
    await this.simulateDelay();

    const setupIntent: SetupIntent = {
      id: this.generateId('seti'),
      object: 'setup_intent',
      created: this.getCurrentTimestamp(),
      status: 'requires_payment_method',
      client_secret: '',
      payment_method_types: request.payment_method_types || ['card'],
      usage: request.usage || 'off_session',
      metadata: request.metadata || {},
      customer: request.customer,
      payment_method: request.payment_method,
      description: request.description,
      on_behalf_of: request.on_behalf_of
    };

    setupIntent.client_secret = this.generateClientSecret(setupIntent.id);

    if (request.payment_method) {
      setupIntent.status = 'requires_confirmation';
    }

    this.setupIntents.set(setupIntent.id, setupIntent);
    
    this.generateWebhookEvent('setup_intent.created', setupIntent);
    
    // Auto-confirm if requested
    if (request.confirm && request.payment_method) {
      return this.confirmSetupIntent(setupIntent.id);
    }

    logger.info('Mock setup intent created', { setupIntentId: setupIntent.id });
    return setupIntent;
  }

  public async retrieveSetupIntent(setupIntentId: string): Promise<SetupIntent> {
    const setupIntent = this.setupIntents.get(setupIntentId);
    if (!setupIntent) {
      throw new Error(`No such setup intent: ${setupIntentId}`);
    }
    return setupIntent;
  }

  public async updateSetupIntent(setupIntentId: string, updates: Partial<CreateSetupIntentRequest>): Promise<SetupIntent> {
    const setupIntent = await this.retrieveSetupIntent(setupIntentId);
    const updatedSetupIntent = { ...setupIntent, ...updates };
    this.setupIntents.set(setupIntentId, updatedSetupIntent);
    
    this.generateWebhookEvent('setup_intent.updated', updatedSetupIntent);
    return updatedSetupIntent;
  }

  public async confirmSetupIntent(setupIntentId: string, request?: ConfirmSetupIntentRequest): Promise<SetupIntent> {
    logger.info('Confirming mock setup intent', { setupIntentId });
    
    const setupIntent = await this.retrieveSetupIntent(setupIntentId);
    
    if (setupIntent.status === 'succeeded') {
      return setupIntent;
    }

    const paymentMethodId = request?.payment_method || setupIntent.payment_method;
    if (!paymentMethodId) {
      throw new Error('Payment method is required');
    }

    const paymentMethod = await this.retrievePaymentMethod(paymentMethodId);
    const cardNumber = paymentMethod.card?.last4 ? `****${paymentMethod.card.last4}` : '4242424242424242';
    const scenario = this.getTriggeredScenario(cardNumber);

    await this.simulateDelay(scenario);

    let updatedSetupIntent = { ...setupIntent };
    updatedSetupIntent.payment_method = paymentMethodId;

    if (scenario) {
      switch (scenario.type) {
        case 'failure':
        case 'card_error':
          updatedSetupIntent.status = 'canceled';
          updatedSetupIntent.last_setup_error = this.createPaymentError(scenario);
          break;
          
        case '3d_secure':
          updatedSetupIntent.status = 'requires_action';
          updatedSetupIntent.next_action = {
            type: 'use_stripe_sdk',
            use_stripe_sdk: {
              type: 'three_d_secure_redirect',
              stripe_js: 'https://js.stripe.com/v3'
            }
          };
          break;
          
        case 'network_error':
          throw new Error(scenario.errorMessage || 'Network error occurred');
          
        default:
          updatedSetupIntent.status = 'processing';
          // Simulate processing -> succeeded
          setTimeout(() => {
            updatedSetupIntent.status = 'succeeded';
            this.setupIntents.set(setupIntentId, updatedSetupIntent);
            this.generateWebhookEvent('setup_intent.succeeded', updatedSetupIntent);
          }, 1000);
      }
    } else {
      updatedSetupIntent.status = 'processing';
      // Default success scenario
      setTimeout(() => {
        updatedSetupIntent.status = 'succeeded';
        this.setupIntents.set(setupIntentId, updatedSetupIntent);
        this.generateWebhookEvent('setup_intent.succeeded', updatedSetupIntent);
      }, 500);
    }

    this.setupIntents.set(setupIntentId, updatedSetupIntent);
    
    const eventType = updatedSetupIntent.status === 'canceled' ? 'setup_intent.setup_failed' : 'setup_intent.updated';
    this.generateWebhookEvent(eventType, updatedSetupIntent);

    logger.info('Mock setup intent confirmed', { 
      setupIntentId, 
      status: updatedSetupIntent.status 
    });
    
    return updatedSetupIntent;
  }

  public async cancelSetupIntent(setupIntentId: string): Promise<SetupIntent> {
    const setupIntent = await this.retrieveSetupIntent(setupIntentId);
    const updatedSetupIntent = { ...setupIntent, status: 'canceled' as SetupIntentStatus };
    this.setupIntents.set(setupIntentId, updatedSetupIntent);
    
    this.generateWebhookEvent('setup_intent.canceled', updatedSetupIntent);
    return updatedSetupIntent;
  }

  /**
   * Webhook methods
   */
  public constructEvent(payload: string, signature: string, secret: string): WebhookEvent {
    // In a real implementation, we would verify the signature
    // For mock purposes, we'll just parse the payload
    try {
      const event = JSON.parse(payload) as WebhookEvent;
      logger.info('Constructed webhook event', { eventId: event.id, type: event.type });
      return event;
    } catch (error) {
      throw new Error('Invalid webhook payload');
    }
  }

  /**
   * Mock configuration methods
   */
  public setScenario(scenario: MockPaymentScenario): void {
    // Add or update scenario
    const existingIndex = this.scenarios.findIndex(s => s.trigger === scenario.trigger);
    if (existingIndex >= 0) {
      this.scenarios[existingIndex] = scenario;
    } else {
      this.scenarios.push(scenario);
    }
    logger.info('Set mock payment scenario', { trigger: scenario.trigger, type: scenario.type });
  }

  public resetScenarios(): void {
    this.initializeDefaultScenarios();
    logger.info('Reset mock payment scenarios to defaults');
  }

  public getStoredData(): any {
    return {
      customers: Array.from(this.customers.entries()),
      paymentMethods: Array.from(this.paymentMethods.entries()),
      paymentIntents: Array.from(this.paymentIntents.entries()),
      setupIntents: Array.from(this.setupIntents.entries()),
      webhookEvents: this.webhookEvents,
      scenarios: this.scenarios
    };
  }

  public clearStoredData(): void {
    this.customers.clear();
    this.paymentMethods.clear();
    this.paymentIntents.clear();
    this.setupIntents.clear();
    this.webhookEvents = [];
    logger.info('Cleared all mock payment data');
  }

  /**
   * Utility method to get webhook events
   */
  public getWebhookEvents(): WebhookEvent[] {
    return [...this.webhookEvents];
  }

  /**
   * Simulate webhook delivery
   */
  public async simulateWebhookDelivery(eventId: string, webhookUrl: string): Promise<boolean> {
    const event = this.webhookEvents.find(e => e.id === eventId);
    if (!event) {
      throw new Error(`Webhook event not found: ${eventId}`);
    }

    logger.info('Simulating webhook delivery', { eventId, webhookUrl });
    
    // In a real implementation, we would make an HTTP POST to the webhook URL
    // For mock purposes, we'll just simulate success/failure
    await this.simulateDelay();
    
    const success = Math.random() > 0.1; // 90% success rate
    if (success) {
      logger.info('Webhook delivery simulated successfully', { eventId });
    } else {
      logger.warn('Webhook delivery simulation failed', { eventId });
    }
    
    return success;
  }
}

// Export singleton instance
export const stripeMarkService = new StripeMarkService();