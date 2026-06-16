import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Dimensions, Platform, Share, Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS, ELEVATION } from '../src/constants/theme';
import { AgentId } from '../src/constants/agents';
import { useTr } from '../src/i18n/autoTr';

const { width: SCREEN_W } = Dimensions.get('window');

// ── Types ──
type ItineraryItem = {
  slug: string;
  name: string;
  category: string;
  zone: string;
  lat: number;
  lng: number;
  time: string;
  blurb: string;
};

type ItineraryDay = {
  day: number;
  theme: string;
  items: ItineraryItem[];
};

type Itinerary = {
  title: string;
  summary: string;
  days: ItineraryDay[];
};

type FormState = {
  days: number;
  interests: string[];
  budget: 'económico' | 'medio' | 'premium';
  party: number;
  pace: 'relajado' | 'equilibrado' | 'intenso';
};

// ── Constants ──
const INTEREST_OPTIONS = ['gastronomía', 'playa', 'rumba', 'cultura', 'bienestar', 'compras'];
const INTEREST_ICONS: Record<string, string> = {
  gastronomía: 'restaurant',
  playa: 'sunny',
  rumba: 'musical-notes',
  cultura: 'color-palette',
  bienestar: 'leaf',
  compras: 'bag',
};
const BUDGET_OPTIONS: { key: FormState['budget']; label: string; icon: string }[] = [
  { key: 'económico', label: 'Económico', icon: 'wallet' },
  { key: 'medio', label: 'Medio', icon: 'card' },
  { key: 'premium', label: 'Premium', icon: 'diamond' },
];
const PACE_OPTIONS: { key: FormState['pace']; label: string; icon: string }[] = [
  { key: 'relajado', label: 'Relajado', icon: 'bed' },
  { key: 'equilibrado', label: 'Equilibrado', icon: 'time' },
  { key: 'intenso', label: 'Intenso', icon: 'flash' },
];

const CATEGORY_AGENT_MAP: Record<string, AgentId> = {
  restaurant: 'tino',
  cafe: 'tino',
  gastro: 'tino',
  bar: 'luna',
  club: 'luna',
  nightlife: 'luna',
  beach: 'mare',
  beach_club: 'mare',
  wellness: 'mare',
  spa: 'mare',
  playa: 'mare',
  bienestar: 'mare',
};

function agentForCategory(category: string): AgentId {
  const lower = category.toLowerCase();
  return CATEGORY_AGENT_MAP[lower] || 'ciro';
}

const AGENT_EMOJI: Record<AgentId, string> = { luna: '🌙', mare: '🏖️', tino: '🍽️', ciro: '🗺️' };
const AGENT_NAME: Record<AgentId, string> = { luna: 'Luna', mare: 'Maré', tino: 'Tino', ciro: 'Ciro' };

// ── Shareable URL encoding ──
function encodeItinerary(itinerary: Itinerary, form: FormState): string {
  const compact = {
    t: itinerary.title,
    s: itinerary.summary,
    d: itinerary.days.map(day => ({
      n: day.day,
      th: day.theme,
      i: day.items.map(it => ({ sl: it.slug, tm: it.time })),
    })),
    f: { d: form.days, i: form.interests, b: form.budget, p: form.party, pc: form.pace },
  };
  const json = JSON.stringify(compact);
  // base64url encode
  if (typeof btoa === 'function') {
    return btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  return '';
}

function decodeItinerary(encoded: string): { compact: any } | null {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const json = decodeURIComponent(escape(atob(b64 + pad)));
    return { compact: JSON.parse(json) };
  } catch {
    return null;
  }
}

