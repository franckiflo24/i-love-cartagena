import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
  Dimensions,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { COLORS, SPACING, RADIUS, FONTS } from '@/src/constants/theme';
import { api, isAuthStatus } from '@/src/constants/api';
import LoadError from '@/src/components/LoadError';
import { useAuth } from '@/src/context/AuthContext';
import { useLang } from '@/src/context/LanguageContext';
import { useTr } from '@/src/i18n/autoTr';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Credit card ratio 85.6mm × 54mm = 1.586
const CARD_WIDTH = SCREEN_WIDTH - SPACING.lg * 2;
const CARD_HEIGHT = CARD_WIDTH / 1.586;

type MemberTier = 'explorer' | 'voyager' | 'elite' | 'legend';

const TIER_CONFIG: Record<
  MemberTier,
  { label: string; icon: keyof typeof Ionicons.glyphMap; gradient: [string, string]; accent: string }
> = {
  explorer: { label: 'Explorer', icon: 'compass',  gradient: ['#1E3A8A', '#3B82F6'], accent: '#3B82F6' },
  voyager:  { label: 'Voyager',  icon: 'boat',     gradient: ['#92400E', '#12B5A5'], accent: '#12B5A5' },
  elite:    { label: 'Elite',    icon: 'diamond',  gradient: ['#581C87', '#A855F7'], accent: '#A855F7' },
  legend:   { label: 'Legend',   icon: 'star',     gradient: ['#92400E', '#F59E0B'], accent: '#F59E0B' },
};

type RewardsData = {
  // The backend account document carries `created_at` (rewards.py never sets `member_since`).
  account?: { member_since?: string; created_at?: string } | null;
  tier: MemberTier;
  tier_label: string;
  points_balance: number;
  benefits: string[];
};

// "Member since" is a real date from the account, or nothing. It used to fall back to
// `new Date()`, which printed "Member since <this month>" on every real card too —
// the backend only ever sends `created_at`.
function memberSinceLabel(account: RewardsData['account']): string | null {
  const raw = account?.member_since ?? account?.created_at;
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  try { return d.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }); } catch { return null; }
}

// ─── Card front ───────────────────────────────────────────────────────────────

function CardFront({
  userName,
  userId,
  tier,
  memberSince,
}: {
  userName: string;
  userId: string;
  tier: MemberTier;
  memberSince: string | null;
}) {
  const cfg = TIER_CONFIG[tier] ?? TIER_CONFIG.explorer;
  const qrValue = `AMO-MEMBER-${userId}`;

  return (
    <LinearGradient
      colors={cfg.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[frontStyles.card, { width: CARD_WIDTH, height: CARD_HEIGHT }]}
    >
      {/* Decorative circles */}
      <View style={frontStyles.circleA} />
      <View style={frontStyles.circleB} />

      {/* Top row */}
      <View style={frontStyles.topRow}>
        <View>
          <Text style={frontStyles.amoLogo}>AMO</Text>
          <Text style={frontStyles.amoSub}>Life</Text>
        </View>
        <View style={[frontStyles.tierBadge, { backgroundColor: 'rgba(0,0,0,0.3)' }]}>
          <Ionicons name={cfg.icon} size={13} color={COLORS.white} />
          <Text style={frontStyles.tierBadgeText}>{cfg.label.toUpperCase()}</Text>
        </View>
      </View>

      {/* QR */}
      <View style={frontStyles.qrWrap}>
        <QRCode
          value={qrValue}
          size={CARD_HEIGHT * 0.48}
          backgroundColor="transparent"
          color={COLORS.white}
        />
      </View>

      {/* Bottom */}
      <View style={frontStyles.bottomRow}>
        <View>
          <Text style={frontStyles.userName}>{userName}</Text>
          {memberSince ? <Text style={frontStyles.memberSince}>Member since {memberSince}</Text> : null}
        </View>
      </View>

      {/* Gold border accent */}
      <View style={frontStyles.borderAccent} />
    </LinearGradient>
  );
}

