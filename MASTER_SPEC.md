# MASTER_SPEC.md — AMO Cartagena (as-built, reverse-compiled)

> Reverse-engineered complete map of the shipped system. Produced during the
> 3-round adversarial launch-readiness audit (see CHANGELOG.md). Ground truth for
> "does every module/route/endpoint/table/flow exist and behave" — the anti-amnesia
> reference. Stack: **Expo Router (React Native Web, static export → Vercel)**
> frontend · **FastAPI (Python serverless → Vercel)** backend · **MongoDB Atlas**
> (`amo_cartagena`, 68 collections). Static-first: paints from `/data/*.json`, then
> hydrates from `${EXPO_PUBLIC_BACKEND_URL}/api`.

---

## 1. OUTCOME STATEMENT

A visitor to Cartagena (or a local) can, from one app: discover verified places/events/experiences filtered to their taste; ask Luna (a grounded AI concierge) what to do now and get real, in-catalog answers; navigate a map of partners + city essentials; earn a gamified "passport" by physically visiting places and redeem points for partner offers; plan a collaborative trip with friends (vote on items via a share link); buy a City Pass / Tasa Portuaria ticket (Wompi hosted checkout) and hold a scannable QR; and reserve at a venue. A partner business can self-onboard, claim/verify its venue, publish events/promotions/real-time "pulse" status, receive reservations, and see stats. The Alcaldía (city government) sees city-wide KPIs, moderates submissions, and manages memberships. **Success = a tourist completes discover→decide→act (reserve/buy/route) without hitting a dead end, a lie, or a crash; a partner publishes content that reaches guests; the honesty spine holds (nothing fabricated is shown).**

## 2. MODULE TREE

The complete domain→submodule→leaf tree (frontend + backend + infra) with owner files is maintained in the as-built inventory. Top-level domains, each with a live owner file set:

- **Auth & Identity** — consumer (Google OAuth + email/code, `server.py:115-470`, `AuthContext`), business (bcrypt + `business_sessions`, `BusinessAuthContext`), admin (`require_admin`), Alcaldía (`_require_government_role`), operator (HMAC, `admin_operator.py`); DB-backed brute-force throttle (`login_throttle`, fail-closed).
- **Onboarding** — wizard (`app/onboarding.tsx`), preview-then-gate signup wall (`SignupGateContext` + `gate_events`), home-base picker, tutorial overlay.
- **Home/Discovery** — `(tabs)/index.tsx`, now/seasonal/nearby strips (`walking.py`), daily itineraries (`ai_itinerary.py`), for-you (`taste.py`), collections (`occasions.py`), local-picks (`local_signals.py`).
- **Explore/Browse** — `(tabs)/explore.tsx`, `partners.tsx`, events/concerts/experiences.
- **Partner Detail** — `partner/[id].tsx`, reviews (`reviews.py` + `ReviewsList`), trust badges, live distance.
- **Map** — `(tabs)/mapa.tsx` (Leaflet), `/nearby`, essentials pins.
- **Search** — `search.tsx` + `/search` (AI-enrich, rate-limited) + client static search (ES/EN/FR/PT synonyms) + CTR tracking.
- **Concierge (Luna)** — `/agent/chat` (Sonnet, grounded, sessioned, `ai_agent.py`) + `/agent/taste` (Haiku, IP-capped); `AssistantFab`, `concierge.tsx`. LLM abstraction `llm.py`.
- **Passport** — `(tabs)/pasaporte.tsx`, proximity `/passport/discover`, trails/quests/groups, share card (`walking.py`).
- **Rewards** — `rewards/*`, points ledger + redeem (`rewards.py`).
- **Trips (Mi Viaje)** — collaborative trips, items/vote/share/join (`trips.py`).
- **Reservations** — structured + WhatsApp deep-link; business inbox; Alcaldía aggregate (`reservations.py`).
- **Payments** — Wompi hosted checkout (5 kinds) + signature-verified webhook + mock provider (labeled) (`wompi.py`, `server.py`, `PaymentSheet`).
- **City Pass / Port Tax** — plans/activate/mine, config/checkout/tickets/redeem.
- **Business/Partner Portal** — auth, claim flow (`partner_claims.py`), profile/media/price, events/promotions/pulse CRUD, stats, redemptions scanner.
- **Admin/Alcaldía** — city KPIs, moderation, memberships, claims, accounts, payouts, intel dashboards; operator console.
- **Essentials** — need-state taxonomy + pins (`essentials.py`), emergency/transport.
- **Promotions** — `/promotions/today` + click tracking.
- **Pulse** — partner real-time status + WhatsApp inbound webhook (`pulse.py`).
- **Notifications** — in-app + Expo push + web-push VAPID (`push.py`, `webpush.py`).
- **Reviews** — submit/read/helpful/report (`reviews.py`).
- **Legal/Support** — help/terms/privacy/safety/feedback.
- **Data layer** — `src/constants/api.ts` (static-first client), static JSON catalogs, seed/tagging/demand/local-signal pipelines.
- **Integrations** — §6. **Rate limiting** — `ratelimit.py` (fail-closed SENSITIVE_PREFIXES). **Infra** — Vercel build/deploy, cache-bust SW, OG edge functions, ErrorBoundary.

