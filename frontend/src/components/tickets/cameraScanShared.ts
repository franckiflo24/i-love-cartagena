// Shared door-scan logic for the live camera scanner, so the web (BarcodeDetector/jsQR)
// and native (expo-camera) twins render the SAME verdict labels, tones and timing — one
// source of truth for the on-scan flash. Pure data + a couple of pure helpers; no DOM,
// no react-native, so either platform file can import it.
import type { CameraScanOutcome } from './scannerApi';

/** Only a PALCO ticket / pass / civic wire is accepted; a stray QR in frame is ignored. */
export const WIRE_RE = /^AMO(TKT1|PASS1|CIV1)\./;
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

/** Minimal en/es picker (the scanner overlay predates full i18n; fr/pt fall back to es, local staff). */
export const T = (lang: string | undefined, es: string, en: string): string => (lang === 'en' ? en : es);

/** The ticket id inside a wire (AMOTKT1.<id>.<counter>.<token>), for per-guest dedupe. */
export function idOf(wire: string): string {
  const p = wire.split('.');
  return p.length >= 2 ? p[1] : wire;
}

export interface Banner {
  ok: boolean;
  color: string;
  label: string;
  detail: string;
  name: string | null;
}

/** Map a scan outcome to the overlay flash. A null outcome = unresolved (neutral "retry"). */
export function bannerFor(outcome: CameraScanOutcome | null, lang: string | undefined): Banner {
  if (!outcome) {
    return { ok: false, color: GRAY, label: T(lang, 'REINTENTA', 'RETRY'), detail: T(lang, 'No se pudo verificar.', 'Could not verify.'), name: null };
  }
  const name = outcome.name && outcome.name.trim() ? outcome.name.trim() : null;
  switch (outcome.verdict) {
    case 'VALIDO': return { ok: true, color: GREEN, label: T(lang, 'VÁLIDO', 'VALID'), detail: T(lang, 'Acceso registrado.', 'Admitted.'), name };
    case 'PASE': return { ok: true, color: GREEN, label: T(lang, 'PASE', 'PASS'), detail: T(lang, 'City Pass vigente.', 'City Pass active.'), name };
    case 'DUPLICADO': return { ok: false, color: AMBER, label: T(lang, 'DUPLICADO', 'DUPLICATE'), detail: T(lang, 'Esta entrada ya fue usada.', 'Already used.'), name };
    case 'FALSIFICADO': return { ok: false, color: RED, label: T(lang, 'FALSIFICADO', 'FORGED'), detail: T(lang, 'Código no auténtico.', 'Not authentic.'), name: null };
    case 'EXPIRADO': return { ok: false, color: GRAY, label: T(lang, 'EXPIRADO', 'EXPIRED'), detail: T(lang, 'Pídele que actualice el código.', 'Ask them to refresh the code.'), name };
    case 'FUERA_DE_ALCANCE': return { ok: false, color: AMBER, label: T(lang, 'FUERA DE ALCANCE', 'OUT OF SCOPE'), detail: T(lang, 'De otro alcance: no se admite aquí.', 'Another scope: not admitted here.'), name };
    case 'REVOCADO': return { ok: false, color: RED, label: T(lang, 'REVOCADO', 'REVOKED'), detail: T(lang, 'Revocada por el emisor.', 'Revoked by the issuer.'), name };
    case 'TRANSFERIDO': return { ok: false, color: GRAY, label: T(lang, 'TRANSFERIDO', 'TRANSFERRED'), detail: T(lang, 'La vigente es la del nuevo titular.', 'The new holder owns the valid one.'), name };
    case 'EVENTO_CANCELADO': return { ok: false, color: RED, label: T(lang, 'EVENTO CANCELADO', 'EVENT CANCELLED'), detail: T(lang, 'El evento fue cancelado.', 'The event was cancelled.'), name };
    case 'EVENTO_VENCIDO': return { ok: false, color: GRAY, label: T(lang, 'EVENTO TERMINADO', 'EVENT ENDED'), detail: T(lang, 'El evento ya terminó.', 'The event has ended.'), name };
    default: return { ok: false, color: GRAY, label: String(outcome.verdict), detail: '', name };
  }
}
