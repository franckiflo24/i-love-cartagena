// Perfil growth section (Master Plan 1.4 + 1.5): push opt-in, referral code,
// PWA install. All value-first, zero nag: rows render only when actionable.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Share, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, FONTS } from '../constants/theme';
import { useTr } from '../i18n/autoTr';
import { pushState, subscribePush, unsubscribePush, PushState } from '../lib/push';
import { myReferral } from '../lib/referral';

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
  const [ref, setRef] = useState<{ code: string; referred_count: number; points_each: number; share_url: string } | null>(null);
  const [canInstall, setCanInstall] = useState(!!deferredInstall);
  const [iosInstall, setIosInstall] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    pushState().then(setPush);
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
  }, [signedIn]);

  const togglePush = useCallback(async () => {
    setBusy(true);
    setPush(push === 'subscribed' ? await unsubscribePush() : await subscribePush());
    setBusy(false);
  }, [push]);

  const shareRef = useCallback(async () => {
    if (!ref) return;
    const msg = `Únete a AMO Cartagena con mi código y ambos ganamos ${ref.points_each} puntos 🎁 ${ref.share_url}`;
    try {
      if (Platform.OS === 'web' && (navigator as any)?.share) {
        await (navigator as any).share({ text: msg, url: ref.share_url });
      } else if (Platform.OS === 'web') {
        await (navigator as any)?.clipboard?.writeText?.(msg);
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
            <Text style={styles.rowTitle}>{tr('Invita a un amigo — ambos ganan')} {ref.points_each} pts</Text>
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
          <Ionicons name={push === 'subscribed' ? 'notifications' : 'notifications-outline'} size={20} color={COLORS.icon} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{tr('Avisos de tu pasaporte')}</Text>
            <Text style={styles.rowSub}>
              {push === 'subscribed'
                ? tr('Activado — máximo 1 al día, solo hitos tuyos')
                : tr('Hitos de racha y recompensas — máximo 1 al día, sin spam')}
            </Text>
          </View>
          <Text style={styles.toggle}>{busy ? '…' : push === 'subscribed' ? tr('Quitar') : tr('Activar')}</Text>
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

const styles = StyleSheet.create({
  card: { marginHorizontal: SPACING.lg, marginBottom: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  rowTitle: { fontSize: 13, color: COLORS.textMain, ...FONTS.bold },
  rowSub: { fontSize: 11, color: COLORS.textMuted, ...FONTS.medium, marginTop: 1 },
  code: { color: COLORS.mustard, ...FONTS.bold },
  toggle: { fontSize: 12, color: COLORS.icon, ...FONTS.bold },
});

export default GrowthCards;
