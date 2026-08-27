import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Dimensions, FlatList, Linking } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS, EVENT_TYPE_LABELS, TIER_COLORS, Tier, colorForKey } from '../../src/constants/theme';
import { IMAGES, getCategoryImage } from '../../src/constants/images';
import { api } from '../../src/constants/api';
import { useAuth } from '../../src/context/AuthContext';
import { useFavorites } from '../../src/context/FavoritesContext';
import { useLang } from '../../src/context/LanguageContext';
import { useTr } from '../../src/i18n/autoTr';
import { SafeImage } from '../../src/components/SafeImage';
import { SkeletonList } from '../../src/components/Skeleton';
import { getUpcomingEvents } from '../../src/lib/data';
import { bogotaToday } from '../../src/lib/eventTime';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePersonalization } from '../../src/context/PersonalizationContext';
import { usePartnerCount } from '../../src/context/PartnerCountContext';
import { COLLECTION_DEFS } from '../../src/constants/collections';
import { captureRef, claimPendingRef } from '../../src/lib/referral';
import { PassportGlance } from '../../src/components/PassportGlance';
import { SeasonBanner } from '../../src/components/SeasonBanner';
import { HomeBaseSheet } from '../../src/components/HomeBaseSheet';
import { NowStrip } from '../../src/components/NowStrip';
import { FxStrip } from '../../src/components/FxStrip';
import WelcomeBackBeat from '../../src/components/WelcomeBackBeat';
import LockedTease from '../../src/components/LockedTease';

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
  festival:   { main: '#F43F5E', bg: 'rgba(244,63,94,0.15)', label: 'Festival' },
  cultural:   { main: '#8B5CF6', bg: 'rgba(139,92,246,0.15)', label: 'Cultural' },
  sports:     { main: '#10B981', bg: 'rgba(16,185,129,0.15)', label: 'Deportes' },
  religious:  { main: '#F59E0B', bg: 'rgba(245,158,11,0.15)', label: 'Religioso' },
  holiday:    { main: '#EF4444', bg: 'rgba(239,68,68,0.15)', label: 'Festivo' },
  recurring:  { main: '#06B6D4', bg: 'rgba(6,182,212,0.15)', label: 'Recurrente' },
  literary:   { main: '#8B5CF6', bg: 'rgba(139,92,246,0.15)', label: 'Literario' },
};

const getBudgetStyle = (isFree: boolean, price: number) => {
  if (isFree) return { main: '#22C55E', bg: 'rgba(34,197,94,0.18)', label: 'GRATIS' };
  if (price <= 30000) return { main: '#3B82F6', bg: 'rgba(59,130,246,0.18)', label: `$${(price/1000).toFixed(0)}K` };
  if (price <= 80000) return { main: '#F97316', bg: 'rgba(249,115,22,0.18)', label: `$${(price/1000).toFixed(0)}K` };
  return { main: '#EF4444', bg: 'rgba(239,68,68,0.18)', label: `$${(price/1000).toFixed(0)}K` };
};

