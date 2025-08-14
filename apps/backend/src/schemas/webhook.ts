/**
 * Webhook Validation Schemas
 * Schemas for validating Stripe webhook events and requests
 */

import { z } from 'zod';

/**
 * Base webhook event schema
 */
export const WebhookEventSchema = z.object({
  id: z.string().min(1),
  object: z.literal('event'),
  api_version: z.string(),
  created: z.number(),
  data: z.object({
    object: z.record(z.any()),
    previous_attributes: z.record(z.any()).optional()
  }),
  livemode: z.boolean(),
  pending_webhooks: z.number(),
  request: z.object({
    id: z.string().optional(),
    idempotency_key: z.string().optional()
  }),
  type: z.string()
});

/**
 * Payment Intent webhook schemas
 */
export const PaymentIntentWebhookDataSchema = z.object({
  id: z.string(),
  object: z.literal('payment_intent'),
  amount: z.number(),
  amount_capturable: z.number().optional(),
  amount_received: z.number().optional(),
  application: z.string().optional(),
  application_fee_amount: z.number().optional(),
  canceled_at: z.number().optional(),
  cancellation_reason: z.string().optional(),
  capture_method: z.enum(['automatic', 'manual']),
  client_secret: z.string(),
  confirmation_method: z.enum(['automatic', 'manual']),
  created: z.number(),
  currency: z.string(),
  customer: z.string().optional(),
  description: z.string().optional(),
  invoice: z.string().optional(),
  last_payment_error: z.object({
    type: z.string(),
    code: z.string().optional(),
    message: z.string(),
    param: z.string().optional(),
    decline_code: z.string().optional(),
    charge: z.string().optional(),
    payment_intent: z.string().optional(),
    setup_intent: z.string().optional()
  }).optional(),
  metadata: z.record(z.string()),
  next_action: z.object({
    type: z.string(),
    use_stripe_sdk: z.object({
      type: z.string(),
      stripe_js: z.string()
    }).optional(),
    redirect_to_url: z.object({
      return_url: z.string(),
      url: z.string()
    }).optional()
  }).optional(),
  on_behalf_of: z.string().optional(),
  payment_method: z.string().optional(),
  payment_method_options: z.record(z.any()).optional(),
  payment_method_types: z.array(z.string()),
  processing: z.record(z.any()).optional(),
  receipt_email: z.string().optional(),
  setup_future_usage: z.enum(['on_session', 'off_session']).optional(),
  shipping: z.record(z.any()).optional(),
  statement_descriptor: z.string().optional(),
  statement_descriptor_suffix: z.string().optional(),
  status: z.enum([
    'requires_payment_method',
    'requires_confirmation',
    'requires_action',
    'processing',
    'requires_capture',
    'canceled',
    'succeeded',
    'failed',
    'pending'
  ]),
  transfer_data: z.record(z.any()).optional(),
  transfer_group: z.string().optional()
});

/**
 * Setup Intent webhook schemas
 */
export const SetupIntentWebhookDataSchema = z.object({
  id: z.string(),
  object: z.literal('setup_intent'),
  application: z.string().optional(),
  cancellation_reason: z.string().optional(),
  client_secret: z.string(),
  created: z.number(),
  customer: z.string().optional(),
  description: z.string().optional(),
  last_setup_error: z.object({
    type: z.string(),
    code: z.string().optional(),
    message: z.string(),
    param: z.string().optional(),
    decline_code: z.string().optional(),
    charge: z.string().optional(),
    payment_intent: z.string().optional(),
    setup_intent: z.string().optional()
  }).optional(),
  metadata: z.record(z.string()),
  next_action: z.object({
    type: z.string(),
    use_stripe_sdk: z.object({
      type: z.string(),
      stripe_js: z.string()
    }).optional(),
    redirect_to_url: z.object({
      return_url: z.string(),
      url: z.string()
    }).optional()
  }).optional(),
  on_behalf_of: z.string().optional(),
  payment_method: z.string().optional(),
  payment_method_options: z.record(z.any()).optional(),
  payment_method_types: z.array(z.string()),
  status: z.enum([
    'requires_payment_method',
    'requires_confirmation',
    'requires_action',
    'processing',
    'canceled',
    'succeeded'
  ]),
  usage: z.enum(['on_session', 'off_session'])
});

/**
 * Charge webhook schemas
 */
