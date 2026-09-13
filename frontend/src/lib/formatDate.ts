// Localized short-date formatting — the single source of truth for day/month
// abbreviations across the app. Before this, ~6 screens each reimplemented their
// own hardcoded Spanish arrays, so nearly every date rendered in Spanish for
// EN/FR/PT users (an App Review language-consistency risk). Route every date
// chip/label through here instead.
import type { Lang } from '../i18n/translations';

// 0-indexed (Jan = 0), Title-case. Use .toUpperCase() at the call site if a
// screen wants uppercase chips.
const MONTHS: Record<Lang, string[]> = {
  es: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  pt: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
};

// 0-indexed (Sunday = 0), Title-case.
const DAYS: Record<Lang, string[]> = {
  es: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  fr: ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'],
  pt: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'],
};

function months(lang: Lang): string[] { return MONTHS[lang] || MONTHS.es; }
function days(lang: Lang): string[] { return DAYS[lang] || DAYS.es; }

// Parse an ISO / YYYY-MM-DD string as a LOCAL date without a timezone shift.
// `new Date('2026-09-12')` is parsed as UTC midnight → can render the previous
// day in western timezones; splitting the date part avoids that.
function parseLocal(iso: string): Date | null {
  if (!iso) return null;
  const datePart = String(iso).slice(0, 10);
  const m = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/** Month abbreviation for a 0-indexed month. `upper` → ALL CAPS for chips. */
export function monthShort(monthIndex0: number, lang: Lang, upper = false): string {
  const v = months(lang)[((monthIndex0 % 12) + 12) % 12] || '';
  return upper ? v.toUpperCase() : v;
}

/** Month abbreviation from a 1-indexed month (matches the old `['','ENE',…]` arrays). */
export function monthShort1(monthIndex1: number, lang: Lang, upper = false): string {
  return monthShort(monthIndex1 - 1, lang, upper);
}

/** Weekday abbreviation for a 0-indexed day-of-week (Sunday = 0). */
export function weekdayShort(dowIndex0: number, lang: Lang, upper = false): string {
  const v = days(lang)[((dowIndex0 % 7) + 7) % 7] || '';
  return upper ? v.toUpperCase() : v;
}

/** e.g. es → "Vie 12 Sep", en → "Fri 12 Sep". Empty string on invalid input. */
export function formatShortDate(iso: string, lang: Lang, opts?: { weekday?: boolean; upper?: boolean }): string {
  const d = parseLocal(iso);
  if (!d) return '';
  const day = d.getDate();
  const mon = monthShort(d.getMonth(), lang, opts?.upper);
  if (opts?.weekday === false) return `${day} ${mon}`;
  const dow = (days(lang)[d.getDay()] || '');
  return `${opts?.upper ? dow.toUpperCase() : dow} ${day} ${mon}`;
}

/** Compact range, e.g. "12–15 Sep" or "28 Sep – 2 Oct". */
export function formatDateRange(startIso: string, endIso: string, lang: Lang, upper = false): string {
  const a = parseLocal(startIso);
  const b = parseLocal(endIso);
  if (!a) return '';
  if (!b || a.getTime() === b.getTime()) return formatShortDate(startIso, lang, { weekday: false, upper });
  const am = monthShort(a.getMonth(), lang, upper);
  const bm = monthShort(b.getMonth(), lang, upper);
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${am}`;
  return `${a.getDate()} ${am} – ${b.getDate()} ${bm}`;
}
