import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Dimensions, Platform, ScrollView, Linking, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTr } from '../../src/i18n/autoTr';
import { geoService, haversineM } from '../../src/lib/geo';
import { getCollections } from '../../src/lib/passport';
import { getVenues } from '../../src/lib/venueCache';

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
};

const FILTERS = [
  { key: 'all', label: 'Todos', icon: 'grid', color: '#D97706' },
  { key: 'pasaporte', label: 'Pasaporte', icon: 'ribbon', color: '#D4AF37' },
  { key: 'venue', label: 'Venues', icon: 'location', color: '#3B82F6' },
  { key: 'partner', label: 'Partners', icon: 'diamond', color: '#8B5CF6' },
  { key: 'concert', label: 'Conciertos', icon: 'musical-notes', color: '#EC4899' },
];

const GOLD = '#D4AF37';

function fmtLiveDist(m: number): string {
  return m < 1000 ? `a ${Math.round(m / 10) * 10}m de ti` : `a ${(m / 1000).toFixed(1)}km de ti`;
}

const MARKER_COLORS: Record<string, string> = {
  historic: '#F59E0B',
  nightclub: '#EC4899',
  restaurant: '#EF4444',
  beach_club: '#06B6D4',
  hotel: '#3B82F6',
  cultural: '#8B5CF6',
  club: '#D97706',
  wellness: '#22C55E',
  concert: '#EC4899',
  partner: '#8B5CF6',
};

