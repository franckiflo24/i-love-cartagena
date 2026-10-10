// Consumer TICKETS client — free RSVP tickets with a PALCO-grade rotating QR, and the City Pass credential that
// rides the same engine. Typed wrappers for /api/tickets/* and /api/city-pass/qr (backend: backend/tickets.py)
// plus the rotating-credential machinery the ticket screen and the City Pass tab share.
//
// Tickets are FREE registrations (RSVP). Nothing in this module knows a price, a checkout or a payment.
//
// Transport is a direct authenticated fetch (fetchT + getToken from constants/api), deliberately NOT api.get / api.post:
//   1. api.get files every successful GET in the swr cache (memory AND AsyncStorage) and answers a failed one from it.
//      /tickets/* and /city-pass/qr are in neither PRIVATE_PATH nor NO_CACHE_PATH (lib/swrCache.ts), so a rotating
//      wire would be persisted to disk and, the moment the network drops, a DEAD code would be replayed with a
//      fresh-looking countdown; the wallet list would also sit under one shared, unscoped key that outlives a logout.
//   2. api.post turns an object `detail` ({error, message}) into "[object Object]", which throws away the server's
//      own message (event not available, ...).
// civic.ts made the same call for the same reasons. The Bearer is the same user session token api.* attaches.
//
// Every response is parsed defensively (no `as` casts on network data): an unexpected body becomes a TicketsError the
// screen renders as an honest error state, never a crash and never a guessed ticket.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  AMO_CLIENT_HEADERS, API_BASE, GET_TIMEOUT_MS, WRITE_TIMEOUT_MS, fetchT, getToken,
} from '../../constants/api';
import type { Lang } from '../../i18n/translations';
import { monthShort } from '../../lib/formatDate';

export type Translate = (es: string | null | undefined) => string;

// ── Types (the backend contract, verbatim) ───────────────────────────────────
export type TicketStatus = 'issued' | 'used';

export interface Ticket {
  /** "amt_" + 10 hex. */
  ticket_id: string;
  kind: 'event_rsvp';
  event_id: string;
  title: string;
  venue_name: string;
  partner_id: string;
  partner_name: string;
  /** "YYYY-MM-DD", or "" when the event published none. */
  date: string;
  /** As the venue published it ("21:00"), or "". */
  start_time: string;
  status: TicketStatus;
  /** ISO instant (UTC) the ticket was scanned at the gate; null while issued. */
  used_at: string | null;
  created_at: string;
}

export interface RsvpResult {
  ticket: Ticket;
  /** The user already held a ticket for this event: same ticket, not a new one. Treat as success. */
  already: boolean;
}

/** The rotating credential. `status` rides tickets only; the City Pass answer carries plan_id / expires_at instead. */
export interface QrPayload {
  /** "AMOTKT1.…" / "AMOPASS1.…" — drawn as the QR, never parsed here. */
  wire: string;
  step_ms: number;
  expires_in_ms: number;
  status?: TicketStatus;
}
export interface TicketQrPayload extends QrPayload { status: TicketStatus }
export interface CityPassQrPayload extends QrPayload { plan_id: string; expires_at: string | null }

// ── Errors ───────────────────────────────────────────────────────────────────
/**
 * Anything that goes wrong talking to the tickets API. `status` is the HTTP status; 0 means the request never
 * produced a usable answer (code "network": offline / timeout; "bad_body" / "bad_shape": unreadable or unexpected).
 */
export class TicketsError extends Error {
  readonly isTicketsError = true as const;
  readonly status: number;
  /** detail.error when the server sent one ("not_available", "not_found", "no_pass", ...). */
  readonly code: string | null;
  /** detail.message, or a string `detail`. Bilingual "Español / English" for this API's own errors. */
  readonly serverMessage: string | null;

  constructor(status: number, serverMessage: string | null, code: string | null) {
    super(serverMessage ?? code ?? `tickets request failed (${status})`);
    Object.setPrototypeOf(this, TicketsError.prototype);
    this.name = 'TicketsError';
    this.status = status;
    this.code = code;
    this.serverMessage = serverMessage;
  }
}

/** Duck-typed so it survives a class identity split across bundles / transpilers. */
export function isTicketsError(e: unknown): e is TicketsError {
  return typeof e === 'object' && e !== null && (e as { isTicketsError?: unknown }).isTicketsError === true;
}

