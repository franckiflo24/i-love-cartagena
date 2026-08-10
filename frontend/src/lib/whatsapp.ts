// The venue WhatsApp number is the partner's VALIDATED mobile — populated in the
// DB only when it's a real Colombian mobile (57 + 3XXXXXXXXX) the venue owns.
// Scraped landlines, toll-free service lines, country-code-only "57", .0 float
// artifacts, and numbers shared across many venues are NOT stored as whatsapp.
// So anything not a valid mobile here routes to the AMO concierge line instead of
// opening WhatsApp to a wrong/dead number.

export const AMO_CONCIERGE_WA =
  (process.env.EXPO_PUBLIC_AMO_WHATSAPP || '573176481183').replace(/\D/g, '');

/** Resolve the WhatsApp number to open for a venue. Never returns a bad number. */
export function venueWhatsApp(
  partner: { whatsapp?: string | null } | null | undefined,
): { number: string; isAmo: boolean } {
  const wa = String(partner?.whatsapp || '').replace(/\D/g, '');
  const isValidMobile = wa.length === 12 && wa.startsWith('573');
  return isValidMobile ? { number: wa, isAmo: false } : { number: AMO_CONCIERGE_WA, isAmo: true };
}
