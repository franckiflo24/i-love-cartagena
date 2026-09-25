// "Mi Base" — the tourist's home base (hotel / Airbnb) so they can get back
// from anywhere with one tap: directions, a ride, or the address to show a
// driver. No more remembering a Spanish address in a foreign city.
//
// STORAGE: the base is saved to the signed-in user's ACCOUNT (server-side) so it
// follows them across devices, AND cached locally (localStorage on web, memory +
// AsyncStorage on native) for instant, offline
// reads. If the user isn't signed in, it stays device-local until they are, then
// migrates up on the next sync. Only the owner can read it (auth-scoped endpoint).

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../constants/api';

const KEY = '@amo_home_base';
const IS_WEB = Platform.OS === 'web';

export interface HomeBase {
  lat: number;
  lng: number;
  label: string;   // user-facing name ("Hotel Caribe", "Airbnb Getsemaní")
  savedAt: number;
}

function parseBase(raw: string | null): HomeBase | null {
  try {
    if (!raw) return null;
    const b = JSON.parse(raw);
    if (typeof b?.lat === 'number' && typeof b?.lng === 'number') return b as HomeBase;
  } catch { /* corrupt/absent → no base */ }
  return null;
}

// Native has no localStorage (the base silently never persisted on iOS). There
// the cache is in memory — getHomeBase() must stay synchronous — backed by
// AsyncStorage and hydrated once at startup; syncHomeBase() awaits it.
let nativeBase: HomeBase | null = null;
let nativeTouched = false; // a write before hydration finishes must win
const nativeHydrated: Promise<void> = IS_WEB
  ? Promise.resolve()
  : AsyncStorage.getItem(KEY)
      .then((raw) => { if (!nativeTouched) nativeBase = parseBase(raw); })
      .catch(() => { /* storage unavailable → no cached base */ });

export function getHomeBase(): HomeBase | null {
  if (!IS_WEB) return nativeBase;
  try {
    return parseBase(typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null);
  } catch { /* storage blocked */ }
  return null;
}

function setHomeBaseLocal(b: HomeBase | null): void {
  if (!IS_WEB) {
    nativeBase = b;
    nativeTouched = true;
    (b ? AsyncStorage.setItem(KEY, JSON.stringify(b)) : AsyncStorage.removeItem(KEY)).catch(() => { /* storage blocked */ });
    return;
  }
  try {
    if (b) localStorage.setItem(KEY, JSON.stringify(b));
    else localStorage.removeItem(KEY);
  } catch { /* storage blocked */ }
}

// Persist to the account (fire-and-forget so the UI stays instant) + local cache.
export function setHomeBase(b: HomeBase): void {
  setHomeBaseLocal(b);
  void pushHomeBaseToServer(b);
}

export function clearHomeBase(): void {
  setHomeBaseLocal(null);
  void api.delete('/profile/home-base').catch(() => { /* anonymous/offline → local clear is enough */ });
}

// Drop ONLY the local cache (not the account copy). Call on logout so the next
// account on this device doesn't inherit — or accidentally migrate up — the
// previous user's base. Their saved base stays on their account for next login.
export function forgetLocalHomeBase(): void {
  setHomeBaseLocal(null);
}

async function pushHomeBaseToServer(b: HomeBase): Promise<void> {
  try {
    await api.put('/profile/home-base', { lat: b.lat, lng: b.lng, label: b.label, saved_at: b.savedAt });
  } catch { /* anonymous or offline → the local copy holds until the next sync */ }
}

// Reconcile the account base with the local cache. Call on app open / sheet open /
// map mount so a signed-in user sees their base on ANY device.
//  - signed-in + server has a base  → adopt it locally, return it
//  - signed-in + server empty + local exists → migrate local up, keep it
//  - not signed in / offline → keep whatever is local
export async function syncHomeBase(): Promise<HomeBase | null> {
  await nativeHydrated;
  const local = getHomeBase();
  try {
    const res = await api.get('/profile/home-base');   // 401 if anonymous → throws
    const sb = res?.base;
    if (sb && typeof sb.lat === 'number' && typeof sb.lng === 'number') {
      const b: HomeBase = {
        lat: sb.lat, lng: sb.lng,
        label: sb.label || 'Mi base',
        savedAt: sb.saved_at || Date.now(),
      };
      setHomeBaseLocal(b);
      return b;
    }
    // Authenticated but no server base yet — migrate a locally-set one up.
    if (local) void pushHomeBaseToServer(local);
    return local;
  } catch {
    return local;   // anonymous / offline → local cache is the source of truth
  }
}

// ── "Take me back" deep links ────────────────────────────────────────
// Directions: universal Google Maps link — iOS offers Apple/Google Maps,
// Android opens Google Maps, web opens maps.google. No origin = current
// location; no travelmode = the user picks walk/drive/transit.
export function directionsUrl(b: HomeBase): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}`;
}

// Uber universal deep link — pickup = current location, dropoff = the base.
// Opens the Uber app if installed, else m.uber.com.
export function uberUrl(b: HomeBase): string {
  const nick = encodeURIComponent(b.label || 'Mi base');
  return `https://m.uber.com/ul/?action=setPickup&pickup=my_location`
    + `&dropoff[latitude]=${b.lat}&dropoff[longitude]=${b.lng}&dropoff[nickname]=${nick}`;
}

// Plain text to show a taxi driver or paste into any ride app.
export function shareText(b: HomeBase): string {
  return `${b.label} — https://maps.google.com/?q=${b.lat},${b.lng}`;
}
