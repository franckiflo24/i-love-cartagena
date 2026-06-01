// Central image catalog for AMO Cartagena
// All URLs are Unsplash CDN links with explicit width and quality params.
// Using resizeMode="cover" on every Image component that consumes these.

export const IMAGES = {
  // Hero & Background — aerial/landmark Cartagena shots
  hero: 'https://images.unsplash.com/photo-1583997052301-0042b33fc598?w=800&q=80',
  cartagena_sunset: 'https://images.unsplash.com/photo-1651421479936-e24edc3e3143?w=800&q=80',
  cartagena_walls: 'https://images.unsplash.com/photo-1558029137-a49d75b36fd8?w=800&q=80',

  // Category hero images
  restaurant: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&q=80',
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

  // Fallbacks
  placeholder:      'https://images.unsplash.com/photo-1583997052301-0042b33fc598?w=600&q=80',
  avatar_fallback:  'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&q=80',
  event_fallback:   'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=600&q=80',
  promo_fallback:   'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&q=80',
  season_fallback:  'https://images.unsplash.com/photo-1583997052301-0042b33fc598?w=800&q=80',
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

export const getCategoryImage = (category?: string | null): string => {
  if (!category) return IMAGES.placeholder;
  const key = CATEGORY_MAP[category.toLowerCase()];
  return key ? IMAGES[key] : IMAGES.placeholder;
};
