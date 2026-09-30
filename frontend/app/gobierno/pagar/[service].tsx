// /gobierno/pagar/[service] — the DEMO checkout (docs/civic-demo/DESIGN.md §2).
//
// No card fields, no real payment: the "Pagar (demo)" button issues an ephemeral demo ticket. Fares
// are the server's (city_modules.json facts) and every charged line names the entity that collects
// it — the public entity is the merchant, AMO only issues the credential. The total shown is
// planCheckout() from civic.ts, which mirrors the backend's pricing (tested against the real router),
// so the amount on screen is the amount the ticket will carry. Unverified fares (muelle insurance,
// every coches tier) wear the "sin verificar" hedge. No retired port-tax wording anywhere.
//
// Hydration rule (React #418): the first render is the skeleton, identical on the server render and
// the first client render; the route param and all data are only read after load.
import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Head from '../../../src/components/WebHead';
import { Skeleton } from '../../../src/components/Skeleton';
import {
  DEMO_AMBER, DISCLAIMER_FALLBACK_ES, civicErrorMessage, firstParam, formatCop, getServices,
  hedgeText, iconOr, isAuthError, isUnverified, issueTicket, pickL2, planCheckout,
  serviceMerchants, uniqueNames, useCivicSession,
} from '../../../src/components/civic/civic';
import type {
  CheckoutLine, CheckoutPlan, CivicFact, CivicService, IconName, ServicesPayload,
} from '../../../src/components/civic/civic';
import { COLORS, FONTS, RADIUS, SPACING, TYPE } from '../../../src/constants/theme';
import { useLang } from '../../../src/context/LanguageContext';
import type { Lang } from '../../../src/i18n/translations';
import { useTr } from '../../../src/i18n/autoTr';
import { goBackOr } from '../../../src/lib/nav';

type NavHref = Parameters<Router['replace']>[0];

const NO_PLAN: CheckoutPlan = { lines: [], total: 0, request: null };

// ── Chrome ───────────────────────────────────────────────────────────────────
function DemoHeader({ onBack, label }: { onBack: () => void; label: string }) {
  const tr = useTr();
  return (
    <View style={s.headerBar}>
      <View style={s.headerInner}>
        <TouchableOpacity
          style={s.backBtn}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={tr('Volver')}
          testID="gobierno-pagar-back-btn"
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={s.headerLabel} numberOfLines={1}>{label}</Text>
        <View style={s.demoChip} accessibilityRole="text" accessibilityLabel={tr('Demostración')} testID="gobierno-pagar-demo-chip">
          <Ionicons name="flask-outline" size={12} color={DEMO_AMBER} />
          <Text style={s.demoChipText}>{tr('DEMO')}</Text>
        </View>
      </View>
    </View>
  );
}

function DisclaimerNote({ text }: { text: string }) {
  return (
    <View style={s.disclaimer} testID="gobierno-pagar-disclaimer">
      <Ionicons name="information-circle-outline" size={16} color={DEMO_AMBER} style={s.disclaimerIcon} />
      <Text style={s.disclaimerText}>{text}</Text>
    </View>
  );
}

function VerifyChip({ text }: { text: string }) {
  return (
    <View style={s.verifyChip}>
      <Ionicons name="alert-circle-outline" size={11} color={COLORS.coral} />
      <Text style={s.verifyChipText}>{text}</Text>
    </View>
  );
}

