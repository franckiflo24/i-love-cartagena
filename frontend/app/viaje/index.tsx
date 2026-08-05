// Drop 10 — MI VIAJE: my trips (list + create). Solo-first: one user with no
// group gets a fully working planner; collaboration is additive, never a wall.
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { useTr } from '../../src/i18n/autoTr';

type TripRow = {
  trip_id: string; name: string; dates?: { start?: string; end?: string } | null;
  members_count: number; items_count: number; my_role: string; updated_at: string;
};

export default function MisViajesScreen() {
  const tr = useTr();
  const router = useRouter();
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/trips/mine');
      setTrips(res?.trips || []);
      setNeedsLogin(false);
    } catch {
      setNeedsLogin(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const create = useCallback(async () => {
    const nm = newName.trim();
    if (!nm || saving) return;
    setSaving(true);
    try {
      const t = await api.post('/trips', { name: nm });
      if (t?.trip_id) {
        setNewName('');
        setCreating(false);
        router.push({ pathname: '/viaje/[id]' as any, params: { id: t.trip_id } });
      }
    } catch { /* rate-limit / offline — keep the form open */ } finally {
      setSaving(false);
    }
  }, [newName, saving, router]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{tr('Mi Viaje')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: SPACING.lg, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.primary} />}
      >
        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 60 }} />
        ) : needsLogin ? (
          <View style={styles.emptyBox}>
            <Ionicons name="briefcase-outline" size={44} color={COLORS.primary} />
            <Text style={styles.emptyTitle}>{tr('Planeá tu viaje a Cartagena')}</Text>
            <Text style={styles.emptyText}>{tr('Guardá lugares, armá tus días y planeá en grupo. Iniciá sesión para empezar.')}</Text>
            <TouchableOpacity style={styles.cta} onPress={() => router.push('/login' as any)}>
              <Text style={styles.ctaText}>{tr('Iniciar sesión')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {trips.map((t) => (
              <TouchableOpacity
                key={t.trip_id}
                style={styles.card}
                onPress={() => router.push({ pathname: '/viaje/[id]' as any, params: { id: t.trip_id } })}
              >
                <View style={styles.cardIcon}>
                  <Ionicons name="briefcase" size={20} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardName} numberOfLines={1}>{t.name}</Text>
                  <Text style={styles.cardMeta}>
                    {t.dates?.start ? `${t.dates.start}${t.dates.end ? ` → ${t.dates.end}` : ''} · ` : ''}
                    {t.items_count} {tr('planes')} · {t.members_count} {t.members_count === 1 ? tr('viajero') : tr('viajeros')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            ))}

            {!trips.length && !creating ? (
              <View style={styles.emptyBox}>
                <Ionicons name="map-outline" size={44} color={COLORS.primary} />
                <Text style={styles.emptyTitle}>{tr('Tu primer viaje empieza acá')}</Text>
                <Text style={styles.emptyText}>{tr('Creá un viaje, agregá lugares desde cualquier parte de la app y compartilo con tu grupo.')}</Text>
              </View>
            ) : null}

            {creating ? (
              <View style={styles.createRow}>
                <TextInput
                  style={styles.input}
                  placeholder={tr('Nombre del viaje')}
                  placeholderTextColor={COLORS.textMuted}
                  value={newName}
                  onChangeText={setNewName}
                  maxLength={80}
                  autoFocus
                  onSubmitEditing={create}
                />
                <TouchableOpacity style={styles.cta} onPress={create} disabled={saving}>
                  {saving ? <ActivityIndicator size="small" color="#0A0A0A" /> : <Text style={styles.ctaText}>{tr('Crear')}</Text>}
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.newBtn} onPress={() => setCreating(true)}>
                <Ionicons name="add" size={20} color="#0A0A0A" />
                <Text style={styles.newBtnText}>{tr('Nuevo viaje')}</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
  },
  headerTitle: { color: COLORS.textMain, fontSize: 18, ...FONTS.bold },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.md,
    marginBottom: SPACING.sm, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  cardIcon: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(212,175,55,0.12)',
  },
  cardName: { color: COLORS.textMain, fontSize: 16, ...FONTS.semibold },
  cardMeta: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  emptyBox: { alignItems: 'center', gap: 10, paddingVertical: SPACING.xl, paddingHorizontal: SPACING.lg },
  emptyTitle: { color: COLORS.textMain, fontSize: 17, ...FONTS.bold, textAlign: 'center' },
  emptyText: { color: COLORS.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  cta: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.md,
    paddingVertical: 12, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center',
  },
  ctaText: { color: '#0A0A0A', fontSize: 14, ...FONTS.bold },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: 14,
    marginTop: SPACING.md,
  },
  newBtnText: { color: '#0A0A0A', fontSize: 15, ...FONTS.bold },
  createRow: { flexDirection: 'row', gap: 8, marginTop: SPACING.md },
  input: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 10, color: COLORS.textMain, fontSize: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
});
