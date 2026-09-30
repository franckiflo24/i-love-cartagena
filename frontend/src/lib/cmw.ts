// CMW — Cartagena Music Week: the ONE client reader for the official program and
// the concierge request flow. Contract: docs/cmw/DESIGN.md (§0 honesty spine, §3 API, §4).
//
// Honesty spine, enforced here and not only on the server:
//   • the app states ONLY what the official program prints. A field listed in an
//     event's `tba` is forced to "no value" on read (normalizeEvent), whatever the
//     payload carries, so a screen can never print a time, a price, a venue, a
//     boarding point or an artist that is still to be confirmed;
//   • the headline guest is never named: while `artist_status` is not 'confirmed'
//     the only artist text that survives is the printed placeholder;
//   • coordinates come ONLY from the catalog venue object the backend (or the
//     static mirror) resolved. No catalog venue ⇒ no pin, no "Cómo llegar";
//   • booking is concierge-led. A request is only ever "received". There is no
//     checkout, no payment and no other request state in this file;
//   • the concierge WhatsApp number is the one the program prints. It is a
//     constant: a payload cannot point the button at another number.
//
// Loading: backend-first (GET /cmw/program), the static mirror
// /data/cmw-program.json as the offline fallback, a 10-minute module cache.
// Dates are Bogotá calendar days (UTC-5, no DST). "Today" is only known after
// mount (useCmwToday), so the static export never bakes a build-day phase into
// the HTML (React #418).
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  AMO_CLIENT_HEADERS, API_BASE, ASSET_ORIGIN, WRITE_TIMEOUT_MS, fetchT, getToken,
} from '../constants/api';
import type { Lang } from '../i18n/translations';

// ── Types (docs/cmw/DESIGN.md §2) ────────────────────────────────────────────
export type L4 = { es: string; en: string; fr: string; pt: string };
export type CmwCategory = 'main_event' | 'after' | 'wellness' | 'party' | 'sunset' | 'dining' | 'island';
export type CmwTbaField = 'time' | 'price' | 'venue' | 'artist' | 'boarding_point';
export type CmwEventStatus = 'confirmed' | 'tba';
export type CmwArtistStatus = 'tba' | 'confirmed' | 'none';
export type CmwPhase = 'before' | 'during' | 'after';

/** A catalog venue, resolved server-side (or by the sync script) from `venue_id`. */
export type CmwVenue = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  neighborhood: string | null;
};

export type CmwEvent = {
  id: string;
  date: string;
  day_index: number;
  /** As printed. A brand name: never translated. */
  title: string;
  subtitle: L4 | null;
  venue_name: string | null;
  venue_id: string | null;
  venue: CmwVenue | null;
  category: CmwCategory;
  status: CmwEventStatus;
  time: string | null;
  end_time: string | null;
  artist: string | null;
  artist_status: CmwArtistStatus;
  price_info: string | null;
  boarding_point: string | null;
  booking_type: 'concierge';
  image: string | null;
  image_credit: string | null;
  description: L4 | null;
  tba: CmwTbaField[];
};

export type CmwPillar = { key: string; icon: string; label: L4 };
export type CmwPractical = { key: string; icon: string; link: string | null; title: L4; body: L4 };
export type CmwConcierge = {
  display: string;
  assistant: string | null;
  intro: L4 | null;
  assistant_note: L4 | null;
  services: L4[];
};
export type CmwBrand = {
  name: string;
  start_date: string;
  end_date: string;
  days_label: L4 | null;
  tagline: L4 | null;
  taglines: L4[];
  pillars: CmwPillar[];
  hero_image: string | null;
  image_credit: string | null;
  concierge: CmwConcierge;
  access_note: L4 | null;
  practical: CmwPractical[];
};
export type CmwProgram = {
  version: number;
  source_name: string;
  brand: CmwBrand;
  events: CmwEvent[];
  generated_at: string | null;
};

export type ProgramSource = 'live' | 'memory' | 'static';
export type ProgramState = {
  program: CmwProgram;
  fetchedAt: number;
  source: ProgramSource;
  /** true when served from a fallback copy (the backend did not answer). */
  offline: boolean;
};

export class CmwError extends Error {
  readonly kind: 'unavailable' | 'bad_payload';
  constructor(kind: 'unavailable' | 'bad_payload', message: string) {
    super(message);
    this.name = 'CmwError';
    this.kind = kind;
  }
}

