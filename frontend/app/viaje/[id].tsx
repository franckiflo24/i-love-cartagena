// Drop 10 — trip detail: the shared itinerary. Items grouped by day, votes,
// who-added-what, custom items, share link, suggested order (real time bands),
// pull-to-refresh sync (shared-and-refreshes model — updated_at is the truth).
//
// Honesty: real members + real last-updated, no presence indicators. A ref
// that no longer resolves renders its saved name + "ya no disponible" —
// never a broken card (Drop 9/8 venue-binding lesson).
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, RefreshControl, Modal, Platform, Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useTr } from '../../src/i18n/autoTr';
import { shareTripCard } from '../../src/lib/tripShareCard';

type Item = {
  item_id: string; ref_type: string; ref_id?: string | null; ref_name?: string | null;
  custom_text?: string | null; added_by_name?: string; day?: number | null;
  time_slot?: string | null; note?: string | null; votes: string[]; status: string;
  resolved?: boolean; venue?: any; experience?: any; stamp?: any; order?: number;
};

type Trip = {
  trip_id: string; name: string; dates?: { start?: string; end?: string } | null;
  share_code?: string | null; members: { user_id: string; name: string; role: string }[];
  my_role: string; updated_at: string; items: Item[];
};

const DAY_OPTIONS = [null, 1, 2, 3, 4, 5, 6, 7];

