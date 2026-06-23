import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const STATIC_MODE = process.env.EXPO_PUBLIC_STATIC_MODE === '1' || !BACKEND_URL;
// Optional: a Vercel Edge Function (or any server) that proxies queries to
// Anthropic Claude. When set, /search calls fetch this first and merges the
// AI payload into the static result. Configure via env: EXPO_PUBLIC_AI_PROXY_URL
const AI_PROXY_URL = process.env.EXPO_PUBLIC_AI_PROXY_URL || '/api/ai-search';

// ── STATIC FALLBACK ──────────────────────────────────────────────
// When STATIC_MODE is on (or no backend URL configured), GET requests
// resolve from /data/<path>.json files bundled with the web build.
// POST/PUT/PATCH/DELETE become silent no-ops returning {} so the UI
// stays interactive without backend connectivity.
const staticUrl = (path: string): string => {
  // Strip leading slash, strip query string
  const clean = path.replace(/^\/+/, '').split('?')[0];
  return `/data/${clean}.json`;
};

const tryStatic = async (path: string): Promise<any> => {
  try {
    const res = await fetch(staticUrl(path));
    if (!res.ok) return null;
    return await res.json();
  } catch { /* static file not available — expected for missing endpoints */ }
  return null;
};

// ── CLIENT-SIDE SEARCH (static mode) ────────────────────────────
// /search?q=... is dynamic — there's no JSON file for it. In static mode we
// load the catalogs once, lower-case index them, and filter by token match.
type SearchCache = {
  partners: any[]; events: any[]; concerts: any[];
  partner_events: any[]; transport: any[]; venues: any[];
} | null;
let SEARCH_CACHE: SearchCache = null;
let SEARCH_CACHE_PROMISE: Promise<SearchCache> | null = null;

const loadSearchCache = async (): Promise<SearchCache> => {
  if (SEARCH_CACHE) return SEARCH_CACHE;
  if (SEARCH_CACHE_PROMISE) return SEARCH_CACHE_PROMISE;
  SEARCH_CACHE_PROMISE = (async () => {
    const [partners, events, concerts, partner_events, transport, venues] = await Promise.all([
      tryStatic('/partners'), tryStatic('/events'), tryStatic('/concerts'),
      tryStatic('/partner-events'), tryStatic('/transport'), tryStatic('/venues'),
    ]);
    SEARCH_CACHE = {
      partners:       Array.isArray(partners) ? partners : [],
      events:         Array.isArray(events) ? events : [],
      concerts:       Array.isArray(concerts) ? concerts : [],
      partner_events: Array.isArray(partner_events) ? partner_events : [],
      transport:      Array.isArray(transport) ? transport : [],
      venues:         Array.isArray(venues) ? venues : [],
    };
    return SEARCH_CACHE;
  })();
  return SEARCH_CACHE_PROMISE;
};

