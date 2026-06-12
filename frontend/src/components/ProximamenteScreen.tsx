import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { useTr } from '../i18n/autoTr';

interface Props {
  title: string;
  icon?: keyof typeof Ionicons.glyphMap;
  description?: string;
}

export default function ProximamenteScreen({
  title,
  icon = 'construct',
  description,
}: Props) {
  const router = useRouter();
  const tr = useTr();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={36} color={COLORS.primary} />
        </View>
        <Text style={styles.title}>{tr('Próximamente')}</Text>
        <Text style={styles.subtitle}>
          {description || tr('Estamos construyendo esto para ti.')}
        </Text>
        <TouchableOpacity
          style={styles.btn}
          onPress={() => router.replace('/(tabs)')}
          activeOpacity={0.85}
        >
          <Ionicons name="home" size={16} color={COLORS.black} />
          <Text style={styles.btnText}>{tr('Volver al inicio')}</Text>
        </TouchableOpacity>
      </View>
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
    paddingVertical: SPACING.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  headerTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.xxl,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.primary + '12',
    borderWidth: 1,
    borderColor: COLORS.primary + '30',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.lg,
  },
  title: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold, marginBottom: SPACING.sm },
  subtitle: {
    fontSize: 14,
    color: COLORS.textMuted,
    ...FONTS.regular,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: SPACING.xl,
    maxWidth: 280,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 14,
    borderRadius: RADIUS.full,
  },
  btnText: { fontSize: 14, color: COLORS.black, ...FONTS.bold },
});