// ── Constants (every one of them is printed in the official program) ─────────
export const CMW_NAME = 'Cartagena Music Week';
export const CMW_START = '2026-12-31';
export const CMW_END = '2027-01-07';
export const CMW_HUB_PATH = '/music-week';
export const CMW_HERO_IMAGE = '/images/cmw/hero.jpg';
export const CMW_IMAGE_CREDIT = 'Cartagena Music Week';
/** The program's contact, digits only. */
export const CMW_CONCIERGE_WA = '573116844492';
export const CMW_CONCIERGE_DISPLAY = '+57 311 6844492';
export const CMW_WA_BASE = `https://wa.me/${CMW_CONCIERGE_WA}`;
/** The ONLY artist text while the headline artist is unannounced. */
export const CMW_PLACEHOLDER_ARTIST = 'Very Special Guest';

export const PROGRAM_PATH = '/cmw/program';
export const REQUESTS_PATH = '/cmw/requests';
export const STATIC_PROGRAM_URL = `${ASSET_ORIGIN}/data/cmw-program.json`;
export const PROGRAM_TTL_MS = 10 * 60 * 1000;
/** A fallback copy is retried against the backend much sooner. */
const FALLBACK_TTL_MS = 60 * 1000;

export const CMW_CATEGORIES: readonly CmwCategory[] = [
  'main_event', 'after', 'wellness', 'party', 'sunset', 'dining', 'island',
];
const TBA_FIELDS: readonly CmwTbaField[] = ['time', 'price', 'venue', 'artist', 'boarding_point'];
const LANGS: readonly Lang[] = ['es', 'en', 'fr', 'pt'];

/** Spanish labels (pass through tr()), Ionicon and the SafeImage fallback key. */
export const CMW_CATEGORY_META: Record<CmwCategory, { label: string; icon: string; image: string }> = {
  main_event: { label: 'Evento principal', icon: 'star-outline', image: 'concert' },
  after: { label: 'After', icon: 'moon-outline', image: 'nightlife' },
  wellness: { label: 'Bienestar', icon: 'leaf-outline', image: 'wellness' },
  party: { label: 'Fiesta', icon: 'musical-notes-outline', image: 'nightlife' },
  sunset: { label: 'Sunset', icon: 'sunny-outline', image: 'event' },
  dining: { label: 'Gastronomía', icon: 'restaurant-outline', image: 'gastronomy' },
  island: { label: 'Isla', icon: 'boat-outline', image: 'event' },
};

// ── Small pure helpers ───────────────────────────────────────────────────────
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const EVENT_ID = /^cmw-[a-z0-9][a-z0-9-]{0,79}$/;
const REQUEST_ID = /^cmw-r-[a-z2-7]{8}$/;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ymd = (v: unknown): string | null => (typeof v === 'string' && YMD.test(v) ? v : null);
const hm = (v: unknown): string | null => (typeof v === 'string' && HM.test(v.trim()) ? v.trim() : null);
const imagePath = (v: unknown): string | null => {
  const s = str(v);
  return s && s.startsWith('/images/') && !s.includes('..') ? s : null;
};
const inAppPath = (v: unknown): string | null => {
  const s = str(v);
  return s && /^\/(?![/\\])[A-Za-z0-9/_-]*$/.test(s) ? s : null;
};

/** A complete L4 or null. Missing languages fall back to es so a row still reads. */
const toL4 = (v: unknown): L4 | null => {
  if (!isRecord(v)) return null;
  const es = str(v.es) || str(v.en);
  if (!es) return null;
  return { es, en: str(v.en) || es, fr: str(v.fr) || str(v.en) || es, pt: str(v.pt) || es };
};

/** 4-language picker: <lang> → en → es → ''. */
export const pickL = (o: L4 | null | undefined, lang: Lang): string =>
  (o && (o[lang] || o.en || o.es)) || '';

const asLang = (lang: unknown): Lang => ((LANGS as readonly unknown[]).includes(lang) ? (lang as Lang) : 'es');

// ── Dates (Bogotá, UTC-5, no DST; no Intl, so Hermes and the web agree) ──────
const BOGOTA_OFFSET_MS = 5 * 3600 * 1000;

/** The Bogotá calendar day of an instant, "YYYY-MM-DD". */
export function bogotaYmd(now: Date | number = Date.now()): string {
  const ms = typeof now === 'number' ? now : now.getTime();
  return new Date(ms - BOGOTA_OFFSET_MS).toISOString().slice(0, 10);
}

const parts = (day: string): { y: number; m: number; d: number; dow: number } | null => {
  if (!YMD.test(day)) return null;
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const d = Number(day.slice(8, 10));
  const t = new Date(Date.UTC(y, m - 1, d, 12));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return { y, m, d, dow: t.getUTCDay() };
};

