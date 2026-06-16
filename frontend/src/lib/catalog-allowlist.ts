/**
 * AMO Integration Contract — AI grounding allowlist.
 *
 * Builds a Set of valid slugs + a system-prompt block from live data.
 * Used by /api/concierge and /api/itinerary to prevent hallucinated
 * partner/event references in AI output.
 */

import { getPartners, getUpcomingEvents } from './data';

export interface Allowlist {
  /** Every valid slug the AI may reference. */
  slugs: Set<string>;
  /** Pre-formatted block to inject into system prompt. */
  systemBlock: string;
}

/**
 * Fetches partners + upcoming events and produces the allowlist.
 * Result is NOT cached here — callers should cache at the request
 * or warm-instance level (the data layer already caches fetches).
 */
export async function buildAllowlist(): Promise<Allowlist> {
  const [partners, events] = await Promise.all([
    getPartners(),
    getUpcomingEvents(),
  ]);

  const slugs = new Set<string>();

  const partnerLines = partners.map((p) => {
    slugs.add(p.slug);
    return (
      `${p.slug} | ${p.name}` +
      (p.category ? ` | ${p.category}` : '') +
      (p.address ? ` | ${p.address.split(',')[0]}` : '')
    );
  });

  const eventLines = events.map((e) => {
    slugs.add(e.slug);
    return (
      `${e.slug} | ${e.name_es}` +
      (e.category ? ` | ${e.category}` : '') +
      (e.date_start ? ` | ${e.date_start}` : '') +
      (e.venue ? ` | ${e.venue}` : '')
    );
  });

  const systemBlock = [
    '## Known Partners',
    'slug | name | category | zone',
    ...partnerLines,
    '',
    '## Upcoming Events',
    'slug | name | category | date | venue',
    ...eventLines,
    '',
    'IMPORTANT: Only reference slugs from the lists above.',
    'If a place is not listed, say you are not sure and do NOT invent a slug.',
  ].join('\n');

  return { slugs, systemBlock };
}

/**
 * Strips any slugs from an AI output array that are not in the allowlist.
 * Returns only the valid slugs, preserving order.
 */
export function dropHallucinatedSlugs(
  out: string[],
  allow: Set<string>,
): string[] {
  return out.filter((s) => allow.has(s));
}
