// /music-week/[id] — one official Cartagena Music Week event (docs/cmw/DESIGN.md §4).
//
// Title, day and date, venue or "Lugar por confirmar", time or "Hora por
// confirmar", the category chip, the image with its credit and the "Programa
// oficial" badge. A main event shows "Very Special Guest · artista por
// confirmar". Price shows "Consultar". CTA: "Solicitar acceso" (the concierge
// sheet). A catalog venue gets "Ver lugar"; "Cómo llegar" appears ONLY when the
// venue has catalog coordinates. All hooks sit above the early returns.
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Head from '../../src/components/WebHead';
import { SafeImage } from '../../src/components/SafeImage';
import { Skeleton } from '../../src/components/Skeleton';
import CmwRequestSheet from '../../src/components/cmw/CmwRequestSheet';
import { CategoryChip, CmwButton, MetaRow, OfficialBadge, subtitleText } from '../../src/components/cmw/CmwUI';
import { CMW, CMW_GUTTER, CMW_RADIUS, CMW_TYPE } from '../../src/components/cmw/cmwTheme';
import { COLORS } from '../../src/constants/theme';
import { useLang } from '../../src/context/LanguageContext';
import { useTr } from '../../src/i18n/autoTr';
import { openDirections } from '../../src/lib/maps';
import { goBackOr } from '../../src/lib/nav';
import {
  CMW_CATEGORY_META, CMW_HUB_PATH, CMW_IMAGE_CREDIT, CMW_NAME, CmwEvent, dayLabel, eventById, isTba, pickL, placeText,
  tbaLabel, timeText, useCmwProgram, useCmwToday, venueCoords,
} from '../../src/lib/cmw';

const HERO_H = 340;

