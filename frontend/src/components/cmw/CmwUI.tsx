// CMW shared UI: the wordmark, the "Programa oficial" badge, category chips, the
// amber → coral buttons, section headers, the event card, the 8-chip date strip
// and the concierge card. Every user string goes through tr(); every fact comes
// from the program (src/lib/cmw.ts), which already blanked what is still to be
// confirmed, so these components can only ever print "por confirmar" for it.
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, LayoutChangeEvent, Platform, Pressable, ScrollView, StyleProp, StyleSheet, Text,
  TextStyle, TouchableOpacity, View, ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { Lang } from '../../i18n/translations';
import { SafeImage } from '../SafeImage';
import {
  CMW_CATEGORY_META, CMW_IMAGE_CREDIT, CmwBrand, CmwCategory, CmwEvent, dayLabel, dayParts, pickL, placeText, tbaLabel,
  timeText,
} from '../../lib/cmw';
import { CMW, CMW_GRADIENT, CMW_GUTTER, CMW_RADIUS, CMW_TYPE } from './cmwTheme';

export type Tr = (es: string) => string;
type IconName = keyof typeof Ionicons.glyphMap;

/** An Ionicon name the payload suggested, or a safe default. */
export const iconName = (name: string | null | undefined, fallback: IconName = 'sparkles-outline'): IconName => {
  if (!name) return fallback;
  const outline = `${name}-outline` as IconName;
  if (outline in Ionicons.glyphMap) return outline;
  return (name as IconName) in Ionicons.glyphMap ? (name as IconName) : fallback;
};

const webCursor = Platform.OS === 'web' ? ({ cursor: 'pointer' } as ViewStyle) : null;

// ── Wordmark ─────────────────────────────────────────────────────────────────
type WordmarkProps = { size?: 'hero' | 'card'; align?: 'left' | 'center'; style?: StyleProp<ViewStyle> };

/** "CARTAGENA / MUSIC WEEK", set like the cover. The hero size follows its own width. */
export function CmwWordmark({ size = 'hero', align = 'left', style }: WordmarkProps) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w && w !== width) setWidth(w);
  };
  // 9 Didone capitals at ~0.68 em plus tracking: 0.145 × width keeps "CARTAGENA"
  // on one line from 320 px up; the default equals the 390 px result (no jump).
  const big = size === 'hero' ? (width ? Math.max(36, Math.min(56, Math.floor(width * 0.145))) : 50) : 26;
  const sub = size === 'hero' ? Math.round(big * 0.42) : 12;
  const textAlign: TextStyle['textAlign'] = align;
  return (
    <View
      onLayout={onLayout}
      style={[{ alignSelf: 'stretch' }, style]}
      accessibilityRole="header"
      accessibilityLabel="Cartagena Music Week"
    >
      <Text style={[CMW_TYPE.display, { fontSize: big, lineHeight: Math.round(big * 1.06), letterSpacing: big * 0.04, textAlign }]} numberOfLines={1}>
        CARTAGENA
      </Text>
      <Text style={[CMW_TYPE.displaySub, { fontSize: sub, lineHeight: Math.round(sub * 1.3), letterSpacing: sub * 0.32, textAlign, marginTop: 2 }]} numberOfLines={1}>
        MUSIC WEEK
      </Text>
    </View>
  );
}

// ── Badge + chips ────────────────────────────────────────────────────────────
export function OfficialBadge({ tr, onImage = false, style }: { tr: Tr; onImage?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[ui.badge, onImage && ui.badgeOnImage, style]} testID="cmw-official-badge">
      <Ionicons name="ribbon-outline" size={12} color={CMW.gold} />
      <Text style={ui.badgeText}>{tr('Programa oficial')}</Text>
    </View>
  );
}

export function CategoryChip({ category, tr, onImage = false, style }: { category: CmwCategory; tr: Tr; onImage?: boolean; style?: StyleProp<ViewStyle> }) {
  const meta = CMW_CATEGORY_META[category];
  return (
    <View style={[ui.chip, onImage && ui.chipOnImage, style]}>
      <Ionicons name={iconName(meta.icon)} size={12} color={CMW.cream} />
      <Text style={ui.chipText}>{tr(meta.label)}</Text>
    </View>
  );
}

