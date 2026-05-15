import AsyncStorage from '@react-native-async-storage/async-storage';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

const getToken = async (): Promise<string | null> => {
  return AsyncStorage.getItem('session_token');
};

const buildHeaders = async (override?: Record<string, string>): Promise<Record<string, string>> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!override?.Authorization) {
    const token = await getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return { ...headers, ...(override || {}) };
};

type Opts = { headers?: Record<string, string> };

export const api = {
  get: async (path: string, opts?: Opts) => {
    const headers = await buildHeaders(opts?.headers);
    const res = await fetch(`${BACKEND_URL}/api${path}`, { headers, credentials: 'include' });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return res.json();
  },
  post: async (path: string, body?: any, opts?: Opts) => {
    const headers = await buildHeaders(opts?.headers);
    const res = await fetch(`${BACKEND_URL}/api${path}`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let msg = `POST ${path} failed: ${res.status}`;
      try {
        const err = await res.json();
        if (err?.detail) msg = err.detail;
      } catch {}
      throw new Error(msg);
    }
    return res.json();
  },
  put: async (path: string, body?: any, opts?: Opts) => {
    const headers = await buildHeaders(opts?.headers);
    const res = await fetch(`${BACKEND_URL}/api${path}`, {
      method: 'PUT',
      headers,
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status}`);
    return res.json();
  },
  patch: async (path: string, body?: any, opts?: Opts) => {
    const headers = await buildHeaders(opts?.headers);
    const res = await fetch(`${BACKEND_URL}/api${path}`, {
      method: 'PATCH',
      headers,
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let msg = `PATCH ${path} failed: ${res.status}`;
      try {
        const err = await res.json();
        if (err?.detail) msg = err.detail;
      } catch {}
      throw new Error(msg);
    }
    return res.json();
  },
  delete: async (path: string, opts?: Opts) => {
    const headers = await buildHeaders(opts?.headers);
    const res = await fetch(`${BACKEND_URL}/api${path}`, {
      method: 'DELETE',
      headers,
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
    return res.json();
  },
};
