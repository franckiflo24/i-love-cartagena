#!/usr/bin/env node
/**
 * verify-images.mjs — post-deploy image tripwire.
 *
 * Fetches the LIVE /data/partners.json and /data/events.json from
 * www.amocartagena.co and HEAD-requests every image_url against the live
 * domain. Prints "IMAGES OK: N/N 200" or lists every failure and exits
 * non-zero. Empty image_urls are counted (SafeImage renders a category
 * fallback for them by design) but not treated as failures.
 *
 * MANDATORY after every deploy:  node scripts/verify-images.mjs
 */

const LIVE = 'https://www.amocartagena.co';
const CONCURRENCY = 24;

async function headOk(url) {
  try {
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    // Some CDNs reject HEAD — fall back to a ranged GET before failing.
    if (!res.ok && (res.status === 405 || res.status === 403)) {
      res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, redirect: 'follow' });
    }
    return { ok: res.ok || res.status === 206, status: res.status };
  } catch (e) {
    return { ok: false, status: `ERR ${e.message}` };
  }
}

async function collect(path, idField, nameField) {
  const res = await fetch(`${LIVE}${path}`);
  if (!res.ok) {
    console.error(`FATAL: GET ${path} -> ${res.status}`);
    process.exit(2);
  }
  const data = await res.json();
  const rows = Array.isArray(data) ? data : [];
  return rows.map((r) => ({
    id: r[idField] || r.id || '?',
    name: r[nameField] || r.name || '?',
    url: r.image_url || '',
    source: path,
  }));
}

const items = [
  ...(await collect('/data/partners.json', 'partner_id', 'name')),
  ...(await collect('/data/events.json', 'event_id', 'title')),
];

const withUrl = items.filter((i) => i.url);
const empty = items.length - withUrl.length;
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
  console.log(`IMAGES OK: ${withUrl.length}/${withUrl.length} 200 (${empty} empty→SafeImage fallback, by design)`);
  process.exit(0);
} else {
  console.error(`IMAGES FAILED: ${failures.length} of ${withUrl.length}`);
  for (const f of failures) {
    console.error(`  [${f.status}] ${f.id} ${f.name} -> ${f.abs} (${f.source})`);
  }
  process.exit(1);
}
