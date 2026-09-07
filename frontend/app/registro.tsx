import { useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { useAuth } from '../src/context/AuthContext';
import { useTr } from '../src/i18n/autoTr';
import { trackGate } from '../src/lib/gateAnalytics';

// Direct-to-registration entry for QRs and field links.
//
// Field finding (Franck, host shift at Bohème): the root QR runs scan →
// onboarding explainer → home, and signup is never prompted — people he
// personally sent to the app weren't registering. This route is the funnel
// for anyone being onboarded IN PERSON: the host just explained the app, so
// the explainer is skipped (marked done) and the visitor lands straight on
// the registration screen.
//
// LOGGED-IN visitors (partners and staff testing their own link, returning
// tourists rescanning) get an explicit "already registered" screen instead of
// a silent bounce to home — the silent bounce read as "the link is broken" to
// every logged-in tester, twice. Their visit is NOT counted as a scan (they
// can't convert, and testers would pollute Franck's numbers).
//
//   /registro?src=boheme     loose venue tag → rides the existing gate-funnel
//                            analytics (event enum is server-pinned, so it
//                            travels as action "qr_<venue>" on 'gate_shown',
//                            archetype 'invited'); the post-signup activation
//                            event carries the same tag = per-venue conversion.
//   /registro?ref=AMOXXXX    precise referral credit — captured globally by
//                            src/lib/referral.ts on module load, claimed
//                            automatically after signup. Both can combine.
//   /registro?next=/mapa     where to land after signup (default home).
export default function RegistroScreen() {
  const router = useRouter();
  const tr = useTr();
  const { user, isLoading } = useAuth();
  const { src, next } = useLocalSearchParams<{ src?: string; next?: string }>();

  useEffect(() => {
    if (isLoading || user) return; // logged-in state renders below — no redirect
    (async () => {
      // Sandboxed in-app browsers (Instagram/FB) can throw on storage — the
      // redirect must happen regardless.
      try { await AsyncStorage.setItem('@onboarding_done', 'true'); } catch {}
      const tag = typeof src === 'string' && /^[a-z0-9_-]{1,24}$/i.test(src) ? src.toLowerCase() : null;
      if (tag) {
        // Carry the venue tag + 'invited' archetype through this browser session
        // so the post-signup activation event (onboarding markDone) reports
        // action "qr_<tag>" AND the signup is attributed 'invited' (mirrors
        // referral.ts) — scan→signup conversion counts directly, no session joins.
        try {
          sessionStorage.setItem('amo_src', tag);
          sessionStorage.setItem('amo_archetype', 'invited');
        } catch {}
        trackGate('gate_shown', { action: `qr_${tag}`, archetype: 'invited' });
      }
      const dest = typeof next === 'string' && next.startsWith('/') ? next : '/';
      router.replace((`/login?next=${encodeURIComponent(dest)}`) as any);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, user]);

  if (!isLoading && user) {
    const firstName = (user.name || '').trim().split(' ')[0];
    return (
      <View style={styles.center}>
        <View style={styles.card}>
          <Ionicons name="checkmark-circle" size={54} color={COLORS.primary} />
          <Text style={styles.title}>
            {firstName ? `${firstName}, ` : ''}{tr('ya estás registrado')}
          </Text>
          <Text style={styles.sub}>
            {tr('Tu cuenta ya está activa. Este enlace registra a usuarios NUEVOS — muéstralo con el QR, o pruébalo en una ventana de incógnito para ver lo que verán tus clientes.')}
          </Text>
          <TouchableOpacity style={styles.homeBtn} onPress={() => router.replace('/(tabs)' as any)} activeOpacity={0.85}>
            <Text style={styles.homeBtnText}>{tr('Ir al inicio')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={COLORS.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  card: {
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xl,
    maxWidth: 420,
    width: '100%',
  },
  title: { fontSize: 19, color: COLORS.textMain, textAlign: 'center', ...FONTS.bold },
  sub: { fontSize: 13.5, color: COLORS.textMuted, textAlign: 'center', lineHeight: 20, ...FONTS.regular },
  homeBtn: {
    marginTop: 6,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.full,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  homeBtnText: { fontSize: 14, color: '#fff', ...FONTS.bold },
});
