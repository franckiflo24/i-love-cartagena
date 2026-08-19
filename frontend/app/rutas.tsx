// Rutas — Quests & Trails (Drop 5, Master Plan P1.1/P1.2).
// (Formerly a redirect to /itineraries — the Home "Rutas IA" tile links
// /itineraries directly, so nothing breaks.)
//
// A trail is an ordered lens over passport discoveries: every stop stamps
// through the SAME 75m server gate. Honesty contract: progress = real
// server-verified stamps only; completion re-verified server-side; the
// redemption code is minted by the server and single-use. Partner-funded
// rewards appear ONLY when a partner has actually signed one — until then
// the real reward is AMO points (live) and the code waits for founders.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { api } from '../src/constants/api';
import { SafeImage } from '../src/components/SafeImage';
import { useTr } from '../src/i18n/autoTr';
import { useAuth } from '../src/context/AuthContext';
import { geoService, GeoState, haversineM } from '../src/lib/geo';

const SEAL_RADIUS_M = 75;

interface Stop {
  venue_id: string; type: 'visit' | 'dish' | 'gem'; plate?: string; note?: string;
  name?: string; category?: string; image_url?: string; lat?: number; lng?: number;
  done?: boolean;
}
interface Trail {
  key: string; name: string; tagline: string; description: string;
  time_estimate_min: number; best_time?: string; points: number;
  cruise?: boolean; stops: Stop[]; stops_done?: number;
  completed?: boolean; redemption_code?: string | null; redeemed?: boolean;
  partner_reward?: { title?: string } | null;
}

function fmtDist(m: number): string {
  return m < 1000 ? `a ${Math.round(m / 10) * 10}m` : `a ${(m / 1000).toFixed(1)}km`;
}

