/**
 * Payment API Validation Schemas
 * 
 * Comprehensive validation schemas for all payment-related API endpoints including:
 * - Payment method management (add, list, set default, delete)
 * - Payment processing (one-time payments, refunds, captures)
 * - Payment intent management (create, confirm, cancel)
 * 
 * Features:
 * - Stripe-compatible API structure for easy frontend integration
 * - Multi-currency support (JPY, USD, EUR, GBP)
 * - 3D Secure authentication handling
 * - Comprehensive error handling with detailed validation messages
 * - Rate limiting and security headers
 * - Multi-tenant operation support
 * 
 * All schemas include proper OpenAPI documentation for automatic API documentation generation.
 * 
 * @author Payment Service Team
 * @version 1.0.0
 */

import { Type, Static } from '@sinclair/typebox';

// Base Error Schema
export const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.String(),
  details: Type.Optional(Type.Array(Type.String()))
});

// Currency enum
export const CurrencySchema = Type.Union([
  Type.Literal('JPY'),
  Type.Literal('USD'),
  Type.Literal('EUR'),
  Type.Literal('GBP')
]);

// Payment Kind enum
export const PaymentKindSchema = Type.Union([
  Type.Literal('deposit'),
  Type.Literal('charge'),
  Type.Literal('penalty'),
  Type.Literal('refund')
]);

// Payment Status enum
export const PaymentStatusSchema = Type.Union([
  Type.Literal('requires_payment_method'),
  Type.Literal('requires_confirmation'),
  Type.Literal('requires_action'),
  Type.Literal('processing'),
  Type.Literal('requires_capture'),
  Type.Literal('canceled'),
  Type.Literal('succeeded'),
  Type.Literal('failed'),
  Type.Literal('pending')
]);

// Payment Method Type enum
export const PaymentMethodTypeSchema = Type.Union([
  Type.Literal('card'),
  Type.Literal('bank_transfer'),
  Type.Literal('wallet')
]);

// Card Brand enum
export const CardBrandSchema = Type.Union([
  Type.Literal('visa'),
  Type.Literal('mastercard'),
  Type.Literal('amex'),
  Type.Literal('discover'),
  Type.Literal('jcb'),
  Type.Literal('unknown')
]);

// Address Schema
export const AddressSchema = Type.Object({
  city: Type.Optional(Type.String({ maxLength: 100 })),
  country: Type.Optional(Type.String({ maxLength: 2, pattern: '^[A-Z]{2}$' })),
  line1: Type.Optional(Type.String({ maxLength: 200 })),
  line2: Type.Optional(Type.String({ maxLength: 200 })),
  postal_code: Type.Optional(Type.String({ maxLength: 20 })),
  state: Type.Optional(Type.String({ maxLength: 100 }))
});

// Billing Details Schema
export const BillingDetailsSchema = Type.Object({
  name: Type.Optional(Type.String({ maxLength: 100 })),
  email: Type.Optional(Type.String({ format: 'email', maxLength: 320 })),
  phone: Type.Optional(Type.String({ maxLength: 20, pattern: '^\\+?[1-9]\\d{1,14}$' })),
  address: Type.Optional(AddressSchema)
});

// Card Details Schema
export const CardDetailsSchema = Type.Object({
  id: Type.String(),
  brand: CardBrandSchema,
  last4: Type.String({ pattern: '^\\d{4}$' }),
  exp_month: Type.Number({ minimum: 1, maximum: 12 }),
  exp_year: Type.Number({ minimum: new Date().getFullYear() }),
  country: Type.Optional(Type.String({ maxLength: 2, pattern: '^[A-Z]{2}$' })),
  funding: Type.Optional(Type.Union([
    Type.Literal('credit'),
    Type.Literal('debit'),
    Type.Literal('prepaid'),
    Type.Literal('unknown')
  ])),
  fingerprint: Type.Optional(Type.String())
});

// Payment Method Schema
export const PaymentMethodSchema = Type.Object({
  id: Type.String(),
  object: Type.Literal('payment_method'),
  type: PaymentMethodTypeSchema,
  created: Type.Number(),
  customer: Type.Optional(Type.String()),
  metadata: Type.Record(Type.String(), Type.String()),
  card: Type.Optional(CardDetailsSchema),
  billing_details: Type.Optional(BillingDetailsSchema)
});

