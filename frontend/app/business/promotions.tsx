import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { useBusinessAuth } from '../../src/context/BusinessAuthContext';
import { api } from '../../src/constants/api';
import { useTr } from '../../src/i18n/autoTr';

// B3 — Partner promotion management. The deals a partner publishes here surface
// in "Ofertas del día" on the consumer home (GET /promotions/today). That
// endpoint filters {is_active:true, valid_until >= today} AND drops promos whose
// venue isn't catalog-approved — so this screen makes valid_until REQUIRED (an
// empty date would silently never appear) and blocks publishing until the venue
// is approved. Colors mirror the consumer CAT_COLORS so what the partner picks
// is what the guest sees.
const PROMO_CATS: { key: string; label: string; color: string }[] = [
  { key: 'gastronomy', label: 'Gastronomía', color: '#F97316' },
  { key: 'music', label: 'Música', color: '#A855F7' },
  { key: 'party', label: 'Fiesta', color: '#EC4899' },
  { key: 'wellness', label: 'Wellness', color: '#22C55E' },
  { key: 'art', label: 'Arte', color: '#3B82F6' },
  { key: 'popup', label: 'Pop-up', color: '#06B6D4' },
];

const DURATIONS: { label: string; days: number }[] = [
  { label: '3 días', days: 3 },
  { label: '1 semana', days: 7 },
  { label: '2 semanas', days: 14 },
  { label: '1 mes', days: 30 },
];

const todayISO = () => new Date().toISOString().slice(0, 10);
const isoPlusDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const onlyDigits = (s: string) => s.replace(/\D/g, '');

