import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

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

// ─── Backend API ─────────────────────────────────────────────────────────────

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

async function getToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem('session_token');
  }
  return SecureStore.getItemAsync('session_token');
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function submitReview(data: {
  partner_id: string;
  rating: number;
  subcategories: SubcategoryRatings;
  text: string;
  author_name?: string;
}): Promise<StoredReview> {
  const token = await getToken();
  if (!token || !BACKEND_URL) {
    throw new Error('Debes iniciar sesión para dejar una reseña.');
  }

  const res = await fetch(`${BACKEND_URL}/api/reviews`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      partner_id: data.partner_id,
      rating: data.rating,
      subcategories: data.subcategories,
      text: data.text || '',
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Error desconocido' }));
    throw new Error(err.detail || `Error ${res.status}`);
  }

  const review = await res.json();
  return {
    review_id: review.review_id,
    partner_id: review.partner_id,
    author_name: review.user_name || data.author_name || 'Visitante',
    rating: review.rating,
    subcategories: review.subcategories || data.subcategories,
    text: review.text || data.text || '',
    date: review.created_at || new Date().toISOString(),
    helpful_count: review.helpful_count || 0,
    is_verified: review.is_verified_booking || false,
  };
}

export async function getPartnerReviews(partnerId: string): Promise<ReviewsPayload> {
  // Try backend first, fall back to static data
  let reviews: StoredReview[] = [];

  if (BACKEND_URL) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/reviews/partner/${partnerId}`);
      if (res.ok) {
        const data = await res.json();
        reviews = (data.reviews || []).map((r: any) => ({
          review_id: r.review_id,
          partner_id: r.partner_id,
          author_name: r.user_name || 'Visitante',
          rating: r.rating,
          subcategories: r.subcategories || { experience: 0, service: 0, location: 0, value: 0 },
          text: r.text || '',
          date: r.created_at || '',
          helpful_count: r.helpful_count || 0,
          is_verified: r.is_verified_booking || false,
        }));
      }
    } catch {
      // Backend unavailable — fall back to static
    }
  }

  // Fall back to static seed data if backend returned nothing
  if (reviews.length === 0) {
    try {
      const res = await fetch('/data/reviews.json');
      if (res.ok) {
        const seeds = await res.json();
        reviews = seeds[partnerId] || [];
      }
    } catch { /* static file not available */ }
  }

  // Sort by date descending
  reviews.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const total = reviews.length;
  const average = total > 0
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / total
    : 0;

  const subKeys: { key: keyof SubcategoryRatings; label: string }[] = [
    { key: 'experience', label: 'Experiencia' },
    { key: 'service', label: 'Servicio' },
    { key: 'location', label: 'Ubicación' },
    { key: 'value', label: 'Valor' },
  ];

  const subcategories: SubcategoryScore[] = total > 0
    ? subKeys.map(({ key, label }) => {
        const scored = reviews.filter((r) => r.subcategories?.[key] > 0);
        const avg = scored.length > 0
          ? scored.reduce((s, r) => s + r.subcategories[key], 0) / scored.length
          : 0;
        return { label, score: avg };
      })
    : [];

  return {
    partner_id: partnerId,
    aggregate: { average, total, subcategories },
    reviews,
  };
}
