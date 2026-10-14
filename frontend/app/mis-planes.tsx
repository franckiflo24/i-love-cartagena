// /mis-planes — P1 "Mis Planes": the user's reservas AND entradas as ONE chronological
// view (GET /api/me/planes does the merge server-side; statuses arrive VERBATIM from each
// store and render through each lane's own vocabulary — nothing here invents a state).
// Tapping a row opens its REAL existing detail: /reservations?highlight=<id> for a
// reserva (that screen keeps its cancel / payment actions), /ticket/<id> for an entrada.
//
// Transport is fetchT + getToken (the tickets.ts rationale): this is a user-scoped list,
// and api.get would file it in the persistent swr cache where it outlives a logout.
//
// Honest states (same contract as /tickets): `data` is null until the first answer; a
// failed refresh keeps the list and says so; 401/403 is the sign-in state, never an
// error dialog; the empty state is "aún no tienes planes", never a placeholder plan.
import React, { useCallback, useRef, useState } from 'react';
import {
  RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Head from '../src/components/WebHead';
import { Skeleton } from '../src/components/Skeleton';
import { STATUS_META } from './reservations/index';
import { COLORS, FONTS, RADIUS, SPACING, TYPE } from '../src/constants/theme';
import {
  AMO_CLIENT_HEADERS, API_BASE, GET_TIMEOUT_MS, fetchT, getToken,
} from '../src/constants/api';
import { useAuth } from '../src/context/AuthContext';
import { useLang } from '../src/context/LanguageContext';
import { useTr } from '../src/i18n/autoTr';
import { formatShortDate } from '../src/lib/formatDate';
import { goBackOr } from '../src/lib/nav';

type PlanKind = 'reserva' | 'entrada';
type Plan = {
  kind: PlanKind; id: string; title: string; subtitle: string;
  date: string; time: string; when: string; status: string; href: string; image_url: string;
};
type Planes = { upcoming: Plan[]; past: Plan[] };

// Defensive parse: an unexpected body becomes an empty-shape error, never a crash
// and never a guessed plan.
function parsePlanes(body: unknown): Planes | null {
  if (!body || typeof body !== 'object') return null;
  const read = (v: unknown): Plan[] => {
    if (!Array.isArray(v)) return [];
    const out: Plan[] = [];
    for (const r of v) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      const kind = o.kind === 'reserva' || o.kind === 'entrada' ? o.kind : null;
      const id = typeof o.id === 'string' && o.id ? o.id : null;
      const href = typeof o.href === 'string' && o.href.startsWith('/') ? o.href : null;
      if (!kind || !id || !href) continue;
      const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '');
      out.push({
        kind, id, href,
        title: s('title'), subtitle: s('subtitle'), date: s('date'), time: s('time'),
        when: s('when'), status: s('status'), image_url: s('image_url'),
      });
    }
    return out;
  };
  const b = body as Record<string, unknown>;
  if (!('upcoming' in b) || !('past' in b)) return null;
  return { upcoming: read(b.upcoming), past: read(b.past) };
}

