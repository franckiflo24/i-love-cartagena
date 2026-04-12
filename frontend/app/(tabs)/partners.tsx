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
  { key: 'all', label: 'Todos' },
  { key: 'restaurant', label: 'Restaurantes' },
  { key: 'club', label: 'Clubs' },
  { key: 'beach_club', label: 'Beach Clubs' },
  { key: 'hotel', label: 'Hoteles' },
  { key: 'wellness', label: 'Wellness' },
];

export default function PartnersScreen() {
  const router = useRouter();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('all');

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

  const filtered = selectedCategory === 'all' ? partners : partners.filter(p => p.category === selectedCategory);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Partners</Text>
        <Text style={styles.subtitle}>Lugares certificados por CMW</Text>
      </View>

      {/* Category Filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterBar}>
        {CATEGORIES.map(c => (
          <TouchableOpacity
            key={c.key}
            testID={`partner-filter-${c.key}`}
            style={[styles.filterChip, selectedCategory === c.key && styles.filterChipActive]}
            onPress={() => setSelectedCategory(c.key)}
          >
            <Text style={[styles.filterText, selectedCategory === c.key && styles.filterTextActive]}>{c.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : (
          filtered.map(partner => (
            <TouchableOpacity
              key={partner.partner_id}
              testID={`partner-${partner.partner_id}`}
              style={styles.partnerCard}
              onPress={() => router.push(`/partner/${partner.partner_id}`)}
              activeOpacity={0.8}
            >
              <Image source={{ uri: partner.image_url }} style={styles.partnerImage} />
              <View style={styles.partnerOverlay} />

              {/* Certified Seal */}
              {partner.is_certified && (
                <View style={styles.certifiedBadge}>
                  <Ionicons name="shield-checkmark" size={14} color={COLORS.primary} />
                  <Text style={styles.certifiedText}>CERTIFICADO</Text>
                </View>
              )}

              <View style={styles.partnerContent}>
                <View style={styles.categoryBadge}>
                  <Text style={styles.categoryText}>
                    {PARTNER_CATEGORY_LABELS[partner.category] || partner.category}
                  </Text>
                </View>
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
                    testID={`partner-detail-${partner.partner_id}`}
                    style={styles.detailBtn}
                    onPress={() => router.push(`/partner/${partner.partner_id}`)}
                  >
                    <Text style={styles.detailText}>Ver más</Text>
                  </TouchableOpacity>
                  {partner.booking_link ? (
                    <TouchableOpacity
                      testID={`partner-book-${partner.partner_id}`}
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
        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.sm },
  title: { fontSize: 28, color: COLORS.textMain, ...FONTS.bold },
  subtitle: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },
  filterBar: { paddingHorizontal: SPACING.lg, gap: SPACING.sm, paddingVertical: SPACING.sm },
  filterChip: { paddingHorizontal: SPACING.md, paddingVertical: 8, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border },
  filterChipActive: { borderColor: COLORS.primary, backgroundColor: 'rgba(217, 119, 6, 0.15)' },
  filterText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium },
  filterTextActive: { color: COLORS.primary },
  list: { flex: 1, paddingHorizontal: SPACING.lg },
  partnerCard: { borderRadius: RADIUS.xl, overflow: 'hidden', marginBottom: SPACING.md, borderWidth: 1, borderColor: 'rgba(217, 119, 6, 0.2)' },
  partnerImage: { width: '100%', height: 160 },
  partnerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, height: 160, backgroundColor: 'rgba(0,0,0,0.2)' },
  certifiedBadge: { position: 'absolute', top: SPACING.md, right: SPACING.md, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(5,8,20,0.85)', borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: COLORS.primary },
  certifiedText: { fontSize: 9, color: COLORS.primary, ...FONTS.bold, letterSpacing: 1 },
  partnerContent: { padding: SPACING.md, backgroundColor: COLORS.surface },
  categoryBadge: { alignSelf: 'flex-start', backgroundColor: 'rgba(217, 119, 6, 0.15)', borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 3, marginBottom: SPACING.xs },
  categoryText: { fontSize: 10, color: COLORS.primary, ...FONTS.bold, letterSpacing: 1, textTransform: 'uppercase' },
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
