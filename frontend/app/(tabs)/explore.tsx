import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  COLORS,
  SPACING,
  RADIUS,
  FONTS,
  TYPE,
  TIER_COLORS,
  PARTNER_CATEGORY_LABELS,
  Tier,
  colorForKey,
  ELEVATION,
} from '../../src/constants/theme';
import { api , ASSET_ORIGIN} from '../../src/constants/api';
import { IMAGES } from '../../src/constants/images';
import { TierBadge } from '../../src/components/TierBadge';
import { SafeImage } from '../../src/components/SafeImage';
import { FAB_CLEARANCE } from '../../src/components/AssistantFab';
import { PressableScale } from '../../src/components/PressableScale';
import { FadeInUp } from '../../src/components/FadeInUp';
import { SkeletonFeaturedRow, SkeletonGrid } from '../../src/components/Skeleton';
import LoadError from '../../src/components/LoadError';
import { useLang } from '../../src/context/LanguageContext';
import { useTr } from '../../src/i18n/autoTr';
import { CATEGORY_META, PublicEvent, compactUpcoming, formatEventDates, loadFeed, pickL } from '../../src/lib/eventsFeed';
import LensRow from '../../src/components/lenses/LensChips';
import { L4, LensAdvisory, LensKey, LensVenueRow, bundledLenses, lensDef, pickL4 } from '../../src/lib/lenses';
import { EventMedia, EventTrustChip } from '../../src/components/EventFeedUI';
import { monthShort } from '../../src/lib/formatDate';
import { bogotaToday } from '../../src/lib/eventTime';
import type { Lang } from '../../src/i18n/translations';
import { usePersonalization } from '../../src/context/PersonalizationContext';
import { useLocalPicks, behavioralPick } from '../../src/services/localPicks';
import { nearestNeighborhood } from '../../src/utils/neighborhood';
import { NearbyStrip } from '../../src/components/NearbyStrip';
import { geoService } from '../../src/lib/geo';
import { matchesCuisine } from '../../src/lib/cuisineMatch';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = (SCREEN_WIDTH - SPACING.lg * 2 - SPACING.sm) / 2;
const FEATURED_CARD_WIDTH = SCREEN_WIDTH * 0.72;

// ── Types ────────────────────────────────────────────────────────────────────

type Experience = {
  experience_id?: string;
  // /experiences/featured returns partner_events (one row per date) — these
  // carry event_id/date/flyer_url; static featured.json rows are partners.
  event_id?: string;
  partner_id?: string;
  name?: string;
  title?: string;
  description: string;
  image_url: string;
  flyer_url?: string;
  partner_image?: string;
  cover_image?: string;
  date?: string;
  date_start?: string;
  date_end?: string;
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
  taxi_fare_from_airport_cop?: number;
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
  { key: 'nightlife',  label: 'Nightlife',   icon: 'musical-notes',    apiValue: 'nightlife' },
  { key: 'spas',       label: 'Spa',         icon: 'leaf',             apiValue: 'wellness' },
  { key: 'beachclubs', label: 'Beach Clubs', icon: 'umbrella',         apiValue: 'beach_club' },
  { key: 'yachts',     label: 'Yates',       icon: 'boat',             apiValue: 'yacht' },
  { key: 'beauty',     label: 'Belleza',     icon: 'cut',              apiValue: 'beauty' },
  { key: 'activities', label: 'Experiencias',icon: 'compass',          apiValue: 'activity' },
  { key: 'hotels',     label: 'Hoteles',     icon: 'bed',              apiValue: 'hotel' },
  { key: 'attractions',label: 'Atracciones', icon: 'camera',           apiValue: 'attraction' },
  { key: 'services',   label: 'Servicios',   icon: 'briefcase',        apiValue: 'service' },
];

// ── Sub-categories per main category ──────────────────────────────────────────
type Subcat = { key: string; label: string; icon: string };

const SUBCATEGORIES: Record<string, Subcat[]> = {
  // Canonical cuisines (CATALOG-MIGRATE). Keys match stored subcategory/style_tags
  // so matchesCuisine() surfaces the real venues; 'mediterranean' fans out to the
  // whole basin. Tiles auto-hide when their count is 0.
  restaurant: [
    { key: 'mediterranean', label: 'Mediterránea',   icon: 'wine' },
    { key: 'colombian',     label: 'Colombiana',     icon: 'flag' },
    { key: 'seafood',       label: 'Mariscos',       icon: 'fish' },
    { key: 'italian',       label: 'Italiana',       icon: 'pizza' },
    { key: 'asian',         label: 'Asiática',       icon: 'restaurant' },
    { key: 'middle_eastern',label: 'Árabe',          icon: 'restaurant' },
    { key: 'grill',         label: 'Parrilla',       icon: 'flame' },
    { key: 'healthy',       label: 'Saludable',      icon: 'nutrition' },
    { key: 'fine_dining',   label: 'Alta Cocina',    icon: 'star' },
    { key: 'fast_food',     label: 'Rápida',         icon: 'fast-food' },
    { key: 'french',        label: 'Francesa',       icon: 'wine' },
    { key: 'mexican',       label: 'Mexicana',       icon: 'restaurant' },
    { key: 'international',  label: 'Internacional',  icon: 'globe' },
  ],
  bar: [
    { key: 'cocktail_bar',  label: 'Cocktail Bar',   icon: 'wine' },
    { key: 'rooftop',       label: 'Rooftop',        icon: 'business' },
    { key: 'lounge',        label: 'Lounge',         icon: 'cafe' },
    { key: 'salsa_bar',     label: 'Salsa Bar',      icon: 'musical-notes' },
  ],
  nightlife: [
    { key: 'nightclub',     label: 'Nightclub',      icon: 'musical-notes' },
    { key: 'live_music',    label: 'Música en vivo', icon: 'mic' },
    { key: 'champeta',      label: 'Champeta',       icon: 'musical-note' },
    { key: 'lounge',        label: 'Lounge',         icon: 'cafe' },
  ],
  cafe: [
    { key: 'coffee',        label: 'Café',           icon: 'cafe' },
    { key: 'brunch',        label: 'Brunch',         icon: 'sunny' },
    { key: 'bakery',        label: 'Panadería',      icon: 'pizza' },
  ],
  wellness: [
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
    // 5B: classes (salsa / español / cocina) ride style_tags 'classes' so one tile
    // gathers them across their specific subcategories (spanish_school, cooking_class…).
    { key: 'classes',       label: 'Clases',         icon: 'school' },
    { key: 'yacht',         label: 'Yates',          icon: 'boat' },
    { key: 'concierge',     label: 'Concierge',      icon: 'briefcase' },
  ],
  // NO beach_club gateway: the old tiles [beach_club, cocktail_bar, boutique] matched
  // only the 10 in-city venues (sub=beach_club) and HID the 37 island beach clubs
  // (sub=islas_rosario/tierra_bomba/baru) — incl. the top ones (Bellini, Bora Bora,
  // Pao Pao, Capri). With no subcats here, beach_club shows every venue ranked by
  // tier+rank_score, so the top beach clubs surface immediately.
  beauty: [
    { key: 'salon',           label: 'Salón',           icon: 'cut' },
    { key: 'barbershop',      label: 'Barbería',        icon: 'cut' },
    { key: 'nails',           label: 'Uñas',            icon: 'color-palette' },
    { key: 'makeup',          label: 'Maquillaje',      icon: 'brush' },
    { key: 'facial_spa',      label: 'Facial & Spa',    icon: 'flower' },
    { key: 'aesthetic_clinic', label: 'Clínica Estética',icon: 'medkit' },
    { key: 'lashes_brows',   label: 'Cejas & Pestañas', icon: 'eye' },
  ],
  // Drop CAT: the guest-essentials as browsable service subcategories — keys MUST
  // match the stored partner.subcategory values so the existing subcategory filter
  // (p.subcategory === selectedSubcategory) surfaces the real venues.
  service: [
    { key: 'pharmacy',          label: 'Farmacias',         icon: 'medkit' },
    { key: 'currency_exchange', label: 'Cambio de divisas', icon: 'cash' },
    { key: 'bank',              label: 'Bancos / Cajeros',  icon: 'card' },
    { key: 'grocery',           label: 'Supermercados',     icon: 'cart' },
    { key: 'laundry',           label: 'Lavanderías',       icon: 'shirt' },
    { key: 'coworking',         label: 'Coworking',         icon: 'laptop' },
    { key: 'sim_card',          label: 'SIM / eSIM',        icon: 'cellular' },
    { key: 'medical',           label: 'Médico',            icon: 'medical' },
    { key: 'veterinary',        label: 'Veterinarias',      icon: 'paw' },
    { key: 'luggage_storage',   label: 'Guarda-equipaje',   icon: 'bag-handle' },
  ],
};

