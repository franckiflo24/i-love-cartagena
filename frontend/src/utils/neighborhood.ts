/**
 * Assign a lat/lng to its nearest Cartagena neighborhood by centroid.
 * Venues carry only coordinates (no clean neighborhood field), so proximity to
 * the neighborhood centroids in neighborhoods.json is the pragmatic mapping.
 * Mirrors the backend's _nearest_neighborhood (local_signals.py).
 */
export type NbhCentroid = { slug: string; centroid_lat?: number; centroid_lng?: number };

/** Display labels for neighborhood slugs (matches neighborhoods.json names). */
export const NBH_LABELS: Record<string, string> = {
  centro: 'Centro', san_diego: 'San Diego', getsemani: 'Getsemaní',
  bocagrande: 'Bocagrande', laguito: 'El Laguito', castillogrande: 'Castillogrande',
  manga: 'Manga', marbella: 'Marbella', la_boquilla: 'La Boquilla', tierrabomba: 'Tierra Bomba',
};

// Beyond ~0.06° a point isn't meaningfully inside any barrio (e.g. islands, out of town).
const MAX_DIST = 0.06;

export function nearestNeighborhood(
  lat: number | null | undefined,
  lng: number | null | undefined,
  neighborhoods: NbhCentroid[],
): string | null {
  if (lat == null || lng == null || !neighborhoods?.length) return null;
  let best: string | null = null;
  let bestD = Infinity;
  for (const n of neighborhoods) {
    if (n.centroid_lat == null || n.centroid_lng == null) continue;
    const d = (lat - n.centroid_lat) ** 2 + (lng - n.centroid_lng) ** 2;
    if (d < bestD) {
      bestD = d;
      best = n.slug;
    }
  }
  return best != null && Math.sqrt(bestD) <= MAX_DIST ? best : null;
}

// A venue's address usually NAMES its barrio — a far stronger signal than
// nearest-centroid, which misassigns ~26% of venues on the elongated
// peninsulas (e.g. north Bocagrande → Getsemaní). Ordered most-specific
// first; "centro histórico" is required for `centro` so "Centro Comercial"
// (a mall) never false-matches.
const ADDR_BARRIO: Array<[RegExp, string]> = [
  [/\bcastillo\s?grande\b/i, 'castillogrande'],
  [/\bboca\s?grande\b/i, 'bocagrande'],
  [/\bel\s+laguito\b|\blaguito\b/i, 'laguito'],
  [/\bgetseman[ií]\b/i, 'getsemani'],
  [/\bsan\s+diego\b/i, 'san_diego'],
  [/\bmarbella\b/i, 'marbella'],
  [/\bla\s+boquilla\b|\bboquilla\b/i, 'la_boquilla'],
  [/\btierra\s?bomba\b/i, 'tierrabomba'],
  [/\bmanga\b/i, 'manga'],
  [/\bcentro\s+hist[oó]rico\b/i, 'centro'],
];

export function barrioFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  for (const [re, slug] of ADDR_BARRIO) if (re.test(address)) return slug;
  return null;
}

/** Best barrio for a venue: address name first (reliable), centroid fallback. */
export function venueBarrio(
  address: string | null | undefined,
  lat: number | null | undefined,
  lng: number | null | undefined,
  neighborhoods: NbhCentroid[],
): string | null {
  return barrioFromAddress(address) || nearestNeighborhood(lat, lng, neighborhoods);
}
