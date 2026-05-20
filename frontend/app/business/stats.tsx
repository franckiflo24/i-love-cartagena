import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useBusinessAuth } from '../../src/context/BusinessAuthContext';
import { useTr } from '../../src/i18n/autoTr';

type StatType = 'upcoming' | 'views' | 'reservations' | 'total';

type BusinessEvent = {
  event_id: string;
  title: string;
  date: string;
  start_time?: string;
  category?: string;
  is_published?: boolean;
  views_count?: number;
  status?: string;
  flyer_url?: string;
};

const META: Record<StatType, { title: string; icon: keyof typeof Ionicons.glyphMap; color: string; subtitle: string }> = {
  upcoming:     { title: 'Eventos próximos',  icon: 'calendar',        color: '#D97706', subtitle: 'Tus eventos publicados desde hoy en adelante' },
  views:        { title: 'Vistas totales',    icon: 'eye',             color: '#22C55E', subtitle: 'Cuántas veces los clientes vieron tus eventos' },
  reservations: { title: 'Reservas',          icon: 'flash',           color: '#A855F7', subtitle: 'Solicitudes recibidas y reservas confirmadas' },
  total:        { title: 'Todos tus eventos', icon: 'layers',          color: '#F59E0B', subtitle: 'Publicados, borradores y archivados' },
};

function formatDate(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('es-CO', { weekday: 'short', day: '2-digit', month: 'short' });
  } catch {
    return iso;
  }
}

