// CMW-2 — /cmw-panel: the internal pre-registration panel from Franck's spec
// ("totales en tiempo real por fuente/ciudad/país/edad + CSV filtrable, con
// registro de quién descargó"). Role-gated: the backend accepts ONLY
// EVENTS_ADMIN_TOKEN or an is_admin session (events_elite.require_admin_read);
// this screen rides the signed-in admin session. Every CSV export is logged
// server-side to cmw_admin_downloads. Not linked from any public surface; noindex.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Head from '../src/components/WebHead';
import { API_BASE, api, getToken, isAuthStatus } from '../src/constants/api';
import { useAuth } from '../src/context/AuthContext';
import { useTr } from '../src/i18n/autoTr';
import { goBackOr } from '../src/lib/nav';
import { COLORS, FONTS, RADIUS, SPACING, TYPE } from '../src/constants/theme';

type Pair = { value: string | null; n: number };
type PanelData = {
  total: number;
  count: number;
  preregs: Array<Record<string, unknown>>;
  breakdown: {
    by_utm_source: Pair[]; by_ref: Pair[]; by_landing: Pair[];
    by_city: Pair[]; by_country: Pair[]; by_birth_year: Pair[];
    marketing_opt_in: number; linked_users: number;
    profiles_complete: number; referred: number; top_referrers: Pair[];
  };
  funnel: Array<{ event: string; n: number }>;
  csv_downloads_logged: number;
};