export default function MusicWeekEvent() {
  const router = useRouter();
  const tr = useTr();
  const { lang } = useLang();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { program, loading, error, reload } = useCmwProgram();
  const today = useCmwToday();
  const [sheetOpen, setSheetOpen] = useState(false);

  const eventId = typeof id === 'string' ? id : '';
  const ev: CmwEvent | null = useMemo(() => eventById(eventId, program), [eventId, program]);
  const more = useMemo(() => {
    if (!program || !ev) return [];
    const after = program.events.filter((e) => e.id !== ev.id && e.date >= ev.date);
    const before = program.events.filter((e) => e.id !== ev.id && e.date < ev.date);
    return [...after, ...before].slice(0, 3);
  }, [program, ev]);

  const back = useCallback(() => { goBackOr(router, CMW_HUB_PATH); }, [router]);
  const openHub = useCallback(() => { router.push(CMW_HUB_PATH as never); }, [router]);
  const openEvent = useCallback((next: string) => { router.push(`${CMW_HUB_PATH}/${next}` as never); }, [router]);
  const openVenue = useCallback(() => {
    if (ev?.venue_id) router.push({ pathname: '/partner/[id]', params: { id: ev.venue_id } } as never);
  }, [ev, router]);
  const openMaps = useCallback(() => {
    const c = ev ? venueCoords(ev) : null;
    if (c) openDirections({ lat: c.lat, lng: c.lng, label: c.label }, tr);
  }, [ev, tr]);
  const share = useCallback(async () => {
    if (!ev) return;
    const when = dayLabel(ev.date, lang, { weekday: true });
    try {
      await Share.share({ message: `${ev.title} · ${when} · ${CMW_NAME}\nhttps://www.amocartagena.co${CMW_HUB_PATH}/${ev.id}` });
    } catch (e) {
      console.error('[cmw] share', e instanceof Error ? e.name : 'error');
    }
  }, [ev, lang]);

  // ── All hooks are above this line ──────────────────────────────────────────

  if (!ev && !program && !error) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View testID="cmw-event-skeleton">
          <Skeleton height={HERO_H} borderRadius={0} />
          <View style={{ padding: CMW_GUTTER, gap: 12 }}>
            <Skeleton width="40%" height={12} />
            <Skeleton width="75%" height={28} />
            <Skeleton width="55%" height={14} />
            <Skeleton width="60%" height={14} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!ev) {
    const failed = !program;
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center} testID={failed ? 'cmw-event-error' : 'cmw-event-not-found'}>
          <Ionicons name={failed ? 'cloud-offline-outline' : 'calendar-outline'} size={44} color={CMW.sand} />
          <Text style={[CMW_TYPE.h2, { textAlign: 'center', marginTop: 12 }]}>
            {tr(failed ? 'No pudimos cargar el programa' : 'Evento no encontrado en el programa')}
          </Text>
          {failed && <Text style={[CMW_TYPE.body, { textAlign: 'center' }]}>{tr('Verifica tu conexión e intenta de nuevo')}</Text>}
          {failed ? (
            <CmwButton label={tr('Reintentar')} icon="refresh" onPress={reload} loading={loading} style={{ marginTop: 20, alignSelf: 'stretch' }} testID="cmw-event-retry" />
          ) : (
            <CmwButton label={tr('Ver programa')} icon="calendar-outline" onPress={openHub} style={{ marginTop: 20, alignSelf: 'stretch' }} testID="cmw-event-to-hub" />
          )}
          <CmwButton label={tr('Volver')} variant="ghost" onPress={back} style={{ marginTop: 6, alignSelf: 'stretch' }} />
        </View>
      </SafeAreaView>
    );
  }

  const place = placeText(ev);
  const time = timeText(ev);
  const subtitle = subtitleText(ev, lang, tr);
  const coords = venueCoords(ev);
  const description = pickL(ev.description, lang);
  const meta = CMW_CATEGORY_META[ev.category];
  const dayText = `${tr('Día {n}').replace('{n}', String(ev.day_index))} · ${dayLabel(ev.date, lang, { weekday: true })}${today === ev.date ? ` · ${tr('Hoy')}` : ''}`;
  const placeLabel = ev.venue_name || !isTba(ev, 'boarding_point') ? tr('Lugar') : tr('Embarque');
  const placeValue = place.tba ? tr(place.text) : `${place.text}${ev.venue?.neighborhood ? ` · ${ev.venue.neighborhood}` : ''}`;
  const accessNote = program?.brand.access_note ? pickL(program.brand.access_note, lang) : '';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Head><title>{`${ev.title} · ${CMW_NAME} · AMO Life`}</title></Head>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} testID="cmw-event-scroll">
        <View style={styles.hero}>
          <SafeImage uri={ev.image} category={meta.image} style={StyleSheet.absoluteFillObject} priority="high" accessibilityLabel={`${tr('Arte del evento')} · ${ev.image_credit || CMW_IMAGE_CREDIT}`} />
          <LinearGradient colors={['rgba(8,12,22,0.5)', 'rgba(8,12,22,0)']} locations={[0, 0.4]} style={StyleSheet.absoluteFillObject} pointerEvents="none" />
          <LinearGradient colors={['rgba(8,12,22,0)', 'rgba(8,12,22,0.75)', COLORS.background]} locations={[0.4, 0.85, 1]} style={StyleSheet.absoluteFillObject} pointerEvents="none" />
          <View style={styles.heroTop}>
            <TouchableOpacity onPress={back} style={styles.navBtn} accessibilityRole="button" accessibilityLabel={tr('Volver')} testID="cmw-event-back">
              <Ionicons name="arrow-back" size={20} color={CMW.white} />
            </TouchableOpacity>
            <TouchableOpacity onPress={share} style={styles.navBtn} accessibilityRole="button" accessibilityLabel={tr('Compartir')} testID="cmw-event-share">
              <Ionicons name="share-outline" size={20} color={CMW.white} />
            </TouchableOpacity>
          </View>
          <View style={styles.heroBottom} pointerEvents="none">
            <View style={styles.heroChips}>
              <OfficialBadge tr={tr} onImage />
              <CategoryChip category={ev.category} tr={tr} onImage />
            </View>
          </View>
        </View>

        <View style={styles.body}>
          <Text style={CMW_TYPE.eyebrow} testID="cmw-event-day">{dayText}</Text>
          <Text style={[CMW_TYPE.title, { marginTop: 8 }]} accessibilityRole="header" testID="cmw-event-title">{ev.title}</Text>
          {!!subtitle && (
            <Text style={[styles.subtitle, ev.artist_status === 'tba' && { color: CMW.gold }]} testID="cmw-event-subtitle">{subtitle}</Text>
          )}

          <View style={styles.facts} testID="cmw-event-facts">
            <Fact label={tr('Fecha')} value={dayLabel(ev.date, lang, { weekday: true })} icon="calendar-outline" />
            <Fact label={tr('Hora')} value={time || tr(tbaLabel('time'))} icon="time-outline" tba={!time} testID="cmw-event-time" />
            <Fact label={placeLabel} value={placeValue} icon="location-outline" tba={place.tba} testID="cmw-event-place" />
            {ev.artist_status !== 'none' && (
              <Fact
                label={tr('Artista')}
                value={ev.artist_status === 'tba' ? (ev.artist || 'Very Special Guest') : (ev.artist || '')}
                sub={ev.artist_status === 'tba' ? lowerFirst(tr('Por confirmar')) : undefined}
                icon="mic-outline"
                tba={ev.artist_status === 'tba'}
                testID="cmw-event-artist"
              />
            )}
            <Fact label={tr('Precio')} value={ev.price_info || tr('Consultar')} icon="pricetag-outline" last testID="cmw-event-price" />
          </View>

          {(ev.venue_id || coords) && (
            <View style={styles.venueRow}>
              {!!ev.venue_id && (
                <CmwButton label={tr('Ver lugar')} icon="storefront-outline" variant="secondary" small onPress={openVenue} style={{ flex: 1 }} testID="cmw-event-venue" />
              )}
              {!!coords && (
                <CmwButton label={tr('Cómo llegar')} icon="navigate-outline" variant="secondary" small onPress={openMaps} style={{ flex: 1 }} testID="cmw-event-directions" />
              )}
            </View>
          )}

          {!!description && <Text style={[CMW_TYPE.body, { marginTop: 22 }]} testID="cmw-event-description">{description}</Text>}

          <CmwButton label={tr('Solicitar acceso')} icon="ticket-outline" onPress={() => setSheetOpen(true)} style={{ marginTop: 22 }} testID="cmw-event-request" />
          <Text style={styles.note}>{tr('El acceso se coordina con el concierge. No hay pagos en la app.')}</Text>
          {!!accessNote && <Text style={[CMW_TYPE.small, { marginTop: 10 }]}>{accessNote}</Text>}

          <Text style={styles.credit}>{tr('Arte del evento')} · {ev.image_credit || CMW_IMAGE_CREDIT}</Text>

          {more.length > 0 && (
            <View style={styles.more} testID="cmw-event-more">
              <Text style={CMW_TYPE.eyebrow}>{tr('Más del programa')}</Text>
              {more.map((e) => (
                <TouchableOpacity key={e.id} onPress={() => openEvent(e.id)} style={styles.moreRow} activeOpacity={0.8} accessibilityRole="link" testID={`cmw-event-more-${e.id}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.moreTitle} numberOfLines={1}>{e.title}</Text>
                    <MetaRow icon="calendar-outline" text={dayLabel(e.date, lang, { weekday: true })} style={{ marginTop: 2 }} />
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={CMW.amber} />
                </TouchableOpacity>
              ))}
              <CmwButton label={tr('Ver programa')} variant="ghost" iconRight="arrow-forward" onPress={openHub} style={{ marginTop: 4 }} testID="cmw-event-hub" />
            </View>
          )}
        </View>
      </ScrollView>
      <CmwRequestSheet visible={sheetOpen} event={ev} onClose={() => setSheetOpen(false)} />
    </SafeAreaView>
  );
}

function Fact({ label, value, sub, icon, tba = false, last = false, testID }: {
  label: string; value: string; sub?: string; icon: keyof typeof Ionicons.glyphMap; tba?: boolean; last?: boolean; testID?: string;
}) {
  return (
    <View style={[styles.fact, !last && styles.factDivider]} testID={testID}>
      <View style={styles.factIcon}>
        <Ionicons name={icon} size={16} color={tba ? CMW.sandFaint : CMW.amber} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.factLabel}>{label}</Text>
        <Text style={[styles.factValue, tba && !sub && styles.factTba]}>{value}</Text>
        {!!sub && <Text style={styles.factSub}>{sub}</Text>}
      </View>
    </View>
  );
}

/** "Por confirmar" → "por confirmar" (a sub-line, not a sentence). */
const lowerFirst = (s: string): string => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },

  hero: { height: HERO_H, backgroundColor: CMW.surfaceAlt, justifyContent: 'space-between' },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: CMW_GUTTER - 4, paddingTop: 10 },
  navBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(8,12,22,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  heroBottom: { paddingHorizontal: CMW_GUTTER, paddingBottom: 6 },
  heroChips: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },

  body: { paddingHorizontal: CMW_GUTTER, paddingTop: 6 },
  subtitle: { ...CMW_TYPE.body, color: CMW.sand, marginTop: 6 },

  facts: { marginTop: 20, borderRadius: CMW_RADIUS.card, backgroundColor: CMW.surface, borderWidth: 1, borderColor: CMW.lineSoft, paddingHorizontal: 16 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  factDivider: { borderBottomWidth: 1, borderBottomColor: CMW.lineSoft },
  factIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: CMW.glow },
  factLabel: { fontSize: 10, lineHeight: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: CMW.sandFaint },
  factValue: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: CMW.cream, marginTop: 2 },
  factTba: { color: CMW.sand, fontStyle: 'italic', fontWeight: '500' },
  factSub: { fontSize: 12, lineHeight: 16, color: CMW.sand, fontStyle: 'italic', marginTop: 1 },

  venueRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  note: { ...CMW_TYPE.small, textAlign: 'center', marginTop: 10 },
  credit: { ...CMW_TYPE.small, marginTop: 18, color: CMW.sandFaint },

  more: { marginTop: 30, gap: 10 },
  moreRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 16, backgroundColor: CMW.surface, borderWidth: 1, borderColor: CMW.lineSoft },
  moreTitle: { ...CMW_TYPE.h3, fontSize: 18, lineHeight: 22 },
});
