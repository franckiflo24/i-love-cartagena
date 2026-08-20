# AMO CARTAGENA — LAUNCH AUDIT LEDGER
_Elite 9-domain audit, 2026-08-20. Findings accumulate here; each fixed item gets a ✅ + commit._

## STATUS: 2 / 9 domains reported

---

## 🔴 CRITICAL / 🟠 HIGH — fix before launch (fix wave pending)

### FRONTEND (one-line, no backend deploy)
- [ ] 🔴 **Search shows past events to guests** — `app/search.tsx:549-554`: backend event buckets bypass `filterLiveEvents` (only static fallback filters). Wrap `events`/`partner_events` in `filterLiveEvents`. _(domain: E2E #1)_
- [ ] 🔴 **Luna wipes her own recommendation cards** — `src/components/AssistantFab.tsx:506-516`: on taste 200 with 0 recs, provisional catalog cards cleared. Fall back to preview: `recommendations: enriched.length ? enriched : gLocalRecs`. **HOLD for Luna auditor's fix.** _(domain: E2E #2)_
- [ ] 🟠 **Business event-form blank/duplicate** — `app/business/stats.tsx:224` sends `?id=` but `event-form.tsx:33-35` reads `params.eventId`. → `?eventId=`. _(domain: E2E #3)_
- [ ] 🟠 **City Pass guest-crash when Wompi enabled (latent)** — `app/(tabs)/citypass.tsx:60-90`: no login gate; mirror port-tax `if(!user) router.push('/login?next=/(tabs)/citypass')`. _(domain: E2E #5)_
- [ ] 🟡 Luna persona: backend fallback copy says "Amo", app brands "Luna" — align. _(E2E #2)_

### BACKEND ENV (env-only, safe via `vercel env rm` + `redeploy <current-url>`, no WIP shipped)
- [ ] 🟠 **`MOCK_PAY="1"` in prod backend env** — neutralized only by VERCEL_ENV guard; re-arms off-Vercel. Remove. _(domain: Toggle #1)_

---

## 🟡 MEDIUM / cleanup (batch)
- [ ] Dead-code w/ loaded gun: `src/components/PaymentSheet.tsx` + `src/lib/payments/*` (MockProvider fake-approves) — delete. _(Toggle #4)_
- [ ] Orphaned `/concierge` screen: URL-reachable, `.content` vs `.message` bug (logged-in always gets offline fallback). Delete or fix `src/services/concierge.ts:53`. _(Toggle #5)_
- [ ] Env debris: `DEMO_SIGNUP_CODE`, `EXPO_PUBLIC_SIGNUP_CODE`, stale `EXPO_PUBLIC_APP_URL`, empty frontend `ANTHROPIC_API_KEY`. _(Toggle #6)_
- [ ] `/api/partners` firehose: `?limit` ignored server-side, refetched per category tap — cache client-side per session; server projection = backend package. _(E2E #4, Toggle)_
- [ ] Search venue result cards have no `onPress` (dead tappable card) — `search.tsx:1054`. _(E2E #6)_
- [ ] Dead `handleReserve` in `partner-event/[id].tsx:87`. _(E2E #6)_
- [ ] `business/stats.tsx` missing guest guard (Bearer-null 401 → empty). _(E2E #12)_
- [ ] Consumer login hero image loads from a different Vercel project — self-host. _(E2E #6)_
- [ ] Perf: explore re-downloads full `/api/partners` per chip tap — fetch-once + cache. _(E2E #2)_
- [ ] Locals-only chip can filter to empty grid when `/local-picks` fails — hide chip when picks empty. _(Toggle #7)_

---

## ✅ CONFIRMED HEALTHY (no action)
- **No toggle is dangerously ON**: demo-login 404s, seed-wipe doubly inert, fake-pay guard-disabled, payments honestly dead-end on all 3 entry points, every secret gate fails closed. _(Toggle)_
- Undeployed backend WIP has **zero toggle-relevant changes** — prod == repo behavior. _(Toggle)_
- Guest journeys SOLID: onboarding/skip, discovery (club/spa mis-wire GONE), reserve (no dead numbers), favorites, viaje, tab-bar guest states, language propagation (zero mount-frozen strings), admin portal dual-principal, payments honest dead-end. _(E2E)_
- Port-tax return-URL correct (frontend origin), payments-check-before-login-gate. _(E2E)_

---

## ⏳ ENABLE-DAY / POST-LAUNCH (not today)
- Wompi enable-day: set `WOMPI_ENV=production` + prod-prefixed keys atomically, verify `/payments/config` env:"production". _(Toggle #2)_
- Rotate demo secrets (`DEMO_PARTNER_PASSWORD`, `ALCALDIA_DEMO_PASSCODE`) after investor demos. _(Toggle #3)_
- Backend package (SYSTEM_MAP §7): ship WIP, single-principal admin auth, /docs off, /partners projection, operator list >500, single-source event date-filtering, regen static data.

---

## DOMAINS PENDING: Crash/bug · Profile/permission · Backend-contract · Security · i18n · Site-completion/blind-spot · Luna/design