/** 401 / 403: not signed in, or the session expired. */
export function isAuthError(e: unknown): boolean {
  return isTicketsError(e) && (e.status === 401 || e.status === 403);
}

/** 404: the ticket / event / pass does not exist for this account. */
export function isNotFound(e: unknown): boolean {
  return isTicketsError(e) && e.status === 404;
}

/** This API's own errors are "Español / English" in one string. Split and pick; anything else → null. */
export function bilingualMessage(message: string, lang: Lang): string | null {
  const parts = message.split(' / ');
  if (parts.length !== 2) return null;
  const es = parts[0].trim();
  const en = parts[1].trim();
  if (!es || !en) return null;
  return lang === 'es' ? es : en;
}

/**
 * The text a screen shows for a failed call: the server's own bilingual message when it sent one, otherwise an honest
 * message for the failure class. `notFound` lets a screen say what a 404 means in ITS context.
 */
export function ticketsErrorMessage(e: unknown, lang: Lang, tr: Translate, notFound?: string): string {
  if (isTicketsError(e)) {
    if (e.status === 404 && notFound) return notFound;
    const fromServer = e.serverMessage ? bilingualMessage(e.serverMessage, lang) : null;
    if (fromServer) return fromServer;
    if (e.status === 401 || e.status === 403) return tr('Tu sesión expiró. Vuelve a iniciar sesión.');
    if (e.status === 404) return tr('No encontramos lo que buscas.');
    if (e.status === 409) return tr('Este evento ya no tiene cupo disponible.');
    if (e.status === 429) return tr('Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.');
    if (e.status >= 500) return tr('Algo falló de nuestro lado. Inténtalo de nuevo en un momento.');
    if (e.status === 0 && e.code === 'network') return tr('Sin conexión. Revisa tu internet e inténtalo de nuevo.');
  }
  return tr('Algo salió mal. Inténtalo de nuevo.');
}

// ── Defensive parsing ────────────────────────────────────────────────────────
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const asStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const asNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const shapeError = (): TicketsError => new TicketsError(0, null, 'bad_shape');

/** Server step when the answer omits or garbles step_ms (the contract says 10000). */
export const DEFAULT_STEP_MS = 10000;

function normTicket(raw: unknown): Ticket | null {
  if (!isRec(raw)) return null;
  const id = asStr(raw.ticket_id);
  const status: TicketStatus | null = raw.status === 'issued' || raw.status === 'used' ? raw.status : null;
  // A kind or status outside the v1 contract is unreadable, not "probably fine": never draw a live code for it.
  if (!id || status === null || raw.kind !== 'event_rsvp') return null;
  return {
    ticket_id: id,
    kind: 'event_rsvp',
    event_id: asStr(raw.event_id) ?? '',
    title: asStr(raw.title) ?? '',
    venue_name: asStr(raw.venue_name) ?? '',
    partner_id: asStr(raw.partner_id) ?? '',
    partner_name: asStr(raw.partner_name) ?? '',
    date: asStr(raw.date) ?? '',
    start_time: asStr(raw.start_time) ?? '',
    status,
    used_at: asStr(raw.used_at),
    created_at: asStr(raw.created_at) ?? '',
  };
}

function normQrBase(body: unknown): QrPayload {
  if (!isRec(body)) throw shapeError();
  const wire = asStr(body.wire);
  const expires = asNum(body.expires_in_ms);
  const step = asNum(body.step_ms);
  if (!wire || wire.length < 8 || expires === null) throw shapeError();
  // civic.ts normQr's clamps, ported verbatim so the twins agree: step bounded to a sane band and
  // expires_in_ms clamped to [0, step] — a garbled server value can never park the next poll for an
  // hour while a dead code sits on screen under a live-looking countdown.
  const stepMs = step !== null && step >= 1000 && step <= 60000 ? step : DEFAULT_STEP_MS;
  return { wire, step_ms: stepMs, expires_in_ms: Math.min(Math.max(expires, 0), stepMs) };
}

function normTicketQr(body: unknown): TicketQrPayload {
  const base = normQrBase(body);
  const status: TicketStatus | null = isRec(body) && (body.status === 'issued' || body.status === 'used') ? body.status : null;
  if (status === null) throw shapeError();
  return { ...base, status };
}

