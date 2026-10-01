// Venue-side TICKET SCANNER client — typed wrappers for /api/business/tickets/* (backend/tickets.py):
// the venue's upcoming events with their RSVP counts, the guest list, the scan verdict (the PALCO gate:
// VALIDO / DUPLICADO / FALSIFICADO / EXPIRADO, plus PASE for a City Pass) and the venue's scan feed.
//
// Transport is a direct authenticated fetch, deliberately NOT api.get / api.post (same reasons as
// components/civic/civic.ts):
//   1. Every call needs the BUSINESS session token; api.* attaches the USER token.
//   2. api.get answers a failed GET from its swr cache / bundled static JSON. At a gate that would show
//      yesterday's guest list, or a dead feed, as if it were live.
//   3. api.post flattens an object `detail` into "[object Object]", which throws away the bilingual
//      `detail.message` the gate shows the operator ("Esta entrada es de otro negocio / ...").
// Timeouts reuse api.ts fetchT (AbortController): 8 s for reads, 20 s for the scan POST so a slow-but-
// successful scan is never reported as failed.
//
// Every response is parsed defensively (no `as` casts on network data): an unexpected body becomes a
// ScannerError the screen renders as an honest error state, never a crash and never a guessed verdict.
import {
  AMO_CLIENT_HEADERS, API_BASE, GET_TIMEOUT_MS, WRITE_TIMEOUT_MS, fetchT,
} from '../../constants/api';
import type { Lang } from '../../i18n/translations';

// ── Limits (mirror backend/tickets.py ScanBody) ──────────────────────────────
/** The server rejects a pasted code shorter than this with a 422. */
export const SCAN_WIRE_MIN = 8;
export const SCAN_WIRE_MAX = 200;
export const SCAN_GATE_MAX = 40;
/** What the server itself logs when no gate is sent. */
export const DEFAULT_GATE = 'Puerta 1';

export type Translate = (es: string | null | undefined) => string;

// ── Data model ───────────────────────────────────────────────────────────────
export type ScanVerdict = 'VALIDO' | 'DUPLICADO' | 'FALSIFICADO' | 'EXPIRADO' | 'PASE';

/** 'issued' | 'used'; anything else is 'unknown' and is shown neutrally, never as admissible. */
export type GuestStatus = 'issued' | 'used' | 'unknown';

export interface ScannerEvent {
  event_id: string;
  title: string;
  /** "YYYY-MM-DD" (Cartagena calendar date). */
  date: string | null;
  /** "HH:MM". */
  start_time: string | null;
  rsvp_count: number;
  used_count: number;
}

export interface GuestTicket {
  ticket_id: string;
  holder_name: string;
  status: GuestStatus;
  used_at: string | null;
  used_gate: string | null;
}

/** Who the scanned credential belongs to. For a City Pass `plan_id` is set and `event_date` is its expiry. */
export interface GuestInfo {
  name: string;
  ticket_title: string;
  event_date: string;
  venue_name: string;
  plan_id: string | null;
}

export interface ScanRequest {
  /** Pasted code. */
  wire?: string;
  /** Simulated scan: the SERVER derives the current wire (camera access is disabled site-wide). */
  ticket_id?: string;
  simulate?: boolean;
  tamper?: boolean;
  stale?: boolean;
  gate?: string;
}

export interface ScanResult {
  verdict: ScanVerdict;
  /** Present on every resolvable scan (for FALSIFICADO it is what the forged code CLAIMS to be). */
  guest: GuestInfo | null;
  first_used_at: string | null;
  first_gate: string | null;
}

export interface FeedScan {
  at: string | null;
  /** Kept as a string: the ledger may carry a verdict this client does not know (shown neutrally). */
  verdict: string;
  guest_name: string;
  ticket_title: string;
  gate: string | null;
}

// ── Errors ───────────────────────────────────────────────────────────────────
/**
 * Anything that goes wrong talking to the scanner API. `status` is the HTTP status; 0 means the request
 * never produced a usable answer (offline, timeout, unreadable or unexpected body) — for a scan POST that
 * also means the outcome is UNKNOWN: the ticket may have been admitted.
 */
export class ScannerError extends Error {
  readonly isScannerError = true as const;
  readonly status: number;
  /** detail.error when the server sent one ("forbidden", "not_found", ...). */
  readonly code: string | null;
  /** detail.message, or a string `detail`. Bilingual "ES / EN" for this API's own errors. */
  readonly serverMessage: string | null;

  constructor(status: number, serverMessage: string | null, code: string | null) {
    super(serverMessage ?? code ?? `scanner request failed (${status})`);
    Object.setPrototypeOf(this, ScannerError.prototype);
    this.name = 'ScannerError';
    this.status = status;
    this.code = code;
    this.serverMessage = serverMessage;
  }
}

