// Web camera QR scanner for the PALCO door (business scanner). Reads a guest's
// live rotating QR (which encodes the wire AMOTKT1.<id>.<counter>.<token>) and
// hands the decoded wire to the caller, which submits it to /business/tickets/scan.
//
// Decoding: the native BarcodeDetector API when present (Chrome/Edge/Android —
// fast, no download); otherwise jsQR loaded from CDN (iOS Safari has no
// BarcodeDetector). Pure DOM — this file only loads on web (Metro picks the
// .web.tsx); the native twin is a stub until expo-camera ships in a build.
import React, { useEffect, useRef, useState } from 'react';
// react-dom is present at runtime on web (Expo renders through it) but ships no
// bundled types in this RN project; this file only loads on web.
// @ts-ignore - no @types/react-dom
import { createPortal } from 'react-dom';

type Props = { onDetected: (wire: string) => void; onClose: () => void; lang?: string };

const JSQR_SRC = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';

function loadJsQR(): Promise<any> {
  const w = window as any;
  if (w.jsQR) return Promise.resolve(w.jsQR);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${JSQR_SRC}"]`);
    if (existing) { existing.addEventListener('load', () => resolve(w.jsQR)); existing.addEventListener('error', reject); return; }
    const s = document.createElement('script');
    s.src = JSQR_SRC; s.async = true;
    s.onload = () => resolve(w.jsQR);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

const T = (lang: string | undefined, es: string, en: string) => (lang === 'en' ? en : es);

export default function CameraScanner({ onDetected, onClose, lang }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'denied' | 'error'>('starting');
  const firedRef = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const w = window as any;

    const fire = (value: string) => {
      if (firedRef.current || !value) return;
      // Only accept a PALCO ticket/pass wire, so a stray QR in frame is ignored.
      if (!/^AMO(TKT1|PASS1|CIV1)\./.test(value)) return;
      firedRef.current = true;
      onDetected(value);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stopped) return;
        const v = videoRef.current;
        if (v) { v.srcObject = stream; v.setAttribute('playsinline', 'true'); await v.play().catch(() => {}); }
        setStatus('scanning');

        const detector = 'BarcodeDetector' in w ? new w.BarcodeDetector({ formats: ['qr_code'] }) : null;
        const jsQR = detector ? null : await loadJsQR().catch(() => null);

        const tick = async () => {
          if (stopped || firedRef.current) return;
          const vid = videoRef.current;
          if (vid && vid.readyState >= 2) {
            try {
              if (detector) {
                const codes = await detector.detect(vid);
                if (codes && codes.length) fire(codes[0].rawValue);
              } else if (jsQR) {
                const cv = canvasRef.current!;
                const cw = vid.videoWidth, ch = vid.videoHeight;
                if (cw && ch) {
                  cv.width = cw; cv.height = ch;
                  const ctx = cv.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D;
                  ctx.drawImage(vid, 0, 0, cw, ch);
                  const img = ctx.getImageData(0, 0, cw, ch);
                  const res = jsQR(img.data, cw, ch, { inversionAttempts: 'dontInvert' });
                  if (res && res.data) fire(res.data);
                }
              }
            } catch { /* keep scanning */ }
          }
          if (!stopped && !firedRef.current) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e: any) {
        setStatus(e && e.name === 'NotAllowedError' ? 'denied' : 'error');
      }
    })();

    return () => {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [onDetected]);

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(5,7,12,0.96)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20,
  };
  const frame: React.CSSProperties = {
    position: 'relative', width: 'min(86vw, 360px)', aspectRatio: '1 / 1',
    borderRadius: 20, overflow: 'hidden', background: '#000',
    boxShadow: '0 0 0 2px rgba(18,181,165,0.7), 0 10px 40px rgba(0,0,0,0.5)',
  };
  const vstyle: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover' };
  const retic: React.CSSProperties = {
    position: 'absolute', inset: '14%', border: '3px solid rgba(18,181,165,0.9)', borderRadius: 16, pointerEvents: 'none',
  };
  const msg = status === 'denied'
    ? T(lang, 'Permiso de cámara denegado. Actívalo en el navegador y reintenta.', 'Camera permission denied. Enable it in your browser and retry.')
    : status === 'error'
      ? T(lang, 'No pudimos abrir la cámara. Usa “Pegar código”.', 'Could not open the camera. Use “Paste code”.')
      : status === 'starting'
        ? T(lang, 'Abriendo cámara…', 'Opening camera…')
        : T(lang, 'Apunta al código QR de la entrada', 'Point at the ticket QR code');

  // Portal to <body>: expo-router wraps each screen in a transformed View, and a
  // CSS transform on an ancestor re-bases position:fixed to that ancestor (the
  // overlay landed off-screen). Rendering into document.body escapes it so the
  // overlay truly covers the viewport on phones.
  const tree = React.createElement(
    'div', { style: overlay },
    React.createElement('div', { key: 'title', style: { color: '#fff', fontSize: 18, fontWeight: 800, marginBottom: 16 } },
      T(lang, 'Escanear entrada', 'Scan ticket')),
    React.createElement('div', { key: 'frame', style: frame },
      React.createElement('video', { ref: videoRef, autoPlay: true, muted: true, playsInline: true, style: vstyle }),
      React.createElement('div', { style: retic }),
    ),
    React.createElement('canvas', { key: 'cv', ref: canvasRef, style: { display: 'none' } }),
    React.createElement('div', { key: 'msg', style: { color: 'rgba(255,255,255,0.85)', fontSize: 14, marginTop: 16, textAlign: 'center', maxWidth: 340 } }, msg),
    React.createElement('button', {
      key: 'close', onClick: onClose,
      style: {
        marginTop: 22, padding: '12px 28px', borderRadius: 999, border: 'none',
        background: '#12b5a5', color: '#04110f', fontSize: 15, fontWeight: 800, cursor: 'pointer',
      },
    }, T(lang, 'Cerrar', 'Close')),
  );
  return typeof document !== 'undefined' ? createPortal(tree, document.body) : tree;
}
