/**
 * Custom validation utilities for business-specific requirements
 * OWASP-compliant validation functions for Japanese business requirements
 */

import { ValidationError, ErrorFactory } from './errors';

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  sanitizedValue?: any;
}

/**
 * Validation options interface
 */
export interface ValidationOptions {
  allowEmpty?: boolean;
  customMessage?: string;
  sanitize?: boolean;
}

/**
 * Japanese phone number validator
 * Supports both domestic (0X-XXXX-XXXX) and international (+81-X-XXXX-XXXX) formats
 */
export function validateJapanesePhoneNumber(
  phoneNumber: string,
  options: ValidationOptions = {}
): ValidationResult {
  const { allowEmpty = false, customMessage, sanitize = true } = options;
  
  if (!phoneNumber || phoneNumber.trim().length === 0) {
    if (allowEmpty) {
      return { isValid: true, errors: [], sanitizedValue: '' };
    }
    return {
      isValid: false,
      errors: [customMessage || '電話番号は必須です']
    };
  }

  // Sanitize input: remove spaces, hyphens, parentheses
  let cleaned = phoneNumber.replace(/[\s\-()]/g, '');
  
  // Domestic format patterns
  const domesticPatterns = [
    /^0[1-9]\d{8,9}$/, // Mobile: 090/080/070 + 8 digits, Landline: 0X + 8-9 digits
  ];
  
  // International format patterns
  const internationalPatterns = [
    /^\+81[1-9]\d{8,9}$/, // +81 followed by number without leading 0
  ];
  
  let isValid = false;
  let formattedNumber = cleaned;
  
  // Check domestic patterns
  if (domesticPatterns.some(pattern => pattern.test(cleaned))) {
    isValid = true;
    // Format domestic number with hyphens for readability
    if (sanitize && cleaned.length >= 10) {
      if (cleaned.startsWith('0')) {
        // Mobile numbers: 090-1234-5678
        if (['090', '080', '070', '050'].some(prefix => cleaned.startsWith(prefix))) {
          formattedNumber = `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
        } else {
          // Landline: 03-1234-5678 or 06-1234-5678
          const areaCodeLength = cleaned.slice(1, 3) <= '6' ? 2 : 3;
          formattedNumber = `${cleaned.slice(0, 1 + areaCodeLength)}-${cleaned.slice(1 + areaCodeLength, 5 + areaCodeLength)}-${cleaned.slice(5 + areaCodeLength)}`;
        }
      }
    }
  }
  
  // Check international patterns
  if (!isValid && internationalPatterns.some(pattern => pattern.test(cleaned))) {
    isValid = true;
    if (sanitize) {
      formattedNumber = `+81-${cleaned.slice(3, 4)}-${cleaned.slice(4, 8)}-${cleaned.slice(8)}`;
    }
  }
  
  if (!isValid) {
    return {
      isValid: false,
      errors: [customMessage || '有効な日本の電話番号を入力してください（例：090-1234-5678）']
    };
  }
  
  return {
    isValid: true,
    errors: [],
    sanitizedValue: sanitize ? formattedNumber : cleaned
  };
}

/**
 * Japanese postal code validator
 * Format: XXX-XXXX (7 digits with hyphen)
 */
export function validateJapanesePostalCode(
  postalCode: string,
  options: ValidationOptions = {}
): ValidationResult {
  const { allowEmpty = false, customMessage, sanitize = true } = options;
  
  if (!postalCode || postalCode.trim().length === 0) {
    if (allowEmpty) {
      return { isValid: true, errors: [], sanitizedValue: '' };
    }
    return {
      isValid: false,
      errors: [customMessage || '郵便番号は必須です']
    };
  }
  
  // Remove spaces and normalize
  let cleaned = postalCode.trim().replace(/\s/g, '');
  
  // Add hyphen if missing
  if (sanitize && /^[0-9]{7}$/.test(cleaned)) {
    cleaned = `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
  }
  
  // Validate format: XXX-XXXX
  const postalCodePattern = /^[0-9]{3}-[0-9]{4}$/;
  
  if (!postalCodePattern.test(cleaned)) {
    return {
      isValid: false,
      errors: [customMessage || '郵便番号は XXX-XXXX 形式で入力してください']
    };
  }
  
  return {
    isValid: true,
    errors: [],
    sanitizedValue: cleaned
  };
}

/**
 * Credit card number validator using Luhn algorithm
 * Supports major card types and provides detailed validation
 */
export function validateCreditCardNumber(
  cardNumber: string,
  options: ValidationOptions = {}
): ValidationResult {
  const { allowEmpty = false, customMessage, sanitize = true } = options;
  
  if (!cardNumber || cardNumber.trim().length === 0) {
    if (allowEmpty) {
      return { isValid: true, errors: [], sanitizedValue: '' };
    }
    return {
      isValid: false,
      errors: [customMessage || 'クレジットカード番号は必須です']
    };
  }
  
  // Remove spaces, hyphens, and other non-digit characters
  const cleaned = cardNumber.replace(/\D/g, '');
  
  if (cleaned.length < 13 || cleaned.length > 19) {
    return {
      isValid: false,
      errors: [customMessage || 'クレジットカード番号は13-19桁である必要があります']
    };
  }
  
  // Luhn algorithm validation
  if (!luhnCheck(cleaned)) {
    return {
      isValid: false,
      errors: [customMessage || '無効なクレジットカード番号です']
    };
  }
  
  // Mask the number for security (show only last 4 digits)
  const maskedNumber = sanitize 
    ? `****-****-****-${cleaned.slice(-4)}`
    : cleaned;
  
  return {
    isValid: true,
    errors: [],
    sanitizedValue: maskedNumber
  };
}

/**
 * Luhn algorithm implementation for credit card validation
 */
function luhnCheck(cardNumber: string): boolean {
  let sum = 0;
  let alternate = false;
  
  // Loop through values starting from the rightmost
  for (let i = cardNumber.length - 1; i >= 0; i--) {
    let n = parseInt(cardNumber[i], 10);
    
    if (alternate) {
      n *= 2;
      if (n > 9) {
        n = (n % 10) + 1;
      }
    }
    
    sum += n;
    alternate = !alternate;
  }
  
  return sum % 10 === 0;
}

/**
 * Business hours format validator
 * Format: HH:MM-HH:MM (e.g., "09:00-18:00")
 */
export function validateBusinessHours(
  hours: string,
  options: ValidationOptions = {}
): ValidationResult {
  const { allowEmpty = false, customMessage } = options;
  
  if (!hours || hours.trim().length === 0) {
    if (allowEmpty) {
      return { isValid: true, errors: [], sanitizedValue: '' };
    }
    return {
      isValid: false,
      errors: [customMessage || '営業時間は必須です']
    };
  }
  
  const cleaned = hours.trim();
  
  // Pattern: HH:MM-HH:MM
  const hoursPattern = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])-([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
  const match = cleaned.match(hoursPattern);
  
  if (!match) {
    return {
      isValid: false,
      errors: [customMessage || '営業時間は HH:MM-HH:MM 形式で入力してください（例：09:00-18:00）']
    };
  }
  
  const [, startHour, startMin, endHour, endMin] = match;
  const startTime = parseInt(startHour) * 60 + parseInt(startMin);
  const endTime = parseInt(endHour) * 60 + parseInt(endMin);
  
  // Validate that end time is after start time
  if (endTime <= startTime) {
    return {
      isValid: false,
      errors: [customMessage || '終了時間は開始時間より後である必要があります']
    };
  }
  
  // Format with leading zeros
  const formattedHours = `${startHour.padStart(2, '0')}:${startMin.padStart(2, '0')}-${endHour.padStart(2, '0')}:${endMin.padStart(2, '0')}`;
  
  return {
    isValid: true,
    errors: [],
    sanitizedValue: formattedHours
  };
}

/**
 * Reservation time slot validator
 * Validates booking time slots against business hours and availability
 */
export function validateReservationTimeSlot(
  startTime: string,
  endTime: string,
  businessHours: string,
  options: ValidationOptions = {}
): ValidationResult {
  const { customMessage } = options;
  const errors: string[] = [];
  
  // Validate time format
  const timePattern = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
  
  if (!timePattern.test(startTime)) {
    errors.push('開始時間の形式が正しくありません（HH:MM）');
  }
  
  if (!timePattern.test(endTime)) {
    errors.push('終了時間の形式が正しくありません（HH:MM）');
  }
  
  if (errors.length > 0) {
    return { isValid: false, errors };
  }
  
  // Parse times
  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);
  
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;
  
  // Validate time sequence
  if (endMinutes <= startMinutes) {
    errors.push('終了時間は開始時間より後である必要があります');
  }
  
  // Validate minimum duration (15 minutes)
  if (endMinutes - startMinutes < 15) {
    errors.push('予約時間は最低15分以上である必要があります');
  }
  
  // Validate maximum duration (8 hours)
  if (endMinutes - startMinutes > 480) {
    errors.push('予約時間は最大8時間までです');
  }
  
  // Validate against business hours
  const businessHoursResult = validateBusinessHours(businessHours, { allowEmpty: false });
  if (businessHoursResult.isValid && businessHoursResult.sanitizedValue) {
    const [businessStart, businessEnd] = businessHoursResult.sanitizedValue.split('-');
    const [bizStartHour, bizStartMin] = businessStart.split(':').map(Number);
    const [bizEndHour, bizEndMin] = businessEnd.split(':').map(Number);
    
    const bizStartMinutes = bizStartHour * 60 + bizStartMin;
    const bizEndMinutes = bizEndHour * 60 + bizEndMin;
    
    if (startMinutes < bizStartMinutes) {
      errors.push('予約開始時間が営業時間前です');
    }
    
    if (endMinutes > bizEndMinutes) {
      errors.push('予約終了時間が営業時間後です');
    }
  }
  
  if (errors.length > 0) {
    return {
      isValid: false,
      errors: customMessage ? [customMessage] : errors
    };
  }
  
  return {
    isValid: true,
    errors: [],
    sanitizedValue: {
      startTime: `${startHour.toString().padStart(2, '0')}:${startMin.toString().padStart(2, '0')}`,
      endTime: `${endHour.toString().padStart(2, '0')}:${endMin.toString().padStart(2, '0')}`,
      durationMinutes: endMinutes - startMinutes
    }
  };
}

/**
 * Japanese name validator (supports hiragana, katakana, kanji)
 */
export function validateJapaneseName(
  name: string,
  options: ValidationOptions = {}
): ValidationResult {
  const { allowEmpty = false, customMessage, sanitize = true } = options;
  
  if (!name || name.trim().length === 0) {
    if (allowEmpty) {
      return { isValid: true, errors: [], sanitizedValue: '' };
    }
    return {
      isValid: false,
      errors: [customMessage || '名前は必須です']
    };
  }
  
  let cleaned = name.trim();
  
  // Remove excessive whitespace
  if (sanitize) {
    cleaned = cleaned.replace(/\s+/g, ' ');
  }
  
  // Validate length
  if (cleaned.length < 1 || cleaned.length > 50) {
    return {
      isValid: false,
      errors: [customMessage || '名前は1-50文字で入力してください']
    };
  }
  
  // Pattern for Japanese names (hiragana, katakana, kanji, spaces)
  const japaneseNamePattern = /^[ぁ-ヿ一-龯ー\s]+$/;
  
  if (!japaneseNamePattern.test(cleaned)) {
    return {
      isValid: false,
      errors: [customMessage || '名前はひらがな、カタカナ、漢字で入力してください']
    };
  }
  
  return {
    isValid: true,
    errors: [],
    sanitizedValue: cleaned
  };
}

/**
 * Strong password validator
 * Enforces password complexity rules for security
 */
export function validateStrongPassword(
  password: string,
  options: ValidationOptions = {}
): ValidationResult {
  const { allowEmpty = false, customMessage } = options;
  
  if (!password || password.length === 0) {
    if (allowEmpty) {
      return { isValid: true, errors: [], sanitizedValue: '' };
    }
    return {
      isValid: false,
      errors: [customMessage || 'パスワードは必須です']
    };
  }
  
  const errors: string[] = [];
  
  // Minimum length
  if (password.length < 8) {
    errors.push('パスワードは8文字以上である必要があります');
  }
  
  // Maximum length (prevent DoS attacks)
  if (password.length > 128) {
    errors.push('パスワードは128文字以下である必要があります');
  }
  
  // Must contain uppercase letter
  if (!/[A-Z]/.test(password)) {
    errors.push('パスワードは大文字を含む必要があります');
  }
  
  // Must contain lowercase letter
  if (!/[a-z]/.test(password)) {
    errors.push('パスワードは小文字を含む必要があります');
  }
  
  // Must contain number
  if (!/[0-9]/.test(password)) {
    errors.push('パスワードは数字を含む必要があります');
  }
  
  // Must contain special character
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('パスワードは特殊文字を含む必要があります');
  }
  
  // Check for common patterns
  const commonPatterns = [
    /(.)\1{2,}/, // Three or more consecutive identical characters
    /123456|654321|qwerty|password|admin|user/, // Common sequences
  ];
  
  if (commonPatterns.some(pattern => pattern.test(password.toLowerCase()))) {
    errors.push('パスワードに一般的なパターンが含まれています');
  }
  
  if (errors.length > 0) {
    return {
      isValid: false,
      errors: customMessage ? [customMessage] : errors
    };
  }
  
  return {
    isValid: true,
    errors: [],
    sanitizedValue: password // Don't sanitize passwords
  };
}

/**
 * URL validator with security checks
 */
export function validateSecureUrl(
  url: string,
  options: ValidationOptions & { allowedProtocols?: string[] } = {}
): ValidationResult {
  const { allowEmpty = false, customMessage, allowedProtocols = ['https'] } = options;
  
  if (!url || url.trim().length === 0) {
    if (allowEmpty) {
      return { isValid: true, errors: [], sanitizedValue: '' };
    }
    return {
      isValid: false,
      errors: [customMessage || 'URLは必須です']
    };
  }
  
  const cleaned = url.trim();
  
  try {
    const urlObject = new URL(cleaned);
    
    // Check protocol
    if (!allowedProtocols.includes(urlObject.protocol.slice(0, -1))) {
      return {
        isValid: false,
        errors: [customMessage || `許可されているプロトコル: ${allowedProtocols.join(', ')}`]
      };
    }
    
    // Check for suspicious patterns
    const suspiciousPatterns = [
      /javascript:/i,
      /data:/i,
      /vbscript:/i,
      /<script/i,
      /onload=/i,
      /onerror=/i
    ];
    
    if (suspiciousPatterns.some(pattern => pattern.test(cleaned))) {
      return {
        isValid: false,
        errors: [customMessage || 'URLに不正な内容が含まれています']
      };
    }
    
    return {
      isValid: true,
      errors: [],
      sanitizedValue: urlObject.toString()
    };
    
  } catch (error) {
    return {
      isValid: false,
      errors: [customMessage || '無効なURL形式です']
    };
  }
}

/**
 * Email domain validator with blocklist support
 */
export function validateEmailDomain(
  email: string,
  options: ValidationOptions & { blockedDomains?: string[]; allowedDomains?: string[] } = {}
): ValidationResult {
  const { 
    allowEmpty = false, 
    customMessage, 
    blockedDomains = ['tempmail.com', '10minutemail.com', 'guerrillamail.com'],
    allowedDomains = []
  } = options;
  
  if (!email || email.trim().length === 0) {
    if (allowEmpty) {
      return { isValid: true, errors: [], sanitizedValue: '' };
    }
    return {
      isValid: false,
      errors: [customMessage || 'メールアドレスは必須です']
    };
  }
  
  const cleaned = email.trim().toLowerCase();
  
  // Basic email format validation
  const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailPattern.test(cleaned)) {
    return {
      isValid: false,
      errors: [customMessage || '有効なメールアドレス形式で入力してください']
    };
  }
  
  const domain = cleaned.split('@')[1];
  
  // Check allowed domains (if specified)
  if (allowedDomains.length > 0 && !allowedDomains.includes(domain)) {
    return {
      isValid: false,
      errors: [customMessage || `許可されているドメイン: ${allowedDomains.join(', ')}`]
    };
  }
  
  // Check blocked domains
  if (blockedDomains.includes(domain)) {
    return {
      isValid: false,
      errors: [customMessage || '一時的なメールアドレスは使用できません']
    };
  }
  
  return {
    isValid: true,
    errors: [],
    sanitizedValue: cleaned
  };
}

