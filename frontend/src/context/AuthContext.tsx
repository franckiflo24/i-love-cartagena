import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as Google from 'expo-auth-session/providers/google';

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

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: GOOGLE_CLIENT_ID,
  });

  const exchangeGoogleToken = useCallback(async (idToken: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id_token: idToken }),
      });
      if (!res.ok) throw new Error('Google auth failed');
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
      }
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
