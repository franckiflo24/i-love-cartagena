import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Dimensions, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LineChart, BarChart } from 'react-native-chart-kit';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { api } from '../src/constants/api';

const screenWidth = Dimensions.get('window').width;
const chartWidth = screenWidth - 48;

type DashboardData = {
  kpis: {
    total_users: number; total_events: number; total_partners: number;
    total_interactions: number; total_seasons: number; total_passes: number;
    booking_clicks: number; total_revenue_cop: number;
    transport_views: number; map_views: number;
  };
  demographics: {
    nationalities: { country: string; count: number; percentage: number }[];
    age_groups: { group: string; count: number }[];
    genders: { gender: string; count: number }[];
    total_profiled: number;
  };
  daily_activity: { date: string; users: number; interactions: number; bookings: number; page_views: number; event_clicks: number; partner_clicks: number }[];
  hourly_activity: { hour: number; avg_interactions: number; label: string }[];
  funnel: { stage: string; count: number; color: string }[];
  revenue: { total_cop: number; by_tier: { tier: string; count: number; unit_price: number; total: number }[] };
  top_events: { event_id: string; views: number; title: string; type: string; venue: string }[];
  top_partners: { partner_id: string; clicks: number; name: string; category: string }[];
  top_venues: { venue_id: string; interactions: number; name: string; type: string }[];
  interactions_by_type: { type: string; count: number }[];
  events_per_season: { season_id: string; count: number; name: string; color: string }[];
};

const TABS = ['General', 'CRM', 'Engagement', 'Revenue'];
const TAB_ICONS: Record<string, string> = { General: 'grid', CRM: 'people', Engagement: 'pulse', Revenue: 'card' };

const TYPE_LABELS: Record<string, string> = {
  event_click: 'Eventos', season_click: 'Temporadas', partner_click: 'Partners',
  quick_access: 'Accesos rápidos', booking_click: 'Reservas', partner_section_click: 'Sección partners',
  page_view: 'Vistas', transport_view: 'Transporte', map_view: 'Mapa', search: 'Búsquedas', filter: 'Filtros',
};

const COUNTRY_FLAGS: Record<string, string> = {
  'Colombia': '🇨🇴', 'USA': '🇺🇸', 'México': '🇲🇽', 'Argentina': '🇦🇷',
  'España': '🇪🇸', 'Brasil': '🇧🇷', 'Chile': '🇨🇱', 'Perú': '🇵🇪',
  'Francia': '🇫🇷', 'Alemania': '🇩🇪', 'UK': '🇬🇧', 'Italia': '🇮🇹',
};

const PIE_COLORS = ['#D97706', '#3B82F6', '#22C55E', '#EC4899', '#8B5CF6', '#F59E0B', '#EF4444', '#06B6D4', '#84CC16', '#F97316', '#6366F1', '#14B8A6'];

const chartConfig = {
  backgroundColor: 'transparent',
  backgroundGradientFrom: COLORS.surface,
  backgroundGradientTo: COLORS.surface,
  decimalCount: 0,
  color: (opacity = 1) => `rgba(217, 119, 6, ${opacity})`,
  labelColor: () => COLORS.textMuted,
  propsForBackgroundLines: { stroke: 'rgba(255,255,255,0.05)', strokeDasharray: '' },
  propsForLabels: { fontSize: 10 },
  barPercentage: 0.6,
  useShadowColorFromDataset: false,
};

