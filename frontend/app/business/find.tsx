import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { SafeImage } from '../../src/components/SafeImage';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { useBusinessAuth } from '../../src/context/BusinessAuthContext';
import { api } from '../../src/constants/api';
import { useTr } from '../../src/i18n/autoTr';

// B1B — "Find your business" is the DEFAULT path. A partner must search the
// existing catalog BEFORE they are ever allowed to create a new record — this
// is the firewall against partner-generated duplicates.
type Hit = { partner_id: string; name: string; neighborhood?: string; category?: string; image_url?: string; claim_status?: string };

export default function FindBusiness() {
  const tr = useTr();
  const router = useRouter();
  const { token, loading: authLoading } = useBusinessAuth();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async () => {
    if (!token || q.trim().length < 2) return;
    setLoading(true);
    try {
      const data = await api.get(`/business/catalog/search?q=${encodeURIComponent(q.trim())}`, { headers: { Authorization: `Bearer ${token}` } });
      setHits(data.results || []);
    } catch { setHits([]); }
    setSearched(true);
    setLoading(false);
  }, [q, token]);

  if (!authLoading && !token) { router.replace('/business/login' as any); return null; }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.hTitle}>{tr('Encuentra tu negocio')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>{tr('Busca tu negocio en el catálogo. Si ya existe, reclámalo. Solo si no está, podrás crear uno nuevo.')}</Text>

        <View style={styles.searchRow}>
          <View style={styles.inputWrap}>
            <Ionicons name="search" size={18} color={COLORS.textMuted} />
            <TextInput
              style={styles.input}
              value={q}
              onChangeText={setQ}
              onSubmitEditing={search}
              returnKeyType="search"
              placeholder={tr('Nombre de tu negocio')}
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="words"
            />
          </View>
          <TouchableOpacity style={styles.searchBtn} onPress={search}>
            <Ionicons name="arrow-forward" size={18} color={COLORS.white} />
          </TouchableOpacity>
        </View>

        {loading && <ActivityIndicator color={COLORS.primary} style={{ marginTop: SPACING.xl }} />}

        {!loading && hits.map(h => {
          const claimed = h.claim_status === 'verified_owner';
          return (
            <TouchableOpacity
              key={h.partner_id}
              style={styles.card}
              activeOpacity={0.85}
              disabled={claimed}
              onPress={() => router.push(`/business/claim/${h.partner_id}` as any)}
            >
              {h.image_url ? <SafeImage uri={h.image_url} style={styles.thumb} /> : <View style={[styles.thumb, styles.thumbEmpty]}><Ionicons name="business" size={20} color={COLORS.textMuted} /></View>}
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName} numberOfLines={1}>{h.name}</Text>
                <Text style={styles.cardMeta} numberOfLines={1}>{[h.category, h.neighborhood].filter(Boolean).join(' · ')}</Text>
              </View>
              {claimed ? (
                <View style={styles.claimedTag}><Ionicons name="lock-closed" size={11} color={COLORS.textMuted} /><Text style={styles.claimedTagText}>{tr('Reclamado')}</Text></View>
              ) : (
                <View style={styles.claimTag}><Text style={styles.claimTagText}>{tr('Reclamar')}</Text><Ionicons name="chevron-forward" size={14} color={COLORS.primary} /></View>
              )}
            </TouchableOpacity>
          );
        })}

        {searched && !loading && (
          <View style={styles.noneBox}>
            <Text style={styles.noneText}>
              {hits.length === 0 ? tr('No encontramos tu negocio en el catálogo.') : tr('¿No es ninguno de estos?')}
            </Text>
            <TouchableOpacity style={styles.createBtn} onPress={() => router.push({ pathname: '/business/create-venue', params: { name: q.trim() } } as any)}>
              <Ionicons name="add-circle-outline" size={18} color={COLORS.primary} />
              <Text style={styles.createBtnText}>{tr('Crear un negocio nuevo')}</Text>
            </TouchableOpacity>
            <Text style={styles.noneHint}>{tr('Los negocios nuevos pasan por revisión del equipo antes de aparecer.')}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: SPACING.sm },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  hTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold },
  scroll: { padding: SPACING.lg },
  intro: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 20, marginBottom: SPACING.md },
  searchRow: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center' },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: SPACING.md, height: 50 },
  input: { flex: 1, color: COLORS.textMain, fontSize: 14, ...FONTS.regular },
  searchBtn: { width: 50, height: 50, borderRadius: RADIUS.lg, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, marginTop: SPACING.md },
  thumb: { width: 46, height: 46, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceAlt },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  cardName: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  cardMeta: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },
  claimTag: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  claimTagText: { color: COLORS.primary, fontSize: 12, ...FONTS.bold },
  claimedTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.surfaceAlt, paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.full },
  claimedTagText: { color: COLORS.textMuted, fontSize: 11, ...FONTS.semibold },
  noneBox: { marginTop: SPACING.xl, padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' },
  noneText: { fontSize: 13, color: COLORS.textMain, ...FONTS.semibold, textAlign: 'center' },
  createBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: SPACING.md, paddingVertical: 12, paddingHorizontal: SPACING.lg, borderRadius: RADIUS.full, borderWidth: 1.5, borderColor: COLORS.primary },
  createBtnText: { color: COLORS.primary, fontSize: 13, ...FONTS.bold },
  noneHint: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', marginTop: SPACING.sm },
});
