// Mi Pasaporte — Walking Layer Drop 3.
//
// Honesty contract:
//   - Progress renders ONLY real server-verified discoveries. Zero discoveries
//     = an inviting start, never a "0/20" wall of shame, never fake counts.
//   - API dead → last-synced passport from IndexedDB + a sync banner. Never a
//     crash, never silent staleness.
//   - Guests see the collections as a teaser; the first check-in prompts
//     sign-in contextually. Browsing is never walled.
//   - Streak invites, never nags: current + best, no loss-aversion copy.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { SafeImage } from '../src/components/SafeImage';
import { useTr } from '../src/i18n/autoTr';
import { useAuth } from '../src/context/AuthContext';
import { geoService, GeoState, haversineM } from '../src/lib/geo';
import {
  getCollections, getPassport, discover, CollectionsDef, Passport, CollectionVenue,
} from '../src/lib/passport';
import { shareCard, canShareCard } from '../src/lib/shareCard';

const SEAL_RADIUS_M = 75; // mirrors the server's honesty gate

const NBH_NAMES: Record<string, string> = {
  centro: 'Centro Histórico', san_diego: 'San Diego', getsemani: 'Getsemaní',
  bocagrande: 'Bocagrande', laguito: 'El Laguito', castillogrande: 'Castillogrande',
  manga: 'Manga', marbella: 'Marbella', la_boquilla: 'La Boquilla', tierrabomba: 'Tierrabomba',
};

const PLATE_ICONS: Record<string, string> = {
  posta: '🥘', ceviche: '🐟', tiradito: '🍋', arroz_mariscos: '🍤', arroz_coco: '🥥',
  cazuela: '🍲', langosta: '🦞', pulpo: '🐙', pargo: '🐠', encocado: '🍛',
  carimanola: '🥟', arepa_huevo: '🍳', pie_coco: '🥧', paleta: '🍡', limonada_coco: '🧊',
  cafe_origen: '☕', coctel_autor: '🍸', mojito: '🌿', ron: '🥃', postre_autor: '🍮',
};

function fmtDist(m: number): string {
  if (m < 1000) return `a ${Math.round(m / 10) * 10}m`;
  return `a ${(m / 1000).toFixed(1)}km`;
}

function nearestVenueDist(venues: CollectionVenue[], geo: GeoState): number | null {
  const pos = geo.status === 'granted' ? geo.position : null;
  if (!pos) return null;
  let best: number | null = null;
  for (const v of venues) {
    if (typeof v.lat !== 'number' || typeof v.lng !== 'number') continue;
    const d = haversineM(pos.lat, pos.lng, v.lat, v.lng);
    if (best === null || d < best) best = d;
  }
  return best;
}

