// Native-maps launcher.
//
// App Store Guideline 4 (Design) requires that a location feature let users
// open Apple's built-in Maps app rather than forcing them into a third-party
// map. So on iOS we present a native chooser (Apple Maps / Google Maps).
//
// On Android and web there is no Apple Maps app, and Google Maps is the
// platform-native mapping app on Android — those platforms are not reviewed by
// Apple — so we open Google Maps directly there, exactly as before.
//
// Every Google URL produced here is byte-for-byte what the call sites used
// previously; the only additions are the Apple Maps option and the chooser.
import { Platform, ActionSheetIOS, Linking } from 'react-native';

export interface MapTarget {
  /** Destination latitude. When present with `lng`, we route as directions. */
  lat?: number | null;
  /** Destination longitude. */
  lng?: number | null;
  /** Free-text query (e.g. "Alquímico, Cartagena"). Used when coords absent. */
  query?: string;
  /** Human-readable label for the destination pin (used with coords). */
  label?: string;
}

type Tr = (es: string) => string;

const hasCoords = (t: MapTarget): t is MapTarget & { lat: number; lng: number } =>
  typeof t.lat === 'number' &&
  typeof t.lng === 'number' &&
  !(t.lat === 0 && t.lng === 0);

// http://maps.apple.com/ is Apple's documented universal link — on iOS it opens
// the native Maps app directly. `daddr` = directions-to; `q` = search.
function appleUrl(t: MapTarget): string {
  if (hasCoords(t)) {
    const q = t.label ? `&q=${encodeURIComponent(t.label)}` : '';
    return `http://maps.apple.com/?daddr=${t.lat},${t.lng}${q}`;
  }
  return `http://maps.apple.com/?q=${encodeURIComponent(t.query || t.label || '')}`;
}

function googleWebUrl(t: MapTarget): string {
  if (hasCoords(t)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${t.lat},${t.lng}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    t.query || t.label || ''
  )}`;
}

function googleDeepUrl(t: MapTarget): string {
  if (hasCoords(t)) return `comgooglemaps://?daddr=${t.lat},${t.lng}`;
  return `comgooglemaps://?q=${encodeURIComponent(t.query || t.label || '')}`;
}

// Try `primary`; if it can't be opened (app not installed), fall back to `fallback`.
async function launch(primary: string, fallback?: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      window.open(primary, '_blank', 'noopener,noreferrer');
    }
    return;
  }
  try {
    const can = await Linking.canOpenURL(primary);
    if (can) {
      await Linking.openURL(primary);
      return;
    }
  } catch {
    // fall through to fallback
  }
  if (fallback) {
    try {
      await Linking.openURL(fallback);
    } catch {
      // give up silently — no dialogs (they block the JS bridge)
    }
  }
}

/**
 * Open directions/search for a target in a maps app.
 *
 * iOS: shows a native action sheet so the user can pick Apple Maps or Google
 *      Maps (App Store Guideline 4 compliance).
 * Android: opens the Google Maps app (falls back to the web URL).
 * Web: opens Google Maps in a new tab.
 */
export function openDirections(target: MapTarget, tr: Tr): void {
  const apple = appleUrl(target);
  const gWeb = googleWebUrl(target);
  const gDeep = googleDeepUrl(target);

  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: tr('¿Cómo quieres llegar?'),
        // "Apple Maps" / "Google Maps" are brand names — identical in every language.
        options: ['Apple Maps', 'Google Maps', tr('Cancelar')],
        cancelButtonIndex: 2,
      },
      (index) => {
        if (index === 0) launch(apple);
        else if (index === 1) launch(gDeep, gWeb);
      }
    );
    return;
  }

  // Android: prefer the Google Maps app, fall back to web. Web: new tab.
  launch(Platform.OS === 'android' ? gDeep : gWeb, gWeb);
}
