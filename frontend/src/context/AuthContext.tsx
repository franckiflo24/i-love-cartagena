import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { forgetLocalHomeBase } from '../lib/homeBase';

const saveToken = async (token: string) => {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem('session_token', token);
    try { sessionStorage.setItem('session_token', token); } catch {}
  } else {
    await SecureStore.setItemAsync('session_token', token);
  }
};

const getToken = async (): Promise<string | null> => {
  if (Platform.OS === 'web') {
    const token = await AsyncStorage.getItem('session_token');
    if (token) return token;
    try {
      const ss = sessionStorage.getItem('session_token');
      if (ss) {
        await AsyncStorage.setItem('session_token', ss);
        return ss;
      }
    } catch {}
    return null;
  }
  return SecureStore.getItemAsync('session_token');
};

const removeToken = async () => {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem('session_token');
    try { sessionStorage.removeItem('session_token'); } catch {}
  } else {
    await SecureStore.deleteItemAsync('session_token');
  }
};

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || '';

// Auth calls go SAME-ORIGIN on web (/api/auth/* → backend via the vercel.json
// rewrite) so the session cookie is FIRST-PARTY and survives iOS Safari's ITP
// (which wipes localStorage + blocks third-party cookies). Native keeps the
// absolute backend URL. This is what makes "open the app → already logged in" work.
const AUTH_BASE = (Platform.OS === 'web' ? '' : (BACKEND_URL || '')) + '/api/auth';

type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string;
  provider?: string;
  phone?: string;
  is_admin?: boolean;
  onboarding_completed?: boolean;
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  authError: string | null;
  login: () => Promise<void>;
  loginWithToken: (sessionToken: string, userData: User) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearAuthError: () => void;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  authError: null,
  login: async () => {},
  loginWithToken: async () => {},
  logout: async () => {},
  checkAuth: async () => {},
  clearAuthError: () => {},
});

export const useAuth = () => useContext(AuthContext);

// ── Google OAuth: capture id_token from hash ─────────────────
// Runs at MODULE LOAD TIME (before React renders).
//
// KEY: persist the token to sessionStorage SYNCHRONOUSLY so it survives
// React tree remounts caused by Expo Router's <Redirect /> from / to /(tabs).
// Without this, the redirect unmounts AuthProvider mid-exchange, the module
// variable is already consumed (null), and the new AuthProvider instance
// falls through to checkAuth which finds no session yet → user appears
// logged out. On the SECOND login the session from attempt #1 exists in
// localStorage and checkAuth picks it up — hence "login twice" bug.
const SS_TOKEN_KEY = '__google_id_token_pending';

