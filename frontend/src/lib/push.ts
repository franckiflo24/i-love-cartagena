// Web Push opt-in (Master Plan 1.4) — value-only, user-initiated, fail-soft.
// The server enforces the 1/day cap; this module only manages the browser
// subscription lifecycle. Unsupported browsers (iOS Safari non-PWA) simply
// report 'unsupported' and no UI nags.
//
// EVENTS-ELITE §13 H3 — consent SCOPES. One browser subscription can carry
// several consents: 'passport' (streak/reward milestones, the original toggle)
// and 'events' (reminders for events the user saved). Event reminders are sent
// ONLY to subscriptions whose scopes include 'events'; rows that predate scopes
// count as ['passport'] (server and client agree on that default).
//
// Contract with the backend (webpush.py):
//   POST /push/subscribe   { subscription, scopes: [...] }  → scopes is the FULL
//                           desired set for this endpoint (server $sets it; a body
//                           without scopes means ['passport']).
//   POST /push/unsubscribe { endpoint }                     → removes the row.
// Removing ONE scope while another remains = re-POST subscribe with the rest.
// The device keeps its own copy of the scopes it granted ('@amo_push_scopes')
// so the UI can tell "passport only" from "events too" without a server read.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../constants/api';

export type PushState = 'unsupported' | 'denied' | 'subscribed' | 'ready';
export type PushScope = 'passport' | 'events';

const SCOPES_KEY = '@amo_push_scopes';
const LEGACY_SCOPES: PushScope[] = ['passport'];

type ScopeRecord = { endpoint: string; scopes: PushScope[] };

function supported(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined'
    && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// `navigator.serviceWorker.ready` NEVER settles when registration failed or is blocked (Safari
// with all cookies blocked, enterprise policy, a broken sw.js). Every caller awaits it through
// this bounded helper and treats null as "no push on this browser".
const SW_READY_TIMEOUT_MS = 3000;

async function swReady(): Promise<ServiceWorkerRegistration | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isScope(v: unknown): v is PushScope {
  return v === 'passport' || v === 'events';
}

function uniqScopes(list: PushScope[]): PushScope[] {
  return Array.from(new Set(list.filter(isScope)));
}

async function readScopeRecord(): Promise<ScopeRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(SCOPES_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const rec = parsed as { endpoint?: unknown; scopes?: unknown };
    if (typeof rec.endpoint !== 'string' || !Array.isArray(rec.scopes)) return null;
    return { endpoint: rec.endpoint, scopes: uniqScopes(rec.scopes.filter(isScope)) };
  } catch (e) {
    console.error('[push] read scope record failed', e);
    return null;
  }
}

async function writeScopeRecord(rec: ScopeRecord | null): Promise<void> {
  try {
    if (rec) await AsyncStorage.setItem(SCOPES_KEY, JSON.stringify(rec));
    else await AsyncStorage.removeItem(SCOPES_KEY);
  } catch (e) {
    console.error('[push] write scope record failed', e);
  }
}

/** Scopes the device granted for this endpoint. A subscription with no local
 *  record predates scopes → ['passport'] (§13 H3). */
async function scopesForEndpoint(endpoint: string): Promise<PushScope[]> {
  const rec = await readScopeRecord();
  if (rec && rec.endpoint === endpoint) return rec.scopes;
  return LEGACY_SCOPES.slice();
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await swReady();
    if (!reg) return 'unsupported';
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'subscribed' : 'ready';
  } catch {
    return 'unsupported';
  }
}

/** Consent scopes of this browser's live subscription ([] when not subscribed). */
export async function pushScopes(): Promise<PushScope[]> {
  if (!supported()) return [];
  try {
    const reg = await swReady();
    if (!reg) return [];
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return [];
    return await scopesForEndpoint(sub.endpoint);
  } catch (e) {
    console.error('[push] read scopes failed', e);
    return [];
  }
}

export async function hasPushScope(scope: PushScope): Promise<boolean> {
  return (await pushScopes()).includes(scope);
}

function b64ToUint8(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/**
 * Call from a user gesture (the permission prompt needs it — nothing may be
 * awaited before this call in the tap handler). Adds `scopes` to this browser's
 * subscription, creating it when needed. Returns the resulting state; never throws.
 */
export async function subscribePush(scopes: PushScope[] = ['passport']): Promise<PushState> {
  if (!supported()) return 'unsupported';
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'ready';
    const reg = await swReady();
    if (!reg) return 'unsupported';
    let sub = await reg.pushManager.getSubscription();
    const existed = !!sub;
    if (!sub) {
      const { key } = await api.get('/push/vapid-public-key');
      if (!key) return 'unsupported';
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToUint8(key) as unknown as BufferSource,
      });
    }
    const current = existed ? await scopesForEndpoint(sub.endpoint) : [];
    const merged = uniqScopes([...current, ...scopes]);
    await api.post('/push/subscribe', { subscription: sub.toJSON(), scopes: merged });
    await writeScopeRecord({ endpoint: sub.endpoint, scopes: merged });
    return 'subscribed';
  } catch (e) {
    console.error('[push] subscribe failed', e);
    return 'ready';
  }
}

/**
 * Remove one consent scope (the subscription survives while another scope
 * remains), or — with no scope — drop the whole browser subscription.
 */
export async function unsubscribePush(scope?: PushScope): Promise<PushState> {
  if (!supported()) return 'unsupported';
  try {
    const reg = await swReady();
    if (!reg) return 'unsupported';
    const sub = await reg.pushManager.getSubscription();
    if (!sub) {
      await writeScopeRecord(null);
      return 'ready';
    }
    if (scope) {
      const remaining = (await scopesForEndpoint(sub.endpoint)).filter((s) => s !== scope);
      if (remaining.length) {
        await api.post('/push/subscribe', { subscription: sub.toJSON(), scopes: remaining });
        await writeScopeRecord({ endpoint: sub.endpoint, scopes: remaining });
        return 'subscribed';
      }
    }
    await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch((e: unknown) => {
      console.error('[push] server unsubscribe failed', e);
    });
    await sub.unsubscribe();
    await writeScopeRecord(null);
    return 'ready';
  } catch (e) {
    console.error('[push] unsubscribe failed', e);
    return 'ready';
  }
}