const todayIso = () => bogotaToday(); // Bogota date, not UTC (events must not roll over at 19:00 local)
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
  const { s, lang } = useLang();
  const tr = useTr();
  const { userProfile, getPersonalizedPartners, getPersonalizedCategories, getGreeting, hasCompletedOnboarding } = usePersonalization();
  const [baseSheet, setBaseSheet] = useState(false);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [featured, setFeatured] = useState<Event[]>([]);
  const [todayEvents, setTodayEvents] = useState<Event[]>([]);
  const [todayPEvents, setTodayPEvents] = useState<PEvent[]>([]);
  const [promotions, setPromotions] = useState<any[]>([]);
  const [sponsors, setSponsors] = useState<any[]>([]);
  const [activeSponsor, setActiveSponsor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Referral loop (1.5): capture ?ref on arrival; claim once after sign-in.
  // Drop 11 (11C1): the claim is a shared MOMENT, not a silent ledger entry —
  // both real names, the real +500, nothing fabricated.
  const [refMoment, setRefMoment] = useState<string | null>(null);
  useEffect(() => { captureRef(); }, []);
  useEffect(() => {
    if (user) {
      claimPendingRef().then((r) => {
        if (r && r.points > 0) {
          setRefMoment(r.referrer
            ? `Vos y ${r.referrer} están explorando Cartagena · +${r.points} puntos para los dos ✨`
            : `¡Bienvenido! +${r.points} puntos por unirte con un código de amigo ✨`);
        }
      }).catch(() => {});
    }
  }, [user]);
  const [activeSeasonIdx, setActiveSeasonIdx] = useState(0);
  const [favItems, setFavItems] = useState<any[]>([]);
  const [unreadNotifs, setUnreadNotifs] = useState<number>(0);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const partnerCount = usePartnerCount();
  const [showGuestBanner, setShowGuestBanner] = useState(false);
  const [guestRecommendations, setGuestRecommendations] = useState<any[]>([]);
  const [forYou, setForYou] = useState<any[]>([]);

  // Taste-engine rail for signed-in users (server-side affinity from
  // favorites + reservations + onboarding)
  useEffect(() => {
    if (!user) { setForYou([]); return; }
    let alive = true;
    api.get('/for-you')
      .then((d: any) => { if (alive && Array.isArray(d?.partners)) setForYou(d.partners); })
      .catch(() => {});
    return () => { alive = false; };
  }, [user]);
  const flatListRef = useRef<FlatList>(null);

  // Guest personalization banner — show on 2nd visit, dismissible
  useEffect(() => {
    if (user) return;
    (async () => {
      const visits = parseInt(await AsyncStorage.getItem('@home_visits') || '0', 10);
      await AsyncStorage.setItem('@home_visits', String(visits + 1));
      const dismissed = await AsyncStorage.getItem('@guest_banner_dismissed');
      if (visits >= 1 && !dismissed) setShowGuestBanner(true);
    })();
  }, [user]);

  // Guest personalized recommendations — fetch from static partners.json
  useEffect(() => {
    if (user || !hasCompletedOnboarding || userProfile.interests.length === 0) {
      setGuestRecommendations([]);
      return;
    }
    (async () => {
      try {
        const res = await fetch('/data/partners.json');
        if (!res.ok) return;
        const allPartners = await res.json();
        if (!Array.isArray(allPartners)) return;
        const personalized = getPersonalizedPartners(allPartners).slice(0, 8);
        setGuestRecommendations(personalized);
      } catch { /* non-critical */ }
    })();
  }, [user, hasCompletedOnboarding, userProfile.interests.length]);

  // Check unread notifications once on focus (no polling — eliminates 401 spam)
  useFocusEffect(
    React.useCallback(() => {
      if (!user) { setUnreadNotifs(0); return; }
      let cancelled = false;
      (async () => {
        try {
          const data = await api.get('/notifications');
          if (cancelled) return;
          const unread = Array.isArray(data) ? data.filter((n: any) => !n.is_read).length : 0;
          setUnreadNotifs(unread);
        } catch { setUnreadNotifs(0); }
      })();
      return () => { cancelled = true; };
    }, [user])
  );

  const fetchData = async () => {
    try {
      const today = todayIso();
      // Static-first: paint from /data/*.json instantly, then hydrate from backend
      const staticFetch = (file: string) =>
        fetch(`/data/${file}.json`).then(r => r.ok ? r.json() : []).catch(() => []);

      // Partner-events must reflect TODAY, never a stale bundled date. An event
      // counts as "today" if today falls in its date window (defensive: static
      // JSON only has `date`, but honor date_start/date_end if the API sends them).
      const filterPeToday = (arr: any[]) => (Array.isArray(arr) ? arr : []).filter((e: any) => {
        const start = e.date_start || e.date || '';
        const end = e.date_end || start;
        return start <= today && end >= today;
      });

      // 1. Instant paint from static data (< 1s)
      const [staticSeasons, staticEvents, staticSponsors, staticPE, staticPromos] = await Promise.all([
        staticFetch('seasons'),
        getUpcomingEvents().catch(() => []),
        staticFetch('sponsors'),
        staticFetch('partner-events'),
        staticFetch('promotions/today'),
      ]);

      // Apply static data immediately — exits skeleton state
      const applyData = (s: any[], f: any[], sp: any[], pe: any[], promos: any[]) => {
        setSeasons(Array.isArray(s) ? s : []);
        const evts = (Array.isArray(f) ? f : []).map((e: any) => ({
          ...e,
          event_id: e.slug || e.id || e.event_id,
          title: e.name_es || e.title || '',
          date: e.date_start || e.date || '',
          type: e.category || e.type || '',
          start_time: e.time_start || e.start_time || '',
          venue_name: e.venue || e.venue_name || '',
          price: e.price_min_cop || e.price || 0,
        }));
        setFeatured(evts);
        setSponsors(Array.isArray(sp) ? sp : []);
        setTodayPEvents(filterPeToday(pe));
        setPromotions(Array.isArray(promos) ? promos : []);
        const todayFiltered = evts.filter((e: any) => {
          const start = e.date_start || e.date || '';
          const end = e.date_end || start;
          return start <= today && end >= today;
        });
        setTodayEvents(todayFiltered.length === 0 ? evts.slice(0, 8) : todayFiltered);
        return evts;
      };

      applyData(staticSeasons, staticEvents, staticSponsors, staticPE, staticPromos);
      setLoading(false); // Exit skeleton immediately

      // 2. Hydrate from backend in background (non-blocking — does NOT hold up first paint)
      Promise.all([
        api.get('/seasons?active=true').catch(() => []),
        getUpcomingEvents().catch(() => []),
        api.get('/sponsors').catch(() => []),
        api.get(`/partner-events?date=${today}`).catch(() => []),
        api.get('/promotions/today').catch(() => []),
      ]).then(([s, f, sp, pe, promos]) => {
        // Partner-events hydration must NEVER wait on an active season — live
        // data always wins over the bundled static snapshot, even when
        // /seasons returns empty (no active season right now).
        setTodayPEvents(filterPeToday(pe));
        if (Array.isArray(s) && s.length > 0) {
          applyData(s, f, sp, pe, promos);
        }
      }).catch(() => {});
      // Personalized recommendations: use AI profile to filter partners
      if (user) {
        try {
          const [profileRes, allPartnersRes] = await Promise.all([
            api.get('/profile/me').catch(() => null),
            api.get('/partners').catch(() => []),
          ]);
          const allPartners = Array.isArray(allPartnersRes) ? allPartnersRes : [];
          if (profileRes && profileRes.ai_status !== 'not_built' && allPartners.length > 0) {
            const interests = (profileRes.interests || []).map((i: string) => i.toLowerCase());
            const persona = (profileRes.persona || '').toLowerCase();
            // Score partners based on profile match
            const scored = allPartners
              .filter((p: any) => p.tier === 'elite' || p.tier === 'premium' || p.tier === 'gold' || p.tier === 'silver' || p.rating >= 4)
              .map((p: any) => {
                let score = p.rating || 0;
                const cat = (p.category || '').toLowerCase();
                const sub = (p.subcategory || '').toLowerCase();
                if (interests.some((i: string) => cat.includes(i) || sub.includes(i))) score += 3;
                if (persona.includes('foodie') && (cat === 'restaurant' || cat === 'gastronomy')) score += 2;
                if (persona.includes('nightlife') && (cat === 'club' || cat === 'bar' || cat === 'nightlife')) score += 2;
                if (persona.includes('wellness') && (cat === 'spa' || cat === 'wellness')) score += 2;
                if (persona.includes('adventure') && (cat === 'activity' || cat === 'tour')) score += 2;
                if (p.tier === 'gold') score += 1;
                return { ...p, _score: score };
              })
              .sort((a: any, b: any) => b._score - a._score)
              .slice(0, 8);
            setRecommendations(scored);
          }
        } catch { /* non-critical */ }
      }
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
          for (const p of (Array.isArray(allPartners) ? allPartners : [])) {
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
        <SkeletonList />
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
      <SafeImage uri={item.image_url} fallbackUri={IMAGES.season_fallback} style={styles.heroImage} />
      <View style={styles.heroOverlay} />
      <View style={styles.heroContent}>
        <Text style={[styles.heroLabel, { color: item.color }]}>{formatDateRange(item.start_date, item.end_date)}</Text>
        <Text style={styles.heroTitle}>{item.name}</Text>
        <Text style={styles.heroSub}>{(item.tags || []).join(' · ')}</Text>
        {item.event_count === 0 && (
          <View style={[styles.comingSoonBadge, { backgroundColor: item.color }]}>
            <Text style={styles.comingSoonText}>{tr('PRÓXIMAMENTE')}</Text>
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
            <Text style={styles.greeting}>{user ? `${s('greeting_hi')}, ${(user.name || '').split(' ')[0] || ''}` : (userProfile.isPersonalized ? getGreeting() : s('greeting_welcome'))}</Text>
            <Text style={styles.headerTitle}>Amo Cartagena ❤️</Text>
          </View>
          <TouchableOpacity testID="notifications-btn" onPress={() => router.push('/notifications')} style={styles.notifBtn}>
            <Ionicons name="notifications-outline" size={24} color={COLORS.textMain} />
            {unreadNotifs > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>{unreadNotifs > 9 ? '9+' : String(unreadNotifs)}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Drop 8F: passport greets you when a missing stamp is steps away */}
        <PassportGlance />

        {/* Primary tool — a big AI-powered search HERO (Franck Aug 2026: "search is
            the main tool", make it bigger + AI, above the fold). Tap → /search (Luna). */}
        <TouchableOpacity
          style={styles.searchHero}
          onPress={() => router.push('/search')}
          activeOpacity={0.9}
          testID="home-search-hero"
        >
          <View style={styles.searchHeroIcon}>
            <Ionicons name="sparkles" size={20} color={COLORS.white} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.searchHeroText} numberOfLines={1}>{tr('Buscar en Cartagena con IA…')}</Text>
            <Text style={styles.searchHeroSub} numberOfLines={1}>{tr('Preguntá lo que sea — Luna te guía')}</Text>
          </View>
          <Ionicons name="mic-outline" size={20} color={COLORS.textMuted} />
        </TouchableOpacity>

        {/* Taste profile mini-card — shown when personalized */}
        {userProfile.isPersonalized && userProfile.interests.length > 0 && (
          <View style={styles.tasteProfileCard}>
            <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: 12, color: COLORS.textMuted, ...FONTS.medium }}>{tr('Tu perfil:')}</Text>
              {userProfile.interests.slice(0, 4).map((interest: string) => {
                const INTEREST_EMOJI: Record<string, string> = { restaurant: '\u{1F37D}\u{FE0F}', bar: '\u{1F378}', beach_club: '\u{1F3D6}\u{FE0F}', club: '\u{1F3B6}', spa: '\u{1F9D6}', beauty: '\u{1F485}', activity: '\u{1F9ED}', hotel: '\u{1F3E8}', cafe: '\u2615', yacht: '\u26F5' };
                return (
                  <Text key={interest} style={{ fontSize: 12, color: COLORS.textMain, ...FONTS.medium }}>
                    {INTEREST_EMOJI[interest] || '\u2728'} {s(`onboard_interest_${interest}`)}
                  </Text>
                );
              })}
            </View>
            <TouchableOpacity onPress={() => router.push('/onboarding' as any)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={{ fontSize: 11, color: COLORS.primary, ...FONTS.bold }}>Editar</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Drop FR (FR-D): warm returning-user beat — real title/streak/now */}
        <WelcomeBackBeat />

        {/* Drop 11 (11C1): the reciprocal spark — real names, the real +500 */}
        {refMoment && (
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: SPACING.lg, marginBottom: SPACING.md, backgroundColor: 'rgba(18,181,165,0.12)', borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: 'rgba(18,181,165,0.35)', gap: SPACING.sm }}
            onPress={() => setRefMoment(null)}
            activeOpacity={0.85}
          >
            <Text style={{ fontSize: 20 }}>🤝</Text>
            <Text style={{ flex: 1, color: '#FF6B75', fontSize: 13, ...FONTS.semibold }}>{refMoment}</Text>
          </TouchableOpacity>
        )}

        {/* Guest personalization banner */}
        {showGuestBanner && !hasCompletedOnboarding && (
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: SPACING.lg, marginBottom: SPACING.md, backgroundColor: 'rgba(18,181,165,0.12)', borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: 'rgba(18,181,165,0.3)', gap: SPACING.sm }}
            onPress={() => { setShowGuestBanner(false); router.push('/onboarding' as any); }}
            activeOpacity={0.85}
          >
            <Ionicons name="sparkles" size={20} color="#A855F7" />
            <Text style={{ flex: 1, fontSize: 13, color: COLORS.white, ...FONTS.medium }}>{s('home_guest_banner')}</Text>
            <Text style={{ fontSize: 12, color: '#12B5A5', ...FONTS.bold }}>{s('home_guest_banner_cta')}</Text>
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); setShowGuestBanner(false); AsyncStorage.setItem('@guest_banner_dismissed', 'true'); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={16} color={COLORS.textMuted} />
            </TouchableOpacity>
          </TouchableOpacity>
        )}

        {/* Hero Image — Cartagena first impression */}
        <TouchableOpacity style={styles.heroBanner} activeOpacity={0.95} onPress={() => router.push('/(tabs)/explore' as any)}>
          <SafeImage uri={IMAGES.hero} style={styles.heroBannerImage} />
          <View style={styles.heroBannerOverlay} />
          <View style={styles.heroBannerContent}>
            <Text style={styles.heroBannerLabel}>CARTAGENA DE INDIAS</Text>
            <Text style={styles.heroBannerTitle}>{partnerCount || '...'} lugares para descubrir</Text>
            <Text style={styles.heroBannerSub}>
              {userProfile.isPersonalized && userProfile.interests.length > 0
                ? userProfile.interests.map((i: string) => s(`onboard_interest_${i}`)).join(' \u00B7 ')
                : tr('Restaurantes \u00B7 Bares \u00B7 Beach Clubs \u00B7 Spas \u00B7 Nightlife')}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Sponsor Banner */}
        {sponsors.length > 0 && (
          <TouchableOpacity
            style={styles.sponsorBanner}
            onPress={() => sponsors[activeSponsor]?.url ? Linking.openURL(sponsors[activeSponsor].url).catch(() => {}) : null}
            activeOpacity={0.9}
          >
            <View style={styles.sponsorContent}>
              {sponsors[activeSponsor]?.logo_url ? (
                <SafeImage uri={sponsors[activeSponsor].logo_url} category="institutional" style={styles.sponsorLogo} resizeMode="contain" />
              ) : (
                <View style={[styles.sponsorIconCircle, { backgroundColor: `${sponsors[activeSponsor]?.color || COLORS.icon}20` }]}>
                  <Ionicons name="business" size={18} color={sponsors[activeSponsor]?.color || COLORS.icon} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.sponsorName}>{sponsors[activeSponsor]?.name}</Text>
                <Text style={styles.sponsorTagline}>{sponsors[activeSponsor]?.tagline}</Text>
              </View>
              <View style={[styles.sponsorTierBadge, { backgroundColor: `${sponsors[activeSponsor]?.color || COLORS.official}20` }]}>
                <Text style={[styles.sponsorTierText, { color: sponsors[activeSponsor]?.color || COLORS.official }]}>
                  {sponsors[activeSponsor]?.tier === 'gold' ? 'GOLD' : sponsors[activeSponsor]?.tier === 'institutional' ? 'OFICIAL' : 'PARTNER'}
                </Text>
              </View>
            </View>
            {/* Progress dots */}
            <View style={styles.sponsorDots}>
              {sponsors.map((_, i) => (
                <View key={i} style={[styles.sponsorDot, i === activeSponsor && { backgroundColor: sponsors[activeSponsor]?.color || COLORS.icon, width: 20, borderRadius: 5 }]} />
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
            {(() => {
              const allItems = [
                { icon: 'home',           label: tr('Mi base'),        subtitle: tr('Cómo volver'),     color: '#12B5A5', route: '#base', cat: '' },
                { icon: 'calendar',       label: s('home_agenda'),     subtitle: s('home_today'),       color: '#F97316', route: '/(tabs)/agenda', cat: '' },
                { icon: 'compass',        label: tr('Explorar'),       subtitle: tr('Lugares'),         color: '#3B82F6', route: '/(tabs)/explore', cat: '' },
                { icon: 'ribbon',         label: tr('Pasaporte'),      subtitle: tr('Sellos'),          color: '#12B5A5', route: '/(tabs)/pasaporte', cat: '' },
                { icon: 'briefcase',      label: tr('Mi Viaje'),       subtitle: tr('Planeá con tu grupo'), color: '#8B5CF6', route: '/viaje', cat: '' },
                { icon: 'medkit',         label: tr('Esenciales'),     subtitle: tr('Todo lo básico'),  color: '#14B8A6', route: '/esenciales', cat: '' },
                { icon: 'shield-checkmark', label: tr('Sin sustos'),   subtitle: tr('Precios+Tips'),    color: '#22C55E', route: '/seguridad', cat: '' },
                { icon: 'musical-notes',  label: s('home_concerts'),   subtitle: s('home_live'),        color: '#A855F7', route: '/concerts', cat: 'club' },
                { icon: 'star',           label: 'Rewards',            subtitle: 'Puntos',              color: '#F59E0B', route: '/rewards', cat: '' },
                { icon: 'heart',          label: s('home_favorites'),  subtitle: s('home_my_list'),     color: COLORS.bougainvillea, route: '/favorites', cat: '' },
                { icon: 'boat',           label: s('home_transport'),  subtitle: s('home_boats'),       color: '#06B6D4', route: '/transport', cat: 'activity' },
                { icon: 'trail-sign',     label: s('home_routes'),     subtitle: 'IA',                  color: '#10B981', route: '/itineraries', cat: '' },
                { icon: 'shield',         label: tr('Emergencias'),    subtitle: 'SOS',                 color: '#DC2626', route: '/ayuda', cat: '' },
              ];
              // Cruise users: pin transport + itineraries (day-plan tools) to front
              if (userProfile.partyType === 'cruise') {
                const cruisePriority = ['/transport', '/itineraries', '/(tabs)/agenda'];
                const pinned = allItems.filter(i => cruisePriority.includes(i.route));
                const rest = allItems.filter(i => !cruisePriority.includes(i.route));
                return [...pinned, ...rest];
              }
              return allItems;
            })().map((item) => (
              <TouchableOpacity
                key={item.label}
                testID={`quick-${item.label.toLowerCase()}`}
                style={[styles.quickItemHero, { backgroundColor: item.color + '1A', borderColor: item.color + '4D' }]}
                onPress={() => {
                  trackEvent('quick_access', item.label, 'navigation');
                  if (item.route === '#base') { setBaseSheet(true); return; }
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

        {/* Moment strips — relocated BELOW the search hero (Franck Aug 2026: give the
            search tool the top; Green Season / Right Now / FX live here now). */}
        <NowStrip />
        <SeasonBanner />
        <FxStrip />

        {/* Explore by Category — tappable photo cards */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="compass" size={18} color={COLORS.icon} />
              <Text style={styles.sectionTitle}>{tr('Explorar')}</Text>
            </View>
            <TouchableOpacity onPress={() => router.push('/(tabs)/explore' as any)}>
              <Text style={styles.seeAll}>{tr('Ver todo')}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
            {(() => {
              const allCats = [
                { uri: IMAGES.cartagena_aerial, label: 'Restaurantes', sub: '111+', cat: 'restaurant', icon: 'restaurant' },
                { uri: IMAGES.cartagena_streets, label: 'Bares', sub: '30+', cat: 'bar', icon: 'wine' },
                { uri: IMAGES.umbrellas, label: 'Nightlife', sub: '22 clubs', cat: 'nightlife', icon: 'musical-notes' },
                { uri: IMAGES.fountain_market, label: 'Cafés', sub: '17 spots', cat: 'cafe', icon: 'cafe' },
                { uri: IMAGES.flag_rooftops, label: 'Wellness', sub: '51+', cat: 'wellness', icon: 'leaf' },
                { uri: IMAGES.wax_palms, label: 'Experiencias', sub: '74 tours', cat: 'activity', icon: 'compass' },
                { uri: IMAGES.hero, label: 'Hoteles', sub: '80+', cat: 'hotel', icon: 'bed' },
                { uri: IMAGES.cartagena_aerial, label: 'Beach Clubs', sub: '26 islas', cat: 'beach_club', icon: 'umbrella' },
              ];
              // Reorder: user interests first, then the rest
              if (userProfile.isPersonalized && userProfile.interests.length > 0) {
                const prioritized = allCats.filter(c => userProfile.interests.includes(c.cat));
                const rest = allCats.filter(c => !userProfile.interests.includes(c.cat));
                return [...prioritized, ...rest];
              }
              return allCats;
            })().map((item, i) => (
              <TouchableOpacity
                key={i}
                style={styles.photoCard}
                activeOpacity={0.85}
                onPress={() => router.push({ pathname: '/(tabs)/explore' as any, params: { category: item.cat } })}
              >
                <SafeImage uri={item.uri} style={styles.photoImage} resizeMode="cover" />
                <View style={styles.photoOverlay} />
                <View style={styles.photoContent}>
                  <View style={[styles.photoCatIcon, { backgroundColor: colorForKey(item.cat) + '4D' }]}>
                    <Ionicons name={item.icon as any} size={16} color={COLORS.white} />
                  </View>
                  <Text style={styles.photoLabel}>{item.label}</Text>
                  <Text style={styles.photoSub}>{item.sub}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Colecciones — curated occasion collections (knowledge-tag powered) */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="albums" size={18} color="#FBBF24" />
              <Text style={styles.sectionTitle}>{tr('Colecciones')}</Text>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
            {Object.entries(COLLECTION_DEFS).map(([ckey, c]) => (
              <TouchableOpacity
                key={ckey}
                style={styles.collCard}
                onPress={() => router.push(`/collections/${ckey}` as any)}
                activeOpacity={0.85}
              >
                <View style={styles.collIcon}>
                  <Ionicons name={c.icon as any} size={18} color="#FBBF24" />
                </View>
                <Text style={styles.collTitle} numberOfLines={2}>{lang === 'en' ? c.title_en : c.title_es}</Text>
                <Text style={styles.collDesc} numberOfLines={2}>{lang === 'en' ? c.desc_en : c.desc_es}</Text>
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

        {/* Guest personalized recommendations — Para ti (no login required) */}
        {/* Para ti (usuarios) — taste engine del backend */}
        {user && forYou.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="sparkles" size={18} color="#A855F7" />
                <Text style={styles.sectionTitle}>{tr('Para ti')}</Text>
                <View style={styles.aiBadge}>
                  <Text style={styles.aiBadgeText}>AI</Text>
                </View>
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: SPACING.lg, gap: SPACING.sm }}>
              {forYou.map((p: any) => (
                <TouchableOpacity
                  key={p.partner_id}
                  style={styles.recCard}
                  onPress={() => router.push(`/partner/${p.partner_id}` as any)}
                  activeOpacity={0.85}
                >
                  <SafeImage
                    uri={p.image_url || getCategoryImage(p.category)}
                    style={styles.recImage}
                    category={p.category}
                  />
                  <View style={styles.recOverlay}>
                    {p.live_pulse?.title ? (
                      <View style={styles.recPulseBadge}>
                        <Text style={styles.recPulseText} numberOfLines={1}>⚡ {p.live_pulse.title}</Text>
                      </View>
                    ) : p.tier ? (
                      <View style={[styles.recTierBadge, { backgroundColor: TIER_COLORS[p.tier as Tier]?.main || COLORS.icon }]}>
                        <Text style={styles.recTierText}>{(p.tier || '').toUpperCase()}</Text>
                      </View>
                    ) : null}
                    <Text style={styles.recName} numberOfLines={2}>{p.name}</Text>
                    <View style={styles.recMeta}>
                      <Text style={styles.recCategory} numberOfLines={1}>
                        {(p.cuisine || p.subcategory || p.category || '').replace(/_/g, ' ')}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {userProfile.partyType === 'cruise' && (
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: SPACING.lg, marginBottom: SPACING.md, padding: SPACING.md, backgroundColor: 'rgba(6,182,212,0.08)', borderRadius: RADIUS.xl, borderWidth: 1, borderColor: 'rgba(6,182,212,0.5)' }}
            onPress={() => router.push('/rutas' as any)}
            activeOpacity={0.85}
          >
            <Text style={{ fontSize: 26 }}>🚢</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, color: COLORS.textMain, ...FONTS.bold }}>{tr('4 Horas en Cartagena')}</Text>
              <Text style={{ fontSize: 11, color: COLORS.textMuted, ...FONTS.medium }}>{tr('El circuito perfecto para tu día de crucero — caminable desde el puerto')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={'#06B6D4'} />
          </TouchableOpacity>
        )}

        {!user && guestRecommendations.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                {/* Drop FOMO: honest label — these are generic popular picks, not
                    the AI-personalized 'Para ti' (that's the locked tease below). */}
                <Ionicons name="flame" size={18} color={COLORS.coral} />
                <Text style={styles.sectionTitle}>{tr('Populares en Cartagena')}</Text>
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: SPACING.lg, gap: SPACING.sm }}>
              {guestRecommendations.map((p: any) => (
                <TouchableOpacity
                  key={p.partner_id}
                  style={styles.recCard}
                  onPress={() => router.push(`/partner/${p.partner_id}` as any)}
                  activeOpacity={0.85}
                >
                  <SafeImage
                    uri={p.image_url || getCategoryImage(p.category)}
                    style={styles.recImage}
                    category={p.category}
                  />
                  <View style={styles.recOverlay}>
                    {p.tier && (
                      <View style={[styles.recTierBadge, { backgroundColor: TIER_COLORS[p.tier as Tier]?.main || COLORS.icon }]}>
                        <Text style={styles.recTierText}>{(p.tier || '').toUpperCase()}</Text>
                      </View>
                    )}
                    <Text style={styles.recName} numberOfLines={2}>{p.name}</Text>
                    <View style={styles.recMeta}>
                      <Text style={styles.recCategory} numberOfLines={1}>
                        {(p.category || '').replace(/_/g, ' ')}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Drop FOMO: the LOCKED personalized layer — an anon visitor sees the
            SHAPE of Luna's picks (blurred), and one tap unlocks the real thing.
            This is the desire trigger the free 'Populares' row deliberately isn't. */}
        {!user && (
          <View style={styles.section}>
            <LockedTease
              action="personalize"
              next="/"
              icon="sparkles"
              title={tr('Tu Cartagena, según Luna')}
              subtitle={tr('Luna elige lugares para vos según tu vibra. Creá tu cuenta gratis y desbloqueá los tuyos.')}
              cta={tr('Crear cuenta gratis')}
              minHeight={188}
            >
              <View style={{ flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md }}>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={{ width: 150, height: 128, borderRadius: RADIUS.md, backgroundColor: 'rgba(18,181,165,0.09)', borderWidth: 1, borderColor: 'rgba(18,181,165,0.16)', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="sparkles" size={22} color="rgba(18,181,165,0.45)" />
                  </View>
                ))}
              </View>
            </LockedTease>
          </View>
        )}

        {/* Recomendados para ti — AI profile-powered. Franck Aug 2026: only ONE
            "Para ti" row — this is a fallback when the taste-engine row (forYou) is empty. */}
        {recommendations.length > 0 && forYou.length === 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="sparkles" size={18} color="#A855F7" />
                <Text style={styles.sectionTitle}>{tr('Para ti')}</Text>
                <View style={styles.aiBadge}>
                  <Text style={styles.aiBadgeText}>AI</Text>
                </View>
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: SPACING.lg, gap: SPACING.sm }}>
              {recommendations.map((p: any) => (
                <TouchableOpacity
                  key={p.partner_id}
                  style={styles.recCard}
                  onPress={() => router.push(`/partner/${p.partner_id}` as any)}
                  activeOpacity={0.85}
                >
                  <SafeImage
                    uri={p.image_url || getCategoryImage(p.category)}
                    style={styles.recImage}
                    category={p.category}
                  />
                  <View style={styles.recOverlay}>
                    {p.tier && (
                      <View style={[styles.recTierBadge, { backgroundColor: TIER_COLORS[p.tier as Tier]?.main || COLORS.icon }]}>
                        <Text style={styles.recTierText}>{(p.tier || '').toUpperCase()}</Text>
                      </View>
                    )}
                    <Text style={styles.recName} numberOfLines={2}>{p.name}</Text>
                    <View style={styles.recMeta}>
                      {p.rating ? (
                        <View style={styles.recRating}>
                          <Ionicons name="star" size={10} color={COLORS.mustard} />
                          <Text style={styles.recRatingText}>{Number(p.rating).toFixed(1)}</Text>
                        </View>
                      ) : null}
                      <Text style={styles.recCategory} numberOfLines={1}>
                        {(p.category || '').replace(/_/g, ' ')}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Próximos Eventos — major Cartagena events with images */}
        {featured.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="star" size={18} color={COLORS.mustard} />
                <Text style={styles.sectionTitle}>
                  {userProfile.userType === 'visitor' && userProfile.travelDates ? s('home_during_visit') : tr('Próximos eventos')}
                </Text>
                <Text style={styles.sectionCount}>{featured.length}</Text>
              </View>
              <TouchableOpacity onPress={() => router.push('/(tabs)/agenda' as any)}>
                <Text style={styles.seeAll}>{tr('Ver todos')}</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
              {(() => {
                let evts = featured.filter(e => e.image_url);
                // Visitor with dates: prioritize events during their stay
                if (userProfile.userType === 'visitor' && userProfile.travelDates) {
                  const { start, end } = userProfile.travelDates;
                  const during = evts.filter(e => {
                    const d = (e as any).date_start || e.date || '';
                    return d >= start && d <= end;
                  });
                  const after = evts.filter(e => {
                    const d = (e as any).date_start || e.date || '';
                    return d < start || d > end;
                  });
                  evts = [...during, ...after];
                }
                return evts;
              })().slice(0, 10).map((event) => {
                const cat = CAT_COLORS[event.type] || CAT_COLORS[(event as any).category] || { main: colorForKey(event.type || (event as any).category), bg: colorForKey(event.type || (event as any).category) + '22', label: event.type || (event as any).category || '' };
                const budget = getBudgetStyle(event.is_free, event.price);
                const dateStart = (event as any).date_start || event.date || '';
                const dateEnd = (event as any).date_end || dateStart;
                const todayStr = todayIso();
                const months = ['', 'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
                let dateLabel = '';
                if (dateStart <= todayStr && dateEnd >= todayStr) {
                  dateLabel = tr('HOY');
                } else if (dateStart) {
                  try {
                    const d = new Date(dateStart + 'T00:00:00');
                    dateLabel = `${d.getDate()} ${months[d.getMonth() + 1]}`;
                  } catch { dateLabel = dateStart; }
                }
                return (
                  <TouchableOpacity
                    key={event.event_id || (event as any).id}
                    style={styles.featuredCard}
                    activeOpacity={0.85}
                    onPress={() => {
                      trackEvent('event_click', event.event_id, 'event');
                      router.push(`/event/${event.event_id}` as any);
                    }}
                  >
                    <SafeImage uri={event.image_url} style={styles.featuredImage} resizeMode="cover" />
                    <View style={styles.featuredOverlay} />
                    <View style={styles.featuredBadge}>
                      <Text style={styles.badgeText}>{dateLabel}</Text>
                    </View>
                    <View style={styles.featuredInfo}>
                      <View style={styles.eventTags}>
                        <View style={[styles.tag, { backgroundColor: cat.bg, borderWidth: 1, borderColor: cat.main }]}>
                          <Text style={[styles.tagText, { color: cat.main }]}>{cat.label || event.type || (event as any).category}</Text>
                        </View>
                        <View style={[styles.tag, { backgroundColor: budget.bg, borderWidth: 1, borderColor: budget.main }]}>
                          <Text style={[styles.tagText, { color: budget.main }]}>{budget.label}</Text>
                        </View>
                      </View>
                      <Text style={styles.featuredTitle} numberOfLines={2}>{event.title || (event as any).name_es}</Text>
                      <View style={styles.featuredMeta}>
                        <Ionicons name="location-outline" size={12} color={COLORS.textMuted} />
                        <Text style={styles.metaText} numberOfLines={1}>{event.venue_name || (event as any).venue || ''}</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Static hero fallback — shown when no active season is returned by the API */}
        {seasons.length === 0 && (
          <TouchableOpacity
            style={[styles.heroCard, { width: HERO_WIDTH, marginHorizontal: SPACING.lg, marginBottom: SPACING.md }]}
            activeOpacity={0.9}
            onPress={() => router.push('/(tabs)/agenda')}
          >
            <SafeImage uri={IMAGES.hero} style={styles.heroImage} resizeMode="cover" />
            <View style={[styles.heroOverlay, { backgroundColor: 'rgba(5,8,20,0.55)' }]} />
            <View style={styles.heroContent}>
              <Text style={[styles.heroLabel, { color: COLORS.mustard }]}>CARTAGENA DE INDIAS</Text>
              <Text style={styles.heroTitle}>{tr('Descubre la ciudad')}</Text>
              <Text style={styles.heroSub}>{tr('Gastronomía · Cultura · Vida nocturna · Bienestar')}</Text>
              <View style={[styles.comingSoonBadge, { backgroundColor: COLORS.primary, marginTop: 10 }]}>
                <Text style={styles.comingSoonText}>{tr('EXPLORAR AHORA')}</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}

        {/* Quick Access — moved to top of screen */}

        {/* My Favorites */}
        {favItems.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="heart" size={18} color={COLORS.bougainvillea} />
                <Text style={styles.sectionTitle}>{tr('Mis favoritos')}</Text>
                <View style={styles.favCountBubble}><Text style={styles.favCountText}>{favItems.length}</Text></View>
              </View>
              <TouchableOpacity onPress={() => router.push('/favorites')}>
                <Text style={styles.seeAll}>{tr('Ver todos')}</Text>
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
                    <SafeImage uri={item.image} fallbackUri={IMAGES.placeholder} style={styles.favImage} resizeMode="cover" />
                    <View style={styles.favOverlay} />
                    <View style={styles.favHeartBadge}>
                      <Ionicons name="heart" size={11} color={COLORS.bougainvillea} />
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

        {/* Hoy & Esta noche - Partner Events + Today Events */}
        {(() => {
          // Merge partner events with regular today events for richer content.
          // CONTENT RESILIENCE: todayPEvents has no fallback of its own — on
          // quiet days/launch weeks with 0 live partner-events it is simply
          // []. This merge with todayEvents (which already falls back to
          // upcoming events in fetchData — see `evts.slice(0, 8)` above) is
          // what guarantees these two primary home sections are never a
          // blank gap. Do not remove this merge without preserving that
          // fallback (empty state below still renders a friendly message,
          // never an empty container).
          const allDayItems = [
            ...todayPEvents.filter(e => !isNightTime(e.start_time)),
            ...todayEvents.filter(e => !isNightTime(e.start_time)).map(e => ({
              event_id: e.event_id,
              partner_id: '',
              title: e.title,
              category: e.type,
              date: e.date,
              start_time: e.start_time,
              end_time: e.end_time,
              flyer_url: e.image_url,
              is_free: e.is_free,
              price: e.price,
              partner_name: e.venue_name,
              partner_tier: '',
              partner_image: e.image_url,
            } as PEvent)),
          ];
          const allNightItems = [
            ...todayPEvents.filter(e => isNightTime(e.start_time)),
            ...todayEvents.filter(e => isNightTime(e.start_time)).map(e => ({
              event_id: e.event_id,
              partner_id: '',
              title: e.title,
              category: e.type,
              date: e.date,
              start_time: e.start_time,
              end_time: e.end_time,
              flyer_url: e.image_url,
              is_free: e.is_free,
              price: e.price,
              partner_name: e.venue_name,
              partner_tier: '',
              partner_image: e.image_url,
            } as PEvent)),
          ];
          const dayPE = allDayItems;
          const nightPE = allNightItems;
          const renderPECard = (event: PEvent) => {
            const cat = CAT_COLORS[event.category] || { main: colorForKey(event.category), bg: colorForKey(event.category) + '22', label: event.category };
            const budget = getBudgetStyle(event.is_free, event.price);
            return (
              <TouchableOpacity
                key={event.event_id}
                style={styles.peCard}
                onPress={() => {
                  const isPartnerEvent = !!event.partner_id;
                  trackEvent('event_click', event.event_id, isPartnerEvent ? 'partner_event' : 'event');
                  router.push(isPartnerEvent ? `/partner-event/${event.event_id}` : `/event/${event.event_id}` as any);
                }}
                activeOpacity={0.85}
              >
                <View style={styles.peThumbWrap}>
                  <SafeImage uri={event.flyer_url || event.partner_image} category={event.category} style={styles.peThumb} resizeMode="cover" />
                  <View style={[styles.peTimeChip]}>
                    <Text style={styles.peTimeChipText}>{event.start_time}</Text>
                  </View>
                </View>
                <View style={styles.peBody}>
                  <Text style={styles.peTitle} numberOfLines={2}>{event.title}</Text>
                  {event.partner_name ? (
                    event.partner_id ? (
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
                        <Ionicons name="location-outline" size={11} color={COLORS.textMuted} />
                        <Text style={styles.pePartner} numberOfLines={1}>{event.partner_name}</Text>
                        <Ionicons name="chevron-forward" size={11} color={COLORS.textMuted} />
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.pePartnerBtn}>
                        <Ionicons name="location-outline" size={11} color={COLORS.textMuted} />
                        <Text style={styles.pePartner} numberOfLines={1}>{event.partner_name}</Text>
                      </View>
                    )
                  ) : null}
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
              {/* Qué pasa hoy — cruise users see "Tu día en puerto" */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionTitleRow}>
                    <Ionicons name={userProfile.partyType === 'cruise' ? 'boat' : 'sunny'} size={18} color="#F97316" />
                    <Text style={styles.sectionTitle}>
                      {userProfile.partyType === 'cruise' ? tr('Tu día en puerto') : tr('Qué pasa hoy')}
                    </Text>
                    {dayPE.length > 0 && <Text style={styles.sectionCount}>{dayPE.length}</Text>}
                  </View>
                  <TouchableOpacity onPress={() => router.push('/(tabs)/agenda' as any)}>
                    <Text style={styles.seeAll}>{tr('Ver todos')}</Text>
                  </TouchableOpacity>
                </View>
                {dayPE.length === 0 ? (
                  <View style={styles.emptySlot}>
                    <Ionicons name="cafe-outline" size={26} color={COLORS.textMuted} />
                    <Text style={styles.emptySlotText}>{tr('Sin planes de día por ahora')}</Text>
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
                    <Text style={styles.sectionTitle}>{tr('Qué pasa esta noche')}</Text>
                    {nightPE.length > 0 && <Text style={styles.sectionCount}>{nightPE.length}</Text>}
                  </View>
                  <TouchableOpacity onPress={() => router.push('/(tabs)/agenda' as any)}>
                    <Text style={styles.seeAll}>{tr('Ver todos')}</Text>
                  </TouchableOpacity>
                </View>
                {nightPE.length === 0 ? (
                  <View style={styles.emptySlot}>
                    <Ionicons name="wine-outline" size={26} color={COLORS.textMuted} />
                    <Text style={styles.emptySlotText}>{tr('Sin planes de noche por ahora')}</Text>
                  </View>
                ) : (
                  nightPE.slice(0, 4).map(renderPECard)
                )}
              </View>
            </>
          );
        })()}

        {/* Ofertas del día - Promociones partners (hidden when empty) */}
        {promotions.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="pricetag" size={18} color="#EF4444" />
                <Text style={styles.sectionTitle}>{tr('Ofertas del día')}</Text>
                <Text style={styles.sectionCount}>{promotions.length}</Text>
              </View>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalList}
            >
              {promotions.map((promo) => {
                const cat = CAT_COLORS[promo.category] || { main: colorForKey(promo.category), bg: colorForKey(promo.category) + '22', label: promo.category };
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
                    <SafeImage uri={promo.image_url} category={promo.category} style={styles.promoImage} resizeMode="cover" />
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
          </View>
        )}

        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
      <HomeBaseSheet visible={baseSheet} onClose={() => setBaseSheet(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  greeting: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular },
  headerTitle: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold, marginTop: 2 },
  notifBtn: { width: 44, height: 44, borderRadius: RADIUS.full, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  notifBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.background,
  },
  notifBadgeText: { fontSize: 9, color: '#FFF', ...FONTS.bold, letterSpacing: 0.2 },
  tasteProfileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    backgroundColor: 'rgba(168,85,247,0.08)',
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderWidth: 1,
    borderColor: 'rgba(168,85,247,0.2)',
    gap: SPACING.sm,
  },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: SPACING.lg, marginBottom: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, paddingLeft: SPACING.md, paddingRight: 6, paddingVertical: 6, borderWidth: 1, borderColor: COLORS.border },
  searchTapZone: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, flex: 1, paddingVertical: 6 },
  searchPlaceholder: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular, flex: 1 },
  aiInlineBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: RADIUS.full, backgroundColor: COLORS.primary },
  aiInlineBtnText: { color: COLORS.white, fontSize: 11.5, ...FONTS.bold, letterSpacing: 0.4 },
  // Big AI search hero — the primary tool, elevated with a teal accent (Franck Aug 2026)
  searchHero: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginHorizontal: SPACING.lg, marginBottom: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, paddingLeft: SPACING.sm, paddingRight: SPACING.md, paddingVertical: SPACING.sm + 2, borderWidth: 1.5, borderColor: 'rgba(18,181,165,0.45)' },
  searchHeroIcon: { width: 40, height: 40, borderRadius: RADIUS.full, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  searchHeroText: { fontSize: 16, color: COLORS.textMain, ...FONTS.semibold },
  searchHeroSub: { fontSize: 11.5, color: COLORS.textMuted, ...FONTS.regular, marginTop: 1 },

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
  heroBanner: { marginHorizontal: SPACING.lg, marginBottom: SPACING.md, borderRadius: RADIUS.xl, overflow: 'hidden', height: 180, position: 'relative' },
  heroBannerImage: { width: '100%', height: '100%', position: 'absolute' },
  heroBannerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,10,15,0.5)' },
  heroBannerContent: { flex: 1, justifyContent: 'flex-end', padding: SPACING.lg },
  heroBannerLabel: { fontSize: 10, color: COLORS.mustard, ...FONTS.bold, letterSpacing: 3 },
  heroBannerTitle: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold, marginTop: 4 },
  heroBannerSub: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium, marginTop: 4 },
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
  collCard: { width: 150, padding: SPACING.md, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(251,191,36,0.18)', backgroundColor: 'rgba(251,191,36,0.05)', gap: 6 },
  collIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(251,191,36,0.12)', alignItems: 'center', justifyContent: 'center' },
  collTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold },
  collDesc: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 15 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.lg, marginBottom: SPACING.md },
  sectionTitle: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold },
  seeAll: { fontSize: 13, color: COLORS.primary, ...FONTS.semibold },
  horizontalList: { paddingLeft: SPACING.lg, gap: SPACING.md, paddingRight: SPACING.lg },

  // Favorites carousel
  favCountBubble: { backgroundColor: COLORS.bougainvillea, minWidth: 22, paddingHorizontal: 6, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  favCountText: { color: COLORS.white, fontSize: 11, ...FONTS.bold },
  favCard: { width: 160, height: 200, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1.5, borderColor: COLORS.border, position: 'relative' },
  favImage: { position: 'absolute', width: '100%', height: '100%' },
  favOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,8,20,0.55)' },
  favHeartBadge: { position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.95)', alignItems: 'center', justifyContent: 'center' },
  favTierStripe: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  favInfo: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: SPACING.sm },
  favSubtitle: { fontSize: 9, color: COLORS.icon, ...FONTS.bold, letterSpacing: 0.8 },
  favTitle: { fontSize: 13, color: COLORS.white, ...FONTS.bold, marginTop: 4, lineHeight: 17 },
  featuredCard: { width: 260, height: 200, borderRadius: RADIUS.xl, overflow: 'hidden' },
  featuredImage: { width: '100%', height: '100%', position: 'absolute' },
  featuredOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  featuredBadge: { position: 'absolute', top: SPACING.md, right: SPACING.md, backgroundColor: COLORS.coral, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4 },
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
  tagPaid: { backgroundColor: 'rgba(18,181,165, 0.15)' },
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
  // AI Recommendations
  aiBadge: { backgroundColor: 'rgba(168,85,247,0.15)', borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2 },
  aiBadgeText: { fontSize: 9, color: '#A855F7', ...FONTS.bold, letterSpacing: 1 },
  recCard: { width: 232, height: 244, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  recImage: { width: '100%', height: '100%' },
  recOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: SPACING.sm, backgroundColor: 'rgba(0,0,0,0.55)', gap: 3 },
  recTierBadge: { alignSelf: 'flex-start', borderRadius: RADIUS.full, paddingHorizontal: 6, paddingVertical: 1 },
  recPulseBadge: { alignSelf: 'flex-start', borderRadius: RADIUS.full, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: COLORS.coral, maxWidth: 150 },
  recPulseText: { fontSize: 9, color: '#000000', ...FONTS.bold },
  recTierText: { fontSize: 8, color: '#FFF', ...FONTS.bold, letterSpacing: 0.5 },
  recName: { fontSize: 15, color: '#FFF', ...FONTS.bold, lineHeight: 19 },
  recMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recRating: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  recRatingText: { fontSize: 10, color: COLORS.icon, ...FONTS.semibold },
  recCategory: { fontSize: 10, color: 'rgba(255,255,255,0.7)', ...FONTS.medium, textTransform: 'capitalize' },
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
  photoCard: { width: 140, height: 180, borderRadius: RADIUS.xl, overflow: 'hidden', position: 'relative', borderWidth: 1, borderColor: COLORS.border },
  photoImage: { width: '100%', height: '100%', position: 'absolute' },
  photoOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10,10,15,0.5)' },
  photoContent: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: SPACING.md, gap: 4 },
  photoCatIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(18,181,165,0.3)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  photoLabel: { fontSize: 15, color: COLORS.white, ...FONTS.bold },
  photoSub: { fontSize: 11, color: 'rgba(255,255,255,0.6)', ...FONTS.medium },
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
