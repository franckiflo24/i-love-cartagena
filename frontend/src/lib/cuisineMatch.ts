// Cross-cutting cuisine / style_tags matching for the restaurant browse filter.
//
// A restaurant carries ONE canonical `subcategory` (colombian, italian, seafood…)
// PLUS a `style_tags` array of every cuisine it actually serves (french,
// middle_eastern, mediterranean…). Browsing a cuisine pill must match EITHER, so a
// multi-cuisine venue (Juliette & Yoyo → french + middle_eastern + mediterranean)
// surfaces under each of its cuisines — not only its single primary subcategory.
//
// 'mediterranean' is not a subcategory at all; it lives only in style_tags and fans
// out to the whole Mediterranean basin. This mirrors the backend global_search
// (_CUISINE_SYNONYMS) and Luna offline (BASIN) so search, browse, and Luna agree on
// exactly which venues are "Mediterranean".

export const MED_BASIN = ['mediterranean', 'middle_eastern', 'spanish', 'french', 'greek'];

/** Does this partner match the given restaurant cuisine pill key? */
export function matchesCuisine(p: unknown, key: string): boolean {
  if (!key || key === 'all' || key === '__all__') return true;
  const rec = (p ?? {}) as { subcategory?: string; style_tags?: unknown };
  const sub = rec.subcategory || '';
  const tags: string[] = Array.isArray(rec.style_tags) ? (rec.style_tags as string[]) : [];
  if (key === 'mediterranean') {
    return MED_BASIN.includes(sub) || tags.some((t) => MED_BASIN.includes(t));
  }
  return sub === key || tags.includes(key);
}
