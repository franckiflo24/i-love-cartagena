// "Lo probé" — plate check-in on partner detail (Walking Layer Drop 3).
//
// Renders ONLY when this venue anchors at least one Sabores plate; otherwise
// nothing (fail-soft, zero footprint). The server is the honesty gate (≤75m):
// out of range gets a clear message — "acércate al lugar para sellarlo" —
// never a silent fail, never a couch check-in. Guests get a contextual
// sign-in invitation, never a wall.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { useTr } from '../i18n/autoTr';
import { useAuth } from '../context/AuthContext';
import { geoService } from '../lib/geo';
import { getCollections, getPassport, discover, platesForVenue, PlateDef } from '../lib/passport';
import { StampCelebration, CelebrationData } from './StampCelebration';

export function LoProbe({ partnerId }: { partnerId: string }) {
  const tr = useTr();
  const router = useRouter();
  const { user } = useAuth();
  const [plates, setPlates] = useState<PlateDef[]>([]);
  const [stamped, setStamped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<CelebrationData | null>(null);

  useEffect(() => {
    let alive = true;
    getCollections().then((cols) => {
      if (!alive) return;
      const p = platesForVenue(cols, partnerId);
      setPlates(p);
      if (p.length > 0 && user?.user_id) {
        getPassport(user.user_id).then(({ data }) => {
          if (!alive || !data) return;
          setStamped(new Set(
            data.discoveries
              .filter((d) => d.type === 'dish' && d.venue_id === partnerId && d.plate)
              .map((d) => d.plate as string),
          ));
        }).catch(() => {});
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, [partnerId, user?.user_id]);

  const checkIn = useCallback(async (plate: PlateDef) => {
    if (!user) {
      setNotice(tr('Inicia sesión y guarda tu pasaporte para siempre'));
      setTimeout(() => {
        setNotice(null);
        router.push('/login' as any);
      }, 1200);
      return;
    }
    setBusy(plate.key);
    setNotice(null);
    try {
      // The 75m gate needs a FRESH fix — a stale position could stamp (or
      // reject) from where the user WAS. >15s old → re-request.
      let pos = geoService.getState().position;
      if (!pos || Date.now() - pos.ts > 15000) {
        await geoService.request(); // user-gesture context
        pos = geoService.getState().position;
      }
      if (!pos) {
        setNotice(tr('Activa tu ubicación para sellar tu pasaporte'));
        return;
      }
      const res = await discover(partnerId, 'dish', pos.lat, pos.lng, plate.key);
      setStamped((prev) => new Set(prev).add(plate.key));
      if (res && !res.already_discovered) {
        setCelebration({
          venueName: plate.name,
          points: res.points_earned || 0,
          achievements: (res.new_achievements || []).map((a) => a.key),
          rankUp: res.rank_up && res.rank ? res.rank : null,
          specials: res.new_specials || [],
          completions: res.completed_collections || [],
        });
      } else {
        setNotice(tr('Ya está en tu pasaporte'));
      }
    } catch (e: any) {
      const msg = String(e?.message || '');
      setNotice(msg.includes('too far')
        ? tr('Acércate al lugar para sellarlo')
        : tr('No se pudo sellar — intenta de nuevo'));
    } finally {
      setBusy(null);
      setTimeout(() => setNotice(null), 4000);
    }
  }, [user, partnerId, router, tr]);

  if (plates.length === 0) return null;

  return (
    <View style={styles.box}>
      <View style={styles.header}>
        <Ionicons name="ribbon" size={14} color={COLORS.primary} />
        <Text style={styles.title}>{tr('Sella tu pasaporte')}</Text>
        <TouchableOpacity onPress={() => router.push('/pasaporte' as any)} hitSlop={{ top: 8, bottom: 8 }}>
          <Text style={styles.link}>{tr('Mi Pasaporte')}</Text>
        </TouchableOpacity>
      </View>
      {plates.map((p) => {
        const done = stamped.has(p.key);
        return (
          <TouchableOpacity
            key={p.key}
            style={[styles.row, done && styles.rowDone]}
            onPress={() => !done && checkIn(p)}
            disabled={done || busy !== null}
            activeOpacity={0.8}
          >
            <Text style={[styles.plateName, done && styles.plateNameDone]} numberOfLines={1}>{p.name}</Text>
            {busy === p.key ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : done ? (
              <View style={styles.doneChip}>
                <Ionicons name="checkmark" size={11} color="#000" />
                <Text style={styles.doneChipText}>{tr('Sellado')}</Text>
              </View>
            ) : (
              <View style={styles.ctaChip}>
                <Text style={styles.ctaChipText}>{tr('Lo probé')}</Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
      {!!notice && <Text style={styles.notice}>{notice}</Text>}
      <StampCelebration data={celebration} onClose={() => setCelebration(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: SPACING.md, backgroundColor: 'rgba(245,11,27,0.06)', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(245,11,27,0.3)', padding: SPACING.md, gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flex: 1, fontSize: 13, color: COLORS.textMain, ...FONTS.bold },
  link: { fontSize: 11, color: COLORS.primary, ...FONTS.semibold },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, paddingVertical: 9, paddingHorizontal: 12 },
  rowDone: { borderColor: 'rgba(245,11,27,0.5)' },
  plateName: { flex: 1, fontSize: 13, color: COLORS.textMain, ...FONTS.semibold },
  plateNameDone: { color: COLORS.textMuted },
  ctaChip: { backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 5 },
  ctaChipText: { fontSize: 11, color: '#000', ...FONTS.bold },
  doneChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(245,11,27,0.85)', borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 5 },
  doneChipText: { fontSize: 10, color: '#000', ...FONTS.bold },
  notice: { fontSize: 12, color: COLORS.primary, ...FONTS.semibold, textAlign: 'center', marginTop: 2 },
});

export default LoProbe;
