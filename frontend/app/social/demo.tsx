/**
 * Amo Together · Interactive 3-tap connect demo.
 * URL: /social/demo
 *
 * States: 'card' → 'event' → 'profile'
 */
import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { UserBadge, VibeChip, VerifiedBadge, AmbassadorBadge, TravelerProBadge } from '../../src/components/UserBadge';

// -------------------------- MOCK DATA --------------------------
type Attendee = {
  id: string;
  first_name: string;
  last_initial: string;
  photo_hue: number;         // color for the placeholder avatar
  type: 'tourist' | 'local';
  country_flag: string;      // 🇫🇷 / 🇮🇹 / 🇺🇸 / 🇧🇷 / 🇨🇴 for locals
  country_label?: string;
  languages: string[];
  vibes: string[];
  bio: string;
  instagram: string;
  age: number;
  visibility: 'solo_open' | 'public' | 'private';
  verified?: boolean;
  ambassador?: boolean;
  pro?: boolean;
  trip_dates?: string;
  local_years?: number;
};

const MY_VIBES = ['electro', 'nightlife', 'foodie', 'photo'];
const MY_LANGUAGES = ['es', 'fr', 'en'];

const ATTENDEES: Attendee[] = [
  { id: 'u1', first_name: 'Marta',   last_initial: 'S', photo_hue: 200, type: 'tourist', country_flag: '🇮🇹', country_label: 'Italy',
    languages: ['it','en','fr'], vibes: ['electro','nightlife','foodie','art'],
    bio: 'Solo trip in Colombia, passionate about electro nights and food. Milano based, 5th time in South America.',
    instagram: 'marta_s_travel', age: 29, visibility: 'solo_open', verified: true, pro: true,
    trip_dates: '12-25 août 2026' },
  { id: 'u2', first_name: 'Carlos',  last_initial: 'M', photo_hue: 30,  type: 'local',   country_flag: '🏛️',
    languages: ['es','en'], vibes: ['nightlife','electro','art','coffee'],
    bio: 'Cartagenero de nacimiento. DJ los fines de semana, guío la vida nocturna de la ciudad.',
    instagram: 'carlos_cartagena_guide', age: 34, visibility: 'solo_open', verified: true, ambassador: true,
    local_years: 34 },
  { id: 'u3', first_name: 'Sarah',   last_initial: 'K', photo_hue: 340, type: 'tourist', country_flag: '🇺🇸', country_label: 'USA',
    languages: ['en','es'], vibes: ['electro','nightlife','photo'],
    bio: 'From Miami, one week in Colombia. Digital nomad who lives for underground techno.',
    instagram: 'sarahk_travels', age: 27, visibility: 'solo_open', verified: true,
    trip_dates: '13-20 août 2026' },
  { id: 'u4', first_name: 'Léa',     last_initial: 'P', photo_hue: 280, type: 'tourist', country_flag: '🇫🇷', country_label: 'France',
    languages: ['fr','en','es'], vibes: ['electro','nightlife','foodie','romance'],
    bio: 'Parisienne en solo à Cartagena. J\'adore l\'electro et les afters au bord de mer.',
    instagram: 'lea.paris', age: 31, visibility: 'solo_open', verified: true,
    trip_dates: '10-17 août 2026' },
  // Public but not "open to meet"
  { id: 'u5', first_name: 'Marco',   last_initial: 'B', photo_hue: 100, type: 'tourist', country_flag: '🇮🇹',
    languages: ['it','en'], vibes: ['beach'], bio: '', instagram: '', age: 35, visibility: 'public',
    trip_dates: '14-21 août' },
  { id: 'u6', first_name: 'Ana',     last_initial: 'G', photo_hue: 15,  type: 'local',   country_flag: '🏛️',
    languages: ['es'], vibes: ['salsa'], bio: '', instagram: '', age: 28, visibility: 'public', local_years: 6 },
  { id: 'u7', first_name: 'Bruno',   last_initial: 'C', photo_hue: 160, type: 'tourist', country_flag: '🇧🇷',
    languages: ['pt','es'], vibes: ['beach'], bio: '', instagram: '', age: 33, visibility: 'public' },
  { id: 'u8', first_name: 'Sofia',   last_initial: 'V', photo_hue: 320, type: 'local',   country_flag: '🏛️',
    languages: ['es','en'], vibes: [], bio: '', instagram: '', age: 25, visibility: 'public', local_years: 3 },
  { id: 'u9', first_name: 'Diego',   last_initial: 'R', photo_hue: 220, type: 'tourist', country_flag: '🇦🇷',
    languages: ['es'], vibes: [], bio: '', instagram: '', age: 40, visibility: 'public' },
  { id: 'u10', first_name: 'Emma',   last_initial: 'W', photo_hue: 50,  type: 'tourist', country_flag: '🇬🇧',
    languages: ['en'], vibes: [], bio: '', instagram: '', age: 29, visibility: 'public' },
  { id: 'u11', first_name: 'Pablo',  last_initial: 'H', photo_hue: 250, type: 'local',   country_flag: '🏛️',
    languages: ['es'], vibes: [], bio: '', instagram: '', age: 30, visibility: 'public', local_years: 30 },
  { id: 'u12', first_name: 'Julia',  last_initial: 'B', photo_hue: 190, type: 'tourist', country_flag: '🇩🇪',
    languages: ['de','en'], vibes: [], bio: '', instagram: '', age: 26, visibility: 'public' },
];

