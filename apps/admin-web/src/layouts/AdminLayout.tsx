import { Link, Outlet, useLocation } from 'react-router-dom';
import { Calendar, Users, Settings, Menu, Home } from 'lucide-react';

export default function AdminLayout() {
  const location = useLocation();
  
  const navItems = [
    { path: '/', label: 'ダッシュボード', icon: Home },
    { path: '/today', label: '当日予約', icon: Calendar },
    { path: '/reservations', label: '予約一覧', icon: Calendar },
    { path: '/customers', label: '顧客管理', icon: Users },
    { path: '/menus', label: 'メニュー設定', icon: Menu },
    { path: '/settings', label: '設定', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white shadow-sm border-b">
        <div className="px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">
            Ripipi 管理画面
          </h1>
          <span className="text-sm text-gray-500">
            Ripipi美容室 渋谷店
          </span>
        </div>
      </header>

      <div className="flex">
        {/* サイドバー */}
        <nav className="w-64 bg-white shadow-sm min-h-[calc(100vh-4rem)]">
          <ul className="py-4">
            {navItems.map(item => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`flex items-center gap-3 px-6 py-3 text-sm font-medium transition-colors ${
                      isActive
                        ? 'text-emerald-600 bg-emerald-50 border-r-2 border-emerald-600'
                        : 'text-gray-700 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* メインコンテンツ */}
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}