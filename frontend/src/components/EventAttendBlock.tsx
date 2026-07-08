/**
 * Amo Together — Event attend/mosaic block.
 * Drop this into any event detail screen to add attendance mechanics.
 *
 * <EventAttendBlock eventId="pe_xxx" />
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator,
  Alert, Modal, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '../constants/api';
import { useAuth } from '../context/AuthContext';

type Preview = {
  event_id: string;
  total: number;
  solo_open_count: number;
  avatars: {
    user_id: string;
    initial: string;
    photo_url?: string;
    user_type: 'local' | 'tourist';
  }[];
};

type Me = {
  attending: boolean;
  visibility?: 'private' | 'public' | 'solo_open';
};

interface Props {
  eventId: string;
}

export const EventAttendBlock: React.FC<Props> = ({ eventId }) => {
  const router = useRouter();
  const { user } = useAuth();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await api.get(`/events/${eventId}/attendance/preview`);
      setPreview(p);
    } catch {}
    if (user) {
      try {
        const m = await api.get(`/events/${eventId}/attendance/me`);
        setMe(m);
      } catch {}
    }
    setLoading(false);
  }, [eventId, user]);

  useEffect(() => { load(); }, [load]);

  const join = async (visibility: 'private' | 'public' | 'solo_open') => {
    if (!user) {
      Alert.alert('Connexion requise', 'Connecte-toi pour rejoindre les participants.');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/events/${eventId}/attend`, { visibility });
      await load();
      setModalOpen(false);
    } catch (e: any) {
      if (e?.message?.includes('social_enabled') || e?.message?.includes('Amo Together profile')) {
        Alert.alert(
          'Profil social requis',
          'Complète ton profil Amo Together pour être visible sur cet événement.',
          [
            { text: 'Plus tard', style: 'cancel' },
            { text: 'Compléter', onPress: () => router.push('/social/edit' as any) },
          ],
        );
      } else {
        Alert.alert('Erreur', e?.message || 'Impossible de rejoindre');
      }
    }
    setSaving(false);
  };

  const leave = async () => {
    Alert.alert(
      'Annuler ta participation ?',
      'Tu disparaîtras de la liste des participants.',
      [
        { text: 'Non', style: 'cancel' },
        { text: 'Oui', style: 'destructive', onPress: async () => {
          setSaving(true);
          try {
            await api.delete(`/events/${eventId}/attend`);
            await load();
          } catch (e: any) {
            Alert.alert('Erreur', e?.message || 'Impossible d\'annuler');
          }
          setSaving(false);
        }},
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="small" color="#FBBF24" />
      </View>
    );
  }

  const total = preview?.total || 0;
  const soloCount = preview?.solo_open_count || 0;
  const avatars = preview?.avatars || [];
  const attending = !!me?.attending;

  return (
    <>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Ionicons name="people" size={18} color="#FBBF24" />
            <Text style={styles.headerTitle}>Amo Together</Text>
          </View>
          {attending && (
            <View style={styles.attendingBadge}>
              <Ionicons name="checkmark-circle" size={13} color="#10B981" />
              <Text style={styles.attendingBadgeTxt}>Tu y vas</Text>
            </View>
          )}
        </View>

        {total > 0 ? (
          <TouchableOpacity
            style={styles.mosaicRow}
            activeOpacity={0.85}
            onPress={() => router.push({ pathname: '/social/attendees/[eventId]', params: { eventId } } as any)}
            testID="attendee-mosaic"
          >
            <View style={{ flexDirection: 'row' }}>
              {avatars.slice(0, 6).map((a, i) => (
                <View
                  key={a.user_id}
                  style={[
                    styles.mosaicAvatar,
                    { marginLeft: i === 0 ? 0 : -12, zIndex: 6 - i, backgroundColor: a.user_type === 'local' ? '#F59E0B' : '#3B82F6' },
                  ]}
                >
                  {a.photo_url ? (
                    <Image source={{ uri: a.photo_url }} style={styles.mosaicImg} />
                  ) : (
                    <Text style={styles.mosaicInitial}>{a.initial}</Text>
                  )}
                </View>
              ))}
              {total > 6 && (
                <View style={[styles.mosaicAvatar, styles.mosaicMore, { marginLeft: -12 }]}>
                  <Text style={styles.mosaicMoreTxt}>+{total - 6}</Text>
                </View>
              )}
            </View>
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={styles.mosaicCount}>
                {total} {total > 1 ? 'personnes vont y aller' : 'personne va y aller'}
              </Text>
              {soloCount > 0 && (
                <Text style={styles.mosaicSub}>
                  {soloCount} solo ouvert(e){soloCount > 1 ? 's' : ''} ✨
                </Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </TouchableOpacity>
        ) : (
          <Text style={styles.mosaicEmpty}>
            Sois le/la premier(ère) à confirmer ta présence !
          </Text>
        )}

        {/* Main CTA */}
        {attending ? (
          <View style={styles.ctaRow}>
            <View style={styles.visibilityPill}>
              <Ionicons
                name={me?.visibility === 'solo_open' ? 'sparkles' : me?.visibility === 'public' ? 'eye' : 'eye-off'}
                size={14}
                color="#FBBF24"
              />
              <Text style={styles.visibilityTxt}>
                {me?.visibility === 'solo_open' ? 'Solo & ouvert(e)' : me?.visibility === 'public' ? 'Visible' : 'Privé'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.changeBtn}
              onPress={() => setModalOpen(true)}
              disabled={saving}
            >
              <Ionicons name="options-outline" size={15} color="#FBBF24" />
              <Text style={styles.changeBtnTxt}>Changer</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.leaveBtn} onPress={leave} disabled={saving}>
              <Ionicons name="close" size={16} color="#F87171" />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.joinBtn}
            onPress={() => setModalOpen(true)}
            disabled={saving}
            testID="join-event-btn"
          >
            {saving ? <ActivityIndicator size="small" color="#0A0A0A" /> : (
              <>
                <Ionicons name="add-circle" size={18} color="#0A0A0A" />
                <Text style={styles.joinBtnTxt}>Participer à cet événement</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Visibility choice modal */}
      <Modal
        visible={modalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setModalOpen(false)}
      >
        <Pressable style={styles.modalBg} onPress={() => setModalOpen(false)}>
          <Pressable style={styles.modalCard} onPress={e => e.stopPropagation()}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Ta visibilité pour cet événement</Text>
            <Text style={styles.modalSub}>Tu peux changer d'avis à tout moment.</Text>

            <TouchableOpacity
              style={[styles.visibilityCard, me?.visibility === 'solo_open' && styles.visibilityCardActive]}
              onPress={() => join('solo_open')}
              activeOpacity={0.85}
              testID="visibility-solo"
            >
              <View style={styles.visibilityIcon}>
                <Ionicons name="sparkles" size={20} color="#FBBF24" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.visibilityLabel}>Solo & ouvert(e) à rencontrer ✨</Text>
                <Text style={styles.visibilityDesc}>
                  Ton badge, tes vibes et ton Instagram apparaissent en avant. Recommandé pour rencontrer.
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.visibilityCard, me?.visibility === 'public' && styles.visibilityCardActive]}
              onPress={() => join('public')}
              activeOpacity={0.85}
              testID="visibility-public"
            >
              <View style={styles.visibilityIcon}>
                <Ionicons name="eye" size={20} color="#3B82F6" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.visibilityLabel}>Visible mais pas cherchable</Text>
                <Text style={styles.visibilityDesc}>
                  Ton prénom + drapeau apparaissent dans la grille. Personne ne peut voir ton profil.
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.visibilityCard, me?.visibility === 'private' && styles.visibilityCardActive]}
              onPress={() => join('private')}
              activeOpacity={0.85}
              testID="visibility-private"
            >
              <View style={styles.visibilityIcon}>
                <Ionicons name="eye-off" size={20} color="#94A3B8" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.visibilityLabel}>Privé (juste compté)</Text>
                <Text style={styles.visibilityDesc}>
                  Tu contribues au compteur mais aucun autre participant ne te voit.
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.modalCancel} onPress={() => setModalOpen(false)}>
              <Text style={styles.modalCancelTxt}>Annuler</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};

