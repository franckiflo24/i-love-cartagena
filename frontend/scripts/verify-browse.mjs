#!/usr/bin/env node
/**
 * verify-browse.mjs — the CORE-BROWSE smoke test (P0 hotfix 2026-10-13).
 *
 * MANDATORY after every frontend deploy, same standing as verify-images.mjs:
 * it answers "can a guest actually browse?" — the failure it exists for is an
 * inline category section rendering BLANK while that category's "Ver todos"
 * has places (the subcategory gateway fired on defined-but-empty tiles and
 * force-emptied the grid; Cafés/Hoteles shipped blank for weeks).
 *
 * Asserts, against LIVE prod (override with BROWSE_BASE):
 *   1. EVERY category chip yields a non-blank inline section whenever the
 *      catalog has places for it: either ≥1 of that category's top partner
 *      names (card grid) or ≥1 populated subcategory tile ("N lugares").
 *   2. "Todos" shows a MIX: top of the list spans ≥3 distinct categories.
 *   3. A lens ANDed to a category with zero overlap renders its HONEST empty
 *      state (women → "Sé la primera"), never the generic "Próximamente",
 *      never silent-blank; a lens with results shows its count.
 *   4. The broken singulars never return: no "hotele", "bare", "atraccione".
 *
 * Requires Google Chrome + playwright-core (devDependency; no browser download).
 *   node scripts/verify-browse.mjs            # against https://www.amocartagena.co
 *   BROWSE_BASE=http://localhost:8081 node scripts/verify-browse.mjs
 */
import { chromium } from 'playwright-core';

const BASE = process.env.BROWSE_BASE || 'https://www.amocartagena.co';
const CHROME = process.env.BROWSE_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

// key → [chip label ES, apiValue] — must mirror CATEGORIES in app/(tabs)/explore.tsx.
const CATS = [
  ['Restaurantes', 'restaurant'], ['Bares', 'bar'], ['Cafés', 'cafe'],
  ['Nightlife', 'nightlife'], ['Spa', 'wellness'], ['Beach Clubs', 'beach_club'],
  ['Yates', 'yacht'], ['Belleza', 'beauty'], ['Experiencias', 'activity'],
  ['Hoteles', 'hotel'], ['Atracciones', 'attraction'], ['Servicios', 'service'],
];
const BROKEN_SINGULARS = /\b(hotele|bare|atraccione)\b/i;

const res = await fetch(`${BASE}/data/partners.json`);
if (!res.ok) { console.error(`FATAL: ${BASE}/data/partners.json -> ${res.status}`); process.exit(2); }
const partners = await res.json();
const byCat = new Map();
for (const p of partners) {
  const c = p.category || 'other';
  if (!byCat.has(c)) byCat.set(c, []);
  byCat.get(c).push(p);
}

let fail = 0;
const check = (name, ok, extra = '') => {
  console.log(ok ? 'ok ' : 'FAIL', name, ok ? '' : extra);
  if (!ok) fail++;
};

