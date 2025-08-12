いいよ。**Vite（React）＋ Fastify（Drizzle×PostgreSQL）＋ LIFF**で、今日から動かせる“実装フロー”を**手順→コマンド→最小コード**まで落として書きます。
（前提：パッケージは **pnpm**、DBは **PostgreSQL**、通知は後で Cloud Tasks に載せ替え）

---

# 0. ゴール像（まず全体像を握る）

```
LIFF(Vite SPA)
  └─ liff.init/login → getIDToken()
      └─ API /auth/line で IDトークン検証 → app_jwt 発行
          └─ 以降のAPIは Authorization: Bearer <app_jwt>
API(Fastify)
  ├─ /reservations (GET/POST)  … フラット配列で返す
  ├─ /queue (GET/POST)
  ├─ /tasks/notify  … 予約時に作った通知ジョブを送る
  └─ /line/webhook  … 友だち追加/ブロック/キーワード応答
DB(PostgreSQL)
  ├─ stores/staff/menus/members
  ├─ reservations（EXCLUDE制約で時間重複禁止）
  └─ notification_jobs/audit_logs
```

---

# 1. リポジトリ雛形を作る

```bash
mkdir liff-reserve && cd liff-reserve
pnpm init
mkdir -p apps/{liff-web,admin-web,api} packages/{config,ui}
pnpm dlx create-vite@latest apps/liff-web --template react-ts
pnpm dlx create-vite@latest apps/admin-web --template react-ts
```

モノレポ化（`package.json`）：

```json
{
  "name": "liff-reserve",
  "private": true,
  "packageManager": "pnpm@9",
  "workspaces": ["apps/*", "packages/*"]
}
```

---

# 2. DB（ローカル）を立てる

**docker-compose.yaml**

```yaml
version: "3.9"
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: devpass
      POSTGRES_USER: devuser
      POSTGRES_DB: liffapp
    ports: ["5432:5432"]
    volumes: [dbdata:/var/lib/postgresql/data]
    healthcheck: {test: ["CMD-SHELL","pg_isready -U devuser"], interval: 5s, timeout: 5s, retries: 10}
volumes:
  dbdata:
```

```bash
docker compose up -d
```

---

# 3. API（Fastify + Drizzle）を用意

```bash
cd apps/api
pnpm add fastify pino pino-pretty zod jose drizzle-orm postgres
pnpm add -D tsx typescript @types/node drizzle-kit
```

**tsconfig.json**

```json
{ "compilerOptions": { "target":"ES2022","module":"ESNext","moduleResolution":"Bundler","strict":true,"esModuleInterop":true,"skipLibCheck":true,"outDir":"dist" }, "include":["src"] }
```

**drizzle.config.ts**

```ts
import type { Config } from "drizzle-kit";
export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  driver: "pg",
  dbCredentials: { connectionString: process.env.DATABASE_URL! },
} satisfies Config;
```

**.env（開発）**

```
DATABASE_URL=postgres://devuser:devpass@localhost:5432/liffapp
APP_JWT_SECRET=change-me
LINE_CHANNEL_ID=xxxxxxxxxx
```

**src/db/schema.ts（最小）**

```ts
import { pgSchema, pgTable, uuid, text, timestamp, integer } from "drizzle-orm/pg-core";

export const stores = pgTable("stores", {
  storeId: uuid("store_id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Tokyo"),
});

export const members = pgTable("members", {
  memberId: uuid("member_id").defaultRandom().primaryKey(),
  storeId: uuid("store_id").references(() => stores.storeId).notNull(),
  lineUserId: text("line_user_id").notNull(),
  displayName: text("display_name"),
});

export const menus = pgTable("menus", {
  menuId: uuid("menu_id").defaultRandom().primaryKey(),
  storeId: uuid("store_id").references(() => stores.storeId).notNull(),
  name: text("name").notNull(),
  durationMin: integer("duration_min").notNull(),
});

export const reservations = pgTable("reservations", {
  reservationId: uuid("reservation_id").defaultRandom().primaryKey(),
  storeId: uuid("store_id").references(() => stores.storeId).notNull(),
  memberId: uuid("member_id").references(() => members.memberId).notNull(),
  menuId: uuid("menu_id").references(() => menus.menuId).notNull(),
  staffId: uuid("staff_id"),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt:   timestamp("end_at",   { withTimezone: true }).notNull(),
  status:  text("status").notNull(), // confirmed/arrived/done/cancelled/no_show
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
```

