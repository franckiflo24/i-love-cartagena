import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Image, ActivityIndicator, Keyboard, Linking,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { api } from '../src/constants/api';
import { useTr } from '../src/i18n/autoTr';
import { useLang } from '../src/context/LanguageContext';

type AIHighlight = { type: string; id: string; reason: string };
type AIRecommendation = {
  kind: 'partner' | 'event';
  partner_id?: string;
  event_id?: string;
  name: string;
  type?: string;
  vibe?: string;
  price_range?: string;
  address?: string;
  reason?: string;
};
type AIAction = {
  type: string;
  label?: string;
  partner_id?: string;
  event_id?: string;
  screen?: string;
  filters?: Record<string, any>;
  qty?: number;
  travel_date?: string;
  plan_id?: string;
  category?: string;
  url?: string;
};
type AIPayload = {
  query: string;
  intent: string;
  answer: string;
  language?: string;
  suggested_tab?: string;
  highlights: AIHighlight[];
  recommendations?: AIRecommendation[];
  actions?: AIAction[];
  suggestions?: string[];
};

type Results = {
  events: any[];
  concerts: any[];
  partners: any[];
  venues: any[];
  transport: any[];
  partner_events: any[];
  ai?: AIPayload;
};

const INTENT_META: Record<string, { color: string; icon: string; label: string }> = {
  partner:    { color: '#A855F7', icon: 'business',          label: 'Partner' },
  event:      { color: '#22C55E', icon: 'calendar',          label: 'Evento' },
  concert:    { color: '#F472B6', icon: 'musical-notes',     label: 'Concierto' },
  transport:  { color: '#3B82F6', icon: 'boat',              label: 'Transporte' },
  itinerary:  { color: '#FBBF24', icon: 'map',               label: 'Itinerario' },
  city_pass:  { color: '#D97706', icon: 'sparkles',          label: 'City Pass' },
  port_tax:   { color: '#06B6D4', icon: 'qr-code',           label: 'Tasa Portuaria' },
  general:    { color: COLORS.primary, icon: 'compass',      label: 'Sugerencia' },
};

const TAB_TO_ROUTE: Record<string, string> = {
  'Agenda':     '/(tabs)/agenda',
  'Conciertos': '/concerts',
  'Partners':   '/(tabs)/partners',
  'City Pass':  '/(tabs)/citypass',
  'Transporte': '/transport',
};

