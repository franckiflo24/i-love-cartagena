/**
 * swrCache — last-good GET payload per API path (memory + AsyncStorage).
 *
 * Why: every screen used to wait for its slowest backend call (~10 s on a
 * cold/scale-out Vercel instance, unbounded on bad cellular) before painting
 * anything — the mechanical cause of "spinners everywhere". This module keeps
 * the LAST successful payload for each path so a screen can paint from it
 * instantly and let the network silently replace it (stale-while-revalidate).
 * It is a cache, not a source of truth: callers still run the live request.
 *
 * Scoping: per-user paths (PRIVATE_PATH) are namespaced by the signed-in
 * user_id and are NEVER stored while the scope is 'anon', so two accounts on
 * one device can't see each other's bookings/favorites and a logout wipes only
 * that user's rows (clearScope).
 *
 * Storage safety: every AsyncStorage call is wrapped — a throwing store
 * (sandboxed in-app browsers, private mode) degrades to memory-only. Rows above
 * SWR_PERSIST_MAX stay memory-only (Android SQLite row cap). Persisting runs
 * off the render tick and is skipped when the payload hash is unchanged, so the
 * 1.3 MB partner catalog isn't re-written on every revalidation.
 *
 * The factory is exported so scripts/check-swr-cache.mjs can drive the exact
 * same code in Node with a mock store and a fake clock.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

// The live-backend fallback to /data is for the PUBLIC catalog only. Per-user
// paths, filtered queries and auth rejections must surface: those placeholder
// files are `[]`, so a backend blip told signed-in users they had no
// reservations/tickets/favorites, and a stripped ?date=/?partner_id= served
// unrelated rows as if they matched. (Owned here so api.ts and the cache agree.)
// trips + payments added 2026-10-02: a trip doc and a payment-by-reference
// result are per-user. Without 'trips'/'payments' here they cached under the
// shared 'anon' scope, so /trips/{id} and /payments/by-reference/{ref} could be
// served to another account (or an anon viewer) on a cache hit, and replayed on
// a 5xx. (/trips/shared/{code} is a public guest view — being private just means
// it isn't cached, which is correct, not a regression.)
export const PRIVATE_PATH = /^\/(auth|business|admin|reservations|rewards\/me|favorites|notifications|my-week|city-pass\/mine|city-pass\/qr|tickets|experience-bookings|port-tax\/my-tickets|calendar|profile|passport|for-you|intel|itineraries|trips|payments|agent)(\/|\?|$)/;

// Never worth caching: per-query computations, auth handshakes, health pings,
// admin intel. A 'no' here means api.get neither writes nor recovers from cache.
// tickets + city-pass/qr: a cached rotating wire is a DEAD QR replayed with a live
// countdown — never store them (the tickets client also bypasses api.get entirely).
export const NO_CACHE_PATH = /^\/(search|auth|health|intel|admin|tickets|city-pass\/qr|payments)(\/|\?|$)/;

export const SWR_NS = 'swr:v1:';
export const SWR_TTL_MS = 7 * 24 * 3600 * 1000;
export const SWR_PERSIST_MAX = 1_500_000; // Android AsyncStorage row limit safety

export type SwrEntry<T = unknown> = { t: number; data: T };

/** The subset of AsyncStorage the cache needs — mockable in Node. */
export type SwrStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
  getAllKeys: () => Promise<readonly string[]>;
  multiRemove: (keys: readonly string[]) => Promise<void>;
};

export type SwrCache = {
  /** Bind private paths to a user. null → 'anon' (private paths stop caching). */
  setScope: (userId: string | null) => void;
  getScope: () => string;
  isPrivate: (path: string) => boolean;
  /** False for NO_CACHE_PATH and for private paths while anonymous. */
  isCacheable: (path: string) => boolean;
  keyFor: (path: string) => string;
  /** Last good payload or null (missing, expired, unreadable, not cacheable). */
  peek: <T = unknown>(path: string) => Promise<T | null>;
  /** Same as peek but with its timestamp, for "updated N min ago" copy. */
  peekEntry: <T = unknown>(path: string) => Promise<SwrEntry<T> | null>;
  /** Remember a successful payload. Sync into memory; persisted off-tick. */
  put: (path: string, data: unknown) => void;
  /** Forget one path (memory + disk). */
  invalidate: (path: string) => Promise<void>;
  /** Wipe every private row of one user (logout / account switch). */
  clearScope: (userId: string) => Promise<void>;
  /** Number of in-memory entries (diagnostics + tests). */
  memSize: () => number;
  /** Resolve once every deferred persist has settled (tests). */
  flush: () => Promise<void>;
};

type CreateOpts = {
  now?: () => number;
  /** Schedules the persist; defaults to setTimeout(0) to stay off the render tick. */
  defer?: (fn: () => void) => void;
};

