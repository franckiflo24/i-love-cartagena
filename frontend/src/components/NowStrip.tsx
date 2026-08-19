// "Ahora mismo" — the occasion that fits the real current moment (Drop 9, 3c).
// Reads /api/now (clock + weekday + real sunset → occasion) and links to that
// occasion collection. Honest: uses the user's real local time; renders
// nothing if the backend can't resolve a moment.

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { useLang } from '../context/LanguageContext';
import { api } from '../constants/api';

interface NowResp {
  occasion: { key: string; icon: string; es: string; en: string; fr?: string; pt?: string; sunset?: string } | null;
  local_time?: string;
}

export function NowStrip() {
  const router = useRouter();
  const { lang } = useLang();
  const [data, setData] = useState<NowResp | null>(null);

  useEffect(() => {
    let alive = true;
    api.get('/now').then((r: any) => { if (alive) setData(r); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const occ = data?.occasion;
  if (!occ) return null;
  const copy = occ[lang] || occ.en || occ.es;

  return (
    <TouchableOpacity
      style={styles.strip}
      onPress={() => router.push(`/collections/${occ.key}` as any)}
      activeOpacity={0.85}
      accessibilityRole="button"
    >
      <View style={styles.iconWrap}>
        <Ionicons name={(occ.icon as any) || 'time'} size={18} color="#000" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.kicker}>{lang === 'es' ? 'AHORA MISMO' : 'RIGHT NOW'}{data?.local_time ? ` · ${data.local_time}` : ''}</Text>
        <Text style={styles.copy} numberOfLines={2}>{copy}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={COLORS.coral} />
    </TouchableOpacity>
  );
}

// "Right now" is the app's live moment → coral, not the teal used for
// general navigation. This is the one section that should feel urgent-warm.
const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: SPACING.lg, marginBottom: SPACING.md,
    padding: SPACING.md, backgroundColor: 'rgba(255,107,74,0.10)',
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(255,107,74,0.4)',
  },
  iconWrap: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.coral, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontSize: 9.5, color: COLORS.coral, ...FONTS.bold, letterSpacing: 1.2 },
  copy: { fontSize: 12.5, color: COLORS.textMain, ...FONTS.semibold, marginTop: 2 },
});

export default NowStrip;
