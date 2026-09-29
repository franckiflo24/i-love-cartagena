// EVENTS-ELITE — reminders, proximity and consent helpers (fe-nearby).
//
// Shared by AvisameButton, NearbyEventsCard, the Perfil › Notificaciones card,
// the map's eventos layer and FavoritesContext. Honesty rules (DESIGN §0/§13/§15):
//   - A reminder is promised ONLY when the server would actually send it:
//     published + HIGH + notif_eligible + a confirmed start_time, a usable push
//     channel, reminders not switched off, and a cron tick still ahead inside
//     [start−180, start−30] ∩ [09:00, 21:00] Bogotá (§13 H1 / §15 U).
//   - Location for "cerca de mí" is read ONLY when the OS/browser permission is
//     already granted (never prompts) and never leaves this device.
//   - Pins/offers use real coordinates only: the §15 Q5 placeholder list (the one
//     mirror of events_gate.PLACEHOLDER_COORDS lives in eventsFeed.ts) plus the
//     Distrito box and the Turbaco/Arjona exclusion.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import { API_BASE, AMO_CLIENT_HEADERS, api, fetchT, getToken } from '../constants/api';
import { pushState, pushScopes, subscribePush, unsubscribePush } from './push';
import { registerUserPushToken, unregisterPushToken } from '../utils/pushNotifications';
import { geoService } from './geo';
import { isPlaceholderCoord } from './eventsFeed';

// ── Storage keys ────────────────────────────────────────────────────────────
export const NEARBY_OPTIN_KEY = '@amo_nearby_optin';
export const NEARBY_CATS_KEY = '@amo_nearby_cats';
export const NEARBY_OFFERS_KEY = '@amo_nearby_offers';
export const PENDING_AVISAME_KEY = '@amo_pending_avisame';

export const NEARBY_RADIUS_M = 1500;
export const NEARBY_WINDOW_MS = 3 * 3600 * 1000;
export const MAX_NEARBY_OFFERS_PER_DAY = 2;
const PENDING_AVISAME_TTL_MS = 12 * 3600 * 1000;

// ── Categories (§2) ─────────────────────────────────────────────────────────
export const EVENT_CATEGORIES = [
  'concert', 'festival', 'cultural', 'nightlife', 'gastronomic', 'sports', 'family', 'civic',
] as const;
export type EventCategory = typeof EVENT_CATEGORIES[number];
export function isEventCategory(v: unknown): v is EventCategory {
  return typeof v === 'string' && (EVENT_CATEGORIES as readonly string[]).includes(v);
}

// ── A defensive, typed view of a PublicEvent ────────────────────────────────
// Components accept eventsFeed's PublicEvent (the fixed prop contract) and
// read it through this narrowing so a field typed loosely upstream can never
// turn into a wrong promise here.
export type EventLite = {
  id: string;
  title: Partial<Record<'es' | 'en' | 'fr' | 'pt', string>>;
  category: EventCategory | null;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  venue: string;
  lat: number | null;
  lng: number | null;
  sourceName: string;
  lastVerified: string | null;
  confidence: 'HIGH' | 'VERIFY' | null;
  status: string;
  soldOut: boolean;
  notifEligible: boolean;
  parentId: string | null;
  isUmbrella: boolean;
};

const EVENT_ID_RE = /^ce-[a-z0-9-]{1,100}$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d/;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function ymd(v: unknown): string | null {
  const s = str(v);
  return s && YMD_RE.test(s) ? s : null;
}
function hm(v: unknown): string | null {
  const s = str(v);
  return s && HM_RE.test(s) ? s.slice(0, 5) : null;
}

/** Only EVENTS-ELITE ids (`ce-…`) — the favorites API refuses anything else (§15 T3). */
export function isCityEventId(id: unknown): id is string {
  return typeof id === 'string' && EVENT_ID_RE.test(id);
}

