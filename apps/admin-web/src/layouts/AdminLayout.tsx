import { Link, Outlet, useLocation } from 'react-router-dom';
import { Calendar, Users, Settings, Menu, Home, LogOut, User, ChevronRight, Bell } from 'lucide-react';
import { useAuthContext } from '../contexts/AuthContextNew';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function AdminLayout() {
  const location = useLocation();
  const { user, logout } = useAuthContext();
  
  const navItems = [
    { path: '/', label: 'ダッシュボード', icon: Home },
    { path: '/today', label: '当日予約', icon: Calendar },
    { path: '/reservations', label: '予約一覧', icon: Calendar },
    { path: '/customers', label: '顧客管理', icon: Users },
    { path: '/menus', label: 'メニュー設定', icon: Menu },
    { path: '/settings', label: '設定', icon: Settings },
  ];

  const handleLogout = async () => {
    if (confirm('ログアウトしますか？')) {
      await logout();
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* ヘッダー */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center">
          <div className="mr-4 hidden md:flex">
            <Link to="/" className="mr-6 flex items-center space-x-2">
              <Calendar className="h-6 w-6" />
              <span className="hidden font-bold sm:inline-block">
                Ripipi 管理画面
              </span>
            </Link>
          </div>
          <div className="flex flex-1 items-center justify-between space-x-2 md:justify-end">
            <nav className="flex items-center space-x-2">
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="通知を確認">
                <Bell className="h-4 w-4" />
                <span className="sr-only">通知</span>
              </Button>
            </nav>
            {user && (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                    <User className="h-4 w-4" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{user.name}</span>
                    <span className="text-xs text-muted-foreground">{user.role}</span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleLogout}
                  aria-label="ログアウト"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  ログアウト
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="container flex-1 items-start md:grid md:grid-cols-[220px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
        {/* サイドバー */}
        <aside className="fixed top-14 z-30 -ml-2 hidden h-[calc(100vh-3.5rem)] w-full shrink-0 overflow-y-auto border-r md:sticky md:block">
          <div className="py-6 pr-6 lg:py-8">
            <nav className="grid items-start gap-2">
              {navItems.map(item => {
                const Icon = item.icon;
                const isActive = item.path === '/' 
                  ? location.pathname === '/' 
                  : location.pathname.startsWith(item.path);
                
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      "group flex items-center rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground",
                      isActive ? "bg-accent text-accent-foreground" : "transparent"
                    )}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* メインコンテンツ */}
        <main className="flex w-full flex-col overflow-hidden py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}