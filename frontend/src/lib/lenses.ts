/**
 * lenses.ts — client for the LENSES layer (docs/lenses/DESIGN.md §4).
 *
 * Load order (the cmw.ts discipline, plus a bundled floor for airplane mode):
 *   1. live   GET /lenses · /lenses/golden_hour · /lenses/port_day  (api.get:
 *      swr-recoverable, static-fallback to /data/lenses.json)
 *   2. static mirror  ${ASSET_ORIGIN}/data/lenses.json (web offline / cold start)
 *   3. BUNDLED src/data/lensesBundle.json — ships inside the JS bundle / native
 *      binary (the music-week guide.json pattern), so Port Day renders with NO
 *      network at all. The bundle is written by scripts/sync-lenses-data.mjs and
 *      is byte-identical to the mirror.
 *
 * Honesty at this layer: the mirror/bundle contain ONLY live lenses' content
 * (gated lenses ship as coming_soon defs). `crowd_today` exists ONLY in the
 * live port_day payload — offline it is null and the cruise badge hides.
 */
import { api, ASSET_ORIGIN } from '../constants/api';
import BUNDLE from '../data/lensesBundle.json';

export type Lang = 'es' | 'en' | 'fr' | 'pt';
export type L4 = Record<Lang, string>;
export type LensKey = 'golden_hour' | 'port_day' | 'step_free' | 'family' | 'women_verified';
export type LightSlot = 'sunrise' | 'midday' | 'sunset';
export type AccessTier = 'free' | 'purchase' | 'reservation' | 'guest_only' | 'paid_entry';

export interface LensDef {
  key: LensKey;
  kind: 'places' | 'venues' | 'kit';
  icon: string;
  label: L4;
  tagline: L4;
  live: boolean;
  fill: { high: number; total: number; min_fill: number };
}

export interface GoldenPin {
  id: string;
  lens: LensKey;
  name: string;
  venue_id: string | null;
  venue_name: string | null;
  zone: string | null;
  lat: number;
  lng: number;
  geo_precision: 'exact' | 'approx';
  best_light: LightSlot[];
  access_tier: AccessTier;
  crowd_hotspot: boolean;
  photogenic: L4;
  etiquette: L4 | null;
  link: string | null;
  image_url: string | null;
  source_url: string;
  source_name: string;
  last_verified: string;
  confidence: 'HIGH' | 'VERIFY';
}

export interface FareRow {
  key: string;
  label: L4 | string;              // copied verbatim from the city module — labels are L4
  value_cop: number | null;
  value_text: L4 | string | null;
  confidence: 'HIGH' | 'VERIFY';
  source_name: string;
  source_url: string;
  last_verified: string;
  note?: L4 | string | null;
}

export interface ItineraryStop { pin: string; minutes: number; name: string; lat: number; lng: number; access_tier: AccessTier }
export interface Itinerary { id: string; duration_h: number; editorial: true; title: L4; note: L4; stops: ItineraryStop[] }

export interface PortDayKit {
  fares: FareRow[];
  fare_link: string;
  muelle_link: string;
  return_buffer_min: number;
  crowd_note: L4 | null;
  hotspot_pins: string[];
  itineraries: Itinerary[];
  crowd_today: { date: string; ships: number } | null;
}

export interface LensesDoc {
  version: number;
  updated: string;
  lenses: LensDef[];
  access_tiers: Record<AccessTier, L4>;
  sunset_by_month: Record<string, string>;
  pins: GoldenPin[];
  port_day: PortDayKit | null;
  offline?: boolean;
}

const TTL_MS = 10 * 60 * 1000;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function baseDoc(): LensesDoc {
  // The bundle is validated at build time; trust its shape as the floor.
  const b = BUNDLE as unknown as LensesDoc;
  return { ...b, port_day: b.port_day ? { ...b.port_day, crowd_today: null } : null };
}

function mergeIndex(doc: LensesDoc, raw: unknown): LensesDoc {
  if (!isObj(raw) || !Array.isArray((raw as { lenses?: unknown }).lenses)) return doc;
  const r = raw as Partial<LensesDoc>;
  return {
    ...doc,
    lenses: (r.lenses as LensDef[]).filter((l) => isObj(l) && typeof l.key === 'string'),
    access_tiers: isObj(r.access_tiers) ? (r.access_tiers as LensesDoc['access_tiers']) : doc.access_tiers,
    sunset_by_month: isObj(r.sunset_by_month) ? (r.sunset_by_month as Record<string, string>) : doc.sunset_by_month,
    ...(Array.isArray(r.pins) && r.pins.length ? { pins: r.pins as GoldenPin[] } : {}),
  };
}

