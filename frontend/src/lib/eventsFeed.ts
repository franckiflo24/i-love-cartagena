// EVENTS-ELITE — the ONE client reader for city events ("Qué pasa en Cartagena").
//
// Contract: docs/events-elite/DESIGN.md §8 (PublicEvent), §10, §13 J1, §15 Q5/R5/T5.
// Honesty spine: an event is shown only when the backend's verified feed says so.
// This loader never invents, never widens and never resurrects:
//   • live 200 from GET /api/events/feed is used as-is (after defensive shape checks);
//   • a 404 is an ANSWER (the feed does not exist) → error state, cache cleared;
//   • a network error / timeout / 5xx falls back to the last good copy — the
//     in-memory cache, the swr copy or the static mirror /data/events-feed.json —
//     ONLY when its `generated_at` is ≤ 36 h old, flagged `offline` so screens show
//     "Sin conexión · agenda del …", swap the trust line for "sin actualizar" and
//     disable NearbyEventsCard / Avísame. Anything older → error ("No pudimos
//     cargar la agenda"). Finished rows are always dropped.
// It deliberately does NOT go through api.get: that helper's static/swr fallback
// fires on a 404 and has no freshness bound (a hidden event would come back).
//
// Dates are Bogotá calendar days (America/Bogota, UTC-5, no DST) via eventTime.ts.
// Bucket math must run AFTER mount (useEventsFeed's `today` is null during the
// static export) so no build-time date text reaches the HTML (React #418).
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { API_BASE, ASSET_ORIGIN, fetchT } from '../constants/api';
import { swr } from './swrCache';
import { bogotaToday, bogotaTime } from './eventTime';
import { monthShort, weekdayShort } from './formatDate';
import type { Lang } from '../i18n/translations';

// ── Types (§8 PublicEvent + origin, status_reason, address, is_umbrella) ──────
export type L4 = { es: string; en?: string; fr?: string; pt?: string };
export type EventCategory =
  | 'concert' | 'festival' | 'cultural' | 'nightlife' | 'gastronomic' | 'sports' | 'family' | 'civic';
export type EventConfidence = 'HIGH' | 'VERIFY';
export type EventStatus = 'published' | 'review' | 'hidden' | 'expired' | 'date_tbc';
export type EventOrigin = 'anchor' | 'pipeline' | 'partner' | 'legacy-import';
export type EventPrice = {
  is_free: boolean | null;
  min_cop: number | null;
  max_cop: number | null;
  text: string | null;
};

export type PublicEvent = {
  event_id: string;
  title: L4;
  description: L4;
  category: EventCategory;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  date_tbc_note: L4 | null;
  venue_name: string;
  zone: string | null;
  lat: number | null;
  lng: number | null;
  price: EventPrice;
  ticket_url: string | null;
  source_url: string;
  source_name: string;
  second_source_name: string | null;
  last_verified: string | null;
  confidence: EventConfidence;
  status: EventStatus;
  sold_out: boolean;
  image_url: string | null;
  image_credit: string | null;
  notif_eligible: boolean;
  parent_id: string | null;
  is_verified: boolean;
  origin: EventOrigin;
  status_reason: string | null;
  address: string | null;
  is_umbrella: boolean;
  /** §16.1 score (backend `events_gate.prominence`); client fallback when absent. */
  prominence: number;
  /** §16.1 city headline event (registry allowlist, never an LLM). */
  flagship: boolean;
};

export type FeedPayload = {
  generated_at: string;
  today: string;
  events: PublicEvent[];
  date_tbc: PublicEvent[];
};

export type FeedSource = 'live' | 'memory' | 'swr' | 'static';

/** Cache entry (§13 J1 `{data, fetchedAt, day}`) + where it came from. */
export type FeedState = {
  data: FeedPayload;
  fetchedAt: number;
  day: string;
  source: FeedSource;
  /** true when served from a fallback copy (network/5xx) — show the banner. */
  offline: boolean;
};

export type FeedErrorKind = 'not_found' | 'unavailable' | 'bad_payload';
export class FeedError extends Error {
  readonly kind: FeedErrorKind;
  constructor(kind: FeedErrorKind, message: string) {
    super(message);
    this.name = 'FeedError';
    this.kind = kind;
  }
}

// ── Constants ────────────────────────────────────────────────────────────────
export const FEED_PATH = '/events/feed';
export const STATIC_FEED_URL = `${ASSET_ORIGIN}/data/events-feed.json`;
export const FEED_TTL_MS = 10 * 60 * 1000;
export const FALLBACK_MAX_AGE_H = 36;
export const HOME_STATIC_MAX_AGE_H = 24;
const STALE_HIGH_MS = 72 * 3600 * 1000; // §13 B1: HIGH decays to VERIFY after 72 h

/** Mirror of backend events_gate.PLACEHOLDER_COORDS (§15 Q5). Never "geocoded". */
export const PLACEHOLDER_COORDS: readonly (readonly [number, number])[] = [
  [10.4236, -75.5483],
  [10.3932277, -75.4832311],
  [10.3910, -75.4794],
  [10.3997, -75.5144],
];
const PLACEHOLDER_TOL = 1e-3;

export const EVENT_CATEGORIES: readonly EventCategory[] = [
  'concert', 'festival', 'cultural', 'nightlife', 'gastronomic', 'sports', 'family', 'civic',
];

/** Spanish labels (pass through tr()), Ionicon, accent colour, SafeImage category key. */
export const CATEGORY_META: Record<EventCategory, { label: string; icon: string; color: string; image: string }> = {
  concert:     { label: 'Concierto',   icon: 'musical-notes',   color: '#A855F7', image: 'concert' },
  festival:    { label: 'Festival',    icon: 'sparkles',        color: '#F43F5E', image: 'festival' },
  cultural:    { label: 'Cultural',    icon: 'color-palette',   color: '#8B5CF6', image: 'cultural' },
  nightlife:   { label: 'Nightlife',   icon: 'moon',            color: '#EC4899', image: 'nightlife' },
  gastronomic: { label: 'Gastronomía', icon: 'restaurant',      color: '#F97316', image: 'gastronomy' },
  sports:      { label: 'Deportes',    icon: 'bicycle',         color: '#10B981', image: 'sports' },
  family:      { label: 'Familia',     icon: 'people',          color: '#06B6D4', image: 'activity' },
  civic:       { label: 'Cívico',      icon: 'flag',            color: '#39B8FF', image: 'event' },
};

