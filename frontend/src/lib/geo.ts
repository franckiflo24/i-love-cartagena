// Walking Layer — client geo service. THE CAN'T-BREAK CORE.
//
// Wraps navigator.geolocation.watchPosition behind a permission state machine:
//   not-asked → (user gesture) → granted | denied | unavailable
//
// Fail-soft contract (PRIME DIRECTIVE):
//   - denied / unavailable → position stays null forever, silently. No nag,
//     no modal loop, no retry. Subscribers simply never fire.
//   - Anything throwing anywhere degrades to "no location", never to a crash.
//
// Battery discipline:
//   - enableHighAccuracy: false, maximumAge: 10s
//   - emits at most one update per 5s, and only after ≥10m of movement
//   - watch is cleared whenever the tab is hidden (visibilitychange) or the
//     owning screen loses focus (stop()); re-armed on return.
//
// Privacy: positions live in memory only — never persisted, never sent to the
// server except as the transient proximity proof in POST /passport/discover.
//
// Web-only by design: the live product is the RN-web static export. On native
// (no navigator.geolocation) the service reports 'unavailable' and the whole
// walking layer stays dormant — today's app, pixel-identical.

import { Platform } from 'react-native';

export type GeoStatus = 'not-asked' | 'granted' | 'denied' | 'unavailable';

export interface GeoPosition {
  lat: number;
  lng: number;
  accuracy: number;
  ts: number;
}

export interface GeoState {
  status: GeoStatus;
  position: GeoPosition | null;
  /** Compass heading in degrees (0 = North), null when unavailable/denied. */
  heading: number | null;
}

type Listener = (state: GeoState) => void;

const MIN_INTERVAL_MS = 5000; // ≤1 update per 5s
const MIN_MOVE_M = 10;        // ignore jitter under 10m
const HEADING_THROTTLE_MS = 250;

const DENIED_KEY = '@amo_geo_denied'; // sticky across sessions — never re-nag
const DEBUG_KEY = '@amo_geo_debug';

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Initial bearing (degrees, 0 = North, clockwise) from point 1 to point 2. */
export function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function debugEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DEBUG_KEY) === '1';
  } catch {
    return false;
  }
}

function dlog(msg: string) {
  // Opt-in diagnostics only (localStorage @amo_geo_debug = '1'); silent in prod.
  if (debugEnabled()) console.info(`[geo] ${new Date().toISOString()} ${msg}`);
}

function hasGeolocation(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof navigator !== 'undefined' &&
    !!navigator.geolocation &&
    typeof navigator.geolocation.watchPosition === 'function'
  );
}

class GeoService {
  private state: GeoState = { status: 'not-asked', position: null, heading: null };
  private listeners = new Set<Listener>();
  private watchId: number | null = null;
  private wantWatching = false; // the strip is focused & visible
  private lastEmit = 0;
  private visibilityHooked = false;
  private headingHooked = false;
  private lastHeadingEmit = 0;
  private permissionQueried = false;

