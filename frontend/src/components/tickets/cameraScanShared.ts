// Shared door-scan logic for the live camera scanner, so the web (BarcodeDetector/jsQR)
// and native (expo-camera) twins render the SAME verdict labels, tones and timing — one
// source of truth for the on-scan flash. Pure data + a couple of pure helpers; no DOM,
// no react-native, so either platform file can import it.
import type { CameraScanOutcome } from './scannerApi';
import { formatEventDate, formatGateTime } from './scannerApi';

/**
 * Only wires this endpoint can verify are accepted; stray QRs are ignored. AMOCIV1 is
 * deliberately NOT matched — /business/tickets/scan cannot verify civic wires, so a genuine
 * civic credential rendered as a red FALSIFICADO here. AMO2 (v2) waits for a consuming route.
 */
export const WIRE_RE = /^AMO(TKT1|PASS1)\./;
/** One ticket id is accepted once per this window — a phone left in frame does not re-count. */
export const DEDUPE_MS = 8000;
/** How long the green flash + name stays before auto-advancing to the next guest. */
export const HOLD_OK_MS = 1500;
/** A refusal lingers longer so the operator can read it. */
export const HOLD_BAD_MS = 2300;

export const GREEN = '#12b5a5';
export const AMBER = '#F5A623';
export const RED = '#F87171';
export const GRAY = '#9AA3B2';
/** City Pass tone: positive but never the admit green — a pass is not an entry ticket. */
export const VIOLET = '#8B6CFF';

/** Minimal en/es picker (the scanner overlay predates full i18n; fr/pt fall back to es, local staff). */
export const T = (lang: string | undefined, es: string, en: string): string => (lang === 'en' ? en : es);

/** The ticket id inside a wire (AMOTKT1.<id>.<counter>.<token>), for per-guest dedupe. */
export function idOf(wire: string): string {
  const p = wire.split('.');
  return p.length >= 2 ? p[1] : wire;
}

export interface Banner {
  /** Chime/haptic polarity. PASE is ok:true but does NOT admit. */
  ok: boolean;
  /** Increments the "N validadas" tally — only a VALIDO admit does. */
  admits: boolean;
  color: string;
  label: string;
  detail: string;
  name: string | null;
  /** Context under the name ("title · dd/mm") so the flash says no less than the page card. */
  sub: string | null;
}

/**
 * Which outcomes KEEP the ticket id locked in the dedupe map. Admit-ish verdicts stay locked
 * (a phone left in frame must not re-fire); refusals unlock, because their banner asks for a
 * retry (EXPIRADO → the refreshed code carries the SAME id and must go straight through).
 */
export function locksId(o: CameraScanOutcome | null): boolean {
  return o !== null && (o.verdict === 'VALIDO' || o.verdict === 'PASE' || o.verdict === 'DUPLICADO');
}

/** In-flight flash shown the instant a decode is submitted (the POST can take seconds). */
export function verifyingBanner(lang: string | undefined): Banner {
  return { ok: false, admits: false, color: GRAY, label: T(lang, 'VERIFICANDO…', 'VERIFYING…'), detail: '', name: null, sub: null };
}

function subFor(o: CameraScanOutcome): string | null {
  const bits: string[] = [];
  if (o.title) bits.push(o.title);
  if (o.eventDate) bits.push(formatEventDate(o.eventDate, false));
  return bits.length > 0 ? bits.join(' · ') : null;
}

