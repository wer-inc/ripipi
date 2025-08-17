import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContextNew';
import { ProtectedRoute } from './components/ProtectedRoute';

// ローディングコンポーネント
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
      <p className="mt-4 text-sm text-muted-foreground">読み込み中...</p>
    </div>
  </div>
);

// レイジーロード（コード分割）
const AdminLayout = lazy(() => import('./layouts/AdminLayout'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const TodayReservations = lazy(() => import('./pages/TodayReservations'));
const MenuSettings = lazy(() => import('./pages/MenuSettings'));
const Reservations = lazy(() => import('./pages/Reservations'));
const Customers = lazy(() => import('./pages/Customers'));
const Settings = lazy(() => import('./pages/Settings'));
const Login = lazy(() => import('./pages/Login'));

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            {/* Alias for environments accessing /login@admin-web */}
            <Route path="/login@admin-web" element={<Login />} />
            <Route path="/login@admin-web/*" element={<Login />} />
            
            {/* Protected routes */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AdminLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="today" element={<TodayReservations />} />
              <Route path="menus" element={<MenuSettings />} />
              <Route path="reservations" element={<Reservations />} />
              <Route path="customers" element={<Customers />} />
              <Route path="settings" element={<Settings />} />
            </Route>

            {/* Catch all route */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </Suspense>
    </BrowserRouter>
  );
}

export default App