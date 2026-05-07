import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { api } from '../src/constants/api';
import { useAuth } from '../src/context/AuthContext';

type Stop = {
  time: string;
  title: string;
  venue: string;
  partner_id?: string;
  event_id?: string;
  type?: string;
  duration_min?: number;
  why?: string;
};

type Itinerary = {
  itinerary_id: string;
  name: string;
  description: string;
  category: string;
  vibe_tags?: string[];
  stops: Stop[];
  personal_note?: string;
  generated_at?: string;
  ai_status?: string;
};

const CATEGORIES: { key: 'lifestyle' | 'cultura' | 'musical'; label: string; icon: any; color: string }[] = [
  { key: 'lifestyle', label: 'Lifestyle', icon: 'sparkles',     color: '#D97706' },
  { key: 'cultura',   label: 'Cultura',   icon: 'color-palette', color: '#8B5CF6' },
  { key: 'musical',   label: 'Musical',   icon: 'musical-notes', color: '#EC4899' },
];

const TYPE_ICON: Record<string, any> = {
  wellness: 'leaf',
  gastro: 'restaurant',
  culture: 'color-palette',
  music: 'musical-notes',
  beach: 'sunny',
  nightlife: 'moon',
  other: 'location',
};

export default function ItinerariesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [category, setCategory] = useState<'lifestyle' | 'cultura' | 'musical'>('lifestyle');
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  const load = useCallback(async (cat: string, showLoader = true) => {
    if (showLoader) setLoading(true);
    try {
      const data = await api.get(`/itineraries?category=${cat}`);
      setItinerary(data);
    } catch (e) {
      console.error('itineraries load error', e);
      setItinerary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(category); }, [category, load]);

  const onRegenerate = async () => {
    setRegenerating(true);
    try {
      const data = await api.post('/itineraries/regenerate', { category });
      setItinerary(data);
    } catch (e) {
      console.error('regenerate error', e);
    } finally {
      setRegenerating(false);
    }
  };

  const cat = CATEGORIES.find(c => c.key === category)!;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity testID="itineraries-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Rutas del día</Text>
          <Text style={styles.subtitle}>Curadas por IA · solo para ti</Text>
        </View>
        <TouchableOpacity
          testID="regenerate-btn"
          onPress={onRegenerate}
          disabled={regenerating || loading}
          style={[styles.regenBtn, (regenerating || loading) && { opacity: 0.5 }]}
        >
          {regenerating
            ? <ActivityIndicator size="small" color={COLORS.primary} />
            : <Ionicons name="refresh" size={18} color={COLORS.primary} />}
        </TouchableOpacity>
      </View>

      {/* Category pills */}
      <View style={styles.pillsRow}>
        {CATEGORIES.map(c => {
          const active = c.key === category;
          return (
            <TouchableOpacity
              key={c.key}
              testID={`cat-${c.key}`}
              onPress={() => setCategory(c.key)}
              style={[styles.pill, active && { backgroundColor: c.color, borderColor: c.color }]}
              activeOpacity={0.85}
            >
              <Ionicons name={c.icon} size={14} color={active ? COLORS.white : c.color} />
              <Text style={[styles.pillText, { color: active ? COLORS.white : COLORS.textMain }]}>{c.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(category, true)} tintColor={COLORS.primary} />}
      >
        {loading && !itinerary ? (
          <View style={{ marginTop: 80, alignItems: 'center' }}>
            <ActivityIndicator size="large" color={cat.color} />
            <Text style={styles.loadingTxt}>La IA está curando tu ruta…</Text>
          </View>
        ) : itinerary ? (
          <>
            {/* Hero */}
            <View style={[styles.hero, { borderColor: cat.color }]}>
              <View style={styles.heroRow}>
                <View style={[styles.aiBadge, { backgroundColor: cat.color }]}>
                  <Ionicons name="sparkles" size={11} color={COLORS.white} />
                  <Text style={styles.aiBadgeTxt}>IA · {cat.label.toUpperCase()}</Text>
                </View>
                {itinerary.ai_status === 'fallback' && (
                  <View style={styles.offlineBadge}>
                    <Text style={styles.offlineBadgeTxt}>OFFLINE</Text>
                  </View>
                )}
              </View>
              <Text style={styles.heroTitle}>{itinerary.name}</Text>
              <Text style={styles.heroDesc}>{itinerary.description}</Text>
              {itinerary.vibe_tags && itinerary.vibe_tags.length > 0 && (
                <View style={styles.tagRow}>
                  {itinerary.vibe_tags.slice(0, 5).map((t, i) => (
                    <View key={i} style={styles.tag}>
                      <Text style={styles.tagTxt}>#{t}</Text>
                    </View>
                  ))}
                </View>
              )}
              {itinerary.personal_note ? (
                <View style={[styles.noteBox, { borderLeftColor: cat.color }]}>
                  <Ionicons name="heart" size={12} color={cat.color} />
                  <Text style={styles.noteTxt}>{itinerary.personal_note}</Text>
                </View>
              ) : null}
              {!user && (
                <TouchableOpacity onPress={() => router.push('/login')} style={styles.loginCta}>
                  <Ionicons name="person-add" size={14} color={COLORS.primary} />
                  <Text style={styles.loginCtaTxt}>Inicia sesión para una ruta más personalizada</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Timeline of stops */}
            <View style={styles.timeline}>
              {(itinerary.stops || []).map((stop, i) => {
                const last = i === (itinerary.stops?.length || 0) - 1;
                const iconName = TYPE_ICON[stop.type || 'other'] || 'location';
                const tappable = !!(stop.partner_id || stop.event_id);
                return (
                  <TouchableOpacity
                    key={i}
                    testID={`ai-stop-${i}`}
                    activeOpacity={tappable ? 0.7 : 1}
                    disabled={!tappable}
                    onPress={() => {
                      if (stop.event_id) router.push(`/event/${stop.event_id}`);
                      else if (stop.partner_id) router.push(`/partner/${stop.partner_id}`);
                    }}
                    style={styles.stopCard}
                  >
                    <View style={styles.stopLeft}>
                      <View style={[styles.stopIcon, { backgroundColor: cat.color }]}>
                        <Ionicons name={iconName} size={14} color={COLORS.white} />
                      </View>
                      {!last && <View style={[styles.connector, { backgroundColor: cat.color }]} />}
                    </View>
                    <View style={styles.stopBody}>
                      <View style={styles.stopHeader}>
                        <Text style={[styles.stopTime, { color: cat.color }]}>{stop.time}</Text>
                        {stop.duration_min ? (
                          <Text style={styles.stopDur}>· {stop.duration_min} min</Text>
                        ) : null}
                        {tappable ? <Ionicons name="chevron-forward" size={14} color={COLORS.textMuted} style={{ marginLeft: 'auto' }} /> : null}
                      </View>
                      <Text style={styles.stopTitle}>{stop.title}</Text>
                      <Text style={styles.stopVenue}>{stop.venue}</Text>
                      {stop.why ? (
                        <Text style={styles.stopWhy}>
                          <Text style={[styles.whyLabel, { color: cat.color }]}>Para ti: </Text>
                          {stop.why}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Footer regenerate */}
            <TouchableOpacity
              testID="regenerate-footer-btn"
              onPress={onRegenerate}
              disabled={regenerating}
              style={[styles.regenFooter, { borderColor: cat.color }]}
            >
              {regenerating
                ? <ActivityIndicator size="small" color={cat.color} />
                : <Ionicons name="sparkles" size={16} color={cat.color} />}
              <Text style={[styles.regenFooterTxt, { color: cat.color }]}>
                {regenerating ? 'Generando nueva ruta…' : 'Generar otra ruta del día'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.footerHint}>
              La IA usa tus favoritos, tus zonas favoritas y los partners disponibles para personalizar la ruta.
            </Text>
          </>
        ) : (
          <View style={{ marginTop: 80, alignItems: 'center' }}>
            <Ionicons name="alert-circle-outline" size={32} color={COLORS.textMuted} />
            <Text style={styles.loadingTxt}>No pudimos generar la ruta. Intenta de nuevo.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  regenBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold },
  subtitle: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular },

  pillsRow: { flexDirection: 'row', paddingHorizontal: SPACING.lg, gap: SPACING.sm, paddingBottom: SPACING.md, alignItems: 'center', height: 50 },
  pill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 14, height: 38, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, flex: 1 },
  pillText: { fontSize: 13, ...FONTS.semibold },

  list: { flex: 1, paddingHorizontal: SPACING.lg },

  hero: { borderRadius: RADIUS.xl, padding: SPACING.lg, borderWidth: 1, backgroundColor: COLORS.surface, marginBottom: SPACING.lg },
  heroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  aiBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full },
  aiBadgeTxt: { fontSize: 9, color: COLORS.white, ...FONTS.bold, letterSpacing: 1 },
  offlineBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)' },
  offlineBadgeTxt: { fontSize: 9, color: COLORS.textMuted, ...FONTS.bold, letterSpacing: 1 },
  heroTitle: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold, marginTop: 4 },
  heroDesc: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, marginTop: 4, lineHeight: 18 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: SPACING.sm },
  tag: { backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full },
  tagTxt: { fontSize: 11, color: COLORS.textMain, ...FONTS.semibold },
  noteBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: SPACING.md, paddingLeft: 10, borderLeftWidth: 2 },
  noteTxt: { flex: 1, fontSize: 12, color: COLORS.textMain, ...FONTS.regular, lineHeight: 17, fontStyle: 'italic' },
  loginCta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SPACING.md, paddingVertical: 6, paddingHorizontal: 10, borderRadius: RADIUS.md, backgroundColor: 'rgba(217,119,6,0.12)', alignSelf: 'flex-start' },
  loginCtaTxt: { fontSize: 11, color: COLORS.primary, ...FONTS.semibold },

  timeline: { marginBottom: SPACING.lg },
  stopCard: { flexDirection: 'row', gap: 12, paddingVertical: 6 },
  stopLeft: { width: 28, alignItems: 'center' },
  stopIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  connector: { width: 2, flex: 1, marginTop: 4, opacity: 0.35 },
  stopBody: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.sm },
  stopHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stopTime: { fontSize: 13, ...FONTS.bold },
  stopDur: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  stopTitle: { fontSize: 15, color: COLORS.textMain, ...FONTS.semibold, marginTop: 3 },
  stopVenue: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginTop: 1 },
  stopWhy: { fontSize: 12, color: COLORS.textMain, ...FONTS.regular, marginTop: 6, lineHeight: 17 },
  whyLabel: { ...FONTS.semibold },

  regenFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: RADIUS.lg, borderWidth: 1, marginTop: 4 },
  regenFooterTxt: { fontSize: 13, ...FONTS.semibold },
  footerHint: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', marginTop: SPACING.sm, lineHeight: 16, paddingHorizontal: SPACING.md },

  loadingTxt: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, marginTop: SPACING.md },
});
