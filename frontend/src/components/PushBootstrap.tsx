/**
 * PushBootstrap — top-level component that:
 *  1. Registers the user's push token automatically when they log in
 *  2. Registers the partner's token when business auth is active
 *  3. Listens for notification taps and navigates accordingly
 *
 * Mount once near the root of the app (inside all providers).
 */
import React, { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { useBusinessAuth } from '../context/BusinessAuthContext';
import {
  registerUserPushToken,
  registerPartnerPushToken,
  attachPushListeners,
} from '../utils/pushNotifications';

export default function PushBootstrap() {
  const router = useRouter();
  const { user } = useAuth();
  const { business } = useBusinessAuth();
  const userRegisteredRef = useRef(false);
  const partnerRegisteredRef = useRef(false);

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

  // Global tap handler — routes the user based on notification payload
  useEffect(() => {
    const cleanup = attachPushListeners((data) => {
      try {
        const kind = String(data?.kind || '');
        if (kind.startsWith('reservation') || data?.reservation_id) {
          // Partner gets routed to their dashboard, user to /reservations
          if (business) {
            router.push('/business/reservations' as any);
          } else {
            router.push('/reservations' as any);
          }
          return;
        }
        if (kind === 'event_reminder' && data?.event_id) {
          router.push(`/event/${data.event_id}` as any);
          return;
        }
        if (data?.partner_id) {
          router.push(`/partner/${data.partner_id}` as any);
          return;
        }
        // Default: open the notifications inbox
        router.push('/notifications' as any);
      } catch (e) {
        console.warn('push tap handler error', e);
      }
    });
    return cleanup;
  }, [router, business]);

  return null;
}
