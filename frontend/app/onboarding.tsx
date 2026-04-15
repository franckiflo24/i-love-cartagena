import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';

const { width } = Dimensions.get('window');

const SLIDES = [
  {
    emoji: '🎵',
    title: 'Toda la música\nen un solo lugar',
    description: 'Descubre conciertos, DJs, jazz, salsa y más. Filtra por fecha, género y guarda tus favoritos.',
    color: '#D97706',
    pills: ['Conciertos', 'Filtros', 'Favoritos'],
  },
  {
    emoji: '📍',
    title: 'Explora\nCartagena',
    description: 'Mapa interactivo con todos los venues, partners y puntos de interés. Encuentra qué hay cerca de ti.',
    color: '#3B82F6',
    pills: ['Venues', 'Partners', 'Navegación'],
  },
  {
    emoji: '🎫',
    title: 'City Pass\nexclusivo',
    description: 'Descuentos en restaurantes, clubs y hoteles. Tu QR code personal para disfrutar Cartagena sin límites.',
    color: '#22C55E',
    pills: ['QR Code', 'Descuentos', 'Premium'],
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const [index, setIndex] = useState(0);

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
    router.replace('/login');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Skip */}
      <View style={styles.topBar}>
        <View />
        {!isLast && (
          <TouchableOpacity onPress={completeOnboarding} style={styles.skipBtn}>
            <Text style={styles.skipText}>Saltar</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Slide Content */}
      <View style={styles.slideArea}>
        <View style={[styles.emojiCircle, { backgroundColor: `${slide.color}12`, borderColor: `${slide.color}30` }]}>
          <Text style={styles.emoji}>{slide.emoji}</Text>
        </View>

        <Text style={styles.slideTitle}>{slide.title}</Text>
        <Text style={styles.slideDesc}>{slide.description}</Text>

        <View style={styles.pillsRow}>
          {slide.pills.map(t => (
            <View key={t} style={[styles.pill, { borderColor: `${slide.color}40` }]}>
              <Text style={[styles.pillText, { color: slide.color }]}>{t}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Bottom */}
      <View style={styles.bottom}>
        {/* Dots */}
        <View style={styles.dots}>
          {SLIDES.map((s, i) => (
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
              <Text style={styles.nextBtnText}>Empezar</Text>
            </>
          ) : (
            <>
              <Text style={styles.nextBtnText}>Siguiente</Text>
              <Ionicons name="arrow-forward" size={20} color="#FFF" />
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  skipBtn: { paddingHorizontal: 16, paddingVertical: 8 },
  skipText: { fontSize: 14, color: COLORS.textMuted, ...FONTS.medium },

  slideArea: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: SPACING.xl, gap: SPACING.md },
  emojiCircle: { width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  emoji: { fontSize: 48 },
  slideTitle: { fontSize: 32, color: COLORS.textMain, ...FONTS.bold, textAlign: 'center', lineHeight: 40 },
  slideDesc: { fontSize: 15, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', lineHeight: 24, paddingHorizontal: SPACING.md },
  pillsRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  pill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: RADIUS.full, borderWidth: 1 },
  pillText: { fontSize: 12, ...FONTS.semibold },

  bottom: { paddingHorizontal: SPACING.xl, paddingBottom: SPACING.lg, gap: SPACING.lg },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: SPACING.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.border },
  nextBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, paddingVertical: 16, borderRadius: RADIUS.full },
  nextBtnText: { fontSize: 17, color: '#FFF', ...FONTS.bold },
});
