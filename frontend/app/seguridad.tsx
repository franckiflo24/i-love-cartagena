// "Cartagena sin sustos" — the trust & safety sheet (Drop 7C).
// Content served verbatim from the tiered trust knowledge base: HIGH facts
// carry their year; VERIFY facts are ranges with the confirmá hedge. The
// zones are "zonas turísticas principales" — never a safety guarantee, and
// no area is ever labeled dangerous.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { api } from '../src/constants/api';
import { useTr } from '../src/i18n/autoTr';

const CARD_ICONS: Record<string, any> = { car: 'car', boat: 'boat', restaurant: 'restaurant', moon: 'moon', cash: 'cash', diamond: 'diamond', umbrella: 'umbrella' };

export default function SeguridadScreen() {
  const router = useRouter();
  const tr = useTr();
  const [data, setData] = useState<any>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    api.get('/trust/reference').then(setData).catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  const fmtCop = (n: number) => (n === 0 ? tr('GRATIS') : `$${n.toLocaleString('es-CO')}`);
  const highs = (data?.entries || []).filter((e: any) => e.confidence === 'HIGH' && (e.value_cop !== undefined));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        <View style={styles.headerRow}>
          {router.canGoBack() && (
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={20} color={COLORS.textMain} />
            </TouchableOpacity>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{tr('Cartagena sin sustos')}</Text>
            <Text style={styles.subtitle}>{tr('Precios oficiales, zonas y cómo evitar los cobros de más')}</Text>
          </View>
        </View>

        {!data && !failed && <ActivityIndicator color={COLORS.primary} style={{ marginTop: 50 }} />}
        {failed && (
          <View style={styles.failBox}>
            <Text style={styles.failText}>{tr('No pudimos cargar la información')}</Text>
            <TouchableOpacity onPress={load}><Text style={styles.failRetry}>{tr('Reintentar')}</Text></TouchableOpacity>
          </View>
        )}

        {!!data && (
          <>
            {/* Emergency */}
            <View style={styles.emergencyCard}>
              <Ionicons name="call" size={22} color="#EF4444" />
              <View style={{ flex: 1 }}>
                <Text style={styles.emergencyNum}>123</Text>
                <Text style={styles.emergencySub}>{tr('Emergencias nacionales — gratis, 24/7. Marcá directo, sin +57.')}</Text>
              </View>
            </View>

            {/* The scam cards */}
            <Text style={styles.sectionTitle}>{tr('Lo que hay que saber')}</Text>
            {(data.scam_cards || []).map((c: any) => (
              <View key={c.key} style={styles.scamCard}>
                <Ionicons name={CARD_ICONS[c.icon] || 'alert-circle'} size={20} color={COLORS.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.scamTitle}>{tr(c.title)}</Text>
                  <Text style={styles.scamLine}>{tr(c.line)}</Text>
                </View>
              </View>
            ))}

            {/* Official prices (HIGH tier only, with year) */}
            <Text style={styles.sectionTitle}>{tr('Precios oficiales')} · 2026</Text>
            <View style={styles.priceCard}>
              {highs.map((e: any) => (
                <View key={e.topic} style={styles.priceRow}>
                  <Text style={styles.priceTopic}>{tr(topicLabel(e.topic))}</Text>
                  <Text style={styles.priceValue}>{fmtCop(e.value_cop)}</Text>
                </View>
              ))}
              <Text style={styles.priceNote}>{tr('Fuente: Decreto 0051 y entes oficiales, 2026. Los taxis no tienen taxímetro: acordá el precio antes de subir.')}</Text>
            </View>

            {/* Zones */}
            <Text style={styles.sectionTitle}>{tr('Zonas turísticas principales')}</Text>
            <View style={styles.zoneWrap}>
              {(data.safety?.tourist_zones || []).map((z: string) => (
                <View key={z} style={styles.zoneChip}><Text style={styles.zoneText}>{z}</Text></View>
              ))}
            </View>
            <Text style={styles.zoneNote}>{tr(data.safety?.tourist_zones_note || '')}</Text>

            {/* Phone + drinks */}
            <View style={styles.tipCard}>
              <Ionicons name="phone-portrait" size={18} color={COLORS.primary} />
              <Text style={styles.tipText}>{tr(data.safety?.phone_guidance || '')}</Text>
            </View>
            <View style={styles.tipCard}>
              <Ionicons name="wine" size={18} color={COLORS.primary} />
              <Text style={styles.tipText}>{tr(data.safety?.drink_guidance || '')}</Text>
            </View>

            {/* RNT */}
            <Text style={styles.sectionTitle}>{tr('Exigí el RNT')}</Text>
            <View style={styles.tipCard}>
              <Ionicons name="shield-checkmark" size={18} color={COLORS.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.tipText}>
                  {tr('Todo operador turístico legal en Colombia debe tener Registro Nacional de Turismo (RNT). Pedilo antes de comprar un tour — verificalo gratis:')}
                </Text>
                <TouchableOpacity onPress={() => Linking.openURL('https://www.rues.org.co')}>
                  <Text style={styles.link}>rues.org.co →</Text>
                </TouchableOpacity>
              </View>
            </View>

            <Text style={styles.footer}>{tr('Precios 2026 según decretos y entes oficiales; pueden cambiar. Esta guía no sustituye los avisos de viaje de tu gobierno.')}</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function topicLabel(topic: string): string {
  const map: Record<string, string> = {
    taxi_minimum: 'Taxi — carrera mínima',
    taxi_night_surcharge: 'Recargo nocturno (7pm–5am)',
    taxi_airport_centro: 'Aeropuerto → Centro / Getsemaní',
    taxi_airport_bodeguita: 'Aeropuerto → Muelle de la Bodeguita',
    taxi_airport_manga: 'Aeropuerto → Manga',
    taxi_airport_bocagrande: 'Aeropuerto → Bocagrande',
    aviario_foreigner_adult: 'Aviario Nacional (adulto extranjero)',
    castillo_san_felipe_foreigner: 'Castillo San Felipe (extranjero)',
    museo_oro_zenu: 'Museo del Oro Zenú',
  };
  return map[topic] || topic;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 21, color: COLORS.textMain, ...FONTS.bold },
  subtitle: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium, marginTop: 2 },
  failBox: { alignItems: 'center', gap: 8, marginTop: 50 },
  failText: { fontSize: 13, color: COLORS.textMuted, ...FONTS.medium },
  failRetry: { fontSize: 13, color: COLORS.primary, ...FONTS.bold },
  emergencyCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: SPACING.lg, marginBottom: SPACING.md, padding: SPACING.md, backgroundColor: 'rgba(239,68,68,0.08)', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)' },
  emergencyNum: { fontSize: 22, color: '#EF4444', ...FONTS.bold },
  emergencySub: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
  sectionTitle: { fontSize: 15, color: COLORS.textMain, ...FONTS.bold, paddingHorizontal: SPACING.lg, marginTop: SPACING.md, marginBottom: SPACING.sm },
  scamCard: { flexDirection: 'row', gap: 12, marginHorizontal: SPACING.lg, marginBottom: SPACING.sm, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(245,11,27,0.3)' },
  scamTitle: { fontSize: 13, color: COLORS.textMain, ...FONTS.bold },
  scamLine: { fontSize: 12, color: COLORS.textMuted, ...FONTS.medium, marginTop: 2, lineHeight: 17 },
  priceCard: { marginHorizontal: SPACING.lg, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, gap: 8 },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  priceTopic: { flex: 1, fontSize: 12, color: COLORS.textMuted, ...FONTS.medium },
  priceValue: { fontSize: 13, color: COLORS.primary, ...FONTS.bold },
  priceNote: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium, marginTop: 4, opacity: 0.8 },
  zoneWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: SPACING.lg },
  zoneChip: { backgroundColor: 'rgba(245,11,27,0.10)', borderColor: 'rgba(245,11,27,0.4)', borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 5 },
  zoneText: { fontSize: 12, color: COLORS.primary, ...FONTS.semibold },
  zoneNote: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, paddingHorizontal: SPACING.lg, marginTop: 8, lineHeight: 16 },
  tipCard: { flexDirection: 'row', gap: 12, marginHorizontal: SPACING.lg, marginTop: SPACING.sm, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, alignItems: 'flex-start' },
  tipText: { flex: 1, fontSize: 12, color: COLORS.textMuted, ...FONTS.medium, lineHeight: 17 },
  link: { fontSize: 13, color: COLORS.primary, ...FONTS.bold, marginTop: 6 },
  footer: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center', paddingHorizontal: SPACING.xl, marginTop: SPACING.lg, opacity: 0.7 },
});
