import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Dimensions, Share } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useAuth } from '../../src/context/AuthContext';
import { openWompiCheckout, checkWompiEnabled, notConfiguredAlert } from '../../src/lib/wompi';

const { width: screenWidth } = Dimensions.get('window');

type Plan = {
  plan_id: string; name: string; price: number; currency: string;
  duration_days: number; color: string; benefits: string[];
};

const PLAN_ICONS: Record<string, string> = {
  pass_basic: 'compass',
  pass_premium: 'star',
  pass_ultimate: 'diamond',
};

export default function CityPassTab() {
  const router = useRouter();
  const { user, login } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [myPass, setMyPass] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState<string | null>(null);
  const [portTax, setPortTax] = useState<{ price_per_person: number; season_label: string } | null>(null);
  const [activeTickets, setActiveTickets] = useState<number>(0);

  useEffect(() => {
    const load = async () => {
      try {
        const p = await api.get('/city-pass/plans');
        setPlans(p);
        const pt = await api.get('/port-tax/config').catch(() => null);
        if (pt) setPortTax(pt);
        if (user) {
          const mp = await api.get('/city-pass/mine').catch(() => null);
          setMyPass(mp);
          const tickets = await api.get('/port-tax/my-tickets').catch(() => []);
          setActiveTickets((Array.isArray(tickets) ? tickets : []).filter((t: any) => t.status === 'paid').length);
        }
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    load();
  }, [user]);

  const activatePass = async (planId: string) => {
    if (!user) {
      router.push({ pathname: '/login' as any, params: { next: '/(tabs)/citypass' } });
      return;
    }
    setActivating(planId);
    try {
      const cfg = await checkWompiEnabled();
      if (!cfg.enabled) {
        // Fallback to legacy demo activation if Wompi is not configured yet.
        notConfiguredAlert();
        const res = await api.post('/city-pass/activate', { plan_id: planId });
        if (res.pass) setMyPass(res.pass);
      } else {
        // Real Wompi checkout
        const redirect = (process.env.EXPO_PUBLIC_BACKEND_URL || '') + '/payments/return';
        const order = await api.post('/payments/wompi/city-pass', {
          plan_id: planId,
          redirect_url: redirect,
        });
        const result = await openWompiCheckout(order.checkout_url, order.reference);
        if (result.status === 'approved') {
          // Refresh active pass
          const me = await api.get('/city-pass/mine');
          if (me && me.pass) setMyPass(me.pass);
          router.push({ pathname: '/payments/return' as any, params: { reference: order.reference } });
        } else if (result.status === 'pending') {
          router.push({ pathname: '/payments/return' as any, params: { reference: order.reference } });
        } else {
          router.push({ pathname: '/payments/return' as any, params: { reference: order.reference } });
        }
      }
    } catch (e) { console.error(e); }
    setActivating(null);
  };

  const formatPrice = (p: number) => `$${(p / 1000).toFixed(0)}K`;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 80 }} />
        ) : myPass ? (
          /* ── Active Pass with QR Code ── */
          <View style={styles.activeSection}>
            {/* QR Card */}
            <View style={styles.qrCard}>
              <View style={styles.qrHeader}>
                <View style={styles.qrBadge}>
                  <Ionicons name="shield-checkmark" size={14} color="#22C55E" />
                  <Text style={styles.qrBadgeText}>PASS ACTIVO</Text>
                </View>
                <TouchableOpacity onPress={() => {
                  const planName = plans.find(p => p.plan_id === myPass.plan_id)?.name || '';
                  Share.share({ message: `🎫 Mi City Pass ${planName} de Amo Cartagena está activo! Descarga la app 🎧` });
                }}>
                  <Ionicons name="share-social-outline" size={20} color={COLORS.textMuted} />
                </TouchableOpacity>
              </View>

              <Text style={styles.qrPlanName}>{plans.find(p => p.plan_id === myPass.plan_id)?.name || 'City Pass'}</Text>
              <Text style={styles.qrExpiry}>Válido hasta: {new Date(myPass.expires_at).toLocaleDateString('es-CO')}</Text>

              {/* QR Code */}
              <View style={styles.qrContainer}>
                <View style={styles.qrWhiteBg}>
                  <QRCode
                    value={JSON.stringify({
                      type: 'city_pass',
                      pass_id: myPass.pass_id,
                      plan: myPass.plan_id,
                      user: myPass.user_id,
                      exp: myPass.expires_at,
                      app: 'musica_cartagena',
                    })}
                    size={180}
                    color="#1a1a2e"
                    backgroundColor="#FFFFFF"
                  />
                </View>
                <Text style={styles.qrHint}>Muestra este código en los partners</Text>
              </View>

              <View style={styles.qrPassId}>
                <Text style={styles.qrPassIdText}>ID: {myPass.pass_id?.toUpperCase()?.slice(0, 12)}</Text>
              </View>
            </View>

            {/* Benefits */}
            <View style={styles.benefitsCard}>
              <Text style={styles.benefitsTitle}>Tus beneficios</Text>
              {(plans.find(p => p.plan_id === myPass.plan_id)?.benefits || []).map((b, i) => (
                <View key={i} style={styles.benefitRow}>
                  <Ionicons name="checkmark-circle" size={16} color={COLORS.primary} />
                  <Text style={styles.benefitText}>{b}</Text>
                </View>
              ))}
            </View>

            {/* Quick Access CTA */}
            <TouchableOpacity style={styles.discoverCTA} onPress={() => router.push('/(tabs)/agenda' as any)}>
              <Ionicons name="calendar" size={20} color={COLORS.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.discoverCTATitle}>Ver agenda cultural</Text>
                <Text style={styles.discoverCTADesc}>Accede a los eventos con tu pass</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>

            {/* Port Tax module also shown to active-pass users */}
            {portTax && (
              <TouchableOpacity
                style={styles.portTaxCard}
                activeOpacity={0.85}
                onPress={() => router.push('/port-tax/checkout' as any)}
              >
                <View style={styles.portTaxLeft}>
                  <View style={styles.portTaxIconWrap}>
                    <Ionicons name="boat" size={22} color={COLORS.primary} />
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.portTaxTitleRow}>
                    <Text style={styles.portTaxTitle}>Tasa Portuaria</Text>
                    <View style={styles.portTaxBadge}>
                      <Ionicons name="qr-code" size={10} color="#22C55E" />
                      <Text style={styles.portTaxBadgeText}>PAGA Y EMBARCA</Text>
                    </View>
                  </View>
                  <Text style={styles.portTaxSub}>
                    ${portTax.price_per_person.toLocaleString('es-CO')} COP / persona · Muelle La Bodeguita
                  </Text>
                  {activeTickets > 0 && (
                    <TouchableOpacity
                      style={styles.myTicketsBtn}
                      onPress={() => router.push('/port-tax/tickets' as any)}
                    >
                      <Ionicons name="ticket" size={12} color={COLORS.primary} />
                      <Text style={styles.myTicketsText}>
                        {activeTickets} tiquete{activeTickets !== 1 ? 's' : ''} activo{activeTickets !== 1 ? 's' : ''}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        ) : (
          /* ── Plans View ── */
          <>
            {/* Hero */}
            <View style={styles.hero}>
              <View style={styles.heroIconRow}>
                <Ionicons name="sparkles" size={28} color={COLORS.primary} />
                <Ionicons name="heart" size={22} color="#EF4444" />
              </View>
              <Text style={styles.heroTitle}>City Pass</Text>
              <Text style={styles.heroSubtitle}>Vive la cultura sin límite</Text>
              <Text style={styles.heroDesc}>
                Tu pase cultural para vivir Cartagena al máximo. Acceso a museos, monumentos y eventos culturales.
              </Text>
            </View>

            {/* ── Tasa Portuaria module ── */}
            {portTax && (
              <TouchableOpacity
                style={styles.portTaxCard}
                activeOpacity={0.85}
                onPress={() => router.push('/port-tax/checkout' as any)}
              >
                <View style={styles.portTaxLeft}>
                  <View style={styles.portTaxIconWrap}>
                    <Ionicons name="boat" size={22} color={COLORS.primary} />
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.portTaxTitleRow}>
                    <Text style={styles.portTaxTitle}>Tasa Portuaria</Text>
                    <View style={styles.portTaxBadge}>
                      <Ionicons name="qr-code" size={10} color="#22C55E" />
                      <Text style={styles.portTaxBadgeText}>PAGA Y EMBARCA</Text>
                    </View>
                  </View>
                  <Text style={styles.portTaxSub}>
                    Pago oficial Muelle La Bodeguita → Islas
                  </Text>
                  <View style={styles.portTaxMeta}>
                    <Text style={styles.portTaxPrice}>
                      ${portTax.price_per_person.toLocaleString('es-CO')}
                    </Text>
                    <Text style={styles.portTaxUnit}>COP / persona</Text>
                  </View>
                  {activeTickets > 0 && (
                    <TouchableOpacity
                      style={styles.myTicketsBtn}
                      onPress={() => router.push('/port-tax/tickets' as any)}
                    >
                      <Ionicons name="ticket" size={12} color={COLORS.primary} />
                      <Text style={styles.myTicketsText}>
                        {activeTickets} tiquete{activeTickets !== 1 ? 's' : ''} activo{activeTickets !== 1 ? 's' : ''}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
              </TouchableOpacity>
            )}

            {/* Plans */}
            {plans.map((plan, idx) => (
              <View key={plan.plan_id} style={[styles.planCard, idx === 1 && styles.planCardFeatured]}>

                <View style={styles.planTop}>
                  <View style={[styles.planIconCircle, { backgroundColor: `${plan.color}20` }]}>
                    <Ionicons name={(PLAN_ICONS[plan.plan_id] || 'ticket') as any} size={22} color={plan.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.planName, { color: plan.color }]}>{plan.name}</Text>
                    <Text style={styles.planDuration}>{plan.duration_days} días de beneficios</Text>
                  </View>
                  <View style={styles.priceBox}>
                    <Text style={styles.planPrice}>{formatPrice(plan.price)}</Text>
                    <Text style={styles.planCurrency}>COP</Text>
                  </View>
                </View>

                <View style={styles.planBenefits}>
                  {plan.benefits.slice(0, 4).map((b, i) => (
                    <View key={i} style={styles.benefitRow}>
                      <Ionicons name="checkmark-circle" size={15} color={plan.color} />
                      <Text style={styles.benefitText}>{b}</Text>
                    </View>
                  ))}
                  {plan.benefits.length > 4 && (
                    <Text style={[styles.moreBenefits, { color: plan.color }]}>+{plan.benefits.length - 4} beneficios más</Text>
                  )}
                </View>

                <TouchableOpacity
                  style={[styles.ctaBtn, { backgroundColor: plan.color }]}
                  onPress={() => activatePass(plan.plan_id)}
                  disabled={!!activating}
                  activeOpacity={0.8}
                >
                  {activating === plan.plan_id ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <>
                      <Ionicons name="flash" size={18} color="#FFF" />
                      <Text style={styles.ctaBtnText}>
                        {user ? 'Activar ahora' : 'Inicia sesión para activar'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ))}

            {/* Trust badges */}
            <View style={styles.trustRow}>
              <View style={styles.trustItem}>
                <Ionicons name="shield-checkmark" size={18} color={COLORS.textMuted} />
                <Text style={styles.trustText}>Pago seguro</Text>
              </View>
              <View style={styles.trustItem}>
                <Ionicons name="refresh" size={18} color={COLORS.textMuted} />
                <Text style={styles.trustText}>Reembolso 24h</Text>
              </View>
              <View style={styles.trustItem}>
                <Ionicons name="headset" size={18} color={COLORS.textMuted} />
                <Text style={styles.trustText}>Soporte 24/7</Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  // Hero
  hero: { alignItems: 'center', paddingTop: SPACING.lg, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md },
  heroIconRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm },
  heroTitle: { fontSize: 28, color: COLORS.textMain, ...FONTS.bold },
  heroSubtitle: { fontSize: 16, color: COLORS.primary, ...FONTS.semibold, marginTop: 2 },
  heroDesc: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', lineHeight: 20, marginTop: SPACING.sm },

  // Highlights
  highlightsRow: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, marginBottom: SPACING.sm },
  highlightItem: { alignItems: 'center', gap: 4 },
  highlightLabel: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium },

  // Plan Card
  planCard: { marginHorizontal: SPACING.lg, marginBottom: SPACING.md, borderRadius: RADIUS.xl, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  planCardFeatured: { borderColor: COLORS.primary, borderWidth: 2 },
  popularBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: COLORS.primary, paddingVertical: 6 },
  popularText: { fontSize: 11, color: '#FFF', ...FONTS.bold, letterSpacing: 1 },

  planTop: { flexDirection: 'row', alignItems: 'center', padding: SPACING.md, gap: SPACING.sm },
  planIconCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  planName: { fontSize: 16, ...FONTS.bold },
  planDuration: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  priceBox: { alignItems: 'flex-end' },
  planPrice: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold },
  planCurrency: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium },

  planBenefits: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm, gap: 6 },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  benefitText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, flex: 1 },
  moreBenefits: { fontSize: 12, ...FONTS.semibold, marginLeft: 28, marginTop: 2 },

  ctaBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, marginHorizontal: SPACING.md, marginBottom: SPACING.md, borderRadius: RADIUS.full, paddingVertical: 14 },
  ctaBtnText: { fontSize: 15, color: '#FFF', ...FONTS.bold },

  // Active pass with QR
  activeSection: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md },
  qrCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, borderWidth: 2, borderColor: COLORS.primary, padding: SPACING.lg, marginBottom: SPACING.md },
  qrHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
  qrBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(34,197,94,0.12)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.full },
  qrBadgeText: { fontSize: 11, color: '#22C55E', ...FONTS.bold, letterSpacing: 1 },
  qrPlanName: { fontSize: 24, color: COLORS.textMain, ...FONTS.bold },
  qrExpiry: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginBottom: SPACING.md },
  qrContainer: { alignItems: 'center', marginVertical: SPACING.md },
  qrWhiteBg: { backgroundColor: '#FFFFFF', padding: 16, borderRadius: RADIUS.lg },
  qrHint: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium, marginTop: SPACING.sm, textAlign: 'center' },
  qrPassId: { alignItems: 'center', marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.border },
  qrPassIdText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, letterSpacing: 1 },
  benefitsCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.md, gap: SPACING.xs },
  benefitsTitle: { fontSize: 15, color: COLORS.textMain, ...FONTS.bold, marginBottom: 4 },

  // Discover CTA
  discoverCTA: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginHorizontal: SPACING.lg, marginTop: SPACING.md, padding: SPACING.md, backgroundColor: `${COLORS.primary}10`, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: `${COLORS.primary}30` },
  discoverCTATitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  discoverCTADesc: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },

  // Trust
  trustRow: { flexDirection: 'row', justifyContent: 'center', gap: SPACING.lg, paddingVertical: SPACING.lg, paddingHorizontal: SPACING.lg },
  trustItem: { alignItems: 'center', gap: 4 },
  trustText: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium },

  // Port Tax module
  portTaxCard: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    marginHorizontal: SPACING.lg, marginBottom: SPACING.md, marginTop: SPACING.sm,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.md,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.xl,
    borderWidth: 1.5, borderColor: 'rgba(217,119,6,0.35)',
  },
  portTaxLeft: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  portTaxIconWrap: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(217,119,6,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  portTaxTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  portTaxTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold },
  portTaxBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(34,197,94,0.15)',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full,
  },
  portTaxBadgeText: { fontSize: 9, color: '#22C55E', ...FONTS.bold, letterSpacing: 0.5 },
  portTaxSub: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },
  portTaxMeta: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 4 },
  portTaxPrice: { fontSize: 18, color: COLORS.primary, ...FONTS.bold },
  portTaxUnit: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },

  myTicketsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    backgroundColor: 'rgba(217,119,6,0.10)', borderRadius: RADIUS.full,
    paddingHorizontal: 8, paddingVertical: 3, marginTop: 6,
  },
  myTicketsText: { fontSize: 11, color: COLORS.primary, ...FONTS.semibold },
});
