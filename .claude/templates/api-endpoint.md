# API Endpoint Template

## 標準的なAPIエンドポイント実装テンプレート

### 1. 型定義 (`src/types/{feature}.ts`)
```typescript
import { Static, Type } from '@sinclair/typebox';

// リクエスト型
export const Create{Feature}Schema = Type.Object({
  // フィールド定義
});

export type Create{Feature}Request = Static<typeof Create{Feature}Schema>;

// レスポンス型
export const {Feature}ResponseSchema = Type.Object({
  id: Type.Number(),
  // その他のフィールド
  created_at: Type.String({ format: 'date-time' }),
  updated_at: Type.String({ format: 'date-time' }),
});

export type {Feature}Response = Static<typeof {Feature}ResponseSchema>;
```

### 2. サービス層 (`src/services/{feature}.service.ts`)
```typescript
import { FastifyInstance } from 'fastify';

export class {Feature}Service {
  constructor(private fastify: FastifyInstance) {}

  async create(params: Create{Feature}Request): Promise<{Feature}Response> {
    const client = await this.fastify.pg.connect();
    
    try {
      await client.query('BEGIN');
      
      // ビジネスロジック
      
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
```

### 3. ルートハンドラ (`src/routes/{version}/{feature}.ts`)
```typescript
import { FastifyPluginAsync } from 'fastify';
import { {Feature}Service } from '../../services/{feature}.service';

const {feature}Routes: FastifyPluginAsync = async (fastify) => {
  const service = new {Feature}Service(fastify);

  fastify.post('/', {
    schema: {
      body: Create{Feature}Schema,
      response: {
        201: {Feature}ResponseSchema,
      },
    },
  }, async (request, reply) => {
    const result = await service.create(request.body);
    return reply.code(201).send(result);
  });
};

export default {feature}Routes;
```

### 4. テスト (`test/routes/{feature}.test.ts`)
```typescript
import tap from 'tap';
import { build } from '../helper';

tap.test('{Feature} API', async (t) => {
  const app = await build(t);

  t.test('POST /{feature} - 正常系', async (t) => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/{feature}',
      payload: {
        // テストデータ
      },
    });

    t.equal(response.statusCode, 201);
    // アサーション
  });
});
```