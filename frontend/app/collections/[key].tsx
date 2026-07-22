import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useLang } from '../../src/context/LanguageContext';
import { SafeImage } from '../../src/components/SafeImage';

import { COLLECTION_DEFS } from '../../src/constants/collections';

export default function CollectionScreen() {
  const router = useRouter();
  const { key } = useLocalSearchParams<{ key: string }>();
  const { lang } = useLang();
  const [partners, setPartners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const def = COLLECTION_DEFS[key || ''];
  const isEs = lang !== 'en';
  const title = def ? (isEs ? def.title_es : def.title_en) : '';
  const desc = def ? (isEs ? def.desc_es : def.desc_en) : '';

  useEffect(() => {
    if (!key || !def) { setLoading(false); return; }
    let alive = true;
    (async () => {
      try {
        const d = await api.get(`/collections/${key}`);
        if (alive && Array.isArray(d?.partners)) { setPartners(d.partners); setLoading(false); return; }
      } catch { /* fall through to static */ }
      try {
        const all = await fetch('/data/partners.json').then(r => r.json());
        const rows = (Array.isArray(all) ? all : [])
          .filter((p: any) => Array.isArray(p.tags) && p.tags.some((t: string) => def.tags_any.includes(t)))
          .filter((p: any) => !def.categories || def.categories.includes(p.category))
          .sort((a: any, b: any) => (b.rating || 0) - (a.rating || 0))
          .slice(0, 30);
        if (alive) setPartners(rows);
      } catch { /* keep empty */ }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [key]);

  if (!def) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><Text style={styles.emptyText}>404</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View style={styles.headerIcon}>
          <Ionicons name={def.icon as any} size={18} color="#FBBF24" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{title}</Text>
          <Text style={styles.headerDesc} numberOfLines={1}>{desc}</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={COLORS.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {partners.length === 0 ? (
            <Text style={styles.emptyText}>{isEs ? 'Pronto habrá lugares aquí' : 'Places coming soon'}</Text>
          ) : partners.map((p) => (
            <TouchableOpacity key={p.partner_id} style={styles.card} onPress={() => router.push(`/partner/${p.partner_id}` as any)} activeOpacity={0.8}>
              <SafeImage uri={p.image_url} category={p.category} style={styles.cardImage} />
              <View style={styles.cardInfo}>
                <Text style={styles.cardName} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.cardMeta} numberOfLines={1}>
                  {p.cuisine || (p.subcategory || p.category || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                </Text>
                <Text style={styles.cardSub} numberOfLines={1}>{p.address}</Text>
                {p.live_pulse?.title ? (
                  <Text style={styles.cardPulse} numberOfLines={1}>⚡ {isEs ? 'HOY' : 'TODAY'} · {p.live_pulse.title}</Text>
                ) : null}
              </View>
              {p.rating ? (
                <View style={styles.ratingPill}>
                  <Ionicons name="star" size={10} color="#FBBF24" />
                  <Text style={styles.ratingText}>{Number(p.rating).toFixed(1)}</Text>
                </View>
              ) : (
                <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  headerIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(251,191,36,0.12)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold },
  headerDesc: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular },
  list: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl },
  card: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  cardImage: { width: 52, height: 52, borderRadius: RADIUS.md, backgroundColor: COLORS.surface },
  cardInfo: { flex: 1, gap: 1 },
  cardName: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  cardMeta: { fontSize: 11, color: COLORS.primary, ...FONTS.medium, textTransform: 'capitalize' },
  cardSub: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  cardPulse: { fontSize: 11, color: '#FBBF24', ...FONTS.medium, marginTop: 2 },
  ratingPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(251,191,36,0.1)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  ratingText: { fontSize: 11, color: '#FBBF24', ...FONTS.bold },
  emptyText: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', marginTop: SPACING.xl },
});
