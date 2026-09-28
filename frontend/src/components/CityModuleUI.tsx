// City hub ("Moverse") — shared visual atoms for /ciudad and /ciudad/[id]:
// the honesty badge (info | proximamente | en_vivo), the gradient icon-art
// block, the photo-over-art media block (never a black box while a JPEG loads),
// the collapsed fact row and the section expander that carry the hub's
// progressive disclosure. Every atom is module-scope: none is defined inside a
// screen render, so rows keep their identity (and focus) across re-renders.
import React, { useCallback, useEffect, useRef } from 'react';
import {
  Animated, Platform, StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, MOTION, RADIUS } from '../constants/theme';
import { ASSET_ORIGIN } from '../constants/api';
import { SafeImage } from './SafeImage';
import {
  CityFact, CityStatus, STATUS_META, formatCop, gradientFor, openExternal, pickL,
} from '../lib/cityModules';
import type { Lang } from '../i18n/translations';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// ── Honesty badge ────────────────────────────────────────────────────────────
type BadgeProps = {
  status: CityStatus;
  tr: (es: string) => string;
  style?: StyleProp<ViewStyle>;
  size?: 'sm' | 'md';
};

export function CityStatusBadge({ status, tr, style, size = 'sm' }: BadgeProps) {
  const meta = STATUS_META[status] || STATUS_META.info;
  const md = size === 'md';
  return (
    <View
      style={[badge.pill, { borderColor: meta.color, backgroundColor: meta.bg }, md && badge.pillMd, style]}
      accessibilityRole="text"
      accessibilityLabel={tr(meta.label)}
    >
      <Ionicons name={meta.icon as IconName} size={md ? 14 : 12} color={meta.color} />
      <Text style={[badge.text, { color: meta.color }, md && badge.textMd]}>{tr(meta.label)}</Text>
    </View>
  );
}

const badge = StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4,
  },
  pillMd: { paddingHorizontal: 11, paddingVertical: 5, gap: 5 },
  text: { fontSize: 10.5, ...FONTS.bold, letterSpacing: 0.6, textTransform: 'uppercase' },
  textMd: { fontSize: 11.5 },
});

// ── Gradient icon art ────────────────────────────────────────────────────────
type ArtProps = {
  id: string;
  icon: string;
  style?: StyleProp<ViewStyle>;
  iconSize?: number;
};

// Gradient block with the module's Ionicon — a large ghost glyph in the corner
// gives depth so it reads as art, not as a missing image.
export function CityIconArt({ id, icon, style, iconSize = 48 }: ArtProps) {
  const colors = gradientFor(id);
  const name = (icon || 'ellipse') as IconName;
  return (
    <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[art.box, style]}>
      <View style={art.ghost} pointerEvents="none">
        <Ionicons name={name} size={iconSize * 3.2} color="rgba(255,255,255,0.10)" />
      </View>
      <View style={art.disc}>
        <Ionicons name={name} size={iconSize} color="#FFFFFF" />
      </View>
    </LinearGradient>
  );
}

const art = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  ghost: { position: 'absolute', right: -24, bottom: -36 },
  disc: {
    width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(8,12,22,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)',
  },
});

// ── Photo over brand art ─────────────────────────────────────────────────────
type MediaProps = {
  id: string;
  icon: string;
  /** Root-relative '/images/...' path from modules.json; null = art only. */
  file?: string | null;
  height: number;
  iconSize?: number;
  accessibilityLabel?: string;
};

