// Walking Layer — client-side venue coordinate cache.
//
// All ~870 venue coords + tags are cached in IndexedDB on first load so
// proximity ("Cerca de ti") works entirely in-browser via haversine:
//   memory → IndexedDB → network (/data/partners.json, same-origin static).
// /api/nearby is ENRICHMENT (pulse lines), never a dependency — with no
// network after first load, the strip still works from this cache.
//
// Fail-soft contract: IndexedDB unavailable (private mode) → memory-only.
// Network + IDB both empty → resolves []. Callers render nothing on [].

interface RawPartner {
  partner_id?: string;
  name?: string;
  category?: string;
  price_range?: string;
  rating?: number;
  image_url?: string;
  tags?: string[];
  signature_dishes?: string[];
  location?: { lat?: number; lng?: number };
}

export interface CachedVenue {
  id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  tags: string[];
  dish: string | null;
  image_url: string;
  price_range: string;
  rating: number | null;
}

const DB_NAME = 'amo-walking';
const DB_VERSION = 1;
const STORE = 'venues';
const META_STORE = 'meta';
const FRESH_MS = 24 * 60 * 60 * 1000; // background-refresh cadence

// Module state on globalThis: the bundler may duplicate this module across
// route chunks; sharing state prevents parallel fetches/copies.
const _g = globalThis as any;
const _state: { memory: CachedVenue[] | null; inflight: Promise<CachedVenue[]> | null } =
  _g.__amoVenueCache || (_g.__amoVenueCache = { memory: null, inflight: null });

function slim(raw: RawPartner[]): CachedVenue[] {
  const out: CachedVenue[] = [];
  for (const p of raw) {
    const lat = p.location?.lat;
    const lng = p.location?.lng;
    if (!p.partner_id || typeof lat !== 'number' || typeof lng !== 'number') continue;
    out.push({
      id: p.partner_id,
      name: p.name || '',
      category: p.category || '',
      lat,
      lng,
      tags: Array.isArray(p.tags) ? p.tags : [],
      dish: Array.isArray(p.signature_dishes) && p.signature_dishes.length > 0 ? p.signature_dishes[0] : null,
      image_url: p.image_url || '',
      price_range: p.price_range || '',
      rating: typeof p.rating === 'number' ? p.rating : null,
    });
  }
  return out;
}

function idbOpen(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbReadAll(): Promise<{ venues: CachedVenue[]; savedAt: number } | null> {
  const db = await idbOpen();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE, META_STORE], 'readonly');
      const all = tx.objectStore(STORE).getAll();
      const meta = tx.objectStore(META_STORE).get('savedAt');
      tx.oncomplete = () => {
        db.close();
        const venues = (all.result as CachedVenue[]) || [];
        resolve(venues.length > 0 ? { venues, savedAt: (meta.result as number) || 0 } : null);
      };
      tx.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      try { db.close(); } catch {}
      resolve(null);
    }
  });
}

async function idbWriteAll(venues: CachedVenue[]): Promise<void> {
  const db = await idbOpen();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE, META_STORE], 'readwrite');
      const store = tx.objectStore(STORE);
      store.clear();
      for (const v of venues) store.put(v);
      tx.objectStore(META_STORE).put(Date.now(), 'savedAt');
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      try { db.close(); } catch {}
      resolve();
    }
  });
}

async function fetchNetwork(): Promise<CachedVenue[] | null> {
  try {
    const res = await fetch('/data/partners.json');
    if (!res.ok) return null;
    const raw = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) return null;
    return slim(raw);
  } catch {
    return null;
  }
}

/**
 * Resolve the venue cache: memory → IndexedDB → network. Background-refreshes
 * from network when the IDB copy is stale. Never rejects; [] on total failure.
 */
export function getVenues(): Promise<CachedVenue[]> {
  if (_state.memory && _state.memory.length > 0) return Promise.resolve(_state.memory);
  if (_state.inflight) return _state.inflight;
  _state.inflight = (async () => {
    const idb = await idbReadAll();
    if (idb) {
      _state.memory = idb.venues;
      if (Date.now() - idb.savedAt > FRESH_MS) {
        // stale — refresh in the background, serve cached now
        fetchNetwork().then((fresh) => {
          if (fresh && fresh.length > 0) {
            _state.memory = fresh;
            idbWriteAll(fresh);
          }
        });
      }
      return idb.venues;
    }
    const fresh = await fetchNetwork();
    if (fresh && fresh.length > 0) {
      _state.memory = fresh;
      idbWriteAll(fresh); // fire-and-forget persistence
      return fresh;
    }
    return [];
  })().finally(() => {
    _state.inflight = null;
  });
  return _state.inflight;
}
