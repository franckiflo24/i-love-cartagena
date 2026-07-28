/**
 * Assign a lat/lng to its nearest Cartagena neighborhood by centroid.
 * Venues carry only coordinates (no clean neighborhood field), so proximity to
 * the neighborhood centroids in neighborhoods.json is the pragmatic mapping.
 * Mirrors the backend's _nearest_neighborhood (local_signals.py).
 */
export type NbhCentroid = { slug: string; centroid_lat?: number; centroid_lng?: number };

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
