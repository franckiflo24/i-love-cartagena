// Drop FR — THE FIRST-RUN ARRIVAL (cold/direct signup made alive).
//
// Not a form, a moment: a gold-on-midnight welcome beat with staggered reveals,
// Luna greeting the user in character with a REAL time-aware line (Drop 9
// /api/now — real hour + real sunset), the passport framed as invitation
// (Drop 8/11), and the single nearest REAL stamp to chase (desire engine —
// geoService + /api/nearby, real distance; geo-denied → a real central first
// stamp, no phantom distance). Then ONE question (user_type, already wired into
// Luna's personalization, Drop 4) → straight into the app. ~2 taps, skippable.
//
// Honesty spine: empty passport = potential, never a fake trophy; the first
// stamp is real; Luna's line is grounded; skipping still lands in the app.
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Easing, Platform, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { useAuth } from '../src/context/AuthContext';
import { api, API_BASE } from '../src/constants/api';
import { useTr } from '../src/i18n/autoTr';
import { geoService, haversineM } from '../src/lib/geo';
import { safeNext } from '../src/lib/safeNext';

const GOLD = '#D4AF37';
const GOLD_BRIGHT = '#F5D47A';
const INK = '#07070E';
const SERIF = Platform.select({ web: "Georgia, 'Times New Roman', serif", default: 'serif' });

// The real "easy first stamp" when geo is unavailable — the Murallas landmark
// visit-stamp (passport_collections.json attr_002: earnable ANY hour, at any of
// several anchors along the wall). A real def, honest hint, no fake distance.
const FALLBACK_STAMP = { name: 'Las Murallas de Cartagena', hint: 'un sello que se gana a cualquier hora, en cualquier punto de la muralla' };

type Beat = 'arrival' | 'question';

