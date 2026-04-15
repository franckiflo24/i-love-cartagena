import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { api } from '../src/constants/api';

const TYPE_COLORS: Record<string, string> = {
  lifestyle: '#D97706',
  culture: '#8B5CF6',
  premium: '#EAB308',
  music: '#EC4899',
};

export default function ItinerariesScreen() {
  const router = useRouter();
  const [itineraries, setItineraries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.get('/itineraries');
        setItineraries(data);
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    load();
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity testID="itineraries-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Itinerarios</Text>
          <Text style={styles.subtitle}>Rutas curadas para tu experiencia</Text>
        </View>
      </View>

      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : (
          itineraries.map(itn => {
            const isExpanded = expanded === itn.itinerary_id;
            const color = TYPE_COLORS[itn.type] || COLORS.primary;
            return (
              <TouchableOpacity
                key={itn.itinerary_id}
                testID={`itinerary-${itn.itinerary_id}`}
                style={styles.card}
                onPress={() => setExpanded(isExpanded ? null : itn.itinerary_id)}
                activeOpacity={0.8}
              >
                <Image source={{ uri: itn.image_url }} style={styles.cardImage} />
                <View style={styles.cardOverlay} />
                <View style={styles.cardContent}>
                  <View style={[styles.typeBadge, { backgroundColor: color }]}>
                    <Text style={styles.typeText}>{itn.type.toUpperCase()}</Text>
                  </View>
                  <Text style={styles.cardTitle}>{itn.name}</Text>
                  <Text style={styles.cardDesc}>{itn.description}</Text>
                  <Text style={styles.stopsCount}>{itn.stops?.length || 0} paradas</Text>
                </View>

                {isExpanded && itn.stops && (
                  <View style={styles.stopsSection}>
                    {itn.stops.map((stop: any, i: number) => (
                      <TouchableOpacity
                        key={i}
                        testID={`stop-${itn.itinerary_id}-${i}`}
                        style={styles.stopRow}
                        onPress={() => stop.event_id ? router.push(`/event/${stop.event_id}`) : null}
                      >
                        <View style={[styles.stopDot, { backgroundColor: color }]} />
                        {i < itn.stops.length - 1 && <View style={[styles.stopLine, { backgroundColor: color }]} />}
                        <Text style={styles.stopTime}>{stop.time}</Text>
                        <View style={styles.stopInfo}>
                          <Text style={styles.stopTitle}>{stop.title}</Text>
                          <Text style={styles.stopVenue}>{stop.venue}</Text>
                        </View>
                        {stop.is_free ? (
                          <View style={styles.freeBadge}>
                            <Text style={styles.freeText}>GRATIS</Text>
                          </View>
                        ) : stop.price ? (
                          <Text style={styles.priceText}>${(stop.price / 1000).toFixed(0)}K</Text>
                        ) : null}
                        {stop.event_id ? <Ionicons name="chevron-forward" size={14} color={COLORS.textMuted} /> : null}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, color: COLORS.textMain, ...FONTS.bold },
  subtitle: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular },
  list: { flex: 1, paddingHorizontal: SPACING.lg },
  card: { borderRadius: RADIUS.xl, overflow: 'hidden', marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  cardImage: { width: '100%', height: 180 },
  cardOverlay: { position: 'absolute', top: 0, left: 0, right: 0, height: 180, backgroundColor: 'rgba(0,0,0,0.45)' },
  cardContent: { position: 'absolute', top: 0, left: 0, right: 0, height: 180, padding: SPACING.lg, justifyContent: 'flex-end' },
  typeBadge: { alignSelf: 'flex-start', borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 3, marginBottom: SPACING.xs },
  typeText: { fontSize: 10, color: COLORS.white, ...FONTS.bold, letterSpacing: 2 },
  cardTitle: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold },
  cardDesc: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },
  stopsCount: { fontSize: 11, color: COLORS.primary, ...FONTS.semibold, marginTop: 4 },
  stopsSection: { backgroundColor: COLORS.surface, padding: SPACING.lg },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 8, position: 'relative' },
  stopDot: { width: 10, height: 10, borderRadius: 5 },
  stopLine: { position: 'absolute', left: 4, top: 22, width: 2, height: 30, opacity: 0.3 },
  stopTime: { fontSize: 13, color: COLORS.primary, ...FONTS.bold, minWidth: 45 },
  stopInfo: { flex: 1 },
  stopTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  stopVenue: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular },
  freeBadge: { backgroundColor: 'rgba(34,197,94,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full },
  freeText: { fontSize: 9, color: '#22C55E', ...FONTS.bold, letterSpacing: 1 },
  priceText: { fontSize: 12, color: COLORS.primary, ...FONTS.bold, minWidth: 40, textAlign: 'right' },
});
