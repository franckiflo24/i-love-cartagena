// Home card for Cartagena Music Week (docs/cmw/DESIGN.md §4 Home). Self-contained:
//   before → a compact premium promo ("Cartagena Music Week · 31 dic – 7 ene") → the hub;
//   during → "Hoy en Music Week" with today's printed events;
//   after  → null.
// The phase is Bogotá date math run AFTER mount (useCmwToday), so the static
// export never bakes a build-day phase in. Before the week it needs no network.
import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { SPACING } from '../../constants/theme';
import { useLang } from '../../context/LanguageContext';
import { useTr } from '../../i18n/autoTr';
import {
  CMW_HERO_IMAGE, CMW_HUB_PATH, CMW_IMAGE_CREDIT, CMW_NAME, CMW_START, eventsOn, phaseOn, pickL, placeText, rangeLabel,
  tbaLabel, timeText, useCmwProgram, useCmwToday,
} from '../../lib/cmw';
import { SafeImage } from '../SafeImage';
import { FadeInUp } from '../FadeInUp';
import { CMW, CMW_RADIUS, CMW_TYPE } from './cmwTheme';
import { OfficialBadge } from './CmwUI';

const daysUntil = (today: string, start: string): number =>
  Math.round((Date.parse(`${start}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);

export default function CmwHomeCard() {
  const tr = useTr();
  const { lang } = useLang();
  const router = useRouter();
  const today = useCmwToday();
  const preliminary = today ? phaseOn(today) : null;
  const { program } = useCmwProgram(preliminary === 'during');
  const brand = program?.brand || null;
  const ph = today ? phaseOn(today, brand) : null;
  const todays = useMemo(() => (today && ph === 'during' ? eventsOn(today, program) : []), [today, ph, program]);

  const openHub = useCallback(() => { router.push(CMW_HUB_PATH as never); }, [router]);
  const openEvent = useCallback((id: string) => { router.push(`${CMW_HUB_PATH}/${id}` as never); }, [router]);

  // ── All hooks are above this line ──────────────────────────────────────────
  if (!ph || ph === 'after') return null;

  if (ph === 'before') {
    const n = today ? daysUntil(today, brand?.start_date || CMW_START) : 0;
    const countdown = n > 1 ? tr('Faltan {n} días').replace('{n}', String(n)) : n === 1 ? tr('Falta 1 día') : '';
    return (
      <FadeInUp style={styles.wrap} distance={10}>
        <Pressable onPress={openHub} accessibilityRole="button" accessibilityLabel={CMW_NAME} testID="cmw-home-promo" style={({ pressed }) => [styles.promo, pressed && { opacity: 0.92 }]}>
          <SafeImage uri={brand?.hero_image || CMW_HERO_IMAGE} category="event" style={StyleSheet.absoluteFillObject} accessibilityLabel={`${tr('Arte del evento')} · ${CMW_IMAGE_CREDIT}`} />
          <LinearGradient colors={['rgba(8,12,22,0.92)', 'rgba(8,12,22,0.72)', 'rgba(8,12,22,0.15)']} locations={[0, 0.55, 1]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFillObject} pointerEvents="none" />
          <View style={styles.promoBody}>
            <OfficialBadge tr={tr} onImage />
            <Text style={styles.promoTitle} numberOfLines={1}>{CMW_NAME}</Text>
            <Text style={styles.promoDates} numberOfLines={1}>{rangeLabel(brand, lang, { year: false, sep: '–' })}{brand?.days_label ? ` · ${pickL(brand.days_label, lang)}` : ` · ${tr('Ocho días')}`}</Text>
            {!!countdown && <Text style={styles.promoCountdown} testID="cmw-home-countdown">{countdown}</Text>}
          </View>
          <View style={styles.promoChevron}>
            <Ionicons name="chevron-forward" size={18} color={CMW.onAccent} />
          </View>
        </Pressable>
      </FadeInUp>
    );
  }

  return (
    <FadeInUp style={styles.wrap} distance={10}>
      <View style={styles.live} testID="cmw-home-today">
        <Pressable onPress={openHub} accessibilityRole="button" accessibilityLabel={`${tr('Hoy en Music Week')} · ${CMW_NAME}`} style={({ pressed }) => [styles.liveHead, pressed && { opacity: 0.9 }]} testID="cmw-home-today-hub">
          <SafeImage uri={brand?.hero_image || CMW_HERO_IMAGE} category="event" style={StyleSheet.absoluteFillObject} accessibilityLabel={`${tr('Arte del evento')} · ${CMW_IMAGE_CREDIT}`} />
          <LinearGradient colors={['rgba(20,17,26,0.15)', 'rgba(20,17,26,0.75)', CMW.surface]} locations={[0.2, 0.75, 1]} style={StyleSheet.absoluteFillObject} pointerEvents="none" />
          <View style={styles.liveHeadRow}>
            <View style={styles.liveDot} />
            <Text style={CMW_TYPE.eyebrow}>{tr('Hoy en Music Week')}</Text>
          </View>
          <Text style={[CMW_TYPE.h2, { marginTop: 4 }]}>{CMW_NAME}</Text>
          <Text style={styles.liveCount}>{todays.length === 1 ? tr('1 evento hoy') : tr('{n} eventos hoy').replace('{n}', String(todays.length))}</Text>
        </Pressable>
        <View style={styles.liveBody}>
          {todays.length === 0 ? (
            <Pressable onPress={openHub} style={styles.row} accessibilityRole="link">
              <Text style={[CMW_TYPE.small, { flex: 1 }]}>{tr('Nada programado hoy · mira los próximos días')}</Text>
              <Ionicons name="chevron-forward" size={16} color={CMW.amber} />
            </Pressable>
          ) : todays.slice(0, 3).map((ev, i) => {
            const place = placeText(ev);
            const time = timeText(ev);
            return (
              <Pressable key={ev.id} onPress={() => openEvent(ev.id)} accessibilityRole="button" accessibilityLabel={ev.title} style={({ pressed }) => [styles.row, i > 0 && styles.rowDivider, pressed && { opacity: 0.85 }]} testID={`cmw-home-event-${ev.id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{ev.title}</Text>
                  <Text style={[styles.rowMeta, (place.tba || !time) && styles.rowMetaTba]} numberOfLines={1}>
                    {place.tba ? tr(place.text) : place.text} · {time || tr(tbaLabel('time'))}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={CMW.amber} />
              </Pressable>
            );
          })}
          <Pressable onPress={openHub} style={styles.footer} accessibilityRole="link" testID="cmw-home-today-program">
            <Text style={styles.footerText}>{tr('Ver programa')}</Text>
            <Ionicons name="arrow-forward" size={14} color={CMW.amber} />
          </Pressable>
        </View>
      </View>
    </FadeInUp>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: SPACING.lg, marginBottom: SPACING.xl },
  promo: { minHeight: 132, borderRadius: CMW_RADIUS.card, overflow: 'hidden', backgroundColor: CMW.surfaceAlt, borderWidth: 1, borderColor: CMW.line, flexDirection: 'row', alignItems: 'center' },
  promoBody: { flex: 1, paddingVertical: 16, paddingLeft: 16, paddingRight: 8 },
  promoTitle: { ...CMW_TYPE.h3, fontSize: 22, lineHeight: 26, marginTop: 8 },
  promoDates: { ...CMW_TYPE.eyebrow, color: CMW.gold, marginTop: 4 },
  promoCountdown: { fontSize: 12.5, lineHeight: 16, fontWeight: '600', color: CMW.cream, marginTop: 6 },
  promoChevron: { width: 36, height: 36, borderRadius: 18, backgroundColor: CMW.amber, alignItems: 'center', justifyContent: 'center', marginRight: 14 },

  live: { borderRadius: CMW_RADIUS.card, overflow: 'hidden', backgroundColor: CMW.surface, borderWidth: 1, borderColor: CMW.line },
  liveHead: { height: 168, justifyContent: 'flex-end', paddingHorizontal: 16, paddingBottom: 10 },
  liveHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: CMW.coral },
  liveCount: { ...CMW_TYPE.small, color: CMW.gold, marginTop: 2 },
  liveBody: { paddingHorizontal: 16, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 8 },
  rowDivider: { borderTopWidth: 1, borderTopColor: CMW.lineSoft },
  rowTitle: { fontSize: 15, lineHeight: 20, fontWeight: '700', color: CMW.cream },
  rowMeta: { fontSize: 12.5, lineHeight: 16, fontWeight: '500', color: CMW.sand, marginTop: 2 },
  rowMetaTba: { color: CMW.sandFaint, fontStyle: 'italic' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, minHeight: 44, borderTopWidth: 1, borderTopColor: CMW.lineSoft },
  footerText: { fontSize: 13, fontWeight: '700', color: CMW.amber },
});
