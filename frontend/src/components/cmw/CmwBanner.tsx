// /que-pasa banner for Cartagena Music Week (docs/cmw/DESIGN.md §4): a slim strip
// at the very top of the agenda in the `before` and `during` phases, linking to
// the hub. CMW rows are NEVER mixed into the eventsFeed lists; this banner is
// the only place the agenda mentions the week. null after the week and until
// "today" is known (Bogotá date math after mount).
import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useLang } from '../../context/LanguageContext';
import { useTr } from '../../i18n/autoTr';
import {
  CMW_HERO_IMAGE, CMW_HUB_PATH, CMW_IMAGE_CREDIT, CMW_NAME, eventsOn, phaseOn, rangeLabel, useCmwProgram, useCmwToday,
} from '../../lib/cmw';
import { SafeImage } from '../SafeImage';
import { CMW, CMW_TYPE } from './cmwTheme';

export default function CmwBanner({ style }: { style?: StyleProp<ViewStyle> }) {
  const tr = useTr();
  const { lang } = useLang();
  const router = useRouter();
  const today = useCmwToday();
  const preliminary = today ? phaseOn(today) : null;
  const { program } = useCmwProgram(preliminary === 'during');
  const brand = program?.brand || null;
  const ph = today ? phaseOn(today, brand) : null;
  const count = useMemo(() => (today && ph === 'during' ? eventsOn(today, program).length : 0), [today, ph, program]);
  const openHub = useCallback(() => { router.push(CMW_HUB_PATH as never); }, [router]);

  // ── All hooks are above this line ──────────────────────────────────────────
  if (!ph || ph === 'after') return null;

  const line = ph === 'during'
    ? `${tr('Hoy en Music Week')} · ${count === 1 ? tr('1 evento hoy') : tr('{n} eventos hoy').replace('{n}', String(count))}`
    : `${tr('Programa oficial')} · ${rangeLabel(brand, lang, { year: false, sep: '–' })}`;

  return (
    <Pressable
      onPress={openHub}
      accessibilityRole="button"
      accessibilityLabel={`${CMW_NAME} · ${line}`}
      testID="cmw-banner"
      style={({ pressed }) => [styles.banner, pressed && { opacity: 0.9 }, style]}
    >
      <View style={styles.thumb}>
        <SafeImage uri={brand?.hero_image || CMW_HERO_IMAGE} category="event" style={StyleSheet.absoluteFillObject} accessibilityLabel={`${tr('Arte del evento')} · ${CMW_IMAGE_CREDIT}`} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{CMW_NAME}</Text>
        <Text style={[styles.line, ph === 'during' && { color: CMW.coral }]} numberOfLines={1}>{line}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={CMW.amber} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, paddingVertical: 8, paddingLeft: 8, paddingRight: 14,
    borderRadius: 18, backgroundColor: CMW.surface, borderWidth: 1, borderColor: CMW.line,
  },
  thumb: { width: 56, height: 56, borderRadius: 12, overflow: 'hidden', backgroundColor: CMW.surfaceAlt },
  title: { ...CMW_TYPE.h3, fontSize: 18, lineHeight: 22 },
  line: { fontSize: 12.5, lineHeight: 16, fontWeight: '600', letterSpacing: 0.2, color: CMW.gold, marginTop: 3 },
});
