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
  { key: '2026-12-30', day: 'Mié', date: '30', month: 'Dic' },
  { key: '2026-12-31', day: 'Jue', date: '31', month: 'Dic' },
  { key: '2027-01-01', day: 'Vie', date: '1', month: 'Ene' },
  { key: '2027-01-02', day: 'Sáb', date: '2', month: 'Ene' },
  { key: '2027-01-03', day: 'Dom', date: '3', month: 'Ene' },
  { key: '2027-01-04', day: 'Lun', date: '4', month: 'Ene' },
  { key: '2027-01-05', day: 'Mar', date: '5', month: 'Ene' },
  { key: '2027-01-06', day: 'Mié', date: '6', month: 'Ene' },
  { key: '2027-01-07', day: 'Jue', date: '7', month: 'Ene' },
  { key: '2027-01-08', day: 'Vie', date: '8', month: 'Ene' },
  { key: '2027-01-09', day: 'Sáb', date: '9', month: 'Ene' },
  { key: '2027-01-10', day: 'Dom', date: '10', month: 'Ene' },
];

const TYPES = [
  { key: 'all', label: 'Todos', image: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=200&h=200&fit=crop' },
  { key: 'sunset', label: 'Sunset', image: 'https://images.unsplash.com/photo-1651421479936-e24edc3e3143?w=200&h=200&fit=crop' },
  { key: 'concert', label: 'Concierto', image: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=200&h=200&fit=crop' },
  { key: 'wellness', label: 'Wellness', image: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=200&h=200&fit=crop' },
  { key: 'brunch', label: 'Brunch', image: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=200&h=200&fit=crop' },
  { key: 'beach_club', label: 'Beach Club', image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=200&h=200&fit=crop' },
  { key: 'after_party', label: 'After Party', image: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=200&h=200&fit=crop' },
  { key: 'cultural', label: 'Cultural', image: 'https://images.unsplash.com/photo-1583531172005-592f2b1905f0?w=200&h=200&fit=crop' },
];

export default function AgendaScreen() {
  const router = useRouter();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(DATES[0].key);
  const [selectedType, setSelectedType] = useState('all');

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
    if (selectedType === 'all') return events;
    return events.filter(e => e.type === selectedType);
  }, [events, selectedType]);

  const formatPrice = (p: number) => p === 0 ? 'Gratis' : `$${(p / 1000).toFixed(0)}K`;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Agenda</Text>
        <Text style={styles.subtitle}>Programación oficial Amo Cartagena</Text>
      </View>

      {/* Date Selector with Month */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateBar}>
        {DATES.map(d => {
          const isActive = selectedDate === d.key;
          return (
            <TouchableOpacity
              key={d.key}
              style={[styles.dateChip, isActive && styles.dateChipActive]}
              onPress={() => setSelectedDate(d.key)}
            >
              <Text style={[styles.dateDay, isActive && styles.dateTextActive]}>{d.day}</Text>
              <Text style={[styles.dateNum, isActive && styles.dateTextActive]}>{d.date}</Text>
              <Text style={[styles.dateMonth, isActive && styles.dateTextActive]}>{d.month}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Category Filters with Photos */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterBar}>
        {TYPES.map(t => {
          const isActive = selectedType === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.filterChip, isActive && styles.filterChipActive]}
              onPress={() => setSelectedType(t.key)}
            >
              <Image source={{ uri: t.image }} style={styles.filterImage} />
              <View style={[styles.filterImageOverlay, isActive && { backgroundColor: 'rgba(217,119,6,0.3)' }]} />
              <Text style={[styles.filterText, isActive && styles.filterTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
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

  // Date chips with month
  dateBar: { paddingHorizontal: SPACING.lg, gap: SPACING.sm, paddingVertical: SPACING.xs },
  dateChip: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10, borderRadius: RADIUS.xl, backgroundColor: COLORS.surface, borderWidth: 1.5, borderColor: COLORS.border, minWidth: 56 },
  dateChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  dateDay: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
  dateNum: { fontSize: 20, color: COLORS.textMain, ...FONTS.bold, lineHeight: 24 },
  dateMonth: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
  dateTextActive: { color: '#FFF' },

  // Type filters with photos
  filterBar: { paddingHorizontal: SPACING.lg, gap: SPACING.sm, paddingVertical: SPACING.sm },
  filterChip: { borderRadius: RADIUS.xl, overflow: 'hidden', width: 90, height: 110, borderWidth: 1.5, borderColor: COLORS.border, position: 'relative', alignItems: 'center', justifyContent: 'flex-end' },
  filterChipActive: { borderColor: COLORS.primary, borderWidth: 2 },
  filterImage: { position: 'absolute', width: '100%', height: '100%' },
  filterImageOverlay: { position: 'absolute', width: '100%', height: '100%', backgroundColor: 'rgba(5,8,20,0.55)' },
  filterText: { fontSize: 12, color: '#FFF', ...FONTS.bold, paddingBottom: 10, textAlign: 'center', zIndex: 1 },
  filterTextActive: { color: COLORS.primary },

  // Events list
  list: { flex: 1, paddingHorizontal: SPACING.lg },
  eventCard: { borderRadius: RADIUS.xl, overflow: 'hidden', height: 160, marginBottom: SPACING.md },
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
  eventTitle: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold },
  eventMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: SPACING.xs },
  eventMetaText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginRight: 8 },
  empty: { alignItems: 'center', marginTop: 60, gap: SPACING.md },
  emptyText: { fontSize: 15, color: COLORS.textMuted, ...FONTS.regular },
});
