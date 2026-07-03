import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Dimensions, Image, ScrollView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { IMAGES } from '../src/constants/images';
import { useLang } from '../src/context/LanguageContext';
import { useAuth } from '../src/context/AuthContext';
import { api } from '../src/constants/api';

const { width: W } = Dimensions.get('window');
const ACCENT = '#D97706';

type Step = 'welcome' | 'type' | 'travel' | 'interests' | 'complete';
const STEPS: Step[] = ['welcome', 'type', 'travel', 'interests', 'complete'];

const INTEREST_ITEMS = [
  { key: 'restaurant', icon: 'restaurant' },
  { key: 'bar', icon: 'wine' },
  { key: 'beach_club', icon: 'umbrella' },
  { key: 'club', icon: 'musical-notes' },
  { key: 'spa', icon: 'leaf' },
  { key: 'beauty', icon: 'cut' },
  { key: 'activity', icon: 'compass' },
  { key: 'hotel', icon: 'bed' },
  { key: 'cafe', icon: 'cafe' },
  { key: 'yacht', icon: 'boat' },
];

const PARTY_TYPES = [
  { key: 'solo', icon: 'person' },
  { key: 'couple', icon: 'heart' },
  { key: 'family', icon: 'people' },
  { key: 'friends', icon: 'beer' },
  { key: 'cruise', icon: 'boat' },
];

