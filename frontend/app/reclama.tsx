// DROP 5C — "Reclama tu listado": the verify-before-publish registry as a public
// onboarding funnel. Operators held by the honesty rails (door conflicts, missing
// evidence, no Cartagena base) see exactly WHY and WHAT unlocks publication, and
// any operator — listed or not — can submit their door + registries. Nothing
// publishes automatically; the gates stay the gates (Reportado → earned Verificado).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { api } from '../src/constants/api';
import { useLang } from '../src/context/LanguageContext';
import { useTr } from '../src/i18n/autoTr';

type RegistryRow = {
  id: string;
  name: string;
  reason: { es: string; en: string };
  needed: { es: string[]; en: string[] };
};

const L2 = (v: { es: string; en: string } | undefined, lang: string) =>
  (lang === 'en' ? v?.en : v?.es) || v?.es || '';

export default function ReclamaScreen() {
  const router = useRouter();
  const { lang } = useLang();
  const tr = useTr();
  const l2 = lang === 'en' ? 'en' : 'es';

  const [rows, setRows] = useState<RegistryRow[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [doneId, setDoneId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    registry_id: '', business_name: '', contact_name: '', whatsapp: '',
    email: '', address: '', rnt: '', nit: '', website: '', message: '', company: '',
  });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    api.get('/activities/registry')
      .then((r: unknown) => {
        const got = (r as { rows?: RegistryRow[] })?.rows;
        if (Array.isArray(got)) setRows(got); else setLoadFailed(true);
      })
      .catch((e) => { console.error('[Reclama] registry', e); setLoadFailed(true); });
  }, []);

  const selected = useMemo(() => rows.find((r) => r.id === form.registry_id) || null, [rows, form.registry_id]);

  const submit = useCallback(async () => {
    setError(null);
    if (!form.business_name.trim()) { setError(tr('Escribe el nombre del negocio')); return; }
    if (!form.whatsapp.trim() && !form.email.trim()) { setError(tr('Deja un WhatsApp o un email para contactarte')); return; }
    setSending(true);
    try {
      const res = (await api.post('/activities/claims', form)) as { ok?: boolean; claim_id?: string };
      if (res?.ok) setDoneId(res.claim_id || 'ok');
      else setError(tr('No se pudo enviar — inténtalo de nuevo'));
    } catch (e) {
      console.error('[Reclama] submit', e);
      setError(tr('No se pudo enviar — inténtalo de nuevo'));
    } finally {
      setSending(false);
    }
  }, [form, tr]);

  return (
    <SafeAreaView style={st.container} edges={['top']}>
      <View style={st.topBar}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={st.backBtn} accessibilityRole="button" accessibilityLabel={tr('Volver')}>
          <Ionicons name="chevron-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={st.topTitle}>{tr('Reclama tu listado')}</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
        {doneId ? (
          <View style={st.doneBox}>
            <Ionicons name="checkmark-circle" size={44} color={COLORS.primary} />
            <Text style={st.doneTitle}>{tr('Recibido')}</Text>
            <Text style={st.doneText}>
              {tr('Verificamos antes de publicar — RUES y Cámara de Comercio siempre; DIMAR si operas en el agua; PADI/IKO para buceo o kite. Nada se publica automáticamente. Te contactamos.')}
            </Text>
            <TouchableOpacity style={st.primaryBtn} onPress={() => router.replace('/')} activeOpacity={0.85}>
              <Text style={st.primaryBtnText}>{tr('Volver al inicio')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={st.lede}>
              {tr('AMO publica operadores como «Reportado» y el sello «Verificado por AMO» solo se gana con un chequeo humano. Si tu negocio está en esta lista — o aún no está en AMO — reclámalo aquí.')}
            </Text>

            {/* ── the claimable holds, honestly framed ── */}
            {loadFailed && rows.length === 0 ? (
              <Text style={st.loadNote}>{tr('No se pudo cargar la lista — el formulario sigue abajo.')}</Text>
            ) : rows.length === 0 ? (
              <ActivityIndicator color={COLORS.primary} style={{ marginVertical: SPACING.lg }} />
            ) : (
              <View style={{ gap: 10 }}>
                {rows.map((r) => {
                  const active = form.registry_id === r.id;
                  return (
                    <TouchableOpacity key={r.id}
                      style={[st.rowCard, active && st.rowCardActive]}
                      onPress={() => setForm((f) => ({
                        ...f, registry_id: active ? '' : r.id,
                        business_name: active ? f.business_name : r.name,
                      }))}
                      activeOpacity={0.85} accessibilityRole="button">
                      <View style={{ flex: 1 }}>
                        <Text style={st.rowName}>{r.name}</Text>
                        <Text style={st.rowReason}>{L2(r.reason, l2)}</Text>
                        <View style={st.chipWrap}>
                          {(l2 === 'en' ? r.needed.en : r.needed.es).map((n, i) => (
                            <View key={i} style={st.needChip}><Text style={st.needChipText}>{n}</Text></View>
                          ))}
                        </View>
                      </View>
                      <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={20}
                        color={active ? COLORS.primary : COLORS.textMuted} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* ── the claim form ── */}
            <Text style={st.formTitle}>
              {selected ? `${tr('Reclamar')}: ${selected.name}` : tr('¿No estás en la lista? Regístrate igual')}
            </Text>
            {([
              ['business_name', tr('Nombre del negocio'), 'default'],
              ['contact_name', tr('Tu nombre'), 'default'],
              ['whatsapp', 'WhatsApp', 'phone-pad'],
              ['email', 'Email', 'email-address'],
              ['address', tr('Dirección o punto de encuentro en Cartagena'), 'default'],
              ['rnt', 'RNT', 'number-pad'],
              ['nit', 'NIT', 'default'],
              ['website', tr('Web o @instagram'), 'url'],
            ] as const).map(([k, ph, kb]) => (
              <TextInput key={k} style={st.input} placeholder={ph as string}
                placeholderTextColor={COLORS.textMuted} value={form[k]}
                onChangeText={set(k)} keyboardType={kb as never}
                autoCapitalize={k === 'email' || k === 'website' ? 'none' : 'sentences'} />
            ))}
            <TextInput style={[st.input, st.inputMulti]} placeholder={tr('Cuéntanos de tu operación (opcional)')}
              placeholderTextColor={COLORS.textMuted} value={form.message}
              onChangeText={set('message')} multiline numberOfLines={3} />
            {/* honeypot — hidden from humans, bots fill it */}
            <TextInput style={st.honeypot} value={form.company} onChangeText={set('company')}
              placeholder="Company" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />

            {error && <Text style={st.errorText}>{error}</Text>}
            <TouchableOpacity style={[st.primaryBtn, sending && { opacity: 0.6 }]}
              onPress={submit} disabled={sending} activeOpacity={0.85}>
              {sending ? <ActivityIndicator color="#fff" />
                : <Text style={st.primaryBtnText}>{tr('Enviar para verificación')}</Text>}
            </TouchableOpacity>
            <Text style={st.fine}>
              {tr('Verificación humana: RUES + Cámara de Comercio; DIMAR para operaciones en el agua; PADI/IKO para buceo/kite. Publicamos como «Reportado» mientras tanto — nunca vendemos el sello.')}
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.sm, minHeight: 52 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, textAlign: 'center', color: COLORS.textMain, fontSize: 16, ...FONTS.bold },
  scroll: { padding: SPACING.lg, paddingBottom: 48, gap: 12 },
  lede: { color: COLORS.textMain, fontSize: 13.5, lineHeight: 20, ...FONTS.regular },
  loadNote: { color: COLORS.textMuted, fontSize: 12.5, ...FONTS.regular },
  rowCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: SPACING.md,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border,
  },
  rowCardActive: { borderColor: COLORS.primary, backgroundColor: 'rgba(18,181,165,0.08)' },
  rowName: { color: COLORS.textMain, fontSize: 14, ...FONTS.bold },
  rowReason: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2, ...FONTS.regular },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  needChip: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full,
    backgroundColor: 'rgba(245,166,35,0.12)', borderWidth: 1, borderColor: 'rgba(245,166,35,0.4)',
  },
  needChipText: { color: COLORS.mustard, fontSize: 10, ...FONTS.bold },
  formTitle: { color: COLORS.textMain, fontSize: 15, marginTop: SPACING.md, ...FONTS.bold },
  input: {
    minHeight: 48, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface, color: COLORS.textMain, paddingHorizontal: 14, fontSize: 14,
  },
  inputMulti: { minHeight: 84, paddingTop: 12, textAlignVertical: 'top' },
  honeypot: { position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 },
  errorText: { color: '#F87171', fontSize: 12.5, ...FONTS.semibold },
  primaryBtn: {
    minHeight: 50, borderRadius: RADIUS.full, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, ...FONTS.bold },
  fine: { color: COLORS.textMuted, fontSize: 11.5, lineHeight: 17, ...FONTS.regular },
  doneBox: { alignItems: 'center', gap: 12, paddingVertical: 40, paddingHorizontal: SPACING.md },
  doneTitle: { color: COLORS.textMain, fontSize: 20, ...FONTS.bold },
  doneText: { color: COLORS.textMuted, fontSize: 13.5, lineHeight: 20, textAlign: 'center', ...FONTS.regular },
});
