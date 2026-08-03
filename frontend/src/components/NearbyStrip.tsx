// Walking Layer — "Cerca de ti" strip (Explore, top).
//
// Render contract (PRIME DIRECTIVE — fails soft everywhere):
//   - geo denied / unavailable / no position / ZERO venues within 150m
//     → renders NOTHING. No empty state, no skeleton. Explore is pixel-
//       identical to the pre-drop app.
//   - geo not-asked → one dismissible explainer max, then never again this
//     session.
//   - /api/nearby is enrichment (pulse lines); offline the strip still works
//     from the IndexedDB venue cache — pulse lines are simply absent.
//
// Battery: the geo watch runs only while Explore is focused AND the tab is
// visible (geoService handles visibility; the screen calls start/stop via
// useFocusEffect from explore.tsx).
//
// Privacy: position is used in-browser for distance math only. The only time
// coordinates leave the device is the transient proximity proof in
// POST /passport/discover — the passport stores venue_id + timestamp, never
// coordinates. The explainer says exactly that.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, SPACING } from '../constants/theme';
import { api } from '../constants/api';
import { SafeImage } from './SafeImage';
import { useTr } from '../i18n/autoTr';
import { useAuth } from '../context/AuthContext';
import { geoService, GeoState, haversineM, bearingDeg } from '../lib/geo';
import { getVenues, CachedVenue } from '../lib/venueCache';

const STRIP_RADIUS_M = 150;   // strip appears only with ≥1 venue inside this
const GEM_REVEAL_M = 40;      // gem un-blurs (and passport-writes) inside this
const MAX_CARDS = 5;
const ENRICH_MIN_MS = 60000;  // /api/nearby at most once per minute…
const ENRICH_MIN_MOVE_M = 50; // …or after 50m of movement

const EXPLAINER_DISMISSED_KEY = '@amo_geo_explainer_dismissed';
const GEMS_DISCOVERED_KEY = '@amo_gems_discovered';

// Occasion-tag display labels (Spanish; tr() localizes)
const TAG_LABELS: Record<string, string> = {
  romantic: 'Romántico',
  rooftop: 'Rooftop',
  sunset_view: 'Vista al atardecer',
  sea_view: 'Vista al mar',
  first_date: 'Para primera cita',
  live_music: 'Música en vivo',
  luxury: 'Experiencia premium',
  budget: 'Buen precio',
  family: 'Familiar',
  kid_friendly: 'Familiar',
  late_night: 'Abierto hasta tarde',
  outdoor_terrace: 'Terraza',
  beachfront: 'Frente al mar',
  healthy: 'Opciones saludables',
  celebration: 'Para celebrar',
  group_friendly: 'Para grupos',
  indoor: 'Bajo techo',
  business: 'Para trabajar',
};

interface Enrichment {
  pulse?: { title?: string | null } | null;
  local_favorite?: boolean;
}

interface StripVenue extends CachedVenue {
  distance: number;
  isGem: boolean;
  pulseLine: string | null;
}

