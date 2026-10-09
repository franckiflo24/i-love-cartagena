// Web camera QR scanner for the PALCO door (business scanner). It runs a CONTINUOUS line:
// point at a guest's live rotating QR (the wire AMOTKT1.<id>.<counter>.<token>), it decodes →
// submits via `onScan` → flashes the verdict + the guest's name, big → chimes → auto-advances
// to the next guest. No tap between guests; the same ticket is debounced while it stays in
// frame so a phone left in view is never double-counted, and every refusal unlocks instantly
// so the retry its banner asks for goes straight through.
//
// Decoding: the native BarcodeDetector API when it really supports qr_code (Chrome/Edge/
// Android — fast, no download); otherwise jsQR served SAME-ORIGIN from /vendor/ (iOS Safari
// has no BarcodeDetector; a third-party CDN was a silent single point of failure and ran
// foreign script in the authenticated business origin). Pure DOM — this file only loads on
// web (Metro picks the .web.tsx); the native twin (CameraScanner.tsx) mirrors it.
import React, { useEffect, useRef, useState } from 'react';
// react-dom is present at runtime on web (Expo renders through it) but ships no bundled types
// in this RN project; this file only loads on web.
// @ts-ignore - no @types/react-dom
import { createPortal } from 'react-dom';
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

// Same-origin copy, pinned 1.4.0 (committed under public/vendor/). A failed load rejects AND
// clears the memo so a reopen can retry — the old CDN loader left a dead <script> whose
// listeners never fired again, bricking every later open until a full page reload.
const JSQR_SRC = '/vendor/jsQR-1.4.0.js';
let jsqrPromise: Promise<any> | null = null;

function loadJsQR(): Promise<any> {
  const w = window as any;
  if (w.jsQR) return Promise.resolve(w.jsQR);
  if (jsqrPromise) return jsqrPromise;
  jsqrPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = JSQR_SRC;
    s.async = true;
    s.onload = () => (w.jsQR ? resolve(w.jsQR) : (jsqrPromise = null, s.remove(), reject(new Error('jsQR missing'))));
    s.onerror = () => {
      s.remove();
      jsqrPromise = null;
      reject(new Error('jsQR load failed'));
    };
    document.head.appendChild(s);
  });
  return jsqrPromise;
}

/** Decode throttle: ~12 fps reads plenty of rotations and spares the battery at a door shift. */
const DECODE_INTERVAL_MS = 80;
/** jsQR path: downscale the long side to this before decoding (door-range QRs stay huge). */
const DECODE_MAX_SIDE = 640;

