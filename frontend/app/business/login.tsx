import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { useBusinessAuth } from '../../src/context/BusinessAuthContext';
import { useTr } from '../../src/i18n/autoTr';

export default function BusinessLogin() {
  const tr = useTr();
  const router = useRouter();
  const { role } = useLocalSearchParams<{ role?: string }>();
  const { login, passcodeLogin } = useBusinessAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passcode, setPasscode] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  // Inline, VISIBLE error. Alert.alert is a silent no-op on react-native-web, so a
  // failed login (401/429/missing fields) showed nothing — the "no error, no login"
  // bug. Every failure branch now writes here and renders in a banner.
  const [error, setError] = useState<string | null>(null);

  const isAlcaldia = role === 'alcaldia';

  useEffect(() => {
    if (isAlcaldia) {
      setEmail('alcaldia@amocartagena.app');
    }
  }, [isAlcaldia]);

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Ingresa tu email y contraseña. / Enter your email and password.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
      router.replace('/business/dashboard');
    } catch (e: any) {
      // Backend detail is bilingual and non-enumerating (same "Credenciales
      // inválidas" for wrong email or wrong password) — show it verbatim.
      setError(e?.message || 'Credenciales inválidas / Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const handleAlcaldia = async () => {
    if (!passcode.trim()) {
      setError(tr('Ingresa el código de acceso'));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await passcodeLogin(passcode);
      router.replace('/business/dashboard');
    } catch (e: any) {
      setError(e?.message || tr('Código incorrecto'));
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = () => {
    // Sandbox demo account — a throwaway venue, not a real partner. Safe to ship
    // in the bundle: it only reaches the demo dashboard, never real data.
    setEmail('demo@amocartagena.app');
    setPassword('AmoDemoSandbox2026');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={[styles.heroIcon, isAlcaldia && styles.heroIconAlcaldia]}>
            <Ionicons name={isAlcaldia ? 'shield-checkmark' : 'business'} size={42} color={isAlcaldia ? '#1B4F72' : COLORS.primary} />
          </View>
          <Text style={styles.title}>{isAlcaldia ? tr('Alcaldía de Cartagena') : tr('Acceso Partners')}</Text>
          <Text style={styles.subtitle}>
            {isAlcaldia
              ? tr('Acceso institucional al dashboard oficial de la ciudad.')
              : tr('Gestiona tu agenda, publica eventos y monitorea reservas en Amo Cartagena.')}
          </Text>

          <View style={styles.form}>
            {error ? (
              <View style={styles.errorBox} accessibilityRole="alert" accessibilityLiveRegion="assertive">
                <Ionicons name="alert-circle" size={18} color="#EF4444" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
            {isAlcaldia ? (
              <>
                <Text style={styles.label}>{tr('Código de acceso')}</Text>
                <View style={styles.inputWrap}>
                  <Ionicons name="key-outline" size={18} color={COLORS.textMuted} />
                  <TextInput
                    style={[styles.input, { letterSpacing: 4 }]}
                    value={passcode}
                    onChangeText={(t) => { setPasscode(t); if (error) setError(null); }}
                    placeholder="••••••••••"
                    placeholderTextColor={COLORS.textMuted}
                    keyboardType="number-pad"
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={24}
                    returnKeyType="go"
                    onSubmitEditing={handleAlcaldia}
                  />
                </View>
                <TouchableOpacity style={[styles.loginBtn, styles.alcaldiaLoginBtn, loading && { opacity: 0.6 }]} onPress={handleAlcaldia} disabled={loading}>
                  {loading ? (
                    <ActivityIndicator size="small" color={COLORS.white} />
                  ) : (
                    <>
                      <Text style={styles.loginText}>{tr('Entrar')}</Text>
                      <Ionicons name="arrow-forward" size={18} color={COLORS.white} />
                    </>
                  )}
                </TouchableOpacity>
                <View style={styles.lockNote}>
                  <Ionicons name="lock-closed" size={13} color={COLORS.textMuted} />
                  <Text style={styles.lockNoteText}>{tr('Acceso solo con código. Solicítalo al equipo AMO.')}</Text>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.label}>Email business</Text>
                <View style={styles.inputWrap}>
                  <Ionicons name="mail-outline" size={18} color={COLORS.textMuted} />
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={(t) => { setEmail(t); if (error) setError(null); }}
                    placeholder="tu@negocio.com"
                    placeholderTextColor={COLORS.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>

                <Text style={styles.label}>{tr('Contraseña')}</Text>
                <View style={styles.inputWrap}>
                  <Ionicons name="lock-closed-outline" size={18} color={COLORS.textMuted} />
                  <TextInput
                    style={styles.input}
                    value={password}
                    onChangeText={(t) => { setPassword(t); if (error) setError(null); }}
                    placeholder="••••••••"
                    placeholderTextColor={COLORS.textMuted}
                    secureTextEntry={!showPw}
                  />
                  <TouchableOpacity onPress={() => setShowPw(s => !s)}>
                    <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={18} color={COLORS.textMuted} />
                  </TouchableOpacity>
                </View>

                <TouchableOpacity style={[styles.loginBtn, loading && { opacity: 0.6 }]} onPress={handleLogin} disabled={loading}>
                  {loading ? (
                    <ActivityIndicator size="small" color={COLORS.white} />
                  ) : (
                    <>
                      <Text style={styles.loginText}>{tr('Entrar al dashboard')}</Text>
                      <Ionicons name="arrow-forward" size={18} color={COLORS.white} />
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity onPress={() => router.push('/business/forgot-password' as any)}>
                  <Text style={styles.forgotLink}>{tr('¿Olvidaste tu contraseña?')}</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={fillDemo}>
                  <Text style={styles.demoLink}>Probar con cuenta demo</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => router.push('/business/login?role=alcaldia' as any)} style={styles.alcaldiaBtn}>
                  <Ionicons name="shield-checkmark" size={14} color="#1B4F72" />
                  <Text style={styles.alcaldiaLink}>{tr('Acceso Alcaldía de Cartagena')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {!isAlcaldia && (
            <TouchableOpacity style={styles.signupBtn} onPress={() => router.push('/business/signup' as any)}>
              <Text style={styles.signupText}>{tr('¿No tienes cuenta?')} </Text>
              <Text style={styles.signupTextBold}>{tr('Registra tu negocio')}</Text>
              <Ionicons name="arrow-forward" size={14} color={COLORS.primary} />
            </TouchableOpacity>
          )}

          {/* Escape hatch back to the CONSUMER side — this is the partner login;
              a person who just wants to use the app as themselves goes straight to
              the personal login (Google / email), bypassing the partner-resume card. */}
          <TouchableOpacity style={styles.personalBtn} onPress={() => router.replace('/login' as any)}>
            <Ionicons name="person-circle-outline" size={16} color={COLORS.textMuted} />
            <Text style={styles.personalText}>{tr('¿Eres un usuario? Inicia sesión personal')}</Text>
            <Ionicons name="arrow-forward" size={13} color={COLORS.textMuted} />
          </TouchableOpacity>

          <View style={styles.helpBox}>
            <Ionicons name="information-circle-outline" size={16} color={COLORS.textMuted} />
            <Text style={styles.helpText}>
              {tr('Crea tu cuenta gratis, busca tu negocio en el catálogo y verifica que eres el dueño para gestionarlo.')}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', paddingHorizontal: SPACING.md, paddingTop: SPACING.sm },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  scroll: { padding: SPACING.lg, alignItems: 'center' },
  heroIcon: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(18,181,165,0.15)', borderWidth: 1.5, borderColor: COLORS.primary, marginTop: SPACING.lg },
  heroIconAlcaldia: { backgroundColor: 'rgba(27,79,114,0.18)', borderColor: '#1B4F72' },
  title: { fontSize: 26, color: COLORS.textMain, ...FONTS.bold, marginTop: SPACING.lg, textAlign: 'center' },
  subtitle: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', lineHeight: 20, paddingHorizontal: SPACING.md, marginTop: SPACING.xs },
  form: { width: '100%', marginTop: SPACING.xl, gap: SPACING.sm },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.md, backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(239,68,68,0.5)' },
  errorText: { flex: 1, color: '#FCA5A5', fontSize: 13, ...FONTS.semibold, lineHeight: 18 },
  label: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: SPACING.sm },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: SPACING.md, height: 50 },
  input: { flex: 1, color: COLORS.textMain, fontSize: 14, ...FONTS.regular },
  loginBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 14, marginTop: SPACING.md },
  loginText: { color: COLORS.white, fontSize: 14, ...FONTS.bold },
  forgotLink: { textAlign: 'center', color: COLORS.textMuted, fontSize: 13, ...FONTS.regular, marginTop: SPACING.md },
  demoLink: { textAlign: 'center', color: COLORS.primary, fontSize: 13, ...FONTS.semibold, marginTop: SPACING.sm },
  alcaldiaBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, marginTop: SPACING.xs, backgroundColor: 'rgba(27,79,114,0.12)', borderWidth: 1, borderColor: '#1B4F72', borderRadius: RADIUS.full },
  alcaldiaLink: { color: '#1B4F72', fontSize: 12, ...FONTS.bold, letterSpacing: 0.3 },
  alcaldiaLoginBtn: { backgroundColor: '#1B4F72' },
  lockNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: SPACING.md },
  lockNoteText: { color: COLORS.textMuted, fontSize: 12, ...FONTS.regular },
  signupBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: SPACING.lg },
  signupText: { color: COLORS.textMuted, fontSize: 13, ...FONTS.regular },
  signupTextBold: { color: COLORS.primary, fontSize: 13, ...FONTS.bold },
  personalBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, marginTop: SPACING.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.full },
  personalText: { color: COLORS.textMain, fontSize: 13, ...FONTS.bold },
  helpBox: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, marginTop: SPACING.lg, width: '100%' },
  helpText: { flex: 1, fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 18 },
});