export function toEventLite(ev: unknown): EventLite | null {
  if (!ev || typeof ev !== 'object') return null;
  const r = ev as Record<string, unknown>;
  const id = r.event_id;
  if (!isCityEventId(id)) return null;
  const title: EventLite['title'] = {};
  if (r.title && typeof r.title === 'object') {
    const t = r.title as Record<string, unknown>;
    for (const k of ['es', 'en', 'fr', 'pt'] as const) {
      const v = str(t[k]);
      if (v) title[k] = v;
    }
  } else {
    const v = str(r.title);
    if (v) title.es = v;
  }
  const conf = r.confidence === 'HIGH' || r.confidence === 'VERIFY' ? r.confidence : null;
  return {
    id,
    title,
    category: isEventCategory(r.category) ? r.category : null,
    startDate: ymd(r.start_date),
    endDate: ymd(r.end_date),
    startTime: hm(r.start_time),
    endTime: hm(r.end_time),
    venue: str(r.venue_name) || '',
    lat: num(r.lat),
    lng: num(r.lng),
    sourceName: str(r.source_name) || '',
    lastVerified: str(r.last_verified),
    confidence: conf,
    status: str(r.status) || '',
    soldOut: r.sold_out === true,
    notifEligible: r.notif_eligible === true,
    parentId: str(r.parent_id),
    isUmbrella: r.is_umbrella === true,
  };
}

export function pickTitle(ev: EventLite, lang: string): string {
  const k = (['es', 'en', 'fr', 'pt'] as const).find((l) => l === lang);
  return (k && ev.title[k]) || ev.title.es || ev.title.en || '';
}

// ── Bogotá time (fixed UTC−5, no DST — deterministic, no Intl needed) ───────
const BOGOTA_OFFSET_MS = 5 * 3600 * 1000;
const MIN_MS = 60 * 1000;

export function bogotaYmd(ms: number): string {
  return new Date(ms - BOGOTA_OFFSET_MS).toISOString().slice(0, 10);
}
export function bogotaMinuteOfDay(ms: number): number {
  const m = Math.floor((ms - BOGOTA_OFFSET_MS) / MIN_MS);
  return ((m % 1440) + 1440) % 1440;
}
/** Epoch ms of the event start (Bogotá wall clock), null without date AND time. */
export function eventStartMs(ev: EventLite): number | null {
  if (!ev.startDate || !ev.startTime) return null;
  const t = Date.parse(`${ev.startDate}T${ev.startTime}:00-05:00`);
  return Number.isFinite(t) ? t : null;
}

const CRON_TICK_MS = 15 * MIN_MS; // backend reminders cron: */15 * * * * UTC
const QUIET_START_MIN = 9 * 60;   // 09:00 Bogotá
const QUIET_END_MIN = 21 * 60;    // 21:00 Bogotá

/**
 * §13 H1 / §15 U: is there still a reminders-cron tick inside
 * [start−180 min, start−30 min] ∩ [09:00, 21:00] Bogotá? No start_time → no
 * reminder is ever sent, so false. Multi-day events are reminded on day one only,
 * which the start-relative window already encodes.
 */
export function reminderWindowAhead(ev: EventLite, nowMs: number): boolean {
  const start = eventStartMs(ev);
  if (start === null) return false;
  const windowStart = start - 180 * MIN_MS;
  const windowEnd = start - 30 * MIN_MS;
  for (let t = Math.ceil(Math.max(nowMs, windowStart) / CRON_TICK_MS) * CRON_TICK_MS; t <= windowEnd; t += CRON_TICK_MS) {
    const m = bogotaMinuteOfDay(t);
    if (m >= QUIET_START_MIN && m <= QUIET_END_MIN) return true;
  }
  return false;
}

/** The server-side reminder conditions that the client can see (§4.8, §15 R5). */
export function isReminderEligible(ev: EventLite): boolean {
  return ev.status === 'published'
    && ev.confidence === 'HIGH'
    && ev.notifEligible
    && !ev.soldOut
    && ev.startTime !== null
    && ev.parentId === null
    && !ev.isUmbrella;
}

/** last_verified falls on the given Bogotá day (§15 U1: reminders need today's verification). */
export function verifiedOn(ev: EventLite, bogotaDay: string): boolean {
  if (!ev.lastVerified) return false;
  const t = Date.parse(ev.lastVerified);
  return Number.isFinite(t) && bogotaYmd(t) === bogotaDay;
}