/**
 * File upload validator with security checks
 */
export function validateFileUpload(
  file: { filename: string; mimetype: string; size: number },
  options: ValidationOptions & { 
    allowedTypes?: string[]; 
    maxSize?: number;
    allowedExtensions?: string[];
  } = {}
): ValidationResult {
  const { 
    allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'],
    maxSize = 52428800, // 50MB
    allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.pdf'],
    customMessage
  } = options;
  
  const errors: string[] = [];
  
  // Validate filename
  if (!file.filename || file.filename.trim().length === 0) {
    errors.push('ファイル名は必須です');
  } else {
    // Check for dangerous filename patterns
    const dangerousPatterns = [
      /\.\.|\/|\\/,    // Path traversal
      /[<>:"|?*]/,      // Invalid filename characters
      /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i // Windows reserved names
    ];
    
    if (dangerousPatterns.some(pattern => pattern.test(file.filename))) {
      errors.push('ファイル名に無効な文字が含まれています');
    }
    
    // Check file extension
    const extension = file.filename.toLowerCase().substring(file.filename.lastIndexOf('.'));
    if (!allowedExtensions.includes(extension)) {
      errors.push(`許可されている拡張子: ${allowedExtensions.join(', ')}`);
    }
  }
  
  // Validate MIME type
  if (!allowedTypes.includes(file.mimetype)) {
    errors.push(`許可されているファイルタイプ: ${allowedTypes.join(', ')}`);
  }
  
  // Validate file size
  if (file.size > maxSize) {
    const maxSizeMB = Math.round(maxSize / 1024 / 1024);
    errors.push(`ファイルサイズは${maxSizeMB}MB以下である必要があります`);
  }
  
  if (file.size <= 0) {
    errors.push('ファイルが空です');
  }
  
  if (errors.length > 0) {
    return {
      isValid: false,
      errors: customMessage ? [customMessage] : errors
    };
  }
  
  return {
    isValid: true,
    errors: [],
    sanitizedValue: {
      filename: file.filename.trim(),
      mimetype: file.mimetype,
      size: file.size
    }
  };
}

/**
 * Combined validation function for multiple validators
 */
export function validateMultiple(
  data: Record<string, any>,
  validators: Record<string, (value: any, options?: ValidationOptions) => ValidationResult>,
  options: Record<string, ValidationOptions> = {}
): ValidationResult {
  const errors: string[] = [];
  const sanitizedData: Record<string, any> = {};
  
  for (const [field, value] of Object.entries(data)) {
    const validator = validators[field];
    if (validator) {
      const fieldOptions = options[field] || {};
      const result = validator(value, fieldOptions);
      
      if (!result.isValid) {
        errors.push(...result.errors.map(error => `${field}: ${error}`));
      } else if (result.sanitizedValue !== undefined) {
        sanitizedData[field] = result.sanitizedValue;
      }
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    sanitizedValue: Object.keys(sanitizedData).length > 0 ? sanitizedData : undefined
  };
}

/**
 * Validation error factory for consistent error handling
 */
export function createValidationError(result: ValidationResult, correlationId?: string): ValidationError {
  if (result.isValid) {
    throw new Error('Cannot create validation error for valid result');
  }
  
  const validationErrors = result.errors.map(error => ({
    field: 'unknown',
    message: error
  }));
  
  return new ValidationError(
    'Validation failed',
    undefined,
    validationErrors,
    correlationId
  );
}

/**
 * Async validation wrapper for database checks
 */
export async function validateWithDatabase<T>(
  value: T,
  validator: (value: T) => Promise<ValidationResult>,
  options: ValidationOptions = {}
): Promise<ValidationResult> {
  try {
    return await validator(value);
  } catch (error) {
    return {
      isValid: false,
      errors: [options.customMessage || 'データベース検証中にエラーが発生しました']
    };
  }
}

/**
 * Rate-limited validation (prevent validation DoS)
 */
const validationAttempts = new Map<string, number>();
const VALIDATION_RATE_LIMIT = 100; // per minute
const RATE_LIMIT_WINDOW = 60000; // 1 minute

export function validateWithRateLimit(
  identifier: string,
  validator: () => ValidationResult
): ValidationResult {
  const now = Date.now();
  const windowStart = Math.floor(now / RATE_LIMIT_WINDOW) * RATE_LIMIT_WINDOW;
  const key = `${identifier}:${windowStart}`;
  
  const attempts = validationAttempts.get(key) || 0;
  
  if (attempts >= VALIDATION_RATE_LIMIT) {
    return {
      isValid: false,
      errors: ['検証の試行回数が上限に達しました。しばらくしてから再試行してください。']
    };
  }
  
  validationAttempts.set(key, attempts + 1);
  
  // Cleanup old entries
  setTimeout(() => {
    validationAttempts.delete(key);
  }, RATE_LIMIT_WINDOW);
  
  return validator();
}