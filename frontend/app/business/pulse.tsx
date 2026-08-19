import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { Alert } from '../../src/lib/alert';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { useBusinessAuth } from '../../src/context/BusinessAuthContext';
import { api } from '../../src/constants/api';
import { useTr } from '../../src/i18n/autoTr';

// B4 — Pulse: the real-time "what's live tonight" compose surface. A partner types
// free text ("Jazz en vivo 9pm, quedan 2 mesas"); POST /business/pulse runs the
// SAME Haiku parser as the WhatsApp webhook, storing structured pulses that expire
// end-of-day Bogotá. Those surface to guests via Luna's live_tonight AND the
// ⚡HOY badge on partner/search/home/collections — the loop is already wired, this
// is the missing in-app entry. Gate mirrors the backend exactly: verified_owner +
// claimed + publicly-visible (is_publicly_visible blocks sandbox), else 403.
type PulseMeta = { icon: any; label: string; color: string };
const PULSE_META: Record<string, PulseMeta> = {
  live_music: { icon: 'musical-notes', label: 'Música en vivo', color: '#A855F7' },
  happy_hour: { icon: 'wine', label: 'Happy Hour', color: '#EC4899' },
  special: { icon: 'restaurant', label: 'Especial', color: '#F97316' },
  event: { icon: 'sparkles', label: 'Evento', color: '#3B82F6' },
  availability: { icon: 'checkmark-circle', label: 'Cupos', color: '#22C55E' },
  closure: { icon: 'time', label: 'Cierre', color: '#EF4444' },
  other: { icon: 'flash', label: 'Novedad', color: '#FBBF24' },
};
const metaFor = (t?: string) => PULSE_META[t || 'other'] || PULSE_META.other;

const EXAMPLES = [
  'Música en vivo desde las 21:00',
  'Happy hour 2x1 en cócteles hasta las 20:00',
  'Quedan mesas para cenar esta noche',
  'Hoy cerramos temprano, a las 18:00',
];

