import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
  Dimensions,
  RefreshControl,
  Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  COLORS,
  SPACING,
  RADIUS,
  FONTS,
  TIER_COLORS,
  PARTNER_CATEGORY_LABELS,
  Tier,
} from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { IMAGES, getCategoryImage } from '../../src/constants/images';
import { TierBadge } from '../../src/components/TierBadge';
import { SafeImage } from '../../src/components/SafeImage';
import { SkeletonFeaturedRow, SkeletonGrid } from '../../src/components/Skeleton';
import { useLang } from '../../src/context/LanguageContext';
import { useTr } from '../../src/i18n/autoTr';
import { getUpcomingEvents } from '../../src/lib/data';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = (SCREEN_WIDTH - SPACING.lg * 2 - SPACING.sm) / 2;
const FEATURED_CARD_WIDTH = SCREEN_WIDTH * 0.72;

// ── Types ────────────────────────────────────────────────────────────────────

type Experience = {
  experience_id?: string;
  partner_id?: string;
  name?: string;
  title?: string;
  description: string;
  image_url: string;
  price?: number;
  price_range?: string;
  is_free?: boolean;
  category: string;
  partner_name?: string;
  partner_tier?: string;
  tier?: string;
  experience?: string;
};

type Partner = {
  partner_id: string;
  name: string;
  description: string;
  category: string;
  image_url: string;
  address: string;
  price_range: string;
  is_certified: boolean;
  tier?: Tier;
};

type Neighborhood = {
  id: string;
  slug: string;
  name: string;
  aka: string[];
  character_es: string;
  character_en: string;
  safety_rating: number;
  safety_notes_day_es?: string;
  safety_notes_night_es?: string;
  safety_notes_day_en?: string;
  safety_notes_night_en?: string;
  price_index: number;
  best_for: string[];
  how_to_get_there_es?: string;
  how_to_get_there_en?: string;
  taxi_fare_from_airport_cop: number;
  tourist_mistakes_es: string;
  tourist_mistakes_en: string;
  centroid_lat: number;
  centroid_lng: number;
};

// ── Category definitions ──────────────────────────────────────────────────────

type CategoryItem = {
  key: string;
  label: string;
  icon: string;
  apiValue: string | null;
};

const CATEGORIES: CategoryItem[] = [
  { key: 'all',        label: 'Todos',       icon: 'apps',             apiValue: null },
  { key: 'restaurants',label: 'Restaurantes',icon: 'restaurant',       apiValue: 'restaurant' },
  { key: 'bars',       label: 'Bares',       icon: 'wine',             apiValue: 'bar' },
  { key: 'cafes',      label: 'Cafés',       icon: 'cafe',             apiValue: 'cafe' },
  { key: 'nightlife',  label: 'Nightlife',   icon: 'musical-notes',    apiValue: 'club' },
  { key: 'spas',       label: 'Spa',         icon: 'leaf',             apiValue: 'spa' },
  { key: 'beachclubs', label: 'Beach Clubs', icon: 'umbrella',         apiValue: 'beach_club' },
  { key: 'yachts',     label: 'Yachts',      icon: 'boat',             apiValue: 'yacht' },
  { key: 'beauty',     label: 'Belleza',     icon: 'cut',              apiValue: 'beauty' },
  { key: 'activities', label: 'Experiencias',icon: 'compass',          apiValue: 'activity' },
  { key: 'hotels',     label: 'Hoteles',     icon: 'bed',              apiValue: 'hotel' },
  { key: 'daypass',    label: 'Day Pass',    icon: 'sunny-outline',    apiValue: 'daypass' },
];

// ── Sub-categories per main category ──────────────────────────────────────────
type Subcat = { key: string; label: string; icon: string };

