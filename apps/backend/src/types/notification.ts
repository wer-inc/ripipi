/**
 * Notification Types
 * Comprehensive type definitions for the notification system supporting
 * multiple channels (email, SMS, push, LINE) with template management,
 * scheduling, retry logic, and audit trails
 */

import { BaseEntity } from './database.js';

/**
 * Notification channel types
 */
export type NotificationChannel = 
  | 'EMAIL'
  | 'SMS' 
  | 'PUSH'
  | 'LINE'
  | 'WEBHOOK';

/**
 * Notification status
 */
export type NotificationStatus = 
  | 'PENDING'    // Queued for sending
  | 'SENDING'    // Currently being sent
  | 'SENT'       // Successfully sent
  | 'DELIVERED'  // Confirmed delivered (if supported by channel)
  | 'FAILED'     // Failed to send
  | 'CANCELLED'  // Cancelled before sending
  | 'EXPIRED';   // Expired before sending

/**
 * Notification priority levels
 */
export type NotificationPriority = 
  | 'LOW'
  | 'NORMAL'
  | 'HIGH'
  | 'URGENT';

/**
 * Notification template types
 */
export type NotificationTemplateType = 
  | 'BOOKING_CONFIRMATION'
  | 'BOOKING_REMINDER'
  | 'BOOKING_CANCELLATION'
  | 'BOOKING_RESCHEDULED'
  | 'PAYMENT_CONFIRMATION'
  | 'PAYMENT_FAILED'
  | 'WELCOME'
  | 'PASSWORD_RESET'
  | 'ACCOUNT_VERIFICATION'
  | 'MAINTENANCE_NOTICE'
  | 'CUSTOM';

/**
 * Supported languages
 */
export type NotificationLanguage = 'ja' | 'en' | 'ko' | 'zh';

/**
 * Template content for multi-language support
 */
export interface NotificationTemplateContent {
  subject?: string; // For email/push notifications
  title?: string;   // For push notifications
  body: string;
  htmlBody?: string; // For email notifications
  smsBody?: string;  // Shorter version for SMS
  pushBody?: string; // Optimized for push notifications
  lineBody?: string; // LINE-specific formatting
}

/**
 * Multi-language template content
 */
export interface MultiLangTemplateContent {
  ja: NotificationTemplateContent;
  en: NotificationTemplateContent;
  ko?: NotificationTemplateContent;
  zh?: NotificationTemplateContent;
  default: NotificationTemplateContent; // Fallback language
}

/**
 * Notification template
 */
export interface NotificationTemplate {
  id: string;
  tenantId: string;
  type: NotificationTemplateType;
  name: string;
  description?: string;
  content: MultiLangTemplateContent;
  variables: string[]; // List of template variable names
  channels: NotificationChannel[]; // Supported channels for this template
  isActive: boolean;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Notification recipient information
 */
export interface NotificationRecipient {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  deviceTokens?: string[]; // For push notifications
  lineUserId?: string;     // For LINE notifications
  webhookUrl?: string;     // For webhook notifications
  language: NotificationLanguage;
  timezone: string;
}

/**
 * Channel-specific configuration
 */
export interface ChannelConfig {
  email?: {
    fromAddress?: string;
    fromName?: string;
    replyTo?: string;
    cc?: string[];
    bcc?: string[];
    headers?: Record<string, string>;
    templateId?: string; // For email service providers
    attachments?: Array<{
      filename: string;
      content: string | Buffer;
      contentType: string;
    }>;
  };
  sms?: {
    fromNumber?: string;
    messageType?: 'text' | 'unicode';
    validityPeriod?: number; // Minutes
  };
  push?: {
    badge?: number;
    sound?: string;
    category?: string;
    clickAction?: string;
    icon?: string;
    color?: string;
    tag?: string;
    ttl?: number; // Time to live in seconds
    priority?: 'normal' | 'high';
    data?: Record<string, any>; // Custom data payload
  };
  line?: {
    messageType?: 'text' | 'sticker' | 'image' | 'video' | 'audio' | 'location' | 'template';
    quickReply?: Array<{
      type: string;
      action: Record<string, any>;
    }>;
    altText?: string; // For template messages
  };
  webhook?: {
    method?: 'POST' | 'PUT' | 'PATCH';
    headers?: Record<string, string>;
    timeout?: number; // Seconds
    retryPolicy?: {
      maxRetries: number;
      backoffMultiplier: number;
      initialDelayMs: number;
    };
  };
}

/**
 * Notification template variables
 */
export interface NotificationVariables {
  // User/Customer variables
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  
  // Booking variables
  bookingId?: string;
  serviceId?: string;
  serviceName?: string;
  resourceName?: string;
  startTime?: string;
  endTime?: string;
  duration?: string;
  totalAmount?: string;
  bookingStatus?: string;
  confirmationUrl?: string;
  cancellationUrl?: string;
  
  // Business variables
  businessName?: string;
  businessPhone?: string;
  businessEmail?: string;
  businessAddress?: string;
  businessWebsite?: string;
  
  // System variables
  systemName?: string;
  supportEmail?: string;
  currentDate?: string;
  currentTime?: string;
  timezone?: string;
  
