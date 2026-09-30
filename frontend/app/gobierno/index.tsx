// /gobierno — the civic-payments PITCH HUB (docs/civic-demo/DESIGN.md §2).
//
// Honesty spine (DESIGN §0, non-negotiable): every civic screen wears a pinned DEMO chip and the
// disclaimer in a bordered footer note. The model it pitches is: the citizen pays in the app, EACH
// public entity collects directly into its own account, and AMO is only the technology channel that
// issues the QR credential. Fares come from the server (city_modules.json facts) and are cited with
// their source + last-verified date; unverified ones are hedged, never implied certain. This screen
// never uses the word "tasa" and never presents itself as an official government surface.
//
// Session: app/gobierno/_layout.tsx gates entry. This screen only needs the business token to call
// the API and renders an honest "Sesión requerida" state when it is missing or rejected.
//
// Hydration rule (React #418): the first render is static (hero + model card + skeleton), identical
// on the server render and the first client render. Everything data-driven arrives from effects.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { Router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Head from '../../src/components/WebHead';
import { Skeleton } from '../../src/components/Skeleton';
import {
  DEMO_AMBER, DISCLAIMER_FALLBACK_ES, civicErrorMessage, formatCop, getServices, getSummary,
  hedgeText, iconOr, isAuthError, isUnverified, pickL2, serviceMerchants, useCivicSession,
} from '../../src/components/civic/civic';
import type {
  CivicFact, CivicService, IconName, ServicesPayload, SummaryPayload,
} from '../../src/components/civic/civic';
import { COLORS, FONTS, RADIUS, SPACING, TYPE } from '../../src/constants/theme';
import { useLang } from '../../src/context/LanguageContext';
import type { Lang } from '../../src/i18n/translations';
import { useTr } from '../../src/i18n/autoTr';
import { goBackOr } from '../../src/lib/nav';

type NavHref = Parameters<Router['push']>[0];

// ── Chrome (pinned header with the DEMO chip, bordered disclaimer footer) ────
function DemoHeader({ onBack }: { onBack: () => void }) {
  const tr = useTr();
  return (
    <View style={s.headerBar}>
      <View style={s.headerInner}>
        <TouchableOpacity
          style={s.backBtn}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={tr('Volver')}
          testID="gobierno-back-btn"
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <View style={s.headerSpacer} />
        <View style={s.demoChip} accessibilityRole="text" accessibilityLabel={tr('Demostración')} testID="gobierno-demo-chip">
          <Ionicons name="flask-outline" size={12} color={DEMO_AMBER} />
          <Text style={s.demoChipText}>{tr('DEMO')}</Text>
        </View>
      </View>
    </View>
  );
}

function DisclaimerNote({ text }: { text: string }) {
  return (
    <View style={s.disclaimer} testID="gobierno-disclaimer">
      <Ionicons name="information-circle-outline" size={16} color={DEMO_AMBER} style={s.disclaimerIcon} />
      <Text style={s.disclaimerText}>{text}</Text>
    </View>
  );
}

