import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Dimensions,
} from 'react-native';
import { SafeImage } from '@/src/components/SafeImage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, SPACING, RADIUS, FONTS } from '@/src/constants/theme';
import { getCategoryImage } from '@/src/constants/images';
import { api } from '@/src/constants/api';
import { useLang } from '@/src/context/LanguageContext';
import { useAuth } from '@/src/context/AuthContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HERO_HEIGHT = 300;

type Experience = {
  event_id: string;
  title: string;
  description: string;
  image_url: string;
  price_cop?: number;
  price?: number;
  currency?: string;
  category?: string;
  date?: string;
  time?: string;
  location_name?: string;
  partner_id?: string;
  partner?: {
    name: string;
    rating: number;
    reviews: number;
    rating_breakdown?: Record<string, number>;
    image_url?: string;
    phone?: string;
    whatsapp?: string;
  };
  amenities?: string[];
  is_featured?: boolean;
};

export default function ExperienceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { s } = useLang();
  const { user } = useAuth();
  const [experience, setExperience] = useState<Experience | null>(null);
  const [loading, setLoading] = useState(true);

  const loadExperience = useCallback(async () => {
    try {
      const data = await api.get(`/experiences/${id}`);
      setExperience(data);
    } catch (e) {
      console.error('[ExperienceDetail]', e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadExperience(); }, [loadExperience]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!experience) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.emptyContainer}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.textMuted} />
          <Text style={styles.emptyText}>Experience not found</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const price = experience.price_cop || experience.price || 0;
  const currency = experience.currency || 'COP';
  const rating = experience.partner?.rating || 0;
  const reviewCount = experience.partner?.reviews || 0;

  return (
    <View style={styles.container}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Hero Image */}
        <View style={styles.heroContainer}>
          <SafeImage
            uri={experience.image_url}
            category={experience.category}
            style={styles.heroImage}
          />
          <LinearGradient
            colors={['transparent', COLORS.background]}
            style={styles.heroGradient}
          />
          <SafeAreaView style={styles.heroOverlay} edges={['top']}>
            <TouchableOpacity style={styles.navButton} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={24} color={COLORS.textMain} />
            </TouchableOpacity>
          </SafeAreaView>
          {price > 0 && (
            <View style={styles.priceBadge}>
              <Text style={styles.priceText}>
                ${price.toLocaleString()} <Text style={styles.currencyText}>{currency}</Text>
              </Text>
            </View>
          )}
        </View>

        {/* Content */}
        <View style={styles.content}>
          {/* Category badge */}
          {experience.category && (
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText}>{experience.category.replace('_', ' ').toUpperCase()}</Text>
            </View>
          )}

          {/* Title */}
          <Text style={styles.title}>{experience.title}</Text>

          {/* Rating row */}
          {rating > 0 && (
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={16} color={COLORS.primary} />
              <Text style={styles.ratingText}>{(rating || 0).toFixed(1)}</Text>
              <Text style={styles.reviewCountText}>({reviewCount} reviews)</Text>
            </View>
          )}

          {/* Partner info */}
          {experience.partner && (
            <TouchableOpacity
              style={styles.partnerRow}
              onPress={() => router.push(`/partner/${experience.partner_id}` as any)}
            >
              <Ionicons name="business-outline" size={18} color={COLORS.textMuted} />
              <Text style={styles.partnerName}>{experience.partner.name}</Text>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
            </TouchableOpacity>
          )}

          {/* Date & Location */}
          <View style={styles.infoSection}>
            {experience.date && (
              <View style={styles.infoRow}>
                <Ionicons name="calendar-outline" size={18} color={COLORS.primary} />
                <Text style={styles.infoText}>{experience.date}{experience.time ? ` · ${experience.time}` : ''}</Text>
              </View>
            )}
            {experience.location_name && (
              <View style={styles.infoRow}>
                <Ionicons name="location-outline" size={18} color={COLORS.primary} />
                <Text style={styles.infoText}>{experience.location_name}</Text>
              </View>
            )}
          </View>

          {/* Description */}
          <View style={styles.descriptionSection}>
            <Text style={styles.sectionTitle}>Descripción</Text>
            <Text style={styles.descriptionText}>{experience.description}</Text>
          </View>

          {/* What's Included */}
          {experience.amenities && experience.amenities.length > 0 && (
            <View style={styles.amenitiesSection}>
              <Text style={styles.sectionTitle}>{s('experience_included') || 'What\'s Included'}</Text>
              {experience.amenities.map((a, i) => (
                <View key={i} style={styles.amenityRow}>
                  <Ionicons name="checkmark-circle" size={18} color={COLORS.success} />
                  <Text style={styles.amenityText}>{a}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Sticky Book Now bar */}
      <View style={styles.bookBar}>
        <View>
          {price > 0 && (
            <Text style={styles.bookPrice}>
              ${price.toLocaleString()} <Text style={styles.bookCurrency}>{currency}</Text>
            </Text>
          )}
          <Text style={styles.bookPerPerson}>{s('experience_guests') || 'per person'}</Text>
        </View>
        <TouchableOpacity
          style={styles.bookButton}
          onPress={() => {
            if (!user) {
              router.push('/login' as any);
              return;
            }
            router.push(`/experience/booking?id=${experience.event_id}&title=${encodeURIComponent(experience.title)}&price=${price}&currency=${currency}` as any);
          }}
        >
          <Text style={styles.bookButtonText}>{s('experience_book') || 'Book Now'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingContainer: { flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: SPACING.md },
  emptyText: { color: COLORS.textMuted, fontSize: 16, ...FONTS.medium },
  backButton: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border },
  backButtonText: { color: COLORS.textMain, ...FONTS.medium },
  heroContainer: { width: SCREEN_WIDTH, height: HERO_HEIGHT, position: 'relative' },
  heroImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  heroGradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: HERO_HEIGHT * 0.5 },
  heroOverlay: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: SPACING.md },
  navButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  priceBadge: { position: 'absolute', bottom: SPACING.md, right: SPACING.md, backgroundColor: COLORS.primary, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, borderRadius: RADIUS.md },
  priceText: { color: '#fff', fontSize: 18, ...FONTS.bold },
  currencyText: { fontSize: 12, ...FONTS.regular },
  content: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md },
  categoryBadge: { alignSelf: 'flex-start', backgroundColor: `${COLORS.primary}20`, paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: RADIUS.sm, marginBottom: SPACING.xs },
  categoryText: { color: COLORS.primary, fontSize: 11, letterSpacing: 1, ...FONTS.semibold },
  title: { color: COLORS.textMain, fontSize: 28, ...FONTS.bold, marginBottom: SPACING.sm },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: SPACING.sm },
  ratingText: { color: COLORS.textMain, fontSize: 14, ...FONTS.semibold },
  reviewCountText: { color: COLORS.textMuted, fontSize: 13 },
  partnerRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border, marginBottom: SPACING.md },
  partnerName: { color: COLORS.textMain, fontSize: 14, ...FONTS.medium, flex: 1 },
  infoSection: { gap: SPACING.sm, marginBottom: SPACING.lg },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  infoText: { color: COLORS.textMain, fontSize: 14 },
  descriptionSection: { marginBottom: SPACING.lg },
  sectionTitle: { color: COLORS.textMain, fontSize: 18, ...FONTS.bold, marginBottom: SPACING.sm },
  descriptionText: { color: COLORS.textMuted, fontSize: 14, lineHeight: 22 },
  amenitiesSection: { marginBottom: SPACING.lg },
  amenityRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 4 },
  amenityText: { color: COLORS.textMain, fontSize: 14 },
  bookBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, paddingBottom: 34 },
  bookPrice: { color: COLORS.textMain, fontSize: 20, ...FONTS.bold },
  bookCurrency: { fontSize: 13, ...FONTS.regular, color: COLORS.textMuted },
  bookPerPerson: { color: COLORS.textMuted, fontSize: 12 },
  bookButton: { backgroundColor: COLORS.primary, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md, borderRadius: RADIUS.full },
  bookButtonText: { color: '#fff', fontSize: 16, ...FONTS.bold },
});
