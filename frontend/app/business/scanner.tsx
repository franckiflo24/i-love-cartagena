// /business/scanner — the venue-side TICKET SCANNER: the PALCO gate for the business portal.
//
// The site ships Permissions-Policy: camera=(), so there is no camera scanner. The primary interaction is
// the live guest list of the selected event: each guest offers "Simular escaneo" (the SERVER derives the
// current wire and runs the same verdict pipeline as a real scan) plus, collapsed under "Probar ataques",
// two attack demos — "Código adulterado" (bad token → FALSIFICADO) and "Código vencido" (stale step →
// EXPIRADO). Pasting a wire stays available as a secondary path (and is the way to scan a City Pass, which
// belongs to no event). Verdicts: VÁLIDO / DUPLICADO / FALSIFICADO / EXPIRADO, and PASE for a City Pass —
// a multi-scan perks credential: it proves the pass is genuine and active, it never "admits" and is never
// DUPLICADO. The guest panel rides every resolvable scan (the PALCO guest-on-scan moment): the name, huge.
//
// Honesty: a simulated scan of an issued ticket REALLY admits it (the server flips it to "used"), and the
// list says so; a FALSIFICADO that still names a ticket labels that panel as untrusted (it is what the
// forged code CLAIMS to be) and does not get the huge name; an EXPIRADO that carries a plan is an inactive
// City Pass, not a stale code; a scan whose outcome is unknown (no answer from the server) tells the
// operator to check the list before retrying, because the ticket may already be admitted; a guest list the
// server capped says "Lista parcial" instead of passing a slice off as the whole list.
//
// Hydration rule (React #418): the first render is static chrome + skeletons; nothing data-, storage- or
// clock-derived renders before the mount effect runs (`mounted`, `today`, the persisted gate name). Times
// shown are formatted from server timestamps with fixed-offset arithmetic.
import React, {
  useCallback, useEffect, useRef, useState,
} from 'react';
import type { ComponentProps } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import type { Router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Head from '../../src/components/WebHead';
import { Skeleton } from '../../src/components/Skeleton';
import CameraScanner from '../../src/components/tickets/CameraScanner';
import {
  DEFAULT_GATE, SCAN_GATE_MAX, SCAN_WIRE_MAX, SCAN_WIRE_MIN, fetchEvents, fetchGuestList, fetchScanFeed,
  formatEventDate, formatGateTime, formatStartTime, isForbiddenError, isOutcomeUnknown, isSessionError,
  planName, scannerErrorMessage, submitScan,
} from '../../src/components/tickets/scannerApi';
import type {
  FeedScan, GuestTicket, ScanRequest, ScanResult, ScannerEvent, Translate,
} from '../../src/components/tickets/scannerApi';
import { COLORS, FONTS, RADIUS, SPACING, TYPE } from '../../src/constants/theme';
import { useBusinessAuth } from '../../src/context/BusinessAuthContext';
import { useLang } from '../../src/context/LanguageContext';
import type { Lang } from '../../src/i18n/translations';
import { useTr } from '../../src/i18n/autoTr';
import { bogotaToday } from '../../src/lib/eventTime';
import { hapticError, hapticSuccess } from '../../src/lib/haptics';
import { goBackOr } from '../../src/lib/nav';

type NavHref = Parameters<Router['push']>[0];
type IconName = ComponentProps<typeof Ionicons>['name'];

/** AsyncStorage key of the operator's gate name (a device-level preference, survives sign-out). */
const GATE_KEY = '@amo_gate_name';
/** Guests rendered per page: a 200-guest list never mounts 600 touchables at once. */
const GUEST_PAGE = 30;
const AMBER = '#F5A623';
const GRAY = '#9AA3B2';
const RED = '#F87171';
const MONO = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
});

interface Tone { color: string; bg: string; border: string }
const TEAL: Tone = { color: COLORS.primary, bg: 'rgba(18,181,165,0.12)', border: 'rgba(18,181,165,0.55)' };
const AMBER_TONE: Tone = { color: AMBER, bg: 'rgba(245,166,35,0.12)', border: 'rgba(245,166,35,0.55)' };
const RED_TONE: Tone = { color: RED, bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.55)' };
const GRAY_TONE: Tone = { color: GRAY, bg: 'rgba(154,163,178,0.10)', border: 'rgba(154,163,178,0.45)' };

/** Colors for ANY verdict string (the feed may carry one this client does not know: neutral). */
function toneFor(verdict: string): Tone {
  switch (verdict) {
    case 'VALIDO':
    case 'PASE': return TEAL;
    case 'DUPLICADO': return AMBER_TONE;
    case 'FALSIFICADO': return RED_TONE;
    default: return GRAY_TONE;
  }
}

/** Label for ANY verdict string; an unknown one is shown as the server wrote it. */
function verdictLabel(verdict: string, tr: Translate): string {
  switch (verdict) {
    case 'VALIDO': return tr('VÁLIDO');
    case 'PASE': return tr('PASE');
    case 'DUPLICADO': return tr('DUPLICADO');
    case 'FALSIFICADO': return tr('FALSIFICADO');
    case 'EXPIRADO': return tr('EXPIRADO');
    case 'FUERA_DE_ALCANCE': return tr('FUERA DE ALCANCE');
    case 'REVOCADO': return tr('REVOCADO');
    case 'TRANSFERIDO': return tr('TRANSFERIDO');
    case 'EVENTO_CANCELADO': return tr('EVENTO CANCELADO');
    case 'EVENTO_VENCIDO': return tr('EVENTO TERMINADO');
    default: return verdict;
  }
}

