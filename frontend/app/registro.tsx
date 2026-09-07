import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { COLORS } from '../src/constants/theme';
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
//   /registro?src=boheme     loose venue tag → rides the existing gate-funnel
//                            analytics (event enum is server-pinned, so it
//                            travels as action "qr_<venue>" on 'gate_shown',
//                            archetype 'invited'); later 'activation' events
//                            join by session id = real scan→signup conversion.
//   /registro?ref=AMOXXXX    precise referral credit — captured globally by
//                            src/lib/referral.ts on module load, claimed
//                            automatically after signup. Both can combine.
//   /registro?next=/mapa     where to land after signup (default home).
export default function RegistroScreen() {
  const router = useRouter();
  const { src, next } = useLocalSearchParams<{ src?: string; next?: string }>();

  useEffect(() => {
    (async () => {
      // Sandboxed in-app browsers (Instagram/FB) can throw on storage — the
      // redirect must happen regardless.
      try { await AsyncStorage.setItem('@onboarding_done', 'true'); } catch {}
      const tag = typeof src === 'string' && /^[a-z0-9_-]{1,24}$/i.test(src) ? src.toLowerCase() : null;
      if (tag) {
        // Carry the venue tag through this browser session so the post-signup
        // activation event (onboarding markDone) reports action "qr_<tag>" —
        // scan→signup conversion then counts directly, no session joins.
        try { sessionStorage.setItem('amo_src', tag); } catch {}
        trackGate('gate_shown', { action: `qr_${tag}`, archetype: 'invited' });
      }
      const dest = typeof next === 'string' && next.startsWith('/') ? next : '/';
      router.replace((`/login?next=${encodeURIComponent(dest)}`) as any);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={COLORS.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center' },
});
