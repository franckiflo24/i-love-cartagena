// "Avísame" — save an event so the server reminds you before it starts
// (EVENTS-ELITE §13 J6 / §15 U). Never a toggle: it only ever ADDS a favorite.
//
// It promises a reminder only when the server would really send one:
//   published + HIGH + notif_eligible + confirmed start_time, reminders not off
//   in Perfil, a usable push channel (native permission granted/requestable, or
//   web push subscribable — the 'events' consent scope is added inside the tap),
//   and a reminders-cron tick still ahead in [start−180, start−30] ∩ 09:00–21:00
//   Bogotá. Anything short of that reads "Guardar" and says so after saving.
// Guests: the event is parked under '@amo_pending_avisame' and they go to
// /login?next=<here>; FavoritesContext saves it right after sign-in.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import type { PublicEvent } from '../lib/eventsFeed';
import { COLORS, RADIUS, FONTS } from '../constants/theme';
import { useTr } from '../i18n/autoTr';
import { useLang } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useFavorites } from '../context/FavoritesContext';
import { safeNext } from '../lib/safeNext';
import {
  type ChannelState,
  activateReminderChannel,
  isReminderEligible,
  loadEventNotifPrefs,
  reminderChannelState,
  reminderWindowAhead,
  saveEventNotifPrefs,
  savePendingAvisame,
  toEventLite,
} from '../lib/eventNotif';

type Props = { event: PublicEvent; compact?: boolean };

// Upper bound on the channel step inside the tap. It includes the browser's permission prompt
// (the user may read it for a while), so it is generous — but a channel that never answers must
// never keep the favorite from being saved.
const CHANNEL_TIMEOUT_MS = 20000;

async function activateWithin(ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      activateReminderChannel(),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), ms); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

type Mode = 'avisame' | 'activate' | 'guardar' | 'reminding' | 'saved';
type Tone = 'ok' | 'warn' | 'error';

const ICON: Record<Mode, keyof typeof Ionicons.glyphMap> = {
  avisame: 'notifications-outline',
  activate: 'notifications-outline',
  guardar: 'bookmark-outline',
  reminding: 'notifications',
  saved: 'bookmark',
};
const LABEL: Record<Mode, string> = {
  avisame: 'Avísame',
  activate: 'Avísame',
  guardar: 'Guardar',
  reminding: 'Te avisaremos',
  saved: 'Guardado',
};

