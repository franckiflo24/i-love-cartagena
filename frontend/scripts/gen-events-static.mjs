#!/usr/bin/env node
/**
 * gen-events-static.mjs: EVENTS-ELITE static feed mirror (docs/events-elite/DESIGN.md
 * §15 T5, §13 J9). Run it before every web deploy; exit 1 means DO NOT DEPLOY.
 *
 * Writes ONLY public/data/events-feed.json, the offline fallback that
 * src/lib/eventsFeed.ts reads when the live GET /api/events/feed is unreachable
 * (and only while its generated_at is ≤ 36 h old). It is the byte-for-byte
 * payload of
 *   https://backend-mu-one-74.vercel.app/api/events/feed?_gen=<epoch ms>
 * (the _gen query busts every CDN layer), and it is written only when ALL of
 * these hold:
 *   - HTTP 200 with a JSON object body;
 *   - generated_at parses and is < 10 min old (≤ 2 min clock skew into the future);
 *   - `events` is an array, and `date_tbc` is an array when present;
 *   - every row's event_id starts with `ce-` and is lowercase [a-z0-9-], ≤ 80 chars
 *     (DESIGN §2; legacy evt_/pe_/slug ids can never pass), with no duplicates;
 *   - every row has an http(s) source_url;
 *   - every row's status is `published` or `date_tbc` (the only feed statuses, §8).
 *
 * Honesty rules:
 *   - It never keeps an old file on failure. The previous events-feed.json is deleted
 *     BEFORE the fetch, so a failed run leaves no feed file rather than a stale one.
 *     The client then shows its honest "No pudimos cargar la agenda" state.
 *   - It deletes the legacy statics if they reappear (public/data/events.json,
 *     events/, concerts.json, concerts/), because Vercel serves files before the
 *     vercel.json rewrites to the backend. It re-scrubs calendar.json and
 *     seasons.json to [] (§15 T5). It does this on every run, even a failing one.
 *   - It never edits the payload: no filtering, no reordering, no defaults.
 *
 * Usage:
 *   node scripts/gen-events-static.mjs          # fetch, validate, clean up, write
 *   node scripts/gen-events-static.mjs --check  # fetch + validate only: no deletes, no writes
 * BACKEND_URL overrides the backend origin (same env var as verify-images.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROD_BACKEND = 'https://backend-mu-one-74.vercel.app';
const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(FRONTEND, 'public', 'data');
const FEED_FILE = path.join(DATA, 'events-feed.json');
/** Legacy statics that must never exist (they would shadow the vercel.json rewrites). */
const LEGACY_PATHS = ['events.json', 'events', 'concerts.json', 'concerts'];
/** Legacy statics that stay as files but must hold []. */
const SCRUB_TO_EMPTY = ['calendar.json', 'seasons.json'];

