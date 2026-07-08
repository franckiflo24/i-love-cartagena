/**
 * Amo Together — Social profile editor.
 * Route: /social/edit
 *
 * Users pick their type (Local vs Tourist), city, vibes (5 max), languages,
 * Instagram handle and a short bio. Toggling "social_enabled" turns them
 * discoverable on event attendee lists and the "nearby" screen.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/constants/api';
import { useAuth } from '../../src/context/AuthContext';
import { UserBadge, VibeChip } from '../../src/components/UserBadge';

type Config = {
  supported_cities: { slug: string; name: string; flag: string; live: boolean }[];
  vibes: string[];
  languages: string[];
  max_vibes_per_user: number;
  bio_max_chars: number;
};

type Social = {
  user_type?: 'local' | 'tourist';
  home_city?: string;
  current_city?: string;
  trip_start?: string;
  trip_end?: string;
  local_since_years?: number;
  vibes?: string[];
  languages?: string[];
  instagram?: string;
  bio?: string;
  social_enabled?: boolean;
};

const LANG_META: Record<string, { flag: string; label: string }> = {
  es: { flag: '🇪🇸', label: 'Español' },
  en: { flag: '🇬🇧', label: 'English' },
  fr: { flag: '🇫🇷', label: 'Français' },
  pt: { flag: '🇧🇷', label: 'Português' },
};

export default function SocialEditScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [config, setConfig] = useState<Config | null>(null);
  const [social, setSocial] = useState<Social>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [cfg, mine] = await Promise.all([
          api.get('/users/social/config'),
          api.get('/users/me/social').catch(() => ({ social: {} })),
        ]);
        setConfig(cfg);
        setSocial(mine.social || {});
      } catch {
        Alert.alert('Erreur', 'Impossible de charger le profil');
      }
      setLoading(false);
    })();
  }, []);

  const toggleVibe = (v: string) => {
    const cur = new Set(social.vibes || []);
    if (cur.has(v)) cur.delete(v);
    else if (cur.size >= (config?.max_vibes_per_user || 5)) return;
    else cur.add(v);
    setSocial({ ...social, vibes: Array.from(cur) });
  };

  const toggleLang = (l: string) => {
    const cur = new Set(social.languages || []);
    if (cur.has(l)) cur.delete(l);
    else cur.add(l);
    setSocial({ ...social, languages: Array.from(cur) });
  };

  const save = async () => {
    if (!social.user_type) {
      Alert.alert('Manque un choix', 'Es-tu Voyageur ou Local ?');
      return;
    }
    if (!social.current_city) {
      Alert.alert('Manque un choix', 'Dans quelle ville es-tu ?');
      return;
    }
    if (social.social_enabled) {
      if (!(social.vibes || []).length) {
        Alert.alert('Presque !', 'Choisis au moins un vibe pour apparaître.');
        return;
      }
      if (!(social.languages || []).length) {
        Alert.alert('Presque !', 'Ajoute au moins une langue parlée.');
        return;
      }
    }
    setSaving(true);
    try {
      const res = await api.patch('/users/me/social', social);
      setSocial(res.social || social);
      Alert.alert('✅ Sauvegardé', social.social_enabled
        ? 'Tu es visible sur les événements auxquels tu participes.'
        : 'Ton profil social est sauvegardé (invisible pour le moment).');
      router.back();
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Impossible de sauvegarder');
    }
    setSaving(false);
  };

  if (!user) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.emptyBox}>
          <Ionicons name="lock-closed-outline" size={38} color="#FBBF24" />
          <Text style={styles.emptyTitle}>Connecte-toi</Text>
          <Text style={styles.emptyDesc}>Pour créer ton profil Amo Together, il faut être connecté.</Text>
          <TouchableOpacity style={styles.ctaBtn} onPress={() => router.push('/(tabs)/perfil' as any)}>
            <Text style={styles.ctaBtnTxt}>Aller à mon profil</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (loading || !config) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator style={{ flex: 1 }} size="large" color="#FBBF24" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120, gap: 20 }} keyboardShouldPersistTaps="handled">

          {/* Header */}
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={22} color="white" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Amo Together</Text>
            <View style={{ width: 40 }} />
          </View>

          <Text style={styles.subtitle}>
            Rejoins les voyageurs et les locaux qui vont aux mêmes événements que toi.
          </Text>

          {/* User type */}
          <Section title="Es-tu…">
            <View style={styles.typeRow}>
              <TypeCard
                icon="✈️"
                label="Voyageur"
                desc="Je suis en visite dans la ville"
                active={social.user_type === 'tourist'}
                onPress={() => setSocial({ ...social, user_type: 'tourist' })}
                color="#3B82F6"
              />
              <TypeCard
                icon="🏛️"
                label="Local"
                desc="Je vis ici"
                active={social.user_type === 'local'}
                onPress={() => setSocial({ ...social, user_type: 'local' })}
                color="#F59E0B"
              />
            </View>
          </Section>

          {/* City */}
          <Section title="Dans quelle ville es-tu ?">
            <View style={styles.chipsWrap}>
              {config.supported_cities.map(c => {
                const active = social.current_city === c.slug;
                return (
                  <TouchableOpacity
                    key={c.slug}
                    disabled={!c.live}
                    onPress={() => setSocial({ ...social, current_city: c.slug })}
                    style={[styles.cityChip, active && styles.cityChipActive, !c.live && { opacity: 0.4 }]}
                  >
                    <Text style={{ fontSize: 15 }}>{c.flag}</Text>
                    <Text style={[styles.cityChipTxt, active && { color: '#0A0A0A' }]}>{c.name}</Text>
                    {!c.live && <Text style={styles.comingSoon}>bientôt</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>
          </Section>

          {/* Tourist: trip dates | Local: years */}
          {social.user_type === 'tourist' ? (
            <Section title="Dates de séjour (optionnel)">
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TextInput
                  style={styles.input}
                  placeholder="Début — 2026-08-12"
                  placeholderTextColor="#64748B"
                  value={social.trip_start || ''}
                  onChangeText={t => setSocial({ ...social, trip_start: t })}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Fin — 2026-08-20"
                  placeholderTextColor="#64748B"
                  value={social.trip_end || ''}
                  onChangeText={t => setSocial({ ...social, trip_end: t })}
                />
              </View>
              <Text style={styles.helper}>Format YYYY-MM-DD. Nous n'affichons que la fourchette.</Text>
            </Section>
          ) : social.user_type === 'local' ? (
            <Section title="Depuis combien d'années dans la ville ?">
              <View style={styles.yearsRow}>
                {[0, 1, 3, 5, 10, 20].map(y => (
                  <TouchableOpacity
                    key={y}
                    onPress={() => setSocial({ ...social, local_since_years: y })}
                    style={[styles.yearChip, social.local_since_years === y && styles.yearChipActive]}
                  >
                    <Text style={[styles.yearChipTxt, social.local_since_years === y && { color: '#0A0A0A' }]}>
                      {y === 0 ? 'Nuevo' : y === 20 ? '20+' : `${y}+`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Section>
          ) : null}

          {/* Vibes */}
          <Section title={`Tes vibes (max ${config.max_vibes_per_user})`}>
            <View style={styles.chipsWrap}>
              {config.vibes.map(v => {
                const active = (social.vibes || []).includes(v);
                return (
                  <TouchableOpacity key={v} onPress={() => toggleVibe(v)} activeOpacity={0.75}>
                    <View style={active ? styles.vibeActiveWrap : undefined}>
                      <VibeChip label={v} />
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.helper}>{(social.vibes || []).length}/{config.max_vibes_per_user} sélectionnés</Text>
          </Section>

          {/* Languages */}
          <Section title="Langues que tu parles">
            <View style={styles.chipsWrap}>
              {config.languages.map(l => {
                const active = (social.languages || []).includes(l);
                const meta = LANG_META[l] || { flag: '🏳️', label: l.toUpperCase() };
                return (
                  <TouchableOpacity
                    key={l}
                    onPress={() => toggleLang(l)}
                    style={[styles.langChip, active && styles.langChipActive]}
                  >
                    <Text style={{ fontSize: 14 }}>{meta.flag}</Text>
                    <Text style={[styles.langChipTxt, active && { color: '#0A0A0A' }]}>{meta.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Section>

          {/* Instagram */}
          <Section title="Instagram (pour recevoir des DMs)">
            <View style={styles.igRow}>
              <Text style={styles.igAt}>@</Text>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="ton_pseudo_ig"
                placeholderTextColor="#64748B"
                value={social.instagram || ''}
                onChangeText={t => setSocial({ ...social, instagram: t.replace(/[^a-zA-Z0-9._]/g, '') })}
                autoCapitalize="none"
              />
            </View>
            <Text style={styles.helper}>Nous ne stockons que le pseudo. Aucun accès à ton compte.</Text>
          </Section>

          {/* Bio */}
          <Section title="Bio courte (150 caractères max)">
            <TextInput
              style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
              placeholder="Parisienne solo · fan d'electro et de ceviche"
              placeholderTextColor="#64748B"
              value={social.bio || ''}
              onChangeText={t => setSocial({ ...social, bio: t.slice(0, config.bio_max_chars) })}
              multiline
              maxLength={config.bio_max_chars}
            />
            <Text style={styles.helper}>{(social.bio || '').length}/{config.bio_max_chars}</Text>
          </Section>

          {/* Preview */}
          {social.user_type && social.current_city && (
            <View style={styles.previewCard}>
              <Text style={styles.previewLabel}>PRÉVISUALISATION DE TON BADGE</Text>
              <View style={{ alignSelf: 'flex-start', marginTop: 10 }}>
                <UserBadge
                  type={social.user_type}
                  city={
                    config.supported_cities.find(c => c.slug === social.current_city)?.name || social.current_city
                  }
                  subtitle={
                    social.user_type === 'local'
                      ? (social.local_since_years !== undefined ? `desde ${social.local_since_years}+ años` : undefined)
                      : (social.trip_start && social.trip_end ? `${social.trip_start} → ${social.trip_end}` : 'En viaje')
                  }
                  size="lg"
                />
              </View>
            </View>
          )}

          {/* Enable toggle */}
          <View style={styles.enableCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.enableTitle}>Rendre mon profil découvrable</Text>
              <Text style={styles.enableDesc}>
                Quand tu participes à un événement, les autres participants voient ton prénom, ton badge et tes vibes.
                Tu peux le désactiver à tout moment.
              </Text>
            </View>
            <Switch
              value={!!social.social_enabled}
              onValueChange={v => setSocial({ ...social, social_enabled: v })}
              trackColor={{ true: '#FBBF24', false: '#334155' }}
              thumbColor="#fff"
            />
          </View>

        </ScrollView>

        {/* Save bar */}
        <View style={styles.saveBar}>
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={save}
            disabled={saving}
            testID="social-edit-save"
          >
            {saving ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <Ionicons name="checkmark" size={20} color="white" />
                <Text style={styles.saveBtnTxt}>Sauvegarder</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// -------- helpers --------
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <View style={{ gap: 10 }}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

const TypeCard: React.FC<{ icon: string; label: string; desc: string; active: boolean; onPress: () => void; color: string }> = ({ icon, label, desc, active, onPress, color }) => (
  <TouchableOpacity
    style={[styles.typeCard, active && { borderColor: color, backgroundColor: `${color}18` }]}
    onPress={onPress}
    activeOpacity={0.85}
  >
    <Text style={{ fontSize: 28 }}>{icon}</Text>
    <Text style={[styles.typeCardLabel, active && { color }]}>{label}</Text>
    <Text style={styles.typeCardDesc}>{desc}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#FBBF24' },
  subtitle: { fontSize: 13, color: '#94A3B8', lineHeight: 18, textAlign: 'center' },

  sectionTitle: { fontSize: 13, fontWeight: '800', color: '#E2E8F0', letterSpacing: 0.3 },

  typeRow: { flexDirection: 'row', gap: 10 },
  typeCard: {
    flex: 1, padding: 16, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', gap: 6,
  },
  typeCardLabel: { fontSize: 15, fontWeight: '800', color: 'white' },
  typeCardDesc: { fontSize: 11, color: '#94A3B8', textAlign: 'center' },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cityChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  cityChipActive: { backgroundColor: '#FBBF24', borderColor: '#FBBF24' },
  cityChipTxt: { fontSize: 13, fontWeight: '700', color: 'white' },
  comingSoon: { fontSize: 9, color: '#94A3B8', marginLeft: 4, fontStyle: 'italic' },

  yearsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  yearChip: {
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  yearChipActive: { backgroundColor: '#F59E0B', borderColor: '#F59E0B' },
  yearChipTxt: { fontSize: 12, fontWeight: '700', color: 'white' },

  vibeActiveWrap: {
    borderRadius: 14,
    padding: 1,
    backgroundColor: '#FBBF24',
  },

  langChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 7, paddingHorizontal: 12, borderRadius: 18,
    backgroundColor: 'rgba(59,130,246,0.10)',
    borderWidth: 1, borderColor: 'rgba(59,130,246,0.3)',
  },
  langChipActive: { backgroundColor: '#3B82F6', borderColor: '#3B82F6' },
  langChipTxt: { fontSize: 12, fontWeight: '700', color: '#93C5FD' },

  input: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 14,
    color: 'white', fontSize: 14,
    flex: 1,
  },
  helper: { fontSize: 11, color: '#64748B', marginTop: 4 },

  igRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12, paddingLeft: 12,
  },
  igAt: { color: '#94A3B8', fontSize: 15, fontWeight: '700' },

  previewCard: {
    padding: 14, borderRadius: 14,
    backgroundColor: 'rgba(251,191,36,0.06)',
    borderWidth: 1, borderColor: 'rgba(251,191,36,0.3)',
  },
  previewLabel: { fontSize: 10, color: '#FBBF24', fontWeight: '800', letterSpacing: 1 },

  enableCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 14,
    backgroundColor: 'rgba(59,130,246,0.06)',
    borderWidth: 1, borderColor: 'rgba(59,130,246,0.3)',
  },
  enableTitle: { fontSize: 14, fontWeight: '800', color: 'white' },
  enableDesc: { fontSize: 11.5, color: '#94A3B8', lineHeight: 16, marginTop: 3 },

  saveBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 16, paddingBottom: 30,
    backgroundColor: 'rgba(10,10,10,0.95)',
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)',
  },
  saveBtn: {
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FBBF24', borderRadius: 28, paddingVertical: 15,
  },
  saveBtnTxt: { color: '#0A0A0A', fontSize: 16, fontWeight: '800' },

  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 30 },
  emptyTitle: { fontSize: 20, color: 'white', fontWeight: '800' },
  emptyDesc: { fontSize: 13, color: '#94A3B8', textAlign: 'center', lineHeight: 19 },
  ctaBtn: {
    backgroundColor: '#FBBF24', paddingVertical: 12, paddingHorizontal: 22, borderRadius: 24,
    marginTop: 8,
  },
  ctaBtnTxt: { color: '#0A0A0A', fontWeight: '800', fontSize: 14 },
});