  constructor() {
    if (!hasGeolocation()) {
      this.state = { ...this.state, status: 'unavailable' };
      return;
    }
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem(DENIED_KEY) === '1') {
        this.state = { ...this.state, status: 'denied' };
      }
    } catch {}
  }

  getState(): GeoState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setState(patch: Partial<GeoState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => {
      try {
        fn(this.state);
      } catch {}
    });
  }

  /** Read the browser permission state without prompting (where supported). */
  async syncPermission(): Promise<GeoStatus> {
    if (this.state.status === 'unavailable' || this.state.status === 'denied') return this.state.status;
    if (this.permissionQueried && this.state.status === 'granted') return 'granted';
    try {
      const perms = (navigator as any).permissions;
      if (perms?.query) {
        const res = await perms.query({ name: 'geolocation' });
        this.permissionQueried = true;
        if (res.state === 'granted') this.becomeGranted();
        else if (res.state === 'denied') this.markDenied();
        // 'prompt' → stays 'not-asked'
        try {
          res.onchange = () => {
            if (res.state === 'granted') this.becomeGranted();
            else if (res.state === 'denied') this.markDenied();
          };
        } catch {}
      }
    } catch {}
    return this.state.status;
  }

  /** Status transition to granted — arms the watch if a screen is waiting.
   *  (start() may have run before the async permission query resolved.) */
  private becomeGranted() {
    this.setState({ status: 'granted' });
    if (this.wantWatching) this.armWatch();
  }

  private markDenied() {
    this.setState({ status: 'denied', position: null, heading: null });
    this.clearWatch();
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(DENIED_KEY, '1');
    } catch {}
    dlog('denied — going silent');
  }

  /**
   * Ask for location. MUST be called from a user gesture the first time.
   * Resolves to the resulting status; never throws.
   */
  async request(): Promise<GeoStatus> {
    if (this.state.status === 'unavailable' || this.state.status === 'denied') return this.state.status;
    return new Promise((resolve) => {
      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            this.setState({
              status: 'granted',
              position: {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy ?? 9999,
                ts: Date.now(),
              },
            });
            this.lastEmit = Date.now();
            dlog('granted (first fix)');
            if (this.wantWatching) this.armWatch();
            resolve('granted');
          },
          (err) => {
            if (err && err.code === 1) this.markDenied();
            // code 2/3 (unavailable/timeout): keep status — a later try may work
            resolve(this.state.status === 'granted' ? 'granted' : this.state.status);
          },
          { enableHighAccuracy: false, maximumAge: 10000, timeout: 15000 },
        );
      } catch {
        resolve(this.state.status);
      }
    });
  }

  /** The owning screen is focused & wants updates. Idempotent. */
  start() {
    this.wantWatching = true;
    this.hookVisibility();
    if (this.state.status === 'granted') this.armWatch();
  }

  /** The owning screen lost focus / unmounted. Idempotent. */
  stop() {
    this.wantWatching = false;
    this.clearWatch();
  }

  private hookVisibility() {
    if (this.visibilityHooked || typeof document === 'undefined') return;
    this.visibilityHooked = true;
    try {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.clearWatch();
          dlog('tab hidden — watch cleared');
        } else if (this.wantWatching && this.state.status === 'granted') {
          this.armWatch();
          dlog('tab visible — watch re-armed');
        }
      });
    } catch {}
  }

  private armWatch() {
    if (this.watchId !== null) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    try {
      this.watchId = navigator.geolocation.watchPosition(
        (pos) => this.onFix(pos),
        (err) => {
          if (err && err.code === 1) this.markDenied();
        },
        { enableHighAccuracy: false, maximumAge: 10000 },
      );
      dlog('watch armed');
    } catch {
      this.watchId = null;
    }
  }

  private clearWatch() {
    if (this.watchId !== null) {
      try {
        navigator.geolocation.clearWatch(this.watchId);
      } catch {}
      this.watchId = null;
    }
  }

  private onFix(pos: GeolocationPosition) {
    const now = Date.now();
    const prev = this.state.position;
    if (now - this.lastEmit < MIN_INTERVAL_MS) return; // ≤1 per 5s
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    if (prev && haversineM(prev.lat, prev.lng, lat, lng) < MIN_MOVE_M) return; // ignore jitter
    this.lastEmit = now;
    dlog(`fix emit ${lat.toFixed(5)},${lng.toFixed(5)} ±${Math.round(pos.coords.accuracy ?? 0)}m`);
    this.setState({
      status: 'granted',
      position: { lat, lng, accuracy: pos.coords.accuracy ?? 9999, ts: now },
    });
  }

  // ── Compass ────────────────────────────────────────────────────────
  // iOS requires DeviceOrientationEvent.requestPermission() inside a user tap;
  // NEVER auto-prompt. Android/desktop just listen. Unsupported → heading stays
  // null and callers render static distance only.

  /** Call from a user gesture. Resolves true if heading events will flow. */
  async requestCompass(): Promise<boolean> {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
    try {
      const DOE: any = (window as any).DeviceOrientationEvent;
      if (!DOE) return false;
      if (typeof DOE.requestPermission === 'function') {
        const res = await DOE.requestPermission(); // iOS 13+
        if (res !== 'granted') return false;
      }
      this.hookHeading();
      return true;
    } catch {
      return false;
    }
  }

  private hookHeading() {
    if (this.headingHooked || typeof window === 'undefined') return;
    this.headingHooked = true;
    const onOrient = (ev: any) => {
      const now = Date.now();
      if (now - this.lastHeadingEmit < HEADING_THROTTLE_MS) return;
      let heading: number | null = null;
      if (typeof ev.webkitCompassHeading === 'number') {
        heading = ev.webkitCompassHeading; // iOS: degrees from North
      } else if (ev.absolute === true && typeof ev.alpha === 'number') {
        heading = (360 - ev.alpha) % 360; // absolute alpha → compass
      } else if (typeof ev.alpha === 'number') {
        heading = (360 - ev.alpha) % 360; // best effort
      }
      if (heading === null || Number.isNaN(heading)) return;
      this.lastHeadingEmit = now;
      this.setState({ heading });
    };
    try {
      const w = window as any;
      if ('ondeviceorientationabsolute' in w) {
        w.addEventListener('deviceorientationabsolute', onOrient);
      } else {
        w.addEventListener('deviceorientation', onOrient);
      }
    } catch {}
  }
}

export const geoService = new GeoService();