const norm = (s: any): string => (typeof s === 'string' ? s : '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// EN ↔ ES synonym expansion: maps English tourism terms to the Spanish words
// our catalogs actually use. When a user types "walled city" we also search
// for "ciudad amurallada", "centro historico", "casco antiguo".
const SYNONYMS: Record<string, string[]> = {
  'walled city':       ['ciudad amurallada', 'centro historico', 'casco antiguo'],
  'old city':          ['ciudad amurallada', 'centro historico', 'casco antiguo'],
  'old town':          ['ciudad amurallada', 'centro historico', 'casco antiguo'],
  'historic center':   ['centro historico', 'ciudad amurallada'],
  'historic centre':   ['centro historico', 'ciudad amurallada'],
  'downtown':          ['centro', 'centro historico'],
  'restaurants':       ['restaurante', 'comida', 'gastronomia'],
  'restaurant':        ['restaurante', 'comida', 'gastronomia'],
  'dining':            ['restaurante', 'comida', 'gastronomia'],
  'fine dining':       ['restaurante', 'gastronomia'],
  'food':              ['comida', 'restaurante', 'gastronomia'],
  'bars':              ['bar', 'coctel', 'rooftop'],
  'rooftop':           ['rooftop', 'terraza', 'bar'],
  'nightlife':         ['discoteca', 'bar', 'club', 'noche'],
  'beach':             ['playa', 'mar', 'islas'],
  'beaches':           ['playa', 'mar', 'islas'],
  'island':            ['isla', 'rosario'],
  'islands':           ['islas', 'rosario'],
  'tour':              ['tour', 'experiencia', 'recorrido'],
  'tours':             ['tour', 'experiencia', 'recorrido'],
  'spa':               ['spa', 'bienestar', 'masaje'],
  'wellness':          ['spa', 'bienestar', 'yoga'],
  'getsemani':         ['getsemani'],
  'romantic':          ['romantico', 'pareja', 'luna de miel'],
  'honeymoon':         ['luna de miel', 'romantico', 'pareja'],
  'sunset':            ['atardecer', 'sunset'],
  'shopping':          ['compras', 'boutique', 'tienda'],
  'spanish':           ['espanol', 'colombiano'],
  'haircut':           ['peluqueria', 'barberia', 'salon', 'corte'],
  'barber':            ['barberia', 'barbershop', 'peluqueria'],
  'nails':             ['unas', 'manicure', 'pedicure'],
  'makeup':            ['maquillaje', 'makeup'],
  'facial':            ['facial', 'estetica', 'tratamiento'],
  'lashes':            ['pestanas', 'cejas', 'lashes'],
  'beauty':            ['belleza', 'estetica', 'salon'],
  'salon':             ['salon', 'peluqueria', 'belleza'],
};

// Map common English category words to our partner.category values
const CATEGORY_HINTS: Record<string, string[]> = {
  restaurant: ['restaurant', 'restaurante', 'food', 'dining', 'comida'],
  bar:        ['bar', 'rooftop', 'cocktail', 'coctel', 'nightlife', 'discoteca'],
  hotel:      ['hotel', 'hospedaje', 'stay', 'lodging'],
  experience: ['experience', 'experiencia', 'tour', 'recorrido', 'activity'],
  wellness:   ['spa', 'wellness', 'yoga', 'bienestar', 'masaje'],
  beauty:     ['beauty', 'belleza', 'salon', 'peluqueria', 'barberia', 'unas', 'maquillaje', 'estetica', 'pestanas', 'cejas', 'nails', 'haircut', 'barber', 'makeup', 'facial'],
  beach:      ['beach', 'playa', 'island', 'isla', 'rosario'],
  shopping:   ['shopping', 'boutique', 'compras', 'tienda'],
};

const expandQuery = (q: string): string[] => {
  const n = norm(q);
  const terms = new Set<string>([n]);
  // direct phrase match in SYNONYMS
  for (const key of Object.keys(SYNONYMS)) {
    if (n.includes(key)) {
      for (const syn of SYNONYMS[key]) terms.add(norm(syn));
    }
  }
  // also add each word from the query so partial matching works
  for (const word of n.split(/\s+/).filter(w => w.length >= 3)) {
    terms.add(word);
    if (SYNONYMS[word]) for (const syn of SYNONYMS[word]) terms.add(norm(syn));
  }
  return Array.from(terms);
};

const detectCategories = (q: string): string[] => {
  const n = norm(q);
  const cats: string[] = [];
  for (const [cat, hints] of Object.entries(CATEGORY_HINTS)) {
    if (hints.some(h => n.includes(h))) cats.push(cat);
  }
  return cats;
};

const matchAny = (terms: string[], ...fields: any[]): boolean => {
  for (const t of terms) {
    if (!t) continue;
    for (const f of fields) {
      if (norm(f).includes(t)) return true;
    }
  }
  return false;
};

const staticSearch = async (path: string): Promise<any> => {
  // path is like '/search?q=foo&lang=es'
  const qs = path.split('?')[1] || '';
  const params = new URLSearchParams(qs);
  const q = (params.get('q') || '').trim();
  if (!q || q.length < 2) {
    return { events: [], concerts: [], partners: [], venues: [], transport: [], partner_events: [] };
  }
  const cache = (await loadSearchCache())!;
  const terms = expandQuery(q);
  const cats  = detectCategories(q);

  let partners = cache.partners.filter((p: any) =>
    matchAny(terms, p.name, p.description, p.category, p.subcategory, p.address, p.cuisine)
  );
  // If text match is sparse, fall back to category match so we always have something to show
  if (partners.length < 5 && cats.length > 0) {
    const byCat = cache.partners.filter((p: any) => {
      const pc = norm(p.category);
      return cats.some(c => pc.includes(c));
    });
    const seen = new Set(partners.map((p: any) => p.partner_id || p.id));
    for (const p of byCat) {
      const id = p.partner_id || p.id;
      if (!seen.has(id)) { partners.push(p); seen.add(id); }
      if (partners.length >= 20) break;
    }
  }
  partners = partners.slice(0, 20);

  const events = cache.events.filter((e: any) =>
    matchAny(terms, e.title, e.description, e.type, e.category, e.venue_name)
  ).slice(0, 20);
  const concerts = cache.concerts.filter((c: any) =>
    matchAny(terms, c.title, c.artist, c.genre, c.venue_name, c.description)
  ).slice(0, 20);
  const partner_events = cache.partner_events.filter((pe: any) =>
    matchAny(terms, pe.title, pe.category, pe.partner_name)
  ).slice(0, 20);
  const transport = cache.transport.filter((t: any) =>
    matchAny(terms, t.name, t.type, t.description, t.destination)
  ).slice(0, 10);
  const venues = cache.venues.filter((v: any) =>
    matchAny(terms, v.name, v.description, v.type, v.address)
  ).slice(0, 10);
  return { events, concerts, partners, venues, transport, partner_events };
};

// Optional AI enrichment via a server-side proxy that holds the Anthropic key.
// Adds `ai` payload to the result. Silently no-ops if the proxy is missing.
const tryAIEnrich = async (q: string, lang: string, base: any): Promise<any> => {
  if (!AI_PROXY_URL) return base;
  try {
    // Always give Claude a generous candidate pool. If the filtered search
    // returned few partners (e.g. EN query against ES data), top up from the
    // detected categories so the concierge always has something real to suggest.
    const cache = await loadSearchCache();
    const cats = detectCategories(q);
    const seen = new Set<string>();
    const candPartners: any[] = [];
    const pushPartner = (p: any) => {
      const id = p.partner_id || p.id;
      if (!id || seen.has(id)) return;
      seen.add(id);
      candPartners.push({
        id, name: p.name, category: p.category, subcategory: p.subcategory,
        zone: p.address || p.zone, cuisine: p.cuisine,
      });
    };
    for (const p of (base.partners || [])) pushPartner(p);
    if (cache && cats.length) {
      for (const p of cache.partners) {
        if (candPartners.length >= 15) break;
        if (cats.some(c => norm(p.category).includes(c))) pushPartner(p);
      }
    }
    // If still thin, send top partners overall (premium tier first if present)
    if (cache && candPartners.length < 8) {
      const ranked = [...cache.partners].sort((a: any, b: any) => {
        const ta = (a.tier === 'premium' || a.tier === 'gold') ? 0 : 1;
        const tb = (b.tier === 'premium' || b.tier === 'gold') ? 0 : 1;
        return ta - tb;
      });
      for (const p of ranked) {
        if (candPartners.length >= 12) break;
        pushPartner(p);
      }
    }

    const candEvents = (base.events || []).slice(0, 8).map((e: any) => ({
      id: e.event_id || e.id, title: e.title, type: e.type, date: e.date, venue: e.venue_name,
    }));

    const res = await fetch(AI_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, lang, hits: { partners: candPartners, events: candEvents } }),
    });
    if (!res.ok) return base;
    const ai = await res.json();
    return { ...base, ai };
  } catch { /* AI enrichment unavailable — return base results without AI */ }
  return base;
};

