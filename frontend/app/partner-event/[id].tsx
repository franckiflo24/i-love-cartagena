import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Linking as RNLinking, Alert } from 'react-native';
import { SafeImage } from '../../src/components/SafeImage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS, TIER_COLORS, Tier } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { TierBadge } from '../../src/components/TierBadge';
import { useFavorites } from '../../src/context/FavoritesContext';
import { useMyCalendar } from '../../src/context/MyCalendarContext';
import { useLang } from '../../src/context/LanguageContext';

const CAT_ICONS: Record<string, string> = {
  gastronomy: 'restaurant',
  music: 'musical-notes',
  party: 'wine',
  wellness: 'leaf',
  art: 'color-palette',
  popup: 'bag-handle',
};

const CAT_LABELS: Record<string, string> = {
  gastronomy: 'Gastronomía',
  music: 'Música',
  party: 'Fiesta',
  wellness: 'Wellness',
  art: 'Arte & Cultura',
  popup: 'Pop-up',
};

const formatDate = (iso: string) => {
  try {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  } catch { return iso; }
};
const formatPrice = (p: number | undefined | null) => !p ? 'GRATIS' : `$${(p ?? 0).toLocaleString('es-CO')} COP`;

export default function PartnerEventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { isInCalendar, addToCalendar, removeFromCalendar } = useMyCalendar();
  const { s } = useLang();
  const [event, setEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [reserving, setReserving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.get(`/partner-events/${id}`);
        setEvent(data);
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    load();
  }, [id]);

  const handleReserve = () => {
    if (!event) return;
    try {
      api.post(`/partner-events/${event.event_id}/track-reserve`).catch(() => {});
    } catch {}
    router.push({
      pathname: '/reservation/new' as any,
      params: {
        partner_id: event.partner_id,
        event_id: event.event_id,
      },
    });
  };

  const handleWhatsApp = async () => {
    if (!event) return;
    // Try to get partner phone directly
    try {
      const partnerData = await api.get(`/partners/${event.partner_id}`);
      const phone = (partnerData?.phone || '').replace(/[^\d+]/g, '').replace('+', '');
      const waPhone = phone || '573176481183'; // fallback to AMO concierge
      const msg = encodeURIComponent(
        `¡Hola! Reserva via *AMO Cartagena* 🌴\n\n`
        + `Evento: *${event.title}*\n`
        + `Lugar: *${event.partner_name || partnerData?.name || ''}*\n`
        + `Fecha: ${event.date}\n`
        + `Hora: ${event.start_time}\n\n`
        + `¿Disponibilidad?\n\n---\n\n`
        + `Hi! Booking via *AMO Cartagena* 🌴\n\n`
        + `Event: *${event.title}*\n`
        + `Venue: *${event.partner_name || partnerData?.name || ''}*\n`
        + `Date: ${event.date}\n`
        + `Time: ${event.start_time}\n\n`
        + `Availability?`
      );
      RNLinking.openURL(`https://wa.me/${waPhone}?text=${msg}`);
    } catch {
      // Fallback to AMO concierge
      const msg = encodeURIComponent(`¡Hola! Quiero reservar para *${event.title}* via AMO Cartagena 🌴`);
      RNLinking.openURL(`https://wa.me/573176481183?text=${msg}`);
    }
  };

  if (loading) {
    return <SafeAreaView style={styles.container}><ActivityIndicator size="large" color={COLORS.primary} style={{ flex: 1 }} /></SafeAreaView>;
  }
  if (!event) {
    return <SafeAreaView style={styles.container}><View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: COLORS.textMuted }}>Evento no encontrado</Text></View></SafeAreaView>;
  }

  const tierColors = event.partner?.tier ? TIER_COLORS[event.partner.tier as Tier] : null;
  const partner = event.partner || {};

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Flyer */}
        <View style={styles.flyerWrap}>
          <SafeImage uri={event.flyer_url} category={event.category} style={styles.flyer} resizeMode="cover" />
          <View style={styles.flyerOverlay} />
          <View style={{ flexDirection: 'row', position: 'absolute', top: SPACING.md, left: SPACING.md, gap: 8, zIndex: 5 }}>
            <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={22} color={COLORS.white} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.backBtn} onPress={() => router.replace('/(tabs)')}>
              <Ionicons name="home-outline" size={20} color={COLORS.white} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.heartBtn}
            onPress={() => event?.event_id && toggleFavorite(event.event_id, 'partner_event')}
          >
            <Ionicons
              name={event?.event_id && isFavorite(event.event_id) ? 'heart' : 'heart-outline'}
              size={22}
              color={event?.event_id && isFavorite(event.event_id) ? '#EF4444' : COLORS.white}
            />
          </TouchableOpacity>
          <View style={[styles.priceBadgeBig, event.is_free ? styles.priceFree : styles.pricePaid]}>
            <Text style={styles.priceBigText}>{formatPrice(event.price)}</Text>
          </View>
          <View style={styles.flyerBottom}>
            <View style={styles.catRow}>
              <View style={styles.catBadge}>
                <Ionicons name={(CAT_ICONS[event.category] || 'pricetag') as any} size={12} color={COLORS.white} />
                <Text style={styles.catText}>{CAT_LABELS[event.category] || event.category}</Text>
              </View>
              {tierColors && <TierBadge tier={event.partner?.tier} size="sm" />}
            </View>
            <Text style={styles.title}>{event.title}</Text>
          </View>
        </View>

        {/* Time + Date */}
        <View style={styles.body}>
          <View style={styles.dateTimeBox}>
            <View style={styles.dateTimeItem}>
              <Ionicons name="calendar" size={18} color={COLORS.primary} />
              <View>
                <Text style={styles.dateTimeLabel}>Fecha</Text>
                <Text style={styles.dateTimeValue}>{formatDate(event.date)}</Text>
              </View>
            </View>
            <View style={styles.dateTimeDivider} />
            <View style={styles.dateTimeItem}>
              <Ionicons name="time" size={18} color={COLORS.primary} />
              <View>
                <Text style={styles.dateTimeLabel}>Hora</Text>
                <Text style={styles.dateTimeValue}>{event.start_time} – {event.end_time}</Text>
              </View>
            </View>
          </View>

          {/* Description */}
          <Text style={styles.sectionTitle}>Sobre el evento</Text>
          <Text style={styles.description}>{event.description}</Text>

          {/* Add to My Calendar */}
          <TouchableOpacity
            style={[styles.calendarBtn, isInCalendar(event.event_id) && styles.calendarBtnActive]}
            onPress={async () => {
              if (isInCalendar(event.event_id)) {
                await removeFromCalendar(event.event_id);
              } else {
                await addToCalendar({
                  item_id: event.event_id,
                  item_type: 'partner_event',
                  date: event.date,
                  start_time: event.start_time,
                  end_time: event.end_time,
                  title: event.title,
                  flyer_url: event.flyer_url,
                  category: event.category,
                  partner_name: partner.name || event.partner_name,
                  partner_tier: partner.tier || event.partner_tier,
                  is_free: event.is_free,
                  price: event.price,
                  source: 'manual',
                });
              }
            }}
          >
            <Ionicons
              name={isInCalendar(event.event_id) ? 'checkmark-circle' : 'calendar'}
              size={18}
              color={isInCalendar(event.event_id) ? '#22C55E' : COLORS.primary}
            />
            <Text style={[styles.calendarBtnText, isInCalendar(event.event_id) && { color: '#22C55E' }]}>
              {isInCalendar(event.event_id) ? s('in_my_calendar') : s('add_to_calendar')}
            </Text>
          </TouchableOpacity>

          {/* Partner Card */}
          <Text style={styles.sectionTitle}>Organizado por</Text>
          <TouchableOpacity
            style={[styles.partnerCard, tierColors && { borderColor: tierColors.border, borderWidth: 1.5 }]}
            onPress={() => router.push(`/partner/${event.partner_id}`)}
            activeOpacity={0.85}
          >
            <SafeImage uri={partner.image_url} style={styles.partnerImage} />
            <View style={styles.partnerOverlay} />
            <View style={styles.partnerInfo}>
              <View style={styles.partnerTopRow}>
                <Text style={styles.partnerName}>{partner.name || event.partner_name}</Text>
                <TierBadge tier={partner.tier || event.partner_tier} size="xs" />
              </View>
              {partner.address ? (
                <View style={styles.metaRow}>
                  <Ionicons name="location-outline" size={12} color={COLORS.textMuted} />
                  <Text style={styles.metaText} numberOfLines={1}>{partner.address}</Text>
                </View>
              ) : null}
              <View style={styles.partnerActions}>
                {partner.instagram ? (
                  <TouchableOpacity
                    style={styles.iconBtn}
                    onPress={() => RNLinking.openURL(`https://instagram.com/${partner.instagram}`)}
                  >
                    <Ionicons name="logo-instagram" size={14} color={COLORS.primary} />
                    <Text style={styles.iconBtnText}>@{partner.instagram}</Text>
                  </TouchableOpacity>
                ) : null}
                <View style={styles.calendarBadge}>
                  <Ionicons name="calendar-outline" size={12} color={COLORS.textMuted} />
                  <Text style={styles.calendarBadgeText}>Ver calendario</Text>
                  <Ionicons name="chevron-forward" size={12} color={COLORS.textMuted} />
                </View>
              </View>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Bottom CTA */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.partnerProfileBtn}
          onPress={() => router.push(`/partner/${event.partner_id}`)}
        >
          <Ionicons name="person-outline" size={18} color={COLORS.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.whatsappBtn}
          onPress={handleWhatsApp}
          activeOpacity={0.85}
        >
          <Ionicons name="logo-whatsapp" size={18} color="#FFF" />
          <Text style={styles.whatsappText}>Reservar por WhatsApp</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  flyerWrap: { width: '100%', aspectRatio: 0.9, position: 'relative' },
  flyer: { width: '100%', height: '100%' },
  flyerOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '60%', backgroundColor: 'rgba(5,8,20,0.85)' },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  heartBtn: { position: 'absolute', top: SPACING.md, left: 104, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  priceBadgeBig: { position: 'absolute', top: SPACING.md, right: SPACING.md, borderRadius: RADIUS.full, paddingHorizontal: 14, paddingVertical: 7 },
  priceFree: { backgroundColor: COLORS.success },
  pricePaid: { backgroundColor: 'rgba(5,8,20,0.85)', borderWidth: 1, borderColor: COLORS.primary },
  priceBigText: { fontSize: 13, color: COLORS.white, ...FONTS.bold, letterSpacing: 0.5 },
  flyerBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: SPACING.lg },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginBottom: SPACING.sm, flexWrap: 'wrap' },
  catBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4 },
  catText: { fontSize: 10, color: COLORS.white, ...FONTS.bold, letterSpacing: 1, textTransform: 'uppercase' },
  title: { fontSize: 26, color: COLORS.white, ...FONTS.bold, lineHeight: 32 },

  body: { padding: SPACING.lg },
  dateTimeBox: { flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.lg },
  dateTimeItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  dateTimeDivider: { width: 1, backgroundColor: COLORS.border, marginHorizontal: SPACING.sm },
  dateTimeLabel: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium, letterSpacing: 0.5, textTransform: 'uppercase' },
  dateTimeValue: { fontSize: 13, color: COLORS.textMain, ...FONTS.semibold, marginTop: 2 },

  sectionTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold, marginBottom: SPACING.sm, marginTop: SPACING.md, letterSpacing: 0.3 },
  description: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 22 },

  calendarBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: SPACING.lg, paddingVertical: 12, borderRadius: RADIUS.full, borderWidth: 1.5, borderColor: COLORS.primary, backgroundColor: 'rgba(217,119,6,0.1)' },
  calendarBtnActive: { borderColor: '#22C55E', backgroundColor: 'rgba(34,197,94,0.12)' },
  calendarBtnText: { fontSize: 14, color: COLORS.primary, ...FONTS.bold, letterSpacing: 0.3 },

  partnerCard: { borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, position: 'relative', height: 140 },
  partnerImage: { position: 'absolute', width: '100%', height: '100%' },
  partnerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,8,20,0.7)' },
  partnerInfo: { flex: 1, padding: SPACING.md, justifyContent: 'space-between' },
  partnerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  partnerName: { fontSize: 16, color: COLORS.white, ...FONTS.bold },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  metaText: { fontSize: 11, color: 'rgba(255,255,255,0.7)', ...FONTS.regular, flex: 1 },
  partnerActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.xs, marginTop: SPACING.sm },
  iconBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(217,119,6,0.2)', borderWidth: 1, borderColor: COLORS.primary, paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.full },
  iconBtnText: { fontSize: 11, color: COLORS.primary, ...FONTS.semibold },
  calendarBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 8, paddingVertical: 5, borderRadius: RADIUS.full },
  calendarBadgeText: { fontSize: 10, color: COLORS.textMuted, ...FONTS.semibold },

  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', padding: SPACING.lg, gap: SPACING.sm, backgroundColor: COLORS.background, borderTopWidth: 1, borderTopColor: COLORS.border },
  partnerProfileBtn: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.primary },
  reserveBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 14 },
  reserveText: { fontSize: 14, color: COLORS.white, ...FONTS.bold },
  whatsappBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#25D366', borderRadius: RADIUS.full, paddingVertical: 14 },
  whatsappText: { fontSize: 14, color: '#FFF', ...FONTS.bold },
});
