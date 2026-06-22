import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS, TIER_COLORS, Tier } from '../constants/theme';
import { getCategoryImage } from '../constants/images';
import { TierBadge } from './TierBadge';
import { SafeImage } from './SafeImage';

export type PartnerEvent = {
  event_id: string;
  partner_id: string;
  title: string;
  description: string;
  category: string;
  date: string;
  start_time: string;
  end_time: string;
  flyer_url: string;
  is_free: boolean;
  price: number;
  partner_name?: string;
  partner_tier?: string;
  partner_category?: string;
};

const CAT_ICONS: Record<string, string> = {
  gastronomy: 'restaurant',
  music: 'musical-notes',
  party: 'wine',
  wellness: 'leaf',
  art: 'color-palette',
  popup: 'bag-handle',
};

const CAT_LABELS: Record<string, string> = {
  gastronomy: 'Gastronomía',
  music: 'Música',
  party: 'Fiesta',
  wellness: 'Wellness',
  art: 'Arte & Cultura',
  popup: 'Pop-up',
};

const formatPrice = (p: number) => p === 0 ? 'GRATIS' : `$${(p / 1000).toFixed(0)}K`;

interface Props {
  event: PartnerEvent;
  onPress: () => void;
}

export const PartnerEventCard: React.FC<Props> = ({ event, onPress }) => {
  const tierColors = event.partner_tier ? TIER_COLORS[event.partner_tier as Tier] : null;
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      {/* Flyer */}
      <View style={styles.flyerWrap}>
        <SafeImage uri={event.flyer_url} category={event.category} style={styles.flyer} resizeMode="cover" />
        <View style={styles.flyerOverlay} />
        {tierColors && <View style={[styles.tierStripe, { backgroundColor: tierColors.main }]} />}
        <View style={[styles.priceTag, event.is_free ? styles.priceFree : styles.pricePaid]}>
          <Text style={styles.priceText}>{formatPrice(event.price)}</Text>
        </View>
      </View>
      {/* Info */}
      <View style={styles.body}>
        <View style={styles.timeRow}>
          <View style={styles.timePill}>
            <Ionicons name="time-outline" size={11} color={COLORS.primary} />
            <Text style={styles.timeText}>{event.start_time}</Text>
          </View>
          <View style={styles.catPill}>
            <Ionicons name={(CAT_ICONS[event.category] || 'pricetag') as any} size={11} color={COLORS.textMuted} />
            <Text style={styles.catText}>{CAT_LABELS[event.category] || event.category}</Text>
          </View>
        </View>
        <Text style={styles.title} numberOfLines={2}>{event.title}</Text>
        <View style={styles.partnerRow}>
          <Ionicons name="business-outline" size={12} color={COLORS.textMuted} />
          <Text style={styles.partnerName} numberOfLines={1}>{event.partner_name || 'Partner'}</Text>
          <TierBadge tier={event.partner_tier} size="xs" />
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    overflow: 'hidden',
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
  },
  flyerWrap: { width: 110, height: 140, position: 'relative' },
  flyer: { width: '100%', height: '100%' },
  flyerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.18)' },
  tierStripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  priceTag: { position: 'absolute', top: 6, right: 6, borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3 },
  priceFree: { backgroundColor: COLORS.success },
  pricePaid: { backgroundColor: 'rgba(5,8,20,0.85)', borderWidth: 1, borderColor: COLORS.primary },
  priceText: { fontSize: 10, color: COLORS.white, ...FONTS.bold, letterSpacing: 0.5 },

  body: { flex: 1, padding: SPACING.md, justifyContent: 'space-between' },
  timeRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  timePill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(217,119,6,0.15)', borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2 },
  timeText: { fontSize: 11, color: COLORS.primary, ...FONTS.bold },
  catPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2 },
  catText: { fontSize: 10, color: COLORS.textMuted, ...FONTS.semibold },

  title: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold, marginTop: 6, lineHeight: 18 },
  partnerRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  partnerName: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, flex: 1 },
});

export default PartnerEventCard;
