import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS, EVENT_TYPE_LABELS, IMAGES } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useAuth } from '../../src/context/AuthContext';

type Event = {
  event_id: string; title: string; description: string; date: string;
  start_time: string; end_time: string; venue_name: string; type: string;
  is_free: boolean; price: number; image_url: string; featured?: boolean;
};

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [featured, setFeatured] = useState<Event[]>([]);
  const [todayEvents, setTodayEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      const [f, t] = await Promise.all([
        api.get('/events/featured'),
        api.get('/events?date=2026-01-12'),
      ]);
      setFeatured(f);
      setTodayEvents(t);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const formatPrice = (price: number) => {
    if (price === 0) return 'Gratis';
    return `$${(price / 1000).toFixed(0)}K COP`;
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={COLORS.primary} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

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
            <Text style={styles.headerTitle}>I ❤️ Cartagena</Text>
          </View>
          <TouchableOpacity testID="notifications-btn" onPress={() => router.push('/notifications')} style={styles.notifBtn}>
            <Ionicons name="notifications-outline" size={24} color={COLORS.textMain} />
          </TouchableOpacity>
        </View>

        {/* Hero */}
        <TouchableOpacity testID="hero-banner" style={styles.heroCard} activeOpacity={0.9}>
          <Image source={{ uri: IMAGES.hero }} style={styles.heroImage} />
          <View style={styles.heroOverlay} />
          <View style={styles.heroContent}>
            <Text style={styles.heroLabel}>12 - 16 ENERO 2026</Text>
            <Text style={styles.heroTitle}>La experiencia{'\n'}de ciudad</Text>
            <Text style={styles.heroSub}>Sunset · Templo · Beach · Cultura · Wellness</Text>
          </View>
        </TouchableOpacity>

        {/* Quick Access */}
        <View style={styles.quickAccess}>
          {[
            { icon: 'calendar', label: 'Agenda', route: '/(tabs)/agenda' },
            { icon: 'map', label: 'Mapa', route: '/(tabs)/mapa' },
            { icon: 'boat', label: 'Transporte', route: '/transport' },
            { icon: 'trail-sign', label: 'Rutas', route: '/itineraries' },
          ].map((item) => (
            <TouchableOpacity
              key={item.label}
              testID={`quick-${item.label.toLowerCase()}`}
              style={styles.quickItem}
              onPress={() => router.push(item.route as any)}
            >
              <View style={styles.quickIcon}>
                <Ionicons name={item.icon as any} size={22} color={COLORS.primary} />
              </View>
              <Text style={styles.quickLabel}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

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
                onPress={() => router.push(`/event/${event.event_id}`)}
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
            <Text style={styles.sectionTitle}>Hoy · 12 Enero</Text>
          </View>
          {todayEvents.slice(0, 4).map((event) => (
            <TouchableOpacity
              key={event.event_id}
              testID={`today-${event.event_id}`}
              style={styles.eventRow}
              onPress={() => router.push(`/event/${event.event_id}`)}
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
            onPress={() => router.push('/(tabs)/partners')}
            activeOpacity={0.8}
          >
            <Image source={{ uri: IMAGES.texture }} style={styles.partnersCtaImage} />
            <View style={styles.partnersCtaOverlay} />
            <View style={styles.partnersCtaContent}>
              <Ionicons name="diamond" size={28} color={COLORS.primary} />
              <Text style={styles.partnersCtaTitle}>Lugares certificados</Text>
              <Text style={styles.partnersCtaDesc}>Restaurantes, clubs, hoteles y más validados por I ❤️ Cartagena</Text>
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
  heroCard: { marginHorizontal: SPACING.lg, borderRadius: RADIUS.xl, overflow: 'hidden', height: 220, marginBottom: SPACING.lg },
  heroImage: { width: '100%', height: '100%', position: 'absolute' },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,8,20,0.5)' },
  heroContent: { flex: 1, justifyContent: 'flex-end', padding: SPACING.lg },
  heroLabel: { fontSize: 11, color: COLORS.primary, letterSpacing: 3, ...FONTS.semibold },
  heroTitle: { fontSize: 28, color: COLORS.textMain, ...FONTS.bold, marginTop: SPACING.xs, lineHeight: 34 },
  heroSub: { fontSize: 13, color: COLORS.textMuted, marginTop: SPACING.sm, ...FONTS.regular },
  quickAccess: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: SPACING.lg, marginBottom: SPACING.lg },
  quickItem: { alignItems: 'center', gap: SPACING.sm },
  quickIcon: { width: 52, height: 52, borderRadius: RADIUS.lg, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  quickLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
  section: { marginBottom: SPACING.lg },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.lg, marginBottom: SPACING.md },
  sectionTitle: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold },
  seeAll: { fontSize: 13, color: COLORS.primary, ...FONTS.semibold },
  horizontalList: { paddingLeft: SPACING.lg, gap: SPACING.md },
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