const frontStyles = StyleSheet.create({
  card: {
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    overflow: 'hidden',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.25)',
  },
  circleA: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    top: -80,
    right: -60,
  },
  circleB: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    top: -40,
    right: -10,
  },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  amoLogo: { fontSize: 22, color: COLORS.white, ...FONTS.bold, letterSpacing: 3 },
  amoSub: { fontSize: 9, color: 'rgba(255,255,255,0.6)', ...FONTS.regular, letterSpacing: 2, marginTop: 1 },
  tierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
  },
  tierBadgeText: { fontSize: 9, color: COLORS.white, ...FONTS.bold, letterSpacing: 1 },
  qrWrap: { alignItems: 'center', justifyContent: 'center' },
  bottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  userName: { fontSize: 14, color: COLORS.white, ...FONTS.bold, letterSpacing: 0.5 },
  memberSince: { fontSize: 9, color: 'rgba(255,255,255,0.5)', ...FONTS.regular, marginTop: 2 },
  borderAccent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(255,215,0,0.4)',
  },
});

// ─── Card back ────────────────────────────────────────────────────────────────

function CardBack({
  tier,
  benefits,
}: {
  tier: MemberTier;
  benefits: string[];
}) {
  const tr = useTr();
  const cfg = TIER_CONFIG[tier] ?? TIER_CONFIG.explorer;

  return (
    <View style={[backStyles.card, { width: CARD_WIDTH, height: CARD_HEIGHT, borderColor: `${cfg.accent}30` }]}>
      {/* Header strip */}
      <LinearGradient
        colors={['rgba(0,0,0,0)', cfg.gradient[0]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={backStyles.strip}
      />

      <View style={backStyles.content}>
        <View style={backStyles.topRow}>
          <Text style={[backStyles.tierName, { color: cfg.accent }]}>{cfg.label} Benefits</Text>
          <Ionicons name={cfg.icon} size={18} color={cfg.accent} />
        </View>

        <View style={backStyles.benefitsList}>
          {benefits.length > 0 ? (
            benefits.slice(0, 5).map((b, i) => (
              <View key={i} style={backStyles.benefitRow}>
                <Ionicons name="checkmark-circle" size={14} color={cfg.accent} />
                <Text style={backStyles.benefitText} numberOfLines={1}>{b}</Text>
              </View>
            ))
          ) : (
            <View style={backStyles.benefitRow}>
              <Ionicons name="sparkles" size={14} color={cfg.accent} />
              <Text style={backStyles.benefitText}>{tr('Acceso a beneficios exclusivos')}</Text>
            </View>
          )}
        </View>

        <View style={backStyles.footer}>
          <Text style={backStyles.support}>Soporte: soporte@amocartagena.co</Text>
          <Text style={backStyles.amoText}>AMO Life</Text>
        </View>
      </View>
    </View>
  );
}

const backStyles = StyleSheet.create({
  card: {
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    overflow: 'hidden',
  },
  strip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '100%',
    opacity: 0.15,
  },
  content: { flex: 1, padding: SPACING.lg, justifyContent: 'space-between' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tierName: { fontSize: 15, ...FONTS.bold, letterSpacing: 0.5 },
  benefitsList: { gap: 8, flex: 1, justifyContent: 'center' },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  benefitText: { fontSize: 12, color: COLORS.textMain, ...FONTS.regular, flex: 1 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  support: { fontSize: 9, color: COLORS.textMuted, ...FONTS.regular },
  amoText: { fontSize: 10, color: 'rgba(255,255,255,0.3)', ...FONTS.bold, letterSpacing: 2 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function AmoCardScreen() {
  const { s } = useLang();
  const tr = useTr();
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();

  const [data, setData] = useState<RewardsData | null>(null);
  const [loading, setLoading] = useState(true);
  // P1-9: the catch used to stub a FABRICATED Explorer card (0 pts, member-since = now)
  // for anonymous users and on any outage — and CardFront printed a "AMO-MEMBER-guest" QR.
  // `data` is now set from a real /rewards/me payload only, so: anonymous or 401/403 →
  // sign-in gate; outage / bad payload → `data` stays null → <LoadError/> + retry.
  const [needsLogin, setNeedsLogin] = useState(false);
  const [isFront, setIsFront] = useState(true);

  // Flip animation
  const flipAnim = useRef(new Animated.Value(0)).current;

  const flipToBack = () => {
    Animated.spring(flipAnim, {
      toValue: 1,
      friction: 8,
      tension: 10,
      useNativeDriver: true,
    }).start(() => setIsFront(false));
  };

  const flipToFront = () => {
    Animated.spring(flipAnim, {
      toValue: 0,
      friction: 8,
      tension: 10,
      useNativeDriver: true,
    }).start(() => setIsFront(true));
  };

  const handleFlip = () => {
    if (isFront) {
      flipToBack();
    } else {
      flipToFront();
    }
  };

  const frontInterpolate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });
  const backInterpolate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['180deg', '360deg'],
  });

  const load = useCallback(async () => {
    try {
      const result = await api.get('/rewards/me');
      if (result && typeof result === 'object' && !Array.isArray(result) && result.tier) {
        setData(result);
        setNeedsLogin(false);
      } else {
        // 200 but not a rewards payload (static mode / a proxy page): not a card we can vouch for.
        console.error('[AmoCard] /rewards/me returned an unexpected payload');
      }
    } catch (e) {
      if (isAuthStatus(e)) {
        setData(null);
        setNeedsLogin(true);
      } else {
        console.error('[AmoCard] /rewards/me', e);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    // One account's card must never survive into another account's (failed) load.
    setData(null);
    setNeedsLogin(false);
    if (!user) {
      // Anonymous: no card to show and no pointless 401 call — the sign-in gate renders.
      setLoading(false);
      return;
    }
    setLoading(true);
    load();
  }, [authLoading, user, load]);

  const tier = ((data?.tier) ?? 'explorer') as MemberTier;
  const cfg = TIER_CONFIG[tier] ?? TIER_CONFIG.explorer;
  const memberSince = memberSinceLabel(data?.account);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{s('rewards_card')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {authLoading || loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: SPACING.xxl }} />
        ) : !user || needsLogin ? (
          <View style={styles.gate} testID="card-signin-gate">
            <Ionicons name="lock-closed-outline" size={44} color={COLORS.textMuted} />
            <Text style={styles.gateText}>{tr('Inicia sesión para ver tu tarjeta AMO')}</Text>
            <TouchableOpacity
              style={styles.gateBtn}
              onPress={() => router.push({ pathname: '/login' as any, params: { next: '/rewards/card' } })}
              activeOpacity={0.85}
            >
              <Text style={styles.gateBtnText}>{tr('Iniciar sesión')}</Text>
            </TouchableOpacity>
          </View>
        ) : !data ? (
          <LoadError
            message={tr('No se pudo cargar')}
            retryLabel={tr('reintentar')}
            onRetry={() => { setLoading(true); load(); }}
            style={{ marginHorizontal: 0, marginTop: SPACING.xl }}
            testID="card-error"
          />
        ) : (
          <>
            {/* Flip hint */}
            <Text style={styles.flipHint}>{tr('Toca la tarjeta para voltear')}</Text>

            {/* Flip container */}
            <TouchableOpacity
              onPress={handleFlip}
              activeOpacity={0.9}
              style={styles.cardContainer}
            >
              {/* Front face */}
              <Animated.View
                style={[
                  styles.face,
                  Platform.OS === 'web'
                    ? { opacity: isFront ? 1 : 0 }
                    : { transform: [{ perspective: 1000 }, { rotateY: frontInterpolate }] },
                ]}
              >
                <CardFront
                  userName={user.name ?? 'AMO Member'}
                  userId={user.user_id}
                  tier={tier}
                  memberSince={memberSince}
                />
              </Animated.View>

              {/* Back face */}
              <Animated.View
                style={[
                  styles.face,
                  styles.faceBack,
                  Platform.OS === 'web'
                    ? { opacity: isFront ? 0 : 1 }
                    : { transform: [{ perspective: 1000 }, { rotateY: backInterpolate }] },
                ]}
              >
                <CardBack tier={tier} benefits={data?.benefits ?? []} />
              </Animated.View>
            </TouchableOpacity>

            {/* Indicator dots */}
            <View style={styles.dots}>
              <View style={[styles.dot, isFront && { backgroundColor: cfg.accent }]} />
              <View style={[styles.dot, !isFront && { backgroundColor: cfg.accent }]} />
            </View>

            {/* Points balance pill */}
            <View style={[styles.pointsPill, { borderColor: `${cfg.accent}40` }]}>
              <View style={[styles.pointsIconWrap, { backgroundColor: `${cfg.accent}20` }]}>
                <Ionicons name="ellipse" size={10} color={cfg.accent} />
              </View>
              <Text style={styles.pointsValue}>{(data?.points_balance ?? 0).toLocaleString()}</Text>
              <Text style={styles.pointsLabel}>{s('rewards_points')}</Text>
            </View>

            {/* Info rows */}
            <View style={styles.infoCard}>
              <View style={styles.infoRow}>
                <Ionicons name="shield-checkmark-outline" size={18} color={cfg.accent} />
                <View style={styles.infoText}>
                  <Text style={styles.infoLabel}>{tr('Nivel actual')}</Text>
                  <Text style={styles.infoValue}>{cfg.label}</Text>
                </View>
              </View>
              {memberSince ? (
                <>
                  <View style={styles.infoSep} />
                  <View style={styles.infoRow}>
                    <Ionicons name="calendar-outline" size={18} color={cfg.accent} />
                    <View style={styles.infoText}>
                      <Text style={styles.infoLabel}>{tr('Miembro desde')}</Text>
                      <Text style={styles.infoValue}>{memberSince}</Text>
                    </View>
                  </View>
                </>
              ) : null}
              <View style={styles.infoSep} />
              <View style={styles.infoRow}>
                <Ionicons name="qr-code-outline" size={18} color={cfg.accent} />
                <View style={styles.infoText}>
                  <Text style={styles.infoLabel}>ID de miembro</Text>
                  <Text style={styles.infoValue}>AMO-MEMBER-{user?.user_id?.slice(0, 8) ?? '—'}</Text>
                </View>
              </View>
            </View>
          </>
        )}

        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold },

  scroll: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },

  flipHint: {
    textAlign: 'center',
    fontSize: 12,
    color: COLORS.textMuted,
    ...FONTS.regular,
    marginBottom: SPACING.md,
  },

  cardContainer: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    alignSelf: 'center',
  },
  face: {
    position: 'absolute',
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backfaceVisibility: 'hidden',
  },
  faceBack: {
    backfaceVisibility: 'hidden',
  },

  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.xs,
    marginTop: SPACING.lg,
    marginBottom: SPACING.lg,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },

  pointsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    alignSelf: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm + 2,
    marginBottom: SPACING.lg,
  },
  pointsIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointsValue: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold },
  pointsLabel: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular },

  infoCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    marginBottom: SPACING.md,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  infoSep: { height: 1, backgroundColor: COLORS.border, marginLeft: SPACING.lg + 18 + SPACING.md },

  // P1-9 sign-in gate (anonymous / signed-out): no card is ever painted for these users
  gate: { alignItems: 'center', gap: SPACING.md, paddingTop: SPACING.xxl, paddingHorizontal: SPACING.lg },
  gateText: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center' },
  gateBtn: { paddingHorizontal: SPACING.lg, paddingVertical: 11, borderRadius: RADIUS.full, backgroundColor: COLORS.primary },
  gateBtnText: { fontSize: 14, color: COLORS.white, ...FONTS.bold },
  infoText: { flex: 1 },
  infoLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  infoValue: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold, marginTop: 2 },
});
