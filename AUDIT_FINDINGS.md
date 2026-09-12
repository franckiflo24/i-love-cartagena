# AMO Cartagena — Elite Audit Findings (2026-09-12)

Six parallel audits (frontend flow, backend/API, admin/partner, security, i18n, look/feel).
✅ = fixed this session · ⬜ = pending · 🧭 = needs a product decision.

---

## ✅ FIXED THIS SESSION (frontend — deployed to web + rides next app build)

- **review/new.tsx** — hoisted `useState` above the `if (!user)` guard → kills the React #310 crash on the login-return path. **(P0 crash)**
- **port-tax/checkout.tsx** — wrapped in `KeyboardAvoidingView` + `keyboardShouldPersistTaps` so the pay button clears the keyboard; replaced the permanent spinner with a real loading + error/retry state; fixed white-on-teal → black-on-teal button contrast. **(P0 App-Store class + P1)**
- **business/admin/queue.tsx** — `load()` now gates on `canModerate` not `token`, so the moderation queue actually loads for an is_admin (Google) login; added confirmations to "Approve ownership" and "delete published photo". **(P0 dead function + P1)**
- **business/profile-edit.tsx, event-form.tsx, stats.tsx** — added the `!token → /business/login` redirect guard. **(P1)**
- **complete-profile.tsx** — `KeyboardAvoidingView` (earlier); wrapped "Rango de edad" / "Instagram (opcional)" / "Guardando…/Continuar" in `tr()`; fixed button contrast. **(P0 i18n + P1)**
- **onboarding.tsx** — added the missing "¿Tienes un negocio…?" / "Regístralo" dictionary keys (were falling back to Spanish). **(P0 i18n)**
- **concierge.tsx** — wrapped the two hardcoded Spanish picker paragraphs in `tr()` + added translations. **(P0 i18n, reviewer path)**
- **search.tsx / login.tsx / perfil.tsx / (tabs)/index.tsx** — "Sin resultados", "(opcional)", "Email verificado", "Editar" now localize (keys added / strings wrapped). **(P1 i18n)**
- **autoTr.ts** — +16 dictionary entries across es/en/fr/pt.

---

## ⬜ PENDING — i18n (P0/P1, next focused pass)

- ⬜ **Systemic date bug** — build one `formatShortDate/Range(iso, lang)` helper and replace the hardcoded Spanish day/month arrays in: (tabs)/index, reservations/index, concerts, event/[id], explore, business/reservations. **(P0 — highest remaining leverage)**
- ⬜ **(tabs)/index.tsx** — Home hero "lugares para descubrir", category grid labels, and event/price badges (CAT_COLORS / budget labels) still render raw Spanish. **(P0)**
- ⬜ **reservations/index.tsx:50-58** — 4 STATUS_META strings tr()'d but missing from the dictionary. **(P0)**
- ⬜ **event/[id], explore, concerts** — category labels + "Hoy — Activo ahora" unwrapped. **(P0/P1)**
- ⬜ complete-profile COUNTRIES chips; concierge "al instante"; agenda category labels. **(P2)**

## ⬜ PENDING — frontend flow (P1/P2)

- 🧭 **reservation/new.tsx:180** — booking form only opens WhatsApp, never POSTs a reservation, yet promises in-app tracking. **DECISION NEEDED: persist via `api.post('/reservations')` or drop the in-app-tracking promise.**
- ⬜ **port-tax/ticket/[id].tsx:73** — permanent spinner on a 404/deleted ticket → add a not-found + back state.
- ⬜ **experience/[id].tsx:61** — no error state (network fail looks like "not found") + hardcoded English strings.
- ⬜ **viaje/shared/[code].tsx:70** — join walls logged-in users on transient error + dead-ends on 200-without-trip_id.
- ⬜ **business/claim/[id].tsx** — multiline textarea + submit, needs `KeyboardAvoidingView`.
- ⬜ **citypass.tsx / port-tax/tickets / agenda / transport / partners / pasaporte** — fetch failure rendered as empty/spinner instead of error+retry.
- ⬜ **rewards/offers.tsx:74** — fabricates a fake redemption code (no-fake-data violation); **rewards/card.tsx** shows a guest fake QR.
- ⬜ **payments/return.tsx:161** — "Reintentar" `router.back()` is a no-op after redirect.
- ⬜ **perfil.tsx:433 / partner-event/[id].tsx:89** — dead stat taps / unwired `handleReserve`.
- ⬜ **pasaporte / viaje/[id]** — `KeyboardAvoidingView` + `keyboardShouldPersistTaps`; destructive actions need confirmation; group actions need `catch`.

## ⬜ PENDING — backend hardening (no P0s; separate `cd backend && vercel --prod`)

- ⬜ **api.ts STATIC_MODE** — if `EXPO_PUBLIC_BACKEND_URL` is unset at web build time, writes silently no-op and fake success. Add a prod build assert. (Prod currently has the var.)
- ⬜ **server.py (44 sites)** — raw `await request.json()` → 500 on malformed body; swap in the existing `_json_body()` helper (start with business_login, business_signup).
- ⬜ **reservations.py / reviews.py** — add rate limiting; make "helpful" votes unique-per-user.
- ⬜ **server.py** — `_bounded_int()` for qty/passengers; fail-fast when `CORS_ALLOWED_ORIGINS` unset in prod.
- ⬜ Remove unused `stripe` dep + dead Emergent LLM branch; add a loud missing-`ANTHROPIC_API_KEY` health check; delete `.env.blob`/`.env.prod`.
- ⬜ **admin operator token** — move off localStorage (httpOnly cookie) or add token-version revocation + shorter TTL.

## ⬜ PENDING — accessibility / polish (P3)

- ⬜ `accessibilityLabel` on icon-only buttons app-wide; sub-11px text on pasaporte; 44pt touch targets; honor `prefers-reduced-motion` beyond AssistantFab.
- ⬜ Local color constants → theme tokens (intel, itineraries, onboarding palette names).

---

## Verified CLEAN (do not re-audit)
No auth-bypass leaking backend data; all 48 admin/gov routes guarded; session tokens DB-backed + revoked on logout/deletion (stale-token bug does NOT reproduce here); Wompi amounts server-side + HMAC webhooks; strict CORS; DB-backed atomic rate limiting; every frontend path maps to a live backend route; login.tsx + device-locale detection sound.
