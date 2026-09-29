import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS, TIER_COLORS, Tier } from '../src/constants/theme';
import { useFavorites } from '../src/context/FavoritesContext';
import { api } from '../src/constants/api';
import { eventPriceLabel } from '../src/utils/price';
import { TierBadge } from '../src/components/TierBadge';
import { SafeImage } from '../src/components/SafeImage';
import { EventRow } from '../src/components/EventFeedUI';
import { useTr } from '../src/i18n/autoTr';
import { useLang } from '../src/context/LanguageContext';
import { PublicEvent, loadFeed, loadFeedItem, sortEvents } from '../src/lib/eventsFeed';

type Tab = 'agenda' | 'partners' | 'reservations';

type Reservation = {
  reservation_id: string;
  partner_id: string;
  partner_name: string;
  partner?: { name?: string; image_url?: string; address?: string };
  event?: { event_id?: string; title?: string; flyer_url?: string } | null;
  type: string;
  date: string;
  time?: string | null;
  party_size: number;
  status: string;
};

const RES_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending_partner_activation: { label: 'Solicitud enviada', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
  pending_confirmation: { label: 'Esperando', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
  confirmed: { label: 'Confirmada', color: '#22C55E', bg: 'rgba(34,197,94,0.12)' },
  rejected_by_partner: { label: 'Rechazada', color: '#EF4444', bg: 'rgba(239,68,68,0.12)' },
  cancelled_by_user: { label: 'Cancelada', color: '#94A3B8', bg: 'rgba(148,163,184,0.12)' },
  cancelled_late: { label: 'Cancelada tarde', color: '#EF4444', bg: 'rgba(239,68,68,0.12)' },
  completed: { label: 'Completada', color: '#22C55E', bg: 'rgba(34,197,94,0.12)' },
  expired: { label: 'Expirada', color: '#94A3B8', bg: 'rgba(148,163,184,0.12)' },
};

// A saved city event, resolved through the verified feed (or feed/item for rows
// that left it — hidden / expired / review — so the status is told honestly).
type SavedEvent = { ev: PublicEvent; itemType: 'event' | 'concert' };

// Status line for a saved row that is no longer live (never a status code).
const SAVED_STATUS: Partial<Record<PublicEvent['status'], string>> = {
  hidden: 'Este evento ya no está confirmado',
  review: 'Este evento ya no está confirmado',
  expired: 'Este evento ya pasó',
};
const STATUS_ORDER: Record<PublicEvent['status'], number> = { published: 0, date_tbc: 1, review: 2, hidden: 2, expired: 3 };

const CAT_LABELS: Record<string, string> = {
  gastronomy: 'Gastronomía',
  music: 'Música',
  party: 'Fiesta',
  wellness: 'Wellness',
  art: 'Arte & Cultura',
  popup: 'Pop-up',
};

export default function FavoritesScreen() {
  const tr = useTr();
  const { lang } = useLang();
  const router = useRouter();
  const { favorites, toggleFavorite } = useFavorites();
  const [tab, setTab] = useState<Tab>('agenda');

  // Hydrated lists
  const [savedEvents, setSavedEvents] = useState<SavedEvent[]>([]);
  const [eventsOffline, setEventsOffline] = useState(false);
  const [partnerEvents, setPartnerEvents] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [resLoading, setResLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  // Group favorite IDs by type. City events/concerts: only verified-feed ids
  // (`ce-…`). Legacy event/concert ids — and rows the backend marks
  // status 'removed' — show nothing (EVENTS-ELITE §15 T3).
  const ids = useMemo(() => {
    const live = favorites.filter((f) => (f as { status?: string }).status !== 'removed');
    return {
      cityEvents: live
        .filter((f) => (f.item_type === 'event' || f.item_type === 'concert') && String(f.item_id).startsWith('ce-'))
        .map((f) => ({ id: f.item_id, type: (f.item_type === 'concert' ? 'concert' : 'event') as SavedEvent['itemType'] })),
      partner_event: live.filter(f => f.item_type === 'partner_event').map(f => f.item_id),
      partner: live.filter(f => f.item_type === 'partner').map(f => f.item_id),
    };
  }, [favorites]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        // City events: the verified feed first, feed/item for saved ids that left
        // it (hidden / expired / review → honest status line, never a live date).
        const cityTask = (async (): Promise<{ rows: SavedEvent[]; offline: boolean }> => {
          if (ids.cityEvents.length === 0) return { rows: [], offline: false };
          const feedState = await loadFeed().catch((e: unknown) => { console.error('[Favorites] events feed', e); return null; });
          const byId = new Map<string, PublicEvent>();
          if (feedState) for (const e of [...feedState.data.events, ...feedState.data.date_tbc]) byId.set(e.event_id, e);
          const rows = await Promise.all(ids.cityEvents.map(async ({ id, type }): Promise<SavedEvent | null> => {
            const hit = byId.get(id);
            if (hit) return { ev: hit, itemType: type };
            const r = await loadFeedItem(id);
            return r.kind === 'ok' ? { ev: r.event, itemType: type } : null;
          }));
          const found = rows.filter((r): r is SavedEvent => !!r);
          const ordered = sortEvents(found.map((r) => r.ev))
            .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
            .map((ev) => found.find((r) => r.ev.event_id === ev.event_id) as SavedEvent);
          return { rows: ordered, offline: !!feedState?.offline };
        })();
        // Partner events: fetch by id
        const peTask = Promise.all(
          ids.partner_event.map(id => api.get(`/partner-events/${id}`).catch(() => null))
        );
        // Partners: fetch by id
        const pTask = Promise.all(
          ids.partner.map(id => api.get(`/partners/${id}`).catch(() => null))
        );

        const [city, peList, pList] = await Promise.all([cityTask, peTask, pTask]);

        if (cancelled) return;
        setSavedEvents(city.rows);
        setEventsOffline(city.offline);
        // .filter(Boolean) drops null (caught fetch errors) but NOT a resolved []
        // ([] is truthy) → a stale favorite whose detail 404s would push a blank
        // card. Require a real object with an id.
        setPartnerEvents((peList || []).filter((p: any) => p && typeof p === 'object' && !Array.isArray(p) && (p.event_id || p.id)));
        setPartners((pList || []).filter((p: any) => p && typeof p === 'object' && !Array.isArray(p) && (p.partner_id || p.id)));
      } catch (e) { console.error(e); }
      if (!cancelled) setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [ids]);

  // ── Fetch reservations once, refresh when tab is opened ──
  const loadReservations = async () => {
    setResLoading(true);
    try {
      const data = await api.get('/reservations/my').catch(() => []);
      // /reservations/my returns { upcoming, past, total } — not an array.
      setReservations(Array.isArray(data) ? data : [...(data?.upcoming || []), ...(data?.past || [])]);
    } catch (e) { console.error(e); }
    setResLoading(false);
  };
  useEffect(() => { loadReservations(); }, []);
  useEffect(() => { if (tab === 'reservations') loadReservations(); }, [tab]);
  // Refresh reservations whenever the favorites screen comes back into focus
  // (e.g. after the partner confirms and the user taps the notification).
  useFocusEffect(
    useCallback(() => {
      loadReservations();
    }, [])
  );

  // Before load: what is saved; after load: what we can actually show.
  const agendaCount = loading
    ? ids.cityEvents.length + ids.partner_event.length
    : savedEvents.length + partnerEvents.length;
  const partnersCount = ids.partner.length;
  const reservationsCount = reservations.length;
  const total = agendaCount + partnersCount;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{tr('Mis Favoritos')}</Text>
          <Text style={styles.subtitle}>{total} {total === 1 ? tr('guardado') : tr('guardados')}</Text>
        </View>
        <Ionicons name="heart" size={24} color={COLORS.bougainvillea} />
      </View>

      {/* Segmented tabs — compact with distinct colors per category */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[
            styles.tab,
            tab === 'agenda' && [styles.tabActive, { backgroundColor: '#F97316' }],
          ]}
          onPress={() => setTab('agenda')}
          activeOpacity={0.85}
        >
          <Ionicons name="calendar" size={12} color={tab === 'agenda' ? COLORS.white : '#F97316'} />
          <Text style={[styles.tabText, tab === 'agenda' && styles.tabTextActive]} numberOfLines={1}>{tr('Agenda')}</Text>
          <View style={[styles.tabBadge, tab === 'agenda' && styles.tabBadgeActive]}>
            <Text style={[styles.tabBadgeText, tab === 'agenda' && styles.tabBadgeTextActive]}>{agendaCount}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tab,
            tab === 'partners' && [styles.tabActive, { backgroundColor: '#A855F7' }],
          ]}
          onPress={() => setTab('partners')}
          activeOpacity={0.85}
        >
          <Ionicons name="storefront" size={12} color={tab === 'partners' ? COLORS.white : '#A855F7'} />
          <Text style={[styles.tabText, tab === 'partners' && styles.tabTextActive]} numberOfLines={1}>{tr('Partners')}</Text>
          <View style={[styles.tabBadge, tab === 'partners' && styles.tabBadgeActive]}>
            <Text style={[styles.tabBadgeText, tab === 'partners' && styles.tabBadgeTextActive]}>{partnersCount}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          testID="favorites-tab-reservations"
          style={[
            styles.tab,
            tab === 'reservations' && [styles.tabActive, { backgroundColor: '#22C55E' }],
          ]}
          onPress={() => setTab('reservations')}
          activeOpacity={0.85}
        >
          <Ionicons name="bookmark" size={12} color={tab === 'reservations' ? COLORS.white : '#22C55E'} />
          <Text style={[styles.tabText, tab === 'reservations' && styles.tabTextActive]} numberOfLines={1}>{tr('Reservas')}</Text>
          <View style={[styles.tabBadge, tab === 'reservations' && styles.tabBadgeActive]}>
            <Text style={[styles.tabBadgeText, tab === 'reservations' && styles.tabBadgeTextActive]}>{reservationsCount}</Text>
          </View>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 60 }} />
        ) : tab === 'agenda' ? (
          agendaCount === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="calendar-outline" size={56} color={COLORS.textMuted} />
              <Text style={styles.emptyTitle}>{tr('Sin eventos guardados')}</Text>
              <Text style={styles.emptyDesc}>{tr('Toca el corazón ❤️ en eventos, conciertos y eventos de partners para guardarlos aquí.')}</Text>
              <TouchableOpacity style={styles.exploreCta} onPress={() => router.push('/que-pasa' as any)}>
                <Ionicons name="sparkles" size={16} color={COLORS.primary} />
                <Text style={styles.exploreText}>{tr('Explorar agenda')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {/* Partner Events */}
              {partnerEvents.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>📅 {tr('Publicado por los locales')} ({partnerEvents.length})</Text>
                  {partnerEvents.map(e => {
                    const tierColors = e.partner?.tier ? TIER_COLORS[e.partner.tier as Tier] : null;
                    return (
                      <TouchableOpacity
                        key={e.event_id}
                        style={styles.peCard}
                        onPress={() => router.push(`/partner-event/${e.event_id}` as any)}
                        activeOpacity={0.85}
                      >
                        <View style={styles.peFlyerWrap}>
                          <SafeImage uri={e.flyer_url} category={e.category} style={styles.peFlyer} />
                          <View style={styles.peFlyerOverlay} />
                          {tierColors && <View style={[styles.tierStripe, { backgroundColor: tierColors.main }]} />}
                        </View>
                        <View style={styles.peBody}>
                          <View style={styles.peTopRow}>
                            <View style={styles.timePill}>
                              <Ionicons name="time-outline" size={11} color={COLORS.primary} />
                              <Text style={styles.timePillText}>{e.start_time}</Text>
                            </View>
                            <View style={[styles.pricePill, e.is_free ? styles.priceFreeBg : styles.pricePaidBg]}>
                              <Text style={styles.pricePillText}>{eventPriceLabel(e.price, e.is_free)}</Text>
                            </View>
                          </View>
                          <Text style={styles.peTitle} numberOfLines={2}>{e.title}</Text>
                          <View style={styles.peFooter}>
                            <Text style={styles.peCat}>{tr(CAT_LABELS[e.category] || e.category)}</Text>
                            {e.partner?.tier && <TierBadge tier={e.partner.tier} size="xs" />}
                          </View>
                        </View>
                        <TouchableOpacity
                          style={styles.heartCorner}
                          onPress={() => toggleFavorite(e.event_id, 'partner_event')}
                          hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}
                        >
                          <Ionicons name="heart" size={16} color={COLORS.bougainvillea} />
                        </TouchableOpacity>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* Saved city events — verified feed, honest status for rows that left it */}
              {savedEvents.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>📅 {tr('Eventos guardados')} ({savedEvents.length})</Text>
                  {savedEvents.map(({ ev, itemType }) => {
                    const status = SAVED_STATUS[ev.status];
                    return (
                      <EventRow
                        key={ev.event_id}
                        ev={ev}
                        lang={lang}
                        tr={tr}
                        offline={eventsOffline}
                        statusLine={status ? tr(status) : null}
                        onPress={() => router.push(`/event/${ev.event_id}` as any)}
                        testID={`fav-event-${ev.event_id}`}
                        right={(
                          <TouchableOpacity
                            onPress={() => toggleFavorite(ev.event_id, itemType)}
                            hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}
                            style={{ alignSelf: 'center', padding: 4 }}
                            accessibilityRole="button"
                            accessibilityLabel={tr('Quitar de favoritos')}
                          >
                            <Ionicons name="heart" size={20} color={COLORS.bougainvillea} />
                          </TouchableOpacity>
                        )}
                      />
                    );
                  })}
                </View>
              )}
            </>
          )
        ) : tab === 'partners' ? (
          // Partners tab
          partnersCount === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="storefront-outline" size={56} color={COLORS.textMuted} />
              <Text style={styles.emptyTitle}>{tr('Sin lugares guardados')}</Text>
              <Text style={styles.emptyDesc}>{tr('Toca el corazón ❤️ en cualquier partner (restaurante, beach club, hotel...) para guardarlo aquí.')}</Text>
              <TouchableOpacity style={styles.exploreCta} onPress={() => router.push('/(tabs)/partners' as any)}>
                <Ionicons name="diamond" size={16} color={COLORS.primary} />
                <Text style={styles.exploreText}>{tr('Explorar partners')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📍 {tr('Lugares que amo')} ({partnersCount})</Text>
              {partners.map(p => {
                const tierColors = p.tier ? TIER_COLORS[p.tier as Tier] : null;
                return (
                  <TouchableOpacity
                    key={p.partner_id}
                    style={[styles.partnerCard, tierColors && { borderColor: tierColors.border }]}
                    onPress={() => router.push(`/partner/${p.partner_id}` as any)}
                    activeOpacity={0.85}
                  >
                    <SafeImage uri={p.image_url} category={p.category} style={styles.partnerImage} />
                    <View style={styles.partnerOverlay} />
                    {tierColors && <View style={[styles.tierStripe, { backgroundColor: tierColors.main }]} />}
                    <TouchableOpacity
                      style={styles.heartBtn}
                      onPress={() => toggleFavorite(p.partner_id, 'partner')}
                    >
                      <Ionicons name="heart" size={18} color={COLORS.bougainvillea} />
                    </TouchableOpacity>
                    <View style={styles.partnerContent}>
                      <View style={styles.partnerTopRow}>
                        <Text style={styles.partnerName} numberOfLines={1}>{p.name}</Text>
                        {p.tier && <TierBadge tier={p.tier} size="xs" />}
                      </View>
                      {p.address ? (
                        <View style={styles.cardMeta}>
                          <Ionicons name="location-outline" size={12} color="rgba(255,255,255,0.7)" />
                          <Text style={styles.cardMetaText} numberOfLines={1}>{p.address}</Text>
                        </View>
                      ) : null}
                      {p.category ? (
                        <Text style={styles.partnerCategory}>{(p.category || '').toUpperCase()}</Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )
        ) : (
          // Reservations tab
          resLoading ? (
            <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 60 }} />
          ) : reservationsCount === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="bookmark-outline" size={56} color={COLORS.textMuted} />
              <Text style={styles.emptyTitle}>{tr('Sin reservas todavía')}</Text>
              <Text style={styles.emptyDesc}>{tr('Cuando reserves una mesa o experiencia con un partner, aparecerá aquí con su estado en tiempo real.')}</Text>
              <TouchableOpacity style={styles.exploreCta} onPress={() => router.push('/(tabs)/partners' as any)}>
                <Ionicons name="sparkles" size={16} color={COLORS.primary} />
                <Text style={styles.exploreText}>{tr('Explorar partners')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📋 {tr('Tus reservas')} ({reservationsCount})</Text>
              {reservations.map(r => {
                const meta = RES_STATUS_META[r.status] || { label: r.status, color: COLORS.textMuted, bg: 'rgba(148,163,184,0.12)' };
                const isUpcoming = ['pending_partner_activation', 'pending_confirmation', 'confirmed'].includes(r.status);
                return (
                  <TouchableOpacity
                    key={r.reservation_id}
                    style={styles.resCard}
                    onPress={() => router.push('/reservations' as any)}
                    activeOpacity={0.85}
                  >
                    <View style={[styles.resStripe, { backgroundColor: meta.color }]} />
                    <View style={styles.resBody}>
                      <View style={styles.resTopRow}>
                        <Text style={styles.resPartnerName} numberOfLines={1}>{r.partner?.name || r.partner_name}</Text>
                        <View style={[styles.resStatusBadge, { backgroundColor: meta.bg }]}>
                          <View style={[styles.resStatusDot, { backgroundColor: meta.color }]} />
                          <Text style={[styles.resStatusText, { color: meta.color }]}>{tr(meta.label)}</Text>
                        </View>
                      </View>
                      {r.event?.title ? (
                        <Text style={styles.resEvent} numberOfLines={1}>🎉 {r.event.title}</Text>
                      ) : null}
                      <View style={styles.resMetaRow}>
                        <View style={styles.resMetaItem}>
                          <Ionicons name="calendar-outline" size={12} color={COLORS.textMuted} />
                          <Text style={styles.resMetaText}>{r.date}{r.time ? ` · ${r.time}` : ''}</Text>
                        </View>
                        <View style={styles.resMetaItem}>
                          <Ionicons name="people-outline" size={12} color={COLORS.textMuted} />
                          <Text style={styles.resMetaText}>{r.party_size} {r.party_size === 1 ? tr('persona') : tr('personas')}</Text>
                        </View>
                        {isUpcoming && <View style={styles.resUpcomingDot} />}
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} style={{ alignSelf: 'center', marginRight: SPACING.sm }} />
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={styles.viewAllResBtn}
                onPress={() => router.push('/reservations' as any)}
                activeOpacity={0.85}
              >
                <Ionicons name="open-outline" size={14} color={COLORS.primary} />
                <Text style={styles.viewAllResText}>{tr('Ver detalle completo y gestionar')}</Text>
              </TouchableOpacity>
            </View>
          )
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold },
  subtitle: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },

  // Tabs — compact
  tabBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.full,
    padding: 3,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.xs,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 2,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 7,
    paddingHorizontal: 4,
    borderRadius: RADIUS.full,
  },
  tabActive: { backgroundColor: COLORS.primary },
  tabText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 0.2 },
  tabTextActive: { color: COLORS.white, ...FONTS.bold },
  tabBadge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 5,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeActive: { backgroundColor: 'rgba(255,255,255,0.3)' },
  tabBadgeText: { fontSize: 9, color: COLORS.textMuted, ...FONTS.bold },
  tabBadgeTextActive: { color: COLORS.white },

  emptyState: { alignItems: 'center', paddingTop: 60, paddingHorizontal: SPACING.xl, gap: SPACING.sm },
  emptyTitle: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold, marginTop: SPACING.xs },
  emptyDesc: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', lineHeight: 20 },
  exploreCta: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, paddingHorizontal: 18, paddingVertical: 10, borderRadius: RADIUS.full, backgroundColor: `${COLORS.primary}15`, borderWidth: 1, borderColor: `${COLORS.primary}30`, marginTop: SPACING.md },
  exploreText: { fontSize: 13, color: COLORS.primary, ...FONTS.semibold },

  section: { paddingHorizontal: SPACING.lg, marginTop: SPACING.sm },
  sectionTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold, marginBottom: SPACING.sm },

  // Partner event card
  peCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    overflow: 'hidden',
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    position: 'relative',
  },
  peFlyerWrap: { width: 100, height: 120, position: 'relative' },
  peFlyer: { width: '100%', height: '100%' },
  peFlyerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.18)' },
  tierStripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  peBody: { flex: 1, padding: SPACING.sm, justifyContent: 'space-between', paddingRight: 32 },
  peTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  timePill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(18,181,165,0.15)', borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2 },
  timePillText: { fontSize: 10, color: COLORS.primary, ...FONTS.bold },
  pricePill: { borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2 },
  priceFreeBg: { backgroundColor: COLORS.success },
  pricePaidBg: { backgroundColor: 'rgba(5,8,20,0.6)', borderWidth: 1, borderColor: COLORS.primary },
  pricePillText: { fontSize: 9, color: COLORS.white, ...FONTS.bold, letterSpacing: 0.4 },
  peTitle: { fontSize: 13, color: COLORS.textMain, ...FONTS.bold, lineHeight: 17, marginTop: 4 },
  peFooter: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  peCat: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium, textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 },
  heartCorner: { position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },

  // Concert card (kept similar)
  card: { borderRadius: RADIUS.xl, overflow: 'hidden', marginBottom: SPACING.md, height: 150, position: 'relative' },
  cardImage: { width: '100%', height: '100%' },
  cardOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
  heartBtn: { position: 'absolute', top: 10, right: 10, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  cardContent: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: SPACING.md },
  cardGenre: { fontSize: 10, color: COLORS.primary, ...FONTS.bold, letterSpacing: 1, textTransform: 'uppercase' },
  cardTitle: { fontSize: 18, color: '#FFF', ...FONTS.bold },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  cardMetaText: { fontSize: 11, color: 'rgba(255,255,255,0.7)', ...FONTS.medium, flexShrink: 1 },
  cardPrice: { fontSize: 12, color: COLORS.primary, ...FONTS.bold, marginTop: 2 },

  // Festival event row
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  eventTime: { width: 50, alignItems: 'center' },
  eventHour: { fontSize: 14, color: COLORS.primary, ...FONTS.bold },
  eventInfo: { flex: 1 },
  eventTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  eventVenue: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },

  // Partner card
  partnerCard: {
    borderRadius: RADIUS.xl,
    overflow: 'hidden',
    marginBottom: SPACING.md,
    height: 150,
    position: 'relative',
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  partnerImage: { width: '100%', height: '100%' },
  partnerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
  partnerContent: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: SPACING.md },
  partnerTopRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  partnerName: { fontSize: 18, color: '#FFF', ...FONTS.bold, flex: 1 },
  partnerCategory: { fontSize: 10, color: COLORS.primary, ...FONTS.bold, letterSpacing: 1, marginTop: 4 },

  // Reservation card (tab 3)
  resCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.sm,
    overflow: 'hidden',
  },
  resStripe: { width: 4, alignSelf: 'stretch' },
  resBody: { flex: 1, padding: SPACING.md, gap: 4 },
  resTopRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  resPartnerName: { flex: 1, fontSize: 15, color: COLORS.textMain, ...FONTS.bold },
  resStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
  },
  resStatusDot: { width: 6, height: 6, borderRadius: 3 },
  resStatusText: { fontSize: 10, ...FONTS.bold, letterSpacing: 0.3 },
  resEvent: { fontSize: 12, color: COLORS.primary, ...FONTS.semibold, marginTop: 2 },
  resMetaRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginTop: 4 },
  resMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  resMetaText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
  resUpcomingDot: {
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: COLORS.success,
    marginLeft: 'auto',
  },
  viewAllResBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: RADIUS.full,
    backgroundColor: `${COLORS.primary}15`,
    borderWidth: 1,
    borderColor: `${COLORS.primary}30`,
    marginTop: SPACING.xs,
  },
  viewAllResText: { fontSize: 12, color: COLORS.primary, ...FONTS.bold },
});
