// /billetera — PALCO Stage B secure-wallet enrollment (contract: docs/palco-v2/DESIGN.md §5, §13.5).
//
// One screen, five honest states: native-only explainer (web/Android), sign-in prompt,
// not-enrolled (consent + activate), enrolling (step label), enrolled (tier card). The
// enrollment itself lives in src/lib/palcoWallet.ts: Secure Enclave P-256 key + Apple
// App Attest over one server challenge — there is NO software fallback; an unsupported
// device gets the truth, never a pretend "secure" state.
//
// React #418 discipline: platform/support detection and the SecureStore read happen in
// effects, never at render — the static-export HTML and the first client render match.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Head from '../src/components/WebHead';
import { COLORS, SPACING, RADIUS, TYPE } from '../src/constants/theme';
import { useAuth } from '../src/context/AuthContext';
import { useTr } from '../src/i18n/autoTr';
import {
  detectWalletSupport, enrollThisDevice, getStoredEnrollment, PalcoWalletError,
} from '../src/lib/palcoWallet';
import type { Enrollment, WalletSupport } from '../src/lib/palcoWallet';

const APP_STORE_URL = 'https://apps.apple.com/app/id6809565354';

export default function BilleteraScreen() {
  const router = useRouter();
  const tr = useTr();
  const { user, isLoading } = useAuth();
  const userId = user ? user.user_id : null;

  const [support, setSupport] = useState<WalletSupport | null>(null);
  const [stored, setStored] = useState<Enrollment | null>(null);
  const [checked, setChecked] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => { setSupport(detectWalletSupport()); }, []);

  useEffect(() => {
    let on = true;
    if (!userId || support !== 'ok') { setStored(null); setChecked(true); return undefined; }
    setChecked(false);
    getStoredEnrollment(userId).then((e) => {
      if (on) { setStored(e); setChecked(true); }
    });
    return () => { on = false; };
  }, [userId, support]);

  const errorText = useCallback((e: unknown): string => {
    const code = e instanceof PalcoWalletError ? e.code : 'server';
    switch (code) {
      case 'auth': return tr('Inicia sesión para activar tu billetera');
      case 'no_attest': return tr('Este dispositivo no soporta la verificación de Apple.');
      case 'attest': return tr('Apple no pudo verificar la app. Inténtalo de nuevo.');
      case 'keygen': return tr('No se pudo crear la llave segura.');
      case 'network': return tr('Sin conexión. Inténtalo de nuevo.');
      default: return tr('No se pudo activar la billetera. Inténtalo de nuevo.');
    }
  }, [tr]);

  const activate = useCallback(async () => {
    if (!userId || busyStep) return;
    setErrorMsg(null);
    try {
      setBusyStep(tr('Creando tu llave segura…'));
      // The lib runs the whole flow; the step label is honest about the slow part
      // (Apple round-trip) without pretending to know module-level progress.
      const enrollment = await enrollThisDevice(userId);
      setStored(enrollment);
    } catch (e) {
      setErrorMsg(errorText(e));
    } finally {
      setBusyStep(null);
    }
  }, [userId, busyStep, tr, errorText]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/perfil' as never);
  }, [router]);

  const Bullet = ({ icon, text }: { icon: string; text: string }) => (
    <View style={s.bulletRow}>
      <Ionicons name={icon as never} size={18} color={COLORS.primary} style={s.bulletIcon} />
      <Text style={s.bulletText}>{text}</Text>
    </View>
  );

  let body: React.ReactNode;
  if (support === null || isLoading || !checked) {
    body = <ActivityIndicator color={COLORS.primary} style={s.spinner} />;
  } else if (support !== 'ok') {
    const isWeb = support === 'web';
    body = (
      <View style={s.card} testID="billetera-native-only">
        <Ionicons name="phone-portrait-outline" size={34} color={COLORS.icon} />
        <Text style={s.cardTitle}>{tr('La billetera segura vive en la app de iPhone')}</Text>
        <Text style={s.cardText}>
          {support === 'android'
            ? tr('Disponible pronto para Android.')
            : tr('Tus llaves se guardan en el chip seguro del teléfono, por eso no existe en la web.')}
        </Text>
        {isWeb && Platform.OS === 'web' ? (
          <TouchableOpacity
            style={s.primaryBtn}
            onPress={() => { Linking.openURL(APP_STORE_URL).catch(() => {}); }}
            accessibilityRole="button"
          >
            <Text style={s.primaryBtnText}>{tr('Descárgala en el App Store')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  } else if (!userId) {
    body = (
      <View style={s.card} testID="billetera-login">
        <Ionicons name="person-circle-outline" size={34} color={COLORS.icon} />
        <Text style={s.cardTitle}>{tr('Inicia sesión para activar tu billetera')}</Text>
        <TouchableOpacity
          style={s.primaryBtn}
          onPress={() => router.push('/login' as never)}
          accessibilityRole="button"
        >
          <Text style={s.primaryBtnText}>{tr('Iniciar sesión')}</Text>
        </TouchableOpacity>
      </View>
    );
  } else if (stored) {
    body = (
      <View style={s.card} testID="billetera-enrolled">
        <View style={s.okBadge}>
          <Ionicons name="shield-checkmark" size={30} color={COLORS.primary} />
        </View>
        <Text style={s.cardTitle}>{tr('Billetera activa')}</Text>
        <Text style={s.cardText}>{tr('Este dispositivo quedó registrado como tu billetera.')}</Text>
        <View style={s.metaBox}>
          <View style={s.metaRow}>
            <Text style={s.metaLabel}>{tr('Verificación')}</Text>
            <Text style={s.metaValue}>
              {stored.hw_tier === 'app_attest' ? tr('Hardware Apple verificado') : stored.hw_tier}
            </Text>
          </View>
          <View style={[s.metaRow, s.metaRowLast]}>
            <Text style={s.metaLabel}>{tr('Llave')}</Text>
            <Text style={s.metaValue}>{stored.device_key_id}</Text>
          </View>
        </View>
        <TouchableOpacity
          style={s.primaryBtn}
          onPress={() => router.push('/tickets' as never)}
          accessibilityRole="button"
          testID="billetera-view-tickets"
        >
          <Text style={s.primaryBtnText}>{tr('Ver mis entradas')}</Text>
        </TouchableOpacity>
      </View>
    );
  } else {
    body = (
      <View style={s.card} testID="billetera-explainer">
        <Ionicons name="shield-half-outline" size={34} color={COLORS.primary} />
        <Text style={s.cardTitle}>{tr('Protege tus entradas con la seguridad de tu iPhone')}</Text>
        <View style={s.bullets}>
          <Bullet icon="hardware-chip-outline" text={tr('Tu llave se crea dentro del chip seguro de tu iPhone y nunca sale de él.')} />
          <Bullet icon="logo-apple" text={tr('Apple verifica que tu app es auténtica antes de activarla.')} />
          <Bullet icon="qr-code-outline" text={tr('Tus códigos QR rotan: una captura de pantalla muere en segundos.')} />
        </View>
        <TouchableOpacity
          style={s.consentRow}
          onPress={() => setConsent((c) => !c)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: consent }}
          testID="billetera-consent"
        >
          <Ionicons
            name={consent ? 'checkbox' : 'square-outline'}
            size={22}
            color={consent ? COLORS.primary : COLORS.iconMuted}
          />
          <Text style={s.consentText}>
            {tr('Acepto la política de datos para registrar este dispositivo.')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => router.push('/privacidad' as never)}
          accessibilityRole="link"
        >
          <Text style={s.privacyLink}>{tr('Ver política de privacidad')}</Text>
        </TouchableOpacity>
        {errorMsg ? <Text style={s.errorText} testID="billetera-error">{errorMsg}</Text> : null}
        <TouchableOpacity
          style={[s.primaryBtn, (!consent || !!busyStep) && s.primaryBtnDisabled]}
          onPress={activate}
          disabled={!consent || !!busyStep}
          accessibilityRole="button"
          testID="billetera-activate"
        >
          {busyStep ? (
            <View style={s.busyRow}>
              <ActivityIndicator color={COLORS.white} size="small" />
              <Text style={s.primaryBtnText}>{busyStep}</Text>
            </View>
          ) : (
            <Text style={s.primaryBtnText}>{tr('Activar billetera segura')}</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="billetera-screen">
      <Head>
        <title>{`${tr('Billetera segura')} · AMO Life`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <View style={s.header}>
        <TouchableOpacity
          style={s.backBtn}
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel={tr('Volver')}
          testID="billetera-back-btn"
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={s.title} accessibilityRole="header">{tr('Billetera segura')}</Text>
      </View>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={s.content}>{body}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.hairline, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, ...TYPE.title1, color: COLORS.textMain },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },
  spinner: { marginTop: SPACING.xxl },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.hairline, padding: SPACING.xl, alignItems: 'center', marginTop: SPACING.md },
  cardTitle: { ...TYPE.title3, color: COLORS.textMain, textAlign: 'center', marginTop: SPACING.md },
  cardText: { ...TYPE.body, color: COLORS.textMuted, textAlign: 'center', marginTop: SPACING.sm },
  bullets: { alignSelf: 'stretch', marginTop: SPACING.lg, gap: SPACING.md },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start' },
  bulletIcon: { marginTop: 2, marginRight: SPACING.sm },
  bulletText: { flex: 1, ...TYPE.body, color: COLORS.textMuted },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', alignSelf: 'stretch', marginTop: SPACING.xl, gap: SPACING.sm },
  consentText: { flex: 1, ...TYPE.footnote, color: COLORS.textMain },
  privacyLink: { ...TYPE.footnote, color: COLORS.primary, marginTop: SPACING.sm, textDecorationLine: 'underline' },
  errorText: { ...TYPE.footnote, color: COLORS.error, textAlign: 'center', marginTop: SPACING.md },
  primaryBtn: { alignSelf: 'stretch', backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center', marginTop: SPACING.lg },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { ...TYPE.headline, color: COLORS.white },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  okBadge: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(18,181,165,0.12)', alignItems: 'center', justifyContent: 'center' },
  metaBox: { alignSelf: 'stretch', backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.md, marginTop: SPACING.lg, paddingHorizontal: SPACING.md },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.hairline },
  metaRowLast: { borderBottomWidth: 0 },
  metaLabel: { ...TYPE.footnote, color: COLORS.textMuted },
  metaValue: { ...TYPE.footnote, color: COLORS.textMain, fontVariant: ['tabular-nums'] },
});
