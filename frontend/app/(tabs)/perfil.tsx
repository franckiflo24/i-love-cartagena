import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS, EVENT_TYPE_LABELS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useAuth } from '../../src/context/AuthContext';
import { useLang } from '../../src/context/LanguageContext';
import { LANG_LABELS, LANG_FLAGS, Lang } from '../../src/i18n/translations';

type Event = {
  event_id: string; title: string; date: string; start_time: string;
  end_time: string; venue_name: string; type: string; is_free: boolean;
  price: number; image_url: string;
};

export default function PerfilScreen() {
  const router = useRouter();
  const { user, login, logout } = useAuth();
  const { lang, setLang, s } = useLang();
  const [favorites, setFavorites] = useState<Event[]>([]);
  const [myWeek, setMyWeek] = useState<Event[]>([]);
  const [activeTab, setActiveTab] = useState<'week' | 'favorites'>('week');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      setLoading(true);
      Promise.all([
        api.get('/favorites').catch(() => []),
        api.get('/my-week').catch(() => []),
      ]).then(([f, w]) => {
        setFavorites(f);
        setMyWeek(w);
      }).finally(() => setLoading(false));
    }
  }, [user]);

  if (!user) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loginPrompt}>
          <Ionicons name="person-circle-outline" size={80} color={COLORS.textMuted} />
          <Text style={styles.loginTitle}>{s('profile_login')}</Text>
          <Text style={styles.loginDesc}>{s('fav_empty_desc')}</Text>
          <TouchableOpacity testID="profile-login-btn" style={styles.loginBtn} onPress={login}>
            <Ionicons name="logo-google" size={18} color={COLORS.white} />
            <Text style={styles.loginBtnText}>{s('login_google')}</Text>
          </TouchableOpacity>
        </View>

        {/* Language Selector for guests */}
        <View style={styles.langSectionGuest}>
          <View style={styles.langHeader}>
            <Ionicons name="globe-outline" size={18} color={COLORS.textMuted} />
            <Text style={styles.langTitle}>{s('profile_language')}</Text>
          </View>
          <View style={styles.langRow}>
            {(['es', 'en', 'fr'] as Lang[]).map(l => {
              const isActive = lang === l;
              return (
                <TouchableOpacity
                  key={l}
                  style={[styles.langBtn, isActive && styles.langBtnActive]}
                  onPress={() => setLang(l)}
                >
                  <Text style={styles.langFlag}>{LANG_FLAGS[l]}</Text>
                  <Text style={[styles.langLabel, isActive && styles.langLabelActive]}>{LANG_LABELS[l]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const events = activeTab === 'week' ? myWeek : favorites;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          {user.picture ? (
            <Image source={{ uri: user.picture }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarText}>{user.name[0]}</Text>
            </View>
          )}
          <Text style={styles.userName}>{user.name}</Text>
          <Text style={styles.userEmail}>{user.email}</Text>
        </View>

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          {[
            { icon: 'notifications-outline', label: s('profile_notifications'), route: '/notifications' },
            { icon: 'ticket-outline', label: 'City Pass', route: '/city-pass' },
            { icon: 'boat-outline', label: s('home_transport'), route: '/transport' },
            { icon: 'trail-sign-outline', label: s('home_routes'), route: '/itineraries' },
            { icon: 'bar-chart-outline', label: 'Dashboard', route: '/admin' },
          ].map(item => (
            <TouchableOpacity
              key={item.label}
              testID={`profile-action-${item.label.toLowerCase()}`}
              style={styles.actionBtn}
              onPress={() => router.push(item.route as any)}
            >
              <Ionicons name={item.icon as any} size={20} color={COLORS.primary} />
              <Text style={styles.actionLabel}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Language Selector */}
        <View style={styles.langSection}>
          <View style={styles.langHeader}>
            <Ionicons name="globe-outline" size={18} color={COLORS.textMuted} />
            <Text style={styles.langTitle}>{s('profile_language')}</Text>
          </View>
          <View style={styles.langRow}>
            {(['es', 'en', 'fr'] as Lang[]).map(l => {
              const isActive = lang === l;
              return (
                <TouchableOpacity
                  key={l}
                  style={[styles.langBtn, isActive && styles.langBtnActive]}
                  onPress={() => setLang(l)}
                >
                  <Text style={styles.langFlag}>{LANG_FLAGS[l]}</Text>
                  <Text style={[styles.langLabel, isActive && styles.langLabelActive]}>{LANG_LABELS[l]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Tabs */}
        <View style={styles.tabs}>
          <TouchableOpacity
            testID="tab-my-week"
            style={[styles.tab, activeTab === 'week' && styles.tabActive]}
            onPress={() => setActiveTab('week')}
          >
            <Text style={[styles.tabText, activeTab === 'week' && styles.tabTextActive]}>Mi Semana ({myWeek.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="tab-favorites"
            style={[styles.tab, activeTab === 'favorites' && styles.tabActive]}
            onPress={() => setActiveTab('favorites')}
          >
            <Text style={[styles.tabText, activeTab === 'favorites' && styles.tabTextActive]}>Favoritos ({favorites.length})</Text>
          </TouchableOpacity>
        </View>

        {/* Events List */}
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : events.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name={activeTab === 'week' ? 'calendar-outline' : 'heart-outline'} size={48} color={COLORS.textMuted} />
            <Text style={styles.emptyTitle}>
              {activeTab === 'week' ? 'Tu semana está vacía' : 'Sin favoritos aún'}
            </Text>
            <Text style={styles.emptyDesc}>
              {activeTab === 'week' ? 'Agrega eventos a tu itinerario personal' : 'Marca eventos como favoritos'}
            </Text>
            <TouchableOpacity testID="explore-events-btn" style={styles.exploreBtn} onPress={() => router.push('/(tabs)/agenda')}>
              <Text style={styles.exploreBtnText}>Explorar agenda</Text>
            </TouchableOpacity>
          </View>
        ) : (
          events.map(event => (
            <TouchableOpacity
              key={event.event_id}
              testID={`profile-event-${event.event_id}`}
              style={styles.eventRow}
              onPress={() => router.push(`/event/${event.event_id}`)}
            >
              <Image source={{ uri: event.image_url }} style={styles.eventThumb} />
              <View style={styles.eventInfo}>
                <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
                <Text style={styles.eventMeta}>{event.date} · {event.start_time}</Text>
                <Text style={styles.eventVenue}>{event.venue_name}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          ))
        )}

        {/* Logout */}
        <TouchableOpacity testID="logout-btn" style={styles.logoutBtn} onPress={logout}>
          <Ionicons name="log-out-outline" size={18} color={COLORS.error} />
          <Text style={styles.logoutText}>Cerrar sesión</Text>
        </TouchableOpacity>

        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loginPrompt: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.xl, gap: SPACING.md },
  loginTitle: { fontSize: 24, color: COLORS.textMain, ...FONTS.bold },
  loginDesc: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center' },
  loginBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 14, paddingHorizontal: SPACING.xl, marginTop: SPACING.md },
  loginBtnText: { fontSize: 15, color: COLORS.white, ...FONTS.semibold },
  profileHeader: { alignItems: 'center', paddingVertical: SPACING.xl, paddingHorizontal: SPACING.lg },
  avatar: { width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: COLORS.primary },
  avatarPlaceholder: { width: 80, height: 80, borderRadius: 40, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 32, color: COLORS.white, ...FONTS.bold },
  userName: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold, marginTop: SPACING.md },
  userEmail: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, marginTop: 4 },
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.lg, marginBottom: SPACING.lg },
  actionBtn: { alignItems: 'center', gap: SPACING.xs, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.sm, minWidth: 80, borderWidth: 1, borderColor: COLORS.border },
  actionLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
  langSection: { marginHorizontal: SPACING.lg, marginBottom: SPACING.lg },
  langSectionGuest: { paddingHorizontal: SPACING.xl, paddingBottom: SPACING.xl },
  langHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm },
  langTitle: { fontSize: 14, color: COLORS.textMuted, ...FONTS.semibold },
  langRow: { flexDirection: 'row', gap: SPACING.sm },
  langBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: RADIUS.lg, backgroundColor: COLORS.surface, borderWidth: 1.5, borderColor: COLORS.border },
  langBtnActive: { borderColor: COLORS.primary, backgroundColor: `${COLORS.primary}12` },
  langFlag: { fontSize: 20 },
  langLabel: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium },
  langLabelActive: { color: COLORS.primary, ...FONTS.bold },
  tabs: { flexDirection: 'row', marginHorizontal: SPACING.lg, borderRadius: RADIUS.lg, backgroundColor: COLORS.surface, padding: 4, marginBottom: SPACING.md },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: RADIUS.md },
  tabActive: { backgroundColor: COLORS.primary },
  tabText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.semibold },
  tabTextActive: { color: COLORS.white },
  emptyState: { alignItems: 'center', paddingVertical: SPACING.xxl, gap: SPACING.sm },
  emptyTitle: { fontSize: 18, color: COLORS.textMain, ...FONTS.semibold },
  emptyDesc: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center' },
  exploreBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 10, paddingHorizontal: SPACING.xl, marginTop: SPACING.sm },
  exploreBtnText: { fontSize: 14, color: COLORS.white, ...FONTS.semibold },
  eventRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, gap: SPACING.md },
  eventThumb: { width: 56, height: 56, borderRadius: RADIUS.md, backgroundColor: COLORS.surface },
  eventInfo: { flex: 1 },
  eventTitle: { fontSize: 15, color: COLORS.textMain, ...FONTS.semibold },
  eventMeta: { fontSize: 12, color: COLORS.primary, ...FONTS.medium, marginTop: 2 },
  eventVenue: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginTop: 1 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, marginTop: SPACING.xl, paddingVertical: SPACING.md },
  logoutText: { fontSize: 14, color: COLORS.error, ...FONTS.medium },
});