// ── Real coordinates only (§15 Q5) ──────────────────────────────────────────
export function hasRealCoords(ev: { lat: number | null; lng: number | null }): ev is { lat: number; lng: number } {
  const { lat, lng } = ev;
  if (lat === null || lng === null) return false;
  if (lat < 10.10 || lat > 10.62 || lng < -75.82 || lng > -75.42) return false; // Distrito box
  if (lat < 10.36 && lng > -75.47) return false; // Turbaco / Arjona exclusion
  return !isPlaceholderCoord(lat, lng);
}

// ── Display helpers ─────────────────────────────────────────────────────────
const LOCALE: Record<string, string> = { es: 'es-CO', en: 'en-US', fr: 'fr-FR', pt: 'pt-BR' };

function fmtDay(ymdStr: string, lang: string): string {
  const [y, m, d] = ymdStr.split('-').map(Number);
  try {
    return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(LOCALE[lang] || 'es-CO', {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
    });
  } catch {
    return ymdStr;
  }
}

/** "Hoy · 20:00", "sáb, 14 nov · 10:00", "13 nov – 14 nov". Call after mount only. */
export function fmtEventWhen(ev: EventLite, lang: string, tr: (es: string) => string, nowMs: number): string {
  if (!ev.startDate) return '';
  const today = bogotaYmd(nowMs);
  const day = ev.startDate === today ? tr('Hoy') : fmtDay(ev.startDate, lang);
  const multi = ev.endDate && ev.endDate !== ev.startDate ? ` – ${fmtDay(ev.endDate, lang)}` : '';
  return `${day}${multi}${ev.startTime ? ` · ${ev.startTime}` : ''}`;
}

/** "45 min" / "2 h 10 min" — language-neutral. */
export function fmtIn(ms: number): string {
  const total = Math.max(0, Math.round(ms / MIN_MS));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// ── Local nearby prefs (works for guests; mirrored to the server when signed in) ──
export type NearbyPrefs = { optIn: boolean; categories: EventCategory[] };

export async function readNearbyPrefs(): Promise<NearbyPrefs> {
  try {
    const [opt, cats] = await Promise.all([
      AsyncStorage.getItem(NEARBY_OPTIN_KEY),
      AsyncStorage.getItem(NEARBY_CATS_KEY),
    ]);
    let categories: EventCategory[] = [...EVENT_CATEGORIES];
    if (cats) {
      const parsed: unknown = JSON.parse(cats);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter(isEventCategory);
        if (valid.length) categories = valid;
      }
    }
    return { optIn: opt === '1', categories };
  } catch (e) {
    console.error('[eventNotif] read nearby prefs failed', e);
    return { optIn: false, categories: [...EVENT_CATEGORIES] }; // fail closed: OFF
  }
}

export async function writeNearbyPrefs(p: Partial<NearbyPrefs>): Promise<void> {
  if (p.optIn !== undefined) await AsyncStorage.setItem(NEARBY_OPTIN_KEY, p.optIn ? '1' : '0');
  if (p.categories !== undefined) {
    const valid = p.categories.filter(isEventCategory);
    await AsyncStorage.setItem(NEARBY_CATS_KEY, JSON.stringify(valid.length ? valid : [...EVENT_CATEGORIES]));
  }
}

// ── Daily offer cap for the nearby card ('@amo_nearby_offers') ─────────────
export type OffersRecord = { day: string; shown: string[]; dismissed: string[] };

export async function readOffers(day: string): Promise<OffersRecord> {
  try {
    const raw = await AsyncStorage.getItem(NEARBY_OFFERS_KEY);
    if (raw) {
      const p: unknown = JSON.parse(raw);
      if (p && typeof p === 'object') {
        const r = p as Record<string, unknown>;
        if (r.day === day) {
          const ids = (v: unknown) => (Array.isArray(v) ? v.filter(isCityEventId) : []);
          return { day, shown: ids(r.shown), dismissed: ids(r.dismissed) };
        }
      }
    }
  } catch (e) {
    console.error('[eventNotif] read offers failed', e);
  }
  return { day, shown: [], dismissed: [] };
}

