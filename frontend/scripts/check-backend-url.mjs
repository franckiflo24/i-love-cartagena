// Build guard (2026-10-02): a web bundle exported without EXPO_PUBLIC_BACKEND_URL
// silently runs in STATIC_MODE (src/constants/api.ts) — no live hydration, every
// dynamic page falls through to "no encontrado", home/explore/map paint without
// events. That exact state shipped to production once. Fail the build instead.
import fs from 'node:fs';
import path from 'node:path';

const PROD_HOST = 'backend-mu-one-74.vercel.app';
const want = (process.env.EXPO_PUBLIC_BACKEND_URL || '').replace(/^https?:\/\//, '').replace(/\/+$/, '') || PROD_HOST;
const dir = path.join(process.cwd(), 'dist', '_expo', 'static', 'js', 'web');
if (!fs.existsSync(dir)) {
  console.error(`[check-backend-url] ${dir} missing — run after expo export`);
  process.exit(1);
}
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
const hit = files.find((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes(want));
if (!hit) {
  console.error(`[check-backend-url] FAIL: no exported JS chunk contains "${want}".`);
  console.error('  EXPO_PUBLIC_BACKEND_URL was not visible to `expo export` → the site would run in STATIC_MODE.');
  console.error('  Set it in the build environment (Vercel project env, Production) and rebuild.');
  process.exit(1);
}
console.log(`[check-backend-url] OK: ${hit} references ${want}`);
