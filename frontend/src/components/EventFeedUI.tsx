// EVENTS-ELITE — shared visual atoms for every verified-feed surface (/que-pasa,
// /event/[id], Home, Agenda, Explore, Search, Favorites). One place renders the
// honesty labels so no screen can drift:
//   • VERIFY  → coral "Sin confirmar · verifica con el organizador" (short: "Sin confirmar")
//   • partner → neutral "Publicado por <venue>" (partner rows are never "verified")
//   • sold out → "Agotado"
//   • trust line → "Fuente: X · verificado 28 sep" ("sin actualizar" when offline)
// Every atom is module-scope (no component defined inside a render).
//
// §16 (prominence + clean calendar) atoms live here too so /que-pasa, Home and
// the Agenda tab render ONE vocabulary: EventHeroCard (Destacados), EventDayRow
// (the calendar row: date/time lead column in the category tint + compact
// card), DateStrip (weekday · number · count), UmbrellaGroupCard (one card per
// festival program, expanding in place), EventNowCard ("Ahora en Cartagena"),
// FeedDayHeader / FeedMonthHeader and FeedEmptyLine (one line + a link, never a
// box). Max 3 badges per card, one accent colour per category.
import React, { useCallback, useEffect, useRef } from 'react';
import { Animated, Platform, ScrollView, StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, ELEVATION, FONTS, MOTION, RADIUS, SPACING } from '../constants/theme';
import { SafeImage } from './SafeImage';
import { PressableScale } from './PressableScale';
import type { Lang } from '../i18n/translations';
import { weekdayShort } from '../lib/formatDate';
import {
  CATEGORY_META, NowItem, PublicEvent, capFirst, formatDayShort, formatEventDates, formatEventTime, formatMonthShort,
  formatStamp, formatVerifiedDate, pickL, plusDays, tbcMonth, weekdayOf,
} from '../lib/eventsFeed';

type Tr = (es: string) => string;
type IconName = React.ComponentProps<typeof Ionicons>['name'];

// ── Venue label ──────────────────────────────────────────────────────────────
// A venue_name is a proper name and never translated — except the few descriptive
// phrases the anchors use for city-wide events, which read in the app language.
const DESCRIPTIVE_VENUES: readonly string[] = [
  'Varios escenarios · Cartagena de Indias',
];

/** The venue as the cards print it: the name, or its translation for a descriptive phrase. */
export function venueLabel(name: string | null | undefined, tr: Tr): string {
  const v = (name || '').trim();
  if (!v) return '';
  return DESCRIPTIVE_VENUES.includes(v) ? tr(v) : v;
}

/** The primary source of a composite "IPCC · Alcaldía de Cartagena (agenda oficial)" name. */
const primarySource = (name: string): string => name.split(' · ')[0].trim() || name;

// ── Media: category art first, the event's own photo only when it has one ────
// An event without an image never borrows a stock photo (the generic web
// category photo is an airplane): it shows its category's gradient art, the
// designed empty state. A real /images/… photo fades in over the art once it
// has actually loaded, so a slow JPEG is never a black box (the /ciudad
// CityMedia pattern).
type MediaProps = {
  ev: PublicEvent;
  height: number | '100%';
  iconSize?: number;
  priority?: 'low' | 'normal' | 'high';
  accessibilityLabel?: string;
  /** 'hero': no centred disc (the hero's text block sits there); the ghost icon moves up. */
  variant?: 'default' | 'hero';
};

