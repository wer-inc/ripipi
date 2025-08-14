/**
 * Payment Types
 * Type definitions that mirror Stripe's structure for mock implementation
 */

import { BaseEntity } from './database.js';

/**
 * Payment provider types
 */
export type PaymentProvider = 'stripe' | 'mock';

/**
 * Payment method types
 */
export type PaymentMethodType = 'card' | 'bank_transfer' | 'wallet';

/**
 * Payment status enum that mirrors Stripe
 */
export type PaymentStatus = 
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'requires_action'
  | 'processing'
  | 'requires_capture'
  | 'canceled'
  | 'succeeded'
  | 'failed'
  | 'pending';

/**
 * SetupIntent status enum
 */
export type SetupIntentStatus =
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'requires_action'
  | 'processing'
  | 'canceled'
  | 'succeeded';

/**
 * Payment kind enum for our business logic
 */
export type PaymentKind = 'deposit' | 'charge' | 'penalty' | 'refund';

/**
 * Card brand types
 */
export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'discover' | 'jcb' | 'unknown';

/**
 * Currency codes
 */
export type Currency = 'JPY' | 'USD' | 'EUR' | 'GBP';

/**
 * Error codes that mirror Stripe
 */
export type PaymentErrorCode =
  | 'card_declined'
  | 'insufficient_funds'
  | 'expired_card'
  | 'incorrect_cvc'
  | 'processing_error'
  | 'authentication_required'
  | 'network_error'
  | 'api_error'
  | 'invalid_request_error'
  | 'rate_limit_error';

/**
 * Card details structure
 */
export interface CardDetails {
  id: string;
  brand: CardBrand;
  last4: string;
  exp_month: number;
  exp_year: number;
  country?: string;
  funding?: 'credit' | 'debit' | 'prepaid' | 'unknown';
  fingerprint?: string;
}

/**
 * Payment method object that mirrors Stripe
 */
export interface PaymentMethod {
  id: string;
  object: 'payment_method';
  type: PaymentMethodType;
  created: number;
  customer?: string;
  metadata: Record<string, string>;
  card?: CardDetails;
  billing_details?: {
    name?: string;
    email?: string;
    phone?: string;
    address?: {
      city?: string;
      country?: string;
      line1?: string;
      line2?: string;
      postal_code?: string;
      state?: string;
    };
  };
}

/**
 * Customer object that mirrors Stripe
 */
export interface StripeCustomer {
  id: string;
  object: 'customer';
  created: number;
  email?: string;
  name?: string;
  phone?: string;
  metadata: Record<string, string>;
  default_source?: string;
  invoice_settings: {
    default_payment_method?: string;
  };
}

/**
 * Next action structure for 3D Secure
 */
export interface NextAction {
  type: 'use_stripe_sdk' | 'redirect_to_url';
  use_stripe_sdk?: {
    type: 'three_d_secure_redirect';
    stripe_js: string;
  };
  redirect_to_url?: {
    return_url: string;
    url: string;
  };
}

/**
 * Payment error structure
 */
export interface PaymentError {
  type: 'card_error' | 'invalid_request_error' | 'api_error' | 'authentication_error' | 'rate_limit_error';
  code?: PaymentErrorCode;
  message: string;
  param?: string;
  decline_code?: string;
  charge?: string;
  payment_intent?: string;
  setup_intent?: string;
}

/**
 * PaymentIntent object that mirrors Stripe
 */
export interface PaymentIntent {
  id: string;
  object: 'payment_intent';
  amount: number;
  amount_capturable?: number;
  amount_received?: number;
  application?: string;
  application_fee_amount?: number;
  canceled_at?: number;
  cancellation_reason?: string;
  capture_method: 'automatic' | 'manual';
  client_secret: string;
  confirmation_method: 'automatic' | 'manual';
  created: number;
  currency: string;
  customer?: string;
  description?: string;
  invoice?: string;
  last_payment_error?: PaymentError;
  metadata: Record<string, string>;
  next_action?: NextAction;
  on_behalf_of?: string;
  payment_method?: string;
  payment_method_options?: Record<string, any>;
  payment_method_types: string[];
  processing?: Record<string, any>;
  receipt_email?: string;
  setup_future_usage?: 'on_session' | 'off_session';
  shipping?: Record<string, any>;
  statement_descriptor?: string;
  statement_descriptor_suffix?: string;
  status: PaymentStatus;
  transfer_data?: Record<string, any>;
  transfer_group?: string;
}

