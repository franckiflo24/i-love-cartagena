import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../constants/api';

const BIZ_KEY = 'amocartagena_business_token';
const BIZ_DATA_KEY = 'amocartagena_business_data';

// A dropped /business/me during navigation must not read as "logged out" — only a
// definitive auth rejection means the token is actually bad.
const isAuthRejection = (e: any) =>
  /\b401\b|\b403\b|unauthor|invalid|expired|forbidden/i.test((e && e.message) || '');

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
  passcodeLogin: (passcode: string) => Promise<void>;
  signup: (email: string, password: string, name: string, phone: string, nit: string) => Promise<void>;
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
          // Paint the dashboard from cache first so a slow/failed /business/me
          // during navigation never blanks the partner's profile.
          try {
            const cached = await AsyncStorage.getItem(BIZ_DATA_KEY);
            if (cached) { const d = JSON.parse(cached); setBusiness(d.business); setPartner(d.partner); }
          } catch { /* no cache yet */ }
          const data = await api.get('/business/me', { headers: { Authorization: `Bearer ${stored}` } });
          setBusiness(data.business);
          setPartner(data.partner);
          try { await AsyncStorage.setItem(BIZ_DATA_KEY, JSON.stringify({ business: data.business, partner: data.partner })); } catch {}
        }
      } catch (e) {
        // Only clear on a real auth rejection. A network/5xx blip during a
        // partner → main-page navigation must keep the session (Franck: "losing
        // my profile → need to reconnect again").
        if (isAuthRejection(e)) {
          await AsyncStorage.multiRemove([BIZ_KEY, BIZ_DATA_KEY]);
          setToken(null); setBusiness(null); setPartner(null);
        } else {
          console.error('[BusinessAuth] /business/me transient failure — keeping session', e);
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const data = await api.post('/business/login', { email, password });
      setToken(data.token);
      setBusiness(data.business);
      setPartner(data.partner);
      await AsyncStorage.setItem(BIZ_KEY, data.token);
      try { await AsyncStorage.setItem(BIZ_DATA_KEY, JSON.stringify({ business: data.business, partner: data.partner ?? null })); } catch {}
    } catch (e: any) {
      // Surface the REAL reason (wrong password, too many attempts, etc.) so a
      // failed login is diagnosable — the old blanket "no disponible" made a
      // wrong password look like a server outage. Only genuine network/transport
      // failures fall back to the generic offline message.
      const msg = (e && e.message) || '';
      if (/Failed to fetch|NetworkError|Load failed|ECONNREFUSED|timeout/i.test(msg)) {
        throw new Error('Inicio de sesión no disponible en este momento. / Login is not available right now.');
      }
      throw e instanceof Error ? e : new Error(msg || 'Credenciales inválidas');
    }
  };

  // Alcaldía (mayor's office) DEMO — passcode-only entry, no email/password.
  const passcodeLogin = async (passcode: string) => {
    try {
      const data = await api.post('/business/alcaldia/access', { passcode: passcode.trim() });
      setToken(data.token);
      setBusiness(data.business);
      setPartner(data.partner ?? null);
      await AsyncStorage.setItem(BIZ_KEY, data.token);
      try { await AsyncStorage.setItem(BIZ_DATA_KEY, JSON.stringify({ business: data.business, partner: data.partner ?? null })); } catch {}
    } catch (e: any) {
      const msg = (e && e.message) || '';
      if (/Failed to fetch|NetworkError|Load failed|ECONNREFUSED|timeout/i.test(msg)) {
        throw new Error('Acceso no disponible en este momento. / Access not available right now.');
      }
      throw e instanceof Error ? e : new Error(msg || 'Código incorrecto');
    }
  };

  const signup = async (email: string, password: string, name: string, phone: string, nit: string) => {
    // Errors bubble up with the backend's bilingual detail (e.g. "email already
    // has an account") so the signup screen can surface them verbatim.
    const data = await api.post('/business/signup', { email, password, name, phone, nit });
    setToken(data.token);
    setBusiness(data.business);
    setPartner(data.partner ?? null);
    await AsyncStorage.setItem(BIZ_KEY, data.token);
  };

  const logout = async () => {
    if (token) {
      try {
        await api.post('/business/logout', {}, { headers: { Authorization: `Bearer ${token}` } });
      } catch (e) {
        console.error('[BusinessAuth] Logout call failed — clearing local session', e);
      }
    }
    await AsyncStorage.multiRemove([BIZ_KEY, BIZ_DATA_KEY]);
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
    <BusinessAuthContext.Provider value={{ token, business, partner, loading, login, passcodeLogin, signup, logout, refresh, setPartner }}>
      {children}
    </BusinessAuthContext.Provider>
  );
}

export function useBusinessAuth() {
  const ctx = useContext(BusinessAuthContext);
  if (!ctx) throw new Error('useBusinessAuth must be used within BusinessAuthProvider');
  return ctx;
}
