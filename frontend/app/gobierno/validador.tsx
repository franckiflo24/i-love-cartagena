// /gobierno/validador — the operator's checkpoint (docs/civic-demo/DESIGN.md §2-§3).
//
// The site ships Permissions-Policy: camera=(), so there is no camera scanner. The primary interaction
// is the "Boletas vivas" list: each live ticket offers "Simular escaneo" (the SERVER derives the current
// wire and runs the same verdict pipeline as a real scan) plus two attack demos — "Código adulterado"
// (bad token → FALSIFICADO) and "Código vencido" (stale step → EXPIRADO). Pasting a wire stays
// available as a secondary path. Verdicts: VÁLIDO / DUPLICADO / FALSIFICADO / EXPIRADO, and RECIBO for
// a recharge receipt — a receipt verifies but is never an access credential, so it is never VÁLIDO.
//
// Honesty: the pinned DEMO chip and the bordered disclaimer wear this screen like every /gobierno
// screen; an unverified fare keeps its "sin verificar" hedge; a FALSIFICADO that still names a real
// ticket labels that panel as untrusted (it is what the forged code CLAIMS to be).
//
// Hydration rule (React #418): the first render is static chrome + skeletons; nothing data- or
// clock-derived renders before effects run. Times shown are formatted from server timestamps.
import React, {
  useCallback, useEffect, useRef, useState,
} from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { Router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Head from '../../src/components/WebHead';
import { Skeleton } from '../../src/components/Skeleton';
import {
  DEMO_AMBER, DISCLAIMER_FALLBACK_ES, civicErrorMessage, formatBogota, formatCop, getLiveTickets,
  getServices, getSummary, hedgeText, isAuthError, pickL2, scan, ticketHasUnverified,
  ticketMerchants, useCivicSession,
} from '../../src/components/civic/civic';
import type {
  CivicTicket, IconName, ScanRequest, ScanResult, ScanRow, ServicesPayload, SummaryPayload, Translate,
  Verdict,
} from '../../src/components/civic/civic';
import { COLORS, FONTS, RADIUS, SPACING, TYPE } from '../../src/constants/theme';
import { useLang } from '../../src/context/LanguageContext';
import type { Lang } from '../../src/i18n/translations';
import { useTr } from '../../src/i18n/autoTr';
import { goBackOr } from '../../src/lib/nav';

type NavHref = Parameters<Router['navigate']>[0];

const WIRE_MIN = 8; // the server rejects shorter pasted codes with a 422
const WIRE_MAX = 200;
const GATE_MAX = 40;
const GRAY = '#9AA3B2';
const RED = '#F87171';
const MONO = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
});

interface Tone { color: string; bg: string; border: string }
const TEAL: Tone = { color: COLORS.primary, bg: 'rgba(18,181,165,0.12)', border: 'rgba(18,181,165,0.55)' };
const AMBER_TONE: Tone = { color: DEMO_AMBER, bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.55)' };
const RED_TONE: Tone = { color: RED, bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.55)' };
const GRAY_TONE: Tone = { color: GRAY, bg: 'rgba(154,163,178,0.10)', border: 'rgba(154,163,178,0.45)' };

/** Colors for ANY verdict string (the ledger may carry one this client does not know: neutral). */
function toneFor(verdict: string): Tone {
  switch (verdict) {
    case 'VALIDO':
    case 'RECIBO': return TEAL;
    case 'DUPLICADO': return AMBER_TONE;
    case 'FALSIFICADO': return RED_TONE;
    default: return GRAY_TONE;
  }
}

interface VerdictMeta extends Tone { icon: IconName; label: string; text: string }
function verdictMeta(v: Verdict, tr: Translate): VerdictMeta {
  switch (v) {
    case 'VALIDO':
      return { ...TEAL, icon: 'checkmark-circle', label: tr('VÁLIDO'), text: tr('Credencial vigente. Acceso registrado.') };
    case 'RECIBO':
      return { ...TEAL, icon: 'receipt-outline', label: tr('RECIBO'), text: tr('Comprobante válido — no es credencial de acceso') };
    case 'DUPLICADO':
      return { ...AMBER_TONE, icon: 'copy-outline', label: tr('DUPLICADO'), text: tr('Esta credencial ya fue usada.') };
    case 'FALSIFICADO':
      return { ...RED_TONE, icon: 'close-circle', label: tr('FALSIFICADO'), text: tr('Código no auténtico: la firma no coincide o la boleta no existe.') };
    case 'EXPIRADO':
      return { ...GRAY_TONE, icon: 'time-outline', label: tr('EXPIRADO'), text: tr('Código auténtico, pero ya venció: rota cada 10 s.') };
  }
}

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
          testID="gobierno-validador-back-btn"
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={s.headerLabel} numberOfLines={1}>{label}</Text>
        <View style={s.demoChip} accessibilityRole="text" accessibilityLabel={tr('Demostración')} testID="gobierno-validador-demo-chip">
          <Ionicons name="flask-outline" size={12} color={DEMO_AMBER} />
          <Text style={s.demoChipText}>{tr('DEMO')}</Text>
        </View>
      </View>
    </View>
  );
}

