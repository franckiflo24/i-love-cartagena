import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Linking,
} from 'react-native';
import { Alert } from '../../src/lib/alert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '@/src/constants/theme';
import { api } from '@/src/constants/api';
import { useLang } from '@/src/context/LanguageContext';
import { openWompiCheckout, checkWompiEnabled } from '@/src/lib/wompi';
import { useTr } from '@/src/i18n/autoTr';
import { bogotaDatePlus } from '@/src/lib/eventTime';
import { goTab } from '@/src/lib/nav';
import { venueWhatsApp } from '@/src/lib/whatsapp';

export default function ExperienceBookingScreen() {
  const params = useLocalSearchParams<{ id: string; title: string; price: string; currency: string; wa?: string; venue?: string }>();
  const router = useRouter();
  const { s } = useLang();
  const [step, setStep] = useState(1);
  const [selectedDate, setSelectedDate] = useState('');
  const [guests, setGuests] = useState(1);
  const [loading, setLoading] = useState(false);
  // Honesty rule (drop P1-14): the CTA may only say "Pagar" when a real payment
  // path is live for this surface. Native is hard-off (wompi.ts), web follows
  // the server flag. Until then the booking is a pre-filled WhatsApp request —
  // the same path reservation/new.tsx has always used.
  const [paymentsLive, setPaymentsLive] = useState(false);
  const tr = useTr();

  useEffect(() => {
    let alive = true;
    checkWompiEnabled()
      .then((cfg) => { if (alive) setPaymentsLive(!!cfg.enabled); })
      .catch(() => { if (alive) setPaymentsLive(false); });
    return () => { alive = false; };
  }, []);

  const pricePerPerson = parseInt(params.price || '0', 10);
  const totalPrice = pricePerPerson * guests;
  const currency = params.currency || 'COP';

  // Cartagena's calendar (UTC skipped tomorrow after 19:00 Bogotá).
  const dates = Array.from({ length: 14 }, (_, i) => bogotaDatePlus(i + 1));

  const formatDate = (iso: string) => {
    const d = new Date(iso + 'T12:00:00');
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return { day: tr(days[d.getDay()]), date: d.getDate(), month: tr(months[d.getMonth()]) };
  };

  // WhatsApp reservation: pre-filled with the item so the operator (or the AMO
  // concierge line, when the venue has no validated mobile) gets everything in
  // one message. Mirrors reservation/new.tsx. No payment is taken by AMO.
  const reserveByWhatsApp = async () => {
    const { number: waPhone, isAmo } = venueWhatsApp({ whatsapp: params.wa || '' });
    const venue = params.venue || '';
    const people = `${guests} persona${guests > 1 ? 's' : ''}`;
    const peopleEn = `${guests} ${guests > 1 ? 'people' : 'person'}`;
    const ref = `${totalPrice.toLocaleString()} ${currency}`;
    const msgEs = isAmo
      ? `Hola AMO Life! Quiero reservar la experiencia *${params.title}*${venue ? ` con ${venue}` : ''}.\n\nFecha: ${selectedDate}\nPersonas: ${people}\nPrecio de referencia: ${ref}\n\nVia AMO Life`
      : `Hola! Reserva via *AMO Life* 🌴\n\nExperiencia: *${params.title}*\nFecha: ${selectedDate}\nPersonas: ${people}\nPrecio de referencia: ${ref}\n\nGracias!`;
    const msgEn = isAmo
      ? `Hi AMO Life! I'd like to book the experience *${params.title}*${venue ? ` with ${venue}` : ''}.\n\nDate: ${selectedDate}\nParty: ${peopleEn}\nReference price: ${ref}\n\nVia AMO Life`
      : `Hi! Booking via *AMO Life* 🌴\n\nExperience: *${params.title}*\nDate: ${selectedDate}\nParty: ${peopleEn}\nReference price: ${ref}\n\nThank you!`;
    const waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(`${msgEs}\n\n---\n\n${msgEn}`)}`;
    try {
      await Linking.openURL(waUrl);
    } catch {
      Alert.alert(tr('No se pudo abrir WhatsApp'), tr('Instala WhatsApp o escríbenos a') + ` +${waPhone}`);
    }
  };

  const handleBook = async () => {
    if (!selectedDate) {
      Alert.alert('', s('experience_date') || 'Please select a date');
      return;
    }
    if (!paymentsLive) {
      await reserveByWhatsApp();
      return;
    }
    setLoading(true);
    try {
      // Payments are live for this surface (never on native — wompi.ts hard-off).
      // Re-check the flag at tap time so a flipped server config can't strand the user.
      const cfg = await checkWompiEnabled();
      if (!cfg.enabled) {
        setLoading(false);
        setPaymentsLive(false);
        await reserveByWhatsApp();
        return;
      }
      const result = await api.post('/payments/wompi/experience', {
        experience_id: params.id,
        qty: guests,
        date: selectedDate,
      });
      if (result.checkout_url && result.reference) {
        const wompiResult = await openWompiCheckout(result.checkout_url, result.reference);
        if (wompiResult.status === 'approved') {
          goTab(router, '/(tabs)/bookings');
        } else {
          Alert.alert(tr('Pago'), `Estado: ${wompiResult.status}`);
        }
      } else {
        // No checkout_url from the server: never leave the user with nothing — the
        // WhatsApp request is the honest path in every non-live case.
        setLoading(false);
        await reserveByWhatsApp();
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || tr('No se pudo reservar'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => step > 1 ? setStep(step - 1) : router.back()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{params.title || tr('Reservar experiencia')}</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Steps indicator */}
      <View style={styles.stepsRow}>
        {[1, 2, 3].map((n) => (
          <View key={n} style={[styles.stepDot, step >= n && styles.stepDotActive]} />
        ))}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: SPACING.lg }}>
        {/* Step 1: Select Date */}
        {step === 1 && (
          <View>
            <Text style={styles.stepTitle}>{s('experience_date') || 'Select Date'}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dateScroll}>
              {dates.map((d) => {
                const { day, date, month } = formatDate(d);
                const selected = selectedDate === d;
                return (
                  <TouchableOpacity
                    key={d}
                    style={[styles.dateCard, selected && styles.dateCardSelected]}
                    onPress={() => setSelectedDate(d)}
                  >
                    <Text style={[styles.dateDay, selected && styles.dateTextSelected]}>{day}</Text>
                    <Text style={[styles.dateNumber, selected && styles.dateTextSelected]}>{date}</Text>
                    <Text style={[styles.dateMonth, selected && styles.dateTextSelected]}>{month}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              style={[styles.nextButton, !selectedDate && styles.buttonDisabled]}
              onPress={() => selectedDate && setStep(2)}
              disabled={!selectedDate}
            >
              <Text style={styles.nextButtonText}>{tr('Continuar')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Step 2: Select Guests */}
        {step === 2 && (
          <View>
            <Text style={styles.stepTitle}>{s('experience_guests') || 'Number of Guests'}</Text>
            <View style={styles.guestPicker}>
              <TouchableOpacity
                style={styles.guestButton}
                onPress={() => setGuests(Math.max(1, guests - 1))}
              >
                <Ionicons name="remove" size={24} color={COLORS.textMain} />
              </TouchableOpacity>
              <Text style={styles.guestCount}>{guests}</Text>
              <TouchableOpacity
                style={styles.guestButton}
                onPress={() => setGuests(Math.min(20, guests + 1))}
              >
                <Ionicons name="add" size={24} color={COLORS.textMain} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.nextButton} onPress={() => setStep(3)}>
              <Text style={styles.nextButtonText}>{tr('Continuar')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Step 3: Summary & Pay */}
        {step === 3 && (
          <View>
            <Text style={styles.stepTitle}>{tr('Resumen del pedido')}</Text>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>{params.title}</Text>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>{tr('Fecha')}</Text>
                <Text style={styles.summaryValue}>{selectedDate}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>{tr('Personas')}</Text>
                <Text style={styles.summaryValue}>{guests}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>{tr('Precio por persona')}</Text>
                <Text style={styles.summaryValue}>${pricePerPerson.toLocaleString()} {currency}</Text>
              </View>
              <View style={[styles.summaryRow, styles.summaryTotal]}>
                <Text style={styles.totalLabel}>{tr('Total')}</Text>
                <Text style={styles.totalValue}>${totalPrice.toLocaleString()} {currency}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.payButton, loading && styles.buttonDisabled]}
              onPress={handleBook}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : paymentsLive ? (
                <Text style={styles.payButtonText}>{tr('Pagar')} ${totalPrice.toLocaleString()} {currency}</Text>
              ) : (
                <View style={styles.waRow}>
                  <Ionicons name="logo-whatsapp" size={18} color="#fff" />
                  <Text style={styles.payButtonText}>{tr('Reservar por WhatsApp')}</Text>
                </View>
              )}
            </TouchableOpacity>
            {!paymentsLive && (
              <Text style={styles.waNote}>
                {tr('AMO no cobra: confirmas y pagas directamente con el operador.')}
              </Text>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  headerTitle: { color: COLORS.textMain, fontSize: 16, ...FONTS.semibold, flex: 1, textAlign: 'center' },
  stepsRow: { flexDirection: 'row', justifyContent: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm },
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.border },
  stepDotActive: { backgroundColor: COLORS.primary, width: 24 },
  stepTitle: { color: COLORS.textMain, fontSize: 22, ...FONTS.bold, marginBottom: SPACING.lg },
  dateScroll: { marginBottom: SPACING.xl },
  dateCard: { width: 64, height: 80, borderRadius: RADIUS.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, justifyContent: 'center', alignItems: 'center', marginRight: SPACING.sm },
  dateCardSelected: { borderColor: COLORS.primary, backgroundColor: `${COLORS.primary}20` },
  dateDay: { color: COLORS.textMuted, fontSize: 11, ...FONTS.medium },
  dateNumber: { color: COLORS.textMain, fontSize: 22, ...FONTS.bold },
  dateMonth: { color: COLORS.textMuted, fontSize: 11 },
  dateTextSelected: { color: COLORS.primary },
  guestPicker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.xl, marginVertical: SPACING.xl },
  guestButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, justifyContent: 'center', alignItems: 'center' },
  guestCount: { color: COLORS.textMain, fontSize: 40, ...FONTS.bold },
  nextButton: { backgroundColor: COLORS.primary, paddingVertical: SPACING.md, borderRadius: RADIUS.full, alignItems: 'center', marginTop: SPACING.lg },
  nextButtonText: { color: '#fff', fontSize: 16, ...FONTS.bold },
  buttonDisabled: { opacity: 0.5 },
  summaryCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.lg, marginBottom: SPACING.lg },
  summaryTitle: { color: COLORS.textMain, fontSize: 18, ...FONTS.bold, marginBottom: SPACING.md },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  summaryLabel: { color: COLORS.textMuted, fontSize: 14 },
  summaryValue: { color: COLORS.textMain, fontSize: 14, ...FONTS.medium },
  summaryTotal: { borderBottomWidth: 0, marginTop: SPACING.sm, paddingTop: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.primary },
  totalLabel: { color: COLORS.textMain, fontSize: 16, ...FONTS.bold },
  totalValue: { color: COLORS.primary, fontSize: 20, ...FONTS.bold },
  payButton: { backgroundColor: COLORS.primary, paddingVertical: SPACING.md, borderRadius: RADIUS.full, alignItems: 'center' },
  payButtonText: { color: '#fff', fontSize: 16, ...FONTS.bold },
  waRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  waNote: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center', marginTop: SPACING.sm },
});
