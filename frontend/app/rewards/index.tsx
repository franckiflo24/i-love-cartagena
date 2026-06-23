import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Dimensions,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { COLORS, SPACING, RADIUS, FONTS } from '@/src/constants/theme';
import { api } from '@/src/constants/api';
import { useLang } from '@/src/context/LanguageContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Tier configuration ───────────────────────────────────────────────────────

type MemberTier = 'explorer' | 'voyager' | 'elite' | 'legend';

const TIER_CONFIG: Record<
  MemberTier,
  { label: string; icon: keyof typeof Ionicons.glyphMap; gradient: [string, string]; accent: string; border: string }
> = {
  explorer: {
    label: 'Explorer',
    icon: 'compass',
    gradient: ['#1E3A8A', '#3B82F6'],
    accent: '#3B82F6',
    border: 'rgba(59,130,246,0.5)',
  },
  voyager: {
    label: 'Voyager',
    icon: 'boat',
    gradient: ['#92400E', '#D97706'],
    accent: '#D97706',
    border: 'rgba(217,119,6,0.5)',
  },
  elite: {
    label: 'Elite',
    icon: 'diamond',
    gradient: ['#581C87', '#A855F7'],
    accent: '#A855F7',
    border: 'rgba(168,85,247,0.5)',
  },
  legend: {
    label: 'Legend',
    icon: 'star',
    gradient: ['#92400E', '#F59E0B'],
    accent: '#F59E0B',
    border: 'rgba(245,158,11,0.5)',
  },
};

// ─── Action-type icon map ─────────────────────────────────────────────────────

const ACTION_ICONS: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  booking:       { icon: 'calendar-outline',     color: '#3B82F6' },
  review:        { icon: 'star-outline',          color: '#F59E0B' },
  referral:      { icon: 'people-outline',        color: '#22C55E' },
  profile:       { icon: 'person-outline',        color: '#A855F7' },
  redemption:    { icon: 'gift-outline',          color: '#EF4444' },
  checkin:       { icon: 'location-outline',      color: '#D97706' },
  default:       { icon: 'ellipse-outline',       color: COLORS.textMuted },
};

// ─── Types ────────────────────────────────────────────────────────────────────

type PointEvent = {
  history_id: string;
  delta: number;
  action_type: string;
  description: string;
  created_at: string;
};

type Offer = {
  offer_id: string;
  title: string;
  description: string;
  min_tier: string;
  points_cost: number;
  eligible: boolean;
};

type RewardsData = {
  account: { member_since: string };
  tier: MemberTier;
  tier_label: string;
  points_balance: number;
  lifetime_points: number;
  next_tier: string;
  points_to_next: number;
  progress_pct: number;
  benefits: string[];
  recent_history: PointEvent[];
  offers: Offer[];
  points_config: Record<string, number>;
};

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function AnimatedProgressBar({ pct, color }: { pct: number; color: string }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: Math.min(Math.max(pct / 100, 0), 1),
      duration: 900,
      useNativeDriver: false,
    }).start();
  }, [pct]);

  const width = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={progressStyles.track}>
      <Animated.View style={[progressStyles.fill, { width, backgroundColor: color }]} />
    </View>
  );
}

const progressStyles = StyleSheet.create({
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
  },
});

// ─── Offer Card ───────────────────────────────────────────────────────────────

