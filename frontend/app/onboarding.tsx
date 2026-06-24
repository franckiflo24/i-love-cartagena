import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Dimensions, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { IMAGES } from '../src/constants/images';
import { useLang } from '../src/context/LanguageContext';

const { width } = Dimensions.get('window');

export default function OnboardingScreen() {
  const router = useRouter();
  const { s } = useLang();
  const [index, setIndex] = useState(0);

  const SLIDES = [
    { image: IMAGES.cartagena_aerial, title: s('onboard_1_title'), description: s('onboard_1_desc'), color: '#D97706', pills: ['Conciertos', 'Filtros', 'Favoritos'] },
    { image: IMAGES.login, title: s('onboard_2_title'), description: s('onboard_2_desc'), color: '#3B82F6', pills: ['Venues', 'Partners', 'Navegación'] },
    { image: IMAGES.umbrellas, title: s('onboard_3_title'), description: s('onboard_3_desc'), color: '#22C55E', pills: ['QR Code', 'Descuentos', 'Premium'] },
  ];

  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;

  const goNext = () => {
    if (isLast) {
      completeOnboarding();
    } else {
      setIndex(index + 1);
    }
  };

  const completeOnboarding = async () => {
    await AsyncStorage.setItem('@onboarding_done', 'true');
    router.replace('/(tabs)');
  };

  return (
    <View style={styles.container}>
      <Image source={{ uri: slide.image }} style={styles.bgImage} />
      <View style={styles.bgOverlay} />

      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        {/* Skip */}
        <View style={styles.topBar}>
          <View />
          {!isLast && (
            <TouchableOpacity onPress={completeOnboarding} style={styles.skipBtn}>
              <Text style={styles.skipText}>{s('onboard_skip')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Slide Content */}
        <View style={styles.slideArea}>
          <Text style={styles.slideTitle}>{slide.title}</Text>
          <Text style={styles.slideDesc}>{slide.description}</Text>

          <View style={styles.pillsRow}>
            {slide.pills.map(t => (
              <View key={t} style={[styles.pill, { borderColor: `${slide.color}80`, backgroundColor: `${slide.color}20` }]}>
                <Text style={[styles.pillText, { color: '#FFF' }]}>{t}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Bottom */}
        <View style={styles.bottom}>
          {/* Dots */}
          <View style={styles.dots}>
            {SLIDES.map((_s, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i === index && { backgroundColor: slide.color, width: 24 },
                ]}
              />
            ))}
          </View>

          {/* Button */}
          <TouchableOpacity
            style={[styles.nextBtn, { backgroundColor: slide.color }]}
            onPress={goNext}
            activeOpacity={0.85}
          >
            {isLast ? (
              <>
                <Ionicons name="rocket" size={20} color="#FFF" />
                <Text style={styles.nextBtnText}>{s('onboard_start')}</Text>
              </>
            ) : (
              <>
                <Text style={styles.nextBtnText}>{s('onboard_next')}</Text>
                <Ionicons name="arrow-forward" size={20} color="#FFF" />
              </>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  bgImage: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  bgOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(5, 8, 20, 0.65)' },
  safeArea: { flex: 1 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  skipBtn: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: RADIUS.full },
  skipText: { fontSize: 14, color: COLORS.white, ...FONTS.medium },

  slideArea: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: SPACING.xl, paddingBottom: SPACING.xxl, gap: SPACING.md },
  slideTitle: { fontSize: 36, color: COLORS.textMain, ...FONTS.bold, lineHeight: 44, textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 },
  slideDesc: { fontSize: 16, color: 'rgba(255,255,255,0.85)', ...FONTS.regular, lineHeight: 24 },
  pillsRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  pill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: RADIUS.full, borderWidth: 1 },
  pillText: { fontSize: 12, ...FONTS.semibold },

  bottom: { paddingHorizontal: SPACING.xl, paddingBottom: SPACING.lg, gap: SPACING.lg },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: SPACING.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
  nextBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, paddingVertical: 16, borderRadius: RADIUS.full },
  nextBtnText: { fontSize: 17, color: '#FFF', ...FONTS.bold },
});
