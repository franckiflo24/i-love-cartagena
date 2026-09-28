// City module detail — /ciudad/<id>. Hero + honesty badge, a clamped summary,
// the honest note (with the badge's reason), collapsed dated facts that open to
// their note and official source, the top official links, the first safety tips
// and the "what would change the badge" note — each longer list one tap away.
// AMO informs; every fare/ticket/pass here is paid with the entity that runs it.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Head from '../../src/components/WebHead';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, SPACING, RADIUS, FONTS, TYPE } from '../../src/constants/theme';
import { FadeInUp } from '../../src/components/FadeInUp';
import { Skeleton } from '../../src/components/Skeleton';
import {
  CityStatusBadge, CityMedia, CityFactRow, CityExpander,
} from '../../src/components/CityModuleUI';
import { useLang } from '../../src/context/LanguageContext';
import { useTr } from '../../src/i18n/autoTr';
import {
  CityModulesPayload, CityLink, LINK_ICONS, getCachedCityModules, loadCityModules,
  openExternal, pickL, sortLinksByPriority,
} from '../../src/lib/cityModules';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const HERO_HEIGHT = 272;

// Progressive-disclosure budget. Every item stays reachable behind one tap; the
// caps only decide what paints before the user asks for more.
const SUMMARY_LINES = 3;
const SUMMARY_CLAMP_CH = 160;   // ~3 lines of TYPE.body at 342 pt content width
const LINKS_PREVIEW = 3;
const SAFETY_PREVIEW = 2;
const FUTURE_LINES = 2;
const FUTURE_CLAMP_CH = 110;    // ~2 lines at 12 px

