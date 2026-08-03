// Walking Layer Drop 3 — passport data service.
//
// Network-first with IndexedDB fallback: the passport must render offline
// from the last-known copy (with a sync banner), never crash. Progress comes
// ONLY from the server's computed real discoveries — this module never
// fabricates counts.

import { api } from '../constants/api';
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
}

export interface Discovery {
  venue_id: string;
  type: 'visit' | 'dish' | 'gem';
  plate?: string;
  ts: string;
  verified_proximity: boolean;
}

export interface Passport {
  user_id: string;
  discoveries: Discovery[];
  streak: { current: number; best: number; last_day: string | null };
  total_discoveries: number;
  progress: PassportProgress;
}

const KV_COLLECTIONS = 'passport:collections';
// Cached per user id — another account (or a guest) on this device must
// never see someone else's cached passport.
const kvPassportKey = (userId: string) => `passport:mine:${userId}`;

let _collections: CollectionsDef | null = null;

/** Public definitions (guest teaser + grids). Network → IDB fallback. */
export async function getCollections(): Promise<CollectionsDef | null> {
  if (_collections) return _collections;
  try {
    const fresh = (await api.get('/passport/collections')) as CollectionsDef;
    if (fresh && Array.isArray(fresh.sabores) && fresh.sabores.length > 0) {
      _collections = fresh;
      kvSet(KV_COLLECTIONS, fresh);
      return fresh;
    }
  } catch {}
  const cached = await kvGet<CollectionsDef>(KV_COLLECTIONS);
  if (cached) _collections = cached;
  return cached;
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
): Promise<any> {
  const body: Record<string, unknown> = { venue_id: venueId, type, lat, lng };
  if (plate) body.plate = plate;
  return api.post('/passport/discover', body);
}

/** Venue-id → plates it can stamp (for the "Lo probé" button). */
export function platesForVenue(cols: CollectionsDef | null, venueId: string): PlateDef[] {
  if (!cols) return [];
  return cols.sabores.filter((s) => s.venues.some((v) => v.id === venueId));
}
