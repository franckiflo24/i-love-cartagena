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
    emoji: '🏖️',
    tagline: 'Playa, islas y bienestar',
    accent: '#06B6D4',
    opening:
      'Hola. Soy Maré, su concierge de playa y bienestar. Conozco cada isla, cada spa escondido y cada atardecer sobre el Caribe. ¿Qué tipo de experiencia marítima busca?',
    starterChips: [
      'Un día en las Islas del Rosario',
      'Spas y bienestar en Cartagena',
      'Mejores beach clubs',
    ],
  },
  tino: {
    id: 'tino',
    name: 'Tino',
    emoji: '🍽️',
    tagline: 'Gastronomía curada',
    accent: '#D4AF37',
    opening:
      'Buenas. Soy Tino, su guía gastronómico en Cartagena. Desde ceviches frente al mar hasta cocina de autor en casas coloniales — conozco cada mesa que vale la pena. ¿Cuál es la ocasión?',
    starterChips: [
      'Una cena romántica especial',
      'Los mejores mariscos del Centro',
      'Cenar antes de salir esta noche',
    ],
  },
  ciro: {
    id: 'ciro',
    name: 'Ciro',
    emoji: '🗺️',
    tagline: 'Logística y transporte',
    accent: '#3B82F6',
    opening:
      'Bienvenido. Soy Ciro, su planificador logístico. Le ayudo con transporte, itinerarios, hoteles, el City Pass y todo lo que necesita para moverse por Cartagena sin complicaciones. ¿Qué necesita?',
    starterChips: [
      '¿Cómo llego desde el aeropuerto?',
      'Diseña mi itinerario de 3 días',
      '¿Cómo funciona el City Pass?',
    ],
  },
};

export const AGENT_ORDER: AgentId[] = ['luna', 'mare', 'tino', 'ciro'];