function DisclaimerNote({ text }: { text: string }) {
  return (
    <View style={s.disclaimer} testID="gobierno-validador-disclaimer">
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

// ── Verdict ──────────────────────────────────────────────────────────────────
function VerdictCard({ result, lang }: { result: ScanResult; lang: Lang }) {
  const tr = useTr();
  const meta = verdictMeta(result.verdict, tr);
  const t = result.ticket;
  const receipt = t?.kind === 'receipt';
  const names = t ? ticketMerchants(t, lang) : [];
  return (
    <View
      style={[s.verdict, { backgroundColor: meta.bg, borderColor: meta.border }]}
      accessibilityLiveRegion="polite"
      testID="gobierno-validador-verdict"
    >
      <View style={s.verdictHead}>
        <Ionicons name={meta.icon} size={44} color={meta.color} />
        <View style={s.verdictHeadText}>
          <Text style={[s.verdictLabel, { color: meta.color }]} testID="gobierno-validador-verdict-label">{meta.label}</Text>
          <Text style={s.verdictText}>{meta.text}</Text>
        </View>
      </View>

      {result.verdict === 'DUPLICADO' && (
        <View style={s.firstUse} testID="gobierno-validador-first-use">
          <Ionicons name="time-outline" size={14} color={COLORS.textMuted} />
          <Text style={s.firstUseText}>
            {tr('Primer uso')}: {formatBogota(result.first_used_at, true)}
            {result.first_gate ? ` · ${result.first_gate}` : ''}
          </Text>
        </View>
      )}

      {t && (
        <View style={s.ticketPanel} testID="gobierno-validador-ticket">
          <Text style={s.panelHead}>
            {result.verdict === 'FALSIFICADO' ? tr('La credencial dice ser') : tr('Boleta')}
          </Text>
          <Text style={s.panelTitle}>
            {receipt ? tr('Comprobante de recarga (demo)') : pickL2(t.title, lang)}
          </Text>
          {names.length > 0 && (
            <Text style={s.panelMerchant}>
              {names.length > 1 ? tr('Recaudan') : tr('Recauda')}: {names.join(' · ')}
            </Text>
          )}
          <View style={s.panelAmountRow}>
            <Text style={s.panelAmount}>{formatCop(t.amount_cop, lang)}</Text>
            {ticketHasUnverified(t) && <VerifyChip text={hedgeText(tr, t.service)} />}
          </View>
          {result.verdict === 'FALSIFICADO' && (
            <Text style={s.small}>
              {tr('Estos datos son los de la boleta que el código dice ser; no son de confianza.')}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

// ── Boletas vivas ────────────────────────────────────────────────────────────
interface LiveRowProps {
  ticket: CivicTicket;
  lang: Lang;
  /** Which action of THIS row is in flight, if any. */
  busyAction: 'sim' | 'tam' | 'old' | null;
  anyBusy: boolean;
  onSimulate: (id: string) => void;
  onTamper: (id: string) => void;
  onStale: (id: string) => void;
}

const LiveRow = React.memo(function LiveRow({
  ticket, lang, busyAction, anyBusy, onSimulate, onTamper, onStale,
}: LiveRowProps) {
  const tr = useTr();
  const receipt = ticket.kind === 'receipt';
  const names = ticketMerchants(ticket, lang);
  const title = receipt ? tr('Comprobante de recarga (demo)') : pickL2(ticket.title, lang);
  return (
    <View style={s.liveRow} testID={`gobierno-live-${ticket.ticket_id}`}>
      <View style={s.liveTop}>
        <Text style={s.liveTitle}>{title}</Text>
        {receipt && (
          <View style={s.kindChip}><Text style={s.kindChipText}>{tr('Comprobante')}</Text></View>
        )}
      </View>
      {names.length > 0 && <Text style={s.liveMerchant} numberOfLines={2}>{names.join(' · ')}</Text>}
      <View style={s.liveMeta}>
        <Text style={s.liveAmount}>{formatCop(ticket.amount_cop, lang)}</Text>
        {ticketHasUnverified(ticket) && <VerifyChip text={hedgeText(tr, ticket.service)} />}
        <Text style={s.liveId}>{ticket.ticket_id} · {formatBogota(ticket.created_at)}</Text>
      </View>

      <TouchableOpacity
        style={[s.simBtn, anyBusy && s.btnOff]}
        onPress={() => onSimulate(ticket.ticket_id)}
        disabled={anyBusy}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityState={{ disabled: anyBusy, busy: busyAction === 'sim' }}
        aria-disabled={anyBusy}
        aria-busy={busyAction === 'sim'}
        accessibilityLabel={`${tr('Simular escaneo')} · ${title}`}
        testID={`gobierno-live-${ticket.ticket_id}-simulate`}
      >
        {busyAction === 'sim' ? <ActivityIndicator size="small" color={COLORS.black} /> : <Ionicons name="scan-outline" size={18} color={COLORS.black} />}
        <Text style={s.simBtnText}>{tr('Simular escaneo')}</Text>
      </TouchableOpacity>

      <View style={s.attackRow}>
        <TouchableOpacity
          style={[s.attackBtn, s.attackTamper, anyBusy && s.btnOff]}
          onPress={() => onTamper(ticket.ticket_id)}
          disabled={anyBusy}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityState={{ disabled: anyBusy, busy: busyAction === 'tam' }}
          aria-disabled={anyBusy}
          aria-busy={busyAction === 'tam'}
          accessibilityLabel={`${tr('Código adulterado')} · ${title}`}
          testID={`gobierno-live-${ticket.ticket_id}-tamper`}
        >
          {busyAction === 'tam' ? <ActivityIndicator size="small" color={RED} /> : <Ionicons name="warning-outline" size={15} color={RED} />}
          <Text style={[s.attackText, { color: RED }]} numberOfLines={1}>{tr('Código adulterado')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.attackBtn, s.attackStale, anyBusy && s.btnOff]}
          onPress={() => onStale(ticket.ticket_id)}
          disabled={anyBusy}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityState={{ disabled: anyBusy, busy: busyAction === 'old' }}
          aria-disabled={anyBusy}
          aria-busy={busyAction === 'old'}
          accessibilityLabel={`${tr('Código vencido')} · ${title}`}
          testID={`gobierno-live-${ticket.ticket_id}-stale`}
        >
          {busyAction === 'old' ? <ActivityIndicator size="small" color={GRAY} /> : <Ionicons name="hourglass-outline" size={15} color={GRAY} />}
          <Text style={[s.attackText, { color: GRAY }]} numberOfLines={1}>{tr('Código vencido')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

// ── Ledger ───────────────────────────────────────────────────────────────────
function LedgerRow({
  row, lang, titleFor, first,
}: { row: ScanRow; lang: Lang; titleFor: (service: string | null) => string; first: boolean }) {
  const tr = useTr();
  const tone = toneFor(row.verdict);
  const label = (row.verdict === 'VALIDO' || row.verdict === 'DUPLICADO' || row.verdict === 'FALSIFICADO'
    || row.verdict === 'EXPIRADO' || row.verdict === 'RECIBO')
    ? verdictMeta(row.verdict, tr).label
    : row.verdict;
  const service = row.service ? titleFor(row.service) : tr('Código no reconocido');
  return (
    <View style={[s.ledgerRow, !first && s.rowDivider]} testID={`gobierno-ledger-${row.verdict.toLowerCase()}`}>
      <View style={[s.ledgerChip, { backgroundColor: tone.bg, borderColor: tone.border }]}>
        <Text style={[s.ledgerChipText, { color: tone.color }]} numberOfLines={1}>{label}</Text>
      </View>
      <View style={s.ledgerBody}>
        <Text style={s.ledgerService} numberOfLines={2}>{service}</Text>
        {!!row.merchant_es && <Text style={s.ledgerMerchant} numberOfLines={1}>{row.merchant_es}</Text>}
      </View>
      <View style={s.ledgerRight}>
        {row.amount_cop !== null && <Text style={s.ledgerAmount}>{formatCop(row.amount_cop, lang)}</Text>}
        <Text style={s.ledgerTime}>{formatBogota(row.at, true)}</Text>
        {!!row.gate && <Text style={s.ledgerGate} numberOfLines={1}>{row.gate}</Text>}
      </View>
    </View>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────
export default function GobiernoValidadorScreen() {
  const tr = useTr();
  const { lang } = useLang();
  const router = useRouter();
  const { ready, token } = useCivicSession();

  const [gate, setGate] = useState<string>(() => tr('Puesto 1'));
  const [wire, setWire] = useState('');
  const [wireHint, setWireHint] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<unknown>(null);
  const [scanSeq, setScanSeq] = useState(0);
  const [live, setLive] = useState<CivicTicket[] | null>(null);
  const [liveError, setLiveError] = useState<unknown>(null);
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [sumError, setSumError] = useState<unknown>(null);
  const [catalog, setCatalog] = useState<ServicesPayload | null>(null);
  const [firstLoad, setFirstLoad] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const alive = useRef(true);
  const busyLock = useRef(false);
  const gateRef = useRef(gate);
  const scrollRef = useRef<ScrollView>(null);
  const pendingScroll = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const loadLive = useCallback(async () => {
    if (!token) return;
    try {
      const list = await getLiveTickets(token);
      if (alive.current) {
        setLive(list);
        setLiveError(null);
      }
    } catch (e) {
      console.error('[GobiernoValidador] live tickets', e);
      if (alive.current) setLiveError(e);
    }
  }, [token]);

  const loadSummary = useCallback(async () => {
    if (!token) return;
    try {
      const payload = await getSummary(token);
      if (alive.current) {
        setSummary(payload);
        setSumError(null);
      }
    } catch (e) {
      console.error('[GobiernoValidador] summary', e);
      if (alive.current) setSumError(e);
    }
  }, [token]);

  // The catalog only supplies service titles for the ledger; without it rows fall back to the key.
  const loadCatalog = useCallback(async () => {
    if (!token) return;
    try {
      const payload = await getServices(token);
      if (alive.current) setCatalog(payload);
    } catch (e) {
      console.error('[GobiernoValidador] services', e);
    }
  }, [token]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadLive(), loadSummary()]);
  }, [loadLive, loadSummary]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  // Stays mounted under other screens: refresh the list and ledger whenever it regains focus.
  useFocusEffect(useCallback(() => {
    if (!token) return;
    void refreshAll().finally(() => {
      if (alive.current) setFirstLoad(false);
    });
  }, [token, refreshAll]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshAll();
    if (alive.current) setRefreshing(false);
  }, [refreshAll]);

  const runScan = useCallback(async (req: ScanRequest, busyKey: string) => {
    if (!token || busyLock.current) return;
    busyLock.current = true; // a ref: two fast taps must not both pass a state check
    setBusy(busyKey);
    setScanError(null);
    try {
      const r = await scan(token, req);
      if (!alive.current) return;
      setResult(r);
    } catch (e) {
      console.error('[GobiernoValidador] scan', e);
      if (alive.current) {
        setResult(null);
        setScanError(e);
      }
    } finally {
      busyLock.current = false;
      if (alive.current) {
        setBusy(null);
        setScanSeq((n) => n + 1); // a fresh key remounts the verdict card so its layout fires a scroll
        pendingScroll.current = true;
      }
    }
    // A scan changes server state (a ticket flips to used, the ledger grows): reload both lists.
    if (alive.current) void refreshAll();
  }, [token, refreshAll]);

  const gateValue = useCallback(() => gateRef.current.trim() || tr('Puesto 1'), [tr]);
  const onSimulate = useCallback((id: string) => {
    void runScan({ ticket_id: id, simulate: true, gate: gateValue() }, `sim:${id}`);
  }, [runScan, gateValue]);
  const onTamper = useCallback((id: string) => {
    void runScan({ ticket_id: id, simulate: true, tamper: true, gate: gateValue() }, `tam:${id}`);
  }, [runScan, gateValue]);
  const onStale = useCallback((id: string) => {
    void runScan({ ticket_id: id, simulate: true, stale: true, gate: gateValue() }, `old:${id}`);
  }, [runScan, gateValue]);

  const onGateChange = useCallback((v: string) => {
    gateRef.current = v;
    setGate(v);
  }, []);
  const onWireChange = useCallback((v: string) => {
    setWire(v);
    setWireHint(null);
  }, []);
  const clearWire = useCallback(() => {
    setWire('');
    setWireHint(null);
  }, []);
  const submitWire = useCallback(() => {
    const code = wire.trim();
    if (code.length < WIRE_MIN || code.length > WIRE_MAX) {
      setWireHint(tr('Pega el código completo de la boleta.'));
      return;
    }
    setWireHint(null);
    void runScan({ wire: code, gate: gateValue() }, 'wire');
  }, [wire, runScan, gateValue, tr]);

  const onVerdictLayout = useCallback((y: number) => {
    if (!pendingScroll.current) return;
    pendingScroll.current = false;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - SPACING.sm), animated: true });
  }, []);

  const goBack = useCallback(() => goBackOr(router, '/gobierno'), [router]);
  const goServices = useCallback(() => {
    try {
      router.navigate('/gobierno' as NavHref);
    } catch (e) {
      console.error('[GobiernoValidador] navigate', e);
    }
  }, [router]);

  const titleFor = useCallback((service: string | null): string => {
    if (!service) return '';
    const hit = catalog?.services.find((x) => x.key === service);
    return hit ? pickL2(hit.title, lang) : service;
  }, [catalog, lang]);

  // ── All hooks are above this line; the JSX below branches but never returns early. ──
  const needSession = ready && (!token || isAuthError(liveError) || isAuthError(sumError) || isAuthError(scanError));
  const disclaimer = pickL2(catalog?.disclaimer ?? summary?.disclaimer ?? null, lang) || tr(DISCLAIMER_FALLBACK_ES);
  const anyBusy = busy !== null;
  const busyFor = (id: string): 'sim' | 'tam' | 'old' | null => {
    if (busy === `sim:${id}`) return 'sim';
    if (busy === `tam:${id}`) return 'tam';
    if (busy === `old:${id}`) return 'old';
    return null;
  };

  let body: React.ReactNode;
  if (!ready) {
    body = (
      <View style={s.skeletons} testID="gobierno-validador-skeleton">
        <Skeleton height={76} borderRadius={RADIUS.xl} />
        <Skeleton height={170} borderRadius={RADIUS.xl} style={s.skelGap} />
        <Skeleton height={170} borderRadius={RADIUS.xl} style={s.skelGap} />
      </View>
    );
  } else if (needSession) {
    body = (
      <StateCard
        icon="lock-closed-outline"
        title={tr('Sesión requerida')}
        text={tr('Esta demostración es solo para el Distrito. Ingresa con el código de acceso de la demostración.')}
        actionLabel={tr('Volver')}
        onAction={goBack}
        testID="gobierno-validador-session-required"
      />
    );
  } else {
    body = (
      <>
        <View style={s.card} testID="gobierno-validador-gate-card">
          <Text style={s.fieldLabel}>{tr('Punto de control')}</Text>
          <TextInput
            style={s.input}
            value={gate}
            onChangeText={onGateChange}
            maxLength={GATE_MAX}
            placeholder={tr('Puesto 1')}
            placeholderTextColor={COLORS.textFaint}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            accessibilityLabel={tr('Punto de control')}
            testID="gobierno-validador-gate"
          />
        </View>

        {(result !== null || scanError !== null) && (
          <View
            key={scanSeq}
            onLayout={(e) => onVerdictLayout(e.nativeEvent.layout.y)}
            style={s.verdictWrap}
            testID="gobierno-validador-result"
          >
            {result !== null ? (
              <VerdictCard result={result} lang={lang} />
            ) : (
              <View style={s.errorBox} accessibilityRole="alert" testID="gobierno-validador-scan-error">
                <Ionicons name="alert-circle" size={18} color={COLORS.coral} style={s.errorIcon} />
                <Text style={s.errorText}>{civicErrorMessage(scanError, lang, tr)}</Text>
              </View>
            )}
          </View>
        )}

        <View style={s.section} testID="gobierno-validador-live">
          <View style={s.sectionHead}>
            <Ionicons name="ticket-outline" size={16} color={COLORS.icon} />
            <Text style={s.sectionTitle} accessibilityRole="header">{tr('Boletas vivas')}</Text>
            {live !== null && <View style={s.countPill}><Text style={s.countText}>{live.length}</Text></View>}
            <TouchableOpacity
              style={s.iconBtn}
              onPress={onRefresh}
              disabled={refreshing}
              accessibilityRole="button"
              accessibilityLabel={tr('Actualizar')}
              testID="gobierno-validador-refresh"
            >
              {refreshing ? <ActivityIndicator size="small" color={COLORS.icon} /> : <Ionicons name="refresh" size={20} color={COLORS.icon} />}
            </TouchableOpacity>
          </View>

          {live === null && liveError === null && firstLoad ? (
            <View>
              <Skeleton height={150} borderRadius={RADIUS.xl} />
              <Skeleton height={150} borderRadius={RADIUS.xl} style={s.skelGap} />
            </View>
          ) : liveError !== null && live === null ? (
            <StateCard
              icon="cloud-offline-outline"
              title={tr('No pudimos cargar las boletas')}
              text={civicErrorMessage(liveError, lang, tr, tr('La demostración no está disponible en este momento.'))}
              actionLabel={tr('Reintentar')}
              onAction={onRefresh}
              testID="gobierno-validador-live-error"
            />
          ) : live !== null && live.length === 0 ? (
            <View style={s.emptyCard} testID="gobierno-validador-live-empty">
              <Text style={s.emptyTitle}>{tr('No hay boletas vivas.')}</Text>
              <Text style={s.emptyText}>{tr('Emite una desde un servicio de pago de la demo y aparecerá aquí.')}</Text>
              <TouchableOpacity style={s.linkBtn} onPress={goServices} accessibilityRole="link" accessibilityLabel={tr('Ir a los servicios')}>
                <Text style={s.linkLabel}>{tr('Ir a los servicios')}</Text>
                <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={s.liveList}>
              {(live ?? []).map((t) => (
                <LiveRow
                  key={t.ticket_id}
                  ticket={t}
                  lang={lang}
                  busyAction={busyFor(t.ticket_id)}
                  anyBusy={anyBusy}
                  onSimulate={onSimulate}
                  onTamper={onTamper}
                  onStale={onStale}
                />
              ))}
            </View>
          )}
        </View>

        <View style={s.card} testID="gobierno-validador-paste">
          <TouchableOpacity
            style={s.pasteToggle}
            onPress={() => setPasteOpen((v) => !v)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityState={{ expanded: pasteOpen }}
            aria-expanded={pasteOpen}
            accessibilityLabel={tr('Pegar código')}
            testID="gobierno-validador-paste-toggle"
          >
            <Ionicons name="clipboard-outline" size={18} color={COLORS.icon} />
            <Text style={s.pasteTitle}>{tr('Pegar código')}</Text>
            <Ionicons name={pasteOpen ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
          {pasteOpen && (
            <View style={s.pasteBody}>
              <Text style={s.small}>{tr('Pega el código de la boleta. Vence en 20 s como máximo: pégalo enseguida.')}</Text>
              <View style={s.inputRow}>
                <TextInput
                  style={[s.input, s.wireInput]}
                  value={wire}
                  onChangeText={onWireChange}
                  maxLength={WIRE_MAX}
                  placeholder={tr('Código de la boleta')}
                  placeholderTextColor={COLORS.textFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  returnKeyType="go"
                  onSubmitEditing={submitWire}
                  accessibilityLabel={tr('Código de la boleta')}
                  testID="gobierno-validador-wire"
                />
                {wire.length > 0 && (
                  <TouchableOpacity style={s.clearBtn} onPress={clearWire} accessibilityRole="button" accessibilityLabel={tr('Borrar')}>
                    <Ionicons name="close-circle" size={20} color={COLORS.iconMuted} />
                  </TouchableOpacity>
                )}
              </View>
              {wireHint !== null && <Text style={s.hint} testID="gobierno-validador-wire-hint">{wireHint}</Text>}
              <TouchableOpacity
                style={[s.validateBtn, (anyBusy || wire.trim().length === 0) && s.btnOff]}
                onPress={submitWire}
                disabled={anyBusy || wire.trim().length === 0}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityState={{ disabled: anyBusy || wire.trim().length === 0, busy: busy === 'wire' }}
                aria-disabled={anyBusy || wire.trim().length === 0}
                aria-busy={busy === 'wire'}
                accessibilityLabel={tr('Validar')}
                testID="gobierno-validador-validate"
              >
                {busy === 'wire' ? <ActivityIndicator size="small" color={COLORS.black} /> : null}
                <Text style={s.validateText}>{tr('Validar')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={s.section} testID="gobierno-validador-ledger">
          <View style={s.sectionHead}>
            <Ionicons name="list-outline" size={16} color={COLORS.icon} />
            <Text style={s.sectionTitle} accessibilityRole="header">{tr('Actividad del validador')}</Text>
          </View>

          <View style={s.totals} testID="gobierno-validador-totals">
            <View style={s.stat}>
              <Text style={s.statValue} testID="gobierno-validador-collected">
                {summary !== null ? formatCop(summary.collected_cop, lang) : '—'}
              </Text>
              <Text style={s.statLabel}>{tr('Recaudo simulado')}</Text>
            </View>
            <View style={s.statDivider} />
            <View style={s.statSmall}>
              <Text style={s.statValue}>{summary !== null ? String(summary.issued_n) : '—'}</Text>
              <Text style={s.statLabel}>{tr('Emitidas')}</Text>
            </View>
            <View style={s.statDivider} />
            <View style={s.statSmall}>
              <Text style={s.statValue}>{summary !== null ? String(summary.used_n) : '—'}</Text>
              <Text style={s.statLabel}>{tr('Usadas')}</Text>
            </View>
          </View>

          {sumError !== null && (
            <TouchableOpacity style={s.inlineRetry} onPress={onRefresh} accessibilityRole="button" accessibilityLabel={tr('Reintentar')}>
              <Ionicons name="refresh" size={14} color={COLORS.coral} />
              <Text style={s.inlineRetryText}>{tr('No pudimos actualizar la actividad.')} {tr('Reintentar')}</Text>
            </TouchableOpacity>
          )}

          <Text style={s.small}>{tr('Hora de Cartagena')}</Text>
          {summary !== null && summary.scans.length > 0 ? (
            <View style={s.ledger}>
              {summary.scans.map((r, i) => (
                <LedgerRow key={`${r.at ?? 'x'}-${r.ticket_id ?? 'none'}-${i}`} row={r} lang={lang} titleFor={titleFor} first={i === 0} />
              ))}
            </View>
          ) : summary !== null ? (
            <Text style={s.emptyText} testID="gobierno-validador-ledger-empty">{tr('Aún no hay escaneos.')}</Text>
          ) : null}
        </View>
      </>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="gobierno-validador-screen">
      <Head>
        <title>{`${tr('Validador')} · AMO Life`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <DemoHeader onBack={goBack} label={tr('Pagos ciudadanos')} />
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        >
          <View style={s.content}>
            <View style={s.hero}>
              <Text style={s.title} accessibilityRole="header">{tr('Validador')}</Text>
              <Text style={s.subtitle}>{tr('Punto de control de la demostración')}</Text>
            </View>
            {body}
            <DisclaimerNote text={disclaimer} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },

  // header (pinned: the DEMO chip never scrolls away)
  headerBar: { borderBottomWidth: 1, borderBottomColor: COLORS.hairline, backgroundColor: COLORS.background },
  headerInner: { width: '100%', maxWidth: 560, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm + 4 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.hairline, alignItems: 'center', justifyContent: 'center' },
  headerLabel: { flex: 1, fontSize: 14, color: COLORS.textMuted, ...FONTS.semibold },
  demoChip: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 28, backgroundColor: 'rgba(245,158,11,0.14)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.55)', borderRadius: RADIUS.full, paddingHorizontal: 11, paddingVertical: 4 },
  demoChipText: { fontSize: 11.5, color: DEMO_AMBER, ...FONTS.bold, letterSpacing: 1.4 },

  // hero
  hero: { paddingTop: SPACING.lg, paddingBottom: SPACING.xs, gap: 6 },
  title: { fontSize: 32, lineHeight: 38, color: COLORS.textMain, ...FONTS.bold, letterSpacing: -0.6 },
  subtitle: { ...TYPE.body, color: COLORS.textMuted },

  // cards + sections
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, marginTop: SPACING.md },
  section: { marginTop: SPACING.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: SPACING.sm },
  sectionTitle: { ...TYPE.title3, color: COLORS.textMain, flex: 1 },
  countPill: { backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.full, paddingHorizontal: 9, paddingVertical: 3, minWidth: 24, alignItems: 'center' },
  countText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.bold },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  small: { fontSize: 11, lineHeight: 15, color: COLORS.textFaint, ...FONTS.medium },
  rowDivider: { borderTopWidth: 1, borderTopColor: COLORS.hairline },
  btnOff: { opacity: 0.45 },

  // inputs
  fieldLabel: { ...TYPE.overline, color: COLORS.textFaint, textTransform: 'uppercase', marginBottom: SPACING.sm },
  input: { minHeight: 48, borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: SPACING.md, fontSize: 15, color: COLORS.textMain, ...FONTS.medium },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  wireInput: { flex: 1, paddingRight: 44, fontFamily: MONO, fontSize: 13 },
  clearBtn: { position: 'absolute', right: 0, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 12.5, lineHeight: 17, color: COLORS.coral, ...FONTS.medium },

  // verdict
  verdictWrap: { marginTop: SPACING.md },
  verdict: { borderRadius: RADIUS.xl, borderWidth: 1.5, padding: SPACING.md, gap: SPACING.sm + 4 },
  verdictHead: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  verdictHeadText: { flex: 1, gap: 2 },
  verdictLabel: { fontSize: 26, lineHeight: 32, ...FONTS.bold, letterSpacing: 1 },
  verdictText: { fontSize: 13.5, lineHeight: 19, color: COLORS.textMain, ...FONTS.medium },
  firstUse: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  firstUseText: { flex: 1, fontSize: 13, color: COLORS.textMain, ...FONTS.semibold, fontVariant: ['tabular-nums'] },
  ticketPanel: { gap: 4, padding: SPACING.md, borderRadius: RADIUS.lg, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  panelHead: { ...TYPE.overline, color: COLORS.textFaint, textTransform: 'uppercase' },
  panelTitle: { fontSize: 15, lineHeight: 20, color: COLORS.textMain, ...FONTS.bold },
  panelMerchant: { fontSize: 12.5, lineHeight: 18, color: COLORS.textMuted, ...FONTS.medium },
  panelAmountRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  panelAmount: { fontSize: 22, lineHeight: 28, color: COLORS.textMain, ...FONTS.bold, fontVariant: ['tabular-nums'] },
  verifyChip: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2, borderColor: `${COLORS.coral}8C`, backgroundColor: `${COLORS.coral}1A` },
  verifyChipText: { flexShrink: 1, fontSize: 10.5, color: COLORS.coral, ...FONTS.bold, letterSpacing: 0.2 },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: 'rgba(255,107,74,0.10)', borderWidth: 1, borderColor: 'rgba(255,107,74,0.40)' },
  errorIcon: { marginTop: 1 },
  errorText: { flex: 1, fontSize: 13, lineHeight: 18, color: COLORS.textMain, ...FONTS.medium },

  // live tickets
  liveList: { gap: SPACING.sm + 2 },
  liveRow: { backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, gap: 6 },
  liveTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  liveTitle: { flex: 1, fontSize: 15, lineHeight: 20, color: COLORS.textMain, ...FONTS.bold },
  kindChip: { borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2, borderColor: 'rgba(18,181,165,0.40)', backgroundColor: 'rgba(18,181,165,0.10)' },
  kindChipText: { fontSize: 10.5, color: COLORS.primary, ...FONTS.bold, letterSpacing: 0.3 },
  liveMerchant: { fontSize: 12, lineHeight: 17, color: COLORS.textMuted, ...FONTS.regular },
  liveMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  liveAmount: { fontSize: 17, color: COLORS.primary, ...FONTS.bold, fontVariant: ['tabular-nums'] },
  liveId: { fontSize: 10.5, color: COLORS.textFaint, fontFamily: MONO },
  simBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, marginTop: SPACING.xs, backgroundColor: COLORS.primary, borderRadius: RADIUS.full },
  simBtnText: { fontSize: 14.5, color: COLORS.black, ...FONTS.bold },
  attackRow: { flexDirection: 'row', gap: 8 },
  attackBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8 },
  attackTamper: { borderColor: 'rgba(239,68,68,0.50)', backgroundColor: 'rgba(239,68,68,0.08)' },
  attackStale: { borderColor: 'rgba(154,163,178,0.45)', backgroundColor: 'rgba(154,163,178,0.08)' },
  attackText: { flexShrink: 1, fontSize: 12.5, ...FONTS.semibold },
  emptyCard: { alignItems: 'center', gap: 6, padding: SPACING.lg, borderRadius: RADIUS.xl, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.border, backgroundColor: COLORS.surface },
  emptyTitle: { ...TYPE.headline, color: COLORS.textMain, textAlign: 'center' },
  emptyText: { fontSize: 12.5, lineHeight: 18, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center' },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, marginTop: SPACING.xs, paddingHorizontal: SPACING.md },
  linkLabel: { fontSize: 13.5, color: COLORS.official, ...FONTS.semibold },

  // paste
  pasteToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  pasteTitle: { ...TYPE.headline, color: COLORS.textMain, flex: 1 },
  pasteBody: { gap: SPACING.sm + 2, marginTop: SPACING.sm },
  validateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, backgroundColor: COLORS.primary, borderRadius: RADIUS.full },
  validateText: { fontSize: 14.5, color: COLORS.black, ...FONTS.bold },

  // ledger
  totals: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm + 4, paddingHorizontal: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  stat: { flex: 1.6, alignItems: 'center', gap: 2 },
  statSmall: { flex: 1, alignItems: 'center', gap: 2 },
  statDivider: { width: 1, height: 30, backgroundColor: COLORS.hairline },
  statValue: { fontSize: 16, lineHeight: 21, color: COLORS.textMain, ...FONTS.bold, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 10.5, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center' },
  inlineRetry: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  inlineRetryText: { flex: 1, fontSize: 12.5, lineHeight: 17, color: COLORS.coral, ...FONTS.semibold },
  ledger: { marginTop: SPACING.xs, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: SPACING.md },
  ledgerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 11 },
  ledgerChip: { width: 92, alignItems: 'center', borderWidth: 1, borderRadius: RADIUS.full, paddingVertical: 3, paddingHorizontal: 4 },
  ledgerChipText: { fontSize: 10, ...FONTS.bold, letterSpacing: 0.3 },
  ledgerBody: { flex: 1, gap: 2 },
  ledgerService: { fontSize: 12.5, lineHeight: 17, color: COLORS.textMain, ...FONTS.semibold },
  ledgerMerchant: { fontSize: 11, lineHeight: 15, color: COLORS.textFaint, ...FONTS.regular },
  ledgerRight: { alignItems: 'flex-end', gap: 1, maxWidth: 104 },
  ledgerAmount: { fontSize: 12.5, color: COLORS.textMain, ...FONTS.bold, fontVariant: ['tabular-nums'] },
  ledgerTime: { fontSize: 10.5, color: COLORS.textMuted, ...FONTS.medium, fontVariant: ['tabular-nums'] },
  ledgerGate: { fontSize: 10.5, color: COLORS.textFaint, ...FONTS.medium },

  // states
  skeletons: { marginTop: SPACING.lg },
  skelGap: { marginTop: SPACING.md },
  stateCard: { alignItems: 'center', gap: 10, marginTop: SPACING.lg, padding: SPACING.lg, borderRadius: RADIUS.xl, backgroundColor: COLORS.surface, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.border },
  stateTitle: { ...TYPE.title3, color: COLORS.textMain, textAlign: 'center' },
  stateText: { ...TYPE.subhead, color: COLORS.textMuted, textAlign: 'center' },
  primaryBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, paddingHorizontal: SPACING.xl, paddingVertical: 12, borderRadius: RADIUS.full, marginTop: SPACING.xs },
  primaryBtnText: { fontSize: 14, color: COLORS.black, ...FONTS.bold },

  // disclaimer footer
  disclaimer: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: SPACING.xl, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(245,158,11,0.35)', backgroundColor: 'rgba(245,158,11,0.06)' },
  disclaimerIcon: { marginTop: 1 },
  disclaimerText: { flex: 1, fontSize: 12, lineHeight: 17, color: COLORS.textMuted, ...FONTS.medium },
});