/** Calendar day `n` days after `day` (UTC-noon arithmetic: no device timezone). */
export function plusDays(day: string, n: number): string {
  const p = parts(day);
  if (!p) return day;
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d, 12));
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

// Same month words as backend/cmw.py `_MON`, so the prefilled WhatsApp message
// reads identically whether the server or the phone builds it.
const MONTHS: Record<Lang, readonly string[]> = {
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  pt: ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'],
};
const WEEKDAYS: Record<Lang, readonly string[]> = {
  es: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  fr: ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'],
  pt: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'],
};

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export type DayParts = { day: number; month: string; weekday: string; year: number };

/** The pieces a date chip needs ("31", "dic", "jue"). null when not a date. */
export function dayParts(day: string, lang: Lang): DayParts | null {
  const p = parts(day);
  if (!p) return null;
  const lg = asLang(lang);
  return { day: p.d, month: MONTHS[lg][p.m - 1], weekday: WEEKDAYS[lg][p.dow], year: p.y };
}

/**
 * '31 dic 2026' · 'Dec 31, 2026' · '31 déc. 2026' · '31 dez 2026' (mirror of
 * backend day_label). `weekday` prefixes 'Jue ' / 'Thu, '. '' when not a date.
 */
export function dayLabel(day: string | null | undefined, lang: Lang, opts: { year?: boolean; weekday?: boolean } = {}): string {
  const p = typeof day === 'string' ? parts(day) : null;
  if (!p) return '';
  const lg = asLang(lang);
  const year = opts.year !== false;
  const mon = MONTHS[lg][p.m - 1];
  const core = lg === 'en'
    ? (year ? `${mon} ${p.d}, ${p.y}` : `${mon} ${p.d}`)
    : (year ? `${p.d} ${mon} ${p.y}` : `${p.d} ${mon}`);
  if (!opts.weekday) return core;
  const wd = cap(WEEKDAYS[lg][p.dow]);
  return lg === 'en' ? `${wd}, ${core}` : `${wd} ${core}`;
}

type Window = Pick<CmwBrand, 'start_date' | 'end_date'>;
const DEFAULT_WINDOW: Window = { start_date: CMW_START, end_date: CMW_END };

const windowOf = (brand?: Partial<Window> | null): Window => {
  const s = ymd(brand?.start_date);
  const e = ymd(brand?.end_date);
  return s && e && s <= e ? { start_date: s, end_date: e } : DEFAULT_WINDOW;
};

/** '31 dic 2026 — 7 ene 2027' (`sep` defaults to an em dash, as the program prints it). */
export function rangeLabel(brand: Partial<Window> | null | undefined, lang: Lang, opts: { year?: boolean; sep?: string } = {}): string {
  const w = windowOf(brand);
  const a = dayLabel(w.start_date, lang, { year: opts.year });
  const b = dayLabel(w.end_date, lang, { year: opts.year });
  return `${a} ${opts.sep || '—'} ${b}`;
}

/** The program's days, first to last ("2026-12-31" … "2027-01-07"). */
export function programDays(brand?: Partial<Window> | null): string[] {
  const w = windowOf(brand);
  const out: string[] = [];
  for (let d = w.start_date, i = 0; d <= w.end_date && i < 31; d = plusDays(d, 1), i += 1) out.push(d);
  return out;
}

/** 'before' | 'during' | 'after', in Bogotá time. */
export function phase(now: Date | number = Date.now(), brand?: Partial<Window> | null): CmwPhase {
  return phaseOn(bogotaYmd(now), brand);
}

/** Same rule for a Bogotá day that is already known. */
export function phaseOn(today: string, brand?: Partial<Window> | null): CmwPhase {
  const w = windowOf(brand);
  if (today < w.start_date) return 'before';
  return today > w.end_date ? 'after' : 'during';
}

// ── Defensive normalization ──────────────────────────────────────────────────
const toVenue = (v: unknown, venueId: string | null): CmwVenue | null => {
  if (!isRecord(v) || !venueId) return null;
  const id = str(v.id);
  const name = str(v.name);
  if (!id || id !== venueId || !name) return null;
  const lat = num(v.lat);
  const lng = num(v.lng);
  const real = lat !== null && lng !== null && !(lat === 0 && lng === 0);
  return { id, name, lat: real ? lat : null, lng: real ? lng : null, neighborhood: str(v.neighborhood) };
};

const toCategory = (v: unknown): CmwCategory | null =>
  ((CMW_CATEGORIES as readonly unknown[]).includes(v) ? (v as CmwCategory) : null);

const toPrice = (v: unknown, lang: Lang | null): string | null => {
  if (typeof v === 'string') return str(v);
  const l4 = toL4(v);
  return l4 ? pickL(l4, lang || 'es') : null;
};

