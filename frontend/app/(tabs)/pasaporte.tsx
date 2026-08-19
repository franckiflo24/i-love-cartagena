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
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSignupGate } from '../../src/context/SignupGateContext';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../src/constants/theme';
import { SafeImage } from '../../src/components/SafeImage';
import { useTr } from '../../src/i18n/autoTr';
import { useAuth } from '../../src/context/AuthContext';
import { geoService, GeoState, haversineM } from '../../src/lib/geo';
import {
  getCollections, getPassport, discover, mintShareLink, CollectionsDef, Passport, CollectionVenue,
  groupsMine, groupCreate, groupJoin, groupLeave, GroupStanding,
} from '../../src/lib/passport';
import { TextInput } from 'react-native';
import { shareCard, canShareCard } from '../../src/lib/shareCard';
import { ACHIEVEMENTS, achievementDef } from '../../src/lib/achievements';
import { StampCelebration, CelebrationData } from '../../src/components/StampCelebration';

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
  const { openGate } = useSignupGate();
  const tr = useTr();
  const { user } = useAuth();

  const [cols, setCols] = useState<CollectionsDef | null>(null);
  const [passport, setPassport] = useState<Passport | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(true);
  // Hydration guard: the static export prerenders this route with no auth /
  // no nav history, so router.canGoBack(), the Share button, and dates
  // mismatched on hydration (React #418). Hold a deterministic first paint
  // until mounted, then render the real, client-only state.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const [geo, setGeo] = useState<GeoState>(geoService.getState());
  const [sealing, setSealing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<CelebrationData | null>(null);

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
  const rank = passport?.rank || null;
  const standing = passport?.standing || null;
  const unlocked = passport?.achievements || {};
  const unlockedCount = Object.keys(unlocked).length;
  // Streak still alive but not stamped today (Bogotá day) → gentle invite.
  const todayBogota = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const streakAtPlay = !!passport && (passport.streak?.current || 0) > 0
    && passport.streak?.last_day !== todayBogota;

  // 8C2: opt-in group standings — create, join (incl. deep-link), share, leave
  const params = useLocalSearchParams<{ join?: string }>();
  const [groups, setGroups] = useState<GroupStanding[]>([]);
  const [groupHandle, setGroupHandle] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupCode, setGroupCode] = useState('');
  const [groupBusy, setGroupBusy] = useState(false);
  useEffect(() => {
    if (user?.user_id) groupsMine().then(setGroups).catch(() => {});
    else setGroups([]);
  }, [user?.user_id]);
  // Invite deep-link: /pasaporte?join=AMOG-XXXX prefills the code. Falls back
  // to the shell-captured code so it survives a login redirect (new users).
  useEffect(() => {
    let pending: string | null = params.join ? String(params.join).toUpperCase() : null;
    if (!pending) {
      try { pending = typeof localStorage !== 'undefined' ? localStorage.getItem('@amo_pending_group') : null; } catch {}
    }
    if (pending) {
      setGroupCode((prev) => prev || pending!);
      try { localStorage.removeItem('@amo_pending_group'); } catch {}
    }
  }, [params.join]);

  const flash = useCallback((msg: string, ms = 4000) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), ms);
  }, []);

  const onGroupCreate = useCallback(async () => {
    if (groupBusy || groupHandle.trim().length < 2) return;
    setGroupBusy(true);
    try {
      const r = await groupCreate(groupName.trim() || null, groupHandle.trim());
      if (r?.code) {
        setGroupName('');
        flash(`${tr('Grupo creado')} · ${r.code}`, 6000);
        setGroups(await groupsMine());
      } else {
        flash(tr('No se pudo crear el grupo'));
      }
    } finally {
      setGroupBusy(false);
    }
  }, [groupBusy, groupHandle, groupName, tr, flash]);

  const onGroupJoin = useCallback(async () => {
    if (groupBusy || groupHandle.trim().length < 2 || groupCode.trim().length < 4) return;
    setGroupBusy(true);
    try {
      const r = await groupJoin(groupCode.trim().toUpperCase(), groupHandle.trim());
      if (r.ok) {
        setGroupCode('');
        flash(tr('¡Ya estás en el grupo!'));
        setGroups(await groupsMine());
      } else {
        flash(tr('Código de grupo no válido'));
      }
    } finally {
      setGroupBusy(false);
    }
  }, [groupBusy, groupHandle, groupCode, tr, flash]);

  const onGroupShare = useCallback(async (g: GroupStanding) => {
    const label = g.name ? `"${g.name}"` : tr('mi grupo');
    const msg = `${tr('Únete a')} ${label} ${tr('en Amo Cartagena')} 🛂 — ${tr('comparemos pasaportes')}.\n${tr('Código')}: ${g.code}\n${g.share_url}`;
    try {
      const nav: any = typeof navigator !== 'undefined' ? navigator : null;
      if (nav?.share) { await nav.share({ text: msg, url: g.share_url }); return; }
      if (nav?.clipboard) { await nav.clipboard.writeText(msg); flash(tr('Invitación copiada — pégala donde quieras')); return; }
    } catch { /* user cancelled share sheet or blocked clipboard */ }
    flash(`${tr('Código')}: ${g.code}`, 6000);
  }, [tr, flash]);

  const onGroupLeave = useCallback(async (g: GroupStanding) => {
    if (groupBusy) return;
    setGroupBusy(true);
    try {
      const ok = await groupLeave(g.group_id);
      flash(ok ? tr('Saliste del grupo') : tr('No se pudo salir del grupo'));
      if (ok) setGroups(await groupsMine());
    } finally {
      setGroupBusy(false);
    }
  }, [groupBusy, tr, flash]);

  // 8A2/8A3: per-collection pull — how many left + the nearest missing item.
  // Only real venues with real coords; no phantom distances (geo off → count only).
  const collectionPull = useCallback((kind: 'sabores' | 'plazas') => {
    if (!cols || !progress) return null;
    const missing = kind === 'sabores'
      ? cols.sabores.filter((s) => !progress.sabores.plates[s.key]).map((s) => ({ label: s.name, venues: s.venues }))
      : cols.plazas.filter((p) => !progress.plazas.venues[p.id]).map((p) => ({ label: p.name, venues: [p] }));
    if (missing.length === 0) return null;
    let nearest: { label: string; d: number } | null = null;
    if (geo.status === 'granted' && geo.position) {
      for (const m of missing) {
        const d = nearestVenueDist(m.venues, geo);
        if (d !== null && (!nearest || d < nearest.d)) nearest = { label: m.label, d };
      }
    }
    return { left: missing.length, nearest, almostLabel: missing.length === 1 ? missing[0].label : null };
  }, [cols, progress, geo]);
  const saboresPull = useMemo(() => collectionPull('sabores'), [collectionPull]);
  const plazasPull = useMemo(() => collectionPull('plazas'), [collectionPull]);

  // The pull: nearest UNSEALED collection stamp within 500m of the live position.
  const nudge = useMemo(() => {
    if (!cols || !progress) return null;
    const pos = geo.status === 'granted' ? geo.position : null;
    if (!pos) return null;
    const cands: { id: string; label: string; d: number }[] = [];
    for (const p of cols.plazas) {
      if (!progress.plazas.venues[p.id] && typeof p.lat === 'number') {
        cands.push({ id: p.id, label: p.name, d: haversineM(pos.lat, pos.lng, p.lat, p.lng) });
      }
    }
    for (const s of cols.sabores) {
      if (progress.sabores.plates[s.key]) continue;
      for (const v of s.venues) {
        if (typeof v.lat !== 'number') continue;
        cands.push({ id: v.id, label: `${s.name} · ${v.name}`, d: haversineM(pos.lat, pos.lng, v.lat, v.lng) });
      }
    }
    cands.sort((a, b) => a.d - b.d);
    return cands.length > 0 && cands[0].d <= 500 ? cands[0] : null;
  }, [cols, progress, geo]);
  const venueName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of cols?.sabores || []) for (const v of s.venues) map[v.id] = v.name;
    for (const p of cols?.plazas || []) map[p.id] = p.name;
    return map;
  }, [cols]);

  const sealPlaza = useCallback(async (venue: CollectionVenue) => {
    let pos = geo.status === 'granted' ? geo.position : null;
    if (!user) {
      openGate({ action: 'collect_stamp', next: '/pasaporte' });
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
      const res = await discover(venue.id, 'visit', pos.lat, pos.lng);
      if (res && !res.already_discovered) {
        setCelebration({
          venueName: res.venue_name || venue.name,
          points: res.points_earned || 0,
          achievements: (res.new_achievements || []).map((a) => a.key),
          rankUp: res.rank_up && res.rank ? res.rank : null,
          specials: res.new_specials || [],
          completions: res.completed_collections || [],
        });
      } else {
        setNotice(tr('Ya está en tu pasaporte'));
      }
      await load();
    } catch (e: any) {
      const msg = String(e?.message || '');
      setNotice(msg.includes('too far') ? tr('Acércate al lugar para sellarlo') : tr('No se pudo sellar — intenta de nuevo'));
    } finally {
      setSealing(null);
      setTimeout(() => setNotice(null), 3500);
    }
  }, [geo, user, router, load, tr]);

  // 11A2/11D1: variant makes the card reflect what they ACTUALLY did.
  const onShare = useCallback(async (variant?: 'passport' | 'first_stamp' | 'collection' | 'gem', variantLabel?: string) => {
    if (!progress) return;
    const nbh = (progress.neighborhoods || []).filter((n) => n.discovered > 0)
      .sort((a, b) => b.discovered - a.discovered)[0];
    const recent = [...discoveries].reverse().slice(0, 6)
      .map((d) => venueName[d.venue_id]).filter(Boolean) as string[];
    const firstName = user?.name?.split(' ')[0] || null;
    let shareUrl = await mintShareLink(firstName); // fail-soft: image-only share
    try {
      const { myReferral } = await import('../../src/lib/referral');
      const r = await myReferral();
      if (shareUrl && r?.code) shareUrl = `${shareUrl}?ref=${r.code}`;
    } catch {}
    const result = await shareCard({
      userName: firstName,
      streakBest: passport?.streak?.best || 0,
      saboresDiscovered: progress.sabores.discovered,
      saboresTotal: progress.sabores.total,
      plazasDiscovered: progress.plazas.discovered,
      plazasTotal: progress.plazas.total,
      joyas: progress.joyas.discovered,
      topNeighborhood: nbh ? { name: NBH_NAMES[nbh.slug] || nbh.slug, discovered: nbh.discovered, total: nbh.total } : null,
      recentVenueNames: recent,
      title: passport?.titles?.primary?.name || null,
      rareza: progress.rareza || 0,
      variant: variant || 'passport',
      variantLabel,
    }, shareUrl);
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
          {mounted && router.canGoBack() && (
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={20} color={COLORS.textMain} />
            </TouchableOpacity>
          )}
          <Text style={styles.title}>{tr('Mi Pasaporte')}</Text>
          {mounted && !!user && !!progress && canShareCard() && (
            <TouchableOpacity onPress={() => onShare()} style={styles.shareBtn} activeOpacity={0.85}>
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

        {(!mounted || loading) ? (
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
                <TouchableOpacity style={styles.inviteBtn} onPress={() => openGate({ action: 'passport', next: '/pasaporte' })} activeOpacity={0.85}>
                  <Text style={styles.inviteBtnText}>{tr('Crear cuenta gratis')}</Text>
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
              <>
                {/* ── Passport cover: rank identity + progress to next ── */}
                {!!rank && (
                  <View style={styles.cover}>
                    <View style={styles.coverTop}>
                      <View style={styles.rankSeal}><Text style={styles.rankSealIcon}>{rank.icon}</Text></View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.coverKicker}>{tr('PASAPORTE DE CARTAGENA')}</Text>
                        <Text style={styles.rankName}>{tr(rank.name)}</Text>
                        {!!passport?.titles?.primary && (
                          <Text style={styles.titleText}>★ {passport.titles.primary.name}</Text>
                        )}
                        {standing?.top_pct ? (
                          <Text style={styles.standingText}>
                            Top {standing.top_pct}% · {standing.active} {tr('exploradores')}
                          </Text>
                        ) : standing?.active ? (
                          <Text style={styles.standingText}>
                            {tr('Explorador de Cartagena')} · {standing.active} {tr('activos')}
                          </Text>
                        ) : null}
                      </View>
                      <View style={styles.coverStamps}>
                        <Text style={styles.coverStampsNum}>{passport?.total_discoveries || 0}</Text>
                        <Text style={styles.coverStampsLabel}>{tr('sellos')}</Text>
                        {!!progress?.rareza && (
                          <Text style={styles.rarezaText}>💠 {progress.rareza} {tr('rareza')}</Text>
                        )}
                      </View>
                    </View>
                    {!!rank.next && (
                      <View style={styles.rankProgressWrap}>
                        <View style={styles.rankBar}>
                          <View style={[styles.rankFill, { width: `${Math.round((rank.progress || 0) * 100)}%` }]} />
                        </View>
                        <Text style={styles.rankNextText}>
                          {rank.next.min - (passport?.total_discoveries || 0)} {tr('sellos más y eres')} {rank.next.icon} {tr(rank.next.name)}
                        </Text>
                      </View>
                    )}
                  </View>
                )}

                {/* ── Streak invite — invitation only, loss-aversion copy is banned ── */}
                {streakAtPlay && (
                  <View style={styles.streakInvite}>
                    <Text style={styles.streakInviteText}>
                      🔥 {tr('Racha de')} {passport?.streak?.current} {tr('días — un sello hoy la continúa')}
                    </Text>
                  </View>
                )}

                {/* ── Nearest unsealed stamp — the pull to the street ── */}
                {!!nudge && (
                  <TouchableOpacity style={styles.nudge} onPress={() => router.push(`/partner/${nudge.id}` as any)} activeOpacity={0.85}>
                    <Ionicons name="footsteps" size={18} color="#000" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.nudgeTitle}>{fmtDist(nudge.d)}: {nudge.label}</Text>
                      <Text style={styles.nudgeSub}>{tr('Un sello nuevo te está esperando')}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="#000" />
                  </TouchableOpacity>
                )}

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
                    <Text style={styles.streakNum}>{unlockedCount}</Text>
                    <Text style={styles.streakLabel}>{tr('medallas')}</Text>
                  </View>
                </View>
              </>
            )}

            {/* ── Rutas entry (Drop 5) ── */}
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: SPACING.lg, marginBottom: SPACING.md, padding: SPACING.md, backgroundColor: 'rgba(245,11,27,0.07)', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(245,11,27,0.35)' }}
              onPress={() => router.push('/rutas' as any)}
              activeOpacity={0.85}
            >
              <Ionicons name="trail-sign" size={22} color={COLORS.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, color: COLORS.textMain, ...FONTS.bold }}>{tr('Rutas de Cartagena')}</Text>
                <Text style={{ fontSize: 11, color: COLORS.textMuted, ...FONTS.medium }}>{tr('Getsemaní, sabores, atardecer y el circuito de crucero — completa y gana')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.primary} />
            </TouchableOpacity>

            {/* ── Sabores de Cartagena ── */}
            {!!cols && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{tr('Sabores de Cartagena')}</Text>
                  {!!progress && progress.sabores.discovered > 0 && (
                    <Text style={styles.sectionCount}>{progress.sabores.discovered}/{progress.sabores.total}</Text>
                  )}
                </View>
                {!!saboresPull && (saboresPull.almostLabel ? (
                  <View style={styles.almostCard}>
                    <Text style={styles.almostTitle}>✨ {tr('¡Casi lo tenés!')}</Text>
                    <Text style={styles.almostText}>
                      {tr('Solo falta')}: {saboresPull.almostLabel}
                      {saboresPull.nearest ? ` — ${fmtDist(saboresPull.nearest.d)}` : ''}
                    </Text>
                  </View>
                ) : saboresPull.nearest ? (
                  <Text style={styles.pullLine}>
                    {tr('Faltan')} {saboresPull.left} · {tr('más cerca')}: {saboresPull.nearest.label} {fmtDist(saboresPull.nearest.d)}
                  </Text>
                ) : null)}
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
                {!!plazasPull && (plazasPull.almostLabel ? (
                  <View style={styles.almostCard}>
                    <Text style={styles.almostTitle}>✨ {tr('¡Casi lo tenés!')}</Text>
                    <Text style={styles.almostText}>
                      {tr('Solo falta')}: {plazasPull.almostLabel}
                      {plazasPull.nearest ? ` — ${fmtDist(plazasPull.nearest.d)}` : ''}
                    </Text>
                  </View>
                ) : plazasPull.nearest ? (
                  <Text style={styles.pullLine}>
                    {tr('Faltan')} {plazasPull.left} · {tr('más cerca')}: {plazasPull.nearest.label} {fmtDist(plazasPull.nearest.d)}
                  </Text>
                ) : null)}
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

            {/* ── Medallas (Drop 8) — every one earned by walking, none for sale ── */}
            {!!user && !isEmpty && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{tr('Medallas')}</Text>
                  <Text style={styles.sectionCount}>{unlockedCount}/{ACHIEVEMENTS.length}</Text>
                </View>
                <View style={styles.grid}>
                  {ACHIEVEMENTS.map((a) => {
                    const ts = unlocked[a.key];
                    const def = achievementDef(a.key);
                    return (
                      <View key={a.key} style={[styles.medalTile, !ts && styles.medalTileLocked]}>
                        <Text style={[styles.medalTileIcon, !ts && { opacity: 0.3 }]}>{def.icon}</Text>
                        <Text style={[styles.medalTileName, !ts && { color: COLORS.textMuted }]} numberOfLines={1}>{tr(def.name)}</Text>
                        {ts ? (
                          <Text style={styles.medalTileDate}>{new Date(ts).toLocaleDateString()}</Text>
                        ) : (
                          <Text style={styles.medalTileHint} numberOfLines={2}>{tr(def.desc)}</Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* ── Sellos de Temporada (8B-data) — real windows, honest dates ──
                Grouped: earnable NOW / coming (real dates only) / in your
                record (earned + passed). Suppressed stale-date stamps never
                arrive from the server, so they can't render here. */}
            {!!user && !isEmpty && (passport?.specials || []).length > 0 && (() => {
              const sp = passport?.specials || [];
              const now = sp.filter((s) => s.state === 'available_now');
              const soon = sp.filter((s) => s.state === 'upcoming');
              const rec = sp.filter((s) => s.state === 'earned' || s.state === 'pasada');
              const renderRow = (s: typeof sp[number]) => (
                <View key={s.id} style={[styles.specialRow, s.state === 'earned' && styles.specialEarned, s.state === 'available_now' && styles.specialNow]}>
                  <Text style={[styles.specialIcon, (s.state === 'upcoming' || s.state === 'pasada') && { opacity: 0.5 }]}>{s.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.specialName, s.state !== 'earned' && s.state !== 'available_now' && { color: COLORS.textMuted }]}>{tr(s.name)}</Text>
                    <Text style={styles.specialDesc} numberOfLines={2}>{tr(s.desc || '')}</Text>
                  </View>
                  {s.state === 'earned' ? (
                    <Text style={styles.specialDate}>{s.earned_ts ? new Date(s.earned_ts).toLocaleDateString() : '✓'}</Text>
                  ) : s.state === 'available_now' ? (
                    <View style={styles.specialNowChip}><Text style={styles.specialNowChipText}>{tr('AHORA')}</Text></View>
                  ) : s.state === 'upcoming' ? (
                    <Text style={styles.specialMuted}>{s.display_date || tr('Próximo')}</Text>
                  ) : s.date_unconfirmed ? (
                    <Text style={styles.specialMuted}>{tr('Próxima edición por confirmar')}</Text>
                  ) : (
                    <Text style={styles.specialMuted}>{tr('Temporada pasada')}</Text>
                  )}
                </View>
              );
              return (
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { paddingHorizontal: SPACING.lg, marginBottom: SPACING.sm }]}>{tr('Sellos de Temporada')}</Text>
                  <View style={{ paddingHorizontal: SPACING.lg, gap: 8 }}>
                    {now.length > 0 && <Text style={styles.specialGroupLabel}>{tr('Puedes ganar ahora')}</Text>}
                    {now.map(renderRow)}
                    {soon.length > 0 && <Text style={styles.specialGroupLabel}>{tr('Próximamente')}</Text>}
                    {soon.map(renderRow)}
                    {rec.length > 0 && <Text style={styles.specialGroupLabel}>{tr('En tu historia')}</Text>}
                    {rec.map(renderRow)}
                  </View>
                </View>
              );
            })()}

            {/* ── Tu Grupo (8C2) — opt-in, real participants, chosen handles ── */}
            {!!user && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { paddingHorizontal: SPACING.lg, marginBottom: SPACING.sm }]}>{tr('Tu Grupo')}</Text>

                {/* Existing groups — standings + invite + leave */}
                {groups.length > 0 && (
                  <View style={{ paddingHorizontal: SPACING.lg, gap: 12, marginBottom: SPACING.md }}>
                    {groups.map((g) => (
                      <View key={g.group_id} style={styles.groupCard}>
                        <View style={styles.groupHeader}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.groupName} numberOfLines={1}>{g.name || tr('Grupo sin nombre')}</Text>
                            <Text style={styles.groupMeta}>{g.member_count} {g.member_count === 1 ? tr('persona') : tr('personas')}</Text>
                          </View>
                          <TouchableOpacity style={styles.groupShareBtn} onPress={() => onGroupShare(g)} activeOpacity={0.85}>
                            <Ionicons name="share-social" size={13} color="#000" />
                            <Text style={styles.groupShareBtnText}>{tr('Invitar')}</Text>
                          </TouchableOpacity>
                        </View>

                        {/* Prominent, tappable code (tap = share/copy) */}
                        <TouchableOpacity style={styles.groupCodePill} onPress={() => onGroupShare(g)} activeOpacity={0.8}>
                          <Ionicons name="key-outline" size={13} color={COLORS.primary} />
                          <Text style={styles.groupCodeText}>{g.code}</Text>
                          <Text style={styles.groupCodeHint}>{tr('toca para compartir')}</Text>
                        </TouchableOpacity>

                        {g.members.map((m, i) => (
                          <View key={m.handle + i} style={[styles.groupRow, m.is_me && styles.groupRowMe]}>
                            <Text style={styles.groupPos}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`}</Text>
                            <Text style={[styles.groupHandle, m.is_me && { color: COLORS.primary }]} numberOfLines={1}>{m.handle}{m.is_me ? ` (${tr('tú')})` : ''}</Text>
                            <Text style={styles.groupStat}>{m.stamps} {tr('sellos')} · 💠{m.rareza}</Text>
                          </View>
                        ))}
                        {g.member_count === 1 && (
                          <Text style={styles.groupSoloHint}>{tr('Todavía estás solo — invita a alguien con el código.')}</Text>
                        )}

                        <TouchableOpacity style={styles.groupLeaveBtn} onPress={() => onGroupLeave(g)} disabled={groupBusy} activeOpacity={0.7}>
                          <Text style={styles.groupLeaveText}>{tr('Salir del grupo')}</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

                {/* Create / join — always available (you can be in several groups) */}
                <View style={{ paddingHorizontal: SPACING.lg, gap: 8 }}>
                  {groups.length === 0 && (
                    <Text style={styles.groupInviteText}>{tr('Crea un grupo con tu pareja, tus amigos o tu barco — y comparen pasaportes.')}</Text>
                  )}
                  <TextInput
                    value={groupHandle}
                    onChangeText={setGroupHandle}
                    placeholder={tr('Tu apodo en el grupo')}
                    placeholderTextColor={COLORS.textMuted}
                    style={styles.groupInput}
                    maxLength={24}
                  />
                  {/* Create */}
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TextInput
                      value={groupName}
                      onChangeText={setGroupName}
                      placeholder={tr('Nombre del grupo (opcional)')}
                      placeholderTextColor={COLORS.textMuted}
                      style={[styles.groupInput, { flex: 1 }]}
                      maxLength={40}
                    />
                    <TouchableOpacity style={[styles.groupBtn, groupHandle.trim().length < 2 && { opacity: 0.5 }]} onPress={onGroupCreate} disabled={groupBusy || groupHandle.trim().length < 2} activeOpacity={0.85}>
                      <Text style={styles.groupBtnText}>{tr('Crear')}</Text>
                    </TouchableOpacity>
                  </View>
                  {/* Join */}
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <Text style={styles.groupOr}>{tr('o únete con un código')}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TextInput
                      value={groupCode}
                      onChangeText={setGroupCode}
                      placeholder="AMOG-XXXXXX"
                      placeholderTextColor={COLORS.textMuted}
                      style={[styles.groupInput, { flex: 1 }]}
                      autoCapitalize="characters"
                      maxLength={12}
                    />
                    <TouchableOpacity style={[styles.groupBtnAlt, (groupHandle.trim().length < 2 || groupCode.trim().length < 4) && { opacity: 0.5 }]} onPress={onGroupJoin} disabled={groupBusy || groupHandle.trim().length < 2 || groupCode.trim().length < 4} activeOpacity={0.85}>
                      <Text style={styles.groupBtnAltText}>{tr('Unirme')}</Text>
                    </TouchableOpacity>
                  </View>
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
      <StampCelebration
        data={celebration}
        onClose={() => setCelebration(null)}
        onShare={() => {
          // 11A2: the card reflects what they actually did, in priority order
          const c = celebration;
          setCelebration(null);
          if (c?.completions?.length) onShare('collection', c.completions[0].name);
          else if ((discoveries || []).length <= 1) onShare('first_stamp');
          else onShare('passport');
        }}
      />
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
  notice: { marginHorizontal: SPACING.lg, marginBottom: SPACING.sm, padding: 10, backgroundColor: 'rgba(245,11,27,0.12)', borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(245,11,27,0.4)' },
  noticeText: { fontSize: 12, color: COLORS.primary, ...FONTS.semibold, textAlign: 'center' },

  inviteCard: { marginHorizontal: SPACING.lg, marginBottom: SPACING.md, padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: 'rgba(245,11,27,0.35)', alignItems: 'center', gap: 8 },
  inviteEmoji: { fontSize: 40 },
  inviteTitle: { fontSize: 17, color: COLORS.textMain, ...FONTS.bold, textAlign: 'center' },
  inviteBody: { fontSize: 13, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center', lineHeight: 19 },
  inviteBtn: { marginTop: 6, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: 22, paddingVertical: 10 },
  inviteBtnText: { fontSize: 13, color: '#000', ...FONTS.bold },

  // Drop 8 — passport cover
  cover: { marginHorizontal: SPACING.lg, marginBottom: SPACING.sm, padding: SPACING.md, backgroundColor: 'rgba(245,11,27,0.07)', borderRadius: RADIUS.xl, borderWidth: 1.5, borderColor: 'rgba(245,11,27,0.5)', gap: 12 },
  coverTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rankSeal: { width: 58, height: 58, borderRadius: 29, borderWidth: 2, borderColor: COLORS.primary, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(245,11,27,0.10)' },
  rankSealIcon: { fontSize: 28 },
  coverKicker: { fontSize: 9, color: COLORS.primary, ...FONTS.bold, letterSpacing: 2 },
  rankName: { fontSize: 18, color: COLORS.textMain, ...FONTS.bold, marginTop: 1 },
  standingText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.semibold, marginTop: 2 },
  coverStamps: { alignItems: 'center' },
  coverStampsNum: { fontSize: 26, color: COLORS.primary, ...FONTS.bold },
  coverStampsLabel: { fontSize: 9, color: COLORS.textMuted, ...FONTS.medium },
  rankProgressWrap: { gap: 5 },
  rankBar: { height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  rankFill: { height: '100%', backgroundColor: COLORS.primary, borderRadius: 4 },
  rankNextText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },

  streakInvite: { marginHorizontal: SPACING.lg, marginBottom: SPACING.sm, paddingVertical: 9, paddingHorizontal: 14, backgroundColor: 'rgba(249,115,22,0.10)', borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(249,115,22,0.4)' },
  streakInviteText: { fontSize: 12, color: '#FB923C', ...FONTS.semibold, textAlign: 'center' },

  nudge: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: SPACING.lg, marginBottom: SPACING.md, padding: SPACING.md, backgroundColor: COLORS.primary, borderRadius: RADIUS.lg },
  nudgeTitle: { fontSize: 13, color: '#000', ...FONTS.bold },
  nudgeSub: { fontSize: 11, color: 'rgba(0,0,0,0.65)', ...FONTS.medium, marginTop: 1 },

  medalTile: { width: '30.5%', minWidth: 96, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(245,11,27,0.45)', alignItems: 'center', padding: 10, gap: 3 },
  medalTileLocked: { borderColor: COLORS.border },
  medalTileIcon: { fontSize: 24 },
  medalTileName: { fontSize: 10.5, color: COLORS.textMain, ...FONTS.bold, textAlign: 'center' },
  medalTileDate: { fontSize: 8.5, color: COLORS.primary, ...FONTS.medium },
  medalTileHint: { fontSize: 8.5, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center', lineHeight: 11 },

  titleText: { fontSize: 12, color: COLORS.primary, ...FONTS.bold, marginTop: 2, fontStyle: 'italic' },
  rarezaText: { fontSize: 9, color: COLORS.primary, ...FONTS.semibold, marginTop: 2 },

  pullLine: { fontSize: 11, color: 'rgba(245,11,27,0.85)', ...FONTS.medium, paddingHorizontal: SPACING.lg, marginTop: -4, marginBottom: SPACING.sm },
  almostCard: { marginHorizontal: SPACING.lg, marginBottom: SPACING.sm, padding: 12, backgroundColor: 'rgba(245,11,27,0.12)', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.primary, gap: 2 },
  almostTitle: { fontSize: 12, color: COLORS.primary, ...FONTS.bold },
  almostText: { fontSize: 12, color: COLORS.textMain, ...FONTS.semibold },

  specialRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: 12 },
  specialEarned: { borderColor: COLORS.primary, backgroundColor: 'rgba(245,11,27,0.10)' },
  specialNow: { borderColor: '#22C55E', backgroundColor: 'rgba(34,197,94,0.08)' },
  specialIcon: { fontSize: 22 },
  specialName: { fontSize: 13, color: COLORS.textMain, ...FONTS.bold },
  specialDesc: { fontSize: 10.5, color: COLORS.textMuted, ...FONTS.medium, marginTop: 1 },
  specialDate: { fontSize: 10, color: COLORS.primary, ...FONTS.semibold },
  specialMuted: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium, maxWidth: 96, textAlign: 'right' },
  specialGroupLabel: { fontSize: 11, color: COLORS.primary, ...FONTS.bold, letterSpacing: 0.5, marginTop: 6, textTransform: 'uppercase' },
  specialNowChip: { backgroundColor: '#22C55E', borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4 },
  specialNowChipText: { fontSize: 9, color: '#000', ...FONTS.bold, letterSpacing: 1 },

  groupCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(245,11,27,0.3)', padding: 12, gap: 6 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  groupName: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold },
  groupMeta: { fontSize: 10.5, color: COLORS.textMuted, ...FONTS.medium, marginTop: 1 },
  groupShareBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 6 },
  groupShareBtnText: { fontSize: 11, color: '#000', ...FONTS.bold },
  groupCodePill: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(245,11,27,0.10)', borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(245,11,27,0.4)', borderStyle: 'dashed', paddingHorizontal: 12, paddingVertical: 8, marginBottom: 2 },
  groupCodeText: { fontSize: 15, color: COLORS.primary, ...FONTS.bold, letterSpacing: 1 },
  groupCodeHint: { flex: 1, fontSize: 10, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'right' },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, paddingHorizontal: 8, borderRadius: RADIUS.sm },
  groupRowMe: { backgroundColor: 'rgba(245,11,27,0.08)' },
  groupPos: { fontSize: 13, width: 26 },
  groupHandle: { flex: 1, fontSize: 13, color: COLORS.textMain, ...FONTS.semibold },
  groupStat: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
  groupSoloHint: { fontSize: 10.5, color: COLORS.textMuted, ...FONTS.medium, fontStyle: 'italic', paddingHorizontal: 8, marginTop: 2 },
  groupLeaveBtn: { alignItems: 'center', paddingVertical: 8, marginTop: 2 },
  groupLeaveText: { fontSize: 11, color: '#F87171', ...FONTS.semibold },
  groupInviteText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium, lineHeight: 17 },
  groupInput: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: RADIUS.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, color: COLORS.textMain, fontSize: 13 },
  groupBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  groupBtnText: { fontSize: 12, color: '#000', ...FONTS.bold },
  groupBtnAlt: { backgroundColor: 'transparent', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.primary, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  groupBtnAltText: { fontSize: 12, color: COLORS.primary, ...FONTS.bold },
  groupOr: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, marginTop: 2 },

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
  tileDone: { borderColor: COLORS.primary, backgroundColor: 'rgba(245,11,27,0.10)' },
  tileIcon: { fontSize: 26 },
  tileIconOff: { opacity: 0.35 },
  tileName: { fontSize: 11, color: COLORS.textMuted, ...FONTS.semibold, textAlign: 'center', lineHeight: 14 },
  tileNameDone: { color: COLORS.textMain },
  tileCheck: { position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: 9, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  tileDist: { fontSize: 9, color: 'rgba(245,11,27,0.8)', ...FONTS.medium },

  plazaCard: { width: 150, height: 170, borderRadius: RADIUS.xl, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  plazaImg: { width: '100%', height: '100%' },
  plazaShade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(7,7,11,0.55)' },
  plazaOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 10, backgroundColor: 'rgba(0,0,0,0.6)', gap: 4 },
  plazaName: { fontSize: 12, color: '#FFF', ...FONTS.bold, lineHeight: 15 },
  plazaDist: { fontSize: 10, color: 'rgba(245,11,27,0.9)', ...FONTS.semibold },
  plazaSealed: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  plazaSealedText: { fontSize: 10, color: COLORS.primary, ...FONTS.bold },
  sealBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 5, alignItems: 'center' },
  sealBtnText: { fontSize: 10, color: '#000', ...FONTS.bold },

  gemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(245,11,27,0.3)', padding: 12 },
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