/**
 * SetupIntent object that mirrors Stripe
 */
export interface SetupIntent {
  id: string;
  object: 'setup_intent';
  application?: string;
  cancellation_reason?: string;
  client_secret: string;
  created: number;
  customer?: string;
  description?: string;
  last_setup_error?: PaymentError;
  metadata: Record<string, string>;
  next_action?: NextAction;
  on_behalf_of?: string;
  payment_method?: string;
  payment_method_options?: Record<string, any>;
  payment_method_types: string[];
  status: SetupIntentStatus;
  usage: 'on_session' | 'off_session';
}

/**
 * Charge object that mirrors Stripe
 */
export interface Charge {
  id: string;
  object: 'charge';
  amount: number;
  amount_captured: number;
  amount_refunded: number;
  application?: string;
  application_fee?: string;
  application_fee_amount?: number;
  balance_transaction: string;
  billing_details: Record<string, any>;
  calculated_statement_descriptor?: string;
  captured: boolean;
  created: number;
  currency: string;
  customer?: string;
  description?: string;
  disputed: boolean;
  failure_code?: string;
  failure_message?: string;
  fraud_details?: Record<string, any>;
  invoice?: string;
  metadata: Record<string, string>;
  on_behalf_of?: string;
  outcome?: {
    network_status: string;
    reason?: string;
    risk_level: string;
    risk_score?: number;
    seller_message: string;
    type: string;
  };
  paid: boolean;
  payment_intent?: string;
  payment_method?: string;
  payment_method_details?: Record<string, any>;
  receipt_email?: string;
  receipt_number?: string;
  receipt_url?: string;
  refunded: boolean;
  refunds: {
    object: 'list';
    data: any[];
    has_more: boolean;
    total_count: number;
    url: string;
  };
  review?: string;
  shipping?: Record<string, any>;
  source_transfer?: string;
  statement_descriptor?: string;
  statement_descriptor_suffix?: string;
  status: 'succeeded' | 'pending' | 'failed';
  transfer_data?: Record<string, any>;
  transfer_group?: string;
}

/**
 * Webhook event object that mirrors Stripe
 */
export interface WebhookEvent {
  id: string;
  object: 'event';
  api_version: string;
  created: number;
  data: {
    object: PaymentIntent | SetupIntent | PaymentMethod | Charge | StripeCustomer;
    previous_attributes?: Record<string, any>;
  };
  livemode: boolean;
  pending_webhooks: number;
  request: {
    id?: string;
    idempotency_key?: string;
  };
  type: string;
}

/**
 * Payment request for creating PaymentIntent
 */
export interface CreatePaymentIntentRequest {
  amount: number;
  currency: Currency;
  customer?: string;
  payment_method?: string;
  payment_method_types?: string[];
  confirmation_method?: 'automatic' | 'manual';
  confirm?: boolean;
  description?: string;
  metadata?: Record<string, string>;
  receipt_email?: string;
  setup_future_usage?: 'on_session' | 'off_session';
  application_fee_amount?: number;
  capture_method?: 'automatic' | 'manual';
}

/**
 * Setup request for creating SetupIntent
 */
export interface CreateSetupIntentRequest {
  customer?: string;
  payment_method?: string;
  payment_method_types?: string[];
  confirm?: boolean;
  description?: string;
  metadata?: Record<string, string>;
  on_behalf_of?: string;
  usage?: 'on_session' | 'off_session';
}

/**
 * Confirm payment intent request
 */
export interface ConfirmPaymentIntentRequest {
  payment_method?: string;
  receipt_email?: string;
  return_url?: string;
  setup_future_usage?: 'on_session' | 'off_session';
  mandate_data?: Record<string, any>;
  payment_method_data?: Record<string, any>;
}

/**
 * Confirm setup intent request
 */
export interface ConfirmSetupIntentRequest {
  payment_method?: string;
  return_url?: string;
  mandate_data?: Record<string, any>;
  payment_method_data?: Record<string, any>;
}

/**
 * Mock payment scenario configuration
 */
export interface MockPaymentScenario {
  type: 'success' | 'failure' | '3d_secure' | 'card_error' | 'network_error';
  trigger?: string; // Specific card number or customer ID that triggers this scenario
  delayMs?: number; // Simulate processing delay
  errorCode?: PaymentErrorCode;
  errorMessage?: string;
  requiresAction?: boolean;
}

/**
 * Our internal payment entity that maps to the database
 */
