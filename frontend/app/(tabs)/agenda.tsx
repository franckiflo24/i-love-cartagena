import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS, EVENT_TYPE_LABELS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';

type Event = {
  event_id: string; title: string; description: string; date: string;
  start_time: string; end_time: string; venue_name: string; type: string;
  is_free: boolean; price: number; image_url: string;
};

const DATES = [
  { key: '2026-01-12', label: 'Lun 12' },
  { key: '2026-01-13', label: 'Mar 13' },
  { key: '2026-01-14', label: 'Mié 14' },
  { key: '2026-01-15', label: 'Jue 15' },
  { key: '2026-01-16', label: 'Vie 16' },
];

const TYPES = ['all', 'sunset', 'concert', 'wellness', 'brunch', 'beach_club', 'after_party', 'cultural', 'candlelight', 'pop_up'];

export default function AgendaScreen() {
  const router = useRouter();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(DATES[0].key);
  const [selectedType, setSelectedType] = useState('all');
  const [showFreeOnly, setShowFreeOnly] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await api.get(`/events?date=${selectedDate}`);
        setEvents(data);
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    load();
  }, [selectedDate]);

  const filtered = useMemo(() => {
    let list = events;
    if (selectedType !== 'all') list = list.filter(e => e.type === selectedType);
    if (showFreeOnly) list = list.filter(e => e.is_free);
    return list;
  }, [events, selectedType, showFreeOnly]);

  const formatPrice = (p: number) => p === 0 ? 'Gratis' : `$${(p / 1000).toFixed(0)}K`;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Agenda</Text>
        <Text style={styles.subtitle}>Programación oficial Amo Cartagena</Text>
      </View>

      {/* Date Selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateBar}>
        {DATES.map(d => (
          <TouchableOpacity
            key={d.key}
            testID={`date-${d.key}`}
            style={[styles.dateChip, selectedDate === d.key && styles.dateChipActive]}
            onPress={() => setSelectedDate(d.key)}
          >
            <Text style={[styles.dateText, selectedDate === d.key && styles.dateTextActive]}>{d.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Type Filters */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterBar}>
        {TYPES.map(t => (
          <TouchableOpacity
            key={t}
            testID={`filter-${t}`}
            style={[styles.filterChip, selectedType === t && styles.filterChipActive]}
            onPress={() => setSelectedType(t)}
          >
            <Text style={[styles.filterText, selectedType === t && styles.filterTextActive]}>
              {t === 'all' ? 'Todos' : EVENT_TYPE_LABELS[t] || t}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          testID="filter-free"
          style={[styles.filterChip, showFreeOnly && styles.filterChipFree]}
          onPress={() => setShowFreeOnly(!showFreeOnly)}
        >
          <Text style={[styles.filterText, showFreeOnly && styles.filterTextFree]}>Gratis</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Events List */}
      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>No hay eventos para estos filtros</Text>
          </View>
        ) : (
          filtered.map(event => (
            <TouchableOpacity
              key={event.event_id}
              testID={`agenda-${event.event_id}`}
              style={styles.eventCard}
              onPress={() => router.push(`/event/${event.event_id}`)}
              activeOpacity={0.8}
            >
              <Image source={{ uri: event.image_url }} style={styles.eventImage} />
              <View style={styles.eventOverlay} />
              <View style={styles.eventContent}>
                <View style={styles.eventTop}>
                  <View style={styles.eventTypeBadge}>
                    <Text style={styles.eventTypeText}>{EVENT_TYPE_LABELS[event.type] || event.type}</Text>
                  </View>
                  <View style={[styles.priceBadge, event.is_free ? styles.freeBadge : styles.paidBadge]}>
                    <Text style={styles.priceText}>{event.is_free ? 'GRATIS' : formatPrice(event.price)}</Text>
                  </View>
                </View>
                <View style={styles.eventBottom}>
                  <Text style={styles.eventTitle}>{event.title}</Text>
                  <View style={styles.eventMeta}>
                    <Ionicons name="time-outline" size={14} color={COLORS.textMuted} />
                    <Text style={styles.eventMetaText}>{event.start_time} - {event.end_time}</Text>
                    <Ionicons name="location-outline" size={14} color={COLORS.textMuted} />
                    <Text style={styles.eventMetaText}>{event.venue_name}</Text>
                  </View>
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
  dateBar: { paddingHorizontal: SPACING.lg, gap: SPACING.sm, paddingVertical: SPACING.sm },
  dateChip: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.full, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  dateChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  dateText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.semibold },
  dateTextActive: { color: COLORS.white },
  filterBar: { paddingHorizontal: SPACING.lg, gap: SPACING.sm, paddingVertical: SPACING.sm },
  filterChip: { paddingHorizontal: SPACING.md, paddingVertical: 6, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border },
  filterChipActive: { borderColor: COLORS.primary, backgroundColor: 'rgba(217, 119, 6, 0.15)' },
  filterChipFree: { borderColor: COLORS.success, backgroundColor: 'rgba(34, 197, 94, 0.15)' },
  filterText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium },
  filterTextActive: { color: COLORS.primary },
  filterTextFree: { color: COLORS.success },
  list: { flex: 1, paddingHorizontal: SPACING.lg },
  eventCard: { borderRadius: RADIUS.xl, overflow: 'hidden', height: 180, marginBottom: SPACING.md },
  eventImage: { width: '100%', height: '100%', position: 'absolute' },
  eventOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  eventContent: { flex: 1, justifyContent: 'space-between', padding: SPACING.md },
  eventTop: { flexDirection: 'row', justifyContent: 'space-between' },
  eventTypeBadge: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4 },
  eventTypeText: { fontSize: 10, color: COLORS.textMain, ...FONTS.bold, letterSpacing: 1, textTransform: 'uppercase' },
  priceBadge: { borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4 },
  freeBadge: { backgroundColor: COLORS.success },
  paidBadge: { backgroundColor: COLORS.primary },
  priceText: { fontSize: 11, color: COLORS.white, ...FONTS.bold },
  eventBottom: {},
  eventTitle: { fontSize: 20, color: COLORS.textMain, ...FONTS.bold },
  eventMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: SPACING.xs },
  eventMetaText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginRight: 8 },
  empty: { alignItems: 'center', marginTop: 60, gap: SPACING.md },
  emptyText: { fontSize: 15, color: COLORS.textMuted, ...FONTS.regular },
});
