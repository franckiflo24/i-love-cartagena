// /tickets — "Mis entradas": the signed-in user's free event tickets, newest first (the order GET /tickets/mine
// answers in). Tapping a card opens its live credential at /ticket/[id].
//
// Honest states: `tickets` is null until the first answer (never an empty array that would flash "no tickets" at
// someone who has some). A refresh that fails keeps the list on screen and says so — it never swaps data for a
// skeleton or an error card. Overlapping loads (focus + pull-to-refresh) are generation-tagged: a slow answer can
// never overwrite a newer one. A ticket is a free registration: no price, no checkout, anywhere.
//
// Hydration (React #418): the first render is the same on the server and the client (signed-out-until-proven
// skeleton) because nothing here reads a clock, a device value or a stored session before an effect has run.
// All hooks sit above the JSX; there is no early return.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Head from '../src/components/WebHead';
import { Skeleton } from '../src/components/Skeleton';
import {
  getMyTickets, isAuthError, ticketHref, ticketsErrorMessage,
} from '../src/components/tickets/tickets';
import type { Ticket } from '../src/components/tickets/tickets';
import { COLORS, FONTS, RADIUS, SPACING, TYPE } from '../src/constants/theme';
import { useAuth } from '../src/context/AuthContext';
import { useLang } from '../src/context/LanguageContext';
import type { Lang } from '../src/i18n/translations';
import { useTr } from '../src/i18n/autoTr';
import { formatShortDate, monthShort, weekdayShort } from '../src/lib/formatDate';
import { goBackOr } from '../src/lib/nav';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** The date "stub" of a card: weekday / day / month. null when the event published no readable date. */
function stubParts(date: string, lang: Lang): { dow: string; day: string; mon: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Local calendar-date constructor: the weekday of the DATE, whatever timezone the phone is set to.
  return { dow: weekdayShort(new Date(y, mo - 1, d).getDay(), lang, true), day: String(d), mon: monthShort(mo - 1, lang, true) };
}

