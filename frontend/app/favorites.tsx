import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS, TIER_COLORS, Tier } from '../src/constants/theme';
import { useFavorites } from '../src/context/FavoritesContext';
import { api } from '../src/constants/api';
import { TierBadge } from '../src/components/TierBadge';

type Tab = 'agenda' | 'partners';

const CAT_LABELS: Record<string, string> = {
  gastronomy: 'Gastronomía',
  music: 'Música',
  party: 'Fiesta',
  wellness: 'Wellness',
  art: 'Arte & Cultura',
  popup: 'Pop-up',
};

export default function FavoritesScreen() {
  const router = useRouter();
  const { favorites, toggleFavorite } = useFavorites();
  const [tab, setTab] = useState<Tab>('agenda');

  // Hydrated lists
  const [events, setEvents] = useState<any[]>([]);
  const [concerts, setConcerts] = useState<any[]>([]);
  const [partnerEvents, setPartnerEvents] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Group favorite IDs by type
  const ids = useMemo(() => ({
    event: new Set(favorites.filter(f => f.item_type === 'event').map(f => f.item_id)),
    partner_event: favorites.filter(f => f.item_type === 'partner_event').map(f => f.item_id),
    concert: new Set(favorites.filter(f => f.item_type === 'concert').map(f => f.item_id)),
    partner: favorites.filter(f => f.item_type === 'partner').map(f => f.item_id),
  }), [favorites]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const tasks: Promise<any>[] = [];
        if (ids.event.size > 0 || ids.concert.size > 0) {
          tasks.push(api.get('/events').catch(() => []));
          tasks.push(api.get('/concerts').catch(() => []));
        } else {
          tasks.push(Promise.resolve([]));
          tasks.push(Promise.resolve([]));
        }
        // Partner events: fetch by id
        const peTask = Promise.all(
          ids.partner_event.map(id => api.get(`/partner-events/${id}`).catch(() => null))
        );
        // Partners: fetch by id
        const pTask = Promise.all(
          ids.partner.map(id => api.get(`/partners/${id}`).catch(() => null))
        );

        const [allEvents, allConcerts, peList, pList] = await Promise.all([
          ...tasks,
          peTask,
          pTask,
        ]);

        if (cancelled) return;
        setEvents((allEvents || []).filter((e: any) => ids.event.has(e.event_id)));
        setConcerts((allConcerts || []).filter((c: any) => ids.concert.has(c.concert_id)));
        setPartnerEvents((peList || []).filter(Boolean));
        setPartners((pList || []).filter(Boolean));
      } catch (e) { console.error(e); }
      if (!cancelled) setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [ids]);

  const agendaCount = ids.event.size + ids.concert.size + ids.partner_event.length;
  const partnersCount = ids.partner.length;
  const total = agendaCount + partnersCount;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Mis Favoritos</Text>
          <Text style={styles.subtitle}>{total} {total === 1 ? 'guardado' : 'guardados'}</Text>
        </View>
        <Ionicons name="heart" size={24} color="#EF4444" />
      </View>

      {/* Segmented tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, tab === 'agenda' && styles.tabActive]}
          onPress={() => setTab('agenda')}
          activeOpacity={0.85}
        >
          <Ionicons name="calendar" size={14} color={tab === 'agenda' ? COLORS.white : COLORS.textMuted} />
          <Text style={[styles.tabText, tab === 'agenda' && styles.tabTextActive]}>Agenda</Text>
          <View style={[styles.tabBadge, tab === 'agenda' && styles.tabBadgeActive]}>
            <Text style={[styles.tabBadgeText, tab === 'agenda' && styles.tabBadgeTextActive]}>{agendaCount}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'partners' && styles.tabActive]}
          onPress={() => setTab('partners')}
          activeOpacity={0.85}
        >
          <Ionicons name="storefront" size={14} color={tab === 'partners' ? COLORS.white : COLORS.textMuted} />
          <Text style={[styles.tabText, tab === 'partners' && styles.tabTextActive]}>Partners</Text>
          <View style={[styles.tabBadge, tab === 'partners' && styles.tabBadgeActive]}>
            <Text style={[styles.tabBadgeText, tab === 'partners' && styles.tabBadgeTextActive]}>{partnersCount}</Text>
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
              <Text style={styles.emptyTitle}>Sin eventos guardados</Text>
              <Text style={styles.emptyDesc}>Toca el corazón ❤️ en eventos, conciertos y eventos de partners para guardarlos aquí.</Text>
              <TouchableOpacity style={styles.exploreCta} onPress={() => router.push('/(tabs)/agenda' as any)}>
                <Ionicons name="sparkles" size={16} color={COLORS.primary} />
                <Text style={styles.exploreText}>Explorar agenda</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {/* Partner Events */}
              {partnerEvents.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>📅 Eventos de partners ({partnerEvents.length})</Text>
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
                          <Image source={{ uri: e.flyer_url }} style={styles.peFlyer} />
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
                              <Text style={styles.pricePillText}>{e.is_free ? 'GRATIS' : `$${(e.price / 1000).toFixed(0)}K`}</Text>
                            </View>
                          </View>
                          <Text style={styles.peTitle} numberOfLines={2}>{e.title}</Text>
                          <View style={styles.peFooter}>
                            <Text style={styles.peCat}>{CAT_LABELS[e.category] || e.category}</Text>
                            {e.partner?.tier && <TierBadge tier={e.partner.tier} size="xs" />}
                          </View>
                        </View>
                        <TouchableOpacity
                          style={styles.heartCorner}
                          onPress={() => toggleFavorite(e.event_id, 'partner_event')}
                          hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}
                        >
                          <Ionicons name="heart" size={16} color="#EF4444" />
                        </TouchableOpacity>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* Concerts */}
              {concerts.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>🎵 Conciertos ({concerts.length})</Text>
                  {concerts.map(c => (
                    <TouchableOpacity key={c.concert_id} style={styles.card} onPress={() => router.push('/concerts' as any)} activeOpacity={0.85}>
                      <Image source={{ uri: c.image_url }} style={styles.cardImage} />
                      <View style={styles.cardOverlay} />
                      <TouchableOpacity
                        style={styles.heartBtn}
                        onPress={() => toggleFavorite(c.concert_id, 'concert')}
                      >
                        <Ionicons name="heart" size={18} color="#EF4444" />
                      </TouchableOpacity>
                      <View style={styles.cardContent}>
                        <Text style={styles.cardGenre}>{c.genre}</Text>
                        <Text style={styles.cardTitle}>{c.artist}</Text>
                        <View style={styles.cardMeta}>
                          <Ionicons name="location-outline" size={12} color="rgba(255,255,255,0.7)" />
                          <Text style={styles.cardMetaText}>{c.venue_name}</Text>
                          <Ionicons name="time-outline" size={12} color="rgba(255,255,255,0.7)" />
                          <Text style={styles.cardMetaText}>{c.start_time}</Text>
                        </View>
                        <Text style={styles.cardPrice}>{c.is_free ? 'GRATIS' : `$${(c.price / 1000).toFixed(0)}K COP`}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Festival Events */}
              {events.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>🎶 Music Week ({events.length})</Text>
                  {events.map(e => (
                    <TouchableOpacity key={e.event_id} style={styles.eventRow} onPress={() => router.push(`/event/${e.event_id}` as any)}>
                      <View style={styles.eventTime}>
                        <Text style={styles.eventHour}>{e.start_time}</Text>
                      </View>
                      <View style={styles.eventInfo}>
                        <Text style={styles.eventTitle} numberOfLines={1}>{e.title}</Text>
                        <Text style={styles.eventVenue} numberOfLines={1}>{e.venue_name} · {e.type}</Text>
                      </View>
                      <TouchableOpacity onPress={() => toggleFavorite(e.event_id, 'event')} hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}>
                        <Ionicons name="heart" size={20} color="#EF4444" />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          )
        ) : (
          // Partners tab
          partnersCount === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="storefront-outline" size={56} color={COLORS.textMuted} />
              <Text style={styles.emptyTitle}>Sin lugares guardados</Text>
              <Text style={styles.emptyDesc}>Toca el corazón ❤️ en cualquier partner (restaurante, beach club, hotel...) para guardarlo aquí.</Text>
              <TouchableOpacity style={styles.exploreCta} onPress={() => router.push('/(tabs)/partners' as any)}>
                <Ionicons name="diamond" size={16} color={COLORS.primary} />
                <Text style={styles.exploreText}>Explorar partners</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📍 Lugares que amo ({partnersCount})</Text>
              {partners.map(p => {
                const tierColors = p.tier ? TIER_COLORS[p.tier as Tier] : null;
                return (
                  <TouchableOpacity
                    key={p.partner_id}
                    style={[styles.partnerCard, tierColors && { borderColor: tierColors.border }]}
                    onPress={() => router.push(`/partner/${p.partner_id}` as any)}
                    activeOpacity={0.85}
                  >
                    <Image source={{ uri: p.image_url }} style={styles.partnerImage} />
                    <View style={styles.partnerOverlay} />
                    {tierColors && <View style={[styles.tierStripe, { backgroundColor: tierColors.main }]} />}
                    <TouchableOpacity
                      style={styles.heartBtn}
                      onPress={() => toggleFavorite(p.partner_id, 'partner')}
                    >
                      <Ionicons name="heart" size={18} color="#EF4444" />
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

  // Tabs
  tabBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.full,
    padding: 4,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.xs,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: RADIUS.full,
  },
  tabActive: { backgroundColor: COLORS.primary },
  tabText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.semibold },
  tabTextActive: { color: COLORS.white, ...FONTS.bold },
  tabBadge: {
    minWidth: 20,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  tabBadgeText: { fontSize: 10, color: COLORS.textMuted, ...FONTS.bold },
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
  timePill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(217,119,6,0.15)', borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2 },
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
});