export default function BusinessPulse() {
  const tr = useTr();
  const router = useRouter();
  const { token, business, partner, loading: authLoading, refresh } = useBusinessAuth();

  const [active, setActive] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ reply?: string; pulses?: any[]; cleared?: boolean; published?: number; hadActive?: boolean } | null>(null);

  // Mirror the backend gate (pulse.py:364-369) EXACTLY: government role bypasses;
  // otherwise verified owner AND publicly-visible. is_publicly_visible checks BOTH
  // catalog_status and the legacy `status` field, so mirror both — else the "how
  // travelers see it" label could show for a venue guests can't actually see.
  const canPulse = business?.role === 'government'
    || (partner?.claim_status === 'verified_owner'
      && !['pending_review', 'rejected', 'sandbox'].includes(partner?.catalog_status || '')
      && !['pending_review', 'rejected', 'needs_verification'].includes((partner as any)?.status || ''));

  const loadActive = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api.get('/business/pulse', { headers: { Authorization: `Bearer ${token}` } });
      setActive(Array.isArray(data?.pulses) ? data.pulses : []);
      setLoadError(false);
    } catch (e) { console.error('[pulse] load', e); setLoadError(true); }
  }, [token]);

  useEffect(() => {
    if (authLoading) return;
    if (!token) { router.replace('/business/login' as any); return; }
    setLoading(true);
    loadActive().finally(() => setLoading(false));
  }, [token, authLoading, loadActive, router]);

  // Refresh the partner object too, so canPulse + the visibility label reflect a
  // mid-session approval/suspension (sessions live for days) — not a stale snapshot.
  useFocusEffect(useCallback(() => { loadActive(); refresh(); }, [loadActive, refresh]));

  const post = async () => {
    if (text.trim().length < 3) { Alert.alert(tr('Escribe algo'), tr('Cuéntanos qué está pasando en tu negocio hoy.')); return; }
    const hadActive = active.length > 0;
    setBusy(true); setResult(null);
    try {
      const r = await api.post('/business/pulse', { text: text.trim() }, { headers: { Authorization: `Bearer ${token}` } });
      // A misconfigured/empty backend URL makes api.post a silent no-op that echoes
      // the request body (no `ok`). Never claim success on that — the partner would
      // believe a live update reached travelers when it never left the device.
      if (!r?.ok) throw new Error(tr('No se pudo publicar. Verifica tu conexión e intenta de nuevo.'));
      setText('');
      await loadActive();
      // hadActive distinguishes an intended clear from an unparseable message: the
      // backend returns cleared:true for BOTH, but only the former should read as
      // "we removed your updates".
      setResult({ reply: r?.reply, pulses: r?.pulses || [], cleared: !!r?.cleared, published: r?.published || 0, hadActive });
    } catch (e: any) {
      const msg = /429|too many requests/i.test(e?.message || '')
        ? tr('Publicaste demasiadas veces. Espera un momento.')
        : (e?.message || tr('Intenta de nuevo en un momento.'));
      Alert.alert(tr('No se pudo publicar'), msg);
    }
    setBusy(false);
  };

  const clearAll = () => {
    const doClear = async () => {
      setBusy(true);
      try {
        await api.delete('/business/pulse', { headers: { Authorization: `Bearer ${token}` } });
        setActive([]); setResult(null);
      } catch (e: any) { Alert.alert(tr('No se pudo actualizar'), e?.message || tr('Intenta de nuevo.')); }
      setBusy(false);
    };
    if (Platform.OS === 'web') { if (window.confirm(tr('¿Quitar tus novedades de hoy?'))) doClear(); }
    else Alert.alert(tr('Quitar novedades'), tr('¿Quitar tus novedades de hoy?'), [
      { text: tr('Cancelar'), style: 'cancel' },
      { text: tr('Quitar'), style: 'destructive', onPress: doClear },
    ]);
  };

  if (authLoading || loading) {
    return <SafeAreaView style={styles.container}><ActivityIndicator size="large" color={COLORS.primary} style={{ flex: 1 }} /></SafeAreaView>;
  }

  const timeOf = (p: any) => [p.start_time, p.end_time].filter(Boolean).join(' – ');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View style={styles.hTitleWrap}>
          <Ionicons name="flash" size={16} color="#FBBF24" />
          <Text style={styles.hTitle}>{tr('En vivo hoy')}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* The moat, stated plainly */}
          <View style={styles.heroCard}>
            <Text style={styles.heroText}>
              {tr('Cuéntanos qué pasa AHORA en tu negocio. Aparece al instante para los viajeros que preguntan por hoy — y Luna lo recomienda.')}
            </Text>
            <Text style={styles.heroSub}>{tr('Se borra solo al final del día. Ninguna otra app tiene esto.')}</Text>
          </View>

          {!canPulse && (
            <View style={styles.gateBanner}>
              <Ionicons name="hourglass-outline" size={18} color="#3B82F6" />
              <Text style={styles.gateText}>{tr('Tu negocio debe estar verificado y aprobado para publicar en vivo.')}</Text>
            </View>
          )}

          {/* AI reply after posting */}
          {result && (
            <View style={styles.replyCard}>
              <Ionicons name="sparkles" size={16} color={COLORS.primary} />
              <Text style={styles.replyText}>{result.reply || (result.cleared
                ? (result.hadActive ? tr('Listo, quitamos tus novedades.') : tr('No entendimos tu mensaje. Cuéntanos qué pasa hoy, ej: música en vivo 21:00.'))
                : tr('Publicado.'))}</Text>
            </View>
          )}

          {loadError && (
            <TouchableOpacity style={styles.retryBanner} onPress={() => loadActive()} activeOpacity={0.8}>
              <Ionicons name="refresh" size={15} color={COLORS.textMuted} />
              <Text style={styles.retryText}>{tr('No pudimos cargar tus novedades.')} · {tr('Reintentar')}</Text>
            </TouchableOpacity>
          )}

          {/* Live now — rendered exactly as guests see it (⚡HOY badge) */}
          {active.length > 0 && (
            <View style={styles.liveSection}>
              <View style={styles.liveHeader}>
                <View style={[styles.liveDot, !canPulse && { backgroundColor: COLORS.textMuted }]} />
                <Text style={styles.liveLabel}>{canPulse ? tr('Así lo ven los viajeros ahora') : tr('Tus novedades activas')}</Text>
                <TouchableOpacity onPress={clearAll} style={[styles.clearBtn, busy && { opacity: 0.5 }]} disabled={busy}>
                  <Ionicons name="close" size={13} color={COLORS.textMuted} />
                  <Text style={styles.clearText}>{tr('Quitar')}</Text>
                </TouchableOpacity>
              </View>
              {active.filter(Boolean).map((p) => {
                const m = metaFor(p.type);
                return (
                  <View key={p.pulse_id} style={styles.pulseBanner}>
                    <View style={styles.pulseBadge}><Text style={styles.pulseBadgeText}>{tr('HOY')}</Text></View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.pulseTypeRow}>
                        <Ionicons name={m.icon} size={12} color={m.color} />
                        <Text style={[styles.pulseType, { color: m.color }]}>{tr(m.label)}</Text>
                        {timeOf(p) ? <Text style={styles.pulseTime}>· {timeOf(p)}</Text> : null}
                      </View>
                      <Text style={styles.pulseTitle}>{p.title}</Text>
                      {p.details ? <Text style={styles.pulseDetails} numberOfLines={2}>{p.details}</Text> : null}
                    </View>
                    <Ionicons name="flash" size={18} color="#FBBF24" />
                  </View>
                );
              })}
              {!canPulse && <Text style={styles.hiddenNote}>{tr('No visibles para viajeros hasta que tu negocio esté aprobado.')}</Text>}
              <Text style={styles.expiryNote}>{tr('Activo hoy · se borra solo a las 23:59.')}</Text>
            </View>
          )}

          {/* Compose */}
          <Text style={styles.label}>{active.length > 0 ? tr('Actualizar novedad') : tr('¿Qué pasa hoy?')}</Text>
          <TextInput
            style={[styles.compose, !canPulse && { opacity: 0.5 }]}
            value={text}
            onChangeText={setText}
            placeholder={tr('Ej: Música en vivo desde las 21:00, quedan 2 mesas para cenar')}
            placeholderTextColor={COLORS.textMuted}
            multiline
            maxLength={500}
            editable={canPulse}
          />
          <View style={styles.composeFoot}>
            <Text style={styles.charCount}>{text.length}/500</Text>
            {active.length > 0 ? <Text style={styles.replaceNote}>{tr('Publicar reemplaza lo de arriba')}</Text> : null}
          </View>

          {/* Example prefills — only when the box is empty, so tapping never wipes typed text */}
          {canPulse && text.trim().length === 0 && (
            <View style={styles.chips}>
              {EXAMPLES.map((ex, i) => (
                <TouchableOpacity key={i} style={styles.chip} onPress={() => setText(tr(ex))}>
                  <Text style={styles.chipText} numberOfLines={1}>{tr(ex)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <TouchableOpacity style={[styles.submit, (busy || !canPulse || text.trim().length < 3) && { opacity: 0.5 }]} onPress={post} disabled={busy || !canPulse || text.trim().length < 3}>
            {busy ? <ActivityIndicator size="small" color={COLORS.black} /> : (
              <>
                <Ionicons name="flash" size={18} color={COLORS.black} />
                <Text style={styles.submitText}>{tr('Publicar en vivo')}</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={{ height: SPACING.xl }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  hTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold },
  scroll: { padding: SPACING.lg, paddingBottom: SPACING.xl * 2 },

  heroCard: { backgroundColor: 'rgba(251,191,36,0.08)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.35)', borderRadius: RADIUS.lg, padding: SPACING.md, gap: 6 },
  heroText: { fontSize: 13.5, color: COLORS.textMain, ...FONTS.semibold, lineHeight: 19 },
  heroSub: { fontSize: 11.5, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 16 },

  gateBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(59,130,246,0.10)', borderWidth: 1, borderColor: '#3B82F6', borderRadius: RADIUS.lg, padding: SPACING.md, marginTop: SPACING.md },
  gateText: { flex: 1, fontSize: 12, color: COLORS.textMain, ...FONTS.medium, lineHeight: 17 },

  retryBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, padding: SPACING.md, marginTop: SPACING.md },
  retryText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold },
  replyCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: 'rgba(18,181,165,0.10)', borderWidth: 1, borderColor: COLORS.primary, borderRadius: RADIUS.lg, padding: SPACING.md, marginTop: SPACING.md },
  replyText: { flex: 1, fontSize: 13, color: COLORS.textMain, ...FONTS.medium, lineHeight: 18 },

  liveSection: { marginTop: SPACING.lg },
  liveHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SPACING.sm },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22C55E' },
  liveLabel: { flex: 1, fontSize: 11, color: COLORS.textMuted, ...FONTS.bold, letterSpacing: 0.5, textTransform: 'uppercase' },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border },
  clearText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.semibold },

  pulseBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(251,191,36,0.35)', padding: SPACING.md, marginBottom: SPACING.sm },
  pulseBadge: { backgroundColor: '#FBBF24', borderRadius: RADIUS.sm, paddingHorizontal: 7, paddingVertical: 3 },
  pulseBadgeText: { fontSize: 10, color: COLORS.black, ...FONTS.bold, letterSpacing: 0.5 },
  pulseTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  pulseType: { fontSize: 10.5, ...FONTS.bold, letterSpacing: 0.3 },
  pulseTime: { fontSize: 10.5, color: COLORS.textMuted, ...FONTS.medium },
  pulseTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  pulseDetails: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2, lineHeight: 16 },
  expiryNote: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, fontStyle: 'italic', marginTop: 2 },
  hiddenNote: { fontSize: 11.5, color: '#3B82F6', ...FONTS.semibold, marginTop: 2, lineHeight: 16 },

  label: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: SPACING.lg, marginBottom: SPACING.xs },
  compose: { minHeight: 96, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, color: COLORS.textMain, fontSize: 15, ...FONTS.regular, textAlignVertical: 'top', lineHeight: 21 },
  composeFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SPACING.xs },
  charCount: { fontSize: 11, color: COLORS.textFaint, ...FONTS.medium },
  replaceNote: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, fontStyle: 'italic' },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.md },
  chip: { maxWidth: '100%', paddingHorizontal: SPACING.md, paddingVertical: 8, borderRadius: RADIUS.full, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  chipText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium },

  submit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FBBF24', borderRadius: RADIUS.full, paddingVertical: 15, marginTop: SPACING.lg },
  submitText: { color: COLORS.black, fontSize: 15, ...FONTS.bold },
});
