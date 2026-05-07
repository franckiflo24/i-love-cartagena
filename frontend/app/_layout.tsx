import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ThemeProvider, DarkTheme } from '@react-navigation/native';
import { AuthProvider } from '../src/context/AuthContext';
import { FavoritesProvider } from '../src/context/FavoritesContext';
import { LanguageProvider } from '../src/context/LanguageContext';
import { BusinessAuthProvider } from '../src/context/BusinessAuthContext';
import { MyCalendarProvider } from '../src/context/MyCalendarContext';
import AppBackground from '../src/components/AppBackground';

const TransparentTheme = {
  ...DarkTheme,
  dark: true,
  colors: {
    ...DarkTheme.colors,
    background: 'transparent',
    card: 'transparent',
  },
};

export default function RootLayout() {
  return (
    <AuthProvider>
      <BusinessAuthProvider>
      <LanguageProvider>
      <FavoritesProvider>
      <MyCalendarProvider>
      <StatusBar style="light" />
      <ThemeProvider value={TransparentTheme}>
      <AppBackground>
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        >
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="login" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="event/[id]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="partner/[id]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="partner-event/[id]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="transport" options={{ presentation: 'modal' }} />
          <Stack.Screen name="itineraries" options={{ presentation: 'modal' }} />
          <Stack.Screen name="notifications" options={{ presentation: 'modal' }} />
          <Stack.Screen name="admin" options={{ presentation: 'modal' }} />
          <Stack.Screen name="admin/moderation" options={{ presentation: 'modal' }} />
          <Stack.Screen name="city-pass" options={{ presentation: 'modal' }} />
          <Stack.Screen name="concerts" options={{ presentation: 'modal' }} />
          <Stack.Screen name="favorites" options={{ presentation: 'modal' }} />
          <Stack.Screen name="complete-profile" options={{ presentation: 'modal' }} />
          <Stack.Screen name="search" options={{ presentation: 'modal' }} />
          <Stack.Screen name="business/login" options={{ presentation: 'modal' }} />
          <Stack.Screen name="business/dashboard" options={{ presentation: 'modal' }} />
          <Stack.Screen name="business/event-form" options={{ presentation: 'modal' }} />
          <Stack.Screen name="business/profile-edit" options={{ presentation: 'modal' }} />
        </Stack>
      </AppBackground>
      </ThemeProvider>
      </MyCalendarProvider>
      </FavoritesProvider>
      </LanguageProvider>
      </BusinessAuthProvider>
    </AuthProvider>
  );
}
