// LunaRecs — THE one recommendation-card pipeline for every Luna surface
// (AssistantFab sheet, /concierge chat, and any future agent UI).
//
// Extracted from AssistantFab 2026-10-08 after the "gold medal" recording: the
// unified /concierge screen dropped `assistant.recommendations` on the floor, so
// Luna said "here are the top picks:" and rendered nothing under it. Two Lunas
// drifting is the disease; this module is the cure — type, labels, catalog→card
// mapping, client-side enrichment, the intent gate for instant local picks, the
// card, and the horizontal row live HERE and nowhere else.
import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, ELEVATION, FONTS, RADIUS, SPACING, colorForKey } from '../../constants/theme';
import type { Lang } from '../../i18n/translations';
import { loadCatalog, matchCatalog, type CatalogVenue } from '../../lib/lunaOffline';
import AddToTrip from '../AddToTrip';
import { SafeImage } from '../SafeImage';

export type Recommendation = {
  kind: 'partner' | 'event';
  partner_id?: string;
  event_id?: string;
  name: string;
  type?: string;
  vibe?: string;
  price_range?: string;
  address?: string;
  reason?: string;
  // Resolved CLIENT-SIDE from the bundled catalog (never sent by the backend —
  // ai_agent.py's _sanitize_recommendations schema has no image/category field).
  // Partner recs only; events have no local image source.
  image?: string;
  category?: string;
};

export const RECOMMENDATION_LABELS: Record<Lang, { event: string; partner: string; viewEvent: string; viewPartner: string }> = {
  es: { event: 'Evento', partner: 'Partner', viewEvent: 'Ver evento', viewPartner: 'Ver partner' },
  en: { event: 'Event', partner: 'Partner', viewEvent: 'View event', viewPartner: 'View partner' },
  fr: { event: 'Événement', partner: 'Partenaire', viewEvent: "Voir l'événement", viewPartner: 'Voir le partenaire' },
  pt: { event: 'Evento', partner: 'Parceiro', viewEvent: 'Ver evento', viewPartner: 'Ver parceiro' },
};

// Real venues from the bundled catalog → concierge recommendation cards. Used for
// the instant preview (perceived speed) AND the fallback when Luna is slow/errors,
// so the guest ALWAYS gets real places instead of a dead "Tuve un problema".
export function venuesToRecs(venues: CatalogVenue[], lang: Lang): Recommendation[] {
  const en = lang.startsWith('en');
  return venues.map((v) => ({
    kind: 'partner' as const,
    partner_id: v.partner_id,
    name: v.name,
    type: (en ? v.display_en : v.display_es) || v.category,
    price_range: v.price_range,
    address: v.zone || (v.address ? v.address.split(',')[0] : ''),
    image: v.image,
    category: v.category,
  }));
}

// The LIVE LLM reply never includes an image or raw category key. Backfill both
// client-side from the bundled catalog, by partner_id. Events pass through.
export function enrichRecommendations(recs: Recommendation[], catalog: CatalogVenue[]): Recommendation[] {
  if (!recs.length || !catalog.length) return recs;
  const byId = new Map(catalog.map((v) => [v.partner_id, v] as const));
  return recs.map((r) => {
    if (r.kind !== 'partner' || !r.partner_id) return r;
    const cv = byId.get(r.partner_id);
    if (!cv) return r;
    return { ...r, image: r.image || cv.image, category: r.category || cv.category };
  });
}

/**
 * THE intent gate for instant local picks, in one place. A preview only fires on
 * a real venue lookup: a recognized category/cuisine word, or ≥3 genuine catalog
 * hits. ("I don't see the list" once stem-matched Donjuán/Doña Lola through the
 * 3-letter fragment 'don' and answered a rooftop complaint with restaurants —
 * the ≥4-char stem rule in matchCatalog plus this gate kills that class.)
 */
export function quickRecsFromCatalog(catalog: CatalogVenue[], query: string, lang: Lang, limit = 6): Recommendation[] {
  if (!catalog.length) return [];
  const { venues, cats, tags } = matchCatalog(catalog, query, limit);
  if (!venues.length || (!cats.size && !tags.size && venues.length < 3)) return [];
  return venuesToRecs(venues, lang);
}

