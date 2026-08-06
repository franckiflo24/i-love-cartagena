// Drop FR (FR-D) — the returning-user warm beat. A light gold banner on home,
// shown ONCE per login (sessionStorage flag set by login.tsx), that surfaces
// what Drop 8 already computes — earned title (or none, never a fake one),
// best streak — plus the real time-aware "now" line (Drop 9). A warm greeting,
// not a second onboarding; dismissible; fails soft to nothing.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { api, API_BASE } from '../constants/api';
import { useAuth } from '../context/AuthContext';

const GOLD = '#D4AF37';
const GOLD_BRIGHT = '#F5D47A';

export default function WelcomeBackBeat() {
  const { user } = useAuth();
  const [show, setShow] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
  const [nowLine, setNowLine] = useState<string | null>(null);
  const fade = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let flagged = false;
    try { flagged = sessionStorage.getItem('amo_welcome_back') === '1'; } catch {}
    if (!flagged || !user) return;
    try { sessionStorage.removeItem('amo_welcome_back'); } catch {}

    (async () => {
      let realTitle: string | null = null;
      let best = 0;
      try {
        const p = await api.get('/passport');
        realTitle = p?.titles?.primary?.name || null;   // Drop 8: earned or null, never faked
        best = p?.streak?.best || 0;
      } catch { /* no passport yet — that's fine, the beat still greets */ }
      try {
        const r = await fetch(`${API_BASE}/now`);
        if (r.ok) { const d = await r.json(); if (d?.occasion?.es) setNowLine(d.occasion.es); }
      } catch {}
      setTitle(realTitle);
      setStreak(best);
      setShow(true);
      Animated.timing(fade, { toValue: 1, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      // auto-dismiss after a warm beat (not a nag)
      setTimeout(() => dismiss(), 9000);
    })();
  }, [user]);

  const dismiss = () => {
    Animated.timing(fade, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => setShow(false));
  };

  if (!show) return null;
  const firstName = (user?.name || '').trim().split(' ')[0];
  const heading = title
    ? `Bienvenido de nuevo, ${title}`
    : firstName ? `Bienvenido de nuevo, ${firstName}` : 'Bienvenido de nuevo';

  return (
    <Animated.View style={[styles.wrap, { opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] }]}>
      <View style={styles.row}>
        <View style={styles.dot}><Text style={styles.dotText}>L</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.heading} numberOfLines={1}>{heading}</Text>
          <Text style={styles.sub} numberOfLines={2}>
            {streak > 1 ? `🔥 racha de ${streak} días · ` : ''}
            {nowLine || 'Cartagena te espera — ¿qué querés hacer hoy?'}
          </Text>
        </View>
        <TouchableOpacity onPress={dismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close" size={18} color={COLORS.textMuted} />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: SPACING.lg, marginTop: SPACING.sm, marginBottom: SPACING.xs,
    backgroundColor: 'rgba(212,175,55,0.1)', borderColor: 'rgba(212,175,55,0.32)', borderWidth: 1,
    borderRadius: RADIUS.lg, padding: SPACING.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 34, height: 34, borderRadius: 17, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center' },
  dotText: { color: '#0A0A0A', fontSize: 16, fontWeight: '700' },
  heading: { color: GOLD_BRIGHT, fontSize: 15, ...FONTS.bold },
  sub: { color: 'rgba(255,255,255,0.75)', fontSize: 12.5, marginTop: 2, lineHeight: 17 },
});
