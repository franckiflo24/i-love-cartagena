// PALCO Stage B — secure-wallet device enrollment client (contract: docs/palco-v2/DESIGN.md §5, §13.5).
//
// The holder's iPhone proves two things to POST /palco/enroll/verify, binding ONE server
// challenge to ONE device public key:
//   1. Possession of a non-exportable P-256 wallet key (Secure Enclave via
//      @pagopa/io-react-native-crypto): it signs `palco-enroll|<challenge>|<key_id>`.
//   2. App authenticity (Apple App Attest via @expo/app-integrity): DCAppAttest attests a key
//      and covers the SAME binding string, so the attestation replays nowhere else.
//
// HONESTY: there is NO software fallback here. If App Attest is unavailable (web, Android,
// simulator, old device) enrollment refuses with an honest reason — the server would refuse a
// downgrade anyway (fail-closed attester registry). The `sandbox` mode is for tests only.
//
// NATIVE-MODULE DISCIPLINE: both native packages are require()d lazily inside iOS-only code
// paths. The web bundle may CONTAIN them (Metro bundles statically) but never executes them;
// runtime 1.1.7 never receives this JS (OTA targets runtimeVersion = appVersion).
//
// Every network response is parsed defensively: an unexpected body becomes a PalcoWalletError
// the screen renders as an honest state — never a crash, never a fake "enrolled".
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import {
  AMO_CLIENT_HEADERS, API_BASE, WRITE_TIMEOUT_MS, fetchT, getToken,
} from '../constants/api';

export const POLICY_VERSION = 'ley1581-v1-2026-10';
const KEY_TAG_PREFIX = 'palco_wallet_v1';            // one Secure Enclave key per account
const STORE_PREFIX = 'palco_enrollment_v1';

export type WalletSupport = 'ok' | 'web' | 'android' | 'no_attest';

export interface Enrollment {
  device_key_id: string;
  hw_tier: string;
  enrolled_at: string;       // ISO, device clock — display only
}

export type WalletErrorCode =
  | 'auth' | 'no_attest' | 'keygen' | 'attest' | 'network' | 'server' | 'refused';

export class PalcoWalletError extends Error {
  code: WalletErrorCode;
  /** Machine key from the server (`attestation_failed`, …) when it sent one. */
  serverError: string | null;
  constructor(code: WalletErrorCode, serverError: string | null = null) {
    super(serverError || code);
    this.code = code;
    this.serverError = serverError;
  }
}

// ── support detection (call from an effect, never at render — React #418) ─────
export function detectWalletSupport(): WalletSupport {
  if (Platform.OS === 'web') return 'web';
  if (Platform.OS === 'android') return 'android';
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const integrity = require('@expo/app-integrity') as { isSupported?: boolean };
    return integrity.isSupported ? 'ok' : 'no_attest';   // simulators & pre-A11 report false
  } catch {
    return 'no_attest';    // pod absent (older runtime) — honest refusal, no crash
  }
}

