/**
 * Shared catalog loader for AMO Cartagena serverless functions.
 * Used by /api/concierge and /api/itinerary for grounding.
 *
 * Fetches partners.json once per warm instance and caches it.
 * Field mapping matches AMO's partners.json schema:
 *   partner_id → slug, name, category, address → zone, location.lat/lng
 */

export type CatItem = {
  slug: string;
  name: string;
  category: string;
  zone: string;
  lat?: number;
  lng?: number;
  hours?: string;
  price_range?: string;
};

export type CatalogCache = {
  bySlug: Map<string, CatItem>;
  allowlist: string;
};

const CATALOG_PATH = '/data/partners.json';

let cache: CatalogCache | null = null;

export async function getCatalog(origin: string): Promise<CatalogCache> {
  if (cache) return cache;

  const res = await fetch(new URL(CATALOG_PATH, origin).toString());
  if (!res.ok) throw new Error(`catalog fetch ${res.status}`);
  const raw = await res.json();
  const list: any[] = Array.isArray(raw) ? raw : raw.partners ?? [];

  const items: CatItem[] = list
    .map((p: any) => {
      const loc = p.location || {};
      return {
        slug: String(p.partner_id ?? p.slug ?? p.id ?? '').trim(),
        name: String(p.name ?? p.title ?? '').trim(),
        category: String(p.category ?? p.type ?? '').trim(),
        zone: String(p.address ?? p.zone ?? '').trim().split(',')[0],
        lat: typeof loc.lat === 'number' ? loc.lat : undefined,
        lng: typeof loc.lng === 'number' ? loc.lng : undefined,
        hours: String(p.hours ?? '').trim() || undefined,
        price_range: String(p.price_range ?? '').trim() || undefined,
      };
    })
    .filter((p) => p.slug && p.name);

  const bySlug = new Map(items.map((p) => [p.slug, p]));
  const allowlist = items
    .map(
      (p) =>
        `${p.slug} | ${p.name}` +
        (p.category ? ` | ${p.category}` : '') +
        (p.zone ? ` | ${p.zone}` : ''),
    )
    .join('\n');

  cache = { bySlug, allowlist };
  return cache;
}
