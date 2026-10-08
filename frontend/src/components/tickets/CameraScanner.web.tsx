// Web camera QR scanner for the PALCO door (business scanner). It runs a CONTINUOUS
// line: point at a guest's live rotating QR (which encodes the wire
// AMOTKT1.<id>.<counter>.<token>), it decodes → submits via `onScan` → flashes the
// verdict with the guest's name, big → chimes → auto-advances to the next guest.
// No tap between guests; the same ticket is debounced for a few seconds so a phone
// left in frame is never double-counted.
//
// Decoding: the native BarcodeDetector API when present (Chrome/Edge/Android —
// fast, no download); otherwise jsQR loaded from CDN (iOS Safari has no
// BarcodeDetector). Pure DOM — this file only loads on web (Metro picks the
// .web.tsx); the native twin (CameraScanner.tsx) mirrors this with expo-camera.
import React, { useEffect, useRef, useState } from 'react';
// react-dom is present at runtime on web (Expo renders through it) but ships no
// bundled types in this RN project; this file only loads on web.
// @ts-ignore - no @types/react-dom
import { createPortal } from 'react-dom';
import { playChime } from '../../lib/chime';
import type { CameraScanOutcome } from './scannerApi';
import {
  DEDUPE_MS, GREEN, HOLD_BAD_MS, HOLD_OK_MS, T, WIRE_RE, bannerFor, idOf,
} from './cameraScanShared';
import type { Banner } from './cameraScanShared';

type Props = {
  /** Submit a decoded wire; resolves to the verdict + holder name, or null if it could not be resolved. */
  onScan: (wire: string) => Promise<CameraScanOutcome | null>;
  onClose: () => void;
  lang?: string;
};

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

