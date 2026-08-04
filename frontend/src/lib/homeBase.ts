// "Mi Base" — the tourist's home base (hotel / Airbnb) so they can get back
// from anywhere with one tap: directions, a ride, or the address to show a
// driver. No more remembering a Spanish address in a foreign city.
//
// PRIVACY: the base lives ONLY on this device (localStorage). It is never
// sent to our servers — the same spine as the passport's location handling.
// A home address is sensitive; keeping it device-only is the honest default.

const KEY = '@amo_home_base';

export interface HomeBase {
  lat: number;
  lng: number;
  label: string;   // user-facing name ("Hotel Caribe", "Airbnb Getsemaní")
  savedAt: number;
}

export function getHomeBase(): HomeBase | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (!raw) return null;
    const b = JSON.parse(raw);
    if (typeof b?.lat === 'number' && typeof b?.lng === 'number') return b as HomeBase;
  } catch { /* corrupt/absent → no base */ }
  return null;
}

export function setHomeBase(b: HomeBase): void {
  try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* storage blocked */ }
}

export function clearHomeBase(): void {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
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