export default function BusinessPromotions() {
  const tr = useTr();
  const router = useRouter();
  const { token, partner, loading: authLoading } = useBusinessAuth();

  const [promos, setPromos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // form
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('gastronomy');
  const [tagLabel, setTagLabel] = useState('');
  const [discountPct, setDiscountPct] = useState('');
  const [originalPrice, setOriginalPrice] = useState('');
  const [promoPrice, setPromoPrice] = useState('');
  const [validDays, setValidDays] = useState<number | null>(null);
  const [description, setDescription] = useState('');

  // Hard gate: the API's _require_content_owner 403s pending_review/rejected, so
  // disable publishing there. `willShowPublicly` mirrors PUBLIC_PARTNER_FILTER —
  // a promo only reaches the consumer feed from a catalog-public venue, so the
  // success copy must not claim "ya aparece" for a sandbox/unapproved venue.
  const notApproved = partner?.catalog_status === 'pending_review' || partner?.catalog_status === 'rejected';
  // Mirror PUBLIC_PARTNER_FILTER field-for-field (catalog_status AND legacy status),
  // so "ya aparece en Ofertas del día" is never claimed for a venue guests can't see.
  const willShowPublicly = !!partner
    && !['pending_review', 'rejected', 'sandbox'].includes(partner.catalog_status || '')
    && !['pending_review', 'rejected', 'needs_verification'].includes((partner as any).status || '');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api.get('/business/promotions', { headers: { Authorization: `Bearer ${token}` } });
      setPromos(Array.isArray(data?.promotions) ? data.promotions : []);
    } catch (e) { console.error('[promotions] load', e); }
  }, [token]);

  useEffect(() => {
    if (authLoading) return;
    if (!token) { router.replace('/business/login' as any); return; }
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [token, authLoading, load, router]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => {
    setTitle(''); setTagLabel(''); setDiscountPct('');
    setOriginalPrice(''); setPromoPrice(''); setDescription(''); setValidDays(null);
  };

  const submit = async () => {
    const dp = parseInt(discountPct || '0', 10) || 0;
    const op = parseInt(onlyDigits(originalPrice) || '0', 10) || 0;
    const pp = parseInt(onlyDigits(promoPrice) || '0', 10) || 0;

    if (title.trim().length < 2) { Alert.alert(tr('Falta el título'), tr('Ponle un título a tu oferta.')); return; }
    if (validDays == null) { Alert.alert(tr('Falta la vigencia'), tr('Elige hasta cuándo es válida. Sin fecha, la oferta no se muestra.')); return; }
    if (!tagLabel.trim() && !dp && !pp) {
      Alert.alert(tr('Falta el gancho'), tr('Agrega una etiqueta (ej. 2x1), un % de descuento o un precio de oferta.'));
      return;
    }
    if (dp && (dp < 1 || dp > 100)) { Alert.alert(tr('Descuento inválido'), tr('El descuento debe estar entre 1 y 100%.')); return; }
    if (op && pp && pp > op) { Alert.alert(tr('Precios invertidos'), tr('El precio de oferta no puede superar al precio normal.')); return; }

    setBusy(true);
    try {
      const payload: Record<string, any> = {
        title: title.trim(),
        category,
        tag_label: tagLabel.trim(),
        valid_until: isoPlusDays(validDays),
        description: description.trim(),
      };
      if (dp) payload.discount_pct = dp;
      if (op) payload.original_price = op;
      if (pp) payload.promo_price = pp;
      // Reuse the venue's self-hosted photo so the consumer card has an image
      // without a separate upload. Backend rejects any non-/images/ URL (422).
      if (partner?.image_url && partner.image_url.startsWith('/images/')) payload.image_url = partner.image_url;

      const created = await api.post('/business/promotions', payload, { headers: { Authorization: `Bearer ${token}` } });
      setPromos((prev) => [created, ...prev]);
      resetForm();
      Alert.alert(tr('Oferta publicada'), willShowPublicly
        ? tr('Ya aparece en "Ofertas del día" en la pantalla principal.')
        : tr('Se publicará en "Ofertas del día" cuando tu negocio esté aprobado y público.'));
    } catch (e: any) {
      Alert.alert(tr('No se pudo publicar'), e?.message || tr('Intenta de nuevo en un momento.'));
    }
    setBusy(false);
  };

  const toggleActive = async (promo: any) => {
    try {
      const upd = await api.put(`/business/promotions/${promo.promo_id}`, { is_active: !promo.is_active }, { headers: { Authorization: `Bearer ${token}` } });
      const next = typeof upd?.is_active === 'boolean' ? upd.is_active : !promo.is_active;
      setPromos((prev) => prev.map((p) => (p.promo_id === promo.promo_id ? { ...p, is_active: next } : p)));
    } catch (e: any) { Alert.alert(tr('No se pudo actualizar'), e?.message || tr('Intenta de nuevo.')); }
  };

  const del = (promo: any) => {
    const doDel = async () => {
      try { await api.delete(`/business/promotions/${promo.promo_id}`, { headers: { Authorization: `Bearer ${token}` } }); }
      catch (e: any) { Alert.alert('Error', e?.message || tr('No se pudo eliminar')); return; }
      setPromos((prev) => prev.filter((p) => p.promo_id !== promo.promo_id));
    };
    if (Platform.OS === 'web') { if (window.confirm(tr('¿Eliminar esta oferta?'))) doDel(); }
    else Alert.alert(tr('Eliminar oferta'), tr('¿Eliminar esta oferta?'), [
      { text: tr('Cancelar'), style: 'cancel' },
      { text: tr('Eliminar'), style: 'destructive', onPress: doDel },
    ]);
  };

  const statusOf = (p: any): { label: string; color: string } => {
    if ((p.valid_until || '') && p.valid_until < todayISO()) return { label: tr('EXPIRADA'), color: COLORS.textMuted };
    if (!p.is_active) return { label: tr('PAUSADA'), color: '#F59E0B' };
    return { label: tr('EN VIVO'), color: '#22C55E' };
  };

  const valueOf = (p: any): string => {
    if (p.promo_price > 0) {
      if (p.original_price > 0 && p.original_price !== p.promo_price) return `$${(p.original_price / 1000).toFixed(0)}K → $${(p.promo_price / 1000).toFixed(0)}K`;
      return `$${(p.promo_price / 1000).toFixed(0)}K`;
    }
    if (p.discount_pct > 0) return `-${p.discount_pct}%`;
    if (p.tag_label) return p.tag_label;
    return '—';
  };

  if (authLoading || loading) {
    return <SafeAreaView style={styles.container}><ActivityIndicator size="large" color={COLORS.primary} style={{ flex: 1 }} /></SafeAreaView>;
  }

  const catColor = PROMO_CATS.find((c) => c.key === category)?.color || COLORS.primary;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.hTitle}>{tr('Promociones')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* The loop, stated plainly */}
          <View style={styles.loopCard}>
            <Ionicons name="flash" size={16} color={COLORS.primary} />
            <Text style={styles.loopText}>{tr('Tus ofertas aparecen en "Ofertas del día" en la pantalla principal de la app.')}</Text>
          </View>

          {notApproved && (
            <View style={styles.gateBanner}>
              <Ionicons name="hourglass-outline" size={18} color="#3B82F6" />
              <Text style={styles.gateText}>{tr('Tu negocio está en revisión. Podrás publicar ofertas cuando el equipo lo apruebe.')}</Text>
            </View>
          )}

          {/* ── Create form ── */}
          <Text style={styles.formTitle}>{tr('Nueva oferta')}</Text>

          <Text style={styles.label}>{tr('Título')}</Text>
          <View style={styles.inputWrap}><TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder={tr('Ej. 2x1 en cócteles al atardecer')} placeholderTextColor={COLORS.textMuted} maxLength={200} /></View>

          <Text style={styles.label}>{tr('Categoría')}</Text>
          <View style={styles.chips}>
            {PROMO_CATS.map((c) => {
              const active = category === c.key;
              return (
                <TouchableOpacity key={c.key} style={[styles.chip, active && { backgroundColor: c.color, borderColor: c.color }]} onPress={() => setCategory(c.key)}>
                  <View style={[styles.catDot, { backgroundColor: active ? COLORS.white : c.color }]} />
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{tr(c.label)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>{tr('Etiqueta / gancho')}</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="pricetag-outline" size={16} color={COLORS.textMuted} style={{ marginRight: 8 }} />
            <TextInput style={styles.input} value={tagLabel} onChangeText={setTagLabel} placeholder={tr('2x1 · Happy Hour · -30%')} placeholderTextColor={COLORS.textMuted} maxLength={40} />
          </View>

          <Text style={styles.label}>{tr('Descuento (opcional)')}</Text>
          <View style={styles.rowGap}>
            <View style={[styles.inputWrap, { flex: 1 }]}>
              <TextInput style={styles.input} value={discountPct} onChangeText={(t) => setDiscountPct(onlyDigits(t).slice(0, 3))} placeholder="%" placeholderTextColor={COLORS.textMuted} keyboardType="number-pad" />
              <Text style={styles.suffix}>%</Text>
            </View>
            <View style={[styles.inputWrap, { flex: 1.4 }]}>
              <Text style={styles.prefix}>$</Text>
              <TextInput style={styles.input} value={originalPrice} onChangeText={(t) => setOriginalPrice(onlyDigits(t))} placeholder={tr('Precio normal')} placeholderTextColor={COLORS.textMuted} keyboardType="number-pad" />
            </View>
            <View style={[styles.inputWrap, { flex: 1.4 }]}>
              <Text style={styles.prefix}>$</Text>
              <TextInput style={styles.input} value={promoPrice} onChangeText={(t) => setPromoPrice(onlyDigits(t))} placeholder={tr('Precio oferta')} placeholderTextColor={COLORS.textMuted} keyboardType="number-pad" />
            </View>
          </View>
          <Text style={styles.helper}>{tr('Usa un % o un par de precios (COP). Al menos un gancho es obligatorio.')}</Text>

          <Text style={styles.label}>{tr('Válida hasta')}</Text>
          <View style={styles.chips}>
            {DURATIONS.map((d) => {
              const active = validDays === d.days;
              return (
                <TouchableOpacity key={d.days} style={[styles.chip, active && styles.chipActive]} onPress={() => setValidDays(d.days)}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{tr(d.label)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.helper}>
            {validDays != null
              ? tr(`Se muestra hasta el ${isoPlusDays(validDays)} y luego se oculta sola.`)
              : tr('Obligatorio: sin fecha de vigencia la oferta no se muestra.')}
          </Text>

          <Text style={styles.label}>{tr('Detalle (opcional)')}</Text>
          <TextInput style={styles.textarea} value={description} onChangeText={setDescription} placeholder={tr('Condiciones, horario, reservas…')} placeholderTextColor={COLORS.textMuted} multiline maxLength={1000} />

          <TouchableOpacity style={[styles.submit, { backgroundColor: catColor }, (busy || notApproved) && { opacity: 0.5 }]} onPress={submit} disabled={busy || notApproved}>
            {busy ? <ActivityIndicator size="small" color={COLORS.white} /> : (
              <>
                <Ionicons name="megaphone-outline" size={18} color={COLORS.white} />
                <Text style={styles.submitText}>{tr('Publicar oferta')}</Text>
              </>
            )}
          </TouchableOpacity>

          {/* ── Existing promos ── */}
          <View style={styles.listHeader}>
            <Text style={styles.formTitle}>{tr('Tus ofertas')}</Text>
            {promos.length > 0 && <Text style={styles.count}>{promos.length}</Text>}
          </View>

          {promos.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="megaphone-outline" size={40} color={COLORS.textMuted} />
              <Text style={styles.emptyText}>{tr('Aún no has publicado ofertas.')}</Text>
            </View>
          ) : (
            promos.map((p) => {
              const st = statusOf(p);
              const pc = PROMO_CATS.find((c) => c.key === p.category);
              const expired = (p.valid_until || '') && p.valid_until < todayISO();
              return (
                <View key={p.promo_id} style={[styles.promoRow, expired && { opacity: 0.6 }]}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.promoTopRow}>
                      <View style={[styles.statusPill, { backgroundColor: st.color + '22', borderColor: st.color }]}>
                        <View style={[styles.statusDot, { backgroundColor: st.color }]} />
                        <Text style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
                      </View>
                      {pc && (
                        <View style={[styles.catTag, { borderColor: pc.color }]}>
                          <Text style={[styles.catTagText, { color: pc.color }]}>{tr(pc.label)}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.promoName} numberOfLines={1}>{p.title}</Text>
                    <View style={styles.promoMetaRow}>
                      <Text style={styles.promoValue}>{valueOf(p)}</Text>
                      <Text style={styles.promoMeta}>· {tr('hasta')} {p.valid_until || '—'}</Text>
                      <Text style={styles.promoMeta}>· 👁 {p.click_count || 0}</Text>
                    </View>
                  </View>
                  <View style={styles.promoActions}>
                    <TouchableOpacity style={styles.iconBtn} onPress={() => toggleActive(p)} disabled={!!expired}>
                      <Ionicons name={p.is_active ? 'pause' : 'play'} size={16} color={expired ? COLORS.textMuted : COLORS.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.iconBtn, styles.delBtn]} onPress={() => del(p)}>
                      <Ionicons name="trash-outline" size={16} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
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
  hTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold },
  scroll: { padding: SPACING.lg, paddingBottom: SPACING.xl * 2 },

  loopCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(217,119,6,0.10)', borderWidth: 1, borderColor: COLORS.primary, borderRadius: RADIUS.lg, padding: SPACING.md },
  loopText: { flex: 1, fontSize: 12, color: COLORS.textMain, ...FONTS.medium, lineHeight: 17 },

  gateBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(59,130,246,0.10)', borderWidth: 1, borderColor: '#3B82F6', borderRadius: RADIUS.lg, padding: SPACING.md, marginTop: SPACING.md },
  gateText: { flex: 1, fontSize: 12, color: COLORS.textMain, ...FONTS.medium, lineHeight: 17 },

  formTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold, marginTop: SPACING.lg },
  label: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: SPACING.md, marginBottom: SPACING.xs },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: SPACING.md, height: 50 },
  input: { flex: 1, color: COLORS.textMain, fontSize: 14, ...FONTS.regular },
  prefix: { color: COLORS.textMuted, fontSize: 14, ...FONTS.semibold, marginRight: 4 },
  suffix: { color: COLORS.textMuted, fontSize: 14, ...FONTS.semibold, marginLeft: 4 },
  rowGap: { flexDirection: 'row', gap: SPACING.sm },
  textarea: { minHeight: 80, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, color: COLORS.textMain, fontSize: 14, ...FONTS.regular, textAlignVertical: 'top' },
  helper: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginTop: SPACING.xs, lineHeight: 15 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SPACING.md, paddingVertical: 8, borderRadius: RADIUS.full, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold },
  chipTextActive: { color: COLORS.white },
  catDot: { width: 8, height: 8, borderRadius: 4 },

  submit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: RADIUS.full, paddingVertical: 15, marginTop: SPACING.xl },
  submitText: { color: COLORS.white, fontSize: 14, ...FONTS.bold },

  listHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: SPACING.xl },
  count: { fontSize: 12, color: COLORS.primary, ...FONTS.bold, backgroundColor: 'rgba(217,119,6,0.15)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.full, overflow: 'hidden' },
  empty: { alignItems: 'center', gap: SPACING.sm, padding: SPACING.xl, marginTop: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed' },
  emptyText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center' },

  promoRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, marginTop: SPACING.sm },
  promoTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.full, borderWidth: 1 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 9, ...FONTS.bold, letterSpacing: 0.5 },
  catTag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: RADIUS.full, borderWidth: 1 },
  catTagText: { fontSize: 9, ...FONTS.bold, letterSpacing: 0.3 },
  promoName: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  promoMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, flexWrap: 'wrap' },
  promoValue: { fontSize: 12, color: COLORS.primary, ...FONTS.bold },
  promoMeta: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  promoActions: { flexDirection: 'row', gap: 6 },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.background },
  delBtn: { borderColor: 'rgba(239,68,68,0.4)' },
});
