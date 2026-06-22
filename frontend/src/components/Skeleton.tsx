import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, ViewStyle, StyleProp, Dimensions } from 'react-native';
import { COLORS, SPACING, RADIUS } from '../constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = (SCREEN_WIDTH - SPACING.lg * 2 - SPACING.sm) / 2;

// ── Shimmer pulse config ──────────────────────────────────────────────────────
const SHIMMER_DURATION = 900;
const OPACITY_MIN = 0.3;
const OPACITY_MAX = 0.7;

// ── Base Skeleton block ───────────────────────────────────────────────────────

type SkeletonProps = {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
};

export function Skeleton({
  width = '100%',
  height = 16,
  borderRadius = RADIUS.sm,
  style,
}: SkeletonProps) {
  const opacity = useRef(new Animated.Value(OPACITY_MIN)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: OPACITY_MAX,
          duration: SHIMMER_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: OPACITY_MIN,
          duration: SHIMMER_DURATION,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: COLORS.surfaceAlt,
          opacity,
        },
        style,
      ]}
    />
  );
}

// ── SkeletonCard — image + 2 text lines ──────────────────────────────────────

export function SkeletonCard() {
  return (
    <View style={skeletonStyles.card}>
      {/* Image placeholder */}
      <Skeleton height={120} borderRadius={RADIUS.lg} />
      {/* Text line 1 */}
      <Skeleton height={14} width="70%" borderRadius={RADIUS.sm} style={skeletonStyles.textLine} />
      {/* Text line 2 */}
      <Skeleton height={11} width="45%" borderRadius={RADIUS.sm} style={skeletonStyles.textLineSm} />
    </View>
  );
}

// ── SkeletonList — 4 stacked SkeletonCards ────────────────────────────────────

export function SkeletonList() {
  return (
    <View style={skeletonStyles.list}>
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </View>
  );
}

// ── SkeletonHero — tall hero + overlaid text lines ────────────────────────────

export function SkeletonHero() {
  return (
    <View style={skeletonStyles.heroWrap}>
      <Skeleton height={260} borderRadius={0} />
      {/* Overlaid text lines mimicking hero title block */}
      <View style={skeletonStyles.heroTextBlock}>
        <Skeleton height={12} width="30%" borderRadius={RADIUS.full} />
        <Skeleton height={22} width="70%" borderRadius={RADIUS.sm} style={{ marginTop: 8 }} />
      </View>
    </View>
  );
}

// ── SkeletonPartnerDetail — hero + info grid + events section ─────────────────

export function SkeletonPartnerDetail() {
  return (
    <View style={skeletonStyles.detailWrap}>
      {/* Hero image */}
      <Skeleton height={280} borderRadius={0} />

      <View style={skeletonStyles.detailBody}>
        {/* Tier callout */}
        <View style={skeletonStyles.row}>
          <Skeleton width={24} height={24} borderRadius={12} />
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton height={14} width="50%" borderRadius={RADIUS.sm} />
            <Skeleton height={11} width="80%" borderRadius={RADIUS.sm} />
          </View>
        </View>

        {/* Description block */}
        <View style={{ gap: 6, marginTop: SPACING.md }}>
          <Skeleton height={13} borderRadius={RADIUS.sm} />
          <Skeleton height={13} width="90%" borderRadius={RADIUS.sm} />
          <Skeleton height={13} width="75%" borderRadius={RADIUS.sm} />
        </View>

        {/* Info grid — 3 cards side by side */}
        <View style={[skeletonStyles.row, { marginTop: SPACING.lg, gap: SPACING.md }]}>
          <Skeleton height={80} borderRadius={RADIUS.lg} style={{ flex: 1 }} />
          <Skeleton height={80} borderRadius={RADIUS.lg} style={{ flex: 1 }} />
          <Skeleton height={80} borderRadius={RADIUS.lg} style={{ flex: 1 }} />
        </View>

        {/* Events section header */}
        <View style={[skeletonStyles.row, { marginTop: SPACING.lg, gap: 8 }]}>
          <Skeleton width={16} height={16} borderRadius={8} />
          <Skeleton height={16} width="40%" borderRadius={RADIUS.sm} />
        </View>

        {/* 3 event row stubs */}
        {[0, 1, 2].map((i) => (
          <View key={i} style={[skeletonStyles.row, skeletonStyles.eventRow]}>
            <Skeleton width={56} height={56} borderRadius={RADIUS.md} />
            <View style={{ flex: 1, gap: 6 }}>
              <Skeleton height={11} width="35%" borderRadius={RADIUS.sm} />
              <Skeleton height={13} width="85%" borderRadius={RADIUS.sm} />
              <Skeleton height={10} width="25%" borderRadius={RADIUS.full} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── SkeletonFeaturedRow — horizontal strip of wide cards ─────────────────────

export function SkeletonFeaturedRow() {
  return (
    <View style={skeletonStyles.featuredRow}>
      {[0, 1, 2].map((i) => (
        <Skeleton
          key={i}
          width={SCREEN_WIDTH * 0.72}
          height={200}
          borderRadius={RADIUS.xl}
          style={{ marginRight: SPACING.sm }}
        />
      ))}
    </View>
  );
}

// ── SkeletonGridRow — 2-column partner grid ───────────────────────────────────

export function SkeletonGrid({ rows = 3 }: { rows?: number }) {
  return (
    <View>
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <View key={rowIdx} style={skeletonStyles.gridRow}>
          <Skeleton width={CARD_WIDTH} height={170} borderRadius={RADIUS.lg} />
          <Skeleton width={CARD_WIDTH} height={170} borderRadius={RADIUS.lg} />
        </View>
      ))}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const skeletonStyles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.sm,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  textLine: {
    marginTop: SPACING.sm,
  },
  textLineSm: {
    marginTop: SPACING.xs,
  },
  list: {
    flex: 1,
    paddingTop: SPACING.lg,
  },
  heroWrap: {
    position: 'relative',
  },
  heroTextBlock: {
    position: 'absolute',
    bottom: SPACING.lg,
    left: SPACING.lg,
    right: SPACING.lg,
    gap: 4,
  },
  detailWrap: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  detailBody: {
    padding: SPACING.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  eventRow: {
    padding: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: SPACING.xs,
  },
  featuredRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xs,
  },
  gridRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.lg,
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
});
