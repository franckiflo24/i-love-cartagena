import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Dimensions, Share } from 'react-native';
import { Alert } from '../../src/lib/alert';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { COLORS, SPACING, RADIUS, FONTS, TYPE } from '../../src/constants/theme';
import { api, isAuthStatus } from '../../src/constants/api';
import { useAuth } from '../../src/context/AuthContext';
import { useQrCountdown, useQrFeed } from '../../src/components/tickets/tickets';
import LoadError from '../../src/components/LoadError';
import { openWompiCheckout, checkWompiEnabled, notConfiguredAlert } from '../../src/lib/wompi';
import { useTr } from '../../src/i18n/autoTr';

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

// The pass credential (AMOPASS1) rotates every 10 s SERVER-side, exactly like an event ticket: a screenshot dies in
// seconds (it replaced a static, unsigned JSON QR). useQrFeed owns the poll — focus + AppState aware, every timer
// cleared on blur / unmount — and the countdown only starts after `mounted`, so nothing clock-derived renders before
// hydration. A 404 (no active pass server-side) hides the whole QR block; a code past its deadline that could not be
// refreshed is hidden behind an overlay, never left looking live.
const CITY_PASS_QR_SOURCE = { kind: 'city_pass' } as const;
const QR_NOOP = (): void => undefined; // a renderer failure blanks the panel instead of throwing

