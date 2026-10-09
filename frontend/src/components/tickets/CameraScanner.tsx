// Native camera QR scanner for the PALCO door (iOS/Android), via expo-camera's CameraView.
// It runs a CONTINUOUS line, same contract as the web twin (CameraScanner.web.tsx): decode a
// guest's rotating QR (wire AMOTKT1.<id>.<counter>.<token>) → submit via `onScan` → flash the
// verdict + the guest's name, big → auto-advance to the next guest. Labels/tones/timing come
// from cameraScanShared, shared with the web twin. The audible chime is web-only (playChime is
// a no-op here); the parent fires expo-haptics on every verdict, so the operator still gets a
// success/error pulse.
//
// PLACEMENT CONTRACT: the parent must render this at the SCREEN ROOT, never inside a
// ScrollView — the absolute-fill overlay resolves against its parent, and inside scroll
// content it lands off-viewport on a long guest list (web escapes via a portal; RN has none).
// useKeepAwake keeps the screen on through a door shift (a camera line gets no touches, so the
// phone would otherwise auto-lock); ExpoKeepAwake is autolinked in the 1.1.7 binary → OTA-safe.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';
import { playChime } from '../../lib/chime';
import type { CameraScanOutcome } from './scannerApi';
import { SCAN_WIRE_MAX, SCAN_WIRE_MIN } from './scannerApi';
import {
  DEDUPE_MS, GREEN, HOLD_BAD_MS, HOLD_OK_MS, T, WIRE_RE, bannerFor, idOf, locksId, verifyingBanner,
} from './cameraScanShared';
import type { Banner } from './cameraScanShared';

type Props = {
  /** Submit a decoded wire; resolves to the verdict + context, or null when nothing was sent. */
  onScan: (wire: string) => Promise<CameraScanOutcome | null>;
  onClose: () => void;
  lang?: string;
};

