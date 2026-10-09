// /gobierno/boleta/[id] — the LIVE credential (docs/civic-demo/DESIGN.md §2-§3).
//
// The wire AMOCIV1.<ticketId>.<counter>.<token> rotates every 10 s SERVER-side (PALCO1 scheme: a
// screenshot dies in ≤ 20 s). This screen polls GET .../qr: first fetch immediately, then the next
// one timed to land just after the rotation (planQrTiming, latency-compensated), and draws the QR
// from `wire` with react-native-qrcode-svg. A countdown bar is synced to expires_in_ms on every poll.
//
// Honesty: a code that is past its deadline and could not be refreshed is HIDDEN behind an overlay
// (never left looking live); the QR carries a diagonal "DEMO · SIN VALIDEZ" watermark; the pinned DEMO
// chip and the bordered disclaimer wear every screen. A used credential shows UTILIZADA instead of a
// QR. A recharge (kind "receipt") is a COMPROBANTE, never presented as an access credential.
//
// Polling lifecycle: only while the screen is focused and the app is active; every request is tagged
// with a generation so a slow answer can never overwrite a newer one; all timers are cleared on
// blur / unmount. The clock-derived countdown only starts after `mounted` flips in an effect, so the
// static-export HTML and the first client render are identical (React #418).
import React, {
  useCallback, useEffect, useRef, useState,
} from 'react';
import {
  AccessibilityInfo, AppState, LayoutChangeEvent, Platform, ScrollView, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import Head from '../../../src/components/WebHead';
import { Skeleton } from '../../../src/components/Skeleton';
import {
  DEMO_AMBER, DISCLAIMER_FALLBACK_ES, QR_STALE_GRACE_MS, civicErrorMessage, createQrPoller, firstParam,
  formatBogota, formatCop, getQr, getTicket, hedgeText, isAuthError, isCivicError, isUnverified, monoNow,
  pickL2, ticketHasUnverified, ticketMerchants, useCivicSession,
} from '../../../src/components/civic/civic';
import type {
  CivicTicket, IconName, Loc, QrFrame, TicketLine,
} from '../../../src/components/civic/civic';
import { COLORS, FONTS, RADIUS, SPACING, TYPE } from '../../../src/constants/theme';
import { useLang } from '../../../src/context/LanguageContext';
import type { Lang } from '../../../src/i18n/translations';
import { useTr } from '../../../src/i18n/autoTr';
import { goBackOr } from '../../../src/lib/nav';

type Phase = 'loading' | 'ready' | 'missing' | 'error';

const QR_INK = '#0B1020';
const QR_PAPER = '#FFFFFF';
const QR_MIN = 180;
const QR_MAX = 280;
const QR_PAD = 18;
const WARN_MS = 3000;
const USED_GREEN = '#22C55E';
const MONO = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
});
const noop = (): void => undefined;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

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
          testID="gobierno-boleta-back-btn"
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={s.headerLabel} numberOfLines={1}>{label}</Text>
        <View style={s.demoChip} accessibilityRole="text" accessibilityLabel={tr('Demostración')} testID="gobierno-boleta-demo-chip">
          <Ionicons name="flask-outline" size={12} color={DEMO_AMBER} />
          <Text style={s.demoChipText}>{tr('DEMO')}</Text>
        </View>
      </View>
    </View>
  );
}

