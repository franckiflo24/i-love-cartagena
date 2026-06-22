import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { api } from '../src/constants/api';
import { useAuth } from '../src/context/AuthContext';
import { useTr } from '../src/i18n/autoTr';
import { openWompiCheckout, checkWompiEnabled, notConfiguredAlert } from '../src/lib/wompi';

type Plan = {
  plan_id: string; name: string; price: number; currency: string;
  duration_days: number; color: string; benefits: string[];
};

/** Safe date parser: returns null on null/empty/garbage, valid Date otherwise */
function safeDateParse(v: unknown): Date | null {
  if (v == null || v === '') return null;
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? null : d;
}

/** Format a date value safely — returns 'Fecha no disponible' on bad input */
function safeFormatDate(v: unknown): string {
  const d = safeDateParse(v);
  if (!d) return 'Fecha no disponible';
  return d.toLocaleDateString('es-CO');
}

export default function CityPassScreen() {
  const tr = useTr();
  const router = useRouter();
  const { user, login } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [myPass, setMyPass] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState<string | null>(null);
  const [paySheetVisible, setPaySheetVisible] = useState(false);
  const [payPlan, setPayPlan] = useState<Plan | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const p = await api.get('/city-pass/plans');
        setPlans(p);
        if (user) {
          const mp = await api.get('/city-pass/mine').catch(() => null);
          // Static mode returns [] — treat empty array and non-object as null (no active pass)
          setMyPass(mp && !Array.isArray(mp) && typeof mp === 'object' && mp.plan_id ? mp : null);
        }
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    load();
  }, [user]);

  const [activating, setActivating] = useState(false);

  const activatePass = async (planId: string) => {
    if (activating) return;
    setActivating(true);
    try {
      const wompi = await checkWompiEnabled();
      if (!wompi.enabled) {
        notConfiguredAlert();
        return;
      }
      const res = await api.post('/payments/wompi/city-pass', { plan_id: planId });
      if (res.checkout_url && res.reference) {
        const result = await openWompiCheckout(res.checkout_url, res.reference);
        if (result.status === 'approved') {
          Alert.alert('¡Listo!', 'Tu City Pass está activo. ¡Disfruta Cartagena!');
          const pass = await api.get('/city-pass/mine');
          setMyPass(pass);
        } else if (result.status === 'declined') {
          Alert.alert('Pago rechazado', 'Intenta con otro método de pago.');
        } else if (result.status !== 'pending') {
          Alert.alert('Pago', `Estado: ${result.status}`);
        }
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo procesar el pago');
    } finally {
      setActivating(false);
    }
  };

  const formatPrice = (p: number) => `$${(p / 1000).toFixed(0)}K COP`;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity testID="citypass-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>{tr('City Pass')}</Text>
          <Text style={styles.subtitle}>Tu pase a Cartagena</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 60 }} />
        ) : myPass ? (
          <View style={styles.activePassSection}>
            <View style={[styles.activePassCard, { borderColor: COLORS.primary }]}>
              <Ionicons name="shield-checkmark" size={40} color={COLORS.primary} />
              <Text style={styles.activeTitle}>Pass Activo · Demo</Text>
              <Text style={styles.activePlan}>{plans.find(p => p.plan_id === myPass.plan_id)?.name || myPass.plan_id}</Text>
              <Text style={styles.activeExpiry}>Válido hasta: {safeFormatDate(myPass.expires_at)}</Text>
              <View style={styles.activeBenefits}>
                {(plans.find(p => p.plan_id === myPass.plan_id)?.benefits || []).map((b, i) => (
                  <View key={i} style={styles.benefitRow}>
                    <Ionicons name="checkmark-circle" size={16} color={COLORS.primary} />
                    <Text style={styles.benefitText}>{b}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.heroBanner}>
              <Ionicons name="sparkles" size={32} color={COLORS.primary} />
              <Text style={styles.heroTitle}>Vive Cartagena sin límites</Text>
              <Text style={styles.heroDesc}>Acceso preferente, descuentos exclusivos y beneficios en todos los partners certificados.</Text>
            </View>

            {plans.map(plan => (
              <View key={plan.plan_id} testID={`plan-${plan.plan_id}`} style={[styles.planCard, { borderColor: `${plan.color}40` }]}>
                <View style={[styles.planHeader, { backgroundColor: `${plan.color}15` }]}>
                  <View style={styles.planNameRow}>
                    <Ionicons name="ticket" size={20} color={plan.color} />
                    <Text style={[styles.planName, { color: plan.color }]}>{plan.name}</Text>
                  </View>
                  <View style={styles.priceRow}>
                    <Text style={styles.planPrice}>{formatPrice(plan.price)}</Text>
                    <Text style={styles.planDuration}>/ {plan.duration_days} días</Text>
                  </View>
                </View>

                <View style={styles.benefitsList}>
                  {plan.benefits.map((b, i) => (
                    <View key={i} style={styles.benefitRow}>
                      <Ionicons name="checkmark-circle" size={16} color={plan.color} />
                      <Text style={styles.benefitText}>{b}</Text>
                    </View>
                  ))}
                </View>

                <TouchableOpacity
                  testID={`activate-${plan.plan_id}`}
                  style={[styles.activateBtn, { backgroundColor: plan.color }]}
                  onPress={() => activatePass(plan.plan_id)}
                  disabled={!!activating}
                >
                  {activating ? (
                    <ActivityIndicator size="small" color={COLORS.white} />
                  ) : (
                    <Text style={styles.activateText}>
                      {tr('Activar')} · {formatPrice(plan.price)}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}
        <View style={{ height: SPACING.xxl }} />
      </ScrollView>

      {/* Payment simulation sheet */}
      <PaymentSheet
        visible={paySheetVisible}
        onClose={() => setPaySheetVisible(false)}
        amount={payPlan?.price || 100000}
        currency="COP"
        meta={{ type: 'city-pass', plan_id: payPlan?.plan_id || '', plan_name: payPlan?.name || '' }}
        title="Simular activación — City Pass"
        onSuccess={(result: PaymentResult) => {
          setPaySheetVisible(false);
          if (result.success && payPlan) {
            setMyPass({
              plan_id: payPlan.plan_id,
              plan_name: payPlan.name,
              status: 'active',
              activated_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + payPlan.duration_days * 86400000).toISOString(),
            });
            Alert.alert('City Pass activado', `Tu ${payPlan.name} está activo.`);
          }
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, color: COLORS.textMain, ...FONTS.bold },
  subtitle: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular },
  heroBanner: { alignItems: 'center', paddingVertical: SPACING.xl, paddingHorizontal: SPACING.lg, gap: SPACING.sm },
  heroTitle: { fontSize: 24, color: COLORS.textMain, ...FONTS.bold, textAlign: 'center' },
  heroDesc: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', lineHeight: 22 },
  planCard: { marginHorizontal: SPACING.lg, marginBottom: SPACING.md, borderRadius: RADIUS.xl, borderWidth: 1, overflow: 'hidden', backgroundColor: COLORS.surface },
  planHeader: { padding: SPACING.lg },
  planNameRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  planName: { fontSize: 18, ...FONTS.bold },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: SPACING.sm },
  planPrice: { fontSize: 28, color: COLORS.textMain, ...FONTS.bold },
  planDuration: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular },
  benefitsList: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm, gap: 8 },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  benefitText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, flex: 1 },
  activateBtn: { marginHorizontal: SPACING.lg, marginBottom: SPACING.sm, borderRadius: RADIUS.full, paddingVertical: 14, alignItems: 'center' },
  activateText: { fontSize: 15, color: COLORS.white, ...FONTS.bold },
  simActivateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, marginHorizontal: SPACING.lg, marginBottom: SPACING.lg, borderRadius: RADIUS.full, paddingVertical: 12, borderWidth: 1, borderColor: COLORS.primary, backgroundColor: 'rgba(212,175,55,0.08)' },
  simActivateText: { fontSize: 14, color: COLORS.primary, ...FONTS.semibold },
  activePassSection: { padding: SPACING.lg },
  activePassCard: { borderRadius: RADIUS.xl, borderWidth: 2, padding: SPACING.xl, alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.surface },
  activeTitle: { fontSize: 14, color: COLORS.primary, ...FONTS.bold, letterSpacing: 2, textTransform: 'uppercase' },
  activePlan: { fontSize: 28, color: COLORS.textMain, ...FONTS.bold },
  activeExpiry: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular },
  activeBenefits: { width: '100%', marginTop: SPACING.md, gap: 8 },
});