/** Map a scan outcome to the overlay flash. Unresolved outcomes are explicit, never a guess. */
export function bannerFor(outcome: CameraScanOutcome | null, lang: string | undefined): Banner {
  if (!outcome || outcome.verdict === null) {
    const u = outcome ? outcome.unresolved : undefined;
    if (u === 'unknown') {
      // The POST may have landed server-side — NOT a plain retry.
      return {
        ok: false, admits: false, color: AMBER, label: T(lang, 'SIN RESPUESTA', 'NO ANSWER'),
        detail: T(lang, 'Revisa la lista antes de reintentar: pudo quedar registrada.', 'Check the guest list before retrying: it may already be admitted.'),
        name: null, sub: null,
      };
    }
    if (u === 'session') {
      return {
        ok: false, admits: false, color: GRAY, label: T(lang, 'SESIÓN PERDIDA', 'SESSION LOST'),
        detail: T(lang, 'Vuelve a iniciar sesión.', 'Sign in again.'), name: null, sub: null,
      };
    }
    return {
      ok: false, admits: false, color: GRAY, label: T(lang, 'REINTENTA', 'RETRY'),
      detail: T(lang, 'No se pudo verificar.', 'Could not verify.'), name: null, sub: null,
    };
  }
  const name = outcome.name && outcome.name.trim() ? outcome.name.trim() : null;
  const sub = subFor(outcome);
  switch (outcome.verdict) {
    case 'VALIDO': return { ok: true, admits: true, color: GREEN, label: T(lang, 'VÁLIDO', 'VALID'), detail: T(lang, 'Acceso registrado.', 'Admitted.'), name, sub };
    case 'PASE': return { ok: true, admits: false, color: VIOLET, label: T(lang, 'PASE', 'PASS'), detail: T(lang, 'City Pass vigente. NO es entrada.', 'Valid City Pass. NOT a ticket.'), name, sub };
    case 'DUPLICADO': {
      const first = outcome.firstUsedAt ? ` · ${formatGateTime(outcome.firstUsedAt)}${outcome.firstGate ? ` · ${outcome.firstGate}` : ''}` : '';
      return { ok: false, admits: false, color: AMBER, label: T(lang, 'DUPLICADO', 'DUPLICATE'), detail: `${T(lang, 'Ya fue usada', 'Already used')}${first}`, name, sub };
    }
    case 'FALSIFICADO': return { ok: false, admits: false, color: RED, label: T(lang, 'FALSIFICADO', 'FORGED'), detail: T(lang, 'Código no auténtico.', 'Not authentic.'), name: null, sub: null };
    case 'EXPIRADO': return {
      ok: false, admits: false, color: GRAY, label: T(lang, 'EXPIRADO', 'EXPIRED'),
      // A pass means the City Pass itself lapsed; otherwise it is a stale rotating code.
      detail: outcome.isPass ? T(lang, 'El City Pass ya no está vigente.', 'This City Pass is no longer active.') : T(lang, 'Pídele que actualice el código.', 'Ask them to refresh the code.'),
      name, sub,
    };
    case 'FUERA_DE_ALCANCE': return { ok: false, admits: false, color: AMBER, label: T(lang, 'FUERA DE ALCANCE', 'OUT OF SCOPE'), detail: T(lang, 'No corresponde a esta puerta o a este evento.', 'Not for this door or this event.'), name, sub };
    case 'REVOCADO': return { ok: false, admits: false, color: RED, label: T(lang, 'REVOCADO', 'REVOKED'), detail: T(lang, 'Revocada por el emisor.', 'Revoked by the issuer.'), name, sub };
    case 'TRANSFERIDO': return { ok: false, admits: false, color: GRAY, label: T(lang, 'TRANSFERIDO', 'TRANSFERRED'), detail: T(lang, 'La vigente es la del nuevo titular.', 'The new holder owns the valid one.'), name, sub };
    case 'EVENTO_CANCELADO': return { ok: false, admits: false, color: RED, label: T(lang, 'EVENTO CANCELADO', 'EVENT CANCELLED'), detail: T(lang, 'El evento fue cancelado.', 'The event was cancelled.'), name, sub };
    case 'EVENTO_VENCIDO': return { ok: false, admits: false, color: GRAY, label: T(lang, 'EVENTO TERMINADO', 'EVENT ENDED'), detail: T(lang, 'El evento ya terminó.', 'The event has ended.'), name, sub };
    default: return { ok: false, admits: false, color: GRAY, label: String(outcome.verdict), detail: '', name, sub };
  }
}
