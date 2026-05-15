/**
 * Reservation form — sends a booking REQUEST to the partner.
 *
 * NEW BUSINESS MODEL:
 *   • The app NEVER processes payment for reservations.
 *   • All reservations are simple requests; the partner manually confirms.
 *   • Once confirmed, the partner exposes their own payment link
 *     (saved as `default_payment_link` on the partner profile) to the user.
 *   • App's revenue comes from partner monthly membership fees (handled separately).
 *
 * Query params:
 *   - partner_id (required)
 *   - event_id   (optional)
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useTr } from '../../src/i18n/autoTr';

type Partner = {
  partner_id: string;
  name: string;
  category: string;
  tier?: string;
  image_url?: string;
  address?: string;
};

type PEvent = {
  event_id: string;
  title: string;
  date: string;
  start_time?: string;
  flyer_url?: string;
};

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDateChip(iso: string): string {
  try {
    const d = new Date(iso + 'T12:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(iso + 'T00:00:00');
    const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
    if (diff === 0) return 'Hoy';
    if (diff === 1) return 'Mañana';
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
  } catch {
    return iso;
  }
}

const DEFAULT_HOURS = ['12:00', '13:00', '14:00', '19:00', '20:00', '21:00', '22:00'];

export default function ReservationNew() {
  const tr = useTr();
  const router = useRouter();
  const params = useLocalSearchParams<{ partner_id: string; event_id?: string }>();
  const partnerId = String(params.partner_id || '');
  const eventId = params.event_id ? String(params.event_id) : '';

  const [partner, setPartner] = useState<Partner | null>(null);
  const [event, setEvent] = useState<PEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [date, setDate] = useState<string>(todayPlus(1));
  const [time, setTime] = useState<string>('20:00');
  const [partySize, setPartySize] = useState<number>(2);
  const [notes, setNotes] = useState<string>('');

  useEffect(() => {
    if (!partnerId) return;
    (async () => {
      try {
        const calls: Promise<any>[] = [api.get(`/partners/${partnerId}`)];
        if (eventId) calls.push(api.get(`/partner-events/${eventId}`).catch(() => null));
        const [p, ev] = await Promise.all(calls);
        setPartner(p);
        if (ev) {
          setEvent(ev);
          if (ev.date) setDate(ev.date);
          if (ev.start_time) setTime(ev.start_time);
        }
      } catch (e) {
        console.error('load reservation page:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [partnerId, eventId]);

  if (!partnerId) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Text style={styles.errText}>{tr('Falta partner_id')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={COLORS.primary} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  if (!partner) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Text style={styles.errText}>{tr('Partner no encontrado')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const body: any = {
        partner_id: partnerId,
        type: 'table',
        date,
        time,
        party_size: partySize,
        notes: notes.trim(),
      };
      if (eventId) body.event_id = eventId;
      const res = await api.post('/reservations', body);
      Alert.alert(
        tr('Solicitud enviada'),
        String(res.message || tr('Tu solicitud fue enviada al partner. Te avisaremos cuando confirme.')),
        [
          {
            text: 'OK',
            onPress: () =>
              router.replace({
                pathname: '/reservations',
                params: { highlight: res.reservation?.reservation_id || '' },
              } as any),
          },
        ],
      );
    } catch (e: any) {
      Alert.alert(tr('Error'), String(e?.message || 'No se pudo enviar la solicitud'));
    } finally {
      setSubmitting(false);
    }
  };

  const dateChips = [0, 1, 2, 3, 7].map((n) => todayPlus(n));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{tr('Reservar')}</Text>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={{ paddingBottom: 140 }} keyboardShouldPersistTaps="handled">
          {/* Partner header */}
          <View style={styles.partnerCard}>
            {partner.image_url ? (
              <Image source={{ uri: partner.image_url }} style={styles.partnerImg} />
            ) : (
              <View style={[styles.partnerImg, { backgroundColor: COLORS.surface }]} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.partnerName} numberOfLines={1}>{partner.name}</Text>
              {!!partner.address && (
                <Text style={styles.partnerSub} numberOfLines={1}>
                  <Ionicons name="location-outline" size={12} color={COLORS.textMuted} /> {partner.address}
                </Text>
              )}
            </View>
          </View>

          {event && (
            <View style={styles.eventCard}>
              {event.flyer_url ? <Image source={{ uri: event.flyer_url }} style={styles.eventImg} /> : null}
              <View style={{ flex: 1 }}>
                <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
                <Text style={styles.eventSub}>
                  {fmtDateChip(event.date)} · {event.start_time || ''}
                </Text>
              </View>
            </View>
          )}

          {/* Date */}
          <Text style={styles.sectionTitle}>{tr('Fecha')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {dateChips.map((d) => (
              <TouchableOpacity
                key={d}
                style={[styles.chip, date === d && styles.chipActive]}
                onPress={() => setDate(d)}
              >
                <Text style={[styles.chipText, date === d && styles.chipTextActive]}>{fmtDateChip(d)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={styles.customDateRow}>
            <Text style={styles.helpText}>{tr('o ingresa otra fecha (AAAA-MM-DD):')}</Text>
            <TextInput
              value={date}
              onChangeText={setDate}
              style={styles.dateInput}
              placeholder="2026-05-30"
              placeholderTextColor={COLORS.textMuted}
              maxLength={10}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {/* Time */}
          <Text style={styles.sectionTitle}>{tr('Hora')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {DEFAULT_HOURS.map((h) => (
              <TouchableOpacity
                key={h}
                style={[styles.chip, time === h && styles.chipActive]}
                onPress={() => setTime(h)}
              >
                <Text style={[styles.chipText, time === h && styles.chipTextActive]}>{h}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={styles.customDateRow}>
            <Text style={styles.helpText}>{tr('o ingresa otra hora (HH:MM):')}</Text>
            <TextInput
              value={time}
              onChangeText={setTime}
              style={styles.dateInput}
              placeholder="20:30"
              placeholderTextColor={COLORS.textMuted}
              maxLength={5}
            />
          </View>

          {/* Party size */}
          <Text style={styles.sectionTitle}>{tr('Personas')}</Text>
          <View style={styles.stepperRow}>
            <TouchableOpacity
              style={styles.stepperBtn}
              onPress={() => setPartySize(Math.max(1, partySize - 1))}
            >
              <Ionicons name="remove" size={22} color={COLORS.textMain} />
            </TouchableOpacity>
            <View style={styles.stepperValue}>
              <Text style={styles.stepperText}>{partySize}</Text>
            </View>
            <TouchableOpacity
              style={styles.stepperBtn}
              onPress={() => setPartySize(Math.min(30, partySize + 1))}
            >
              <Ionicons name="add" size={22} color={COLORS.textMain} />
            </TouchableOpacity>
          </View>

          {/* Notes */}
          <Text style={styles.sectionTitle}>{tr('Notas (opcional)')}</Text>
          <TextInput
            value={notes}
            onChangeText={(v) => setNotes(v.slice(0, 280))}
            placeholder={tr('Cumpleaños, alergias, mesa especial…')}
            placeholderTextColor={COLORS.textMuted}
            multiline
            numberOfLines={3}
            style={styles.notesInput}
            maxLength={280}
          />
          <Text style={styles.helpText}>{notes.length}/280</Text>

          {/* How-it-works info */}
          <View style={styles.infoBox}>
            <Ionicons name="information-circle" size={18} color={COLORS.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.infoBoxTitle}>{tr('¿Cómo funciona?')}</Text>
              <Text style={styles.infoBoxText}>
                {tr('1) Enviamos tu solicitud al partner.')}
              </Text>
              <Text style={styles.infoBoxText}>
                {tr('2) El partner confirma o rechaza en su panel.')}
              </Text>
              <Text style={styles.infoBoxText}>
                {tr('3) Si confirma, recibes su link de pago directamente en la app.')}
              </Text>
              <Text style={styles.infoBoxText}>
                {tr('Cancelación gratuita hasta 2h antes de la reserva.')}
              </Text>
            </View>
          </View>
        </ScrollView>

        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
            onPress={submit}
            disabled={submitting}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <>
                <Text style={styles.submitText}>{tr('Enviar solicitud de reserva')}</Text>
                <Ionicons name="paper-plane" size={16} color={COLORS.white} />
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: COLORS.textMain, fontSize: 17, ...FONTS.bold },

  partnerCard: {
    flexDirection: 'row',
    gap: 12,
    padding: SPACING.md,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  partnerImg: { width: 60, height: 60, borderRadius: RADIUS.md },
  partnerName: { color: COLORS.textMain, fontSize: 15, ...FONTS.bold },
  partnerSub: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },

  eventCard: {
    flexDirection: 'row',
    gap: 10,
    padding: 10,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    backgroundColor: 'rgba(124,58,237,0.12)',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: '#7C3AED',
    alignItems: 'center',
  },
  eventImg: { width: 44, height: 44, borderRadius: RADIUS.sm },
  eventTitle: { color: COLORS.textMain, fontSize: 13, ...FONTS.bold },
  eventSub: { color: '#A78BFA', fontSize: 11, marginTop: 2 },

  sectionTitle: {
    color: COLORS.textMain,
    fontSize: 13,
    ...FONTS.bold,
    paddingHorizontal: SPACING.md,
    marginTop: SPACING.md,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  chipRow: { paddingHorizontal: SPACING.md, gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: 8,
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { color: COLORS.textMain, fontSize: 12.5, ...FONTS.medium },
  chipTextActive: { color: COLORS.white, ...FONTS.bold },

  customDateRow: { paddingHorizontal: SPACING.md, marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  helpText: { color: COLORS.textMuted, fontSize: 11, flex: 1 },
  dateInput: {
    width: 130,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.textMain,
    fontSize: 13,
  },

  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    paddingVertical: 6,
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: { minWidth: 60, alignItems: 'center' },
  stepperText: { color: COLORS.textMain, fontSize: 28, ...FONTS.bold },

  notesInput: {
    marginHorizontal: SPACING.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.textMain,
    fontSize: 13,
    minHeight: 80,
    textAlignVertical: 'top',
  },

  infoBox: {
    flexDirection: 'row',
    gap: 10,
    margin: SPACING.md,
    padding: 14,
    borderRadius: RADIUS.lg,
    backgroundColor: 'rgba(217,119,6,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(217,119,6,0.4)',
    alignItems: 'flex-start',
  },
  infoBoxTitle: { color: COLORS.textMain, fontSize: 13, ...FONTS.bold, marginBottom: 6 },
  infoBoxText: { color: COLORS.textMain, fontSize: 12, lineHeight: 17, marginBottom: 3 },

  bottomBar: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    padding: SPACING.md,
    paddingBottom: Platform.OS === 'ios' ? 28 : SPACING.md,
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary,
  },
  submitText: { color: COLORS.white, fontSize: 15, ...FONTS.bold },

  errText: { color: COLORS.textMain, fontSize: 14 },
});
