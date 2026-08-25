// "Cambio del día" — today's USD→COP and EUR→COP rates, because tourists keep
// asking the day's exchange rate (Franck, Aug 2026). Reads /api/fx (backend
// caches the daily rate; static fallback /data/fx.json). Renders nothing if no
// rate is available — never shows a made-up number.

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { useTr } from '../i18n/autoTr';
import { api } from '../constants/api';

interface FxResp {
  usd_cop: number | null;
  eur_cop: number | null;
  date?: string;
  trm?: boolean;
  stale?: boolean;
}

const fmtCop = (v: number) => `$${Math.round(v).toLocaleString('es-CO')}`;

export function FxStrip() {
  const tr = useTr();
  const [data, setData] = useState<FxResp | null>(null);

  useEffect(() => {
    let alive = true;
    api.get('/fx').then((r: any) => { if (alive) setData(r); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!data?.usd_cop || !data?.eur_cop) return null;

  return (
    <View style={styles.strip} accessibilityRole="text">
      <View style={styles.iconWrap}>
        <Ionicons name="cash-outline" size={18} color="#000" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.kicker}>{tr('Cambio del día').toUpperCase()}{data.trm ? ' · TRM OFICIAL' : ''}{data.date ? ` · ${data.date.slice(5).replace('-', '/')}` : ''}</Text>
        <View style={styles.ratesRow}>
          <Text style={styles.rate}>🇺🇸 1 USD ≈ <Text style={styles.rateVal}>{fmtCop(data.usd_cop)}</Text></Text>
          <Text style={styles.rate}>🇪🇺 1 EUR ≈ <Text style={styles.rateVal}>{fmtCop(data.eur_cop)}</Text></Text>
        </View>
      </View>
      <Text style={styles.copTag}>COP</Text>
    </View>
  );
}

// Money gets the mustard/gold accent — distinct from coral (live moment) and
// teal (navigation), so the strip reads as "useful info" at a glance.
const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: SPACING.lg, marginBottom: SPACING.md,
    padding: SPACING.md, backgroundColor: 'rgba(233,185,73,0.10)',
    borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(233,185,73,0.35)',
  },
  iconWrap: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.mustard, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontSize: 9.5, color: COLORS.mustard, ...FONTS.bold, letterSpacing: 1.2 },
  ratesRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, marginTop: 2 },
  rate: { fontSize: 12.5, color: COLORS.textMuted, ...FONTS.semibold },
  rateVal: { color: COLORS.textMain, ...FONTS.bold },
  copTag: { fontSize: 10, color: COLORS.mustard, ...FONTS.bold, letterSpacing: 1 },
});

export default FxStrip;
