import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { COLORS, SPACING, RADIUS, FONTS } from '@/src/constants/theme';
import { submitReview } from '@/src/services/reviewsStore';
import { useLang } from '@/src/context/LanguageContext';

// ─── Types ────────────────────────────────────────────────────────────────────

type SubcategoryKey = 'experience' | 'service' | 'location' | 'value';

type SubcategoryConfig = {
  key: SubcategoryKey;
  labelKey: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const SUBCATEGORIES: SubcategoryConfig[] = [
  { key: 'experience', labelKey: 'review_ambience',  icon: 'sparkles-outline'    },
  { key: 'service',    labelKey: 'review_service',   icon: 'people-outline'      },
  { key: 'location',   labelKey: 'review_location',  icon: 'location-outline'    },
  { key: 'value',      labelKey: 'review_value',     icon: 'pricetag-outline'    },
];

// ─── Star Picker ──────────────────────────────────────────────────────────────

function StarPicker({
  rating,
  size,
  onChange,
}: {
  rating: number;
  size: number;
  onChange: (v: number) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: size > 28 ? 8 : 4 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <TouchableOpacity key={n} onPress={() => onChange(n)} activeOpacity={0.7}>
          <Ionicons
            name={n <= rating ? 'star' : 'star-outline'}
            size={size}
            color={n <= rating ? COLORS.primary : 'rgba(255,255,255,0.2)'}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function NewReviewScreen() {
  const { s } = useLang();
  const router = useRouter();
  const { partner_id, partner_name } = useLocalSearchParams<{
    partner_id: string;
    partner_name?: string;
  }>();

  const [overallRating, setOverallRating] = useState(0);
  const [subcategoryRatings, setSubcategoryRatings] = useState<Record<SubcategoryKey, number>>({
    experience: 0,
    service: 0,
    location: 0,
    value: 0,
  });
  const [reviewText, setReviewText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const setSubRating = (key: SubcategoryKey, val: number) => {
    setSubcategoryRatings((prev) => ({ ...prev, [key]: val }));
  };

  const canSubmit = overallRating > 0 && reviewText.trim().length >= 10 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    if (!partner_id) {
      Alert.alert('Error', 'No se encontró el partner.');
      return;
    }

    setSubmitting(true);
    try {
      await submitReview({
        partner_id,
        rating: overallRating,
        subcategories: subcategoryRatings,
        text: reviewText.trim(),
      });
      Alert.alert('¡Gracias!', 'Tu reseña fue enviada.');
      router.back();
    } catch (e) {
      console.error('[NewReviewScreen]', e);
      Alert.alert(
        'Error',
        'No se pudo enviar la reseña. Inténtalo de nuevo.\nCould not submit review. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="close" size={22} color={COLORS.textMain} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>{s('review_write')}</Text>
            {partner_name ? (
              <Text style={styles.headerSub} numberOfLines={1}>{partner_name}</Text>
            ) : null}
          </View>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Overall rating ── */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{s('review_overall')}</Text>
            <View style={styles.overallRow}>
              <StarPicker rating={overallRating} size={36} onChange={setOverallRating} />
              {overallRating > 0 && (
                <Text style={styles.ratingHint}>
                  {['', 'Muy malo', 'Malo', 'Regular', 'Bueno', 'Excelente'][overallRating]}
                </Text>
              )}
            </View>
          </View>

          {/* ── Subcategories ── */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Categorías</Text>
            <View style={styles.card}>
              {SUBCATEGORIES.map((sub, idx) => (
                <React.Fragment key={sub.key}>
                  <View style={styles.subRow}>
                    <View style={styles.subLabel}>
                      <Ionicons name={sub.icon} size={16} color={COLORS.textMuted} />
                      <Text style={styles.subLabelText}>{s(sub.labelKey)}</Text>
                    </View>
                    <StarPicker
                      rating={subcategoryRatings[sub.key]}
                      size={20}
                      onChange={(v) => setSubRating(sub.key, v)}
                    />
                  </View>
                  {idx < SUBCATEGORIES.length - 1 && <View style={styles.sep} />}
                </React.Fragment>
              ))}
            </View>
          </View>

          {/* ── Review text ── */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Tu reseña</Text>
            <TextInput
              style={[styles.textInput, reviewText.length > 0 && styles.textInputActive]}
              placeholder="Comparte tu experiencia en detalle... (mínimo 10 caracteres)"
              placeholderTextColor={COLORS.textMuted}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
              value={reviewText}
              onChangeText={setReviewText}
              maxLength={1000}
            />
            <Text style={styles.charCount}>{reviewText.length} / 1000</Text>
          </View>

          {/* ── Submit ── */}
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <>
                <Ionicons name="send" size={16} color={canSubmit ? COLORS.white : COLORS.textMuted} />
                <Text style={[styles.submitText, !canSubmit && styles.submitTextDisabled]}>
                  {s('review_submit')}
                </Text>
              </>
            )}
          </TouchableOpacity>

          {!canSubmit && overallRating === 0 && (
            <Text style={styles.validationHint}>Selecciona una calificación general para continuar</Text>
          )}

          <View style={{ height: SPACING.xxl }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center', paddingHorizontal: SPACING.sm },
  headerTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold },
  headerSub: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2 },

  scroll: { padding: SPACING.lg },

  section: { marginBottom: SPACING.lg },
  sectionLabel: {
    fontSize: 13,
    color: COLORS.textMuted,
    ...FONTS.semibold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: SPACING.md,
  },

  // Overall
  overallRow: { gap: SPACING.md, alignItems: 'flex-start' },
  ratingHint: { fontSize: 15, color: COLORS.primary, ...FONTS.semibold },

  // Subcategories
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  subLabel: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, flex: 1 },
  subLabelText: { fontSize: 14, color: COLORS.textMain, ...FONTS.medium },
  sep: { height: 1, backgroundColor: COLORS.border, marginHorizontal: SPACING.md },

  // Text input
  textInput: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    color: COLORS.textMain,
    fontSize: 14,
    ...FONTS.regular,
    minHeight: 120,
    lineHeight: 22,
  },
  textInputActive: { borderColor: `${COLORS.primary}60` },
  charCount: {
    fontSize: 11,
    color: COLORS.textMuted,
    ...FONTS.regular,
    textAlign: 'right',
    marginTop: SPACING.xs,
  },

  // Submit
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.full,
    paddingVertical: SPACING.md + 2,
    marginBottom: SPACING.sm,
  },
  submitBtnDisabled: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  submitText: { fontSize: 15, color: COLORS.white, ...FONTS.bold },
  submitTextDisabled: { color: COLORS.textMuted },

  validationHint: {
    textAlign: 'center',
    fontSize: 12,
    color: COLORS.textMuted,
    ...FONTS.regular,
  },
});
