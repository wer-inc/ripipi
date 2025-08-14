/**
 * OWASP-compliant sanitization utilities
 * Comprehensive sanitization functions to prevent XSS, SQL injection, and other security vulnerabilities
 */

import { ValidationError } from './errors';

/**
 * Sanitization result interface
 */
export interface SanitizationResult {
  sanitized: any;
  warnings: string[];
  modified: boolean;
}

/**
 * Sanitization options
 */
export interface SanitizationOptions {
  strict?: boolean;
  preserveLineBreaks?: boolean;
  allowBasicFormatting?: boolean;
  maxLength?: number;
  customRules?: ((input: string) => string)[];
}

/**
 * HTML entity encoding map for XSS prevention
 */
const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;'
};

/**
 * HTML escape function - prevents XSS attacks
 * Encodes dangerous HTML characters to their entity equivalents
 */
export function escapeHtml(input: string, options: SanitizationOptions = {}): SanitizationResult {
  if (typeof input !== 'string') {
    return {
      sanitized: String(input),
      warnings: ['Input converted to string'],
      modified: true
    };
  }

  const original = input;
  let sanitized = input;
  const warnings: string[] = [];

  // Replace HTML entities
  sanitized = sanitized.replace(/[&<>"'`=\/]/g, match => HTML_ENTITIES[match]);

  // Apply length limit if specified
  if (options.maxLength && sanitized.length > options.maxLength) {
    sanitized = sanitized.substring(0, options.maxLength);
    warnings.push(`Input truncated to ${options.maxLength} characters`);
  }

  return {
    sanitized,
    warnings,
    modified: sanitized !== original
  };
}

/**
 * Strip HTML tags completely - aggressive XSS prevention
 */
export function stripHtml(input: string, options: SanitizationOptions = {}): SanitizationResult {
  if (typeof input !== 'string') {
    return {
      sanitized: String(input),
      warnings: ['Input converted to string'],
      modified: true
    };
  }

  const original = input;
  let sanitized = input;
  const warnings: string[] = [];

  if (options.allowBasicFormatting) {
    // Allow only safe formatting tags
    const allowedTags = ['b', 'i', 'u', 'em', 'strong', 'br'];
    const tagPattern = new RegExp(`<(?!\/?(?:${allowedTags.join('|')})(?:\s|>))[^>]*>`, 'gi');
    sanitized = sanitized.replace(tagPattern, '');
    
    if (tagPattern.test(original)) {
      warnings.push('Some HTML tags were removed');
    }
  } else {
    // Remove all HTML tags
    const hasHtml = /<[^>]*>/g.test(sanitized);
    sanitized = sanitized.replace(/<[^>]*>/g, '');
    
    if (hasHtml) {
      warnings.push('HTML tags were removed');
    }
  }

  // Decode HTML entities after tag removal
  sanitized = sanitized
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#x60;/g, '`')
    .replace(/&#x3D;/g, '=')
    .replace(/&amp;/g, '&'); // This should be last

  if (options.maxLength && sanitized.length > options.maxLength) {
    sanitized = sanitized.substring(0, options.maxLength);
    warnings.push(`Input truncated to ${options.maxLength} characters`);
  }

  return {
    sanitized,
    warnings,
    modified: sanitized !== original
  };
}

/**
 * SQL escape function - prevents SQL injection
 * Escapes single quotes and other dangerous SQL characters
 */
export function escapeSql(input: string): SanitizationResult {
  if (typeof input !== 'string') {
    return {
      sanitized: String(input),
      warnings: ['Input converted to string'],
      modified: true
    };
  }

  const original = input;
  const warnings: string[] = [];
  
  // Escape single quotes (primary SQL injection vector)
  let sanitized = input.replace(/'/g, "''");
  
  // Check for suspicious SQL patterns
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/gi,
    /(--|\/\*|\*\/|;)/g,
    /(\bOR\b|\bAND\b).*[=<>]/gi
  ];
  
  const suspiciousContent = sqlPatterns.some(pattern => pattern.test(input));
  if (suspiciousContent) {
    warnings.push('Input contains suspicious SQL-like patterns');
  }

  return {
    sanitized,
    warnings,
    modified: sanitized !== original
  };
}

/**
 * Path traversal prevention - sanitizes file paths
 */
export function sanitizePath(input: string, options: SanitizationOptions = {}): SanitizationResult {
  if (typeof input !== 'string') {
    return {
      sanitized: '',
      warnings: ['Invalid path input'],
      modified: true
    };
  }

  const original = input;
  let sanitized = input;
  const warnings: string[] = [];

  // Remove path traversal attempts
  const dangerousPatterns = [
    /\.\./g,           // Parent directory traversal
    /[\/\\]/g,         // Path separators
    /[<>:"|?*]/g,      // Windows invalid filename chars
    /[\x00-\x1f]/g,    // Control characters
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i // Windows reserved names
  ];

  dangerousPatterns.forEach((pattern, index) => {
    if (pattern.test(sanitized)) {
      sanitized = sanitized.replace(pattern, '');
      if (index === 0) warnings.push('Path traversal attempts removed');
      else if (index === 1) warnings.push('Path separators removed');
      else if (index === 2) warnings.push('Invalid filename characters removed');
      else if (index === 3) warnings.push('Control characters removed');
      else if (index === 4) warnings.push('Reserved filename detected and cleared');
    }
  });

  // Trim and normalize
  sanitized = sanitized.trim();
  
  if (sanitized.length === 0 && original.length > 0) {
    warnings.push('Path completely sanitized - potentially dangerous');
    sanitized = 'safe_filename';
  }

  // Apply length limit
  if (options.maxLength && sanitized.length > options.maxLength) {
    sanitized = sanitized.substring(0, options.maxLength);
    warnings.push(`Filename truncated to ${options.maxLength} characters`);
  }

  return {
    sanitized,
    warnings,
    modified: sanitized !== original
  };
}

/**
 * Remove control characters - prevents various injection attacks
 */
export function removeControlChars(input: string): SanitizationResult {
  if (typeof input !== 'string') {
    return {
      sanitized: String(input),
      warnings: ['Input converted to string'],
      modified: true
    };
  }

  const original = input;
  const warnings: string[] = [];

  // Remove control characters (0x00-0x1F and 0x7F-0x9F) except \t, \n, \r
  const sanitized = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');

  if (sanitized !== original) {
    warnings.push('Control characters were removed');
  }

  return {
    sanitized,
    warnings,
    modified: sanitized !== original
  };
}

/**
 * Normalize whitespace - prevents layout attacks and improves data quality
 */
export function normalizeWhitespace(input: string, options: SanitizationOptions = {}): SanitizationResult {
  if (typeof input !== 'string') {
    return {
      sanitized: String(input),
      warnings: ['Input converted to string'],
      modified: true
    };
  }

  const original = input;
  let sanitized = input;
  const warnings: string[] = [];

  // Trim leading/trailing whitespace
  sanitized = sanitized.trim();

  if (options.preserveLineBreaks) {
    // Normalize line breaks to \n and collapse multiple spaces
    sanitized = sanitized
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s+/g, '\n')
      .replace(/\s+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
  } else {
    // Replace all whitespace with single spaces
    sanitized = sanitized.replace(/\s+/g, ' ');
  }

  if (sanitized !== original) {
    warnings.push('Whitespace was normalized');
  }

  return {
    sanitized,
    warnings,
    modified: sanitized !== original
  };
}

/**
 * URL sanitization - prevents malicious URLs
 */
export function sanitizeUrl(input: string, options: SanitizationOptions = {}): SanitizationResult {
  if (typeof input !== 'string') {
    return {
      sanitized: '',
      warnings: ['Invalid URL input'],
      modified: true
    };
  }

  const original = input.trim();
  let sanitized = original;
  const warnings: string[] = [];

  // Remove dangerous protocols
  const dangerousProtocols = [
    /^javascript:/i,
    /^data:/i,
    /^vbscript:/i,
    /^file:/i,
    /^ftp:/i
  ];

  if (dangerousProtocols.some(protocol => protocol.test(sanitized))) {
    sanitized = '';
    warnings.push('Dangerous URL protocol removed');
  }

  // Check for XSS patterns in URLs
  const xssPatterns = [
    /<script/i,
    /onload=/i,
    /onerror=/i,
    /onclick=/i,
    /onmouseover=/i,
    /javascript:/i,
    /alert\(/i,
    /document\./i
  ];

  if (xssPatterns.some(pattern => pattern.test(sanitized))) {
    sanitized = '';
    warnings.push('XSS patterns detected in URL');
  }

  // Validate URL format if not empty
  if (sanitized && sanitized.length > 0) {
    try {
      const url = new URL(sanitized);
      
      // Only allow http and https
      if (!['http:', 'https:'].includes(url.protocol)) {
        sanitized = '';
        warnings.push('Only HTTP/HTTPS URLs are allowed');
      } else {
        sanitized = url.toString();
      }
    } catch (error) {
      if (!options.strict) {
        // Try to prepend https if missing protocol
        if (!/^https?:\/\//i.test(sanitized)) {
          try {
            const correctedUrl = new URL(`https://${sanitized}`);
            sanitized = correctedUrl.toString();
            warnings.push('Protocol added to URL');
          } catch (correctionError) {
            sanitized = '';
            warnings.push('Invalid URL format');
          }
        } else {
          sanitized = '';
          warnings.push('Invalid URL format');
        }
      } else {
        sanitized = '';
        warnings.push('Invalid URL format');
      }
    }
  }

  return {
    sanitized,
    warnings,
    modified: sanitized !== original
  };
}

/**
 * Email sanitization
 */
export function sanitizeEmail(input: string): SanitizationResult {
  if (typeof input !== 'string') {
    return {
      sanitized: '',
      warnings: ['Invalid email input'],
      modified: true
    };
  }

  const original = input;
  const warnings: string[] = [];

  // Basic sanitization: trim and lowercase
  let sanitized = input.trim().toLowerCase();

  // Remove dangerous characters
  sanitized = sanitized.replace(/[<>'"&]/g, '');

  // Basic email format validation
  const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailPattern.test(sanitized)) {
    if (sanitized.length > 0) {
      warnings.push('Email format appears invalid');
    }
  }

  return {
    sanitized,
    warnings,
    modified: sanitized !== original
  };
}

/**
 * Phone number sanitization
 */
export function sanitizePhoneNumber(input: string): SanitizationResult {
  if (typeof input !== 'string') {
    return {
      sanitized: '',
      warnings: ['Invalid phone number input'],
      modified: true
    };
  }

  const original = input;
  const warnings: string[] = [];

  // Remove all non-digit and non-plus characters
  let sanitized = input.replace(/[^\d+]/g, '');

  // Ensure plus sign is only at the beginning
  if (sanitized.includes('+')) {
    const parts = sanitized.split('+');
    sanitized = '+' + parts.join('');
    
    if (sanitized.indexOf('+') !== 0 || sanitized.lastIndexOf('+') !== 0) {
      sanitized = sanitized.replace(/\+/g, '');
      warnings.push('Multiple plus signs removed');
    }
  }

  return {
    sanitized,
    warnings,
    modified: sanitized !== original
  };
}

/**
 * JSON sanitization - prevents JSON injection
 */
export function sanitizeJson(input: any, options: SanitizationOptions = {}): SanitizationResult {
  const warnings: string[] = [];
  let sanitized: any;
  let modified = false;

  try {
    // If input is already an object, stringify and parse to clean it
    if (typeof input === 'object') {
      const jsonString = JSON.stringify(input);
      sanitized = JSON.parse(jsonString);
    } else if (typeof input === 'string') {
      // Try to parse JSON string
      sanitized = JSON.parse(input);
      modified = true;
    } else {
      // Convert primitives to safe values
      sanitized = input;
    }

    // Recursively sanitize object values
    if (typeof sanitized === 'object' && sanitized !== null) {
      sanitized = sanitizeObjectRecursively(sanitized, options, warnings);
      modified = true;
    }

  } catch (error) {
    warnings.push('Invalid JSON format');
    sanitized = null;
    modified = true;
  }

  return {
    sanitized,
    warnings,
    modified
  };
}

/**
 * Recursively sanitize object properties
 */
function sanitizeObjectRecursively(
  obj: any, 
  options: SanitizationOptions, 
  warnings: string[]
): any {
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObjectRecursively(item, options, warnings));
  }

  if (obj && typeof obj === 'object') {
    const sanitized: any = {};
    
    for (const [key, value] of Object.entries(obj)) {
      // Sanitize property names
      const sanitizedKey = key.replace(/[<>'"&]/g, '');
      
      if (sanitizedKey !== key) {
        warnings.push(`Object property name sanitized: ${key}`);
      }

      // Recursively sanitize values
      if (typeof value === 'string') {
        const result = escapeHtml(value, options);
        sanitized[sanitizedKey] = result.sanitized;
        warnings.push(...result.warnings);
      } else if (typeof value === 'object') {
        sanitized[sanitizedKey] = sanitizeObjectRecursively(value, options, warnings);
      } else {
        sanitized[sanitizedKey] = value;
      }
    }
    
    return sanitized;
  }

  return obj;
}

/**
 * Unicode normalization - prevents Unicode-based attacks
 */
export function normalizeUnicode(input: string): SanitizationResult {
  if (typeof input !== 'string') {
    return {
      sanitized: String(input),
      warnings: ['Input converted to string'],
      modified: true
    };
  }

  const original = input;
  const warnings: string[] = [];

  // Normalize to NFC form (canonical decomposition, then canonical composition)
  let sanitized = input.normalize('NFC');

  // Remove potentially dangerous Unicode categories
  // Remove format characters, private use areas, etc.
  sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF]/g, ''); // Zero-width characters
  sanitized = sanitized.replace(/[\uE000-\uF8FF]/g, ''); // Private use area
  sanitized = sanitized.replace(/[\uFDD0-\uFDEF]/g, ''); // Noncharacters

  if (sanitized !== original) {
    warnings.push('Unicode normalization applied');
  }

  return {
    sanitized,
    warnings,
    modified: sanitized !== original
  };
}

/**
 * Comprehensive sanitization pipeline
 * Applies multiple sanitization techniques in sequence
 */
export function sanitizeComprehensive(
  input: string,
  options: SanitizationOptions & {
    enableHtmlEscape?: boolean;
    enableStripHtml?: boolean;
    enableSqlEscape?: boolean;
    enablePathSanitization?: boolean;
    enableControlCharRemoval?: boolean;
    enableWhitespaceNormalization?: boolean;
    enableUnicodeNormalization?: boolean;
  } = {}
): SanitizationResult {
  let current = input;
  const allWarnings: string[] = [];
  let hasBeenModified = false;

  const {
    enableHtmlEscape = true,
    enableStripHtml = false,
    enableSqlEscape = false,
    enablePathSanitization = false,
    enableControlCharRemoval = true,
    enableWhitespaceNormalization = true,
    enableUnicodeNormalization = true
  } = options;

  // Apply sanitization steps in order
  if (enableUnicodeNormalization) {
    const result = normalizeUnicode(current);
    current = result.sanitized;
    allWarnings.push(...result.warnings);
    hasBeenModified = hasBeenModified || result.modified;
  }

  if (enableControlCharRemoval) {
    const result = removeControlChars(current);
    current = result.sanitized;
    allWarnings.push(...result.warnings);
    hasBeenModified = hasBeenModified || result.modified;
  }

  if (enableWhitespaceNormalization) {
    const result = normalizeWhitespace(current, options);
    current = result.sanitized;
    allWarnings.push(...result.warnings);
    hasBeenModified = hasBeenModified || result.modified;
  }

  if (enablePathSanitization) {
    const result = sanitizePath(current, options);
    current = result.sanitized;
    allWarnings.push(...result.warnings);
    hasBeenModified = hasBeenModified || result.modified;
  }

  if (enableStripHtml) {
    const result = stripHtml(current, options);
    current = result.sanitized;
    allWarnings.push(...result.warnings);
    hasBeenModified = hasBeenModified || result.modified;
  } else if (enableHtmlEscape) {
    const result = escapeHtml(current, options);
    current = result.sanitized;
    allWarnings.push(...result.warnings);
    hasBeenModified = hasBeenModified || result.modified;
  }

  if (enableSqlEscape) {
    const result = escapeSql(current);
    current = result.sanitized;
    allWarnings.push(...result.warnings);
    hasBeenModified = hasBeenModified || result.modified;
  }

  // Apply custom rules if provided
  if (options.customRules) {
    for (const rule of options.customRules) {
      const processed = rule(current);
      if (processed !== current) {
        current = processed;
        allWarnings.push('Custom sanitization rule applied');
        hasBeenModified = true;
      }
    }
  }

  return {
    sanitized: current,
    warnings: allWarnings,
    modified: hasBeenModified
  };
}

/**
 * Batch sanitization for multiple inputs
 */
export function sanitizeBatch(
  inputs: Record<string, any>,
  rules: Record<string, {
    sanitizer: (input: any, options?: SanitizationOptions) => SanitizationResult;
    options?: SanitizationOptions;
  }>
): Record<string, SanitizationResult> {
  const results: Record<string, SanitizationResult> = {};

  for (const [key, value] of Object.entries(inputs)) {
    const rule = rules[key];
    if (rule) {
      results[key] = rule.sanitizer(value, rule.options);
    } else {
      // Default sanitization for unspecified fields
      if (typeof value === 'string') {
        results[key] = sanitizeComprehensive(value);
      } else {
        results[key] = {
          sanitized: value,
          warnings: [],
          modified: false
        };
      }
    }
  }

  return results;
}

/**
 * Safe string conversion with sanitization
 */
export function toSafeString(input: any, maxLength: number = 1000): string {
  if (input === null || input === undefined) {
    return '';
  }

  let str = String(input);
  
  if (str.length > maxLength) {
    str = str.substring(0, maxLength);
  }

  const result = sanitizeComprehensive(str, {
    maxLength,
    enableHtmlEscape: true,
    enableControlCharRemoval: true,
    enableWhitespaceNormalization: true,
    enableUnicodeNormalization: true
  });

  return result.sanitized;
}

/**
 * Sanitization error factory
 */
export function createSanitizationError(message: string, warnings: string[]): ValidationError {
  return new ValidationError(
    message,
    undefined,
    warnings.map(warning => ({
      field: 'sanitization',
      message: warning
    }))
  );
}