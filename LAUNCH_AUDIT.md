# AMO CARTAGENA — LAUNCH AUDIT
**Date:** 2026-07-02  
**Audited by:** Claude Opus 4.6 (automated Playwright + grep + curl)  
**Site:** https://www.amocartagena.co  
**Backend:** https://backend-mu-one-74.vercel.app  

---

## TIER 1 — LAUNCH BLOCKERS
*Broken on a path a normal tourist hits*

### 1.1 Concerts page stuck on splash screen
- **Where:** `/concerts` (accessible from Home quick-access, Explore, Agenda)
- **Evidence:** Playwright screenshot shows only AMO logo splash, never renders content. Unsplash hero image returns 404 (`photo-1571266028243-e4733b0f0bb0`). Page timeout after 10s.
- **Root cause:** Broken hero image URL blocks render; 12 concerts exist in backend (`GET /api/concerts` → 200, 12 items)
- **Action:** Fix broken Unsplash URL; verify page renders after image fix
- **Effort:** S

### 1.2 Rewards page stuck on splash screen (unauthenticated)
- **Where:** `/rewards` (accessible from Home quick-access, Profile)
- **Evidence:** Playwright shows AMO splash forever. `GET /api/rewards/me` → 401. No login prompt or empty state shown.
- **Root cause:** Page doesn't handle unauthenticated state — shows loading spinner indefinitely instead of prompting login or showing guest state
- **Action:** Add login gate or guest empty state (same pattern as `/bookings` which handles this correctly)
- **Effort:** S

### 1.3 Event detail pages dead for unknown slugs
- **Where:** `/event/fiestas-de-la-independencia` (and any shared event link with a slug not in DB)
- **Evidence:** Playwright shows blank page (34 chars). `GET /api/events/fiestas-de-la-independencia` → 404. No fallback UI.
- **Root cause:** Event detail page has no error state for missing events. 167 events exist in backend, but slug-based lookup fails for unknown slugs.
- **Action:** Add "event not found" UI with back button; verify known event slugs work
- **Effort:** S

### 1.4 /partner-dashboard redirect broken
- **Where:** `/partner-dashboard` → should redirect to `/business/dashboard`
- **Evidence:** Playwright shows redirect lands on `/` (home), not business dashboard. Vercel rewrite exists in vercel.json but routes to wrong destination.
- **Root cause:** vercel.json has `{ "source": "/partner-dashboard", "destination": "/business/dashboard" }` but the actual file is at `business/dashboard.tsx`. May be a build-output path mismatch.
- **Action:** Fix rewrite or remove if no inbound links depend on it
- **Effort:** S

### 1.5 Port tax payment shows "Próximamente" alert
- **Where:** `/port-tax/checkout` (accessible from City Pass, Bookings)
- **Evidence:** Code at `port-tax/checkout.tsx:95-102` shows hardcoded alert: "El pago en línea de la tasa portuaria estará disponible pronto."
- **Root cause:** Wompi payment processor not configured for production (`payments/config` returns `enabled: false`)
- **Action:** Either configure Wompi for production OR hide port tax checkout from navigation entirely
- **Effort:** M (if configuring Wompi) / S (if hiding)

---

## TIER 2 — VISIBLE INCOMPLETENESS
*Reachable stubs/half-modules that make the app look unfinished*

### 2.1 Notifications page is functionally empty
- **Where:** `/notifications`
- **Evidence:** 56 chars of text: "Notificaciones" header + "Inicia sesión para ver notificaciones". No content for logged-in users either until they generate activity.
- **Action:** Acceptable for launch — login gate is correct. Consider pre-seeding welcome notification on first login.
- **Effort:** S

### 2.2 WhatsApp login disabled with "Próximamente"
- **Where:** `/login` line 280, `/(tabs)/perfil` line 175
- **Evidence:** Button visible but dimmed with "Próximamente" label. `demo-login` endpoint exists at backend but is intentionally unreachable from UI.
- **Action:** Either build OTP flow or remove button entirely. Disabled state looks unfinished.
- **Effort:** M (OTP) / S (remove)

### 2.3 React hydration errors (#418) on explore + profile
- **Where:** `/(tabs)/explore`, `/(tabs)/perfil`
- **Evidence:** Playwright console captures React error #418 (hydration mismatch). Pages render but with full client re-render.
- **Root cause:** Server-rendered HTML doesn't match client render — likely due to dynamic content (dates, user state) rendered differently on server vs client.
- **Action:** Wrap dynamic content in `useEffect` or `suppressHydrationWarning`
- **Effort:** M