export function EventMedia({ ev, height, iconSize = 30, priority = 'normal', accessibilityLabel, variant = 'default' }: MediaProps) {
  const meta = CATEGORY_META[ev.category] || CATEGORY_META.cultural;
  const reveal = useRef(new Animated.Value(0)).current;
  useEffect(() => { reveal.setValue(0); }, [ev.image_url, reveal]);
  const onLoad = useCallback(() => {
    Animated.timing(reveal, {
      toValue: 1, duration: MOTION.duration.base, easing: MOTION.easing.standard, useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [reveal]);
  const icon = meta.icon as IconName;
  return (
    <View style={[ui.media, { height }]}>
      <LinearGradient colors={[`${meta.color}E6`, '#0F1524']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFillObject}>
        <View style={variant === 'hero' ? ui.mediaGhostHero : ui.mediaGhost} pointerEvents="none">
          <Ionicons name={icon} size={iconSize * (variant === 'hero' ? 4.4 : 3.4)} color="rgba(255,255,255,0.10)" />
        </View>
        {variant === 'hero' ? null : (
          <View style={ui.mediaCenter} pointerEvents="none">
            <View style={[ui.mediaDisc, { width: iconSize * 1.9, height: iconSize * 1.9, borderRadius: iconSize }]}>
              <Ionicons name={icon} size={iconSize} color="#FFFFFF" />
            </View>
          </View>
        )}
      </LinearGradient>
      {ev.image_url ? (
        <Animated.View style={[StyleSheet.absoluteFillObject, { opacity: reveal }]} pointerEvents="none">
          <SafeImage
            uri={ev.image_url}
            category={meta.image}
            priority={priority}
            style={ui.mediaImg}
            resizeMode="cover"
            onLoad={onLoad}
            accessibilityLabel={accessibilityLabel}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

// ── Category badge ───────────────────────────────────────────────────────────
export function EventCategoryBadge({ ev, tr, style }: { ev: PublicEvent; tr: Tr; style?: StyleProp<ViewStyle> }) {
  const meta = CATEGORY_META[ev.category] || CATEGORY_META.cultural;
  return (
    <View style={[ui.cat, { borderColor: `${meta.color}8C`, backgroundColor: `${meta.color}1F` }, style]}>
      <Ionicons name={meta.icon as IconName} size={10} color={meta.color} />
      <Text style={[ui.catText, { color: meta.color }]} numberOfLines={1}>{tr(meta.label)}</Text>
    </View>
  );
}

// ── Honesty chip (VERIFY / partner) ─────────────────────────────────────────
type TrustChipProps = {
  ev: PublicEvent;
  tr: Tr;
  /** 'full' = "Sin confirmar · verifica con el organizador"; 'short' = "Sin confirmar". */
  variant?: 'full' | 'short';
  /** Also render the blue "Verificado" chip for HIGH rows (detail screen). */
  showVerified?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function EventTrustChip({ ev, tr, variant = 'short', showVerified = false, style }: TrustChipProps) {
  if (ev.origin === 'partner') {
    const label = tr('Publicado por {venue}').replace('{venue}', ev.venue_name || tr('el local'));
    return (
      <View style={[ui.chip, ui.chipPartner, style]} accessibilityLabel={label}>
        <Ionicons name="storefront-outline" size={10} color={COLORS.icon} />
        <Text style={[ui.chipText, { color: COLORS.icon }]} numberOfLines={1}>{label}</Text>
      </View>
    );
  }
  if (ev.confidence === 'VERIFY') {
    const label = tr(variant === 'full' ? 'Sin confirmar · verifica con el organizador' : 'Sin confirmar');
    return (
      <View style={[ui.chip, ui.chipVerify, style]} accessibilityLabel={tr('Sin confirmar · verifica con el organizador')}>
        <Ionicons name="alert-circle-outline" size={10} color={COLORS.coral} />
        <Text style={[ui.chipText, { color: COLORS.coral }]} numberOfLines={variant === 'full' ? 2 : 1}>{label}</Text>
      </View>
    );
  }
  if (!showVerified) return null;
  return (
    <View style={[ui.chip, ui.chipOfficial, style]}>
      <Ionicons name="checkmark-circle-outline" size={10} color={COLORS.official} />
      <Text style={[ui.chipText, { color: COLORS.official }]}>{tr('Verificado')}</Text>
    </View>
  );
}

export function EventSoldOutChip({ tr, style }: { tr: Tr; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[ui.chip, ui.chipSoldOut, style]}>
      <Ionicons name="close-circle-outline" size={10} color={COLORS.mustard} />
      <Text style={[ui.chipText, { color: COLORS.mustard }]}>{tr('Agotado')}</Text>
    </View>
  );
}

// ── Trust line ───────────────────────────────────────────────────────────────
type TrustLineProps = { ev: PublicEvent; lang: Lang; tr: Tr; offline: boolean; style?: StyleProp<ViewStyle> };

/** "Fuente: IPCC · verificado 28 sep" — offline copies say "sin actualizar" instead.
 *  Cards name the PRIMARY source only (a composite "IPCC · Alcaldía de Cartagena (agenda
 *  oficial)" name is the detail page's business) and the row wraps, so the source is never
 *  cut mid-word and the verification state — the §13 J1 "sin actualizar" — stays visible. */
export function EventTrustLine({ ev, lang, tr, offline, style }: TrustLineProps) {
  if (!ev.source_name) return null;
  const when = offline ? tr('sin actualizar') : (() => {
    const d = formatVerifiedDate(ev.last_verified, lang);
    return d ? `${tr('verificado')} ${d}` : '';
  })();
  const source = `${tr('Fuente')}: ${primarySource(ev.source_name)}`;
  return (
    <View
      style={[ui.trustRow, style]}
      accessible
      accessibilityLabel={when ? `${source} · ${when}` : source}
    >
      <Ionicons name={offline ? 'cloud-offline-outline' : 'shield-checkmark-outline'} size={11} color={COLORS.textFaint} />
      <Text style={ui.trustText} numberOfLines={1}>{source}</Text>
      {when ? <Text style={ui.trustWhen} numberOfLines={1}>{`· ${when}`}</Text> : null}
    </View>
  );
}

// ── Offline banner ───────────────────────────────────────────────────────────
export function FeedOfflineBanner({ stamp, lang, tr, style }: { stamp: string; lang: Lang; tr: Tr; style?: StyleProp<ViewStyle> }) {
  const when = formatStamp(stamp, lang);
  return (
    <View style={[ui.offline, style]} accessibilityRole="alert" testID="events-offline-banner">
      <Ionicons name="cloud-offline-outline" size={15} color={COLORS.mustard} />
      <Text style={ui.offlineText}>{tr('Sin conexión · agenda del {d}').replace('{d}', when || '—')}</Text>
    </View>
  );
}

// ── Compact row (Agenda, Search, Favorites) ──────────────────────────────────
type RowProps = {
  ev: PublicEvent;
  lang: Lang;
  tr: Tr;
  offline: boolean;
  onPress: () => void;
  /** Hide the date (a day-scoped list already says which day). */
  hideDate?: boolean;
  /** Optional status line that replaces date/time (e.g. hidden/expired favorites). */
  statusLine?: string | null;
  right?: React.ReactNode;
  testID?: string;
};

export function EventRow({ ev, lang, tr, offline, onPress, hideDate, statusLine, right, testID }: RowProps) {
  const title = pickL(ev.title, lang);
  const dates = ev.status === 'published' && !hideDate ? formatEventDates(ev, lang) : '';
  const time = ev.status === 'published' ? formatEventTime(ev) : '';
  const tbc = ev.status === 'date_tbc' ? (pickL(ev.date_tbc_note, lang) || tr('Fecha por confirmar')) : '';
  const when = statusLine || tbc || [dates, time].filter(Boolean).join(' · ');
  return (
    <TouchableOpacity
      style={ui.row}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`${title}${when ? ` · ${when}` : ''}`}
      testID={testID}
    >
      <View style={ui.rowThumbWrap}>
        <EventMedia ev={ev} height="100%" iconSize={18} />
      </View>
      <View style={ui.rowBody}>
        <Text style={ui.rowTitle} numberOfLines={2}>{title}</Text>
        {!!when && (
          <View style={ui.rowMeta}>
            <Ionicons name={statusLine ? 'information-circle-outline' : 'calendar-outline'} size={11} color={COLORS.textMuted} />
            <Text style={ui.rowMetaText} numberOfLines={1}>{when}</Text>
          </View>
        )}
        {!!ev.venue_name && (
          <View style={ui.rowMeta}>
            <Ionicons name="location-outline" size={11} color={COLORS.textMuted} />
            <Text style={ui.rowMetaText} numberOfLines={1}>{venueLabel(ev.venue_name, tr)}</Text>
          </View>
        )}
        <View style={ui.rowChips}>
          <EventCategoryBadge ev={ev} tr={tr} />
          <EventTrustChip ev={ev} tr={tr} />
          {ev.sold_out && ev.status === 'published' ? <EventSoldOutChip tr={tr} /> : null}
        </View>
        {!statusLine && <EventTrustLine ev={ev} lang={lang} tr={tr} offline={offline} style={{ marginTop: 4 }} />}
      </View>
      {right ?? <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} style={{ alignSelf: 'center' }} />}
    </TouchableOpacity>
  );
}

// ═════════════════════════════ §16 atoms ═════════════════════════════════════
const metaOf = (ev: PublicEvent) => CATEGORY_META[ev.category] || CATEGORY_META.cultural;

/** A sub-event's umbrella name for the "Parte de:" tag, without a trailing edition year. */
export function umbrellaShortName(umbrella: PublicEvent, lang: Lang): string {
  return pickL(umbrella.title, lang).replace(/\s+(19|20)\d{2}$/, '');
}

/** "Hoy · mar 29 sep" / "Mañana · mié 30 sep" / "Sáb 3 oct" (§16.3 day headers). */
export function dayHeaderText(day: string, today: string, lang: Lang, tr: Tr): string {
  const short = formatDayShort(day, lang);
  if (day === today) return `${tr('Hoy')} · ${short}`;
  if (day === plusDays(today, 1)) return `${tr('Mañana')} · ${short}`;
  return capFirst(short);
}

const countLabel = (n: number, tr: Tr): string => `${n} ${tr(n === 1 ? 'evento' : 'eventos')}`;

// ── Hero card ("Destacados") ──────────────────────────────────────────────────
type HeroProps = {
  ev: PublicEvent;
  lang: Lang;
  tr: Tr;
  offline: boolean;
  width: number;
  height?: number;
  onPress: (id: string) => void;
  /** Umbrella: live sub-events ("21 eventos del programa"). */
  programCount?: number;
  priority?: 'low' | 'normal' | 'high';
  testID?: string;
};

export function EventHeroCard({ ev, lang, tr, offline, width, height = 228, onPress, programCount, priority = 'normal', testID }: HeroProps) {
  const meta = metaOf(ev);
  const title = pickL(ev.title, lang);
  const dates = formatEventDates(ev, lang);
  const when = [dates, ev.start_time || ''].filter(Boolean).join(' · ');
  const program = ev.is_umbrella && programCount ? countLabel(programCount, tr) : '';
  const open = useCallback(() => onPress(ev.event_id), [onPress, ev.event_id]);
  const showTrustChip = ev.confidence === 'VERIFY' || ev.origin === 'partner';
  const venue = venueLabel(ev.venue_name, tr);
  return (
    <PressableScale
      style={[ui.hero, { width, height, borderColor: `${meta.color}47` }]}
      onPress={open}
      accessibilityLabel={[title, when, venue, tr(meta.label)].filter(Boolean).join(' · ')}
      testID={testID}
    >
      <EventMedia ev={ev} height="100%" iconSize={34} priority={priority} accessibilityLabel={title} variant="hero" />
      <LinearGradient
        colors={['rgba(8,12,22,0.10)', 'rgba(8,12,22,0.55)', 'rgba(8,12,22,0.97)']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
      <View style={ui.heroTop} pointerEvents="none">
        <View style={ui.heroCat}>
          <View style={[ui.dot, { backgroundColor: meta.color }]} />
          <Text style={ui.heroCatText} numberOfLines={1}>{tr(meta.label)}</Text>
        </View>
        {ev.flagship ? (
          <View style={ui.heroStar} accessibilityLabel={tr('Destacado')}>
            <Ionicons name="star" size={12} color={COLORS.mustard} />
          </View>
        ) : null}
      </View>
      <View style={ui.heroBottom} pointerEvents="none">
        {!!when && (
          <Text style={ui.heroWhen} numberOfLines={1}>
            {when.toUpperCase()}{program ? <Text style={ui.heroProgram}>{`  ·  ${program}`}</Text> : null}
          </Text>
        )}
        <Text style={ui.heroTitle} numberOfLines={2}>{title}</Text>
        {!!venue && (
          <View style={ui.heroMeta}>
            <Ionicons name="location-outline" size={12} color="rgba(245,247,250,0.72)" />
            <Text style={ui.heroMetaText} numberOfLines={1}>{venue}</Text>
          </View>
        )}
        {showTrustChip ? <EventTrustChip ev={ev} tr={tr} style={ui.heroChip} /> : null}
        <EventTrustLine ev={ev} lang={lang} tr={tr} offline={offline} style={ui.heroTrust} />
      </View>
    </PressableScale>
  );
}

// ── Calendar row (§16.3: lead column in the category tint + compact card) ────
type DayRowProps = {
  ev: PublicEvent;
  lang: Lang;
  tr: Tr;
  offline: boolean;
  onPress: (id: string) => void;
  /** 'date' = day number + weekday (Próximos); 'time' = start time (a day-scoped list);
   *  'tbc' = the announced month over "?" (the "Por confirmar" section: never a date). */
  lead: 'date' | 'time' | 'tbc';
  /** "Parte de: Fiestas de Independencia" (a sub-event listed on its own day). */
  partOf?: string | null;
  /** Inside a festival program: tighter row; `hideTrust` drops a trust line that repeats the umbrella's. */
  dense?: boolean;
  hideTrust?: boolean;
  testID?: string;
};

export function EventDayRow({ ev, lang, tr, offline, onPress, lead, partOf, dense, hideTrust, testID }: DayRowProps) {
  const meta = metaOf(ev);
  const title = pickL(ev.title, lang);
  const icon = meta.icon as IconName;
  const tbc = lead === 'tbc';
  const multi = !tbc && !!ev.start_date && !!ev.end_date && ev.end_date !== ev.start_date;
  const sameMonth = multi && (ev.end_date as string).slice(0, 7) === (ev.start_date as string).slice(0, 7);
  const range = multi ? formatEventDates(ev, lang) : '';
  // A same-month range lives in the date badge ("9–17" over "ENE"); a cross-month one gets its
  // own line under the venue. The venue always keeps the full first line.
  const badgeRange = lead === 'date' && sameMonth;
  const rangeLine = multi && !badgeRange ? range : '';
  const timeText = lead === 'date' ? ev.start_time || '' : '';
  const month = tbc ? tbcMonth(ev) : null;
  const tbcNote = tbc
    ? (month ? `${formatMonthShort(month.month0, lang)} ${month.year} · ${lowerFirst(tr('Por confirmar'))}` : tr('Fecha por confirmar'))
    : '';
  const day = ev.start_date ? String(Number(ev.start_date.slice(8, 10))) : '';
  const wd = ev.start_date ? weekdayShort(weekdayOf(ev.start_date), lang, true).replace(/\.$/, '') : '';
  const open = useCallback(() => onPress(ev.event_id), [onPress, ev.event_id]);
  const trustChip = !tbc && (ev.confidence === 'VERIFY' || ev.origin === 'partner');
  const soldOut = ev.sold_out && ev.status === 'published';
  const venue = venueLabel(ev.venue_name, tr);
  const a11y = [title, lead === 'date' && ev.start_date ? formatDayShort(ev.start_date, lang) : '', tbcNote,
    formatEventTime(ev), range, venue, tr(meta.label), ev.flagship ? tr('Destacado') : '']
    .filter(Boolean).join(' · ');
  return (
    <TouchableOpacity
      style={[ui.drow, dense && ui.drowDense, ev.flagship && { borderColor: `${meta.color}8C` }]}
      onPress={open}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      testID={testID}
    >
      <View style={[ui.lead, dense && ui.leadDense, { backgroundColor: `${meta.color}1C`, borderRightColor: `${meta.color}33` }]}>
        {tbc ? (
          <>
            <Text style={[ui.leadSub, { color: meta.color }]} numberOfLines={1}>
              {month ? formatMonthShort(month.month0, lang).replace(/\.$/, '').toUpperCase() : ''}
            </Text>
            <Text style={[ui.leadNum, { color: meta.color }]}>?</Text>
            <Ionicons name={icon} size={12} color={`${meta.color}B3`} style={ui.leadIcon} />
          </>
        ) : lead === 'date' ? (
          <>
            <Text style={[ui.leadNum, badgeRange && ui.leadRange, { color: meta.color }]} numberOfLines={1}>
              {badgeRange ? `${day}–${Number((ev.end_date as string).slice(8, 10))}` : day}
            </Text>
            <Text style={[ui.leadSub, { color: meta.color }]} numberOfLines={1}>
              {badgeRange ? formatMonthShort(Number((ev.start_date as string).slice(5, 7)) - 1, lang).replace(/\.$/, '').toUpperCase() : wd}
            </Text>
            <Ionicons name={icon} size={12} color={`${meta.color}B3`} style={ui.leadIcon} />
          </>
        ) : ev.start_time ? (
          <>
            <Text style={[ui.leadTime, { color: meta.color }]}>{ev.start_time}</Text>
            {ev.end_time && ev.end_time !== ev.start_time ? <Text style={ui.leadEnd}>{ev.end_time}</Text> : null}
            <Ionicons name={icon} size={12} color={`${meta.color}B3`} style={ui.leadIcon} />
          </>
        ) : (
          <Ionicons name={icon} size={20} color={meta.color} />
        )}
      </View>
      <View style={[ui.drowBody, dense && ui.drowBodyDense]}>
        <View style={ui.drowTitleRow}>
          {ev.flagship ? <Ionicons name="star" size={12} color={COLORS.mustard} style={ui.drowStar} accessibilityLabel={tr('Destacado')} /> : null}
          <Text style={ui.drowTitle} numberOfLines={2}>{title}</Text>
        </View>
        {(!!venue || !!timeText) && (
          <View style={ui.drowMeta}>
            {!!venue && <Ionicons name="location-outline" size={11} color={COLORS.textMuted} />}
            {!!venue && <Text style={ui.drowMetaText} numberOfLines={1}>{venue}</Text>}
            {!!timeText && <Text style={ui.drowWhen} numberOfLines={1}>{venue ? ` · ${timeText}` : timeText}</Text>}
          </View>
        )}
        {!!rangeLine && (
          <View style={ui.drowMeta}>
            <Ionicons name="calendar-outline" size={11} color={COLORS.textMuted} />
            <Text style={ui.drowWhen} numberOfLines={1}>{rangeLine}</Text>
          </View>
        )}
        {!!tbcNote && (
          <View style={ui.drowMeta}>
            <Ionicons name="help-circle-outline" size={11} color={COLORS.textMuted} />
            <Text style={ui.drowWhen} numberOfLines={1}>{tbcNote}</Text>
          </View>
        )}
        {(!!partOf || trustChip || soldOut || tbc) && (
          <View style={ui.drowBadges}>
            {tbc ? <EventCategoryBadge ev={ev} tr={tr} /> : null}
            {partOf ? (
              <View style={[ui.chip, ui.chipPart]}>
                <Ionicons name="albums-outline" size={10} color={COLORS.mustard} />
                <Text style={[ui.chipText, { color: COLORS.mustard }]} numberOfLines={1}>
                  {tr('Parte de: {name}').replace('{name}', partOf)}
                </Text>
              </View>
            ) : null}
            {trustChip ? <EventTrustChip ev={ev} tr={tr} /> : null}
            {soldOut ? <EventSoldOutChip tr={tr} /> : null}
          </View>
        )}
        {hideTrust ? null : <EventTrustLine ev={ev} lang={lang} tr={tr} offline={offline} style={ui.drowTrust} />}
      </View>
    </TouchableOpacity>
  );
}

/** "Por confirmar" → "por confirmar" (the note reads "nov 2026 · por confirmar"). */
const lowerFirst = (s: string): string => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

// ── Date strip (§16.3: weekday · day number · count) ─────────────────────────
type DateChipProps = {
  day: string;
  count: number;
  active: boolean;
  isToday: boolean;
  lang: Lang;
  tr: Tr;
  fill: boolean;
  onSelect: (day: string) => void;
  testID?: string;
};

function DateChip({ day, count, active, isToday, lang, tr, fill, onSelect, testID }: DateChipProps) {
  const wd = weekdayShort(weekdayOf(day), lang, true).replace(/\.$/, '');
  const press = useCallback(() => onSelect(day), [onSelect, day]);
  const label = `${isToday ? `${tr('Hoy')} · ` : ''}${formatDayShort(day, lang)} · ${countLabel(count, tr)}`;
  return (
    <TouchableOpacity
      style={[ui.dchip, fill ? ui.dchipFill : ui.dchipFixed, isToday && ui.dchipToday, active && ui.dchipActive]}
      onPress={press}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      aria-selected={active}
      accessibilityLabel={label}
      testID={testID}
    >
      <Text style={[ui.dchipWd, isToday && ui.dchipWdToday, active && ui.dchipTextActive]} numberOfLines={1}>{wd}</Text>
      <Text style={[ui.dchipNum, active && ui.dchipTextActive]}>{Number(day.slice(8, 10))}</Text>
      <View style={ui.dchipCountRow}>
        {count > 0 ? (
          <View style={[ui.dchipCount, active && ui.dchipCountActive]}>
            <Text style={[ui.dchipCountText, active && ui.dchipTextActive]}>{count}</Text>
          </View>
        ) : (
          <View style={ui.dchipNone} />
        )}
      </View>
    </TouchableOpacity>
  );
}

type DateStripProps = {
  days: string[];
  counts: Record<string, number>;
  selected: string | null;
  today: string;
  lang: Lang;
  tr: Tr;
  onSelect: (day: string) => void;
  /** true = the chips share the row width (a 7-day week); false = a scroll row (14 days). */
  fill?: boolean;
  /** Scroll row only: horizontal padding inside the scroll (edge-to-edge scroll, gutter-aligned first chip). */
  inset?: number;
  testIDPrefix?: string;
  style?: StyleProp<ViewStyle>;
};

export function DateStrip({ days, counts, selected, today, lang, tr, onSelect, fill = false, inset = 0, testIDPrefix = 'date', style }: DateStripProps) {
  const chips = days.map((d) => (
    <DateChip
      key={d}
      day={d}
      count={counts[d] || 0}
      active={selected === d}
      isToday={d === today}
      lang={lang}
      tr={tr}
      fill={fill}
      onSelect={onSelect}
      testID={`${testIDPrefix}-${d}`}
    />
  ));
  if (fill) return <View style={[ui.stripFill, style]}>{chips}</View>;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[ui.stripScroll, inset ? { paddingHorizontal: inset } : null]}
      style={[ui.stripScrollView, style]}
    >
      {chips}
    </ScrollView>
  );
}

/** Placeholder strip with the same footprint while "today" is unknown (SSR / first frame). */
export function DateStripSkeleton({ n = 7, fill = false, inset = 0, style }: { n?: number; fill?: boolean; inset?: number; style?: StyleProp<ViewStyle> }) {
  const chips = Array.from({ length: n }, (_, i) => (
    <View key={i} style={[ui.dchip, fill ? ui.dchipFill : ui.dchipFixed, ui.dchipSkeleton]} />
  ));
  if (fill) return <View style={[ui.stripFill, style]}>{chips}</View>;
  return <View style={[ui.stripScroll, ui.stripRow, ui.stripClip, inset ? { paddingHorizontal: inset } : null, style]}>{chips}</View>;
}

// ── Headers ──────────────────────────────────────────────────────────────────
/** Day header ("Hoy · mar 29 sep") — opaque, so it can be a sticky header. */
export function FeedDayHeader({ label, count, tr, testID }: { label: string; count?: number; tr: Tr; testID?: string }) {
  return (
    <View style={ui.dayHeader} testID={testID} accessibilityRole="header">
      <Text style={ui.dayHeaderText} numberOfLines={1}>{label}</Text>
      {typeof count === 'number' && count > 0 ? <Text style={ui.dayHeaderCount}>{countLabel(count, tr)}</Text> : null}
    </View>
  );
}

/** Month header ("Octubre 2026 · 9 eventos") — opaque, sticky in Próximos. `programCount`
 *  = the rows an umbrella card in that month folds away ("2 eventos · +16 del programa";
 *  "16 eventos del programa" when the card is the month's only item). */
export function FeedMonthHeader({ label, count, programCount = 0, tr, testID }: {
  label: string; count: number; programCount?: number; tr: Tr; testID?: string;
}) {
  const program = programCount === 1 ? tr('1 evento del programa') : tr('{n} eventos del programa').replace('{n}', String(programCount));
  const detail = programCount > 0
    ? (count > 0 ? `${countLabel(count, tr)} · ${tr('+{n} del programa').replace('{n}', String(programCount))}` : program)
    : countLabel(count, tr);
  return (
    <View style={ui.monthHeader} testID={testID} accessibilityRole="header">
      <Text style={ui.monthHeaderText} numberOfLines={1}>
        {label}
        <Text style={ui.monthHeaderCount}>{`  ·  ${detail}`}</Text>
      </Text>
    </View>
  );
}

// ── One-line empty state (§16.3: never a box) ────────────────────────────────
type EmptyLineProps = {
  text: string;
  cta?: string;
  onPress?: () => void;
  icon?: IconName;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

export function FeedEmptyLine({ text, cta, onPress, icon = 'calendar-clear-outline', testID, style }: EmptyLineProps) {
  const body = (
    <>
      <Ionicons name={icon} size={16} color={COLORS.textMuted} style={ui.emptyIcon} />
      <Text style={ui.emptyText}>
        {text}
        {cta ? <Text style={ui.emptyCta}>{`  ${cta}`}</Text> : null}
      </Text>
    </>
  );
  if (!onPress) return <View style={[ui.emptyLine, style]} testID={testID}>{body}</View>;
  return (
    <TouchableOpacity style={[ui.emptyLine, style]} onPress={onPress} activeOpacity={0.7} accessibilityRole="link" testID={testID}>
      {body}
    </TouchableOpacity>
  );
}

// ── Umbrella festival: ONE group card that expands into its program ──────────
export type ProgramDay = { day: string; rows: PublicEvent[] };

/** A festival program grouped by day (each sub-event under its first visible day), in
 *  calendar order; the rows keep the caller's within-day (headline first) order. */
export function programByDay(items: PublicEvent[], today: string): ProgramDay[] {
  const days: ProgramDay[] = [];
  for (const row of items) {
    const d = (row.start_date as string) < today ? today : (row.start_date as string);
    let g = days.find((x) => x.day === d);
    if (!g) { g = { day: d, rows: [] }; days.push(g); }
    g.rows.push(row);
  }
  return days.sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** A program row's trust line says nothing new when it matches the umbrella's exactly (HIGH, same source, same day). */
export const sameTrust = (row: PublicEvent, umbrella: PublicEvent): boolean =>
  row.confidence === 'HIGH' && umbrella.confidence === 'HIGH' && row.origin !== 'partner'
  && !!row.source_name && row.source_name === umbrella.source_name
  && (row.last_verified || '').slice(0, 10) === (umbrella.last_verified || '').slice(0, 10);

/** One day of a festival program: the day label + its rows (dense, headline rows starred). */
export function ProgramDayList({ group, umbrella, today, lang, tr, offline, onOpen, label }: {
  group: ProgramDay; umbrella: PublicEvent; today: string; lang: Lang; tr: Tr; offline: boolean;
  onOpen: (id: string) => void; label?: string;
}) {
  const text = label ?? dayHeaderText(group.day, today, lang, tr);
  return (
    <View style={ui.umbDay}>
      {text ? <Text style={ui.umbDayText}>{text}</Text> : null}
      {group.rows.map((row) => (
        <EventDayRow
          key={row.event_id}
          ev={row}
          lang={lang}
          tr={tr}
          offline={offline}
          lead="time"
          dense
          // Same source + same verification day as the card above → the line would only repeat it.
          hideTrust={sameTrust(row, umbrella)}
          onPress={onOpen}
          testID={`program-row-${row.event_id}`}
        />
      ))}
    </View>
  );
}

type UmbrellaProps = {
  ev: PublicEvent;
  /** The live sub-events to list (already category-filtered by the caller). */
  items: PublicEvent[];
  today: string;
  lang: Lang;
  tr: Tr;
  offline: boolean;
  expanded: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  /** false: the caller renders the expanded program itself (as sticky day blocks under the card). */
  programInline?: boolean;
  testID?: string;
};

export function UmbrellaGroupCard({ ev, items, today, lang, tr, offline, expanded, onToggle, onOpen, programInline = true, testID }: UmbrellaProps) {
  const meta = metaOf(ev);
  const title = pickL(ev.title, lang);
  const range = formatEventDates(ev, lang);
  const toggle = useCallback(() => onToggle(ev.event_id), [onToggle, ev.event_id]);
  const open = useCallback(() => onOpen(ev.event_id), [onOpen, ev.event_id]);
  const n = items.length;
  const programLabel = (n === 1 ? tr('1 evento del programa') : tr('{n} eventos del programa')).replace('{n}', String(n));
  // Day-grouped program: each sub-event under its first day, headline order within a day.
  const days: ProgramDay[] = expanded && programInline ? programByDay(items, today) : [];
  return (
    <View style={[ui.umb, { borderColor: `${meta.color}4D` }, expanded && !programInline && ui.umbOpenOutside]} testID={testID}>
      <LinearGradient
        colors={[`${meta.color}2E`, 'rgba(15,21,36,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />
      <TouchableOpacity onPress={open} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={`${title} · ${range}`} style={ui.umbHead}>
        <View style={[ui.umbIcon, { backgroundColor: `${meta.color}29` }]}>
          <Ionicons name={meta.icon as IconName} size={20} color={meta.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[ui.umbEyebrow, { color: meta.color }]} numberOfLines={1}>
            {range.toUpperCase()}
          </Text>
          <Text style={ui.umbTitle} numberOfLines={2}>{title}</Text>
          {!!ev.venue_name && <Text style={ui.umbVenue} numberOfLines={1}>{venueLabel(ev.venue_name, tr)}</Text>}
        </View>
        {ev.flagship ? <Ionicons name="star" size={14} color={COLORS.mustard} /> : null}
      </TouchableOpacity>
      {ev.confidence === 'VERIFY' ? <EventTrustChip ev={ev} tr={tr} style={ui.umbChip} /> : null}
      <EventTrustLine ev={ev} lang={lang} tr={tr} offline={offline} style={ui.umbTrust} />
      <TouchableOpacity
        style={ui.umbToggle}
        onPress={toggle}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        aria-expanded={expanded}
        disabled={n === 0}
        testID={testID ? `${testID}-toggle` : undefined}
      >
        <Text style={ui.umbCount}>{programLabel}</Text>
        {n > 0 ? (
          <View style={ui.umbToggleCta}>
            <Text style={ui.umbToggleText}>{tr(expanded ? 'Ocultar programa' : 'Ver programa')}</Text>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={COLORS.primary} />
          </View>
        ) : null}
      </TouchableOpacity>
      {days.length > 0 && (
        <View style={ui.umbProgram} testID={testID ? `${testID}-program` : undefined}>
          {days.map((g) => (
            <ProgramDayList key={g.day} group={g} umbrella={ev} today={today} lang={lang} tr={tr} offline={offline} onOpen={onOpen} />
          ))}
        </View>
      )}
    </View>
  );
}

/** The program rendered under an open umbrella card (que-pasa): the card's tint on the left
 *  edge ties the day blocks to the card above; the day headers are sticky ScrollView children. */
export function ProgramOutsideBlock({ ev, children, last }: { ev: PublicEvent; children: React.ReactNode; last?: boolean }) {
  const meta = metaOf(ev);
  return (
    <View style={[ui.umbOutside, { borderColor: `${meta.color}4D` }, last && ui.umbOutsideLast]}>{children}</View>
  );
}

// ── "Ahora en Cartagena" card (Home) ─────────────────────────────────────────
type NowCardProps = { item: NowItem; lang: Lang; tr: Tr; width: number; onPress: (id: string) => void; testID?: string };

export function EventNowCard({ item, lang, tr, width, onPress, testID }: NowCardProps) {
  const { ev } = item;
  const meta = metaOf(ev);
  const title = pickL(ev.title, lang);
  const open = useCallback(() => onPress(ev.event_id), [onPress, ev.event_id]);
  const live = item.state === 'ongoing';
  const chip = live ? tr('En curso') : tr('Empieza a las {t}').replace('{t}', item.at || '');
  return (
    <PressableScale style={[ui.now, { width }]} onPress={open} accessibilityLabel={`${chip} · ${title}${ev.venue_name ? ` · ${venueLabel(ev.venue_name, tr)}` : ''}`} testID={testID}>
      <View style={[ui.nowBar, { backgroundColor: meta.color }]} />
      <View style={ui.nowBody}>
        <View style={[ui.nowChip, live ? ui.nowChipLive : ui.nowChipSoon]}>
          <View style={[ui.nowDot, { backgroundColor: live ? COLORS.coral : COLORS.primary }]} />
          <Text style={[ui.nowChipText, { color: live ? COLORS.coral : COLORS.primary }]} numberOfLines={1}>{chip}</Text>
        </View>
        <Text style={ui.nowTitle} numberOfLines={2}>{title}</Text>
        {!!ev.venue_name && <Text style={ui.nowVenue} numberOfLines={1}>{venueLabel(ev.venue_name, tr)}</Text>}
        {ev.confidence === 'VERIFY' || ev.origin === 'partner' ? <EventTrustChip ev={ev} tr={tr} style={{ marginTop: 4 }} /> : null}
      </View>
    </PressableScale>
  );
}

const ui = StyleSheet.create({
  cat: {
    flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start',
    borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2,
  },
  catText: { fontSize: 9.5, ...FONTS.bold, letterSpacing: 0.4, textTransform: 'uppercase' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', flexShrink: 1,
    borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2,
  },
  // 8-digit hex alphas of the theme accents (8C = 55 %, 1A = 10 %, 59 = 35 %, 14 = 8 %)
  chipVerify: { borderColor: `${COLORS.coral}8C`, backgroundColor: `${COLORS.coral}1A` },
  chipOfficial: { borderColor: `${COLORS.official}59`, backgroundColor: `${COLORS.official}14` },
  chipPartner: { borderColor: COLORS.border, backgroundColor: 'rgba(174,182,196,0.08)' },
  chipSoldOut: { borderColor: `${COLORS.mustard}8C`, backgroundColor: `${COLORS.mustard}1A` },
  chipText: { fontSize: 9.5, ...FONTS.bold, letterSpacing: 0.3, flexShrink: 1 },
  trustRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  trustText: { flexShrink: 1, fontSize: 10.5, lineHeight: 14, color: COLORS.textFaint, ...FONTS.medium },
  trustWhen: { flexShrink: 0, fontSize: 10.5, lineHeight: 14, color: COLORS.textFaint, ...FONTS.medium },
  offline: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: SPACING.md, paddingVertical: 10, borderRadius: RADIUS.lg,
    backgroundColor: `${COLORS.mustard}14`, borderWidth: 1, borderColor: `${COLORS.mustard}59`,
  },
  offlineText: { flex: 1, fontSize: 12.5, lineHeight: 17, color: COLORS.textMain, ...FONTS.semibold },
  row: {
    flexDirection: 'row', gap: 10, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden', marginBottom: SPACING.sm, paddingRight: 10,
  },
  rowThumbWrap: { width: 88, minHeight: 104, backgroundColor: COLORS.surfaceAlt },
  media: { width: '100%', position: 'relative', overflow: 'hidden', backgroundColor: COLORS.surfaceAlt },
  mediaImg: { width: '100%', height: '100%', backgroundColor: 'transparent' },
  mediaGhost: { position: 'absolute', right: -18, bottom: -26 },
  mediaGhostHero: { position: 'absolute', right: -22, top: 18 },
  mediaCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  mediaDisc: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(8,12,22,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)',
  },
  rowBody: { flex: 1, paddingVertical: 10, gap: 3 },
  rowTitle: { fontSize: 13.5, lineHeight: 18, color: COLORS.textMain, ...FONTS.bold },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowMetaText: { flex: 1, fontSize: 11.5, color: COLORS.textMuted, ...FONTS.medium },
  rowChips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginTop: 3 },

  // ── §16 atoms ──
  dot: { width: 7, height: 7, borderRadius: 4 },

  // Hero (Destacados)
  hero: {
    borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, backgroundColor: COLORS.surface, ...ELEVATION.lg,
  },
  heroTop: {
    position: 'absolute', top: 12, left: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  heroCat: {
    flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '80%',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.full,
    backgroundColor: 'rgba(8,12,22,0.62)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
  },
  heroCatText: { fontSize: 10.5, color: COLORS.textMain, ...FONTS.bold, letterSpacing: 0.6, textTransform: 'uppercase' },
  heroStar: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(8,12,22,0.62)', borderWidth: 1, borderColor: `${COLORS.mustard}66`,
  },
  heroBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingBottom: 14, gap: 4 },
  heroWhen: { fontSize: 11, lineHeight: 14, color: COLORS.mustard, ...FONTS.bold, letterSpacing: 0.9 },
  heroProgram: { color: 'rgba(245,247,250,0.72)', ...FONTS.semibold, letterSpacing: 0.3 },
  heroTitle: { fontSize: 20, lineHeight: 25, color: COLORS.textMain, ...FONTS.bold, letterSpacing: -0.3 },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heroMetaText: { flexShrink: 1, fontSize: 12.5, color: 'rgba(245,247,250,0.72)', ...FONTS.medium },
  heroChip: { marginTop: 2 },
  heroTrust: { marginTop: 2 },

  // Calendar row
  drow: {
    flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.hairline, overflow: 'hidden', minHeight: 84,
  },
  lead: { width: 60, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRightWidth: 1 },
  leadNum: { fontSize: 24, lineHeight: 26, ...FONTS.bold, letterSpacing: -0.5 },
  leadSub: { fontSize: 10, lineHeight: 12, ...FONTS.bold, letterSpacing: 0.8, marginTop: 2 },
  leadTime: { fontSize: 15, lineHeight: 18, ...FONTS.bold, letterSpacing: -0.2 },
  leadEnd: { fontSize: 10.5, lineHeight: 13, color: COLORS.textMuted, ...FONTS.semibold, marginTop: 1 },
  leadIcon: { marginTop: 6 },
  drowBody: { flex: 1, paddingHorizontal: 12, paddingVertical: 11, gap: 4, justifyContent: 'center' },
  drowTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
  drowStar: { marginTop: 3 },
  drowTitle: { flexShrink: 1, fontSize: 14.5, lineHeight: 19, color: COLORS.textMain, ...FONTS.bold, letterSpacing: -0.1 },
  leadRange: { fontSize: 17, lineHeight: 22, letterSpacing: -0.6 },
  drowMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  drowMetaText: { flexShrink: 1, fontSize: 12, color: COLORS.textMuted, ...FONTS.medium },
  drowWhen: { flexShrink: 0, fontSize: 12, color: COLORS.textMain, ...FONTS.semibold },
  drowBadges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginTop: 1 },
  drowTrust: { marginTop: 1 },
  drowDense: { minHeight: 64 },
  leadDense: { width: 52, paddingVertical: 8 },
  drowBodyDense: { paddingVertical: 9 },
  chipPart: { borderColor: `${COLORS.mustard}66`, backgroundColor: `${COLORS.mustard}14` },

  // Date strip
  stripFill: { flexDirection: 'row', gap: 6 },
  stripScrollView: { flexGrow: 0, flexShrink: 0 },
  stripScroll: { gap: 8 },
  stripRow: { flexDirection: 'row' },
  stripClip: { overflow: 'hidden' },
  dchip: {
    alignItems: 'center', justifyContent: 'center', height: 72, borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, paddingTop: 2,
  },
  dchipFill: { flex: 1, minWidth: 0 },
  dchipFixed: { width: 52 },
  dchipToday: { borderColor: `${COLORS.primary}8C` },
  dchipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  dchipSkeleton: { opacity: 0.5 },
  dchipWd: { fontSize: 10, lineHeight: 12, color: COLORS.textMuted, ...FONTS.bold, letterSpacing: 0.6 },
  dchipWdToday: { color: COLORS.primary },
  dchipNum: { fontSize: 20, lineHeight: 24, color: COLORS.textMain, ...FONTS.bold, marginTop: 1 },
  dchipTextActive: { color: COLORS.black },
  dchipCountRow: { height: 16, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  dchipCount: {
    minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center',
    backgroundColor: `${COLORS.coral}29`,
  },
  dchipCountActive: { backgroundColor: 'rgba(0,0,0,0.16)' },
  dchipCountText: { fontSize: 10, lineHeight: 12, color: COLORS.coral, ...FONTS.bold },
  dchipNone: { width: 4, height: 4, borderRadius: 2, backgroundColor: COLORS.border },

  // Headers
  dayHeader: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8,
    paddingTop: 14, paddingBottom: 8, backgroundColor: COLORS.background,
  },
  dayHeaderText: { flexShrink: 1, fontSize: 15, lineHeight: 20, color: COLORS.textMain, ...FONTS.bold, letterSpacing: -0.1 },
  dayHeaderCount: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold },
  monthHeader: { paddingTop: 14, paddingBottom: 8, backgroundColor: COLORS.background },
  monthHeaderText: { fontSize: 17, lineHeight: 22, color: COLORS.textMain, ...FONTS.bold, letterSpacing: -0.2 },
  monthHeaderCount: { fontSize: 13, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 0 },

  // One-line empty state
  emptyLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 12, minHeight: 44 },
  emptyIcon: { marginTop: 1 },
  emptyText: { flex: 1, fontSize: 13, lineHeight: 19, color: COLORS.textMuted, ...FONTS.medium },
  emptyCta: { color: COLORS.primary, ...FONTS.bold },

  // Umbrella group card
  umb: {
    borderRadius: RADIUS.lg, borderWidth: 1, backgroundColor: COLORS.surface, overflow: 'hidden', ...ELEVATION.md,
  },
  umbHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 14, paddingTop: 14 },
  umbIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  umbEyebrow: { fontSize: 10.5, lineHeight: 13, ...FONTS.bold, letterSpacing: 0.9 },
  umbTitle: { fontSize: 17, lineHeight: 22, color: COLORS.textMain, ...FONTS.bold, marginTop: 2, letterSpacing: -0.2 },
  umbVenue: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium, marginTop: 2 },
  umbChip: { marginLeft: 70, marginTop: 6 },
  umbTrust: { marginLeft: 70, marginTop: 6, marginRight: 14 },
  umbToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    marginTop: 12, minHeight: 44, paddingHorizontal: 14,
    borderTopWidth: 1, borderTopColor: COLORS.hairline,
  },
  umbCount: { flexShrink: 1, fontSize: 12.5, color: COLORS.textMain, ...FONTS.semibold },
  umbToggleCta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  umbToggleText: { fontSize: 13, color: COLORS.primary, ...FONTS.bold },
  umbProgram: { paddingHorizontal: 12, paddingBottom: 12, gap: 4 },
  umbDay: { gap: 8, marginTop: 8 },
  umbDayText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.bold, letterSpacing: 0.3, marginTop: 4 },
  umbOpenOutside: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottomWidth: 0 },
  umbOutside: {
    borderLeftWidth: 1, borderRightWidth: 1, paddingHorizontal: 12, paddingBottom: 4, backgroundColor: COLORS.surface,
  },
  umbOutsideLast: { borderBottomWidth: 1, borderBottomLeftRadius: RADIUS.lg, borderBottomRightRadius: RADIUS.lg, paddingBottom: 12 },

  // Ahora en Cartagena
  now: {
    flexDirection: 'row', minHeight: 96, borderRadius: RADIUS.lg, overflow: 'hidden',
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.hairline,
  },
  nowBar: { width: 4 },
  nowBody: { flex: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 4 },
  nowChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1,
  },
  nowChipLive: { borderColor: `${COLORS.coral}73`, backgroundColor: `${COLORS.coral}1A` },
  nowChipSoon: { borderColor: `${COLORS.primary}73`, backgroundColor: `${COLORS.primary}14` },
  nowDot: { width: 6, height: 6, borderRadius: 3 },
  nowChipText: { fontSize: 10.5, ...FONTS.bold, letterSpacing: 0.3 },
  nowTitle: { fontSize: 14, lineHeight: 18, color: COLORS.textMain, ...FONTS.bold },
  nowVenue: { fontSize: 11.5, color: COLORS.textMuted, ...FONTS.medium },
});
