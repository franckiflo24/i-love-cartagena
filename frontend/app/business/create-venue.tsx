import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { Alert } from '../../src/lib/alert';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { useBusinessAuth } from '../../src/context/BusinessAuthContext';
import { api } from '../../src/constants/api';
import { useTr } from '../../src/i18n/autoTr';

// B1D — Create a NEW venue. Reachable only after the search step. A server-side
// dedup precheck runs first; a near-duplicate blocks the create and routes the
// partner to CLAIM the existing record instead. New venues enter as a
// pending_review DRAFT — never live until an admin approves.
const CATEGORIES = ['restaurant', 'bar', 'beach_club', 'club', 'hotel', 'cafe', 'spa', 'activity', 'service', 'beauty', 'yacht', 'attraction'];

// Subcategory keys MUST match SUBCATEGORIES in explore.tsx + the essentials
// need_states.json, so an approved venue slots under the right browse/gate.
const SUBCATS: Record<string, { key: string; label: string }[]> = {
  service: [
    { key: 'pharmacy', label: 'Farmacia' }, { key: 'currency_exchange', label: 'Cambio de divisas' },
    { key: 'bank', label: 'Banco / Cajero' }, { key: 'grocery', label: 'Supermercado' },
    { key: 'laundry', label: 'Lavandería' }, { key: 'coworking', label: 'Coworking' },
    { key: 'sim_card', label: 'SIM / eSIM' }, { key: 'medical', label: 'Médico / Clínica' },
    { key: 'veterinary', label: 'Veterinaria' }, { key: 'luggage_storage', label: 'Guarda-equipaje' },
    { key: 'rental', label: 'Alquiler' },
  ],
  restaurant: [
    { key: 'seafood', label: 'Mariscos' }, { key: 'colombian', label: 'Colombiana' },
    { key: 'international', label: 'Internacional' }, { key: 'italian', label: 'Italiana' }, { key: 'asian', label: 'Asiática' },
  ],
  bar: [{ key: 'cocktail_bar', label: 'Cocktail Bar' }, { key: 'rooftop', label: 'Rooftop' }, { key: 'salsa_bar', label: 'Salsa' }],
  beauty: [{ key: 'salon', label: 'Salón' }, { key: 'barbershop', label: 'Barbería' }, { key: 'nails', label: 'Uñas' }, { key: 'facial_spa', label: 'Facial & Spa' }],
};

