import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { Alert } from '../../src/lib/alert';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { useBusinessAuth } from '../../src/context/BusinessAuthContext';
import { useTr } from '../../src/i18n/autoTr';

// B1A — Self-serve partner account signup. A partner account is a SEPARATE
// namespace from tourist end-users; creating one grants no consumer-app data.
export default function BusinessSignup() {
  const tr = useTr();
  const router = useRouter();
  const { signup } = useBusinessAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [nit, setNit] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    if (!email || !password) {
      Alert.alert(tr('Faltan datos'), tr('Ingresa tu email y una contraseña'));
      return;
    }
    if (nit.replace(/\D/g, '').length < 5) {
      Alert.alert(tr('NIT requerido'), tr('Ingresa el NIT o registro de tu negocio para confirmarlo'));
      return;
    }
    if (password.length < 8) {
      Alert.alert(tr('Contraseña muy corta'), tr('La contraseña debe tener al menos 8 caracteres'));
      return;
    }
    setLoading(true);
    try {
      await signup(email.trim().toLowerCase(), password, name.trim(), phone.trim(), nit.trim());
      // New account has no venue yet → go find/claim it.
      router.replace('/business/find' as any);
    } catch (e: any) {
      Alert.alert(tr('No se pudo crear la cuenta'), e?.message || tr('Intenta de nuevo'));
    }
    setLoading(false);
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
            <Ionicons name="storefront" size={40} color={COLORS.primary} />
          </View>
          <Text style={styles.title}>{tr('Registra tu negocio')}</Text>
          <Text style={styles.subtitle}>{tr('Crea tu cuenta gratis. Luego busca tu negocio en el catálogo y verifica que eres el dueño.')}</Text>

          <View style={styles.form}>
            <Text style={styles.label}>{tr('Nombre del negocio o responsable')}</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="person-outline" size={18} color={COLORS.textMuted} />
              <TextInput style={styles.input} value={name} onChangeText={setName} placeholder={tr('Ej: Carmen / Ana Pérez')} placeholderTextColor={COLORS.textMuted} />
            </View>

            <Text style={styles.label}>Email</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="mail-outline" size={18} color={COLORS.textMuted} />
              <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="tu@negocio.com" placeholderTextColor={COLORS.textMuted} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
            </View>

            <Text style={styles.label}>{tr('Teléfono')} ({tr('opcional')})</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="call-outline" size={18} color={COLORS.textMuted} />
              <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="+57 300 000 0000" placeholderTextColor={COLORS.textMuted} keyboardType="phone-pad" />
            </View>

            <Text style={styles.label}>{tr('NIT o registro del negocio')}</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="document-text-outline" size={18} color={COLORS.textMuted} />
              <TextInput style={styles.input} value={nit} onChangeText={setNit} placeholder={tr('Ej: 900.123.456-7')} placeholderTextColor={COLORS.textMuted} autoCapitalize="none" autoCorrect={false} />
            </View>

            <Text style={styles.label}>{tr('Contraseña')}</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="lock-closed-outline" size={18} color={COLORS.textMuted} />
              <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder={tr('Mínimo 8 caracteres')} placeholderTextColor={COLORS.textMuted} secureTextEntry={!showPw} />
              <TouchableOpacity onPress={() => setShowPw(s => !s)}>
                <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={[styles.btn, loading && { opacity: 0.6 }]} onPress={handle} disabled={loading}>
              {loading ? <ActivityIndicator size="small" color={COLORS.white} /> : (
                <>
                  <Text style={styles.btnText}>{tr('Crear cuenta')}</Text>
                  <Ionicons name="arrow-forward" size={18} color={COLORS.white} />
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.replace('/business/login' as any)}>
              <Text style={styles.loginLink}>{tr('Ya tengo cuenta — Iniciar sesión')}</Text>
            </TouchableOpacity>
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
  heroIcon: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(245,11,27,0.15)', borderWidth: 1.5, borderColor: COLORS.primary, marginTop: SPACING.md },
  title: { fontSize: 24, color: COLORS.textMain, ...FONTS.bold, marginTop: SPACING.lg, textAlign: 'center' },
  subtitle: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', lineHeight: 20, paddingHorizontal: SPACING.sm, marginTop: SPACING.xs },
  form: { width: '100%', marginTop: SPACING.lg, gap: SPACING.xs },
  label: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: SPACING.sm },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: SPACING.md, height: 50 },
  input: { flex: 1, color: COLORS.textMain, fontSize: 14, ...FONTS.regular },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 14, marginTop: SPACING.lg },
  btnText: { color: COLORS.white, fontSize: 14, ...FONTS.bold },
  loginLink: { textAlign: 'center', color: COLORS.primary, fontSize: 13, ...FONTS.semibold, marginTop: SPACING.md },
});
