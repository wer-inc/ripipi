import { useState, useEffect, useCallback } from 'react';
import apiClient from '../lib/api/unifiedClient';
import { analytics } from '../lib/analytics';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
}

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
    error: null,
  });

  // Check if user is authenticated on mount
  useEffect(() => {
    checkAuth();
  }, []);

  // Listen for unauthorized events from API client
  useEffect(() => {
    const handleUnauthorized = () => {
      setAuthState({
        user: null,
        isLoading: false,
        isAuthenticated: false,
        error: 'Session expired',
      });
      // Navigation will be handled by ProtectedRoute component
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const token = localStorage.getItem('admin_token');
      if (!token) {
        setAuthState({
          user: null,
          isLoading: false,
          isAuthenticated: false,
          error: null,
        });
        return;
      }

      const user = await apiClient.getCurrentUser();
      if (user) {
        setAuthState({
          user: user,
          isLoading: false,
          isAuthenticated: true,
          error: null,
        });
        // アナリティクスユーザー設定
        analytics.setUser(user.id, user.tenantId);
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      setAuthState({
        user: null,
        isLoading: false,
        isAuthenticated: false,
        error: error instanceof Error ? error.message : 'Authentication failed',
      });
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setAuthState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const response = await apiClient.login(email, password);
      console.log('[useAuth] Login response:', response);
      
      // Check for token (either token or accessToken)
      const token = response?.token || response?.accessToken;
      if (token) {
        setAuthState({
          user: response.user || { 
            id: '1', 
            email, 
            name: 'Admin User', 
            role: 'admin', 
            tenantId: 'tenant-1' 
          },
          isLoading: false,
          isAuthenticated: true,
          error: null,
        });
        
        // Return response, navigation will be handled by the component
        return response;
      } else {
        throw new Error('No token received from server');
      }
    } catch (error) {
      console.error('[useAuth] Login error:', error);
      setAuthState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Login failed',
      }));
      throw error;
    }
  }, []);

  const logout = useCallback(async () => {
    setAuthState(prev => ({ ...prev, isLoading: true }));
    
    try {
      await apiClient.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setAuthState({
        user: null,
        isLoading: false,
        isAuthenticated: false,
        error: null,
      });
      // アナリティクスユーザー情報クリア
      analytics.clearUser();
      // Navigation will be handled by the component
    }
  }, []);

  const updateUser = useCallback((user: User) => {
    setAuthState(prev => ({ ...prev, user }));
  }, []);

  return {
    ...authState,
    login,
    logout,
    checkAuth,
    updateUser,
  };
}