export const MAX_AGE_MS = 10 * 60 * 1000;
export const MAX_FUTURE_SKEW_MS = 2 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20000;
const MAX_BODY_CHARS = 8 * 1024 * 1024;
const ID_RE = /^ce-[a-z0-9-]+$/;
const FEED_STATUSES = new Set(['published', 'date_tbc']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function httpUrl(v) {
  if (typeof v !== 'string' || !v.trim()) return false;
  try {
    const u = new URL(v);
    return (u.protocol === 'http:' || u.protocol === 'https:') && Boolean(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Pure validator. Returns { ok, errors: string[], stats }. Never throws.
 * @param {unknown} payload parsed JSON body of GET /api/events/feed
 * @param {number} nowMs    current time (epoch ms)
 */
export function validateFeed(payload, nowMs) {
  const errors = [];
  const stats = { events: 0, date_tbc: 0, high: 0, verify: 0, age_s: null };
  if (!isObj(payload)) return { ok: false, errors: ['body is not a JSON object'], stats };

  const genRaw = payload.generated_at;
  const genMs = typeof genRaw === 'string' ? Date.parse(genRaw) : Number.NaN;
  if (!Number.isFinite(genMs)) {
    errors.push(`generated_at missing or unparseable (${JSON.stringify(genRaw)})`);
  } else {
    const age = nowMs - genMs;
    stats.age_s = Math.round(age / 1000);
    if (age >= MAX_AGE_MS) errors.push(`generated_at ${genRaw} is ${Math.round(age / 60000)} min old (limit < 10 min): a cached or stale feed`);
    if (age < -MAX_FUTURE_SKEW_MS) errors.push(`generated_at ${genRaw} is ${Math.round(-age / 1000)} s in the future (clock skew > 2 min)`);
  }

  if (!Array.isArray(payload.events)) errors.push('`events` is not an array');
  if ('date_tbc' in payload && !Array.isArray(payload.date_tbc)) errors.push('`date_tbc` is present but not an array');
  const groups = [
    ['events', Array.isArray(payload.events) ? payload.events : []],
    ['date_tbc', Array.isArray(payload.date_tbc) ? payload.date_tbc : []],
  ];

  const seen = new Set();
  for (const [name, rows] of groups) {
    stats[name] = rows.length;
    rows.forEach((row, i) => {
      const at = `${name}[${i}]`;
      if (!isObj(row)) { errors.push(`${at}: not an object`); return; }
      const id = row.event_id;
      if (typeof id !== 'string' || !id.startsWith('ce-')) {
        errors.push(`${at}: event_id ${JSON.stringify(id)} does not start with "ce-" (legacy or malformed id)`);
      } else if (!ID_RE.test(id) || id.length > 80) {
        errors.push(`${at}: event_id "${id}" is not lowercase [a-z0-9-] ≤ 80 chars (DESIGN §2)`);
      } else if (seen.has(id)) {
        errors.push(`${at}: duplicate event_id "${id}"`);
      } else {
        seen.add(id);
      }
      const ref = typeof id === 'string' ? ` (${id})` : '';
      if (!httpUrl(row.source_url)) errors.push(`${at}${ref}: source_url missing or not http(s) (${JSON.stringify(row.source_url ?? null)})`);
      if (!FEED_STATUSES.has(row.status)) errors.push(`${at}${ref}: status ${JSON.stringify(row.status ?? null)} is not published/date_tbc`);
      if (row.confidence === 'HIGH') stats.high++;
      else if (row.confidence === 'VERIFY') stats.verify++;
    });
  }
  return { ok: errors.length === 0, errors, stats };
}

/** GET the live feed. Returns { ok, status, payload?, error? }. Never throws. */
export async function fetchFeed(backend, nowMs) {
  const url = `${backend.replace(/\/+$/, '')}/api/events/feed?_gen=${nowMs}`;
  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache', 'User-Agent': 'AMO-gen-events-static/1.0' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
  } catch (e) {
    const kind = e instanceof Error ? e.name : 'Error';
    const cause = e instanceof Error && isObj(e.cause) && typeof e.cause.code === 'string' ? ` ${e.cause.code}` : '';
    return { ok: false, status: 0, url, error: `request failed (${kind}${cause})` };
  }
  if (res.status !== 200) return { ok: false, status: res.status, url, error: `HTTP ${res.status} (need 200)` };
  let text;
  try {
    text = await res.text();
  } catch (e) {
    return { ok: false, status: res.status, url, error: `body read failed (${e instanceof Error ? e.name : 'Error'})` };
  }
  if (text.length > MAX_BODY_CHARS) return { ok: false, status: res.status, url, error: `body is ${text.length} chars (cap ${MAX_BODY_CHARS})` };
  try {
    return { ok: true, status: res.status, url, payload: JSON.parse(text) };
  } catch {
    return { ok: false, status: res.status, url, error: `body is not JSON (content-type ${res.headers.get('content-type') || 'none'})` };
  }
}

/** Legacy paths present now (relative to public/data). */
function legacyPresent() {
  const out = LEGACY_PATHS.filter((p) => fs.existsSync(path.join(DATA, p)));
  for (const f of SCRUB_TO_EMPTY) {
    const abs = path.join(DATA, f);
    if (!fs.existsSync(abs)) continue;
    let empty = false;
    try {
      const v = JSON.parse(fs.readFileSync(abs, 'utf8'));
      empty = Array.isArray(v) && v.length === 0;
    } catch {
      empty = false;
    }
    if (!empty) out.push(`${f} (not [])`);
  }
  return out;
}

function removeLegacy() {
  for (const p of LEGACY_PATHS) {
    const abs = path.join(DATA, p);
    if (!fs.existsSync(abs)) continue;
    fs.rmSync(abs, { recursive: true, force: true });
    console.error(`removed legacy static public/data/${p}`);
  }
  for (const f of SCRUB_TO_EMPTY) {
    const abs = path.join(DATA, f);
    let current = null;
    try { current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null; } catch { current = null; }
    if (current !== null && current.trim() === '[]') continue;
    fs.writeFileSync(abs, '[]\n');
    console.error(`scrubbed public/data/${f} to []`);
  }
}

async function main() {
  const check = process.argv.includes('--check');
  const backend = process.env.BACKEND_URL || PROD_BACKEND;
  if (backend !== PROD_BACKEND) console.error(`NOTE: BACKEND_URL=${backend} (not production)`);

  if (check) {
    const stale = legacyPresent();
    if (stale.length) console.error(`--check: would remove/scrub: ${stale.map((s) => `public/data/${s}`).join(', ')}`);
  } else {
    try {
      removeLegacy();
      // Never keep an old feed on failure: drop it before fetching.
      fs.rmSync(FEED_FILE, { force: true });
    } catch (e) {
      console.error(`FAILED: could not clean public/data (${e instanceof Error ? e.message : 'fs error'})`);
      process.exit(1);
    }
  }

  const nowMs = Date.now();
  const got = await fetchFeed(backend, nowMs);
  if (!got.ok) {
    console.error(`FAILED: GET ${got.url} -> ${got.error}. ${check ? 'Nothing was changed.' : 'No events-feed.json written.'} Do not deploy.`);
    process.exit(1);
  }
  const v = validateFeed(got.payload, Date.now());
  if (!v.ok) {
    console.error(`FAILED: the feed did not pass ${v.errors.length} check(s). ${check ? 'Nothing was changed.' : 'No events-feed.json written.'} Do not deploy.`);
    for (const e of v.errors.slice(0, 40)) console.error(`  - ${e}`);
    if (v.errors.length > 40) console.error(`  … ${v.errors.length - 40} more`);
    process.exit(1);
  }

  const s = v.stats;
  const summary = `${s.events} events + ${s.date_tbc} date_tbc (HIGH ${s.high} · VERIFY ${s.verify}), generated_at ${got.payload.generated_at} (${s.age_s}s old)`;
  if (check) {
    console.log(`FEED OK (--check, nothing written): ${summary}`);
    return;
  }
  const tmp = `${FEED_FILE}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(got.payload)}\n`);
    fs.renameSync(tmp, FEED_FILE);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(FEED_FILE, { force: true });
    console.error(`FAILED: could not write public/data/events-feed.json (${e instanceof Error ? e.message : 'fs error'}). Do not deploy.`);
    process.exit(1);
  }
  console.log(`WROTE public/data/events-feed.json: ${summary}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(`FAILED: unexpected error (${e instanceof Error ? e.name : 'Error'}). Do not deploy.`);
    process.exit(1);
  });
}
