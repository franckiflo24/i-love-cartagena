// Verify the string-built WebView map document (buildMapHTML in mapa.tsx).
//
// tsc can't see inside the document — to TypeScript it's just concatenated
// strings — so quoting/concat bugs only explode inside the native app. This
// script extracts buildMapHTML from the source, evals it with stubs, then:
//   1. PARSE-checks the generated <script> for every mode combination
//      (plain / userloc / tour / walk / route variants), and
//   2. EXECUTES the route path with a stubbed Leaflet + the real router over
//      the real committed graph, asserting the routeSummary postMessage fires
//      with sane numbers and both route polylines draw.
//
// Run after any edit to buildMapHTML:  node scripts/verify-map-document.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(FRONTEND, 'app/(tabs)/mapa.tsx'), 'utf8');
// Evaluate the REAL module prelude — every const/helper buildMapHTML closes over
// (tiles, cluster options, zones, escHtml, detailPath, walk constants, …) —
// from the end of the import block to the first component. Only the imports are
// stubbed, so the check never drifts from mapa.tsx the way hand-copied stubs did.
const fnStart = src.indexOf('function buildMapHTML(');
const end = src.indexOf('\nfunction WebMapDirect(', fnStart);
let preludeStart = -1;
for (const m of src.matchAll(/^import [\s\S]*?from '[^']+';[ \t]*$/gm)) {
  if (m.index < fnStart) preludeStart = m.index + m[0].length;
}
if (fnStart < 0 || end < 0 || preludeStart < 0) { console.error('FAIL: extraction markers not found in mapa.tsx'); process.exit(1); }
// The region is TypeScript (typed signature, `type` aliases, inline annotations
// such as `(msg: string) =>`): transpile it to plain JS before evaluating.
const preludeJs = ts.transpileModule(src.slice(preludeStart, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;

// Import stubs (values are irrelevant to syntax; route execution uses the real
// coords below).
const COLORS = { background: '#050814', surface: '#0b1020', surfaceAlt: '#111a2e', border: '#1c2740', icon: '#AEB6C4', textMain: '#F4F6FA', textMuted: '#9AA3B5', textFaint: '#6B7385', mustard: '#C9A84C', primary: '#12B5A5', white: '#fff' };
const IMPORTS = {
  COLORS,
  SPACING: {}, RADIUS: {}, FONTS: {}, colorForKey: () => '#3B82F6',
  Dimensions: { get: () => ({ width: 390, height: 844 }) },
  Platform: { OS: 'ios', select: (o) => o.ios ?? o.default },
  ASSET_ORIGIN: 'https://www.amocartagena.co',
  fmtDistance: (m) => `${Math.round(m)} m`, haversineM: () => 0,
  eventPriceLabel: () => '', NBH_LABELS: {}, venueBarrio: () => null,
  ATLAS_VERIFIED: [], ATLAS_VENUE_FIXES: {}, ATLAS_ADD_VENUES: [], ATLAS_RUTAS: [],
  ATLAS_ROUTE: [{ title: 'Torre del Reloj', lat: 10.423, lng: -75.549, zoom: 18 }],
  ATLAS_WALK: [
    { title: 'Torre del Reloj', lat: 10.423036, lng: -75.549219, zoom: 18 },
    { title: 'El Beso', lat: 10.4195719, lng: -75.5464839, zoom: 18 },
  ],
};
let buildMapHTML;
try {
  ({ buildMapHTML } = new Function(...Object.keys(IMPORTS), preludeJs + '\nreturn { buildMapHTML };')(...Object.values(IMPORTS)));
} catch (e) {
  console.error(`FAIL: mapa.tsx prelude did not evaluate — ${e.message} (a new import used above buildMapHTML needs a stub in IMPORTS)`);
  process.exit(1);
}

// Hostile names on purpose — apostrophes, quotes, angle brackets.
const places = [
  { id: 'p1', name: "Casa D'Amore & \"Sons\" <x>", description: 'desc', category: 'venue', type: 'venue', address: 'Calle 35 #3-30', lat: 10.4236, lng: -75.5502, image_url: '', price: '$$', link: '', extra: '', verified: true },
  { id: 'p2', name: 'El Beso', description: 'd2', category: 'partner', type: 'partner', address: 'Getsemaní', lat: 10.4196, lng: -75.5465, image_url: '', price: '', link: '', extra: '' },
];
const route = {
  origin: { lat: 10.423036, lng: -75.549219 },
  stops: [
    { name: 'Casa Carolina', lat: 10.4236246, lng: -75.5502602 },
    { name: 'El Beso', lat: 10.4195719, lng: -75.5464839 },
  ],
};

const extractScript = (html) => {
  const m = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/);
  if (!m) throw new Error('no <script> extracted');
  return m[1];
};

// Signature: (places, filter, userLoc, satellite, autoTour, autoWalk, route, zones, tr).
// `trHostile` injects quotes/apostrophes into every translated label.
const trId = (s) => s;
const trHostile = (s) => `${s} l'été "x" <b>`;

// ── 1. Parse-check every mode combination (× zones on/off × both tr) ──
const base = [
  ['plain', [places, 'all', null, true, false, false, null]],
  ['userloc', [places, 'all', { lat: 10.4236, lng: -75.5483 }, false, false, false, null]],
  ['tour', [places, 'all', null, true, true, false, null]],
  ['walk', [places, 'all', null, true, false, true, null]],
  ['route', [places, 'all', { lat: 10.4236, lng: -75.5483 }, true, false, false, route]],
  ['route-no-origin', [places, 'all', null, true, false, false, { origin: null, stops: route.stops }]],
  ['route-single', [places, 'all', null, true, false, false, { origin: route.origin, stops: [route.stops[0]] }]],
];
const combos = [];
for (const [name, args] of base) {
  for (const zones of [false, true]) {
    for (const [trName, tr] of [['id', trId], ['hostile', trHostile]]) {
      combos.push([`${name}/zones=${zones}/tr=${trName}`, [...args, zones, tr]]);
    }
  }
}
let fail = 0;
for (const [name, args] of combos) {
  try {
    new Function(extractScript(buildMapHTML(...args))); // parse only
    console.log(`parse ${name}: OK`);
  } catch (e) {
    console.log(`parse ${name}: FAIL — ${e.message}`);
    fail++;
  }
}

// ── 1b. Structural invariants of the venue layer (markercluster + halos) ──
{
  const doc = extractScript(buildMapHTML(places, 'all', null, true, false, false, null, true, trId));
  const lastAdd = doc.lastIndexOf('.addTo(venueLayer)');
  const layerOn = doc.indexOf('venueLayer.addTo(map)', lastAdd);
  const checks = [
    ['cluster guard (typeof L.markerClusterGroup === "function")', /typeof L\.markerClusterGroup === "function"/.test(doc)],
    ['pins go into venueLayer', lastAdd >= 0],
    ['venueLayer.addTo(map) after the last pin', lastAdd >= 0 && layerOn > lastAdd],
    ['__amoSyncHalos zoom gate', doc.includes('__amoSyncHalos')],
  ];
  for (const [label, ok] of checks) {
    console.log(`struct ${label}: ${ok ? 'OK' : 'FAIL'}`);
    if (!ok) fail++;
  }
}

// ── 2. Execute the route path: stub Leaflet, real router + real graph ──
const script = extractScript(buildMapHTML(places, 'all', { lat: 10.4232, lng: -75.5490 }, true, false, false, route, true, trId));
const chainObj = new Proxy(function () {}, { get: (_, k) => (k === 'length' ? 0 : () => chainObj), apply: () => chainObj });
const polylines = [];
const MAP_STUB = { options: {}, getZoom: () => 16, hasLayer: () => false };
const mapObj = new Proxy({}, { get: (_, k) => (k in MAP_STUB ? MAP_STUB[k] : () => mapObj) });
globalThis.window = globalThis;
globalThis.document = undefined;
globalThis.L = {
  map: () => mapObj, tileLayer: () => chainObj, circleMarker: () => chainObj,
  marker: () => chainObj, divIcon: (o) => o, popup: () => chainObj,
  polyline: (line) => { polylines.push(line.length); return chainObj; },
  layerGroup: () => chainObj, markerClusterGroup: () => chainObj, latLngBounds: (l) => l, rectangle: () => chainObj,
  control: () => chainObj, DomUtil: { create: () => ({ style: {} }) },
};
let summary = null;
globalThis.ReactNativeWebView = { postMessage: (s) => { try { const m = JSON.parse(s); if (m.type === 'routeSummary') summary = m; } catch {} } };
globalThis.fetch = async () => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(FRONTEND, 'public/data/walkgraph.json'), 'utf8')) });
eval(fs.readFileSync(path.join(FRONTEND, 'public/walk-router.js'), 'utf8'));
await AmoWalkRouter.load('local');
eval(script);
await new Promise(r => setTimeout(r, 700)); // load().then(draw) settles
const execOK = summary && summary.meters > 400 && summary.meters < 3000 && polylines.length >= 2;
console.log(`exec route: ${execOK ? 'OK' : 'FAIL'} — summary=${JSON.stringify(summary)} polylines=${JSON.stringify(polylines)}`);
if (!execOK) fail++;

process.exit(fail ? 1 : 0);
