import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { Alert } from '../../src/lib/alert';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useTr } from '../../src/i18n/autoTr';

// B2F2 — Business password recovery: request a code by email, then reset.
export default function ForgotPassword() {
  const tr = useTr();
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  const requestCode = async () => {
    if (!email || !email.includes('@')) { Alert.alert(tr('Email inválido'), tr('Ingresa tu email')); return; }
    setBusy(true);
    try {
      await api.post('/business/forgot-password', { email: email.trim().toLowerCase() });
      setStep('reset');
    } catch { setStep('reset'); /* never reveal whether the email exists */ }
    setBusy(false);
  };

  const doReset = async () => {
    if (code.trim().length < 4) { Alert.alert(tr('Código'), tr('Ingresa el código que te enviamos')); return; }
    if (next.length < 10) { Alert.alert(tr('Contraseña muy corta'), tr('Mínimo 10 caracteres')); return; }
    setBusy(true);
    try {
      await api.post('/business/reset-password-with-code', { email: email.trim().toLowerCase(), code: code.trim(), new_password: next });
      Alert.alert(tr('Contraseña restablecida'), tr('Ya puedes iniciar sesión con tu nueva contraseña.'), [
        { text: 'OK', onPress: () => router.replace('/business/login' as any) },
      ]);
    } catch (e: any) {
      Alert.alert(tr('No se pudo restablecer'), e?.message || tr('Código incorrecto o expirado'));
    }
    setBusy(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.hTitle}>{tr('Recuperar acceso')}</Text>
        <View style={{ width: 40 }} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {step === 'email' ? (
            <>
              <Text style={styles.lead}>{tr('Ingresa el email de tu cuenta y te enviaremos un código para restablecer tu contraseña.')}</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="mail-outline" size={18} color={COLORS.textMuted} />
                <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="tu@negocio.com" placeholderTextColor={COLORS.textMuted} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
              </View>
              <TouchableOpacity style={[styles.btn, busy && { opacity: 0.6 }]} onPress={requestCode} disabled={busy}>
                {busy ? <ActivityIndicator size="small" color={COLORS.white} /> : <Text style={styles.btnText}>{tr('Enviar código')}</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.lead}>{tr('Si el email existe, te enviamos un código. Ingrésalo con tu nueva contraseña.')}</Text>
              <Text style={styles.label}>{tr('Código')}</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="keypad-outline" size={18} color={COLORS.textMuted} />
                <TextInput style={[styles.input, { letterSpacing: 6 }]} value={code} onChangeText={setCode} placeholder="000000" placeholderTextColor={COLORS.textMuted} keyboardType="number-pad" maxLength={6} />
              </View>
              <Text style={styles.label}>{tr('Nueva contraseña')}</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="key-outline" size={18} color={COLORS.textMuted} />
                <TextInput style={styles.input} value={next} onChangeText={setNext} placeholder={tr('Mínimo 10 caracteres')} placeholderTextColor={COLORS.textMuted} secureTextEntry />
              </View>
              <TouchableOpacity style={[styles.btn, busy && { opacity: 0.6 }]} onPress={doReset} disabled={busy}>
                {busy ? <ActivityIndicator size="small" color={COLORS.white} /> : <Text style={styles.btnText}>{tr('Restablecer contraseña')}</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={requestCode}><Text style={styles.linkText}>{tr('Reenviar código')}</Text></TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: SPACING.sm },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  hTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold },
  scroll: { padding: SPACING.lg },
  lead: { fontSize: 14, color: COLORS.textMain, ...FONTS.regular, lineHeight: 20, marginBottom: SPACING.lg },
  label: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: SPACING.md, marginBottom: SPACING.xs },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: SPACING.md, height: 50 },
  input: { flex: 1, color: COLORS.textMain, fontSize: 14, ...FONTS.regular },
  btn: { alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 15, marginTop: SPACING.lg },
  btnText: { color: COLORS.white, fontSize: 14, ...FONTS.bold },
  linkText: { textAlign: 'center', color: COLORS.primary, fontSize: 13, ...FONTS.semibold, marginTop: SPACING.md },
});
