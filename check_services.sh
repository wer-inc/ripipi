#\!/bin/bash
echo "=== Ripipi サービス状態確認 ==="
echo ""
echo "1. APIサーバー (ポート 8787):"
if curl -s http://localhost:8787/health > /dev/null 2>&1; then
    echo "   ✅ 起動中"
else
    echo "   ❌ 停止中"
fi

echo ""
echo "2. 管理画面 (ポート 5174):"
if curl -s http://localhost:5174 > /dev/null 2>&1; then
    echo "   ✅ 起動中"
else
    echo "   ❌ 停止中"
fi

echo ""
echo "3. PostgreSQL (ポート 5432):"
if nc -z localhost 5432 2>/dev/null; then
    echo "   ✅ 起動中"
else
    echo "   ❌ 停止中"
fi

echo ""
echo "4. 実行中のプロセス:"
ps aux | grep -E "(vite|tsx|postgres)" | grep -v grep | awk '{print "   - " $11}'
