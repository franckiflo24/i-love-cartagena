// /music-week — the Cartagena Music Week hub (docs/cmw/DESIGN.md §4).
//
// In order: the hero (deck photo, wordmark, dates, tagline, two CTAs), the six
// pillars, "Día a día" (an 8-chip date strip that sticks while the day sections
// scroll under it), Experiencias and Las islas from the deck copy, Información
// práctica, and the concierge card. Every card carries "Programa oficial";
// every fact is the program's (src/lib/cmw.ts), so what is still to be
// confirmed reads "por confirmar" and the price reads "Consultar".
//
// Hooks sit above the render; there is no early return. "Today" is null until
// mount (useCmwToday), so the static export never bakes a build-day phase in.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Head from '../../src/components/WebHead';
import { SafeImage } from '../../src/components/SafeImage';
import { Skeleton } from '../../src/components/Skeleton';
import { FadeInUp } from '../../src/components/FadeInUp';
import CmwRequestSheet from '../../src/components/cmw/CmwRequestSheet';
import {
  CmwButton, CmwConciergeCard, CmwDateStrip, CmwEventCard, CmwWordmark, OfficialBadge, SectionHeader, iconName,
} from '../../src/components/cmw/CmwUI';
import { CMW, CMW_GUTTER, CMW_RADIUS, CMW_TYPE } from '../../src/components/cmw/cmwTheme';
import guide from '../../src/components/cmw/guide.json';
import { COLORS } from '../../src/constants/theme';
import { useLang } from '../../src/context/LanguageContext';
import { useTr } from '../../src/i18n/autoTr';
import { cityModuleRoute, openExternal } from '../../src/lib/cityModules';
import { goBackOr } from '../../src/lib/nav';
import {
  CMW_END, CMW_HERO_IMAGE, CMW_IMAGE_CREDIT, CMW_NAME, CMW_START, CmwEvent, L4, dayLabel, pickL, programDays,
  rangeLabel, useCmwProgram, useCmwToday, whatsappUrl,
} from '../../src/lib/cmw';

const HERO_H = 540;
const STRIP_PAD = 8;

type GuideItem = { key: string; image?: string; venue_id?: string | null; title: L4; tagline: L4; body?: L4 };
type Guide = {
  image_credit: string;
  experiences: { title: L4; subtitle: L4; items: GuideItem[] };
  islands: { image: string; title: L4; subtitle: L4; intro: L4; items: GuideItem[] };
};
const GUIDE = guide as Guide;

