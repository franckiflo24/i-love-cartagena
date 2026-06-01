import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  COLORS,
  SPACING,
  RADIUS,
  FONTS,
} from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useTr } from '../../src/i18n/autoTr';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ── Types ─────────────────────────────────────────────────────────────────────

type BookingType = 'reservation' | 'experience' | 'citypass' | 'porttax';

type TabKey = 'upcoming' | 'past' | 'cancelled';

interface UnifiedBooking {
  id: string;
  type: BookingType;
  title: string;
  partnerName?: string;
  date?: string;
  status: string;
  raw: Record<string, unknown>;
}

// Status bucket classification
const UPCOMING_STATUSES = new Set([
  'pending_confirmation',
  'confirmed',
  'pending_partner_activation',
  'paid',
  'active',
  'pending',
]);

const PAST_STATUSES = new Set([
  'completed',
  'no_show',
  'expired',
  'used',
]);

const CANCELLED_STATUSES = new Set([
  'cancelled_by_user',
  'cancelled_late',
  'rejected_by_partner',
  'cancelled',
  'rejected',
]);

const getTabForStatus = (status: string): TabKey => {
  const s = (status || '').toLowerCase();
  if (UPCOMING_STATUSES.has(s)) return 'upcoming';
  if (PAST_STATUSES.has(s)) return 'past';
  if (CANCELLED_STATUSES.has(s)) return 'cancelled';
  // Unknown statuses fall into upcoming so they're visible
  return 'upcoming';
};

// ── Normalizers ───────────────────────────────────────────────────────────────

const normalizeReservation = (r: Record<string, unknown>): UnifiedBooking => ({
  id: String(r.reservation_id || r.id || Math.random()),
  type: 'reservation',
  title: String(r.partner_name || r.title || 'Reserva'),
  partnerName: r.partner_name ? String(r.partner_name) : undefined,
  date: r.date ? String(r.date) : undefined,
  status: String(r.status || 'pending'),
  raw: r,
});

const normalizeExperience = (e: Record<string, unknown>): UnifiedBooking => ({
  id: String(e.booking_id || e.id || Math.random()),
  type: 'experience',
  title: String(e.experience_title || e.title || 'Experiencia'),
  partnerName: e.partner_name ? String(e.partner_name) : undefined,
  date: e.date ? String(e.date) : undefined,
  status: String(e.status || 'pending'),
  raw: e,
});

const normalizeCityPass = (c: Record<string, unknown>): UnifiedBooking => ({
  id: String(c.pass_id || c.id || Math.random()),
  type: 'citypass',
  title: 'City Pass',
  date: c.expires_at ? String(c.expires_at) : c.created_at ? String(c.created_at) : undefined,
  status: String(c.status || 'active'),
  raw: c,
});

const normalizePortTax = (p: Record<string, unknown>): UnifiedBooking => ({
  id: String(p.ticket_id || p.id || Math.random()),
  type: 'porttax',
  title: 'Tasa Portuaria',
  date: p.travel_date ? String(p.travel_date) : undefined,
  status: String(p.status || 'paid'),
  raw: p,
});

// ── Status presentation ───────────────────────────────────────────────────────

type StatusStyle = { label: string; color: string; bg: string };

const STATUS_MAP: Record<string, StatusStyle> = {
  pending_confirmation: { label: 'Pendiente',     color: '#F59E0B', bg: 'rgba(245,158,11,0.15)' },
  confirmed:           { label: 'Confirmada',     color: COLORS.success, bg: 'rgba(34,197,94,0.15)' },
  pending_partner_activation: { label: 'En proceso', color: '#06B6D4', bg: 'rgba(6,182,212,0.15)' },
  paid:                { label: 'Pagada',          color: COLORS.success, bg: 'rgba(34,197,94,0.15)' },
  active:              { label: 'Activa',          color: COLORS.success, bg: 'rgba(34,197,94,0.15)' },
  pending:             { label: 'Pendiente',       color: '#F59E0B', bg: 'rgba(245,158,11,0.15)' },
  completed:           { label: 'Completada',      color: COLORS.textMuted, bg: 'rgba(168,178,193,0.12)' },
  no_show:             { label: 'No se presentó',  color: COLORS.textMuted, bg: 'rgba(168,178,193,0.12)' },
  expired:             { label: 'Vencida',         color: COLORS.textMuted, bg: 'rgba(168,178,193,0.12)' },
  used:                { label: 'Usada',           color: COLORS.textMuted, bg: 'rgba(168,178,193,0.12)' },
  cancelled_by_user:   { label: 'Cancelada',       color: COLORS.error, bg: 'rgba(239,68,68,0.12)' },
  cancelled_late:      { label: 'Cancelada tarde', color: COLORS.error, bg: 'rgba(239,68,68,0.12)' },
  rejected_by_partner: { label: 'Rechazada',       color: COLORS.error, bg: 'rgba(239,68,68,0.12)' },
  cancelled:           { label: 'Cancelada',       color: COLORS.error, bg: 'rgba(239,68,68,0.12)' },
  rejected:            { label: 'Rechazada',       color: COLORS.error, bg: 'rgba(239,68,68,0.12)' },
};