const getToken = async (): Promise<string | null> => {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem('session_token');
  }
  return SecureStore.getItemAsync('session_token');
};

const buildHeaders = async (override?: Record<string, string>): Promise<Record<string, string>> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!override?.Authorization) {
    const token = await getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return { ...headers, ...(override || {}) };
};

// On web with cross-origin backend, credentials: 'include' causes Safari/iOS
// to block responses unless the server sends Access-Control-Allow-Credentials
// with a specific origin (not wildcard). Use 'same-origin' for web to avoid
// this; auth is handled via Bearer token header instead of cookies.
const CREDS: RequestCredentials = Platform.OS === 'web' ? 'same-origin' : 'include';

type Opts = { headers?: Record<string, string> };

export const api = {
  get: async (path: string, opts?: Opts) => {
    // Static mode → read from bundled /data/*.json
    if (STATIC_MODE) {
      // Special: /search must be computed client-side over the static catalogs
      if (path.startsWith('/search')) {
        const qs = path.split('?')[1] || '';
        const params = new URLSearchParams(qs);
        const q = (params.get('q') || '').trim();
        const lang = params.get('lang') || 'es';
        const base = await staticSearch(path);
        return await tryAIEnrich(q, lang, base);
      }
      const data = await tryStatic(path);
      if (data !== null) return data;
      // Unknown endpoint in static mode — return safe empty
      return [];
    }
    try {
      const headers = await buildHeaders(opts?.headers);
      const res = await fetch(`${BACKEND_URL}/api${path}`, { headers, credentials: CREDS });
      if (!res.ok) {
        // Network OK but backend errored → try static fallback before throwing
        const fallback = await tryStatic(path);
        if (fallback !== null) return fallback;
        throw new Error(`GET ${path} failed: ${res.status}`);
      }
      return res.json();
    } catch (err) {
      // Network failure (backend down) → try static fallback
      const fallback = await tryStatic(path);
      if (fallback !== null) return fallback;
      throw err;
    }
  },
  post: async (path: string, body?: any, opts?: Opts) => {
    if (STATIC_MODE) {
      // No-op write — return body or empty object so UI optimistically updates
      return body ?? {};
    }
    const headers = await buildHeaders(opts?.headers);
    const res = await fetch(`${BACKEND_URL}/api${path}`, {
      method: 'POST',
      headers,
      credentials: CREDS,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let msg = `POST ${path} failed: ${res.status}`;
      try {
        const err = await res.json();
        if (err?.detail) msg = err.detail;
      } catch { /* response body not JSON — use status code message */ }
      throw new Error(msg);
    }
    return res.json();
  },
  put: async (path: string, body?: any, opts?: Opts) => {
    if (STATIC_MODE) return body ?? {};
    const headers = await buildHeaders(opts?.headers);
    const res = await fetch(`${BACKEND_URL}/api${path}`, {
      method: 'PUT',
      headers,
      credentials: CREDS,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status}`);
    return res.json();
  },
  patch: async (path: string, body?: any, opts?: Opts) => {
    if (STATIC_MODE) return body ?? {};
    const headers = await buildHeaders(opts?.headers);
    const res = await fetch(`${BACKEND_URL}/api${path}`, {
      method: 'PATCH',
      headers,
      credentials: CREDS,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let msg = `PATCH ${path} failed: ${res.status}`;
      try {
        const err = await res.json();
        if (err?.detail) msg = err.detail;
      } catch { /* response body not JSON — use status code message */ }
      throw new Error(msg);
    }
    return res.json();
  },
  delete: async (path: string, body?: any, opts?: Opts) => {
    if (STATIC_MODE) return {};
    const headers = await buildHeaders(opts?.headers);
    const res = await fetch(`${BACKEND_URL}/api${path}`, {
      method: 'DELETE',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: CREDS,
    });
    if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
    return res.json();
  },
};
