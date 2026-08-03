// Web Push opt-in (Master Plan 1.4) — value-only, user-initiated, fail-soft.
// The server enforces the 1/day cap; this module only manages the browser
// subscription lifecycle. Unsupported browsers (iOS Safari non-PWA) simply
// report 'unsupported' and no UI nags.

import { Platform } from 'react-native';
import { api } from '../constants/api';

export type PushState = 'unsupported' | 'denied' | 'subscribed' | 'ready';

function supported(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined'
    && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'subscribed' : 'ready';
  } catch {
    return 'unsupported';
  }
}

function b64ToUint8(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/** Call from a user gesture. Returns the resulting state; never throws. */
export async function subscribePush(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'ready';
    const { key } = await api.get('/push/vapid-public-key');
    if (!key) return 'unsupported';
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToUint8(key) as unknown as BufferSource,
    });
    await api.post('/push/subscribe', { subscription: sub.toJSON() });
    return 'subscribed';
  } catch {
    return 'ready';
  }
}

export async function unsubscribePush(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
    return 'ready';
  } catch {
    return 'ready';
  }
}