export default function CreateVenue() {
  const tr = useTr();
  const router = useRouter();
  const params = useLocalSearchParams<{ name?: string }>();
  const { token, business, refresh, loading: authLoading } = useBusinessAuth();
  const [name, setName] = useState(params.name || '');
  const [category, setCategory] = useState('restaurant');
  const [subcategory, setSubcategory] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [nit, setNit] = useState<string>((business as any)?.nit || '');
  const [dupes, setDupes] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  if (!authLoading && !token) { router.replace('/business/login' as any); return null; }

  const submit = async () => {
    if (name.trim().length < 2 || !category) { Alert.alert(tr('Faltan datos'), tr('Ingresa el nombre y la categoría')); return; }
    if (nit.replace(/\D/g, '').length < 5) { Alert.alert(tr('NIT requerido'), tr('Ingresa el NIT o registro del negocio')); return; }
    setBusy(true); setDupes([]);
    try {
      // 1) dedup precheck — surface existing candidates before creating.
      const pre = await api.post('/business/venues/precheck', { name: name.trim(), neighborhood: neighborhood.trim() }, { headers: { Authorization: `Bearer ${token}` } });
      if (pre.blocked) {
        setDupes(pre.candidates || []);
        setBusy(false);
        return;
      }
      // 2) create the draft.
      const r = await api.post('/business/venues/create', {
        name: name.trim(), category, subcategory, neighborhood: neighborhood.trim(),
        description: description.trim(), phone: phone.trim(), website: website.trim(), nit: nit.trim(),
      }, { headers: { Authorization: `Bearer ${token}` } });
      await refresh();
      // Route DIRECTLY on success — never gate navigation on an Alert button's onPress
      // (Alert is a no-op on react-native-web). The message is informational; AlertHost
      // is at the app root so it still shows over the destination.
      router.replace('/business/dashboard' as any);
      Alert.alert(tr('Enviado a revisión'), tr('Tu negocio pasó a revisión del equipo. No aparece en el catálogo hasta ser aprobado.'));
      void r;
    } catch (e: any) {
      Alert.alert(tr('No se pudo crear'), tr('Ya existe un negocio muy similar. Recláchalo en vez de crear uno nuevo.').replace('Recláchalo', 'Reclámalo'));
    }
    setBusy(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.hTitle}>{tr('Crear negocio')}</Text>
        <View style={{ width: 40 }} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>{tr('Nombre del negocio')}</Text>
          <View style={styles.inputWrap}><TextInput style={styles.input} value={name} onChangeText={setName} placeholder={tr('Nombre')} placeholderTextColor={COLORS.textMuted} /></View>

          <Text style={styles.label}>{tr('Categoría')}</Text>
          <View style={styles.chips}>
            {CATEGORIES.map(c => (
              <TouchableOpacity key={c} style={[styles.chip, category === c && styles.chipActive]} onPress={() => { setCategory(c); setSubcategory(''); }}>
                <Text style={[styles.chipText, category === c && styles.chipTextActive]}>{tr(c)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {SUBCATS[category] ? (
            <>
              <Text style={styles.label}>{tr('Tipo')}</Text>
              <View style={styles.chips}>
                {SUBCATS[category].map(sc => (
                  <TouchableOpacity key={sc.key} style={[styles.chip, subcategory === sc.key && styles.chipActive]} onPress={() => setSubcategory(sc.key)}>
                    <Text style={[styles.chipText, subcategory === sc.key && styles.chipTextActive]}>{tr(sc.label)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          ) : null}

          <Text style={styles.label}>{tr('Barrio')}</Text>
          <View style={styles.inputWrap}><TextInput style={styles.input} value={neighborhood} onChangeText={setNeighborhood} placeholder="Getsemaní, Centro, Bocagrande…" placeholderTextColor={COLORS.textMuted} /></View>

          <Text style={styles.label}>{tr('Descripción')}</Text>
          <TextInput style={styles.textarea} value={description} onChangeText={setDescription} placeholder={tr('Cuéntanos sobre tu negocio')} placeholderTextColor={COLORS.textMuted} multiline />

          <Text style={styles.label}>{tr('Teléfono')}</Text>
          <View style={styles.inputWrap}><TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="+57…" placeholderTextColor={COLORS.textMuted} keyboardType="phone-pad" /></View>

          <Text style={styles.label}>{tr('Sitio web')}</Text>
          <View style={styles.inputWrap}><TextInput style={styles.input} value={website} onChangeText={setWebsite} placeholder="https://" placeholderTextColor={COLORS.textMuted} autoCapitalize="none" /></View>

          <Text style={styles.label}>{tr('NIT o registro del negocio')}</Text>
          <View style={styles.inputWrap}><TextInput style={styles.input} value={nit} onChangeText={setNit} placeholder={tr('Ej: 900.123.456-7')} placeholderTextColor={COLORS.textMuted} autoCapitalize="none" autoCorrect={false} /></View>

          {dupes.length > 0 && (
            <View style={styles.dupBox}>
              <View style={styles.dupHead}><Ionicons name="warning" size={16} color={COLORS.primary} /><Text style={styles.dupTitle}>{tr('Ya existe algo muy parecido')}</Text></View>
              <Text style={styles.dupSub}>{tr('Para evitar duplicados, reclama el negocio existente:')}</Text>
              {dupes.map(d => (
                <TouchableOpacity key={d.partner_id} style={styles.dupItem} onPress={() => router.replace(`/business/claim/${d.partner_id}` as any)}>
                  <Text style={styles.dupName} numberOfLines={1}>{d.name}</Text>
                  <View style={styles.dupClaim}><Text style={styles.dupClaimText}>{tr('Reclamar')}</Text><Ionicons name="chevron-forward" size={14} color={COLORS.primary} /></View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <TouchableOpacity style={[styles.submit, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator size="small" color={COLORS.white} /> : (
              <>
                <Ionicons name="cloud-upload-outline" size={18} color={COLORS.white} />
                <Text style={styles.submitText}>{tr('Enviar para revisión')}</Text>
              </>
            )}
          </TouchableOpacity>
          <Text style={styles.footNote}>{tr('Los negocios nuevos son revisados por el equipo antes de aparecer en el catálogo.')}</Text>
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
  scroll: { padding: SPACING.lg, paddingBottom: SPACING.xl * 2 },
  label: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: SPACING.md, marginBottom: SPACING.xs },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: SPACING.md, height: 50 },
  input: { flex: 1, color: COLORS.textMain, fontSize: 14, ...FONTS.regular },
  textarea: { minHeight: 90, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, color: COLORS.textMain, fontSize: 14, ...FONTS.regular, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  chip: { paddingHorizontal: SPACING.md, paddingVertical: 8, borderRadius: RADIUS.full, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold },
  chipTextActive: { color: COLORS.white },
  dupBox: { marginTop: SPACING.lg, padding: SPACING.md, backgroundColor: 'rgba(245,11,27,0.08)', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.primary },
  dupHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dupTitle: { fontSize: 13, color: COLORS.textMain, ...FONTS.bold },
  dupSub: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginTop: 4, marginBottom: SPACING.sm },
  dupItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.md, marginTop: SPACING.sm },
  dupName: { fontSize: 13, color: COLORS.textMain, ...FONTS.semibold, flex: 1 },
  dupClaim: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  dupClaimText: { color: COLORS.primary, fontSize: 12, ...FONTS.bold },
  submit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 15, marginTop: SPACING.xl },
  submitText: { color: COLORS.white, fontSize: 14, ...FONTS.bold },
  footNote: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', marginTop: SPACING.md, lineHeight: 16 },
});
