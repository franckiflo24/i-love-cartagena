import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Alert, TextInput, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useAuth } from '../../src/context/AuthContext';

type Cfg = {
  price_per_person: number;
  currency: string;
  season_label: string;
  note?: string;
};

function ymdToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function formatHumanDate(ymd: string): string {
  if (!ymd) return '';
  try {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  } catch {
    return ymd;
  }
}

export default function PortTaxCheckoutScreen() {
  const router = useRouter();
  const { user, login } = useAuth();
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [loading, setLoading] = useState(true);
  const [qty, setQty] = useState<number>(1);
  const [travelDate, setTravelDate] = useState<string>(ymdToday());
  const [submitting, setSubmitting] = useState(false);
  const [passengers, setPassengers] = useState<string[]>(['']);

  useEffect(() => {
    api.get('/port-tax/config')
      .then(setCfg)
      .catch(e => console.error(e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Keep passenger array length matching qty
    setPassengers(prev => {
      const next = prev.slice(0, qty);
      while (next.length < qty) next.push('');
      return next;
    });
  }, [qty]);

  const total = useMemo(() => (cfg ? cfg.price_per_person * qty : 0), [cfg, qty]);

  const formatPrice = (p: number) => `$${p.toLocaleString('es-CO')} COP`;

  const nextSevenDays = useMemo(() => {
    const today = ymdToday();
    return Array.from({ length: 7 }, (_, i) => addDays(today, i));
  }, []);

  const onConfirm = async () => {
    if (!user) {
      // Not logged in: jump straight to the login/create-account flow.
      // Pass `?next=...` so the login screen can return here after auth.
      router.push({
        pathname: '/login' as any,
        params: { next: '/port-tax/checkout' },
      });
      return;
    }
    if (!travelDate) {
      Alert.alert('Fecha requerida', 'Selecciona una fecha de viaje.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post('/port-tax/checkout', {
        qty,
        travel_date: travelDate,
        passengers: passengers.filter(Boolean),
      });
      if (res?.ticket_id) {
        router.replace({ pathname: '/port-tax/ticket/[id]' as any, params: { id: res.ticket_id, fromCheckout: '1' } });
      } else {
        Alert.alert('Error', 'No se pudo generar el tiquete.');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo procesar la compra.');
    }
    setSubmitting(false);
  };

  if (loading || !cfg) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color={COLORS.textMain} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Tasa Portuaria</Text>
          <Text style={styles.subtitle}>Muelle La Bodeguita → Islas</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={styles.heroCard}>
          <View style={styles.heroIconWrap}>
            <Ionicons name="boat" size={28} color={COLORS.primary} />
          </View>
          <Text style={styles.heroTitle}>Paga antes de embarcar</Text>
          <Text style={styles.heroDesc}>
            Tasa portuaria oficial para salir hacia Islas del Rosario, Barú o Tierra Bomba.
            Aparte del precio del tour o la lancha.
          </Text>
          <View style={styles.seasonChip}>
            <Ionicons name="pricetag" size={12} color={COLORS.primary} />
            <Text style={styles.seasonText}>{cfg.season_label}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pasajeros</Text>
          <View style={styles.qtyRow}>
            <TouchableOpacity
              style={[styles.qtyBtn, qty <= 1 && styles.qtyBtnDisabled]}
              onPress={() => setQty(q => Math.max(1, q - 1))}
              disabled={qty <= 1}
            >
              <Ionicons name="remove" size={20} color={qty <= 1 ? COLORS.textMuted : COLORS.textMain} />
            </TouchableOpacity>
            <View style={styles.qtyValue}>
              <Text style={styles.qtyValueNum}>{qty}</Text>
              <Text style={styles.qtyValueLabel}>{qty === 1 ? 'persona' : 'personas'}</Text>
            </View>
            <TouchableOpacity
              style={[styles.qtyBtn, qty >= 20 && styles.qtyBtnDisabled]}
              onPress={() => setQty(q => Math.min(20, q + 1))}
              disabled={qty >= 20}
            >
              <Ionicons name="add" size={20} color={qty >= 20 ? COLORS.textMuted : COLORS.textMain} />
            </TouchableOpacity>
          </View>

          {qty <= 6 && (
            <View style={{ gap: 8, marginTop: SPACING.sm }}>
              {Array.from({ length: qty }).map((_, i) => (
                <TextInput
                  key={i}
                  style={styles.input}
                  placeholder={`Nombre del pasajero ${i + 1} (opcional)`}
                  placeholderTextColor={COLORS.textMuted}
                  value={passengers[i] || ''}
                  onChangeText={t => {
                    const next = [...passengers];
                    next[i] = t;
                    setPassengers(next);
                  }}
                  maxLength={50}
                />
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Fecha de viaje</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dateRow}
            style={{ flexGrow: 0 }}
          >
            {nextSevenDays.map(d => {
              const isActive = travelDate === d;
              const [yy, mm, dd] = d.split('-').map(Number);
              const dt = new Date(yy, mm - 1, dd);
              const dayName = dt.toLocaleDateString('es-CO', { weekday: 'short' }).replace('.', '');
              const monthName = dt.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '');
              return (
                <TouchableOpacity
                  key={d}
                  style={[styles.dateChip, isActive && styles.dateChipActive]}
                  onPress={() => setTravelDate(d)}
                >
                  <Text style={[styles.dateChipDay, isActive && styles.dateChipTextActive]}>
                    {dayName.toUpperCase()}
                  </Text>
                  <Text style={[styles.dateChipNum, isActive && styles.dateChipTextActive]}>
                    {dd}
                  </Text>
                  <Text style={[styles.dateChipMonth, isActive && styles.dateChipTextActive]}>
                    {monthName.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <Text style={styles.dateHint}>Seleccionada: {formatHumanDate(travelDate)}</Text>
        </View>

        <View style={[styles.section, styles.summary]}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Tasa por persona</Text>
            <Text style={styles.summaryVal}>{formatPrice(cfg.price_per_person)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>× {qty} {qty === 1 ? 'persona' : 'personas'}</Text>
            <Text style={styles.summaryVal}>{formatPrice(total)}</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryRow}>
            <Text style={styles.totalLabel}>Total a pagar</Text>
            <Text style={styles.totalVal}>{formatPrice(total)}</Text>
          </View>
        </View>

        <View style={styles.infoCard}>
          <Ionicons name="information-circle" size={18} color={COLORS.textMuted} />
          <Text style={styles.infoText}>
            Tras el pago se generará un QR único por tiquete. Muéstralo en el muelle antes de embarcar.
            Cada QR solo se puede usar una vez.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.bottomLabel}>Total</Text>
          <Text style={styles.bottomTotal}>{formatPrice(total)}</Text>
        </View>
        <TouchableOpacity
          style={[styles.payBtn, submitting && { opacity: 0.6 }]}
          onPress={onConfirm}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <>
              <Ionicons name="qr-code" size={18} color="#FFF" />
              <Text style={styles.payBtnText}>{user ? 'Pagar y generar QR' : 'Inicia sesión'}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold },
  subtitle: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular },

  heroCard: {
    marginHorizontal: SPACING.lg, padding: SPACING.lg, borderRadius: RADIUS.xl,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: 'rgba(217,119,6,0.25)',
    gap: SPACING.sm, alignItems: 'flex-start',
  },
  heroIconWrap: {
    width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(217,119,6,0.12)',
  },
  heroTitle: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold },
  heroDesc: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 20 },
  seasonChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(217,119,6,0.12)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.full,
  },
  seasonText: { fontSize: 11, color: COLORS.primary, ...FONTS.semibold },

  section: { paddingHorizontal: SPACING.lg, marginTop: SPACING.lg },
  sectionTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold, marginBottom: SPACING.sm, letterSpacing: 0.3 },

  qtyRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.sm,
    borderWidth: 1, borderColor: COLORS.border,
  },
  qtyBtn: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  qtyBtnDisabled: { opacity: 0.4 },
  qtyValue: { alignItems: 'center' },
  qtyValueNum: { fontSize: 26, color: COLORS.textMain, ...FONTS.bold, lineHeight: 30 },
  qtyValueLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md, paddingVertical: 10,
    color: COLORS.textMain, fontSize: 14, borderWidth: 1, borderColor: COLORS.border,
  },

  dateRow: { gap: SPACING.sm, paddingVertical: 4 },
  dateChip: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center',
    borderWidth: 1.5, borderColor: COLORS.border, minWidth: 64,
  },
  dateChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  dateChipDay: { fontSize: 10, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 0.5 },
  dateChipNum: { fontSize: 20, color: COLORS.textMain, ...FONTS.bold, lineHeight: 22, marginTop: 2 },
  dateChipMonth: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium, letterSpacing: 0.5, marginTop: 2 },
  dateChipTextActive: { color: '#FFF' },
  dateHint: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginTop: SPACING.sm, textTransform: 'capitalize' },

  summary: {
    backgroundColor: COLORS.surface, marginHorizontal: SPACING.lg,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border,
    gap: SPACING.sm, marginTop: SPACING.lg,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular },
  summaryVal: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  summaryDivider: { height: 1, backgroundColor: COLORS.border, marginVertical: 4 },
  totalLabel: { fontSize: 15, color: COLORS.textMain, ...FONTS.bold },
  totalVal: { fontSize: 22, color: COLORS.primary, ...FONTS.bold },

  infoCard: {
    flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-start',
    marginHorizontal: SPACING.lg, marginTop: SPACING.md,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  infoText: { flex: 1, fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 18 },

  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    paddingBottom: Platform.OS === 'ios' ? 24 : SPACING.md,
    backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  bottomLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, textTransform: 'uppercase', letterSpacing: 0.5 },
  bottomTotal: { fontSize: 20, color: COLORS.textMain, ...FONTS.bold },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.primary, paddingHorizontal: SPACING.lg, paddingVertical: 14,
    borderRadius: RADIUS.full,
  },
  payBtnText: { fontSize: 14, color: '#FFF', ...FONTS.bold },
});
