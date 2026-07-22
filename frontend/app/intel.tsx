import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, RefreshControl, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { API_BASE } from '../src/constants/api';

const KEY_STORAGE = 'amo_intel_key';
const GOLD = '#FBBF24';

async function intelGet(path: string, key: string) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${key}` } });
  if (res.status === 403) throw new Error('forbidden');
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.json();
}

export default function IntelScreen() {
  const router = useRouter();
  const [accessKey, setAccessKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [keyError, setKeyError] = useState(false);
  const [overview, setOverview] = useState<any>(null);
  const [demand, setDemand] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [refreshingReport, setRefreshingReport] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY_STORAGE).then(k => { if (k) setAccessKey(k); });
  }, []);

  const load = useCallback(async (key: string) => {
    setLoading(true);
    setKeyError(false);
    try {
      const [ov, dm] = await Promise.all([
        intelGet('/admin/intel/overview', key),
        intelGet('/admin/demand', key),
      ]);
      setOverview(ov);
      setDemand(dm);
      await AsyncStorage.setItem(KEY_STORAGE, key);
      setAccessKey(key);
    } catch (e: any) {
      if (e?.message === 'forbidden') {
        setKeyError(true);
        setAccessKey(null);
        await AsyncStorage.removeItem(KEY_STORAGE);
      }
      console.error('[Intel]', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (accessKey && !overview) load(accessKey); }, [accessKey]);

  const regenerateReport = async () => {
    if (!accessKey || refreshingReport) return;
    setRefreshingReport(true);
    try {
      const res = await fetch(`${API_BASE}/admin/demand/refresh?days=30`, {
        method: 'POST', headers: { Authorization: `Bearer ${accessKey}` },
      });
      if (res.ok) setDemand(await res.json());
    } catch (e) { console.error('[Intel] refresh', e); }
    setRefreshingReport(false);
  };

  // ── Access gate ──
  if (!accessKey || (!overview && !loading)) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.gate}>
          <View style={styles.gateIcon}><Ionicons name="analytics" size={28} color={GOLD} /></View>
          <Text style={styles.gateTitle}>AMO INTEL</Text>
          <Text style={styles.gateSub}>Inteligencia de demanda y comportamiento</Text>
          <TextInput
            style={[styles.gateInput, keyError && { borderColor: '#EF4444' }]}
            placeholder="Clave de acceso"
            placeholderTextColor={COLORS.textMuted}
            value={keyInput}
            onChangeText={setKeyInput}
            secureTextEntry
            autoCapitalize="none"
            onSubmitEditing={() => keyInput.trim() && load(keyInput.trim())}
          />
          {keyError ? <Text style={styles.gateError}>Clave incorrecta</Text> : null}
          <TouchableOpacity style={styles.gateBtn} onPress={() => keyInput.trim() && load(keyInput.trim())}>
            {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.gateBtnText}>Entrar</Text>}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (loading && !overview) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator color={GOLD} /></View>
      </SafeAreaView>
    );
  }

  const k = overview?.kpis || {};
  const report = demand?.report || {};
  const leads: any[] = report.leads || [];
  const gaps: any[] = report.gaps || [];
  const fixes: any[] = report.taxonomy_fixes || [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => accessKey && load(accessKey)} tintColor={GOLD} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color={COLORS.textMain} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.h1}>AMO INTEL</Text>
            <Text style={styles.h1Sub}>Lo que la ciudad busca — y todavía no encuentra</Text>
          </View>
          <Ionicons name="analytics" size={22} color={GOLD} />
        </View>

        {/* KPIs */}
        <View style={styles.kpiGrid}>
          {[
            { label: 'Búsquedas 30d', value: k.searches_30d, icon: 'search' },
            { label: 'Taps en resultados', value: k.result_taps_total, icon: 'finger-print' },
            { label: 'Chats concierge 30d', value: k.chat_sessions_30d, icon: 'chatbubbles' },
            { label: 'Pulsos activos hoy', value: k.active_pulses, icon: 'flash' },
            { label: 'Partners', value: k.partners, icon: 'business' },
            { label: 'Con tags', value: k.partners_tagged, icon: 'pricetags' },
          ].map(item => (
            <View key={item.label} style={styles.kpiCard}>
              <Ionicons name={item.icon as any} size={14} color={GOLD} />
              <Text style={styles.kpiValue}>{item.value ?? '—'}</Text>
              <Text style={styles.kpiLabel}>{item.label}</Text>
            </View>
          ))}
        </View>

        {/* Leads para Franck */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>🎯 Leads comerciales</Text>
          <TouchableOpacity style={styles.regenBtn} onPress={regenerateReport} disabled={refreshingReport}>
            {refreshingReport
              ? <ActivityIndicator size="small" color={GOLD} />
              : <><Ionicons name="refresh" size={12} color={GOLD} /><Text style={styles.regenText}>Regenerar</Text></>}
          </TouchableOpacity>
        </View>
        {demand?.generated_at ? (
          <Text style={styles.metaLine}>Reporte del {String(demand.generated_at).slice(0, 10)} · ventana {demand.window_days}d · {demand?.inputs?.total_searches ?? '—'} búsquedas analizadas</Text>
        ) : null}
        {leads.length === 0 ? <Text style={styles.empty}>Sin reporte todavía — toca Regenerar</Text> : leads.map((l, i) => (
          <View key={i} style={styles.leadCard}>
            <View style={styles.leadTop}>
              <View style={styles.rankBadge}><Text style={styles.rankText}>#{l.rank ?? i + 1}</Text></View>
              <Text style={styles.leadType}>{l.business_type}</Text>
              <View style={styles.reqBadge}><Text style={styles.reqText}>{l.est_requests ?? '—'} req</Text></View>
            </View>
            {l.pitch_es ? <Text style={styles.leadPitch}>{l.pitch_es}</Text> : null}
            {Array.isArray(l.demand_evidence) && l.demand_evidence.length ? (
              <Text style={styles.leadEvidence} numberOfLines={2}>Evidencia: {l.demand_evidence.slice(0, 3).join(' · ')}</Text>
            ) : null}
          </View>
        ))}

        {/* Gaps */}
        <Text style={styles.sectionTitle}>🕳️ Demanda sin cubrir</Text>
        {gaps.map((g, i) => (
          <View key={i} style={styles.row}>
            <View style={[styles.sevDot, { backgroundColor: g.severity === 'high' ? '#EF4444' : g.severity === 'medium' ? GOLD : COLORS.textMuted }]} />
            <Text style={styles.rowMain} numberOfLines={2}>{g.demand}</Text>
            <Text style={styles.rowSide}>{g.est_requests ?? '—'}</Text>
          </View>
        ))}

        {/* Taxonomy fixes */}
        {fixes.length > 0 ? (<>
          <Text style={styles.sectionTitle}>🔧 Existe pero no se encuentra</Text>
          {fixes.map((t, i) => (
            <View key={i} style={styles.fixCard}>
              <Text style={styles.fixQuery}>"{t.query_pattern}"</Text>
              <Text style={styles.fixDetail} numberOfLines={2}>{t.should_match}</Text>
            </View>
          ))}
        </>) : null}

        {/* Top queries */}
        <Text style={styles.sectionTitle}>🔍 Top búsquedas 30d</Text>
        {(overview?.top_queries || []).map((q: any, i: number) => (
          <View key={i} style={styles.row}>
            <Text style={[styles.rowMain, q.zero && { color: '#EF4444' }]} numberOfLines={1}>
              {q.query}{q.zero ? '  · SIN RESULTADOS' : ''}
            </Text>
            <Text style={styles.rowSide}>{q.count}</Text>
          </View>
        ))}

        {/* CTR movers */}
        {(overview?.ctr_movers || []).length > 0 ? (<>
          <Text style={styles.sectionTitle}>📈 Más elegidos en búsqueda</Text>
          {(overview.ctr_movers).map((m: any, i: number) => (
            <View key={i} style={styles.row}>
              <Text style={styles.rowMain} numberOfLines={1}>{m.name}</Text>
              <Text style={styles.rowSide}>{m.taps}/{m.imp}</Text>
            </View>
          ))}
        </>) : null}

        {/* Active pulses */}
        <Text style={styles.sectionTitle}>⚡ Pulsos activos hoy</Text>
        {(overview?.active_pulses || []).length === 0
          ? <Text style={styles.empty}>Ningún negocio ha enviado novedades hoy</Text>
          : (overview.active_pulses).map((p: any, i: number) => (
            <View key={i} style={styles.row}>
              <Text style={styles.rowMain} numberOfLines={1}>{p.partner_name} — {p.title}</Text>
              <Text style={styles.rowSide}>{p.source === 'whatsapp' ? 'WA' : 'web'}</Text>
            </View>
          ))}

        <Text style={styles.footer}>AMO Intel · datos en vivo del flywheel · {String(overview?.generated_at || '').slice(0, 16).replace('T', ' ')} UTC</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },
  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.xl, gap: SPACING.sm },
  gateIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(251,191,36,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.sm },
  gateTitle: { fontSize: 24, color: COLORS.textMain, ...FONTS.bold, letterSpacing: 3 },
  gateSub: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, marginBottom: SPACING.lg },
  gateInput: { width: '100%', maxWidth: 340, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, paddingHorizontal: SPACING.md, paddingVertical: 12, color: COLORS.textMain, fontSize: 14 },
  gateError: { fontSize: 12, color: '#EF4444', ...FONTS.medium },
  gateBtn: { width: '100%', maxWidth: 340, backgroundColor: GOLD, borderRadius: RADIUS.lg, paddingVertical: 13, alignItems: 'center', marginTop: SPACING.sm },
  gateBtnText: { fontSize: 14, color: '#000', ...FONTS.bold },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.md },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  h1: { fontSize: 20, color: COLORS.textMain, ...FONTS.bold, letterSpacing: 2 },
  h1Sub: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.md },
  kpiCard: { flexBasis: '30%', flexGrow: 1, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, padding: SPACING.md, gap: 4 },
  kpiValue: { fontSize: 20, color: COLORS.textMain, ...FONTS.bold },
  kpiLabel: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SPACING.lg },
  sectionTitle: { fontSize: 15, color: COLORS.textMain, ...FONTS.bold, marginTop: SPACING.lg, marginBottom: SPACING.sm },
  regenBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: 'rgba(251,191,36,0.4)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  regenText: { fontSize: 11, color: GOLD, ...FONTS.medium },
  metaLine: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginBottom: SPACING.sm },
  leadCard: { backgroundColor: 'rgba(251,191,36,0.05)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.18)', borderRadius: RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm, gap: 6 },
  leadTop: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  rankBadge: { backgroundColor: GOLD, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  rankText: { fontSize: 11, color: '#000', ...FONTS.bold },
  leadType: { flex: 1, fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  reqBadge: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  reqText: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium },
  leadPitch: { fontSize: 12, color: COLORS.textMain, ...FONTS.regular, lineHeight: 18 },
  leadEvidence: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, fontStyle: 'italic' },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  sevDot: { width: 8, height: 8, borderRadius: 4 },
  rowMain: { flex: 1, fontSize: 13, color: COLORS.textMain, ...FONTS.regular },
  rowSide: { fontSize: 12, color: GOLD, ...FONTS.bold },
  fixCard: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, padding: SPACING.sm, marginBottom: 6, gap: 2 },
  fixQuery: { fontSize: 12, color: GOLD, ...FONTS.medium },
  fixDetail: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  empty: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, fontStyle: 'italic', paddingVertical: SPACING.sm },
  footer: { fontSize: 10, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', marginTop: SPACING.xl },
});
