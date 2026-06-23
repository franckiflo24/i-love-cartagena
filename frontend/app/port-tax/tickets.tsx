import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useAuth } from '../../src/context/AuthContext';
import { useTr } from '../../src/i18n/autoTr';

type Ticket = {
  ticket_id: string;
  qty: number;
  total_amount: number;
  travel_date: string;
  status: 'paid' | 'used' | 'expired' | 'pending';
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
    return dt.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
  } catch { /* invalid date string — return raw */
    return ymd;
  }
}

export default function PortTaxTicketsScreen() {
  const tr = useTr();
  const router = useRouter();
  const { user, login } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) {
      setTickets([]);
      setLoading(false);
      return;
    }
    try {
      const data = await api.get('/port-tax/my-tickets');
      setTickets(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
    setRefreshing(false);
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const active = tickets.filter(t => t.status === 'paid');
  const history = tickets.filter(t => t.status !== 'paid');

  const renderTicket = (t: Ticket) => {
    const status = STATUS_COLORS[t.status] || STATUS_COLORS.paid;
    return (
      <TouchableOpacity
        key={t.ticket_id}
        style={styles.ticketCard}
        onPress={() => router.push({ pathname: '/port-tax/ticket/[id]' as any, params: { id: t.ticket_id } })}
        activeOpacity={0.85}
      >
        <View style={styles.ticketTop}>
          <View style={styles.ticketIconWrap}>
            <Ionicons name="boat" size={20} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.ticketTitle}>{tr('Tasa Portuaria')}</Text>
            <Text style={styles.ticketSub}>La Bodeguita → Islas</Text>
          </View>
          <View style={[styles.statusChip, { backgroundColor: status.bg }]}>
            <Ionicons name={status.icon as any} size={11} color={status.fg} />
            <Text style={[styles.statusText, { color: status.fg }]}>{status.label}</Text>
          </View>
        </View>

        <View style={styles.ticketMid}>
          <View style={styles.metaItem}>
            <Ionicons name="calendar-outline" size={13} color={COLORS.textMuted} />
            <Text style={styles.metaText}>{formatHumanDate(t.travel_date)}</Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="people-outline" size={13} color={COLORS.textMuted} />
            <Text style={styles.metaText}>{t.qty} {t.qty === 1 ? 'persona' : 'personas'}</Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="cash-outline" size={13} color={COLORS.textMuted} />
            <Text style={styles.metaText}>${(t.total_amount ?? 0).toLocaleString('es-CO')}</Text>
          </View>
        </View>

        <View style={styles.ticketCta}>
          <Ionicons name="qr-code" size={14} color={COLORS.primary} />
          <Text style={styles.ticketCtaText}>
            {t.status === 'paid' ? 'Ver QR' : 'Ver detalles'}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={COLORS.primary} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color={COLORS.textMain} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{tr('Mis tiquetes')}</Text>
          <Text style={styles.subtitle}>{tr('Tasa Portuaria')}</Text>
        </View>
        <TouchableOpacity
          style={styles.newBtn}
          onPress={() => router.push('/port-tax/checkout' as any)}
        >
          <Ionicons name="add" size={20} color="#FFF" />
        </TouchableOpacity>
      </View>

      {!user ? (
        <View style={styles.empty}>
          <Ionicons name="lock-closed-outline" size={48} color={COLORS.textMuted} />
          <Text style={styles.emptyTitle}>Inicia sesión</Text>
          <Text style={styles.emptyText}>
            Para ver tus tiquetes guardados y volver a abrir tu QR cuando lo necesites.
          </Text>
          <TouchableOpacity style={styles.ctaBtn} onPress={() => login()}>
            <Text style={styles.ctaBtnText}>{tr('Iniciar sesión')}</Text>
          </TouchableOpacity>
        </View>
      ) : loading ? (
        <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 80 }} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 30 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        >
          {tickets.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="boat-outline" size={48} color={COLORS.textMuted} />
              <Text style={styles.emptyTitle}>Aún no tienes tiquetes</Text>
              <Text style={styles.emptyText}>
                Compra tu tasa portuaria antes de salir a las islas. Cada QR funciona una sola vez.
              </Text>
              <TouchableOpacity
                style={styles.ctaBtn}
                onPress={() => router.push('/port-tax/checkout' as any)}
              >
                <Ionicons name="qr-code" size={16} color="#FFF" />
                <Text style={styles.ctaBtnText}>Comprar tiquete</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {active.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Activos</Text>
                  {active.map(renderTicket)}
                </View>
              )}
              {history.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Historial</Text>
                  {history.map(renderTicket)}
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
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
  newBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, color: COLORS.textMain, ...FONTS.bold },
  subtitle: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular },

  empty: { alignItems: 'center', gap: SPACING.sm, padding: SPACING.xl, marginTop: 40 },
  emptyTitle: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold, textAlign: 'center' },
  emptyText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', lineHeight: 20, marginBottom: SPACING.md },
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.primary, paddingHorizontal: SPACING.lg, paddingVertical: 12,
    borderRadius: RADIUS.full,
  },
  ctaBtnText: { fontSize: 14, color: '#FFF', ...FONTS.bold },

  section: { paddingHorizontal: SPACING.lg, marginTop: SPACING.md },
  sectionTitle: { fontSize: 12, color: COLORS.textMuted, ...FONTS.bold, letterSpacing: 1, marginBottom: SPACING.sm, textTransform: 'uppercase' },

  ticketCard: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.md,
    marginBottom: SPACING.sm, gap: SPACING.sm,
  },
  ticketTop: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  ticketIconWrap: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(217,119,6,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  ticketTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold },
  ticketSub: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full },
  statusText: { fontSize: 10, ...FONTS.bold, letterSpacing: 0.5 },

  ticketMid: { flexDirection: 'row', gap: SPACING.md, flexWrap: 'wrap' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium, textTransform: 'capitalize' },

  ticketCta: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 2 },
  ticketCtaText: { fontSize: 12, color: COLORS.primary, ...FONTS.semibold },
});