function ss(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

function ssGetSet(key: string): Set<string> {
  try {
    const raw = ss()?.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function ssAddToSet(key: string, value: string) {
  try {
    const cur = ssGetSet(key);
    cur.add(value);
    ss()?.setItem(key, JSON.stringify(Array.from(cur)));
  } catch {}
}

export function NearbyStrip() {
  const router = useRouter();
  const tr = useTr();
  const { user } = useAuth();

  const [geo, setGeo] = useState<GeoState>(geoService.getState());
  const [venues, setVenues] = useState<CachedVenue[]>([]);
  const [enrich, setEnrich] = useState<Record<string, Enrichment>>({});
  const [explainerDismissed, setExplainerDismissed] = useState<boolean>(
    () => ss()?.getItem(EXPLAINER_DISMISSED_KEY) === '1',
  );
  const [revealedGems, setRevealedGems] = useState<Set<string>>(() => ssGetSet(GEMS_DISCOVERED_KEY));
  const [compassOffered, setCompassOffered] = useState(false);

  const lastEnrich = useRef<{ ts: number; lat: number; lng: number } | null>(null);
  const discoverInflight = useRef<Set<string>>(new Set());

  // ── Wiring: geo subscription + venue cache (both fail-soft) ────────
  useEffect(() => {
    const unsub = geoService.subscribe(setGeo);
    geoService.syncPermission().then(() => setGeo(geoService.getState()));
    getVenues().then(setVenues).catch(() => {});
    return unsub;
  }, []);

  // ── Enrichment: /api/nearby, throttled, never a dependency ─────────
  const pos = geo.status === 'granted' ? geo.position : null;
  useEffect(() => {
    if (!pos) return;
    const last = lastEnrich.current;
    if (
      last &&
      Date.now() - last.ts < ENRICH_MIN_MS &&
      haversineM(last.lat, last.lng, pos.lat, pos.lng) < ENRICH_MIN_MOVE_M
    ) {
      return;
    }
    lastEnrich.current = { ts: Date.now(), lat: pos.lat, lng: pos.lng };
    api
      .get(`/nearby?lat=${pos.lat}&lng=${pos.lng}&radius=200`)
      .then((data: any) => {
        const map: Record<string, Enrichment> = {};
        for (const v of data?.venues || []) {
          if (v?.partner_id) map[v.partner_id] = { pulse: v.pulse, local_favorite: v.local_favorite };
        }
        setEnrich(map);
      })
      .catch(() => {}); // offline / backend down → cache-only strip, by design
  }, [pos?.lat, pos?.lng]);

  // ── Proximity math (in-browser, from cache) ────────────────────────
  const nearby: StripVenue[] = useMemo(() => {
    if (!pos || venues.length === 0) return [];
    const within: StripVenue[] = [];
    for (const v of venues) {
      const d = haversineM(pos.lat, pos.lng, v.lat, v.lng);
      if (d > STRIP_RADIUS_M) continue;
      const e = enrich[v.id];
      within.push({
        ...v,
        distance: Math.round(d),
        isGem: v.tags.includes('local_favorite') || !!e?.local_favorite,
        pulseLine: e?.pulse?.title || null,
      });
    }
    within.sort((a, b) => a.distance - b.distance);
    return within.slice(0, MAX_CARDS);
  }, [pos?.lat, pos?.lng, venues, enrich]);

  // ── Gem passport write: fires once per gem, only inside 40m ────────
  useEffect(() => {
    if (!pos) return;
    for (const v of nearby) {
      if (!v.isGem || v.distance > GEM_REVEAL_M) continue;
      if (revealedGems.has(v.id) || discoverInflight.current.has(v.id)) continue;
      discoverInflight.current.add(v.id);
      setRevealedGems((prev) => new Set(prev).add(v.id));
      ssAddToSet(GEMS_DISCOVERED_KEY, v.id);
      if (user) {
        api
          .post('/passport/discover', { venue_id: v.id, type: 'gem', lat: pos.lat, lng: pos.lng })
          .catch(() => {}); // 401/403/offline → silent; server is the honesty gate
      }
    }
  }, [nearby, pos?.lat, pos?.lng, user]);

  const dismissExplainer = useCallback(() => {
    setExplainerDismissed(true);
    try {
      ss()?.setItem(EXPLAINER_DISMISSED_KEY, '1');
    } catch {}
  }, []);

  const enableLocation = useCallback(() => {
    geoService.request().then(() => setGeo(geoService.getState()));
  }, []);

  const offerCompass = useCallback(() => {
    setCompassOffered(true);
    geoService.requestCompass().catch(() => {});
  }, []);

  // Compass CTA only where an explicit tap is required (iOS 13+) and heading
  // hasn't arrived; elsewhere we listen passively after the first card tap.
  const needsCompassTap =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    typeof (window as any).DeviceOrientationEvent?.requestPermission === 'function' &&
    geo.heading === null &&
    !compassOffered;

  useEffect(() => {
    // Android/desktop: no permission needed — hook heading passively once the
    // strip is actually visible with venues.
    if (nearby.length === 0 || needsCompassTap) return;
    if (geo.heading === null && !compassOffered) {
      setCompassOffered(true);
      geoService.requestCompass().catch(() => {});
    }
  }, [nearby.length, needsCompassTap, geo.heading, compassOffered]);

  // ── Render gates (order matters — silence first) ───────────────────
  if (geo.status === 'denied' || geo.status === 'unavailable') return null;

  if (geo.status === 'not-asked') {
    if (explainerDismissed) return null;
    return (
      <View style={styles.explainer}>
        <Ionicons name="walk" size={20} color={COLORS.primary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.explainerTitle}>{tr('Descubre lo que tienes cerca')}</Text>
          <Text style={styles.explainerBody}>
            {tr('Activa tu ubicación y te mostramos joyas a pasos de ti. Tu recorrido nunca se guarda en nuestros servidores.')}
          </Text>
        </View>
        <TouchableOpacity style={styles.explainerBtn} onPress={enableLocation} activeOpacity={0.85}>
          <Text style={styles.explainerBtnText}>{tr('Activar')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={dismissExplainer} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={16} color={COLORS.textMuted} />
        </TouchableOpacity>
      </View>
    );
  }

  // granted:
  if (!pos || nearby.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <Ionicons name="footsteps" size={16} color={COLORS.primary} />
        <Text style={styles.headerTitle}>{tr('Cerca de ti')}</Text>
        {needsCompassTap && (
          <TouchableOpacity style={styles.compassBtn} onPress={offerCompass} activeOpacity={0.8}>
            <Ionicons name="compass-outline" size={13} color={COLORS.primary} />
            <Text style={styles.compassBtnText}>{tr('Brújula')}</Text>
          </TouchableOpacity>
        )}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, gap: SPACING.sm }}
      >
        {nearby.map((v) => {
          const gemHidden = v.isGem && v.distance > GEM_REVEAL_M && !revealedGems.has(v.id);
          if (gemHidden) return <GemTeaseCard key={v.id} distance={v.distance} tr={tr} />;
          return (
            <VenueCard
              key={v.id}
              venue={v}
              heading={geo.heading}
              userPos={pos}
              revealedGem={v.isGem && revealedGems.has(v.id)}
              isGuest={!user}
              tr={tr}
              onPress={() => router.push(`/partner/${v.id}` as any)}
              onGuestPassport={() => router.push('/login' as any)}
            />
          );
        })}
      </ScrollView>
    </View>
  );
}

// ── Cards ────────────────────────────────────────────────────────────

function priorityLine(v: StripVenue, tr: (s: string) => string): string {
  if (v.pulseLine) return v.pulseLine; // pulse text is the business's own words
  if (v.dish) return v.dish;
  if (v.isGem) return tr('Favorito local');
  for (const t of v.tags) {
    if (TAG_LABELS[t]) return tr(TAG_LABELS[t]);
  }
  return tr('A pasos de ti');
}

function DistanceChip({
  venue,
  heading,
  userPos,
}: {
  venue: StripVenue;
  heading: number | null;
  userPos: { lat: number; lng: number };
}) {
  const rel =
    heading !== null
      ? (bearingDeg(userPos.lat, userPos.lng, venue.lat, venue.lng) - heading + 360) % 360
      : null;
  return (
    <View style={styles.distChip}>
      {rel !== null && (
        <Ionicons
          name="navigate"
          size={10}
          color="#000"
          style={{ transform: [{ rotate: `${Math.round(rel - 45)}deg` }] }}
        />
      )}
      <Text style={styles.distChipText}>{venue.distance}m</Text>
    </View>
  );
}

function VenueCard({
  venue,
  heading,
  userPos,
  revealedGem,
  isGuest,
  tr,
  onPress,
  onGuestPassport,
}: {
  venue: StripVenue;
  heading: number | null;
  userPos: { lat: number; lng: number };
  revealedGem: boolean;
  isGuest: boolean;
  tr: (s: string) => string;
  onPress: () => void;
  onGuestPassport: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.card, revealedGem && styles.cardGem]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <SafeImage uri={venue.image_url} category={venue.category} style={styles.cardImage} />
      <View style={styles.cardOverlay}>
        {venue.pulseLine ? (
          <View style={styles.pulseBadge}>
            <Text style={styles.pulseBadgeText} numberOfLines={1}>
              {venue.pulseLine}
            </Text>
          </View>
        ) : revealedGem ? (
          <View style={styles.gemBadge}>
            <Ionicons name="sparkles" size={9} color="#000" />
            <Text style={styles.gemBadgeText}>{tr('Favorito local')}</Text>
          </View>
        ) : null}
        <Text style={styles.cardName} numberOfLines={2}>
          {venue.name}
        </Text>
        <Text style={styles.cardLine} numberOfLines={1}>
          {priorityLine(venue, tr)}
        </Text>
        <View style={styles.cardFooter}>
          <DistanceChip venue={venue} heading={heading} userPos={userPos} />
          {revealedGem && isGuest && (
            <TouchableOpacity onPress={onGuestPassport} hitSlop={{ top: 6, bottom: 6 }}>
              <Text style={styles.passportHint} numberOfLines={1}>
                {tr('Guárdalo — inicia sesión')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

function GemTeaseCard({ distance, tr }: { distance: number; tr: (s: string) => string }) {
  return (
    <View style={[styles.card, styles.gemTease]}>
      <View style={styles.gemTeaseInner}>
        <Ionicons name="sparkles" size={26} color={COLORS.primary} />
        <Text style={styles.gemTeaseTitle}>{tr('Un favorito local está cerca…')}</Text>
        <Text style={styles.gemTeaseBody}>{tr('camina para descubrirlo')}</Text>
        <View style={styles.gemTeaseDist}>
          <Ionicons name="walk" size={11} color={COLORS.primary} />
          <Text style={styles.gemTeaseDistText}>~{Math.round(distance / 10) * 10}m</Text>
        </View>
      </View>
    </View>
  );
}

// ── Styles — Cinema Engine dark + gold, mirrors the "Para ti" strip ──

const styles = StyleSheet.create({
  section: { marginBottom: SPACING.md },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  headerTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold, flex: 1 },
  compassBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(212,175,55,0.12)',
    borderRadius: RADIUS.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  compassBtnText: { fontSize: 10, color: COLORS.primary, ...FONTS.semibold },

  card: {
    width: 150,
    height: 190,
    borderRadius: RADIUS.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  cardGem: { borderColor: COLORS.primary },
  cardImage: { width: '100%', height: '100%' },
  cardOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: SPACING.sm,
    backgroundColor: 'rgba(0,0,0,0.62)',
    gap: 3,
  },
  cardName: { fontSize: 13, color: '#FFF', ...FONTS.bold, lineHeight: 16 },
  cardLine: { fontSize: 10, color: 'rgba(255,255,255,0.75)', ...FONTS.medium },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  pulseBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FBBF24',
    borderRadius: RADIUS.full,
    paddingHorizontal: 6,
    paddingVertical: 1,
    maxWidth: 134,
  },
  pulseBadgeText: { fontSize: 9, color: '#000', ...FONTS.bold },
  gemBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.full,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  gemBadgeText: { fontSize: 9, color: '#000', ...FONTS.bold },
  distChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.full,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  distChipText: { fontSize: 10, color: '#000', ...FONTS.bold },
  passportHint: { fontSize: 9, color: COLORS.primary, ...FONTS.semibold },

  gemTease: {
    borderColor: 'rgba(212,175,55,0.55)',
    borderWidth: 1.5,
    backgroundColor: 'rgba(212,175,55,0.06)',
  },
  gemTeaseInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.md,
    gap: 6,
  },
  gemTeaseTitle: {
    fontSize: 12,
    color: COLORS.textMain,
    ...FONTS.bold,
    textAlign: 'center',
    lineHeight: 16,
  },
  gemTeaseBody: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center' },
  gemTeaseDist: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(212,175,55,0.14)',
    borderRadius: RADIUS.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 2,
  },
  gemTeaseDistText: { fontSize: 10, color: COLORS.primary, ...FONTS.bold },

  explainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.35)',
  },
  explainerTitle: { fontSize: 13, color: COLORS.textMain, ...FONTS.bold },
  explainerBody: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, lineHeight: 15 },
  explainerBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  explainerBtnText: { fontSize: 11, color: '#000', ...FONTS.bold },
});

export default NearbyStrip;