  // Custom variables
  [key: string]: any;
}

/**
 * Notification scheduling options
 */
export interface NotificationSchedule {
  sendAt?: Date;           // Specific time to send
  delayMinutes?: number;   // Send after delay in minutes
  timezone?: string;       // Timezone for scheduling
  recurring?: {
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
    interval: number;      // Every N days/weeks/months
    endDate?: Date;        // When to stop recurring
    maxOccurrences?: number; // Maximum number of occurrences
  };
}

/**
 * Retry configuration
 */
export interface NotificationRetryConfig {
  enabled: boolean;
  maxRetries: number;
  backoffStrategy: 'FIXED' | 'LINEAR' | 'EXPONENTIAL';
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier?: number; // For exponential backoff
}

/**
 * Notification delivery result
 */
export interface NotificationDeliveryResult {
  success: boolean;
  messageId?: string;        // Provider-specific message ID
  externalId?: string;       // External tracking ID
  deliveredAt?: Date;
  errorCode?: string;
  errorMessage?: string;
  providerResponse?: any;    // Raw provider response
  cost?: number;             // Delivery cost if available
  metadata?: Record<string, any>;
}

/**
 * Notification batch configuration
 */
export interface NotificationBatchConfig {
  enabled: boolean;
  batchSize: number;         // Number of notifications per batch
  intervalMs: number;        // Delay between batches
  maxConcurrent: number;     // Maximum concurrent batch processors
}

/**
 * Main notification request
 */
export interface NotificationRequest {
  tenantId: string;
  templateType: NotificationTemplateType;
  templateId?: string;       // Specific template ID, if not using type
  channel: NotificationChannel;
  recipient: NotificationRecipient;
  variables: NotificationVariables;
  priority: NotificationPriority;
  schedule?: NotificationSchedule;
  channelConfig?: ChannelConfig;
  retryConfig?: NotificationRetryConfig;
  tags?: string[];           // For categorization and filtering
  correlationId?: string;    // For tracking related notifications
  idempotencyKey?: string;   // Prevent duplicate sends
  metadata?: Record<string, any>;
}

/**
 * Notification response
 */
export interface NotificationResponse {
  id: string;
  tenantId: string;
  status: NotificationStatus;
  channel: NotificationChannel;
  templateType: NotificationTemplateType;
  recipient: NotificationRecipient;
  scheduledAt?: Date;
  sentAt?: Date;
  deliveredAt?: Date;
  deliveryResult?: NotificationDeliveryResult;
  retryCount: number;
  nextRetryAt?: Date;
  expiresAt?: Date;
  tags: string[];
  correlationId?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Bulk notification request
 */
export interface BulkNotificationRequest {
  tenantId: string;
  templateType: NotificationTemplateType;
  templateId?: string;
  channel: NotificationChannel;
  recipients: NotificationRecipient[];
  sharedVariables?: NotificationVariables;  // Variables shared by all recipients
  recipientVariables?: Record<string, NotificationVariables>; // Per-recipient variables
  priority: NotificationPriority;
  schedule?: NotificationSchedule;
  channelConfig?: ChannelConfig;
  retryConfig?: NotificationRetryConfig;
  batchConfig?: NotificationBatchConfig;
  tags?: string[];
  correlationId?: string;
  metadata?: Record<string, any>;
}

/**
 * Bulk notification response
 */
export interface BulkNotificationResponse {
  id: string;
  tenantId: string;
  totalRecipients: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  pendingCount: number;
  notifications: NotificationResponse[];
  batchStatus: 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  startedAt: Date;
  completedAt?: Date;
  correlationId?: string;
  metadata?: Record<string, any>;
}

/**
 * Notification statistics
 */
export interface NotificationStatistics {
  tenantId: string;
  period: {
    startDate: Date;
    endDate: Date;
  };
  channelStats: Record<NotificationChannel, {
    total: number;
    sent: number;
    delivered: number;
    failed: number;
    deliveryRate: number;
    averageDeliveryTime: number; // In milliseconds
  }>;
  templateStats: Record<NotificationTemplateType, {
    total: number;
    sent: number;
    deliveryRate: number;
  }>;
  priorityStats: Record<NotificationPriority, {
    total: number;
    sent: number;
    averageProcessingTime: number;
  }>;
  totalCost: number;
  peakHours: Array<{
    hour: number;
    count: number;
  }>;
}

/**
 * Notification preferences for users
 */
export interface NotificationPreferences {
  userId: string;
  tenantId: string;
  channels: {
    email: {
      enabled: boolean;
      address?: string;
      verified: boolean;
      types: NotificationTemplateType[];
    };
    sms: {
      enabled: boolean;
      number?: string;
      verified: boolean;
      types: NotificationTemplateType[];
    };
    push: {
      enabled: boolean;
      deviceTokens: string[];
      types: NotificationTemplateType[];
    };
    line: {
      enabled: boolean;
      userId?: string;
      linked: boolean;
      types: NotificationTemplateType[];
    };
  };
  language: NotificationLanguage;
  timezone: string;
  quietHours?: {
    enabled: boolean;
    startTime: string; // HH:MM format
    endTime: string;   // HH:MM format
    timezone: string;
  };
  frequency: {
    immediate: NotificationTemplateType[];
    daily: NotificationTemplateType[];
    weekly: NotificationTemplateType[];
    never: NotificationTemplateType[];
  };
  updatedAt: Date;
}

/**
 * Database entities
 */

/**
 * Notification entity
 */
export interface NotificationEntity extends BaseEntity {
  template_type: NotificationTemplateType;
  template_id?: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  priority: NotificationPriority;
  recipient_id: string;
  recipient_data: NotificationRecipient;
  variables: NotificationVariables;
  channel_config?: ChannelConfig;
  retry_config: NotificationRetryConfig;
  scheduled_at?: Date;
  sent_at?: Date;
  delivered_at?: Date;
  expires_at?: Date;
  retry_count: number;
  next_retry_at?: Date;
  delivery_result?: NotificationDeliveryResult;
  tags: string[];
  correlation_id?: string;
  idempotency_key?: string;
  metadata?: Record<string, any>;
}

/**
 * Notification template entity
 */
export interface NotificationTemplateEntity extends BaseEntity {
  type: NotificationTemplateType;
  name: string;
  description?: string;
  content: MultiLangTemplateContent;
  variables: string[];
  channels: NotificationChannel[];
  is_active: boolean;
  version: number;
}

/**
 * Notification batch entity
 */
export interface NotificationBatchEntity extends BaseEntity {
  template_type: NotificationTemplateType;
  channel: NotificationChannel;
  total_recipients: number;
  processed_count: number;
  success_count: number;
  failed_count: number;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  started_at: Date;
  completed_at?: Date;
  correlation_id?: string;
  metadata?: Record<string, any>;
}

/**
 * Notification delivery log entity
 */
export interface NotificationDeliveryLogEntity extends BaseEntity {
  notification_id: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  attempt_number: number;
  delivery_result: NotificationDeliveryResult;
  processed_at: Date;
  processing_time_ms: number;
  error_details?: string;
}

/**
 * User notification preferences entity
 */
export interface UserNotificationPreferencesEntity extends BaseEntity {
  user_id: string;
  preferences: NotificationPreferences;
}

/**
 * Notification provider configuration
 */
export interface NotificationProviderConfig {
  email?: {
    provider: 'SENDGRID' | 'SES' | 'MAILGUN' | 'SMTP';
    apiKey?: string;
    apiSecret?: string;
    region?: string;
    fromAddress: string;
    fromName: string;
    replyTo?: string;
    webhookSecret?: string;
    templatePrefix?: string;
    rateLimits?: {
      perSecond: number;
      perMinute: number;
      perHour: number;
      perDay: number;
    };
  };
  sms?: {
    provider: 'TWILIO' | 'AWS_SNS' | 'VONAGE';
    apiKey?: string;
    apiSecret?: string;
    accountSid?: string; // For Twilio
    authToken?: string;  // For Twilio
    fromNumber: string;
    webhookSecret?: string;
    rateLimits?: {
      perSecond: number;
      perMinute: number;
      perHour: number;
      perDay: number;
    };
  };
  push?: {
    provider: 'FCM' | 'APNS';
    apiKey?: string;
    keyId?: string;    // For APNS
    teamId?: string;   // For APNS
    bundleId?: string; // For APNS
    keyFile?: string;  // Path to key file
    production: boolean;
    rateLimits?: {
      perSecond: number;
      perMinute: number;
      perHour: number;
      perDay: number;
    };
  };
  line?: {
    channelAccessToken: string;
    channelSecret: string;
    rateLimits?: {
      perSecond: number;
      perMinute: number;
      perHour: number;
      perDay: number;
    };
  };
  webhook?: {
    timeout: number;
    maxRetries: number;
    rateLimits?: {
      perSecond: number;
      perMinute: number;
      perHour: number;
      perDay: number;
    };
  };
}

/**
 * Notification queue configuration
 */
export interface NotificationQueueConfig {
  redis: {
    host: string;
    port: number;
    db: number;
    password?: string;
    keyPrefix: string;
  };
  queues: {
    immediate: {
      name: string;
      concurrency: number;
      rateLimiter?: {
        max: number;
        duration: number;
      };
    };
    scheduled: {
      name: string;
      concurrency: number;
      rateLimiter?: {
        max: number;
        duration: number;
      };
    };
    retry: {
      name: string;
      concurrency: number;
      rateLimiter?: {
        max: number;
        duration: number;
      };
    };
    bulk: {
      name: string;
      concurrency: number;
      rateLimiter?: {
        max: number;
        duration: number;
      };
    };
  };
  defaultJobOptions: {
    removeOnComplete: number;
    removeOnFail: number;
    attempts: number;
    backoff: {
      type: 'exponential';
      settings: {
        factor: number;
        delay: number;
      };
    };
  };
}

/**
 * Export all types
 */
export {
  NotificationChannel,
  NotificationStatus,
  NotificationPriority,
  NotificationTemplateType,
  NotificationLanguage
};