export default function RutasScreen() {
  const router = useRouter();
  const tr = useTr();
  const { user } = useAuth();
  const [trails, setTrails] = useState<Trail[]>([]);
  const [quest, setQuest] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [geo, setGeo] = useState<GeoState>(geoService.getState());
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<{ trail: Trail; code: string; points: number } | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const data = user ? await api.get('/trails/progress') : await api.get('/trails');
      if (Array.isArray(data?.trails)) {
        setTrails(data.trails);
        setQuest(data.daily_quest || null);
      } else setFailed(true);
    } catch {
      setFailed(true);
    }
    setLoading(false);
  }, [user]);

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

  const pos = geo.status === 'granted' ? geo.position : null;

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3800);
  };

  const stampStop = useCallback(async (trail: Trail, stop: Stop) => {
    if (!user) {
      router.push('/login' as any);
      return;
    }
    let p = geoService.getState().position;
    if (!p || Date.now() - p.ts > 15000) {
      await geoService.request();
      p = geoService.getState().position;
    }
    if (!p) {
      flash(tr('Activa tu ubicación para sellar'));
      return;
    }
    setBusy(stop.venue_id);
    try {
      const body: any = { venue_id: stop.venue_id, type: stop.type === 'gem' ? 'gem' : stop.type, lat: p.lat, lng: p.lng };
      if (stop.type === 'dish' && stop.plate) body.plate = stop.plate;
      await api.post('/passport/discover', body);
      flash(tr('Sellado en tu pasaporte ✓'));
      await load();
    } catch (e: any) {
      const msg = String(e?.message || '');
      flash(msg.includes('too far') ? tr('Acércate al lugar para sellarlo') : tr('No se pudo sellar — intenta de nuevo'));
    } finally {
      setBusy(null);
    }
  }, [user, router, load, tr]);

  const completeTrail = useCallback(async (trail: Trail) => {
    setBusy(trail.key);
    try {
      const r = await api.post(`/trails/${trail.key}/complete`);
      if (r?.redemption_code) {
        setCelebration({ trail, code: r.redemption_code, points: r.points_awarded || 0 });
        await load();
      }
    } catch (e: any) {
      flash(String(e?.message || tr('Aún faltan sellos')));
    } finally {
      setBusy(null);
    }
  }, [load, tr]);

  const claimQuest = useCallback(async () => {
    if (!user) {
      router.push('/login' as any);
      return;
    }
    try {
      const r = await api.post('/quests/daily/claim');
      flash(r?.points_awarded ? `+${r.points_awarded} ${tr('puntos')} ✓` : tr('Ya reclamado hoy'));
      await load();
    } catch {
      flash(tr('Completa el quest primero — sella el plato de hoy'));
    }
  }, [user, router, load, tr]);

  // ── Celebration ────────────────────────────────────────────────────
  if (celebration) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.celebration}>
          <Text style={{ fontSize: 54 }}>🏆</Text>
          <Text style={styles.celTitle}>{tr('¡Ruta completada!')}</Text>
          <Text style={styles.celTrail}>{celebration.trail.name}</Text>
          {celebration.points > 0 && (
            <Text style={styles.celPoints}>+{celebration.points} {tr('puntos AMO')}</Text>
          )}
          <View style={styles.codeBox}>
            <Text style={styles.codeLabel}>{tr('Tu código de ruta')}</Text>
            <Text style={styles.codeText}>{celebration.code}</Text>
            <Text style={styles.codeHint}>
              {tr('Guárdalo — las recompensas de aliados fundadores se canjean con este código.')}
            </Text>
          </View>
          <TouchableOpacity style={styles.celBtn} onPress={() => setCelebration(null)} activeOpacity={0.85}>
            <Text style={styles.celBtnText}>{tr('Seguir explorando')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        <View style={styles.headerRow}>
          {router.canGoBack() && (
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={20} color={COLORS.textMain} />
            </TouchableOpacity>
          )}
          <Text style={styles.title}>{tr('Rutas')}</Text>
        </View>

        {!!notice && <View style={styles.notice}><Text style={styles.noticeText}>{notice}</Text></View>}

        {/* Daily quest — one per day, value-tied, never nagging */}
        {!!quest && (
          <TouchableOpacity
            style={[styles.questCard, quest.claimed && styles.questDone]}
            onPress={quest.done && !quest.claimed ? claimQuest : undefined}
            activeOpacity={quest.done && !quest.claimed ? 0.85 : 1}
          >
            <Text style={{ fontSize: 22 }}>{quest.claimed ? '✅' : '🎯'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.questText}>{quest.text}</Text>
              <Text style={styles.questSub}>
                {quest.claimed
                  ? tr('Quest de hoy completado')
                  : quest.done
                    ? tr('¡Listo! Toca para reclamar tus puntos')
                    : `+${quest.points} ${tr('puntos')} · ${tr('sella el plato de hoy en cualquier lugar que lo sirva')}`}
              </Text>
            </View>
          </TouchableOpacity>
        )}

        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 60 }} />
        ) : failed ? (
          <View style={styles.failBox}>
            <Ionicons name="cloud-offline-outline" size={30} color={COLORS.textMuted} />
            <Text style={styles.failText}>{tr('No pudimos cargar las rutas')}</Text>
            <TouchableOpacity onPress={load}><Text style={styles.failRetry}>{tr('Reintentar')}</Text></TouchableOpacity>
          </View>
        ) : (
          trails.map((t) => {
            const done = t.stops_done ?? t.stops.filter((s) => s.done).length;
            const total = t.stops.length;
            const isOpen = open === t.key;
            const allDone = user && done === total && !t.completed;
            return (
              <View key={t.key} style={[styles.trailCard, t.cruise && styles.trailCruise]}>
                <TouchableOpacity onPress={() => setOpen(isOpen ? null : t.key)} activeOpacity={0.85}>
                  <View style={styles.trailHead}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        {t.cruise && <View style={styles.cruiseBadge}><Text style={styles.cruiseBadgeText}>{tr('MODO CRUCERO')}</Text></View>}
                        {t.completed && <Ionicons name="trophy" size={14} color={COLORS.primary} />}
                      </View>
                      <Text style={styles.trailName}>{t.name}</Text>
                      <Text style={styles.trailTag}>{t.tagline}</Text>
                      <Text style={styles.trailMeta}>
                        ⏱ {Math.round(t.time_estimate_min / 60 * 10) / 10}h · {total} {tr('paradas')} · +{t.points} {tr('puntos')}
                      </Text>
                    </View>
                    <View style={styles.progressRing}>
                      <Text style={styles.progressText}>{user ? `${done}/${total}` : total}</Text>
                    </View>
                  </View>
                </TouchableOpacity>

                {isOpen && (
                  <View style={styles.stopsBox}>
                    {t.stops.map((s, i) => {
                      const d = pos && typeof s.lat === 'number' ? haversineM(pos.lat, pos.lng, s.lat!, s.lng!) : null;
                      const canSeal = !!user && !s.done && d !== null && d <= SEAL_RADIUS_M;
                      return (
                        <View key={s.venue_id + i} style={styles.stopRow}>
                          <SafeImage uri={s.image_url} category={s.category} style={styles.stopImg} />
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.stopName, s.done && styles.stopDone]} numberOfLines={1}>
                              {i + 1}. {s.name}
                            </Text>
                            {!!s.note && <Text style={styles.stopNote} numberOfLines={2}>{s.note}</Text>}
                            {!s.done && d !== null && <Text style={styles.stopDist}>{fmtDist(d)}</Text>}
                          </View>
                          {s.done ? (
                            <Ionicons name="checkmark-circle" size={22} color={COLORS.primary} />
                          ) : canSeal ? (
                            <TouchableOpacity style={styles.sealBtn} onPress={() => stampStop(t, s)} disabled={busy === s.venue_id} activeOpacity={0.85}>
                              <Text style={styles.sealBtnText}>{busy === s.venue_id ? '…' : (s.type === 'dish' ? tr('Lo probé') : tr('Sellar'))}</Text>
                            </TouchableOpacity>
                          ) : (
                            <TouchableOpacity onPress={() => router.push(`/partner/${s.venue_id}` as any)} hitSlop={{ top: 8, bottom: 8 }}>
                              <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    })}

                    {allDone && (
                      <TouchableOpacity style={styles.completeBtn} onPress={() => completeTrail(t)} disabled={busy === t.key} activeOpacity={0.85}>
                        <Text style={styles.completeBtnText}>{busy === t.key ? '…' : tr('Completar ruta 🏆')}</Text>
                      </TouchableOpacity>
                    )}
                    {t.completed && t.redemption_code && (
                      <View style={styles.doneCodeBox}>
                        <Text style={styles.codeLabel}>{tr('Tu código de ruta')}</Text>
                        <Text style={styles.codeText}>{t.redemption_code}</Text>
                        {t.redeemed && <Text style={styles.codeHint}>{tr('Canjeado')} ✓</Text>}
                      </View>
                    )}
                    {!user && (
                      <TouchableOpacity style={styles.guestHintBox} onPress={() => router.push('/login' as any)}>
                        <Text style={styles.guestHint}>{tr('Inicia sesión para sellar paradas y ganar la ruta')}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            );
          })
        )}

        <Text style={styles.privacy}>{tr('Los sellos se verifican en el lugar — tu recorrido nunca se guarda.')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 22, color: COLORS.textMain, ...FONTS.bold },
  notice: { marginHorizontal: SPACING.lg, marginBottom: SPACING.sm, padding: 10, backgroundColor: 'rgba(245,11,27,0.12)', borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(245,11,27,0.4)' },
  noticeText: { fontSize: 12, color: COLORS.primary, ...FONTS.semibold, textAlign: 'center' },

  questCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: SPACING.lg, marginBottom: SPACING.md, padding: SPACING.md, backgroundColor: 'rgba(245,11,27,0.07)', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(245,11,27,0.35)' },
  questDone: { opacity: 0.75 },
  questText: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold },
  questSub: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, marginTop: 2 },

  failBox: { alignItems: 'center', gap: 8, marginTop: 50 },
  failText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.medium },
  failRetry: { fontSize: 13, color: COLORS.primary, ...FONTS.bold },

  trailCard: { marginHorizontal: SPACING.lg, marginBottom: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  trailCruise: { borderColor: 'rgba(6,182,212,0.6)' },
  trailHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: SPACING.md },
  cruiseBadge: { backgroundColor: '#06B6D4', borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2 },
  cruiseBadgeText: { fontSize: 8, color: '#000', ...FONTS.bold, letterSpacing: 1 },
  trailName: { fontSize: 17, color: COLORS.textMain, ...FONTS.bold, marginTop: 2 },
  trailTag: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium, marginTop: 1 },
  trailMeta: { fontSize: 11, color: 'rgba(245,11,27,0.9)', ...FONTS.semibold, marginTop: 4 },
  progressRing: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  progressText: { fontSize: 13, color: COLORS.primary, ...FONTS.bold },

  stopsBox: { borderTopWidth: 1, borderTopColor: COLORS.border, padding: SPACING.md, gap: 10 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stopImg: { width: 42, height: 42, borderRadius: RADIUS.md },
  stopName: { fontSize: 13, color: COLORS.textMain, ...FONTS.semibold },
  stopDone: { color: COLORS.textMuted, textDecorationLine: 'line-through' },
  stopNote: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
  stopDist: { fontSize: 10, color: 'rgba(245,11,27,0.9)', ...FONTS.semibold, marginTop: 1 },
  sealBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 6 },
  sealBtnText: { fontSize: 11, color: '#000', ...FONTS.bold },
  completeBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  completeBtnText: { fontSize: 14, color: '#000', ...FONTS.bold },
  doneCodeBox: { alignItems: 'center', gap: 3, padding: SPACING.sm, backgroundColor: 'rgba(245,11,27,0.07)', borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(245,11,27,0.3)' },
  guestHintBox: { alignItems: 'center', paddingVertical: 8 },
  guestHint: { fontSize: 12, color: COLORS.primary, ...FONTS.semibold },

  celebration: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: SPACING.xl },
  celTitle: { fontSize: 24, color: COLORS.textMain, ...FONTS.bold },
  celTrail: { fontSize: 16, color: COLORS.textMuted, ...FONTS.medium },
  celPoints: { fontSize: 18, color: COLORS.primary, ...FONTS.bold },
  codeBox: { alignItems: 'center', gap: 4, padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, borderWidth: 1.5, borderColor: COLORS.primary, marginTop: 8 },
  codeLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 1 },
  codeText: { fontSize: 26, color: COLORS.primary, ...FONTS.bold, letterSpacing: 2 },
  codeHint: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center', maxWidth: 240, marginTop: 4 },
  celBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: 26, paddingVertical: 12, marginTop: 12 },
  celBtnText: { fontSize: 14, color: '#000', ...FONTS.bold },

  privacy: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center', paddingHorizontal: SPACING.xl, marginTop: SPACING.sm, opacity: 0.7 },
});
