import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { api } from '../src/constants/api';
import { useAuth } from '../src/context/AuthContext';

const NOTIF_ICONS: Record<string, string> = {
  general: 'megaphone',
  event_reminder: 'calendar',
  transport: 'boat',
  venue_update: 'location',
};

export default function NotificationsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        const data = await api.get('/notifications');
        setNotifications(data);
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    load();
  }, [user]);

  const markRead = async (id: string) => {
    try {
      await api.put(`/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.notification_id === id ? { ...n, is_read: true } : n));
    } catch (e) { console.error(e); }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity testID="notif-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={styles.title}>Notificaciones</Text>
      </View>

      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : !user ? (
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>Inicia sesión para ver notificaciones</Text>
          </View>
        ) : notifications.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="notifications-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>No hay notificaciones</Text>
          </View>
        ) : (
          notifications.map(notif => (
            <TouchableOpacity
              key={notif.notification_id}
              testID={`notif-${notif.notification_id}`}
              style={[styles.notifCard, !notif.is_read && styles.notifUnread]}
              onPress={() => {
                markRead(notif.notification_id);
                if (notif.event_id) router.push(`/event/${notif.event_id}`);
              }}
              activeOpacity={0.7}
            >
              <View style={styles.notifIcon}>
                <Ionicons name={NOTIF_ICONS[notif.type] as any || 'notifications'} size={20} color={COLORS.primary} />
              </View>
              <View style={styles.notifContent}>
                <Text style={styles.notifTitle}>{notif.title}</Text>
                <Text style={styles.notifMessage} numberOfLines={2}>{notif.message}</Text>
              </View>
              {!notif.is_read && <View style={styles.unreadDot} />}
            </TouchableOpacity>
          ))
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
  title: { fontSize: 24, color: COLORS.textMain, ...FONTS.bold },
  list: { flex: 1, paddingHorizontal: SPACING.lg },
  notifCard: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.lg, marginBottom: SPACING.sm, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  notifUnread: { borderColor: 'rgba(217, 119, 6, 0.3)', backgroundColor: 'rgba(217, 119, 6, 0.05)' },
  notifIcon: { width: 44, height: 44, borderRadius: RADIUS.md, backgroundColor: 'rgba(217, 119, 6, 0.15)', alignItems: 'center', justifyContent: 'center' },
  notifContent: { flex: 1 },
  notifTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  notifMessage: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, marginTop: 2, lineHeight: 18 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.primary },
  empty: { alignItems: 'center', marginTop: 60, gap: SPACING.md },
  emptyText: { fontSize: 15, color: COLORS.textMuted, ...FONTS.regular },
});
