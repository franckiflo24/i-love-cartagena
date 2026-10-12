// DROP 3A — city-events review queue: every ingested/captured row waits here
// (status review) until a human promotes it. Actions wire to the EXISTING gated
// transitions — approve_event re-runs the honesty gate server-side, so this
// screen can never publish a source-less, Spain-geo or evidence-less row; it
// only surfaces the server's refusal honestly.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS, TYPE } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useTr } from '../../src/i18n/autoTr';
import { useAuth } from '../../src/context/AuthContext';
import { goBackOr } from '../../src/lib/nav';
import { openExternal } from '../../src/lib/cityModules';

type Row = {
  event_id: string;
  title?: { es?: string } | string;
  category?: string;
  start_date?: string | null; start_time?: string | null;
  date_tbc_note?: { es?: string } | null;
  venue_name?: string;
  lat?: number; lng?: number;
  source_name?: string; source_url?: string;
  confidence?: string; status_reason?: string | null;
  possible_duplicate_of?: string | null;
  capture?: { note?: string | null; photo_url?: string | null; by?: string; at?: string } | null;
  updated_at?: string;
};

const ERR_COPY: Record<string, string> = {
  no_source: 'Sin fuente citable — no se puede publicar.',
  country_fail: 'Falló el filtro geográfico (señales fuera de Cartagena).',
  merged_duplicate: 'Ya fue fusionado con otro evento.',
  no_evidence: 'Sin evidencia verificable (se necesita una página tier ≤ 3).',
  aggregator_only: 'Solo hay agregadores como evidencia — verifica con una fuente directa.',
  gate_refuses: 'La puerta de verificación lo rechazó',
};

function titleOf(r: Row): string {
  return (typeof r.title === 'object' ? r.title?.es : r.title) || r.event_id;
}

