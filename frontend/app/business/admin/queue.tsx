import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../../src/constants/theme';
import { useBusinessAuth } from '../../../src/context/BusinessAuthContext';
import { useAuth } from '../../../src/context/AuthContext';
import { api } from '../../../src/constants/api';
import { useTr } from '../../../src/i18n/autoTr';
import { SafeImage } from '../../../src/components/SafeImage';

// Admin moderation queue (government role). Two firewalls converge here:
// new-venue DRAFTS awaiting approval, and CLAIMS awaiting manual review /
// dispute resolution. This is where Phil approves/rejects.
//
// DROP B2: a third firewall — partner-submitted CONTENT (photos, prices,
// events) — untrusted by default, never public until a human approves it.
type Submissions = {
  events: any[]; media: any[]; prices: any[]; auto: any[];
  counts: { events: number; media: number; prices: number; auto: number };
};
const EMPTY_SUBMISSIONS: Submissions = { events: [], media: [], prices: [], auto: [], counts: { events: 0, media: 0, prices: 0, auto: 0 } };

const fmtPriceRange = (p: any): string | null => {
  const low = p?.typical_cop?.low;
  const high = p?.typical_cop?.high;
  if (low == null && high == null) return null;
  if (low == null) return `COP ${Number(high).toLocaleString('es-CO')}`;
  if (high == null) return `COP ${Number(low).toLocaleString('es-CO')}`;
  if (low === high) return `COP ${Number(low).toLocaleString('es-CO')}`;
  return `COP ${Number(low).toLocaleString('es-CO')}–${Number(high).toLocaleString('es-CO')}`;
};