function OfferCard({ offer, accent, onRedeem }: { offer: Offer; accent: string; onRedeem: (o: Offer) => void }) {
  const { s } = useLang();
  return (
    <View style={[offerStyles.card, { borderColor: offer.eligible ? `${accent}50` : COLORS.border }]}>
      <View style={[offerStyles.badge, { backgroundColor: `${accent}20`, borderColor: `${accent}40` }]}>
        <Text style={[offerStyles.badgeTier, { color: accent }]}>{offer.min_tier.toUpperCase()}</Text>
      </View>
      <Text style={offerStyles.title} numberOfLines={2}>{offer.title}</Text>
      <View style={offerStyles.footer}>
        <View style={offerStyles.costRow}>
          <Ionicons name="ellipse" size={8} color={accent} />
          <Text style={[offerStyles.cost, { color: accent }]}>{(offer.points_cost ?? 0).toLocaleString()}</Text>
          <Text style={offerStyles.pts}>{s('rewards_points')}</Text>
        </View>
        <TouchableOpacity
          onPress={() => onRedeem(offer)}
          disabled={!offer.eligible}
          style={[offerStyles.redeemBtn, { backgroundColor: offer.eligible ? accent : 'rgba(255,255,255,0.05)' }]}
        >
          <Text style={[offerStyles.redeemText, { color: offer.eligible ? COLORS.white : COLORS.textMuted }]}>
            {s('rewards_redeem')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const offerStyles = StyleSheet.create({
  card: {
    width: 180,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.md,
    marginRight: SPACING.md,
    gap: SPACING.sm,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: RADIUS.full,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeTier: { fontSize: 9, ...FONTS.bold, letterSpacing: 1 },
  title: { fontSize: 13, color: COLORS.textMain, ...FONTS.semibold, lineHeight: 18, flex: 1 },
  footer: { gap: SPACING.xs },
  costRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cost: { fontSize: 14, ...FONTS.bold },
  pts: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  redeemBtn: { borderRadius: RADIUS.full, paddingVertical: 7, alignItems: 'center', marginTop: 2 },
  redeemText: { fontSize: 12, ...FONTS.bold, letterSpacing: 0.4 },
});

// ─── History Row ──────────────────────────────────────────────────────────────

function HistoryRow({ event }: { event: PointEvent }) {
  const iconInfo = ACTION_ICONS[event.action_type] ?? ACTION_ICONS.default;
  const isPositive = event.delta >= 0;
  let dateStr = '';
  try { dateStr = new Date(event.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }); } catch {}

  return (
    <View style={historyStyles.row}>
      <View style={[historyStyles.iconWrap, { backgroundColor: `${iconInfo.color}18` }]}>
        <Ionicons name={iconInfo.icon} size={18} color={iconInfo.color} />
      </View>
      <View style={historyStyles.info}>
        <Text style={historyStyles.desc} numberOfLines={1}>{event.description}</Text>
        <Text style={historyStyles.date}>{dateStr}</Text>
      </View>
      <Text style={[historyStyles.delta, { color: isPositive ? COLORS.success : COLORS.error }]}>
        {isPositive ? '+' : ''}{(event.delta ?? 0).toLocaleString()}
      </Text>
    </View>
  );
}

const historyStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: SPACING.md,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  info: { flex: 1 },
  desc: { fontSize: 13, color: COLORS.textMain, ...FONTS.medium },
  date: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },
  delta: { fontSize: 15, ...FONTS.bold, flexShrink: 0 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function RewardsHub() {
  const { s } = useLang();
  const router = useRouter();
  const [data, setData] = useState<RewardsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const result = await api.get('/rewards/me');
        // Static mode returns [] — detect and use defaults instead
        if (!result || Array.isArray(result) || !result.tier) {
          throw new Error('invalid rewards data');
        }
        setData(result);
      } catch {
        // 401 or network — stub Explorer card, single call, no retry
        console.warn('[RewardsHub] /rewards/me unavailable — showing defaults');
        setData({
          tier: 'explorer',
          tier_label: 'Explorer',
          points_balance: 0,
          points_to_next: 500,
          next_tier: 'voyager',
          progress_pct: 0,
          account: { member_since: new Date().toISOString() },
          recent_history: [],
          offers: [],
        } as any);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ActivityIndicator size="large" color={COLORS.primary} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  if (!data) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.errorWrap}>
          <Ionicons name="compass" size={40} color={COLORS.primary} />
          <Text style={styles.errorText}>Cargando tu perfil de recompensas...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const tier = (data.tier ?? 'explorer') as MemberTier;
  const tierCfg = TIER_CONFIG[tier] ?? TIER_CONFIG.explorer;
  let memberSince = 'junio 2026';
  try { memberSince = new Date(data.account?.member_since ?? Date.now()).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }); } catch {}

  const handleRedeem = (offer: Offer) => {
    // Navigate to offer detail or show confirmation — placeholder for future route
    router.push(`/rewards/card`);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{s('rewards_title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* ── Tier Hero Card ── */}
        <LinearGradient
          colors={tierCfg.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.heroCard, { borderColor: tierCfg.border }]}
        >
          {/* Decorative rings */}
          <View style={[styles.ring, styles.ringOuter, { borderColor: `${tierCfg.accent}18` }]} />
          <View style={[styles.ring, styles.ringInner, { borderColor: `${tierCfg.accent}28` }]} />

          <View style={styles.heroTop}>
            <View style={[styles.tierIconWrap, { backgroundColor: 'rgba(0,0,0,0.25)' }]}>
              <Ionicons name={tierCfg.icon} size={28} color={COLORS.white} />
            </View>
            <View style={styles.heroTopText}>
              <Text style={styles.heroTierLabel}>{tierCfg.label.toUpperCase()}</Text>
              <Text style={styles.heroMemberSince}>Member since {memberSince}</Text>
            </View>
          </View>

          <View style={styles.heroBalance}>
            <Text style={styles.balanceNumber}>{(data.points_balance ?? 0).toLocaleString()}</Text>
            <Text style={styles.balancePts}>{s('rewards_points')}</Text>
          </View>

          {/* Progress */}
          {data.next_tier ? (
            <View style={styles.heroProgress}>
              <AnimatedProgressBar pct={data.progress_pct} color={COLORS.white} />
              <Text style={styles.progressLabel}>
                {(data.points_to_next ?? 0).toLocaleString()} pts{' '}
                <Text style={styles.progressLabelAccent}>→ {data.next_tier}</Text>
              </Text>
            </View>
          ) : (
            <View style={styles.heroProgress}>
              <AnimatedProgressBar pct={100} color={COLORS.white} />
              <Text style={styles.progressLabel}>Nivel maximo alcanzado</Text>
            </View>
          )}
        </LinearGradient>

        {/* ── Recent History ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{s('rewards_history')}</Text>
          {(Array.isArray(data.recent_history) ? data.recent_history : []).length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="time-outline" size={28} color={COLORS.textMuted} />
              <Text style={styles.emptyText}>Sin actividad reciente</Text>
            </View>
          ) : (
            <View style={styles.card}>
              {(Array.isArray(data.recent_history) ? data.recent_history : []).slice(0, 8).map((ev) => (
                <HistoryRow key={ev.history_id} event={ev} />
              ))}
            </View>
          )}
        </View>

        {/* ── Invite & Earn ── */}
        <View style={styles.section}>
          <View style={styles.inviteCard}>
            <View style={styles.inviteLeft}>
              <View style={styles.inviteIconWrap}>
                <Ionicons name="gift-outline" size={24} color={tierCfg.accent} />
              </View>
              <View style={styles.inviteTextCol}>
                <Text style={styles.inviteTitle}>{s('rewards_invite_title') || 'Invita y gana'}</Text>
                <Text style={styles.inviteDesc}>
                  {s('rewards_invite_desc') || 'Comparte AMO con amigos y gana 500 puntos por cada referido que se registre.'}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.inviteBtn, { backgroundColor: tierCfg.accent }]}
              activeOpacity={0.85}
              onPress={async () => {
                try {
                  await Share.share({
                    message: `Descubre Cartagena como nunca con AMO Cartagena. Restaurantes, nightlife, experiencias y más. Descárgala aquí: https://amocartagena.co/download`,
                  });
                } catch { /* user cancelled share dialog */ }
              }}
            >
              <Ionicons name="share-social-outline" size={16} color="#FFF" />
              <Text style={styles.inviteBtnText}>{s('rewards_invite_btn') || 'Invitar'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Exclusive Offers ── */}
        {(Array.isArray(data.offers) ? data.offers : []).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{s('rewards_offers')}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.offersRow}
            >
              {(Array.isArray(data.offers) ? data.offers : []).map((offer) => (
                <OfferCard
                  key={offer.offer_id}
                  offer={offer}
                  accent={tierCfg.accent}
                  onRedeem={handleRedeem}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── AMO Card CTA ── */}
        <TouchableOpacity
          style={[styles.cardCta, { borderColor: `${COLORS.primary}50` }]}
          onPress={() => router.push('/rewards/card')}
          activeOpacity={0.85}
        >
          <View style={styles.cardCtaLeft}>
            <Ionicons name="card-outline" size={22} color={COLORS.primary} />
            <Text style={styles.cardCtaText}>{s('rewards_card')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
        </TouchableOpacity>

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

  scroll: { paddingBottom: SPACING.xl },

  // Hero card
  heroCard: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    padding: SPACING.lg,
    overflow: 'hidden',
    gap: SPACING.md,
  },
  ring: { position: 'absolute', borderWidth: 1, borderRadius: 9999 },
  ringOuter: { width: 220, height: 220, top: -80, right: -60 },
  ringInner: { width: 140, height: 140, top: -40, right: -20 },

  heroTop: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  tierIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTopText: { flex: 1 },
  heroTierLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
    ...FONTS.bold,
    letterSpacing: 2,
  },
  heroMemberSince: { fontSize: 12, color: 'rgba(255,255,255,0.55)', ...FONTS.regular, marginTop: 2 },

  heroBalance: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  balanceNumber: { fontSize: 40, color: COLORS.white, ...FONTS.bold, letterSpacing: -1 },
  balancePts: { fontSize: 14, color: 'rgba(255,255,255,0.7)', ...FONTS.medium },

  heroProgress: { gap: SPACING.xs },
  progressLabel: { fontSize: 12, color: 'rgba(255,255,255,0.6)', ...FONTS.regular },
  progressLabelAccent: { color: COLORS.white, ...FONTS.semibold },

  // Sections
  section: { marginHorizontal: SPACING.lg, marginBottom: SPACING.lg },
  sectionTitle: {
    fontSize: 16,
    color: COLORS.textMain,
    ...FONTS.bold,
    marginBottom: SPACING.md,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular },

  offersRow: { paddingBottom: SPACING.xs },

  // AMO Card CTA
  cardCta: {
    marginHorizontal: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md + 2,
    marginBottom: SPACING.md,
  },
  cardCtaLeft: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  cardCtaText: { fontSize: 15, color: COLORS.textMain, ...FONTS.semibold },

  errorWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACING.md },
  errorText: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center' },

  // Invite card
  inviteCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    gap: SPACING.md,
  },
  inviteLeft: { flexDirection: 'row', gap: SPACING.md, alignItems: 'flex-start' },
  inviteIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(168,85,247,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  inviteTextCol: { flex: 1, gap: 4 },
  inviteTitle: { fontSize: 15, color: COLORS.textMain, ...FONTS.bold },
  inviteDesc: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 18 },
  inviteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    borderRadius: RADIUS.full,
    paddingVertical: 10,
  },
  inviteBtnText: { fontSize: 14, color: '#FFF', ...FONTS.bold },
});
