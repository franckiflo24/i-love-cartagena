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

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(FRONTEND, 'app/(tabs)/mapa.tsx'), 'utf8');
const start = src.indexOf('function buildMapHTML(');
const end = src.indexOf('\n}\n\n// Cartagena bounding box', start);
if (start < 0 || end < 0) { console.error('FAIL: extraction markers not found in mapa.tsx'); process.exit(1); }
const fnSrc = src.slice(start, end + 2)
  .replace(/function buildMapHTML\([\s\S]*?\) \{/, 'function buildMapHTML(places, filter, userLoc, satellite, autoTour, autoWalk, route) {');

// Stubs for everything buildMapHTML closes over (values are irrelevant to
// syntax; route execution uses the real coords below).
const COLORS = { background: '#050814', surface: '#0b1020', surfaceAlt: '#111a2e', border: '#1c2740', icon: '#AEB6C4', textMain: '#F4F6FA', textMuted: '#9AA3B5', textFaint: '#6B7385', mustard: '#C9A84C', primary: '#12B5A5', white: '#fff' };
const TILE_DARK = { url: 'u', maxNativeZoom: 16 };
const TILE_SAT = { url: 'u', maxNativeZoom: 18 };
const ATLAS_ROUTE = [{ title: 'Torre del Reloj', lat: 10.423, lng: -75.549, zoom: 18 }];
const ATLAS_WALK = [
  { title: 'Torre del Reloj', lat: 10.423036, lng: -75.549219, zoom: 18 },
  { title: 'El Beso', lat: 10.4195719, lng: -75.5464839, zoom: 18 },
];
const TOUR_FLIGHT_S = 2.2, TOUR_STEP_MS = 4200;
const WALK_LEG_MS = 4000, WALK_TICKS = 50, WALK_DWELL_MS = 1100, WALK_M_PER_MIN = 76.7;
const WALK_ROUTER_ORIGIN = 'https://www.amocartagena.co';
const WALK_ROUTER_JS = '/walk-router.js';
const WALK_GRAPH_JSON = '/data/walkgraph.json';
const markerColor = () => '#3B82F6';
const isInCartagena = (lat, lng) => lat >= 10.30 && lat <= 10.50 && lng >= -75.62 && lng <= -75.45;

const buildMapHTML = eval('(' + fnSrc + ')');

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

// ── 1. Parse-check every mode combination ──
const combos = [
  ['plain', [places, 'all', null, true, false, false, null]],
  ['userloc', [places, 'all', { lat: 10.4236, lng: -75.5483 }, false, false, false, null]],
  ['tour', [places, 'all', null, true, true, false, null]],
  ['walk', [places, 'all', null, true, false, true, null]],
  ['route', [places, 'all', { lat: 10.4236, lng: -75.5483 }, true, false, false, route]],
  ['route-no-origin', [places, 'all', null, true, false, false, { origin: null, stops: route.stops }]],
  ['route-single', [places, 'all', null, true, false, false, { origin: route.origin, stops: [route.stops[0]] }]],
];
let fail = 0;
for (const [name, args] of combos) {
  try {
    new Function(extractScript(buildMapHTML(...args))); // parse only
    console.log(`parse ${name}: OK`);
  } catch (e) {
    console.log(`parse ${name}: SYNTAX ERROR — ${e.message}`);
    fail++;
  }
}

// ── 2. Execute the route path: stub Leaflet, real router + real graph ──
const script = extractScript(buildMapHTML(places, 'all', { lat: 10.4232, lng: -75.5490 }, true, false, false, route));
const chainObj = new Proxy(function () {}, { get: (_, k) => (k === 'length' ? 0 : () => chainObj), apply: () => chainObj });
const polylines = [];
const mapObj = new Proxy({}, { get: (_, k) => (k === 'options' ? {} : () => mapObj) });
globalThis.window = globalThis;
globalThis.document = undefined;
globalThis.L = {
  map: () => mapObj, tileLayer: () => chainObj, circleMarker: () => chainObj,
  marker: () => chainObj, divIcon: (o) => o, popup: () => chainObj,
  polyline: (line) => { polylines.push(line.length); return chainObj; },
  layerGroup: () => chainObj, latLngBounds: (l) => l, rectangle: () => chainObj,
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
