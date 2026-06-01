import { Tabs, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../src/constants/theme';
import { Platform, View } from 'react-native';
import AssistantFab from '../../src/components/AssistantFab';
import { useLang } from '../../src/context/LanguageContext';

export default function TabLayout() {
  const { s } = useLang();
  const pathname = usePathname();
  // Hide the floating Amo button on the home tab — the home page has its inline "Amo IA" pill
  // in the search bar that replaces the FAB. The FAB stays available on all other tabs.
  const hideFab = pathname === '/' || pathname === '/index' || pathname.endsWith('/(tabs)') || pathname === '';
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
        <Tabs.Screen
          name="index"
          options={{
            title: s('tab_home'),
            tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="explore"
          options={{
            title: s('tab_explore') || 'Explore',
            tabBarIcon: ({ color, size }) => <Ionicons name="compass" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="mapa"
          options={{
            title: s('tab_map'),
            tabBarIcon: ({ color, size }) => <Ionicons name="map" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="bookings"
          options={{
            title: s('tab_bookings') || 'Bookings',
            tabBarIcon: ({ color, size }) => <Ionicons name="bookmark" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="perfil"
          options={{
            title: s('tab_profile'),
            tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
          }}
        />
        {/* Hidden tabs — still accessible via router.push but not in tab bar */}
        <Tabs.Screen name="agenda" options={{ href: null }} />
        <Tabs.Screen name="partners" options={{ href: null }} />
        <Tabs.Screen name="citypass" options={{ href: null }} />
      </Tabs>
      <AssistantFab hideFab={hideFab} />
    </View>
  );
}