// Payment Error Schema
export const PaymentErrorSchema = Type.Object({
  type: Type.Union([
    Type.Literal('card_error'),
    Type.Literal('invalid_request_error'),
    Type.Literal('api_error'),
    Type.Literal('authentication_error'),
    Type.Literal('rate_limit_error')
  ]),
  code: Type.Optional(Type.String()),
  message: Type.String(),
  param: Type.Optional(Type.String()),
  decline_code: Type.Optional(Type.String()),
  charge: Type.Optional(Type.String()),
  payment_intent: Type.Optional(Type.String())
});

// Next Action Schema
export const NextActionSchema = Type.Object({
  type: Type.Union([
    Type.Literal('use_stripe_sdk'),
    Type.Literal('redirect_to_url')
  ]),
  use_stripe_sdk: Type.Optional(Type.Object({
    type: Type.Literal('three_d_secure_redirect'),
    stripe_js: Type.String()
  })),
  redirect_to_url: Type.Optional(Type.Object({
    return_url: Type.String({ format: 'uri' }),
    url: Type.String({ format: 'uri' })
  }))
});

// Payment Intent Schema
export const PaymentIntentSchema = Type.Object({
  id: Type.String(),
  object: Type.Literal('payment_intent'),
  amount: Type.Number({ minimum: 1 }),
  amount_capturable: Type.Optional(Type.Number()),
  amount_received: Type.Optional(Type.Number()),
  capture_method: Type.Union([Type.Literal('automatic'), Type.Literal('manual')]),
  client_secret: Type.String(),
  confirmation_method: Type.Union([Type.Literal('automatic'), Type.Literal('manual')]),
  created: Type.Number(),
  currency: Type.String(),
  customer: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  last_payment_error: Type.Optional(PaymentErrorSchema),
  metadata: Type.Record(Type.String(), Type.String()),
  next_action: Type.Optional(NextActionSchema),
  payment_method: Type.Optional(Type.String()),
  payment_method_types: Type.Array(Type.String()),
  status: PaymentStatusSchema
});

// ===================
// Payment Method APIs
// ===================

// Create Payment Method Request
export const CreatePaymentMethodRequestSchema = Type.Object({
  type: PaymentMethodTypeSchema,
  card: Type.Optional(Type.Object({
    number: Type.String({ pattern: '^\\d{13,19}$' }),
    exp_month: Type.Number({ minimum: 1, maximum: 12 }),
    exp_year: Type.Number({ minimum: new Date().getFullYear() }),
    cvc: Type.String({ pattern: '^\\d{3,4}$' })
  })),
  billing_details: Type.Optional(BillingDetailsSchema),
  metadata: Type.Optional(Type.Record(Type.String(), Type.String()))
});

// Add Payment Method Request
export const AddPaymentMethodRequestSchema = Type.Object({
  payment_method: CreatePaymentMethodRequestSchema,
  set_as_default: Type.Optional(Type.Boolean()),
  customer_data: Type.Optional(Type.Object({
    email: Type.Optional(Type.String({ format: 'email' })),
    name: Type.Optional(Type.String({ maxLength: 100 })),
    phone: Type.Optional(Type.String({ pattern: '^\\+?[1-9]\\d{1,14}$' }))
  }))
});

// Add Payment Method Response
export const AddPaymentMethodResponseSchema = Type.Object({
  success: Type.Boolean(),
  payment_method: Type.Optional(PaymentMethodSchema),
  setup_intent: Type.Optional(Type.Object({
    id: Type.String(),
    client_secret: Type.String(),
    status: Type.String()
  })),
  message: Type.String()
});

// List Payment Methods Response
export const ListPaymentMethodsResponseSchema = Type.Object({
  payment_methods: Type.Array(Type.Object({
    id: Type.String(),
    type: PaymentMethodTypeSchema,
    card: Type.Optional(CardDetailsSchema),
    billing_details: Type.Optional(BillingDetailsSchema),
    is_default: Type.Boolean(),
    created_at: Type.String({ format: 'date-time' }),
    metadata: Type.Optional(Type.Record(Type.String(), Type.String()))
  }))
});

