import AsyncStorage from '@react-native-async-storage/async-storage';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

const getToken = async (): Promise<string | null> => {
  return AsyncStorage.getItem('session_token');
};

const authHeaders = async (): Promise<Record<string, string>> => {
  const token = await getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

export const api = {
  get: async (path: string) => {
    const headers = await authHeaders();
    const res = await fetch(`${BACKEND_URL}/api${path}`, { headers, credentials: 'include' });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return res.json();
  },
  post: async (path: string, body?: any) => {
    const headers = await authHeaders();
    const res = await fetch(`${BACKEND_URL}/api${path}`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
    return res.json();
  },
  put: async (path: string, body?: any) => {
    const headers = await authHeaders();
    const res = await fetch(`${BACKEND_URL}/api${path}`, {
      method: 'PUT',
      headers,
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status}`);
    return res.json();
  },
};
