// Civic-location registry + resolver (DROP 2). Civic/public spaces — plazas,
// baluartes, forts, promenades, muelles — as EVENT LOCATIONS.
//
// Honesty rails:
// - These are NOT commercial partners: no display_ready/min_fill gate applies.
//   Their own readiness flag is coords_status, and `unverified` rows NEVER
//   render a pin or resolve — hidden until someone verifies them on the ground.
// - `approximate` is acceptable for a large public landmark (the pin identifies
//   the space, not a door). No hours/price/booking/source are ever attributed.
// - merge_of rows unify with the existing partner-catalog attraction record
//   (join key = partner_id, e.g. Torre del Reloj = attr_003): they add NO pin
//   of their own — the attraction pin already exists — but the Cívico map
//   filter includes that existing pin via civicMergedIds, and the resolver
//   answers with the snapshot of its (atlas-)verified coords.
//
// Pure module: no react-native imports, so it runs in node for tests.
import raw from '../data/civicLocations.json';

export type CivicSubtype = 'plaza' | 'baluarte' | 'fort' | 'park' | 'promenade' | 'muelle' | 'avenue';
export type CoordsStatus = 'verified' | 'approximate' | 'unverified';

export type CivicLocation = {
  id: string;
  name: string;
  aliases: string[];
  zone: string;
  subtype: CivicSubtype;
  lat: number;
  lng: number;
  coords_status: CoordsStatus;
  passport_eligible: boolean;
  merge_of: string | null;
};

// Public-space slate — distinct from teal (primary), gold (pasaporte),
// blue (venues), violet (partners), orange (eventos).
export const CIVIC_PIN_COLOR = '#94A3B8';

// Spanish labels; screens pass them through tr() for EN/FR/PT chrome.
export const CIVIC_SUBTYPE_ES: Record<CivicSubtype, string> = {
  plaza: 'Plaza',
  baluarte: 'Baluarte',
  fort: 'Fuerte',
  park: 'Parque',
  promenade: 'Paseo peatonal',
  muelle: 'Muelle',
  avenue: 'Avenida',
};

const ALL: CivicLocation[] = ((raw as { locations: unknown[] }).locations as CivicLocation[])
  .filter((l) => l && typeof l.id === 'string' && typeof l.name === 'string');

/** The gate: rows a pin/resolution may use. `unverified` never leaves this door. */
export function civicShowable(): CivicLocation[] {
  return ALL.filter((l) => l.coords_status !== 'unverified' && l.lat !== 0 && l.lng !== 0);
}

/** Existing catalog pins (attr_…) that double as civic records — the Cívico
 *  filter includes them; nothing ever draws a second marker for them. */
export const civicMergedIds: ReadonlySet<string> = new Set(
  ALL.filter((l) => l.merge_of).map((l) => l.merge_of as string),
);

/** Showable civics that need their OWN pin (not merged with an existing one). */
export function civicOwnPins(): CivicLocation[] {
  return civicShowable().filter((l) => !l.merge_of);
}

// accent/case/punctuation-insensitive form used for matching
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type Needle = { loc: CivicLocation; n: string };
let NEEDLES: Needle[] | null = null;
function needles(): Needle[] {
  if (!NEEDLES) {
    NEEDLES = [];
    for (const loc of civicShowable()) {
      for (const name of [loc.name, ...loc.aliases]) {
        const n = norm(name);
        if (n.length >= 6) NEEDLES.push({ loc, n }); // never match on a stub like "plaza"
      }
    }
    // Longest needle first: "plaza de santo domingo" must beat "santo domingo",
    // and in ambiguous Torre del Reloj / Plaza de la Paz / Camellón adjacency
    // text the most specific (longest) mention wins deterministically.
    NEEDLES.sort((a, b) => b.n.length - a.n.length);
  }
  return NEEDLES;
}

/** Location string → civic record, or null. Only coords_status ≠ unverified can
 *  resolve (the gate lives in civicShowable). Matching is a word-boundary
 *  substring test on normalized text, most-specific needle first. */
export function resolveCivic(text: string | null | undefined): CivicLocation | null {
  if (!text) return null;
  const t = norm(String(text));
  if (t.length < 6) return null;
  for (const { loc, n } of needles()) {
    if (t === n) return loc;
    const i = t.indexOf(n);
    if (i === -1) continue;
    const before = i === 0 ? ' ' : t[i - 1];
    const after = i + n.length >= t.length ? ' ' : t[i + n.length];
    if (before === ' ' && after === ' ') return loc;
  }
  return null;
}
