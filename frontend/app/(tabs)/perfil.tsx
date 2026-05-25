import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS, EVENT_TYPE_LABELS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useAuth } from '../../src/context/AuthContext';
import { useLang } from '../../src/context/LanguageContext';
import { LANG_LABELS, LANG_FLAGS, Lang } from '../../src/i18n/translations';
import { useFavorites } from '../../src/context/FavoritesContext';
import { useTr } from '../../src/i18n/autoTr';

const LANG_CODES: Record<Lang, string> = { es: 'ES', en: 'EN', fr: 'FR', pt: 'PT' };

type Event = {
  event_id: string; title: string; date: string; start_time: string;
  end_time: string; venue_name: string; type: string; is_free: boolean;
  price: number; image_url: string;
};

export default function PerfilScreen() {
  const tr = useTr();
  const router = useRouter();
  const { user, login, logout } = useAuth();
  const { lang, setLang, s } = useLang();
  const { favorites: favIds } = useFavorites();
  const [favorites, setFavorites] = useState<Event[]>([]);
  const [myWeek, setMyWeek] = useState<Event[]>([]);
  const [activeTab, setActiveTab] = useState<'week' | 'favorites'>('week');
  const [loading, setLoading] = useState(false);
  const [aiProfile, setAiProfile] = useState<any>(null);
  const [profileBuilding, setProfileBuilding] = useState(false);

  const loadAiProfile = async () => {
    if (!user?.user_id) return;
    try {
      const data = await api.get(`/profile/me?user_id=${user.user_id}`);
      setAiProfile(data);
    } catch (e) { /* silent */ }
  };

  const buildAiProfile = async () => {
    if (!user?.user_id) return;
    if (favIds.length < 2) return;
    setProfileBuilding(true);
    try {
      const data = await api.post('/profile/build', {
        user_id: user.user_id,
        favorites: favIds,
      });
      setAiProfile(data);
    } catch (e) { console.error(e); }
    setProfileBuilding(false);
  };

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
      loadAiProfile();
    }
  }, [user]);

  // Refresh AI profile when favorites change (in addition to passive auto-build via context)
  useEffect(() => {
    if (user && favIds.length >= 2) {
      const timer = setTimeout(loadAiProfile, 4000); // wait for context-driven build
      return () => clearTimeout(timer);
    }
  }, [favIds.length, user]);

  if (!user) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.guestScroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Compact language pills - top right, one row */}
          <View style={styles.langPillsRow}>
            {(Object.keys(LANG_CODES) as Lang[]).map((l) => {
              const isActive = lang === l;
              return (
                <TouchableOpacity
                  key={l}
                  testID={`guest-lang-${l}`}
                  style={[styles.langPill, isActive && styles.langPillActive]}
                  onPress={() => setLang(l)}
                  activeOpacity={0.85}
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                >
                  <Text style={styles.langPillFlag}>{LANG_FLAGS[l]}</Text>
                  <Text style={[styles.langPillCode, isActive && styles.langPillCodeActive]}>
                    {LANG_CODES[l]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Welcome header */}
          <View style={styles.guestHero}>
            <View style={styles.guestAvatarCircle}>
              <Ionicons name="person-circle-outline" size={56} color={COLORS.primary} />
            </View>
            <Text style={styles.guestTitle}>{s('profile_login')}</Text>
            <Text style={styles.guestSubtitle}>{tr('Inicia sesión para guardar favoritos, recibir recomendaciones IA y acceder a tu City Pass.')}</Text>
          </View>

          {/* PRIMARY: Continue with Google */}
          <TouchableOpacity
            testID="profile-login-google"
            style={styles.googleButton}
            onPress={login}
            activeOpacity={0.85}
          >
            <Ionicons name="logo-google" size={20} color={COLORS.white} />
            <Text style={styles.googleButtonText}>{s('login_google')}</Text>
          </TouchableOpacity>

          {/* OR divider */}
          <View style={styles.orRow}>
            <View style={styles.orLine} />
            <Text style={styles.orText}>{s('login_other_methods')}</Text>
            <View style={styles.orLine} />
          </View>

          {/* SECONDARY: Other login methods */}
          <View style={styles.otherMethodsCol}>
            <TouchableOpacity
              testID="profile-login-whatsapp"
              style={[styles.methodBtn, styles.whatsappBtn]}
              onPress={() => router.push('/login')}
              activeOpacity={0.85}
            >
              <Ionicons name="logo-whatsapp" size={20} color={COLORS.white} />
              <Text style={styles.methodBtnText}>{s('login_whatsapp')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="profile-login-email"
              style={[styles.methodBtn, styles.outlineMethodBtn]}
              onPress={() => router.push('/login')}
              activeOpacity={0.85}
            >
              <Ionicons name="mail-outline" size={18} color={COLORS.white} />
              <Text style={styles.methodBtnText}>{s('login_email_signup')}</Text>
            </TouchableOpacity>

            {Platform.OS === 'ios' && (
              <TouchableOpacity
                testID="profile-login-apple"
                style={[styles.methodBtn, styles.appleBtn]}
                onPress={login}
                activeOpacity={0.85}
              >
                <Ionicons name="logo-apple" size={20} color={COLORS.white} />
                <Text style={styles.methodBtnText}>{s('login_apple')}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Section separator */}
          <View style={styles.sectionSep}>
            <Text style={styles.sectionSepText}>{tr('Accesos especiales')}</Text>
          </View>

          {/* Partner Access */}
          <TouchableOpacity
            testID="guest-partner-access"
            style={styles.specialCard}
            onPress={() => router.push('/business/login')}
            activeOpacity={0.85}
          >
            <View style={[styles.specialIconWrap, { backgroundColor: 'rgba(217,119,6,0.15)' }]}>
              <Ionicons name="business" size={22} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.specialTitle}>{tr('¿Eres partner de Amo Cartagena?')}</Text>
              <Text style={styles.specialDesc}>{tr('Accede a tu dashboard y publica eventos')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>

          {/* Alcaldía Access - Special profile */}
          <TouchableOpacity
            testID="guest-alcaldia-access"
            style={[styles.specialCard, styles.alcaldiaCard]}
            onPress={() => router.push('/business/login?role=alcaldia' as any)}
            activeOpacity={0.85}
          >
            <View style={[styles.specialIconWrap, { backgroundColor: 'rgba(59,130,246,0.18)' }]}>
              <Ionicons name="shield-checkmark" size={22} color="#3B82F6" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.specialTitle}>{tr('Alcaldía de Cartagena')}</Text>
              <Text style={styles.specialDesc}>{tr('Perfil institucional · Dashboard oficial')}</Text>
            </View>
            <View style={styles.officialBadge}>
              <Ionicons name="ribbon" size={10} color="#3B82F6" />
              <Text style={styles.officialBadgeText}>{tr('Oficial')}</Text>
            </View>
          </TouchableOpacity>

          {/* Help / Legal footer */}
          <View style={styles.footerLinksRow}>
            <TouchableOpacity onPress={() => router.push('/ayuda' as any)} style={styles.footerLink}>
              <Ionicons name="help-circle-outline" size={13} color={COLORS.textMuted} />
              <Text style={styles.footerLinkText}>{tr('Ayuda')}</Text>
            </TouchableOpacity>
            <Text style={styles.footerSep}>·</Text>
            <TouchableOpacity onPress={() => router.push('/terminos' as any)} style={styles.footerLink}>
              <Text style={styles.footerLinkText}>{tr('Términos')}</Text>
            </TouchableOpacity>
            <Text style={styles.footerSep}>·</Text>
            <TouchableOpacity onPress={() => router.push('/privacidad' as any)} style={styles.footerLink}>
              <Text style={styles.footerLinkText}>{tr('Privacidad')}</Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: SPACING.xl }} />
        </ScrollView>
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

        {/* AI Profile Card - generated from favorites by Emergent LLM */}
        <View style={styles.aiCard}>
          <View style={styles.aiCardHeader}>
            <View style={styles.aiBadge}>
              <Ionicons name="sparkles" size={12} color={COLORS.primary} />
              <Text style={styles.aiBadgeText}>IA · Tu perfil</Text>
            </View>
            <TouchableOpacity
              onPress={buildAiProfile}
              disabled={profileBuilding || favIds.length < 2}
              style={[styles.refreshAiBtn, (profileBuilding || favIds.length < 2) && { opacity: 0.4 }]}
            >
              {profileBuilding ? (
                <ActivityIndicator size="small" color={COLORS.primary} />
              ) : (
                <Ionicons name="refresh" size={14} color={COLORS.primary} />
              )}
            </TouchableOpacity>
          </View>

          {!aiProfile || aiProfile.ai_status === 'not_built' || (aiProfile.data_points || 0) === 0 ? (
            <View style={styles.aiEmpty}>
              <Ionicons name="heart-circle-outline" size={32} color={COLORS.textMuted} />
              <Text style={styles.aiEmptyTitle}>Tu perfil aún está vacío</Text>
              <Text style={styles.aiEmptyDesc}>
                Guarda al menos 2 lugares o eventos como favoritos y la IA construirá tu perfil personalizado.
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.aiPersona}>{aiProfile.persona_label}</Text>
              <Text style={styles.aiSummary}>{aiProfile.summary}</Text>

              {aiProfile.interests && aiProfile.interests.length > 0 && (
                <View style={styles.aiTagRow}>
                  {aiProfile.interests.slice(0, 6).map((tag: string, idx: number) => (
                    <View key={idx} style={styles.aiTag}>
                      <Text style={styles.aiTagText}>#{tag}</Text>
                    </View>
                  ))}
                </View>
              )}

              <View style={styles.aiStatsRow}>
                {aiProfile.preferred_budget && (
                  <View style={styles.aiStat}>
                    <Ionicons name="wallet-outline" size={12} color={COLORS.primary} />
                    <Text style={styles.aiStatText}>{aiProfile.preferred_budget}</Text>
                  </View>
                )}
                {aiProfile.preferred_time_slots && aiProfile.preferred_time_slots.length > 0 && (
                  <View style={styles.aiStat}>
                    <Ionicons name="time-outline" size={12} color={COLORS.primary} />
                    <Text style={styles.aiStatText}>{aiProfile.preferred_time_slots.join(' · ')}</Text>
                  </View>
                )}
                <View style={styles.aiStat}>
                  <Ionicons name="heart" size={12} color={COLORS.primary} />
                  <Text style={styles.aiStatText}>{aiProfile.data_points} señales</Text>
                </View>
              </View>
            </>
          )}
        </View>

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          {[
            { icon: 'notifications-outline', label: s('profile_notifications'), route: '/notifications' },
            { icon: 'calendar-outline', label: tr('Mis reservas'), route: '/reservations' },
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
            {(['es', 'en', 'fr', 'pt'] as Lang[]).map(l => {
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

        {/* Business Access (auth user) */}
        <TouchableOpacity style={styles.businessAccessCard} onPress={() => router.push('/business/login')} activeOpacity={0.85}>
          <View style={styles.businessIconWrap}>
            <Ionicons name="business" size={20} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.businessTitle}>{tr('Acceso Partners')}</Text>
            <Text style={styles.businessDesc}>Dashboard y gestión de eventos</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
        </TouchableOpacity>

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
          <Text style={styles.logoutText}>{tr('Cerrar sesión')}</Text>
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

  // AI Profile Card
  aiCard: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.primary + '40',
    gap: SPACING.xs,
  },
  aiCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.primary + '20',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.primary + '50',
  },
  aiBadgeText: { fontSize: 10, color: COLORS.primary, ...FONTS.bold, letterSpacing: 0.4 },
  refreshAiBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: COLORS.primary + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  aiPersona: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold, marginTop: 4 },
  aiSummary: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 19, marginTop: 2 },
  aiTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: SPACING.xs },
  aiTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  aiTagText: { fontSize: 10, color: COLORS.textMain, ...FONTS.semibold },
  aiStatsRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm,
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  aiStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  aiStatText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, textTransform: 'capitalize' },
  aiEmpty: { alignItems: 'center', paddingVertical: SPACING.md, gap: 6 },
  aiEmptyTitle: { fontSize: 13, color: COLORS.textMain, ...FONTS.bold, marginTop: 4 },
  aiEmptyDesc: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', lineHeight: 17, paddingHorizontal: SPACING.md },
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.lg, marginBottom: SPACING.lg },
  actionBtn: { alignItems: 'center', gap: SPACING.xs, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.sm, minWidth: 80, borderWidth: 1, borderColor: COLORS.border },
  actionLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
  langSection: { marginHorizontal: SPACING.lg, marginBottom: SPACING.lg },
  langSectionGuest: { paddingHorizontal: SPACING.xl, paddingBottom: SPACING.xl },
  langHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm },
  langTitle: { fontSize: 14, color: COLORS.textMuted, ...FONTS.semibold },
  langRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  langBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 12, borderRadius: RADIUS.lg, backgroundColor: COLORS.surface, borderWidth: 1.5, borderColor: COLORS.border, width: '47%' },
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

  // Business access card
  businessAccessCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: 'rgba(217,119,6,0.4)',
  },
  businessIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(217,119,6,0.15)',
  },
  businessTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  businessDesc: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },

  // ── Guest view (not logged in) ──
  guestScroll: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xs,
    paddingBottom: SPACING.xl,
  },
  langPillsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 6,
  },
  langPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: RADIUS.full,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  langPillActive: {
    backgroundColor: 'rgba(217,119,6,0.22)',
    borderColor: COLORS.primary,
  },
  langPillFlag: { fontSize: 13 },
  langPillCode: { fontSize: 10, color: 'rgba(255,255,255,0.7)', ...FONTS.bold, letterSpacing: 0.4 },
  langPillCodeActive: { color: COLORS.white },

  guestHero: {
    alignItems: 'center',
    marginTop: SPACING.lg,
    marginBottom: SPACING.lg,
    gap: SPACING.xs,
  },
  guestAvatarCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(217,119,6,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.xs,
    borderWidth: 1,
    borderColor: 'rgba(217,119,6,0.3)',
  },
  guestTitle: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold, textAlign: 'center' },
  guestSubtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    ...FONTS.regular,
    textAlign: 'center',
    lineHeight: 19,
    paddingHorizontal: SPACING.md,
  },

  googleButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.primary, borderRadius: RADIUS.full,
    paddingVertical: 14, paddingHorizontal: SPACING.xl, width: '100%', gap: SPACING.sm,
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 6,
  },
  googleButtonText: { fontSize: 16, color: COLORS.white, ...FONTS.bold },

  orRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginVertical: SPACING.sm },
  orLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.12)' },
  orText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, letterSpacing: 0.4, textTransform: 'uppercase' },

  otherMethodsCol: { gap: 10 },
  methodBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: RADIUS.full,
    paddingVertical: 13,
    width: '100%',
  },
  whatsappBtn: { backgroundColor: '#25D366' },
  outlineMethodBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  appleBtn: { backgroundColor: '#000000', borderWidth: 1, borderColor: '#1a1a1a' },
  methodBtnText: { fontSize: 14, color: COLORS.white, ...FONTS.semibold },

  sectionSep: {
    marginTop: SPACING.xl,
    marginBottom: SPACING.sm,
    alignItems: 'center',
  },
  sectionSepText: {
    fontSize: 11,
    color: COLORS.textMuted,
    ...FONTS.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  specialCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: 'rgba(217,119,6,0.3)',
    marginBottom: SPACING.sm,
  },
  alcaldiaCard: {
    borderColor: 'rgba(59,130,246,0.35)',
  },
  specialIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  specialTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  specialDesc: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },
  officialBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    backgroundColor: 'rgba(59,130,246,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.4)',
  },
  officialBadgeText: { fontSize: 9, color: '#3B82F6', ...FONTS.bold, letterSpacing: 0.4 },

  footerLinksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: SPACING.xl,
    marginBottom: SPACING.sm,
  },
  footerLink: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 4 },
  footerLinkText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.semibold },
  footerSep: { fontSize: 11, color: COLORS.textMuted },
});
