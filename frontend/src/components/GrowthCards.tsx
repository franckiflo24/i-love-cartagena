// Perfil growth section (Master Plan 1.4 + 1.5): push opt-in, referral code,
// PWA install. All value-first, zero nag: rows render only when actionable.
//
// EVENTS-ELITE (§13 H3/J7): web push consent is split by SCOPE — the passport
// row below covers streak/reward milestones only; event reminders have their
// own consent row inside EventNotifCard (Perfil › Notificaciones).

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Share, Platform, Switch, Pressable, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { useTr } from '../i18n/autoTr';
import { useLang } from '../context/LanguageContext';
import { pushState, pushScopes, subscribePush, unsubscribePush, PushState } from '../lib/push';
import { myReferral } from '../lib/referral';
import { geoService, type GeoStatus } from '../lib/geo';
import {
  type ChannelState,
  type EventCategory,
  type EventNotifPrefs,
  type NearbyPrefs,
  DEFAULT_EVENT_NOTIF_PREFS,
  EVENT_CATEGORIES,
  activateReminderChannel,
  loadEventNotifPrefs,
  readNearbyPrefs,
  reminderChannelState,
  saveEventNotifPrefs,
  writeNearbyPrefs,
} from '../lib/eventNotif';
import { CATEGORY_META } from '../lib/eventsFeed';

let deferredInstall: any = null;
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  try {
    window.addEventListener('beforeinstallprompt', (e: any) => {
      e.preventDefault();
      deferredInstall = e;
    });
  } catch {}
}

export function GrowthCards({ signedIn }: { signedIn: boolean }) {
  const tr = useTr();
  const [push, setPush] = useState<PushState>('unsupported');
  const [passportOn, setPassportOn] = useState(false);
  const [ref, setRef] = useState<{ code: string; referred_count: number; points_each: number; share_url: string } | null>(null);
  const [canInstall, setCanInstall] = useState(!!deferredInstall);
  const [copied, setCopied] = useState(false);
  const [iosInstall, setIosInstall] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshPush = useCallback(async () => {
    const st = await pushState();
    setPush(st);
    setPassportOn(st === 'subscribed' && (await pushScopes()).includes('passport'));
  }, []);

  useEffect(() => {
    refreshPush();
    if (signedIn) myReferral().then(setRef);
    const t = setInterval(() => setCanInstall(!!deferredInstall), 3000);
    // iOS Safari never fires beforeinstallprompt, so show a manual "Add to Home
    // Screen" hint there (unless already installed) — an installed PWA keeps the
    // user logged in like a native app, the most persistent path of all.
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        const ua = (window.navigator?.userAgent) || '';
        const isIOS = /iPhone|iPad|iPod/.test(ua);
        const standalone = (window.navigator as any)?.standalone === true
          || window.matchMedia?.('(display-mode: standalone)')?.matches;
        setIosInstall(isIOS && !standalone);
      } catch { /* noop */ }
    }
    return () => clearInterval(t);
  }, [signedIn, refreshPush]);

  // Passport scope only — the event-reminder consent is a separate row.
  const togglePush = useCallback(async () => {
    setBusy(true);
    if (passportOn) await unsubscribePush('passport');
    else await subscribePush(['passport']);
    await refreshPush();
    setBusy(false);
  }, [passportOn, refreshPush]);

  const shareRef = useCallback(async () => {
    if (!ref) return;
    const msg = `Únete a AMO Life con mi código y ambos ganamos ${ref.points_each} puntos 🎁 ${ref.share_url}`;
    try {
      if (Platform.OS === 'web' && (navigator as any)?.share) {
        await (navigator as any).share({ text: msg, url: ref.share_url });
      } else if (Platform.OS === 'web') {
        await (navigator as any)?.clipboard?.writeText?.(msg);
        // Desktop web has no share sheet — a silent copy reads as broken.
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
      } else {
        await Share.share({ message: msg });
      }
    } catch {}
  }, [ref]);

  const install = useCallback(async () => {
    try {
      if (deferredInstall) {
        deferredInstall.prompt();
        await deferredInstall.userChoice;
        deferredInstall = null;
        setCanInstall(false);
      }
    } catch {}
  }, []);

  const showPush = signedIn && (push === 'ready' || push === 'subscribed');
  if (!showPush && !signedIn && !canInstall && !iosInstall) return null;

  return (
    <View style={styles.card}>
      {signedIn && !!ref && (
        <TouchableOpacity style={styles.row} onPress={shareRef} activeOpacity={0.85}>
          <Ionicons name="gift" size={20} color={COLORS.icon} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{copied ? tr('¡Código copiado! Pégalo donde quieras') : `${tr('Invita a un amigo — ambos ganan')} ${ref.points_each} pts`}</Text>
            <Text style={styles.rowSub}>
              {tr('Tu código')}: <Text style={styles.code}>{ref.code}</Text>
              {ref.referred_count > 0 ? ` · ${ref.referred_count} ${tr('amigos unidos')}` : ''}
            </Text>
          </View>
          <Ionicons name="share-social" size={18} color={COLORS.icon} />
        </TouchableOpacity>
      )}
      {showPush && (
        <TouchableOpacity style={styles.row} onPress={togglePush} disabled={busy} activeOpacity={0.85}>
          <Ionicons name={passportOn ? 'notifications' : 'notifications-outline'} size={20} color={COLORS.icon} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{tr('Avisos de tu pasaporte')}</Text>
            <Text style={styles.rowSub}>
              {passportOn
                ? tr('Activado — máximo 1 al día, solo hitos tuyos')
                : tr('Hitos de racha y recompensas — máximo 1 al día, sin spam')}
            </Text>
          </View>
          <Text style={styles.toggle}>{busy ? '…' : passportOn ? tr('Quitar') : tr('Activar')}</Text>
        </TouchableOpacity>
      )}
      {canInstall && (
        <TouchableOpacity style={styles.row} onPress={install} activeOpacity={0.85}>
          <Ionicons name="download" size={20} color={COLORS.icon} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{tr('Instalar AMO')}</Text>
            <Text style={styles.rowSub}>{tr('Acceso directo en tu pantalla de inicio')}</Text>
          </View>
        </TouchableOpacity>
      )}
      {iosInstall && !canInstall && (
        <View style={styles.row}>
          <Ionicons name="add-circle-outline" size={20} color={COLORS.icon} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{tr('Instalar AMO')}</Text>
            <Text style={styles.rowSub}>{tr('Toca Compartir y luego “Agregar a inicio” — abre la app y quedas siempre conectado')}</Text>
          </View>
          <Ionicons name="share-outline" size={18} color={COLORS.icon} />
        </View>
      )}
    </View>
  );
}

