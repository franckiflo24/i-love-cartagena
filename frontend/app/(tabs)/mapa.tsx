import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Dimensions, Platform, ScrollView, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { WebView } from 'react-native-webview';

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

function buildMapHTML(places: Place[], filter: string) {
  const filtered = filter === 'all' ? places : places.filter(p => p.category === filter);

  const markers = filtered.map(p => {
    const color = MARKER_COLORS[p.type] || MARKER_COLORS[p.category] || '#D97706';
    const safeName = p.name.replace(/'/g, "").replace(/"/g, "");
    const safeDesc = (p.extra || p.description || '').replace(/'/g, "").replace(/"/g, "").substring(0, 80);
    const safeAddr = p.address.replace(/'/g, "").replace(/"/g, "");
    const safePrice = p.price.replace(/'/g, "").replace(/"/g, "");
    const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + p.lat + ',' + p.lng;

    const priceHtml = safePrice ? '<span style="font-size:12px;color:#D97706;font-weight:700;">' + safePrice + '</span><br>' : '';

    const popupContent = '<div style=font-family:sans-serif;min-width:180px>'
      + '<div style=display:flex;align-items:center;gap:6px;margin-bottom:6px>'
      + '<div style=width:10px;height:10px;border-radius:50%;background:' + color + ';flex-shrink:0></div>'
      + '<span style=font-size:10px;color:' + color + ';text-transform:uppercase;font-weight:700>' + p.type + '</span>'
      + '</div>'
      + '<b style=font-size:15px;color:#1a1a2e>' + safeName + '</b><br>'
      + '<span style=font-size:11px;color:#666>' + safeDesc + '</span><br>'
      + '<span style=font-size:11px;color:#888>📍 ' + safeAddr + '</span><br>'
      + priceHtml
      + '<a href=' + mapsUrl + ' target=_blank style=display:inline-block;margin-top:6px;padding:6px_14px;background:#D97706;color:#fff;text-decoration:none;border-radius:20px;font-size:12px;font-weight:600>Como llegar</a>'
      + '</div>';

    return "L.circleMarker([" + p.lat + ", " + p.lng + "], {"
      + "radius: 10, fillColor: '" + color + "', color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.9"
      + "}).addTo(map).bindPopup('" + popupContent.replace(/'/g, "\\'") + "', {maxWidth: 260});";
  }).join('\n');

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
    + '</style>'
    + '</head><body>'
    + '<div id="map"></div>'
    + '<script>'
    + 'var map = L.map("map", {zoomControl: true, attributionControl: false}).setView([10.4225, -75.5480], 14);'
    + 'L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {maxZoom: 19}).addTo(map);'
    + markers
    + '<\/script>'
    + '</body></html>';
}

export default function MapaScreen() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const webViewRef = useRef<any>(null);

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

  const html = buildMapHTML(places, filter);

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
          <iframe
            key={filter}
            srcDoc={html}
            style={{ width: '100%', height: '100%', border: 'none', backgroundColor: '#050814' } as any}
          />
        ) : (
          <WebView
            ref={webViewRef}
            key={filter}
            source={{ html }}
            style={styles.webview}
            javaScriptEnabled={true}
            originWhitelist={['*']}
            scrollEnabled={false}
            bounces={false}
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
          />
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
});