export default function StatsDetail() {
  const tr = useTr();
  const router = useRouter();
  const { type } = useLocalSearchParams<{ type?: StatType }>();
  const { token, business } = useBusinessAuth();
  const statType = (type as StatType) || 'upcoming';
  const meta = META[statType] || META.upcoming;

  const [events, setEvents] = useState<BusinessEvent[]>([]);
  const [reservations, setReservations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      if (statType === 'reservations') {
        const data = await api.get('/business/reservations', {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => null);
        // Backend returns { reservations: [...], upgrade_required: bool, ... }
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.reservations)
            ? data.reservations
            : [];
        setReservations(list);
      } else {
        const data = await api.get('/business/events', {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => []);
        setEvents(Array.isArray(data) ? data : []);
      }
    } catch (e) { console.error(e); }
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { load(); }, [statType, token]);

  // ── Derived data per stat type ──
  const filteredEvents = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (statType === 'upcoming') {
      return events.filter(e => (e.date || '') >= today).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    }
    if (statType === 'views') {
      return [...events].sort((a, b) => (b.views_count || 0) - (a.views_count || 0));
    }
    // total
    return [...events].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [events, statType]);

  const totalViews = useMemo(() => events.reduce((sum, e) => sum + (e.views_count || 0), 0), [events]);
  const publishedCount = useMemo(() => events.filter(e => e.is_published).length, [events]);
  const draftCount = events.length - publishedCount;

  const reservationsByStatus = useMemo(() => {
    const buckets: Record<string, any[]> = { pending: [], confirmed: [], rejected: [], cancelled: [], completed: [] };
    for (const r of reservations) {
      const s = r.status || '';
      if (s.includes('pending')) buckets.pending.push(r);
      else if (s === 'confirmed') buckets.confirmed.push(r);
      else if (s.includes('rejected')) buckets.rejected.push(r);
      else if (s.includes('cancelled') || s === 'no_show') buckets.cancelled.push(r);
      else if (s === 'completed') buckets.completed.push(r);
    }
    return buckets;
  }, [reservations]);

  const onRefresh = () => { setRefreshing(true); load(); };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity testID="stats-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View style={[styles.heroIcon, { backgroundColor: meta.color + '22', borderColor: meta.color }]}>
          <Ionicons name={meta.icon} size={20} color={meta.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{tr(meta.title)}</Text>
          <Text style={styles.subtitle} numberOfLines={2}>{tr(meta.subtitle)}</Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 60 }} />
        ) : (
          <>
            {/* KPI banner specific to each type */}
            {statType === 'upcoming' && (
              <View style={[styles.kpiBanner, { borderColor: meta.color }]}>
                <Text style={[styles.kpiNumber, { color: meta.color }]}>{filteredEvents.length}</Text>
                <Text style={styles.kpiLabel}>{tr('eventos publicados desde hoy')}</Text>
              </View>
            )}
            {statType === 'views' && (
              <View style={[styles.kpiBanner, { borderColor: meta.color }]}>
                <Text style={[styles.kpiNumber, { color: meta.color }]}>{totalViews}</Text>
                <Text style={styles.kpiLabel}>{tr('vistas totales en todos tus eventos')}</Text>
              </View>
            )}
            {statType === 'total' && (
              <View style={[styles.kpiBanner, { borderColor: meta.color, flexDirection: 'row', justifyContent: 'space-around' }]}>
                <View style={{ alignItems: 'center', flex: 1 }}>
                  <Text style={[styles.kpiNumber, { color: meta.color }]}>{events.length}</Text>
                  <Text style={styles.kpiLabel}>{tr('total')}</Text>
                </View>
                <View style={{ alignItems: 'center', flex: 1 }}>
                  <Text style={[styles.kpiNumber, { color: '#22C55E' }]}>{publishedCount}</Text>
                  <Text style={styles.kpiLabel}>{tr('publicados')}</Text>
                </View>
                <View style={{ alignItems: 'center', flex: 1 }}>
                  <Text style={[styles.kpiNumber, { color: COLORS.textMuted }]}>{draftCount}</Text>
                  <Text style={styles.kpiLabel}>{tr('borradores')}</Text>
                </View>
              </View>
            )}
            {statType === 'reservations' && (
              <View style={[styles.kpiBanner, { borderColor: meta.color, flexDirection: 'row', justifyContent: 'space-around' }]}>
                <View style={{ alignItems: 'center', flex: 1 }}>
                  <Text style={[styles.kpiNumber, { color: '#F59E0B' }]}>{reservationsByStatus.pending.length}</Text>
                  <Text style={styles.kpiLabel}>{tr('pendientes')}</Text>
                </View>
                <View style={{ alignItems: 'center', flex: 1 }}>
                  <Text style={[styles.kpiNumber, { color: '#22C55E' }]}>{reservationsByStatus.confirmed.length}</Text>
                  <Text style={styles.kpiLabel}>{tr('confirmadas')}</Text>
                </View>
                <View style={{ alignItems: 'center', flex: 1 }}>
                  <Text style={[styles.kpiNumber, { color: '#EF4444' }]}>{reservationsByStatus.rejected.length}</Text>
                  <Text style={styles.kpiLabel}>{tr('rechazadas')}</Text>
                </View>
              </View>
            )}

            {/* List */}
            {statType === 'reservations' ? (
              reservations.length === 0 ? (
                <EmptyState icon="bookmark-outline" text={tr('Aún no tienes reservas.')} />
              ) : (
                <>
                  {reservationsByStatus.pending.length > 0 && (
                    <SectionTitle label={tr('Pendientes')} count={reservationsByStatus.pending.length} color="#F59E0B" />
                  )}
                  {reservationsByStatus.pending.map((r: any) => (
                    <ReservationItem key={r.reservation_id} r={r} onPress={() => router.push('/business/reservations' as any)} />
                  ))}
                  {reservationsByStatus.confirmed.length > 0 && (
                    <SectionTitle label={tr('Confirmadas')} count={reservationsByStatus.confirmed.length} color="#22C55E" />
                  )}
                  {reservationsByStatus.confirmed.map((r: any) => (
                    <ReservationItem key={r.reservation_id} r={r} onPress={() => router.push('/business/reservations' as any)} />
                  ))}
                  {reservationsByStatus.rejected.length > 0 && (
                    <SectionTitle label={tr('Rechazadas')} count={reservationsByStatus.rejected.length} color="#EF4444" />
                  )}
                  {reservationsByStatus.rejected.map((r: any) => (
                    <ReservationItem key={r.reservation_id} r={r} onPress={() => router.push('/business/reservations' as any)} />
                  ))}
                  {(reservationsByStatus.cancelled.length + reservationsByStatus.completed.length) > 0 && (
                    <SectionTitle label={tr('Otros')} count={reservationsByStatus.cancelled.length + reservationsByStatus.completed.length} color={COLORS.textMuted as any} />
                  )}
                  {[...reservationsByStatus.cancelled, ...reservationsByStatus.completed].map((r: any) => (
                    <ReservationItem key={r.reservation_id} r={r} onPress={() => router.push('/business/reservations' as any)} />
                  ))}
                </>
              )
            ) : filteredEvents.length === 0 ? (
              <EmptyState icon="calendar-outline" text={tr('Sin eventos en esta categoría todavía.')} />
            ) : (
              filteredEvents.map(ev => (
                <TouchableOpacity
                  key={ev.event_id}
                  style={styles.eventCard}
                  onPress={() => router.push(`/business/event-form?id=${ev.event_id}` as any)}
                  activeOpacity={0.85}
                >
                  <View style={styles.eventLeftRail}>
                    <Text style={styles.eventDay}>{ev.date ? new Date(ev.date + 'T00:00:00').getDate() : '?'}</Text>
                    <Text style={styles.eventMonth}>{ev.date ? new Date(ev.date + 'T00:00:00').toLocaleDateString('es', { month: 'short' }).toUpperCase() : ''}</Text>
                  </View>
                  <View style={{ flex: 1, paddingHorizontal: SPACING.sm }}>
                    <Text style={styles.eventTitle} numberOfLines={2}>{ev.title}</Text>
                    <View style={styles.eventMetaRow}>
                      {ev.start_time ? (
                        <View style={styles.metaItem}>
                          <Ionicons name="time-outline" size={11} color={COLORS.textMuted} />
                          <Text style={styles.metaText}>{ev.start_time}</Text>
                        </View>
                      ) : null}
                      {ev.category ? (
                        <View style={styles.metaItem}>
                          <Ionicons name="pricetag-outline" size={11} color={COLORS.textMuted} />
                          <Text style={styles.metaText}>{ev.category}</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.eventStatsRow}>
                      <View style={[styles.viewsPill, { backgroundColor: '#22C55E22', borderColor: '#22C55E55' }]}>
                        <Ionicons name="eye" size={11} color="#22C55E" />
                        <Text style={[styles.viewsPillText, { color: '#22C55E' }]}>{ev.views_count || 0}</Text>
                      </View>
                      {ev.is_published ? (
                        <View style={[styles.statusBadge, { backgroundColor: '#22C55E22' }]}>
                          <Text style={[styles.statusText, { color: '#22C55E' }]}>{tr('publicado')}</Text>
                        </View>
                      ) : (
                        <View style={[styles.statusBadge, { backgroundColor: 'rgba(148,163,184,0.18)' }]}>
                          <Text style={[styles.statusText, { color: COLORS.textMuted }]}>{tr('borrador')}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                </TouchableOpacity>
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionTitle({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <View style={styles.sectionTitleRow}>
      <View style={[styles.sectionDot, { backgroundColor: color }]} />
      <Text style={styles.sectionTitleText}>{label}</Text>
      <Text style={styles.sectionCount}>{count}</Text>
    </View>
  );
}

function EmptyState({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.emptyState}>
      <Ionicons name={icon} size={48} color={COLORS.textMuted} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function ReservationItem({ r, onPress }: { r: any; onPress: () => void }) {
  const tr = useTr();
  const statusColor: Record<string, string> = {
    pending_confirmation: '#F59E0B',
    pending_partner_activation: '#F59E0B',
    confirmed: '#22C55E',
    rejected_by_partner: '#EF4444',
    cancelled_by_user: '#94A3B8',
    cancelled_late: '#EF4444',
    completed: '#22C55E',
    no_show: '#EF4444',
  };
  const color = statusColor[r.status] || COLORS.textMuted;
  // Backend returns either full user_name (PRO) or user_masked (FREE).
  const displayName =
    r.user_name || r.user_masked || r.client_name || r.contact_name || tr('Cliente');
  const phone = r.user_phone || r.contact_phone;
  const email = r.user_email || r.contact_email;
  // Day label
  let dayLabel = r.date || '';
  try {
    if (r.date) {
      const d = new Date(r.date + 'T00:00:00');
      dayLabel = d.toLocaleDateString('es-CO', { weekday: 'long', day: '2-digit', month: 'short' });
      // Capitalize first letter
      dayLabel = dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);
    }
  } catch { /* ignore */ }

  return (
    <TouchableOpacity style={styles.resItemDetailed} onPress={onPress} activeOpacity={0.85}>
      <View style={[styles.resStripe, { backgroundColor: color }]} />
      <View style={{ flex: 1, padding: SPACING.md, gap: 6 }}>
        {/* Top row: name + party size pill */}
        <View style={styles.resTopRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
            <Ionicons name="person-circle" size={18} color={color} />
            <Text style={styles.resNameBold} numberOfLines={1}>{displayName}</Text>
          </View>
          <View style={[styles.partyPill, { backgroundColor: color + '22', borderColor: color + '55' }]}>
            <Ionicons name="people" size={12} color={color} />
            <Text style={[styles.partyPillText, { color }]}>
              {r.party_size} {r.party_size === 1 ? tr('pax') : tr('pax')}
            </Text>
          </View>
        </View>

        {/* Day + Time row */}
        <View style={styles.resDayTimeRow}>
          <View style={styles.resDayTimeItem}>
            <Ionicons name="calendar-outline" size={13} color={COLORS.textMuted} />
            <Text style={styles.resDayTimeText}>{dayLabel}</Text>
          </View>
          {r.time ? (
            <View style={styles.resDayTimeItem}>
              <Ionicons name="time-outline" size={13} color={COLORS.textMuted} />
              <Text style={[styles.resDayTimeText, { color: COLORS.textMain, ...FONTS.bold }]}>{r.time}</Text>
            </View>
          ) : null}
          {r.event?.title ? (
            <View style={styles.resDayTimeItem}>
              <Ionicons name="sparkles" size={12} color="#A855F7" />
              <Text style={[styles.resDayTimeText, { color: '#A855F7' }]} numberOfLines={1}>{r.event.title}</Text>
            </View>
          ) : null}
        </View>

        {/* Optional: phone / email — only if backend gave us details (PRO partner) */}
        {(phone || email) ? (
          <View style={styles.resContactRow}>
            {phone ? (
              <View style={styles.resContactItem}>
                <Ionicons name="call-outline" size={11} color={COLORS.primary} />
                <Text style={styles.resContactText} numberOfLines={1}>{phone}</Text>
              </View>
            ) : null}
            {email ? (
              <View style={styles.resContactItem}>
                <Ionicons name="mail-outline" size={11} color={COLORS.primary} />
                <Text style={styles.resContactText} numberOfLines={1}>{email}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Notes */}
        {r.notes ? (
          <View style={styles.resNotesBlock}>
            <Ionicons name="chatbox-ellipses-outline" size={11} color={COLORS.textMuted} />
            <Text style={styles.resNotesText} numberOfLines={3}>"{r.notes}"</Text>
          </View>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} style={{ marginRight: SPACING.sm, alignSelf: 'center' }} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SPACING.md,
  },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  heroIcon: { width: 40, height: 40, borderRadius: RADIUS.lg, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  title: { fontSize: 17, color: COLORS.textMain, ...FONTS.bold },
  subtitle: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },

  kpiBanner: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.lg,
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  kpiNumber: { fontSize: 36, ...FONTS.bold, letterSpacing: -1 },
  kpiLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, marginTop: 4, textAlign: 'center' },

  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SPACING.md, marginBottom: SPACING.xs },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitleText: { fontSize: 13, color: COLORS.textMain, ...FONTS.bold, flex: 1 },
  sectionCount: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold },

  eventCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border,
    padding: SPACING.sm, marginBottom: SPACING.sm,
  },
  eventLeftRail: { width: 50, alignItems: 'center', paddingVertical: 4 },
  eventDay: { fontSize: 20, color: COLORS.primary, ...FONTS.bold },
  eventMonth: { fontSize: 9, color: COLORS.textMuted, ...FONTS.bold, letterSpacing: 1 },
  eventTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  eventMetaRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: 4 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
  eventStatsRow: { flexDirection: 'row', gap: 5, marginTop: 6 },
  viewsPill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: RADIUS.full, borderWidth: 1 },
  viewsPillText: { fontSize: 11, ...FONTS.bold },
  statusBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: RADIUS.full },
  statusText: { fontSize: 10, ...FONTS.bold, letterSpacing: 0.3 },

  resItem: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border,
    marginBottom: SPACING.sm, overflow: 'hidden', alignItems: 'center',
  },
  resItemDetailed: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.sm,
    overflow: 'hidden',
  },
  resStripe: { width: 4, alignSelf: 'stretch' },
  resName: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  resNameBold: { fontSize: 15, color: COLORS.textMain, ...FONTS.bold, flex: 1 },
  resTopRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  partyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  partyPillText: { fontSize: 11, ...FONTS.bold, letterSpacing: 0.3 },
  resDayTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  resDayTimeItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  resDayTimeText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium },
  resContactRow: { flexDirection: 'row', gap: 12, marginTop: 2, flexWrap: 'wrap' },
  resContactItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  resContactText: { fontSize: 11, color: COLORS.primary, ...FONTS.semibold },
  resNotesBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: RADIUS.md,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginTop: 2,
  },
  resNotesText: { flex: 1, fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, fontStyle: 'italic', lineHeight: 15 },

  emptyState: { alignItems: 'center', marginTop: 40, gap: SPACING.sm },
  emptyText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center' },
});