// Drop 6 "Todos" invariant: personalization re-sorts AFTER the round-robin
// interleave (scorePartner clusters the user's interest categories), which on a
// personalized device collapsed the front door back to beach-clubs↔experiences —
// Phil's live repro: first 20 of 865 were those two categories only. The axis is
// therefore enforced as a FINAL pass, downstream of every sort and filter: no more
// than `max` consecutive rows of the same category; when a run would exceed it, the
// next different-category row is pulled forward (otherwise stable).
// The axis itself, as the FINAL pass: one row per category in rotation before any
// category repeats. Order WITHIN each category is whatever upstream produced
// (tier → verification boost → personalization), and the rotation order is the
// categories' first appearance in that personalized list — so the user's interest
// categories lead the rotation without owning the whole door. (The cap alone was
// insufficient: with two interest categories clustered on top, B-B-A-B-B-A satisfies
// "≤2 consecutive" forever and distinct stayed at 2 — live-proven.)
function interleaveByCategory(list: Partner[]): Partner[] {
  const byCat = new Map<string, Partner[]>();
  for (const p of list) {
    const c = String((p as any).category || 'other');
    const q = byCat.get(c);
    if (q) q.push(p); else byCat.set(c, [p]);
  }
  const queues = [...byCat.values()];
  const out: Partner[] = [];
  for (let i = 0; queues.some(q => q.length > i); i++) {
    for (const q of queues) if (q[i]) out.push(q[i]);
  }
  return out;
}

function capConsecutiveByCategory(list: Partner[], max = 2): Partner[] {
  const src = [...list];
  const out: Partner[] = [];
  let run = 0;
  let runCat = '';
  while (src.length) {
    const cat0 = String((src[0] as any).category || 'other');
    if (cat0 !== runCat || run < max) {
      const p = src.shift() as Partner;
      run = cat0 === runCat ? run + 1 : 1;
      runCat = cat0;
      out.push(p);
      continue;
    }
    const j = src.findIndex(p => String((p as any).category || 'other') !== runCat);
    if (j === -1) { out.push(...src); break; }  // only one category left — nothing to mix
    const p = src.splice(j, 1)[0];
    out.push(p);
    runCat = String((p as any).category || 'other');
    run = 1;
  }
  return out;
}

