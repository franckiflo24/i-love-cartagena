import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  FlatList,
  Dimensions,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  COLORS,
  SPACING,
  RADIUS,
  FONTS,
  TIER_COLORS,
  Tier,
} from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { getCategoryImage } from '../../src/constants/images';
import { TierBadge } from '../../src/components/TierBadge';
import { useLang } from '../../src/context/LanguageContext';
import { useTr } from '../../src/i18n/autoTr';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = (SCREEN_WIDTH - SPACING.lg * 2 - SPACING.sm) / 2;
const FEATURED_CARD_WIDTH = SCREEN_WIDTH * 0.72;

// ── Types ────────────────────────────────────────────────────────────────────

type Experience = {
  experience_id: string;
  title: string;
  description: string;
  image_url: string;
  price: number;
  is_free: boolean;
  category: string;
  partner_name?: string;
  partner_tier?: string;
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

// ── Category definitions ──────────────────────────────────────────────────────

type CategoryItem = {
  key: string;
  label: string;
  icon: string;
  apiValue: string | null;
};

const CATEGORIES: CategoryItem[] = [
  { key: 'all',        label: 'Todos',       icon: 'apps',             apiValue: null },
  { key: 'daypass',    label: 'Day Pass',    icon: 'sunny-outline',    apiValue: 'daypass' },
  { key: 'yachts',     label: 'Yachts',      icon: 'boat',             apiValue: 'yacht' },
  { key: 'restaurants',label: 'Restaurantes',icon: 'restaurant',       apiValue: 'restaurant' },
  { key: 'beachclubs', label: 'Beach Clubs', icon: 'umbrella',         apiValue: 'beach_club' },
  { key: 'hotels',     label: 'Hoteles',     icon: 'bed',              apiValue: 'hotel' },
  { key: 'wellness',   label: 'Wellness',    icon: 'leaf',             apiValue: 'wellness' },
  { key: 'activities', label: 'Actividades', icon: 'bicycle',          apiValue: 'activity' },
  { key: 'nightlife',  label: 'Vida Nocturna',icon: 'wine',            apiValue: 'club' },
];

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
      <View style={styles.searchAiPill}>
        <Ionicons name="sparkles" size={11} color={COLORS.primary} />
        <Text style={styles.searchAiText}>IA</Text>
      </View>
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
  const price = formatPrice(item.price, item.is_free);
  const tierColor = item.partner_tier
    ? TIER_COLORS[item.partner_tier as Tier]
    : null;
  return (
    <TouchableOpacity
      style={styles.featuredCard}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Image
        source={{ uri: item.image_url || getCategoryImage(item.category) }}
        style={styles.featuredImage}
      />
      <View style={styles.featuredOverlay} />
      {tierColor && (
        <View style={[styles.featuredTierStripe, { backgroundColor: tierColor.main }]} />
      )}
      <View style={styles.featuredContent}>
        <View style={styles.featuredTopRow}>
          {item.partner_tier && (
            <TierBadge tier={item.partner_tier} size="xs" />
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
          {item.title}
        </Text>
        {item.partner_name && (
          <View style={styles.featuredPartnerRow}>
            <Ionicons name="business-outline" size={11} color="rgba(255,255,255,0.65)" />
            <Text style={styles.featuredPartnerText} numberOfLines={1}>
              {item.partner_name}
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
      <Image
        source={{ uri: partner.image_url || getCategoryImage(partner.category) }}
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
        {partner.price_range && (
          <View style={styles.gridPricePill}>
            <Text style={styles.gridPriceText}>{partner.price_range}</Text>
          </View>
        )}
        <Text style={styles.gridName} numberOfLines={2}>
          {partner.name}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function ExploreScreen() {
  const router = useRouter();
  const { s } = useLang();
  const tr = useTr();

  const [selectedCategory, setSelectedCategory] = useState<CategoryItem>(CATEGORIES[0]);
  const [featured, setFeatured] = useState<Experience[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loadingFeatured, setLoadingFeatured] = useState(true);
  const [loadingPartners, setLoadingPartners] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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
      const path =
        category.apiValue
          ? `/partners?category=${category.apiValue}`
          : '/partners';
      const data = await api.get(path);
      setPartners(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('[ExploreScreen] partners', e);
      setPartners([]);
    } finally {
      setLoadingPartners(false);
    }
  }, []);

  useEffect(() => {
    loadFeatured();
  }, [loadFeatured]);

  useEffect(() => {
    loadPartners(selectedCategory);
  }, [selectedCategory, loadPartners]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadFeatured(), loadPartners(selectedCategory)]);
    setRefreshing(false);
  }, [loadFeatured, loadPartners, selectedCategory]);

  // ── List header: title + search + category chips + featured section ────────

  const ListHeader = (
    <View>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
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
              onPress={() => setSelectedCategory(cat)}
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
                {cat.label}
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
            <ActivityIndicator
              size="small"
              color={COLORS.primary}
              style={{ marginVertical: SPACING.lg }}
            />
          ) : (
            <FlatList
              data={featured}
              keyExtractor={(item) => item.experience_id}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.featuredList}
              renderItem={({ item }) => (
                <FeaturedCard
                  item={item}
                  onPress={() =>
                    router.push(`/experience/${item.experience_id}` as any)
                  }
                />
              )}
            />
          )}
        </View>
      )}

      {/* ── Partners grid header ── */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          {selectedCategory.key === 'all' ? 'Todos los Lugares' : selectedCategory.label}
        </Text>
        {partners.length > 0 && (
          <Text style={styles.countText}>
            {partners.length} lugar{partners.length !== 1 ? 'es' : ''}
          </Text>
        )}
      </View>
    </View>
  );

  // ── Empty / loading state for grid ────────────────────────────────────────

  const ListEmpty = loadingPartners ? (
    <ActivityIndicator
      size="large"
      color={COLORS.primary}
      style={{ marginTop: SPACING.xl }}
    />
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
        data={partners}
        keyExtractor={(item) => item.partner_id}
        numColumns={2}
        columnWrapperStyle={styles.columnWrapper}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
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
  mapBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: 4,
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
  gridName: {
    fontSize: 13,
    color: COLORS.white,
    ...FONTS.bold,
    lineHeight: 17,
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
});