export interface PaymentEntity extends BaseEntity {
  booking_id?: string;
  kind: PaymentKind;
  amount_jpy: number;
  currency: Currency;
  status: PaymentStatus;
  provider: PaymentProvider;
  provider_payment_intent_id?: string;
  provider_charge_id?: string;
  failure_code?: string;
  failure_message?: string;
}

/**
 * Our internal payment method entity that maps to the database
 */
export interface PaymentMethodEntity extends BaseEntity {
  customer_id: string;
  provider: PaymentProvider;
  provider_customer_id?: string;
  provider_pm_id?: string;
  is_default: boolean;
}

/**
 * Webhook event entity that maps to the database
 */
export interface WebhookEventEntity extends BaseEntity {
  provider: PaymentProvider;
  event_id: string;
  received_at: Date;
  payload: Record<string, any>;
  handled_at?: Date;
  status: 'received' | 'processed' | 'failed' | 'ignored';
  error_message?: string;
}

/**
 * Payment service response types
 */
export interface PaymentServiceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: PaymentError;
  webhookEvents?: WebhookEvent[];
}

/**
 * Payment method creation request
 */
export interface CreatePaymentMethodRequest {
  type: PaymentMethodType;
  card?: {
    number: string;
    exp_month: number;
    exp_year: number;
    cvc: string;
  };
  billing_details?: {
    name?: string;
    email?: string;
    phone?: string;
    address?: {
      city?: string;
      country?: string;
      line1?: string;
      line2?: string;
      postal_code?: string;
      state?: string;
    };
  };
  metadata?: Record<string, string>;
}

/**
 * Customer creation request
 */
export interface CreateCustomerRequest {
  email?: string;
  name?: string;
  phone?: string;
  metadata?: Record<string, string>;
  payment_method?: string;
  invoice_settings?: {
    default_payment_method?: string;
  };
}

/**
 * Mock Stripe service interface
 */
export interface MockStripeService {
  // Customer methods
  createCustomer(request: CreateCustomerRequest): Promise<StripeCustomer>;
  retrieveCustomer(customerId: string): Promise<StripeCustomer>;
  updateCustomer(customerId: string, updates: Partial<CreateCustomerRequest>): Promise<StripeCustomer>;
  deleteCustomer(customerId: string): Promise<{ id: string; object: 'customer'; deleted: boolean }>;

  // Payment method methods
  createPaymentMethod(request: CreatePaymentMethodRequest): Promise<PaymentMethod>;
  retrievePaymentMethod(paymentMethodId: string): Promise<PaymentMethod>;
  attachPaymentMethod(paymentMethodId: string, customerId: string): Promise<PaymentMethod>;
  detachPaymentMethod(paymentMethodId: string): Promise<PaymentMethod>;

  // PaymentIntent methods
  createPaymentIntent(request: CreatePaymentIntentRequest): Promise<PaymentIntent>;
  retrievePaymentIntent(paymentIntentId: string): Promise<PaymentIntent>;
  updatePaymentIntent(paymentIntentId: string, updates: Partial<CreatePaymentIntentRequest>): Promise<PaymentIntent>;
  confirmPaymentIntent(paymentIntentId: string, request?: ConfirmPaymentIntentRequest): Promise<PaymentIntent>;
  cancelPaymentIntent(paymentIntentId: string): Promise<PaymentIntent>;

  // SetupIntent methods
  createSetupIntent(request: CreateSetupIntentRequest): Promise<SetupIntent>;
  retrieveSetupIntent(setupIntentId: string): Promise<SetupIntent>;
  updateSetupIntent(setupIntentId: string, updates: Partial<CreateSetupIntentRequest>): Promise<SetupIntent>;
  confirmSetupIntent(setupIntentId: string, request?: ConfirmSetupIntentRequest): Promise<SetupIntent>;
  cancelSetupIntent(setupIntentId: string): Promise<SetupIntent>;

  // Webhook methods
  constructEvent(payload: string, signature: string, secret: string): WebhookEvent;
  generateWebhookEvent(eventType: string, data: any): WebhookEvent;

  // Mock configuration
  setScenario(scenario: MockPaymentScenario): void;
  resetScenarios(): void;
  getStoredData(): any;
  clearStoredData(): void;
}

export {
  PaymentProvider,
  PaymentMethodType,
  PaymentStatus,
  SetupIntentStatus,
  PaymentKind,
  CardBrand,
  Currency,
  PaymentErrorCode
};