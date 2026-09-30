#!/usr/bin/env node
/**
 * sync-lenses-data.mjs: the LENSES static mirror (docs/lenses/DESIGN.md §3/§4).
 * Runs in the web buildCommand next to sync-cmw-data.mjs; exit 1 = DO NOT DEPLOY.
 *
 * Source of truth: ../backend/data/lenses.json. This script:
 *   1. VALIDATES it (the same rules as backend/lenses.py validate_lenses, plus
 *      catalog existence): every pin/tag carries source_url + source_name +
 *      last_verified + confidence HIGH|VERIFY (V1: zero tags without a source);
 *      access_tier on every pin (F3); best_light ⊆ {sunrise,midday,sunset}; L4
 *      es/en/fr/pt completeness; the F5 corrections (no Café del Mar / Interno /
 *      HOLD names; Candé + Baluarte de la Gente present); itinerary + hotspot
 *      refs resolve; venue_ids exist in public/data/partners.json.
 *   2. GATES: computes fill per lens; a lens below min_fill ships as
 *      {coming_soon:true} with NO pins/venues in the mirror — the public mirror
 *      never leaks gated content (§2).
 *   3. RESOLVES venue-backed pins from the catalog (coords + the venue's own
 *      already-shipping image + /partner/<id> link) — coordinates are never
 *      hand-copied into lens data.
 *   4. EMBEDS sunset_by_month (HH:MM) from backend/data/seasonal_stamps.json —
 *      the walking-engine owner of sunset times — so the Golden Hour toggle can
 *      state real monthly hours offline.
 *   5. WRITES public/data/lenses.json (web static fallback for api.get('/lenses'))
 *      and src/data/lensesBundle.json (byte-identical; bundled into the native
 *      binary the way music-week/guide.json is, so Port Day works in airplane
 *      mode). Strips every `luna` block — triggers/decline lines are server-side
 *      editorial, exactly like the city hub.
 *
 * Vercel builds upload only frontend/, so the backend source is absent there:
 * the script then validates the COMMITTED mirror + bundle (equality included)
 * and writes nothing. Files are only rewritten when content changed.
 *
 * Usage:
 *   node scripts/sync-lenses-data.mjs          # validate (+ write when the source exists)
 *   node scripts/sync-lenses-data.mjs --check  # validate only, never write
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = process.env.LENSES_SOURCE
  ? path.resolve(process.env.LENSES_SOURCE)
  : path.resolve(FRONTEND, '..', 'backend', 'data', 'lenses.json');
const SEASONAL = path.resolve(FRONTEND, '..', 'backend', 'data', 'seasonal_stamps.json');
const CITY = path.resolve(FRONTEND, '..', 'backend', 'data', 'city_modules.json');
const PARTNERS = path.join(FRONTEND, 'public', 'data', 'partners.json');
const MIRROR = path.join(FRONTEND, 'public', 'data', 'lenses.json');
const BUNDLE = path.join(FRONTEND, 'src', 'data', 'lensesBundle.json');

const LANGS = ['es', 'en', 'fr', 'pt'];
const KINDS = new Set(['places', 'venues', 'kit']);
const LIGHT = new Set(['sunrise', 'midday', 'sunset']);
const PIN_ID = /^gh-[a-z0-9][a-z0-9-]{0,79}$/;
const BANNED = ['café del mar', 'cafe del mar', 'interno', 'mvngata', 'mangata', 'gozne',
  'btexia', 'eléctrica', 'electrica', 'moni', 'pergamino', 'café sofía', 'cafe sofia', 'coralina'];
const REQUIRED_NAMES = ['candé', 'baluarte de la gente'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const l4Ok = (v) => isObj(v) && LANGS.every((k) => isStr(v[k]));
const prov = (r, id, errs) => {
  for (const f of ['source_url', 'source_name', 'last_verified']) if (!isStr(r[f])) errs.push(`${id}: missing ${f}`);
  if (!['HIGH', 'VERIFY'].includes(r.confidence)) errs.push(`${id}: confidence must be HIGH|VERIFY`);
};

function validate(data, catalogIds) {
  const errs = [];
  if (!isObj(data)) return ['root must be an object'];
  const lenses = data.lenses;
  if (!Array.isArray(lenses) || !lenses.length) return ['lenses[] missing'];
  const keys = new Set();
  for (const ln of lenses) {
    const k = ln.key;
    if (!isStr(k) || keys.has(k)) { errs.push(`lens key invalid/duplicate: ${k}`); continue; }
    keys.add(k);
    if (!KINDS.has(ln.kind)) errs.push(`${k}: bad kind`);
    if (!Number.isInteger(ln.min_fill) || ln.min_fill < 1) errs.push(`${k}: min_fill`);
    for (const f of ['label', 'tagline']) if (!l4Ok(ln[f])) errs.push(`${k}: ${f} not L4`);
  }
  if (!isObj(data.access_tiers) || !Object.values(data.access_tiers).every(l4Ok)) errs.push('access_tiers not L4');
  const pins = data.pins || [];
  const pinIds = new Set();
  const names = [];
  for (const p of pins) {
    const id = p.id || '?';
    if (!PIN_ID.test(id) || pinIds.has(id)) errs.push(`pin id invalid/duplicate: ${id}`);
    pinIds.add(id);
    if (!keys.has(p.lens)) errs.push(`${id}: unknown lens`);
    if (!isStr(p.name)) errs.push(`${id}: name`); else names.push(p.name.toLowerCase());
    if (p.venue_id != null) {
      if (!catalogIds.has(p.venue_id)) errs.push(`${id}: venue_id not in catalog: ${p.venue_id}`);
      if ('lat' in p || 'lng' in p) errs.push(`${id}: coords come from the catalog only`);
    } else {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) errs.push(`${id}: no venue and no coords`);
      if (!['exact', 'approx'].includes(p.geo_precision)) errs.push(`${id}: geo_precision`);
    }
    if (!Array.isArray(p.best_light) || !p.best_light.length || !p.best_light.every((b) => LIGHT.has(b)))
      errs.push(`${id}: best_light`);
    if (!(p.access_tier in (data.access_tiers || {}))) errs.push(`${id}: access_tier (F3)`);
    if (!l4Ok(p.photogenic)) errs.push(`${id}: photogenic not L4`);
    if (p.etiquette != null && !l4Ok(p.etiquette)) errs.push(`${id}: etiquette not L4`);
    prov(p, id, errs);
  }
  for (const b of BANNED) if (names.some((n) => n === b || n.startsWith(b + ' '))) errs.push(`BANNED pin name (F5): ${b}`);
  for (const r of REQUIRED_NAMES) if (!names.some((n) => n.includes(r))) errs.push(`required pin missing (F5): ${r}`);
  for (const t of data.venue_tags || []) {
    const id = `tag ${t.lens}/${t.venue_id}`;
    if (!keys.has(t.lens)) errs.push(`${id}: unknown lens`);
    if (!catalogIds.has(t.venue_id)) errs.push(`${id}: venue_id not in catalog`);
    if (!isObj(t.attrs) || !Object.keys(t.attrs).length) errs.push(`${id}: attrs`);
    if (t.note != null && !l4Ok(t.note)) errs.push(`${id}: note not L4`);
    prov(t, id, errs);
  }
  const pd = data.port_day;
  if (!isObj(pd)) errs.push('port_day missing');
  else {
    if (!isStr(pd.fare_module)) errs.push('port_day.fare_module');
    for (const hp of pd.crowd?.hotspot_pins || []) if (!pinIds.has(hp)) errs.push(`hotspot unknown pin: ${hp}`);
    if (!l4Ok(pd.crowd?.note)) errs.push('port_day.crowd.note not L4');
    if (!Array.isArray(pd.itineraries) || !pd.itineraries.length) errs.push('port_day.itineraries empty');
    for (const it of pd.itineraries || []) {
      if (it.editorial !== true) errs.push(`${it.id}: editorial:true required`);
      for (const f of ['title', 'note']) if (!l4Ok(it[f])) errs.push(`${it.id}: ${f} not L4`);
      for (const s of it.stops || []) {
        if (!pinIds.has(s.pin)) errs.push(`${it.id}: unknown stop pin ${s.pin}`);
        if (!Number.isInteger(s.minutes) || s.minutes <= 0) errs.push(`${it.id}: stop minutes`);
      }
    }
  }
  return errs;
}

function fillCounts(data, fares) {
  const out = {};
  for (const ln of data.lenses) {
    let high = 0, total = 0;
    if (ln.kind === 'places') {
      const mine = (data.pins || []).filter((p) => p.lens === ln.key);
      total = mine.length;
      high = mine.filter((p) => p.confidence === 'HIGH').length;
    } else if (ln.kind === 'venues') {
      const mine = (data.venue_tags || []).filter((t) => t.lens === ln.key);
      total = new Set(mine.map((t) => t.venue_id)).size;
      high = new Set(mine.filter((t) => t.confidence === 'HIGH').map((t) => t.venue_id)).size;
    } else {
      const ok = fares.length > 0 && (data.port_day?.itineraries || []).length > 0;
      high = total = ok ? 1 : 0;
    }
    out[ln.key] = { high, total, min_fill: ln.min_fill, live: high >= ln.min_fill };
  }
  return out;
}

function buildMirror(data, partners, sunset, fares) {
  const byId = new Map(partners.map((p) => [p.partner_id, p]));
  const fills = fillCounts(data, fares);
  const pubDef = (ln) => {
    const f = fills[ln.key];
    return {
      key: ln.key, kind: ln.kind, icon: ln.icon, label: ln.label, tagline: ln.tagline,
      live: f.live, fill: { high: f.high, total: f.total, min_fill: f.min_fill },
    };
  };
  const resolvePin = (p) => {
    const base = {
      id: p.id, lens: p.lens, name: p.name, venue_id: p.venue_id ?? null, zone: p.zone ?? null,
      best_light: p.best_light, access_tier: p.access_tier, crowd_hotspot: !!p.crowd_hotspot,
      photogenic: p.photogenic, etiquette: p.etiquette ?? null, link: p.link ?? null,
      source_url: p.source_url, source_name: p.source_name,
      last_verified: p.last_verified, confidence: p.confidence,
      geo_precision: p.geo_precision ?? 'exact',
    };
    if (p.venue_id) {
      const v = byId.get(p.venue_id);
      const loc = v?.location || {};
      if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return null; // never guess
      return { ...base, lat: loc.lat, lng: loc.lng, image_url: v.image_url ?? null,
               venue_name: v.name ?? null, link: base.link || `/partner/${p.venue_id}`, geo_precision: 'exact' };
    }
    return { ...base, lat: p.lat, lng: p.lng, image_url: null, venue_name: null };
  };
  const liveOf = (k) => fills[k].live;
  const pins = (data.pins || [])
    .filter((p) => liveOf(p.lens))                 // the mirror never leaks gated content
    .map(resolvePin).filter(Boolean);
  const pinById = new Map(pins.map((p) => [p.id, p]));
  const pd = data.port_day;
  const portDay = !liveOf('port_day') ? null : {
    fares, fare_link: `/ciudad/${pd.fare_module}`, muelle_link: `/ciudad/${pd.muelle_module}`,
    return_buffer_min: pd.return_buffer_min, crowd_note: pd.crowd?.note ?? null,
    hotspot_pins: pd.crowd?.hotspot_pins || [],
    itineraries: pd.itineraries.map((it) => ({
      id: it.id, duration_h: it.duration_h, editorial: true, title: it.title, note: it.note,
      stops: it.stops.map((s) => {
        const rp = pinById.get(s.pin);
        return rp ? { pin: s.pin, minutes: s.minutes, name: rp.name, lat: rp.lat, lng: rp.lng,
                      access_tier: rp.access_tier } : null;
      }).filter(Boolean),
    })),
  };
  return {
    version: data.version, updated: data.updated, generated_at: new Date().toISOString(),
    lenses: data.lenses.map(pubDef),
    access_tiers: data.access_tiers,
    sunset_by_month: sunset,
    pins,
    port_day: portDay,
  };
}

function stableEq(aPath, obj) {
  try {
    const cur = JSON.parse(fs.readFileSync(aPath, 'utf8'));
    const a = { ...cur, generated_at: null };
    const b = { ...obj, generated_at: null };
    return JSON.stringify(a) === JSON.stringify(b);
  } catch { return false; }
}

function main() {
  const check = process.argv.includes('--check');
  const partners = JSON.parse(fs.readFileSync(PARTNERS, 'utf8'));
  const catalogIds = new Set(partners.map((p) => p.partner_id));

  if (!fs.existsSync(SOURCE)) {
    // Vercel mode: validate the committed mirror + bundle instead.
    if (!fs.existsSync(MIRROR) || !fs.existsSync(BUNDLE)) {
      console.error('sync-lenses-data: source absent and mirror/bundle missing'); process.exit(1);
    }
    const mirror = JSON.parse(fs.readFileSync(MIRROR, 'utf8'));
    const bundle = fs.readFileSync(BUNDLE, 'utf8');
    if (fs.readFileSync(MIRROR, 'utf8') !== bundle) {
      console.error('sync-lenses-data: mirror and native bundle differ'); process.exit(1);
    }
    const bad = [];
    for (const p of mirror.pins || []) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) bad.push(`${p.id}: coords`);
      if (!(p.access_tier in (mirror.access_tiers || {}))) bad.push(`${p.id}: access_tier`);
      prov(p, p.id, bad);
      if (!l4Ok(p.photogenic)) bad.push(`${p.id}: photogenic L4`);
    }
    for (const ln of mirror.lenses || []) if ('luna' in ln) bad.push(`${ln.key}: luna must not ship`);
    const names = (mirror.pins || []).map((p) => p.name.toLowerCase());
    for (const b of BANNED) if (names.some((n) => n === b || n.startsWith(b + ' '))) bad.push(`BANNED (F5): ${b}`);
    if (bad.length) { console.error('sync-lenses-data (mirror):\n  ' + bad.join('\n  ')); process.exit(1); }
    console.log(`sync-lenses-data: committed mirror valid (${(mirror.pins || []).length} pins)`);
    return;
  }

  const data = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const errs = validate(data, catalogIds);
  if (errs.length) { console.error('sync-lenses-data:\n  ' + errs.join('\n  ')); process.exit(1); }

  const seasonal = JSON.parse(fs.readFileSync(SEASONAL, 'utf8'));
  const sunset = Object.fromEntries(Object.entries(seasonal.sunset_minutes_by_month || {})
    .map(([m, mins]) => [m, `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`]));
  if (Object.keys(sunset).length !== 12) { console.error('sync-lenses-data: sunset table incomplete'); process.exit(1); }

  const city = JSON.parse(fs.readFileSync(CITY, 'utf8'));
  const fareModule = (city.modules || []).find((m) => m.id === data.port_day.fare_module);
  if (!fareModule) { console.error(`sync-lenses-data: fare module ${data.port_day.fare_module} missing`); process.exit(1); }
  const fares = (fareModule.facts || []).map((f) => ({
    key: f.key, label: f.label, value_cop: f.value_cop, value_text: f.value_text,
    confidence: f.confidence, source_name: f.source_name, source_url: f.source_url,
    last_verified: f.last_verified, note: f.note,
  }));

  const mirror = buildMirror(data, partners, sunset, fares);
  const gh = mirror.pins.filter((p) => p.lens === 'golden_hour');
  console.log(`sync-lenses-data: ${mirror.pins.length} public pins (golden_hour ${gh.length}), ` +
    mirror.lenses.map((l) => `${l.key}=${l.live ? 'LIVE' : 'gated'}`).join(' '));

  if (check) { console.log('sync-lenses-data: source OK (check mode, nothing written)'); return; }
  const out = JSON.stringify(mirror, null, 1) + '\n';
  if (stableEq(MIRROR, mirror) && fs.existsSync(BUNDLE) && fs.readFileSync(BUNDLE, 'utf8') === fs.readFileSync(MIRROR, 'utf8')) {
    console.log('sync-lenses-data: mirror unchanged');
    return;
  }
  fs.mkdirSync(path.dirname(BUNDLE), { recursive: true });
  fs.writeFileSync(MIRROR, out);
  fs.writeFileSync(BUNDLE, out);
  console.log(`sync-lenses-data: wrote ${path.relative(FRONTEND, MIRROR)} + ${path.relative(FRONTEND, BUNDLE)}`);
}

main();
