import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const saveToken = async (token: string) => {
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
  provider?: string;
  phone?: string;
  is_admin?: boolean;
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  login: () => Promise<void>;
  loginWithToken: (sessionToken: string, userData: User) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  login: async () => {},
  loginWithToken: async () => {},
  logout: async () => {},
  checkAuth: async () => {},
});

export const useAuth = () => useContext(AuthContext);

// ── Google OAuth helpers ──────────────────────────────────────
// Capture id_token from hash AT MODULE LOAD TIME — before React renders.
// This prevents race conditions where a <Redirect/> could change the URL
// before the AuthProvider's useEffect runs.
let _capturedGoogleIdToken: string | null = null;
if (typeof window !== 'undefined' && Platform.OS === 'web') {
  const hash = window.location.hash;
  if (hash && hash.includes('id_token=')) {
    const params = new URLSearchParams(hash.substring(1));
    _capturedGoogleIdToken = params.get('id_token');
    if (_capturedGoogleIdToken) {
      // Clean the hash immediately so it doesn't persist in the URL
      window.history.replaceState(null, '', window.location.pathname);
    }
  }
  // Check for Google OAuth error in hash (e.g. #error=access_denied)
  if (hash && hash.includes('error=')) {
    const params = new URLSearchParams(hash.substring(1));
    const err = params.get('error');
    const desc = params.get('error_description');
    console.error('[AuthContext] Google OAuth error:', err, desc);
    window.history.replaceState(null, '', window.location.pathname);
  }
}

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

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Called by login.tsx after a successful email/WhatsApp/Google login
  // Sets the user in context immediately — no network round-trip needed
  const loginWithToken = useCallback(async (sessionToken: string, userData: User) => {
    await saveToken(sessionToken);
    await AsyncStorage.setItem('user_data', JSON.stringify(userData));
    setUser(userData);
    setIsLoading(false);
  }, []);

  const exchangeGoogleToken = useCallback(async (idToken: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: idToken }),
      });
      if (!res.ok) {
        console.error('[AuthContext] Google auth failed:', res.status);
        return null;
      }
      const data = await res.json();
      if (data.session_token && data.user) {
        await loginWithToken(data.session_token, data.user);
      }
      return data;
    } catch (e) {
      console.error('[AuthContext] Google token exchange error:', e);
      return null;
    }
  }, [loginWithToken]);

  const checkAuth = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) {
        const cached = await AsyncStorage.getItem('user_data');
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (parsed?.user_id || parsed?.email) {
              setUser(parsed);
              setIsLoading(false);
              return;
            }
          } catch { /* malformed */ }
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
      } catch { /* malformed */ }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      // Use the module-level captured token (grabbed before React rendered)
      if (Platform.OS === 'web' && _capturedGoogleIdToken) {
        const idToken = _capturedGoogleIdToken;
        _capturedGoogleIdToken = null; // consume it
        await exchangeGoogleToken(idToken);
        setIsLoading(false);
        return;
      }
      await checkAuth();
    };
    init();
  }, []);

  const login = useCallback(async () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.href = buildGoogleAuthUrl();
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      const token = await getToken();
      await fetch(`${BACKEND_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token || ''}` },
      });
    } catch (e) { console.error('[AuthContext] logout failed', e); }
    await removeToken();
    await AsyncStorage.removeItem('user_data');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, loginWithToken, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
};
