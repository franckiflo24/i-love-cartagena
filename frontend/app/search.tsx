import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Image, ActivityIndicator, Keyboard,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { api } from '../src/constants/api';

type Results = {
  events: any[];
  concerts: any[];
  partners: any[];
  venues: any[];
};

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults(null); setSearched(false); return; }
    setLoading(true);
    setSearched(true);
    try {
      const data = await api.get(`/search?q=${encodeURIComponent(q)}`);
      setResults(data);
    } catch (e) { console.error(e); }
    setLoading(false);
    Keyboard.dismiss();
  }, []);

  const totalResults = results ? results.events.length + results.concerts.length + results.partners.length + results.venues.length : 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Search Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={COLORS.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar artistas, venues, eventos..."
            placeholderTextColor={COLORS.textMuted}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => doSearch(query)}
            returnKeyType="search"
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => { setQuery(''); setResults(null); setSearched(false); }}>
              <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity onPress={() => doSearch(query)} style={styles.searchBtn}>
          <Ionicons name="search" size={20} color="#FFF" />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 60 }} />
        ) : !searched ? (
          /* Suggestions */
          <View style={styles.suggestions}>
            <Text style={styles.suggestTitle}>Busca lo que quieras</Text>
            {['Solomun', 'Karol G', 'Jazz', 'Templo', 'Salsa', 'Beach'].map(s => (
              <TouchableOpacity key={s} style={styles.suggestChip} onPress={() => { setQuery(s); doSearch(s); }}>
                <Ionicons name="trending-up" size={14} color={COLORS.textMuted} />
                <Text style={styles.suggestText}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : totalResults === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="search-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.emptyTitle}>Sin resultados</Text>
            <Text style={styles.emptyDesc}>No encontramos nada para "{query}"</Text>
          </View>
        ) : (
          <>
            <Text style={styles.resultCount}>{totalResults} resultado{totalResults !== 1 ? 's' : ''}</Text>

            {/* Concerts */}
            {results!.concerts.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>🎵 Conciertos ({results!.concerts.length})</Text>
                {results!.concerts.map(c => (
                  <TouchableOpacity key={c.concert_id} style={styles.resultCard} onPress={() => router.push('/concerts' as any)}>
                    <Image source={{ uri: c.image_url }} style={styles.resultImage} />
                    <View style={styles.resultInfo}>
                      <Text style={styles.resultName} numberOfLines={1}>{c.artist}</Text>
                      <Text style={styles.resultMeta}>{c.genre}</Text>
                      <Text style={styles.resultSub}>{c.venue_name} · {c.start_time}</Text>
                    </View>
                    <Text style={styles.resultPrice}>{c.is_free ? 'GRATIS' : `$${(c.price / 1000).toFixed(0)}K`}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Events */}
            {results!.events.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>📅 Eventos ({results!.events.length})</Text>
                {results!.events.map(e => (
                  <TouchableOpacity key={e.event_id} style={styles.resultCard} onPress={() => router.push(`/event/${e.event_id}`)}>
                    <Image source={{ uri: e.image_url }} style={styles.resultImage} />
                    <View style={styles.resultInfo}>
                      <Text style={styles.resultName} numberOfLines={1}>{e.title}</Text>
                      <Text style={styles.resultMeta}>{e.type}</Text>
                      <Text style={styles.resultSub}>{e.venue_name} · {e.start_time}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Partners */}
            {results!.partners.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>💎 Partners ({results!.partners.length})</Text>
                {results!.partners.map(p => (
                  <TouchableOpacity key={p.partner_id} style={styles.resultCard} onPress={() => router.push(`/partner/${p.partner_id}`)}>
                    <Image source={{ uri: p.image_url }} style={styles.resultImage} />
                    <View style={styles.resultInfo}>
                      <Text style={styles.resultName} numberOfLines={1}>{p.name}</Text>
                      <Text style={styles.resultMeta}>{p.category}</Text>
                      <Text style={styles.resultSub}>{p.address}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Venues */}
            {results!.venues.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>📍 Venues ({results!.venues.length})</Text>
                {results!.venues.map(v => (
                  <TouchableOpacity key={v.venue_id} style={styles.resultCard}>
                    <View style={[styles.resultImage, styles.venueIcon]}>
                      <Ionicons name="location" size={24} color={COLORS.primary} />
                    </View>
                    <View style={styles.resultInfo}>
                      <Text style={styles.resultName} numberOfLines={1}>{v.name}</Text>
                      <Text style={styles.resultMeta}>{v.type}</Text>
                      <Text style={styles.resultSub}>{v.address}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, paddingHorizontal: SPACING.md, borderWidth: 1, borderColor: COLORS.border, height: 44 },
  searchInput: { flex: 1, fontSize: 14, color: COLORS.textMain, ...FONTS.regular },
  searchBtn: { width: 44, height: 44, borderRadius: RADIUS.lg, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },

  suggestions: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.xl, gap: SPACING.sm },
  suggestTitle: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold, marginBottom: SPACING.sm },
  suggestChip: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  suggestText: { fontSize: 15, color: COLORS.textMuted, ...FONTS.medium },

  emptyState: { alignItems: 'center', paddingTop: 80, gap: SPACING.sm },
  emptyTitle: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold },
  emptyDesc: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular },

  resultCount: { fontSize: 13, color: COLORS.textMuted, ...FONTS.medium, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md },

  section: { paddingHorizontal: SPACING.lg, marginTop: SPACING.md },
  sectionTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold, marginBottom: SPACING.sm },

  resultCard: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  resultImage: { width: 52, height: 52, borderRadius: RADIUS.md },
  venueIcon: { backgroundColor: `${COLORS.primary}15`, alignItems: 'center', justifyContent: 'center' },
  resultInfo: { flex: 1, gap: 1 },
  resultName: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  resultMeta: { fontSize: 11, color: COLORS.primary, ...FONTS.medium, textTransform: 'capitalize' },
  resultSub: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  resultPrice: { fontSize: 12, color: COLORS.primary, ...FONTS.bold },
});
