import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TIER_COLORS, TIER_ICONS, FONTS, RADIUS, Tier } from '../constants/theme';
import { useLang } from '../context/LanguageContext';

type Size = 'xs' | 'sm' | 'md';

interface TierBadgeProps {
  tier?: Tier | string | null;
  size?: Size;
  style?: any;
  showLabel?: boolean;
}

const SIZE_CONFIG: Record<Size, { fontSize: number; iconSize: number; padH: number; padV: number; gap: number }> = {
  xs: { fontSize: 9, iconSize: 10, padH: 6, padV: 3, gap: 3 },
  sm: { fontSize: 10, iconSize: 12, padH: 8, padV: 4, gap: 4 },
  md: { fontSize: 12, iconSize: 14, padH: 10, padV: 5, gap: 5 },
};

export const TierBadge: React.FC<TierBadgeProps> = ({ tier, size = 'sm', style, showLabel = true }) => {
  const { s } = useLang();

  if (!tier || !['popular', 'premium', 'elite'].includes(tier)) return null;

  const t = tier as Tier;
  const colors = TIER_COLORS[t];
  const icon = TIER_ICONS[t];
  const cfg = SIZE_CONFIG[size];

  const label = t === 'popular' ? s('tier_popular') : t === 'premium' ? s('tier_premium') : s('tier_elite');

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: colors.bg,
          borderColor: colors.border,
          paddingHorizontal: cfg.padH,
          paddingVertical: cfg.padV,
          gap: cfg.gap,
        },
        style,
      ]}
    >
      <Ionicons name={icon as any} size={cfg.iconSize} color={colors.main} />
      {showLabel ? (
        <Text style={[styles.text, { color: colors.main, fontSize: cfg.fontSize }]}>
          {label.toUpperCase()}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: RADIUS.full,
    alignSelf: 'flex-start',
  },
  text: {
    ...FONTS.bold,
    letterSpacing: 0.8,
  },
});

export default TierBadge;