/** Duck-typed so it survives a class identity split across bundles / transpilers. */
export function isScannerError(e: unknown): e is ScannerError {
  return typeof e === 'object' && e !== null && (e as { isScannerError?: unknown }).isScannerError === true;
}

/** 401: the business session is missing, expired or revoked. */
export function isSessionError(e: unknown): boolean {
  return isScannerError(e) && e.status === 401;
}

/** 403: signed in, but not allowed (on a scan: the ticket belongs to another venue's event). */
export function isForbiddenError(e: unknown): boolean {
  return isScannerError(e) && e.status === 403;
}

/** The scan's outcome is unknown (no answer / server fault): the ticket may already have been admitted. */
export function isOutcomeUnknown(e: unknown): boolean {
  return isScannerError(e) && (e.status === 0 || e.status >= 500);
}

const shapeError = (): ScannerError => new ScannerError(0, null, 'bad_shape');

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
 * The text a screen shows for a failed call: the server's own bilingual detail.message when it sent one,
 * otherwise an honest message for the failure class.
 */
export function scannerErrorMessage(e: unknown, lang: Lang, tr: Translate): string {
  if (isScannerError(e)) {
    const fromServer = e.serverMessage ? bilingualMessage(e.serverMessage, lang) : null;
    if (fromServer) return fromServer;
    if (e.status === 401) return tr('Sesión de negocio requerida');
    if (e.status === 403) return tr('Tu cuenta no tiene permiso para esta acción.');
    if (e.status === 404) return tr('No encontramos lo que buscas.');
    if (e.status === 429) return tr('Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.');
    if (e.status >= 500) return tr('El servidor no respondió bien. Inténtalo de nuevo en un momento.');
    if (e.status === 0) return tr('Sin conexión con el servidor. Revisa tu conexión e inténtalo de nuevo.');
  }
  return tr('Algo salió mal. Inténtalo de nuevo.');
}

// ── Defensive parsing ────────────────────────────────────────────────────────
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const asStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const asNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const notNull = <T>(v: T | null): v is T => v !== null;

const VERDICTS: ReadonlySet<string> = new Set<ScanVerdict>(['VALIDO', 'DUPLICADO', 'FALSIFICADO', 'EXPIRADO', 'PASE']);
function isVerdict(v: string): v is ScanVerdict {
  return VERDICTS.has(v);
}

function normEvent(raw: unknown): ScannerEvent | null {
  if (!isRec(raw)) return null;
  const id = asStr(raw.event_id);
  if (!id) return null;
  return {
    event_id: id,
    title: asStr(raw.title) ?? '',
    date: asStr(raw.date),
    start_time: asStr(raw.start_time),
    rsvp_count: Math.max(0, asNum(raw.rsvp_count) ?? 0),
    used_count: Math.max(0, asNum(raw.used_count) ?? 0),
  };
}

function normGuestTicket(raw: unknown): GuestTicket | null {
  if (!isRec(raw)) return null;
  const id = asStr(raw.ticket_id);
  if (!id) return null;
  const status: GuestStatus = raw.status === 'used' ? 'used' : raw.status === 'issued' ? 'issued' : 'unknown';
  return {
    ticket_id: id,
    holder_name: asStr(raw.holder_name) ?? '',
    status,
    used_at: asStr(raw.used_at),
    used_gate: asStr(raw.used_gate),
  };
}

function normGuest(raw: unknown): GuestInfo | null {
  if (!isRec(raw)) return null;
  return {
    name: asStr(raw.name) ?? '',
    ticket_title: asStr(raw.ticket_title) ?? '',
    event_date: asStr(raw.event_date) ?? '',
    venue_name: asStr(raw.venue_name) ?? '',
    plan_id: asStr(raw.plan_id),
  };
}

function normScan(body: unknown): ScanResult {
  if (!isRec(body)) throw shapeError();
  const verdict = asStr(body.verdict);
  // An unknown verdict is an error, never a guess: nothing may ever render as "valid" by default.
  if (verdict === null || !isVerdict(verdict)) throw shapeError();
  return {
    verdict,
    guest: normGuest(body.guest),
    first_used_at: asStr(body.first_used_at),
    first_gate: asStr(body.first_gate),
  };
}

function normFeedRow(raw: unknown): FeedScan | null {
  if (!isRec(raw)) return null;
  const verdict = asStr(raw.verdict);
  if (!verdict) return null;
  return {
    at: asStr(raw.at),
    verdict,
    guest_name: asStr(raw.guest_name) ?? '',
    ticket_title: asStr(raw.ticket_title) ?? '',
    gate: asStr(raw.gate),
  };
}

