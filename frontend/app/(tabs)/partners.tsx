import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, Linking as RNLinking } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS, PARTNER_CATEGORY_LABELS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';

type Partner = {
  partner_id: string; name: string; description: string; category: string;
  image_url: string; address: string; booking_link: string;
  price_range: string; experience: string; is_certified: boolean;
};

const CATEGORIES = [
  { key: 'restaurant', label: 'Restaurantes', icon: 'restaurant', color: '#EF4444', image: 'https://images.unsplash.com/photo-1644621972139-cec33bf68a60?w=600&h=300&fit=crop' },
  { key: 'beach_club', label: 'Beach Club', icon: 'sunny', color: '#06B6D4', image: 'https://images.unsplash.com/photo-1546484458-6904289cd4f0?w=600&h=300&fit=crop' },
  { key: 'club', label: 'Bar & Night Clubs', icon: 'wine', color: '#8B5CF6', image: 'https://images.unsplash.com/photo-1645496761317-d4122dfc2264?w=600&h=300&fit=crop' },
  { key: 'hotel', label: 'Hoteles', icon: 'bed', color: '#3B82F6', image: 'https://images.unsplash.com/photo-1488345979593-09db0f85545f?w=600&h=300&fit=crop' },
  { key: 'shopping', label: 'Shopping', icon: 'bag-handle', color: '#EC4899', image: 'https://images.unsplash.com/photo-1777628530456-bb93d3a03faf?w=600&h=300&fit=crop' },
  { key: 'transport', label: 'Transporte', icon: 'car-sport', color: '#22C55E', image: 'https://images.unsplash.com/photo-1549317661-bd32c8ce0afe?w=600&h=300&fit=crop' },
  { key: 'tech', label: 'Tech & Wifi', icon: 'wifi', color: '#6366F1', image: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=600&h=300&fit=crop' },
  { key: 'concierge', label: 'Concierge', icon: 'diamond', color: '#F59E0B', image: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&h=300&fit=crop' },
  { key: 'charity', label: 'Fondaciones', icon: 'heart', color: '#F97316', image: 'https://images.unsplash.com/photo-1559027615-cd4628902d4a?w=600&h=300&fit=crop' },
];

export default function PartnersScreen() {
  const router = useRouter();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.get('/partners');
        setPartners(data);
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    load();
  }, []);

  const filtered = selectedCategory
    ? partners.filter(p => p.category === selectedCategory)
    : [];

  const getCategoryCount = (key: string) => partners.filter(p => p.category === key).length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        {selectedCategory ? (
          <View style={styles.headerWithBack}>
            <TouchableOpacity onPress={() => setSelectedCategory(null)} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
            </TouchableOpacity>
            <View>
              <Text style={styles.title}>{CATEGORIES.find(c => c.key === selectedCategory)?.label}</Text>
              <Text style={styles.subtitle}>{filtered.length} partner{filtered.length !== 1 ? 's' : ''} certificado{filtered.length !== 1 ? 's' : ''}</Text>
            </View>
          </View>
        ) : (
          <>
            <Text style={styles.title}>Partners</Text>
            <Text style={styles.subtitle}>Lugares certificados por Música Cartagena</Text>
          </>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : !selectedCategory ? (
          /* ── Category Grid ── */
          <View style={styles.categoryGrid}>
            {CATEGORIES.map(cat => (
              <TouchableOpacity
                key={cat.key}
                style={styles.categoryCard}
                onPress={() => setSelectedCategory(cat.key)}
                activeOpacity={0.85}
              >
                <Image source={{ uri: cat.image }} style={styles.categoryImage} />
                <View style={styles.categoryOverlay} />
                <View style={styles.categoryContent}>
                  <View style={[styles.categoryIconBadge, { backgroundColor: `${cat.color}30` }]}>
                    <Ionicons name={cat.icon as any} size={20} color={cat.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.categoryName}>{cat.label}</Text>
                    <Text style={styles.categoryCount}>{getCategoryCount(cat.key)} lugares</Text>
                  </View>
                  <View style={[styles.categoryArrowCircle, { backgroundColor: `${cat.color}25` }]}>
                    <Ionicons name="chevron-forward" size={18} color={cat.color} />
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          /* ── Partner List ── */
          <View style={styles.list}>
            {filtered.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="business-outline" size={48} color={COLORS.textMuted} />
                <Text style={styles.emptyText}>Próximamente en esta categoría</Text>
              </View>
            ) : (
              filtered.map(partner => (
                <TouchableOpacity
                  key={partner.partner_id}
                  style={styles.partnerCard}
                  onPress={() => router.push(`/partner/${partner.partner_id}`)}
                  activeOpacity={0.8}
                >
                  <Image source={{ uri: partner.image_url }} style={styles.partnerImage} />
                  <View style={styles.partnerOverlay} />

                  {partner.is_certified && (
                    <View style={styles.certifiedBadge}>
                      <Ionicons name="shield-checkmark" size={14} color={COLORS.primary} />
                      <Text style={styles.certifiedText}>CERTIFICADO</Text>
                    </View>
                  )}

                  <View style={styles.partnerContent}>
                    <Text style={styles.partnerName}>{partner.name}</Text>
                    <Text style={styles.partnerDesc} numberOfLines={2}>{partner.description}</Text>

                    <View style={styles.partnerMeta}>
                      <View style={styles.metaItem}>
                        <Ionicons name="location-outline" size={13} color={COLORS.textMuted} />
                        <Text style={styles.metaText} numberOfLines={1}>{partner.address}</Text>
                      </View>
                      <View style={styles.metaItem}>
                        <Ionicons name="cash-outline" size={13} color={COLORS.textMuted} />
                        <Text style={styles.metaText}>{partner.price_range}</Text>
                      </View>
                    </View>

                    <View style={styles.partnerActions}>
                      <TouchableOpacity
                        style={styles.detailBtn}
                        onPress={() => router.push(`/partner/${partner.partner_id}`)}
                      >
                        <Text style={styles.detailText}>Ver más</Text>
                      </TouchableOpacity>
                      {partner.booking_link ? (
                        <TouchableOpacity
                          style={styles.bookBtn}
                          onPress={() => RNLinking.openURL(partner.booking_link)}
                        >
                          <Text style={styles.bookText}>Reservar</Text>
                          <Ionicons name="arrow-forward" size={14} color={COLORS.white} />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.sm },
  headerWithBack: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 28, color: COLORS.textMain, ...FONTS.bold },
  subtitle: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },

  // Category Grid
  categoryGrid: { paddingHorizontal: SPACING.lg, gap: SPACING.sm, marginTop: SPACING.sm },
  categoryCard: { borderRadius: RADIUS.xl, overflow: 'hidden', height: 80, position: 'relative', borderWidth: 1, borderColor: COLORS.border },
  categoryImage: { width: '100%', height: '100%', position: 'absolute' },
  categoryOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(5,8,20,0.6)' },
  categoryContent: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, gap: SPACING.md },
  categoryIconBadge: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  categoryName: { fontSize: 18, color: '#FFF', ...FONTS.bold },
  categoryCount: { fontSize: 12, color: 'rgba(255,255,255,0.7)', ...FONTS.medium, marginTop: 1 },
  categoryArrowCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },

  // Empty
  emptyState: { alignItems: 'center', paddingTop: 60, gap: SPACING.md },
  emptyText: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular },

  // Partner List
  list: { paddingHorizontal: SPACING.lg },
  partnerCard: { borderRadius: RADIUS.xl, overflow: 'hidden', marginBottom: SPACING.md, borderWidth: 1, borderColor: 'rgba(217, 119, 6, 0.2)' },
  partnerImage: { width: '100%', height: 160 },
  partnerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, height: 160, backgroundColor: 'rgba(0,0,0,0.2)' },
  certifiedBadge: { position: 'absolute', top: SPACING.md, right: SPACING.md, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(5,8,20,0.85)', borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: COLORS.primary },
  certifiedText: { fontSize: 9, color: COLORS.primary, ...FONTS.bold, letterSpacing: 1 },
  partnerContent: { padding: SPACING.md, backgroundColor: COLORS.surface },
  partnerName: { fontSize: 20, color: COLORS.textMain, ...FONTS.bold },
  partnerDesc: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, marginTop: 4, lineHeight: 20 },
  partnerMeta: { marginTop: SPACING.sm, gap: 4 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, flex: 1 },
  partnerActions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
  detailBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border },
  detailText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.semibold },
  bookBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 10 },
  bookText: { fontSize: 13, color: COLORS.white, ...FONTS.semibold },
});
