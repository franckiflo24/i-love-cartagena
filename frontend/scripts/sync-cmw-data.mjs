#!/usr/bin/env node
/**
 * sync-cmw-data.mjs: the Cartagena Music Week static mirror (docs/cmw/DESIGN.md §4).
 * Runs first in the web buildCommand; exit 1 means DO NOT DEPLOY.
 *
 * Source of truth: ../backend/data/cmw_program.json (what the official program
 * prints). This script validates it and writes public/data/cmw-program.json —
 * the offline fallback src/lib/cmw.ts reads when GET /api/cmw/program is
 * unreachable — with each event's catalog venue resolved from
 * public/data/partners.json the same way the backend does (cmw.py _venue_view):
 * {id, name, lat, lng, neighborhood}, coordinates only when they are real ones
 * inside the Distrito and not a placeholder centroid. Nothing else is added,
 * reordered or defaulted.
 *
 * Validation (every rule mirrors backend/cmw.py validate_program):
 *   - brand: name, a valid start/end window, L4 tagline/access_note/days_label/
 *     taglines/pillars/practical/concierge copy; the deck's contact number;
 *   - every event: id (cmw-…, unique), a date inside the window with a matching
 *     day_index, the printed title, category/status/booking_type/artist_status
 *     enums, lat/lng null (coordinates come from the catalog only), L4
 *     description/subtitle;
 *   - HONESTY: no value on a field listed in `tba` (time/end_time, price_info,
 *     venue_name/venue_id, boarding_point); while the artist is unannounced the
 *     only artist text is "Very Special Guest" and no description carries a
 *     clock time or an amount; every venue_id resolves in partners.json; every
 *     image path exists under public/.
 *   - src/components/cmw/guide.json (Experiencias / Las islas deck copy): L4
 *     complete, every venue_id in partners.json, every image on disk.
 *
 * Vercel builds upload only frontend/, so the backend file is absent there: the
 * script then validates the COMMITTED mirror with the same rules (venue objects
 * included) and writes nothing. Locally it regenerates the mirror; the file is
 * only rewritten when its content changed, so `generated_at` stays stable.
 *
 * Usage:
 *   node scripts/sync-cmw-data.mjs          # validate (+ write the mirror when the source exists)
 *   node scripts/sync-cmw-data.mjs --check  # validate only, never write
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// CMW_SOURCE overrides the source path (tests: point it at a missing file to exercise the Vercel mode).
const SOURCE = process.env.CMW_SOURCE ? path.resolve(process.env.CMW_SOURCE) : path.resolve(FRONTEND, '..', 'backend', 'data', 'cmw_program.json');
const PARTNERS = path.join(FRONTEND, 'public', 'data', 'partners.json');
const MIRROR = path.join(FRONTEND, 'public', 'data', 'cmw-program.json');
const GUIDE = path.join(FRONTEND, 'src', 'components', 'cmw', 'guide.json');
const PUBLIC = path.join(FRONTEND, 'public');

export const LANGS = ['es', 'en', 'fr', 'pt'];
export const CATEGORIES = new Set(['main_event', 'after', 'wellness', 'party', 'sunset', 'dining', 'island']);
export const EVENT_STATUSES = new Set(['confirmed', 'tba']);
export const ARTIST_STATUSES = new Set(['tba', 'confirmed', 'none']);
export const TBA_FIELDS = new Set(['time', 'price', 'venue', 'artist', 'boarding_point']);
export const TBA_VALUE_FIELDS = {
  time: ['time', 'end_time'],
  price: ['price_info'],
  venue: ['venue_name', 'venue_id'],
  boarding_point: ['boarding_point'],
};
export const PLACEHOLDER_ARTIST = 'Very Special Guest';
export const CONCIERGE_E164 = '+573116844492';

// Mirror of backend/events_gate.py: Distrito box, exclusion, placeholder centroids.
const DISTRITO_LAT = [10.10, 10.62];
const DISTRITO_LNG = [-75.82, -75.42];
const EXCLUSION_LAT_BELOW = 10.36;
const EXCLUSION_LNG_ABOVE = -75.47;
const PLACEHOLDER_COORDS = [
  [10.4236, -75.5483],
  [10.3932277, -75.4832311],
  [10.3910, -75.4794],
  [10.3997, -75.5144],
];
const PLACEHOLDER_TOL = 1e-3;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const EVENT_ID = /^cmw-[a-z0-9][a-z0-9-]{0,79}$/;
// Free-text leak scan (same intent as backend TIME_TEXT_RE / PRICE_TEXT_RE).
const TIME_TEXT = /(?<![\d:/.])(?:[01]?\d|2[0-3])\s?[:hH]\s?[0-5]\d(?!\d)|(?<![\d:/.])\d{1,2}(?::[0-5]\d)?\s?(?:a\.?\s?m\.?|p\.?\s?m\.?)(?![A-Za-z])/i;
const PRICE_TEXT = /[$€£]\s?\d|\b\d[\d.,]*\s?(?:cop|usd|eur|pesos?|d[oó]lares|dollars?|euros?|reais|mil pesos)\b/i;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isFinite_ = (v) => typeof v === 'number' && Number.isFinite(v);

export const l4Ok = (v) => isObj(v) && LANGS.every((k) => isStr(v[k]));

const parseYmd = (v) => {
  if (!isStr(v) || !YMD.test(v)) return null;
  const t = Date.parse(`${v}T12:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10) === v ? v : null;
};
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

const inDistrito = (lat, lng) => {
  if (!isFinite_(lat) || !isFinite_(lng)) return false;
  if (!(DISTRITO_LAT[0] <= lat && lat <= DISTRITO_LAT[1] && DISTRITO_LNG[0] <= lng && lng <= DISTRITO_LNG[1])) return false;
  return !(lat < EXCLUSION_LAT_BELOW && lng > EXCLUSION_LNG_ABOVE);
};
const isPlaceholder = (lat, lng) =>
  PLACEHOLDER_COORDS.some(([a, b]) => Math.abs(lat - a) <= PLACEHOLDER_TOL && Math.abs(lng - b) <= PLACEHOLDER_TOL);
const validGeo = (lat, lng) => isFinite_(lat) && isFinite_(lng) && !(lat === 0 && lng === 0) && inDistrito(lat, lng) && !isPlaceholder(lat, lng);

const rowCoords = (row) => {
  let lat = isFinite_(row.lat) ? row.lat : null;
  let lng = isFinite_(row.lng) ? row.lng : null;
  if (lat === null || lng === null) {
    const loc = row.location;
    if (isObj(loc)) {
      lat = isFinite_(loc.lat) ? loc.lat : isFinite_(loc.latitude) ? loc.latitude : null;
      lng = isFinite_(loc.lng) ? loc.lng : isFinite_(loc.longitude) ? loc.longitude : null;
    }
  }
  if (lat === null || lng === null) {
    const g = row.geo;
    if (isObj(g) && Array.isArray(g.coordinates) && g.coordinates.length === 2) {
      lng = isFinite_(g.coordinates[0]) ? g.coordinates[0] : null;
      lat = isFinite_(g.coordinates[1]) ? g.coordinates[1] : null;
    }
  }
  return [lat, lng];
};

/** {id, name, lat, lng, neighborhood} for a catalog partner row (backend _venue_view). */
export function venueView(row) {
  const [lat, lng] = rowCoords(row);
  const ok = validGeo(lat, lng);
  const hoodRaw = isStr(row.neighborhood) ? row.neighborhood : isStr(row.zone) ? row.zone : null;
  return {
    id: String(row.partner_id),
    name: String(row.name || '').trim(),
    lat: ok ? lat : null,
    lng: ok ? lng : null,
    neighborhood: hoodRaw ? hoodRaw.trim() : null,
  };
}

