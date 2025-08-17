#!/bin/bash

echo "🔍 Ripipi Admin システム監視"
echo "================================"
echo ""

# Check services
check_service() {
    local port=$1
    local name=$2
    if lsof -i :$port > /dev/null 2>&1; then
        echo "✅ $name (Port $port): Running"
    else
        echo "❌ $name (Port $port): Not Running"
    fi
}

echo "📊 サービスステータス:"
check_service 5174 "Admin Web"
check_service 3000 "Mock Backend API"
check_service 8787 "Main API Server"
check_service 8080 "Test HTML Server"

echo ""
echo "🧪 APIテスト:"
# Test login
response=$(curl -s -X POST http://localhost:3000/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@example.com","password":"password123"}' 2>/dev/null)

if echo "$response" | grep -q "token"; then
    echo "✅ Login API: Working"
else
    echo "❌ Login API: Failed"
fi

echo ""
echo "📝 ログイン情報:"
echo "- URL: http://localhost:5174/login"
echo "- Email: admin@example.com"
echo "- Password: password123"

echo ""
echo "📈 システムリソース:"
echo "- CPU Usage: $(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)%"
echo "- Memory: $(free -h | awk '/^Mem:/ {print $3 " / " $2}')"
echo "- Disk: $(df -h / | awk 'NR==2 {print $3 " / " $2 " (" $5 " used)"}')"
