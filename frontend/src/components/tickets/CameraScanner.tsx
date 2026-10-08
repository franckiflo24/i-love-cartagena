// Native camera QR scanner for the PALCO door (iOS/Android), via expo-camera's
// CameraView. The ticket QR encodes the wire AMOTKT1.<id>.<counter>.<token>, so a
// decode is a real possession scan — only PALCO wires are accepted (stray QRs
// ignored) and handed up to be submitted to /business/tickets/scan. Web uses the
// CameraScanner.web.tsx twin (getUserMedia + BarcodeDetector/jsQR).
import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

type Props = { onDetected: (wire: string) => void; onClose: () => void; lang?: string };

const WIRE_RE = /^AMO(TKT1|PASS1|CIV1)\./;
const T = (lang: string | undefined, es: string, en: string) => (lang === 'en' ? en : es);

export default function CameraScanner({ onDetected, onClose, lang }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [asked, setAsked] = useState(false);
  const firedRef = useRef(false);

  // Ask once, on first render, if we don't already have a decision.
  if (permission && !permission.granted && permission.canAskAgain && !asked) {
    setAsked(true);
    requestPermission();
  }

  const onScanned = useCallback((res: { data?: string }) => {
    const data = res?.data || '';
    if (firedRef.current || !WIRE_RE.test(data)) return;
    firedRef.current = true;
    onDetected(data);
  }, [onDetected]);

  const denied = permission && !permission.granted && !permission.canAskAgain;
  const waiting = !permission || (!permission.granted && permission.canAskAgain);

  return (
    <View style={styles.overlay}>
      <Text style={styles.title}>{T(lang, 'Escanear entrada', 'Scan ticket')}</Text>
      <View style={styles.frame}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={onScanned}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.center]}>
            <Text style={styles.waitText}>
              {denied
                ? T(lang, 'Permiso de cámara denegado. Actívalo en Ajustes.', 'Camera permission denied. Enable it in Settings.')
                : T(lang, 'Permitiendo cámara…', 'Allowing camera…')}
            </Text>
          </View>
        )}
        <View pointerEvents="none" style={styles.reticle} />
      </View>
      <Text style={styles.msg}>
        {permission?.granted
          ? T(lang, 'Apunta al código QR de la entrada', 'Point at the ticket QR code')
          : waiting
            ? T(lang, 'Esperando permiso de cámara…', 'Waiting for camera permission…')
            : T(lang, 'Usa “Pegar código” si no puedes activar la cámara.', 'Use “Paste code” if you can’t enable the camera.')}
      </Text>
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
    borderWidth: 2, borderColor: 'rgba(18,181,165,0.7)',
  },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  waitText: { color: 'rgba(255,255,255,0.8)', fontSize: 14, textAlign: 'center' },
  reticle: {
    position: 'absolute', top: '14%', left: '14%', right: '14%', bottom: '14%',
    borderWidth: 3, borderColor: 'rgba(18,181,165,0.9)', borderRadius: 16,
  },
  msg: { color: 'rgba(255,255,255,0.85)', fontSize: 14, marginTop: 16, textAlign: 'center', maxWidth: 320 },
  closeBtn: { marginTop: 22, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 999, backgroundColor: '#12b5a5' },
  closeText: { color: '#04110f', fontSize: 15, fontWeight: '800' },
});
