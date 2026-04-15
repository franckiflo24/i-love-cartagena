import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { useFavorites } from '../src/context/FavoritesContext';
import { api } from '../src/constants/api';

export default function FavoritesScreen() {
  const router = useRouter();
  const { favorites, toggleFavorite } = useFavorites();
  const [events, setEvents] = useState<any[]>([]);
  const [concerts, setConcerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [allEvents, allConcerts] = await Promise.all([
          api.get('/events'),
          api.get('/concerts'),
        ]);
        const favIds = new Set(favorites.map(f => f.item_id));
        setEvents(allEvents.filter((e: any) => favIds.has(e.event_id)));
        setConcerts(allConcerts.filter((c: any) => favIds.has(c.concert_id)));
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    load();
  }, [favorites]);

  const total = events.length + concerts.length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Mi Agenda</Text>
          <Text style={styles.subtitle}>{total} {total === 1 ? 'guardado' : 'guardados'}</Text>
        </View>
        <Ionicons name="heart" size={24} color="#EF4444" />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 60 }} />
        ) : total === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="heart-outline" size={64} color={COLORS.textMuted} />
            <Text style={styles.emptyTitle}>Tu agenda está vacía</Text>
            <Text style={styles.emptyDesc}>Toca el corazón ❤️ en eventos y conciertos para guardarlos aquí.</Text>
            <TouchableOpacity style={styles.exploreCta} onPress={() => router.push('/concerts' as any)}>
              <Ionicons name="musical-notes" size={18} color={COLORS.primary} />
              <Text style={styles.exploreText}>Explorar conciertos</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
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
                      <Ionicons name="heart" size={22} color="#EF4444" />
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

            {/* Events */}
            {events.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>📅 Eventos ({events.length})</Text>
                {events.map(e => (
                  <TouchableOpacity key={e.event_id} style={styles.eventRow} onPress={() => router.push(`/event/${e.event_id}`)}>
                    <View style={styles.eventTime}>
                      <Text style={styles.eventHour}>{e.start_time}</Text>
                    </View>
                    <View style={styles.eventInfo}>
                      <Text style={styles.eventTitle}>{e.title}</Text>
                      <Text style={styles.eventVenue}>{e.venue_name} · {e.type}</Text>
                    </View>
                    <TouchableOpacity onPress={() => toggleFavorite(e.event_id, 'event')}>
                      <Ionicons name="heart" size={20} color="#EF4444" />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
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

  emptyState: { alignItems: 'center', paddingTop: 80, paddingHorizontal: SPACING.xl, gap: SPACING.md },
  emptyTitle: { fontSize: 20, color: COLORS.textMain, ...FONTS.bold },
  emptyDesc: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', lineHeight: 22 },
  exploreCta: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: 20, paddingVertical: 12, borderRadius: RADIUS.full, backgroundColor: `${COLORS.primary}15`, borderWidth: 1, borderColor: `${COLORS.primary}30`, marginTop: SPACING.md },
  exploreText: { fontSize: 14, color: COLORS.primary, ...FONTS.semibold },

  section: { paddingHorizontal: SPACING.lg, marginTop: SPACING.md },
  sectionTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold, marginBottom: SPACING.sm },

  card: { borderRadius: RADIUS.xl, overflow: 'hidden', marginBottom: SPACING.md, height: 160, position: 'relative' },
  cardImage: { width: '100%', height: '100%' },
  cardOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
  heartBtn: { position: 'absolute', top: 12, right: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  cardContent: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: SPACING.md },
  cardGenre: { fontSize: 10, color: COLORS.primary, ...FONTS.bold, letterSpacing: 1, textTransform: 'uppercase' },
  cardTitle: { fontSize: 20, color: '#FFF', ...FONTS.bold },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  cardMetaText: { fontSize: 11, color: 'rgba(255,255,255,0.7)', ...FONTS.medium },
  cardPrice: { fontSize: 12, color: COLORS.primary, ...FONTS.bold, marginTop: 2 },

  eventRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  eventTime: { width: 50, alignItems: 'center' },
  eventHour: { fontSize: 14, color: COLORS.primary, ...FONTS.bold },
  eventInfo: { flex: 1 },
  eventTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  eventVenue: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
});