// ── small codecs (no deps; Hermes atob exists but we never want a polyfill risk) ──
const B64_ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function b64ToBytes(b64: string): Uint8Array | null {
  const clean = b64.replace(/[=\s]+$/g, '');
  if (!/^[A-Za-z0-9+/]*$/.test(clean)) return null;
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const v = B64_ABC.indexOf(clean[i]);
    if (v < 0) return null;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

function bytesToB64u(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : -1;
    const c = i + 2 < bytes.length ? bytes[i + 2] : -1;
    out += B64_ABC[a >> 2];
    out += B64_ABC[((a & 3) << 4) | (b >= 0 ? b >> 4 : 0)];
    if (b >= 0) out += B64_ABC[((b & 15) << 2) | (c >= 0 ? c >> 6 : 0)];
    if (c >= 0) out += B64_ABC[c & 63];
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_');
}

/** JWK coordinate → b64url without padding (pagopa may emit standard base64). */
function toB64u(coord: string): string {
  return coord.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * ECDSA DER (what iOS/Android `sign` returns, base64) → raw r‖s 64 B, b64url —
 * the only signature spelling the PALCO wire layer accepts.
 */
export function derSigToRawB64u(derB64: string): string | null {
  const der = b64ToBytes(derB64);
  if (!der || der.length < 8 || der[0] !== 0x30) return null;
  let idx = 2;                                   // tag + short len (sigs are < 128 B)
  if (der[1] & 0x80) idx = 2 + (der[1] & 0x7f);  // long-form length
  const readInt = (): Uint8Array | null => {
    if (der[idx] !== 0x02) return null;
    const len = der[idx + 1];
    const start = idx + 2;
    idx = start + len;
    if (idx > der.length) return null;
    let v = der.slice(start, start + len);
    while (v.length > 1 && v[0] === 0x00) v = v.slice(1);   // strip sign padding
    if (v.length > 32) return null;
    const padded = new Uint8Array(32);
    padded.set(v, 32 - v.length);
    return padded;
  };
  const r = readInt();
  const s = readInt();
  if (!r || !s) return null;
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return bytesToB64u(raw);
}

/** RFC 7638 thumbprint, SHA-256 hex, first 12 — byte-identical to the server's. */
export async function keyIdForJwk(jwk: { x: string; y: string }): Promise<string> {
  const canonical = `{"crv":"P-256","kty":"EC","x":"${jwk.x}","y":"${jwk.y}"}`;
  const hex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, canonical);
  return hex.slice(0, 12);
}

// ── local record ─────────────────────────────────────────────────────────────
function storeKey(userId: string): string {
  // SecureStore keys allow [A-Za-z0-9._-]; user ids are hex-ish but sanitize anyway.
  return `${STORE_PREFIX}.${userId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

export async function getStoredEnrollment(userId: string): Promise<Enrollment | null> {
  if (Platform.OS === 'web') return null;
  try {
    const raw = await SecureStore.getItemAsync(storeKey(userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.device_key_id !== 'string' || typeof rec.hw_tier !== 'string') return null;
    return {
      device_key_id: rec.device_key_id,
      hw_tier: rec.hw_tier,
      enrolled_at: typeof rec.enrolled_at === 'string' ? rec.enrolled_at : '',
    };
  } catch {
    return null;    // unreadable keychain entry = not enrolled; re-enrolling is idempotent
  }
}

// ── network ──────────────────────────────────────────────────────────────────
async function authedPost(path: string, body: unknown): Promise<Record<string, unknown>> {
  const token = await getToken();
  if (!token) throw new PalcoWalletError('auth');
  let res: Response;
  try {
    res = await fetchT(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...AMO_CLIENT_HEADERS,
      },
      body: JSON.stringify(body),
    }, WRITE_TIMEOUT_MS);
  } catch {
    throw new PalcoWalletError('network');
  }
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  if (res.status === 401) throw new PalcoWalletError('auth');
  if (!res.ok) {
    const detail = (parsed as { detail?: { error?: unknown } } | null)?.detail;
    const code = typeof detail?.error === 'string' ? detail.error : null;
    throw new PalcoWalletError(code ? 'refused' : 'server', code);
  }
  if (!parsed || typeof parsed !== 'object') throw new PalcoWalletError('server');
  return parsed as Record<string, unknown>;
}

// ── the flow ─────────────────────────────────────────────────────────────────
export async function enrollThisDevice(userId: string): Promise<Enrollment> {
  if (detectWalletSupport() !== 'ok') throw new PalcoWalletError('no_attest');

  // Native modules — iOS path only from here on.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pagopa = require('@pagopa/io-react-native-crypto') as {
    generate(tag: string): Promise<{ kty: string; crv?: string; x?: string; y?: string }>;
    getPublicKeyFixed(tag: string): Promise<{ kty: string; crv?: string; x?: string; y?: string }>;
    sign(message: string, tag: string): Promise<string>;
  };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const integrity = require('@expo/app-integrity') as {
    generateKeyAsync(): Promise<string>;
    attestKeyAsync(keyId: string, challenge: string): Promise<string>;
  };

  // 1) The wallet key: create once per account, reuse forever (idempotent server-side).
  //    The public key is ALWAYS read back via getPublicKeyFixed — generate()'s own return
  //    can carry mis-padded coordinates (the bug that API exists to fix), and the server
  //    requires exactly 32-byte P-256 coords.
  const keyTag = `${KEY_TAG_PREFIX}.${userId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
  try {
    await pagopa.generate(keyTag);
  } catch (e) {
    const code = (e as { message?: string } | null)?.message;
    if (code === 'UNSUPPORTED_DEVICE') throw new PalcoWalletError('no_attest');
    if (code !== 'KEY_ALREADY_EXISTS') throw new PalcoWalletError('keygen');
  }
  let pub: { kty: string; crv?: string; x?: string; y?: string };
  try {
    pub = await pagopa.getPublicKeyFixed(keyTag);
  } catch {
    throw new PalcoWalletError('keygen');
  }
  if (pub.kty !== 'EC' || !pub.x || !pub.y) throw new PalcoWalletError('keygen');
  const jwk = { kty: 'EC', crv: 'P-256', x: toB64u(pub.x), y: toB64u(pub.y) };
  const keyId = await keyIdForJwk(jwk);

  // 2) One-time challenge + the binding both proofs cover.
  const ch = await authedPost('/palco/enroll/challenge', {});
  const challengeId = typeof ch.challenge_id === 'string' ? ch.challenge_id : '';
  const challenge = typeof ch.challenge === 'string' ? ch.challenge : '';
  if (!challengeId || !challenge) throw new PalcoWalletError('server');
  const binding = `palco-enroll|${challenge}|${keyId}`;

  // 3) Proof-of-possession of the wallet key.
  let popSig: string | null;
  try {
    popSig = derSigToRawB64u(await pagopa.sign(binding, keyTag));
  } catch {
    throw new PalcoWalletError('keygen');
  }
  if (!popSig) throw new PalcoWalletError('keygen');

  // 4) App Attest over the SAME binding (fresh DCAppAttest key each attempt — cheap,
  //    and a stale keychain id from a restore would fail attestKey anyway).
  let aaKeyId: string;
  let attestation: string;
  try {
    aaKeyId = await integrity.generateKeyAsync();
    attestation = await integrity.attestKeyAsync(aaKeyId, binding);
  } catch {
    throw new PalcoWalletError('attest');   // includes simulators and Apple-server hiccups
  }

  // 5) Verify + consent (the router records the Ley-1581 consent with the enrollment).
  const out = await authedPost('/palco/enroll/verify', {
    challenge_id: challengeId,
    pubkey_jwk: jwk,
    platform: 'ios',
    attestation: { mode: 'app_attest', pop_sig: popSig, key_id: aaKeyId, attestation },
    consent: { accepted: true, policy_version: POLICY_VERSION },
  });
  const deviceKeyId = typeof out.device_key_id === 'string' ? out.device_key_id : '';
  const hwTier = typeof out.hw_tier === 'string' ? out.hw_tier : '';
  if (!deviceKeyId || !hwTier) throw new PalcoWalletError('server');

  const enrollment: Enrollment = {
    device_key_id: deviceKeyId,
    hw_tier: hwTier,
    enrolled_at: new Date().toISOString(),
  };
  try {
    await SecureStore.setItemAsync(storeKey(userId), JSON.stringify(enrollment));
  } catch {
    // Keychain write failed: the server-side binding exists; next visit re-derives it by
    // re-enrolling idempotently. Never fail the flow over the local cache.
  }
  return enrollment;
}
