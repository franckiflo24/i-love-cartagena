// ── COLORS — Caribbean Spectrum (Option A) — calm navy base, multi-accent ──
// Each surface gets its own Cartagena color instead of one accent driving
// everything: teal = primary/interactive, coral = live/now, mustard = hero/
// premium, bougainvillea = the ❤️ brand pop, blue = official/institutional.
export const COLORS = {
  background: '#0A0E1A',
  backgroundSolid: '#0A0E1A',
  surface: '#141A2A',
  surfaceAlt: '#1C2438',
  surfaceGlass: 'rgba(20, 26, 42, 0.6)',
  primary: '#12B5A5',          // Caribbean teal — the main interactive accent
  primaryHover: '#3ED0C1',
  primaryMuted: '#0C7D72',
  textMain: '#F5F7FA',
  textMuted: '#8A93A6',
  textFaint: '#5E6675',
  border: '#242C3E',
  success: '#15803D',
  warning: '#B45309',
  error: '#DC2626',
  free: '#15803D',
  paid: '#E9B949',             // mustard — premium/paid reads as gold, not alarm
  white: '#FFFFFF',
  black: '#000000',
  goldGlow: 'rgba(18, 181, 165, 0.25)',  // teal glow (key name kept for consumers)

  // ── Multi-accent system (Caribbean Spectrum) ──
  teal: '#12B5A5',             // search, map, nav-active, chevrons, general CTA
  coral: '#FF6B4A',            // live / "right now" / urgent-but-friendly
  mustard: '#E9B949',          // hero eyebrows, premium, featured
  bougainvillea: '#E5476D',    // the ❤️ brand pop of pink-red
  official: '#39B8FF',         // official / institutional / verified
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
  goldGlow: { shadowColor: '#12B5A5', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 6 },
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
  beauty: 'Belleza',
  activity: 'Experiencia',
  hotel: 'Hotel',
  spa: 'Spa',
  wellness: 'Wellness',
  bar: 'Bar',
  cafe: 'Café',
  beach_club: 'Beach Club',
  club: 'Club',
  nightlife: 'Nightlife',
  yacht: 'Yate',
  attraction: 'Atracción',
  service: 'Servicio',
  institutional: 'Institucional',
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
    main: '#E9B949',
    bg: 'rgba(233, 185, 73, 0.15)',
    border: 'rgba(233, 185, 73, 0.5)',
    gradient: ['#B8923A', '#E9B949'],
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