## 3. ROUTE MAP

**82 route files.** Visible tabs: `index, explore, mapa, pasaporte, bookings, perfil`. Hidden tabs (`href:null`): `agenda, partners, citypass`. Full table (URL · purpose · auth) is in the inventory; every `router.push/replace` target resolves to a real route (verified: 52/52 static targets, 0 dead — audit round 2). 7 pure legacy-alias redirects (`conciertos→concerts`, `transporte→transport`, `favoritos→favorites`, `my-week→agenda`, `tasa-portuaria→port-tax/checkout`, `emergencias→ayuda`, `partner-dashboard→business/login`). Each screen implements the five states (loading/empty/error/success/partial); detail screens (`partner/event/experience/partner-event/[id]`, `viaje/[id]`, `viaje/shared`, `citypass`, `port-tax/ticket`, `reservation/new`) are `[]`-truthy-guarded so a bad-shape/empty response shows the honest not-found state, never a crash or fake card (hardened across audit rounds 1–3).

## 4. API CONTRACT

**≈258 endpoints under `/api`** (126 GET, 100 POST, 14 DELETE, 8 PATCH, 8 PUT). Auth taxonomy: `none` · `consumer` (`get_current_user`) · `consumer?` (`_get_optional_user`) · `business` (`get_current_business`) · `gov` (`_require_government_role`, all `/business/admin/*`) · `admin` (`require_admin`/`is_admin`) · `cron` (`Bearer CRON_SECRET`, constant-time) · `op-token`/`op-secret` (operator) · `wompi-sig` · `wa-sig`. Public catalog reads (`/partners`, `/events`, `/concerts`, `/experiences`, `/promotions/today`, `/search`, `/collections`, `/essentials/*`, `/nearby`, …) MUST merge `PUBLIC_PARTNER_FILTER` (`partner_visibility.py` — the single visibility source, honoring `catalog_status` + legacy `status` + `is_public`). Every write endpoint: auth → validate → act → structured error with correct status code. Full method+path+auth+purpose table is in the inventory. Every listed endpoint has ≥1 frontend caller except the documented orphans (`/api/concierge` edge fn — DELETED in audit; `admin_operator` self-activation — mounted only when its secrets are set).

## 5. DATA MODEL

