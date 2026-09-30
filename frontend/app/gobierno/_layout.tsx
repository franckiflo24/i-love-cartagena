// /gobierno — the government-pitch civic demo (docs/civic-demo/DESIGN.md §0/§2).
// THE GATE: every screen below requires the Alcaldía demo passcode session (role
// alcaldia_demo) or the real government role. The demo is reached by pitch, not
// discovery: noindex here + robots.txt Disallow + the backend's own env flag and
// session check (this layout is UX; the server is the wall). A persistent DEMO
// banner frames everything — no screen below can render without it.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Head from '../../src/components/WebHead';
import { COLORS, FONTS, RADIUS, SPACING } from '../../src/constants/theme';
import { useTr } from '../../src/i18n/autoTr';
import { useBusinessAuth } from '../../src/context/BusinessAuthContext';

const AMBER = '#F5A623';

export default function GobiernoLayout() {
  const tr = useTr();
  const { business, loading, passcodeLogin } = useBusinessAuth();
  const [mounted, setMounted] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const submit = useCallback(async () => {
    if (!passcode.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await passcodeLogin(passcode);
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('Código incorrecto'));
    } finally {
      setBusy(false);
    }
  }, [passcode, busy, passcodeLogin, tr]);

  const role = (business as { role?: string } | null)?.role;
  const authorized = role === 'alcaldia_demo' || role === 'government';

  return (
    <SafeAreaView style={st.container} edges={['top']}>
      <Head>
        <title>{`${tr('Demostración')} · AMO Life`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      {/* The persistent DEMO frame — every civic screen lives under it. */}
      <View style={st.demoBar} testID="gobierno-demo-bar">
        <Ionicons name="flask-outline" size={13} color="#1A1206" />
        <Text style={st.demoBarText}>
          {tr('DEMO')} · {tr('ningún pago es real — la entidad pública recauda directamente')}
        </Text>
      </View>

      {!mounted || loading ? (
        <View style={st.center}><ActivityIndicator size="large" color={AMBER} /></View>
      ) : authorized ? (
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.background } }} />
      ) : (
        <KeyboardAvoidingView style={st.center} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={st.gateCard} testID="gobierno-gate">
            <View style={st.gateIcon}>
              <Ionicons name="shield-half-outline" size={24} color={AMBER} />
            </View>
            <Text style={st.gateTitle}>{tr('Acceso para la demostración')}</Text>
            <Text style={st.gateSub}>
              {tr('Ingresa el código de acceso entregado a la Alcaldía. Esta área es una demostración privada — no es un servicio al público.')}
            </Text>
            <TextInput
              style={st.input}
              value={passcode}
              onChangeText={setPasscode}
              placeholder={tr('Código de acceso')}
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              onSubmitEditing={submit}
              testID="gobierno-passcode"
            />
            {!!error && <Text style={st.error}>{error}</Text>}
            <TouchableOpacity
              style={[st.btn, (busy || !passcode.trim()) && { opacity: 0.5 }]}
              onPress={submit}
              disabled={busy || !passcode.trim()}
              accessibilityRole="button"
              testID="gobierno-enter"
            >
              {busy ? <ActivityIndicator size="small" color="#1A1206" />
                : <Text style={st.btnText}>{tr('Entrar a la demo')}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={st.back} onPress={() => router.replace('/(tabs)' as never)} accessibilityRole="button">
              <Text style={st.backText}>{tr('Volver a AMO Life')}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  demoBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: AMBER, paddingVertical: 6, paddingHorizontal: 12,
  },
  demoBarText: { color: '#1A1206', fontSize: 11, ...FONTS.bold, flexShrink: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg },
  gateCard: {
    width: '100%', maxWidth: 420, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.35)', padding: SPACING.xl, alignItems: 'center',
  },
  gateIcon: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(245,166,35,0.14)',
    alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md,
  },
  gateTitle: { color: COLORS.textMain, fontSize: 19, ...FONTS.bold, textAlign: 'center' },
  gateSub: {
    color: COLORS.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center',
    marginTop: 8, marginBottom: SPACING.lg,
  },
  input: {
    width: '100%', minHeight: 48, borderRadius: RADIUS.md, borderWidth: 1,
    borderColor: COLORS.border, backgroundColor: COLORS.background,
    color: COLORS.textMain, paddingHorizontal: 14, fontSize: 16,
  },
  error: { color: '#EF6A5A', fontSize: 12, marginTop: 8, textAlign: 'center' },
  btn: {
    marginTop: SPACING.md, width: '100%', minHeight: 48, borderRadius: RADIUS.md,
    backgroundColor: AMBER, alignItems: 'center', justifyContent: 'center',
  },
  btnText: { color: '#1A1206', fontSize: 15, ...FONTS.bold },
  back: { marginTop: SPACING.md, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { color: COLORS.textMuted, fontSize: 13 },
});
