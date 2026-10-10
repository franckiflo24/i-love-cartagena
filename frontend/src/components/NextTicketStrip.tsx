// Home strip for the signed-in user's NEXT ticket (WALLET-DIGNITY, audit #4):
// a guest holding a ticket must find it from Home in one tap, not three rows
// deep in Perfil. Renders NOTHING unless the user holds an upcoming, unused
// ticket — Home never gains an empty slot, and a fetch failure stays silent
// here (the /tickets screen owns honest error states).
//
// Hydration (React #418): first render is null on server and client alike —
// the ticket only appears after a focus-effect fetch resolves.
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS, SPACING } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import { useTr } from '../i18n/autoTr';
import { formatShortDate } from '../lib/formatDate';
import { getMyTickets, isUpcomingTicket, ticketHref } from './tickets/tickets';
import type { Ticket } from './tickets/tickets';

export default function NextTicketStrip() {
  const tr = useTr();
  const { lang } = useLang();
  const router = useRouter();
  const { user } = useAuth();
  const userId = user ? user.user_id : null;
  const [ticket, setTicket] = useState<Ticket | null>(null);

  useFocusEffect(useCallback(() => {
    if (!userId) {
      setTicket(null);
      return undefined;
    }
    let alive = true;
    getMyTickets()
      .then((rows) => {
        if (!alive) return;
        const next = rows
          .filter((t) => t.status === 'issued' && isUpcomingTicket(t))
          .sort((a, b) => (a.date || '9999-99-99').localeCompare(b.date || '9999-99-99'))[0];
        setTicket(next ?? null);
      })
      .catch(() => undefined); // silent by design — see header comment
    return () => {
      alive = false;
    };
  }, [userId]));

  const open = useCallback(() => {
    if (ticket) router.push(ticketHref(ticket.ticket_id) as never);
  }, [router, ticket]);

  if (!ticket) return null;
  const when = [formatShortDate(ticket.date, lang), ticket.start_time].filter((p) => !!p).join(' · ');
  const venue = ticket.venue_name || ticket.partner_name;
  return (
    <TouchableOpacity
      style={s.strip}
      onPress={open}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`${tr('Tu próxima entrada')}: ${ticket.title || tr('Entrada')}${when ? `, ${when}` : ''}`}
      testID="home-next-ticket"
    >
      <View style={s.iconWrap}>
        <Ionicons name="ticket" size={18} color={COLORS.primary} />
      </View>
      <View style={s.body}>
        <Text style={s.kicker}>{tr('Tu próxima entrada')}</Text>
        <Text style={s.title} numberOfLines={1}>{ticket.title || tr('Entrada')}</Text>
        {!!(when || venue) && (
          <Text style={s.meta} numberOfLines={1}>{[when, venue].filter((p) => !!p).join(' · ')}</Text>
        )}
      </View>
      <View style={s.qrHint}>
        <Ionicons name="qr-code-outline" size={20} color={COLORS.primary} />
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  strip: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm + 4,
    marginHorizontal: SPACING.lg, marginBottom: SPACING.md,
    minHeight: 68, paddingHorizontal: SPACING.md, paddingVertical: 10,
    backgroundColor: 'rgba(18,181,165,0.08)', borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: 'rgba(18,181,165,0.35)',
  },
  iconWrap: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(18,181,165,0.14)',
  },
  body: { flex: 1, gap: 1 },
  kicker: { fontSize: 10.5, color: COLORS.primary, ...FONTS.bold, letterSpacing: 0.8, textTransform: 'uppercase' },
  title: { fontSize: 14.5, lineHeight: 19, color: COLORS.textMain, ...FONTS.semibold },
  meta: { fontSize: 12, lineHeight: 16, color: COLORS.textMuted, ...FONTS.medium },
  qrHint: { alignItems: 'center', justifyContent: 'center', paddingLeft: 2 },
});