export default function CameraScanner({ onScan, onClose, lang }: Props) {
  useKeepAwake(); // the door line gets no touches; without this the phone sleeps mid-shift
  const isFocused = useIsFocused(); // a route pushed on top must release the camera
  const [permission, requestPermission] = useCameraPermissions();
  const [asked, setAsked] = useState(false);
  const [mountError, setMountError] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [count, setCount] = useState(0);

  const pausedRef = useRef(false);
  const recentRef = useRef<Map<string, number>>(new Map());
  const stoppedRef = useRef(false);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ask once, on first render, if we don't already have a decision.
  if (permission && !permission.granted && permission.canAskAgain && !asked) {
    setAsked(true);
    requestPermission();
  }

  useEffect(() => {
    stoppedRef.current = false;
    return () => {
      stoppedRef.current = true;
      if (holdRef.current) clearTimeout(holdRef.current);
    };
  }, []);

  const onScanned = useCallback((res: { data?: string }) => {
    const data = res?.data || '';
    if (pausedRef.current) return;
    // Same bounds the server enforces (ScanBody): an oversized payload would 422 as a
    // confusing "retry"; out-of-range or non-PALCO codes are simply ignored.
    if (data.length < SCAN_WIRE_MIN || data.length > SCAN_WIRE_MAX || !WIRE_RE.test(data)) return;
    const id = idOf(data);
    const m = recentRef.current;
    const now = Date.now();
    const last = m.get(id);
    if (last && now - last < DEDUPE_MS) {
      m.set(id, now); // still in frame: keep it locked — never re-alarm while in view
      return;
    }
    pausedRef.current = true;
    for (const [k, t] of m) if (now - t > DEDUPE_MS) m.delete(k); // bound the map
    m.set(id, now);
    setBanner(verifyingBanner(lang)); // the POST can take seconds; the line must see progress

    void (async () => {
      let outcome: CameraScanOutcome | null = null;
      try {
        outcome = await onScan(data);
      } catch {
        outcome = null;
      }
      if (stoppedRef.current) return;
      const b = bannerFor(outcome, lang);
      // Refusals unlock the id immediately: their banner asks for a retry, and a refreshed
      // code carries the SAME ticket id. Admit-ish verdicts stay locked while in frame.
      if (!locksId(outcome)) m.delete(id);
      playChime(b.ok); // no-op on native; the parent fires haptics
      setBanner(b);
      if (b.admits) setCount((n) => n + 1);
      holdRef.current = setTimeout(() => {
        if (stoppedRef.current) return;
        setBanner(null);
        pausedRef.current = false; // auto-advance: ready for the next guest
      }, b.ok ? HOLD_OK_MS : HOLD_BAD_MS);
    })();
  }, [onScan, lang]);

  const openSettings = useCallback(() => {
    Linking.openSettings().catch(() => {});
  }, []);
  const reAsk = useCallback(() => {
    void requestPermission();
  }, [requestPermission]);

  const denied = permission !== null && !permission.granted && !permission.canAskAgain;
  const askable = permission !== null && !permission.granted && permission.canAskAgain && asked;
  const waiting = permission === null || (!permission.granted && permission.canAskAgain && !asked);
  const frameColor = banner ? banner.color : 'rgba(18,181,165,0.7)';

  return (
    <View style={styles.overlay} accessibilityViewIsModal>
      <Text style={styles.title}>{T(lang, 'Escanear entradas', 'Scan tickets')}</Text>
      <View style={[styles.frame, { borderColor: frameColor }]}>
        {permission?.granted && !mountError ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            active={isFocused}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={onScanned}
            onMountError={() => setMountError(true)}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.center]}>
            <Text style={styles.waitText}>
              {mountError
                ? T(lang, 'La cámara no pudo iniciar. Usa “Pegar código”.', 'The camera failed to start. Use “Paste code”.')
                : denied
                  ? T(lang, 'Permiso de cámara denegado.', 'Camera permission denied.')
                  : askable
                    ? T(lang, 'La cámara necesita permiso para escanear.', 'The camera needs permission to scan.')
                    : T(lang, 'Permitiendo cámara…', 'Allowing camera…')}
            </Text>
            {denied && (
              <TouchableOpacity style={styles.permBtn} onPress={openSettings} accessibilityRole="button">
                <Text style={styles.permBtnText}>{T(lang, 'Abrir Ajustes', 'Open Settings')}</Text>
              </TouchableOpacity>
            )}
            {askable && !mountError && (
              <TouchableOpacity style={styles.permBtn} onPress={reAsk} accessibilityRole="button">
                <Text style={styles.permBtnText}>{T(lang, 'Permitir cámara', 'Allow camera')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        {!banner && <View pointerEvents="none" style={[styles.reticle, { borderColor: frameColor }]} />}
        {banner && (
          <View
            pointerEvents="none"
            style={[styles.banner, { backgroundColor: `${banner.color}26` }]}
            accessibilityLiveRegion="polite"
          >
            <Text style={[styles.bannerLabel, { color: banner.color }]}>{banner.label}</Text>
            {!!banner.name && <Text style={styles.bannerName}>{banner.name}</Text>}
            {!!banner.sub && <Text style={styles.bannerSub}>{banner.sub}</Text>}
            {!!banner.detail && <Text style={styles.bannerDetail}>{banner.detail}</Text>}
          </View>
        )}
      </View>
      <Text style={styles.msg}>
        {permission?.granted && !mountError
          ? banner
            ? ' '
            : T(lang, 'Apunta al código QR — escanea un invitado tras otro', 'Point at the QR — scan one guest after another')
          : waiting
            ? T(lang, 'Esperando permiso de cámara…', 'Waiting for camera permission…')
            : T(lang, 'Usa “Pegar código” si no puedes activar la cámara.', 'Use “Paste code” if you can’t enable the camera.')}
      </Text>
      {count > 0 && (
        <Text style={styles.count}>
          {`${count} ${T(lang, count === 1 ? 'validada' : 'validadas', 'admitted')}`}
        </Text>
      )}
      <TouchableOpacity style={styles.closeBtn} onPress={onClose} accessibilityRole="button">
        <Text style={styles.closeText}>{T(lang, 'Cerrar', 'Close')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
    backgroundColor: 'rgba(5,7,12,0.97)', alignItems: 'center', justifyContent: 'center', padding: 20,
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 16 },
  frame: {
    width: 300, height: 300, borderRadius: 20, overflow: 'hidden', backgroundColor: '#000',
    borderWidth: 2,
  },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, gap: 12 },
  waitText: { color: 'rgba(255,255,255,0.8)', fontSize: 14, textAlign: 'center' },
  permBtn: {
    minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18,
    borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)',
  },
  permBtnText: { color: '#fff', fontSize: 13.5, fontWeight: '700' },
  reticle: {
    position: 'absolute', top: '14%', left: '14%', right: '14%', bottom: '14%',
    borderWidth: 3, borderRadius: 16,
  },
  banner: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16,
  },
  bannerLabel: { fontSize: 28, fontWeight: '900', letterSpacing: 1, textAlign: 'center' },
  bannerName: { color: '#fff', fontSize: 28, lineHeight: 32, fontWeight: '800', marginTop: 8, textAlign: 'center' },
  bannerSub: { color: 'rgba(255,255,255,0.95)', fontSize: 13, fontWeight: '700', marginTop: 6, textAlign: 'center' },
  bannerDetail: { color: 'rgba(255,255,255,0.92)', fontSize: 14, fontWeight: '600', marginTop: 8, textAlign: 'center' },
  msg: { color: 'rgba(255,255,255,0.85)', fontSize: 14, marginTop: 16, textAlign: 'center', maxWidth: 320, minHeight: 20 },
  count: { color: GREEN, fontSize: 13, fontWeight: '800', marginTop: 10, letterSpacing: 0.3 },
  closeBtn: { marginTop: 20, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 999, backgroundColor: '#12b5a5' },
  closeText: { color: '#04110f', fontSize: 15, fontWeight: '800' },
});
