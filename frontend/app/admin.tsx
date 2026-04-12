import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { api } from '../src/constants/api';

type Summary = {
  total_users: number; total_events: number; total_partners: number;
  total_interactions: number; total_seasons: number; total_passes: number;
  booking_clicks: number;
  top_events: { event_id: string; views: number; title: string; type: string; venue: string }[];
  top_partners: { partner_id: string; clicks: number; name: string; category: string }[];
  interactions_by_type: { type: string; count: number }[];
  events_per_season: { season_id: string; count: number; name: string; color: string }[];
};

const TYPE_LABELS: Record<string, string> = {
  event_click: 'Clicks en eventos',
  season_click: 'Clicks en temporadas',
  partner_click: 'Clicks en partners',
  quick_access: 'Accesos rápidos',
  booking_click: 'Clicks en reservas',
  partner_section_click: 'Sección partners',
  page_view: 'Vistas de página',
};

const StatCard = ({ icon, label, value, color = COLORS.primary }: { icon: string; label: string; value: number | string; color?: string }) => (
  <View style={styles.statCard}>
    <View style={[styles.statIcon, { backgroundColor: `${color}20` }]}>
      <Ionicons name={icon as any} size={20} color={color} />
    </View>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const BarChart = ({ data, maxVal }: { data: { label: string; value: number; color: string }[]; maxVal: number }) => (
  <View style={styles.barChart}>
    {data.map((item, i) => (
      <View key={i} style={styles.barRow}>
        <Text style={styles.barLabel} numberOfLines={1}>{item.label}</Text>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${maxVal > 0 ? (item.value / maxVal) * 100 : 0}%`, backgroundColor: item.color }]} />
        </View>
        <Text style={styles.barValue}>{item.value}</Text>
      </View>
    ))}
  </View>
);

export default function AdminDashboard() {
  const router = useRouter();
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      const d = await api.get('/analytics/summary');
      setData(d);
    } catch (e) { console.error(e); }
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { fetchData(); }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity testID="admin-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Dashboard</Text>
          <Text style={styles.subtitle}>Analytics & Data</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={COLORS.primary} />}
      >
        {loading || !data ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 60 }} />
        ) : (
          <>
            {/* KPI Grid */}
            <View style={styles.kpiGrid}>
              <StatCard icon="people" label="Usuarios" value={data.total_users} color="#3B82F6" />
              <StatCard icon="pulse" label="Interacciones" value={data.total_interactions} color="#D97706" />
              <StatCard icon="calendar" label="Eventos" value={data.total_events} color="#22C55E" />
              <StatCard icon="diamond" label="Partners" value={data.total_partners} color="#8B5CF6" />
              <StatCard icon="layers" label="Temporadas" value={data.total_seasons} color="#EC4899" />
              <StatCard icon="ticket" label="City Pass" value={data.total_passes} color="#F59E0B" />
            </View>

            {/* Revenue Indicator */}
            <View style={styles.revenueCard}>
              <Ionicons name="trending-up" size={24} color="#22C55E" />
              <View style={{ flex: 1 }}>
                <Text style={styles.revenueTitle}>Potencial de conversión</Text>
                <Text style={styles.revenueDesc}>{data.booking_clicks} clicks en reservas registrados</Text>
              </View>
            </View>

            {/* Interactions by Type */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Interacciones por tipo</Text>
              <View style={styles.card}>
                {data.interactions_by_type.length === 0 ? (
                  <Text style={styles.emptyText}>Sin datos aún. Las interacciones se registran en tiempo real.</Text>
                ) : (
                  <BarChart
                    data={data.interactions_by_type.map(i => ({
                      label: TYPE_LABELS[i.type] || i.type,
                      value: i.count,
                      color: COLORS.primary,
                    }))}
                    maxVal={Math.max(...data.interactions_by_type.map(i => i.count), 1)}
                  />
                )}
              </View>
            </View>

            {/* Events per Season */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Eventos por temporada</Text>
              <View style={styles.card}>
                {data.events_per_season.length === 0 ? (
                  <Text style={styles.emptyText}>Sin datos</Text>
                ) : (
                  <BarChart
                    data={data.events_per_season.map(s => ({
                      label: s.name,
                      value: s.count,
                      color: s.color,
                    }))}
                    maxVal={Math.max(...data.events_per_season.map(s => s.count), 1)}
                  />
                )}
              </View>
            </View>

            {/* Top Events */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Top eventos</Text>
              <View style={styles.card}>
                {data.top_events.length === 0 ? (
                  <Text style={styles.emptyText}>Los rankings aparecerán cuando los usuarios interactúen con los eventos.</Text>
                ) : (
                  data.top_events.map((e, i) => (
                    <View key={e.event_id} style={styles.rankRow}>
                      <View style={[styles.rankBadge, i === 0 && { backgroundColor: '#F59E0B' }, i === 1 && { backgroundColor: '#94A3B8' }, i === 2 && { backgroundColor: '#B45309' }]}>
                        <Text style={styles.rankNum}>{i + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rankTitle}>{e.title}</Text>
                        <Text style={styles.rankMeta}>{e.venue} · {e.type}</Text>
                      </View>
                      <Text style={styles.rankValue}>{e.views} views</Text>
                    </View>
                  ))
                )}
              </View>
            </View>

            {/* Top Partners */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Top partners</Text>
              <View style={styles.card}>
                {data.top_partners.length === 0 ? (
                  <Text style={styles.emptyText}>Los rankings de partners aparecerán con más interacciones.</Text>
                ) : (
                  data.top_partners.map((p, i) => (
                    <View key={p.partner_id} style={styles.rankRow}>
                      <View style={[styles.rankBadge, i === 0 && { backgroundColor: '#F59E0B' }]}>
                        <Text style={styles.rankNum}>{i + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rankTitle}>{p.name}</Text>
                        <Text style={styles.rankMeta}>{p.category}</Text>
                      </View>
                      <Text style={styles.rankValue}>{p.clicks} clicks</Text>
                    </View>
                  ))
                )}
              </View>
            </View>

            {/* Info Footer */}
            <View style={styles.infoFooter}>
              <Ionicons name="information-circle-outline" size={16} color={COLORS.textMuted} />
              <Text style={styles.infoText}>Los datos se actualizan en tiempo real. Pull-to-refresh para actualizar.</Text>
            </View>

            <View style={{ height: SPACING.xxl }} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, color: COLORS.textMain, ...FONTS.bold },
  subtitle: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: SPACING.lg, gap: SPACING.sm, marginBottom: SPACING.lg },
  statCard: { width: '31%', backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', gap: 4 },
  statIcon: { width: 36, height: 36, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold },
  statLabel: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center' },
  revenueCard: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginHorizontal: SPACING.lg, marginBottom: SPACING.lg, backgroundColor: 'rgba(34,197,94,0.1)', borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: 'rgba(34,197,94,0.2)' },
  revenueTitle: { fontSize: 15, color: COLORS.textMain, ...FONTS.semibold },
  revenueDesc: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular },
  section: { marginBottom: SPACING.lg, paddingHorizontal: SPACING.lg },
  sectionTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold, marginBottom: SPACING.sm },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  emptyText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', paddingVertical: SPACING.md },
  barChart: { gap: SPACING.sm },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  barLabel: { width: 100, fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
  barTrack: { flex: 1, height: 20, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 10, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 10, minWidth: 4 },
  barValue: { width: 35, fontSize: 12, color: COLORS.textMain, ...FONTS.bold, textAlign: 'right' },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  rankBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  rankNum: { fontSize: 12, color: COLORS.textMain, ...FONTS.bold },
  rankTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  rankMeta: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  rankValue: { fontSize: 13, color: COLORS.primary, ...FONTS.bold },
  infoFooter: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.lg, marginTop: SPACING.md },
  infoText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, flex: 1 },
});