export default function MusicWeekHub() {
  const router = useRouter();
  const tr = useTr();
  const { lang } = useLang();
  const { program, loading, error, reload } = useCmwProgram();
  const today = useCmwToday();
  const scrollRef = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();
  const dayY = useRef<Record<string, number>>({});
  const dayH = useRef<Record<string, number>>({});
  const programY = useRef(0);
  const stripY = useRef(0);
  const stripH = useRef(56);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  // The date strip is pinned by hand (an overlay while the day sections scroll
  // under it) instead of stickyHeaderIndices, which would keep it stuck past the
  // program on both platforms. It un-pins at Experiencias.
  const [pinned, setPinned] = useState(false);
  const [sheet, setSheet] = useState<{ open: boolean; event: CmwEvent | null }>({ open: false, event: null });

  const brand = program?.brand || null;
  const days = useMemo(() => programDays(brand), [brand]);
  const byDay = useMemo(() => {
    const m: Record<string, CmwEvent[]> = {};
    for (const d of days) m[d] = [];
    for (const ev of program?.events || []) (m[ev.date] = m[ev.date] || []).push(ev);
    return m;
  }, [days, program]);
  const counts = useMemo(() => Object.fromEntries(days.map((d) => [d, byDay[d]?.length || 0])), [days, byDay]);

  // The active chip follows the scroll (and lands on today once the week runs).
  useEffect(() => {
    if (activeDay === null && days.length) setActiveDay(today && days.includes(today) ? today : days[0]);
  }, [activeDay, days, today]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = e.nativeEvent.contentOffset.y;
    // The program ends where the last day section ends. Day sections mount after
    // the program loads, so their own layout is final (web onLayout does not
    // re-fire on a position change, so nothing above them may be measured later).
    const last = days.length ? days[days.length - 1] : null;
    const end = last && typeof dayY.current[last] === 'number' ? dayY.current[last] + (dayH.current[last] || 0) : 0;
    const shouldPin = end > 0 && offset >= stripY.current && offset < end - stripH.current - STRIP_PAD;
    if (shouldPin !== pinned) setPinned(shouldPin);
    const y = offset + stripH.current + STRIP_PAD + 24;
    let current: string | null = null;
    for (const d of days) {
      const top = dayY.current[d];
      if (typeof top === 'number' && top <= y) current = d;
    }
    if (current && current !== activeDay) setActiveDay(current);
  }, [days, activeDay, pinned]);

  const scrollToY = useCallback((y: number) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, y), animated: true });
  }, []);
  const jumpToDay = useCallback((d: string) => {
    setActiveDay(d);
    const top = dayY.current[d];
    if (typeof top === 'number') scrollToY(top - stripH.current - STRIP_PAD - 4);
  }, [scrollToY]);
  // "Ver programa": the program's top before the week, today's section during it.
  const jumpToProgram = useCallback(() => {
    if (today && days.includes(today) && typeof dayY.current[today] === 'number') jumpToDay(today);
    else scrollToY(programY.current - 8);
  }, [scrollToY, jumpToDay, today, days]);

  const openEvent = useCallback((id: string) => { router.push(`/music-week/${id}` as never); }, [router]);
  const openRequest = useCallback((ev: CmwEvent | null) => { setSheet({ open: true, event: ev }); }, []);
  const closeRequest = useCallback(() => { setSheet((s) => ({ ...s, open: false })); }, []);
  const openWhatsApp = useCallback(() => { openExternal(whatsappUrl(null, lang, { brand })); }, [lang, brand]);
  const openPartner = useCallback((id: string) => { router.push({ pathname: '/partner/[id]', params: { id } } as never); }, [router]);
  const openPractical = useCallback((key: string, link: string | null) => {
    if (!link) return;
    // "Botes y traslados" lands on the pier module inside /ciudad (§4.5).
    router.push((key === 'boats' && link === '/ciudad' ? cityModuleRoute('muelle-bodeguita') : link) as never);
  }, [router]);

  const onDayLayout = useCallback((d: string, e: LayoutChangeEvent) => {
    dayY.current[d] = e.nativeEvent.layout.y;
    dayH.current[d] = e.nativeEvent.layout.height;
  }, []);
  const onStripLayout = useCallback((e: LayoutChangeEvent) => {
    stripH.current = e.nativeEvent.layout.height;
    stripY.current = e.nativeEvent.layout.y;
  }, []);

  const dates = `${rangeLabel(brand, lang)} · ${brand?.days_label ? pickL(brand.days_label, lang) : tr('Ocho días')}`;
  // "Día a día" says what the hero does not: how many events over how many days.
  const programSummary = program
    ? `${tr('{n} eventos · {d} días').replace('{n}', String(program.events.length)).replace('{d}', String(days.length))} · ${rangeLabel(brand, lang)}`
    : rangeLabel(brand, lang);
  const tagline = brand?.tagline ? pickL(brand.tagline, lang) : tr('La historia se encuentra con nuevos ritmos.');
  const canGoBack = router.canGoBack();
  const ready = !!program;

  // ── Blocks: direct ScrollView children, so each day's offset is the content offset ──
  const blocks: React.ReactNode[] = [];
  const strip = <CmwDateStrip days={days} active={activeDay} today={today} counts={counts} lang={lang} tr={tr} onSelect={jumpToDay} />;

  blocks.push(
    <View key="hero" style={styles.hero} testID="cmw-hero">
      <SafeImage uri={brand?.hero_image || CMW_HERO_IMAGE} category="event" style={StyleSheet.absoluteFillObject} priority="high" accessibilityLabel={`${tr('Arte del evento')} · ${CMW_IMAGE_CREDIT}`} />
      <LinearGradient colors={['rgba(8,12,22,0.55)', 'rgba(8,12,22,0)']} locations={[0, 0.35]} style={StyleSheet.absoluteFillObject} pointerEvents="none" />
      <LinearGradient colors={['rgba(8,12,22,0)', 'rgba(8,12,22,0.72)', COLORS.background]} locations={[0.3, 0.78, 1]} style={StyleSheet.absoluteFillObject} pointerEvents="none" />
      <View style={styles.heroTop}>
        <TouchableOpacity
          onPress={() => goBackOr(router)}
          style={styles.navBtn}
          accessibilityRole="button"
          accessibilityLabel={tr(canGoBack ? 'Volver' : 'Inicio')}
          testID="cmw-back"
        >
          <Ionicons name={canGoBack ? 'arrow-back' : 'home-outline'} size={20} color={CMW.white} />
        </TouchableOpacity>
      </View>
      <View style={styles.heroBottom}>
        <OfficialBadge tr={tr} onImage />
        <CmwWordmark style={{ marginTop: 12 }} />
        <Text style={styles.heroDates} testID="cmw-hero-dates">{dates}</Text>
        <Text style={styles.heroTagline}>{tagline}</Text>
        <View style={styles.heroCtas}>
          <CmwButton label={tr('Ver programa')} icon="calendar-outline" onPress={jumpToProgram} testID="cmw-cta-program" />
          <CmwButton label={tr('Hablar con concierge')} icon="logo-whatsapp" variant="secondary" onPress={openWhatsApp} testID="cmw-cta-concierge" />
        </View>
      </View>
    </View>,
  );

  // Six pillars, one clean 3 × 2 grid.
  blocks.push(
    <View key="pillars" style={styles.pillars} testID="cmw-pillars">
      {(brand?.pillars.length ? brand.pillars : PILLAR_FALLBACK).map((p) => (
        <View key={p.key} style={styles.pillar}>
          <View style={styles.pillarIcon}>
            <Ionicons name={iconName(p.icon)} size={18} color={CMW.amber} />
          </View>
          <Text style={styles.pillarLabel} numberOfLines={1}>{pickL(p.label, lang)}</Text>
        </View>
      ))}
    </View>,
  );

  blocks.push(
    <View key="program-head" onLayout={(e) => { programY.current = e.nativeEvent.layout.y; }} style={styles.programHead}>
      <SectionHeader title={tr('Día a día')} subtitle={programSummary} testID="cmw-program-title" />
    </View>,
  );

  blocks.push(
    <View key="strip" style={styles.stripWrap} onLayout={onStripLayout}>
      {strip}
    </View>,
  );

  if (!ready && !error) {
    blocks.push(
      <View key="skeleton" style={styles.daySection} testID="cmw-skeleton">
        {[0, 1].map((i) => (
          <View key={i} style={styles.skCard}>
            <Skeleton height={176} borderRadius={0} />
            <View style={{ padding: 16, gap: 10 }}>
              <Skeleton width="60%" height={20} />
              <Skeleton width="45%" height={13} />
              <Skeleton width="50%" height={13} />
            </View>
          </View>
        ))}
      </View>,
    );
  } else if (!ready && error) {
    blocks.push(
      <View key="error" style={styles.daySection} testID="cmw-error">
        <View style={styles.errorBox}>
          <Ionicons name="cloud-offline-outline" size={22} color={CMW.sand} />
          <Text style={styles.errorTitle}>{tr('No pudimos cargar el programa')}</Text>
          <Text style={[CMW_TYPE.small, { textAlign: 'center' }]}>{tr('Verifica tu conexión e intenta de nuevo')}</Text>
          <CmwButton label={tr('Reintentar')} icon="refresh" variant="secondary" onPress={reload} loading={loading} style={{ marginTop: 12, alignSelf: 'center' }} small testID="cmw-retry" />
        </View>
      </View>,
    );
  } else {
    days.forEach((d, i) => {
      const rows = byDay[d] || [];
      blocks.push(
        <View key={`day-${d}`} style={styles.daySection} onLayout={(e) => onDayLayout(d, e)} testID={`cmw-day-section-${d}`}>
          <View style={styles.dayHead}>
            <Text style={styles.dayEyebrow}>{tr('Día {n}').replace('{n}', String(i + 1))}{today === d ? ` · ${tr('Hoy')}` : ''}</Text>
            <Text style={styles.dayTitle}>{dayLabel(d, lang, { weekday: true })}</Text>
          </View>
          {rows.map((ev, k) => (
            <FadeInUp key={ev.id} delay={Math.min(k, 3) * 50} distance={12}>
              <CmwEventCard ev={ev} lang={lang} tr={tr} onPress={openEvent} onRequest={openRequest} priority={i < 2 ? 'high' : 'normal'} showBadge={false} testID={`cmw-card-${ev.id}`} />
            </FadeInUp>
          ))}
        </View>,
      );
    });
  }

  // Experiencias — the deck's three, as a rail.
  blocks.push(
    <View key="experiences" style={styles.block} testID="cmw-experiences">
      <SectionHeader eyebrow={pickL(GUIDE.experiences.title, lang)} title={pickL(GUIDE.experiences.subtitle, lang)} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail} style={{ marginTop: 14 }} decelerationRate="fast" snapToInterval={272} snapToAlignment="start">
        {GUIDE.experiences.items.map((it) => (
          <View key={it.key} style={styles.expCard}>
            <View style={styles.expMedia}>
              <SafeImage uri={it.image || null} category="activity" style={StyleSheet.absoluteFillObject} accessibilityLabel={`${tr('Arte del evento')} · ${GUIDE.image_credit}`} />
              <LinearGradient colors={['rgba(20,17,26,0)', CMW.surface]} locations={[0.55, 1]} style={StyleSheet.absoluteFillObject} pointerEvents="none" />
            </View>
            <View style={styles.expBody}>
              <Text style={CMW_TYPE.eyebrow} numberOfLines={2}>{pickL(it.tagline, lang)}</Text>
              <Text style={[CMW_TYPE.h3, { marginTop: 6 }]} numberOfLines={2}>{pickL(it.title, lang)}</Text>
              {!!it.body && <Text style={[CMW_TYPE.small, { marginTop: 8 }]} numberOfLines={4}>{pickL(it.body, lang)}</Text>}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>,
  );

  // Las islas — deck copy; "Ver lugar" only where the catalog has the venue.
  blocks.push(
    <View key="islands" style={styles.block} testID="cmw-islands">
      <View style={styles.islandsCard}>
        <View style={styles.islandsMedia}>
          <SafeImage uri={GUIDE.islands.image} category="beach_club" style={StyleSheet.absoluteFillObject} accessibilityLabel={`${tr('Arte del evento')} · ${GUIDE.image_credit}`} />
          <LinearGradient colors={['rgba(20,17,26,0.05)', 'rgba(20,17,26,0.7)', CMW.surface]} locations={[0.25, 0.8, 1]} style={StyleSheet.absoluteFillObject} pointerEvents="none" />
          <View style={styles.islandsHead} pointerEvents="none">
            <Text style={CMW_TYPE.eyebrow}>{pickL(GUIDE.islands.subtitle, lang)}</Text>
            <Text style={[CMW_TYPE.h2, { marginTop: 4 }]}>{pickL(GUIDE.islands.title, lang)}</Text>
          </View>
        </View>
        <View style={styles.islandsBody}>
          <Text style={CMW_TYPE.body}>{pickL(GUIDE.islands.intro, lang)}</Text>
          <View style={styles.islandRows}>
            {GUIDE.islands.items.map((it) => {
              const venueId = typeof it.venue_id === 'string' && it.venue_id ? it.venue_id : null;
              const row = (
                <>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.islandTitle}>{pickL(it.title, lang)}</Text>
                    <Text style={styles.islandTag}>{pickL(it.tagline, lang)}</Text>
                  </View>
                  {venueId && (
                    <View style={styles.islandLink}>
                      <Text style={styles.islandLinkText}>{tr('Ver lugar')}</Text>
                      <Ionicons name="chevron-forward" size={14} color={CMW.amber} />
                    </View>
                  )}
                </>
              );
              return venueId ? (
                <TouchableOpacity key={it.key} style={styles.islandRow} onPress={() => openPartner(venueId)} activeOpacity={0.8} accessibilityRole="link" testID={`cmw-island-${it.key}`}>
                  {row}
                </TouchableOpacity>
              ) : (
                <View key={it.key} style={styles.islandRow} testID={`cmw-island-${it.key}`}>{row}</View>
              );
            })}
          </View>
        </View>
      </View>
    </View>,
  );

  // Información práctica — the program's rows, plus "Acceso a eventos".
  if (brand) {
    blocks.push(
      <View key="practical" style={styles.block} testID="cmw-practical">
        <SectionHeader title={tr('Información práctica')} subtitle={tr('Todo lo que necesitas para una semana inolvidable')} />
        <View style={styles.practicalCard}>
          {brand.practical.map((p, i) => {
            const link = p.link;
            const body = (
              <>
                <View style={styles.practicalIcon}>
                  <Ionicons name={iconName(p.icon, 'information-circle-outline')} size={17} color={CMW.amber} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.practicalTitle}>{pickL(p.title, lang)}</Text>
                  <Text style={styles.practicalBody}>{pickL(p.body, lang)}</Text>
                  {!!link && <Text style={styles.practicalLink}>{tr(p.key === 'boats' ? 'Ver muelle y traslados' : 'Ver guía de la ciudad')} →</Text>}
                </View>
              </>
            );
            const rowStyle = [styles.practicalRow, i > 0 && styles.practicalDivider];
            return link ? (
              <TouchableOpacity key={p.key} style={rowStyle} onPress={() => openPractical(p.key, link)} activeOpacity={0.8} accessibilityRole="link" testID={`cmw-practical-${p.key}`}>
                {body}
              </TouchableOpacity>
            ) : (
              <View key={p.key} style={rowStyle} testID={`cmw-practical-${p.key}`}>{body}</View>
            );
          })}
          {!!brand.access_note && (
            <View style={[styles.practicalRow, styles.practicalDivider]} testID="cmw-practical-access">
              <View style={styles.practicalIcon}>
                <Ionicons name="ticket-outline" size={17} color={CMW.amber} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.practicalTitle}>{tr('Acceso a eventos')}</Text>
                <Text style={styles.practicalBody}>{pickL(brand.access_note, lang)}</Text>
              </View>
            </View>
          )}
        </View>
      </View>,
    );
  }

  blocks.push(
    <View key="concierge" style={[styles.block, { paddingHorizontal: CMW_GUTTER }]}>
      <CmwConciergeCard brand={brand} lang={lang} tr={tr} onWhatsApp={openWhatsApp} onRequest={() => openRequest(null)} />
      <Text style={styles.credit}>{program?.source_name || 'Programa oficial Cartagena Music Week'} · {tr('Arte del evento')}: {CMW_IMAGE_CREDIT}</Text>
      {/* CALENDAR-INTEGRATION v1: the classical festival starts two days after CMW ends —
          people and search engines mix them up, so the hub says it out loud. */}
      <Text style={styles.credit}>{tr('Music Week no es el Cartagena Festival de Música (música clásica, 9–17 de enero): son dos semanas distintas.')}</Text>
    </View>,
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Head>
        <title>{`${CMW_NAME} · AMO Life`}</title>
        {/* "Cartagena de Indias, Colombia" is deliberate: search engines (and people) must never
            route this to Cartagena, Spain, nor to the classical Cartagena Festival de Música. */}
        <meta name="description" content={`${CMW_NAME} · ${rangeLabel(brand, 'es')} · Cartagena de Indias, Colombia · Programa oficial y concierge en AMO Life.`} />
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Event',
            name: CMW_NAME,
            startDate: brand?.start_date || CMW_START,
            endDate: brand?.end_date || CMW_END,
            eventStatus: 'https://schema.org/EventScheduled',
            eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
            location: {
              '@type': 'Place',
              name: 'Cartagena de Indias',
              address: { '@type': 'PostalAddress', addressLocality: 'Cartagena de Indias', addressRegion: 'Bolívar', addressCountry: 'CO' },
            },
            organizer: { '@type': 'Organization', name: 'AMO Life' },
            // Free-RSVP nights are live in the app; COP is the pricing currency. Honest floor only.
            offers: { '@type': 'AggregateOffer', lowPrice: '0', priceCurrency: 'COP', url: 'https://www.amocartagena.co/music-week' },
          })}
        </script>
      </Head>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        onScroll={onScroll}
        scrollEventThrottle={32}
        testID="cmw-scroll"
      >
        {blocks}
      </ScrollView>
      {pinned && (
        <View style={[styles.pinned, { top: insets.top }]} testID="cmw-date-strip-pinned">
          {strip}
        </View>
      )}
      <CmwRequestSheet visible={sheet.open} event={sheet.event} onClose={closeRequest} />
    </SafeAreaView>
  );
}

