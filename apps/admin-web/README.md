# Ripipi 管理画面

## 概要
Ripipi予約システムの店舗管理者向けダッシュボードです。

## 機能
- **ダッシュボード**: 本日の予約数、売上、顧客統計を一覧表示
- **本日の予約**: 当日の予約一覧と来店処理（ステータス更新）
- **予約一覧**: 日付範囲を指定して予約を検索・閲覧
- **メニュー設定**: サービスメニューの追加・編集・削除
- **顧客管理**: 顧客情報の閲覧と検索
- **設定**: 店舗設定、通知設定、予約ルールの管理

## 起動方法
```bash
# 開発サーバーの起動（ポート5174）
pnpm dev

# または、ルートディレクトリから
pnpm dev:admin
```

## 環境変数
`.env`ファイルに以下の設定が必要です：
```
VITE_API_URL=http://localhost:8787
VITE_STORE_ID=27ce78c0-5bc1-402c-b667-dc7b2985e0b9
VITE_LIFF_ID=2007919613-YrjmyLL9
```

## アクセス
http://localhost:5174/

## 技術スタック
- React + TypeScript
- Vite
- React Router
- Tailwind CSS
- Lucide Icons
- ky (HTTP client)