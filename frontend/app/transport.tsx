import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Linking as RNLinking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { api } from '../src/constants/api';
import { useTr } from '../src/i18n/autoTr';
import PaymentSheet from '../src/components/PaymentSheet';
import type { PaymentResult } from '../src/lib/payments';

const TRANSPORT_ICONS: Record<string, string> = {
  boat: 'boat',
  night_transport: 'moon',
  shuttle: 'bus',
  bus: 'bus',
  taxi: 'car',
};

function parsePrice(s: string): { oneWay: number; roundTrip: number } {
  if (!s) return { oneWay: 0, roundTrip: 0 };
  const nums = (s.match(/(\d{1,3}(?:,\d{3})+|\d+)/g) || []).map(n => parseInt(n.replace(/,/g, ''), 10));
  if (nums.length === 0) return { oneWay: 0, roundTrip: 0 };
  if (nums.length === 1) return { oneWay: nums[0], roundTrip: nums[0] };
  return { oneWay: nums[0], roundTrip: nums[1] };
}

export default function TransportScreen() {
  const tr = useTr();
  const router = useRouter();
  const [routes, setRoutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [paySheetVisible, setPaySheetVisible] = useState(false);
  const [payRoute, setPayRoute] = useState<any>(null);
  const [payResult, setPayResult] = useState<PaymentResult | null>(null);

  const AMO_WHATSAPP = process.env.EXPO_PUBLIC_AMO_WHATSAPP || '573176481183';

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

  const openWhatsAppBooking = (route: any) => {
    const routeName = route.route_name || route.route || route.partner || route.partner_name || 'Ruta';
    const p = parsePrice(route.price || '');
    const priceText = p.roundTrip > 0 ? `$${p.roundTrip.toLocaleString()} COP ida/vuelta` : 'consultar precio';
    const msg = encodeURIComponent(
      `Hola! Quiero reservar transporte via *AMO Cartagena* 🌴\n\n`
      + `Ruta: *${routeName}*\n`
      + `Precio referencia: ${priceText}\n`
      + `Pasajeros: 1\n\n`
      + `¿Disponibilidad?\n\n---\n\n`
      + `Hi! I'd like to book transport via *AMO Cartagena* 🌴\n\n`
      + `Route: *${routeName}*\n`
      + `Ref. price: ${priceText}\n`
      + `Passengers: 1\n\n`
      + `Availability?`
    );
    RNLinking.openURL(`https://wa.me/${AMO_WHATSAPP}?text=${msg}`);
  };

  const openPaySheet = useCallback((route: any) => {
    setPayRoute(route);
    setPayResult(null);
    setPaySheetVisible(true);
  }, []);

  const handlePaySuccess = useCallback((result: PaymentResult) => {
    setPayResult(result);
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity testID="transport-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{tr('Transporte')}</Text>
          <Text style={styles.subtitle}>Lanchas, shuttles y transfers en Cartagena</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/port-tax/tickets' as any)} style={styles.ticketsBtn}>
          <Ionicons name="ticket" size={18} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : (
          routes.map(route => {
            const p = parsePrice(route.price || '');
            return (
              <View key={route.transport_id} style={styles.card} testID={`transport-${route.transport_id}`}>
                <View style={styles.cardHeader}>
                  <View style={styles.iconWrap}>
                    <Ionicons name={TRANSPORT_ICONS[route.type] as any || 'car'} size={22} color={COLORS.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.routeName}>{route.route_name || route.route || route.partner || route.partner_name}</Text>
                    <Text style={styles.routePartner}>{route.partner || route.partner_name || ''}</Text>
                  </View>
                  {(route.type === 'boat' || route.type === 'shuttle') && (
                    <View style={styles.qrBadge}>
                      <Ionicons name="logo-whatsapp" size={11} color="#22C55E" />
                      <Text style={styles.qrBadgeText}>WA</Text>
                    </View>
                  )}
                </View>

                {route.schedule && route.schedule.length > 0 && (
                  <View style={styles.scheduleSection}>
                    <View style={styles.scheduleHeader}>
                      <Ionicons name="time" size={12} color={COLORS.primary} />
                      <Text style={styles.scheduleTitle}>Salidas</Text>
                      <View style={styles.scheduleCount}>
                        <Text style={styles.scheduleCountText}>{route.schedule.length}</Text>
                      </View>
                    </View>
                    <View style={styles.scheduleList}>
                      {route.schedule.slice(0, 4).map((sc: any, i: number) => {
                        const departure = sc.departure || sc.time || '--:--';
                        const arrival = sc.arrival || '';
                        const note = sc.notes || sc.note || sc.destination || '';
                        const duration = (() => {
                          if (!departure || !arrival || departure === '--:--') return '';
                          try {
                            const [h1, m1] = departure.split(':').map(Number);
                            const [h2, m2] = arrival.split(':').map(Number);
                            const mins = (h2 * 60 + m2) - (h1 * 60 + m1);
                            if (mins <= 0) return '';
                            const h = Math.floor(mins / 60);
                            const m = mins % 60;
                            return h > 0 ? `${h}h${m ? ` ${m}m` : ''}` : `${m} min`;
                          } catch { return ''; }
                        })();
                        return (
                          <View key={i} style={styles.scheduleRow}>
                            <View style={styles.timePill}>
                              <Text style={styles.timePillText}>{departure}</Text>
                            </View>
                            {!!arrival && (
                              <>
                                <View style={styles.routeLine}>
                                  <View style={styles.routeDot} />
                                  <View style={styles.routeDash} />
                                  <Ionicons name="boat" size={11} color={COLORS.textMuted} />
                                  <View style={styles.routeDash} />
                                  <View style={styles.routeDot} />
                                </View>
                                <View style={[styles.timePill, styles.timePillArrival]}>
                                  <Text style={styles.timePillText}>{arrival}</Text>
                                </View>
                              </>
                            )}
                            {!!duration && (
                              <View style={styles.durationChip}>
                                <Text style={styles.durationChipText}>{duration}</Text>
                              </View>
                            )}
                            {!!note && !arrival && (
                              <Text style={styles.scheduleNote} numberOfLines={1}>{note}</Text>
                            )}
                          </View>
                        );
                      })}
                    </View>
                    {!!route.last_return && (
                      <View style={styles.lastReturnRow}>
                        <Ionicons name="alert-circle" size={12} color="#F59E0B" />
                        <Text style={styles.lastReturnText}>
                          Última lancha de regreso: <Text style={styles.lastReturnBold}>{route.last_return}</Text>
                        </Text>
                      </View>
                    )}
                  </View>
                )}

                <View style={styles.details}>
                  <View style={styles.detailRow}>
                    <Ionicons name="information-circle-outline" size={14} color={COLORS.textMuted} />
                    <Text style={styles.detailTextMuted}>Tarifa de lancha según operador · tasa portuaria aparte</Text>
                  </View>
                  {route.duration && (
                    <View style={styles.detailRow}>
                      <Ionicons name="time-outline" size={14} color={COLORS.primary} />
                      <Text style={styles.detailText}>{route.duration}</Text>
                    </View>
                  )}
                </View>

                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    testID={`transport-map-${route.transport_id}`}
                    style={styles.mapBtn}
                    onPress={() => openMaps(route.departure_location)}
                  >
                    <Ionicons name="navigate" size={14} color={COLORS.primary} />
                    <Text style={styles.mapBtnText}>Punto de salida</Text>
                  </TouchableOpacity>

                  {(route.type === 'boat' || route.type === 'shuttle') ? (
                    <>
                      <TouchableOpacity
                        style={styles.payBtn}
                        onPress={() => openWhatsAppBooking(route)}
                        activeOpacity={0.85}
                      >
                        <Ionicons name="logo-whatsapp" size={14} color={COLORS.white} />
                        <Text style={styles.payBtnText}>Reservar vía WhatsApp</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.simBtn}
                        onPress={() => openPaySheet(route)}
                        activeOpacity={0.85}
                      >
                        <Ionicons name="flask" size={14} color={COLORS.primary} />
                        <Text style={styles.simBtnText}>Simular pago</Text>
                      </TouchableOpacity>
                    </>
                  ) : null}
                </View>
              </View>
            );
          })
        )}
        <View style={{ height: SPACING.xxl }} />
      </ScrollView>

      {/* Payment simulation sheet */}
      <PaymentSheet
        visible={paySheetVisible}
        onClose={() => setPaySheetVisible(false)}
        amount={payRoute ? parsePrice(payRoute.price || '').roundTrip || parsePrice(payRoute.price || '').oneWay || 50000 : 50000}
        currency="COP"
        meta={{ type: 'transport', route: payRoute?.route_name || payRoute?.route || '' }}
        onSuccess={handlePaySuccess}
        title="Simular pago — Transporte"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  ticketsBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, color: COLORS.textMain, ...FONTS.bold },
  subtitle: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular },
  list: { flex: 1, paddingHorizontal: SPACING.lg },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, padding: SPACING.lg, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.md },
  iconWrap: { width: 44, height: 44, borderRadius: RADIUS.md, backgroundColor: 'rgba(217, 119, 6, 0.15)', alignItems: 'center', justifyContent: 'center' },
  routeName: { fontSize: 16, color: COLORS.textMain, ...FONTS.bold },
  routePartner: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular },
  qrBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(34,197,94,0.15)', borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(34,197,94,0.4)' },
  qrBadgeText: { fontSize: 9, color: '#22C55E', ...FONTS.bold, letterSpacing: 0.4 },
  scheduleSection: { marginBottom: SPACING.md, marginTop: SPACING.xs },
  scheduleHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SPACING.sm },
  scheduleTitle: { fontSize: 11, color: COLORS.textMain, ...FONTS.bold, letterSpacing: 1, textTransform: 'uppercase' },
  scheduleCount: {
    backgroundColor: 'rgba(217,119,6,0.18)', borderRadius: 999,
    paddingHorizontal: 8, paddingVertical: 1, minWidth: 22, alignItems: 'center',
  },
  scheduleCountText: { fontSize: 10, color: COLORS.primary, ...FONTS.bold },
  scheduleList: { gap: 8 },
  scheduleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 6, paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.primary },
  timePill: {
    backgroundColor: 'rgba(217,119,6,0.15)', paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: RADIUS.md, minWidth: 56, alignItems: 'center',
  },
  timePillArrival: { backgroundColor: 'rgba(255,255,255,0.06)' },
  timePillText: { fontSize: 13, color: COLORS.textMain, ...FONTS.bold, letterSpacing: 0.3 },
  routeLine: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  routeDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: COLORS.primary },
  routeDash: { flex: 1, height: 1, backgroundColor: 'rgba(217,119,6,0.35)' },
  durationChip: {
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 999,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  durationChipText: { fontSize: 10, color: COLORS.textMuted, ...FONTS.semibold },
  scheduleTime: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold, minWidth: 50 },
  scheduleArrow: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular },
  scheduleNote: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, flex: 1 },
  lastReturnRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: SPACING.sm,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: 'rgba(245,158,11,0.10)', borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.25)',
  },
  lastReturnText: { flex: 1, fontSize: 11, color: '#F59E0B', ...FONTS.regular },
  lastReturnBold: { ...FONTS.bold },
  details: { gap: 6, marginBottom: SPACING.md },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  detailText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, flex: 1, lineHeight: 20 },
  detailTextMuted: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular, flex: 1, lineHeight: 18, fontStyle: 'italic' },
  actionsRow: { flexDirection: 'row', gap: SPACING.sm, flexWrap: 'wrap' },
  mapBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.primary },
  mapBtnText: { fontSize: 12, color: COLORS.primary, ...FONTS.semibold },
  payBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: RADIUS.full, backgroundColor: COLORS.primary },
  payBtnText: { fontSize: 12, color: COLORS.white, ...FONTS.bold },
  simBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 12, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.primary, backgroundColor: 'rgba(212,175,55,0.08)' },
  simBtnText: { fontSize: 11, color: COLORS.primary, ...FONTS.semibold },

});
