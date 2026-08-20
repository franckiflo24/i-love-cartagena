import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Dimensions, Platform,
  TextInput, KeyboardAvoidingView,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LineChart, BarChart } from 'react-native-chart-kit';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SPACING, RADIUS, FONTS, colorForKey } from '../src/constants/theme';
import { api } from '../src/constants/api';
import { useTr } from '../src/i18n/autoTr';
import { useAuth } from '../src/context/AuthContext';

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

type ModStats = { pending: number; unread_notifications: number; auto_corrected_categories: number };

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

const PIE_COLORS = ['#12B5A5', '#3B82F6', '#22C55E', '#EC4899', '#8B5CF6', '#F59E0B', '#EF4444', '#06B6D4', '#84CC16', '#F97316', '#6366F1', '#14B8A6'];

const chartConfig = {
  backgroundColor: 'transparent',
  backgroundGradientFrom: COLORS.surface,
  backgroundGradientTo: COLORS.surface,
  decimalCount: 0,
  color: (opacity = 1) => `rgba(18,181,165, ${opacity})`,
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

// ── Portal hub card ──
type HubCardDef = {
  key: string;
  title: string;
  subtitle: string;
  lockReason: string;
  icon: string;
  accent: string;
  available: boolean;
  badge?: number;
  onPress: () => void;
  // Locked cards must never dead-end: tapping one routes to the unlock path
  // (e.g. admin sign-in). Franck hit locked cards with no way forward.
  onLockedPress?: () => void;
};

const PortalCard = ({ card }: { card: HubCardDef }) => (
  <TouchableOpacity
    style={[styles.hubCard, !card.available && styles.hubCardLocked]}
    onPress={card.available ? card.onPress : card.onLockedPress}
    disabled={!card.available && !card.onLockedPress}
    activeOpacity={0.85}
  >
    <View style={[styles.hubCardIconWrap, { backgroundColor: `${card.accent}20`, borderColor: `${card.accent}40` }]}>
      <Ionicons name={(card.available ? card.icon : 'lock-closed') as any} size={20} color={card.available ? card.accent : COLORS.textFaint} />
      {card.available && !!card.badge && (
        <View style={styles.hubCardBadge}>
          <Text style={styles.hubCardBadgeText}>{card.badge > 99 ? '99+' : card.badge}</Text>
        </View>
      )}
    </View>
    <Text style={[styles.hubCardTitle, !card.available && styles.hubCardTitleLocked]} numberOfLines={1}>{card.title}</Text>
    <Text style={[styles.hubCardSubtitle, !card.available && styles.hubCardSubtitleLocked]} numberOfLines={2}>
      {card.available ? card.subtitle : card.lockReason}
    </Text>
    {card.available
      ? <Ionicons name="chevron-forward" size={14} color={COLORS.textFaint} style={styles.hubCardChevron} />
      : card.onLockedPress
        ? <Ionicons name="log-in-outline" size={14} color={COLORS.official} style={styles.hubCardChevron} />
        : null}
  </TouchableOpacity>
);

// ── Dashboard body (the original analytics dashboard — unchanged content,
// only relocated behind the "Usuarios & Analytics" hub card). Only ever
// mounted when isAdmin, and only once `data` has resolved. ──
function DashboardBody({ data, usersData }: { data: DashboardData; usersData: any }) {
  const tr = useTr();
  const [activeTab, setActiveTab] = useState(0);

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
        <KPICard icon="pulse" label="Interacciones" value={data.kpis.total_interactions} color="#12B5A5" />
        <KPICard icon="calendar" label={tr('Eventos')} value={data.kpis.total_events} color="#22C55E" />
        <KPICard icon="diamond" label={tr('Partners')} value={data.kpis.total_partners} color="#8B5CF6" />
        <KPICard icon="ticket" label={tr('City Pass')} value={data.kpis.total_passes} color="#F59E0B" />
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
                { data: dailyInteractions, color: () => '#12B5A5', strokeWidth: 2 },
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
        <KPICard icon="map" label={tr('Mapa')} value={data.kpis.map_views} color="#8B5CF6" />
        <KPICard icon="bus" label={tr('Transporte')} value={data.kpis.transport_views} color="#06B6D4" />
        <KPICard icon="bookmark" label={tr('Reservas')} value={data.kpis.booking_clicks} color="#22C55E" />
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
              const tierColors = ['#12B5A5', '#EAB308', '#F59E0B'];
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
              <Ionicons name="card" size={22} color="#12B5A5" />
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
    <>
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
      {tabContent[activeTab]()}
    </>
  );
}

