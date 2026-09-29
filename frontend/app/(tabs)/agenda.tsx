// Agenda tab. "Salir hoy" (EVENTS-ELITE §10, §16.3) = the verified city feed for
// one Bogotá day — a 14-day date strip with count dots, the same calendar row as
// /que-pasa (EventDayRow), flagship first within the day — plus that day's
// partner-published events ("Publicado por los locales", never "verified").
// "Mi agenda" is the user's saved calendar (unchanged). Every date on this
// screen is computed after mount in Bogotá time (no SSR date text, #418).
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Alert } from '../../src/lib/alert';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS, TYPE, TIER_COLORS, Tier } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { eventPriceLabel } from '../../src/utils/price';
import { PartnerEventCard, PartnerEvent } from '../../src/components/PartnerEventCard';
import { useMyCalendar, CalendarItem } from '../../src/context/MyCalendarContext';
import { TierBadge } from '../../src/components/TierBadge';
import { SafeImage } from '../../src/components/SafeImage';
import { useTr } from '../../src/i18n/autoTr';
import { useLang } from '../../src/context/LanguageContext';
import { bogotaToday } from '../../src/lib/eventTime';
import { EventCategory, PublicEvent, dayCounts, dayRange, onDay, useEventsFeed } from '../../src/lib/eventsFeed';
import {
  DateStrip, DateStripSkeleton, EventDayRow, FeedDayHeader, FeedEmptyLine, FeedOfflineBanner, dayHeaderText, umbrellaShortName,
} from '../../src/components/EventFeedUI';

type Mode = 'salir' | 'mi_agenda';

const PARTNER_CATEGORIES = [
  { key: 'all', label: 'Todos', icon: 'apps' },
  { key: 'gastronomy', label: 'Gastronomía', icon: 'restaurant' },
  { key: 'music', label: 'Música', icon: 'musical-notes' },
  { key: 'party', label: 'Fiesta', icon: 'wine' },
  { key: 'wellness', label: 'Wellness', icon: 'leaf' },
  { key: 'art', label: 'Arte & Cultura', icon: 'color-palette' },
  { key: 'popup', label: 'Pop-up', icon: 'bag-handle' },
  { key: 'daypass', label: 'Pasa día', icon: 'sunny-outline' },
  { key: 'sunset', label: 'Sunset Experience', icon: 'partly-sunny' },
];

// "Salir hoy" chips → verified-feed categories (EVENTS-ELITE §2). A chip with no
// city-event equivalent filters city events out (partner events still match).
const SALIR_TO_FEED: Record<string, EventCategory[]> = {
  gastronomy: ['gastronomic'],
  music: ['concert', 'festival'],
  party: ['nightlife'],
  art: ['cultural'],
};

// §16.3: the Agenda strip covers two weeks; later dates live in /que-pasa (Próximos).
const STRIP_DAYS = 14;
const GUTTER = 16;

const formatLongDate = (iso: string) => {
  try {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  } catch { /* invalid date string — return raw */ return iso; }
};

const todayIso = () => bogotaToday();

