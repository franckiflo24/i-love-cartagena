// Walking Layer Drop 3 — passport data service.
//
// The user's passport is network-first with an IndexedDB fallback: it must
// render offline from the last-known copy (with a sync banner), never crash.
// Progress comes ONLY from the server's computed real discoveries — this
// module never fabricates counts.
//
// The public collection DEFINITIONS (sabores / plazas / barrios) are
// local-first: last synced copy → bundled snapshot → live revalidate in the
// background. /passport/* is a PRIVATE_PATH for the api layer (per-user cache
// scope), so api.get never falls back to /data for it; before this, a cold
// backend (8–10 s, over GET_TIMEOUT_MS) on a fresh install left plates=[] and
// the partner page rendered no stamp block at all.

import { api, fetchT, ASSET_ORIGIN } from '../constants/api';
import { kvGet, kvSet } from './venueCache';

export interface CollectionVenue {
  id: string;
  name: string;
  category: string;
  image_url: string;
  lat: number;
  lng: number;
}

export interface PlateDef {
  key: string;
  name: string;
  venues: CollectionVenue[];
}

export interface CollectionsDef {
  version: string;
  sabores: PlateDef[];
  plazas: CollectionVenue[];
  neighborhoods: { slug: string; venue_ids: string[]; total: number }[];
}

export interface PassportProgress {
  sabores: { discovered: number; total: number; plates: Record<string, boolean> };
  plazas: { discovered: number; total: number; venues: Record<string, boolean> };
  joyas: { discovered: number };
  neighborhoods: { slug: string; discovered: number; total: number }[];
  rareza?: number;
}

export interface Discovery {
  venue_id: string;
  type: 'visit' | 'dish' | 'gem';
  plate?: string;
  ts: string;
  verified_proximity: boolean;
}

export interface Rank {
  key: string;
  name: string;
  icon: string;
  min: number;
  stamps: number;
  next?: { key: string; name: string; icon: string; min: number };
  progress?: number;
}

export interface PassportTitle { key: string; name: string }

export interface SpecialStamp {
  id: string;
  name: string;
  icon: string;
  desc?: string;
  type: 'sunset' | 'venue_hours' | 'event_fixed' | 'event_annual' | 'weekly' | 'season';
  tier: 'fixed' | 'reverify';
  state: 'earned' | 'available_now' | 'upcoming' | 'out_of_window' | 'pasada';
  display_date?: string | null;
  date_unconfirmed?: boolean;
  earned_ts?: string | null;
}

export interface SeasonNow { id: string; name: string; icon: string }

export interface Passport {
  user_id: string;
  discoveries: Discovery[];
  streak: { current: number; best: number; last_day: string | null };
  total_discoveries: number;
  progress: PassportProgress;
  rank?: Rank;
  achievements?: Record<string, string>; // key → award timestamp
  standing?: { active: number; top_pct?: number } | null;
  titles?: { all: PassportTitle[]; primary: PassportTitle | null };
  specials?: SpecialStamp[];
  season_now?: SeasonNow | null;
  created_at?: string;
}

export interface DiscoverResult {
  ok: boolean;
  already_discovered: boolean;
  venue_name?: string;
  streak?: { current: number; best: number; last_day: string | null };
  total_discoveries?: number;
  points_earned?: number;
  new_achievements?: { key: string; ts: string }[];
  new_specials?: { key: string; name: string; icon: string; ts: string }[];
  completed_collections?: { type: string; name: string; slug?: string }[];
  rank?: Rank;
  rank_up?: boolean;
}

export interface GroupStanding {
  group_id: string;
  name: string | null;
  code: string;
  members: { handle: string; stamps: number; rareza: number; is_me: boolean }[];
  member_count: number;
  is_owner: boolean;
  share_url: string;
}

export interface GroupCreateResult { code: string; group_id: string; name: string | null; share_url: string }

export async function groupCreate(name: string | null, handle: string): Promise<GroupCreateResult | null> {
  try { return await api.post('/passport/groups', { name: name || undefined, handle }); } catch { return null; }
}

export async function groupJoin(code: string, handle: string): Promise<{ ok: boolean; error?: string }> {
  try { const r = await api.post('/passport/groups/join', { code, handle }); return { ok: !!r?.ok }; }
  catch (e: any) { return { ok: false, error: String(e?.message || '') }; }
}

export async function groupLeave(groupId: string): Promise<boolean> {
  try { const r = await api.post(`/passport/groups/${groupId}/leave`, {}); return !!r?.ok; } catch { return false; }
}

export async function groupsMine(): Promise<GroupStanding[]> {
  try { const r = await api.get('/passport/groups/mine'); return r?.groups || []; } catch { return []; }
}

