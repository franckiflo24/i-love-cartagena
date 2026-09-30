import { useEffect } from 'react';
import { Stack } from 'expo-router';
import Head from '../src/components/WebHead';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { AuthProvider } from '../src/context/AuthContext';
import { FavoritesProvider } from '../src/context/FavoritesContext';
import { LanguageProvider } from '../src/context/LanguageContext';
import { BusinessAuthProvider } from '../src/context/BusinessAuthContext';
import { MyCalendarProvider } from '../src/context/MyCalendarContext';
import { RewardsProvider } from '../src/context/RewardsContext';
import { PersonalizationProvider } from '../src/context/PersonalizationContext';
import { PartnerCountProvider } from '../src/context/PartnerCountContext';
import { SignupGateProvider } from '../src/context/SignupGateContext';
import PushBootstrap from '../src/components/PushBootstrap';
import ErrorBoundary from '../src/components/ErrorBoundary';
import { AlertHost } from '../src/lib/alert';
import { API_BASE, fetchT } from '../src/constants/api';
import { useWebIconFonts } from '../src/lib/useWebIconFonts';

export default function RootLayout() {
  // Web: icon font registered here so static HTML and hydration render the same
  // icons (React #418 on /agenda + /perfil). Native: no-op. See the .web.ts file.
  useWebIconFonts();
  // Keep-warm: ping the backend once per app open so the serverless cold start
  // happens while splash/onboarding shows, not when data is needed. Runs on
  // native too (it was web-only, so the iOS binary paid the cold start on its
  // first real request). Fire-and-forget, bounded by the 8 s GET timeout.
  // API_BASE is absolute on native (prod fallback) and whenever
  // EXPO_PUBLIC_BACKEND_URL is set; a relative '/api' (web without a backend
  // URL) has nothing to warm.
  useEffect(() => {
    if (!/^https?:\/\//i.test(API_BASE)) return;
    fetchT(`${API_BASE}/health`).catch(() => {});
  }, []);
  // Web preloader handshake: +html.tsx keeps #amo-preloader up until the root
  // layout has mounted (this attribute), with a 4 s safety fallback. Every
  // screen's chrome paints on first mount (fallback-first), so "mounted" is the
  // honest "ready" — the old testid/tablist heuristic never fired on
  // onboarding/event/partner-event and held the logo for 4.7 s.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    try { document.documentElement.dataset.appReady = '1'; } catch { /* no DOM (SSR) */ }
  }, []);
  return (
    <ErrorBoundary>
    <AuthProvider>
      <PersonalizationProvider>
      <BusinessAuthProvider>
      <LanguageProvider>
      <FavoritesProvider>
      <MyCalendarProvider>
      <RewardsProvider>
      <PartnerCountProvider>
      <SignupGateProvider>
      <PushBootstrap />
      {/* Default document title. expo-router's web Head provider (react-helmet-async)
          injects an EMPTY <title data-rh> ahead of the +html.tsx one, and document.title
          reads the first — every route showed the raw URL in the tab, history and share
          sheet. Screens that set their own <Head><title> override this one. */}
      <Head><title>AMO Life</title></Head>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="event/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="partner/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="ciudad/index" options={{ presentation: 'card' }} />
        <Stack.Screen name="que-pasa/index" options={{ presentation: 'card' }} />
        <Stack.Screen name="music-week/index" options={{ presentation: 'card' }} />
        <Stack.Screen name="music-week/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="port-day" options={{ presentation: 'card' }} />
        <Stack.Screen name="ciudad/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="partner-event/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="experience/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="experience/booking" options={{ presentation: 'card' }} />
        <Stack.Screen name="rewards/index" options={{ presentation: 'modal' }} />
        <Stack.Screen name="review/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="transport" options={{ presentation: 'modal' }} />
        <Stack.Screen name="itineraries" options={{ presentation: 'modal' }} />
        <Stack.Screen name="notifications" options={{ presentation: 'modal' }} />
        <Stack.Screen name="concerts" options={{ presentation: 'modal' }} />
        <Stack.Screen name="favorites" options={{ presentation: 'modal' }} />
        <Stack.Screen name="complete-profile" options={{ presentation: 'modal' }} />
        <Stack.Screen name="search" options={{ presentation: 'modal' }} />
        <Stack.Screen name="business/login" options={{ presentation: 'modal' }} />
        <Stack.Screen name="business/dashboard" options={{ presentation: 'modal' }} />
        <Stack.Screen name="business/event-form" options={{ presentation: 'modal' }} />
        <Stack.Screen name="business/profile-edit" options={{ presentation: 'modal' }} />
        <Stack.Screen name="port-tax" options={{ presentation: 'modal' }} />
        <Stack.Screen name="reservations/index" options={{ presentation: 'modal' }} />
        <Stack.Screen name="reservation/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="rewards/offers" options={{ presentation: 'modal' }} />
        <Stack.Screen name="rewards/card" options={{ presentation: 'modal' }} />
        <Stack.Screen name="concierge" options={{ presentation: 'modal' }} />
        {/* port-tax/tickets + port-tax/ticket/[id] are owned by port-tax/_layout — declaring
            them here too raised a runtime warning and their options were ignored. */}
        <Stack.Screen name="payments/return" options={{ presentation: 'card' }} />
        <Stack.Screen name="business/activate" options={{ presentation: 'card' }} />
        <Stack.Screen name="business/reservations" options={{ presentation: 'modal' }} />
        <Stack.Screen name="business/stats" options={{ presentation: 'modal' }} />
        <Stack.Screen name="business/promotions" options={{ presentation: 'modal' }} />
        <Stack.Screen name="business/pulse" options={{ presentation: 'modal' }} />
        <Stack.Screen name="ayuda" options={{ presentation: 'modal' }} />
        <Stack.Screen name="privacidad" options={{ presentation: 'modal' }} />
        <Stack.Screen name="terminos" options={{ presentation: 'modal' }} />
        <Stack.Screen name="favoritos" options={{ presentation: 'modal' }} />
      </Stack>
      <AlertHost />
      </SignupGateProvider>
      </PartnerCountProvider>
      </RewardsProvider>
      </MyCalendarProvider>
      </FavoritesProvider>
      </LanguageProvider>
      </BusinessAuthProvider>
      </PersonalizationProvider>
    </AuthProvider>
    </ErrorBoundary>
  );
}
