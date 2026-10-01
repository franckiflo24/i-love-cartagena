import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, Switch, ActivityIndicator } from 'react-native';
import { Alert } from '../../src/lib/alert';
import { SafeImage } from '../../src/components/SafeImage';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useBusinessAuth } from '../../src/context/BusinessAuthContext';
import { pickAndUploadImage } from '../../src/lib/uploadImage';

const CATEGORIES = [
  { key: 'gastronomy', label: 'Gastronomía', icon: 'restaurant' },
  { key: 'music', label: 'Música', icon: 'musical-notes' },
  { key: 'party', label: 'Fiesta', icon: 'wine' },
  { key: 'wellness', label: 'Wellness', icon: 'leaf' },
  { key: 'art', label: 'Arte & Cultura', icon: 'color-palette' },
  { key: 'popup', label: 'Pop-up', icon: 'bag-handle' },
];

// (The old SUGGESTED_FLYERS were Unsplash URLs the server's I3 rule can never
// accept — every event that kept the default was unpublishable. Audit fix #1:
// no flyer is a fine flyer; SafeImage paints the category art.)

export default function EventForm() {
  const router = useRouter();
  const params = useLocalSearchParams<{ eventId?: string }>();
  const { token, partner, loading: authLoading } = useBusinessAuth();
  // Bounce unauthenticated visitors to login instead of rendering a dead form.
  useEffect(() => { if (!authLoading && !token) router.replace('/business/login' as any); }, [authLoading, token]);
  const isEdit = !!params.eventId;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('gastronomy');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [flyerUrl, setFlyerUrl] = useState('');
  const [isFree, setIsFree] = useState(false);
  const [price, setPrice] = useState('');
  const [bookingLink, setBookingLink] = useState('');
  const [isPublished, setIsPublished] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

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
          setFlyerUrl(ev.flyer_url || '');
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
    // Bogotá "today" — a past date can never be visible, so stop it here (audit #13).
    const todayBogota = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    if (!isEdit && date < todayBogota) return Alert.alert('Fecha pasada', 'La fecha del evento ya pasó — usa una fecha de hoy en adelante.');
    if (!validateTime(startTime) || !validateTime(endTime)) return Alert.alert('Hora inválida', 'Usa el formato HH:MM (ej: 19:30)');
    setSaving(true);
    try {
      const payload = {
        title, description, category, date, start_time: startTime, end_time: endTime,
        // "50.000" used to parseInt to 50 — strip every non-digit first (audit #13).
        flyer_url: flyerUrl, is_free: isFree, price: isFree ? 0 : parseInt((price || '0').replace(/[^0-9]/g, '') || '0', 10),
        booking_link: bookingLink || partner?.booking_link || '',
        is_published: isPublished,
      };
      let result: any;
      if (isEdit) {
        result = await api.put(`/business/events/${params.eventId}`, payload, { headers: { Authorization: `Bearer ${token}` } });
      } else {
        result = await api.post('/business/events', payload, { headers: { Authorization: `Bearer ${token}` } });
      }
      const verdict = result?._remoderation?.verdict || result?.moderation_verdict;
      const reason = result?._remoderation?.reason || result?.moderation_reason;
      // Server-computed reach (audit 2026-10-01): an AI-approved event on a venue
      // that is not public yet (activated, awaiting admin approval) is invisible to
      // every traveller. Only an explicit `false` changes the copy — an older server
      // (no field) keeps the verdict-based messages below.
      const notPublic = result?.public_visible === false;
      const blocker: string = typeof result?.visibility_blocker === 'string' ? result.visibility_blocker : '';
      // Route DIRECTLY on every outcome — never gate navigation on an Alert button's
      // onPress (Alert is a no-op on react-native-web). The message is informational.
      router.back();
      if (verdict === 'AUTO_APPROVE' && notPublic) {
        if (blocker.startsWith('venue_')) {
          Alert.alert(
            'Evento guardado — tu negocio aún no es público',
            'Tu evento quedó guardado y aprobado, pero tu negocio aún no es público, así que los viajeros no lo verán todavía. '
            + 'En cuanto el equipo AMO Life apruebe tu perfil, el evento aparecerá en la agenda automáticamente.',
          );
        } else {
          // The only other AUTO_APPROVE blocker is a paused event (is_published=false).
          Alert.alert(
            'Evento guardado — está pausado',
            'Tu evento quedó guardado pero no es público: actívalo con "Publicar evento" para que los viajeros lo vean.',
          );
        }
      } else if (verdict === 'NEEDS_REVIEW') {
        // The truth (audit fix #2): a held event is NOT public until a human approves.
        Alert.alert(
          'En revisión — aún NO es público',
          (reason ? `Motivo: ${reason}\n\n` : '')
          + 'Un moderador lo revisará pronto. Si editas el título o la descripción, se re-evalúa al instante.',
        );
      } else if (verdict === 'REJECT') {
        Alert.alert('Rechazado', reason || 'La IA detectó contenido no apto.');
      } else if (verdict === 'AUTO_APPROVE') {
        Alert.alert(isEdit ? 'Cambios guardados' : '¡Publicado!',
          isEdit ? 'Tu evento fue actualizado y sigue en vivo.' : 'Tu evento ya está en vivo en la agenda.');
      } else {
        // No verdict (static mode / older server) — never promise "en vivo" blind.
        Alert.alert('Evento enviado', 'Revisa su estado en tu panel.');
      }
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
                La mayoría de los eventos se publican al instante. Si la IA tiene una duda
                de seguridad o autenticidad, pasa a revisión humana y te avisamos.
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
          <View style={styles.flyerPreviewBox}>
            {flyerUrl ? (
              <SafeImage uri={flyerUrl} category="event" style={styles.flyerPreview} resizeMode="cover" />
            ) : (
              <View style={[styles.flyerPreview, { alignItems: 'center', justifyContent: 'center' }]}>
                <Ionicons name="image-outline" size={36} color={COLORS.textMuted} />
                <Text style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 4 }}>Sin flyer</Text>
              </View>
            )}
            <TouchableOpacity
              style={[styles.uploadBtn, uploading && { opacity: 0.6 }]}
              onPress={async () => {
                try {
                  setUploading(true);
                  const res = await pickAndUploadImage(token!, 'flyer', [4, 5]);
                  if (res === null) { setUploading(false); return; }
                  if (res.verdict === 'REJECT') {
                    Alert.alert('Imagen no apta', res.reason || 'La IA detectó contenido no apropiado.');
                  } else {
                    setFlyerUrl(res.url || flyerUrl);
                    Alert.alert(
                      res.verdict === 'AUTO_APPROVE' ? '✅ Flyer aprobado por la IA' : '⏳ Flyer en revisión',
                      `${res.caption || ''}${res.tags?.length ? '\n\nTags: ' + res.tags.join(', ') : ''}\n\n${res.reason || ''}`,
                    );
                  }
                } catch (e: any) {
                  Alert.alert('Error', e?.message || 'No se pudo subir la imagen');
                } finally {
                  setUploading(false);
                }
              }}
              disabled={uploading}
            >
              {uploading ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <>
                  <Ionicons name="cloud-upload" size={16} color={COLORS.white} />
                  <Text style={styles.uploadBtnText}>Subir desde mi dispositivo</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>🤖 La IA revisa tu flyer al instante (caption, tags y verifica que sea apropiado).</Text>

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

          {/* Published — only meaningful on EDIT (pause / re-publish an approved
              event). On create the server decides via moderation; showing a switch
              it ignores was a lie (audit #13). */}
          {isEdit && (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Publicar evento</Text>
                <Text style={styles.hint}>Pausa o re-publica un evento ya aprobado</Text>
              </View>
              <Switch value={isPublished} onValueChange={setIsPublished} trackColor={{ false: '#444', true: COLORS.primary }} thumbColor={COLORS.white} />
            </View>
          )}

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
  flyerThumb: { width: 60, height: 75, borderRadius: 6 },

  flyerPreviewBox: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, alignItems: 'center', gap: SPACING.sm },
  flyerPreview: { width: 160, height: 200, borderRadius: RADIUS.lg, backgroundColor: '#222' },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: RADIUS.full, marginTop: SPACING.xs },
  uploadBtnText: { color: COLORS.white, fontSize: 12, ...FONTS.bold },

  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 15, marginTop: SPACING.xl },
  saveText: { color: COLORS.white, fontSize: 14, ...FONTS.bold },

  aiBanner: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.md, backgroundColor: 'rgba(18,181,165,0.1)', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(18,181,165,0.4)', marginBottom: SPACING.sm },
  aiBannerTitle: { fontSize: 13, color: COLORS.textMain, ...FONTS.bold },
  aiBannerText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2, lineHeight: 16 },
});
