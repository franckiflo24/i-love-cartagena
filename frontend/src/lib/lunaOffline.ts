// Luna offline — when the concierge backend/LLM is slow, unreachable, or errors,
// answer from the bundled catalog snapshot (public/data/catalog.json) so the guest
// STILL gets real venue recommendations (names, area, contact) instead of a dead
// "se me fue la señal". Mirrors the backend retrieval: category alias
// (spa→wellness, club→nightlife), multilingual style_tags, the Mediterranean basin,
// barbers, ranked by rank_score. No LLM — just the real data, instant and offline.

export interface CatalogVenue {
  partner_id: string; name: string; category: string; subcategory: string;
  display_es: string; display_en: string; style_tags: string[]; cuisine: string;
  zone: string; tier: string; rank_score: number; address: string;
  whatsapp: string; phone: string; booking_link: string; price_range: string;
  brand: string; tags: string[]; image: string;
}

let _catalog: CatalogVenue[] | null = null;
let _loading: Promise<CatalogVenue[]> | null = null;

// Loaded from the app's own static bundle → available offline (service-worker cached).
export async function loadCatalog(): Promise<CatalogVenue[]> {
  if (_catalog) return _catalog;
  if (_loading) return _loading;
  _loading = fetch('/data/catalog.json')
    .then((r) => (r.ok ? r.json() : []))
    .then((data: CatalogVenue[]) => { _catalog = Array.isArray(data) ? data : []; return _catalog; })
    .catch(() => { _catalog = []; return _catalog; });
  return _loading;
}

const strip = (s: string) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// word → category (with the renamed categories: spa→wellness, club→nightlife)
const CATEGORY_SYN: Record<string, string> = {
  restaurante: 'restaurant', restaurant: 'restaurant', comer: 'restaurant', cena: 'restaurant',
  cenar: 'restaurant', almuerzo: 'restaurant', dinner: 'restaurant', lunch: 'restaurant',
  food: 'restaurant', comida: 'restaurant', eat: 'restaurant',
  bar: 'bar', cocktail: 'bar', cocktails: 'bar', coctel: 'bar', trago: 'bar', tragos: 'bar',
  drinks: 'bar', cerveza: 'bar', beer: 'bar', wine: 'bar', vino: 'bar',
  cafe: 'cafe', coffee: 'cafe', brunch: 'cafe', desayuno: 'cafe',
  spa: 'wellness', wellness: 'wellness', masaje: 'wellness', massage: 'wellness',
  relax: 'wellness', yoga: 'wellness', bienestar: 'wellness',
  club: 'nightlife', nightlife: 'nightlife', discoteca: 'nightlife', rumba: 'nightlife',
  bailar: 'nightlife', dance: 'nightlife', fiesta: 'nightlife', party: 'nightlife',
  hotel: 'hotel', hostal: 'hotel', hospedaje: 'hotel', alojamiento: 'hotel',
  beach: 'beach_club', playa: 'beach_club', pool: 'beach_club', piscina: 'beach_club',
  isla: 'beach_club', island: 'beach_club',
  yate: 'yacht', yacht: 'yacht', lancha: 'yacht', bote: 'yacht', barco: 'yacht',
  catamaran: 'yacht', boat: 'yacht', charter: 'yacht',
  tour: 'activity', actividad: 'activity', activity: 'activity', experiencia: 'activity',
  excursion: 'activity', buceo: 'activity', diving: 'activity',
  peluqueria: 'beauty', barber: 'beauty', barbero: 'beauty', barberia: 'beauty',
  salon: 'beauty', nails: 'beauty', hair: 'beauty', belleza: 'beauty', beauty: 'beauty',
};

