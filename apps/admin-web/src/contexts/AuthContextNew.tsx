import React, { createContext, useContext, ReactNode, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<any>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const auth = useAuth();

  // ログイン成功時のナビゲーション
  const loginWithNavigation = async (email: string, password: string) => {
    const result = await auth.login(email, password);
    if (result && result.token) {
      navigate('/');
    }
    return result;
  };

  // ログアウト時のナビゲーション
  const logoutWithNavigation = async () => {
    await auth.logout();
    navigate('/login');
  };

  // 認証状態が変わったときのナビゲーション
  useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      const currentPath = window.location.pathname;
      if (currentPath !== '/login') {
        // ログインページ以外で未認証の場合のみリダイレクト
        // navigate('/login');
      }
    }
  }, [auth.isAuthenticated, auth.isLoading, navigate]);

  return (
    <AuthContext.Provider 
      value={{
        ...auth,
        login: loginWithNavigation,
        logout: logoutWithNavigation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
}