// Central image catalog for AMO Cartagena
// All images self-hosted in public/images/. ZERO external dependencies.
// Using resizeMode="cover" on every Image component that consumes these.

const IMG_BASE = '/images';

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

  // Category hero images — self-hosted in /images/categories/
  restaurant:  `${IMG_BASE}/categories/restaurant.jpg`,
  beach_club:  `${IMG_BASE}/categories/beach_club.jpg`,
  yacht:       `${IMG_BASE}/categories/yacht.jpg`,
  hotel:       `${IMG_BASE}/categories/hotel.jpg`,
  wellness:    `${IMG_BASE}/categories/wellness.jpg`,
  nightlife:   `${IMG_BASE}/categories/nightlife.jpg`,
  activity:    `${IMG_BASE}/categories/activity.jpg`,
  cultural:    `${IMG_BASE}/categories/cultural.jpg`,
  concert:     `${IMG_BASE}/categories/concert.jpg`,

  // Specific experience types
  daypass:        `${IMG_BASE}/categories/daypass.jpg`,
  sunset_session: `${IMG_BASE}/categories/sunset_session.jpg`,
  club:           `${IMG_BASE}/categories/club.jpg`,

  // Partner-specific venue images
  fine_dining:      `${IMG_BASE}/categories/fine_dining.jpg`,
  cocktail_bar:     `${IMG_BASE}/categories/cocktail_bar.jpg`,
  sunset_bar:       `${IMG_BASE}/categories/sunset_bar.jpg`,
  luxury_pool:      `${IMG_BASE}/categories/luxury_pool.jpg`,
  bakery:           `${IMG_BASE}/categories/bakery.jpg`,
  tropical_garden:  `${IMG_BASE}/categories/tropical_garden.jpg`,
  food_tour:        `${IMG_BASE}/categories/food_tour.jpg`,
  latin_dance:      `${IMG_BASE}/categories/latin_dance.jpg`,
  cocktail_dark:    `${IMG_BASE}/categories/cocktail_dark.jpg`,
  diving:           `${IMG_BASE}/categories/diving.jpg`,
  walking_tour:     `${IMG_BASE}/categories/walking_tour.jpg`,
  jewelry:          `${IMG_BASE}/categories/jewelry.jpg`,
  shopping:         `${IMG_BASE}/categories/shopping.jpg`,
  members_club:     `${IMG_BASE}/categories/members_club.jpg`,

  // Fallbacks — all self-hosted, zero external dependencies
  placeholder:      `${IMG_BASE}/categories/placeholder.jpg`,
  avatar_fallback:  `${IMG_BASE}/categories/avatar_fallback.jpg`,
  event_fallback:   `${IMG_BASE}/categories/event_fallback.jpg`,
  promo_fallback:   `${IMG_BASE}/categories/promo_fallback.jpg`,
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
