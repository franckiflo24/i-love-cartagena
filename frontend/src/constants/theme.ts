// ── COLORS — Dark luxury, void/gold ──
export const COLORS = {
  background: '#0A0A0F',
  backgroundSolid: '#0A0A0F',
  surface: '#14141C',
  surfaceAlt: '#1C1C26',
  surfaceGlass: 'rgba(20, 20, 28, 0.6)',
  primary: '#D4AF37',
  primaryHover: '#E5C04B',
  primaryMuted: '#8A7228',
  textMain: '#FFFFFF',
  textMuted: '#9CA3AF',
  textFaint: '#6B7280',
  border: '#2A2A36',
  success: '#15803D',
  warning: '#B45309',
  error: '#DC2626',
  free: '#15803D',
  paid: '#D4AF37',
  white: '#FFFFFF',
  black: '#000000',
  goldGlow: 'rgba(212, 175, 55, 0.25)',
};

// ── SPACING — 8-point grid ──
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

// ── RADIUS ──
export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
};

// ── FONTS ──
export const FONTS = {
  regular: { fontWeight: '400' as const },
  medium: { fontWeight: '500' as const },
  semibold: { fontWeight: '600' as const },
  bold: { fontWeight: '700' as const },
  light: { fontWeight: '300' as const },
};

// ── ELEVATION — subtle glow on dark, not drop shadow ──
export const ELEVATION = {
  card: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 4 },
  sheet: { shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.5, shadowRadius: 24, elevation: 8 },
  goldGlow: { shadowColor: '#D4AF37', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 6 },
};

// ── MOTION ──
export const MOTION = {
  fast: 150,
  base: 250,
  spring: { tension: 180, friction: 22 },
  pressScale: 0.97,
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  sunset: 'Sunset',
  concert: 'Concierto',
  wellness: 'Wellness',
  brunch: 'Brunch',
  beach_club: 'Beach Club',
  after_party: 'After Party',
  cultural: 'Cultural',
  candlelight: 'Candlelight',
  pop_up: 'Pop-Up',
};

export const EVENT_TYPE_ICONS: Record<string, string> = {
  sunset: 'weather-sunset',
  concert: 'music',
  wellness: 'meditation',
  brunch: 'food',
  beach_club: 'beach',
  after_party: 'party-popper',
  cultural: 'palette',
  candlelight: 'candle',
  pop_up: 'store',
};

export const PARTNER_CATEGORY_LABELS: Record<string, string> = {
  restaurant: 'Restaurante',
  bar: 'Bar',
  cafe: 'Café',
  club: 'Club',
  beach_club: 'Beach Club',
  hotel: 'Hotel',
  spa: 'Spa',
  wellness: 'Wellness',
  activity: 'Experiencia',
  yacht: 'Yate',
  cultural: 'Cultural',
  daypass: 'Pasa Día',
  realestate: 'Alojamiento',
  beauty: 'Belleza',
};

// ── Tier System (perfil de presupuesto del partner) ──
export type Tier = 'popular' | 'premium' | 'elite';

export const TIER_COLORS: Record<Tier, { main: string; bg: string; border: string; gradient: string[] }> = {
  popular: {
    main: '#15803D',
    bg: 'rgba(21, 128, 61, 0.15)',
    border: 'rgba(21, 128, 61, 0.5)',
    gradient: ['#166534', '#15803D'],
  },
  premium: {
    main: '#D4AF37',
    bg: 'rgba(212, 175, 55, 0.15)',
    border: 'rgba(212, 175, 55, 0.5)',
    gradient: ['#8A7228', '#D4AF37'],
  },
  elite: {
    main: '#A855F7',
    bg: 'rgba(168, 85, 247, 0.15)',
    border: 'rgba(168, 85, 247, 0.55)',
    gradient: ['#7E22CE', '#C084FC'],
  },
};

export const TIER_ICONS: Record<Tier, string> = {
  popular: 'leaf',
  premium: 'star',
  elite: 'diamond',
};

