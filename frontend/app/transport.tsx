import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Linking as RNLinking, Modal, Image, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { api } from '../src/constants/api';
import { useTr } from '../src/i18n/autoTr';

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

  // Buy modal state
  const [buyModalRoute, setBuyModalRoute] = useState<any | null>(null);
  const [tripType, setTripType] = useState<'one_way' | 'round_trip'>('round_trip');
  const [passengers, setPassengers] = useState(1);
  const [paying, setPaying] = useState(false);
  const [resultTicket, setResultTicket] = useState<any | null>(null);

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

  const openBuyModal = (route: any) => {
    setBuyModalRoute(route);
    setTripType('round_trip');
    setPassengers(1);
    setResultTicket(null);
  };

  const closeAll = () => { setBuyModalRoute(null); setResultTicket(null); };

  const handlePay = async () => {
    if (!buyModalRoute) return;
    setPaying(true);
    try {
      const userRaw = await AsyncStorage.getItem('user_data');
      const user = userRaw ? JSON.parse(userRaw) : null;
      const today = new Date().toISOString().slice(0, 10);
      const ticket = await api.post(`/transport/${buyModalRoute.transport_id}/buy`, {
        user_id: user?.user_id || `guest_${Date.now()}`,
        user_name: user?.name || 'Visitante',
        user_email: user?.email,
        trip_type: tripType,
        passengers,
        departure_date: today,
        port_tax_included: true,
      });
      setResultTicket(ticket);
    } catch (e: any) {
      Alert.alert('Error en el pago', e?.message || 'Intenta de nuevo más tarde.');
    }
    setPaying(false);
  };

  // Compute totals for the modal
  const prices = buyModalRoute ? parsePrice(buyModalRoute.price || '') : { oneWay: 0, roundTrip: 0 };
  const basePrice = tripType === 'round_trip' ? prices.roundTrip : prices.oneWay;
  const subtotal = basePrice * passengers;
  const portTax = 25000 * passengers;
  const total = subtotal + portTax;
  const isPayable = basePrice > 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity testID="transport-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{tr('Transporte')}</Text>
          <Text style={styles.subtitle}>Compra tu ticket en línea — sin filas</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/my-tickets' as any)} style={styles.ticketsBtn}>
          <Ionicons name="ticket" size={18} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : (
          routes.map(route => {
            const p = parsePrice(route.price || '');
            const canPay = p.oneWay > 0 && (route.type === 'boat' || route.type === 'shuttle');
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
                  {canPay && (
                    <View style={styles.qrBadge}>
                      <Ionicons name="qr-code" size={11} color="#22C55E" />
                      <Text style={styles.qrBadgeText}>QR</Text>
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

                  {canPay ? (
                    <TouchableOpacity
                      style={styles.payBtn}
                      onPress={() => openBuyModal(route)}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="card" size={14} color={COLORS.white} />
                      <Text style={styles.payBtnText}>Pagar en línea</Text>
                    </TouchableOpacity>
                  ) : route.type === 'boat' ? (
                    <TouchableOpacity
                      style={styles.payBtn}
                      onPress={() => router.push('/port-tax/checkout' as any)}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="qr-code" size={14} color={COLORS.white} />
                      <Text style={styles.payBtnText}>Pagar tasa portuaria</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            );
          })
        )}
        <View style={{ height: SPACING.xxl }} />
      </ScrollView>

      {/* Buy modal */}
      <Modal
        visible={buyModalRoute !== null}
        animationType="slide"
        transparent
        onRequestClose={closeAll}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHandle} />
            {!resultTicket ? (
              <>
                <Text style={styles.modalTitle}>Comprar ticket</Text>
                <Text style={styles.modalSubtitle}>{buyModalRoute?.route_name || buyModalRoute?.partner}</Text>

                {/* Trip type */}
                <Text style={styles.modalLabel}>Tipo de viaje</Text>
                <View style={styles.optionsRow}>
                  {isPayable && prices.oneWay !== prices.roundTrip && (
                    <TouchableOpacity
                      style={[styles.optionBtn, tripType === 'one_way' && styles.optionBtnActive]}
                      onPress={() => setTripType('one_way')}
                    >
                      <Text style={[styles.optionLabel, tripType === 'one_way' && styles.optionLabelActive]}>
                        Solo ida
                      </Text>
                      <Text style={[styles.optionPrice, tripType === 'one_way' && styles.optionPriceActive]}>
                        ${prices.oneWay.toLocaleString()} COP
                      </Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.optionBtn, tripType === 'round_trip' && styles.optionBtnActive]}
                    onPress={() => setTripType('round_trip')}
                  >
                    <Text style={[styles.optionLabel, tripType === 'round_trip' && styles.optionLabelActive]}>
                      Ida y vuelta
                    </Text>
                    <Text style={[styles.optionPrice, tripType === 'round_trip' && styles.optionPriceActive]}>
                      ${prices.roundTrip.toLocaleString()} COP
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Passengers */}
                <Text style={styles.modalLabel}>{tr('Pasajeros')}</Text>
                <View style={styles.paxRow}>
                  <TouchableOpacity
                    style={styles.paxBtn}
                    onPress={() => setPassengers(Math.max(1, passengers - 1))}
                  >
                    <Ionicons name="remove" size={18} color={COLORS.textMain} />
                  </TouchableOpacity>
                  <Text style={styles.paxValue}>{passengers}</Text>
                  <TouchableOpacity
                    style={styles.paxBtn}
                    onPress={() => setPassengers(Math.min(10, passengers + 1))}
                  >
                    <Ionicons name="add" size={18} color={COLORS.textMain} />
                  </TouchableOpacity>
                </View>

                {/* Summary */}
                <View style={styles.summary}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Subtotal ({passengers}× ${basePrice.toLocaleString()})</Text>
                    <Text style={styles.summaryValue}>${subtotal.toLocaleString()}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
                      <Text style={styles.summaryLabel}>Impuesto portuario</Text>
                      <View style={styles.portTaxBadge}>
                        <Text style={styles.portTaxBadgeText}>INCLUIDO</Text>
                      </View>
                    </View>
                    <Text style={styles.summaryValue}>${portTax.toLocaleString()}</Text>
                  </View>
                  <View style={[styles.summaryRow, styles.totalRow]}>
                    <Text style={styles.totalLabel}>{tr('Total')}</Text>
                    <Text style={styles.totalValue}>${total.toLocaleString()} COP</Text>
                  </View>
                </View>

                <Text style={styles.savingsNote}>
                  💡 Pagando aquí evitas la fila para el impuesto portuario en la bodeguita.
                </Text>

                <TouchableOpacity
                  style={[styles.confirmBtn, paying && { opacity: 0.6 }]}
                  onPress={handlePay}
                  disabled={paying}
                  activeOpacity={0.85}
                >
                  {paying ? (
                    <ActivityIndicator color={COLORS.white} />
                  ) : (
                    <>
                      <Ionicons name="lock-closed" size={16} color={COLORS.white} />
                      <Text style={styles.confirmBtnText}>Pagar ${total.toLocaleString()} COP</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelBtn} onPress={closeAll}>
                  <Text style={styles.cancelText}>{tr('Cancelar')}</Text>
                </TouchableOpacity>
              </>
            ) : (
              /* QR result */
              <ScrollView contentContainerStyle={{ paddingBottom: SPACING.lg }}>
                <View style={styles.successHero}>
                  <View style={styles.successCircle}>
                    <Ionicons name="checkmark" size={32} color={COLORS.white} />
                  </View>
                  <Text style={styles.successTitle}>¡Pago exitoso!</Text>
                  <Text style={styles.successSubtitle}>
                    Muestra este QR en la entrada de la bodeguita
                  </Text>
                </View>

                <View style={styles.qrCard}>
                  <Image source={{ uri: resultTicket.qr_url }} style={styles.qrImage} />
                  <Text style={styles.ticketIdText}>{resultTicket.ticket_id}</Text>
                </View>

                <View style={styles.ticketDetails}>
                  <View style={styles.ticketRow}>
                    <Ionicons name="boat" size={14} color={COLORS.primary} />
                    <Text style={styles.ticketRowText}>{resultTicket.route_name || buyModalRoute?.partner}</Text>
                  </View>
                  <View style={styles.ticketRow}>
                    <Ionicons name="people" size={14} color={COLORS.primary} />
                    <Text style={styles.ticketRowText}>
                      {resultTicket.passengers} pasajero{resultTicket.passengers !== 1 ? 's' : ''} · {resultTicket.trip_type === 'round_trip' ? 'Ida y vuelta' : 'Solo ida'}
                    </Text>
                  </View>
                  <View style={styles.ticketRow}>
                    <Ionicons name="calendar" size={14} color={COLORS.primary} />
                    <Text style={styles.ticketRowText}>Válido: {resultTicket.valid_until}</Text>
                  </View>
                  <View style={styles.ticketRow}>
                    <Ionicons name="cash" size={14} color={COLORS.success} />
                    <Text style={styles.ticketRowText}>
                      Total: ${resultTicket.total.toLocaleString()} COP (incluye impuesto portuario)
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.confirmBtn}
                  onPress={closeAll}
                  activeOpacity={0.85}
                >
                  <Ionicons name="checkmark-circle" size={16} color={COLORS.white} />
                  <Text style={styles.confirmBtnText}>Listo</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  actionsRow: { flexDirection: 'row', gap: SPACING.sm },
  mapBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.primary },
  mapBtnText: { fontSize: 12, color: COLORS.primary, ...FONTS.semibold },
  payBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: RADIUS.full, backgroundColor: COLORS.primary },
  payBtnText: { fontSize: 12, color: COLORS.white, ...FONTS.bold },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: SPACING.lg, paddingBottom: SPACING.xl, maxHeight: '92%' },
  modalHandle: { width: 44, height: 4, borderRadius: 2, backgroundColor: COLORS.border, alignSelf: 'center' },
  modalTitle: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold, marginTop: SPACING.sm },
  modalSubtitle: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, marginBottom: SPACING.md },
  modalLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.bold, letterSpacing: 1, marginTop: SPACING.sm, marginBottom: 6, textTransform: 'uppercase' },
  optionsRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.xs },
  optionBtn: { flex: 1, padding: SPACING.sm, backgroundColor: COLORS.background, borderRadius: RADIUS.lg, borderWidth: 1.5, borderColor: COLORS.border, alignItems: 'center' },
  optionBtnActive: { borderColor: COLORS.primary, backgroundColor: 'rgba(217,119,6,0.1)' },
  optionLabel: { fontSize: 13, color: COLORS.textMuted, ...FONTS.semibold },
  optionLabelActive: { color: COLORS.textMain },
  optionPrice: { fontSize: 15, color: COLORS.textMain, ...FONTS.bold, marginTop: 2 },
  optionPriceActive: { color: COLORS.primary },
  paxRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', backgroundColor: COLORS.background, borderRadius: RADIUS.lg, paddingVertical: 10, borderWidth: 1, borderColor: COLORS.border },
  paxBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  paxValue: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold, minWidth: 60, textAlign: 'center' },
  summary: { marginTop: SPACING.md, padding: SPACING.md, backgroundColor: COLORS.background, borderRadius: RADIUS.lg, gap: 8 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { fontSize: 12, color: COLORS.textMuted, ...FONTS.regular },
  summaryValue: { fontSize: 13, color: COLORS.textMain, ...FONTS.semibold },
  portTaxBadge: { backgroundColor: COLORS.success, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  portTaxBadgeText: { fontSize: 8, color: COLORS.white, ...FONTS.bold, letterSpacing: 0.5 },
  totalRow: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: SPACING.sm, marginTop: 4 },
  totalLabel: { fontSize: 14, color: COLORS.textMain, ...FONTS.bold },
  totalValue: { fontSize: 18, color: COLORS.primary, ...FONTS.bold },
  savingsNote: { fontSize: 11, color: COLORS.textMuted, ...FONTS.regular, marginTop: SPACING.sm, textAlign: 'center', lineHeight: 16 },
  confirmBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: RADIUS.full, paddingVertical: 14, marginTop: SPACING.md },
  confirmBtnText: { fontSize: 15, color: COLORS.white, ...FONTS.bold },
  cancelBtn: { alignItems: 'center', paddingVertical: 10, marginTop: 4 },
  cancelText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.medium },

  // QR result
  successHero: { alignItems: 'center', paddingVertical: SPACING.md, gap: 8 },
  successCircle: { width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.success, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  successTitle: { fontSize: 22, color: COLORS.textMain, ...FONTS.bold },
  successSubtitle: { fontSize: 13, color: COLORS.textMuted, ...FONTS.regular, textAlign: 'center' },
  qrCard: { alignItems: 'center', padding: SPACING.lg, backgroundColor: COLORS.white, borderRadius: RADIUS.xl, marginVertical: SPACING.md },
  qrImage: { width: 220, height: 220 },
  ticketIdText: { fontSize: 13, color: '#1a1a2e', ...FONTS.bold, marginTop: 8, letterSpacing: 1 },
  ticketDetails: { gap: 8, padding: SPACING.md, backgroundColor: COLORS.background, borderRadius: RADIUS.lg },
  ticketRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ticketRowText: { fontSize: 13, color: COLORS.textMain, ...FONTS.medium, flex: 1 },
});