// ── Main Portal Shell ──
export default function AdminPortal() {
  const tr = useTr();
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();

  const isAdmin = !!user?.is_admin;

  // ── Operator-token capability: state + effect, re-checked on focus so a
  // login (or logout) that happened on another screen is picked up here. ──
  const [isOperator, setIsOperator] = useState(false);
  const [operatorChecked, setOperatorChecked] = useState(false);

  const checkOperatorToken = useCallback(async () => {
    const tok = await AsyncStorage.getItem('admin_operator_token');
    setIsOperator(!!tok);
    setOperatorChecked(true);
  }, []);

  useEffect(() => { checkOperatorToken(); }, [checkOperatorToken]);
  useFocusEffect(useCallback(() => { checkOperatorToken(); }, [checkOperatorToken]));

  // ── Embedded operator-password login (the gate screen's primary path) ──
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [gateLoading, setGateLoading] = useState(false);
  const [gateError, setGateError] = useState('');

  const onOperatorLogin = useCallback(async () => {
    if (!password) return;
    setGateLoading(true);
    setGateError('');
    try {
      const res = await api.post('/admin/operator/login', { password });
      if (!res?.token) throw new Error('Sin token');
      await AsyncStorage.setItem('admin_operator_token', res.token);
      setIsOperator(true);
      setPassword('');
    } catch {
      setGateError(tr('Contraseña incorrecta'));
    }
    setGateLoading(false);
  }, [password, tr]);

  const onOperatorLogout = useCallback(async () => {
    await AsyncStorage.removeItem('admin_operator_token');
    setIsOperator(false);
  }, []);

  // ── Dashboard data — is_admin-gated endpoints. Guarded so operators never
  // trigger a 401 against them (they carry no user session). ──
  const [data, setData] = useState<DashboardData | null>(null);
  const [modStats, setModStats] = useState<ModStats | null>(null);
  const [usersData, setUsersData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showDashboard, setShowDashboard] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [d, u, ms] = await Promise.all([
        api.get('/analytics/dashboard'),
        api.get('/admin/users').catch(() => null),
        api.get('/admin/moderation/stats').catch(() => null),
      ]);
      setData(d);
      if (u) setUsersData(u);
      if (ms) setModStats(ms);
    } catch (e) { console.error('Dashboard fetch error:', e); }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    if (isAdmin) fetchData();
    else setLoading(false);
  }, [isAdmin, fetchData]);

  const onRefresh = useCallback(() => {
    if (!isAdmin) return;
    setRefreshing(true);
    fetchData();
  }, [isAdmin, fetchData]);

  // ── Resolving auth + operator-token state ──
  if (authLoading || !operatorChecked) {
    return <View style={styles.container}><ActivityIndicator color={COLORS.primary} /></View>;
  }

  // ── Neither principal → single beautiful login screen (never redirect away) ──
  if (!isAdmin && !isOperator) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.gateScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.gateWordmark}>
              <Text style={styles.gateLogo}>AMO</Text>
              <Text style={styles.gateLogoSub}>CARTAGENA</Text>
              <View style={styles.gateDivider} />
              <Text style={styles.gateTitle}>{tr('Portal de administración')}</Text>
            </View>

            <View style={styles.gateCard}>
              <View style={styles.gateInputRow}>
                <Ionicons name="lock-closed" size={18} color={COLORS.textMuted} />
                <TextInput
                  testID="portal-operator-password"
                  style={styles.gateInput}
                  value={password}
                  onChangeText={(t) => { setPassword(t); if (gateError) setGateError(''); }}
                  placeholder={tr('Contraseña')}
                  placeholderTextColor={COLORS.textMuted}
                  secureTextEntry={!showPw}
                  autoCapitalize="none"
                  autoComplete="password"
                  onSubmitEditing={onOperatorLogin}
                  returnKeyType="go"
                />
                <TouchableOpacity onPress={() => setShowPw(!showPw)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name={showPw ? 'eye-off' : 'eye'} size={18} color={COLORS.textMuted} />
                </TouchableOpacity>
              </View>

              {!!gateError && (
                <View style={styles.gateErrorRow}>
                  <Ionicons name="alert-circle" size={14} color="#EF4444" />
                  <Text style={styles.gateErrorText}>{gateError}</Text>
                </View>
              )}

              <TouchableOpacity
                testID="portal-operator-submit"
                style={[styles.gateCta, (gateLoading || !password) && styles.gateCtaDisabled]}
                onPress={onOperatorLogin}
                disabled={gateLoading || !password}
                activeOpacity={0.85}
              >
                {gateLoading ? <ActivityIndicator color="#FFF" /> : (
                  <>
                    <Ionicons name="log-in" size={16} color="#FFF" />
                    <Text style={styles.gateCtaText}>{tr('Entrar')}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.gateAdminLink}
              onPress={() => router.push('/login?next=/admin' as any)}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8 }}
            >
              <Text style={styles.gateAdminLinkText}>{tr('¿Sos admin? Iniciá sesión')}</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Hub ──
  const goAdminLogin = () => router.push('/login?next=/admin' as any);
  const hubCards: HubCardDef[] = [
    {
      key: 'eagle',
      title: 'Eagle — KPIs',
      subtitle: tr('Vista total del sistema en vivo'),
      lockReason: tr('Requiere sesión admin · tocá para entrar'),
      icon: 'eye',
      accent: colorForKey('eagle'),
      available: isAdmin,
      onPress: () => router.push('/admin/eagle' as any),
      onLockedPress: goAdminLogin,
    },
    {
      key: 'partners',
      title: tr('Partners — Perfiles'),
      subtitle: tr('Aprobación y gestión de partners'),
      lockReason: tr('Requiere clave de operador'),
      icon: 'business',
      accent: colorForKey('partners'),
      available: isAdmin || isOperator,
      // The operator screen itself needs the operator token. An is_admin user
      // without one gets routed straight to the operator login instead of
      // bouncing off /admin/operator's own internal redirect.
      onPress: () => router.push((isOperator ? '/admin/operator' : '/admin/operator-login') as any),
    },
    {
      key: 'moderation',
      title: tr('Moderación'),
      subtitle: tr('Eventos pendientes de revisión'),
      lockReason: tr('Requiere sesión admin · tocá para entrar'),
      icon: 'shield-checkmark',
      accent: colorForKey('moderation'),
      available: isAdmin,
      badge: modStats?.pending,
      onPress: () => router.push('/admin/moderation'),
      onLockedPress: goAdminLogin,
    },
    {
      key: 'claims',
      title: tr('Cola de negocios (claims)'),
      subtitle: tr('Negocios y reclamos por aprobar'),
      lockReason: tr('Requiere sesión admin · tocá para entrar'),
      icon: 'albums',
      accent: colorForKey('claims'),
      available: isAdmin,
      onPress: () => router.push('/business/admin/queue' as any),
      onLockedPress: goAdminLogin,
    },
    {
      key: 'analytics',
      title: tr('Usuarios & Analytics'),
      subtitle: tr('Métricas, CRM y revenue'),
      lockReason: tr('Requiere sesión admin · tocá para entrar'),
      icon: 'stats-chart',
      accent: colorForKey('analytics'),
      available: isAdmin,
      onPress: () => setShowDashboard(v => !v),
      onLockedPress: goAdminLogin,
    },
    // "Demanda" card intentionally omitted — no /admin/demand screen exists.
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Portal AMO</Text>
            <Text style={styles.subtitle}>Amo Cartagena</Text>
            <View style={[styles.roleChip, isAdmin ? styles.roleChipAdmin : styles.roleChipOperator]}>
              <Ionicons name={isAdmin ? 'shield-checkmark' : 'key'} size={11} color={isAdmin ? COLORS.mustard : COLORS.official} />
              <Text style={[styles.roleChipText, { color: isAdmin ? COLORS.mustard : COLORS.official }]}>
                {isAdmin ? 'Admin' : tr('Operador')}
              </Text>
            </View>
          </View>
          {!isAdmin && isOperator && (
            <TouchableOpacity onPress={onOperatorLogout} style={styles.refreshBtn}>
              <Ionicons name="log-out-outline" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Operator-only: clear path to full access. Franck landed here with
            the operator key and found every admin card locked with no way in. */}
        {!isAdmin && isOperator && (
          <TouchableOpacity style={styles.adminUpgradeBanner} onPress={goAdminLogin} activeOpacity={0.85}>
            <Ionicons name="shield-checkmark" size={20} color={COLORS.mustard} />
            <View style={{ flex: 1 }}>
              <Text style={styles.adminUpgradeTitle}>{tr('Desbloqueá el portal completo')}</Text>
              <Text style={styles.adminUpgradeText}>{tr('Iniciá sesión con tu cuenta admin (Google) para Eagle, Moderación y Analytics.')}</Text>
            </View>
            <View style={styles.adminUpgradeBtn}>
              <Text style={styles.adminUpgradeBtnText}>{tr('Iniciar sesión')}</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Tools grid */}
        <View style={styles.hubGrid}>
          {hubCards.map(card => <PortalCard key={card.key} card={card} />)}
        </View>

        {/* Dashboard — collapsible, is_admin only, data fetched only for is_admin */}
        {isAdmin && (
          <>
            <TouchableOpacity style={styles.dashHeader} onPress={() => setShowDashboard(v => !v)} activeOpacity={0.7}>
              <View style={styles.dashHeaderLeft}>
                <Ionicons name="stats-chart" size={16} color={COLORS.primary} />
                <Text style={styles.dashHeaderTitle}>{tr('Dashboard')}</Text>
              </View>
              <Ionicons name={showDashboard ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textMuted} />
            </TouchableOpacity>

            {showDashboard && (
              loading || !data ? (
                <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40, marginBottom: 40 }} />
              ) : (
                <DashboardBody data={data} usersData={usersData} />
              )
            )}

            {/* Footer */}
            <View style={styles.footer}>
              <Ionicons name="information-circle-outline" size={14} color={COLORS.textMuted} />
              <Text style={styles.footerText}>Datos actualizados en tiempo real · Pull to refresh</Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  refreshBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold },
  subtitle: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },

  // Role chip (header)
  roleChip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 9, paddingVertical: 3, borderRadius: RADIUS.full, borderWidth: 1 },
  roleChipAdmin: { backgroundColor: `${COLORS.mustard}1F`, borderColor: `${COLORS.mustard}55` },
  roleChipOperator: { backgroundColor: `${COLORS.official}1F`, borderColor: `${COLORS.official}55` },
  roleChipText: { fontSize: 10, ...FONTS.bold, letterSpacing: 0.4, textTransform: 'uppercase' },

  // ── Portal login gate ──
  gateScroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: SPACING.xl, paddingVertical: SPACING.xxl, gap: SPACING.lg },
  gateWordmark: { alignItems: 'center', marginBottom: SPACING.md },
  gateLogo: { fontSize: 34, letterSpacing: 3, color: COLORS.textMain, ...FONTS.bold },
  gateLogoSub: { fontSize: 14, letterSpacing: 4, color: COLORS.textMuted, ...FONTS.medium, marginTop: 2 },
  gateDivider: { width: 48, height: 2, backgroundColor: COLORS.primary, marginTop: SPACING.md, borderRadius: 1 },
  gateTitle: { fontSize: 15, color: COLORS.textMuted, ...FONTS.medium, marginTop: SPACING.md, textAlign: 'center' },
  gateCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.lg, gap: SPACING.md },
  gateInputRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: SPACING.md, height: 52 },
  gateInput: { flex: 1, fontSize: 15, color: COLORS.textMain, ...FONTS.regular },
  gateErrorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: RADIUS.md, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)' },
  gateErrorText: { flex: 1, fontSize: 12, color: '#FCA5A5', ...FONTS.medium },
  gateCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 14 },
  gateCtaDisabled: { opacity: 0.5 },
  gateCtaText: { fontSize: 15, color: '#FFF', ...FONTS.bold },
  gateAdminLink: { alignItems: 'center', paddingVertical: SPACING.sm },
  gateAdminLinkText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.medium, textDecorationLine: 'underline' },

  // ── Hub tools grid ──
  hubGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: SPACING.lg, gap: SPACING.sm, marginTop: SPACING.md, marginBottom: SPACING.lg },
  adminUpgradeBanner: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginHorizontal: SPACING.lg, marginTop: SPACING.md, padding: SPACING.md, backgroundColor: 'rgba(233,185,73,0.10)', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(233,185,73,0.35)' },
  adminUpgradeTitle: { fontSize: 13, color: COLORS.textMain, ...FONTS.bold },
  adminUpgradeText: { fontSize: 11.5, color: COLORS.textMuted, marginTop: 2, lineHeight: 15 },
  adminUpgradeBtn: { backgroundColor: COLORS.mustard, borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 7 },
  adminUpgradeBtnText: { fontSize: 12, color: '#000', ...FONTS.bold },
  hubCard: { width: '47%', flexGrow: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, gap: 4 },
  hubCardLocked: { opacity: 0.55 },
  hubCardIconWrap: { width: 40, height: 40, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, position: 'relative' },
  hubCardBadge: { position: 'absolute', top: -6, right: -6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  hubCardBadgeText: { color: '#FFF', fontSize: 10, ...FONTS.bold },
  hubCardTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold, marginTop: 6 },
  hubCardTitleLocked: { color: COLORS.textMuted },
  hubCardSubtitle: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 15 },
  hubCardSubtitleLocked: { color: COLORS.textFaint },
  hubCardChevron: { position: 'absolute', top: SPACING.md, right: SPACING.md },

  // ── Dashboard collapsible section ──
  dashHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: SPACING.lg, marginBottom: SPACING.md, paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  dashHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  dashHeaderTitle: { fontSize: 13, color: COLORS.textMain, ...FONTS.bold, letterSpacing: 0.3 },

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
  revenueHero: { marginHorizontal: SPACING.lg, marginBottom: SPACING.md, backgroundColor: 'rgba(18,181,165,0.08)', borderRadius: RADIUS.xl, padding: SPACING.lg, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(18,181,165,0.2)' },
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