const KV_COLLECTIONS = 'passport:collections';
// Cached per user id — another account (or a guest) on this device must
// never see someone else's cached passport.
const kvPassportKey = (userId: string) => `passport:mine:${userId}`;

// Bundled snapshot of the live payload (refresh: scripts/snapshot-passport-collections.mjs).
// ASSET_ORIGIN: same-origin on web, the production site on native (no origin there).
const STATIC_COLLECTIONS_URL = `${ASSET_ORIGIN}/data/passport/collections.json`;

let _collections: CollectionsDef | null = null;
let _inflight: Promise<CollectionsDef | null> | null = null;
let _revalidated = false;

const isCollectionsDef = (v: unknown): v is CollectionsDef => {
  const d = v as CollectionsDef | null;
  return !!d && Array.isArray(d.sabores) && d.sabores.length > 0 && Array.isArray(d.plazas);
};

async function fetchLiveCollections(): Promise<CollectionsDef | null> {
  try {
    const fresh: unknown = await api.get('/passport/collections');
    return isCollectionsDef(fresh) ? fresh : null;
  } catch {
    return null;
  }
}

async function fetchBundledCollections(): Promise<CollectionsDef | null> {
  try {
    const res = await fetchT(STATIC_COLLECTIONS_URL);
    if (!res.ok) return null;
    const json: unknown = await res.json();
    return isCollectionsDef(json) ? json : null;
  } catch {
    return null;
  }
}

/** One live refresh per session, in the background; a newer copy replaces the
 *  seed for every later caller and lands in IDB for the next launch. */
function revalidateCollections(): void {
  if (_revalidated) return;
  _revalidated = true;
  fetchLiveCollections().then((fresh) => {
    if (!fresh) return;
    _collections = fresh;
    kvSet(KV_COLLECTIONS, fresh);
  }).catch(() => { /* the seed keeps serving; next launch retries */ });
}

/** Public definitions (guest teaser + grids). Single-flight, local-first:
 *  IDB (last synced) → bundled snapshot → live. Never waits on a cold lambda
 *  when a local copy exists. */
export async function getCollections(): Promise<CollectionsDef | null> {
  if (_collections) return _collections;
  if (!_inflight) {
    _inflight = (async () => {
      let cached: CollectionsDef | null = null;
      try { cached = await kvGet<CollectionsDef>(KV_COLLECTIONS); } catch { cached = null; }
      const seed = isCollectionsDef(cached) ? cached : await fetchBundledCollections();
      if (seed) {
        _collections = seed;
        revalidateCollections();
        return seed;
      }
      // No local copy at all (the snapshot ships in the bundle, so this is the
      // exception) → the live answer is the only option.
      _revalidated = true;
      const fresh = await fetchLiveCollections();
      if (fresh) {
        _collections = fresh;
        kvSet(KV_COLLECTIONS, fresh);
      }
      return fresh;
    })().finally(() => { _inflight = null; });
  }
  return _inflight;
}

/** The signed-in user's passport. { data, fromCache } — fromCache=true means
 *  the API was unreachable and this is the last synced copy. */
export async function getPassport(userId: string): Promise<{ data: Passport | null; fromCache: boolean }> {
  try {
    const fresh = (await api.get('/passport')) as Passport;
    if (fresh && Array.isArray(fresh.discoveries)) {
      kvSet(kvPassportKey(userId), fresh);
      return { data: fresh, fromCache: false };
    }
  } catch {}
  const cached = await kvGet<Passport>(kvPassportKey(userId));
  return { data: cached, fromCache: true };
}

/** Proximity-verified discovery. Throws with the server's message on 4xx so
 *  callers can show the honest reason ("acércate al lugar para sellarlo"). */
export async function discover(
  venueId: string,
  type: 'visit' | 'dish' | 'gem',
  lat: number,
  lng: number,
  plate?: string,
): Promise<DiscoverResult> {
  const body: Record<string, unknown> = { venue_id: venueId, type, lat, lng };
  if (plate) body.plate = plate;
  return api.post('/passport/discover', body) as Promise<DiscoverResult>;
}

/** Mint a public share snapshot (counts + venue names only, never
 *  coordinates). Fail-soft: null when offline/guest — the share proceeds
 *  image-only. */
export async function mintShareLink(name?: string | null): Promise<string | null> {
  try {
    const res = await api.post('/passport/share', { name: name || undefined });
    return res?.url || null;
  } catch {
    return null;
  }
}

/** Venue-id → plates it can stamp (for the "Lo probé" button). */
export function platesForVenue(cols: CollectionsDef | null, venueId: string): PlateDef[] {
  if (!cols) return [];
  return cols.sabores.filter((s) => s.venues.some((v) => v.id === venueId));
}