export default function CameraScanner({ onScan, onClose, lang }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'denied' | 'error'>('starting');
  const [banner, setBanner] = useState<Banner | null>(null);
  const [count, setCount] = useState(0);

  // Live scan state kept in refs so the rAF loop and async submit never race React renders.
  const pausedRef = useRef(false);
  const recentRef = useRef<Map<string, number>>(new Map());
  const stoppedRef = useRef(false);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    stoppedRef.current = false;
    const w = window as any;

    const admit = (id: string) => {
      const m = recentRef.current;
      const now = Date.now();
      for (const [k, t] of m) if (now - t > DEDUPE_MS) m.delete(k); // bound the map
      m.set(id, now);
    };

    const process = async (wire: string) => {
      let outcome: CameraScanOutcome | null = null;
      try {
        outcome = await onScan(wire);
      } catch {
        outcome = null;
      }
      if (stoppedRef.current) return;
      const b = bannerFor(outcome, lang);
      playChime(b.ok);
      setBanner(b);
      if (b.ok) setCount((n) => n + 1);
      holdRef.current = setTimeout(() => {
        if (stoppedRef.current) return;
        setBanner(null);
        pausedRef.current = false; // auto-advance: ready for the next guest
      }, b.ok ? HOLD_OK_MS : HOLD_BAD_MS);
    };

    const onValue = (value: string) => {
      if (pausedRef.current || !value || !WIRE_RE.test(value)) return;
      const id = idOf(value);
      const last = recentRef.current.get(id);
      if (last && Date.now() - last < DEDUPE_MS) return; // same guest still in frame
      pausedRef.current = true;
      admit(id);
      void process(value);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stoppedRef.current) return;
        const v = videoRef.current;
        if (v) { v.srcObject = stream; v.setAttribute('playsinline', 'true'); await v.play().catch(() => {}); }
        setStatus('scanning');

        const detector = 'BarcodeDetector' in w ? new w.BarcodeDetector({ formats: ['qr_code'] }) : null;
        const jsQR = detector ? null : await loadJsQR().catch(() => null);

        const tick = async () => {
          if (stoppedRef.current) return;
          const vid = videoRef.current;
          if (vid && vid.readyState >= 2 && !pausedRef.current) {
            try {
              if (detector) {
                const codes = await detector.detect(vid);
                if (codes && codes.length) onValue(codes[0].rawValue);
              } else if (jsQR) {
                const cv = canvasRef.current!;
                const cw = vid.videoWidth, ch = vid.videoHeight;
                if (cw && ch) {
                  cv.width = cw; cv.height = ch;
                  const ctx = cv.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D;
                  ctx.drawImage(vid, 0, 0, cw, ch);
                  const img = ctx.getImageData(0, 0, cw, ch);
                  const res = jsQR(img.data, cw, ch, { inversionAttempts: 'dontInvert' });
                  if (res && res.data) onValue(res.data);
                }
              }
            } catch { /* keep scanning */ }
          }
          if (!stoppedRef.current) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e: any) {
        setStatus(e && e.name === 'NotAllowedError' ? 'denied' : 'error');
      }
    })();

    return () => {
      stoppedRef.current = true;
      if (raf) cancelAnimationFrame(raf);
      if (holdRef.current) clearTimeout(holdRef.current);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [onScan, lang]);

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(5,7,12,0.96)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20,
  };
  const frame: React.CSSProperties = {
    position: 'relative', width: 'min(86vw, 360px)', aspectRatio: '1 / 1',
    borderRadius: 20, overflow: 'hidden', background: '#000',
    boxShadow: `0 0 0 2px ${banner ? banner.color : 'rgba(18,181,165,0.7)'}, 0 10px 40px rgba(0,0,0,0.5)`,
    transition: 'box-shadow 120ms ease',
  };
  const vstyle: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover' };
  const retic: React.CSSProperties = {
    position: 'absolute', inset: '14%', border: `3px solid ${banner ? banner.color : 'rgba(18,181,165,0.9)'}`, borderRadius: 16, pointerEvents: 'none',
  };
  const msg = status === 'denied'
    ? T(lang, 'Permiso de cámara denegado. Actívalo en el navegador y reintenta.', 'Camera permission denied. Enable it in your browser and retry.')
    : status === 'error'
      ? T(lang, 'No pudimos abrir la cámara. Usa “Pegar código”.', 'Could not open the camera. Use “Paste code”.')
      : status === 'starting'
        ? T(lang, 'Abriendo cámara…', 'Opening camera…')
        : T(lang, 'Apunta al código QR — escanea un invitado tras otro', 'Point at the QR — scan one guest after another');

  // The in-frame verdict flash: a translucent color wash + the holder name, big.
  const bannerTree = banner ? React.createElement(
    'div',
    {
      key: 'banner',
      style: {
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 16,
        background: `${banner.color}26`, backdropFilter: 'blur(2px)',
      },
    },
    React.createElement('div', { key: 'lbl', style: { color: banner.color, fontSize: 30, fontWeight: 900, letterSpacing: 1, textShadow: '0 2px 12px rgba(0,0,0,0.6)' } }, banner.label),
    banner.name
      ? React.createElement('div', { key: 'nm', style: { color: '#fff', fontSize: 30, lineHeight: 1.1, fontWeight: 800, marginTop: 8, textShadow: '0 2px 12px rgba(0,0,0,0.7)' } }, banner.name)
      : null,
    banner.detail
      ? React.createElement('div', { key: 'dt', style: { color: 'rgba(255,255,255,0.92)', fontSize: 14, fontWeight: 600, marginTop: 8, textShadow: '0 1px 8px rgba(0,0,0,0.7)' } }, banner.detail)
      : null,
  ) : null;

  const tree = React.createElement(
    'div', { style: overlay },
    React.createElement('div', { key: 'title', style: { color: '#fff', fontSize: 18, fontWeight: 800, marginBottom: 16 } },
      T(lang, 'Escanear entradas', 'Scan tickets')),
    React.createElement('div', { key: 'frame', style: frame },
      React.createElement('video', { ref: videoRef, autoPlay: true, muted: true, playsInline: true, style: vstyle }),
      React.createElement('div', { style: retic }),
      bannerTree,
    ),
    React.createElement('canvas', { key: 'cv', ref: canvasRef, style: { display: 'none' } }),
    React.createElement('div', { key: 'msg', style: { color: 'rgba(255,255,255,0.85)', fontSize: 14, marginTop: 16, textAlign: 'center', maxWidth: 340, minHeight: 20 } }, banner ? '' : msg),
    count > 0
      ? React.createElement('div', { key: 'count', style: { color: GREEN, fontSize: 13, fontWeight: 800, marginTop: 10, letterSpacing: 0.3 } },
          `${count} ${T(lang, count === 1 ? 'validada' : 'validadas', count === 1 ? 'admitted' : 'admitted')}`)
      : null,
    React.createElement('button', {
      key: 'close', onClick: onClose,
      style: {
        marginTop: 20, padding: '12px 28px', borderRadius: 999, border: 'none',
        background: '#12b5a5', color: '#04110f', fontSize: 15, fontWeight: 800, cursor: 'pointer',
      },
    }, T(lang, 'Cerrar', 'Close')),
  );

  // Portal to <body>: expo-router wraps each screen in a transformed View, and a
  // CSS transform on an ancestor re-bases position:fixed to that ancestor (the
  // overlay landed off-screen). Rendering into document.body escapes it so the
  // overlay truly covers the viewport on phones.
  return typeof document !== 'undefined' ? createPortal(tree, document.body) : tree;
}