// ── Transport ────────────────────────────────────────────────────────────────
function readDetail(body: unknown): { code: string | null; message: string | null } {
  if (!isRec(body)) return { code: null, message: null };
  const d = body.detail;
  if (typeof d === 'string') return { code: null, message: d };
  if (isRec(d)) return { code: asStr(d.error), message: asStr(d.message) };
  return { code: null, message: null }; // 422 validation arrays etc.: no user-facing text
}

async function scannerRequest(token: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'X-Requested-With': 'XMLHttpRequest',
    ...AMO_CLIENT_HEADERS,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
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
    throw new ScannerError(0, null, 'network'); // offline / DNS / TimeoutError
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null; // empty or non-JSON body (e.g. an HTML error page from a proxy)
  }
  if (!res.ok) {
    const d = readDetail(json);
    throw new ScannerError(res.status, d.message, d.code);
  }
  if (json === null) throw new ScannerError(0, null, 'bad_body');
  return json;
}

// ── The API (the business `token` is passed in; every call carries it as a Bearer) ──
/** GET /business/tickets/events — THIS venue's upcoming published events (government sees all). */
export async function fetchEvents(token: string): Promise<ScannerEvent[]> {
  const body = await scannerRequest(token, 'GET', '/business/tickets/events');
  if (!isRec(body) || !Array.isArray(body.events)) throw shapeError();
  return body.events.map(normEvent).filter(notNull);
}

/** GET /business/tickets/event/{id} — the guest list, no secrets. 403 = the event is another venue's. */
export async function fetchGuestList(token: string, eventId: string): Promise<GuestTicket[]> {
  const body = await scannerRequest(token, 'GET', `/business/tickets/event/${encodeURIComponent(eventId)}`);
  if (!isRec(body) || !Array.isArray(body.tickets)) throw shapeError();
  return body.tickets.map(normGuestTicket).filter(notNull);
}

/** POST /business/tickets/scan — a pasted wire, or a server-side simulated scan of a listed ticket. */
export async function submitScan(token: string, req: ScanRequest): Promise<ScanResult> {
  return normScan(await scannerRequest(token, 'POST', '/business/tickets/scan', req));
}

/** GET /business/tickets/scan-feed — this venue's last 20 scans (government sees all). */
export async function fetchScanFeed(token: string): Promise<FeedScan[]> {
  const body = await scannerRequest(token, 'GET', '/business/tickets/scan-feed');
  if (!isRec(body) || !Array.isArray(body.scans)) throw shapeError();
  return asArr(body.scans).map(normFeedRow).filter(notNull);
}

// ── Display helpers ──────────────────────────────────────────────────────────
// Cartagena is UTC-5 all year (no DST). Fixed-offset arithmetic, not Intl: identical on Hermes,
// the browser and Node, and independent of the phone's own timezone.
const BOGOTA_UTC_OFFSET_MS = 5 * 60 * 60 * 1000;
const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** "30/09 14:32" (or "30/09 14:32:07") in Cartagena time; "—" for a missing / unparseable instant. */
export function formatGateTime(iso: string | null | undefined, withSeconds: boolean = false): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms - BOGOTA_UTC_OFFSET_MS);
  const base = `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  return withSeconds ? `${base}:${pad2(d.getUTCSeconds())}` : base;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** "30/09" (or "30/09/2026") from a "YYYY-MM-DD" calendar date; an unknown shape is shown verbatim. */
export function formatEventDate(raw: string | null | undefined, withYear: boolean = false): string {
  if (!raw) return '—';
  const m = DATE_RE.exec(raw);
  if (!m) return raw;
  return withYear ? `${m[3]}/${m[2]}/${m[1]}` : `${m[3]}/${m[2]}`;
}

/** "21:00" from "HH:MM" or "HH:MM:SS"; null when there is no usable time. */
export function formatStartTime(raw: string | null | undefined): string | null {
  if (!raw || !/^\d{1,2}:\d{2}/.test(raw)) return null;
  return raw.slice(0, 5);
}

const PLAN_NAMES: Readonly<Record<string, string>> = {
  pass_basic: 'Explorer Pass',
  pass_classic: 'Classic Pass',
  pass_premium: 'Premium Pass',
  pass_ultimate: 'Ultimate Pass',
};

/** City Pass plan name for a plan_id ("pass_basic" → "Explorer Pass"); an unknown id is humanized, never dropped. */
export function planName(planId: string | null | undefined): string {
  if (!planId) return 'City Pass';
  const known = PLAN_NAMES[planId];
  if (known) return known;
  const words = planId.replace(/^pass[_-]/i, '').replace(/[_-]+/g, ' ').trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)} Pass` : 'City Pass';
}
