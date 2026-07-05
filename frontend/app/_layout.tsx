import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { AuthProvider } from '../src/context/AuthContext';
import { FavoritesProvider } from '../src/context/FavoritesContext';
import { LanguageProvider } from '../src/context/LanguageContext';
import { BusinessAuthProvider } from '../src/context/BusinessAuthContext';
import { MyCalendarProvider } from '../src/context/MyCalendarContext';
import { RewardsProvider } from '../src/context/RewardsContext';
import PushBootstrap from '../src/components/PushBootstrap';
import ErrorBoundary from '../src/components/ErrorBoundary';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

export default function RootLayout() {
  // Keep-warm: ping backend on app open so serverless cold-start
  // happens while splash/onboarding shows, not when data is needed
  useEffect(() => {
    if (Platform.OS === 'web' && BACKEND_URL) {
      fetch(`${BACKEND_URL}/api/health`).catch(() => {});
    }
  }, []);
  return (
    <ErrorBoundary>
    <AuthProvider>
      <BusinessAuthProvider>
      <LanguageProvider>
      <FavoritesProvider>
      <MyCalendarProvider>
      <RewardsProvider>
      <PushBootstrap />
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="event/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="partner/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="partner-event/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="experience/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="experience/booking" options={{ presentation: 'card' }} />
        <Stack.Screen name="rewards/index" options={{ presentation: 'modal' }} />
        <Stack.Screen name="review/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="transport" options={{ presentation: 'modal' }} />
        <Stack.Screen name="itineraries" options={{ presentation: 'modal' }} />
        <Stack.Screen name="notifications" options={{ presentation: 'modal' }} />
        <Stack.Screen name="city-pass" options={{ presentation: 'modal' }} />
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
        <Stack.Screen name="port-tax/tickets" options={{ presentation: 'modal' }} />
        <Stack.Screen name="port-tax/ticket/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="payments/return" options={{ presentation: 'card' }} />
        <Stack.Screen name="business/activate" options={{ presentation: 'card' }} />
        <Stack.Screen name="business/reservations" options={{ presentation: 'modal' }} />
        <Stack.Screen name="business/stats" options={{ presentation: 'modal' }} />
        <Stack.Screen name="ayuda" options={{ presentation: 'modal' }} />
        <Stack.Screen name="privacidad" options={{ presentation: 'modal' }} />
        <Stack.Screen name="terminos" options={{ presentation: 'modal' }} />
        <Stack.Screen name="eventos" options={{ presentation: 'modal' }} />
        <Stack.Screen name="favoritos" options={{ presentation: 'modal' }} />
      </Stack>
      </RewardsProvider>
      </MyCalendarProvider>
      </FavoritesProvider>
      </LanguageProvider>
      </BusinessAuthProvider>
    </AuthProvider>
    </ErrorBoundary>
  );
}
