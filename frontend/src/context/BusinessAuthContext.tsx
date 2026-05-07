import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../constants/api';

const BIZ_KEY = 'amocartagena_business_token';

type BusinessUser = {
  business_id: string;
  email: string;
  partner_id: string;
  full_name: string;
  role: string;
};

type Partner = any;

interface BusinessAuthContextType {
  token: string | null;
  business: BusinessUser | null;
  partner: Partner | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setPartner: (p: Partner) => void;
}

const BusinessAuthContext = createContext<BusinessAuthContextType | null>(null);

export function BusinessAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [business, setBusiness] = useState<BusinessUser | null>(null);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(BIZ_KEY);
        if (stored) {
          setToken(stored);
          const data = await api.get('/business/me', { headers: { Authorization: `Bearer ${stored}` } });
          setBusiness(data.business);
          setPartner(data.partner);
        }
      } catch {
        // Token invalid / expired → clear
        await AsyncStorage.removeItem(BIZ_KEY);
        setToken(null);
      }
      setLoading(false);
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const data = await api.post('/business/login', { email, password });
    setToken(data.token);
    setBusiness(data.business);
    setPartner(data.partner);
    await AsyncStorage.setItem(BIZ_KEY, data.token);
  };

  const logout = async () => {
    if (token) {
      try { await api.post('/business/logout', {}, { headers: { Authorization: `Bearer ${token}` } }); } catch {}
    }
    await AsyncStorage.removeItem(BIZ_KEY);
    setToken(null);
    setBusiness(null);
    setPartner(null);
  };

  const refresh = async () => {
    if (!token) return;
    const data = await api.get('/business/me', { headers: { Authorization: `Bearer ${token}` } });
    setBusiness(data.business);
    setPartner(data.partner);
  };

  return (
    <BusinessAuthContext.Provider value={{ token, business, partner, loading, login, logout, refresh, setPartner }}>
      {children}
    </BusinessAuthContext.Provider>
  );
}

export function useBusinessAuth() {
  const ctx = useContext(BusinessAuthContext);
  if (!ctx) throw new Error('useBusinessAuth must be used within BusinessAuthProvider');
  return ctx;
}
