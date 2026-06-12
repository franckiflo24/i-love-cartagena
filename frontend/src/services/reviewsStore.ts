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

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getAllReviews(): Promise<StoredReview[]> {
  try {
    const raw = await AsyncStorage.getItem(REVIEWS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveAllReviews(reviews: StoredReview[]): Promise<void> {
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

  const all = await getAllReviews();
  all.unshift(review);
  await saveAllReviews(all);

  return review;
}

export async function getPartnerReviews(partnerId: string): Promise<ReviewsPayload> {
  const all = await getAllReviews();
  const partnerReviews = all.filter((r) => r.partner_id === partnerId);

  const total = partnerReviews.length;
  const average = total > 0
    ? partnerReviews.reduce((sum, r) => sum + r.rating, 0) / total
    : 0;

  // Compute subcategory averages
  const subKeys: { key: keyof SubcategoryRatings; label: string }[] = [
    { key: 'experience', label: 'Experiencia' },
    { key: 'service', label: 'Servicio' },
    { key: 'location', label: 'Ubicaci\u00f3n' },
    { key: 'value', label: 'Valor' },
  ];

  const subcategories: SubcategoryScore[] = total > 0
    ? subKeys.map(({ key, label }) => {
        const scored = partnerReviews.filter((r) => r.subcategories?.[key] > 0);
        const avg = scored.length > 0
          ? scored.reduce((s, r) => s + r.subcategories[key], 0) / scored.length
          : 0;
        return { label, score: avg };
      })
    : [];

  return {
    partner_id: partnerId,
    aggregate: { average, total, subcategories },
    reviews: partnerReviews,
  };
}
