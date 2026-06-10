import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { api, IS_DEMO, type Me } from './api';

interface AuthState {
  me: Me | null;
  loading: boolean;
  runMode: string;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  me: null,
  loading: true,
  runMode: 'mock',
  refresh: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [runMode, setRunMode] = useState('mock');

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>('/api/auth/me'));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' });
    setMe(null);
    if (!IS_DEMO) window.location.href = '/app/login';
  }, []);

  useEffect(() => {
    void refresh();
    if (IS_DEMO) {
      setRunMode('demo');
      return;
    }
    fetch('/healthz')
      .then((r) => r.json())
      .then((h: { mode?: string }) => setRunMode(h.mode ?? 'mock'))
      .catch(() => {});
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ me, loading, runMode, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