const FUNNEL_ORDER = [
  'cmw_link_abierto', 'preinscripcion_iniciada', 'preinscripcion_completada',
  'cuenta_creada', 'referido_compartido', 'push_aceptado', 'app_instalada',
];
const FUNNEL_LABEL: Record<string, string> = {
  cmw_link_abierto: 'Link abierto',
  preinscripcion_iniciada: 'Formulario iniciado',
  preinscripcion_completada: 'Preinscripción completada',
  cuenta_creada: 'Cuenta creada (linkeo)',
  referido_compartido: 'Referido compartido',
  push_aceptado: 'Push aceptado',
  app_instalada: 'App instalada',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function ageBands(byYear: Pair[]): Array<{ label: string; n: number }> {
  const now = new Date().getFullYear();
  const bands = [
    { label: '18–24', lo: 18, hi: 24, n: 0 },
    { label: '25–34', lo: 25, hi: 34, n: 0 },
    { label: '35–44', lo: 35, hi: 44, n: 0 },
    { label: '45+', lo: 45, hi: 130, n: 0 },
  ];
  for (const row of byYear) {
    const y = parseInt(String(row.value || ''), 10);
    if (!Number.isInteger(y)) continue;
    const age = now - y;
    const band = bands.find((b) => age >= b.lo && age <= b.hi);
    if (band) band.n += row.n;
  }
  return bands.map(({ label, n }) => ({ label, n }));
}

export default function CmwPanelScreen() {
  const tr = useTr();
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [data, setData] = useState<PanelData | null>(null);
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvMsg, setCsvMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setDenied(false);
    setFailed(false);
    try {
      const env = await api.get('/admin/cmw/prereg?limit=500');
      const d = (env && typeof env === 'object' ? (env as { data?: PanelData }).data : null) || null;
      if (d && Array.isArray(d.preregs)) setData(d);
      else setFailed(true);
    } catch (e) {
      if (isAuthStatus(e)) setDenied(true);
      else setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading, load]);

  const downloadCsv = useCallback(async () => {
    if (csvBusy) return;
    setCsvMsg(null);
    if (Platform.OS !== 'web') {
      setCsvMsg('La exportación CSV está disponible en la versión web del panel.');
      return;
    }
    setCsvBusy(true);
    try {
      const qs: string[] = [];
      if (DATE_RE.test(from.trim())) qs.push(`from=${from.trim()}`);
      if (DATE_RE.test(to.trim())) qs.push(`to=${to.trim()}`);
      const token = await getToken();
      const res = await fetch(`${API_BASE}/admin/cmw/prereg.csv${qs.length ? `?${qs.join('&')}` : ''}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        setCsvMsg(res.status === 401 || res.status === 403
          ? 'Solo administradores.' : 'No se pudo exportar. Intenta de nuevo.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cmw-preinscripciones-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setCsvMsg('Exportación descargada (quedó registrada en el log).');
    } catch {
      setCsvMsg('No se pudo exportar. Intenta de nuevo.');
    } finally {
      setCsvBusy(false);
    }
  }, [csvBusy, from, to]);

  const funnel = useMemo(() => {
    const got = new Map((data?.funnel || []).map((f) => [f.event, f.n]));
    return FUNNEL_ORDER.filter((e) => got.has(e)).map((e) => ({
      event: e, label: FUNNEL_LABEL[e] || e, n: got.get(e) || 0,
    }));
  }, [data]);

  const bands = useMemo(() => ageBands(data?.breakdown.by_birth_year || []), [data]);
  const pct = (n: number): string => (data && data.total > 0 ? ` · ${Math.round((n / data.total) * 100)}%` : '');

  const recent = useMemo(() => (data?.preregs || []).slice(0, 20), [data]);

  return (
    <SafeAreaView style={st.container} edges={['top']}>
      <Head>
        <title>Panel CMW · AMO</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <ScrollView
        contentContainerStyle={st.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={load} tintColor={COLORS.primary} />}
      >
        <View style={st.headerRow}>
          <TouchableOpacity onPress={() => goBackOr(router)} style={st.navBtn} accessibilityRole="button" accessibilityLabel={tr('Volver')}>
            <Ionicons name="arrow-back" size={20} color={COLORS.textMain} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={st.eyebrow}>CMW</Text>
            <Text style={st.title}>{tr('Panel de preinscripciones')}</Text>
            <Text style={st.sub}>{tr('Interno · cada exportación queda registrada')}</Text>
          </View>
        </View>

        {(loading || authLoading) && !data && (
          <View style={st.stateCard}><ActivityIndicator color={COLORS.primary} /></View>
        )}

        {!loading && denied && (
          <View style={st.stateCard} testID="cmw-panel-denied">
            <Ionicons name="lock-closed-outline" size={36} color={COLORS.textMuted} />
            <Text style={st.stateTitle}>{tr('Solo administradores')}</Text>
            <Text style={st.stateText}>{tr('Inicia sesión con una cuenta administradora de AMO.')}</Text>
            {!user && (
              <TouchableOpacity
                onPress={() => router.push({ pathname: '/login', params: { next: '/cmw-panel' } } as never)}
                style={st.primaryBtn} accessibilityRole="button"
              >
                <Text style={st.primaryBtnText}>{tr('Iniciar sesión')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {!loading && failed && !denied && (
          <View style={st.stateCard}>
            <Ionicons name="cloud-offline-outline" size={36} color={COLORS.textMuted} />
            <Text style={st.stateTitle}>{tr('No pudimos cargar el panel')}</Text>
            <TouchableOpacity onPress={load} style={st.primaryBtn} accessibilityRole="button">
              <Text style={st.primaryBtnText}>{tr('Reintentar')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {data && !denied && (
          <>
            {/* ── totals ── */}
            <View style={st.cardsRow}>
              <View style={st.kpi} testID="cmw-panel-total">
                <Text style={st.kpiN}>{data.total}</Text>
                <Text style={st.kpiLabel}>{tr('Preinscritos')}</Text>
              </View>
              <View style={st.kpi}>
                <Text style={st.kpiN}>{data.breakdown.marketing_opt_in}</Text>
                <Text style={st.kpiLabel}>{tr('Marketing')}{pct(data.breakdown.marketing_opt_in)}</Text>
              </View>
              <View style={st.kpi}>
                <Text style={st.kpiN}>{data.breakdown.linked_users}</Text>
                <Text style={st.kpiLabel}>{tr('Con cuenta')}{pct(data.breakdown.linked_users)}</Text>
              </View>
            </View>
            <View style={st.cardsRow}>
              <View style={st.kpi}>
                <Text style={st.kpiN}>{data.breakdown.profiles_complete}</Text>
                <Text style={st.kpiLabel}>{tr('Perfiles completos')}{pct(data.breakdown.profiles_complete)}</Text>
              </View>
              <View style={st.kpi}>
                <Text style={st.kpiN}>{data.breakdown.referred}</Text>
                <Text style={st.kpiLabel}>{tr('Por referido')}{pct(data.breakdown.referred)}</Text>
              </View>
              <View style={st.kpi}>
                <Text style={st.kpiN}>{data.csv_downloads_logged}</Text>
                <Text style={st.kpiLabel}>{tr('Exportaciones')}</Text>
              </View>
            </View>

            {/* ── funnel ── */}
            {funnel.length > 0 && (
              <View style={st.section}>
                <Text style={st.sectionTitle}>{tr('Embudo')}</Text>
                {funnel.map((f) => {
                  const max = Math.max(...funnel.map((x) => x.n), 1);
                  return (
                    <View key={f.event} style={st.funnelRow}>
                      <Text style={st.funnelLabel} numberOfLines={1}>{tr(f.label)}</Text>
                      <View style={st.funnelTrack}>
                        <View style={[st.funnelBar, { width: `${Math.max(4, (f.n / max) * 100)}%` }]} />
                      </View>
                      <Text style={st.funnelN}>{f.n}</Text>
                    </View>
                  );
                })}
              </View>
            )}

            {/* ── breakdowns ── */}
            {([
              ['Por fuente (utm_source)', data.breakdown.by_utm_source],
              ['Por código (ref)', data.breakdown.by_ref],
              ['Por ciudad', data.breakdown.by_city],
              ['Por país', data.breakdown.by_country],
            ] as Array<[string, Pair[]]>).map(([label, pairs]) => (
              <View key={label} style={st.section}>
                <Text style={st.sectionTitle}>{tr(label)}</Text>
                {(pairs || []).filter((p) => p.n > 0).slice(0, 10).map((p) => (
                  <View key={`${label}:${p.value || '—'}`} style={st.pairRow}>
                    <Text style={st.pairValue} numberOfLines={1}>{p.value || tr('(directo / sin dato)')}</Text>
                    <Text style={st.pairN}>{p.n}</Text>
                  </View>
                ))}
                {(pairs || []).filter((p) => p.n > 0).length === 0 && (
                  <Text style={st.emptyLine}>{tr('Sin datos todavía')}</Text>
                )}
              </View>
            ))}

            <View style={st.section}>
              <Text style={st.sectionTitle}>{tr('Por edad')}</Text>
              {bands.map((b) => (
                <View key={b.label} style={st.pairRow}>
                  <Text style={st.pairValue}>{b.label}</Text>
                  <Text style={st.pairN}>{b.n}</Text>
                </View>
              ))}
            </View>

            {/* ── CSV export ── */}
            <View style={st.section} testID="cmw-panel-csv">
              <Text style={st.sectionTitle}>{tr('Exportar CSV')}</Text>
              <Text style={st.hint}>{tr('Rango opcional (AAAA-MM-DD). La descarga queda registrada con fecha y filtros.')}</Text>
              <View style={st.dateRow}>
                <TextInput value={from} onChangeText={setFrom} placeholder="2026-10-01" placeholderTextColor={COLORS.textFaint}
                  autoCapitalize="none" autoCorrect={false} maxLength={10} style={st.dateInput} testID="cmw-panel-from" />
                <Text style={st.dateSep}>→</Text>
                <TextInput value={to} onChangeText={setTo} placeholder="2027-01-07" placeholderTextColor={COLORS.textFaint}
                  autoCapitalize="none" autoCorrect={false} maxLength={10} style={st.dateInput} testID="cmw-panel-to" />
              </View>
              <TouchableOpacity onPress={downloadCsv} disabled={csvBusy} style={[st.primaryBtn, { alignSelf: 'flex-start' }]} accessibilityRole="button" testID="cmw-panel-download">
                {csvBusy ? <ActivityIndicator size="small" color={COLORS.black} /> : (
                  <>
                    <Ionicons name="download-outline" size={15} color={COLORS.black} />
                    <Text style={st.primaryBtnText}>{tr('Descargar CSV')}</Text>
                  </>
                )}
              </TouchableOpacity>
              {!!csvMsg && <Text style={st.hint}>{tr(csvMsg)}</Text>}
            </View>

            {/* ── latest rows ── */}
            <View style={st.section}>
              <Text style={st.sectionTitle}>{tr('Últimas preinscripciones')}</Text>
              {recent.map((r) => (
                <View key={String(r.prereg_id)} style={st.rowCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.rowName} numberOfLines={1}>{String(r.full_name || '—')}</Text>
                    <Text style={st.rowMeta} numberOfLines={1}>
                      {String(r.email || '')} · {String(r.city || '—')}{r.country ? `, ${String(r.country)}` : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={st.rowMeta}>{String(r.created_at || '').slice(0, 10)}</Text>
                    <Text style={st.rowSrc} numberOfLines={1}>
                      {String((r.source as Record<string, unknown>)?.utm_source || (r.source as Record<string, unknown>)?.ref || 'directo')}
                    </Text>
                  </View>
                </View>
              ))}
              {recent.length === 0 && <Text style={st.emptyLine}>{tr('Sin preinscripciones todavía')}</Text>}
            </View>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { paddingBottom: SPACING.xxl, maxWidth: 760, width: '100%', alignSelf: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.sm },
  navBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.hairline, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { ...TYPE.overline, color: COLORS.mustard, marginTop: 4 },
  title: { ...TYPE.title1, color: COLORS.textMain, marginTop: 2 },
  sub: { ...TYPE.subhead, color: COLORS.textMuted, marginTop: 4 },

  stateCard: { marginHorizontal: SPACING.lg, marginTop: SPACING.lg, padding: SPACING.xl, alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.hairline },
  stateTitle: { ...TYPE.headline, color: COLORS.textMain, textAlign: 'center' },
  stateText: { ...TYPE.subhead, color: COLORS.textMuted, textAlign: 'center' },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SPACING.sm, minHeight: 44, paddingHorizontal: SPACING.lg, paddingVertical: 12, borderRadius: RADIUS.full, backgroundColor: COLORS.primary },
  primaryBtnText: { fontSize: 14, color: COLORS.black, ...FONTS.bold },

  cardsRow: { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.lg, marginTop: SPACING.sm },
  kpi: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.hairline, paddingVertical: 14, paddingHorizontal: 12 },
  kpiN: { fontSize: 24, lineHeight: 30, color: COLORS.textMain, ...FONTS.bold, fontVariant: ['tabular-nums'] },
  kpiLabel: { fontSize: 11.5, lineHeight: 15, color: COLORS.textMuted, ...FONTS.medium, marginTop: 4 },

  section: { marginHorizontal: SPACING.lg, marginTop: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.hairline, padding: SPACING.md },
  sectionTitle: { ...TYPE.headline, color: COLORS.textMain, marginBottom: SPACING.sm },
  hint: { fontSize: 12, lineHeight: 16, color: COLORS.textFaint, ...FONTS.medium, marginBottom: 8 },

  funnelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  funnelLabel: { width: 150, fontSize: 12, color: COLORS.textMuted, ...FONTS.medium },
  funnelTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: COLORS.surfaceAlt, overflow: 'hidden' },
  funnelBar: { height: 10, borderRadius: 5, backgroundColor: COLORS.primary },
  funnelN: { width: 44, textAlign: 'right', fontSize: 12.5, color: COLORS.textMain, ...FONTS.bold, fontVariant: ['tabular-nums'] },

  pairRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.hairline },
  pairValue: { flex: 1, fontSize: 13, color: COLORS.textMain, ...FONTS.medium },
  pairN: { fontSize: 13, color: COLORS.textMuted, ...FONTS.bold, fontVariant: ['tabular-nums'] },
  emptyLine: { fontSize: 12.5, color: COLORS.textFaint, ...FONTS.medium },

  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  dateInput: { flex: 1, minHeight: 44, borderRadius: 12, paddingHorizontal: 12, fontSize: 14, color: COLORS.textMain, backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.hairline },
  dateSep: { color: COLORS.textFaint },

  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.hairline },
  rowName: { fontSize: 13.5, color: COLORS.textMain, ...FONTS.bold },
  rowMeta: { fontSize: 11.5, color: COLORS.textMuted, ...FONTS.medium, marginTop: 2 },
  rowSrc: { fontSize: 11.5, color: COLORS.mustard, ...FONTS.medium, marginTop: 2, maxWidth: 120 },
});