export default function AvisameButton({ event, compact = false }: Props) {
  const tr = useTr();
  const { lang } = useLang();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const { isFavorite, ensureFavorite } = useFavorites();
  const userId = user?.user_id ?? null;

  const ev = useMemo(() => toEventLite(event), [event]);
  const [nowMs, setNowMs] = useState<number | null>(null); // after mount only (no SSR time math)
  const [channel, setChannel] = useState<ChannelState | null>(null);
  const [remindersOn, setRemindersOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: Tone } | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 60 * 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let alive = true;
    reminderChannelState().then((s) => { if (alive) setChannel(s); });
    return () => { alive = false; };
  }, [userId]);

  useEffect(() => {
    if (!userId) { setRemindersOn(null); return; }
    let alive = true;
    loadEventNotifPrefs(userId).then((p) => { if (alive) setRemindersOn(p ? p.reminders_enabled : null); });
    return () => { alive = false; };
  }, [userId]);

  const saved = !!ev && !!userId && isFavorite(ev.id);
  const eligible = !!ev && isReminderEligible(ev);
  const windowAhead = !!ev && nowMs !== null && reminderWindowAhead(ev, nowMs);
  // Unknown prefs (offline / first load) = default ON, like the server.
  const remindable = eligible && windowAhead && remindersOn !== false;

  let mode: Mode;
  if (saved) {
    if (remindable && channel === 'active') mode = 'reminding';
    else if (remindable && channel === 'requestable') mode = 'activate';
    else mode = 'saved';
  } else {
    mode = remindable && channel !== 'unavailable' ? 'avisame' : 'guardar';
  }
  const disabled = busy || mode === 'reminding' || mode === 'saved';

  const onPress = useCallback(async () => {
    if (!ev || busy || mode === 'reminding' || mode === 'saved') return;
    if (!userId) {
      try {
        await savePendingAvisame(ev.id);
      } catch (e) {
        console.error('[AvisameButton] park pending failed', e);
      }
      const next = safeNext(pathname) || `/event/${ev.id}`;
      router.push({ pathname: '/login', params: { next } } as never);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      // The channel goes FIRST: the web permission prompt needs the live gesture.
      let channelOk = channel === 'active';
      if (remindable && channel !== 'active' && channel !== 'unavailable') {
        channelOk = await activateWithin(CHANNEL_TIMEOUT_MS);
        setChannel(channelOk ? 'active' : await reminderChannelState());
      }
      const res = saved ? 'exists' : await ensureFavorite(ev.id, 'event');
      if (res === 'failed') {
        setMsg({ text: tr('No pudimos guardarlo · intenta de nuevo'), tone: 'error' });
        return;
      }
      if (remindable && channelOk) {
        setMsg({ text: tr('Listo · te avisamos antes de que empiece (máx. 1 aviso de eventos al día)'), tone: 'ok' });
        // The reminder is written in the language on file — keep it current.
        const prefs = await loadEventNotifPrefs(userId);
        if (prefs && prefs.lang !== lang) {
          saveEventNotifPrefs(userId, { ...prefs, lang }).catch((e: unknown) => {
            console.error('[AvisameButton] prefs lang sync failed', e);
          });
        }
      } else if (eligible && windowAhead && remindersOn === false) {
        setMsg({ text: tr('Guardado · tienes los recordatorios de eventos desactivados en Perfil'), tone: 'warn' });
      } else if (ev.status === 'date_tbc') {
        // Honest promise only: the saved row updates in Favoritos when the date is
        // confirmed (we never promise a push the reminders cron may not send).
        setMsg({ text: tr('Guardado · la fecha aparecerá aquí y en Favoritos en cuanto se confirme'), tone: 'ok' });
      } else {
        setMsg({ text: tr('Guardado · no podremos avisarte a tiempo'), tone: 'warn' });
      }
    } catch (e) {
      console.error('[AvisameButton] tap failed', e);
      setMsg({ text: tr('No pudimos guardarlo · intenta de nuevo'), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }, [ev, busy, mode, userId, pathname, router, channel, remindable, saved, ensureFavorite, tr, lang, eligible, windowAhead, remindersOn]);

  // Only rows the favorites API accepts (published / date_tbc `ce-` ids).
  if (!ev || (ev.status !== 'published' && ev.status !== 'date_tbc')) return null;

  if (nowMs === null) {
    return <View style={[styles.pill, compact ? styles.pillCompact : styles.pillFull, styles.pillGhost]} />;
  }

  const primary = mode === 'avisame' || mode === 'activate';
  const label = tr(LABEL[mode]);
  const iconColor = primary ? COLORS.white : COLORS.primary;

  return (
    <View style={compact ? styles.wrapCompact : styles.wrap}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled, busy }}
        testID={`avisame-${ev.id}`}
        style={({ pressed }) => [
          styles.pill,
          compact ? styles.pillCompact : styles.pillFull,
          primary ? styles.pillPrimary : styles.pillQuiet,
          pressed && !disabled && styles.pillPressed,
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={iconColor} />
        ) : (
          <Ionicons name={ICON[mode]} size={compact ? 14 : 17} color={iconColor} />
        )}
        <Text
          style={[styles.label, compact ? styles.labelCompact : styles.labelFull, primary ? styles.labelPrimary : styles.labelQuiet]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </Pressable>
      {msg ? (
        <Text
          style={[
            styles.msg,
            compact && styles.msgCompact,
            msg.tone === 'ok' ? styles.msgOk : msg.tone === 'error' ? styles.msgError : styles.msgWarn,
          ]}
          accessibilityLiveRegion="polite"
        >
          {msg.text}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: 8 },
  wrapCompact: { alignSelf: 'flex-start', gap: 6, maxWidth: 320 },
  pill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: RADIUS.full, borderWidth: 1,
  },
  pillFull: { minHeight: 46, paddingHorizontal: 20 },
  pillCompact: { minHeight: 44, paddingHorizontal: 14, alignSelf: 'flex-start' },
  pillPrimary: {
    backgroundColor: COLORS.primary, borderColor: 'rgba(62,208,193,0.55)',
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 14, elevation: 4,
  },
  pillQuiet: { backgroundColor: 'rgba(18,181,165,0.10)', borderColor: 'rgba(18,181,165,0.35)' },
  pillGhost: { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: COLORS.hairline, minWidth: 110 },
  pillPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  label: { letterSpacing: 0.2 },
  labelFull: { fontSize: 15, ...FONTS.bold },
  labelCompact: { fontSize: 12.5, ...FONTS.bold },
  labelPrimary: { color: COLORS.white },
  labelQuiet: { color: COLORS.primaryHover },
  msg: { fontSize: 12.5, lineHeight: 17, ...FONTS.medium },
  msgCompact: { fontSize: 11.5, lineHeight: 15 },
  msgOk: { color: COLORS.primaryHover },
  msgWarn: { color: COLORS.textMuted },
  msgError: { color: '#FCA5A5' },
});
