// City module detail — /ciudad/<id>. Hero + honesty badge, summary, honest note,
// dated facts with their official source, official links (open off-app),
// safety checklist, fallback and the "what would change the badge" note.
// AMO informs; every fare/ticket/pass here is paid with the entity that runs it.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Head from '../../src/components/WebHead';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, SPACING, RADIUS, FONTS, TYPE } from '../../src/constants/theme';
import { ASSET_ORIGIN } from '../../src/constants/api';
import { SafeImage } from '../../src/components/SafeImage';
import { FadeInUp } from '../../src/components/FadeInUp';
import { Skeleton } from '../../src/components/Skeleton';
import { CityStatusBadge, CityIconArt } from '../../src/components/CityModuleUI';
import { useLang } from '../../src/context/LanguageContext';
import { useTr } from '../../src/i18n/autoTr';
import {
  CityModulesPayload, CityFact, CityLink, LINK_ICONS, formatCop, getCachedCityModules,
  loadCityModules, openExternal, pickL,
} from '../../src/lib/cityModules';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const HERO_HEIGHT = 272;

export default function CiudadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { lang } = useLang();
  const tr = useTr();
  const [payload, setPayload] = useState<CityModulesPayload | null>(getCachedCityModules());
  const [loading, setLoading] = useState<boolean>(!getCachedCityModules());
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (force = false) => {
    setFailed(false);
    setLoading(true);
    try {
      setPayload(await loadCityModules(force));
    } catch (e) {
      console.error('[CiudadDetail]', e);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!getCachedCityModules()) load();
  }, [load]);

  const mod = useMemo(
    () => payload?.modules.find((m) => m.id === String(id || '')) || null,
    [payload, id],
  );

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/ciudad' as any);
  }, [router]);
  const goHome = useCallback(() => router.replace('/(tabs)' as any), [router]);
  const goHub = useCallback(() => router.replace('/ciudad' as any), [router]);

  // ── All hooks are above this line. ──────────────────────────────────────

  // Browser tab / history / share sheet: expo-router's Head provider injects an
  // EMPTY helmet <title> ahead of the shell one, so without a per-screen title
  // document.title is '' on every route.
  const pageTitle = `${mod ? pickL(mod.title, lang) : tr('Moverse en Cartagena')} · AMO Life`;
  const head = <Head><title>{pageTitle}</title></Head>;

  const navButtons = (
    <View style={styles.navRow}>
      <TouchableOpacity
        testID="ciudad-detail-back-btn"
        style={styles.navBtn}
        onPress={goBack}
        accessibilityRole="button"
        accessibilityLabel={tr('Volver')}
      >
        <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
      </TouchableOpacity>
      <TouchableOpacity
        testID="ciudad-detail-home-btn"
        style={styles.navBtn}
        onPress={goHome}
        accessibilityRole="button"
        accessibilityLabel={tr('Inicio')}
      >
        <Ionicons name="home-outline" size={20} color={COLORS.textMain} />
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {head}
        <View style={{ height: HERO_HEIGHT }}>
          <Skeleton height={HERO_HEIGHT} borderRadius={0} />
          {navButtons}
        </View>
        <View style={styles.body} testID="ciudad-detail-skeleton">
          <Skeleton width={84} height={22} borderRadius={RADIUS.full} />
          <Skeleton width="70%" height={26} style={{ marginTop: 12 }} />
          <Skeleton width="96%" height={12} style={{ marginTop: 14 }} />
          <Skeleton width="92%" height={12} style={{ marginTop: 6 }} />
          <Skeleton width="60%" height={12} style={{ marginTop: 6 }} />
          <Skeleton height={92} borderRadius={RADIUS.lg} style={{ marginTop: 20 }} />
          <Skeleton height={64} borderRadius={RADIUS.lg} style={{ marginTop: 12 }} />
          <Skeleton height={64} borderRadius={RADIUS.lg} style={{ marginTop: 8 }} />
        </View>
      </SafeAreaView>
    );
  }

  if (failed || !payload) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {head}
        {navButtons}
        <View style={styles.stateWrap} testID="ciudad-detail-error">
          <Ionicons name="cloud-offline-outline" size={48} color={COLORS.textMuted} />
          <Text style={styles.stateTitle}>{tr('Sin conexión')}</Text>
          <Text style={styles.stateText}>{tr('Verifica tu conexión e intenta de nuevo')}</Text>
          <TouchableOpacity onPress={() => load(true)} style={styles.primaryBtn} accessibilityRole="button" accessibilityLabel={tr('Reintentar')}>
            <Text style={styles.primaryBtnText}>{tr('Reintentar')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!mod) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {head}
        {navButtons}
        <View style={styles.stateWrap} testID="ciudad-detail-notfound">
          <Ionicons name="search-outline" size={48} color={COLORS.textMuted} />
          <Text style={styles.stateTitle}>{tr('No encontramos este módulo')}</Text>
          <Text style={styles.stateText}>{tr('Puede que el enlace haya cambiado. Mira todos los módulos de Moverse.')}</Text>
          <TouchableOpacity onPress={goHub} style={styles.primaryBtn} accessibilityRole="link" accessibilityLabel={tr('Volver a Moverse')}>
            <Ionicons name="bus" size={16} color={COLORS.black} />
            <Text style={styles.primaryBtnText}>{tr('Volver a Moverse')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const title = pickL(mod.title, lang);
  const tagline = pickL(mod.tagline, lang);
  const reason = pickL(mod.status_reason, lang);
  const summary = pickL(mod.summary, lang);
  const honest = pickL(mod.honest_note, lang);
  const fallback = pickL(mod.fallback, lang);
  const future = pickL(mod.future, lang);
  const safety = (mod.safety || []).map((s) => pickL(s, lang)).filter(Boolean);
  const links = (mod.official_links || []).filter((l) => !!l?.url);
  const facts = mod.facts || [];
  const externalHint = tr('abre enlace externo');
  // A caption means the photo is context, not the subject (see IMAGE_CREDITS.md):
  // it is shown under the hero and doubles as the image's accessibility label.
  const caption = pickL(mod.image?.caption, lang);

  const renderFact = (f: CityFact, i: number) => {
    const label = pickL(f.label, lang);
    const text = pickL(f.value_text, lang);
    const note = pickL(f.note, lang);
    const hasCop = typeof f.value_cop === 'number';
    const verify = f.confidence === 'VERIFY';
    // A VERIFY "free" (e.g. a 2019 news post as the only source) is hedged like any
    // other VERIFY value: no bold green, and the chip's word repeated next to it.
    const copText = f.value_cop === 0
      ? (verify ? `${tr('GRATIS')} · ${tr('Confirma')}` : tr('GRATIS'))
      : `${verify ? `${tr('aprox.')} ` : ''}${formatCop(f.value_cop as number, lang)}`;
    return (
      <View key={f.key || i} style={[styles.factRow, i > 0 && styles.factRowDivider]} testID={`ciudad-fact-${f.key}`}>
        <View style={styles.factHead}>
          <Text style={styles.factLabel}>{label}</Text>
          {verify ? (
            <View style={styles.verifyChip} accessibilityRole="text" accessibilityLabel={tr('Confirma')}>
              <Ionicons name="alert-circle-outline" size={11} color={COLORS.coral} />
              <Text style={styles.verifyChipText}>{tr('Confirma')}</Text>
            </View>
          ) : null}
        </View>
        {hasCop ? (
          <Text style={[styles.factCop, f.value_cop === 0 && !verify && styles.factFree, verify && styles.factCopVerify]}>
            {copText}
          </Text>
        ) : null}
        {!!text && <Text style={styles.factText}>{text}</Text>}
        {!!note && <Text style={styles.factNote}>{note}</Text>}
        {!!f.source_name && (
          <TouchableOpacity
            style={styles.sourceRow}
            onPress={() => openExternal(f.source_url)}
            disabled={!f.source_url}
            activeOpacity={0.7}
            accessibilityRole="link"
            accessibilityLabel={`${tr('Fuente')}: ${f.source_name} · ${externalHint}`}
          >
            <Ionicons name="link-outline" size={11} color={COLORS.textFaint} style={{ marginTop: 2 }} />
            <Text style={styles.sourceText} numberOfLines={2}>
              {f.source_name}{f.last_verified ? ` · ${f.last_verified}` : ''}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderLink = (l: CityLink, i: number) => {
    const label = pickL(l.label, lang);
    const icon = (LINK_ICONS[l.kind] || 'open-outline') as IconName;
    return (
      <TouchableOpacity
        key={`${l.kind}-${i}`}
        style={styles.linkBtn}
        onPress={() => openExternal(l.url)}
        activeOpacity={0.8}
        accessibilityRole="link"
        accessibilityLabel={`${label} · ${externalHint}`}
        testID={`ciudad-link-${l.kind}-${i}`}
      >
        <View style={styles.linkIcon}>
          <Ionicons name={icon} size={17} color={COLORS.official} />
        </View>
        <Text style={styles.linkLabel} numberOfLines={2}>{label}</Text>
        <Ionicons name="open-outline" size={16} color={COLORS.textMuted} />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {head}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: SPACING.xxl }}>
        <View style={styles.hero}>
          {mod.image?.file ? (
            <SafeImage
              uri={ASSET_ORIGIN + mod.image.file}
              category="attraction"
              style={styles.heroFill}
              resizeMode="cover"
              accessibilityLabel={caption || title}
            />
          ) : (
            <CityIconArt id={mod.id} icon={mod.icon} style={styles.heroFill} iconSize={56} />
          )}
          <LinearGradient
            colors={['rgba(8,12,22,0.25)', 'rgba(8,12,22,0.15)', 'rgba(8,12,22,0.72)', COLORS.background]}
            locations={[0, 0.35, 0.75, 1]}
            style={styles.heroOverlay}
            pointerEvents="none"
          />
          {navButtons}
          <FadeInUp style={styles.heroBottom} distance={22}>
            <CityStatusBadge status={mod.status} tr={tr} size="md" />
            <Text style={styles.heroTitle}>{title}</Text>
            {!!tagline && <Text style={styles.heroTagline}>{tagline}</Text>}
          </FadeInUp>
        </View>

        <View style={styles.body}>
          {!!caption && (
            <Text style={styles.captionText} testID="ciudad-image-caption">{caption}</Text>
          )}
          {!!reason && (
            <View style={styles.reasonRow}>
              <Ionicons name="information-circle-outline" size={13} color={COLORS.textFaint} style={{ marginTop: 2 }} />
              <Text style={styles.reasonText}>{reason}</Text>
            </View>
          )}

          {!!summary && <Text style={styles.summary}>{summary}</Text>}

          {!!honest && (
            <View style={styles.honestCard} testID="ciudad-honest-note">
              <View style={styles.honestHead}>
                <Ionicons name="hand-left-outline" size={15} color={COLORS.mustard} />
                <Text style={styles.honestTitle}>{tr('Nota honesta')}</Text>
              </View>
              <Text style={styles.honestText}>{honest}</Text>
            </View>
          )}

          {facts.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Ionicons name="pricetags-outline" size={16} color={COLORS.icon} />
                <Text style={styles.sectionTitle}>{tr('Datos y precios')}</Text>
                <View style={styles.countPill}><Text style={styles.countText}>{facts.length}</Text></View>
              </View>
              <View style={styles.factsCard}>{facts.map(renderFact)}</View>
              <Text style={styles.sectionHint}>{tr('"Confirma" = dato que puede variar: verifica en taquilla o con la entidad.')}</Text>
            </View>
          )}

          {links.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Ionicons name="globe-outline" size={16} color={COLORS.icon} />
                <Text style={styles.sectionTitle}>{tr('Enlaces oficiales')}</Text>
              </View>
              <View style={{ gap: SPACING.sm }}>{links.map(renderLink)}</View>
            </View>
          )}

          {safety.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Ionicons name="shield-checkmark-outline" size={16} color={COLORS.icon} />
                <Text style={styles.sectionTitle}>{tr('Seguridad')}</Text>
              </View>
              <View style={styles.safetyCard}>
                {safety.map((line, i) => (
                  <View key={`${mod.id}-safety-${i}`} style={styles.safetyRow}>
                    <Ionicons name="checkmark-circle" size={16} color="#22C55E" style={{ marginTop: 1 }} />
                    <Text style={styles.safetyText}>{line}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {!!fallback && (
            <View style={styles.fallbackRow}>
              <Ionicons name="refresh-circle-outline" size={16} color={COLORS.textMuted} style={{ marginTop: 1 }} />
              <Text style={styles.fallbackText}>{fallback}</Text>
            </View>
          )}

          {!!future && (
            <View style={styles.futureBox}>
              <Text style={styles.futureLabel}>{tr('A futuro')}</Text>
              <Text style={styles.futureText}>{future}</Text>
            </View>
          )}

          <View style={styles.footer}>
            <View style={styles.footerRow}>
              <Ionicons name="shield-checkmark-outline" size={13} color={COLORS.textFaint} />
              <Text style={styles.footerText}>
                {tr('Última verificación')}: {payload.last_verified || '—'}
              </Text>
            </View>
            <Text style={styles.footerText}>{tr('AMO te informa; pagas directamente con cada entidad.')}</Text>
            {!!mod.image?.creator && (
              <TouchableOpacity
                onPress={() => mod.image?.source_url && openExternal(mod.image.source_url)}
                disabled={!mod.image?.source_url}
                accessibilityRole="link"
                accessibilityLabel={`${tr('Foto')}: ${mod.image.creator}${mod.image.license ? ` · ${mod.image.license}` : ''}`}
              >
                <Text style={styles.creditText}>
                  {tr('Foto')}: {mod.image.creator}{mod.image.license ? ` · ${mod.image.license}` : ''}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  hero: { height: HERO_HEIGHT, position: 'relative', backgroundColor: COLORS.surfaceAlt },
  heroFill: { width: '100%', height: HERO_HEIGHT },
  heroOverlay: { ...StyleSheet.absoluteFillObject },
  navRow: { flexDirection: 'row', position: 'absolute', top: SPACING.md, left: SPACING.md, gap: 8, zIndex: 5 },
  navBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(5,8,20,0.62)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  heroBottom: { position: 'absolute', bottom: SPACING.md, left: SPACING.lg, right: SPACING.lg, gap: 6 },
  heroTitle: { ...TYPE.title1, color: COLORS.textMain, marginTop: 4 },
  heroTagline: { ...TYPE.subhead, color: 'rgba(245,247,250,0.82)', lineHeight: 19 },
  body: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
  captionText: { fontSize: 11, lineHeight: 15, color: COLORS.textFaint, ...FONTS.regular, fontStyle: 'italic', marginBottom: SPACING.sm },
  reasonRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: SPACING.md },
  reasonText: { flex: 1, fontSize: 12, lineHeight: 17, color: COLORS.textFaint, ...FONTS.medium },
  summary: { ...TYPE.body, color: COLORS.textMuted, lineHeight: 23 },
  honestCard: {
    marginTop: SPACING.lg, padding: SPACING.md, borderRadius: RADIUS.lg, gap: 6,
    backgroundColor: 'rgba(233,185,73,0.07)', borderWidth: 1, borderColor: 'rgba(233,185,73,0.32)',
  },
  honestHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  honestTitle: { ...TYPE.caption, color: COLORS.mustard, letterSpacing: 1, textTransform: 'uppercase' },
  honestText: { fontSize: 13.5, lineHeight: 20, color: COLORS.textMain, ...FONTS.medium },
  section: { marginTop: SPACING.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: SPACING.sm },
  sectionTitle: { ...TYPE.title3, color: COLORS.textMain },
  countPill: { backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2, minWidth: 24, alignItems: 'center' },
  countText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.bold },
  sectionHint: { fontSize: 11, lineHeight: 15, color: COLORS.textFaint, ...FONTS.medium, marginTop: SPACING.sm },
  factsCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.hairline, paddingHorizontal: SPACING.md },
  factRow: { paddingVertical: SPACING.md - 2, gap: 4 },
  factRowDivider: { borderTopWidth: 1, borderTopColor: COLORS.hairline },
  factHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  factLabel: { flex: 1, fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold, letterSpacing: 0.2 },
  verifyChip: { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderColor: 'rgba(255,107,74,0.55)', backgroundColor: 'rgba(255,107,74,0.10)', borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2 },
  verifyChipText: { fontSize: 9.5, color: COLORS.coral, ...FONTS.bold, letterSpacing: 0.5, textTransform: 'uppercase' },
  factCop: { fontSize: 18, lineHeight: 24, color: COLORS.textMain, ...FONTS.bold, letterSpacing: -0.2 },
  factCopVerify: { color: 'rgba(245,247,250,0.88)' },
  factFree: { color: '#22C55E' },
  factText: { fontSize: 13.5, lineHeight: 19, color: COLORS.textMain, ...FONTS.regular },
  factNote: { fontSize: 12, lineHeight: 17, color: COLORS.textMuted, ...FONTS.regular, fontStyle: 'italic' },
  sourceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, marginTop: 2, minHeight: 20 },
  sourceText: { flex: 1, fontSize: 10.5, lineHeight: 14, color: COLORS.textFaint, ...FONTS.medium },
  linkBtn: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: 52,
    paddingHorizontal: SPACING.md, paddingVertical: 10,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(57,184,255,0.22)',
  },
  linkIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(57,184,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  linkLabel: { flex: 1, fontSize: 13.5, lineHeight: 18, color: COLORS.textMain, ...FONTS.semibold },
  safetyCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.hairline, padding: SPACING.md, gap: 10 },
  safetyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  safetyText: { flex: 1, fontSize: 13, lineHeight: 19, color: COLORS.textMain, ...FONTS.regular },
  fallbackRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: SPACING.lg, paddingHorizontal: 2 },
  fallbackText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: COLORS.textMuted, ...FONTS.medium },
  futureBox: { marginTop: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.border, gap: 4 },
  futureLabel: { ...TYPE.overline, color: COLORS.textFaint },
  futureText: { fontSize: 12, lineHeight: 17, color: COLORS.textFaint, ...FONTS.regular },
  footer: { alignItems: 'center', gap: 4, marginTop: SPACING.xl, paddingHorizontal: SPACING.sm },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  footerText: { fontSize: 11, lineHeight: 16, color: COLORS.textFaint, ...FONTS.medium, textAlign: 'center' },
  creditText: { fontSize: 10.5, lineHeight: 16, color: COLORS.textFaint, ...FONTS.regular, textAlign: 'center', textDecorationLine: 'underline', marginTop: 2 },
  stateWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl, gap: SPACING.md },
  stateTitle: { ...TYPE.title3, color: COLORS.textMain, textAlign: 'center' },
  stateText: { ...TYPE.subhead, color: COLORS.textMuted, textAlign: 'center' },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, backgroundColor: COLORS.primary, paddingHorizontal: SPACING.xl, paddingVertical: 12, borderRadius: RADIUS.full, marginTop: SPACING.sm },
  primaryBtnText: { fontSize: 14, color: COLORS.black, ...FONTS.bold },
});
