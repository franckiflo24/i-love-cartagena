import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS, TIER_COLORS, Tier } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { PartnerEventCard, PartnerEvent } from '../../src/components/PartnerEventCard';
import { useMyCalendar, CalendarItem } from '../../src/context/MyCalendarContext';
import { TierBadge } from '../../src/components/TierBadge';

type Mode = 'salir' | 'mi_agenda';

const PARTNER_CATEGORIES = [
  { key: 'all', label: 'Todos', icon: 'apps' },
  { key: 'gastronomy', label: 'Gastronomía', icon: 'restaurant' },
  { key: 'music', label: 'Música', icon: 'musical-notes' },
  { key: 'party', label: 'Fiesta', icon: 'wine' },
  { key: 'wellness', label: 'Wellness', icon: 'leaf' },
  { key: 'art', label: 'Arte & Cultura', icon: 'color-palette' },
  { key: 'popup', label: 'Pop-up', icon: 'bag-handle' },
];

const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const DAYS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const generateUpcomingDates = () => {
  const today = new Date();
  const dates = [];
  for (let i = 0; i < 14; i++) {
    const dt = new Date(today);
    dt.setDate(today.getDate() + i);
    const iso = dt.toISOString().slice(0, 10);
    dates.push({
      key: iso,
      day: i === 0 ? 'Hoy' : i === 1 ? 'Mañ' : DAYS_ES[dt.getDay()],
      date: String(dt.getDate()),
      month: MONTHS_ES[dt.getMonth()],
      isToday: i === 0,
    });
  }
  return dates;
};

