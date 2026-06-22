import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, Linking as RNLinking, Platform, Share } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS, ELEVATION, PARTNER_CATEGORY_LABELS, TIER_COLORS, Tier } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { TierBadge } from '../../src/components/TierBadge';
import { SafeImage } from '../../src/components/SafeImage';
import ReviewsList from '../../src/components/ReviewsList';
import { SkeletonPartnerDetail } from '../../src/components/Skeleton';
import { useLang } from '../../src/context/LanguageContext';
import { useFavorites } from '../../src/context/FavoritesContext';
import { useTr } from '../../src/i18n/autoTr';

export default function PartnerDetail() {
  const tr = useTr();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { s } = useLang();
  const { isFavorite, toggleFavorite } = useFavorites();
  const [partner, setPartner] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [partnerEvents, setPartnerEvents] = useState<any[]>([]);
  const [reserving, setReserving] = useState(false);

  const loadPartner = async () => {
    setLoading(true);
    setError(false);
    try {
      const [pData, eData] = await Promise.all([
        api.get(`/partners/${id}`),
        api.get(`/partner-events?partner_id=${id}&upcoming=true`).catch(() => []),
      ]);
      setPartner(pData);
      setPartnerEvents(eData || []);
    } catch (e) {
      console.error('[PartnerDetail]', e);
      setError(true);
    }
    setLoading(false);
  };

  useEffect(() => { loadPartner(); }, [id]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <SkeletonPartnerDetail />
      </SafeAreaView>
    );
  }

  if (error || !partner) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl, gap: SPACING.md }}>
          <Ionicons name="cloud-offline-outline" size={48} color={COLORS.textMuted} />
          <Text style={{ color: COLORS.textMain, fontSize: 18, ...FONTS.bold, textAlign: 'center' }}>
            {error ? tr('Sin conexión') : tr('No encontrado')}
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: 14, textAlign: 'center' }}>
            {error ? tr('Verifica tu conexión e intenta de nuevo') : tr('Este lugar no está disponible')}
          </Text>
          <TouchableOpacity onPress={error ? loadPartner : () => router.back()} style={{ backgroundColor: COLORS.primary, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md, borderRadius: RADIUS.full, marginTop: SPACING.md }}>
            <Text style={{ color: COLORS.black, ...FONTS.bold }}>{error ? tr('Reintentar') : tr('Volver')}</Text>
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

  const openMaps = () => {
    if (!partner) return;
    const addrText = (partner.address || '').trim();
    let query: string;
    if (addrText) {
      query = encodeURIComponent(`${partner.name}, ${addrText}, Cartagena`);
    } else if (hasRealCoords) {
      query = `${partner.location.lat},${partner.location.lng}`;
    } else {
      query = encodeURIComponent(`${partner.name}, Cartagena, Colombia`);
    }
    const webUrl = `https://www.google.com/maps/search/?api=1&query=${query}`;
    const iosDeep = `comgooglemaps://?q=${query}`;
    openExternal(iosDeep, webUrl);
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
    openExternal(uberUrl, uberWeb);
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
  const formatPrice = (p: number | undefined | null) => !p ? tr('GRATIS') : `$${(p / 1000).toFixed(0)}K`;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <SafeImage uri={partner.image_url} category={partner.category} style={styles.heroImage} />
          <View style={styles.heroOverlay} />
          <View style={{ flexDirection: 'row', position: 'absolute', top: SPACING.md, left: SPACING.md, gap: 8, zIndex: 5 }}>
            <TouchableOpacity testID="partner-back-btn" style={styles.navBtn} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.navBtn} onPress={() => router.replace('/(tabs)')}>
              <Ionicons name="home-outline" size={20} color={COLORS.textMain} />
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', position: 'absolute', top: SPACING.md, right: SPACING.md, gap: 8, zIndex: 5 }}>
            <TouchableOpacity style={styles.navBtn} onPress={handleShare} accessibilityLabel={tr('Compartir')}>
              <Ionicons name="share-outline" size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              testID="partner-fav-btn"
              style={[styles.heartBtn, isFavorite(partner.partner_id) && styles.heartBtnActive]}
              onPress={() => toggleFavorite(partner.partner_id, 'partner')}
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
              <Ionicons name="shield-checkmark" size={16} color={COLORS.primary} />
              <Text style={styles.sealText}>{tr('PARTNER CERTIFICADO')}</Text>
            </View>
          )}
          <View style={styles.heroBottom}>
            <View style={styles.heroBadgeRow}>
              <View style={styles.catBadge}>
                <Text style={styles.catText}>{tr(PARTNER_CATEGORY_LABELS[partner.category] || partner.category)}</Text>
              </View>
              <TierBadge tier={partner.tier} size="sm" />
              {partner.rating ? (
                <View style={styles.ratingBadge}>
                  <Ionicons name="star" size={12} color={COLORS.primary} />
                  <Text style={styles.ratingBadgeText}>{Number(partner.rating).toFixed(1)}</Text>
                  {partner.reviews ? <Text style={styles.ratingBadgeCount}>({partner.reviews})</Text> : null}
                </View>
              ) : null}
            </View>
            <Text style={styles.heroTitle}>{partner.name}</Text>
          </View>
        </View>

        <View style={styles.body}>
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
          {partner.description ? <Text style={styles.description}>{partner.description}</Text> : null}

          <View style={styles.infoGrid}>
            {partner.address ? (
              <TouchableOpacity style={styles.infoCard} onPress={openMaps} activeOpacity={0.7}>
                <Ionicons name="location-outline" size={20} color={COLORS.primary} />
                <Text style={styles.infoLabel}>{tr('Ubicación')}</Text>
                <Text style={[styles.infoValue, { textDecorationLine: 'underline' }]}>{partner.address}</Text>
                <Ionicons name="navigate-outline" size={14} color={COLORS.textMuted} style={{ marginTop: 4 }} />
              </TouchableOpacity>
            ) : null}
            {partner.price_range ? (
              <View style={styles.infoCard}>
                <Ionicons name="cash-outline" size={20} color={COLORS.primary} />
                <Text style={styles.infoLabel}>{tr('Rango de precio')}</Text>
                <Text style={styles.infoValue}>{partner.price_range}</Text>
              </View>
            ) : null}
            <View style={styles.infoCard}>
              <Ionicons name="time-outline" size={20} color={COLORS.primary} />
              <Text style={styles.infoLabel}>{tr('Horario')}</Text>
              <Text style={styles.infoValue}>
                {(partner as any).hours || tr('Contactar para horarios')}
              </Text>
            </View>
          </View>

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
              <Ionicons name="logo-instagram" size={20} color={COLORS.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.instagramLabel}>{tr('Síguelos en Instagram')}</Text>
                <Text style={styles.instagramHandle}>@{igHandle}</Text>
              </View>
              <Ionicons name="open-outline" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          ) : null}

          {/* Calendar of upcoming events */}
          <View style={styles.calendarSection}>
            <View style={styles.calendarHeader}>
              <Ionicons name="calendar" size={16} color={COLORS.primary} />
              <Text style={styles.sectionTitle}>{tr('Próximos eventos')}</Text>
              {partnerEvents.length > 0 && (
                <View style={styles.calendarCount}>
                  <Text style={styles.calendarCountText}>{partnerEvents.length}</Text>
                </View>
              )}
            </View>
            {partnerEvents.length === 0 ? (
              <View style={styles.calendarEmpty}>
                <Ionicons name="calendar-outline" size={28} color={COLORS.textMuted} />
                <Text style={styles.calendarEmptyText}>{tr('Sin eventos publicados próximamente')}</Text>
              </View>
            ) : (
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
        </View>
        {/* Reviews Section */}
        {partner?.partner_id && (
          <View style={{ paddingHorizontal: SPACING.md, marginTop: SPACING.lg }}>
            <ReviewsList partnerId={partner.partner_id} />
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.actionCircle} onPress={handleUber} accessibilityLabel={tr('Pedir Uber')}>
          <Ionicons name="car" size={20} color={COLORS.textMain} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionCircle} onPress={openMaps} accessibilityLabel={tr('Cómo llegar')}>
          <Ionicons name="navigate" size={20} color={COLORS.textMain} />
        </TouchableOpacity>
        {partner.phone ? (
          <TouchableOpacity style={styles.actionCircle} onPress={handleCall} accessibilityLabel={tr('Llamar')}>
            <Ionicons name="call" size={20} color={COLORS.textMain} />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={[styles.bookBtn, reserving && { opacity: 0.6 }]} onPress={handleReserve} disabled={reserving} accessibilityLabel={tr('Reservar')}>
          {reserving ? (
            <ActivityIndicator size="small" color={COLORS.black} />
          ) : (
            <>
              <Ionicons name="logo-whatsapp" size={18} color={COLORS.black} />
              <Text style={styles.bookText}>{tr('Reservar')}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  hero: { height: 280, position: 'relative' },
  heroImage: { width: '100%', height: '100%' },
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
  sealBadge: { position: 'absolute', top: SPACING.md + 56, right: SPACING.md, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(5,8,20,0.85)', borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: COLORS.primary },
  sealText: { fontSize: 10, color: COLORS.primary, ...FONTS.bold, letterSpacing: 1 },
  heroBottom: { position: 'absolute', bottom: SPACING.lg, left: SPACING.lg, right: SPACING.lg },
  heroBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, flexWrap: 'wrap' },
  catBadge: { alignSelf: 'flex-start', backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 4 },
  catText: { fontSize: 10, color: COLORS.white, ...FONTS.bold, letterSpacing: 1, textTransform: 'uppercase' },
  heroTitle: { fontSize: 28, color: COLORS.textMain, ...FONTS.bold, marginTop: SPACING.sm },
  body: { padding: SPACING.lg },
  tierCallout: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.md, borderRadius: RADIUS.lg, borderWidth: 1, marginBottom: SPACING.md },
  tierCalloutTitle: { fontSize: 14, ...FONTS.bold, letterSpacing: 0.5 },
  tierCalloutDesc: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },
  description: { fontSize: 15, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 24 },
  infoGrid: { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.lg },
  infoCard: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md, gap: SPACING.xs, borderWidth: 1, borderColor: COLORS.border },
  infoLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  infoValue: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  expSection: { marginTop: SPACING.lg },
  sectionTitle: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold, marginBottom: SPACING.sm },
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
    borderColor: 'rgba(217,119,6,0.3)',
    marginTop: SPACING.lg,
  },
  instagramLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, letterSpacing: 0.5, textTransform: 'uppercase' },
  instagramHandle: { fontSize: 15, color: COLORS.textMain, ...FONTS.bold, marginTop: 2 },

  // Calendar section
  calendarSection: { marginTop: SPACING.lg },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginBottom: SPACING.sm },
  calendarCount: { backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2 },
  calendarCountText: { fontSize: 11, color: COLORS.white, ...FONTS.bold },
  calendarEmpty: { alignItems: 'center', paddingVertical: SPACING.lg, gap: SPACING.xs, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  calendarEmptyText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular },
  calendarItem: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.xs },
  calendarFlyer: { width: 56, height: 56, borderRadius: RADIUS.md },
  calendarItemBody: { flex: 1, gap: 2 },
  calendarItemDate: { fontSize: 11, color: COLORS.primary, ...FONTS.bold, letterSpacing: 0.3 },
  calendarItemTitle: { fontSize: 13, color: COLORS.textMain, ...FONTS.semibold },
  calendarItemFooter: { flexDirection: 'row', marginTop: 2 },
  calendarPriceTag: { borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2 },
  calendarFree: { backgroundColor: 'rgba(34,197,94,0.2)' },
  calendarPaid: { backgroundColor: 'rgba(217,119,6,0.2)' },
  calendarPriceText: { fontSize: 10, color: COLORS.textMain, ...FONTS.bold },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', padding: SPACING.md, paddingBottom: SPACING.lg, gap: SPACING.sm, backgroundColor: COLORS.background, borderTopWidth: 1, borderTopColor: COLORS.border },
  ratingBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(10,10,15,0.8)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.full },
  ratingBadgeText: { fontSize: 13, color: COLORS.primary, ...FONTS.bold },
  ratingBadgeCount: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
  actionCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  bookBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 14 },
  bookText: { fontSize: 15, color: COLORS.black, ...FONTS.bold },
});
