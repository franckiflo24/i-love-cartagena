import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useAuth } from '../../src/context/AuthContext';

// ── Types ────────────────────────────────────────────────────
type Kpis = {
  users_total: number; users_today: number; users_7d: number;
  business_total: number; partners_total: number;
  searches_total: number; searches_today: number; searches_zero: number;
  bookings_total: number; bookings_today: number;
  active_sessions: number; passes_active: number;
  failed_logins_today: number;
  claims_pending: number; media_pending: number; events_pending: number;
  crashes_24h?: number; // optional: absent until the backend crash beacon deploys
};
type Eagle = {
  kpis: Kpis;
  signups: { kind: string; name: string; email?: string; detail?: string; when?: string }[];
  logins: { kind: string; who: string; detail?: string; when?: string }[];
  failed_logins: { email?: string; ip?: string; detail?: string; scope?: string; ts?: string }[];
  logouts: { user_id?: string; scope?: string; ip?: string; ts?: string }[];
  searches: { query?: string; matches_count?: number; intent?: string; ai_used?: boolean; ts?: string; user_id?: string }[];
  bookings: { partner_name?: string; user_name?: string; user_email?: string; user_whatsapp?: string; date?: string; time?: string; party_size?: number; status?: string; amount_cop?: number; type?: string; created_at?: string }[];
  claims: { partner_id?: string; actor_email?: string; state?: string; method?: string; created_at?: string }[];
  generated_at?: string;
};

type Tab = 'signups' | 'logins' | 'security' | 'searches' | 'bookings' | 'claims';
const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'signups', label: 'Registros', icon: 'person-add' },
  { key: 'logins', label: 'Accesos', icon: 'log-in' },
  { key: 'security', label: 'Seguridad', icon: 'shield-checkmark' },
  { key: 'searches', label: 'Búsquedas', icon: 'search' },
  { key: 'bookings', label: 'Reservas', icon: 'calendar' },
  { key: 'claims', label: 'Reclamos', icon: 'business' },
];

// relative time: "hace 3 min" / "hace 2 h" / "12 ago"
function ago(iso?: string): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (isNaN(t)) return '—';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'ahora';
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `hace ${d} d`;
  return new Date(t).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}
const cop = (n?: number) => (n && n > 0 ? `$${n.toLocaleString('es-CO')}` : '');

