#!/usr/bin/env node
/**
 * snapshot-passport-collections.mjs — refresh the bundled passport definitions.
 *
 * /passport/collections is a per-user-namespaced (PRIVATE_PATH) route, so
 * `api.get` never falls back to /data for it. src/lib/passport.ts therefore seeds
 * from public/data/passport/collections.json directly (IDB → bundled → live).
 * A stale snapshot is harmless for progress (the server computes it) but a plate
 * or plaza added on the backend would be missing from the grids until the live
 * revalidate lands — so refresh this file whenever the collections change:
 *
 *   node scripts/snapshot-passport-collections.mjs        # writes the file
 *   node scripts/snapshot-passport-collections.mjs --check # exit 1 if it drifted
 *
 * Never writes an invalid payload: the live answer must carry ≥1 sabor and ≥1 plaza.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const BACKEND = process.env.BACKEND_URL || 'https://backend-mu-one-74.vercel.app';
const CHECK = process.argv.includes('--check');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/data/passport/collections.json');

const res = await fetch(`${BACKEND}/api/passport/collections`, { headers: { Accept: 'application/json' } });
if (!res.ok) {
  console.error(`FATAL: GET /api/passport/collections -> ${res.status}`);
  process.exit(2);
}
const live = await res.json();
const valid = live && Array.isArray(live.sabores) && live.sabores.length > 0
  && Array.isArray(live.plazas) && live.plazas.length > 0;
if (!valid) {
  console.error('FATAL: live payload has no sabores/plazas — snapshot left untouched');
  process.exit(2);
}

const next = `${JSON.stringify(live, null, 2)}\n`;
const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
if (prev === next) {
  console.log(`collections.json up to date (version ${live.version}, ${live.sabores.length} sabores, ${live.plazas.length} plazas)`);
  process.exit(0);
}
if (CHECK) {
  console.error(`DRIFT: bundled collections.json differs from live (live version ${live.version}) — run without --check to refresh`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, next);
console.log(`WROTE ${path.relative(ROOT, OUT)} (version ${live.version}, ${live.sabores.length} sabores, ${live.plazas.length} plazas)`);
