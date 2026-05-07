import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, Switch, ActivityIndicator, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useBusinessAuth } from '../../src/context/BusinessAuthContext';

const CATEGORIES = [
  { key: 'gastronomy', label: 'Gastronomía', icon: 'restaurant' },
  { key: 'music', label: 'Música', icon: 'musical-notes' },
  { key: 'party', label: 'Fiesta', icon: 'wine' },
  { key: 'wellness', label: 'Wellness', icon: 'leaf' },
  { key: 'art', label: 'Arte & Cultura', icon: 'color-palette' },
  { key: 'popup', label: 'Pop-up', icon: 'bag-handle' },
];

const SUGGESTED_FLYERS = [
  'https://images.unsplash.com/photo-1551218808-94e220e084d2?w=800&h=1000&fit=crop',
  'https://images.unsplash.com/photo-1571266028243-e4733b0f0bb0?w=800&h=1000&fit=crop',
  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&h=1000&fit=crop',
  'https://images.unsplash.com/photo-1495567720989-cebdbdd97913?w=800&h=1000&fit=crop',
  'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&h=1000&fit=crop',
  'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&h=1000&fit=crop',
];

export default function EventForm() {
  const router = useRouter();
  const params = useLocalSearchParams<{ eventId?: string }>();
  const { token, partner } = useBusinessAuth();
  const isEdit = !!params.eventId;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('gastronomy');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [flyerUrl, setFlyerUrl] = useState(SUGGESTED_FLYERS[0]);
  const [isFree, setIsFree] = useState(false);
  const [price, setPrice] = useState('');
  const [bookingLink, setBookingLink] = useState('');
  const [isPublished, setIsPublished] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isEdit || !token) return;
    setLoading(true);
    (async () => {
      try {
        const events = await api.get('/business/events', { headers: { Authorization: `Bearer ${token}` } });
        const ev = events.find((e: any) => e.event_id === params.eventId);
        if (ev) {
          setTitle(ev.title);
          setDescription(ev.description);
          setCategory(ev.category);
          setDate(ev.date);
          setStartTime(ev.start_time);
          setEndTime(ev.end_time);
          setFlyerUrl(ev.flyer_url || SUGGESTED_FLYERS[0]);
          setIsFree(!!ev.is_free);
          setPrice(String(ev.price || ''));
          setBookingLink(ev.booking_link || '');
          setIsPublished(ev.is_published !== false);
        }
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, [isEdit, params.eventId, token]);

  const validateDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const validateTime = (s: string) => /^\d{2}:\d{2}$/.test(s);

  const handleSave = async () => {
    if (!title || !description) return Alert.alert('Faltan datos', 'Título y descripción son requeridos');
    if (!validateDate(date)) return Alert.alert('Fecha inválida', 'Usa el formato YYYY-MM-DD (ej: 2026-05-15)');
    if (!validateTime(startTime) || !validateTime(endTime)) return Alert.alert('Hora inválida', 'Usa el formato HH:MM (ej: 19:30)');
    setSaving(true);
    try {
      const payload = {
        title, description, category, date, start_time: startTime, end_time: endTime,
        flyer_url: flyerUrl, is_free: isFree, price: isFree ? 0 : parseInt(price || '0', 10),
        booking_link: bookingLink || partner?.booking_link || '',
        is_published: isPublished,
      };
      if (isEdit) {
        await api.put(`/business/events/${params.eventId}`, payload, { headers: { Authorization: `Bearer ${token}` } });
      } else {
        await api.post('/business/events', payload, { headers: { Authorization: `Bearer ${token}` } });
      }
      router.back();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo guardar');
    }
    setSaving(false);
  };

  if (loading) return <SafeAreaView style={styles.container}><ActivityIndicator size="large" color={COLORS.primary} style={{ flex: 1 }} /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="close" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isEdit ? 'Editar evento' : 'Nuevo evento'}</Text>
        <View style={styles.headerBtn} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          {/* AI Hero */}
          <View style={styles.aiBanner}>
            <Ionicons name="sparkles" size={18} color={COLORS.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.aiBannerTitle}>Moderación IA activa</Text>
              <Text style={styles.aiBannerText}>
                {isEdit ? 'Tus cambios pasarán por revisión IA. ' : 'La IA revisará y publicará tu evento al instante. '}
                Si detecta dudas, lo enviará al admin para aprobación manual.
              </Text>
            </View>
          </View>

          {/* Title */}
          <Text style={styles.label}>Título del evento *</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Ej: Brunch & Beats Sunday Edition" placeholderTextColor={COLORS.textMuted} />

          {/* Description */}
          <Text style={styles.label}>Descripción *</Text>
          <TextInput style={[styles.input, styles.textarea]} value={description} onChangeText={setDescription} placeholder="Describe el ambiente, qué incluye, dress code, etc." placeholderTextColor={COLORS.textMuted} multiline numberOfLines={4} textAlignVertical="top" />

          {/* Category */}
          <Text style={styles.label}>Categoría *</Text>
          <View style={styles.catGrid}>
            {CATEGORIES.map(c => {
              const active = category === c.key;
              return (
                <TouchableOpacity key={c.key} style={[styles.catChip, active && styles.catChipActive]} onPress={() => setCategory(c.key)}>
                  <Ionicons name={c.icon as any} size={14} color={active ? COLORS.white : COLORS.textMuted} />
                  <Text style={[styles.catText, active && { color: COLORS.white }]}>{c.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Date / Time */}
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Fecha (YYYY-MM-DD) *</Text>
              <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="2026-05-15" placeholderTextColor={COLORS.textMuted} />
            </View>
          </View>
          <View style={styles.row}>
            <View style={{ flex: 1, marginRight: SPACING.xs }}>
              <Text style={styles.label}>Inicio (HH:MM) *</Text>
              <TextInput style={styles.input} value={startTime} onChangeText={setStartTime} placeholder="19:30" placeholderTextColor={COLORS.textMuted} />
            </View>
            <View style={{ flex: 1, marginLeft: SPACING.xs }}>
              <Text style={styles.label}>Fin (HH:MM) *</Text>
              <TextInput style={styles.input} value={endTime} onChangeText={setEndTime} placeholder="23:00" placeholderTextColor={COLORS.textMuted} />
            </View>
          </View>

          {/* Flyer */}
          <Text style={styles.label}>Flyer del evento</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.flyerRow} contentContainerStyle={{ gap: SPACING.xs }}>
            {SUGGESTED_FLYERS.map(url => (
              <TouchableOpacity key={url} onPress={() => setFlyerUrl(url)} style={[styles.flyerOption, flyerUrl === url && styles.flyerActive]}>
                <View style={styles.flyerThumb}>
                  <View style={{ flex: 1, backgroundColor: '#222', borderRadius: 6 }} />
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TextInput style={styles.input} value={flyerUrl} onChangeText={setFlyerUrl} placeholder="O pega la URL de tu propio flyer" placeholderTextColor={COLORS.textMuted} autoCapitalize="none" />

          {/* Price */}
          <View style={styles.row}>
            <Text style={styles.label}>¿Evento gratis?</Text>
            <Switch value={isFree} onValueChange={setIsFree} trackColor={{ false: '#444', true: COLORS.primary }} thumbColor={COLORS.white} />
          </View>
          {!isFree && (
            <>
              <Text style={styles.label}>Precio (COP)</Text>
              <TextInput style={styles.input} value={price} onChangeText={setPrice} placeholder="50000" placeholderTextColor={COLORS.textMuted} keyboardType="numeric" />
            </>
          )}

          {/* Booking link */}
          <Text style={styles.label}>Link de reserva (opcional)</Text>
          <TextInput style={styles.input} value={bookingLink} onChangeText={setBookingLink} placeholder={partner?.booking_link || 'https://tu-sitio.com/reservar'} placeholderTextColor={COLORS.textMuted} autoCapitalize="none" />
          <Text style={styles.hint}>💡 Si lo dejas vacío, usaremos el link de tu perfil. Todos los clicks se trackean con UTM (utm_source=amocartagena).</Text>

          {/* Published */}
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Publicar evento</Text>
              <Text style={styles.hint}>Si lo desactivas, queda como borrador</Text>
            </View>
            <Switch value={isPublished} onValueChange={setIsPublished} trackColor={{ false: '#444', true: COLORS.primary }} thumbColor={COLORS.white} />
          </View>

          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color={COLORS.white} /> : (
              <>
                <Ionicons name="checkmark-circle" size={18} color={COLORS.white} />
                <Text style={styles.saveText}>{isEdit ? 'Guardar cambios' : 'Publicar evento'}</Text>
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

  label: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: SPACING.md, marginBottom: SPACING.xs },
  input: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: SPACING.md, paddingVertical: 12, color: COLORS.textMain, fontSize: 14, ...FONTS.regular },
  textarea: { minHeight: 100 },
  hint: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginTop: 4, lineHeight: 16 },

  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  catChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: RADIUS.full, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  catChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  catText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold },

  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SPACING.xs },

  flyerRow: { marginVertical: SPACING.sm },
  flyerOption: { borderWidth: 2, borderColor: COLORS.border, borderRadius: RADIUS.md, overflow: 'hidden', padding: 2 },
  flyerActive: { borderColor: COLORS.primary },
  flyerThumb: { width: 60, height: 75, borderRadius: 6, overflow: 'hidden', backgroundColor: '#222' },

  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 15, marginTop: SPACING.xl },
  saveText: { color: COLORS.white, fontSize: 14, ...FONTS.bold },

  aiBanner: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.md, backgroundColor: 'rgba(217,119,6,0.1)', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(217,119,6,0.4)', marginBottom: SPACING.sm },
  aiBannerTitle: { fontSize: 13, color: COLORS.textMain, ...FONTS.bold },
  aiBannerText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2, lineHeight: 16 },
});