function normalizeEvent(raw: unknown, brand: Window): CmwEvent | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const date = ymd(raw.date);
  const title = str(raw.title);
  const category = toCategory(raw.category);
  if (!id || !EVENT_ID.test(id) || !date || !title || !category) return null;
  if (date < brand.start_date || date > brand.end_date) return null;

  const tba = Array.isArray(raw.tba)
    ? TBA_FIELDS.filter((f) => (raw.tba as unknown[]).includes(f))
    : [...TBA_FIELDS]; // no list ⇒ nothing is confirmed
  const open = (f: CmwTbaField): boolean => tba.includes(f);

  // A field that is still to be confirmed carries NO value, whatever the payload says.
  const time = open('time') ? null : hm(raw.time);
  const venueOpen = open('venue');
  const venueName = venueOpen ? null : str(raw.venue_name);
  const venueId = venueOpen || !venueName ? null : str(raw.venue_id);
  const artistStatus: CmwArtistStatus =
    raw.artist_status === 'confirmed' && !open('artist') ? 'confirmed'
      : raw.artist_status === 'tba' || open('artist') ? 'tba' : 'none';
  const artistText = str(raw.artist);
  const artist = artistStatus === 'confirmed'
    ? (artistText && artistText !== CMW_PLACEHOLDER_ARTIST ? artistText : null)
    : artistStatus === 'tba' ? CMW_PLACEHOLDER_ARTIST : null;
  const unannounced = venueOpen || open('boarding_point') || artistStatus === 'tba' || !venueName;

  const dayIndex = Math.round((Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
    - Date.UTC(Number(brand.start_date.slice(0, 4)), Number(brand.start_date.slice(5, 7)) - 1, Number(brand.start_date.slice(8, 10)))) / 86400000) + 1;

  return {
    id,
    date,
    day_index: dayIndex,
    title,
    subtitle: toL4(raw.subtitle),
    venue_name: venueName,
    venue_id: venueId,
    venue: toVenue(raw.venue, venueId),
    category,
    status: raw.status === 'confirmed' && !unannounced ? 'confirmed' : 'tba',
    time,
    end_time: time ? hm(raw.end_time) : null,
    artist,
    artist_status: artistStatus,
    price_info: open('price') ? null : toPrice(raw.price_info, null),
    boarding_point: open('boarding_point') ? null : str(raw.boarding_point),
    booking_type: 'concierge',
    image: imagePath(raw.image),
    image_credit: str(raw.image_credit),
    description: toL4(raw.description),
    tba,
  };
}

const toL4List = (v: unknown): L4[] =>
  (Array.isArray(v) ? v.map(toL4).filter((x): x is L4 => !!x) : []);

function normalizeBrand(raw: unknown): CmwBrand {
  const b = isRecord(raw) ? raw : {};
  const w = windowOf({ start_date: str(b.start_date) || undefined, end_date: str(b.end_date) || undefined });
  const con = isRecord(b.concierge) ? b.concierge : {};
  // The number is a constant. The payload's display text is used only when it
  // is the same number, so the label can never disagree with the link.
  const display = str(con.display);
  const sameNumber = !!display && display.replace(/\D/g, '') === CMW_CONCIERGE_WA;
  const pillars: CmwPillar[] = Array.isArray(b.pillars)
    ? b.pillars.flatMap((p): CmwPillar[] => {
      if (!isRecord(p)) return [];
      const key = str(p.key);
      const label = toL4(p.label);
      return key && label ? [{ key, icon: str(p.icon) || 'sparkles', label }] : [];
    })
    : [];
  const practical: CmwPractical[] = Array.isArray(b.practical)
    ? b.practical.flatMap((p): CmwPractical[] => {
      if (!isRecord(p)) return [];
      const key = str(p.key);
      const title = toL4(p.title);
      const body = toL4(p.body);
      return key && title && body
        ? [{ key, icon: str(p.icon) || 'information-circle', link: inAppPath(p.link), title, body }]
        : [];
    })
    : [];
  return {
    name: CMW_NAME,
    start_date: w.start_date,
    end_date: w.end_date,
    days_label: toL4(b.days_label),
    tagline: toL4(b.tagline),
    taglines: toL4List(b.taglines),
    pillars,
    hero_image: imagePath(b.hero_image),
    image_credit: str(b.image_credit),
    concierge: {
      display: sameNumber && display ? display : CMW_CONCIERGE_DISPLAY,
      assistant: str(con.assistant),
      intro: toL4(con.intro),
      assistant_note: toL4(con.assistant_note),
      services: toL4List(con.services),
    },
    access_note: toL4(b.access_note),
    practical,
  };
}

