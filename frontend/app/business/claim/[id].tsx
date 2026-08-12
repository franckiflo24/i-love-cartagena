import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../../src/constants/theme';
import { useBusinessAuth } from '../../../src/context/BusinessAuthContext';
import { api } from '../../../src/constants/api';
import { useTr } from '../../../src/i18n/autoTr';

// B1C — Claim an existing venue. Ownership MUST be proven before any edit right
// is granted: a code emailed to the venue's ON-RECORD address (claimant never
// picks the destination) or manual proof reviewed by the team.
export default function ClaimVenue() {
  const tr = useTr();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, business, refresh, loading: authLoading } = useBusinessAuth();
  const [partner, setPartner] = useState<any>(null);
  const [step, setStep] = useState<'method' | 'code' | 'manual' | 'done'>('method');
  const [claimId, setClaimId] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [code, setCode] = useState('');
  const [proof, setProof] = useState('');
  const [nit, setNit] = useState<string>((business as any)?.nit || '');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token || !id) return;
    try { setPartner(await api.get(`/partners/${id}`)); } catch { /* fail soft */ }
  }, [token, id]);
  useEffect(() => { load(); }, [load]);

  if (!authLoading && !token) { router.replace('/business/login' as any); return null; }

  const startEmail = async () => {
    if (nit.replace(/\D/g, '').length < 5) { Alert.alert(tr('NIT requerido'), tr('Confirma el NIT o registro del negocio')); return; }
    setBusy(true);
    try {
      const r = await api.post('/business/claim/start', { partner_id: id, method: 'email', nit: nit.trim() }, { headers: { Authorization: `Bearer ${token}` } });
      if (r.already_owner) { setStep('done'); await refresh(); }
      else { setClaimId(r.claim_id); setMaskedEmail(r.masked_email || ''); setStep('code'); }
    } catch (e: any) {
      Alert.alert(tr('Verificación por email'), e?.message || tr('No disponible para este negocio'));
    }
    setBusy(false);
  };

  const verifyCode = async () => {
    if (code.trim().length < 4) return;
    setBusy(true);
    try {
      await api.post('/business/claim/verify', { claim_id: claimId, code: code.trim() }, { headers: { Authorization: `Bearer ${token}` } });
      await refresh();
      setStep('done');
    } catch (e: any) {
      Alert.alert(tr('Código'), e?.message || tr('Código incorrecto'));
    }
    setBusy(false);
  };

  const submitManual = async () => {
    if (nit.replace(/\D/g, '').length < 5) { Alert.alert(tr('NIT requerido'), tr('Confirma el NIT o registro del negocio')); return; }
    if (proof.trim().length < 8) { Alert.alert(tr('Prueba requerida'), tr('Describe cómo podemos verificar que eres el dueño (RNT, registro, etc.)')); return; }
    setBusy(true);
    try {
      await api.post('/business/claim/start', { partner_id: id, method: 'manual', proof: proof.trim(), nit: nit.trim() }, { headers: { Authorization: `Bearer ${token}` } });
      setStep('done');
    } catch (e: any) {
      Alert.alert(tr('Revisión manual'), e?.message || tr('No se pudo enviar'));
    }
    setBusy(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.hTitle}>{tr('Reclamar negocio')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.venueCard}>
          <Ionicons name="business" size={22} color={COLORS.primary} />
          <Text style={styles.venueName}>{partner?.name || id}</Text>
        </View>

        {step === 'method' && (
          <>
            <Text style={styles.claimLabel}>{tr('NIT o registro del negocio')}</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="document-text-outline" size={18} color={COLORS.textMuted} />
              <TextInput style={[styles.input, { fontSize: 15 }]} value={nit} onChangeText={setNit} placeholder={tr('Ej: 900.123.456-7')} placeholderTextColor={COLORS.textMuted} autoCapitalize="none" autoCorrect={false} />
            </View>
            <Text style={styles.claimHint}>{tr('Confírmalo para verificar tu negocio.')}</Text>
            <Text style={styles.lead}>{tr('¿Cómo quieres verificar que eres el dueño?')}</Text>
            <TouchableOpacity style={styles.optCard} onPress={startEmail} disabled={busy}>
              <Ionicons name="mail" size={20} color={COLORS.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.optTitle}>{tr('Código por email')}</Text>
                <Text style={styles.optSub}>{tr('Enviamos un código al email registrado del negocio.')}</Text>
              </View>
              {busy ? <ActivityIndicator size="small" color={COLORS.primary} /> : <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />}
            </TouchableOpacity>
            <TouchableOpacity style={styles.optCard} onPress={() => setStep('manual')} disabled={busy}>
              <Ionicons name="document-text" size={20} color={COLORS.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.optTitle}>{tr('Revisión manual')}</Text>
                <Text style={styles.optSub}>{tr('Envía tu RNT, registro mercantil o una foto del local. El equipo lo revisa.')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          </>
        )}

        {step === 'code' && (
          <>
            <Text style={styles.lead}>{tr('Ingresa el código de 6 dígitos que enviamos a')} {maskedEmail}</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="keypad-outline" size={18} color={COLORS.textMuted} />
              <TextInput style={[styles.input, { letterSpacing: 6, ...FONTS.bold }]} value={code} onChangeText={setCode} placeholder="000000" placeholderTextColor={COLORS.textMuted} keyboardType="number-pad" maxLength={6} />
            </View>
            <TouchableOpacity style={[styles.primaryBtn, busy && { opacity: 0.6 }]} onPress={verifyCode} disabled={busy}>
              {busy ? <ActivityIndicator size="small" color={COLORS.white} /> : <Text style={styles.primaryBtnText}>{tr('Verificar')}</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={startEmail}><Text style={styles.linkText}>{tr('Reenviar código')}</Text></TouchableOpacity>
          </>
        )}

        {step === 'manual' && (
          <>
            <Text style={styles.lead}>{tr('Describe tu prueba de propiedad')}</Text>
            <TextInput
              style={styles.textarea}
              value={proof}
              onChangeText={setProof}
              placeholder={tr('Ej: RNT 12345, registro mercantil a nombre de… Adjuntaré fotos por WhatsApp.')}
              placeholderTextColor={COLORS.textMuted}
              multiline
            />
            <TouchableOpacity style={[styles.primaryBtn, busy && { opacity: 0.6 }]} onPress={submitManual} disabled={busy}>
              {busy ? <ActivityIndicator size="small" color={COLORS.white} /> : <Text style={styles.primaryBtnText}>{tr('Enviar para revisión')}</Text>}
            </TouchableOpacity>
          </>
        )}

        {step === 'done' && (
          <View style={styles.doneBox}>
            <View style={styles.doneIcon}><Ionicons name="checkmark" size={30} color={COLORS.primary} /></View>
            <Text style={styles.doneTitle}>
              {claimId || maskedEmail ? tr('¡Verificado! Ya eres el dueño.') : tr('Solicitud enviada a revisión')}
            </Text>
            <Text style={styles.doneSub}>
              {claimId || maskedEmail
                ? tr('Ahora puedes editar la información de tu negocio.')
                : tr('El equipo revisará tu prueba y te avisará. No obtienes permisos de edición hasta ser verificado.')}
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/business/dashboard' as any)}>
              <Text style={styles.primaryBtnText}>{tr('Ir al dashboard')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: SPACING.sm },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  hTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold },
  scroll: { padding: SPACING.lg },
  venueCard: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, marginBottom: SPACING.lg },
  venueName: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold, flex: 1 },
  lead: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold, marginBottom: SPACING.md, lineHeight: 20, marginTop: SPACING.md },
  claimLabel: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: SPACING.xs },
  claimHint: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginTop: SPACING.xs },
  optCard: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, marginBottom: SPACING.md },
  optTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  optSub: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2, lineHeight: 17 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: SPACING.md, height: 54 },
  input: { flex: 1, color: COLORS.textMain, fontSize: 18, ...FONTS.regular },
  textarea: { minHeight: 120, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, color: COLORS.textMain, fontSize: 14, ...FONTS.regular, textAlignVertical: 'top' },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 14, marginTop: SPACING.lg },
  primaryBtnText: { color: COLORS.white, fontSize: 14, ...FONTS.bold },
  linkText: { textAlign: 'center', color: COLORS.primary, fontSize: 13, ...FONTS.semibold, marginTop: SPACING.md },
  doneBox: { alignItems: 'center', paddingTop: SPACING.xl },
  doneIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(217,119,6,0.15)', borderWidth: 1.5, borderColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold, textAlign: 'center', marginTop: SPACING.lg },
  doneSub: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', lineHeight: 20, marginTop: SPACING.sm, paddingHorizontal: SPACING.md },
});
