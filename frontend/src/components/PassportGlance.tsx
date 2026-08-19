// Drop 8F — glanceable alive-ness on Home. When the app opens NEAR an
// uncollected passport slot (≤300m), the passport greets you instead of
// waiting to be checked: nearest missing stamp + streak + title + rareza.
//
// HONESTY / fail-soft: renders NOTHING for guests, empty passports, geo
// denied/off, or nothing-in-range — Home is pixel-identical to pre-drop in
// all of those states. Distances come from real venue coords only.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { useTr } from '../i18n/autoTr';
import { useAuth } from '../context/AuthContext';
import { geoService, GeoState, haversineM } from '../lib/geo';
import { getCollections, getPassport, CollectionsDef, Passport } from '../lib/passport';

const GLANCE_RANGE_M = 300;

export function PassportGlance() {
  const router = useRouter();
  const tr = useTr();
  const { user } = useAuth();
  const [geo, setGeo] = useState<GeoState>(geoService.getState());
  const [cols, setCols] = useState<CollectionsDef | null>(null);
  const [passport, setPassport] = useState<Passport | null>(null);

  useEffect(() => {
    const unsub = geoService.subscribe(setGeo);
    geoService.syncPermission().then(() => setGeo(geoService.getState()));
    return unsub;
  }, []);

  // The glance needs a live position on app-open — same focus-scoped watch
  // pattern as Explore/Pasaporte (denied stays silent; watch stops on blur).
  useFocusEffect(
    useCallback(() => {
      if (user?.user_id) geoService.start();
      return () => geoService.stop();
    }, [user?.user_id]),
  );

  useEffect(() => {
    let alive = true;
    if (!user?.user_id) { setPassport(null); return; }
    Promise.all([getCollections(), getPassport(user.user_id)]).then(([c, { data }]) => {
      if (!alive) return;
      setCols(c);
      setPassport(data);
    }).catch(() => {});
    return () => { alive = false; };
  }, [user?.user_id]);

  const nearest = useMemo(() => {
    const pos = geo.status === 'granted' ? geo.position : null;
    const progress = passport?.progress;
    if (!pos || !cols || !progress || (passport?.total_discoveries || 0) === 0) return null;
    let best: { id: string; label: string; d: number } | null = null;
    for (const p of cols.plazas) {
      if (progress.plazas.venues[p.id] || typeof p.lat !== 'number') continue;
      const d = haversineM(pos.lat, pos.lng, p.lat, p.lng);
      if (!best || d < best.d) best = { id: p.id, label: p.name, d };
    }
    for (const s of cols.sabores) {
      if (progress.sabores.plates[s.key]) continue;
      for (const v of s.venues) {
        if (typeof v.lat !== 'number') continue;
        const d = haversineM(pos.lat, pos.lng, v.lat, v.lng);
        if (!best || d < best.d) best = { id: v.id, label: `${s.name} · ${v.name}`, d };
      }
    }
    return best && best.d <= GLANCE_RANGE_M ? best : null;
  }, [geo, cols, passport]);

  if (!nearest || !passport) return null;

  const title = passport.titles?.primary?.name;
  const streak = passport.streak?.current || 0;
  const rareza = passport.progress?.rareza || 0;

  return (
    <TouchableOpacity style={styles.card} onPress={() => router.push(`/partner/${nearest.id}` as any)} activeOpacity={0.85}>
      <Ionicons name="footsteps" size={20} color="#000" />
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>
          {Math.round(nearest.d / 10) * 10}m · {nearest.label}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {tr('Te falta este sello')}
          {title ? ` · ★ ${title}` : ''}
          {streak > 0 ? ` · 🔥${streak}` : ''}
          {rareza > 0 ? ` · 💠${rareza}` : ''}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#000" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: SPACING.lg, marginBottom: SPACING.md,
    padding: SPACING.md, backgroundColor: COLORS.mustard, borderRadius: RADIUS.lg,
  },
  title: { fontSize: 13, color: '#000', ...FONTS.bold },
  sub: { fontSize: 11, color: 'rgba(0,0,0,0.65)', ...FONTS.semibold, marginTop: 1 },
});

export default PassportGlance;