**68 MongoDB collections.** Primary: `partners` (catalog; visibility via `catalog_status`/`status`/`is_public`), `partner_events`, `events`, `users`, `business_users`, `venue_claims`, `city_passes`, `port_tax_tickets`, `payments` (kind/amount_cop/status/split), `partner_promotions`, `partner_pulses`, `trips`+`trip_items`, `reviews`, `user_passport`, `rewards_accounts`+`_history`+`_offers`+`_redemptions`, `reservations`, `chat_sessions`, `user_sessions`/`business_sessions`, `rate_buckets`/`login_throttle` (fail-closed), plus analytics/push/moderation collections. Full field inventory + touching-endpoints table in the inventory doc. **Honesty invariant:** `partners.rating`/`reviews` exist ONLY when backed by real `db.reviews` docs (audit: 2 partners today); `description` carries no rating claims (audit round 3 stripped all 170). RLS-equivalent = `PUBLIC_PARTNER_FILTER` merged at every public read + per-user/per-business scoping in the Mongo query itself for owned data.

## 6. INTEGRATION REGISTER

| Integration | Purpose | Env vars | Degraded-mode behavior |
|---|---|---|---|
| Anthropic Claude | Luna concierge (Sonnet) + pulse/taste parse (Haiku) | `ANTHROPIC_API_KEY`, `AMO_LLM_MODEL`, `LUNA_TASTE_DAILY_CAP` | `llm_complete`→None on error; **20s timeout + 1 retry** (bounded < Vercel 60s); Luna shows a friendly fallback bubble, pulse returns clean 502. Never hangs. |
| Wompi | Payments (5 checkout kinds), hosted page | `WOMPI_{ENV,PUBLIC_KEY,PRIVATE_KEY,EVENTS_SECRET,INTEGRITY_SECRET}`, `APP_COMMISSION_PCT`, `RESERVATION_COMMISSION_PCT` | If unconfigured (current prod state): `/payments/config`→`enabled:false`; priced CTAs degrade to honest "Próximamente" (never a dev message). `MOCK_PAY`/`PORT_TAX_AUTO_PAY` hard-disabled in prod via `VERCEL_ENV`. |
| MongoDB Atlas | Primary datastore | `MONGO_URL`, `DB_NAME` | `serverSelectionTimeoutMS=5000`; unwrapped call → plain 500 (no traceback leak), frontend degrades to `/data/*.json`. |
| Resend | Transactional email | `RESEND_API_KEY` | `_send` returns False, never raises (10s timeout). |
| WhatsApp Cloud (Meta) | Pulse inbound + concierge deep-links | `WHATSAPP_{TOKEN,PHONE_NUMBER_ID,VERIFY_TOKEN,APP_SECRET}` | Webhook **fail-closed 503** if `WHATSAPP_APP_SECRET` unset (was fail-open); signature `hmac.compare_digest`. |
| Web-Push VAPID / Expo Push | Notifications | `VAPID_{PUBLIC,PRIVATE}_KEY`, `VAPID_SUBJECT`, `EXPO_PUSH_URL` | Send wrapped in try/except; a push outage cannot crash a reservation. |
| Google OAuth | Consumer sign-in | `GOOGLE_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_CLIENT_ID` | Email/code signup is the fallback path. |
| Operator/Cron/Demo | Admin console, cron, demo | `ADMIN_OPERATOR_PASSWORD`, `ADMIN_TOKEN_SECRET`, `CRON_SECRET`, `DEMO_SIGNUP_CODE`, `VERCEL_ENV` | `admin_operator` router mounts only when its secrets are set (else swallowed at import). |

Self-hosted images (zero Google-image dependency); Unsplash allowed only for decorative placeholders (SafeImage 4-stage fallback).

## 7. USER FLOW STATE MACHINES (with failure states)

8 flows fully traced in the inventory: Onboarding · Browse→Partner→Reserve · City-Pass pay · Port-Tax pay · Business signup→claim→content→promo/pulse · Trip create→invite→join→vote · Passport earn→reward redeem · Luna cold-conversion. **Money-path failure states (Wompi):** declined → "Pago rechazado, intenta otro método"; pending/timeout → poller stops at ~60s and shows honest pending; webhook-never-arrives → ticket stays `pending_payment` (no false ticket). ⚠️ **Pre-Wompi-enable hardening (deferred, dormant while Wompi off):** payment is marked `approved` before fulfillment and the idempotency guard then blocks retry (charged-but-no-ticket), plus a non-atomic double-fulfillment race — both MUST be fixed (reorder + compare-and-set + sweeper) before Wompi is switched on. **Reserve/pulse/promo writes** are guarded against STATIC_MODE fake-success (pulse checks `r.ok`).

