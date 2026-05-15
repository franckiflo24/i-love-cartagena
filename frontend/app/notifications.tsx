import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { api } from '../src/constants/api';
import { useAuth } from '../src/context/AuthContext';
import { useTr } from '../src/i18n/autoTr';

type NotifMeta = {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
};

const NOTIF_META: Record<string, NotifMeta> = {
  reservation_created:        { icon: 'paper-plane',     color: '#F59E0B', bg: 'rgba(245,158,11,0.15)' },
  reservation_confirmed:      { icon: 'checkmark-circle', color: '#22C55E', bg: 'rgba(34,197,94,0.15)' },
  reservation_rejected:       { icon: 'close-circle',    color: '#EF4444', bg: 'rgba(239,68,68,0.15)' },
  reservation_cancelled:      { icon: 'remove-circle',   color: '#94A3B8', bg: 'rgba(148,163,184,0.15)' },
  reservation_completed:      { icon: 'sparkles',        color: '#22C55E', bg: 'rgba(34,197,94,0.15)' },
  event_reminder:             { icon: 'calendar',        color: '#A855F7', bg: 'rgba(168,85,247,0.15)' },
  transport:                  { icon: 'boat',            color: '#06B6D4', bg: 'rgba(6,182,212,0.15)' },
  venue_update:               { icon: 'location',        color: '#F97316', bg: 'rgba(249,115,22,0.15)' },
  general:                    { icon: 'megaphone',       color: COLORS.primary, bg: `${COLORS.primary}22` },
};

type Notification = {
  notification_id: string;
  title?: string;
  body?: string;
  message?: string; // legacy
  kind?: string;
  type?: string; // legacy
  is_read?: boolean;
  created_at?: string;
  ref?: {
    reservation_id?: string;
    partner_id?: string;
    event_id?: string;
    [k: string]: any;
  };
  event_id?: string; // legacy
};

function timeAgo(iso?: string, tr?: (s: string) => string): string {
  if (!iso) return '';
  const _t = tr || ((s: string) => s);
  try {
    const d = new Date(iso);
    const diff = Math.max(0, Date.now() - d.getTime());
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return _t('Ahora mismo');
    if (mins < 60) return `${mins} ${_t('min')}`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} ${_t('h')}`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days} ${_t('d')}`;
    return d.toLocaleDateString();
  } catch {
    return '';
  }
}

export default function NotificationsScreen() {
  const tr = useTr();
  const router = useRouter();
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      const data = await api.get('/notifications');
      setNotifications(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
    setRefreshing(false);
  }, [user]);

  // Reload every time the screen comes into focus (so new confirmations show up immediately)
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const markRead = async (id: string) => {
    try {
      await api.put(`/notifications/${id}/read`);
      setNotifications(prev =>
        prev.map(n => (n.notification_id === id ? { ...n, is_read: true } : n))
      );
    } catch (e) {
      console.error(e);
    }
  };

  const markAllRead = async () => {
    const unread = notifications.filter(n => !n.is_read);
    if (unread.length === 0) return;
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    await Promise.all(unread.map(n => api.put(`/notifications/${n.notification_id}/read`).catch(() => null)));
  };

  const handleTap = (n: Notification) => {
    markRead(n.notification_id);
    const ref = n.ref || {};
    const kind = n.kind || n.type || '';
    // Reservation-related → open Favoritos > Reservas tab OR full reservations page
    if (kind.startsWith('reservation') || ref.reservation_id) {
      router.push('/reservations' as any);
      return;
    }
    if (ref.event_id || n.event_id) {
      router.push(`/event/${ref.event_id || n.event_id}` as any);
      return;
    }
    if (ref.partner_id) {
      router.push(`/partner/${ref.partner_id}` as any);
    }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity testID="notif-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{tr('Notificaciones')}</Text>
          {unreadCount > 0 ? (
            <Text style={styles.subtitle}>{unreadCount} {unreadCount === 1 ? tr('sin leer') : tr('sin leer')}</Text>
          ) : null}
        </View>
        {unreadCount > 0 && (
          <TouchableOpacity onPress={markAllRead} style={styles.markAllBtn}>
            <Ionicons name="checkmark-done" size={14} color={COLORS.primary} />
            <Text style={styles.markAllText}>{tr('Marcar leídas')}</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        style={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : !user ? (
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>{tr('Inicia sesión para ver notificaciones')}</Text>
          </View>
        ) : notifications.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="notifications-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>{tr('No hay notificaciones')}</Text>
            <Text style={styles.emptyHint}>{tr('Aquí verás confirmaciones de reservas, eventos y actualizaciones de partners.')}</Text>
          </View>
        ) : (
          notifications.map(notif => {
            const kind = notif.kind || notif.type || 'general';
            const meta = NOTIF_META[kind] || NOTIF_META.general;
            const body = notif.body || notif.message || '';
            return (
              <TouchableOpacity
                key={notif.notification_id}
                testID={`notif-${notif.notification_id}`}
                style={[styles.notifCard, !notif.is_read && { borderColor: meta.color, backgroundColor: meta.bg }]}
                onPress={() => handleTap(notif)}
                activeOpacity={0.75}
              >
                <View style={[styles.notifIcon, { backgroundColor: meta.bg }]}>
                  <Ionicons name={meta.icon} size={20} color={meta.color} />
                </View>
                <View style={styles.notifContent}>
                  <View style={styles.notifTopRow}>
                    <Text style={styles.notifTitle} numberOfLines={1}>{notif.title || tr('Notificación')}</Text>
                    {notif.created_at ? (
                      <Text style={styles.notifTime}>{timeAgo(notif.created_at, tr)}</Text>
                    ) : null}
                  </View>
                  {!!body && <Text style={styles.notifMessage} numberOfLines={3}>{body}</Text>}
                  {(kind.startsWith('reservation') || notif.ref?.reservation_id) && (
                    <View style={[styles.actionPill, { backgroundColor: meta.bg, borderColor: meta.color }]}>
                      <Ionicons name="open-outline" size={11} color={meta.color} />
                      <Text style={[styles.actionPillText, { color: meta.color }]}>{tr('Ver mi reserva')}</Text>
                    </View>
                  )}
                </View>
                {!notif.is_read && <View style={[styles.unreadDot, { backgroundColor: meta.color }]} />}
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold },
  subtitle: { fontSize: 11, color: COLORS.primary, ...FONTS.semibold, marginTop: 2 },
  markAllBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: RADIUS.full,
    backgroundColor: `${COLORS.primary}15`,
    borderWidth: 1, borderColor: `${COLORS.primary}40`,
  },
  markAllText: { fontSize: 11, color: COLORS.primary, ...FONTS.bold },

  list: { flex: 1, paddingHorizontal: SPACING.lg },
  notifCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.md,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    marginBottom: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  notifIcon: {
    width: 42, height: 42,
    borderRadius: RADIUS.md,
    alignItems: 'center', justifyContent: 'center',
  },
  notifContent: { flex: 1, gap: 4 },
  notifTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  notifTitle: { flex: 1, fontSize: 14, color: COLORS.textMain, ...FONTS.bold },
  notifTime: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium },
  notifMessage: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, lineHeight: 17 },
  actionPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    marginTop: 6,
  },
  actionPillText: { fontSize: 10, ...FONTS.bold, letterSpacing: 0.3 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },

  empty: { alignItems: 'center', marginTop: 60, gap: SPACING.sm, paddingHorizontal: SPACING.lg },
  emptyText: { fontSize: 15, color: COLORS.textMuted, ...FONTS.semibold },
  emptyHint: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center', lineHeight: 18 },
});
