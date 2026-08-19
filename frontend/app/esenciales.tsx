// Drop CAT — the ESSENTIALS hub. The invisible operating layer, made visible:
// the 8 guest-need states over verified data. Renders ONLY live categories
// (an under-seeded category is absent — no empty shelves); expands the seeded
// essentials with their verified entries (official fares, chains, numbers).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../src/constants/theme';
import { api } from '../src/constants/api';
import { useLang } from '../src/context/LanguageContext';
import { useTr } from '../src/i18n/autoTr';

const fmtCop = (n: number) => (n === 0 ? 'GRATIS' : `$${n.toLocaleString('es-CO')}`);

export default function EsencialesScreen() {
  const router = useRouter();
  const { lang } = useLang();
  const tr = useTr();
  const [tax, setTax] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, any>>({});

  const load = useCallback(() => {
    setFailed(false);
    api.get('/essentials/taxonomy').then(setTax).catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  // 4-language field picker: <base>_<lang> → _en → _es → bare <base>. Works across the
  // heterogeneous essentials entries (need_states use *_es/*_en; trust scam cards use a
  // bare title/line; zones use name/character_*) and adds FR/PT (fall back to EN, then ES)
  // instead of always showing Spanish.
  const L = (o: any, base: string) =>
    o?.[`${base}_${lang}`] || o?.[`${base}_en`] || o?.[`${base}_es`] || o?.[base] || '';
  const pick = (o: any, bases: string[]) => {
    for (const b of bases) { const v = L(o, b); if (v) return v; }
    return '';
  };
  const T = (o: any, base: string) => L(o, base);

  const toggle = useCallback((key: string) => {
    setOpen((cur) => (cur === key ? null : key));
    if (!detail[key]) {
      api.get(`/essentials/category/${key}`).then((d) => setDetail((m) => ({ ...m, [key]: d }))).catch(() => {});
    }
  }, [detail]);

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
            <Text style={styles.title}>{tr('Esenciales')}</Text>
            <Text style={styles.subtitle}>{tr('Todo lo que necesitás en Cartagena — verificado')}</Text>
          </View>
        </View>

        {!tax && !failed && <ActivityIndicator color={COLORS.primary} style={{ marginTop: 50 }} />}
        {failed && (
          <View style={styles.failBox}>
            <Text style={styles.failText}>{tr('No pudimos cargar la información')}</Text>
            <TouchableOpacity onPress={load}><Text style={styles.failRetry}>{tr('Reintentar')}</Text></TouchableOpacity>
          </View>
        )}

        {!!tax && (tax.need_states || []).map((ns: any) => (
          (ns.categories || []).length ? (
            <View key={ns.key} style={styles.section}>
              <View style={styles.sectionHead}>
                <Ionicons name={ns.icon || 'ellipse'} size={16} color={COLORS.primary} />
                <Text style={styles.sectionTitle}>{T(ns, 'title')}</Text>
              </View>

              {ns.categories.map((c: any) => {
                const d = detail[c.key];
                const isOpen = open === c.key;
                return (
                  <View key={c.key} style={styles.catCard}>
                    <TouchableOpacity style={styles.catHead} onPress={() => toggle(c.key)} activeOpacity={0.8}>
                      <Ionicons name={c.icon || 'ellipse'} size={18} color={COLORS.primary} />
                      <Text style={styles.catTitle}>{T(c, 'title')}</Text>
                      {c.trust_required ? <Ionicons name="shield-checkmark" size={14} color="#FF6B75" style={{ marginLeft: 6 }} /> : null}
                      <View style={{ flex: 1 }} />
                      <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textMuted} />
                    </TouchableOpacity>

                    {isOpen && (
                      <View style={styles.catBody}>
                        {!d ? <ActivityIndicator color={COLORS.primary} size="small" /> : (
                          <>
                            {!!L(d, 'guidance') && (
                              <Text style={styles.guidance}>{L(d, 'guidance')}</Text>
                            )}
                            {(d.entries || []).map((e: any, i: number) => (
                              <View key={i} style={styles.entryRow}>
                                <Text style={styles.entryLabel}>{pick(e, ['label', 'title', 'name'])}</Text>
                                <Text style={styles.entryValue}>
                                  {e.value_cop !== undefined ? fmtCop(e.value_cop) : pick(e, ['value_text', 'line', 'character'])}
                                </Text>
                                {e.confidence === 'VERIFY' ? <Text style={styles.verify}>{tr('confirmá')}</Text> : null}
                              </View>
                            ))}
                            {!!d.resolve_via && (
                              <TouchableOpacity onPress={() => {
                                const rv: string = d.resolve_via || '';
                                if (rv.includes('/collections/')) { router.push(`/collections/${rv.split('/collections/')[1]}` as any); return; }
                                const cat = (rv.match(/category=([^&]+)/) || [])[1];
                                if (cat === 'service') router.push(`/(tabs)/explore?category=service&subcategory=${c.key}` as any);
                                else if (cat) router.push(`/(tabs)/explore?category=${cat}` as any);
                                else router.push('/(tabs)/explore' as any);
                              }}>
                                <Text style={styles.link}>{tr('Ver lugares')} →</Text>
                              </TouchableOpacity>
                            )}
                            {(d.entries || []).length === 0 && !L(d, 'guidance') && !d.resolve_via && (
                              <Text style={styles.guidance}>{tr('Aún no cubierto en la app.')}</Text>
                            )}
                          </>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ) : null
        ))}

        {!!tax && (
          <Text style={styles.footer}>{tr('Solo mostramos categorías con información verificada. Lo que aún no está, lo decimos honestamente — nunca inventamos un dato.')}</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
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
  section: { marginTop: SPACING.md },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: SPACING.lg, marginBottom: SPACING.sm },
  sectionTitle: { fontSize: 15, color: COLORS.textMain, ...FONTS.bold },
  catCard: { marginHorizontal: SPACING.lg, marginBottom: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(245,11,27,0.22)', overflow: 'hidden' },
  catHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: SPACING.md },
  catTitle: { fontSize: 14, color: COLORS.textMain, ...FONTS.semibold },
  catBody: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.md, gap: 7 },
  guidance: { fontSize: 12.5, color: COLORS.textMuted, ...FONTS.medium, lineHeight: 18, marginBottom: 4 },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  entryLabel: { flex: 1, fontSize: 12, color: COLORS.textMuted, ...FONTS.medium },
  entryValue: { fontSize: 12.5, color: COLORS.primary, ...FONTS.bold, textAlign: 'right' },
  verify: { fontSize: 9, color: '#FF6B75', ...FONTS.bold, marginLeft: 4 },
  link: { fontSize: 13, color: COLORS.primary, ...FONTS.bold, marginTop: 6 },
  footer: { fontSize: 10, color: COLORS.textMuted, ...FONTS.medium, textAlign: 'center', paddingHorizontal: SPACING.xl, marginTop: SPACING.lg, opacity: 0.7 },
});
