// DROP 3A — "Vi un evento ahora": the 15-second staff field capture.
// A sighting, never a publication: it POSTs /admin/events/capture and lands in
// the review queue (status review) for a SECOND staffer to approve. The venue
// string runs the Drop-2 civic resolver LIVE so the staffer sees where it will
// pin before submitting. Photo is evidence (blob), never auto-shown publicly.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, SPACING, RADIUS, FONTS, TYPE } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useTr } from '../../src/i18n/autoTr';
import { useAuth } from '../../src/context/AuthContext';
import { goBackOr } from '../../src/lib/nav';
import { resolveCivic, CIVIC_SUBTYPE_ES } from '../../src/lib/civicLocations';

const CATEGORIES = [
  ['concert', 'Concierto'], ['festival', 'Festival'], ['cultural', 'Cultural'],
  ['nightlife', 'Nocturno'], ['gastronomic', 'Gastronomía'], ['sports', 'Deportes'],
  ['family', 'Familia'], ['civic', 'Cívico'],
] as const;

const DATE_MODES = [
  ['now', 'Ahora'], ['today', 'Hoy'], ['date', 'Elegir fecha'], ['tbc', 'Por confirmar'],
] as const;

type Result = { event_id: string; capture_id: string; possible_duplicate_of: string | null; pinned: boolean };