/** partner_id → row, for every catalog row with an id and a name. */
export function partnerIndex(rows) {
  const m = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (isObj(r) && isStr(r.partner_id) && isStr(r.name)) m.set(r.partner_id, r);
  }
  return m;
}

const imageExists = (p, publicDir) =>
  isStr(p) && p.startsWith('/images/') && !p.includes('..') && fs.existsSync(path.join(publicDir, p.replace(/^\//, '')));

function validateBrand(brand, problems) {
  if (!isObj(brand)) { problems.push('brand: missing'); return null; }
  if (!isStr(brand.name)) problems.push('brand.name: missing');
  const s = parseYmd(brand.start_date);
  const e = parseYmd(brand.end_date);
  if (!s || !e || s > e) problems.push('brand.start_date/end_date: not a valid range');
  for (const key of ['tagline', 'access_note']) if (!l4Ok(brand[key])) problems.push(`brand.${key}: L4 incomplete`);
  if ('days_label' in brand && !l4Ok(brand.days_label)) problems.push('brand.days_label: L4 incomplete');
  (brand.taglines || []).forEach((t, i) => { if (!l4Ok(t)) problems.push(`brand.taglines[${i}]: L4 incomplete`); });
  if (!Array.isArray(brand.pillars) || !brand.pillars.length) problems.push('brand.pillars: missing');
  (Array.isArray(brand.pillars) ? brand.pillars : []).forEach((p, i) => {
    if (!isObj(p) || !isStr(p.key) || !l4Ok(p.label)) problems.push(`brand.pillars[${i}]: key or L4 label incomplete`);
  });
  const con = brand.concierge;
  if (!isObj(con)) problems.push('brand.concierge: missing');
  else {
    if (con.whatsapp_e164 !== CONCIERGE_E164) problems.push("brand.concierge.whatsapp_e164: is not the deck's contact");
    for (const key of ['intro', 'assistant_note']) if (key in con && !l4Ok(con[key])) problems.push(`brand.concierge.${key}: L4 incomplete`);
    (con.services || []).forEach((sv, i) => { if (!l4Ok(sv)) problems.push(`brand.concierge.services[${i}]: L4 incomplete`); });
  }
  (brand.practical || []).forEach((pr, i) => {
    if (!isObj(pr) || !l4Ok(pr.title) || !l4Ok(pr.body)) { problems.push(`brand.practical[${i}]: L4 incomplete`); return; }
    const link = pr.link;
    if (link !== null && link !== undefined && !(isStr(link) && link.startsWith('/') && !link.startsWith('//'))) {
      problems.push(`brand.practical[${i}].link: must be an in-app path or null`);
    }
  });
  return s && e && s <= e ? [s, e] : null;
}

function validateEvent(ev, win, partners, publicDir, problems, seen) {
  if (!isObj(ev)) { problems.push('events[]: not an object'); return; }
  const eid = String(ev.id);
  const p = `events[${eid}]`;
  if (!isStr(ev.id) || !EVENT_ID.test(ev.id)) problems.push(`${p}.id: must match ${EVENT_ID}`);
  if (seen.has(eid)) problems.push(`${p}.id: duplicate`);
  seen.add(eid);
  const d = parseYmd(ev.date);
  if (!d) problems.push(`${p}.date: not YYYY-MM-DD`);
  else if (win) {
    if (!(win[0] <= d && d <= win[1])) problems.push(`${p}.date: outside the program window`);
    else if (ev.day_index !== daysBetween(win[0], d) + 1) problems.push(`${p}.day_index: does not match the date`);
  }
  if (!isStr(ev.title)) problems.push(`${p}.title: missing`);
  if (ev.subtitle !== null && ev.subtitle !== undefined && !l4Ok(ev.subtitle)) problems.push(`${p}.subtitle: L4 incomplete`);
  if (!l4Ok(ev.description)) problems.push(`${p}.description: L4 incomplete`);
  if (!CATEGORIES.has(ev.category)) problems.push(`${p}.category: unknown`);
  if (!EVENT_STATUSES.has(ev.status)) problems.push(`${p}.status: must be confirmed|tba`);
  if (ev.booking_type !== 'concierge') problems.push(`${p}.booking_type: must be concierge`);
  if (ev.lat !== null && ev.lat !== undefined && !ev.venue) problems.push(`${p}.lat/lng: coordinates come only from the catalog`);
  for (const key of ['venue_name', 'venue_id']) {
    const v = ev[key];
    if (v !== null && v !== undefined && !isStr(v)) problems.push(`${p}.${key}: must be a non-empty string or null`);
  }
  if (isStr(ev.venue_id) && !isStr(ev.venue_name)) problems.push(`${p}.venue_id: needs a venue_name`);
  for (const key of ['time', 'end_time']) {
    const v = ev[key];
    if (v !== null && v !== undefined && !(isStr(v) && HM.test(v))) problems.push(`${p}.${key}: must be HH:MM or null`);
  }
  if (isStr(ev.end_time) && !isStr(ev.time)) problems.push(`${p}.end_time: needs a start time`);
  const price = ev.price_info;
  if (price !== null && price !== undefined && !(isStr(price) || l4Ok(price))) problems.push(`${p}.price_info: must be text, L4 or null`);
  if (ev.image !== null && ev.image !== undefined) {
    if (!imageExists(ev.image, publicDir)) problems.push(`${p}.image: not a self-hosted /images/ file on disk (${ev.image})`);
  }

  // ── HONESTY: nothing to be confirmed carries a value ──
  let tba = ev.tba;
  if (!Array.isArray(tba) || tba.some((t) => !TBA_FIELDS.has(t)) || new Set(tba).size !== tba.length) {
    problems.push(`${p}.tba: must list distinct fields of ${[...TBA_FIELDS].join(', ')}`);
    tba = (Array.isArray(tba) ? tba : []).filter((t) => TBA_FIELDS.has(t));
  }
  for (const tag of tba) {
    for (const f of TBA_VALUE_FIELDS[tag] || []) {
      if (ev[f] !== null && ev[f] !== undefined && ev[f] !== '') problems.push(`${p}.${f}: has a value while '${tag}' is to be confirmed`);
    }
  }
  const aStatus = ev.artist_status;
  if (!ARTIST_STATUSES.has(aStatus)) problems.push(`${p}.artist_status: must be tba|confirmed|none`);
  if (ev.artist !== null && ev.artist !== undefined && !isStr(ev.artist)) problems.push(`${p}.artist: must be a non-empty string or null`);
  if (tba.includes('artist') && aStatus !== 'tba') problems.push(`${p}.artist_status: must be tba while 'artist' is to be confirmed`);
  if (aStatus === 'tba') {
    if (!tba.includes('artist')) problems.push(`${p}.tba: must list 'artist' while artist_status is tba`);
    if (ev.artist !== null && ev.artist !== undefined && ev.artist !== PLACEHOLDER_ARTIST) problems.push(`${p}.artist: only "${PLACEHOLDER_ARTIST}" is allowed while the artist is to be confirmed`);
  }
  if (aStatus === 'none' && isStr(ev.artist)) problems.push(`${p}.artist: must be null while artist_status is none`);
  if (aStatus === 'confirmed' && !isStr(ev.artist)) problems.push(`${p}.artist: missing while artist_status is confirmed`);
  const texts = [];
  for (const key of ['description', 'subtitle']) if (isObj(ev[key])) for (const k of LANGS) if (isStr(ev[key][k])) texts.push(ev[key][k]);
  if (tba.includes('time') && texts.some((t) => TIME_TEXT.test(t))) problems.push(`${p}: a clock time appears in the copy while 'time' is to be confirmed`);
  if (tba.includes('price') && texts.some((t) => PRICE_TEXT.test(t))) problems.push(`${p}: an amount appears in the copy while 'price' is to be confirmed`);

  // ── Catalog venue ──
  if (isStr(ev.venue_id)) {
    if (!partners.has(ev.venue_id)) problems.push(`${p}.venue_id: ${ev.venue_id} is not in public/data/partners.json`);
  }
  if ('venue' in ev && ev.venue !== null) {
    const v = ev.venue;
    if (!isObj(v) || !isStr(v.id) || v.id !== ev.venue_id || !isStr(v.name)) problems.push(`${p}.venue: must be the resolved catalog venue for venue_id`);
    else {
      const row = partners.get(v.id);
      if (row) {
        const want = venueView(row);
        if (JSON.stringify(want) !== JSON.stringify(v)) problems.push(`${p}.venue: differs from partners.json (${JSON.stringify(want)} vs ${JSON.stringify(v)})`);
        if ((ev.lat ?? null) !== want.lat || (ev.lng ?? null) !== want.lng) problems.push(`${p}.lat/lng: must equal the catalog venue coordinates`);
      }
    }
  }
}

/**
 * Pure validator: returns the list of problems (empty = valid).
 * @param {unknown} program parsed cmw_program.json (or the mirror)
 * @param {Map<string, object>} partners partnerIndex(partners.json)
 * @param {string} publicDir frontend/public
 */
export function validateProgram(program, partners, publicDir = PUBLIC) {
  const problems = [];
  if (!isObj(program)) return ['program: not an object'];
  if (!Number.isInteger(program.version) || program.version < 1) problems.push('version: must be a positive integer');
  if (!isStr(program.source_name)) problems.push('source_name: missing');
  const win = validateBrand(program.brand, problems);
  if (isObj(program.brand) && program.brand.hero_image !== null && program.brand.hero_image !== undefined && !imageExists(program.brand.hero_image, publicDir)) {
    problems.push(`brand.hero_image: not a self-hosted /images/ file on disk (${program.brand.hero_image})`);
  }
  if (!Array.isArray(program.events) || !program.events.length) problems.push('events: missing');
  const seen = new Set();
  for (const ev of Array.isArray(program.events) ? program.events : []) validateEvent(ev, win, partners, publicDir, problems, seen);
  return problems;
}

/** Deck copy for Experiencias / Las islas. */
export function validateGuide(guide, partners, publicDir = PUBLIC) {
  const problems = [];
  if (!isObj(guide)) return ['guide: not an object'];
  if (!isStr(guide.image_credit)) problems.push('guide.image_credit: missing');
  const ex = guide.experiences;
  if (!isObj(ex) || !l4Ok(ex.title) || !l4Ok(ex.subtitle) || !Array.isArray(ex.items) || !ex.items.length) problems.push('guide.experiences: incomplete');
  (isObj(ex) && Array.isArray(ex.items) ? ex.items : []).forEach((it, i) => {
    if (!isObj(it) || !isStr(it.key) || !l4Ok(it.title) || !l4Ok(it.tagline) || !l4Ok(it.body)) problems.push(`guide.experiences[${i}]: L4 incomplete`);
    if (isObj(it) && !imageExists(it.image, publicDir)) problems.push(`guide.experiences[${i}].image: missing on disk`);
  });
  const isl = guide.islands;
  if (!isObj(isl) || !l4Ok(isl.title) || !l4Ok(isl.subtitle) || !l4Ok(isl.intro) || !Array.isArray(isl.items) || !isl.items.length) problems.push('guide.islands: incomplete');
  if (isObj(isl) && !imageExists(isl.image, publicDir)) problems.push('guide.islands.image: missing on disk');
  (isObj(isl) && Array.isArray(isl.items) ? isl.items : []).forEach((it, i) => {
    if (!isObj(it) || !isStr(it.key) || !l4Ok(it.title) || !l4Ok(it.tagline)) problems.push(`guide.islands[${i}]: L4 incomplete`);
    if (isObj(it) && it.venue_id !== null && it.venue_id !== undefined) {
      if (!isStr(it.venue_id)) problems.push(`guide.islands[${i}].venue_id: must be a string or null`);
      else if (!partners.has(it.venue_id)) problems.push(`guide.islands[${i}].venue_id: ${it.venue_id} is not in public/data/partners.json`);
    }
  });
  return problems;
}

/** The mirror payload: the source program with `venue` (and lat/lng) resolved. Never mutates the input. */
export function buildMirror(program, partners, generatedAt) {
  const out = JSON.parse(JSON.stringify(program));
  out.events = out.events.map((ev) => {
    const row = isStr(ev.venue_id) ? partners.get(ev.venue_id) : null;
    const venue = row ? venueView(row) : null;
    return { ...ev, venue, lat: venue ? venue.lat : null, lng: venue ? venue.lng : null };
  });
  out.generated_at = generatedAt;
  return out;
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const stripStamp = (o) => { const c = { ...o }; delete c.generated_at; return JSON.stringify(c); };

function main() {
  const check = process.argv.includes('--check');
  let partners;
  try {
    partners = partnerIndex(readJson(PARTNERS));
  } catch (err) {
    console.error(`sync-cmw-data: cannot read ${path.relative(FRONTEND, PARTNERS)}: ${err.message}`);
    return 1;
  }
  if (!partners.size) { console.error('sync-cmw-data: partners.json is empty'); return 1; }

  let guideProblems = [];
  try {
    guideProblems = validateGuide(readJson(GUIDE), partners);
  } catch (err) {
    guideProblems = [`guide: cannot read ${path.relative(FRONTEND, GUIDE)}: ${err.message}`];
  }

  const haveSource = fs.existsSync(SOURCE);
  let program;
  let mirrorProblems = [];
  if (haveSource) {
    try {
      program = readJson(SOURCE);
    } catch (err) {
      console.error(`sync-cmw-data: cannot parse ${SOURCE}: ${err.message}`);
      return 1;
    }
  } else {
    // Vercel build: only frontend/ is uploaded. Validate the committed mirror.
    if (!fs.existsSync(MIRROR)) {
      console.error(`sync-cmw-data: neither the source (${SOURCE}) nor the mirror (${MIRROR}) exists`);
      return 1;
    }
    try {
      program = readJson(MIRROR);
    } catch (err) {
      console.error(`sync-cmw-data: cannot parse ${MIRROR}: ${err.message}`);
      return 1;
    }
    if (!isStr(program.generated_at)) mirrorProblems.push('mirror.generated_at: missing');
    if (Array.isArray(program.events)) {
      program.events.forEach((ev, i) => { if (isObj(ev) && !('venue' in ev)) mirrorProblems.push(`mirror.events[${i}].venue: not resolved`); });
    }
  }

  const problems = [...validateProgram(program, partners), ...mirrorProblems, ...guideProblems];
  if (problems.length) {
    console.error(`sync-cmw-data: ${problems.length} problem(s) in ${haveSource ? 'backend/data/cmw_program.json' : 'public/data/cmw-program.json'} — NOT writing the mirror:`);
    for (const p of problems) console.error(`  - ${p}`);
    return 1;
  }

  const n = program.events.length;
  if (!haveSource) {
    console.log(`sync-cmw-data: mirror OK (${n} events, generated_at ${program.generated_at}; source absent, nothing written)`);
    return 0;
  }
  if (check) {
    console.log(`sync-cmw-data: source OK (${n} events); --check, nothing written`);
    return 0;
  }

  const next = buildMirror(program, partners, new Date().toISOString());
  const mirrorErrors = validateProgram(next, partners);
  if (mirrorErrors.length) {
    console.error('sync-cmw-data: the resolved mirror fails validation:');
    for (const p of mirrorErrors) console.error(`  - ${p}`);
    return 1;
  }
  let previous = null;
  try { previous = fs.existsSync(MIRROR) ? readJson(MIRROR) : null; } catch { previous = null; }
  if (previous && stripStamp(previous) === stripStamp(next)) {
    console.log(`sync-cmw-data: mirror unchanged (${n} events, generated_at ${previous.generated_at})`);
    return 0;
  }
  fs.mkdirSync(path.dirname(MIRROR), { recursive: true });
  fs.writeFileSync(MIRROR, `${JSON.stringify(next, null, 1)}\n`);
  const resolved = next.events.filter((e) => e.venue).length;
  console.log(`sync-cmw-data: wrote ${path.relative(FRONTEND, MIRROR)} (${n} events, ${resolved} catalog venues resolved)`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
