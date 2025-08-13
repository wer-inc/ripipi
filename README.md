# LIFF Reserve - 予約システム

LINE LIFF（LINE Front-end Framework）を使用した予約システムです。
docs/IMPLEMENTATION.mdの仕様に基づいて実装されています。

## プロジェクト構造

```
/home/ubuntu/ripipi/
├── apps/
│   ├── liff-web/      # LIFF用フロントエンド（Vite + React）
│   ├── admin-web/     # 管理画面（Vite + React）
│   ├── landing/       # ランディングページ（Next.js）
│   └── api/           # APIサーバー（Fastify + Drizzle）
├── packages/          # 共通パッケージ（今後追加予定）
├── docker-compose.yaml
├── pnpm-workspace.yaml
└── docs/
    ├── IMPLEMENTATION.md  # 詳細実装仕様
    └── LP.md             # LP仕様書
```

## 実装済み機能

### ✅ 基本インフラ
- [x] モノレポ構造（pnpm workspace）
- [x] PostgreSQL（Docker Compose）
- [x] API（Fastify + Drizzle ORM）
- [x] DBスキーマ（stores, members, menus, reservations, notification_jobs）
- [x] EXCLUDE制約による時間重複防止

### ✅ API実装
- [x] `/auth/line` - LINE IDトークン検証→アプリJWT発行
- [x] `/reservations` (POST) - 予約作成
- [x] `/reservations` (GET) - 予約一覧取得（フラット配列）
- [x] 通知ジョブの自動作成（24時間前・2時間前）

### ✅ LIFF実装
- [x] LIFF SDK統合
- [x] 自動ログイン（`liff.init` → `liff.login`）
- [x] IDトークン取得 → アプリJWT取得
- [x] 予約作成UI（最小実装）

### ✅ 通知システム
- [x] notification_jobsテーブル
- [x] node-cronによるポーリング（1分毎）
- [x] ワーカー実装（開発環境）

### ✅ ランディングページ
- [x] Next.js 15 + TypeScript + Tailwind CSS
- [x] LP.mdの仕様に基づく全セクション実装
- [x] ROI計算ウィジェット（インタラクティブ）
- [x] レスポンシブデザイン（スマホ優先）

## セットアップ手順

### Docker環境（推奨）

#### 1. 環境変数の設定

```bash
cp .env.example .env
# .envファイルを編集して、必要な環境変数を設定
```

#### 2. 開発環境の起動

```bash
# すべてのサービスを起動
make dev

# または個別に操作
docker-compose up -d

# ログを確認
make logs

# サービスの状態を確認
make ps
```

#### 3. データベースのセットアップ

```bash
# マイグレーション実行
make db-migrate

# テストデータ投入
make db-seed
```

#### 4. アクセスURL

- ランディングページ: http://localhost:3000
- APIサーバー: http://localhost:8787
- 管理画面: http://localhost:5174
- LIFFデモ: http://localhost:5173

### ローカル環境（Dockerを使わない場合）

#### 1. 依存関係のインストール

```bash
pnpm install
```

#### 2. データベースの起動

```bash
docker compose up -d db
```

#### 3. 環境変数の設定

**apps/api/.env**:
```
DATABASE_URL=postgres://devuser:devpass@localhost:5432/liffapp
APP_JWT_SECRET=change-me
LINE_CHANNEL_ID=2007919613
```

**apps/admin-web/.env**:
```
VITE_API_URL=http://localhost:8787
VITE_STORE_ID=27ce78c0-5bc1-402c-b667-dc7b2985e0b9
VITE_LIFF_ID=2007919613-YrjmyLL9
```

**apps/liff-demo/.env**:
```
VITE_LIFF_ID=2007919613-YrjmyLL9
VITE_API_URL=http://localhost:8787
VITE_STORE_ID=27ce78c0-5bc1-402c-b667-dc7b2985e0b9
```

#### 4. データベースマイグレーション

```bash
cd apps/api
pnpm drizzle-kit push:pg
```

#### 5. 開発サーバーの起動

```bash
# すべてのサービスを起動（ルートディレクトリから）
pnpm dev

# または個別に起動
pnpm dev:api     # APIサーバー
pnpm dev:admin   # 管理画面
pnpm dev:liff    # LIFFデモ
pnpm dev:landing # ランディングページ
```

## 次のステップ

### 優先度：高
- [ ] 実際のLINE Channel ID/LIFF IDの設定
- [ ] テストデータの投入（stores, menus, staff）
- [ ] 管理画面の実装（当日一覧）
- [ ] Messaging APIとの連携（Push通知）

### 優先度：中
- [ ] 決済機能（Stripe統合）
- [ ] 会員機能（ポイント/回数券）
- [ ] 多言語対応
- [ ] エラーハンドリングの強化

### 優先度：低
- [ ] Cloud Tasks移行
- [ ] 監査ログ
- [ ] CSVエクスポート
- [ ] Webhookハンドラー

## デプロイ

### API（Cloud Run）

```bash
cd apps/api
docker build -t liff-api .
# gcloud run deploy ...
```

### LIFF（静的ホスティング）

```bash
cd apps/liff-web
pnpm build
# dist/をCloudflare Pages等にデプロイ
```

## 技術スタック

- **Frontend**: Vite + React + TypeScript
- **Backend**: Fastify + Drizzle ORM + PostgreSQL
- **認証**: LINE LIFF SDK + JWT（jose）
- **通知**: node-cron（開発）→ Cloud Tasks（本番）
- **デプロイ**: Cloud Run + Cloudflare Pages（予定）