export default function AgendaScreen() {
  const tr = useTr();
  const { lang } = useLang();
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<Mode>('salir');

  // React to mode query param (e.g., from "Mi Agenda" quick access in Home)
  useEffect(() => {
    if (params.mode === 'mi_agenda' || params.mode === 'salir') {
      setMode(params.mode as Mode);
    }
  }, [params.mode]);

  // Salir state. Every date here is computed after mount (Bogotá time).
  const [todayKey, setTodayKey] = useState<string | null>(null);
  useEffect(() => { setTodayKey(bogotaToday()); }, []);
  const [selectedSalirDate, setSelectedSalirDate] = useState<string | null>(null);
  useEffect(() => {
    // First mount, and a Bogotá day rollover that leaves the old pick behind.
    if (todayKey && (selectedSalirDate === null || selectedSalirDate < todayKey)) setSelectedSalirDate(todayKey);
  }, [todayKey, selectedSalirDate]);
  const [selectedSalirCat, setSelectedSalirCat] = useState('all');
  const [partnerEvents, setPartnerEvents] = useState<PartnerEvent[]>([]);
  const [loadingSalir, setLoadingSalir] = useState(false);

  // City events come ONLY from the verified feed (EVENTS-ELITE), shared with
  // /que-pasa and Home. A feed the loader cannot vouch for (404, or offline with
  // no copy ≤ 36 h) shows "No pudimos cargar la agenda" + Reintentar (§13 J1) —
  // never "no hay eventos para este día".
  const { feed, today: feedToday, error: feedError, reload: reloadFeed } = useEventsFeed();
  useEffect(() => { if (feedToday && feedToday !== todayKey) setTodayKey(feedToday); }, [feedToday, todayKey]);
  const feedFailed = !feed && !!feedError;
  const feedStamp = feed?.offline ? feed.data.generated_at : null; // set only for an offline copy
  const feedCat = useCallback((list: PublicEvent[]): PublicEvent[] => {
    if (selectedSalirCat === 'all') return list;
    const wanted = SALIR_TO_FEED[selectedSalirCat] || [];
    return list.filter((ev) => wanted.includes(ev.category));
  }, [selectedSalirCat]);
  const stripDays = useMemo(() => (todayKey ? dayRange(todayKey, STRIP_DAYS) : []), [todayKey]);
  const stripCounts = useMemo(
    () => (feed && todayKey ? dayCounts(feedCat(feed.data.events), stripDays, todayKey) : {}),
    [feed, todayKey, stripDays, feedCat],
  );
  // onDay: published, not finished, umbrellas excluded, flagship first (§16.3).
  const cityEvents = useMemo(
    () => (feed && selectedSalirDate ? feedCat(onDay(feed.data.events, selectedSalirDate)) : []),
    [feed, selectedSalirDate, feedCat],
  );
  const partOf = useCallback((ev: PublicEvent): string | null => {
    if (!ev.parent_id || !feed) return null;
    const u = feed.data.events.find((e) => e.event_id === ev.parent_id && e.is_umbrella);
    return u ? umbrellaShortName(u, lang) : null;
  }, [feed, lang]);
  const cityLoading = !feed && !feedError;

  // Mi Agenda state
  const { items: calendarItems, removeFromCalendar, refresh } = useMyCalendar();
  const [showPast, setShowPast] = useState(false);

  const loadPartnerEvents = useCallback(async () => {
    if (!selectedSalirDate) return;
    setLoadingSalir(true);
    try {
      const params = new URLSearchParams({ date: selectedSalirDate });
      if (selectedSalirCat !== 'all') params.append('category', selectedSalirCat);
      const peData = await api.get(`/partner-events?${params.toString()}`)
        .catch((e: unknown) => { console.error('[Agenda] partner-events', e); return []; });
      setPartnerEvents(Array.isArray(peData) ? peData : []);
    } catch (e) { console.error('[Agenda] loadPartnerEvents', e); }
    setLoadingSalir(false);
  }, [selectedSalirDate, selectedSalirCat]);

  useEffect(() => {
    if (mode === 'salir') loadPartnerEvents();
    if (mode === 'mi_agenda') refresh();
  }, [loadPartnerEvents, mode, refresh]);

  const retrySalir = useCallback(() => { reloadFeed(); loadPartnerEvents(); }, [reloadFeed, loadPartnerEvents]);
  const openCityEvent = useCallback((id: string) => { router.push(`/event/${id}` as any); }, [router]);

  // Group calendar items by date
  const groupedAgenda = useMemo(() => {
    const t = todayIso();
    const safeItems = Array.isArray(calendarItems) ? calendarItems : [];
    const filtered = showPast
      ? safeItems
      : safeItems.filter(i => i.date >= t);
    const sorted = [...filtered].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return (a.start_time || '').localeCompare(b.start_time || '');
    });
    const groups: Record<string, CalendarItem[]> = {};
    sorted.forEach(it => {
      if (!groups[it.date]) groups[it.date] = [];
      groups[it.date].push(it);
    });
    return Object.entries(groups);
  }, [calendarItems, showPast]);

  const pastCount = useMemo(() => {
    const t = todayIso();
    return (Array.isArray(calendarItems) ? calendarItems : []).filter(i => i.date < t).length;
  }, [calendarItems]);

  const handleRemove = (item: CalendarItem) => {
    Alert.alert(
      tr('Quitar de mi agenda'),
      `${tr('¿Quitar')} "${item.title || tr('este evento')}" ${tr('de tu agenda?')}`,
      [
        { text: tr('Cancelar'), style: 'cancel' },
        { text: tr('Quitar'), style: 'destructive', onPress: () => removeFromCalendar(item.item_id) },
      ]
    );
  };

  const handleOpenItem = (item: CalendarItem) => {
    if (item.item_type === 'partner_event') router.push(`/partner-event/${item.item_id}` as any);
    else if (item.item_type === 'event') router.push(`/event/${item.item_id}` as any);
    else if (item.item_type === 'concert') {
      // Concerts are verified-feed events now; a legacy concert id has no page.
      router.push((String(item.item_id).startsWith('ce-') ? `/event/${item.item_id}` : '/que-pasa?cat=concert') as any);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header with segmented control */}
      <View style={styles.header}>
        <Text style={styles.title}>{tr('Agenda')}</Text>
        <Text style={styles.subtitle}>
          {mode === 'salir' ? tr('Qué hacer hoy en Cartagena') : tr('Tus eventos guardados')}
        </Text>
        <View style={styles.segmentedControl}>
          <TouchableOpacity
            style={[styles.segment, mode === 'salir' && styles.segmentActive]}
            onPress={() => setMode('salir')}
            activeOpacity={0.85}
          >
            <Ionicons name="sparkles" size={14} color={mode === 'salir' ? COLORS.white : COLORS.textMuted} />
            <Text style={[styles.segmentText, mode === 'salir' && styles.segmentTextActive]}>
              {tr('Salir Hoy')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segment, mode === 'mi_agenda' && styles.segmentActive]}
            onPress={() => setMode('mi_agenda')}
            activeOpacity={0.85}
          >
            <Ionicons name="calendar" size={14} color={mode === 'mi_agenda' ? COLORS.white : COLORS.textMuted} />
            <Text style={[styles.segmentText, mode === 'mi_agenda' && styles.segmentTextActive]}>
              {tr('Mi Agenda')}
            </Text>
            {Array.isArray(calendarItems) && calendarItems.length > 0 && (
              <View style={[styles.badge, mode === 'mi_agenda' && styles.badgeActive]}>
                <Text style={[styles.badgeText, mode === 'mi_agenda' && styles.badgeTextActive]}>
                  {calendarItems.length}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {mode === 'salir' ? (
        <>
          {/* 14-day strip (§16.3): weekday · number · count of verified city events */}
          <View style={styles.stripWrap}>
            {todayKey ? (
              <DateStrip
                days={stripDays}
                counts={stripCounts}
                selected={selectedSalirDate}
                today={todayKey}
                lang={lang}
                tr={tr}
                onSelect={setSelectedSalirDate}
                inset={GUTTER}
                testIDPrefix="agenda-day"
              />
            ) : (
              <DateStripSkeleton n={7} inset={GUTTER} />
            )}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.catBar}
            style={styles.barScroll}
          >
            {PARTNER_CATEGORIES.map(c => {
              const isActive = selectedSalirCat === c.key;
              return (
                <TouchableOpacity
                  key={c.key}
                  style={[styles.catChip, isActive && styles.catChipActive]}
                  onPress={() => setSelectedSalirCat(c.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                >
                  <Ionicons name={c.icon as any} size={12} color={isActive ? COLORS.white : COLORS.textMuted} />
                  <Text style={[styles.catChipText, isActive && styles.catChipTextActive]}>
                    {tr(c.label)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {!!feedStamp && (
              <FeedOfflineBanner stamp={feedStamp} lang={lang} tr={tr} style={{ marginTop: SPACING.sm }} />
            )}
            {feedFailed && (
              <View accessibilityRole="alert" testID="agenda-feed-error">
                <FeedEmptyLine
                  icon="cloud-offline-outline"
                  text={`${tr('No pudimos cargar la agenda')} ·`}
                  cta={tr('Reintentar')}
                  onPress={retrySalir}
                  testID="agenda-feed-retry"
                />
              </View>
            )}
            {!selectedSalirDate || !todayKey || cityLoading || (loadingSalir && partnerEvents.length === 0 && cityEvents.length === 0) ? (
              <ActivityIndicator size="large" color={COLORS.icon} style={{ marginTop: 40 }} />
            ) : (
              <>
                <FeedDayHeader
                  label={dayHeaderText(selectedSalirDate, todayKey, lang, tr)}
                  count={partnerEvents.length + cityEvents.length}
                  tr={tr}
                  testID="agenda-day-header"
                />
                {partnerEvents.length === 0 && cityEvents.length === 0 ? (feedFailed ? null : (
                  <FeedEmptyLine
                    text={`${tr('No hay eventos para este día')} ·`}
                    cta={`${tr('Qué pasa en Cartagena')} →`}
                    onPress={() => router.push('/que-pasa' as any)}
                    testID="agenda-empty"
                  />
                )) : (
                  <>
                    {/* City events — the verified feed for this day, headline first (source + VERIFY label) */}
                    {cityEvents.length > 0 && (
                      <View style={styles.cityList}>
                        {cityEvents.map((ev) => (
                          <EventDayRow
                            key={ev.event_id}
                            ev={ev}
                            lang={lang}
                            tr={tr}
                            offline={!!feedStamp}
                            lead="time"
                            partOf={partOf(ev)}
                            onPress={openCityEvent}
                            testID={`agenda-city-${ev.event_id}`}
                          />
                        ))}
                      </View>
                    )}

                    {/* Partner events — published by the venue itself, never "verified" */}
                    {partnerEvents.length > 0 && (
                      <Text style={styles.cityEventsLabel}>{tr('Publicado por los locales')}</Text>
                    )}
                    {partnerEvents.map(e => (
                      <PartnerEventCard
                        key={e.event_id}
                        event={e}
                        onPress={() => router.push(`/partner-event/${e.event_id}` as any)}
                      />
                    ))}
                  </>
                )}
              </>
            )}
            <View style={{ height: SPACING.xxl }} />
          </ScrollView>
        </>
      ) : (
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: SPACING.xxl }}>
          {(!Array.isArray(calendarItems) || calendarItems.length === 0) ? (
            <View style={styles.empty}>
              <Ionicons name="calendar-outline" size={56} color={COLORS.textMuted} />
              <Text style={styles.emptyTitle}>{tr('Tu agenda está vacía')}</Text>
              <Text style={styles.emptyText}>
                {tr('Añade eventos tocando "Añadir a mi agenda" en cualquier evento de partner')}
              </Text>
              <TouchableOpacity
                style={styles.exploreBtn}
                onPress={() => setMode('salir')}
                activeOpacity={0.85}
              >
                <Ionicons name="sparkles" size={14} color={COLORS.white} />
                <Text style={styles.exploreBtnText}>{tr('Explorar eventos')}</Text>
              </TouchableOpacity>
            </View>
          ) : groupedAgenda.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="checkmark-done-circle-outline" size={56} color={COLORS.textMuted} />
              <Text style={styles.emptyTitle}>{tr('No tienes próximos eventos')}</Text>
              <Text style={styles.emptyText}>{tr('Tu agenda está al día')}</Text>
              {pastCount > 0 && (
                <TouchableOpacity
                  style={styles.exploreBtn}
                  onPress={() => setShowPast(true)}
                  activeOpacity={0.85}
                >
                  <Ionicons name="time-outline" size={14} color={COLORS.white} />
                  <Text style={styles.exploreBtnText}>
                    {tr('Ver pasados')} ({pastCount})
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <>
              {/* Toggle past events */}
              {pastCount > 0 && (
                <TouchableOpacity
                  style={styles.pastToggle}
                  onPress={() => setShowPast(p => !p)}
                  activeOpacity={0.8}
                >
                  <Ionicons name={showPast ? 'eye-off-outline' : 'time-outline'} size={14} color={COLORS.textMuted} />
                  <Text style={styles.pastToggleText}>
                    {`${tr(showPast ? 'Ocultar pasados' : 'Mostrar pasados')} (${pastCount})`}
                  </Text>
                </TouchableOpacity>
              )}

              {groupedAgenda.map(([date, dayItems]) => {
                const t = todayIso();
                const isPastDay = date < t;
                return (
                  <View key={date} style={styles.dayGroup}>
                    <View style={styles.dayHeader}>
                      <View style={styles.dayDot} />
                      <Text style={styles.dayHeaderText}>{formatLongDate(date)}</Text>
                      {date === t && (
                        <View style={styles.todayPill}>
                          <Text style={styles.todayPillText}>{tr('HOY')}</Text>
                        </View>
                      )}
                      {isPastDay && (
                        <View style={styles.pastPill}>
                          <Text style={styles.pastPillText}>{tr('PASADO')}</Text>
                        </View>
                      )}
                    </View>
                    {dayItems.map(it => {
                      const tierColors = it.partner_tier ? TIER_COLORS[it.partner_tier as Tier] : null;
                      return (
                        <TouchableOpacity
                          key={it.item_id}
                          style={[styles.agendaCard, isPastDay && { opacity: 0.6 }]}
                          activeOpacity={0.85}
                          onPress={() => handleOpenItem(it)}
                        >
                          {it.flyer_url ? (
                            <View style={styles.agendaFlyerWrap}>
                              <SafeImage uri={it.flyer_url} category={(it as any).category} style={styles.agendaFlyer} />
                              <View style={styles.agendaFlyerOverlay} />
                              {tierColors && <View style={[styles.tierStripe, { backgroundColor: tierColors.main }]} />}
                            </View>
                          ) : (
                            <View style={[styles.agendaFlyerWrap, styles.agendaFlyerPlaceholder]}>
                              <Ionicons name="calendar" size={28} color={COLORS.icon} />
                            </View>
                          )}
                          <View style={styles.agendaBody}>
                            <View style={styles.agendaTopRow}>
                              {it.start_time && (
                                <View style={styles.timePill}>
                                  <Ionicons name="time-outline" size={11} color={COLORS.icon} />
                                  <Text style={styles.timePillText}>
                                    {it.start_time}{it.end_time ? ` - ${it.end_time}` : ''}
                                  </Text>
                                </View>
                              )}
                              {it.is_free !== undefined && (
                                <View style={[styles.pricePill, it.is_free ? styles.priceFreeBg : styles.pricePaidBg]}>
                                  <Text style={styles.pricePillText}>
                                    {tr(eventPriceLabel(it.price, it.is_free))}
                                  </Text>
                                </View>
                              )}
                            </View>
                            <Text style={styles.agendaTitle} numberOfLines={2}>
                              {it.title || tr('Evento')}
                            </Text>
                            {it.partner_name ? (
                              <View style={styles.partnerRow}>
                                <Ionicons name="business-outline" size={11} color={COLORS.textMuted} />
                                <Text style={styles.partnerText} numberOfLines={1}>{it.partner_name}</Text>
                                <TierBadge tier={it.partner_tier} size="xs" />
                              </View>
                            ) : null}
                          </View>
                          <TouchableOpacity
                            style={styles.removeBtn}
                            onPress={() => handleRemove(it)}
                            hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}
                          >
                            <Ionicons name="close" size={16} color={COLORS.textMuted} />
                          </TouchableOpacity>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              })}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingHorizontal: GUTTER, paddingTop: SPACING.md, paddingBottom: SPACING.xs },
  title: { ...TYPE.display, color: COLORS.textMain },
  subtitle: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },

  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.full,
    padding: 4,
    marginTop: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: RADIUS.full,
  },
  segmentActive: { backgroundColor: COLORS.primary },
  segmentText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.semibold },
  segmentTextActive: { color: COLORS.white, ...FONTS.bold },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.coral,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  badgeText: { fontSize: 10, color: COLORS.white, ...FONTS.bold },
  badgeTextActive: { color: COLORS.white },

  // 14-day strip + category chips (§16.3: 16 px gutters)
  barScroll: { flexGrow: 0, flexShrink: 0 },
  stripWrap: { marginTop: SPACING.sm },
  catBar: { paddingHorizontal: GUTTER, gap: 6, paddingTop: SPACING.sm, paddingBottom: SPACING.xs },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  catChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  catChipText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.semibold },
  catChipTextActive: { color: COLORS.white },

  list: { flex: 1, paddingHorizontal: GUTTER, marginTop: SPACING.xs },
  cityList: { gap: 12, marginBottom: SPACING.md },

  empty: { alignItems: 'center', marginTop: 60, gap: SPACING.sm, paddingHorizontal: SPACING.lg },
  emptyTitle: { ...TYPE.headline, color: COLORS.textMain, marginTop: SPACING.xs },
  emptyText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', lineHeight: 19 },
  exploreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: RADIUS.full,
    marginTop: SPACING.md,
  },
  exploreBtnText: { fontSize: 13, color: COLORS.white, ...FONTS.bold },
  // Mi Agenda day grouping
  pastToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-end',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginVertical: SPACING.sm,
  },
  pastToggleText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.semibold },

  dayGroup: { marginBottom: SPACING.lg },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginBottom: SPACING.sm,
    marginTop: SPACING.sm,
  },
  dayDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.icon },
  dayHeaderText: {
    fontSize: 13,
    color: COLORS.textMain,
    ...FONTS.bold,
    textTransform: 'capitalize',
    flex: 1,
  },
  todayPill: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  todayPillText: { fontSize: 9, color: COLORS.white, ...FONTS.bold, letterSpacing: 0.8 },
  pastPill: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: RADIUS.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pastPillText: { fontSize: 9, color: COLORS.textMuted, ...FONTS.bold, letterSpacing: 0.8 },

  // Agenda card
  agendaCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    overflow: 'hidden',
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    position: 'relative',
  },
  agendaFlyerWrap: { width: 92, height: 110, position: 'relative' },
  agendaFlyer: { width: '100%', height: '100%' },
  agendaFlyerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.18)' },
  agendaFlyerPlaceholder: {
    backgroundColor: 'rgba(174,182,196,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tierStripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },

  agendaBody: { flex: 1, padding: SPACING.sm, justifyContent: 'space-between', paddingRight: 32 },
  agendaTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  timePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(174,182,196,0.15)',
    borderRadius: RADIUS.full,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  timePillText: { fontSize: 10, color: COLORS.icon, ...FONTS.bold },
  pricePill: { borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2 },
  priceFreeBg: { backgroundColor: COLORS.success },
  pricePaidBg: { backgroundColor: 'rgba(5,8,20,0.6)', borderWidth: 1, borderColor: COLORS.mustard },
  pricePillText: { fontSize: 9, color: COLORS.white, ...FONTS.bold, letterSpacing: 0.4 },

  agendaTitle: { fontSize: 13, color: COLORS.textMain, ...FONTS.bold, marginTop: 4, lineHeight: 17 },
  partnerRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  partnerText: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium, flex: 1 },

  removeBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // City events in Salir mode
  cityEventsLabel: {
    fontSize: 12,
    color: COLORS.icon,
    ...FONTS.bold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: SPACING.sm,
    marginTop: SPACING.xs,
  },
});
