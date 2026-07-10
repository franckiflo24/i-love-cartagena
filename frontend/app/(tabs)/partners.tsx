import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Linking as RNLinking } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS, PARTNER_CATEGORY_LABELS, TIER_COLORS, Tier } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { TierBadge } from '../../src/components/TierBadge';
import { SafeImage } from '../../src/components/SafeImage';
import { useLang } from '../../src/context/LanguageContext';
import { useTr } from '../../src/i18n/autoTr';

type Partner = {
  partner_id: string; name: string; description: string; category: string;
  image_url: string; address: string; booking_link: string;
  price_range: string; experience: string; is_certified: boolean;
  tier?: Tier;
};

// Each card accepts one or more backend `category` values, so closely-related
// DB categories roll up into a single guest-facing bucket (e.g. café partners
// appear inside "Restaurantes"). Order = display order on the grid.
type CategoryCard = {
  key: string;
  label: string;
  icon: string;
  color: string;
  image: string;
  dbKeys: string[];        // backend `category` values that belong to this card
  tierAsSubcat?: boolean;  // hotel: drill-down by tier instead of subcategory
};

const CATEGORIES: CategoryCard[] = [
  { key: 'restaurant', label: 'Restaurantes',  icon: 'restaurant', color: '#EF4444', image: 'https://images.unsplash.com/photo-1644621972139-cec33bf68a60?w=600&h=300&fit=crop',
    dbKeys: ['restaurant', 'cafe'] },
  { key: 'hotel',      label: 'Hoteles',       icon: 'bed',        color: '#3B82F6', image: 'https://images.unsplash.com/photo-1488345979593-09db0f85545f?w=600&h=300&fit=crop',
    dbKeys: ['hotel'], tierAsSubcat: true },
  { key: 'activity',   label: 'Actividades',   icon: 'compass',    color: '#F59E0B', image: 'https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=600&h=300&fit=crop',
    dbKeys: ['activity', 'yacht', 'attraction'] },
  { key: 'wellness',   label: 'Wellness & Spa',icon: 'leaf',       color: '#10B981', image: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=600&h=300&fit=crop',
    dbKeys: ['wellness', 'spa', 'beauty'] },
  { key: 'nightlife',  label: 'Bares & Clubs', icon: 'wine',       color: '#8B5CF6', image: 'https://images.unsplash.com/photo-1645496761317-d4122dfc2264?w=600&h=300&fit=crop',
    dbKeys: ['bar', 'club'] },
  { key: 'beach_club', label: 'Beach Clubs',   icon: 'sunny',      color: '#06B6D4', image: 'https://images.unsplash.com/photo-1546484458-6904289cd4f0?w=600&h=300&fit=crop',
    dbKeys: ['beach_club'] },
  { key: 'service',    label: 'Servicios',     icon: 'construct',  color: '#64748B', image: 'https://images.unsplash.com/photo-1521791136064-7986c2920216?w=600&h=300&fit=crop',
    dbKeys: ['service', 'institutional'] },
];

// Resolve a card key to the set of backend category values it accepts.
const dbKeysFor = (cardKey: string): string[] =>
  CATEGORIES.find(c => c.key === cardKey)?.dbKeys ?? [cardKey];

