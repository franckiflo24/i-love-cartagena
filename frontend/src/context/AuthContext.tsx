import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const setToken = async (token: string) => {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem('session_token', token);
  } else {
    await SecureStore.setItemAsync('session_token', token);
  }
};

const getToken = async (): Promise<string | null> => {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem('session_token');
  }
  return SecureStore.getItemAsync('session_token');
};

const removeToken = async () => {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem('session_token');
  } else {
    await SecureStore.deleteItemAsync('session_token');
  }
};

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || '';

type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string;
  is_admin?: boolean;
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

// Build Google OAuth URL for implicit flow (ID token)
function buildGoogleAuthUrl(): string {
  const nonce = Math.random().toString(36).substring(2) + Date.now().toString(36);
  const state = Math.random().toString(36).substring(2);
  const redirectUri = typeof window !== 'undefined' ? window.location.origin : '';
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'id_token',
    scope: 'openid profile email',
    nonce,
    state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// Extract id_token from URL hash after Google redirect
function extractIdTokenFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  if (!hash || !hash.includes('id_token=')) return null;
  const params = new URLSearchParams(hash.substring(1));
  return params.get('id_token');
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const exchangeGoogleToken = useCallback(async (idToken: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: idToken }),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error('[AuthContext] Google auth failed:', res.status, err);
        return null;
      }
      const data = await res.json();
      if (data.session_token) {
        await setToken(data.session_token);
      }
      if (data.user) {
        setUser(data.user);
        await AsyncStorage.setItem('user_data', JSON.stringify(data.user));
      }
      return data;
    } catch (e) {
      console.error('[AuthContext] Google token exchange error:', e);
      return null;
    }
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) {
        // No session token — check for cached user data from a recent login
        const cached = await AsyncStorage.getItem('user_data');
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (parsed?.user_id || parsed?.email) {
              setUser(parsed);
              setIsLoading(false);
              return;
            }
          } catch { /* malformed stored user_data */ }
        }
        setUser(null);
        setIsLoading(false);
        return;
      }
      const res = await fetch(`${BACKEND_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const userData = await res.json();
        setUser(userData);
        await AsyncStorage.setItem('user_data', JSON.stringify(userData));
      } else {
        await removeToken();
        await AsyncStorage.removeItem('user_data');
        setUser(null);
      }
    } catch (e) {
      console.error('[AuthContext] checkAuth failed', e);
      try {
        const cached = await AsyncStorage.getItem('user_data');
        if (cached) setUser(JSON.parse(cached));
      } catch { /* malformed stored user_data */ }
    } finally {
      setIsLoading(false);
    }
  }, []);

  // On mount: check for Google OAuth callback OR existing session
  useEffect(() => {
    const init = async () => {
      // Check if we're returning from Google OAuth (id_token in hash)
      if (Platform.OS === 'web') {
        const idToken = extractIdTokenFromHash();
        if (idToken) {
          // Clean the URL hash so it doesn't persist
          window.history.replaceState(null, '', window.location.pathname);
          await exchangeGoogleToken(idToken);
          setIsLoading(false);
          return;
        }
      }
      // Normal auth check
      await checkAuth();
    };
    init();
  }, []);

  const login = useCallback(async () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // Redirect to Google OAuth consent screen
      // Google will redirect back to our origin with #id_token=... in the hash
      window.location.href = buildGoogleAuthUrl();
    }
    // For native, would use expo-auth-session — not needed for web launch
  }, []);

  const logout = useCallback(async () => {
    try {
      const token = await getToken();
      await fetch(`${BACKEND_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token || ''}` },
      });
    } catch (e) { console.error('[AuthContext] logout call failed', e); }
    await removeToken();
    await AsyncStorage.removeItem('user_data');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
};
