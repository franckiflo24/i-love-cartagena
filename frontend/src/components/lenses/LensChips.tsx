/**
 * LensChips — the one lens entry point (docs/lenses/DESIGN.md §4, A4): a chip row
 * that rides existing surfaces (mapa ⋯ sheet, explore) — never a new tab.
 *
 * live lens  → onActivate(key) (golden_hour re-pins the map; port_day opens its
 *              screen; a live venues-lens filters the venue grid).
 * gated lens → an honest "En construcción" card (tagline + fill progress) — a
 *              below-threshold lens NEVER renders an empty result (V2).
 */
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/theme';
import { useTr } from '../../i18n/autoTr';
import { useLang } from '../../context/LanguageContext';
import { LensDef, LensesDoc, LensKey, bundledLenses, loadLenses, pickL4 } from '../../lib/lenses';

const LENS_COLOR: Record<LensKey, string> = {
  golden_hour: '#F5A623',
  port_day: '#3B82F6',
  step_free: '#12B5A5',
  family: '#8B5CF6',
  women_verified: '#EC4899',
};

export function useLensesDoc(): LensesDoc | null {
  const [doc, setDoc] = useState<LensesDoc | null>(null);
  useEffect(() => {
    let alive = true;
    setDoc(bundledLenses()); // instant, offline-safe floor
    loadLenses().then((d) => { if (alive) setDoc(d); }).catch(() => { /* keep floor */ });
    return () => { alive = false; };
  }, []);
  return doc;
}

export default function LensRow({
  active,
  onActivate,
}: {
  active?: LensKey | null;
  onActivate: (key: LensKey) => void;
}) {
  const tr = useTr();
  const { lang } = useLang();
  const doc = useLensesDoc();
  const [gated, setGated] = useState<LensDef | null>(null);
  if (!doc) return null;
  return (
    <View>
      <Text style={st.header}>{tr('Lentes')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.row}>
        {doc.lenses.map((ln) => {
          const color = LENS_COLOR[ln.key] || COLORS.primary;
          const isActive = active === ln.key;
          return (
            <TouchableOpacity
              key={ln.key}
              style={[st.chip, isActive && { backgroundColor: `${color}26`, borderColor: color }]}
              onPress={() => (ln.live ? onActivate(ln.key) : setGated(ln))}
              accessibilityRole="button"
              accessibilityLabel={pickL4(ln.label, lang)}
            >
              <Ionicons name={(ln.icon || 'aperture-outline') as never} size={14} color={ln.live ? color : COLORS.textMuted} />
              <Text style={[st.chipText, isActive && { color }, !ln.live && st.chipTextGated]} numberOfLines={1}>
                {pickL4(ln.label, lang)}
              </Text>
              {!ln.live && (
                <View style={st.soonTag}>
                  <Text style={st.soonTagText}>{tr('En construcción')}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Honest gate card — never an empty list, never a live-looking badge */}
      <Modal visible={!!gated} transparent animationType="fade" onRequestClose={() => setGated(null)}>
        <Pressable style={st.backdrop} onPress={() => setGated(null)}>
          <Pressable style={st.card} onPress={() => { /* swallow */ }}>
            {gated && (
              <>
                <View style={[st.cardIcon, { backgroundColor: `${LENS_COLOR[gated.key]}22` }]}>
                  <Ionicons name={(gated.icon || 'aperture-outline') as never} size={22} color={LENS_COLOR[gated.key]} />
                </View>
                <Text style={st.cardTitle}>{pickL4(gated.label, lang)}</Text>
                <View style={st.soonPill}>
                  <Text style={st.soonPillText}>{tr('En construcción')}</Text>
                </View>
                <Text style={st.cardTagline}>{pickL4(gated.tagline, lang)}</Text>
                <Text style={st.cardWhy}>
                  {tr('Esta capa se abre cuando tengamos suficientes lugares verificados — sin promesas vacías.')}
                </Text>
                <Text style={st.cardFill}>
                  {gated.fill.high}/{gated.fill.min_fill} {tr('lugares verificados')}
                </Text>
                <TouchableOpacity style={st.closeBtn} onPress={() => setGated(null)} accessibilityRole="button">
                  <Text style={st.closeBtnText}>{tr('Entendido')}</Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  header: {
    color: COLORS.textMuted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase',
    letterSpacing: 1, marginBottom: 8,
  },
  row: { gap: 8, paddingRight: 16 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44,
    paddingHorizontal: 12, borderRadius: 22, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)', backgroundColor: 'rgba(255,255,255,0.04)',
  },
  chipText: { color: COLORS.textMain, fontSize: 13, fontWeight: '700' },
  chipTextGated: { color: COLORS.textMuted },
  soonTag: {
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  soonTagText: { color: COLORS.textMuted, fontSize: 9, fontWeight: '800' },
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center',
    justifyContent: 'center', padding: 24,
  },
  card: {
    width: '100%', maxWidth: 360, borderRadius: 20, padding: 22,
    backgroundColor: '#0d1220', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  cardIcon: {
    width: 46, height: 46, borderRadius: 23, alignItems: 'center',
    justifyContent: 'center', marginBottom: 10,
  },
  cardTitle: { color: COLORS.textMain, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  soonPill: {
    marginTop: 8, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  soonPillText: { color: COLORS.textMuted, fontSize: 11, fontWeight: '800' },
  cardTagline: { color: COLORS.textMain, fontSize: 13, textAlign: 'center', marginTop: 12, lineHeight: 19 },
  cardWhy: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center', marginTop: 10, lineHeight: 18 },
  cardFill: { color: COLORS.textMuted, fontSize: 12, fontWeight: '800', marginTop: 12 },
  closeBtn: {
    marginTop: 16, minHeight: 44, paddingHorizontal: 22, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { color: COLORS.textMain, fontSize: 14, fontWeight: '700' },
});
