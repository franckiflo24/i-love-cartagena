import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SubcategoryRatings = {
  experience: number;
  service: number;
  location: number;
  value: number;
};

export type StoredReview = {
  review_id: string;
  partner_id: string;
  author_name: string;
  rating: number;
  subcategories: SubcategoryRatings;
  text: string;
  date: string;
  helpful_count: number;
  is_verified: boolean;
};

type SubcategoryScore = {
  label: string;
  score: number;
};

export type ReviewsPayload = {
  partner_id: string;
  aggregate: {
    average: number;
    total: number;
    subcategories: SubcategoryScore[];
  };
  reviews: StoredReview[];
};

// ─── Storage Keys ─────────────────────────────────────────────────────────────

const REVIEWS_KEY = 'amo_reviews';

// ─── Seed Reviews Cache ──────────────────────────────────────────────────────
// Reviews seeded in /data/reviews.json are shared across ALL users.
// They load once and stay cached in memory for the session.

let seedCache: Record<string, StoredReview[]> | null = null;
let seedPromise: Promise<Record<string, StoredReview[]>> | null = null;

async function loadSeedReviews(): Promise<Record<string, StoredReview[]>> {
  if (seedCache) return seedCache;
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    try {
      const res = await fetch('/data/reviews.json');
      if (!res.ok) return {};
      const data = await res.json();
      seedCache = data;
      return data;
    } catch {
      seedCache = {};
      return {};
    }
  })();
  return seedPromise;
}

// ─── Local Reviews (user-submitted, device-only) ─────────────────────────────

async function getLocalReviews(): Promise<StoredReview[]> {
  try {
    const raw = await AsyncStorage.getItem(REVIEWS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveLocalReviews(reviews: StoredReview[]): Promise<void> {
  await AsyncStorage.setItem(REVIEWS_KEY, JSON.stringify(reviews));
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function submitReview(data: {
  partner_id: string;
  rating: number;
  subcategories: SubcategoryRatings;
  text: string;
  author_name?: string;
}): Promise<StoredReview> {
  const review: StoredReview = {
    review_id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    partner_id: data.partner_id,
    author_name: data.author_name || 'Visitante',
    rating: data.rating,
    subcategories: data.subcategories,
    text: data.text,
    date: new Date().toISOString(),
    helpful_count: 0,
    is_verified: false,
  };

  const all = await getLocalReviews();
  all.unshift(review);
  await saveLocalReviews(all);

  return review;
}

export async function getPartnerReviews(partnerId: string): Promise<ReviewsPayload> {
  // Merge seed reviews (shared) + local reviews (user-submitted)
  const [seeds, locals] = await Promise.all([
    loadSeedReviews(),
    getLocalReviews(),
  ]);

  const seedReviews = seeds[partnerId] || [];
  const localReviews = locals.filter((r) => r.partner_id === partnerId);

  // Dedupe: local reviews override seeds with same review_id
  const seedIds = new Set(localReviews.map((r) => r.review_id));
  const merged = [
    ...localReviews,
    ...seedReviews.filter((r) => !seedIds.has(r.review_id)),
  ];

  // Sort by date descending (newest first)
  merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const total = merged.length;
  const average = total > 0
    ? merged.reduce((sum, r) => sum + r.rating, 0) / total
    : 0;

  const subKeys: { key: keyof SubcategoryRatings; label: string }[] = [
    { key: 'experience', label: 'Experiencia' },
    { key: 'service', label: 'Servicio' },
    { key: 'location', label: 'Ubicaci\u00f3n' },
    { key: 'value', label: 'Valor' },
  ];

  const subcategories: SubcategoryScore[] = total > 0
    ? subKeys.map(({ key, label }) => {
        const scored = merged.filter((r) => r.subcategories?.[key] > 0);
        const avg = scored.length > 0
          ? scored.reduce((s, r) => s + r.subcategories[key], 0) / scored.length
          : 0;
        return { label, score: avg };
      })
    : [];

  return {
    partner_id: partnerId,
    aggregate: { average, total, subcategories },
    reviews: merged,
  };
}
