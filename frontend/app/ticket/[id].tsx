// /ticket/[id] — one FREE event ticket with its LIVE credential.
//
// The wire AMOTKT1.<ticketId>.<counter>.<token> rotates every 10 s SERVER-side (PALCO1 scheme: a screenshot dies in
// <= 20 s). useQrFeed (tickets.ts) polls GET /tickets/{id}/qr — first fetch immediately, then each next one timed to
// land just after the rotation (expires_in_ms + 150, latency-compensated) — and this screen draws the wire with
// react-native-qrcode-svg (ECL Q). The countdown bar is synced to expires_in_ms on every answer.
//
// Honesty: a code past its deadline that could not be refreshed is HIDDEN behind an overlay (never left looking
// live); a used ticket shows UTILIZADA instead of a QR; load / missing / signed-out / offline each have their own
// state. Nothing here knows a price: a ticket is a free registration.
//
// The identity stamp (AMO LIFE · ticket id) lives in the QR panel's quiet-zone bands, never over the modules: this is
// scanned at a real door, so no glyph may touch the code.
//
// Polling lifecycle: only while the screen is focused and the app is active; all timers are cleared on blur /
// unmount. The clock-derived countdown only starts after `mounted` flips in an effect, so the static-export HTML and
// the first client render are identical (React #418). All hooks sit above the JSX; there is no early return.
import React, {
  useCallback, useEffect, useState,
} from 'react';
import {
  ActivityIndicator, AppState, LayoutChangeEvent, Linking, Platform, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import Head from '../../src/components/WebHead';
import { Skeleton } from '../../src/components/Skeleton';
import {
  formatCartagenaStamp, getTicket, getTicketWalletUrls, isAuthError, isNotFound, isUpcomingTicket, ticketHref,
  ticketsErrorMessage, useQrCountdown, useQrFeed,
} from '../../src/components/tickets/tickets';
import { Alert } from '../../src/lib/alert';
import type { QrFrame, Ticket } from '../../src/components/tickets/tickets';
import { COLORS, FONTS, RADIUS, SPACING, TYPE } from '../../src/constants/theme';
import { useAuth } from '../../src/context/AuthContext';
import { useLang } from '../../src/context/LanguageContext';
import { useTr } from '../../src/i18n/autoTr';
import { formatShortDate } from '../../src/lib/formatDate';
import { goBackOr } from '../../src/lib/nav';

type Phase = 'loading' | 'ready' | 'missing' | 'error';
type IconName = React.ComponentProps<typeof Ionicons>['name'];

const QR_INK = '#0B1020';
const QR_PAPER = '#FFFFFF';
const QR_MIN = 160;
const QR_MAX = 230;
// 28 px of white around the modules = 4 modules of quiet zone (the QR spec's minimum) at the largest size: 230 px over
// 33 modules is ~7 px each. A dark card edge right next to the panel must never be able to confuse a door scanner's
// finder-pattern search. Smaller phones draw a smaller QR, so the same 28 px is then even more modules.
const QR_PAD = 28;
const AMBER = '#F59E0B';
const MONO = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
});
const noop = (): void => undefined;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Apple Wallet exists on iPhone / iPad / Mac only. Called from an effect, never at render (React #418). */
function detectAppleDevice(): boolean {
  if (Platform.OS === 'ios') return true;
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  return /iPhone|iPad|Macintosh/i.test(navigator.userAgent || '');
}

/** One companion action under the QR card: Wallet / calendar / share. */
function ActionBtn({
  icon, label, onPress, busy, testID,
}: { icon: IconName; label: string; onPress: () => void; busy?: boolean; testID: string }) {
  return (
    <TouchableOpacity
      style={s.actionBtn}
      onPress={onPress}
      disabled={!!busy}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: !!busy }}
      testID={testID}
    >
      {busy ? (
        <ActivityIndicator size="small" color={COLORS.primary} />
      ) : (
        <Ionicons name={icon} size={18} color={COLORS.primary} />
      )}
      <Text style={s.actionBtnText} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

/** A route param that expo-router may hand over as string | string[] | undefined. */
function firstParam(v: string | string[] | undefined): string {
  const first = Array.isArray(v) ? v[0] : v;
  return typeof first === 'string' ? first : '';
}

// ── Chrome ───────────────────────────────────────────────────────────────────
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
// Memoised: the countdown re-renders QrPanel ~10×/s, the QR must not. ecl Q: a quarter of the code is redundancy.
// onError is a no-op so a renderer failure blanks the panel instead of throwing through the root error boundary; the
// wire is a ~45-char ASCII string, far inside QR capacity.
const QrCode = React.memo(function QrCode({ wire, size }: { wire: string; size: number }) {
  return <QRCode value={wire} size={size} color={QR_INK} backgroundColor={QR_PAPER} ecl="Q" onError={noop} />;
});

function QrPanel({
  frame, failed, size, active, stamp, onRetry,
}: { frame: QrFrame; failed: boolean; size: number; active: boolean; stamp: string; onRetry: () => void }) {
  const tr = useTr();
  const { frac, secs, warn, stale } = useQrCountdown(frame, active);
  const panel = size + QR_PAD * 2;
  const pct = Math.round(frac * 1000) / 10;
  const secsText = secs === null ? '—' : `${secs} s`;

  let caption: string;
  if (stale) caption = failed ? tr('Sin conexión') : tr('Renovando…');
  else if (secs === null) caption = '—';
  else caption = `${tr('Se renueva en')} ${secs} s`;

  return (
    <View style={s.qrWrap}>
      <View
        style={[s.qrPanel, { width: panel, height: panel }]}
        accessible
        accessibilityLabel={tr('Código QR de tu entrada')}
        testID="ticket-qr"
      >
        <Text
          style={[s.stamp, s.stampTop]}
          numberOfLines={1}
          allowFontScaling={false}
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {`AMO LIFE · ${tr('Entrada').toUpperCase()}`}
        </Text>
        <QrCode wire={frame.wire} size={size} />
        <Text
          style={[s.stamp, s.stampBottom, { fontFamily: MONO }]}
          numberOfLines={1}
          allowFontScaling={false}
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {stamp}
        </Text>
        {stale && (
          <View style={s.staleOverlay} testID="ticket-qr-stale" accessibilityRole="alert">
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

      <View
        style={[s.barTrack, { width: panel }]}
        accessibilityRole="progressbar"
        accessibilityLabel={tr('Tiempo restante del código')}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(frac * 100), text: secsText }}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(frac * 100)}
        aria-valuetext={secsText}
        testID="ticket-countdown"
      >
        <View style={[s.barFill, warn && s.barFillWarn, { width: `${pct}%` }]} />
      </View>
      <Text style={[s.barCaption, warn && !stale && s.barCaptionWarn]} testID="ticket-countdown-text">{caption}</Text>
    </View>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────
export default function TicketScreen() {
  const tr = useTr();
  const { lang } = useLang();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = firstParam(params.id);
  const { user, isLoading } = useAuth();
  const userId = user ? user.user_id : null;

  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>('loading');
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [authLost, setAuthLost] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [cardWidth, setCardWidth] = useState(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  // A different ticket (deep-link reuse) or a different account starts from scratch.
  useEffect(() => {
    setPhase('loading');
    setTicket(null);
    setLoadError(null);
    setAuthLost(false);
  }, [id, userId]);

  // The ticket itself (title, venue, date, status). Re-runs via reloadKey: retry, the credential reporting "used"
  // (to pick up used_at), or the app coming back to the foreground. A silent re-run never drops the screen back to a
  // skeleton, and a transient failure never replaces a ticket that is already on screen.
  useEffect(() => {
    if (!userId || !id) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const t = await getTicket(id);
        if (cancelled) return;
        setTicket(t);
        setLoadError(null);
        setPhase('ready');
      } catch (e) {
        if (cancelled) return;
        console.error('[Ticket] load', e);
        if (isAuthError(e)) {
          setAuthLost(true);
          return;
        }
        if (isNotFound(e)) {
          setPhase('missing');
          return;
        }
        setLoadError(e);
        setPhase((p) => (p === 'ready' ? p : 'error'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, id, reloadKey]);

  // The rotating credential polls only while the ticket is loaded and still issued. useQrFeed also owns focus,
  // AppState pause/resume and every timer.
  const live = phase === 'ready' && ticket !== null && ticket.status === 'issued';
  const feed = useQrFeed(live ? { kind: 'ticket', id } : null);

  useEffect(() => {
    if (feed.used) setReloadKey((k) => k + 1);
  }, [feed.used]);

  // Coming back to the foreground: re-read the ticket too (the credential poll refreshes itself).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (status) => {
      if (status === 'active') setReloadKey((k) => k + 1);
    });
    return () => sub?.remove();
  }, []);

  const goBack = useCallback(() => goBackOr(router, '/tickets'), [router]);
  const goTickets = useCallback(() => router.push('/tickets'), [router]);
  const goLogin = useCallback(() => router.push(`/login?next=${ticketHref(id)}`), [router, id]);
  const goEvent = useCallback(() => {
    if (ticket && ticket.event_id) router.push(`/partner-event/${encodeURIComponent(ticket.event_id)}`);
  }, [router, ticket]);
  const retryTicket = useCallback(() => {
    setPhase('loading');
    setLoadError(null);
    setReloadKey((k) => k + 1);
  }, []);
  const onCardLayout = useCallback((e: LayoutChangeEvent) => {
    setCardWidth(Math.round(e.nativeEvent.layout.width));
  }, []);

  // ── Companion actions (WALLET-DIGNITY, audit #4). The rotating QR above stays the ONLY
  // door credential; the Wallet pass / .ics are conveniences minted as short-lived signed
  // URLs by the holder's session (passkit.py). Device detection runs in an effect (#418).
  const [appleDevice, setAppleDevice] = useState(false);
  const [actionBusy, setActionBusy] = useState<null | 'pass' | 'ics'>(null);
  useEffect(() => {
    setAppleDevice(detectAppleDevice());
  }, []);

  const openWalletUrl = useCallback(async (kind: 'pass' | 'ics') => {
    if (!ticket || actionBusy) return;
    setActionBusy(kind);
    try {
      const urls = await getTicketWalletUrls(ticket.ticket_id);
      const url = kind === 'pass' ? urls.pass_url : urls.ics_url;
      if (!url) {
        Alert.alert(tr('No disponible por ahora'), tr('Inténtalo de nuevo más tarde.'));
        return;
      }
      if (Platform.OS === 'web') window.location.assign(url);
      else await Linking.openURL(url);
    } catch (e) {
      console.error('[Ticket] wallet url', e);
      Alert.alert(tr('No pudimos generar el enlace'), ticketsErrorMessage(e, lang, tr));
    } finally {
      setActionBusy(null);
    }
  }, [ticket, actionBusy, tr, lang]);

  const addToAppleWallet = useCallback(() => void openWalletUrl('pass'), [openWalletUrl]);
  const addToCalendar = useCallback(() => void openWalletUrl('ics'), [openWalletUrl]);

  const shareEvent = useCallback(async () => {
    if (!ticket || !ticket.event_id) return;
    const url = `https://www.amocartagena.co/partner-event/${encodeURIComponent(ticket.event_id)}`;
    const message = `${ticket.title || 'Evento AMO'} — ${url}`;
    try {
      await Share.share(Platform.OS === 'ios' ? { message, url } : { message });
    } catch {
      // Web without navigator.share: copy the link instead of failing silently.
      try {
        if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(url);
          Alert.alert(tr('Enlace copiado'));
        }
      } catch {
        // clipboard blocked: nothing honest left to do
      }
    }
  }, [ticket, tr]);

  const goMoreEvents = useCallback(() => router.push('/que-pasa'), [router]);

  // ── All hooks are above this line; the JSX below branches but never returns early. ──
  const used = (ticket !== null && ticket.status === 'used') || feed.used;
  const needLogin = (!isLoading && !userId) || authLost || feed.authLost;
  const qrSize = clamp((cardWidth > 0 ? cardWidth : 320) - SPACING.md * 2 - QR_PAD * 2, QR_MIN, QR_MAX);

  let body: React.ReactNode;
  if (needLogin) {
    body = (
      <StateCard
        icon="lock-closed-outline"
        title={tr('Inicia sesión para ver tu entrada')}
        text={tr('Tu entrada está ligada a tu cuenta.')}
        actionLabel={tr('Iniciar sesión')}
        onAction={goLogin}
        testID="ticket-session-required"
      />
    );
  } else if (phase === 'missing' || feed.missing) {
    body = (
      <StateCard
        icon="search-outline"
        title={tr('Esta entrada no existe')}
        text={tr('El enlace no es correcto o la entrada pertenece a otra cuenta.')}
        actionLabel={tr('Ver mis entradas')}
        onAction={goTickets}
        testID="ticket-missing"
      />
    );
  } else if (phase === 'error') {
    body = (
      <StateCard
        icon="cloud-offline-outline"
        title={tr('No pudimos cargar tu entrada')}
        text={ticketsErrorMessage(loadError, lang, tr)}
        actionLabel={tr('Reintentar')}
        onAction={retryTicket}
        testID="ticket-error"
      />
    );
  } else if (phase !== 'ready' || !ticket) {
    body = (
      <View style={s.skeletons} testID="ticket-skeleton">
        <Skeleton height={26} width="40%" borderRadius={RADIUS.sm} />
        <Skeleton height={34} width="75%" borderRadius={RADIUS.sm} style={s.skelGap} />
        <Skeleton height={18} width="55%" borderRadius={RADIUS.sm} style={s.skelGap} />
        <Skeleton height={QR_MAX + QR_PAD * 2 + 90} borderRadius={RADIUS.xl} style={s.skelGap} />
      </View>
    );
  } else {
    const venue = ticket.venue_name || ticket.partner_name;
    const when = [formatShortDate(ticket.date, lang), ticket.start_time].filter((p) => !!p).join(' · ');
    const usedAt = ticket.used_at
      ? `${formatCartagenaStamp(ticket.used_at, lang)} · ${tr('hora de Cartagena')}`
      : '—';
    body = (
      <>
        <View style={s.hero} testID="ticket-hero">
          <View style={s.chipRow}>
            <View style={s.kindChip}>
              <Ionicons name="ticket-outline" size={12} color={COLORS.primary} />
              <Text style={s.kindChipText}>{tr('Entrada')}</Text>
            </View>
            <View style={[s.statusChip, used ? s.statusChipUsed : s.statusChipLive]} testID="ticket-status">
              <Text style={[s.statusChipText, used ? s.statusTextUsed : s.statusTextLive]}>
                {used ? tr('Utilizada') : tr('Activa')}
              </Text>
            </View>
          </View>
          <Text style={s.title} accessibilityRole="header" testID="ticket-title">
            {ticket.title || tr('Entrada')}
          </Text>
          {!!venue && (
            <View style={s.metaRow} testID="ticket-venue">
              <Ionicons name="location-outline" size={15} color={COLORS.icon} />
              <Text style={s.metaText}>{venue}</Text>
            </View>
          )}
          {!!when && (
            <View style={s.metaRow} testID="ticket-when">
              <Ionicons name="calendar-outline" size={15} color={COLORS.icon} />
              <Text style={s.metaText}>{when}</Text>
            </View>
          )}
          <View style={s.holderChip} testID="ticket-holder">
            <Ionicons name="people-outline" size={14} color={COLORS.primary} />
            <Text style={s.holderChipText}>{tr('Entrada gratuita · 1 persona')}</Text>
          </View>
        </View>

        <View style={s.qrCard} onLayout={onCardLayout} accessibilityLiveRegion="polite" testID="ticket-qr-card">
          <View style={s.qrHead}>
            <Ionicons name={used ? 'checkmark-circle-outline' : 'qr-code-outline'} size={16} color={COLORS.icon} />
            <Text style={s.qrHeadTitle}>{tr('Tu código de acceso')}</Text>
          </View>

          {used ? (
            <View style={s.usedPanel} testID="ticket-used">
              <Ionicons name="checkmark-circle" size={58} color={COLORS.primary} />
              <Text style={s.usedTitle}>{tr('Utilizada').toUpperCase()}</Text>
              <Text style={s.usedTime} testID="ticket-used-at">{usedAt}</Text>
              <Text style={s.usedNote}>
                {tr('Esta entrada ya fue validada en la puerta. El código ya no sirve.')}
              </Text>
            </View>
          ) : feed.frame ? (
            <QrPanel
              frame={feed.frame}
              failed={feed.failed}
              size={qrSize}
              active={mounted && feed.focused}
              stamp={ticket.ticket_id}
              onRetry={feed.refresh}
            />
          ) : (
            <View style={s.qrPending} testID="ticket-qr-pending">
              {feed.failed ? (
                <>
                  <Ionicons name="cloud-offline-outline" size={28} color={COLORS.textMuted} />
                  <Text style={s.pendingText}>{tr('No pudimos obtener el código.')}</Text>
                  <TouchableOpacity style={s.retryBtn} onPress={feed.refresh} accessibilityRole="button" accessibilityLabel={tr('Reintentar')}>
                    <Text style={s.retryBtnText}>{tr('Reintentar')}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <Skeleton width={qrSize + QR_PAD * 2} height={qrSize + QR_PAD * 2} borderRadius={RADIUS.lg} />
              )}
            </View>
          )}

          {!used && (
            <Text style={s.rotateNote} testID="ticket-rotate-note">
              {tr('El código rota cada 10 s — una captura muere en segundos')}
            </Text>
          )}
        </View>

        {/* Companion actions for a ticket that is still ahead: Apple Wallet (Apple devices),
            calendar (.ics, any phone) and sharing the event. A past/used ticket gets the
            post-event row instead — never a dead "Añadir a mi día" for a finished night. */}
        {isUpcomingTicket(ticket) && !used ? (
          <>
            <View style={s.actionsRow} testID="ticket-actions">
              {appleDevice && (
                <ActionBtn
                  icon="wallet-outline"
                  label={tr('Apple Wallet')}
                  onPress={addToAppleWallet}
                  busy={actionBusy === 'pass'}
                  testID="ticket-add-wallet"
                />
              )}
              {!!ticket.date && (
                <ActionBtn
                  icon="calendar-number-outline"
                  label={tr('Calendario')}
                  onPress={addToCalendar}
                  busy={actionBusy === 'ics'}
                  testID="ticket-add-calendar"
                />
              )}
              {!!ticket.event_id && (
                <ActionBtn icon="share-outline" label={tr('Compartir')} onPress={shareEvent} testID="ticket-share" />
              )}
            </View>
            {!!ticket.event_id && (
              <TouchableOpacity
                style={s.linkRow}
                onPress={goEvent}
                activeOpacity={0.85}
                accessibilityRole="link"
                accessibilityLabel={tr('Añadir a mi día')}
                testID="ticket-add-to-day"
              >
                <View style={s.linkIcon}>
                  <Ionicons name="calendar-outline" size={17} color={COLORS.official} />
                </View>
                <View style={s.linkBody}>
                  <Text style={s.linkLabel}>{tr('Añadir a mi día')}</Text>
                  <Text style={s.linkCaption}>{tr('Ver el evento y guardarlo en tu agenda')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
              </TouchableOpacity>
            )}
          </>
        ) : (
          <>
            {!!ticket.event_id && (
              <TouchableOpacity
                style={s.linkRow}
                onPress={goEvent}
                activeOpacity={0.85}
                accessibilityRole="link"
                accessibilityLabel={tr('Ver el evento')}
                testID="ticket-view-event"
              >
                <View style={s.linkIcon}>
                  <Ionicons name="time-outline" size={17} color={COLORS.official} />
                </View>
                <View style={s.linkBody}>
                  <Text style={s.linkLabel}>{tr('Ver el evento')}</Text>
                  <Text style={s.linkCaption}>{tr('Así estuvo la noche')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={s.linkRow}
              onPress={goMoreEvents}
              activeOpacity={0.85}
              accessibilityRole="link"
              accessibilityLabel={tr('Descubre más eventos')}
              testID="ticket-post-event"
            >
              <View style={s.linkIcon}>
                <Ionicons name="sparkles-outline" size={17} color={COLORS.official} />
              </View>
              <View style={s.linkBody}>
                <Text style={s.linkLabel}>{tr('Descubre más eventos')}</Text>
                <Text style={s.linkCaption}>{tr('Lo que viene esta semana en Cartagena')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
            </TouchableOpacity>
          </>
        )}

        <Text style={s.idLine} selectable testID="ticket-id">
          {tr('Entrada')} · {ticket.ticket_id}
        </Text>
      </>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="ticket-screen">
      <Head>
        <title>{`${tr('Mi entrada')} · AMO Life`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <View style={s.headerBar}>
        <View style={s.headerInner}>
          <TouchableOpacity
            style={s.backBtn}
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel={tr('Volver')}
            testID="ticket-back-btn"
          >
            <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
          </TouchableOpacity>
          <Text style={s.headerLabel} numberOfLines={1}>{tr('Mi entrada')}</Text>
        </View>
      </View>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={s.content}>{body}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },

  // header (pinned)
  headerBar: { borderBottomWidth: 1, borderBottomColor: COLORS.hairline, backgroundColor: COLORS.background },
  headerInner: { width: '100%', maxWidth: 560, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm + 4 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.hairline, alignItems: 'center', justifyContent: 'center' },
  headerLabel: { flex: 1, fontSize: 14, color: COLORS.textMuted, ...FONTS.semibold },

  // hero
  hero: { paddingTop: SPACING.lg, gap: 8, alignItems: 'flex-start' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  kindChip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4, borderColor: 'rgba(18,181,165,0.40)', backgroundColor: 'rgba(18,181,165,0.10)' },
  kindChipText: { fontSize: 11, color: COLORS.primary, ...FONTS.bold, letterSpacing: 0.4 },
  statusChip: { borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4 },
  statusChipLive: { borderColor: 'rgba(18,181,165,0.45)', backgroundColor: 'rgba(18,181,165,0.14)' },
  statusChipUsed: { borderColor: COLORS.hairline, backgroundColor: 'rgba(255,255,255,0.06)' },
  statusChipText: { fontSize: 11, ...FONTS.bold, letterSpacing: 0.6, textTransform: 'uppercase' },
  statusTextLive: { color: COLORS.primary },
  statusTextUsed: { color: COLORS.textMuted },
  title: { ...TYPE.title1, color: COLORS.textMain },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  metaText: { flexShrink: 1, fontSize: 14, lineHeight: 20, color: COLORS.textMuted, ...FONTS.medium },
  holderChip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, marginTop: 2, borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 5, borderColor: 'rgba(18,181,165,0.30)', backgroundColor: 'rgba(18,181,165,0.08)' },
  holderChipText: { fontSize: 12.5, color: COLORS.textMain, ...FONTS.semibold },

  // QR card
  qrCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, padding: SPACING.md, borderWidth: 1, borderColor: 'rgba(18,181,165,0.30)', marginTop: SPACING.lg, gap: SPACING.sm + 4 },
  qrHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qrHeadTitle: { ...TYPE.headline, color: COLORS.textMain, flex: 1 },
  qrWrap: { alignItems: 'center', gap: 10 },
  qrPanel: { backgroundColor: QR_PAPER, borderRadius: RADIUS.lg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  qrPending: { minHeight: 200, alignItems: 'center', justifyContent: 'center', gap: 10 },
  pendingText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center' },
  stamp: { position: 'absolute', left: 0, right: 0, textAlign: 'center', fontSize: 9, lineHeight: 12, letterSpacing: 2, color: 'rgba(11,16,32,0.42)', ...FONTS.bold },
  stampTop: { top: 6 },
  stampBottom: { bottom: 6 },
  staleOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.96)', alignItems: 'center', justifyContent: 'center', gap: 10, padding: SPACING.md },
  staleTitle: { fontSize: 13, lineHeight: 18, color: '#1F2937', ...FONTS.semibold, textAlign: 'center' },
  retryBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, paddingHorizontal: SPACING.lg, borderRadius: RADIUS.full },
  retryBtnText: { fontSize: 13.5, color: COLORS.black, ...FONTS.bold },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.10)', overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: COLORS.primary },
  barFillWarn: { backgroundColor: AMBER },
  barCaption: { fontSize: 12.5, color: COLORS.textMuted, ...FONTS.semibold, fontVariant: ['tabular-nums'] },
  barCaptionWarn: { color: AMBER },
  rotateNote: { fontSize: 12, lineHeight: 17, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center' },

  // used state (teal: the ticket did its job)
  usedPanel: { alignItems: 'center', gap: 8, paddingVertical: SPACING.lg, paddingHorizontal: SPACING.md, borderRadius: RADIUS.lg, backgroundColor: 'rgba(18,181,165,0.08)', borderWidth: 1, borderColor: 'rgba(18,181,165,0.35)' },
  usedTitle: { fontSize: 24, lineHeight: 30, color: COLORS.primary, ...FONTS.bold, letterSpacing: 1 },
  usedTime: { fontSize: 15, color: COLORS.textMain, ...FONTS.semibold, fontVariant: ['tabular-nums'], textAlign: 'center' },
  usedNote: { fontSize: 12.5, lineHeight: 18, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center' },

  // companion actions (Wallet / calendar / share)
  actionsRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 48, paddingHorizontal: SPACING.sm, borderRadius: RADIUS.lg, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: 'rgba(18,181,165,0.30)' },
  actionBtnText: { flexShrink: 1, fontSize: 12.5, color: COLORS.textMain, ...FONTS.semibold },

  // secondary row
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm + 4, minHeight: 56, paddingHorizontal: SPACING.md, paddingVertical: 10, marginTop: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(57,184,255,0.22)' },
  linkIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(57,184,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  linkBody: { flex: 1, gap: 1 },
  linkLabel: { fontSize: 14, lineHeight: 19, color: COLORS.textMain, ...FONTS.semibold },
  linkCaption: { fontSize: 11.5, lineHeight: 15, color: COLORS.textFaint, ...FONTS.medium },
  idLine: { marginTop: SPACING.md, fontSize: 11, color: COLORS.textFaint, fontFamily: MONO, textAlign: 'center' },

  // states
  skeletons: { marginTop: SPACING.lg },
  skelGap: { marginTop: SPACING.md },
  stateCard: { alignItems: 'center', gap: 10, marginTop: SPACING.lg, padding: SPACING.lg, borderRadius: RADIUS.xl, backgroundColor: COLORS.surface, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.border },
  stateTitle: { ...TYPE.title3, color: COLORS.textMain, textAlign: 'center' },
  stateText: { ...TYPE.subhead, color: COLORS.textMuted, textAlign: 'center' },
  primaryBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, paddingHorizontal: SPACING.xl, paddingVertical: 12, borderRadius: RADIUS.full, marginTop: SPACING.xs },
  primaryBtnText: { fontSize: 14, color: COLORS.black, ...FONTS.bold },
});
