// ============================================================================
// AMO CARTAGENA — ITINERARY BUILDER  (Build 3 / Blocks 2 + 3 / AUD-024 / AUD-011)
// Pure RN Views for route map — zero extra packages.
// ============================================================================

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet, Platform, Share,
} from 'react-native';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';

const PROD_HOST = process.env.EXPO_PUBLIC_APP_URL || 'https://amocartagena.co';
const apiBase = Platform.OS === 'web' ? '' : PROD_HOST;
const shareBase =
  Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : PROD_HOST;

const T = {
  bg: '#0c0910', surface: '#1c1526', surface2: '#251b31', line: '#322543',
  gold: '#f3b14e', coral: '#ff5e7a', teal: '#2fd6c3', text: '#f6efea', muted: '#a38fb0',
};

const INTERESTS = ['Gastronomía', 'Playa', 'Rumba', 'Cultura', 'Bienestar', 'Compras'];
const ZONES = ['Centro Histórico', 'Getsemaní', 'Bocagrande', 'Manga', 'Islas'];
const BUDGET = ['Económico', 'Medio', 'Premium'];
const PACE = ['Relajado', 'Equilibrado', 'Intenso'];

type Item = { slug: string; name: string; category: string; zone: string; lat?: number; lng?: number; time?: string; blurb?: string };
type Day = { day: number; theme: string; items: Item[] };
type Itinerary = { title: string; summary: string; days: Day[] };