export default function ViajeDetailScreen() {
  const tr = useTr();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [customText, setCustomText] = useState('');
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailDone, setEmailDone] = useState(false);

  const canEdit = trip?.my_role === 'owner' || trip?.my_role === 'editor';

  const load = useCallback(async () => {
    try {
      const t = await api.get(`/trips/${id}`);
      // Shape guard: api.get returns [] for an unknown id (STATIC_MODE) or a bad
      // 200 — and [] is truthy, so it slipped past the `if (!trip)` not-found guard
      // and reached trip.members.map / groupByDay(trip.items) during render →
      // "undefined is not iterable" → the GLOBAL ErrorBoundary blanked the whole app.
      // Only accept a real trip object; anything else falls through to not-found.
      setTrip(t && typeof t === 'object' && !Array.isArray(t) && (t as any).trip_id ? t : null);
    } catch {
      setTrip(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const addCustom = useCallback(async () => {
    const txt = customText.trim();
    if (!txt || !trip) return;
    setCustomText('');
    try {
      await api.post(`/trips/${trip.trip_id}/items`, { ref_type: 'custom', custom_text: txt });
      load();
    } catch { /* offline / rate-limit — pull-to-refresh recovers */ }
  }, [customText, trip, load]);

  const vote = useCallback(async (it: Item) => {
    if (!trip) return;
    try {
      await api.post(`/trips/${trip.trip_id}/items/${it.item_id}/vote`, {});
      load();
    } catch { /* signed-out or offline — view stays intact */ }
  }, [trip, load]);

  const patchItem = useCallback(async (it: Item, patch: any) => {
    if (!trip) return;
    try {
      await api.patch(`/trips/${trip.trip_id}/items/${it.item_id}`, patch);
      setEditItem(null);
      load();
    } catch { /* keep the sheet open on failure */ }
  }, [trip, load]);

  const removeItem = useCallback(async (it: Item) => {
    if (!trip) return;
    try {
      await api.delete(`/trips/${trip.trip_id}/items/${it.item_id}`);
      setEditItem(null);
      load();
    } catch { /* noop */ }
  }, [trip, load]);

  const share = useCallback(async () => {
    if (!trip) return;
    try {
      const res = await api.post(`/trips/${trip.trip_id}/share`, {});
      if (res?.url) {
        setShareUrl(res.url);
        try {
          await (navigator as any)?.clipboard?.writeText?.(res.url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch { /* clipboard unavailable — the url is shown */ }
        load();
      }
    } catch { /* owner-only — non-owners use the card below */ }
  }, [trip, load]);

  const shareCard = useCallback(async () => {
    if (!trip) return;
    await shareTripCard({
      name: trip.name,
      dates: trip.dates || null,
      members: trip.members.map((m) => m.name),
      itemsByDay: groupByDay(trip.items).map(([day, items]) => ({
        day,
        names: items.map((i) => displayName(i)).slice(0, 5),
      })),
    }, shareUrl || (trip.share_code ? `https://www.amocartagena.co/viaje/shared/${trip.share_code}` : null));
  }, [trip, shareUrl]);

  const emailItinerary = useCallback(async () => {
    if (!trip || emailBusy) return;
    const to = emailTo.trim().toLowerCase();
    if (!to.includes('@') || !to.split('@')[1]?.includes('.')) return;
    setEmailBusy(true);
    try {
      await api.post(`/trips/${trip.trip_id}/email`, { to });
      setEmailDone(true);
      setEmailTo('');
      setTimeout(() => { setEmailDone(false); setEmailOpen(false); }, 2600);
    } catch { /* fail-soft — rate-limited or offline */ }
    setEmailBusy(false);
  }, [trip, emailTo, emailBusy]);

  const suggestOrder = useCallback(async () => {
    if (!trip || suggesting) return;
    setSuggesting(true);
    try {
      const res = await api.get(`/trips/${trip.trip_id}/suggest-order`);
      const apply = async () => {
        for (const block of res?.suggestion || []) {
          let ord = 1;
          for (const itemId of block.item_ids) {
            await api.patch(`/trips/${trip.trip_id}/items/${itemId}`, { order: ord });
            ord += 1;
          }
        }
        load();
      };
      const msg = `${tr('Orden sugerido según franjas reales (café→mañana, rooftop→atardecer, cena→noche).')}${res?.sunset ? ` ${tr('Atardecer hoy')}: ${res.sunset}.` : ''}`;
      if (Platform.OS === 'web') {
        // eslint-disable-next-line no-alert
        if (typeof window !== 'undefined' && window.confirm(msg + '\n\n' + tr('¿Aplicar este orden?'))) await apply();
      } else {
        Alert.alert(tr('Orden sugerido'), msg, [
          { text: tr('Cancelar'), style: 'cancel' },
          { text: tr('Aplicar'), onPress: apply },
        ]);
      }
    } catch { /* viewer or offline */ } finally {
      setSuggesting(false);
    }
  }, [trip, suggesting, load, tr]);

  const grouped = useMemo(() => (trip ? groupByDay(trip.items) : []), [trip]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }
  if (!trip) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.emptyBox}>
          <Ionicons name="lock-closed-outline" size={40} color={COLORS.textMuted} />
          <Text style={styles.emptyTitle}>{tr('No tenés acceso a este viaje')}</Text>
          <TouchableOpacity style={styles.cta} onPress={() => router.replace('/viaje' as any)}>
            <Text style={styles.ctaText}>{tr('Mis viajes')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{trip.name}</Text>
        <TouchableOpacity onPress={shareCard} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="share-outline" size={22} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.primary} />}
      >
        {/* Members + real last-updated — no fake presence, ever */}
        <View style={styles.metaRow}>
          <View style={styles.membersRow}>
            {trip.members.map((m) => (
              <View key={m.user_id} style={styles.memberChip}>
                <Text style={styles.memberChipText}>{m.name}{m.role === 'owner' ? ' ★' : m.role === 'viewer' ? ' 👁' : ''}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.updatedText}>
            {tr('Actualizado')} {new Date(trip.updated_at).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>

        {trip.my_role === 'owner' ? (
          <TouchableOpacity style={styles.shareRow} onPress={share}>
            <Ionicons name="link-outline" size={16} color={COLORS.primary} />
            <Text style={styles.shareRowText}>
              {copied ? tr('¡Link copiado!') : trip.share_code ? tr('Copiar link de invitación') : tr('Invitar a mi grupo')}
            </Text>
          </TouchableOpacity>
        ) : null}

        {canEdit && trip.items.length > 1 ? (
          <TouchableOpacity style={styles.suggestRow} onPress={suggestOrder} disabled={suggesting}>
            <Ionicons name="sparkles-outline" size={15} color={COLORS.primary} />
            <Text style={styles.suggestText}>{suggesting ? tr('Calculando…') : tr('Sugerir orden del día')}</Text>
          </TouchableOpacity>
        ) : null}

        {trip.items.length > 0 ? (
          emailOpen ? (
            <View style={styles.suggestRow}>
              <Ionicons name="mail-outline" size={15} color={COLORS.primary} />
              <TextInput
                style={styles.emailInput}
                value={emailTo}
                onChangeText={setEmailTo}
                placeholder={tr('tu@email.com')}
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                onSubmitEditing={emailItinerary}
              />
              <TouchableOpacity onPress={emailItinerary} disabled={emailBusy} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.suggestText}>{emailDone ? tr('¡Enviado! ✓') : emailBusy ? tr('Enviando…') : tr('Enviar')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.suggestRow} onPress={() => setEmailOpen(true)}>
              <Ionicons name="mail-outline" size={15} color={COLORS.primary} />
              <Text style={styles.suggestText}>{tr('Enviar itinerario por email')}</Text>
            </TouchableOpacity>
          )
        ) : null}

        {/* Items grouped by day */}
        {grouped.map(([day, items]) => (
          <View key={String(day)} style={{ marginTop: SPACING.md }}>
            <Text style={styles.dayHeader}>{day === null ? tr('Ideas sin día') : `${tr('Día')} ${day}`}</Text>
            {items.map((it) => {
              const nm = displayName(it);
              const gone = it.resolved === false;
              return (
                <TouchableOpacity
                  key={it.item_id}
                  style={[styles.itemRow, gone && { opacity: 0.6 }]}
                  onPress={() => {
                    if (gone) return;
                    if (it.ref_type === 'venue' && it.ref_id) router.push({ pathname: '/partner/[id]' as any, params: { id: it.ref_id } });
                    else if (it.ref_type === 'experience' && it.ref_id) router.push({ pathname: '/partner-event/[id]' as any, params: { id: it.ref_id } });
                  }}
                  onLongPress={() => canEdit && setEditItem(it)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName} numberOfLines={1}>
                      {it.time_slot ? `${it.time_slot} · ` : ''}{nm}
                    </Text>
                    <Text style={styles.itemMeta} numberOfLines={1}>
                      {gone ? tr('ya no disponible') + ' · ' : ''}
                      {it.venue?.neighborhood || it.venue?.zone ? `${it.venue.neighborhood || it.venue.zone} · ` : ''}
                      {it.added_by_name ? `${it.added_by_name} ${tr('lo agregó')}` : ''}
                      {it.note ? ` · ${it.note}` : ''}
                    </Text>
                  </View>
                  {canEdit ? (
                    <TouchableOpacity onPress={() => setEditItem(it)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="ellipsis-horizontal" size={18} color={COLORS.textMuted} />
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity style={styles.voteBtn} onPress={() => vote(it)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}>
                    <Ionicons name={it.votes?.length ? 'heart' : 'heart-outline'} size={16} color={it.votes?.length ? '#EF4444' : COLORS.textMuted} />
                    {it.votes?.length ? <Text style={styles.voteCount}>{it.votes.length}</Text> : null}
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}

        {!trip.items.length ? (
          <View style={styles.emptyBox}>
            <Ionicons name="compass-outline" size={40} color={COLORS.primary} />
            <Text style={styles.emptyTitle}>{tr('Todavía no hay planes')}</Text>
            <Text style={styles.emptyText}>{tr('Agregá lugares con el botón "Agregar a mi viaje" en cualquier venue, colección o recomendación de Luna.')}</Text>
            <TouchableOpacity style={styles.cta} onPress={() => router.push('/(tabs)/explore' as any)}>
              <Text style={styles.ctaText}>{tr('Explorar Cartagena')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {canEdit ? (
          <View style={styles.customRow}>
            <TextInput
              style={styles.input}
              placeholder={tr('Agregar algo propio ("almuerzo con Ana")')}
              placeholderTextColor={COLORS.textMuted}
              value={customText}
              onChangeText={setCustomText}
              maxLength={120}
              onSubmitEditing={addCustom}
            />
            <TouchableOpacity style={styles.cta} onPress={addCustom}>
              <Ionicons name="add" size={18} color="#0A0A0A" />
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>

      {/* Item editor sheet: day / time / status / delete */}
      <Modal visible={!!editItem} transparent animationType="fade" onRequestClose={() => setEditItem(null)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setEditItem(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet} onPress={() => {}}>
            {editItem ? (
              <>
                <Text style={styles.sheetTitle} numberOfLines={1}>{displayName(editItem)}</Text>
                <Text style={styles.sheetLabel}>{tr('Día')}</Text>
                <View style={styles.dayPills}>
                  {DAY_OPTIONS.map((d) => (
                    <TouchableOpacity
                      key={String(d)}
                      style={[styles.dayPill, (editItem.day ?? null) === d && styles.dayPillActive]}
                      onPress={() => patchItem(editItem, { day: d ?? 0 })}
                    >
                      <Text style={[styles.dayPillText, (editItem.day ?? null) === d && styles.dayPillTextActive]}>
                        {d === null ? tr('Sin día') : d}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.sheetLabel}>{tr('Estado')}</Text>
                <View style={styles.dayPills}>
                  {(['idea', 'planned', 'done'] as const).map((s) => (
                    <TouchableOpacity
                      key={s}
                      style={[styles.dayPill, editItem.status === s && styles.dayPillActive]}
                      onPress={() => patchItem(editItem, { status: s })}
                    >
                      <Text style={[styles.dayPillText, editItem.status === s && styles.dayPillTextActive]}>
                        {s === 'idea' ? tr('Idea') : s === 'planned' ? tr('Planeado') : tr('Hecho')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity style={styles.deleteRow} onPress={() => removeItem(editItem)}>
                  <Ionicons name="trash-outline" size={16} color="#EF4444" />
                  <Text style={styles.deleteText}>{tr('Quitar del viaje')}</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

function displayName(it: Item): string {
  return it.venue?.name || it.experience?.title || it.stamp?.name || it.ref_name || it.custom_text || '—';
}

function groupByDay(items: Item[]): [number | null, Item[]][] {
  const map = new Map<number | null, Item[]>();
  for (const it of items) {
    const d = it.day ?? null;
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(it);
  }
  const days = [...map.keys()].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });
  return days.map((d) => [d, (map.get(d) || []).sort((x, y) => (x.order || 0) - (y.order || 0))]);
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
  },
  headerTitle: { color: COLORS.textMain, fontSize: 17, ...FONTS.bold, flex: 1, textAlign: 'center' },
  metaRow: { gap: 6 },
  membersRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  memberChip: {
    backgroundColor: 'rgba(18,181,165,0.1)', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(18,181,165,0.25)',
  },
  memberChipText: { color: COLORS.primary, fontSize: 12, ...FONTS.semibold },
  updatedText: { color: COLORS.textMuted, fontSize: 11 },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SPACING.sm },
  shareRowText: { color: COLORS.primary, fontSize: 13, ...FONTS.semibold },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SPACING.xs },
  suggestText: { color: COLORS.primary, fontSize: 13, ...FONTS.semibold },
  emailInput: { flex: 1, color: COLORS.textMain, fontSize: 13, ...FONTS.regular, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  dayHeader: { color: COLORS.textMain, fontSize: 15, ...FONTS.bold, marginBottom: 6 },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.md,
    marginBottom: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
  },
  itemName: { color: COLORS.textMain, fontSize: 14, ...FONTS.semibold },
  itemMeta: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  voteBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  voteCount: { color: COLORS.textMuted, fontSize: 12 },
  emptyBox: { alignItems: 'center', gap: 10, paddingVertical: SPACING.xl, paddingHorizontal: SPACING.lg },
  emptyTitle: { color: COLORS.textMain, fontSize: 16, ...FONTS.bold, textAlign: 'center' },
  emptyText: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  cta: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.md,
    paddingVertical: 11, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center',
  },
  ctaText: { color: '#0A0A0A', fontSize: 14, ...FONTS.bold },
  customRow: { flexDirection: 'row', gap: 8, marginTop: SPACING.lg },
  input: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 10, color: COLORS.textMain, fontSize: 13,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#101014', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: SPACING.lg, borderWidth: 1, borderColor: 'rgba(18,181,165,0.2)',
  },
  sheetTitle: { color: COLORS.textMain, fontSize: 16, ...FONTS.bold, marginBottom: SPACING.sm },
  sheetLabel: { color: COLORS.textMuted, fontSize: 12, marginTop: SPACING.sm, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  dayPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dayPill: {
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7,
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  dayPillActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  dayPillText: { color: COLORS.textMain, fontSize: 13, ...FONTS.semibold },
  dayPillTextActive: { color: '#0A0A0A' },
  deleteRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SPACING.lg, justifyContent: 'center', paddingVertical: 8 },
  deleteText: { color: '#EF4444', fontSize: 14, ...FONTS.semibold },
});