interface VerdictMeta extends Tone { icon: IconName; label: string; text: string }
function verdictMeta(result: ScanResult, tr: Translate): VerdictMeta {
  const label = verdictLabel(result.verdict, tr);
  switch (result.verdict) {
    case 'VALIDO':
      return { ...TEAL, icon: 'checkmark-circle', label, text: tr('Entrada válida. Acceso registrado.') };
    case 'PASE':
      return { ...TEAL, icon: 'ribbon', label, text: tr('City Pass vigente. Se puede escanear varias veces.') };
    case 'DUPLICADO':
      return { ...AMBER_TONE, icon: 'copy-outline', label, text: tr('Esta entrada ya fue usada.') };
    case 'FALSIFICADO':
      return { ...RED_TONE, icon: 'close-circle', label, text: tr('Código no auténtico: la firma no coincide o la entrada no existe.') };
    case 'EXPIRADO':
      return {
        ...GRAY_TONE,
        icon: 'time-outline',
        label,
        // A plan means the credential is a City Pass the server found inactive; no plan = a stale rotating code.
        text: result.guest?.plan_id
          ? tr('El City Pass ya no está vigente.')
          : tr('Código auténtico, pero ya venció: rota cada 10 s. Pide al invitado que lo actualice.'),
      };
    case 'FUERA_DE_ALCANCE':
      return { ...AMBER_TONE, icon: 'alert-circle', label, text: tr('Credencial auténtica, pero de otro alcance: este validador no puede admitirla.') };
    case 'REVOCADO':
      return { ...RED_TONE, icon: 'ban', label, text: tr('Credencial revocada por el emisor. No admite acceso.') };
    case 'TRANSFERIDO':
      return { ...GRAY_TONE, icon: 'swap-horizontal', label, text: tr('Credencial transferida: la vigente es la del nuevo titular.') };
    case 'EVENTO_CANCELADO':
      return { ...RED_TONE, icon: 'close-circle', label, text: tr('Entrada auténtica, pero el evento fue cancelado. No admite acceso.') };
    case 'EVENTO_VENCIDO':
      return { ...GRAY_TONE, icon: 'time-outline', label, text: tr('Entrada auténtica, pero el evento ya terminó.') };
  }
}

/** "{n} reservas" style templates: one translatable key per sentence, never fragment concatenation. */
function fmt(template: string, vars: Record<string, string | number>): string {
  let out = template;
  for (const k of Object.keys(vars)) out = out.split(`{${k}}`).join(String(vars[k]));
  return out;
}