export default function EagleEye() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [data, setData] = useState<Eagle | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('signups');

  useEffect(() => {
    if (!authLoading && (!user || !user.is_admin)) router.replace('/');
  }, [user, authLoading, router]);

  const load = useCallback(async () => {
    try { setData(await api.get('/admin/eagle')); }
    catch (e) { console.error('[EagleEye]', e); }
  }, []);

  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  if (authLoading || !user?.is_admin || loading) {
    return <SafeAreaView style={styles.container}><ActivityIndicator size="large" color={COLORS.primary} style={{ flex: 1 }} /></SafeAreaView>;
  }

  const k = data?.kpis;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="close" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Ionicons name="eye" size={16} color={COLORS.primary} />
          <Text style={styles.headerTitle}>Eagle Eye</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={() => router.push('/admin' as any)} style={styles.headerBtn}>
            <Ionicons name="apps-outline" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onRefresh} style={styles.headerBtn}>
            <Ionicons name="refresh" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        contentContainerStyle={{ paddingBottom: 90 }}
      >
        <View style={styles.subhead}>
          <Text style={styles.subheadText}>Vista total del sistema · solo super-admin</Text>
          {data?.generated_at ? <Text style={styles.subheadTime}>Actualizado {ago(data.generated_at)}</Text> : null}
        </View>

        {/* KPI GRID */}
        {k && (
          <View style={styles.grid}>
            <Kpi big={k.users_total} label="Usuarios" sub={`+${k.users_today} hoy · ${k.users_7d} en 7d`} icon="people" accent={COLORS.primary} />
            <Kpi big={k.active_sessions} label="Sesiones activas" sub="tokens vigentes ahora" icon="pulse" accent="#22C55E" />
            <Kpi big={k.searches_total} label="Búsquedas" sub={`${k.searches_today} hoy · ${k.searches_zero} sin resultado`} icon="search" accent="#38BDF8" />
            <Kpi big={k.bookings_total} label="Reservas" sub={`${k.bookings_today} hoy`} icon="calendar" accent="#A78BFA" />
            <Kpi big={k.business_total} label="Negocios" sub="cuentas de socios" icon="briefcase" accent="#F59E0B" />
            <Kpi big={k.partners_total} label="Lugares" sub="en el directorio" icon="location" accent="#F472B6" />
            <Kpi big={k.passes_active} label="City Pass" sub="activos" icon="ticket" accent="#34D399" />
            <Kpi big={k.media_pending + k.events_pending + k.claims_pending} label="Por revisar"
              sub={`${k.media_pending} fotos · ${k.events_pending} eventos · ${k.claims_pending} reclamos`} icon="alert-circle" accent="#EF4444" />
            <Kpi big={k.failed_logins_today} label="Logins fallidos" sub="hoy · contraseñas erróneas" icon="lock-closed" accent="#F97316" />
            {typeof k.crashes_24h === 'number' ? (
              <Kpi big={k.crashes_24h} label="App crashes" sub="últimas 24 h · reporte automático" icon="bug" accent="#EF4444" />
            ) : null}
          </View>
        )}

        {/* TABS */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBar}>
          {TABS.map(t => {
            const active = tab === t.key;
            return (
              <TouchableOpacity key={t.key} onPress={() => setTab(t.key)} style={[styles.tab, active && styles.tabActive]} activeOpacity={0.8}>
                <Ionicons name={t.icon} size={14} color={active ? COLORS.white : COLORS.textMuted} />
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* FEEDS */}
        <View style={styles.feed}>
          {tab === 'signups' && (data?.signups?.length
            ? data.signups.map((r, i) => (
              <Row key={i} icon={r.kind === 'business' ? 'briefcase' : 'person'} iconColor={r.kind === 'business' ? '#F59E0B' : COLORS.primary}
                title={r.name || r.email || '—'} sub={r.email && r.name ? r.email : undefined} chip={r.detail} time={ago(r.when)} />
            ))
            : <Empty text="Sin registros todavía." />)}

          {tab === 'logins' && (data?.logins?.length
            ? data.logins.map((r, i) => (
              <Row key={i} icon={r.kind === 'business' ? 'business' : 'log-in'} iconColor={r.kind === 'business' ? '#F59E0B' : '#22C55E'}
                title={r.who} sub={r.detail || undefined} chip={r.kind === 'business' ? 'socio' : 'usuario'} time={ago(r.when)} />
            ))
            : <Empty text="Sin accesos todavía." />)}

          {tab === 'security' && ((data?.failed_logins?.length || data?.logouts?.length)
            ? (
              <>
                {(data?.failed_logins || []).map((r, i) => (
                  <Row key={`f${i}`} icon="lock-closed" iconColor="#EF4444"
                    title={r.email || '—'} sub={r.ip ? `IP ${r.ip}` : undefined}
                    chip={r.scope === 'business' ? 'socio · contraseña' : 'contraseña'} chipDanger time={ago(r.ts)} />
                ))}
                {(data?.logouts || []).map((r, i) => (
                  <Row key={`o${i}`} icon="log-out" iconColor="#94A3B8"
                    title={r.user_id || '—'} sub={r.ip ? `IP ${r.ip}` : undefined}
                    chip={r.scope === 'business' ? 'socio · salida' : 'salida'} time={ago(r.ts)} />
                ))}
              </>
            )
            : <Empty text="Sin eventos de seguridad." />)}

          {tab === 'searches' && (data?.searches?.length
            ? data.searches.map((r, i) => {
              const zero = (r.matches_count ?? 0) === 0;
              return (
                <Row key={i} icon="search" iconColor={zero ? '#EF4444' : '#38BDF8'}
                  title={`"${r.query || '—'}"`}
                  sub={r.intent ? `intención: ${r.intent}${r.ai_used ? ' · IA' : ''}` : (r.ai_used ? 'IA' : undefined)}
                  chip={zero ? 'sin resultado' : `${r.matches_count} result.`} chipDanger={zero} time={ago(r.ts)} />
              );
            })
            : <Empty text="Sin búsquedas todavía." />)}

          {tab === 'bookings' && (data?.bookings?.length
            ? data.bookings.map((r, i) => (
              <Row key={i} icon="calendar" iconColor="#A78BFA"
                title={r.partner_name || '—'}
                sub={[r.user_name, r.party_size ? `${r.party_size} pax` : null, r.date, r.time].filter(Boolean).join(' · ') || undefined}
                chip={r.status || undefined} extra={cop(r.amount_cop)} time={ago(r.created_at)} />
            ))
            : <Empty text="Sin reservas todavía." />)}

          {tab === 'claims' && (data?.claims?.length
            ? data.claims.map((r, i) => (
              <Row key={i} icon="business" iconColor="#F472B6"
                title={r.partner_id || '—'} sub={r.actor_email || undefined}
                chip={r.state || undefined} extra={r.method || ''} time={ago(r.created_at)} />
            ))
            : <Empty text="Sin reclamos todavía." />)}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── KPI tile ─────────────────────────────────────────────────
function Kpi({ big, label, sub, icon, accent }: { big: number; label: string; sub: string; icon: any; accent: string }) {
  return (
    <View style={[styles.kpi, { borderColor: accent + '55' }]}>
      <View style={styles.kpiTop}>
        <Text style={[styles.kpiBig, { color: accent }]}>{big.toLocaleString('es-CO')}</Text>
        <Ionicons name={icon} size={16} color={accent} />
      </View>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiSub}>{sub}</Text>
    </View>
  );
}

// ── Feed row ─────────────────────────────────────────────────
function Row({ icon, iconColor, title, sub, chip, chipDanger, extra, time }:
  { icon: any; iconColor: string; title: string; sub?: string; chip?: string; chipDanger?: boolean; extra?: string; time: string }) {
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: iconColor + '22' }]}>
        <Ionicons name={icon} size={15} color={iconColor} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
        {sub ? <Text style={styles.rowSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
      <View style={styles.rowRight}>
        {chip ? (
          <View style={[styles.chip, chipDanger && styles.chipDanger]}>
            <Text style={[styles.chipText, chipDanger && styles.chipTextDanger]}>{chip}</Text>
          </View>
        ) : null}
        {extra ? <Text style={styles.rowExtra}>{extra}</Text> : null}
        <Text style={styles.rowTime}>{time}</Text>
      </View>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name="file-tray-outline" size={40} color={COLORS.textMuted} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold, letterSpacing: 0.5 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },

  subhead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.xs },
  subheadText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 0.5, textTransform: 'uppercase' },
  subheadTime: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, paddingHorizontal: SPACING.lg, marginBottom: SPACING.md },
  kpi: { width: '47%', flexGrow: 1, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1 },
  kpiTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kpiBig: { fontSize: 26, ...FONTS.bold, letterSpacing: -0.5 },
  kpiLabel: { fontSize: 12, color: COLORS.textMain, ...FONTS.semibold, marginTop: 4 },
  kpiSub: { fontSize: 10, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2, lineHeight: 14 },

  tabBar: { gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  tabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold },
  tabTextActive: { color: COLORS.white },

  feed: { paddingHorizontal: SPACING.lg, gap: SPACING.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  rowIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 13, color: COLORS.textMain, ...FONTS.semibold },
  rowSub: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginTop: 1 },
  rowRight: { alignItems: 'flex-end', gap: 3 },
  rowExtra: { fontSize: 11, color: COLORS.textMain, ...FONTS.semibold },
  rowTime: { fontSize: 10, color: COLORS.textMuted, ...FONTS.regular },
  chip: { backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.full },
  chipText: { fontSize: 10, color: COLORS.textMuted, ...FONTS.semibold, textTransform: 'capitalize' },
  chipDanger: { backgroundColor: 'rgba(239,68,68,0.18)' },
  chipTextDanger: { color: '#EF4444' },

  empty: { alignItems: 'center', padding: SPACING.xl, gap: SPACING.sm },
  emptyText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular },
});
