import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useBusinessAuth } from '../../src/context/BusinessAuthContext';
import { pickAndUploadImage } from '../../src/lib/uploadImage';

export default function ProfileEdit() {
  const router = useRouter();
  const { token, partner, refresh } = useBusinessAuth();

  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [instagram, setInstagram] = useState('');
  const [bookingLink, setBookingLink] = useState('');
  const [priceRange, setPriceRange] = useState('');
  const [experience, setExperience] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async () => {
    try {
      setUploading(true);
      const res = await pickAndUploadImage(token!, 'profile', [4, 3]);
      if (res === null) return;
      if (res.verdict === 'REJECT') {
        Alert.alert('Imagen no apta', res.reason || 'La IA detectó contenido no apropiado.');
      } else {
        setImageUrl(res.url || imageUrl);
        Alert.alert(
          res.verdict === 'AUTO_APPROVE' ? '✅ Imagen aprobada' : '⏳ Imagen en revisión',
          `${res.caption || ''}${res.tags?.length ? '\n\nTags: ' + res.tags.join(', ') : ''}`,
        );
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo subir');
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    if (partner) {
      setDescription(partner.description || '');
      setAddress(partner.address || '');
      setInstagram(partner.instagram || '');
      setBookingLink(partner.booking_link || '');
      setPriceRange(partner.price_range || '');
      setExperience(partner.experience || '');
      setImageUrl(partner.image_url || '');
    }
  }, [partner]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/business/profile', {
        description, address, instagram, booking_link: bookingLink,
        price_range: priceRange, experience, image_url: imageUrl,
      }, { headers: { Authorization: `Bearer ${token}` } });
      await refresh();
      Alert.alert('¡Listo!', 'Tu perfil fue actualizado');
      router.back();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo guardar');
    }
    setSaving(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="close" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Editar perfil</Text>
        <View style={styles.headerBtn} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <View style={styles.previewCard}>
            {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.previewImage} /> : <View style={[styles.previewImage, { backgroundColor: COLORS.surface }]} />}
            <View style={styles.previewOverlay} />
            <View style={styles.previewContent}>
              <Text style={styles.previewName}>{partner?.name}</Text>
              <Text style={styles.previewCategory}>{partner?.category?.toUpperCase()}</Text>
            </View>
          </View>

          <Text style={styles.label}>Imagen principal</Text>
          <TouchableOpacity
            style={[styles.uploadBtn, uploading && { opacity: 0.6 }]}
            onPress={handleUpload}
            disabled={uploading}
          >
            {uploading ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <>
                <Ionicons name="cloud-upload" size={16} color={COLORS.white} />
                <Text style={styles.uploadBtnText}>Subir foto · IA modera</Text>
              </>
            )}
          </TouchableOpacity>
          <TextInput style={[styles.input, { marginTop: SPACING.xs }]} value={imageUrl} onChangeText={setImageUrl} placeholder="O pega URL externa" placeholderTextColor={COLORS.textMuted} autoCapitalize="none" />

          <Text style={styles.label}>Descripción</Text>
          <TextInput style={[styles.input, styles.textarea]} value={description} onChangeText={setDescription} placeholder="Describe tu negocio en pocas líneas" placeholderTextColor={COLORS.textMuted} multiline numberOfLines={4} textAlignVertical="top" />

          <Text style={styles.label}>Dirección</Text>
          <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="Calle del Arsenal #10-40, Getsemaní" placeholderTextColor={COLORS.textMuted} />

          <Text style={styles.label}>Instagram (sin @)</Text>
          <TextInput style={styles.input} value={instagram} onChangeText={setInstagram} placeholder="tucuenta" placeholderTextColor={COLORS.textMuted} autoCapitalize="none" />

          <Text style={styles.label}>Link de reserva</Text>
          <TextInput style={styles.input} value={bookingLink} onChangeText={setBookingLink} placeholder="https://tu-sitio.com/reservar" placeholderTextColor={COLORS.textMuted} autoCapitalize="none" />
          <Text style={styles.hint}>💡 Todos los clicks se trackean con UTM (utm_source=amocartagena) para que puedas medir el tráfico desde la app.</Text>

          <Text style={styles.label}>Rango de precio</Text>
          <View style={styles.priceRow}>
            {['$', '$$', '$$$', '$$$$'].map(p => {
              const active = priceRange === p;
              return (
                <TouchableOpacity key={p} style={[styles.pricePill, active && styles.pricePillActive]} onPress={() => setPriceRange(p)}>
                  <Text style={[styles.priceText, active && { color: COLORS.white }]}>{p}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Experiencia ofrecida</Text>
          <TextInput style={styles.input} value={experience} onChangeText={setExperience} placeholder="Coctel de bienvenida, mesa preferencial..." placeholderTextColor={COLORS.textMuted} />

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color={COLORS.white} /> : (
              <>
                <Ionicons name="checkmark-circle" size={18} color={COLORS.white} />
                <Text style={styles.saveText}>Guardar cambios</Text>
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold },

  previewCard: { borderRadius: RADIUS.xl, overflow: 'hidden', height: 140, position: 'relative', borderWidth: 1, borderColor: COLORS.border },
  previewImage: { position: 'absolute', width: '100%', height: '100%' },
  previewOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,8,20,0.55)' },
  previewContent: { flex: 1, padding: SPACING.md, justifyContent: 'flex-end' },
  previewName: { fontSize: 22, color: COLORS.white, ...FONTS.bold },
  previewCategory: { fontSize: 11, color: 'rgba(255,255,255,0.8)', ...FONTS.bold, letterSpacing: 1, marginTop: 4 },

  label: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: SPACING.md, marginBottom: SPACING.xs },
  input: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: SPACING.md, paddingVertical: 12, color: COLORS.textMain, fontSize: 14, ...FONTS.regular },
  textarea: { minHeight: 100 },
  hint: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginTop: 4, lineHeight: 16 },

  priceRow: { flexDirection: 'row', gap: SPACING.xs },
  pricePill: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: RADIUS.lg, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  pricePillActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  priceText: { fontSize: 14, color: COLORS.textMuted, ...FONTS.bold },

  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 15, marginTop: SPACING.xl },
  saveText: { color: COLORS.white, fontSize: 14, ...FONTS.bold },

  uploadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: RADIUS.full },
  uploadBtnText: { color: COLORS.white, fontSize: 13, ...FONTS.bold },
});
