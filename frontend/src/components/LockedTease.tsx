// Drop FOMO — the teasing wall. ONE reusable "locked preview": the real thing,
// rendered BLURRED behind a gold scrim that names the magic and unlocks it in a
// single tap (into the existing Drop GATE signup wall). This is the difference
// between a locked door (friction) and a lit window you want to walk through
// (desire) — every anonymous dead-end becomes a LockedTease.
//
// Cost/security note: the blurred children must be SAFE-to-show placeholder or
// generic content, never real personalized/paid data — the point is to tease the
// SHAPE of the value, not leak it. The unlock is the existing openGate() wall.
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { useSignupGate, GateAction } from '../context/SignupGateContext';

const GOLD = '#F50B1B';

interface Props {
  title: string;
  subtitle?: string;
  cta?: string;
  action: GateAction;
  next?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  minHeight?: number;
  children: React.ReactNode; // the real preview, shown blurred + non-interactive
}

export default function LockedTease({
  title, subtitle, cta = 'Crear cuenta gratis', action, next,
  icon = 'sparkles', minHeight = 150, children,
}: Props) {
  const { openGate } = useSignupGate();
  const unlock = () => openGate({ action, next });

  // Web (the live product) gets a true frosted blur; native degrades to a dim
  // veil so the shape still reads without pulling in a native blur dependency.
  const blurStyle: any = Platform.OS === 'web'
    ? { filter: 'blur(7px)', opacity: 0.9 }
    : { opacity: 0.25 };

  return (
    <View style={[styles.wrap, { minHeight }]}>
      <View style={[styles.blurLayer, blurStyle]} pointerEvents="none">
        {children}
      </View>
      <TouchableOpacity style={styles.scrim} activeOpacity={0.9} onPress={unlock} accessibilityRole="button" accessibilityLabel={`${title}. ${cta}`}>
        <View style={styles.seal}><Ionicons name={icon} size={22} color={GOLD} /></View>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        <View style={styles.cta}>
          <Text style={styles.ctaText}>{cta}</Text>
          <Ionicons name="arrow-forward" size={15} color="#0A0A0A" />
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative', borderRadius: RADIUS.lg, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(245,11,27,0.25)', backgroundColor: COLORS.surface,
  },
  blurLayer: { width: '100%' },
  scrim: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(8,8,14,0.62)', alignItems: 'center', justifyContent: 'center',
    padding: SPACING.lg, gap: 7,
  },
  seal: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: 'rgba(245,11,27,0.5)',
    borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', marginBottom: 3,
  },
  title: {
    color: '#FFFFFF', fontSize: 16.5, textAlign: 'center', ...FONTS.bold,
    fontFamily: Platform.select({ web: 'Georgia, serif', default: 'serif' }),
  },
  subtitle: { color: 'rgba(255,255,255,0.78)', fontSize: 13, textAlign: 'center', lineHeight: 18 },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: GOLD,
    borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16, marginTop: 6,
  },
  ctaText: { color: '#0A0A0A', fontSize: 13.5, ...FONTS.bold },
});