function StateCard({
  icon, title, text, actionLabel, onAction, testID,
}: { icon: IconName; title: string; text?: string; actionLabel?: string; onAction?: () => void; testID: string }) {
  return (
    <View style={s.stateCard} testID={testID} accessibilityRole="alert">
      <Ionicons name={icon} size={30} color={COLORS.textMuted} />
      <Text style={s.stateTitle}>{title}</Text>
      {!!text && <Text style={s.stateText}>{text}</Text>}
      {!!actionLabel && !!onAction && (
        <TouchableOpacity style={s.primaryBtn} onPress={onAction} accessibilityRole="button" accessibilityLabel={actionLabel}>
          <Text style={s.primaryBtnText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function TicketCard({ ticket, lang, onOpen }: { ticket: Ticket; lang: Lang; onOpen: (ticketId: string) => void }) {
  const tr = useTr();
  const used = ticket.status === 'used';
  const venue = ticket.venue_name || ticket.partner_name;
  const stub = stubParts(ticket.date, lang);
  const when = [formatShortDate(ticket.date, lang), ticket.start_time].filter((p) => !!p).join(' · ');
  const title = ticket.title || tr('Entrada');
  const status = used ? tr('Utilizada') : tr('Activa');
  const label = [title, venue, when, status].filter((p) => !!p).join(', ');
  return (
    <TouchableOpacity
      style={[s.card, !used && s.cardLive]}
      onPress={() => onOpen(ticket.ticket_id)}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`ticket-card-${ticket.ticket_id}`}
    >
      <View style={[s.stub, used && s.stubUsed]}>
        {stub ? (
          <>
            <Text style={[s.stubDow, used && s.stubMuted]}>{stub.dow}</Text>
            <Text style={[s.stubDay, used && s.stubDayUsed]}>{stub.day}</Text>
            <Text style={s.stubMon}>{stub.mon}</Text>
          </>
        ) : (
          <Ionicons name="ticket-outline" size={24} color={used ? COLORS.textMuted : COLORS.primary} />
        )}
      </View>
      <View style={s.cardBody}>
        <Text style={s.cardTitle} numberOfLines={2}>{title}</Text>
        {!!venue && <Text style={s.cardMeta} numberOfLines={1}>{venue}</Text>}
        {!!ticket.start_time && <Text style={s.cardMeta} numberOfLines={1}>{ticket.start_time}</Text>}
      </View>
      <View style={s.cardRight}>
        <View style={[s.chip, used ? s.chipUsed : s.chipLive]} testID={`ticket-card-status-${ticket.ticket_id}`}>
          <Text style={[s.chipText, used ? s.chipTextUsed : s.chipTextLive]}>{status}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

export default function TicketsScreen() {
  const tr = useTr();
  const { lang } = useLang();
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const userId = user ? user.user_id : null;

  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [authLost, setAuthLost] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);

  // A different account starts from scratch: never show one user's tickets under another.
  useEffect(() => {
    generation.current += 1;
    setTickets(null);
    setLoadError(null);
    setAuthLost(false);
  }, [userId]);

  const load = useCallback(async (): Promise<void> => {
    if (!userId) return;
    generation.current += 1;
    const mine = generation.current;
    try {
      const rows = await getMyTickets();
      if (mine !== generation.current) return;
      setTickets(rows);
      setLoadError(null);
      setAuthLost(false);
    } catch (e) {
      if (mine !== generation.current) return;
      console.error('[Tickets] load', e);
      if (isAuthError(e)) setAuthLost(true);
      else setLoadError(e);
    }
  }, [userId]);

  // Every time the screen regains focus (e.g. back from a ticket that was just scanned at the door).
  useFocusEffect(useCallback(() => {
    if (userId) void load();
    return undefined;
  }, [userId, load]));

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);
  const retry = useCallback(() => {
    setLoadError(null);
    void load();
  }, [load]);

  const goBack = useCallback(() => goBackOr(router), [router]);
  const goLogin = useCallback(() => router.push('/login?next=/tickets'), [router]);
  const goEvents = useCallback(() => router.push('/que-pasa'), [router]);
  const openTicket = useCallback((ticketId: string) => router.push(ticketHref(ticketId)), [router]);

  // ── All hooks are above this line; the JSX below branches but never returns early. ──
  const needLogin = (!isLoading && !userId) || authLost;

  let body: React.ReactNode;
  if (needLogin) {
    body = (
      <StateCard
        icon="lock-closed-outline"
        title={tr('Inicia sesión para ver tus entradas')}
        text={tr('Tus entradas están ligadas a tu cuenta.')}
        actionLabel={tr('Iniciar sesión')}
        onAction={goLogin}
        testID="tickets-session-required"
      />
    );
  } else if (tickets === null) {
    body = loadError ? (
      <StateCard
        icon="cloud-offline-outline"
        title={tr('No pudimos cargar tus entradas')}
        text={ticketsErrorMessage(loadError, lang, tr)}
        actionLabel={tr('Reintentar')}
        onAction={retry}
        testID="tickets-error"
      />
    ) : (
      <View style={s.skeletons} testID="tickets-skeleton">
        <Skeleton height={92} borderRadius={RADIUS.xl} />
        <Skeleton height={92} borderRadius={RADIUS.xl} />
        <Skeleton height={92} borderRadius={RADIUS.xl} />
      </View>
    );
  } else if (tickets.length === 0) {
    body = (
      <StateCard
        icon="ticket-outline"
        title={tr('Aún no tienes entradas — reserva en cualquier evento')}
        actionLabel={tr('Ver eventos')}
        onAction={goEvents}
        testID="tickets-empty"
      />
    );
  } else {
    body = (
      <>
        {!!loadError && (
          <TouchableOpacity style={s.banner} onPress={retry} accessibilityRole="button" testID="tickets-refresh-error">
            <Ionicons name="alert-circle-outline" size={16} color={COLORS.coral} />
            <Text style={s.bannerText}>{tr('No pudimos actualizar tus entradas. Toca para reintentar.')}</Text>
          </TouchableOpacity>
        )}
        <View style={s.list} testID="tickets-list">
          {tickets.map((t) => (
            <TicketCard key={t.ticket_id} ticket={t} lang={lang} onOpen={openTicket} />
          ))}
        </View>
      </>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['top']} testID="tickets-screen">
      <Head>
        <title>{`${tr('Mis entradas')} · AMO Life`}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <View style={s.header}>
        <TouchableOpacity
          style={s.backBtn}
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel={tr('Volver')}
          testID="tickets-back-btn"
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.textMain} />
        </TouchableOpacity>
        <Text style={s.title} accessibilityRole="header">{tr('Mis entradas')}</Text>
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        <View style={s.content}>{body}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },

  // header (pinned)
  header: { width: '100%', maxWidth: 560, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.hairline, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, ...TYPE.title1, color: COLORS.textMain },

  // list
  list: { gap: SPACING.sm + 4 },
  card: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, minHeight: 92, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border },
  cardLive: { borderColor: 'rgba(18,181,165,0.30)' },
  stub: { width: 56, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: RADIUS.md, backgroundColor: 'rgba(18,181,165,0.10)', borderWidth: 1, borderColor: 'rgba(18,181,165,0.30)' },
  stubUsed: { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: COLORS.hairline },
  stubDow: { fontSize: 10, lineHeight: 13, color: COLORS.primary, ...FONTS.bold, letterSpacing: 1 },
  stubMuted: { color: COLORS.textMuted },
  stubDay: { fontSize: 22, lineHeight: 26, color: COLORS.textMain, ...FONTS.bold, fontVariant: ['tabular-nums'] },
  stubDayUsed: { color: COLORS.textMuted },
  stubMon: { fontSize: 10, lineHeight: 13, color: COLORS.textMuted, ...FONTS.bold, letterSpacing: 1 },
  cardBody: { flex: 1, gap: 2 },
  cardTitle: { ...TYPE.headline, color: COLORS.textMain },
  cardMeta: { fontSize: 12.5, lineHeight: 17, color: COLORS.textMuted, ...FONTS.medium },
  cardRight: { alignItems: 'flex-end', justifyContent: 'center', gap: 8 },
  chip: { borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: 9, paddingVertical: 3 },
  chipLive: { borderColor: 'rgba(18,181,165,0.45)', backgroundColor: 'rgba(18,181,165,0.14)' },
  chipUsed: { borderColor: COLORS.hairline, backgroundColor: 'rgba(255,255,255,0.06)' },
  chipText: { fontSize: 10.5, ...FONTS.bold, letterSpacing: 0.5, textTransform: 'uppercase' },
  chipTextLive: { color: COLORS.primary },
  chipTextUsed: { color: COLORS.textMuted },

  // refresh-failed banner
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, marginBottom: SPACING.sm + 4, paddingHorizontal: SPACING.md, paddingVertical: 8, borderRadius: RADIUS.md, borderWidth: 1, borderColor: `${COLORS.coral}8C`, backgroundColor: `${COLORS.coral}1A` },
  bannerText: { flex: 1, fontSize: 12.5, lineHeight: 17, color: COLORS.textMain, ...FONTS.medium },

  // states
  skeletons: { gap: SPACING.sm + 4 },
  stateCard: { alignItems: 'center', gap: 10, marginTop: SPACING.lg, padding: SPACING.lg, borderRadius: RADIUS.xl, backgroundColor: COLORS.surface, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.border },
  stateTitle: { ...TYPE.title3, color: COLORS.textMain, textAlign: 'center' },
  stateText: { ...TYPE.subhead, color: COLORS.textMuted, textAlign: 'center' },
  primaryBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, paddingHorizontal: SPACING.xl, paddingVertical: 12, borderRadius: RADIUS.full, marginTop: SPACING.xs },
  primaryBtnText: { fontSize: 14, color: COLORS.black, ...FONTS.bold },
});
