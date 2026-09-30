// "Qué pasa en Cartagena" — the verified city-events feed (EVENTS-ELITE §10, §13 J4,
// §16.2–16.3). Every row comes from GET /api/events/feed (src/lib/eventsFeed.ts):
// source-verified, future-dated, inside the Distrito. VERIFY rows carry "Sin
// confirmar · verifica con el organizador"; date_tbc rows live under "Por
// confirmar" and never show a date. A true empty state beats a fake fill.
//
// Layout (§16): the Destacados hero rail FIRST (top events by prominence), then
// Hoy / Esta semana / Próximos, one row of category chips, and a clean calendar:
//   • Hoy — today's rows, headline events first, lead column = start time;
//   • Esta semana — a 7-day strip (weekday · number · count; tap = that day) and
//     day headers ("Hoy · mar 29 sep", "Mañana · …", "Sáb 3 oct");
//   • Próximos — sticky month headers ("Octubre 2026 · 9 eventos"), date-badge
//     rows, then "Por confirmar".
// An umbrella festival is ONE group card ("N eventos del programa" · Ver
// programa, expanding in place); its sub-events also appear on their own day in
// Hoy/Semana with "Parte de: <festival>".
//
// Hydration: all date math needs Bogotá "today", which is null until mount
// (useEventsFeed) — the static export renders skeletons, never a build-day date
// (React #418). All hooks sit above the render; there is no early return.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Head from '../../src/components/WebHead';
import { COLORS, FONTS, RADIUS, SPACING, TYPE } from '../../src/constants/theme';
import { FadeInUp } from '../../src/components/FadeInUp';
import { Skeleton } from '../../src/components/Skeleton';
import NearbyEventsCard from '../../src/components/NearbyEventsCard';
import CmwBanner from '../../src/components/cmw/CmwBanner';
import {
  DateStrip, EventDayRow, EventHeroCard, FeedDayHeader, FeedEmptyLine, FeedMonthHeader,
  FeedOfflineBanner, ProgramDayList, ProgramOutsideBlock, UmbrellaGroupCard, dayHeaderText, programByDay, umbrellaShortName,
} from '../../src/components/EventFeedUI';
import { useLang } from '../../src/context/LanguageContext';
import { useTr } from '../../src/i18n/autoTr';
import { CMW_HUB_PATH, phaseOn as cmwPhaseOn, useCmwToday } from '../../src/lib/cmw';
import { goBackOr, goHome, goTab } from '../../src/lib/nav';
import {
  Bucket, CATEGORY_META, EVENT_CATEGORIES, EventCategory, PublicEvent,
  bucket, childrenOf, dayCounts, dayRange, destacados, formatMonthYear, groupByDay, groupByMonth, hasRealCoords,
  plusDays, useEventsFeed,
} from '../../src/lib/eventsFeed';

const GUTTER = 16; // §16.3: 16 px gutters
const GAP = 12;    // §16.3: 12 px between cards
const HERO_H = 228;
const BUCKETS: { key: Bucket; label: string }[] = [
  { key: 'hoy', label: 'Hoy' },
  { key: 'semana', label: 'Esta semana' },
  { key: 'proximos', label: 'Próximos' },
];

const asCategory = (v: unknown): EventCategory | null =>
  typeof v === 'string' && (EVENT_CATEGORIES as readonly string[]).includes(v) ? (v as EventCategory) : null;
const asBucket = (v: unknown): Bucket | null =>
  v === 'hoy' || v === 'semana' || v === 'proximos' ? v : null;

const heroWidth = (w: number): number => Math.round(Math.min(320, Math.max(248, (w > 0 ? w : 390) - 72)));

type Block = { key: string; node: React.ReactNode; sticky?: boolean };