function DisclaimerNote({ text }: { text: string }) {
  return (
    <View style={s.disclaimer} testID="gobierno-boleta-disclaimer">
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

// ── The QR itself ────────────────────────────────────────────────────────────
// Memoised: the countdown re-renders its parent ~10×/s, the QR must not.
const QrCode = React.memo(function QrCode({ wire, size }: { wire: string; size: number }) {
  // ecl Q: the 25 % redundancy absorbs the watermark's semi-transparent strokes. onError is a no-op so a
  // renderer failure blanks the panel instead of throwing through the root error boundary; the wire is
  // always a ~45-char ASCII string, far inside QR capacity.
  return <QRCode value={wire} size={size} color={QR_INK} backgroundColor={QR_PAPER} ecl="Q" onError={noop} />;
});

const Watermark = React.memo(function Watermark() {
  const tr = useTr();
  return (
    <View style={s.watermark} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={s.watermarkInner}>
        {[0, 1, 2].map((i) => (
          <Text key={i} style={s.watermarkText} numberOfLines={1} allowFontScaling={false}>
            {tr('DEMO · SIN VALIDEZ')}
          </Text>
        ))}
      </View>
    </View>
  );
});

function QrPanel({
  qr, failed, size, clockOn, onRetry,
}: { qr: QrFrame; failed: boolean; size: number; clockOn: boolean; onRetry: () => void }) {
  const tr = useTr();
  const [now, setNow] = useState<number | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  // prefers-reduced-motion: tick the countdown once a second instead of ~10×/s.
  useEffect(() => {
    let on = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (on) setReduceMotion(v);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduceMotion(v));
    return () => {
      on = false;
      sub?.remove(); // react-native-web returns undefined when matchMedia is missing
    };
  }, []);

  // The clock starts only after the screen has mounted (hydration rule) and stops with the panel.
  useEffect(() => {
    if (!clockOn) return undefined;
    const tick = () => setNow(monoNow());
    tick();
    const id = setInterval(tick, reduceMotion ? 1000 : 100);
    return () => clearInterval(id);
  }, [clockOn, reduceMotion]);

  const remaining = now === null ? null : qr.deadline - now;
  const frac = remaining === null ? 0 : clamp(remaining / qr.stepMs, 0, 1);
  const secs = remaining === null ? null : Math.max(0, Math.ceil(remaining / 1000));
  // Past its deadline and not refreshed: the code is dead. Hide it rather than show a stale credential.
  const stale = remaining !== null && remaining < -QR_STALE_GRACE_MS;
  const warn = remaining !== null && remaining < WARN_MS;
  const panel = size + QR_PAD * 2;

  let caption: string;
  if (stale) caption = failed ? tr('Sin conexión') : tr('Renovando…');
  else if (secs === null) caption = '—';
  else caption = `${tr('Se renueva en')} ${secs} s`;

  return (
    <View style={s.qrWrap}>
      <View
        style={[s.qrPanel, { width: panel, height: panel }]}
        accessible
        accessibilityLabel={tr('Credencial de demostración sin validez')}
        testID="gobierno-boleta-qr"
      >
        <QrCode wire={qr.wire} size={size} />
        <Watermark />
        {stale && (
          <View style={s.staleOverlay} testID="gobierno-boleta-qr-stale" accessibilityRole="alert">
            <Ionicons name={failed ? 'cloud-offline-outline' : 'refresh'} size={30} color={COLORS.textMuted} />
            <Text style={s.staleTitle}>
              {failed ? tr('Este código ya venció y no pudimos renovarlo.') : tr('Renovando el código…')}
            </Text>
            {failed && (
              <TouchableOpacity style={s.retryBtn} onPress={onRetry} accessibilityRole="button" accessibilityLabel={tr('Reintentar')}>
                <Text style={s.retryBtnText}>{tr('Reintentar')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      <View style={[s.barTrack, { width: panel }]} accessibilityRole="progressbar" accessibilityLabel={tr('Tiempo restante del código')} accessibilityValue={{ min: 0, max: 100, now: Math.round(frac * 100), text: secs === null ? '—' : `${secs} s` }} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)} aria-valuetext={secs === null ? '—' : `${secs} s`} testID="gobierno-boleta-countdown">
        <View style={[s.barFill, warn && s.barFillWarn, { width: `${Math.round(frac * 1000) / 10}%` }]} />
      </View>
      <Text style={[s.barCaption, warn && !stale && s.barCaptionWarn]} testID="gobierno-boleta-countdown-text">{caption}</Text>
    </View>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────
function LineRow({ line, first, lang, hedge }: { line: TicketLine; first: boolean; lang: Lang; hedge: string }) {
  const tr = useTr();
  const merchant = pickL2(line.merchant, lang);
  return (
    <View style={[s.lineRow, !first && s.rowDivider]} testID={`gobierno-boleta-line-${line.key}`}>
      <View style={s.lineTop}>
        <Text style={s.lineLabel}>
          {pickL2(line.label, lang)}{line.qty > 1 ? ` × ${line.qty}` : ''}
        </Text>
        <Text style={s.lineAmount}>{formatCop(line.subtotal_cop, lang)}</Text>
      </View>
      {!!merchant && <Text style={s.lineMerchant}>{tr('Recauda')}: {merchant}</Text>}
      {isUnverified(line.confidence) && <VerifyChip text={hedge} />}
      {!!line.source_name && <Text style={s.small}>{line.source_name}</Text>}
      {!!line.last_verified && <Text style={s.small}>{tr('Última verificación')}: {line.last_verified}</Text>}
    </View>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────
export default function GobiernoBoletaScreen() {
  const tr = useTr();
  const { lang } = useLang();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = firstParam(params.id);
  const { ready, token, signOut } = useCivicSession();

  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>('loading');
  const [ticket, setTicket] = useState<CivicTicket | null>(null);
  const [disclaimerLoc, setDisclaimerLoc] = useState<Loc | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [qr, setQr] = useState<QrFrame | null>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const [qrUsed, setQrUsed] = useState(false);
  const [authLost, setAuthLost] = useState(false);
  const [focused, setFocused] = useState(true);
  const [showWire, setShowWire] = useState(false);
  const [cardWidth, setCardWidth] = useState(0);
  const pollNow = useRef<(() => void) | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // A different ticket (deep link reuse) starts from scratch.
  useEffect(() => {
    setPhase('loading');
    setTicket(null);
    setQr(null);
    setQrFailed(false);
    setQrUsed(false);
    setAuthLost(false);
    setShowWire(false);
    setLoadError(null);
  }, [id]);

  // The ticket itself (title, merchants, lines, status). Re-runs via reloadKey: retry, or to pick up
  // used_at once the poll has seen the credential get used.
  useEffect(() => {
    if (!token || !id) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const r = await getTicket(token, id);
        if (cancelled) return;
        setTicket(r.ticket);
        setDisclaimerLoc(r.disclaimer);
        setLoadError(null);
        setPhase('ready');
      } catch (e) {
        if (cancelled) return;
        console.error('[GobiernoBoleta] ticket', e);
        setLoadError(e);
        if (isAuthError(e)) setAuthLost(true);
        else setPhase(isCivicError(e) && e.status === 404 ? 'missing' : 'error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, id, reloadKey]);

  useEffect(() => {
    if (qrUsed) setReloadKey((k) => k + 1);
  }, [qrUsed]);

  // Focus: this screen stays mounted under whatever is pushed on top; it must not keep polling then.
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => {
      setFocused(false);
      setQr(null); // never keep a code across a blur — it may be minutes old when we return
    };
  }, []));

  const used = ticket?.status === 'used' || qrUsed;

  // The rotating-credential poll (createQrPoller in civic.ts holds the loop and its concurrency rules).
  // It runs only while the ticket is loaded and unused, this screen is focused and the app is active.
  useEffect(() => {
    if (!token || !id || phase !== 'ready' || used || !focused) return undefined;
    const poller = createQrPoller({
      fetchQr: () => getQr(token, id),
      now: monoNow,
      onFrame: (frame) => {
        setQrFailed(false);
        setQr(frame);
      },
      onUsed: () => setQrUsed(true), // the screen flips to UTILIZADA; the ticket reloads for used_at
      onFail: (failures, e) => {
        if (failures === 1) console.error('[GobiernoBoleta] qr poll', e); // first of a streak, not every retry
        setQrFailed(true);
      },
      onMissing: (e) => {
        console.error('[GobiernoBoleta] qr poll: ticket gone', e);
        setLoadError(e);
        setPhase('missing');
      },
      onAuth: (e) => {
        console.error('[GobiernoBoleta] qr poll: session', e);
        setAuthLost(true);
      },
    });
    pollNow.current = poller.refresh;
    poller.start();

    // Backgrounded timers are throttled or frozen: pause, and fetch a fresh code the moment we return.
    const sub = AppState.addEventListener('change', (status) => {
      if (status === 'active') poller.refresh();
      else {
        // The monotonic clock can freeze while the device sleeps (iOS/WebKit): a frame kept across
        // a background span would wake up minutes old yet still render as live. Blank it — the
        // refresh() on 'active' paints a fresh code in one round trip.
        poller.pause();
        setQr(null);
      }
    });
    return () => {
      pollNow.current = null;
      poller.stop();
      sub?.remove(); // react-native-web hands back undefined where the DOM API is missing
    };
  }, [token, id, phase, used, focused]);

  const goBack = useCallback(() => goBackOr(router, '/gobierno'), [router]);
  const retryTicket = useCallback(() => {
    setPhase('loading');
    setLoadError(null);
    setReloadKey((k) => k + 1);
  }, []);
  const retryQr = useCallback(() => {
    if (pollNow.current) pollNow.current();
  }, []);
  const onCardLayout = useCallback((e: LayoutChangeEvent) => {
    setCardWidth(Math.round(e.nativeEvent.layout.width));
  }, []);
  const toggleWire = useCallback(() => setShowWire((v) => !v), []);

  // ── All hooks are above this line; the JSX below branches but never returns early. ──
  const receipt = ticket?.kind === 'receipt';
  const disclaimer = pickL2(disclaimerLoc, lang) || tr(DISCLAIMER_FALLBACK_ES);
  const qrSize = clamp((cardWidth > 0 ? cardWidth : 300) - SPACING.md * 2 - QR_PAD * 2, QR_MIN, QR_MAX);
  const screenTitle = receipt ? tr('Comprobante de recarga (demo)') : tr('Boleta demo');

  const needSession = ready && (!token || authLost);

  let body: React.ReactNode;
  if (!ready || (phase === 'loading' && !needSession)) {
    body = (
      <View style={s.skeletons} testID="gobierno-boleta-skeleton">
        <Skeleton height={28} width="60%" borderRadius={RADIUS.sm} />
        <Skeleton height={40} width="45%" borderRadius={RADIUS.sm} style={s.skelGap} />
        <Skeleton height={QR_MAX + QR_PAD * 2 + 70} borderRadius={RADIUS.xl} style={s.skelGap} />
        <Skeleton height={110} borderRadius={RADIUS.xl} style={s.skelGap} />
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
        testID="gobierno-boleta-session-required"
      />
    );
  } else if (phase === 'missing') {
    body = (
      <StateCard
        icon="search-outline"
        title={tr('Esta boleta demo ya no existe')}
        text={tr('Las boletas de la demostración se eliminan a las 48 h, o el enlace no es correcto.')}
        actionLabel={tr('Volver')}
        onAction={goBack}
        testID="gobierno-boleta-missing"
      />
    );
  } else if (phase === 'error' || !ticket) {
    body = (
      <StateCard
        icon="cloud-offline-outline"
        title={tr('No pudimos cargar la boleta')}
        text={civicErrorMessage(loadError, lang, tr)}
        actionLabel={tr('Reintentar')}
        onAction={retryTicket}
        testID="gobierno-boleta-error"
      />
    );
  } else {
    const names = ticketMerchants(ticket, lang);
    const hedge = hedgeText(tr, ticket.service);
    body = (
      <>
        <View style={s.hero} testID="gobierno-boleta-hero">
          <View style={s.chipRow}>
            <View style={s.kindChip}>
              <Text style={s.kindChipText}>{receipt ? tr('Comprobante') : tr('Credencial QR')}</Text>
            </View>
            <View style={[s.statusChip, used ? s.statusChipUsed : s.statusChipLive]} testID="gobierno-boleta-status">
              <Text style={[s.statusChipText, used ? s.statusTextUsed : s.statusTextLive]}>
                {used ? tr('Utilizada') : tr('Emitida')}
              </Text>
            </View>
          </View>
          <Text style={s.title} accessibilityRole="header" testID="gobierno-boleta-title">
            {receipt ? tr('Comprobante de recarga (demo)') : pickL2(ticket.title, lang)}
          </Text>
          {names.length > 0 && (
            <Text style={s.merchantLine} testID="gobierno-boleta-merchants">
              {names.length > 1 ? tr('Recaudan') : tr('Recauda')}: {names.join(' · ')}
            </Text>
          )}
          <View style={s.amountRow}>
            <Text style={s.amount} testID="gobierno-boleta-amount">{formatCop(ticket.amount_cop, lang)}</Text>
            {ticketHasUnverified(ticket) && <VerifyChip text={hedge} />}
          </View>
          <Text style={s.small}>{tr('Recaudo simulado: ningún dinero se movió.')}</Text>
        </View>

        <View style={s.qrCard} onLayout={onCardLayout} accessibilityLiveRegion="polite" testID="gobierno-boleta-qr-card">
          <View style={s.qrHead}>
            <Ionicons name={used ? 'checkmark-circle-outline' : 'qr-code-outline'} size={16} color={COLORS.icon} />
            <Text style={s.qrHeadTitle}>{receipt ? tr('Código del comprobante') : tr('Credencial de acceso')}</Text>
            <View style={s.miniDemo}><Text style={s.miniDemoText}>{tr('DEMO')}</Text></View>
          </View>

          {used ? (
            <View style={s.usedPanel} testID="gobierno-boleta-used">
              <Ionicons name="checkmark-circle" size={58} color={USED_GREEN} />
              <Text style={s.usedTitle}>{tr('UTILIZADA')}</Text>
              <Text style={s.usedTime} testID="gobierno-boleta-used-at">
                {ticket.used_at ? formatBogota(ticket.used_at, true) : '—'}
              </Text>
              <Text style={s.usedNote}>
                {tr('Esta credencial ya fue validada en un punto de control. El código ya no sirve.')}
              </Text>
            </View>
          ) : qr ? (
            <QrPanel qr={qr} failed={qrFailed} size={qrSize} clockOn={mounted && focused} onRetry={retryQr} />
          ) : (
            <View style={s.qrPending} testID="gobierno-boleta-qr-pending">
              {qrFailed ? (
                <>
                  <Ionicons name="cloud-offline-outline" size={28} color={COLORS.textMuted} />
                  <Text style={s.pendingText}>{tr('No pudimos obtener el código.')}</Text>
                  <TouchableOpacity style={s.retryBtn} onPress={retryQr} accessibilityRole="button" accessibilityLabel={tr('Reintentar')}>
                    <Text style={s.retryBtnText}>{tr('Reintentar')}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <Skeleton width={qrSize + QR_PAD * 2} height={qrSize + QR_PAD * 2} borderRadius={RADIUS.lg} />
              )}
            </View>
          )}

          {!used && (
            <Text style={s.rotateNote} testID="gobierno-boleta-rotate-note">
              {tr('La pantalla rota cada 10 s — una captura de pantalla muere en segundos.')}
            </Text>
          )}

          {!used && qr && (
            <View style={s.wireBlock}>
              <TouchableOpacity
                style={s.wireToggle}
                onPress={toggleWire}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityState={{ expanded: showWire }}
                aria-expanded={showWire}
                accessibilityLabel={showWire ? tr('Ocultar código') : tr('Mostrar código')}
                testID="gobierno-boleta-wire-toggle"
              >
                <Ionicons name={showWire ? 'eye-off-outline' : 'eye-outline'} size={16} color={COLORS.official} />
                <Text style={s.wireToggleText}>{showWire ? tr('Ocultar código') : tr('Mostrar código')}</Text>
              </TouchableOpacity>
              {showWire && (
                <Text selectable style={s.wire} testID="gobierno-boleta-wire">{qr.wire}</Text>
              )}
            </View>
          )}
        </View>

        {receipt && (
          <View style={s.noteBox} testID="gobierno-boleta-receipt-note">
            <Ionicons name="receipt-outline" size={15} color={COLORS.primary} style={s.noteIcon} />
            <Text style={s.noteText}>
              {tr('Este comprobante muestra el pago a la entidad; no es una credencial de acceso. La validación del pasaje le corresponde al concesionario de Transcaribe y no se simula en la demo.')}
            </Text>
          </View>
        )}

        <View style={s.card} testID="gobierno-boleta-lines">
          <Text style={s.cardTitle} accessibilityRole="header">{tr('Detalle del cobro')}</Text>
          {ticket.lines.map((l, i) => (
            <LineRow key={`${l.key}-${i}`} line={l} first={i === 0} lang={lang} hedge={hedge} />
          ))}
          <View style={[s.totalRow, s.rowDivider]}>
            <Text style={s.totalLabel}>{tr('Total (demo)')}</Text>
            <Text style={s.totalAmount}>{formatCop(ticket.amount_cop, lang)}</Text>
          </View>
        </View>

        <Text style={s.idLine} selectable testID="gobierno-boleta-id">
          {tr('Boleta demo')} · {ticket.ticket_id}
        </Text>
      </>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="gobierno-boleta-screen">
      <Head>
        <title>{`${screenTitle} · AMO Life`}</title>
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

  // hero
  hero: { paddingTop: SPACING.lg, gap: 8, alignItems: 'flex-start' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  kindChip: { borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4, borderColor: 'rgba(18,181,165,0.40)', backgroundColor: 'rgba(18,181,165,0.10)' },
  kindChipText: { fontSize: 11, color: COLORS.primary, ...FONTS.bold, letterSpacing: 0.4 },
  statusChip: { borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4 },
  statusChipLive: { borderColor: 'rgba(245,166,35,0.45)', backgroundColor: 'rgba(245,166,35,0.10)' },
  statusChipUsed: { borderColor: 'rgba(34,197,94,0.45)', backgroundColor: 'rgba(34,197,94,0.12)' },
  statusChipText: { fontSize: 11, ...FONTS.bold, letterSpacing: 0.6, textTransform: 'uppercase' },
  statusTextLive: { color: DEMO_AMBER },
  statusTextUsed: { color: USED_GREEN },
  title: { ...TYPE.title2, color: COLORS.textMain },
  merchantLine: { fontSize: 13, lineHeight: 19, color: COLORS.textMuted, ...FONTS.medium },
  amountRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 2 },
  amount: { fontSize: 38, lineHeight: 44, color: COLORS.textMain, ...FONTS.bold, letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
  small: { fontSize: 11, lineHeight: 15, color: COLORS.textFaint, ...FONTS.medium },
  verifyChip: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2, borderColor: `${COLORS.coral}8C`, backgroundColor: `${COLORS.coral}1A` },
  verifyChipText: { flexShrink: 1, fontSize: 10.5, color: COLORS.coral, ...FONTS.bold, letterSpacing: 0.2 },

  // QR card
  qrCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, padding: SPACING.md, borderWidth: 1, borderColor: 'rgba(245,166,35,0.30)', marginTop: SPACING.lg, gap: SPACING.sm + 4 },
  qrHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qrHeadTitle: { ...TYPE.headline, color: COLORS.textMain, flex: 1 },
  miniDemo: { borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2, borderColor: 'rgba(245,166,35,0.55)', backgroundColor: 'rgba(245,166,35,0.14)' },
  miniDemoText: { fontSize: 10, color: DEMO_AMBER, ...FONTS.bold, letterSpacing: 1.2 },
  qrWrap: { alignItems: 'center', gap: 10 },
  qrPanel: { backgroundColor: QR_PAPER, borderRadius: RADIUS.lg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  qrPending: { minHeight: 200, alignItems: 'center', justifyContent: 'center', gap: 10 },
  pendingText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center' },
  watermark: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', pointerEvents: 'none' },
  watermarkInner: { width: '150%', alignItems: 'center', gap: 58, transform: [{ rotate: '-28deg' }] },
  watermarkText: { fontSize: 17, letterSpacing: 2.2, color: 'rgba(180,83,9,0.40)', ...FONTS.bold, textAlign: 'center' },
  staleOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.96)', alignItems: 'center', justifyContent: 'center', gap: 10, padding: SPACING.md },
  staleTitle: { fontSize: 13, lineHeight: 18, color: '#1F2937', ...FONTS.semibold, textAlign: 'center' },
  retryBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, paddingHorizontal: SPACING.lg, borderRadius: RADIUS.full },
  retryBtnText: { fontSize: 13.5, color: COLORS.black, ...FONTS.bold },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.10)', overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: COLORS.primary },
  barFillWarn: { backgroundColor: DEMO_AMBER },
  barCaption: { fontSize: 12.5, color: COLORS.textMuted, ...FONTS.semibold, fontVariant: ['tabular-nums'] },
  barCaptionWarn: { color: DEMO_AMBER },
  rotateNote: { fontSize: 12, lineHeight: 17, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center' },
  wireBlock: { alignItems: 'center', gap: 8 },
  wireToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: SPACING.md },
  wireToggleText: { fontSize: 13.5, color: COLORS.official, ...FONTS.semibold },
  wire: { fontSize: 10.5, lineHeight: 15, color: COLORS.textMuted, fontFamily: MONO, textAlign: 'center', alignSelf: 'stretch' },

  // used state
  usedPanel: { alignItems: 'center', gap: 8, paddingVertical: SPACING.lg, paddingHorizontal: SPACING.md, borderRadius: RADIUS.lg, backgroundColor: 'rgba(34,197,94,0.08)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.35)' },
  usedTitle: { fontSize: 24, lineHeight: 30, color: USED_GREEN, ...FONTS.bold, letterSpacing: 1 },
  usedTime: { fontSize: 15, color: COLORS.textMain, ...FONTS.semibold, fontVariant: ['tabular-nums'] },
  usedNote: { fontSize: 12.5, lineHeight: 18, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center' },

  // receipt note + detail
  noteBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: 'rgba(18,181,165,0.07)', borderWidth: 1, borderColor: 'rgba(18,181,165,0.30)' },
  noteIcon: { marginTop: 1 },
  noteText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: COLORS.textMain, ...FONTS.medium },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, marginTop: SPACING.md },
  cardTitle: { ...TYPE.headline, color: COLORS.textMain, marginBottom: SPACING.xs },
  rowDivider: { borderTopWidth: 1, borderTopColor: COLORS.hairline },
  lineRow: { paddingVertical: 10, gap: 4, alignItems: 'flex-start' },
  lineTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: SPACING.sm + 4, alignSelf: 'stretch' },
  lineLabel: { flex: 1, fontSize: 13.5, lineHeight: 18, color: COLORS.textMain, ...FONTS.semibold },
  lineAmount: { fontSize: 14.5, color: COLORS.textMain, ...FONTS.bold, fontVariant: ['tabular-nums'] },
  lineMerchant: { fontSize: 12, lineHeight: 17, color: COLORS.textMuted, ...FONTS.regular },
  totalRow: { paddingTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalLabel: { fontSize: 14, color: COLORS.textMuted, ...FONTS.semibold },
  totalAmount: { fontSize: 22, lineHeight: 28, color: COLORS.textMain, ...FONTS.bold, fontVariant: ['tabular-nums'] },
  idLine: { marginTop: SPACING.md, fontSize: 11, color: COLORS.textFaint, fontFamily: MONO, textAlign: 'center' },

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