export default function AdminQueue() {
  const tr = useTr();
  const router = useRouter();
  const { token, business, loading: authLoading } = useBusinessAuth();
  // Unified access: a government BUSINESS login OR an is_admin USER (one inbox).
  const { user, isLoading: userLoading } = useAuth();
  const canModerate = business?.role === 'government' || !!user?.is_admin;
  const [drafts, setDrafts] = useState<any[]>([]);
  const [claims, setClaims] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<Submissions>(EMPTY_SUBMISSIONS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Government business login → its token; otherwise (is_admin user) pass no
  // override so the API client attaches the user session token. The backend
  // `_require_moderator` accepts either identity.
  const auth = token ? { headers: { Authorization: `Bearer ${token}` } } : undefined;
  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [d, c, s] = await Promise.all([
        api.get('/business/admin/venue-drafts', auth).catch(() => ({ drafts: [] })),
        api.get('/business/admin/claims', auth).catch(() => ({ claims: [] })),
        api.get('/business/admin/submissions', auth).catch(() => EMPTY_SUBMISSIONS),
      ]);
      setDrafts(d.drafts || []);
      setClaims(c.claims || []);
      setSubmissions({
        events: s.events || [],
        media: s.media || [],
        prices: s.prices || [],
        auto: s.auto_media || [],
        counts: s.counts || { events: 0, media: 0, prices: 0, auto: 0 },
      });
    } catch { /* fail soft */ }
  }, [token]);

  useFocusEffect(useCallback(() => {
    if (authLoading || userLoading) return;
    if (!canModerate) { router.replace((token ? '/business/dashboard' : '/business/login') as any); return; }
    setLoading(true); load().finally(() => setLoading(false));
  }, [canModerate, token, authLoading, userLoading, load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const act = async (fn: () => Promise<any>, okMsg: string) => {
    try { await fn(); await load(); }
    catch (e: any) { Alert.alert('Error', e?.message || 'Error'); }
  };

  const approveDraft = (id: string) => act(() => api.post(`/business/admin/venue-drafts/${id}/approve`, {}, auth), 'ok');
  const rejectDraft = (id: string) => act(() => api.post(`/business/admin/venue-drafts/${id}/reject`, { reason: 'rejected' }, auth), 'ok');
  const resolveClaim = (cid: string, action: string) => act(() => api.post(`/business/admin/claims/${cid}/resolve`, { action }, auth), 'ok');

  const approveMedia = (id: string) => act(() => api.post(`/business/admin/media/${id}/approve`, {}, auth), 'ok');
  const rejectMedia = (id: string) => act(() => api.post(`/business/admin/media/${id}/reject`, { reason: 'No aprobada' }, auth), 'ok');
  const removeMedia = (id: string) => act(() => api.post(`/business/admin/media/${id}/remove`, {}, auth), 'ok');
  const trustPartner = (pid: string, trusted: boolean) => act(() => api.post(`/business/admin/partners/${pid}/photo-trust`, { trusted }, auth), 'ok');
  const approvePrice = (id: string) => act(() => api.post(`/business/admin/price/${id}/approve`, {}, auth), 'ok');
  const rejectPrice = (id: string) => act(() => api.post(`/business/admin/price/${id}/reject`, { reason: 'No aprobado' }, auth), 'ok');
  const approveEvent = (id: string) => act(() => api.post(`/business/admin/events/${id}/moderate`, { action: 'approve' }, auth), 'ok');
  const rejectEvent = (id: string) => act(() => api.post(`/business/admin/events/${id}/moderate`, { action: 'reject', reason: 'No aprobado' }, auth), 'ok');

  if (!authLoading && !userLoading && !canModerate) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}><Text style={styles.muted}>{tr('Acceso solo para administradores')}</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.hTitle}>{tr('Revisión')}</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? <ActivityIndicator color={COLORS.primary} style={{ marginTop: 60 }} /> : (
        <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}>
          <Text style={styles.section}>{tr('Negocios nuevos')} · {drafts.length}</Text>
          {drafts.length === 0 && <Text style={styles.empty}>{tr('Sin borradores pendientes')}</Text>}
          {drafts.map(d => (
            <View key={d.partner_id} style={styles.card}>
              <Text style={styles.cardName}>{d.name}</Text>
              <Text style={styles.cardMeta}>{[d.category, d.neighborhood].filter(Boolean).join(' · ')}</Text>
              {!!d.description && <Text style={styles.cardDesc} numberOfLines={3}>{d.description}</Text>}
              <Text style={styles.cardBy}>{tr('Enviado por')}: {d.submitted_email || d.submitted_by}</Text>
              <View style={styles.actions}>
                <TouchableOpacity style={[styles.actBtn, styles.reject]} onPress={() => rejectDraft(d.partner_id)}><Text style={styles.rejectText}>{tr('Rechazar')}</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.actBtn, styles.approve]} onPress={() => approveDraft(d.partner_id)}><Text style={styles.approveText}>{tr('Aprobar')}</Text></TouchableOpacity>
              </View>
            </View>
          ))}

          <Text style={[styles.section, { marginTop: SPACING.xl }]}>{tr('Reclamos y disputas')} · {claims.length}</Text>
          {claims.length === 0 && <Text style={styles.empty}>{tr('Sin reclamos pendientes')}</Text>}
          {claims.map(c => (
            <View key={c.claim_id} style={styles.card}>
              <View style={styles.claimHead}>
                <Text style={styles.cardName}>{c.partner_name || c.partner_id}</Text>
                <View style={[styles.tag, c.state === 'disputed' ? styles.tagDispute : styles.tagManual]}>
                  <Text style={styles.tagText}>{c.state === 'disputed' ? tr('Disputa') : tr('Manual')}</Text>
                </View>
              </View>
              <Text style={styles.cardBy}>{tr('Solicitante')}: {c.actor_email || c.business_id}</Text>
              {!!c.proof && <Text style={styles.cardDesc} numberOfLines={4}>{tr('Prueba')}: {c.proof}</Text>}
              {!!c.note && <Text style={styles.cardDesc}>{c.note}</Text>}
              <View style={styles.actions}>
                <TouchableOpacity style={[styles.actBtn, styles.reject]} onPress={() => resolveClaim(c.claim_id, 'reject')}><Text style={styles.rejectText}>{tr('Rechazar')}</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.actBtn, styles.approve]} onPress={() => resolveClaim(c.claim_id, 'approve')}><Text style={styles.approveText}>{tr('Aprobar propiedad')}</Text></TouchableOpacity>
              </View>
            </View>
          ))}

          {(() => {
            const total = (submissions.counts.events || 0) + (submissions.counts.media || 0) + (submissions.counts.prices || 0);
            return <Text style={[styles.section, { marginTop: SPACING.xl }]}>{tr('Contenido pendiente')} · {total}</Text>;
          })()}
          {submissions.media.length === 0 && submissions.prices.length === 0 && submissions.events.length === 0 && (
            <Text style={styles.empty}>{tr('Sin contenido pendiente')}</Text>
          )}

          {submissions.media.map(m => (
            <View key={m.media_id} style={styles.card}>
              <View style={[styles.tag, styles.tagMedia, { alignSelf: 'flex-start', marginBottom: SPACING.xs }]}>
                <Text style={styles.tagText}>{tr('Foto')}</Text>
              </View>
              <View style={styles.mediaRow}>
                <SafeImage uri={m.data_url} style={styles.mediaThumb} />
                <View style={{ flex: 1 }}>
                  {!!m.caption && <Text style={styles.cardDesc} numberOfLines={2}>{m.caption}</Text>}
                  <Text style={styles.cardBy}>{m.partner_name}</Text>
                </View>
              </View>
              {m.partner_trusted ? (
                <View style={styles.trustOn}>
                  <Ionicons name="shield-checkmark" size={12} color="#22C55E" />
                  <Text style={styles.trustOnText}>{tr('Negocio de confianza — sus fotos limpias se publican solas')}</Text>
                </View>
              ) : (
                <TouchableOpacity style={styles.trustBtn} onPress={() => trustPartner(m.partner_id, true)}>
                  <Ionicons name="shield-outline" size={13} color={COLORS.primary} />
                  <Text style={styles.trustBtnText}>{tr('Confiar en este negocio (sus próximas fotos se publican solas)')}</Text>
                </TouchableOpacity>
              )}
              <View style={styles.actions}>
                <TouchableOpacity style={[styles.actBtn, styles.reject]} onPress={() => rejectMedia(m.media_id)}><Text style={styles.rejectText}>{tr('Rechazar')}</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.actBtn, styles.approve]} onPress={() => approveMedia(m.media_id)}><Text style={styles.approveText}>{tr('Aprobar')}</Text></TouchableOpacity>
              </View>
            </View>
          ))}

          {submissions.prices.map(p => {
            const range = fmtPriceRange(p);
            return (
              <View key={p.price_id} style={styles.card}>
                <View style={[styles.tag, styles.tagPrice, { alignSelf: 'flex-start', marginBottom: SPACING.xs }]}>
                  <Text style={styles.tagText}>{tr('Precio')}</Text>
                </View>
                <Text style={styles.cardName}>{range || p.label || tr('Sin datos')}</Text>
                {!!range && !!p.label && <Text style={styles.cardMeta}>{p.label}</Text>}
                <Text style={styles.cardBy}>{p.partner_name}</Text>
                <View style={styles.actions}>
                  <TouchableOpacity style={[styles.actBtn, styles.reject]} onPress={() => rejectPrice(p.price_id)}><Text style={styles.rejectText}>{tr('Rechazar')}</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.actBtn, styles.approve]} onPress={() => approvePrice(p.price_id)}><Text style={styles.approveText}>{tr('Aprobar')}</Text></TouchableOpacity>
                </View>
              </View>
            );
          })}

          {submissions.events.map(e => (
            <View key={e.event_id} style={styles.card}>
              <View style={[styles.tag, styles.tagEvent, { alignSelf: 'flex-start', marginBottom: SPACING.xs }]}>
                <Text style={styles.tagText}>{tr('Evento')}</Text>
              </View>
              <Text style={styles.cardName}>{e.title}</Text>
              <Text style={styles.cardMeta}>{e.date}</Text>
              <Text style={styles.cardBy}>{e.partner_name}</Text>
              <View style={styles.actions}>
                <TouchableOpacity style={[styles.actBtn, styles.reject]} onPress={() => rejectEvent(e.event_id)}><Text style={styles.rejectText}>{tr('Rechazar')}</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.actBtn, styles.approve]} onPress={() => approveEvent(e.event_id)}><Text style={styles.approveText}>{tr('Aprobar')}</Text></TouchableOpacity>
              </View>
            </View>
          ))}

          {submissions.auto.length > 0 && (
            <>
              <Text style={[styles.section, { marginTop: SPACING.xl }]}>{tr('Publicadas automáticamente')} · {submissions.auto.length}</Text>
              <Text style={styles.autoHint}>{tr('Fotos de negocios de confianza que la IA aprobó. No requieren acción — quítalas si algo no cuadra (eso también revisa sus próximas fotos).')}</Text>
              {submissions.auto.map((m: any) => (
                <View key={m.media_id} style={styles.card}>
                  <View style={styles.mediaRow}>
                    <SafeImage uri={m.data_url} style={styles.mediaThumb} />
                    <View style={{ flex: 1 }}>
                      {!!m.caption && <Text style={styles.cardDesc} numberOfLines={2}>{m.caption}</Text>}
                      <Text style={styles.cardBy}>{m.partner_name}</Text>
                    </View>
                    <View style={[styles.tag, { backgroundColor: 'rgba(34,197,94,0.15)', alignSelf: 'flex-start' }]}>
                      <Text style={[styles.tagText, { color: '#22C55E' }]}>{tr('Auto')}</Text>
                    </View>
                  </View>
                  <TouchableOpacity style={[styles.actBtn, styles.reject, { marginTop: SPACING.sm, flexDirection: 'row', justifyContent: 'center' }]} onPress={() => removeMedia(m.media_id)}>
                    <Ionicons name="trash-outline" size={14} color={COLORS.textMuted} />
                    <Text style={[styles.rejectText, { marginLeft: 6 }]}>{tr('Quitar y revisar sus fotos')}</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: COLORS.textMuted, fontSize: 14, ...FONTS.regular },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: SPACING.sm },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  hTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold },
  scroll: { padding: SPACING.lg },
  section: { fontSize: 13, color: COLORS.textMuted, ...FONTS.bold, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: SPACING.sm },
  empty: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, fontStyle: 'italic', marginBottom: SPACING.md },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, marginBottom: SPACING.md },
  cardName: { fontSize: 15, color: COLORS.textMain, ...FONTS.bold },
  cardMeta: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },
  cardDesc: { fontSize: 13, color: COLORS.textMain, ...FONTS.regular, marginTop: SPACING.sm, lineHeight: 18 },
  cardBy: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginTop: SPACING.sm },
  claimHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full },
  tagManual: { backgroundColor: 'rgba(217,119,6,0.15)' },
  tagDispute: { backgroundColor: 'rgba(220,38,38,0.15)' },
  tagMedia: { backgroundColor: 'rgba(59,130,246,0.15)' },
  tagPrice: { backgroundColor: 'rgba(212,175,55,0.15)' },
  tagEvent: { backgroundColor: 'rgba(168,85,247,0.15)' },
  tagText: { fontSize: 10, color: COLORS.textMain, ...FONTS.bold, letterSpacing: 0.3 },
  mediaRow: { flexDirection: 'row', gap: SPACING.sm },
  mediaThumb: { width: 64, height: 64, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceAlt },
  trustBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: SPACING.sm, paddingVertical: 9, borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(217,119,6,0.4)', backgroundColor: 'rgba(217,119,6,0.08)' },
  trustBtnText: { color: COLORS.primary, fontSize: 12, ...FONTS.semibold },
  trustOn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: SPACING.sm, paddingVertical: 8 },
  trustOnText: { color: '#22C55E', fontSize: 11.5, ...FONTS.semibold },
  autoHint: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 17, marginBottom: SPACING.md, marginTop: -2 },
  actions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
  actBtn: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: RADIUS.full },
  approve: { backgroundColor: COLORS.primary },
  approveText: { color: COLORS.white, fontSize: 13, ...FONTS.bold },
  reject: { backgroundColor: COLORS.surfaceAlt, borderWidth: 1, borderColor: COLORS.border },
  rejectText: { color: COLORS.textMuted, fontSize: 13, ...FONTS.semibold },
});
