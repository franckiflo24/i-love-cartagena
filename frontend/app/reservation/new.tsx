/**
 * Reservation form — create a new in-app reservation for a partner.
 *
 * Query params:
 *   - partner_id (required)
 *   - event_id   (optional — if linked to a partner event)
 *   - type       ('table' | 'prepaid', default depends on partner.category)
 *   - amount_cop (optional, for prepaid)
 */
import React, { useEffect, useMemo, useState } from 'react';
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
  Linking,
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
  is_government?: boolean;
};

type PEvent = {
  event_id: string;
  title: string;
  date: string;
  start_time?: string;
  price?: number;
  is_free?: boolean;
  flyer_url?: string;
};

const TABLE_CATEGORIES = new Set(['restaurant', 'bar', 'cafe', 'gastro']);

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDateChip(iso: string, langLabel?: { today: string; tomorrow: string }): string {
  try {
    const d = new Date(iso + 'T12:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(iso + 'T00:00:00');
    const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
    if (diff === 0) return langLabel?.today || 'Hoy';
    if (diff === 1) return langLabel?.tomorrow || 'Mañana';
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
  const params = useLocalSearchParams<{
    partner_id: string;
    event_id?: string;
    type?: string;
    amount_cop?: string;
  }>();
  const partnerId = String(params.partner_id || '');
  const eventId = params.event_id ? String(params.event_id) : '';
  const forcedType = (String(params.type || '').toLowerCase() || '') as '' | 'table' | 'prepaid';
  const amountParam = params.amount_cop ? Number(params.amount_cop) : 0;

  const [partner, setPartner] = useState<Partner | null>(null);
  const [event, setEvent] = useState<PEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [date, setDate] = useState<string>(todayPlus(1));
  const [time, setTime] = useState<string>('20:00');
  const [partySize, setPartySize] = useState<number>(2);
  const [notes, setNotes] = useState<string>('');

  // Derived: reservation type
  const rtype: 'table' | 'prepaid' = useMemo(() => {
    if (forcedType === 'prepaid' || eventId || amountParam > 0) return 'prepaid';
    if (forcedType === 'table') return 'table';
    if (partner && TABLE_CATEGORIES.has(partner.category)) return 'table';
    return 'table';
  }, [forcedType, eventId, amountParam, partner]);

  const unitPriceCop: number = useMemo(() => {
    if (rtype !== 'prepaid') return 0;
    if (event && !event.is_free && (event.price || 0) > 0) return event.price || 0;
    return amountParam;
  }, [rtype, event, amountParam]);

  const totalCop = unitPriceCop * partySize;
  const commissionPct = 5;
  const appCommissionCop = Math.round((totalCop * commissionPct) / 100);

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
        type: rtype,
        date,
        time,
        party_size: partySize,
        notes: notes.trim(),
      };
      if (eventId) body.event_id = eventId;
      if (rtype === 'prepaid') {
        body.qty = partySize;
        if (unitPriceCop > 0) body.amount_cop = unitPriceCop;
      }
      const res = await api.post('/reservations', body);
      if (res.requires_payment && res.checkout_url) {
        // Open Wompi checkout
        try {
          await Linking.openURL(res.checkout_url);
        } catch {}
        router.replace({ pathname: '/reservations', params: { highlight: res.reservation?.reservation_id || '' } } as any);
        return;
      }
      // Table flow → go to my reservations page
      Alert.alert(
        tr('Reserva enviada'),
        tr('El partner debe confirmar tu reserva en su panel. Te avisaremos por la app cuando esté confirmada.'),
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
      Alert.alert(tr('Error'), String(e?.message || 'No se pudo crear la reserva'));
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
              <View style={styles.typeBadgeRow}>
                <View style={[styles.typeBadge, { backgroundColor: rtype === 'prepaid' ? 'rgba(124,58,237,0.15)' : 'rgba(34,197,94,0.15)', borderColor: rtype === 'prepaid' ? '#7C3AED' : '#22C55E' }]}>
                  <Ionicons name={rtype === 'prepaid' ? 'card' : 'restaurant'} size={11} color={rtype === 'prepaid' ? '#7C3AED' : '#22C55E'} />
                  <Text style={[styles.typeBadgeText, { color: rtype === 'prepaid' ? '#7C3AED' : '#22C55E' }]}>
                    {rtype === 'prepaid' ? tr('Reserva con pago') : tr('Reserva de mesa')}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Event hint */}
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

          {/* Summary */}
          {rtype === 'prepaid' && unitPriceCop > 0 && (
            <View style={styles.summary}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>{tr('Precio por persona')}</Text>
                <Text style={styles.summaryValue}>${unitPriceCop.toLocaleString('es-CO')} COP</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>{tr('Personas')}</Text>
                <Text style={styles.summaryValue}>× {partySize}</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryRow}>
                <Text style={styles.summaryTotalLabel}>{tr('Total a pagar')}</Text>
                <Text style={styles.summaryTotalValue}>${totalCop.toLocaleString('es-CO')} COP</Text>
              </View>
              <Text style={styles.summaryNote}>
                {tr('Incluye comisión de plataforma del 5% para la operación segura de la reserva.')}
              </Text>
            </View>
          )}

          {rtype === 'table' && (
            <View style={styles.infoBox}>
              <Ionicons name="information-circle" size={18} color={COLORS.primary} />
              <Text style={styles.infoBoxText}>
                {tr('Tu reserva queda pendiente hasta que el partner la confirme desde su panel. Cancelación gratuita hasta 2h antes.')}
              </Text>
            </View>
          )}
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
                <Text style={styles.submitText}>
                  {rtype === 'prepaid' ? tr('Pagar y reservar') : tr('Confirmar reserva')}
                </Text>
                <Ionicons name="arrow-forward" size={18} color={COLORS.white} />
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
  typeBadgeRow: { flexDirection: 'row', marginTop: 6 },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  typeBadgeText: { fontSize: 10.5, ...FONTS.bold, letterSpacing: 0.3 },

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

  summary: {
    margin: SPACING.md,
    padding: SPACING.md,
    backgroundColor: 'rgba(217,119,6,0.08)',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: 'rgba(217,119,6,0.4)',
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  summaryLabel: { color: COLORS.textMuted, fontSize: 13 },
  summaryValue: { color: COLORS.textMain, fontSize: 13, ...FONTS.medium },
  summaryTotalLabel: { color: COLORS.textMain, fontSize: 15, ...FONTS.bold },
  summaryTotalValue: { color: COLORS.primary, fontSize: 18, ...FONTS.bold },
  summaryDivider: { height: 1, backgroundColor: COLORS.border, marginVertical: 6 },
  summaryNote: { color: COLORS.textMuted, fontSize: 10.5, marginTop: 8, fontStyle: 'italic' },

  infoBox: {
    flexDirection: 'row',
    gap: 8,
    margin: SPACING.md,
    padding: 12,
    borderRadius: RADIUS.md,
    backgroundColor: 'rgba(217,119,6,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(217,119,6,0.4)',
    alignItems: 'flex-start',
  },
  infoBoxText: { color: COLORS.textMain, fontSize: 12, lineHeight: 16, flex: 1 },

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
