import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, Share, ActivityIndicator, Clipboard } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../../src/constants/theme';
import { api } from '../../../src/constants/api';

const CATEGORIES = [
  { id: 'restaurant', label: 'Restaurante' },
  { id: 'club', label: 'Bar / Club' },
  { id: 'beach_club', label: 'Beach Club' },
  { id: 'hotel', label: 'Hotel' },
  { id: 'wellness', label: 'Spa / Wellness' },
  { id: 'culture', label: 'Cultura' },
  { id: 'shopping', label: 'Shopping' },
  { id: 'realestate', label: 'Inmobiliaria' },
];

const TIERS = [
  { id: 'popular',  label: 'Popular', color: '#94A3B8' },
  { id: 'premium',  label: 'Premium', color: '#D97706' },
  { id: 'elite',    label: 'Elite',   color: '#A855F7' },
  { id: 'lujo',     label: 'Lujo',    color: '#FBBF24' },
];

export default function OperatorNewPartner() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('restaurant');
  const [tier, setTier] = useState('popular');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ activation_url: string; whatsapp_message: string; name: string } | null>(null);

  const submit = async () => {
    if (!name || !email) {
      Alert.alert('Faltan datos', 'Nombre y email del dueño son obligatorios');
      return;
    }
    setLoading(true);
    try {
      const tok = await AsyncStorage.getItem('admin_operator_token');
      const data = await api.post('/admin/operator/partners', {
        name, category, tier, owner_email: email, address, phone,
      }, { headers: { Authorization: `Bearer ${tok}` } });
      setResult({ activation_url: data.activation_url, whatsapp_message: data.whatsapp_message, name });
    } catch (e: any) {
      const msg = String(e?.message || 'Error');
      Alert.alert('Error', msg.includes('409') ? 'Ya existe un partner con ese email.' : 'No se pudo crear.');
    }
    setLoading(false);
  };

  const copy = async () => {
    if (!result) return;
    try {
      // expo Clipboard fallback — dynamic import handles missing package gracefully
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const Clip = await import('expo-clipboard').then((m: any) => m).catch(() => null);
      if (Clip?.setStringAsync) await Clip.setStringAsync(result.activation_url);
      else (Clipboard as any).setString?.(result.activation_url);
      Alert.alert('Copiado', 'Link copiado al portapapeles');
    } catch {
      Alert.alert('Link', result.activation_url);
    }
  };

  const shareWhatsapp = async () => {
    if (!result) return;
    try { await Share.share({ message: result.whatsapp_message }); } catch { /* noop */ }
  };

  if (result) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.replace('/admin/operator' as any)} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
          </TouchableOpacity>
          <Text style={styles.title}>Partner creado</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: SPACING.lg }}>
          <View style={styles.successBox}>
            <Ionicons name="checkmark-circle" size={56} color="#22C55E" />
            <Text style={styles.successTitle}>{result.name}</Text>
            <Text style={styles.successDesc}>Perfil esqueleto listo. Comparte el link de activación con el partner para que cree su contraseña y complete su perfil.</Text>
          </View>

          <Text style={styles.lbl}>Link de activación único</Text>
          <View style={styles.linkBox}>
            <Text style={styles.linkText} numberOfLines={2} selectable>{result.activation_url}</Text>
          </View>

          <View style={styles.shareRow}>
            <TouchableOpacity style={[styles.shareBtn, { backgroundColor: '#25D366' }]} onPress={shareWhatsapp} activeOpacity={0.85}>
              <Ionicons name="logo-whatsapp" size={18} color="#FFF" />
              <Text style={styles.shareText}>Compartir por WhatsApp</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shareBtnSecondary} onPress={copy} activeOpacity={0.85}>
              <Ionicons name="copy" size={18} color={COLORS.primary} />
              <Text style={[styles.shareText, { color: COLORS.primary }]}>Copiar link</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace('/admin/operator' as any)}>
            <Text style={styles.doneText}>Volver a la lista</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
          </TouchableOpacity>
          <Text style={styles.title}>Nuevo partner</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: SPACING.lg }} keyboardShouldPersistTaps="handled">
          <Text style={styles.help}>Crea un perfil esqueleto. Luego el partner completa fotos, horarios y descripción al activar su cuenta.</Text>

          <Text style={styles.lbl}>Nombre del negocio *</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Ej: Casa Bohème" placeholderTextColor={COLORS.textMuted} />

          <Text style={styles.lbl}>Email del dueño *</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="dueno@correo.com" placeholderTextColor={COLORS.textMuted} autoCapitalize="none" keyboardType="email-address" />

          <Text style={styles.lbl}>Categoría</Text>
          <View style={styles.chipRow}>
            {CATEGORIES.map(c => (
              <TouchableOpacity key={c.id} style={[styles.chip, category === c.id && styles.chipActive]} onPress={() => setCategory(c.id)} activeOpacity={0.85}>
                <Text style={[styles.chipText, category === c.id && styles.chipTextActive]}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.lbl}>Tier</Text>
          <View style={styles.chipRow}>
            {TIERS.map(t => (
              <TouchableOpacity key={t.id} style={[styles.chip, tier === t.id && { backgroundColor: t.color + '22', borderColor: t.color }]} onPress={() => setTier(t.id)} activeOpacity={0.85}>
                <Text style={[styles.chipText, tier === t.id && { color: t.color, ...FONTS.bold }]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.lbl}>Dirección (opcional)</Text>
          <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="Calle 35 # 5-10, Centro" placeholderTextColor={COLORS.textMuted} />

          <Text style={styles.lbl}>Teléfono (opcional)</Text>
          <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="+57 300 123 4567" placeholderTextColor={COLORS.textMuted} keyboardType="phone-pad" />

          <TouchableOpacity style={[styles.submitBtn, loading && { opacity: 0.6 }]} onPress={submit} disabled={loading}>
            {loading ? <ActivityIndicator color="#FFF" /> : (
              <>
                <Ionicons name="paper-plane" size={16} color="#FFF" />
                <Text style={styles.submitText}>Crear partner + generar link</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold },
  help: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginBottom: SPACING.md, lineHeight: 18 },
  lbl: { fontSize: 11, color: COLORS.textMuted, ...FONTS.bold, letterSpacing: 0.4, marginTop: SPACING.md, marginBottom: 6, textTransform: 'uppercase' },
  input: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, fontSize: 14, color: COLORS.textMain, ...FONTS.regular },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: RADIUS.full, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  chipActive: { backgroundColor: `${COLORS.primary}22`, borderColor: COLORS.primary },
  chipText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold },
  chipTextActive: { color: COLORS.primary, ...FONTS.bold },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.primary, paddingVertical: 14, borderRadius: RADIUS.full, marginTop: SPACING.lg },
  submitText: { fontSize: 15, color: '#FFF', ...FONTS.bold },
  successBox: { alignItems: 'center', gap: SPACING.sm, padding: SPACING.lg },
  successTitle: { fontSize: 20, color: COLORS.textMain, ...FONTS.bold },
  successDesc: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', lineHeight: 19 },
  linkBox: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.primary, padding: SPACING.md, marginBottom: SPACING.md },
  linkText: { fontSize: 12, color: COLORS.primary, ...FONTS.semibold, fontFamily: 'monospace' },
  shareRow: { flexDirection: 'row', gap: 8, marginTop: SPACING.sm },
  shareBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, borderRadius: RADIUS.full },
  shareBtnSecondary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, borderRadius: RADIUS.full, backgroundColor: `${COLORS.primary}15`, borderWidth: 1, borderColor: COLORS.primary },
  shareText: { fontSize: 13, color: '#FFF', ...FONTS.bold },
  doneBtn: { marginTop: SPACING.xl, padding: SPACING.md, alignItems: 'center' },
  doneText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.semibold },
});