async function writeOffers(rec: OffersRecord): Promise<void> {
  try {
    await AsyncStorage.setItem(NEARBY_OFFERS_KEY, JSON.stringify(rec));
  } catch (e) {
    console.error('[eventNotif] write offers failed', e);
  }
}

export async function recordOfferShown(id: string, day: string): Promise<void> {
  const rec = await readOffers(day);
  if (rec.shown.includes(id)) return;
  await writeOffers({ ...rec, shown: [...rec.shown, id] });
}

export async function recordOfferDismissed(id: string, day: string): Promise<void> {
  const rec = await readOffers(day);
  if (rec.dismissed.includes(id)) return;
  await writeOffers({ ...rec, dismissed: [...rec.dismissed, id] });
}

// ── Guest "Avísame" → login → favorite applied after login (§13 J6) ─────────
export async function savePendingAvisame(eventId: string): Promise<void> {
  if (!isCityEventId(eventId)) return;
  await AsyncStorage.setItem(PENDING_AVISAME_KEY, JSON.stringify({ event_id: eventId, exp: Date.now() + PENDING_AVISAME_TTL_MS }));
}

/** One-shot: returns the pending event id (if still valid) and clears the key. */
export async function takePendingAvisame(): Promise<string | null> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(PENDING_AVISAME_KEY);
    if (raw) await AsyncStorage.removeItem(PENDING_AVISAME_KEY);
  } catch (e) {
    console.error('[eventNotif] read pending avisame failed', e);
    return null;
  }
  if (!raw) return null;
  try {
    const p: unknown = JSON.parse(raw);
    if (!p || typeof p !== 'object') return null;
    const r = p as Record<string, unknown>;
    if (!isCityEventId(r.event_id) || typeof r.exp !== 'number' || r.exp < Date.now()) return null;
    return r.event_id;
  } catch {
    return null;
  }
}

// ── Server prefs: GET/PUT /me/event-notif-prefs ─────────────────────────────
export type EventNotifPrefs = {
  reminders_enabled: boolean;
  lang: string;
  nearby_enabled: boolean;
  categories: EventCategory[];
};

let PREFS_CACHE: { userId: string; prefs: EventNotifPrefs; at: number } | null = null;
const PREFS_TTL_MS = 5 * MIN_MS;
const PREFS_PATH = '/me/event-notif-prefs';

function normalizePrefs(raw: unknown): EventNotifPrefs {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const payload = r.data && typeof r.data === 'object' ? (r.data as Record<string, unknown>) : r;
  const cats = Array.isArray(payload.categories) ? payload.categories.filter(isEventCategory) : [];
  return {
    reminders_enabled: payload.reminders_enabled !== false, // default ON
    lang: typeof payload.lang === 'string' && /^(es|en|fr|pt)$/.test(payload.lang) ? payload.lang : 'es',
    nearby_enabled: payload.nearby_enabled === true,         // default OFF
    categories: cats.length ? cats : [...EVENT_CATEGORIES],
  };
}

/**
 * Per-user prefs, read WITHOUT api.get: '/me/…' is not a PRIVATE_PATH, so api.get
 * would file the answer in the shared swr cache where the next account on the
 * device could read it. Returns null when unknown (offline / not deployed).
 */
export async function loadEventNotifPrefs(userId: string, force = false): Promise<EventNotifPrefs | null> {
  if (!force && PREFS_CACHE && PREFS_CACHE.userId === userId && Date.now() - PREFS_CACHE.at < PREFS_TTL_MS) {
    return PREFS_CACHE.prefs;
  }
  try {
    const token = await getToken();
    if (!token) return null;
    const res = await fetchT(`${API_BASE}${PREFS_PATH}`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...AMO_CLIENT_HEADERS,
        Authorization: `Bearer ${token}`,
      },
      credentials: Platform.OS === 'web' ? 'same-origin' : 'include',
    });
    if (!res.ok) {
      console.error('[eventNotif] prefs GET failed', res.status);
      return null;
    }
    const prefs = normalizePrefs(await res.json());
    PREFS_CACHE = { userId, prefs, at: Date.now() };
    return prefs;
  } catch (e) {
    console.error('[eventNotif] prefs GET error', e);
    return null;
  }
}

