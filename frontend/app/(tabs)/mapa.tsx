import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Dimensions, Platform, ScrollView, Linking,
} from 'react-native';
import { Alert } from '../../src/lib/alert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { COLORS, SPACING, RADIUS, FONTS, colorForKey } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { eventPriceLabel } from '../../src/utils/price';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTr } from '../../src/i18n/autoTr';
import { geoService, haversineM } from '../../src/lib/geo';
import { getCollections } from '../../src/lib/passport';
import { getVenues } from '../../src/lib/venueCache';
import { venueBarrio, NBH_LABELS, NbhCentroid } from '../../src/utils/neighborhood';
import { HomeBaseSheet } from '../../src/components/HomeBaseSheet';
import { getHomeBase, syncHomeBase } from '../../src/lib/homeBase';
import { ATLAS_VERIFIED, ATLAS_VENUE_FIXES, ATLAS_ADD_VENUES, ATLAS_ROUTE } from '../../src/data/atlas';

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

const FILTERS = [
  { key: 'all', label: 'Todos', icon: 'grid', color: '#12B5A5' },
  { key: 'pasaporte', label: 'Pasaporte', icon: 'ribbon', color: COLORS.mustard },
  { key: 'venue', label: 'Venues', icon: 'location', color: '#3B82F6' },
  { key: 'partner', label: 'Partners', icon: 'diamond', color: '#8B5CF6' },
  { key: 'esenciales', label: 'Esenciales', icon: 'medkit', color: '#14B8A6' },
  { key: 'concert', label: 'Conciertos', icon: 'musical-notes', color: '#EC4899' },
];

const GOLD = COLORS.mustard; // passport pins — distinct gold accent, never teal

function fmtLiveDist(m: number): string {
  return m < 1000 ? `a ${Math.round(m / 10) * 10}m de ti` : `a ${(m / 1000).toFixed(1)}km de ti`;
}

// Marker color per place: delegates to the app's shared colorForKey() spectrum
// (src/constants/theme.ts) instead of a parallel hardcoded table — that old table
// had `club: '#12B5A5'`, reusing the reserved primary teal for a content category.
// colorForKey() falls back gracefully (deterministic spectrum hash) for any
// type/category not explicitly assigned a color.
function markerColor(p: Place): string {
  return colorForKey(p.type || p.category);
}

// Tour timing: flyTo flight time + dwell at each stop (seconds / ms).
const TOUR_FLIGHT_S = 2.2;
const TOUR_STEP_MS = 4200;

