# Database Scripts

このディレクトリには、データベースのセットアップとマイグレーション実行用のスクリプトが含まれています。

## スクリプト一覧

### 1. migrate.ts
データベースマイグレーション実行スクリプト

**使用方法:**
```bash
# TypeScriptで直接実行
tsx scripts/migrate.ts up         # すべてのマイグレーションを実行
tsx scripts/migrate.ts down       # 最後のマイグレーションをロールバック
tsx scripts/migrate.ts up --verbose  # 詳細ログ付きで実行
tsx scripts/migrate.ts up --dry-run  # 実行内容を確認（実際の変更は行わない）

# npm scriptsを使用
npm run migrate:up                 # すべてのマイグレーションを実行
npm run migrate:down               # 最後のマイグレーションをロールバック
```

**環境変数:**
- `DB_HOST`: データベースホスト（デフォルト: localhost）
- `DB_PORT`: データベースポート（デフォルト: 5432）
- `DB_NAME`: データベース名（デフォルト: ripipi_dev）
- `DB_USER`: データベースユーザー（デフォルト: postgres）
- `DB_PASSWORD`: データベースパスワード（必須）

### 2. setup-db.ts
開発環境用データベース完全セットアップスクリプト

**使用方法:**
```bash
# 基本セットアップ
tsx scripts/setup-db.ts

# データベースをリセットしてセットアップ
tsx scripts/setup-db.ts --reset

# シードデータをスキップ
tsx scripts/setup-db.ts --skip-seeds

# 現在のセットアップを確認
tsx scripts/setup-db.ts --verify

# ヘルプを表示
tsx scripts/setup-db.ts --help
```

**実行内容:**
1. データベースが存在しない場合は作成
2. すべてのマイグレーションを実行
3. シードデータを投入（seeds/ディレクトリのSQLファイル）
4. セットアップの検証

## Seeds ディレクトリ

`/seeds/` ディレクトリには開発・テスト用のシードデータが含まれています：

1. **001_basic_data.sql** - キャンセル理由など基本データ
2. **002_tenants.sql** - サンプルテナント（美容室、医療クリニック、レストラン）
3. **003_users.sql** - テナント管理者・スタッフユーザー
4. **004_services_resources.sql** - サービスとリソース
5. **005_service_resources.sql** - サービス-リソース関係
6. **006_business_hours.sql** - 営業時間設定
7. **007_customers.sql** - サンプル顧客データ
8. **008_sample_bookings.sql** - サンプル予約データ

## セットアップ手順

### 1. 環境変数の設定
`.env`ファイルを編集し、データベース接続情報を設定：

```env
# Database Configuration
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/ripipi_dev
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ripipi_dev
DB_USER=postgres
DB_PASSWORD=your_password

# PostgreSQL Configuration (Docker)
POSTGRES_DB=ripipi_dev
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password
```

### 2. データベースサーバーの起動
Docker Composeを使用している場合：
```bash
docker-compose up -d postgres redis
```

または手動でPostgreSQLサーバーを起動

### 3. データベースセットアップ
```bash
# 完全セットアップ（推奨）
tsx scripts/setup-db.ts

# または段階的に実行
tsx scripts/migrate.ts up        # マイグレーション実行
# シードデータは手動で実行
```

### 4. 検証
```bash
# セットアップ状態の確認
tsx scripts/setup-db.ts --verify

# または直接データベースに接続
psql -h localhost -U postgres -d ripipi_dev
```

## サンプルデータについて

### テナント
- **beauty-salon-tokyo**: 東京の美容室（30分枠、24時間前キャンセル）
- **medical-clinic-osaka**: 大阪の医療クリニック（15分枠、48時間前キャンセル）
- **restaurant-kyoto**: 京都のレストラン（60分枠、1時間前キャンセル）

### ユーザー
各テナントに管理者・スタッフユーザーが設定済み
- パスワード: `password123` (全ユーザー共通、開発用)

### サービス例
- 美容室: ヘアカット、カラーリング、ネイル、フェイシャル
- 医療クリニック: 一般診療、健康診断、血液検査、レントゲン
- レストラン: ランチコース、ディナーコース、個室利用、茶道体験

## トラブルシューティング

### マイグレーションエラー
```bash
# マイグレーション状態の確認
psql -h localhost -U postgres -d ripipi_dev -c "SELECT * FROM pgmigrations ORDER BY id;"

# 手動でマイグレーションをリセット（注意：データが失われます）
tsx scripts/setup-db.ts --reset
```

### 接続エラー
1. データベースサーバーが起動しているか確認
2. `.env`ファイルの接続情報が正しいか確認
3. ファイアウォール設定を確認

### シードデータエラー
```bash
# シードデータのみ再実行
tsx scripts/setup-db.ts --skip-seeds=false
```

## 本番環境での注意事項

**重要**: これらのスクリプトは開発・テスト環境専用です。

本番環境では：
- 適切なバックアップを取得してからマイグレーション実行
- シードデータは実行しない
- セキュアなパスワードを使用
- SSL接続を有効化