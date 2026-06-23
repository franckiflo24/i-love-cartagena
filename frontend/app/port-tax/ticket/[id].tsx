import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Share, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { COLORS, SPACING, RADIUS, FONTS } from '../../../src/constants/theme';
import { api } from '../../../src/constants/api';
import { useTr } from '../../../src/i18n/autoTr';

type Ticket = {
  ticket_id: string;
  user_id: string;
  qty: number;
  passengers?: string[];
  price_per_person: number;
  total_amount: number;
  currency: string;
  travel_date: string;
  status: 'paid' | 'used' | 'expired' | 'pending';
  qr_payload: any;
  paid_at?: string | null;
  used_at?: string | null;
  created_at: string;
};

const STATUS_COLORS: Record<string, { bg: string; fg: string; label: string; icon: string }> = {
  paid: { bg: 'rgba(34,197,94,0.15)', fg: '#22C55E', label: 'ACTIVO', icon: 'shield-checkmark' },
  used: { bg: 'rgba(168,85,247,0.15)', fg: '#A855F7', label: 'USADO', icon: 'checkmark-done' },
  expired: { bg: 'rgba(148,163,184,0.15)', fg: '#94A3B8', label: 'EXPIRADO', icon: 'time' },
  pending: { bg: 'rgba(217,119,6,0.15)', fg: '#D97706', label: 'PENDIENTE', icon: 'hourglass' },
};

