import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { useBusinessAuth } from '../../src/context/BusinessAuthContext';
import { api } from '../../src/constants/api';
import { useTr } from '../../src/i18n/autoTr';

// B2F1 — In-dashboard password change. Wires the hardening-drop endpoint, which
// revokes all OTHER sessions on change (surfaced honestly to the user, B2F3).
export default function ChangePassword() {
  const tr = useTr();
  const router = useRouter();
  const { token, loading: authLoading } = useBusinessAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!authLoading && !token) { router.replace('/business/login' as any); return null; }

  const submit = async () => {
    if (next.length < 10) { Alert.alert(tr('Contraseña muy corta'), tr('La nueva contraseña debe tener al menos 10 caracteres')); return; }
    if (next !== confirm) { Alert.alert(tr('No coinciden'), tr('La confirmación no coincide con la nueva contraseña')); return; }
    setBusy(true);
    try {
      await api.post('/business/change-password', { current_password: current, new_password: next }, { headers: { Authorization: `Bearer ${token}` } });
      Alert.alert(
        tr('Contraseña actualizada'),
        tr('Por seguridad te desconectamos de otros dispositivos. Tu sesión actual sigue activa.'),
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (e: any) {
      Alert.alert(tr('No se pudo cambiar'), e?.message || tr('Verifica tu contraseña actual'));
    }
    setBusy(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.hTitle}>{tr('Cambiar contraseña')}</Text>
        <View style={{ width: 40 }} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>{tr('Contraseña actual')}</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={18} color={COLORS.textMuted} />
            <TextInput style={styles.input} value={current} onChangeText={setCurrent} placeholder="••••••••" placeholderTextColor={COLORS.textMuted} secureTextEntry={!show} />
          </View>
          <Text style={styles.label}>{tr('Nueva contraseña')}</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="key-outline" size={18} color={COLORS.textMuted} />
            <TextInput style={styles.input} value={next} onChangeText={setNext} placeholder={tr('Mínimo 10 caracteres')} placeholderTextColor={COLORS.textMuted} secureTextEntry={!show} />
            <TouchableOpacity onPress={() => setShow(s => !s)}>
              <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
          <Text style={styles.label}>{tr('Confirmar nueva contraseña')}</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="key-outline" size={18} color={COLORS.textMuted} />
            <TextInput style={styles.input} value={confirm} onChangeText={setConfirm} placeholder="••••••••" placeholderTextColor={COLORS.textMuted} secureTextEntry={!show} />
          </View>

          <View style={styles.noteBox}>
            <Ionicons name="information-circle-outline" size={15} color={COLORS.textMuted} />
            <Text style={styles.noteText}>{tr('Al cambiar tu contraseña te desconectamos de los demás dispositivos.')}</Text>
          </View>

          <TouchableOpacity style={[styles.btn, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator size="small" color={COLORS.white} /> : <Text style={styles.btnText}>{tr('Actualizar contraseña')}</Text>}
          </TouchableOpacity>
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
  label: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: SPACING.md, marginBottom: SPACING.xs },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: SPACING.md, height: 50 },
  input: { flex: 1, color: COLORS.textMain, fontSize: 14, ...FONTS.regular },
  noteBox: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm, marginTop: SPACING.lg, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg },
  noteText: { flex: 1, fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 17 },
  btn: { alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 15, marginTop: SPACING.xl },
  btnText: { color: COLORS.white, fontSize: 14, ...FONTS.bold },
});
