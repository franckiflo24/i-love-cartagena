// "Cerca de ti · verificado" — phone-side proximity offer (EVENTS-ELITE §1.2,
// §10 Proximity, §13 J7). Renders NOTHING unless every gate holds:
//   - the user opted in (Perfil › Notificaciones, '@amo_nearby_optin', default OFF);
//   - location permission is ALREADY granted — this card never prompts;
//   - an event is published + HIGH + notif_eligible, verified today (the server
//     reminds only rows verified today — §15 U1; an offline/stale feed fails
//     this, which is what disables the card offline), has real coordinates
//     ≤ 1.5 km away, starts within 3 h and matches the chosen categories;
//   - fewer than 2 offers shown today ('@amo_nearby_offers'), not dismissed.
// The position is read into memory, compared on this device, and dropped. It is
// never stored, logged or sent anywhere. No local notifications either: the
// offer is "Avísame" (save → the server's reminder).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, AppState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import type { PublicEvent } from '../lib/eventsFeed';
import { COLORS, RADIUS, SPACING, FONTS } from '../constants/theme';
import { useTr } from '../i18n/autoTr';
import { useLang } from '../context/LanguageContext';
import { useFavorites } from '../context/FavoritesContext';
import { haversineM, fmtDistance } from '../lib/geo';
import AvisameButton from './AvisameButton';
import {
  type EventLite,
  MAX_NEARBY_OFFERS_PER_DAY,
  NEARBY_RADIUS_M,
  NEARBY_WINDOW_MS,
  bogotaYmd,
  eventStartMs,
  fmtIn,
  hasRealCoords,
  isReminderEligible,
  pickTitle,
  positionIfGranted,
  readNearbyPrefs,
  readOffers,
  recordOfferDismissed,
  recordOfferShown,
  toEventLite,
  verifiedOn,
} from '../lib/eventNotif';

type Offer = { raw: PublicEvent; ev: EventLite; distanceM: number; startMs: number; computedAt: number };