function formatHumanDate(ymd: string): string {
  if (!ymd) return '';
  try {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch { /* invalid date string — return raw */
    return ymd;
  }
}

export default function PortTaxTicketScreen() {
  const tr = useTr();
  const router = useRouter();
  const { id, fromCheckout } = useLocalSearchParams<{ id: string; fromCheckout?: string }>();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    api.get(`/port-tax/tickets/${id}`)
      .then(setTicket)
      .catch(e => {
        console.error(e);
        Alert.alert('Error', 'No se pudo cargar el tiquete.');
      })
      .finally(() => setLoading(false));
  }, [id]);

  const formatPrice = (p?: number) => p == null ? '' : `$${p.toLocaleString('es-CO')} COP`;

  if (loading || !ticket) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  const status = STATUS_COLORS[ticket.status] || STATUS_COLORS.paid;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color={COLORS.textMain} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Tu tiquete</Text>
          <Text style={styles.subtitle}>{tr('Tasa Portuaria')}</Text>
        </View>
        <TouchableOpacity
          onPress={() => Share.share({ message: `Tiquete Tasa Portuaria — ID ${ticket.ticket_id.toUpperCase()} · ${ticket.qty} pax · ${formatHumanDate(ticket.travel_date)}` })}
          style={styles.iconBtn}
        >
          <Ionicons name="share-outline" size={20} color={COLORS.textMain} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>
        {fromCheckout === '1' && ticket.status === 'paid' && (
          <View style={styles.successBanner}>
            <Ionicons name="checkmark-circle" size={18} color="#22C55E" />
            <Text style={styles.successText}>¡Pago confirmado! Tu QR está listo.</Text>
          </View>
        )}

        <View style={styles.qrCard}>
          <View style={[styles.statusChip, { backgroundColor: status.bg }]}>
            <Ionicons name={status.icon as any} size={12} color={status.fg} />
            <Text style={[styles.statusText, { color: status.fg }]}>{status.label}</Text>
          </View>

          <Text style={styles.planName}>{tr('Tasa Portuaria')}</Text>
          <Text style={styles.routeName}>La Bodeguita → Islas</Text>

          <View style={styles.qrWrap}>
            <View style={[styles.qrWhiteBg, ticket.status !== 'paid' && { opacity: 0.4 }]}>
              <QRCode
                value={JSON.stringify(ticket.qr_payload)}
                size={200}
                color="#1a1a2e"
                backgroundColor="#FFFFFF"
              />
            </View>
            {ticket.status !== 'paid' && (
              <View style={styles.qrOverlay}>
                <Ionicons name={status.icon as any} size={36} color={status.fg} />
                <Text style={[styles.qrOverlayText, { color: status.fg }]}>{status.label}</Text>
              </View>
            )}
            <Text style={styles.qrHint}>
              {ticket.status === 'paid'
                ? 'Muestra este QR en el muelle antes de embarcar'
                : ticket.status === 'used'
                ? `Usado el ${ticket.used_at ? new Date(ticket.used_at).toLocaleString('es-CO') : ''}`
                : 'Este QR ya no es válido'}
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>{tr('Pasajeros')}</Text>
              <Text style={styles.detailVal}>{ticket.qty}</Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Fecha</Text>
              <Text style={styles.detailValSmall}>{formatHumanDate(ticket.travel_date)}</Text>
            </View>
          </View>

          <View style={styles.detailRow}>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Tasa / persona</Text>
              <Text style={styles.detailValSmall}>{formatPrice(ticket.price_per_person)}</Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Total pagado</Text>
              <Text style={styles.totalVal}>{formatPrice(ticket.total_amount)}</Text>
            </View>
          </View>

          {!!ticket.passengers?.length && (
            <View style={styles.paxList}>
              <Text style={styles.paxTitle}>{tr('Pasajeros')}</Text>
              {ticket.passengers.map((p, i) => (
                <View key={i} style={styles.paxRow}>
                  <Ionicons name="person-circle-outline" size={16} color={COLORS.textMuted} />
                  <Text style={styles.paxName}>{p || `Pasajero ${i + 1}`}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.idRow}>
            <Text style={styles.idText}>ID: {ticket.ticket_id.toUpperCase()}</Text>
          </View>
        </View>

        <View style={styles.infoCard}>
          <Ionicons name="information-circle" size={18} color={COLORS.textMuted} />
          <Text style={styles.infoText}>
            Recuerda: la tasa portuaria es independiente del precio del tour o de la lancha.
            Este QR solo puede usarse una vez en el muelle.
          </Text>
        </View>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => router.replace('/port-tax/tickets' as any)}
        >
          <Ionicons name="list" size={18} color={COLORS.textMain} />
          <Text style={styles.secondaryBtnText}>Ver mis tiquetes</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
  },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, color: COLORS.textMain, ...FONTS.bold },
  subtitle: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular },

  successBanner: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    marginHorizontal: SPACING.lg, marginBottom: SPACING.md,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    backgroundColor: 'rgba(34,197,94,0.10)', borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: 'rgba(34,197,94,0.30)',
  },
  successText: { fontSize: 13, color: '#22C55E', ...FONTS.semibold },

  qrCard: {
    marginHorizontal: SPACING.lg, padding: SPACING.lg, borderRadius: RADIUS.xl,
    backgroundColor: COLORS.surface, borderWidth: 2, borderColor: COLORS.primary,
    alignItems: 'center',
  },
  statusChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.full,
    alignSelf: 'flex-start', marginBottom: SPACING.md,
  },
  statusText: { fontSize: 10, ...FONTS.bold, letterSpacing: 1 },
  planName: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold, textAlign: 'center' },
  routeName: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2, marginBottom: SPACING.md },

  qrWrap: { alignItems: 'center', marginVertical: SPACING.md, position: 'relative' },
  qrWhiteBg: { backgroundColor: '#FFFFFF', padding: 16, borderRadius: RADIUS.lg },
  qrOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(15, 20, 35, 0.6)', borderRadius: RADIUS.lg,
  },
  qrOverlayText: { fontSize: 16, ...FONTS.bold, letterSpacing: 1, marginTop: 4 },
  qrHint: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium, marginTop: SPACING.sm, textAlign: 'center', paddingHorizontal: SPACING.md },

  divider: { height: 1, backgroundColor: COLORS.border, alignSelf: 'stretch', marginVertical: SPACING.md },

  detailRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: SPACING.sm, gap: SPACING.md },
  detailItem: { flex: 1 },
  detailLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  detailVal: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold },
  detailValSmall: { fontSize: 13, color: COLORS.textMain, ...FONTS.semibold, textTransform: 'capitalize' },
  totalVal: { fontSize: 18, color: COLORS.primary, ...FONTS.bold },

  paxList: { width: '100%', marginTop: SPACING.sm, gap: 6 },
  paxTitle: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  paxRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  paxName: { fontSize: 13, color: COLORS.textMain, ...FONTS.regular },

  idRow: { marginTop: SPACING.md, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.border, alignSelf: 'stretch' },
  idText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center', letterSpacing: 1 },

  infoCard: {
    flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-start',
    marginHorizontal: SPACING.lg, marginTop: SPACING.md,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  infoText: { flex: 1, fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 18 },

  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
    marginHorizontal: SPACING.lg, marginTop: SPACING.md,
    paddingVertical: 14, borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  secondaryBtnText: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
});
