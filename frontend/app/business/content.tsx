import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { useBusinessAuth } from '../../src/context/BusinessAuthContext';
import { api } from '../../src/constants/api';
import { useTr } from '../../src/i18n/autoTr';

// DROP B2 — "Mi contenido": the partner-facing counterpart to the admin
// moderation queue. Partners submit a photo and/or a price here; both land
// PENDING and only become visible once a government reviewer approves them
// (see app/business/admin/queue.tsx). This screen also shows the live status
// of everything the partner has ever submitted (events + media + prices).

type Submissions = { events: any[]; media: any[]; prices: any[] };
const EMPTY_SUBMISSIONS: Submissions = { events: [], media: [], prices: [] };

const fmtPriceRange = (p: any): string | null => {
  const low = p?.typical_cop?.low;
  const high = p?.typical_cop?.high;
  if (low == null && high == null) return null;
  if (low == null) return `COP ${Number(high).toLocaleString('es-CO')}`;
  if (high == null) return `COP ${Number(low).toLocaleString('es-CO')}`;
  if (low === high) return `COP ${Number(low).toLocaleString('es-CO')}`;
  return `COP ${Number(low).toLocaleString('es-CO')}–${Number(high).toLocaleString('es-CO')}`;
};

type StatusMeta = { bg: string; color: string; label: string };

