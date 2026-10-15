// CMW-1: client helper for the pre-registration front door (app/cmw.tsx).
//
// Three jobs, nothing else:
//   1. Attribution: capture utm_* + ref from the entry URL and persist the FIRST
//      touch (AsyncStorage → localStorage on web) so it survives the login
//      round-trip (/cmw → /login?next=/cmw → /cmw). No PII is ever stored here —
//      only campaign tags.
//   2. The missing-fields diff: given the real /profile fields (name, email,
//      phone, instagram, nationality — dob/city do NOT exist on profiles), say
//      what the form still has to ask.
//   3. Submit: POST /cmw/prereg with the same mechanics as lib/cmw.ts
//      (fetchT + AMO client headers + Bearer when signed in). The consent flag is
//      sent ONLY when the visitor ticked the box; the server refuses to invent it.
//
// The consent/marketing texts here are DISPLAY copies of the backend canon
// (cmw_prereg.py). The server verifies the version id and stores its own
// canonical text — a drifted client gets `consent_version`, never silent consent.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { AMO_CLIENT_HEADERS, API_BASE, WRITE_TIMEOUT_MS, fetchT, getToken } from '../constants/api';

export const CONSENT_VERSION = 'cmw-prereg-v1';
export const CONSENT_TEXT_ES =
  'Autorizo a Amo Cartagena S.A.S. a tratar mis datos personales con la finalidad de ' +
  'gestionar mi preinscripción a Cartagena Music Week, conforme a la Ley 1581 de 2012 ' +
  'y la Política de Privacidad. Conozco mi derecho a consultar, actualizar, rectificar, ' +
  'suprimir y revocar esta autorización escribiendo a privacidad@amocartagena.co.';
export const MARKETING_TEXT_ES =
  'Quiero recibir noticias, preventas y avisos de Cartagena Music Week por WhatsApp y correo.';
/** The ONLY presale promise that exists: notification priority. Never an inventory guarantee. */
export const PRIORITY_LINE_ES =
  'Los preinscritos reciben el aviso de la preventa antes que el público general.';

// ── attribution ───────────────────────────────────────────────────────────────

export type PreregSource = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  ref: string | null;
  landing: 'web' | 'app';
};

const SRC_KEY = '@cmw_src_v1';
const SRC_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'ref'] as const;

// Control chars + zero-width/bidi/line separators, built via the constructor so the
// pattern stays pure ASCII in this file (a literal U+2028 inside a regex literal is
// a line break to the parser — that bug shipped once; never again).
const SRC_STRIP = new RegExp('[<>\\u0000-\\u001f\\u200b-\\u200f\\u2028\\u2029]', 'g');

const cleanTag = (v: unknown): string | null => {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== 'string') return null;
  const t = s.replace(SRC_STRIP, '').trim().slice(0, 80);
  return t || null;
};

const landing = (): 'web' | 'app' => (Platform.OS === 'web' ? 'web' : 'app');

const hasTags = (s: Partial<PreregSource> | null | undefined): boolean =>
  !!s && SRC_FIELDS.some((k) => typeof s[k] === 'string' && !!s[k]);

/** Capture the utm tags + ref from the entry params; FIRST touch wins across the login
 *  round-trip. Storage failing (private mode, IG webview quirks) never blocks —
 *  the fresh params still attribute this submit. */
export async function captureSource(params: Record<string, string | string[] | undefined>): Promise<PreregSource> {
  const fresh: PreregSource = {
    utm_source: cleanTag(params.utm_source), utm_medium: cleanTag(params.utm_medium),
    utm_campaign: cleanTag(params.utm_campaign), utm_content: cleanTag(params.utm_content),
    ref: cleanTag(params.ref), landing: landing(),
  };
  try {
    const raw = await AsyncStorage.getItem(SRC_KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<PreregSource>) : null;
    if (hasTags(stored)) {
      return {
        utm_source: cleanTag(stored?.utm_source), utm_medium: cleanTag(stored?.utm_medium),
        utm_campaign: cleanTag(stored?.utm_campaign), utm_content: cleanTag(stored?.utm_content),
        ref: cleanTag(stored?.ref), landing: landing(),
      };
    }
    if (hasTags(fresh)) await AsyncStorage.setItem(SRC_KEY, JSON.stringify(fresh));
  } catch {
    // storage unavailable — attribute from the live URL only
  }
  return fresh;
}

// ── the missing-fields diff ───────────────────────────────────────────────────

export type ProfileLike = {
  name?: string; email?: string; phone?: string; instagram?: string; nationality?: string;
};

export type PreregPrefill = {
  fullName: string; email: string; whatsapp: string; instagram: string; country: string;
  /** Which inputs the form must still show. dob and city are never on a profile. */
  ask: { fullName: boolean; email: boolean; whatsapp: boolean; instagram: boolean; city: boolean; country: boolean; dob: boolean };
};

export function prefillFrom(profile: ProfileLike | null): PreregPrefill {
  const p = profile || {};
  const fullName = (p.name || '').trim();
  const email = (p.email || '').trim();
  const whatsapp = (p.phone || '').trim();
  const instagram = (p.instagram || '').trim();
  const country = (p.nationality || '').trim();
  return {
    fullName, email, whatsapp, instagram, country,
    ask: {
      fullName: !fullName, email: !email, whatsapp: !whatsapp,
      instagram: !instagram, city: true, country: !country, dob: true,
    },
  };
}

// ── validation ────────────────────────────────────────────────────────────────

