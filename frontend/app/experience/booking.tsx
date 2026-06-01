import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '@/src/constants/theme';
import { api } from '@/src/constants/api';
import { useLang } from '@/src/context/LanguageContext';
import { openWompiCheckout } from '@/src/lib/wompi';

export default function ExperienceBookingScreen() {
  const params = useLocalSearchParams<{ id: string; title: string; price: string; currency: string }>();
  const router = useRouter();
  const { s } = useLang();
  const [step, setStep] = useState(1);
  const [selectedDate, setSelectedDate] = useState('');
  const [guests, setGuests] = useState(1);
  const [loading, setLoading] = useState(false);

  const pricePerPerson = parseInt(params.price || '0', 10);
  const totalPrice = pricePerPerson * guests;
  const currency = params.currency || 'COP';

  const dates = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i + 1);
    return d.toISOString().split('T')[0];
  });

  const formatDate = (iso: string) => {
    const d = new Date(iso + 'T12:00:00');
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return { day: days[d.getDay()], date: d.getDate(), month: months[d.getMonth()] };
  };

  const handleBook = async () => {
    if (!selectedDate) {
      Alert.alert('', s('experience_date') || 'Please select a date');
      return;
    }
    setLoading(true);
    try {
      const result = await api.post('/payments/wompi/experience', {
        experience_id: params.id,
        qty: guests,
        date: selectedDate,
      });
      if (result.checkout_url && result.reference) {
        const status = await openWompiCheckout(result.checkout_url, result.reference);
        if (status === 'approved') {
          router.replace('/(tabs)/bookings' as any);
        } else {
          Alert.alert('Payment', `Status: ${status}`);
        }
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Booking failed');
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
        <Text style={styles.headerTitle}>{params.title || 'Book Experience'}</Text>
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
              <Text style={styles.nextButtonText}>Continue</Text>
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
              <Text style={styles.nextButtonText}>Continue</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Step 3: Summary & Pay */}
        {step === 3 && (
          <View>
            <Text style={styles.stepTitle}>Order Summary</Text>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>{params.title}</Text>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Date</Text>
                <Text style={styles.summaryValue}>{selectedDate}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Guests</Text>
                <Text style={styles.summaryValue}>{guests}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Price per person</Text>
                <Text style={styles.summaryValue}>${pricePerPerson.toLocaleString()} {currency}</Text>
              </View>
              <View style={[styles.summaryRow, styles.summaryTotal]}>
                <Text style={styles.totalLabel}>Total</Text>
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
              ) : (
                <Text style={styles.payButtonText}>Pay ${totalPrice.toLocaleString()} {currency}</Text>
              )}
            </TouchableOpacity>
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
});
