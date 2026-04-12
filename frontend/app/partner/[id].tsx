import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, Linking as RNLinking } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS, PARTNER_CATEGORY_LABELS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';

export default function PartnerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [partner, setPartner] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.get(`/partners/${id}`);
        setPartner(data);
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    load();
  }, [id]);

  if (loading) {
    return <SafeAreaView style={styles.container}><ActivityIndicator size="large" color={COLORS.primary} style={{ flex: 1 }} /></SafeAreaView>;
  }

  if (!partner) {
    return <SafeAreaView style={styles.container}><View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: COLORS.textMuted }}>Partner no encontrado</Text></View></SafeAreaView>;
  }

  const openMaps = () => {
    if (!partner?.location) return;
    RNLinking.openURL(`https://www.google.com/maps/search/?api=1&query=${partner.location.lat},${partner.location.lng}`);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Image source={{ uri: partner.image_url }} style={styles.heroImage} />
          <View style={styles.heroOverlay} />
          <TouchableOpacity testID="partner-back-btn" style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
          </TouchableOpacity>
          {partner.is_certified && (
            <View style={styles.sealBadge}>
              <Ionicons name="shield-checkmark" size={16} color={COLORS.primary} />
              <Text style={styles.sealText}>PARTNER CERTIFICADO</Text>
            </View>
          )}
          <View style={styles.heroBottom}>
            <View style={styles.catBadge}>
              <Text style={styles.catText}>{PARTNER_CATEGORY_LABELS[partner.category] || partner.category}</Text>
            </View>
            <Text style={styles.heroTitle}>{partner.name}</Text>
          </View>
        </View>

        <View style={styles.body}>
          <Text style={styles.description}>{partner.description}</Text>

          <View style={styles.infoGrid}>
            <View style={styles.infoCard}>
              <Ionicons name="location-outline" size={20} color={COLORS.primary} />
              <Text style={styles.infoLabel}>Ubicación</Text>
              <Text style={styles.infoValue}>{partner.address}</Text>
            </View>
            <View style={styles.infoCard}>
              <Ionicons name="cash-outline" size={20} color={COLORS.primary} />
              <Text style={styles.infoLabel}>Rango de precio</Text>
              <Text style={styles.infoValue}>{partner.price_range}</Text>
            </View>
          </View>

          <View style={styles.expSection}>
            <Text style={styles.sectionTitle}>Experiencia</Text>
            <Text style={styles.expText}>{partner.experience}</Text>
          </View>
        </View>
        <View style={{ height: 100 }} />
      </ScrollView>

      <View style={styles.bottomBar}>
        <TouchableOpacity testID="partner-directions-btn" style={styles.dirBtn} onPress={openMaps}>
          <Ionicons name="navigate" size={18} color={COLORS.primary} />
          <Text style={styles.dirText}>Cómo llegar</Text>
        </TouchableOpacity>
        {partner.booking_link ? (
          <TouchableOpacity testID="partner-reserve-btn" style={styles.bookBtn} onPress={() => RNLinking.openURL(partner.booking_link)}>
            <Text style={styles.bookText}>Reservar</Text>
            <Ionicons name="arrow-forward" size={16} color={COLORS.white} />
          </TouchableOpacity>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  hero: { height: 280, position: 'relative' },
  heroImage: { width: '100%', height: '100%' },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,8,20,0.4)' },
  backBtn: { position: 'absolute', top: SPACING.md, left: SPACING.md, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(5,8,20,0.6)', alignItems: 'center', justifyContent: 'center' },
  sealBadge: { position: 'absolute', top: SPACING.md, right: SPACING.md, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(5,8,20,0.85)', borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: COLORS.primary },
  sealText: { fontSize: 10, color: COLORS.primary, ...FONTS.bold, letterSpacing: 1 },
  heroBottom: { position: 'absolute', bottom: SPACING.lg, left: SPACING.lg },
  catBadge: { alignSelf: 'flex-start', backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 4 },
  catText: { fontSize: 10, color: COLORS.white, ...FONTS.bold, letterSpacing: 1, textTransform: 'uppercase' },
  heroTitle: { fontSize: 28, color: COLORS.textMain, ...FONTS.bold, marginTop: SPACING.sm },
  body: { padding: SPACING.lg },
  description: { fontSize: 15, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 24 },
  infoGrid: { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.lg },
  infoCard: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md, gap: SPACING.xs, borderWidth: 1, borderColor: COLORS.border },
  infoLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  infoValue: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  expSection: { marginTop: SPACING.lg },
  sectionTitle: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold, marginBottom: SPACING.sm },
  expText: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 22 },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', padding: SPACING.lg, gap: SPACING.md, backgroundColor: COLORS.background, borderTopWidth: 1, borderTopColor: COLORS.border },
  dirBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.primary, paddingVertical: 14 },
  dirText: { fontSize: 14, color: COLORS.primary, ...FONTS.semibold },
  bookBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 14 },
  bookText: { fontSize: 14, color: COLORS.white, ...FONTS.semibold },
});
