import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { api } from '../src/constants/api';
import { useAuth } from '../src/context/AuthContext';

type Plan = {
  plan_id: string; name: string; price: number; currency: string;
  duration_days: number; color: string; benefits: string[];
};

export default function CityPassScreen() {
  const router = useRouter();
  const { user, login } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [myPass, setMyPass] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const p = await api.get('/city-pass/plans');
        setPlans(p);
        if (user) {
          const mp = await api.get('/city-pass/mine').catch(() => null);
          setMyPass(mp);
        }
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    load();
  }, [user]);

  const activatePass = async (planId: string) => {
    if (!user) { login(); return; }
    setActivating(planId);
    try {
      const res = await api.post('/city-pass/activate', { plan_id: planId });
      if (res.pass) setMyPass(res.pass);
    } catch (e) { console.error(e); }
    setActivating(null);
  };

  const formatPrice = (p: number) => `$${(p / 1000).toFixed(0)}K COP`;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity testID="citypass-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>City Pass</Text>
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
              <Text style={styles.activeTitle}>Pass Activo</Text>
              <Text style={styles.activePlan}>{plans.find(p => p.plan_id === myPass.plan_id)?.name || myPass.plan_id}</Text>
              <Text style={styles.activeExpiry}>Válido hasta: {new Date(myPass.expires_at).toLocaleDateString('es-CO')}</Text>
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
                  {activating === plan.plan_id ? (
                    <ActivityIndicator size="small" color={COLORS.white} />
                  ) : (
                    <Text style={styles.activateText}>
                      {user ? 'Activar Pass' : 'Inicia sesión para activar'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}
        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
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
  activateBtn: { marginHorizontal: SPACING.lg, marginBottom: SPACING.lg, borderRadius: RADIUS.full, paddingVertical: 14, alignItems: 'center' },
  activateText: { fontSize: 15, color: COLORS.white, ...FONTS.bold },
  activePassSection: { padding: SPACING.lg },
  activePassCard: { borderRadius: RADIUS.xl, borderWidth: 2, padding: SPACING.xl, alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.surface },
  activeTitle: { fontSize: 14, color: COLORS.primary, ...FONTS.bold, letterSpacing: 2, textTransform: 'uppercase' },
  activePlan: { fontSize: 28, color: COLORS.textMain, ...FONTS.bold },
  activeExpiry: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular },
  activeBenefits: { width: '100%', marginTop: SPACING.md, gap: 8 },
});