// The gradient art paints on the very first frame; the JPEG sits above it at
// opacity 0 and fades in only once it has actually loaded. SafeImage's own
// placeholder is COLORS.surface (#0F1524 — black on an OLED), so with a 200 KB
// photo on a slow link the old card read as dead for 10+ s. If every fallback
// fails, the art simply stays: it is the designed empty state, not an error.
export function CityMedia({ id, icon, file, height, iconSize = 48, accessibilityLabel }: MediaProps) {
  const reveal = useRef(new Animated.Value(0)).current;
  const uri = file ? ASSET_ORIGIN + file : null;

  // A new photo (module → module via replace) starts hidden again behind the art.
  useEffect(() => {
    reveal.setValue(0);
  }, [uri, reveal]);

  const onLoad = useCallback(() => {
    Animated.timing(reveal, {
      toValue: 1,
      duration: MOTION.duration.base,
      easing: MOTION.easing.standard,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [reveal]);

  return (
    <View style={[media.box, { height }]}>
      <CityIconArt id={id} icon={icon} style={[StyleSheet.absoluteFillObject, { height }]} iconSize={iconSize} />
      {uri ? (
        <Animated.View style={[StyleSheet.absoluteFillObject, { opacity: reveal }]} pointerEvents="none">
          <SafeImage
            uri={uri}
            category="attraction"
            style={[media.fill, { height }]}
            resizeMode="cover"
            onLoad={onLoad}
            accessibilityLabel={accessibilityLabel}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

const media = StyleSheet.create({
  box: { width: '100%', position: 'relative', overflow: 'hidden' },
  fill: { width: '100%', backgroundColor: 'transparent' },
});

// ── Collapsed fact row ───────────────────────────────────────────────────────
type FactRowProps = {
  fact: CityFact;
  lang: Lang;
  tr: (es: string) => string;
  open: boolean;
  onToggle: (key: string) => void;
  first: boolean;
};

// One fact, collapsed by default: label + the value (bold COP, or the sentence
// when there is no figure) + the confidence chip. The note, the official source
// and the verification date are one tap away — every source stays reachable
// (honesty doctrine) while the section fits one screen instead of three.
export function CityFactRow({ fact: f, lang, tr, open, onToggle, first }: FactRowProps) {
  const label = pickL(f.label, lang);
  const text = pickL(f.value_text, lang);
  const note = pickL(f.note, lang);
  const hasCop = typeof f.value_cop === 'number';
  const verify = f.confidence === 'VERIFY';
  // A VERIFY "free" (e.g. a 2019 news post as the only source) is hedged like any
  // other VERIFY value: no bold green, and the chip's word repeated next to it.
  const copText = f.value_cop === 0
    ? (verify ? `${tr('GRATIS')} · ${tr('Confirma')}` : tr('GRATIS'))
    : `${verify ? `${tr('aprox.')} ` : ''}${formatCop(f.value_cop as number, lang)}`;
  const chipLabel = tr(verify ? 'Confirma' : 'Oficial');
  const chipColor = verify ? COLORS.coral : COLORS.official;
  // Something to reveal: the sentence behind a COP figure, a note, a source, a date.
  const hasBody = (hasCop && !!text) || !!note || !!f.source_name || !!f.last_verified;

  const toggle = useCallback(() => onToggle(f.key), [onToggle, f.key]);
  const openSource = useCallback(() => openExternal(f.source_url), [f.source_url]);

  return (
    <View style={[row.wrap, !first && row.divider]} testID={`ciudad-fact-${f.key}`}>
      <TouchableOpacity
        style={row.head}
        onPress={toggle}
        disabled={!hasBody}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        aria-expanded={open} /* react-native-web 0.21 drops accessibilityState.expanded; aria-* maps on both platforms */
        accessibilityLabel={`${label}${hasCop ? ` · ${copText}` : ''} · ${chipLabel} · ${tr(open ? 'Ver menos' : 'Toca para ver nota y fuente')}`}
      >
        <View style={row.main}>
          <Text style={row.label} numberOfLines={open ? undefined : 2}>{label}</Text>
          {hasCop && (
            <Text style={[row.cop, f.value_cop === 0 && !verify && row.free, verify && row.copVerify]}>
              {copText}
            </Text>
          )}
          {!hasCop && !!text && (
            <Text style={row.text} numberOfLines={open ? undefined : 2}>{text}</Text>
          )}
        </View>
        <View style={row.right}>
          <View style={[row.chip, verify ? row.chipVerify : row.chipOfficial]}>
            <Ionicons name={verify ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={11} color={chipColor} />
            <Text style={[row.chipText, { color: chipColor }]}>{chipLabel}</Text>
          </View>
          {hasBody && (
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textFaint} />
          )}
        </View>
      </TouchableOpacity>

      {open && hasBody && (
        <View style={row.body}>
          {hasCop && !!text && <Text style={row.text}>{text}</Text>}
          {!!note && <Text style={row.note}>{note}</Text>}
          {!!f.source_name && (
            <TouchableOpacity
              style={row.source}
              onPress={openSource}
              disabled={!f.source_url}
              activeOpacity={0.7}
              accessibilityRole="link"
              accessibilityLabel={`${tr('Fuente')}: ${f.source_name} · ${tr('abre enlace externo')}`}
            >
              <Ionicons name="link-outline" size={11} color={COLORS.official} style={{ marginTop: 2 }} />
              <Text style={row.sourceText}>{f.source_name}</Text>
            </TouchableOpacity>
          )}
          {!!f.last_verified && (
            <Text style={row.verified}>{tr('Última verificación')}: {f.last_verified}</Text>
          )}
        </View>
      )}
    </View>
  );
}

const row = StyleSheet.create({
  wrap: { paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: COLORS.hairline },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  main: { flex: 1, gap: 3 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: 13, lineHeight: 17, color: COLORS.textMain, ...FONTS.semibold },
  cop: { fontSize: 16, lineHeight: 20, color: COLORS.textMain, ...FONTS.bold, letterSpacing: -0.2 },
  copVerify: { color: 'rgba(245,247,250,0.88)' },
  free: { color: '#22C55E' },
  text: { fontSize: 13, lineHeight: 18, color: COLORS.textMuted, ...FONTS.regular },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderRadius: RADIUS.full,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  // 8-digit hex alphas of the theme accents (8C = 55 %, 1A = 10 %, 59 = 35 %, 14 = 8 %)
  chipVerify: { borderColor: `${COLORS.coral}8C`, backgroundColor: `${COLORS.coral}1A` },
  chipOfficial: { borderColor: `${COLORS.official}59`, backgroundColor: `${COLORS.official}14` },
  chipText: { fontSize: 9.5, ...FONTS.bold, letterSpacing: 0.5, textTransform: 'uppercase' },
  body: { gap: 6, paddingTop: 6, paddingBottom: 4 },
  note: { fontSize: 12.5, lineHeight: 18, color: COLORS.textMuted, ...FONTS.regular, fontStyle: 'italic' },
  source: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, minHeight: 24 },
  sourceText: { flex: 1, fontSize: 11, lineHeight: 15, color: COLORS.official, ...FONTS.medium, textDecorationLine: 'underline' },
  verified: { fontSize: 10.5, lineHeight: 14, color: COLORS.textFaint, ...FONTS.medium },
});

// ── Section expander ─────────────────────────────────────────────────────────
type ExpanderProps = {
  label: string;
  onPress: () => void;
  expanded: boolean;
  testID?: string;
};

// "See all (8)" / "Show fewer" under a capped list. Full-width 44 pt target.
export function CityExpander({ label, onPress, expanded, testID }: ExpanderProps) {
  return (
    <TouchableOpacity
      style={exp.btn}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      aria-expanded={expanded}
      testID={testID}
    >
      <Text style={exp.text}>{label}</Text>
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={15} color={COLORS.official} />
    </TouchableOpacity>
  );
}

const exp = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    minHeight: 44, paddingVertical: 10, alignSelf: 'stretch',
  },
  text: { fontSize: 13.5, color: COLORS.official, ...FONTS.semibold },
});