export default function AdminEventosQueue() {
  const tr = useTr();
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [rejects, setRejects] = useState<number>(0);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null); // `${action}:${id}` two-tap confirm
  const [datesFor, setDatesFor] = useState<string | null>(null);
  const [dDate, setDDate] = useState(''); const [dTime, setDTime] = useState(''); const [dReason, setDReason] = useState('');
  const [rowMsg, setRowMsg] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!authLoading && (!user || !user.is_admin)) router.replace('/');
  }, [user, authLoading, router]);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/admin/events/review');
      setRows(Array.isArray(res?.rows) ? res.rows : []);
      setRejects(Array.isArray(res?.rejects) ? res.rejects.length : 0);
      setLoadError(false);
    } catch (e) {
      console.error('[AdminEventos] load', e);
      setLoadError(true); // never paint "todo en orden" over a failed fetch
    }
    setRefreshing(false);
  }, []);

  useEffect(() => { if (user?.is_admin) load(); }, [user, load]);

  const act = useCallback(async (id: string, action: 'approve' | 'reject' | 'merge', dup?: string | null) => {
    const key = `${action}:${id}`;
    if (confirmKey !== key) { setConfirmKey(key); return; }
    setConfirmKey(null);
    setBusyId(id);
    setRowMsg((m) => ({ ...m, [id]: '' }));
    try {
      if (action === 'approve') {
        const res = await api.post(`/admin/events/${encodeURIComponent(id)}/approve`);
        setRowMsg((m) => ({ ...m, [id]: `✓ ${tr(res?.status === 'date_tbc' ? 'Publicado como fecha por confirmar' : 'Publicado')}` }));
      } else {
        const note = action === 'merge' ? `duplicado de ${dup}` : 'rechazado en cola';
        await api.post(`/admin/events/${encodeURIComponent(id)}/hide`, { note });
        setRowMsg((m) => ({ ...m, [id]: `✓ ${tr(action === 'merge' ? 'Fusionado (oculto)' : 'Rechazado')}` }));
      }
      setTimeout(load, 600);
    } catch (e: unknown) {
      const detail = (e as { data?: { detail?: { error?: string; hint?: string } } })?.data?.detail;
      const base = ERR_COPY[detail?.error || ''] || 'No se pudo aplicar.';
      setRowMsg((m) => ({ ...m, [id]: `✕ ${tr(base)}${detail?.hint ? ` · ${detail.hint}` : ''}` }));
      console.error('[AdminEventos] act', e);
    } finally {
      setBusyId(null);
    }
  }, [confirmKey, load, tr]);

  const sendDates = useCallback(async (r: Row) => {
    setBusyId(r.event_id);
    setRowMsg((m) => ({ ...m, [r.event_id]: '' }));
    try {
      await api.post(`/admin/events/${encodeURIComponent(r.event_id)}/set-dates`, {
        start_date: dDate.trim(), end_date: dDate.trim(),
        start_time: dTime.trim() || undefined,
        source_url: r.source_url, reason: dReason.trim(),
      });
      setRowMsg((m) => ({ ...m, [r.event_id]: `✓ ${tr('Fechas fijadas y publicado')}` }));
      setDatesFor(null); setDDate(''); setDTime(''); setDReason('');
      setTimeout(load, 600);
    } catch (e: unknown) {
      const detail = (e as { data?: { detail?: { error?: string } } })?.data?.detail;
      setRowMsg((m) => ({ ...m, [r.event_id]: `✕ ${detail?.error || tr('No se pudo aplicar.')}` }));
    } finally {
      setBusyId(null);
    }
  }, [dDate, dTime, dReason, load, tr]);

  if (authLoading || !user?.is_admin) {
    return <SafeAreaView style={styles.container}><View style={styles.center}><ActivityIndicator color={COLORS.primary} /></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => goBackOr(router)} style={styles.backBtn} accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{tr('Cola de eventos')}</Text>
        <TouchableOpacity onPress={() => router.push('/admin/captura' as never)} style={styles.captureLink} accessibilityRole="button">
          <Ionicons name="camera" size={15} color={COLORS.primary} />
          <Text style={styles.captureLinkText}>{tr('Capturar')}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.primary} />}
      >
        {loadError && (
          <View style={styles.errorCard}>
            <Ionicons name="cloud-offline-outline" size={18} color={COLORS.coral} />
            <Text style={styles.errorText}>{tr('No se pudo cargar la cola')}</Text>
            <TouchableOpacity onPress={load}><Text style={styles.retry}>{tr('reintentar')}</Text></TouchableOpacity>
          </View>
        )}
        {rows === null && !loadError && <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />}
        {rows !== null && rows.length === 0 && !loadError && (
          <View style={styles.center}>
            <Ionicons name="checkmark-done-circle-outline" size={44} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>{tr('Nada en revisión')}</Text>
          </View>
        )}

        {(rows || []).map((r) => {
          const isCapture = r.status_reason === 'field_capture' || !!r.capture;
          const when = r.start_date
            ? `${r.start_date}${r.start_time ? ` · ${r.start_time}` : ''}`
            : tr('Por confirmar');
          const pinned = typeof r.lat === 'number' && typeof r.lng === 'number';
          const msg = rowMsg[r.event_id];
          return (
            <View key={r.event_id} style={styles.card} testID={`queue-row-${r.event_id}`}>
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>{titleOf(r)}</Text>
                {isCapture && (
                  <View style={styles.badge}><Ionicons name="camera" size={11} color={COLORS.primary} /><Text style={styles.badgeText}>{tr('Captura')}</Text></View>
                )}
              </View>
              <Text style={styles.meta}>📅 {when} · {r.category || '—'} · {r.confidence || 'VERIFY'}</Text>
              <Text style={styles.meta}>
                {pinned ? '📍 ' : '○ '}
                {r.venue_name || tr('Lugar por confirmar')}
                {pinned ? ` (${tr('se fijará en el mapa')})` : ` (${tr('sin ubicación fija — se guarda el texto')})`}
              </Text>
              {!!r.source_url && (
                <TouchableOpacity onPress={() => openExternal(r.source_url as string)} accessibilityRole="link">
                  <Text style={styles.sourceLink}>🔗 {r.source_name || r.source_url}</Text>
                </TouchableOpacity>
              )}
              {!!r.capture?.note && <Text style={styles.note}>“{r.capture.note}”</Text>}
              {!!r.capture?.photo_url && (
                <TouchableOpacity onPress={() => openExternal(r.capture?.photo_url as string)} accessibilityRole="link">
                  <Text style={styles.sourceLink}>🖼 {tr('Ver foto de evidencia')}</Text>
                </TouchableOpacity>
              )}
              {!!r.possible_duplicate_of && (
                <View style={styles.dupBanner}>
                  <Ionicons name="alert-circle-outline" size={14} color={COLORS.mustard} />
                  <Text style={styles.dupText}>{tr('Posible duplicado de')} {r.possible_duplicate_of}</Text>
                </View>
              )}
              {!!msg && <Text style={[styles.rowMsg, msg.startsWith('✕') && { color: COLORS.coral }]}>{msg}</Text>}

              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.btn, styles.approve]}
                  disabled={busyId === r.event_id}
                  onPress={() => act(r.event_id, 'approve')}
                  accessibilityRole="button"
                  testID={`queue-approve-${r.event_id}`}
                >
                  <Text style={styles.btnTextDark}>{confirmKey === `approve:${r.event_id}` ? tr('¿Confirmar?') : tr('Aprobar')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.ghost]}
                  disabled={busyId === r.event_id}
                  onPress={() => { setDatesFor(datesFor === r.event_id ? null : r.event_id); setDDate(r.start_date || ''); setDTime(r.start_time || ''); }}
                  accessibilityRole="button"
                >
                  <Text style={styles.btnText}>{tr('Fechas')}</Text>
                </TouchableOpacity>
                {!!r.possible_duplicate_of && (
                  <TouchableOpacity
                    style={[styles.btn, styles.ghost]}
                    disabled={busyId === r.event_id}
                    onPress={() => act(r.event_id, 'merge', r.possible_duplicate_of)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.btnText}>{confirmKey === `merge:${r.event_id}` ? tr('¿Confirmar?') : tr('Fusionar')}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.btn, styles.reject]}
                  disabled={busyId === r.event_id}
                  onPress={() => act(r.event_id, 'reject')}
                  accessibilityRole="button"
                >
                  <Text style={styles.rejectText}>{confirmKey === `reject:${r.event_id}` ? tr('¿Confirmar?') : tr('Rechazar')}</Text>
                </TouchableOpacity>
              </View>

              {datesFor === r.event_id && (
                <View style={styles.datesBox}>
                  <TextInput style={styles.input} value={dDate} onChangeText={setDDate} placeholder="2026-11-11" placeholderTextColor={COLORS.textFaint} maxLength={10} />
                  <TextInput style={styles.input} value={dTime} onChangeText={setDTime} placeholder="19:00" placeholderTextColor={COLORS.textFaint} maxLength={5} />
                  <TextInput style={styles.input} value={dReason} onChangeText={setDReason} placeholder={tr('Motivo (requerido)')} placeholderTextColor={COLORS.textFaint} maxLength={120} />
                  <TouchableOpacity
                    style={[styles.btn, styles.approve, !( /^\d{4}-\d{2}-\d{2}$/.test(dDate.trim()) && dReason.trim().length >= 3) && { opacity: 0.4 }]}
                    disabled={!(/^\d{4}-\d{2}-\d{2}$/.test(dDate.trim()) && dReason.trim().length >= 3) || busyId === r.event_id}
                    onPress={() => sendDates(r)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.btnTextDark}>{tr('Fijar y publicar')}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}

        {rows !== null && (
          <Text style={styles.fine}>
            {tr('Aprobar re-ejecuta la puerta de verificación: nada sin fuente ni fuera de Cartagena se publica.')}
            {rejects > 0 ? ` · ${rejects} ${tr('rechazos recientes del pipeline')}` : ''}
          </Text>
        )}
        <View style={{ height: 60 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 60 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...TYPE.title3, color: COLORS.textMain, flex: 1 },
  captureLink: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44, paddingHorizontal: 10 },
  captureLinkText: { fontSize: 13, color: COLORS.primary, ...FONTS.bold },
  body: { paddingHorizontal: SPACING.lg },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: `${COLORS.coral}14`, borderWidth: 1, borderColor: `${COLORS.coral}55`, borderRadius: RADIUS.md, padding: 12, marginTop: SPACING.md },
  errorText: { flex: 1, fontSize: 13, color: COLORS.textMain, ...FONTS.semibold },
  retry: { fontSize: 13, color: COLORS.primary, ...FONTS.bold },
  emptyText: { ...TYPE.subhead, color: COLORS.textMuted },
  card: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.hairline, borderRadius: RADIUS.lg, padding: SPACING.md, marginTop: SPACING.md, gap: 6 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { flex: 1, fontSize: 15.5, color: COLORS.textMain, ...FONTS.bold },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: `${COLORS.primary}1A`, borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10.5, color: COLORS.primary, ...FONTS.bold },
  meta: { fontSize: 12.5, color: COLORS.textMuted, ...FONTS.medium },
  sourceLink: { fontSize: 12.5, color: COLORS.official, ...FONTS.semibold, textDecorationLine: 'underline', paddingVertical: 3 },
  note: { fontSize: 12.5, color: COLORS.textMuted, ...FONTS.regular, fontStyle: 'italic' },
  dupBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${COLORS.mustard}14`, borderWidth: 1, borderColor: `${COLORS.mustard}55`, borderRadius: RADIUS.md, padding: 8 },
  dupText: { flex: 1, fontSize: 12, color: COLORS.mustard, ...FONTS.semibold },
  rowMsg: { fontSize: 12.5, color: '#22C55E', ...FONTS.semibold },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  btn: { minHeight: 40, borderRadius: RADIUS.full, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  approve: { backgroundColor: COLORS.primary },
  ghost: { borderWidth: 1, borderColor: COLORS.hairline, backgroundColor: COLORS.background },
  reject: { borderWidth: 1, borderColor: `${COLORS.coral}66`, backgroundColor: `${COLORS.coral}10` },
  btnTextDark: { fontSize: 13, color: COLORS.black, ...FONTS.bold },
  btnText: { fontSize: 13, color: COLORS.textMain, ...FONTS.semibold },
  rejectText: { fontSize: 13, color: COLORS.coral, ...FONTS.semibold },
  datesBox: { gap: 8, marginTop: 6 },
  input: { backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.hairline, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: COLORS.textMain, minHeight: 42 },
  fine: { fontSize: 11.5, color: COLORS.textFaint, ...FONTS.medium, textAlign: 'center', marginTop: SPACING.lg },
});
