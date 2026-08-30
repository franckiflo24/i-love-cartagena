import { Easing } from 'react-native';

// ── COLORS — Caribbean Spectrum (Option A) — calm navy base, multi-accent ──
// Each surface gets its own Cartagena color instead of one accent driving
// everything: teal = primary/interactive, coral = live/now, mustard = hero/
// premium, bougainvillea = the ❤️ brand pop, blue = official/institutional.
export const COLORS = {
  background: '#080C16',       // deep Caribbean night — darker, richer base
  backgroundSolid: '#080C16',
  surface: '#0F1524',          // navy card, lifted for separation
  surfaceAlt: '#161E30',
  surfaceGlass: 'rgba(15, 21, 36, 0.62)',
  primary: '#12B5A5',          // Caribbean teal — reserved for PRIMARY actions only
  primaryHover: '#3ED0C1',
  primaryMuted: '#0C7D72',
  textMain: '#F5F7FA',
  textMuted: '#8A93A6',
  textFaint: '#5E6675',
  // ── Neutral chrome — quiet by default so teal stops flooding ──
  icon: '#AEB6C4',             // decorative / utility icons (chevrons, meta)
  iconMuted: '#6B7688',        // secondary icons
  hairline: 'rgba(255,255,255,0.06)',  // quiet dividers/borders
  border: '#1C2537',
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

// ── TYPE — a real, tuned type scale (Apple/SF rhythm). One source of truth for
// size + line-height + weight + tracking, so text stops feeling arbitrary/cramped.
// Spread a role onto a text style: { ...TYPE.title3, color: COLORS.textMain }.
// NOTE: injecting lineHeight where none existed changes line-box height — when
// applying to fixed-height chrome (chips, tab labels, badges) keep the tight role
// (footnote/caption/overline) or set an explicit height.
export const TYPE = {
  display:  { fontSize: 40, lineHeight: 46, fontWeight: '700' as const, letterSpacing: -0.5 },
  title1:   { fontSize: 28, lineHeight: 34, fontWeight: '700' as const, letterSpacing: -0.4 },
  title2:   { fontSize: 22, lineHeight: 28, fontWeight: '700' as const, letterSpacing: -0.3 },
  title3:   { fontSize: 18, lineHeight: 24, fontWeight: '600' as const, letterSpacing: -0.2 },
  headline: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const, letterSpacing: 0 },
  body:     { fontSize: 15, lineHeight: 22, fontWeight: '400' as const, letterSpacing: 0 },
  callout:  { fontSize: 14, lineHeight: 20, fontWeight: '500' as const, letterSpacing: 0 },
  subhead:  { fontSize: 13, lineHeight: 18, fontWeight: '500' as const, letterSpacing: 0 },
  footnote: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const, letterSpacing: 0.1 },
  caption:  { fontSize: 11, lineHeight: 14, fontWeight: '600' as const, letterSpacing: 0.3 },
  overline: { fontSize: 10, lineHeight: 12, fontWeight: '700' as const, letterSpacing: 1.2 },
};

// ── ELEVATION — graduated, soft, web-aware. RN Web needs `boxShadow` (shadow*
// props barely render on web), so every level ships both. Softer opacities read
// premium on the near-black canvas; pair with surface-lift + hairline for depth.
export const ELEVATION = {
  none: {},
  sm:  { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.18, shadowRadius: 3,  elevation: 2,  boxShadow: '0 1px 3px rgba(0,0,0,0.18)' },
  md:  { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.22, shadowRadius: 12, elevation: 4,  boxShadow: '0 4px 12px rgba(0,0,0,0.22)' },
  lg:  { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 24, elevation: 8,  boxShadow: '0 8px 24px rgba(0,0,0,0.28)' },
  sheet: { shadowColor: '#000', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.35, shadowRadius: 32, elevation: 12, boxShadow: '0 -6px 32px rgba(0,0,0,0.35)' },
  glow: { shadowColor: '#12B5A5', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.30, shadowRadius: 20, elevation: 8, boxShadow: '0 6px 20px rgba(18,181,165,0.30)' },
  // Back-compat alias — existing consumers of ELEVATION.card keep working.
  card: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.22, shadowRadius: 12, elevation: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.22)' },
};

