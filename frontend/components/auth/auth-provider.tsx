'use client';

import { ApiError, api, type User } from '@/lib/api';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);

  const loadSession = useCallback(async () => {
    try {
      setUser(await api.getCurrentUser());
      setStatus('authenticated');
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) {
        setUser(null);
        setStatus('unauthenticated');
        return;
      }

      try {
        await api.refresh();
        setUser(await api.getCurrentUser());
        setStatus('authenticated');
      } catch {
        setUser(null);
        setStatus('unauthenticated');
      }
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSession();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      login: async (email, password) => {
        const nextUser = await api.login(email, password);
        setUser(nextUser);
        setStatus('authenticated');
      },
      register: async (email, password) => {
        await api.register(email, password);
        const nextUser = await api.login(email, password);
        setUser(nextUser);
        setStatus('authenticated');
      },
      logout: async () => {
        try {
          await api.logout();
        } finally {
          setUser(null);
          setStatus('unauthenticated');
        }
      },
    }),
    [status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}
