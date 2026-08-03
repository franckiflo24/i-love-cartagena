// Drop 8B-data (T5c) — Home "Qué pasa ahora" banner: the current season +
// the seasonal stamps earnable RIGHT NOW. Public data (/seasonal/now), no
// auth. Honest by construction: the endpoint only returns in-window stamps
// and never a suppressed/stale one. Fails soft to null (no banner) offline.

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { useTr } from '../i18n/autoTr';
import { api } from '../constants/api';

interface SeasonNow {
  season: { id: string; name: string; icon: string } | null;
  available_now: { id: string; name: string; icon: string }[];
}

export function SeasonBanner() {
  const tr = useTr();
  const router = useRouter();
  const [data, setData] = useState<SeasonNow | null>(null);

  useEffect(() => {
    let alive = true;
    api.get('/seasonal/now')
      .then((r: any) => { if (alive) setData(r); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!data?.season && !(data?.available_now?.length)) return null;
  const earnable = data?.available_now || [];
  const first = earnable[0];

  return (
    <TouchableOpacity
      style={styles.banner}
      onPress={() => router.push('/pasaporte' as any)}
      activeOpacity={0.85}
      accessibilityRole="button"
    >
      <View style={{ flex: 1, gap: 3 }}>
        {!!data?.season && (
          <Text style={styles.season}>{data.season.icon} {tr(data.season.name)}</Text>
        )}
        {!!first && (
          <Text style={styles.earn} numberOfLines={1}>
            {first.icon} {tr('Sello disponible ahora')}: {tr(first.name)}
            {earnable.length > 1 ? ` +${earnable.length - 1}` : ''}
          </Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={16} color={COLORS.primary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: SPACING.lg, marginBottom: SPACING.md,
    paddingVertical: 10, paddingHorizontal: 14,
    backgroundColor: 'rgba(212,175,55,0.09)', borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.35)',
  },
  season: { fontSize: 12, color: COLORS.primary, ...FONTS.bold },
  earn: { fontSize: 11.5, color: COLORS.textMain, ...FONTS.semibold },
});

export default SeasonBanner;