const WELLNESS_SUBCATEGORIES = [
  { key: 'spa', label: 'Spa', icon: 'water', image: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=600&h=400&fit=crop' },
  { key: 'beauty', label: 'Belleza', icon: 'sparkles', image: 'https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?w=600&h=400&fit=crop' },
  { key: 'hair', label: 'Cabello', icon: 'cut', image: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=600&h=400&fit=crop' },
  { key: 'nails', label: 'Uñas', icon: 'hand-left', image: 'https://images.unsplash.com/photo-1604654894610-df63bc536371?w=600&h=400&fit=crop' },
  { key: 'recovery', label: 'Recuperación', icon: 'medkit', image: 'https://images.unsplash.com/photo-1599447421416-3414500d18a5?w=600&h=400&fit=crop' },
  { key: 'fitness', label: 'Fitness', icon: 'barbell', image: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=600&h=400&fit=crop' },
  { key: 'sport', label: 'Sport', icon: 'football', image: 'https://images.unsplash.com/photo-1552674605-db6ffd4facb5?w=600&h=400&fit=crop' },
  { key: 'yoga', label: 'Yoga', icon: 'leaf', image: 'https://images.unsplash.com/photo-1545205597-3d9d02c29597?w=600&h=400&fit=crop' },
];

const RESTAURANT_SUBCATEGORIES = [
  { key: 'cafe', label: 'Café', icon: 'cafe', image: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=600&h=400&fit=crop' },
  { key: 'mediterranean', label: 'Mediterráneo', icon: 'wine', image: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&h=400&fit=crop' },
  { key: 'fastfood', label: 'Fast Food', icon: 'fast-food', image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&h=400&fit=crop' },
  { key: 'italian', label: 'Italiano', icon: 'pizza', image: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=600&h=400&fit=crop' },
  { key: 'asian', label: 'Asiático', icon: 'restaurant', image: 'https://images.unsplash.com/photo-1617196034796-73dfa7b1fd56?w=600&h=400&fit=crop' },
  { key: 'colombian', label: 'Colombiano', icon: 'flag', image: 'https://images.unsplash.com/photo-1518176258769-f227c798150e?w=600&h=400&fit=crop' },
  { key: 'seafood', label: 'Del Mar', icon: 'fish', image: 'https://images.unsplash.com/photo-1559737558-2f5a35f4523b?w=600&h=400&fit=crop' },
  { key: 'international', label: 'Internacional', icon: 'globe', image: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&h=400&fit=crop' },
  { key: 'gastronomic', label: 'Gastronómicos', icon: 'star', image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&h=400&fit=crop' },
  { key: 'vegetarian', label: 'Vegetariano', icon: 'leaf', image: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=600&h=400&fit=crop' },
];

// Hotel sub-cards filter by TIER (popular/premium/elite), not `subcategory` —
// the data has tier values but the historic `subcategory='lujo'` is rare.
// Keys here must match `partner.tier` values.
const HOTEL_SUBCATEGORIES = [
  { key: 'popular', label: 'Popular', icon: 'bed',     image: 'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=600&h=400&fit=crop' },
  { key: 'premium', label: 'Premium', icon: 'star',    image: 'https://images.unsplash.com/photo-1582719508461-905c673771fd?w=600&h=400&fit=crop' },
  { key: 'elite',   label: 'Lujo',    icon: 'diamond', image: 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=600&h=400&fit=crop' },
];

// Categories that REQUIRE subcategory selection before showing partners
const REQUIRE_SUBCAT_PICK = new Set(['wellness', 'restaurant', 'hotel']);

// Map of category → subcategory list (extensible)
const SUBCATEGORIES_BY_CAT: Record<string, { key: string; label: string; icon: string; image?: string }[]> = {
  wellness: WELLNESS_SUBCATEGORIES,
  restaurant: RESTAURANT_SUBCATEGORIES,
  hotel: HOTEL_SUBCATEGORIES,
};

// Color theme per subcategory parent (for pill styling)
const SUBCAT_THEME: Record<string, string> = {
  wellness: '#10B981',
  restaurant: '#EF4444',
  hotel: '#3B82F6',
};

export default function PartnersScreen() {
  const tr = useTr();
  const router = useRouter();
  const { s } = useLang();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSubcat, setSelectedSubcat] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState<Tier | null>(null);
  const [tierShowcase, setTierShowcase] = useState<Tier | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.get('/partners');
        setPartners(data);
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    load();
  }, []);

  // Reset subcategory when category changes
  useEffect(() => {
    if (selectedCategory && !REQUIRE_SUBCAT_PICK.has(selectedCategory)) {
      setSelectedSubcat('all'); // optional pills, default 'all'
    } else {
      setSelectedSubcat(null);  // wellness: no auto-select, force pick
    }
  }, [selectedCategory]);

  const selectedCard = selectedCategory ? CATEGORIES.find(c => c.key === selectedCategory) ?? null : null;
  const subcatList = selectedCategory ? SUBCATEGORIES_BY_CAT[selectedCategory] : null;
  const subcatTheme = selectedCategory ? SUBCAT_THEME[selectedCategory] || COLORS.primary : COLORS.primary;
  const requireSubcatPick = !!(selectedCategory && REQUIRE_SUBCAT_PICK.has(selectedCategory) && !selectedSubcat);

  // Does a partner match this sub-key for the active category card?
  // - Hotel card uses `tier` (popular/premium/elite) instead of `subcategory`.
  // - Cafe sub-key under Restaurantes ALSO matches top-level category='cafe'.
  // - Spa sub-key under Wellness ALSO matches top-level category='spa'.
  const matchesSubcat = (p: Partner, subKey: string): boolean => {
    if (!subKey || subKey === 'all') return true;
    if (selectedCard?.tierAsSubcat) return p.tier === subKey;
    if (subKey === 'cafe'   && p.category === 'cafe')   return true;
    if (subKey === 'spa'    && p.category === 'spa')    return true;
    if (subKey === 'beauty' && p.category === 'beauty') return true;
    return (p as any).subcategory === subKey;
  };

  // Does a partner belong to the active category card?
  const matchesCard = (p: Partner): boolean => {
    if (!selectedCard) return false;
    return selectedCard.dbKeys.includes(p.category);
  };

  const filtered = selectedCard && !requireSubcatPick
    ? partners.filter(p => {
        if (!matchesCard(p)) return false;
        if (tierFilter && p.tier !== tierFilter) return false;
        if (subcatList && selectedSubcat && !matchesSubcat(p, selectedSubcat)) return false;
        return true;
      })
    : [];

  const subcatCount = (key: string): number => {
    if (!selectedCard) return 0;
    return partners.filter(p => matchesCard(p) && (key === 'all' || matchesSubcat(p, key))).length;
  };

  const getCategoryCount = (cardKey: string): number => {
    const keys = dbKeysFor(cardKey);
    return partners.filter(p => keys.includes(p.category)).length;
  };

  const TIER_ORDER: Tier[] = ['popular', 'premium', 'elite'];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        {tierShowcase ? (
          <View style={styles.headerWithBack}>
            <TouchableOpacity
              testID="tier-showcase-back"
              onPress={() => setTierShowcase(null)}
              style={styles.backBtn}
            >
              <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: TIER_COLORS[tierShowcase].main }]}>
                {s(`tier_${tierShowcase}`)}
              </Text>
              <Text style={styles.subtitle}>
                {s(`tier_${tierShowcase}_desc`)} · {partners.filter(p => p.tier === tierShowcase).length} lugares
              </Text>
            </View>
          </View>
        ) : selectedCategory ? (
          <View style={styles.headerWithBack}>
            <TouchableOpacity
              onPress={() => {
                if (selectedSubcat && REQUIRE_SUBCAT_PICK.has(selectedCategory!)) {
                  // Step back to subcat picker (instead of leaving wellness)
                  setSelectedSubcat(null);
                } else {
                  setSelectedCategory(null);
                }
              }}
              style={styles.backBtn}
            >
              <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>
                {requireSubcatPick
                  ? CATEGORIES.find(c => c.key === selectedCategory)?.label
                  : (subcatList && selectedSubcat && selectedSubcat !== 'all'
                      ? subcatList.find(s => s.key === selectedSubcat)?.label
                      : CATEGORIES.find(c => c.key === selectedCategory)?.label)
                }
              </Text>
              <Text style={styles.subtitle}>
                {requireSubcatPick
                  ? 'Elige una sub-categoría'
                  : `${filtered.length} partner${filtered.length !== 1 ? 's' : ''} certificado${filtered.length !== 1 ? 's' : ''}`}
              </Text>
            </View>
          </View>
        ) : (
          <>
            <Text style={styles.title}>{tr('Partners')}</Text>
            <Text style={styles.subtitle}>Lugares certificados por Amo Cartagena</Text>
          </>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : tierShowcase ? (
          /* ── Tier Showcase: all partners of a tier across categories ── */
          <View style={styles.list}>
            <View style={[styles.tierShowcaseHero, { borderColor: TIER_COLORS[tierShowcase].main }]}>
              <View style={[styles.tierShowcaseDot, { backgroundColor: TIER_COLORS[tierShowcase].main }]} />
              <Text style={[styles.tierShowcaseTitle, { color: TIER_COLORS[tierShowcase].main }]}>
                {s(`tier_${tierShowcase}`)}
              </Text>
              <Text style={styles.tierShowcaseDesc}>{s(`tier_${tierShowcase}_desc`)}</Text>
            </View>
            {(() => {
              const tierPartners = partners.filter(p => p.tier === tierShowcase);
              if (tierPartners.length === 0) {
                return (
                  <View style={styles.emptyState}>
                    <Ionicons name="business-outline" size={48} color={COLORS.textMuted} />
                    <Text style={styles.emptyText}>{tr('Próximamente')}</Text>
                  </View>
                );
              }
              return tierPartners.map(partner => {
                const tierColor = TIER_COLORS[tierShowcase];
                const catLabel = CATEGORIES.find(c => c.key === partner.category)?.label || partner.category;
                return (
                  <TouchableOpacity
                    key={partner.partner_id}
                    style={[styles.partnerCard, { borderColor: tierColor.border, borderWidth: 1.5 }]}
                    onPress={() => router.push(`/partner/${partner.partner_id}`)}
                    activeOpacity={0.8}
                  >
                    <SafeImage uri={partner.image_url} category={partner.category} style={styles.partnerImage} />
                    <View style={styles.partnerOverlay} />
                    <View style={[styles.tierStripe, { backgroundColor: tierColor.main }]} />
                    <View style={styles.topBadgeRow}>
                      <TierBadge tier={partner.tier} size="sm" />
                    </View>
                    <View style={[styles.certifiedBadge, { backgroundColor: tierColor.bg, borderColor: tierColor.border }]}>
                      <Ionicons name="pricetag" size={11} color={tierColor.main} />
                      <Text style={[styles.certifiedText, { color: tierColor.main }]}>{(catLabel || '').toUpperCase()}</Text>
                    </View>
                    <View style={styles.partnerContent}>
                      <Text style={styles.partnerName}>{partner.name}</Text>
                      <Text style={styles.partnerDesc} numberOfLines={2}>{partner.description}</Text>
                      <View style={styles.partnerMeta}>
                        <View style={styles.metaItem}>
                          <Ionicons name="location-outline" size={13} color={COLORS.textMuted} />
                          <Text style={styles.metaText} numberOfLines={1}>{partner.address}</Text>
                        </View>
                        <View style={styles.metaItem}>
                          <Ionicons name="cash-outline" size={13} color={COLORS.textMuted} />
                          <Text style={styles.metaText}>{partner.price_range}</Text>
                        </View>
                      </View>
                      <View style={styles.partnerActions}>
                        <TouchableOpacity style={styles.detailBtn} onPress={() => router.push(`/partner/${partner.partner_id}`)}>
                          <Text style={styles.detailText}>{tr('Ver más')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.bookBtn}
                          onPress={() => router.push({ pathname: '/reservation/new' as any, params: { partner_id: partner.partner_id } })}
                        >
                          <Text style={styles.bookText}>{tr('Reservar')}</Text>
                          <Ionicons name="arrow-forward" size={14} color={COLORS.white} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              });
            })()}
          </View>
        ) : !selectedCategory ? (
          /* ── Category Grid ── */
          <>
            {/* Certified Hero Banner */}
            <View style={styles.heroBanner}>
              <SafeImage uri="https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?w=800&h=300&fit=crop" style={styles.heroBannerImage} />
              <View style={styles.heroBannerOverlay} />
              <View style={styles.heroBannerContent}>
                <Ionicons name="diamond" size={32} color={COLORS.primary} />
                <Text style={styles.heroBannerTitle}>Lugares certificados</Text>
                <Text style={styles.heroBannerDesc}>Restaurantes, clubs, hoteles y más validados por Amo Cartagena</Text>
              </View>
            </View>

            {/* Tier Legend - now clickable */}
            <View style={styles.tierLegend}>
              <Text style={styles.tierLegendTitle}>{s('tier_filter_label')}</Text>
              <View style={styles.tierLegendRow}>
                {TIER_ORDER.map(t => (
                  <TouchableOpacity
                    key={t}
                    testID={`tier-legend-${t}`}
                    style={styles.tierLegendItem}
                    onPress={() => setTierShowcase(t)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.tierLegendDot, { backgroundColor: TIER_COLORS[t].main }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.tierLegendName, { color: TIER_COLORS[t].main }]}>
                        {s(`tier_${t}`)}
                      </Text>
                      <Text style={styles.tierLegendDesc}>{s(`tier_${t}_desc`)}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={TIER_COLORS[t].main} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.categoryGrid}>
            {CATEGORIES
              .map(cat => ({ ...cat, count: getCategoryCount(cat.key) }))
              .filter(cat => cat.count > 0)
              .map(cat => (
              <TouchableOpacity
                key={cat.key}
                style={styles.categoryCard}
                onPress={() => setSelectedCategory(cat.key)}
                activeOpacity={0.85}
              >
                <SafeImage uri={cat.image} style={styles.categoryImage} />
                <View style={styles.categoryOverlay} />
                <View style={styles.categoryContent}>
                  <View style={[styles.categoryIconBadge, { backgroundColor: `${cat.color}30` }]}>
                    <Ionicons name={cat.icon as any} size={20} color={cat.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.categoryName}>{cat.label}</Text>
                    <Text style={styles.categoryCount}>{cat.count} lugares</Text>
                  </View>
                  <View style={[styles.categoryArrowCircle, { backgroundColor: `${cat.color}25` }]}>
                    <Ionicons name="chevron-forward" size={18} color={cat.color} />
                  </View>
                </View>
              </TouchableOpacity>
            ))}
            </View>
          </>
        ) : requireSubcatPick && subcatList ? (
          /* ── Subcategory Picker (Wellness, etc.) ── */
          <View style={styles.subcatPickerWrap}>
            <View style={styles.subcatPickerHero}>
              <SafeImage
                uri={CATEGORIES.find(c => c.key === selectedCategory)?.image}
                style={styles.subcatPickerHeroImg}
              />
              <View style={styles.subcatPickerOverlay} />
              <View style={styles.subcatPickerHeroContent}>
                <View style={[styles.subcatPickerIconCircle, { backgroundColor: subcatTheme + '40' }]}>
                  <Ionicons
                    name={CATEGORIES.find(c => c.key === selectedCategory)?.icon as any}
                    size={26}
                    color={subcatTheme}
                  />
                </View>
                <Text style={styles.subcatPickerHeroTitle}>
                  {CATEGORIES.find(c => c.key === selectedCategory)?.label}
                </Text>
                <Text style={styles.subcatPickerHeroDesc}>
                  Selecciona una sub-categoría para ver los partners
                </Text>
              </View>
            </View>

            <View style={styles.subcatGrid}>
              {subcatList.map(sc => {
                const count = subcatCount(sc.key);
                return (
                  <TouchableOpacity
                    key={sc.key}
                    style={[styles.subcatCard, { borderColor: subcatTheme + '40' }]}
                    onPress={() => setSelectedSubcat(sc.key)}
                    activeOpacity={0.85}
                    disabled={count === 0}
                  >
                    {sc.image && <SafeImage uri={sc.image} style={styles.subcatCardImg} />}
                    <View style={styles.subcatCardOverlay} />
                    <View style={styles.subcatCardContent}>
                      <View style={[styles.subcatCardIconBadge, { backgroundColor: subcatTheme + '40' }]}>
                        <Ionicons name={sc.icon as any} size={20} color={subcatTheme} />
                      </View>
                      <Text style={styles.subcatCardLabel}>{sc.label}</Text>
                      <View style={[styles.subcatCardCountBadge, { backgroundColor: subcatTheme }]}>
                        <Text style={styles.subcatCardCountText}>{count}</Text>
                      </View>
                    </View>
                    {count === 0 && (
                      <View style={styles.subcatCardComingSoon}>
                        <Text style={styles.subcatCardComingSoonText}>{tr('Próximamente')}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : (
          /* ── Partner List ── */
          <View style={styles.list}>
            {/* Sub-categories pills (wellness, restaurant, etc.) */}
            {subcatList && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.subcatRow}
              >
                {subcatList.map(sc => {
                  const active = selectedSubcat === sc.key;
                  const count = subcatCount(sc.key);
                  return (
                    <TouchableOpacity
                      key={sc.key}
                      onPress={() => setSelectedSubcat(sc.key)}
                      style={[
                        styles.subcatPill,
                        { backgroundColor: subcatTheme + '1A', borderColor: subcatTheme + '4D' },
                        active && { backgroundColor: subcatTheme, borderColor: subcatTheme },
                      ]}
                      activeOpacity={0.85}
                    >
                      <Ionicons name={sc.icon as any} size={14} color={active ? COLORS.white : subcatTheme} />
                      <Text style={[styles.subcatText, { color: subcatTheme }, active && styles.subcatTextActive]}>
                        {sc.label}
                      </Text>
                      <View style={[
                        styles.subcatBadge,
                        { backgroundColor: subcatTheme + '33' },
                        active && styles.subcatBadgeActive,
                      ]}>
                        <Text style={[
                          styles.subcatBadgeText,
                          { color: subcatTheme },
                          active && styles.subcatBadgeTextActive,
                        ]}>
                          {count}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            {/* Tier Filter Pills */}
            <View style={styles.tierFilterRow}>
              <TouchableOpacity
                onPress={() => setTierFilter(null)}
                style={[styles.tierPill, !tierFilter && styles.tierPillActive]}
                activeOpacity={0.85}
              >
                <Text style={[styles.tierPillText, !tierFilter && styles.tierPillTextActive]}>
                  {s('tier_filter_all')}
                </Text>
              </TouchableOpacity>
              {TIER_ORDER.map(t => {
                const active = tierFilter === t;
                const c = TIER_COLORS[t];
                return (
                  <TouchableOpacity
                    key={t}
                    onPress={() => setTierFilter(active ? null : t)}
                    style={[
                      styles.tierPill,
                      { borderColor: active ? c.main : COLORS.border, backgroundColor: active ? c.bg : 'transparent' },
                    ]}
                    activeOpacity={0.85}
                  >
                    <View style={[styles.tierPillDot, { backgroundColor: c.main }]} />
                    <Text style={[styles.tierPillText, { color: active ? c.main : COLORS.textMuted }]}>
                      {s(`tier_${t}`)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {filtered.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="business-outline" size={48} color={COLORS.textMuted} />
                <Text style={styles.emptyText}>{tr('Próximamente en esta categoría')}</Text>
              </View>
            ) : (
              filtered.map(partner => {
                const tierColor = partner.tier ? TIER_COLORS[partner.tier as Tier] : null;
                return (
                <TouchableOpacity
                  key={partner.partner_id}
                  style={[
                    styles.partnerCard,
                    tierColor && { borderColor: tierColor.border, borderWidth: 1.5 },
                  ]}
                  onPress={() => router.push(`/partner/${partner.partner_id}`)}
                  activeOpacity={0.8}
                >
                  <SafeImage uri={partner.image_url} category={partner.category} style={styles.partnerImage} />
                  <View style={styles.partnerOverlay} />

                  {/* Tier accent stripe */}
                  {tierColor && <View style={[styles.tierStripe, { backgroundColor: tierColor.main }]} />}

                  <View style={styles.topBadgeRow}>
                    <TierBadge tier={partner.tier} size="sm" />
                  </View>

                  {partner.is_certified && (
                    <View style={styles.certifiedBadge}>
                      <Ionicons name="shield-checkmark" size={14} color={COLORS.primary} />
                      <Text style={styles.certifiedText}>CERTIFICADO</Text>
                    </View>
                  )}

                  <View style={styles.partnerContent}>
                    <Text style={styles.partnerName}>{partner.name}</Text>
                    <Text style={styles.partnerDesc} numberOfLines={2}>{partner.description}</Text>

                    <View style={styles.partnerMeta}>
                      <View style={styles.metaItem}>
                        <Ionicons name="location-outline" size={13} color={COLORS.textMuted} />
                        <Text style={styles.metaText} numberOfLines={1}>{partner.address}</Text>
                      </View>
                      <View style={styles.metaItem}>
                        <Ionicons name="cash-outline" size={13} color={COLORS.textMuted} />
                        <Text style={styles.metaText}>{partner.price_range}</Text>
                      </View>
                    </View>

                    <View style={styles.partnerActions}>
                      <TouchableOpacity
                        style={styles.detailBtn}
                        onPress={() => router.push(`/partner/${partner.partner_id}`)}
                      >
                        <Text style={styles.detailText}>{tr('Ver más')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.bookBtn}
                        onPress={() => router.push({ pathname: '/reservation/new' as any, params: { partner_id: partner.partner_id } })}
                      >
                        <Text style={styles.bookText}>{tr('Reservar')}</Text>
                        <Ionicons name="arrow-forward" size={14} color={COLORS.white} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </TouchableOpacity>
              );
              })
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.sm },
  headerWithBack: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 28, color: COLORS.textMain, ...FONTS.bold },
  subtitle: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },

  // Hero Banner
  heroBanner: { marginHorizontal: SPACING.lg, marginBottom: SPACING.md, borderRadius: RADIUS.xl, overflow: 'hidden', height: 140, position: 'relative' },
  heroBannerImage: { width: '100%', height: '100%', position: 'absolute' },
  heroBannerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(5,8,20,0.65)' },
  heroBannerContent: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACING.xs, paddingHorizontal: SPACING.lg },
  heroBannerTitle: { fontSize: 22, color: '#FFF', ...FONTS.bold, textAlign: 'center' },
  heroBannerDesc: { fontSize: 12, color: 'rgba(255,255,255,0.75)', ...FONTS.regular, textAlign: 'center' },

  // Category Grid
  categoryGrid: { paddingHorizontal: SPACING.lg, gap: SPACING.sm, marginTop: SPACING.sm },
  categoryCard: { borderRadius: RADIUS.xl, overflow: 'hidden', height: 80, position: 'relative', borderWidth: 1, borderColor: COLORS.border },
  categoryImage: { width: '100%', height: '100%', position: 'absolute' },
  categoryOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(5,8,20,0.6)' },
  categoryContent: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, gap: SPACING.md },
  categoryIconBadge: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  categoryName: { fontSize: 18, color: '#FFF', ...FONTS.bold },
  categoryCount: { fontSize: 12, color: 'rgba(255,255,255,0.7)', ...FONTS.medium, marginTop: 1 },
  categoryArrowCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },

  // Empty
  emptyState: { alignItems: 'center', paddingTop: 60, gap: SPACING.md },
  emptyText: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular },

  // Partner List
  list: { paddingHorizontal: SPACING.lg },

  // Subcategory Picker (Wellness)
  subcatPickerWrap: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.lg },
  subcatPickerHero: {
    borderRadius: RADIUS.xl,
    overflow: 'hidden',
    height: 130,
    marginBottom: SPACING.md,
    position: 'relative',
  },
  subcatPickerHeroImg: { width: '100%', height: '100%', position: 'absolute' },
  subcatPickerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,8,20,0.7)' },
  subcatPickerHeroContent: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, padding: SPACING.md },
  subcatPickerIconCircle: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  subcatPickerHeroTitle: { fontSize: 20, color: COLORS.white, ...FONTS.bold },
  subcatPickerHeroDesc: { fontSize: 12, color: 'rgba(255,255,255,0.75)', ...FONTS.regular, textAlign: 'center' },

  subcatGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  subcatCard: {
    width: '48%',
    height: 130,
    borderRadius: RADIUS.xl,
    overflow: 'hidden',
    borderWidth: 1.5,
    position: 'relative',
    backgroundColor: COLORS.surface,
  },
  subcatCardImg: { width: '100%', height: '100%', position: 'absolute' },
  subcatCardOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,8,20,0.55)' },
  subcatCardContent: {
    flex: 1,
    padding: SPACING.sm,
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  subcatCardIconBadge: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  subcatCardLabel: { fontSize: 16, color: COLORS.white, ...FONTS.bold },
  subcatCardCountBadge: {
    position: 'absolute',
    bottom: SPACING.sm,
    right: SPACING.sm,
    minWidth: 26,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subcatCardCountText: { fontSize: 11, color: COLORS.white, ...FONTS.bold },
  subcatCardComingSoon: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
  },
  subcatCardComingSoonText: { fontSize: 9, color: '#FFC107', ...FONTS.bold, letterSpacing: 0.4 },

  // Wellness sub-categories
  subcatRow: { gap: 6, paddingVertical: 4, marginBottom: SPACING.xs },
  subcatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: RADIUS.full,
    backgroundColor: 'rgba(16,185,129,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.30)',
  },
  subcatPillActive: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  subcatText: {
    fontSize: 12,
    color: '#10B981',
    ...FONTS.semibold,
  },
  subcatTextActive: { color: COLORS.white },
  subcatBadge: {
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 9,
    backgroundColor: 'rgba(16,185,129,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subcatBadgeActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  subcatBadgeText: { fontSize: 10, color: '#10B981', ...FONTS.bold },
  subcatBadgeTextActive: { color: COLORS.white },
  partnerCard: { borderRadius: RADIUS.xl, overflow: 'hidden', marginBottom: SPACING.md, borderWidth: 1, borderColor: 'rgba(217, 119, 6, 0.2)', position: 'relative' },
  partnerImage: { width: '100%', height: 160 },
  partnerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, height: 160, backgroundColor: 'rgba(0,0,0,0.2)' },
  tierStripe: { position: 'absolute', top: 0, left: 0, right: 0, height: 4, zIndex: 2 },
  topBadgeRow: { position: 'absolute', top: SPACING.md, left: SPACING.md, zIndex: 3 },
  certifiedBadge: { position: 'absolute', top: SPACING.md, right: SPACING.md, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(5,8,20,0.85)', borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: COLORS.primary, zIndex: 3 },
  certifiedText: { fontSize: 9, color: COLORS.primary, ...FONTS.bold, letterSpacing: 1 },
  partnerContent: { padding: SPACING.md, backgroundColor: COLORS.surface },
  partnerName: { fontSize: 20, color: COLORS.textMain, ...FONTS.bold },
  partnerDesc: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, marginTop: 4, lineHeight: 20 },
  partnerMeta: { marginTop: SPACING.sm, gap: 4 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, flex: 1 },
  partnerActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
  detailBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border },
  detailText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.semibold },
  bookBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 10 },
  bookText: { fontSize: 13, color: COLORS.white, ...FONTS.semibold },

  // Tier Legend (en categoría grid)
  tierLegend: { marginHorizontal: SPACING.lg, marginBottom: SPACING.md, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  tierLegendTitle: { fontSize: 11, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 1, textTransform: 'uppercase', marginBottom: SPACING.sm },
  tierLegendRow: { gap: SPACING.sm },
  tierLegendItem: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 4 },
  tierLegendDot: { width: 10, height: 10, borderRadius: 5 },
  tierLegendName: { fontSize: 13, ...FONTS.bold, letterSpacing: 0.5 },
  tierLegendDesc: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginTop: 1 },
  tierShowcaseHero: { marginBottom: SPACING.md, padding: SPACING.lg, borderRadius: RADIUS.lg, borderWidth: 1.5, backgroundColor: COLORS.surface, alignItems: 'center' },
  tierShowcaseDot: { width: 14, height: 14, borderRadius: 7, marginBottom: 6 },
  tierShowcaseTitle: { fontSize: 18, ...FONTS.bold, letterSpacing: 1 },
  tierShowcaseDesc: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginTop: 4, textAlign: 'center' },

  // Tier Filter Pills (en lista)
  tierFilterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.md },
  tierPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border, backgroundColor: 'transparent' },
  tierPillActive: { borderColor: COLORS.primary, backgroundColor: 'rgba(217,119,6,0.15)' },
  tierPillDot: { width: 7, height: 7, borderRadius: 4 },
  tierPillText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold },
  tierPillTextActive: { color: COLORS.primary },
});