// The six pillars as printed — used only until the program answers, so the hero
// never paints an empty grid.
const PILLAR_FALLBACK: { key: string; icon: string; label: L4 }[] = [
  { key: 'music', icon: 'musical-notes', label: { es: 'Música', en: 'Music', fr: 'Musique', pt: 'Música' } },
  { key: 'culture', icon: 'color-palette', label: { es: 'Cultura', en: 'Culture', fr: 'Culture', pt: 'Cultura' } },
  { key: 'wellness', icon: 'leaf', label: { es: 'Bienestar', en: 'Wellness', fr: 'Bien-être', pt: 'Bem-estar' } },
  { key: 'gastronomy', icon: 'restaurant', label: { es: 'Gastronomía', en: 'Gastronomy', fr: 'Gastronomie', pt: 'Gastronomia' } },
  { key: 'ocean', icon: 'boat', label: { es: 'Mar', en: 'Ocean', fr: 'Mer', pt: 'Mar' } },
  { key: 'people', icon: 'people', label: { es: 'Personas', en: 'People', fr: 'Rencontres', pt: 'Pessoas' } },
];

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { paddingBottom: 48 },

  hero: { height: HERO_H, backgroundColor: CMW.surfaceAlt, justifyContent: 'space-between' },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: CMW_GUTTER - 4, paddingTop: 10 },
  navBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(8,12,22,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  heroBottom: { paddingHorizontal: CMW_GUTTER, paddingBottom: 18 },
  heroDates: { ...CMW_TYPE.eyebrow, color: CMW.gold, marginTop: 14 },
  heroTagline: { fontFamily: CMW_TYPE.title.fontFamily, fontStyle: 'italic', fontSize: 19, lineHeight: 26, color: CMW.cream, marginTop: 8 },
  heroCtas: { gap: 10, marginTop: 18 },

  pillars: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: CMW_GUTTER - 6, paddingTop: 22, paddingBottom: 6, rowGap: 14 },
  pillar: { width: '33.333%', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  pillarIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: CMW.line, backgroundColor: CMW.glow },
  pillarLabel: { fontSize: 10.5, lineHeight: 13, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase', color: CMW.cream },

  programHead: { paddingTop: 30, paddingBottom: 12 },
  stripWrap: { backgroundColor: COLORS.background, paddingVertical: STRIP_PAD },
  pinned: { position: 'absolute', left: 0, right: 0, paddingVertical: STRIP_PAD, backgroundColor: COLORS.background, borderBottomWidth: 1, borderBottomColor: CMW.lineSoft },
  daySection: { paddingHorizontal: CMW_GUTTER, paddingTop: 18, gap: 14 },
  dayHead: { paddingTop: 4 },
  dayEyebrow: { ...CMW_TYPE.eyebrow },
  dayTitle: { ...CMW_TYPE.h3, marginTop: 4 },
  skCard: { borderRadius: CMW_RADIUS.card, overflow: 'hidden', backgroundColor: CMW.surface, borderWidth: 1, borderColor: CMW.lineSoft },
  errorBox: { alignItems: 'center', gap: 6, padding: 24, borderRadius: CMW_RADIUS.card, backgroundColor: CMW.surface, borderWidth: 1, borderColor: CMW.lineSoft },
  errorTitle: { ...CMW_TYPE.h3, textAlign: 'center', marginTop: 4 },

  block: { paddingTop: 36 },
  rail: { paddingHorizontal: CMW_GUTTER, gap: 12 },
  expCard: { width: 260, borderRadius: CMW_RADIUS.card, overflow: 'hidden', backgroundColor: CMW.surface, borderWidth: 1, borderColor: CMW.lineSoft },
  expMedia: { height: 150, backgroundColor: CMW.surfaceAlt },
  expBody: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 16, minHeight: 150 },

  islandsCard: { marginHorizontal: CMW_GUTTER, borderRadius: CMW_RADIUS.card, overflow: 'hidden', backgroundColor: CMW.surface, borderWidth: 1, borderColor: CMW.lineSoft },
  islandsMedia: { height: 210, backgroundColor: CMW.surfaceAlt },
  islandsHead: { position: 'absolute', left: 18, right: 18, bottom: 10 },
  islandsBody: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 8 },
  islandRows: { marginTop: 14 },
  islandRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8, borderTopWidth: 1, borderTopColor: CMW.lineSoft },
  islandTitle: { ...CMW_TYPE.h3, fontSize: 18, lineHeight: 22 },
  islandTag: { ...CMW_TYPE.small, marginTop: 2 },
  islandLink: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, paddingLeft: 8 },
  islandLinkText: { fontSize: 12.5, fontWeight: '700', color: CMW.amber },

  practicalCard: { marginHorizontal: CMW_GUTTER, marginTop: 14, borderRadius: CMW_RADIUS.card, backgroundColor: CMW.surface, borderWidth: 1, borderColor: CMW.lineSoft, paddingHorizontal: 16 },
  practicalRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 14 },
  practicalDivider: { borderTopWidth: 1, borderTopColor: CMW.lineSoft },
  practicalIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: CMW.glow, marginTop: 1 },
  practicalTitle: { fontSize: 15, lineHeight: 20, fontWeight: '700', color: CMW.cream },
  practicalBody: { ...CMW_TYPE.small, marginTop: 3, lineHeight: 18 },
  practicalLink: { fontSize: 12.5, lineHeight: 16, fontWeight: '700', color: CMW.amber, marginTop: 6 },

  credit: { ...CMW_TYPE.small, textAlign: 'center', marginTop: 18 },
});