/** Accepts the API envelope's `data` or the static mirror. null = unusable. */
export function normalizeProgram(raw: unknown): CmwProgram | null {
  if (!isRecord(raw) || !Array.isArray(raw.events) || !isRecord(raw.brand)) return null;
  const brand = normalizeBrand(raw.brand);
  const seen = new Set<string>();
  const events: CmwEvent[] = [];
  for (const row of raw.events) {
    const ev = normalizeEvent(row, brand);
    if (!ev || seen.has(ev.id)) continue;
    seen.add(ev.id);
    events.push(ev);
  }
  if (!events.length) return null;
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)); // stable: printed order within a day
  return {
    version: num(raw.version) ?? 1,
    source_name: str(raw.source_name) || 'Programa oficial Cartagena Music Week',
    brand,
    events,
    generated_at: str(raw.generated_at),
  };
}

// ── Loader: backend-first, static mirror fallback, 10-minute module cache ────
let CACHE: ProgramState | null = null;
let INFLIGHT: Promise<ProgramState> | null = null;

const isFresh = (s: ProgramState, now: number): boolean =>
  now - s.fetchedAt < (s.offline ? FALLBACK_TTL_MS : PROGRAM_TTL_MS);

/** The cached program when there is one (fresh or not). Never fetches. */
export function peekProgram(): ProgramState | null {
  return CACHE ? { ...CACHE, source: 'memory' } : null;
}

/** Test / sign-out hook. */
export function clearProgramCache(): void {
  CACHE = null;
  INFLIGHT = null;
}

async function fetchLive(): Promise<CmwProgram> {
  const res = await fetchT(`${API_BASE}${PROGRAM_PATH}`, { headers: { Accept: 'application/json', ...AMO_CLIENT_HEADERS } });
  if (!res.ok) throw new CmwError('unavailable', `program ${res.status}`);
  const body: unknown = await res.json();
  const data = isRecord(body) && 'data' in body ? body.data : body;
  const program = normalizeProgram(data);
  if (!program) throw new CmwError('bad_payload', 'program payload');
  return program;
}