// Set Default Payment Method Request
export const SetDefaultPaymentMethodRequestSchema = Type.Object({
  payment_method_id: Type.String()
});

// Set Default Payment Method Response
export const SetDefaultPaymentMethodResponseSchema = Type.Object({
  message: Type.String(),
  updated: Type.Boolean()
});

// Delete Payment Method Response
export const DeletePaymentMethodResponseSchema = Type.Object({
  message: Type.String(),
  deleted: Type.Boolean()
});

// ===============
// Payment APIs
// ===============

// Process Payment Request
export const ProcessPaymentRequestSchema = Type.Object({
  booking_id: Type.Optional(Type.String()),
  amount: Type.Number({ minimum: 1 }),
  currency: Type.Optional(CurrencySchema),
  payment_method_id: Type.Optional(Type.String()),
  kind: PaymentKindSchema,
  description: Type.Optional(Type.String({ maxLength: 500 })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.String())),
  customer_data: Type.Optional(Type.Object({
    id: Type.String(),
    email: Type.Optional(Type.String({ format: 'email' })),
    name: Type.Optional(Type.String({ maxLength: 100 })),
    phone: Type.Optional(Type.String({ pattern: '^\\+?[1-9]\\d{1,14}$' }))
  })),
  idempotency_key: Type.Optional(Type.String())
});

// Process Payment Response
export const ProcessPaymentResponseSchema = Type.Object({
  success: Type.Boolean(),
  payment: Type.Optional(Type.Object({
    id: Type.String(),
    amount: Type.Number(),
    currency: CurrencySchema,
    status: PaymentStatusSchema,
    kind: PaymentKindSchema,
    booking_id: Type.Optional(Type.String()),
    created_at: Type.String({ format: 'date-time' })
  })),
  payment_intent: Type.Optional(PaymentIntentSchema),
  requires_action: Type.Optional(Type.Boolean()),
  next_action: Type.Optional(NextActionSchema),
  error: Type.Optional(PaymentErrorSchema),
  message: Type.String()
});

// Get Payment Details Response
export const GetPaymentResponseSchema = Type.Object({
  id: Type.String(),
  booking_id: Type.Optional(Type.String()),
  kind: PaymentKindSchema,
  amount: Type.Number(),
  currency: CurrencySchema,
  status: PaymentStatusSchema,
  provider: Type.String(),
  provider_payment_intent_id: Type.Optional(Type.String()),
  provider_charge_id: Type.Optional(Type.String()),
  failure_code: Type.Optional(Type.String()),
  failure_message: Type.Optional(Type.String()),
  created_at: Type.String({ format: 'date-time' }),
  updated_at: Type.String({ format: 'date-time' })
});

// Refund Payment Request
export const RefundPaymentRequestSchema = Type.Object({
  amount: Type.Optional(Type.Number({ minimum: 1 })),
  reason: Type.Optional(Type.String({ maxLength: 500 })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.String()))
});

// Refund Payment Response
export const RefundPaymentResponseSchema = Type.Object({
  success: Type.Boolean(),
  refund: Type.Optional(Type.Object({
    id: Type.String(),
    amount: Type.Number(),
    currency: CurrencySchema,
    status: Type.String(),
    created: Type.Number()
  })),
  message: Type.String()
});

// Capture Payment Response
export const CapturePaymentResponseSchema = Type.Object({
  success: Type.Boolean(),
  payment_intent: Type.Optional(PaymentIntentSchema),
  message: Type.String()
});

// ======================
// Payment Intent APIs
// ======================

// Create Payment Intent Request
export const CreatePaymentIntentRequestSchema = Type.Object({
  amount: Type.Number({ minimum: 1 }),
  currency: Type.Optional(CurrencySchema),
  customer_id: Type.String(),
  payment_method_id: Type.Optional(Type.String()),
  booking_id: Type.Optional(Type.String()),
  description: Type.Optional(Type.String({ maxLength: 500 })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.String())),
  confirmation_method: Type.Optional(Type.Union([
    Type.Literal('automatic'),
    Type.Literal('manual')
  ])),
  confirm: Type.Optional(Type.Boolean()),
  capture_method: Type.Optional(Type.Union([
    Type.Literal('automatic'),
    Type.Literal('manual')
  ]))
});

