/**
 * "Mis reservas" — list of the calling user's in-app reservations.
 * Split into Upcoming + Past, with action buttons (cancel, view details).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeImage } from '../../src/components/SafeImage';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useTr } from '../../src/i18n/autoTr';

type Reservation = {
  reservation_id: string;
  partner_id: string;
  partner_name: string;
  partner?: { name?: string; image_url?: string; address?: string; phone?: string; whatsapp?: string; instagram?: string; email?: string };
  event?: { event_id?: string; title?: string; flyer_url?: string } | null;
  type: string;
  date: string;
  time?: string | null;
  party_size: number;
  notes?: string;
  status: string;
  payment_info?: {
    payment_link?: string | null;
    whatsapp?: string | null;
    phone?: string | null;
    email?: string | null;
    instagram?: string | null;
    note?: string | null;
  } | null;
  partner_note?: string;
  partner_rejection_reason?: string;
  created_at: string;
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending_partner_activation: { label: 'Solicitud enviada', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
  pending_confirmation: { label: 'Esperando confirmación', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
  confirmed: { label: 'Confirmada', color: '#22C55E', bg: 'rgba(34,197,94,0.12)' },
  rejected_by_partner: { label: 'Rechazada', color: '#EF4444', bg: 'rgba(239,68,68,0.12)' },
  cancelled_by_user: { label: 'Cancelada', color: '#94A3B8', bg: 'rgba(148,163,184,0.12)' },
  cancelled_late: { label: 'Cancelada tarde', color: '#EF4444', bg: 'rgba(239,68,68,0.12)' },
  completed: { label: 'Completada', color: '#22C55E', bg: 'rgba(34,197,94,0.12)' },
  no_show: { label: 'No asistió', color: '#EF4444', bg: 'rgba(239,68,68,0.12)' },
  expired: { label: 'Expirada', color: '#94A3B8', bg: 'rgba(148,163,184,0.12)' },
};

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso + 'T12:00:00');
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
  } catch {
    return iso;
  }
}

export default function MyReservations() {
  const tr = useTr();
  const router = useRouter();
  const params = useLocalSearchParams<{ highlight?: string }>();

  const [data, setData] = useState<{ upcoming: Reservation[]; past: Reservation[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');

  const load = useCallback(async () => {
    try {
      const res = await api.get('/reservations/my');
      setData(res);
    } catch (e: any) {
      Alert.alert(tr('Error'), String(e?.message || 'No se pudo cargar tus reservas'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tr]);

  useEffect(() => { load(); }, [load]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const cancel = (r: Reservation) => {
    Alert.alert(
      tr('Cancelar reserva'),
      tr('¿Estás seguro que quieres cancelar esta reserva?'),
      [
        { text: tr('No'), style: 'cancel' },
        {
          text: tr('Sí, cancelar'),
          style: 'destructive',
          onPress: async () => {
            try {
              await api.post(`/reservations/${r.reservation_id}/cancel`);
              // Optimistically update local state so the UI reflects cancellation
              setData(prev => {
                if (!prev) return prev;
                const update = (list: Reservation[]) =>
                  list.map(res => res.reservation_id === r.reservation_id
                    ? { ...res, status: 'cancelled_by_user' }
                    : res);
                return { ...prev, upcoming: update(prev.upcoming), past: update(prev.past) };
              });
              Alert.alert(tr('Reserva cancelada'), tr('Tu reserva fue cancelada exitosamente.'));
            } catch (e: any) {
              Alert.alert(tr('Error'), String(e?.message || ''));
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={COLORS.primary} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  const list = (tab === 'upcoming' ? data?.upcoming : data?.past) || [];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{tr('Mis reservas')}</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'upcoming' && styles.tabBtnActive]}
          onPress={() => setTab('upcoming')}
        >
          <Text style={[styles.tabText, tab === 'upcoming' && styles.tabTextActive]}>
            {tr('Próximas')} {data?.upcoming?.length ? `(${data.upcoming.length})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'past' && styles.tabBtnActive]}
          onPress={() => setTab('past')}
        >
          <Text style={[styles.tabText, tab === 'past' && styles.tabTextActive]}>
            {tr('Historial')} {data?.past?.length ? `(${data.past.length})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: SPACING.md, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        {list.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>
              {tab === 'upcoming'
                ? tr('No tienes reservas próximas.')
                : tr('Aún no tienes historial de reservas.')}
            </Text>
            {tab === 'upcoming' && (
              <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/(tabs)/partners' as any)}>
                <Ionicons name="restaurant" size={16} color={COLORS.white} />
                <Text style={styles.emptyBtnText}>{tr('Explorar partners')}</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          list.map((r) => {
            const meta = STATUS_META[r.status] || { label: r.status, color: COLORS.textMuted, bg: 'rgba(148,163,184,0.12)' };
            const canCancel = ['pending_payment', 'pending_confirmation', 'confirmed'].includes(r.status);
            const highlighted = params.highlight === r.reservation_id;
            return (
              <View
                key={r.reservation_id}
                style={[styles.card, highlighted && styles.cardHighlight]}
              >
                <View style={styles.cardHeader}>
                  {r.partner?.image_url ? (
                    <SafeImage uri={r.partner.image_url} style={styles.partnerImg} />
                  ) : (
                    <View style={[styles.partnerImg, { backgroundColor: COLORS.background }]} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardName} numberOfLines={1}>
                      {r.partner_name || r.partner?.name}
                    </Text>
                    <Text style={styles.cardSub}>
                      {fmtDate(r.date)}{r.time ? ` · ${r.time}` : ''} · {r.party_size} {tr('pers.')}
                    </Text>
                    {r.event?.title ? (
                      <Text style={styles.eventTitle} numberOfLines={1}>🎟️ {r.event.title}</Text>
                    ) : null}
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: meta.bg, borderColor: meta.color }]}>
                    <Text style={[styles.statusText, { color: meta.color }]} numberOfLines={1}>
                      {tr(meta.label)}
                    </Text>
                  </View>
                </View>

                {r.notes ? (
                  <Text style={styles.notes} numberOfLines={2}>📝 {r.notes}</Text>
                ) : null}

                {/* ── LOCKED LEAD → friendly notice ── */}
                {r.status === 'pending_partner_activation' ? (
                  <View style={styles.lockedNotice}>
                    <Ionicons name="time-outline" size={16} color="#F59E0B" />
                    <Text style={styles.lockedNoticeText}>
                      {tr('Este partner aún no gestiona reservas en Amo. Le hemos enviado tu solicitud — te avisaremos si activa su cuenta.')}
                    </Text>
                  </View>
                ) : null}

                {/* ── CONFIRMED → show partner payment info + contacts ── */}
                {r.status === 'confirmed' && r.payment_info ? (
                  <View style={styles.payInfoCard}>
                    <View style={styles.payInfoHeader}>
                      <Ionicons name="checkmark-circle" size={18} color="#22C55E" />
                      <Text style={styles.payInfoTitle}>{tr('Reserva confirmada')}</Text>
                    </View>
                    {r.payment_info.note ? (
                      <Text style={styles.payInfoNote}>"{r.payment_info.note}"</Text>
                    ) : null}
                    {r.payment_info.payment_link ? (
                      <TouchableOpacity
                        style={styles.payBtn}
                        onPress={() => {
                          if (r.payment_info?.payment_link) {
                            import('react-native').then((m) => m.Linking.openURL(r.payment_info!.payment_link!).catch(() => {}));
                          }
                        }}
                      >
                        <Ionicons name="card" size={16} color={COLORS.white} />
                        <Text style={styles.payBtnText}>{tr('Pagar reserva')}</Text>
                      </TouchableOpacity>
                    ) : (
                      <Text style={styles.payInfoHint}>
                        {tr('El partner te contactará para coordinar el pago.')}
                      </Text>
                    )}
                    <View style={styles.contactRow}>
                      {r.payment_info.whatsapp ? (
                        <TouchableOpacity
                          style={styles.contactBtn}
                          onPress={() => {
                            const phone = (r.payment_info!.whatsapp || '').replace(/[^\d+]/g, '');
                            const msg = encodeURIComponent(`Hola, soy ${r.partner_name ? '' : ''}cliente de Amo Cartagena. Reserva ${r.reservation_id} para ${r.date} ${r.time || ''}. ¿Cómo coordinamos el pago?`);
                            import('react-native').then((m) => m.Linking.openURL(`https://wa.me/${phone}?text=${msg}`).catch(() => {}));
                          }}
                        >
                          <Ionicons name="logo-whatsapp" size={14} color="#25D366" />
                          <Text style={styles.contactBtnText}>WhatsApp</Text>
                        </TouchableOpacity>
                      ) : null}
                      {r.payment_info.phone && !r.payment_info.whatsapp ? (
                        <TouchableOpacity
                          style={styles.contactBtn}
                          onPress={() => {
                            import('react-native').then((m) => m.Linking.openURL(`tel:${r.payment_info!.phone}`).catch(() => {}));
                          }}
                        >
                          <Ionicons name="call" size={14} color={COLORS.primary} />
                          <Text style={styles.contactBtnText}>{tr('Llamar')}</Text>
                        </TouchableOpacity>
                      ) : null}
                      {r.payment_info.instagram ? (
                        <TouchableOpacity
                          style={styles.contactBtn}
                          onPress={() => {
                            import('react-native').then((m) => m.Linking.openURL(`https://instagram.com/${r.payment_info!.instagram}`).catch(() => {}));
                          }}
                        >
                          <Ionicons name="logo-instagram" size={14} color="#E1306C" />
                          <Text style={styles.contactBtnText}>Instagram</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                ) : null}

                {/* ── REJECTED → show reason ── */}
                {r.status === 'rejected_by_partner' && r.partner_rejection_reason ? (
                  <View style={styles.rejectedCard}>
                    <Ionicons name="information-circle" size={16} color="#EF4444" />
                    <Text style={styles.rejectedText}>{r.partner_rejection_reason}</Text>
                  </View>
                ) : null}

                <View style={styles.actions}>
                  <TouchableOpacity
                    style={styles.detailBtn}
                    onPress={() => router.push(`/partner/${r.partner_id}` as any)}
                  >
                    <Ionicons name="business-outline" size={14} color={COLORS.primary} />
                    <Text style={styles.detailBtnText}>{tr('Ver partner')}</Text>
                  </TouchableOpacity>
                  {canCancel ? (
                    <TouchableOpacity style={styles.cancelBtn} onPress={() => cancel(r)}>
                      <Ionicons name="close" size={14} color="#EF4444" />
                      <Text style={styles.cancelBtnText}>{tr('Cancelar')}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: COLORS.textMain, fontSize: 17, ...FONTS.bold },

  tabRow: {
    flexDirection: 'row',
    marginHorizontal: SPACING.md,
    marginTop: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.full,
    padding: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tabBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: RADIUS.full },
  tabBtnActive: { backgroundColor: COLORS.primary },
  tabText: { color: COLORS.textMuted, fontSize: 12.5, ...FONTS.medium },
  tabTextActive: { color: COLORS.white, ...FONTS.bold },

  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginBottom: 12,
    gap: 10,
  },
  cardHighlight: {
    borderColor: COLORS.primary,
    borderWidth: 2,
  },
  cardHeader: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  partnerImg: { width: 52, height: 52, borderRadius: RADIUS.md },
  cardName: { color: COLORS.textMain, fontSize: 14, ...FONTS.bold },
  cardSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  eventTitle: { color: '#A78BFA', fontSize: 11, marginTop: 2 },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    maxWidth: 130,
  },
  statusText: { fontSize: 10.5, ...FONTS.bold, letterSpacing: 0.3 },

  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: RADIUS.md,
  },
  amountLabel: { color: COLORS.textMuted, fontSize: 12 },
  amountValue: { color: COLORS.textMain, fontSize: 14, ...FONTS.bold },

  notes: { color: COLORS.textMuted, fontSize: 11.5, fontStyle: 'italic' },

  lockedNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderRadius: RADIUS.md,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.4)',
  },
  lockedNoticeText: { color: COLORS.textMain, fontSize: 11.5, flex: 1, lineHeight: 16 },

  payInfoCard: {
    backgroundColor: 'rgba(34,197,94,0.08)',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.4)',
    padding: 12,
    gap: 8,
  },
  payInfoHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  payInfoTitle: { color: '#22C55E', fontSize: 13, ...FONTS.bold },
  payInfoNote: { color: COLORS.textMain, fontSize: 12, fontStyle: 'italic', lineHeight: 16 },
  payInfoHint: { color: COLORS.textMuted, fontSize: 11.5, fontStyle: 'italic' },

  payBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: RADIUS.md,
    backgroundColor: '#22C55E',
  },
  payBtnText: { color: COLORS.white, fontSize: 14, ...FONTS.bold },

  contactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  contactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  contactBtnText: { color: COLORS.textMain, fontSize: 11.5, ...FONTS.medium },

  rejectedCard: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderRadius: RADIUS.md,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    alignItems: 'flex-start',
  },
  rejectedText: { color: COLORS.textMain, fontSize: 11.5, flex: 1, lineHeight: 16 },

  actions: { flexDirection: 'row', gap: 8 },
  detailBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: RADIUS.md,
    backgroundColor: 'rgba(217,119,6,0.12)',
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  detailBtnText: { color: COLORS.primary, fontSize: 12, ...FONTS.bold },
  cancelBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: RADIUS.md,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  cancelBtnText: { color: '#EF4444', fontSize: 12, ...FONTS.bold },

  empty: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyText: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', maxWidth: 240 },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primary,
  },
  emptyBtnText: { color: COLORS.white, fontSize: 13, ...FONTS.bold },
});