### 2.4 Partner categories endpoint returns stale hardcoded list
- **Where:** `GET /api/partner-categories` → returns 8 categories (hardcoded in Python)
- **Evidence:** Returns `["restaurant", "club", "beach_club", "hotel", "wellness", "cultural", "yacht", "activity"]` — missing `beauty`, `spa`, `cafe`, `bar`. Does NOT reflect actual DB categories.
- **Action:** Replace hardcoded list with `db.partners.distinct("category")` or update to match current 11 categories
- **Effort:** S

### 2.5 Promotions section always empty
- **Where:** Home page "Ofertas del día" section
- **Evidence:** `GET /api/promotions/today` → 200, empty array. No partners have created promotions with future `valid_until` dates.
- **Action:** Either seed initial promotions OR hide the section when empty (home already does this — conditional render). Non-blocking.
- **Effort:** N/A (self-hiding)

### 2.6 Daypass category removed but PARTNER_CATEGORY_LABELS still has it
- **Where:** `frontend/src/constants/theme.ts:104`
- **Evidence:** `daypass: 'Pasa Día'` still in PARTNER_CATEGORY_LABELS but filter chip removed. Also `wellness`, `cultural`, `realestate` labels exist with 0 or no filter chips.
- **Action:** Clean up PARTNER_CATEGORY_LABELS to match actual filter chips
- **Effort:** S

### 2.7 Multiple hardcoded Spanish strings not in i18n
- **Where:** Business forms (`business/profile-edit.tsx`, `business/event-form.tsx`), concierge placeholder, `complete-profile.tsx`, `(tabs)/partners.tsx:522`
- **Evidence:** ~15 user-facing strings hardcoded in Spanish (placeholders, labels, empty states)
- **Action:** Move to translations.ts. Non-blocking for Spanish-only launch.
- **Effort:** M

---

## TIER 3 — INVISIBLE DEBT
*Code-level, post-launch acceptable*

### 3.1 TODO comment for AMO concierge phone
- **Where:** `reservation/new.tsx:40`
- **Content:** `// TODO: Replace with real AMO operations number`
- **Fallback:** Uses `EXPO_PUBLIC_AMO_WHATSAPP` env var, hardcoded `573176481183` as default
- **Impact:** Works fine — env var is set in production

### 3.2 Mock payment infrastructure in backend
- **Where:** `server.py:3060-3062, 3459-3469`
- **Detail:** `MOCK_PAY=1` env var auto-approves payments. Properly gated, not active in production.
- **Impact:** None — dev infrastructure only

### 3.3 Seeded demo data infrastructure
- **Where:** `server.py:4402-4848` (seed_database), `server.py:4605-4691` (seed_analytics_demo_data)
- **Detail:** Seeded partners, analytics, demo users. Gated by `SEED_RESET=1`. Demo business accounts seeded on Vercel cold start.
- **Impact:** Demo data exists in production DB alongside real data. Government analytics dashboard shows seeded fake data.

### 3.4 eventos.web.tsx returns 404
- **Where:** `frontend/app/eventos.web.tsx`
- **Evidence:** File exists but route returns 404. Expo web-specific override file.
- **Impact:** No inbound links — dead code. Safe to delete.

### 3.5 23 orphan routes with no inbound links
- **Where:** Various — `/conciertos`, `/emergencias`, `/eventos`, `/my-week`, `/complete-profile`, `/experience/booking`, `/payments/return`, `/rewards/offers`, etc.
- **Detail:** Spanish alias routes (`conciertos`, `emergencias`, `transporte`, `favoritos`, `rutas`, `tasa-portuaria`) — most have Vercel rewrites so they work but aren't linked. Feature routes (`my-week`, `complete-profile`, `experience/booking`) exist but nothing navigates to them.
- **Impact:** Dead code / unused features. Clean up post-launch.

### 3.6 Stub Explorer card fallback in rewards
- **Where:** `rewards/index.tsx:269, rewards/card.tsx:300`
- **Detail:** If `/api/rewards/me` fails, shows default "Explorer" tier card instead of error.
- **Impact:** Graceful degradation — correct behavior.

---

## TIER 4 — NOT BUILT
*Modules with data models but no/partial UI — candidates for CUT or BUILD*