function CityPassLiveQr() {
  const tr = useTr();
  const [mounted, setMounted] = useState(false);
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => { setMounted(true); }, []);
  const feed = useQrFeed(CITY_PASS_QR_SOURCE);
  const { frac, secs, warn, stale } = useQrCountdown(feed.frame, mounted && feed.focused);

  if (feed.missing) return null;

  // 24 px of white around the modules, not qrWhiteBg's 16: the old static JSON drew ~55 modules at 180 px (16 px was
  // ~4.7 modules of quiet zone), this short wire draws 33 at 200 px, where 16 px would be under 3 modules against the
  // dark card — below what a door scanner needs.
  const size = Math.max(144, Math.min(200, (boxWidth > 0 ? boxWidth : 248) - 48));
  const panel = size + 48;
  const pct = Math.round(frac * 1000) / 10;
  const secsText = secs === null ? '—' : `${secs} s`;

  return (
    <View
      style={styles.qrContainer}
      onLayout={(e) => setBoxWidth(Math.round(e.nativeEvent.layout.width))}
      testID="citypass-qr"
    >
      {feed.frame ? (
        <>
          <View style={[styles.qrWhiteBg, qrLive.paper]}>
            <QRCode value={feed.frame.wire} size={size} color="#1a1a2e" backgroundColor="#FFFFFF" ecl="Q" onError={QR_NOOP} />
            {stale && (
              <View style={qrLive.stale} testID="citypass-qr-stale" accessibilityRole="alert">
                <Ionicons name={feed.failed ? 'cloud-offline-outline' : 'refresh'} size={26} color={COLORS.textMuted} />
                <Text style={qrLive.staleText}>
                  {feed.failed ? tr('Este código ya venció y no pudimos renovarlo.') : tr('Renovando el código…')}
                </Text>
                {feed.failed && (
                  <TouchableOpacity style={qrLive.retry} onPress={feed.refresh} accessibilityRole="button" accessibilityLabel={tr('Reintentar')}>
                    <Text style={qrLive.retryText}>{tr('Reintentar')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
          <View
            style={[qrLive.barTrack, { width: panel }]}
            accessibilityRole="progressbar"
            accessibilityLabel={tr('Tiempo restante del código')}
            accessibilityValue={{ min: 0, max: 100, now: Math.round(frac * 100), text: secsText }}
            testID="citypass-qr-countdown"
          >
            <View style={[qrLive.barFill, warn && qrLive.barFillWarn, { width: `${pct}%` }]} />
          </View>
        </>
      ) : feed.authLost ? (
        <View style={qrLive.pendingBox}>
          <Text style={qrLive.pending}>{tr('Vuelve a iniciar sesión para ver tu código.')}</Text>
        </View>
      ) : feed.failed ? (
        <View style={qrLive.pendingBox} testID="citypass-qr-failed">
          <Ionicons name="cloud-offline-outline" size={26} color={COLORS.textMuted} />
          <Text style={qrLive.pending}>{tr('No pudimos obtener el código.')}</Text>
          <TouchableOpacity style={qrLive.retry} onPress={feed.refresh} accessibilityRole="button" accessibilityLabel={tr('Reintentar')}>
            <Text style={qrLive.retryText}>{tr('Reintentar')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={qrLive.pendingBox} testID="citypass-qr-pending">
          <ActivityIndicator size="small" color={COLORS.icon} />
        </View>
      )}
      <Text style={styles.qrHint}>{tr('Código dinámico — se renueva cada 10 s')}</Text>
    </View>
  );
}

export default function CityPassTab() {
  const tr = useTr();
  const router = useRouter();
  const { user, login } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [myPass, setMyPass] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  // Hydration guard (React #418): the static export prerenders this route with no
  // nav history, so a render-time router.canGoBack() painted no back button on the
  // server and one on the client. Hold a deterministic first paint until mounted
  // (same pattern as pasaporte.tsx).
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  // The port-tax product is retired (2026-09-26): no authority recognizes a single
  // port tax (it is pier 18.000 + park 13.500 + insurance, paid at the pier) and AMO
  // has no agreement to sell any of it, so this tab makes no port-tax API calls. The
  // honest replacement is the muelle-bodeguita module of the city hub.
  // Guideline 2.1: while payments are disabled in prod, the plan cards must be
  // honest UP FRONT — a visible "Próximamente" state, not a priced Activar
  // button that dead-ends after the tap. null = config check still in flight
  // (buttons stay disabled); flips live automatically when Wompi is enabled.
  const [paymentsLive, setPaymentsLive] = useState<boolean | null>(null);
  useEffect(() => {
    checkWompiEnabled()
      .then(w => setPaymentsLive(!!w.enabled))
      .catch(() => setPaymentsLive(false));
  }, []);

  // P1-9: a failed /city-pass/mine used to drop a HOLDER into the "activate a plan"
  // view; a failed /city-pass/plans left the hero with no plans. Both now surface
  // <LoadError/> and keep the last good data. 401/403 is an answer (no session →
  // no pass), everything else is "we don't know" — never "you have no pass".
  const [passError, setPassError] = useState(false);
  const [plansError, setPlansError] = useState(false);
  const load = useCallback(async () => {
    try {
      const p = await api.get('/city-pass/plans');
      setPlans(Array.isArray(p) ? p : []);
      setPlansError(false);
    } catch (e) {
      console.error('[CityPass] /city-pass/plans', e);
      setPlansError(true);
    }
    if (user) {
      let unknown = false;
      const mp = await api.get('/city-pass/mine').catch((e) => {
        if (!isAuthStatus(e)) { console.error('[CityPass] /city-pass/mine', e); unknown = true; }
        return null;
      });
      setPassError(unknown);
      // STATIC_MODE returns [] (truthy) → without this guard the tab rendered a
      // fake "PASS ACTIVO" QR with plan_id undefined / "Invalid Date" (P2 audit).
      // Match the sibling screen: only a real object with a plan_id is an active pass.
      if (!unknown) setMyPass(mp && !Array.isArray(mp) && typeof mp === 'object' && mp.plan_id ? mp : null);
    } else {
      setPassError(false);
    }
    setLoading(false);
  }, [user]);
  useEffect(() => { load(); }, [load]);

  const activatePass = async (planId: string) => {
    if (activatingId) return;
    setActivatingId(planId);
    try {
      const wompi = await checkWompiEnabled();
      if (!wompi.enabled) {
        notConfiguredAlert();
        return;
      }
      if (!user) {
        // group-stripped path passes safeNext; /citypass resolves to the same tab
        router.push('/login?next=/citypass' as any);
        return;
      }
      const res = await api.post('/payments/wompi/city-pass', { plan_id: planId });
      if (res.checkout_url && res.reference) {
        const result = await openWompiCheckout(res.checkout_url, res.reference);
        if (result.status === 'approved') {
          Alert.alert(tr('¡Listo!'), tr('Tu City Pass está activo. ¡Disfruta Cartagena!'));
          // Reload pass data
          const pass = await api.get('/city-pass/mine');
          // Same guard as the initial load: a static-fallback [] right after returning
          // from Wompi must not render a fake "PASS ACTIVO" QR with Invalid Date.
          setMyPass(pass && !Array.isArray(pass) && typeof pass === 'object' && pass.plan_id ? pass : null);
        } else if (result.status === 'declined') {
          Alert.alert(tr('Pago rechazado'), tr('Intenta con otro método de pago.'));
        } else if (result.status !== 'pending') {
          Alert.alert(tr('Pago'), `${tr('Estado')}: ${result.status}. ${tr('Revisa tu email para más detalles.')}`);
        }
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || tr('No se pudo procesar el pago'));
    } finally {
      setActivatingId(null);
    }
  };

  // NaN-safe: the stale static plans file (price_cop, not price) rendered "$NaNK COP".
  const formatPrice = (p?: number) => (Number.isFinite(p) ? `$${((p as number) / 1000).toFixed(0)}K` : '');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Canonical City Pass screen. Reached almost always via router.push (hidden
          tab, href:null) — from perfil, bookings, search, Luna, payment return —
          so it needs its own back affordance. Gated on mounted + canGoBack() so it
          never shows a broken control if ever surfaced as a root and never
          mismatches the prerendered HTML on hydration. */}
      {mounted && router.canGoBack() && (
        <View style={styles.backHeader}>
          <TouchableOpacity testID="citypass-back-btn" onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
          </TouchableOpacity>
        </View>
      )}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.icon} style={{ marginTop: 80 }} />
        ) : myPass ? (
          /* ── Active Pass with QR Code ── */
          <View style={styles.activeSection}>
            {/* QR Card */}
            <View style={styles.qrCard}>
              <View style={styles.qrHeader}>
                <View style={styles.qrBadge}>
                  <Ionicons name="shield-checkmark" size={14} color="#22C55E" />
                  <Text style={styles.qrBadgeText}>{tr('PASS ACTIVO')}</Text>
                </View>
                <TouchableOpacity onPress={() => {
                  const planName = plans.find(p => p.plan_id === myPass.plan_id)?.name || '';
                  Share.share({ message: `🎫 Mi City Pass ${planName} de AMO Life está activo! Descarga la app 🎧` }).catch(() => {});
                }}>
                  <Ionicons name="share-social-outline" size={20} color={COLORS.textMuted} />
                </TouchableOpacity>
              </View>

              <Text style={styles.qrPlanName}>{plans.find(p => p.plan_id === myPass.plan_id)?.name || 'City Pass'}</Text>
              <Text style={styles.qrExpiry}>{tr('Válido hasta')}: {myPass.expires_at ? new Date(myPass.expires_at).toLocaleDateString('es-CO') : tr('—')}</Text>

              {/* QR Code — the rotating credential (AMOPASS1); no active pass server-side hides the block */}
              <CityPassLiveQr />

              <View style={styles.qrPassId}>
                <Text style={styles.qrPassIdText}>ID: {myPass.pass_id?.toUpperCase()?.slice(0, 12)}</Text>
              </View>
            </View>

            {/* Benefits */}
            <View style={styles.benefitsCard}>
              <Text style={styles.benefitsTitle}>{tr('Tus beneficios')}</Text>
              {(plans.find(p => p.plan_id === myPass.plan_id)?.benefits || []).map((b, i) => (
                <View key={i} style={styles.benefitRow}>
                  <Ionicons name="checkmark-circle" size={16} color={COLORS.mustard} />
                  <Text style={styles.benefitText}>{tr(b)}</Text>
                </View>
              ))}
            </View>

            {/* Quick Access CTA */}
            <TouchableOpacity style={styles.discoverCTA} onPress={() => router.push('/(tabs)/agenda' as any)}>
              <Ionicons name="calendar" size={20} color={COLORS.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.discoverCTATitle}>{tr('Ver agenda cultural')}</Text>
                <Text style={styles.discoverCTADesc}>{tr('Accede a los eventos con tu pass')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>

            {/* Islands: official pier / park / insurance prices — informational, paid at the pier */}
            <TouchableOpacity
              testID="citypass-ciudad-muelle-active"
              style={[styles.officialLink, { marginHorizontal: 0, marginTop: SPACING.md }]}
              onPress={() => router.push('/ciudad/muelle-bodeguita' as any)}
              activeOpacity={0.8}
              accessibilityRole="link"
              accessibilityLabel={tr('Ver precios oficiales del muelle (islas)')}
            >
              <Ionicons name="boat-outline" size={16} color={COLORS.official} />
              <Text style={styles.officialLinkText}>{tr('Ver precios oficiales del muelle (islas)')}</Text>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
        ) : (
          /* ── Plans View ── */
          <>
            {/* P1-9: we could not confirm whether this user holds a pass — say so
                ABOVE the plans instead of silently offering to "activate" one. */}
            {passError && (
              <LoadError message={tr('No se pudo cargar')} retryLabel={tr('reintentar')} onRetry={load} testID="citypass-pass-error" />
            )}
            {/* Hero */}
            <View style={styles.hero}>
              <View style={styles.heroIconRow}>
                <Ionicons name="sparkles" size={28} color={COLORS.mustard} />
                <Ionicons name="heart" size={22} color="#EF4444" />
              </View>
              <Text style={styles.heroTitle}>{tr('City Pass')}</Text>
              <Text style={styles.heroSubtitle}>{tr('Vive la cultura sin límite')}</Text>
              {/* Honest scope: the AMO pass is a benefits pass — it does not include
                  monuments or museums until an ETCAR/MUHCA agreement is signed. */}
              <Text style={styles.heroDesc}>
                {tr('Tu pase de beneficios para vivir Cartagena al máximo: descuentos, eventos y experiencias curadas. Monumentos: solo información oficial por ahora.')}
              </Text>
            </View>

            {/* Plans — a failed catalog load is an error row, never a hero with no plans */}
            {plansError && plans.length === 0 && (
              <LoadError message={tr('No se pudo cargar')} retryLabel={tr('reintentar')} onRetry={load} testID="citypass-plans-error" />
            )}
            {plans.map((plan, idx) => (
              <View key={plan.plan_id} style={[styles.planCard, idx === 1 && styles.planCardFeatured]}>

                <View style={styles.planTop}>
                  <View style={[styles.planIconCircle, { backgroundColor: `${plan.color}20` }]}>
                    <Ionicons name={(PLAN_ICONS[plan.plan_id] || 'ticket') as any} size={22} color={plan.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.planName, { color: plan.color }]}>{plan.name}</Text>
                    <Text style={styles.planDuration}>{plan.duration_days} {tr('días de beneficios')}</Text>
                  </View>
                  <View style={styles.priceBox}>
                    <Text style={styles.planPrice}>{formatPrice(plan.price)}</Text>
                    <Text style={styles.planCurrency}>COP</Text>
                  </View>
                </View>

                <View style={styles.planBenefits}>
                  {(plan.benefits || []).slice(0, 4).map((b, i) => (
                    <View key={i} style={styles.benefitRow}>
                      <Ionicons name="checkmark-circle" size={15} color={plan.color} />
                      <Text style={styles.benefitText}>{tr(b)}</Text>
                    </View>
                  ))}
                  {(plan.benefits || []).length > 4 && (
                    <Text style={[styles.moreBenefits, { color: plan.color }]}>+{plan.benefits.length - 4} {tr('beneficios más')}</Text>
                  )}
                </View>

                {paymentsLive ? (
                  <TouchableOpacity
                    style={[styles.ctaBtn, { backgroundColor: plan.color }]}
                    onPress={() => activatePass(plan.plan_id)}
                    disabled={!!activatingId}
                    activeOpacity={0.8}
                  >
                    {activatingId === plan.plan_id ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <>
                        <Ionicons name="cart-outline" size={18} color="#FFF" />
                        <Text style={styles.ctaBtnText}>
                          {tr('Activar')} · {formatPrice(plan.price)}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                ) : (
                  <View style={[styles.ctaBtn, styles.ctaBtnSoon]}>
                    <Ionicons name="time-outline" size={17} color={plan.color} />
                    <Text style={[styles.ctaBtnSoonText, { color: plan.color }]}>
                      {paymentsLive === null ? tr('Verificando disponibilidad…') : `${tr('Próximamente')} · ${formatPrice(plan.price)}`}
                    </Text>
                  </View>
                )}
              </View>
            ))}

            {/* Honest pointer: monument prices are informational today — the City
                Pass does not include monuments until an agreement is signed. Does
                not touch the payment gating above. */}
            <TouchableOpacity
              testID="citypass-ciudad-monumentos"
              style={styles.officialLink}
              onPress={() => router.push('/ciudad/monumentos' as any)}
              activeOpacity={0.8}
              accessibilityRole="link"
              accessibilityLabel={tr('Ver precios oficiales de los monumentos')}
            >
              <Ionicons name="shield-outline" size={16} color={COLORS.official} />
              <Text style={styles.officialLinkText}>{tr('Ver precios oficiales de los monumentos')}</Text>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
            </TouchableOpacity>

            {/* Islands: what is really paid before boarding (pier + park + insurance,
                at the pier, off-app) — the honest card that replaced the retired
                port-tax checkout. Informational only; AMO sells none of it. */}
            <TouchableOpacity
              testID="citypass-ciudad-muelle"
              style={styles.muelleCard}
              onPress={() => router.push('/ciudad/muelle-bodeguita' as any)}
              activeOpacity={0.8}
              accessibilityRole="link"
              accessibilityLabel={tr('Ver precios oficiales del muelle (islas)')}
            >
              <View style={styles.muelleIconWrap}>
                <Ionicons name="boat" size={20} color={COLORS.official} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.muelleTitle}>{tr('Lo que pagas antes de zarpar')}</Text>
                <Text style={styles.muelleDesc}>
                  {tr('Muelle $18.000 + parque $13.500 + seguro obligatorio, en las taquillas del Muelle La Bodeguita. AMO te informa; no lo vende.')}
                </Text>
                <Text style={styles.muelleCta}>{tr('Ver precios oficiales del muelle (islas)')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
            </TouchableOpacity>

            {/* Trust badges removed (drop P1-14): "Pago seguro / Reembolso 24h /
                Soporte 24/7" promised a payment path that is not live. They may
                only return, deliberately, with a real pentested checkout. */}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  backHeader: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },

  // Hero
  hero: { alignItems: 'center', paddingTop: SPACING.lg, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md },
  heroIconRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm },
  heroTitle: { ...TYPE.display, color: COLORS.textMain },
  heroSubtitle: { fontSize: 16, color: COLORS.mustard, ...FONTS.semibold, marginTop: 2 },
  heroDesc: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', lineHeight: 20, marginTop: SPACING.sm },

  // Highlights
  highlightsRow: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, marginBottom: SPACING.sm },
  highlightItem: { alignItems: 'center', gap: 4 },
  highlightLabel: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium },

  // Plan Card
  planCard: { marginHorizontal: SPACING.lg, marginBottom: SPACING.md, borderRadius: RADIUS.xl, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  planCardFeatured: { borderColor: COLORS.mustard, borderWidth: 2 },
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
  ctaBtnSoon: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: COLORS.border },
  ctaBtnSoonText: { fontSize: 14, ...FONTS.bold },
  officialLink: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: 48, marginHorizontal: SPACING.lg, marginBottom: SPACING.md, paddingHorizontal: SPACING.md, paddingVertical: 10, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(57,184,255,0.25)' },
  officialLinkText: { flex: 1, fontSize: 13, lineHeight: 17, color: COLORS.textMain, ...FONTS.semibold },
  muelleCard: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginHorizontal: SPACING.lg, marginBottom: SPACING.md, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: 'rgba(57,184,255,0.25)' },
  muelleIconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(57,184,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  muelleTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold },
  muelleDesc: { fontSize: 12, lineHeight: 17, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },
  muelleCta: { fontSize: 12, color: COLORS.official, ...FONTS.semibold, marginTop: 6 },

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
});

// City Pass live credential (CityPassLiveQr): the compact rotating-QR panel.
const qrLive = StyleSheet.create({
  paper: { padding: 24 },
  pendingBox: { minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: 8 },
  pending: { fontSize: 13, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center' },
  stale: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: RADIUS.lg, alignItems: 'center', justifyContent: 'center', gap: 8, padding: SPACING.sm },
  staleText: { fontSize: 12, lineHeight: 16, color: '#1F2937', ...FONTS.semibold, textAlign: 'center' },
  retry: { minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, paddingHorizontal: SPACING.lg, borderRadius: RADIUS.full },
  retryText: { fontSize: 13, color: COLORS.black, ...FONTS.bold },
  barTrack: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.10)', overflow: 'hidden', marginTop: 10 },
  barFill: { height: 5, borderRadius: 3, backgroundColor: COLORS.primary },
  barFillWarn: { backgroundColor: '#F59E0B' },
});
