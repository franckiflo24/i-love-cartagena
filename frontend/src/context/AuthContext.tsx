import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

// Ensure browser session completes on web
if (Platform.OS === 'web') {
  WebBrowser.maybeCompleteAuthSession();
}

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

const discovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

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

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On web, redirect back to our own origin so we don't depend on auth.expo.io proxy
  const redirectUri = Platform.OS === 'web' && typeof window !== 'undefined'
    ? window.location.origin
    : AuthSession.makeRedirectUri({ preferLocalhost: false });

  // Stable nonce — must not change between renders or useAuthRequest loops infinitely
  const nonce = React.useMemo(() => Math.random().toString(36).substring(2), []);

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: GOOGLE_CLIENT_ID,
      scopes: ['openid', 'profile', 'email'],
      responseType: AuthSession.ResponseType.IdToken,
      redirectUri,
      usePKCE: false,
      extraParams: { nonce },
    },
    discovery
  );

  const exchangeGoogleToken = useCallback(async (idToken: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id_token: idToken }),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error('[AuthContext] Google auth response:', res.status, err);
        throw new Error('Google auth failed');
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

  // Handle Google auth response
  useEffect(() => {
    if (response?.type === 'success') {
      const idToken = response.params?.id_token;
      if (idToken) {
        exchangeGoogleToken(idToken);
      } else {
        console.error('[AuthContext] No id_token in response params:', response.params);
      }
    } else if (response?.type === 'error') {
      console.error('[AuthContext] Auth error:', response.error);
    }
  }, [response, exchangeGoogleToken]);

  const checkAuth = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) {
        const cached = await AsyncStorage.getItem('user_data');
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (parsed?.provider === 'email_local' || parsed?.provider === 'whatsapp_local') {
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
        credentials: 'include',
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

  useEffect(() => {
    checkAuth();
  }, []);

  const login = useCallback(async () => {
    promptAsync();
  }, [promptAsync]);

  const logout = useCallback(async () => {
    try {
      const token = await getToken();
      await fetch(`${BACKEND_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token || ''}` },
        credentials: 'include',
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