function PlanRow({ plan, onOpen }: { plan: Plan; onOpen: (href: string) => void }) {
  const tr = useTr();
  const { lang } = useLang();
  const isTicket = plan.kind === 'entrada';
  const used = isTicket && plan.status === 'used';
  const rMeta = !isTicket ? STATUS_META[plan.status] : undefined;
  const statusLabel = isTicket
    ? (used ? tr('Utilizada') : tr('Activa'))
    : (rMeta?.label || plan.status);
  const statusColor = isTicket ? (used ? COLORS.textMuted : COLORS.primary) : (rMeta?.color || COLORS.textMuted);
  const statusBg = isTicket
    ? (used ? 'rgba(148,163,184,0.12)' : 'rgba(18,181,165,0.12)')
    : (rMeta?.bg || 'rgba(148,163,184,0.12)');
  const when = [formatShortDate(plan.date, lang), plan.time].filter(Boolean).join(' · ');
  return (
    <TouchableOpacity
      style={s.row}
      onPress={() => onOpen(plan.href)}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={[plan.kind === 'entrada' ? tr('Entrada') : tr('Reserva'), plan.title, when, statusLabel].filter(Boolean).join(', ')}
      testID={`plan-row-${plan.id}`}
    >
      <View style={[s.kindBubble, isTicket ? s.kindTicket : s.kindReserva]}>
        <Ionicons name={isTicket ? 'ticket-outline' : 'restaurant-outline'} size={18}
          color={isTicket ? COLORS.primary : '#22C55E'} />
      </View>
      <View style={s.rowBody}>
        <View style={s.kindLine}>
          <Text style={[s.kindTag, { color: isTicket ? COLORS.primary : '#22C55E' }]}>
            {isTicket ? tr('Entrada') : tr('Reserva')}
          </Text>
          {!!when && <Text style={s.rowWhen} numberOfLines={1}>{when}</Text>}
        </View>
        <Text style={s.rowTitle} numberOfLines={2}>{plan.title}</Text>
        {!!plan.subtitle && <Text style={s.rowMeta} numberOfLines={1}>{plan.subtitle}</Text>}
      </View>
      <View style={s.rowRight}>
        <View style={[s.chip, { backgroundColor: statusBg, borderColor: statusColor }]}>
          <Text style={[s.chipText, { color: statusColor }]} numberOfLines={1}>{statusLabel}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

export default function MisPlanesScreen() {
  const tr = useTr();
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const userId = user ? user.user_id : null;

  const [data, setData] = useState<Planes | null>(null);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [loadError, setLoadError] = useState(false);
  const [authLost, setAuthLost] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const gen = ++generation.current;
    try {
      const token = await getToken();
      if (!token) { if (gen === generation.current) setAuthLost(true); return; }
      const res = await fetchT(`${API_BASE}/me/planes`, {
        headers: { Authorization: `Bearer ${token}`, ...AMO_CLIENT_HEADERS },
      }, GET_TIMEOUT_MS);
      if (gen !== generation.current) return;
      if (res.status === 401 || res.status === 403) { setAuthLost(true); return; }
      const parsed = res.ok ? parsePlanes(await res.json().catch(() => null)) : null;
      if (gen !== generation.current) return;
      if (parsed) { setData(parsed); setLoadError(false); setAuthLost(false); }
      else setLoadError(true);
    } catch {
      if (gen === generation.current) setLoadError(true);
    } finally {
      if (gen === generation.current) setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { if (userId) load(); }, [userId, load]));

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);
  const open = useCallback((href: string) => router.push(href as never), [router]);

  const signedOut = !isLoading && (!user || authLost);
  const list = data ? (tab === 'upcoming' ? data.upcoming : data.past) : null;

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <Head><title>Mis Planes · AMO</title></Head>
      <View style={s.header}>
        <TouchableOpacity onPress={() => goBackOr(router, '/')} style={s.backBtn}
          accessibilityRole="button" accessibilityLabel={tr('Volver')}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={s.title}>{tr('Mis planes')}</Text>
        <View style={s.backBtn} />
      </View>

      {signedOut ? (
        <View style={s.stateWrap}>
          <Ionicons name="calendar-outline" size={30} color={COLORS.textMuted} />
          <Text style={s.stateTitle}>{tr('Inicia sesión para ver tus planes')}</Text>
          <TouchableOpacity style={s.primaryBtn} onPress={() => router.push('/login?next=/mis-planes' as never)}
            accessibilityRole="button">
            <Text style={s.primaryBtnText}>{tr('Iniciar sesión')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        >
          <View style={s.tabs}>
            {(['upcoming', 'past'] as const).map((t) => (
              <TouchableOpacity key={t} style={[s.tab, tab === t && s.tabActive]} onPress={() => setTab(t)}
                accessibilityRole="button" testID={`planes-tab-${t}`}>
                <Text style={[s.tabText, tab === t && s.tabTextActive]}>
                  {t === 'upcoming' ? tr('Próximas') : tr('Pasadas')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {loadError && (
            <View style={s.errorLine}>
              <Text style={s.errorText}>{tr('No se pudo cargar')}</Text>
              <TouchableOpacity onPress={load} accessibilityRole="button">
                <Text style={s.errorRetry}>{tr('reintentar')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {list === null ? (
            <View style={s.skeletons}>
              {[0, 1, 2].map((i) => <Skeleton key={i} height={74} borderRadius={RADIUS.lg} style={{ marginBottom: SPACING.sm }} />)}
            </View>
          ) : list.length === 0 ? (
            <View style={s.stateWrap} testID="planes-empty">
              <Ionicons name="calendar-outline" size={30} color={COLORS.textMuted} />
              <Text style={s.stateTitle}>{tr('Aún no tienes planes')}</Text>
              <Text style={s.stateText}>{tr('Tus reservas y entradas aparecerán aquí')}</Text>
              <TouchableOpacity style={s.primaryBtn} onPress={() => router.push('/(tabs)/explore' as never)}
                accessibilityRole="button">
                <Text style={s.primaryBtnText}>{tr('Explorar')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            list.map((p) => <PlanRow key={`${p.kind}-${p.id}`} plan={p} onOpen={open} />)
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { ...TYPE.title1, color: COLORS.textMain },
  scroll: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl * 2 },
  tabs: {
    flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    padding: 3, marginBottom: SPACING.md,
  },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: RADIUS.md },
  tabActive: { backgroundColor: COLORS.surface },
  tabText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.semibold },
  tabTextActive: { color: COLORS.textMain },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1,
    borderColor: COLORS.hairline, padding: SPACING.sm, marginBottom: SPACING.sm,
  },
  kindBubble: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
  },
  kindTicket: { backgroundColor: 'rgba(18,181,165,0.12)' },
  kindReserva: { backgroundColor: 'rgba(34,197,94,0.12)' },
  rowBody: { flex: 1 },
  kindLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kindTag: { fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', ...FONTS.bold },
  rowWhen: { fontSize: 11, color: COLORS.textMuted, flexShrink: 1 },
  rowTitle: { fontSize: 14.5, color: COLORS.textMain, ...FONTS.semibold, marginTop: 1 },
  rowMeta: { fontSize: 12, color: COLORS.textMuted, marginTop: 1 },
  rowRight: { alignItems: 'flex-end', gap: 6 },
  chip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, maxWidth: 130 },
  chipText: { fontSize: 10, ...FONTS.bold, letterSpacing: 0.3 },
  skeletons: { marginTop: SPACING.xs },
  stateWrap: { alignItems: 'center', paddingVertical: SPACING.xl * 1.5, paddingHorizontal: SPACING.lg, gap: 8 },
  stateTitle: { ...TYPE.title3, color: COLORS.textMain, textAlign: 'center' },
  stateText: { fontSize: 13, color: COLORS.textMuted, textAlign: 'center' },
  primaryBtn: {
    marginTop: SPACING.sm, backgroundColor: COLORS.primary, borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.lg, paddingVertical: 10,
  },
  primaryBtnText: { color: '#04110F', fontSize: 14, ...FONTS.bold },
  errorLine: {
    flexDirection: 'row', gap: 10, alignItems: 'center',
    paddingVertical: 6, marginBottom: SPACING.xs,
  },
  errorText: { fontSize: 12.5, color: COLORS.textMuted },
  errorRetry: { fontSize: 12.5, color: COLORS.primary, ...FONTS.bold },
});
