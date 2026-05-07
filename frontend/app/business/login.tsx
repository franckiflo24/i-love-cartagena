import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { useBusinessAuth } from '../../src/context/BusinessAuthContext';

export default function BusinessLogin() {
  const router = useRouter();
  const { login } = useBusinessAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Faltan datos', 'Por favor ingresa tu email y contraseña');
      return;
    }
    setLoading(true);
    try {
      await login(email.trim(), password);
      router.replace('/business/dashboard');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Credenciales inválidas');
    }
    setLoading(false);
  };

  const fillDemo = () => {
    setEmail('casaboheme@amocartagena.app');
    setPassword('amocartagena2026');
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
          <View style={styles.heroIcon}>
            <Ionicons name="business" size={42} color={COLORS.primary} />
          </View>
          <Text style={styles.title}>Acceso Partners</Text>
          <Text style={styles.subtitle}>
            Gestiona tu agenda, publica eventos y monitorea reservas en Amo Cartagena.
          </Text>

          <View style={styles.form}>
            <Text style={styles.label}>Email business</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="mail-outline" size={18} color={COLORS.textMuted} />
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="tu@negocio.com"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <Text style={styles.label}>Contraseña</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="lock-closed-outline" size={18} color={COLORS.textMuted} />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
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
                  <Text style={styles.loginText}>Entrar al dashboard</Text>
                  <Ionicons name="arrow-forward" size={18} color={COLORS.white} />
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={fillDemo}>
              <Text style={styles.demoLink}>Probar con cuenta demo</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.helpBox}>
            <Ionicons name="information-circle-outline" size={16} color={COLORS.textMuted} />
            <Text style={styles.helpText}>
              ¿No tienes cuenta business? Contáctanos a partners@amocartagena.app y un asesor te asignará tu cuenta.
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
  heroIcon: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(217,119,6,0.15)', borderWidth: 1.5, borderColor: COLORS.primary, marginTop: SPACING.lg },
  title: { fontSize: 26, color: COLORS.textMain, ...FONTS.bold, marginTop: SPACING.lg, textAlign: 'center' },
  subtitle: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', lineHeight: 20, paddingHorizontal: SPACING.md, marginTop: SPACING.xs },
  form: { width: '100%', marginTop: SPACING.xl, gap: SPACING.sm },
  label: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: SPACING.sm },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: SPACING.md, height: 50 },
  input: { flex: 1, color: COLORS.textMain, fontSize: 14, ...FONTS.regular },
  loginBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 14, marginTop: SPACING.md },
  loginText: { color: COLORS.white, fontSize: 14, ...FONTS.bold },
  demoLink: { textAlign: 'center', color: COLORS.primary, fontSize: 13, ...FONTS.semibold, marginTop: SPACING.sm },
  helpBox: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, marginTop: SPACING.xl, width: '100%' },
  helpText: { flex: 1, fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 18 },
});