const formatLongDate = (iso: string) => {
  try {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  } catch { return iso; }
};

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function AgendaScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<Mode>('salir');

  // React to mode query param (e.g., from "Mi Agenda" quick access in Home)
  useEffect(() => {
    if (params.mode === 'mi_agenda' || params.mode === 'salir') {
      setMode(params.mode as Mode);
    }
  }, [params.mode]);

  // Salir (Partner) state
  const upcomingDates = useMemo(() => generateUpcomingDates(), []);
  const [selectedSalirDate, setSelectedSalirDate] = useState(upcomingDates[0].key);
  const [selectedSalirCat, setSelectedSalirCat] = useState('all');
  const [partnerEvents, setPartnerEvents] = useState<PartnerEvent[]>([]);
  const [loadingSalir, setLoadingSalir] = useState(false);

  // Mi Agenda state
  const { items: calendarItems, removeFromCalendar, refresh } = useMyCalendar();
  const [showPast, setShowPast] = useState(false);

  const loadPartnerEvents = useCallback(async () => {
    setLoadingSalir(true);
    try {
      const params = new URLSearchParams({ date: selectedSalirDate });
      if (selectedSalirCat !== 'all') params.append('category', selectedSalirCat);
      const data = await api.get(`/partner-events?${params.toString()}`);
      setPartnerEvents(data);
    } catch (e) { console.error(e); }
    setLoadingSalir(false);
  }, [selectedSalirDate, selectedSalirCat]);

  useEffect(() => {
    if (mode === 'salir') loadPartnerEvents();
    if (mode === 'mi_agenda') refresh();
  }, [loadPartnerEvents, mode, refresh]);

  // Group calendar items by date
  const groupedAgenda = useMemo(() => {
    const t = todayIso();
    const filtered = showPast
      ? calendarItems
      : calendarItems.filter(i => i.date >= t);
    const sorted = [...filtered].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return (a.start_time || '').localeCompare(b.start_time || '');
    });
    const groups: Record<string, CalendarItem[]> = {};
    sorted.forEach(it => {
      if (!groups[it.date]) groups[it.date] = [];
      groups[it.date].push(it);
    });
    return Object.entries(groups);
  }, [calendarItems, showPast]);

  const pastCount = useMemo(() => {
    const t = todayIso();
    return calendarItems.filter(i => i.date < t).length;
  }, [calendarItems]);

  const handleRemove = (item: CalendarItem) => {
    Alert.alert(
      'Quitar de mi agenda',
      `¿Quitar "${item.title || 'este evento'}" de tu agenda?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Quitar', style: 'destructive', onPress: () => removeFromCalendar(item.item_id) },
      ]
    );
  };

  const handleOpenItem = (item: CalendarItem) => {
    if (item.item_type === 'partner_event') router.push(`/partner-event/${item.item_id}` as any);
    else if (item.item_type === 'event') router.push(`/event/${item.item_id}` as any);
    else if (item.item_type === 'concert') router.push('/concerts' as any);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header with segmented control */}
      <View style={styles.header}>
        <Text style={styles.title}>Agenda</Text>
        <Text style={styles.subtitle}>
          {mode === 'salir' ? 'Qué hacer hoy en Cartagena' : 'Tus eventos guardados'}
        </Text>
        <View style={styles.segmentedControl}>
          <TouchableOpacity
            style={[styles.segment, mode === 'salir' && styles.segmentActive]}
            onPress={() => setMode('salir')}
            activeOpacity={0.85}
          >
            <Ionicons name="sparkles" size={14} color={mode === 'salir' ? COLORS.white : COLORS.textMuted} />
            <Text style={[styles.segmentText, mode === 'salir' && styles.segmentTextActive]}>
              Salir Hoy
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segment, mode === 'mi_agenda' && styles.segmentActive]}
            onPress={() => setMode('mi_agenda')}
            activeOpacity={0.85}
          >
            <Ionicons name="calendar" size={14} color={mode === 'mi_agenda' ? COLORS.white : COLORS.textMuted} />
            <Text style={[styles.segmentText, mode === 'mi_agenda' && styles.segmentTextActive]}>
              Mi Agenda
            </Text>
            {calendarItems.length > 0 && (
              <View style={[styles.badge, mode === 'mi_agenda' && styles.badgeActive]}>
                <Text style={[styles.badgeText, mode === 'mi_agenda' && styles.badgeTextActive]}>
                  {calendarItems.length}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {mode === 'salir' ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateBar}>
            {upcomingDates.map(d => {
              const isActive = selectedSalirDate === d.key;
              return (
                <TouchableOpacity
                  key={d.key}
                  style={[styles.dateChip, isActive && styles.dateChipActive, d.isToday && styles.dateChipToday]}
                  onPress={() => setSelectedSalirDate(d.key)}
                >
                  <Text style={[styles.dateDay, isActive && styles.dateTextActive]}>{d.day}</Text>
                  <Text style={[styles.dateNum, isActive && styles.dateTextActive]}>{d.date}</Text>
                  <Text style={[styles.dateMonth, isActive && styles.dateTextActive]}>{d.month}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catBar}>
            {PARTNER_CATEGORIES.map(c => {
              const isActive = selectedSalirCat === c.key;
              return (
                <TouchableOpacity
                  key={c.key}
                  style={[styles.catChip, isActive && styles.catChipActive]}
                  onPress={() => setSelectedSalirCat(c.key)}
                >
                  <Ionicons name={c.icon as any} size={13} color={isActive ? COLORS.white : COLORS.textMuted} />
                  <Text style={[styles.catChipText, isActive && styles.catChipTextActive]}>
                    {c.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {loadingSalir ? (
              <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
            ) : partnerEvents.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="calendar-outline" size={48} color={COLORS.textMuted} />
                <Text style={styles.emptyTitle}>No hay eventos para este día</Text>
                <Text style={styles.emptyText}>Prueba otra fecha o categoría</Text>
              </View>
            ) : (
              <>
                <View style={styles.resultsHeader}>
                  <Text style={styles.resultsCount}>
                    {partnerEvents.length} evento{partnerEvents.length !== 1 ? 's' : ''}
                  </Text>
                </View>
                {partnerEvents.map(e => (
                  <PartnerEventCard
                    key={e.event_id}
                    event={e}
                    onPress={() => router.push(`/partner-event/${e.event_id}` as any)}
                  />
                ))}
              </>
            )}
            <View style={{ height: SPACING.xxl }} />
          </ScrollView>
        </>
      ) : (
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: SPACING.xxl }}>
          {calendarItems.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="calendar-outline" size={56} color={COLORS.textMuted} />
              <Text style={styles.emptyTitle}>Tu agenda está vacía</Text>
              <Text style={styles.emptyText}>
                Añade eventos pulsando "Añadir a mi agenda" en cualquier evento de partner
              </Text>
              <TouchableOpacity
                style={styles.exploreBtn}
                onPress={() => setMode('salir')}
                activeOpacity={0.85}
              >
                <Ionicons name="sparkles" size={14} color={COLORS.white} />
                <Text style={styles.exploreBtnText}>Explorar eventos</Text>
              </TouchableOpacity>
            </View>
          ) : groupedAgenda.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="checkmark-done-circle-outline" size={56} color={COLORS.textMuted} />
              <Text style={styles.emptyTitle}>No tienes próximos eventos</Text>
              <Text style={styles.emptyText}>Tu agenda está al día</Text>
              {pastCount > 0 && (
                <TouchableOpacity
                  style={styles.exploreBtn}
                  onPress={() => setShowPast(true)}
                  activeOpacity={0.85}
                >
                  <Ionicons name="time-outline" size={14} color={COLORS.white} />
                  <Text style={styles.exploreBtnText}>
                    Ver pasados ({pastCount})
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <>
              {/* Toggle past events */}
              {pastCount > 0 && (
                <TouchableOpacity
                  style={styles.pastToggle}
                  onPress={() => setShowPast(p => !p)}
                  activeOpacity={0.8}
                >
                  <Ionicons name={showPast ? 'eye-off-outline' : 'time-outline'} size={14} color={COLORS.textMuted} />
                  <Text style={styles.pastToggleText}>
                    {showPast ? `Ocultar pasados (${pastCount})` : `Mostrar pasados (${pastCount})`}
                  </Text>
                </TouchableOpacity>
              )}

              {groupedAgenda.map(([date, dayItems]) => {
                const t = todayIso();
                const isPastDay = date < t;
                return (
                  <View key={date} style={styles.dayGroup}>
                    <View style={styles.dayHeader}>
                      <View style={styles.dayDot} />
                      <Text style={styles.dayHeaderText}>{formatLongDate(date)}</Text>
                      {date === t && (
                        <View style={styles.todayPill}>
                          <Text style={styles.todayPillText}>HOY</Text>
                        </View>
                      )}
                      {isPastDay && (
                        <View style={styles.pastPill}>
                          <Text style={styles.pastPillText}>PASADO</Text>
                        </View>
                      )}
                    </View>
                    {dayItems.map(it => {
                      const tierColors = it.partner_tier ? TIER_COLORS[it.partner_tier as Tier] : null;
                      return (
                        <TouchableOpacity
                          key={it.item_id}
                          style={[styles.agendaCard, isPastDay && { opacity: 0.6 }]}
                          activeOpacity={0.85}
                          onPress={() => handleOpenItem(it)}
                        >
                          {it.flyer_url ? (
                            <View style={styles.agendaFlyerWrap}>
                              <Image source={{ uri: it.flyer_url }} style={styles.agendaFlyer} />
                              <View style={styles.agendaFlyerOverlay} />
                              {tierColors && <View style={[styles.tierStripe, { backgroundColor: tierColors.main }]} />}
                            </View>
                          ) : (
                            <View style={[styles.agendaFlyerWrap, styles.agendaFlyerPlaceholder]}>
                              <Ionicons name="calendar" size={28} color={COLORS.primary} />
                            </View>
                          )}
                          <View style={styles.agendaBody}>
                            <View style={styles.agendaTopRow}>
                              {it.start_time && (
                                <View style={styles.timePill}>
                                  <Ionicons name="time-outline" size={11} color={COLORS.primary} />
                                  <Text style={styles.timePillText}>
                                    {it.start_time}{it.end_time ? ` - ${it.end_time}` : ''}
                                  </Text>
                                </View>
                              )}
                              {it.is_free !== undefined && (
                                <View style={[styles.pricePill, it.is_free ? styles.priceFreeBg : styles.pricePaidBg]}>
                                  <Text style={styles.pricePillText}>
                                    {it.is_free ? 'GRATIS' : `$${((it.price || 0) / 1000).toFixed(0)}K`}
                                  </Text>
                                </View>
                              )}
                            </View>
                            <Text style={styles.agendaTitle} numberOfLines={2}>
                              {it.title || 'Evento'}
                            </Text>
                            {it.partner_name ? (
                              <View style={styles.partnerRow}>
                                <Ionicons name="business-outline" size={11} color={COLORS.textMuted} />
                                <Text style={styles.partnerText} numberOfLines={1}>{it.partner_name}</Text>
                                <TierBadge tier={it.partner_tier} size="xs" />
                              </View>
                            ) : null}
                          </View>
                          <TouchableOpacity
                            style={styles.removeBtn}
                            onPress={() => handleRemove(it)}
                            hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}
                          >
                            <Ionicons name="close" size={16} color={COLORS.textMuted} />
                          </TouchableOpacity>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              })}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.xs },
  title: { fontSize: 28, color: COLORS.textMain, ...FONTS.bold },
  subtitle: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },

  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.full,
    padding: 4,
    marginTop: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: RADIUS.full,
  },
  segmentActive: { backgroundColor: COLORS.primary },
  segmentText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.semibold },
  segmentTextActive: { color: COLORS.white, ...FONTS.bold },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  badgeText: { fontSize: 10, color: COLORS.white, ...FONTS.bold },
  badgeTextActive: { color: COLORS.white },

  // Date chips
  dateBar: { paddingHorizontal: SPACING.lg, gap: SPACING.sm, paddingVertical: SPACING.sm },
  dateChip: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10, borderRadius: RADIUS.xl, backgroundColor: COLORS.surface, borderWidth: 1.5, borderColor: COLORS.border, minWidth: 56 },
  dateChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  dateChipToday: { borderColor: 'rgba(217,119,6,0.5)' },
  dateDay: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
  dateNum: { fontSize: 20, color: COLORS.textMain, ...FONTS.bold, lineHeight: 24 },
  dateMonth: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
  dateTextActive: { color: '#FFF' },

  catBar: { paddingHorizontal: SPACING.lg, gap: SPACING.xs, paddingVertical: SPACING.xs },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  catChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  catChipText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold },
  catChipTextActive: { color: COLORS.white },

  list: { flex: 1, paddingHorizontal: SPACING.lg, marginTop: SPACING.xs },
  resultsHeader: { paddingVertical: SPACING.sm },
  resultsCount: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium, letterSpacing: 0.5 },

  empty: { alignItems: 'center', marginTop: 60, gap: SPACING.sm, paddingHorizontal: SPACING.lg },
  emptyTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.semibold, marginTop: SPACING.xs },
  emptyText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', lineHeight: 19 },
  exploreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: RADIUS.full,
    marginTop: SPACING.md,
  },
  exploreBtnText: { fontSize: 13, color: COLORS.white, ...FONTS.bold },

  // Mi Agenda day grouping
  pastToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-end',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginVertical: SPACING.sm,
  },
  pastToggleText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.semibold },

  dayGroup: { marginBottom: SPACING.lg },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginBottom: SPACING.sm,
    marginTop: SPACING.sm,
  },
  dayDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.primary },
  dayHeaderText: {
    fontSize: 13,
    color: COLORS.textMain,
    ...FONTS.bold,
    textTransform: 'capitalize',
    flex: 1,
  },
  todayPill: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  todayPillText: { fontSize: 9, color: COLORS.white, ...FONTS.bold, letterSpacing: 0.8 },
  pastPill: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: RADIUS.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pastPillText: { fontSize: 9, color: COLORS.textMuted, ...FONTS.bold, letterSpacing: 0.8 },

  // Agenda card
  agendaCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    overflow: 'hidden',
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    position: 'relative',
  },
  agendaFlyerWrap: { width: 92, height: 110, position: 'relative' },
  agendaFlyer: { width: '100%', height: '100%' },
  agendaFlyerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.18)' },
  agendaFlyerPlaceholder: {
    backgroundColor: 'rgba(217,119,6,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tierStripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },

  agendaBody: { flex: 1, padding: SPACING.sm, justifyContent: 'space-between', paddingRight: 32 },
  agendaTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  timePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(217,119,6,0.15)',
    borderRadius: RADIUS.full,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  timePillText: { fontSize: 10, color: COLORS.primary, ...FONTS.bold },
  pricePill: { borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2 },
  priceFreeBg: { backgroundColor: COLORS.success },
  pricePaidBg: { backgroundColor: 'rgba(5,8,20,0.6)', borderWidth: 1, borderColor: COLORS.primary },
  pricePillText: { fontSize: 9, color: COLORS.white, ...FONTS.bold, letterSpacing: 0.4 },

  agendaTitle: { fontSize: 13, color: COLORS.textMain, ...FONTS.bold, marginTop: 4, lineHeight: 17 },
  partnerRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  partnerText: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium, flex: 1 },

  removeBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