## 8. FAILURE MODE ENUMERATION (designed behavior — "crash" is never it)

- Backend down / 500 / cold-start → frontend GET degrades to `/data/*.json`; writes surface a caught error (no blank/crash).
- LLM slow/overloaded → 20s timeout + fallback bubble (never a 60s 504 hang).
- Atlas blip → 5s selection timeout, plain 500, no traceback; rate-limiter fails **closed** for sensitive prefixes.
- Empty/`[]`/malformed API response → shape guards → honest not-found state (all detail screens).
- Unknown/stale detail id → backend 404 discipline (never a bare `200 []`).
- Dead image URL → SafeImage placeholder chain (inline SVG, offline-safe).
- Fabricated data → **eliminated** (structured rating fields unset; description prose stripped; reviews.json emptied; per-partner files stripped) with the honesty invariant above.
- Suspended/unapproved partner → hidden from every guest surface (`PUBLIC_PARTNER_FILTER` now honors `is_public`+`suspended`).
- Auth expiry mid-action → 401 → screens redirect to login; brute-force → DB throttle (fail-closed).
- Webhook replay → signature-verified; (double-fulfillment CAS deferred to pre-Wompi-enable).
- Unauth cost-abuse → the 3 public LLM proxies DELETED; `/agent/*` rate-limited + auth.

## 9. NON-FUNCTIONAL FLOOR

- **Mobile-first** RN-web; responsive; primary CTAs ≥40px.
- **Languages** ES (base) + EN/FR/PT auto-detected from device (`autoTr.ts` + `LanguageContext`); core conversion screens fully wrapped (audit round 1).
- **Response times** LLM bounded 20s; serverless 60s ceiling respected.
- **A11y** focus/alt/contrast floor; ErrorBoundary prevents white-screen (friendly retry).
- **SEO/OG** `<title>`/meta/OG image present; PWA manifest + icons + apple-splash; automatic cache-bust per deploy.
- **Legal** privacy + terms + help pages present with real content; Ley 1581 right-to-erasure (`DELETE /auth/delete-account`, 11-collection cascade).
- **Deploy gate** `node scripts/verify-images.mjs` (1023/1023 200); tsc 0; battery every 5 closures.

## 10. BUILD ORDER (as-built, dependency-sorted — all shipped)

The system is live; drops were built and battery-verified in dependency order: (0) infra/auth/data-layer → (1) catalog reads + home/explore/map → (2) partner detail + search → (3) **demo-able path: browse→partner→reserve** → (4) Luna concierge → (5) passport/rewards → (6) trips → (7) business portal (claim→content→events→promotions→pulse) → (8) payments (city-pass/port-tax, Wompi hosted) → (9) admin/Alcaldía + intel → (10) essentials + notifications. No drop imports from a later drop. Current state: all drops closed; launch-readiness audit rounds 1–3 closed all P0/P1 (CHANGELOG.md).

## 11. EXPLICIT NON-GOALS (this launch)

- **Real Wompi charging is OFF** (config `enabled:false`); priced CTAs degrade to "Próximamente". Enabling Wompi requires the deferred payment-fulfillment reorder + double-fulfillment CAS first.
- Concerts/transport in-app charging uses a **labeled mock** (`PaymentSheet`, "Modo demostración"), not a real charge.
- No native app-store binary in scope (PWA/web); no in-app card capture (Wompi hosted page only — PCI out of scope).
- `admin_operator` partner-invite/magic-link onboarding is optional (mounts only when its secrets are set); primary partner onboarding is self-service signup+claim.
- No Telegram integration. No Google-image dependency.