const formatCOP = (n: number) => {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n}`;
};

// ── Sub Components ──

const KPICard = ({ icon, label, value, color = COLORS.primary, subtitle }: { icon: string; label: string; value: string | number; color?: string; subtitle?: string }) => (
  <View style={styles.kpiCard}>
    <View style={[styles.kpiIcon, { backgroundColor: `${color}20` }]}>
      <Ionicons name={icon as any} size={18} color={color} />
    </View>
    <Text style={styles.kpiValue}>{value}</Text>
    <Text style={styles.kpiLabel}>{label}</Text>
    {subtitle ? <Text style={styles.kpiSub}>{subtitle}</Text> : null}
  </View>
);

const SectionHeader = ({ title, icon }: { title: string; icon: string }) => (
  <View style={styles.sectionHeader}>
    <Ionicons name={icon as any} size={18} color={COLORS.primary} />
    <Text style={styles.sectionTitle}>{title}</Text>
  </View>
);

const Card = ({ children, style }: { children: React.ReactNode; style?: any }) => (
  <View style={[styles.card, style]}>{children}</View>
);

const FunnelBar = ({ stage, count, maxCount, color }: { stage: string; count: number; maxCount: number; color: string }) => {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <View style={styles.funnelRow}>
      <View style={styles.funnelInfo}>
        <Text style={styles.funnelLabel}>{stage}</Text>
        <Text style={styles.funnelCount}>{count}</Text>
      </View>
      <View style={styles.funnelTrack}>
        <View style={[styles.funnelFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
};

const RankRow = ({ rank, title, subtitle, value, valueLabel }: { rank: number; title: string; subtitle: string; value: number; valueLabel: string }) => {
  const badgeColors = ['#F59E0B', '#94A3B8', '#B45309'];
  return (
    <View style={styles.rankRow}>
      <View style={[styles.rankBadge, rank <= 3 && { backgroundColor: badgeColors[rank - 1], borderColor: badgeColors[rank - 1] }]}>
        <Text style={[styles.rankNum, rank <= 3 && { color: '#000' }]}>{rank}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rankTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.rankMeta}>{subtitle}</Text>
      </View>
      <View style={styles.rankValueBox}>
        <Text style={styles.rankValue}>{value}</Text>
        <Text style={styles.rankValueLabel}>{valueLabel}</Text>
      </View>
    </View>
  );
};

// ── Main Dashboard ──
export default function AdminDashboard() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [usersData, setUsersData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      const [d, u] = await Promise.all([
        api.get('/analytics/dashboard'),
        api.get('/admin/users').catch(() => null),
      ]);
      setData(d);
      if (u) setUsersData(u);
    } catch (e) { console.error('Dashboard fetch error:', e); }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  if (loading || !data) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
          </TouchableOpacity>
          <View>
            <Text style={styles.title}>Dashboard</Text>
            <Text style={styles.subtitle}>Cargando datos...</Text>
          </View>
        </View>
        <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  // Prepare chart data
  const dailyLabels = data.daily_activity.map(d => d.date.slice(8));
  const dailyUsers = data.daily_activity.map(d => d.users);
  const dailyInteractions = data.daily_activity.map(d => d.interactions);
  const dailyBookings = data.daily_activity.map(d => d.bookings);
  const hourlyLabels = data.hourly_activity.filter((_, i) => i % 3 === 0).map(h => h.label);
  const hourlyValues = data.hourly_activity.map(h => h.avg_interactions);


  const maxFunnel = Math.max(...data.funnel.map(f => f.count), 1);

  // ── Tab Content Rendering ──

  const renderGeneral = () => (
    <>
      {/* KPI Grid */}
      <View style={styles.kpiGrid}>
        <KPICard icon="people" label="Usuarios" value={data.kpis.total_users} color="#3B82F6" />
        <KPICard icon="pulse" label="Interacciones" value={data.kpis.total_interactions} color="#D97706" />
        <KPICard icon="calendar" label="Eventos" value={data.kpis.total_events} color="#22C55E" />
        <KPICard icon="diamond" label="Partners" value={data.kpis.total_partners} color="#8B5CF6" />
        <KPICard icon="ticket" label="City Pass" value={data.kpis.total_passes} color="#F59E0B" />
        <KPICard icon="cash" label="Revenue" value={formatCOP(data.kpis.total_revenue_cop)} color="#22C55E" subtitle="COP" />
      </View>

      {/* Revenue Highlight */}
      <View style={styles.revenueHighlight}>
        <View style={styles.revHighlightLeft}>
          <Ionicons name="trending-up" size={28} color="#22C55E" />
          <View style={{ marginLeft: 12 }}>
            <Text style={styles.revHighlightTitle}>Impacto Económico</Text>
            <Text style={styles.revHighlightValue}>{formatCOP(data.revenue.total_cop)} COP</Text>
          </View>
        </View>
        <View style={styles.revHighlightRight}>
          <Text style={styles.revHighlightBookings}>{data.kpis.booking_clicks}</Text>
          <Text style={styles.revHighlightLabel}>reservas</Text>
        </View>
      </View>

      {/* Daily Trends */}
      <View style={styles.section}>
        <SectionHeader title="Tendencia diaria (14 días)" icon="trending-up-outline" />
        <Card>
          <LineChart
            data={{
              labels: dailyLabels.filter((_, i) => i % 2 === 0),
              datasets: [
                { data: dailyInteractions, color: () => '#D97706', strokeWidth: 2 },
                { data: dailyUsers, color: () => '#3B82F6', strokeWidth: 2 },
              ],
              legend: ['Interacciones', 'Usuarios'],
            }}
            width={chartWidth}
            height={200}
            chartConfig={{ ...chartConfig, propsForDots: { r: '3', strokeWidth: '1', stroke: COLORS.primary } }}
            bezier
            style={styles.chart}
            withInnerLines={false}
            withOuterLines={false}
          />
        </Card>
      </View>

      {/* Conversion Funnel */}
      <View style={styles.section}>
        <SectionHeader title="Embudo de conversión" icon="funnel-outline" />
        <Card>
          {data.funnel.map(f => (
            <FunnelBar key={f.stage} stage={f.stage} count={f.count} maxCount={maxFunnel} color={f.color} />
          ))}
          <View style={styles.funnelConversion}>
            <Text style={styles.funnelConvText}>
              Tasa de conversión: {data.funnel[0]?.count > 0 ? ((data.funnel[data.funnel.length - 1]?.count / data.funnel[0]?.count) * 100).toFixed(1) : 0}%
            </Text>
          </View>
        </Card>
      </View>

      {/* Interactions by Type */}
      <View style={styles.section}>
        <SectionHeader title="Interacciones por tipo" icon="bar-chart-outline" />
        <Card>
          {data.interactions_by_type.length === 0 ? (
            <Text style={styles.emptyText}>Sin datos aún</Text>
          ) : (
            data.interactions_by_type.slice(0, 8).map((item, i) => (
              <FunnelBar
                key={item.type}
                stage={TYPE_LABELS[item.type] || item.type}
                count={item.count}
                maxCount={Math.max(...data.interactions_by_type.map(x => x.count), 1)}
                color={PIE_COLORS[i % PIE_COLORS.length]}
              />
            ))
          )}
        </Card>
      </View>
    </>
  );

  const renderCRM = () => {
    const users = usersData?.users || [];
    const stats = usersData?.stats || {};
    return (
      <>
        {/* CRM KPIs */}
        <View style={styles.kpiGrid}>
          <KPICard icon="people" label="Registrados" value={usersData?.total || 0} color="#3B82F6" />
          <KPICard icon="person-circle" label="Perfiles" value={stats.with_profile || 0} color="#22C55E" />
          <KPICard icon="logo-instagram" label="Instagram" value={stats.with_instagram || 0} color="#EC4899" />
          <KPICard icon="flag" label="Países" value={stats.countries?.length || 0} color="#F59E0B" />
        </View>

        {/* Countries breakdown */}
        {stats.countries && stats.countries.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="Países de origen" icon="globe-outline" />
            <Card>
              {stats.countries.slice(0, 8).map((c: any, i: number) => (
                <View key={c.country} style={styles.countryRow}>
                  <Text style={styles.countryRank}>{i + 1}</Text>
                  <Text style={styles.countryFlag}>{COUNTRY_FLAGS[c.country] || '🏳️'}</Text>
                  <Text style={styles.countryName}>{c.country}</Text>
                  <Text style={styles.countryPct}>{c.count}</Text>
                </View>
              ))}
            </Card>
          </View>
        )}

        {/* Age Groups */}
        {stats.age_groups && stats.age_groups.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="Edades" icon="people-outline" />
            <Card>
              {stats.age_groups.map((a: any, i: number) => (
                <View key={a.group} style={styles.genderRow}>
                  <Text style={styles.genderLabel}>{a.group}</Text>
                  <View style={styles.genderTrack}>
                    <View style={[styles.genderFill, { width: `${Math.max((a.count / Math.max(usersData?.total || 1, 1)) * 100, 5)}%`, backgroundColor: PIE_COLORS[i] }]} />
                  </View>
                  <Text style={styles.genderPct}>{a.count}</Text>
                </View>
              ))}
            </Card>
          </View>
        )}

        {/* User List - CRM Table */}
        <View style={styles.section}>
          <SectionHeader title={`Usuarios registrados (${users.length})`} icon="list-outline" />
          <Card>
            {users.length === 0 ? (
              <Text style={styles.emptyText}>Cuando los usuarios se registren, sus datos aparecerán aquí.</Text>
            ) : (
              users.slice(0, 20).map((u: any, i: number) => (
                <View key={u.user_id || i} style={styles.userRow}>
                  <View style={styles.userAvatar}>
                    <Text style={styles.userAvatarText}>{(u.full_name || u.email || '?')[0].toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.userName} numberOfLines={1}>{u.full_name || 'Sin nombre'}</Text>
                    <Text style={styles.userEmail} numberOfLines={1}>{u.email}</Text>
                    <View style={styles.userTags}>
                      {u.nationality && (
                        <View style={styles.userTag}>
                          <Text style={styles.userTagText}>{COUNTRY_FLAGS[u.nationality] || '🏳️'} {u.nationality}</Text>
                        </View>
                      )}
                      {u.age_group && (
                        <View style={styles.userTag}>
                          <Text style={styles.userTagText}>{u.age_group}</Text>
                        </View>
                      )}
                      {u.instagram && (
                        <View style={[styles.userTag, { borderColor: '#EC489940' }]}>
                          <Text style={[styles.userTagText, { color: '#EC4899' }]}>@{u.instagram}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
              ))
            )}
          </Card>
        </View>

        {/* Data for Alcaldía */}
        <View style={styles.govCard}>
          <Ionicons name="shield-checkmark" size={22} color="#3B82F6" />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.govTitle}>Datos para la Alcaldía</Text>
            <Text style={styles.govDesc}>
              {usersData?.total || 0} usuarios registrados, {stats.with_profile || 0} perfiles completos, {stats.countries?.length || 0} países representados, {stats.with_instagram || 0} con Instagram.
            </Text>
          </View>
        </View>
      </>
    );
  };

  const renderEngagement = () => (
    <>
      {/* Quick Stats */}
      <View style={styles.kpiGrid}>
        <KPICard icon="eye" label="Page Views" value={data.funnel.find(f => f.stage === 'Visitas')?.count || 0} color="#3B82F6" />
        <KPICard icon="map" label="Mapa" value={data.kpis.map_views} color="#8B5CF6" />
        <KPICard icon="bus" label="Transporte" value={data.kpis.transport_views} color="#06B6D4" />
        <KPICard icon="bookmark" label="Reservas" value={data.kpis.booking_clicks} color="#22C55E" />
      </View>

      {/* Hourly Activity */}
      <View style={styles.section}>
        <SectionHeader title="Actividad por hora" icon="time-outline" />
        <Card>
          <BarChart
            data={{
              labels: hourlyLabels,
              datasets: [{ data: hourlyValues }],
            }}
            width={chartWidth}
            height={200}
            chartConfig={{ ...chartConfig, color: (opacity = 1) => `rgba(59, 130, 246, ${opacity})` }}
            style={styles.chart}
            showValuesOnTopOfBars={false}
            withInnerLines={false}
            fromZero
            yAxisLabel=""
            yAxisSuffix=""
          />
          <View style={styles.peakHourBox}>
            <Ionicons name="flame" size={16} color="#F59E0B" />
            <Text style={styles.peakHourText}>
              Hora pico: {data.hourly_activity.reduce((a, b) => a.avg_interactions > b.avg_interactions ? a : b).label}
            </Text>
          </View>
        </Card>
      </View>

      {/* Top Events */}
      <View style={styles.section}>
        <SectionHeader title="Top eventos" icon="star-outline" />
        <Card>
          {data.top_events.length === 0 ? (
            <Text style={styles.emptyText}>Los rankings aparecerán con más interacciones.</Text>
          ) : (
            data.top_events.slice(0, 8).map((e, i) => (
              <RankRow key={e.event_id} rank={i + 1} title={e.title} subtitle={`${e.venue} · ${e.type}`} value={e.views} valueLabel="views" />
            ))
          )}
        </Card>
      </View>

      {/* Top Partners */}
      <View style={styles.section}>
        <SectionHeader title="Top partners" icon="business-outline" />
        <Card>
          {data.top_partners.length === 0 ? (
            <Text style={styles.emptyText}>Los rankings aparecerán con más interacciones.</Text>
          ) : (
            data.top_partners.slice(0, 6).map((p, i) => (
              <RankRow key={p.partner_id} rank={i + 1} title={p.name} subtitle={p.category} value={p.clicks} valueLabel="clicks" />
            ))
          )}
        </Card>
      </View>

      {/* Events per Season */}
      <View style={styles.section}>
        <SectionHeader title="Eventos por temporada" icon="layers-outline" />
        <Card>
          {data.events_per_season.map(s => (
            <FunnelBar key={s.season_id} stage={s.name} count={s.count} maxCount={Math.max(...data.events_per_season.map(x => x.count), 1)} color={s.color} />
          ))}
        </Card>
      </View>
    </>
  );

  const renderRevenue = () => (
    <>
      {/* Revenue Hero */}
      <View style={styles.revenueHero}>
        <Text style={styles.revenueHeroLabel}>Ingresos totales estimados</Text>
        <Text style={styles.revenueHeroValue}>{formatCOP(data.revenue.total_cop)} COP</Text>
        <Text style={styles.revenueHeroSub}>{data.kpis.total_passes} City Pass vendidos</Text>
      </View>

      {/* Revenue by Tier */}
      <View style={styles.section}>
        <SectionHeader title="Ventas por tier" icon="layers-outline" />
        <Card>
          {data.revenue.by_tier.length === 0 ? (
            <Text style={styles.emptyText}>No hay ventas registradas</Text>
          ) : (
            data.revenue.by_tier.map((t, i) => {
              const tierColors = ['#D97706', '#EAB308', '#F59E0B'];
              return (
                <View key={t.tier} style={styles.tierRow}>
                  <View style={[styles.tierDot, { backgroundColor: tierColors[i] || COLORS.primary }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tierName}>{t.tier} Pass</Text>
                    <Text style={styles.tierPrice}>{formatCOP(t.unit_price)} c/u · {t.count} vendidos</Text>
                  </View>
                  <Text style={styles.tierTotal}>{formatCOP(t.total)}</Text>
                </View>
              );
            })
          )}
        </Card>
      </View>

      {/* Booking Trends */}
      <View style={styles.section}>
        <SectionHeader title="Tendencia de reservas" icon="trending-up-outline" />
        <Card>
          <LineChart
            data={{
              labels: dailyLabels.filter((_, i) => i % 2 === 0),
              datasets: [
                { data: dailyBookings, color: () => '#22C55E', strokeWidth: 2 },
              ],
              legend: ['Reservas diarias'],
            }}
            width={chartWidth}
            height={180}
            chartConfig={{ ...chartConfig, color: (opacity = 1) => `rgba(34, 197, 94, ${opacity})`, propsForDots: { r: '4', strokeWidth: '2', stroke: '#22C55E' } }}
            bezier
            style={styles.chart}
            withInnerLines={false}
            fromZero
          />
        </Card>
      </View>

      {/* Economic Impact */}
      <View style={styles.section}>
        <SectionHeader title="Indicadores económicos" icon="stats-chart-outline" />
        <Card>
          <View style={styles.econRow}>
            <View style={styles.econItem}>
              <Ionicons name="card" size={22} color="#D97706" />
              <Text style={styles.econValue}>{formatCOP(data.revenue.total_cop)}</Text>
              <Text style={styles.econLabel}>Revenue directo</Text>
            </View>
            <View style={styles.econItem}>
              <Ionicons name="people" size={22} color="#3B82F6" />
              <Text style={styles.econValue}>{data.kpis.total_passes > 0 ? formatCOP(Math.round(data.revenue.total_cop / data.kpis.total_passes)) : '$0'}</Text>
              <Text style={styles.econLabel}>Ticket promedio</Text>
            </View>
            <View style={styles.econItem}>
              <Ionicons name="trending-up" size={22} color="#22C55E" />
              <Text style={styles.econValue}>{data.kpis.total_interactions > 0 ? ((data.kpis.booking_clicks / data.kpis.total_interactions) * 100).toFixed(1) : 0}%</Text>
              <Text style={styles.econLabel}>Tasa conversión</Text>
            </View>
          </View>
        </Card>
      </View>

      {/* Gobierno Info */}
      <View style={styles.govCard}>
        <Ionicons name="shield-checkmark" size={22} color="#3B82F6" />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.govTitle}>Datos para la Alcaldía</Text>
          <Text style={styles.govDesc}>
            {data.demographics.total_profiled} turistas perfilados de {data.demographics.nationalities.length} países.
            Impacto económico directo: {formatCOP(data.revenue.total_cop)} COP.
          </Text>
        </View>
      </View>
    </>
  );

  const tabContent = [renderGeneral, renderCRM, renderEngagement, renderRevenue];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Back Office</Text>
          <Text style={styles.subtitle}>Música Cartagena · Analytics</Text>
        </View>
        <TouchableOpacity onPress={onRefresh} style={styles.refreshBtn}>
          <Ionicons name="refresh" size={20} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        {TABS.map((tab, i) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === i && styles.tabActive]}
            onPress={() => setActiveTab(i)}
          >
            <Ionicons name={TAB_ICONS[tab] as any} size={16} color={activeTab === i ? COLORS.primary : COLORS.textMuted} />
            <Text style={[styles.tabText, activeTab === i && styles.tabTextActive]}>{tab}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {tabContent[activeTab]()}

        {/* Footer */}
        <View style={styles.footer}>
          <Ionicons name="information-circle-outline" size={14} color={COLORS.textMuted} />
          <Text style={styles.footerText}>Datos actualizados en tiempo real · Pull to refresh</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  refreshBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold },
  subtitle: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },

  // Tabs
  tabBar: { flexDirection: 'row', paddingHorizontal: SPACING.md, marginBottom: SPACING.md, gap: SPACING.xs },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 10, borderRadius: RADIUS.md, backgroundColor: COLORS.surface },
  tabActive: { backgroundColor: `${COLORS.primary}20`, borderWidth: 1, borderColor: `${COLORS.primary}40` },
  tabText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
  tabTextActive: { color: COLORS.primary, ...FONTS.semibold },

  // KPI Grid
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: SPACING.lg, gap: SPACING.sm, marginBottom: SPACING.md },
  kpiCard: { width: '31%', backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.sm, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', gap: 2 },
  kpiIcon: { width: 32, height: 32, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  kpiValue: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold, marginTop: 2 },
  kpiLabel: { fontSize: 9, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center' },
  kpiSub: { fontSize: 8, color: COLORS.textMuted, ...FONTS.regular },

  // Revenue Highlight
  revenueHighlight: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: SPACING.lg, marginBottom: SPACING.md, backgroundColor: 'rgba(34,197,94,0.08)', borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: 'rgba(34,197,94,0.2)' },
  revHighlightLeft: { flexDirection: 'row', alignItems: 'center' },
  revHighlightTitle: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium },
  revHighlightValue: { fontSize: 18, color: '#22C55E', ...FONTS.bold },
  revHighlightRight: { alignItems: 'center' },
  revHighlightBookings: { fontSize: 22, color: COLORS.primary, ...FONTS.bold },
  revHighlightLabel: { fontSize: 10, color: COLORS.textMuted, ...FONTS.regular },

  // Section
  section: { marginBottom: SPACING.md, paddingHorizontal: SPACING.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm },
  sectionTitle: { fontSize: 15, color: COLORS.textMain, ...FONTS.bold },

  // Card
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  chart: { borderRadius: RADIUS.md, marginLeft: -12 },
  emptyText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', paddingVertical: SPACING.md },

  // Funnel
  funnelRow: { marginBottom: SPACING.sm },
  funnelInfo: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  funnelLabel: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium },
  funnelCount: { fontSize: 12, color: COLORS.textMain, ...FONTS.bold },
  funnelTrack: { height: 24, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, overflow: 'hidden' },
  funnelFill: { height: '100%', borderRadius: 12, minWidth: 8 },
  funnelConversion: { marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.border, alignItems: 'center' },
  funnelConvText: { fontSize: 13, color: COLORS.primary, ...FONTS.semibold },

  // Rank
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  rankBadge: { width: 26, height: 26, borderRadius: 13, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  rankNum: { fontSize: 11, color: COLORS.textMain, ...FONTS.bold },
  rankTitle: { fontSize: 13, color: COLORS.textMain, ...FONTS.semibold },
  rankMeta: { fontSize: 10, color: COLORS.textMuted, ...FONTS.regular },
  rankValueBox: { alignItems: 'flex-end' },
  rankValue: { fontSize: 14, color: COLORS.primary, ...FONTS.bold },
  rankValueLabel: { fontSize: 9, color: COLORS.textMuted, ...FONTS.regular },

  // Demographics
  demoHeader: { flexDirection: 'row', paddingHorizontal: SPACING.lg, gap: SPACING.sm, marginBottom: SPACING.md },
  demoHeaderCard: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, gap: 4 },
  demoHeaderValue: { fontSize: 28, color: COLORS.textMain, ...FONTS.bold },
  demoHeaderLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center' },

  // Country rows
  countryRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 6 },
  countryRank: { width: 18, fontSize: 11, color: COLORS.textMuted, ...FONTS.bold, textAlign: 'center' },
  countryFlag: { fontSize: 16 },
  countryName: { width: 70, fontSize: 12, color: COLORS.textMain, ...FONTS.medium },
  countryBarTrack: { flex: 1, height: 16, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8, overflow: 'hidden' },
  countryBarFill: { height: '100%', borderRadius: 8, minWidth: 4 },
  countryPct: { width: 40, fontSize: 11, color: COLORS.primary, ...FONTS.bold, textAlign: 'right' },

  // Donut replacement
  donutContainer: { gap: SPACING.xs },
  donutItem: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  donutBar: { height: 28, borderRadius: 14, justifyContent: 'center', paddingHorizontal: 10, minWidth: 60 },
  donutBarText: { fontSize: 11, color: '#fff', ...FONTS.semibold },
  donutPct: { fontSize: 12, color: COLORS.primary, ...FONTS.bold, width: 40, textAlign: 'right' },

  // Gender
  genderRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 6 },
  genderLabel: { width: 110, fontSize: 12, color: COLORS.textMuted, ...FONTS.medium },
  genderTrack: { flex: 1, height: 18, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 9, overflow: 'hidden' },
  genderFill: { height: '100%', borderRadius: 9, minWidth: 4 },
  genderPct: { width: 40, fontSize: 11, color: COLORS.primary, ...FONTS.bold, textAlign: 'right' },

  // Hourly peak
  peakHourBox: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SPACING.sm, justifyContent: 'center' },
  peakHourText: { fontSize: 12, color: '#F59E0B', ...FONTS.semibold },

  // Revenue
  revenueHero: { marginHorizontal: SPACING.lg, marginBottom: SPACING.md, backgroundColor: 'rgba(217,119,6,0.08)', borderRadius: RADIUS.xl, padding: SPACING.lg, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(217,119,6,0.2)' },
  revenueHeroLabel: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium },
  revenueHeroValue: { fontSize: 32, color: COLORS.primary, ...FONTS.bold, marginTop: 4 },
  revenueHeroSub: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },

  tierRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tierDot: { width: 12, height: 12, borderRadius: 6 },
  tierName: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  tierPrice: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  tierTotal: { fontSize: 15, color: COLORS.primary, ...FONTS.bold },

  econRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: SPACING.sm },
  econItem: { alignItems: 'center', gap: 4 },
  econValue: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold },
  econLabel: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center' },

  govCard: { flexDirection: 'row', alignItems: 'flex-start', marginHorizontal: SPACING.lg, marginTop: SPACING.sm, marginBottom: SPACING.md, backgroundColor: 'rgba(59,130,246,0.08)', borderRadius: RADIUS.lg, padding: SPACING.md, borderWidth: 1, borderColor: 'rgba(59,130,246,0.2)' },
  govTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  govDesc: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },

  // User CRM rows
  userRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  userAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  userAvatarText: { fontSize: 15, color: '#FFF', ...FONTS.bold },
  userName: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  userEmail: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  userTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  userTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border },
  userTagText: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium },

  // Footer
  footer: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.lg, marginTop: SPACING.md, justifyContent: 'center' },
  footerText: { fontSize: 10, color: COLORS.textMuted, ...FONTS.regular },
});
