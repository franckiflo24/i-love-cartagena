// Drop 8B-data (T5c) — Home "Qué pasa ahora" banner: the current season +
// the seasonal stamps earnable RIGHT NOW. Public data (/seasonal/now), no
// auth. Honest by construction: the endpoint only returns in-window stamps
// and never a suppressed/stale one. Fails soft to null (no banner) offline.

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { useTr } from '../i18n/autoTr';
import { api } from '../constants/api';

interface SeasonNow {
  season: { id: string; name: string; icon: string } | null;
  available_now: { id: string; name: string; icon: string }[];
}

export function SeasonBanner() {
  const tr = useTr();
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
    <View style={styles.banner}>
      {!!data?.season && (
        <Text style={styles.season}>{data.season.icon} {data.season.name}</Text>
      )}
      {!!first && (
        <Text style={styles.earn} numberOfLines={1}>
          {first.icon} {tr('Sello disponible ahora')}: {first.name}
          {earnable.length > 1 ? ` +${earnable.length - 1}` : ''}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: SPACING.lg, marginBottom: SPACING.md,
    paddingVertical: 10, paddingHorizontal: 14,
    backgroundColor: 'rgba(212,175,55,0.09)', borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.35)', gap: 3,
  },
  season: { fontSize: 12, color: COLORS.primary, ...FONTS.bold },
  earn: { fontSize: 11.5, color: COLORS.textMain, ...FONTS.semibold },
});

export default SeasonBanner;
