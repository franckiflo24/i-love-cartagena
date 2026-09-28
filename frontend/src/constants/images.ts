// Central image catalog for AMO Life
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
// Bundled placeholders — compiled INTO the binary by Metro `require()`, so they
// paint on the first frame with zero network and no origin (native has none).
// SafeImage shows one as the expo-image `placeholder` while a remote photo
// loads and uses it as the final fallback when every remote stage fails.
// Branded, no text, no stock photo of a different venue — honest by
// construction (the previous SVG data-URI fallback never decoded on iOS).
// 480x320 JPEG ~5 KB each; generated from assets/images/amo-life-logo.png.
// ---------------------------------------------------------------------------

export const BUNDLED_PLACEHOLDERS = {
  card:       require('../../assets/images/placeholder-card.jpg') as number,
  restaurant: require('../../assets/images/placeholder-restaurant.jpg') as number,
  bar:        require('../../assets/images/placeholder-bar.jpg') as number,
  cafe:       require('../../assets/images/placeholder-cafe.jpg') as number,
  nightlife:  require('../../assets/images/placeholder-nightlife.jpg') as number,
  beach:      require('../../assets/images/placeholder-beach.jpg') as number,
  wellness:   require('../../assets/images/placeholder-wellness.jpg') as number,
  hotel:      require('../../assets/images/placeholder-hotel.jpg') as number,
  yacht:      require('../../assets/images/placeholder-yacht.jpg') as number,
  activity:   require('../../assets/images/placeholder-activity.jpg') as number,
  cultural:   require('../../assets/images/placeholder-cultural.jpg') as number,
  concert:    require('../../assets/images/placeholder-concert.jpg') as number,
  event:      require('../../assets/images/placeholder-event.jpg') as number,
} as const;

export type BundledPlaceholderKey = keyof typeof BUNDLED_PLACEHOLDERS;

// Category strings from partners, events and partner-events (both API and the
// static /data files) → bundled placeholder. Unknown → generic card.
const BUNDLED_MAP: Record<string, BundledPlaceholderKey> = {
  restaurant: 'restaurant', restaurants: 'restaurant', gastronomy: 'restaurant', fine_dining: 'restaurant',
  bar: 'bar', cocktail_bar: 'bar', rooftop: 'bar', lounge: 'bar',
  cafe: 'cafe', coffee: 'cafe', bakery: 'cafe', brunch: 'cafe',
  nightlife: 'nightlife', club: 'nightlife', nightclub: 'nightlife', party: 'nightlife', after_party: 'nightlife',
  beach_club: 'beach', beachclub: 'beach', beach: 'beach', daypass: 'beach', day_pass: 'beach', sunset: 'beach',
  wellness: 'wellness', spa: 'wellness', beauty: 'wellness', massage: 'wellness',
  hotel: 'hotel', hotels: 'hotel',
  yacht: 'yacht', yachts: 'yacht',
  activity: 'activity', activities: 'activity', tour: 'activity', sport: 'activity', sports: 'activity', attraction: 'activity',
  cultural: 'cultural', culture: 'cultural', art: 'cultural', religious: 'cultural', museum: 'cultural',
  concert: 'concert', music: 'concert', festival: 'concert', live_music: 'concert',
  event: 'event', events: 'event', popup: 'event', pop_up: 'event',
};

/** Bundled (offline, in-binary) placeholder for a category. Always resolves. */
export const getBundledPlaceholder = (category?: string | null): number => {
  if (!category) return BUNDLED_PLACEHOLDERS.card;
  const key = BUNDLED_MAP[String(category).toLowerCase()];
  return key ? BUNDLED_PLACEHOLDERS[key] : BUNDLED_PLACEHOLDERS.card;
};

/** Self-hosted category photo (/images/categories/*.jpg) — a network asset. */
export const getCategoryImage = (category?: string | null): string => {
  if (!category) return IMAGES.placeholder;
  const key = CATEGORY_MAP[category.toLowerCase()];
  return key ? IMAGES[key] : IMAGES.placeholder;
};