/** Full-object PUT (the server may treat it as replace or merge — both are safe). Throws on failure. */
export async function saveEventNotifPrefs(userId: string, next: EventNotifPrefs): Promise<EventNotifPrefs> {
  await api.put(PREFS_PATH, next);
  PREFS_CACHE = { userId, prefs: next, at: Date.now() };
  return next;
}

export function peekEventNotifPrefs(userId: string): EventNotifPrefs | null {
  return PREFS_CACHE && PREFS_CACHE.userId === userId ? PREFS_CACHE.prefs : null;
}

export function forgetEventNotifPrefs(): void {
  PREFS_CACHE = null;
}

export const DEFAULT_EVENT_NOTIF_PREFS: EventNotifPrefs = {
  reminders_enabled: true,
  lang: 'es',
  nearby_enabled: false,
  categories: [...EVENT_CATEGORIES],
};

// ── Reminder channel (native Expo push / web push 'events' scope) ──────────
export type ChannelState = 'active' | 'requestable' | 'unavailable';

export async function reminderChannelState(): Promise<ChannelState> {
  try {
    if (Platform.OS === 'web') {
      const st = await pushState();
      if (st === 'subscribed') return (await pushScopes()).includes('events') ? 'active' : 'requestable';
      if (st === 'ready') return 'requestable';
      return 'unavailable';
    }
    if (!Device.isDevice) return 'unavailable';
    const perm = await Notifications.getPermissionsAsync();
    if (perm.status === 'granted') return 'active';
    return perm.canAskAgain ? 'requestable' : 'unavailable';
  } catch (e) {
    console.error('[eventNotif] channel state failed', e);
    return 'unavailable';
  }
}

/**
 * Make the reminder channel usable. MUST be the first await inside the tap
 * (web permission prompts need the user gesture). Web: add the 'events' consent
 * scope. Native: permission (if still undetermined) + token registration for
 * the signed-in account (idempotent upsert server-side).
 */
export async function activateReminderChannel(): Promise<boolean> {
  try {
    if (Platform.OS === 'web') return (await subscribePush(['events'])) === 'subscribed';
    return await registerUserPushToken();
  } catch (e) {
    console.error('[eventNotif] activate channel failed', e);
    return false;
  }
}

/**
 * Sign-out: stop this device receiving the account's pushes (shared phones /
 * browsers). Must run BEFORE the session is cleared — both endpoints need auth.
 * Web: drop the browser subscription (every scope). Native: deactivate the Expo
 * token (PushBootstrap re-registers it on the next sign-in). Never throws.
 */
export async function releasePushOnSignOut(): Promise<void> {
  try {
    if (Platform.OS === 'web') await unsubscribePush();
    else await unregisterPushToken('user');
  } catch (e) {
    console.error('[eventNotif] release push on sign-out failed', e);
  }
  forgetEventNotifPrefs();
}

// ── Position, only when permission is ALREADY granted (never prompts) ──────
export async function positionIfGranted(maxAgeMs = 5 * MIN_MS): Promise<{ lat: number; lng: number } | null> {
  try {
    const status = await geoService.syncPermission(); // reads permission, never prompts
    if (status !== 'granted') return null;
    const s = geoService.getState();
    if (s.position && Date.now() - s.position.ts <= maxAgeMs) return { lat: s.position.lat, lng: s.position.lng };
    if (Platform.OS !== 'web') {
      const last = await Location.getLastKnownPositionAsync({ maxAge: maxAgeMs }).catch(() => null);
      if (last) return { lat: last.coords.latitude, lng: last.coords.longitude };
      const fix = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((r) => setTimeout(() => r(null), 10000)),
      ]).catch(() => null);
      return fix ? { lat: fix.coords.latitude, lng: fix.coords.longitude } : null;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
    return await new Promise((resolve) => {
      try {
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
          () => resolve(null),
          { enableHighAccuracy: false, maximumAge: maxAgeMs, timeout: 10000 },
        );
      } catch {
        resolve(null);
      }
    });
  } catch (e) {
    console.error('[eventNotif] position read failed', e);
    return null;
  }
}