// Older payloads (legacy /events/{id}, partner rows) use other words.
const LEGACY_CATEGORY: Record<string, EventCategory> = {
  music: 'concert', concierto: 'concert', live_music: 'concert',
  party: 'nightlife', fiesta: 'nightlife', club: 'nightlife',
  gastronomy: 'gastronomic', food: 'gastronomic',
  art: 'cultural', culture: 'cultural', religious: 'cultural', literary: 'cultural', theater: 'cultural',
  holiday: 'civic', parade: 'civic',
  sport: 'sports',
};

// ── Small pure helpers ───────────────────────────────────────────────────────
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isHttp = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u.trim());
const ymd = (v: unknown): string | null => (typeof v === 'string' && YMD.test(v.slice(0, 10)) ? v.slice(0, 10) : null);
const hm = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, 5);
  return HM.test(t) ? t : null;
};

const toL4 = (v: unknown): L4 | null => {
  if (typeof v === 'string') return v.trim() ? { es: v.trim() } : null;
  if (!isRecord(v)) return null;
  const es = str(v.es) || str(v.en);
  if (!es) return null;
  const out: L4 = { es };
  const en = str(v.en); const fr = str(v.fr); const pt = str(v.pt);
  if (en) out.en = en;
  if (fr) out.fr = fr;
  if (pt) out.pt = pt;
  return out;
};

const toCategory = (v: unknown): EventCategory => {
  const k = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if ((EVENT_CATEGORIES as readonly string[]).includes(k)) return k as EventCategory;
  return LEGACY_CATEGORY[k] || 'cultural';
};

const toStatus = (v: unknown): EventStatus | null =>
  v === 'published' || v === 'review' || v === 'hidden' || v === 'expired' || v === 'date_tbc' ? v : null;

const toOrigin = (v: unknown): EventOrigin =>
  v === 'anchor' || v === 'pipeline' || v === 'partner' || v === 'legacy-import' ? v : 'pipeline';

// ── §16.1 Prominence (mirror of backend events_gate.prominence) ─────────────
// The backend sends `prominence` + `flagship` on every PublicEvent. An older
// payload (swr copy, static mirror, pre-§16 backend) lacks them, so the client
// recomputes the SAME deterministic weights. The flagship fallback is a mirror
// of the registry's series allowlist (title prefixes of the §16.1 anchors) — it
// only orders rows the feed already vouches for; it never adds or dates one.
export const CATEGORY_POINTS: Record<EventCategory, number> = {
  festival: 40, concert: 35, sports: 25, cultural: 20, gastronomic: 15, family: 15, nightlife: 10, civic: 10,
};

const FLAGSHIP_SERIES: readonly string[] = [
  'cartagena festival de musica',
  'hay festival cartagena',
  'ficci',
  'ironman 70.3 cartagena',
  'fiestas de independencia',
  'gran desfile de independencia',
  'festival nautico de la independencia',
];

/** Mirror of the tier-1 entries of backend events_gate.TIER_BY_DOMAIN (+10 in §16.1). */
const TIER1_DOMAINS: readonly string[] = [
  'cartagenamusicfestival.com', 'hayfestival.com', 'ficcifestival.com', 'ironman.com', 'cartagena.gov.co', 'ipcc.gov.co',
];

