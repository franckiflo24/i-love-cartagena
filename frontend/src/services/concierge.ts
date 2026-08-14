import { AgentId } from '@/src/constants/agents';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { offlineReply } from '../lib/lunaOffline';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const AGENT_URL = `${BACKEND_URL}/api/agent/chat`;

async function getToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem('session_token');
  }
  return SecureStore.getItemAsync('session_token');
}

export async function askAgent(
  agent: AgentId,
  messages: ChatMessage[],
): Promise<string> {
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const query = lastUserMsg?.content || '';
  try {
    const token = await getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Timeout so a slow LLM/backend never hangs the user — fall back to the local
    // catalog after 12s instead of an endless spinner.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let res: Response;
    try {
      res = await fetch(AGENT_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: query, language: 'es' }),
        signal: ctrl.signal,
      });
    } finally { clearTimeout(timer); }

    if (!res.ok) {
      console.error('[Concierge] API error:', res.status);
      return offlineReply(query);   // backend errored → still answer from the guide
    }
    const data = await res.json();
    const reply = data?.assistant?.content || data?.reply || '';
    return reply || offlineReply(query);
  } catch (e) {
    // Network down / timeout / offline → real venues from the bundled catalog.
    console.error('[Concierge] falling back to offline catalog:', e);
    return offlineReply(query);
  }
}
