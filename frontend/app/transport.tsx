import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Linking as RNLinking } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { api } from '../src/constants/api';

const TRANSPORT_ICONS: Record<string, string> = {
  boat: 'boat',
  night_transport: 'moon',
  shuttle: 'bus',
  bus: 'bus',
  taxi: 'car',
};

export default function TransportScreen() {
  const router = useRouter();
  const [routes, setRoutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.get('/transport');
        setRoutes(data);
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    load();
  }, []);

  const openMaps = (loc: any) => {
    if (!loc) return;
    RNLinking.openURL(`https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity testID="transport-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>Transporte</Text>
          <Text style={styles.subtitle}>Movilidad oficial Viva Cartagena</Text>
        </View>
      </View>

      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : (
          routes.map(route => (
            <View key={route.transport_id} style={styles.card} testID={`transport-${route.transport_id}`}>
              <View style={styles.cardHeader}>
                <View style={styles.iconWrap}>
                  <Ionicons name={TRANSPORT_ICONS[route.type] as any || 'car'} size={22} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.routeName}>{route.route}</Text>
                  <Text style={styles.routePartner}>{route.partner_name}</Text>
                </View>
              </View>

              <View style={styles.scheduleSection}>
                <Text style={styles.scheduleTitle}>Horarios</Text>
                {route.schedule.map((s: any, i: number) => (
                  <View key={i} style={styles.scheduleRow}>
                    <View style={styles.dot} />
                    <Text style={styles.scheduleTime}>{s.departure}</Text>
                    {s.arrival ? <Text style={styles.scheduleArrow}>→ {s.arrival}</Text> : null}
                    <Text style={styles.scheduleNote}>{s.notes}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.details}>
                <View style={styles.detailRow}>
                  <Ionicons name="location-outline" size={14} color={COLORS.textMuted} />
                  <Text style={styles.detailText}>{route.departure_point}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Ionicons name="cash-outline" size={14} color={COLORS.textMuted} />
                  <Text style={styles.detailText}>{route.price}</Text>
                </View>
                {route.last_return && (
                  <View style={styles.detailRow}>
                    <Ionicons name="alert-circle-outline" size={14} color={COLORS.primary} />
                    <Text style={[styles.detailText, { color: COLORS.primary }]}>Última salida: {route.last_return}</Text>
                  </View>
                )}
                {route.notes && (
                  <View style={styles.detailRow}>
                    <Ionicons name="information-circle-outline" size={14} color={COLORS.textMuted} />
                    <Text style={styles.detailText}>{route.notes}</Text>
                  </View>
                )}
              </View>

              <TouchableOpacity
                testID={`transport-map-${route.transport_id}`}
                style={styles.mapBtn}
                onPress={() => openMaps(route.departure_location)}
              >
                <Ionicons name="navigate" size={14} color={COLORS.primary} />
                <Text style={styles.mapBtnText}>Ver punto de salida</Text>
              </TouchableOpacity>
            </View>
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
  subtitle: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular },
  list: { flex: 1, paddingHorizontal: SPACING.lg },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, padding: SPACING.lg, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.md },
  iconWrap: { width: 44, height: 44, borderRadius: RADIUS.md, backgroundColor: 'rgba(217, 119, 6, 0.15)', alignItems: 'center', justifyContent: 'center' },
  routeName: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold },
  routePartner: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular },
  scheduleSection: { marginBottom: SPACING.md },
  scheduleTitle: { fontSize: 13, color: COLORS.textMuted, ...FONTS.semibold, marginBottom: SPACING.sm, letterSpacing: 1, textTransform: 'uppercase' },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.primary },
  scheduleTime: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold, minWidth: 50 },
  scheduleArrow: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular },
  scheduleNote: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, flex: 1 },
  details: { gap: 6, marginBottom: SPACING.md },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  detailText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, flex: 1, lineHeight: 20 },
  mapBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.primary },
  mapBtnText: { fontSize: 13, color: COLORS.primary, ...FONTS.semibold },
});