export const ChargeWebhookDataSchema = z.object({
  id: z.string(),
  object: z.literal('charge'),
  amount: z.number(),
  amount_captured: z.number(),
  amount_refunded: z.number(),
  application: z.string().optional(),
  application_fee: z.string().optional(),
  application_fee_amount: z.number().optional(),
  balance_transaction: z.string(),
  billing_details: z.record(z.any()),
  calculated_statement_descriptor: z.string().optional(),
  captured: z.boolean(),
  created: z.number(),
  currency: z.string(),
  customer: z.string().optional(),
  description: z.string().optional(),
  disputed: z.boolean(),
  failure_code: z.string().optional(),
  failure_message: z.string().optional(),
  fraud_details: z.record(z.any()).optional(),
  invoice: z.string().optional(),
  metadata: z.record(z.string()),
  on_behalf_of: z.string().optional(),
  outcome: z.object({
    network_status: z.string(),
    reason: z.string().optional(),
    risk_level: z.string(),
    risk_score: z.number().optional(),
    seller_message: z.string(),
    type: z.string()
  }).optional(),
  paid: z.boolean(),
  payment_intent: z.string().optional(),
  payment_method: z.string().optional(),
  payment_method_details: z.record(z.any()).optional(),
  receipt_email: z.string().optional(),
  receipt_number: z.string().optional(),
  receipt_url: z.string().optional(),
  refunded: z.boolean(),
  refunds: z.object({
    object: z.literal('list'),
    data: z.array(z.any()),
    has_more: z.boolean(),
    total_count: z.number(),
    url: z.string()
  }),
  review: z.string().optional(),
  shipping: z.record(z.any()).optional(),
  source_transfer: z.string().optional(),
  statement_descriptor: z.string().optional(),
  statement_descriptor_suffix: z.string().optional(),
  status: z.enum(['succeeded', 'pending', 'failed']),
  transfer_data: z.record(z.any()).optional(),
  transfer_group: z.string().optional()
});

/**
 * Customer webhook schemas
 */
export const CustomerWebhookDataSchema = z.object({
  id: z.string(),
  object: z.literal('customer'),
  created: z.number(),
  email: z.string().optional(),
  name: z.string().optional(),
  phone: z.string().optional(),
  metadata: z.record(z.string()),
  default_source: z.string().optional(),
  invoice_settings: z.object({
    default_payment_method: z.string().optional()
  })
});

/**
 * Subscription webhook schemas (for future use)
 */
export const SubscriptionWebhookDataSchema = z.object({
  id: z.string(),
  object: z.literal('subscription'),
  application_fee_percent: z.number().optional(),
  billing_cycle_anchor: z.number(),
  billing_thresholds: z.record(z.any()).optional(),
  cancel_at: z.number().optional(),
  cancel_at_period_end: z.boolean(),
  canceled_at: z.number().optional(),
  collection_method: z.enum(['charge_automatically', 'send_invoice']),
  created: z.number(),
  current_period_end: z.number(),
  current_period_start: z.number(),
  customer: z.string(),
  days_until_due: z.number().optional(),
  default_payment_method: z.string().optional(),
  default_source: z.string().optional(),
  default_tax_rates: z.array(z.any()),
  discount: z.record(z.any()).optional(),
  ended_at: z.number().optional(),
  items: z.object({
    object: z.literal('list'),
    data: z.array(z.any()),
    has_more: z.boolean(),
    total_count: z.number(),
    url: z.string()
  }),
  latest_invoice: z.string().optional(),
  metadata: z.record(z.string()),
  next_pending_invoice_item_invoice: z.string().optional(),
  pause_collection: z.record(z.any()).optional(),
  pending_invoice_item_interval: z.record(z.any()).optional(),
  pending_setup_intent: z.string().optional(),
  pending_update: z.record(z.any()).optional(),
  schedule: z.string().optional(),
  start_date: z.number(),
  status: z.enum([
    'incomplete',
    'incomplete_expired',
    'trialing',
    'active',
    'past_due',
    'canceled',
    'unpaid'
  ]),
  transfer_data: z.record(z.any()).optional(),
  trial_end: z.number().optional(),
  trial_start: z.number().optional()
});

/**
 * Specific webhook event schemas
 */
export const PaymentIntentSucceededSchema = WebhookEventSchema.extend({
  type: z.literal('payment_intent.succeeded'),
  data: z.object({
    object: PaymentIntentWebhookDataSchema,
    previous_attributes: z.record(z.any()).optional()
  })
});

export const PaymentIntentPaymentFailedSchema = WebhookEventSchema.extend({
  type: z.literal('payment_intent.payment_failed'),
  data: z.object({
    object: PaymentIntentWebhookDataSchema,
    previous_attributes: z.record(z.any()).optional()
  })
});

