// Partner-supplied links (payment / booking / website) are opened for customers
// via Linking.openURL — on web that ends in window.open, which happily runs
// `javascript:` / `data:` URLs. Only http(s) is ever opened from partner data.
// (The backend now rejects other schemes on write; this also covers rows that
// predate that validation.)
export function isHttpUrl(u: string | null | undefined): u is string {
  return typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u.trim());
}