// ----------------------------------------------------------------------------
// Small UI atoms
// ----------------------------------------------------------------------------
function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, active && s.chipOn]}>
      <Text style={[s.chipTxt, active && s.chipTxtOn]}>{label}</Text>
    </Pressable>
  );
}
function Segmented({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={s.segment}>
      {options.map((o) => (
        <Pressable key={o} onPress={() => onChange(o)} style={[s.segBtn, value === o && s.segBtnOn]}>
          <Text style={[s.segTxt, value === o && s.segTxtOn]}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}
function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <View style={s.stepRow}>
      <Text style={s.stepLabel}>{label}</Text>
      <View style={s.stepCtrl}>
        <Pressable onPress={() => onChange(Math.max(min, value - 1))} style={s.stepBtn}><Text style={s.stepBtnTxt}>−</Text></Pressable>
        <Text style={s.stepVal}>{value}</Text>
        <Pressable onPress={() => onChange(Math.min(max, value + 1))} style={s.stepBtn}><Text style={s.stepBtnTxt}>+</Text></Pressable>
      </View>
    </View>
  );
}

// ----------------------------------------------------------------------------
// Day route map — pure React Native Views (no SVG, no external deps).
// ----------------------------------------------------------------------------
function DayMap({ items }: { items: Item[] }) {
  const pts = items.filter((i) => typeof i.lat === 'number' && typeof i.lng === 'number');
  const [w, setW] = useState(0);
  if (pts.length < 1) return null;

  const H = 150, P = 26, R = 13;
  const lats = pts.map((p) => p.lat as number);
  const lngs = pts.map((p) => p.lng as number);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const spanLat = Math.max(maxLat - minLat, 0.004);
  const spanLng = Math.max(maxLng - minLng, 0.004);

  const coords = pts.map((p) => {
    const nx = pts.length === 1 ? 0.5 : ((p.lng as number) - minLng) / spanLng;
    const ny = pts.length === 1 ? 0.5 : (maxLat - (p.lat as number)) / spanLat;
    return { x: P + nx * (Math.max(w, 0) - 2 * P), y: P + ny * (H - 2 * P) };
  });

  return (
    <View style={s.mapWrap}>
      <View style={s.mapBoard} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {[0.33, 0.66].map((f) => <View key={'h' + f} style={[s.gridH, { top: H * f }]} />)}
        {[0.33, 0.66].map((f) => <View key={'v' + f} style={[s.gridV, { left: `${f * 100}%` }]} />)}
        {w > 0 && coords.slice(1).map((b, i) => {
          const a = coords[i];
          const dx = b.x - a.x, dy = b.y - a.y;
          const len = Math.hypot(dx, dy);
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
          return (
            <View key={'c' + i} style={{ position: 'absolute', left: (a.x + b.x) / 2 - len / 2, top: (a.y + b.y) / 2 - 1, width: len, height: 2, backgroundColor: T.gold, opacity: 0.5, borderRadius: 1, transform: [{ rotate: `${angle}deg` }] }} />
          );
        })}
        {w > 0 && coords.map((c, i) => (
          <View key={'p' + i} style={[s.pin, { left: c.x - R, top: c.y - R }]}>
            <Text style={s.pinTxt}>{i + 1}</Text>
          </View>
        ))}
      </View>
      <Text style={s.mapCap}>Recorrido del día · {pts.length} parada{pts.length > 1 ? 's' : ''}</Text>
    </View>
  );
}

// ----------------------------------------------------------------------------
// Venue card
// ----------------------------------------------------------------------------
function ItemCard({ item, index, onOpen, onRemove }: { item: Item; index: number; onOpen: () => void; onRemove: () => void }) {
  return (
    <View style={s.card}>
      <View style={s.cardNum}><Text style={s.cardNumTxt}>{index + 1}</Text></View>
      <Pressable style={s.cardBody} onPress={onOpen}>
        {!!item.time && <Text style={s.cardTime}>{item.time}</Text>}
        <Text style={s.cardName}>{item.name}</Text>
        <Text style={s.cardMeta}>{[item.category, item.zone].filter(Boolean).join(' · ')}</Text>
        {!!item.blurb && <Text style={s.cardBlurb}>{item.blurb}</Text>}
      </Pressable>
      <Pressable onPress={onRemove} hitSlop={10} style={s.cardX}><Text style={s.cardXTxt}>×</Text></Pressable>
    </View>
  );
}

// ----------------------------------------------------------------------------
// Screen
// ----------------------------------------------------------------------------
export default function ItineraryScreen() {
  const router = useRouter();
  const { plan } = useLocalSearchParams<{ plan?: string }>();

  const [mode, setMode] = useState<'form' | 'loading' | 'result' | 'error'>('form');
  const [itin, setItin] = useState<Itinerary | null>(null);
  const [toast, setToast] = useState('');

  const [days, setDays] = useState(2);
  const [party, setParty] = useState(2);
  const [interests, setInterests] = useState<string[]>(['Gastronomía', 'Playa']);
  const [zones, setZones] = useState<string[]>([]);
  const [budget, setBudget] = useState('Medio');
  const [pace, setPace] = useState('Equilibrado');

  const toggle = (arr: string[], v: string, set: (a: string[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2200); };

  // ---- Block 3: rehydrate a shared plan (no backend) ----
  const hydrateShared = useCallback(async (param: string) => {
    setMode('loading');
    try {
      const payload = JSON.parse(decodeURIComponent(param));
      if (!payload || typeof payload !== 'object') { setMode('error'); return; }
      const res = await fetch(`${apiBase}/data/partners.json`);
      const raw = await res.json();
      const list: any[] = Array.isArray(raw) ? raw : raw.partners ?? [];
      const bySlug = new Map<string, Item>(
        list.map((p: any) => {
          const loc = p.location || {};
          const slug = String(p.partner_id ?? p.slug ?? p.id ?? '');
          return [slug, {
            slug, name: String(p.name ?? p.title ?? ''),
            category: String(p.category ?? p.type ?? ''),
            zone: String(p.address ?? p.zone ?? '').split(',')[0],
            lat: typeof loc.lat === 'number' ? loc.lat : undefined,
            lng: typeof loc.lng === 'number' ? loc.lng : undefined,
          }];
        }),
      );
      const dayArr: Day[] = (payload.d ?? []).slice(0, 7).map((d: any, i: number) => ({
        day: i + 1, theme: String(d.t ?? ''),
        items: (d.i ?? [])
          .map((it: any) => { const c = bySlug.get(String(it.s)); return c ? { ...c, time: String(it.tm ?? ''), blurb: String(it.b ?? '') } : null; })
          .filter(Boolean),
      })).filter((d: Day) => d.items.length);
      if (!dayArr.length) { setMode('error'); return; }
      setItin({ title: String(payload.ti ?? 'Plan en Cartagena'), summary: String(payload.su ?? ''), days: dayArr });
      setMode('result');
    } catch (e) { console.error('[Itineraries] hydrateShared failed', e); setMode('error'); }
  }, []);

  useEffect(() => { if (plan) hydrateShared(String(plan)); }, [plan, hydrateShared]);

  // ---- Block 2: generate via the grounded engine ----
  const generate = async () => {
    setMode('loading');
    try {
      const r = await fetch(`${apiBase}/api/itinerary`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          days, interests, budget: budget.toLowerCase(), party: `${party} personas`,
          pace: pace.toLowerCase(), zones, language: 'es',
        }),
      });
      if (!r.ok) { setMode('error'); return; }
      const data = await r.json();
      if (!data?.itinerary?.days?.length) { setMode('error'); return; }
      setItin(data.itinerary); setMode('result');
    } catch (e) { console.error('[Itineraries] generate failed', e); setMode('error'); }
  };

  const removeItem = (di: number, ii: number) => {
    if (!itin) return;
    const days2 = itin.days.map((d, x) => x === di ? { ...d, items: d.items.filter((_, y) => y !== ii) } : d).filter((d) => d.items.length);
    setItin({ ...itin, days: days2 });
  };

  const buildShareUrl = () => {
    if (!itin) return shareBase;
    const payload = { ti: itin.title, su: itin.summary, d: itin.days.map((d) => ({ t: d.theme, i: d.items.map((it) => ({ s: it.slug, tm: it.time, b: it.blurb })) })) };
    return `${shareBase}/itineraries?plan=${encodeURIComponent(JSON.stringify(payload))}`;
  };
  const sharePlan = async () => {
    const url = buildShareUrl();
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      try { await navigator.clipboard.writeText(url); flash('Enlace copiado'); return; } catch { /* clipboard API unavailable — fall through to Share */ }
    }
    try { await Share.share({ message: `Mi plan en Cartagena 🌅 ${url}`, url }); } catch { /* user cancelled share dialog */ }
  };

  // -------------------------------------------------------------------------
  return (
    <View style={s.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={s.header}>
        <Pressable style={s.back} onPress={() => (mode === 'result' && !plan ? setMode('form') : router.back())}>
          <Text style={s.backTxt}>‹</Text>
        </Pressable>
        <View>
          <Text style={s.hTitle}>Planificador IA</Text>
          <Text style={s.hSub}>Tu Cartagena, día por día</Text>
        </View>
      </View>

      {mode === 'loading' && (
        <View style={s.center}><ActivityIndicator color={T.gold} size="large" /><Text style={s.loadTxt}>Diseñando tu Cartagena…</Text></View>
      )}

      {mode === 'error' && (
        <View style={s.center}>
          <Text style={s.errTxt}>No pude armar el plan ahora.</Text>
          <Pressable style={s.btnGold} onPress={() => setMode('form')}><Text style={s.btnGoldTxt}>Volver a intentar</Text></Pressable>
        </View>
      )}

      {mode === 'form' && (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <Text style={s.lead}>Cuéntame tu viaje y armo un plan con lugares reales de Cartagena.</Text>

          <Stepper label="Días" value={days} min={1} max={7} onChange={setDays} />
          <Stepper label="Personas" value={party} min={1} max={10} onChange={setParty} />

          <Text style={s.sec}>Intereses</Text>
          <View style={s.wrap}>{INTERESTS.map((i) => <Chip key={i} label={i} active={interests.includes(i)} onPress={() => toggle(interests, i, setInterests)} />)}</View>

          <Text style={s.sec}>Presupuesto</Text>
          <Segmented options={BUDGET} value={budget} onChange={setBudget} />

          <Text style={s.sec}>Ritmo</Text>
          <Segmented options={PACE} value={pace} onChange={setPace} />

          <Text style={s.sec}>Zonas (opcional)</Text>
          <View style={s.wrap}>{ZONES.map((z) => <Chip key={z} label={z} active={zones.includes(z)} onPress={() => toggle(zones, z, setZones)} />)}</View>

          <Pressable style={[s.btnGold, { marginTop: 22 }]} onPress={generate}><Text style={s.btnGoldTxt}>Generar mi plan ✨</Text></Pressable>
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {mode === 'result' && itin && (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <Text style={s.resTitle}>{itin.title}</Text>
          {!!itin.summary && <Text style={s.resSummary}>{itin.summary}</Text>}

          <View style={s.actions}>
            <Pressable style={s.btnGoldSm} onPress={sharePlan}><Text style={s.btnGoldTxt}>Compartir plan</Text></Pressable>
            {!plan && <Pressable style={s.btnGhost} onPress={() => setMode('form')}><Text style={s.btnGhostTxt}>Editar</Text></Pressable>}
            {!plan && <Pressable style={s.btnGhost} onPress={generate}><Text style={s.btnGhostTxt}>Otro plan</Text></Pressable>}
          </View>

          {itin.days.map((d, di) => (
            <View key={di} style={s.day}>
              <View style={s.dayHead}>
                <View style={s.dayBadge}><Text style={s.dayBadgeTxt}>Día {d.day}</Text></View>
                {!!d.theme && <Text style={s.dayTheme}>{d.theme}</Text>}
              </View>
              <DayMap items={d.items} />
              {d.items.map((it, ii) => (
                <ItemCard key={it.slug + ii} item={it} index={ii}
                  onOpen={() => router.push(`/partner/${it.slug}` as any)}
                  onRemove={() => removeItem(di, ii)} />
              ))}
            </View>
          ))}

          {!!plan && (
            <Pressable style={[s.btnGold, { marginTop: 18 }]} onPress={() => { setItin(null); setMode('form'); router.setParams({ plan: undefined as any }); }}>
              <Text style={s.btnGoldTxt}>Armar mi propio plan</Text>
            </Pressable>
          )}
          <Text style={s.madeWith}>hecho con AMO Cartagena</Text>
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {!!toast && <View style={s.toast}><Text style={s.toastTxt}>{toast}</Text></View>}
    </View>
  );
}

// ----------------------------------------------------------------------------
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: Platform.OS === 'web' ? 18 : 56, paddingBottom: 14 },
  back: { width: 38, height: 38, borderRadius: 12, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, alignItems: 'center', justifyContent: 'center' },
  backTxt: { color: T.text, fontSize: 26, lineHeight: 28, marginTop: -2 },
  hTitle: { color: T.text, fontSize: 18, fontWeight: '800' },
  hSub: { color: T.muted, fontSize: 12, marginTop: 1 },
  scroll: { paddingHorizontal: 18, paddingBottom: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  loadTxt: { color: T.muted, fontSize: 14 },
  errTxt: { color: T.text, fontSize: 15, fontWeight: '600' },
  lead: { color: T.muted, fontSize: 14, lineHeight: 21, marginBottom: 18 },
  sec: { color: T.muted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 20, marginBottom: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: T.line, backgroundColor: T.surface, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 14 },
  chipOn: { borderColor: T.gold, backgroundColor: T.surface2 },
  chipTxt: { color: T.muted, fontSize: 13, fontWeight: '600' },
  chipTxtOn: { color: T.text },
  segment: { flexDirection: 'row', gap: 4, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 13, padding: 4 },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  segBtnOn: { backgroundColor: T.text },
  segTxt: { color: T.muted, fontSize: 13, fontWeight: '600' },
  segTxtOn: { color: T.bg },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16 },
  stepLabel: { color: T.text, fontSize: 14, fontWeight: '600' },
  stepCtrl: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  stepBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: T.surface2, borderWidth: 1, borderColor: T.line, alignItems: 'center', justifyContent: 'center' },
  stepBtnTxt: { color: T.gold, fontSize: 20, fontWeight: '700', marginTop: -2 },
  stepVal: { color: T.text, fontSize: 17, fontWeight: '700', minWidth: 22, textAlign: 'center' },
  btnGold: { backgroundColor: T.gold, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  btnGoldSm: { backgroundColor: T.gold, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 18, alignItems: 'center' },
  btnGoldTxt: { color: '#2a1c06', fontSize: 14.5, fontWeight: '800' },
  btnGhost: { backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 18 },
  btnGhostTxt: { color: T.text, fontSize: 14, fontWeight: '600' },
  resTitle: { color: T.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.5, marginTop: 4 },
  resSummary: { color: T.muted, fontSize: 14, lineHeight: 21, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 16, marginBottom: 6 },
  day: { marginTop: 22 },
  dayHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  dayBadge: { backgroundColor: T.gold, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 10 },
  dayBadgeTxt: { color: '#2a1c06', fontSize: 12, fontWeight: '800' },
  dayTheme: { color: T.text, fontSize: 15, fontWeight: '700', flex: 1 },
  mapWrap: { marginBottom: 14 },
  mapBoard: { height: 150, borderRadius: 14, backgroundColor: '#120d18', borderWidth: 1, borderColor: T.line, overflow: 'hidden', position: 'relative' },
  gridH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#1f1830' },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#1f1830' },
  pin: { position: 'absolute', width: 26, height: 26, borderRadius: 13, backgroundColor: T.gold, alignItems: 'center', justifyContent: 'center' },
  pinTxt: { color: '#2a1c06', fontSize: 12, fontWeight: '800' },
  mapCap: { color: T.muted, fontSize: 11, marginTop: 6, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, borderRadius: 16, padding: 14, marginBottom: 10 },
  cardNum: { width: 26, height: 26, borderRadius: 8, backgroundColor: T.surface2, borderWidth: 1, borderColor: T.line, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  cardNumTxt: { color: T.gold, fontSize: 13, fontWeight: '800' },
  cardBody: { flex: 1 },
  cardTime: { color: T.gold, fontSize: 12, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 2 },
  cardName: { color: T.text, fontSize: 15.5, fontWeight: '700' },
  cardMeta: { color: T.muted, fontSize: 12, marginTop: 2 },
  cardBlurb: { color: T.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  cardX: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  cardXTxt: { color: T.muted, fontSize: 20, marginTop: -2 },
  madeWith: { color: T.muted, fontSize: 11, textAlign: 'center', marginTop: 22, letterSpacing: 0.4 },
  toast: { position: 'absolute', bottom: 34, alignSelf: 'center', backgroundColor: '#1a1322', borderWidth: 1, borderColor: T.gold, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 22 },
  toastTxt: { color: T.text, fontSize: 13.5, fontWeight: '600' },
});
