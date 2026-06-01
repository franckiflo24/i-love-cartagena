import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '@/src/constants/theme';
import { useLang } from '@/src/context/LanguageContext';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ReviewCardProps {
  authorName: string;
  authorAvatar?: string | null;
  rating: number;
  date: string;
  text: string;
  helpfulCount: number;
  isVerified: boolean;
  onHelpful: () => void;
}

// ─── Star Row ─────────────────────────────────────────────────────────────────

function StarRow({ rating, size = 14, color = COLORS.primary }: { rating: number; size?: number; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Ionicons
          key={n}
          name={n <= Math.round(rating) ? 'star' : 'star-outline'}
          size={size}
          color={n <= Math.round(rating) ? color : 'rgba(255,255,255,0.2)'}
        />
      ))}
    </View>
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  // Deterministic color based on first char code
  const hue = (name.charCodeAt(0) * 47) % 360;

  return (
    <View style={[avatarStyles.circle, { backgroundColor: `hsl(${hue},50%,28%)` }]}>
      <Text style={avatarStyles.initials}>{initials}</Text>
    </View>
  );
}

const avatarStyles = StyleSheet.create({
  circle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  initials: { fontSize: 14, color: COLORS.white, ...FONTS.bold },
});

// ─── ReviewCard ───────────────────────────────────────────────────────────────

export default function ReviewCard({
  authorName,
  rating,
  date,
  text,
  helpfulCount,
  isVerified,
  onHelpful,
}: ReviewCardProps) {
  const { s } = useLang();

  const dateStr = new Date(date).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <View style={styles.card}>
      {/* Author row */}
      <View style={styles.authorRow}>
        <Avatar name={authorName} />
        <View style={styles.authorInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.authorName}>{authorName}</Text>
            {isVerified && (
              <View style={styles.verifiedBadge}>
                <Ionicons name="checkmark-circle" size={11} color={COLORS.success} />
                <Text style={styles.verifiedText}>Reserva verificada</Text>
              </View>
            )}
          </View>
          <View style={styles.metaRow}>
            <StarRow rating={rating} size={12} />
            <Text style={styles.dateText}>{dateStr}</Text>
          </View>
        </View>
      </View>

      {/* Review text */}
      <Text style={styles.reviewText}>{text}</Text>

      {/* Helpful */}
      <TouchableOpacity onPress={onHelpful} style={styles.helpfulBtn} activeOpacity={0.75}>
        <Ionicons name="thumbs-up-outline" size={14} color={COLORS.textMuted} />
        <Text style={styles.helpfulText}>{s('review_helpful')}</Text>
        {helpfulCount > 0 && (
          <View style={styles.helpfulCount}>
            <Text style={styles.helpfulCountText}>{helpfulCount}</Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    gap: SPACING.md,
  },

  // Author
  authorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.md },
  authorInfo: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SPACING.sm },
  authorName: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },

  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(34,197,94,0.1)',
    borderRadius: RADIUS.full,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.3)',
  },
  verifiedText: { fontSize: 9, color: COLORS.success, ...FONTS.semibold },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  dateText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },

  // Text
  reviewText: {
    fontSize: 13,
    color: COLORS.textMuted,
    ...FONTS.regular,
    lineHeight: 20,
  },

  // Helpful
  helpfulBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    alignSelf: 'flex-start',
  },
  helpfulText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular },
  helpfulCount: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: RADIUS.full,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  helpfulCountText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
});
