// Drop 10 — "Agregar a mi viaje": the one-tap add that feeds the planner from
// every surface the gold lives on (venue detail, collection cards, Luna cards,
// search results, gems, seasonal/event cards).
//
// Fail-soft + never-wall: signed-out users can browse everything — tapping add
// prompts sign-in contextually (I6), it never blocks the surface underneath.
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput,
  ActivityIndicator, ScrollView, Platform,
} from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useSignupGate } from '../context/SignupGateContext';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { api } from '../constants/api';
import { useTr } from '../i18n/autoTr';

type RefType = 'venue' | 'experience' | 'stamp';

interface Props {
  refType: RefType;
  refId: string;
  name?: string;           // display name for the toast
  compact?: boolean;       // icon-only chip (cards) vs labeled button (detail)
  style?: any;
}

type TripRow = { trip_id: string; name: string; items_count: number; my_role: string };

export default function AddToTrip({ refType, refId, name, compact, style }: Props) {
  const tr = useTr();
  const router = useRouter();
  const pathname = usePathname();
  const { openGate } = useSignupGate();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [done, setDone] = useState<string | null>(null); // trip name we added to

  const openPicker = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/trips/mine');
      if (res?.error === 'unauthorized' || res?.status === 401 || res?.detail === 'Not authenticated') {
        openGate({ action: 'add_trip', next: pathname });
        return;
      }
      setTrips((res?.trips || []).filter((t: TripRow) => t.my_role !== 'viewer'));
      setOpen(true);
    } catch {
      openGate({ action: 'add_trip', next: pathname });
    } finally {
      setLoading(false);
    }
  }, [openGate, pathname]);

  const addTo = useCallback(async (trip: TripRow) => {
    setLoading(true);
    try {
      const res = await api.post(`/trips/${trip.trip_id}/items`, { ref_type: refType, ref_id: refId });
      if (res?.item_id) {
        setDone(trip.name);
        setTimeout(() => { setDone(null); setOpen(false); }, 1400);
      }
    } finally {
      setLoading(false);
    }
  }, [refType, refId]);

  const createAndAdd = useCallback(async () => {
    const nm = newName.trim();
    if (!nm) return;
    setLoading(true);
    try {
      const t = await api.post('/trips', { name: nm });
      if (t?.trip_id) {
        setCreating(false);
        setNewName('');
        await addTo({ trip_id: t.trip_id, name: t.name, items_count: 0, my_role: 'owner' });
      }
    } finally {
      setLoading(false);
    }
  }, [newName, addTo]);

  return (
    <>
      {compact ? (
        <TouchableOpacity
          onPress={openPicker}
          style={[styles.chip, style]}
          accessibilityLabel={tr('Agregar a mi viaje')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {loading && !open ? (
            <ActivityIndicator size="small" color={COLORS.primary} />
          ) : (
            <Ionicons name="briefcase-outline" size={16} color={COLORS.primary} />
          )}
        </TouchableOpacity>
      ) : (
        <TouchableOpacity onPress={openPicker} style={[styles.button, style]}>
          {loading && !open ? (
            <ActivityIndicator size="small" color="#0A0A0A" />
          ) : (
            <Ionicons name="briefcase-outline" size={16} color="#0A0A0A" />
          )}
          <Text style={styles.buttonText}>{tr('Agregar a mi viaje')}</Text>
        </TouchableOpacity>
      )}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet} onPress={() => {}}>
            {done ? (
              <View style={styles.doneBox}>
                <Ionicons name="checkmark-circle" size={34} color="#22C55E" />
                <Text style={styles.doneText}>{tr('Agregado a')} “{done}”</Text>
              </View>
            ) : (
              <>
                <Text style={styles.title}>{tr('Agregar a mi viaje')}</Text>
                {name ? <Text style={styles.subtitle} numberOfLines={1}>{name}</Text> : null}
                <ScrollView style={{ maxHeight: 260 }}>
                  {trips.map((t) => (
                    <TouchableOpacity key={t.trip_id} style={styles.row} onPress={() => addTo(t)}>
                      <Ionicons name="briefcase" size={18} color={COLORS.primary} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowName} numberOfLines={1}>{t.name}</Text>
                        <Text style={styles.rowMeta}>{t.items_count} {tr('planes')}</Text>
                      </View>
                      <Ionicons name="add-circle-outline" size={20} color={COLORS.primary} />
                    </TouchableOpacity>
                  ))}
                  {!trips.length && !creating ? (
                    <Text style={styles.empty}>{tr('Todavía no tenés viajes — creá el primero.')}</Text>
                  ) : null}
                </ScrollView>
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
                      onSubmitEditing={createAndAdd}
                    />
                    <TouchableOpacity style={styles.createBtn} onPress={createAndAdd} disabled={loading}>
                      {loading ? <ActivityIndicator size="small" color="#0A0A0A" /> : <Text style={styles.createBtnText}>{tr('Crear')}</Text>}
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.newTrip} onPress={() => setCreating(true)}>
                    <Ionicons name="add" size={18} color={COLORS.primary} />
                    <Text style={styles.newTripText}>{tr('Nuevo viaje')}</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  chip: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(245,11,27,0.12)', borderWidth: 1, borderColor: 'rgba(245,11,27,0.35)',
  },
  button: {
    flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center',
    backgroundColor: COLORS.primary, borderRadius: RADIUS.md,
    paddingVertical: 12, paddingHorizontal: SPACING.md,
  },
  buttonText: { color: '#0A0A0A', fontSize: 14, ...FONTS.bold },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#101014', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: SPACING.lg, paddingBottom: Platform.OS === 'web' ? SPACING.lg : SPACING.xl,
    borderWidth: 1, borderColor: 'rgba(245,11,27,0.2)',
  },
  title: { color: COLORS.textMain, fontSize: 17, ...FONTS.bold },
  subtitle: { color: COLORS.textMuted, fontSize: 13, marginTop: 2, marginBottom: SPACING.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  rowName: { color: COLORS.textMain, fontSize: 15, ...FONTS.semibold },
  rowMeta: { color: COLORS.textMuted, fontSize: 12 },
  empty: { color: COLORS.textMuted, fontSize: 13, paddingVertical: SPACING.md, textAlign: 'center' },
  newTrip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: SPACING.md, justifyContent: 'center' },
  newTripText: { color: COLORS.primary, fontSize: 14, ...FONTS.semibold },
  createRow: { flexDirection: 'row', gap: 8, marginTop: SPACING.md },
  input: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 10, color: COLORS.textMain, fontSize: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  createBtn: {
    backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingHorizontal: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  createBtnText: { color: '#0A0A0A', fontSize: 14, ...FONTS.bold },
  doneBox: { alignItems: 'center', gap: 8, paddingVertical: SPACING.lg },
  doneText: { color: COLORS.textMain, fontSize: 15, ...FONTS.semibold },
});