if (typeof window !== 'undefined' && Platform.OS === 'web') {
  const hash = window.location.hash;
  const fullUrl = window.location.href;

  let idToken: string | null = null;

  if (hash && hash.includes('id_token=')) {
    const params = new URLSearchParams(hash.substring(1));
    idToken = params.get('id_token');
  } else if (fullUrl.includes('#id_token=')) {
    const hashIdx = fullUrl.indexOf('#');
    if (hashIdx >= 0) {
      const params = new URLSearchParams(fullUrl.substring(hashIdx + 1));
      idToken = params.get('id_token');
    }
  }

  if (idToken) {
    // Persist to sessionStorage SYNCHRONOUSLY — survives React remounts
    try { sessionStorage.setItem(SS_TOKEN_KEY, idToken); } catch {}
    window.history.replaceState(null, '', window.location.pathname);
  }

  // Check for Google OAuth error in hash (e.g. #error=access_denied)
  if (hash && hash.includes('error=')) {
    const params = new URLSearchParams(hash.substring(1));
    const err = params.get('error');
    const desc = params.get('error_description');
    try { sessionStorage.setItem('__google_auth_error', desc || err || 'Unknown OAuth error'); } catch {}
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
  const [authError, setAuthError] = useState<string | null>(null);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  const loginWithToken = useCallback(async (sessionToken: string, userData: User) => {
    await saveToken(sessionToken);
    await AsyncStorage.setItem('user_data', JSON.stringify(userData));
    setUser(userData);
    setAuthError(null);
    setIsLoading(false);
  }, []);

  const exchangeGoogleToken = useCallback(async (idToken: string) => {
    try {
      const res = await fetch(`${AUTH_BASE}/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: idToken }),
        credentials: 'include',
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        const msg = detail?.detail || `Error ${res.status}`;
        console.error('[AuthContext] Google auth failed:', res.status, msg);
        setAuthError(`Login con Google falló: ${msg}`);
        return null;
      }
      const data = await res.json();
      if (data.session_token && data.user) {
        await loginWithToken(data.session_token, data.user);
        await AsyncStorage.removeItem('google_auth_pending');
        return data;
      }
      setAuthError('Respuesta inesperada del servidor');
      return null;
    } catch (e: any) {
      const msg = e?.message || 'Error de conexión';
      console.error('[AuthContext] Google token exchange error:', e);
      setAuthError(`Login con Google falló: ${msg}`);
      return null;
    }
  }, [loginWithToken]);

  const checkAuth = useCallback(async () => {
    const token = await getToken();
    try {
      // ALWAYS ask /auth/me — with the Bearer token if we still have one, otherwise
      // rely purely on the first-party session cookie. On iOS Safari the cookie
      // survives even after ITP wiped localStorage, so the user stays logged in and
      // the app opens "already ready". A 200 also returns a fresh session_token we
      // re-save locally so the cross-origin data calls keep working.
      const res = await fetch(`${AUTH_BASE}/me`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      if (res.ok) {
        const userData = await res.json();
        setUser(userData);
        await AsyncStorage.setItem('user_data', JSON.stringify(userData));
        if (userData.session_token) { try { await saveToken(userData.session_token); } catch { /* noop */ } }
        setIsLoading(false);
        return;
      }
      if (res.status === 401 || res.status === 403) {
        // Session genuinely gone (no valid token AND no valid cookie) → clear.
        await removeToken();
        await AsyncStorage.removeItem('user_data');
        setUser(null);
        setIsLoading(false);
        return;
      }
      throw new Error(`auth/me ${res.status}`); // 5xx / transient → fall through to cache
    } catch (e) {
      // Network / transient error → keep the user optimistically from cache; never
      // log someone out over a blip.
      try {
        const cached = await AsyncStorage.getItem('user_data');
        const parsed = cached ? JSON.parse(cached) : null;
        setUser(parsed?.user_id || parsed?.email ? parsed : null);
      } catch { setUser(null); }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      // Read from sessionStorage — survives React remounts from Expo Router redirects
      let pendingIdToken: string | null = null;
      let pendingError: string | null = null;
      if (Platform.OS === 'web') {
        try {
          pendingIdToken = sessionStorage.getItem(SS_TOKEN_KEY);
          pendingError = sessionStorage.getItem('__google_auth_error');
        } catch {}
      }

      // Surface OAuth error
      if (pendingError) {
        try { sessionStorage.removeItem('__google_auth_error'); } catch {}
        setAuthError(pendingError);
        await AsyncStorage.removeItem('google_auth_pending');
        await checkAuth();
        return;
      }

      // Exchange Google id_token
      if (pendingIdToken) {
        // Consume it — only the first AuthProvider instance to reach here will exchange
        try { sessionStorage.removeItem(SS_TOKEN_KEY); } catch {}
        await exchangeGoogleToken(pendingIdToken);
        await AsyncStorage.removeItem('google_auth_pending');
        setIsLoading(false);
        return;
      }

      // Detect failed Google redirect (hash was stripped)
      if (Platform.OS === 'web') {
        const pending = await AsyncStorage.getItem('google_auth_pending');
        if (pending) {
          await AsyncStorage.removeItem('google_auth_pending');
          setAuthError('Login con Google no completó. Intenta de nuevo o usa email/WhatsApp.');
        }
      }

      await checkAuth();
    };
    init();
  }, []);

  const login = useCallback(async () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      await AsyncStorage.setItem('google_auth_pending', 'true');
      setAuthError(null);
      window.location.href = buildGoogleAuthUrl();
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      const token = await getToken();
      await fetch(`${AUTH_BASE}/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token || ''}` },
        credentials: 'include',
      }).catch(() => {});
    } catch (e) { console.error('[AuthContext] logout failed', e); }
    await removeToken();
    await AsyncStorage.removeItem('user_data');
    // Drop the local Mi Base cache so the next account on this device doesn't
    // inherit it (their own base still lives on their account).
    try { forgetLocalHomeBase(); } catch { /* noop */ }
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, authError, login, loginWithToken, logout, checkAuth, clearAuthError }}>
      {children}
    </AuthContext.Provider>
  );
};
