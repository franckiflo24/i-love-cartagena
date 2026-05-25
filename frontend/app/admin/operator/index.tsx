import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, Alert, Share } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../../../src/constants/theme';
import { api } from '../../../src/constants/api';

type PartnerRow = {
  partner_id: string;
  name: string;
  category?: string;
  tier?: string;
  owner_email?: string;
  status?: string;
  is_public?: boolean;
  onboarding_percent?: number;
  activation_expires_at?: string;
  membership_plan?: string;
};

type Summary = { invited: number; active_pending_approval: number; approved: number; suspended: number };

const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  invited:                  { label: 'Invitado',  color: '#F59E0B', icon: 'paper-plane' },
  active_pending_approval:  { label: 'Por aprobar', color: '#3B82F6', icon: 'hourglass' },
  approved:                 { label: 'Aprobado',  color: '#22C55E', icon: 'checkmark-circle' },
  suspended:                { label: 'Suspendido', color: '#EF4444', icon: 'pause-circle' },
};

function classify(p: PartnerRow): keyof typeof STATUS_META {
  if (p.status === 'invited') return 'invited';
  if (p.status === 'suspended') return 'suspended';
  if (p.is_public) return 'approved';
  return 'active_pending_approval';
}

export default function OperatorIndex() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [partners, setPartners] = useState<PartnerRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState<'all' | 'invited' | 'active_pending_approval' | 'approved' | 'suspended'>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (tok: string) => {
    try {
      const data = await api.get('/admin/operator/partners', { headers: { Authorization: `Bearer ${tok}` } });
      setPartners(data?.partners || []);
      setSummary(data?.summary || null);
    } catch (e: any) {
      if (String(e?.message || '').includes('401')) {
        await AsyncStorage.removeItem('admin_operator_token');
        router.replace('/admin/operator-login' as any);
      }
    }
    setLoading(false);
    setRefreshing(false);
  }, [router]);

  useFocusEffect(useCallback(() => {
    (async () => {
      const tok = await AsyncStorage.getItem('admin_operator_token');
      if (!tok) {
        router.replace('/admin/operator-login' as any);
        return;
      }
      setToken(tok);
      fetchData(tok);
    })();
  }, [router, fetchData]));

  const onRefresh = () => {
    if (!token) return;
    setRefreshing(true);
    fetchData(token);
  };

  const setApproval = async (p: PartnerRow, action: 'approve' | 'suspend' | 'reactivate') => {
    if (!token) return;
    try {
      await api.patch(`/admin/operator/partners/${p.partner_id}/approval`, { action }, { headers: { Authorization: `Bearer ${token}` } });
      Alert.alert('Hecho', `${p.name} → ${action === 'approve' ? 'aprobado' : action === 'suspend' ? 'suspendido' : 'reactivado'}`);
      fetchData(token);
    } catch {
      Alert.alert('Error', 'No se pudo actualizar.');
    }
  };

  const reInvite = async (p: PartnerRow) => {
    if (!token) return;
    try {
      const data = await api.post(`/admin/operator/partners/${p.partner_id}/invite`, {}, { headers: { Authorization: `Bearer ${token}` } });
      try {
        await Share.share({ message: data?.whatsapp_message || data?.activation_url || '' });
      } catch { /* user cancelled */ }
    } catch {
      Alert.alert('Error', 'No se pudo generar invitación.');
    }
  };

  const logout = async () => {
    await AsyncStorage.removeItem('admin_operator_token');
    router.replace('/admin/operator-login' as any);
  };

  const filtered = partners.filter(p => filter === 'all' ? true : classify(p) === filter);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Admin Operator 👑</Text>
          <Text style={styles.subtitle}>Gestión de partners</Text>
        </View>
        <TouchableOpacity onPress={logout} style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={18} color={COLORS.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Summary cards (clickable filters) */}
      <View style={styles.summaryRow}>
        {([
          { k: 'invited',                  label: 'Invitados',  v: summary?.invited ?? 0 },
          { k: 'active_pending_approval',  label: 'Por aprobar', v: summary?.active_pending_approval ?? 0 },
          { k: 'approved',                 label: 'Aprobados',  v: summary?.approved ?? 0 },
          { k: 'suspended',                label: 'Suspendidos',v: summary?.suspended ?? 0 },
        ] as const).map(s => {
          const meta = STATUS_META[s.k];
          const isActive = filter === s.k;
          return (
            <TouchableOpacity
              key={s.k}
              style={[styles.sumCard, isActive && { borderColor: meta.color, backgroundColor: meta.color + '12' }]}
              onPress={() => setFilter(isActive ? 'all' : s.k)}
              activeOpacity={0.85}
            >
              <Ionicons name={meta.icon} size={16} color={meta.color} />
              <Text style={[styles.sumValue, { color: meta.color }]}>{s.v}</Text>
              <Text style={styles.sumLabel} numberOfLines={1}>{s.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* + New partner CTA */}
      <TouchableOpacity testID="new-partner-btn" style={styles.newPartnerBtn} onPress={() => router.push('/admin/operator/new' as any)} activeOpacity={0.85}>
        <Ionicons name="add-circle" size={18} color="#FFF" />
        <Text style={styles.newPartnerText}>Invitar nuevo partner</Text>
      </TouchableOpacity>

      <ScrollView
        contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 50 }} />
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="search-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>Sin partners en este filtro</Text>
          </View>
        ) : filtered.map(p => {
          const cls = classify(p);
          const meta = STATUS_META[cls];
          const pct = p.onboarding_percent ?? 0;
          return (
            <View key={p.partner_id} style={styles.partnerCard}>
              <View style={styles.partnerHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.partnerName} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.partnerMeta} numberOfLines={1}>
                    {(p.category || 'sin categoría')} · {p.tier || 'popular'} · {p.membership_plan || 'free'}
                  </Text>
                  {!!p.owner_email && <Text style={styles.partnerEmail} numberOfLines={1}>{p.owner_email}</Text>}
                </View>
                <View style={[styles.statusBadge, { backgroundColor: meta.color + '22', borderColor: meta.color }]}>
                  <Ionicons name={meta.icon} size={11} color={meta.color} />
                  <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                </View>
              </View>

              {/* Progress bar */}
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: pct >= 70 ? '#22C55E' : pct >= 40 ? '#F59E0B' : '#EF4444' }]} />
              </View>
              <Text style={styles.progressText}>{pct}% onboarding</Text>

              {/* Action row */}
              <View style={styles.actionRow}>
                {cls === 'invited' && (
                  <TouchableOpacity style={styles.actionBtn} onPress={() => reInvite(p)} activeOpacity={0.85}>
                    <Ionicons name="share-social" size={13} color={COLORS.primary} />
                    <Text style={styles.actionText}>Compartir link</Text>
                  </TouchableOpacity>
                )}
                {cls === 'active_pending_approval' && (
                  <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#22C55E22', borderColor: '#22C55E' }]} onPress={() => setApproval(p, 'approve')} activeOpacity={0.85}>
                    <Ionicons name="checkmark" size={13} color="#22C55E" />
                    <Text style={[styles.actionText, { color: '#22C55E' }]}>Aprobar</Text>
                  </TouchableOpacity>
                )}
                {cls === 'approved' && (
                  <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#EF444422', borderColor: '#EF4444' }]} onPress={() => setApproval(p, 'suspend')} activeOpacity={0.85}>
                    <Ionicons name="pause" size={13} color="#EF4444" />
                    <Text style={[styles.actionText, { color: '#EF4444' }]}>Suspender</Text>
                  </TouchableOpacity>
                )}
                {cls === 'suspended' && (
                  <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#22C55E22', borderColor: '#22C55E' }]} onPress={() => setApproval(p, 'reactivate')} activeOpacity={0.85}>
                    <Ionicons name="play" size={13} color="#22C55E" />
                    <Text style={[styles.actionText, { color: '#22C55E' }]}>Reactivar</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
  title: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold },
  subtitle: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular },
  logoutBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  summaryRow: { flexDirection: 'row', gap: 6, paddingHorizontal: SPACING.lg, marginTop: SPACING.md },
  sumCard: { flex: 1, alignItems: 'center', padding: 8, gap: 2, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  sumValue: { fontSize: 18, ...FONTS.bold },
  sumLabel: { fontSize: 9, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 0.3, textTransform: 'uppercase' },
  newPartnerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginHorizontal: SPACING.lg, marginTop: SPACING.md, backgroundColor: COLORS.primary, paddingVertical: 12, borderRadius: RADIUS.full },
  newPartnerText: { fontSize: 14, color: '#FFF', ...FONTS.bold },
  partnerCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, marginBottom: SPACING.sm, gap: 6 },
  partnerHeader: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-start' },
  partnerName: { fontSize: 15, color: COLORS.textMain, ...FONTS.bold },
  partnerMeta: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, textTransform: 'capitalize' },
  partnerEmail: { fontSize: 11, color: COLORS.primary, ...FONTS.medium, marginTop: 2 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: RADIUS.full, borderWidth: 1 },
  statusText: { fontSize: 10, ...FONTS.bold, letterSpacing: 0.3 },
  progressTrack: { height: 5, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 3, marginTop: 6, overflow: 'hidden' },
  progressFill: { height: 5, borderRadius: 3 },
  progressText: { fontSize: 10, color: COLORS.textMuted, ...FONTS.semibold },
  actionRow: { flexDirection: 'row', gap: 6, marginTop: 6 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.full, backgroundColor: `${COLORS.primary}15`, borderWidth: 1, borderColor: `${COLORS.primary}40` },
  actionText: { fontSize: 11, color: COLORS.primary, ...FONTS.bold },
  empty: { alignItems: 'center', marginTop: 60, gap: SPACING.sm },
  emptyText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.semibold },
});
