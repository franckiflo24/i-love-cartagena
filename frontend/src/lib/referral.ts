// Referral loop (Master Plan 1.5). URL ?ref=CODE → stored → claimed once
// after sign-in. Both sides earn through the real rewards economy.

import { api } from '../constants/api';

const PENDING_KEY = '@amo_pending_ref';

/** Call on app surface mount (web): captures ?ref= into storage. */
export function captureRef() {
  try {
    if (typeof window === 'undefined') return;
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref && /^AMO[A-Z0-9]{4,8}$/i.test(ref)) {
      localStorage.setItem(PENDING_KEY, ref.toUpperCase());
    }
  } catch {}
}

/** After sign-in: claim any pending code exactly once. Fail-soft. */
export async function claimPendingRef(): Promise<{ points: number; referrer: string | null } | null> {
  try {
    const code = typeof localStorage !== 'undefined' ? localStorage.getItem(PENDING_KEY) : null;
    if (!code) return null;
    const r = await api.post('/referral/claim', { code });
    localStorage.removeItem(PENDING_KEY);
    return { points: r?.points_awarded || 0, referrer: r?.referrer_name || null };
  } catch (e: any) {
    // invalid / already-claimed → clear so we never retry-nag
    try { localStorage.removeItem(PENDING_KEY); } catch {}
    return null;
  }
}

export async function myReferral(): Promise<{ code: string; referred_count: number; points_each: number; share_url: string } | null> {
  try {
    return await api.get('/referral/me');
  } catch {
    return null;
  }
}


// Boot-time capture: the entry URL (e.g. /pasaporte?ref=AMOX1234 from a share
// landing) is only visible BEFORE client routing rewrites the query string —
// module evaluation happens exactly then.
captureRef();
