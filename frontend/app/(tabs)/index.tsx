// Home — the arrival screen. Launch-ready pass 2026-09-26 (TestFlight 18 verdict:
// "flooded, crowded, freezes, feels dead"). Three rules now govern this file:
//
//  1. FALLBACK-FIRST. Home paints its chrome (greeting, context card, search,
//     quick-access grid) with zero data, and the data sections show a
//     section-level placeholder ONLY until the first paint of that section.
//     A module-scope snapshot (HOME_CACHE) survives remounts — the detail
//     screens' home button does `router.replace('/(tabs)')`, which mounts a
//     fresh HomeScreen; before this pass that fresh instance sat in a
//     full-screen SkeletonList for 8+ s while it re-downloaded everything.
//     There is NO full-screen skeleton and NO early return in this component.
//  2. ONE CATALOG DOWNLOAD. Recommendations, favorites and category counts all
//     read the module-cached static catalog (getPartners) — never `/partners`
//     twice per mount (2 × 1.33 MB on the phone's connection pool).
//  3. HONEST HIERARCHY. Ten modules for a signed-in user, first real plan at
//     y≈400, one context line ("you are far" OR "right now"), sponsors as one
//     slim strip BELOW the app's own tools, and the secondary rails (Para ti,
//     Colecciones, Favoritos, cambio del día) folded under "Más".
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Linking, Platform, useWindowDimensions } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS, TYPE, ELEVATION, TIER_COLORS, Tier, colorForKey } from '../../src/constants/theme';
import { IMAGES, getCategoryImage } from '../../src/constants/images';
import { api, ASSET_ORIGIN } from '../../src/constants/api';
import { useAuth } from '../../src/context/AuthContext';
import { useFavorites } from '../../src/context/FavoritesContext';
import { useLang } from '../../src/context/LanguageContext';
import { monthShort, weekdayShort } from '../../src/lib/formatDate';
import { useTr } from '../../src/i18n/autoTr';
import { SafeImage } from '../../src/components/SafeImage';
import { partnerEventImage } from '../../src/components/PartnerEventCard';
import { SkeletonTileRow } from '../../src/components/Skeleton';
import LoadError from '../../src/components/LoadError';
import { getPartners } from '../../src/lib/data';
import type { Partner } from '../../src/lib/schema';
import { bogotaToday } from '../../src/lib/eventTime';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePersonalization } from '../../src/context/PersonalizationContext';
import { usePartnerCount } from '../../src/context/PartnerCountContext';
import { COLLECTION_DEFS } from '../../src/constants/collections';
import { captureRef, claimPendingRef } from '../../src/lib/referral';
import { PassportGlance } from '../../src/components/PassportGlance';
import { SeasonBanner } from '../../src/components/SeasonBanner';
import { PressableScale } from '../../src/components/PressableScale';
import { FadeInUp } from '../../src/components/FadeInUp';
import { HomeBaseSheet } from '../../src/components/HomeBaseSheet';
import { NowStrip } from '../../src/components/NowStrip';
import { FxStrip } from '../../src/components/FxStrip';
import LockedTease from '../../src/components/LockedTease';
import NearbyEventsCard from '../../src/components/NearbyEventsCard';
import CmwHomeCard from '../../src/components/cmw/CmwHomeCard';
import {
  EventDayRow, EventHeroCard, EventNowCard, FeedEmptyLine, FeedOfflineBanner, umbrellaShortName,
} from '../../src/components/EventFeedUI';
import { geoService, GeoState, cityMode } from '../../src/lib/geo';
import {
  HOME_STATIC_MAX_AGE_H, PublicEvent, bucket, destacados, getCachedFeed, ongoingOrSoon, peekStaticFeed,
  programCount, useEventsFeed,
} from '../../src/lib/eventsFeed';

// ── Quick-access grid geometry — fixed 2×3, no horizontal scroll, no subtitles ──
// Tile WIDTH is computed inside the component from useWindowDimensions: a
// module-scope Dimensions.get('window') saw width 0 during `expo export`, so the
// SSR HTML shipped `width:-22px` tiles (and never re-laid out on rotation).
const GRID_GAP = SPACING.sm;
const GRID_TILE_H = 96;
const GRID_FALLBACK_W = 390; // SSR / first frame before the window reports a width
const gridTileWidth = (windowWidth: number): number =>
  Math.max(64, Math.floor(((windowWidth > 0 ? windowWidth : GRID_FALLBACK_W) - SPACING.lg * 2 - GRID_GAP * 2) / 3));
// §16.2 event rails — widths from the window too (never module-scope Dimensions).
const HERO_H = 220;
const heroWidth = (w: number): number => Math.round(Math.min(320, Math.max(248, (w > 0 ? w : GRID_FALLBACK_W) - 72)));
const nowCardWidth = (w: number): number => Math.round(Math.min(280, Math.max(220, (w > 0 ? w : GRID_FALLBACK_W) * 0.72)));
const HOY_MAX = 4;

// Next occurrence (today included) of a WEEKLY recurring event anchored on the
// weekday of `startIso`, as "YYYY-MM-DD". Noon-UTC arithmetic so the device
// timezone can never shift the weekday (same trick as bogotaDatePlus).
const nextWeeklyOccurrence = (startIso: string, todayIso: string): string => {
  const start = new Date(startIso + 'T12:00:00Z');
  const today = new Date(todayIso + 'T12:00:00Z');
  if (Number.isNaN(start.getTime()) || Number.isNaN(today.getTime())) return startIso;
  if (start > today) return startIso;
  today.setUTCDate(today.getUTCDate() + ((start.getUTCDay() - today.getUTCDay() + 7) % 7));
  return today.toISOString().slice(0, 10);
};

// ── Far-from-Cartagena mode ──────────────────────────────────────────────────
// Phil reviewed build 18 from El Salvador (~1,500 km away): every module assumed
// he was inside the city ("dinnertime", "stamp available now", "1532 km" on
// every tile). Home now says so, once, in one line, and points at /viaje.
// The gate is the SHARED cityMode() from lib/geo (REMOTE_KM = 20) — the same
// one Passport and Partner use, so the tabs never disagree between 20 and
// 50 km. Position comes from geoService only (never a prompt from Home).

// Sponsor rows must carry a signed relationship before Home shows "Con el apoyo
// de": `verified: true`, or a `contract_until` date that has not passed. The
// signed relationships (Phil, 2026-09-25) are sp_001 Avianca, sp_002 Aguila and
// sp_003 Alcaldía de Cartagena — backend startup stamps `verified` on the live
// rows and public/data/sponsors.json mirrors it, so static and live agree. Any
// other row self-hides: a logo or municipal seal without a contract is exactly
// the sponsorship framing the honesty doctrine forbids.
const isVerifiedSponsor = (s: Sponsor, today: string): boolean =>
  s.verified === true || (typeof s.contract_until === 'string' && s.contract_until >= today);

// ── Types ────────────────────────────────────────────────────────────────────
// City events are EVENTS-ELITE PublicEvent rows from the verified feed
// (src/lib/eventsFeed.ts) — never /data/events.json. PEvent = partner-published
// events (live /partner-events only), always labelled "Publicado por <venue>".
type PEvent = {
  event_id: string; partner_id: string; title: string; category: string;
  date: string; start_time: string; end_time: string; flyer_url: string; image_url?: string;
  is_free: boolean; price: number; partner_name?: string; partner_tier?: string;
  partner_image?: string; date_start?: string; date_end?: string;
  recurring?: boolean; recurrence_rule?: string | null;
};

type Sponsor = {
  sponsor_id?: string; name: string; logo_url?: string; tagline?: string;
  color?: string; url?: string; tier?: string;
  /** Signed sponsorship — set on the row once the contract exists. */
  verified?: boolean;
  /** "YYYY-MM-DD" — alternative gate: the strip shows while the contract runs. */
  contract_until?: string;
};

type Promo = {
  promo_id: string; partner_id: string; partner_name?: string; partner_tier?: string;
  category: string; title: string; image_url?: string; tag_label?: string;
  promo_price?: number; original_price?: number; discount_pct?: number; valid_until?: string;
};

// A partner card in the "Para ti" / "Populares" rails — the normalised static
// catalog (id) and the backend /for-you shape (partner_id) both map onto this.
type RecItem = {
  partner_id: string; name: string; category: string; subcategory?: string;
  tier?: string; rating?: number; image_url?: string; cuisine?: string;
  live_pulse?: { title?: string } | null;
};