const SUBCATEGORIES: Record<string, Subcat[]> = {
  restaurant: [
    { key: 'international', label: 'Internacional',  icon: 'globe' },
    { key: 'seafood',       label: 'Mariscos',       icon: 'fish' },
    { key: 'colombian',     label: 'Colombiana',     icon: 'flag' },
    { key: 'italian',       label: 'Italiana',       icon: 'pizza' },
    { key: 'asian',         label: 'Asiática',       icon: 'restaurant' },
    { key: 'mediterranean', label: 'Mediterránea',   icon: 'leaf' },
    { key: 'vegetarian',    label: 'Vegetariana',    icon: 'nutrition' },
    { key: 'gastronomic',   label: 'Gastronómica',   icon: 'wine' },
    { key: 'fastfood',      label: 'Rápida',         icon: 'fast-food' },
    { key: 'arab',          label: 'Árabe',          icon: 'restaurant' },
  ],
  bar: [
    { key: 'cocktail_bar',  label: 'Cocktail Bar',   icon: 'wine' },
    { key: 'rooftop',       label: 'Rooftop',        icon: 'business' },
    { key: 'lounge',        label: 'Lounge',         icon: 'cafe' },
    { key: 'salsa_bar',     label: 'Salsa Bar',      icon: 'musical-notes' },
  ],
  club: [
    { key: 'nightclub',     label: 'Nightclub',      icon: 'musical-notes' },
    { key: 'live_music',    label: 'Live Music',     icon: 'mic' },
    { key: 'champeta',      label: 'Champeta',       icon: 'musical-note' },
    { key: 'lounge',        label: 'Lounge',         icon: 'cafe' },
  ],
  cafe: [
    { key: 'coffee',        label: 'Café',           icon: 'cafe' },
    { key: 'brunch',        label: 'Brunch',         icon: 'sunny' },
    { key: 'bakery',        label: 'Panadería',      icon: 'pizza' },
  ],
  spa: [
    { key: 'massage',         label: 'Masajes',         icon: 'hand-right' },
    { key: 'wellness_center', label: 'Centros Wellness',icon: 'leaf' },
  ],
  hotel: [
    { key: 'lujo',          label: 'Lujo',           icon: 'star' },
    { key: 'premium',       label: 'Premium',        icon: 'diamond' },
    { key: 'boutique',      label: 'Boutique',       icon: 'bed' },
    { key: 'popular',       label: 'Popular',        icon: 'home' },
  ],
  activity: [
    { key: 'cultural',      label: 'Cultural',       icon: 'library' },
    { key: 'yacht',         label: 'Yates',          icon: 'boat' },
    { key: 'concierge',     label: 'Concierge',      icon: 'briefcase' },
  ],
  beach_club: [
    { key: 'beach_club',    label: 'Beach Clubs',    icon: 'umbrella' },
    { key: 'cocktail_bar',  label: 'Cocktails',      icon: 'wine' },
    { key: 'boutique',      label: 'Boutique',       icon: 'bed' },
  ],
  beauty: [
    { key: 'salon',           label: 'Salón',           icon: 'cut' },
    { key: 'barbershop',      label: 'Barbería',        icon: 'cut' },
    { key: 'nails',           label: 'Uñas',            icon: 'color-palette' },
    { key: 'makeup',          label: 'Maquillaje',      icon: 'brush' },
    { key: 'facial_spa',      label: 'Facial & Spa',    icon: 'flower' },
    { key: 'aesthetic_clinic', label: 'Clínica Estética',icon: 'medkit' },
    { key: 'lashes_brows',   label: 'Cejas & Pestañas', icon: 'eye' },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const formatPrice = (price: number, isFree: boolean): string | null => {
  if (isFree) return 'Gratis';
  if (!price) return null;
  return `$${(price / 1000).toFixed(0)}K`;
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SearchBarButton({ onPress }: { onPress: () => void }) {
  const tr = useTr();
  return (
    <TouchableOpacity style={styles.searchBar} onPress={onPress} activeOpacity={0.8}>
      <Ionicons name="search" size={16} color={COLORS.textMuted} />
      <Text style={styles.searchPlaceholder}>{tr('Buscar en Cartagena…')}</Text>
      {/* IA pill hidden — investor demo */}
      {false && (
        <View style={styles.searchAiPill}>
          <Ionicons name="sparkles" size={11} color={COLORS.primary} />
          <Text style={styles.searchAiText}>IA</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function FeaturedCard({
  item,
  onPress,
}: {
  item: Experience;
  onPress: () => void;
}) {
  const price = formatPrice(item.price ?? 0, item.is_free ?? !item.price);
  const tierStr = item.partner_tier || item.tier || '';
  const tierColor = tierStr ? TIER_COLORS[tierStr as Tier] : null;
  return (
    <TouchableOpacity
      style={styles.featuredCard}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <SafeImage
        uri={item.image_url}
        category={item.category}
        style={styles.featuredImage}
      />
      <View style={styles.featuredOverlay} />
      {tierColor && (
        <View style={[styles.featuredTierStripe, { backgroundColor: tierColor.main }]} />
      )}
      <View style={styles.featuredContent}>
        <View style={styles.featuredTopRow}>
          {tierStr && (
            <TierBadge tier={tierStr} size="xs" />
          )}
          {price && (
            <View
              style={[
                styles.pricePill,
                item.is_free ? styles.pricePillFree : styles.pricePillPaid,
              ]}
            >
              <Text style={styles.pricePillText}>{price}</Text>
            </View>
          )}
        </View>
        <Text style={styles.featuredTitle} numberOfLines={2}>
          {item.title || item.name || ''}
        </Text>
        {(item.partner_name || item.experience) && (
          <View style={styles.featuredPartnerRow}>
            <Ionicons name="business-outline" size={11} color="rgba(255,255,255,0.65)" />
            <Text style={styles.featuredPartnerText} numberOfLines={1}>
              {item.partner_name || item.experience || ''}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

function PartnerGridCard({
  partner,
  onPress,
}: {
  partner: Partner;
  onPress: () => void;
}) {
  const tierColor = partner.tier ? TIER_COLORS[partner.tier] : null;
  return (
    <TouchableOpacity
      style={[
        styles.gridCard,
        tierColor && { borderColor: tierColor.border, borderWidth: 1.5 },
      ]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <SafeImage
        uri={partner.image_url}
        category={partner.category}
        style={styles.gridImage}
      />
      <View style={styles.gridOverlay} />
      {tierColor && (
        <View style={[styles.gridTierStripe, { backgroundColor: tierColor.main }]} />
      )}
      <View style={styles.gridTopRow}>
        {partner.tier && <TierBadge tier={partner.tier} size="xs" showLabel={false} />}
        {partner.is_certified && (
          <View style={styles.certDot}>
            <Ionicons name="shield-checkmark" size={10} color={COLORS.primary} />
          </View>
        )}
      </View>
      <View style={styles.gridContent}>
        <View style={styles.gridMetaRow}>
          {partner.price_range ? (
            <View style={styles.gridPricePill}>
              <Text style={styles.gridPriceText}>{partner.price_range}</Text>
            </View>
          ) : null}
          {(partner as any).rating ? (
            <View style={styles.gridRatingPill}>
              <Ionicons name="star" size={10} color={COLORS.primary} />
              <Text style={styles.gridRatingText}>{Number((partner as any).rating).toFixed(1)}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.gridName} numberOfLines={2}>
          {partner.name}
        </Text>
        <Text style={styles.gridCategory} numberOfLines={1}>
          {PARTNER_CATEGORY_LABELS[(partner as any).category] || (partner as any).category || ''}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Best-for label mapping ───────────────────────────────────────────────────
const BEST_FOR_LABELS: Record<string, string> = {
  luxury: 'Lujo', romance: 'Romance', culture: 'Cultura', nightlife: 'Nightlife',
  food: 'Gastronomía', first_timers: 'Primera vez', budget: 'Económico',
  beach: 'Playa', families: 'Familias', shopping: 'Shopping', couples: 'Parejas',
  solo: 'Solo', locals: 'Locales', longer_stays: 'Estancias largas',
  returning_visitors: 'Repetidores', authentic: 'Auténtico', experiences: 'Experiencias',
  day_trip: 'Plan de día', groups: 'Grupos',
};

// ── Neighborhood card (horizontal scroll) ────────────────────────────────────
function NeighborhoodCard({
  item,
  onPress,
}: {
  item: Neighborhood;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.nbCard} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.nbCardInner}>
        <Text style={styles.nbName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.nbCharacter} numberOfLines={2}>{item.character_es}</Text>
        <View style={styles.nbRatingsRow}>
          <View style={styles.nbRatingGroup}>
            <Ionicons name="shield-checkmark" size={12} color={COLORS.primary} />
            {Array.from({ length: 5 }).map((_, i) => (
              <Ionicons
                key={`s${i}`}
                name={i < item.safety_rating ? 'star' : 'star-outline'}
                size={10}
                color={i < item.safety_rating ? COLORS.primary : COLORS.textMuted}
              />
            ))}
          </View>
          <Text style={styles.nbPrice}>
            {'$'.repeat(item.price_index)}
            <Text style={{ color: COLORS.textMuted }}>{'$'.repeat(5 - item.price_index)}</Text>
          </Text>
        </View>
        <View style={styles.nbTagsRow}>
          {item.best_for.slice(0, 3).map((tag) => (
            <View key={tag} style={styles.nbTag}>
              <Text style={styles.nbTagText}>{BEST_FOR_LABELS[tag] || tag}</Text>
            </View>
          ))}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Neighborhood detail modal ────────────────────────────────────────────────
function NeighborhoodDetailModal({
  item,
  visible,
  onClose,
}: {
  item: Neighborhood | null;
  visible: boolean;
  onClose: () => void;
}) {
  if (!item) return null;
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.nbModalOverlay}>
        <View style={styles.nbModalSheet}>
          <View style={styles.nbModalHandle} />
          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
            <Text style={styles.nbModalTitle}>{item.name}</Text>
            {item.aka.length > 0 && (
              <Text style={styles.nbModalAka}>a.k.a. {item.aka.join(', ')}</Text>
            )}

            <Text style={styles.nbModalDesc}>{item.character_es}</Text>
            <Text style={[styles.nbModalDesc, { marginTop: SPACING.xs, color: COLORS.textMuted }]}>
              {item.character_en}
            </Text>

            {/* Safety */}
            <View style={styles.nbModalSection}>
              <View style={styles.nbModalSectionHeader}>
                <Ionicons name="shield-checkmark" size={16} color={COLORS.primary} />
                <Text style={styles.nbModalSectionTitle}>Seguridad</Text>
              </View>
              <View style={styles.nbModalStarsRow}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Ionicons
                    key={`ms${i}`}
                    name={i < item.safety_rating ? 'star' : 'star-outline'}
                    size={16}
                    color={i < item.safety_rating ? COLORS.primary : COLORS.textMuted}
                  />
                ))}
                <Text style={styles.nbModalRatingText}>{item.safety_rating}/5</Text>
              </View>
              {item.safety_notes_day_es && (
                <Text style={styles.nbModalNote}>
                  <Ionicons name="sunny-outline" size={12} color={COLORS.textMuted} /> {item.safety_notes_day_es}
                </Text>
              )}
              {item.safety_notes_night_es && (
                <Text style={styles.nbModalNote}>
                  <Ionicons name="moon-outline" size={12} color={COLORS.textMuted} /> {item.safety_notes_night_es}
                </Text>
              )}
            </View>

            {/* Price Level */}
            <View style={styles.nbModalSection}>
              <View style={styles.nbModalSectionHeader}>
                <Ionicons name="cash-outline" size={16} color={COLORS.primary} />
                <Text style={styles.nbModalSectionTitle}>Nivel de precios</Text>
              </View>
              <Text style={styles.nbModalPriceLevel}>
                {'$'.repeat(item.price_index)}
                <Text style={{ color: COLORS.textMuted }}>{'$'.repeat(5 - item.price_index)}</Text>
              </Text>
            </View>

            {/* Airport taxi fare */}
            <View style={styles.nbModalSection}>
              <View style={styles.nbModalSectionHeader}>
                <Ionicons name="car-outline" size={16} color={COLORS.primary} />
                <Text style={styles.nbModalSectionTitle}>Taxi desde el aeropuerto</Text>
              </View>
              <Text style={styles.nbModalFare}>
                ${item.taxi_fare_from_airport_cop.toLocaleString()} COP
              </Text>
            </View>

            {/* Best for */}
            <View style={styles.nbModalSection}>
              <View style={styles.nbModalSectionHeader}>
                <Ionicons name="heart-outline" size={16} color={COLORS.primary} />
                <Text style={styles.nbModalSectionTitle}>Ideal para</Text>
              </View>
              <View style={styles.nbModalTags}>
                {item.best_for.map((tag) => (
                  <View key={tag} style={styles.nbModalTag}>
                    <Text style={styles.nbModalTagText}>{BEST_FOR_LABELS[tag] || tag}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Tourist mistake */}
            <View style={styles.nbModalSection}>
              <View style={styles.nbModalSectionHeader}>
                <Ionicons name="warning-outline" size={16} color="#F59E0B" />
                <Text style={styles.nbModalSectionTitle}>Error de turista</Text>
              </View>
              <Text style={styles.nbModalNote}>{item.tourist_mistakes_es}</Text>
              <Text style={[styles.nbModalNote, { color: COLORS.textMuted, marginTop: 4 }]}>{item.tourist_mistakes_en}</Text>
            </View>

            <View style={{ height: SPACING.xl }} />
          </ScrollView>

          <TouchableOpacity style={styles.nbModalCloseBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.nbModalCloseBtnText}>Cerrar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function ExploreScreen() {
  const router = useRouter();
  const { category: routeCategory, subcategory: routeSubcategory } =
    useLocalSearchParams<{ category?: string; subcategory?: string }>();
  const { s } = useLang();
  const tr = useTr();

  const [selectedCategory, setSelectedCategory] = useState<CategoryItem>(CATEGORIES[0]);
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);
  const [featured, setFeatured] = useState<Experience[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<any[]>([]);
  const [allCategoryPartners, setAllCategoryPartners] = useState<Partner[]>([]);
  const [loadingFeatured, setLoadingFeatured] = useState(true);
  const [loadingPartners, setLoadingPartners] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);
  const [loadingNeighborhoods, setLoadingNeighborhoods] = useState(true);
  const [selectedNeighborhood, setSelectedNeighborhood] = useState<Neighborhood | null>(null);
  const [nbModalVisible, setNbModalVisible] = useState(false);

  // When navigated with a category param (from home cards), switch to that filter
  useEffect(() => {
    if (routeCategory) {
      const match = CATEGORIES.find(c => c.apiValue === routeCategory);
      if (match) {
        setSelectedCategory(match);
        // Clear any previous sub-category when category param changes
        setSelectedSubcategory(routeSubcategory || null);
      }
    }
  }, [routeCategory, routeSubcategory]);

  // Wrapper that resets subcategory when category changes via chip strip
  const selectCategory = useCallback((cat: CategoryItem) => {
    setSelectedCategory(cat);
    setSelectedSubcategory(null);
  }, []);

  const loadFeatured = useCallback(async () => {
    try {
      const data = await api.get('/experiences/featured');
      setFeatured(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('[ExploreScreen] featured', e);
      setFeatured([]);
    } finally {
      setLoadingFeatured(false);
    }
  }, []);

  const loadPartners = useCallback(async (category: CategoryItem) => {
    setLoadingPartners(true);
    try {
      // Always fetch full set; filter client-side so static + live both work.
      const data = await api.get('/partners');
      const all: Partner[] = Array.isArray(data) ? data : [];
      const filtered = category.apiValue
        ? all.filter(p => p.category === category.apiValue)
        : all;
      // Sort: elite first, then premium, then by rating descending
      const tierOrder: Record<string, number> = { elite: 0, premium: 1, popular: 2, standard: 3 };
      filtered.sort((a, b) => {
        const ta = tierOrder[(a as any).tier] ?? 3;
        const tb = tierOrder[(b as any).tier] ?? 3;
        if (ta !== tb) return ta - tb;
        return ((b as any).rating || 0) - ((a as any).rating || 0);
      });
      setAllCategoryPartners(filtered);
    } catch (e) {
      console.error('[ExploreScreen] partners', e);
      setAllCategoryPartners([]);
    } finally {
      setLoadingPartners(false);
    }
  }, []);

  const loadNeighborhoods = useCallback(async () => {
    try {
      const data = await api.get('/neighborhoods');
      setNeighborhoods(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('[ExploreScreen] neighborhoods', e);
      setNeighborhoods([]);
    } finally {
      setLoadingNeighborhoods(false);
    }
  }, []);

  const loadUpcomingEvents = useCallback(async () => {
    try {
      const evts = await getUpcomingEvents();
      // Map to compat fields + filter for images
      const mapped = evts.filter((e: any) => e.image_url).map((e: any) => ({
        ...e,
        event_id: e.slug || e.id || e.event_id,
        title: e.name_es || e.title || '',
        date: e.date_start || e.date || '',
        type: e.category || e.type || '',
        start_time: e.time_start || e.start_time || '',
        venue_name: e.venue || e.venue_name || '',
        price: e.price_min_cop || e.price || 0,
      }));
      setUpcomingEvents(mapped);
    } catch (e) {
      console.error('[ExploreScreen] upcoming events', e);
      setUpcomingEvents([]);
    }
  }, []);

  useEffect(() => {
    loadFeatured();
    loadNeighborhoods();
    loadUpcomingEvents();
  }, [loadFeatured, loadNeighborhoods, loadUpcomingEvents]);

  useEffect(() => {
    loadPartners(selectedCategory);
  }, [selectedCategory, loadPartners]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadFeatured(), loadPartners(selectedCategory), loadNeighborhoods(), loadUpcomingEvents()]);
    setRefreshing(false);
  }, [loadFeatured, loadPartners, loadNeighborhoods, loadUpcomingEvents, selectedCategory]);

  // ── Derived view state ──────────────────────────────────────────
  // Sub-categories available for the current main category (if any).
  const availableSubcats: Subcat[] = selectedCategory.apiValue
    ? (SUBCATEGORIES[selectedCategory.apiValue] || [])
    : [];

  // Are we showing the sub-category gateway (tiles) or the partner grid?
  // Gateway shows when: category has subs AND user hasn't picked one yet.
  const inSubcatGateway =
    availableSubcats.length > 0 && !selectedSubcategory;

  // Partners shown in the grid: respect subcategory filter when set.
  // '__all__' sentinel means "show all in this category" (skip subcat filter).
  const partners: Partner[] =
    selectedSubcategory && selectedSubcategory !== '__all__'
      ? allCategoryPartners.filter(p => (p as any).subcategory === selectedSubcategory)
      : allCategoryPartners;

  // Count of partners per subcategory for tile badges
  const subcatCounts: Record<string, number> = {};
  for (const p of allCategoryPartners) {
    const sk = (p as any).subcategory;
    if (sk) subcatCounts[sk] = (subcatCounts[sk] || 0) + 1;
  }

  // Resolved label for currently selected subcategory (for the back-header)
  const subcatLabel = availableSubcats.find(s => s.key === selectedSubcategory)?.label || '';

  // ── List header: title + search + category chips + featured section ────────

  const ListHeader = (
    <View>
      {/* ── Hero Banner ── */}
      <View style={styles.exploreHero}>
        <SafeImage uri={IMAGES.cartagena_aerial} style={styles.exploreHeroImg} />
        <View style={styles.exploreHeroOverlay} />
        <View style={styles.exploreHeroContent}>
          <Text style={styles.title}>Explorar</Text>
          <Text style={styles.subtitle}>Descubre lo mejor de Cartagena</Text>
        </View>
        <TouchableOpacity
          style={styles.mapBtn}
          onPress={() => router.push('/mapa' as any)}
          activeOpacity={0.8}
        >
          <Ionicons name="map-outline" size={18} color={COLORS.primary} />
        </TouchableOpacity>
      </View>
      <View style={styles.header}>
        <SearchBarButton onPress={() => router.push('/search')} />
      </View>

      {/* ── Category chips ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        style={styles.chipScroll}
      >
        {CATEGORIES.map((cat) => {
          const active = selectedCategory.key === cat.key;
          return (
            <TouchableOpacity
              key={cat.key}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => selectCategory(cat)}
              activeOpacity={0.8}
            >
              <Ionicons
                name={cat.icon as any}
                size={12}
                color={active ? COLORS.white : COLORS.textMuted}
              />
              <Text
                style={[styles.chipText, active && styles.chipTextActive]}
              >
                {tr(cat.label)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Featured experiences ── */}
      {(loadingFeatured || featured.length > 0) && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              <Ionicons name="sparkles" size={14} color={COLORS.primary} />
              {'  '}Experiencias Destacadas
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/search')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.seeAll}>{tr('Ver todo')}</Text>
            </TouchableOpacity>
          </View>

          {loadingFeatured ? (
            <SkeletonFeaturedRow />
          ) : (
            <FlatList
              data={featured}
              keyExtractor={(item) => item.experience_id || item.partner_id || item.name || ''}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.featuredList}
              renderItem={({ item }) => (
                <FeaturedCard
                  item={item}
                  onPress={() => {
                    const id = item.partner_id || item.experience_id;
                    const route = item.partner_id ? `/partner/${id}` : `/experience/${id}`;
                    router.push(route as any);
                  }}
                />
              )}
            />
          )}
        </View>
      )}

      {/* ── Eventos destacados — major Cartagena events ── */}
      {upcomingEvents.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              <Ionicons name="calendar" size={14} color={COLORS.primary} />
              {'  '}Eventos destacados
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/agenda' as any)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.seeAll}>{tr('Ver todos')}</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={upcomingEvents.slice(0, 10)}
            keyExtractor={(item) => item.event_id || item.id || item.slug}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.featuredList}
            renderItem={({ item: ev }) => {
              const MONTHS = ['', 'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
              const evDate = ev.date_start || ev.date || '';
              let dateLabel = '';
              if (evDate) {
                try {
                  const d = new Date(evDate + 'T00:00:00');
                  dateLabel = `${d.getDate()} ${MONTHS[d.getMonth() + 1]}`;
                } catch { dateLabel = ''; }
              }
              const catLabel = ev.category === 'festival' ? 'Festival' : ev.category === 'cultural' ? 'Cultural' : ev.category === 'music' ? 'Musica' : ev.category === 'religious' ? 'Religioso' : ev.category === 'sports' ? 'Deportes' : ev.category || ev.type || '';
              return (
                <TouchableOpacity
                  style={styles.eventCard}
                  activeOpacity={0.85}
                  onPress={() => router.push(`/event/${ev.event_id || ev.slug}` as any)}
                >
                  <SafeImage uri={ev.image_url} style={styles.eventCardImage} resizeMode="cover" />
                  <View style={styles.eventCardOverlay} />
                  {dateLabel ? (
                    <View style={styles.eventCardDateBadge}>
                      <Text style={styles.eventCardDateText}>{dateLabel}</Text>
                    </View>
                  ) : null}
                  <View style={styles.eventCardContent}>
                    <View style={styles.eventCardCatBadge}>
                      <Text style={styles.eventCardCatText}>{catLabel.toUpperCase()}</Text>
                    </View>
                    <Text style={styles.eventCardTitle} numberOfLines={2}>
                      {ev.title || ev.name_es || ''}
                    </Text>
                    {ev.venue_name && (
                      <View style={styles.eventCardVenueRow}>
                        <Ionicons name="location-outline" size={11} color="rgba(255,255,255,0.65)" />
                        <Text style={styles.eventCardVenueText} numberOfLines={1}>{ev.venue_name}</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      )}

      {/* ── Barrios de Cartagena ── */}
      {(loadingNeighborhoods || neighborhoods.length > 0) && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              <Ionicons name="location" size={14} color={COLORS.primary} />
              {'  '}{tr('Barrios de Cartagena')}
            </Text>
          </View>

          {loadingNeighborhoods ? (
            <SkeletonFeaturedRow />
          ) : (
            <FlatList
              data={neighborhoods}
              keyExtractor={(item) => item.id}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.featuredList}
              renderItem={({ item }) => (
                <NeighborhoodCard
                  item={item}
                  onPress={() => {
                    setSelectedNeighborhood(item);
                    setNbModalVisible(true);
                  }}
                />
              )}
            />
          )}
        </View>
      )}

      {/* ── Partners grid header / sub-category gateway ── */}
      {inSubcatGateway ? (
        <View>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              Elige tu {selectedCategory.label.replace(/s$/, '').toLowerCase()}
            </Text>
            {allCategoryPartners.length > 0 && (
              <TouchableOpacity onPress={() => setSelectedSubcategory('__all__')} activeOpacity={0.8}>
                <Text style={styles.seeAll}>Ver todos</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.subcatGrid}>
            {availableSubcats.map((sc) => {
              const count = subcatCounts[sc.key] || 0;
              if (count === 0) return null;
              return (
                <TouchableOpacity
                  key={sc.key}
                  style={styles.subcatTile}
                  activeOpacity={0.85}
                  onPress={() => setSelectedSubcategory(sc.key)}
                >
                  <View style={styles.subcatIconWrap}>
                    <Ionicons name={sc.icon as any} size={22} color={COLORS.primary} />
                  </View>
                  <Text style={styles.subcatLabel} numberOfLines={1}>{tr(sc.label)}</Text>
                  <Text style={styles.subcatCount}>{count} {count !== 1 ? tr('lugares') : tr('lugar')}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : (
        <View style={styles.sectionHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            {selectedSubcategory && availableSubcats.length > 0 && (
              <TouchableOpacity
                onPress={() => setSelectedSubcategory(null)}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ marginRight: SPACING.sm }}
              >
                <Ionicons name="chevron-back" size={20} color={COLORS.primary} />
              </TouchableOpacity>
            )}
            <Text style={styles.sectionTitle}>
              {selectedCategory.key === 'all'
                ? 'Todos los Lugares'
                : selectedSubcategory && selectedSubcategory !== '__all__'
                ? `${selectedCategory.label} · ${subcatLabel}`
                : selectedCategory.label}
            </Text>
          </View>
          {partners.length > 0 && (
            <Text style={styles.countText}>
              {partners.length} {partners.length !== 1 ? tr('lugares') : tr('lugar')}
            </Text>
          )}
        </View>
      )}
    </View>
  );

  // ── Empty / loading state for grid ────────────────────────────────────────

  const ListEmpty = loadingPartners ? (
    <SkeletonGrid rows={3} />
  ) : (
    <View style={styles.emptyState}>
      <Ionicons name="search-outline" size={48} color={COLORS.textMuted} />
      <Text style={styles.emptyTitle}>Próximamente</Text>
      <Text style={styles.emptyText}>
        No hay lugares en esta categoría todavía
      </Text>
      <TouchableOpacity
        style={styles.emptyBtn}
        onPress={() => setSelectedCategory(CATEGORIES[0])}
        activeOpacity={0.85}
      >
        <Text style={styles.emptyBtnText}>Ver todos</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        data={inSubcatGateway ? [] : partners}
        keyExtractor={(item) => item.partner_id}
        numColumns={2}
        columnWrapperStyle={inSubcatGateway ? undefined : styles.columnWrapper}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={inSubcatGateway ? null : ListEmpty}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
          />
        }
        renderItem={({ item }) => (
          <PartnerGridCard
            partner={item}
            onPress={() => router.push(`/partner/${item.partner_id}` as any)}
          />
        )}
        ListFooterComponent={
          partners.length > 0 ? (
            <View style={styles.footer}>
              <TouchableOpacity
                style={styles.footerBtn}
                onPress={() => router.push('/partners' as any)}
                activeOpacity={0.85}
              >
                <Text style={styles.footerBtnText}>Ver todos los partners</Text>
                <Ionicons
                  name="arrow-forward"
                  size={14}
                  color={COLORS.primary}
                />
              </TouchableOpacity>
            </View>
          ) : null
        }
      />
      <NeighborhoodDetailModal
        item={selectedNeighborhood}
        visible={nbModalVisible}
        onClose={() => setNbModalVisible(false)}
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  // Header
  header: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
    gap: SPACING.md,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 28,
    color: COLORS.textMain,
    ...FONTS.bold,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    ...FONTS.regular,
    marginTop: 2,
  },
  exploreHero: { height: 160, position: 'relative', overflow: 'hidden' },
  exploreHeroImg: { position: 'absolute', width: '100%', height: '100%' },
  exploreHeroOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(5,8,20,0.6)' },
  exploreHeroContent: { position: 'absolute', bottom: SPACING.md, left: SPACING.lg },
  mapBtn: {
    position: 'absolute',
    bottom: SPACING.md,
    right: SPACING.lg,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },

  // Search bar
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  searchPlaceholder: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textMuted,
    ...FONTS.regular,
  },
  searchAiPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(217,119,6,0.15)',
    borderRadius: RADIUS.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(217,119,6,0.35)',
  },
  searchAiText: {
    fontSize: 10,
    color: COLORS.primary,
    ...FONTS.bold,
    letterSpacing: 0.5,
  },

  // Category chips
  chipScroll: {
    flexGrow: 0,
  },
  chipRow: {
    paddingHorizontal: SPACING.lg,
    gap: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: 12,
    color: COLORS.textMuted,
    ...FONTS.semibold,
  },
  chipTextActive: {
    color: COLORS.white,
  },

  // Section header
  section: {
    marginTop: SPACING.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    marginTop: SPACING.sm,
  },
  sectionTitle: {
    fontSize: 16,
    color: COLORS.textMain,
    ...FONTS.bold,
  },
  seeAll: {
    fontSize: 12,
    color: COLORS.primary,
    ...FONTS.semibold,
  },
  countText: {
    fontSize: 12,
    color: COLORS.textMuted,
    ...FONTS.medium,
  },

  // Featured cards (horizontal scroll)
  featuredList: {
    paddingHorizontal: SPACING.lg,
    gap: SPACING.sm,
    paddingBottom: SPACING.xs,
  },
  featuredCard: {
    width: FEATURED_CARD_WIDTH,
    height: 200,
    borderRadius: RADIUS.xl,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  featuredImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  featuredOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5,8,20,0.45)',
  },
  featuredTierStripe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    zIndex: 2,
  },
  featuredContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: SPACING.md,
    gap: SPACING.xs,
  },
  featuredTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  pricePill: {
    borderRadius: RADIUS.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pricePillFree: {
    backgroundColor: COLORS.success,
  },
  pricePillPaid: {
    backgroundColor: 'rgba(217,119,6,0.85)',
  },
  pricePillText: {
    fontSize: 10,
    color: COLORS.white,
    ...FONTS.bold,
    letterSpacing: 0.4,
  },
  featuredTitle: {
    fontSize: 16,
    color: COLORS.white,
    ...FONTS.bold,
    lineHeight: 21,
  },
  featuredPartnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  featuredPartnerText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.65)',
    ...FONTS.medium,
  },

  // Grid layout
  listContent: {
    paddingBottom: SPACING.xl,
  },
  columnWrapper: {
    paddingHorizontal: SPACING.lg,
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },

  // Grid card
  gridCard: {
    width: CARD_WIDTH,
    height: 170,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  gridImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  gridOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5,8,20,0.45)',
  },
  gridTierStripe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    zIndex: 2,
  },
  gridTopRow: {
    position: 'absolute',
    top: SPACING.sm,
    left: SPACING.sm,
    right: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    zIndex: 3,
  },
  certDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(5,8,20,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(217,119,6,0.4)',
  },
  gridContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: SPACING.sm,
    gap: 4,
  },
  gridPricePill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(5,8,20,0.75)',
    borderRadius: RADIUS.full,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(217,119,6,0.35)',
  },
  gridPriceText: {
    fontSize: 9,
    color: COLORS.primary,
    ...FONTS.bold,
    letterSpacing: 0.4,
  },
  gridMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  gridRatingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(5,8,20,0.75)',
    borderRadius: RADIUS.full,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  gridRatingText: {
    fontSize: 9,
    color: COLORS.primary,
    ...FONTS.bold,
  },
  gridName: {
    fontSize: 13,
    color: COLORS.white,
    ...FONTS.bold,
    lineHeight: 17,
  },
  gridCategory: {
    fontSize: 10,
    color: COLORS.textMuted,
    ...FONTS.medium,
    marginTop: 1,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingTop: SPACING.xl,
    paddingHorizontal: SPACING.xl,
    gap: SPACING.sm,
  },
  emptyTitle: {
    fontSize: 16,
    color: COLORS.textMain,
    ...FONTS.semibold,
    marginTop: SPACING.xs,
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textMuted,
    ...FONTS.regular,
    textAlign: 'center',
    lineHeight: 19,
  },
  emptyBtn: {
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 10,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.full,
  },
  emptyBtnText: {
    fontSize: 13,
    color: COLORS.white,
    ...FONTS.bold,
  },

  // Footer
  footer: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.lg,
  },
  footerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: 14,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: 'rgba(217,119,6,0.35)',
    backgroundColor: 'rgba(217,119,6,0.08)',
  },
  footerBtnText: {
    fontSize: 14,
    color: COLORS.primary,
    ...FONTS.semibold,
  },

  // Subcategory gateway
  subcatGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: SPACING.lg,
    gap: SPACING.md,
    justifyContent: 'space-between',
    marginTop: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  subcatTile: {
    width: '47%',
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    minHeight: 130,
  },
  subcatIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(212,175,55,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  subcatLabel: {
    fontSize: 14,
    color: COLORS.textMain,
    ...FONTS.semibold,
    textAlign: 'center',
    marginBottom: 4,
  },
  subcatCount: {
    fontSize: 11,
    color: COLORS.primary,
    ...FONTS.medium,
    letterSpacing: 0.3,
  },
  subcatBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  subcatBackText: {
    fontSize: 13,
    color: COLORS.primary,
    ...FONTS.medium,
  },

  // Event cards
  eventCard: {
    width: FEATURED_CARD_WIDTH,
    height: 200,
    borderRadius: RADIUS.xl,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  eventCardImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  eventCardOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5,8,20,0.45)',
  },
  eventCardDateBadge: {
    position: 'absolute',
    top: SPACING.sm,
    right: SPACING.sm,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  eventCardDateText: {
    fontSize: 11,
    color: COLORS.white,
    ...FONTS.bold,
    letterSpacing: 0.4,
  },
  eventCardContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: SPACING.md,
    gap: SPACING.xs,
  },
  eventCardCatBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(244,63,94,0.2)',
    borderRadius: RADIUS.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(244,63,94,0.5)',
  },
  eventCardCatText: {
    fontSize: 9,
    color: '#F43F5E',
    ...FONTS.bold,
    letterSpacing: 0.6,
  },
  eventCardTitle: {
    fontSize: 16,
    color: COLORS.white,
    ...FONTS.bold,
    lineHeight: 21,
  },
  eventCardVenueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  eventCardVenueText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.65)',
    ...FONTS.medium,
  },
  nbCard: { width: FEATURED_CARD_WIDTH * 0.85, borderRadius: RADIUS.xl, overflow: 'hidden' as const, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  nbCardInner: { padding: SPACING.md, gap: SPACING.sm },
  nbName: { fontSize: 15, color: COLORS.textMain, ...FONTS.bold },
  nbCharacter: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 17 },
  nbRatingsRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  nbRatingGroup: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 2 },
  nbPrice: { fontSize: 13, color: COLORS.primary, ...FONTS.bold, letterSpacing: 1 },
  nbTagsRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 4 },
  nbTag: { backgroundColor: 'rgba(212,175,55,0.12)', borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)' },
  nbTagText: { fontSize: 10, color: COLORS.primary, ...FONTS.semibold },
  nbModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' as const },
  nbModalSheet: { backgroundColor: COLORS.background, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, maxHeight: '85%' as const, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.lg },
  nbModalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.textMuted, alignSelf: 'center' as const, marginBottom: SPACING.md },
  nbModalTitle: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold, marginBottom: SPACING.xs },
  nbModalAka: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, fontStyle: 'italic' as const, marginBottom: SPACING.md },
  nbModalDesc: { fontSize: 14, color: COLORS.textMain, ...FONTS.regular, lineHeight: 21 },
  nbModalSection: { marginTop: SPACING.lg, gap: SPACING.sm },
  nbModalSectionHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.sm },
  nbModalSectionTitle: { fontSize: 15, color: COLORS.textMain, ...FONTS.bold },
  nbModalStarsRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  nbModalRatingText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.medium, marginLeft: SPACING.xs },
  nbModalNote: { fontSize: 13, color: COLORS.textMain, ...FONTS.regular, lineHeight: 19 },
  nbModalPriceLevel: { fontSize: 18, color: COLORS.primary, ...FONTS.bold, letterSpacing: 2 },
  nbModalFare: { fontSize: 18, color: COLORS.primary, ...FONTS.bold },
  nbModalTags: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6 },
  nbModalTag: { backgroundColor: 'rgba(212,175,55,0.12)', borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)' },
  nbModalTagText: { fontSize: 12, color: COLORS.primary, ...FONTS.semibold },
  nbModalCloseBtn: { backgroundColor: COLORS.surface, borderRadius: RADIUS.full, paddingVertical: 14, alignItems: 'center' as const, borderWidth: 1, borderColor: COLORS.border, marginTop: SPACING.sm },
  nbModalCloseBtnText: { fontSize: 15, color: COLORS.textMain, ...FONTS.bold },
});
