# AMO CARTAGENA — LAUNCH AUDIT LEDGER
_Elite 9-domain audit + fix, 2026-08-20. All 9 domains reported. Blockers cleared._

## SCORECARD (GO / NO-GO per domain)
| Domain | Verdict | Notes |
|---|---|---|
| Crash / bug / repair | ✅ **GO** | 1 critical + 6 high fixed & deployed |
| Functionality / flows | ✅ **GO** | guest journeys solid; 2 critical fixed |
| Toggle / feature-flag | ✅ **GO** | no dangerous toggle ON; MOCK_PAY removed |
| Profile / permission | ✅ **GO** | boundaries enforced server-side; alcaldía-demo has no partner_id (no risk) |
| Backend API contract | ✅ **GO** | all 175 frontend routes healthy, 0 5xx |
| Security / exposure | ✅ **GO** | PII leak + /docs fixed; rest confirmed secure |
| i18n | 🟡 **wave 2 shipping** | guest-critical fixes in flight; business/admin deferred |
| Site-completion | ✅ **GO (web)** | routes live, images 1022/1022; App Store = separate track |
| Luna + design | ✅ **GO** | persona + card-wipe + map fixed; contrast polish deferred |

---

## ✅ FIXED & DEPLOYED

### Frontend wave 1 (commit 63bf288b, sw 3.2.0-1787251638752)
- 🔴 **Tierrabomba full-app crash** — `.toLocaleString()` on a missing field, one tap blanked the whole app. Guarded.
- 🔴 **Map tab froze forever** on any null partner/venue name. Guarded + real catches.
- 🟠 **6 render-crashers** (rewards min_tier, concerts genre, port-tax ticket_id, home season tags, business dashboard, +) — all guarded.
- 🔴 **Search served months-old dead events to guests** — backend buckets now filtered live.
- 🔴 **Luna erased her own venue cards** on empty taste response — now falls back to local preview.
- 🟠 Business event-form blank/duplicate (`?id=`→`?eventId=`); citypass guest gate; admin analytics retry-state.
- **Map design**: dark popups (were bright-white), markers via colorForKey (killed club=teal violation), navy hexes.
- **Completion**: removed stale `/eventos-demo` + `/eventos-app`; added robots.txt.
- LOW: event share $NaN, bookings dead-tap, Linking.openURL catches, redemption cache guard.

### Backend wave (commit 39826d10, live-verified)
- 🔴 **`/api/partners` PII leak KILLED** — email + NIT (7 listings) + raw analytics (893) stripped; rank_score/tier/membership kept (frontend needs). Verified: 0 leaks.
- 🟠 **`/docs`+`/redoc`+`/openapi.json` → 404** (were public).
- 🔴 **Luna persona** renamed "Amo"→"Luna" (prompt + fallback, 4 langs).
- Removed `MOCK_PAY` env. Shipped reviewed WIP (Eagle telemetry + reviews `is None` bugfix).

### Data
- ✅ Test-account purge: 169→59 real users. alcaldía-demo `partner_id: None` (no venue-edit risk).

---

## 🟡 IN FLIGHT — i18n wave 2 (guest-critical only)
Fixer running: **SignupGateContext** (universal gate, had ZERO i18n), **wompi/payments** result + "Próximamente", **login** auth errors, **partner tags** (+ english_friendly leak), **bookings** cancel dialog. → frontend deploy 2.

---

## ⏳ DEFERRED — documented, NOT launch-blocking (your call / fast-follow)

### Needs your decision
1. **Load test + Motor `maxPoolSize`** — blind-spot critic's #1 unknown: uncapped Motor pool × serverless fan-out vs Atlas tier cap could exhaust connections under first real concurrency (and the Mongo-backed rate limiter amplifies it into auth 503s). One-line defusable (`maxPoolSize=5`, server.py:28) but I won't guess the value — worth a 60s `hey -c 200` burst while watching the Atlas graph.
2. **Observability** — no Sentry / uptime monitor / product analytics. On launch you'd learn of an outage from a WhatsApp complaint. Add before announcing.
3. **Thin launch-week content** — 1 event today, 0 promotions, 0 reviews (post-purge). The "what to do today" promise is nearly empty. Content-seeding is yours.
4. **App Store track (separate from web)** — `eas.json`/`app.json` have placeholder IDs (can't build), and "Sign in with Apple" calls the Google handler (Guideline 4.8 rejection). Needs a dedicated pass.

### Hardening (post-launch)
- Broad business/admin i18n (partner onboarding funnel, moderation tools — ~150 strings).
- WCAG: white-on-teal primary button = 2.57:1 (fails AA) — darken button text app-wide.
- Backend: per-user operator accounts (retire shared master password), image-upload magic-byte validation, reviews `user_id` projection, separate batch-update secret.
- Atlas allowlist scope-down + credential rotation.
- Skeleton loaders on the 7 tabs still using bare spinners; shared `<ScreenHeader>`.
- sitemap.xml + 404.html; self-host 9 external CDN images + jsDelivr icon fonts.
- Regen static events.json (51 past) — masked by client filters today; cosmetic.
- Correct SYSTEM_MAP: 895 DB = 893 public + 2 non-public docs; no static regen needed.

---

## ✅ CONFIRMED SECURE / HEALTHY (tested, no action)
Partner-ownership scoping enforced server-side · is_admin has no write path · operator/admin/business auth fully separate · CORS real allowlist · Wompi + WhatsApp webhooks signature-verified (fail closed) · cookies httponly+secure · logout revokes server-side · rate limiting comprehensive & fail-closed · no secrets in bundle · payment amounts server-computed · no NoSQL injection (re.escape) · all 175 frontend routes 200/clean-401, 0 5xx, p50<1.5s · images 1022/1022.