type FavItem = { kind: 'partner' | 'partner_event'; id: string; title: string; image?: string; subtitle: string; tier?: string };

// Everything the data sections need to paint. Written on every applyData and
// every feed update, read by the state initialisers of the NEXT HomeScreen
// instance (fallback-first across remounts). feedEvents is the last verified
// feed this process saw — bucketed at render time against Bogotá "today".
type HomeSnapshot = { feedEvents: PublicEvent[] | null; todayPEvents: PEvent[]; sponsors: Sponsor[]; promotions: Promo[] };
let HOME_CACHE: HomeSnapshot | null = null;

const toRec = (p: Partner): RecItem => ({
  partner_id: p.id, name: p.name, category: p.category, subcategory: p.subcategory,
  tier: p.tier, rating: p.rating, image_url: p.image_url, cuisine: p.cuisine_type,
});

const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }).catch(() => { clearTimeout(t); resolve(fallback); });
  });

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

const catStyle = (key: string) =>
  CAT_COLORS[key] || { main: colorForKey(key), bg: colorForKey(key) + '22', label: key || '' };

const getBudgetStyle = (isFree: boolean, price: number) => {
  if (isFree) return { main: '#22C55E', bg: 'rgba(34,197,94,0.18)', label: 'GRATIS' };
  // Unpriced paid event ("a consultar") — never render "$0K".
  if (!price) return { main: '#94A3B8', bg: 'rgba(148,163,184,0.18)', label: 'Consultar' };
  if (price <= 30000) return { main: '#3B82F6', bg: 'rgba(59,130,246,0.18)', label: `$${(price / 1000).toFixed(0)}K` };
  if (price <= 80000) return { main: '#F97316', bg: 'rgba(249,115,22,0.18)', label: `$${(price / 1000).toFixed(0)}K` };
  return { main: '#EF4444', bg: 'rgba(239,68,68,0.18)', label: `$${(price / 1000).toFixed(0)}K` };
};

const todayIso = () => bogotaToday(); // Bogota date, not UTC (events must not roll over at 19:00 local)

