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
import { openExternal } from '../src/lib/cityModules';
import { COLORS, FONTS, RADIUS, SPACING, TYPE } from '../src/constants/theme';

type Pair = { value: string | null; n: number };

type PreregRow = Record<string, any>;
type Detail = {
  prereg: PreregRow;
  referred_by_row: { prereg_id?: string; full_name?: string; referral_code?: string } | null;
  invited: Array<{ prereg_id?: string; full_name?: string; created_at?: string }>;
  invited_count: number;
};

const ageFrom = (dob?: string): string => {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return '';
  const [y, m, d] = dob.split('-').map(Number);
  const now = new Date();
  let a = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a -= 1;
  return a > 0 && a < 120 ? ` · ${a} años` : '';
};
const digits = (v?: string) => (v || '').replace(/\D/g, '');
const yn = (v: unknown) => (v ? 'Sí' : 'No');
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

  // ── one person's complete record ──
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailErr, setDetailErr] = useState(false);
  const [query, setQuery] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const [delBusy, setDelBusy] = useState(false);

  const openDetail = useCallback(async (id: string) => {
    setSelected(id);
    setDetail(null);
    setDetailErr(false);
    setConfirmDel(false);
    setDetailBusy(true);
    try {
      const env = await api.get(`/admin/cmw/prereg/${id}`);
      const d = (env && typeof env === 'object' ? (env as { data?: Detail }).data : null) || null;
      if (d?.prereg) setDetail(d); else setDetailErr(true);
    } catch {
      setDetailErr(true);
    } finally {
      setDetailBusy(false);
    }
  }, []);

  const closeDetail = useCallback(() => {
    setSelected(null); setDetail(null); setConfirmDel(false); setDetailErr(false);
  }, []);

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

  // Search runs over everything the panel loaded (up to 500 most recent).
  const recent = useMemo(() => {
    const all = data?.preregs || [];
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 25);
    return all.filter((r) => [
      r.full_name, r.last_name, r.email, r.whatsapp, r.instagram,
      r.city, r.country, r.referral_code, r.prereg_id,
    ].some((v) => typeof v === 'string' && v.toLowerCase().includes(q))).slice(0, 50);
  }, [data, query]);

  const removePrereg = useCallback(async (id: string) => {
    if (delBusy) return;
    setDelBusy(true);
    try {
      await api.delete(`/admin/cmw/prereg/${id}`);
      closeDetail();
      await load();
    } catch {
      setDetailErr(true);
    } finally {
      setDelBusy(false);
      setConfirmDel(false);
    }
  }, [delBusy, closeDetail, load]);

  // ── one person, everything we hold ──────────────────────────────────────────
  if (selected) {
    const r: PreregRow = detail?.prereg || {};
    const src = (r.source || {}) as Record<string, any>;
    const last = (r.last_source || {}) as Record<string, any>;
    const consent = (r.consent || {}) as Record<string, any>;
    const mkt = (r.marketing || {}) as Record<string, any>;
    const prog = (r.program_ref || {}) as Record<string, any>;
    const name = [r.full_name, r.last_name && !String(r.full_name || '').includes(r.last_name) ? r.last_name : '']
      .filter(Boolean).join(' ');

    const Row = ({ k, v, mono }: { k: string; v?: any; mono?: boolean }) => {
      if (v === undefined || v === null || v === '') return null;
      return (
        <View style={st.dRow}>
          <Text style={st.dKey}>{tr(k)}</Text>
          <Text style={[st.dVal, mono && { fontVariant: ['tabular-nums'] }]} selectable>{String(v)}</Text>
        </View>
      );
    };
    const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
      <View style={st.section}>
        <Text style={st.sectionTitle}>{tr(title)}</Text>
        {children}
      </View>
    );

    return (
      <SafeAreaView style={st.container} edges={['top']}>
        <Head><title>{`${name || 'Preinscripción'} · Panel CMW`}</title><meta name="robots" content="noindex, nofollow" /></Head>
        <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
          <View style={st.headerRow}>
            <TouchableOpacity onPress={closeDetail} style={st.navBtn} accessibilityRole="button" accessibilityLabel={tr('Volver')} testID="cmw-detail-back">
              <Ionicons name="arrow-back" size={20} color={COLORS.textMain} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={st.eyebrow}>{tr('Preinscrito')}</Text>
              <Text style={st.title} numberOfLines={2}>{name || selected}</Text>
              {!!r.created_at && <Text style={st.sub}>{tr('Preinscrito el')} {String(r.created_at).slice(0, 10)}</Text>}
            </View>
          </View>

          {detailBusy && <View style={st.stateCard}><ActivityIndicator color={COLORS.primary} /></View>}

          {detailErr && !detailBusy && (
            <View style={st.stateCard}>
              <Ionicons name="cloud-offline-outline" size={32} color={COLORS.textMuted} />
              <Text style={st.stateTitle}>{tr('No pudimos cargar el registro')}</Text>
              <TouchableOpacity onPress={() => openDetail(selected)} style={st.primaryBtn} accessibilityRole="button">
                <Text style={st.primaryBtnText}>{tr('Reintentar')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {detail && !detailBusy && (
            <>
              {/* quick actions — the operator's real reasons to open a record */}
              <View style={st.actionRow}>
                {!!digits(r.whatsapp) && (
                  <TouchableOpacity style={st.action} onPress={() => openExternal(`https://wa.me/${digits(r.whatsapp)}`)} accessibilityRole="button" testID="cmw-detail-wa">
                    <Ionicons name="logo-whatsapp" size={16} color="#25D366" />
                    <Text style={st.actionText}>WhatsApp</Text>
                  </TouchableOpacity>
                )}
                {!!r.email && (
                  <TouchableOpacity style={st.action} onPress={() => openExternal(`mailto:${r.email}`)} accessibilityRole="button" testID="cmw-detail-mail">
                    <Ionicons name="mail-outline" size={16} color={COLORS.primary} />
                    <Text style={st.actionText}>{tr('Correo')}</Text>
                  </TouchableOpacity>
                )}
                {!!r.instagram && (
                  <TouchableOpacity style={st.action} onPress={() => openExternal(`https://instagram.com/${String(r.instagram).replace(/^@/, '')}`)} accessibilityRole="button" testID="cmw-detail-ig">
                    <Ionicons name="logo-instagram" size={16} color="#EC4899" />
                    <Text style={st.actionText}>Instagram</Text>
                  </TouchableOpacity>
                )}
              </View>

              <Section title="Identidad">
                <Row k="Nombre" v={r.full_name} />
                <Row k="Apellidos" v={r.last_name} />
                <Row k="Correo" v={r.email} />
                <Row k="WhatsApp" v={r.whatsapp} mono />
                <Row k="Instagram" v={r.instagram ? `@${String(r.instagram).replace(/^@/, '')}` : ''} />
                <Row k="Género" v={r.gender} />
                <Row k="Nacimiento" v={r.dob ? `${r.dob}${ageFrom(r.dob)}` : ''} />
                <Row k="Ciudad" v={r.city} />
                <Row k="País" v={r.country} />
                <Row k="Idioma" v={r.lang} />
              </Section>

              <Section title="Registro">
                <Row k="Número de preinscripción" v={r.prereg_id} mono />
                <Row k="Estado" v={r.status} />
                <Row k="Acceso prioritario" v={yn(r.priority_access)} />
                <Row k="Cuenta AMO vinculada" v={r.user_id ? `${tr('Sí')} · ${r.user_id}` : tr('No')} />
                <Row k="Plataforma" v={src.landing === 'app' ? 'App' : 'Web'} />
                <Row k="Cliente" v={r.client} />
                <Row k="Creado" v={r.created_at} />
                <Row k="Actualizado" v={r.updated_at} />
              </Section>

              <Section title="Autorización de datos (Ley 1581)">
                <Row k="Aceptada" v={yn(consent.accepted)} />
                <Row k="Fecha y hora" v={consent.accepted_at} />
                <Row k="Versión" v={consent.version} />
                <Row k="Identificador del texto" v={consent.text_id} mono />
                <Row k="Responsable" v={consent.responsable} />
                <Row k="Finalidades" v={Array.isArray(consent.purposes) ? consent.purposes.join(', ') : consent.purposes} />
                <Row k="Método" v={consent.method} />
                <Row k="Idioma mostrado" v={consent.lang_shown} />
                <Row k="Política" v={consent.policy_url} />
                <Row k="Huella de IP (hash)" v={consent.ip_hash} mono />
                {!!consent.text && (
                  <View style={st.consentTextBox}>
                    <Text style={st.consentText} selectable>{consent.text}</Text>
                  </View>
                )}
              </Section>

              <Section title="Marketing">
                <Row k="Autorizó comunicaciones" v={yn(r.marketing_opt_in)} />
                <Row k="Versión" v={mkt.version} />
                <Row k="Aceptado" v={mkt.accepted_at} />
                <Row k="Revocado" v={mkt.revoked_at} />
              </Section>

              <Section title="Atribución">
                <Row k="utm_source" v={src.utm_source} />
                <Row k="utm_medium" v={src.utm_medium} />
                <Row k="utm_campaign" v={src.utm_campaign} />
                <Row k="utm_content" v={src.utm_content} />
                <Row k="Código / socio (ref)" v={src.ref} />
                <Row k="Último contacto" v={last.utm_source || last.ref ? `${last.utm_source || '—'} · ${last.ref || '—'}` : ''} />
              </Section>

              <Section title="Referidos">
                <Row k="Su código" v={r.referral_code} mono />
                <Row k="Invitado por" v={detail.referred_by_row ? `${detail.referred_by_row.full_name || ''} (${detail.referred_by_row.referral_code || detail.referred_by_row.prereg_id})` : ''} />
                <Row k="Personas que trajo" v={String(detail.invited_count)} />
                {detail.invited.map((i) => (
                  <TouchableOpacity key={i.prereg_id} style={st.invitedRow} onPress={() => i.prereg_id && openDetail(i.prereg_id)} accessibilityRole="button">
                    <Ionicons name="person-add-outline" size={14} color={COLORS.mustard} />
                    <Text style={st.invitedName} numberOfLines={1}>{i.full_name || i.prereg_id}</Text>
                    <Text style={st.dKeySmall}>{String(i.created_at || '').slice(0, 10)}</Text>
                  </TouchableOpacity>
                ))}
              </Section>

              <Section title="Evento">
                <Row k="Programa" v={prog.name} />
                <Row k="Desde" v={prog.start_date} />
                <Row k="Hasta" v={prog.end_date} />
                <Row k="Versión del programa" v={prog.program_version} />
              </Section>

              {Array.isArray(r.consent_log) && r.consent_log.length > 0 && (
                <Section title="Historial de autorizaciones">
                  {r.consent_log.map((c: any, i: number) => (
                    <View key={`${c.accepted_at}-${i}`} style={st.dRow}>
                      <Text style={st.dKey}>{String(c.accepted_at || '').slice(0, 16).replace('T', ' ')}</Text>
                      <Text style={st.dVal}>{c.version} · {c.landing}</Text>
                    </View>
                  ))}
                </Section>
              )}

              {/* Ley 1581 suppression: the lever for a "bórrenme" request to privacidad@ */}
              <View style={st.dangerCard}>
                <Text style={st.sectionTitle}>{tr('Derecho de supresión')}</Text>
                <Text style={st.hint}>
                  {tr('Borra esta preinscripción de forma permanente. Úsalo solo cuando la persona lo pida.')}
                </Text>
                {confirmDel ? (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity onPress={() => removePrereg(selected)} disabled={delBusy} style={[st.primaryBtn, { backgroundColor: '#EF4444' }]} accessibilityRole="button" testID="cmw-detail-del-confirm">
                      {delBusy ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={[st.primaryBtnText, { color: '#FFF' }]}>{tr('Sí, borrar definitivamente')}</Text>}
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setConfirmDel(false)} style={[st.primaryBtn, { backgroundColor: COLORS.surfaceAlt }]} accessibilityRole="button">
                      <Text style={[st.primaryBtnText, { color: COLORS.textMain }]}>{tr('Cancelar')}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => setConfirmDel(true)} style={[st.primaryBtn, { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#EF4444' }]} accessibilityRole="button" testID="cmw-detail-del">
                    <Ionicons name="trash-outline" size={15} color="#EF4444" />
                    <Text style={[st.primaryBtnText, { color: '#EF4444' }]}>{tr('Suprimir preinscripción')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

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
              <Text style={st.sectionTitle}>{tr('Preinscritos')}</Text>
              <Text style={st.hint}>{tr('Toca una persona para ver todos sus datos.')}</Text>
              <View style={st.searchRow}>
                <Ionicons name="search" size={16} color={COLORS.textMuted} />
                <TextInput
                  style={st.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder={tr('Buscar por nombre, correo, Instagram, ciudad o código')}
                  placeholderTextColor={COLORS.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  testID="cmw-panel-search"
                />
                {query.length > 0 && (
                  <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle" size={16} color={COLORS.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
              {recent.map((r) => (
                <TouchableOpacity
                  key={String(r.prereg_id)}
                  style={st.rowCard}
                  onPress={() => openDetail(String(r.prereg_id))}
                  accessibilityRole="button"
                  accessibilityLabel={`${String(r.full_name || '')} · ${tr('Ver todos sus datos')}`}
                  testID={`cmw-panel-row-${r.prereg_id}`}
                >
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
                  <Ionicons name="chevron-forward" size={16} color={COLORS.icon} />
                </TouchableOpacity>
              ))}
              {recent.length === 0 && (
                <Text style={st.emptyLine}>
                  {query ? tr('Nadie coincide con esa búsqueda') : tr('Sin preinscripciones todavía')}
                </Text>
              )}
              {!query && (data?.total || 0) > recent.length && (
                <Text style={st.hint}>
                  {tr('Mostrando')} {recent.length} {tr('de')} {data?.total}. {tr('Usa la búsqueda o exporta el CSV.')}
                </Text>
              )}
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

  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12, borderRadius: 12, backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.hairline, marginBottom: 10 },
  searchInput: { flex: 1, minHeight: 44, fontSize: 14, color: COLORS.textMain },

  // ── detail record ──
  dRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.hairline },
  dKey: { width: 132, fontSize: 11, lineHeight: 15, ...FONTS.medium, color: COLORS.textFaint },
  dKeySmall: { fontSize: 11, color: COLORS.textFaint, ...FONTS.medium },
  dVal: { flex: 1, fontSize: 13.5, lineHeight: 19, color: COLORS.textMain, ...FONTS.medium },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: SPACING.lg, marginTop: SPACING.sm },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: RADIUS.full, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.hairline },
  actionText: { fontSize: 13, color: COLORS.textMain, ...FONTS.bold },
  consentTextBox: { marginTop: 10, padding: 12, borderRadius: 12, backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.hairline },
  consentText: { fontSize: 12, lineHeight: 17, color: COLORS.textMuted, ...FONTS.medium },
  invitedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.hairline },
  invitedName: { flex: 1, fontSize: 13, color: COLORS.textMain, ...FONTS.medium },
  dangerCard: { marginHorizontal: SPACING.lg, marginTop: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: 'rgba(239,68,68,0.35)', padding: SPACING.md },

  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.hairline },
  rowName: { fontSize: 13.5, color: COLORS.textMain, ...FONTS.bold },
  rowMeta: { fontSize: 11.5, color: COLORS.textMuted, ...FONTS.medium, marginTop: 2 },
  rowSrc: { fontSize: 11.5, color: COLORS.mustard, ...FONTS.medium, marginTop: 2, maxWidth: 120 },
});
