// Drop 10 — shared trip GUEST VIEW (I6: never wall the view). Anyone with the
// link sees the itinerary; joining/editing prompts sign-in contextually.
// This is also the acquisition loop: the trip pulls the friend group in.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../../src/constants/theme';
import { api, API_BASE } from '../../../src/constants/api';
import { useTr } from '../../../src/i18n/autoTr';
import { useSignupGate } from '../../../src/context/SignupGateContext';
import { markArchetype } from '../../../src/lib/gateAnalytics';

type GuestItem = {
  item_id: string; ref_type: string; ref_id?: string | null; ref_name?: string | null;
  custom_text?: string | null; added_by_name?: string; day?: number | null;
  time_slot?: string | null; note?: string | null; votes_count: number;
  resolved?: boolean; venue?: any; experience?: any; stamp?: any;
};

type GuestTrip = {
  name: string; dates?: { start?: string; end?: string } | null;
  members: { name: string }[]; updated_at: string; items: GuestItem[]; share_code: string;
};

export default function SharedTripScreen() {
  const tr = useTr();
  const router = useRouter();
  const { openGate } = useSignupGate();
  const { code } = useLocalSearchParams<{ code: string }>();
  const [trip, setTrip] = useState<GuestTrip | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinedMoment, setJoinedMoment] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Raw fetch: this endpoint is PUBLIC — works with no session at all.
      const res = await fetch(`${API_BASE}/trips/shared/${code}`);
      const _j = res.ok ? await res.json() : null;
      // Guard: a 200 with []/{} is truthy and slipped past `if (!trip)` → trip.members.map crashed.
      setTrip(_j && typeof _j === 'object' && !Array.isArray(_j) && (_j as any).trip_id ? _j : null);
    } catch {
      setTrip(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [code]);

  // Drop GATE (B1): arriving via a share link marks this visitor 'invited', so
  // every later wall + the eventual signup attribute to the invited archetype.
  useEffect(() => { markArchetype('invited'); }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const join = useCallback(async () => {
    if (!trip || joining) return;
    setJoining(true);
    try {
      const res = await api.post('/trips/join', { share_code: trip.share_code });
      if (res?.trip_id) {
        // 11C2: the connection is the payoff — a real shared moment, no fake reward
        const owner = trip.members[0]?.name?.split(' ')[0];
        setJoinedMoment(owner ? `Vos y ${owner} ahora planean juntos ✨` : '¡Ahora planean juntos! ✨');
        setTimeout(() => {
          router.replace({ pathname: '/viaje/[id]' as any, params: { id: res.trip_id } });
        }, 1600);
        return;
      }
    } catch {
      // Drop GATE (B1): trying to JOIN while logged-out fires the honest wall,
      // preserving ?next= to THIS trip so the invite loop survives login. The
      // guest VIEW stays open behind the modal — the preview is never walled.
      openGate({ action: 'join_trip', next: `/viaje/shared/${code}`, archetype: 'invited' });
    } finally {
      setJoining(false);
    }
  }, [trip, joining, openGate, code]);

  const grouped = groupByDay(trip?.items || []);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/' as any)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{tr('Viaje compartido')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.primary} />}
      >
        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 60 }} />
        ) : !trip ? (
          <View style={styles.emptyBox}>
            <Ionicons name="help-circle-outline" size={40} color={COLORS.textMuted} />
            <Text style={styles.emptyTitle}>{tr('Este viaje no existe o el link cambió')}</Text>
          </View>
        ) : (
          <>
            {trip.members[0]?.name ? (
              <Text style={styles.inviteLine}>
                {trip.members[0].name.split(' ')[0]} {tr('te invitó a su viaje a Cartagena')}
              </Text>
            ) : null}
            <Text style={styles.tripName}>{trip.name}</Text>
            {trip.dates?.start ? (
              <Text style={styles.tripDates}>{trip.dates.start}{trip.dates.end ? ` → ${trip.dates.end}` : ''}</Text>
            ) : null}
            <View style={styles.membersRow}>
              {trip.members.map((m, i) => (
                <View key={`${m.name}-${i}`} style={styles.memberChip}>
                  <Text style={styles.memberChipText}>{m.name}</Text>
                </View>
              ))}
            </View>

            {grouped.map(([day, items]) => (
              <View key={String(day)} style={{ marginTop: SPACING.md }}>
                <Text style={styles.dayHeader}>{day === null ? tr('Ideas sin día') : `${tr('Día')} ${day}`}</Text>
                {items.map((it) => {
                  const nm = it.venue?.name || it.experience?.title || it.stamp?.name || it.ref_name || it.custom_text || '—';
                  const gone = it.resolved === false;
                  return (
                    <View key={it.item_id} style={[styles.itemRow, gone && { opacity: 0.6 }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemName} numberOfLines={1}>
                          {it.time_slot ? `${it.time_slot} · ` : ''}{nm}
                        </Text>
                        <Text style={styles.itemMeta} numberOfLines={1}>
                          {gone ? tr('ya no disponible') + ' · ' : ''}
                          {it.added_by_name ? `${it.added_by_name} ${tr('lo agregó')}` : ''}
                        </Text>
                      </View>
                      {it.votes_count ? (
                        <View style={styles.voteBtn}>
                          <Ionicons name="heart" size={14} color="#EF4444" />
                          <Text style={styles.voteCount}>{it.votes_count}</Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {trip ? (
        <View style={styles.joinBar}>
          {joinedMoment ? (
            <View style={[styles.joinBtn, { backgroundColor: 'rgba(212,175,55,0.15)' }]}>
              <Text style={[styles.joinText, { color: COLORS.primary }]}>{joinedMoment}</Text>
            </View>
          ) : (
            <TouchableOpacity style={styles.joinBtn} onPress={join} disabled={joining}>
              {joining ? <ActivityIndicator size="small" color="#0A0A0A" /> : (
                <>
                  <Ionicons name="people" size={18} color="#0A0A0A" />
                  <Text style={styles.joinText}>{tr('Únete a este viaje')}</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function groupByDay(items: GuestItem[]): [number | null, GuestItem[]][] {
  const map = new Map<number | null, GuestItem[]>();
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
  return days.map((d) => [d, map.get(d) || []]);
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
  },
  headerTitle: { color: COLORS.textMain, fontSize: 17, ...FONTS.bold },
  inviteLine: { color: '#F5D47A', fontSize: 15, ...FONTS.semibold, marginBottom: 6 },
  tripName: { color: COLORS.textMain, fontSize: 22, ...FONTS.bold },
  tripDates: { color: COLORS.textMuted, fontSize: 13, marginTop: 2 },
  membersRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: SPACING.sm },
  memberChip: {
    backgroundColor: 'rgba(212,175,55,0.1)', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
  },
  memberChipText: { color: COLORS.primary, fontSize: 12, ...FONTS.semibold },
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
  emptyBox: { alignItems: 'center', gap: 10, paddingVertical: SPACING.xl },
  emptyTitle: { color: COLORS.textMain, fontSize: 16, ...FONTS.bold, textAlign: 'center' },
  joinBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0, padding: SPACING.lg,
    backgroundColor: 'rgba(10,10,12,0.94)', borderTopWidth: 1, borderTopColor: 'rgba(212,175,55,0.2)',
  },
  joinBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: 14,
  },
  joinText: { color: '#0A0A0A', fontSize: 15, ...FONTS.bold },
});
