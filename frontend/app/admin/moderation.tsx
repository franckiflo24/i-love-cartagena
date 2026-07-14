import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { SafeImage } from '../../src/components/SafeImage';
import { COLORS, SPACING, RADIUS, FONTS, TIER_COLORS, Tier } from '../../src/constants/theme';
import { api } from '../../src/constants/api';
import { TierBadge } from '../../src/components/TierBadge';
import { useAuth } from '../../src/context/AuthContext';

const CAT_LABELS: Record<string, string> = {
  gastronomy: 'Gastronomía', music: 'Música', party: 'Fiesta',
  wellness: 'Wellness', art: 'Arte & Cultura', popup: 'Pop-up',
};

type Stats = {
  pending: number; approved: number; rejected: number;
  auto_corrected_categories: number; auto_improved_descriptions: number;
  unread_notifications: number;
};

export default function AdminModeration() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [pending, setPending] = useState<any[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Auth guard: redirect non-admin users
  useEffect(() => {
    if (!authLoading && (!user || !user.is_admin)) {
      router.replace('/');
    }
  }, [user, authLoading, router]);

  const load = useCallback(async () => {
    try {
      const [pendingData, statsData] = await Promise.all([
        api.get('/admin/moderation/pending'),
        api.get('/admin/moderation/stats'),
      ]);
      setPending(pendingData);
      setStats(statsData);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const handleApprove = async (eventId: string, title: string) => {
    Alert.alert('Aprobar evento', `¿Publicar "${title}" en la agenda?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Aprobar', onPress: async () => {
        try {
          await api.post(`/admin/moderation/${eventId}/approve`);
          // Optimistically remove from pending list
          setPending(prev => prev.filter((e: any) => (e.event_id || e.id) !== eventId));
          if (stats) setStats({ ...stats, pending: Math.max(0, stats.pending - 1), approved: stats.approved + 1 });
        }
        catch (e: any) { Alert.alert('Error', e?.message); }
      } },
    ]);
  };

  const handleReject = (eventId: string, title: string) => {
    Alert.alert('Rechazar evento', `¿Rechazar "${title}"? El partner verá el rechazo en su dashboard.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Rechazar', style: 'destructive', onPress: async () => {
        try {
          await api.post(`/admin/moderation/${eventId}/reject`, { reason: 'Contenido no apto para la agenda' });
          // Optimistically remove from pending list
          setPending(prev => prev.filter((e: any) => (e.event_id || e.id) !== eventId));
          if (stats) setStats({ ...stats, pending: Math.max(0, stats.pending - 1), rejected: stats.rejected + 1 });
        }
        catch (e: any) { Alert.alert('Error', e?.message); }
      } },
    ]);
  };

  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  // Block render for non-admin users
  if (authLoading || !user?.is_admin) {
    return <SafeAreaView style={styles.container}><ActivityIndicator size="large" color={COLORS.primary} style={{ flex: 1 }} /></SafeAreaView>;
  }

  if (loading) {
    return <SafeAreaView style={styles.container}><ActivityIndicator size="large" color={COLORS.primary} style={{ flex: 1 }} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="close" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Ionicons name="shield-checkmark" size={16} color={COLORS.primary} />
          <Text style={styles.headerTitle}>Moderación IA</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />} contentContainerStyle={{ paddingBottom: 80 }}>
        {/* AI Hero */}
        <View style={styles.aiHero}>
          <View style={styles.aiIcon}>
            <Ionicons name="sparkles" size={24} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.aiTitle}>IA cuidando tu agenda</Text>
            <Text style={styles.aiDesc}>Cada evento publicado por partners pasa por moderación automática. Solo revisas lo dudoso.</Text>
          </View>
        </View>

        {/* Stats */}
        {stats && (
          <View style={styles.statsGrid}>
            <View style={[styles.statCard, { borderColor: 'rgba(245,158,11,0.5)' }]}>
              <Text style={[styles.statValue, { color: '#F59E0B' }]}>{stats.pending}</Text>
              <Text style={styles.statLabel}>Por revisar</Text>
            </View>
            <View style={[styles.statCard, { borderColor: 'rgba(34,197,94,0.5)' }]}>
              <Text style={[styles.statValue, { color: '#22C55E' }]}>{stats.approved}</Text>
              <Text style={styles.statLabel}>Aprobados</Text>
            </View>
            <View style={[styles.statCard, { borderColor: 'rgba(239,68,68,0.5)' }]}>
              <Text style={[styles.statValue, { color: '#EF4444' }]}>{stats.rejected}</Text>
              <Text style={styles.statLabel}>Rechazados</Text>
            </View>
          </View>
        )}

        {/* AI Achievements */}
        {stats && (stats.auto_corrected_categories > 0 || stats.auto_improved_descriptions > 0) && (
          <View style={styles.achievements}>
            <Text style={styles.achievementsTitle}>🤖 La IA ya hizo</Text>
            {stats.auto_corrected_categories > 0 && (
              <View style={styles.achievementRow}>
                <Ionicons name="git-branch" size={14} color={COLORS.primary} />
                <Text style={styles.achievementText}>
                  <Text style={styles.achievementBold}>{stats.auto_corrected_categories}</Text> categoría{stats.auto_corrected_categories > 1 ? 's corregidas' : ' corregida'} automáticamente
                </Text>
              </View>
            )}
            {stats.auto_improved_descriptions > 0 && (
              <View style={styles.achievementRow}>
                <Ionicons name="create" size={14} color={COLORS.primary} />
                <Text style={styles.achievementText}>
                  <Text style={styles.achievementBold}>{stats.auto_improved_descriptions}</Text> descripcion{stats.auto_improved_descriptions > 1 ? 'es mejoradas' : ' mejorada'} por la IA
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Pending list */}
        <Text style={styles.sectionTitle}>Pendientes de tu revisión</Text>
        {pending.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="checkmark-done-circle" size={48} color="#22C55E" />
            <Text style={styles.emptyTitle}>¡Todo en orden!</Text>
            <Text style={styles.emptyText}>La IA está aprobando los eventos automáticamente. Te avisaremos cuando algo necesite tu atención.</Text>
          </View>
        ) : (
          pending.map((ev: any) => {
            const tierColors = ev.partner_tier ? TIER_COLORS[ev.partner_tier as Tier] : null;
            const isRejected = ev.moderation_status === 'rejected';
            return (
              <View key={ev.event_id} style={[styles.card, isRejected && { borderColor: 'rgba(239,68,68,0.4)' }]}>
                {/* Status badge */}
                <View style={[styles.statusBar, isRejected ? styles.rejectedBar : styles.pendingBar]}>
                  <Ionicons name={isRejected ? 'close-circle' : 'time'} size={14} color={isRejected ? '#EF4444' : '#F59E0B'} />
                  <Text style={[styles.statusText, { color: isRejected ? '#EF4444' : '#F59E0B' }]}>
                    {isRejected ? 'RECHAZADO POR IA' : 'NECESITA REVISIÓN'}
                  </Text>
                  <View style={styles.scoreBubble}>
                    <Text style={styles.scoreText}>Score: {ev.moderation_score}/100</Text>
                  </View>
                </View>

                {/* Partner info */}
                <View style={styles.partnerRow}>
                  {ev.partner_image ? <SafeImage uri={ev.partner_image} style={styles.partnerLogo} resizeMode="cover" /> : null}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.partnerName}>{ev.partner_name}</Text>
                    <View style={{ flexDirection: 'row', gap: 4, marginTop: 2 }}>
                      <TierBadge tier={ev.partner_tier} size="xs" />
                      <View style={styles.catChip}>
                        <Text style={styles.catChipText}>{CAT_LABELS[ev.category] || ev.category}</Text>
                      </View>
                    </View>
                  </View>
                </View>

                {/* Event */}
                <Text style={styles.eventTitle}>{ev.title}</Text>
                <Text style={styles.eventDate}>{ev.date} · {ev.start_time} – {ev.end_time}</Text>
                <Text style={styles.eventDesc} numberOfLines={4}>{ev.description}</Text>

                {/* AI verdict */}
                <View style={styles.aiBox}>
                  <Ionicons name="sparkles" size={14} color={COLORS.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.aiBoxLabel}>Análisis IA</Text>
                    <Text style={styles.aiBoxText}>{ev.moderation_reason}</Text>
                    {ev.moderation_issues?.length > 0 && (
                      <Text style={styles.aiBoxIssues}>⚠ {ev.moderation_issues.join(', ')}</Text>
                    )}
                  </View>
                </View>

                {/* Actions */}
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.rejectBtn} onPress={() => handleReject(ev.event_id, ev.title)}>
                    <Ionicons name="close" size={16} color="#EF4444" />
                    <Text style={styles.rejectText}>Rechazar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.approveBtn} onPress={() => handleApprove(ev.event_id, ev.title)}>
                    <Ionicons name="checkmark" size={16} color={COLORS.white} />
                    <Text style={styles.approveText}>Aprobar y publicar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold },

  aiHero: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.md, margin: SPACING.lg, marginBottom: SPACING.sm, backgroundColor: 'rgba(217,119,6,0.1)', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(217,119,6,0.4)' },
  aiIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(217,119,6,0.2)' },
  aiTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold },
  aiDesc: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2, lineHeight: 16 },

  statsGrid: { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.lg, marginBottom: SPACING.md },
  statCard: { flex: 1, alignItems: 'center', padding: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1 },
  statValue: { fontSize: 24, ...FONTS.bold },
  statLabel: { fontSize: 10, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 2 },

  achievements: { padding: SPACING.md, marginHorizontal: SPACING.lg, marginBottom: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  achievementsTitle: { fontSize: 12, color: COLORS.textMuted, ...FONTS.bold, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: SPACING.xs },
  achievementRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  achievementText: { fontSize: 13, color: COLORS.textMain, ...FONTS.regular },
  achievementBold: { ...FONTS.bold, color: COLORS.primary },

  sectionTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold, marginHorizontal: SPACING.lg, marginVertical: SPACING.sm, letterSpacing: 0.3 },

  empty: { alignItems: 'center', padding: SPACING.xl, marginHorizontal: SPACING.lg, gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed' },
  emptyTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold },
  emptyText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', lineHeight: 18 },

  card: { marginHorizontal: SPACING.lg, marginBottom: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(245,158,11,0.4)', overflow: 'hidden' },
  statusBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SPACING.md, paddingVertical: 8 },
  pendingBar: { backgroundColor: 'rgba(245,158,11,0.12)' },
  rejectedBar: { backgroundColor: 'rgba(239,68,68,0.12)' },
  statusText: { fontSize: 11, ...FONTS.bold, letterSpacing: 0.8, flex: 1 },
  scoreBubble: { backgroundColor: 'rgba(0,0,0,0.3)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.full },
  scoreText: { fontSize: 10, color: COLORS.textMuted, ...FONTS.semibold },

  partnerRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.md, paddingBottom: 0 },
  partnerLogo: { width: 40, height: 40, borderRadius: 20 },
  partnerName: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  catChip: { backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.full },
  catChipText: { fontSize: 10, color: COLORS.textMuted, ...FONTS.semibold },

  eventTitle: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold, marginHorizontal: SPACING.md, marginTop: SPACING.sm },
  eventDate: { fontSize: 12, color: COLORS.primary, ...FONTS.semibold, marginHorizontal: SPACING.md, marginTop: 2 },
  eventDesc: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 19, marginHorizontal: SPACING.md, marginTop: SPACING.xs },

  aiBox: { flexDirection: 'row', gap: SPACING.sm, margin: SPACING.md, padding: SPACING.sm, backgroundColor: 'rgba(217,119,6,0.08)', borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(217,119,6,0.3)' },
  aiBoxLabel: { fontSize: 10, color: COLORS.primary, ...FONTS.bold, letterSpacing: 0.5, textTransform: 'uppercase' },
  aiBoxText: { fontSize: 12, color: COLORS.textMain, ...FONTS.regular, marginTop: 2, lineHeight: 17 },
  aiBoxIssues: { fontSize: 11, color: '#EF4444', ...FONTS.semibold, marginTop: 4 },

  actions: { flexDirection: 'row', gap: SPACING.sm, padding: SPACING.md, paddingTop: 0 },
  rejectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: 14, borderRadius: RADIUS.full, borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)' },
  rejectText: { fontSize: 12, color: '#EF4444', ...FONTS.semibold },
  approveBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 10, borderRadius: RADIUS.full, backgroundColor: '#22C55E' },
  approveText: { fontSize: 13, color: COLORS.white, ...FONTS.bold },
});