export default function OnboardingArrival() {
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { user } = useAuth();
  const tr = useTr();
  const firstName = (user?.name || '').trim().split(' ')[0];
  // Drop GATE (B3): after the arrival activates a gated signup, return to the
  // exact action they were headed for. Same canonical guard as login (safeNext).
  const dest = safeNext(next);

  const [beat, setBeat] = useState<Beat>('arrival');
  const [nowLine, setNowLine] = useState<{ es: string; sunset?: string; key?: string } | null>(null);
  const [firstStamp, setFirstStamp] = useState<{ name: string; distance?: number; hint?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Staggered reveal choreography — five beats fading up in sequence.
  const anims = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0))).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 3600, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(glow, { toValue: 0, duration: 3600, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ]),
    ).start();
    Animated.stagger(240, anims.map((a) =>
      Animated.timing(a, { toValue: 1, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    )).start();
  }, []);

  // Grounded time-aware greeting (Drop 9) — public endpoint, real time + sunset.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/now`);
        if (r.ok) {
          const d = await r.json();
          if (d?.occasion?.es) setNowLine({ es: d.occasion.es, sunset: d.occasion.sunset, key: d.occasion.key });
        }
      } catch { /* fail-soft — the beat still works without the line */ }
    })();
  }, []);

  // First-stamp hook (Drop 8 desire engine): the nearest REAL venue + real
  // distance if geo is granted; a real central stamp otherwise (no phantom).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Use an EXISTING position only — never trigger a geolocation prompt at
        // page load. geo.ts requires request() from a user gesture; a reflexive
        // dismissal here would sticky-deny and silence the whole walking layer
        // for that device forever. No position yet → the honest fallback stamp.
        const pos = geoService.getState().position;
        if (pos) {
          const r = await fetch(`${API_BASE}/nearby?lat=${pos.lat}&lng=${pos.lng}&radius=1200`);
          if (r.ok) {
            const d = await r.json();
            const v = (d?.venues || [])[0];
            if (v && !cancelled) {
              const dist = typeof v.distance_m === 'number' ? v.distance_m
                : (v.lat && v.lng ? Math.round(haversineM(pos.lat, pos.lng, v.lat, v.lng)) : undefined);
              setFirstStamp({ name: v.name, distance: dist });
              return;
            }
          }
        }
      } catch { /* fall through to the honest fallback */ }
      if (!cancelled) setFirstStamp(FALLBACK_STAMP);
    })();
    return () => { cancelled = true; };
  }, []);

  // Mark the arrival DONE so it never recurs on a later login (the whole point
  // of a "first-run"). Marks onboarding_completed server-side + caches the
  // profile locally under the key PersonalizationContext actually reads. Runs
  // for BOTH the answer path and the skip path (skipping is a deliberate
  // choice — don't re-ask every login). Fully fail-soft: entry is never blocked.
  const markDone = useCallback(async (profile?: { user_type: string; party_type?: string }) => {
    // Local caches FIRST (unconditional) so the answer survives a failed PATCH.
    try { await AsyncStorage.setItem('@onboarding_done', 'true'); } catch {}
    if (profile) {
      try { await AsyncStorage.setItem('@onboarding_profile', JSON.stringify(profile)); } catch {}
    }
    try {
      await api.patch('/users/me/onboarding', {
        ...(profile || {}),
        onboarding_version: 2,
        profile_complete: true,   // sets onboarding_completed=true → no re-onboard
      });
    } catch { /* fail-soft — never block entry on the personalization write */ }
    router.replace((dest as any) || ('/(tabs)' as any));
  }, [router, dest]);

  const enterApp = useCallback(() => { markDone(); }, [markDone]);

  // The one question → user_type (already wired into Luna, Drop 4). "de paso"
  // and "unos días" are both visitors; the party_type distinguishes cruise.
  const pickType = useCallback(async (choice: 'cruise' | 'traveler' | 'local') => {
    if (saving) return;
    setSaving(true);
    const user_type = choice === 'local' ? 'local' : 'visitor';
    try { await api.patch('/users/me/type', { user_type }); } catch { /* fail-soft */ }
    await markDone({ user_type, ...(choice === 'cruise' ? { party_type: 'cruise' } : {}) });
  }, [saving, markDone]);

  const R = (i: number) => ({
    opacity: anims[i],
    transform: [{ translateY: anims[i].interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) }],
  });

  const glowStyle = {
    opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.6] }),
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Animated.View pointerEvents="none" style={[styles.glow, glowStyle]} />

      {/* Skip — always available, never a wall */}
      <TouchableOpacity style={styles.skip} onPress={enterApp} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
        <Text style={styles.skipText}>{tr('Saltar')}</Text>
      </TouchableOpacity>

      {beat === 'arrival' ? (
        <View style={styles.stage}>
          {/* Wordmark */}
          <Animated.View style={[styles.wordmarkWrap, R(0)]}>
            <Text style={styles.amoMark}>A  M  O</Text>
            <Text style={styles.cartagenaMark}>Cartagena</Text>
            <View style={styles.rule} />
          </Animated.View>

          {/* Welcome beat */}
          <Animated.Text style={[styles.welcome, R(1)]}>
            {firstName ? `${tr('Bienvenido a Cartagena')},\n${firstName}` : tr('Bienvenido a Cartagena')}
          </Animated.Text>

          {/* Luna greeting — grounded, time-aware */}
          <Animated.View style={[styles.lunaRow, R(2)]}>
            <View style={styles.lunaDot}><Text style={styles.lunaDotText}>L</Text></View>
            <View style={styles.lunaBubble}>
              <Text style={styles.lunaName}>{tr('Luna · tu concierge')}</Text>
              <Text style={styles.lunaLine}>
                {nowLine ? nowLine.es : tr('Estoy acá para mostrarte la ciudad — a cualquier hora.')}
                {/* golden-hour line already states the sunset — don't repeat it */}
                {nowLine?.sunset && nowLine.key !== 'rooftops-atardecer' ? `  ·  el sol se pone ${nowLine.sunset}` : ''}
              </Text>
            </View>
          </Animated.View>

          {/* Passport as invitation + first-stamp hook */}
          <Animated.View style={[styles.passportCard, R(3)]}>
            <View style={styles.passportSealRow}>
              <View style={styles.dashedSeal}><Ionicons name="ribbon-outline" size={22} color={GOLD} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.passportTitle}>{tr('Tu pasaporte de Cartagena te espera')}</Text>
                <Text style={styles.passportSub}>{tr('Cada sello se gana caminando la ciudad.')}</Text>
              </View>
            </View>
            <View style={styles.stampHook}>
              <Ionicons name="location" size={15} color={GOLD_BRIGHT} />
              {firstStamp ? (
                <Text style={styles.stampHookText}>
                  {firstStamp.distance != null
                    ? `${tr('Tu primer sello')} · ${firstStamp.name} · ${firstStamp.distance} m`
                    : `${tr('Empezá por')} ${firstStamp.name}${firstStamp.hint ? ` — ${firstStamp.hint}` : ''}`}
                </Text>
              ) : (
                <Text style={styles.stampHookText}>{tr('Buscando tu primer sello…')}</Text>
              )}
            </View>
          </Animated.View>

          {/* CTA */}
          <Animated.View style={[styles.ctaWrap, R(4)]}>
            <TouchableOpacity style={styles.cta} onPress={() => setBeat('question')} activeOpacity={0.9}>
              <Text style={styles.ctaText}>{tr('Empezar')}</Text>
              <Ionicons name="arrow-forward" size={18} color="#0A0A0A" />
            </TouchableOpacity>
          </Animated.View>
        </View>
      ) : (
        <View style={styles.stage}>
          <View style={styles.wordmarkWrap}>
            <Text style={styles.amoMark}>A  M  O</Text>
            <View style={styles.rule} />
          </View>
          <Text style={styles.qTitle}>{tr('¿Cuánto tiempo en Cartagena?')}</Text>
          <Text style={styles.qSub}>{tr('Una pregunta — así Luna te muestra lo que de verdad te sirve.')}</Text>

          {([
            { key: 'cruise', icon: 'boat', label: 'Estoy de paso', sub: 'Crucero o un día — lo esencial, rápido' },
            { key: 'traveler', icon: 'airplane', label: 'Unos días', sub: 'De viaje — lo mejor de la ciudad' },
            { key: 'local', icon: 'home', label: 'Vivo acá', sub: 'Local — joyas y favoritos de barrio' },
          ] as const).map((o) => (
            <TouchableOpacity key={o.key} style={styles.qOption} onPress={() => pickType(o.key)} disabled={saving} activeOpacity={0.85}>
              <View style={styles.qIcon}><Ionicons name={o.icon as any} size={22} color={GOLD} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.qLabel}>{tr(o.label)}</Text>
                <Text style={styles.qOptSub}>{tr(o.sub)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          ))}

          {saving ? <ActivityIndicator color={GOLD} style={{ marginTop: SPACING.md }} /> : (
            <TouchableOpacity style={styles.qSkip} onPress={enterApp}>
              <Text style={styles.qSkipText}>{tr('Prefiero explorar solo →')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: INK },
  glow: {
    position: 'absolute', top: -120, alignSelf: 'center', width: 520, height: 520, borderRadius: 260,
    backgroundColor: 'rgba(212,175,55,0.16)',
    ...(Platform.OS === 'web' ? { filter: 'blur(90px)' } as any : {}),
  },
  skip: { position: 'absolute', top: 14, right: 18, zIndex: 10, paddingHorizontal: 12, paddingVertical: 6 },
  skipText: { color: COLORS.textMuted, fontSize: 14, ...FONTS.medium },
  stage: { flex: 1, justifyContent: 'center', paddingHorizontal: SPACING.xl, gap: SPACING.lg },
  wordmarkWrap: { alignItems: 'center', marginBottom: SPACING.sm },
  amoMark: { color: GOLD, fontSize: 14, letterSpacing: 6, ...FONTS.semibold },
  cartagenaMark: { color: '#FFFFFF', fontSize: 40, fontFamily: SERIF, marginTop: 2 },
  rule: { width: 60, height: 2, backgroundColor: GOLD, marginTop: 14, borderRadius: 1 },
  welcome: { color: '#FFFFFF', fontSize: 30, fontFamily: SERIF, textAlign: 'center', lineHeight: 38 },
  lunaRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  lunaDot: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center',
    marginTop: 2,
  },
  lunaDotText: { color: '#0A0A0A', fontSize: 18, fontFamily: SERIF, fontWeight: '700' },
  lunaBubble: {
    flex: 1, backgroundColor: 'rgba(212,175,55,0.07)', borderColor: 'rgba(212,175,55,0.28)', borderWidth: 1,
    borderRadius: 16, borderTopLeftRadius: 4, padding: 14,
  },
  lunaName: { color: GOLD, fontSize: 12, ...FONTS.semibold, marginBottom: 4, letterSpacing: 0.3 },
  lunaLine: { color: 'rgba(255,255,255,0.9)', fontSize: 15, lineHeight: 22 },
  passportCard: {
    backgroundColor: 'rgba(255,255,255,0.035)', borderColor: 'rgba(212,175,55,0.22)', borderWidth: 1,
    borderRadius: 18, padding: 16, gap: 14,
  },
  passportSealRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  dashedSeal: {
    width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, borderColor: 'rgba(212,175,55,0.5)',
    borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center',
  },
  passportTitle: { color: '#FFFFFF', fontSize: 16, ...FONTS.semibold },
  passportSub: { color: COLORS.textMuted, fontSize: 13, marginTop: 2 },
  stampHook: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    backgroundColor: 'rgba(212,175,55,0.1)', borderRadius: 12, paddingVertical: 11, paddingHorizontal: 13,
  },
  stampHookText: { color: GOLD_BRIGHT, fontSize: 13.5, ...FONTS.medium, flex: 1 },
  ctaWrap: { marginTop: SPACING.sm },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: GOLD, borderRadius: 999, paddingVertical: 16,
  },
  ctaText: { color: '#0A0A0A', fontSize: 16, ...FONTS.bold },
  qTitle: { color: '#FFFFFF', fontSize: 26, fontFamily: SERIF, textAlign: 'center' },
  qSub: { color: COLORS.textMuted, fontSize: 14, textAlign: 'center', marginTop: -6, marginBottom: SPACING.sm, lineHeight: 20 },
  qOption: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(212,175,55,0.2)', borderWidth: 1,
    borderRadius: 16, padding: 16,
  },
  qIcon: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(212,175,55,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  qLabel: { color: '#FFFFFF', fontSize: 17, ...FONTS.semibold },
  qOptSub: { color: COLORS.textMuted, fontSize: 13, marginTop: 2 },
  qSkip: { alignSelf: 'center', marginTop: SPACING.md, padding: 8 },
  qSkipText: { color: COLORS.textMuted, fontSize: 14, ...FONTS.medium },
});