/** One fact line: an icon, the text; muted when the program still says "por confirmar". */
export function MetaRow({ icon, text, tba = false, style, testID }: { icon: IconName; text: string; tba?: boolean; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <View style={[ui.meta, style]} testID={testID}>
      <Ionicons name={icon} size={15} color={tba ? CMW.sandFaint : CMW.amber} />
      <Text style={[ui.metaText, tba && ui.metaTba]} numberOfLines={2}>{text}</Text>
    </View>
  );
}

// ── Buttons (≥ 48 px tall) ───────────────────────────────────────────────────
type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
};

export function CmwButton({ label, onPress, variant = 'primary', icon, iconRight, loading, disabled, small, style, testID, accessibilityLabel }: ButtonProps) {
  const off = !!disabled || !!loading;
  const color = variant === 'primary' ? CMW.onAccent : variant === 'secondary' ? CMW.cream : CMW.amber;
  const inner = (
    <View style={[ui.btnInner, small && ui.btnInnerSmall]}>
      {loading ? <ActivityIndicator size="small" color={color} /> : icon ? <Ionicons name={icon} size={small ? 15 : 17} color={color} /> : null}
      <Text style={[ui.btnText, small && ui.btnTextSmall, { color }]} numberOfLines={1}>{label}</Text>
      {iconRight && !loading ? <Ionicons name={iconRight} size={small ? 14 : 16} color={color} /> : null}
    </View>
  );
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled: off, busy: !!loading }}
      testID={testID}
      style={({ pressed }) => [
        ui.btn,
        small && ui.btnSmall,
        variant === 'secondary' && ui.btnSecondary,
        variant === 'ghost' && ui.btnGhost,
        pressed && { opacity: 0.85, transform: [{ scale: 0.985 }] },
        off && { opacity: 0.55 },
        webCursor,
        style,
      ]}
    >
      {variant === 'primary' ? (
        <LinearGradient colors={CMW_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={ui.btnFill}>
          {inner}
        </LinearGradient>
      ) : inner}
    </Pressable>
  );
}

// ── Section header ───────────────────────────────────────────────────────────
export function SectionHeader({ eyebrow, title, subtitle, style, testID }: { eyebrow?: string; title: string; subtitle?: string; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <View style={[ui.section, style]} testID={testID}>
      {!!eyebrow && <Text style={CMW_TYPE.eyebrow}>{eyebrow}</Text>}
      <Text style={[CMW_TYPE.h2, !!eyebrow && { marginTop: 6 }]} accessibilityRole="header">{title}</Text>
      {!!subtitle && <Text style={[CMW_TYPE.body, { marginTop: 4 }]}>{subtitle}</Text>}
    </View>
  );
}

// ── Event card ───────────────────────────────────────────────────────────────
type CardProps = {
  ev: CmwEvent;
  lang: Lang;
  tr: Tr;
  onPress: (id: string) => void;
  onRequest: (ev: CmwEvent) => void;
  priority?: 'low' | 'normal' | 'high';
  compact?: boolean;
  /** false on the hub, where the hero already prints "Programa oficial" (cards elsewhere keep it). */
  showBadge?: boolean;
  testID?: string;
};

/** "Very Special Guest · artista por confirmar" for a main event; the printed subtitle otherwise. */
export function subtitleText(ev: CmwEvent, lang: Lang, tr: Tr): string {
  if (ev.artist_status === 'tba') return `${ev.artist || 'Very Special Guest'} · ${tr(tbaLabel('artist'))}`;
  if (ev.artist_status === 'confirmed' && ev.artist) return ev.artist;
  return pickL(ev.subtitle, lang);
}