const addDays = (d: Date, n: number) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const fmtDate = (iso: string) => {
  const d = new Date(iso + 'T12:00:00');
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${d.getDate()} ${months[d.getMonth()]}`;
};

export default function OnboardingScreen() {
  const router = useRouter();
  const { s } = useLang();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>('welcome');
  const [skippedSteps, setSkippedSteps] = useState<string[]>([]);

  // Profile state
  const [userType, setUserType] = useState<'visitor' | 'local' | null>(null);
  const [startDate, setStartDate] = useState(toIso(new Date()));
  const [endDate, setEndDate] = useState(toIso(addDays(new Date(), 3)));
  const [partyType, setPartyType] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[]>([]);

  const stepIdx = STEPS.indexOf(step);

  const skip = () => {
    setSkippedSteps(prev => [...prev, step]);
    goNext();
  };

  const goNext = () => {
    const next = stepIdx + 1;
    if (next >= STEPS.length) {
      finish(true);
    } else {
      // Locals skip travel/party screen
      if (STEPS[next] === 'travel' && userType === 'local') {
        setStep(STEPS[next + 1] || 'complete');
      } else {
        setStep(STEPS[next]);
      }
    }
  };

  const finish = async (completed: boolean) => {
    await AsyncStorage.setItem('@onboarding_done', 'true');

    // Persist to backend if logged in
    if (user) {
      try {
        await api.patch('/users/me/onboarding', {
          user_type: userType,
          travel_dates: userType === 'visitor' ? { start: startDate, end: endDate } : null,
          party_type: partyType,
          interests,
          onboarding_version: 1,
          profile_complete: completed,
          skipped_steps: skippedSteps,
        });
      } catch {}
    } else {
      // Cache for later sync after login
      await AsyncStorage.setItem('@onboarding_profile', JSON.stringify({
        user_type: userType, travel_dates: userType === 'visitor' ? { start: startDate, end: endDate } : null,
        party_type: partyType, interests, skipped_steps: skippedSteps,
      }));
    }

    router.replace('/(tabs)');
  };

  const toggleInterest = (key: string) => {
    setInterests(prev => {
      if (prev.includes(key)) return prev.filter(k => k !== key);
      if (prev.length >= 4) return prev;
      return [...prev, key];
    });
  };

  // Adjust date by days
  const adjustDate = (which: 'start' | 'end', days: number) => {
    if (which === 'start') {
      const d = addDays(new Date(startDate + 'T12:00:00'), days);
      const iso = toIso(d);
      setStartDate(iso);
      if (iso >= endDate) setEndDate(toIso(addDays(d, 1)));
    } else {
      const d = addDays(new Date(endDate + 'T12:00:00'), days);
      const iso = toIso(d);
      if (iso > startDate) setEndDate(iso);
    }
  };

  return (
    <View style={st.container}>
      <Image source={{ uri: IMAGES.hero }} style={st.bg} />
      <View style={st.overlay} />

      <SafeAreaView style={st.safe} edges={['top', 'bottom']}>
        {/* Skip */}
        <View style={st.topBar}>
          <View />
          {step !== 'complete' && (
            <TouchableOpacity onPress={skip} style={st.skipBtn}>
              <Text style={st.skipText}>{s('onboard_skip')}</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={st.content} showsVerticalScrollIndicator={false}>

          {/* ── WELCOME ── */}
          {step === 'welcome' && (
            <View style={st.center}>
              <Text style={st.heroEmoji}>❤️</Text>
              <Text style={st.heroTitle}>AMO{'\n'}CARTAGENA</Text>
              <View style={st.divider} />
              <Text style={st.heroDesc}>{s('onboard_1_desc')}</Text>
            </View>
          )}

          {/* ── USER TYPE ── */}
          {step === 'type' && (
            <View style={st.center}>
              <Text style={st.sectionTitle}>{s('onboard_type_title')}</Text>
              <Text style={st.sectionDesc}>{s('onboard_type_desc')}</Text>
              <View style={st.cardsRow}>
                {(['visitor', 'local'] as const).map(t => {
                  const active = userType === t;
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[st.typeCard, active && st.typeCardActive]}
                      onPress={() => setUserType(t)}
                      activeOpacity={0.85}
                    >
                      <Ionicons name={t === 'visitor' ? 'airplane' : 'home'} size={32} color={active ? ACCENT : COLORS.textMuted} />
                      <Text style={[st.typeLabel, active && st.typeLabelActive]}>{s(`onboard_type_${t}`)}</Text>
                      <Text style={st.typeDesc}>{s(`onboard_type_${t}_desc`)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* ── TRAVEL + PARTY ── */}
          {step === 'travel' && (
            <View style={st.center}>
              <Text style={st.sectionTitle}>{s('onboard_travel_title')}</Text>

              {/* Date picker */}
              <Text style={st.label}>{s('onboard_travel_dates')}</Text>
              <View style={st.dateRow}>
                <View style={st.dateBox}>
                  <Text style={st.dateLabel}>{s('onboard_travel_start')}</Text>
                  <View style={st.dateControls}>
                    <TouchableOpacity onPress={() => adjustDate('start', -1)} style={st.dateBtn}><Ionicons name="remove" size={18} color={COLORS.white} /></TouchableOpacity>
                    <Text style={st.dateValue}>{fmtDate(startDate)}</Text>
                    <TouchableOpacity onPress={() => adjustDate('start', 1)} style={st.dateBtn}><Ionicons name="add" size={18} color={COLORS.white} /></TouchableOpacity>
                  </View>
                </View>
                <View style={st.dateBox}>
                  <Text style={st.dateLabel}>{s('onboard_travel_end')}</Text>
                  <View style={st.dateControls}>
                    <TouchableOpacity onPress={() => adjustDate('end', -1)} style={st.dateBtn}><Ionicons name="remove" size={18} color={COLORS.white} /></TouchableOpacity>
                    <Text style={st.dateValue}>{fmtDate(endDate)}</Text>
                    <TouchableOpacity onPress={() => adjustDate('end', 1)} style={st.dateBtn}><Ionicons name="add" size={18} color={COLORS.white} /></TouchableOpacity>
                  </View>
                </View>
              </View>

              {/* Party type */}
              <Text style={[st.label, { marginTop: SPACING.lg }]}>{s('onboard_party_title')}</Text>
              <View style={st.partyRow}>
                {PARTY_TYPES.map(p => {
                  const active = partyType === p.key;
                  return (
                    <TouchableOpacity
                      key={p.key}
                      style={[st.partyChip, active && st.partyChipActive]}
                      onPress={() => setPartyType(p.key)}
                      activeOpacity={0.85}
                    >
                      <Ionicons name={p.icon as any} size={20} color={active ? COLORS.white : COLORS.textMuted} />
                      <Text style={[st.partyText, active && st.partyTextActive]}>{s(`onboard_party_${p.key}`)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* ── INTERESTS ── */}
          {step === 'interests' && (
            <View style={st.center}>
              <Text style={st.sectionTitle}>{s('onboard_interests_title')}</Text>
              <Text style={st.sectionDesc}>{s('onboard_interests_desc')}</Text>
              <View style={st.interestGrid}>
                {INTEREST_ITEMS.map(item => {
                  const active = interests.includes(item.key);
                  const disabled = !active && interests.length >= 4;
                  return (
                    <TouchableOpacity
                      key={item.key}
                      style={[st.interestChip, active && st.interestChipActive, disabled && { opacity: 0.4 }]}
                      onPress={() => toggleInterest(item.key)}
                      disabled={disabled}
                      activeOpacity={0.85}
                    >
                      <Ionicons name={item.icon as any} size={22} color={active ? COLORS.white : COLORS.textMuted} />
                      <Text style={[st.interestText, active && st.interestTextActive]}>
                        {s(`onboard_interest_${item.key}`)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={st.counter}>{interests.length}/4</Text>
            </View>
          )}

          {/* ── COMPLETE ── */}
          {step === 'complete' && (
            <View style={st.center}>
              <Text style={{ fontSize: 64 }}>🎉</Text>
              <Text style={st.heroTitle}>{s('onboard_complete_title')}</Text>
              <Text style={st.heroDesc}>{s('onboard_complete_desc')}</Text>
            </View>
          )}
        </ScrollView>

        {/* Bottom */}
        <View style={st.bottom}>
          {/* Progress dots */}
          <View style={st.dots}>
            {STEPS.map((_, i) => (
              <View key={i} style={[st.dot, i === stepIdx && st.dotActive]} />
            ))}
          </View>

          <TouchableOpacity
            style={[st.nextBtn, step === 'type' && !userType && { opacity: 0.4 }]}
            onPress={step === 'complete' ? () => finish(true) : goNext}
            disabled={step === 'type' && !userType}
            activeOpacity={0.85}
          >
            {step === 'complete' ? (
              <>
                <Ionicons name="rocket" size={20} color="#FFF" />
                <Text style={st.nextText}>{s('onboard_start')}</Text>
              </>
            ) : (
              <>
                <Text style={st.nextText}>{s('onboard_next')}</Text>
                <Ionicons name="arrow-forward" size={20} color="#FFF" />
              </>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050814' },
  bg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(5,8,20,0.78)' },
  safe: { flex: 1 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  skipBtn: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: RADIUS.full },
  skipText: { fontSize: 14, color: COLORS.white, ...FONTS.medium },

  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: SPACING.xl },
  center: { alignItems: 'center', gap: SPACING.md },

  // Welcome
  heroEmoji: { fontSize: 48, marginBottom: SPACING.sm },
  heroTitle: { fontSize: 36, color: COLORS.white, ...FONTS.bold, textAlign: 'center', letterSpacing: 2, lineHeight: 44 },
  divider: { width: 60, height: 2, backgroundColor: ACCENT, marginVertical: SPACING.sm },
  heroDesc: { fontSize: 15, color: 'rgba(255,255,255,0.75)', ...FONTS.regular, textAlign: 'center', lineHeight: 22, paddingHorizontal: SPACING.md },

  // Section
  sectionTitle: { fontSize: 24, color: COLORS.white, ...FONTS.bold, textAlign: 'center', lineHeight: 32 },
  sectionDesc: { fontSize: 14, color: 'rgba(255,255,255,0.6)', ...FONTS.regular, textAlign: 'center', marginBottom: SPACING.sm },
  label: { fontSize: 13, color: ACCENT, ...FONTS.bold, letterSpacing: 1, textTransform: 'uppercase', alignSelf: 'flex-start', marginBottom: SPACING.xs },

  // Type cards
  cardsRow: { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.md },
  typeCard: {
    flex: 1, alignItems: 'center', gap: 8, paddingVertical: 24, paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: RADIUS.xl,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.1)',
  },
  typeCardActive: { borderColor: ACCENT, backgroundColor: 'rgba(217,119,6,0.12)' },
  typeLabel: { fontSize: 16, color: COLORS.white, ...FONTS.bold },
  typeLabelActive: { color: ACCENT },
  typeDesc: { fontSize: 11, color: 'rgba(255,255,255,0.5)', ...FONTS.regular, textAlign: 'center' },

  // Dates
  dateRow: { flexDirection: 'row', gap: SPACING.md, width: '100%' },
  dateBox: { flex: 1, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: RADIUS.lg, padding: SPACING.md, alignItems: 'center', gap: 6 },
  dateLabel: { fontSize: 11, color: 'rgba(255,255,255,0.5)', ...FONTS.medium, textTransform: 'uppercase' },
  dateControls: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  dateBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  dateValue: { fontSize: 16, color: COLORS.white, ...FONTS.bold, minWidth: 60, textAlign: 'center' },

  // Party
  partyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, justifyContent: 'center' },
  partyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: RADIUS.full,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.1)',
  },
  partyChipActive: { borderColor: ACCENT, backgroundColor: 'rgba(217,119,6,0.15)' },
  partyText: { fontSize: 13, color: 'rgba(255,255,255,0.6)', ...FONTS.semibold },
  partyTextActive: { color: COLORS.white },

  // Interests
  interestGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, justifyContent: 'center', marginTop: SPACING.sm },
  interestChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: RADIUS.full,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.1)',
  },
  interestChipActive: { borderColor: ACCENT, backgroundColor: 'rgba(217,119,6,0.18)' },
  interestText: { fontSize: 13, color: 'rgba(255,255,255,0.6)', ...FONTS.semibold },
  interestTextActive: { color: COLORS.white },
  counter: { fontSize: 12, color: 'rgba(255,255,255,0.4)', ...FONTS.medium, marginTop: SPACING.xs },

  // Bottom
  bottom: { paddingHorizontal: SPACING.xl, paddingBottom: SPACING.lg, gap: SPACING.md },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.2)' },
  dotActive: { width: 24, backgroundColor: ACCENT },
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm,
    paddingVertical: 16, borderRadius: RADIUS.full, backgroundColor: ACCENT,
  },
  nextText: { fontSize: 17, color: '#FFF', ...FONTS.bold },
});