// ── MOTION — named durations + reusable easing for a consistent, Apple-grade feel.
// Built on RN core Animated (Reanimated is installed but unconfigured — do not use).
export const MOTION = {
  fast: 150,   // kept for back-compat
  base: 250,   // kept for back-compat
  duration: { instant: 100, fast: 180, base: 240, slow: 360, slower: 520 },
  easing: {
    standard: Easing.bezier(0.4, 0.0, 0.2, 1),
    decelerate: Easing.out(Easing.cubic),  // entrances
    accelerate: Easing.in(Easing.cubic),   // exits
  },
  spring: { tension: 180, friction: 22 },  // RN Animated.spring config
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

// ── CATEGORY / CUISINE COLORS — Caribbean Spectrum, distributed ──
// The app must NOT read monochrome. Interactive chrome (nav, search, CTAs,
// selected chips) stays teal = COLORS.primary — that consistency is correct.
// But every CONTENT category/cuisine/subcategory gets its OWN spectrum color
// so category tiles, cuisine grids and venue accents feel like Cartagena, not
// one wash. Use colorForKey(key) for a stable, distinct color per key, and
// `colorForKey(key) + '22'` (RN 8-digit hex alpha) for its translucent bg.
export const SPECTRUM = [
  '#12B5A5', // teal
  '#FF6B4A', // coral
  '#E9B949', // mustard
  '#E5476D', // bougainvillea
  '#39B8FF', // caribbean blue
  '#A855F7', // purple
  '#22C55E', // green
  '#06B6D4', // cyan
  '#F97316', // orange
  '#EC4899', // pink
  '#6366F1', // indigo
  '#84CC16', // lime
  '#F59E0B', // amber
];

// Explicit assignments for the high-traffic categories + restaurant cuisines
// (the tiles users actually see). Keys match apiValue (categories) and the
// SUBCATEGORIES / style_tag keys (cuisines). Anything not listed falls back to
// a stable hashed spectrum color, so NOTHING is ever monochrome.
export const CATEGORY_COLORS: Record<string, string> = {
  // top-level categories (apiValue)
  restaurant: '#FF6B4A',   // coral
  bar: '#E5476D',          // bougainvillea
  cafe: '#E9B949',         // mustard
  nightlife: '#A855F7',    // purple
  wellness: '#22C55E',     // green
  spa: '#22C55E',
  beach_club: '#39B8FF',   // caribbean blue
  yacht: '#06B6D4',        // cyan
  beauty: '#EC4899',       // pink
  activity: '#12B5A5',     // teal
  attraction: '#6366F1',   // indigo
  hotel: '#F59E0B',        // amber
  service: '#84CC16',      // lime
  institutional: '#39B8FF',
  // restaurant cuisines (SUBCATEGORIES / style_tags)
  mediterranean: '#12B5A5',
  colombian: '#E9B949',
  seafood: '#39B8FF',
  italian: '#FF6B4A',
  asian: '#E5476D',
  middle_eastern: '#A855F7',
  grill: '#F97316',
  healthy: '#22C55E',
  fine_dining: '#F59E0B',
  fast_food: '#EC4899',
  french: '#6366F1',
  mexican: '#84CC16',
  international: '#06B6D4',
  // bar / nightlife / cafe subcats
  cocktail_bar: '#E5476D',
  rooftop: '#E9B949',
  lounge: '#A855F7',
  salsa_bar: '#FF6B4A',
  nightclub: '#A855F7',
  live_music: '#EC4899',
  champeta: '#FF6B4A',
  coffee: '#E9B949',
  brunch: '#F59E0B',
  bakery: '#FF6B4A',
  // hotel / wellness subcats
  lujo: '#F59E0B',
  premium: '#E9B949',
  boutique: '#A855F7',
  popular: '#22C55E',
  massage: '#06B6D4',
  wellness_center: '#22C55E',
};

// Stable, deterministic color for ANY category/cuisine/subcategory key.
export function colorForKey(key?: string | null): string {
  if (!key) return SPECTRUM[0];
  const k = String(key).toLowerCase();
  if (CATEGORY_COLORS[k]) return CATEGORY_COLORS[k];
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return SPECTRUM[h % SPECTRUM.length];
}

