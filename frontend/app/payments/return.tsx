import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { describeStatus } from '../../src/lib/wompi';
import { useTr } from '../../src/i18n/autoTr';

const fmtCOP = (n: number) =>
  '$ ' + (Number(n) || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });

export default function PaymentReturn() {
  const tr = useTr();
  const router = useRouter();
  const params = useLocalSearchParams<{
    id?: string;
    reference?: string;
    'transaction.id'?: string;
    transactionId?: string;
  }>();
  const reference = (params.reference || params.id) as string | undefined;
  const wompiTxId = (params.transactionId || params['transaction.id']) as string | undefined;

  const [payment, setPayment] = useState<any>(null);
  const [status, setStatus] = useState<string>('pending');
  const [loading, setLoading] = useState(true);
  const [polls, setPolls] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!reference) {
      setLoading(false);
      return;
    }
    const tick = async () => {
      try {
        const p = await api.get(`/payments/by-reference/${reference}`);
        if (cancelled) return;
        setPayment(p);
        setStatus(p?.status || 'pending');
        if (p?.status && p.status !== 'pending') {
          setLoading(false);
          return;
        }
      } catch { /* payment status poll failed — keep retrying until timeout */ }
      setPolls((n) => n + 1);
      if (!cancelled) setTimeout(tick, 2500);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [reference]);

  // Stop polling after ~60s — payment will still arrive via webhook
  useEffect(() => {
    if (polls > 24) setLoading(false);
  }, [polls]);

  const meta = describeStatus(status);
  const toneColor =
    meta.tone === 'success'
      ? '#22C55E'
      : meta.tone === 'error'
        ? '#EF4444'
        : meta.tone === 'warning'
          ? '#F59E0B'
          : COLORS.primary;
  const icon =
    meta.tone === 'success'
      ? ('checkmark-circle' as const)
      : meta.tone === 'error'
        ? ('close-circle' as const)
        : ('time' as const);

  const goNext = () => {
    if (!payment) {
      router.replace('/(tabs)' as any);
      return;
    }
    const kind = payment.kind;
    const fulfillment = payment.fulfillment || {};
    if (kind === 'city_pass') {
      router.replace('/(tabs)/citypass' as any);
    } else if (kind === 'port_tax' && fulfillment.ticket_id) {
      router.replace({ pathname: '/port-tax/ticket/[id]' as any, params: { id: fulfillment.ticket_id } });
    } else if (kind === 'port_tax') {
      router.replace('/port-tax/tickets' as any);
    } else {
      router.replace('/(tabs)' as any);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/(tabs)' as any)} style={styles.backBtn}>
          <Ionicons name="close" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Resultado de pago</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 80 }}>
        <View style={[styles.bigIcon, { backgroundColor: toneColor + '22' }]}>
          {loading && status === 'pending' ? (
            <ActivityIndicator size="large" color={toneColor} />
          ) : (
            <Ionicons name={icon} size={64} color={toneColor} />
          )}
        </View>

        <Text style={[styles.title, { color: toneColor }]}>{meta.title}</Text>

        {!!payment?.description && <Text style={styles.subtitle}>{payment.description}</Text>}

        <View style={styles.card}>
          <Row label="Referencia" value={reference || '—'} />
          {!!payment?.amount_cop && <Row label="Monto" value={fmtCOP(payment.amount_cop)} bold />}
          {!!payment?.wompi_payment_method_type && (
            <Row label="Método" value={prettyMethod(payment.wompi_payment_method_type)} />
          )}
          {!!payment?.wompi_transaction_id && (
            <Row label="ID Wompi" value={payment.wompi_transaction_id} small />
          )}
          {!!wompiTxId && !payment?.wompi_transaction_id && (
            <Row label="ID Wompi" value={wompiTxId} small />
          )}
          <Row label="Estado" value={status.toUpperCase()} bold />
        </View>

        {status === 'pending' && (
          <View style={styles.helpBox}>
            <Ionicons name="information-circle" size={16} color={COLORS.textMuted} />
            <Text style={styles.helpText}>
              Tu pago aún se está procesando con Wompi. Esta página se actualiza automáticamente. Si Wompi tarda
              más de un minuto, puedes cerrar esta pantalla — tu pago se confirmará en el fondo y verás el
              resultado en tu perfil.
            </Text>
          </View>
        )}

        {status === 'approved' && (
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: toneColor }]} onPress={goNext}>
            <Text style={styles.primaryBtnText}>
              {payment?.kind === 'port_tax' ? 'Ver mi tiquete' : payment?.kind === 'city_pass' ? 'Ver mi City Pass' : 'Continuar'}
            </Text>
          </TouchableOpacity>
        )}

        {(status === 'declined' || status === 'error' || status === 'voided') && (
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: COLORS.primary }]}
            onPress={() => router.back()}
          >
            <Text style={styles.primaryBtnText}>{tr('Reintentar')}</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace('/(tabs)' as any)}>
          <Text style={styles.secondaryBtnText}>Volver al inicio</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, bold, small }: { label: string; value: string; bold?: boolean; small?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, bold && { ...FONTS.bold, color: COLORS.textMain }, small && { fontSize: 11 }]}>
        {value}
      </Text>
    </View>
  );
}

function prettyMethod(t: string): string {
  const map: Record<string, string> = {
    CARD: 'Tarjeta',
    NEQUI: 'Nequi',
    PSE: 'PSE',
    BANCOLOMBIA_TRANSFER: 'Bancolombia Transfer',
    BANCOLOMBIA_COLLECT: 'Bancolombia Corresponsalía',
    DAVIPLATA: 'Daviplata',
  };
  return map[t] || t;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold },
  bigIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.xl,
    marginBottom: SPACING.lg,
  },
  title: { textAlign: 'center', fontSize: 22, ...FONTS.bold, marginBottom: SPACING.xs },
  subtitle: { textAlign: 'center', fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, marginBottom: SPACING.lg },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    marginTop: SPACING.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    gap: SPACING.sm,
  },
  rowLabel: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium, flex: 1 },
  rowValue: { fontSize: 13, color: COLORS.textMain, ...FONTS.regular, textAlign: 'right', flex: 2 },
  helpBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    marginTop: SPACING.md,
  },
  helpText: { flex: 1, fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 16 },
  primaryBtn: {
    marginTop: SPACING.lg,
    paddingVertical: 14,
    borderRadius: RADIUS.full,
    alignItems: 'center',
  },
  primaryBtnText: { color: COLORS.white, ...FONTS.bold, fontSize: 14 },
  secondaryBtn: { marginTop: SPACING.sm, paddingVertical: 12, alignItems: 'center' },
  secondaryBtnText: { color: COLORS.textMuted, ...FONTS.medium, fontSize: 13 },
});
