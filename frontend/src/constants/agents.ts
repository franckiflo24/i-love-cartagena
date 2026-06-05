export type AgentId = 'luna' | 'mare' | 'tino' | 'ciro';

export interface ConciergeAgent {
  id: AgentId;
  name: string;
  emoji: string;
  tagline: string;
  accent: string;
  opening: string;
  starterChips: string[];
}

export const AGENTS: Record<AgentId, ConciergeAgent> = {
  luna: {
    id: 'luna',
    name: 'Luna',
    emoji: '🌙',
    tagline: 'La noche perfecta',
    accent: '#A855F7',
    opening:
      'Bienvenido. Soy Luna, su concierge nocturna. Conozco cada rooftop, cada bar escondido y cada rincón donde Cartagena cobra vida después del atardecer. Cuénteme qué tipo de noche busca.',
    starterChips: [
      'Una noche inolvidable en la ciudad',
      'Cócteles con vista al mar',
      'Música en vivo y ambiente local',
    ],
  },
  mare: {
    id: 'mare',
    name: 'Maré',
    emoji: '🍽️',
    tagline: 'Gastronomía curada',
    accent: '#D4AF37',
    opening:
      'Buenas. Soy Maré, su guía gastronómica en Cartagena. Desde ceviches frente al mar hasta cocina de autor en casas coloniales — conozco cada mesa que vale la pena. ¿Cuál es la ocasión?',
    starterChips: [
      'Una cena romántica especial',
      'Los mejores mariscos del Centro',
      'Cenar antes de salir esta noche',
    ],
  },
  tino: {
    id: 'tino',
    name: 'Tino',
    emoji: '💎',
    tagline: 'Experiencias inteligentes',
    accent: '#15803D',
    opening:
      'Bienvenido. Soy Tino, su asesor de experiencias. Le ayudo a descubrir las mejores ofertas, el City Pass, y cómo aprovechar al máximo cada momento en Cartagena. ¿Qué le interesa?',
    starterChips: [
      '¿Qué experiencias recomienda hoy?',
      'Lo mejor en relación calidad-precio',
      '¿Cómo funciona el City Pass?',
    ],
  },
  ciro: {
    id: 'ciro',
    name: 'Ciro',
    emoji: '🗺️',
    tagline: 'Itinerarios a medida',
    accent: '#3B82F6',
    opening:
      'Bienvenido. Soy Ciro, su planificador personal. Diseño días perfectos en Cartagena — desde el café de la mañana hasta el último cóctel en las murallas. ¿Cuántos días tiene en la ciudad?',
    starterChips: [
      'Diseña mi fin de semana completo',
      'Un día perfecto en Cartagena',
      'Un día de playa en las islas',
    ],
  },
};

export const AGENT_ORDER: AgentId[] = ['luna', 'mare', 'tino', 'ciro'];
