/**
 * PushBootstrap — top-level component that:
 *  1. Registers the user's push token automatically when they log in
 *  2. Registers the partner's token when business auth is active
 *  3. Listens for notification taps and navigates accordingly
 *  4. Routes the tap that COLD-STARTED the app (getLastNotificationResponseAsync),
 *     deduped by notification request id so a tap is handled exactly once even
 *     when both the listener and the cold-start read see it (EVENTS-ELITE §13 J8).
 *
 * Mount once near the root of the app (inside all providers).
 * Logout token removal lives with the sign-out action (Perfil): by the time
 * `user` turns null here the session is gone and DELETE /users/push-token 401s.
 */
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useRouter, useRootNavigationState } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { useBusinessAuth } from '../context/BusinessAuthContext';
import {
  registerUserPushToken,
  registerPartnerPushToken,
} from '../utils/pushNotifications';

const HANDLED_KEY = '@amo_push_handled_ids';
const HANDLED_MAX = 30;
const SAFE_ID = /^[A-Za-z0-9_-]{1,120}$/;

type PushData = Record<string, unknown>;

// Module scope: survives remounts within one app process.
const handledIds = new Set<string>();

/** Persisted check — ids handled in an EARLIER process (the OS keeps returning
 *  the last response across launches until it is cleared). */
async function handledBefore(id: string): Promise<boolean> {
  if (!id) return false;
  try {
    const raw = await AsyncStorage.getItem(HANDLED_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) && list.includes(id);
  } catch (e) {
    console.error('[PushBootstrap] read handled ids failed', e);
    return false;
  }
}

async function persistHandled(id: string): Promise<void> {
  if (!id) return;
  try {
    const raw = await AsyncStorage.getItem(HANDLED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    if (!list.includes(id)) list.push(id);
    await AsyncStorage.setItem(HANDLED_KEY, JSON.stringify(list.slice(-HANDLED_MAX)));
  } catch (e) {
    console.error('[PushBootstrap] write handled ids failed', e);
  }
}

function dataOf(resp: Notifications.NotificationResponse | null | undefined): PushData {
  const d = resp?.notification?.request?.content?.data;
  return d && typeof d === 'object' ? (d as PushData) : {};
}

export default function PushBootstrap() {
  const router = useRouter();
  const navState = useRootNavigationState();
  const navReady = !!navState?.key;
  const { user } = useAuth();
  const { business } = useBusinessAuth();
  const userRegisteredRef = useRef(false);
  const partnerRegisteredRef = useRef(false);
  const coldStartCheckedRef = useRef(false);
  const businessRef = useRef(business);
  useEffect(() => { businessRef.current = business; }, [business]);

  // Register user push token once after login
  useEffect(() => {
    if (!user || userRegisteredRef.current) return;
    userRegisteredRef.current = true;
    registerUserPushToken().catch(() => { userRegisteredRef.current = false; });
  }, [user]);

  // Register partner push token once after business login
  useEffect(() => {
    if (!business || partnerRegisteredRef.current) return;
    partnerRegisteredRef.current = true;
    registerPartnerPushToken().catch(() => { partnerRegisteredRef.current = false; });
  }, [business]);

  // Reset refs on logout so next login re-registers
  useEffect(() => { if (!user) userRegisteredRef.current = false; }, [user]);
  useEffect(() => { if (!business) partnerRegisteredRef.current = false; }, [business]);

  // Routes the user based on the notification payload.
  const routeFromData = useCallback((data: PushData) => {
    try {
      const kind = String(data?.kind || '');
      const str = (v: unknown) => (typeof v === 'string' && SAFE_ID.test(v) ? v : null);
      if (kind.startsWith('reservation') || data?.reservation_id) {
        // Partner gets routed to their dashboard, user to /reservations
        router.push((businessRef.current ? '/business/reservations' : '/reservations') as never);
        return;
      }
      const eventId = str(data?.event_id);
      if (kind === 'event_reminder' && eventId) {
        router.push(`/event/${eventId}` as never);
        return;
      }
      const partnerId = str(data?.partner_id);
      if (partnerId) {
        router.push(`/partner/${partnerId}` as never);
        return;
      }
      // Default: open the notifications inbox
      router.push('/notifications' as never);
    } catch (e) {
      console.error('[PushBootstrap] tap handler error', e);
    }
  }, [router]);

  const handleResponse = useCallback(async (resp: Notifications.NotificationResponse | null) => {
    if (!resp) return;
    const id = resp.notification?.request?.identifier || '';
    if (id) {
      // Claim synchronously: the listener and the cold-start read can both see
      // the launching tap in the same tick.
      if (handledIds.has(id)) return;
      handledIds.add(id);
      if (await handledBefore(id)) return;
      await persistHandled(id);
    }
    routeFromData(dataOf(resp));
  }, [routeFromData]);

  // Global tap handler (app running or backgrounded).
  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    try {
      sub = Notifications.addNotificationResponseReceivedListener((resp) => {
        handleResponse(resp).catch((e: unknown) => console.error('[PushBootstrap] response failed', e));
      });
    } catch (e) {
      console.error('[PushBootstrap] listener attach failed', e);
    }
    return () => {
      try { sub?.remove(); } catch (e) { console.error('[PushBootstrap] listener remove failed', e); }
    };
  }, [handleResponse]);

  // Cold start: the tap that launched a killed app. Native only, once, and
  // only after the root navigator is mounted (navigating earlier throws).
  useEffect(() => {
    if (Platform.OS === 'web' || !navReady || coldStartCheckedRef.current) return;
    coldStartCheckedRef.current = true;
    (async () => {
      try {
        const resp = await Notifications.getLastNotificationResponseAsync();
        await handleResponse(resp);
        if (resp) {
          try { await Notifications.clearLastNotificationResponseAsync(); } catch (e) { console.error('[PushBootstrap] clear last response failed', e); }
        }
      } catch (e) {
        console.error('[PushBootstrap] cold-start read failed', e);
      }
    })();
  }, [navReady, handleResponse]);

  return null;
}
