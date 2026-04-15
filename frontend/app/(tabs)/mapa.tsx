import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, Linking, Dimensions, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';

const { width: screenWidth } = Dimensions.get('window');

type Place = {
  id: string;
  name: string;
  description: string;
  category: 'venue' | 'partner' | 'concert';
  type: string;
  address: string;
  location: { lat: number; lng: number };
  image_url: string;
  price_range?: string;
  hours?: string;
  booking_link?: string;
  extra?: string;
};

const CATEGORIES = [
  { key: 'all', label: 'Todos', icon: 'grid', color: COLORS.primary },
  { key: 'venue', label: 'Venues', icon: 'location', color: '#3B82F6' },
  { key: 'partner', label: 'Partners', icon: 'diamond', color: '#8B5CF6' },
  { key: 'concert', label: 'Conciertos', icon: 'musical-notes', color: '#EC4899' },
];

const TYPE_ICONS: Record<string, string> = {
  historic: 'flag',
  nightclub: 'musical-notes',
  restaurant: 'restaurant',
  beach_club: 'sunny',
  hotel: 'bed',
  cultural: 'color-palette',
  club: 'wine',
  wellness: 'leaf',
};

const TYPE_COLORS: Record<string, string> = {
  historic: '#F59E0B',
  nightclub: '#EC4899',
  restaurant: '#EF4444',
  beach_club: '#06B6D4',
  hotel: '#3B82F6',
  cultural: '#8B5CF6',
  club: '#D97706',
  wellness: '#22C55E',
  concert: '#EC4899',
};

// Cartagena center
const CARTAGENA_CENTER = { lat: 10.4225, lng: -75.5480 };

let MapView: any = null;
let Marker: any = null;
try {
  const maps = require('react-native-maps');
  MapView = maps.default;
  Marker = maps.Marker;
} catch (e) {
  // Maps not available on web
}