function buildMapHTML(places: Place[], filter: string, userLoc: { lat: number; lng: number } | null, satellite: boolean, autoTour: boolean) {
  const filtered = filter === 'all' ? places
    : filter === 'esenciales' ? places.filter(p => p.type === 'service' || p.type === 'essential')
    : places.filter(p => p.category === filter);

  const markers = filtered.map(p => {
    const color = markerColor(p);
    const isVerified = !!p.verified;
    const safeName = (p.name || '').replace(/'/g, "").replace(/"/g, "");
    const safeDesc = (p.extra || p.description || '').replace(/'/g, "").replace(/"/g, "").substring(0, 80);
    const safeAddr = (p.address || '').replace(/'/g, "").replace(/"/g, "");
    const safePrice = (p.price || '').replace(/'/g, "").replace(/"/g, "");
    const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + p.lat + ',' + p.lng;

    const priceHtml = safePrice ? '<span style="font-size:12px;color:' + COLORS.mustard + ';font-weight:700;">' + safePrice + '</span><br>' : '';
    const verifiedHtml = isVerified ? '<span style="font-size:10px;color:#12B5A5;font-weight:800;">✓ UBICACIÓN VERIFICADA</span><br>' : '';

    const detailUrl = '/partner/' + p.id;
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
      + '<div style=display:flex;gap:6px;margin-top:6px>'
      + '<a href=' + detailUrl + ' style=display:inline-block;padding:6px_14px;background:#12B5A5;color:#fff;text-decoration:none;border-radius:20px;font-size:12px;font-weight:600 onclick=window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:\"navigate\",path:\"' + detailUrl + '\"}));return_false;>Ver detalle →</a>'
      + '<a href=' + mapsUrl + ' target=_blank style=display:inline-block;padding:6px_14px;background:rgba(255,255,255,0.08);color:' + COLORS.textMain + ';text-decoration:none;border-radius:20px;font-size:12px;font-weight:600;border:1px_solid_rgba(255,255,255,0.08)>📍 Mapa</a>'
      + '</div>'
      + '</div>';

    // Verified pins: precision halo ring underneath + slightly heavier marker.
    const halo = isVerified
      ? "L.circleMarker([" + p.lat + ", " + p.lng + "], {radius: 16, fill: false, color: '#12B5A5', weight: 1.5, dashArray: '2 4', opacity: 0.9, interactive: false}).addTo(map);\n"
      : '';
    return halo + "L.circleMarker([" + p.lat + ", " + p.lng + "], {"
      + "radius: " + (isVerified ? 11 : 10) + ", fillColor: '" + color + "', color: '#fff', weight: " + (isVerified ? 3 : 2) + ", opacity: 1, fillOpacity: 0.9"
      + "}).addTo(map).bindPopup('" + popupContent.replace(/'/g, "\\'") + "', {maxWidth: 260});";
  }).join('\n');

  // User location: pulsing blue dot — only recenter if INSIDE Cartagena
  const userMarker = userLoc ? `
    var userIcon = L.divIcon({
      className: 'user-pulse-icon',
      html: '<div class="pulse-ring"></div><div class="pulse-dot"></div>',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    L.marker([${userLoc.lat}, ${userLoc.lng}], {icon: userIcon, zIndexOffset: 1000})
      .addTo(map)
      .bindPopup('<b style="color:${COLORS.textMain}">📍 Tu ubicación</b>');
    ${isInCartagena(userLoc.lat, userLoc.lng) ? `map.setView([${userLoc.lat}, ${userLoc.lng}], 14);` : '/* User outside Cartagena — keep default center */'}
  ` : '';

  return '<!DOCTYPE html><html><head>'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">'
    + '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />'
    + '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>'
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
    + '</style>'
    + '</head><body>'
    + '<div id="map"></div>'
    + '<script>'
    + 'var map = L.map("map", {zoomControl: true, attributionControl: false, zoomSnap: ' + (autoTour ? 0 : 1) + '}).setView([10.4236, -75.5483], 13);'
    + 'L.tileLayer("' + (satellite ? TILE_SAT.url : TILE_DARK.url) + '", {maxNativeZoom: ' + (satellite ? TILE_SAT.maxNativeZoom : TILE_DARK.maxNativeZoom) + ', maxZoom: 19, attribution: "Esri"}).addTo(map);'
    + markers
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
function WebMapDirect({ places, filter, passportIds, userLoc, follow, satellite, tourActive, onTourEnd, onNavigate }: {
  places: Place[]; filter: string; passportIds: Set<string>;
  userLoc: { lat: number; lng: number } | null; follow: boolean; satellite: boolean;
  tourActive: boolean; onTourEnd: () => void;
  onNavigate: (path: string) => void;
}) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<any>(null);
  const markerLayerRef = useRef<any>(null);
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

  // ── Map bootstrap: once (re-run on manual retry) ──
  useEffect(() => {
    if (typeof window === 'undefined' || !mapRef.current) return;
    setLoadFailed(false);
    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
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
            el.textContent = '🚶 ' + fmtLiveDist(d);
            (el as HTMLElement).style.display = 'block';
          }
        } catch {}
      });

      mapRef.current.addEventListener('click', (e: MouseEvent) => {
        const link = (e.target as HTMLElement).closest('[data-partner]') as HTMLElement | null;
        if (link) {
          e.preventDefault();
          const pid = link.getAttribute('data-partner');
          if (pid) onNavigate(`/partner/${pid}`);
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
        `;
        document.head.appendChild(style);
      }
      // Drop 7E: tourist-zone shading — soft, labeled, never a safety claim.
      const ZONES: Array<[string, [number, number], [number, number]]> = [
        ['Centro Histórico', [10.418, -75.555], [10.435, -75.535]],
        ['Bocagrande', [10.395, -75.560], [10.415, -75.545]],
        ['Getsemaní', [10.410, -75.545], [10.420, -75.530]],
        ['Castillogrande', [10.390, -75.560], [10.405, -75.555]],
        ['Manga', [10.405, -75.535], [10.420, -75.525]],
      ];
      ZONES.forEach(([name, sw, ne]) => {
        L.rectangle([sw, ne] as any, { color: COLORS.icon, weight: 1, opacity: 0.35, fillColor: COLORS.icon, fillOpacity: 0.05, interactive: false }).addTo(map);
      });
      const legend = (L as any).control({ position: 'bottomleft' });
      legend.onAdd = () => {
        const div = document.createElement('div');
        div.style.cssText = 'background:rgba(5,8,20,0.85);color:' + COLORS.icon + ';font:600 10px sans-serif;padding:4px 8px;border-radius:10px;border:1px solid rgba(174,182,196,0.4)';
        div.textContent = 'Zonas turísticas principales';
        return div;
      };
      legend.addTo(map);

      renderMarkers();
      renderUser();
      setMapReady(true);
    };
    if ((window as any).L) init();
    else {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = init;
      script.onerror = () => setLoadFailed(true);
      document.head.appendChild(script);
    }
    return () => {
      if (leafletRef.current) {
        leafletRef.current.remove();
        leafletRef.current = null;
        markerLayerRef.current = null;
        baseLayerRef.current = null;
        userMarkerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryTick]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ── Place markers: rebuild only when data/filter changes ──
  const renderMarkers = () => {
    const L = (window as any).L;
    const map = leafletRef.current;
    if (!L || !map) return;
    if (markerLayerRef.current) {
      map.removeLayer(markerLayerRef.current);
      markerLayerRef.current = null;
    }
    const layer = L.layerGroup();
    const filtered = filter === 'all' ? places
      : filter === 'pasaporte' ? places.filter(p => passportIds.has(p.id))
      : filter === 'esenciales' ? places.filter(p => p.type === 'service' || p.type === 'essential')
      : places.filter(p => p.category === filter);
    filtered.forEach(p => {
      if (!p.lat || !p.lng) return;
      const isPassport = passportIds.has(p.id);
      const isVerified = !!p.verified;
      const color = isPassport ? GOLD : markerColor(p);
      const safeName = (p.name || '').replace(/'/g, '').replace(/"/g, '');
      const safeDesc = (p.extra || p.description || '').replace(/'/g, '').replace(/"/g, '').substring(0, 80);
      const safeAddr = (p.address || '').replace(/'/g, '').replace(/"/g, '');
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
      const priceHtml = p.price ? `<span style="font-size:12px;color:${COLORS.mustard};font-weight:700">${p.price}</span><br>` : '';
      const passportHtml = isPassport
        ? `<span style="font-size:10px;color:#8a6d1f;font-weight:800">🛂 SELLO DEL PASAPORTE</span><br>`
        : '';
      const verifiedHtml = isVerified
        ? `<span style="font-size:10px;color:#12B5A5;font-weight:800">✓ UBICACIÓN VERIFICADA</span><br>`
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
        <div style="display:flex;gap:6px;margin-top:6px">
          <a href="#" data-partner="${p.id}" style="display:inline-block;padding:6px 14px;background:#12B5A5;color:#fff;text-decoration:none;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer">Ver detalle →</a>
          <a href="${mapsUrl}" target="_blank" style="display:inline-block;padding:6px 14px;background:rgba(255,255,255,0.08);color:${COLORS.textMain};text-decoration:none;border-radius:20px;font-size:12px;font-weight:600;border:1px solid rgba(255,255,255,0.08)">📍 Mapa</a>
        </div>
      </div>`;
      if (isVerified) {
        // Precision halo under atlas-verified pins.
        L.circleMarker([p.lat, p.lng], {
          radius: 16, fill: false, color: '#12B5A5', weight: 1.5,
          dashArray: '2 4', opacity: 0.9, interactive: false,
        }).addTo(layer);
      }
      L.circleMarker([p.lat, p.lng], {
        radius: isPassport || isVerified ? 11 : 10,
        fillColor: color,
        color: isPassport ? '#7a5c00' : '#fff',
        weight: isVerified ? 3 : 2, opacity: 1, fillOpacity: 0.92,
      }).addTo(layer).bindPopup(popup, { maxWidth: 260 });
    });
    layer.addTo(map);
    markerLayerRef.current = layer;
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
        .bindPopup('<b style="color:' + COLORS.textMain + '">📍 Tu ubicación</b>');
      if (isInCartagena(userLoc.lat, userLoc.lng)) map.setView([userLoc.lat, userLoc.lng], 15);
    } else {
      userMarkerRef.current.setLatLng([userLoc.lat, userLoc.lng]);
      // Follow never fights the fly-through: tour owns the camera while active.
      if (followRef.current && !tourActiveRef.current && isInCartagena(userLoc.lat, userLoc.lng)) {
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
  const [satellite, setSatellite] = useState(false);
  const [tour, setTour] = useState(false);
  const [passportIds, setPassportIds] = useState<Set<string>>(new Set());
  const [neighborhoods, setNeighborhoods] = useState<NbhCentroid[]>([]);
  const [nbhFilter, setNbhFilter] = useState<string | null>(null); // null = all barrios
  const [baseSheet, setBaseSheet] = useState(false);
  const [hasBase, setHasBase] = useState(false);
  const webViewRef = useRef<any>(null);

  // Reflect whether a home base is set (re-check when the sheet closes).
  useEffect(() => {
    setHasBase(!!getHomeBase());
    // On mount / after closing the sheet, reconcile with the account so the button
    // reflects a base saved on another device.
    if (!baseSheet) syncHomeBase().then(sb => setHasBase(!!sb)).catch(() => {});
  }, [baseSheet]);

  // Neighborhood centroids for the barrio filter (same source as Explore).
  useEffect(() => {
    fetch('/data/neighborhoods.json')
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
      fetch(`/data/${file}.json`).then(r => r.ok ? r.json() : []).catch(() => []);

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
    setSatellite(true);
    setTour(true);
  };

  // Native: the WebView document auto-runs the tour when rebuilt with tour on
  // (the key below includes both flags, so toggling rebuilds the document).
  const html = buildMapHTML(visiblePlaces, filter, userLoc, satellite, tour);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Filter Bar */}
      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {FILTERS.map(f => {
            const isActive = filter === f.key;
            const count = counts[f.key as keyof typeof counts] || 0;
            return (
              <TouchableOpacity
                key={f.key}
                style={[styles.chip, isActive && { backgroundColor: `${f.color}20`, borderColor: f.color }]}
                onPress={() => setFilter(f.key)}
              >
                <Ionicons name={f.icon as any} size={14} color={isActive ? f.color : COLORS.textMuted} />
                <Text style={[styles.chipText, isActive && { color: f.color }]}>{tr(f.label)}</Text>
                <View style={[styles.chipCount, isActive && { backgroundColor: `${f.color}30` }]}>
                  <Text style={[styles.chipCountText, isActive && { color: f.color }]}>{count}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Barrio filter — find everything in Manga, Bocagrande, Centro… */}
      {nbhChips.length > 0 && (
        <View style={styles.nbhBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
            <TouchableOpacity
              style={styles.nbhChip}
              onPress={() => setNbhFilter(null)}
            >
              <Ionicons name="map-outline" size={13} color={COLORS.icon} />
              <Text style={styles.nbhChipText}>{tr('Todos los barrios')}</Text>
            </TouchableOpacity>
            {nbhChips.map(({ slug, n }) => {
              const active = nbhFilter === slug;
              return (
                <TouchableOpacity
                  key={slug}
                  style={[styles.nbhChip, active && styles.nbhChipActive]}
                  onPress={() => setNbhFilter(active ? null : slug)}
                >
                  <Text style={[styles.nbhChipText, active && styles.nbhChipTextActive]}>{NBH_LABELS[slug] || slug}</Text>
                  <View style={[styles.chipCount, active && { backgroundColor: 'rgba(18,181,165,0.3)' }]}>
                    <Text style={[styles.chipCountText, active && { color: COLORS.primary }]}>{n}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Map */}
      <View style={styles.mapWrap}>
        {Platform.OS === 'web' ? (
          <WebMapDirect places={visiblePlaces} filter={filter} passportIds={passportIds} userLoc={userLoc} follow={follow} satellite={satellite} tourActive={tour} onTourEnd={() => setTour(false)} onNavigate={(path) => router.push(path as any)} />
        ) : (
          <WebView
            ref={webViewRef}
            key={filter + (nbhFilter || 'allnbh') + (tour ? '' : (userLoc ? `_u${userLoc.lat}` : '')) + (satellite ? '_sat' : '_dark') + (tour ? '_tour' : '')}
            source={{ html }}
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
                if (msg.type === 'navigate' && msg.path) {
                  router.push(msg.path as any);
                } else if (msg.type === 'tourEnd') {
                  // Native tour ran to completion inside the document — sync
                  // React state so the button resets and later key-driven
                  // rebuilds don't re-run autoTour.
                  setTour(false);
                }
              } catch { /* non-JSON message — ignore */ }
            }}
          />
        )}

        {/* Floating atlas fly-through — the exported camera route over satellite */}
        <TouchableOpacity
          style={[styles.locateBtn, { bottom: 254 }, tour && styles.locateBtnActive]}
          onPress={startTour}
          activeOpacity={0.85}
        >
          <Ionicons name={tour ? 'stop' : 'play'} size={19} color={tour ? COLORS.white : COLORS.icon} />
        </TouchableOpacity>

        {/* Floating satellite toggle — real overhead imagery of every venue */}
        <TouchableOpacity
          style={[styles.locateBtn, { bottom: 196 }, satellite && styles.locateBtnActive]}
          onPress={() => setSatellite(s => !s)}
          activeOpacity={0.85}
        >
          <Ionicons name={satellite ? 'earth' : 'earth-outline'} size={19} color={satellite ? COLORS.white : COLORS.icon} />
        </TouchableOpacity>

        {/* Floating "Mi Base" — set your hotel, get back from anywhere */}
        <TouchableOpacity
          style={[styles.locateBtn, { bottom: 138 }, hasBase && styles.locateBtnActive]}
          onPress={() => setBaseSheet(true)}
          activeOpacity={0.85}
        >
          <Ionicons name="home" size={19} color={hasBase ? COLORS.white : COLORS.icon} />
        </TouchableOpacity>

        {/* Floating "Recentrar en Cartagena" button */}
        <TouchableOpacity
          style={[styles.locateBtn, { bottom: 80 }, follow && styles.locateBtnActive]}
          onPress={() => setFollow(f => !f)}
          activeOpacity={0.85}
        >
          <Ionicons name="walk" size={20} color={follow ? COLORS.white : COLORS.icon} />
        </TouchableOpacity>

        {/* Floating "Locate me" button */}
        <TouchableOpacity
          style={[styles.locateBtn, locStatus === 'granted' && styles.locateBtnActive]}
          onPress={requestLocation}
          activeOpacity={0.85}
        >
          {locStatus === 'requesting' ? (
            <ActivityIndicator size="small" color={COLORS.white} />
          ) : (
            <Ionicons
              name={locStatus === 'granted' ? 'navigate' : 'locate'}
              size={20}
              color={locStatus === 'granted' ? COLORS.white : COLORS.icon}
            />
          )}
        </TouchableOpacity>

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

  filterBar: { paddingVertical: SPACING.xs, backgroundColor: COLORS.background },
  filterScroll: { paddingHorizontal: SPACING.md, gap: SPACING.xs },
  nbhBar: { paddingBottom: SPACING.xs, backgroundColor: COLORS.background, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  nbhChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 6, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  nbhChipActive: { borderColor: COLORS.primary, backgroundColor: 'rgba(18,181,165,0.12)' },
  nbhChipText: { fontSize: 11.5, color: COLORS.textMuted, ...FONTS.semibold },
  nbhChipTextActive: { color: COLORS.primary },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  chipText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold },
  chipCount: { backgroundColor: COLORS.border, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  chipCountText: { fontSize: 10, color: COLORS.textMuted, ...FONTS.bold },

  mapWrap: { flex: 1, overflow: 'hidden', borderTopWidth: 1, borderTopColor: COLORS.border },
  webview: { flex: 1, backgroundColor: COLORS.background },

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
  },
  locateBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
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
