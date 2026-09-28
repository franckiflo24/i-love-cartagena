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
// Two backends, one contract: web uses navigator.geolocation; native (iOS app)
// uses expo-location with the same throttle/jitter rules, AppState in place of
// visibilitychange, and the OS permission as the sticky "denied" source. (Native
// used to report 'unavailable', so Mi base / Lo probé / passport stamps told
// users with location ON to "activate your location".)

import { AppState, Platform } from 'react-native';
import * as Location from 'expo-location';

const IS_NATIVE = Platform.OS !== 'web';

/** The shape both backends deliver (GeolocationPosition and expo LocationObject). */
type Fix = { coords: { latitude: number; longitude: number; accuracy?: number | null } };

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

/**
 * Language-neutral distance label ("120 m", "1.2 km", "5563 km"). The old
 * per-screen helpers baked Spanish in ("a 120m de ti"), which showed on
 * English/French/Portuguese UIs.
 */
export function fmtDistance(m: number): string {
  if (!Number.isFinite(m)) return '';
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  const km = m / 1000;
  return km < 100 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

// ── City gate ──────────────────────────────────────────────────────
// Shared by the passport tab, the partner page and the map (single source of
// truth — mapa.tsx carries a private copy of the bounds that should import
// these instead). Pure functions, no hooks, no side effects.
export const CTG_CENTER = { lat: 10.4236, lng: -75.5483 };
export const CTG_BOUNDS = { latMin: 10.30, latMax: 10.50, lngMin: -75.62, lngMax: -75.45 };
/** Beyond this distance from the centre the app is in REMOTE mode. */
export const REMOTE_KM = 20;

export function isInCartagena(lat: number, lng: number): boolean {
  return lat >= CTG_BOUNDS.latMin && lat <= CTG_BOUNDS.latMax
      && lng >= CTG_BOUNDS.lngMin && lng <= CTG_BOUNDS.lngMax;
}

/** Straight-line distance from a point to the city centre, in km (unrounded). */
export function distanceToCartagenaKm(lat: number, lng: number): number {
  return haversineM(lat, lng, CTG_CENTER.lat, CTG_CENTER.lng) / 1000;
}

export type CityMode = 'unknown' | 'in_city' | 'remote';

/**
 * unknown = permission not asked / no fix yet → keep today's UI untouched.
 * in_city = a fix within REMOTE_KM of the centre.
 * remote  = a fix beyond REMOTE_KM, OR location denied/unavailable (no fix will
 *           ever arrive, so proximity features must not pretend otherwise).
 * `km` is rounded and null whenever there is no fix.
 */
export function cityMode(geo: GeoState): { mode: CityMode; km: number | null } {
  const pos = geo.status === 'granted' ? geo.position : null;
  if (!pos) {
    const noFixEver = geo.status === 'denied' || geo.status === 'unavailable';
    return { mode: noFixEver ? 'remote' : 'unknown', km: null };
  }
  const km = distanceToCartagenaKm(pos.lat, pos.lng);
  if (!Number.isFinite(km)) return { mode: 'unknown', km: null };
  return { mode: km > REMOTE_KM ? 'remote' : 'in_city', km: Math.round(km) };
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
  if (IS_NATIVE) return true; // expo-location; permission is resolved per request
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
  private wantWatching = false; // the strip is focused & visible
  private visibilityHooked = false;
  private headingHooked = false;
  private lastHeadingEmit = 0;
  private permissionQueried = false;

  // Watch handle + emit throttle live on globalThis so the ≤1-per-5s and
  // single-registration invariants hold even if the bundler evaluates this
  // module more than once (observed on the static export).
  private get watchId(): number | null {
    const v = (globalThis as any).__amoGeoWatchId;
    return typeof v === 'number' ? v : null;
  }
  private set watchId(v: number | null) {
    (globalThis as any).__amoGeoWatchId = v;
  }
  private get lastEmit(): number {
    return (globalThis as any).__amoGeoLastEmit || 0;
  }
  private set lastEmit(v: number) {
    (globalThis as any).__amoGeoLastEmit = v;
  }
  // Native: watchPositionAsync resolves asynchronously, so a stop() can land
  // before the subscription exists — track "arming" and drop a late arrival.
  private get nativeSub(): Location.LocationSubscription | null {
    return (globalThis as any).__amoGeoNativeSub || null;
  }
  private set nativeSub(v: Location.LocationSubscription | null) {
    (globalThis as any).__amoGeoNativeSub = v;
  }
  private nativeArming = false;

  constructor() {
    if (!hasGeolocation()) {
      this.state = { ...this.state, status: 'unavailable' };
      return;
    }
    if (IS_NATIVE) return; // the OS remembers a denial; syncPermission() reads it
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
    if (IS_NATIVE) {
      try {
        const res = await Location.getForegroundPermissionsAsync();
        this.permissionQueried = true;
        if (res.status === 'granted') this.becomeGranted();
        else if (res.status === 'denied') this.markDenied();
        // 'undetermined' → stays 'not-asked'
      } catch {}
      return this.state.status;
    }
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
    if (IS_NATIVE) { dlog('denied — going silent'); return; } // OS holds the sticky denial
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
    if (IS_NATIVE) return this.requestNative();
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

  private async requestNative(): Promise<GeoStatus> {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        if (perm.status === 'denied') this.markDenied();
        return this.state.status;
      }
      this.permissionQueried = true;
      // A cold GPS fix can take a while indoors; cap it and fall back to the
      // last known fix so a tap never hangs (web uses the same 15s budget).
      const fix = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((r) => setTimeout(() => r(null), 15000)),
      ]).catch(() => null) || await Location.getLastKnownPositionAsync().catch(() => null);
      if (fix) {
        this.setState({
          status: 'granted',
          position: { lat: fix.coords.latitude, lng: fix.coords.longitude, accuracy: fix.coords.accuracy ?? 9999, ts: Date.now() },
        });
        this.lastEmit = Date.now();
        dlog('granted (first fix, native)');
      } else {
        this.setState({ status: 'granted' }); // permission yes, no fix yet — the watch will deliver
      }
      if (this.wantWatching) this.armWatch();
      return 'granted';
    } catch {
      return this.state.status;
    }
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
    if (this.visibilityHooked) return;
    if (IS_NATIVE) {
      this.visibilityHooked = true;
      try {
        AppState.addEventListener('change', (st) => {
          if (st !== 'active') {
            this.clearWatch();
            dlog('app backgrounded — watch cleared');
          } else if (this.wantWatching && this.state.status === 'granted') {
            this.armWatch();
            dlog('app active — watch re-armed');
          }
        });
      } catch {}
      return;
    }
    if (typeof document === 'undefined') return;
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
    if (IS_NATIVE) {
      if (this.nativeSub || this.nativeArming) return;
      if (AppState.currentState !== 'active') return;
      this.nativeArming = true;
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: MIN_INTERVAL_MS, distanceInterval: MIN_MOVE_M },
        (loc) => this.onFix(loc),
      ).then((sub) => {
        this.nativeArming = false;
        // stop()/background landed while arming → drop this subscription
        if (!this.wantWatching || AppState.currentState !== 'active' || this.nativeSub) { sub.remove(); return; }
        this.nativeSub = sub;
        dlog('watch armed (native)');
      }).catch(() => { this.nativeArming = false; });
      return;
    }
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
    if (IS_NATIVE) {
      const sub = this.nativeSub;
      this.nativeSub = null;
      if (sub) { try { sub.remove(); } catch {} }
      return;
    }
    if (this.watchId !== null) {
      try {
        navigator.geolocation.clearWatch(this.watchId);
      } catch {}
      this.watchId = null;
    }
  }

  private onFix(pos: Fix) {
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
    if (IS_NATIVE) {
      if (this.state.status !== 'granted') return false; // heading rides the location permission
      if (this.headingHooked) return true;
      try {
        this.headingHooked = true;
        await Location.watchHeadingAsync((h) => {
          const now = Date.now();
          if (now - this.lastHeadingEmit < HEADING_THROTTLE_MS) return;
          const heading = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          if (typeof heading !== 'number' || Number.isNaN(heading) || heading < 0) return;
          this.lastHeadingEmit = now;
          this.setState({ heading });
        });
        return true;
      } catch {
        this.headingHooked = false;
        return false;
      }
    }
    if (typeof window === 'undefined') return false;
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

// True singleton even if the bundler duplicates this module across route
// chunks (observed on the static export: two instances → two live watches
// → double battery + throttle bypass). globalThis survives duplication.
const _g = globalThis as any;
export const geoService: GeoService = _g.__amoGeoService || (_g.__amoGeoService = new GeoService());
