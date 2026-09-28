#!/usr/bin/env node
/**
 * prune-missing-images.mjs — blank every catalog image path that has no file.
 *
 * 25 catalog rows (ptr_dv2_*, ptr_dv3_*, ptr_dv_026, ptr_occ_*) pointed at
 * /images/partners/<id>.jpg files that do not exist under public/images, so every
 * card for them fired a 404 before SafeImage fell back. A BLANK path skips the
 * network round trip: SafeImage paints the bundled category placeholder from
 * frame 0 (web: the same-origin category photo).
 *
 * Scans public/data/catalog.json and public/data/partners.json. Every string
 * field whose value starts with "/images/" (image, image_url, hero_photo,
 * partner_image, …) is checked against the filesystem; missing → "".
 *
 * Idempotent. Run: `node scripts/prune-missing-images.mjs [--dry]`.
 * Exit code 0 always (it is a normaliser, not a tripwire — verify-images.mjs is).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const FILES = ['public/data/catalog.json', 'public/data/partners.json'];

const existsCache = new Map();
const imageExists = (webPath) => {
  const clean = webPath.split('?')[0];
  if (!existsCache.has(clean)) existsCache.set(clean, fs.existsSync(path.join(PUBLIC, clean)));
  return existsCache.get(clean);
};

let totalBlanked = 0;
const report = [];

for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { console.error(`skip (missing): ${rel}`); continue; }
  const raw = fs.readFileSync(abs, 'utf8');
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed) ? parsed : (parsed.partners || parsed.data || []);
  let blanked = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const [k, v] of Object.entries(row)) {
      if (typeof v !== 'string' || !v.startsWith('/images/')) continue;
      if (imageExists(v)) continue;
      report.push({ file: rel, id: row.partner_id || row.id || '?', field: k, was: v });
      row[k] = '';
      blanked++;
    }
  }
  totalBlanked += blanked;
  if (!DRY && blanked > 0) {
    // Preserve the file's original formatting style (minified vs pretty).
    const pretty = /\n\s+"/.test(raw.slice(0, 200));
    fs.writeFileSync(abs, pretty ? JSON.stringify(parsed, null, 2) + '\n' : JSON.stringify(parsed));
  }
  console.log(`${rel}: ${rows.length} rows · ${blanked} image path(s) blanked${DRY ? ' (dry-run)' : ''}`);
}

for (const r of report) console.log(`  ${r.file} ${r.id} .${r.field} = ${r.was}`);
console.log(`${DRY ? 'DRY-RUN — would blank' : 'BLANKED'} ${totalBlanked} missing image path(s)`);