const getStatusStyle = (status: string): StatusStyle =>
  STATUS_MAP[status.toLowerCase()] ?? {
    label: status,
    color: COLORS.textMuted,
    bg: 'rgba(168,178,193,0.12)',
  };

// ── Type icon & label ─────────────────────────────────────────────────────────

const TYPE_META: Record<BookingType, { icon: string; label: string; color: string }> = {
  reservation: { icon: 'restaurant-outline',   label: 'Reserva',       color: '#F97316' },
  experience:  { icon: 'compass-outline',       label: 'Experiencia',   color: '#A855F7' },
  citypass:    { icon: 'ticket-outline',        label: 'City Pass',     color: COLORS.primary },
  porttax:     { icon: 'boat-outline',          label: 'Tasa Portuaria',color: '#06B6D4' },
};

// ── Date formatting ───────────────────────────────────────────────────────────

const formatDate = (dateStr?: string): string => {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr.length === 10 ? dateStr + 'T12:00:00' : dateStr);
    return d.toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
};

// ── Sort helper ───────────────────────────────────────────────────────────────

const sortByDate = (a: UnifiedBooking, b: UnifiedBooking): number => {
  if (!a.date && !b.date) return 0;
  if (!a.date) return 1;
  if (!b.date) return -1;
  return a.date.localeCompare(b.date);
};

// ── Booking card ──────────────────────────────────────────────────────────────