/** Async convenience for screens that don't hold the catalog themselves. */
export async function localQuickRecs(query: string, lang: Lang, limit = 6): Promise<Recommendation[]> {
  try {
    return quickRecsFromCatalog(await loadCatalog(), query, lang, limit);
  } catch {
    return [];
  }
}

// Resilience copy shared by every Luna surface: shown over the instant local
// cards while the LLM composes (preview) and when it is slow/errored (slow).
// Warm and grounded in "the connection is slow", never apologetic-robotic.
export const LUNA_STR: Record<Lang, { preview: string; slow: string }> = {
  es: {
    preview: 'Ideas al instante mientras Luna arma la respuesta completa:',
    slow: 'Luna le sigue dando vueltas a tu respuesta — mientras, esto es real y está cerca:',
  },
  en: {
    preview: 'Instant ideas while Luna puts together the full answer:',
    slow: "Luna's still thinking it through — meanwhile, here's what's real and nearby:",
  },
  fr: {
    preview: 'Des idées immédiates pendant que Luna prépare la réponse complète :',
    slow: 'Luna y réfléchit encore — en attendant, voici de vraies options tout près :',
  },
  pt: {
    preview: 'Ideias na hora enquanto a Luna prepara a resposta completa:',
    slow: 'A Luna ainda está pensando na sua resposta — enquanto isso, isto é real e fica perto:',
  },
};