**src/db/index.ts**

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
const client = postgres(process.env.DATABASE_URL!, { max: 10 });
export const db = drizzle(client);
```

**EXCLUDE制約**（重複予約防止）はDrizzleから直接は張りづらいので**SQLマイグレーション**で付与：

```bash
pnpm drizzle-kit generate
```

生成後に `drizzle/*.sql` の末尾へ追記して適用：

```sql
create extension if not exists btree_gist;

alter table reservations
  add constraint no_overlap
  exclude using gist (
    staff_id with =,
    tstzrange(start_at, end_at) with &&
  ) where (status in ('confirmed','arrived','done'));
```

適用：

```bash
pnpm drizzle-kit push
```

**src/server.ts（最小API）**

```ts
import Fastify from "fastify";
import { db } from "./db";
import { reservations, members } from "./db/schema";
import { z } from "zod";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";

const app = Fastify({ logger: true });

// Auth: LINE IDトークン→アプリJWT
const JWKS = createRemoteJWKSet(new URL("https://api.line.me/oauth2/v2.1/certs"));
app.post("/auth/line", async (req, reply) => {
  const body = z.object({ id_token: z.string(), store_id: z.string().uuid() }).parse(req.body);
  const { payload } = await jwtVerify(body.id_token, JWKS, {
    audience: process.env.LINE_CHANNEL_ID,
    issuer: "https://access.line.me",
  });
  const lineUserId = String(payload.sub);
  // 会員UPSERT（簡略）
  await db.execute(`
    insert into members (store_id, line_user_id) 
    values ('${body.store_id}', '${lineUserId}')
    on conflict (store_id, line_user_id) do nothing;
  `);
  const token = await new SignJWT({ sub: lineUserId, store_id: body.store_id })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(new TextEncoder().encode(process.env.APP_JWT_SECRET!));
  return reply.send({ token });
});

// 認証フック
app.addHook("onRequest", async (req, reply) => {
  if (req.routerPath?.startsWith("/auth")) return;
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (!token) return reply.code(401).send();
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.APP_JWT_SECRET!), {
      issuer: "your-app", audience: "liff", algorithms: ["HS256"], // 署名と発行者は合わせる
    }).catch(() => jwtVerify(token, new TextEncoder().encode(process.env.APP_JWT_SECRET!)));
    (req as any).auth = payload;
  } catch {
    return reply.code(401).send();
  }
});

// 予約作成（Idempotencyは簡略化）
app.post("/reservations", async (req, reply) => {
  const auth = (req as any).auth as { store_id: string; sub: string };
  const body = z.object({
    store_id: z.string().uuid(),
    member_id: z.string().uuid().optional(), // 無ければ sub から引く実装に
    menu_id: z.string().uuid(),
    staff_id: z.string().uuid().optional(),
    start_at: z.string(),
    end_at: z.string().optional(),
  }).parse(req.body);

  // … duration から end_at を算出するなど

  try {
    const r = await db.execute(/*sql*/`
      insert into reservations (store_id, member_id, menu_id, staff_id, start_at, end_at, status)
      values ('${body.store_id}', (select member_id from members where store_id='${body.store_id}' and line_user_id='${auth.sub}' limit 1),
              '${body.menu_id}', ${body.staff_id ? `'${body.staff_id}'` : 'null'},
              '${body.start_at}', '${body.end_at ?? body.start_at}', 'confirmed')
      returning reservation_id, store_id, member_id, menu_id, staff_id, start_at, end_at, status
    `);
    return reply.send(r);
  } catch (e: any) {
    if (String(e?.message).includes("no_overlap")) return reply.code(409).send({ error: "time_overlap" });
    throw e;
  }
});

app.get("/reservations", async (req, reply) => {
  const q = req.query as any;
  const rows = await db.execute(/*sql*/`
    select reservation_id, store_id, member_id, menu_id, staff_id, start_at, end_at, status
    from reservations
    where store_id='${q.store_id}'
      and start_at >= '${q.from}' and start_at < '${q.to}'
    order by start_at asc
  `);
  return reply.send(rows); // ← フラット配列
});

app.listen({ port: 8787 });
```

> ここまでで **/auth/line → /reservations** の“価値の最短経路”が完成。

---

# 4. LIFF（Vite）側を実装

```bash
cd ../../apps/liff-web
pnpm add ky zod
```

**index.html**（HEADにSDKを追加）

```html
<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
```

**.env**

```
VITE_LIFF_ID=xxxx-your-liff-id
VITE_API_BASE=http://localhost:8787
VITE_STORE_ID=00000000-0000-0000-0000-000000000000
```

**src/lib/api.ts**

```ts
import ky from "ky";
const base = import.meta.env.VITE_API_BASE as string;
export const api = ky.create({ prefixUrl: base });
```

**src/hooks/useLiff.ts**

```ts
import { useEffect, useState } from "react";
export function useLiff() {
  const [ready, setReady] = useState(false);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);
  useEffect(() => {
    (async () => {
      await (window as any).liff.init({ liffId: import.meta.env.VITE_LIFF_ID });
      if (!(window as any).liff.isLoggedIn()) (window as any).liff.login();
      setProfile(await (window as any).liff.getProfile());
      setIdToken((window as any).liff.getIDToken());
      setReady(true);
    })();
  }, []);
  return { ready, idToken, profile };
}
```

**src/hooks/useAuth.ts**

```ts
import { useEffect, useState } from "react";
import { api } from "../lib/api";
export function useAuth(idToken: string | null) {
  const [jwt, setJwt] = useState<string | null>(null);
  useEffect(() => {
    if (!idToken) return;
    api.post("auth/line", { json: { id_token: idToken, store_id: import.meta.env.VITE_STORE_ID } })
      .json<{ token: string }>()
      .then(r => setJwt(r.token));
  }, [idToken]);
  return jwt;
}
```

**src/pages/Reserve.tsx（最小）**

```tsx
import { useLiff } from "../hooks/useLiff";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";