export default function MapaScreen() {
  const router = useRouter();
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [venues, partners, concerts] = await Promise.all([
          api.get('/venues'),
          api.get('/partners'),
          api.get('/concerts'),
        ]);

        const allPlaces: Place[] = [];

        // Add venues
        venues.forEach((v: any) => {
          allPlaces.push({
            id: v.venue_id,
            name: v.name,
            description: v.description,
            category: 'venue',
            type: v.type,
            address: v.address,
            location: v.location,
            image_url: v.images?.[0] || '',
            price_range: v.price_range,
            hours: v.hours,
            booking_link: v.booking_link,
          });
        });

        // Add partners (avoid duplicates with venues by checking name)
        const venueNames = new Set(venues.map((v: any) => v.name.toLowerCase()));
        partners.forEach((p: any) => {
          if (!venueNames.has(p.name.toLowerCase()) && p.location) {
            allPlaces.push({
              id: p.partner_id,
              name: p.name,
              description: p.description,
              category: 'partner',
              type: p.category,
              address: p.address,
              location: p.location,
              image_url: p.image_url,
              price_range: p.price_range,
              booking_link: p.booking_link,
              extra: p.experience,
            });
          }
        });

        // Add concerts (use venue location)
        const venueLocMap: Record<string, any> = {};
        venues.forEach((v: any) => { venueLocMap[v.venue_id] = v.location; });
        concerts.forEach((c: any) => {
          const loc = venueLocMap[c.venue_id];
          if (loc) {
            // Slightly offset to avoid overlap
            const offset = (Math.random() - 0.5) * 0.001;
            allPlaces.push({
              id: c.concert_id,
              name: c.artist,
              description: c.title,
              category: 'concert',
              type: 'concert',
              address: c.venue_name,
              location: { lat: loc.lat + offset, lng: loc.lng + offset },
              image_url: c.image_url,
              extra: `${c.genre} · ${c.date} · ${c.start_time}`,
              booking_link: c.ticket_link,
              price_range: c.is_free ? 'Gratis' : `$${(c.price / 1000).toFixed(0)}K COP`,
            });
          }
        });

        setPlaces(allPlaces);
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    load();
  }, []);

  const filtered = selectedCategory === 'all'
    ? places
    : places.filter(p => p.category === selectedCategory);

  const openGoogleMaps = (place: Place) => {
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${place.location.lat},${place.location.lng}&query_place_id=${encodeURIComponent(place.name + ' Cartagena')}`);
  };

  const onMarkerPress = (place: Place) => {
    setSelectedPlace(place);
    if (mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: place.location.lat,
        longitude: place.location.lng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 300);
    }
  };

  const getMarkerColor = (place: Place) => {
    if (place.category === 'concert') return '#EC4899';
    return TYPE_COLORS[place.type] || COLORS.primary;
  };

  const canRenderMap = MapView && Platform.OS !== 'web';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Cargando mapa...</Text>
        </View>
      ) : canRenderMap ? (
        /* ── Native Map View ── */
        <View style={styles.mapContainer}>
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={{
              latitude: CARTAGENA_CENTER.lat,
              longitude: CARTAGENA_CENTER.lng,
              latitudeDelta: 0.045,
              longitudeDelta: 0.045,
            }}
            showsUserLocation
            showsMyLocationButton
          >
            {filtered.map(place => (
              <Marker
                key={place.id}
                coordinate={{ latitude: place.location.lat, longitude: place.location.lng }}
                onPress={() => onMarkerPress(place)}
                pinColor={getMarkerColor(place)}
                title={place.name}
              />
            ))}
          </MapView>

          {/* Category Filters Overlay */}
          <View style={styles.filterOverlay}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterContent}>
              {CATEGORIES.map(c => {
                const isActive = selectedCategory === c.key;
                return (
                  <TouchableOpacity
                    key={c.key}
                    style={[styles.filterChip, isActive && { backgroundColor: c.color, borderColor: c.color }]}
                    onPress={() => { setSelectedCategory(c.key); setSelectedPlace(null); }}
                  >
                    <Ionicons name={c.icon as any} size={14} color={isActive ? '#FFF' : COLORS.textMuted} />
                    <Text style={[styles.filterText, isActive && { color: '#FFF' }]}>{c.label}</Text>
                    {c.key !== 'all' && (
                      <View style={[styles.filterCount, isActive && { backgroundColor: 'rgba(255,255,255,0.3)' }]}>
                        <Text style={[styles.filterCountText, isActive && { color: '#FFF' }]}>
                          {places.filter(p => p.category === c.key).length}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Selected Place Card */}
          {selectedPlace && (
            <View style={styles.placeCard}>
              <TouchableOpacity style={styles.placeCardClose} onPress={() => setSelectedPlace(null)}>
                <Ionicons name="close" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
              <View style={styles.placeCardRow}>
                <Image source={{ uri: selectedPlace.image_url }} style={styles.placeCardImage} />
                <View style={styles.placeCardInfo}>
                  <View style={[styles.placeCardBadge, { backgroundColor: `${getMarkerColor(selectedPlace)}20` }]}>
                    <View style={[styles.placeCardDot, { backgroundColor: getMarkerColor(selectedPlace) }]} />
                    <Text style={[styles.placeCardBadgeText, { color: getMarkerColor(selectedPlace) }]}>
                      {selectedPlace.category === 'concert' ? 'Concierto' : selectedPlace.type}
                    </Text>
                  </View>
                  <Text style={styles.placeCardName} numberOfLines={1}>{selectedPlace.name}</Text>
                  <Text style={styles.placeCardDesc} numberOfLines={1}>{selectedPlace.extra || selectedPlace.description}</Text>
                  {selectedPlace.price_range && (
                    <Text style={styles.placeCardPrice}>{selectedPlace.price_range}</Text>
                  )}
                </View>
              </View>
              <View style={styles.placeCardActions}>
                <TouchableOpacity style={styles.placeCardBtn} onPress={() => openGoogleMaps(selectedPlace)}>
                  <Ionicons name="navigate" size={16} color={COLORS.primary} />
                  <Text style={styles.placeCardBtnText}>Cómo llegar</Text>
                </TouchableOpacity>
                {selectedPlace.booking_link ? (
                  <TouchableOpacity
                    style={[styles.placeCardBtn, styles.placeCardBtnPrimary]}
                    onPress={() => Linking.openURL(selectedPlace.booking_link!)}
                  >
                    <Ionicons name="ticket" size={16} color="#FFF" />
                    <Text style={styles.placeCardBtnTextPrimary}>Reservar</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          )}
        </View>
      ) : (
        /* ── Web Fallback: List View ── */
        <>
          <View style={styles.header}>
            <Text style={styles.title}>Mapa</Text>
            <Text style={styles.subtitle}>Todos los lugares · {places.length} puntos</Text>
          </View>

          {/* Category Filters */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterBarList}>
            {CATEGORIES.map(c => {
              const isActive = selectedCategory === c.key;
              return (
                <TouchableOpacity
                  key={c.key}
                  style={[styles.filterChipList, isActive && { backgroundColor: `${c.color}20`, borderColor: c.color }]}
                  onPress={() => setSelectedCategory(c.key)}
                >
                  <Ionicons name={c.icon as any} size={14} color={isActive ? c.color : COLORS.textMuted} />
                  <Text style={[styles.filterTextList, isActive && { color: c.color }]}>{c.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {filtered.map(place => (
              <TouchableOpacity
                key={place.id}
                style={styles.listCard}
                onPress={() => openGoogleMaps(place)}
                activeOpacity={0.8}
              >
                <Image source={{ uri: place.image_url }} style={styles.listImage} />
                <View style={styles.listInfo}>
                  <View style={[styles.listBadge, { backgroundColor: `${getMarkerColor(place)}20` }]}>
                    <View style={[styles.listDot, { backgroundColor: getMarkerColor(place) }]} />
                    <Text style={[styles.listBadgeText, { color: getMarkerColor(place) }]}>
                      {place.category === 'concert' ? 'Concierto' : place.type}
                    </Text>
                  </View>
                  <Text style={styles.listName} numberOfLines={1}>{place.name}</Text>
                  <Text style={styles.listDesc} numberOfLines={1}>{place.address}</Text>
                  <View style={styles.listMeta}>
                    {place.price_range && <Text style={styles.listPrice}>{place.price_range}</Text>}
                    <Ionicons name="navigate-outline" size={14} color={COLORS.primary} />
                  </View>
                </View>
              </TouchableOpacity>
            ))}
            <View style={{ height: SPACING.xxl }} />
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: SPACING.md },
  loadingText: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular },

  // Map
  mapContainer: { flex: 1, position: 'relative' },
  map: { flex: 1 },

  // Filter overlay on map
  filterOverlay: { position: 'absolute', top: SPACING.sm, left: 0, right: 0, zIndex: 10 },
  filterContent: { paddingHorizontal: SPACING.md, gap: SPACING.xs },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.full, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4 },
  filterText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold },
  filterCount: { backgroundColor: COLORS.border, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1, marginLeft: 2 },
  filterCountText: { fontSize: 10, color: COLORS.textMuted, ...FONTS.bold },

  // Place Card (bottom)
  placeCard: { position: 'absolute', bottom: SPACING.md, left: SPACING.md, right: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.3, shadowRadius: 8 },
  placeCardClose: { position: 'absolute', top: 8, right: 8, zIndex: 1, width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center' },
  placeCardRow: { flexDirection: 'row', gap: SPACING.sm },
  placeCardImage: { width: 80, height: 80, borderRadius: RADIUS.md },
  placeCardInfo: { flex: 1, gap: 2 },
  placeCardBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.full },
  placeCardDot: { width: 6, height: 6, borderRadius: 3 },
  placeCardBadgeText: { fontSize: 10, ...FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.5 },
  placeCardName: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold },
  placeCardDesc: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular },
  placeCardPrice: { fontSize: 12, color: COLORS.primary, ...FONTS.semibold, marginTop: 2 },
  placeCardActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  placeCardBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.primary },
  placeCardBtnText: { fontSize: 13, color: COLORS.primary, ...FONTS.semibold },
  placeCardBtnPrimary: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  placeCardBtnTextPrimary: { fontSize: 13, color: '#FFF', ...FONTS.semibold },

  // Web Fallback List
  header: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.sm },
  title: { fontSize: 28, color: COLORS.textMain, ...FONTS.bold },
  subtitle: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },
  filterBarList: { paddingHorizontal: SPACING.lg, gap: SPACING.sm, paddingVertical: SPACING.sm },
  filterChipList: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SPACING.md, paddingVertical: 8, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border },
  filterTextList: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium },
  list: { flex: 1, paddingHorizontal: SPACING.lg },
  listCard: { flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, overflow: 'hidden', marginBottom: SPACING.sm, borderWidth: 1, borderColor: COLORS.border },
  listImage: { width: 90, height: 90 },
  listInfo: { flex: 1, padding: SPACING.sm, gap: 2 },
  listBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 1, borderRadius: RADIUS.full },
  listDot: { width: 6, height: 6, borderRadius: 3 },
  listBadgeText: { fontSize: 9, ...FONTS.bold, textTransform: 'uppercase', letterSpacing: 0.5 },
  listName: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold },
  listDesc: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  listMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  listPrice: { fontSize: 11, color: COLORS.primary, ...FONTS.semibold },
});
