import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, post } from './api';

const AuthContext = createContext(null);
const AUTH_STORAGE_KEY = 'northstar:auth-change';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const result = await api('/auth/me');
      setUser(result.data.user);
      return result.data.user;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();

    try {
      if ('BroadcastChannel' in window) {
        channelRef.current = new BroadcastChannel('northstar-auth');
        channelRef.current.onmessage = (event) => {
          if (event.data?.type === 'signed-out') setUser(null);
          else refresh();
        };
      }
    } catch {
      channelRef.current = null;
    }

    const handleStorage = (event) => {
      if (channelRef.current || event.key !== AUTH_STORAGE_KEY || !event.newValue) return;
      try {
        const change = JSON.parse(event.newValue);
        if (change.type === 'signed-out') setUser(null);
        else refresh();
      } catch {
        refresh();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, [refresh]);

  const publishAuthChange = (type) => {
    channelRef.current?.postMessage({ type });
    try {
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ type, at: Date.now(), nonce: Math.random() }));
    } catch {
      // BroadcastChannel still syncs tabs when local storage is unavailable.
    }
  };

  const value = useMemo(() => ({
    user,
    loading,
    refresh,
    async signIn(email, password) {
      const result = await post('/auth/login', { email, password });
      setUser(result.data.user);
      publishAuthChange('signed-in');
      return result.data.user;
    },
    async signUp(name, email, password) {
      const result = await post('/auth/signup', { name, email, password });
      setUser(result.data.user);
      publishAuthChange('signed-in');
      return result.data.user;
    },
    async signOut() {
      setUser(null);
      publishAuthChange('signed-out');
      try { await post('/auth/logout', {}); } catch { /* Keep the local sign-out responsive if the API is unavailable. */ }
    },
  }), [user, loading, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