export function CmwEventCard({ ev, lang, tr, onPress, onRequest, priority = 'normal', compact = false, showBadge = true, testID }: CardProps) {
  const place = placeText(ev);
  const time = timeText(ev);
  const subtitle = subtitleText(ev, lang, tr);
  const meta = CMW_CATEGORY_META[ev.category];
  return (
    <Pressable
      onPress={() => onPress(ev.id)}
      accessibilityRole="button"
      accessibilityLabel={`${ev.title} · ${dayLabel(ev.date, lang, { weekday: true })}`}
      testID={testID}
      style={({ pressed }) => [ui.card, pressed && { opacity: 0.92 }, webCursor]}
    >
      <View style={[ui.cardMedia, compact && ui.cardMediaCompact]}>
        <SafeImage uri={ev.image} category={meta.image} style={StyleSheet.absoluteFillObject} priority={priority} accessibilityLabel={`${tr('Arte del evento')} · ${ev.image_credit || CMW_IMAGE_CREDIT}`} />
        <LinearGradient colors={['rgba(8,12,22,0)', 'rgba(20,17,26,0.55)', CMW.surface]} locations={[0.35, 0.8, 1]} style={StyleSheet.absoluteFillObject} pointerEvents="none" />
        <View style={[ui.cardTopRow, !showBadge && { justifyContent: 'flex-end' }]} pointerEvents="none">
          {showBadge ? <OfficialBadge tr={tr} onImage /> : null}
          <CategoryChip category={ev.category} tr={tr} onImage />
        </View>
      </View>
      <View style={ui.cardBody}>
        <Text style={CMW_TYPE.h3} numberOfLines={2}>{ev.title}</Text>
        {!!subtitle && <Text style={[ui.cardSubtitle, ev.artist_status === 'tba' && ui.cardSubtitleTba]} numberOfLines={2}>{subtitle}</Text>}
        <View style={ui.cardMetaWrap}>
          <MetaRow icon="location-outline" text={place.tba ? tr(place.text) : place.text} tba={place.tba} />
          <MetaRow icon="time-outline" text={time || tr(tbaLabel('time'))} tba={!time} />
        </View>
        <View style={ui.cardFooter}>
          <View style={ui.cardPrice}>
            <Text style={ui.cardPriceLabel}>{tr('Precio')}</Text>
            <Text style={ui.cardPriceValue}>{ev.price_info || tr('Consultar')}</Text>
          </View>
          <CmwButton label={tr('Solicitar acceso')} onPress={() => onRequest(ev)} small testID={testID ? `${testID}-request` : undefined} />
        </View>
      </View>
    </Pressable>
  );
}

// ── 8-chip date strip ────────────────────────────────────────────────────────
type StripProps = {
  days: string[];
  active: string | null;
  today: string | null;
  counts: Record<string, number>;
  lang: Lang;
  tr: Tr;
  onSelect: (day: string) => void;
  style?: StyleProp<ViewStyle>;
};

export const CMW_CHIP_W = 62;
export const CMW_CHIP_GAP = 8;

