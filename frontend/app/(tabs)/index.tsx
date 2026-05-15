import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, RefreshControl, Dimensions, FlatList, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS, EVENT_TYPE_LABELS, TIER_COLORS, Tier } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useAuth } from '../../src/context/AuthContext';
import { useFavorites } from '../../src/context/FavoritesContext';
import { useLang } from '../../src/context/LanguageContext';

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

type PEvent = {
  event_id: string; partner_id: string; title: string; category: string;
  date: string; start_time: string; end_time: string; flyer_url: string;
  is_free: boolean; price: number; partner_name?: string; partner_tier?: string;
  partner_image?: string;
};

const CAT_COLORS: Record<string, { main: string; bg: string; label: string }> = {
  gastronomy: { main: '#F97316', bg: 'rgba(249,115,22,0.15)', label: 'Gastronomía' },
  music:      { main: '#A855F7', bg: 'rgba(168,85,247,0.15)', label: 'Música' },
  party:      { main: '#EC4899', bg: 'rgba(236,72,153,0.15)', label: 'Fiesta' },
  wellness:   { main: '#22C55E', bg: 'rgba(34,197,94,0.15)',  label: 'Wellness' },
  art:        { main: '#3B82F6', bg: 'rgba(59,130,246,0.15)', label: 'Arte' },
  popup:      { main: '#06B6D4', bg: 'rgba(6,182,212,0.15)',  label: 'Pop-up' },
  daypass:    { main: '#F59E0B', bg: 'rgba(245,158,11,0.15)', label: 'Pasa día' },
  sunset:     { main: '#FB923C', bg: 'rgba(251,146,60,0.15)', label: 'Sunset' },
};

