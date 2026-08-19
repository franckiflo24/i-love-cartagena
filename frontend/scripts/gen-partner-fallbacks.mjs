#!/usr/bin/env node
/**
 * M10 — offline partner detail fallbacks.
 *
 * 118 catalog venues (all services + attractions + some ptr_occ_*) had no static
 * public/data/partners/<id>.json, so a deep-link rendered "No encontrado" when the
 * backend was unreachable (offline / PWA / backend-down). This generates the missing
 * files from each venue's catalog entry, projected to the SAME key-shape the existing
 * detail files use (the backend public projection), so offline detail pages match.
 *
 * Idempotent + non-destructive: only WRITES ids that have no file yet; never touches
 * the 806 existing files. Run: `node scripts/gen-partner-fallbacks.mjs [--dry]`.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
