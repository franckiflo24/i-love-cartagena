// CALENDAR-INTEGRATION v1 — COP money formatting with an honest ~US$ hint.
//
// The approximation rate is a pinned constant with its as-of date, never a live
// feed: a stale "live" rate would lie silently, a dated "~" never does. The UI
// always shows COP as the real price and US$ only as "~", so nobody is quoted a
// dollar amount the venue will not honor. Update RATE + RATE_AS_OF together.

/** COP per 1 USD — representative market rate, pinned. */
export const COP_PER_USD = 3900;
/** The day COP_PER_USD was pinned (shown nowhere, kept for the next editor). */
export const COP_RATE_AS_OF = '2026-10-07';

const round = (n: number): string => n.toLocaleString('en-US');

/** "COP 180.000" style (dot thousands — the local convention). */
export function formatCop(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return '';
  return `COP ${Math.round(amount).toLocaleString('de-DE')}`;
}

/** "~US$ 46" — approximate by design, rounded to whole dollars (≥1). */
export function approxUsd(amountCop: number): string {
  if (!Number.isFinite(amountCop) || amountCop <= 0) return '';
  const usd = Math.max(1, Math.round(amountCop / COP_PER_USD));
  return `~US$ ${round(usd)}`;
}

/**
 * One price line from the feed's price shape:
 *   min only          → "COP 180.000 (~US$ 46)"
 *   min + max         → "COP 80.000 – 250.000 (~US$ 21–64)"
 *   nothing numeric   → '' (the caller keeps its GRATIS/Consultar wording)
 */
export function copLine(minCop: number | null | undefined, maxCop: number | null | undefined): string {
  const lo = typeof minCop === 'number' && minCop > 0 ? minCop : null;
  const hi = typeof maxCop === 'number' && maxCop > 0 ? maxCop : null;
  if (lo && hi && hi > lo) {
    const loUsd = Math.max(1, Math.round(lo / COP_PER_USD));
    const hiUsd = Math.max(1, Math.round(hi / COP_PER_USD));
    return `COP ${Math.round(lo).toLocaleString('de-DE')} – ${Math.round(hi).toLocaleString('de-DE')} (~US$ ${round(loUsd)}–${round(hiUsd)})`;
  }
  const one = lo || hi;
  if (one) return `${formatCop(one)} (${approxUsd(one)})`;
  return '';
}