// ── Perfil › Notificaciones (EVENTS-ELITE §13 J7, web now + native 1.1.2) ──
// Row 1 "Recordatorios de eventos guardados": server pref (default ON) via
//   GET/PUT /me/event-notif-prefs, plus this device's channel (web: the 'events'
//   consent scope; native: OS permission).
// Row 2 "Eventos verificados cerca de mí": LOCAL opt-in (default OFF, guests
//   too) + categories, mirrored to the account only when its server state is known
//   (a failed read must never overwrite the user's other choices).
type RowBusy = 'reminders' | 'channel' | 'nearby' | null;

export function EventNotifCard({ signedIn, userId, flush = false }: { signedIn: boolean; userId: string | null; flush?: boolean }) {
  const tr = useTr();
  const { lang } = useLang();
  const router = useRouter();
  const [prefs, setPrefs] = useState<EventNotifPrefs>(DEFAULT_EVENT_NOTIF_PREFS);
  const [prefsKnown, setPrefsKnown] = useState(false);
  const [nearby, setNearby] = useState<NearbyPrefs>({ optIn: false, categories: [...EVENT_CATEGORIES] });
  const [channel, setChannel] = useState<ChannelState | null>(null);
  const [geoStatus, setGeoStatus] = useState<GeoStatus | null>(null);
  const [busy, setBusy] = useState<RowBusy>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    readNearbyPrefs().then((p) => { if (alive) setNearby(p); });
    geoService.syncPermission().then((s) => { if (alive) setGeoStatus(s); }).catch((e: unknown) => {
      console.error('[EventNotifCard] geo permission read failed', e);
    });
    reminderChannelState().then((c) => { if (alive) setChannel(c); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!signedIn || !userId) { setPrefsKnown(false); return; }
    let alive = true;
    loadEventNotifPrefs(userId, true).then((p) => {
      if (!alive) return;
      if (p) { setPrefs(p); setPrefsKnown(true); } else { setPrefsKnown(false); }
    });
    return () => { alive = false; };
  }, [signedIn, userId]);

  // Reminder text is written in the language on file: follow the app language.
  useEffect(() => {
    if (!signedIn || !userId || !prefsKnown || prefs.lang === lang) return;
    const next = { ...prefs, lang };
    saveEventNotifPrefs(userId, next)
      .then(() => setPrefs(next))
      .catch((e: unknown) => console.error('[EventNotifCard] lang sync failed', e));
  }, [signedIn, userId, prefsKnown, prefs, lang]);

  const toggleReminders = useCallback(async (next: boolean) => {
    if (!userId) return;
    setError(null);
    setBusy('reminders');
    const prev = prefs;
    const body: EventNotifPrefs = {
      ...prev,
      reminders_enabled: next,
      lang,
      ...(prefsKnown ? {} : { nearby_enabled: nearby.optIn, categories: nearby.categories }),
    };
    setPrefs(body);
    try {
      await saveEventNotifPrefs(userId, body);
      setPrefsKnown(true);
    } catch (e) {
      console.error('[EventNotifCard] save reminders pref failed', e);
      setPrefs(prev);
      setError(tr('No pudimos guardar tu preferencia. Intenta de nuevo.'));
    } finally {
      setBusy(null);
    }
  }, [userId, prefs, prefsKnown, lang, nearby, tr]);

  // Channel activation is its own tap: the browser prompt needs the gesture.
  const activateChannel = useCallback(async () => {
    setError(null);
    setBusy('channel');
    try {
      await activateReminderChannel();
      setChannel(await reminderChannelState());
    } finally {
      setBusy(null);
    }
  }, []);

  const deactivateWebChannel = useCallback(async () => {
    setError(null);
    setBusy('channel');
    try {
      await unsubscribePush('events');
      setChannel(await reminderChannelState());
    } finally {
      setBusy(null);
    }
  }, []);

  const mirrorNearby = useCallback((p: NearbyPrefs) => {
    if (!signedIn || !userId || !prefsKnown) return;
    const next: EventNotifPrefs = { ...prefs, lang, nearby_enabled: p.optIn, categories: p.categories };
    saveEventNotifPrefs(userId, next)
      .then(() => setPrefs(next))
      .catch((e: unknown) => console.error('[EventNotifCard] nearby mirror failed', e));
  }, [signedIn, userId, prefsKnown, prefs, lang]);

  const toggleNearby = useCallback(async (next: boolean) => {
    setError(null);
    setBusy('nearby');
    try {
      // Turning it on is an explicit gesture with the privacy line on screen —
      // the one place we may ask for location. The card itself never asks.
      if (next && geoStatus === 'not-asked') setGeoStatus(await geoService.request());
      const p: NearbyPrefs = { ...nearby, optIn: next };
      await writeNearbyPrefs({ optIn: next });
      setNearby(p);
      mirrorNearby(p);
    } catch (e) {
      console.error('[EventNotifCard] nearby toggle failed', e);
      setError(tr('No pudimos guardar tu preferencia. Intenta de nuevo.'));
    } finally {
      setBusy(null);
    }
  }, [geoStatus, nearby, mirrorNearby, tr]);

  const toggleCategory = useCallback(async (cat: EventCategory) => {
    const has = nearby.categories.includes(cat);
    if (has && nearby.categories.length <= 1) return; // at least one category
    const categories = has ? nearby.categories.filter((c) => c !== cat) : [...nearby.categories, cat];
    const p: NearbyPrefs = { ...nearby, categories };
    setNearby(p);
    try {
      await writeNearbyPrefs({ categories });
      mirrorNearby(p);
    } catch (e) {
      console.error('[EventNotifCard] category save failed', e);
      setError(tr('No pudimos guardar tu preferencia. Intenta de nuevo.'));
    }
  }, [nearby, mirrorNearby, tr]);

  const openSettings = useCallback(() => {
    Linking.openSettings().catch((e: unknown) => console.error('[EventNotifCard] open settings failed', e));
  }, []);

  const remindersOn = prefs.reminders_enabled;
  const isWeb = Platform.OS === 'web';
  const switchColors = { false: COLORS.surfaceAlt, true: COLORS.primary };

  return (
    <View style={[styles.eCard, flush && styles.eCardFlush]} testID="event-notif-card">
      <Text style={styles.eTitle}>{tr('Notificaciones')}</Text>

      {signedIn ? (
        <>
          <View style={styles.eRow}>
            <Pressable
              style={styles.eRowPress}
              onPress={() => toggleReminders(!remindersOn)}
              disabled={busy === 'reminders'}
              accessibilityRole="switch"
              accessibilityState={{ checked: remindersOn, disabled: busy === 'reminders' }}
              testID="notif-reminders-row"
            >
              <View style={styles.eIcon}><Ionicons name="notifications-outline" size={18} color={COLORS.icon} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{tr('Recordatorios de eventos guardados')}</Text>
                <Text style={styles.rowSub}>{tr('Hasta 3 h antes · 09:00–21:00 · máx. 1 al día')}</Text>
              </View>
            </Pressable>
            <Switch
              value={remindersOn}
              onValueChange={toggleReminders}
              disabled={busy === 'reminders'}
              trackColor={switchColors}
              thumbColor={COLORS.white}
              ios_backgroundColor={COLORS.surfaceAlt}
              accessibilityLabel={tr('Recordatorios de eventos guardados')}
              testID="notif-reminders-switch"
            />
          </View>
          {remindersOn && channel === 'requestable' && (
            <View style={styles.eSub}>
              <Text style={styles.consent}>
                {isWeb ? tr('Recordatorios de eventos que guardas — máximo 1 al día') : tr('Permite las notificaciones para recibir tus recordatorios')}
              </Text>
              <Pressable
                onPress={activateChannel}
                disabled={busy === 'channel'}
                accessibilityRole="button"
                style={({ pressed }) => [styles.eBtn, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.eBtnText}>
                  {busy === 'channel' ? '…' : isWeb ? tr('Activar en este navegador') : tr('Permitir notificaciones')}
                </Text>
              </Pressable>
            </View>
          )}
          {remindersOn && channel === 'active' && isWeb && (
            <View style={styles.eSubRow}>
              <Ionicons name="checkmark-circle" size={14} color={COLORS.primaryHover} />
              <Text style={[styles.consent, { flex: 1 }]}>{tr('Activos en este navegador')}</Text>
              <Pressable onPress={deactivateWebChannel} disabled={busy === 'channel'} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.toggle}>{busy === 'channel' ? '…' : tr('Quitar')}</Text>
              </Pressable>
            </View>
          )}
          {remindersOn && channel === 'unavailable' && (
            <View style={styles.eSubRow}>
              <Ionicons name="alert-circle-outline" size={14} color={COLORS.textMuted} />
              <Text style={[styles.consent, { flex: 1 }]}>
                {isWeb ? tr('Este navegador no puede recibir avisos') : tr('Activa las notificaciones de AMO en Ajustes')}
              </Text>
              {!isWeb && (
                <Pressable onPress={openSettings} accessibilityRole="button" hitSlop={8}>
                  <Text style={styles.toggle}>{tr('Abrir Ajustes')}</Text>
                </Pressable>
              )}
            </View>
          )}
        </>
      ) : (
        <Pressable
          style={({ pressed }) => [styles.eRow, pressed && { opacity: 0.85 }]}
          onPress={() => router.push({ pathname: '/login', params: { next: '/perfil' } } as never)}
          accessibilityRole="button"
        >
          <View style={styles.eIcon}><Ionicons name="notifications-outline" size={18} color={COLORS.icon} /></View>
          <Text style={[styles.rowSub, { flex: 1 }]}>{tr('Inicia sesión para recibir recordatorios de los eventos que guardas')}</Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
        </Pressable>
      )}

      <View style={[styles.eRow, styles.eRowLast]}>
        <Pressable
          style={styles.eRowPress}
          onPress={() => toggleNearby(!nearby.optIn)}
          disabled={busy === 'nearby'}
          accessibilityRole="switch"
          accessibilityState={{ checked: nearby.optIn, disabled: busy === 'nearby' }}
          testID="notif-nearby-row"
        >
          <View style={styles.eIcon}><Ionicons name="navigate-outline" size={18} color={COLORS.icon} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{tr('Eventos verificados cerca de mí')}</Text>
            <Text style={styles.rowSub}>{tr('Para esta función tu ubicación se usa solo en tu teléfono; no la enviamos a AMO.')}</Text>
          </View>
        </Pressable>
        <Switch
          value={nearby.optIn}
          onValueChange={toggleNearby}
          disabled={busy === 'nearby'}
          trackColor={switchColors}
          thumbColor={COLORS.white}
          ios_backgroundColor={COLORS.surfaceAlt}
          accessibilityLabel={tr('Eventos verificados cerca de mí')}
          testID="notif-nearby-switch"
        />
      </View>
      {nearby.optIn && geoStatus === 'denied' && (
        <View style={styles.eSubRow}>
          <Ionicons name="alert-circle-outline" size={14} color={COLORS.textMuted} />
          <Text style={[styles.consent, { flex: 1 }]}>{tr('Sin permiso de ubicación: actívalo en Ajustes')}</Text>
          {!isWeb && (
            <Pressable onPress={openSettings} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.toggle}>{tr('Abrir Ajustes')}</Text>
            </Pressable>
          )}
        </View>
      )}
      {nearby.optIn && (
        <View style={styles.eCats}>
          <Text style={styles.catsLabel}>{tr('Qué eventos te interesan')}</Text>
          <View style={styles.chips}>
            {EVENT_CATEGORIES.map((cat) => {
              const on = nearby.categories.includes(cat);
              return (
                <Pressable
                  key={cat}
                  onPress={() => toggleCategory(cat)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && { opacity: 0.85 }]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{tr(CATEGORY_META[cat].label)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: SPACING.lg, marginBottom: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  rowTitle: { fontSize: 13, color: COLORS.textMain, ...FONTS.bold },
  rowSub: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, marginTop: 1 },
  code: { color: COLORS.mustard, ...FONTS.bold },
  toggle: { fontSize: 12, color: COLORS.icon, ...FONTS.bold },

  eCard: {
    marginHorizontal: SPACING.lg, marginBottom: SPACING.md, padding: SPACING.md,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border,
  },
  eCardFlush: { marginHorizontal: 0, marginTop: SPACING.md },
  eTitle: {
    fontSize: 12, color: COLORS.textMuted, ...FONTS.bold, letterSpacing: 0.5, textTransform: 'uppercase',
    marginBottom: SPACING.xs, paddingLeft: 4,
  },
  eRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  eRowLast: { borderBottomWidth: 0 },
  // The whole label area toggles the row's switch (a 40×20 Switch alone is under 44 px).
  eRowPress: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  eIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: COLORS.primary + '12', alignItems: 'center', justifyContent: 'center' },
  eSub: { gap: 8, paddingLeft: 44, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  eSubRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 44, paddingBottom: 12 },
  consent: { fontSize: 11.5, color: COLORS.textMuted, lineHeight: 16, ...FONTS.medium },
  eBtn: {
    alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.full,
    backgroundColor: 'rgba(18,181,165,0.12)', borderWidth: 1, borderColor: 'rgba(18,181,165,0.4)',
  },
  eBtnText: { fontSize: 12.5, color: COLORS.primaryHover, ...FONTS.bold },
  eCats: { gap: 8, paddingLeft: 44, paddingBottom: 4 },
  catsLabel: { fontSize: 11, color: COLORS.textMuted, ...FONTS.bold, letterSpacing: 0.3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: RADIUS.full,
    backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border,
  },
  chipOn: { backgroundColor: 'rgba(18,181,165,0.14)', borderColor: 'rgba(18,181,165,0.5)' },
  chipText: { fontSize: 12, color: COLORS.textMuted, ...FONTS.semibold },
  chipTextOn: { color: COLORS.textMain },
  error: { marginTop: 8, fontSize: 12, color: '#FCA5A5', ...FONTS.medium },
});

export default GrowthCards;
