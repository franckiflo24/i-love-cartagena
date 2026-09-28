// "Moverse en Cartagena" — the city hub. Six honesty-badged modules (bus, pier,
// monuments, carriages, water bus, taxis) over official, dated sources. AMO
// informs here; every price is paid off-app with the entity that runs it.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import Head from '../../src/components/WebHead';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, SPACING, RADIUS, FONTS, TYPE, ELEVATION } from '../../src/constants/theme';
import { PressableScale } from '../../src/components/PressableScale';
import { FadeInUp } from '../../src/components/FadeInUp';
import { Skeleton } from '../../src/components/Skeleton';
import { CityStatusBadge, CityMedia } from '../../src/components/CityModuleUI';
import { useLang } from '../../src/context/LanguageContext';
import { useTr } from '../../src/i18n/autoTr';
import { goHome, goBackOr } from '../../src/lib/nav';
import {
  CityModulesPayload, STATUS_META, getCachedCityModules, loadCityModules, pickL,
} from '../../src/lib/cityModules';

const MEDIA_HEIGHT = 156;

export default function CiudadHubScreen() {
  const router = useRouter();
  const { lang } = useLang();
  const tr = useTr();
  const [payload, setPayload] = useState<CityModulesPayload | null>(getCachedCityModules());
  const [loading, setLoading] = useState<boolean>(!getCachedCityModules());
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (force = false) => {
    setFailed(false);
    // Fallback-first: a hub that already holds the cached payload never drops
    // back into the skeleton, even on a forced refresh.
    setLoading(!getCachedCityModules());
    try {
      setPayload(await loadCityModules(force));
    } catch (e) {
      console.error('[CiudadHub]', e);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!getCachedCityModules()) load();
  }, [load]);

  const canGoBack = router.canGoBack();
  const modules = payload?.modules || [];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Per-screen title: the helmet <title> expo-router injects is empty otherwise. */}
      <Head><title>{`${tr('Moverse en Cartagena')} · AMO Life`}</title></Head>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          {canGoBack ? (
            <TouchableOpacity
              testID="ciudad-back-btn"
              onPress={() => goBackOr(router)}
              style={styles.navBtn}
              accessibilityRole="button"
              accessibilityLabel={tr('Volver')}
            >
              <Ionicons name="arrow-back" size={20} color={COLORS.textMain} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              testID="ciudad-home-btn"
              onPress={() => goHome(router)}
              style={styles.navBtn}
              accessibilityRole="button"
              accessibilityLabel={tr('Inicio')}
            >
              <Ionicons name="home-outline" size={19} color={COLORS.textMain} />
            </TouchableOpacity>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>{tr('Moverse')}</Text>
            <Text style={styles.title}>{tr('Moverse en Cartagena')}</Text>
            <Text style={styles.promise}>{tr('Precios reales, fuentes oficiales, sin sorpresas')}</Text>
          </View>
        </View>

        {loading && (
          <View style={styles.list} testID="ciudad-skeleton">
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.card}>
                <Skeleton height={MEDIA_HEIGHT} borderRadius={0} />
                <View style={styles.cardBody}>
                  <Skeleton width="62%" height={18} />
                  <Skeleton width="94%" height={12} style={{ marginTop: 10 }} />
                  <Skeleton width="80%" height={12} style={{ marginTop: 6 }} />
                  <Skeleton width={72} height={22} borderRadius={RADIUS.full} style={{ marginTop: 12 }} />
                </View>
              </View>
            ))}
          </View>
        )}

        {!loading && failed && (
          <View style={styles.stateCard} testID="ciudad-error">
            <Ionicons name="cloud-offline-outline" size={40} color={COLORS.textMuted} />
            <Text style={styles.stateTitle}>{tr('No pudimos cargar la información')}</Text>
            <Text style={styles.stateText}>{tr('Verifica tu conexión e intenta de nuevo')}</Text>
            <TouchableOpacity
              onPress={() => load(true)}
              style={styles.retryBtn}
              accessibilityRole="button"
              accessibilityLabel={tr('Reintentar')}
            >
              <Ionicons name="refresh" size={16} color={COLORS.black} />
              <Text style={styles.retryText}>{tr('Reintentar')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && !failed && payload && modules.length === 0 && (
          <View style={styles.stateCard} testID="ciudad-empty">
            <Ionicons name="map-outline" size={40} color={COLORS.textMuted} />
            <Text style={styles.stateTitle}>{tr('Aún no hay módulos publicados')}</Text>
            <Text style={styles.stateText}>{tr('Estamos verificando fuentes oficiales. Vuelve pronto.')}</Text>
            <TouchableOpacity
              onPress={() => load(true)}
              style={styles.retryBtn}
              accessibilityRole="button"
              accessibilityLabel={tr('Reintentar')}
            >
              <Ionicons name="refresh" size={16} color={COLORS.black} />
              <Text style={styles.retryText}>{tr('Reintentar')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && !failed && modules.length > 0 && (
          <View style={styles.list}>
            {modules.map((m, i) => {
              const meta = STATUS_META[m.status] || STATUS_META.info;
              const title = pickL(m.title, lang);
              const tagline = pickL(m.tagline, lang);
              const reason = pickL(m.status_reason, lang);
              return (
                <FadeInUp key={m.id} delay={i * 60} distance={18}>
                  <PressableScale
                    style={styles.card}
                    onPress={() => router.push(`/ciudad/${m.id}` as any)}
                    accessibilityRole="button"
                    accessibilityLabel={`${title} · ${tr(meta.label)} · ${tr('Ver detalles')}`}
                    testID={`ciudad-card-${m.id}`}
                  >
                    <View style={styles.media}>
                      {/* Brand art paints first; the photo fades in over it once
                          loaded — a 200 KB JPEG on a slow link is never a black box. */}
                      <CityMedia
                        id={m.id}
                        icon={m.icon}
                        file={m.image?.file}
                        height={MEDIA_HEIGHT}
                        accessibilityLabel={pickL(m.image?.caption, lang) || title}
                      />
                      <LinearGradient
                        colors={['transparent', 'rgba(15,21,36,0.85)']}
                        locations={[0.45, 1]}
                        style={styles.mediaFade}
                        pointerEvents="none"
                      />
                      <CityStatusBadge status={m.status} tr={tr} style={styles.badgeOnMedia} />
                    </View>
                    <View style={styles.cardBody}>
                      <View style={styles.titleRow}>
                        <Text style={styles.cardTitle} numberOfLines={2}>{title}</Text>
                        <Ionicons name="chevron-forward" size={18} color={COLORS.icon} />
                      </View>
                      {!!tagline && <Text style={styles.cardTagline} numberOfLines={2}>{tagline}</Text>}
                      {/* One line only: the full reason lives in the detail's honest card. */}
                      {!!reason && (
                        <View style={styles.reasonRow}>
                          <Ionicons name="information-circle-outline" size={12} color={COLORS.textFaint} style={{ marginTop: 2 }} />
                          <Text style={styles.reasonText} numberOfLines={1}>{reason}</Text>
                        </View>
                      )}
                    </View>
                  </PressableScale>
                </FadeInUp>
              );
            })}
          </View>
        )}

        {!!payload && !loading && !failed && (
          <View style={styles.footer}>
            <View style={styles.footerRow}>
              <Ionicons name="shield-checkmark-outline" size={13} color={COLORS.textFaint} />
              <Text style={styles.footerText}>
                {tr('Última verificación')}: {payload.last_verified || '—'}
              </Text>
            </View>
            <Text style={styles.footerText}>{tr('AMO te informa; pagas directamente con cada entidad.')}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { paddingBottom: SPACING.xxl },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.md },
  navBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.hairline, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { ...TYPE.overline, color: COLORS.mustard, marginTop: 4 },
  title: { ...TYPE.title1, color: COLORS.textMain, marginTop: 2 },
  promise: { ...TYPE.subhead, color: COLORS.textMuted, marginTop: 4 },
  list: { paddingHorizontal: SPACING.lg, gap: SPACING.md },
  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.hairline,
    overflow: 'hidden', ...ELEVATION.md,
  },
  media: { height: MEDIA_HEIGHT, backgroundColor: COLORS.surfaceAlt, position: 'relative' },
  mediaFade: { ...StyleSheet.absoluteFillObject },
  badgeOnMedia: { position: 'absolute', top: SPACING.sm + 2, left: SPACING.sm + 2 },
  cardBody: { padding: SPACING.md, paddingTop: SPACING.sm + 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { ...TYPE.title3, color: COLORS.textMain, flex: 1 },
  cardTagline: { ...TYPE.subhead, color: COLORS.textMuted, marginTop: 4, lineHeight: 19 },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  reasonText: { flex: 1, fontSize: 11.5, lineHeight: 16, color: COLORS.textFaint, ...FONTS.medium },
  stateCard: {
    marginHorizontal: SPACING.lg, marginTop: SPACING.lg, padding: SPACING.xl, alignItems: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.hairline,
  },
  stateTitle: { ...TYPE.headline, color: COLORS.textMain, textAlign: 'center' },
  stateText: { ...TYPE.subhead, color: COLORS.textMuted, textAlign: 'center' },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SPACING.sm, minHeight: 44,
    paddingHorizontal: SPACING.lg, paddingVertical: 12, borderRadius: RADIUS.full, backgroundColor: COLORS.primary,
  },
  retryText: { fontSize: 14, color: COLORS.black, ...FONTS.bold },
  footer: { alignItems: 'center', gap: 4, paddingHorizontal: SPACING.xl, marginTop: SPACING.lg },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  footerText: { fontSize: 11, lineHeight: 16, color: COLORS.textFaint, ...FONTS.medium, textAlign: 'center' },
});
