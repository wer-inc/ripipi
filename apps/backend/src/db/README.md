# Database Module

PostgreSQL接続設定とコネクションプール実装のためのモジュールです。

## 機能

- **コネクションプール管理**: 効率的なデータベース接続管理
- **マルチテナント対応**: tenant_idベースの自動フィルタリング
- **トランザクション管理**: 自動ロールバックとデッドロック検出
- **エラーハンドリング**: PostgreSQLエラーの適切な処理
- **メトリクス取得**: 接続プールの状態監視
- **型安全性**: TypeScriptによる完全な型サポート

## 基本的な使用方法

### 1. データベース接続

```typescript
import { db, connectDatabase } from './db/index.js';

// アプリケーション起動時
await connectDatabase();
```

### 2. 基本的なクエリ実行

```typescript
// 単純なクエリ
const result = await db.query('SELECT * FROM users WHERE active = $1', [true]);

// テナント固有のクエリ
const tenantUsers = await db.queryForTenant(
  'tenant_123',
  'SELECT * FROM users WHERE active = $1',
  [true]
);
```

### 3. トランザクション使用

```typescript
import { withTransaction } from './db/transaction.js';

const result = await withTransaction(async (ctx) => {
  // 複数の操作を1つのトランザクション内で実行
  const user = await ctx.query(
    'INSERT INTO users (name, email, tenant_id) VALUES ($1, $2, $3) RETURNING *',
    ['John Doe', 'john@example.com', 'tenant_123']
  );
  
  await ctx.query(
    'INSERT INTO user_profiles (user_id, tenant_id) VALUES ($1, $2)',
    [user.rows[0].id, 'tenant_123']
  );
  
  return user.rows[0];
});
```

### 4. Fastifyプラグインの使用

```typescript
import postgres from './plugins/postgres.js';

// プラグイン登録
await fastify.register(postgres);

// ルート内での使用
fastify.get('/users', async (request, reply) => {
  const result = await fastify.db.query('SELECT * FROM users');
  return result.rows;
});

// ヘルスチェック
// GET /health/database でデータベースの状態を確認
```

## 高度な使用方法

### 1. カスタムトランザクション設定

```typescript
import { withTransaction } from './db/transaction.js';

const result = await withTransaction(async (ctx) => {
  // トランザクション内の処理
  return await ctx.query('SELECT * FROM sensitive_data');
}, {
  isolationLevel: 'SERIALIZABLE',
  readOnly: true,
  retryAttempts: 5,
  retryDelay: 200
});
```

### 2. テナント固有のトランザクション

```typescript
import { withTenantTransaction } from './db/transaction.js';

const result = await withTenantTransaction('tenant_123', async (ctx) => {
  // テナントコンテキストが自動的に設定される
  const users = await ctx.queryForTenant('tenant_123', 'SELECT * FROM users');
  return users.rows;
});
```

### 3. セーブポイントの使用

```typescript
import { withTransaction, withSavepoint } from './db/transaction.js';

await withTransaction(async (ctx) => {
  // メインの処理
  await ctx.query('INSERT INTO main_table ...');
  
  // セーブポイントを使った部分的なロールバック
  try {
    await withSavepoint(ctx, 'optional_data', async () => {
      await ctx.query('INSERT INTO optional_table ...');
    });
  } catch (error) {
    // セーブポイントまでロールバックされる（メインの処理は維持）
    console.log('Optional data insertion failed, continuing...');
  }
});
```

### 4. バッチオペレーション

```typescript
import { withBatchTransaction } from './db/transaction.js';

const operations = [
  (ctx) => ctx.query('INSERT INTO table1 ...'),
  (ctx) => ctx.query('INSERT INTO table2 ...'),
  (ctx) => ctx.query('UPDATE table3 ...')
];

const results = await withBatchTransaction(operations);
```

## エラーハンドリング

### デッドロック検出と自動リトライ

```typescript
import { withTransaction, DeadlockError } from './db/transaction.js';

try {
  await withTransaction(async (ctx) => {
    // デッドロックが発生する可能性のある処理
  }, {
    retryAttempts: 3,
    retryDelay: 100
  });
} catch (error) {
  if (error instanceof DeadlockError) {
    // デッドロックによる失敗
    console.log('Transaction failed due to deadlock after retries');
  }
}
```

### PostgreSQLエラーの処理

Fastifyプラグインは自動的にPostgreSQLエラーを適切なHTTPステータスコードにマッピングします：

- `23505` (重複キー) → 400 Bad Request
- `23503` (外部キー違反) → 400 Bad Request
- `08003` (接続エラー) → 503 Service Unavailable
- `40001` (デッドロック) → 自動リトライ

## 設定オプション

### 環境変数

```bash
# データベース接続
DATABASE_URL=postgresql://user:pass@host:port/db
DB_SSL=true

# コネクションプール
DB_POOL_MIN=10
DB_POOL_MAX=50
DB_IDLE_TIMEOUT=30000
DB_CONNECTION_TIMEOUT=10000
DB_STATEMENT_TIMEOUT=30000
DB_QUERY_TIMEOUT=30000
DB_APPLICATION_NAME=ripipi-backend
```

## モニタリング

### メトリクス取得

```typescript
// 接続プールの状態を取得
const metrics = fastify.getDatabaseMetrics();
console.log({
  totalConnections: metrics.totalConnections,
  idleConnections: metrics.idleConnections,
  waitingClients: metrics.waitingClients
});

// ヘルスチェック
const isHealthy = fastify.isDatabaseHealthy();
```

### ログ出力

すべてのデータベース操作は適切にログに記録されます：

- 接続/切断イベント
- クエリ実行時間
- エラー詳細
- トランザクションの開始/終了
- リトライの詳細

## ベストプラクティス

1. **接続の再利用**: 常にコネクションプールを使用し、直接接続を作成しない
2. **トランザクションの適切な使用**: 複数の関連操作は必ずトランザクション内で実行
3. **エラーハンドリング**: デッドロックやシリアライゼーション失敗に対する適切な処理
4. **テナント分離**: マルチテナント環境では必ずテナントIDでフィルタリング
5. **メトリクス監視**: 定期的に接続プールの状態を監視
6. **グレースフルシャットダウン**: アプリケーション終了時は必ず接続を適切に閉じる

## トラブルシューティング

### 接続プールの枯渇

```typescript
// 接続プールの状態を確認
const metrics = db.getMetrics();
if (metrics.waitingClients > 0) {
  console.warn('Connection pool exhausted, waiting clients:', metrics.waitingClients);
}
```

### 長時間実行クエリの検出

プラグインは自動的に1秒以上実行されるクエリを警告として記録します。

### デッドロックの頻発

デッドロックが頻発する場合は、テーブルアクセス順序を一貫させるか、分離レベルを調整してください。

```typescript
// より緩い分離レベルでリトライ
await withTransaction(async (ctx) => {
  // 処理
}, {
  isolationLevel: 'READ COMMITTED',
  retryAttempts: 5
});
```