import { AgentId } from '@/src/constants/agents';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { offlineReply } from '../lib/lunaOffline';
import { API_BASE } from '../constants/api';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  provisional?: boolean;   // instant local "quick picks" shown while the LLM answers
}

// API_BASE carries the native production fallback (no env on EAS preview builds).
const AGENT_URL = `${API_BASE}/agent/chat`;
// One server-side session per app run so follow-ups keep their context (the old
// client sent only the last message with no session_id → every turn started cold).
let sessionId: string | null = null;

async function getToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem('session_token');
  }
  return SecureStore.getItemAsync('session_token');
}

export async function askAgent(
  agent: AgentId,
  messages: ChatMessage[],
  lang: string = 'es',
): Promise<string> {
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const query = lastUserMsg?.content || '';
  try {
    const token = await getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Timeout so a slow LLM/backend never hangs the user — fall back to the local
    // catalog instead of an endless spinner. Real Sonnet turns take ~11–13s, so the
    // old 12s cut answered "sin conexión" to online users most of the time.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 40000);
    let res: Response;
    try {
      res = await fetch(AGENT_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: query, language: lang, ...(sessionId ? { session_id: sessionId } : {}) }),
        signal: ctrl.signal,
      });
    } finally { clearTimeout(timer); }

    if (!res.ok) {
      console.error('[Concierge] API error:', res.status);
      return offlineReply(query);   // backend errored → still answer from the guide
    }
    const data = await res.json();
    if (typeof data?.session_id === 'string') sessionId = data.session_id;
    const reply = data?.assistant?.content || data?.reply || '';
    return reply || offlineReply(query);
  } catch (e) {
    // Network down / timeout / offline → real venues from the bundled catalog.
    console.error('[Concierge] falling back to offline catalog:', e);
    return offlineReply(query);
  }
}
