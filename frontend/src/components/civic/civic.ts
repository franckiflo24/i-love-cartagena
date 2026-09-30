// Civic DEMO client — typed wrappers for /api/civic/demo/* (docs/civic-demo/DESIGN.md §2-§3,
// backend: backend/civic_demo.py) plus the small pure helpers the four /gobierno screens share.
//
// Transport is a direct authenticated fetch, deliberately NOT api.get / api.post:
//   1. Every civic call needs the Alcaldía-demo BUSINESS session token; api.* attaches the USER token.
//   2. api.get answers a failed GET from its swr cache / bundled static JSON. For a rotating
//      credential that would replay a DEAD qr as if it were live (and persist each wire to storage).
//   3. api.post flattens an object `detail` into "[object Object]", which throws away the bilingual
//      `detail.message` this demo shows the user (ticket cap, bad amount, ...).
// Timeouts reuse api.ts fetchT (AbortController): 8 s for reads, 20 s for writes so a slow-but-
// successful POST is never reported as failed and retried into a duplicate ticket.
//
// Every response is parsed defensively (no `as` casts on network data): an unexpected body becomes a
// CivicError the screen renders as an honest error state, never a crash and never a guessed verdict.
import { useCallback } from 'react';
import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  AMO_CLIENT_HEADERS, API_BASE, GET_TIMEOUT_MS, WRITE_TIMEOUT_MS, fetchT,
} from '../../constants/api';
import { useBusinessAuth } from '../../context/BusinessAuthContext';
import type { Lang } from '../../i18n/translations';

// ── Shared constants ─────────────────────────────────────────────────────────
/** The demo amber, the same one app/gobierno/_layout.tsx paints its banner with. */
export const DEMO_AMBER = '#F5A623';

/** Business-session roles the civic endpoints accept (server._require_alcaldia_view). */
export const CIVIC_ROLES: readonly string[] = ['alcaldia_demo', 'government'];

/** Shown until (or instead of) the server disclaimer. The first sentence is the DESIGN §0 contract line. */
export const DISCLAIMER_FALLBACK_ES =
  'Demostración — ningún pago real. En el modelo propuesto, la entidad pública recauda directamente; '
  + 'AMO es el canal tecnológico. Hoy no existe ningún convenio firmado con estas entidades.';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export type Translate = (es: string | null | undefined) => string;

// ── Localized text ───────────────────────────────────────────────────────────
export interface LocText { es?: string; en?: string; fr?: string; pt?: string }
/** Catalog data is {es,en} (services, merchants) or {es,en,fr,pt} (fact labels); a few fields are plain. */
export type Loc = LocText | string;

/** <lang> → en → es, same chain as the rest of the app (cityModules.pickL). Never returns an object. */
export function pickL2(v: Loc | null | undefined, lang: Lang): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  return v[lang] || v.en || v.es || '';
}

// "COP 18.000" — manual grouping (no Intl) so Hermes, the browser and the static export agree.
// Same per-language house style as cityModules.formatCop: es/pt "COP 3.900", en "COP 3,900",
// fr "3 900 COP" (U+202F narrow no-break space between groups, U+00A0 before the currency; written as
// escapes on purpose: invisible characters in source get "fixed" into plain spaces by the next editor).
const COP_SEP: Record<Lang, string> = { es: '.', pt: '.', en: ',', fr: '\u202f' };
export function formatCop(n: number, lang: Lang = 'es'): string {
  const v = Number.isFinite(n) ? n : 0;
  const sep = COP_SEP[lang] ?? '.';
  const grouped = String(Math.round(Math.abs(v))).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const signed = `${v < 0 ? '-' : ''}${grouped}`;
  return lang === 'fr' ? `${signed}\u00a0COP` : `COP ${signed}`;
}

