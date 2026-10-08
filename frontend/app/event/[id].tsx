// /event/[id] — one city event, told honestly (EVENTS-ELITE §10, §13 J2).
//
// Source of truth: GET /api/events/feed/item/{id}, which returns the row in ANY
// status so this screen can say what happened to it. Legacy /events/{id} is only
// a fallback (always rendered "Sin confirmar"). A partner-event id (evt_/pe_)
// still resolves to /partner-event/[id].
//   published → dates, time, venue, price, ticket CTA, Avísame, source block
//   date_tbc  → "Fecha por confirmar" (never a date), venue, source block
//   hidden / review → "Este evento ya no está confirmado" + a localized reason
//                     (never a status code, never a date or ticket)
//   expired   → "Este evento ya pasó"
// Price honesty: GRATIS only when price.is_free === true, otherwise "Consultar".
// All hooks sit above the early returns (React #310).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Share } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Head from '../../src/components/WebHead';
import { Skeleton } from '../../src/components/Skeleton';
import AvisameButton from '../../src/components/AvisameButton';
import {
  EventCategoryBadge, EventMedia, EventSoldOutChip, EventTrustChip, FeedEmptyLine, FeedOfflineBanner, ProgramDayList,
  programByDay, venueLabel,
} from '../../src/components/EventFeedUI';
import { COLORS, SPACING, RADIUS, FONTS, TYPE } from '../../src/constants/theme';
import { copLine } from '../../src/lib/money';
import { api } from '../../src/constants/api';
import { openDirections } from '../../src/lib/maps';
import { openExternal } from '../../src/lib/cityModules';
import { goBackOr } from '../../src/lib/nav';
import { useFavorites } from '../../src/context/FavoritesContext';
import { useTr } from '../../src/i18n/autoTr';
import { useLang } from '../../src/context/LanguageContext';
import {
  FeedItemResult, FeedState, PublicEvent, childrenOf, formatEventDates, formatEventTime, formatVerifiedDate,
  getCachedFeed, hasRealCoords, loadFeedItem, loadLegacyEvent, pickL, subscribeFeed,
} from '../../src/lib/eventsFeed';
import { bogotaToday } from '../../src/lib/eventTime';

// Partner-event ids: `pe_<hex>` (backend create), `pe_bethel_dj_<date>` and the
// seeded `evt_NNN`. City events are `ce-…` and never match.
const PARTNER_EVENT_ID = /^(evt_|pe_)/i;

// A venue string that describes a spread ("Varios escenarios · …", "Recorrido: …") is not a
// place a maps search can find: no "Cómo llegar" / "Ver mapa" for it (only real coordinates
// or a named venue).
const DESCRIPTIVE_VENUE = /^(varios|múltiples|multiples|recorrido|several|various|multiple|plusieurs|vários|varios locais)\b/i;

// §13 J2: the only reasons a visitor is told. Any other code → no reason line.
const REASON_COPY: Record<string, string> = {
  source_gone: 'La página oficial del evento ya no está disponible',
  cancel_marker: 'La fuente lo anuncia como cancelado o aplazado',
  date_changed: 'La fecha cambió y la estamos verificando',
  conflict: 'La fecha cambió y la estamos verificando',
};

type Loaded = FeedItemResult | { kind: 'loading' };

