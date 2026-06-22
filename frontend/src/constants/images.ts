// Central image catalog for AMO Cartagena
// All URLs are Unsplash CDN links with explicit width and quality params.
// Using resizeMode="cover" on every Image component that consumes these.

const IMG_BASE = 'https://website-five-sigma-29.vercel.app/images';

export const IMAGES = {
  // Hero & Background — REAL Cartagena photos
  hero:              `${IMG_BASE}/hero-cathedral.jpg`,
  login:             `${IMG_BASE}/login-cathedral.jpg`,
  cartagena_sunset:  `${IMG_BASE}/hero-cathedral.jpg`,
  cartagena_walls:   `${IMG_BASE}/aerial-fortress.jpg`,
  cartagena_streets: `${IMG_BASE}/login-cathedral.jpg`,
  cartagena_aerial:  `${IMG_BASE}/aerial-fortress.jpg`,
  umbrellas:         `${IMG_BASE}/umbrella-street.jpg`,
  flag_rooftops:     `${IMG_BASE}/flag-rooftops.jpg`,
  fountain_market:   `${IMG_BASE}/fountain-market.jpg`,
  wax_palms:         `${IMG_BASE}/wax-palms.jpg`,

  // Category hero images
  restaurant:  'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&q=80',
  beach_club:  'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=600&q=80',
  yacht:       'https://images.unsplash.com/photo-1567899378494-47b22a2ae96a?w=600&q=80',
  hotel:       'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&q=80',
  wellness:    'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=600&q=80',
  nightlife:   'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=600&q=80',
  activity:    'https://images.unsplash.com/photo-1530789253388-582c481c54b0?w=600&q=80',
  cultural:    'https://images.unsplash.com/photo-1569154941061-e231b4725ef1?w=600&q=80',
  concert:     'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=600&q=80',

  // Specific experience types
  daypass:        'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=600&q=80',
  sunset_session: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600&q=80',
  club:           'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=600&q=80',

  // Partner-specific venue images
  fine_dining:      'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&q=80',
  cocktail_bar:     'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&q=80',
  sunset_bar:       'https://images.unsplash.com/photo-1506929562872-bb421503ef21?w=600&q=80',
  luxury_pool:      'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&q=80',
  bakery:           'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600&q=80',
  tropical_garden:  'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600&q=80',
  food_tour:        'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&q=80',
  latin_dance:      'https://images.unsplash.com/photo-1504609813442-a8924e83f76e?w=600&q=80',
  cocktail_dark:    'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=600&q=80',
  diving:           'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600&q=80',
  walking_tour:     'https://images.unsplash.com/photo-1558029137-a49d75b36fd8?w=600&q=80',
  jewelry:          'https://images.unsplash.com/photo-1515562141589-67f0d382c7b4?w=600&q=80',
  shopping:         'https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=600&q=80',
  members_club:     'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=600&q=80',

  // Fallbacks
  placeholder:      'https://images.unsplash.com/photo-1651421479936-e24edc3e3143?w=600&q=80',
  avatar_fallback:  'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&q=80',
  event_fallback:   'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=600&q=80',
  promo_fallback:   'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&q=80',
  season_fallback:  `${IMG_BASE}/hero-cathedral.jpg`,
} as const;

// Maps API category strings (as returned by the backend) to image URLs.
// Handles both snake_case and camelCase variants partners can return.
const CATEGORY_MAP: Record<string, keyof typeof IMAGES> = {
  restaurant:   'restaurant',
  restaurants:  'restaurant',
  gastronomy:   'restaurant',
  beach_club:   'beach_club',
  beachclub:    'beach_club',
  beach:        'beach_club',
  daypass:      'daypass',
  day_pass:     'daypass',
  yacht:        'yacht',
  yachts:       'yacht',
  hotel:        'hotel',
  hotels:       'hotel',
  wellness:     'wellness',
  spa:          'wellness',
  nightlife:    'nightlife',
  club:         'nightlife',
  party:        'nightlife',
  activity:     'activity',
  activities:   'activity',
  sport:        'activity',
  cultural:     'cultural',
  art:          'cultural',
  culture:      'cultural',
  music:        'concert',
  concert:      'concert',
  sunset:       'sunset_session',
};

// ---------------------------------------------------------------------------
// Inline SVG fallbacks — zero-network, bundled with JS.
// Used as the absolute last resort in SafeImage when every remote URL fails.
// Each SVG: 400x300, void-dark background, muted gold radial glow, icon + label.
// ---------------------------------------------------------------------------

const makeSVG = (icon: string, label: string): string => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#14141C"/><defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#D4AF37" stop-opacity=".12"/><stop offset="100%" stop-color="#14141C" stop-opacity="0"/></radialGradient></defs><rect width="400" height="300" fill="url(#g)"/><text x="200" y="148" text-anchor="middle" font-size="52" fill="#D4AF37" opacity=".35">${icon}</text><text x="200" y="182" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="#9CA3AF" opacity=".5" letter-spacing="3">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

export const FALLBACK_SVGS: Record<string, string> = {
  restaurant:   makeSVG('🍽', 'RESTAURANTE'),
  bar:          makeSVG('🍸', 'BAR'),
  hotel:        makeSVG('🏨', 'HOTEL'),
  cafe:         makeSVG('☕', 'CAFÉ'),
  beach_club:   makeSVG('🏖', 'BEACH CLUB'),
  wellness:     makeSVG('✦', 'WELLNESS · SPA'),
  spa:          makeSVG('✦', 'SPA'),
  beauty:       makeSVG('✧', 'BEAUTY'),
  nightclub:    makeSVG('◈', 'NIGHTLIFE'),
  nightlife:    makeSVG('◈', 'NIGHTLIFE'),
  shopping:     makeSVG('◻', 'SHOPPING'),
  tour:         makeSVG('◉', 'TOUR · EXPERIENCIA'),
  activity:     makeSVG('◉', 'ACTIVIDAD'),
  cultural:     makeSVG('◎', 'CULTURA'),
  concert:      makeSVG('♪', 'CONCIERTO'),
  transport:    makeSVG('◌', 'TRANSPORTE'),
  yacht:        makeSVG('◇', 'YATE'),
  daypass:      makeSVG('☀', 'DAY PASS'),
  placeholder:  makeSVG('◆', 'AMO CARTAGENA'),
};

export const getCategoryImage = (category?: string | null): string => {
  if (!category) return IMAGES.placeholder;
  const key = CATEGORY_MAP[category.toLowerCase()];
  return key ? IMAGES[key] : IMAGES.placeholder;
};