export type PreregFieldError = 'name' | 'email' | 'whatsapp' | 'dob' | 'under_18' | 'consent';

export const FIELD_ERROR_COPY: Record<PreregFieldError, string> = {
  name: 'Escribe tu nombre (2 a 80 caracteres).',
  email: 'Escribe un correo válido.',
  whatsapp: 'Escribe un número de WhatsApp con indicativo.',
  dob: 'Escribe tu fecha de nacimiento completa (DD/MM/AAAA).',
  under_18: 'La preinscripción es solo para mayores de 18 años.',
  consent: 'Marca la autorización de datos para continuar.',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const dobIso = (d: string, m: string, y: string): string | null => {
  const dd = parseInt(d, 10); const mm = parseInt(m, 10); const yy = parseInt(y, 10);
  if (!Number.isInteger(dd) || !Number.isInteger(mm) || !Number.isInteger(yy)) return null;
  if (yy < 1900 || yy > new Date().getFullYear() || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const dt = new Date(Date.UTC(yy, mm - 1, dd));
  if (dt.getUTCFullYear() !== yy || dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) return null;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
};

export const ageFromIso = (iso: string): number | null => {
  const [y, m, d] = iso.split('-').map((v) => parseInt(v, 10));
  if (!y || !m || !d) return null;
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age -= 1;
  return age;
};

export type PreregDraft = {
  fullName: string; email: string; whatsapp: string;
  dobD: string; dobM: string; dobY: string;
  consentChecked: boolean;
};

/** Client-side gate: the same rules the server enforces, so nobody waits on a
 *  round trip to learn their birthday blocks them. The server stays authoritative. */
export function validatePrereg(f: PreregDraft): PreregFieldError[] {
  const errs: PreregFieldError[] = [];
  if (f.fullName.trim().length < 2) errs.push('name');
  if (!EMAIL_RE.test(f.email.trim()) || f.email.trim().length > 254) errs.push('email');
  const digits = f.whatsapp.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15 || /[^\d+\s().-]/.test(f.whatsapp.trim())) errs.push('whatsapp');
  const iso = dobIso(f.dobD, f.dobM, f.dobY);
  if (!iso) errs.push('dob');
  else {
    const age = ageFromIso(iso);
    if (age === null) errs.push('dob');
    else if (age < 18) errs.push('under_18');
  }
  if (!f.consentChecked) errs.push('consent');
  return errs;
}

// ── submit ────────────────────────────────────────────────────────────────────

export type PreregBody = {
  full_name: string; email: string; whatsapp: string;
  instagram?: string; city?: string; country?: string;
  dob: string; lang: string;
  consent: { accepted: true; version: string };
  marketing_opt_in: boolean;
  source: PreregSource;
  website: string; // honeypot — always ''
};

export type PreregResult =
  | { ok: true; preregId: string; updated: boolean }
  | { ok: false; kind: 'fields' | 'rate' | 'unavailable' | 'network'; code: string | null; status: number | null };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export async function submitPrereg(body: PreregBody): Promise<PreregResult> {
  let res: Response;
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...AMO_CLIENT_HEADERS,
    };
    // Signed-in visitors: the row ties to the account, so delete-account purges it.
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    res = await fetchT(`${API_BASE}/cmw/prereg`, { method: 'POST', headers, body: JSON.stringify(body) }, WRITE_TIMEOUT_MS);
  } catch (err) {
    console.error('[cmw-prereg] submit failed', err instanceof Error ? err.name : 'error');
    return { ok: false, kind: 'network', code: null, status: null };
  }
  let payload: unknown = null;
  try { payload = await res.json(); } catch { payload = null; }
  const env = isRecord(payload) ? payload : {};
  if (res.ok) {
    const data = isRecord(env.data) ? env.data : {};
    const preregId = typeof data.prereg_id === 'string' ? data.prereg_id : '';
    if (preregId) return { ok: true, preregId, updated: data.updated === true };
    return { ok: false, kind: 'unavailable', code: null, status: res.status };
  }
  const code = typeof env.error === 'string' ? env.error : null;
  if (res.status === 429) return { ok: false, kind: 'rate', code, status: 429 };
  if (res.status === 400 || res.status === 422) return { ok: false, kind: 'fields', code, status: res.status };
  return { ok: false, kind: 'unavailable', code, status: res.status };
}

/** Bilingual failure line (Spanish source; the screen renders tr() + the EN twin). */
export function failureCopy(r: Extract<PreregResult, { ok: false }>): string {
  if (r.kind === 'rate') return 'Demasiadas solicitudes. Intenta de nuevo en una hora.';
  if (r.kind === 'network') return 'Sin conexión. Revisa tu red e intenta de nuevo.';
  if (r.kind === 'fields') {
    switch (r.code) {
      case 'under_18': return FIELD_ERROR_COPY.under_18;
      case 'invalid_email': return FIELD_ERROR_COPY.email;
      case 'invalid_whatsapp': return FIELD_ERROR_COPY.whatsapp;
      case 'invalid_name': return FIELD_ERROR_COPY.name;
      case 'invalid_dob': return FIELD_ERROR_COPY.dob;
      case 'consent_required': return FIELD_ERROR_COPY.consent;
      case 'consent_version': return 'El texto de autorización cambió. Recarga la página e inténtalo de nuevo.';
      default: return 'Revisa los datos e intenta de nuevo.';
    }
  }
  return 'El servicio no está disponible en este momento. Intenta de nuevo.';
}
