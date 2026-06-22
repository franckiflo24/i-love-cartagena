/**
 * AMO Integration Contract — Date utilities.
 *
 * Every date comparison and display in the app flows through here.
 * All functions are safe: bad/missing input never throws.
 */

/**
 * Returns true when `iso` is a valid ISO date string in the future
 * (or today).  Returns false on invalid / empty / past dates.
 */
export function isUpcoming(iso: string, now?: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const ref = now ?? new Date();
  // Compare date-only (strip time) so "today" counts as upcoming
  const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const rDay = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  return dDay >= rDay;
}

/**
 * Formats a single ISO date string for display.
 * Returns a safe fallback on bad input.
 */
export function formatDate(iso: string, lang: 'es' | 'en'): string {
  if (!iso) return lang === 'es' ? 'Fecha por confirmar' : 'Date TBC';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return lang === 'es' ? 'Fecha por confirmar' : 'Date TBC';
  }
  try {
    return d.toLocaleDateString(lang === 'es' ? 'es-CO' : 'en-US', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return lang === 'es' ? 'Fecha por confirmar' : 'Date TBC';
  }
}

/**
 * Formats a date range.  If `end` is missing or same as `start`,
 * returns a single formatted date.
 */
export function formatDateRange(
  start: string,
  end?: string,
  lang: 'es' | 'en' = 'es',
): string {
  const s = formatDate(start, lang);
  if (!end || end === start) return s;

  const fallback = lang === 'es' ? 'Fecha por confirmar' : 'Date TBC';
  if (s === fallback) return s;

  const e = formatDate(end, lang);
  if (e === fallback) return s;

  return `${s} – ${e}`;
}