function StateCard({
  icon, title, text, actionLabel, onAction, testID,
}: { icon: IconName; title: string; text: string; actionLabel?: string; onAction?: () => void; testID: string }) {
  return (
    <View style={s.stateCard} testID={testID} accessibilityRole="alert">
      <Ionicons name={icon} size={30} color={COLORS.textMuted} />
      <Text style={s.stateTitle}>{title}</Text>
      <Text style={s.stateText}>{text}</Text>
      {!!actionLabel && !!onAction && (
        <TouchableOpacity style={s.primaryBtn} onPress={onAction} accessibilityRole="button" accessibilityLabel={actionLabel}>
          <Text style={s.primaryBtnText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Pickers ──────────────────────────────────────────────────────────────────
function AmountPicker({
  svc, amount, onPick, lang,
}: { svc: CivicService; amount: number | null; onPick: (a: number) => void; lang: Lang }) {
  const tr = useTr();
  const min = svc.minFact;
  const floor = svc.amounts.length > 0 ? Math.min(...svc.amounts) : null;
  const minValue = min?.value_cop ?? floor;
  return (
    <View style={s.card} testID="gobierno-pay-amounts">
      <Text style={s.cardTitle} accessibilityRole="header">{tr('Monto de recarga')}</Text>
      <View style={s.amountGrid} accessibilityRole="radiogroup">
        {svc.amounts.map((a) => {
          const on = a === amount;
          return (
            <TouchableOpacity
              key={a}
              style={[s.amountChip, on && s.amountChipOn]}
              onPress={() => onPick(a)}
              activeOpacity={0.85}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              aria-checked={on}
              accessibilityLabel={formatCop(a, lang)}
              testID={`gobierno-pay-amount-${a}`}
            >
              <Text style={[s.amountText, on && s.amountTextOn]}>{formatCop(a, lang)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {minValue !== null && (
        <View style={s.minNote} testID="gobierno-pay-min-note">
          <Text style={s.minText}>
            {tr('Monto mínimo de recarga en línea (PSE)')}: {formatCop(minValue, lang)}
          </Text>
          {!!min?.source_name && <Text style={s.small}>{min.source_name}</Text>}
          {!!min?.last_verified && <Text style={s.small}>{tr('Última verificación')}: {min.last_verified}</Text>}
        </View>
      )}
    </View>
  );
}

function TierPicker({
  svc, tier, onPick, lang, hedge,
}: { svc: CivicService; tier: string | null; onPick: (key: string) => void; lang: Lang; hedge: string }) {
  const tr = useTr();
  return (
    <View style={s.card} testID="gobierno-pay-tiers">
      <Text style={s.cardTitle} accessibilityRole="header">{tr('Elige tu tarifa')}</Text>
      <View accessibilityRole="radiogroup">
        {svc.tiers.map((t: CivicFact, i) => {
          const priced = t.value_cop !== null && t.value_cop > 0;
          const on = t.key === tier;
          const label = pickL2(t.label, lang);
          return (
            <TouchableOpacity
              key={t.key}
              style={[s.tierRow, i > 0 && s.rowDivider, on && s.tierRowOn, !priced && s.dim]}
              onPress={() => onPick(t.key)}
              disabled={!priced}
              activeOpacity={0.85}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled: !priced }}
              aria-checked={on}
              aria-disabled={!priced}
              accessibilityLabel={`${label}${priced && t.value_cop !== null ? ` · ${formatCop(t.value_cop, lang)}` : ''}`}
              testID={`gobierno-pay-tier-${t.key}`}
            >
              <Ionicons
                name={on ? 'radio-button-on' : 'radio-button-off'}
                size={22}
                color={on ? COLORS.primary : COLORS.iconMuted}
              />
              <View style={s.tierBody}>
                <Text style={s.tierLabel}>{label}</Text>
                {isUnverified(t.confidence) && <VerifyChip text={hedge} />}
              </View>
              <Text style={[s.tierPrice, on && s.tierPriceOn]}>
                {priced && t.value_cop !== null ? formatCop(t.value_cop, lang) : '—'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function InsuranceToggle({
  fact, on, onToggle, lang, hedge,
}: { fact: CivicFact; on: boolean; onToggle: () => void; lang: Lang; hedge: string }) {
  const tr = useTr();
  const priced = fact.value_cop !== null && fact.value_cop > 0;
  const merchant = pickL2(fact.merchant, lang);
  const label = pickL2(fact.label, lang);
  return (
    <View style={s.card} testID="gobierno-pay-options">
      <Text style={s.cardTitle} accessibilityRole="header">{tr('Opcional')}</Text>
      <TouchableOpacity
        style={[s.optionRow, on && s.tierRowOn, !priced && s.dim]}
        onPress={onToggle}
        disabled={!priced}
        activeOpacity={0.85}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on, disabled: !priced }}
        aria-checked={on}
        aria-disabled={!priced}
        accessibilityLabel={`${label}${priced && fact.value_cop !== null ? ` · ${formatCop(fact.value_cop, lang)}` : ''}`}
        testID="gobierno-pay-insurance"
      >
        <Ionicons name={on ? 'checkbox' : 'square-outline'} size={24} color={on ? COLORS.primary : COLORS.iconMuted} />
        <View style={s.tierBody}>
          <Text style={s.tierLabel}>{label}</Text>
          {!!merchant && <Text style={s.lineMerchant}>{tr('Recauda')}: {merchant}</Text>}
          {isUnverified(fact.confidence) && <VerifyChip text={hedge} />}
        </View>
        <Text style={[s.tierPrice, on && s.tierPriceOn]}>
          {priced && fact.value_cop !== null ? formatCop(fact.value_cop, lang) : '—'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Receipt preview ──────────────────────────────────────────────────────────
function SummaryLine({
  line, first, lang, hedge,
}: { line: CheckoutLine; first: boolean; lang: Lang; hedge: string }) {
  const tr = useTr();
  const merchant = pickL2(line.merchant, lang);
  return (
    <View style={[s.sumLine, !first && s.rowDivider]} testID={`gobierno-pay-line-${line.key}`}>
      <View style={s.sumLineTop}>
        <Text style={s.sumLabel}>{line.label ? pickL2(line.label, lang) : tr('Recarga de tarjeta Transcaribe')}</Text>
        <Text style={s.sumAmount}>{formatCop(line.value_cop, lang)}</Text>
      </View>
      {!!merchant && <Text style={s.lineMerchant}>{tr('Recauda')}: {merchant}</Text>}
      {isUnverified(line.confidence) && <VerifyChip text={hedge} />}
      {!!line.source_name && <Text style={s.small}>{line.source_name}</Text>}
      {!!line.last_verified && <Text style={s.small}>{tr('Última verificación')}: {line.last_verified}</Text>}
    </View>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────
export default function GobiernoPagarScreen() {
  const tr = useTr();
  const { lang } = useLang();
  const router = useRouter();
  const params = useLocalSearchParams<{ service: string }>();
  const serviceKey = firstParam(params.service);
  const { ready, token, signOut } = useCivicSession();

  const [payload, setPayload] = useState<ServicesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [tierChoice, setTierChoice] = useState<string | null>(null);
  const [amountChoice, setAmountChoice] = useState<number | null>(null);
  const [insurance, setInsurance] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [payError, setPayError] = useState<unknown>(null);
  const alive = useRef(true);
  const submitLock = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setLoadError(null);
    try {
      const p = await getServices(token);
      if (alive.current) setPayload(p);
    } catch (e) {
      console.error('[GobiernoPagar] services', e);
      if (alive.current) setLoadError(e);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // A different service (deep link reuse) starts from its own defaults.
  useEffect(() => {
    setTierChoice(null);
    setAmountChoice(null);
    setInsurance(false);
    setPayError(null);
  }, [serviceKey]);

  const svc = useMemo<CivicService | null>(
    () => payload?.services.find((x) => x.key === serviceKey) ?? null,
    [payload, serviceKey],
  );
  const defaultTier = useMemo(() => {
    if (!svc) return null;
    const first = svc.tiers.find((t) => t.value_cop !== null && t.value_cop > 0);
    return first ? first.key : null;
  }, [svc]);
  const defaultAmount = svc && svc.amounts.length > 0 ? Math.min(...svc.amounts) : null;
  const tier = tierChoice ?? defaultTier;
  const amount = amountChoice ?? defaultAmount;

  const plan = useMemo<CheckoutPlan>(
    () => (svc ? planCheckout(svc, { tier, insurance, amount }) : NO_PLAN),
    [svc, tier, insurance, amount],
  );

  const goBack = useCallback(() => goBackOr(router, '/gobierno'), [router]);
  const goHub = useCallback(() => {
    try {
      router.replace('/gobierno' as NavHref);
    } catch (e) {
      console.error('[GobiernoPagar] navigate hub', e);
    }
  }, [router]);

  const pay = useCallback(async () => {
    if (!token || !plan.request || submitLock.current) return;
    submitLock.current = true; // a ref: two fast taps must not both pass a state check
    setSubmitting(true);
    setPayError(null);
    try {
      const { ticket } = await issueTicket(token, plan.request);
      // replace, not push: Back from the boleta returns to the hub, never to a checkout that could
      // issue a second ticket. The lock stays on so the button cannot fire again while navigating.
      router.replace(`/gobierno/boleta/${encodeURIComponent(ticket.ticket_id)}` as NavHref);
    } catch (e) {
      console.error('[GobiernoPagar] issue', e);
      submitLock.current = false;
      if (alive.current) {
        setPayError(e);
        setSubmitting(false);
      }
    }
  }, [token, plan.request, router]);

  // ── All hooks are above this line; the JSX below branches but never returns early. ──
  const needSession = ready && (!token || isAuthError(loadError));
  const disclaimer = pickL2(payload?.disclaimer ?? null, lang) || tr(DISCLAIMER_FALLBACK_ES);
  const hedge = hedgeText(tr, serviceKey);
  const payable = svc !== null && (svc.mode === 'pay' || svc.mode === 'recharge');

  let body: React.ReactNode;
  if (!ready || (loading && !payload && !needSession)) {
    body = (
      <View style={s.skeletons} testID="gobierno-pagar-skeleton">
        <Skeleton height={64} borderRadius={RADIUS.xl} />
        <Skeleton height={150} borderRadius={RADIUS.xl} style={s.skelGap} />
        <Skeleton height={170} borderRadius={RADIUS.xl} style={s.skelGap} />
        <Skeleton height={54} borderRadius={RADIUS.full} style={s.skelGap} />
      </View>
    );
  } else if (needSession) {
    body = (
      <StateCard
        icon="lock-closed-outline"
        title={tr('Sesión requerida')}
        text={tr('Esta demostración es solo para el Distrito. Ingresa con el código de acceso de la demostración.')}
        actionLabel={tr('Ingresar de nuevo')}
        onAction={signOut}
        testID="gobierno-pagar-session-required"
      />
    );
  } else if (loadError !== null && !payload) {
    body = (
      <StateCard
        icon="cloud-offline-outline"
        title={tr('No pudimos cargar el servicio')}
        text={civicErrorMessage(loadError, lang, tr, tr('La demostración no está disponible en este momento.'))}
        actionLabel={tr('Reintentar')}
        onAction={load}
        testID="gobierno-pagar-error"
      />
    );
  } else if (!svc) {
    body = (
      <StateCard
        icon="search-outline"
        title={tr('No encontramos este servicio')}
        text={tr('Puede que el enlace haya cambiado. Mira los servicios de la demostración.')}
        actionLabel={tr('Ver servicios')}
        onAction={goHub}
        testID="gobierno-pagar-notfound"
      />
    );
  } else if (!payable) {
    body = (
      <StateCard
        icon="information-circle-outline"
        title={pickL2(svc.title, lang)}
        text={tr('Este servicio no tiene pago en la demostración.')}
        actionLabel={tr('Ver servicios')}
        onAction={goHub}
        testID="gobierno-pagar-nopay"
      />
    );
  } else {
    const receipt = svc.mode === 'recharge';
    const insuranceFact = svc.tiers.length === 0 ? svc.facts.find((f) => f.option === 'insurance') ?? null : null;
    const collectors = uniqueNames(plan.lines.map((l) => l.merchant), lang);
    const payTo = collectors.length > 0 ? collectors : serviceMerchants(svc, lang);
    const anyUnverified = plan.lines.some((l) => isUnverified(l.confidence));
    const canPay = plan.request !== null && !submitting;
    body = (
      <>
        <View style={s.titleBlock} testID="gobierno-pagar-title">
          <View style={s.titleRow}>
            <View style={s.titleDisc}>
              <Ionicons name={iconOr(svc.icon, 'card-outline')} size={24} color={COLORS.primary} />
            </View>
            <Text style={s.title} accessibilityRole="header">{pickL2(svc.title, lang)}</Text>
          </View>
          <View style={s.kindPill}>
            <Text style={s.kindPillText}>{receipt ? tr('Comprobante') : tr('Credencial QR')}</Text>
          </View>
          {receipt && (
            <Text style={s.kindNote}>
              {tr('Al pagar recibes un comprobante de la recarga; no es una credencial de acceso.')}
            </Text>
          )}
        </View>

        {receipt && <AmountPicker svc={svc} amount={amount} onPick={setAmountChoice} lang={lang} />}
        {svc.tiers.length > 0 && <TierPicker svc={svc} tier={tier} onPick={setTierChoice} lang={lang} hedge={hedge} />}
        {insuranceFact && (
          <InsuranceToggle fact={insuranceFact} on={insurance} onToggle={() => setInsurance((v) => !v)} lang={lang} hedge={hedge} />
        )}

        <View style={s.card} testID="gobierno-pay-summary">
          <Text style={s.cardTitle} accessibilityRole="header">{tr('Detalle del cobro')}</Text>
          {plan.lines.length > 0 ? (
            plan.lines.map((l, i) => <SummaryLine key={l.key} line={l} first={i === 0} lang={lang} hedge={hedge} />)
          ) : (
            <Text style={s.emptyNote}>{tr('Elige una opción para ver el total.')}</Text>
          )}
          <View style={[s.feeRow, s.rowDivider]} testID="gobierno-pay-fee">
            <Text style={s.feeLabel}>{tr('Comisión para el ciudadano')}</Text>
            <Text style={s.feeValue}>{formatCop(0, lang)} — {tr('modelo por convenio')}</Text>
          </View>
          <View style={[s.totalRow, s.rowDivider]}>
            <Text style={s.totalLabel}>{tr('Total (demo)')}</Text>
            <View style={s.totalRight}>
              <Text style={s.totalAmount} testID="gobierno-pay-total">{formatCop(plan.total, lang)}</Text>
              {anyUnverified && <VerifyChip text={hedge} />}
            </View>
          </View>
        </View>

        {payError !== null && (
          <View style={s.errorBox} accessibilityRole="alert" testID="gobierno-pay-error">
            <Ionicons name="alert-circle" size={18} color={COLORS.coral} style={s.errorIcon} />
            <Text style={s.errorText}>{civicErrorMessage(payError, lang, tr)}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[s.payBtn, !canPay && s.payBtnOff]}
          onPress={pay}
          disabled={!canPay}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canPay, busy: submitting }}
          aria-disabled={!canPay}
          aria-busy={submitting}
          accessibilityLabel={`${tr('Pagar (demo)')} · ${formatCop(plan.total, lang)}`}
          testID="gobierno-pay-button"
        >
          {submitting ? (
            <>
              <ActivityIndicator size="small" color={COLORS.black} />
              <Text style={s.payBtnText}>{tr('Procesando…')}</Text>
            </>
          ) : (
            <Text style={s.payBtnText}>{tr('Pagar (demo)')}</Text>
          )}
        </TouchableOpacity>

        {payTo.length > 0 && (
          <View style={s.payTo} testID="gobierno-pay-collector">
            <Ionicons name="business-outline" size={15} color={COLORS.official} style={s.payToIcon} />
            <Text style={s.payToText}>
              {tr('El recaudo llega a')}: <Text style={s.payToName}>{payTo.join(' · ')}</Text>
            </Text>
          </View>
        )}
        <Text style={s.noData}>{tr('Sin datos de pago: el cobro es simulado.')}</Text>
      </>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="gobierno-pagar-screen">
      <Head>
        <title>{`${svc ? pickL2(svc.title, lang) : tr('Pagar (demo)')} · AMO Life`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <DemoHeader onBack={goBack} label={tr('Pagos ciudadanos')} />
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={s.content}>
          {body}
          <DisclaimerNote text={disclaimer} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },

  // header (pinned: the DEMO chip never scrolls away)
  headerBar: { borderBottomWidth: 1, borderBottomColor: COLORS.hairline, backgroundColor: COLORS.background },
  headerInner: { width: '100%', maxWidth: 560, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm + 4 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.hairline, alignItems: 'center', justifyContent: 'center' },
  headerLabel: { flex: 1, fontSize: 14, color: COLORS.textMuted, ...FONTS.semibold },
  demoChip: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 28, backgroundColor: 'rgba(245,166,35,0.14)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.55)', borderRadius: RADIUS.full, paddingHorizontal: 11, paddingVertical: 4 },
  demoChipText: { fontSize: 11.5, color: DEMO_AMBER, ...FONTS.bold, letterSpacing: 1.4 },

  // title block
  titleBlock: { paddingTop: SPACING.lg, gap: 10, alignItems: 'flex-start' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm + 4 },
  titleDisc: { width: 48, height: 48, borderRadius: RADIUS.md, backgroundColor: 'rgba(18,181,165,0.14)', alignItems: 'center', justifyContent: 'center' },
  title: { ...TYPE.title2, color: COLORS.textMain, flex: 1 },
  kindPill: { borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4, borderColor: 'rgba(18,181,165,0.40)', backgroundColor: 'rgba(18,181,165,0.10)' },
  kindPillText: { fontSize: 11, color: COLORS.primary, ...FONTS.bold, letterSpacing: 0.4 },
  kindNote: { fontSize: 12.5, lineHeight: 18, color: COLORS.textMuted, ...FONTS.medium },

  // cards
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, marginTop: SPACING.md },
  cardTitle: { ...TYPE.headline, color: COLORS.textMain, marginBottom: SPACING.sm },
  small: { fontSize: 11, lineHeight: 15, color: COLORS.textFaint, ...FONTS.medium },
  rowDivider: { borderTopWidth: 1, borderTopColor: COLORS.hairline },
  dim: { opacity: 0.45 },

  // amount picker
  amountGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  amountChip: { flexBasis: '47%', flexGrow: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', backgroundColor: 'rgba(255,255,255,0.04)' },
  amountChipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  amountText: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold, fontVariant: ['tabular-nums'] },
  amountTextOn: { color: COLORS.black },
  minNote: { marginTop: SPACING.md, gap: 3, paddingTop: SPACING.sm + 2, borderTopWidth: 1, borderTopColor: COLORS.hairline },
  minText: { fontSize: 12.5, lineHeight: 18, color: COLORS.textMain, ...FONTS.medium },

  // tier / option rows
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm + 4, minHeight: 60, paddingVertical: 10 },
  tierRowOn: { backgroundColor: 'rgba(18,181,165,0.06)', borderRadius: RADIUS.md },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm + 4, minHeight: 60, paddingVertical: 10, paddingHorizontal: 4 },
  tierBody: { flex: 1, gap: 4, alignItems: 'flex-start' },
  tierLabel: { fontSize: 13.5, lineHeight: 18, color: COLORS.textMain, ...FONTS.semibold },
  tierPrice: { fontSize: 15, color: COLORS.textMuted, ...FONTS.bold, fontVariant: ['tabular-nums'] },
  tierPriceOn: { color: COLORS.primary },
  lineMerchant: { fontSize: 12, lineHeight: 17, color: COLORS.textMuted, ...FONTS.regular },
  verifyChip: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2, borderColor: `${COLORS.coral}8C`, backgroundColor: `${COLORS.coral}1A` },
  verifyChipText: { flexShrink: 1, fontSize: 10.5, color: COLORS.coral, ...FONTS.bold, letterSpacing: 0.2 },

  // receipt preview
  sumLine: { paddingVertical: 10, gap: 4, alignItems: 'flex-start' },
  sumLineTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: SPACING.sm + 4, alignSelf: 'stretch' },
  sumLabel: { flex: 1, fontSize: 13.5, lineHeight: 18, color: COLORS.textMain, ...FONTS.semibold },
  sumAmount: { fontSize: 14.5, color: COLORS.textMain, ...FONTS.bold, fontVariant: ['tabular-nums'] },
  feeRow: { paddingVertical: 12, gap: 2 },
  feeLabel: { fontSize: 12.5, lineHeight: 17, color: COLORS.textMuted, ...FONTS.medium },
  feeValue: { fontSize: 13.5, lineHeight: 18, color: COLORS.textMain, ...FONTS.semibold },
  totalRow: { paddingTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.sm + 4 },
  totalLabel: { fontSize: 14, color: COLORS.textMuted, ...FONTS.semibold },
  totalRight: { flex: 1, alignItems: 'flex-end', gap: 6 },
  totalAmount: { fontSize: 28, lineHeight: 34, color: COLORS.textMain, ...FONTS.bold, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  emptyNote: { fontSize: 12.5, lineHeight: 18, color: COLORS.textMuted, ...FONTS.medium },

  // pay
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: 'rgba(255,107,74,0.10)', borderWidth: 1, borderColor: 'rgba(255,107,74,0.40)' },
  errorIcon: { marginTop: 1 },
  errorText: { flex: 1, fontSize: 13, lineHeight: 18, color: COLORS.textMain, ...FONTS.medium },
  payBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 56, marginTop: SPACING.md, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: SPACING.xl },
  payBtnOff: { opacity: 0.45 },
  payBtnText: { fontSize: 16, color: COLORS.black, ...FONTS.bold },
  payTo: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: SPACING.md, paddingHorizontal: 2 },
  payToIcon: { marginTop: 2 },
  payToText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: COLORS.textMuted, ...FONTS.medium },
  payToName: { color: COLORS.textMain, ...FONTS.semibold },
  noData: { marginTop: SPACING.xs + 2, paddingHorizontal: 2, fontSize: 11.5, lineHeight: 16, color: COLORS.textFaint, ...FONTS.medium },

  // states
  skeletons: { marginTop: SPACING.lg },
  skelGap: { marginTop: SPACING.md },
  stateCard: { alignItems: 'center', gap: 10, marginTop: SPACING.lg, padding: SPACING.lg, borderRadius: RADIUS.xl, backgroundColor: COLORS.surface, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.border },
  stateTitle: { ...TYPE.title3, color: COLORS.textMain, textAlign: 'center' },
  stateText: { ...TYPE.subhead, color: COLORS.textMuted, textAlign: 'center' },
  primaryBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, paddingHorizontal: SPACING.xl, paddingVertical: 12, borderRadius: RADIUS.full, marginTop: SPACING.xs },
  primaryBtnText: { fontSize: 14, color: COLORS.black, ...FONTS.bold },

  // disclaimer footer
  disclaimer: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: SPACING.xl, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(245,166,35,0.35)', backgroundColor: 'rgba(245,166,35,0.06)' },
  disclaimerIcon: { marginTop: 1 },
  disclaimerText: { flex: 1, fontSize: 12, lineHeight: 17, color: COLORS.textMuted, ...FONTS.medium },
});
