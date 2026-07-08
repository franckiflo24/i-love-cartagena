/**
 * Amo Together — Public profile of another user.
 * Route: /social/user/[uid]?event_id=xxx
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Linking, Alert, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../../src/constants/api';
import { UserBadge, VibeChip } from '../../../src/components/UserBadge';

type PublicProfile = {
  user_id: string;
  display_name: string;
  photo_url?: string;
  badge?: { type: string; icon: string; color: string; title: string; subtitle: string };
  vibes?: string[];
  bio?: string;
  languages?: string[];
  instagram?: string;
  match?: {
    common_vibes: string[];
    common_languages: string[];
    score: number;
  };
};

const LANG_CODES: Record<string, string> = { es: 'ES', en: 'EN', fr: 'FR', pt: 'PT' };
const langLabel = (l: string) => LANG_CODES[l] || l.toUpperCase();

export default function SocialUserProfile() {
  const { uid, event_id } = useLocalSearchParams<{ uid: string; event_id?: string }>();
  const router = useRouter();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [eventTitle, setEventTitle] = useState<string>('');

  useEffect(() => {
    (async () => {
      try {
        const [p, ev] = await Promise.all([
          api.get(`/users/social/${uid}`),
          event_id ? api.get(`/partner-events/${event_id}`).catch(() => null) : Promise.resolve(null),
        ]);
        setProfile(p);
        if (ev) setEventTitle(ev.title || '');
      } catch (e: any) {
        Alert.alert('Profil indisponible', e?.message || 'Ce profil n\'est plus visible.');
        router.back();
      }
      setLoading(false);
    })();
  }, [uid]);

  const openIG = async () => {
    if (!profile?.instagram) return;
    const igApp = `instagram://user?username=${profile.instagram}`;
    const igWeb = `https://www.instagram.com/${profile.instagram}/`;
    try {
      const ok = await Linking.canOpenURL(igApp);
      Linking.openURL(ok ? igApp : igWeb);
    } catch {
      Linking.openURL(igWeb);
    }
  };

  const report = () => {
    Alert.alert(
      'Signaler ce profil',
      'Choisis une raison',
      [
        { text: 'Spam',           onPress: () => sendReport('spam') },
        { text: 'Harcèlement',    onPress: () => sendReport('harassment') },
        { text: 'Faux profil',    onPress: () => sendReport('fake') },
        { text: 'Contenu inapproprié', onPress: () => sendReport('inappropriate') },
        { text: 'Annuler', style: 'cancel' },
      ],
    );
  };

  const sendReport = async (reason: string) => {
    try {
      await api.post('/users/social/report', { target_user_id: uid, reason });
      Alert.alert('Merci', 'Notre équipe va examiner ce signalement.');
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Impossible de signaler');
    }
  };

  const block = () => {
    Alert.alert(
      'Bloquer cet utilisateur ?',
      'Vous ne vous verrez plus mutuellement dans Amo Together.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Bloquer', style: 'destructive', onPress: async () => {
          try {
            await api.post('/users/social/block', { target_user_id: uid });
            Alert.alert('Bloqué', '');
            router.back();
          } catch (e: any) {
            Alert.alert('Erreur', e?.message || 'Échec du blocage');
          }
        }},
      ],
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator style={{ flex: 1 }} size="large" color="#FBBF24" />
      </SafeAreaView>
    );
  }
  if (!profile) return null;

  const icebreaker = eventTitle
    ? `Hola ${profile.display_name.split(' ')[0]}! Vu qu'on va tou(te)s les deux à "${eventTitle}" (via Amo Cartagena)`
    : `Hola ${profile.display_name.split(' ')[0]}! (via Amo Cartagena)`;

  const initial = (profile.display_name?.[0] || '?').toUpperCase();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 16 }}>

        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color="white" />
          </TouchableOpacity>
        </View>

        {/* Big avatar */}
        <View style={{ alignItems: 'center', gap: 12 }}>
          {profile.photo_url ? (
            <Image source={{ uri: profile.photo_url }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarInitial}>{initial}</Text>
            </View>
          )}
          <Text style={styles.name}>{profile.display_name}</Text>
          {profile.badge && (
            <UserBadge
              type={profile.badge.type as any}
              city={profile.badge.title.replace(/^(Local|Voyageur) · /, '')}
              subtitle={profile.badge.subtitle}
              size="md"
            />
          )}
        </View>

        {/* Vibes */}
        {(profile.vibes || []).length > 0 && (
          <View style={styles.vibesRow}>
            {(profile.vibes || []).map(v => <VibeChip key={v} label={v} />)}
          </View>
        )}

        {/* Bio */}
        {profile.bio ? (
          <View style={styles.card}>
            <Text style={styles.bio}>&ldquo;{profile.bio}&rdquo;</Text>
          </View>
        ) : null}

        {/* Languages */}
        {(profile.languages || []).length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>LANGUES PARLÉES</Text>
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {(profile.languages || []).map(l => (
                <View key={l} style={styles.langChip}>
                  <Text style={styles.langChipTxt}>{langLabel(l)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Match */}
        {profile.match && (profile.match.common_vibes.length + profile.match.common_languages.length > 0) && (
          <View style={[styles.card, { borderColor: 'rgba(251,191,36,0.4)', backgroundColor: 'rgba(251,191,36,0.06)' }]}>
            <Text style={[styles.cardLabel, { color: '#FBBF24' }]}>🎯 VOUS PARTAGEZ</Text>
            <View style={{ gap: 6, marginTop: 8 }}>
              <Text style={styles.matchLine}>
                • <Text style={styles.matchStrong}>{profile.match.common_vibes.length}</Text> vibes en commun
                {profile.match.common_vibes.length ? ` (${profile.match.common_vibes.join(', ')})` : ''}
              </Text>
              <Text style={styles.matchLine}>
                • <Text style={styles.matchStrong}>{profile.match.common_languages.length}</Text> langues
                {profile.match.common_languages.length ? ` (${profile.match.common_languages.map(langLabel).join(', ')})` : ''}
              </Text>
              {eventTitle ? (
                <Text style={styles.matchLine}>
                  • Même événement : <Text style={{ color: 'white', fontWeight: '700' }}>{eventTitle}</Text>
                </Text>
              ) : null}
            </View>
          </View>
        )}

        {/* Icebreaker preview */}
        {profile.instagram ? (
          <View style={styles.icebreaker}>
            <Text style={styles.icebreakerLabel}>💬 MESSAGE PRÉ-REMPLI SUR INSTAGRAM</Text>
            <Text style={styles.icebreakerTxt}>&ldquo;{icebreaker}&rdquo;</Text>
          </View>
        ) : null}

        {/* CTA */}
        {profile.instagram ? (
          <TouchableOpacity style={styles.ctaMain} activeOpacity={0.85} onPress={openIG} testID="cta-instagram">
            <Ionicons name="logo-instagram" size={22} color="white" />
            <Text style={styles.ctaMainTxt}>Dire hi sur Instagram</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.noIgBox}>
            <Ionicons name="information-circle-outline" size={18} color="#94A3B8" />
            <Text style={styles.noIgTxt}>Cette personne n'a pas ajouté son Instagram.</Text>
          </View>
        )}

        <View style={styles.reportRow}>
          <TouchableOpacity style={styles.reportBtn} onPress={report}>
            <Ionicons name="flag-outline" size={13} color="#F87171" />
            <Text style={styles.reportTxt}>Signaler</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.reportBtn} onPress={block}>
            <Ionicons name="ban-outline" size={13} color="#F87171" />
            <Text style={styles.reportTxt}>Bloquer</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },

  avatar: { width: 120, height: 120, borderRadius: 60, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)' },
  avatarPlaceholder: { backgroundColor: '#3B82F6', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 48, fontWeight: '800', color: 'white' },
  name: { fontSize: 24, fontWeight: '800', color: 'white' },

  vibesRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' },

  card: {
    padding: 14, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  cardLabel: { fontSize: 10.5, fontWeight: '800', color: '#94A3B8', letterSpacing: 1 },
  bio: { fontSize: 15, color: '#CBD5E1', lineHeight: 22, fontStyle: 'italic' },

  langChip: {
    paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12,
    backgroundColor: 'rgba(59,130,246,0.15)',
    borderWidth: 1, borderColor: 'rgba(59,130,246,0.3)',
  },
  langChipTxt: { fontSize: 11.5, fontWeight: '800', color: '#3B82F6' },

  matchLine: { fontSize: 13, color: '#E2E8F0', lineHeight: 20 },
  matchStrong: { fontWeight: '800', color: '#FBBF24' },

  icebreaker: {
    padding: 14, borderRadius: 14,
    backgroundColor: 'rgba(16,185,129,0.06)',
    borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)',
  },
  icebreakerLabel: { fontSize: 10.5, fontWeight: '800', color: '#10B981', letterSpacing: 1 },
  icebreakerTxt: { fontSize: 13, color: '#E2E8F0', marginTop: 8, lineHeight: 20, fontStyle: 'italic' },

  ctaMain: {
    flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 16, borderRadius: 30, backgroundColor: '#E1306C',
  },
  ctaMainTxt: { color: 'white', fontWeight: '800', fontSize: 16 },

  noIgBox: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    padding: 14, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  noIgTxt: { color: '#94A3B8', fontSize: 12 },

  reportRow: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  reportBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center',
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16,
    backgroundColor: 'rgba(248,113,113,0.08)',
    borderWidth: 1, borderColor: 'rgba(248,113,113,0.2)',
  },
  reportTxt: { color: '#F87171', fontWeight: '600', fontSize: 11 },
});
