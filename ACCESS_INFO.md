# Ripipi アクセス情報

## 現在の開発環境

Thunder Compute環境で以下のサービスが起動しています：

### APIサーバー
- 起動状態: ✅ 起動中
- ポート: 8787
- プロセス: tsx watch src/server.ts

### 管理画面
- ディレクトリ: /home/ubuntu/ripipi/apps/admin-web
- ポート: 5174（設定済み）
- 状態: Viteサーバーの起動が必要

## ローカル環境での起動方法

### 1. APIサーバーの起動（すでに起動中）
```bash
cd /home/ubuntu/ripipi
pnpm dev:api
```

### 2. 管理画面の起動
```bash
cd /home/ubuntu/ripipi/apps/admin-web
pnpm dev
```

### 3. LIFFデモアプリの起動
```bash
cd /home/ubuntu/ripipi/apps/liff-demo
pnpm dev
```

## Thunder Compute環境での注意点

Thunder Compute環境では、外部からの直接アクセスに制限がある場合があります。
ローカル環境でのテストには以下の方法を推奨します：

1. SSHトンネリング
2. ngrokなどのトンネリングサービス
3. ローカル環境でのクローンと実行

## 実装済み機能

### 管理画面（/apps/admin-web）
- ダッシュボード：予約統計の表示
- 本日の予約：当日の予約一覧とステータス管理
- 予約一覧：日付範囲での予約検索
- メニュー設定：サービスメニューのCRUD操作
- 顧客管理：顧客情報の閲覧
- 設定：店舗設定、通知設定など

### API（/apps/api）
- 認証エンドポイント：/auth/line
- 予約エンドポイント：/reservations（GET/POST/PATCH）
- メニューエンドポイント：/menus（GET/POST/PATCH/DELETE）
- CORS設定済み（開発環境用）

### データベース
- PostgreSQL（Dockerで起動）
- テストデータ投入済み

## 環境変数設定

各アプリの.envファイルに必要な設定が完了しています：
- LIFF ID: 2007919613-YrjmyLL9
- Channel ID: 2007919613
- Store ID: 27ce78c0-5bc1-402c-b667-dc7b2985e0b9