// ── Chrome ───────────────────────────────────────────────────────────────────
function StateCard({
  icon, title, text, actionLabel, onAction, busy, testID,
}: {
  icon: IconName; title: string; text: string; actionLabel?: string; onAction?: () => void; busy?: boolean; testID: string;
}) {
  return (
    <View style={s.stateCard} testID={testID} accessibilityRole="alert">
      <Ionicons name={icon} size={30} color={COLORS.textMuted} />
      <Text style={s.stateTitle}>{title}</Text>
      <Text style={s.stateText}>{text}</Text>
      {!!actionLabel && !!onAction && (
        <TouchableOpacity
          style={[s.primaryBtn, busy === true && s.btnOff]}
          onPress={onAction}
          disabled={busy === true}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy === true, busy: busy === true }}
          aria-disabled={busy === true}
          aria-busy={busy === true}
          accessibilityLabel={actionLabel}
          testID={`${testID}-action`}
        >
          {busy === true ? <ActivityIndicator size="small" color={COLORS.black} /> : null}
          <Text style={s.primaryBtnText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Verdict ──────────────────────────────────────────────────────────────────
function VerdictCard({ result }: { result: ScanResult }) {
  const tr = useTr();
  const meta = verdictMeta(result, tr);
  const g = result.guest;
  const forged = result.verdict === 'FALSIFICADO';
  const isPass = g !== null && (g.plan_id !== null || result.verdict === 'PASE');
  const name = g !== null ? (g.name.trim() || tr('Sin nombre')) : '';
  const whenParts: string[] = [];
  if (g !== null && !isPass) {
    if (g.event_date) whenParts.push(formatEventDate(g.event_date, true));
    if (g.venue_name) whenParts.push(g.venue_name);
  }
  return (
    <View
      style={[s.verdict, { backgroundColor: meta.bg, borderColor: meta.border }]}
      accessibilityLiveRegion="polite"
      testID="scanner-verdict"
    >
      <View style={s.verdictHead}>
        <Ionicons name={meta.icon} size={44} color={meta.color} />
        <View style={s.verdictHeadText}>
          <Text style={[s.verdictLabel, { color: meta.color }]} testID="scanner-verdict-label">{meta.label}</Text>
          <Text style={s.verdictText}>{meta.text}</Text>
        </View>
      </View>

      {result.verdict === 'DUPLICADO' && (
        <View style={s.firstUse} testID="scanner-first-use">
          <Ionicons name="time-outline" size={14} color={COLORS.textMuted} />
          <Text style={s.firstUseText}>
            {tr('Primer uso')}: {formatGateTime(result.first_used_at, true)}
            {result.first_gate ? ` · ${result.first_gate}` : ''}
          </Text>
        </View>
      )}

      {g !== null && (
        <View style={s.guestPanel} testID="scanner-guest">
          <Text style={s.panelHead}>
            {forged ? tr('El código dice ser') : isPass ? tr('Titular') : tr('Invitado')}
          </Text>
          <Text style={forged ? s.guestNameForged : s.guestName} testID="scanner-guest-name">{name}</Text>
          {!!g.ticket_title && <Text style={s.panelTitle}>{g.ticket_title}</Text>}
          {isPass ? (
            <View style={s.panelMetaRow}>
              <View style={s.planChip} testID="scanner-plan">
                <Ionicons name="ribbon-outline" size={12} color={COLORS.primary} />
                <Text style={s.planChipText}>{planName(g.plan_id)}</Text>
              </View>
              {!!g.event_date && (
                <Text style={s.panelMeta}>
                  {result.verdict === 'EXPIRADO' ? tr('Venció') : tr('Vence')} {formatEventDate(g.event_date, true)}
                </Text>
              )}
            </View>
          ) : whenParts.length > 0 ? (
            <Text style={s.panelMeta}>{whenParts.join(' · ')}</Text>
          ) : null}
          {forged && (
            <Text style={s.small}>
              {tr('Estos datos son los de la entrada que el código dice ser; no son de confianza.')}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

function ScanErrorBox({ error, lang }: { error: unknown; lang: Lang }) {
  const tr = useTr();
  // 403 on a scan: the ticket exists but belongs to another venue's event.
  const text = isForbiddenError(error) ? tr('Esta entrada es de otro negocio') : scannerErrorMessage(error, lang, tr);
  return (
    <View style={s.errorBox} accessibilityRole="alert" testID="scanner-scan-error">
      <Ionicons name="alert-circle" size={18} color={COLORS.coral} style={s.errorIcon} />
      <View style={s.errorBody}>
        <Text style={s.errorText}>{text}</Text>
        {isOutcomeUnknown(error) && (
          <Text style={s.errorHint} testID="scanner-scan-unknown">
            {tr('Revisa la lista de invitados antes de reintentar: la entrada pudo quedar registrada.')}
          </Text>
        )}
      </View>
    </View>
  );
}

// ── Guest list ───────────────────────────────────────────────────────────────
interface GuestRowProps {
  guest: GuestTicket;
  /** Which action of THIS row is in flight, if any. */
  busyAction: 'sim' | 'tam' | 'old' | null;
  anyBusy: boolean;
  onSimulate: (id: string) => void;
  onTamper: (id: string) => void;
  onStale: (id: string) => void;
}

const GuestRow = React.memo(function GuestRow({
  guest, busyAction, anyBusy, onSimulate, onTamper, onStale,
}: GuestRowProps) {
  const tr = useTr();
  const [attacksOpen, setAttacksOpen] = useState(false);
  const name = guest.holder_name.trim() || tr('Sin nombre');
  const used = guest.status === 'used';
  const tone = used ? TEAL : GRAY_TONE;
  const statusText = used ? tr('Ingresó') : guest.status === 'issued' ? tr('Pendiente') : tr('Sin estado');
  const usedLine = used
    ? `${formatGateTime(guest.used_at)}${guest.used_gate ? ` · ${guest.used_gate}` : ''}`
    : '';
  return (
    <View style={s.guestRow} testID={`scanner-guest-${guest.ticket_id}`}>
      <View style={s.guestTop}>
        <Text style={s.guestRowName} numberOfLines={2}>{name}</Text>
        <View style={[s.statusChip, { backgroundColor: tone.bg, borderColor: tone.border }]}>
          <Text style={[s.statusChipText, { color: tone.color }]} numberOfLines={1}>{statusText}</Text>
        </View>
      </View>
      <Text style={s.guestMeta} numberOfLines={1}>
        {guest.ticket_id}{usedLine ? ` · ${usedLine}` : ''}
      </Text>

      <TouchableOpacity
        style={[s.simBtn, anyBusy && s.btnOff]}
        onPress={() => onSimulate(guest.ticket_id)}
        disabled={anyBusy}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityState={{ disabled: anyBusy, busy: busyAction === 'sim' }}
        aria-disabled={anyBusy}
        aria-busy={busyAction === 'sim'}
        accessibilityLabel={`${tr('Simular escaneo')} · ${name}`}
        testID={`scanner-guest-${guest.ticket_id}-simulate`}
      >
        {busyAction === 'sim' ? <ActivityIndicator size="small" color={COLORS.black} /> : <Ionicons name="scan-outline" size={18} color={COLORS.black} />}
        <Text style={s.simBtnText}>{tr('Simular escaneo')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={s.attackToggle}
        onPress={() => setAttacksOpen((v) => !v)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityState={{ expanded: attacksOpen }}
        aria-expanded={attacksOpen}
        accessibilityLabel={`${tr('Probar ataques')} · ${name}`}
        testID={`scanner-guest-${guest.ticket_id}-attacks-toggle`}
      >
        <Ionicons name="shield-half-outline" size={15} color={COLORS.textMuted} />
        <Text style={s.attackToggleText}>{tr('Probar ataques')}</Text>
        <Ionicons name={attacksOpen ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textMuted} />
      </TouchableOpacity>

      {attacksOpen && (
        <View style={s.attackRow}>
          <TouchableOpacity
            style={[s.attackBtn, s.attackTamper, anyBusy && s.btnOff]}
            onPress={() => onTamper(guest.ticket_id)}
            disabled={anyBusy}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityState={{ disabled: anyBusy, busy: busyAction === 'tam' }}
            aria-disabled={anyBusy}
            aria-busy={busyAction === 'tam'}
            accessibilityLabel={`${tr('Código adulterado')} · ${name}`}
            testID={`scanner-guest-${guest.ticket_id}-tamper`}
          >
            {busyAction === 'tam' ? <ActivityIndicator size="small" color={RED} /> : <Ionicons name="warning-outline" size={15} color={RED} />}
            <Text style={[s.attackText, { color: RED }]} numberOfLines={2}>{tr('Código adulterado')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.attackBtn, s.attackStale, anyBusy && s.btnOff]}
            onPress={() => onStale(guest.ticket_id)}
            disabled={anyBusy}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityState={{ disabled: anyBusy, busy: busyAction === 'old' }}
            aria-disabled={anyBusy}
            aria-busy={busyAction === 'old'}
            accessibilityLabel={`${tr('Código vencido')} · ${name}`}
            testID={`scanner-guest-${guest.ticket_id}-stale`}
          >
            {busyAction === 'old' ? <ActivityIndicator size="small" color={GRAY} /> : <Ionicons name="hourglass-outline" size={15} color={GRAY} />}
            <Text style={[s.attackText, { color: GRAY }]} numberOfLines={2}>{tr('Código vencido')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
});

// ── Feed ─────────────────────────────────────────────────────────────────────
function FeedRow({ row, first }: { row: FeedScan; first: boolean }) {
  const tr = useTr();
  const tone = toneFor(row.verdict);
  return (
    <View style={[s.feedRow, !first && s.rowDivider]} testID={`scanner-feed-${row.verdict.toLowerCase()}`}>
      <View style={[s.feedChip, { backgroundColor: tone.bg, borderColor: tone.border }]}>
        <Text style={[s.feedChipText, { color: tone.color }]} numberOfLines={1}>{verdictLabel(row.verdict, tr)}</Text>
      </View>
      <View style={s.feedBody}>
        <Text style={s.feedName} numberOfLines={2}>{row.guest_name || '—'}</Text>
        {!!row.ticket_title && <Text style={s.feedTitle} numberOfLines={1}>{row.ticket_title}</Text>}
      </View>
      <View style={s.feedRight}>
        <Text style={s.feedTime}>{formatGateTime(row.at, true)}</Text>
        {!!row.gate && <Text style={s.feedGate} numberOfLines={1}>{row.gate}</Text>}
      </View>
    </View>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────
export default function BusinessScannerScreen() {
  const tr = useTr();
  const { lang } = useLang();
  const router = useRouter();
  const { token, loading: authLoading, logout } = useBusinessAuth();

  // Hydration-safe seeds: constants the server can also produce. The clock and storage apply after mount.
  const [mounted, setMounted] = useState(false);
  const [today, setToday] = useState<string | null>(null);
  const [gate, setGate] = useState<string>(DEFAULT_GATE);
  const [events, setEvents] = useState<ScannerEvent[] | null>(null);
  const [eventsError, setEventsError] = useState<unknown>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [guests, setGuests] = useState<GuestTicket[] | null>(null);
  const [guestsError, setGuestsError] = useState<unknown>(null);
  const [visible, setVisible] = useState(GUEST_PAGE);
  const [feed, setFeed] = useState<FeedScan[] | null>(null);
  const [feedError, setFeedError] = useState<unknown>(null);
  const [wire, setWire] = useState('');
  const [wireHint, setWireHint] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<unknown>(null);
  const [scanSeq, setScanSeq] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const alive = useRef(true);
  const busyLock = useRef(false);
  const gateRef = useRef<string>(DEFAULT_GATE);
  const gateTouched = useRef(false);
  const selectedRef = useRef<string | null>(null);
  // Latest ISSUED request wins (not latest to arrive): an older answer landing late must never regress the counts.
  const eventsSeq = useRef(0);
  const guestSeq = useRef(0);
  const feedSeq = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const pendingScroll = useRef(false);

  useEffect(() => {
    alive.current = true;
    setMounted(true);
    try {
      setToday(bogotaToday());
    } catch (e) {
      console.error('[BusinessScanner] bogotaToday', e); // no "HOY" tag; everything else works
    }
    return () => {
      alive.current = false;
    };
  }, []);

  // The persisted gate name. Storage is read AFTER mount (never in render); what the operator already
  // typed while this was in flight wins over the stored value.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(GATE_KEY)
      .then((saved) => {
        if (cancelled || gateTouched.current || !saved) return;
        const v = saved.slice(0, SCAN_GATE_MAX);
        gateRef.current = v;
        setGate(v);
      })
      .catch((e: unknown) => console.error('[BusinessScanner] gate load', e));
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = mounted && !authLoading;
  // Nothing calls the API until the business session is restored: a stored token may still be stale.
  const sessionToken = ready ? token : null;

  const loadEvents = useCallback(async (): Promise<ScannerEvent[] | null> => {
    if (!sessionToken) return null;
    const seq = ++eventsSeq.current;
    try {
      const list = await fetchEvents(sessionToken);
      if (!alive.current || seq !== eventsSeq.current) return null; // superseded: the newer request owns the state
      setEvents(list);
      setEventsError(null);
      return list;
    } catch (e) {
      console.error('[BusinessScanner] events', e);
      if (alive.current && seq === eventsSeq.current) setEventsError(e);
      return null;
    }
  }, [sessionToken]);

  // A slow answer for the event the operator already left is dropped too (same rule, per event).
  const loadGuests = useCallback(async (eventId: string) => {
    if (!sessionToken) return;
    const seq = ++guestSeq.current;
    try {
      const list = await fetchGuestList(sessionToken, eventId);
      if (!alive.current || seq !== guestSeq.current) return;
      setGuests(list);
      setGuestsError(null);
    } catch (e) {
      console.error('[BusinessScanner] guest list', e);
      if (alive.current && seq === guestSeq.current) setGuestsError(e);
    }
  }, [sessionToken]);

  const loadFeed = useCallback(async () => {
    if (!sessionToken) return;
    const seq = ++feedSeq.current;
    try {
      const rows = await fetchScanFeed(sessionToken);
      if (!alive.current || seq !== feedSeq.current) return;
      setFeed(rows);
      setFeedError(null);
    } catch (e) {
      console.error('[BusinessScanner] scan feed', e);
      if (alive.current && seq === feedSeq.current) setFeedError(e);
    }
  }, [sessionToken]);

  const applySelection = useCallback((id: string | null) => {
    selectedRef.current = id;
    setSelectedId(id);
  }, []);

  /** Keeps the current event when it is still listed, else the soonest one (the list is sorted by date). */
  const resolveSelection = useCallback((list: ScannerEvent[]): string | null => {
    const cur = selectedRef.current;
    const next = cur !== null && list.some((e) => e.event_id === cur) ? cur : (list[0]?.event_id ?? null);
    if (next !== cur) {
      applySelection(next);
      setGuests(null); // never show one event's guests under another event's name
      setGuestsError(null);
      setVisible(GUEST_PAGE);
    }
    return next;
  }, [applySelection]);

  const refreshAll = useCallback(async () => {
    const eventsTask = (async () => {
      const list = await loadEvents();
      if (!alive.current) return;
      const id = list !== null ? resolveSelection(list) : selectedRef.current;
      if (id !== null) await loadGuests(id);
    })();
    await Promise.all([eventsTask, loadFeed()]);
  }, [loadEvents, loadGuests, loadFeed, resolveSelection]);

  // Stays mounted under other screens: reload whenever it regains focus.
  useFocusEffect(useCallback(() => {
    if (!sessionToken) return;
    void refreshAll();
  }, [sessionToken, refreshAll]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshAll();
    if (alive.current) setRefreshing(false);
  }, [refreshAll]);

  const selectEvent = useCallback((id: string) => {
    if (selectedRef.current === id) return;
    applySelection(id);
    setGuests(null);
    setGuestsError(null);
    setVisible(GUEST_PAGE);
    setResult(null); // the last verdict belongs to the previous event's gate
    setScanError(null);
    void loadGuests(id);
  }, [applySelection, loadGuests]);

  const runScan = useCallback(async (req: ScanRequest, busyKey: string) => {
    if (!sessionToken || busyLock.current) return;
    busyLock.current = true; // a ref: two fast taps must not both pass a state check (the 2nd would read DUPLICADO)
    setBusy(busyKey);
    setScanError(null);
    try {
      const r = await submitScan(sessionToken, req);
      if (!alive.current) return;
      setResult(r);
      if (busyKey === 'wire') setWire(''); // a code is single-use: the box is ready for the next one
      if (r.verdict === 'VALIDO' || r.verdict === 'PASE') hapticSuccess();
      else hapticError();
    } catch (e) {
      console.error('[BusinessScanner] scan', e);
      if (alive.current) {
        setResult(null);
        setScanError(e);
        hapticError();
      }
    } finally {
      busyLock.current = false;
      if (alive.current) {
        setBusy(null);
        setScanSeq((n) => n + 1); // a fresh key remounts the verdict card so its layout fires a scroll
        pendingScroll.current = true;
      }
    }
    // A scan changes server state (a ticket flips to used, the feed grows, the counts move): reload them.
    if (alive.current) void refreshAll();
  }, [sessionToken, refreshAll]);

  const gateValue = useCallback(() => gateRef.current.trim() || DEFAULT_GATE, []);
  const onSimulate = useCallback((id: string) => {
    void runScan({ ticket_id: id, simulate: true, gate: gateValue() }, `sim:${id}`);
  }, [runScan, gateValue]);
  const onTamper = useCallback((id: string) => {
    void runScan({ ticket_id: id, simulate: true, tamper: true, gate: gateValue() }, `tam:${id}`);
  }, [runScan, gateValue]);
  const onStale = useCallback((id: string) => {
    void runScan({ ticket_id: id, simulate: true, stale: true, gate: gateValue() }, `old:${id}`);
  }, [runScan, gateValue]);
  // Live camera scan (web): the decoded QR IS the wire → the real possession
  // scan (works for any venue + the AMO scanner). Close, then submit.
  const onCameraDetected = useCallback((w: string) => {
    setCameraOpen(false);
    void runScan({ wire: w, gate: gateValue() }, 'wire');
  }, [runScan, gateValue]);

  const onGateChange = useCallback((v: string) => {
    gateTouched.current = true;
    gateRef.current = v;
    setGate(v);
    const trimmed = v.trim();
    const write = trimmed ? AsyncStorage.setItem(GATE_KEY, trimmed) : AsyncStorage.removeItem(GATE_KEY);
    write.catch((e: unknown) => console.error('[BusinessScanner] gate save', e));
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
    if (code.length < SCAN_WIRE_MIN || code.length > SCAN_WIRE_MAX) {
      setWireHint(tr('Pega el código completo de la entrada.'));
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

  const goBack = useCallback(() => goBackOr(router, '/business/dashboard'), [router]);
  const goCreateEvent = useCallback(() => {
    try {
      router.push('/business/event-form' as NavHref);
    } catch (e) {
      console.error('[BusinessScanner] navigate', e);
    }
  }, [router]);
  const goLogin = useCallback(async () => {
    setLeaving(true);
    try {
      // A token the server rejected must be cleared first: /business/login sends a stored token
      // straight back to the dashboard, and the operator would never reach the sign-in form.
      if (token) await logout();
    } catch (e) {
      console.error('[BusinessScanner] sign out', e);
    }
    try {
      router.replace('/business/login' as NavHref);
    } catch (e) {
      console.error('[BusinessScanner] navigate', e);
    }
    if (alive.current) setLeaving(false);
  }, [token, logout, router]);

  // ── All hooks are above this line; the JSX below branches but never returns early. ──
  const needSession = ready && (
    !token || isSessionError(eventsError) || isSessionError(guestsError) || isSessionError(feedError) || isSessionError(scanError)
  );
  const noAccess = ready && !needSession && events === null && isForbiddenError(eventsError);
  const anyBusy = busy !== null;
  const busyFor = (id: string): 'sim' | 'tam' | 'old' | null => {
    if (busy === `sim:${id}`) return 'sim';
    if (busy === `tam:${id}`) return 'tam';
    if (busy === `old:${id}`) return 'old';
    return null;
  };
  const selected = events !== null && selectedId !== null
    ? (events.find((e) => e.event_id === selectedId) ?? null)
    : null;
  const usedPct = selected !== null && selected.rsvp_count > 0
    ? Math.min(100, Math.round((selected.used_count / selected.rsvp_count) * 100))
    : 0;
  const partial = selected !== null && guests !== null && guests.length < selected.rsvp_count;
  const shownGuests = guests !== null ? guests.slice(0, visible) : [];
  const remaining = guests !== null ? guests.length - shownGuests.length : 0;
  const selectedWhen = selected !== null
    ? [formatEventDate(selected.date, true), formatStartTime(selected.start_time)].filter((x): x is string => !!x).join(' · ')
    : '';

  let body: React.ReactNode;
  if (!ready) {
    body = (
      <View style={s.skeletons} testID="scanner-skeleton">
        <Skeleton height={96} borderRadius={RADIUS.xl} />
        <Skeleton height={84} borderRadius={RADIUS.xl} style={s.skelGap} />
        <Skeleton height={170} borderRadius={RADIUS.xl} style={s.skelGap} />
      </View>
    );
  } else if (needSession) {
    body = (
      <StateCard
        icon="lock-closed-outline"
        title={tr('Sesión de negocio requerida')}
        text={tr('Inicia sesión con tu cuenta de negocio para escanear las entradas de tus eventos.')}
        actionLabel={tr('Iniciar sesión')}
        onAction={goLogin}
        busy={leaving}
        testID="scanner-session-required"
      />
    );
  } else if (noAccess) {
    body = (
      <StateCard
        icon="shield-outline"
        title={tr('Sin acceso al escáner')}
        text={tr('Tu cuenta de negocio no tiene permiso para escanear entradas.')}
        testID="scanner-no-access"
      />
    );
  } else {
    body = (
      <>
        <View style={s.card} testID="scanner-gate-card">
          <Text style={s.fieldLabel}>{tr('Puerta')}</Text>
          <TextInput
            style={s.input}
            value={gate}
            onChangeText={onGateChange}
            maxLength={SCAN_GATE_MAX}
            placeholder={DEFAULT_GATE}
            placeholderTextColor={COLORS.textFaint}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            accessibilityLabel={tr('Puerta')}
            testID="scanner-gate"
          />
          <Text style={s.small}>{tr('Queda registrada en cada escaneo.')}</Text>
        </View>

        {(result !== null || scanError !== null) && (
          <View
            key={scanSeq}
            onLayout={(e) => onVerdictLayout(e.nativeEvent.layout.y)}
            style={s.verdictWrap}
            testID="scanner-result"
          >
            {result !== null ? <VerdictCard result={result} /> : <ScanErrorBox error={scanError} lang={lang} />}
          </View>
        )}

        <View style={s.section} testID="scanner-events">
          <View style={s.sectionHead}>
            <Ionicons name="calendar-outline" size={16} color={COLORS.icon} />
            <Text style={s.sectionTitle} accessibilityRole="header">{tr('Eventos próximos')}</Text>
            {events !== null && <View style={s.countPill}><Text style={s.countText}>{events.length}</Text></View>}
            <TouchableOpacity
              style={s.iconBtn}
              onPress={onRefresh}
              disabled={refreshing}
              accessibilityRole="button"
              accessibilityLabel={tr('Actualizar')}
              testID="scanner-refresh"
            >
              {refreshing ? <ActivityIndicator size="small" color={COLORS.icon} /> : <Ionicons name="refresh" size={20} color={COLORS.icon} />}
            </TouchableOpacity>
          </View>

          {/* A refresh failed while older data is on screen: say so, never pass stale counts off as live. */}
          {((eventsError !== null && events !== null) || (guestsError !== null && guests !== null)) && (
            <TouchableOpacity style={s.inlineRetry} onPress={onRefresh} accessibilityRole="button" accessibilityLabel={tr('Reintentar')} testID="scanner-stale">
              <Ionicons name="refresh" size={14} color={COLORS.coral} />
              <Text style={s.inlineRetryText}>{tr('No pudimos actualizar los datos.')} {tr('Reintentar')}</Text>
            </TouchableOpacity>
          )}

          {events === null && eventsError === null ? (
            <View style={s.skelRow}>
              <Skeleton width={168} height={84} borderRadius={RADIUS.lg} />
              <Skeleton width={168} height={84} borderRadius={RADIUS.lg} />
            </View>
          ) : events === null ? (
            <StateCard
              icon="cloud-offline-outline"
              title={tr('No pudimos cargar tus eventos')}
              text={scannerErrorMessage(eventsError, lang, tr)}
              actionLabel={tr('Reintentar')}
              onAction={onRefresh}
              testID="scanner-events-error"
            />
          ) : events.length === 0 ? (
            <View style={s.emptyCard} testID="scanner-events-empty">
              <Text style={s.emptyTitle}>{tr('No hay eventos próximos.')}</Text>
              <Text style={s.emptyText}>{tr('Publica un evento y las reservas aparecerán aquí para escanearlas.')}</Text>
              <TouchableOpacity style={s.linkBtn} onPress={goCreateEvent} accessibilityRole="link" accessibilityLabel={tr('Crear evento')}>
                <Text style={s.linkLabel}>{tr('Crear evento')}</Text>
                <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              accessibilityRole="tablist"
              style={s.chipsScroll}
              contentContainerStyle={s.chipsContent}
            >
              {events.map((ev) => {
                const on = ev.event_id === selectedId;
                const when = [formatEventDate(ev.date), formatStartTime(ev.start_time)].filter((x): x is string => !!x).join(' · ');
                const title = ev.title.trim() || tr('Evento sin título');
                return (
                  <TouchableOpacity
                    key={ev.event_id}
                    style={[s.chip, on && s.chipOn]}
                    onPress={() => selectEvent(ev.event_id)}
                    activeOpacity={0.85}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    aria-selected={on}
                    accessibilityLabel={`${title} · ${when}`}
                    testID={`scanner-event-${ev.event_id}`}
                  >
                    <Text style={s.chipTitle} numberOfLines={2}>{title}</Text>
                    <View style={s.chipMetaRow}>
                      <Text style={s.chipMeta} numberOfLines={1}>{when}</Text>
                      {today !== null && ev.date === today && (
                        <View style={s.todayTag}><Text style={s.todayTagText}>{tr('Hoy')}</Text></View>
                      )}
                    </View>
                    <Text style={[s.chipCount, on && { color: COLORS.primary }]}>
                      {ev.rsvp_count === 1 ? tr('1 reserva') : fmt(tr('{n} reservas'), { n: ev.rsvp_count })}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>

        {selected !== null && (
          <>
            <View style={s.countsCard} testID="scanner-counts">
              <Text style={s.eventName} numberOfLines={2}>{selected.title.trim() || tr('Evento sin título')}</Text>
              {!!selectedWhen && <Text style={s.eventWhen}>{selectedWhen}</Text>}
              <View style={s.totals}>
                <View style={s.stat}>
                  <Text style={s.statValue} testID="scanner-count-rsvp">{selected.rsvp_count}</Text>
                  <Text style={s.statLabel}>{tr('Reservas')}</Text>
                </View>
                <View style={s.statDivider} />
                <View style={s.stat}>
                  <Text style={[s.statValue, { color: COLORS.primary }]} testID="scanner-count-used">{selected.used_count}</Text>
                  <Text style={s.statLabel}>{tr('Ingresadas')}</Text>
                </View>
              </View>
              <View
                style={s.progressTrack}
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: 100, now: usedPct }}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={usedPct}
              >
                <View style={[s.progressFill, { width: `${usedPct}%` }]} />
              </View>
            </View>

            <View style={s.section} testID="scanner-guests">
              <View style={s.sectionHead}>
                <Ionicons name="people-outline" size={16} color={COLORS.icon} />
                <Text style={s.sectionTitle} accessibilityRole="header">{tr('Lista de invitados')}</Text>
                {guests !== null && <View style={s.countPill}><Text style={s.countText}>{guests.length}</Text></View>}
              </View>
              <Text style={s.small}>{tr('Cada escaneo registra la entrada: la reserva queda como ingresada.')}</Text>
              {partial && guests !== null && (
                <Text style={s.partialNote} testID="scanner-guests-partial">
                  {fmt(tr('Lista parcial: {shown} de {total} reservas.'), { shown: guests.length, total: selected.rsvp_count })}
                </Text>
              )}

              {guests === null && guestsError === null ? (
                <View style={s.guestList}>
                  <Skeleton height={150} borderRadius={RADIUS.xl} />
                  <Skeleton height={150} borderRadius={RADIUS.xl} />
                </View>
              ) : guests === null ? (
                <StateCard
                  icon="cloud-offline-outline"
                  title={tr('No pudimos cargar la lista de invitados')}
                  text={isForbiddenError(guestsError) ? tr('Este evento es de otro negocio') : scannerErrorMessage(guestsError, lang, tr)}
                  actionLabel={tr('Reintentar')}
                  onAction={onRefresh}
                  testID="scanner-guests-error"
                />
              ) : guests.length === 0 ? (
                <View style={s.emptyCard} testID="scanner-guests-empty">
                  <Text style={s.emptyTitle}>{tr('Aún no hay reservas para este evento.')}</Text>
                  <Text style={s.emptyText}>{tr('Cuando alguien reserve, aparecerá aquí.')}</Text>
                </View>
              ) : (
                <View style={s.guestList}>
                  {shownGuests.map((g) => (
                    <GuestRow
                      key={g.ticket_id}
                      guest={g}
                      busyAction={busyFor(g.ticket_id)}
                      anyBusy={anyBusy}
                      onSimulate={onSimulate}
                      onTamper={onTamper}
                      onStale={onStale}
                    />
                  ))}
                  {remaining > 0 && (
                    <TouchableOpacity
                      style={s.moreBtn}
                      onPress={() => setVisible((v) => v + GUEST_PAGE)}
                      accessibilityRole="button"
                      accessibilityLabel={fmt(tr('Mostrar más ({n})'), { n: remaining })}
                      testID="scanner-guests-more"
                    >
                      <Text style={s.moreBtnText}>{fmt(tr('Mostrar más ({n})'), { n: remaining })}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          </>
        )}

        <TouchableOpacity
          style={s.cameraBtn}
          onPress={() => { setResult(null); setScanError(null); setCameraOpen(true); }}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={tr('Escanear con cámara')}
          testID="scanner-camera-btn"
        >
          <Ionicons name="scan-outline" size={20} color={COLORS.white} />
          <Text style={s.cameraBtnText}>{tr('Escanear con cámara')}</Text>
        </TouchableOpacity>
        {cameraOpen && <CameraScanner onDetected={onCameraDetected} onClose={() => setCameraOpen(false)} lang={lang} />}

        <View style={s.card} testID="scanner-paste">
          <TouchableOpacity
            style={s.pasteToggle}
            onPress={() => setPasteOpen((v) => !v)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityState={{ expanded: pasteOpen }}
            aria-expanded={pasteOpen}
            accessibilityLabel={tr('Pegar código')}
            testID="scanner-paste-toggle"
          >
            <Ionicons name="clipboard-outline" size={18} color={COLORS.icon} />
            <Text style={s.pasteTitle}>{tr('Pegar código')}</Text>
            <Ionicons name={pasteOpen ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
          {pasteOpen && (
            <View style={s.pasteBody}>
              <Text style={s.small}>{tr('Pega el código de la entrada o del City Pass. Vence en 20 s como máximo: pégalo enseguida.')}</Text>
              <View style={s.inputRow}>
                <TextInput
                  style={[s.input, s.wireInput]}
                  value={wire}
                  onChangeText={onWireChange}
                  maxLength={SCAN_WIRE_MAX}
                  placeholder={tr('Código de la entrada')}
                  placeholderTextColor={COLORS.textFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  returnKeyType="go"
                  onSubmitEditing={submitWire}
                  accessibilityLabel={tr('Código de la entrada')}
                  testID="scanner-wire"
                />
                {wire.length > 0 && (
                  <TouchableOpacity style={s.clearBtn} onPress={clearWire} accessibilityRole="button" accessibilityLabel={tr('Borrar')}>
                    <Ionicons name="close-circle" size={20} color={COLORS.iconMuted} />
                  </TouchableOpacity>
                )}
              </View>
              {wireHint !== null && <Text style={s.hint} testID="scanner-wire-hint">{wireHint}</Text>}
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
                testID="scanner-validate"
              >
                {busy === 'wire' ? <ActivityIndicator size="small" color={COLORS.black} /> : null}
                <Text style={s.validateText}>{tr('Validar')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={s.section} testID="scanner-feed">
          <View style={s.sectionHead}>
            <Ionicons name="list-outline" size={16} color={COLORS.icon} />
            <Text style={s.sectionTitle} accessibilityRole="header">{tr('Últimos escaneos')}</Text>
          </View>

          {feedError !== null && (
            <TouchableOpacity style={s.inlineRetry} onPress={onRefresh} accessibilityRole="button" accessibilityLabel={tr('Reintentar')} testID="scanner-feed-error">
              <Ionicons name="refresh" size={14} color={COLORS.coral} />
              <Text style={s.inlineRetryText}>{tr('No pudimos actualizar los escaneos.')} {tr('Reintentar')}</Text>
            </TouchableOpacity>
          )}

          <Text style={s.small}>{tr('Hora de Cartagena')}</Text>
          {feed !== null && feed.length > 0 ? (
            <View style={s.ledger}>
              {feed.map((r, i) => (
                <FeedRow key={`${r.at ?? 'x'}-${i}`} row={r} first={i === 0} />
              ))}
            </View>
          ) : feed !== null ? (
            <Text style={s.feedEmpty} testID="scanner-feed-empty">{tr('Aún no hay escaneos.')}</Text>
          ) : feedError === null ? (
            <Skeleton height={96} borderRadius={RADIUS.lg} style={s.skelGap} />
          ) : null}
        </View>
      </>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="scanner-screen">
      <Head>
        <title>{`${tr('Escáner de entradas')} · AMO Life`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <View style={s.headerBar}>
        <View style={s.headerInner}>
          <TouchableOpacity
            style={s.backBtn}
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel={tr('Volver')}
            testID="scanner-back-btn"
          >
            <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
          </TouchableOpacity>
          <Ionicons name="qr-code-outline" size={20} color={COLORS.primary} />
          <Text style={s.headerLabel} numberOfLines={1} accessibilityRole="header">{tr('Escáner de entradas')}</Text>
        </View>
      </View>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        >
          <View style={s.content}>{body}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.xxl },

  // header (pinned)
  headerBar: { borderBottomWidth: 1, borderBottomColor: COLORS.hairline, backgroundColor: COLORS.background },
  headerInner: { width: '100%', maxWidth: 560, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: SPACING.sm + 2, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm + 4 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.hairline, alignItems: 'center', justifyContent: 'center' },
  headerLabel: { flex: 1, fontSize: 17, color: COLORS.textMain, ...FONTS.bold },

  // cards + sections
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, marginTop: SPACING.md, gap: 6 },
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
  fieldLabel: { ...TYPE.overline, color: COLORS.textFaint, textTransform: 'uppercase' },
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
  guestPanel: { gap: 4, padding: SPACING.md, borderRadius: RADIUS.lg, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  panelHead: { ...TYPE.overline, color: COLORS.textFaint, textTransform: 'uppercase' },
  // The PALCO guest-on-scan moment: the guest's name, huge. A forged code's claimed name stays small.
  guestName: { fontSize: 34, lineHeight: 40, color: COLORS.textMain, ...FONTS.bold, letterSpacing: -0.5 },
  guestNameForged: { fontSize: 20, lineHeight: 26, color: COLORS.textMuted, ...FONTS.bold },
  panelTitle: { fontSize: 15, lineHeight: 20, color: COLORS.textMain, ...FONTS.bold, marginTop: 2 },
  panelMeta: { fontSize: 12.5, lineHeight: 18, color: COLORS.textMuted, ...FONTS.medium },
  panelMetaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  planChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 9, paddingVertical: 3, borderColor: 'rgba(18,181,165,0.45)', backgroundColor: 'rgba(18,181,165,0.12)' },
  planChipText: { fontSize: 12, color: COLORS.primary, ...FONTS.bold, letterSpacing: 0.2 },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: 'rgba(255,107,74,0.10)', borderWidth: 1, borderColor: 'rgba(255,107,74,0.40)' },
  errorIcon: { marginTop: 1 },
  errorBody: { flex: 1, gap: 4 },
  errorText: { fontSize: 13, lineHeight: 18, color: COLORS.textMain, ...FONTS.medium },
  errorHint: { fontSize: 12, lineHeight: 17, color: COLORS.textMuted, ...FONTS.medium },

  // events
  chipsScroll: { marginHorizontal: -SPACING.lg },
  chipsContent: { paddingHorizontal: SPACING.lg, paddingVertical: 2, gap: SPACING.sm + 2 },
  chip: { width: 176, minHeight: 84, gap: 3, padding: SPACING.sm + 4, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  chipOn: { borderColor: 'rgba(18,181,165,0.7)', backgroundColor: 'rgba(18,181,165,0.12)' },
  chipTitle: { fontSize: 13.5, lineHeight: 18, color: COLORS.textMain, ...FONTS.bold },
  chipMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipMeta: { flexShrink: 1, fontSize: 11.5, color: COLORS.textMuted, ...FONTS.medium, fontVariant: ['tabular-nums'] },
  chipCount: { fontSize: 11.5, color: COLORS.textMuted, ...FONTS.semibold },
  todayTag: { borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 1, backgroundColor: 'rgba(255,107,74,0.16)' },
  todayTagText: { fontSize: 9.5, color: COLORS.coral, ...FONTS.bold, letterSpacing: 0.6, textTransform: 'uppercase' },
  skelRow: { flexDirection: 'row', gap: SPACING.sm + 2 },

  // counts
  countsCard: { marginTop: SPACING.md, padding: SPACING.md, gap: 6, borderRadius: RADIUS.xl, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  eventName: { fontSize: 16, lineHeight: 21, color: COLORS.textMain, ...FONTS.bold },
  eventWhen: { fontSize: 12.5, color: COLORS.textMuted, ...FONTS.medium, fontVariant: ['tabular-nums'] },
  totals: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm, marginTop: 2 },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statDivider: { width: 1, height: 30, backgroundColor: COLORS.hairline },
  statValue: { fontSize: 28, lineHeight: 34, color: COLORS.textMain, ...FONTS.bold, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center' },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: COLORS.primary },

  // guests
  guestList: { gap: SPACING.sm + 2, marginTop: SPACING.sm },
  partialNote: { fontSize: 12, lineHeight: 17, color: AMBER, ...FONTS.semibold, marginTop: 4 },
  guestRow: { backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, gap: 6 },
  guestTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  guestRowName: { flex: 1, fontSize: 16, lineHeight: 21, color: COLORS.textMain, ...FONTS.bold },
  statusChip: { borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 9, paddingVertical: 2 },
  statusChipText: { fontSize: 10.5, ...FONTS.bold, letterSpacing: 0.3 },
  guestMeta: { fontSize: 10.5, color: COLORS.textFaint, fontFamily: MONO },
  simBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, marginTop: SPACING.xs, backgroundColor: COLORS.primary, borderRadius: RADIUS.full },
  simBtnText: { fontSize: 14.5, color: COLORS.black, ...FONTS.bold },
  attackToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44 },
  attackToggleText: { fontSize: 12.5, color: COLORS.textMuted, ...FONTS.semibold },
  attackRow: { flexDirection: 'row', gap: 8 },
  attackBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, borderRadius: RADIUS.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  attackTamper: { borderColor: 'rgba(239,68,68,0.50)', backgroundColor: 'rgba(239,68,68,0.08)' },
  attackStale: { borderColor: 'rgba(154,163,178,0.45)', backgroundColor: 'rgba(154,163,178,0.08)' },
  attackText: { flexShrink: 1, fontSize: 12.5, lineHeight: 16, textAlign: 'center', ...FONTS.semibold },
  moreBtn: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  moreBtnText: { fontSize: 13.5, color: COLORS.textMain, ...FONTS.semibold },
  emptyCard: { alignItems: 'center', gap: 6, padding: SPACING.lg, borderRadius: RADIUS.xl, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.border, backgroundColor: COLORS.surface },
  emptyTitle: { ...TYPE.headline, color: COLORS.textMain, textAlign: 'center' },
  emptyText: { fontSize: 12.5, lineHeight: 18, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center' },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, marginTop: SPACING.xs, paddingHorizontal: SPACING.md },
  linkLabel: { fontSize: 13.5, color: COLORS.official, ...FONTS.semibold },

  // paste
  cameraBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 54,
    backgroundColor: COLORS.primary, borderRadius: RADIUS.lg, marginBottom: SPACING.md,
  },
  cameraBtnText: { ...TYPE.headline, color: COLORS.white },
  pasteToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  pasteTitle: { ...TYPE.headline, color: COLORS.textMain, flex: 1 },
  pasteBody: { gap: SPACING.sm + 2, marginTop: SPACING.sm },
  validateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, backgroundColor: COLORS.primary, borderRadius: RADIUS.full },
  validateText: { fontSize: 14.5, color: COLORS.black, ...FONTS.bold },

  // feed
  feedEmpty: { marginTop: SPACING.xs, fontSize: 12.5, lineHeight: 18, color: COLORS.textMuted, ...FONTS.medium },
  inlineRetry: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  inlineRetryText: { flex: 1, fontSize: 12.5, lineHeight: 17, color: COLORS.coral, ...FONTS.semibold },
  ledger: { marginTop: SPACING.xs, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: SPACING.md },
  feedRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 11 },
  feedChip: { width: 92, alignItems: 'center', borderWidth: 1, borderRadius: RADIUS.full, paddingVertical: 3, paddingHorizontal: 4 },
  feedChipText: { fontSize: 10, ...FONTS.bold, letterSpacing: 0.3 },
  feedBody: { flex: 1, gap: 2 },
  feedName: { fontSize: 12.5, lineHeight: 17, color: COLORS.textMain, ...FONTS.semibold },
  feedTitle: { fontSize: 11, lineHeight: 15, color: COLORS.textFaint, ...FONTS.regular },
  feedRight: { alignItems: 'flex-end', gap: 1, maxWidth: 104 },
  feedTime: { fontSize: 10.5, color: COLORS.textMuted, ...FONTS.medium, fontVariant: ['tabular-nums'] },
  feedGate: { fontSize: 10.5, color: COLORS.textFaint, ...FONTS.medium },

  // states
  skeletons: { marginTop: SPACING.sm },
  skelGap: { marginTop: SPACING.md },
  stateCard: { alignItems: 'center', gap: 10, marginTop: SPACING.lg, padding: SPACING.lg, borderRadius: RADIUS.xl, backgroundColor: COLORS.surface, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.border },
  stateTitle: { ...TYPE.title3, color: COLORS.textMain, textAlign: 'center' },
  stateText: { ...TYPE.subhead, color: COLORS.textMuted, textAlign: 'center' },
  primaryBtn: { flexDirection: 'row', gap: 8, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, paddingHorizontal: SPACING.xl, paddingVertical: 12, borderRadius: RADIUS.full, marginTop: SPACING.xs },
  primaryBtnText: { fontSize: 14, color: COLORS.black, ...FONTS.bold },
});