// ── Leaflet mini-map builder ──
function buildMiniMapHTML(items: ItineraryItem[]): string {
  if (items.length === 0) return '';
  const lats = items.map(i => i.lat);
  const lngs = items.map(i => i.lng);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;

  const markers = items.map((item, idx) => {
    const safeName = item.name.replace(/'/g, '').replace(/"/g, '');
    return `L.marker([${item.lat}, ${item.lng}], {
      icon: L.divIcon({
        className: 'pin-icon',
        html: '<div class="pin">${idx + 1}</div>',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      })
    }).addTo(map).bindPopup('<b style="color:#1a1a2e;font-size:13px">${safeName}</b><br><span style="color:#666;font-size:11px">${item.time}</span>');`;
  }).join('\n');

  // Fit bounds
  const bounds = items.length > 1
    ? `map.fitBounds([[${Math.min(...lats)},${Math.min(...lngs)}],[${Math.max(...lats)},${Math.max(...lngs)}]], {padding: [30, 30]});`
    : `map.setView([${centerLat}, ${centerLng}], 15);`;

  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: ${COLORS.surface}; }
#map { width: 100%; height: 100%; }
.leaflet-control-zoom { display: none; }
.leaflet-control-attribution { display: none; }
.pin {
  width: 28px; height: 28px; border-radius: 50%;
  background: ${COLORS.primary}; color: ${COLORS.black};
  font-weight: 700; font-size: 13px; font-family: sans-serif;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid rgba(255,255,255,0.9);
  box-shadow: 0 2px 8px rgba(0,0,0,0.4);
}
.leaflet-popup-content-wrapper { border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.2); }
.leaflet-popup-tip { display: none; }
</style>
</head><body>
<div id="map"></div>
<script>
var map = L.map('map', {zoomControl: false, attributionControl: false, dragging: true, scrollWheelZoom: false}).setView([${centerLat}, ${centerLng}], 14);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {maxZoom: 19}).addTo(map);
${markers}
${bounds}
<\/script>
</body></html>`;
}

// ── Stepper Component ──
function Stepper({ value, min, max, onChange, label }: {
  value: number; min: number; max: number; onChange: (v: number) => void; label: string;
}) {
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperControls}>
        <TouchableOpacity
          onPress={() => value > min && onChange(value - 1)}
          style={[styles.stepperBtn, value <= min && { opacity: 0.3 }]}
          disabled={value <= min}
        >
          <Ionicons name="remove" size={18} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.stepperValue}>{value}</Text>
        <TouchableOpacity
          onPress={() => value < max && onChange(value + 1)}
          style={[styles.stepperBtn, value >= max && { opacity: 0.3 }]}
          disabled={value >= max}
        >
          <Ionicons name="add" size={18} color={COLORS.textMain} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Main Screen ──
export default function ItinerariesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ plan?: string }>();
  const tr = useTr();

  // Form state
  const [form, setForm] = useState<FormState>({
    days: 2,
    interests: [],
    budget: 'medio',
    party: 2,
    pace: 'equilibrado',
  });

  // Result state
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [activeDay, setActiveDay] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSharedPlan, setIsSharedPlan] = useState(false);

  const scrollRef = useRef<ScrollView>(null);

  // ── Decode shared plan from URL on mount ──
  useEffect(() => {
    if (!params.plan) return;
    const decoded = decodeItinerary(params.plan);
    if (!decoded) return;
    const { compact } = decoded;
    // Re-hydrate itinerary from compact + partner catalog
    hydrateFromCompact(compact);
  }, [params.plan]);

  async function hydrateFromCompact(compact: any) {
    setLoading(true);
    setIsSharedPlan(true);
    try {
      // Fetch partner catalog for slug->details mapping
      let partnerMap: Record<string, any> = {};
      try {
        const res = await fetch('/data/partners.json');
        if (res.ok) {
          const partners = await res.json();
          const arr = Array.isArray(partners) ? partners : (partners?.data || []);
          arr.forEach((p: any) => {
            if (p.slug) partnerMap[p.slug] = p;
            if (p.partner_id) partnerMap[p.partner_id] = p;
          });
        }
      } catch { /* continue with basic data */ }

      const days: ItineraryDay[] = (compact.d || []).map((d: any) => ({
        day: d.n,
        theme: d.th || '',
        items: (d.i || []).map((it: any) => {
          const partner = partnerMap[it.sl];
          return {
            slug: it.sl,
            name: partner?.name || it.sl,
            category: partner?.category || '',
            zone: partner?.zone || '',
            lat: partner?.location?.lat || partner?.lat || 0,
            lng: partner?.location?.lng || partner?.lng || 0,
            time: it.tm,
            blurb: partner?.description || partner?.experience || '',
          };
        }),
      }));

      setItinerary({ title: compact.t || 'Plan compartido', summary: compact.s || '', days });
      if (compact.f) {
        setForm({
          days: compact.f.d || 2,
          interests: compact.f.i || [],
          budget: compact.f.b || 'medio',
          party: compact.f.p || 2,
          pace: compact.f.pc || 'equilibrado',
        });
      }
      setActiveDay(1);
    } catch (e) {
      console.error('[ItinerariesScreen] hydrate error', e);
      setError('No pudimos cargar este plan compartido.');
    } finally {
      setLoading(false);
    }
  }

  // ── Generate itinerary ──
  async function generateItinerary() {
    if (form.interests.length === 0) {
      Alert.alert('Selecciona al menos un interés', 'Elige qué tipo de experiencias te gustan para generar tu plan.');
      return;
    }
    setLoading(true);
    setError(null);
    setItinerary(null);
    try {
      const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      const url = backendUrl ? `${backendUrl}/api/itinerary` : '/api/itinerary';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          days: form.days,
          interests: form.interests,
          budget: form.budget,
          party: form.party,
          pace: form.pace,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.itinerary) {
        setItinerary(data.itinerary);
        setActiveDay(1);
        setIsSharedPlan(false);
      } else {
        setError('La IA no pudo generar tu plan. Inténtalo de nuevo.');
      }
    } catch (e) {
      console.error('[ItinerariesScreen] generate error', e);
      setError('Error de conexión. Verifica tu internet e inténtalo otra vez.');
    } finally {
      setLoading(false);
    }
  }

  // ── Remove item from day ──
  function removeItem(dayNum: number, slug: string) {
    if (!itinerary) return;
    const updated = {
      ...itinerary,
      days: itinerary.days.map(d =>
        d.day === dayNum
          ? { ...d, items: d.items.filter(it => it.slug !== slug) }
          : d
      ),
    };
    setItinerary(updated);
  }

  // ── Regenerate single day ──
  async function regenerateDay(dayNum: number) {
    if (!itinerary) return;
    setLoading(true);
    try {
      const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      const url = backendUrl ? `${backendUrl}/api/itinerary` : '/api/itinerary';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          days: 1,
          interests: form.interests,
          budget: form.budget,
          party: form.party,
          pace: form.pace,
          regenerate_day: dayNum,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.itinerary?.days?.[0]) {
        const newDay = { ...data.itinerary.days[0], day: dayNum };
        setItinerary({
          ...itinerary,
          days: itinerary.days.map(d => d.day === dayNum ? newDay : d),
        });
      }
    } catch (e) {
      console.error('[ItinerariesScreen] regenerate day error', e);
      Alert.alert('Error', 'No pudimos regenerar este día. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  // ── Share ──
  function shareItinerary() {
    if (!itinerary) return;
    const encoded = encodeItinerary(itinerary, form);
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://amocartagena.com';
    const shareUrl = `${baseUrl}/itineraries?plan=${encoded}`;

    Share.share({
      message: `${itinerary.title}\n\n${itinerary.summary}\n\n${shareUrl}`,
      url: shareUrl,
    }).catch(() => {
      // Fallback: copy to clipboard
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(shareUrl);
        Alert.alert('Link copiado', 'El enlace de tu plan fue copiado al portapapeles.');
      }
    });
  }

  // ── Toggle interest ──
  function toggleInterest(interest: string) {
    setForm(prev => ({
      ...prev,
      interests: prev.interests.includes(interest)
        ? prev.interests.filter(i => i !== interest)
        : [...prev.interests, interest],
    }));
  }

  // ── Current day data ──
  const currentDay = itinerary?.days.find(d => d.day === activeDay) || null;
  const miniMapHtml = useMemo(
    () => currentDay ? buildMiniMapHTML(currentDay.items.filter(i => i.lat && i.lng)) : '',
    [currentDay]
  );

  // ══════════════════════ FORM VIEW ══════════════════════
  if (!itinerary && !loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Planifica tu viaje</Text>
            <Text style={styles.headerSub}>IA genera tu itinerario perfecto</Text>
          </View>
          <View style={styles.headerIconWrap}>
            <Ionicons name="sparkles" size={20} color={COLORS.primary} />
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.formScroll}
          showsVerticalScrollIndicator={false}
        >
          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={COLORS.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Days stepper */}
          <Stepper
            label="Días"
            value={form.days}
            min={1}
            max={7}
            onChange={v => setForm(prev => ({ ...prev, days: v }))}
          />

          {/* Interests */}
          <Text style={styles.sectionLabel}>Intereses</Text>
          <View style={styles.chipGrid}>
            {INTEREST_OPTIONS.map(interest => {
              const active = form.interests.includes(interest);
              return (
                <TouchableOpacity
                  key={interest}
                  style={[styles.formChip, active && styles.formChipActive]}
                  onPress={() => toggleInterest(interest)}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={(INTEREST_ICONS[interest] || 'ellipse') as any}
                    size={14}
                    color={active ? COLORS.primary : COLORS.textMuted}
                  />
                  <Text style={[styles.formChipText, active && styles.formChipTextActive]}>
                    {interest.charAt(0).toUpperCase() + interest.slice(1)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Budget */}
          <Text style={styles.sectionLabel}>Presupuesto</Text>
          <View style={styles.chipRow}>
            {BUDGET_OPTIONS.map(opt => {
              const active = form.budget === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.formChip, styles.formChipFlex, active && styles.formChipActive]}
                  onPress={() => setForm(prev => ({ ...prev, budget: opt.key }))}
                  activeOpacity={0.8}
                >
                  <Ionicons name={opt.icon as any} size={14} color={active ? COLORS.primary : COLORS.textMuted} />
                  <Text style={[styles.formChipText, active && styles.formChipTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Party stepper */}
          <Stepper
            label="Personas"
            value={form.party}
            min={1}
            max={10}
            onChange={v => setForm(prev => ({ ...prev, party: v }))}
          />

          {/* Pace */}
          <Text style={styles.sectionLabel}>Ritmo</Text>
          <View style={styles.chipRow}>
            {PACE_OPTIONS.map(opt => {
              const active = form.pace === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.formChip, styles.formChipFlex, active && styles.formChipActive]}
                  onPress={() => setForm(prev => ({ ...prev, pace: opt.key }))}
                  activeOpacity={0.8}
                >
                  <Ionicons name={opt.icon as any} size={14} color={active ? COLORS.primary : COLORS.textMuted} />
                  <Text style={[styles.formChipText, active && styles.formChipTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Generate button */}
          <TouchableOpacity
            style={[styles.generateBtn, form.interests.length === 0 && { opacity: 0.5 }]}
            onPress={generateItinerary}
            activeOpacity={0.85}
          >
            <Ionicons name="sparkles" size={18} color={COLORS.black} />
            <Text style={styles.generateBtnText}>Generar mi plan</Text>
          </TouchableOpacity>

          <Text style={styles.formHint}>
            La IA analiza los mejores lugares verificados de Cartagena para crear una ruta personalizada.
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ══════════════════════ LOADING VIEW ══════════════════════
  if (loading && !itinerary) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingCenter}>
          <View style={styles.loadingIconWrap}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
          <Text style={styles.loadingTitle}>Creando tu itinerario...</Text>
          <Text style={styles.loadingSubtitle}>La IA está seleccionando los mejores lugares para ti</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ══════════════════════ RESULT VIEW ══════════════════════
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            setItinerary(null);
            setIsSharedPlan(false);
            setError(null);
          }}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{itinerary?.title || 'Tu plan'}</Text>
          <Text style={styles.headerSub}>
            {itinerary?.days.length || 0} {(itinerary?.days.length || 0) === 1 ? 'día' : 'días'} planificados
          </Text>
        </View>
        <TouchableOpacity onPress={shareItinerary} style={styles.shareBtn}>
          <Ionicons name="share-outline" size={18} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Shared plan badge */}
        {isSharedPlan && (
          <View style={styles.sharedBadge}>
            <View style={styles.sharedBadgeInner}>
              <Text style={styles.sharedBadgeText}>hecho con AMO Cartagena</Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                setItinerary(null);
                setIsSharedPlan(false);
              }}
              style={styles.sharedCta}
            >
              <Ionicons name="sparkles" size={14} color={COLORS.primary} />
              <Text style={styles.sharedCtaText}>Crea tu propio plan</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Summary */}
        {itinerary?.summary ? (
          <View style={styles.summaryCard}>
            <View style={styles.summaryBadgeRow}>
              <View style={styles.aiBadge}>
                <Ionicons name="sparkles" size={11} color={COLORS.white} />
                <Text style={styles.aiBadgeText}>IA ITINERARIO</Text>
              </View>
            </View>
            <Text style={styles.summaryText}>{itinerary.summary}</Text>
          </View>
        ) : null}

        {/* Day tabs */}
        {itinerary && itinerary.days.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dayTabsScroll}
            style={styles.dayTabs}
          >
            {itinerary.days.map(d => {
              const active = d.day === activeDay;
              return (
                <TouchableOpacity
                  key={d.day}
                  style={[styles.dayTab, active && styles.dayTabActive]}
                  onPress={() => setActiveDay(d.day)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.dayTabNum, active && styles.dayTabNumActive]}>
                    Día {d.day}
                  </Text>
                  {d.theme ? (
                    <Text style={[styles.dayTabTheme, active && styles.dayTabThemeActive]} numberOfLines={1}>
                      {d.theme}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {/* Timeline */}
        {currentDay && (
          <View style={styles.timeline}>
            {currentDay.items.map((item, idx) => {
              const isLast = idx === currentDay.items.length - 1;
              const agent = agentForCategory(item.category);
              return (
                <View key={`${item.slug}-${idx}`} style={styles.timelineRow}>
                  {/* Left connector */}
                  <View style={styles.timelineLeft}>
                    <View style={styles.timelineDot}>
                      <Text style={styles.timelineDotText}>{idx + 1}</Text>
                    </View>
                    {!isLast && <View style={styles.timelineConnector} />}
                  </View>

                  {/* Card */}
                  <View style={styles.itemCard}>
                    {/* Remove X */}
                    <TouchableOpacity
                      style={styles.removeBtn}
                      onPress={() => removeItem(currentDay.day, item.slug)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="close" size={14} color={COLORS.textFaint} />
                    </TouchableOpacity>

                    {/* Time badge */}
                    <View style={styles.timeBadge}>
                      <Ionicons name="time-outline" size={12} color={COLORS.primary} />
                      <Text style={styles.timeBadgeText}>{item.time}</Text>
                    </View>

                    {/* Name + category + zone */}
                    <TouchableOpacity
                      onPress={() => router.push(`/partner/${item.slug}`)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.itemName}>{item.name}</Text>
                    </TouchableOpacity>
                    <View style={styles.metaRow}>
                      {item.category ? (
                        <View style={styles.catBadge}>
                          <Text style={styles.catBadgeText}>{item.category}</Text>
                        </View>
                      ) : null}
                      {item.zone ? (
                        <Text style={styles.zoneText}>{item.zone}</Text>
                      ) : null}
                    </View>

                    {/* Blurb */}
                    {item.blurb ? (
                      <Text style={styles.blurbText}>{item.blurb}</Text>
                    ) : null}

                    {/* Concierge handoff */}
                    <TouchableOpacity
                      style={styles.askAgentBtn}
                      onPress={() => router.push({ pathname: '/concierge', params: { agent } })}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.askAgentEmoji}>{AGENT_EMOJI[agent]}</Text>
                      <Text style={styles.askAgentText}>
                        Pregúntale a {AGENT_NAME[agent]}
                      </Text>
                      <Ionicons name="chevron-forward" size={12} color={COLORS.textMuted} />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Regenerate day */}
        {currentDay && (
          <TouchableOpacity
            style={styles.regenDayBtn}
            onPress={() => regenerateDay(activeDay)}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <Ionicons name="refresh" size={16} color={COLORS.primary} />
            )}
            <Text style={styles.regenDayText}>
              {loading ? 'Regenerando...' : `Regenerar día ${activeDay}`}
            </Text>
          </TouchableOpacity>
        )}

        {/* Mini map */}
        {currentDay && miniMapHtml ? (
          <View style={styles.miniMapContainer}>
            <Text style={styles.miniMapLabel}>
              <Ionicons name="map-outline" size={13} color={COLORS.textMuted} /> Mapa del día
            </Text>
            <View style={styles.miniMapWrap}>
              {Platform.OS === 'web' ? (
                <iframe
                  key={`map-day-${activeDay}`}
                  srcDoc={miniMapHtml}
                  style={{ width: '100%', height: '100%', border: 'none', borderRadius: 12 } as any}
                />
              ) : (
                <View style={{ flex: 1, borderRadius: RADIUS.lg, overflow: 'hidden' }}>
                  {/* WebView import only on native */}
                  <Text style={{ color: COLORS.textMuted, textAlign: 'center', paddingTop: 60 }}>
                    Mapa disponible en web
                  </Text>
                </View>
              )}
            </View>
          </View>
        ) : null}

        {/* Share button at bottom */}
        <TouchableOpacity
          style={styles.shareBottomBtn}
          onPress={shareItinerary}
          activeOpacity={0.85}
        >
          <Ionicons name="share-social" size={18} color={COLORS.black} />
          <Text style={styles.shareBottomText}>Compartir plan</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ══════════════════════ STYLES ══════════════════════
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.surface,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border,
  },
  headerTitle: { fontSize: 20, color: COLORS.textMain, ...FONTS.bold },
  headerSub: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginTop: 1 },
  headerIconWrap: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.primary + '18',
    alignItems: 'center', justifyContent: 'center',
  },
  shareBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.surface,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border,
  },

  // ── Form ──
  formScroll: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  sectionLabel: {
    fontSize: 13, color: COLORS.textMuted, ...FONTS.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginTop: SPACING.lg, marginBottom: SPACING.sm,
  },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  chipRow: { flexDirection: 'row', gap: SPACING.sm },
  formChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: RADIUS.full, borderWidth: 1,
    borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  formChipFlex: { flex: 1, justifyContent: 'center' },
  formChipActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '15',
  },
  formChipText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.medium },
  formChipTextActive: { color: COLORS.primary },

  // ── Stepper ──
  stepperRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: SPACING.lg,
  },
  stepperLabel: { fontSize: 15, color: COLORS.textMain, ...FONTS.semibold },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  stepperBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  stepperValue: { fontSize: 20, color: COLORS.primary, ...FONTS.bold, minWidth: 28, textAlign: 'center' },

  // ── Generate ──
  generateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.primary, borderRadius: RADIUS.lg,
    paddingVertical: 16, marginTop: SPACING.xl,
    ...ELEVATION.goldGlow,
  },
  generateBtnText: { fontSize: 16, color: COLORS.black, ...FONTS.bold },
  formHint: {
    fontSize: 11, color: COLORS.textFaint, ...FONTS.regular,
    textAlign: 'center', marginTop: SPACING.md, lineHeight: 16,
  },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.error + '15', borderRadius: RADIUS.md,
    padding: SPACING.md, marginBottom: SPACING.md,
    borderWidth: 1, borderColor: COLORS.error + '30',
  },
  errorText: { flex: 1, fontSize: 13, color: COLORS.error, ...FONTS.medium },

  // ── Loading ──
  loadingCenter: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl,
  },
  loadingIconWrap: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: COLORS.primary + '15',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: SPACING.lg,
  },
  loadingTitle: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold, marginTop: SPACING.sm },
  loadingSubtitle: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', marginTop: SPACING.xs },

  // ── Shared plan badge ──
  sharedBadge: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  sharedBadgeInner: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  sharedBadgeText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 0.5, textTransform: 'uppercase' },
  sharedCta: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: RADIUS.full, backgroundColor: COLORS.primary + '15',
  },
  sharedCtaText: { fontSize: 12, color: COLORS.primary, ...FONTS.bold },

  // ── Summary ──
  summaryCard: {
    margin: SPACING.lg, marginBottom: SPACING.sm,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.xl,
    padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.border,
  },
  summaryBadgeRow: { flexDirection: 'row', marginBottom: SPACING.sm },
  aiBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full,
    backgroundColor: COLORS.primary,
  },
  aiBadgeText: { fontSize: 9, color: COLORS.black, ...FONTS.bold, letterSpacing: 1 },
  summaryText: { fontSize: 14, color: COLORS.textMain, ...FONTS.regular, lineHeight: 21 },

  // ── Day tabs ──
  dayTabs: { maxHeight: 56 },
  dayTabsScroll: { paddingHorizontal: SPACING.lg, gap: SPACING.sm, paddingVertical: SPACING.xs },
  dayTab: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: RADIUS.full, borderWidth: 1,
    borderColor: COLORS.border, backgroundColor: COLORS.surface,
    alignItems: 'center',
  },
  dayTabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  dayTabNum: { fontSize: 13, color: COLORS.textMuted, ...FONTS.bold },
  dayTabNumActive: { color: COLORS.black },
  dayTabTheme: { fontSize: 10, color: COLORS.textFaint, ...FONTS.medium, marginTop: 1, maxWidth: 100 },
  dayTabThemeActive: { color: COLORS.black + 'AA' },

  // ── Timeline ──
  timeline: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md },
  timelineRow: { flexDirection: 'row', gap: 12, marginBottom: 4 },
  timelineLeft: { width: 32, alignItems: 'center' },
  timelineDot: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
  },
  timelineDotText: { fontSize: 12, color: COLORS.black, ...FONTS.bold },
  timelineConnector: { width: 2, flex: 1, marginTop: 4, backgroundColor: COLORS.primary, opacity: 0.25 },

  // ── Item card ──
  itemCard: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
    marginBottom: SPACING.sm,
  },
  removeBtn: {
    position: 'absolute', top: 8, right: 8, zIndex: 1,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: COLORS.surfaceAlt, alignItems: 'center', justifyContent: 'center',
  },
  timeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: RADIUS.full, backgroundColor: COLORS.primary + '15',
    marginBottom: SPACING.xs,
  },
  timeBadgeText: { fontSize: 12, color: COLORS.primary, ...FONTS.bold },
  itemName: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold, paddingRight: 24 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: 4 },
  catBadge: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.full,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  catBadgeText: { fontSize: 10, color: COLORS.textMuted, ...FONTS.semibold, textTransform: 'uppercase', letterSpacing: 0.5 },
  zoneText: { fontSize: 11, color: COLORS.textFaint, ...FONTS.medium },
  blurbText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 19, marginTop: SPACING.sm },

  // ── Ask agent ──
  askAgentBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: SPACING.sm, paddingTop: SPACING.sm,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  askAgentEmoji: { fontSize: 14 },
  askAgentText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium, flex: 1 },

  // ── Regen day ──
  regenDayBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
    marginHorizontal: SPACING.lg, marginTop: SPACING.sm,
    paddingVertical: 12, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.primary + '40',
    backgroundColor: COLORS.primary + '0A',
  },
  regenDayText: { fontSize: 13, color: COLORS.primary, ...FONTS.semibold },

  // ── Mini map ──
  miniMapContainer: { marginHorizontal: SPACING.lg, marginTop: SPACING.lg },
  miniMapLabel: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold, marginBottom: SPACING.sm },
  miniMapWrap: {
    width: '100%', height: 220, borderRadius: RADIUS.lg,
    overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },

  // ── Share bottom ──
  shareBottomBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
    marginHorizontal: SPACING.lg, marginTop: SPACING.xl,
    paddingVertical: 14, borderRadius: RADIUS.lg,
    backgroundColor: COLORS.primary,
    ...ELEVATION.goldGlow,
  },
  shareBottomText: { fontSize: 15, color: COLORS.black, ...FONTS.bold },
});
