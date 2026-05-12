import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { api } from '../constants/api';
import AlcaldiaHeatmap from './AlcaldiaHeatmap';

type Tab = 'overview' | 'heatmap' | 'users' | 'payments' | 'demographics' | 'payouts';

const fmtCOP = (n: number) =>
  '$ ' + (Number(n) || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });

const fmtNum = (n: number) =>
  (Number(n) || 0).toLocaleString('es-CO');

const tabs: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'overview', label: 'Resumen', icon: 'stats-chart' },
  { key: 'heatmap', label: 'Mapa', icon: 'map' },
  { key: 'payments', label: 'Pagos', icon: 'card' },
  { key: 'payouts', label: 'Liquidaciones', icon: 'cash' },
  { key: 'demographics', label: 'Turistas', icon: 'globe' },
  { key: 'users', label: 'Usuarios', icon: 'people' },
];

type Props = {
  token: string;
  business: any;
  partner: any;
  onEditProfile: () => void;
  onCreateEvent: () => void;
  onMyEvents: () => void;
};

export default function AlcaldiaDashboard({
  token,
  business,
  partner,
  onEditProfile,
  onCreateEvent,
  onMyEvents,
}: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  const [analytics, setAnalytics] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any>(null);
  const [eventsCount, setEventsCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  const load = useCallback(async () => {
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const [a, u, p, ev, po] = await Promise.all([
        api.get('/business/admin/analytics?days=30', { headers }),
        api.get('/business/admin/users?limit=200', { headers }),
        api.get('/business/admin/payments?limit=200', { headers }),
        api.get('/business/events', { headers }),
        api.get('/business/admin/payouts', { headers }).catch(() => null),
      ]);
      setAnalytics(a);
      setUsers(u.users || []);
      setPayments(p.payments || []);
      setEventsCount((ev || []).length);
      setPayouts(po);
    } catch (e) {
      console.error('Alcaldia load error', e);
    }
  }, [token]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleExport = async (kind: 'users' | 'payments') => {
    setExporting(kind);
    try {
      const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
      const url = `${BACKEND_URL}/api/business/admin/export/${kind}.csv`;
      if (Platform.OS === 'web') {
        // On web, open the URL with an auth-fetch then download as blob
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!resp.ok) throw new Error('Export failed');
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = kind === 'users' ? 'usuarios_amocartagena.csv' : 'pagos_amocartagena.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(blobUrl);
      } else {
        // Native: download to FileSystem cache, then share
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!resp.ok) throw new Error('Export failed');
        const csvText = await resp.text();
        const filename =
          kind === 'users' ? 'usuarios_amocartagena.csv' : 'pagos_amocartagena.csv';
        const fileUri = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(fileUri, csvText, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        const available = await Sharing.isAvailableAsync();
        if (available) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'text/csv',
            dialogTitle: 'Exportar CSV',
            UTI: 'public.comma-separated-values-text',
          });
        } else {
          Alert.alert('CSV listo', `Guardado en: ${fileUri}`);
        }
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo exportar el CSV');
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const k = analytics?.kpis || {};
  const demo = analytics?.demographics || {};

  return (
    <ScrollView
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
      }
      contentContainerStyle={{ paddingBottom: 120 }}
    >
      {/* Government Header Card */}
      <View style={styles.govCard}>
        <Image
          source={{
            uri:
              partner?.image_url ||
              'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Escudo_de_Cartagena_de_Indias.svg/400px-Escudo_de_Cartagena_de_Indias.svg.png',
          }}
          style={styles.govLogo}
          resizeMode="contain"
        />
        <View style={{ flex: 1 }}>
          <View style={styles.govBadge}>
            <Ionicons name="shield-checkmark" size={11} color="#1B4F72" />
            <Text style={styles.govBadgeText}>CUENTA OFICIAL · GOBIERNO</Text>
          </View>
          <Text style={styles.govName}>{partner?.name || 'Alcaldía de Cartagena'}</Text>
          <Text style={styles.govSubtitle}>Panel de datos de la ciudad · Amo Cartagena</Text>
        </View>
      </View>

      {/* Action Bar (events) */}
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.actionBtn} onPress={onCreateEvent}>
          <Ionicons name="add-circle" size={18} color={COLORS.white} />
          <Text style={styles.actionBtnText}>Publicar evento cultural</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtnAlt} onPress={onMyEvents}>
          <Ionicons name="calendar" size={16} color={COLORS.primary} />
          <Text style={styles.actionBtnAltText}>Mis eventos ({eventsCount})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtnAlt} onPress={onEditProfile}>
          <Ionicons name="create" size={16} color={COLORS.primary} />
          <Text style={styles.actionBtnAltText}>Editar perfil</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {tabs.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.tabPill, tab === t.key && styles.tabPillActive]}
              onPress={() => setTab(t.key)}
            >
              <Ionicons
                name={t.icon}
                size={14}
                color={tab === t.key ? COLORS.white : COLORS.textMuted}
              />
              <Text style={[styles.tabPillText, tab === t.key && styles.tabPillTextActive]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {tab === 'overview' && (
        <View style={styles.section}>
          {/* Revenue KPIs */}
          <Text style={styles.sectionTitle}>Ingresos generados</Text>
          <View style={styles.bigKpiCard}>
            <Text style={styles.bigKpiLabel}>Ingresos totales (City Pass + Tasa Portuaria)</Text>
            <Text style={styles.bigKpiValue}>{fmtCOP(k.total_revenue_cop)}</Text>
            <View style={styles.kpiSplit}>
              <View style={styles.kpiSplitItem}>
                <Ionicons name="ticket" size={14} color="#22C55E" />
                <View>
                  <Text style={styles.kpiSplitLabel}>City Pass</Text>
                  <Text style={styles.kpiSplitValue}>{fmtCOP(k.citypass_revenue_cop)}</Text>
                </View>
              </View>
              <View style={styles.kpiSplitDivider} />
              <View style={styles.kpiSplitItem}>
                <Ionicons name="boat" size={14} color="#3B82F6" />
                <View>
                  <Text style={styles.kpiSplitLabel}>Tasa Portuaria</Text>
                  <Text style={styles.kpiSplitValue}>{fmtCOP(k.port_tax_revenue_cop)}</Text>
                </View>
              </View>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Usuarios de la app</Text>
          <View style={styles.kpiGrid}>
            <KpiTile color="#D97706" icon="people" value={fmtNum(k.total_users)} label="Total usuarios" />
            <KpiTile color="#22C55E" icon="trending-up" value={`+${fmtNum(k.new_users_30d)}`} label="Nuevos 30d" />
            <KpiTile color="#3B82F6" icon="flash" value={`+${fmtNum(k.new_users_7d)}`} label="Nuevos 7d" />
            <KpiTile color="#A855F7" icon="globe" value={fmtNum(demo.total_profiled || 0)} label="Perfilados IA" />
          </View>

          <Text style={styles.sectionTitle}>City Pass & Tasa Portuaria</Text>
          <View style={styles.kpiGrid}>
            <KpiTile color="#22C55E" icon="key" value={fmtNum(k.total_passes_sold)} label="City Pass vendidos" />
            <KpiTile color="#10B981" icon="checkmark-circle" value={fmtNum(k.active_passes)} label="Pases activos" />
            <KpiTile color="#3B82F6" icon="boat" value={fmtNum(k.port_tax_tickets)} label="Tickets Tasa Port." />
            <KpiTile color="#0EA5E9" icon="people-circle" value={fmtNum(k.port_tax_passengers)} label="Pasajeros tasa" />
          </View>

          {/* Top Events */}
          {!!analytics?.top_events?.length && (
            <>
              <Text style={styles.sectionTitle}>Eventos más vistos por turistas</Text>
              {analytics.top_events.slice(0, 6).map((ev: any) => (
                <View key={ev.event_id} style={styles.topRow}>
                  <View style={styles.topRowLeft}>
                    <Text style={styles.topRowTitle} numberOfLines={1}>{ev.title}</Text>
                    <Text style={styles.topRowSub}>{ev.venue || ev.type || ''}</Text>
                  </View>
                  <View style={styles.topBadge}>
                    <Ionicons name="eye" size={11} color={COLORS.primary} />
                    <Text style={styles.topBadgeText}>{fmtNum(ev.views)}</Text>
                  </View>
                </View>
              ))}
            </>
          )}

          {/* Top Zones */}
          {!!analytics?.top_zones?.length && (
            <>
              <Text style={styles.sectionTitle}>Zonas más visitadas</Text>
              <View style={styles.chipsWrap}>
                {analytics.top_zones.slice(0, 10).map((z: any) => (
                  <View key={z.zone} style={styles.zoneChip}>
                    <Ionicons name="location" size={11} color={COLORS.primary} />
                    <Text style={styles.zoneChipText}>{z.zone}</Text>
                    <Text style={styles.zoneChipCount}>{fmtNum(z.count)}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>
      )}

      {tab === 'heatmap' && <AlcaldiaHeatmap token={token} />}

      {tab === 'payments' && (
        <View style={styles.section}>
          <View style={styles.rowHeader}>
            <Text style={styles.sectionTitle}>Historial de pagos</Text>
            <TouchableOpacity
              style={styles.exportBtn}
              onPress={() => handleExport('payments')}
              disabled={exporting === 'payments'}
            >
              {exporting === 'payments' ? (
                <ActivityIndicator size="small" color={COLORS.primary} />
              ) : (
                <>
                  <Ionicons name="download" size={14} color={COLORS.primary} />
                  <Text style={styles.exportBtnText}>CSV</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.summaryRow}>
            <SummaryItem label="City Pass" value={fmtNum(k.total_passes_sold)} />
            <SummaryItem label="Tasa Port." value={fmtNum(k.port_tax_tickets)} />
            <SummaryItem label="Ingresos" value={fmtCOP(k.total_revenue_cop)} />
          </View>

          {payments.length === 0 ? (
            <Text style={styles.emptyMsg}>No hay pagos registrados todavía.</Text>
          ) : (
            payments.slice(0, 100).map((p) => (
              <View key={p.id} style={styles.payRow}>
                <View
                  style={[
                    styles.payIcon,
                    {
                      backgroundColor:
                        p.type === 'city_pass'
                          ? 'rgba(34,197,94,0.18)'
                          : 'rgba(59,130,246,0.18)',
                    },
                  ]}
                >
                  <Ionicons
                    name={p.type === 'city_pass' ? 'key' : 'boat'}
                    size={16}
                    color={p.type === 'city_pass' ? '#22C55E' : '#3B82F6'}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.payLabel} numberOfLines={1}>
                    {p.label}
                  </Text>
                  <Text style={styles.paySub} numberOfLines={1}>
                    {p.user_email} · {(p.created_at || '').slice(0, 10)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.payAmount}>{fmtCOP(p.amount)}</Text>
                  <View
                    style={[
                      styles.payStatus,
                      p.status === 'used' || p.status === 'expired'
                        ? { backgroundColor: 'rgba(120,120,120,0.18)' }
                        : { backgroundColor: 'rgba(34,197,94,0.18)' },
                    ]}
                  >
                    <Text style={styles.payStatusText}>{p.status}</Text>
                  </View>
                </View>
              </View>
            ))
          )}
        </View>
      )}

      {tab === 'demographics' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Perfil del turista</Text>
          <Text style={styles.sectionSub}>
            {fmtNum(demo.total_profiled || 0)} usuarios perfilados por IA · datos agregados
          </Text>

          {/* Nationalities */}
          <Text style={styles.subTitle}>Nacionalidad</Text>
          {(demo.nationalities || []).slice(0, 12).map((n: any) => (
            <View key={n.country} style={styles.barRow}>
              <Text style={styles.barLabel}>{n.country}</Text>
              <View style={styles.barBg}>
                <View
                  style={[
                    styles.barFill,
                    { width: `${Math.min(n.percentage || 0, 100)}%`, backgroundColor: '#D97706' },
                  ]}
                />
              </View>
              <Text style={styles.barValue}>
                {fmtNum(n.count)} ({n.percentage}%)
              </Text>
            </View>
          ))}

          {/* Age */}
          {!!(demo.age_groups || []).length && (
            <>
              <Text style={styles.subTitle}>Grupos de edad</Text>
              <View style={styles.chipsWrap}>
                {(demo.age_groups || []).map((a: any) => (
                  <View key={a.group} style={styles.miniBox}>
                    <Text style={styles.miniBoxLabel}>{a.group}</Text>
                    <Text style={styles.miniBoxValue}>{fmtNum(a.count)}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Gender */}
          {!!(demo.genders || []).length && (
            <>
              <Text style={styles.subTitle}>Género</Text>
              <View style={styles.chipsWrap}>
                {(demo.genders || []).map((g: any) => (
                  <View key={g.gender} style={styles.miniBox}>
                    <Text style={styles.miniBoxLabel}>{g.gender}</Text>
                    <Text style={styles.miniBoxValue}>{fmtNum(g.count)}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          <View style={styles.helpBox}>
            <Ionicons name="information-circle" size={14} color={COLORS.textMuted} />
            <Text style={styles.helpText}>
              Los datos demográficos provienen del módulo IA de perfilamiento de usuarios (basado en
              favoritos, agenda y zonas visitadas). Anónimos y agregados.
            </Text>
          </View>
        </View>
      )}

      {tab === 'payouts' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Liquidaciones a partners</Text>
          <Text style={styles.sectionSub}>
            Comisión 3% retenida por la app · Alcaldía y Tasa Portuaria sin comisión
          </Text>

          {payouts?.totals && (
            <View style={styles.summaryRow}>
              <SummaryItem label="Total bruto" value={fmtCOP(payouts.totals.gross_cop)} />
              <SummaryItem label="Comisión app" value={fmtCOP(payouts.totals.app_commission_cop)} />
              <SummaryItem label="A pagar partners" value={fmtCOP(payouts.totals.partner_owed_cop)} />
            </View>
          )}

          {!payouts || (payouts.rows || []).length === 0 ? (
            <Text style={styles.emptyMsg}>
              Aún no hay pagos a partners. Cuando un usuario pague una reserva, aparecerá aquí
              el monto a transferir al partner.
            </Text>
          ) : (
            payouts.rows.map((r: any) => (
              <View key={r.partner_id || r.partner_name} style={styles.payRow}>
                <View style={[styles.payIcon, { backgroundColor: 'rgba(217,119,6,0.18)' }]}>
                  <Ionicons name="business" size={16} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.payLabel} numberOfLines={1}>{r.partner_name}</Text>
                  <Text style={styles.paySub} numberOfLines={1}>
                    {r.transactions} pagos · Bruto {fmtCOP(r.gross_cop)} · Comisión {fmtCOP(r.app_commission_cop)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.payAmount, { color: '#22C55E' }]}>{fmtCOP(r.partner_amount_cop)}</Text>
                  <Text style={{ fontSize: 9, color: COLORS.textMuted }}>a transferir</Text>
                </View>
              </View>
            ))
          )}

          <View style={styles.helpBox}>
            <Ionicons name="information-circle" size={14} color={COLORS.textMuted} />
            <Text style={styles.helpText}>
              Estos montos representan el 97% del valor cobrado a usuarios por reservas en cada
              partner. Realiza las transferencias bancarias correspondientes y marca los pagos como
              liquidados (próximamente). El 3% restante queda en la cuenta de la app como comisión.
            </Text>
          </View>
        </View>
      )}

      {tab === 'users' && (
        <View style={styles.section}>
          <View style={styles.rowHeader}>
            <Text style={styles.sectionTitle}>
              Usuarios registrados ({fmtNum(k.total_users)})
            </Text>
            <TouchableOpacity
              style={styles.exportBtn}
              onPress={() => handleExport('users')}
              disabled={exporting === 'users'}
            >
              {exporting === 'users' ? (
                <ActivityIndicator size="small" color={COLORS.primary} />
              ) : (
                <>
                  <Ionicons name="download" size={14} color={COLORS.primary} />
                  <Text style={styles.exportBtnText}>CSV</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {users.length === 0 ? (
            <Text style={styles.emptyMsg}>No hay usuarios todavía.</Text>
          ) : (
            users.map((u) => (
              <View key={u.user_id} style={styles.userRow}>
                {u.picture ? (
                  <Image source={{ uri: u.picture }} style={styles.userAvatar} />
                ) : (
                  <View style={[styles.userAvatar, { backgroundColor: COLORS.surface }]}>
                    <Ionicons name="person" size={16} color={COLORS.textMuted} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.userName} numberOfLines={1}>
                    {u.name || '—'}
                  </Text>
                  <Text style={styles.userEmail} numberOfLines={1}>
                    {u.email}
                  </Text>
                  <View style={styles.userMetaRow}>
                    {u.has_active_pass && (
                      <View style={[styles.tag, { backgroundColor: 'rgba(34,197,94,0.18)' }]}>
                        <Text style={[styles.tagText, { color: '#22C55E' }]}>City Pass</Text>
                      </View>
                    )}
                    {u.port_tax_tickets > 0 && (
                      <View style={[styles.tag, { backgroundColor: 'rgba(59,130,246,0.18)' }]}>
                        <Text style={[styles.tagText, { color: '#3B82F6' }]}>
                          🛥 {u.port_tax_tickets}
                        </Text>
                      </View>
                    )}
                    {!!u.nationality && (
                      <Text style={styles.userMeta}>· {u.nationality}</Text>
                    )}
                  </View>
                </View>
                <Text style={styles.userDate}>{(u.created_at || '').slice(0, 10)}</Text>
              </View>
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
}

function KpiTile({
  color,
  icon,
  value,
  label,
}: {
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
}) {
  return (
    <View style={[styles.kpiTile, { borderColor: color + '55' }]}>
      <View style={[styles.kpiTileIcon, { backgroundColor: color + '22' }]}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <Text style={styles.kpiTileValue}>{value}</Text>
      <Text style={styles.kpiTileLabel}>{label}</Text>
    </View>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryItem}>
      <Text style={styles.summaryItemLabel}>{label}</Text>
      <Text style={styles.summaryItemValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 80 },

  govCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    margin: SPACING.lg,
    padding: SPACING.md,
    backgroundColor: 'rgba(27,79,114,0.12)',
    borderRadius: RADIUS.xl,
    borderWidth: 1.5,
    borderColor: '#1B4F72',
  },
  govLogo: { width: 60, height: 60 },
  govBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    alignSelf: 'flex-start',
  },
  govBadgeText: { fontSize: 9, color: '#1B4F72', ...FONTS.bold, letterSpacing: 0.6 },
  govName: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold, marginTop: 4 },
  govSubtitle: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },

  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primary,
  },
  actionBtnText: { color: COLORS.white, fontSize: 12, ...FONTS.bold },
  actionBtnAlt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  actionBtnAltText: { color: COLORS.primary, fontSize: 11, ...FONTS.semibold },

  tabsWrap: { paddingHorizontal: SPACING.lg, marginBottom: SPACING.md },
  tabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: SPACING.xs,
  },
  tabPillActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabPillText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold },
  tabPillTextActive: { color: COLORS.white },

  section: { paddingHorizontal: SPACING.lg, gap: SPACING.sm },
  sectionTitle: { fontSize: 15, color: COLORS.textMain, ...FONTS.bold, marginTop: SPACING.md },
  sectionSub: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginTop: -2 },
  subTitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    ...FONTS.bold,
    letterSpacing: 0.6,
    marginTop: SPACING.md,
    textTransform: 'uppercase',
  },

  bigKpiCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: 'rgba(217,119,6,0.4)',
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  bigKpiLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 0.5, textTransform: 'uppercase' },
  bigKpiValue: { fontSize: 28, color: COLORS.primary, ...FONTS.bold },
  kpiSplit: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: 4 },
  kpiSplitItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  kpiSplitDivider: { width: 1, backgroundColor: COLORS.border, alignSelf: 'stretch' },
  kpiSplitLabel: { fontSize: 10, color: COLORS.textMuted, ...FONTS.regular },
  kpiSplitValue: { fontSize: 13, color: COLORS.textMain, ...FONTS.bold },

  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  kpiTile: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.sm,
    gap: 4,
  },
  kpiTileIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  kpiTileValue: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold },
  kpiTileLabel: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium, letterSpacing: 0.3 },

  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.sm,
    gap: SPACING.sm,
  },
  topRowLeft: { flex: 1 },
  topRowTitle: { fontSize: 13, color: COLORS.textMain, ...FONTS.semibold },
  topRowSub: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },
  topBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    backgroundColor: 'rgba(217,119,6,0.15)',
  },
  topBadgeText: { fontSize: 11, color: COLORS.primary, ...FONTS.bold },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  zoneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  zoneChipText: { fontSize: 11, color: COLORS.textMain, ...FONTS.semibold },
  zoneChipCount: { fontSize: 10, color: COLORS.textMuted, ...FONTS.regular },

  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.primary,
    backgroundColor: 'rgba(217,119,6,0.1)',
  },
  exportBtnText: { fontSize: 11, color: COLORS.primary, ...FONTS.bold },

  summaryRow: {
    flexDirection: 'row',
    gap: SPACING.xs,
    marginTop: SPACING.xs,
  },
  summaryItem: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  summaryItemLabel: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium, letterSpacing: 0.4 },
  summaryItemValue: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold, marginTop: 2 },

  payRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.sm,
    marginTop: SPACING.xs,
  },
  payIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  payLabel: { fontSize: 13, color: COLORS.textMain, ...FONTS.semibold },
  paySub: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },
  payAmount: { fontSize: 13, color: COLORS.textMain, ...FONTS.bold },
  payStatus: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: RADIUS.full, marginTop: 3 },
  payStatusText: { fontSize: 9, ...FONTS.bold, color: COLORS.textMain, letterSpacing: 0.5, textTransform: 'uppercase' },

  emptyMsg: {
    fontSize: 12,
    color: COLORS.textMuted,
    textAlign: 'center',
    padding: SPACING.lg,
    ...FONTS.regular,
  },

  barRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: 4 },
  barLabel: { width: 90, fontSize: 11, color: COLORS.textMain, ...FONTS.medium },
  barBg: { flex: 1, height: 8, backgroundColor: COLORS.surface, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  barValue: { width: 90, fontSize: 10, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'right' },

  miniBox: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    minWidth: 70,
    alignItems: 'center',
  },
  miniBoxLabel: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium },
  miniBoxValue: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold, marginTop: 2 },

  helpBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    padding: SPACING.sm,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: RADIUS.md,
    marginTop: SPACING.md,
  },
  helpText: { flex: 1, fontSize: 10, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 14 },

  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.sm,
    marginTop: SPACING.xs,
  },
  userAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  userName: { fontSize: 13, color: COLORS.textMain, ...FONTS.semibold },
  userEmail: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginTop: 1 },
  userMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4, flexWrap: 'wrap' },
  userMeta: { fontSize: 10, color: COLORS.textMuted, ...FONTS.regular },
  userDate: { fontSize: 10, color: COLORS.textMuted, ...FONTS.regular },

  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: RADIUS.full },
  tagText: { fontSize: 9, ...FONTS.bold, letterSpacing: 0.3 },
});