export default function Reserve() {
  const { ready, idToken } = useLiff();
  const jwt = useAuth(idToken);

  async function createReservation() {
    if (!jwt) return;
    const start = new Date(); start.setHours(start.getHours() + 2);
    await api.post("reservations", {
      headers: { Authorization: `Bearer ${jwt}` },
      json: {
        store_id: import.meta.env.VITE_STORE_ID,
        menu_id: "replace-with-real-menu-uuid",
        start_at: start.toISOString(),
      }
    });
    alert("予約を受け付けました（ダミー）");
  }

  if (!ready) return <p>Loading...</p>;
  return (
    <main className="p-4">
      <h1>予約デモ</h1>
      <button onClick={createReservation}>2時間後に予約する</button>
    </main>
  );
}
```

ルーティングは `react-router` を使って `/reserve`・`/ticket` を作ればOK。

---

# 5. LINE Developers 設定（10分）

1. **Provider作成** → **LINE Login チャネル**を作成
2. **LIFFを追加**：エンドポイント＝`https://<hosting>/`（開発は ngrok でOK）
3. **Channel ID** を `.env` の `LINE_CHANNEL_ID` に設定
4. **LIFF ID** をフロント `.env` の `VITE_LIFF_ID` に設定
5. テスト：自分のLINEから LIFF URL を開き、`/reserve` で予約POSTが通ることを確認

> Messaging API（Push通知）や Webhook は **MVP後半**でOK。まずは予約→DB登録の価値を先に出す。

---

# 6. 通知（前日・直前）を足す

**考え方**

* 予約作成時に `notification_jobs` を2件作成（24h前/2h前）
* 開発中は **node-cron** で1分毎にポーリング、商用で **Cloud Tasks/Scheduler** に置き換え

**簡易ワーカー（apps/api/src/worker.ts）**

```ts
import { db } from "./db";
import ky from "ky"; // Messaging API呼び出し用（実際は公式SDKでもOK）
import cron from "node-cron";

cron.schedule("* * * * *", async () => {
  const now = new Date();
  const rows = await db.execute(/*sql*/`
    update notification_jobs
    set status='sent'
    where status='scheduled' and scheduled_at <= now()
    returning job_id, type, reservation_id, store_id
  `);
  for (const r of rows as any[]) {
    // ここで LINE Push を実行（Messaging API のチャネル/トークンが必要）
    // await ky.post("https://api.line.me/v2/bot/message/push", { headers: {...}, json: {...} });
    console.log("sent", r.job_id, r.type);
  }
});
```

---

# 7. デプロイ（最小）

**API を Cloud Run に**

* Dockerfile（apps/api/Dockerfile）

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm fetch
COPY apps/api ./apps/api
WORKDIR /app/apps/api
RUN pnpm install --offline && pnpm build || true
CMD ["node","dist/server.js"]
```

* 環境変数：`DATABASE_URL`（Cloud SQL接続文字列 or 連携）、`APP_JWT_SECRET`、`LINE_CHANNEL_ID`
* ポート：`8787` を `PORT` に合わせる or 3000 に変更

**LIFF（Vite）を静的ホスティング**

* Cloudflare Pages / Firebase Hosting / Netlify のどれかで `apps/liff-web/dist` を公開
* そのURLを **LIFFエンドポイント**に設定（HTTPS必須）

---

# 8. 観測・安全運用の“最小”

* **ログ**：Fastifyの pino で構造化（`req_id, store_id, action`）
* **バックアップ**：Cloud SQL or pg\_dumpの**日次**
* **監査**：変更系は `audit_logs` に記録
* **Secrets**：チャネルシークレット/アクセストークンは**環境変数**＋マネージド秘匿（GCP Secret Managerなど）

---

# 9. フラットAPIの作法（再掲）

* **GET一覧**は **配列**で返す（ネストしない）
* ページングは `?limit=50&cursor=...`（`reservation_id|start_at`）
* 作成系は **Idempotency-Key**（ヘッダ）対応で二重送信に強く
* **タイムゾーンは全て+09:00** を明示、DBは `timestamptz` で保存

---

# 10. 1〜3週間の“動かす順序”

1. **/auth/line**（IDトークン検証→app\_jwt）
2. **/reservations**（POST/GET）＋ **LIFFの予約ボタン**
3. 管理側の**当日一覧**（admin-web の `/today`）
4. **通知ジョブ**（簡易cron→Cloud Tasksへ移行）
5. **Webhook**（ブロック時に Push 停止・キーワード返答）
6. 決済（Stripeの予約金/キャンセル料）※必要なら

---