function BookingCard({
  booking,
  onPress,
}: {
  booking: UnifiedBooking;
  onPress: () => void;
}) {
  const typeMeta = TYPE_META[booking.type];
  const statusStyle = getStatusStyle(booking.status);
  const dateStr = formatDate(booking.date);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.82}
    >
      {/* Left: type icon circle */}
      <View
        style={[
          styles.cardIconWrap,
          { backgroundColor: `${typeMeta.color}18`, borderColor: `${typeMeta.color}30` },
        ]}
      >
        <Ionicons name={typeMeta.icon as any} size={22} color={typeMeta.color} />
      </View>

      {/* Center: info */}
      <View style={styles.cardBody}>
        <View style={styles.cardTopRow}>
          <View
            style={[
              styles.typePill,
              { backgroundColor: `${typeMeta.color}14` },
            ]}
          >
            <Text style={[styles.typePillText, { color: typeMeta.color }]}>
              {typeMeta.label.toUpperCase()}
            </Text>
          </View>
          {dateStr ? (
            <View style={styles.datePill}>
              <Ionicons
                name="calendar-outline"
                size={10}
                color={COLORS.textMuted}
              />
              <Text style={styles.datePillText}>{dateStr}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.cardTitle} numberOfLines={2}>
          {booking.title}
        </Text>

        {booking.partnerName && (
          <View style={styles.partnerRow}>
            <Ionicons name="business-outline" size={11} color={COLORS.textMuted} />
            <Text style={styles.partnerText} numberOfLines={1}>
              {booking.partnerName}
            </Text>
          </View>
        )}
      </View>

      {/* Right: status badge */}
      <View
        style={[
          styles.statusBadge,
          { backgroundColor: statusStyle.bg },
        ]}
      >
        <View
          style={[styles.statusDot, { backgroundColor: statusStyle.color }]}
        />
        <Text style={[styles.statusText, { color: statusStyle.color }]}>
          {statusStyle.label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyBookings({
  tab,
  onExplore,
}: {
  tab: TabKey;
  onExplore: () => void;
}) {
  const EMPTY_CONFIG: Record<TabKey, { icon: string; title: string; text: string; showCTA: boolean }> = {
    upcoming: {
      icon: 'calendar-outline',
      title: 'Sin reservas próximas',
      text: 'Explora lugares y haz tu primera reserva en Cartagena',
      showCTA: true,
    },
    past: {
      icon: 'time-outline',
      title: 'Sin historial',
      text: 'Tus reservas completadas aparecerán aquí',
      showCTA: false,
    },
    cancelled: {
      icon: 'close-circle-outline',
      title: 'Sin cancelaciones',
      text: 'No tienes reservas canceladas',
      showCTA: false,
    },
  };

  const cfg = EMPTY_CONFIG[tab];

  return (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyIconCircle}>
        <Ionicons name={cfg.icon as any} size={40} color={COLORS.textMuted} />
      </View>
      <Text style={styles.emptyTitle}>{cfg.title}</Text>
      <Text style={styles.emptyText}>{cfg.text}</Text>
      {cfg.showCTA && (
        <TouchableOpacity
          style={styles.emptyBtn}
          onPress={onExplore}
          activeOpacity={0.85}
        >
          <Ionicons name="compass-outline" size={15} color={COLORS.white} />
          <Text style={styles.emptyBtnText}>Explorar</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

const TABS: { key: TabKey; label: string }[] = [
  { key: 'upcoming',  label: 'Próximas' },
  { key: 'past',      label: 'Pasadas'  },
  { key: 'cancelled', label: 'Canceladas' },
];

export default function BookingsScreen() {
  const router = useRouter();
  const tr = useTr();

  const [activeTab, setActiveTab] = useState<TabKey>('upcoming');
  const [allBookings, setAllBookings] = useState<UnifiedBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = useCallback(async () => {
    const results = await Promise.allSettled([
      api.get('/reservations/my'),
      api.get('/experience-bookings'),
      api.get('/city-pass/mine'),
      api.get('/port-tax/my-tickets'),
    ]);

    const merged: UnifiedBooking[] = [];

    // Reservations
    if (results[0].status === 'fulfilled') {
      const data = Array.isArray(results[0].value) ? results[0].value : [];
      data.forEach((r: Record<string, unknown>) => merged.push(normalizeReservation(r)));
    } else {
      console.error('[BookingsScreen] reservations', results[0].reason);
    }

    // Experience bookings
    if (results[1].status === 'fulfilled') {
      const data = Array.isArray(results[1].value) ? results[1].value : [];
      data.forEach((e: Record<string, unknown>) => merged.push(normalizeExperience(e)));
    } else {
      console.error('[BookingsScreen] experience-bookings', results[1].reason);
    }

    // City pass
    if (results[2].status === 'fulfilled') {
      const raw = results[2].value;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        merged.push(normalizeCityPass(raw as Record<string, unknown>));
      } else if (Array.isArray(raw)) {
        raw.forEach((c: Record<string, unknown>) => merged.push(normalizeCityPass(c)));
      }
    } else {
      console.error('[BookingsScreen] city-pass', results[2].reason);
    }

    // Port tax tickets
    if (results[3].status === 'fulfilled') {
      const data = Array.isArray(results[3].value) ? results[3].value : [];
      data.forEach((p: Record<string, unknown>) => merged.push(normalizePortTax(p)));
    } else {
      console.error('[BookingsScreen] port-tax', results[3].reason);
    }

    merged.sort(sortByDate);
    setAllBookings(merged);
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchAll().finally(() => setLoading(false));
  }, [fetchAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

  const filteredBookings = allBookings.filter(
    (b) => getTabForStatus(b.status) === activeTab,
  );

  // Count per tab for the badge
  const tabCounts: Record<TabKey, number> = {
    upcoming: allBookings.filter((b) => getTabForStatus(b.status) === 'upcoming').length,
    past: allBookings.filter((b) => getTabForStatus(b.status) === 'past').length,
    cancelled: allBookings.filter((b) => getTabForStatus(b.status) === 'cancelled').length,
  };

  const navigateToBooking = (booking: UnifiedBooking) => {
    switch (booking.type) {
      case 'reservation':
        router.push(`/reservations?highlight=${booking.id}` as any);
        break;
      case 'experience':
        // No dedicated experience-booking detail screen — go to reservations overview
        router.push('/reservations' as any);
        break;
      case 'citypass':
        router.push('/city-pass' as any);
        break;
      case 'porttax':
        router.push('/port-tax' as any);
        break;
    }
  };

  // ── Header component for FlatList ─────────────────────────────────────────

  const ListHeader = (
    <View>
      {/* Screen title */}
      <View style={styles.header}>
        <Text style={styles.title}>Mis Reservas</Text>
        <Text style={styles.subtitle}>
          {allBookings.length > 0
            ? `${allBookings.length} reserva${allBookings.length !== 1 ? 's' : ''} en total`
            : 'Gestiona tus reservas y tickets'}
        </Text>
      </View>

      {/* Segmented control */}
      <View style={styles.segmentWrap}>
        <View style={styles.segmentedControl}>
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            const count = tabCounts[tab.key];
            return (
              <TouchableOpacity
                key={tab.key}
                style={[styles.segment, active && styles.segmentActive]}
                onPress={() => setActiveTab(tab.key)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.segmentText,
                    active && styles.segmentTextActive,
                  ]}
                >
                  {tab.label}
                </Text>
                {count > 0 && (
                  <View
                    style={[
                      styles.segmentBadge,
                      active && styles.segmentBadgeActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.segmentBadgeText,
                        active && styles.segmentBadgeTextActive,
                      ]}
                    >
                      {count}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Divider */}
      <View style={styles.divider} />
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {ListHeader}
        <ActivityIndicator
          size="large"
          color={COLORS.primary}
          style={{ marginTop: SPACING.xl }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        data={filteredBookings}
        keyExtractor={(item) => `${item.type}-${item.id}`}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={ListHeader}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
          />
        }
        ListEmptyComponent={
          <EmptyBookings
            tab={activeTab}
            onExplore={() => router.push('/explore' as any)}
          />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item }) => (
          <BookingCard
            booking={item}
            onPress={() => navigateToBooking(item)}
          />
        )}
        ListFooterComponent={<View style={{ height: SPACING.xl }} />}
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  // Header
  header: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  title: {
    fontSize: 28,
    color: COLORS.textMain,
    ...FONTS.bold,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    ...FONTS.regular,
    marginTop: 2,
  },

  // Segmented control
  segmentWrap: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
    paddingTop: SPACING.sm,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.full,
    padding: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: RADIUS.full,
  },
  segmentActive: {
    backgroundColor: COLORS.primary,
  },
  segmentText: {
    fontSize: 12,
    color: COLORS.textMuted,
    ...FONTS.semibold,
  },
  segmentTextActive: {
    color: COLORS.white,
    ...FONTS.bold,
  },
  segmentBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(217,119,6,0.2)',
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBadgeActive: {
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  segmentBadgeText: {
    fontSize: 10,
    color: COLORS.primary,
    ...FONTS.bold,
  },
  segmentBadgeTextActive: {
    color: COLORS.white,
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginBottom: SPACING.xs,
  },

  // List
  listContent: {
    paddingBottom: SPACING.xl,
  },

  // Separator
  separator: {
    height: 1,
    backgroundColor: COLORS.border,
    marginHorizontal: SPACING.lg,
  },

  // Booking card
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    gap: SPACING.md,
    backgroundColor: COLORS.background,
  },
  cardIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    flexShrink: 0,
  },
  cardBody: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    flexWrap: 'wrap',
  },
  typePill: {
    borderRadius: RADIUS.full,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  typePillText: {
    fontSize: 9,
    ...FONTS.bold,
    letterSpacing: 0.6,
  },
  datePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  datePillText: {
    fontSize: 10,
    color: COLORS.textMuted,
    ...FONTS.medium,
  },
  cardTitle: {
    fontSize: 14,
    color: COLORS.textMain,
    ...FONTS.semibold,
    lineHeight: 19,
  },
  partnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  partnerText: {
    fontSize: 11,
    color: COLORS.textMuted,
    ...FONTS.medium,
    flex: 1,
  },

  // Status badge
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexShrink: 0,
    maxWidth: SCREEN_WIDTH * 0.28,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  statusText: {
    fontSize: 10,
    ...FONTS.bold,
    letterSpacing: 0.3,
    flexShrink: 1,
  },

  // Empty state
  emptyWrap: {
    alignItems: 'center',
    paddingTop: SPACING.xl * 1.5,
    paddingHorizontal: SPACING.xl,
    gap: SPACING.sm,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.xs,
  },
  emptyTitle: {
    fontSize: 17,
    color: COLORS.textMain,
    ...FONTS.bold,
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textMuted,
    ...FONTS.regular,
    textAlign: 'center',
    lineHeight: 19,
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.md,
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 12,
    borderRadius: RADIUS.full,
  },
  emptyBtnText: {
    fontSize: 14,
    color: COLORS.white,
    ...FONTS.bold,
  },
});