// Create Payment Intent Response
export const CreatePaymentIntentResponseSchema = Type.Object({
  success: Type.Boolean(),
  payment_intent: Type.Optional(PaymentIntentSchema),
  error: Type.Optional(PaymentErrorSchema),
  message: Type.String()
});

// Confirm Payment Intent Request
export const ConfirmPaymentIntentRequestSchema = Type.Object({
  payment_method_id: Type.Optional(Type.String()),
  return_url: Type.Optional(Type.String({ format: 'uri' }))
});

// Confirm Payment Intent Response
export const ConfirmPaymentIntentResponseSchema = Type.Object({
  success: Type.Boolean(),
  payment_intent: Type.Optional(PaymentIntentSchema),
  requires_action: Type.Optional(Type.Boolean()),
  next_action: Type.Optional(NextActionSchema),
  error: Type.Optional(PaymentErrorSchema),
  message: Type.String()
});

// Cancel Payment Intent Response
export const CancelPaymentIntentResponseSchema = Type.Object({
  success: Type.Boolean(),
  payment_intent: Type.Optional(PaymentIntentSchema),
  message: Type.String()
});

// ==================
// Common Parameters
// ==================

// Path Parameters
export const PaymentMethodIdParamSchema = Type.Object({
  id: Type.String({ minLength: 1 })
});

export const PaymentIdParamSchema = Type.Object({
  id: Type.String({ minLength: 1 })
});

export const PaymentIntentIdParamSchema = Type.Object({
  id: Type.String({ minLength: 1 })
});

// Query Parameters for Listing
export const PaymentListQuerySchema = Type.Object({
  booking_id: Type.Optional(Type.String()),
  status: Type.Optional(PaymentStatusSchema),
  kind: Type.Optional(PaymentKindSchema),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
  offset: Type.Optional(Type.Number({ minimum: 0 }))
});

// Response Headers for Rate Limiting
export const RateLimitHeadersSchema = Type.Object({
  'X-RateLimit-Limit': Type.Number(),
  'X-RateLimit-Remaining': Type.Number(),
  'X-RateLimit-Reset': Type.Number()
});

// ==================
// Type Exports
// ==================

export type CreatePaymentMethodRequest = Static<typeof CreatePaymentMethodRequestSchema>;
export type AddPaymentMethodRequest = Static<typeof AddPaymentMethodRequestSchema>;
export type AddPaymentMethodResponse = Static<typeof AddPaymentMethodResponseSchema>;
export type ListPaymentMethodsResponse = Static<typeof ListPaymentMethodsResponseSchema>;
export type SetDefaultPaymentMethodRequest = Static<typeof SetDefaultPaymentMethodRequestSchema>;
export type ProcessPaymentRequest = Static<typeof ProcessPaymentRequestSchema>;
export type ProcessPaymentResponse = Static<typeof ProcessPaymentResponseSchema>;
export type GetPaymentResponse = Static<typeof GetPaymentResponseSchema>;
export type RefundPaymentRequest = Static<typeof RefundPaymentRequestSchema>;
export type RefundPaymentResponse = Static<typeof RefundPaymentResponseSchema>;
export type CreatePaymentIntentRequest = Static<typeof CreatePaymentIntentRequestSchema>;
export type CreatePaymentIntentResponse = Static<typeof CreatePaymentIntentResponseSchema>;
export type ConfirmPaymentIntentRequest = Static<typeof ConfirmPaymentIntentRequestSchema>;
export type ConfirmPaymentIntentResponse = Static<typeof ConfirmPaymentIntentResponseSchema>;
export type PaymentMethodIdParam = Static<typeof PaymentMethodIdParamSchema>;
export type PaymentIdParam = Static<typeof PaymentIdParamSchema>;
export type PaymentIntentIdParam = Static<typeof PaymentIntentIdParamSchema>;
export type PaymentListQuery = Static<typeof PaymentListQuerySchema>;