#!/usr/bin/env node
/**
 * M10 — offline partner detail fallbacks (+ partner-events statics).
 *
 * DEFAULT MODE — partners:
 * 118 catalog venues (all services + attractions + some ptr_occ_*) had no static
 * public/data/partners/<id>.json, so a deep-link rendered "No encontrado" when the
 * backend was unreachable (offline / PWA / backend-down). This generates the missing
 * files from each venue's catalog entry, projected to the SAME key-shape the existing
 * detail files use (the backend public projection), so offline detail pages match.
 *
 * Idempotent + non-destructive: only WRITES ids that have no file yet; never touches
 * the 806 existing files. Run: `node scripts/gen-partner-fallbacks.mjs [--dry]`.
 *
 * `--partner-events` MODE — regenerate the partner-events statics from the LIVE API:
 *   public/data/partner-events.json            (the list Home / search paint first)
 *   public/data/partner-events/<event_id>.json (the per-id fallback for /partner-event/[id])
 * The old snapshot (evt_010…evt_015) carried June dates with a live "Reservar" CTA
 * and Unsplash flyers. This mode:
 *   • fetches https://backend-mu-one-74.vercel.app/api/partner-events (override with
 *     PARTNER_EVENTS_URL), which already drops past events server-side — and drops
 *     any past-dated record again here (Bogotá today), belt and braces;
 *   • uses `image_url` as normalized by the backend; any external (http/https)
 *     image_url / flyer_url / partner_image is BLANKED so nothing hotlinks Unsplash
 *     (SafeImage then paints the bundled category placeholder);
 *   • deletes stale per-id files that are no longer in the live set.
 * Run: `node scripts/gen-partner-fallbacks.mjs --partner-events [--dry]`.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DRY = process.argv.includes('--dry');
const MODE = process.argv.includes('--partner-events') ? 'partner-events' : 'partners';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── partners (original behaviour) ───────────────────────────────────────────
function genPartnerFallbacks() {
  const dir = path.join(ROOT, 'public/data/partners');

  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/partners.json'), 'utf8'));
  const venues = Array.isArray(catalog) ? catalog : (catalog.partners || catalog.data || []);
  const idOf = (v) => v.partner_id || v.id;

  const existing = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const fileIds = new Set(existing.map((f) => f.replace('.json', '')));

  // Derive the allowed detail-file key set from the existing files (the backend
  // public projection). Projecting to this set keeps internal ranking fields
  // (rank_score, search_profile, tier_score, tags_source, geo, …) OUT of the
  // offline files, exactly like the real ones.
  const detailKeys = new Set();
  for (const f of existing) {
    try {
      const o = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      Object.keys(o).forEach((k) => detailKeys.add(k));
    } catch { /* skip unreadable */ }
  }

  const missing = venues.filter((v) => idOf(v) && !fileIds.has(idOf(v)));

  let written = 0;
  const samples = [];
  for (const v of missing) {
    const id = idOf(v);
    const out = {};
    for (const k of detailKeys) if (v[k] !== undefined) out[k] = v[k];
    out.partner_id = id; // guarantee identity even if catalog used `id`
    if (samples.length < 3) samples.push({ id, keys: Object.keys(out).length, out });
    if (!DRY) fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(out));
    written++;
  }

  console.log(`detailKeys (${detailKeys.size}): ${[...detailKeys].sort().join(',')}`);
  console.log(`catalog venues: ${venues.length} | existing files: ${fileIds.size} | missing: ${missing.length}`);
  console.log(DRY ? `DRY-RUN — would write ${written} files` : `WROTE ${written} files`);
  for (const s of samples) {
    console.log(`\n— ${s.id} (${s.keys} keys):`);
    console.log(JSON.stringify(s.out, null, 1).split('\n').slice(0, 24).join('\n'));
  }
}

// ── partner-events (live → static) ──────────────────────────────────────────
const LIVE_URL = process.env.PARTNER_EVENTS_URL || 'https://backend-mu-one-74.vercel.app/api/partner-events';
const IMAGE_FIELDS = ['image_url', 'flyer_url', 'partner_image'];
const isExternal = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);
const bogotaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

async function regenPartnerEvents() {
  const listPath = path.join(ROOT, 'public/data/partner-events.json');
  const dir = path.join(ROOT, 'public/data/partner-events');
  fs.mkdirSync(dir, { recursive: true });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20000);
  let live;
  try {
    const res = await fetch(LIVE_URL, { signal: ac.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    live = await res.json();
  } catch (err) {
    console.error(`FAILED to fetch ${LIVE_URL}: ${err && err.message ? err.message : err}`);
    console.error('Static partner-events left untouched (never overwrite a snapshot with a failed fetch).');
    process.exitCode = 1;
    return;
  } finally {
    clearTimeout(timer);
  }
  const rows = Array.isArray(live) ? live : (live && Array.isArray(live.partner_events) ? live.partner_events : []);
  const today = bogotaToday();

  const kept = [];
  let droppedPast = 0;
  let blankedExternal = 0;
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const id = raw.event_id || raw.id;
    if (!id) continue;
    const end = raw.date_end || raw.date || raw.date_start || '';
    if (end && end < today) { droppedPast++; continue; }
    const ev = { ...raw, event_id: id };
    for (const f of IMAGE_FIELDS) {
      if (isExternal(ev[f])) { ev[f] = ''; blankedExternal++; }
    }
    // Backend-normalized self-hosted copy is the canonical image; the flyer only
    // stays when it is one of ours.
    if (!ev.image_url && ev.flyer_url && !isExternal(ev.flyer_url)) ev.image_url = ev.flyer_url;
    kept.push(ev);
  }
  kept.sort((a, b) => `${a.date || ''}${a.start_time || ''}`.localeCompare(`${b.date || ''}${b.start_time || ''}`));

  const keepIds = new Set(kept.map((e) => e.event_id));
  const existing = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const stale = existing.filter((f) => !keepIds.has(f.replace(/\.json$/, '')));

  console.log(`live rows: ${rows.length} | kept: ${kept.length} | dropped past-dated: ${droppedPast} | external image fields blanked: ${blankedExternal}`);
  console.log(`per-id files: ${existing.length} existing · ${stale.length} stale to delete · ${kept.length} to write`);
  for (const f of stale) console.log(`  delete ${path.relative(ROOT, path.join(dir, f))}`);
  for (const e of kept) console.log(`  write  ${e.event_id} ${e.date || ''} ${e.start_time || ''} img=${e.image_url || '(none)'}`);

  if (DRY) { console.log('DRY-RUN — nothing written'); return; }
  fs.writeFileSync(listPath, JSON.stringify(kept, null, 2) + '\n');
  for (const f of stale) fs.unlinkSync(path.join(dir, f));
  for (const e of kept) fs.writeFileSync(path.join(dir, `${e.event_id}.json`), JSON.stringify(e, null, 2) + '\n');
  console.log(`WROTE ${path.relative(ROOT, listPath)} (${kept.length}) · ${kept.length} per-id file(s) · deleted ${stale.length} stale file(s)`);
}

// ── dispatch (after every const above is initialised — module TDZ) ──────────
if (MODE === 'partner-events') {
  await regenPartnerEvents();
} else {
  genPartnerFallbacks();
}
