/**
 * Push Notifications utility for Amo Cartagena.
 *
 * Handles:
 *  - Permission request (auto on first login per user choice 3a)
 *  - Expo Push Token retrieval
 *  - Token registration to backend (user OR partner)
 *  - Foreground notification handler (banner + sound while app open)
 *  - Tap handler to navigate when notification is clicked
 *
 * Works in Expo Go AND in EAS native builds without external keys.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { api } from '../constants/api';

// ── Foreground handler: show banner & sound when app is open ──
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
    // legacy keys (older expo-notifications)
    shouldShowAlert: true,
  } as any),
});

let cachedToken: string | null = null;

export async function ensurePushPermission(): Promise<boolean> {
  // Push notifications don't work on physical-only features in web/simulators
  if (Platform.OS === 'web') return false;
  if (!Device.isDevice) return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  let final = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    final = status;
  }
  return final === 'granted';
}

/**
 * Get the Expo push token for this device. Returns null if permission
 * denied, on web, or in a context where it cannot be obtained.
 */
export async function getExpoPushToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  try {
    const ok = await ensurePushPermission();
    if (!ok) return null;
    // Configure Android channel (no-op on iOS)
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Amo Cartagena',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#D97706',
      });
    }
    // projectId is needed for EAS-managed projects. Falls back to undefined for Expo Go.
    const projectId =
      (Constants?.expoConfig as any)?.extra?.eas?.projectId ||
      (Constants?.easConfig as any)?.projectId;
    const tokenResp = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    cachedToken = tokenResp?.data || null;
    return cachedToken;
  } catch (e) {
    console.warn('getExpoPushToken failed', e);
    return null;
  }
}

/**
 * Register the device's push token with the backend for the current user.
 * Call this RIGHT AFTER a successful login (or when the app boots if already logged in).
 */
export async function registerUserPushToken(): Promise<boolean> {
  const token = await getExpoPushToken();
  if (!token) return false;
  try {
    await api.post('/users/push-token', {
      token,
      platform: Platform.OS,
      device_name: Device.modelName || Device.deviceName || 'unknown',
    });
    return true;
  } catch (e) {
    console.warn('registerUserPushToken failed', e);
    return false;
  }
}

/**
 * Register for a business/partner account. Same token, different endpoint
 * so the backend can route push to the partner's devices.
 */
export async function registerPartnerPushToken(): Promise<boolean> {
  const token = await getExpoPushToken();
  if (!token) return false;
  try {
    await api.post('/business/push-token', {
      token,
      platform: Platform.OS,
      device_name: Device.modelName || Device.deviceName || 'unknown',
    });
    return true;
  } catch (e) {
    console.warn('registerPartnerPushToken failed', e);
    return false;
  }
}

/**
 * Unregister on logout. Best-effort.
 */
export async function unregisterPushToken(scope: 'user' | 'partner') {
  if (!cachedToken) return;
  try {
    const path = scope === 'partner' ? '/business/push-token' : '/users/push-token';
    await api.delete(path, { token: cachedToken });
  } catch (e) {
    console.warn('unregisterPushToken failed', e);
  }
}

/**
 * Sets up listeners for notification taps + foreground receipts.
 * Returns a cleanup function. Call from a top-level _layout.tsx.
 */
export function attachPushListeners(
  onTap: (data: Record<string, any>) => void
): () => void {
  const tapSub = Notifications.addNotificationResponseReceivedListener(resp => {
    const data = resp?.notification?.request?.content?.data || {};
    onTap(data);
  });
  // Optional: log foreground receipts (useful for debugging)
  const fgSub = Notifications.addNotificationReceivedListener(_n => {
    // no-op; the foreground handler already shows the banner
  });
  return () => {
    try { tapSub.remove(); } catch {}
    try { fgSub.remove(); } catch {}
  };
}
