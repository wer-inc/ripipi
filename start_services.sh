#!/bin/bash

echo "Ripipi サービスを起動します..."

# 既存のプロセスを停止
echo "既存のプロセスを停止中..."
pkill -f "tsx watch" 2>/dev/null
pkill -f "vite" 2>/dev/null
sleep 2

# APIサーバーを起動
echo "APIサーバーを起動中..."
cd /home/ubuntu/ripipi/apps/api
nohup pnpm dev > /home/ubuntu/ripipi/logs/api.log 2>&1 &
echo "APIサーバー起動コマンドを実行しました (PID: $!)"

sleep 3

# 管理画面を起動
echo "管理画面を起動中..."
cd /home/ubuntu/ripipi/apps/admin-web
nohup pnpm dev > /home/ubuntu/ripipi/logs/admin.log 2>&1 &
echo "管理画面起動コマンドを実行しました (PID: $!)"

sleep 3

echo ""
echo "サービスの状態を確認中..."
sleep 5

# 状態確認
echo ""
echo "=== サービス状態 ==="
if curl -s http://localhost:8787 > /dev/null 2>&1; then
    echo "✅ APIサーバー: http://localhost:8787"
else
    echo "❌ APIサーバー: 起動失敗"
    echo "ログを確認: tail -f /home/ubuntu/ripipi/logs/api.log"
fi

if curl -s http://localhost:5174 > /dev/null 2>&1; then
    echo "✅ 管理画面: http://localhost:5174"
else
    echo "❌ 管理画面: 起動失敗"
    echo "ログを確認: tail -f /home/ubuntu/ripipi/logs/admin.log"
fi

echo ""
echo "Thunder Compute環境では外部からの直接アクセスに制限があります。"
echo "ローカル環境でのテストを推奨します。"