export default function NearbyEventsCard({ events }: { events: PublicEvent[] }) {
  const tr = useTr();
  const { lang } = useLang();
  const router = useRouter();
  const { isFavorite } = useFavorites();
  const [offer, setOffer] = useState<Offer | null>(null);

  // Read favorites through a ref: saving from THIS card must not make it vanish
  // mid-confirmation; the next focus recomputes.
  const isFavoriteRef = useRef(isFavorite);
  useEffect(() => { isFavoriteRef.current = isFavorite; }, [isFavorite]);
  const runRef = useRef(0);

  // Recompute on CONTENT changes only: a host that rebuilds the array every
  // render must not turn setOffer → re-render → recompute into a loop.
  const eventsRef = useRef<PublicEvent[]>(events);
  useEffect(() => { eventsRef.current = events; }, [events]);
  const eventsKey = useMemo(() => (Array.isArray(events) ? events : [])
    .map((e) => `${e?.event_id}|${e?.status}|${e?.confidence}|${e?.notif_eligible}|${e?.last_verified}|${e?.start_date}|${e?.start_time}`)
    .join(','), [events]);

  const compute = useCallback(async () => {
    const run = ++runRef.current;
    try {
      const prefs = await readNearbyPrefs();
      if (!prefs.optIn) { if (run === runRef.current) setOffer(null); return; }
      const now = Date.now();
      const today = bogotaYmd(now);
      const list = Array.isArray(eventsRef.current) ? eventsRef.current : [];

      // Cheap gates first — no location is touched unless a candidate exists.
      const candidates: { raw: PublicEvent; ev: EventLite; startMs: number }[] = [];
      for (const raw of list) {
        const ev = toEventLite(raw);
        if (!ev || !isReminderEligible(ev) || !hasRealCoords(ev) || !verifiedOn(ev, today)) continue;
        if (!ev.category || !prefs.categories.includes(ev.category)) continue;
        if (isFavoriteRef.current(ev.id)) continue;
        const startMs = eventStartMs(ev);
        if (startMs === null || startMs <= now || startMs - now > NEARBY_WINDOW_MS) continue;
        candidates.push({ raw, ev, startMs });
      }
      if (!candidates.length) { if (run === runRef.current) setOffer(null); return; }

      const offers = await readOffers(today);
      const capReached = offers.shown.length >= MAX_NEARBY_OFFERS_PER_DAY;
      const allowed = candidates.filter(({ ev }) =>
        !offers.dismissed.includes(ev.id) && (!capReached || offers.shown.includes(ev.id)));
      if (!allowed.length) { if (run === runRef.current) setOffer(null); return; }

      const pos = await positionIfGranted();
      if (!pos) { if (run === runRef.current) setOffer(null); return; }

      let best: Offer | null = null;
      for (const c of allowed) {
        if (c.ev.lat === null || c.ev.lng === null) continue;
        const d = haversineM(pos.lat, pos.lng, c.ev.lat, c.ev.lng);
        if (d > NEARBY_RADIUS_M) continue;
        if (!best || c.startMs < best.startMs || (c.startMs === best.startMs && d < best.distanceM)) {
          best = { raw: c.raw, ev: c.ev, distanceM: d, startMs: c.startMs, computedAt: now };
        }
      }
      // `pos` goes out of scope here — only the distance survives, in memory.
      if (run !== runRef.current) return;
      if (best && !offers.shown.includes(best.ev.id)) await recordOfferShown(best.ev.id, today);
      if (run === runRef.current) setOffer(best);
    } catch (e) {
      console.error('[NearbyEventsCard] compute failed', e);
      if (run === runRef.current) setOffer(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on content, read via ref
  }, [eventsKey]);

  useFocusEffect(
    useCallback(() => {
      compute();
      return () => { runRef.current += 1; };
    }, [compute]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') compute(); });
    return () => sub.remove();
  }, [compute]);

  const dismiss = useCallback(async () => {
    const current = offer;
    setOffer(null);
    if (!current) return;
    try {
      await recordOfferDismissed(current.ev.id, bogotaYmd(Date.now()));
    } catch (e) {
      console.error('[NearbyEventsCard] dismiss failed', e);
    }
  }, [offer]);

  if (!offer) return null;

  const { ev } = offer;
  const title = pickTitle(ev, lang);
  const startsIn = fmtIn(offer.startMs - offer.computedAt);

  return (
    <View style={styles.card} testID="nearby-events-card">
      <View style={styles.glow} pointerEvents="none" />
      <View style={styles.headerRow}>
        <View style={styles.dotWrap}>
          <View style={styles.dotHalo} />
          <View style={styles.dot} />
        </View>
        <Text style={styles.overline} numberOfLines={1}>{tr('Cerca de ti · verificado')}</Text>
        <Pressable
          onPress={dismiss}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={tr('Ocultar')}
          style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}
        >
          <View style={styles.closeDot}>
            <Ionicons name="close" size={16} color={COLORS.iconMuted} />
          </View>
        </Pressable>
      </View>

      <Pressable
        onPress={() => router.push(`/event/${ev.id}` as never)}
        accessibilityRole="link"
        accessibilityLabel={title}
        style={({ pressed }) => [styles.body, pressed && { opacity: 0.85 }]}
      >
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={13} color={COLORS.primaryHover} />
          <Text style={styles.meta} numberOfLines={1}>
            {tr('Hoy')} · {ev.startTime} · {tr('empieza en')} {startsIn}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="walk-outline" size={13} color={COLORS.icon} />
          <Text style={styles.meta} numberOfLines={1}>
            {ev.venue ? `${ev.venue} · ` : ''}{fmtDistance(offer.distanceM)}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={COLORS.iconMuted} style={{ marginLeft: 'auto' }} />
        </View>
        {ev.sourceName ? (
          <View style={styles.metaRow}>
            <Ionicons name="shield-checkmark-outline" size={13} color={COLORS.official} />
            {/* Only the source name ellipsizes: "verificado hoy" must stay visible. */}
            <Text style={styles.trust} numberOfLines={1}>
              {tr('Fuente')}: {ev.sourceName}
            </Text>
            <Text style={styles.trustWhen} numberOfLines={1}>{`· ${tr('verificado hoy')}`}</Text>
          </View>
        ) : null}
      </Pressable>

      <View style={styles.footer}>
        <AvisameButton event={offer.raw} compact />
      </View>

      <View style={styles.privacyRow}>
        <Ionicons name="lock-closed-outline" size={11} color={COLORS.textFaint} />
        <Text style={styles.privacy}>{tr('Tu ubicación no sale de tu teléfono')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The host wrapper owns the horizontal inset; the vertical spacing lives HERE so the
  // (usual) null render leaves no empty gap on Home or /que-pasa.
  card: {
    marginVertical: SPACING.sm,
    padding: SPACING.md,
    borderRadius: RADIUS.xl,
    backgroundColor: 'rgba(15,21,36,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(18,181,165,0.32)',
    overflow: 'hidden',
    gap: 10,
  },
  glow: {
    position: 'absolute', top: -60, right: -40, width: 180, height: 180, borderRadius: 90,
    backgroundColor: 'rgba(57,184,255,0.10)',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dotWrap: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  dotHalo: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: 'rgba(18,181,165,0.28)' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.primary },
  overline: { flex: 1, fontSize: 10.5, letterSpacing: 1.1, color: COLORS.primaryHover, textTransform: 'uppercase', ...FONTS.bold },
  // 44×44 touch target (hitSlop is ignored on web) around the 26 px visual dot; negative margin keeps the row height.
  close: { width: 44, height: 44, margin: -9, alignItems: 'center', justifyContent: 'center' },
  closeDot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
  body: { gap: 5 },
  title: { fontSize: 17, lineHeight: 22, color: COLORS.textMain, letterSpacing: -0.2, ...FONTS.bold },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { flexShrink: 1, fontSize: 12.5, color: COLORS.textMuted, ...FONTS.medium },
  trust: { flexShrink: 1, fontSize: 11.5, color: COLORS.textMuted, ...FONTS.medium },
  trustWhen: { flexShrink: 0, fontSize: 11.5, color: COLORS.textMuted, ...FONTS.medium },
  footer: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 2 },
  privacyRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  privacy: { fontSize: 10.5, color: COLORS.textFaint, ...FONTS.medium },
});