export const PaymentIntentRequiresActionSchema = WebhookEventSchema.extend({
  type: z.literal('payment_intent.requires_action'),
  data: z.object({
    object: PaymentIntentWebhookDataSchema,
    previous_attributes: z.record(z.any()).optional()
  })
});

export const SetupIntentSucceededSchema = WebhookEventSchema.extend({
  type: z.literal('setup_intent.succeeded'),
  data: z.object({
    object: SetupIntentWebhookDataSchema,
    previous_attributes: z.record(z.any()).optional()
  })
});

export const ChargeRefundedSchema = WebhookEventSchema.extend({
  type: z.literal('charge.refunded'),
  data: z.object({
    object: ChargeWebhookDataSchema,
    previous_attributes: z.record(z.any()).optional()
  })
});

export const CustomerSubscriptionCreatedSchema = WebhookEventSchema.extend({
  type: z.literal('customer.subscription.created'),
  data: z.object({
    object: SubscriptionWebhookDataSchema,
    previous_attributes: z.record(z.any()).optional()
  })
});

export const CustomerSubscriptionUpdatedSchema = WebhookEventSchema.extend({
  type: z.literal('customer.subscription.updated'),
  data: z.object({
    object: SubscriptionWebhookDataSchema,
    previous_attributes: z.record(z.any()).optional()
  })
});

export const CustomerSubscriptionDeletedSchema = WebhookEventSchema.extend({
  type: z.literal('customer.subscription.deleted'),
  data: z.object({
    object: SubscriptionWebhookDataSchema,
    previous_attributes: z.record(z.any()).optional()
  })
});

/**
 * Union type for all supported webhook events
 */
export const SupportedWebhookEventSchema = z.union([
  PaymentIntentSucceededSchema,
  PaymentIntentPaymentFailedSchema,
  PaymentIntentRequiresActionSchema,
  SetupIntentSucceededSchema,
  ChargeRefundedSchema,
  CustomerSubscriptionCreatedSchema,
  CustomerSubscriptionUpdatedSchema,
  CustomerSubscriptionDeletedSchema
]);

/**
 * Webhook request schema
 */
export const WebhookRequestSchema = z.object({
  body: z.string(),
  headers: z.object({
    'stripe-signature': z.string()
  })
});

/**
 * Webhook response schemas
 */
export const WebhookResponseSchema = z.object({
  received: z.boolean(),
  eventId: z.string(),
  eventType: z.string(),
  processed: z.boolean(),
  timestamp: z.number()
});

export const WebhookErrorResponseSchema = z.object({
  error: z.object({
    type: z.string(),
    message: z.string(),
    eventId: z.string().optional(),
    eventType: z.string().optional()
  })
});

/**
 * Type exports
 */
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;
export type PaymentIntentWebhookData = z.infer<typeof PaymentIntentWebhookDataSchema>;
export type SetupIntentWebhookData = z.infer<typeof SetupIntentWebhookDataSchema>;
export type ChargeWebhookData = z.infer<typeof ChargeWebhookDataSchema>;
export type CustomerWebhookData = z.infer<typeof CustomerWebhookDataSchema>;
export type SubscriptionWebhookData = z.infer<typeof SubscriptionWebhookDataSchema>;
export type SupportedWebhookEvent = z.infer<typeof SupportedWebhookEventSchema>;
export type WebhookRequest = z.infer<typeof WebhookRequestSchema>;
export type WebhookResponse = z.infer<typeof WebhookResponseSchema>;
export type WebhookErrorResponse = z.infer<typeof WebhookErrorResponseSchema>;

/**
 * Webhook event type constants
 */
export const WEBHOOK_EVENT_TYPES = {
  PAYMENT_INTENT_SUCCEEDED: 'payment_intent.succeeded',
  PAYMENT_INTENT_PAYMENT_FAILED: 'payment_intent.payment_failed',
  PAYMENT_INTENT_REQUIRES_ACTION: 'payment_intent.requires_action',
  SETUP_INTENT_SUCCEEDED: 'setup_intent.succeeded',
  CHARGE_REFUNDED: 'charge.refunded',
  CUSTOMER_SUBSCRIPTION_CREATED: 'customer.subscription.created',
  CUSTOMER_SUBSCRIPTION_UPDATED: 'customer.subscription.updated',
  CUSTOMER_SUBSCRIPTION_DELETED: 'customer.subscription.deleted'
} as const;

export type WebhookEventType = typeof WEBHOOK_EVENT_TYPES[keyof typeof WEBHOOK_EVENT_TYPES];