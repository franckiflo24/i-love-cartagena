import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, Linking as RNLinking } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';

type Venue = {
  venue_id: string; name: string; description: string; type: string;
  address: string; location: { lat: number; lng: number };
  images: string[]; hours: string; price_range: string; booking_link: string;
};

const VENUE_TYPES = [
  { key: 'all', label: 'Todos', icon: 'grid' },
  { key: 'historic', label: 'Histórico', icon: 'flag' },
  { key: 'nightclub', label: 'Club', icon: 'musical-notes' },
  { key: 'restaurant', label: 'Restaurante', icon: 'restaurant' },
  { key: 'beach_club', label: 'Beach', icon: 'sunny' },
  { key: 'hotel', label: 'Hotel', icon: 'bed' },
  { key: 'cultural', label: 'Cultural', icon: 'color-palette' },
];

export default function MapaScreen() {
  const router = useRouter();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState('all');

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.get('/venues');
        setVenues(data);
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    load();
  }, []);

  const filtered = selectedType === 'all' ? venues : venues.filter(v => v.type === selectedType);

  const openMaps = (venue: Venue) => {
    const url = `https://www.google.com/maps/search/?api=1&query=${venue.location.lat},${venue.location.lng}`;
    RNLinking.openURL(url);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Mapa</Text>
        <Text style={styles.subtitle}>Puntos activos de la ciudad</Text>
      </View>

      {/* Type Filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterBar}>
        {VENUE_TYPES.map(t => (
          <TouchableOpacity
            key={t.key}
            testID={`venue-filter-${t.key}`}
            style={[styles.filterChip, selectedType === t.key && styles.filterChipActive]}
            onPress={() => setSelectedType(t.key)}
          >
            <Ionicons name={t.icon as any} size={14} color={selectedType === t.key ? COLORS.primary : COLORS.textMuted} />
            <Text style={[styles.filterText, selectedType === t.key && styles.filterTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : (
          filtered.map(venue => (
            <TouchableOpacity
              key={venue.venue_id}
              testID={`venue-${venue.venue_id}`}
              style={styles.venueCard}
              onPress={() => openMaps(venue)}
              activeOpacity={0.8}
            >
              <Image source={{ uri: venue.images[0] }} style={styles.venueImage} />
              <View style={styles.venueInfo}>
                <View style={styles.venueHeader}>
                  <Text style={styles.venueName}>{venue.name}</Text>
                  <View style={styles.venueTypeBadge}>
                    <Text style={styles.venueTypeText}>{venue.type}</Text>
                  </View>
                </View>
                <Text style={styles.venueDesc} numberOfLines={2}>{venue.description}</Text>
                <View style={styles.venueMeta}>
                  <View style={styles.metaRow}>
                    <Ionicons name="location-outline" size={13} color={COLORS.textMuted} />
                    <Text style={styles.metaText} numberOfLines={1}>{venue.address}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Ionicons name="time-outline" size={13} color={COLORS.textMuted} />
                    <Text style={styles.metaText}>{venue.hours}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Ionicons name="cash-outline" size={13} color={COLORS.textMuted} />
                    <Text style={styles.metaText}>{venue.price_range}</Text>
                  </View>
                </View>
                <View style={styles.venueActions}>
                  <TouchableOpacity
                    testID={`directions-${venue.venue_id}`}
                    style={styles.directionBtn}
                    onPress={() => openMaps(venue)}
                  >
                    <Ionicons name="navigate" size={14} color={COLORS.primary} />
                    <Text style={styles.directionText}>Cómo llegar</Text>
                  </TouchableOpacity>
                  {venue.booking_link ? (
                    <TouchableOpacity
                      testID={`book-venue-${venue.venue_id}`}
                      style={styles.bookBtn}
                      onPress={() => RNLinking.openURL(venue.booking_link)}
                    >
                      <Text style={styles.bookText}>Reservar</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}
        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.sm },
  title: { fontSize: 28, color: COLORS.textMain, ...FONTS.bold },
  subtitle: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },
  filterBar: { paddingHorizontal: SPACING.lg, gap: SPACING.sm, paddingVertical: SPACING.sm },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SPACING.md, paddingVertical: 8, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border },
  filterChipActive: { borderColor: COLORS.primary, backgroundColor: 'rgba(217, 119, 6, 0.15)' },
  filterText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium },
  filterTextActive: { color: COLORS.primary },
  list: { flex: 1, paddingHorizontal: SPACING.lg },
  venueCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, overflow: 'hidden', marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  venueImage: { width: '100%', height: 150 },
  venueInfo: { padding: SPACING.md },
  venueHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  venueName: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold, flex: 1 },
  venueTypeBadge: { backgroundColor: 'rgba(217, 119, 6, 0.15)', borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3 },
  venueTypeText: { fontSize: 10, color: COLORS.primary, ...FONTS.bold, textTransform: 'uppercase', letterSpacing: 1 },
  venueDesc: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, marginTop: SPACING.xs, lineHeight: 20 },
  venueMeta: { marginTop: SPACING.sm, gap: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, flex: 1 },
  venueActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
  directionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: SPACING.md, paddingVertical: 8, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.primary },
  directionText: { fontSize: 12, color: COLORS.primary, ...FONTS.semibold },
  bookBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: 8 },
  bookText: { fontSize: 12, color: COLORS.white, ...FONTS.semibold },
});