/** Source tier for the prominence fallback: 1 for a mirrored tier-1 organizer domain, else unknown. */
export function sourceTierFallback(sourceUrl: string): number | null {
  const m = sourceUrl.match(/^https?:\/\/([^/?#:]+)/i);
  if (!m) return null;
  const host = m[1].toLowerCase();
  return TIER1_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`)) ? 1 : null;
}

const ACCENTS: Record<string, string> = {
  á: 'a', à: 'a', ä: 'a', â: 'a', é: 'e', è: 'e', ë: 'e', ê: 'e', í: 'i', ì: 'i', ï: 'i', î: 'i',
  ó: 'o', ò: 'o', ö: 'o', ô: 'o', ú: 'u', ù: 'u', ü: 'u', û: 'u', ñ: 'n', ç: 'c',
};
const normTitle = (s: string): string =>
  s.toLowerCase().replace(/[áàäâéèëêíìïîóòöôúùüûñç]/g, (c) => ACCENTS[c] || c).replace(/\s+/g, ' ').trim();

type ProminenceInput = {
  category: EventCategory;
  flagship: boolean;
  is_umbrella: boolean;
  parent_id: string | null;
  confidence: EventConfidence;
  origin: EventOrigin;
  source_tier?: number | null;
  series?: boolean;
};

/** §16.1 — pure, same table as the backend. Series/recurring rows are never promoted. */
export function computeProminence(i: ProminenceInput): number {
  if (i.series) return 0;
  let p = CATEGORY_POINTS[i.category] ?? 0;
  if (i.flagship) p += 50;
  if (i.is_umbrella) p += 10;
  if (i.source_tier === 1) p += 10;
  if (i.confidence === 'HIGH') p += 10;
  if (i.parent_id) p -= 10;
  if (i.origin === 'partner') p -= 5;
  return p;
}

/** Client mirror of the flagship series allowlist (used only when the payload has no `flagship`). */
export function isFlagshipSeries(titleEs: string, origin: EventOrigin): boolean {
  if (origin !== 'anchor' && origin !== 'pipeline') return false;
  const t = normTitle(titleEs);
  return FLAGSHIP_SERIES.some((p) => t.startsWith(p));
}

/** True when (lat,lng) is one of the known placeholder points (within 1e-3). */
export function isPlaceholderCoord(lat: number, lng: number): boolean {
  return PLACEHOLDER_COORDS.some(([a, b]) => Math.abs(lat - a) <= PLACEHOLDER_TOL && Math.abs(lng - b) <= PLACEHOLDER_TOL);
}

/** Real, non-placeholder coordinates — the only ones a pin or a distance may use. */
export function hasRealCoords(ev: Pick<PublicEvent, 'lat' | 'lng'>): ev is PublicEvent & { lat: number; lng: number } {
  return typeof ev.lat === 'number' && typeof ev.lng === 'number'
    && Number.isFinite(ev.lat) && Number.isFinite(ev.lng)
    && !isPlaceholderCoord(ev.lat, ev.lng);
}

/** 4-language picker: <lang> → es → en → '' (§2: missing langs fall back to es). */
export function pickL(o: L4 | null | undefined, lang: Lang): string {
  if (!o) return '';
  return (o[lang] || o.es || o.en || '').trim();
}

/** Normalise one API row. `feedOnly` drops anything that is not published/date_tbc. */
export function normalizeEvent(raw: unknown, opts: { feedOnly: boolean; nowMs?: number }): PublicEvent | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.event_id);
  // §2: event_id is "ce-…". Legacy ids (evt_*, pe_*, slugs) never render here.
  if (!id || !id.startsWith('ce-')) return null;
  const status = toStatus(raw.status);
  if (!status) return null;
  if (opts.feedOnly && status !== 'published' && status !== 'date_tbc') return null;
  const title = toL4(raw.title);
  if (!title) return null;
  const sourceUrl = isHttp(raw.source_url) ? String(raw.source_url).trim() : '';
  // No source → no show. A hidden/review/expired row may expose only its reason.
  if ((status === 'published' || status === 'date_tbc') && !sourceUrl) return null;

  const tbc = status === 'date_tbc';
  // Hidden/review rows never carry a date as if it were live (§13 J2); date_tbc never has one.
  const datesAllowed = status === 'published' || status === 'expired';
  const start = datesAllowed ? ymd(raw.start_date) : null;
  if (status === 'published' && !start) return null;
  const endRaw = datesAllowed ? ymd(raw.end_date) : null;
  const end = start ? (endRaw && endRaw >= start ? endRaw : start) : null;

  let lat = num(raw.lat);
  let lng = num(raw.lng);
  if (lat === null || lng === null || isPlaceholderCoord(lat, lng)) { lat = null; lng = null; }

  const p = isRecord(raw.price) ? raw.price : {};
  const price: EventPrice = {
    is_free: p.is_free === true ? true : p.is_free === false ? false : null,
    min_cop: num(p.min_cop),
    max_cop: num(p.max_cop),
    text: str(p.text),
  };

  const img = str(raw.image_url);
  const lastVerified = str(raw.last_verified);
  let confidence: EventConfidence = raw.confidence === 'HIGH' ? 'HIGH' : 'VERIFY';
  // Read-time decay mirror (§13 B1): a copy served later must not keep "verified".
  if (confidence === 'HIGH') {
    const lv = lastVerified ? Date.parse(lastVerified) : NaN;
    const now = opts.nowMs ?? Date.now();
    if (!Number.isFinite(lv) || now - lv > STALE_HIGH_MS) confidence = 'VERIFY';
  }
  const origin = toOrigin(raw.origin);
  if (origin === 'partner') confidence = 'VERIFY'; // §4.7: partner rows are capped at VERIFY

  const category = toCategory(raw.category);
  const parentId = str(raw.parent_id);
  const isUmbrella = raw.is_umbrella === true;
  // §16.1: flagship comes from the backend registry; a partner row never is one.
  const flagship = origin === 'partner' ? false
    : typeof raw.flagship === 'boolean' ? raw.flagship
      : isFlagshipSeries(title.es, origin);
  const served = num(raw.prominence);
  const prominence = served !== null ? served : computeProminence({
    category, flagship, is_umbrella: isUmbrella, parent_id: parentId, confidence, origin,
    source_tier: num(raw.source_tier) ?? sourceTierFallback(sourceUrl), series: raw.series === true,
  });

  return {
    event_id: id,
    title,
    description: toL4(raw.description) || { es: '' },
    category,
    start_date: tbc ? null : start,
    end_date: tbc ? null : end,
    start_time: datesAllowed ? hm(raw.start_time) : null,
    end_time: datesAllowed ? hm(raw.end_time) : null,
    date_tbc_note: tbc ? toL4(raw.date_tbc_note) : null,
    venue_name: str(raw.venue_name) || '',
    zone: str(raw.zone),
    lat,
    lng,
    price,
    ticket_url: status === 'published' && isHttp(raw.ticket_url) ? String(raw.ticket_url).trim() : null,
    source_url: sourceUrl,
    source_name: str(raw.source_name) || '',
    second_source_name: str(raw.second_source_name),
    last_verified: lastVerified,
    confidence,
    status,
    sold_out: raw.sold_out === true,
    // §2: only self-hosted /images/… paths; anything else → category placeholder.
    image_url: img && img.startsWith('/images/') ? img : null,
    image_credit: str(raw.image_credit),
    notif_eligible: raw.notif_eligible === true && confidence === 'HIGH' && status === 'published',
    parent_id: parentId,
    is_verified: confidence === 'HIGH',
    origin,
    status_reason: str(raw.status_reason),
    address: str(raw.address),
    is_umbrella: isUmbrella,
    prominence,
    flagship,
  };
}

const normalizePayload = (raw: unknown, nowMs: number): FeedPayload | null => {
  if (!isRecord(raw)) return null;
  const generated = str(raw.generated_at);
  if (!generated || !Number.isFinite(Date.parse(generated))) return null;
  if (!Array.isArray(raw.events)) return null;
  const events = raw.events
    .map((r) => normalizeEvent(r, { feedOnly: true, nowMs }))
    .filter((e): e is PublicEvent => !!e && e.status === 'published');
  const tbc = (Array.isArray(raw.date_tbc) ? raw.date_tbc : [])
    .map((r) => normalizeEvent(r, { feedOnly: true, nowMs }))
    .filter((e): e is PublicEvent => !!e && e.status === 'date_tbc');
  const seen = new Set<string>();
  const dedupe = (e: PublicEvent) => (seen.has(e.event_id) ? false : (seen.add(e.event_id), true));
  return {
    generated_at: generated,
    today: ymd(raw.today) || '',
    events: events.filter(dedupe),
    date_tbc: tbc.filter(dedupe),
  };
};

// ── Time helpers (Bogotá wall clock) ────────────────────────────────────────
/** Epoch ms of `date` + `time` in Bogotá (fixed UTC-5; Colombia has no DST). */
export function bogotaInstant(date: string, time: string): number {
  return Date.parse(`${date}T${time}:00-05:00`);
}

/** §4 rule 5: an event ending today is live until end_time, or start_time when there is none. */
export function isFinished(ev: PublicEvent, today: string = bogotaToday(), nowHM: string = bogotaTime()): boolean {
  if (ev.status === 'date_tbc') return false;
  const end = ev.end_date || ev.start_date;
  if (!end) return false;
  if (end > today) return false;
  if (end < today) return true;
  const cut = ev.end_time || ev.start_time;
  return !!cut && cut < nowHM;
}

const dropFinished = (p: FeedPayload): FeedPayload => {
  const today = bogotaToday();
  const now = bogotaTime();
  return { ...p, events: p.events.filter((e) => !isFinished(e, today, now)) };
};

/**
 * §16.1 within-day order: flagship first, then prominence (desc), then
 * start_time (nulls last), then title. Flagship leads explicitly so a headline
 * event is never outranked by a high-scoring ordinary row on the same day.
 */
export function compareWithinDay(a: PublicEvent, b: PublicEvent): number {
  if (a.flagship !== b.flagship) return a.flagship ? -1 : 1;
  if (a.prominence !== b.prominence) return b.prominence - a.prominence;
  const ta = a.start_time || '99:99';
  const tb = b.start_time || '99:99';
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.title.es.localeCompare(b.title.es);
}

/** One day's rows, headline events first (§16.1 / §16.3). */
export function sortWithinDay<T extends PublicEvent>(list: T[]): T[] {
  return [...list].sort(compareWithinDay);
}

/** Sort: start_date, then the §16.1 within-day order. */
export function sortEvents<T extends PublicEvent>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const da = a.start_date || '9999-99-99';
    const db = b.start_date || '9999-99-99';
    if (da !== db) return da < db ? -1 : 1;
    return compareWithinDay(a, b);
  });
}

const overlaps = (ev: PublicEvent, from: string, to: string): boolean => {
  if (!ev.start_date) return false;
  const end = ev.end_date || ev.start_date;
  return ev.start_date <= to && end >= from;
};

export type Bucket = 'hoy' | 'semana' | 'proximos';

/**
 * hoy = overlaps today (still live, NEVER an umbrella — §15 R5);
 * semana = overlaps today+1 … today+6; proximos = overlaps today+7 onwards.
 * Multi-day events appear in every bucket they overlap. date_tbc rows are never
 * bucketed (they live in "Por confirmar").
 */
export function bucket(events: PublicEvent[], which: Bucket, today: string = bogotaToday()): PublicEvent[] {
  const nowHM = bogotaTime();
  const live = events.filter((e) => e.status === 'published' && !!e.start_date && !isFinished(e, today, nowHM));
  let out: PublicEvent[];
  if (which === 'hoy') {
    out = live.filter((e) => !e.is_umbrella && overlaps(e, today, today));
  } else if (which === 'semana') {
    out = live.filter((e) => overlaps(e, plusDays(today, 1), plusDays(today, 6)));
  } else {
    out = live.filter((e) => overlaps(e, plusDays(today, 7), '9999-12-31'));
  }
  // One day → headline order (§16.1); a range → calendar order, headline within a day.
  return which === 'hoy' ? sortWithinDay(out) : sortEvents(out);
}

/** Events happening on one Bogotá day (Agenda "Salir hoy"), flagship first. Umbrellas excluded. */
export function onDay(events: PublicEvent[], day: string): PublicEvent[] {
  const today = bogotaToday();
  const nowHM = bogotaTime();
  return sortWithinDay(events.filter((e) =>
    e.status === 'published' && !e.is_umbrella && overlaps(e, day, day)
    && !(day === today && isFinished(e, today, nowHM))
    && !(day < today)));
}

/**
 * Upcoming published rows (today onwards), soonest first, with sub-events folded
 * under their umbrella when the umbrella itself is listed — a compact "Próximos"
 * row shows "Fiestas de Independencia" once, not the umbrella plus six children.
 */
export function compactUpcoming(events: PublicEvent[], limit: number, today: string = bogotaToday()): PublicEvent[] {
  const nowHM = bogotaTime();
  const live = sortEvents(events.filter((e) => e.status === 'published' && !!e.start_date && !isFinished(e, today, nowHM)));
  const ids = new Set(live.map((e) => e.event_id));
  return live.filter((e) => !(e.parent_id && ids.has(e.parent_id))).slice(0, limit);
}

/** YYYY-MM-DD + n days (noon-UTC arithmetic, no device timezone involved). */
export function plusDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── §16.2 / §16.3 selection and grouping (Bogotá = fixed UTC-5, no DST) ─────
const BOGOTA_OFFSET_MS = 5 * 3600 * 1000;
/** Bogotá calendar day of an instant — pure arithmetic, no Intl, no device tz. */
export const bogotaYmdAt = (ms: number): string => new Date(ms - BOGOTA_OFFSET_MS).toISOString().slice(0, 10);
/** Bogotá wall clock "HH:MM" of an instant. */
export const bogotaHmAt = (ms: number): string => new Date(ms - BOGOTA_OFFSET_MS).toISOString().slice(11, 16);

/** Live published, dated rows (finished ones dropped) as of `nowMs`. */
const liveRows = (events: PublicEvent[], today: string, nowHM: string): PublicEvent[] =>
  events.filter((e) => e.status === 'published' && !!e.start_date && !isFinished(e, today, nowHM));

/** Umbrella ids present in a list (the parents that fold their sub-events). */
const umbrellaIds = (events: PublicEvent[]): Set<string> =>
  new Set(events.filter((e) => e.is_umbrella).map((e) => e.event_id));

const rankDestacados = (list: PublicEvent[]): PublicEvent[] => [...list].sort((a, b) => {
  // HIGH rows outrank VERIFY rows (§16.2), then prominence, then the soonest.
  if (a.confidence !== b.confidence) return a.confidence === 'HIGH' ? -1 : 1;
  if (a.prominence !== b.prominence) return b.prominence - a.prominence;
  const da = a.start_date || '9999-99-99';
  const db = b.start_date || '9999-99-99';
  if (da !== db) return da < db ? -1 : 1;
  return compareWithinDay(a, b);
});

/**
 * §16.2 "Destacados": published, dated rows that are ongoing or start within the
 * next 90 days, ranked HIGH-before-VERIFY, prominence desc, start_date asc.
 * date_tbc rows never qualify (they have no date); a series/recurring row
 * (prominence ≤ 0, "never promoted" in §16.1) never qualifies either. An
 * umbrella in the feed hides its own sub-events, except a flagship sub-event
 * starting within 7 days (the Bando in its week). When fewer than `max` rows
 * fall inside 90 days, the rail is backfilled with the flagship rows beyond the
 * window (prominence desc, then start_date asc), so the city's headline events
 * always show first. Home keeps the rail while the feed has rows (§16.2), so
 * when nothing falls inside 90 days the same ranking runs over every live row.
 */
export function destacados(events: PublicEvent[], nowMs: number = Date.now(), max: number = 6): PublicEvent[] {
  const today = bogotaYmdAt(nowMs);
  const live = liveRows(events, today, bogotaHmAt(nowMs)).filter((e) => e.prominence > 0);
  if (!live.length) return [];
  const parents = umbrellaIds(live);
  const horizon = plusDays(today, 90);
  const week = plusDays(today, 7);
  const visible = live.filter((e) => {
    if (e.parent_id && parents.has(e.parent_id)) return e.flagship && (e.start_date as string) <= week;
    return true;
  });
  const inWindow = visible.filter((e) => (e.start_date as string) <= horizon);
  if (!inWindow.length) return rankDestacados(visible).slice(0, max);
  const ranked = rankDestacados(inWindow);
  if (ranked.length >= max) return ranked.slice(0, max);
  const beyond = rankDestacados(visible.filter((e) => e.flagship && (e.start_date as string) > horizon));
  return [...ranked, ...beyond].slice(0, max);
}

/** The sub-events of an umbrella (published, not finished), in calendar order. */
export function childrenOf(umbrella: PublicEvent, events: PublicEvent[], today: string = bogotaToday()): PublicEvent[] {
  const nowHM = bogotaTime();
  return sortEvents(liveRows(events, today, nowHM).filter((e) => e.parent_id === umbrella.event_id));
}

/** "N eventos del programa": how many live sub-events an umbrella still has. */
export function programCount(umbrella: PublicEvent, events: PublicEvent[], today: string = bogotaToday()): number {
  return childrenOf(umbrella, events, today).length;
}

/** The umbrella a sub-event belongs to, when that umbrella is in the feed. */
export function parentOf(ev: PublicEvent, events: PublicEvent[]): PublicEvent | null {
  if (!ev.parent_id) return null;
  return events.find((e) => e.event_id === ev.parent_id && e.is_umbrella) || null;
}

/** The ymd days from `from`, `n` of them. */
export function dayRange(from: string, n: number): string[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => plusDays(from, i));
}

export type DayGroup = { day: string; events: PublicEvent[] };

/**
 * §16.3 day grouping over [from, to]. Umbrellas are left to the caller (they are
 * a group card, not a day row). `firstDayOnly`: a multi-day row is listed once,
 * on its first visible day (the all-week view stays uncluttered); otherwise it is
 * listed on every day it overlaps (a single tapped day). Empty days are omitted.
 */
export function groupByDay(
  events: PublicEvent[], from: string, to: string, opts: { firstDayOnly?: boolean; today?: string } = {},
): DayGroup[] {
  const today = opts.today || bogotaToday();
  const live = liveRows(events, today, bogotaTime()).filter((e) => !e.is_umbrella);
  const out: DayGroup[] = [];
  for (let day = from; day <= to; day = plusDays(day, 1)) {
    const rows = live.filter((e) => {
      const start = e.start_date as string;
      const end = e.end_date || start;
      if (opts.firstDayOnly) return (start < from ? from : start) === day && end >= from;
      return start <= day && end >= day;
    });
    if (rows.length) out.push({ day, events: sortWithinDay(rows) });
    if (out.length > 400) break;
  }
  return out;
}

/** Per-day counts for a date strip (umbrellas excluded; multi-day rows count on every day). */
export function dayCounts(events: PublicEvent[], days: string[], today: string = bogotaToday()): Record<string, number> {
  const live = liveRows(events, today, bogotaTime()).filter((e) => !e.is_umbrella);
  const out: Record<string, number> = {};
  for (const day of days) {
    out[day] = live.filter((e) => (e.start_date as string) <= day && (e.end_date || (e.start_date as string)) >= day).length;
  }
  return out;
}

export type MonthGroup = { key: string; year: number; month0: number; events: PublicEvent[] };

/**
 * §16.3 "Próximos": rows starting on/after `from`, grouped by month, each month
 * in calendar order with the within-day order inside a day. An umbrella that
 * overlaps `from` sits in the month of `from` (its card shows its real range).
 */
export function groupByMonth(events: PublicEvent[], from: string, today: string = bogotaToday()): MonthGroup[] {
  const live = liveRows(events, today, bogotaTime());
  const effective = (e: PublicEvent): string => {
    const start = e.start_date as string;
    return start >= from ? start : from;
  };
  const rows = live
    .filter((e) => (e.start_date as string) >= from || (e.is_umbrella && (e.end_date || (e.start_date as string)) >= from))
    .sort((a, b) => {
      const da = effective(a);
      const db = effective(b);
      if (da !== db) return da < db ? -1 : 1;
      return compareWithinDay(a, b);
    });
  const groups: MonthGroup[] = [];
  for (const e of rows) {
    const key = effective(e).slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, year: Number(key.slice(0, 4)), month0: Number(key.slice(5, 7)) - 1, events: [] };
      groups.push(g);
    }
    g.events.push(e);
  }
  return groups;
}

export type NowItem = { ev: PublicEvent; state: 'ongoing' | 'soon'; at: string | null };

/**
 * §16.2 "Ahora en Cartagena": what is verifiably happening now or starting
 * within `hours`. Honest by construction — a single-day row with no start time
 * is NOT "en curso" (we do not know when it starts); it stays in the Hoy list.
 *   • ongoing: a multi-day row past its first day, or a timed row that already
 *     started today and has not finished (§4 rule 5 via isFinished);
 *   • soon: a timed row whose next start is within `hours` (crosses midnight).
 * Umbrellas are excluded (§15 R5). Ongoing first (headline order), then soonest.
 */
export function ongoingOrSoon(events: PublicEvent[], nowMs: number = Date.now(), hours: number = 3): NowItem[] {
  const today = bogotaYmdAt(nowMs);
  const nowHM = bogotaHmAt(nowMs);
  const tomorrow = plusDays(today, 1);
  const windowMs = hours * 3600 * 1000;
  const ongoing: NowItem[] = [];
  const soon: { item: NowItem; t: number }[] = [];
  for (const e of liveRows(events, today, nowHM)) {
    if (e.is_umbrella) continue;
    const start = e.start_date as string;
    const end = e.end_date || start;
    if (start <= today && end >= today) {
      if (start < today) { ongoing.push({ ev: e, state: 'ongoing', at: null }); continue; }
      if (!e.start_time) continue;
      const t = bogotaInstant(today, e.start_time);
      if (!Number.isFinite(t)) continue;
      if (t <= nowMs) ongoing.push({ ev: e, state: 'ongoing', at: null });
      else if (t - nowMs <= windowMs) soon.push({ item: { ev: e, state: 'soon', at: e.start_time }, t });
    } else if (start === tomorrow && e.start_time) {
      const t = bogotaInstant(tomorrow, e.start_time);
      if (Number.isFinite(t) && t > nowMs && t - nowMs <= windowMs) {
        soon.push({ item: { ev: e, state: 'soon', at: e.start_time }, t });
      }
    }
  }
  return [
    ...sortWithinDay(ongoing.map((o) => o.ev)).map((ev) => ongoing.find((o) => o.ev === ev) as NowItem),
    ...soon.sort((a, b) => a.t - b.t).map((s) => s.item),
  ];
}

const haversineM = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
};

/** Within `m` metres of `pos` — real coordinates only (placeholders never count). */
export function isNear(ev: PublicEvent, pos: { lat: number; lng: number } | null | undefined, m: number = 1500): boolean {
  if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return false;
  if (!hasRealCoords(ev)) return false;
  return haversineM(pos.lat, pos.lng, ev.lat, ev.lng) <= m;
}

/** Next start instant (ms) — today's start_time for an ongoing multi-day event. null when unknown. */
export function nextStartMs(ev: PublicEvent, today: string = bogotaToday()): number | null {
  if (ev.status !== 'published' || !ev.start_date || !ev.start_time) return null;
  const end = ev.end_date || ev.start_date;
  if (today > end) return null;
  const day = ev.start_date > today ? ev.start_date : today;
  const t = bogotaInstant(day, ev.start_time);
  return Number.isFinite(t) ? t : null;
}

/** Starts in the future, within the next `hours` (needs a known start_time). */
export function startsWithin(ev: PublicEvent, hours: number, nowMs: number = Date.now()): boolean {
  const t = nextStartMs(ev);
  if (t === null) return false;
  return t > nowMs && t - nowMs <= hours * 3600 * 1000;
}

/** Evening row (Home "Noche"): starts ≥ 17:00 or before 05:00. Unknown time → day row. */
export function isNightEvent(ev: PublicEvent): boolean {
  if (!ev.start_time) return false;
  const h = parseInt(ev.start_time.slice(0, 2), 10);
  return h >= 17 || h < 5;
}

// ── Display formatting (no tr(): Spanish connectors stay at the call site) ───
const monthLabel = (m0: number, lang: Lang): string => {
  const v = monthShort(m0, lang);
  return lang === 'es' || lang === 'pt' ? v.toLowerCase() : v;
};
/** "sep" / "Sep" / "sept." — the short month the feed UI uses everywhere. */
export const formatMonthShort = monthLabel;

/** ISO timestamp → Bogotá "28 sep" (lang-aware). '' when unparseable. */
export function formatVerifiedDate(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${Number(m[3])} ${monthLabel(Number(m[2]) - 1, lang)}`;
}

/** ISO timestamp → Bogotá "28 sep 14:05" (offline banner). */
export function formatStamp(iso: string | null | undefined, lang: Lang): string {
  const day = formatVerifiedDate(iso, lang);
  if (!day || !iso) return day;
  const time = new Date(Date.parse(iso)).toLocaleTimeString('en-GB', {
    timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return `${day} ${time}`;
}

/** "13 nov" / "13–14 nov" / "30 nov – 2 dic". '' for rows without a date. */
export function formatEventDates(ev: PublicEvent, lang: Lang): string {
  if (!ev.start_date) return '';
  const [ys, ms, ds] = ev.start_date.split('-').map(Number);
  const end = ev.end_date || ev.start_date;
  const [ye, me, de] = end.split('-').map(Number);
  const a = `${ds} ${monthLabel(ms - 1, lang)}`;
  if (end === ev.start_date) return a;
  if (ys === ye && ms === me) return `${ds}–${de} ${monthLabel(me - 1, lang)}`;
  return `${a} – ${de} ${monthLabel(me - 1, lang)}`;
}

const MONTH_LONG: Record<Lang, string[]> = {
  es: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  fr: ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'],
  pt: ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'],
};

/** "Octubre 2026" (month header, §16.3). */
export function formatMonthYear(year: number, month0: number, lang: Lang): string {
  const names = MONTH_LONG[lang] || MONTH_LONG.es;
  return `${names[((month0 % 12) + 12) % 12]} ${year}`;
}

/**
 * The month a date_tbc row is announced for, read from the backend's Spanish
 * note ("Noviembre 2026 · fecha por confirmar"). null when the note has no month
 * (the row then shows the plain "Fecha por confirmar").
 */
export function tbcMonth(ev: Pick<PublicEvent, 'status' | 'date_tbc_note'>): { year: number; month0: number } | null {
  if (ev.status !== 'date_tbc' || !ev.date_tbc_note?.es) return null;
  const m = ev.date_tbc_note.es.match(/^\s*([A-Za-zÁÉÍÓÚáéíóú]+)(?:\s+de)?\s+(20\d{2})\b/);
  if (!m) return null;
  const month0 = MONTH_LONG.es.findIndex((n) => n.toLowerCase() === m[1].toLowerCase());
  return month0 < 0 ? null : { year: Number(m[2]), month0 };
}

/** Day of week (Sunday = 0) of a Bogotá YYYY-MM-DD — noon-UTC, device-tz proof. */
export function weekdayOf(day: string): number {
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? 0 : d.getUTCDay();
}

/** "mar 29 sep" (es/pt lower case, en "Tue 29 Sep", fr "mar. 29 sept."). */
export function formatDayShort(day: string, lang: Lang): string {
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const lower = lang === 'es' || lang === 'pt';
  const wd = weekdayShort(weekdayOf(day), lang);
  return `${lower ? wd.toLowerCase() : wd} ${Number(m[3])} ${monthLabel(Number(m[2]) - 1, lang)}`;
}

/** Upper-case the first letter only ("sáb 3 oct" → "Sáb 3 oct"). */
export const capFirst = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** "20:00" / "20:00–23:00" / '' when the source gives no time. */
export function formatEventTime(ev: PublicEvent): string {
  if (!ev.start_time) return '';
  return ev.end_time && ev.end_time !== ev.start_time ? `${ev.start_time}–${ev.end_time}` : ev.start_time;
}

// ── Cache, pub-sub, loader ──────────────────────────────────────────────────
let CACHE: FeedState | null = null;
let INFLIGHT: Promise<FeedState> | null = null;
const LISTENERS = new Set<(s: FeedState | null) => void>();

const setCache = (s: FeedState | null): void => {
  CACHE = s;
  LISTENERS.forEach((fn) => {
    try { fn(s); } catch (err) { console.error('[eventsFeed] listener', err); }
  });
};

/** Current cache entry (null before the first load, after a 404, or once stale). */
export function getCachedFeed(): FeedState | null {
  return CACHE;
}

export function subscribeFeed(fn: (s: FeedState | null) => void): () => void {
  LISTENERS.add(fn);
  return () => { LISTENERS.delete(fn); };
}

const ageH = (p: FeedPayload, nowMs: number): number => (nowMs - Date.parse(p.generated_at)) / 3600000;

// A web build without a backend URL has no /api to call (STATIC_MODE): the static
// mirror is the only source there, served under the same freshness rules.
const HAS_LIVE_BACKEND = /^https?:\/\//i.test(API_BASE);

const TRANSIENT = (status: number): boolean => status >= 500 || status === 429 || status === 408;

async function fetchStaticFeed(): Promise<FeedPayload | null> {
  try {
    const res = await fetchT(`${STATIC_FEED_URL}?_d=${bogotaToday()}`);
    if (!res.ok) return null;
    return normalizePayload(await res.json(), Date.now());
  } catch (err) {
    console.error('[eventsFeed] static mirror unavailable', err);
    return null;
  }
}

async function peekSwrFeed(): Promise<FeedPayload | null> {
  try {
    return normalizePayload(await swr.peek(FEED_PATH), Date.now());
  } catch (err) {
    console.error('[eventsFeed] swr peek failed', err);
    return null;
  }
}

/**
 * Home's first paint (§13 J3): the static mirror only when generated ≤ `maxAgeH`
 * ago. Never cached as live; the live response replaces it.
 */
export async function peekStaticFeed(maxAgeH: number = HOME_STATIC_MAX_AGE_H): Promise<FeedPayload | null> {
  const p = await fetchStaticFeed();
  if (!p || ageH(p, Date.now()) > maxAgeH) return null;
  return dropFinished(p);
}

async function fallbackFeed(): Promise<FeedState> {
  const nowMs = Date.now();
  const candidates: { p: FeedPayload; source: FeedSource }[] = [];
  if (CACHE) candidates.push({ p: CACHE.data, source: 'memory' });
  const [cached, stat] = await Promise.all([peekSwrFeed(), fetchStaticFeed()]);
  if (cached) candidates.push({ p: cached, source: 'swr' });
  if (stat) candidates.push({ p: stat, source: 'static' });
  const fresh = candidates
    .filter((c) => ageH(c.p, nowMs) <= FALLBACK_MAX_AGE_H)
    .sort((a, b) => Date.parse(b.p.generated_at) - Date.parse(a.p.generated_at));
  if (!fresh.length) {
    throw new FeedError('unavailable', 'events feed unreachable and no copy ≤36 h old');
  }
  const best = fresh[0];
  return { data: dropFinished(best.p), fetchedAt: nowMs, day: bogotaToday(), source: best.source, offline: true };
}

async function loadFromNetwork(): Promise<FeedState> {
  if (!HAS_LIVE_BACKEND) return fallbackFeed();
  let res: Response;
  try {
    res = await fetchT(`${API_BASE}${FEED_PATH}`, { headers: { Accept: 'application/json' } });
  } catch (err) {
    console.error('[eventsFeed] network error, trying last good copy', err);
    return fallbackFeed();
  }
  if (res.status === 404) {
    // An answer, not an outage: never masked by a cached or static copy.
    throw new FeedError('not_found', 'GET /events/feed → 404');
  }
  if (!res.ok) {
    if (TRANSIENT(res.status)) {
      console.error('[eventsFeed] backend status', res.status, '— trying last good copy');
      return fallbackFeed();
    }
    throw new FeedError('not_found', `GET /events/feed → ${res.status}`);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    console.error('[eventsFeed] unreadable feed body', err);
    return fallbackFeed();
  }
  const payload = normalizePayload(json, Date.now());
  if (!payload) {
    // Same honesty bound as an outage: only a copy ≤ 36 h old, flagged offline.
    console.error('[eventsFeed] unexpected feed shape, trying last good copy');
    return fallbackFeed();
  }
  // Remember the raw good payload for offline use (swr is capped + scoped by path).
  swr.put(FEED_PATH, json);
  return { data: dropFinished(payload), fetchedAt: Date.now(), day: bogotaToday(), source: 'live', offline: false };
}

const isFresh = (s: FeedState | null): s is FeedState =>
  !!s && !s.offline && s.day === bogotaToday() && Date.now() - s.fetchedAt < FEED_TTL_MS;

/**
 * Load the verified feed. Returns the cache while it is live, < 10 min old and
 * from today (Bogotá); otherwise fetches (single-flight). Throws FeedError:
 * 'not_found' (404 / other 4xx) or 'unavailable' (offline / malformed with no
 * copy ≤ 36 h). On any failure the cache is cleared so no screen keeps painting
 * rows the loader can no longer vouch for.
 */
export async function loadFeed(opts: { force?: boolean } = {}): Promise<FeedState> {
  if (!opts.force && isFresh(CACHE)) return CACHE;
  if (INFLIGHT) return INFLIGHT;
  INFLIGHT = (async () => {
    try {
      const next = await loadFromNetwork();
      setCache(next);
      return next;
    } catch (err) {
      // Nothing we can vouch for any more: no screen keeps painting the old rows.
      setCache(null);
      throw err;
    } finally {
      INFLIGHT = null;
    }
  })();
  return INFLIGHT;
}

// ── One event, any status (event/[id]) ──────────────────────────────────────
export type FeedItemResult =
  | { kind: 'ok'; event: PublicEvent; offline: boolean; stamp: string | null }
  | { kind: 'not_found' }
  | { kind: 'error' };

/**
 * GET /events/feed/item/{id}: the backend returns ANY status (hidden/expired with
 * status_reason) so the detail can tell the truth. 404 → not_found. Network/5xx →
 * the row from a feed copy ≤ 36 h old (flagged offline), else error.
 */
export async function loadFeedItem(id: string): Promise<FeedItemResult> {
  if (!id) return { kind: 'not_found' };
  if (HAS_LIVE_BACKEND) {
    try {
      const res = await fetchT(`${API_BASE}${FEED_PATH}/item/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } });
      if (res.status === 404) return { kind: 'not_found' };
      if (res.ok) {
        const ev = normalizeEvent(await res.json(), { feedOnly: false });
        // A row that fails the shape/honesty checks is treated as absent.
        return ev ? { kind: 'ok', event: ev, offline: false, stamp: null } : { kind: 'not_found' };
      }
      if (!TRANSIENT(res.status)) return { kind: 'not_found' };
      console.error('[eventsFeed] feed/item status', res.status);
    } catch (err) {
      console.error('[eventsFeed] feed/item network error', err);
    }
  }
  try {
    const s = await loadFeed();
    const ev = [...s.data.events, ...s.data.date_tbc].find((e) => e.event_id === id);
    if (ev) return { kind: 'ok', event: ev, offline: s.offline, stamp: s.offline ? s.data.generated_at : null };
    // Online feed without the row while feed/item failed: we cannot vouch for it.
    return { kind: 'error' };
  } catch (err) {
    console.error('[eventsFeed] feed/item fallback failed', err);
    return { kind: 'error' };
  }
}

const hostName = (u: string): string => {
  const m = u.match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1].replace(/^www\./i, '') : '';
};

/**
 * Legacy fallback for /event/[id] (§10): GET /events/{id} in the old shape. After
 * the one-way cutover that endpoint serves only verified city_events rows, but a
 * pre-cutover backend may still answer with legacy data — so a legacy row is
 * ALWAYS rendered as VERIFY ("Sin confirmar"), needs an http(s) source and a
 * real date, and a finished one comes back as `expired`. 404 → not_found.
 */
export async function loadLegacyEvent(id: string): Promise<FeedItemResult> {
  if (!id || !HAS_LIVE_BACKEND) return { kind: 'not_found' };
  let raw: unknown;
  try {
    const res = await fetchT(`${API_BASE}/events/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } });
    if (res.status === 404) return { kind: 'not_found' };
    if (!res.ok) return TRANSIENT(res.status) ? { kind: 'error' } : { kind: 'not_found' };
    raw = await res.json();
  } catch (err) {
    console.error('[eventsFeed] legacy event fetch failed', err);
    return { kind: 'error' };
  }
  if (!isRecord(raw)) return { kind: 'not_found' };
  const title = str(raw.title) || str(raw.name_es);
  const sources: unknown[] = Array.isArray(raw.source) ? raw.source : [raw.source, raw.source_url];
  const sourceUrl = sources.find(isHttp);
  const start = ymd(raw.date_start) || ymd(raw.date);
  if (!title || !sourceUrl || !start) return { kind: 'not_found' };
  const endRaw = ymd(raw.date_end);
  const end = endRaw && endRaw >= start ? endRaw : start;
  const loc = isRecord(raw.location) ? raw.location : {};
  let lat = num(loc.lat);
  let lng = num(loc.lng);
  if (lat === null || lng === null || isPlaceholderCoord(lat, lng)) { lat = null; lng = null; }
  const img = str(raw.image_url);
  const expired = end < bogotaToday();
  const ev: PublicEvent = {
    event_id: str(raw.event_id) || id,
    title: { es: title },
    description: { es: str(raw.description) || '' },
    category: toCategory(raw.category ?? raw.type),
    start_date: start,
    end_date: end,
    start_time: hm(raw.start_time) || hm(raw.time_start),
    end_time: hm(raw.end_time) || hm(raw.time_end),
    date_tbc_note: null,
    venue_name: str(raw.venue_name) || str(raw.venue) || '',
    zone: null,
    lat,
    lng,
    price: { is_free: raw.is_free === true ? true : null, min_cop: null, max_cop: null, text: null },
    ticket_url: !expired && isHttp(raw.ticket_url) ? String(raw.ticket_url).trim() : null,
    source_url: String(sourceUrl).trim(),
    source_name: hostName(String(sourceUrl)),
    second_source_name: null,
    last_verified: null,
    confidence: 'VERIFY',
    status: expired ? 'expired' : 'published',
    sold_out: false,
    image_url: img && img.startsWith('/images/') ? img : null,
    image_credit: null,
    notif_eligible: false,
    parent_id: null,
    is_verified: false,
    origin: 'legacy-import',
    status_reason: null,
    address: null,
    is_umbrella: false,
    prominence: 0,
    flagship: false,
  };
  ev.prominence = computeProminence(ev);
  return { kind: 'ok', event: ev, offline: false, stamp: null };
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export type UseEventsFeed = {
  feed: FeedState | null;
  /** Bogotá "today" — null until mounted (no build-time date in the static HTML). */
  today: string | null;
  loading: boolean;
  error: FeedErrorKind | null;
  reload: () => void;
};

/**
 * Screen hook: first paint from the module cache, load after mount, revalidate on
 * focus and on AppState 'active' once the copy is > 10 min old, and recompute on
 * Bogotá day rollover. Every screen reading events shares one cache + listeners.
 */
export function useEventsFeed(): UseEventsFeed {
  const [feed, setFeed] = useState<FeedState | null>(() => getCachedFeed());
  // Client-side cache present ⇒ we are past hydration (a client navigation), so
  // bucket math may run on the first frame. SSR / hydration: cache is null.
  const [today, setToday] = useState<string | null>(() => (getCachedFeed() ? bogotaToday() : null));
  const [loading, setLoading] = useState<boolean>(() => !getCachedFeed());
  const [error, setError] = useState<FeedErrorKind | null>(null);
  const alive = useRef(true);
  const todayRef = useRef<string | null>(today);

  const run = useCallback((force: boolean) => {
    if (!getCachedFeed()) setLoading(true);
    loadFeed({ force })
      .then(() => { if (alive.current) setError(null); })
      .catch((err: unknown) => {
        if (!alive.current) return;
        const kind: FeedErrorKind = err instanceof FeedError ? err.kind : 'unavailable';
        if (!(err instanceof FeedError)) console.error('[eventsFeed] load failed', err);
        setError(kind);
      })
      .finally(() => { if (alive.current) setLoading(false); });
  }, []);

  const syncToday = useCallback((): string => {
    const d = bogotaToday();
    if (todayRef.current !== d) {
      todayRef.current = d;
      setToday(d);
    }
    return d;
  }, []);

  const revalidate = useCallback(() => {
    const d = syncToday();
    const c = getCachedFeed();
    if (!c || c.offline || c.day !== d || Date.now() - c.fetchedAt >= FEED_TTL_MS) run(!!c);
  }, [run, syncToday]);

  useEffect(() => {
    alive.current = true;
    const unsub = subscribeFeed((s) => { if (alive.current) setFeed(s); });
    syncToday();
    const c = getCachedFeed();
    setFeed(c);
    if (!isFresh(c)) run(false);
    return () => { alive.current = false; unsub(); };
  }, [run, syncToday]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') revalidate(); });
    // Day rollover while the screen stays open (midnight in Cartagena).
    const tick = setInterval(() => {
      if (todayRef.current && todayRef.current !== bogotaToday()) revalidate();
    }, 60000);
    return () => { sub.remove(); clearInterval(tick); };
  }, [revalidate]);

  useFocusEffect(useCallback(() => { revalidate(); }, [revalidate]));

  const reload = useCallback(() => run(true), [run]);
  return { feed, today, loading: loading && !feed, error: feed ? null : error, reload };
}