function normPassQr(body: unknown): CityPassQrPayload {
  const base = normQrBase(body);
  const rec: Rec = isRec(body) ? body : {};
  return { ...base, plan_id: asStr(rec.plan_id) ?? '', expires_at: asStr(rec.expires_at) };
}

// ── Transport ────────────────────────────────────────────────────────────────
function readDetail(body: unknown): { code: string | null; message: string | null } {
  if (!isRec(body)) return { code: null, message: null };
  const d = body.detail;
  if (typeof d === 'string') return { code: null, message: d };
  if (isRec(d)) return { code: asStr(d.error), message: asStr(d.message) };
  return { code: null, message: null }; // 422 validation arrays etc.: no user-facing text
}

async function ticketsRequest(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest', ...AMO_CLIENT_HEADERS };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = await getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetchT(
      `${API_BASE}${path}`,
      {
        method,
        headers,
        credentials: 'omit', // Bearer only — no cookies, so no credentialed-CORS requirements
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      method === 'GET' ? GET_TIMEOUT_MS : WRITE_TIMEOUT_MS,
    );
  } catch {
    throw new TicketsError(0, null, 'network'); // offline / DNS / TimeoutError
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null; // empty or non-JSON body (e.g. an HTML error page from a proxy)
  }
  if (!res.ok) {
    const d = readDetail(json);
    throw new TicketsError(res.status, d.message, d.code);
  }
  if (json === null) throw new TicketsError(0, null, 'bad_body');
  return json;
}

// ── The API ──────────────────────────────────────────────────────────────────
/** POST /tickets/event-rsvp — free registration. 401 not signed in · 404 {detail:{error,message}} event unknown/not public/past. */
export async function rsvpToEvent(eventId: string): Promise<RsvpResult> {
  const body = await ticketsRequest('POST', '/tickets/event-rsvp', { event_id: eventId });
  if (!isRec(body)) throw shapeError();
  const ticket = normTicket(body.ticket);
  if (!ticket) throw shapeError();
  return { ticket, already: body.already === true };
}

/** GET /tickets/mine — newest first. A row outside the contract is dropped (and logged), never guessed at. */
export async function getMyTickets(): Promise<Ticket[]> {
  const body = await ticketsRequest('GET', '/tickets/mine');
  if (!isRec(body) || !Array.isArray(body.tickets)) throw shapeError();
  const out: Ticket[] = [];
  let dropped = 0;
  for (const raw of body.tickets) {
    const t = normTicket(raw);
    if (t) out.push(t);
    else dropped += 1;
  }
  if (dropped > 0) console.error(`[tickets] dropped ${dropped} unreadable ticket row(s) from /tickets/mine`);
  return out;
}

/** GET /tickets/{id} — owner only; 404 for anyone else. */
export async function getTicket(id: string): Promise<Ticket> {
  const body = await ticketsRequest('GET', `/tickets/${encodeURIComponent(id)}`);
  if (!isRec(body)) throw shapeError();
  const ticket = normTicket(body.ticket);
  if (!ticket) throw shapeError();
  return ticket;
}

/** GET /tickets/{id}/qr — the rotating wire (no-store). Poll it; see planQrTiming. */
export async function getTicketQr(id: string): Promise<TicketQrPayload> {
  return normTicketQr(await ticketsRequest('GET', `/tickets/${encodeURIComponent(id)}/qr`));
}

/** GET /city-pass/qr — the City Pass rotating wire (no-store). 404 when the account has no active pass. */
export async function getCityPassQr(): Promise<CityPassQrPayload> {
  return normPassQr(await ticketsRequest('GET', '/city-pass/qr'));
}

/** In-app route of one ticket. The id is encoded: it comes from the network. */
export const ticketHref = (ticketId: string): string => `/ticket/${encodeURIComponent(ticketId)}`;

// ── Apple Wallet / calendar (passkit.py) ─────────────────────────────────────
export interface WalletUrls {
  /** Signed 15-min URL of the .pkpass — null while the server has no signing identity (hide the button). */
  pass_url: string | null;
  /** Signed 15-min URL of the .ics (any phone). */
  ics_url: string | null;
}