// Cartagena is UTC-5 all year (no DST). Fixed-offset arithmetic, not Intl: identical on Hermes,
// the browser and Node, and independent of the phone's own timezone.
const BOGOTA_UTC_OFFSET_MS = 5 * 60 * 60 * 1000;
const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** "30/09 14:32" (or "30/09 14:32:07") in Cartagena time; "—" for a missing / unparseable instant. */
export function formatBogota(iso: string | null | undefined, withSeconds: boolean = false): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms - BOGOTA_UTC_OFFSET_MS);
  const base = `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  return withSeconds ? `${base}:${pad2(d.getUTCSeconds())}` : base;
}

/** Monotonic milliseconds (immune to wall-clock jumps). Only ever called from effects / handlers. */
export function monoNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  return Date.now();
}

/** Ionicons name from server data, falling back when the glyph does not exist in this icon set. */
export function iconOr(name: string | null | undefined, fallback: IconName): IconName {
  const map = (Ionicons as unknown as { glyphMap?: Record<string, number> }).glyphMap;
  return name && map && Object.prototype.hasOwnProperty.call(map, name) ? (name as IconName) : fallback;
}

/** A route param that expo-router may hand over as string | string[] | undefined. */
export function firstParam(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' ? s : '';
}

/** Only an explicit HIGH is "verified". Anything else (VERIFY, missing) is hedged, never implied certain. */
export function isUnverified(confidence: string | null | undefined): boolean {
  return confidence !== 'HIGH';
}

// ── Data model ───────────────────────────────────────────────────────────────
export type ServiceMode = 'pay' | 'recharge' | 'info' | 'soon' | 'amo';
export type TicketKind = 'credential' | 'receipt';
export type Verdict = 'VALIDO' | 'DUPLICADO' | 'FALSIFICADO' | 'EXPIRADO' | 'RECIBO';

export interface CivicFact {
  key: string;
  label: Loc | null;
  value_cop: number | null;
  confidence: string | null;
  source_name: string | null;
  last_verified: string | null;
  /** Catalog lines only (not tiers / min_fact). */
  required: boolean;
  option: string | null;
  /** The entity that collects THIS line (muelle: Corpoturismo / Parques Nacionales / insurer). */
  merchant: Loc | null;
}

export interface CivicService {
  key: string;
  mode: ServiceMode;
  icon: string | null;
  title: Loc | null;
  /** Service-level collecting entity. null for muelle, whose lines each name their own. */
  merchant: Loc | null;
  module: string | null;
  facts: CivicFact[];
  tiers: CivicFact[];
  /** recharge mode: the COP amounts the picker offers (min = the official PSE minimum). */
  amounts: number[];
  /** recharge mode: the cited fact behind the minimum (Transcaribe recarga PSE). */
  minFact: CivicFact | null;
}

export interface ServicesPayload {
  disclaimer: Loc | null;
  services: CivicService[];
  security: { scheme: string | null; production: string | null };
}

export interface TicketLine {
  key: string;
  label: Loc | null;
  value_cop: number | null;
  confidence: string | null;
  source_name: string | null;
  last_verified: string | null;
  merchant: Loc | null;
  qty: number;
  subtotal_cop: number;
}

export interface CivicTicket {
  ticket_id: string;
  service: string;
  kind: TicketKind;
  title: Loc | null;
  /** Ticket-level collecting entity; null for muelle (use the lines' merchants). */
  merchant: Loc | null;
  lines: TicketLine[];
  amount_cop: number;
  /** 'issued' | 'used' (anything else is shown neutrally, never as live). */
  status: string;
  created_at: string | null;
  used_at: string | null;
}

export interface TicketResult { ticket: CivicTicket; disclaimer: Loc | null }

export interface QrPayload {
  wire: string;
  step_ms: number;
  /** Clamped to [0, step_ms]: a bad server value can never park the next poll for hours. */
  expires_in_ms: number;
  status: string;
  kind: TicketKind | null;
}

export interface IssueRequest {
  service: string;
  tier?: string;
  /** recharge (transcaribe) only. */
  amount_cop?: number;
  insurance?: boolean;
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
  verdict: Verdict;
  ticket: CivicTicket | null;
  first_used_at: string | null;
  first_gate: string | null;
}

export interface ScanRow {
  at: string | null;
  verdict: string;
  ticket_id: string | null;
  service: string | null;
  amount_cop: number | null;
  merchant_es: string | null;
  gate: string | null;
}

export interface SummaryPayload {
  disclaimer: Loc | null;
  window_h: number;
  issued_n: number;
  used_n: number;
  collected_cop: number;
  by_entity: { entity_es: string; cop: number }[];
  scans: ScanRow[];
}

// ── Errors ───────────────────────────────────────────────────────────────────
/**
 * Anything that goes wrong talking to the civic API. `status` is the HTTP status; 0 means the request
 * never produced a usable answer (offline, timeout, unreadable or unexpected body).
 */
export class CivicError extends Error {
  readonly isCivicError = true as const;
  readonly status: number;
  /** detail.error when the server sent one ("too_many_demo_tickets", "invalid_amount", ...). */
  readonly code: string | null;
  /** detail.message, or a string `detail`. Bilingual "ES / EN" for this API's own errors. */
  readonly serverMessage: string | null;

  constructor(status: number, serverMessage: string | null, code: string | null) {
    super(serverMessage ?? code ?? `civic request failed (${status})`);
    Object.setPrototypeOf(this, CivicError.prototype);
    this.name = 'CivicError';
    this.status = status;
    this.code = code;
    this.serverMessage = serverMessage;
  }
}

/** Duck-typed so it survives a class identity split across bundles / transpilers. */
export function isCivicError(e: unknown): e is CivicError {
  return typeof e === 'object' && e !== null && (e as { isCivicError?: unknown }).isCivicError === true;
}

/** 401 / 403: the business session is missing, expired or the wrong role. */
export function isAuthError(e: unknown): boolean {
  return isCivicError(e) && (e.status === 401 || e.status === 403);
}

const shapeError = (): CivicError => new CivicError(0, null, 'bad_shape');

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
 * The text a screen shows for a failed call: the server's own bilingual message when it sent one,
 * otherwise an honest message for the failure class. `notFound` lets a screen say what a 404 means
 * in ITS context (hub: "demo unavailable"; boleta: "ticket gone").
 */
export function civicErrorMessage(e: unknown, lang: Lang, tr: Translate, notFound?: string): string {
  if (isCivicError(e)) {
    if (e.status === 404 && notFound) return notFound;
    const fromServer = e.serverMessage ? bilingualMessage(e.serverMessage, lang) : null;
    if (fromServer) return fromServer;
    if (e.status === 401 || e.status === 403) {
      return tr('Sesión requerida: vuelve a ingresar con el código de acceso de la demostración.');
    }
    if (e.status === 404) return tr('No encontramos lo que buscas en la demostración.');
    if (e.status === 429) return tr('Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.');
    if (e.status >= 500) return tr('La demostración no respondió bien. Inténtalo de nuevo en un momento.');
    if (e.status === 0) return tr('Sin conexión con la demostración. Revisa tu conexión e inténtalo de nuevo.');
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

const LANG_KEYS = ['es', 'en', 'fr', 'pt'] as const;
function asLoc(v: unknown): Loc | null {
  if (typeof v === 'string') return v.length > 0 ? v : null;
  if (!isRec(v)) return null;
  const out: LocText = {};
  let any = false;
  for (const k of LANG_KEYS) {
    const s = v[k];
    if (typeof s === 'string' && s.length > 0) {
      out[k] = s;
      any = true;
    }
  }
  return any ? out : null;
}

const MODES: readonly string[] = ['pay', 'recharge', 'info', 'soon', 'amo'];
// An unknown future mode degrades to the inert "soon" card: it can never expose a payment flow.
const asMode = (v: unknown): ServiceMode => (typeof v === 'string' && MODES.includes(v) ? (v as ServiceMode) : 'soon');
const asKind = (v: unknown): TicketKind => (v === 'receipt' ? 'receipt' : 'credential');

function normFact(raw: unknown): CivicFact | null {
  if (!isRec(raw)) return null;
  const key = asStr(raw.key);
  if (!key) return null;
  return {
    key,
    label: asLoc(raw.label),
    value_cop: asNum(raw.value_cop),
    confidence: asStr(raw.confidence),
    source_name: asStr(raw.source_name),
    last_verified: asStr(raw.last_verified),
    required: raw.required !== false,
    option: asStr(raw.option),
    merchant: asLoc(raw.merchant),
  };
}

function normService(raw: unknown): CivicService | null {
  if (!isRec(raw)) return null;
  const key = asStr(raw.key);
  if (!key) return null;
  return {
    key,
    mode: asMode(raw.mode),
    icon: asStr(raw.icon),
    title: asLoc(raw.title),
    // `merchant` is the current field; `entity` is what the first API draft called it.
    merchant: asLoc(raw.merchant) ?? asLoc(raw.entity),
    module: asStr(raw.module),
    facts: asArr(raw.facts).map(normFact).filter(notNull),
    tiers: asArr(raw.tiers).map(normFact).filter(notNull),
    amounts: asArr(raw.amounts).map(asNum).filter((n): n is number => n !== null && n > 0),
    minFact: normFact(raw.min_fact),
  };
}

function normLine(raw: unknown): TicketLine | null {
  if (!isRec(raw)) return null;
  const value = asNum(raw.value_cop);
  return {
    key: asStr(raw.key) ?? '',
    label: asLoc(raw.label),
    value_cop: value,
    confidence: asStr(raw.confidence),
    source_name: asStr(raw.source_name),
    last_verified: asStr(raw.last_verified),
    merchant: asLoc(raw.merchant),
    qty: asNum(raw.qty) ?? 1,
    subtotal_cop: asNum(raw.subtotal_cop) ?? value ?? 0,
  };
}

function normTicket(raw: unknown): CivicTicket | null {
  if (!isRec(raw)) return null;
  const id = asStr(raw.ticket_id);
  const amount = asNum(raw.amount_cop);
  if (!id || amount === null) return null;
  return {
    ticket_id: id,
    service: asStr(raw.service) ?? '',
    kind: asKind(raw.kind),
    title: asLoc(raw.title),
    merchant: asLoc(raw.merchant) ?? asLoc(raw.entity),
    lines: asArr(raw.lines).map(normLine).filter(notNull),
    amount_cop: amount,
    status: asStr(raw.status) ?? 'unknown',
    created_at: asStr(raw.created_at),
    used_at: asStr(raw.used_at),
  };
}

function normTicketResult(body: unknown): TicketResult {
  if (!isRec(body)) throw shapeError();
  const ticket = normTicket(body.ticket);
  if (!ticket) throw shapeError();
  return { ticket, disclaimer: asLoc(body.disclaimer) };
}

function normQr(body: unknown): QrPayload {
  if (!isRec(body)) throw shapeError();
  const wire = asStr(body.wire);
  const exp = asNum(body.expires_in_ms);
  if (!wire || wire.length < 8 || exp === null) throw shapeError();
  const step = asNum(body.step_ms);
  const stepMs = step !== null && step >= 1000 && step <= 60000 ? step : 10000;
  return {
    wire,
    step_ms: stepMs,
    expires_in_ms: Math.min(Math.max(exp, 0), stepMs),
    status: asStr(body.status) ?? 'unknown',
    kind: body.kind === 'receipt' || body.kind === 'credential' ? body.kind : null,
  };
}

const VERDICTS: readonly string[] = ['VALIDO', 'DUPLICADO', 'FALSIFICADO', 'EXPIRADO', 'RECIBO'];
function normScan(body: unknown): ScanResult {
  if (!isRec(body)) throw shapeError();
  const verdict = asStr(body.verdict);
  // An unknown verdict is an error, never a guess: nothing may ever render as "valid" by default.
  if (!verdict || !VERDICTS.includes(verdict)) throw shapeError();
  return {
    verdict: verdict as Verdict,
    ticket: normTicket(body.ticket),
    first_used_at: asStr(body.first_used_at),
    first_gate: asStr(body.first_gate),
  };
}

function normScanRow(raw: unknown): ScanRow | null {
  if (!isRec(raw)) return null;
  const verdict = asStr(raw.verdict);
  if (!verdict) return null;
  return {
    at: asStr(raw.at),
    verdict,
    ticket_id: asStr(raw.ticket_id),
    service: asStr(raw.service),
    amount_cop: asNum(raw.amount_cop),
    merchant_es: asStr(raw.merchant_es) ?? asStr(raw.entity_es),
    gate: asStr(raw.gate),
  };
}

function normSummary(body: unknown): SummaryPayload {
  if (!isRec(body) || asNum(body.issued_n) === null) throw shapeError();
  return {
    disclaimer: asLoc(body.disclaimer),
    window_h: asNum(body.window_h) ?? 24,
    issued_n: asNum(body.issued_n) ?? 0,
    used_n: asNum(body.used_n) ?? 0,
    collected_cop: asNum(body.collected_cop) ?? 0,
    by_entity: asArr(body.by_entity).flatMap((r): { entity_es: string; cop: number }[] => {
      if (!isRec(r)) return [];
      const name = asStr(r.entity_es);
      const cop = asNum(r.cop);
      return name && cop !== null ? [{ entity_es: name, cop }] : [];
    }),
    scans: asArr(body.scans).map(normScanRow).filter(notNull),
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

async function civicRequest(token: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'X-Requested-With': 'XMLHttpRequest',
    ...AMO_CLIENT_HEADERS,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetchT(
      `${API_BASE}/civic/demo${path}`,
      {
        method,
        headers,
        credentials: 'omit', // Bearer only — no cookies, so no credentialed-CORS requirements
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      method === 'GET' ? GET_TIMEOUT_MS : WRITE_TIMEOUT_MS,
    );
  } catch {
    throw new CivicError(0, null, 'network'); // offline / DNS / TimeoutError
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null; // empty or non-JSON body (e.g. an HTML error page from a proxy)
  }
  if (!res.ok) {
    const d = readDetail(json);
    throw new CivicError(res.status, d.message, d.code);
  }
  if (json === null) throw new CivicError(0, null, 'bad_body');
  return json;
}

// ── The API ──────────────────────────────────────────────────────────────────
/** GET /civic/demo/services — the catalog, the disclaimer and the credential-security copy. */
export async function getServices(token: string): Promise<ServicesPayload> {
  const body = await civicRequest(token, 'GET', '/services');
  if (!isRec(body) || !Array.isArray(body.services)) throw shapeError();
  const sec = isRec(body.security) ? body.security : {};
  return {
    disclaimer: asLoc(body.disclaimer),
    services: body.services.map(normService).filter(notNull),
    security: { scheme: asStr(sec.scheme), production: asStr(sec.production) },
  };
}

/** POST /civic/demo/tickets — 429 (per-IP cap) and 400s carry a bilingual detail.message. */
export async function issueTicket(token: string, req: IssueRequest): Promise<TicketResult> {
  return normTicketResult(await civicRequest(token, 'POST', '/tickets', req));
}

/** GET /civic/demo/tickets/{id}. */
export async function getTicket(token: string, id: string): Promise<TicketResult> {
  return normTicketResult(await civicRequest(token, 'GET', `/tickets/${encodeURIComponent(id)}`));
}

/** GET /civic/demo/tickets/{id}/qr — the rotating wire; poll it (see planQrTiming). */
export async function getQr(token: string, id: string): Promise<QrPayload> {
  return normQr(await civicRequest(token, 'GET', `/tickets/${encodeURIComponent(id)}/qr`));
}

/** POST /civic/demo/scan — a pasted wire, or a server-side simulated scan of a live ticket. */
export async function scan(token: string, req: ScanRequest): Promise<ScanResult> {
  return normScan(await civicRequest(token, 'POST', '/scan', req));
}

/** GET /civic/demo/summary — simulated collection per entity + the scan ledger. */
export async function getSummary(token: string): Promise<SummaryPayload> {
  return normSummary(await civicRequest(token, 'GET', '/summary'));
}

/** GET /civic/demo/tickets?live=1 — issued tickets (no secrets): the validator's "boletas vivas". */
export async function getLiveTickets(token: string): Promise<CivicTicket[]> {
  const body = await civicRequest(token, 'GET', '/tickets?live=1');
  if (!isRec(body) || !Array.isArray(body.tickets)) throw shapeError();
  return body.tickets.map(normTicket).filter(notNull);
}

// ── Shared display helpers ───────────────────────────────────────────────────
/** The hedge that rides next to any unverified fare. Coches carries its own, sharper one (brief). */
export function hedgeText(tr: Translate, serviceKey: string): string {
  return serviceKey === 'coches' ? tr('sin verificar · confirma con el cochero') : tr('sin verificar');
}

/** Distinct names in first-seen order ("Corpoturismo … · Parques Nacionales Naturales"). */
export function uniqueNames(list: readonly (Loc | null | undefined)[], lang: Lang): string[] {
  const out: string[] = [];
  for (const m of list) {
    const n = pickL2(m ?? null, lang);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Who collects for a catalog service: its own merchant, else the merchants of its lines (muelle). */
export function serviceMerchants(s: CivicService, lang: Lang): string[] {
  return s.merchant ? uniqueNames([s.merchant], lang) : uniqueNames(s.facts.map((f) => f.merchant), lang);
}

/** Who collected on a ticket: the merchants of its LINES (the truth of "who gets what"), else its own. */
export function ticketMerchants(t: CivicTicket, lang: Lang): string[] {
  const fromLines = uniqueNames(t.lines.map((l) => l.merchant), lang);
  return fromLines.length > 0 ? fromLines : uniqueNames([t.merchant], lang);
}

/** True when any charged line is hedged: the ticket amount then carries the "sin verificar" chip. */
export function ticketHasUnverified(t: CivicTicket): boolean {
  return t.lines.some((l) => isUnverified(l.confidence));
}

// ── Checkout pricing (display-only; the server prices the real ticket) ────────
export interface CheckoutSelection {
  /** Tier fact key (monumentos, coches). */
  tier: string | null;
  /** Muelle's optional insurance line. */
  insurance: boolean;
  /** Recharge amount in COP (transcaribe). */
  amount: number | null;
}

export interface CheckoutLine {
  key: string;
  /** null for the recharge line: the screen supplies its own translated label. */
  label: Loc | null;
  value_cop: number;
  confidence: string | null;
  source_name: string | null;
  last_verified: string | null;
  merchant: Loc | null;
}

export interface CheckoutPlan {
  lines: CheckoutLine[];
  total: number;
  /** The exact POST body, or null when there is nothing chargeable (the pay button stays disabled). */
  request: IssueRequest | null;
}

const EMPTY_PLAN: CheckoutPlan = { lines: [], total: 0, request: null };

/**
 * Mirrors backend civic_issue so the total on screen equals the amount the server will charge:
 *   recharge → the chosen amount (must be one of the offered amounts);
 *   tiers    → exactly one tier line (an unknown tier falls back to the first, like the server);
 *   otherwise → every priced fact, the optional insurance line only when toggled.
 * Lines without a price are skipped, and a non-positive total is never chargeable.
 */
export function planCheckout(svc: CivicService, sel: CheckoutSelection): CheckoutPlan {
  if (svc.mode !== 'pay' && svc.mode !== 'recharge') return EMPTY_PLAN;

  if (svc.mode === 'recharge') {
    const amount = sel.amount;
    if (amount === null || !svc.amounts.includes(amount)) return EMPTY_PLAN;
    const ref = svc.minFact;
    return {
      lines: [{
        key: 'recharge', label: null, value_cop: amount,
        confidence: ref?.confidence ?? 'HIGH', source_name: ref?.source_name ?? null,
        last_verified: ref?.last_verified ?? null, merchant: svc.merchant,
      }],
      total: amount,
      request: { service: svc.key, amount_cop: amount },
    };
  }

  const toLine = (f: CivicFact, merchant: Loc | null): CheckoutLine | null =>
    f.value_cop !== null && f.value_cop > 0
      ? {
        key: f.key, label: f.label, value_cop: f.value_cop, confidence: f.confidence,
        source_name: f.source_name, last_verified: f.last_verified, merchant,
      }
      : null;

  if (svc.tiers.length > 0) {
    const f = svc.tiers.find((t) => t.key === sel.tier) ?? svc.tiers[0];
    const line = toLine(f, svc.merchant);
    if (!line) return EMPTY_PLAN;
    return { lines: [line], total: line.value_cop, request: { service: svc.key, tier: f.key } };
  }

  const lines: CheckoutLine[] = [];
  for (const f of svc.facts) {
    if (f.option === 'insurance' && !sel.insurance) continue;
    const line = toLine(f, f.merchant ?? svc.merchant);
    if (line) lines.push(line);
  }
  const total = lines.reduce((sum, l) => sum + l.value_cop, 0);
  if (lines.length === 0 || total <= 0) return EMPTY_PLAN;
  const hasInsurance = svc.facts.some((f) => f.option === 'insurance');
  return {
    lines,
    total,
    request: hasInsurance ? { service: svc.key, insurance: sel.insurance } : { service: svc.key },
  };
}

// ── Rotating-credential timing (pure, so the boleta's poll loop stays testable) ─
/** Next fetch lands this long after the server-side rotation (the brief: expires_in_ms + 150). */
export const QR_RENEW_SLACK_MS = 150;
/** Never poll faster than this, whatever the server says: the endpoint is rate-limited (30/min/IP). */
export const QR_MIN_GAP_MS = 1000;
/** How long a code may sit past its deadline (waiting on the refetch) before the UI hides it. */
export const QR_STALE_GRACE_MS = 2500;

export interface QrTiming {
  /** Local monotonic instant the shown code rotates out. */
  deadline: number;
  /** Delay (ms) from `recvAt` until the next poll should be SENT. */
  nextDelay: number;
}

/**
 * All instants are on the local monotonic clock. The server computed expires_in_ms somewhere between
 * sentAt and recvAt; assuming the midpoint keeps network latency from pushing the countdown late, and
 * the next request is timed to ARRIVE just after the rotation.
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
  /** One GET .../qr, already bound to the token and ticket id. */
  fetchQr: () => Promise<QrPayload>;
  /** Monotonic clock (monoNow in the app). */
  now: () => number;
  onFrame: (frame: QrFrame) => void;
  /** The credential was used: polling ends. */
  onUsed: () => void;
  /** A transient failure: polling continues by itself with backoff. `failures` counts consecutive ones. */
  onFail: (failures: number, error: unknown) => void;
  /** 404: the ticket is gone, polling ends. */
  onMissing: (error: CivicError) => void;
  /** 401 / 403: the session is gone, polling ends. */
  onAuth: (error: CivicError) => void;
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
 *   • every request carries a generation — a newer request supersedes an older one, whose late answer
 *     is dropped, so a slow response can never overwrite a fresher code;
 *   • success re-schedules from planQrTiming; transient failures back off (qrRetryDelay) and report
 *     the running count; 404 / 401 / 403 / "used" end the loop;
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
      schedule(timing.nextDelay);
    } catch (e) {
      if (stopped || myGen !== gen) return;
      if (isCivicError(e) && (e.status === 401 || e.status === 403)) {
        end();
        deps.onAuth(e);
        return;
      }
      if (isCivicError(e) && e.status === 404) {
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

// ── Session ──────────────────────────────────────────────────────────────────
export interface CivicSession {
  /** False while the business session is still being restored: show a skeleton, not "Sesión requerida". */
  ready: boolean;
  /**
   * The Alcaldía-demo business token, or null: none, a business session of the wrong role, or the
   * session is still being restored (`ready` false). Every loader gates on this, so nothing calls the
   * API with a stored token that /business/me has not yet confirmed (it may be stale or revoked).
   */
  token: string | null;
  /**
   * Clears the stored business session. The layout judges "authorized" from the stored role, so a
   * session the server has since expired would otherwise trap the user on "Sesión requerida"; signing
   * out makes the layout show its passcode gate again.
   */
  signOut: () => Promise<void>;
}

/**
 * The civic screens assume app/gobierno/_layout.tsx already gated entry; this only hands them the token
 * and lets them fall back to an honest "Sesión requerida" state. A business profile that has not
 * loaded yet (role unknown) is let through once the session is ready: the server enforces the role and
 * answers 403 otherwise.
 */
export function useCivicSession(): CivicSession {
  const { token, business, loading, logout } = useBusinessAuth();
  const roleOk = !business || CIVIC_ROLES.includes(business.role);
  const signOut = useCallback(async (): Promise<void> => {
    try {
      await logout();
    } catch (e) {
      console.error('[civic] sign out', e);
    }
  }, [logout]);
  return { ready: !loading, token: !loading && token && roleOk ? token : null, signOut };
}
