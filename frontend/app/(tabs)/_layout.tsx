import { useEffect } from 'react';
import { Tabs, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../src/constants/theme';
import { Platform, View } from 'react-native';
import AssistantFab from '../../src/components/AssistantFab';
import { useLang } from '../../src/context/LanguageContext';
import { TutorialOverlay, useTutorial } from '../../src/components/TutorialOverlay';
import { usePartnerCount } from '../../src/context/PartnerCountContext';

export default function TabLayout() {
  const { s } = useLang();
  const partnerCount = usePartnerCount();
  const pathname = usePathname();
  const { showTutorial, checkAndShow, completeTutorial } = useTutorial();

  const hideFab = pathname === '/' || pathname === '/index' || pathname.endsWith('/(tabs)') || pathname === '';

  // Show tutorial once after onboarding completes
  useEffect(() => { checkAndShow(); }, []);

  const stops = [
    { key: 'explore', icon: 'compass', title: s('tutorial_explore_title', { count: partnerCount || 800 }), description: s('tutorial_explore_desc'), position: 'bottom' as const },
    { key: 'map', icon: 'map', title: s('tutorial_map_title'), description: s('tutorial_map_desc'), position: 'bottom' as const },
    { key: 'concierge', icon: 'sparkles', title: s('tutorial_concierge_title'), description: s('tutorial_concierge_desc'), position: 'top' as const },
    { key: 'rewards', icon: 'star', title: s('tutorial_rewards_title'), description: s('tutorial_rewards_desc'), position: 'top' as const },
  ];

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: COLORS.primary,
          tabBarInactiveTintColor: COLORS.textMuted,
          tabBarStyle: {
            backgroundColor: COLORS.background,
            borderTopColor: COLORS.border,
            borderTopWidth: 1,
            paddingBottom: Platform.OS === 'ios' ? 20 : 8,
            paddingTop: 8,
            height: Platform.OS === 'ios' ? 85 : 65,
          },
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: '600',
            letterSpacing: 0.3,
          },
        }}
      >
        <Tabs.Screen name="index" options={{ title: s('tab_home'), tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} /> }} />
        <Tabs.Screen name="explore" options={{ title: s('tab_explore') || 'Explore', tabBarIcon: ({ color, size }) => <Ionicons name="compass" size={size} color={color} /> }} />
        <Tabs.Screen name="mapa" options={{ title: s('tab_map'), tabBarIcon: ({ color, size }) => <Ionicons name="map" size={size} color={color} /> }} />
        <Tabs.Screen name="bookings" options={{ title: s('tab_bookings') || 'Bookings', tabBarIcon: ({ color, size }) => <Ionicons name="bookmark" size={size} color={color} /> }} />
        <Tabs.Screen name="perfil" options={{ title: s('tab_profile'), tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} /> }} />
        <Tabs.Screen name="agenda" options={{ href: null }} />
        <Tabs.Screen name="partners" options={{ href: null }} />
        <Tabs.Screen name="citypass" options={{ href: null }} />
      </Tabs>
      <AssistantFab hideFab={hideFab} />
      <TutorialOverlay visible={showTutorial} onComplete={completeTutorial} stops={stops} />
    </View>
  );
}
