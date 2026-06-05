import { api } from '@/src/constants/api';
import { AgentId } from '@/src/constants/agents';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function askAgent(
  agent: AgentId,
  messages: ChatMessage[],
): Promise<string> {
  try {
    const res = await api.post('/concierge/chat', { agent, messages });
    return (res as any).reply || 'Sin respuesta del concierge.';
  } catch (e) {
    return 'Uy, se me fue la señal un momento. Inténtalo otra vez en un segundo 🙏';
  }
}
