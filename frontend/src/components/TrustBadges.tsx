// Trust badges (Drop 7B) — every badge requires its backing data.
// No data → no badge. Absence is honest (7B3 acceptance rule).

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { useTr } from '../i18n/autoTr';

export function TrustBadges({ partner }: { partner: any }) {
  const tr = useTr();
  const [open, setOpen] = useState<string | null>(null);
  const trust = partner?.trust || {};
  const pr = partner?.price_reference;
  const hasAny = trust.place_verified || trust.rnt || (pr && pr.typical_cop);
  if (!hasAny) return null;

  const fmtCop = (n: number) => (n === 0 ? tr('GRATIS') : `$${n.toLocaleString('es-CO')}`);
  // VERIFY-tier facts are never a hard number: a degenerate range (one
  // unofficial figure) renders as an approximation, only HIGH is exact.
  const priceLabel = pr?.typical_cop
    ? (pr.typical_cop.low === pr.typical_cop.high
        ? (pr.confidence === 'HIGH' ? fmtCop(pr.typical_cop.low) : `~${fmtCop(pr.typical_cop.low)}`)
        : `${fmtCop(pr.typical_cop.low)} – ${fmtCop(pr.typical_cop.high)}`)
    : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {!!trust.place_verified && (
          <TouchableOpacity style={styles.badge} onPress={() => setOpen(open === 'v' ? null : 'v')} activeOpacity={0.8}>
            <Ionicons name="checkmark-circle" size={13} color={COLORS.primary} />
            <Text style={styles.badgeText}>{tr('Verificado')}</Text>
          </TouchableOpacity>
        )}
        {!!trust.rnt && (
          <TouchableOpacity style={styles.badge} onPress={() => setOpen(open === 'r' ? null : 'r')} activeOpacity={0.8}>
            <Ionicons name="shield-checkmark" size={13} color={COLORS.primary} />
            <Text style={styles.badgeText}>RNT</Text>
          </TouchableOpacity>
        )}
        {!!priceLabel && (
          <TouchableOpacity style={styles.badge} onPress={() => setOpen(open === 'p' ? null : 'p')} activeOpacity={0.8}>
            <Ionicons name="pricetag" size={13} color={COLORS.primary} />
            <Text style={styles.badgeText}>{tr('Precio de referencia')}</Text>
          </TouchableOpacity>
        )}
      </View>
      {open === 'v' && (
        <Text style={styles.detail}>{tr('Ubicación y existencia verificadas contra el registro oficial de Google Places.')}</Text>
      )}
      {open === 'r' && (
        <Text style={styles.detail}>
          RNT {trust.rnt} · {tr('Registrado en el Registro Nacional de Turismo — turismo legal. Verificable gratis en rues.org.co.')}
        </Text>
      )}
      {open === 'p' && !!pr && (
        <Text style={styles.detail}>
          {pr.label || priceLabel} · {pr.confidence === 'HIGH' ? `${tr('oficial')} ${pr.source_year}` : `${pr.source} · ${pr.source_year}`}
          {'\n'}{tr('Los precios cambian — confirmá en el lugar.')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: SPACING.sm, gap: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(245,11,27,0.10)', borderColor: 'rgba(245,11,27,0.45)', borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 11, color: COLORS.primary, ...FONTS.bold },
  detail: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, lineHeight: 16, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: 10 },
});

export default TrustBadges;