// word → canonical style_tag; 'mediterranean' fans out to the whole basin.
const TAG_SYN: Record<string, string> = {
  seafood: 'seafood', mariscos: 'seafood', pescado: 'seafood', ceviche: 'seafood',
  mediterranean: 'mediterranean', mediterranea: 'mediterranean', mediterraneo: 'mediterranean',
  italian: 'italian', italiana: 'italian', pizza: 'italian', pasta: 'italian',
  french: 'french', francesa: 'french',
  spanish: 'spanish', espanola: 'spanish', tapas: 'spanish', paella: 'spanish',
  arabe: 'middle_eastern', arabic: 'middle_eastern', libanes: 'middle_eastern', lebanese: 'middle_eastern',
  marroqui: 'middle_eastern', middle_eastern: 'middle_eastern',
  asian: 'asian', asiatica: 'asian', thai: 'thai', tailandesa: 'thai',
  sushi: 'sushi', japonesa: 'sushi', mexican: 'mexican', mexicana: 'mexican', tacos: 'mexican',
  peruvian: 'peruvian', peruana: 'peruvian', nikkei: 'peruvian',
  colombian: 'colombian', colombiana: 'colombian', tipica: 'colombian',
  caribbean: 'caribbean', caribena: 'caribbean',
  healthy: 'healthy', saludable: 'healthy', vegano: 'healthy', vegetariano: 'healthy',
  grill: 'grill', parrilla: 'grill', asado: 'grill', steak: 'grill', carnes: 'grill',
};
const BASIN: Record<string, string[]> = {
  mediterranean: ['mediterranean', 'middle_eastern', 'spanish', 'french', 'greek'],
};
const STOP = new Set(['el','la','de','en','un','una','los','las','que','para','con','the','a','an','of','for',
  'to','is','me','my','do','can','where','what','how','quiero','donde','recomienda','recomiendame','busco',
  'un','una','good','best','mejor','cerca','near','hay','tienes','dame','give','find','me']);

export interface OfflineResult { venues: CatalogVenue[]; cats: Set<string>; tags: Set<string> }

export function matchCatalog(catalog: CatalogVenue[], query: string, limit = 6): OfflineResult {
  const words = strip(query).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
  const cats = new Set<string>();
  const tags = new Set<string>();
  const stems: string[] = [];
  for (const w of words) {
    if (CATEGORY_SYN[w]) cats.add(CATEGORY_SYN[w]);
    if (TAG_SYN[w]) for (const t of (BASIN[TAG_SYN[w]] || [TAG_SYN[w]])) tags.add(t);
    stems.push(w.slice(0, 6)); // prefix stem bridges morphology (barbero→barber, boheme→Bohême)
  }
  const scored = catalog.map((v) => {
    let s = 0;
    if (cats.has(v.category)) s += 3;
    const vtags = (v.style_tags || []).map(strip);
    for (const t of tags) if (vtags.includes(t)) s += 5;
    const name = strip(v.name), sub = strip(v.subcategory), cui = strip(v.cuisine), brand = strip(v.brand);
    for (const st of stems) {
      if (name.includes(st)) s += 6;
      if (sub.includes(st)) s += 4;
      if (cui.includes(st)) s += 4;
      if (brand && brand.includes(st)) s += 5;
      if (vtags.some((t) => t.includes(st))) s += 3;
    }
    return { v, s };
  });
  const hits = scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s || (b.v.rank_score || 0) - (a.v.rank_score || 0));
  return { venues: hits.slice(0, limit).map((x) => x.v), cats, tags };
}

// Sibling outlets that share a brand (Casa Bohème → its 3 venues), for the brand view.
export function brandFamily(catalog: CatalogVenue[], brand: string, excludeId?: string): CatalogVenue[] {
  if (!brand) return [];
  return catalog
    .filter((v) => v.brand === brand && v.partner_id !== excludeId)
    .sort((a, b) => (b.rank_score || 0) - (a.rank_score || 0));
}

// Build a helpful text reply from the catalog — real venues, instantly, offline.
export async function offlineReply(query: string, lang: string = 'es'): Promise<string> {
  const catalog = await loadCatalog();
  if (!catalog.length) {
    return lang.startsWith('en')
      ? "I'm offline right now and couldn't load the guide. Try again when you have signal."
      : 'Estoy sin conexión y no pude cargar la guía. Intenta de nuevo cuando tengas señal.';
  }
  const { venues } = matchCatalog(catalog, query, 6);
  const list = (venues.length ? venues : catalog.slice(0, 6));
  const head = lang.startsWith('en')
    ? "I'm offline, but here's what's in the guide" + (query.trim() ? ` for “${query.trim()}”` : '') + ':'
    : 'Estoy sin conexión, pero esto es lo que tengo en la guía' + (query.trim() ? ` para “${query.trim()}”` : '') + ':';
  const lines = list.map((v) => {
    const where = v.zone || (v.address ? v.address.split(',')[0] : '');
    const kind = (lang.startsWith('en') ? v.display_en : v.display_es) || v.category;
    return `• ${v.name}${where ? ` — ${where}` : ''}${kind ? ` · ${kind}` : ''}`;
  });
  const foot = lang.startsWith('en')
    ? '\n\nReconnect for Luna’s full answer with directions and booking.'
    : '\n\nReconéctate para la respuesta completa de Luna con cómo llegar y reservar.';
  return `${head}\n${lines.join('\n')}${foot}`;
}
