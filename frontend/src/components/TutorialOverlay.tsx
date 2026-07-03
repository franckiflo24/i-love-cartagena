import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';

const { width: W, height: H } = Dimensions.get('window');

type Stop = {
  key: string;
  icon: string;
  title: string;
  description: string;
  position: 'top' | 'bottom';
};

interface TutorialOverlayProps {
  visible: boolean;
  onComplete: () => void;
  stops: Stop[];
}

export function TutorialOverlay({ visible, onComplete, stops }: TutorialOverlayProps) {
  const [step, setStep] = useState(0);

  useEffect(() => { if (visible) setStep(0); }, [visible]);

  if (!visible || stops.length === 0) return null;

  const current = stops[step];
  const isLast = step === stops.length - 1;

  const next = () => {
    if (isLast) {
      onComplete();
    } else {
      setStep(step + 1);
    }
  };

  const skip = () => onComplete();

  return (
    <View style={st.overlay}>
      {/* Dark scrim */}
      <TouchableOpacity style={st.scrim} activeOpacity={1} onPress={next} />

      {/* Tooltip card */}
      <View style={[st.tooltip, current.position === 'top' ? { top: H * 0.15 } : { bottom: H * 0.18 }]}>
        {/* Icon spotlight */}
        <View style={st.spotlight}>
          <Ionicons name={current.icon as any} size={32} color="#D97706" />
        </View>

        <Text style={st.title}>{current.title}</Text>
        <Text style={st.desc}>{current.description}</Text>

        {/* Progress + actions */}
        <View style={st.footer}>
          <View style={st.dots}>
            {stops.map((_, i) => (
              <View key={i} style={[st.dot, i === step && st.dotActive]} />
            ))}
          </View>

          <View style={st.actions}>
            {!isLast && (
              <TouchableOpacity onPress={skip} style={st.skipBtn}>
                <Text style={st.skipText}>Skip</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={next} style={st.nextBtn}>
              <Text style={st.nextText}>{isLast ? 'Got it' : 'Next'}</Text>
              {!isLast && <Ionicons name="arrow-forward" size={14} color="#FFF" />}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

// Hook: manages tutorial state (shown once, replayable)
export function useTutorial() {
  const [showTutorial, setShowTutorial] = useState(false);

  const checkAndShow = async () => {
    if (Platform.OS !== 'web') return;
    const seen = await AsyncStorage.getItem('@tutorial_seen');
    const onboardDone = await AsyncStorage.getItem('@onboarding_done');
    if (onboardDone && !seen) {
      setShowTutorial(true);
    }
  };

  const completeTutorial = async () => {
    setShowTutorial(false);
    await AsyncStorage.setItem('@tutorial_seen', 'true');
  };

  const replayTutorial = () => {
    setShowTutorial(true);
  };

  return { showTutorial, checkAndShow, completeTutorial, replayTutorial };
}

const st = StyleSheet.create({
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
    justifyContent: 'center', alignItems: 'center',
  },
  scrim: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(5,8,20,0.85)',
  },
  tooltip: {
    position: 'absolute', left: 24, right: 24,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    borderWidth: 1, borderColor: 'rgba(217,119,6,0.3)',
    gap: SPACING.sm,
    alignItems: 'center',
  },
  spotlight: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(217,119,6,0.15)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(217,119,6,0.3)',
    marginBottom: SPACING.xs,
  },
  title: { fontSize: 20, color: COLORS.white, ...FONTS.bold, textAlign: 'center' },
  desc: { fontSize: 14, color: 'rgba(255,255,255,0.7)', ...FONTS.regular, textAlign: 'center', lineHeight: 20 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginTop: SPACING.sm },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)' },
  dotActive: { width: 18, backgroundColor: '#D97706' },
  actions: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center' },
  skipBtn: { paddingVertical: 6, paddingHorizontal: 12 },
  skipText: { fontSize: 13, color: 'rgba(255,255,255,0.5)', ...FONTS.medium },
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 8, paddingHorizontal: 16,
    backgroundColor: '#D97706', borderRadius: RADIUS.full,
  },
  nextText: { fontSize: 13, color: '#FFF', ...FONTS.bold },
});
