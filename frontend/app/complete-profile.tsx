import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { api } from '../src/constants/api';

const COUNTRIES = [
  { flag: '🇨🇴', name: 'Colombia' }, { flag: '🇺🇸', name: 'USA' },
  { flag: '🇲🇽', name: 'México' }, { flag: '🇦🇷', name: 'Argentina' },
  { flag: '🇪🇸', name: 'España' }, { flag: '🇧🇷', name: 'Brasil' },
  { flag: '🇨🇱', name: 'Chile' }, { flag: '🇵🇪', name: 'Perú' },
  { flag: '🇫🇷', name: 'Francia' }, { flag: '🇩🇪', name: 'Alemania' },
  { flag: '🇬🇧', name: 'UK' }, { flag: '🇮🇹', name: 'Italia' },
  { flag: '🇨🇦', name: 'Canada' }, { flag: '🇵🇹', name: 'Portugal' },
  { flag: '🇪🇨', name: 'Ecuador' }, { flag: '🏳️', name: 'Otro' },
];

const AGE_GROUPS = ['18-24', '25-34', '35-44', '45-54', '55+'];

const INTERESTS = ['Electro', 'Reggaeton', 'Jazz', 'Salsa', 'Techno', 'House', 'Cumbia', 'Latin Pop', 'Rock', 'Chill'];

export default function CompleteProfileScreen() {
  const router = useRouter();
  const [nationality, setNationality] = useState('');
  const [ageGroup, setAgeGroup] = useState('');
  const [instagram, setInstagram] = useState('');
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const toggleInterest = (i: string) => {
    setSelectedInterests(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]);
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      await api.put('/profile', {
        nationality,
        age_group: ageGroup,
        instagram: instagram.replace('@', ''),
        interests: selectedInterests,
      });
    } catch (e) { console.error(e); }
    await AsyncStorage.setItem('@profile_completed', 'true');
    setSaving(false);
    router.replace('/(tabs)');
  };

  const skip = async () => {
    await AsyncStorage.setItem('@profile_completed', 'true');
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Cuéntanos de ti</Text>
          <Text style={styles.subtitle}>Esto nos ayuda a personalizar tu experiencia</Text>
        </View>

        {/* Country */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>¿De dónde eres?</Text>
          <View style={styles.grid}>
            {COUNTRIES.map(c => (
              <TouchableOpacity
                key={c.name}
                style={[styles.chip, nationality === c.name && styles.chipActive]}
                onPress={() => setNationality(c.name)}
              >
                <Text style={styles.chipFlag}>{c.flag}</Text>
                <Text style={[styles.chipText, nationality === c.name && styles.chipTextActive]}>{c.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Age */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Rango de edad</Text>
          <View style={styles.ageRow}>
            {AGE_GROUPS.map(a => (
              <TouchableOpacity
                key={a}
                style={[styles.ageChip, ageGroup === a && styles.ageChipActive]}
                onPress={() => setAgeGroup(a)}
              >
                <Text style={[styles.ageText, ageGroup === a && styles.ageTextActive]}>{a}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Instagram */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Instagram (opcional)</Text>
          <View style={styles.inputRow}>
            <Ionicons name="logo-instagram" size={20} color={COLORS.primary} />
            <TextInput
              style={styles.input}
              placeholder="@tu_usuario"
              placeholderTextColor={COLORS.textMuted}
              value={instagram}
              onChangeText={setInstagram}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </View>

        {/* Interests */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>¿Qué tipo de música te gusta?</Text>
          <View style={styles.grid}>
            {INTERESTS.map(i => (
              <TouchableOpacity
                key={i}
                style={[styles.interestChip, selectedInterests.includes(i) && styles.interestChipActive]}
                onPress={() => toggleInterest(i)}
              >
                <Text style={[styles.interestText, selectedInterests.includes(i) && styles.interestTextActive]}>{i}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* Bottom Actions */}
      <View style={styles.bottom}>
        <TouchableOpacity style={styles.saveBtn} onPress={saveProfile} disabled={saving}>
          <Text style={styles.saveBtnText}>{saving ? 'Guardando...' : 'Continuar'}</Text>
          <Ionicons name="arrow-forward" size={20} color="#FFF" />
        </TouchableOpacity>
        <TouchableOpacity onPress={skip}>
          <Text style={styles.skipText}>Saltar por ahora</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.md },
  title: { fontSize: 28, color: COLORS.textMain, ...FONTS.bold },
  subtitle: { fontSize: 14, color: COLORS.textMuted, ...FONTS.regular, marginTop: 4 },

  section: { paddingHorizontal: SPACING.lg, marginBottom: SPACING.lg },
  sectionTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold, marginBottom: SPACING.sm },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  chipActive: { borderColor: COLORS.primary, backgroundColor: `${COLORS.primary}15` },
  chipFlag: { fontSize: 16 },
  chipText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium },
  chipTextActive: { color: COLORS.primary, ...FONTS.bold },

  ageRow: { flexDirection: 'row', gap: SPACING.sm },
  ageChip: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  ageChipActive: { borderColor: COLORS.primary, backgroundColor: `${COLORS.primary}15` },
  ageText: { fontSize: 14, color: COLORS.textMuted, ...FONTS.semibold },
  ageTextActive: { color: COLORS.primary },

  inputRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: SPACING.md, paddingVertical: 4 },
  input: { flex: 1, fontSize: 15, color: COLORS.textMain, ...FONTS.regular, paddingVertical: 12 },

  interestChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  interestChipActive: { borderColor: '#EC4899', backgroundColor: 'rgba(236,72,153,0.12)' },
  interestText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.medium },
  interestTextActive: { color: '#EC4899', ...FONTS.bold },

  bottom: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, gap: SPACING.sm, alignItems: 'center' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 16, width: '100%' },
  saveBtnText: { fontSize: 17, color: '#FFF', ...FONTS.bold },
  skipText: { fontSize: 14, color: COLORS.textMuted, ...FONTS.medium },
});
