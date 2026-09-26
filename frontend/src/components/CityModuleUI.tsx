// City hub ("Moverse") — shared visual atoms for /ciudad and /ciudad/[id]:
// the honesty badge (info | proximamente | en_vivo) and the gradient icon-art
// block used when a module ships without a licensed photo.
import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { FONTS } from '../constants/theme';
import { STATUS_META, gradientFor, CityStatus } from '../lib/cityModules';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

type BadgeProps = {
  status: CityStatus;
  tr: (es: string) => string;
  style?: StyleProp<ViewStyle>;
  size?: 'sm' | 'md';
};

export function CityStatusBadge({ status, tr, style, size = 'sm' }: BadgeProps) {
  const meta = STATUS_META[status] || STATUS_META.info;
  const md = size === 'md';
  return (
    <View
      style={[badge.pill, { borderColor: meta.color, backgroundColor: meta.bg }, md && badge.pillMd, style]}
      accessibilityRole="text"
      accessibilityLabel={tr(meta.label)}
    >
      <Ionicons name={meta.icon as IconName} size={md ? 14 : 12} color={meta.color} />
      <Text style={[badge.text, { color: meta.color }, md && badge.textMd]}>{tr(meta.label)}</Text>
    </View>
  );
}

const badge = StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4,
  },
  pillMd: { paddingHorizontal: 11, paddingVertical: 5, gap: 5 },
  text: { fontSize: 10.5, ...FONTS.bold, letterSpacing: 0.6, textTransform: 'uppercase' },
  textMd: { fontSize: 11.5 },
});

type ArtProps = {
  id: string;
  icon: string;
  style?: StyleProp<ViewStyle>;
  iconSize?: number;
};

// Gradient block with the module's Ionicon — a large ghost glyph in the corner
// gives depth so it reads as art, not as a missing image.
export function CityIconArt({ id, icon, style, iconSize = 48 }: ArtProps) {
  const colors = gradientFor(id);
  const name = (icon || 'ellipse') as IconName;
  return (
    <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[art.box, style]}>
      <View style={art.ghost} pointerEvents="none">
        <Ionicons name={name} size={iconSize * 3.2} color="rgba(255,255,255,0.10)" />
      </View>
      <View style={art.disc}>
        <Ionicons name={name} size={iconSize} color="#FFFFFF" />
      </View>
    </LinearGradient>
  );
}

const art = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  ghost: { position: 'absolute', right: -24, bottom: -36 },
  disc: {
    width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(8,12,22,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)',
  },
});
