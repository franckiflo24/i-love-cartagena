// Drop 8 — the stamp-slam moment. Every FIRST verified check-in earns a
// full-screen celebration: an inked passport stamp slams in, points land,
// new medals reveal, a rank-up gets its own banner. Celebrates ONLY what the
// server actually awarded this call (new_achievements/points_earned) — a
// re-stamp or offline path never triggers this.

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Platform, Modal } from 'react-native';
import { COLORS, RADIUS, FONTS } from '../constants/theme';
import { useTr } from '../i18n/autoTr';
import { achievementDef } from '../lib/achievements';
import type { Rank } from '../lib/passport';

export interface CelebrationData {
  venueName: string;
  points: number;
  achievements: string[]; // achievement keys awarded THIS stamp
  rankUp: Rank | null;
  specials?: { key: string; name: string; icon: string }[];
  completions?: { type: string; name: string }[];
}

// 8E1 — completion reopens the loop: each finished collection points at the
// next real chase. Honest recognition only (partner-funded rewards arrive
// via the trails rails; no hollow "you won!" here).
const NEXT_LOOP: Record<string, string> = {
  sabores: '¿Vas por las 12 plazas?',
  plazas: '¿Vas por los 20 sabores?',
  barrio: '¿Vas por el siguiente barrio?',
};

interface Props {
  data: CelebrationData | null;
  onClose: () => void;
}

export function StampCelebration({ data, onClose }: Props) {
  const tr = useTr();
  const backdrop = useRef(new Animated.Value(0)).current;
  const stampScale = useRef(new Animated.Value(2.4)).current;
  const stampOpacity = useRef(new Animated.Value(0)).current;
  const detailsOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!data) return;
    backdrop.setValue(0);
    stampScale.setValue(2.4);
    stampOpacity.setValue(0);
    detailsOpacity.setValue(0);
    // Haptic thunk where the platform allows it (fail-soft everywhere)
    if (Platform.OS === 'web') {
      try { (navigator as any)?.vibrate?.([28, 40, 28]); } catch {}
    }
    Animated.sequence([
      Animated.timing(backdrop, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.parallel([
        Animated.timing(stampOpacity, { toValue: 1, duration: 120, useNativeDriver: true }),
        Animated.spring(stampScale, { toValue: 1, friction: 5, tension: 130, useNativeDriver: true }),
      ]),
      Animated.timing(detailsOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
    ]).start();
  }, [data, backdrop, stampScale, stampOpacity, detailsOpacity]);

  if (!data) return null;

  const today = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
    <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdrop }]}>
      <Animated.View style={[styles.stamp, { opacity: stampOpacity, transform: [{ scale: stampScale }, { rotate: '-7deg' }] }]}>
        <Text style={styles.stampArc}>AMO CARTAGENA</Text>
        <Text style={styles.stampVenue} numberOfLines={2}>{data.venueName}</Text>
        <Text style={styles.stampDate}>{today}</Text>
        <Text style={styles.stampVerified}>{tr('VERIFICADO EN EL LUGAR')}</Text>
      </Animated.View>

      <Animated.View style={[styles.details, { opacity: detailsOpacity }]}>
        {data.points > 0 && (
          <View style={styles.pointsPill}>
            <Text style={styles.pointsText}>+{data.points} {tr('puntos')}</Text>
          </View>
        )}

        {!!data.rankUp && (
          <View style={styles.rankBanner}>
            <Text style={styles.rankBannerIcon}>{data.rankUp.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.rankBannerKicker}>{tr('¡Nuevo nivel!')}</Text>
              <Text style={styles.rankBannerName}>{tr(data.rankUp.name)}</Text>
            </View>
          </View>
        )}

        {(data.completions || []).map((c) => (
          <View key={`${c.type}-${c.name}`} style={styles.rankBanner}>
            <Text style={styles.rankBannerIcon}>🏆</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.rankBannerKicker}>{tr('¡Colección completa!')}</Text>
              <Text style={styles.rankBannerName}>{c.name}</Text>
              <Text style={styles.nextLoopText}>{tr(NEXT_LOOP[c.type] || '')}</Text>
            </View>
          </View>
        ))}

        {(data.specials || []).map((s) => (
          <View key={s.key} style={styles.medalRow}>
            <Text style={styles.medalIcon}>{s.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.medalName}>{s.name}</Text>
              <Text style={styles.medalDesc}>{tr('Sello especial — ventana real')}</Text>
            </View>
            <Text style={styles.medalNew}>{tr('NUEVA')}</Text>
          </View>
        ))}

        {data.achievements.map((k) => {
          const a = achievementDef(k);
          return (
            <View key={k} style={styles.medalRow}>
              <Text style={styles.medalIcon}>{a.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.medalName}>{tr(a.name)}</Text>
                {!!a.desc && <Text style={styles.medalDesc}>{tr(a.desc)}</Text>}
              </View>
              <Text style={styles.medalNew}>{tr('NUEVA')}</Text>
            </View>
          );
        })}

        <TouchableOpacity style={styles.cta} onPress={onClose} activeOpacity={0.85}>
          <Text style={styles.ctaText}>{tr('Seguir explorando')}</Text>
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(4,4,8,0.92)', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 24 },
  stamp: {
    width: 210, height: 210, borderRadius: 105, borderWidth: 3, borderColor: COLORS.primary,
    borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: 'rgba(212,175,55,0.06)', padding: 18,
  },
  stampArc: { fontSize: 11, color: COLORS.primary, ...FONTS.bold, letterSpacing: 3 },
  stampVenue: { fontSize: 17, color: '#FFF', ...FONTS.bold, textAlign: 'center', lineHeight: 22 },
  stampDate: { fontSize: 11, color: 'rgba(255,255,255,0.6)', ...FONTS.medium },
  stampVerified: { fontSize: 8, color: COLORS.primary, ...FONTS.bold, letterSpacing: 2 },
  details: { width: '100%', maxWidth: 360, marginTop: 26, gap: 10, alignItems: 'center' },
  pointsPill: { backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: 18, paddingVertical: 7 },
  pointsText: { fontSize: 14, color: '#000', ...FONTS.bold },
  rankBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12, width: '100%',
    backgroundColor: 'rgba(212,175,55,0.14)', borderRadius: RADIUS.lg, borderWidth: 1,
    borderColor: COLORS.primary, padding: 14,
  },
  rankBannerIcon: { fontSize: 30 },
  rankBannerKicker: { fontSize: 10, color: COLORS.primary, ...FONTS.bold, letterSpacing: 1.5 },
  rankBannerName: { fontSize: 17, color: '#FFF', ...FONTS.bold },
  nextLoopText: { fontSize: 12, color: 'rgba(255,255,255,0.7)', ...FONTS.semibold, marginTop: 3 },
  medalRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, width: '100%',
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: RADIUS.lg, borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.4)', padding: 12,
  },
  medalIcon: { fontSize: 26 },
  medalName: { fontSize: 14, color: '#FFF', ...FONTS.bold },
  medalDesc: { fontSize: 11, color: 'rgba(255,255,255,0.55)', ...FONTS.medium, marginTop: 1 },
  medalNew: { fontSize: 9, color: COLORS.primary, ...FONTS.bold, letterSpacing: 1.5 },
  cta: { marginTop: 8, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingHorizontal: 28, paddingVertical: 12 },
  ctaText: { fontSize: 14, color: '#000', ...FONTS.bold },
});

export default StampCelebration;