/** The static mirror written by scripts/sync-cmw-data.mjs. null when unusable. */
export async function loadStaticProgram(): Promise<ProgramState | null> {
  try {
    const res = await fetchT(STATIC_PROGRAM_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const program = normalizeProgram(await res.json());
    return program ? { program, fetchedAt: Date.now(), source: 'static', offline: true } : null;
  } catch (err) {
    console.error('[cmw] static mirror failed', err instanceof Error ? err.name : 'error');
    return null;
  }
}

export async function loadProgram(opts: { force?: boolean } = {}): Promise<ProgramState> {
  const now = Date.now();
  if (!opts.force && CACHE && isFresh(CACHE, now)) return { ...CACHE, source: 'memory' };
  if (INFLIGHT) return INFLIGHT;
  INFLIGHT = (async (): Promise<ProgramState> => {
    try {
      const program = await fetchLive();
      CACHE = { program, fetchedAt: Date.now(), source: 'live', offline: false };
      return CACHE;
    } catch (err) {
      console.error('[cmw] program fetch failed', err instanceof Error ? err.name : 'error');
    }
    const mirror = await loadStaticProgram();
    if (mirror) {
      CACHE = mirror;
      return mirror;
    }
    if (CACHE) return { ...CACHE, source: 'memory', offline: true };
    throw new CmwError('unavailable', 'program unavailable');
  })().finally(() => { INFLIGHT = null; });
  return INFLIGHT;
}

// ── Queries ──────────────────────────────────────────────────────────────────
const programOr = (program?: CmwProgram | null): CmwProgram | null => program || CACHE?.program || null;

/** The events printed for a Bogotá day, in printed order. */
export function eventsOn(day: string, program?: CmwProgram | null): CmwEvent[] {
  const p = programOr(program);
  return p ? p.events.filter((e) => e.date === day) : [];
}

/** Today's events (Bogotá). Empty outside the program's dates. */
export function todayEvents(now: Date | number = Date.now(), program?: CmwProgram | null): CmwEvent[] {
  return eventsOn(bogotaYmd(now), program);
}

export function eventById(id: string | null | undefined, program?: CmwProgram | null): CmwEvent | null {
  const p = programOr(program);
  return (id && p?.events.find((e) => e.id === id)) || null;
}

export const isTba = (ev: CmwEvent, field: CmwTbaField): boolean => ev.tba.includes(field);

/** Real catalog coordinates, or nothing: the only way to get "Cómo llegar". */
export function venueCoords(ev: CmwEvent): { lat: number; lng: number; label: string } | null {
  const v = ev.venue;
  if (!v || v.lat === null || v.lng === null) return null;
  return { lat: v.lat, lng: v.lng, label: v.name };
}

/** Spanish source text for a field that is still to be confirmed (pass through tr()). */
export function tbaLabel(field: CmwTbaField): string {
  switch (field) {
    case 'time': return 'Hora por confirmar';
    case 'venue': return 'Lugar por confirmar';
    case 'artist': return 'Artista por confirmar';
    case 'boarding_point': return 'Punto de embarque por confirmar';
    default: return 'Consultar'; // price: always on request
  }
}

/** "20:00" / "20:00 – 02:00", or null while the time is to be confirmed. */
export function timeText(ev: CmwEvent): string | null {
  if (!ev.time) return null;
  return ev.end_time ? `${ev.time} – ${ev.end_time}` : ev.time;
}

/** Where an event happens, as far as the program says. `tba` ⇒ pass `text` through tr(). */
export function placeText(ev: CmwEvent): { text: string; tba: boolean } {
  if (ev.venue_name) return { text: ev.venue_name, tba: false };
  if (isTba(ev, 'boarding_point')) return { text: tbaLabel('boarding_point'), tba: true };
  if (ev.boarding_point) return { text: ev.boarding_point, tba: false };
  return { text: tbaLabel('venue'), tba: true };
}

// ── WhatsApp (mirror of backend/cmw.py whatsapp_text: never personal data) ───
type WaCopy = { event: string; general: string; one: string; many: string; rid: string };
const WA_T: Record<Lang, WaCopy> = {
  es: {
    event: 'Hola, quiero solicitar acceso a {title} ({date}) de Cartagena Music Week',
    general: 'Hola, quiero información sobre Cartagena Music Week ({range})',
    one: ' para 1 persona', many: ' para {n} personas', rid: ' Solicitud {rid}.',
  },
  en: {
    event: "Hi, I'd like to request access to {title} ({date}) at Cartagena Music Week",
    general: "Hi, I'd like information about Cartagena Music Week ({range})",
    one: ' for 1 person', many: ' for {n} people', rid: ' Request {rid}.',
  },
  fr: {
    event: "Bonjour, je souhaite demander l'accès à {title} ({date}) de Cartagena Music Week",
    general: 'Bonjour, je souhaite des informations sur Cartagena Music Week ({range})',
    one: ' pour 1 personne', many: ' pour {n} personnes', rid: ' Demande {rid}.',
  },
  pt: {
    event: 'Olá, quero solicitar acesso a {title} ({date}) da Cartagena Music Week',
    general: 'Olá, quero informações sobre a Cartagena Music Week ({range})',
    one: ' para 1 pessoa', many: ' para {n} pessoas', rid: ' Pedido {rid}.',
  },
};

export type WhatsAppExtras = {
  partySize?: number | null;
  requestId?: string | null;
  brand?: Partial<Window> | null;
};

/** The message the guest sends: the event as printed, its date, the party size, the request id. */
export function whatsappText(event: Pick<CmwEvent, 'title' | 'date'> | null, lang: Lang, extras: WhatsAppExtras = {}): string {
  const lg = asLang(lang);
  const t = WA_T[lg];
  const title = event ? str(event.title) : null;
  let text = title && event
    ? t.event.replace('{title}', title).replace('{date}', dayLabel(event.date, lg))
    : t.general.replace('{range}', rangeLabel(extras.brand, lg, { sep: '–' }));
  const n = extras.partySize;
  if (typeof n === 'number' && Number.isInteger(n) && n >= 1) text += n === 1 ? t.one : t.many.replace('{n}', String(n));
  text += '.';
  if (typeof extras.requestId === 'string' && REQUEST_ID.test(extras.requestId)) text += t.rid.replace('{rid}', extras.requestId);
  return text;
}

/** https://wa.me/<the program's contact>?text=… — built on the phone, so it works offline too. */
export function whatsappUrl(event: Pick<CmwEvent, 'title' | 'date'> | null, lang: Lang, extras: WhatsAppExtras = {}): string {
  return `${CMW_WA_BASE}?text=${encodeURIComponent(whatsappText(event, lang, extras))}`;
}

/** true only for a link to the program's own concierge number. */
export function isCmwWhatsApp(url: unknown): url is string {
  return typeof url === 'string' && /^https:\/\/wa\.me\/573116844492(?:[/?#][^\s]*)?$/.test(url.trim());
}

// ── Luna actions: the public hub URL opens in-app ────────────────────────────
const CMW_WEB_URL = /^https:\/\/(?:www\.)?amocartagena\.co\/music-week(?:\/(cmw-[a-z0-9][a-z0-9-]{0,79}))?\/?(?:[?#][^\s]*)?$/;

/**
 * 'https://www.amocartagena.co/music-week[/<event id>]' → '/music-week[/<id>]'.
 * Anything else → null (the caller keeps opening it as an external link).
 */
export function cmwInAppPath(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const m = CMW_WEB_URL.exec(url.trim());
  if (!m) return null;
  return m[1] ? `${CMW_HUB_PATH}/${m[1]}` : CMW_HUB_PATH;
}

export type CmwActionLinks = { path: string | null; whatsapp: string | null };

/** The CMW links inside a Luna reply's actions (external_link only). */
export function cmwActionLinks(actions: unknown): CmwActionLinks {
  const out: CmwActionLinks = { path: null, whatsapp: null };
  if (!Array.isArray(actions)) return out;
  for (const a of actions) {
    if (!isRecord(a) || a.type !== 'external_link') continue;
    const path = cmwInAppPath(a.url);
    if (path && !out.path) out.path = path;
    else if (isCmwWhatsApp(a.url) && !out.whatsapp) out.whatsapp = a.url.trim();
  }
  return out;
}

// ── Concierge request ────────────────────────────────────────────────────────
export type CmwContactType = 'whatsapp' | 'email';
export type CmwRequestBody = {
  event_id: string | null;
  name: string;
  party_size: number;
  contact: { type: CmwContactType; value: string };
  note: string;
  lang: Lang;
  consent: true;
  /** Honeypot: a person never sees it, so it is always ''. */
  website: string;
};

export const NAME_MIN = 2;
export const NAME_MAX = 80;
export const PARTY_MIN = 1;
export const PARTY_MAX = 50;
export const NOTE_MAX = 500;

export type CmwFieldError = 'name' | 'party_size' | 'contact' | 'note';

const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)+$/;

/** Same rule as the backend: an optional '+', then 7–15 digits; separators are ignored. */
export function isValidPhone(value: string): boolean {
  const s = value.trim();
  if (!s || /[^\d+\s().-]/.test(s)) return false;
  const plus = s.startsWith('+');
  if ((s.match(/\+/g) || []).length > (plus ? 1 : 0)) return false;
  let digits = s.replace(/\D/g, '');
  if (!plus && digits.startsWith('00')) digits = digits.slice(2);
  return digits.length >= 7 && digits.length <= 15;
}

export function isValidEmail(value: string): boolean {
  const s = value.trim();
  return s.length <= 254 && !s.includes('..') && EMAIL.test(s);
}

/** Spanish source text per field (pass through tr()). */
export const FIELD_ERROR_COPY: Record<CmwFieldError, string> = {
  name: 'Escribe tu nombre (2 a 80 caracteres).',
  party_size: 'El número de personas debe estar entre 1 y 50.',
  contact: 'Escribe un número de WhatsApp con indicativo o un correo válido.',
  note: 'La nota puede tener hasta 500 caracteres.',
};

export function validateRequest(body: Pick<CmwRequestBody, 'name' | 'party_size' | 'contact' | 'note'>): CmwFieldError[] {
  const errors: CmwFieldError[] = [];
  const name = body.name.trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) errors.push('name');
  if (!Number.isInteger(body.party_size) || body.party_size < PARTY_MIN || body.party_size > PARTY_MAX) errors.push('party_size');
  const ok = body.contact.type === 'email' ? isValidEmail(body.contact.value) : isValidPhone(body.contact.value);
  if (!ok) errors.push('contact');
  if (body.note.length > NOTE_MAX) errors.push('note');
  return errors;
}

export type CmwFailureKind = 'validation' | 'rate_limited' | 'unavailable' | 'network';
export type CmwSubmitResult =
  | { ok: true; requestId: string; whatsappUrl: string }
  | { ok: false; kind: CmwFailureKind; code: string | null; status: number | null };

/** Backend error code → Spanish source text (pass through tr()). Unknown codes use the kind. */
export const ERROR_COPY: Record<string, string> = {
  invalid_name: FIELD_ERROR_COPY.name,
  invalid_party_size: FIELD_ERROR_COPY.party_size,
  invalid_contact: FIELD_ERROR_COPY.contact,
  invalid_note: FIELD_ERROR_COPY.note,
  unknown_event: 'Ese evento no está en el programa oficial.',
  consent_required: 'Necesitamos tu autorización para que el concierge te contacte.',
  rate_limited: 'Demasiadas solicitudes. Intenta de nuevo en una hora o escríbenos por WhatsApp.',
  unavailable: 'El servicio no está disponible en este momento. Intenta de nuevo o escríbenos por WhatsApp.',
  invalid_request: 'No pudimos enviar tu solicitud. Escríbenos por WhatsApp.',
};
const KIND_COPY: Record<CmwFailureKind, string> = {
  validation: ERROR_COPY.invalid_request,
  rate_limited: ERROR_COPY.rate_limited,
  unavailable: ERROR_COPY.unavailable,
  network: ERROR_COPY.unavailable,
};

/** The Spanish source text for a failed submit (pass through tr()). Never an internal detail. */
export function failureCopy(result: Extract<CmwSubmitResult, { ok: false }>): string {
  return (result.code && ERROR_COPY[result.code]) || KIND_COPY[result.kind];
}

/**
 * POST /cmw/requests. Never throws: a failure is a value, so the sheet can show
 * the error AND keep the WhatsApp button working. Nothing about the person is
 * logged. The only success state is "received".
 */
export async function submitRequest(body: CmwRequestBody): Promise<CmwSubmitResult> {
  const event = eventById(body.event_id);
  const localUrl = (requestId: string | null): string =>
    whatsappUrl(event, body.lang, { partySize: body.party_size, requestId, brand: CACHE?.program.brand });
  let res: Response;
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...AMO_CLIENT_HEADERS,
    };
    // Signed-in guests: the row is tied to the account, so deleting the account purges it.
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    res = await fetchT(`${API_BASE}${REQUESTS_PATH}`, { method: 'POST', headers, body: JSON.stringify(body) }, WRITE_TIMEOUT_MS);
  } catch (err) {
    console.error('[cmw] request failed', err instanceof Error ? err.name : 'error');
    return { ok: false, kind: 'network', code: null, status: null };
  }
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null; // not JSON: the status decides
  }
  const env = isRecord(payload) ? payload : {};
  if (res.ok) {
    const data = isRecord(env.data) ? env.data : {};
    const requestId = str(data.request_id);
    if (requestId && REQUEST_ID.test(requestId)) {
      const served = str(data.whatsapp_url);
      return { ok: true, requestId, whatsappUrl: served && isCmwWhatsApp(served) ? served : localUrl(requestId) };
    }
    console.error('[cmw] request answered without an id', res.status);
    return { ok: false, kind: 'unavailable', code: null, status: res.status };
  }
  const code = str(env.error);
  const kind: CmwFailureKind = res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'unavailable' : 'validation';
  console.error('[cmw] request rejected', res.status, code || '');
  return { ok: false, kind, code: code && /^[a-z_]{1,40}$/.test(code) ? code : null, status: res.status };
}

