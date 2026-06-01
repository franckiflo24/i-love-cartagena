import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '@/src/constants/theme';
import { api } from '@/src/constants/api';
import { useLang } from '@/src/context/LanguageContext';

type Offer = {
  offer_id: string;
  title: string;
  description: string;
  min_tier: string;
  points_cost: number;
  value_cop: number;
  eligible: boolean;
  available: boolean;
  image_url?: string;
};

const TIER_COLORS_MAP: Record<string, string> = {
  explorer: '#3B82F6',
  voyager: '#D97706',
  elite: '#A855F7',
  legend: '#F59E0B',
};

export default function OffersScreen() {
  const router = useRouter();
  const { s } = useLang();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [redeeming, setRedeeming] = useState<string | null>(null);

  const loadOffers = useCallback(async () => {
    try {
      const data = await api.get('/rewards/offers');
      setOffers(data.offers || []);
    } catch (e) {
      console.error('[Offers]', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadOffers(); }, [loadOffers]);

  const handleRedeem = async (offer: Offer) => {
    if (!offer.eligible) {
      Alert.alert('', `Requires ${offer.min_tier} tier or higher`);
      return;
    }
    Alert.alert(
      'Redeem Offer',
      `Spend ${offer.points_cost} points for "${offer.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Redeem',
          onPress: async () => {
            setRedeeming(offer.offer_id);
            try {
              await api.post('/rewards/redeem', { offer_id: offer.offer_id });
              Alert.alert('Redeemed!', 'Check your rewards for the redemption QR code.');
              loadOffers();
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Failed to redeem');
            } finally {
              setRedeeming(null);
            }
          },
        },
      ],
    );
  };

  const renderOffer = ({ item }: { item: Offer }) => (
    <View style={[styles.card, !item.eligible && styles.cardLocked]}>
      <View style={styles.cardHeader}>
        <View style={[styles.tierBadge, { backgroundColor: `${TIER_COLORS_MAP[item.min_tier] || COLORS.textMuted}20` }]}>
          <Text style={[styles.tierText, { color: TIER_COLORS_MAP[item.min_tier] || COLORS.textMuted }]}>
            {item.min_tier.toUpperCase()}
          </Text>
        </View>
        <Text style={styles.costText}>{item.points_cost} pts</Text>
      </View>
      <Text style={styles.offerTitle}>{item.title}</Text>
      <Text style={styles.offerDesc}>{item.description}</Text>
      {item.value_cop > 0 && (
        <Text style={styles.valueText}>Value: ${item.value_cop.toLocaleString()} COP</Text>
      )}
      <TouchableOpacity
        style={[styles.redeemButton, !item.eligible && styles.redeemDisabled]}
        onPress={() => handleRedeem(item)}
        disabled={!item.eligible || !item.available || redeeming === item.offer_id}
      >
        {redeeming === item.offer_id ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.redeemText}>
            {!item.eligible ? 'Locked' : !item.available ? 'Sold Out' : s('rewards_redeem') || 'Redeem'}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{s('rewards_offers') || 'Exclusive Offers'}</Text>
        <View style={{ width: 24 }} />
      </View>
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={offers}
          keyExtractor={(item) => item.offer_id}
          renderItem={renderOffer}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="gift-outline" size={48} color={COLORS.textMuted} />
              <Text style={styles.emptyText}>No offers available</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  headerTitle: { color: COLORS.textMain, fontSize: 18, ...FONTS.bold },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: SPACING.md },
  row: { gap: SPACING.sm },
  card: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, marginBottom: SPACING.sm },
  cardLocked: { opacity: 0.6 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
  tierBadge: { paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: RADIUS.full },
  tierText: { fontSize: 10, letterSpacing: 1, ...FONTS.bold },
  costText: { color: COLORS.primary, fontSize: 13, ...FONTS.bold },
  offerTitle: { color: COLORS.textMain, fontSize: 15, ...FONTS.bold, marginBottom: 4 },
  offerDesc: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17, marginBottom: SPACING.sm },
  valueText: { color: COLORS.textMuted, fontSize: 11, marginBottom: SPACING.sm },
  redeemButton: { backgroundColor: COLORS.primary, paddingVertical: SPACING.sm, borderRadius: RADIUS.full, alignItems: 'center' },
  redeemDisabled: { backgroundColor: COLORS.border },
  redeemText: { color: '#fff', fontSize: 13, ...FONTS.bold },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 100, gap: SPACING.md },
  emptyText: { color: COLORS.textMuted, fontSize: 16 },
});