export function CmwDateStrip({ days, active, today, counts, lang, tr, onSelect, style }: StripProps) {
  const ref = useRef<ScrollView>(null);
  // Keep the active chip in view (the strip shows about five of the eight days).
  useEffect(() => {
    const i = active ? days.indexOf(active) : -1;
    if (i < 0) return;
    const x = Math.max(0, i * (CMW_CHIP_W + CMW_CHIP_GAP) - CMW_CHIP_W);
    ref.current?.scrollTo({ x, animated: true });
  }, [active, days]);
  return (
    <ScrollView
      ref={ref}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={ui.strip}
      style={[ui.stripScroll, style]}
      testID="cmw-date-strip"
    >
      {days.map((d, i) => {
        const p = dayParts(d, lang);
        const on = active === d;
        const isToday = today === d;
        const n = counts[d] || 0;
        return (
          <TouchableOpacity
            key={d}
            onPress={() => onSelect(d)}
            activeOpacity={0.8}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            aria-selected={on}
            accessibilityLabel={`${tr('Día {n}').replace('{n}', String(i + 1))} · ${dayLabel(d, lang, { weekday: true })}`}
            testID={`cmw-day-${d}`}
            style={[ui.dchip, on && ui.dchipOn, isToday && !on && ui.dchipToday]}
          >
            <Text style={[ui.dchipMonth, on && ui.dchipTextOn]}>{isToday ? tr('Hoy') : (p?.month || '').replace('.', '')}</Text>
            <Text style={[ui.dchipDay, on && ui.dchipTextOn]}>{p ? String(p.day).padStart(2, '0') : '--'}</Text>
            <View style={ui.dchipDots} pointerEvents="none">
              {Array.from({ length: Math.min(n, 3) }, (_, k) => (
                <View key={k} style={[ui.dchipDot, on && ui.dchipDotOn]} />
              ))}
            </View>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// ── Concierge card ───────────────────────────────────────────────────────────
type ConciergeProps = {
  brand: CmwBrand | null;
  lang: Lang;
  tr: Tr;
  onWhatsApp: () => void;
  onRequest: () => void;
  image?: string | null;
  style?: StyleProp<ViewStyle>;
};

export function CmwConciergeCard({ brand, lang, tr, onWhatsApp, onRequest, image = '/images/cmw/concierge.jpg', style }: ConciergeProps) {
  const con = brand?.concierge || null;
  const intro = con?.intro ? pickL(con.intro, lang) : '';
  const note = con?.assistant_note ? pickL(con.assistant_note, lang) : '';
  const services = con?.services?.length ? con.services : [];
  return (
    <View style={[ui.concierge, style]} testID="cmw-concierge-card">
      <View style={ui.conciergeMedia}>
        <SafeImage uri={image} category="service" style={StyleSheet.absoluteFillObject} accessibilityLabel={`${tr('Arte del evento')} · ${CMW_IMAGE_CREDIT}`} />
        <LinearGradient colors={['rgba(20,17,26,0.05)', 'rgba(20,17,26,0.65)', CMW.surface]} locations={[0.2, 0.75, 1]} style={StyleSheet.absoluteFillObject} pointerEvents="none" />
        <View style={ui.conciergeHead} pointerEvents="none">
          <Text style={CMW_TYPE.eyebrow}>{tr('Contacto')}</Text>
          <Text style={[CMW_TYPE.h2, { marginTop: 4 }]}>{tr('Concierge y asistencia')}</Text>
        </View>
      </View>
      <View style={ui.conciergeBody}>
        {!!intro && <Text style={CMW_TYPE.body}>{intro}</Text>}
        {services.length > 0 && (
          <View style={ui.services}>
            {services.map((s, i) => (
              <View key={i} style={ui.service}>
                <Ionicons name="checkmark" size={13} color={CMW.gold} />
                <Text style={ui.serviceText}>{pickL(s, lang)}</Text>
              </View>
            ))}
          </View>
        )}
        <View style={ui.phoneRow}>
          <Ionicons name="logo-whatsapp" size={16} color={CMW.gold} />
          <Text style={ui.phone} selectable>{con?.display || '+57 311 6844492'}</Text>
        </View>
        {!!note && <Text style={[CMW_TYPE.small, { marginTop: 6 }]}>{note}</Text>}
        <CmwButton label={tr('Escribir por WhatsApp')} icon="logo-whatsapp" onPress={onWhatsApp} style={{ marginTop: 16 }} testID="cmw-concierge-whatsapp" />
        <CmwButton label={tr('Solicitar acceso')} variant="secondary" icon="ticket-outline" onPress={onRequest} style={{ marginTop: 10 }} testID="cmw-concierge-request" />
      </View>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const ui = StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    paddingHorizontal: 9, height: 24, borderRadius: CMW_RADIUS.chip,
    borderWidth: 1, borderColor: 'rgba(242,201,121,0.45)', backgroundColor: 'rgba(242,201,121,0.10)',
  },
  badgeOnImage: { backgroundColor: 'rgba(8,12,22,0.62)' },
  badgeText: { fontSize: 9.5, lineHeight: 12, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase', color: CMW.gold },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    paddingHorizontal: 9, height: 24, borderRadius: CMW_RADIUS.chip,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: 'rgba(255,255,255,0.08)',
  },
  chipOnImage: { backgroundColor: 'rgba(8,12,22,0.58)' },
  chipText: { fontSize: 10.5, lineHeight: 13, fontWeight: '700', letterSpacing: 0.4, color: CMW.cream },

  meta: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  metaText: { flex: 1, fontSize: 13.5, lineHeight: 19, fontWeight: '500', color: CMW.cream },
  metaTba: { color: CMW.sandFaint, fontStyle: 'italic' },

  btn: { minHeight: 48, borderRadius: CMW_RADIUS.chip, overflow: 'hidden', alignSelf: 'stretch' },
  btnSmall: { minHeight: 44, alignSelf: 'flex-start' },
  btnSecondary: { borderWidth: 1.2, borderColor: 'rgba(244,164,58,0.55)', backgroundColor: 'rgba(244,164,58,0.06)' },
  btnGhost: { backgroundColor: 'transparent' },
  btnFill: { flex: 1, minHeight: 48, justifyContent: 'center' },
  btnInner: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18 },
  btnInnerSmall: { minHeight: 44, paddingHorizontal: 14, gap: 6 },
  btnText: { fontSize: 14.5, lineHeight: 18, fontWeight: '700', letterSpacing: 0.2 },
  btnTextSmall: { fontSize: 13, lineHeight: 16 },

  section: { paddingHorizontal: CMW_GUTTER },

  card: {
    backgroundColor: CMW.surface, borderRadius: CMW_RADIUS.card, borderWidth: 1, borderColor: CMW.lineSoft, overflow: 'hidden',
  },
  cardMedia: { height: 176, backgroundColor: CMW.surfaceAlt },
  cardMediaCompact: { height: 132 },
  cardTopRow: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  cardBody: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 16, gap: 10 },
  cardSubtitle: { ...CMW_TYPE.small, marginTop: -4, color: CMW.sand },
  cardSubtitleTba: { color: CMW.gold },
  cardMetaWrap: { gap: 6 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 4 },
  cardPrice: { flexShrink: 1 },
  cardPriceLabel: { fontSize: 10, lineHeight: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: CMW.sandFaint },
  cardPriceValue: { fontSize: 14, lineHeight: 18, fontWeight: '600', color: CMW.cream, marginTop: 2 },

  stripScroll: { flexGrow: 0 },
  strip: { paddingHorizontal: CMW_GUTTER, gap: CMW_CHIP_GAP, paddingVertical: 2 },
  dchip: {
    width: CMW_CHIP_W, height: 72, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 2,
    backgroundColor: CMW.surface, borderWidth: 1, borderColor: CMW.lineSoft,
  },
  dchipOn: { backgroundColor: CMW.amber, borderColor: CMW.amber },
  dchipToday: { borderColor: 'rgba(244,164,58,0.7)' },
  dchipMonth: { fontSize: 10, lineHeight: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: CMW.sandFaint },
  dchipDay: { ...CMW_TYPE.dayNumber, fontSize: 22, lineHeight: 24 },
  dchipTextOn: { color: CMW.onAccent },
  dchipDots: { flexDirection: 'row', gap: 3, height: 5, marginTop: 2 },
  dchipDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: CMW.amber },
  dchipDotOn: { backgroundColor: CMW.onAccent },

  concierge: { backgroundColor: CMW.surface, borderRadius: CMW_RADIUS.card, borderWidth: 1, borderColor: CMW.line, overflow: 'hidden' },
  conciergeMedia: { height: 190, justifyContent: 'flex-end' },
  conciergeHead: { position: 'absolute', left: 18, right: 18, bottom: 10 },
  conciergeBody: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 18 },
  services: { marginTop: 14, gap: 8 },
  service: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  serviceText: { fontSize: 13.5, lineHeight: 18, fontWeight: '500', color: CMW.cream },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  phone: { fontSize: 18, lineHeight: 22, fontWeight: '600', letterSpacing: 0.5, color: CMW.white },
});
