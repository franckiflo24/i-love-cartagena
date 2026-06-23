import { AgentId } from '@/src/constants/agents';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const CONCIERGE_URL = process.env.EXPO_PUBLIC_CONCIERGE_URL || '/api/concierge';

export async function askAgent(
  agent: AgentId,
  messages: ChatMessage[],
): Promise<string> {
  try {
    const res = await fetch(CONCIERGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, messages }),
    });
    if (!res.ok) return 'Disculpa, tuve un problema. Inténtalo de nuevo.';
    const data = await res.json();
    return data.reply || 'Sin respuesta del concierge.';
  } catch { /* network failure — return user-friendly message */
    return 'Uy, se me fue la señal un momento. Inténtalo otra vez en un segundo.';
  }
}