export default function CameraScanner({ onScan, onClose, lang }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'denied' | 'error'>('starting');
  const [banner, setBanner] = useState<Banner | null>(null);
  const [count, setCount] = useState(0);

  // Live scan state in refs so the rAF loop and async submit never race React renders.
  const pausedRef = useRef(false);
  const recentRef = useRef<Map<string, number>>(new Map());
  const stoppedRef = useRef(false);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The camera effect runs ONCE: a new onScan/lang/onClose identity mid-hold used to tear the
  // whole camera down and leave pausedRef stuck true (door frozen). Refs keep them current.
  const onScanRef = useRef(onScan);
  const langRef = useRef(lang);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onScanRef.current = onScan;
    langRef.current = lang;
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let lastDecode = 0;
    let wakeLock: { release: () => Promise<void> } | null = null;
    stoppedRef.current = false;
    const w = window as any;

    const process = async (wire: string, id: string) => {
      let outcome: CameraScanOutcome | null = null;
      try {
        outcome = await onScanRef.current(wire);
      } catch {
        outcome = null;
      }
      if (stoppedRef.current) return;
      const b = bannerFor(outcome, langRef.current);
      // Refusals unlock the id immediately: their banner asks for a retry, and a refreshed
      // code carries the SAME ticket id. Admit-ish verdicts stay locked while in frame.
      if (!locksId(outcome)) recentRef.current.delete(id);
      playChime(b.ok);
      setBanner(b);
      if (b.admits) setCount((n) => n + 1);
      holdRef.current = setTimeout(() => {
        if (stoppedRef.current) return;
        setBanner(null);
        pausedRef.current = false; // auto-advance: ready for the next guest
      }, b.ok ? HOLD_OK_MS : HOLD_BAD_MS);
    };

    /** True when this id is inside its dedupe window (and refresh it, so a phone that STAYS in frame never re-fires). */
    const deduped = (id: string): boolean => {
      const m = recentRef.current;
      const now = Date.now();
      const last = m.get(id);
      if (last && now - last < DEDUPE_MS) {
        m.set(id, now);
        return true;
      }
      return false;
    };

    const onValue = (value: string) => {
      if (pausedRef.current || !value) return;
      if (value.length < SCAN_WIRE_MIN || value.length > SCAN_WIRE_MAX || !WIRE_RE.test(value)) return;
      const id = idOf(value);
      if (deduped(id)) return;
      pausedRef.current = true;
      const m = recentRef.current;
      const now = Date.now();
      for (const [k, t] of m) if (now - t > DEDUPE_MS) m.delete(k); // bound the map
      m.set(id, now);
      setBanner(verifyingBanner(langRef.current)); // the POST can take seconds; show progress
      void process(value, id);
    };

    const acquireWakeLock = async () => {
      try {
        wakeLock = (await (navigator as any).wakeLock?.request('screen')) ?? null;
      } catch {
        wakeLock = null; // unsupported / refused: the operator keeps tapping, nothing breaks
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !stoppedRef.current) {
        void acquireWakeLock(); // the lock auto-releases on hide; re-arm on return
        void videoRef.current?.play().catch(() => {});
      }
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stoppedRef.current) {
          // Closed while getUserMedia was pending: without this the camera light stays on.
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          v.setAttribute('playsinline', 'true');
          await v.play().catch(() => {});
        }
        stream.getVideoTracks().forEach((t) => t.addEventListener('ended', () => {
          if (!stoppedRef.current) setStatus('error'); // camera yanked (OS, another app): say so
        }));

        // Resolve a decoder BEFORE announcing "scanning": the old flow set the prompt first,
        // so a blocked jsQR left a camera that looked live and decoded nothing.
        let detector: any = null;
        if ('BarcodeDetector' in w) {
          try {
            const fmts: string[] = (await w.BarcodeDetector.getSupportedFormats?.()) ?? ['qr_code'];
            if (fmts.includes('qr_code')) detector = new w.BarcodeDetector({ formats: ['qr_code'] });
          } catch {
            detector = null;
          }
        }
        let jsQR: any = detector ? null : await loadJsQR().catch(() => null);
        if (!detector && !jsQR) {
          setStatus('error');
          return;
        }
        if (stoppedRef.current) return;
        setStatus('scanning');
        void acquireWakeLock();
        document.addEventListener('visibilitychange', onVisibility);

        const tick = async () => {
          if (stoppedRef.current) return;
          const nowMs = performance.now();
          if (nowMs - lastDecode >= DECODE_INTERVAL_MS) {
            lastDecode = nowMs;
            const vid = videoRef.current;
            if (vid && vid.readyState >= 2 && !pausedRef.current) {
              try {
                if (detector) {
                  const codes = await detector.detect(vid);
                  if (codes && codes.length) {
                    // Several codes can share the frame (a stray poster + the guest's phone, or
                    // two guests): pick the first PALCO wire not inside its dedupe window.
                    const hit = codes
                      .map((c: { rawValue?: string }) => c.rawValue || '')
                      .find((val: string) => val.length >= SCAN_WIRE_MIN && val.length <= SCAN_WIRE_MAX
                        && WIRE_RE.test(val) && !deduped(idOf(val)));
                    if (hit) onValue(hit);
                  }
                } else if (jsQR) {
                  const cv = canvasRef.current!;
                  const vw = vid.videoWidth;
                  const vh = vid.videoHeight;
                  if (vw && vh) {
                    const scale = Math.min(1, DECODE_MAX_SIDE / Math.max(vw, vh));
                    const tw = Math.max(1, Math.round(vw * scale));
                    const th = Math.max(1, Math.round(vh * scale));
                    if (cv.width !== tw) cv.width = tw;   // reassigning every frame re-allocates
                    if (cv.height !== th) cv.height = th; // the bitmap: only on real change
                    const ctx = cv.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D;
                    ctx.drawImage(vid, 0, 0, tw, th);
                    const img = ctx.getImageData(0, 0, tw, th);
                    const res = jsQR(img.data, tw, th, { inversionAttempts: 'dontInvert' });
                    if (res && res.data) onValue(res.data);
                  }
                }
              } catch {
                if (detector) {
                  // BarcodeDetector failing at runtime: fall back to jsQR instead of a dead loop.
                  detector = null;
                  jsQR = await loadJsQR().catch(() => null);
                  if (!jsQR && !stoppedRef.current) setStatus('error');
                }
                // jsQR throwing on one frame: keep scanning.
              }
            }
          }
          if (!stoppedRef.current) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e: any) {
        setStatus(e && e.name === 'NotAllowedError' ? 'denied' : 'error');
      }
    })();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);

    return () => {
      stoppedRef.current = true;
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      if (raf) cancelAnimationFrame(raf);
      if (holdRef.current) clearTimeout(holdRef.current);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (wakeLock) void wakeLock.release().catch(() => {});
    };
  }, []); // ONCE — see the refs block above

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
      ? T(lang, 'No pudimos abrir la cámara o el lector. Usa “Pegar código”.', 'Could not start the camera or the decoder. Use “Paste code”.')
      : status === 'starting'
        ? T(lang, 'Abriendo cámara…', 'Opening camera…')
        : T(lang, 'Apunta al código QR — escanea un invitado tras otro', 'Point at the QR — scan one guest after another');

  // The in-frame verdict flash: a translucent color wash + the holder name, big.
  const bannerTree = banner ? React.createElement(
    'div',
    {
      key: 'banner',
      role: 'status',
      'aria-live': 'polite',
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
    banner.sub
      ? React.createElement('div', { key: 'sb', style: { color: 'rgba(255,255,255,0.95)', fontSize: 13, fontWeight: 700, marginTop: 6, textShadow: '0 1px 8px rgba(0,0,0,0.7)' } }, banner.sub)
      : null,
    banner.detail
      ? React.createElement('div', { key: 'dt', style: { color: 'rgba(255,255,255,0.92)', fontSize: 14, fontWeight: 600, marginTop: 8, textShadow: '0 1px 8px rgba(0,0,0,0.7)' } }, banner.detail)
      : null,
  ) : null;

  const tree = React.createElement(
    'div', { style: overlay, role: 'dialog', 'aria-modal': true, 'aria-label': T(lang, 'Escanear entradas', 'Scan tickets') },
    React.createElement('div', { key: 'title', style: { color: '#fff', fontSize: 18, fontWeight: 800, marginBottom: 16 } },
      T(lang, 'Escanear entradas', 'Scan tickets')),
    React.createElement('div', { key: 'frame', style: frame },
      React.createElement('video', { ref: videoRef, autoPlay: true, muted: true, playsInline: true, style: vstyle }),
      !banner ? React.createElement('div', { key: 'retic', style: retic }) : null,
      bannerTree,
    ),
    React.createElement('canvas', { key: 'cv', ref: canvasRef, style: { display: 'none' } }),
    React.createElement('div', { key: 'msg', style: { color: 'rgba(255,255,255,0.85)', fontSize: 14, marginTop: 16, textAlign: 'center', maxWidth: 340, minHeight: 20 } }, banner ? '' : msg),
    count > 0
      ? React.createElement('div', { key: 'count', style: { color: GREEN, fontSize: 13, fontWeight: 800, marginTop: 10, letterSpacing: 0.3 } },
          `${count} ${T(lang, count === 1 ? 'validada' : 'validadas', 'admitted')}`)
      : null,
    React.createElement('button', {
      key: 'close', onClick: onClose,
      style: {
        marginTop: 20, padding: '12px 28px', borderRadius: 999, border: 'none',
        background: '#12b5a5', color: '#04110f', fontSize: 15, fontWeight: 800, cursor: 'pointer',
      },
    }, T(lang, 'Cerrar', 'Close')),
  );

  // Portal to <body>: expo-router wraps each screen in a transformed View, and a CSS transform
  // on an ancestor re-bases position:fixed to that ancestor (the overlay landed off-screen).
  return typeof document !== 'undefined' ? createPortal(tree, document.body) : tree;
}
