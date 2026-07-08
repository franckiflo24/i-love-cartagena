/**
 * Mockup screen to preview the Amo Together badges + profile design.
 * Access it at /social/preview
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { UserBadge, VibeChip, VerifiedBadge, AmbassadorBadge, TravelerProBadge } from '../../src/components/UserBadge';

export default function SocialPreview() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 32 }}>

        <View style={styles.header}>
          <Text style={styles.title}>Amo Together</Text>
          <Text style={styles.subtitle}>Preview du système de badges</Text>
        </View>

        {/* === PROFIL VOYAGEUR (Tourist) === */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Profil voyageur (Tourist)</Text>
          <View style={styles.profileHeader}>
            <View style={styles.avatar}>
              <Text style={styles.avatarInitial}>J</Text>
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={styles.name}>Juliette S. <Text style={styles.flag}>🇫🇷</Text></Text>
              <UserBadge type="tourist" city="Cartagena" subtitle="15-22 août 2026" />
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                <VerifiedBadge />
                <TravelerProBadge />
              </View>
            </View>
          </View>
          <Text style={styles.bio}>
            "Solo trip in Colombia — passionate about salsa, ceviche and sunsets."
          </Text>
          <Text style={styles.langs}>ES · FR · EN · PT</Text>
          <View style={styles.vibesRow}>
            <VibeChip label="salsa" />
            <VibeChip label="foodie" />
            <VibeChip label="beach" />
            <VibeChip label="photo" />
          </View>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
            <View style={styles.stat}>
              <Text style={styles.statVal}>3</Text>
              <Text style={styles.statLbl}>événements</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statVal}>7</Text>
              <Text style={styles.statLbl}>jours ici</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statVal}>@juliette.fr</Text>
              <Text style={styles.statLbl}>Instagram</Text>
            </View>
          </View>
        </View>

        {/* === PROFIL LOCAL === */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Profil Local (Cartagenero)</Text>
          <View style={styles.profileHeader}>
            <View style={[styles.avatar, { backgroundColor: 'rgba(245,158,11,0.15)' }]}>
              <Text style={styles.avatarInitial}>M</Text>
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={styles.name}>María C. <Text style={styles.flag}>🇨🇴</Text></Text>
              <UserBadge type="local" city="Cartagena" subtitle="desde 8 años" />
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                <VerifiedBadge />
                <AmbassadorBadge />
              </View>
            </View>
          </View>
          <Text style={styles.bio}>
            "Guía cultural, apasionada por la salsa y la cocina caribeña. Comparto los mejores planes de mi ciudad."
          </Text>
          <Text style={styles.langs}>ES · EN</Text>
          <View style={styles.vibesRow}>
            <VibeChip label="salsa" />
            <VibeChip label="foodie" />
            <VibeChip label="culture" />
            <VibeChip label="art" />
          </View>
        </View>

        {/* === MOSAÏQUE D'ÉVÉNEMENT === */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Mosaïque d'un événement</Text>
          <View style={{ marginTop: 4 }}>
            <Text style={styles.eventTitle}>🎵 Sunset au Café del Mar · 18h30</Text>
            <Text style={styles.eventSub}>12 personnes vont y aller ✨</Text>
            <View style={styles.mosaic}>
              {[
                { name: 'Juliette', flag: '🇫🇷', type: 'tourist' },
                { name: 'Marco',    flag: '🇮🇹', type: 'tourist' },
                { name: 'Sarah',    flag: '🇺🇸', type: 'tourist' },
                { name: 'María',    flag: '🏛️',  type: 'local' },
                { name: 'Carlos',   flag: '🏛️',  type: 'local' },
                { name: 'Léa',      flag: '🇫🇷', type: 'tourist' },
              ].map((u, i) => (
                <View key={i} style={styles.mosaicAvatar}>
                  <Text style={styles.mosaicInit}>{u.name[0]}</Text>
                  <View style={styles.mosaicBadge}>
                    <Text style={{ fontSize: 10 }}>{u.flag}</Text>
                  </View>
                </View>
              ))}
              <View style={[styles.mosaicAvatar, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
                <Text style={styles.mosaicPlus}>+6</Text>
              </View>
            </View>
          </View>
        </View>

        {/* === Compact badges (all sizes) === */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Tailles disponibles</Text>
          <View style={{ gap: 10 }}>
            <UserBadge type="tourist" city="Cartagena" subtitle="15-22 août" size="sm" />
            <UserBadge type="tourist" city="Medellín" subtitle="En viaje" size="md" />
            <UserBadge type="local" city="Bogotá" subtitle="desde 12 años" size="lg" />
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: { alignItems: 'center', marginTop: 8 },
  title: { fontSize: 28, fontWeight: '800', color: '#FBBF24', letterSpacing: 0.5 },
  subtitle: { fontSize: 13, color: '#94A3B8', marginTop: 4 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    gap: 12,
  },
  sectionLabel: {
    fontSize: 11, color: '#94A3B8',
    fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase',
  },
  profileHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  avatar: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(59,130,246,0.15)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.15)',
  },
  avatarInitial: { fontSize: 26, fontWeight: '800', color: 'white' },
  name: { fontSize: 20, fontWeight: '700', color: 'white' },
  flag: { fontSize: 18 },
  bio: { fontSize: 14, color: '#CBD5E1', lineHeight: 20, fontStyle: 'italic' },
  langs: { fontSize: 12, color: '#94A3B8', fontWeight: '600' },
  vibesRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  stat: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10, padding: 10, alignItems: 'center',
  },
  statVal: { fontSize: 14, fontWeight: '700', color: 'white' },
  statLbl: { fontSize: 10, color: '#94A3B8', marginTop: 2 },

  eventTitle: { fontSize: 16, fontWeight: '700', color: 'white' },
  eventSub: { fontSize: 12, color: '#FBBF24', marginTop: 4, fontWeight: '600' },
  mosaic: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  mosaicAvatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(59,130,246,0.15)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.15)',
    position: 'relative',
  },
  mosaicInit: { fontSize: 20, fontWeight: '700', color: 'white' },
  mosaicBadge: {
    position: 'absolute', bottom: -2, right: -2,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#0A0A0A',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  mosaicPlus: { fontSize: 14, fontWeight: '700', color: '#94A3B8' },
});