export function RecommendationCard({
  rec,
  lang,
  onPress,
}: {
  rec: Recommendation;
  lang: Lang;
  onPress: () => void;
}) {
  const isEvent = rec.kind === 'event';
  // Every venue keeps ITS OWN spectrum color (never Luna's purple) — category
  // when we have it (catalog-resolved), else the human `type` label, else a
  // stable generic fallback. colorForKey() hashes anything unrecognized into a
  // distinct, stable color, so a card is never monochrome.
  const accent = colorForKey(rec.category || rec.type || (isEvent ? 'event' : 'partner'));
  const icon: keyof typeof Ionicons.glyphMap = isEvent ? 'calendar' : 'business';
  const L = RECOMMENDATION_LABELS[lang] || RECOMMENDATION_LABELS.es;
  const chipLabel = rec.type || (isEvent ? L.event : L.partner);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.recCardShadow, pressed && { opacity: 0.88 }, Platform.OS === 'web' && ({ touchAction: 'manipulation', cursor: 'pointer' } as any)]}
    >
      <View style={styles.recCardInner}>
        {rec.image ? (
          <View style={styles.recImageWrap}>
            <SafeImage uri={rec.image} category={rec.category} style={styles.recImage} resizeMode="cover" />
            <View style={[styles.recImageBar, { backgroundColor: accent }]} />
            {!!rec.price_range && (
              <View style={[styles.recPriceBadge, styles.recPriceBadgeOnPhoto]}>
                <Text style={styles.recPriceText}>{rec.price_range}</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={[styles.recIconHeader, { backgroundColor: accent + '1F' }]}>
            <View style={[styles.recIcon, { backgroundColor: accent }]}>
              <Ionicons name={icon} size={16} color={COLORS.white} />
            </View>
            {!!rec.price_range && (
              <View style={[styles.recPriceBadge, styles.recPriceBadgeOnDark]}>
                <Text style={styles.recPriceText}>{rec.price_range}</Text>
              </View>
            )}
          </View>
        )}

        <View style={styles.recMetaRow}>
          <View style={[styles.recKindChip, { backgroundColor: accent + '22', borderColor: accent + '55' }]}>
            <Text style={[styles.recKindChipText, { color: accent }]} numberOfLines={1}>{chipLabel}</Text>
          </View>
          {/* Drop 10 (10D1): Luna recommends INTO the itinerary — one tap adds */}
          {rec.kind === 'partner' && rec.partner_id ? (
            <AddToTrip refType="venue" refId={rec.partner_id} name={rec.name} compact />
          ) : rec.kind === 'event' && rec.event_id && String(rec.event_id).startsWith('pe_') ? (
            <AddToTrip refType="experience" refId={rec.event_id} name={rec.name} compact />
          ) : null}
        </View>

        <View style={styles.recBody}>
          <Text style={styles.recName} numberOfLines={2}>
            {rec.name}
          </Text>
          {!!rec.vibe && (
            <View style={styles.recVibeRow}>
              <Ionicons name="sparkles" size={11} color={COLORS.icon} />
              <Text style={styles.recVibe} numberOfLines={2}>
                {rec.vibe}
              </Text>
            </View>
          )}
          {!!rec.reason && (
            <Text style={styles.recReason} numberOfLines={3}>
              {rec.reason}
            </Text>
          )}
          {!!rec.address && (
            <View style={styles.recVibeRow}>
              <Ionicons name="location-outline" size={11} color={COLORS.icon} />
              <Text style={styles.recVibe} numberOfLines={1}>
                {rec.address}
              </Text>
            </View>
          )}
          <View style={[styles.recCta, { backgroundColor: accent }]}>
            <Text style={styles.recCtaText}>
              {isEvent ? L.viewEvent : L.viewPartner}
            </Text>
            <Ionicons name="arrow-forward" size={13} color={COLORS.white} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

/** Horizontal card row. Web uses a plain CSS scroller — RNW ScrollView's JS touch
 *  responder swallows horizontal swipes inside chat surfaces on iOS Safari. */
export function RecRow({
  recs,
  lang,
  onPressRec,
}: {
  recs: Recommendation[];
  lang: Lang;
  onPressRec: (rec: Recommendation) => void;
}) {
  if (!recs.length) return null;
  if (Platform.OS === 'web') {
    return (
      <View
        style={[styles.recsScroll, styles.recsScrollContent, {
          flexDirection: 'row',
          overflowX: 'auto',
          overflowY: 'hidden',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-x',
          maxWidth: '100%',
        } as any]}
      >
        {recs.map((r, i) => (
          <RecommendationCard key={`rec-${i}-${r.partner_id || r.event_id}`} rec={r} lang={lang} onPress={() => onPressRec(r)} />
        ))}
      </View>
    );
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      nestedScrollEnabled
      contentContainerStyle={styles.recsScrollContent}
      style={styles.recsScroll}
    >
      {recs.map((r, i) => (
        <RecommendationCard key={`rec-${i}-${r.partner_id || r.event_id}`} rec={r} lang={lang} onPress={() => onPressRec(r)} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  recsScroll: { marginLeft: -SPACING.md, marginRight: -SPACING.md },
  recsScrollContent: { paddingHorizontal: SPACING.md, gap: 10 },
  recCardShadow: {
    width: 240,
    flexShrink: 0,
    marginRight: 10,
    borderRadius: RADIUS.lg,
    ...ELEVATION.card,
  },
  recCardInner: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    overflow: 'hidden',
  },
  recImageWrap: { width: '100%', height: 100, position: 'relative' },
  recImage: { width: '100%', height: 100 },
  recImageBar: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3 },
  recIconHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  recIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recPriceBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  recPriceBadgeOnDark: { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: COLORS.hairline },
  recPriceBadgeOnPhoto: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(8,12,22,0.72)',
    borderColor: 'rgba(255,255,255,0.18)',
  },
  recPriceText: { color: COLORS.white, fontSize: 10.5, ...FONTS.bold, letterSpacing: 0.3 },
  recMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingTop: 8,
    gap: 6,
  },
  recKindChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    flexShrink: 1,
  },
  recKindChipText: { fontSize: 10.5, ...FONTS.bold, letterSpacing: 0.2 },
  recBody: { paddingHorizontal: 10, paddingBottom: 10, paddingTop: 6, gap: 5 },
  recName: { color: COLORS.textMain, fontSize: 14, ...FONTS.bold, lineHeight: 18 },
  recVibeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  recVibe: { color: COLORS.textMuted, fontSize: 11, ...FONTS.regular, flex: 1 },
  recReason: {
    color: COLORS.textMain,
    fontSize: 11.5,
    ...FONTS.regular,
    lineHeight: 15,
    marginTop: 3,
    opacity: 0.92,
  },
  recCta: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: RADIUS.md,
  },
  recCtaText: { color: COLORS.white, fontSize: 12, ...FONTS.bold },
});