// ── Small atoms ──────────────────────────────────────────────────────────────
function Pill({ text, fg, bg, border }: { text: string; fg: string; bg: string; border: string }) {
  return (
    <View style={[s.pill, { backgroundColor: bg, borderColor: border }]}>
      <Text style={[s.pillText, { color: fg }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

function VerifyChip({ text }: { text: string }) {
  return (
    <View style={s.verifyChip}>
      <Ionicons name="alert-circle-outline" size={11} color={COLORS.coral} />
      <Text style={s.verifyChipText}>{text}</Text>
    </View>
  );
}

function StateCard({
  icon, title, text, actionLabel, onAction, testID,
}: { icon: IconName; title: string; text: string; actionLabel?: string; onAction?: () => void; testID: string }) {
  return (
    <View style={s.stateCard} testID={testID} accessibilityRole="alert">
      <Ionicons name={icon} size={30} color={COLORS.textMuted} />
      <Text style={s.stateTitle}>{title}</Text>
      <Text style={s.stateText}>{text}</Text>
      {!!actionLabel && !!onAction && (
        <TouchableOpacity style={s.primaryBtn} onPress={onAction} accessibilityRole="button" accessibilityLabel={actionLabel}>
          <Text style={s.primaryBtnText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── The model: citizen pays → entity collects → AMO issues the credential ────
function ModelCard() {
  const tr = useTr();
  const rows: { icon: IconName; color: string; bg: string; title: string; text: string }[] = [
    {
      icon: 'phone-portrait-outline', color: COLORS.primary, bg: 'rgba(18,181,165,0.14)',
      title: tr('Ciudadano paga en la app'),
      text: tr('Elige el servicio y paga desde el celular.'),
    },
    {
      icon: 'business-outline', color: COLORS.official, bg: 'rgba(57,184,255,0.14)',
      title: tr('La entidad recauda directamente'),
      text: tr('Cada entidad es el comercio y cobra en su propia cuenta.'),
    },
    {
      icon: 'qr-code-outline', color: COLORS.mustard, bg: 'rgba(233,185,73,0.14)',
      title: tr('AMO emite la credencial QR'),
      text: tr('AMO es solo el canal tecnológico: no custodia fondos.'),
    },
  ];
  return (
    <View style={s.card} testID="gobierno-model-card">
      <Text style={s.overline}>{tr('Cómo funciona el modelo')}</Text>
      <View style={s.flow}>
        {rows.map((r, i) => (
          <View key={r.title} style={s.flowRow} testID={`gobierno-model-step-${i + 1}`}>
            <View style={s.flowRail}>
              <View style={[s.flowDisc, { backgroundColor: r.bg }]}>
                <Ionicons name={r.icon} size={20} color={r.color} />
              </View>
              {i < rows.length - 1 && <View style={s.flowLine} />}
            </View>
            <View style={[s.flowText, i < rows.length - 1 && s.flowTextGap]}>
              <Text style={s.flowTitle}>{r.title}</Text>
              <Text style={s.flowCaption}>{r.text}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Security card: quotes the server's own copy ──────────────────────────────
function SecurityCard({ payload }: { payload: ServicesPayload }) {
  const tr = useTr();
  const { scheme, production } = payload.security;
  if (!scheme && !production) return null;
  return (
    <View style={s.card} testID="gobierno-security-card">
      <View style={s.cardHead}>
        <Ionicons name="shield-checkmark-outline" size={18} color={COLORS.icon} />
        <Text style={s.cardTitle} accessibilityRole="header">{tr('Seguridad de la credencial')}</Text>
      </View>
      {!!scheme && (
        <View style={s.secRow}>
          <Ionicons name="key-outline" size={15} color={COLORS.primary} style={s.secIcon} />
          <View style={s.secBody}>
            <Text style={s.secLabel}>{tr('En esta demo')}</Text>
            <Text style={s.secValue} testID="gobierno-security-scheme">{tr(scheme)}</Text>
          </View>
        </View>
      )}
      {!!production && (
        <View style={s.secRow}>
          <Ionicons name="lock-closed-outline" size={15} color={COLORS.mustard} style={s.secIcon} />
          <View style={s.secBody}>
            <Text style={s.secLabel}>{tr('En producción')}</Text>
            <Text style={s.secValue} testID="gobierno-security-production">{tr(production)}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

// ── Service cards ────────────────────────────────────────────────────────────
function FactLine({
  fact, lang, first, hedge,
}: { fact: CivicFact; lang: Lang; first: boolean; hedge: string }) {
  const tr = useTr();
  const value = fact.value_cop !== null && fact.value_cop > 0 ? formatCop(fact.value_cop, lang) : null;
  return (
    <View style={[s.factRow, !first && s.factDivider]} testID={`gobierno-fact-${fact.key}`}>
      <Text style={s.factLabel}>{pickL2(fact.label, lang)}</Text>
      <View style={s.factValueRow}>
        <Text style={value ? s.factCop : s.factText}>{value ?? '—'}</Text>
        {isUnverified(fact.confidence) && <VerifyChip text={hedge} />}
      </View>
      {!!fact.source_name && <Text style={s.small}>{fact.source_name}</Text>}
      {!!fact.last_verified && <Text style={s.small}>{tr('Última verificación')}: {fact.last_verified}</Text>}
    </View>
  );
}

function ServiceCard({
  svc, expanded, onToggle, onNavigate,
}: { svc: CivicService; expanded: boolean; onToggle: (key: string) => void; onNavigate: (href: string) => void }) {
  const tr = useTr();
  const { lang } = useLang();
  const title = pickL2(svc.title, lang);
  const names = serviceMerchants(svc, lang);
  const payable = svc.mode === 'pay' || svc.mode === 'recharge';
  // "Recauda" only where the demo actually collects. A taxi fare is paid to the driver, the aquatic
  // pilot is unbuilt and City Pass is AMO's own product: their server text is shown as a plain caption,
  // never under a label that would claim an entity collects.
  const merchantLine = names.length > 0
    ? (payable ? `${names.length > 1 ? tr('Recaudan') : tr('Recauda')}: ${names.join(' · ')}` : names.join(' · '))
    : '';
  const icon = iconOr(svc.icon, 'ellipse-outline');
  const hedge = hedgeText(tr, svc.key);

  const head = (
    tone: { disc: string; fg: string },
    chip: React.ReactNode,
    trailing: React.ReactNode,
  ) => (
    <View style={s.svcHead}>
      <View style={[s.svcDisc, { backgroundColor: tone.disc }]}>
        <Ionicons name={icon} size={22} color={tone.fg} />
      </View>
      <View style={s.svcBody}>
        <Text style={s.svcTitle}>{title}</Text>
        {!!merchantLine && <Text style={s.svcMerchant} numberOfLines={3}>{merchantLine}</Text>}
        <View style={s.chipRow}>{chip}</View>
      </View>
      {trailing}
    </View>
  );

  if (payable) {
    const receipt = svc.mode === 'recharge';
    return (
      <TouchableOpacity
        style={[s.svcCard, s.svcCardPay]}
        onPress={() => onNavigate(`/gobierno/pagar/${encodeURIComponent(svc.key)}`)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`${title} · ${tr('Pagar (demo)')}`}
        testID={`gobierno-service-${svc.key}`}
      >
        {head(
          { disc: 'rgba(18,181,165,0.14)', fg: COLORS.primary },
          <Pill
            text={receipt ? tr('Comprobante') : tr('Credencial QR')}
            fg={COLORS.primary} bg="rgba(18,181,165,0.10)" border="rgba(18,181,165,0.40)"
          />,
          <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />,
        )}
      </TouchableOpacity>
    );
  }

  if (svc.mode === 'info') {
    return (
      <View style={s.svcCard} testID={`gobierno-service-${svc.key}`}>
        <TouchableOpacity
          onPress={() => onToggle(svc.key)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          aria-expanded={expanded}
          accessibilityLabel={`${title} · ${expanded ? tr('Ocultar tarifas') : tr('Ver tarifas')}`}
          testID={`gobierno-service-${svc.key}-toggle`}
        >
          {head(
            { disc: 'rgba(57,184,255,0.12)', fg: COLORS.official },
            <Pill text={tr('Solo informativo')} fg={COLORS.official} bg="rgba(57,184,255,0.10)" border="rgba(57,184,255,0.35)" />,
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textMuted} />,
          )}
        </TouchableOpacity>
        {expanded && (
          <View style={s.fares} testID={`gobierno-service-${svc.key}-fares`}>
            {svc.facts.length > 0 ? (
              svc.facts.map((f, i) => <FactLine key={f.key} fact={f} lang={lang} first={i === 0} hedge={hedge} />)
            ) : (
              <Text style={s.factText}>{tr('Sin tarifas publicadas.')}</Text>
            )}
            <View style={s.noteRow}>
              <Ionicons name="information-circle-outline" size={14} color={COLORS.textFaint} style={s.noteIcon} />
              <Text style={s.noteText}>
                {tr('Solo informativo: aquí no hay pago. La tarifa se paga directamente al prestador del servicio.')}
              </Text>
            </View>
          </View>
        )}
      </View>
    );
  }

  if (svc.mode === 'amo') {
    return (
      <TouchableOpacity
        style={[s.svcCard, s.svcCardAmo]}
        onPress={() => onNavigate('/citypass')}
        activeOpacity={0.85}
        accessibilityRole="link"
        accessibilityLabel={`${title} · ${tr('Producto AMO · no municipal')}`}
        testID={`gobierno-service-${svc.key}`}
      >
        {head(
          { disc: 'rgba(233,185,73,0.14)', fg: COLORS.mustard },
          <Pill text={tr('Producto AMO · no municipal')} fg={COLORS.mustard} bg="rgba(233,185,73,0.10)" border="rgba(233,185,73,0.40)" />,
          <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />,
        )}
      </TouchableOpacity>
    );
  }

  // 'soon' (and any mode this client does not know): inert and muted — it can never start a payment.
  return (
    <View style={[s.svcCard, s.svcCardSoon]} testID={`gobierno-service-${svc.key}`} accessibilityState={{ disabled: true }} aria-disabled>
      {head(
        { disc: 'rgba(255,255,255,0.05)', fg: COLORS.iconMuted },
        <Pill text={tr('Próximamente')} fg={COLORS.textMuted} bg="rgba(255,255,255,0.05)" border="rgba(255,255,255,0.14)" />,
        null,
      )}
    </View>
  );
}

// ── Live "recaudo de la demo" strip ──────────────────────────────────────────
function SummaryStrip({
  summary, failed, onRetry, onOpenValidator,
}: { summary: SummaryPayload | null; failed: boolean; onRetry: () => void; onOpenValidator: () => void }) {
  const tr = useTr();
  const { lang } = useLang();
  const empty = summary !== null && summary.issued_n === 0;
  return (
    <View style={s.card} testID="gobierno-summary-card">
      <View style={s.cardHead}>
        <Ionicons name="pulse-outline" size={18} color={COLORS.icon} />
        <Text style={s.cardTitle} accessibilityRole="header">{tr('Recaudo de la demo')}</Text>
        {summary !== null && (
          <View style={s.countPill}>
            <Text style={s.countText}>{tr('Últimas')} {summary.window_h} h</Text>
          </View>
        )}
      </View>
      <Text style={s.sumBig} testID="gobierno-summary-collected">
        {summary !== null ? formatCop(summary.collected_cop, lang) : '—'}
      </Text>
      <Text style={s.small}>{tr('Recaudo simulado: nada de este dinero existe.')}</Text>

      <View style={s.statRow}>
        <View style={s.stat}>
          <Text style={s.statValue} testID="gobierno-summary-issued">{summary !== null ? String(summary.issued_n) : '—'}</Text>
          <Text style={s.statLabel}>{tr('Boletas emitidas')}</Text>
        </View>
        <View style={s.statDivider} />
        <View style={s.stat}>
          <Text style={s.statValue} testID="gobierno-summary-used">{summary !== null ? String(summary.used_n) : '—'}</Text>
          <Text style={s.statLabel}>{tr('Usadas')}</Text>
        </View>
      </View>

      {failed && (
        <TouchableOpacity style={s.inlineRetry} onPress={onRetry} accessibilityRole="button" accessibilityLabel={tr('Reintentar')}>
          <Ionicons name="refresh" size={14} color={COLORS.coral} />
          <Text style={s.inlineRetryText}>{tr('No pudimos actualizar el recaudo.')} {tr('Reintentar')}</Text>
        </TouchableOpacity>
      )}

      {empty && (
        <Text style={s.emptyNote} testID="gobierno-summary-empty">
          {tr('Aún no hay boletas demo. Emite una desde cualquier servicio de pago para ver el recaudo aquí.')}
        </Text>
      )}

      {summary !== null && summary.by_entity.length > 0 && (
        <View style={s.entities} testID="gobierno-summary-entities">
          <Text style={s.entitiesHead}>{tr('Por entidad')}</Text>
          {summary.by_entity.map((e) => (
            <View key={e.entity_es} style={s.entityRow}>
              <Text style={s.entityName} numberOfLines={2}>{e.entity_es}</Text>
              <Text style={s.entityCop}>{formatCop(e.cop, lang)}</Text>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity
        style={s.linkBtn}
        onPress={onOpenValidator}
        activeOpacity={0.85}
        accessibilityRole="link"
        accessibilityLabel={tr('Abrir validador')}
        testID="gobierno-open-validator"
      >
        <View style={s.linkIcon}>
          <Ionicons name="scan-outline" size={18} color={COLORS.official} />
        </View>
        <Text style={s.linkLabel}>{tr('Abrir validador')}</Text>
        <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────
export default function GobiernoHubScreen() {
  const tr = useTr();
  const { lang } = useLang();
  const router = useRouter();
  const { ready, token } = useCivicSession();

  const [services, setServices] = useState<ServicesPayload | null>(null);
  const [svcLoading, setSvcLoading] = useState(true);
  const [svcError, setSvcError] = useState<unknown>(null);
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [sumError, setSumError] = useState<unknown>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const loadServices = useCallback(async () => {
    if (!token) return;
    setSvcLoading(true);
    setSvcError(null);
    try {
      const payload = await getServices(token);
      if (alive.current) setServices(payload);
    } catch (e) {
      console.error('[GobiernoHub] services', e);
      if (alive.current) setSvcError(e);
    } finally {
      if (alive.current) setSvcLoading(false);
    }
  }, [token]);

  const loadSummary = useCallback(async () => {
    if (!token) return;
    try {
      const payload = await getSummary(token);
      if (alive.current) {
        setSummary(payload);
        setSumError(null);
      }
    } catch (e) {
      console.error('[GobiernoHub] summary', e);
      if (alive.current) setSumError(e);
    }
  }, [token]);

  useEffect(() => {
    void loadServices();
  }, [loadServices]);

  // The hub stays mounted under the checkout / boleta / validador: refresh the counter every time it
  // regains focus so "recaudo de la demo" is live after you come back from issuing or scanning.
  useFocusEffect(useCallback(() => {
    void loadSummary();
  }, [loadSummary]));

  // The main error card retries EVERYTHING: a hub that recovered its catalog but still shows "—" for the
  // counter would need a second, hidden retry.
  const retryAll = useCallback(() => {
    void loadServices();
    void loadSummary();
  }, [loadServices, loadSummary]);

  const goBack = useCallback(() => goBackOr(router), [router]);
  const navigate = useCallback((href: string) => {
    try {
      router.push(href as NavHref);
    } catch (e) {
      console.error('[GobiernoHub] navigate', href, e);
    }
  }, [router]);
  const toggle = useCallback((key: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // ── All hooks are above this line; the JSX below branches but never returns early. ──
  const needSession = ready && (!token || isAuthError(svcError) || isAuthError(sumError));
  const disclaimer = pickL2(services?.disclaimer ?? summary?.disclaimer ?? null, lang) || tr(DISCLAIMER_FALLBACK_ES);

  let body: React.ReactNode;
  if (!ready || (svcLoading && !services && !needSession)) {
    body = (
      <View style={s.skeletons} testID="gobierno-skeleton">
        <Skeleton height={120} borderRadius={RADIUS.xl} />
        <Skeleton height={84} borderRadius={RADIUS.xl} style={s.skelGap} />
        <Skeleton height={84} borderRadius={RADIUS.xl} style={s.skelGap} />
        <Skeleton height={84} borderRadius={RADIUS.xl} style={s.skelGap} />
      </View>
    );
  } else if (needSession) {
    body = (
      <StateCard
        icon="lock-closed-outline"
        title={tr('Sesión requerida')}
        text={tr('Esta demostración es solo para el Distrito. Ingresa con el código de acceso de la demostración.')}
        actionLabel={tr('Volver')}
        onAction={goBack}
        testID="gobierno-session-required"
      />
    );
  } else if (svcError !== null && !services) {
    body = (
      <StateCard
        icon="cloud-offline-outline"
        title={tr('No pudimos cargar la demostración')}
        text={civicErrorMessage(svcError, lang, tr, tr('La demostración no está disponible en este momento.'))}
        actionLabel={tr('Reintentar')}
        onAction={retryAll}
        testID="gobierno-error"
      />
    );
  } else if (services) {
    body = (
      <>
        <SecurityCard payload={services} />

        <View style={s.section} testID="gobierno-services">
          <View style={s.sectionHead}>
            <Ionicons name="apps-outline" size={16} color={COLORS.icon} />
            <Text style={s.sectionTitle} accessibilityRole="header">{tr('Servicios de la demo')}</Text>
            <View style={s.countPill}><Text style={s.countText}>{services.services.length}</Text></View>
          </View>
          <View style={s.svcList}>
            {services.services.map((svc) => (
              <ServiceCard key={svc.key} svc={svc} expanded={open.has(svc.key)} onToggle={toggle} onNavigate={navigate} />
            ))}
          </View>
        </View>

        <View style={s.section}>
          <SummaryStrip
            summary={summary}
            failed={sumError !== null}
            onRetry={loadSummary}
            onOpenValidator={() => navigate('/gobierno/validador')}
          />
        </View>
      </>
    );
  } else {
    body = null;
  }

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="gobierno-hub-screen">
      <Head>
        <title>{`${tr('Pagos ciudadanos')} · AMO Life`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <DemoHeader onBack={goBack} />
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={s.content}>
          <View style={s.hero}>
            <Text style={s.title} accessibilityRole="header">{tr('Pagos ciudadanos')}</Text>
            <Text style={s.subtitle}>{tr('Una demostración para el Distrito de Cartagena')}</Text>
          </View>

          <ModelCard />
          {body}
          <DisclaimerNote text={disclaimer} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },

  // header (pinned: the DEMO chip never scrolls away)
  headerBar: { borderBottomWidth: 1, borderBottomColor: COLORS.hairline, backgroundColor: COLORS.background },
  headerInner: { width: '100%', maxWidth: 560, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm + 4 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.hairline, alignItems: 'center', justifyContent: 'center' },
  headerSpacer: { flex: 1 },
  demoChip: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 28, backgroundColor: 'rgba(245,158,11,0.14)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.55)', borderRadius: RADIUS.full, paddingHorizontal: 11, paddingVertical: 4 },
  demoChipText: { fontSize: 11.5, color: DEMO_AMBER, ...FONTS.bold, letterSpacing: 1.4 },

  // hero
  hero: { paddingTop: SPACING.lg, paddingBottom: SPACING.xs, gap: 6 },
  title: { fontSize: 32, lineHeight: 38, color: COLORS.textMain, ...FONTS.bold, letterSpacing: -0.6 },
  subtitle: { ...TYPE.body, color: COLORS.textMuted },

  // cards + sections
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, marginTop: SPACING.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: SPACING.sm },
  cardTitle: { ...TYPE.headline, color: COLORS.textMain, flex: 1 },
  overline: { ...TYPE.overline, color: COLORS.textFaint, textTransform: 'uppercase', marginBottom: SPACING.md },
  section: { marginTop: SPACING.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: SPACING.sm },
  sectionTitle: { ...TYPE.title3, color: COLORS.textMain, flex: 1 },
  countPill: { backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.full, paddingHorizontal: 9, paddingVertical: 3, minWidth: 24, alignItems: 'center' },
  countText: { fontSize: 11, color: COLORS.textMuted, ...FONTS.bold },
  small: { fontSize: 11, lineHeight: 15, color: COLORS.textFaint, ...FONTS.medium },

  // model flow
  flow: { gap: 0 },
  flowRow: { flexDirection: 'row', gap: SPACING.md },
  flowRail: { alignItems: 'center', width: 40 },
  flowDisc: { width: 40, height: 40, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  flowLine: { flex: 1, width: 2, minHeight: 14, marginTop: 4, marginBottom: 4, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.12)' },
  flowText: { flex: 1, gap: 2, paddingTop: 2 },
  flowTextGap: { paddingBottom: SPACING.md },
  flowTitle: { fontSize: 15, lineHeight: 20, color: COLORS.textMain, ...FONTS.bold },
  flowCaption: { fontSize: 12.5, lineHeight: 18, color: COLORS.textMuted, ...FONTS.regular },

  // security
  secRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
  secIcon: { marginTop: 2 },
  secBody: { flex: 1, gap: 2 },
  secLabel: { ...TYPE.overline, color: COLORS.textFaint, textTransform: 'uppercase' },
  secValue: { fontSize: 13, lineHeight: 19, color: COLORS.textMain, ...FONTS.medium },

  // service cards
  svcList: { gap: SPACING.sm + 2 },
  svcCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  svcCardPay: { borderColor: 'rgba(18,181,165,0.32)', minHeight: 84 },
  svcCardAmo: { borderColor: 'rgba(233,185,73,0.32)' },
  svcCardSoon: { borderStyle: 'dashed', opacity: 0.62 },
  svcHead: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm + 4 },
  svcDisc: { width: 44, height: 44, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  svcBody: { flex: 1, gap: 4 },
  svcTitle: { fontSize: 15, lineHeight: 20, color: COLORS.textMain, ...FONTS.bold },
  svcMerchant: { fontSize: 12, lineHeight: 17, color: COLORS.textMuted, ...FONTS.regular },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  pill: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 9, paddingVertical: 3 },
  pillText: { fontSize: 10.5, ...FONTS.bold, letterSpacing: 0.3 },

  // info fares
  fares: { marginTop: SPACING.sm + 4, borderTopWidth: 1, borderTopColor: COLORS.hairline },
  factRow: { paddingVertical: 12, gap: 4 },
  factDivider: { borderTopWidth: 1, borderTopColor: COLORS.hairline },
  factLabel: { fontSize: 13, lineHeight: 17, color: COLORS.textMain, ...FONTS.semibold },
  factValueRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  factCop: { fontSize: 16, lineHeight: 20, color: COLORS.primary, ...FONTS.bold, letterSpacing: -0.2, fontVariant: ['tabular-nums'] },
  factText: { fontSize: 13, lineHeight: 18, color: COLORS.textMuted, ...FONTS.regular },
  verifyChip: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 2, borderColor: `${COLORS.coral}8C`, backgroundColor: `${COLORS.coral}1A` },
  verifyChipText: { flexShrink: 1, fontSize: 10.5, color: COLORS.coral, ...FONTS.bold, letterSpacing: 0.2 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.hairline },
  noteIcon: { marginTop: 1 },
  noteText: { flex: 1, fontSize: 12, lineHeight: 17, color: COLORS.textMuted, ...FONTS.medium },

  // summary strip
  sumBig: { fontSize: 34, lineHeight: 40, color: COLORS.textMain, ...FONTS.bold, letterSpacing: -0.6, fontVariant: ['tabular-nums'], marginTop: 2 },
  statRow: { flexDirection: 'row', alignItems: 'center', marginTop: SPACING.md, paddingVertical: SPACING.sm + 2, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statDivider: { width: 1, height: 28, backgroundColor: COLORS.hairline },
  statValue: { fontSize: 22, lineHeight: 26, color: COLORS.textMain, ...FONTS.bold, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium },
  inlineRetry: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, marginTop: SPACING.xs },
  inlineRetryText: { flex: 1, fontSize: 12.5, lineHeight: 17, color: COLORS.coral, ...FONTS.semibold },
  emptyNote: { marginTop: SPACING.sm, fontSize: 12.5, lineHeight: 18, color: COLORS.textMuted, ...FONTS.medium },
  entities: { marginTop: SPACING.md, gap: 2 },
  entitiesHead: { ...TYPE.overline, color: COLORS.textFaint, textTransform: 'uppercase', marginBottom: 4 },
  entityRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: SPACING.sm + 4, paddingVertical: 7, borderTopWidth: 1, borderTopColor: COLORS.hairline },
  entityName: { flex: 1, fontSize: 12.5, lineHeight: 17, color: COLORS.textMain, ...FONTS.medium },
  entityCop: { fontSize: 13, lineHeight: 17, color: COLORS.primary, ...FONTS.bold, fontVariant: ['tabular-nums'] },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: 52, paddingHorizontal: SPACING.md, paddingVertical: 10, marginTop: SPACING.md, backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: 'rgba(57,184,255,0.22)' },
  linkIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(57,184,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  linkLabel: { flex: 1, fontSize: 13.5, lineHeight: 18, color: COLORS.textMain, ...FONTS.semibold },

  // states
  skeletons: { marginTop: SPACING.lg },
  skelGap: { marginTop: SPACING.sm + 2 },
  stateCard: { alignItems: 'center', gap: 10, marginTop: SPACING.lg, padding: SPACING.lg, borderRadius: RADIUS.xl, backgroundColor: COLORS.surface, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.border },
  stateTitle: { ...TYPE.title3, color: COLORS.textMain, textAlign: 'center' },
  stateText: { ...TYPE.subhead, color: COLORS.textMuted, textAlign: 'center' },
  primaryBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, paddingHorizontal: SPACING.xl, paddingVertical: 12, borderRadius: RADIUS.full, marginTop: SPACING.xs },
  primaryBtnText: { fontSize: 14, color: COLORS.black, ...FONTS.bold },

  // disclaimer footer
  disclaimer: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: SPACING.xl, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(245,158,11,0.35)', backgroundColor: 'rgba(245,158,11,0.06)' },
  disclaimerIcon: { marginTop: 1 },
  disclaimerText: { flex: 1, fontSize: 12, lineHeight: 17, color: COLORS.textMuted, ...FONTS.medium },
});
