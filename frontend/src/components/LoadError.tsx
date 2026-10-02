import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '@/src/constants/theme';

// ── LoadError — a failed data load must never look like an empty result ──────
// P1-9: every `.catch(() => [])` that fed a list/counter/map/dashboard made an
// outage (CORS, 5xx, timeout, offline) indistinguishable from "there is nothing
// here". Screens now keep a `loadError` flag and render THIS in place of (or
// above) the empty-state copy, with a retry that re-runs the same loader.
//
// Dependency-free by design: theme tokens only. Copy is Spanish source text;
// callers that already have `tr()` pass `message={tr('No se pudo cargar')}` /
// `retryLabel={tr('Reintentar')}`.
//
// `compact` = one quiet inline line (home/explore rails, counters) — no layout
// jump. Default = a muted coral row with a hairline border for list/dash areas.

type Props = {
  /** Spanish source copy; default "No se pudo cargar". */
  message?: string;
  /** Spanish source copy; default "reintentar". */
  retryLabel?: string;
  onRetry: () => void;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export default function LoadError({
  message = 'No se pudo cargar',
  retryLabel = 'reintentar',
  onRetry,
  compact = false,
  style,
  testID = 'load-error',
}: Props) {
  return (
    <View
      style={[compact ? styles.rowCompact : styles.row, style]}
      accessibilityLiveRegion="polite"
      testID={testID}
    >
      <Text style={[styles.text, compact && styles.textCompact]} numberOfLines={compact ? 1 : 2}>
        {message}
        <Text style={styles.dash}>{' — '}</Text>
        <Text
          style={styles.retry}
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          suppressHighlighting
        >
          {retryLabel}
        </Text>
      </Text>
      {!compact && (
        <TouchableOpacity
          onPress={onRetry}
          style={styles.retryBtn}
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.7}
        >
          <Text style={styles.retryBtnText}>↻</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// COLORS.coral is the theme's "urgent-but-friendly" accent; 8-digit hex alpha
// is the documented translucent-bg pattern (see colorForKey in theme.ts).
const TINT_BG = COLORS.coral + '14';
const TINT_BORDER = COLORS.coral + '40';

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.md,
    marginHorizontal: SPACING.lg,
    marginVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: TINT_BORDER,
    backgroundColor: TINT_BG,
  },
  rowCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.lg,
  },
  text: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.coral,
    ...FONTS.medium,
  },
  textCompact: {
    fontSize: 12,
    lineHeight: 16,
  },
  dash: {
    color: COLORS.textFaint,
    ...FONTS.regular,
  },
  retry: {
    color: COLORS.coral,
    textDecorationLine: 'underline',
    ...FONTS.semibold,
  },
  retryBtn: {
    width: 28,
    height: 28,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TINT_BORDER,
  },
  retryBtnText: {
    color: COLORS.coral,
    fontSize: 15,
    lineHeight: 18,
    ...FONTS.bold,
  },
});