export default function PasaporteScreen() {
  const router = useRouter();
  const tr = useTr();
  const { user } = useAuth();

  const [cols, setCols] = useState<CollectionsDef | null>(null);
  const [passport, setPassport] = useState<Passport | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(true);
  const [geo, setGeo] = useState<GeoState>(geoService.getState());
  const [sealing, setSealing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const c = await getCollections();
    setCols(c);
    if (user?.user_id) {
      const { data, fromCache: fc } = await getPassport(user.user_id);
      setPassport(data);
      setFromCache(fc && !!data);
    } else {
      setPassport(null);
      setFromCache(false);
    }
    setLoading(false);
  }, [user?.user_id]);

  useEffect(() => {
    const unsub = geoService.subscribe(setGeo);
    geoService.syncPermission().then(() => setGeo(geoService.getState()));
    return unsub;
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      geoService.start();
      return () => geoService.stop();
    }, [load]),
  );

  const progress = passport?.progress || null;
  const discoveries = passport?.discoveries || [];
  const isEmpty = !!user && discoveries.length === 0;
  const venueName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of cols?.sabores || []) for (const v of s.venues) map[v.id] = v.name;
    for (const p of cols?.plazas || []) map[p.id] = p.name;
    return map;
  }, [cols]);

  const sealPlaza = useCallback(async (venue: CollectionVenue) => {
    let pos = geo.status === 'granted' ? geo.position : null;
    if (!user) {
      router.push('/login' as any);
      return;
    }
    if (!pos) return;
    setSealing(venue.id);
    try {
      // Fresh fix for the 75m gate — a stale position must not stamp.
      if (Date.now() - pos.ts > 15000) {
        await geoService.request();
        pos = geoService.getState().position || pos;
      }
      await discover(venue.id, 'visit', pos.lat, pos.lng);
      setNotice(tr('Sellado en tu pasaporte ✓'));
      await load();
    } catch (e: any) {
      const msg = String(e?.message || '');
      setNotice(msg.includes('too far') ? tr('Acércate al lugar para sellarlo') : tr('No se pudo sellar — intenta de nuevo'));
    } finally {
      setSealing(null);
      setTimeout(() => setNotice(null), 3500);
    }
  }, [geo, user, router, load, tr]);

  const onShare = useCallback(async () => {
    if (!progress) return;
    const nbh = (progress.neighborhoods || []).filter((n) => n.discovered > 0)
      .sort((a, b) => b.discovered - a.discovered)[0];
    const recent = [...discoveries].reverse().slice(0, 6)
      .map((d) => venueName[d.venue_id]).filter(Boolean) as string[];
    const result = await shareCard({
      userName: user?.name?.split(' ')[0] || null,
      streakBest: passport?.streak?.best || 0,
      saboresDiscovered: progress.sabores.discovered,
      saboresTotal: progress.sabores.total,
      plazasDiscovered: progress.plazas.discovered,
      plazasTotal: progress.plazas.total,
      joyas: progress.joyas.discovered,
      topNeighborhood: nbh ? { name: NBH_NAMES[nbh.slug] || nbh.slug, discovered: nbh.discovered, total: nbh.total } : null,
      recentVenueNames: recent,
    });
    if (result === 'downloaded') setNotice(tr('Imagen descargada — compártela donde quieras'));
    if (result === 'failed') setNotice(tr('No se pudo generar la tarjeta'));
    if (result !== 'shared') setTimeout(() => setNotice(null), 3500);
  }, [progress, discoveries, venueName, user, passport, tr]);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color={COLORS.textMain} />
          </TouchableOpacity>
          <Text style={styles.title}>{tr('Mi Pasaporte')}</Text>
          {!!user && !!progress && canShareCard() && (
            <TouchableOpacity onPress={onShare} style={styles.shareBtn} activeOpacity={0.85}>
              <Ionicons name="share-social" size={16} color="#000" />
              <Text style={styles.shareBtnText}>{tr('Compartir')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {fromCache && (
          <View style={styles.syncBanner}>
            <Ionicons name="cloud-offline-outline" size={14} color="#F59E0B" />
            <Text style={styles.syncBannerText}>{tr('Sin conexión — mostrando tu último pasaporte sincronizado')}</Text>
          </View>
        )}
        {!!notice && (
          <View style={styles.notice}><Text style={styles.noticeText}>{notice}</Text></View>
        )}

        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 60 }} />
        ) : (
          <>
            {/* Guest teaser CTA / streak header */}
            {!user ? (
              <View style={styles.inviteCard}>
                <Text style={styles.inviteEmoji}>🛂</Text>
                <Text style={styles.inviteTitle}>{tr('Tu pasaporte de Cartagena')}</Text>
                <Text style={styles.inviteBody}>
                  {tr('Sella sabores, plazas y joyas locales mientras caminas la ciudad. Inicia sesión y guarda tu pasaporte para siempre.')}
                </Text>
                <TouchableOpacity style={styles.inviteBtn} onPress={() => router.push('/login' as any)} activeOpacity={0.85}>
                  <Text style={styles.inviteBtnText}>{tr('Iniciar sesión')}</Text>
                </TouchableOpacity>
              </View>
            ) : isEmpty ? (
              <View style={styles.inviteCard}>
                <Text style={styles.inviteEmoji}>✨</Text>
                <Text style={styles.inviteTitle}>{tr('Tu pasaporte empieza con tu primer sello')}</Text>
                <Text style={styles.inviteBody}>
                  {tr('Camina la ciudad: prueba un plato icónico, visita una plaza o deja que una joya local te encuentre.')}
                </Text>
                <TouchableOpacity style={styles.inviteBtn} onPress={() => router.push('/(tabs)/explore' as any)} activeOpacity={0.85}>
                  <Text style={styles.inviteBtnText}>{tr('Abrir Explorar')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.streakRow}>
                <View style={styles.streakBox}>
                  <Text style={styles.streakNum}>{passport?.streak?.current || 0}</Text>
                  <Text style={styles.streakLabel}>{tr('días seguidos')}</Text>
                </View>
                <View style={styles.streakBox}>
                  <Text style={styles.streakNum}>{passport?.streak?.best || 0}</Text>
                  <Text style={styles.streakLabel}>{tr('mejor racha')}</Text>
                </View>
                <View style={styles.streakBox}>
                  <Text style={styles.streakNum}>{passport?.total_discoveries || 0}</Text>
                  <Text style={styles.streakLabel}>{tr('sellos')}</Text>
                </View>
              </View>
            )}

            {/* ── Sabores de Cartagena ── */}
            {!!cols && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{tr('Sabores de Cartagena')}</Text>
                  {!!progress && progress.sabores.discovered > 0 && (
                    <Text style={styles.sectionCount}>{progress.sabores.discovered}/{progress.sabores.total}</Text>
                  )}
                </View>
                <View style={styles.grid}>
                  {cols.sabores.map((s) => {
                    const done = !!progress?.sabores.plates[s.key];
                    const dist = !done ? nearestVenueDist(s.venues, geo) : null;
                    return (
                      <TouchableOpacity
                        key={s.key}
                        style={[styles.tile, done && styles.tileDone]}
                        activeOpacity={0.8}
                        onPress={() => {
                          const v = s.venues[0];
                          if (v) router.push(`/partner/${v.id}` as any);
                        }}
                      >
                        <Text style={[styles.tileIcon, !done && styles.tileIconOff]}>{PLATE_ICONS[s.key] || '🍽'}</Text>
                        <Text style={[styles.tileName, done && styles.tileNameDone]} numberOfLines={2}>{s.name}</Text>
                        {done ? (
                          <View style={styles.tileCheck}><Ionicons name="checkmark" size={11} color="#000" /></View>
                        ) : dist !== null ? (
                          <Text style={styles.tileDist}>{fmtDist(dist)}</Text>
                        ) : (
                          <Text style={styles.tileDist}>{s.venues.length === 1 ? s.venues[0].name.slice(0, 16) : `${s.venues.length} ${tr('lugares')}`}</Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {/* ── Plazas y Rincones ── */}
            {!!cols && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{tr('Plazas y Rincones')}</Text>
                  {!!progress && progress.plazas.discovered > 0 && (
                    <Text style={styles.sectionCount}>{progress.plazas.discovered}/{progress.plazas.total}</Text>
                  )}
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: SPACING.lg, gap: SPACING.sm }}>
                  {cols.plazas.map((p) => {
                    const done = !!progress?.plazas.venues[p.id];
                    const pos = geo.status === 'granted' ? geo.position : null;
                    const d = pos && typeof p.lat === 'number' ? haversineM(pos.lat, pos.lng, p.lat, p.lng) : null;
                    const canSeal = !!user && !done && d !== null && d <= SEAL_RADIUS_M;
                    return (
                      <View key={p.id} style={[styles.plazaCard, done && styles.tileDone]}>
                        <SafeImage uri={p.image_url} category="attraction" style={styles.plazaImg} />
                        {!done && <View style={styles.plazaShade} />}
                        <View style={styles.plazaOverlay}>
                          <Text style={styles.plazaName} numberOfLines={2}>{p.name}</Text>
                          {done ? (
                            <View style={styles.plazaSealed}>
                              <Ionicons name="checkmark-circle" size={13} color={COLORS.primary} />
                              <Text style={styles.plazaSealedText}>{tr('Sellado')}</Text>
                            </View>
                          ) : canSeal ? (
                            <TouchableOpacity style={styles.sealBtn} onPress={() => sealPlaza(p)} disabled={sealing === p.id} activeOpacity={0.85}>
                              <Text style={styles.sealBtnText}>{sealing === p.id ? '…' : tr('Estoy aquí — sellar')}</Text>
                            </TouchableOpacity>
                          ) : d !== null ? (
                            <Text style={styles.plazaDist}>{fmtDist(d)}</Text>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* ── Joyas Locales ── */}
            {!!progress && progress.joyas.discovered > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{tr('Joyas Locales')}</Text>
                  <Text style={styles.sectionCount}>{progress.joyas.discovered}</Text>
                </View>
                <View style={{ paddingHorizontal: SPACING.lg, gap: 8 }}>
                  {discoveries.filter((d) => d.type === 'gem').map((d) => (
                    <TouchableOpacity key={`${d.venue_id}-gem`} style={styles.gemRow} onPress={() => router.push(`/partner/${d.venue_id}` as any)} activeOpacity={0.8}>
                      <Ionicons name="sparkles" size={15} color={COLORS.primary} />
                      <Text style={styles.gemName}>{venueName[d.venue_id] || d.venue_id}</Text>
                      <Text style={styles.gemDate}>{new Date(d.ts).toLocaleDateString()}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* ── Barrios ── */}
            {!!progress && progress.neighborhoods.some((n) => n.discovered > 0) && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { paddingHorizontal: SPACING.lg, marginBottom: SPACING.sm }]}>{tr('Barrios')}</Text>
                <View style={{ paddingHorizontal: SPACING.lg, gap: 10 }}>
                  {progress.neighborhoods.filter((n) => n.discovered > 0).map((n) => (
                    <View key={n.slug}>
                      <View style={styles.nbhRow}>
                        <Text style={styles.nbhName}>{NBH_NAMES[n.slug] || n.slug}</Text>
                        <Text style={styles.nbhCount}>{n.discovered}/{n.total}</Text>
                      </View>
                      <View style={styles.nbhBar}>
                        <View style={[styles.nbhFill, { width: `${Math.min(100, (n.discovered / Math.max(1, n.total)) * 100)}%` }]} />
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* ── Timeline ── */}
            {discoveries.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { paddingHorizontal: SPACING.lg, marginBottom: SPACING.sm }]}>{tr('Descubrimientos recientes')}</Text>
                <View style={{ paddingHorizontal: SPACING.lg, gap: 8 }}>
                  {[...discoveries].reverse().slice(0, 10).map((d, i) => (
                    <View key={`${d.venue_id}-${d.type}-${d.plate || ''}-${i}`} style={styles.tlRow}>
                      <Text style={styles.tlIcon}>{d.type === 'gem' ? '💎' : d.type === 'dish' ? '🍽' : '📍'}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.tlName} numberOfLines={1}>{venueName[d.venue_id] || d.venue_id}</Text>
                        {!!d.plate && !!cols && (
                          <Text style={styles.tlPlate} numberOfLines={1}>{cols.sabores.find((s) => s.key === d.plate)?.name || d.plate}</Text>
                        )}
                      </View>
                      <Text style={styles.tlDate}>{new Date(d.ts).toLocaleDateString()}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Privacy line */}
            <Text style={styles.privacy}>
              {tr('Tu pasaporte guarda lugares y fechas — nunca tu ubicación ni tu recorrido.')}
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 22, color: COLORS.textMain, ...FONTS.bold },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: 14, paddingVertical: 8 },
  shareBtnText: { fontSize: 12, color: '#000', ...FONTS.bold },

  syncBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: SPACING.lg, marginBottom: SPACING.sm, padding: 10, backgroundColor: 'rgba(245,158,11,0.10)', borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(245,158,11,0.35)' },
  syncBannerText: { flex: 1, fontSize: 11, color: '#F59E0B', ...FONTS.medium },
  notice: { marginHorizontal: SPACING.lg, marginBottom: SPACING.sm, padding: 10, backgroundColor: 'rgba(212,175,55,0.12)', borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(212,175,55,0.4)' },
  noticeText: { fontSize: 12, color: COLORS.primary, ...FONTS.semibold, textAlign: 'center' },

  inviteCard: { marginHorizontal: SPACING.lg, marginBottom: SPACING.md, padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: 'rgba(212,175,55,0.35)', alignItems: 'center', gap: 8 },
  inviteEmoji: { fontSize: 40 },
  inviteTitle: { fontSize: 17, color: COLORS.textMain, ...FONTS.bold, textAlign: 'center' },
  inviteBody: { fontSize: 13, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center', lineHeight: 19 },
  inviteBtn: { marginTop: 6, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: 22, paddingVertical: 10 },
  inviteBtnText: { fontSize: 13, color: '#000', ...FONTS.bold },

  streakRow: { flexDirection: 'row', gap: 10, paddingHorizontal: SPACING.lg, marginBottom: SPACING.md },
  streakBox: { flex: 1, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', paddingVertical: 14, gap: 2 },
  streakNum: { fontSize: 24, color: COLORS.primary, ...FONTS.bold },
  streakLabel: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium },

  section: { marginBottom: SPACING.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, marginBottom: SPACING.sm },
  sectionTitle: { fontSize: 17, color: COLORS.textMain, ...FONTS.bold },
  sectionCount: { fontSize: 13, color: COLORS.primary, ...FONTS.bold },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: SPACING.lg },
  tile: { width: '30.5%', minWidth: 96, aspectRatio: 0.92, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', padding: 8, gap: 4 },
  tileDone: { borderColor: COLORS.primary, backgroundColor: 'rgba(212,175,55,0.10)' },
  tileIcon: { fontSize: 26 },
  tileIconOff: { opacity: 0.35 },
  tileName: { fontSize: 11, color: COLORS.textMuted, ...FONTS.semibold, textAlign: 'center', lineHeight: 14 },
  tileNameDone: { color: COLORS.textMain },
  tileCheck: { position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: 9, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  tileDist: { fontSize: 9, color: 'rgba(212,175,55,0.8)', ...FONTS.medium },

  plazaCard: { width: 150, height: 170, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  plazaImg: { width: '100%', height: '100%' },
  plazaShade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(7,7,11,0.55)' },
  plazaOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 10, backgroundColor: 'rgba(0,0,0,0.6)', gap: 4 },
  plazaName: { fontSize: 12, color: '#FFF', ...FONTS.bold, lineHeight: 15 },
  plazaDist: { fontSize: 10, color: 'rgba(212,175,55,0.9)', ...FONTS.semibold },
  plazaSealed: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  plazaSealedText: { fontSize: 10, color: COLORS.primary, ...FONTS.bold },
  sealBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 5, alignItems: 'center' },
  sealBtnText: { fontSize: 10, color: '#000', ...FONTS.bold },

  gemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(212,175,55,0.3)', padding: 12 },
  gemName: { flex: 1, fontSize: 13, color: COLORS.textMain, ...FONTS.semibold },
  gemDate: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium },

  nbhRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  nbhName: { fontSize: 13, color: COLORS.textMain, ...FONTS.semibold },
  nbhCount: { fontSize: 12, color: COLORS.primary, ...FONTS.bold },
  nbhBar: { height: 6, borderRadius: 3, backgroundColor: COLORS.surface, overflow: 'hidden' },
  nbhFill: { height: '100%', backgroundColor: COLORS.primary, borderRadius: 3 },

  tlRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  tlIcon: { fontSize: 16 },
  tlName: { fontSize: 13, color: COLORS.textMain, ...FONTS.semibold },
  tlPlate: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
  tlDate: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium },

  privacy: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center', paddingHorizontal: SPACING.xl, marginTop: SPACING.sm, opacity: 0.7 },
});
