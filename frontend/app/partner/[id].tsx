import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, Linking as RNLinking, Platform, Share, ActionSheetIOS } from 'react-native';
import { Alert } from '../../src/lib/alert';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS, TYPE, ELEVATION, PARTNER_CATEGORY_LABELS, TIER_COLORS, Tier, colorForKey } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { TierBadge } from '../../src/components/TierBadge';
import { SafeImage } from '../../src/components/SafeImage';
import { openDirections, MapTarget } from '../../src/lib/maps';
import { PressableScale } from '../../src/components/PressableScale';
import { FadeInUp } from '../../src/components/FadeInUp';
import { LinearGradient } from 'expo-linear-gradient';
import ReviewsList from '../../src/components/ReviewsList';
import { SkeletonPartnerDetail } from '../../src/components/Skeleton';
import LoadError from '../../src/components/LoadError';
import { useLang } from '../../src/context/LanguageContext';
import { useFavorites } from '../../src/context/FavoritesContext';
import { useTr } from '../../src/i18n/autoTr';
import { useLocalPicks } from '../../src/services/localPicks';
import { NBH_LABELS } from '../../src/utils/neighborhood';
import { LoProbe } from '../../src/components/LoProbe';
import { LiveDistance } from '../../src/components/LiveDistance';
import { TrustBadges } from '../../src/components/TrustBadges';
import AddToTrip from '../../src/components/AddToTrip';
import { loadCatalog, brandFamily, CatalogVenue } from '../../src/lib/lunaOffline';
import { hapticLight } from '../../src/lib/haptics';
import { geoService, GeoState, haversineM, fmtDistance, cityMode } from '../../src/lib/geo';
import { getCollections, platesForVenue, PlateDef } from '../../src/lib/passport';
import { bogotaToday } from '../../src/lib/eventTime';
import { goHome, goBackOr } from '../../src/lib/nav';

// Client pre-check for the passport stamp. The server gate is 75 m; we only
// lock the UI when the fix is unambiguously far (GPS noise never locks out
// someone standing at the venue — inside this band the server still decides).
const STAMP_LOCK_M = 250;

// Addresses that carry no information beyond "it is in Cartagena" (85/853
// partners store exactly this) — the tile shows the zone instead.
const GENERIC_ADDR = /^cartagena(\s+de\s+indias)?(,\s*(bol[ií]var,?\s*)?colombia)?\.?$/i;

const DAYS_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
/**
 * 119 partners store Google's 7-day string ("Monday: 8:00 AM – 6:00 PM;
 * Tuesday: …") which a one-third-width tile cannot hold. Collapse it to
 * today's line; curated one-liners ("Lun-Sáb 09:00 - 19:00") pass through.
 */
function todayHoursLine(h: string, todayLabel: string): string {
  if (!/(monday|lunes)\s*:/i.test(h)) return h;
  const parts = h.split(';').map((s) => s.trim()).filter(Boolean);
  // Cartagena's weekday, not the device's: a reader in another timezone near
  // midnight used to get the wrong day's line. Noon local of Bogotá's date
  // cannot cross a date boundary in any timezone.
  const today = DAYS_EN[new Date(bogotaToday() + 'T12:00:00').getDay()];
  const line = parts.find((p) => p.toLowerCase().startsWith(today));
  return line ? line.replace(/^[^:]+:\s*/, `${todayLabel}: `) : parts[0] || h;
}

// Zone values are editorial and occasionally carry a stray ")" ("Puerta 5)").
function cleanZone(z: unknown): string | null {
  const s = String(z || '').trim();
  if (!s) return null;
  return s.includes('(') ? s : s.replace(/\)+$/, '').trim() || null;
}

type StampLockReason = 'denied' | 'remote' | 'near';

/**
 * Remote-mode replacement for <LoProbe>: rendered when the user is far from
 * Cartagena, far from this venue, or has location off. No GPS request, no POST,
 * no spinner, no rate-limit burn — one honest line plus a save-for-later action.
 * Module-level component (never defined inside render — focus/remount rule).
 */
function StampLockedCard({ plates, partnerId, name, reason, km, distM }: {
  plates: PlateDef[]; partnerId: string; name: string; reason: StampLockReason; km: number | null; distM: number | null;
}) {
  const tr = useTr();
  const router = useRouter();
  const icon = reason === 'denied' ? 'locate-outline' : reason === 'remote' ? 'airplane-outline' : 'walk-outline';
  const line = reason === 'denied'
    ? tr('Activa tu ubicación para sellar tu pasaporte')
    : reason === 'remote'
      ? `${(km ?? 0).toLocaleString()} km ${tr('desde Cartagena — sella cuando estés allí')}`
      : `${fmtDistance(distM ?? 0)} — ${tr('Acércate al lugar para sellarlo')}`;
  return (
    <View style={styles.stampBox}>
      <View style={styles.stampHeader}>
        <Ionicons name="ribbon" size={14} color={COLORS.primary} />
        <Text style={styles.stampTitle}>{tr('Sella tu pasaporte')}</Text>
        {/* 11 px link → hitSlop 16 all sides ≈ 45 px target */}
        <TouchableOpacity onPress={() => router.push('/pasaporte' as any)} hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }} accessibilityRole="link">
          <Text style={styles.stampLink}>{tr('Mi Pasaporte')}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.stampPlates}>
        {plates.map((p) => (
          <View key={p.key} style={styles.stampPlate}>
            <Text style={styles.stampPlateText} numberOfLines={1}>{p.name}</Text>
          </View>
        ))}
      </View>
      <View style={styles.stampLockRow}>
        <Ionicons name={icon} size={14} color={COLORS.textMuted} />
        <Text style={styles.stampLockText}>{line}</Text>
      </View>
      <AddToTrip refType="venue" refId={partnerId} name={name} style={styles.stampSave} />
    </View>
  );
}

