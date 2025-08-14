# OWASP準拠 バリデーション・サニタイズシステム 使用ガイド

このドキュメントでは、実装されたOWASP Top 10準拠のバリデーションとサニタイズシステムの使用方法を説明します。

## システム概要

実装されたセキュリティシステムは以下のコンポーネントで構成されています：

### 1. 共通スキーマ (`src/schemas/common.ts`)
- ページネーション、ソート、フィルター
- 日時範囲、多言語対応
- 日本のビジネス要件（住所、電話番号等）
- ファイルアップロード、セキュアURL

### 2. カスタムバリデーター (`src/utils/validators.ts`)
- 日本の電話番号検証
- 郵便番号検証（XXX-XXXX形式）
- クレジットカード番号（Luhnアルゴリズム）
- 営業時間・予約時間帯検証
- 強力なパスワード検証
- セキュアURL検証

### 3. サニタイズユーティリティ (`src/utils/sanitizers.ts`)
- HTMLエスケープ・XSS防御
- SQLインジェクション防止
- パストラバーサル防止
- Unicode正規化
- 包括的サニタイズパイプライン

### 4. バリデーションミドルウェア (`src/middleware/validation.ts`)
- TypeBoxスキーマ統合
- カスタムバリデーション
- 結果キャッシング
- パフォーマンスメトリクス
- レート制限

### 5. サニタイズミドルウェア (`src/middleware/sanitizer.ts`)
- 自動入力サニタイズ
- フィールドマッピング
- 批次処理
- 詳細ログとメトリクス

## 基本的な使用方法

### Fastifyアプリケーションへの統合

```typescript
// src/app.ts
import fastify from 'fastify';
import validationMiddleware from './middleware/validation';
import sanitizationMiddleware from './middleware/sanitizer';

const app = fastify();

// サニタイズミドルウェアを先に登録（入力を清浄化）
await app.register(sanitizationMiddleware, {
  enableRequestBodySanitization: true,
  enableQueryParameterSanitization: true,
  strictMode: true,
  logSanitization: true
});

// バリデーションミドルウェアを次に登録（清浄化されたデータを検証）
await app.register(validationMiddleware, {
  enableCache: true,
  strict: true,
  performanceMetrics: true
});
```

### ルート定義での使用

```typescript
// src/routes/v1/users.ts
import { Type } from '@sinclair/typebox';
import { PaginationSchema, EmailSchema } from '../../schemas/common';
import { validateJapanesePhoneNumber, validateStrongPassword } from '../../utils/validators';

// ユーザー作成エンドポイント
app.post('/users', {
  schema: {
    body: Type.Object({
      email: EmailSchema,
      first_name: Type.String({ 
        minLength: 1, 
        maxLength: 50,
        pattern: '^[ぁ-ヿ一-龯ー\\s]+$' // 日本語名
      }),
      last_name: Type.String({ 
        minLength: 1, 
        maxLength: 50,
        pattern: '^[ぁ-ヿ一-龯ー\\s]+$'
      }),
      phone_number: Type.Optional(Type.String()),
      password: Type.String({ minLength: 8 })
    }),
    response: {
      201: Type.Object({
        id: Type.String(),
        message: Type.String()
      })
    }
  }
}, async (request, reply) => {
  // リクエストデータは自動的にサニタイズ・バリデーション済み
  const { email, first_name, last_name, phone_number, password } = request.body;
  
  // 追加のカスタムバリデーション
  if (phone_number) {
    const phoneValidation = validateJapanesePhoneNumber(phone_number);
    if (!phoneValidation.isValid) {
      throw new ValidationError('Invalid phone number', 'phone_number', 
        phoneValidation.errors.map(e => ({ field: 'phone_number', message: e })));
    }
  }
  
  const passwordValidation = validateStrongPassword(password);
  if (!passwordValidation.isValid) {
    throw new ValidationError('Password does not meet requirements', 'password',
      passwordValidation.errors.map(e => ({ field: 'password', message: e })));
  }
  
  // ユーザー作成処理...
  
  reply.code(201).send({
    id: 'user_123',
    message: 'User created successfully'
  });
});
```

### カスタムバリデーターの使用

```typescript
// 営業時間バリデーション
import { validateBusinessHours, validateReservationTimeSlot } from '../utils/validators';

// 営業時間設定エンドポイント
app.post('/business-hours', {
  schema: {
    body: Type.Object({
      day_of_week: Type.Integer({ minimum: 0, maximum: 6 }),
      hours: Type.String() // "09:00-18:00" 形式
    })
  }
}, async (request, reply) => {
  const { day_of_week, hours } = request.body;
  
  const validation = validateBusinessHours(hours);
  if (!validation.isValid) {
    throw new ValidationError('Invalid business hours format', 'hours');
  }
  
  // 検証済み・正規化された時間を使用
  const normalizedHours = validation.sanitizedValue;
  
  // データベース保存処理...
});

// 予約作成エンドポイント  
app.post('/reservations', async (request, reply) => {
  const { start_time, end_time, business_hours } = request.body;
  
  const validation = validateReservationTimeSlot(
    start_time, 
    end_time, 
    business_hours
  );
  
  if (!validation.isValid) {
    throw new ValidationError('Invalid reservation time', undefined,
      validation.errors.map(e => ({ field: 'time', message: e })));
  }
  
  const { startTime, endTime, durationMinutes } = validation.sanitizedValue;
  
  // 予約処理...
});
```