function mergeGolden(doc: LensesDoc, raw: unknown): LensesDoc {
  if (!isObj(raw) || !Array.isArray((raw as { pins?: unknown }).pins)) return doc;
  const pins = ((raw as { pins: GoldenPin[] }).pins).filter(
    (p) => isObj(p) && typeof p.id === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lng),
  );
  return pins.length ? { ...doc, pins } : doc;
}

function mergePortDay(doc: LensesDoc, raw: unknown): LensesDoc {
  if (!isObj(raw) || !Array.isArray((raw as { fares?: unknown }).fares)) return doc;
  const r = raw as unknown as PortDayKit & { coming_soon?: boolean };
  if (r.coming_soon) return doc;
  const crowd = isObj(r.crowd_today) && typeof r.crowd_today?.ships === 'number' ? r.crowd_today : null;
  return { ...doc, port_day: { ...r, crowd_today: crowd } };
}

let CACHE: { at: number; doc: LensesDoc } | null = null;
let INFLIGHT: Promise<LensesDoc> | null = null;

export function peekLenses(): LensesDoc | null {
  return CACHE?.doc ?? null;
}

export function clearLensesCache(): void {
  CACHE = null;
  INFLIGHT = null;
}

async function fetchStaticMirror(): Promise<unknown | null> {
  try {
    const res = await fetch(`${ASSET_ORIGIN}/data/lenses.json`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function loadFresh(): Promise<LensesDoc> {
  let doc = baseDoc();
  let offline = true;
  const mirror = await fetchStaticMirror();
  if (mirror) doc = mergePortDay(mergeGolden(mergeIndex(doc, mirror), mirror), (mirror as { port_day?: unknown }).port_day ?? null);
  try {
    const idx = await api.get('/lenses');
    doc = mergeIndex(doc, idx);
    offline = false;
  } catch { /* stay on mirror/bundle */ }
  if (doc.lenses.find((l) => l.key === 'golden_hour')?.live) {
    try { doc = mergeGolden(doc, await api.get('/lenses/golden_hour')); } catch { /* keep floor */ }
  }
  if (doc.lenses.find((l) => l.key === 'port_day')?.live) {
    try { doc = mergePortDay(doc, await api.get('/lenses/port_day')); offline = false; } catch { /* crowd hides */ }
  }
  return { ...doc, offline };
}

export async function loadLenses(force = false): Promise<LensesDoc> {
  if (!force && CACHE && Date.now() - CACHE.at < TTL_MS) return CACHE.doc;
  if (!INFLIGHT) {
    INFLIGHT = loadFresh()
      .then((doc) => {
        CACHE = { at: Date.now(), doc };
        return doc;
      })
      .finally(() => { INFLIGHT = null; });
  }
  return INFLIGHT;
}

/** Bundled floor, synchronously — Port Day's airplane-mode guarantee. */
export function bundledLenses(): LensesDoc {
  return baseDoc();
}

export function lensDef(doc: LensesDoc | null, key: LensKey): LensDef | null {
  return doc?.lenses.find((l) => l.key === key) ?? null;
}

export function goldenPins(doc: LensesDoc | null, slot?: LightSlot | 'all'): GoldenPin[] {
  const pins = (doc?.pins ?? []).filter((p) => p.lens === 'golden_hour');
  if (!slot || slot === 'all') return pins;
  return pins.filter((p) => p.best_light.includes(slot));
}

/** Current light slot in Bogotá time. Call AFTER mount only (hydration rule). */
export function currentLightSlot(now: Date = new Date()): LightSlot {
  const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Bogota' }).format(now));
  if (h < 10) return 'sunrise';
  if (h < 16) return 'midday';
  return 'sunset';
}

/** "17:52" for the current Bogotá month, from the walking-engine table; null when unknown. */
export function sunsetThisMonth(doc: LensesDoc | null, now: Date = new Date()): string | null {
  const m = Number(new Intl.DateTimeFormat('en-US', { month: 'numeric', timeZone: 'America/Bogota' }).format(now));
  const v = doc?.sunset_by_month?.[String(m)];
  return typeof v === 'string' ? v : null;
}

export function pickL4(v: L4 | null | undefined, lang: string): string {
  if (!v) return '';
  const l = (['es', 'en', 'fr', 'pt'].includes(lang) ? lang : 'es') as Lang;
  return v[l] || v.es || '';
}

export function accessLabel(doc: LensesDoc | null, tier: AccessTier, lang: string): string {
  return pickL4(doc?.access_tiers?.[tier] ?? null, lang);
}
