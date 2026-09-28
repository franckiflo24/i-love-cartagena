import React, { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Dimensions, Platform, ScrollView, Linking, Pressable,
} from 'react-native';
import { Alert } from '../../src/lib/alert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { COLORS, SPACING, RADIUS, FONTS, colorForKey } from '../../src/constants/theme';
import { api , ASSET_ORIGIN} from '../../src/constants/api';
import { eventPriceLabel } from '../../src/utils/price';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTr } from '../../src/i18n/autoTr';
import { geoService, haversineM, fmtDistance } from '../../src/lib/geo';
import { getCollections } from '../../src/lib/passport';
import { getVenues } from '../../src/lib/venueCache';
import { venueBarrio, NBH_LABELS, NbhCentroid } from '../../src/utils/neighborhood';
import { HomeBaseSheet } from '../../src/components/HomeBaseSheet';
import { getHomeBase, syncHomeBase } from '../../src/lib/homeBase';
import { openDirections } from '../../src/lib/maps';
import { ATLAS_VERIFIED, ATLAS_VENUE_FIXES, ATLAS_ADD_VENUES, ATLAS_ROUTE, ATLAS_WALK, ATLAS_RUTAS } from '../../src/data/atlas';

// Embeds arbitrary text as a JS string literal inside the WebView's inline <script>.
// Only escaping ' let a newline / backslash in a partner description throw a
// SyntaxError and blank the whole native map; `<` is escaped so "</script>" can't close the tag.
const jsString = (v: string) =>
  JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

type Place = {
  id: string;
  name: string;
  description: string;
  category: string;
  type: string;
  address: string;
  lat: number;
  lng: number;
  image_url: string;
  price: string;
  link: string;
  extra: string;
  neighborhood?: string | null;
  verified?: boolean; // atlas-verified position (src/data/atlas.ts)
};

// Keyless Esri basemaps. Dark Gray canvas is the default; World Imagery powers
// the satellite view (same imagery family as the AMO Atlas — real overhead
// visuals of every venue). maxNativeZoom caps real tile requests at each
// service's reliable top level and upscales above.
const TILE_DARK = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  maxNativeZoom: 16,
};
const TILE_SAT = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  maxNativeZoom: 18,
};

// Leaflet + Leaflet.markercluster, pinned. Both render paths (inline WebView
// document on native, DOM on web) load the SAME URLs so a CDN block behaves
// identically everywhere: no cluster plugin ⇒ plain layerGroup, never a blank map.
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const MC_CSS = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css';
const MC_JS = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js';

// Clustering: 869 pins at city zoom painted as one solid blob over Centro /
// Getsemaní / Bocagrande. Clusters collapse them into teal count discs that
// zoom-to-bounds on tap and spiderfy at street level. Precision halos (verified
// pins) only draw from HALO_MIN_ZOOM — a bare dashed ring under a cluster disc
// reads as noise.
const CLUSTER_RADIUS = 52;
const CLUSTER_OFF_ZOOM = 17;
const HALO_MIN_ZOOM = 16;
type ClusterTier = { max: number; size: number; cls: string };
const CLUSTER_TIERS: ClusterTier[] = [
  { max: 10, size: 34, cls: 'sm' },
  { max: 100, size: 40, cls: 'md' },
  { max: Infinity, size: 48, cls: 'lg' },
];
function clusterTier(n: number): ClusterTier {
  return CLUSTER_TIERS.find(t => n < t.max) || CLUSTER_TIERS[CLUSTER_TIERS.length - 1];
}
// Cluster disc: theme teal, white hairline, soft teal glow ring. `marker-cluster`
// is kept on the class list so the plugin's own selectors (and QA counts) match.
const CLUSTER_CSS = ''
  + '.amo-cluster { display: flex; align-items: center; justify-content: center; border-radius: 50%; '
  + 'background: rgba(18,181,165,0.94); color: #fff; border: 2px solid rgba(255,255,255,0.92); '
  + 'box-shadow: 0 0 0 6px rgba(18,181,165,0.22), 0 6px 16px rgba(0,0,0,0.45); '
  + 'font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-weight: 800; letter-spacing: -0.2px; }'
  + '.amo-cluster span { line-height: 1; }'
  + '.amo-cluster-sm { font-size: 12px; }'
  + '.amo-cluster-md { font-size: 13px; }'
  + '.amo-cluster-lg { font-size: 14px; box-shadow: 0 0 0 8px rgba(18,181,165,0.18), 0 6px 18px rgba(0,0,0,0.5); }'
  + '.leaflet-cluster-spider-leg { stroke: #12B5A5; }';
// Options as source text for the inline WebView document (CLUSTER_TIERS is
// serialized so the native icon sizing matches the web path exactly).
const CLUSTER_OPTS_JS = '{'
  + 'maxClusterRadius: ' + CLUSTER_RADIUS + ', spiderfyOnMaxZoom: true, showCoverageOnHover: false, '
  + 'disableClusteringAtZoom: ' + CLUSTER_OFF_ZOOM + ', zoomToBoundsOnClick: true, removeOutsideVisibleBounds: true, '
  + 'spiderLegPolylineOptions: { weight: 1.5, color: "#12B5A5", opacity: 0.6 }, '
  + 'iconCreateFunction: function (c) { var n = c.getChildCount(); var T = ' + JSON.stringify(CLUSTER_TIERS.map(t => ({ max: t.max === Infinity ? null : t.max, size: t.size, cls: t.cls }))) + '; '
  + 'var t = T[T.length - 1]; for (var i = 0; i < T.length; i++) { if (T[i].max === null || n < T[i].max) { t = T[i]; break; } } '
  + 'return L.divIcon({ html: "<span>" + n + "</span>", className: "marker-cluster amo-cluster amo-cluster-" + t.cls, iconSize: [t.size, t.size] }); }'
  + '}';
// Same options for the DOM path.
function clusterOptions(L: any) {
  return {
    maxClusterRadius: CLUSTER_RADIUS,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    disableClusteringAtZoom: CLUSTER_OFF_ZOOM,
    zoomToBoundsOnClick: true,
    removeOutsideVisibleBounds: true,
    spiderLegPolylineOptions: { weight: 1.5, color: '#12B5A5', opacity: 0.6 },
    iconCreateFunction: (c: any) => {
      const n: number = c.getChildCount();
      const t = clusterTier(n);
      return L.divIcon({ html: `<span>${n}</span>`, className: `marker-cluster amo-cluster amo-cluster-${t.cls}`, iconSize: [t.size, t.size] });
    },
  };
}

// Tourist-zone shading (soft, labeled, never a safety claim). Off by default —
// exposed as a toggle in the ⋯ sheet on both platforms.
const ZONES: Array<[string, [number, number], [number, number]]> = [
  ['Centro Histórico', [10.418, -75.555], [10.435, -75.535]],
  ['Bocagrande', [10.395, -75.560], [10.415, -75.545]],
  ['Getsemaní', [10.410, -75.545], [10.420, -75.530]],
  ['Castillogrande', [10.390, -75.560], [10.405, -75.555]],
  ['Manga', [10.405, -75.535], [10.420, -75.525]],
];
const ZONE_RECT_OPTS = { color: COLORS.icon, weight: 1, opacity: 0.35, fillColor: COLORS.icon, fillOpacity: 0.05, interactive: false };
const ZONE_LEGEND_CSS = 'background:rgba(5,8,20,0.85);color:' + COLORS.icon + ';font:600 10px sans-serif;padding:4px 8px;border-radius:10px;border:1px solid rgba(174,182,196,0.4)';

const FILTERS = [
  { key: 'all', label: 'Todos', icon: 'grid', color: '#12B5A5' },
  { key: 'pasaporte', label: 'Pasaporte', icon: 'ribbon', color: COLORS.mustard },
  { key: 'venue', label: 'Venues', icon: 'location', color: '#3B82F6' },
  { key: 'partner', label: 'Partners', icon: 'diamond', color: '#8B5CF6' },
  { key: 'esenciales', label: 'Esenciales', icon: 'medkit', color: '#14B8A6' },
  { key: 'concert', label: 'Conciertos', icon: 'musical-notes', color: '#EC4899' },
];

const GOLD = COLORS.mustard; // passport pins — distinct gold accent, never teal

const fmtLiveDist = fmtDistance;

// Marker color per place: delegates to the app's shared colorForKey() spectrum
// (src/constants/theme.ts) instead of a parallel hardcoded table — that old table
// had `club: '#12B5A5'`, reusing the reserved primary teal for a content category.
// colorForKey() falls back gracefully (deterministic spectrum hash) for any
// type/category not explicitly assigned a color.
function markerColor(p: Place): string {
  return colorForKey(p.type || p.category);
}