export default function MyContent() {
  const tr = useTr();
  const router = useRouter();
  const { token, loading: authLoading } = useBusinessAuth();

  const statusMeta = (status: string): StatusMeta => {
    if (status === 'approved') return { bg: 'rgba(34,197,94,0.15)', color: '#22C55E', label: tr('Aprobado') };
    if (status === 'rejected') return { bg: 'rgba(239,68,68,0.15)', color: '#EF4444', label: tr('Rechazado') };
    return { bg: 'rgba(245,158,11,0.15)', color: '#F59E0B', label: tr('En revisión') };
  };

  // ── Photo upload ──
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [photoResult, setPhotoResult] = useState<any>(null);

  // ── Price submit ──
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');
  const [priceLabel, setPriceLabel] = useState('');
  const [priceSaving, setPriceSaving] = useState(false);
  const [priceResult, setPriceResult] = useState<any>(null);

  // ── Mis envíos ──
  const [subs, setSubs] = useState<Submissions>(EMPTY_SUBMISSIONS);
  const [subsLoading, setSubsLoading] = useState(true);

  const loadSubs = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api.get('/business/submissions', { headers: { Authorization: `Bearer ${token}` } });
      setSubs({ events: data.events || [], media: data.media || [], prices: data.prices || [] });
    } catch { /* fail soft */ }
  }, [token]);

  useFocusEffect(useCallback(() => {
    if (!token) return;
    setSubsLoading(true);
    loadSubs().finally(() => setSubsLoading(false));
  }, [token, loadSubs]));

  if (!authLoading && !token) { router.replace('/business/login' as any); return null; }

  const handlePickPhoto = async () => {
    if (!token) return;
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(tr('Permiso denegado'), tr('Necesitamos acceso a tu galería para subir una foto'));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        base64: true,
        quality: 0.6,
      });
      if (result.canceled || !result.assets?.[0]?.base64) return;
      const dataUrl = `data:image/jpeg;base64,${result.assets[0].base64}`;
      setUploading(true);
      setPhotoResult(null);
      const res = await api.post('/business/media', { image_base64: dataUrl, caption: caption.trim() }, { headers: { Authorization: `Bearer ${token}` } });
      setPhotoResult(res);
      if (res?.submitted) {
        setCaption('');
        await loadSubs();
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || tr('No se pudo subir la foto'));
    } finally {
      setUploading(false);
    }
  };

  const handleSubmitPrice = async () => {
    if (!token) return;
    const lowNum = low.trim() ? parseInt(low.trim(), 10) : undefined;
    const highNum = high.trim() ? parseInt(high.trim(), 10) : undefined;
    if (lowNum == null && highNum == null && !priceLabel.trim()) {
      Alert.alert(tr('Faltan datos'), tr('Indica un rango de precio o una nota'));
      return;
    }
    setPriceSaving(true);
    setPriceResult(null);
    try {
      const res = await api.post('/business/price', { low: lowNum, high: highNum, label: priceLabel.trim() }, { headers: { Authorization: `Bearer ${token}` } });
      setPriceResult(res);
      if (res?.submitted) {
        setLow(''); setHigh(''); setPriceLabel('');
        await loadSubs();
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || tr('No se pudo enviar el precio'));
    } finally {
      setPriceSaving(false);
    }
  };

  const hasSubs = subs.events.length > 0 || subs.media.length > 0 || subs.prices.length > 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.hTitle}>{tr('Mi contenido')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 100 }} keyboardShouldPersistTaps="handled">

          {/* (a) Photo upload */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{tr('Sube una foto')}</Text>
            <Text style={styles.hint}>{tr('Tu foto pasa por revisión de IA y del equipo antes de aparecer en tu galería.')}</Text>
            <TextInput
              style={[styles.input, { marginTop: SPACING.sm }]}
              value={caption}
              onChangeText={setCaption}
              placeholder={tr('Descripción breve (opcional)')}
              placeholderTextColor={COLORS.textMuted}
              maxLength={140}
            />
            <TouchableOpacity style={[styles.uploadBtn, uploading && { opacity: 0.6 }]} onPress={handlePickPhoto} disabled={uploading}>
              {uploading ? <ActivityIndicator size="small" color={COLORS.white} /> : (
                <>
                  <Ionicons name="camera" size={16} color={COLORS.white} />
                  <Text style={styles.uploadBtnText}>{tr('Elegir foto')}</Text>
                </>
              )}
            </TouchableOpacity>
            {photoResult && (
              photoResult.submitted === false ? (
                <View style={[styles.resultBox, { backgroundColor: 'rgba(239,68,68,0.10)', borderColor: '#EF4444' }]}>
                  <Ionicons name="close-circle" size={16} color="#EF4444" />
                  <Text style={[styles.resultText, { color: '#EF4444' }]}>{photoResult.reason || tr('Imagen rechazada')}</Text>
                </View>
              ) : (
                <View style={[styles.resultBox, { backgroundColor: 'rgba(245,158,11,0.10)', borderColor: '#F59E0B' }]}>
                  <Ionicons name="hourglass" size={16} color="#F59E0B" />
                  <Text style={[styles.resultText, { color: '#F59E0B' }]}>{tr('En revisión')}</Text>
                </View>
              )
            )}
          </View>

          {/* (b) Price submit */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{tr('Envía un precio')}</Text>
            <View style={styles.priceRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>{tr('Desde (COP)')}</Text>
                <TextInput style={styles.input} value={low} onChangeText={setLow} placeholder="50000" placeholderTextColor={COLORS.textMuted} keyboardType="numeric" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>{tr('Hasta (COP)')}</Text>
                <TextInput style={styles.input} value={high} onChangeText={setHigh} placeholder="120000" placeholderTextColor={COLORS.textMuted} keyboardType="numeric" />
              </View>
            </View>
            <Text style={styles.label}>{tr('Nota (opcional)')}</Text>
            <TextInput
              style={styles.input}
              value={priceLabel}
              onChangeText={setPriceLabel}
              placeholder={tr('Ej: por persona, incluye bebida')}
              placeholderTextColor={COLORS.textMuted}
              maxLength={120}
            />
            <Text style={styles.hint}>{tr('Tu precio se muestra como "informado por el negocio", nunca como precio oficial verificado.')}</Text>
            <TouchableOpacity style={[styles.saveBtn, priceSaving && { opacity: 0.6 }]} onPress={handleSubmitPrice} disabled={priceSaving}>
              {priceSaving ? <ActivityIndicator size="small" color={COLORS.white} /> : (
                <>
                  <Ionicons name="pricetag" size={16} color={COLORS.white} />
                  <Text style={styles.saveText}>{tr('Enviar precio')}</Text>
                </>
              )}
            </TouchableOpacity>
            {priceResult?.submitted && (
              <View style={[styles.resultBox, { backgroundColor: 'rgba(245,158,11,0.10)', borderColor: '#F59E0B' }]}>
                <Ionicons name="hourglass" size={16} color="#F59E0B" />
                <Text style={[styles.resultText, { color: '#F59E0B' }]}>{tr('Precio enviado a revisión')}</Text>
              </View>
            )}
          </View>

          {/* (c) Mis envíos — status of everything ever submitted */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{tr('Mis envíos')}</Text>
            {subsLoading ? (
              <ActivityIndicator color={COLORS.primary} style={{ marginTop: SPACING.md }} />
            ) : !hasSubs ? (
              <Text style={styles.empty}>{tr('Aún no has enviado contenido')}</Text>
            ) : (
              <>
                {subs.media.map((m: any) => {
                  const meta = statusMeta(m.status);
                  return (
                    <View key={m.media_id} style={styles.subCard}>
                      <View style={styles.subRow}>
                        <View style={[styles.typeTag, { backgroundColor: 'rgba(59,130,246,0.15)' }]}>
                          <Text style={styles.typeTagText}>{tr('Foto')}</Text>
                        </View>
                        <View style={[styles.chip, { backgroundColor: meta.bg }]}>
                          <Text style={[styles.chipText, { color: meta.color }]}>{meta.label}</Text>
                        </View>
                      </View>
                      {!!m.caption && <Text style={styles.subDesc}>{m.caption}</Text>}
                      {m.status === 'rejected' && !!m.reason && <Text style={styles.subReason}>{m.reason}</Text>}
                    </View>
                  );
                })}
                {subs.prices.map((p: any) => {
                  const meta = statusMeta(p.status);
                  const range = fmtPriceRange(p);
                  return (
                    <View key={p.price_id} style={styles.subCard}>
                      <View style={styles.subRow}>
                        <View style={[styles.typeTag, { backgroundColor: 'rgba(212,175,55,0.15)' }]}>
                          <Text style={styles.typeTagText}>{tr('Precio')}</Text>
                        </View>
                        <View style={[styles.chip, { backgroundColor: meta.bg }]}>
                          <Text style={[styles.chipText, { color: meta.color }]}>{meta.label}</Text>
                        </View>
                      </View>
                      <Text style={styles.subDesc}>{range || p.label || tr('Sin datos')}</Text>
                      {!!range && !!p.label && <Text style={styles.subMeta}>{p.label}</Text>}
                      {p.status === 'rejected' && !!p.reason && <Text style={styles.subReason}>{p.reason}</Text>}
                    </View>
                  );
                })}
                {subs.events.map((e: any) => {
                  const meta = statusMeta(e.moderation_status);
                  return (
                    <View key={e.event_id} style={styles.subCard}>
                      <View style={styles.subRow}>
                        <View style={[styles.typeTag, { backgroundColor: 'rgba(168,85,247,0.15)' }]}>
                          <Text style={styles.typeTagText}>{tr('Evento')}</Text>
                        </View>
                        <View style={[styles.chip, { backgroundColor: meta.bg }]}>
                          <Text style={[styles.chipText, { color: meta.color }]}>{meta.label}</Text>
                        </View>
                      </View>
                      <Text style={styles.subDesc}>{e.title}</Text>
                      <Text style={styles.subMeta}>{e.date}</Text>
                      {e.moderation_status === 'rejected' && !!e.moderation_reason && <Text style={styles.subReason}>{e.moderation_reason}</Text>}
                    </View>
                  );
                })}
              </>
            )}
          </View>
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

  section: { marginBottom: SPACING.xl, paddingBottom: SPACING.lg, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  sectionTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold, marginBottom: SPACING.xs },
  hint: { fontSize: 11.5, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 16, marginTop: 4 },
  empty: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, fontStyle: 'italic', marginTop: SPACING.sm },

  label: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: SPACING.md, marginBottom: SPACING.xs },
  input: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: SPACING.md, paddingVertical: 12, color: COLORS.textMain, fontSize: 14, ...FONTS.regular },
  priceRow: { flexDirection: 'row', gap: SPACING.sm },

  uploadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: RADIUS.full, marginTop: SPACING.md },
  uploadBtnText: { color: COLORS.white, fontSize: 13, ...FONTS.bold },

  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 14, marginTop: SPACING.lg },
  saveText: { color: COLORS.white, fontSize: 14, ...FONTS.bold },

  resultBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: RADIUS.lg, borderWidth: 1, padding: SPACING.sm, marginTop: SPACING.md },
  resultText: { flex: 1, fontSize: 12.5, ...FONTS.semibold, lineHeight: 17 },

  subCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, marginTop: SPACING.sm },
  subRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  typeTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full },
  typeTagText: { fontSize: 10, color: COLORS.textMain, ...FONTS.bold, letterSpacing: 0.3 },
  chip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: RADIUS.full },
  chipText: { fontSize: 10.5, ...FONTS.bold, letterSpacing: 0.3 },
  subDesc: { fontSize: 13, color: COLORS.textMain, ...FONTS.regular, marginTop: SPACING.sm },
  subMeta: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },
  subReason: { fontSize: 12, color: '#EF4444', ...FONTS.regular, marginTop: SPACING.xs, lineHeight: 16 },
});