function buildMapHTML(places: Place[], filter: string, userLoc: { lat: number; lng: number } | null) {
  const filtered = filter === 'all' ? places : places.filter(p => p.category === filter);

  const markers = filtered.map(p => {
    const color = MARKER_COLORS[p.type] || MARKER_COLORS[p.category] || '#D97706';
    const safeName = p.name.replace(/'/g, "").replace(/"/g, "");
    const safeDesc = (p.extra || p.description || '').replace(/'/g, "").replace(/"/g, "").substring(0, 80);
    const safeAddr = p.address.replace(/'/g, "").replace(/"/g, "");
    const safePrice = p.price.replace(/'/g, "").replace(/"/g, "");
    const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + p.lat + ',' + p.lng;

    const priceHtml = safePrice ? '<span style="font-size:12px;color:#D97706;font-weight:700;">' + safePrice + '</span><br>' : '';

    const detailUrl = '/partner/' + p.id;
    const popupContent = '<div style=font-family:sans-serif;min-width:180px>'
      + '<div style=display:flex;align-items:center;gap:6px;margin-bottom:6px>'
      + '<div style=width:10px;height:10px;border-radius:50%;background:' + color + ';flex-shrink:0></div>'
      + '<span style=font-size:10px;color:' + color + ';text-transform:uppercase;font-weight:700>' + p.type + '</span>'
      + '</div>'
      + '<b style=font-size:15px;color:#1a1a2e>' + safeName + '</b><br>'
      + '<span style=font-size:11px;color:#666>' + safeDesc + '</span><br>'
      + '<span style=font-size:11px;color:#888>📍 ' + safeAddr + '</span><br>'
      + priceHtml
      + '<div style=display:flex;gap:6px;margin-top:6px>'
      + '<a href=' + detailUrl + ' style=display:inline-block;padding:6px_14px;background:#D97706;color:#fff;text-decoration:none;border-radius:20px;font-size:12px;font-weight:600 onclick=window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:\"navigate\",path:\"' + detailUrl + '\"}));return_false;>Ver detalle →</a>'
      + '<a href=' + mapsUrl + ' target=_blank style=display:inline-block;padding:6px_14px;background:rgba(26,26,46,0.1);color:#1a1a2e;text-decoration:none;border-radius:20px;font-size:12px;font-weight:600;border:1px_solid_#ddd>📍 Mapa</a>'
      + '</div>'
      + '</div>';

    return "L.circleMarker([" + p.lat + ", " + p.lng + "], {"
      + "radius: 10, fillColor: '" + color + "', color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.9"
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
      .bindPopup('<b style="color:#1a1a2e">📍 Tu ubicación</b>');
    ${isInCartagena(userLoc.lat, userLoc.lng) ? `map.setView([${userLoc.lat}, ${userLoc.lng}], 14);` : '/* User outside Cartagena — keep default center */'}
  ` : '';

  return '<!DOCTYPE html><html><head>'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">'
    + '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />'
    + '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>'
    + '<style>'
    + '* { margin: 0; padding: 0; box-sizing: border-box; }'
    + 'body { background: #050814; }'
    + '#map { width: 100vw; height: 100vh; }'
    + '.leaflet-popup-content-wrapper { border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); }'
    + '.leaflet-popup-tip { display: none; }'
    + '.leaflet-control-zoom { border: none !important; }'
    + '.leaflet-control-zoom a { background: #1a1a2e !important; color: #D97706 !important; border: 1px solid #2a2a4e !important; font-weight: 700; }'
    + '.leaflet-control-zoom a:hover { background: #2a2a4e !important; }'
    + '.leaflet-control-attribution { display: none; }'
    + '.user-pulse-icon { position: relative; width: 22px; height: 22px; }'
    + '.pulse-dot { position: absolute; top: 4px; left: 4px; width: 14px; height: 14px; border-radius: 50%; background: #2563EB; border: 2px solid #fff; box-shadow: 0 0 6px rgba(37,99,235,0.7); z-index: 2; }'
    + '.pulse-ring { position: absolute; top: 0; left: 0; width: 22px; height: 22px; border-radius: 50%; background: rgba(37,99,235,0.25); animation: pulse 1.6s ease-out infinite; z-index: 1; }'
    + '@keyframes pulse { 0% { transform: scale(0.6); opacity: 1; } 100% { transform: scale(2.4); opacity: 0; } }'
    + '.dark-tiles { filter: invert(1) hue-rotate(180deg) brightness(0.7) saturate(1.5) contrast(1.1); }'
    + '</style>'
    + '</head><body>'
    + '<div id="map"></div>'
    + '<script>'
    + 'var map = L.map("map", {zoomControl: true, attributionControl: false}).setView([10.4236, -75.5483], 13);'
    + 'L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {maxZoom: 19, className:"dark-tiles"}).addTo(map);'
    + markers
    + userMarker
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
function WebMapDirect({ places, filter, passportIds, userLoc, follow, onNavigate }: {
  places: Place[]; filter: string; passportIds: Set<string>;
  userLoc: { lat: number; lng: number } | null; follow: boolean;
  onNavigate: (path: string) => void;
}) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<any>(null);
  const markerLayerRef = useRef<any>(null);
  const userMarkerRef = useRef<any>(null);
  const userPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const followRef = useRef(follow);
  followRef.current = follow;

  // ── Map bootstrap: once ──
  useEffect(() => {
    if (typeof window === 'undefined' || !mapRef.current) return;
    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    const init = () => {
      const L = (window as any).L;
      if (!L || !mapRef.current || leafletRef.current) return;
      const map = L.map(mapRef.current, { zoomControl: true, attributionControl: false })
        .setView([10.4236, -75.5483], 13);
      leafletRef.current = map;
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 19, subdomains: 'abcd', className: 'dark-tiles',
      }).addTo(map);

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
          .leaflet-popup-content-wrapper { border-radius: 12px !important; box-shadow: 0 4px 20px rgba(0,0,0,0.15) !important; }
          .leaflet-popup-tip { display: none !important; }
          .leaflet-control-zoom { border: none !important; }
          .leaflet-control-zoom a { background: #1a1a2e !important; color: #D97706 !important; border: 1px solid #2a2a4e !important; font-weight: 700; }
          .leaflet-control-attribution { display: none !important; }
        `;
        document.head.appendChild(style);
      }
      renderMarkers();
      renderUser();
    };
    if ((window as any).L) init();
    else {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = init;
      document.head.appendChild(script);
    }
    return () => {
      if (leafletRef.current) {
        leafletRef.current.remove();
        leafletRef.current = null;
        markerLayerRef.current = null;
        userMarkerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      : places.filter(p => p.category === filter);
    filtered.forEach(p => {
      if (!p.lat || !p.lng) return;
      const isPassport = passportIds.has(p.id);
      const color = isPassport ? GOLD : (MARKER_COLORS[p.type] || MARKER_COLORS[p.category] || '#D97706');
      const safeName = p.name.replace(/'/g, '').replace(/"/g, '');
      const safeDesc = (p.extra || p.description || '').replace(/'/g, '').replace(/"/g, '').substring(0, 80);
      const safeAddr = p.address.replace(/'/g, '').replace(/"/g, '');
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
      const priceHtml = p.price ? `<span style="font-size:12px;color:#D97706;font-weight:700">${p.price}</span><br>` : '';
      const passportHtml = isPassport
        ? `<span style="font-size:10px;color:#8a6d1f;font-weight:800">🛂 SELLO DEL PASAPORTE</span><br>`
        : '';
      const popup = `<div style="font-family:sans-serif;min-width:180px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
          <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></div>
          <span style="font-size:10px;color:${color};text-transform:uppercase;font-weight:700">${isPassport ? 'pasaporte' : p.type}</span>
        </div>
        <b style="font-size:15px;color:#1a1a2e">${safeName}</b><br>
        <span data-dist style="display:none;font-size:12px;color:#1a7f37;font-weight:700"></span>
        ${passportHtml}
        <span style="font-size:11px;color:#666">${safeDesc}</span><br>
        <span style="font-size:11px;color:#888">📍 ${safeAddr}</span><br>
        ${priceHtml}
        <div style="display:flex;gap:6px;margin-top:6px">
          <a href="#" data-partner="${p.id}" style="display:inline-block;padding:6px 14px;background:#D97706;color:#fff;text-decoration:none;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer">Ver detalle →</a>
          <a href="${mapsUrl}" target="_blank" style="display:inline-block;padding:6px 14px;background:rgba(26,26,46,0.1);color:#1a1a2e;text-decoration:none;border-radius:20px;font-size:12px;font-weight:600;border:1px solid #ddd">📍 Mapa</a>
        </div>
      </div>`;
      L.circleMarker([p.lat, p.lng], {
        radius: isPassport ? 11 : 10,
        fillColor: color,
        color: isPassport ? '#7a5c00' : '#fff',
        weight: 2, opacity: 1, fillOpacity: 0.92,
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
        .bindPopup('<b style="color:#1a1a2e">📍 Tu ubicación</b>');
      if (isInCartagena(userLoc.lat, userLoc.lng)) map.setView([userLoc.lat, userLoc.lng], 15);
    } else {
      userMarkerRef.current.setLatLng([userLoc.lat, userLoc.lng]);
      if (followRef.current && isInCartagena(userLoc.lat, userLoc.lng)) {
        map.panTo([userLoc.lat, userLoc.lng], { animate: true });
      }
    }
  };
  useEffect(() => {
    renderUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLoc]);

  return (
    <div
      ref={mapRef as any}
      style={{ width: '100%', height: '100%', background: '#050814' }}
    />
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
  const [passportIds, setPassportIds] = useState<Set<string>>(new Set());
  const webViewRef = useRef<any>(null);

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
          'Permiso de ubicación',
          'Activa el permiso para ver lugares cerca de ti y mejorar tus recomendaciones.',
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
    const buildPlaces = (venues: any[], partners: any[], concerts: any[]): Place[] => {
      const allPlaces: Place[] = [];
      const seenNames = new Set<string>();

      venues.forEach((v: any) => {
        seenNames.add(v.name.toLowerCase());
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
        if (!seenNames.has(p.name.toLowerCase()) && p.location) {
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
            price: c.is_free ? 'GRATIS' : `$${(c.price / 1000).toFixed(0)}K COP`,
            link: c.ticket_link || '', extra: `${c.genre} · ${c.start_time}`,
          });
        }
      });

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
    }).catch(() => {});

    // Venues + concerts arrive slightly later — merge in
    Promise.all([staticFetch('venues'), staticFetch('concerts')])
      .then(([sv, sc]) => {
        // Re-read current partners from the already-set state via a fresh fetch
        staticFetch('partners').then(sp => {
          if (Array.isArray(sp) && sp.length > 0) {
            setPlaces(buildPlaces(sv, sp, sc));
          }
          setLoading(false);
        });
      }).catch(() => setLoading(false));

    // Hydrate from backend (non-blocking)
    Promise.all([
      api.get('/venues').catch(() => []),
      api.get('/partners').catch(() => []),
      api.get('/concerts').catch(() => []),
    ]).then(([venues, partners, concerts]) => {
      if (Array.isArray(partners) && partners.length > 0) {
        setPlaces(buildPlaces(venues, partners, concerts));
      }
    }).catch(() => {});
    requestLocation();
  }, []);

  const counts = {
    all: places.length,
    pasaporte: places.filter(p => passportIds.has(p.id)).length,
    venue: places.filter(p => p.category === 'venue').length,
    partner: places.filter(p => p.category === 'partner').length,
    concert: places.filter(p => p.category === 'concert').length,
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Cargando mapa de Cartagena...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const html = buildMapHTML(places, filter, userLoc);

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
                <Text style={[styles.chipText, isActive && { color: f.color }]}>{f.label}</Text>
                <View style={[styles.chipCount, isActive && { backgroundColor: `${f.color}30` }]}>
                  <Text style={[styles.chipCountText, isActive && { color: f.color }]}>{count}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Map */}
      <View style={styles.mapWrap}>
        {Platform.OS === 'web' ? (
          <WebMapDirect places={places} filter={filter} passportIds={passportIds} userLoc={userLoc} follow={follow} onNavigate={(path) => router.push(path as any)} />
        ) : (
          <WebView
            ref={webViewRef}
            key={filter + (userLoc ? `_u${userLoc.lat}` : '')}
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
                }
              } catch { /* non-JSON message — ignore */ }
            }}
          />
        )}

        {/* Floating "Recentrar en Cartagena" button */}
        <TouchableOpacity
          style={[styles.locateBtn, { bottom: 80 }, follow && styles.locateBtnActive]}
          onPress={() => setFollow(f => !f)}
          activeOpacity={0.85}
        >
          <Ionicons name="walk" size={20} color={follow ? COLORS.white : COLORS.primary} />
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
              color={locStatus === 'granted' ? COLORS.white : COLORS.primary}
            />
          )}
        </TouchableOpacity>

        {/* Permission denied banner */}
        {locStatus === 'denied' && (
          <View style={styles.locDeniedBanner}>
            <Ionicons name="information-circle" size={14} color={COLORS.primary} />
            <Text style={styles.locDeniedText}>Activa la ubicación para ver lugares cerca de ti</Text>
            <TouchableOpacity onPress={requestLocation}>
              <Text style={styles.locDeniedAction}>{tr('Reintentar')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: SPACING.md },
  loadingText: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular },

  filterBar: { paddingVertical: SPACING.xs, backgroundColor: COLORS.background },
  filterScroll: { paddingHorizontal: SPACING.md, gap: SPACING.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  chipText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold },
  chipCount: { backgroundColor: COLORS.border, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  chipCountText: { fontSize: 10, color: COLORS.textMuted, ...FONTS.bold },

  mapWrap: { flex: 1, overflow: 'hidden', borderTopWidth: 1, borderTopColor: COLORS.border },
  webview: { flex: 1, backgroundColor: '#050814' },

  locateBtn: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
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
  locDeniedAction: { fontSize: 11, color: COLORS.primary, ...FONTS.bold },
});
