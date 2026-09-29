#!/usr/bin/env node
/**
 * verify-images.mjs — post-deploy image tripwire (canonical location).
 *
 * Lives here (frontend/scripts/) so the documented deploy runbook works as written:
 *   cd frontend && npx vercel --prod && node scripts/verify-images.mjs
 * (The repo-root scripts/verify-images.mjs is now a thin shim that re-runs this.)
 *
 * What it gates:
 *   1. STATIC /data files on www.amocartagena.co — partners, partner-events, venues,
 *      seasons AND experiences/featured (the Explore "Featured Experiences" row paints
 *      from that file first), plus the EVENTS-ELITE feed mirror /data/events-feed.json
 *      when it has been generated (scripts/gen-events-static.mjs). /data/events.json
 *      is no longer a file: vercel.json rewrites it to the backend's verified set
 *      (DESIGN.md §15 T5), so it is not required here any more.
 *   2. LIVE backend endpoints the app hydrates from — /api/partner-events,
 *      /api/experiences/featured and /api/events/feed (the feed the app reads
 *      backend-first). Every image field a card can consume is checked
 *      (image_url, flyer_url, partner_image), each as its own item, because the
 *      list endpoint once returned an image_url that 404'd (an 85 KB HTML page went
 *      through the phone's image queue per card) while flyer_url was fine.
 *   3. Weight. Every 200 is also measured (content-length). A featured card is
 *      ~280x200 pt and needs ~35 KB; the row was shipping 365 KB baseline JPEGs
 *      through a 4-slot iOS queue. Oversized files are reported as a WARN summary
 *      by default; `--strict-size` (or IMG_STRICT_SIZE=1) fails the run so the
 *      gate can be tightened once scripts/optimize-images lands.
 *
 * Prints "IMAGES OK: N/N 200" or lists every failure and exits non-zero. Empty
 * image fields are counted, not failed (SafeImage paints a bundled placeholder;
 * a feed event with image_url null gets its category placeholder).
 */

const LIVE = 'https://www.amocartagena.co';
const BACKEND = process.env.BACKEND_URL || 'https://backend-mu-one-74.vercel.app';
const CONCURRENCY = 24;
const MAX_KB = Number(process.env.IMG_MAX_KB || 150);
const STRICT_SIZE = process.argv.includes('--strict-size') || process.env.IMG_STRICT_SIZE === '1';
const IMAGE_FIELDS = ['image_url', 'flyer_url', 'partner_image'];

async function headOk(url) {
  try {
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (!res.ok && (res.status === 405 || res.status === 403)) {
      res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, redirect: 'follow' });
    }
    const type = res.headers.get('content-type') || '';
    const len = Number(res.headers.get('content-length') || 0);
    // A 200 that is text/html is a soft-404 page served with an image name — fail it.
    const ok = (res.ok || res.status === 206) && !type.startsWith('text/html');
    return { ok, status: type.startsWith('text/html') ? `${res.status} text/html` : res.status, bytes: len, type };
  } catch (e) {
    return { ok: false, status: `ERR ${e.message}`, bytes: 0, type: '' };
  }
}

function rowsOf(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const k = Object.keys(data)[0];
    if (k && Array.isArray(data[k])) return data[k];
  }
  return [];
}

// Every image field of every row becomes its own item, so a broken flyer_url is
// caught even when image_url on the same row is fine (and vice versa).
function itemsOf(rows, idField, nameField, source, fields = ['image_url', 'flyer_url']) {
  const out = [];
  for (const r of rows) {
    const id = r[idField] || r.id || '?';
    const name = r[nameField] || r.name || r.title || '?';
    const seen = new Set();
    for (const f of fields) {
      const url = r[f];
      if (typeof url !== 'string' || !url) continue;
      if (seen.has(url)) continue; // same url in two fields — check once
      seen.add(url);
      out.push({ id, name, url, field: f, source });
    }
    if (seen.size === 0) out.push({ id, name, url: '', field: fields[0], source });
  }
  return out;
}

async function collect(path, idField, nameField, fields) {
  let res;
  try { res = await fetch(`${LIVE}${path}`); } catch (e) { console.error(`WARN: GET ${path} -> ${e.message} (skipped)`); return []; }
  if (!res.ok) {
    // partners is required; the others are best-effort (warn, don't abort).
    if (path.includes('partners.json')) { console.error(`FATAL: GET ${path} -> ${res.status}`); process.exit(2); }
    console.error(`WARN: GET ${path} -> ${res.status} (skipped)`);
    return [];
  }
  return itemsOf(rowsOf(await res.json()), idField, nameField, path, fields);
}

// Live backend endpoints: best-effort (a backend blip must not block a frontend
// deploy), but when they answer, every image field is gated.
async function collectLive(path, idField, nameField) {
  let res;
  try { res = await fetch(`${BACKEND}${path}`, { headers: { Accept: 'application/json' } }); }
  catch (e) { console.error(`WARN: GET ${BACKEND}${path} -> ${e.message} (skipped)`); return []; }
  if (!res.ok) { console.error(`WARN: GET ${BACKEND}${path} -> ${res.status} (skipped)`); return []; }
  let data;
  try { data = await res.json(); } catch { console.error(`WARN: ${path} is not JSON (skipped)`); return []; }
  return itemsOf(rowsOf(data), idField, nameField, `api${path}`, IMAGE_FIELDS);
}