// djb2-xor over the serialized payload: O(n) once, avoids re-persisting 1.3 MB
// catalogs whose content did not change between revalidations.
const hashStr = (s: string): number => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
};

const isEntry = (v: unknown): v is SwrEntry =>
  !!v && typeof v === 'object' && typeof (v as SwrEntry).t === 'number' && 'data' in (v as SwrEntry);

export function createSwrCache(storage: SwrStorage, opts: CreateOpts = {}): SwrCache {
  const now = opts.now ?? (() => Date.now());
  const defer = opts.defer ?? ((fn: () => void) => { setTimeout(fn, 0); });
  const mem = new Map<string, SwrEntry>();
  const persistedHash = new Map<string, number>();
  const pending = new Set<Promise<void>>();
  let scope = 'anon';

  const isPrivate = (path: string) => PRIVATE_PATH.test(path);
  const isCacheable = (path: string) =>
    !NO_CACHE_PATH.test(path) && !(isPrivate(path) && scope === 'anon');
  const keyFor = (path: string) => `${SWR_NS}${isPrivate(path) ? `${scope}:` : ''}${path}`;

  const track = (p: Promise<void>) => {
    const wrapped = p.catch(() => { /* best effort — memory copy still serves */ });
    pending.add(wrapped);
    wrapped.finally(() => { pending.delete(wrapped); }).catch(() => { /* noop */ });
  };

  const peekEntry = async <T = unknown>(path: string): Promise<SwrEntry<T> | null> => {
    if (!isCacheable(path)) return null;
    const k = keyFor(path);
    const m = mem.get(k);
    if (m) {
      if (now() - m.t > SWR_TTL_MS) { mem.delete(k); return null; }
      return m as SwrEntry<T>;
    }
    let raw: string | null = null;
    try { raw = await storage.getItem(k); } catch { return null; }
    if (!raw) return null;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return null; }
    if (!isEntry(parsed)) return null;
    if (now() - parsed.t > SWR_TTL_MS) {
      track(storage.removeItem(k));
      return null;
    }
    mem.set(k, parsed);
    persistedHash.set(k, hashStr(JSON.stringify(parsed.data)));
    return parsed as SwrEntry<T>;
  };

  const peek = async <T = unknown>(path: string): Promise<T | null> => {
    const e = await peekEntry<T>(path);
    return e ? e.data : null;
  };

  const put = (path: string, data: unknown): void => {
    if (!isCacheable(path)) return;
    const k = keyFor(path);
    const entry: SwrEntry = { t: now(), data };
    mem.set(k, entry);
    defer(() => {
      // Serialize the payload once and compose the row by hand so the changing
      // timestamp never defeats the "unchanged content" check.
      let body: string | undefined;
      try { body = JSON.stringify(data); } catch { return; }
      if (body === undefined) return;
      if (body.length > SWR_PERSIST_MAX) return; // memory-only for this session
      const h = hashStr(body);
      if (persistedHash.get(k) === h) return;
      persistedHash.set(k, h);
      const row = `{"t":${entry.t},"data":${body}}`;
      let write: Promise<void>;
      try { write = storage.setItem(k, row); } catch { persistedHash.delete(k); return; }
      track(write.catch((err) => { persistedHash.delete(k); throw err; }));
    });
  };

  const invalidate = async (path: string): Promise<void> => {
    const k = keyFor(path);
    mem.delete(k);
    persistedHash.delete(k);
    try { await storage.removeItem(k); } catch { /* best effort */ }
  };

  const clearScope = async (userId: string): Promise<void> => {
    if (!userId) return;
    const pfx = `${SWR_NS}${userId}:`;
    for (const k of Array.from(mem.keys())) if (k.startsWith(pfx)) mem.delete(k);
    for (const k of Array.from(persistedHash.keys())) if (k.startsWith(pfx)) persistedHash.delete(k);
    try {
      const keys = await storage.getAllKeys();
      const mine = keys.filter((k) => k.startsWith(pfx));
      if (mine.length) await storage.multiRemove(mine);
    } catch { /* best effort — memory rows are already gone */ }
  };

  return {
    setScope: (userId) => { scope = userId || 'anon'; },
    getScope: () => scope,
    isPrivate,
    isCacheable,
    keyFor,
    peek,
    peekEntry,
    put,
    invalidate,
    clearScope,
    memSize: () => mem.size,
    flush: async () => { await Promise.all(Array.from(pending)); },
  };
}

/** App-wide instance on AsyncStorage. api.get writes to it on every successful GET. */
export const swr: SwrCache = createSwrCache(AsyncStorage);

export const setSwrScope = (userId: string | null): void => swr.setScope(userId);
export const readCache = <T = unknown>(path: string): Promise<T | null> => swr.peek<T>(path);
export const writeCache = (path: string, data: unknown): void => swr.put(path, data);
