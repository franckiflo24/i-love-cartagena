import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, RefreshControl, Dimensions, FlatList, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS, EVENT_TYPE_LABELS, TIER_COLORS, Tier } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useAuth } from '../../src/context/AuthContext';
import { useFavorites } from '../../src/context/FavoritesContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HERO_WIDTH = SCREEN_WIDTH - SPACING.lg * 2;

type Season = {
  season_id: string; name: string; subtitle: string; description: string;
  start_date: string; end_date: string; image_url: string; color: string;
  tags: string[]; is_active: boolean; event_count: number;
};

type Event = {
  event_id: string; title: string; description: string; date: string;
  start_time: string; end_time: string; venue_name: string; type: string;
  is_free: boolean; price: number; image_url: string; featured?: boolean;
};

const formatDateRange = (start: string, end: string) => {
  const months = ['', 'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const sMonth = months[s.getMonth() + 1];
  const eMonth = months[e.getMonth() + 1];
  if (sMonth === eMonth) {
    return `${s.getDate()} - ${e.getDate()} ${sMonth} ${s.getFullYear()}`;
  }
  return `${s.getDate()} ${sMonth} - ${e.getDate()} ${eMonth}`;
};

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { favorites } = useFavorites();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [featured, setFeatured] = useState<Event[]>([]);
  const [todayEvents, setTodayEvents] = useState<Event[]>([]);
  const [sponsors, setSponsors] = useState<any[]>([]);
  const [activeSponsor, setActiveSponsor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeSeasonIdx, setActiveSeasonIdx] = useState(0);
  const [favItems, setFavItems] = useState<any[]>([]);
  const flatListRef = useRef<FlatList>(null);

  const fetchData = async () => {
    try {
      const [s, f, sp] = await Promise.all([
        api.get('/seasons?active=true'),
        api.get('/events/featured'),
        api.get('/sponsors').catch(() => []),
      ]);
      setSeasons(s);
      setFeatured(f);
      setSponsors(sp);
      const firstDate = s.length > 0 ? s[0].start_date : '2025-12-30';
      const t = await api.get(`/events?date=${firstDate}`);
      setTodayEvents(t);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Hydrate favorites with their actual data (partners + partner-events)
  const fetchFavorites = async () => {
    if (!favorites || favorites.length === 0) { setFavItems([]); return; }
    try {
      const results: any[] = [];
      // Group by type for batch fetch
      const partnerIds = favorites.filter(f => f.item_type === 'partner').map(f => f.item_id);
      const peIds = favorites.filter(f => f.item_type === 'partner_event').map(f => f.item_id);
      // Partners: fetch all then filter (avoids N requests)
      if (partnerIds.length > 0) {
        try {
          const allPartners = await api.get('/partners');
          for (const p of allPartners) {
            if (partnerIds.includes(p.partner_id)) {
              results.push({ kind: 'partner', id: p.partner_id, title: p.name, image: p.image_url, subtitle: (p.category || '').toUpperCase(), tier: p.tier });
            }
          }
        } catch {}
      }
      // Partner-events: fetch one by one (small numbers)
      for (const id of peIds) {
        try {
          const ev = await api.get(`/partner-events/${id}`);
          results.push({ kind: 'partner_event', id, title: ev.title, image: ev.flyer_url, subtitle: `${ev.date} · ${ev.start_time}`, tier: ev.partner?.tier || ev.partner_tier });
        } catch {}
      }
      setFavItems(results);
    } catch (e) { console.error('favs hydrate', e); }
  };

  useEffect(() => { fetchData(); }, []);
  useEffect(() => { fetchFavorites(); /* eslint-disable-next-line */ }, [favorites]);

  // Sponsor rotation every 5 seconds
  useEffect(() => {
    if (sponsors.length <= 1) return;
    const timer = setInterval(() => {
      setActiveSponsor(prev => (prev + 1) % sponsors.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [sponsors.length]);

  const trackEvent = async (eventType: string, targetId?: string, targetType?: string) => {
    try {
      await api.post('/analytics/track', { event_type: eventType, target_id: targetId, target_type: targetType });
    } catch {}
  };

  const formatPrice = (price: number) => {
    if (price === 0) return 'Gratis';
    return `$${(price / 1000).toFixed(0)}K COP`;
  };

  const onSeasonScroll = (e: any) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / (HERO_WIDTH + SPACING.md));
    if (idx !== activeSeasonIdx && idx >= 0 && idx < seasons.length) {
      setActiveSeasonIdx(idx);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={COLORS.primary} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  const renderSeasonCard = ({ item, index }: { item: Season; index: number }) => (
    <TouchableOpacity
      testID={`season-${item.season_id}`}
      style={[styles.heroCard, { width: HERO_WIDTH }]}
      activeOpacity={0.9}
      onPress={() => {
        trackEvent('season_click', item.season_id, 'season');
        if (item.event_count > 0) router.push('/(tabs)/agenda');
      }}
    >
      <Image source={{ uri: item.image_url }} style={styles.heroImage} />
      <View style={styles.heroOverlay} />
      <View style={styles.heroContent}>
        <Text style={[styles.heroLabel, { color: item.color }]}>{formatDateRange(item.start_date, item.end_date)}</Text>
        <Text style={styles.heroTitle}>{item.name}</Text>
        <Text style={styles.heroSub}>{item.tags.join(' · ')}</Text>
        {item.event_count === 0 && (
          <View style={[styles.comingSoonBadge, { backgroundColor: item.color }]}>
            <Text style={styles.comingSoonText}>PRÓXIMAMENTE</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={COLORS.primary} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>{user ? `Hola, ${user.name.split(' ')[0]}` : 'Bienvenido'}</Text>
            <Text style={styles.headerTitle}>Amo Cartagena ❤️</Text>
          </View>
          <TouchableOpacity testID="notifications-btn" onPress={() => router.push('/notifications')} style={styles.notifBtn}>
            <Ionicons name="notifications-outline" size={24} color={COLORS.textMain} />
          </TouchableOpacity>
        </View>

        {/* Search Bar */}
        <TouchableOpacity style={styles.searchBar} onPress={() => router.push('/search')} activeOpacity={0.8}>
          <Ionicons name="search" size={18} color={COLORS.textMuted} />
          <Text style={styles.searchPlaceholder}>Buscar artistas, venues, eventos...</Text>
        </TouchableOpacity>

        {/* Sponsor Banner */}
        {sponsors.length > 0 && (
          <TouchableOpacity
            style={styles.sponsorBanner}
            onPress={() => sponsors[activeSponsor]?.url ? Linking.openURL(sponsors[activeSponsor].url) : null}
            activeOpacity={0.9}
          >
            <View style={styles.sponsorContent}>
              {sponsors[activeSponsor]?.logo_url ? (
                <Image source={{ uri: sponsors[activeSponsor].logo_url }} style={styles.sponsorLogo} resizeMode="contain" />
              ) : (
                <View style={[styles.sponsorIconCircle, { backgroundColor: `${sponsors[activeSponsor]?.color || COLORS.primary}20` }]}>
                  <Ionicons name="business" size={18} color={sponsors[activeSponsor]?.color || COLORS.primary} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.sponsorName}>{sponsors[activeSponsor]?.name}</Text>
                <Text style={styles.sponsorTagline}>{sponsors[activeSponsor]?.tagline}</Text>
              </View>
              <View style={[styles.sponsorTierBadge, { backgroundColor: `${sponsors[activeSponsor]?.color || COLORS.primary}20` }]}>
                <Text style={[styles.sponsorTierText, { color: sponsors[activeSponsor]?.color || COLORS.primary }]}>
                  {sponsors[activeSponsor]?.tier === 'gold' ? 'GOLD' : sponsors[activeSponsor]?.tier === 'institutional' ? 'OFICIAL' : 'PARTNER'}
                </Text>
              </View>
            </View>
            {/* Progress dots */}
            <View style={styles.sponsorDots}>
              {sponsors.map((_, i) => (
                <View key={i} style={[styles.sponsorDot, i === activeSponsor && { backgroundColor: sponsors[activeSponsor]?.color || COLORS.primary, width: 20, borderRadius: 5 }]} />
              ))}
            </View>
          </TouchableOpacity>
        )}

        {/* Season Carousel */}
        <FlatList
          ref={flatListRef}
          data={seasons}
          renderItem={renderSeasonCard}
          keyExtractor={(item) => item.season_id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          snapToInterval={HERO_WIDTH + SPACING.md}
          decelerationRate="fast"
          contentContainerStyle={{ paddingHorizontal: SPACING.lg, gap: SPACING.md }}
          onScroll={onSeasonScroll}
          scrollEventThrottle={16}
        />

        {/* Pagination Dots */}
        {seasons.length > 1 && (
          <View style={styles.dotsContainer}>
            {seasons.map((s, i) => (
              <View
                key={s.season_id}
                style={[styles.dot, i === activeSeasonIdx ? [styles.dotActive, { backgroundColor: s.color }] : null]}
              />
            ))}
          </View>
        )}

        {/* Quick Access */}
        <View style={styles.quickAccess}>
          {[
            { icon: 'calendar', label: 'Agenda', route: '/(tabs)/agenda' },
            { icon: 'musical-notes', label: 'Conciertos', route: '/concerts' },
            { icon: 'heart', label: 'Mi Agenda', route: '/favorites' },
            { icon: 'boat', label: 'Transporte', route: '/transport' },
            { icon: 'trail-sign', label: 'Rutas', route: '/itineraries' },
          ].map((item) => (
            <TouchableOpacity
              key={item.label}
              testID={`quick-${item.label.toLowerCase()}`}
              style={styles.quickItem}
              onPress={() => {
                trackEvent('quick_access', item.label, 'navigation');
                router.push(item.route as any);
              }}
            >
              <View style={styles.quickIcon}>
                <Ionicons name={item.icon as any} size={22} color={COLORS.primary} />
              </View>
              <Text style={styles.quickLabel}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* My Favorites */}
        {favItems.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="heart" size={18} color="#EF4444" />
                <Text style={styles.sectionTitle}>Mis favoritos</Text>
                <View style={styles.favCountBubble}><Text style={styles.favCountText}>{favItems.length}</Text></View>
              </View>
              <TouchableOpacity onPress={() => router.push('/favorites')}>
                <Text style={styles.seeAll}>Ver todos</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
              {favItems.map((item) => {
                const tier = item.tier ? TIER_COLORS[item.tier as Tier] : null;
                return (
                  <TouchableOpacity
                    key={`${item.kind}-${item.id}`}
                    style={[styles.favCard, tier && { borderColor: tier.border }]}
                    onPress={() => router.push(item.kind === 'partner' ? `/partner/${item.id}` : `/partner-event/${item.id}`)}
                    activeOpacity={0.85}
                  >
                    <Image source={{ uri: item.image }} style={styles.favImage} />
                    <View style={styles.favOverlay} />
                    <View style={styles.favHeartBadge}>
                      <Ionicons name="heart" size={11} color="#EF4444" />
                    </View>
                    {tier && <View style={[styles.favTierStripe, { backgroundColor: tier.main }]} />}
                    <View style={styles.favInfo}>
                      <Text style={styles.favSubtitle} numberOfLines={1}>{item.subtitle}</Text>
                      <Text style={styles.favTitle} numberOfLines={2}>{item.title}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Featured Events */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Eventos destacados</Text>
            <TouchableOpacity testID="see-all-events" onPress={() => router.push('/(tabs)/agenda')}>
              <Text style={styles.seeAll}>Ver todos</Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
            {featured.map((event) => (
              <TouchableOpacity
                key={event.event_id}
                testID={`featured-${event.event_id}`}
                style={styles.featuredCard}
                onPress={() => {
                  trackEvent('event_click', event.event_id, 'event');
                  router.push(`/event/${event.event_id}`);
                }}
                activeOpacity={0.8}
              >
                <Image source={{ uri: event.image_url }} style={styles.featuredImage} />
                <View style={styles.featuredOverlay} />
                <View style={styles.featuredBadge}>
                  <Text style={styles.badgeText}>{event.is_free ? 'GRATIS' : formatPrice(event.price)}</Text>
                </View>
                <View style={styles.featuredInfo}>
                  <Text style={styles.featuredType}>{EVENT_TYPE_LABELS[event.type] || event.type}</Text>
                  <Text style={styles.featuredTitle} numberOfLines={2}>{event.title}</Text>
                  <View style={styles.featuredMeta}>
                    <Ionicons name="time-outline" size={12} color={COLORS.textMuted} />
                    <Text style={styles.metaText}>{event.start_time} - {event.end_time}</Text>
                    <Ionicons name="location-outline" size={12} color={COLORS.textMuted} />
                    <Text style={styles.metaText}>{event.venue_name}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Today's Events */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Programa · {seasons.length > 0 ? (() => { const d = new Date(seasons[0].start_date + 'T00:00:00'); const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']; return `${d.getDate()} ${meses[d.getMonth()]}`; })() : '30 Dic'}</Text>
          </View>
          {todayEvents.slice(0, 4).map((event) => (
            <TouchableOpacity
              key={event.event_id}
              testID={`today-${event.event_id}`}
              style={styles.eventRow}
              onPress={() => {
                trackEvent('event_click', event.event_id, 'event');
                router.push(`/event/${event.event_id}`);
              }}
              activeOpacity={0.7}
            >
              <View style={styles.eventTime}>
                <Text style={styles.timeText}>{event.start_time}</Text>
              </View>
              <Image source={{ uri: event.image_url }} style={styles.eventThumb} />
              <View style={styles.eventInfo}>
                <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
                <Text style={styles.eventVenue}>{event.venue_name}</Text>
                <View style={styles.eventTags}>
                  <View style={[styles.tag, event.is_free ? styles.tagFree : styles.tagPaid]}>
                    <Text style={styles.tagText}>{event.is_free ? 'Gratis' : formatPrice(event.price)}</Text>
                  </View>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          ))}
        </View>

        {/* Partners Preview */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Partners oficiales</Text>
            <TouchableOpacity testID="see-all-partners" onPress={() => router.push('/(tabs)/partners')}>
              <Text style={styles.seeAll}>Ver todos</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            testID="partners-cta"
            style={styles.partnersCta}
            onPress={() => {
              trackEvent('partner_section_click', undefined, 'navigation');
              router.push('/(tabs)/partners');
            }}
            activeOpacity={0.8}
          >
            <Image source={{ uri: 'https://static.prod-images.emergentagent.com/jobs/32dad071-4fb0-440b-90c6-bb16ae39bea1/images/4f979e7ba4b32872c4b07dadcb054eb78f999948cb9373a70a78567dea9e65ab.png' }} style={styles.partnersCtaImage} />
            <View style={styles.partnersCtaOverlay} />
            <View style={styles.partnersCtaContent}>
              <Ionicons name="diamond" size={28} color={COLORS.primary} />
              <Text style={styles.partnersCtaTitle}>Lugares certificados</Text>
              <Text style={styles.partnersCtaDesc}>Restaurantes, clubs, hoteles y más validados por Amo Cartagena</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  greeting: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular },
  headerTitle: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold, marginTop: 2 },
  notifBtn: { width: 44, height: 44, borderRadius: RADIUS.full, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginHorizontal: SPACING.lg, marginBottom: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, paddingHorizontal: SPACING.md, paddingVertical: 12, borderWidth: 1, borderColor: COLORS.border },
  searchPlaceholder: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular },

  // Sponsor Banner
  sponsorBanner: { marginHorizontal: SPACING.lg, marginBottom: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  sponsorContent: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  sponsorLogo: { width: 56, height: 56, borderRadius: RADIUS.lg },
  sponsorIconCircle: { width: 56, height: 56, borderRadius: RADIUS.lg, alignItems: 'center', justifyContent: 'center' },
  sponsorName: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold },
  sponsorTagline: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },
  sponsorTierBadge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: RADIUS.full },
  sponsorTierText: { fontSize: 11, ...FONTS.bold, letterSpacing: 0.5 },
  sponsorDots: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: SPACING.sm },
  sponsorDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.border },
  heroCard: { borderRadius: RADIUS.xl, overflow: 'hidden', height: 220 },
  heroImage: { width: '100%', height: '100%', position: 'absolute' },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,8,20,0.5)' },
  heroContent: { flex: 1, justifyContent: 'flex-end', padding: SPACING.lg },
  heroLabel: { fontSize: 11, letterSpacing: 3, ...FONTS.semibold },
  heroTitle: { fontSize: 28, color: COLORS.textMain, ...FONTS.bold, marginTop: SPACING.xs, lineHeight: 34 },
  heroSub: { fontSize: 13, color: COLORS.textMuted, marginTop: SPACING.sm, ...FONTS.regular },
  comingSoonBadge: { alignSelf: 'flex-start', borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 4, marginTop: SPACING.sm },
  comingSoonText: { fontSize: 10, color: COLORS.white, ...FONTS.bold, letterSpacing: 2 },
  dotsContainer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, paddingVertical: SPACING.md },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.2)' },
  dotActive: { width: 24, height: 8, borderRadius: 4 },
  quickAccess: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: SPACING.lg, marginBottom: SPACING.lg },
  quickItem: { alignItems: 'center', gap: SPACING.sm },
  quickIcon: { width: 52, height: 52, borderRadius: RADIUS.lg, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  quickLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
  section: { marginBottom: SPACING.lg },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.lg, marginBottom: SPACING.md },
  sectionTitle: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold },
  seeAll: { fontSize: 13, color: COLORS.primary, ...FONTS.semibold },
  horizontalList: { paddingLeft: SPACING.lg, gap: SPACING.md, paddingRight: SPACING.lg },

  // Favorites carousel
  favCountBubble: { backgroundColor: '#EF4444', minWidth: 22, paddingHorizontal: 6, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  favCountText: { color: COLORS.white, fontSize: 11, ...FONTS.bold },
  favCard: { width: 160, height: 200, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1.5, borderColor: COLORS.border, position: 'relative' },
  favImage: { position: 'absolute', width: '100%', height: '100%' },
  favOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,8,20,0.55)' },
  favHeartBadge: { position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.95)', alignItems: 'center', justifyContent: 'center' },
  favTierStripe: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  favInfo: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: SPACING.sm },
  favSubtitle: { fontSize: 9, color: COLORS.primary, ...FONTS.bold, letterSpacing: 0.8 },
  favTitle: { fontSize: 13, color: COLORS.white, ...FONTS.bold, marginTop: 4, lineHeight: 17 },
  featuredCard: { width: 260, height: 200, borderRadius: RADIUS.xl, overflow: 'hidden' },
  featuredImage: { width: '100%', height: '100%', position: 'absolute' },
  featuredOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  featuredBadge: { position: 'absolute', top: SPACING.md, right: SPACING.md, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 11, color: COLORS.white, ...FONTS.bold },
  featuredInfo: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: SPACING.md },
  featuredType: { fontSize: 10, color: COLORS.primary, ...FONTS.bold, letterSpacing: 2, textTransform: 'uppercase' },
  featuredTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold, marginTop: 2 },
  featuredMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: SPACING.xs },
  metaText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  eventRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, gap: SPACING.md },
  eventTime: { width: 48, alignItems: 'center' },
  timeText: { fontSize: 14, color: COLORS.primary, ...FONTS.bold },
  eventThumb: { width: 52, height: 52, borderRadius: RADIUS.md, backgroundColor: COLORS.surface },
  eventInfo: { flex: 1 },
  eventTitle: { fontSize: 15, color: COLORS.textMain, ...FONTS.semibold },
  eventVenue: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },
  eventTags: { flexDirection: 'row', marginTop: 4, gap: SPACING.xs },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.full },
  tagFree: { backgroundColor: 'rgba(34, 197, 94, 0.15)' },
  tagPaid: { backgroundColor: 'rgba(217, 119, 6, 0.15)' },
  tagText: { fontSize: 10, ...FONTS.bold },
  partnersCta: { marginHorizontal: SPACING.lg, borderRadius: RADIUS.xl, overflow: 'hidden', height: 130 },
  partnersCtaImage: { width: '100%', height: '100%', position: 'absolute' },
  partnersCtaOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,8,20,0.85)' },
  partnersCtaContent: { flex: 1, justifyContent: 'center', padding: SPACING.lg, gap: SPACING.xs },
  partnersCtaTitle: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold },
  partnersCtaDesc: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular },
});
