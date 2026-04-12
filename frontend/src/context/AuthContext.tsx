import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string;
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  login: async () => {},
  logout: async () => {},
  checkAuth: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const exchangeSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ session_id: sessionId }),
      });
      if (!res.ok) throw new Error('Session exchange failed');
      const data = await res.json();
      if (data.session_token) {
        await AsyncStorage.setItem('session_token', data.session_token);
      }
      if (data.user) {
        setUser(data.user);
        await AsyncStorage.setItem('user_data', JSON.stringify(data.user));
      }
      return data;
    } catch (e) {
      console.error('Exchange session error:', e);
      return null;
    }
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('session_token');
      if (!token) {
        setUser(null);
        setIsLoading(false);
        return;
      }
      const res = await fetch(`${BACKEND_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (res.ok) {
        const userData = await res.json();
        setUser(userData);
        await AsyncStorage.setItem('user_data', JSON.stringify(userData));
      } else {
        await AsyncStorage.removeItem('session_token');
        await AsyncStorage.removeItem('user_data');
        setUser(null);
      }
    } catch {
      const cached = await AsyncStorage.getItem('user_data');
      if (cached) setUser(JSON.parse(cached));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      // Check for session_id in URL hash (web only)
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const hash = window.location.hash;
        if (hash.includes('session_id=')) {
          const sessionId = hash.split('session_id=')[1]?.split('&')[0];
          if (sessionId) {
            await exchangeSession(sessionId);
            window.history.replaceState(null, '', window.location.pathname);
            setIsLoading(false);
            return;
          }
        }
      }
      await checkAuth();
    };
    init();
  }, []);

  const login = useCallback(async () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
      const redirectUrl = window.location.origin;
      window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
    } else {
      const redirectUri = Linking.createURL('/');
      const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUri)}`;
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);
      if (result.type === 'success' && result.url) {
        const sessionId = result.url.split('session_id=')[1]?.split('&')[0];
        if (sessionId) {
          await exchangeSession(sessionId);
        }
      }
    }
  }, [exchangeSession]);

  const logout = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('session_token');
      await fetch(`${BACKEND_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token || ''}` },
        credentials: 'include',
      });
    } catch {}
    await AsyncStorage.removeItem('session_token');
    await AsyncStorage.removeItem('user_data');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
};
