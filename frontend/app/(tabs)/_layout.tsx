import { useEffect } from 'react';
import { Tabs, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../src/constants/theme';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AssistantFab from '../../src/components/AssistantFab';
import { useLang } from '../../src/context/LanguageContext';
import { TutorialOverlay, useTutorial } from '../../src/components/TutorialOverlay';
import { usePartnerCount } from '../../src/context/PartnerCountContext';
import { hapticSelection } from '../../src/lib/haptics';

export default function TabLayout() {
  const { s } = useLang();
  const partnerCount = usePartnerCount();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
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
        screenListeners={{ tabPress: () => hapticSelection() }}
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: COLORS.primary,
          tabBarInactiveTintColor: COLORS.textMuted,
          // Drive height/padding from the REAL safe-area inset (not a hardcoded
          // 85/20) so labels sit right on Face-ID phones and the bar isn't too
          // tall on SE-class devices.
          tabBarStyle: {
            backgroundColor: COLORS.background,
            borderTopColor: COLORS.border,
            borderTopWidth: 1,
            // 4/4 (was 8/8): the bar keeps its 56 + inset height, but the item
            // area inside it grows from 40 px to 48 px so every tab is a ≥ 44 px
            // target (items measured 65×39 before). The inset side keeps the
            // real home-indicator inset.
            paddingBottom: Math.max(insets.bottom, 4),
            paddingTop: 4,
            height: 56 + insets.bottom,
          },
          // Each tab item is at least 44 px tall and centres its icon + label
          // in that area (bottom-tabs' default is flex-start with 5 px padding).
          tabBarItemStyle: {
            minHeight: 44,
            justifyContent: 'center',
            paddingVertical: 0,
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
        <Tabs.Screen name="pasaporte" options={{ title: s('tab_passport') || 'Pasaporte', tabBarIcon: ({ color, size }) => <Ionicons name="ribbon" size={size} color={color} /> }} />
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
