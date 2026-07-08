/**
 * Amo Together — Badge components.
 *
 * <UserBadge type="local" city="Cartagena" subtitle="desde 5 años" />
 * <UserBadge type="tourist" city="Cartagena" subtitle="15-22 Aug" />
 * <VibeChip label="foodie" />
 * <VerifiedBadge />
 */
import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const COLORS = {
  local: '#F59E0B',       // amber
  localBg: 'rgba(245,158,11,0.14)',
  tourist: '#3B82F6',     // blue
  touristBg: 'rgba(59,130,246,0.14)',
  verified: '#10B981',    // emerald
  ambassador: '#EAB308',  // gold
  pro: '#8B5CF6',         // violet
};

const VIBE_META: Record<string, { emoji: string; label: string; color: string }> = {
  foodie:        { emoji: '🍽️', label: 'Foodie',     color: '#EF4444' },
  salsa:         { emoji: '🎵', label: 'Salsa',      color: '#F97316' },
  beach:         { emoji: '🌊', label: 'Beach',      color: '#06B6D4' },
  nightlife:     { emoji: '🍸', label: 'Nightlife',  color: '#A855F7' },
  culture:       { emoji: '🎭', label: 'Cultura',    color: '#EC4899' },
  wellness:      { emoji: '🧘', label: 'Wellness',   color: '#10B981' },
  photo:         { emoji: '📸', label: 'Foto',       color: '#F59E0B' },
  adventure:     { emoji: '🧗', label: 'Aventura',   color: '#84CC16' },
  art:           { emoji: '🎨', label: 'Arte',       color: '#D946EF' },
  coffee:        { emoji: '☕', label: 'Café',       color: '#92400E' },
  family:        { emoji: '👨‍👩‍👧', label: 'Familia', color: '#F97316' },
  romance:       { emoji: '💫', label: 'Romance',    color: '#EC4899' },
  business:      { emoji: '💼', label: 'Business',   color: '#6B7280' },
  solo_traveler: { emoji: '🌍', label: 'Solo',       color: '#0EA5E9' },
  electro:       { emoji: '🎧', label: 'Electro',    color: '#8B5CF6' },
  techno:        { emoji: '🔊', label: 'Techno',     color: '#6366F1' },
};

export type UserBadgeType = 'local' | 'tourist';

interface UserBadgeProps {
  type: UserBadgeType;
  city?: string;
  subtitle?: string;
  size?: 'sm' | 'md' | 'lg';
  style?: ViewStyle;
}

/** Primary badge: LOCAL 🏛️ or TOURIST ✈️ · shown prominently on profile. */
export const UserBadge: React.FC<UserBadgeProps> = ({
  type, city, subtitle, size = 'md', style,
}) => {
  const isLocal = type === 'local';
  const color = isLocal ? COLORS.local : COLORS.tourist;
  const bg = isLocal ? COLORS.localBg : COLORS.touristBg;
  const icon = isLocal ? '🏛️' : '✈️';
  const title = isLocal ? 'Local' : 'Voyageur';
  const cityLine = city ? `· ${city}` : '';

  const sizes = {
    sm: { padV: 4, padH: 8, iconSize: 12, titleSize: 11, subSize: 10 },
    md: { padV: 6, padH: 12, iconSize: 16, titleSize: 13, subSize: 11 },
    lg: { padV: 10, padH: 16, iconSize: 20, titleSize: 15, subSize: 12 },
  }[size];

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: bg, borderColor: color, paddingVertical: sizes.padV, paddingHorizontal: sizes.padH },
        style,
      ]}
      testID={`user-badge-${type}`}
    >
      <Text style={{ fontSize: sizes.iconSize + 2 }}>{icon}</Text>
      <View>
        <Text style={[styles.badgeTitle, { color, fontSize: sizes.titleSize }]}>
          {title} {cityLine}
        </Text>
        {subtitle ? (
          <Text style={[styles.badgeSub, { fontSize: sizes.subSize }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
};

/** Small vibe chip (foodie / salsa / beach …) — max 5 per profile. */
export const VibeChip: React.FC<{ label: string; size?: 'sm' | 'md' }> = ({ label, size = 'md' }) => {
  const meta = VIBE_META[label] || { emoji: '✨', label: label, color: '#94A3B8' };
  return (
    <View style={[styles.vibe, size === 'sm' && { paddingVertical: 3, paddingHorizontal: 8 }]}>
      <Text style={{ fontSize: size === 'sm' ? 11 : 13 }}>{meta.emoji}</Text>
      <Text style={[styles.vibeLabel, size === 'sm' && { fontSize: 10 }, { color: meta.color }]}>
        {meta.label}
      </Text>
    </View>
  );
};

/** ✅ Verified badge — user has verified identity. */
export const VerifiedBadge: React.FC<{ label?: string }> = ({ label = 'Vérifié' }) => (
  <View style={[styles.smallBadge, { backgroundColor: 'rgba(16,185,129,0.14)', borderColor: COLORS.verified }]}>
    <Ionicons name="checkmark-circle" size={12} color={COLORS.verified} />
    <Text style={[styles.smallBadgeLabel, { color: COLORS.verified }]}>{label}</Text>
  </View>
);

/** 🌟 Ambassador — paid local ambassador. */
export const AmbassadorBadge: React.FC = () => (
  <View style={[styles.smallBadge, { backgroundColor: 'rgba(234,179,8,0.14)', borderColor: COLORS.ambassador }]}>
    <Text style={{ fontSize: 11 }}>🌟</Text>
    <Text style={[styles.smallBadgeLabel, { color: COLORS.ambassador }]}>Ambassador</Text>
  </View>
);

/** ⚡ Traveler PRO — 5+ trips through Amo. */
export const TravelerProBadge: React.FC = () => (
  <View style={[styles.smallBadge, { backgroundColor: 'rgba(139,92,246,0.14)', borderColor: COLORS.pro }]}>
    <Text style={{ fontSize: 11 }}>⚡</Text>
    <Text style={[styles.smallBadgeLabel, { color: COLORS.pro }]}>Traveler PRO</Text>
  </View>
);

// -------- styles --------
const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    alignSelf: 'flex-start',
  },
  badgeTitle: { fontWeight: '700', letterSpacing: 0.2 },
  badgeSub: { color: 'rgba(255,255,255,0.75)', marginTop: 1 },

  vibe: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  vibeLabel: { fontSize: 12, fontWeight: '600' },

  smallBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  smallBadgeLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.3 },
});

export default UserBadge;
