import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../src/context/AuthContext';
import { FavoritesProvider } from '../src/context/FavoritesContext';
import { LanguageProvider } from '../src/context/LanguageContext';

export default function RootLayout() {
  return (
    <AuthProvider>
      <LanguageProvider>
      <FavoritesProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="event/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="partner/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="transport" options={{ presentation: 'modal' }} />
        <Stack.Screen name="itineraries" options={{ presentation: 'modal' }} />
        <Stack.Screen name="notifications" options={{ presentation: 'modal' }} />
        <Stack.Screen name="admin" options={{ presentation: 'modal' }} />
        <Stack.Screen name="city-pass" options={{ presentation: 'modal' }} />
        <Stack.Screen name="concerts" options={{ presentation: 'modal' }} />
        <Stack.Screen name="favorites" options={{ presentation: 'modal' }} />
        <Stack.Screen name="complete-profile" options={{ presentation: 'modal' }} />
      </Stack>
      </FavoritesProvider>
      </LanguageProvider>
    </AuthProvider>
  );
}