// ── Hooks ────────────────────────────────────────────────────────────────────
/** Bogotá "today", null until mount (never rendered into the static HTML). */
export function useCmwToday(): string | null {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setToday(bogotaYmd(Date.now()));
    tick();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') tick(); });
    const id = setInterval(tick, 60 * 1000);
    return () => { sub.remove(); clearInterval(id); };
  }, []);
  return today;
}

export type UseProgram = {
  state: ProgramState | null;
  program: CmwProgram | null;
  loading: boolean;
  error: boolean;
  reload: () => void;
};

/**
 * The program for a screen. Paints a cached copy at once, shows the static
 * mirror while the backend answers, then the backend's copy replaces it.
 * `enabled: false` never touches the network (Home's promo before the week).
 */
export function useCmwProgram(enabled: boolean = true): UseProgram {
  const [state, setState] = useState<ProgramState | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<boolean>(false);
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const live = { done: false };
    const cached = peekProgram();
    if (cached) setState(cached);
    setLoading(true);
    setError(false);
    if (!cached) {
      loadStaticProgram()
        .then((mirror) => { if (!cancelled && !live.done && mirror) setState((cur) => cur || mirror); })
        .catch((err) => { console.error('[cmw] mirror', err instanceof Error ? err.name : 'error'); });
    }
    loadProgram({ force: attempt > 0 })
      .then((s) => {
        live.done = true;
        if (cancelled) return;
        setState(s);
        setLoading(false);
      })
      .catch((err) => {
        live.done = true;
        console.error('[cmw] load', err instanceof Error ? err.name : 'error');
        if (cancelled) return;
        setLoading(false);
        setError(true);
      });
    return () => { cancelled = true; };
  }, [enabled, attempt]);

  const reload = useCallback(() => { if (alive.current) setAttempt((n) => n + 1); }, []);
  return { state, program: state?.program || null, loading, error: error && !state, reload };
}