export default function AdminCaptura() {
  const tr = useTr();
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [title, setTitle] = useState('');
  const [venue, setVenue] = useState('');
  const [mode, setMode] = useState<'now' | 'today' | 'date' | 'tbc'>('now');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [category, setCategory] = useState('cultural');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Result | null>(null);

  useEffect(() => {
    if (!authLoading && (!user || !user.is_admin)) router.replace('/');
  }, [user, authLoading, router]);

  // Live Drop-2 resolution — the staffer sees the pin before submitting.
  const civic = useMemo(() => resolveCivic(venue), [venue]);

  const pickPhoto = useCallback(async () => {
    try {
      const fn = Platform.OS === 'web' ? ImagePicker.launchImageLibraryAsync : ImagePicker.launchCameraAsync;
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return;
      }
      const res = await fn({ mediaTypes: ['images'], quality: 0.4, base64: true, exif: false });
      const a = res.assets?.[0];
      if (!res.canceled && a?.base64) setPhoto(`data:image/jpeg;base64,${a.base64}`);
    } catch (e) {
      console.error('[AdminCaptura] photo', e);
    }
  }, []);

  const submit = useCallback(async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        title: title.trim(), venue_name: venue.trim(), date_mode: mode, category,
        note: note.trim() || undefined,
        photo_data_url: photo || undefined,
        civic: civic ? { id: civic.id, lat: civic.lat, lng: civic.lng } : undefined,
      };
      if (mode === 'date') {
        body.start_date = date.trim();
        if (time.trim()) body.start_time = time.trim();
      }
      const res = await api.post('/admin/events/capture', body);
      setDone(res as Result);
    } catch (e: unknown) {
      const detail = (e as { data?: { detail?: { error?: string; hint?: string } } })?.data?.detail;
      const code = detail?.error || 'network';
      const msgs: Record<string, string> = {
        bad_title: tr('El título necesita entre 4 y 120 caracteres.'),
        geofilter: tr('El filtro geográfico rechazó la captura (señales fuera de Cartagena).'),
        already_exists: `${tr('Ya existe un evento idéntico')}: ${detail?.hint || ''}`,
        past_date: tr('La fecha ya pasó — usa una futura o "Por confirmar".'),
        bad_start_date: tr('Fecha inválida — usa AAAA-MM-DD.'),
        bad_start_time: tr('Hora inválida — usa HH:MM.'),
        photo_too_large: tr('La foto es muy pesada — intenta de nuevo.'),
      };
      setError(msgs[code] || tr('No se pudo enviar. Revisa tu conexión e intenta de nuevo.'));
      console.error('[AdminCaptura] submit', e);
    } finally {
      setBusy(false);
    }
  }, [busy, title, venue, mode, category, note, photo, civic, date, time, tr]);

  if (authLoading || !user?.is_admin) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><ActivityIndicator color={COLORS.primary} /></View>
      </SafeAreaView>
    );
  }

  if (done) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}>
          <Ionicons name="checkmark-circle" size={52} color="#22C55E" />
          <Text style={styles.doneTitle}>{tr('Enviado a revisión')}</Text>
          <Text style={styles.doneText}>
            {tr('La captura espera la aprobación de otra persona del equipo.')}
          </Text>
          {done.pinned && <Text style={styles.doneMeta}>📍 {tr('Se fijará en el mapa al aprobarse')}</Text>}
          {!!done.possible_duplicate_of && (
            <View style={styles.dupBanner}>
              <Ionicons name="alert-circle-outline" size={16} color={COLORS.mustard} />
              <Text style={styles.dupText}>{tr('Posible duplicado de')} {done.possible_duplicate_of}</Text>
            </View>
          )}
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push('/admin/eventos' as never)}>
            <Text style={styles.primaryBtnText}>{tr('Ver cola de revisión')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.ghostBtn}
            onPress={() => { setDone(null); setTitle(''); setVenue(''); setNote(''); setPhoto(null); setMode('now'); }}
          >
            <Text style={styles.ghostBtnText}>{tr('Capturar otro')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const canSubmit = title.trim().length >= 4 && !busy && (mode !== 'date' || /^\d{4}-\d{2}-\d{2}$/.test(date.trim()));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => goBackOr(router)} style={styles.backBtn} accessibilityRole="button">
            <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{tr('Vi un evento ahora')}</Text>
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>{tr('Título')} *</Text>
          <TextInput
            style={styles.input} value={title} onChangeText={setTitle} maxLength={120}
            placeholder={tr('Concierto de cierre')} placeholderTextColor={COLORS.textFaint}
            testID="captura-title"
          />

          <Text style={styles.label}>{tr('¿Dónde?')}</Text>
          <TextInput
            style={styles.input} value={venue} onChangeText={setVenue} maxLength={120}
            placeholder={tr('Camellón de los Mártires')} placeholderTextColor={COLORS.textFaint}
            testID="captura-venue"
          />
          {venue.trim().length >= 6 && (
            civic ? (
              <Text style={styles.resolveOk} testID="captura-resolved">
                📍 {civic.name} · {tr(CIVIC_SUBTYPE_ES[civic.subtype])} ({tr('se fijará en el mapa')})
              </Text>
            ) : (
              <Text style={styles.resolveMiss}>{tr('sin ubicación fija — se guarda el texto')}</Text>
            )
          )}

          <Text style={styles.label}>{tr('¿Cuándo?')}</Text>
          <View style={styles.chipRow}>
            {DATE_MODES.map(([k, es]) => (
              <TouchableOpacity
                key={k}
                style={[styles.chip, mode === k && styles.chipOn]}
                onPress={() => setMode(k as typeof mode)}
                accessibilityRole="button"
              >
                <Text style={[styles.chipText, mode === k && styles.chipTextOn]}>{tr(es)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {mode === 'date' && (
            <View style={styles.dateRow}>
              <TextInput
                style={[styles.input, { flex: 1.4 }]} value={date} onChangeText={setDate}
                placeholder="2026-11-11" placeholderTextColor={COLORS.textFaint} maxLength={10}
              />
              <TextInput
                style={[styles.input, { flex: 1 }]} value={time} onChangeText={setTime}
                placeholder={`${tr('Hora')} 19:00`} placeholderTextColor={COLORS.textFaint} maxLength={5}
              />
            </View>
          )}

          <Text style={styles.label}>{tr('Categoría')}</Text>
          <View style={styles.chipRow}>
            {CATEGORIES.map(([k, es]) => (
              <TouchableOpacity
                key={k}
                style={[styles.chip, category === k && styles.chipOn]}
                onPress={() => setCategory(k)}
                accessibilityRole="button"
              >
                <Text style={[styles.chipText, category === k && styles.chipTextOn]}>{tr(es)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>{tr('Foto (evidencia, opcional)')}</Text>
          <TouchableOpacity style={styles.photoBtn} onPress={pickPhoto} accessibilityRole="button">
            <Ionicons name={photo ? 'checkmark-circle' : 'camera'} size={18} color={photo ? '#22C55E' : COLORS.primary} />
            <Text style={styles.photoBtnText}>
              {photo ? tr('Foto adjunta') : tr(Platform.OS === 'web' ? 'Subir foto' : 'Tomar foto')}
            </Text>
            {photo && (
              <TouchableOpacity onPress={() => setPhoto(null)} accessibilityRole="button">
                <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            )}
          </TouchableOpacity>

          <Text style={styles.label}>{tr('Nota (interna, opcional)')}</Text>
          <TextInput
            style={[styles.input, styles.noteInput]} value={note} onChangeText={setNote}
            multiline maxLength={500} placeholder={tr('Tarima frente al reloj, suena a salsa…')}
            placeholderTextColor={COLORS.textFaint}
          />

          {!!error && <Text style={styles.error} testID="captura-error">{error}</Text>}

          <TouchableOpacity
            style={[styles.primaryBtn, !canSubmit && styles.btnOff]}
            disabled={!canSubmit}
            onPress={submit}
            accessibilityRole="button"
            testID="captura-submit"
          >
            {busy ? <ActivityIndicator color={COLORS.black} /> : (
              <Text style={styles.primaryBtnText}>{tr('Enviar a revisión')}</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.fine}>
            {tr('Una captura es un avistamiento reportado: pasa por revisión humana antes de publicarse.')}
          </Text>
          <View style={{ height: 60 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...TYPE.title3, color: COLORS.textMain },
  body: { paddingHorizontal: SPACING.lg },
  label: { fontSize: 13, color: COLORS.textMuted, ...FONTS.semibold, marginTop: SPACING.md, marginBottom: 6 },
  input: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.hairline, borderRadius: RADIUS.md,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: COLORS.textMain, minHeight: 46,
  },
  noteInput: { minHeight: 70, textAlignVertical: 'top' },
  resolveOk: { fontSize: 12.5, color: '#22C55E', ...FONTS.semibold, marginTop: 6 },
  resolveMiss: { fontSize: 12.5, color: COLORS.textFaint, ...FONTS.medium, marginTop: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 13, paddingVertical: 9, borderRadius: RADIUS.full, borderWidth: 1,
    borderColor: COLORS.hairline, backgroundColor: COLORS.surface, minHeight: 38, justifyContent: 'center',
  },
  chipOn: { borderColor: COLORS.primary, backgroundColor: `${COLORS.primary}1A` },
  chipText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.semibold },
  chipTextOn: { color: COLORS.primary },
  dateRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  photoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: COLORS.hairline,
    borderRadius: RADIUS.md, backgroundColor: COLORS.surface, paddingHorizontal: 14, minHeight: 46,
  },
  photoBtnText: { flex: 1, fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  error: { fontSize: 13, color: COLORS.coral, ...FONTS.semibold, marginTop: SPACING.md },
  primaryBtn: {
    marginTop: SPACING.lg, minHeight: 50, borderRadius: RADIUS.full, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.xl,
  },
  btnOff: { opacity: 0.4 },
  primaryBtnText: { fontSize: 15, color: COLORS.black, ...FONTS.bold },
  ghostBtn: { minHeight: 44, justifyContent: 'center' },
  ghostBtnText: { fontSize: 14, color: COLORS.textMuted, ...FONTS.semibold },
  fine: { fontSize: 11.5, color: COLORS.textFaint, ...FONTS.medium, textAlign: 'center', marginTop: SPACING.md },
  doneTitle: { ...TYPE.title3, color: COLORS.textMain },
  doneText: { ...TYPE.subhead, color: COLORS.textMuted, textAlign: 'center' },
  doneMeta: { fontSize: 13, color: '#22C55E', ...FONTS.semibold },
  dupBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${COLORS.mustard}1A`,
    borderWidth: 1, borderColor: `${COLORS.mustard}55`, borderRadius: RADIUS.md, padding: 10,
  },
  dupText: { fontSize: 12.5, color: COLORS.mustard, ...FONTS.semibold, flexShrink: 1 },
});
