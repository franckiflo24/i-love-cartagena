import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, Linking as RNLinking } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS, EVENT_TYPE_LABELS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useAuth } from '../../src/context/AuthContext';

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [event, setEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isFavorite, setIsFavorite] = useState(false);
  const [inMyWeek, setInMyWeek] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.get(`/events/${id}`);
        setEvent(data);
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    load();
  }, [id]);

  const toggleFavorite = async () => {
    if (!user) return;
    try {
      const res = await api.post('/favorites/toggle', { event_id: id });
      setIsFavorite(res.action === 'added');
    } catch (e) { console.error(e); }
  };

  const toggleMyWeek = async () => {
    if (!user) return;
    try {
      const res = await api.post('/my-week/toggle', { event_id: id });
      setInMyWeek(res.action === 'added');
    } catch (e) { console.error(e); }
  };

  const openMaps = () => {
    if (!event?.location) return;
    RNLinking.openURL(`https://www.google.com/maps/search/?api=1&query=${event.location.lat},${event.location.lng}`);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={COLORS.primary} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  if (!event) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: COLORS.textMuted }}>Evento no encontrado</Text>
        </View>
      </SafeAreaView>
    );
  }

  const formatPrice = (p: number) => p === 0 ? 'Gratis' : `$${p.toLocaleString()} COP`;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Hero Image */}
        <View style={styles.hero}>
          <Image source={{ uri: event.image_url }} style={styles.heroImage} />
          <View style={styles.heroOverlay} />
          <View style={styles.heroNav}>
            <TouchableOpacity testID="event-back-btn" style={styles.navBtn} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
            </TouchableOpacity>
            <View style={styles.heroNavRight}>
              {user && (
                <>
                  <TouchableOpacity testID="event-fav-btn" style={styles.navBtn} onPress={toggleFavorite}>
                    <Ionicons name={isFavorite ? 'heart' : 'heart-outline'} size={22} color={isFavorite ? COLORS.error : COLORS.textMain} />
                  </TouchableOpacity>
                  <TouchableOpacity testID="event-week-btn" style={styles.navBtn} onPress={toggleMyWeek}>
                    <Ionicons name={inMyWeek ? 'calendar' : 'calendar-outline'} size={22} color={inMyWeek ? COLORS.primary : COLORS.textMain} />
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
          <View style={styles.heroContent}>
            <View style={styles.typeBadge}>
              <Text style={styles.typeText}>{EVENT_TYPE_LABELS[event.type] || event.type}</Text>
            </View>
            <Text style={styles.heroTitle}>{event.title}</Text>
          </View>
        </View>

        {/* Info Section */}
        <View style={styles.infoSection}>
          <View style={styles.infoRow}>
            <View style={styles.infoIcon}>
              <Ionicons name="calendar-outline" size={20} color={COLORS.primary} />
            </View>
            <View>
              <Text style={styles.infoLabel}>Fecha</Text>
              <Text style={styles.infoValue}>{event.date}</Text>
            </View>
          </View>
          <View style={styles.infoRow}>
            <View style={styles.infoIcon}>
              <Ionicons name="time-outline" size={20} color={COLORS.primary} />
            </View>
            <View>
              <Text style={styles.infoLabel}>Horario</Text>
              <Text style={styles.infoValue}>{event.start_time} - {event.end_time}</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.infoRow} onPress={openMaps} activeOpacity={0.7}>
            <View style={styles.infoIcon}>
              <Ionicons name="location-outline" size={20} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoLabel}>Lugar</Text>
              <Text style={styles.infoValue}>{event.venue_name}</Text>
            </View>
            <View style={styles.mapCta}>
              <Ionicons name="map" size={14} color={COLORS.primary} />
              <Text style={styles.mapCtaText}>Ver mapa</Text>
            </View>
          </TouchableOpacity>
          <View style={styles.infoRow}>
            <View style={styles.infoIcon}>
              <Ionicons name="cash-outline" size={20} color={COLORS.primary} />
            </View>
            <View>
              <Text style={styles.infoLabel}>Precio</Text>
              <Text style={[styles.infoValue, event.is_free && { color: COLORS.success }]}>
                {formatPrice(event.price)}
              </Text>
            </View>
          </View>
          {event.capacity > 0 && (
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}>
                <Ionicons name="people-outline" size={20} color={COLORS.primary} />
              </View>
              <View>
                <Text style={styles.infoLabel}>Capacidad</Text>
                <Text style={styles.infoValue}>{event.capacity} personas</Text>
              </View>
            </View>
          )}
        </View>

        {/* Description */}
        <View style={styles.descSection}>
          <Text style={styles.descTitle}>Descripción</Text>
          <Text style={styles.descText}>{event.description}</Text>
        </View>

        {/* Tags */}
        {event.tags && event.tags.length > 0 && (
          <View style={styles.tagsSection}>
            {event.tags.map((tag: string) => (
              <View key={tag} style={styles.tagChip}>
                <Text style={styles.tagText}>#{tag}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Bottom Actions */}
      <View style={styles.bottomBar}>
        <TouchableOpacity testID="event-directions-btn" style={styles.dirBtn} onPress={openMaps}>
          <Ionicons name="navigate" size={18} color={COLORS.primary} />
          <Text style={styles.dirText}>Cómo llegar</Text>
        </TouchableOpacity>
        {event.booking_link ? (
          <TouchableOpacity
            testID="event-book-btn"
            style={styles.bookBtn}
            onPress={() => RNLinking.openURL(event.booking_link)}
          >
            <Text style={styles.bookText}>Reservar</Text>
            <Ionicons name="arrow-forward" size={16} color={COLORS.white} />
          </TouchableOpacity>
        ) : (
          <View style={styles.freeLabel}>
            <Ionicons name="checkmark-circle" size={18} color={COLORS.success} />
            <Text style={styles.freeText}>Acceso libre</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  hero: { height: 300, position: 'relative' },
  heroImage: { width: '100%', height: '100%' },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,8,20,0.4)' },
  heroNav: { position: 'absolute', top: SPACING.md, left: SPACING.md, right: SPACING.md, flexDirection: 'row', justifyContent: 'space-between' },
  heroNavRight: { flexDirection: 'row', gap: SPACING.sm },
  navBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(5,8,20,0.6)', alignItems: 'center', justifyContent: 'center' },
  heroContent: { position: 'absolute', bottom: SPACING.lg, left: SPACING.lg, right: SPACING.lg },
  typeBadge: { alignSelf: 'flex-start', backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 4 },
  typeText: { fontSize: 11, color: COLORS.white, ...FONTS.bold, letterSpacing: 1, textTransform: 'uppercase' },
  heroTitle: { fontSize: 28, color: COLORS.textMain, ...FONTS.bold, marginTop: SPACING.sm },
  infoSection: { padding: SPACING.lg, gap: SPACING.md },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  infoIcon: { width: 40, height: 40, borderRadius: RADIUS.md, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  infoLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  infoValue: { fontSize: 15, color: COLORS.textMain, ...FONTS.semibold },
  mapCta: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: `${COLORS.primary}15`, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.full, borderWidth: 1, borderColor: `${COLORS.primary}30` },
  mapCtaText: { fontSize: 11, color: COLORS.primary, ...FONTS.semibold },
  descSection: { paddingHorizontal: SPACING.lg, marginBottom: SPACING.lg },
  descTitle: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold, marginBottom: SPACING.sm },
  descText: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 22 },
  tagsSection: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: SPACING.lg, gap: SPACING.sm },
  tagChip: { backgroundColor: COLORS.surface, borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: COLORS.border },
  tagText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', padding: SPACING.lg, gap: SPACING.md, backgroundColor: COLORS.background, borderTopWidth: 1, borderTopColor: COLORS.border },
  dirBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.primary, paddingVertical: 14 },
  dirText: { fontSize: 14, color: COLORS.primary, ...FONTS.semibold },
  bookBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 14 },
  bookText: { fontSize: 14, color: COLORS.white, ...FONTS.semibold },
  freeLabel: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: RADIUS.full, backgroundColor: 'rgba(34,197,94,0.15)', paddingVertical: 14 },
  freeText: { fontSize: 14, color: COLORS.success, ...FONTS.semibold },
});