### 4.1 Government/Analytics Dashboard
- **Where:** `/admin` route, `GET /api/admin/*` endpoints
- **Evidence:** Route exists and renders but redirects unauthenticated users to home. Backend has 6 admin endpoints (all auth-gated). Analytics data is seeded/fake.
- **Status:** STUB — UI exists, backend exists, data is fake
- **Action:** CUT (hide from nav) or BUILD with real analytics
- **Effort:** L

### 4.2 Experience Bookings
- **Where:** `/experience/booking`, `/experience/[id]`, `GET /api/experiences` (34 items), `GET /api/experience-bookings` (auth-gated)
- **Evidence:** Backend has 34 real experiences. Booking page exists but is orphaned (no navigation leads to it). No booking confirmation flow tested.
- **Status:** PARTIAL — data exists, UI exists, flow untested
- **Action:** Wire experience cards to booking flow, test E2E
- **Effort:** M

### 4.3 Reservations System
- **Where:** `/reservation/new`, `GET /api/reservations/my` (auth-gated)
- **Evidence:** Reservation form exists. Backend endpoint exists. Route is orphaned — no navigation reaches it directly (partner detail may link).
- **Status:** PARTIAL — form + backend exist, flow untested
- **Action:** Verify partner detail → reserve → confirmation flow works E2E
- **Effort:** M

### 4.4 Transport Tickets
- **Where:** `GET /api/transport` (3 routes), `GET /api/transport/tickets` (auth-gated), `POST /api/transport/{id}/buy` (auth-gated)
- **Evidence:** Transport page renders with 3 routes. Buy flow exists in backend. `GET /api/transport-official` → 404.
- **Status:** PARTIAL — display works, purchase flow untested, official routes endpoint missing
- **Action:** Fix `/api/transport-official` 404; test buy flow E2E
- **Effort:** M

### 4.5 City Pass Purchase Flow
- **Where:** `/city-pass`, `GET /api/city-pass/plans` (4 plans), `POST /api/city-pass/activate` (auth-gated)
- **Evidence:** Plans page renders with 4 tiers ($99K-$599K). Activation endpoint exists. Payment via Wompi not configured.
- **Status:** PARTIAL — display works, purchase requires Wompi
- **Action:** Configure Wompi OR mark as "Próximamente" on purchase buttons
- **Effort:** M (Wompi) / S (disable)

### 4.6 Push Notifications
- **Where:** `PushBootstrap` component in `_layout.tsx`
- **Evidence:** Component imported and rendered. expo-notifications warns "not fully supported on web." No push token registration observed.
- **Status:** STUB on web — may work on native app builds
- **Action:** Verify on iOS/Android builds; web push is Expo limitation
- **Effort:** S (verify) / L (web push alternative)

### 4.7 AI Itineraries (Regenerate)
- **Where:** `/itineraries`, `POST /api/itineraries/regenerate` (auth-gated)
- **Evidence:** Page renders with itinerary builder UI. 3 pre-built itineraries exist in DB. Regenerate requires auth + Anthropic API. Static itineraries work.
- **Status:** PARTIAL — display works, AI generation requires auth + API key
- **Action:** Verify Anthropic key is set; test generation flow for logged-in user
- **Effort:** S

### 4.8 Map Neighborhoods Filter
- **Where:** `/(tabs)/mapa`, `GET /api/neighborhoods` → 404
- **Evidence:** Map renders with partner markers. Neighborhood filtering broken because endpoint returns 404.
- **Root cause:** Backend has no `/api/neighborhoods` route. Static `/data/neighborhoods.json` exists (loaded by `data.ts`).
- **Status:** PARTIAL — map works, neighborhood filter broken
- **Action:** Add backend endpoint or ensure frontend reads from static data
- **Effort:** S

---

## MODULE COMPLETENESS MATRIX