export default EventAttendBlock;

const styles = StyleSheet.create({
  container: {
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(251,191,36,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.25)',
    gap: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { fontSize: 14, fontWeight: '800', color: '#FBBF24', letterSpacing: 0.3 },

  attendingBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 3, paddingHorizontal: 8, borderRadius: 12,
    backgroundColor: 'rgba(16,185,129,0.15)',
    borderWidth: 1, borderColor: 'rgba(16,185,129,0.35)',
  },
  attendingBadgeTxt: { fontSize: 11, color: '#10B981', fontWeight: '700' },

  mosaicRow: { flexDirection: 'row', alignItems: 'center' },
  mosaicAvatar: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#0A0A0A',
  },
  mosaicImg: { width: '100%', height: '100%', borderRadius: 17 },
  mosaicInitial: { fontSize: 13, fontWeight: '800', color: 'white' },
  mosaicMore: { backgroundColor: 'rgba(255,255,255,0.10)' },
  mosaicMoreTxt: { fontSize: 11, fontWeight: '800', color: '#94A3B8' },
  mosaicCount: { fontSize: 13, color: 'white', fontWeight: '700' },
  mosaicSub: { fontSize: 11, color: '#FBBF24', fontWeight: '700', marginTop: 2 },
  mosaicEmpty: { fontSize: 12, color: '#94A3B8', fontStyle: 'italic', textAlign: 'center', paddingVertical: 8 },

  joinBtn: {
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FBBF24', borderRadius: 22, paddingVertical: 12,
  },
  joinBtnTxt: { color: '#0A0A0A', fontWeight: '800', fontSize: 13 },

  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  visibilityPill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 9, paddingHorizontal: 12, borderRadius: 20,
    backgroundColor: 'rgba(251,191,36,0.10)',
    borderWidth: 1, borderColor: 'rgba(251,191,36,0.3)',
  },
  visibilityTxt: { color: '#FBBF24', fontSize: 12, fontWeight: '700' },
  changeBtn: {
    flexDirection: 'row', gap: 4, alignItems: 'center',
    paddingVertical: 9, paddingHorizontal: 12, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  changeBtnTxt: { color: '#FBBF24', fontSize: 12, fontWeight: '700' },
  leaveBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(248,113,113,0.10)',
    borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)',
  },

  // Modal
  modalBg: {
    flex: 1, justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  modalCard: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 34,
    gap: 12,
    borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  modalHandle: {
    width: 38, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center', marginBottom: 4,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: 'white' },
  modalSub: { fontSize: 12, color: '#94A3B8', marginTop: -6 },

  visibilityCard: {
    flexDirection: 'row', gap: 12, alignItems: 'center',
    padding: 12, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  visibilityCardActive: { borderColor: '#FBBF24', backgroundColor: 'rgba(251,191,36,0.10)' },
  visibilityIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  visibilityLabel: { fontSize: 14, fontWeight: '800', color: 'white' },
  visibilityDesc: { fontSize: 11.5, color: '#94A3B8', marginTop: 2, lineHeight: 15 },

  modalCancel: { paddingVertical: 12, alignItems: 'center' },
  modalCancelTxt: { color: '#94A3B8', fontSize: 14, fontWeight: '700' },
});
