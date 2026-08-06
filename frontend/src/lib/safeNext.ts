// Drop GATE — the ONE canonical same-app return-url guard.
//
// A `next`/return path must be an INTERNAL app route, never an external
// destination. A bare startsWith('/') is NOT enough: '//evil.com' (protocol-
// relative) and '/\evil.com' (backslash — the WHATWG URL parser treats '\' like
// '/') both start with '/' yet open-redirect off-site. This is the SINGLE source
// of truth shared by login, onboarding, and the signup gate so the three checks
// can never drift again (GATE adversarial 2B: three hand-copied guards had
// already diverged — the gate's was weaker and missed the backslash trick).
//
// Rule: exactly ONE leading slash, the next char is neither '/' nor '\', then
// only safe path characters for the WHOLE string ($-anchored — no suffix or
// truncation trick). Returns the path if safe, else null.
export function safeNext(n: unknown): string | null {
  return typeof n === 'string' && /^\/(?![/\\])[A-Za-z0-9/_\-?=&.%]*$/.test(n) ? n : null;
}
