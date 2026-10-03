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
import { api, isAuthStatus, isGoneStatus } from '../../src/constants/api';
import { describeStatus } from '../../src/lib/wompi';
import { useTr } from '../../src/i18n/autoTr';
import { goHome, goTab } from '../../src/lib/nav';

const fmtCOP = (n: number) =>
  '$ ' + (Number(n) || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });

// P1-9: why this screen cannot show a REAL payment status. It used to swallow every
// poll error and keep the default "Pago en proceso… PENDING" forever — even for a
// link with no reference at all. null = polling normally.
//   no_reference — the URL carries no reference: there is nothing to look up
//   unverified   — N consecutive polls failed (outage), or the server answered 401/403/404
type PollFail = 'no_reference' | 'unverified';
const MAX_FAILED_POLLS = 4; // consecutive failures tolerated (each poll is 2.5 s apart + request time)

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
  const [pollFail, setPollFail] = useState<PollFail | null>(null);
  const [attempt, setAttempt] = useState(0); // bumped by "Reintentar" to restart polling

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    setPollFail(null);
    if (!reference) {
      // Nothing to poll: never an endless "Pago en proceso… PENDING" for a reference-less link.
      // Set in the EFFECT, not derived at render: the static export prerenders this route with
      // no URL params, so a render-time branch on `reference` would differ from the client's
      // first render and break hydration (React #418).
      setLoading(false);
      setPollFail('no_reference');
      return;
    }
    setLoading(true);
    setPolls(0);
    const tick = async () => {
      try {
        const p = await api.get(`/payments/by-reference/${reference}`);
        if (cancelled) return;
        failures = 0;
        setPayment(p);
        setStatus(p?.status || 'pending');
        if (p?.status && p.status !== 'pending') {
          setLoading(false);
          return;
        }
      } catch (e) {
        if (cancelled) return;
        // 401/403 (signed out / not your payment) and 404 (no such reference) are ANSWERS —
        // polling again cannot change them. Anything else is an outage: tolerate a few
        // blips, then stop claiming the payment is "en proceso" when we cannot even ask.
        failures += 1;
        console.error('[PaymentReturn] status poll failed', failures, e);
        if (isAuthStatus(e) || isGoneStatus(e) || failures >= MAX_FAILED_POLLS) {
          setLoading(false);
          setPollFail('unverified');
          return;
        }
      }
      setPolls((n) => n + 1);
      if (!cancelled) timer = setTimeout(tick, 2500);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [reference, attempt]);

  // Stop polling after ~60s — payment will still arrive via webhook
  useEffect(() => {
    if (polls > 24) setLoading(false);
  }, [polls]);

  // When we cannot reach a real status, say so — never the default "pending".
  const failReason: PollFail | null = pollFail;
  const failed = failReason !== null;
  const meta = failed
    ? { title: failReason === 'no_reference' ? 'Falta la referencia del pago' : 'No pudimos verificar tu pago', tone: 'warning' as const }
    : describeStatus(status);
  const toneColor =
    meta.tone === 'success'
      ? '#22C55E'
      : meta.tone === 'error'
        ? '#EF4444'
        : meta.tone === 'warning'
          ? '#F59E0B'
          : COLORS.primary;
  const icon = failed
    ? ('alert-circle' as const)
    : meta.tone === 'success'
      ? ('checkmark-circle' as const)
      : meta.tone === 'error'
        ? ('close-circle' as const)
        : ('time' as const);

  const goNext = () => {
    if (!payment) {
      goHome(router);
      return;
    }
    const kind = payment.kind;
    if (kind === 'city_pass') {
      goTab(router, '/(tabs)/citypass');
    } else if (kind === 'port_tax') {
      // Retired product (2026-09-26): the ticket / QR screens are gone. A dormant
      // port_tax payment lands on the official pier / park / insurance prices.
      router.replace('/ciudad/muelle-bodeguita' as any);
    } else {
      goHome(router);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => goHome(router)} style={styles.backBtn}>
          <Ionicons name="close" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{tr('Resultado de pago')}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 80 }}>
        <View style={[styles.bigIcon, { backgroundColor: toneColor + '22' }]}>
          {loading && !failed && status === 'pending' ? (
            <ActivityIndicator size="large" color={toneColor} />
          ) : (
            <Ionicons name={icon} size={64} color={toneColor} />
          )}
        </View>

        <Text style={[styles.title, { color: toneColor }]}>{tr(meta.title)}</Text>

        {failed ? (
          <Text style={styles.subtitle} testID="payment-return-error">
            {failReason === 'no_reference'
              ? tr('Este enlace no incluye la referencia de tu pago, así que no podemos mostrarte su estado.')
              : tr('No pudimos consultar el estado de tu pago. Revisa tu conexión y que hayas iniciado sesión con la misma cuenta con la que pagaste. Si ya completaste el pago en Wompi, puedes cerrar esta pantalla y revisarlo más tarde en tu perfil.')}
          </Text>
        ) : !!payment?.description && <Text style={styles.subtitle}>{payment.description}</Text>}

        <View style={styles.card}>
          <Row label="Referencia" value={reference || '—'} />
          {!!payment?.amount_cop && <Row label="Monto" value={fmtCOP(payment.amount_cop)} bold />}
          {!!payment?.wompi_payment_method_type && (
            <Row label="Método" value={tr(prettyMethod(payment.wompi_payment_method_type))} />
          )}
          {!!payment?.wompi_transaction_id && (
            <Row label="ID Wompi" value={payment.wompi_transaction_id} small />
          )}
          {!!wompiTxId && !payment?.wompi_transaction_id && (
            <Row label="ID Wompi" value={wompiTxId} small />
          )}
          {/* No "Estado: PENDING" when we do not actually know the status */}
          {!failed && <Row label="Estado" value={status.toUpperCase()} bold />}
        </View>

        {!failed && status === 'pending' && (
          <View style={styles.helpBox}>
            <Ionicons name="information-circle" size={16} color={COLORS.textMuted} />
            <Text style={styles.helpText}>
              {tr('Tu pago aún se está procesando con Wompi. Esta página se actualiza automáticamente. Si Wompi tarda más de un minuto, puedes cerrar esta pantalla — tu pago se confirmará en el fondo y verás el resultado en tu perfil.')}
            </Text>
          </View>
        )}

        {status === 'approved' && (
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: toneColor }]} onPress={goNext}>
            <Text style={styles.primaryBtnText}>
              {payment?.kind === 'port_tax' ? tr('Ver precios oficiales del muelle (islas)') : payment?.kind === 'city_pass' ? tr('Ver mi City Pass') : tr('Continuar')}
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

        {failReason === 'unverified' && (
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: COLORS.primary }]}
            onPress={() => setAttempt((a) => a + 1)}
            accessibilityRole="button"
            accessibilityLabel={tr('Reintentar')}
            testID="payment-return-retry"
          >
            <Text style={styles.primaryBtnText}>{tr('Reintentar')}</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => goHome(router)}>
          <Text style={styles.secondaryBtnText}>{tr('Volver al inicio')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, bold, small }: { label: string; value: string; bold?: boolean; small?: boolean }) {
  const tr = useTr();
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{tr(label)}</Text>
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
