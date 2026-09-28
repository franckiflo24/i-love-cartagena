// "Lo probé" — plate check-in on partner detail (Walking Layer Drop 3).
//
// Renders ONLY when this venue anchors at least one Sabores plate; otherwise
// nothing (fail-soft, zero footprint). The server is the honesty gate (≤75m):
// out of range gets a clear message — "acércate al lugar para sellarlo" —
// never a silent fail, never a couch check-in. Guests get a contextual
// sign-in invitation, never a wall.
//
// Launch sweep 2026-09-28 — the in-range loop:
//   • every tap re-requested the GPS even with a fix seconds old, and a
//     stale-but-fine fix (15–60 s) forced a new permission round-trip on iOS;
//   • the 4 s notice timer (and the 1.2 s login redirect) kept firing after the
//     screen unmounted / on re-taps, so notices flickered and set state on a
//     dead component;
//   • an out-of-range user still POSTed and waited on the server 403.
// Now: one timer ref cleared on unmount + re-tap, a < 60 s fix is reused, and
// the distance to the venue (coords passed in by partner/[id]) is checked on
// the client FIRST — beyond SEAL_M the notice shows instantly, no network.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { useTr } from '../i18n/autoTr';
import { useAuth } from '../context/AuthContext';
import { geoService, haversineM } from '../lib/geo';
import { getCollections, getPassport, discover, platesForVenue, PlateDef } from '../lib/passport';
import { StampCelebration, CelebrationData } from './StampCelebration';

/** Mirrors backend/walking.py VERIFY_RADIUS_M — the server's honesty gate. */
export const SEAL_M = 75;
/** A fix younger than this is reused instead of re-requesting the GPS. */
const FRESH_FIX_MS = 60_000;
const NOTICE_MS = 4000;
const LOGIN_REDIRECT_MS = 1200;

type Props = {
  partnerId: string;
  /** Venue coordinates (null when the catalog only has the city-centre default). */
  venueLat?: number | null;
  venueLng?: number | null;
};

export function LoProbe({ partnerId, venueLat = null, venueLng = null }: Props) {
  const tr = useTr();
  const router = useRouter();
  const { user } = useAuth();
  const [plates, setPlates] = useState<PlateDef[]>([]);
  const [stamped, setStamped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<CelebrationData | null>(null);

  // One timer for notices / the login redirect; cleared on unmount and on every
  // new tap so a stale timeout can never wipe a fresh notice or fire after death.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);
  const schedule = useCallback((fn: () => void, ms: number) => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (mountedRef.current) fn();
    }, ms);
  }, [clearTimer]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; clearTimer(); };
  }, [clearTimer]);

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

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    schedule(() => setNotice(null), NOTICE_MS);
  }, [schedule]);

  const checkIn = useCallback(async (plate: PlateDef) => {
    clearTimer();
    if (!user) {
      setNotice(tr('Inicia sesión y guarda tu pasaporte para siempre'));
      schedule(() => {
        setNotice(null);
        router.push('/login' as any);
      }, LOGIN_REDIRECT_MS);
      return;
    }
    setBusy(plate.key);
    setNotice(null);
    try {
      // The 75 m gate needs a usable fix — but a fix under a minute old is one:
      // re-requesting on every tap was the loop (permission sheet + spinner
      // each time). Older than FRESH_FIX_MS → ask once, in the gesture context.
      let pos = geoService.getState().position;
      if (!pos || Date.now() - pos.ts > FRESH_FIX_MS) {
        await geoService.request();
        pos = geoService.getState().position;
      }
      if (!mountedRef.current) return;
      if (!pos) {
        showNotice(tr('Activa tu ubicación para sellar tu pasaporte'));
        return;
      }
      // Client-side pre-check against the venue: beyond the seal radius the
      // server would 403 anyway — say so now, with no round trip.
      if (typeof venueLat === 'number' && typeof venueLng === 'number'
          && Number.isFinite(venueLat) && Number.isFinite(venueLng)) {
        const distM = haversineM(pos.lat, pos.lng, venueLat, venueLng);
        if (distM > SEAL_M) {
          showNotice(tr('Acércate al lugar para sellarlo'));
          return;
        }
      }
      const res = await discover(partnerId, 'dish', pos.lat, pos.lng, plate.key);
      if (!mountedRef.current) return;
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
        showNotice(tr('Ya está en tu pasaporte'));
      }
    } catch (e: any) {
      if (!mountedRef.current) return;
      const msg = String(e?.message || '');
      showNotice(msg.includes('too far')
        ? tr('Acércate al lugar para sellarlo')
        : tr('No se pudo sellar — intenta de nuevo'));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }, [user, partnerId, venueLat, venueLng, router, tr, clearTimer, schedule, showNotice]);

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
  box: { marginTop: SPACING.md, backgroundColor: 'rgba(18,181,165,0.06)', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(18,181,165,0.3)', padding: SPACING.md, gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flex: 1, fontSize: 13, color: COLORS.textMain, ...FONTS.bold },
  link: { fontSize: 11, color: COLORS.primary, ...FONTS.semibold },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, paddingVertical: 9, paddingHorizontal: 12 },
  rowDone: { borderColor: 'rgba(18,181,165,0.5)' },
  plateName: { flex: 1, fontSize: 13, color: COLORS.textMain, ...FONTS.semibold },
  plateNameDone: { color: COLORS.textMuted },
  ctaChip: { backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 5 },
  ctaChipText: { fontSize: 11, color: '#000', ...FONTS.bold },
  doneChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(18,181,165,0.85)', borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 5 },
  doneChipText: { fontSize: 10, color: '#000', ...FONTS.bold },
  notice: { fontSize: 12, color: COLORS.primary, ...FONTS.semibold, textAlign: 'center', marginTop: 2 },
});

export default LoProbe;