export default function CiudadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { lang } = useLang();
  const tr = useTr();
  const [payload, setPayload] = useState<CityModulesPayload | null>(getCachedCityModules());
  const [loading, setLoading] = useState<boolean>(!getCachedCityModules());
  const [failed, setFailed] = useState(false);

  // Disclosure state — one Set for facts (keys are unique per module), one flag
  // per capped section. All reset when `id` changes: Luna's open_city_module and
  // the hub's replace() reuse this screen for another module.
  const [openFacts, setOpenFacts] = useState<Set<string>>(() => new Set());
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [allLinks, setAllLinks] = useState(false);
  const [allSafety, setAllSafety] = useState(false);
  const [futureOpen, setFutureOpen] = useState(false);

  const load = useCallback(async (force = false) => {
    setFailed(false);
    // Fallback-first: a screen that already holds the cached payload never drops
    // back into the skeleton, even on a forced refresh.
    setLoading(!getCachedCityModules());
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

  useEffect(() => {
    setOpenFacts(new Set());
    setSummaryOpen(false);
    setAllLinks(false);
    setAllSafety(false);
    setFutureOpen(false);
  }, [id]);

  const mod = useMemo(
    () => payload?.modules.find((m) => m.id === String(id || '')) || null,
    [payload, id],
  );

  const toggleFact = useCallback((key: string) => {
    setOpenFacts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const toggleSummary = useCallback(() => setSummaryOpen((v) => !v), []);
  const toggleLinks = useCallback(() => setAllLinks((v) => !v), []);
  const toggleSafety = useCallback(() => setAllSafety((v) => !v), []);
  const toggleFuture = useCallback(() => setFutureOpen((v) => !v), []);

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
  const links = sortLinksByPriority((mod.official_links || []).filter((l) => !!l?.url));
  const facts = mod.facts || [];
  const externalHint = tr('abre enlace externo');
  // A caption means the photo is context, not the subject (see IMAGE_CREDITS.md):
  // it is shown under the hero and doubles as the image's accessibility label.
  const caption = pickL(mod.image?.caption, lang);

  // What paints before the user asks for more (plain derivations, no hooks).
  const summaryLong = summary.length > SUMMARY_CLAMP_CH;
  const futureLong = future.length > FUTURE_CLAMP_CH;
  const hasVerify = facts.some((f) => f.confidence === 'VERIFY');
  const visibleLinks = allLinks ? links : links.slice(0, LINKS_PREVIEW);
  const visibleSafety = allSafety ? safety : safety.slice(0, SAFETY_PREVIEW);
  const hiddenSafety = safety.length - SAFETY_PREVIEW;

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
          <CityMedia
            id={mod.id}
            icon={mod.icon}
            file={mod.image?.file}
            height={HERO_HEIGHT}
            iconSize={56}
            accessibilityLabel={caption || title}
          />
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

          {!!summary && (
            <View testID="ciudad-summary">
              <Text style={styles.summary} numberOfLines={summaryOpen ? undefined : SUMMARY_LINES}>
                {summary}
              </Text>
              {summaryLong && (
                <TouchableOpacity
                  onPress={toggleSummary}
                  style={styles.readMore}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: summaryOpen }}
                  aria-expanded={summaryOpen}
                  testID="ciudad-summary-toggle"
                >
                  <Text style={styles.readMoreText}>{tr(summaryOpen ? 'Leer menos' : 'Leer más')}</Text>
                  <Ionicons name={summaryOpen ? 'chevron-up' : 'chevron-down'} size={14} color={COLORS.official} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {(!!honest || !!reason) && (
            <View style={styles.honestCard} testID="ciudad-honest-note">
              <View style={styles.honestHead}>
                <Ionicons name="hand-left-outline" size={15} color={COLORS.mustard} />
                <Text style={styles.honestTitle}>{tr('Nota honesta')}</Text>
              </View>
              {!!honest && <Text style={styles.honestText}>{honest}</Text>}
              {/* The badge's justification lives here in full — the hub card shows
                  only its first line, so this is the one place the sentence is whole. */}
              {!!reason && (
                <View style={styles.honestReasonRow}>
                  <Ionicons name="information-circle-outline" size={12} color={COLORS.textFaint} style={{ marginTop: 2 }} />
                  <Text style={styles.honestReason} testID="ciudad-status-reason">{reason}</Text>
                </View>
              )}
            </View>
          )}

          {facts.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Ionicons name="pricetags-outline" size={16} color={COLORS.icon} />
                <Text style={styles.sectionTitle}>{tr('Datos y precios')}</Text>
                <View style={styles.countPill}><Text style={styles.countText}>{facts.length}</Text></View>
              </View>
              <View style={styles.factsCard}>
                {facts.map((f, i) => (
                  <CityFactRow
                    key={f.key || String(i)}
                    fact={f}
                    lang={lang}
                    tr={tr}
                    open={openFacts.has(f.key)}
                    onToggle={toggleFact}
                    first={i === 0}
                  />
                ))}
              </View>
              <Text style={styles.sectionHint}>
                {tr('Toca un dato para ver la nota y la fuente oficial.')}
                {hasVerify ? ` ${tr('"Confirma" = dato que puede variar: verifica en taquilla o con la entidad.')}` : ''}
              </Text>
            </View>
          )}

          {links.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Ionicons name="globe-outline" size={16} color={COLORS.icon} />
                <Text style={styles.sectionTitle}>{tr('Enlaces oficiales')}</Text>
              </View>
              <View style={{ gap: SPACING.sm }}>{visibleLinks.map(renderLink)}</View>
              {links.length > LINKS_PREVIEW && (
                <CityExpander
                  expanded={allLinks}
                  onPress={toggleLinks}
                  label={allLinks ? tr('Ver menos enlaces') : `${tr('Ver todos los enlaces')} (${links.length})`}
                  testID="ciudad-links-toggle"
                />
              )}
            </View>
          )}

          {safety.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Ionicons name="shield-checkmark-outline" size={16} color={COLORS.icon} />
                <Text style={styles.sectionTitle}>{tr('Seguridad')}</Text>
              </View>
              <View style={styles.safetyCard}>
                {visibleSafety.map((line, i) => (
                  <View key={`${mod.id}-safety-${i}`} style={styles.safetyRow}>
                    <Ionicons name="checkmark-circle" size={16} color="#22C55E" style={{ marginTop: 1 }} />
                    <Text style={styles.safetyText}>{line}</Text>
                  </View>
                ))}
              </View>
              {hiddenSafety > 0 && (
                <CityExpander
                  expanded={allSafety}
                  onPress={toggleSafety}
                  label={allSafety ? tr('Ver menos consejos') : `${tr('Ver más consejos')} (${hiddenSafety})`}
                  testID="ciudad-safety-toggle"
                />
              )}
            </View>
          )}

          {/* The fallback ("for the latest, check <entity>") is the links section in
              prose — only worth a line when a module ships without links. */}
          {!!fallback && links.length === 0 && (
            <View style={styles.fallbackRow}>
              <Ionicons name="refresh-circle-outline" size={16} color={COLORS.textMuted} style={{ marginTop: 1 }} />
              <Text style={styles.fallbackText}>{fallback}</Text>
            </View>
          )}

          {!!future && (
            <TouchableOpacity
              style={styles.futureBox}
              onPress={toggleFuture}
              disabled={!futureLong}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ expanded: futureOpen }}
              aria-expanded={futureOpen}
              testID="ciudad-future-toggle"
            >
              <View style={styles.futureHead}>
                <Text style={styles.futureLabel}>{tr('A futuro')}</Text>
                {futureLong && (
                  <Ionicons name={futureOpen ? 'chevron-up' : 'chevron-down'} size={14} color={COLORS.textFaint} />
                )}
              </View>
              <Text style={styles.futureText} numberOfLines={futureOpen || !futureLong ? undefined : FUTURE_LINES}>
                {future}
              </Text>
            </TouchableOpacity>
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
  heroOverlay: { ...StyleSheet.absoluteFillObject },
  navRow: { flexDirection: 'row', position: 'absolute', top: SPACING.md, left: SPACING.md, gap: 8, zIndex: 5 },
  navBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(5,8,20,0.62)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  heroBottom: { position: 'absolute', bottom: SPACING.md, left: SPACING.lg, right: SPACING.lg, gap: 6 },
  heroTitle: { ...TYPE.title1, color: COLORS.textMain, marginTop: 4 },
  heroTagline: { ...TYPE.subhead, color: 'rgba(245,247,250,0.82)', lineHeight: 19 },
  body: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
  captionText: { fontSize: 11, lineHeight: 15, color: COLORS.textFaint, ...FONTS.regular, fontStyle: 'italic', marginBottom: SPACING.sm },
  summary: { ...TYPE.body, color: COLORS.textMuted, lineHeight: 23 },
  readMore: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, alignSelf: 'flex-start', paddingVertical: 8 },
  readMoreText: { fontSize: 13.5, color: COLORS.official, ...FONTS.semibold },
  honestCard: {
    marginTop: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.lg, gap: 6,
    backgroundColor: 'rgba(233,185,73,0.07)', borderWidth: 1, borderColor: 'rgba(233,185,73,0.32)',
  },
  honestHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  honestTitle: { ...TYPE.caption, color: COLORS.mustard, letterSpacing: 1, textTransform: 'uppercase' },
  honestText: { fontSize: 13.5, lineHeight: 20, color: COLORS.textMain, ...FONTS.medium },
  honestReasonRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: 2 },
  honestReason: { flex: 1, fontSize: 12, lineHeight: 16, color: COLORS.textMuted, ...FONTS.medium },
  section: { marginTop: SPACING.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: SPACING.sm },
  sectionTitle: { ...TYPE.title3, color: COLORS.textMain },
  countPill: { backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2, minWidth: 24, alignItems: 'center' },
  countText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.bold },
  sectionHint: { fontSize: 11, lineHeight: 15, color: COLORS.textFaint, ...FONTS.medium, marginTop: SPACING.sm },
  factsCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.hairline, paddingHorizontal: SPACING.md },
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
  futureBox: { marginTop: SPACING.lg, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.border, gap: 4 },
  futureHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
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
