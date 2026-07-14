import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, SPACING, RADIUS, FONTS } from '@/src/constants/theme';
import { getPartnerReviews } from '@/src/services/reviewsStore';
import { useLang } from '@/src/context/LanguageContext';
import ReviewCard from './ReviewCard';

// ─── Types ────────────────────────────────────────────────────────────────────

type SubcategoryScore = {
  label: string;
  score: number;
};

type Review = {
  review_id: string;
  author_name: string;
  author_avatar?: string | null;
  rating: number;
  date: string;
  text: string;
  helpful_count: number;
  is_verified: boolean;
};

type ReviewsPayload = {
  partner_id: string;
  partner_name?: string;
  aggregate: {
    average: number;
    total: number;
    subcategories: SubcategoryScore[];
  };
  reviews: Review[];
};

// ─── Animated Bar ─────────────────────────────────────────────────────────────

function AnimatedBar({ score, color }: { score: number; color: string }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: Math.min(Math.max(score / 5, 0), 1),
      duration: 700,
      useNativeDriver: false,
    }).start();
  }, [score]);

  const width = anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={barStyles.track}>
      <Animated.View style={[barStyles.fill, { width, backgroundColor: color }]} />
    </View>
  );
}

const barStyles = StyleSheet.create({
  track: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 3 },
});

// ─── Aggregate Header ─────────────────────────────────────────────────────────

function AggregateHeader({
  average,
  total,
  subcategories,
}: {
  average: number;
  total: number;
  subcategories: SubcategoryScore[];
}) {
  const stars = Math.round(average);

  if (total === 0) return null;

  return (
    <View style={aggStyles.wrap}>
      {/* Big rating number */}
      <View style={aggStyles.bigRating}>
        <Text style={aggStyles.bigNum}>{(average || 0).toFixed(1)}</Text>
        <View style={aggStyles.starCol}>
          <View style={{ flexDirection: 'row', gap: 2 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Ionicons
                key={n}
                name={n <= stars ? 'star' : 'star-outline'}
                size={14}
                color={n <= stars ? COLORS.primary : 'rgba(255,255,255,0.2)'}
              />
            ))}
          </View>
          <Text style={aggStyles.totalText}>{total.toLocaleString()} reseñas</Text>
        </View>
      </View>

      {/* Subcategory bars */}
      {subcategories.length > 0 && (
        <View style={aggStyles.subcats}>
          {subcategories.map((sub, i) => (
            <View key={i} style={aggStyles.subRow}>
              <Text style={aggStyles.subLabel} numberOfLines={1}>{sub.label}</Text>
              <AnimatedBar score={sub.score} color={COLORS.primary} />
              <Text style={aggStyles.subScore}>{(sub.score || 0).toFixed(1)}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const aggStyles = StyleSheet.create({
  wrap: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.lg,
    gap: SPACING.lg,
  },
  bigRating: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  bigNum: { fontSize: 48, color: COLORS.textMain, ...FONTS.bold, lineHeight: 52 },
  starCol: { gap: 4 },
  totalText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular },
  subcats: { gap: SPACING.sm },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  subLabel: {
    width: 80,
    fontSize: 12,
    color: COLORS.textMuted,
    ...FONTS.regular,
  },
  subScore: { width: 28, fontSize: 12, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'right' },
});

// ─── ReviewsList ──────────────────────────────────────────────────────────────

export interface ReviewsListProps {
  partnerId: string;
}

export default function ReviewsList({ partnerId }: ReviewsListProps) {
  const { s } = useLang();
  const router = useRouter();

  const [payload, setPayload] = useState<ReviewsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [helpfulMap, setHelpfulMap] = useState<Record<string, number>>({});
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getPartnerReviews(partnerId);
      setPayload(result);
    } catch (e) {
      console.error('[ReviewsList]', e);
      setError('No se pudieron cargar las reseñas.');
    } finally {
      setLoading(false);
    }
  }, [partnerId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleHelpful = useCallback((reviewId: string) => {
    setHelpfulMap((prev) => ({
      ...prev,
      [reviewId]: (prev[reviewId] ?? 0) + 1,
    }));
  }, []);

  const handleWriteReview = () => {
    router.push(`/review/new?partner_id=${partnerId}&partner_name=${payload?.partner_name ?? ''}`);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (error || !payload) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={32} color={COLORS.error} />
        <Text style={styles.errorText}>{error ?? 'Error cargando reseñas.'}</Text>
        <TouchableOpacity onPress={load} style={styles.retryBtn}>
          <Text style={styles.retryText}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const { aggregate, reviews } = payload;

  return (
    <View style={styles.container}>
      {/* Write review button */}
      <TouchableOpacity onPress={handleWriteReview} style={styles.writeBtn} activeOpacity={0.85}>
        <Ionicons name="create-outline" size={16} color={COLORS.primary} />
        <Text style={styles.writeBtnText}>{s('review_write')}</Text>
      </TouchableOpacity>

      {/* Aggregate */}
      <AggregateHeader
        average={aggregate.average}
        total={aggregate.total}
        subcategories={aggregate.subcategories ?? []}
      />

      {/* Reviews */}
      {reviews.length === 0 ? (
        <View style={styles.emptyBox}>
          <Ionicons name="chatbubble-outline" size={28} color={COLORS.textMuted} />
          <Text style={styles.emptyText}>Sé el primero en dejar una reseña</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {(showAll ? reviews : reviews.slice(0, 3)).map((item, idx) => (
            <View key={item.review_id}>
              {idx > 0 && <View style={{ height: SPACING.md }} />}
              <ReviewCard
                authorName={item.author_name}
                rating={item.rating}
                date={item.date}
                text={item.text}
                helpfulCount={(item.helpful_count ?? 0) + (helpfulMap[item.review_id] ?? 0)}
                isVerified={item.is_verified}
                onHelpful={() => handleHelpful(item.review_id)}
              />
            </View>
          ))}
          {reviews.length > 3 && !showAll && (
            <TouchableOpacity style={styles.showMoreBtn} onPress={() => setShowAll(true)} activeOpacity={0.85}>
              <Text style={styles.showMoreText}>Ver las {reviews.length - 3} reseñas restantes</Text>
              <Ionicons name="chevron-down" size={14} color={COLORS.primary} />
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: SPACING.lg },

  writeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    borderWidth: 1,
    borderColor: `${COLORS.primary}60`,
    borderRadius: RADIUS.full,
    paddingVertical: SPACING.md,
    backgroundColor: `${COLORS.primary}10`,
  },
  writeBtnText: { fontSize: 14, color: COLORS.primary, ...FONTS.semibold },

  list: { gap: 0 },

  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: SPACING.xl, gap: SPACING.md },
  errorText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  retryText: { fontSize: 13, color: COLORS.textMain, ...FONTS.medium },

  emptyBox: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular },

  showMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.md,
    marginTop: SPACING.sm,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  showMoreText: { fontSize: 13, color: COLORS.primary, ...FONTS.semibold },
});