// -------------------------- UTILS --------------------------
const langLabel = (code: string) => ({ es:'ES', en:'EN', fr:'FR', pt:'PT', it:'IT', de:'DE' } as any)[code] || code.toUpperCase();

const overlap = (a: string[], b: string[]) => a.filter(x => b.includes(x));

// Avatar placeholder — colored circle with initial
const Avatar: React.FC<{ user: Attendee; size?: number; showBadge?: boolean }> = ({ user, size = 44, showBadge = true }) => (
  <View style={{ position: 'relative' }}>
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: `hsl(${user.photo_hue}, 60%, 40%)` }]}>
      <Text style={{ fontSize: size * 0.4, fontWeight: '800', color: 'white' }}>{user.first_name[0]}</Text>
    </View>
    {showBadge && (
      <View style={styles.avatarFlag}>
        <Text style={{ fontSize: size * 0.32 }}>{user.country_flag}</Text>
      </View>
    )}
  </View>
);

// -------------------------- MAIN --------------------------
type Screen = 'card' | 'event' | 'profile';

export default function SocialDemo() {
  const [screen, setScreen] = useState<Screen>('card');
  const [pickedUser, setPickedUser] = useState<Attendee | null>(null);
  const [filter, setFilter] = useState<'all'|'solo'|'locals'|'tourists'|'my_country'>('all');
  const router = useRouter();

  const soloOpen = useMemo(() => ATTENDEES.filter(a => a.visibility === 'solo_open'), []);
  const others = useMemo(() => ATTENDEES.filter(a => a.visibility === 'public'), []);

  const filtered = useMemo(() => {
    let list = ATTENDEES.filter(a => a.visibility !== 'private');
    if (filter === 'solo')     list = list.filter(a => a.visibility === 'solo_open');
    if (filter === 'locals')   list = list.filter(a => a.type === 'local');
    if (filter === 'tourists') list = list.filter(a => a.type === 'tourist');
    if (filter === 'my_country') list = list.filter(a => a.country_flag === '🇫🇷');
    // Sort: solo_open first
    return list.sort((a, b) => {
      if (a.visibility === 'solo_open' && b.visibility !== 'solo_open') return -1;
      if (b.visibility === 'solo_open' && a.visibility !== 'solo_open') return 1;
      return 0;
    });
  }, [filter]);

  // ==================== SCREEN 1 — CARD ====================
  if (screen === 'card') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>

          <TouchableOpacity style={styles.demoBackBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={18} color="#FBBF24" />
            <Text style={styles.demoBackTxt}>Retour au preview</Text>
          </TouchableOpacity>

          <View style={styles.demoHead}>
            <Text style={styles.demoStep}>ÉTAPE 1/3 · DÉCOUVERTE</Text>
            <Text style={styles.demoTitle}>Card de l'événement dans l'agenda</Text>
            <Text style={styles.demoDesc}>
              Ce que voit un(e) voyageur(se) en parcourant les évents.{"\n"}
              Le mosaïque avec drapeaux crée immédiatement le désir.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.eventCard}
            activeOpacity={0.85}
            onPress={() => setScreen('event')}
            testID="event-card"
          >
            <Image
              source={{ uri: 'https://images.unsplash.com/photo-1571266028243-e1f1c9d5ad74?w=1200' }}
              style={styles.eventImg}
            />
            <View style={styles.eventBody}>
              <View style={styles.eventTierBadge}><Text style={styles.eventTierTxt}>PREMIUM</Text></View>
              <Text style={styles.eventTitle}>Soirée Electro · Casa Bohème</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <Ionicons name="time-outline" size={14} color="#CBD5E1" />
                <Text style={styles.eventMeta}>Vendredi 15 août · 22h00 → 04h00</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
                <Ionicons name="location-outline" size={14} color="#CBD5E1" />
                <Text style={styles.eventMeta}>Casa Bohème · Getsemaní, Cartagena</Text>
              </View>

              {/* ATTENDEE MOSAIC */}
              <View style={styles.mosaicWrap}>
                <View style={{ flexDirection: 'row' }}>
                  {ATTENDEES.slice(0, 6).map((u, i) => (
                    <View key={u.id} style={[styles.mosaicItem, { marginLeft: i === 0 ? 0 : -12, zIndex: 6 - i }]}>
                      <Avatar user={u} size={40} showBadge={false} />
                      <View style={styles.mosaicMiniFlag}>
                        <Text style={{ fontSize: 12 }}>{u.country_flag}</Text>
                      </View>
                    </View>
                  ))}
                  <View style={[styles.mosaicItem, styles.mosaicMore, { marginLeft: -12 }]}>
                    <Text style={styles.mosaicMoreTxt}>+6</Text>
                  </View>
                </View>
                <View style={{ marginTop: 10, gap: 3 }}>
                  <Text style={styles.mosaicCount}>
                    <Text style={{ fontWeight: '800', color: 'white' }}>12 vont y aller</Text>
                    <Text style={{ color: '#94A3B8' }}> · </Text>
                    <Text style={{ color: '#FBBF24', fontWeight: '700' }}>4 solo ouvert(e)s ✨</Text>
                  </Text>
                  <Text style={styles.mosaicSubline}>2 Français · 3 Locaux Cartagena</Text>
                </View>
              </View>

              <View style={styles.priceRow}>
                <Text style={styles.price}>220 000 COP</Text>
                <View style={styles.reserveBtn}>
                  <Text style={styles.reserveTxt}>Réserver</Text>
                </View>
              </View>
            </View>
          </TouchableOpacity>

          <View style={styles.demoTip}>
            <Ionicons name="information-circle" size={18} color="#3B82F6" />
            <Text style={styles.demoTipTxt}>
              👉 Tape sur la card pour aller à l'étape 2 (détail de l'événement)
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ==================== SCREEN 2 — EVENT DETAIL ====================
  if (screen === 'event') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>

          <TouchableOpacity style={styles.demoBackBtn} onPress={() => setScreen('card')}>
            <Ionicons name="arrow-back" size={18} color="#FBBF24" />
            <Text style={styles.demoBackTxt}>Étape 1 · Retour à la card</Text>
          </TouchableOpacity>

          <View style={styles.demoHead}>
            <Text style={styles.demoStep}>ÉTAPE 2/3 · FILTRAGE</Text>
            <Text style={styles.demoTitle}>Détail de l'événement</Text>
            <Text style={styles.demoDesc}>
              Séparation en 2 sections : "Ouvert(e)s à rencontrer" (mis en avant) vs. "Autres participants".
            </Text>
          </View>

          {/* Event header */}
          <View style={styles.eventHeader}>
            <Text style={styles.eventTitleBig}>🎧 Soirée Electro · Casa Bohème</Text>
            <Text style={styles.eventSubBig}>22h00 → 04h00 · Vendredi 15 août · Getsemaní</Text>
          </View>

          {/* Filters */}
          <View style={styles.filters}>
            {([
              { k: 'all',        label: 'Tous',       icon: '👥' },
              { k: 'solo',       label: 'Solo',       icon: '✨' },
              { k: 'locals',     label: 'Locaux',     icon: '🏛️' },
              { k: 'tourists',   label: 'Voyageurs',  icon: '✈️' },
              { k: 'my_country', label: '🇫🇷 France', icon: '' },
            ] as {k:any;label:string;icon:string}[]).map(f => (
              <TouchableOpacity
                key={f.k}
                style={[styles.filterChip, filter === f.k && styles.filterChipActive]}
                onPress={() => setFilter(f.k)}
                activeOpacity={0.7}
              >
                <Text style={[styles.filterChipTxt, filter === f.k && { color: '#0A0A0A' }]}>
                  {f.icon ? `${f.icon} ` : ''}{f.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* SECTION 1 — Solo ouverts */}
          {filter !== 'my_country' && filter !== 'locals' && filter !== 'tourists' && (
            <>
              <View style={styles.sectionHead}>
                <Text style={{ fontSize: 16 }}>✨</Text>
                <Text style={styles.sectionTitle}>Ouvert(e)s à rencontrer ({soloOpen.length})</Text>
              </View>
              {soloOpen.map(u => (
                <TouchableOpacity
                  key={u.id}
                  style={styles.attCard}
                  activeOpacity={0.85}
                  onPress={() => { setPickedUser(u); setScreen('profile'); }}
                  testID={`attendee-${u.id}`}
                >
                  <Avatar user={u} size={54} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.attName}>
                      {u.first_name} {u.last_initial}. <Text style={{ fontSize: 16 }}>{u.country_flag}</Text>
                    </Text>
                    <UserBadge
                      type={u.type}
                      city="Cartagena"
                      subtitle={u.type === 'local' ? `desde ${u.local_years} años` : u.trip_dates}
                      size="sm"
                    />
                    <View style={{ flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                      {u.verified && <VerifiedBadge />}
                      {u.ambassador && <AmbassadorBadge />}
                      {u.pro && <TravelerProBadge />}
                    </View>
                    {/* Match indicators */}
                    <View style={styles.matchRow}>
                      <Text style={styles.matchTxt}>
                        🎯 <Text style={{ fontWeight: '800', color: '#FBBF24' }}>
                          {overlap(u.vibes, MY_VIBES).length} vibes
                        </Text>
                        {' · '}
                        <Text style={{ fontWeight: '800', color: '#FBBF24' }}>
                          {overlap(u.languages, MY_LANGUAGES).length} langues
                        </Text> en commun
                      </Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#94A3B8" />
                </TouchableOpacity>
              ))}
            </>
          )}

          {/* SECTION 2 — Autres */}
          <View style={styles.sectionHead}>
            <Ionicons name="people-outline" size={16} color="#94A3B8" />
            <Text style={styles.sectionTitle}>
              {filter === 'all' ? `Autres participants (${others.length})`
                : filter === 'solo' ? 'Fin des résultats'
                : `Résultats filtrés (${filtered.length})`}
            </Text>
          </View>
          <View style={styles.othersGrid}>
            {(filter === 'all' ? others : filtered).map(u => (
              <View key={u.id} style={styles.otherAvatar}>
                <Avatar user={u} size={46} />
              </View>
            ))}
          </View>

          <View style={styles.demoTip}>
            <Ionicons name="information-circle" size={18} color="#3B82F6" />
            <Text style={styles.demoTipTxt}>
              👉 Tape un profil "Solo ouvert" pour voir l'étape 3
            </Text>
          </View>

        </ScrollView>
      </SafeAreaView>
    );
  }

  // ==================== SCREEN 3 — PROFILE ====================
  const u = pickedUser!;
  const commonVibes = overlap(u.vibes, MY_VIBES);
  const commonLangs = overlap(u.languages, MY_LANGUAGES);

  const icebreaker = `Hola ${u.first_name}! Vu qu'on va tou(te)s les deux à la soirée electro à Casa Bohème ce vendredi 🎧 (via Amo Cartagena)`;
  const openIG = () => {
    const igApp = `instagram://user?username=${u.instagram}`;
    const igWeb = `https://www.instagram.com/${u.instagram}/`;
    Linking.canOpenURL(igApp).then(ok => Linking.openURL(ok ? igApp : igWeb));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}>

        <TouchableOpacity style={styles.demoBackBtn} onPress={() => setScreen('event')}>
          <Ionicons name="arrow-back" size={18} color="#FBBF24" />
          <Text style={styles.demoBackTxt}>Étape 2 · Retour aux participants</Text>
        </TouchableOpacity>

        <View style={styles.demoHead}>
          <Text style={styles.demoStep}>ÉTAPE 3/3 · CONNECT</Text>
          <Text style={styles.demoTitle}>Profil du participant</Text>
          <Text style={styles.demoDesc}>
            Une seule action principale : DM Instagram avec message pré-rempli.
          </Text>
        </View>

        {/* Big avatar + name */}
        <View style={{ alignItems: 'center', gap: 12 }}>
          <Avatar user={u} size={120} />
          <Text style={styles.bigName}>{u.first_name} {u.last_initial}. <Text style={{ fontSize: 22 }}>{u.country_flag}</Text></Text>
          <UserBadge type={u.type} city="Cartagena" subtitle={u.type === 'local' ? `desde ${u.local_years} años` : u.trip_dates} size="md" />
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
            {u.verified && <VerifiedBadge />}
            {u.ambassador && <AmbassadorBadge />}
            {u.pro && <TravelerProBadge />}
          </View>
        </View>

        {/* Vibes */}
        <View style={styles.vibesRow}>
          {u.vibes.map(v => <VibeChip key={v} label={v} />)}
        </View>

        {/* Bio */}
        <View style={styles.card}>
          <Text style={styles.bioTxt}>"{u.bio}"</Text>
        </View>

        {/* Languages */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>LANGUES PARLÉES</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
            {u.languages.map(l => (
              <View key={l} style={styles.langChip}>
                <Text style={styles.langChipTxt}>{langLabel(l)}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Match summary */}
        <View style={[styles.card, { borderColor: 'rgba(251,191,36,0.4)', backgroundColor: 'rgba(251,191,36,0.06)' }]}>
          <Text style={[styles.cardLabel, { color: '#FBBF24' }]}>🎯 VOUS PARTAGEZ</Text>
          <View style={{ gap: 6, marginTop: 8 }}>
            <Text style={styles.matchLine}>• <Text style={styles.matchStrong}>{commonVibes.length}</Text> vibes en commun {commonVibes.length ? `(${commonVibes.join(', ')})` : ''}</Text>
            <Text style={styles.matchLine}>• <Text style={styles.matchStrong}>{commonLangs.length}</Text> langues en commun {commonLangs.length ? `(${commonLangs.map(langLabel).join(', ')})` : ''}</Text>
            <Text style={styles.matchLine}>• Même événement : <Text style={{ color: 'white', fontWeight: '700' }}>Soirée Electro · Casa Bohème</Text></Text>
          </View>
        </View>

        {/* Icebreaker preview */}
        <View style={styles.icebreaker}>
          <Text style={styles.icebreakerLabel}>💬 MESSAGE PRÉ-REMPLI SUR INSTAGRAM</Text>
          <Text style={styles.icebreakerTxt}>"{icebreaker}"</Text>
        </View>

        {/* MAIN CTA */}
        <TouchableOpacity style={styles.ctaMain} activeOpacity={0.85} onPress={openIG} testID="cta-instagram">
          <Ionicons name="logo-instagram" size={22} color="white" />
          <Text style={styles.ctaMainTxt}>Dire hi sur Instagram</Text>
        </TouchableOpacity>

        {/* Secondary actions */}
        <View style={styles.secondaryRow}>
          <TouchableOpacity style={styles.secondaryBtn} activeOpacity={0.7}>
            <Ionicons name="bookmark-outline" size={16} color="#94A3B8" />
            <Text style={styles.secondaryTxt}>Sauver pour plus tard</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.reportRow}>
          <TouchableOpacity style={styles.reportBtn} activeOpacity={0.7}>
            <Ionicons name="flag-outline" size={13} color="#F87171" />
            <Text style={styles.reportTxt}>Signaler</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.reportBtn} activeOpacity={0.7}>
            <Ionicons name="ban-outline" size={13} color="#F87171" />
            <Text style={styles.reportTxt}>Bloquer</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.demoTip}>
          <Ionicons name="checkmark-circle" size={18} color="#10B981" />
          <Text style={styles.demoTipTxt}>
            ✅ 3 taps réalisés · Instagram s'ouvre au tap suivant
          </Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// -------------------------- STYLES --------------------------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },

  // Demo overlay
  demoBackBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12,
    backgroundColor: 'rgba(251,191,36,0.10)', borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(251,191,36,0.3)',
  },
  demoBackTxt: { color: '#FBBF24', fontWeight: '700', fontSize: 12 },
  demoHead: { gap: 6, alignItems: 'center' },
  demoStep: { color: '#FBBF24', fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  demoTitle: { fontSize: 22, fontWeight: '800', color: 'white', textAlign: 'center' },
  demoDesc: { fontSize: 13, color: '#94A3B8', textAlign: 'center', lineHeight: 18 },
  demoTip: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    padding: 12, borderRadius: 12, backgroundColor: 'rgba(59,130,246,0.10)',
    borderWidth: 1, borderColor: 'rgba(59,130,246,0.3)',
  },
  demoTipTxt: { flex: 1, fontSize: 12, color: '#CBD5E1', lineHeight: 18 },

  // Screen 1 — event card
  eventCard: { borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  eventImg: { width: '100%', height: 180 },
  eventBody: { padding: 16, gap: 6 },
  eventTierBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, backgroundColor: 'rgba(139,92,246,0.15)', borderRadius: 10, borderWidth: 1, borderColor: '#8B5CF6' },
  eventTierTxt: { fontSize: 10, fontWeight: '800', color: '#8B5CF6', letterSpacing: 1 },
  eventTitle: { fontSize: 22, fontWeight: '800', color: 'white' },
  eventMeta: { fontSize: 12, color: '#CBD5E1' },

  mosaicWrap: {
    marginTop: 14, padding: 12, borderRadius: 12,
    backgroundColor: 'rgba(59,130,246,0.06)',
    borderWidth: 1, borderColor: 'rgba(59,130,246,0.25)',
  },
  mosaicItem: {
    borderWidth: 2, borderColor: '#0A0A0A', borderRadius: 21, position: 'relative',
  },
  mosaicMiniFlag: {
    position: 'absolute', bottom: -2, right: -2, width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#0A0A0A', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  mosaicMore: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  mosaicMoreTxt: { color: '#94A3B8', fontWeight: '800', fontSize: 12 },
  mosaicCount: { fontSize: 13, lineHeight: 18 },
  mosaicSubline: { fontSize: 11, color: '#94A3B8' },

  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  price: { fontSize: 18, fontWeight: '800', color: 'white' },
  reserveBtn: { paddingVertical: 10, paddingHorizontal: 20, backgroundColor: '#F59E0B', borderRadius: 22 },
  reserveTxt: { color: 'white', fontWeight: '800', fontSize: 13 },

  // Screen 2 — event detail
  eventHeader: { padding: 16, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  eventTitleBig: { fontSize: 22, fontWeight: '800', color: 'white' },
  eventSubBig: { fontSize: 13, color: '#94A3B8', marginTop: 4 },

  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  filterChipActive: { backgroundColor: '#FBBF24', borderColor: '#FBBF24' },
  filterChipTxt: { fontSize: 12, color: 'white', fontWeight: '700' },

  sectionHead: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: 'white' },

  attCard: {
    flexDirection: 'row', gap: 12, padding: 14,
    backgroundColor: 'rgba(251,191,36,0.05)', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(251,191,36,0.25)',
    alignItems: 'center',
  },
  attName: { fontSize: 16, fontWeight: '800', color: 'white' },
  matchRow: { marginTop: 4 },
  matchTxt: { fontSize: 11.5, color: '#CBD5E1' },

  othersGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  otherAvatar: { padding: 2, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 30 },

  avatar: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)' },
  avatarFlag: {
    position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#0A0A0A', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)',
  },

  // Screen 3 — profile
  bigName: { fontSize: 26, fontWeight: '800', color: 'white' },
  vibesRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' },
  card: {
    padding: 14, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  cardLabel: { fontSize: 10.5, fontWeight: '800', color: '#94A3B8', letterSpacing: 1 },
  bioTxt: { fontSize: 15, color: '#CBD5E1', lineHeight: 22, fontStyle: 'italic' },

  langChip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, backgroundColor: 'rgba(59,130,246,0.15)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.3)' },
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
    paddingVertical: 16, borderRadius: 30,
    backgroundColor: '#E1306C',
  },
  ctaMainTxt: { color: 'white', fontWeight: '800', fontSize: 16 },

  secondaryRow: { alignItems: 'center' },
  secondaryBtn: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 20, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  secondaryTxt: { color: '#CBD5E1', fontWeight: '600', fontSize: 13 },

  reportRow: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  reportBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center',
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16,
    backgroundColor: 'rgba(248,113,113,0.08)',
    borderWidth: 1, borderColor: 'rgba(248,113,113,0.2)',
  },
  reportTxt: { color: '#F87171', fontWeight: '600', fontSize: 11 },
});
