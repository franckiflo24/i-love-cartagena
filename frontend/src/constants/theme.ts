export const COLORS = {
  background: 'rgba(5, 8, 20, 0.45)',
  backgroundSolid: '#050814',
  surface: '#0F1423',
  surfaceGlass: 'rgba(15, 20, 35, 0.6)',
  primary: '#D97706',
  primaryHover: '#F59E0B',
  textMain: '#FAFAF9',
  textMuted: '#A8B2C1',
  border: 'rgba(255, 255, 255, 0.1)',
  success: '#22C55E',
  error: '#EF4444',
  free: '#22C55E',
  paid: '#D97706',
  white: '#FFFFFF',
  black: '#000000',
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};

export const FONTS = {
  regular: { fontWeight: '400' as const },
  medium: { fontWeight: '500' as const },
  semibold: { fontWeight: '600' as const },
  bold: { fontWeight: '700' as const },
  light: { fontWeight: '300' as const },
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
  club: 'Club',
  beach_club: 'Beach Club',
  hotel: 'Hotel',
  wellness: 'Wellness',
  cultural: 'Cultural',
};

// ── Tier System (perfil de presupuesto del partner) ──
export type Tier = 'popular' | 'premium' | 'elite';

export const TIER_COLORS: Record<Tier, { main: string; bg: string; border: string; gradient: string[] }> = {
  popular: {
    main: '#22C55E',
    bg: 'rgba(34, 197, 94, 0.15)',
    border: 'rgba(34, 197, 94, 0.5)',
    gradient: ['#16A34A', '#22C55E'],
  },
  premium: {
    main: '#D97706',
    bg: 'rgba(217, 119, 6, 0.15)',
    border: 'rgba(217, 119, 6, 0.55)',
    gradient: ['#B45309', '#F59E0B'],
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

export const IMAGES = {
  hero: 'https://static.prod-images.emergentagent.com/jobs/32dad071-4fb0-440b-90c6-bb16ae39bea1/images/2dee6fa4415e057ea67df10585454bc47023ea1133b28fa1c91e8ee307f1d323.png',
  texture: 'https://static.prod-images.emergentagent.com/jobs/32dad071-4fb0-440b-90c6-bb16ae39bea1/images/4f979e7ba4b32872c4b07dadcb054eb78f999948cb9373a70a78567dea9e65ab.png',
  cartagena: 'https://images.unsplash.com/photo-1651421479936-e24edc3e3143?w=800',
  concert: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800',
  beach: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800',
  cathedralSunset: 'https://images.pexels.com/photos/11815897/pexels-photo-11815897.jpeg',
};
