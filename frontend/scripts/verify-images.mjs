#!/usr/bin/env node
/**
 * verify-images.mjs — post-deploy image tripwire (canonical location).
 *
 * Lives here (frontend/scripts/) so the documented deploy runbook works as written:
 *   cd frontend && npx vercel --prod && node scripts/verify-images.mjs
 * (The repo-root scripts/verify-images.mjs is now a thin shim that re-runs this.)
 *
 * Fetches the LIVE data files from www.amocartagena.co and HEAD-requests every
 * image_url. Coverage widened beyond partners+events to partner-events, venues and
 * seasons (a prior version checked only 2 files, so ~83 hotlinked images across the
 * other files were invisible to the gate). Prints "IMAGES OK: N/N 200" or lists
 * every failure and exits non-zero. Empty image_urls are counted, not failed
 * (SafeImage renders a category fallback for them by design).
 */

const LIVE = 'https://www.amocartagena.co';
const CONCURRENCY = 24;

async function headOk(url) {
  try {
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (!res.ok && (res.status === 405 || res.status === 403)) {
      res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, redirect: 'follow' });
    }
    return { ok: res.ok || res.status === 206, status: res.status };
  } catch (e) {
    return { ok: false, status: `ERR ${e.message}` };
  }
}

async function collect(path, idField, nameField) {
  let res;
  try { res = await fetch(`${LIVE}${path}`); } catch (e) { console.error(`WARN: GET ${path} -> ${e.message} (skipped)`); return []; }
  if (!res.ok) {
    // partners/events are required; the others are best-effort (warn, don't abort).
    if (path.includes('partners.json') || path === '/data/events.json') { console.error(`FATAL: GET ${path} -> ${res.status}`); process.exit(2); }
    console.error(`WARN: GET ${path} -> ${res.status} (skipped)`);
    return [];
  }
  const data = await res.json();
  const rows = Array.isArray(data) ? data : (Array.isArray(data?.[Object.keys(data)[0]]) ? data[Object.keys(data)[0]] : []);
  return rows.map((r) => ({
    id: r[idField] || r.id || '?',
    name: r[nameField] || r.name || r.title || '?',
    url: r.image_url || r.flyer_url || '',
    source: path,
  }));
}

const items = [
  ...(await collect('/data/partners.json', 'partner_id', 'name')),
  ...(await collect('/data/events.json', 'event_id', 'title')),
  ...(await collect('/data/partner-events.json', 'event_id', 'title')),
  ...(await collect('/data/venues.json', 'venue_id', 'name')),
  ...(await collect('/data/seasons.json', 'season_id', 'name')),
];

const withUrl = items.filter((i) => i.url);
const empty = items.length - withUrl.length;
const external = withUrl.filter((i) => i.url.startsWith('http') && !i.url.includes('amocartagena.co')).length;
const failures = [];
let done = 0;

for (let i = 0; i < withUrl.length; i += CONCURRENCY) {
  const batch = withUrl.slice(i, i + CONCURRENCY);
  await Promise.all(batch.map(async (item) => {
    const abs = item.url.startsWith('http') ? item.url : `${LIVE}${item.url}`;
    const { ok, status } = await headOk(abs);
    done++;
    if (!ok) failures.push({ ...item, status, abs });
  }));
  process.stdout.write(`\r  checking ${done}/${withUrl.length}…`);
}
process.stdout.write('\r');

if (failures.length === 0) {
  console.log(`IMAGES OK: ${withUrl.length}/${withUrl.length} 200 (${empty} empty→SafeImage fallback; ${external} external CDN — self-host before scale)`);
  process.exit(0);
} else {
  console.error(`IMAGES FAILED: ${failures.length} of ${withUrl.length}`);
  for (const f of failures) console.error(`  [${f.status}] ${f.id} ${f.name} -> ${f.abs} (${f.source})`);
  process.exit(1);
}