// P2: VIEWPORT=1440x900 runs the same smoke at desktop width (the phone-shell
// frame). Default stays the phone viewport — both are release gates now.
const VIEWPORT = (() => {
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(process.env.VIEWPORT || '');
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 414, height: 896 };
})();
console.log(`[verify-browse] viewport ${VIEWPORT.width}x${VIEWPORT.height}`);
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ userAgent: UA, viewport: VIEWPORT });
await ctx.addInitScript(() => { try {
  localStorage.setItem('@musica_lang', 'es');
  localStorage.setItem('@onboarding_done', 'true');
  localStorage.setItem('@tutorial_seen', 'true');
  // Drop 6 hardening: a PERSONALIZED profile is the condition that broke "Todos"
  // live (interest scoring re-clustered beach clubs + experiences after the
  // interleave) — the smoke now runs AS that profile, not as a blank visitor.
  localStorage.setItem('@onboarding_profile', JSON.stringify({ interests: ['beach_club', 'activity'] }));
} catch {} });
const page = await ctx.newPage();
await page.goto(`${BASE}/explore`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(9000);

// ── 2. "Todos" is a mix across the CATEGORY AXIS, read in true grid order ──
// (The old check — "any 3 categories' names anywhere in the viewport" — passed at
// 2-3 via the rails while the grid itself was a beach-club wall. This one parses
// the grid rows in order below the "Todos los Lugares" marker across scroll steps.)
{
  const nameToCat = new Map();
  for (const [cat, rows] of byCat) {
    for (const p of rows) {
      if (!p.name || p.name.length < 6) continue;         // short names collide
      if (nameToCat.has(p.name)) nameToCat.set(p.name, null); // ambiguous — drop
      else nameToCat.set(p.name, cat);
    }
  }
  const ordered = [];
  const seen = new Set();
  for (let step = 0; step < 5 && ordered.length < 20; step++) {
    const body = await page.evaluate(() => document.body.innerText);
    const marker = body.indexOf('Todos los Lugares');
    const grid = marker >= 0 ? body.slice(marker) : body;
    const found = [];
    for (const [name, cat] of nameToCat) {
      if (!cat) continue;
      const idx = grid.indexOf(name);
      if (idx >= 0) found.push({ idx, name, cat });
    }
    found.sort((a, b) => a.idx - b.idx);
    for (const f of found) {
      if (!seen.has(f.name)) { seen.add(f.name); ordered.push(f); }
    }
    await page.mouse.wheel(0, 1400);
    await page.waitForTimeout(900);
  }
  const first15 = ordered.slice(0, 15);
  const histogram = {};
  let maxRun = 0, run = 0, runCat = '';
  for (const f of first15) {
    histogram[f.cat] = (histogram[f.cat] || 0) + 1;
    run = f.cat === runCat ? run + 1 : 1;
    runCat = f.cat;
    if (run > maxRun) maxRun = run;
  }
  const distinct = Object.keys(histogram).length;
  console.log(`[all] Todos first-${first15.length} histogram:`, JSON.stringify(histogram),
              `| distinct=${distinct} maxRun=${maxRun}`);
  check(`[all] ≥5 distinct categories in first 15 (got ${distinct})`, first15.length >= 12 && distinct >= 5);
  check(`[all] ≤2 consecutive same-category (maxRun=${maxRun})`, maxRun <= 2);
  const body = await page.evaluate(() => document.body.innerText);
  check('[all] no broken singulars', !BROKEN_SINGULARS.test(body));
  // reset scroll for the category-chip loop below
  await page.goto(`${BASE}/explore`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(6000);
}

// ── 1. every category chip → non-blank inline section ──
for (const [label, apiValue] of CATS) {
  const rows = byCat.get(apiValue) || [];
  const chip = page.getByText(label, { exact: true }).first();
  if (!(await chip.count())) { check(`[${label}] chip found`, false); continue; }
  await chip.click().catch(() => {});
  await page.waitForTimeout(1600);
  const body = await page.evaluate(() => document.body.innerText);
  check(`[${label}] no broken singular`, !BROKEN_SINGULARS.test(body),
        (body.match(BROKEN_SINGULARS) || [])[0]);
  if (rows.length === 0) continue; // nothing in catalog → blank is honest
  const names = rows.slice(0, 8).map((p) => p.name).filter(Boolean);
  const hasCard = names.some((n) => body.includes(n));
  const hasTiles = body.includes('Elige tu') && /\d+\s+lugar(es)?/.test(body);
  check(`[${label}] inline non-blank (catalog=${rows.length})`, hasCard || hasTiles,
        `— neither a top-8 card name nor a populated tile is on screen`);
}

// ── 3a. lens ∩ category = 0 → the honest empty state, never Próximamente ──
await page.goto(`${BASE}/explore?lens=women_verified`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(8000);
{
  const cafChip = page.getByText('Cafés', { exact: true }).first();
  await cafChip.click().catch(() => {});
  await page.waitForTimeout(1600);
  const body = await page.evaluate(() => document.body.innerText);
  const honest = body.includes('Sé la primera') || body.includes('Sin resultados en esta lente');
  check('[lens∩cat=0] honest empty state shown', honest);
  check('[lens∩cat=0] never the generic Próximamente', !body.includes('Próximamente') || honest);
}
// ── 3b. a lens with results shows its count ──
await page.goto(`${BASE}/explore?lens=step_free`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(8000);
{
  const body = await page.evaluate(() => document.body.innerText);
  check('[lens results] step_free count visible', /Sin escalones\s*·\s*\d+/.test(body));
}

await browser.close();
if (fail) { console.error(`\nBROWSE BROKEN: ${fail} failures`); process.exit(1); }
console.log('\nBROWSE OK: every category non-blank, all mixed, lenses honest');
