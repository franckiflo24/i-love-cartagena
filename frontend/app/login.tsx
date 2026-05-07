import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator,
  Modal, TextInput, KeyboardAvoidingView, Platform, Alert, ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/context/AuthContext';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLang } from '../src/context/LanguageContext';
import { Lang, LANG_FLAGS } from '../src/i18n/translations';

const LANG_CODES: Record<Lang, string> = { es: 'ES', en: 'EN', fr: 'FR', pt: 'PT' };

export default function LoginScreen() {
  const { user, isLoading, login } = useAuth();
  const router = useRouter();
  const { s, lang, setLang } = useLang();

  const [showSignup, setShowSignup] = useState(false);
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [savingSignup, setSavingSignup] = useState(false);

  useEffect(() => {
    if (user && !isLoading) {
      router.replace('/(tabs)');
    }
  }, [user, isLoading]);

  // Auto-fill signup with previously cached info if any
  useEffect(() => {
    AsyncStorage.getItem('user_data').then((raw) => {
      if (raw) {
        try {
          const u = JSON.parse(raw);
          if (u?.email) setSignupEmail(u.email);
          if (u?.name) setSignupName(u.name);
        } catch {}
      }
    });
  }, []);

  const handleEmailSignup = async () => {
    const email = signupEmail.trim();
    const name = signupName.trim() || email.split('@')[0];
    if (!email || !email.includes('@')) {
      Alert.alert('Email inválido', 'Por favor introduce un email válido.');
      return;
    }
    setSavingSignup(true);
    // Local guest profile (auto-saved). Will be merged on real Google login later.
    const localUser = {
      user_id: `local_${Date.now()}`,
      email,
      name,
      picture: '',
      provider: 'email_local',
    };
    await AsyncStorage.setItem('user_data', JSON.stringify(localUser));
    await AsyncStorage.setItem('local_user_email', email);
    setSavingSignup(false);
    setShowSignup(false);
    // Hard reload so AuthContext picks up the cached user
    router.replace('/(tabs)');
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Image
        source={{ uri: 'https://static.prod-images.emergentagent.com/jobs/32dad071-4fb0-440b-90c6-bb16ae39bea1/images/2dee6fa4415e057ea67df10585454bc47023ea1133b28fa1c91e8ee307f1d323.png' }}
        style={styles.heroImage}
      />
      <View style={styles.overlay} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Compact language pills - top right */}
        <View style={styles.langRow}>
          {(Object.keys(LANG_CODES) as Lang[]).map((l) => {
            const isActive = lang === l;
            return (
              <TouchableOpacity
                key={l}
                style={[styles.langPill, isActive && styles.langPillActive]}
                onPress={() => setLang(l)}
                activeOpacity={0.85}
              >
                <Text style={styles.langFlag}>{LANG_FLAGS[l]}</Text>
                <Text style={[styles.langCode, isActive && styles.langCodeActive]}>
                  {LANG_CODES[l]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Logo / hero area */}
        <View style={styles.logoArea}>
          <Text style={styles.logoMain}>AMO</Text>
          <Text style={styles.logoMain}>CARTAGENA</Text>
          <Text style={styles.logoHeart}>❤️</Text>
          <View style={styles.divider} />
          <Text style={styles.tagline}>{s('login_tagline')}</Text>
        </View>

        {/* Auth area - well organized */}
        <View style={styles.bottomArea}>
          <Text style={styles.welcomeText}>{s('login_welcome')}</Text>

          {/* PRIMARY: Continue with Google */}
          <TouchableOpacity
            testID="login-google-btn"
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

          {/* SECONDARY: Other methods */}
          <View style={styles.otherMethodsRow}>
            {Platform.OS === 'ios' && (
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={login}
                activeOpacity={0.85}
              >
                <Ionicons name="logo-apple" size={20} color={COLORS.white} />
                <Text style={styles.iconBtnText}>Apple</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.iconBtn, { flex: 1 }]}
              onPress={() => setShowSignup(true)}
              activeOpacity={0.85}
            >
              <Ionicons name="mail-outline" size={18} color={COLORS.white} />
              <Text style={styles.iconBtnText}>{s('login_email_signup')}</Text>
            </TouchableOpacity>
          </View>

          {/* TERTIARY: Already have account? Sign in */}
          <View style={styles.haveAccountRow}>
            <Text style={styles.haveAccountText}>{s('login_have_account')}</Text>
            <TouchableOpacity onPress={login} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8 }}>
              <Text style={styles.signInLink}>{s('login_sign_in')}</Text>
            </TouchableOpacity>
          </View>

          {/* Guest */}
          <TouchableOpacity
            testID="explore-guest-btn"
            onPress={() => router.replace('/(tabs)')}
            activeOpacity={0.7}
            hitSlop={{ top: 6, bottom: 6 }}
          >
            <Text style={styles.guestLink}>{s('login_guest')}</Text>
          </TouchableOpacity>

          <Text style={styles.disclaimer}>{s('login_terms')}</Text>
        </View>
      </ScrollView>

      {/* Email signup modal */}
      <Modal
        visible={showSignup}
        animationType="slide"
        transparent
        onRequestClose={() => setShowSignup(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{s('login_signup_title')}</Text>
            <Text style={styles.modalSubtitle}>{s('login_signup_subtitle')}</Text>

            <View style={styles.inputWrap}>
              <Ionicons name="person-outline" size={18} color={COLORS.textMuted} />
              <TextInput
                style={styles.input}
                placeholder={s('login_name_placeholder')}
                placeholderTextColor={COLORS.textMuted}
                value={signupName}
                onChangeText={setSignupName}
                autoCapitalize="words"
              />
            </View>
            <View style={styles.inputWrap}>
              <Ionicons name="mail-outline" size={18} color={COLORS.textMuted} />
              <TextInput
                style={styles.input}
                placeholder={s('login_email_placeholder')}
                placeholderTextColor={COLORS.textMuted}
                value={signupEmail}
                onChangeText={setSignupEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>

            <TouchableOpacity
              style={[styles.modalSaveBtn, savingSignup && { opacity: 0.6 }]}
              onPress={handleEmailSignup}
              disabled={savingSignup}
              activeOpacity={0.85}
            >
              {savingSignup ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={18} color={COLORS.white} />
                  <Text style={styles.modalSaveBtnText}>{s('login_save')}</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={() => setShowSignup(false)}
              activeOpacity={0.85}
            >
              <Text style={styles.modalCancelText}>{s('login_cancel')}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingContainer: { flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center' },
  heroImage: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(5, 8, 20, 0.78)' },

  scroll: { flexGrow: 1, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.lg, justifyContent: 'space-between' },

  // Compact lang pills - small and unobtrusive at top right
  langRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 6,
    paddingTop: SPACING.xs,
  },
  langPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: RADIUS.full,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  langPillActive: {
    backgroundColor: 'rgba(217,119,6,0.25)',
    borderColor: COLORS.primary,
  },
  langFlag: { fontSize: 14 },
  langCode: { fontSize: 11, color: 'rgba(255,255,255,0.7)', ...FONTS.bold, letterSpacing: 0.4 },
  langCodeActive: { color: COLORS.white },

  logoArea: { alignItems: 'center', marginTop: SPACING.lg },
  logoHeart: { fontSize: 40, marginVertical: SPACING.xs },
  logoMain: { fontSize: 38, letterSpacing: 2, color: COLORS.textMain, ...FONTS.bold, marginTop: SPACING.xs },
  divider: { width: 60, height: 2, backgroundColor: COLORS.primary, marginTop: SPACING.md, borderRadius: 1 },
  tagline: { fontSize: 14, color: COLORS.textMuted, marginTop: SPACING.md, ...FONTS.light, letterSpacing: 1, textAlign: 'center' },

  bottomArea: { gap: SPACING.sm, marginTop: SPACING.lg },
  welcomeText: { fontSize: 14, color: COLORS.textMuted, textAlign: 'center', lineHeight: 22, ...FONTS.regular, marginBottom: SPACING.sm },

  // Primary CTA
  googleButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.primary, borderRadius: RADIUS.full,
    paddingVertical: 15, paddingHorizontal: SPACING.xl, width: '100%', gap: SPACING.sm,
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 6,
  },
  googleButtonText: { fontSize: 16, color: COLORS.white, ...FONTS.bold },

  // OR divider
  orRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginVertical: SPACING.xs },
  orLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.15)' },
  orText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, letterSpacing: 0.4, textTransform: 'uppercase' },

  // Other methods
  otherMethodsRow: { flexDirection: 'row', gap: SPACING.sm },
  iconBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: RADIUS.full,
    paddingVertical: 12,
  },
  iconBtnText: { fontSize: 13, color: COLORS.white, ...FONTS.semibold },

  // Have account?
  haveAccountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: SPACING.sm,
  },
  haveAccountText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular },
  signInLink: { fontSize: 13, color: COLORS.primary, ...FONTS.bold, textDecorationLine: 'underline' },

  guestLink: {
    fontSize: 12,
    color: COLORS.textMuted,
    ...FONTS.medium,
    textAlign: 'center',
    marginTop: SPACING.sm,
    opacity: 0.85,
  },
  disclaimer: { fontSize: 11, color: COLORS.textMuted, textAlign: 'center', marginTop: SPACING.sm, opacity: 0.6, lineHeight: 16 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: SPACING.lg,
    paddingBottom: SPACING.xl,
    gap: SPACING.sm,
  },
  modalHandle: { width: 44, height: 4, borderRadius: 2, backgroundColor: COLORS.border, alignSelf: 'center' },
  modalTitle: { fontSize: 20, color: COLORS.textMain, ...FONTS.bold, marginTop: SPACING.sm },
  modalSubtitle: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, marginBottom: SPACING.sm },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.background,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.sm,
  },
  input: { flex: 1, fontSize: 14, color: COLORS.textMain, ...FONTS.regular, paddingVertical: 12 },
  modalSaveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COLORS.primary, borderRadius: RADIUS.full,
    paddingVertical: 14, marginTop: SPACING.sm,
  },
  modalSaveBtnText: { fontSize: 15, color: COLORS.white, ...FONTS.bold },
  modalCancelBtn: { alignItems: 'center', paddingVertical: 10, marginTop: 4 },
  modalCancelText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.medium },
});
