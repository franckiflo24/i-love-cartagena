import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';

export default function OperatorLogin() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  const onLogin = async () => {
    if (!password) return;
    setLoading(true);
    try {
      const data = await api.post('/admin/operator/login', { password });
      if (!data?.token) throw new Error('Sin token');
      await AsyncStorage.setItem('admin_operator_token', data.token);
      router.replace('/admin/operator' as any);
    } catch (e: any) {
      Alert.alert('Acceso denegado', 'Contraseña incorrecta');
    }
    setLoading(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
          </TouchableOpacity>
        </View>
        <View style={styles.body}>
          <View style={styles.crown}>
            <Ionicons name="key" size={36} color={COLORS.primary} />
          </View>
          <Text style={styles.title}>Admin Operator</Text>
          <Text style={styles.subtitle}>Acceso reservado al operador de la plataforma</Text>

          <View style={styles.inputRow}>
            <Ionicons name="lock-closed" size={18} color={COLORS.textMuted} />
            <TextInput
              testID="admin-op-pw"
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Contraseña"
              placeholderTextColor={COLORS.textMuted}
              secureTextEntry={!show}
              autoCapitalize="none"
              autoComplete="password"
              onSubmitEditing={onLogin}
              returnKeyType="go"
            />
            <TouchableOpacity onPress={() => setShow(!show)}>
              <Ionicons name={show ? 'eye-off' : 'eye'} size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity testID="admin-op-login-btn" style={styles.cta} onPress={onLogin} disabled={loading || !password}>
            {loading ? <ActivityIndicator color="#FFF" /> : (
              <>
                <Ionicons name="log-in" size={16} color="#FFF" />
                <Text style={styles.ctaText}>Entrar</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.hint}>Solo Amo Cartagena S.A.S. tiene acceso.</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl, gap: SPACING.md },
  crown: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(217,119,6,0.12)', borderWidth: 1, borderColor: 'rgba(217,119,6,0.4)', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold, marginTop: SPACING.sm },
  subtitle: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', marginBottom: SPACING.lg },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: SPACING.md, height: 52, width: '100%' },
  input: { flex: 1, fontSize: 15, color: COLORS.textMain, ...FONTS.regular },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 14, paddingHorizontal: 32, width: '100%' },
  ctaText: { fontSize: 16, color: '#FFF', ...FONTS.bold },
  hint: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginTop: SPACING.md, textAlign: 'center' },
});
