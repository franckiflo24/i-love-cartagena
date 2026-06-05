import React, { useEffect, useRef, useState } from 'react';
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
import { api } from '@/src/constants/api';
import { useAuth } from '@/src/context/AuthContext';
import { useLang } from '@/src/context/LanguageContext';

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
  voyager:  { label: 'Voyager',  icon: 'boat',     gradient: ['#92400E', '#D97706'], accent: '#D97706' },
  elite:    { label: 'Elite',    icon: 'diamond',  gradient: ['#581C87', '#A855F7'], accent: '#A855F7' },
  legend:   { label: 'Legend',   icon: 'star',     gradient: ['#92400E', '#F59E0B'], accent: '#F59E0B' },
};

type RewardsData = {
  account: { member_since: string };
  tier: MemberTier;
  tier_label: string;
  points_balance: number;
  benefits: string[];
};

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
  memberSince: string;
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
          <Text style={frontStyles.amoSub}>Cartagena</Text>
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
          <Text style={frontStyles.memberSince}>Member since {memberSince}</Text>
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
              <Text style={backStyles.benefitText}>Acceso a beneficios exclusivos</Text>
            </View>
          )}
        </View>

        <View style={backStyles.footer}>
          <Text style={backStyles.support}>Soporte: support@amo.com.co</Text>
          <Text style={backStyles.amoText}>AMO Cartagena</Text>
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
  const router = useRouter();
  const { user } = useAuth();

  const [data, setData] = useState<RewardsData | null>(null);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    const load = async () => {
      try {
        const result = await api.get('/rewards/me');
        setData(result);
      } catch {
        // 401 or network — stub Explorer card, single call, no retry
        console.warn('[AmoCard] /rewards/me unavailable — showing defaults');
        setData({ tier: 'explorer', points_balance: 0, account: { member_since: new Date().toISOString() } } as any);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const tier = ((data?.tier) ?? 'explorer') as MemberTier;
  const cfg = TIER_CONFIG[tier] ?? TIER_CONFIG.explorer;
  let memberSince = 'junio 2026';
  try {
    memberSince = new Date(data?.account?.member_since ?? Date.now()).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  } catch { /* fallback already set */ }

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
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: SPACING.xxl }} />
        ) : (
          <>
            {/* Flip hint */}
            <Text style={styles.flipHint}>Toca la tarjeta para voltear</Text>

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
                  userName={user?.name ?? 'AMO Member'}
                  userId={user?.user_id ?? 'guest'}
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
                  <Text style={styles.infoLabel}>Nivel actual</Text>
                  <Text style={styles.infoValue}>{cfg.label}</Text>
                </View>
              </View>
              <View style={styles.infoSep} />
              <View style={styles.infoRow}>
                <Ionicons name="calendar-outline" size={18} color={cfg.accent} />
                <View style={styles.infoText}>
                  <Text style={styles.infoLabel}>Miembro desde</Text>
                  <Text style={styles.infoValue}>{memberSince}</Text>
                </View>
              </View>
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
  infoText: { flex: 1 },
  infoLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  infoValue: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold, marginTop: 2 },
});