// EVENTS-ELITE feed ({generated_at, today, events: [...], date_tbc: [...]}): every row
// of both lists, keyed by event_id, named by title.es. image_url may be null (it is
// only ever a /images/... path in the public manifest, DESIGN §2): counted as empty.
// Best-effort like the other non-partner sources: a missing feed warns, never aborts.
async function collectFeed(url, source) {
  let res;
  try { res = await fetch(url, { headers: { Accept: 'application/json' } }); }
  catch (e) { console.error(`WARN: GET ${url} -> ${e.message} (skipped)`); return []; }
  if (!res.ok) { console.error(`WARN: GET ${url} -> ${res.status} (skipped)`); return []; }
  let data;
  try { data = await res.json(); } catch { console.error(`WARN: ${source} is not JSON (skipped)`); return []; }
  const rows = [
    ...(Array.isArray(data?.events) ? data.events : []),
    ...(Array.isArray(data?.date_tbc) ? data.date_tbc : []),
  ].filter((r) => r && typeof r === 'object').map((r) => ({
    event_id: r.event_id,
    name: (r.title && typeof r.title === 'object' ? r.title.es : r.title) || '?',
    image_url: r.image_url,
  }));
  return itemsOf(rows, 'event_id', 'name', source, ['image_url']);
}

const items = [
  ...(await collect('/data/partners.json', 'partner_id', 'name')),
  ...(await collectFeed(`${LIVE}/data/events-feed.json`, '/data/events-feed.json')),
  ...(await collectFeed(`${BACKEND}/api/events/feed`, 'api/api/events/feed')),
  ...(await collect('/data/partner-events.json', 'event_id', 'title', IMAGE_FIELDS)),
  ...(await collect('/data/experiences/featured.json', 'partner_id', 'name', IMAGE_FIELDS)),
  ...(await collect('/data/venues.json', 'venue_id', 'name')),
  ...(await collect('/data/seasons.json', 'season_id', 'name')),
  ...(await collectLive('/api/partner-events', 'event_id', 'title')),
  ...(await collectLive('/api/experiences/featured', 'event_id', 'title')),
];

const withUrl = items.filter((i) => i.url);
const empty = items.length - withUrl.length;
const external = withUrl.filter((i) => i.url.startsWith('http') && !i.url.includes('amocartagena.co')).length;
const failures = [];
const heavy = [];
let done = 0;

// De-dupe identical URLs across sources so one 365 KB file isn't fetched 5x.
const byUrl = new Map();
for (const it of withUrl) {
  const abs = it.url.startsWith('http') ? it.url : `${LIVE}${it.url}`;
  if (!byUrl.has(abs)) byUrl.set(abs, []);
  byUrl.get(abs).push(it);
}
const urls = [...byUrl.keys()];

for (let i = 0; i < urls.length; i += CONCURRENCY) {
  const batch = urls.slice(i, i + CONCURRENCY);
  await Promise.all(batch.map(async (abs) => {
    const { ok, status, bytes } = await headOk(abs);
    done++;
    const owners = byUrl.get(abs);
    if (!ok) for (const it of owners) failures.push({ ...it, status, abs });
    else if (bytes > MAX_KB * 1024) heavy.push({ abs, kb: Math.round(bytes / 1024), owners: owners.length, first: owners[0] });
  }));
  process.stdout.write(`\r  checking ${done}/${urls.length} unique urls (${withUrl.length} fields)…`);
}
process.stdout.write('\r');

heavy.sort((a, b) => b.kb - a.kb);
if (heavy.length > 0) {
  const total = heavy.reduce((s, h) => s + h.kb, 0);
  console.error(`${STRICT_SIZE ? 'SIZE FAILED' : 'WARN size'}: ${heavy.length} of ${urls.length} images > ${MAX_KB} KB (${Math.round(total / 1024)} MB over the line). Top 10:`);
  for (const h of heavy.slice(0, 10)) console.error(`  ${String(h.kb).padStart(5)} KB  ${h.first.id} ${h.first.name} -> ${h.abs} (${h.first.source}${h.owners > 1 ? `, x${h.owners}` : ''})`);
}

if (failures.length === 0 && !(STRICT_SIZE && heavy.length > 0)) {
  console.log(`IMAGES OK: ${urls.length}/${urls.length} 200 (${withUrl.length} fields; ${empty} empty→SafeImage bundled placeholder; ${external} external CDN — self-host before scale; ${heavy.length} over ${MAX_KB} KB)`);
  process.exit(0);
} else {
  if (failures.length > 0) {
    console.error(`IMAGES FAILED: ${failures.length} of ${withUrl.length} fields`);
    for (const f of failures) console.error(`  [${f.status}] ${f.id} ${f.name} .${f.field} -> ${f.abs} (${f.source})`);
  }
  process.exit(1);
}