/** GET /tickets/{id}/wallet-url — holder-only mint of short-lived download URLs. */
export async function getTicketWalletUrls(id: string): Promise<WalletUrls> {
  const body = await ticketsRequest('GET', `/tickets/${encodeURIComponent(id)}/wallet-url`);
  if (!isRec(body)) throw shapeError();
  const pass = asStr(body.pass_url);
  const ics = asStr(body.ics_url);
  return {
    pass_url: pass && pass.startsWith('https://') ? pass : null,
    ics_url: ics && ics.startsWith('https://') ? ics : null,
  };
}

/**
 * Whether a ticket belongs in the "Próximas" section: its event date is today or later
 * (Cartagena calendar, fixed UTC-5), or it published no readable date (unknown ≠ past).
 * `used` does not demote it — a scanned ticket for tonight is still tonight's plan.
 */
export function isUpcomingTicket(t: Ticket, nowMs?: number): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t.date);
  if (!m) return true;
  const d = new Date((nowMs ?? Date.now()) - CARTAGENA_UTC_OFFSET_MS);
  const today = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  return `${m[1]}-${m[2]}-${m[3]}` >= today;
}

// ── Formatting ───────────────────────────────────────────────────────────────
// Cartagena is UTC-5 all year (no DST). Fixed-offset arithmetic, not Intl: identical on Hermes, the browser and Node,
// and independent of the phone's own timezone (a visitor's phone may be set anywhere).
const CARTAGENA_UTC_OFFSET_MS = 5 * 60 * 60 * 1000;
const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** "30 Sep · 14:32" in Cartagena time; "—" for a missing / unparseable instant. */
export function formatCartagenaStamp(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms - CARTAGENA_UTC_OFFSET_MS);
  return `${d.getUTCDate()} ${monthShort(d.getUTCMonth(), lang)} · ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** Monotonic milliseconds (immune to wall-clock jumps). Only ever called from effects / handlers. */
export function monoNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  return Date.now();
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// ── Rotating-credential timing (pure, so the poll loop stays testable) ───────
/** Next fetch lands this long after the server-side rotation (the contract: expires_in_ms + 150). */
export const QR_RENEW_SLACK_MS = 150;
/**
 * Random extra delay on each scheduled renewal. Without it every open QR screen fetches in the same
 * ~250 ms window right after the 10 s rotation (planQrTiming aims them all at rotation + 150 ms) — a
 * synchronized stampede on the shared /qr lambdas. The server accepts the previous wire for a full
 * step (±1 counter skew), so spreading the refetch across the next 2 s costs nothing: the code on
 * screen stays scannable the whole time. Mirrors civic.ts.
 */
export const QR_POLL_JITTER_MS = 2000;
/** Never poll faster than this, whatever the server says: the endpoint is rate-limited server-side. */
export const QR_MIN_GAP_MS = 1000;
/**
 * How long a code may sit past its deadline (waiting on the refetch) before the UI hides it. Must
 * comfortably cover QR_POLL_JITTER_MS plus a round trip, or the overlay would flash every rotation.
 */
export const QR_STALE_GRACE_MS = 5000;
/** The countdown turns amber below this. */
export const QR_WARN_MS = 3000;

export interface QrTiming {
  /** Local monotonic instant the shown code rotates out. */
  deadline: number;
  /** Delay (ms) from `recvAt` until the next poll should be SENT. */
  nextDelay: number;
}

/**
 * All instants are on the local monotonic clock. The server computed expires_in_ms somewhere between sentAt and
 * recvAt; assuming the midpoint keeps network latency from pushing the countdown late, and the next request is timed
 * to ARRIVE just after the rotation (expires_in_ms + 150 ms).
 */
export function planQrTiming(sentAt: number, recvAt: number, expiresInMs: number): QrTiming {
  const rtt = Math.max(0, recvAt - sentAt);
  const deadline = recvAt - rtt / 2 + expiresInMs;
  const sendAt = deadline + QR_RENEW_SLACK_MS - rtt / 2;
  return { deadline, nextDelay: Math.max(QR_MIN_GAP_MS, sendAt - recvAt) };
}

/** Retry delay after the Nth consecutive failed poll: 1.5 s, 3 s, 6 s, then 10 s. */
export function qrRetryDelay(failures: number): number {
  const n = Math.max(1, Math.floor(failures));
  return Math.min(10000, 1500 * 2 ** Math.min(n - 1, 3));
}

/** What the QR panel draws: the wire plus the local monotonic instant it rotates out. */
export interface QrFrame {
  wire: string;
  deadline: number;
  stepMs: number;
}

export interface QrPollerDeps {
  /** One GET .../qr, already bound to the ticket id (or the pass). */
  fetchQr: () => Promise<QrPayload>;
  /** Monotonic clock (monoNow in the app). */
  now: () => number;
  onFrame: (frame: QrFrame) => void;
  /** The credential was used: polling ends. */
  onUsed: () => void;
  /** A transient failure: polling continues by itself with backoff. `failures` counts consecutive ones. */
  onFail: (failures: number, error: unknown) => void;
  /** 404: the ticket / pass is gone, polling ends. */
  onMissing: (error: TicketsError) => void;
  /** 401 / 403: the session is gone, polling ends. */
  onAuth: (error: TicketsError) => void;
  /** Injectable timers for tests; defaults to the globals. */
  timers?: { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
}

export interface QrPoller {
  /** Fetch now, then keep polling on the planQrTiming schedule. */
  start: () => void;
  /** Resume after a pause, or retry by hand: drop the pending timer and fetch now. */
  refresh: () => void;
  /** App backgrounded: schedule nothing further (an in-flight answer is still applied). */
  pause: () => void;
  /** End for good; any in-flight answer is dropped and no timer survives. */
  stop: () => void;
}

/**
 * The rotating-credential poll loop, free of React so its concurrency rules are testable:
 *   • every request carries a generation — a newer request supersedes an older one, whose late answer is dropped,
 *     so a slow response can never overwrite a fresher code;
 *   • success re-schedules from planQrTiming; transient failures back off (qrRetryDelay) and report the running
 *     count; 404 / 401 / 403 / "used" end the loop;
 *   • pause() clears the timer and blocks scheduling until refresh()/start(); stop() is final.
 */
export function createQrPoller(deps: QrPollerDeps): QrPoller {
  const setTimer = deps.timers?.set ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
  const clearTimer = deps.timers?.clear ?? ((h: unknown): void => clearTimeout(h as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  let stopped = false;
  let paused = false;
  let gen = 0;
  let failures = 0;

  const clear = (): void => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };
  const end = (): void => {
    stopped = true;
    clear();
  };

  const run = async (): Promise<void> => {
    if (stopped) return;
    const myGen = ++gen;
    const sentAt = deps.now();
    try {
      const q = await deps.fetchQr();
      if (stopped || myGen !== gen) return;
      const timing = planQrTiming(sentAt, deps.now(), q.expires_in_ms);
      failures = 0;
      deps.onFrame({ wire: q.wire, deadline: timing.deadline, stepMs: q.step_ms });
      if (q.status === 'used') {
        end();
        deps.onUsed();
        return;
      }
      schedule(timing.nextDelay + Math.random() * QR_POLL_JITTER_MS); // de-synchronized: see QR_POLL_JITTER_MS
    } catch (e) {
      if (stopped || myGen !== gen) return;
      if (isTicketsError(e) && (e.status === 401 || e.status === 403)) {
        end();
        deps.onAuth(e);
        return;
      }
      if (isTicketsError(e) && e.status === 404) {
        end();
        deps.onMissing(e);
        return;
      }
      failures += 1;
      deps.onFail(failures, e);
      schedule(qrRetryDelay(failures));
    }
  };

  function schedule(ms: number): void {
    clear();
    if (stopped || paused) return;
    timer = setTimer(() => {
      timer = null;
      void run();
    }, ms);
  }

  return {
    start: () => {
      paused = false;
      clear();
      void run();
    },
    refresh: () => {
      paused = false;
      clear();
      void run();
    },
    pause: () => {
      paused = true;
      clear();
    },
    stop: end,
  };
}

// ── Hooks ────────────────────────────────────────────────────────────────────
/** Which rotating credential to poll. */
export type QrSource = { kind: 'ticket'; id: string } | { kind: 'city_pass' };

export interface QrFeed {
  /** The code to draw and the local instant it rotates out. null until the first answer. */
  frame: QrFrame | null;
  /** The last poll failed (the loop keeps retrying by itself). */
  failed: boolean;
  /** The server says this ticket was used: polling has ended. */
  used: boolean;
  /** 404: the ticket / pass does not exist (for this account). */
  missing: boolean;
  /** 401 / 403: the session is gone. */
  authLost: boolean;
  /** This screen is the focused one (a tab / stack screen stays mounted under whatever is pushed on top). */
  focused: boolean;
  /** Drop the pending timer and fetch a fresh code now (manual retry). */
  refresh: () => void;
}

/**
 * Polls the rotating credential of `source` (null = idle) while this screen is focused and the app is active. Every
 * request is tagged with a generation (createQrPoller) so a slow answer never overwrites a newer one; every timer is
 * cleared on blur / background / unmount; coming back to the foreground fetches a fresh code immediately.
 */
export function useQrFeed(source: QrSource | null): QrFeed {
  const [frame, setFrame] = useState<QrFrame | null>(null);
  const [failed, setFailed] = useState(false);
  const [used, setUsed] = useState(false);
  const [missing, setMissing] = useState(false);
  const [authLost, setAuthLost] = useState(false);
  const [focused, setFocused] = useState(true);
  const pollNow = useRef<(() => void) | null>(null);

  const kind = source ? source.kind : null;
  const id = source && source.kind === 'ticket' ? source.id : '';

  // A different credential starts from scratch.
  useEffect(() => {
    setFrame(null);
    setFailed(false);
    setUsed(false);
    setMissing(false);
    setAuthLost(false);
  }, [kind, id]);

  // Focus: a screen stays mounted under whatever is pushed on top; it must not keep polling then.
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => {
      setFocused(false);
      setFrame(null); // never keep a code across a blur — it may be minutes old when we return
    };
  }, []));

  useEffect(() => {
    if (!kind || !focused || used || missing || authLost) return undefined;
    const poller = createQrPoller({
      fetchQr: () => (kind === 'ticket' ? getTicketQr(id) : getCityPassQr()),
      now: monoNow,
      onFrame: (f) => {
        setFailed(false);
        setFrame(f);
      },
      onUsed: () => setUsed(true),
      onFail: (n, e) => {
        if (n === 1) console.error('[tickets] qr poll failed', e); // log the first of a streak, not every retry
        setFailed(true);
      },
      onMissing: (e) => {
        console.error('[tickets] qr poll: credential gone', e);
        setMissing(true);
      },
      onAuth: (e) => {
        console.error('[tickets] qr poll: session', e);
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
        setFrame(null);
      }
    });
    return () => {
      pollNow.current = null;
      poller.stop();
      sub?.remove(); // react-native-web hands back undefined where the DOM API is missing
    };
  }, [kind, id, focused, used, missing, authLost]);

  const refresh = useCallback(() => {
    if (pollNow.current) pollNow.current();
  }, []);

  return { frame, failed, used, missing, authLost, focused, refresh };
}

export interface QrCountdown {
  /** Fraction of the step left, 0..1 (0 until the first tick). */
  frac: number;
  /** Whole seconds left; null until the clock has ticked (the "—" placeholder). */
  secs: number | null;
  /** Under QR_WARN_MS. */
  warn: boolean;
  /** Past its deadline and not refreshed: the code is dead, hide it rather than show a stale credential. */
  stale: boolean;
}

const IDLE_COUNTDOWN: QrCountdown = { frac: 0, secs: null, warn: false, stale: false };

/**
 * The countdown for the code on screen. The clock starts only when `active` is true (callers pass `mounted && focused`)
 * and `now` stays null until the first tick, so the static-export HTML and the first client render are identical
 * (React #418). prefers-reduced-motion: tick once a second instead of ~10×/s. Keep this in the component that draws
 * the bar: it re-renders on every tick, the QR itself (a PureComponent with stable props) does not.
 */
export function useQrCountdown(frame: QrFrame | null, active: boolean): QrCountdown {
  const [now, setNow] = useState<number | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

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

  useEffect(() => {
    if (!active) return undefined;
    const tick = (): void => setNow(monoNow());
    tick();
    const id = setInterval(tick, reduceMotion ? 1000 : 100);
    return () => clearInterval(id);
  }, [active, reduceMotion]);

  if (frame === null || now === null) return IDLE_COUNTDOWN;
  const remaining = frame.deadline - now;
  const stepMs = frame.stepMs > 0 ? frame.stepMs : DEFAULT_STEP_MS;
  return {
    frac: clamp(remaining / stepMs, 0, 1),
    secs: Math.max(0, Math.ceil(remaining / 1000)),
    warn: remaining < QR_WARN_MS,
    stale: remaining < -QR_STALE_GRACE_MS,
  };
}
