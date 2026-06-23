import { AgentId } from '@/src/constants/agents';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const CONCIERGE_URL = `${BACKEND_URL}/api/concierge/chat`;

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
  try {
    const token = await getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(CONCIERGE_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ agent, messages }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error('[Concierge] API error:', res.status, err);
      return 'Disculpa, tuve un problema. Inténtalo de nuevo.';
    }
    const data = await res.json();
    return data.reply || 'Sin respuesta del concierge.';
  } catch (e) {
    console.error('[Concierge] network error:', e);
    return 'Uy, se me fue la señal un momento. Inténtalo otra vez en un segundo.';
  }
}