// Real singulars for the gateway header — a naive strip-the-s produced "hotele",
// "bare" and "atraccione" (P0 browse-spine fix). Keys = CATEGORIES[].key.
const CATEGORY_SINGULAR: Record<string, string> = {
  restaurants: 'restaurante', bars: 'bar', cafes: 'café', nightlife: 'plan de noche',
  spas: 'spa', beachclubs: 'beach club', yachts: 'yate', beauty: 'servicio de belleza',
  activities: 'experiencia', hotels: 'hotel', attractions: 'atracción', services: 'servicio',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const formatPrice = (price: number, isFree: boolean): string | null => {
  if (isFree) return 'Gratis';
  if (!price) return null;
  return `$${(price / 1000).toFixed(0)}K`;
};

// Date chip for an event card. An ONGOING event (date_start ≤ today ≤ date_end,
// e.g. Chiva Rumbera Jun→Apr) reads "Hoy", not its months-old start date —
// otherwise the whole row looks like stale content.
const eventDateLabel = (
  start: string | undefined,
  end: string | undefined,
  lang: Lang,
  tr: (s: string) => string,
): string => {
  const s = (start || '').slice(0, 10);
  if (!s) return '';
  const e = (end || s).slice(0, 10);
  const today = bogotaToday();
  if (s <= today && e >= today) return tr('Hoy');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${Number(m[3])} ${monthShort(Number(m[2]) - 1, lang, true)}`;
};

// Stable identity for a featured card across the static→API hydrate, so
// SafeImage tiles are NOT remounted (index keys restarted every download).
const featuredKey = (e: Experience): string =>
  e.event_id || e.experience_id || `${e.partner_id || ''}|${(e.title || e.name || '').trim().toLowerCase()}`;

const featuredDedupeKey = (e: Experience): string =>
  `${e.partner_id || ''}|${(e.title || e.name || '').trim().toLowerCase()}`;

// Static featured.json (partners) paints first; the API (partner_events, one
// row per DATE of the same event) is merged IN FRONT, deduped to one card per
// partner+title keeping the soonest date. Static rows the API already covers
// drop out. Content grows instead of swapping, and nothing is shown twice.
function mergeFeatured(apiRows: Experience[], staticRows: Experience[]): Experience[] {
  const seen = new Set<string>();
  const out: Experience[] = [];
  const soonestFirst = [...apiRows].sort((a, b) =>
    String(a.date || a.date_start || '').localeCompare(String(b.date || b.date_start || '')));
  for (const e of [...soonestFirst, ...staticRows]) {
    const k = featuredDedupeKey(e);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out.slice(0, 12);
}

const sameFeatured = (a: Experience[], b: Experience[]): boolean =>
  a.length === b.length && a.every((e, i) => featuredKey(e) === featuredKey(b[i]) && (e.image_url || '') === (b[i].image_url || ''));

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
  priority,
}: {
  item: Experience;
  onPress: () => void;
  priority: 'low' | 'normal' | 'high';
}) {
  const tr = useTr();
  const { lang } = useLang();
  // NEVER infer free from a missing price — an unpriced experience is "a consultar",
  // not free (audit Aug 2026: 13/13 featured items had price=null,is_free=null and
  // rendered "Gratis" on paid yacht charters). formatPrice returns null for an
  // unpriced paid item, so the pill simply hides.
  const price = formatPrice(item.price ?? 0, !!item.is_free);
  const tierStr = item.partner_tier || item.tier || '';
  const tierColor = tierStr ? TIER_COLORS[tierStr as Tier] : null;
  // Partner-event rows carry a date — surface it so a dated card reads as an event.
  const dateLabel = item.event_id ? eventDateLabel(item.date || item.date_start, item.date_end, lang, tr) : '';
  return (
    <TouchableOpacity
      style={styles.featuredCard}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <SafeImage
        uri={item.image_url || item.flyer_url || item.partner_image || item.cover_image}
        // A missing flyer falls to the partner's own photo, never a generic stock shot.
        fallbackUri={item.partner_image || item.flyer_url}
        category={item.category}
        priority={priority}
        style={styles.featuredImage}
      />
      <LinearGradient
        colors={['transparent', 'rgba(8,12,22,0.5)', COLORS.background]}
        locations={[0, 0.55, 1]}
        style={styles.featuredOverlay}
        pointerEvents="none"
      />
      {tierColor && (
        <View style={[styles.featuredTierStripe, { backgroundColor: tierColor.main }]} />
      )}
      {dateLabel ? (
        <View style={styles.eventCardDateBadge}>
          <Text style={styles.eventCardDateText}>{dateLabel}</Text>
        </View>
      ) : null}
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
              <Text style={styles.pricePillText}>{price === 'Gratis' ? tr('Gratis') : price}</Text>
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
  localCount,
  lensBadge,
}: {
  partner: Partner;
  onPress: () => void;
  localCount?: number;
  /** 4A: "Reportado por viajeros" on a VERIFY-tagged venue while a lens filter is
   *  active — HIGH rows render plain, and the badge never says "verificado". */
  lensBadge?: string | null;
}) {
  const tr = useTr();
  const tierColor = partner.tier ? TIER_COLORS[partner.tier] : null;
  return (
    <PressableScale
      style={[
        styles.gridCard,
        tierColor && { borderColor: tierColor.border, borderWidth: 1.5 },
      ]}
      onPress={onPress}
    >
      <SafeImage
        uri={partner.image_url}
        category={partner.category}
        // Grid tiles yield the download queue to the hero and featured cards.
        priority="low"
        style={styles.gridImage}
      />
      <LinearGradient
        colors={['transparent', 'rgba(8,12,22,0.5)', COLORS.background]}
        locations={[0, 0.55, 1]}
        style={styles.gridOverlay}
        pointerEvents="none"
      />
      {tierColor && (
        <View style={[styles.gridTierStripe, { backgroundColor: tierColor.main }]} />
      )}
      <View style={styles.gridTopRow}>
        {partner.tier && <TierBadge tier={partner.tier} size="xs" showLabel={false} />}
        {/* Drop 6: the shield dot is EARNED verification only, never the import flag */}
        {(partner as any)?.verification?.status === 'verificado' && (
          <View style={styles.certDot}>
            <Ionicons name="shield-checkmark" size={10} color={COLORS.official} />
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
              <Ionicons name="star" size={10} color={COLORS.mustard} />
              <Text style={styles.gridRatingText}>{Number((partner as any).rating).toFixed(1)}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.gridName} numberOfLines={2}>
          {partner.name}
        </Text>
        <Text style={[styles.gridCategory, { color: colorForKey((partner as any).category) }]} numberOfLines={1}>
          {tr(PARTNER_CATEGORY_LABELS[(partner as any).category] || (partner as any).category || '')}
        </Text>
        {typeof localCount === 'number' && localCount > 0 && (
          <View style={styles.localPickBadge}>
            <Ionicons name="home" size={9} color={COLORS.icon} />
            <Text style={styles.localPickText} numberOfLines={1}>
              {tr('Favorito local')} · {localCount}
            </Text>
          </View>
        )}
        {!!lensBadge && (
          <View style={styles.lensVerifyBadge}>
            <Ionicons name="people-outline" size={9} color={COLORS.mustard} />
            <Text style={styles.lensVerifyBadgeText} numberOfLines={1}>{lensBadge}</Text>
          </View>
        )}
      </View>
    </PressableScale>
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
// Neighborhood copy ships in ES + EN. Show ONE language (the user's; FR/PT read
// EN) instead of stacking both — half the text, none of the noise.
const pickNbLang = (lang: Lang, es?: string, en?: string): string =>
  (lang === 'es' ? (es || en) : (en || es)) || '';

function NeighborhoodCard({
  item,
  onPress,
}: {
  item: Neighborhood;
  onPress: () => void;
}) {
  const { lang } = useLang();
  const tr = useTr();
  return (
    <TouchableOpacity style={styles.nbCard} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.nbCardInner}>
        <View style={styles.nbCardTitleRow}>
          <Text style={[styles.nbName, { flex: 1 }]} numberOfLines={1}>{item.name}</Text>
          <Ionicons name="chevron-forward" size={14} color={COLORS.iconMuted} />
        </View>
        <Text style={styles.nbCharacter} numberOfLines={2}>{pickNbLang(lang, item.character_es, item.character_en)}</Text>
        <View style={styles.nbRatingsRow}>
          <View style={styles.nbRatingGroup}>
            <Ionicons name="shield-checkmark" size={12} color={COLORS.icon} />
            {Array.from({ length: 5 }).map((_, i) => (
              <Ionicons
                key={`s${i}`}
                name={i < item.safety_rating ? 'star' : 'star-outline'}
                size={10}
                color={i < item.safety_rating ? COLORS.mustard : COLORS.textMuted}
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
              <Text style={styles.nbTagText}>{tr(BEST_FOR_LABELS[tag] || tag)}</Text>
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
  const tr = useTr();
  const { lang } = useLang();
  // Hooks stay above the early return (React #310 crashed prod before).
  const insets = useSafeAreaInsets();
  if (!item) return null;

  const character = pickNbLang(lang, item.character_es, item.character_en);
  const dayNote = pickNbLang(lang, item.safety_notes_day_es, item.safety_notes_day_en);
  const nightNote = pickNbLang(lang, item.safety_notes_night_es, item.safety_notes_night_en);
  const howTo = pickNbLang(lang, item.how_to_get_there_es, item.how_to_get_there_en);
  const mistake = pickNbLang(lang, item.tourist_mistakes_es, item.tourist_mistakes_en);

  // LAYOUT BUG THIS FIXES (TestFlight 18, t=30–38 of Phil's recording): the
  // sheet had only `maxHeight` (content-derived height) and the ScrollView had
  // `flex: 1` → flexBasis 0 → Yoga gave it 0 px on iOS. The user saw a dim
  // overlay with a handle and "Close" for ~10 s and read it as a freeze. Web
  // masked it (CSS `flex: 1 1 0%` resolves to content). The ScrollView now
  // measures its content (basis auto) and only IT shrinks when the sheet hits
  // its cap; the header and Close button keep RN's default flexShrink 0.
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.nbModalOverlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} accessibilityLabel={tr('Cerrar')} />
        <View style={[styles.nbModalSheet, { paddingBottom: Math.max(insets.bottom, SPACING.md) }]}>
          <View style={styles.nbModalHandle} />
          <View style={styles.nbModalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.nbModalTitle} numberOfLines={2}>{item.name}</Text>
              {item.aka.length > 0 && (
                <Text style={styles.nbModalAka} numberOfLines={1}>a.k.a. {item.aka.join(', ')}</Text>
              )}
            </View>
            <TouchableOpacity
              style={styles.nbModalX}
              onPress={onClose}
              activeOpacity={0.8}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={tr('Cerrar')}
            >
              <Ionicons name="close" size={20} color={COLORS.textMain} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.nbModalScroll}
            contentContainerStyle={styles.nbModalScrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* At-a-glance row: safety + price, the two things people tap in for */}
            <View style={styles.nbModalGlance}>
              <View style={styles.nbModalGlanceCell}>
                <Text style={styles.nbModalGlanceLabel}>{tr('Seguridad')}</Text>
                <View style={styles.nbModalStarsRow}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Ionicons
                      key={`ms${i}`}
                      name={i < item.safety_rating ? 'star' : 'star-outline'}
                      size={14}
                      color={i < item.safety_rating ? COLORS.mustard : COLORS.textFaint}
                    />
                  ))}
                  <Text style={styles.nbModalRatingText}>{item.safety_rating}/5</Text>
                </View>
              </View>
              <View style={styles.nbModalGlanceDivider} />
              <View style={styles.nbModalGlanceCell}>
                <Text style={styles.nbModalGlanceLabel}>{tr('Nivel de precios')}</Text>
                <Text style={styles.nbModalPriceLevel}>
                  {'$'.repeat(item.price_index)}
                  <Text style={{ color: COLORS.textFaint }}>{'$'.repeat(5 - item.price_index)}</Text>
                </Text>
              </View>
            </View>

            {!!character && <Text style={styles.nbModalDesc}>{character}</Text>}

            {/* Best for */}
            {item.best_for.length > 0 && (
              <View style={styles.nbModalSection}>
                <View style={styles.nbModalSectionHeader}>
                  <Ionicons name="heart-outline" size={15} color={COLORS.icon} />
                  <Text style={styles.nbModalSectionTitle}>{tr('Ideal para')}</Text>
                </View>
                <View style={styles.nbModalTags}>
                  {item.best_for.map((tag) => (
                    <View key={tag} style={styles.nbModalTag}>
                      <Text style={styles.nbModalTagText}>{tr(BEST_FOR_LABELS[tag] || tag)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Safety notes — one line each, day / night */}
            {(!!dayNote || !!nightNote) && (
              <View style={styles.nbModalSection}>
                <View style={styles.nbModalSectionHeader}>
                  <Ionicons name="shield-checkmark" size={15} color={COLORS.icon} />
                  <Text style={styles.nbModalSectionTitle}>{tr('Seguridad')}</Text>
                </View>
                {!!dayNote && (
                  <View style={styles.nbModalNoteRow}>
                    <Ionicons name="sunny-outline" size={14} color={COLORS.mustard} style={styles.nbModalNoteIcon} />
                    <Text style={styles.nbModalNote}>{dayNote}</Text>
                  </View>
                )}
                {!!nightNote && (
                  <View style={styles.nbModalNoteRow}>
                    <Ionicons name="moon-outline" size={14} color={COLORS.official} style={styles.nbModalNoteIcon} />
                    <Text style={styles.nbModalNote}>{nightNote}</Text>
                  </View>
                )}
              </View>
            )}

            {/* Getting there + airport taxi fare. The fare is absent for
                boat-access-only neighborhoods (e.g. Tierrabomba) — hide it
                rather than show a misleading number. */}
            {(!!howTo || item.taxi_fare_from_airport_cop != null) && (
              <View style={styles.nbModalSection}>
                <View style={styles.nbModalSectionHeader}>
                  <Ionicons name="navigate-outline" size={15} color={COLORS.icon} />
                  <Text style={styles.nbModalSectionTitle}>{tr('Cómo llegar')}</Text>
                </View>
                {!!howTo && <Text style={styles.nbModalNote}>{howTo}</Text>}
                {item.taxi_fare_from_airport_cop != null && (
                  <View style={styles.nbModalNoteRow}>
                    <Ionicons name="car-outline" size={14} color={COLORS.icon} style={styles.nbModalNoteIcon} />
                    <Text style={styles.nbModalNote}>
                      {tr('Taxi desde el aeropuerto')}: <Text style={styles.nbModalFare}>${item.taxi_fare_from_airport_cop.toLocaleString()} COP</Text>
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Tourist mistake */}
            {!!mistake && (
              <View style={[styles.nbModalSection, styles.nbModalCallout]}>
                <View style={styles.nbModalSectionHeader}>
                  <Ionicons name="warning-outline" size={15} color={COLORS.mustard} />
                  <Text style={styles.nbModalSectionTitle}>{tr('Error de turista')}</Text>
                </View>
                <Text style={styles.nbModalNote}>{mistake}</Text>
              </View>
            )}
          </ScrollView>

          <TouchableOpacity style={styles.nbModalCloseBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.nbModalCloseBtnText}>{tr('Cerrar')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function ExploreScreen() {
  const router = useRouter();
  const { category: routeCategory, subcategory: routeSubcategory, lens: routeLens } =
    useLocalSearchParams<{ category?: string; subcategory?: string; lens?: string }>();
  const { s, lang } = useLang();
  const tr = useTr();
  const { getPersonalizedPartners, userProfile, isLoading: profileLoading } = usePersonalization();

  const [selectedCategory, setSelectedCategory] = useState<CategoryItem>(CATEGORIES[0]);
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);
  const [featured, setFeatured] = useState<Experience[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<PublicEvent[]>([]);
  const [allCategoryPartners, setAllCategoryPartners] = useState<Partner[]>([]);
  const [loadingFeatured, setLoadingFeatured] = useState(true);
  const [loadingPartners, setLoadingPartners] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);
  const [loadingNeighborhoods, setLoadingNeighborhoods] = useState(true);
  // P1-9: a load that fails on EVERY source (static snapshot + live) is an error
  // row, never a silently missing rail or a "Próximamente" grid. Last good data
  // stays on screen while the flag is up.
  const [featuredError, setFeaturedError] = useState(false);
  const [partnersError, setPartnersError] = useState(false);
  const [nbError, setNbError] = useState(false);
  const [selectedNeighborhood, setSelectedNeighborhood] = useState<Neighborhood | null>(null);
  const [nbModalVisible, setNbModalVisible] = useState(false);
  const [localsOnly, setLocalsOnly] = useState(false);
  const [localsNbh, setLocalsNbh] = useState<string | null>(null);
  // LENSES (docs/lenses/DESIGN.md §4): a LIVE venues-lens filters the grid to its
  // verified set. Gated lenses never reach this (LensRow shows the honest card).
  // 4A: the payload's per-venue confidence/notes drive the "Reportado por viajeros"
  // badge, and the lens's advisories render as labelled honest-gap lines.
  // Label/tagline stay as L4 and localize AT RENDER: the ?lens= deep-link effect can
  // fire before the stored language hydrates, so a capture-time pickL4 bakes Spanish
  // chrome into an EN session (caught by the 4A live walk).
  const [lensFilter, setLensFilter] = useState<{
    key: LensKey;
    tagline: L4 | null;
    ids: Set<string>;
    meta: Map<string, { confidence: 'HIGH' | 'VERIFY'; note: L4 | null }>;
    advisories: LensAdvisory[];
  } | null>(null);
  const localPicks = useLocalPicks();

  const activateLens = useCallback((key: LensKey) => {
    if (key === 'golden_hour') { router.push('/(tabs)/mapa?lens=golden_hour' as never); return; }
    if (key === 'port_day') { router.push('/port-day' as never); return; }
    const def = lensDef(bundledLenses(), key);
    api.get(`/lenses/${key}`)
      .then((res: unknown) => {
        const r = res as { venues?: LensVenueRow[]; advisories?: LensAdvisory[]; tagline?: L4 };
        const venues = r?.venues || [];
        const ids = new Set(venues.map((v) => String(v.venue_id || '')).filter(Boolean));
        const meta = new Map(venues
          .filter((v) => v.venue_id)
          .map((v) => [String(v.venue_id), {
            confidence: (v.confidence === 'HIGH' ? 'HIGH' : 'VERIFY') as 'HIGH' | 'VERIFY',
            note: v.note ?? null,
          }]));
        if (ids.size) {
          setLensFilter({
            key, ids, meta,
            tagline: r?.tagline ?? def?.tagline ?? null,
            advisories: Array.isArray(r?.advisories) ? r.advisories : [],
          });
        }
      })
      .catch(() => { /* unreachable → nothing to filter, never a fake empty grid */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `/(tabs)/explore?lens=step_free` (map chip / Luna): activate the lens once per
  // navigation — the mapa?lens= ref-guard pattern, mirrored.
  const lensParamRef = useRef<string | null>(null);
  useEffect(() => {
    const k = typeof routeLens === 'string' ? routeLens : null;
    if (!k) { lensParamRef.current = null; return; }
    if (lensParamRef.current === k) return;
    lensParamRef.current = k;
    activateLens(k as LensKey);
    router.setParams({ lens: undefined } as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeLens]);

  // Hydration guard: card widths are derived from Dimensions.get('window') at
  // module load, so the static export prerenders them with a default viewport
  // width while the client computes the real device width — the mismatched
  // inline widths tripped React #418 on hydration. Hold a deterministic first
  // paint (hero only, no width-derived styles) until mounted, matching the
  // prerender, then render the real, correctly-sized layout.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Walking Layer battery discipline: the geo watch runs ONLY while Explore
  // is the focused screen (geoService also clears it when the tab is hidden).
  useFocusEffect(
    useCallback(() => {
      geoService.start();
      return () => geoService.stop();
    }, []),
  );

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

  const sortPartners = useCallback((list: Partner[], category: CategoryItem) => {
    const filtered = category.apiValue
      ? list.filter(p => p.category === category.apiValue)
      : list;
    const tierOrder: Record<string, number> = { elite: 0, premium: 1, popular: 2, standard: 3 };
    filtered.sort((a, b) => {
      const ta = tierOrder[(a as any).tier] ?? 3;
      const tb = tierOrder[(b as any).tier] ?? 3;
      if (ta !== tb) return ta - tb;
      // Within a tier, order by AMO's own rank_score (tier + claimed + 30d engagement).
      const ra = (a as any).rank_score ?? (a as any).rating ?? 0;
      const rb = (b as any).rank_score ?? (b as any).rating ?? 0;
      return rb - ra;
    });
    // P0 browse fix: "Todos" used to be the raw global tier sort, whose elite/premium
    // head is wall-to-wall beach clubs — the front door looked like one category.
    // Interleave the (already tier-sorted) categories round-robin so the first
    // screens are a representative mix; each category's internal order is preserved.
    if (!category.apiValue) {
      const byCat = new Map<string, Partner[]>();
      for (const p of filtered) {
        const c = String((p as any).category || 'other');
        const q = byCat.get(c);
        if (q) q.push(p); else byCat.set(c, [p]);
      }
      // Drop 6: within each category queue, verification-carrying rows ride FIRST
      // (verificado > reportado > untiered, order otherwise stable) — so the honest
      // tiers surface in the first rotations of "Todos" instead of sorting last
      // behind rating-carrying bulk-import rows.
      const vRank = (p: Partner) => {
        const s = (p as any).verification?.status;
        return s === 'verificado' ? 0 : s === 'reportado' ? 1 : 2;
      };
      const queues = [...byCat.values()].map((q) =>
        q.map((p, i) => ({ p, i })).sort((a, b) => (vRank(a.p) - vRank(b.p)) || (a.i - b.i)).map(x => x.p));
      const mixed: Partner[] = [];
      for (let i = 0; queues.some(q => q.length > i); i++) {
        for (const q of queues) if (q[i]) mixed.push(q[i]);
      }
      return mixed;
    }
    return filtered;
  }, []);

  // Both featured sources are kept; whichever lands (in any order) re-merges.
  // Fallback-first: once the row holds data it never re-enters the skeleton.
  const staticFeaturedRef = useRef<Experience[]>([]);
  const apiFeaturedRef = useRef<Experience[]>([]);
  const applyFeatured = useCallback(() => {
    const merged = mergeFeatured(apiFeaturedRef.current, staticFeaturedRef.current);
    if (merged.length > 0) setFeatured(prev => (sameFeatured(prev, merged) ? prev : merged));
  }, []);

  const loadFeatured = useCallback(async () => {
    let staticOk = false;
    let apiOk = false;
    const staticP = fetch(ASSET_ORIGIN + '/data/experiences/featured.json')
      .then(r => (r.ok ? r.json() : null))
      .then(sf => {
        if (Array.isArray(sf) && sf.length > 0) {
          staticOk = true;
          staticFeaturedRef.current = sf;
          applyFeatured();
          setLoadingFeatured(false);
        }
      })
      .catch((e) => console.error('[ExploreScreen] featured static', e));
    const apiP = api.get('/experiences/featured')
      .then(data => {
        if (Array.isArray(data)) {
          apiOk = true; // the server answered — an empty rail is an answer, not an outage
          if (data.length > 0) {
            apiFeaturedRef.current = data;
            applyFeatured();
          }
        }
      })
      .catch((e) => console.error('[ExploreScreen] featured live', e))
      .finally(() => setLoadingFeatured(false));
    await Promise.allSettled([staticP, apiP]);
    setFeaturedError(!staticOk && !apiOk);
  }, [applyFeatured]);

  const loadPartners = useCallback(async (category: CategoryItem) => {
    setLoadingPartners(true);
    const applyPersonalization = (list: Partner[]) => {
      const sorted = sortPartners(list, category);
      return userProfile.isPersonalized ? getPersonalizedPartners(sorted) : sorted;
    };
    let staticOk = false;
    let liveOk = false;
    // Static-first (non-blocking)
    const staticP = fetch(ASSET_ORIGIN + '/data/partners.json').then(r => r.ok ? r.json() : null)
      .then(sf => {
        if (Array.isArray(sf) && sf.length > 0) {
          staticOk = true;
          setAllCategoryPartners(applyPersonalization(sf));
          setLoadingPartners(false);
        }
      }).catch((e) => console.error('[ExploreScreen] partners static', e));
    // Hydrate from backend (non-blocking)
    const liveP = api.get('/partners')
      .then(data => {
        const all: Partner[] = Array.isArray(data) ? data : [];
        if (all.length > 0) { liveOk = true; setAllCategoryPartners(applyPersonalization(all)); }
      })
      .catch(e => console.error('[ExploreScreen] partners', e))
      .finally(() => setLoadingPartners(false));
    await Promise.allSettled([staticP, liveP]);
    // Error only when BOTH the bundled snapshot and the live catalog failed.
    setPartnersError(!staticOk && !liveOk);
  }, [sortPartners, userProfile.isPersonalized, getPersonalizedPartners]);

  const loadNeighborhoods = useCallback(async () => {
    // Static-first (backend has no /neighborhoods endpoint — data is static-only)
    await fetch(ASSET_ORIGIN + '/data/neighborhoods.json').then(r => r.ok ? r.json() : null)
      .then(data => {
        if (Array.isArray(data)) { setNeighborhoods(data); setNbError(false); }
        else setNbError(true);
      })
      .catch((e) => { console.error('[ExploreScreen] neighborhoods', e); setNbError(true); })
      .finally(() => setLoadingNeighborhoods(false));
  }, []);

  // Verified city events only (EVENTS-ELITE feed): soonest first, sub-events
  // folded under their umbrella. A feed the loader cannot vouch for → no rail.
  const loadUpcomingEvents = useCallback(async () => {
    try {
      const feedState = await loadFeed();
      setUpcomingEvents(compactUpcoming(feedState.data.events, 10));
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
    // Wait for the taste profile to finish loading before the first paint. Otherwise
    // the list paints the NON-personalized order (by rank_score) first, then re-sorts
    // once AsyncStorage resolves isPersonalized → a visible flicker where a top-ranked
    // venue (e.g. Bethel) appears then drops. The loadingPartners skeleton covers the
    // brief wait. (Franck Aug 2026: "Bethel reflects then disappears".)
    if (profileLoading) return;
    loadPartners(selectedCategory);
  }, [selectedCategory, loadPartners, userProfile.isPersonalized, profileLoading]);

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

  // Count of partners per subcategory tile (hoisted above the gateway decision —
  // the gateway must know whether ANY tile has data). Restaurants count via
  // matchesCuisine so cross-cutting cuisines (Mediterránea = the whole basin) and
  // multi-cuisine venues are included — not only the single stored subcategory —
  // otherwise the tile would read 0 and hide (the "Mediterranean missing" bug).
  const subcatCounts: Record<string, number> = {};
  if (selectedCategory.apiValue === 'restaurant') {
    for (const sc of availableSubcats) {
      subcatCounts[sc.key] = allCategoryPartners.filter(p => matchesCuisine(p, sc.key)).length;
    }
  } else {
    for (const sc of availableSubcats) {
      subcatCounts[sc.key] = allCategoryPartners.filter(p =>
        (p as any).subcategory === sc.key ||
        (Array.isArray((p as any).style_tags) && (p as any).style_tags.includes(sc.key))
      ).length;
    }
  }

  // Are we showing the sub-category gateway (tiles) or the partner grid?
  // Gateway shows when: the category has subs, the user hasn't picked one yet,
  // AND at least one tile actually has places. P0 browse-spine fix: tiles whose
  // keys don't match the stored subcategories all count 0 and auto-hide — the
  // gateway used to render anyway (header + zero tiles) while force-emptying the
  // grid, so Cafés/Hoteles showed a blank "Elige tu …" although "Ver todos" had
  // the full list. With zero populated tiles we fall straight through to the
  // partner grid — the same render path "Ver todos" uses — so an inline section
  // can never again be blank while the category has places.
  const inSubcatGateway =
    availableSubcats.length > 0 && !selectedSubcategory &&
    availableSubcats.some((sc) => (subcatCounts[sc.key] || 0) > 0);

  // Partners shown in the grid: respect subcategory filter when set.
  // '__all__' sentinel means "show all in this category" (skip subcat filter).
  let partners: Partner[] =
    selectedSubcategory && selectedSubcategory !== '__all__'
      ? allCategoryPartners.filter(p =>
          selectedCategory.apiValue === 'restaurant'
            ? matchesCuisine(p, selectedSubcategory)          // basin + multi-cuisine
            : (p as any).subcategory === selectedSubcategory ||
              (Array.isArray((p as any).style_tags) && (p as any).style_tags.includes(selectedSubcategory)))
      : allCategoryPartners;
  // "Locals recommend" filter: keep only venues locals favor (behavioral picks
  // + local_favorite-tagged baseline). Never empties the catalog when off.
  // Neighborhoods with at least one local pick — for the "locals in <barrio>" sub-filter.
  const localsNbhCounts: Record<string, number> = {};
  if (localsOnly) {
    for (const p of allCategoryPartners) {
      if (!localPicks.ids.has((p as any).partner_id)) continue;
      const loc = (p as any).location || {};
      const nb = nearestNeighborhood(loc.lat, loc.lng, neighborhoods);
      if (nb) localsNbhCounts[nb] = (localsNbhCounts[nb] || 0) + 1;
    }
    partners = partners.filter(p => localPicks.ids.has((p as any).partner_id));
    if (localsNbh) {
      partners = partners.filter(p => {
        const loc = (p as any).location || {};
        return nearestNeighborhood(loc.lat, loc.lng, neighborhoods) === localsNbh;
      });
    }
  }
  // Live venues-lens filter (step-free / family / women-verified once they fill):
  // only venues in the lens's verified set. ANDs with everything above.
  if (lensFilter) {
    partners = partners.filter(p => lensFilter.ids.has((p as any).partner_id));
  }
  // Drop 6: the "Todos" category-axis invariant — applied LAST, after sort,
  // personalization, locals and lens filters, so nothing upstream can recluster
  // the front door: full round-robin across categories, plus the ≤2-consecutive
  // cap as belt-and-braces for the deep tail where queues run out.
  if (selectedCategory.key === 'all') {
    partners = capConsecutiveByCategory(interleaveByCategory(partners), 2);
  }
  const localsNbhOptions = localsOnly
    ? neighborhoods
        .filter(n => localsNbhCounts[n.slug])
        .map(n => ({ slug: n.slug, name: n.name, count: localsNbhCounts[n.slug] }))
        .sort((a, b) => b.count - a.count)
    : [];

  // (subcatCounts is computed above, before the gateway decision — P0 browse fix.)

  // Resolved label for currently selected subcategory (for the back-header)
  const subcatLabel = availableSubcats.find(s => s.key === selectedSubcategory)?.label || '';

  // ── List header: title + search + category chips + featured section ────────

  const ListHeader = (
    <View>
      {/* ── Hero Banner ── */}
      <View style={styles.exploreHero}>
        {/* Decorative 540 KB banner under a 60% overlay: LOW priority so the
            content cards below win the download queue. */}
        <SafeImage uri={IMAGES.cartagena_aerial} priority="low" style={styles.exploreHeroImg} />
        <View style={styles.exploreHeroOverlay} />
        <View style={styles.exploreHeroContent}>
          <Text style={styles.title}>{tr('Explorar')}</Text>
          <Text style={styles.subtitle}>{tr('Descubre lo mejor de Cartagena')}</Text>
        </View>
        <TouchableOpacity
          style={styles.mapBtn}
          onPress={() => router.push('/mapa' as any)}
          activeOpacity={0.8}
        >
          <Ionicons name="map-outline" size={18} color={COLORS.icon} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.mapBtn, { top: 64 }]}
          onPress={() => router.push('/pasaporte' as any)}
          activeOpacity={0.8}
        >
          <Ionicons name="ribbon-outline" size={18} color={COLORS.icon} />
        </TouchableOpacity>
      </View>
      <View style={styles.header}>
        <SearchBarButton onPress={() => router.push('/search')} />
      </View>

      {/* ── Cerca de ti (Walking Layer) — renders nothing unless geo is
             granted AND ≥1 venue is within 150m; fails soft to today's app ── */}
      <NearbyStrip />

      {/* ── Personalization indicator ── */}
      {userProfile.isPersonalized && (
        <TouchableOpacity
          style={styles.personalizationBanner}
          onPress={() => router.push('/onboarding' as any)}
          activeOpacity={0.8}
        >
          <Text style={styles.personalizationText}>
            {'\u2728'} {tr('Ordenado seg\u00fan tus preferencias')}
          </Text>
          <Text style={styles.personalizationEdit}>{tr('Editar')}</Text>
        </TouchableOpacity>
      )}

      {/* ── Category chips ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        style={styles.chipScroll}
      >
        {/* ── "Locals recommend" filter toggle (modifier, not a category) ── */}
        <TouchableOpacity
          key="__locals__"
          testID="explore-locals-toggle"
          style={[styles.chip, styles.localsChip, localsOnly && styles.localsChipActive]}
          onPress={() => { setLocalsOnly(v => !v); setLocalsNbh(null); }}
          activeOpacity={0.8}
        >
          <Ionicons name="home" size={12} color={localsOnly ? COLORS.white : COLORS.icon} />
          <Text style={[styles.chipText, styles.localsChipText, localsOnly && styles.chipTextActive]}>
            {tr('Locales')}
          </Text>
        </TouchableOpacity>
        <View style={styles.chipDivider} />
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
                color={active ? COLORS.white : colorForKey(cat.apiValue || cat.key)}
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

      {/* 5A: the anti-scam advisory rides the Experiencias category — the catalog's
          activities are "Reportado", never a verification, until earned. */}
      {selectedCategory.key === 'activities' && (
        <View style={styles.actAdvisory}>
          <Ionicons name="shield-outline" size={13} color={COLORS.mustard} />
          <View style={{ flex: 1 }}>
            <Text style={styles.actAdvisoryText}>{tr('Pide el RNT y acuerda el precio antes de pagar.')}</Text>
            {/* 5C: the supply-side door — held operators (and new ones) verify to publish */}
            <TouchableOpacity onPress={() => router.push('/reclama' as never)} accessibilityRole="button"
              style={{ minHeight: 28, justifyContent: 'center' }}>
              <Text style={styles.actAdvisoryLink}>{tr('¿Eres operador? Reclama tu listado →')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── LENSES — modes over the one catalog (docs/lenses/DESIGN.md §4) ── */}
      <View style={{ paddingHorizontal: SPACING.lg, marginTop: 10 }}>
        <LensRow active={lensFilter?.key ?? null} onActivate={activateLens} />
        {lensFilter && (
          <TouchableOpacity
            onPress={() => setLensFilter(null)}
            style={{
              flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6,
              marginTop: 8, minHeight: 44, paddingHorizontal: 12, borderRadius: 22,
              backgroundColor: 'rgba(18,181,165,0.12)', borderWidth: 1, borderColor: COLORS.primary,
            }}
            accessibilityRole="button"
            accessibilityLabel={tr('Limpiar filtros')}
          >
            <Text style={{ color: COLORS.primary, fontSize: 12, fontWeight: '700' }}>
              {pickL4(lensDef(bundledLenses(), lensFilter.key)?.label ?? null, lang)} · {partners.length}
            </Text>
            <Ionicons name="close" size={14} color={COLORS.primary} />
          </TouchableOpacity>
        )}
        {/* 4A: the lens header frames the promise honestly (anchors + assisted, never a
            citywide guarantee) and the advisories surface what is NOT confirmed. */}
        {lensFilter && (
          <View style={styles.lensHeaderBox}>
            {!!lensFilter.tagline && <Text style={styles.lensTagline}>{pickL4(lensFilter.tagline, lang)}</Text>}
            {lensFilter.advisories.map((a, i) => (
              <View key={i} style={styles.lensAdvisoryRow}>
                <View style={[
                  styles.lensAdvisoryChip,
                  a.kind === 'unverified' && styles.lensAdvisoryChipWarn,
                  a.kind === 'confirmed' && styles.lensAdvisoryChipOk,
                  a.kind === 'invite' && styles.lensAdvisoryChipInvite,
                ]}>
                  <Text style={[
                    styles.lensAdvisoryChipText,
                    a.kind === 'unverified' && styles.lensAdvisoryChipTextWarn,
                    a.kind === 'confirmed' && styles.lensAdvisoryChipTextOk,
                    a.kind === 'invite' && styles.lensAdvisoryChipTextInvite,
                  ]}>
                    {a.kind === 'unverified' ? tr('Sin verificar')
                      : a.kind === 'confirmed' ? tr('Oficial')
                      : a.kind === 'invite' ? tr('Sé la primera')
                      : tr(lensFilter.key === 'women_verified' ? 'Reportado por viajeras' : 'Reportado por viajeros')}
                  </Text>
                </View>
                <Text style={styles.lensAdvisoryText}>
                  {pickL4(a.text, lang)}
                  {(a.kind === 'reported' || a.kind === 'confirmed') && a.source_name
                    ? `  ·  ${tr('Fuente')}: ${a.source_name}` : ''}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* ── Neighborhood sub-filter (only when "Locals" is active) ── */}
      {localsOnly && localsNbhOptions.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          style={styles.chipScroll}
        >
          <TouchableOpacity
            style={[styles.nbhChip, !localsNbh && styles.nbhChipActive]}
            onPress={() => setLocalsNbh(null)}
            activeOpacity={0.8}
          >
            <Text style={[styles.nbhChipText, !localsNbh && styles.nbhChipTextActive]}>{tr('Todos')}</Text>
          </TouchableOpacity>
          {localsNbhOptions.map(n => {
            const active = localsNbh === n.slug;
            return (
              <TouchableOpacity
                key={n.slug}
                testID={`explore-locals-nbh-${n.slug}`}
                style={[styles.nbhChip, active && styles.nbhChipActive]}
                onPress={() => setLocalsNbh(active ? null : n.slug)}
                activeOpacity={0.8}
              >
                <Ionicons name="location" size={10} color={active ? COLORS.white : COLORS.icon} />
                <Text style={[styles.nbhChipText, active && styles.nbhChipTextActive]}>{n.name} · {n.count}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* ── Featured experiences (only on "Todos" view) ── */}
      {selectedCategory.key === 'all' && (loadingFeatured || featured.length > 0 || featuredError) && (
        <FadeInUp style={styles.section} delay={0}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              <Ionicons name="sparkles" size={14} color={COLORS.icon} />
              {'  '}{tr('Experiencias Destacadas')}
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
          ) : featured.length === 0 ? (
            /* P1-9: both featured sources failed — one quiet line, never a vanished rail */
            <LoadError compact message={tr('No se pudo cargar')} retryLabel={tr('reintentar')} onRetry={loadFeatured} testID="explore-featured-error" />
          ) : (
            <FlatList
              data={featured}
              // Stable per-card identity across the static→API merge (mergeFeatured
              // already guarantees one card per partner+title).
              keyExtractor={featuredKey}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.featuredList}
              renderItem={({ item, index }) => (
                <FeaturedCard
                  item={item}
                  priority={index < 2 ? 'high' : 'normal'}
                  onPress={() => {
                    // Partner-event rows open the event, not just the venue.
                    const route = item.event_id
                      ? `/partner-event/${item.event_id}`
                      : item.partner_id
                        ? `/partner/${item.partner_id}`
                        : `/experience/${item.experience_id}`;
                    router.push(route as any);
                  }}
                />
              )}
            />
          )}
        </FadeInUp>
      )}

      {/* ── Eventos destacados (only on "Todos" view) — the verified feed ── */}
      {selectedCategory.key === 'all' && upcomingEvents.length > 0 && (
        <FadeInUp style={styles.section} delay={90}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              <Ionicons name="calendar" size={14} color={COLORS.icon} />
              {'  '}{tr('Eventos destacados')}
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/que-pasa' as any)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.seeAll}>{tr('Ver todos')}</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={upcomingEvents}
            keyExtractor={(item) => item.event_id}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.featuredList}
            renderItem={({ item: ev, index }) => {
              const meta = CATEGORY_META[ev.category] || CATEGORY_META.cultural;
              const today = bogotaToday();
              const ongoing = !ev.is_umbrella && !!ev.start_date && ev.start_date <= today && (ev.end_date || ev.start_date) >= today;
              const dateLabel = ongoing ? tr('Hoy') : formatEventDates(ev, lang).toUpperCase();
              return (
                <TouchableOpacity
                  style={styles.eventCard}
                  activeOpacity={0.85}
                  onPress={() => router.push(`/event/${ev.event_id}` as any)}
                  accessibilityRole="button"
                  accessibilityLabel={`${pickL(ev.title, lang)} · ${dateLabel}`}
                >
                  <View style={styles.eventCardImage}>
                    <EventMedia ev={ev} height="100%" iconSize={28} priority={index < 2 ? 'high' : 'normal'} />
                  </View>
                  <LinearGradient
                    colors={['transparent', 'rgba(8,12,22,0.5)', COLORS.background]}
                    locations={[0, 0.55, 1]}
                    style={styles.eventCardOverlay}
                    pointerEvents="none"
                  />
                  {dateLabel ? (
                    <View style={styles.eventCardDateBadge}>
                      <Text style={styles.eventCardDateText}>{dateLabel}</Text>
                    </View>
                  ) : null}
                  <View style={styles.eventCardContent}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                      <View style={styles.eventCardCatBadge}>
                        <Text style={styles.eventCardCatText}>{tr(meta.label).toUpperCase()}</Text>
                      </View>
                      <EventTrustChip ev={ev} tr={tr} />
                    </View>
                    <Text style={styles.eventCardTitle} numberOfLines={2}>
                      {pickL(ev.title, lang)}
                    </Text>
                    {!!ev.venue_name && (
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
        </FadeInUp>
      )}

      {/* ── Barrios de Cartagena (only on "Todos" view) ── */}
      {selectedCategory.key === 'all' && (loadingNeighborhoods || neighborhoods.length > 0 || nbError) && (
        <FadeInUp style={styles.section} delay={180}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              <Ionicons name="location" size={14} color={COLORS.icon} />
              {'  '}{tr('Barrios de Cartagena')}
            </Text>
          </View>

          {loadingNeighborhoods ? (
            <SkeletonFeaturedRow />
          ) : neighborhoods.length === 0 ? (
            <LoadError compact message={tr('No se pudo cargar')} retryLabel={tr('reintentar')} onRetry={loadNeighborhoods} testID="explore-barrios-error" />
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
        </FadeInUp>
      )}

      {/* ── Partners grid header / sub-category gateway ── */}
      {inSubcatGateway ? (
        <View>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {/* P0: replace(/s$/) minted "hotele"/"bare"/"atraccione" — singulars are data */}
              {tr('Elige tu')} {tr(CATEGORY_SINGULAR[selectedCategory.key] || selectedCategory.label.toLowerCase())}
            </Text>
            {allCategoryPartners.length > 0 && (
              <TouchableOpacity onPress={() => setSelectedSubcategory('__all__')} activeOpacity={0.8}>
                <Text style={styles.seeAll}>{tr('Ver todos')}</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.subcatGrid}>
            {availableSubcats.map((sc) => {
              const count = subcatCounts[sc.key] || 0;
              if (count === 0) return null;
              const scColor = colorForKey(sc.key);
              return (
                <TouchableOpacity
                  key={sc.key}
                  style={styles.subcatTile}
                  activeOpacity={0.85}
                  onPress={() => setSelectedSubcategory(sc.key)}
                >
                  <View style={[styles.subcatIconWrap, { backgroundColor: `${scColor}22`, borderColor: `${scColor}55` }]}>
                    <Ionicons name={sc.icon as any} size={22} color={scColor} />
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
                <Ionicons name="chevron-back" size={20} color={COLORS.iconMuted} />
              </TouchableOpacity>
            )}
            <Text style={styles.sectionTitle}>
              {selectedCategory.key === 'all'
                ? tr('Todos los Lugares')
                : selectedSubcategory && selectedSubcategory !== '__all__'
                ? `${tr(selectedCategory.label)} · ${tr(subcatLabel)}`
                : tr(selectedCategory.label)}
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
  ) : partnersError && allCategoryPartners.length === 0 ? (
    /* P1-9: the catalog itself failed (static + live) — never "Próximamente" */
    <LoadError message={tr('No se pudo cargar')} retryLabel={tr('reintentar')} onRetry={() => loadPartners(selectedCategory)} testID="explore-partners-error" />
  ) : lensFilter ? (
    /* P0: a lens ANDed with a category can legitimately hit zero — that renders the
       lens's HONEST empty state (women: the "sé la primera" invite), never the
       generic "Próximamente" and never a silent blank. The advisories box above
       stays visible; this block names the why and offers the way out. */
    <View style={styles.emptyState}>
      <Ionicons name="telescope-outline" size={48} color={COLORS.textMuted} />
      <Text style={styles.emptyTitle}>
        {lensFilter.key === 'women_verified' ? tr('Sé la primera') : tr('Sin resultados en esta lente')}
      </Text>
      <Text style={styles.emptyText}>
        {lensFilter.key === 'women_verified'
          ? pickL4(lensFilter.advisories.find(a => a.kind === 'invite')?.text ?? null, lang)
            || tr('Aún no hay lugares verificados por mujeres en esta categoría.')
          : tr('Ningún lugar de esta categoría está en esta lente todavía — mira los avisos arriba o quita el filtro.')}
      </Text>
      <TouchableOpacity
        style={styles.emptyBtn}
        onPress={() => setLensFilter(null)}
        activeOpacity={0.85}
      >
        <Text style={styles.emptyBtnText}>{tr('Quitar lente')}</Text>
      </TouchableOpacity>
    </View>
  ) : (
    <View style={styles.emptyState}>
      <Ionicons name="search-outline" size={48} color={COLORS.textMuted} />
      <Text style={styles.emptyTitle}>{tr('Próximamente')}</Text>
      <Text style={styles.emptyText}>
        {tr('No hay lugares en esta categoría todavía')}
      </Text>
      <TouchableOpacity
        style={styles.emptyBtn}
        onPress={() => setSelectedCategory(CATEGORIES[0])}
        activeOpacity={0.85}
      >
        <Text style={styles.emptyBtnText}>{tr('Ver todos')}</Text>
      </TouchableOpacity>
    </View>
  );

  // Deterministic pre-mount paint (see hydration guard above). Uses only
  // fixed-dimension styles so the build prerender and the client's first
  // render are byte-identical, then the real layout renders after mount.
  if (!mounted) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.exploreHero}>
          <SafeImage uri={IMAGES.cartagena_aerial} style={styles.exploreHeroImg} />
          <View style={styles.exploreHeroOverlay} />
          <View style={styles.exploreHeroContent}>
            <Text style={styles.title}>{tr('Explorar')}</Text>
            <Text style={styles.subtitle}>{tr('Descubre lo mejor de Cartagena')}</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

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
            localCount={behavioralPick(localPicks, item.partner_id)?.local_count}
            lensBadge={lensFilter?.meta.get(item.partner_id)?.confidence === 'VERIFY'
              ? tr(lensFilter.key === 'women_verified' ? 'Reportado por viajeras' : 'Reportado por viajeros')
              : null}
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
                <Text style={styles.footerBtnText}>{tr('Ver todos los partners')}</Text>
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
    ...TYPE.display,
    color: COLORS.textMain,
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
    backgroundColor: 'rgba(18,181,165,0.15)',
    borderRadius: RADIUS.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(18,181,165,0.35)',
  },
  searchAiText: {
    fontSize: 10,
    color: COLORS.primary,
    ...FONTS.bold,
    letterSpacing: 0.5,
  },

  // Personalization banner
  personalizationBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    borderRadius: RADIUS.lg,
    backgroundColor: `${COLORS.icon}1A`,
    borderWidth: 1,
    borderColor: `${COLORS.icon}40`,
  },
  personalizationText: {
    fontSize: 12,
    color: COLORS.icon,
    ...FONTS.medium,
  },
  personalizationEdit: {
    fontSize: 12,
    color: COLORS.primary,
    ...FONTS.bold,
    textDecorationLine: 'underline' as const,
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
  // "Locals recommend" toggle — quiet neutral chrome; only the active fill stays teal
  localsChip: {
    backgroundColor: `${COLORS.icon}14`,
    borderColor: COLORS.icon,
  },
  localsChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  localsChipText: {
    color: COLORS.icon,
  },
  chipDivider: {
    width: 1,
    alignSelf: 'stretch',
    marginVertical: 4,
    backgroundColor: COLORS.border,
  },
  // Neighborhood sub-filter chips (under the Locals toggle)
  nbhChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    backgroundColor: `${COLORS.icon}0D`,
    borderWidth: 1,
    borderColor: `${COLORS.icon}33`,
  },
  nbhChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  nbhChipText: {
    fontSize: 11,
    color: COLORS.icon,
    ...FONTS.semibold,
  },
  nbhChipTextActive: {
    color: COLORS.white,
  },
  // "Local pick" badge on partner cards (behavioral picks only)
  localPickBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 3,
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
    backgroundColor: `${COLORS.icon}18`,
    borderWidth: 1,
    borderColor: `${COLORS.icon}40`,
  },
  localPickText: {
    fontSize: 9,
    color: COLORS.icon,
    ...FONTS.bold,
  },

  // 4A lens chrome: the VERIFY-row card badge and the honest-gap header lines.
  lensVerifyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 3,
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
    backgroundColor: `${COLORS.mustard}18`,
    borderWidth: 1,
    borderColor: `${COLORS.mustard}55`,
  },
  lensVerifyBadgeText: {
    fontSize: 9,
    color: COLORS.mustard,
    ...FONTS.bold,
  },
  lensHeaderBox: {
    marginTop: 10,
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  lensTagline: {
    fontSize: 12.5,
    color: COLORS.textMain,
    lineHeight: 18,
    ...FONTS.semibold,
  },
  lensAdvisoryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  lensAdvisoryChip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: 1,
  },
  lensAdvisoryChipWarn: {
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderColor: 'rgba(245,166,35,0.45)',
  },
  lensAdvisoryChipOk: {
    backgroundColor: 'rgba(59,130,246,0.12)',
    borderColor: 'rgba(59,130,246,0.45)',
  },
  lensAdvisoryChipInvite: {
    backgroundColor: 'rgba(236,72,153,0.12)',
    borderColor: 'rgba(236,72,153,0.45)',
  },
  lensAdvisoryChipText: {
    fontSize: 9,
    color: COLORS.textMuted,
    ...FONTS.bold,
  },
  lensAdvisoryChipTextWarn: {
    color: '#F5A623',
  },
  lensAdvisoryChipTextOk: {
    color: '#3B82F6',
  },
  lensAdvisoryChipTextInvite: {
    color: '#EC4899',
  },
  lensAdvisoryText: {
    flex: 1,
    fontSize: 11.5,
    color: COLORS.textMuted,
    lineHeight: 16.5,
    ...FONTS.regular,
  },
  actAdvisory: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginHorizontal: SPACING.lg,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(245,166,35,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.35)',
  },
  actAdvisoryText: {
    fontSize: 11.5,
    color: COLORS.textMain,
    lineHeight: 16,
    ...FONTS.semibold,
  },
  actAdvisoryLink: {
    fontSize: 11.5,
    color: COLORS.primary,
    ...FONTS.bold,
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
    ...TYPE.title3,
    color: COLORS.textMain,
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
    ...ELEVATION.md,
  },
  featuredImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  // Gradient-only: expo-linear-gradient paints ON TOP of the view's own
  // background, so a flat 45% fill here muddied every loaded photo.
  featuredOverlay: {
    ...StyleSheet.absoluteFillObject,
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
    backgroundColor: 'rgba(5,8,20,0.85)',
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
    paddingBottom: FAB_CLEARANCE, // the last card scrolls clear of the assistant FAB
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
    ...ELEVATION.md,
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
    borderColor: `${COLORS.official}66`,
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
    borderColor: `${COLORS.icon}59`,
  },
  gridPriceText: {
    fontSize: 9,
    color: COLORS.icon,
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
    color: COLORS.mustard,
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
    ...TYPE.headline,
    color: COLORS.textMain,
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
    borderColor: 'rgba(18,181,165,0.35)',
    backgroundColor: 'rgba(18,181,165,0.08)',
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
    backgroundColor: 'rgba(18,181,165,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(18,181,165,0.3)',
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
    color: COLORS.icon,
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
  },
  eventCardDateBadge: {
    position: 'absolute',
    top: SPACING.sm,
    right: SPACING.sm,
    backgroundColor: 'rgba(5,8,20,0.85)',
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
  nbCardTitleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.xs },
  nbName: { fontSize: 15, color: COLORS.textMain, ...FONTS.bold },
  nbCharacter: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 17 },
  nbRatingsRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  nbRatingGroup: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 2 },
  nbPrice: { fontSize: 13, color: COLORS.icon, ...FONTS.bold, letterSpacing: 1 },
  nbTagsRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 4 },
  nbTag: { backgroundColor: `${COLORS.icon}1F`, borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: `${COLORS.icon}40` },
  nbTagText: { fontSize: 10, color: COLORS.icon, ...FONTS.semibold },
  // ── Neighborhood sheet ──
  nbModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' as const },
  // maxHeight caps the sheet; the ScrollView (flexGrow 0 / flexShrink 1, basis
  // auto) is the ONLY child that shrinks. No `flex: 1` anywhere inside — that
  // is what zeroed the content on iOS.
  nbModalSheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: COLORS.border,
    maxHeight: '88%' as const,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    ...ELEVATION.sheet,
  },
  nbModalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.textFaint, alignSelf: 'center' as const, marginBottom: SPACING.md },
  nbModalHeader: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: SPACING.sm, paddingBottom: SPACING.sm },
  nbModalTitle: { ...TYPE.title2, color: COLORS.textMain },
  nbModalAka: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, fontStyle: 'italic' as const, marginTop: 2 },
  nbModalX: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' as const, justifyContent: 'center' as const },
  nbModalScroll: { flexGrow: 0, flexShrink: 1 },
  nbModalScrollContent: { paddingBottom: SPACING.md },
  nbModalGlance: { flexDirection: 'row' as const, alignItems: 'center' as const, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, marginBottom: SPACING.md },
  nbModalGlanceCell: { flex: 1, gap: 4 },
  nbModalGlanceDivider: { width: 1, alignSelf: 'stretch' as const, backgroundColor: COLORS.border, marginHorizontal: SPACING.md },
  nbModalGlanceLabel: { ...TYPE.overline, color: COLORS.textMuted, textTransform: 'uppercase' as const },
  nbModalDesc: { ...TYPE.body, color: COLORS.textMain },
  nbModalSection: { marginTop: SPACING.lg, gap: SPACING.sm },
  nbModalCallout: { backgroundColor: 'rgba(233,185,73,0.08)', borderWidth: 1, borderColor: 'rgba(233,185,73,0.25)', borderRadius: RADIUS.lg, padding: SPACING.md },
  nbModalSectionHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.sm },
  nbModalSectionTitle: { ...TYPE.headline, color: COLORS.textMain },
  nbModalStarsRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 3 },
  nbModalRatingText: { ...TYPE.footnote, color: COLORS.textMuted, marginLeft: SPACING.xs },
  nbModalNoteRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: SPACING.sm },
  nbModalNoteIcon: { marginTop: 3 },
  nbModalNote: { ...TYPE.subhead, fontWeight: '400' as const, color: COLORS.textMain, flex: 1 },
  nbModalPriceLevel: { fontSize: 16, color: COLORS.icon, ...FONTS.bold, letterSpacing: 2 },
  nbModalFare: { color: COLORS.textMain, ...FONTS.bold },
  nbModalTags: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6 },
  nbModalTag: { backgroundColor: `${COLORS.icon}1F`, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: `${COLORS.icon}40` },
  nbModalTagText: { fontSize: 12, color: COLORS.icon, ...FONTS.semibold },
  nbModalCloseBtn: { backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.full, minHeight: 48, paddingVertical: 14, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 1, borderColor: COLORS.border, marginTop: SPACING.sm },
  nbModalCloseBtnText: { fontSize: 15, color: COLORS.textMain, ...FONTS.bold },
});