| Module | UI | Backend | Real Data | Status | What's Missing |
|--------|-----|---------|-----------|--------|---------------|
| Auth (Google) | ✅ | ✅ | ✅ | COMPLETE | — |
| Auth (Email) | ✅ | ✅ | ✅ | COMPLETE | — |
| Auth (WhatsApp) | ⚠️ Disabled | ✅ Endpoint exists | — | STUB | OTP not built; button disabled |
| Partners catalog | ✅ | ✅ | ✅ 721 | COMPLETE | — |
| Partner detail | ✅ | ✅ | ✅ | COMPLETE | — |
| Categories | ✅ | ⚠️ Hardcoded | ✅ 11 in DB | PARTIAL | `/api/partner-categories` stale |
| Events list | ✅ | ✅ | ✅ 167 | COMPLETE | — |
| Event detail | ⚠️ No error state | ✅ | ✅ | PARTIAL | Missing slug = blank page |
| Concerts | ❌ Splash stuck | ✅ | ✅ 12 | BROKEN | Broken hero image |
| Map | ✅ | ✅ | ✅ 721 markers | PARTIAL | Neighborhood filter 404 |
| Favorites | ✅ | ✅ | Auth-gated | COMPLETE | — |
| Itineraries | ✅ | ✅ | ✅ 3 + AI regen | PARTIAL | AI regen needs auth test |
| Rewards | ❌ Splash stuck | ✅ | Auth-gated | BROKEN | No guest state |
| Reservations | ✅ Form exists | ✅ | Auth-gated | PARTIAL | Flow untested, orphaned |
| Experience bookings | ✅ | ✅ | ✅ 34 | PARTIAL | Orphaned, flow untested |
| Transport | ✅ | ✅ | ✅ 3 routes | PARTIAL | `/transport-official` 404 |
| City Pass | ✅ | ✅ | ✅ 4 plans | PARTIAL | Wompi payment not configured |
| Port Tax | ✅ | ✅ | ✅ Config exists | PARTIAL | "Próximamente" — Wompi needed |
| Concierge AI | ✅ | ✅ | Auth-gated | COMPLETE | Works for logged-in users |
| Search | ✅ | ✅ | ✅ Full catalog | COMPLETE | — |
| Business portal | ✅ | ✅ | ✅ | COMPLETE | — |
| Admin/Analytics | ✅ | ✅ | ❌ Seeded/fake | STUB | Fake analytics data |
| Onboarding | ✅ | — | — | COMPLETE | — |
| Profile | ✅ | ✅ | Auth-gated | COMPLETE | — |
| Privacy/Terms | ✅ | — | — | COMPLETE | Linked from login + profile |
| Push notifications | ⚠️ Web limited | ⚠️ | — | STUB | Web not supported by Expo |
| Sponsors | ✅ | ✅ | ✅ 3 | COMPLETE | — |
| Seasons | ✅ | ✅ | ✅ 2 | COMPLETE | — |

---

## ROUTE HEALTH SUMMARY

| Status | Count | Details |
|--------|-------|---------|
| OK (linked + live) | 36 | Core app routes |
| ORPHAN (no inbound links) | 23 | Spanish aliases, unused features, dynamic routes |
| DEAD (404) | 1 | `/eventos.web` |
| REDIRECT (benign) | 3 | Tab routes → non-tab equivalents |

---

## BACKEND HEALTH SUMMARY

| Status | Count | Details |
|--------|-------|---------|
| LIVE (real data) | 32 | Public endpoints with MongoDB data |
| AUTH-GATED (correct) | ~45 | Require user/business/admin auth |
| EMPTY (valid, no data) | 1 | `/api/promotions/today` |
| STUB (hardcoded) | 2 | `/api/partner-categories`, `/api/event-types` |
| NOT-FOUND | 1 | `/api/city-passes` (correct path: `/api/city-pass/plans`) |
| BROKEN | 0 | — |

---

## CONSOLE ERROR SUMMARY (Playwright)

| Page | Errors | Failed Requests | Notes |
|------|--------|-----------------|-------|
| Home | 0 | 0 | Clean |
| Explore | 2 | 1 | React #418 hydration + neighborhoods 404 |
| Map | 0 | 0 | Clean |
| Bookings | 4 | 4 | All 401s (auth-gated) — handled with empty state |
| Profile | 1 | 0 | React #418 hydration |
| Login | 0 | 0 | Clean |
| Search | 0 | 0 | Clean |
| Concerts | 1 | 1 | Broken Unsplash image 404 |
| Favorites | 2 | 2 | 401s — handled with empty state |
| Transport | 1 | 1 | `/transport-official` 404 |
| Notifications | 0 | 0 | Minimal but functional |
| Concierge | 0 | 0 | Clean |
| Ayuda | 0 | 0 | Clean |
| Privacy | 0 | 0 | Clean |
| Terms | 0 | 0 | Clean |
| City Pass | 0 | 0 | Clean |
| Rewards | 1 | 1 | 401 — **stuck on splash** |
| Admin | 10 | 9 | Redirects to home (correct for unauth) |
| Business Login | 0 | 0 | Clean |
| Partner Detail | 0 | 0 | Clean |
| Event Detail | 4 | 3 | **Blank page** — slug not found |

---

*Generated by automated audit. No files were modified during this scan.*
