import { AgentId } from '@/src/constants/agents';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { loadCatalog, offlineReply } from '../lib/lunaOffline';
import { quickRecsFromCatalog, type Recommendation } from '../components/concierge/LunaRecs';
import type { Lang } from '../i18n/translations';
import { API_BASE } from '../constants/api';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  provisional?: boolean;   // instant local "quick picks" shown while the LLM answers
  recommendations?: Recommendation[];  // venue/event cards (LunaRecs pipeline)
  suggestions?: string[];              // tappable follow-up prompts from Luna
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

/** The reply text plus Luna's structured payload: actions (e.g. `navigate → agenda`),
 *  recommendation cards and tappable follow-up suggestions. Offline / error fallbacks
 *  carry no actions but DO carry local catalog cards, so the guest always gets real
 *  places — the recording where Luna said "here are the top picks:" over an empty
 *  bubble was this interface dropping `recommendations` on the floor. */
export interface AgentReply {
  reply: string;
  actions: unknown[];
  recommendations: Recommendation[];
  suggestions: string[];
}

/** Local catalog cards for fallback turns — never throws, empty off-intent. */
async function fallbackRecs(query: string, lang: string): Promise<Recommendation[]> {
  try {
    return quickRecsFromCatalog(await loadCatalog(), query, lang as Lang);
  } catch {
    return [];
  }
}

/** Same call as askAgent, keeping Luna's actions so the chat can show the verified-agenda
 *  link (EVENTS-ELITE §13 I2/J5). askAgent keeps its string-only shape for other callers. */
export async function askAgentFull(
  agent: AgentId,
  messages: ChatMessage[],
  lang: string = 'es',
): Promise<AgentReply> {
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
      return { reply: await offlineReply(query), actions: [], recommendations: await fallbackRecs(query, lang), suggestions: [] };
    }
    const data = await res.json();
    if (typeof data?.session_id === 'string') sessionId = data.session_id;
    const a = data?.assistant;
    // /agent/chat sends `content`; /agent/taste sends `message` — accept both forever.
    const reply = a?.content || a?.message || data?.reply || '';
    if (!reply) return { reply: await offlineReply(query), actions: [], recommendations: await fallbackRecs(query, lang), suggestions: [] };
    const actions: unknown[] = Array.isArray(a?.actions) ? a.actions : [];
    const recommendations: Recommendation[] = Array.isArray(a?.recommendations) ? a.recommendations : [];
    const suggestions: string[] = Array.isArray(a?.suggestions) ? a.suggestions.filter((s: unknown) => typeof s === 'string') : [];
    return { reply, actions, recommendations, suggestions };
  } catch (e) {
    // Network down / timeout / offline → real venues from the bundled catalog.
    console.error('[Concierge] falling back to offline catalog:', e);
    return { reply: await offlineReply(query), actions: [], recommendations: await fallbackRecs(query, lang), suggestions: [] };
  }
}

export async function askAgent(
  agent: AgentId,
  messages: ChatMessage[],
  lang: string = 'es',
): Promise<string> {
  return (await askAgentFull(agent, messages, lang)).reply;
}