### サニタイズの詳細制御

```typescript
// カスタムフィールドマッピングでの詳細制御
import { createSanitizationMiddleware } from './middleware/sanitizer';

await app.register(createSanitizationMiddleware({
  fieldMappings: {
    // HTMLコンテンツフィールド（基本的なフォーマットを許可）
    description: { 
      sanitizer: 'html', 
      options: { allowBasicFormatting: true }
    },
    // URLフィールド（HTTPSのみ許可）
    website: { 
      sanitizer: 'url',
      options: { allowedProtocols: ['https'] }
    },
    // カスタムサニタイゼーション
    special_field: {
      sanitizer: 'custom',
      customSanitizer: (value) => {
        // カスタムロジック
        const sanitized = value.replace(/[^a-zA-Z0-9]/g, '');
        return {
          sanitized,
          warnings: sanitized !== value ? ['Special characters removed'] : [],
          modified: sanitized !== value
        };
      }
    }
  },
  customRules: {
    // 複数フィールドに適用されるカスタムルール
    stripScripts: {
      fields: ['content', 'description', 'notes'],
      sanitizer: (value) => stripHtml(value, { allowBasicFormatting: false })
    }
  },
  excludeFields: ['password', 'secret_key'], // サニタイズ対象外
  maxFieldLength: 5000
}));
```

### メトリクスとモニタリング

```typescript
// バリデーション・サニタイズメトリクスの取得
app.get('/admin/metrics', async (request, reply) => {
  const validationMetrics = app.getValidationMetrics();
  const sanitizationMetrics = app.getSanitizationMetrics();
  
  return {
    validation: {
      totalValidations: validationMetrics.totalValidations,
      cacheHitRate: validationMetrics.cacheHits / 
        (validationMetrics.cacheHits + validationMetrics.cacheMisses),
      averageTime: validationMetrics.averageValidationTime,
      errorRate: validationMetrics.validationErrors / validationMetrics.totalValidations
    },
    sanitization: {
      totalRequests: sanitizationMetrics.totalRequests,
      warningsGenerated: sanitizationMetrics.warningsGenerated,
      averageTime: sanitizationMetrics.averageProcessingTime,
      errorRate: sanitizationMetrics.errorCount / sanitizationMetrics.totalRequests
    }
  };
});
```

## セキュリティ機能詳細

### OWASP Top 10 対応

1. **A03 - Injection**: SQLエスケープ、コマンドインジェクション防止
2. **A07 - XSS**: HTMLエスケープ、スクリプトタグ除去
3. **A08 - Insecure Deserialization**: JSON正規化、オブジェクト検証
4. **A01 - Broken Access Control**: 権限ベースバリデーション
5. **A02 - Cryptographic Failures**: 安全な文字列処理

### 日本のビジネス要件対応

- **電話番号**: 090/080/070携帯、03/06固定電話
- **郵便番号**: XXX-XXXX形式の7桁郵便番号  
- **住所**: 都道府県、市区町村の日本語対応
- **営業時間**: 24時間形式での時間範囲
- **予約システム**: 最小15分、最大8時間の予約制御

### パフォーマンス最適化

- **バリデーション結果キャッシング**: 1分間有効
- **レート制限**: IP別の検証回数制限
- **バッチ処理**: 複数フィールド一括処理
- **メモリ管理**: 定期的なキャッシュクリーンアップ

## エラーハンドリング

すべてのバリデーションエラーは既存の`ValidationError`クラスと統合されています：

```typescript
try {
  // バリデーション処理
} catch (error) {
  if (error instanceof ValidationError) {
    // 構造化されたエラーレスポンス
    reply.code(400).send({
      error: {
        message: error.message,
        code: error.code,
        details: error.validationErrors
      }
    });
  }
}
```

## 本番環境での推奨設定

```typescript
// 本番環境設定例
const productionConfig = {
  validation: {
    enableCache: true,
    cacheTimeout: 300000, // 5分
    strict: true,
    performanceMetrics: true,
    rateLimiting: {
      enabled: true,
      maxAttempts: 50,
      windowMs: 60000
    }
  },
  sanitization: {
    strictMode: true,
    enableRequestBodySanitization: true,
    enableQueryParameterSanitization: true,
    logSanitization: false, // 本番ではログを最小限に
    maxFieldLength: 10000,
    rateLimiting: {
      enabled: true,
      maxAttempts: 100,
      windowMs: 60000
    }
  }
};
```

このシステムにより、アプリケーションは OWASP Top 10 に対応した堅牢なセキュリティ機能を持ち、日本のビジネス要件も満たす包括的なバリデーションとサニタイズを実現できます。