// HTML-entity escape for text interpolated into popup HTML (both the web DOM
// popups and the native WebView document). Partner-submitted fields — name,
// description, address — are free text from business signup; stripping quotes
// alone leaves <img onerror=...> stored-XSS open in every user's map.
function escHtml(v: string): string {
  return String(v || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// WebView→native messages come from a javaScriptEnabled document that renders
// partner-controlled text — never trust a path or id out of it blindly.
const SAFE_NAV_PATH = /^\/[A-Za-z0-9_\-/]*$/;

// "Ver detalle" target by place kind. Only partners have a detail page and
// concerts have the concerts screen; venues / essentials (hospitals, ess_*) have
// none — linking them to /partner/<id> was a "No encontrado" dead end.
function detailPath(p: { id: string; category: string; type: string }): string | null {
  const id = (p.id || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!id) return null;
  if (p.category === 'concert') return '/concerts';
  if (p.category === 'partner' && p.type !== 'essential' && !id.startsWith('ess_')) return `/partner/${id}`;
  return null;
}
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

// Tour timing: flyTo flight time + dwell at each stop (seconds / ms).
const TOUR_FLIGHT_S = 2.2;
const TOUR_STEP_MS = 4200;

// Virtual-walk timing: one leg glides over WALK_LEG_MS in WALK_TICKS steps,
// with a short dwell at each arrival for the venue tease popup. 50 ticks
// (80ms) because the dot now follows real street polylines — at 20 ticks it
// visibly cut corners between frames.
const WALK_LEG_MS = 4000;
const WALK_TICKS = 50;
const WALK_DWELL_MS = 1100;
// Walk router assets. Relative on the web build (same origin); the WebView
// document is generated inline, so it must load them from production.
const WALK_ROUTER_ORIGIN = 'https://www.amocartagena.co';
const WALK_ROUTER_JS = '/walk-router.js';
const WALK_GRAPH_JSON = '/data/walkgraph.json';

// ── CAMINAR: real walking routes through the catalog ──
const WALK_M_PER_MIN = 76.7; // 4.6 km/h — same constant the router uses
const RUTA_ARRIVE_M = 40; // within this of the next stop = arrived, advance
const MAX_RUTA_STOPS = 8;

type RutaStop = { name: string; lat: number; lng: number; id?: string };
type ActiveRuta = {
  title: string;
  stops: RutaStop[];
  // null origin = route starts at the first stop; set = route starts at the
  // user (in Cartagena) or a labeled fallback anchor for remote planning.
  origin: { lat: number; lng: number; label: string } | null;
};
type RutaSummary = { meters: number; minutes: number };

function fmtRutaDist(m: number): string {
  return m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`;
}

// Shared loader for the web render path: one script tag, one graph fetch,
// concurrent callers coalesce. Resolves the router or null (blocked CDN /
// offline) — callers treat null as "fall back to straight lines".
let walkRouterPromise: Promise<any> | null = null;
function ensureWalkRouter(): Promise<any> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  if (!walkRouterPromise) {
    walkRouterPromise = new Promise<any>((resolve) => {
      const w = window as any;
      const loadGraph = () =>
        w.AmoWalkRouter.load(WALK_GRAPH_JSON).then(() => resolve(w.AmoWalkRouter)).catch(() => resolve(null));
      if (w.AmoWalkRouter) { loadGraph(); return; }
      // A previous attempt may have left a dead tag (error already fired,
      // listeners would never re-fire) — always start from a fresh element.
      document.querySelector('#amo-walk-router')?.remove();
      const s = document.createElement('script');
      s.id = 'amo-walk-router';
      s.src = WALK_ROUTER_JS;
      s.onload = () => { w.AmoWalkRouter ? loadGraph() : resolve(null); };
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    }).then((r) => {
      if (!r) walkRouterPromise = null; // failed — let a later tap retry
      return r;
    });
  }
  return walkRouterPromise;
}

// Stop ordering for custom rutas: nearest-neighbor from the origin, then
// 2-opt until stable. Pure geometry (no graph), duplicated from the router's
// orderStops so the NATIVE side — which has no window.AmoWalkRouter — orders
// stops identically to what the map document draws.
function orderRutaStops(origin: { lat: number; lng: number }, stops: RutaStop[]): RutaStop[] {
  if (stops.length < 3) return stops.slice();
  const rest = stops.slice();
  const out: RutaStop[] = [];
  let cur = { lat: origin.lat, lng: origin.lng };
  while (rest.length) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < rest.length; i++) {
      const d = haversineM(cur.lat, cur.lng, rest[i].lat, rest[i].lng);
      if (d < bd) { bd = d; bi = i; }
    }
    const nx = rest.splice(bi, 1)[0];
    out.push(nx);
    cur = { lat: nx.lat, lng: nx.lng };
  }
  const pt = (i: number) => (i < 0 ? origin : out[i]);
  const segd = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => haversineM(a.lat, a.lng, b.lat, b.lng);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = -1; i < out.length - 2; i++) {
      for (let j = i + 1; j < out.length - 1; j++) {
        const before = segd(pt(i), pt(i + 1)) + segd(pt(j), pt(j + 1));
        const after = segd(pt(i), pt(j)) + segd(pt(i + 1), pt(j + 1));
        if (after + 1 < before) {
          const seg = out.slice(i + 1, j + 1).reverse();
          out.splice(i + 1, seg.length, ...seg);
          improved = true;
        }
      }
    }
  }
  return out;
}

function buildMapHTML(places: Place[], filter: string, userLoc: { lat: number; lng: number } | null, satellite: boolean, autoTour: boolean, autoWalk: boolean, route: { origin: { lat: number; lng: number } | null; stops: RutaStop[] } | null, zones: boolean, tr: (es: string) => string) {
  const filtered = filter === 'all' ? places
    : filter === 'esenciales' ? places.filter(p => p.type === 'service' || p.type === 'essential')
    : places.filter(p => p.category === filter);

  const markers = filtered.map(p => {
    const color = markerColor(p);
    const isVerified = !!p.verified;
    const safeName = escHtml(p.name || '');
    const safeDesc = escHtml((p.extra || p.description || '').substring(0, 80));
    const safeAddr = escHtml(p.address || '');
    const safePrice = escHtml(p.price || '');

    const priceHtml = safePrice ? '<span style="font-size:12px;color:' + COLORS.mustard + ';font-weight:700;">' + safePrice + '</span><br>' : '';
    const verifiedHtml = isVerified ? '<span style="font-size:10px;color:#12B5A5;font-weight:800;">✓ ' + escHtml(tr('UBICACIÓN VERIFICADA')) + '</span><br>' : '';

    // Caminar action: id + coords only (name resolved RN-side from places —
    // names contain spaces, which break unquoted inline onclick attributes).
    // id is charset-clamped: it rides inside an inline onclick JS string.
    const safeId = (p.id || '').replace(/[^A-Za-z0-9_-]/g, '');
    // Quoted attributes: the popup is JSON-encoded (jsString) now, so the old
    // unquoted/underscore form (padding:6px_12px, return_false) isn't needed —
    // it dropped the button padding and threw in every onclick.
    const post = (msg: string) => 'window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(' + msg + '));return false;';
    const caminarBtn = '<a href="#" style="display:inline-block;padding:6px 12px;background:rgba(201,168,76,0.15);color:#C9A84C;text-decoration:none;border-radius:20px;font-size:12px;font-weight:700;border:1px solid rgba(201,168,76,0.35)" onclick="' + post("{type:'caminar',id:'" + safeId + "',lat:" + p.lat + ",lng:" + p.lng + "}") + '">🚶 ' + escHtml(tr('Caminar')) + '</a>';

    const detailUrl = detailPath(p);
    const detailBtn = detailUrl
      ? '<a href="#" style="display:inline-block;padding:6px 14px;background:#12B5A5;color:#fff;text-decoration:none;border-radius:20px;font-size:12px;font-weight:600" onclick="' + post("{type:'navigate',path:'" + detailUrl + "'}") + '">' + escHtml(tr('Ver detalle')) + ' →</a>'
      : '';
    const popupContent = '<div style=font-family:sans-serif;min-width:180px>'
      + '<div style=display:flex;align-items:center;gap:6px;margin-bottom:6px>'
      + '<div style=width:10px;height:10px;border-radius:50%;background:' + color + ';flex-shrink:0></div>'
      + '<span style=font-size:10px;color:' + color + ';text-transform:uppercase;font-weight:700>' + p.type + '</span>'
      + '</div>'
      + '<b style=font-size:15px;color:' + COLORS.textMain + '>' + safeName + '</b><br>'
      + verifiedHtml
      + '<span style=font-size:11px;color:' + COLORS.textMuted + '>' + safeDesc + '</span><br>'
      + '<span style=font-size:11px;color:' + COLORS.textMuted + '>📍 ' + safeAddr + '</span><br>'
      + priceHtml
      + '<div style=display:flex;gap:6px;margin-top:6px;flex-wrap:wrap>'
      + detailBtn
      + caminarBtn
      + '<a href="#" style="display:inline-block;padding:6px 14px;background:rgba(255,255,255,0.08);color:' + COLORS.textMain + ';text-decoration:none;border-radius:20px;font-size:12px;font-weight:600;border:1px solid rgba(255,255,255,0.08)" onclick="' + post("{type:'openMaps',lat:" + p.lat + ",lng:" + p.lng + "}") + '">📍 ' + escHtml(tr('Mapa')) + '</a>'
      + '</div>'
      + '</div>';

    // Verified pins: precision halo ring (zoom-gated layer) + slightly heavier marker.
    const halo = isVerified
      ? "L.circleMarker([" + p.lat + ", " + p.lng + "], {radius: 16, fill: false, color: '#12B5A5', weight: 1.5, dashArray: '2 4', opacity: 0.9, interactive: false}).addTo(haloLayer);\n"
      : '';
    return halo + "L.circleMarker([" + p.lat + ", " + p.lng + "], {"
      + "radius: " + (isVerified ? 11 : 10) + ", fillColor: '" + color + "', color: '#fff', weight: " + (isVerified ? 3 : 2) + ", opacity: 1, fillOpacity: 0.9"
      + "}).addTo(venueLayer).bindPopup(" + jsString(popupContent) + ", {maxWidth: 260});";
  }).join('\n');

  // Venue pins go into a cluster group when the plugin loaded (script tag
  // failed/blocked ⇒ plain layerGroup: the unclustered map of before, never a
  // blank one). Pins are added BEFORE the group joins the map so 869 adds are
  // one clustering pass. User dot, tour/walk/ruta layers stay outside.
  const layersDecl = 'var venueLayer = (typeof L.markerClusterGroup === "function") ? L.markerClusterGroup(' + CLUSTER_OPTS_JS + ') : L.layerGroup();\n'
    + 'var haloLayer = L.layerGroup();\n';
  const layersMount = '\nvenueLayer.addTo(map);\n'
    + 'function __amoSyncHalos() { var on = map.getZoom() >= ' + HALO_MIN_ZOOM + '; if (on && !map.hasLayer(haloLayer)) haloLayer.addTo(map); else if (!on && map.hasLayer(haloLayer)) map.removeLayer(haloLayer); }\n'
    + 'map.on("zoomend", __amoSyncHalos); __amoSyncHalos();\n';

  // Tourist-zone shading + legend (⋯ sheet toggle). Legend sits under the zoom
  // control (top-left) — bottom-left is Luna's FAB on this screen.
  const zonesJs = zones
    ? 'var ZONES = ' + JSON.stringify(ZONES) + ';'
      + 'ZONES.forEach(function (z) { L.rectangle([z[1], z[2]], ' + JSON.stringify(ZONE_RECT_OPTS) + ').addTo(map); });'
      + 'var __amoLegend = L.control({ position: "topleft" });'
      + '__amoLegend.onAdd = function () { var d = document.createElement("div"); d.style.cssText = ' + jsString(ZONE_LEGEND_CSS) + '; d.textContent = ' + jsString(tr('Zonas turísticas principales')) + '; return d; };'
      + '__amoLegend.addTo(map);'
    : '';

  // User location: pulsing blue dot — only recenter if INSIDE Cartagena
  const userMarker = userLoc ? `
    var userIcon = L.divIcon({
      className: 'user-pulse-icon',
      html: '<div class="pulse-ring"></div><div class="pulse-dot"></div>',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    var __amoUser = L.marker([${userLoc.lat}, ${userLoc.lng}], {icon: userIcon, zIndexOffset: 1000})
      .addTo(map)
      .bindPopup('<b style="color:${COLORS.textMain}">📍 ${escHtml(tr('Tu ubicación')).replace(/'/g, '&#39;')}</b>');
    window.__amoMoveUser = function (lat, lng, pan) { __amoUser.setLatLng([lat, lng]); if (pan) map.panTo([lat, lng]); };
    ${isInCartagena(userLoc.lat, userLoc.lng) ? `map.setView([${userLoc.lat}, ${userLoc.lng}], 14);` : '/* User outside Cartagena — keep default center */'}
  ` : '';

  return '<!DOCTYPE html><html><head>'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">'
    + '<link rel="stylesheet" href="' + LEAFLET_CSS + '" />'
    + '<script src="' + LEAFLET_JS + '"><\/script>'
    // Marker clustering — loaded exactly like Leaflet itself; a failed tag
    // leaves L.markerClusterGroup undefined and the pins render unclustered.
    + '<link rel="stylesheet" href="' + MC_CSS + '" />'
    + '<script src="' + MC_JS + '"><\/script>'
    // Street router for the virtual walk — the WebView document is generated
    // inline, so it loads the shared router from the production origin. If it
    // fails (offline), window.AmoWalkRouter stays undefined and every leg
    // falls back to the v1 straight glide.
    + '<script src="' + WALK_ROUTER_ORIGIN + WALK_ROUTER_JS + '"><\/script>'
    + '<style>'
    + '* { margin: 0; padding: 0; box-sizing: border-box; }'
    + 'body { background: ' + COLORS.background + '; }'
    + '#map { width: 100vw; height: 100vh; }'
    + '.leaflet-popup-content-wrapper { background: ' + COLORS.surface + '; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); }'
    + '.leaflet-popup-tip { display: none; }'
    + '.leaflet-control-zoom { border: none !important; }'
    + '.leaflet-control-zoom a { background: ' + COLORS.surface + ' !important; color: ' + COLORS.icon + ' !important; border: 1px solid ' + COLORS.surfaceAlt + ' !important; font-weight: 700; }'
    + '.leaflet-control-zoom a:hover { background: ' + COLORS.surfaceAlt + ' !important; }'
    + '.leaflet-control-attribution { background: rgba(5,8,20,0.55); color: ' + COLORS.textFaint + '; font-size: 9px; padding: 1px 5px; }'
    + '.user-pulse-icon { position: relative; width: 22px; height: 22px; }'
    + '.pulse-dot { position: absolute; top: 4px; left: 4px; width: 14px; height: 14px; border-radius: 50%; background: #2563EB; border: 2px solid #fff; box-shadow: 0 0 6px rgba(37,99,235,0.7); z-index: 2; }'
    + '.pulse-ring { position: absolute; top: 0; left: 0; width: 22px; height: 22px; border-radius: 50%; background: rgba(37,99,235,0.25); animation: pulse 1.6s ease-out infinite; z-index: 1; }'
    + '@keyframes pulse { 0% { transform: scale(0.6); opacity: 1; } 100% { transform: scale(2.4); opacity: 0; } }'
    + '.dark-tiles { filter: invert(1) hue-rotate(180deg) brightness(0.7) saturate(1.5) contrast(1.1); }'
    + CLUSTER_CSS
    + '</style>'
    + '</head><body>'
    + '<div id="map"></div>'
    + '<script>'
    + 'var map = L.map("map", {zoomControl: true, attributionControl: false, zoomSnap: ' + (autoTour ? 0 : 1) + '}).setView([10.4236, -75.5483], 13);'
    + 'L.tileLayer("' + (satellite ? TILE_SAT.url : TILE_DARK.url) + '", {maxNativeZoom: ' + (satellite ? TILE_SAT.maxNativeZoom : TILE_DARK.maxNativeZoom) + ', maxZoom: 19, attribution: "Esri"}).addTo(map);'
    + layersDecl
    + markers
    + layersMount
    + zonesJs
    + userMarker
    // Atlas fly-through: chained flyTo over the exported camera route.
    + 'var TOUR = ' + JSON.stringify(ATLAS_ROUTE) + ';'
    + 'var tourTimer = null;'
    + 'window.__amoTour = function() {'
    + '  var i = 0;'
    + '  var fly = function() {'
    + '    if (i >= TOUR.length) { tourTimer = null; window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type: "tourEnd"})); return; }'
    + '    var v = TOUR[i];'
    + '    map.flyTo([v.lat, v.lng], v.zoom, {duration: ' + TOUR_FLIGHT_S + '});'
    + '    setTimeout(function() {'
    + '      L.popup({closeButton: false, autoClose: true})'
    + '        .setLatLng([v.lat, v.lng]).setContent("<b style=\\"color:' + COLORS.textMain + '\\">" + v.title + "</b>").openOn(map);'
    + '    }, ' + Math.round(TOUR_FLIGHT_S * 1000) + ');'
    + '    i += 1;'
    + '    tourTimer = setTimeout(fly, ' + TOUR_STEP_MS + ');'
    + '  };'
    + '  fly();'
    + '};'
    + 'window.__amoTourStop = function() { if (tourTimer) { clearTimeout(tourTimer); tourTimer = null; } map.closePopup(); };'
    + (autoTour ? 'setTimeout(function() { window.__amoTour(); }, 600);' : '')
    // Virtual walk: gold "virtual you" dot glides between verified waypoints;
    // at each arrival, tease the nearest catalog venue within 150m.
    + 'var WALK = ' + JSON.stringify(ATLAS_WALK) + ';'
    + 'var PTS = ' + JSON.stringify(filtered.filter(p => p.lat && p.lng).map(p => [p.lat, p.lng, (p.name || '').replace(/["'<>]/g, '')])) + ';'
    + 'var walkTimers = []; var walkMarker = null; var walkTrail = [];'
    + 'function _wd(a, b, c, d) { var R = 6371000, dl = (c - a) * Math.PI / 180, dg = (d - b) * Math.PI / 180; var x = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(dg / 2) * Math.sin(dg / 2); return 2 * R * Math.asin(Math.sqrt(x)); }'
    + 'function _nearest(lat, lng) { var best = null, bd = 151; for (var i = 0; i < PTS.length; i++) { var d = _wd(lat, lng, PTS[i][0], PTS[i][1]); if (d < bd) { bd = d; best = [PTS[i][0], PTS[i][1], PTS[i][2], Math.round(d)]; } } return best; }'
    + 'window.__amoWalkStop = function() { walkTimers.forEach(function(t) { clearTimeout(t); clearInterval(t); }); walkTimers = []; if (walkMarker) { map.removeLayer(walkMarker); walkMarker = null; } walkTrail.forEach(function(p) { map.removeLayer(p); }); walkTrail = []; map.closePopup(); };'
    + 'window.__amoWalk = function() {'
    + '  window.__amoWalkStop();'
    // 400KB graph loads only when a walk starts (idempotent); early legs
    // glide straight until it's ready, later legs pick up the streets.
    + '  if (window.AmoWalkRouter) AmoWalkRouter.load("' + WALK_ROUTER_ORIGIN + WALK_GRAPH_JSON + '").catch(function() {});'
    + '  var gi = L.divIcon({ className: "", html: \'<div style="position:relative;width:22px;height:22px"><div style="position:absolute;top:0;left:0;width:22px;height:22px;border-radius:50%;background:rgba(201,168,76,0.3);animation:pulse 1.6s ease-out infinite"></div><div style="position:absolute;top:4px;left:4px;width:14px;height:14px;border-radius:50%;background:#C9A84C;border:2px solid #fff;box-shadow:0 0 6px rgba(201,168,76,0.8)"></div></div>\', iconSize: [22, 22], iconAnchor: [11, 11] });'
    + '  walkMarker = L.marker([WALK[0].lat, WALK[0].lng], { icon: gi, zIndexOffset: 1200 }).addTo(map);'
    + '  map.flyTo([WALK[0].lat, WALK[0].lng], 18, { duration: 1.5 });'
    + '  walkTimers.push(setTimeout(function() { L.popup({closeButton: false, autoClose: true}).setLatLng([WALK[0].lat, WALK[0].lng]).setContent("🚶 <b style=\\"color:' + COLORS.textMain + '\\">' + escHtml(tr('Paseo virtual')) + ' — Centro Histórico</b>").openOn(map); }, 1500));'
    + '  var leg = 0;'
    + '  var nextLeg = function() {'
    + '    if (leg >= WALK.length - 1) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({type: "walkEnd"})); return; }'
    + '    var a = WALK[leg], b = WALK[leg + 1], t = 0;'
    + '    var R = window.AmoWalkRouter;'
    + '    var line = [[a.lat, a.lng], [b.lat, b.lng]];'
    + '    if (R && R.ready()) { var rr = R.route(line); if (rr && rr.line && rr.line.length > 1) line = rr.line; }'
    + '    var cum = R ? R.measure(line) : null;'
    + '    walkTrail.push(L.polyline(line, { color: "#C9A84C", weight: 3, opacity: 0.5, dashArray: "1 7", interactive: false }).addTo(map));'
    + '    var iv = setInterval(function() {'
    + '      t++;'
    + '      var f = t / ' + WALK_TICKS + ';'
    + '      var pt = cum ? R.pointAt(line, cum, f) : [a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f];'
    + '      var la = pt[0], lo = pt[1];'
    + '      if (walkMarker) walkMarker.setLatLng([la, lo]);'
    + '      if (t === ' + Math.floor(WALK_TICKS / 2) + ') map.panTo([la, lo]);'
    + '      if (t >= ' + WALK_TICKS + ') {'
    + '        clearInterval(iv);'
    + '        map.panTo([b.lat, b.lng]);'
    + '        var n = _nearest(b.lat, b.lng);'
    + '        if (n) L.popup({closeButton: false, autoClose: true}).setLatLng([n[0], n[1]]).setContent("🚶 <b style=\\"color:' + COLORS.textMain + '\\">" + n[2] + "</b> — a " + n[3] + "m").openOn(map);'
    + '        leg++;'
    + '        walkTimers.push(setTimeout(nextLeg, ' + WALK_DWELL_MS + '));'
    + '      }'
    + '    }, ' + Math.round(WALK_LEG_MS / WALK_TICKS) + ');'
    + '    walkTimers.push(iv);'
    + '  };'
    + '  walkTimers.push(setTimeout(nextLeg, 2200));'
    + '};'
    + (autoWalk ? 'setTimeout(function() { window.__amoWalk(); }, 600);' : '')
    // CAMINAR route: street polyline + numbered stops over the committed OSM
    // graph; straight segments if the router/graph can't load. Draw fires on
    // document boot when a route payload is present (the RN layer owns all
    // route state and rebuilds the document via the WebView key).
    + 'var ROUTE = ' + JSON.stringify(route) + ';'
    + 'var routeLayer = null;'
    + 'window.__amoRouteStop = function() { if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; } };'
    + 'window.__amoRouteDraw = function() {'
    + '  window.__amoRouteStop();'
    + '  if (!ROUTE || !ROUTE.stops || !ROUTE.stops.length) return;'
    + '  var pts = [];'
    + '  if (ROUTE.origin) pts.push([ROUTE.origin.lat, ROUTE.origin.lng]);'
    + '  ROUTE.stops.forEach(function(s) { pts.push([s.lat, s.lng]); });'
    + '  var line = pts, meters = 0, minutes = 0, R = window.AmoWalkRouter;'
    + '  if (R && R.ready() && pts.length > 1) { var rr = R.route(pts); if (rr && rr.line && rr.line.length > 1) { line = rr.line; meters = rr.meters; minutes = rr.minutes; } }'
    + '  if (!meters && pts.length > 1) { var sm = 0; for (var i = 0; i + 1 < pts.length; i++) sm += _wd(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]); meters = Math.round(sm); minutes = Math.max(1, Math.round(meters / ' + WALK_M_PER_MIN + ')); }'
    + '  routeLayer = L.layerGroup();'
    + '  if (line.length > 1) { L.polyline(line, { color: "#ffffff", weight: 7, opacity: 0.8, interactive: false }).addTo(routeLayer); L.polyline(line, { color: "#C9A84C", weight: 4, opacity: 0.95, interactive: false }).addTo(routeLayer); }'
    + '  ROUTE.stops.forEach(function(s, i) {'
    + '    var ic = L.divIcon({ className: "", html: \'<div style="width:26px;height:26px;border-radius:50%;background:#C9A84C;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;font:800 12px sans-serif;color:#241a04">\' + (i + 1) + \'</div>\', iconSize: [26, 26], iconAnchor: [13, 13] });'
    + '    L.marker([s.lat, s.lng], { icon: ic, zIndexOffset: 1100 }).addTo(routeLayer).bindPopup("<b style=\\"color:' + COLORS.textMain + '\\">" + (i + 1) + ". " + s.name + "</b>");'
    + '  });'
    + '  routeLayer.addTo(map);'
    + '  if (line.length > 1) map.fitBounds(L.latLngBounds(line), { padding: [40, 40] });'
    + '  else map.setView(pts[0], 17);'
    + '  window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: "routeSummary", meters: meters, minutes: minutes }));'
    + '};'
    + (route
      ? 'if (window.AmoWalkRouter) { AmoWalkRouter.load("' + WALK_ROUTER_ORIGIN + WALK_GRAPH_JSON + '").then(function() { window.__amoRouteDraw(); }).catch(function() { window.__amoRouteDraw(); }); } else { setTimeout(window.__amoRouteDraw, 300); }'
      : '')
    + '<\/script>'
    + '</body></html>';
}

// Cartagena bounding box — any location inside this box is "in Cartagena"
const CTG_BOUNDS = { latMin: 10.30, latMax: 10.50, lngMin: -75.62, lngMax: -75.45 };
const CTG_CENTER = { lat: 10.4236, lng: -75.5483 };

function isInCartagena(lat: number, lng: number): boolean {
  return lat >= CTG_BOUNDS.latMin && lat <= CTG_BOUNDS.latMax
      && lng >= CTG_BOUNDS.lngMin && lng <= CTG_BOUNDS.lngMax;
}

// Approximate Cartagena zone classifier (very rough)
function detectZone(lat: number, lng: number): string {
  if (lat >= 10.418 && lat <= 10.435 && lng >= -75.555 && lng <= -75.535) return 'centro_historico';
  if (lat >= 10.395 && lat <= 10.415 && lng >= -75.560 && lng <= -75.545) return 'bocagrande';
  if (lat >= 10.410 && lat <= 10.420 && lng >= -75.545 && lng <= -75.530) return 'getsemani';
  if (lat >= 10.390 && lat <= 10.405 && lng >= -75.560 && lng <= -75.555) return 'castillogrande';
  if (lat >= 10.405 && lat <= 10.420 && lng >= -75.535 && lng <= -75.525) return 'manga';
  if (lat >= 10.430 && lat <= 10.470 && lng >= -75.520 && lng <= -75.500) return 'aeropuerto_norte';
  if (lat <= 10.20 || lat >= 11.0) return 'fuera_cartagena';
  return 'cartagena_general';
}

/**
 * WebMapDirect — renders Leaflet directly into the DOM on web (no iframe/WebView).
 *
 * LIVE-TRACKING architecture: the map instance is created ONCE; marker layers
 * rebuild only when places/filter change; the user dot lives in its own layer
 * and is MOVED (never rebuilt) on every geo tick, so live position updates
 * are cheap and the map never flickers. Popups show real-time "a Xm de ti"
 * computed at open time from the latest position.
 */
function WebMapDirect({ places, filter, passportIds, userLoc, follow, satellite, zones, tourActive, onTourEnd, walkActive, onWalkEnd, onNavigate, ruta, onRutaSummary, onCaminarTap }: {
  places: Place[]; filter: string; passportIds: Set<string>;
  userLoc: { lat: number; lng: number } | null; follow: boolean; satellite: boolean; zones: boolean;
  tourActive: boolean; onTourEnd: () => void;
  walkActive: boolean; onWalkEnd: () => void;
  onNavigate: (path: string) => void;
  ruta: ActiveRuta | null;
  onRutaSummary: (s: RutaSummary) => void;
  onCaminarTap: (stop: RutaStop) => void;
}) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<any>(null);
  const markerLayerRef = useRef<any>(null);
  const haloLayerRef = useRef<any>(null);
  const zonesLayerRef = useRef<any>(null);
  const zonesLegendRef = useRef<any>(null);
  const baseLayerRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const userPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const followRef = useRef(follow);
  followRef.current = follow;
  const satelliteRef = useRef(satellite);
  satelliteRef.current = satellite;
  const tourActiveRef = useRef(tourActive);
  tourActiveRef.current = tourActive;
  const tourTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const walkActiveRef = useRef(walkActive);
  walkActiveRef.current = walkActive;
  const walkTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const walkMarkerRef = useRef<any>(null);
  const walkTrailRef = useRef<any[]>([]);
  const rutaLayerRef = useRef<any>(null);
  const placesRef = useRef(places);
  placesRef.current = places;
  // The map click listener binds ONCE in init — route callbacks live in refs
  // so a re-render can't leave the listener holding stale closures.
  const onCaminarTapRef = useRef(onCaminarTap);
  onCaminarTapRef.current = onCaminarTap;
  const onRutaSummaryRef = useRef(onRutaSummary);
  onRutaSummaryRef.current = onRutaSummary;

  // Swap the basemap in place (dark canvas ↔ satellite imagery) without
  // touching markers or view state.
  const applyBaseLayer = () => {
    const L = (window as any).L;
    const map = leafletRef.current;
    if (!L || !map) return;
    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
      baseLayerRef.current = null;
    }
    const t = satelliteRef.current ? TILE_SAT : TILE_DARK;
    baseLayerRef.current = L.tileLayer(t.url, {
      maxNativeZoom: t.maxNativeZoom, maxZoom: 19, attribution: 'Esri',
    }).addTo(map);
  };
  // Blocked CDN (hotel/VPN/ad-block networks — our tourists) means the script
  // never loads → permanently blank map with no signal. Surface a retry.
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  // Lets the tour effect re-fire once Leaflet finishes booting — a Play tap
  // during the CDN load window would otherwise be silently swallowed.
  const [mapReady, setMapReady] = useState(false);
  const tr = useTr();

  // Verified-pin halos only from street zoom (see HALO_MIN_ZOOM).
  const syncHalos = () => {
    const map = leafletRef.current;
    const halos = haloLayerRef.current;
    if (!map || !halos) return;
    const on = map.getZoom() >= HALO_MIN_ZOOM;
    if (on && !map.hasLayer(halos)) halos.addTo(map);
    else if (!on && map.hasLayer(halos)) map.removeLayer(halos);
  };

  // ── Map bootstrap: once (re-run on manual retry) ──
  useEffect(() => {
    if (typeof window === 'undefined' || !mapRef.current) return;
    setLoadFailed(false);
    const addCss = (href: string) => {
      if (document.querySelector(`link[href="${href}"]`)) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    };
    // Always a fresh tag: a dead one from an earlier failed attempt never
    // re-fires its listeners.
    const loadScript = (src: string, done: (ok: boolean) => void) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => done(true);
      script.onerror = () => done(false);
      document.head.appendChild(script);
    };
    addCss(LEAFLET_CSS);
    const init = () => {
      const L = (window as any).L;
      if (!L || !mapRef.current || leafletRef.current) return;
      const map = L.map(mapRef.current, { zoomControl: true, attributionControl: false, zoomSnap: 0 })
        .setView([10.4236, -75.5483], 13);
      leafletRef.current = map;
      // Keyless Esri basemaps (CARTO's rastertiles now require an API key and
      // return an "API KEY REQUIRED" watermark tile). Dark Gray canvas default,
      // World Imagery satellite on toggle — see TILE_DARK / TILE_SAT.
      applyBaseLayer();

      // Real-time distance injection when a popup opens
      map.on('popupopen', (e: any) => {
        try {
          const el = e.popup.getElement()?.querySelector('[data-dist]');
          const pos = userPosRef.current;
          if (el && pos) {
            const ll = e.popup.getLatLng();
            const d = haversineM(pos.lat, pos.lng, ll.lat, ll.lng);
            el.textContent = '🚶 ' + fmtLiveDist(d) + ' · ~' + Math.max(1, Math.round(d / WALK_M_PER_MIN)) + ' min';
            (el as HTMLElement).style.display = 'block';
          }
        } catch {}
      });

      mapRef.current.addEventListener('click', (e: MouseEvent) => {
        const cam = (e.target as HTMLElement).closest('[data-caminar]') as HTMLElement | null;
        if (cam) {
          e.preventDefault();
          const lat = Number(cam.getAttribute('data-lat'));
          const lng = Number(cam.getAttribute('data-lng'));
          const name = cam.getAttribute('data-name') || '';
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            map.closePopup();
            onCaminarTapRef.current({ id: cam.getAttribute('data-caminar') || undefined, name, lat, lng });
          }
          return;
        }
        const link = (e.target as HTMLElement).closest('[data-nav]') as HTMLElement | null;
        if (link) {
          e.preventDefault();
          const path = link.getAttribute('data-nav');
          if (path && SAFE_NAV_PATH.test(path)) onNavigate(path);
        }
      });

      if (!document.querySelector('#leaflet-pulse-css')) {
        const style = document.createElement('style');
        style.id = 'leaflet-pulse-css';
        style.textContent = `
          @keyframes pulse { 0% { transform: scale(0.6); opacity: 1; } 100% { transform: scale(2.4); opacity: 0; } }
          .dark-tiles { filter: invert(1) hue-rotate(180deg) brightness(0.7) saturate(1.5) contrast(1.1); }
          .leaflet-popup-content-wrapper { background: ${COLORS.surface} !important; border-radius: 12px !important; box-shadow: 0 4px 20px rgba(0,0,0,0.15) !important; }
          .leaflet-popup-tip { display: none !important; }
          .leaflet-control-zoom { border: none !important; }
          .leaflet-control-zoom a { background: ${COLORS.surface} !important; color: ${COLORS.icon} !important; border: 1px solid ${COLORS.surfaceAlt} !important; font-weight: 700; }
          .leaflet-control-attribution { background: rgba(5,8,20,0.55) !important; color: ${COLORS.textFaint} !important; font-size: 9px !important; padding: 1px 5px !important; }
          .leaflet-control-attribution a { color: ${COLORS.textMuted} !important; }
          ${CLUSTER_CSS}
        `;
        document.head.appendChild(style);
      }
      map.on('zoomend', syncHalos);

      renderMarkers();
      renderUser();
      setMapReady(true);
    };
    // Leaflet, then the cluster plugin (needs window.L). The plugin failing
    // is NOT fatal: init runs anyway and renderMarkers falls back to a plain
    // layerGroup. Only Leaflet itself failing shows the retry overlay.
    const withCluster = () => {
      const L = (window as any).L;
      if (L && typeof L.markerClusterGroup === 'function') { init(); return; }
      addCss(MC_CSS);
      loadScript(MC_JS, () => init());
    };
    if ((window as any).L) withCluster();
    else loadScript(LEAFLET_JS, (ok) => { if (ok) withCluster(); else setLoadFailed(true); });
    return () => {
      if (leafletRef.current) {
        leafletRef.current.remove();
        leafletRef.current = null;
        markerLayerRef.current = null;
        haloLayerRef.current = null;
        zonesLayerRef.current = null;
        zonesLegendRef.current = null;
        baseLayerRef.current = null;
        userMarkerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryTick]);

  // ── Tourist zones: soft shading + legend, toggled from the ⋯ sheet ──
  useEffect(() => {
    const L = (window as any).L;
    const map = leafletRef.current;
    if (!L || !map) return;
    if (zonesLayerRef.current) {
      map.removeLayer(zonesLayerRef.current);
      zonesLayerRef.current = null;
    }
    if (zonesLegendRef.current) {
      zonesLegendRef.current.remove();
      zonesLegendRef.current = null;
    }
    if (!zones) return;
    const layer = L.layerGroup();
    ZONES.forEach(([, sw, ne]) => {
      L.rectangle([sw, ne] as any, ZONE_RECT_OPTS).addTo(layer);
    });
    layer.addTo(map);
    zonesLayerRef.current = layer;
    // Legend stacks under the zoom control — bottom-left is Luna's FAB here.
    const legend = (L as any).control({ position: 'topleft' });
    legend.onAdd = () => {
      const div = document.createElement('div');
      div.style.cssText = ZONE_LEGEND_CSS;
      div.textContent = tr('Zonas turísticas principales');
      return div;
    };
    legend.addTo(map);
    zonesLegendRef.current = legend;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones, mapReady]);

  // ── Follow-me turned on: snap to the user now (ticks keep panning after) ──
  useEffect(() => {
    const map = leafletRef.current;
    const pos = userPosRef.current;
    if (!follow || !map || !pos || tourActiveRef.current || walkActiveRef.current) return;
    if (isInCartagena(pos.lat, pos.lng)) map.panTo([pos.lat, pos.lng], { animate: true });
  }, [follow]);

  // ── Basemap: swap in place on satellite toggle ──
  // Skips its first run per mount: init() already lays the base layer, and a
  // double call would waste a full round of tile requests + visible flicker.
  const satEffectMounted = useRef(false);
  useEffect(() => {
    if (!satEffectMounted.current) {
      satEffectMounted.current = true;
      return;
    }
    applyBaseLayer();
  }, [satellite]);

  // ── Atlas fly-through: chained flyTo over the exported camera route ──
  // zoomSnap is loosened to 0 ONLY while touring (the route uses fractional
  // zooms like 14.8/18.7); normal browsing keeps whole-number zoom so raster
  // tiles always render at native sharpness.
  useEffect(() => {
    const L = (window as any).L;
    const map = leafletRef.current;
    let popupTimer: ReturnType<typeof setTimeout> | null = null;
    const clear = () => {
      if (tourTimerRef.current) {
        clearTimeout(tourTimerRef.current);
        tourTimerRef.current = null;
      }
      if (popupTimer) {
        clearTimeout(popupTimer);
        popupTimer = null;
      }
    };
    if (!tourActive || !L || !map) {
      clear();
      if (map) {
        map.closePopup();
        map.options.zoomSnap = 1;
      }
      return;
    }
    map.options.zoomSnap = 0;
    let step = 0;
    const fly = () => {
      if (step >= ATLAS_ROUTE.length) {
        tourTimerRef.current = null;
        onTourEnd();
        return;
      }
      const v = ATLAS_ROUTE[step];
      map.flyTo([v.lat, v.lng], v.zoom, { duration: TOUR_FLIGHT_S });
      popupTimer = setTimeout(() => {
        if (!tourActiveRef.current || !leafletRef.current) return;
        L.popup({ closeButton: false, autoClose: true })
          .setLatLng([v.lat, v.lng])
          .setContent(`<b style="color:${COLORS.textMain}">${v.title}</b>`)
          .openOn(map);
      }, Math.round(TOUR_FLIGHT_S * 1000));
      step += 1;
      tourTimerRef.current = setTimeout(fly, TOUR_STEP_MS);
    };
    fly();
    return () => {
      clear();
      map.options.zoomSnap = 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourActive, mapReady]);

  // ── Virtual walk: gold "virtual you" walks the real streets between
  // verified waypoints (client-side A* over our committed OSM graph — keyless,
  // zero Google), teasing the nearest catalog venue at each arrival. If the
  // router/graph can't load, each leg silently falls back to the v1 straight
  // glide. Display-only — real passport stamps stay behind the server's 75m
  // real-GPS gate.
  useEffect(() => {
    const L = (window as any).L;
    const map = leafletRef.current;
    const clearAll = () => {
      walkTimersRef.current.forEach(t => { clearTimeout(t); clearInterval(t as any); });
      walkTimersRef.current = [];
      if (walkMarkerRef.current && leafletRef.current) {
        leafletRef.current.removeLayer(walkMarkerRef.current);
        walkMarkerRef.current = null;
      }
      walkTrailRef.current.forEach(p => { try { leafletRef.current?.removeLayer(p); } catch {} });
      walkTrailRef.current = [];
    };
    if (!walkActive || !L || !map) {
      clearAll();
      if (map) map.closePopup();
      return;
    }
    // Lazy-load router + 400KB graph only when a walk actually starts; the
    // 2.2s opening flyTo usually covers it. Legs that begin before the graph
    // is ready glide straight; later legs pick up the streets mid-walk.
    ensureWalkRouter();
    const gi = L.divIcon({
      className: '',
      html: '<div style="position:relative;width:22px;height:22px"><div style="position:absolute;top:0;left:0;width:22px;height:22px;border-radius:50%;background:rgba(201,168,76,0.3);animation:pulse 1.6s ease-out infinite"></div><div style="position:absolute;top:4px;left:4px;width:14px;height:14px;border-radius:50%;background:#C9A84C;border:2px solid #fff;box-shadow:0 0 6px rgba(201,168,76,0.8)"></div></div>',
      iconSize: [22, 22], iconAnchor: [11, 11],
    });
    walkMarkerRef.current = L.marker([ATLAS_WALK[0].lat, ATLAS_WALK[0].lng], { icon: gi, zIndexOffset: 1200 }).addTo(map);
    map.flyTo([ATLAS_WALK[0].lat, ATLAS_WALK[0].lng], 18, { duration: 1.5 });
    walkTimersRef.current.push(setTimeout(() => {
      if (!walkActiveRef.current || !leafletRef.current) return;
      L.popup({ closeButton: false, autoClose: true })
        .setLatLng([ATLAS_WALK[0].lat, ATLAS_WALK[0].lng])
        .setContent(`🚶 <b style="color:${COLORS.textMain}">${escHtml(tr('Paseo virtual'))} — Centro Histórico</b>`)
        .openOn(map);
    }, 1500));
    const nearest = (lat: number, lng: number) => {
      let best: { lat: number; lng: number; name: string; d: number } | null = null;
      for (const p of placesRef.current) {
        if (!p.lat || !p.lng) continue;
        const d = haversineM(lat, lng, p.lat, p.lng);
        if (d <= 150 && (!best || d < best.d)) {
          best = { lat: p.lat, lng: p.lng, name: (p.name || '').replace(/["'<>]/g, ''), d: Math.round(d) };
        }
      }
      return best;
    };
    let leg = 0;
    const nextLeg = () => {
      if (leg >= ATLAS_WALK.length - 1) {
        onWalkEnd();
        return;
      }
      const a = ATLAS_WALK[leg], b = ATLAS_WALK[leg + 1];
      const R = (window as any).AmoWalkRouter;
      let line: Array<[number, number]> = [[a.lat, a.lng], [b.lat, b.lng]];
      if (R && R.ready()) {
        const routed = R.route(line);
        if (routed && routed.line && routed.line.length > 1) line = routed.line;
      }
      const cum: number[] | null = R ? R.measure(line) : null;
      const pos = (f: number): [number, number] => (R && cum)
        ? R.pointAt(line, cum, f)
        : [a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f];
      const trail = L.polyline(line, { color: '#C9A84C', weight: 3, opacity: 0.5, dashArray: '1 7', interactive: false }).addTo(map);
      walkTrailRef.current.push(trail);
      let t = 0;
      const iv = setInterval(() => {
        t++;
        const f = t / WALK_TICKS;
        const [la, lo] = pos(f);
        if (walkMarkerRef.current) walkMarkerRef.current.setLatLng([la, lo]);
        if (t === Math.floor(WALK_TICKS / 2)) map.panTo([la, lo]);
        if (t >= WALK_TICKS) {
          clearInterval(iv);
          map.panTo([b.lat, b.lng]);
          const n = nearest(b.lat, b.lng);
          if (n) {
            L.popup({ closeButton: false, autoClose: true })
              .setLatLng([n.lat, n.lng])
              .setContent(`🚶 <b style="color:${COLORS.textMain}">${n.name}</b> — a ${n.d}m`)
              .openOn(map);
          }
          leg++;
          walkTimersRef.current.push(setTimeout(nextLeg, WALK_DWELL_MS));
        }
      }, Math.round(WALK_LEG_MS / WALK_TICKS));
      walkTimersRef.current.push(iv as any);
    };
    walkTimersRef.current.push(setTimeout(nextLeg, 2200));
    return clearAll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkActive, mapReady]);

  // ── CAMINAR route: street polyline + numbered stops over the committed OSM
  // graph. The RN layer owns route state (stops already ordered); this effect
  // only draws. Router unavailable => straight segments between stops — the
  // route still renders, the numbers stay honest (haversine sum).
  useEffect(() => {
    const L = (window as any).L;
    const map = leafletRef.current;
    const clear = () => {
      if (rutaLayerRef.current && leafletRef.current) {
        leafletRef.current.removeLayer(rutaLayerRef.current);
        rutaLayerRef.current = null;
      }
    };
    if (!ruta || !L || !map) {
      clear();
      return;
    }
    let cancelled = false;
    const draw = (R: any) => {
      if (cancelled || !leafletRef.current) return;
      clear();
      const pts: Array<[number, number]> = [
        ...(ruta.origin ? [[ruta.origin.lat, ruta.origin.lng] as [number, number]] : []),
        ...ruta.stops.map(s => [s.lat, s.lng] as [number, number]),
      ];
      let line = pts, meters = 0, minutes = 0;
      if (R && R.ready() && pts.length > 1) {
        const r = R.route(pts);
        if (r && r.line && r.line.length > 1) { line = r.line; meters = r.meters; minutes = r.minutes; }
      }
      if (!meters && pts.length > 1) {
        let sm = 0;
        for (let i = 0; i + 1 < pts.length; i++) sm += haversineM(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
        meters = Math.round(sm);
        minutes = Math.max(1, Math.round(meters / WALK_M_PER_MIN));
      }
      const layer = L.layerGroup();
      if (line.length > 1) {
        // White casing under the gold line — readable over satellite imagery.
        L.polyline(line, { color: '#ffffff', weight: 7, opacity: 0.8, interactive: false }).addTo(layer);
        L.polyline(line, { color: '#C9A84C', weight: 4, opacity: 0.95, interactive: false }).addTo(layer);
      }
      ruta.stops.forEach((s, i) => {
        const ic = L.divIcon({
          className: '',
          html: `<div style="width:26px;height:26px;border-radius:50%;background:#C9A84C;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;font:800 12px sans-serif;color:#241a04">${i + 1}</div>`,
          iconSize: [26, 26], iconAnchor: [13, 13],
        });
        L.marker([s.lat, s.lng], { icon: ic, zIndexOffset: 1100 }).addTo(layer)
          .bindPopup(`<b style="color:${COLORS.textMain}">${i + 1}. ${s.name.replace(/[<>]/g, '')}</b>`);
      });
      layer.addTo(map);
      rutaLayerRef.current = layer;
      if (line.length > 1) map.fitBounds(L.latLngBounds(line), { padding: [40, 40] });
      else map.setView(pts[0], 17);
      onRutaSummaryRef.current({ meters, minutes });
    };
    ensureWalkRouter().then(draw);
    return () => { cancelled = true; clear(); };
  }, [ruta, mapReady]);

  // ── Place markers: rebuild only when data/filter changes ──
  const renderMarkers = () => {
    const L = (window as any).L;
    const map = leafletRef.current;
    if (!L || !map) return;
    if (markerLayerRef.current) {
      map.removeLayer(markerLayerRef.current);
      markerLayerRef.current = null;
    }
    if (haloLayerRef.current) {
      if (map.hasLayer(haloLayerRef.current)) map.removeLayer(haloLayerRef.current);
      haloLayerRef.current = null;
    }
    // Cluster group when the plugin is present, plain group otherwise (same
    // unclustered map as before — never blank). Markers are collected and
    // added in one batch so the group clusters once, not 869 times.
    const clustered = typeof L.markerClusterGroup === 'function';
    const layer = clustered ? L.markerClusterGroup(clusterOptions(L)) : L.layerGroup();
    const halos = L.layerGroup();
    const pins: any[] = [];
    const filtered = filter === 'all' ? places
      : filter === 'pasaporte' ? places.filter(p => passportIds.has(p.id))
      : filter === 'esenciales' ? places.filter(p => p.type === 'service' || p.type === 'essential')
      : places.filter(p => p.category === filter);
    filtered.forEach(p => {
      if (!p.lat || !p.lng) return;
      const isPassport = passportIds.has(p.id);
      const isVerified = !!p.verified;
      const color = isPassport ? GOLD : markerColor(p);
      const safeName = escHtml(p.name || '');
      const safeDesc = escHtml((p.extra || p.description || '').substring(0, 80));
      const safeAddr = escHtml(p.address || '');
      const safeId = (p.id || '').replace(/[^A-Za-z0-9_-]/g, '');
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
      const priceHtml = p.price ? `<span style="font-size:12px;color:${COLORS.mustard};font-weight:700">${p.price}</span><br>` : '';
      const passportHtml = isPassport
        ? `<span style="font-size:10px;color:#8a6d1f;font-weight:800">🛂 ${escHtml(tr('SELLO DEL PASAPORTE'))}</span><br>`
        : '';
      const verifiedHtml = isVerified
        ? `<span style="font-size:10px;color:#12B5A5;font-weight:800">✓ ${escHtml(tr('UBICACIÓN VERIFICADA'))}</span><br>`
        : '';
      const popup = `<div style="font-family:sans-serif;min-width:180px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
          <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></div>
          <span style="font-size:10px;color:${color};text-transform:uppercase;font-weight:700">${isPassport ? 'pasaporte' : p.type}</span>
        </div>
        <b style="font-size:15px;color:${COLORS.textMain}">${safeName}</b><br>
        <span data-dist style="display:none;font-size:12px;color:#1a7f37;font-weight:700"></span>
        ${passportHtml}${verifiedHtml}
        <span style="font-size:11px;color:${COLORS.textMuted}">${safeDesc}</span><br>
        <span style="font-size:11px;color:${COLORS.textMuted}">📍 ${safeAddr}</span><br>
        ${priceHtml}
        <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
          ${detailPath(p) ? `<a href="#" data-nav="${detailPath(p)}" style="display:inline-block;padding:6px 14px;background:#12B5A5;color:#fff;text-decoration:none;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer">${escHtml(tr('Ver detalle'))} →</a>` : ''}
          <a href="#" data-caminar="${safeId}" data-lat="${p.lat}" data-lng="${p.lng}" data-name="${safeName}" style="display:inline-block;padding:6px 12px;background:rgba(201,168,76,0.15);color:#C9A84C;text-decoration:none;border-radius:20px;font-size:12px;font-weight:700;border:1px solid rgba(201,168,76,0.35);cursor:pointer">🚶 ${escHtml(tr('Caminar'))}</a>
          <a href="${mapsUrl}" target="_blank" style="display:inline-block;padding:6px 14px;background:rgba(255,255,255,0.08);color:${COLORS.textMain};text-decoration:none;border-radius:20px;font-size:12px;font-weight:600;border:1px solid rgba(255,255,255,0.08)">📍 ${escHtml(tr('Mapa'))}</a>
        </div>
      </div>`;
      if (isVerified) {
        // Precision halo under atlas-verified pins (zoom-gated layer — a
        // clustered halo would count as a pin and paint as a stray ring).
        L.circleMarker([p.lat, p.lng], {
          radius: 16, fill: false, color: '#12B5A5', weight: 1.5,
          dashArray: '2 4', opacity: 0.9, interactive: false,
        }).addTo(halos);
      }
      pins.push(L.circleMarker([p.lat, p.lng], {
        radius: isPassport || isVerified ? 11 : 10,
        fillColor: color,
        color: isPassport ? '#7a5c00' : '#fff',
        weight: isVerified ? 3 : 2, opacity: 1, fillOpacity: 0.92,
      }).bindPopup(popup, { maxWidth: 260 }));
    });
    if (clustered) layer.addLayers(pins);
    else pins.forEach(m => m.addTo(layer));
    layer.addTo(map);
    markerLayerRef.current = layer;
    haloLayerRef.current = halos;
    syncHalos();
  };
  useEffect(() => {
    renderMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, filter, passportIds]);

  // ── User dot: MOVED on every tick, never rebuilt ──
  const renderUser = () => {
    const L = (window as any).L;
    const map = leafletRef.current;
    if (!L || !map) return;
    userPosRef.current = userLoc;
    if (!userLoc) {
      if (userMarkerRef.current) {
        map.removeLayer(userMarkerRef.current);
        userMarkerRef.current = null;
      }
      return;
    }
    if (!userMarkerRef.current) {
      const userIcon = L.divIcon({
        className: 'user-pulse-icon',
        html: '<div style="position:relative;width:22px;height:22px"><div style="position:absolute;top:0;left:0;width:22px;height:22px;border-radius:50%;background:rgba(37,99,235,0.25);animation:pulse 1.6s ease-out infinite"></div><div style="position:absolute;top:4px;left:4px;width:14px;height:14px;border-radius:50%;background:#2563EB;border:2px solid #fff;box-shadow:0 0 6px rgba(37,99,235,0.7)"></div></div>',
        iconSize: [22, 22], iconAnchor: [11, 11],
      });
      userMarkerRef.current = L.marker([userLoc.lat, userLoc.lng], { icon: userIcon, zIndexOffset: 1000 })
        .addTo(map)
        .bindPopup('<b style="color:' + COLORS.textMain + '">📍 ' + escHtml(tr('Tu ubicación')) + '</b>');
      if (isInCartagena(userLoc.lat, userLoc.lng)) map.setView([userLoc.lat, userLoc.lng], 15);
    } else {
      userMarkerRef.current.setLatLng([userLoc.lat, userLoc.lng]);
      // Follow never fights the fly-through or virtual walk: they own the camera.
      if (followRef.current && !tourActiveRef.current && !walkActiveRef.current && isInCartagena(userLoc.lat, userLoc.lng)) {
        map.panTo([userLoc.lat, userLoc.lng], { animate: true });
      }
    }
  };
  useEffect(() => {
    renderUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLoc]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: COLORS.background }}>
      <div
        ref={mapRef as any}
        style={{ width: '100%', height: '100%', background: COLORS.background }}
      />
      {loadFailed && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 12, padding: 24, textAlign: 'center', background: COLORS.background,
        }}>
          <span style={{ color: COLORS.textMuted, fontFamily: 'sans-serif', fontSize: 14, maxWidth: 280 }}>
            {tr('No pudimos cargar el mapa')}
          </span>
          <button
            onClick={() => setRetryTick(t => t + 1)}
            style={{
              background: COLORS.primary, color: '#fff', border: 'none', borderRadius: 999,
              padding: '10px 22px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'sans-serif',
            }}
          >
            {tr('Reintentar')}
          </button>
        </div>
      )}
    </div>
  );
}

export default function MapaScreen() {
  const tr = useTr();
  const router = useRouter();
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locStatus, setLocStatus] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle');
  const [follow, setFollow] = useState(true);
  // Satellite is the DEFAULT view — real overhead imagery of every venue is
  // the whole point of the atlas layer; the dark canvas stays one tap away.
  const [satellite, setSatellite] = useState(true);
  const [tour, setTour] = useState(false);
  const [walk, setWalk] = useState(false); // virtual walk (out-of-city demo)
  const [passportIds, setPassportIds] = useState<Set<string>>(new Set());
  const [neighborhoods, setNeighborhoods] = useState<NbhCentroid[]>([]);
  const [nbhFilter, setNbhFilter] = useState<string | null>(null); // null = all barrios
  const [baseSheet, setBaseSheet] = useState(false);
  const [hasBase, setHasBase] = useState(false);
  // ⋯ sheet (filters, barrios, Mi Base, zones) — the right column keeps only
  // three primary FABs. Zone shading is opt-in from that sheet.
  const [moreOpen, setMoreOpen] = useState(false);
  const [zones, setZones] = useState(false);
  // ── CAMINAR: curated + custom walking routes over real streets ──
  const [caminarOpen, setCaminarOpen] = useState(false);
  const [building, setBuilding] = useState(false); // custom-ruta stop picking
  const [buildStops, setBuildStops] = useState<RutaStop[]>([]);
  const [ruta, setRuta] = useState<ActiveRuta | null>(null);
  const [rutaSummary, setRutaSummary] = useState<RutaSummary | null>(null);
  const [nextStopIdx, setNextStopIdx] = useState(0);
  const webViewRef = useRef<any>(null);
  // Native map: the user's position is baked into the WebView document ONCE
  // (first fix) and then moved in place via injected JS. Rebuilding the HTML per
  // GPS tick reloaded Leaflet + every pin every 5s while walking (and re-ran the
  // tour/walk autoplay).
  const [bakedLoc, setBakedLoc] = useState<{ lat: number; lng: number } | null>(null);
  const userLocRef = useRef<{ lat: number; lng: number } | null>(null);
  const moveNativeUser = useCallback((loc: { lat: number; lng: number }, pan = false) => {
    if (Platform.OS === 'web' || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return;
    webViewRef.current?.injectJavaScript(`window.__amoMoveUser && window.__amoMoveUser(${loc.lat}, ${loc.lng}, ${pan ? 'true' : 'false'}); true;`);
  }, []);
  useEffect(() => {
    userLocRef.current = userLoc;
    if (!userLoc) return;
    if (!bakedLoc) { setBakedLoc(userLoc); return; } // first fix → one document build
    // Follow-me parity with the web map: pan only in-city and never mid tour/walk.
    moveNativeUser(userLoc, follow && !tour && !walk && isInCartagena(userLoc.lat, userLoc.lng));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLoc]);

  // Reflect whether a home base is set (re-check when the sheet closes).
  useEffect(() => {
    setHasBase(!!getHomeBase());
    // On mount / after closing the sheet, reconcile with the account so the button
    // reflects a base saved on another device.
    if (!baseSheet) syncHomeBase().then(sb => setHasBase(!!sb)).catch(() => {});
  }, [baseSheet]);

  // Neighborhood centroids for the barrio filter (same source as Explore).
  useEffect(() => {
    fetch(ASSET_ORIGIN + '/data/neighborhoods.json')
      .then(r => (r.ok ? r.json() : []))
      .then((n) => Array.isArray(n) && setNeighborhoods(n))
      .catch(() => {});
  }, []);

  // ── LIVE tracking: geoService watch while the map is focused ──
  useEffect(() => {
    const unsub = geoService.subscribe((s) => {
      if (s.status === 'granted' && s.position) {
        setUserLoc({ lat: s.position.lat, lng: s.position.lng });
        setLocStatus('granted');
      }
    });
    geoService.syncPermission().then(() => {
      const s = geoService.getState();
      if (s.status === 'granted' && s.position) setUserLoc({ lat: s.position.lat, lng: s.position.lng });
    });
    return unsub;
  }, []);
  useFocusEffect(
    React.useCallback(() => {
      geoService.start();
      return () => geoService.stop();
    }, []),
  );

  // ── Passport venues (sabores ∪ plazas ∪ local gems) → gold on the map ──
  useEffect(() => {
    getCollections().then((cols) => {
      if (!cols) return;
      const ids = new Set<string>();
      for (const s of cols.sabores) for (const v of s.venues) ids.add(v.id);
      for (const p of cols.plazas) ids.add(p.id);
      getVenues().then((vs) => {
        for (const v of vs) if (v.tags.includes('local_favorite')) ids.add(v.id);
        setPassportIds(new Set(ids));
      }).catch(() => setPassportIds(new Set(ids)));
    }).catch(() => {});
  }, []);

  // CAMINAR arrival watcher — runs on BOTH platforms off the shared geo
  // stream. Only real in-city GPS advances progress; remote viewers just see
  // the plan. MUST live above the loading early-return with every other hook
  // (a hook after a conditional return = React #310, hooks-order crash).
  useEffect(() => {
    if (!ruta || !userLoc || !isInCartagena(userLoc.lat, userLoc.lng)) return;
    if (nextStopIdx >= ruta.stops.length) return;
    const s = ruta.stops[nextStopIdx];
    if (haversineM(userLoc.lat, userLoc.lng, s.lat, s.lng) <= RUTA_ARRIVE_M) {
      setNextStopIdx(i => i + 1);
    }
  }, [userLoc, ruta, nextStopIdx]);

  // ── `?walk=1` / `?walk=virtual` (Pasaporte's "Paseo virtual" CTA) ──
  // Auto-starts the virtual walk ONCE per arrival. The map itself waits: on web
  // the walk effect re-fires on mapReady, on native the document boots with
  // autoWalk — so setting state here is safe even while places still load.
  // The param is cleared right after so a tab re-focus does not restart it.
  const { walk: walkParam } = useLocalSearchParams<{ walk?: string }>();
  const walkParamRef = useRef<string | null>(null);
  useEffect(() => {
    const wanted = walkParam === '1' || walkParam === 'virtual';
    if (!wanted) { walkParamRef.current = null; return; }
    if (walkParamRef.current === walkParam) return;
    walkParamRef.current = walkParam;
    // Mutual exclusion with tour / ruta — inline (stopRuta lives below the
    // loading early-return and is not initialized on a loading render).
    setTour(false);
    setRuta(null);
    setRutaSummary(null);
    setNextStopIdx(0);
    setBuilding(false);
    setBuildStops([]);
    setCaminarOpen(false);
    setMoreOpen(false);
    if (Platform.OS !== 'web') webViewRef.current?.injectJavaScript('window.__amoRouteStop && window.__amoRouteStop(); true;');
    setSatellite(true);
    setWalk(true);
    router.setParams({ walk: undefined as any });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkParam]);

  // Request location permission and track ping → backend analytics
  const requestLocation = async () => {
    setLocStatus('requesting');
    try {
      // expo-location web fallback uses navigator.geolocation
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocStatus('denied');
        Alert.alert(
          tr('Permiso de ubicación'),
          tr('Activa el permiso para ver lugares cerca de ti y mejorar tus recomendaciones.'),
        );
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setUserLoc(loc);
      setLocStatus('granted');
      // hand off to the live watcher — the dot follows from here on
      geoService.syncPermission().then(() => geoService.start());
      // Send ping to backend for analytics + AI personalization
      try {
        const userRaw = await AsyncStorage.getItem('user_data');
        let user = null;
        try { if (userRaw) user = JSON.parse(userRaw); } catch { /* malformed stored user_data */ }
        const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
        if (!backendUrl) throw new Error('no backend');
        await fetch(`${backendUrl}/api/analytics/location`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: user?.user_id || null,
            lat: loc.lat,
            lng: loc.lng,
            accuracy: pos.coords.accuracy,
            zone: detectZone(loc.lat, loc.lng),
            context: 'map_open',
          }),
        });
      } catch (e) { console.warn('location ping failed', e); }
    } catch (e) {
      console.error(e);
      setLocStatus('denied');
    }
  };

  useEffect(() => {
    // Verified essentials pins (Google-Places-geocoded hospitals) — the seed
    // safety layer isn't in the partner catalog, so it needs its own pin source.
    let essentialsPins: any[] = [];
    const essToPlaces = (): Place[] => essentialsPins.map((e: any) => ({
      id: `ess_${e.place_id || e.name}`, name: e.name, description: e.note || '',
      category: 'partner', type: 'essential', address: e.note || '',
      lat: e.lat, lng: e.lng, image_url: '', price: '', link: '', extra: e.note || '',
    }));
    const buildPlaces = (rawVenues: any[], partners: any[], concerts: any[]): Place[] => {
      const allPlaces: Place[] = [];
      const seenNames = new Set<string>();

      // Atlas layer: verified coordinate fixes + missing atlas venues, applied
      // to EVERY merge (static + hydrate) so stale backend coords can't regress
      // pins. Fixing the venues array here also corrects concert inheritance.
      const venues = [
        ...rawVenues.map((v: any) => {
          const fix = ATLAS_VENUE_FIXES[v.venue_id];
          return fix
            ? {
                ...v,
                location: { ...(v.location || {}), lat: fix.lat, lng: fix.lng },
                ...(fix.address ? { address: fix.address } : {}),
              }
            : v;
        }),
        ...ATLAS_ADD_VENUES.filter(av => !rawVenues.some((v: any) => v.venue_id === av.venue_id)),
      ];

      venues.forEach((v: any) => {
        seenNames.add((v.name || '').toLowerCase());
        allPlaces.push({
          id: v.venue_id, name: v.name, description: v.description,
          category: 'venue', type: v.type, address: v.address,
          lat: v.location?.lat || 0, lng: v.location?.lng || 0,
          image_url: v.images?.[0] || '', price: v.price_range || '',
          link: v.booking_link || '', extra: '',
        });
      });

      const venueLocs: Record<string, { lat: number; lng: number }> = {};
      venues.forEach((v: any) => { venueLocs[v.venue_id] = v.location; });

      partners.forEach((p: any) => {
        if (!seenNames.has((p.name || '').toLowerCase()) && p.location) {
          allPlaces.push({
            id: p.partner_id, name: p.name, description: p.description,
            category: 'partner', type: p.category || 'partner', address: p.address,
            lat: p.location?.lat || 0, lng: p.location?.lng || 0,
            image_url: p.image_url || '', price: p.price_range || '',
            link: p.booking_link || '', extra: p.experience || '',
          });
        }
      });

      concerts.forEach((c: any) => {
        const loc = venueLocs[c.venue_id];
        if (loc) {
          const offset = (Math.random() - 0.5) * 0.002;
          allPlaces.push({
            id: c.concert_id, name: c.artist, description: c.title,
            category: 'concert', type: 'concert', address: c.venue_name,
            lat: loc.lat + offset, lng: loc.lng + offset,
            image_url: c.image_url || '',
            price: eventPriceLabel(c.price, c.is_free, { cop: true }),
            link: c.ticket_link || '', extra: `${c.genre} · ${c.start_time}`,
          });
        }
      });

      allPlaces.push(...essToPlaces());
      // Atlas-verified badge — ids whose position survived adversarial
      // OSM verification (docs/atlas-verification.json).
      for (const p of allPlaces) if (ATLAS_VERIFIED.has(p.id)) p.verified = true;
      return allPlaces.filter(p => p.lat !== 0);
    };

    const staticFetch = (file: string) =>
      fetch(`${ASSET_ORIGIN}/data/${file}.json`).then(r => r.ok ? r.json() : []).catch(() => []);

    // Static-first: paint partner markers immediately (fastest file),
    // then add venues + concerts as they arrive
    staticFetch('partners').then(sp => {
      if (Array.isArray(sp) && sp.length > 0) {
        setPlaces(buildPlaces([], sp, []));
        setLoading(false);
      }
    }).catch((e) => { console.error('[mapa]', e); setLoading(false); });

    // Venues + concerts arrive slightly later — merge in
    Promise.all([staticFetch('venues'), staticFetch('concerts')])
      .then(([sv, sc]) => {
        // Re-read current partners from the already-set state via a fresh fetch
        staticFetch('partners').then(sp => {
          if (Array.isArray(sp) && sp.length > 0) {
            setPlaces(buildPlaces(sv, sp, sc));
          }
          setLoading(false);
        }).catch((e) => { console.error('[mapa]', e); setLoading(false); });
      }).catch((e) => { console.error('[mapa]', e); setLoading(false); });

    // Hydrate from backend (non-blocking)
    Promise.all([
      api.get('/venues').catch(() => []),
      api.get('/partners').catch(() => []),
      api.get('/concerts').catch(() => []),
      api.get('/essentials/pins').catch(() => ({ pins: [] })),
    ]).then(([venues, partners, concerts, essRes]: any[]) => {
      essentialsPins = (essRes && essRes.pins) || [];
      if (Array.isArray(partners) && partners.length > 0) {
        setPlaces(buildPlaces(venues, partners, concerts));
      }
    }).catch((e) => { console.error('[mapa]', e); setLoading(false); });
    requestLocation();
  }, []);

  // Assign each place its nearest barrio once centroids load (memoized).
  const placesWithNbh = useMemo(() => {
    if (!neighborhoods.length) return places;
    // Name+address barrio first (reliable — many venues name their barrio),
    // centroid fallback. Corrects ~26% that nearest-centroid misplaces.
    return places.map(p => ({ ...p, neighborhood: venueBarrio(`${p.name} ${p.address || ''}`, p.lat, p.lng, neighborhoods) }));
  }, [places, neighborhoods]);

  // Barrio filter ANDs with the category filter: pins in the chosen barrio only.
  const visiblePlaces = useMemo(
    () => (nbhFilter ? placesWithNbh.filter(p => p.neighborhood === nbhFilter) : placesWithNbh),
    [placesWithNbh, nbhFilter],
  );

  // Barrios that actually have pins, with counts, ordered by count desc.
  const nbhChips = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of placesWithNbh) if (p.neighborhood) c[p.neighborhood] = (c[p.neighborhood] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([slug, n]) => ({ slug, n }));
  }, [placesWithNbh]);

  const counts = {
    all: visiblePlaces.length,
    pasaporte: visiblePlaces.filter(p => passportIds.has(p.id)).length,
    venue: visiblePlaces.filter(p => p.category === 'venue').length,
    partner: visiblePlaces.filter(p => p.category === 'partner').length,
    esenciales: visiblePlaces.filter(p => p.type === 'service' || p.type === 'essential').length,
    concert: visiblePlaces.filter(p => p.category === 'concert').length,
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={COLORS.icon} />
          <Text style={styles.loadingText}>{tr('Cargando mapa de Cartagena...')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // The tour is designed over satellite imagery — flying the dark canvas at
  // zoom 18-19 shows upscaled blur, so starting the tour turns satellite on.
  const startTour = () => {
    if (tour) {
      setTour(false);
      if (Platform.OS !== 'web') webViewRef.current?.injectJavaScript('window.__amoTourStop && window.__amoTourStop(); true;');
      return;
    }
    setWalk(false); // tour, virtual walk and caminar rutas are mutually exclusive
    stopRuta();
    setCaminarOpen(false);
    setSatellite(true);
    setTour(true);
  };

  // Virtual walk from the Caminar sheet — a camera demo, available from
  // anywhere (real passport stamps stay behind the server's GPS gate).
  const startVirtualWalk = () => {
    setTour(false);
    stopRuta();
    setCaminarOpen(false);
    setSatellite(true);
    setWalk(true);
  };

  // One stop for whatever experience owns the camera (tour / walk / ruta).
  const experienceActive = tour || walk || !!ruta || building;
  const stopExperience = () => {
    if (tour) {
      setTour(false);
      if (Platform.OS !== 'web') webViewRef.current?.injectJavaScript('window.__amoTourStop && window.__amoTourStop(); true;');
    }
    if (walk) {
      setWalk(false);
      if (Platform.OS !== 'web') webViewRef.current?.injectJavaScript('window.__amoWalkStop && window.__amoWalkStop(); true;');
    }
    if (ruta || building) stopRuta();
  };

  // Locate FAB: no permission yet → ask; granted → toggle follow-me (in-city
  // only pans; the toggle itself is honest either way — the dot is what it is).
  const canFollow = !!userLoc && isInCartagena(userLoc.lat, userLoc.lng);
  const following = follow && canFollow;
  const onLocatePress = () => {
    if (locStatus !== 'granted') { requestLocation(); return; }
    const next = !follow;
    setFollow(next);
    if (next && userLoc && Platform.OS !== 'web') moveNativeUser(userLoc, canFollow);
  };

  // ── CAMINAR handlers ──
  const inCity = !!userLoc && isInCartagena(userLoc.lat, userLoc.lng);

  const stopRuta = () => {
    setRuta(null);
    setRutaSummary(null);
    setNextStopIdx(0);
    setBuilding(false);
    setBuildStops([]);
    if (Platform.OS !== 'web') webViewRef.current?.injectJavaScript('window.__amoRouteStop && window.__amoRouteStop(); true;');
  };

  const startRuta = (title: string, stops: RutaStop[], keepOrder: boolean) => {
    if (!stops.length) return;
    setTour(false);
    setWalk(false);
    // Origin: the user when they're really in Cartagena; for remote planning a
    // single-stop walk anchors at Torre del Reloj (labeled — never pretend the
    // user is there), multi-stop rutas simply start at their first stop.
    let origin: ActiveRuta['origin'] = null;
    if (inCity && userLoc) origin = { lat: userLoc.lat, lng: userLoc.lng, label: tr('tu ubicación') };
    else if (stops.length === 1) origin = { lat: 10.423036, lng: -75.549219, label: 'Torre del Reloj' };
    // Curated rutas keep their authored sequence; custom rutas get the
    // shortest-walk ordering (nearest-neighbor + 2-opt).
    let ordered = stops;
    if (!keepOrder && stops.length >= 3) {
      ordered = origin ? orderRutaStops(origin, stops) : [stops[0], ...orderRutaStops(stops[0], stops.slice(1))];
    }
    setBuilding(false);
    setBuildStops([]);
    setCaminarOpen(false);
    setRutaSummary(null);
    setNextStopIdx(0);
    setRuta({ title, stops: ordered, origin });
  };

  const onCaminarTap = (stop: RutaStop) => {
    // Native popups pass only id+coords (names break unquoted onclick attrs) —
    // resolve the display name from the catalog, sanitized for popup HTML.
    const known = stop.id ? places.find(p => p.id === stop.id) : null;
    const name = (stop.name || known?.name || tr('Lugar')).replace(/["'<>]/g, '');
    const s: RutaStop = { ...stop, name };
    if (building) {
      setBuildStops(prev => {
        if (prev.length >= MAX_RUTA_STOPS) return prev;
        if (prev.some(x => (s.id && x.id === s.id) || (x.lat === s.lat && x.lng === s.lng))) return prev;
        return [...prev, s];
      });
      return;
    }
    startRuta(`${tr('Caminar a')} ${name}`, [s], true);
  };

  const startCustomRuta = () => {
    setCaminarOpen(false);
    setRuta(null);
    setRutaSummary(null);
    setNextStopIdx(0);
    setBuildStops([]);
    setBuilding(true);
  };

  // Honest remote context on the virtual-walk card: from afar, the walk is a
  // camera demo — say how far, never pretend the user is in the Centro.
  const kmAway = userLoc && !canFollow ? Math.round(haversineM(userLoc.lat, userLoc.lng, CTG_CENTER.lat, CTG_CENTER.lng) / 1000) : null;
  const walkCardSub = kmAway
    ? `${tr('Estás a')} ${kmAway.toLocaleString()} km · ${tr('recorre el Centro desde aquí')}`
    : tr('Un paseo guiado por calles reales del Centro Histórico');

  // Active filters → one dismissible pill over the map (top-right, clear of
  // Leaflet's zoom control); the full chip sets live in the ⋯ sheet.
  const activeFilter = FILTERS.find(f => f.key === filter && f.key !== 'all') || null;
  const filterPillLabel = [activeFilter ? tr(activeFilter.label) : '', nbhFilter ? (NBH_LABELS[nbhFilter] || nbhFilter) : ''].filter(Boolean).join(' · ');
  // Pins actually on the map = category count within the barrio-filtered set.
  const filterPillCount = counts[filter as keyof typeof counts] ?? counts.all;
  const filtersActive = !!activeFilter || !!nbhFilter;
  const clearFilters = () => { setFilter('all'); setNbhFilter(null); };
  const openMore = () => { setCaminarOpen(false); setMoreOpen(o => !o); };
  const openCaminar = () => { setMoreOpen(false); setCaminarOpen(o => !o); };

  // Native: the WebView document auto-runs the tour/walk/ruta when rebuilt with
  // the flag on (the key below includes all flags, so toggling rebuilds the
  // document). Ruta stop names are already sanitized in onCaminarTap.
  const rutaPayload = ruta
    ? { origin: ruta.origin ? { lat: ruta.origin.lat, lng: ruta.origin.lng } : null, stops: ruta.stops }
    : null;
  const html = buildMapHTML(visiblePlaces, filter, bakedLoc, satellite, tour, walk, rutaPayload, zones, tr);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Map — the chip bars moved into the ⋯ sheet; the map gets the full height */}
      <View style={styles.mapWrap}>
        {Platform.OS === 'web' ? (
          <WebMapDirect places={visiblePlaces} filter={filter} passportIds={passportIds} userLoc={userLoc} follow={follow} satellite={satellite} zones={zones} tourActive={tour} onTourEnd={() => setTour(false)} walkActive={walk} onWalkEnd={() => setWalk(false)} onNavigate={(path) => router.push(path as any)} ruta={ruta} onRutaSummary={setRutaSummary} onCaminarTap={onCaminarTap} />
        ) : (
          <WebView
            ref={webViewRef}
            key={filter + (nbhFilter || 'allnbh') + (bakedLoc ? '_u' : '') + (satellite ? '_sat' : '_dark') + (zones ? '_zones' : '') + (tour ? '_tour' : '') + (walk ? '_walk' : '') + (ruta ? `_ruta${ruta.title}_${ruta.stops.length}` : '')}
            source={{ html }}
            onLoadEnd={() => { if (userLocRef.current) moveNativeUser(userLocRef.current); }}
            style={styles.webview}
            javaScriptEnabled={true}
            originWhitelist={['*']}
            scrollEnabled={false}
            bounces={false}
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            onMessage={(e) => {
              try {
                const msg = JSON.parse(e.nativeEvent.data);
                if (msg.type === 'navigate' && typeof msg.path === 'string' && SAFE_NAV_PATH.test(msg.path)) {
                  router.push(msg.path as any);
                } else if (msg.type === 'tourEnd') {
                  // Native tour ran to completion inside the document — sync
                  // React state so the button resets and later key-driven
                  // rebuilds don't re-run autoTour.
                  setTour(false);
                } else if (msg.type === 'walkEnd') {
                  setWalk(false);
                } else if (msg.type === 'routeSummary' && Number.isFinite(msg.meters)) {
                  setRutaSummary({ meters: msg.meters, minutes: msg.minutes });
                } else if (msg.type === 'caminar' && Number.isFinite(msg.lat) && Number.isFinite(msg.lng)) {
                  onCaminarTap({ id: typeof msg.id === 'string' && SAFE_ID.test(msg.id) ? msg.id : undefined, name: '', lat: msg.lat, lng: msg.lng });
                } else if (msg.type === 'openMaps' && Number.isFinite(msg.lat) && Number.isFinite(msg.lng)) {
                  // Popup "📍 Mapa" tap → let iOS users pick Apple Maps or Google Maps (Guideline 4)
                  openDirections({ lat: msg.lat, lng: msg.lng }, tr);
                }
              } catch { /* non-JSON message — ignore */ }
            }}
          />
        )}

        {/* Active-filter pill — the only filter chrome in the default state */}
        {filtersActive && (
          <View style={styles.filterPill} testID="map-filter-pill">
            <Ionicons name={(activeFilter?.icon || 'map-outline') as any} size={13} color={activeFilter?.color || COLORS.primary} />
            <Text style={styles.filterPillText} numberOfLines={1}>{filterPillLabel} · {filterPillCount} {tr('lugares')}</Text>
            <TouchableOpacity
              onPress={clearFilters}
              style={styles.filterPillClear}
              accessibilityRole="button"
              accessibilityLabel={tr('Limpiar filtros')}
            >
              <Ionicons name="close" size={16} color={COLORS.textMain} />
            </TouchableOpacity>
          </View>
        )}

        {/* Tap-outside closes whichever sheet is open */}
        {(moreOpen || (caminarOpen && !experienceActive)) && (
          <Pressable style={styles.sheetBackdrop} onPress={() => { setMoreOpen(false); setCaminarOpen(false); }} accessibilityLabel={tr('Cerrar')} />
        )}

        {/* ── Right column: three primary FABs + ⋯ ── */}
        {/* ⋯ — filters, barrios, Mi Base, zones */}
        <TouchableOpacity
          style={[styles.locateBtn, { bottom: 192 }, moreOpen && styles.locateBtnActive]}
          onPress={openMore}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={tr('Más opciones')}
          testID="map-fab-more"
        >
          <Ionicons name="ellipsis-horizontal" size={22} color={moreOpen ? COLORS.white : COLORS.icon} />
          {filtersActive && !moreOpen && <View style={styles.fabDot} />}
        </TouchableOpacity>

        {/* Caminar — rutas, sobrevuelo, paseo virtual; becomes STOP while one runs */}
        <TouchableOpacity
          style={[styles.locateBtn, styles.caminarBtn, { bottom: 136 }, experienceActive && styles.caminarBtnActive]}
          onPress={() => (experienceActive ? stopExperience() : openCaminar())}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={experienceActive ? tr('Detener') : tr('Caminar Cartagena')}
          testID="map-fab-caminar"
        >
          <Ionicons name={experienceActive ? 'close' : 'footsteps'} size={19} color={experienceActive ? '#241a04' : '#C9A84C'} />
        </TouchableOpacity>

        {/* Satellite ⇄ dark canvas */}
        <TouchableOpacity
          style={[styles.locateBtn, { bottom: 80 }, satellite && styles.locateBtnActive]}
          onPress={() => setSatellite(s => !s)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={satellite ? tr('Mapa oscuro') : tr('Mapa satelital')}
          testID="map-fab-basemap"
        >
          <Ionicons name={satellite ? 'earth' : 'earth-outline'} size={19} color={satellite ? COLORS.white : COLORS.icon} />
        </TouchableOpacity>

        {/* Locate me / follow-me */}
        <TouchableOpacity
          style={[styles.locateBtn, following && styles.locateBtnActive]}
          onPress={onLocatePress}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={locStatus === 'granted' ? (follow ? tr('Dejar de seguir') : tr('Seguir mi ubicación')) : tr('Mi ubicación')}
          testID="map-fab-locate"
        >
          {locStatus === 'requesting' ? (
            <ActivityIndicator size="small" color={COLORS.icon} />
          ) : (
            <Ionicons
              name={locStatus === 'granted' ? (follow ? 'navigate' : 'navigate-outline') : 'locate'}
              size={20}
              color={following ? COLORS.white : locStatus === 'granted' ? COLORS.primary : COLORS.icon}
            />
          )}
        </TouchableOpacity>

        {/* ⋯ sheet — everything that is not a primary map action */}
        {moreOpen && (
          <View style={styles.moreSheet} testID="map-more-sheet">
            <View style={styles.caminarHeader}>
              <Text style={styles.caminarTitle}>{tr('Opciones del mapa')}</Text>
              <View style={styles.sheetHeaderActions}>
                {filtersActive && (
                  <TouchableOpacity onPress={clearFilters} style={styles.sheetTextBtn} accessibilityRole="button">
                    <Text style={styles.sheetTextBtnLabel}>{tr('Limpiar filtros')}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => setMoreOpen(false)} style={styles.sheetClose} accessibilityRole="button" accessibilityLabel={tr('Cerrar')}>
                  <Ionicons name="close" size={20} color={COLORS.textMuted} />
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView style={styles.moreScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetLabel}>{tr('Filtrar')}</Text>
              <View style={styles.chipWrap}>
                {FILTERS.map(f => {
                  const isActive = filter === f.key;
                  const count = counts[f.key as keyof typeof counts] || 0;
                  return (
                    <TouchableOpacity
                      key={f.key}
                      style={[styles.chip, isActive && { backgroundColor: `${f.color}20`, borderColor: f.color }]}
                      onPress={() => setFilter(f.key)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isActive }}
                    >
                      <Ionicons name={f.icon as any} size={14} color={isActive ? f.color : COLORS.textMuted} />
                      <Text style={[styles.chipText, isActive && { color: f.color }]}>{tr(f.label)}</Text>
                      <View style={[styles.chipCount, isActive && { backgroundColor: `${f.color}30` }]}>
                        <Text style={[styles.chipCountText, isActive && { color: f.color }]}>{count}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {nbhChips.length > 0 && (
                <>
                  <Text style={styles.sheetLabel}>{tr('Barrio')}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll} style={styles.nbhScroll}>
                    <TouchableOpacity
                      style={[styles.nbhChip, !nbhFilter && styles.nbhChipActive]}
                      onPress={() => setNbhFilter(null)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: !nbhFilter }}
                    >
                      <Ionicons name="map-outline" size={13} color={!nbhFilter ? COLORS.primary : COLORS.icon} />
                      <Text style={[styles.nbhChipText, !nbhFilter && styles.nbhChipTextActive]}>{tr('Todos los barrios')}</Text>
                    </TouchableOpacity>
                    {nbhChips.map(({ slug, n }) => {
                      const active = nbhFilter === slug;
                      return (
                        <TouchableOpacity
                          key={slug}
                          style={[styles.nbhChip, active && styles.nbhChipActive]}
                          onPress={() => setNbhFilter(active ? null : slug)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                        >
                          <Text style={[styles.nbhChipText, active && styles.nbhChipTextActive]}>{NBH_LABELS[slug] || slug}</Text>
                          <View style={[styles.chipCount, active && { backgroundColor: 'rgba(18,181,165,0.3)' }]}>
                            <Text style={[styles.chipCountText, active && { color: COLORS.primary }]}>{n}</Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </>
              )}

              {/* Mi Base — set your hotel, get back from anywhere */}
              <TouchableOpacity style={styles.sheetRow} onPress={() => { setMoreOpen(false); setBaseSheet(true); }} activeOpacity={0.8} accessibilityRole="button">
                <View style={[styles.sheetRowIcon, hasBase && styles.sheetRowIconOn]}>
                  <Ionicons name="home" size={17} color={hasBase ? COLORS.white : COLORS.icon} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sheetRowTitle}>{tr('Mi Base')}</Text>
                  <Text style={styles.sheetRowSub} numberOfLines={2}>{hasBase ? tr('Base guardada · toca para cambiarla') : tr('Guarda tu hotel y vuelve desde cualquier lugar')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.iconMuted} />
              </TouchableOpacity>

              {/* Tourist zones — soft shading + legend */}
              <TouchableOpacity style={styles.sheetRow} onPress={() => setZones(z => !z)} activeOpacity={0.8} accessibilityRole="switch" accessibilityState={{ checked: zones }}>
                <View style={[styles.sheetRowIcon, zones && styles.sheetRowIconOn]}>
                  <Ionicons name="layers" size={17} color={zones ? COLORS.white : COLORS.icon} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sheetRowTitle}>{tr('Mostrar zonas turísticas')}</Text>
                  <Text style={styles.sheetRowSub} numberOfLines={2}>{tr('Centro, Getsemaní, Bocagrande, Castillogrande y Manga')}</Text>
                </View>
                <View style={[styles.toggle, zones && styles.toggleOn]}>
                  <View style={[styles.toggleKnob, zones && styles.toggleKnobOn]} />
                </View>
              </TouchableOpacity>
            </ScrollView>
          </View>
        )}

        {/* CAMINAR sheet — experiences (sobrevuelo, paseo virtual) + curated rutas + custom builder */}
        {caminarOpen && !experienceActive && (
          <View style={styles.caminarSheet}>
            <View style={styles.caminarHeader}>
              <Text style={styles.caminarTitle}>🚶 {tr('Caminar Cartagena')}</Text>
              <TouchableOpacity onPress={() => setCaminarOpen(false)} style={styles.sheetClose} accessibilityRole="button" accessibilityLabel={tr('Cerrar')}>
                <Ionicons name="close" size={20} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={styles.expRow}>
              <TouchableOpacity style={styles.expCard} onPress={startTour} activeOpacity={0.8} accessibilityRole="button">
                <Ionicons name="play" size={16} color={COLORS.primary} />
                <Text style={styles.expCardTitle}>{tr('Sobrevuelo de Cartagena')}</Text>
                <Text style={styles.expCardSub} numberOfLines={2}>{tr('Vuelo aéreo por los lugares verificados')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.expCard} onPress={startVirtualWalk} activeOpacity={0.8} accessibilityRole="button">
                <Ionicons name="walk" size={16} color="#C9A84C" />
                <Text style={styles.expCardTitle}>{tr('Paseo virtual por el Centro')}</Text>
                <Text style={styles.expCardSub} numberOfLines={2}>{walkCardSub}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.caminarSub}>{tr('Rutas a pie por calles reales del Centro y Getsemaní.')}</Text>
            {ATLAS_RUTAS.map(r => (
              <TouchableOpacity key={r.id} style={styles.rutaCard} onPress={() => startRuta(r.title, r.stops, true)} activeOpacity={0.8}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rutaCardTitle}>{r.title}</Text>
                  <Text style={styles.rutaCardSub} numberOfLines={2}>{tr(r.subtitle)}</Text>
                </View>
                <View style={styles.rutaCardMeta}>
                  <Text style={styles.rutaCardMetaMain}>{fmtRutaDist(r.meters)} · {r.minutes} min</Text>
                  <Text style={styles.rutaCardMetaSub}>{r.stops.length} {tr('paradas')}</Text>
                </View>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.rutaCustomBtn} onPress={startCustomRuta} activeOpacity={0.85}>
              <Ionicons name="create-outline" size={16} color="#241a04" />
              <Text style={styles.rutaCustomBtnText}>{tr('Crear mi propia ruta')}</Text>
            </TouchableOpacity>
            <Text style={styles.caminarHint}>{tr('También puedes tocar cualquier lugar del mapa y elegir «Caminar».')}</Text>
          </View>
        )}

        {/* Custom-ruta builder bar — tap pins to collect stops */}
        {building && (
          <View style={styles.rutaBar}>
            <Text style={styles.rutaBarTitle}>🚶 {tr('Ruta personalizada')} · {buildStops.length}/{MAX_RUTA_STOPS}</Text>
            <Text style={styles.rutaBarSub} numberOfLines={2}>
              {buildStops.length
                ? buildStops.map(s => s.name).join(' · ')
                : tr('Toca los lugares del mapa y elige «Caminar» para añadirlos')}
            </Text>
            <View style={styles.rutaBarActions}>
              <TouchableOpacity
                style={[styles.rutaBtn, !buildStops.length && { opacity: 0.4 }]}
                disabled={!buildStops.length}
                onPress={() => startRuta(tr('Ruta personalizada'), buildStops, false)}
              >
                <Text style={styles.rutaBtnText}>{tr('Trazar ruta')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.rutaBtnGhost} onPress={stopRuta}>
                <Text style={styles.rutaBtnGhostText}>{tr('Cancelar')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Active ruta bar — totals, origin, live next-stop progress in city */}
        {ruta && (
          <View style={styles.rutaBar}>
            <Text style={styles.rutaBarTitle}>🚶 {ruta.title}</Text>
            <Text style={styles.rutaBarSub}>
              {rutaSummary
                ? `${fmtRutaDist(rutaSummary.meters)} · ${rutaSummary.minutes} min ${tr('caminando')}`
                : tr('Trazando ruta…')}
              {ruta.origin ? ` · ${tr('desde')} ${ruta.origin.label}` : ''}
            </Text>
            {inCity && nextStopIdx < ruta.stops.length && userLoc && (
              <Text style={styles.rutaBarNext}>
                {tr('Próxima parada')} {nextStopIdx + 1}/{ruta.stops.length}: {ruta.stops[nextStopIdx].name}
                {` — ${fmtRutaDist(Math.round(haversineM(userLoc.lat, userLoc.lng, ruta.stops[nextStopIdx].lat, ruta.stops[nextStopIdx].lng)))}`}
              </Text>
            )}
            {inCity && nextStopIdx >= ruta.stops.length && (
              <Text style={styles.rutaBarNext}>🎉 {tr('¡Ruta completada!')}</Text>
            )}
            <View style={styles.rutaBarActions}>
              <TouchableOpacity style={styles.rutaBtnGhost} onPress={stopRuta}>
                <Text style={styles.rutaBtnGhostText}>{tr('Finalizar')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Permission denied banner */}
        {locStatus === 'denied' && (
          <View style={styles.locDeniedBanner}>
            <Ionicons name="information-circle" size={14} color={COLORS.icon} />
            <Text style={styles.locDeniedText}>{tr('Activa la ubicación para ver lugares cerca de ti')}</Text>
            <TouchableOpacity onPress={requestLocation}>
              <Text style={styles.locDeniedAction}>{tr('Reintentar')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      <HomeBaseSheet visible={baseSheet} onClose={() => setBaseSheet(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: SPACING.md },
  loadingText: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular },

  // Chips (now inside the ⋯ sheet) — 44 px minimum touch height throughout.
  filterScroll: { gap: SPACING.xs, paddingRight: SPACING.md },
  nbhScroll: { marginHorizontal: -SPACING.md, paddingHorizontal: SPACING.md },
  nbhChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, minHeight: 44, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border, backgroundColor: 'rgba(255,255,255,0.04)' },
  nbhChipActive: { borderColor: COLORS.primary, backgroundColor: 'rgba(18,181,165,0.12)' },
  nbhChipText: { fontSize: 11.5, color: COLORS.textMuted, ...FONTS.semibold },
  nbhChipTextActive: { color: COLORS.primary },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 44, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border, backgroundColor: 'rgba(255,255,255,0.04)' },
  chipText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold },
  chipCount: { backgroundColor: COLORS.border, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  chipCountText: { fontSize: 10, color: COLORS.textMuted, ...FONTS.bold },

  mapWrap: { flex: 1, overflow: 'hidden', borderTopWidth: 1, borderTopColor: COLORS.border },
  webview: { flex: 1, backgroundColor: COLORS.background },

  // Active-filter pill: top-right, clear of Leaflet's zoom control (top-left).
  filterPill: {
    position: 'absolute',
    top: 10,
    right: 12,
    maxWidth: '72%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 12,
    paddingRight: 2,
    minHeight: 44,
    backgroundColor: 'rgba(5,8,20,0.92)',
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    zIndex: 1000,
  },
  filterPillText: { flexShrink: 1, fontSize: 11.5, color: COLORS.textMain, ...FONTS.semibold },
  filterPillClear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  fabDot: { position: 'absolute', top: 6, right: 6, width: 9, height: 9, borderRadius: 5, backgroundColor: COLORS.primary, borderWidth: 1.5, borderColor: COLORS.surface },
  sheetBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1150 },

  // ⋯ sheet — compact, scrolls when the barrio list is long.
  moreSheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 16,
    maxHeight: '78%',
    backgroundColor: 'rgba(5,8,20,0.96)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.sm,
    zIndex: 1200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 12,
  },
  moreScroll: { flexGrow: 0 },
  sheetHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sheetTextBtn: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' },
  sheetTextBtnLabel: { fontSize: 12, color: COLORS.primary, ...FONTS.bold },
  sheetClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  sheetLabel: { fontSize: 10.5, color: COLORS.textFaint, letterSpacing: 1, textTransform: 'uppercase', ...FONTS.bold, marginTop: SPACING.sm, marginBottom: 6 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8, borderTopWidth: 1, borderTopColor: COLORS.hairline, marginTop: SPACING.sm },
  sheetRowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: COLORS.border },
  sheetRowIconOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  sheetRowTitle: { fontSize: 13.5, color: COLORS.textMain, ...FONTS.bold },
  sheetRowSub: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginTop: 1 },
  toggle: { width: 42, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.12)', padding: 2, justifyContent: 'center' },
  toggleOn: { backgroundColor: COLORS.primary },
  toggleKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.white },
  toggleKnobOn: { alignSelf: 'flex-end' },

  // Experience cards at the top of the Caminar sheet (sobrevuelo / paseo virtual).
  expRow: { flexDirection: 'row', gap: 8 },
  expCard: { flex: 1, minHeight: 44, gap: 3, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 12, paddingVertical: 10 },
  expCardTitle: { fontSize: 12.5, color: COLORS.textMain, ...FONTS.bold, marginTop: 2 },
  expCardSub: { fontSize: 10.5, color: COLORS.textMuted, ...FONTS.regular },

  locateBtn: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.icon,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
    // Above Leaflet's panes (markers sit at z 400-600 in the SAME stacking
    // context) — without this, dense pin clusters paint OVER the controls.
    zIndex: 1000,
  },
  tourBtn: { borderColor: COLORS.primary },
  locateBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },

  // ── CAMINAR: gold spectrum — walking is the passport/atlas accent, never teal ──
  caminarBtn: { borderColor: '#C9A84C' },
  caminarBtnActive: { backgroundColor: '#C9A84C', borderColor: '#C9A84C' },
  caminarSheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 16,
    backgroundColor: 'rgba(5,8,20,0.96)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.35)',
    padding: SPACING.md,
    gap: 8,
    zIndex: 1200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 12,
  },
  caminarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  caminarTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold },
  caminarSub: { fontSize: 11.5, color: COLORS.textMuted, ...FONTS.regular, marginBottom: 2 },
  caminarHint: { fontSize: 10.5, color: COLORS.textFaint, ...FONTS.regular, textAlign: 'center', marginTop: 2 },
  rutaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rutaCardTitle: { fontSize: 13.5, color: COLORS.textMain, ...FONTS.bold },
  rutaCardSub: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginTop: 1 },
  rutaCardMeta: { alignItems: 'flex-end' },
  rutaCardMetaMain: { fontSize: 12, color: '#C9A84C', ...FONTS.bold },
  rutaCardMetaSub: { fontSize: 10, color: COLORS.textFaint, ...FONTS.medium, marginTop: 1 },
  rutaCustomBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#C9A84C',
    borderRadius: RADIUS.full,
    paddingVertical: 10,
    marginTop: 2,
  },
  rutaCustomBtnText: { fontSize: 13, color: '#241a04', ...FONTS.bold },
  rutaBar: {
    position: 'absolute',
    left: 12,
    right: 76,
    bottom: 16,
    backgroundColor: 'rgba(5,8,20,0.94)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.4)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 3,
    zIndex: 1100,
  },
  rutaBarTitle: { fontSize: 13, color: '#F5D47A', ...FONTS.bold },
  rutaBarSub: { fontSize: 11.5, color: COLORS.textMain, ...FONTS.medium },
  rutaBarNext: { fontSize: 11, color: '#8FE3C0', ...FONTS.semibold },
  rutaBarActions: { flexDirection: 'row', gap: 8, marginTop: 5 },
  rutaBtn: { backgroundColor: '#C9A84C', borderRadius: RADIUS.full, paddingHorizontal: 16, paddingVertical: 7 },
  rutaBtnText: { fontSize: 12, color: '#241a04', ...FONTS.bold },
  rutaBtnGhost: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: RADIUS.full, paddingHorizontal: 16, paddingVertical: 7, borderWidth: 1, borderColor: COLORS.border },
  rutaBtnGhostText: { fontSize: 12, color: COLORS.textMain, ...FONTS.semibold },
  locDeniedBanner: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 80,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(5,8,20,0.92)',
    borderRadius: RADIUS.full,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  locDeniedText: { flex: 1, fontSize: 11, color: COLORS.textMain, ...FONTS.medium },
  locDeniedAction: { fontSize: 11, color: COLORS.icon, ...FONTS.bold },
});