const getBudgetStyle = (isFree: boolean, price: number) => {
  if (isFree) return { main: '#22C55E', bg: 'rgba(34,197,94,0.18)', label: 'GRATIS' };
  if (price <= 30000) return { main: '#3B82F6', bg: 'rgba(59,130,246,0.18)', label: `$${(price/1000).toFixed(0)}K` };
  if (price <= 80000) return { main: '#F97316', bg: 'rgba(249,115,22,0.18)', label: `$${(price/1000).toFixed(0)}K` };
  return { main: '#EF4444', bg: 'rgba(239,68,68,0.18)', label: `$${(price/1000).toFixed(0)}K` };
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const isNightTime = (t: string) => {
  // Considera "noche" eventos que arrancan a partir de las 17:00 (sunset, cena, fiesta)
  if (!t) return false;
  const hh = parseInt(t.split(':')[0], 10);
  return hh >= 17 || hh < 5; // 5am es transición (after-party)
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
  const { s } = useLang();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [featured, setFeatured] = useState<Event[]>([]);
  const [todayEvents, setTodayEvents] = useState<Event[]>([]);
  const [todayPEvents, setTodayPEvents] = useState<PEvent[]>([]);
  const [promotions, setPromotions] = useState<any[]>([]);
  const [sponsors, setSponsors] = useState<any[]>([]);
  const [activeSponsor, setActiveSponsor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeSeasonIdx, setActiveSeasonIdx] = useState(0);
  const [favItems, setFavItems] = useState<any[]>([]);
  const flatListRef = useRef<FlatList>(null);

  const fetchData = async () => {
    try {
      const today = todayIso();
      const [s, f, sp, pe, promos] = await Promise.all([
        api.get('/seasons?active=true'),
        api.get('/events/featured'),
        api.get('/sponsors').catch(() => []),
        api.get(`/partner-events?date=${today}`).catch(() => []),
        api.get('/promotions/today').catch(() => []),
      ]);
      setSeasons(s);
      setFeatured(f);
      setSponsors(sp);
      setTodayPEvents(pe || []);
      setPromotions(promos || []);
      // Festival programación (kept for back-compat; no longer rendered as a section)
      const firstDate = s.length > 0 ? s[0].start_date : '2025-12-30';
      const t = await api.get(`/events?date=${firstDate}`).catch(() => []);
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
            <Text style={styles.greeting}>{user ? `${s('greeting_hi')}, ${user.name.split(' ')[0]}` : s('greeting_welcome')}</Text>
            <Text style={styles.headerTitle}>Amo Cartagena ❤️</Text>
          </View>
          <TouchableOpacity testID="notifications-btn" onPress={() => router.push('/notifications')} style={styles.notifBtn}>
            <Ionicons name="notifications-outline" size={24} color={COLORS.textMain} />
          </TouchableOpacity>
        </View>

        {/* Unified AI + Search Bar — tap left side for keyword search, right side opens AI Concierge */}
        <View style={styles.searchBar}>
          <TouchableOpacity
            style={styles.searchTapZone}
            onPress={() => router.push('/search')}
            activeOpacity={0.8}
          >
            <Ionicons name="search" size={18} color={COLORS.textMuted} />
            <Text style={styles.searchPlaceholder} numberOfLines={1}>
              Pregunta a Amo o busca…
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.aiInlineBtn}
            onPress={() => {
              const { DeviceEventEmitter } = require('react-native');
              DeviceEventEmitter.emit('openAssistant');
            }}
            activeOpacity={0.85}
          >
            <Ionicons name="sparkles" size={15} color={COLORS.white} />
            <Text style={styles.aiInlineBtnText}>Amo IA</Text>
          </TouchableOpacity>
        </View>

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

        {/* Quick Access — moved right after sponsors, prominent + colorful */}
        <View style={styles.quickAccessHero}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickAccessRow}
          >
            {[
              { icon: 'calendar',       label: s('home_agenda'),     subtitle: s('home_today'),       color: '#F97316', route: '/(tabs)/agenda' },
              { icon: 'musical-notes',  label: s('home_concerts'),   subtitle: s('home_live'),        color: '#A855F7', route: '/concerts' },
              { icon: 'heart',          label: s('home_favorites'),  subtitle: s('home_my_list'),     color: '#EF4444', route: '/favorites' },
              { icon: 'boat',           label: s('home_transport'),  subtitle: s('home_boats'),       color: '#06B6D4', route: '/transport' },
              { icon: 'trail-sign',     label: s('home_routes'),     subtitle: 'IA',                  color: '#10B981', route: '/itineraries' },
            ].map((item) => (
              <TouchableOpacity
                key={item.label}
                testID={`quick-${item.label.toLowerCase()}`}
                style={[styles.quickItemHero, { backgroundColor: item.color + '1A', borderColor: item.color + '4D' }]}
                onPress={() => {
                  trackEvent('quick_access', item.label, 'navigation');
                  router.push(item.route as any);
                }}
                activeOpacity={0.8}
              >
                <View style={[styles.quickIconHero, { backgroundColor: item.color }]}>
                  <Ionicons name={item.icon as any} size={22} color={COLORS.white} />
                </View>
                <Text style={[styles.quickLabelHero, { color: item.color }]}>{item.label}</Text>
                <Text style={styles.quickSubtitleHero}>{item.subtitle}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

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

        {/* Quick Access — moved to top of screen */}

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

        {/* Hoy & Esta noche - Partner Events */}
        {(() => {
          const dayPE = todayPEvents.filter(e => !isNightTime(e.start_time));
          const nightPE = todayPEvents.filter(e => isNightTime(e.start_time));
          const renderPECard = (event: PEvent) => {
            const cat = CAT_COLORS[event.category] || { main: COLORS.primary, bg: 'rgba(217,119,6,0.15)', label: event.category };
            const budget = getBudgetStyle(event.is_free, event.price);
            return (
              <TouchableOpacity
                key={event.event_id}
                style={styles.peCard}
                onPress={() => {
                  trackEvent('event_click', event.event_id, 'partner_event');
                  router.push(`/partner-event/${event.event_id}` as any);
                }}
                activeOpacity={0.85}
              >
                <View style={styles.peThumbWrap}>
                  <Image source={{ uri: event.flyer_url }} style={styles.peThumb} />
                  <View style={[styles.peTimeChip]}>
                    <Text style={styles.peTimeChipText}>{event.start_time}</Text>
                  </View>
                </View>
                <View style={styles.peBody}>
                  <Text style={styles.peTitle} numberOfLines={2}>{event.title}</Text>
                  <TouchableOpacity
                    style={styles.pePartnerBtn}
                    onPress={(e) => {
                      e.stopPropagation();
                      trackEvent('partner_click', event.partner_id, 'partner');
                      router.push(`/partner/${event.partner_id}` as any);
                    }}
                    activeOpacity={0.7}
                    hitSlop={{ top: 6, bottom: 6 }}
                  >
                    <Ionicons name="storefront-outline" size={11} color={COLORS.textMuted} />
                    <Text style={styles.pePartner} numberOfLines={1}>{event.partner_name}</Text>
                    <Ionicons name="chevron-forward" size={11} color={COLORS.textMuted} />
                  </TouchableOpacity>
                  <View style={styles.peTagsRow}>
                    <View style={[styles.peCatBadge, { backgroundColor: cat.bg, borderColor: cat.main }]}>
                      <View style={[styles.peCatDot, { backgroundColor: cat.main }]} />
                      <Text style={[styles.peCatText, { color: cat.main }]}>{cat.label}</Text>
                    </View>
                    <View style={[styles.peBudgetBadge, { backgroundColor: budget.bg, borderColor: budget.main }]}>
                      <Text style={[styles.peBudgetText, { color: budget.main }]}>{budget.label}</Text>
                    </View>
                  </View>
                </View>
              </TouchableOpacity>
            );
          };
          return (
            <>
              {/* Qué pasa hoy */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionTitleRow}>
                    <Ionicons name="sunny" size={18} color="#F97316" />
                    <Text style={styles.sectionTitle}>Qué pasa hoy</Text>
                    {dayPE.length > 0 && <Text style={styles.sectionCount}>{dayPE.length}</Text>}
                  </View>
                  <TouchableOpacity onPress={() => router.push('/(tabs)/agenda' as any)}>
                    <Text style={styles.seeAll}>Ver todos</Text>
                  </TouchableOpacity>
                </View>
                {dayPE.length === 0 ? (
                  <View style={styles.emptySlot}>
                    <Ionicons name="cafe-outline" size={26} color={COLORS.textMuted} />
                    <Text style={styles.emptySlotText}>Sin planes de día por ahora</Text>
                  </View>
                ) : (
                  dayPE.slice(0, 4).map(renderPECard)
                )}
              </View>

              {/* Qué pasa esta noche */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionTitleRow}>
                    <Ionicons name="moon" size={18} color="#A855F7" />
                    <Text style={styles.sectionTitle}>Qué pasa esta noche</Text>
                    {nightPE.length > 0 && <Text style={styles.sectionCount}>{nightPE.length}</Text>}
                  </View>
                  <TouchableOpacity onPress={() => router.push('/(tabs)/agenda' as any)}>
                    <Text style={styles.seeAll}>Ver todos</Text>
                  </TouchableOpacity>
                </View>
                {nightPE.length === 0 ? (
                  <View style={styles.emptySlot}>
                    <Ionicons name="wine-outline" size={26} color={COLORS.textMuted} />
                    <Text style={styles.emptySlotText}>Sin planes de noche por ahora</Text>
                  </View>
                ) : (
                  nightPE.slice(0, 4).map(renderPECard)
                )}
              </View>
            </>
          );
        })()}

        {/* Ofertas del día - Promociones partners */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="pricetag" size={18} color="#EF4444" />
              <Text style={styles.sectionTitle}>Ofertas del día</Text>
              {promotions.length > 0 && <Text style={styles.sectionCount}>{promotions.length}</Text>}
            </View>
          </View>
          {promotions.length === 0 ? (
            <View style={styles.emptySlot}>
              <Ionicons name="pricetags-outline" size={26} color={COLORS.textMuted} />
              <Text style={styles.emptySlotText}>No hay ofertas activas hoy</Text>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
            >
              {promotions.map((promo) => {
                const cat = CAT_COLORS[promo.category] || { main: COLORS.primary, bg: 'rgba(217,119,6,0.15)', label: promo.category };
                const tierColors = promo.partner_tier ? TIER_COLORS[promo.partner_tier as Tier] : null;
                return (
                  <TouchableOpacity
                    key={promo.promo_id}
                    style={[styles.promoCard, tierColors && { borderColor: tierColors.border }]}
                    activeOpacity={0.85}
                    onPress={async () => {
                      try { await api.post(`/promotions/${promo.promo_id}/track-click`); } catch {}
                      trackEvent('promo_click', promo.promo_id, 'promotion');
                      router.push(`/partner/${promo.partner_id}` as any);
                    }}
                  >
                    <Image source={{ uri: promo.image_url }} style={styles.promoImage} />
                    <View style={styles.promoOverlay} />
                    {tierColors && <View style={[styles.promoTierStripe, { backgroundColor: tierColors.main }]} />}
                    {promo.tag_label ? (
                      <View style={styles.promoDealBadge}>
                        <Ionicons name="flash" size={11} color={COLORS.white} />
                        <Text style={styles.promoDealText}>{promo.tag_label}</Text>
                      </View>
                    ) : null}
                    <View style={styles.promoContent}>
                      {/* Category badge - ALWAYS visible per requirement */}
                      <View style={[styles.promoCatBadge, { backgroundColor: cat.bg, borderColor: cat.main }]}>
                        <View style={[styles.peCatDot, { backgroundColor: cat.main }]} />
                        <Text style={[styles.peCatText, { color: cat.main }]}>{cat.label}</Text>
                      </View>
                      <Text style={styles.promoTitle} numberOfLines={2}>{promo.title}</Text>
                      <View style={styles.promoPartnerRow}>
                        <Ionicons name="storefront-outline" size={11} color="rgba(255,255,255,0.7)" />
                        <Text style={styles.promoPartnerName} numberOfLines={1}>{promo.partner_name}</Text>
                      </View>
                      <View style={styles.promoBottomRow}>
                        {promo.promo_price > 0 ? (
                          <View style={styles.promoPriceRow}>
                            {promo.original_price > 0 && promo.original_price !== promo.promo_price && (
                              <Text style={styles.promoOldPrice}>${(promo.original_price/1000).toFixed(0)}K</Text>
                            )}
                            <Text style={styles.promoNewPrice}>${(promo.promo_price/1000).toFixed(0)}K</Text>
                          </View>
                        ) : promo.discount_pct > 0 ? (
                          <Text style={styles.promoNewPrice}>-{promo.discount_pct}%</Text>
                        ) : (
                          <Text style={styles.promoNewPrice}>BONUS</Text>
                        )}
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
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
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: SPACING.lg, marginBottom: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, paddingLeft: SPACING.md, paddingRight: 6, paddingVertical: 6, borderWidth: 1, borderColor: COLORS.border },
  searchTapZone: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, flex: 1, paddingVertical: 6 },
  searchPlaceholder: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular, flex: 1 },
  aiInlineBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: RADIUS.full, backgroundColor: COLORS.primary },
  aiInlineBtnText: { color: COLORS.white, fontSize: 11.5, ...FONTS.bold, letterSpacing: 0.4 },

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
  quickAccessHero: { marginBottom: SPACING.lg },
  quickAccessRow: { paddingHorizontal: SPACING.lg, gap: SPACING.sm },
  quickItemHero: { width: 92, height: 110, borderRadius: RADIUS.xl, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', paddingVertical: SPACING.sm, gap: 6 },
  quickIconHero: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  quickLabelHero: { fontSize: 12, ...FONTS.bold, letterSpacing: 0.3 },
  quickSubtitleHero: { fontSize: 9, color: COLORS.textMuted, ...FONTS.medium, textTransform: 'uppercase', letterSpacing: 0.8 },
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

  // Promo cards
  promoCard: {
    width: 220,
    height: 280,
    borderRadius: RADIUS.xl,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: COLORS.border,
    position: 'relative',
    backgroundColor: COLORS.surface,
  },
  promoImage: { width: '100%', height: '100%', position: 'absolute' },
  promoOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,8,20,0.55)' },
  promoTierStripe: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  promoDealBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EF4444',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
  },
  promoDealText: { fontSize: 10, color: COLORS.white, ...FONTS.bold, letterSpacing: 0.4 },
  promoContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: SPACING.sm,
    gap: 5,
  },
  promoCatBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  promoTitle: {
    fontSize: 14,
    color: COLORS.white,
    ...FONTS.bold,
    lineHeight: 18,
    marginTop: 2,
  },
  promoPartnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  promoPartnerName: { fontSize: 11, color: 'rgba(255,255,255,0.85)', ...FONTS.medium, flex: 1 },
  promoBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 4,
  },
  promoPriceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  promoOldPrice: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
    ...FONTS.medium,
    textDecorationLine: 'line-through',
  },
  promoNewPrice: {
    fontSize: 17,
    color: COLORS.primary,
    ...FONTS.bold,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionCount: {
    fontSize: 11,
    color: COLORS.textMuted,
    ...FONTS.bold,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  emptySlot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: SPACING.lg,
    paddingVertical: 14,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  emptySlotText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium },
  peCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  peThumbWrap: { width: 84, height: 92, position: 'relative' },
  peThumb: { width: '100%', height: '100%' },
  peTimeChip: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: 'rgba(5,8,20,0.85)',
    borderRadius: RADIUS.full,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  peTimeChipText: { fontSize: 10, color: COLORS.white, ...FONTS.bold, letterSpacing: 0.4 },
  peBody: { flex: 1, padding: 10, justifyContent: 'space-between' },
  peTitle: { fontSize: 13, color: COLORS.textMain, ...FONTS.bold, lineHeight: 17 },
  pePartnerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  pePartner: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, maxWidth: 140 },
  peTagsRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  peCatBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  peCatDot: { width: 6, height: 6, borderRadius: 3 },
  peCatText: { fontSize: 9, ...FONTS.bold, letterSpacing: 0.3 },
  peBudgetBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  peBudgetText: { fontSize: 9, ...FONTS.bold, letterSpacing: 0.4 },
});
