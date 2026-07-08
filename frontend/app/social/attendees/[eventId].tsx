/**
 * Amo Together — Full attendee list for an event.
 * Route: /social/attendees/[eventId]
 *
 * Two sections:
 *   1. Solo & Open (hero cards with match score, filters available)
 *   2. Other attendees (compact avatar grid, no CTA)
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Image, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../../src/constants/api';
import { UserBadge } from '../../../src/components/UserBadge';

type SoloCard = {
  user_id: string;
  display_name: string;
  photo_url?: string;
  badge?: { type: string; icon: string; color: string; title: string; subtitle: string };
  vibes?: string[];
  languages?: string[];
  bio?: string;
  match?: { common_vibes: string[]; common_languages: string[]; score: number };
};

type OtherAvatar = {
  user_id: string;
  display_name: string;
  photo_url?: string;
  user_type: 'local' | 'tourist';
};

type Filter = 'all' | 'locals' | 'tourists';

export default function AttendeesScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [event, setEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    try {
      const [attendees, ev] = await Promise.all([
        api.get(`/events/${eventId}/attendees`),
        api.get(`/partner-events/${eventId}`).catch(() => null),
      ]);
      setData(attendees);
      setEvent(ev);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Impossible de charger les participants');
    }
    setLoading(false);
    setRefreshing(false);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const solo: SoloCard[] = useMemo(() => {
    const list: SoloCard[] = data?.solo_open || [];
    if (filter === 'locals') return list.filter(u => u.badge?.type === 'local');
    if (filter === 'tourists') return list.filter(u => u.badge?.type === 'tourist');
    return list;
  }, [data, filter]);

  const others: OtherAvatar[] = data?.others || [];

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator style={{ flex: 1 }} size="large" color="#FBBF24" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor="#FBBF24"
          />
        }
      >

        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color="white" />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.headerTitle}>Participants</Text>
            {event?.title && <Text style={styles.headerSub} numberOfLines={1}>{event.title}</Text>}
          </View>
        </View>

        {/* Counters */}
        <View style={styles.countersRow}>
          <View style={styles.counter}>
            <Text style={styles.counterVal}>{data?.total || 0}</Text>
            <Text style={styles.counterLbl}>Total</Text>
          </View>
          <View style={[styles.counter, { backgroundColor: 'rgba(251,191,36,0.10)', borderColor: 'rgba(251,191,36,0.3)' }]}>
            <Text style={[styles.counterVal, { color: '#FBBF24' }]}>{data?.solo_open_count || 0}</Text>
            <Text style={[styles.counterLbl, { color: '#FBBF24' }]}>Solo ouvert(e)s ✨</Text>
          </View>
        </View>

        {/* Filters */}
        <View style={styles.filters}>
          {([
            { k: 'all',      label: 'Tous',      icon: '👥' },
            { k: 'tourists', label: 'Voyageurs', icon: '✈️' },
            { k: 'locals',   label: 'Locaux',    icon: '🏛️' },
          ] as { k: Filter; label: string; icon: string }[]).map(f => (
            <TouchableOpacity
              key={f.k}
              style={[styles.filterChip, filter === f.k && styles.filterChipActive]}
              onPress={() => setFilter(f.k)}
            >
              <Text style={[styles.filterChipTxt, filter === f.k && { color: '#0A0A0A' }]}>
                {f.icon} {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Solo & Open section */}
        {solo.length > 0 && (
          <>
            <View style={styles.sectionHead}>
              <Text style={{ fontSize: 16 }}>✨</Text>
              <Text style={styles.sectionTitle}>Ouvert(e)s à rencontrer ({solo.length})</Text>
            </View>
            {solo.map(u => (
              <TouchableOpacity
                key={u.user_id}
                style={styles.attCard}
                activeOpacity={0.85}
                onPress={() => router.push({ pathname: '/social/user/[uid]', params: { uid: u.user_id, event_id: eventId } } as any)}
                testID={`attendee-${u.user_id}`}
              >
                {u.photo_url ? (
                  <Image source={{ uri: u.photo_url }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder]}>
                    <Text style={styles.avatarInitial}>{(u.display_name?.[0] || '?').toUpperCase()}</Text>
                  </View>
                )}
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.attName}>{u.display_name}</Text>
                  {u.badge && (
                    <UserBadge
                      type={u.badge.type as any}
                      city={u.badge.title.replace(/^(Local|Voyageur) · /, '')}
                      subtitle={u.badge.subtitle}
                      size="sm"
                    />
                  )}
                  {u.match && (u.match.score > 0) && (
                    <View style={styles.matchRow}>
                      <Text style={styles.matchTxt}>
                        🎯 <Text style={styles.matchStrong}>{u.match.common_vibes.length} vibes</Text>
                        {' · '}
                        <Text style={styles.matchStrong}>{u.match.common_languages.length} langues</Text> en commun
                      </Text>
                    </View>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={20} color="#94A3B8" />
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* Others section */}
        {others.length > 0 && (
          <>
            <View style={styles.sectionHead}>
              <Ionicons name="people-outline" size={16} color="#94A3B8" />
              <Text style={styles.sectionTitle}>Autres participants ({others.length})</Text>
            </View>
            <View style={styles.othersGrid}>
              {others.map(u => (
                <View key={u.user_id} style={[styles.otherAvatar, { backgroundColor: u.user_type === 'local' ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.15)' }]}>
                  {u.photo_url ? (
                    <Image source={{ uri: u.photo_url }} style={styles.otherAvatarImg} />
                  ) : (
                    <Text style={styles.otherInitial}>{(u.display_name?.[0] || '?').toUpperCase()}</Text>
                  )}
                </View>
              ))}
            </View>
            <Text style={styles.privacyHint}>
              🔒 Les autres participants sont visibles mais pas cherchables. Ils gardent leur intimité.
            </Text>
          </>
        )}

        {/* Empty state */}
        {solo.length === 0 && others.length === 0 && (
          <View style={styles.emptyBox}>
            <Ionicons name="people-outline" size={48} color="#475569" />
            <Text style={styles.emptyTitle}>Personne encore</Text>
            <Text style={styles.emptyDesc}>
              Sois le/la premier(ère) à confirmer ta présence sur cet événement. Ton badge apparaîtra ici.
            </Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={() => router.back()}>
              <Text style={styles.emptyBtnTxt}>Retour à l'événement</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Not enabled */}
        {data?.me && !data.me.attending && (
          <View style={styles.enrollBox}>
            <Ionicons name="information-circle" size={20} color="#3B82F6" />
            <View style={{ flex: 1 }}>
              <Text style={styles.enrollTitle}>Tu ne participes pas encore</Text>
              <Text style={styles.enrollDesc}>
                Retourne sur la page de l'événement pour confirmer ta présence et devenir découvrable par les autres participants.
              </Text>
            </View>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: 'white' },
  headerSub: { fontSize: 12, color: '#94A3B8', marginTop: 2 },

  countersRow: { flexDirection: 'row', gap: 10 },
  counter: {
    flex: 1, padding: 12, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
  },
  counterVal: { fontSize: 20, fontWeight: '800', color: 'white' },
  counterLbl: { fontSize: 11, color: '#94A3B8', marginTop: 3, fontWeight: '600' },

  filters: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  filterChip: {
    paddingVertical: 7, paddingHorizontal: 14, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  filterChipActive: { backgroundColor: '#FBBF24', borderColor: '#FBBF24' },
  filterChipTxt: { fontSize: 12, color: 'white', fontWeight: '700' },

  sectionHead: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: 'white' },

  attCard: {
    flexDirection: 'row', gap: 12, padding: 14,
    backgroundColor: 'rgba(251,191,36,0.05)', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(251,191,36,0.25)',
    alignItems: 'center',
  },
  avatar: { width: 54, height: 54, borderRadius: 27, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)' },
  avatarPlaceholder: { backgroundColor: '#3B82F6', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 22, fontWeight: '800', color: 'white' },
  attName: { fontSize: 16, fontWeight: '800', color: 'white' },
  matchRow: { marginTop: 4 },
  matchTxt: { fontSize: 11.5, color: '#CBD5E1' },
  matchStrong: { fontWeight: '800', color: '#FBBF24' },

  othersGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  otherAvatar: {
    width: 46, height: 46, borderRadius: 23,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  otherAvatarImg: { width: '100%', height: '100%', borderRadius: 23 },
  otherInitial: { fontSize: 18, fontWeight: '800', color: 'white' },
  privacyHint: { fontSize: 11, color: '#64748B', fontStyle: 'italic', marginTop: 4 },

  emptyBox: { alignItems: 'center', gap: 10, padding: 30 },
  emptyTitle: { fontSize: 18, color: 'white', fontWeight: '700' },
  emptyDesc: { fontSize: 13, color: '#94A3B8', textAlign: 'center', lineHeight: 19 },
  emptyBtn: { marginTop: 10, backgroundColor: '#FBBF24', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 22 },
  emptyBtnTxt: { color: '#0A0A0A', fontWeight: '800' },

  enrollBox: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    padding: 14, borderRadius: 14,
    backgroundColor: 'rgba(59,130,246,0.08)',
    borderWidth: 1, borderColor: 'rgba(59,130,246,0.3)',
  },
  enrollTitle: { fontSize: 13, fontWeight: '800', color: 'white' },
  enrollDesc: { fontSize: 11.5, color: '#94A3B8', marginTop: 3, lineHeight: 16 },
});
