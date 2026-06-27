import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator,
  Modal, TextInput, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../src/context/AuthContext';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { api } from '../src/constants/api';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLang } from '../src/context/LanguageContext';
import { Lang, LANG_FLAGS } from '../src/i18n/translations';

const LANG_CODES: Record<Lang, string> = { es: 'ES', en: 'EN', fr: 'FR', pt: 'PT' };

export default function LoginScreen() {
  const { user, isLoading, login, loginWithToken } = useAuth();
  const router = useRouter();
  const { s, lang, setLang } = useLang();
  const { next } = useLocalSearchParams<{ next?: string }>();

  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showSignup, setShowSignup] = useState(false);
  const [showWhatsapp, setShowWhatsapp] = useState(false);
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPhone, setSignupPhone] = useState('');
  const [savingSignup, setSavingSignup] = useState(false);
  const [loginError, setLoginError] = useState('');

  useEffect(() => {
    if (user && !isLoading) {
      if (typeof next === 'string' && next.startsWith('/')) {
        router.replace(next as any);
      } else {
        router.replace('/(tabs)');
      }
    }
  }, [user, isLoading, next]);

  // Auto-fill signup with previously cached info if any
  useEffect(() => {
    AsyncStorage.getItem('user_data').then((raw) => {
      if (raw) {
        try {
          const u = JSON.parse(raw);
          if (u?.email) setSignupEmail(u.email);
          if (u?.name) setSignupName(u.name);
          if (u?.phone) setSignupPhone(u.phone);
        } catch { /* malformed stored user_data */ }
      }
    });
  }, []);

  const storeSessionToken = async (token: string) => {
    if (Platform.OS === 'web') {
      await AsyncStorage.setItem('session_token', token);
    } else {
      await SecureStore.setItemAsync('session_token', token);
    }
  };

  const handleEmailSignup = async () => {
    const email = signupEmail.trim();
    const name = signupName.trim() || email.split('@')[0];
    if (!email || !email.includes('@')) {
      setLoginError('Email inválido. Por favor introduce un email válido.');
      return;
    }
    setLoginError('');
    setSavingSignup(true);
    try {
      const res = await api.post('/auth/demo-login', { email, name, provider: 'email_local', signup_code: '' });
      if (res.session_token && res.user) {
        await loginWithToken(res.session_token, res.user);
        setSavingSignup(false);
        setShowSignup(false);
        router.replace('/(tabs)');
        return;
      }
      // Backend responded but missing expected fields
      setLoginError('Error de autenticación. Respuesta inesperada del servidor.');
      console.error('[Login] email signup: missing session_token or user in response', res);
    } catch (e: any) {
      console.error('[Login] email signup error', e);
      const msg = e?.message || '';
      setLoginError(msg.includes('403') ? 'Esta cuenta usa otro método de inicio de sesión.' : 'No se pudo crear la cuenta. Intenta de nuevo.');
    }
    setSavingSignup(false);
    setShowSignup(false);
  };

  const handleWhatsappSignup = async () => {
    const phoneRaw = signupPhone.trim().replace(/[^\d+]/g, '');
    const phone = phoneRaw.startsWith('+') ? phoneRaw : `+${phoneRaw}`;
    const name = signupName.trim() || `Usuario ${phone.slice(-4)}`;
    if (!phone || phone.length < 8) {
      setLoginError('Teléfono inválido. Por favor introduce un número de WhatsApp válido.');
      return;
    }
    setLoginError('');
    setSavingSignup(true);
    try {
      const pseudoEmail = `${phone.replace(/\+/g, '')}@wa.amo.local`;
      const res = await api.post('/auth/demo-login', { email: pseudoEmail, name, phone, provider: 'whatsapp_local', signup_code: '' });
      if (res.session_token && res.user) {
        await loginWithToken(res.session_token, res.user);
        setSavingSignup(false);
        setShowWhatsapp(false);
        router.replace('/(tabs)');
        return;
      }
      setLoginError('Error de autenticación. Respuesta inesperada del servidor.');
      console.error('[Login] whatsapp signup: missing session_token or user in response', res);
    } catch (e: any) {
      console.error('[Login] whatsapp signup error', e);
      setLoginError('No se pudo crear la cuenta. Intenta de nuevo.');
    }
    setSavingSignup(false);
    setShowWhatsapp(false);
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
        source={{ uri: 'https://website-five-sigma-29.vercel.app/images/login-cathedral.jpg' }}
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
          {/* Terms checkbox FIRST — users must see & accept before buttons enable */}
          <View style={styles.termsRow}>
            <TouchableOpacity
              onPress={() => setTermsAccepted(!termsAccepted)}
              style={[styles.checkbox, termsAccepted && styles.checkboxChecked]}
            >
              {termsAccepted && <Ionicons name="checkmark" size={14} color="#FFF" />}
            </TouchableOpacity>
            <Text style={styles.termsText}>
              {s('login_accept_terms')}{' '}
              <Text style={styles.termsLink} onPress={() => router.push('/terminos' as any)}>{s('login_terms_link')}</Text>
              {' '}{s('login_and')}{' '}
              <Text style={styles.termsLink} onPress={() => router.push('/privacidad' as any)}>{s('login_privacy_link')}</Text>
            </Text>
          </View>

          {!termsAccepted && (
            <Text style={styles.termsHint}>{s('login_accept_hint') || 'Acepta los términos para continuar'}</Text>
          )}

          {/* PRIMARY: Continue with Google */}
          <TouchableOpacity
            testID="login-google-btn"
            style={[styles.googleButton, !termsAccepted && styles.btnDisabled]}
            onPress={termsAccepted ? login : undefined}
            disabled={!termsAccepted}
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

          {/* SECONDARY: Other methods - stacked for clarity */}
          <View style={styles.otherMethodsCol}>
            <TouchableOpacity
              style={[styles.methodBtn, styles.whatsappBtn, !termsAccepted && styles.btnDisabled]}
              onPress={termsAccepted ? () => setShowWhatsapp(true) : undefined}
              disabled={!termsAccepted}
              activeOpacity={0.85}
            >
              <Ionicons name="logo-whatsapp" size={20} color={COLORS.white} />
              <Text style={styles.methodBtnText}>{s('login_whatsapp')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.methodBtn, styles.outlineMethodBtn, !termsAccepted && styles.btnDisabled]}
              onPress={termsAccepted ? () => setShowSignup(true) : undefined}
              disabled={!termsAccepted}
              activeOpacity={0.85}
            >
              <Ionicons name="mail-outline" size={18} color={COLORS.white} />
              <Text style={styles.methodBtnText}>{s('login_email_signup')}</Text>
            </TouchableOpacity>

            {Platform.OS === 'ios' && (
              <TouchableOpacity
                style={[styles.methodBtn, styles.appleBtn]}
                onPress={login}
                activeOpacity={0.85}
              >
                <Ionicons name="logo-apple" size={20} color={COLORS.white} />
                <Text style={styles.methodBtnText}>{s('login_apple')}</Text>
              </TouchableOpacity>
            )}
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

          {/* Login error display */}
          {loginError ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={16} color="#EF4444" />
              <Text style={styles.errorText}>{loginError}</Text>
            </View>
          ) : null}
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

      {/* WhatsApp signup modal */}
      <Modal
        visible={showWhatsapp}
        animationType="slide"
        transparent
        onRequestClose={() => setShowWhatsapp(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHandle} />
            <View style={styles.waHeaderRow}>
              <View style={styles.waIconCircle}>
                <Ionicons name="logo-whatsapp" size={24} color={COLORS.white} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>{s('login_whatsapp_title')}</Text>
                <Text style={styles.modalSubtitle}>{s('login_whatsapp_subtitle')}</Text>
              </View>
            </View>

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
              <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
              <TextInput
                style={styles.input}
                placeholder={s('login_phone_placeholder')}
                placeholderTextColor={COLORS.textMuted}
                value={signupPhone}
                onChangeText={setSignupPhone}
                keyboardType="phone-pad"
              />
            </View>

            <TouchableOpacity
              style={[styles.modalSaveBtn, styles.modalWaBtn, savingSignup && { opacity: 0.6 }]}
              onPress={handleWhatsappSignup}
              disabled={savingSignup}
              activeOpacity={0.85}
            >
              {savingSignup ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <>
                  <Ionicons name="logo-whatsapp" size={18} color={COLORS.white} />
                  <Text style={styles.modalSaveBtnText}>{s('login_save')}</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={() => setShowWhatsapp(false)}
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
  btnDisabled: { opacity: 0.35 },
  termsHint: {
    fontSize: 12,
    color: COLORS.primary,
    ...FONTS.medium,
    textAlign: 'center',
    marginTop: -4,
    marginBottom: 2,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderRadius: RADIUS.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: SPACING.sm,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
  },
  errorText: { flex: 1, fontSize: 13, color: '#FCA5A5', ...FONTS.medium, lineHeight: 18 },
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: SPACING.md, marginBottom: SPACING.sm },
  checkbox: { width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: COLORS.textMuted, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkboxChecked: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  termsText: { flex: 1, fontSize: 12, color: COLORS.textMuted, lineHeight: 18 },
  termsLink: { color: COLORS.primary, textDecorationLine: 'underline' },

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
  modalWaBtn: { backgroundColor: '#25D366' },
  modalSaveBtnText: { fontSize: 15, color: COLORS.white, ...FONTS.bold },
  modalCancelBtn: { alignItems: 'center', paddingVertical: 10, marginTop: 4 },
  modalCancelText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.medium },

  // WhatsApp modal header
  waHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  waIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
