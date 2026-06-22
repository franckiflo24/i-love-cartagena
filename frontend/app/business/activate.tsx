import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';

export default function ActivatePartner() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [partner, setPartner] = useState<{ partner_id: string; name: string; category?: string; owner_email?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [accept, setAccept] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) { setError('Link inválido. Pide uno nuevo al equipo Amo Cartagena.'); setLoading(false); return; }
    (async () => {
      try {
        const data = await api.get(`/business/activation/${token}`);
        setPartner(data);
      } catch (e: any) {
        const msg = String(e?.message || '');
        setError(msg.includes('410') ? 'Este link expiró. Pide uno nuevo al equipo Amo Cartagena.' : 'Link inválido o ya usado.');
      }
      setLoading(false);
    })();
  }, [token]);

  const submit = async () => {
    if (!pw || pw.length < 8) { Alert.alert('Contraseña corta', 'Mínimo 8 caracteres.'); return; }
    if (pw !== pw2) { Alert.alert('No coinciden', 'Las contraseñas no son iguales.'); return; }
    if (!accept) { Alert.alert('Falta aceptar', 'Debes aceptar los términos para continuar.'); return; }
    setSubmitting(true);
    try {
      const data = await api.post('/business/activate', { token, password: pw, accept_terms: true });
      if (!data?.token) {
        Alert.alert('No disponible', 'La activación de cuentas requiere conexión al servidor. Contacta soporte@amocartagena.app');
        setSubmitting(false);
        return;
      }
      await AsyncStorage.setItem('amocartagena_business_token', data.token);
      Alert.alert(
        '¡Cuenta activada!',
        'Tu perfil ya está creado. Completa tus fotos, horarios y descripción para empezar a recibir reservas.',
        [{ text: 'Ir al dashboard', onPress: () => router.replace('/business/dashboard' as any) }]
      );
    } catch (e: any) {
      Alert.alert('Error', 'No pudimos activar tu cuenta. Reintenta o contacta soporte.');
    }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (error || !partner) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Ionicons name="warning" size={56} color="#EF4444" />
          <Text style={styles.errorTitle}>{error || 'Token inválido'}</Text>
          <TouchableOpacity style={styles.helpBtn} onPress={() => router.replace('/business/login' as any)}>
            <Text style={styles.helpBtnText}>Ya tengo cuenta — Iniciar sesión</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <Ionicons name="business" size={48} color={COLORS.primary} />
            <Text style={styles.welcome}>¡Bienvenido!</Text>
            <Text style={styles.partnerName}>{partner.name}</Text>
            <View style={styles.tag}>
              <Ionicons name="storefront" size={11} color={COLORS.primary} />
              <Text style={styles.tagText}>{(partner.category || 'partner').toUpperCase()}</Text>
            </View>
          </View>

          <Text style={styles.intro}>
            Te damos la bienvenida a <Text style={{ ...FONTS.bold }}>Amo Cartagena</Text>, la plataforma oficial de la ciudad.
            Crea tu contraseña para activar tu cuenta y empezar a gestionar reservas.
          </Text>

          <Text style={styles.lbl}>Tu correo</Text>
          <View style={[styles.input, { backgroundColor: 'rgba(255,255,255,0.04)' }]}>
            <Text style={{ fontSize: 14, color: COLORS.textMuted, ...FONTS.regular }}>{partner.owner_email}</Text>
          </View>

          <Text style={styles.lbl}>Crea tu contraseña (mín. 8 caracteres) *</Text>
          <View style={styles.inputRow}>
            <Ionicons name="lock-closed" size={16} color={COLORS.textMuted} />
            <TextInput style={styles.inputField} value={pw} onChangeText={setPw} placeholder="••••••••" placeholderTextColor={COLORS.textMuted} secureTextEntry={!showPw} autoCapitalize="none" />
            <TouchableOpacity onPress={() => setShowPw(!showPw)}>
              <Ionicons name={showPw ? 'eye-off' : 'eye'} size={16} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>

          <Text style={styles.lbl}>Repite tu contraseña *</Text>
          <View style={styles.inputRow}>
            <Ionicons name="lock-closed" size={16} color={COLORS.textMuted} />
            <TextInput style={styles.inputField} value={pw2} onChangeText={setPw2} placeholder="••••••••" placeholderTextColor={COLORS.textMuted} secureTextEntry={!showPw} autoCapitalize="none" />
          </View>

          <TouchableOpacity style={styles.checkRow} onPress={() => setAccept(!accept)} activeOpacity={0.85}>
            <View style={[styles.checkbox, accept && { backgroundColor: COLORS.primary, borderColor: COLORS.primary }]}>
              {accept && <Ionicons name="checkmark" size={14} color="#FFF" />}
            </View>
            <Text style={styles.checkText}>
              Acepto los <Text style={styles.link} onPress={() => router.push('/terminos' as any)}>Términos partner</Text> y la <Text style={styles.link} onPress={() => router.push('/privacidad' as any)}>Política de Privacidad</Text>.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.cta, (submitting || !accept) && { opacity: 0.6 }]} onPress={submit} disabled={submitting || !accept}>
            {submitting ? <ActivityIndicator color="#FFF" /> : (
              <>
                <Ionicons name="checkmark-circle" size={18} color="#FFF" />
                <Text style={styles.ctaText}>Activar mi cuenta</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.note}>
            🔒 Tu cuenta será revisada por el equipo Amo Cartagena antes de aparecer públicamente en la app. Esto suele tomar menos de 24h.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  hero: { alignItems: 'center', gap: 6, paddingVertical: SPACING.lg, marginBottom: SPACING.md },
  welcome: { fontSize: 14, color: COLORS.textMuted, ...FONTS.medium, marginTop: 6 },
  partnerName: { fontSize: 26, color: COLORS.textMain, ...FONTS.bold, textAlign: 'center' },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.full, backgroundColor: `${COLORS.primary}22`, borderWidth: 1, borderColor: COLORS.primary },
  tagText: { fontSize: 10, color: COLORS.primary, ...FONTS.bold, letterSpacing: 0.5 },
  intro: { fontSize: 13, color: COLORS.textMain, ...FONTS.regular, lineHeight: 19, marginBottom: SPACING.md, textAlign: 'center' },
  lbl: { fontSize: 11, color: COLORS.textMuted, ...FONTS.bold, letterSpacing: 0.4, textTransform: 'uppercase', marginTop: SPACING.md, marginBottom: 6 },
  input: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: SPACING.md, height: 48 },
  inputField: { flex: 1, fontSize: 14, color: COLORS.textMain, ...FONTS.regular },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: SPACING.md },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  checkText: { flex: 1, fontSize: 12, color: COLORS.textMain, ...FONTS.regular, lineHeight: 18 },
  link: { color: COLORS.primary, ...FONTS.semibold, textDecorationLine: 'underline' },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, paddingVertical: 14, borderRadius: RADIUS.full, marginTop: SPACING.lg },
  ctaText: { fontSize: 15, color: '#FFF', ...FONTS.bold },
  note: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 16, marginTop: SPACING.md, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl, gap: SPACING.md },
  errorTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold, textAlign: 'center' },
  helpBtn: { marginTop: SPACING.md, paddingVertical: 10, paddingHorizontal: 20, borderRadius: RADIUS.full, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.primary },
  helpBtnText: { fontSize: 13, color: COLORS.primary, ...FONTS.semibold },
});