export default function EventDetail() {
  const tr = useTr();
  const { lang } = useLang();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isFavorite, toggleFavorite } = useFavorites();
  const [state, setState] = useState<Loaded>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // The cached feed (never fetched from here): an umbrella lists its program from it.
  const [feedCache, setFeedCache] = useState<FeedState | null>(() => getCachedFeed());
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    setFeedCache(getCachedFeed());
    setToday(bogotaToday());
    return subscribeFeed((f) => setFeedCache(f));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const eventId = String(id || '');
    // One event, one canonical screen: partner-published events live on
    // /partner-event/[id]. Only partner id shapes are probed.
    const isPartnerEvent = async (): Promise<boolean> => {
      if (!PARTNER_EVENT_ID.test(eventId)) return false;
      try {
        const row: unknown = await api.get(`/partner-events/${encodeURIComponent(eventId)}`, { timeoutMs: 15000 });
        return !!row && typeof row === 'object' && !Array.isArray(row) && !!(row as { partner_id?: string }).partner_id;
      } catch {
        return false; // 404 live + no bundled row (or offline) → not a partner event
      }
    };
    const load = async () => {
      setState({ kind: 'loading' });
      try {
        const [partner, item] = await Promise.all([isPartnerEvent(), loadFeedItem(eventId)]);
        if (cancelled) return;
        if (partner) {
          router.replace(`/partner-event/${eventId}` as never);
          return;
        }
        if (item.kind !== 'not_found') { setState(item); return; }
        const legacy = await loadLegacyEvent(eventId);
        if (!cancelled) setState(legacy);
      } catch (e) {
        console.error('[EventDetail] load', e);
        if (!cancelled) setState({ kind: 'error' });
      }
    };
    load();
    return () => { cancelled = true; };
  }, [id, router, attempt]);

  const ev: PublicEvent | null = state.kind === 'ok' ? state.event : null;
  const offline = state.kind === 'ok' ? state.offline : false;

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const openSource = useCallback(() => { if (ev?.source_url) openExternal(ev.source_url); }, [ev]);
  const openTickets = useCallback(() => { if (ev?.ticket_url) openExternal(ev.ticket_url); }, [ev]);
  const openQuePasa = useCallback(() => { router.push('/que-pasa' as never); }, [router]);
  const openProgram = useCallback(() => {
    if (ev) router.push(`/que-pasa?open=${encodeURIComponent(ev.event_id)}` as never);
  }, [router, ev]);
  const openChild = useCallback((childId: string) => { router.push(`/event/${childId}` as never); }, [router]);

  const openMaps = useCallback(() => {
    if (!ev) return;
    // openDirections lets iOS users pick Apple Maps or Google Maps (Guideline 4).
    if (hasRealCoords(ev)) {
      openDirections({ lat: ev.lat, lng: ev.lng, label: ev.venue_name }, tr);
    } else if (ev.venue_name && !ev.is_umbrella && !DESCRIPTIVE_VENUE.test(ev.venue_name)) {
      openDirections({ query: `${ev.venue_name}, Cartagena, Colombia` }, tr);
    }
  }, [ev, tr]);

  const shareEvent = useCallback(async () => {
    if (!ev) return;
    const title = pickL(ev.title, lang);
    const lines = [title];
    if (ev.venue_name) lines.push(venueLabel(ev.venue_name, tr));
    if (ev.status === 'published') {
      const when = [formatEventDates(ev, lang), formatEventTime(ev)].filter(Boolean).join(' · ');
      if (when) lines.push(when);
    } else if (ev.status === 'date_tbc') {
      lines.push(tr('Fecha por confirmar'));
    }
    if (ev.source_name) lines.push(`${tr('Fuente')}: ${ev.source_name}`);
    try {
      await Share.share({ message: `${lines.join('\n')}\n\n${tr('Descarga AMO Life para ver todo el programa')}` });
    } catch (e) {
      console.error('[EventDetail] share', e);
    }
  }, [ev, lang, tr]);

  // ── All hooks are above this line ──────────────────────────────────────────

  if (state.kind === 'loading') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View testID="event-skeleton">
          <Skeleton height={280} borderRadius={0} />
          <View style={{ padding: SPACING.lg, gap: 12 }}>
            <Skeleton width="70%" height={24} />
            <Skeleton width="50%" height={14} />
            <Skeleton width="60%" height={14} />
            <Skeleton width="40%" height={14} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (state.kind === 'not_found' || state.kind === 'error') {
    const failed = state.kind === 'error';
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerState}>
          <Ionicons name={failed ? 'cloud-offline-outline' : 'calendar-outline'} size={48} color={COLORS.textMuted} />
          <Text style={styles.centerTitle}>{tr(failed ? 'No pudimos cargar el evento' : 'Evento no encontrado')}</Text>
          {failed && <Text style={styles.centerText}>{tr('Verifica tu conexión e intenta de nuevo')}</Text>}
          {failed ? (
            <TouchableOpacity onPress={retry} style={styles.primaryBtn} accessibilityRole="button">
              <Ionicons name="refresh" size={16} color={COLORS.black} />
              <Text style={styles.primaryBtnText}>{tr('Reintentar')}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={openQuePasa} style={styles.primaryBtn} accessibilityRole="button">
              <Text style={styles.primaryBtnText}>{tr('Qué pasa en Cartagena')}</Text>
              <Ionicons name="arrow-forward" size={15} color={COLORS.black} />
            </TouchableOpacity>
          )}
          {/* goBackOr pops, or reveals the live tabs (never replace). */}
          <TouchableOpacity onPress={() => goBackOr(router)} style={styles.ghostBtn} accessibilityRole="button">
            <Text style={styles.ghostBtnText}>{tr('Volver')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const event = state.event;
  const title = pickL(event.title, lang);
  const description = pickL(event.description, lang);
  const published = event.status === 'published';
  const tbc = event.status === 'date_tbc';
  const gone = event.status === 'hidden' || event.status === 'review';
  const expired = event.status === 'expired';
  const fav = isFavorite(event.event_id);
  // Saving is for live rows; a saved row that stopped being live can still be removed.
  const showHeart = published || tbc || fav;
  const reason = gone && event.status_reason ? REASON_COPY[event.status_reason] : undefined;
  const dates = published ? formatEventDates(event, lang) : '';
  const time = published ? formatEventTime(event) : '';
  const umbrella = published && event.is_umbrella;
  const canMap = (published || tbc) && (hasRealCoords(event)
    || (!!event.venue_name && !event.is_umbrella && !DESCRIPTIVE_VENUE.test(event.venue_name)));
  const canTicket = published && !!event.ticket_url && !event.sold_out;
  const verifiedOn = formatVerifiedDate(event.last_verified, lang);
  // An umbrella (Fiestas de Independencia) is a program, not one date with a time and a price:
  // its facts are the range and "N eventos del programa", and the program itself is listed
  // below from the cached feed (day-grouped, headline rows first) — or linked to /que-pasa.
  const program = umbrella && feedCache && today ? childrenOf(event, feedCache.data.events, today) : [];
  const programDays = umbrella && today ? programByDay(program, today) : [];
  const programLabel = program.length === 1
    ? tr('1 evento del programa')
    : tr('{n} eventos del programa').replace('{n}', String(program.length));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Head><title>{`${title} · AMO Life`}</title></Head>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Hero — SafeImage paints the category placeholder from frame 0 */}
        <View style={styles.hero}>
          <EventMedia ev={event} height={280} iconSize={40} priority="high" accessibilityLabel={title} variant="hero" />
          <LinearGradient
            colors={['rgba(8,12,22,0.10)', 'rgba(8,12,22,0.35)', COLORS.background]}
            locations={[0, 0.5, 1]}
            style={styles.heroOverlay}
            pointerEvents="none"
          />
          <View style={styles.heroNav}>
            <TouchableOpacity testID="event-back-btn" style={styles.navBtn} onPress={() => goBackOr(router)} accessibilityRole="button" accessibilityLabel={tr('Volver')}>
              <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
            </TouchableOpacity>
            <View style={styles.heroNavRight}>
              {showHeart && (
                <TouchableOpacity
                  testID="event-fav-btn"
                  style={styles.navBtn}
                  onPress={() => { toggleFavorite(event.event_id, 'event').catch((e: unknown) => console.error('[EventDetail] favorite', e)); }}
                  accessibilityRole="button"
                  accessibilityLabel={tr(fav ? 'Quitar de favoritos' : 'Guardar')}
                >
                  <Ionicons name={fav ? 'heart' : 'heart-outline'} size={22} color={fav ? '#EF4444' : COLORS.textMain} />
                </TouchableOpacity>
              )}
              {(published || tbc) && (
                <TouchableOpacity testID="event-share-btn" style={styles.navBtn} onPress={shareEvent} accessibilityRole="button" accessibilityLabel={tr('Compartir')}>
                  <Ionicons name="share-social-outline" size={22} color={COLORS.textMain} />
                </TouchableOpacity>
              )}
            </View>
          </View>
          <View style={styles.heroContent}>
            <View style={styles.heroChips}>
              <EventCategoryBadge ev={event} tr={tr} style={styles.heroBadge} />
              {(published || tbc) && <EventTrustChip ev={event} tr={tr} style={styles.heroBadge} />}
              {published && event.sold_out ? <EventSoldOutChip tr={tr} style={styles.heroBadge} /> : null}
            </View>
            <Text style={styles.heroTitle}>{title}</Text>
          </View>
        </View>

        {offline && state.stamp && (
          <FeedOfflineBanner stamp={state.stamp} lang={lang} tr={tr} style={{ marginHorizontal: SPACING.lg, marginTop: SPACING.sm }} />
        )}

        {/* Status honesty — replaces every date/price/ticket for non-live rows */}
        {gone && (
          <View style={[styles.statusCard, styles.statusGone]} testID="event-status-gone">
            <Ionicons name="alert-circle-outline" size={20} color={COLORS.coral} />
            <View style={{ flex: 1 }}>
              <Text style={styles.statusTitle}>{tr('Este evento ya no está confirmado')}</Text>
              {!!reason && <Text style={styles.statusText}>{tr(reason)}</Text>}
            </View>
          </View>
        )}
        {expired && (
          <View style={styles.statusCard} testID="event-status-expired">
            <Ionicons name="time-outline" size={20} color={COLORS.textMuted} />
            <Text style={[styles.statusTitle, { flex: 1 }]}>{tr('Este evento ya pasó')}</Text>
          </View>
        )}

        {(published || tbc) && (
          <View style={styles.infoSection}>
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}>
                <Ionicons name="calendar-outline" size={20} color={COLORS.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.infoLabel}>{tr('Fecha')}</Text>
                <Text style={styles.infoValue}>{tbc ? tr('Fecha por confirmar') : dates}</Text>
                {tbc && !!pickL(event.date_tbc_note, lang) && (
                  <Text style={styles.infoSub}>{pickL(event.date_tbc_note, lang)}</Text>
                )}
              </View>
            </View>
            {published && !umbrella && (
              <View style={styles.infoRow}>
                <View style={styles.infoIcon}>
                  <Ionicons name="time-outline" size={20} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoLabel}>{tr('Horario')}</Text>
                  <Text style={styles.infoValue}>{time || tr('Hora por confirmar')}</Text>
                </View>
              </View>
            )}
            {umbrella && (
              <View style={styles.infoRow} testID="event-program-count">
                <View style={styles.infoIcon}>
                  <Ionicons name="albums-outline" size={20} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoLabel}>{tr('Programa')}</Text>
                  <Text style={styles.infoValue}>{program.length ? programLabel : tr('Ver programa')}</Text>
                </View>
              </View>
            )}
            {!!event.venue_name && (
              <TouchableOpacity style={styles.infoRow} onPress={openMaps} activeOpacity={0.7} disabled={!canMap} accessibilityRole={canMap ? 'button' : 'text'}>
                <View style={styles.infoIcon}>
                  <Ionicons name="location-outline" size={20} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoLabel}>{tr('Lugar')}</Text>
                  <Text style={styles.infoValue}>{venueLabel(event.venue_name, tr)}</Text>
                  {!!event.address && <Text style={styles.infoSub}>{event.address}</Text>}
                </View>
                {canMap && (
                  <View style={styles.mapCta}>
                    <Ionicons name="map" size={14} color={COLORS.primary} />
                    <Text style={styles.mapCtaText}>{tr('Ver mapa')}</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
            {published && !umbrella && (
              <View style={styles.infoRow}>
                <View style={styles.infoIcon}>
                  <Ionicons name="cash-outline" size={20} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoLabel}>{tr('Precio')}</Text>
                  <Text style={[styles.infoValue, event.price.is_free === true && { color: '#22C55E' }]}>
                    {tr(event.price.is_free === true ? 'GRATIS' : 'Consultar')}
                  </Text>
                  {/* COP is the real price; US$ is an approximation by design (src/lib/money.ts). */}
                  {event.price.is_free !== true && !!copLine(event.price.min_cop, event.price.max_cop) && (
                    <Text style={styles.infoSub}>{copLine(event.price.min_cop, event.price.max_cop)}</Text>
                  )}
                </View>
              </View>
            )}
          </View>
        )}

        {/* Avísame — published and date_tbc, never from an offline copy (§13 J1/J2).
            On a date_tbc row it is the notify-me rail: "Guardar" keeps the row in
            Favoritos, where the confirmed date lands the moment a curator sets it. */}
        {(published || tbc) && !offline && (
          <View style={styles.avisameWrap}>
            <AvisameButton event={event} />
          </View>
        )}

        {(published || tbc) && !!description && (
          <View style={styles.descSection}>
            <Text style={styles.descTitle}>{tr('Descripción')}</Text>
            <Text style={styles.descText}>{description}</Text>
          </View>
        )}

        {/* Umbrella: the day-grouped program (from the cached feed), or the way to it */}
        {umbrella && (
          <View style={styles.programSection} testID="event-program">
            <View style={styles.programHead}>
              <Text style={styles.descTitle}>{tr('Programa')}</Text>
              {program.length > 0 && (
                <TouchableOpacity onPress={openProgram} style={styles.programLink} accessibilityRole="link" testID="event-program-que-pasa">
                  <Text style={styles.programLinkText}>{tr('Ver en Qué pasa')}</Text>
                  <Ionicons name="chevron-forward" size={13} color={COLORS.primary} />
                </TouchableOpacity>
              )}
            </View>
            {program.length > 0 ? (
              <View style={styles.programList}>
                {programDays.map((g) => (
                  <ProgramDayList key={g.day} group={g} umbrella={event} today={today as string} lang={lang} tr={tr} offline={offline} onOpen={openChild} />
                ))}
              </View>
            ) : (
              <FeedEmptyLine text={tr('El programa completo está en Qué pasa')} cta={`${tr('Ver programa en Qué pasa')} →`} onPress={openProgram} testID="event-program-link" />
            )}
          </View>
        )}

        {/* Source block — the proof, one tap away */}
        {!!event.source_url && (
          <View style={styles.sourceCard} testID="event-source">
            <View style={styles.sourceHead}>
              <Ionicons name="shield-checkmark-outline" size={16} color={COLORS.official} />
              <Text style={styles.sourceTitle}>{tr('Fuente')}</Text>
              {(published || tbc) && <EventTrustChip ev={event} tr={tr} variant="full" showVerified />}
            </View>
            <TouchableOpacity onPress={openSource} activeOpacity={0.7} accessibilityRole="link" style={styles.sourceLink}
              accessibilityLabel={`${tr('Fuente')}: ${event.source_name} · ${tr('abre enlace externo')}`}>
              <Ionicons name="link-outline" size={13} color={COLORS.official} />
              <Text style={styles.sourceLinkText}>{event.source_name || event.source_url}</Text>
              <Ionicons name="open-outline" size={12} color={COLORS.official} />
            </TouchableOpacity>
            {!!event.second_source_name && (published || tbc) && (
              <Text style={styles.sourceMeta}>{tr('También')}: {event.second_source_name}</Text>
            )}
            {(published || tbc) && (
              <Text style={styles.sourceMeta}>
                {offline ? tr('sin actualizar') : verifiedOn ? `${tr('verificado')} ${verifiedOn}` : ''}
              </Text>
            )}
            {!!event.image_url && !!event.image_credit && (
              <Text style={styles.sourceMeta}>{tr('Foto')}: {event.image_credit}</Text>
            )}
          </View>
        )}

        <View style={{ height: 110 }} />
      </ScrollView>

      {/* Bottom actions */}
      <View style={styles.bottomBar}>
        {(published || tbc) ? (
          <>
            {canMap && (
              <TouchableOpacity testID="event-directions-btn" style={styles.dirBtn} onPress={openMaps} accessibilityRole="button">
                <Ionicons name="navigate" size={18} color={COLORS.primary} />
                <Text style={styles.dirText}>{tr('Cómo llegar')}</Text>
              </TouchableOpacity>
            )}
            {canTicket ? (
              <TouchableOpacity testID="event-ticket-btn" style={styles.bookBtn} onPress={openTickets} accessibilityRole="link">
                <Text style={styles.bookText}>{tr('Entradas')}</Text>
                <Ionicons name="open-outline" size={16} color={COLORS.black} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity testID="event-source-btn" style={styles.sourceBtn} onPress={openSource} accessibilityRole="link">
                <Text style={styles.sourceBtnText}>{tr('Ver fuente oficial')}</Text>
                <Ionicons name="open-outline" size={15} color={COLORS.official} />
              </TouchableOpacity>
            )}
          </>
        ) : (
          <TouchableOpacity testID="event-que-pasa-btn" style={styles.bookBtn} onPress={openQuePasa} accessibilityRole="button">
            <Text style={styles.bookText}>{tr('Ver qué más pasa en Cartagena')}</Text>
            <Ionicons name="arrow-forward" size={16} color={COLORS.black} />
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  centerState: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 32 },
  centerTitle: { ...TYPE.headline, color: COLORS.textMain, textAlign: 'center' },
  centerText: { ...TYPE.subhead, color: COLORS.textMuted, textAlign: 'center' },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, minHeight: 44,
    paddingHorizontal: SPACING.lg, borderRadius: RADIUS.full, backgroundColor: COLORS.primary,
  },
  primaryBtnText: { fontSize: 14, color: COLORS.black, ...FONTS.bold },
  ghostBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: SPACING.lg },
  ghostBtnText: { fontSize: 14, color: COLORS.textMuted, ...FONTS.semibold },

  hero: { height: 280, position: 'relative', backgroundColor: COLORS.surfaceAlt },
  heroOverlay: { ...StyleSheet.absoluteFillObject },
  heroNav: { position: 'absolute', top: SPACING.md, left: SPACING.md, right: SPACING.md, flexDirection: 'row', justifyContent: 'space-between' },
  heroNavRight: { flexDirection: 'row', gap: SPACING.sm },
  navBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(5,8,20,0.6)', alignItems: 'center', justifyContent: 'center' },
  heroContent: { position: 'absolute', bottom: SPACING.lg, left: SPACING.lg, right: SPACING.lg },
  heroChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  heroBadge: { backgroundColor: 'rgba(8,12,22,0.78)' },
  heroTitle: { fontSize: 28, lineHeight: 34, color: COLORS.textMain, ...FONTS.bold, marginTop: SPACING.sm },

  statusCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginHorizontal: SPACING.lg, marginTop: SPACING.md,
    padding: SPACING.md, borderRadius: RADIUS.lg, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  statusGone: { borderColor: `${COLORS.coral}8C`, backgroundColor: `${COLORS.coral}14` },
  statusTitle: { ...TYPE.headline, color: COLORS.textMain },
  statusText: { ...TYPE.subhead, color: COLORS.textMuted, marginTop: 4 },

  infoSection: { padding: SPACING.lg, gap: SPACING.md },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, minHeight: 44 },
  infoIcon: { width: 40, height: 40, borderRadius: RADIUS.md, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  infoLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular },
  infoValue: { fontSize: 15, color: COLORS.textMain, ...FONTS.semibold },
  infoSub: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },
  mapCta: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: `${COLORS.primary}15`, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.full, borderWidth: 1, borderColor: `${COLORS.primary}30` },
  mapCtaText: { fontSize: 11, color: COLORS.primary, ...FONTS.semibold },

  avisameWrap: { paddingHorizontal: SPACING.lg, marginBottom: SPACING.lg },
  descSection: { paddingHorizontal: SPACING.lg, marginBottom: SPACING.lg },
  descTitle: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold, marginBottom: SPACING.sm },
  descText: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 22 },
  programSection: { paddingHorizontal: SPACING.lg, marginBottom: SPACING.lg },
  programHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  programLink: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, paddingLeft: 8 },
  programLinkText: { fontSize: 12.5, color: COLORS.primary, ...FONTS.semibold },
  programList: { gap: 4 },

  sourceCard: {
    marginHorizontal: SPACING.lg, padding: SPACING.md, gap: 6, borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.hairline,
  },
  sourceHead: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  sourceTitle: { fontSize: 13, color: COLORS.textMain, ...FONTS.bold, marginRight: 4 },
  sourceLink: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44 },
  sourceLinkText: { flexShrink: 1, fontSize: 13, color: COLORS.official, ...FONTS.semibold, textDecorationLine: 'underline' },
  sourceMeta: { fontSize: 11.5, color: COLORS.textFaint, ...FONTS.medium },

  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', padding: SPACING.lg, gap: SPACING.md, backgroundColor: COLORS.background, borderTopWidth: 1, borderTopColor: COLORS.border },
  dirBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.primary, minHeight: 48 },
  dirText: { fontSize: 14, color: COLORS.primary, ...FONTS.semibold },
  bookBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, minHeight: 48, paddingHorizontal: SPACING.md },
  bookText: { fontSize: 14, color: COLORS.black, ...FONTS.bold },
  sourceBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 48,
    borderRadius: RADIUS.full, borderWidth: 1, borderColor: `${COLORS.official}8C`, backgroundColor: `${COLORS.official}14`,
  },
  sourceBtnText: { fontSize: 14, color: COLORS.official, ...FONTS.semibold },
});
