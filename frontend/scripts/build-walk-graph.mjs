// Build the AMO walking graph: OSM walkable streets → public/data/walkgraph.json
//
// AMO owns its own walking router (keyless, offline-capable, zero Google) for
// the tourist zones: Centro Histórico, San Diego, Getsemaní, Manga, Bocagrande,
// Castillogrande, Marbella. The map's Route Mode runs client-side A* over this
// graph — works on hotel wifi and roaming data where API routers time out.
//
// Usage:
//   node scripts/build-walk-graph.mjs              # fetch fresh from Overpass
//   node scripts/build-walk-graph.mjs --input f.json  # rebuild from a saved Overpass dump
//
// Output format (compact, ~hundreds of KB):
//   { v: 1, bbox: [s,w,n,e], nodes: [lat0,lng0,lat1,lng1,...],
//     edges: [a0,b0,dm0, a1,b1,dm1, ...] }   // node indexes + decimeters
// Edges are undirected (walking). Only the largest connected component is kept
// so a picked start/end can never fall on an unreachable island.

import fs from 'fs';

const BBOX = [10.386, -75.570, 10.442, -75.520]; // s, w, n, e
const QUERY = `[out:json][timeout:90];
(
  way["highway"~"^(footway|path|pedestrian|steps|residential|living_street|service|unclassified|tertiary|secondary|primary)$"]["foot"!="no"]["access"!="private"](${BBOX.join(',')});
);
out body;
>;
out skel qt;`;

function haversineM(a, b, c, d) {
  const R = 6371000;
  const dl = ((c - a) * Math.PI) / 180;
  const dg = ((d - b) * Math.PI) / 180;
  const x = Math.sin(dl / 2) ** 2 + Math.cos((a * Math.PI) / 180) * Math.cos((c * Math.PI) / 180) * Math.sin(dg / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function load() {
  const argi = process.argv.indexOf('--input');
  if (argi > -1) {
    console.log('reading Overpass dump:', process.argv[argi + 1]);
    return JSON.parse(fs.readFileSync(process.argv[argi + 1], 'utf8'));
  }
  console.log('fetching from Overpass…');
  const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: QUERY });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  return res.json();
}

const data = await load();
const els = data.elements || [];
const rawNodes = new Map(); // osm id -> [lat, lng]
for (const e of els) if (e.type === 'node') rawNodes.set(e.id, [e.lat, e.lon]);
const ways = els.filter((e) => e.type === 'way' && Array.isArray(e.nodes));
console.log(`input: ${ways.length} ways, ${rawNodes.size} nodes`);

// Index nodes actually used by ways; build undirected edges between
// consecutive way nodes (full geometry kept — polylines must hug the streets).
const idToIdx = new Map();
const nodes = []; // flat [lat,lng,...]
const edgeSet = new Set();
const edges = []; // flat [a,b,dm,...]
const adj = new Map(); // idx -> Set(idx) for component analysis

function nodeIdx(osmId) {
  let i = idToIdx.get(osmId);
  if (i === undefined) {
    const c = rawNodes.get(osmId);
    if (!c) return -1;
    i = nodes.length / 2;
    idToIdx.set(osmId, i);
    nodes.push(Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5);
  }
  return i;
}

for (const w of ways) {
  for (let k = 0; k + 1 < w.nodes.length; k++) {
    const a = nodeIdx(w.nodes[k]);
    const b = nodeIdx(w.nodes[k + 1]);
    if (a < 0 || b < 0 || a === b) continue;
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);
    const dm = Math.max(1, Math.round(haversineM(nodes[a * 2], nodes[a * 2 + 1], nodes[b * 2], nodes[b * 2 + 1]) * 10));
    edges.push(a, b, dm);
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  }
}
console.log(`graph: ${nodes.length / 2} nodes, ${edges.length / 3} edges`);

// Largest connected component only — no unreachable islands.
const compOf = new Int32Array(nodes.length / 2).fill(-1);
let comp = 0;
const compSizes = [];
for (let s = 0; s < nodes.length / 2; s++) {
  if (compOf[s] !== -1 || !adj.has(s)) continue;
  let size = 0;
  const stack = [s];
  compOf[s] = comp;
  while (stack.length) {
    const n = stack.pop();
    size++;
    for (const m of adj.get(n) || []) if (compOf[m] === -1) { compOf[m] = comp; stack.push(m); }
  }
  compSizes.push(size);
  comp++;
}
const main = compSizes.indexOf(Math.max(...compSizes));
console.log(`components: ${comp}, largest: ${compSizes[main]} nodes`);

// Remap to the main component.
const remap = new Int32Array(nodes.length / 2).fill(-1);
const outNodes = [];
for (let i = 0; i < nodes.length / 2; i++) {
  if (compOf[i] === main) {
    remap[i] = outNodes.length / 2;
    outNodes.push(nodes[i * 2], nodes[i * 2 + 1]);
  }
}
const outEdges = [];
for (let e = 0; e < edges.length; e += 3) {
  const a = remap[edges[e]], b = remap[edges[e + 1]];
  if (a >= 0 && b >= 0) outEdges.push(a, b, edges[e + 2]);
}

const out = { v: 1, bbox: BBOX, nodes: outNodes, edges: outEdges };
const json = JSON.stringify(out);
fs.writeFileSync(new URL('../public/data/walkgraph.json', import.meta.url), json);
console.log(`walkgraph.json: ${outNodes.length / 2} nodes, ${outEdges.length / 3} edges, ${(json.length / 1024).toFixed(0)}KB`);
