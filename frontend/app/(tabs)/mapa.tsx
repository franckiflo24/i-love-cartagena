import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Dimensions, Platform, ScrollView, Linking, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTr } from '../../src/i18n/autoTr';

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
  { key: 'venue', label: 'Venues', icon: 'location', color: '#3B82F6' },
  { key: 'partner', label: 'Partners', icon: 'diamond', color: '#8B5CF6' },
  { key: 'concert', label: 'Conciertos', icon: 'musical-notes', color: '#EC4899' },
];

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

  // User location: pulsing blue dot + accuracy ring
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
    map.setView([${userLoc.lat}, ${userLoc.lng}], 14);
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
    + '</style>'
    + '</head><body>'
    + '<div id="map"></div>'
    + '<script>'
    + 'var map = L.map("map", {zoomControl: true, attributionControl: false}).setView([10.4236, -75.5483], 13);'
    + 'L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {maxZoom: 19}).addTo(map);'
    + markers
    + userMarker
    + '<\/script>'
    + '</body></html>';
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
 * Fixes the gray-tile issue caused by srcDoc iframe sandbox restrictions.
 */
function WebMapDirect({ places, filter, userLoc, onNavigate }: {
  places: Place[]; filter: string; userLoc: { lat: number; lng: number } | null;
  onNavigate: (path: string) => void;
}) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !mapRef.current) return;

    // Load Leaflet CSS
    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    // Load Leaflet JS
    const initMap = () => {
      const L = (window as any).L;
      if (!L || !mapRef.current) return;

      // Destroy previous map instance
      if (leafletRef.current) {
        leafletRef.current.remove();
        leafletRef.current = null;
      }

      const map = L.map(mapRef.current, { zoomControl: true, attributionControl: false })
        .setView([10.4236, -75.5483], 13);
      leafletRef.current = map;

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd',
      }).addTo(map);

      // Add markers
      const filtered = filter === 'all' ? places : places.filter(p => p.category === filter);
      filtered.forEach(p => {
        if (!p.lat || !p.lng) return;
        const color = MARKER_COLORS[p.type] || MARKER_COLORS[p.category] || '#D97706';
        const safeName = p.name.replace(/'/g, '').replace(/"/g, '');
        const safeDesc = (p.extra || p.description || '').replace(/'/g, '').replace(/"/g, '').substring(0, 80);
        const safeAddr = p.address.replace(/'/g, '').replace(/"/g, '');
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
        const priceHtml = p.price ? `<span style="font-size:12px;color:#D97706;font-weight:700">${p.price}</span><br>` : '';

        const popup = `<div style="font-family:sans-serif;min-width:180px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
            <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></div>
            <span style="font-size:10px;color:${color};text-transform:uppercase;font-weight:700">${p.type}</span>
          </div>
          <b style="font-size:15px;color:#1a1a2e">${safeName}</b><br>
          <span style="font-size:11px;color:#666">${safeDesc}</span><br>
          <span style="font-size:11px;color:#888">📍 ${safeAddr}</span><br>
          ${priceHtml}
          <div style="display:flex;gap:6px;margin-top:6px">
            <a href="#" data-partner="${p.id}" style="display:inline-block;padding:6px 14px;background:#D97706;color:#fff;text-decoration:none;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer">Ver detalle →</a>
            <a href="${mapsUrl}" target="_blank" style="display:inline-block;padding:6px 14px;background:rgba(26,26,46,0.1);color:#1a1a2e;text-decoration:none;border-radius:20px;font-size:12px;font-weight:600;border:1px solid #ddd">📍 Mapa</a>
          </div>
        </div>`;

        L.circleMarker([p.lat, p.lng], {
          radius: 10, fillColor: color, color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.9,
        }).addTo(map).bindPopup(popup, { maxWidth: 260 });
      });

      // User location marker
      if (userLoc) {
        const userIcon = L.divIcon({
          className: 'user-pulse-icon',
          html: '<div style="position:relative;width:22px;height:22px"><div style="position:absolute;top:0;left:0;width:22px;height:22px;border-radius:50%;background:rgba(37,99,235,0.25);animation:pulse 1.6s ease-out infinite"></div><div style="position:absolute;top:4px;left:4px;width:14px;height:14px;border-radius:50%;background:#2563EB;border:2px solid #fff;box-shadow:0 0 6px rgba(37,99,235,0.7)"></div></div>',
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        L.marker([userLoc.lat, userLoc.lng], { icon: userIcon, zIndexOffset: 1000 })
          .addTo(map)
          .bindPopup('<b style="color:#1a1a2e">📍 Tu ubicación</b>');
        map.setView([userLoc.lat, userLoc.lng], 14);
      }

      // Handle "Ver detalle" clicks via event delegation
      mapRef.current.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        const link = target.closest('[data-partner]') as HTMLElement | null;
        if (link) {
          e.preventDefault();
          const pid = link.getAttribute('data-partner');
          if (pid) onNavigate(`/partner/${pid}`);
        }
      });

      // Inject pulse animation CSS
      if (!document.querySelector('#leaflet-pulse-css')) {
        const style = document.createElement('style');
        style.id = 'leaflet-pulse-css';
        style.textContent = `
          @keyframes pulse { 0% { transform: scale(0.6); opacity: 1; } 100% { transform: scale(2.4); opacity: 0; } }
          .leaflet-popup-content-wrapper { border-radius: 12px !important; box-shadow: 0 4px 20px rgba(0,0,0,0.15) !important; }
          .leaflet-popup-tip { display: none !important; }
          .leaflet-control-zoom { border: none !important; }
          .leaflet-control-zoom a { background: #1a1a2e !important; color: #D97706 !important; border: 1px solid #2a2a4e !important; font-weight: 700; }
          .leaflet-control-attribution { display: none !important; }
        `;
        document.head.appendChild(style);
      }
    };

    if ((window as any).L) {
      initMap();
    } else {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = initMap;
      document.head.appendChild(script);
    }

    return () => {
      if (leafletRef.current) {
        leafletRef.current.remove();
        leafletRef.current = null;
      }
    };
  }, [places, filter, userLoc]);

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
  const webViewRef = useRef<any>(null);

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
    const load = async () => {
      try {
        const [venues, partners, concerts] = await Promise.all([
          api.get('/venues'),
          api.get('/partners'),
          api.get('/concerts'),
        ]);

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

        setPlaces(allPlaces.filter(p => p.lat !== 0));
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    load();
    // Auto-request location on mount (gives best UX)
    requestLocation();
  }, []);

  const counts = {
    all: places.length,
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
          <WebMapDirect places={places} filter={filter} userLoc={userLoc} onNavigate={(path) => router.push(path as any)} />
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