// Explore categories — exact `category` values explore.tsx filters on
// (p.category === apiValue), so the count Home shows is the count Explore opens.
const EXPLORE_CATS: { uri: string; label: string; cat: string; icon: string }[] = [
  { uri: IMAGES.cartagena_aerial, label: 'Restaurantes', cat: 'restaurant', icon: 'restaurant' },
  { uri: IMAGES.cartagena_streets, label: 'Bares', cat: 'bar', icon: 'wine' },
  { uri: IMAGES.umbrellas, label: 'Nightlife', cat: 'nightlife', icon: 'musical-notes' },
  { uri: IMAGES.fountain_market, label: 'Cafés', cat: 'cafe', icon: 'cafe' },
  { uri: IMAGES.flag_rooftops, label: 'Wellness', cat: 'wellness', icon: 'leaf' },
  { uri: IMAGES.wax_palms, label: 'Experiencias', cat: 'activity', icon: 'compass' },
  { uri: IMAGES.hero, label: 'Hoteles', cat: 'hotel', icon: 'bed' },
  { uri: IMAGES.cartagena_aerial, label: 'Beach Clubs', cat: 'beach_club', icon: 'umbrella' },
];

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { favorites } = useFavorites();
  const { s, lang } = useLang();
  const tr = useTr();
  const { userProfile, getPersonalizedPartners, getGreeting, hasCompletedOnboarding, isLoading: profileLoading } = usePersonalization();
  const partnerCount = usePartnerCount();
  // Window-driven tile width (SSR-safe, rotation-safe) — see gridTileWidth.
  const { width: windowWidth } = useWindowDimensions();
  const gridTileW = gridTileWidth(windowWidth);

  // ── Data sections — seeded from the last instance's snapshot (fallback-first) ──
  const [todayPEvents, setTodayPEvents] = useState<PEvent[]>(() => HOME_CACHE?.todayPEvents ?? []);
  const [promotions, setPromotions] = useState<Promo[]>(() => HOME_CACHE?.promotions ?? []);
  const [sponsors, setSponsors] = useState<Sponsor[]>(() => HOME_CACHE?.sponsors ?? []);
  const [refreshing, setRefreshing] = useState(false);
  // P1-9: the live hydrate (partner-events / sponsors / promotions) failed with
  // nothing to fall back on. This was invisible: the "Qué pasa hoy" rail simply
  // hid its partner events (the CORS-outage symptom of 2026-10-01) and Home read
  // "Nada confirmado hoy". One compact line + retry now sits in that slot.
  const [hydrateError, setHydrateError] = useState(false);
  const [forYouError, setForYouError] = useState(false);

  // ── City events: the verified feed (EVENTS-ELITE §13 J3) ──
  // First paint: HOME_CACHE → getCachedFeed() (inside the hook) → the static
  // mirror when generated ≤ 24 h ago; the live response replaces it. A feed the
  // loader can no longer vouch for (404 / nothing ≤ 36 h) paints NO events.
  const { feed, today: feedToday, error: feedError, reload: reloadFeed } = useEventsFeed();
  const [firstPaint, setFirstPaint] = useState<PublicEvent[] | null>(() => HOME_CACHE?.feedEvents ?? null);
  useEffect(() => {
    if (HOME_CACHE?.feedEvents || getCachedFeed()) return;
    let alive = true;
    peekStaticFeed(HOME_STATIC_MAX_AGE_H)
      .then((p) => { if (alive && p) setFirstPaint((prev) => prev ?? p.events); })
      .catch((e: unknown) => console.error('[Home] static feed', e));
    return () => { alive = false; };
  }, []);
  const feedEvents: PublicEvent[] = useMemo(
    () => (feed ? feed.data.events : feedError ? [] : (firstPaint ?? [])),
    [feed, feedError, firstPaint],
  );
  const feedReady = !!feed || !!feedError || firstPaint !== null;
  const feedOffline = !!feed?.offline;
  // Bogotá "today" only after mount (null in the static export → skeleton, no
  // build-day date in the HTML). A remount with a snapshot may bucket at once.
  const today: string | null = feedToday ?? (HOME_CACHE ? bogotaToday() : null);
  useEffect(() => {
    if (!feed && !feedError) return;
    HOME_CACHE = { feedEvents, todayPEvents, sponsors, promotions };
  }, [feed, feedError, feedEvents, todayPEvents, sponsors, promotions]);
  const [catalog, setCatalog] = useState<Partner[]>([]);
  const [baseSheet, setBaseSheet] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [favItems, setFavItems] = useState<FavItem[]>([]);
  const [unreadNotifs, setUnreadNotifs] = useState<number>(0);
  const [recommendations, setRecommendations] = useState<RecItem[]>([]);
  const [showGuestBanner, setShowGuestBanner] = useState(false);
  const [guestRecommendations, setGuestRecommendations] = useState<RecItem[]>([]);
  const [forYou, setForYou] = useState<RecItem[]>([]);
  const [refMoment, setRefMoment] = useState<string | null>(null);

  // ── Far-mode: subscribe to the shared position, never prompt from Home.
  // The watch itself is armed by <PassportGlance> (focus-scoped, guests too),
  // so with permission already granted the first fix lands before first paint
  // instead of only after another screen happened to start the watch. ──
  const [geo, setGeo] = useState<GeoState>(() => geoService.getState());
  useEffect(() => {
    const unsub = geoService.subscribe(setGeo);
    geoService.syncPermission().then(() => setGeo(geoService.getState())).catch(() => {});
    return unsub;
  }, []);
  const city = useMemo(() => cityMode(geo), [geo]);
  // Denied/unavailable is 'remote' with km=null: no distance to print, so Home
  // keeps the live moment rather than claiming a distance it does not have.
  const farKm = city.mode === 'remote' ? city.km : null;
  const far = farKm !== null;

  // Referral loop (1.5): capture ?ref on arrival; claim once after sign-in.
  // Drop 11 (11C1): the claim is a shared MOMENT — both real names, the real +500.
  useEffect(() => { captureRef(); }, []);
  useEffect(() => {
    if (!user) return;
    claimPendingRef().then((r) => {
      if (r && r.points > 0) {
        setRefMoment(r.referrer
          ? `Vos y ${r.referrer} están explorando Cartagena · +${r.points} puntos para los dos ✨`
          : `¡Bienvenido! +${r.points} puntos por unirte con un código de amigo ✨`);
      }
    }).catch(() => {});
  }, [user]);

  // Taste-engine rail for signed-in users (server-side affinity from
  // favorites + reservations + onboarding). Lives under "Más".
  const forYouAlive = useRef(true);
  const loadForYou = useCallback(() => {
    api.get('/for-you')
      .then((d: { partners?: RecItem[] }) => {
        if (!forYouAlive.current) return;
        if (Array.isArray(d?.partners)) setForYou(d.partners);
        setForYouError(false);
      })
      .catch((e) => {
        if (!forYouAlive.current) return;
        console.error('[Home] /for-you', e);
        setForYouError(true); // last good rail stays; the line shows only when the rail is empty
      });
  }, []);
  useEffect(() => {
    forYouAlive.current = true;
    if (!user) { setForYou([]); setForYouError(false); return; }
    loadForYou();
    return () => { forYouAlive.current = false; };
  }, [user, loadForYou]);

  // Guest personalization banner — show on 2nd visit, dismissible
  useEffect(() => {
    if (user) return;
    (async () => {
      try {
        const visits = parseInt(await AsyncStorage.getItem('@home_visits') || '0', 10);
        await AsyncStorage.setItem('@home_visits', String(visits + 1));
        const dismissed = await AsyncStorage.getItem('@guest_banner_dismissed');
        if (visits >= 1 && !dismissed) setShowGuestBanner(true);
      } catch { /* storage blocked (private mode) — no banner */ }
    })();
  }, [user]);

  // ONE catalog load per app session (module-cached in data.ts). Feeds the
  // category counts, favorites hydration and both recommendation rails.
  useEffect(() => {
    let alive = true;
    withTimeout(getPartners(), 10000, [] as Partner[]).then((ps) => { if (alive) setCatalog(ps); });
    return () => { alive = false; };
  }, []);

  // Honest category counts — derived from the catalog, never typed by hand.
  const catCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of catalog) m[p.category] = (m[p.category] || 0) + 1;
    return m;
  }, [catalog]);

  // Guest personalized recommendations ("Populares") from the cached catalog
  useEffect(() => {
    if (user || !hasCompletedOnboarding || userProfile.interests.length === 0 || catalog.length === 0) {
      setGuestRecommendations([]);
      return;
    }
    setGuestRecommendations(getPersonalizedPartners(catalog.map(toRec)).slice(0, 8));
  }, [user, hasCompletedOnboarding, userProfile.interests.length, catalog, getPersonalizedPartners]);

  // AI-profile recommendations (fallback rail when /for-you is empty)
  useEffect(() => {
    if (!user || catalog.length === 0) { setRecommendations([]); return; }
    let alive = true;
    api.get('/profile/me').then((profileRes: { ai_status?: string; interests?: string[]; persona?: string } | null) => {
      if (!alive || !profileRes || profileRes.ai_status === 'not_built') return;
      const interests = (profileRes.interests || []).map((i: string) => i.toLowerCase());
      const persona = (profileRes.persona || '').toLowerCase();
      const scored = catalog
        .filter((p) => p.tier === 'elite' || p.tier === 'premium' || p.tier === 'gold' || p.tier === 'silver' || (p.rating || 0) >= 4)
        .map((p) => {
          let score = p.rating || 0;
          const cat = (p.category || '').toLowerCase();
          const sub = (p.subcategory || '').toLowerCase();
          if (interests.some((i: string) => cat.includes(i) || sub.includes(i))) score += 3;
          if (persona.includes('foodie') && (cat === 'restaurant' || cat === 'gastronomy')) score += 2;
          if (persona.includes('nightlife') && (cat === 'club' || cat === 'bar' || cat === 'nightlife')) score += 2;
          if (persona.includes('wellness') && (cat === 'spa' || cat === 'wellness')) score += 2;
          if (persona.includes('adventure') && (cat === 'activity' || cat === 'tour')) score += 2;
          if (p.tier === 'gold') score += 1;
          return { rec: toRec(p), score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map((x) => x.rec);
      setRecommendations(scored);
    }).catch((e) => console.error('[Home] /profile/me', e)); // fallback rail only — /for-you owns the error line
    return () => { alive = false; };
  }, [user, catalog]);

  // Check unread notifications once on focus (no polling — eliminates 401 spam)
  useFocusEffect(
    useCallback(() => {
      if (!user) { setUnreadNotifs(0); return; }
      let cancelled = false;
      (async () => {
        try {
          const data = await api.get('/notifications');
          if (cancelled) return;
          const unread = Array.isArray(data) ? data.filter((n: { is_read?: boolean }) => !n.is_read).length : 0;
          setUnreadNotifs(unread);
        } catch { setUnreadNotifs(0); }
      })();
      return () => { cancelled = true; };
    }, [user])
  );

  const fetchData = useCallback(async () => {
    try {
      const today = todayIso();
      // Static-first: paint from /data/*.json, then hydrate from backend.
      // 8 s abort so a stalled request can never pin a placeholder.
      // null = the snapshot did not load (logged) — distinct from a real [].
      const staticFetch = (file: string): Promise<unknown[] | null> => {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 8000);
        return fetch(`${ASSET_ORIGIN}/data/${file}.json`, { signal: ac.signal })
          .then((r) => (r.ok ? r.json() : null))
          .catch((e) => { console.error('[Home] static', file, e); return null; })
          .finally(() => clearTimeout(t));
      };

      // Partner-events must reflect TODAY, never a stale bundled date. An event
      // counts as "today" if today falls in its date window.
      const filterPeToday = (arr: unknown): PEvent[] => (Array.isArray(arr) ? (arr as PEvent[]) : []).filter((e) => {
        const start = e.date_start || e.date || '';
        const end = e.date_end || start;
        return !!e && !!e.event_id && start <= today && end >= today;
      });

      const applyData = (sp: unknown, pe: unknown, promos: unknown) => {
        // Same rules as the backend (/promotions/today: valid_until >= today)
        // so the bundled snapshot can never paint an expired offer as current.
        const spArr = (Array.isArray(sp) ? (sp as Sponsor[]) : []).filter((x) => x && x.name && isVerifiedSponsor(x, today));
        const todayPE = filterPeToday(pe);
        const promosFiltered = (Array.isArray(promos) ? (promos as Promo[]) : []).filter((x) => x && (x.valid_until || '9999-12-31') >= today);
        setSponsors(spArr);
        setTodayPEvents(todayPE);
        setPromotions(promosFiltered);
        HOME_CACHE = { feedEvents: HOME_CACHE?.feedEvents ?? null, todayPEvents: todayPE, sponsors: spArr, promotions: promosFiltered };
      };

      // 1. Instant paint from static data. City events come from the verified
      //    feed (useEventsFeed) — never /data/events.json; partner events are
      //    live-only (a bundled partner-events snapshot could be stale).
      const [staticSponsors, staticPromos] = await Promise.all([
        staticFetch('sponsors'),
        staticFetch('promotions/today'),
      ]);
      applyData(staticSponsors ?? [], HOME_CACHE?.todayPEvents ?? [], staticPromos ?? []);

      // 2. Hydrate from backend in the background (never holds up first paint).
      // Each live dataset wins on its own; an EMPTY live answer must replace the
      // bundled snapshot (no promos today ≠ keep June's promos); null = that
      // call failed → keep static (api.get already tried the swr cache and the
      // public snapshot before rejecting, so a null here is a real outage).
      const liveFail = (path: string) => (e: unknown) => { console.error(`[Home] ${path}`, e); return null; };
      Promise.all([
        api.get('/sponsors').catch(liveFail('/sponsors')),
        api.get(`/partner-events?date=${today}`).catch(liveFail('/partner-events')),
        api.get('/promotions/today').catch(liveFail('/promotions/today')),
      ]).then(([sp, pe, promos]) => {
        const live = (v: unknown, fallback: unknown) => (Array.isArray(v) ? v : fallback);
        applyData(live(sp, staticSponsors ?? []), live(pe, HOME_CACHE?.todayPEvents ?? []), live(promos, staticPromos ?? []));
        // P1-9: static-first sources count as failed only when BOTH copies failed;
        // partner events are live-only, so a null there is always a failure.
        const spFailed = !Array.isArray(sp) && staticSponsors === null;
        const peFailed = !Array.isArray(pe);
        const prFailed = !Array.isArray(promos) && staticPromos === null;
        setHydrateError(spFailed || peFailed || prFailed);
      }).catch((e) => { console.error('[Home] hydrate', e); setHydrateError(true); });
    } catch (e) {
      console.error('[Home] fetchData', e);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Favorites hydration — partners from the cached catalog, partner-events
  // one by one (small numbers). No `/partners` download.
  useEffect(() => {
    if (!favorites || favorites.length === 0) { setFavItems([]); return; }
    let alive = true;
    (async () => {
      const results: FavItem[] = [];
      const partnerIds = favorites.filter((f) => f.item_type === 'partner').map((f) => f.item_id);
      const peIds = favorites.filter((f) => f.item_type === 'partner_event').map((f) => f.item_id);
      if (partnerIds.length > 0) {
        for (const p of catalog) {
          if (partnerIds.includes(p.id)) {
            results.push({ kind: 'partner', id: p.id, title: p.name, image: p.image_url, subtitle: (p.category || '').toUpperCase(), tier: p.tier });
          }
        }
      }
      for (const id of peIds) {
        try {
          const ev = await api.get(`/partner-events/${id}`);
          results.push({ kind: 'partner_event', id, title: ev.title, image: partnerEventImage(ev) ?? undefined, subtitle: `${ev.date} · ${ev.start_time}`, tier: ev.partner?.tier || ev.partner_tier });
        } catch { /* one missing favorite never blanks the rail */ }
      }
      if (alive) setFavItems(results);
    })();
    return () => { alive = false; };
  }, [favorites, catalog]);

  const trackEvent = useCallback((eventType: string, targetId?: string, targetType?: string) => {
    api.post('/analytics/track', { event_type: eventType, target_id: targetId, target_type: targetType }).catch(() => {});
  }, []);

  // ── Quick access — the six tools that matter, fixed 2×3. Everything else
  //    lives in Profile › Acceso rápido. Cruise day: Mapa → Transporte.
  const quickItems = useMemo(() => {
    const items = [
      { key: 'moverse',   icon: 'bus',      label: tr('Moverse'),      color: '#F59E0B',          route: '/ciudad' },
      { key: 'agenda',    icon: 'calendar', label: s('home_agenda'),   color: '#F97316',          route: '/que-pasa' },
      { key: 'explorar',  icon: 'compass',  label: tr('Explorar'),     color: '#3B82F6',          route: '/(tabs)/explore' },
      { key: 'pasaporte', icon: 'ribbon',   label: tr('Pasaporte'),    color: COLORS.primary,     route: '/(tabs)/pasaporte' },
      userProfile.partyType === 'cruise'
        ? { key: 'transporte', icon: 'boat', label: s('home_transport'), color: '#06B6D4',         route: '/transport' }
        : { key: 'mapa',       icon: 'map',  label: tr('Mapa'),          color: COLORS.official,   route: '/(tabs)/mapa' },
      { key: 'base',      icon: 'home',     label: tr('Mi base'),      color: '#8B5CF6',          route: '#base' },
    ];
    return items;
  }, [tr, s, userProfile.partyType]);

  const exploreCats = useMemo(() => {
    const total = partnerCount || catalog.length || 0;
    const all = { uri: IMAGES.hero, label: 'Todo', cat: '', icon: 'apps', count: total };
    let cats = EXPLORE_CATS.map((c) => ({ ...c, count: catCounts[c.cat] || 0 }));
    if (userProfile.isPersonalized && userProfile.interests.length > 0) {
      const prioritized = cats.filter((c) => userProfile.interests.includes(c.cat));
      const rest = cats.filter((c) => !userProfile.interests.includes(c.cat));
      cats = [...prioritized, ...rest];
    }
    return [all, ...cats];
  }, [partnerCount, catalog.length, catCounts, userProfile.isPersonalized, userProfile.interests]);

  const todayStr = todayIso();

  // ── Events on Home (§16.2), in this order, never two empty slots:
  //    1. "Ahora en Cartagena" — only when something is verifiably ongoing or
  //       starts within 3 h (and never when far from the city);
  //    2. "Destacados" — the top 6 by prominence; present while the feed has rows;
  //    3. "Hoy" — today's rows (headline first; umbrellas never, §15 R5) plus
  //       today's partner-published events ("Publicado por <venue>"), or the one
  //       "Nada confirmado hoy · Ver todo →" line.
  // `nowMs` is set after mount and ticks each minute: no clock in the static
  // HTML (#418) and "Empieza a las 20:00" never goes stale while Home is open.
  const [nowMs, setNowMs] = useState<number>(0);
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  const eventsReady = !!today && feedReady;
  const ahora = useMemo(
    () => (today && nowMs && !far ? ongoingOrSoon(feedEvents, nowMs, 3).slice(0, 6) : []),
    [feedEvents, today, nowMs, far],
  );
  const topEvents = useMemo(
    () => (today ? destacados(feedEvents, nowMs || Date.now(), 6) : []),
    [feedEvents, today, nowMs],
  );
  const hoyEvents = useMemo(() => (today ? bucket(feedEvents, 'hoy', today) : []), [feedEvents, today]);
  const hoyPartner = useMemo(
    () => [...todayPEvents].sort((a, b) => (a.start_time || '99:99').localeCompare(b.start_time || '99:99')),
    [todayPEvents],
  );
  const hoyCity = hoyEvents.slice(0, HOY_MAX);
  const hoyPartnerShown = hoyPartner.slice(0, Math.max(0, HOY_MAX - hoyCity.length));
  const hoyCount = hoyEvents.length + hoyPartner.length;
  const feedFailed = !feed && !!feedError && feedEvents.length === 0;
  const umbrellaName = useCallback((ev: PublicEvent): string | null => {
    if (!ev.parent_id) return null;
    const u = feedEvents.find((e) => e.event_id === ev.parent_id && e.is_umbrella);
    return u ? umbrellaShortName(u, lang) : null;
  }, [feedEvents, lang]);
  const heroW = heroWidth(windowWidth);
  const nowW = nowCardWidth(windowWidth);
  const openQuePasa = useCallback(() => { router.push('/que-pasa' as any); }, [router]);
  const openFeedEvent = useCallback((id: string) => {
    trackEvent('event_click', id, 'event');
    router.push(`/event/${id}` as any);
  }, [router, trackEvent]);

  // Partner-published event row — always "Publicado por <venue>", never "verified".
  const renderPECard = (event: PEvent) => {
    const cat = catStyle(event.category);
    const budget = getBudgetStyle(event.is_free, event.price);
    // Chip = when this plan actually happens:
    //   • recurring, occurs today (daily, or weekly on today's weekday) → "HOY 20:00"
    //   • weekly, another weekday                                      → "JUE" (next occurrence)
    //   • one-off today                                                → "20:00"
    // Never the ORIGINAL start date of a recurring series ("18 JUN").
    const dStart = event.date_start || event.date || '';
    const dEnd = event.date_end || dStart;
    const inWindow = !dStart || (dStart <= todayStr && dEnd >= todayStr);
    const rule = event.recurring ? (event.recurrence_rule || 'daily') : null;
    let chip = event.start_time || '';
    if (inWindow && rule) {
      const next = rule === 'weekly' && dStart ? nextWeeklyOccurrence(dStart, todayStr) : todayStr;
      if (next === todayStr) {
        chip = `${tr('HOY')}${event.start_time ? ` ${event.start_time}` : ''}`;
      } else {
        chip = weekdayShort(new Date(next + 'T12:00:00Z').getUTCDay(), lang, true);
      }
    } else if (!inWindow) {
      const d = new Date(dStart + 'T00:00:00');
      chip = Number.isNaN(d.getTime()) ? dStart : `${d.getDate()} ${monthShort(d.getMonth(), lang, true)}`;
    }
    const venue = event.partner_name || tr('el local');
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
          <SafeImage uri={partnerEventImage(event) || event.partner_image} category={event.category} style={styles.peThumb} resizeMode="cover" />
          {!!chip && (
            <View style={styles.peTimeChip}>
              <Text style={styles.peTimeChipText}>{chip}</Text>
            </View>
          )}
        </View>
        <View style={styles.peBody}>
          <Text style={styles.peTitle} numberOfLines={2}>{event.title}</Text>
          <View style={styles.pePartnerRow}>
            <Ionicons name="storefront-outline" size={11} color={COLORS.icon} />
            <Text style={styles.pePartner} numberOfLines={1}>{tr('Publicado por {venue}').replace('{venue}', venue)}</Text>
          </View>
          <View style={styles.peTagsRow}>
            <View style={[styles.peCatBadge, { backgroundColor: cat.bg, borderColor: cat.main }]}>
              <View style={[styles.peCatDot, { backgroundColor: cat.main }]} />
              <Text style={[styles.peCatText, { color: cat.main }]}>{tr(cat.label)}</Text>
            </View>
            <View style={[styles.peBudgetBadge, { backgroundColor: budget.bg, borderColor: budget.main }]}>
              <Text style={[styles.peBudgetText, { color: budget.main }]}>{tr(budget.label)}</Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderRecCard = (p: RecItem, showRating: boolean) => (
    <TouchableOpacity
      key={p.partner_id}
      style={styles.recCard}
      onPress={() => router.push(`/partner/${p.partner_id}` as any)}
      activeOpacity={0.85}
    >
      <SafeImage uri={p.image_url || getCategoryImage(p.category)} style={styles.recImage} category={p.category} />
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
          {showRating && p.rating ? (
            <View style={styles.recRating}>
              <Ionicons name="star" size={10} color={COLORS.mustard} />
              <Text style={styles.recRatingText}>{Number(p.rating).toFixed(1)}</Text>
            </View>
          ) : null}
          <Text style={styles.recCategory} numberOfLines={1}>
            {(p.cuisine || p.subcategory || p.category || '').replace(/_/g, ' ')}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const paraTi: RecItem[] = forYou.length > 0 ? forYou : recommendations;
  const firstName = (user?.name || '').trim().split(' ')[0];
  const greeting = user
    ? `${s('greeting_hi')}, ${firstName}`.replace(/, $/, '')
    : (userProfile.isPersonalized ? tr(getGreeting()) : s('greeting_welcome'));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); reloadFeed(); }} tintColor={COLORS.primary} />}
      >
        {/* 1 · Header — greeting is the headline; the brand is a quiet eyebrow */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>AMO LIFE · CARTAGENA</Text>
            <Text style={styles.greeting} numberOfLines={1}>{greeting}</Text>
          </View>
          <TouchableOpacity testID="notifications-btn" onPress={() => router.push('/notifications')} style={styles.notifBtn} accessibilityRole="button">
            <Ionicons name="notifications-outline" size={22} color={COLORS.textMain} />
            {unreadNotifs > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>{unreadNotifs > 9 ? '9+' : String(unreadNotifs)}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* PassportGlance stays mounted in every mode: it owns the focus-scoped
            geoService.start()/stop() (guests included — the position far-mode
            reads), and it self-gates to null unless a missing stamp is ≤300 m
            away — which is never the case when far. Unmounting it on `far`
            would stop the watch and could oscillate. */}
        <PassportGlance />

        {/* 2 · ONE context line — far from the city, or the live moment. Mutually
            exclusive; SeasonBanner + FxStrip moved under "Más". */}
        {farKm !== null ? (
          <TouchableOpacity
            style={styles.farCard}
            onPress={() => router.push('/viaje' as any)}
            activeOpacity={0.85}
            accessibilityRole="button"
            testID="home-far-banner"
          >
            <View style={styles.farIcon}><Ionicons name="airplane" size={18} color="#000" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.farKicker}>{tr('Lejos de Cartagena').toUpperCase()}</Text>
              <Text style={styles.farCopy} numberOfLines={2}>
                {/* toLocaleString → "1,527 km", the same formatting Partner and Pasaporte print */}
                {tr('Estás a {d} de Cartagena · planea tu viaje desde aquí').replace('{d}', `${farKm.toLocaleString()} km`)}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.official} />
          </TouchableOpacity>
        ) : (
          <NowStrip />
        )}

        {/* Drop 11 (11C1): the reciprocal spark — real names, the real +500 */}
        {refMoment && (
          <TouchableOpacity style={styles.momentCard} onPress={() => setRefMoment(null)} activeOpacity={0.85}>
            <Text style={{ fontSize: 20 }}>🤝</Text>
            <Text style={styles.momentText}>{refMoment}</Text>
          </TouchableOpacity>
        )}

        {/* Guest personalization banner (2nd visit, dismissible) */}
        {showGuestBanner && !hasCompletedOnboarding && (
          <TouchableOpacity
            style={styles.momentCard}
            onPress={() => { setShowGuestBanner(false); router.push('/onboarding' as any); }}
            activeOpacity={0.85}
          >
            <Ionicons name="sparkles" size={20} color="#A855F7" />
            <Text style={[styles.momentText, { color: COLORS.white }]}>{s('home_guest_banner')}</Text>
            <Text style={{ fontSize: 12, color: COLORS.primary, ...FONTS.bold }}>{s('home_guest_banner_cta')}</Text>
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); setShowGuestBanner(false); AsyncStorage.setItem('@guest_banner_dismissed', 'true').catch(() => {}); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={16} color={COLORS.textMuted} />
            </TouchableOpacity>
          </TouchableOpacity>
        )}

        {/* 3 · Search hero — the primary tool (Luna) */}
        <PressableScale
          style={styles.searchHero}
          // ONE Luna (2026-10-07): the home AI bar opens the full conversational
          // concierge (search + chat + recs in one thread), not the one-shot
          // /search card — that split was the audit's "two different Lunas".
          // /search stays reachable from Explore as the catalog tool.
          onPress={() => router.push({ pathname: '/concierge', params: { agent: 'luna' } })}
          haptic
          testID="home-search-hero"
          accessibilityLabel={tr('Buscar en Cartagena con IA…')}
        >
          <View style={styles.searchHeroIcon}>
            <Ionicons name="sparkles" size={20} color={COLORS.white} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.searchHeroText} numberOfLines={1}>{tr('Buscar en Cartagena con IA…')}</Text>
            <Text style={styles.searchHeroSub} numberOfLines={1}>{tr('Pregunta lo que sea — Luna te guía')}</Text>
          </View>
          <Ionicons name="mic-outline" size={20} color={COLORS.textMuted} />
        </PressableScale>

        {/* 4 · Quick access — fixed 2×3 grid, six tools, no subtitles, no scroll */}
        <View style={styles.quickGrid} testID="home-quick-grid">
          {quickItems.map((item) => (
            <PressableScale
              key={item.key}
              testID={`quick-${item.key}`}
              style={[styles.quickTile, { width: gridTileW }]}
              accessibilityLabel={item.label}
              onPress={() => {
                trackEvent('quick_access', item.key, 'navigation');
                if (item.route === '#base') { setBaseSheet(true); return; }
                router.push(item.route as any);
              }}
            >
              <View style={[styles.quickIcon, { backgroundColor: item.color + '26' }]}>
                <Ionicons name={item.icon as any} size={22} color={item.color} />
              </View>
              <Text style={styles.quickLabel} numberOfLines={1}>{item.label}</Text>
            </PressableScale>
          ))}
        </View>

        {/* Proximity offer — opt-in, computed on the phone; never from an offline
            copy and never when far from Cartagena. Returns null unless eligible. */}
        {!!feed && !feedOffline && !far && (
          <View style={styles.nearbyWrap}>
            <NearbyEventsCard events={feed.data.events} />
          </View>
        )}

        {/* Cartagena Music Week (docs/cmw/DESIGN.md §4 Home): promo before the week,
            "Hoy en Music Week" during it, nothing after. Self-contained; ABOVE the
            city events rails and never mixed into them. */}
        <CmwHomeCard />

        {/* 5 · Events (EVENTS-ELITE §16.2): Ahora en Cartagena → Destacados → Hoy.
            Each slot renders only with rows, except Hoy's single honest line, so
            Home never shows two empty slots. Far from the city (planning mode)
            the "now" and "today" slots step aside for Destacados. */}
        {!eventsReady ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="star" size={18} color={COLORS.mustard} />
                <Text style={styles.sectionTitle}>{tr('Destacados')}</Text>
              </View>
            </View>
            <SkeletonTileRow width={heroW} height={HERO_H} count={2} />
          </View>
        ) : (
          <>
            {ahora.length > 0 && (
              <View style={styles.section} testID="home-ahora">
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionTitleRow}>
                    <View style={styles.liveDot} />
                    <Text style={styles.sectionTitle}>{tr('Ahora en Cartagena')}</Text>
                  </View>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.eventRail}>
                  {ahora.map((item) => (
                    <EventNowCard
                      key={item.ev.event_id}
                      item={item}
                      lang={lang}
                      tr={tr}
                      width={nowW}
                      onPress={openFeedEvent}
                      testID={`home-now-${item.ev.event_id}`}
                    />
                  ))}
                </ScrollView>
              </View>
            )}

            {feedOffline && !!feed && (
              <FeedOfflineBanner stamp={feed.data.generated_at} lang={lang} tr={tr} style={styles.feedBanner} />
            )}

            {topEvents.length > 0 && (
              <View style={styles.section} testID="home-destacados">
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionTitleRow}>
                    <Ionicons name="star" size={18} color={COLORS.mustard} />
                    <Text style={styles.sectionTitle}>{tr('Destacados')}</Text>
                  </View>
                  <TouchableOpacity onPress={openQuePasa} style={styles.seeAllBtn} accessibilityRole="button">
                    <Text style={styles.seeAll}>{tr('Ver todos')}</Text>
                  </TouchableOpacity>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.eventRail}
                  decelerationRate="fast"
                  snapToInterval={heroW + 12}
                  snapToAlignment="start"
                >
                  {topEvents.map((ev, i) => (
                    <EventHeroCard
                      key={ev.event_id}
                      ev={ev}
                      lang={lang}
                      tr={tr}
                      offline={feedOffline}
                      width={heroW}
                      height={HERO_H}
                      onPress={openFeedEvent}
                      programCount={ev.is_umbrella && today ? programCount(ev, feedEvents, today) : undefined}
                      priority={i < 2 ? 'high' : 'normal'}
                      testID={`home-hero-${ev.event_id}`}
                    />
                  ))}
                </ScrollView>
              </View>
            )}

            {!far ? (
              <View style={styles.section} testID="home-hoy">
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionTitleRow}>
                    <Ionicons name={userProfile.partyType === 'cruise' ? 'boat' : 'sunny'} size={18} color="#F97316" />
                    <Text style={styles.sectionTitle}>{userProfile.partyType === 'cruise' ? tr('Tu día en puerto') : tr('Qué pasa hoy')}</Text>
                    {hoyCount > 0 && <Text style={styles.sectionCount}>{hoyCount}</Text>}
                  </View>
                  {hoyCount > 0 && (
                    <TouchableOpacity onPress={openQuePasa} style={styles.seeAllBtn} accessibilityRole="button">
                      <Text style={styles.seeAll}>{tr('Ver todos')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {hoyCount > 0 ? (
                  <>
                    <View style={styles.hoyList}>
                      {hoyCity.map((ev) => (
                        <EventDayRow
                          key={ev.event_id}
                          ev={ev}
                          lang={lang}
                          tr={tr}
                          offline={feedOffline}
                          lead="time"
                          partOf={umbrellaName(ev)}
                          onPress={openFeedEvent}
                          testID={`home-event-${ev.event_id}`}
                        />
                      ))}
                      {hoyPartnerShown.map(renderPECard)}
                    </View>
                    {/* P1-9: the partner-published rows (or sponsors/promos) did not
                        load — one line under the rows we DO have, never silence */}
                    {hydrateError && (
                      <LoadError compact message={tr('No se pudo cargar')} retryLabel={tr('reintentar')} onRetry={fetchData} testID="home-hydrate-error" />
                    )}
                  </>
                ) : feedFailed ? (
                  <FeedEmptyLine
                    icon="cloud-offline-outline"
                    text={`${tr('No pudimos cargar la agenda')} ·`}
                    cta={tr('Reintentar')}
                    onPress={reloadFeed}
                    style={styles.emptyLine}
                    testID="home-nothing-today"
                  />
                ) : hydrateError ? (
                  /* P1-9: never "Nada confirmado hoy" when the partner-events call failed */
                  <LoadError compact message={tr('No se pudo cargar')} retryLabel={tr('reintentar')} onRetry={fetchData} testID="home-hydrate-error" />
                ) : (
                  <FeedEmptyLine
                    text={`${tr('Nada confirmado hoy')} ·`}
                    cta={tr('Ver todo →')}
                    onPress={openQuePasa}
                    style={styles.emptyLine}
                    testID="home-nothing-today"
                  />
                )}
              </View>
            ) : (
              <>
                {topEvents.length === 0 && (
                  <View style={styles.section}>
                    <FeedEmptyLine
                      icon={feedFailed ? 'cloud-offline-outline' : 'calendar-clear-outline'}
                      text={`${tr(feedFailed ? 'No pudimos cargar la agenda' : 'Nada confirmado hoy')} ·`}
                      cta={tr(feedFailed ? 'Reintentar' : 'Ver todo →')}
                      onPress={feedFailed ? reloadFeed : openQuePasa}
                      style={styles.emptyLine}
                      testID="home-nothing-today"
                    />
                  </View>
                )}
                {/* Far mode has no "Hoy" slot; the hydrate line (sponsors/promos) still shows once */}
                {hydrateError && (
                  <View style={styles.section}>
                    <LoadError compact message={tr('No se pudo cargar')} retryLabel={tr('reintentar')} onRetry={fetchData} testID="home-hydrate-error" />
                  </View>
                )}
              </>
            )}
          </>
        )}

        {/* 7 · Explorar por categoría — "Todo · 853" replaces the old hero banners;
            counts come from the catalog (honesty: AMO informs, never invents) */}
        <FadeInUp style={styles.section} delay={0}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <Ionicons name="compass" size={18} color={COLORS.icon} />
              <Text style={styles.sectionTitle}>{tr('Explorar')}</Text>
            </View>
            <TouchableOpacity onPress={() => router.push('/(tabs)/explore' as any)} style={styles.seeAllBtn} accessibilityRole="button">
              <Text style={styles.seeAll}>{tr('Ver todo')}</Text>
            </TouchableOpacity>
          </View>
          {profileLoading ? (
            <SkeletonTileRow width={140} height={180} />
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
              {exploreCats.map((item) => (
                <TouchableOpacity
                  key={item.cat || 'all'}
                  style={styles.photoCard}
                  activeOpacity={0.85}
                  onPress={() => router.push(item.cat
                    ? ({ pathname: '/(tabs)/explore', params: { category: item.cat } } as any)
                    : ('/(tabs)/explore' as any))}
                >
                  <SafeImage uri={item.uri} style={styles.photoImage} resizeMode="cover" />
                  <View style={styles.photoOverlay} />
                  <View style={styles.photoContent}>
                    <View style={[styles.photoCatIcon, { backgroundColor: (item.cat ? colorForKey(item.cat) : COLORS.primary) + '4D' }]}>
                      <Ionicons name={item.icon as any} size={16} color={COLORS.white} />
                    </View>
                    <Text style={styles.photoLabel}>{tr(item.label)}</Text>
                    {item.count > 0 && <Text style={styles.photoSub}>{item.count} {tr('lugares')}</Text>}
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </FadeInUp>

        {/* Guests: honest "Populares" + the locked personalized tease */}
        {!user && guestRecommendations.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="flame" size={18} color={COLORS.icon} />
                <Text style={styles.sectionTitle}>{tr('Populares en Cartagena')}</Text>
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
              {guestRecommendations.map((p) => renderRecCard(p, false))}
            </ScrollView>
          </View>
        )}
        {!user && (
          <View style={styles.section}>
            <LockedTease
              action="personalize"
              next="/"
              icon="sparkles"
              title={tr('Tu Cartagena, según Luna')}
              subtitle={tr('Luna elige lugares para ti según tu vibra. Crea tu cuenta gratis y desbloquea los tuyos.')}
              cta={tr('Crear cuenta gratis')}
              minHeight={188}
            >
              <View style={{ flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md }}>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={styles.teaseTile}>
                    <Ionicons name="sparkles" size={22} color="rgba(18,181,165,0.45)" />
                  </View>
                ))}
              </View>
            </LockedTease>
          </View>
        )}

        {/* Cruise day — the one contextual card that earns its slot */}
        {userProfile.partyType === 'cruise' && (
          <TouchableOpacity style={styles.cruiseCard} onPress={() => router.push('/rutas' as any)} activeOpacity={0.85}>
            <Text style={{ fontSize: 26 }}>🚢</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.cruiseTitle}>{tr('4 Horas en Cartagena')}</Text>
              <Text style={styles.cruiseSub} numberOfLines={2}>{tr('El circuito perfecto para tu día de crucero — caminable desde el puerto')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#06B6D4" />
          </TouchableOpacity>
        )}

        {/* 9 · Ofertas del día — partner promotions (hidden when empty) */}
        {promotions.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="pricetag" size={18} color="#EF4444" />
                <Text style={styles.sectionTitle}>{tr('Ofertas del día')}</Text>
                <Text style={styles.sectionCount}>{promotions.length}</Text>
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
              {promotions.map((promo) => {
                const cat = catStyle(promo.category);
                const tierColors = promo.partner_tier ? TIER_COLORS[promo.partner_tier as Tier] : null;
                return (
                  <TouchableOpacity
                    key={promo.promo_id}
                    style={[styles.promoCard, tierColors && { borderColor: tierColors.border }]}
                    activeOpacity={0.85}
                    onPress={() => {
                      api.post(`/promotions/${promo.promo_id}/track-click`).catch(() => {});
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
                      <View style={[styles.promoCatBadge, { backgroundColor: cat.bg, borderColor: cat.main }]}>
                        <View style={[styles.peCatDot, { backgroundColor: cat.main }]} />
                        <Text style={[styles.peCatText, { color: cat.main }]}>{tr(cat.label)}</Text>
                      </View>
                      <Text style={styles.promoTitle} numberOfLines={2}>{promo.title}</Text>
                      <View style={styles.promoPartnerRow}>
                        <Ionicons name="storefront-outline" size={11} color="rgba(255,255,255,0.7)" />
                        <Text style={styles.promoPartnerName} numberOfLines={1}>{promo.partner_name}</Text>
                      </View>
                      <View style={styles.promoBottomRow}>
                        {(promo.promo_price || 0) > 0 ? (
                          <View style={styles.promoPriceRow}>
                            {(promo.original_price || 0) > 0 && promo.original_price !== promo.promo_price && (
                              <Text style={styles.promoOldPrice}>${((promo.original_price || 0) / 1000).toFixed(0)}K</Text>
                            )}
                            <Text style={styles.promoNewPrice}>${((promo.promo_price || 0) / 1000).toFixed(0)}K</Text>
                          </View>
                        ) : (promo.discount_pct || 0) > 0 ? (
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

        {/* 10 · Sponsors — one slim strip, AFTER the app's own tools. No tier
            pill, no rotation; each logo says it leaves the app. SVG logos can't
            render in a native <Image>, so those fall back to the name. */}
        {sponsors.length > 0 && (
          <View style={styles.sponsorStrip} testID="home-sponsors">
            <Text style={styles.sponsorKicker}>{tr('Con el apoyo de')}</Text>
            <View style={styles.sponsorLogos}>
              {sponsors.slice(0, 4).map((sp) => {
                const canRenderLogo = !!sp.logo_url && (Platform.OS === 'web' || !/\.svg(\?|$)/i.test(sp.logo_url));
                return (
                  <TouchableOpacity
                    key={sp.sponsor_id || sp.name}
                    style={styles.sponsorChip}
                    onPress={() => { if (sp.url) Linking.openURL(sp.url).catch(() => {}); }}
                    disabled={!sp.url}
                    activeOpacity={0.7}
                    accessibilityRole="link"
                    accessibilityLabel={sp.name}
                    accessibilityHint={tr('Abre el sitio del patrocinador')}
                  >
                    {canRenderLogo ? (
                      <SafeImage uri={sp.logo_url} category="institutional" style={styles.sponsorLogo} resizeMode="contain" />
                    ) : (
                      <Text style={styles.sponsorName} numberOfLines={1}>{sp.name}</Text>
                    )}
                    {!!sp.url && <Ionicons name="open-outline" size={10} color={COLORS.textFaint} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* 11 · Más — the secondary rails, folded. Their components only mount
            (and only fetch) when opened. */}
        {user && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.moreHeader}
              onPress={() => setMoreOpen((v) => !v)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ expanded: moreOpen }}
              aria-expanded={moreOpen}
              testID="home-more-toggle"
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.moreTitle}>{tr('Más de Cartagena')}</Text>
                <Text style={styles.moreSub} numberOfLines={1}>
                  {tr('Para ti')} · {tr('Colecciones')} · {tr('Mis favoritos')}{favItems.length > 0 ? ` (${favItems.length})` : ''} · {tr('Cambio del día')}
                </Text>
              </View>
              <Ionicons name={moreOpen ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.icon} />
            </TouchableOpacity>

            {moreOpen && (
              <View style={{ marginTop: SPACING.md }}>
                {/* Para ti — one rail: taste engine first, AI profile as fallback.
                    P1-9: a failed /for-you with no fallback rows is a line, not a missing rail. */}
                {(paraTi.length > 0 || forYouError) && (
                  <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                      <View style={styles.sectionTitleRow}>
                        <Ionicons name="sparkles" size={18} color="#A855F7" />
                        <Text style={styles.sectionTitle}>{tr('Para ti')}</Text>
                        <View style={styles.aiBadge}><Text style={styles.aiBadgeText}>AI</Text></View>
                      </View>
                    </View>
                    {paraTi.length > 0 ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
                        {paraTi.map((p) => renderRecCard(p, forYou.length === 0))}
                      </ScrollView>
                    ) : (
                      <LoadError compact message={tr('No se pudo cargar')} retryLabel={tr('reintentar')} onRetry={loadForYou} testID="home-foryou-error" />
                    )}
                  </View>
                )}

                {/* Colecciones — curated occasion collections */}
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <View style={styles.sectionTitleRow}>
                      <Ionicons name="albums" size={18} color={COLORS.icon} />
                      <Text style={styles.sectionTitle}>{tr('Colecciones')}</Text>
                    </View>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
                    {Object.entries(COLLECTION_DEFS).map(([ckey, c]) => (
                      <TouchableOpacity key={ckey} style={styles.collCard} onPress={() => router.push(`/collections/${ckey}` as any)} activeOpacity={0.85}>
                        <View style={styles.collIcon}>
                          <Ionicons name={c.icon as any} size={18} color="#FBBF24" />
                        </View>
                        {/* fr/pt fall back to English, matching the collection detail screen */}
                        <Text style={styles.collTitle} numberOfLines={2}>{lang === 'es' ? c.title_es : c.title_en}</Text>
                        <Text style={styles.collDesc} numberOfLines={2}>{lang === 'es' ? c.desc_es : c.desc_en}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                {/* Mis favoritos */}
                {favItems.length > 0 && (
                  <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                      <View style={styles.sectionTitleRow}>
                        <Ionicons name="heart" size={18} color={COLORS.bougainvillea} />
                        <Text style={styles.sectionTitle}>{tr('Mis favoritos')}</Text>
                        <View style={styles.favCountBubble}><Text style={styles.favCountText}>{favItems.length}</Text></View>
                      </View>
                      <TouchableOpacity onPress={() => router.push('/favorites')} style={styles.seeAllBtn} accessibilityRole="button">
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
                            onPress={() => router.push((item.kind === 'partner' ? `/partner/${item.id}` : `/partner-event/${item.id}`) as any)}
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

                {/* Datos útiles — season stamps + today's exchange rate (each renders nothing without data) */}
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionTitleRow}>
                    <Ionicons name="information-circle-outline" size={18} color={COLORS.icon} />
                    <Text style={styles.sectionTitle}>{tr('Datos útiles')}</Text>
                  </View>
                </View>
                {!far && <SeasonBanner />}
                <FxStrip />
              </View>
            )}
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

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SPACING.md },
  eyebrow: { ...TYPE.overline, color: COLORS.textFaint },
  greeting: { ...TYPE.title2, color: COLORS.textMain, marginTop: 2 },
  notifBtn: { width: 44, height: 44, borderRadius: RADIUS.full, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.hairline },
  notifBadge: {
    position: 'absolute', top: 2, right: 2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: COLORS.background,
  },
  notifBadgeText: { fontSize: 9, color: '#FFF', ...FONTS.bold, letterSpacing: 0.2 },

  // Far-mode context card — official blue: information, not urgency
  // (8-digit hex alphas of COLORS.official: 1A = 10 %, 66 = 40 %)
  farCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: SPACING.lg, marginBottom: SPACING.md,
    padding: SPACING.md, backgroundColor: `${COLORS.official}1A`,
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: `${COLORS.official}66`,
  },
  farIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.official, alignItems: 'center', justifyContent: 'center' },
  farKicker: { fontSize: 9.5, color: COLORS.official, ...FONTS.bold, letterSpacing: 1.2 },
  farCopy: { fontSize: 12.5, color: COLORS.textMain, ...FONTS.semibold, marginTop: 2, lineHeight: 17 },

  // Moment cards (referral spark / guest banner)
  momentCard: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    marginHorizontal: SPACING.lg, marginBottom: SPACING.md,
    backgroundColor: 'rgba(18,181,165,0.12)', borderRadius: RADIUS.lg, padding: SPACING.md,
    borderWidth: 1, borderColor: 'rgba(18,181,165,0.35)',
  },
  momentText: { flex: 1, color: '#FF6B75', fontSize: 13, ...FONTS.semibold },

  // Search hero — the primary tool, teal accent
  searchHero: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginHorizontal: SPACING.lg, marginBottom: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, paddingLeft: SPACING.sm, paddingRight: SPACING.md, paddingVertical: SPACING.sm + 2, borderWidth: 1.5, borderColor: 'rgba(18,181,165,0.45)' },
  searchHeroIcon: { width: 40, height: 40, borderRadius: RADIUS.full, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  searchHeroText: { fontSize: 16, color: COLORS.textMain, ...FONTS.semibold },
  searchHeroSub: { fontSize: 11.5, color: COLORS.textMuted, ...FONTS.regular, marginTop: 1 },

  // Quick access — fixed 2×3 grid
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP, paddingHorizontal: SPACING.lg, marginBottom: SPACING.xl },
  quickTile: {
    height: GRID_TILE_H, borderRadius: RADIUS.lg, // width: gridTileW (inline, window-driven)
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.hairline,
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  quickIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontSize: 13, color: COLORS.textMain, ...FONTS.semibold, letterSpacing: 0.1, paddingHorizontal: 6 },

  // Sections
  section: { marginBottom: SPACING.xl },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.lg, marginBottom: SPACING.md },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { ...TYPE.title3, color: COLORS.textMain },
  sectionCount: { fontSize: 11, color: COLORS.textMuted, ...FONTS.bold, backgroundColor: COLORS.surface, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  seeAll: { ...TYPE.subhead, color: COLORS.primary, ...FONTS.semibold },
  // 44 px target around the 13 px link; the negative margins keep the section
  // header's layout height and the text flush with the section edge.
  seeAllBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, marginRight: -8, marginVertical: -10 },
  horizontalList: { paddingLeft: SPACING.lg, gap: SPACING.md, paddingRight: SPACING.lg },
  // §16 event rails: 12 px between cards; the one-line empty state is never a box.
  eventRail: { paddingLeft: SPACING.lg, gap: 12, paddingRight: SPACING.lg },
  hoyList: { paddingHorizontal: SPACING.lg, gap: 12 },
  emptyLine: { marginHorizontal: SPACING.lg, paddingVertical: 4 },
  liveDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.coral,
    borderWidth: 2, borderColor: `${COLORS.coral}59`, marginHorizontal: 4,
  },
  feedBanner: { marginHorizontal: SPACING.lg, marginBottom: SPACING.md },
  nearbyWrap: { paddingHorizontal: SPACING.lg }, // vertical spacing lives in NearbyEventsCard (null ⇒ no gap)

  // Explore category photo cards
  photoCard: { width: 140, height: 180, borderRadius: RADIUS.xl, overflow: 'hidden', position: 'relative', borderWidth: 1, borderColor: COLORS.border },
  photoImage: { width: '100%', height: '100%', position: 'absolute' },
  photoOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10,10,15,0.5)' },
  photoContent: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: SPACING.md, gap: 4 },
  photoCatIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  photoLabel: { fontSize: 15, color: COLORS.white, ...FONTS.bold },
  photoSub: { fontSize: 11, color: 'rgba(255,255,255,0.6)', ...FONTS.medium },

  // Partner-event rows (inside the Hoy list, which owns the gutter and the 12 px gap)
  peCard: { flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  peThumbWrap: { width: 84, height: 92, position: 'relative' },
  peThumb: { width: '100%', height: '100%' },
  peTimeChip: { position: 'absolute', bottom: 6, left: 6, backgroundColor: 'rgba(5,8,20,0.85)', borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2 },
  peTimeChipText: { fontSize: 10, color: COLORS.white, ...FONTS.bold, letterSpacing: 0.4 },
  peBody: { flex: 1, padding: 10, justifyContent: 'space-between' },
  peTitle: { fontSize: 13, color: COLORS.textMain, ...FONTS.bold, lineHeight: 17 },
  pePartnerRow: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 2 },
  pePartner: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, maxWidth: 180 },
  peTagsRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  peCatBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: RADIUS.full, borderWidth: 1 },
  peCatDot: { width: 6, height: 6, borderRadius: 3 },
  peCatText: { fontSize: 9, ...FONTS.bold, letterSpacing: 0.3 },
  peBudgetBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: RADIUS.full, borderWidth: 1 },
  peBudgetText: { fontSize: 9, ...FONTS.bold, letterSpacing: 0.4 },

  // Recommendation cards (Para ti / Populares)
  aiBadge: { backgroundColor: 'rgba(168,85,247,0.15)', borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2 },
  aiBadgeText: { fontSize: 9, color: '#A855F7', ...FONTS.bold, letterSpacing: 1 },
  recCard: { width: 232, height: 244, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, ...ELEVATION.md },
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
  teaseTile: { width: 150, height: 128, borderRadius: RADIUS.md, backgroundColor: 'rgba(18,181,165,0.09)', borderWidth: 1, borderColor: 'rgba(18,181,165,0.16)', alignItems: 'center', justifyContent: 'center' },

  // Cruise card
  cruiseCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: SPACING.lg, marginBottom: SPACING.xl, padding: SPACING.md, backgroundColor: 'rgba(6,182,212,0.08)', borderRadius: RADIUS.xl, borderWidth: 1, borderColor: 'rgba(6,182,212,0.5)' },
  cruiseTitle: { fontSize: 15, color: COLORS.textMain, ...FONTS.bold },
  cruiseSub: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, marginTop: 2 },

  // Collections
  collCard: { width: 150, padding: SPACING.md, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(251,191,36,0.18)', backgroundColor: 'rgba(251,191,36,0.05)', gap: 6 },
  collIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(251,191,36,0.12)', alignItems: 'center', justifyContent: 'center' },
  collTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold },
  collDesc: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 15 },

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

  // Promo cards
  promoCard: { width: 220, height: 280, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1.5, borderColor: COLORS.border, position: 'relative', backgroundColor: COLORS.surface },
  promoImage: { width: '100%', height: '100%', position: 'absolute' },
  promoOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,8,20,0.55)' },
  promoTierStripe: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  promoDealBadge: { position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#EF4444', paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.full },
  promoDealText: { fontSize: 10, color: COLORS.white, ...FONTS.bold, letterSpacing: 0.4 },
  promoContent: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: SPACING.sm, gap: 5 },
  promoCatBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full, borderWidth: 1, alignSelf: 'flex-start' },
  promoTitle: { fontSize: 14, color: COLORS.white, ...FONTS.bold, lineHeight: 18, marginTop: 2 },
  promoPartnerRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  promoPartnerName: { fontSize: 11, color: 'rgba(255,255,255,0.85)', ...FONTS.medium, flex: 1 },
  promoBottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 4 },
  promoPriceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  promoOldPrice: { fontSize: 11, color: 'rgba(255,255,255,0.55)', ...FONTS.medium, textDecorationLine: 'line-through' },
  promoNewPrice: { fontSize: 17, color: COLORS.primary, ...FONTS.bold },

  // Sponsors — one slim strip below the app's own content
  sponsorStrip: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    marginHorizontal: SPACING.lg, marginBottom: SPACING.xl,
    minHeight: 44, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.hairline,
  },
  sponsorKicker: { ...TYPE.overline, color: COLORS.textFaint },
  sponsorLogos: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  sponsorChip: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 44, paddingHorizontal: 8, borderRadius: RADIUS.full, backgroundColor: COLORS.surfaceAlt },
  sponsorLogo: { width: 22, height: 22, borderRadius: 4 },
  sponsorName: { fontSize: 11, color: COLORS.textMuted, ...FONTS.semibold, maxWidth: 110 },

  // "Más" folded rails
  moreHeader: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    marginHorizontal: SPACING.lg, minHeight: 56, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm + 2,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.hairline,
  },
  moreTitle: { ...TYPE.headline, color: COLORS.textMain },
  moreSub: { ...TYPE.footnote, color: COLORS.textMuted, marginTop: 1 },
});