const TAG_LABELS: Record<string, string> = {
  romantic: 'Romántico', first_date: 'Primera cita', family: 'Familiar',
  kid_friendly: 'Para niños', group_friendly: 'Grupos', business: 'Negocios',
  celebration: 'Celebraciones', sea_view: 'Vista al mar', sunset_view: 'Atardecer',
  rooftop: 'Rooftop', outdoor_terrace: 'Terraza', live_music: 'Música en vivo',
  late_night: 'Hasta tarde', english_friendly: 'Habla inglés', indoor: 'Bajo techo',
  budget: 'Económico', luxury: 'Alta gama', local_favorite: 'Favorito local',
  pet_friendly: 'Pet friendly', healthy: 'Saludable',
};

export default function PartnerDetail() {
  const tr = useTr();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { s } = useLang();
  const { isFavorite, toggleFavorite } = useFavorites();
  const localPicks = useLocalPicks();
  const [partner, setPartner] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  // P1-9: null = the upcoming-events call failed. The calendar then shows a
  // LoadError line instead of "Sin eventos publicados próximamente".
  const [partnerEvents, setPartnerEvents] = useState<any[] | null>([]);
  const [brandSiblings, setBrandSiblings] = useState<CatalogVenue[]>([]);
  const [brandName, setBrandName] = useState('');
  const [reserving, setReserving] = useState(false);

  const fetchEvents = useCallback((): Promise<any[] | null> =>
    api.get(`/partner-events?partner_id=${id}&upcoming=true`)
      .then((e) => (Array.isArray(e) ? e : []))
      .catch((e) => { console.error('[PartnerDetail] upcoming events', e); return null; }),
  [id]);
  const reloadEvents = useCallback(async () => {
    const eData = await fetchEvents();
    // keep the last good list on a failed refresh
    if (eData !== null) setPartnerEvents(eData);
    else setPartnerEvents((prev) => (prev && prev.length > 0 ? prev : null));
  }, [fetchEvents]);

  const loadPartner = async () => {
    setLoading(true);
    setNotFound(false);
    setNetworkError(false);
    try {
      const [pData, eData] = await Promise.all([
        api.get(`/partners/${id}`),
        fetchEvents(),
      ]);
      if (!pData || (Array.isArray(pData) && pData.length === 0)) {
        setNotFound(true);
      } else {
        setPartner(pData);
        setPartnerEvents(eData);
      }
    } catch (e: any) {
      console.error('[PartnerDetail]', e);
      const msg = String(e?.message || '');
      if (msg.includes('404') || msg.includes('not found')) {
        setNotFound(true);
      } else {
        setNetworkError(true);
      }
    }
    setLoading(false);
  };

  useEffect(() => { loadPartner(); }, [id]);

  // Brand family (from the bundled catalog — works offline too). Derive the brand
  // from the catalog by partner_id so it works even if the partner API omits `brand`.
  const pid = partner?.partner_id || (id as string);
  useEffect(() => {
    if (!pid) { setBrandSiblings([]); return; }
    let alive = true;
    loadCatalog()
      .then((cat) => {
        const self = cat.find((v) => v.partner_id === pid);
        const brand = (partner as any)?.brand || self?.brand || '';
        if (alive) { setBrandName(brand); setBrandSiblings(brand ? brandFamily(cat, brand, pid) : []); }
      })
      .catch(() => { if (alive) setBrandSiblings([]); });
    return () => { alive = false; };
  }, [pid]);

  // Remote mode + stamp pre-check: one geo subscription for the whole screen.
  const [geo, setGeo] = useState<GeoState>(geoService.getState());
  useEffect(() => {
    const unsub = geoService.subscribe(setGeo);
    geoService.syncPermission().then(() => setGeo(geoService.getState())).catch(() => {});
    return unsub;
  }, []);
  // The SCREEN arms the focus-scoped watch. It used to rely on <LiveDistance>
  // inside the Location tile, which only mounts when the partner has a zone, a
  // real street address or real coords — 85/853 carry the generic city line and
  // default centre coords, so no fix ever arrived there and a user 1,500 km
  // away got the live "Lo probé" gate instead of the remote card (measured on
  // ptr_R102 from the static fallback). start()/stop() are idempotent on the
  // singleton, so LiveDistance calling them too never double-arms the GPS.
  useFocusEffect(
    useCallback(() => {
      geoService.start();
      return () => geoService.stop();
    }, []),
  );

  // Sabores plates anchored at this venue — drives the locked stamp card when
  // the user cannot be here. getCollections() is memoised in-module, so this
  // costs nothing extra next to LoProbe's own lookup.
  const [plates, setPlates] = useState<PlateDef[]>([]);
  useEffect(() => {
    let alive = true;
    getCollections()
      .then((cols) => { if (alive) setPlates(platesForVenue(cols, String(id))); })
      .catch(() => { if (alive) setPlates([]); });
    return () => { alive = false; };
  }, [id]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <SkeletonPartnerDetail />
      </SafeAreaView>
    );
  }

  if (notFound) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl, gap: SPACING.md }}>
          <Ionicons name="search-outline" size={48} color={COLORS.textMuted} />
          <Text style={{ color: COLORS.textMain, fontSize: 18, ...FONTS.bold, textAlign: 'center' }}>
            {tr('No encontrado')}
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: 14, textAlign: 'center' }}>
            {tr('Este lugar no está disponible')}
          </Text>
          <TouchableOpacity onPress={() => goBackOr(router)} style={{ backgroundColor: COLORS.primary, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md, borderRadius: RADIUS.full, marginTop: SPACING.md }}>
            <Text style={{ color: COLORS.black, ...FONTS.bold }}>{tr('Volver')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (networkError || !partner) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl, gap: SPACING.md }}>
          <Ionicons name="cloud-offline-outline" size={48} color={COLORS.textMuted} />
          <Text style={{ color: COLORS.textMain, fontSize: 18, ...FONTS.bold, textAlign: 'center' }}>
            {tr('Sin conexión')}
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: 14, textAlign: 'center' }}>
            {tr('Verifica tu conexión e intenta de nuevo')}
          </Text>
          <TouchableOpacity onPress={loadPartner} style={{ backgroundColor: COLORS.primary, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md, borderRadius: RADIUS.full, marginTop: SPACING.md }}>
            <Text style={{ color: COLORS.black, ...FONTS.bold }}>{tr('Reintentar')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Robust external link opener:
  //  1. Try the deep link (Instagram app / Google Maps app) → opens native app if installed.
  //  2. Fallback to system browser via WebBrowser (Safari View Controller on iOS),
  //     which works in Expo Go / TestFlight / production build.
  //  3. Final fallback to plain Linking.openURL (web).
  const openExternal = async (deepLink: string | null, webUrl: string) => {
    if (Platform.OS !== 'web' && deepLink) {
      try {
        const can = await RNLinking.canOpenURL(deepLink);
        if (can) {
          await RNLinking.openURL(deepLink);
          return;
        }
      } catch {}
    }
    if (Platform.OS === 'web') {
      window.open(webUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      await WebBrowser.openBrowserAsync(webUrl, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.AUTOMATIC });
    } catch {
      try { await RNLinking.openURL(webUrl); } catch {}
    }
  };

  // Detect if coords are the city-center default (not a real venue location)
  const isDefaultCoords = (lat?: number, lng?: number): boolean => {
    if (!lat || !lng) return true;
    // Default fallback used during import: (10.4220, -75.5482)
    return Math.abs(lat - 10.4220) < 0.005 && Math.abs(lng + 75.5482) < 0.005;
  };

  const hasRealCoords = !isDefaultCoords(partner?.location?.lat, partner?.location?.lng);

  // Location facts: a real street address (never the generic city line), the
  // editorial zone, and where the user is relative to the city + this venue.
  const addrRaw = String(partner.address || '').trim();
  const addrLine = addrRaw && !GENERIC_ADDR.test(addrRaw) ? addrRaw : null;
  const zone = cleanZone(partner.zone);
  const city = cityMode(geo);
  const remote = city.mode === 'remote' && city.km !== null;
  const geoDenied = geo.status === 'denied' || geo.status === 'unavailable';
  const pos = geo.status === 'granted' ? geo.position : null;
  const venueDistM = pos && hasRealCoords ? haversineM(pos.lat, pos.lng, partner.location.lat, partner.location.lng) : null;
  const tooFarForStamp = venueDistM !== null && venueDistM > STAMP_LOCK_M;
  const stampLock: StampLockReason | null = geoDenied ? 'denied' : remote ? 'remote' : tooFarForStamp ? 'near' : null;
  const hoursRaw = typeof partner.hours === 'string' ? partner.hours.trim() : '';

  const openMaps = () => {
    if (!partner) return;
    // Real address first (more reliable than possibly-imprecise imported
    // coords), then real coords, then name-only. openDirections lets iOS users
    // pick Apple Maps or Google Maps (App Store Guideline 4).
    let target: MapTarget;
    if (addrLine) {
      target = { query: `${partner.name}, ${addrLine}, Cartagena` };
    } else if (hasRealCoords) {
      target = { lat: partner.location.lat, lng: partner.location.lng, label: partner.name };
    } else {
      target = { query: `${partner.name}, Cartagena, Colombia` };
    }
    openDirections(target, tr);
  };

  const cleanInstagramHandle = (raw: string): string => {
    if (!raw) return '';
    let h = String(raw).trim();
    // Strip protocol + domain if a full URL was stored
    h = h.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '');
    // Strip leading @
    h = h.replace(/^@+/, '');
    // Strip trailing slash + query
    h = h.replace(/[/?#].*$/, '');
    return h.trim();
  };
  const igHandle = cleanInstagramHandle(partner?.instagram || '');

  const handleReserve = () => {
    try { api.post(`/partners/${id}/track-reserve`).catch(() => {}); } catch {}
    // Always go through the reservation form for the rich WhatsApp template
    // (includes date, time, party size, bilingual message)
    router.push({ pathname: '/reservation/new' as any, params: { partner_id: String(id) } });
  };

  const handleUber = () => {
    const name = encodeURIComponent(partner.name);
    const addrText = (partner.address || '').trim();
    const addr = encodeURIComponent(addrText ? `${addrText}, Cartagena` : `${partner.name}, Cartagena, Colombia`);

    let uberUrl: string;
    let uberWeb: string;

    if (hasRealCoords) {
      // Real coordinates — pass both coords and address for precision
      const lat = partner.location.lat;
      const lng = partner.location.lng;
      uberUrl = `uber://?action=setPickup&pickup=my_location&dropoff[latitude]=${lat}&dropoff[longitude]=${lng}&dropoff[nickname]=${name}&dropoff[formatted_address]=${addr}`;
      uberWeb = `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]=${lat}&dropoff[longitude]=${lng}&dropoff[nickname]=${name}&dropoff[formatted_address]=${addr}`;
    } else {
      // Default coords — omit lat/lng, let Uber geocode from the address
      uberUrl = `uber://?action=setPickup&pickup=my_location&dropoff[nickname]=${name}&dropoff[formatted_address]=${addr}`;
      uberWeb = `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[nickname]=${name}&dropoff[formatted_address]=${addr}`;
    }

    // Far from the city: Uber discards a dropoff outside the pickup region, so
    // the app switch is a dead end. Say so, offer directions instead.
    const now = cityMode(geoService.getState());
    if (now.mode === 'remote' && now.km !== null) {
      const title = tr('Pedir Uber');
      const body = `${now.km.toLocaleString()} km ${tr('desde Cartagena — Uber se activa cuando estés en la ciudad.')}`;
      if (Platform.OS === 'web') {
        try { if (typeof window !== 'undefined') window.alert(`${title}\n\n${body}`); } catch {}
        return;
      }
      Alert.alert(title, body, [
        { text: tr('Ahora no'), style: 'cancel' },
        { text: tr('Cómo llegar'), onPress: openMaps },
      ]);
      return;
    }

    // Never jump straight out of the app: one line of context + a choice.
    const go = () => { openExternal(uberUrl, uberWeb); };
    const message = tr('Se abrirá Uber con este lugar como destino');
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: partner.name, message, options: [tr('Abrir Uber'), tr('Cómo llegar'), tr('Cancelar')], cancelButtonIndex: 2 },
        (i) => { if (i === 0) go(); else if (i === 1) openMaps(); },
      );
      return;
    }
    if (Platform.OS === 'android') {
      Alert.alert(partner.name, message, [
        { text: tr('Cancelar'), style: 'cancel' },
        { text: tr('Cómo llegar'), onPress: openMaps },
        { text: tr('Abrir Uber'), onPress: go },
      ]);
      return;
    }
    go(); // web: m.uber.com opens in a new tab, the browser is the confirmation
  };

  const handleShare = async () => {
    const cat = PARTNER_CATEGORY_LABELS[partner.category] || partner.category || '';
    const appUrl = process.env.EXPO_PUBLIC_APP_URL || 'https://amocartagena.co';
    const url = `${appUrl}/partner/${partner.partner_id}`;
    try {
      await Share.share({
        message: `${partner.name} — ${cat} ${tr('en Cartagena')}\n${partner.rating ? `⭐ ${Number(partner.rating).toFixed(1)}` : ''} ${partner.price_range || ''}\n\n${partner.description || ''}\n\n${url}`,
        url,
        title: partner.name,
      });
    } catch {}
  };

  const handleCall = () => {
    const phone = (partner.phone || '').replace(/[^\d+]/g, '');
    if (phone) {
      RNLinking.openURL(`tel:${phone}`);
    }
  };

  const formatShortDate = (iso: string) => {
    try {
      const d = new Date(iso + 'T12:00:00');
      const days = [tr('Dom'), tr('Lun'), tr('Mar'), tr('Mié'), tr('Jue'), tr('Vie'), tr('Sáb')];
      const months = [tr('Ene'), tr('Feb'), tr('Mar'), tr('Abr'), tr('May'), tr('Jun'), tr('Jul'), tr('Ago'), tr('Sep'), tr('Oct'), tr('Nov'), tr('Dic')];
      return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
    } catch { return iso; }
  };
  // Only called for NON-free events (is_free is checked before this), so a
  // missing/0 price means "no public price" (a consultar), NOT free.
  const formatPrice = (p: number | undefined | null) => !p ? tr('Consultar') : `$${(p / 1000).toFixed(0)}K`;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <SafeImage uri={partner.hero_photo || `/images/partners/${partner.partner_id || id}.jpg`} fallbackUri={`/images/partners/${partner.partner_id || id}.jpg`} category={partner.category} style={styles.heroImage} />
          <LinearGradient
            colors={['transparent', 'rgba(8,12,22,0.55)', COLORS.background]}
            locations={[0, 0.55, 1]}
            style={styles.heroOverlay}
            pointerEvents="none"
          />
          <View style={{ flexDirection: 'row', position: 'absolute', top: SPACING.md, left: SPACING.md, gap: 8, zIndex: 5 }}>
            <TouchableOpacity testID="partner-back-btn" style={styles.navBtn} onPress={() => goBackOr(router)}>
              <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
            </TouchableOpacity>
            {/* goHome reveals the live tab navigator (dismiss modals + navigate);
                replace('/(tabs)') rebuilt it and Home came back as a skeleton. */}
            <TouchableOpacity style={styles.navBtn} onPress={() => goHome(router)}>
              <Ionicons name="home-outline" size={20} color={COLORS.textMain} />
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', position: 'absolute', top: SPACING.md, right: SPACING.md, gap: 8, zIndex: 5 }}>
            <AddToTrip refType="venue" refId={partner.partner_id} name={partner.name} compact />
            <TouchableOpacity style={styles.navBtn} onPress={handleShare} accessibilityLabel={tr('Compartir')}>
              <Ionicons name="share-outline" size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              testID="partner-fav-btn"
              style={[styles.heartBtn, isFavorite(partner.partner_id) && styles.heartBtnActive]}
              onPress={() => { hapticLight(); toggleFavorite(partner.partner_id, 'partner'); }}
              activeOpacity={0.7}
              hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}
            >
              <Ionicons
                name={isFavorite(partner.partner_id) ? 'heart' : 'heart-outline'}
                size={22}
                color={isFavorite(partner.partner_id) ? '#EF4444' : '#FFFFFF'}
              />
            </TouchableOpacity>
          </View>
          {partner.is_certified && (
            <View style={styles.sealBadge}>
              <Ionicons name="shield-checkmark" size={16} color={COLORS.official} />
              <Text style={styles.sealText}>{tr('PARTNER CERTIFICADO')}</Text>
            </View>
          )}
          <FadeInUp style={styles.heroBottom} distance={22}>
            <View style={styles.heroBadgeRow}>
              <View style={[styles.catBadge, { backgroundColor: colorForKey(partner.category || partner.subcategory) }]}>
                <Text style={styles.catText}>{tr(PARTNER_CATEGORY_LABELS[partner.category] || partner.category)}</Text>
              </View>
              <TierBadge tier={partner.tier} size="sm" />
              {partner.rating ? (
                <View style={styles.ratingBadge}>
                  <Ionicons name="star" size={12} color={COLORS.mustard} />
                  <Text style={styles.ratingBadgeText}>{Number(partner.rating).toFixed(1)}</Text>
                  {partner.reviews ? <Text style={styles.ratingBadgeCount}>({partner.reviews})</Text> : null}
                </View>
              ) : null}
            </View>
            <Text style={styles.heroTitle}>{partner.name}</Text>
          </FadeInUp>
        </View>

        <View style={styles.body}>
          {partner.live_pulse?.title ? (
            <View style={styles.pulseBanner}>
              <View style={styles.pulseBadge}><Text style={styles.pulseBadgeText}>{tr('HOY')}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.pulseTitle}>{partner.live_pulse.title}</Text>
                {partner.live_pulse.details ? <Text style={styles.pulseDetails} numberOfLines={2}>{partner.live_pulse.details}</Text> : null}
              </View>
              <Ionicons name="flash" size={18} color="#FBBF24" />
            </View>
          ) : null}
          {partner.tier && TIER_COLORS[partner.tier as Tier] ? (
            <View style={[styles.tierCallout, { backgroundColor: TIER_COLORS[partner.tier as Tier].bg, borderColor: TIER_COLORS[partner.tier as Tier].border }]}>
              <Ionicons
                name={partner.tier === 'elite' ? 'diamond' : partner.tier === 'premium' ? 'star' : 'leaf'}
                size={20}
                color={TIER_COLORS[partner.tier as Tier].main}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.tierCalloutTitle, { color: TIER_COLORS[partner.tier as Tier].main }]}>
                  {s(`tier_${partner.tier}`)}
                </Text>
                <Text style={styles.tierCalloutDesc}>{s(`tier_${partner.tier}_desc`)}</Text>
              </View>
            </View>
          ) : null}
          {(() => {
            const pick = localPicks.byId.get(partner.partner_id);
            if (!pick) return null;
            const beh = pick.source === 'behavioral' && typeof pick.local_count === 'number' && pick.local_count > 0;
            const barrio = pick.neighborhood ? (NBH_LABELS[pick.neighborhood] || null) : null;
            return (
              <View style={styles.localCallout}>
                <Ionicons name="home" size={18} color={COLORS.bougainvillea} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.localCalloutTitle}>
                    {tr('Favorito local')}{barrio ? ` · ${barrio}` : ''}
                  </Text>
                  <Text style={styles.localCalloutDesc}>
                    {beh
                      ? `${pick.local_count} ${tr('locales lo aman')}`
                      : tr('Donde comen los cartageneros, no los tours')}
                  </Text>
                </View>
              </View>
            );
          })()}
          {partner.description ? <Text style={styles.description}>{partner.description}</Text> : null}
          {Array.isArray(partner.tags) && partner.tags.some((t: string) => TAG_LABELS[t]) ? (
            <View style={styles.tagRow}>
              {partner.tags.filter((t: string) => TAG_LABELS[t]).map((t: string) => (
                <View key={t} style={styles.tagChip}><Text style={styles.tagChipText}>{tr(TAG_LABELS[t])}</Text></View>
              ))}
            </View>
          ) : null}
          {Array.isArray(partner.photos) && partner.photos.length > 0 ? (
            <View style={styles.galleryBox}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.galleryRow}>
                {partner.photos.map((ph: string, i: number) => (
                  <SafeImage key={i} uri={ph} category={partner.category} style={styles.galleryImg} resizeMode="cover" />
                ))}
              </ScrollView>
            </View>
          ) : null}
          <TrustBadges partner={partner} />

          {Array.isArray(partner.signature_dishes) && partner.signature_dishes.length > 0 ? (
            <View style={styles.sigBox}>
              <View style={styles.sigHeader}>
                <Ionicons name="restaurant" size={14} color="#FBBF24" />
                <Text style={styles.sigTitle}>{tr('Especialidades de la casa')}</Text>
              </View>
              {partner.signature_dishes.map((d: string) => (
                <View key={d} style={styles.sigRow}>
                  <Text style={styles.sigBullet}>·</Text>
                  <Text style={styles.sigText}>{d}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Walking Layer: plate check-in — renders only for Sabores venues.
              Far from the venue / city, or location off → the locked card
              (no GPS request, no POST, no spinner). In range → the live gate. */}
          {plates.length > 0 && stampLock ? (
            <StampLockedCard
              plates={plates}
              partnerId={String(id)}
              name={partner.name}
              reason={stampLock}
              km={city.km}
              distM={venueDistM}
            />
          ) : (
            <LoProbe
              partnerId={String(id)}
              venueLat={hasRealCoords ? partner.location.lat : null}
              venueLng={hasRealCoords ? partner.location.lng : null}
            />
          )}

          <View style={styles.infoGrid}>
            {zone || addrLine || hasRealCoords ? (
              <TouchableOpacity style={styles.infoCard} onPress={openMaps} activeOpacity={0.7} accessibilityLabel={tr('Cómo llegar')}>
                <Ionicons name="location-outline" size={20} color={COLORS.icon} />
                <Text style={styles.infoLabel}>{tr('Ubicación')}</Text>
                <Text style={styles.infoValue} numberOfLines={1}>{zone || tr('Cartagena')}</Text>
                {addrLine ? <Text style={styles.infoSub} numberOfLines={2}>{addrLine}</Text> : null}
                {remote ? (
                  <Text style={styles.infoFar}>✈ {(city.km ?? 0).toLocaleString()} km</Text>
                ) : (
                  <LiveDistance lat={partner.location?.lat} lng={partner.location?.lng} />
                )}
                <Ionicons name="navigate-outline" size={14} color={COLORS.textMuted} style={{ marginTop: 4 }} />
              </TouchableOpacity>
            ) : null}
            {partner.price_range ? (
              <View style={styles.infoCard}>
                <Ionicons name="cash-outline" size={20} color={COLORS.icon} />
                <Text style={styles.infoLabel}>{tr('Rango de precio')}</Text>
                <Text style={styles.infoValue}>{partner.price_range}</Text>
              </View>
            ) : null}
            {hoursRaw ? (
              <View style={styles.infoCard}>
                <Ionicons name="time-outline" size={20} color={COLORS.icon} />
                <Text style={styles.infoLabel}>{tr('Horario')}</Text>
                <Text style={styles.infoValue} numberOfLines={3}>{todayHoursLine(hoursRaw, tr('Hoy'))}</Text>
              </View>
            ) : null}
          </View>

          {/* Partner-submitted price — DROP B2. Untrusted, unverified, and
              visually + textually distinct from TrustBadges' editorial
              "Precio de referencia" badge above. Never styled as official. */}
          {partner.partner_price?.typical_cop ? (
            <View style={styles.partnerPriceBox}>
              <Ionicons name="information-circle-outline" size={14} color={COLORS.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={styles.partnerPriceLabel}>
                  {tr('Precio informado por el negocio')}
                  <Text style={styles.partnerPriceHedge}> · {tr('sin verificar')}</Text>
                </Text>
                <Text style={styles.partnerPriceValue}>
                  {partner.partner_price.typical_cop.low != null && partner.partner_price.typical_cop.high != null
                    ? `COP ${Number(partner.partner_price.typical_cop.low).toLocaleString('es-CO')}–${Number(partner.partner_price.typical_cop.high).toLocaleString('es-CO')}`
                    : (partner.partner_price.label || '')}
                </Text>
                {!!partner.partner_price.label && partner.partner_price.typical_cop.low != null ? (
                  <Text style={styles.partnerPriceNote}>{partner.partner_price.label}</Text>
                ) : null}
              </View>
            </View>
          ) : null}

          {partner.experience ? (
            <View style={styles.expSection}>
              <Text style={styles.sectionTitle}>{tr('Experiencia')}</Text>
              <Text style={styles.expText}>{partner.experience}</Text>
            </View>
          ) : null}

          {/* Instagram */}
          {igHandle ? (
            <TouchableOpacity
              testID="partner-instagram-btn"
              style={styles.instagramBtn}
              onPress={() => openExternal(`instagram://user?username=${igHandle}`, `https://www.instagram.com/${igHandle}/`)}
              activeOpacity={0.85}
            >
              <Ionicons name="logo-instagram" size={20} color={COLORS.icon} />
              <View style={{ flex: 1 }}>
                <Text style={styles.instagramLabel}>{tr('Síguelos en Instagram')}</Text>
                <Text style={styles.instagramHandle}>@{igHandle}</Text>
              </View>
              <Ionicons name="open-outline" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          ) : null}

          {/* Calendar of upcoming events — no events → one 44 px row that
              points at the agenda instead of an empty box with a title.
              P1-9: a FAILED call is a LoadError line, never "Sin eventos publicados". */}
          {partnerEvents === null ? (
            <LoadError compact style={{ paddingHorizontal: 0 }} message={tr('No se pudo cargar')} retryLabel={tr('reintentar')} onRetry={reloadEvents} testID="partner-events-error" />
          ) : partnerEvents.length === 0 ? (
            <TouchableOpacity style={styles.inlineCta} onPress={() => router.push('/(tabs)/agenda' as any)} activeOpacity={0.8}>
              <Ionicons name="calendar-outline" size={14} color={COLORS.textMuted} />
              <Text style={styles.inlineCtaText} numberOfLines={1}>{tr('Sin eventos publicados próximamente')} · {tr('Ver agenda')}</Text>
              <Ionicons name="chevron-forward" size={14} color={COLORS.textMuted} />
            </TouchableOpacity>
          ) : (
          <View style={styles.calendarSection}>
            <View style={styles.calendarHeader}>
              <Ionicons name="calendar" size={16} color={COLORS.icon} />
              <Text style={styles.sectionTitle}>{tr('Próximos eventos')}</Text>
              <View style={styles.calendarCount}>
                <Text style={styles.calendarCountText}>{partnerEvents.length}</Text>
              </View>
            </View>
            {(
              partnerEvents.slice(0, 6).map((ev: any) => (
                <TouchableOpacity
                  key={ev.event_id}
                  style={styles.calendarItem}
                  onPress={() => router.push(`/partner-event/${ev.event_id}`)}
                  activeOpacity={0.85}
                >
                  <SafeImage uri={ev.flyer_url} category={ev.category} style={styles.calendarFlyer} />
                  <View style={styles.calendarItemBody}>
                    <Text style={styles.calendarItemDate}>{formatShortDate(ev.date)} · {ev.start_time}</Text>
                    <Text style={styles.calendarItemTitle} numberOfLines={1}>{ev.title}</Text>
                    <View style={styles.calendarItemFooter}>
                      <View style={[styles.calendarPriceTag, ev.is_free ? styles.calendarFree : styles.calendarPaid]}>
                        <Text style={styles.calendarPriceText}>{ev.is_free ? tr('GRATIS') : formatPrice(ev.price)}</Text>
                      </View>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                </TouchableOpacity>
              ))
            )}
          </View>
          )}
        </View>
        {/* Brand family — other outlets of this brand (e.g. Casa Bohème → its venues) */}
        {brandSiblings.length > 0 && (
          <View style={{ paddingHorizontal: SPACING.md, marginTop: SPACING.lg }}>
            <Text style={styles.sectionTitle}>{tr('Más de')} {brandName}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACING.sm, paddingRight: SPACING.md }}>
              {brandSiblings.map((v) => (
                <TouchableOpacity key={v.partner_id} style={styles.brandCard} onPress={() => router.push(`/partner/${v.partner_id}` as any)} activeOpacity={0.85}>
                  {/* A blank `image` means the catalog has NO photo for this outlet
                      (scripts/prune-missing-images.mjs): go straight to the category
                      placeholder instead of 404-ing on /images/partners/<id>.jpg. */}
                  <SafeImage uri={v.image || null} category={v.category} style={styles.brandImg} />
                  <Text style={styles.brandName} numberOfLines={1}>{v.name.replace(` — ${brandName}`, '').replace(`${brandName} — `, '')}</Text>
                  <Text style={styles.brandKind} numberOfLines={1}>{v.display_es || PARTNER_CATEGORY_LABELS[v.category] || v.category}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
        {/* Reviews Section */}
        {partner?.partner_id && (
          <View style={{ paddingHorizontal: SPACING.md, marginTop: SPACING.lg }}>
            <ReviewsList partnerId={partner.partner_id} />
          </View>
        )}

        {/* "Is this your business?" — entry point into the existing claim flow
            (find → claim → verify → activate → dashboard). Hidden once verified.
            Franck Aug 2026: partners need a discoverable way to claim their profile. */}
        {partner?.partner_id && (partner as any).claim_status !== 'verified_owner' && (
          <TouchableOpacity
            style={styles.claimCta}
            onPress={() => router.push(`/business/claim/${partner.partner_id}` as any)}
            activeOpacity={0.85}
          >
            <View style={styles.claimIcon}>
              <Ionicons name="pricetag" size={18} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.claimTitle}>{tr('¿Es tu negocio?')}</Text>
              <Text style={styles.claimSub}>{tr('Reclámalo y gestiona tu perfil, eventos y promociones')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <View style={styles.bottomBar}>
        {/* Icon circles carry a caption so every tap target is obvious. */}
        <View style={styles.actionWrap}>
          <PressableScale style={styles.actionCircle} onPress={handleUber} accessibilityLabel={tr('Pedir Uber')}>
            <Ionicons name="car" size={20} color={COLORS.textMain} />
          </PressableScale>
          <Text style={styles.actionCaption}>Uber</Text>
        </View>
        <View style={styles.actionWrap}>
          <PressableScale style={styles.actionCircle} onPress={openMaps} accessibilityLabel={tr('Cómo llegar')}>
            <Ionicons name="navigate" size={20} color={COLORS.textMain} />
          </PressableScale>
          <Text style={styles.actionCaption}>{tr('Mapa')}</Text>
        </View>
        {partner.phone ? (
          <View style={styles.actionWrap}>
            <PressableScale style={styles.actionCircle} onPress={handleCall} accessibilityLabel={tr('Llamar')}>
              <Ionicons name="call" size={20} color={COLORS.textMain} />
            </PressableScale>
            <Text style={styles.actionCaption}>{tr('Llamar')}</Text>
          </View>
        ) : null}
        <PressableScale
          containerStyle={{ flex: 1 }}
          style={[styles.bookBtn, reserving && { opacity: 0.6 }]}
          onPress={handleReserve}
          disabled={reserving}
          accessibilityLabel={tr('Reservar')}
          haptic
        >
          {reserving ? (
            <ActivityIndicator size="small" color={COLORS.black} />
          ) : (
            <>
              <Ionicons name="logo-whatsapp" size={18} color={COLORS.black} />
              <Text style={styles.bookText}>{tr('Reservar')}</Text>
            </>
          )}
        </PressableScale>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  hero: { height: 280, position: 'relative' },
  heroImage: { width: '100%', height: '100%' },
  brandCard: { width: 150 },
  brandImg: { width: 150, height: 100, borderRadius: RADIUS.lg, backgroundColor: COLORS.surface },
  brandName: { fontSize: 13, color: COLORS.textMain, ...FONTS.semibold, marginTop: 6 },
  brandKind: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginTop: 1 },
  galleryBox: { marginTop: SPACING.md },
  galleryRow: { gap: SPACING.sm, paddingRight: SPACING.sm },
  galleryImg: { width: 150, height: 110, borderRadius: RADIUS.lg, backgroundColor: COLORS.surface },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,8,20,0.4)' },
  backBtn: { position: 'absolute', top: SPACING.md, left: SPACING.md, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(5,8,20,0.6)', alignItems: 'center', justifyContent: 'center' },
  navBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(5,8,20,0.6)', alignItems: 'center', justifyContent: 'center' },
  heartBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(5,8,20,0.7)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heartBtnActive: {
    backgroundColor: 'rgba(239,68,68,0.18)',
    borderColor: '#EF4444',
  },
  sealBadge: { position: 'absolute', top: SPACING.md + 56, right: SPACING.md, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(5,8,20,0.85)', borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: COLORS.official },
  sealText: { fontSize: 10, color: COLORS.official, ...FONTS.bold, letterSpacing: 1 },
  claimCta: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginHorizontal: SPACING.md, marginTop: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: 'rgba(18,181,165,0.4)' },
  claimIcon: { width: 36, height: 36, borderRadius: RADIUS.full, backgroundColor: 'rgba(18,181,165,0.12)', alignItems: 'center', justifyContent: 'center' },
  claimTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold },
  claimSub: { fontSize: 11.5, color: COLORS.textMuted, ...FONTS.regular, marginTop: 1 },
  heroBottom: { position: 'absolute', bottom: SPACING.lg, left: SPACING.lg, right: SPACING.lg },
  heroBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, flexWrap: 'wrap' },
  catBadge: { alignSelf: 'flex-start', backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 4 },
  catText: { fontSize: 10, color: COLORS.white, ...FONTS.bold, letterSpacing: 1, textTransform: 'uppercase' },
  heroTitle: { ...TYPE.title1, fontSize: 32, lineHeight: 37, color: COLORS.textMain, marginTop: SPACING.sm },
  body: { padding: SPACING.lg },
  sigBox: { backgroundColor: 'rgba(251,191,36,0.05)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.18)', borderRadius: RADIUS.lg, padding: SPACING.md, marginTop: SPACING.md, gap: 4 },
  sigHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  sigTitle: { fontSize: 13, color: '#FBBF24', ...FONTS.bold },
  sigRow: { flexDirection: 'row', gap: 8 },
  sigBullet: { fontSize: 13, color: '#FBBF24' },
  sigText: { flex: 1, fontSize: 13, color: COLORS.textMain, ...FONTS.regular },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tagChip: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  tagChipText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
  pulseBanner: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.md, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(251,191,36,0.35)', backgroundColor: 'rgba(251,191,36,0.08)', marginBottom: SPACING.md },
  pulseBadge: { backgroundColor: '#FBBF24', borderRadius: RADIUS.sm, paddingHorizontal: 8, paddingVertical: 3 },
  pulseBadgeText: { fontSize: 10, color: '#000000', ...FONTS.bold, letterSpacing: 1 },
  pulseTitle: { fontSize: 14, color: '#FBBF24', ...FONTS.bold },
  pulseDetails: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },
  tierCallout: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.md, borderRadius: RADIUS.lg, borderWidth: 1, marginBottom: SPACING.md },
  tierCalloutTitle: { fontSize: 14, ...FONTS.bold, letterSpacing: 0.5 },
  tierCalloutDesc: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },
  localCallout: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.md, borderRadius: RADIUS.lg, borderWidth: 1, marginBottom: SPACING.md, backgroundColor: `${COLORS.bougainvillea}12`, borderColor: `${COLORS.bougainvillea}40` },
  localCalloutTitle: { fontSize: 14, ...FONTS.bold, letterSpacing: 0.5, color: COLORS.bougainvillea },
  localCalloutDesc: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },
  description: { fontSize: 15, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 24 },
  infoGrid: { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.lg },
  infoCard: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md, gap: SPACING.xs, borderWidth: 1, borderColor: COLORS.border },
  infoLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  infoValue: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  infoSub: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 15 },
  infoFar: { fontSize: 12, color: COLORS.textMuted, ...FONTS.bold, marginTop: 2 },
  // Compact single-line CTA rows (events empty state) — 44 px, one line.
  inlineCta: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginTop: SPACING.lg },
  inlineCtaText: { flex: 1, fontSize: 12, color: COLORS.textMuted, ...FONTS.medium },
  // Remote-mode stamp card (mirrors LoProbe's box so in/out of range look related)
  stampBox: { marginTop: SPACING.md, backgroundColor: 'rgba(18,181,165,0.06)', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(18,181,165,0.3)', padding: SPACING.md, gap: 10 },
  stampHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stampTitle: { flex: 1, fontSize: 13, color: COLORS.textMain, ...FONTS.bold },
  stampLink: { fontSize: 11, color: COLORS.primary, ...FONTS.semibold },
  stampPlates: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  stampPlate: { maxWidth: '100%', borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  stampPlateText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.semibold },
  stampLockRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stampLockText: { flex: 1, fontSize: 12, color: COLORS.textMuted, ...FONTS.medium, lineHeight: 16 },
  stampSave: { alignSelf: 'stretch', minHeight: 44 },
  actionWrap: { alignItems: 'center', gap: 2 },
  actionCaption: { fontSize: 9, color: COLORS.textMuted, ...FONTS.medium, letterSpacing: 0.2 },
  // Partner-submitted price — deliberately muted/dashed, opposite of the
  // gold-filled TrustBadges pill, so it never reads as an official badge.
  partnerPriceBox: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.xs, marginTop: SPACING.sm, padding: SPACING.sm, borderRadius: RADIUS.md, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.border, backgroundColor: 'transparent' },
  partnerPriceLabel: { fontSize: 10.5, color: COLORS.textFaint, ...FONTS.medium, letterSpacing: 0.2 },
  partnerPriceHedge: { fontSize: 10.5, color: COLORS.textFaint, ...FONTS.regular, fontStyle: 'italic' },
  partnerPriceValue: { fontSize: 13, color: COLORS.textMuted, ...FONTS.semibold, marginTop: 2 },
  partnerPriceNote: { fontSize: 11, color: COLORS.textFaint, ...FONTS.regular, marginTop: 1 },
  expSection: { marginTop: SPACING.lg },
  sectionTitle: { ...TYPE.title3, color: COLORS.textMain, marginBottom: SPACING.sm },
  expText: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 22 },

  // Instagram
  instagramBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: SPACING.lg,
  },
  instagramLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, letterSpacing: 0.5, textTransform: 'uppercase' },
  instagramHandle: { fontSize: 15, color: COLORS.textMain, ...FONTS.bold, marginTop: 2 },

  // Calendar section
  calendarSection: { marginTop: SPACING.lg },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginBottom: SPACING.sm },
  calendarCount: { backgroundColor: COLORS.iconMuted, borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2 },
  calendarCountText: { fontSize: 11, color: COLORS.white, ...FONTS.bold },
  calendarItem: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.xs },
  calendarFlyer: { width: 56, height: 56, borderRadius: RADIUS.md },
  calendarItemBody: { flex: 1, gap: 2 },
  calendarItemDate: { fontSize: 11, color: COLORS.icon, ...FONTS.bold, letterSpacing: 0.3 },
  calendarItemTitle: { fontSize: 13, color: COLORS.textMain, ...FONTS.semibold },
  calendarItemFooter: { flexDirection: 'row', marginTop: 2 },
  calendarPriceTag: { borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2 },
  calendarFree: { backgroundColor: 'rgba(34,197,94,0.2)' },
  calendarPaid: { backgroundColor: 'rgba(233,185,73,0.2)' },
  calendarPriceText: { fontSize: 10, color: COLORS.textMain, ...FONTS.bold },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', padding: SPACING.md, paddingBottom: SPACING.lg, gap: SPACING.sm, backgroundColor: COLORS.background, borderTopWidth: 1, borderTopColor: COLORS.border },
  ratingBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(10,10,15,0.8)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.full },
  ratingBadgeText: { fontSize: 13, color: COLORS.mustard, ...FONTS.bold },
  ratingBadgeCount: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
  actionCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  bookBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 14 },
  bookText: { fontSize: 15, color: COLORS.black, ...FONTS.bold },
});