// ── Screen ───────────────────────────────────────────────────────────────────
export default function QuePasaScreen() {
  const router = useRouter();
  const { lang } = useLang();
  const tr = useTr();
  const { width: windowWidth } = useWindowDimensions();
  const params = useLocalSearchParams<{ cat?: string; bucket?: string; open?: string }>();
  const paramCat = asCategory(params.cat);
  const paramBucket = asBucket(params.bucket);
  const paramOpen = typeof params.open === 'string' && /^ce-[a-z0-9-]+$/.test(params.open) ? params.open : null;
  const { feed, today, loading, error, reload } = useEventsFeed();
  const cmwToday = useCmwToday();

  // Defaults on the first render (the static HTML has no query string); the
  // ?cat= / ?bucket= deep link is applied after mount — no hydration mismatch.
  const [which, setWhich] = useState<Bucket>('hoy');
  const [cat, setCat] = useState<EventCategory | 'all'>('all');
  const [weekDay, setWeekDay] = useState<string | null>(null);
  const [openUmb, setOpenUmb] = useState<Record<string, boolean>>({});
  // A ?cat= deep link lands on the first period that has one, once per link;
  // without any deep link a quiet "Hoy" opens on the first period with rows.
  const autoPickedFor = useRef<string | null>(null);
  const autoBucketDone = useRef(false);

  useEffect(() => { if (paramCat) setCat(paramCat); }, [paramCat]);
  useEffect(() => { if (paramBucket) { autoBucketDone.current = true; setWhich(paramBucket); } }, [paramBucket]);
  // /que-pasa?open=<umbrella id> (from the umbrella's detail page): Próximos with that program open.
  useEffect(() => {
    if (!paramOpen) return;
    autoBucketDone.current = true;
    setWhich('proximos');
    setOpenUmb((m) => (m[paramOpen] ? m : { ...m, [paramOpen]: true }));
  }, [paramOpen]);

  const events = useMemo(() => feed?.data.events ?? [], [feed]);
  const tbcRows = useMemo(() => feed?.data.date_tbc ?? [], [feed]);
  const offline = !!feed?.offline;

  const inCat = useCallback(
    (list: PublicEvent[]) => (cat === 'all' ? list : list.filter((e) => e.category === cat)),
    [cat],
  );

  // ── Umbrellas and their programs ──
  const umbrellas = useMemo(() => events.filter((e) => e.is_umbrella), [events]);
  const umbrellaById = useMemo(() => new Map(umbrellas.map((u) => [u.event_id, u])), [umbrellas]);
  const programs = useMemo(() => {
    const m = new Map<string, PublicEvent[]>();
    if (!today) return m;
    for (const u of umbrellas) m.set(u.event_id, childrenOf(u, events, today));
    return m;
  }, [umbrellas, events, today]);
  /** The sub-events an umbrella card lists under the current category chip. */
  const programFor = useCallback((u: PublicEvent): PublicEvent[] => {
    const kids = programs.get(u.event_id) || [];
    if (cat === 'all') return kids;
    const match = kids.filter((k) => k.category === cat);
    return match.length || u.category !== cat ? match : kids;
  }, [programs, cat]);
  const umbrellaVisible = useCallback((u: PublicEvent): boolean =>
    cat === 'all' || u.category === cat || (programs.get(u.event_id) || []).some((k) => k.category === cat),
  [cat, programs]);
  const partOf = useCallback((ev: PublicEvent): string | null => {
    const u = ev.parent_id ? umbrellaById.get(ev.parent_id) : undefined;
    return u ? umbrellaShortName(u, lang) : null;
  }, [umbrellaById, lang]);

  // ── Destacados (§16.2) — the headline rail, never filtered by the chips ──
  const heroes = useMemo(() => (today ? destacados(events, Date.now(), 6) : []), [events, today]);

  // ── Buckets (§16.3). Non-umbrella rows only; umbrellas are group cards. ──
  const rowsCat = useMemo(() => inCat(events.filter((e) => !e.is_umbrella)), [events, inCat]);
  const hoyRows = useMemo(() => (today ? inCat(bucket(events, 'hoy', today)) : []), [events, today, inCat]);

  const weekDays = useMemo(() => (today ? dayRange(today, 7) : []), [today]);
  const weekEnd = weekDays.length ? weekDays[weekDays.length - 1] : '';
  const weekCounts = useMemo(() => (today ? dayCounts(rowsCat, weekDays, today) : {}), [rowsCat, weekDays, today]);
  const weekAll = useMemo(
    () => (today ? groupByDay(rowsCat, today, weekEnd, { firstDayOnly: true, today }) : []),
    [rowsCat, today, weekEnd],
  );
  const weekShown = useMemo(
    () => (today && weekDay ? groupByDay(rowsCat, weekDay, weekDay, { today }) : weekAll),
    [rowsCat, today, weekDay, weekAll],
  );
  const weekUmbrellas = useMemo(() => (today
    ? umbrellas.filter((u) => umbrellaVisible(u) && (u.start_date as string) <= weekEnd && (u.end_date || (u.start_date as string)) >= today)
    : []), [umbrellas, umbrellaVisible, today, weekEnd]);

  const proxFrom = today ? plusDays(today, 7) : '';
  // Sub-events fold into their umbrella's card in Próximos (it is in the feed) — except a
  // flagship sub-event (the Bando, the Festival Náutico), which is a headline event of its own
  // month and is listed there too, with its "Parte de: …" tag (§16.1: top events always show).
  const foldsAway = useCallback(
    (e: PublicEvent) => !!e.parent_id && umbrellaById.has(e.parent_id) && !e.flagship,
    [umbrellaById],
  );
  const months = useMemo(() => {
    if (!today) return [];
    const rows = rowsCat.filter((e) => !foldsAway(e));
    return groupByMonth([...rows, ...umbrellas.filter(umbrellaVisible)], proxFrom, today);
  }, [today, rowsCat, foldsAway, umbrellas, umbrellaVisible, proxFrom]);
  const visibleTbc = useMemo(() => inCat(tbcRows), [tbcRows, inCat]);

  // One count everywhere (tab badge, day header, date chip, Agenda): EVENT rows only. An
  // umbrella is a group card, not an event; its own count is "N eventos del programa".
  const rowCount = (list: PublicEvent[]): number => list.filter((e) => !e.is_umbrella).length;
  const counts: Record<Bucket, number> | null = useMemo(() => (today ? {
    hoy: hoyRows.length,
    semana: weekAll.reduce((n, g) => n + g.events.length, 0),
    proximos: months.reduce((n, g) => n + rowCount(g.events), 0) + visibleTbc.length,
  } : null), [today, hoyRows, weekAll, months, visibleTbc]);
  // What the period renders (rows + group cards): decides the empty line, never a badge.
  const items: Record<Bucket, number> | null = useMemo(() => (counts ? {
    hoy: counts.hoy,
    semana: counts.semana + weekUmbrellas.length,
    proximos: counts.proximos + months.reduce((n, g) => n + (g.events.length - rowCount(g.events)), 0),
  } : null), [counts, weekUmbrellas, months]);

  // Same counts without the category chip — tells "empty period" from "empty category".
  const unfiltered: Record<Bucket, number> | null = useMemo(() => {
    if (!today) return null;
    const all = events.filter((e) => !e.is_umbrella);
    return {
      hoy: bucket(events, 'hoy', today).length,
      semana: groupByDay(all, today, weekEnd, { firstDayOnly: true, today }).reduce((n, g) => n + g.events.length, 0)
        + umbrellas.filter((u) => (u.start_date as string) <= weekEnd).length,
      proximos: groupByMonth(events, proxFrom, today).reduce((n, g) => n + g.events.length, 0) + tbcRows.length,
    };
  }, [today, events, weekEnd, umbrellas, proxFrom, tbcRows]);

  useEffect(() => {
    if (!feed || !counts) return;
    if (paramCat && !paramBucket) {
      // ?cat= deep link (e.g. /concerts → /que-pasa?cat=concert): first period with one.
      if (cat !== paramCat || autoPickedFor.current === paramCat) return;
      autoPickedFor.current = paramCat;
      autoBucketDone.current = true;
      const first = BUCKETS.map((b) => b.key).find((k) => counts[k] > 0);
      if (first) setWhich(first);
      return;
    }
    if (autoBucketDone.current || paramBucket) return;
    autoBucketDone.current = true;
    const has = items || counts;
    if (has.hoy === 0) setWhich(has.semana > 0 ? 'semana' : has.proximos > 0 ? 'proximos' : 'hoy');
  }, [feed, counts, items, paramCat, paramBucket, cat]);

  const catsPresent = useMemo(() => {
    const present = new Set<EventCategory>();
    for (const e of events) present.add(e.category);
    for (const e of tbcRows) present.add(e.category);
    if (cat !== 'all') present.add(cat);
    return EVENT_CATEGORIES.filter((c) => present.has(c));
  }, [events, tbcRows, cat]);

  const hasPins = useMemo(() => events.some((e) => hasRealCoords(e)), [events]);

  const openEvent = useCallback((id: string) => { router.push(`/event/${id}` as never); }, [router]);
  const openMap = useCallback(() => { router.push('/(tabs)/mapa?layer=eventos' as never); }, [router]);
  const openMiAgenda = useCallback(() => { goTab(router, '/(tabs)/agenda?mode=mi_agenda'); }, [router]);
  const toggleUmb = useCallback((id: string) => { setOpenUmb((m) => ({ ...m, [id]: !m[id] })); }, []);
  const pickDay = useCallback((d: string) => { setWeekDay((cur) => (cur === d ? null : d)); }, []);

  const canGoBack = router.canGoBack();
  const ready = !!feed && !!today;
  const heroW = heroWidth(windowWidth);
  // An empty feed: the only real content on the page is Cartagena Music Week (before/during).
  const feedEmpty = ready && events.length === 0 && tbcRows.length === 0;
  const cmwLive = !!cmwToday && cmwPhaseOn(cmwToday) !== 'after';
  const openCmw = useCallback(() => { router.push(CMW_HUB_PATH as never); }, [router]);

  // ── Honest one-line empty state per bucket / day / category ──
  const empty = (() => {
    if (!counts || !unfiltered || !items) return null;
    if (cat !== 'all' && unfiltered[which] > 0) {
      return { text: tr('No hay eventos de esta categoría en este periodo'), cta: `${tr('Ver todas las categorías')} →`, onPress: () => setCat('all') };
    }
    if (feedEmpty) {
      // Never a link to another empty list: the CMW hub is the one thing with rows.
      return cmwLive
        ? { text: tr('Aún no hay eventos confirmados'), cta: `${tr('Ver Cartagena Music Week')} →`, onPress: openCmw }
        : { text: `${tr('Aún no hay eventos confirmados')}. ${tr('Estamos verificando fuentes oficiales. Vuelve pronto.')}`, cta: '', onPress: undefined };
    }
    if (which === 'hoy') {
      const next: Bucket = items.semana > 0 ? 'semana' : 'proximos';
      return {
        text: tr('No hay eventos confirmados para hoy — mira los próximos'),
        cta: `${tr(next === 'semana' ? 'Ver esta semana' : 'Ver próximos')} →`,
        onPress: () => setWhich(next),
      };
    }
    if (which === 'semana') {
      return { text: tr('No hay eventos confirmados esta semana'), cta: `${tr('Ver próximos')} →`, onPress: () => setWhich('proximos') };
    }
    return { text: `${tr('Aún no hay próximos eventos confirmados')}. ${tr('Estamos verificando fuentes oficiales. Vuelve pronto.')}`, cta: '', onPress: undefined };
  })();

  // ── Content blocks: a flat list so month/day headers can stick ──
  const blocks: Block[] = [];
  const row = (ev: PublicEvent, lead: 'date' | 'time', key: string, i: number) => (
    <FadeInUp key={key} delay={Math.min(i, 5) * 40} distance={12}>
      <EventDayRow
        ev={ev}
        lang={lang}
        tr={tr}
        offline={offline}
        lead={lead}
        partOf={partOf(ev)}
        onPress={openEvent}
        testID={`que-pasa-card-${ev.event_id}`}
      />
    </FadeInUp>
  );
  const umbCard = (u: PublicEvent) => (
    <UmbrellaGroupCard
      key={`umb-${u.event_id}`}
      ev={u}
      items={programFor(u)}
      today={today as string}
      lang={lang}
      tr={tr}
      offline={offline}
      expanded={!!openUmb[u.event_id]}
      onToggle={toggleUmb}
      onOpen={openEvent}
      programInline={false}
      testID={`que-pasa-umbrella-${u.event_id}`}
    />
  );
  // An open program is rendered UNDER its card as day blocks whose headers stick, so the
  // context line reads "Jue 12 nov · Fiestas de Independencia" over the November rows instead
  // of the month header the program started in.
  const programBlocks = (u: PublicEvent): Block[] => {
    if (!openUmb[u.event_id]) return [];
    const days = programByDay(programFor(u), today as string);
    const name = umbrellaShortName(u, lang);
    return days.flatMap((g, i) => {
      const last = i === days.length - 1;
      return [
        {
          key: `prog-h-${u.event_id}-${g.day}`,
          sticky: true,
          node: (
            <View style={styles.pad}>
              <ProgramOutsideBlock ev={u}>
                <FeedDayHeader label={`${dayHeaderText(g.day, today as string, lang, tr)} · ${name}`} tr={tr} testID={`que-pasa-program-day-${g.day}`} />
              </ProgramOutsideBlock>
            </View>
          ),
        },
        {
          key: `prog-l-${u.event_id}-${g.day}`,
          node: (
            <View style={[styles.pad, last && { marginBottom: GAP }]}>
              <ProgramOutsideBlock ev={u} last={last}>
                <ProgramDayList group={g} umbrella={u} today={today as string} lang={lang} tr={tr} offline={offline} onOpen={openEvent} label="" />
              </ProgramOutsideBlock>
            </View>
          ),
        },
      ];
    });
  };

  if (!ready && !error) {
    blocks.push({
      key: 'skeleton',
      node: (
        <View style={styles.list} testID="que-pasa-skeleton">
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.skRow}>
              <Skeleton width={60} height={84} borderRadius={0} />
              <View style={{ flex: 1, padding: 12, gap: 8 }}>
                <Skeleton width="75%" height={15} />
                <Skeleton width="50%" height={11} />
                <Skeleton width="60%" height={10} />
              </View>
            </View>
          ))}
        </View>
      ),
    });
  } else if (!feed && !!error && !loading) {
    blocks.push({
      key: 'error',
      node: (
        <View style={styles.pad} testID="que-pasa-error">
          <FeedEmptyLine
            icon="cloud-offline-outline"
            text={`${tr('No pudimos cargar la agenda')}. ${tr('Verifica tu conexión e intenta de nuevo')}`}
            cta={`${tr('Reintentar')} →`}
            onPress={reload}
          />
        </View>
      ),
    });
  } else if (ready && counts) {
    if (which === 'hoy') {
      if (hoyRows.length) {
        blocks.push({
          key: 'hoy-h',
          sticky: true,
          node: <View style={styles.pad}><FeedDayHeader label={dayHeaderText(today as string, today as string, lang, tr)} count={hoyRows.length} tr={tr} /></View>,
        });
        blocks.push({ key: 'hoy-l', node: <View style={styles.list}>{hoyRows.map((e, i) => row(e, 'time', e.event_id, i))}</View> });
      }
    } else if (which === 'semana') {
      blocks.push({
        key: 'strip',
        node: (
          <View style={styles.stripWrap}>
            <DateStrip
              days={weekDays}
              counts={weekCounts}
              selected={weekDay}
              today={today as string}
              lang={lang}
              tr={tr}
              onSelect={pickDay}
              fill
              testIDPrefix="que-pasa-day"
            />
            {!!weekDay && (
              <TouchableOpacity onPress={() => setWeekDay(null)} style={styles.clearDay} accessibilityRole="button" testID="que-pasa-week-all">
                <Ionicons name="close-circle" size={14} color={COLORS.primary} />
                <Text style={styles.clearDayText}>{tr('Ver toda la semana')}</Text>
              </TouchableOpacity>
            )}
          </View>
        ),
      });
      const days = weekDay ? [weekDay] : weekDays;
      let n = 0;
      for (const d of days) {
        const group = weekShown.find((g) => g.day === d);
        const umbs = weekDay ? [] : weekUmbrellas.filter((u) => ((u.start_date as string) < (today as string) ? today : u.start_date) === d);
        if (!group && !umbs.length) continue;
        blocks.push({
          key: `wk-h-${d}`,
          sticky: true,
          node: <View style={styles.pad}><FeedDayHeader label={dayHeaderText(d, today as string, lang, tr)} count={group?.events.length || 0} tr={tr} /></View>,
        });
        for (const u of umbs) {
          blocks.push({ key: `wk-u-${d}-${u.event_id}`, node: <View style={styles.list}>{umbCard(u)}</View> });
          blocks.push(...programBlocks(u));
        }
        if (group) {
          blocks.push({
            key: `wk-l-${d}`,
            node: <View style={styles.list}>{group.events.map((e) => row(e, 'time', `${d}-${e.event_id}`, n++))}</View>,
          });
        }
      }
    } else {
      months.forEach((m) => {
        const programCount = m.events.filter((e) => e.is_umbrella).reduce((n, u) => n + programFor(u).length, 0);
        blocks.push({
          key: `m-h-${m.key}`,
          sticky: true,
          node: (
            <View style={styles.pad}>
              <FeedMonthHeader
                label={formatMonthYear(m.year, m.month0, lang)}
                count={m.events.filter((e) => !e.is_umbrella).length}
                programCount={programCount}
                tr={tr}
                testID={`que-pasa-month-${m.key}`}
              />
            </View>
          ),
        });
        // Consecutive plain rows share one list; an umbrella card is its own block so its open
        // program (sticky day headers) can follow it.
        let run: PublicEvent[] = [];
        let n = 0;
        const flush = () => {
          if (!run.length) return;
          const rows = run;
          run = [];
          blocks.push({
            key: `m-l-${m.key}-${rows[0].event_id}`,
            node: <View style={styles.list}>{rows.map((e) => row(e, 'date', e.event_id, n++))}</View>,
          });
        };
        m.events.forEach((e) => {
          if (!e.is_umbrella) { run.push(e); return; }
          flush();
          blocks.push({ key: `m-u-${m.key}-${e.event_id}`, node: <View style={styles.list}>{umbCard(e)}</View> });
          blocks.push(...programBlocks(e));
        });
        flush();
      });
      // Por confirmar — date_tbc rows, inside Próximos, never with a date: the same calendar row
      // with the announced month over "?" in the date column (the section already says the rest).
      if (visibleTbc.length) {
        blocks.push({
          key: 'tbc',
          node: (
            <View style={styles.tbcSection} testID="que-pasa-tbc">
              <View style={styles.tbcHeader}>
                <Ionicons name="help-circle-outline" size={16} color={COLORS.mustard} />
                <Text style={styles.tbcTitle}>{tr('Por confirmar')}</Text>
              </View>
              <Text style={styles.tbcSub}>{tr('Anunciados por su fuente, sin fecha exacta todavía')}</Text>
              <View style={{ gap: GAP }}>
                {visibleTbc.map((ev) => (
                  <EventDayRow
                    key={ev.event_id}
                    ev={ev}
                    lang={lang}
                    tr={tr}
                    offline={offline}
                    lead="tbc"
                    onPress={openEvent}
                    testID={`que-pasa-tbc-${ev.event_id}`}
                  />
                ))}
              </View>
            </View>
          ),
        });
      }
    }

    const shownCount = which === 'semana' && weekDay ? (weekShown[0]?.events.length || 0) : (items || counts)[which];
    if (shownCount === 0 && empty) {
      const dayEmpty = which === 'semana' && !!weekDay && (items || counts).semana > 0;
      blocks.push({
        key: 'empty',
        node: (
          <View style={styles.pad} testID={`que-pasa-empty-${which}`}>
            {dayEmpty ? (
              <FeedEmptyLine text={tr('Nada confirmado este día')} cta={`${tr('Ver toda la semana')} →`} onPress={() => setWeekDay(null)} />
            ) : (
              <FeedEmptyLine text={empty.text} cta={empty.cta || undefined} onPress={empty.onPress} />
            )}
          </View>
        ),
      });
    }

    blocks.push({
      key: 'footer',
      node: (
        <View style={styles.footer}>
          <View style={styles.footerRow}>
            <Ionicons name="shield-checkmark-outline" size={13} color={COLORS.textFaint} />
            <Text style={styles.footerText}>{tr('Cada evento enlaza a la fuente que lo confirma.')}</Text>
          </View>
          <Text style={styles.footerText}>{tr('Horarios y precios pueden cambiar: confirma siempre con el organizador.')}</Text>
        </View>
      ),
    });
  }

  // ── Page chrome (always rendered; the content blocks follow) ──
  const chrome: Block[] = [
    {
      key: 'header',
      node: (
        <View style={styles.headerRow}>
          {canGoBack ? (
            <TouchableOpacity testID="que-pasa-back-btn" onPress={() => goBackOr(router)} style={styles.navBtn} accessibilityRole="button" accessibilityLabel={tr('Volver')}>
              <Ionicons name="arrow-back" size={20} color={COLORS.textMain} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity testID="que-pasa-home-btn" onPress={() => goHome(router)} style={styles.navBtn} accessibilityRole="button" accessibilityLabel={tr('Inicio')}>
              <Ionicons name="home-outline" size={19} color={COLORS.textMain} />
            </TouchableOpacity>
          )}
          <View style={styles.titleWrap}>
            <Text style={styles.title} numberOfLines={1} accessibilityRole="header">{tr('Qué pasa')}</Text>
          </View>
          <TouchableOpacity testID="que-pasa-mi-agenda" onPress={openMiAgenda} style={styles.agendaBtn} accessibilityRole="button" accessibilityLabel={tr('Mi agenda')}>
            <Ionicons name="bookmark-outline" size={16} color={COLORS.textMain} />
            <Text style={styles.agendaBtnText} numberOfLines={1}>{tr('Mi agenda')}</Text>
          </TouchableOpacity>
        </View>
      ),
    },
    {
      key: 'promise',
      node: (
        <View style={styles.promiseRow} accessibilityRole="text">
          <Ionicons name="shield-checkmark-outline" size={12} color={COLORS.official} />
          <Text style={styles.promise} numberOfLines={1}>{tr('Solo eventos con fuente verificada')}</Text>
        </View>
      ),
    },
  ];
  // Cartagena Music Week (docs/cmw/DESIGN.md §4): the very top, above Destacados,
  // in the before/during phases; null otherwise. CMW rows never enter this feed.
  chrome.push({ key: 'cmw', node: <CmwBanner style={styles.banner} /> });
  if (offline && feed) {
    chrome.push({ key: 'offline', node: <FeedOfflineBanner stamp={feed.data.generated_at} lang={lang} tr={tr} style={styles.banner} /> });
  }
  // Destacados — first, above the calendar controls (§16.2).
  if (!ready && !error) {
    chrome.push({
      key: 'hero-sk',
      node: (
        <View style={styles.heroSection}>
          <View style={styles.sectionHead}><Skeleton width={120} height={18} /></View>
          <ScrollView horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.heroRail}>
            {[0, 1].map((i) => <Skeleton key={i} width={heroW} height={HERO_H} borderRadius={RADIUS.xl} />)}
          </ScrollView>
        </View>
      ),
    });
  } else if (heroes.length) {
    chrome.push({
      key: 'heroes',
      node: (
        <View style={styles.heroSection} testID="que-pasa-destacados">
          <View style={styles.sectionHead}>
            <Ionicons name="star" size={16} color={COLORS.mustard} />
            <Text style={styles.sectionTitle}>{tr('Destacados')}</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.heroRail}
            decelerationRate="fast"
            snapToInterval={heroW + GAP}
            snapToAlignment="start"
          >
            {heroes.map((ev, i) => (
              <EventHeroCard
                key={ev.event_id}
                ev={ev}
                lang={lang}
                tr={tr}
                offline={offline}
                width={heroW}
                height={HERO_H}
                onPress={openEvent}
                programCount={ev.is_umbrella ? (programs.get(ev.event_id) || []).length : undefined}
                priority={i < 2 ? 'high' : 'normal'}
                testID={`que-pasa-hero-${ev.event_id}`}
              />
            ))}
          </ScrollView>
        </View>
      ),
    });
  }
  chrome.push({
    key: 'segmented',
    node: (
      <View style={styles.segmented} accessibilityRole="tablist">
        {BUCKETS.map((b) => {
          const active = which === b.key;
          const n = counts ? counts[b.key] : null;
          return (
            <TouchableOpacity
              key={b.key}
              style={[styles.segment, active && styles.segmentActive]}
              onPress={() => setWhich(b.key)}
              activeOpacity={0.85}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              aria-selected={active}
              testID={`que-pasa-bucket-${b.key}`}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1}>{tr(b.label)}</Text>
              {/* Count floats on the corner so the label keeps the full width (FR "Cette semaine"). */}
              {n !== null && n > 0 && (
                <View style={[styles.segmentCount, active && styles.segmentCountActive]} pointerEvents="none">
                  <Text style={[styles.segmentCountText, active && styles.segmentCountTextActive]}>{n}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    ),
  });
  if (catsPresent.length > 1) {
    chrome.push({
      key: 'chips',
      node: (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipsScroll}>
          <TouchableOpacity
            style={styles.chipHit}
            onPress={() => setCat('all')}
            accessibilityRole="button"
            accessibilityState={{ selected: cat === 'all' }}
            testID="que-pasa-cat-all"
          >
            <View style={[styles.chip, cat === 'all' && styles.chipActive]}>
              <Text style={[styles.chipText, cat === 'all' && styles.chipTextActive]}>{tr('Todos')}</Text>
            </View>
          </TouchableOpacity>
          {catsPresent.map((c) => {
            const active = cat === c;
            const meta = CATEGORY_META[c];
            return (
              <TouchableOpacity
                key={c}
                style={styles.chipHit}
                onPress={() => setCat(active ? 'all' : c)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                testID={`que-pasa-cat-${c}`}
              >
                <View style={[styles.chip, active && styles.chipActive]}>
                  <View style={[styles.chipDot, { backgroundColor: meta.color }]} />
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{tr(meta.label)}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ),
    });
  }
  if (hasPins) {
    chrome.push({
      key: 'map',
      node: (
        <TouchableOpacity style={styles.mapLink} onPress={openMap} accessibilityRole="link" testID="que-pasa-map">
          <Ionicons name="map-outline" size={15} color={COLORS.official} />
          <Text style={styles.mapLinkText}>{tr('Ver en el mapa')}</Text>
          <Ionicons name="chevron-forward" size={13} color={COLORS.official} />
        </TouchableOpacity>
      ),
    });
  }
  // Proximity offer — opt-in, phone-side only; never offered from an offline copy.
  if (ready && !offline) {
    chrome.push({ key: 'nearby', node: <View style={styles.pad}><NearbyEventsCard events={events} /></View> });
  }

  const all = [...chrome, ...blocks];
  const sticky = all.flatMap((b, i) => (b.sticky ? [i] : []));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Head><title>{`${tr('Qué pasa en Cartagena')} · AMO Life`}</title></Head>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} stickyHeaderIndices={sticky}>
        {all.map((b) => <View key={b.key}>{b.node}</View>)}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { paddingBottom: SPACING.xxl },
  pad: { paddingHorizontal: GUTTER },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: GUTTER, paddingTop: SPACING.md, paddingBottom: 0 },
  navBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.hairline, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1, minWidth: 0, justifyContent: 'center' },
  title: { ...TYPE.title1, fontSize: 24, lineHeight: 30, color: COLORS.textMain },
  promiseRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: GUTTER, marginTop: 6 },
  promise: { flexShrink: 1, fontSize: 12, lineHeight: 16, color: COLORS.textMuted, ...FONTS.medium },
  agendaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44, paddingHorizontal: 12, maxWidth: 132,
    borderRadius: RADIUS.full, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.hairline,
  },
  agendaBtnText: { fontSize: 12.5, color: COLORS.textMain, ...FONTS.semibold, flexShrink: 1 },
  banner: { marginHorizontal: GUTTER, marginTop: SPACING.md },

  heroSection: { marginTop: SPACING.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: GUTTER, marginBottom: GAP },
  sectionTitle: { ...TYPE.title3, color: COLORS.textMain },
  heroRail: { paddingHorizontal: GUTTER, gap: GAP },

  segmented: {
    flexDirection: 'row', marginHorizontal: GUTTER, marginTop: SPACING.lg, padding: 4, gap: 4,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border,
  },
  segment: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 44, borderRadius: RADIUS.full, paddingHorizontal: 8, position: 'relative' },
  segmentActive: { backgroundColor: COLORS.primary },
  segmentText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.semibold, flexShrink: 1 },
  segmentTextActive: { color: COLORS.black, ...FONTS.bold },
  segmentCount: {
    position: 'absolute', top: -4, right: 2, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.border,
  },
  segmentCountActive: { backgroundColor: COLORS.textMain, borderColor: COLORS.primary },
  segmentCountText: { fontSize: 10, color: COLORS.textMuted, ...FONTS.bold },
  segmentCountTextActive: { color: COLORS.black },

  chipsScroll: { flexGrow: 0, marginTop: GAP - 4 },
  chips: { paddingHorizontal: GUTTER, gap: 6 },
  // 44 px hit area (paddingVertical 4) around the 36 px visual pill
  chipHit: { minHeight: 44, justifyContent: 'center', paddingVertical: 4 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 12,
    borderRadius: RADIUS.full, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.textMain, borderColor: COLORS.textMain },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { fontSize: 12.5, color: COLORS.textMuted, ...FONTS.semibold },
  chipTextActive: { color: COLORS.black },

  mapLink: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-end', minHeight: 44,
    marginHorizontal: GUTTER, marginTop: 2, paddingHorizontal: 4,
  },
  mapLinkText: { fontSize: 12.5, color: COLORS.official, ...FONTS.semibold },

  stripWrap: { paddingHorizontal: GUTTER, marginTop: GAP },
  clearDay: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', minHeight: 44, marginTop: 2, paddingRight: 8 },
  clearDayText: { fontSize: 12.5, color: COLORS.primary, ...FONTS.semibold },

  list: { paddingHorizontal: GUTTER, gap: GAP },
  skRow: {
    flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1,
    borderColor: COLORS.hairline, overflow: 'hidden', marginTop: GAP,
  },

  tbcSection: { paddingHorizontal: GUTTER, marginTop: SPACING.xl },
  tbcHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tbcTitle: { ...TYPE.title3, color: COLORS.textMain },
  tbcSub: { ...TYPE.footnote, color: COLORS.textMuted, marginTop: 2, marginBottom: SPACING.sm },

  footer: { alignItems: 'center', gap: 4, paddingHorizontal: SPACING.xl, marginTop: SPACING.xl },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  footerText: { fontSize: 11, lineHeight: 16, color: COLORS.textFaint, ...FONTS.medium, textAlign: 'center' },
});