export default function SearchScreen() {
  const tr = useTr();
  const router = useRouter();
  const { lang } = useLang();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults(null); setSearched(false); return; }
    setLoading(true);
    setSearched(true);
    try {
      const data = await api.get(`/search?q=${encodeURIComponent(q)}&lang=${lang || 'es'}`);
      setResults(data);
    } catch (e) { console.error(e); }
    setLoading(false);
    Keyboard.dismiss();
  }, [lang]);

  const totalResults = results
    ? results.events.length + results.concerts.length + results.partners.length
      + results.venues.length + results.transport.length + results.partner_events.length
    : 0;

  const openHighlight = (h: AIHighlight) => {
    switch (h.type) {
      case 'partner':       router.push(`/partner/${h.id}` as any); break;
      case 'event':         router.push(`/event/${h.id}` as any); break;
      case 'concert':       router.push('/concerts' as any); break;
      case 'transport':     router.push('/transport' as any); break;
      case 'port_tax':      router.push('/port-tax/checkout' as any); break;
      case 'city_pass':     router.push('/(tabs)/citypass' as any); break;
      case 'itinerary':     router.push('/itineraries' as any); break;
      default: break;
    }
  };

  const openSuggestedTab = (tab?: string) => {
    if (!tab) return;
    const route = TAB_TO_ROUTE[tab];
    if (route) router.push(route as any);
  };

  // ── Concierge action handlers (recommendations + actions) ──
  const openRecommendation = (r: AIRecommendation) => {
    if (r.kind === 'event' && r.event_id) {
      router.push(`/event/${r.event_id}` as any);
    } else if (r.kind === 'partner' && r.partner_id) {
      router.push(`/partner/${r.partner_id}` as any);
    }
  };

  const handleAction = (a: AIAction) => {
    switch (a.type) {
      case 'open_partner':
        if (a.partner_id) router.push(`/partner/${a.partner_id}` as any);
        break;
      case 'open_event':
        if (a.event_id) router.push(`/event/${a.event_id}` as any);
        break;
      case 'show_partners': {
        const f = a.filters || {};
        const qs: string[] = [];
        if (f.category) qs.push(`category=${encodeURIComponent(f.category)}`);
        if (f.subcategory) qs.push(`subcategory=${encodeURIComponent(f.subcategory)}`);
        if (f.tier) qs.push(`tier=${encodeURIComponent(f.tier)}`);
        router.push(`/(tabs)/partners${qs.length ? '?' + qs.join('&') : ''}` as any);
        break;
      }
      case 'show_events': {
        const f = a.filters || {};
        const qs: string[] = [];
        if (f.category) qs.push(`category=${encodeURIComponent(f.category)}`);
        if (f.date) qs.push(`date=${encodeURIComponent(f.date)}`);
        router.push(`/(tabs)/agenda${qs.length ? '?' + qs.join('&') : ''}` as any);
        break;
      }
      case 'open_port_tax_checkout':
        router.push('/port-tax/checkout' as any);
        break;
      case 'open_city_pass':
        router.push('/(tabs)/citypass' as any);
        break;
      case 'show_itinerary':
        router.push('/itineraries' as any);
        break;
      case 'reservation_link':
        if (a.partner_id) router.push(`/reservation/new?partnerId=${a.partner_id}` as any);
        break;
      case 'external_link':
        if (a.url) Linking.openURL(a.url).catch(() => {});
        break;
      case 'navigate': {
        const screenMap: Record<string, string> = {
          agenda: '/(tabs)/agenda',
          concerts: '/concerts',
          partners: '/(tabs)/partners',
          citypass: '/(tabs)/citypass',
          transport: '/transport',
          itineraries: '/itineraries',
          search: '/search',
        };
        const route = screenMap[a.screen || ''];
        if (route) router.push(route as any);
        break;
      }
      default:
        break;
    }
  };

  const iconForAction = (type: string): keyof typeof Ionicons.glyphMap => {
    const map: Record<string, keyof typeof Ionicons.glyphMap> = {
      open_partner: 'business',
      open_event: 'calendar',
      show_partners: 'grid',
      show_events: 'calendar-outline',
      open_port_tax_checkout: 'boat',
      open_city_pass: 'ticket',
      show_itinerary: 'map',
      reservation_link: 'restaurant',
      external_link: 'open-outline',
      navigate: 'arrow-forward',
    };
    return map[type] || 'sparkles';
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Search Header — Big, comfortable, multi-line capable */}
        <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={20} color={COLORS.primary} style={{ marginTop: 14 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Pregunta a Amo: cena romántica, paseo a Barú, mariscos…"
            placeholderTextColor={COLORS.textMuted}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => doSearch(query)}
            returnKeyType="search"
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            numberOfLines={4}
            blurOnSubmit
            textAlignVertical="top"
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => { setQuery(''); setResults(null); setSearched(false); }}
              style={{ marginTop: 14 }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity onPress={() => doSearch(query)} style={styles.searchBtn} activeOpacity={0.85}>
          <Ionicons name="sparkles" size={22} color="#FFF" />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>Buscando y pensando…</Text>
          </View>
        ) : !searched ? (
          /* Suggestions */
          <View style={styles.suggestions}>
            <Text style={styles.suggestTitle}>¿Qué buscas?</Text>
            <Text style={styles.suggestSubtitle}>
              Puedes preguntar: «cena romántica», «cómo llegar a Barú», «conciertos este viernes», «pase cultural», «tasa portuaria»…
            </Text>
            <View style={styles.suggestRow}>
              {['Cena romántica', 'Conciertos', 'Lancha a Rosario', 'City Pass', 'Tasa portuaria', 'Brunch', 'Salsa'].map(s => (
                <TouchableOpacity key={s} style={styles.suggestChip} onPress={() => { setQuery(s); doSearch(s); }}>
                  <Ionicons name="sparkles" size={12} color={COLORS.primary} />
                  <Text style={styles.suggestText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          <>
            {/* AI Concierge Card — Amo's answer + rich recommendation cards */}
            {(results?.ai?.answer || (results?.ai?.recommendations && results.ai.recommendations.length > 0)) ? (
              <View style={styles.aiCard}>
                <View style={styles.aiHeaderRow}>
                  <View style={[
                    styles.aiIntentChip,
                    { backgroundColor: `${INTENT_META[results!.ai!.intent]?.color || COLORS.primary}22` },
                  ]}>
                    <Ionicons
                      name={(INTENT_META[results!.ai!.intent]?.icon || 'sparkles') as any}
                      size={12}
                      color={INTENT_META[results!.ai!.intent]?.color || COLORS.primary}
                    />
                    <Text style={[
                      styles.aiIntentText,
                      { color: INTENT_META[results!.ai!.intent]?.color || COLORS.primary },
                    ]}>
                      {INTENT_META[results!.ai!.intent]?.label || 'AI'}
                    </Text>
                  </View>
                  <Text style={styles.aiBadge}>AMO IA</Text>
                </View>

                {!!results!.ai!.answer && (
                  <Text style={styles.aiAnswer}>{results!.ai!.answer}</Text>
                )}

                {/* Rich recommendation cards (5-8 from the concierge) */}
                {!!(results!.ai!.recommendations && results!.ai!.recommendations!.length > 0) && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.recsScrollContent}
                    style={styles.recsScroll}
                  >
                    {results!.ai!.recommendations!.map((r, i) => (
                      <RecommendationCard
                        key={`rec-${i}-${r.partner_id || r.event_id}`}
                        rec={r}
                        onPress={() => openRecommendation(r)}
                      />
                    ))}
                  </ScrollView>
                )}

                {/* Action pills (navigation, checkout, etc.) */}
                {!!(results!.ai!.actions && results!.ai!.actions!.length > 0) && (
                  <View style={styles.actionsWrap}>
                    {results!.ai!.actions!.slice(0, 4).map((a, i) => (
                      <TouchableOpacity
                        key={`act-${i}`}
                        style={styles.actionBtn}
                        onPress={() => handleAction(a)}
                        activeOpacity={0.85}
                      >
                        <Ionicons name={iconForAction(a.type)} size={13} color={COLORS.primary} />
                        <Text style={styles.actionBtnText} numberOfLines={1}>
                          {a.label || a.type.replace(/_/g, ' ')}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Quick reply suggestions */}
                {!!(results!.ai!.suggestions && results!.ai!.suggestions!.length > 0) && (
                  <View style={styles.suggestionsWrap}>
                    {results!.ai!.suggestions!.slice(0, 4).map((s, i) => (
                      <TouchableOpacity
                        key={`sug-${i}`}
                        style={styles.suggestionPill}
                        onPress={() => { setQuery(s); doSearch(s); }}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.suggestionText} numberOfLines={1}>{s}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {!!results!.ai!.suggested_tab && (
                  <TouchableOpacity
                    style={styles.suggestedTabBtn}
                    onPress={() => openSuggestedTab(results!.ai!.suggested_tab)}
                  >
                    <Ionicons name="arrow-forward-circle" size={16} color="#FFF" />
                    <Text style={styles.suggestedTabText}>Ir a {results!.ai!.suggested_tab}</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null}

            {totalResults === 0 && !((results?.ai?.recommendations && results.ai.recommendations.length > 0) || (results?.ai?.actions && results.ai.actions.length > 0)) ? (
              <View style={styles.emptyState}>
                <Ionicons name="search-outline" size={48} color={COLORS.textMuted} />
                <Text style={styles.emptyTitle}>Sin resultados directos</Text>
                <Text style={styles.emptyDesc}>
                  Pero la IA tiene una sugerencia arriba. Prueba con otras palabras o navega a la pestaña sugerida.
                </Text>
              </View>
            ) : totalResults === 0 ? null : (
              <>
                <Text style={styles.resultCount}>{totalResults} resultado{totalResults !== 1 ? 's' : ''}</Text>

                {/* Partners */}
                {results!.partners.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>💎 Partners ({results!.partners.length})</Text>
                    {results!.partners.map(p => (
                      <TouchableOpacity key={p.partner_id} style={styles.resultCard} onPress={() => router.push(`/partner/${p.partner_id}`)}>
                        <Image source={{ uri: p.image_url }} style={styles.resultImage} />
                        <View style={styles.resultInfo}>
                          <Text style={styles.resultName} numberOfLines={1}>{p.name}</Text>
                          <Text style={styles.resultMeta}>{p.cuisine || p.subcategory || p.category}</Text>
                          <Text style={styles.resultSub} numberOfLines={1}>{p.address}</Text>
                        </View>
                        {p.rating ? (
                          <View style={styles.ratingPill}>
                            <Ionicons name="star" size={10} color="#FBBF24" />
                            <Text style={styles.ratingText}>{Number(p.rating).toFixed(1)}</Text>
                          </View>
                        ) : (
                          <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Concerts */}
                {results!.concerts.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>🎵 Conciertos ({results!.concerts.length})</Text>
                    {results!.concerts.map(c => (
                      <TouchableOpacity key={c.concert_id} style={styles.resultCard} onPress={() => router.push('/concerts' as any)}>
                        <Image source={{ uri: c.image_url }} style={styles.resultImage} />
                        <View style={styles.resultInfo}>
                          <Text style={styles.resultName} numberOfLines={1}>{c.artist || c.title}</Text>
                          <Text style={styles.resultMeta}>{c.genre}</Text>
                          <Text style={styles.resultSub} numberOfLines={1}>{c.venue_name} · {c.start_time || c.date}</Text>
                        </View>
                        {c.is_free
                          ? <Text style={styles.resultPrice}>{tr('GRATIS')}</Text>
                          : c.price ? <Text style={styles.resultPrice}>${(c.price / 1000).toFixed(0)}K</Text> : null}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Events (city events) */}
                {results!.events.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>📅 Eventos ({results!.events.length})</Text>
                    {results!.events.map(e => (
                      <TouchableOpacity key={e.event_id} style={styles.resultCard} onPress={() => router.push(`/event/${e.event_id}`)}>
                        <Image source={{ uri: e.image_url }} style={styles.resultImage} />
                        <View style={styles.resultInfo}>
                          <Text style={styles.resultName} numberOfLines={1}>{e.title}</Text>
                          <Text style={styles.resultMeta}>{e.type}</Text>
                          <Text style={styles.resultSub} numberOfLines={1}>{e.venue_name} · {e.start_time || e.date}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Partner Events */}
                {results!.partner_events.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>🎉 Eventos partners ({results!.partner_events.length})</Text>
                    {results!.partner_events.map(pe => (
                      <TouchableOpacity key={pe.event_id} style={styles.resultCard} onPress={() => router.push(`/partner-event/${pe.event_id}` as any)}>
                        <Image source={{ uri: pe.image_url || (pe as any).flyer_url }} style={styles.resultImage} />
                        <View style={styles.resultInfo}>
                          <Text style={styles.resultName} numberOfLines={1}>{pe.title}</Text>
                          <Text style={styles.resultMeta}>{pe.category}</Text>
                          <Text style={styles.resultSub} numberOfLines={1}>{pe.partner_name}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Transport */}
                {results!.transport.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>🚤 Transporte ({results!.transport.length})</Text>
                    {results!.transport.map(t => (
                      <TouchableOpacity key={t.transport_id} style={styles.resultCard} onPress={() => router.push('/transport' as any)}>
                        <View style={[styles.resultImage, styles.transportIcon]}>
                          <Ionicons name="boat" size={24} color={COLORS.primary} />
                        </View>
                        <View style={styles.resultInfo}>
                          <Text style={styles.resultName} numberOfLines={1}>{t.route}</Text>
                          <Text style={styles.resultMeta}>{t.type}</Text>
                          <Text style={styles.resultSub} numberOfLines={1}>{t.departure_point}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Venues */}
                {results!.venues.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>📍 Venues ({results!.venues.length})</Text>
                    {results!.venues.map(v => (
                      <TouchableOpacity key={v.venue_id} style={styles.resultCard}>
                        <View style={[styles.resultImage, styles.venueIcon]}>
                          <Ionicons name="location" size={24} color={COLORS.primary} />
                        </View>
                        <View style={styles.resultInfo}>
                          <Text style={styles.resultName} numberOfLines={1}>{v.name}</Text>
                          <Text style={styles.resultMeta}>{v.type}</Text>
                          <Text style={styles.resultSub} numberOfLines={1}>{v.address}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Rich Recommendation Card (concierge partner/event picks) ──
function RecommendationCard({
  rec,
  onPress,
}: {
  rec: AIRecommendation;
  onPress: () => void;
}) {
  const isEvent = rec.kind === 'event';
  const accent = isEvent ? '#7C3AED' : COLORS.primary;
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={styles.recCard}>
      <View style={[styles.recHeader, { backgroundColor: accent + '22', borderColor: accent + '55' }]}>
        <View style={[styles.recIcon, { backgroundColor: accent }]}>
          <Ionicons name={isEvent ? 'calendar' : 'business'} size={13} color={COLORS.white} />
        </View>
        <Text style={[styles.recKindLabel, { color: accent }]} numberOfLines={1}>
          {isEvent ? 'Evento' : 'Partner'}
        </Text>
        {!!rec.price_range && (
          <View style={styles.recPriceBadge}>
            <Text style={styles.recPriceText}>{rec.price_range}</Text>
          </View>
        )}
      </View>
      <View style={styles.recBody}>
        <Text style={styles.recName} numberOfLines={2}>{rec.name}</Text>
        {!!rec.type && <Text style={styles.recType} numberOfLines={1}>{rec.type}</Text>}
        {!!rec.vibe && (
          <View style={styles.recMetaRow}>
            <Ionicons name="sparkles" size={11} color={COLORS.textMuted} />
            <Text style={styles.recVibe} numberOfLines={2}>{rec.vibe}</Text>
          </View>
        )}
        {!!rec.reason && (
          <Text style={styles.recReason} numberOfLines={3}>{rec.reason}</Text>
        )}
        {!!rec.address && (
          <View style={styles.recMetaRow}>
            <Ionicons name="location-outline" size={11} color={COLORS.textMuted} />
            <Text style={styles.recVibe} numberOfLines={1}>{rec.address}</Text>
          </View>
        )}
      </View>
      <View style={styles.recCta}>
        <Text style={styles.recCtaText}>Ver detalle</Text>
        <Ionicons name="arrow-forward" size={12} color={COLORS.white} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  backBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: 4,
    borderWidth: 1.5,
    borderColor: COLORS.primary + '55',
    minHeight: 48,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: COLORS.textMain,
    ...FONTS.regular,
    paddingTop: 12,
    paddingBottom: 12,
    minHeight: 48,
    maxHeight: 140,
    lineHeight: 22,
  },
  searchBtn: { width: 48, height: 48, borderRadius: RADIUS.lg, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },

  loadingWrap: { alignItems: 'center', paddingTop: 60, gap: SPACING.sm },
  loadingText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.medium },

  suggestions: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.xl },
  suggestTitle: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold, marginBottom: 6 },
  suggestSubtitle: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 19, marginBottom: SPACING.md },
  suggestRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  suggestChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.surface, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border,
  },
  suggestText: { fontSize: 13, color: COLORS.textMain, ...FONTS.semibold },

  // AI card
  aiCard: {
    marginHorizontal: SPACING.lg, marginTop: SPACING.md,
    padding: SPACING.md, borderRadius: RADIUS.xl,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5, borderColor: 'rgba(217,119,6,0.35)',
    gap: SPACING.sm,
  },
  aiHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  aiIntentChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full },
  aiIntentText: { fontSize: 10, ...FONTS.bold, letterSpacing: 0.5 },
  aiBadge: { fontSize: 10, color: COLORS.textMuted, ...FONTS.bold, letterSpacing: 1, marginLeft: 'auto' },
  aiAnswer: { fontSize: 14, color: COLORS.textMain, ...FONTS.regular, lineHeight: 20 },
  aiHighlights: { gap: 6, marginTop: 4 },
  aiPick: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 10, paddingVertical: 8,
    backgroundColor: 'rgba(251,191,36,0.10)',
    borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: 'rgba(251,191,36,0.25)',
  },
  aiPickText: { flex: 1, fontSize: 12, color: COLORS.textMain, ...FONTS.medium },
  suggestedTabBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: COLORS.primary, paddingVertical: 10, borderRadius: RADIUS.full,
    marginTop: 4,
  },
  suggestedTabText: { fontSize: 13, color: '#FFF', ...FONTS.bold },

  emptyState: { alignItems: 'center', paddingTop: 40, gap: SPACING.sm, paddingHorizontal: SPACING.lg },
  emptyTitle: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold, textAlign: 'center' },
  emptyDesc: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', lineHeight: 19 },

  resultCount: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, textTransform: 'uppercase', letterSpacing: 0.5 },

  section: { paddingHorizontal: SPACING.lg, marginTop: SPACING.md },
  sectionTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold, marginBottom: SPACING.sm, letterSpacing: 0.3 },

  resultCard: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  resultImage: { width: 52, height: 52, borderRadius: RADIUS.md, backgroundColor: COLORS.surface },
  venueIcon: { backgroundColor: `${COLORS.primary}15`, alignItems: 'center', justifyContent: 'center' },
  transportIcon: { backgroundColor: 'rgba(59,130,246,0.15)', alignItems: 'center', justifyContent: 'center' },
  resultInfo: { flex: 1, gap: 1 },
  resultName: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  resultMeta: { fontSize: 11, color: COLORS.primary, ...FONTS.medium, textTransform: 'capitalize' },
  resultSub: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  resultPrice: { fontSize: 12, color: COLORS.primary, ...FONTS.bold },
  ratingPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(251,191,36,0.15)', paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: RADIUS.full,
  },
  ratingText: { fontSize: 11, color: '#FBBF24', ...FONTS.bold },

  // ── Concierge: recommendation cards (horizontal scroll) ──
  recsScroll: { marginHorizontal: -SPACING.md, marginTop: SPACING.xs },
  recsScrollContent: { paddingHorizontal: SPACING.md, gap: 10 },
  recCard: {
    width: 240,
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  recHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
  },
  recIcon: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  recKindLabel: { fontSize: 11, ...FONTS.bold, letterSpacing: 0.4, flex: 1 },
  recPriceBadge: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: RADIUS.full,
  },
  recPriceText: { fontSize: 10, color: COLORS.textMain, ...FONTS.bold, letterSpacing: 0.3 },
  recBody: { padding: 10, gap: 4 },
  recName: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold, lineHeight: 18 },
  recType: { fontSize: 11, color: COLORS.primary, ...FONTS.semibold, textTransform: 'capitalize' },
  recMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  recVibe: { flex: 1, fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  recReason: { fontSize: 11, color: COLORS.textMain, ...FONTS.regular, lineHeight: 15, marginTop: 4 },
  recCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: COLORS.primary,
    paddingVertical: 9,
  },
  recCtaText: { fontSize: 12, color: COLORS.white, ...FONTS.bold, letterSpacing: 0.3 },

  // ── Action pills ──
  actionsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: SPACING.xs },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(217,119,6,0.12)',
    borderWidth: 1, borderColor: 'rgba(217,119,6,0.4)',
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: RADIUS.full,
  },
  actionBtnText: { fontSize: 12, color: COLORS.primary, ...FONTS.semibold },

  // ── Quick reply suggestions ──
  suggestionsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: SPACING.xs },
  suggestionPill: {
    backgroundColor: COLORS.background,
    borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: RADIUS.full,
  },
  suggestionText: { fontSize: 11, color: COLORS.textMain, ...FONTS.medium },
});
