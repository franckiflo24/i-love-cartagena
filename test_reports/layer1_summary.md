# AMO Cartagena — Layer 1 Route Inventory & Auth Matrix

## 1. Total Route Count

| Source file | Routes |
|---|---|
| backend/server.py | 115 |
| backend/reservations.py (mounted at /api) | 11 |
| backend/admin_operator.py — router (/api/admin/operator) | 5 |
| backend/admin_operator.py — public_router (/api) | 3 |
| backend/reviews.py (mounted at /api) | 5 |
| backend/rewards.py (mounted at /api) | 4 |
| **TOTAL** | **143** |

> The task brief noted "~115 routes". That count matches **server.py alone**. The four sub-router modules (mounted via `app.include_router(..., prefix='/api')` at lines 4031–4053 of `server.py`) add another 28 routes, bringing the actual total to **143**. All 143 are included in the CSV.

## 2. Breakdown by Auth Posture

| Category | Count | Definition |
|---|---|---|
| Public (no auth at all) | 49 | No `get_current_user` / `get_current_business` / `require_admin` call anywhere |
| Auth-optional | 13 | Tries `get_current_user` inside `try`/`except` or via `_get_optional_user`; succeeds for guests |
| User-authenticated (session_token) | 47 | Calls `await get_current_user(request)` and raises 401 if missing |
| Partner-authenticated (Bearer biz token) | 17 | Calls `await get_current_business(request)` |
| Government / Alcaldía role-gated | 9 | Calls `_require_government_role` (partner role == "government") |
| `user.is_admin` flag-gated | 2 | `/api/admin/search/analytics`, `/api/admin/port-tax/config` |
| Admin-operator HMAC token-gated | 5 | `/api/admin/operator/*` (single-password HMAC) |
| Webhook (signature-verified) | 1 | `/api/webhooks/wompi` (HMAC SHA-256 of payload) |

Sum: 49 + 13 + 47 + 17 + 9 + 2 + 5 + 1 = 143 ✓

## 3. RED FLAGS

### 3a. Critical — "Admin" routes with NO auth check (privilege escalation)

These five routes live under `/api/admin/` but **never** call any auth function. Anyone on the public internet can hit them:

| Route | File:line | Impact |
|---|---|---|
| `GET /api/admin/moderation/notifications` | server.py:973 | Leaks all pending moderation notifications |
| `GET /api/admin/moderation/pending` | server.py:982 | Lists every event awaiting moderation |
| `POST /api/admin/moderation/{event_id}/approve` | server.py:1003 | **Anyone can publish any event** (bypasses AI moderation) |
| `POST /api/admin/moderation/{event_id}/reject` | server.py:1027 | **Anyone can suppress any event** |
| `GET /api/admin/moderation/stats` | server.py:1050 | Leaks moderation queue metrics |
| `GET /api/admin/users` | server.py:1106 | **Leaks PII for ALL users** (email, nationality, age, instagram, profile completeness) |

### 3b. Critical — Identity-trust without auth

| Route | File:line | Issue |
|---|---|---|
| `POST /api/auth/demo-login` | server.py:90 | Creates a valid 30-day session for **any email** with no verification. Account takeover trivial. |
| `POST /api/analytics/location` | server.py:2256 | Accepts `user_id` in body — anyone can submit fake location pings for any user. |
| `POST /api/profile/build` | server.py:2284 | Accepts `user_id` in body — anyone can trigger AI profile build for any user. |
| `GET /api/profile/me?user_id=...` | server.py:2359 | Reads anyone's AI profile by query string. |
| `GET /api/transport/tickets?user_id=...` | server.py:2471 | Lists anyone's transport tickets. |
| `GET /api/transport/tickets/{ticket_id}` | server.py:2478 | Reads any ticket by ID (no ownership check). |
| `POST /api/transport/{transport_id}/buy` | server.py:2404 | Issues "paid" ticket with **mocked** payment status. |

### 3c. High — Sensitive analytics exposed publicly

| Route | File:line | Note |
|---|---|---|
| `GET /api/analytics/summary` | server.py:2486 | Docstring says "for admins" — no auth. |
| `GET /api/analytics/dashboard` | server.py:2557 | Docstring says "for government/sponsors" — no auth. Exposes revenue, top partners, demographics. |
| `GET /api/analytics/heatmap` | server.py:2768 | Raw user location aggregates, no auth. |

### 3d. High — Unauthenticated LLM/AI endpoints (cost & abuse risk)

| Route | File:line | Note |
|---|---|---|
| `POST /api/concierge/chat` | server.py:1545 | Claude call, no auth, no rate limit. |
| `GET /api/search` | server.py:2012 | Runs full `ai_agent.run_agent_turn` for unauth'd users. |
| `POST /api/agent/chat` | server.py:3602 | Auth-optional; only guards on `len(message) > 1000`. |
| `POST /api/itineraries/regenerate` | server.py:1513 | Force-regenerates a Claude itinerary, auth-optional. |

### 3e. Medium — Default secrets / mock-pay paths still wired

| Route | File:line | Note |
|---|---|---|
| `POST /api/admin/operator/login` | admin_operator.py:93 | Falls back to `amocartagena-admin-2026` if `ADMIN_OPERATOR_PASSWORD` env not set. Same for `ADMIN_TOKEN_SECRET = "change-me-in-prod-please"`. |
| `POST /api/city-pass/activate` | server.py:2801 | Activates a 7-day pass **without payment**. Should be removed now that Wompi flow exists. |
| `POST /api/port-tax/checkout` | server.py:2887 | Sets `status="paid"` immediately (TODO comment). Bypasses Wompi. |
| `POST /api/transport/{transport_id}/buy` | server.py:2404 | Mock payment flow. |

### 3f. Medium — Missing ownership / abuse guards on auth'd routes

| Route | File:line | Issue |
|---|---|---|
| `PUT /api/notifications/{notification_id}/read` | server.py:1573 | Only checks auth, not whether the notification belongs to the caller. |
| `POST /api/reviews/{review_id}/helpful` | reviews.py:227 | No one-vote-per-user cap; any auth'd user can spam `helpful_count`. |
| `POST /api/promotions/{promo_id}/track-click` | server.py:1308 | Unauth'd counter increment — promo click counts can be inflated. |

### 3g. Low — Path-collision risk

`GET /api/events/dates/available` (server.py:1185) is declared **after** `GET /api/events/{event_id}` (server.py:1177). FastAPI matches in declaration order, and "dates" would otherwise be treated as an event_id. Current order works but a routing refactor could break it silently.

### 3h. Untyped inputs (no Pydantic validation)

Across the 143 routes, **76** read the body via `await request.json()` and a manual `body.get(...)` instead of a Pydantic model. That includes every payments/checkout endpoint, every admin moderation endpoint, every business profile/event create-update, and both AI chat endpoints. Only ~10 endpoints have typed input models (`SessionExchange`, `DemoLoginBody`, `ProfileUpdate`, `FavoriteToggle`, `AnalyticsEvent`, `LocationPing`, `TransportTicketBody`, `UserOut`). This makes input-fuzzing the easiest attack vector.

### 3i. No true duplicate paths

No two routes share the same `(method, path)` pair. There are however **two overlapping notification namespaces** that are intentional (user vs partner):
- `/api/notifications` (user-scoped) at server.py:1558
- `/api/business/notifications` (partner-scoped) at reservations.py:424

And there is a second declaration of `_get_optional_user` at server.py:3594 (the first is at line 1410). They are functionally identical, so no routes are shadowed — but it's a latent bug if their behaviour ever diverges.

## 4. Coverage Map — Routes by Domain

| Domain | Count | Notes |
|---|---|---|
| Auth (user + business sessions) | 6 | `auth/session`, `auth/demo-login`, `auth/me`, `auth/logout`, `business/login`, `business/logout` |
| User profile | 4 | `/profile` GET/PUT, `/profile/me`, `/profile/build` |
| Partners (public catalog) | 4 | `partners`, `partners/{id}`, `partners/nearby`, `partners/{id}/track-reserve` |
| Partner-events (publicly listed) | 3 | `partner-events`, `partner-events/{id}`, `partner-events/{id}/track-reserve` |
| Promotions | 2 | `promotions/today`, `promotions/{id}/track-click` |
| Events (curated platform events) | 4 | `events`, `events/featured`, `events/{id}`, `events/dates/available` |
| Concerts | 4 | `concerts`, `concerts/dates`, `concerts/genres`, `concerts/{id}` |
| Venues | 2 | `venues`, `venues/{id}` |
| Seasons | 3 | `seasons`, `seasons/{id}`, `seasons/{id}/events` |
| Sponsors | 1 | `sponsors` |
| Experiences (alias of partner_events) | 5 | `experiences`, `experiences/featured`, `experiences/{id}`, `experience-bookings`, `payments/wompi/experience` |
| Itineraries (AI) | 3 | `itineraries`, `itineraries/regenerate`, `itineraries/{id}` |
| Search + AI agent | 6 | `search`, `concierge/chat`, `agent/chat`, `agent/session/{id}` GET+DELETE, `agent/sessions` |
| Favorites + My Week + Calendar | 8 | `favorites/toggle`, `favorites`, `favorites/ids`, `my-week`, `my-week/toggle`, `calendar` GET/POST, `calendar/{id}` DELETE |
| Reservations (user) | 4 | `reservations` POST, `reservations/my`, `reservations/{id}`, `reservations/{id}/cancel` |
| Reservations (partner) | 2 | `business/reservations`, `business/reservations/{id}` |
| Reservations (admin) | 2 | `business/admin/reservations`, `business/admin/reservations/stats` |
| Reviews | 5 | `reviews` POST, `reviews/me`, `reviews/partner/{id}`, `reviews/{id}/helpful`, `reviews/{id}/report` |
| Rewards / loyalty | 4 | `rewards/me`, `rewards/history`, `rewards/offers`, `rewards/redeem` |
| City Pass | 3 | `city-pass/plans`, `city-pass/activate`, `city-pass/mine` |
| Port Tax (Tasa Portuaria) | 5 | `port-tax/config`, `port-tax/checkout`, `port-tax/my-tickets`, `port-tax/tickets/{id}`, `port-tax/tickets/{id}/redeem` |
| Transport (boats) | 4 | `transport`, `transport/{id}/buy`, `transport/tickets`, `transport/tickets/{id}` |
| Payments (Wompi) | 8 | `payments/config`, `payments/wompi/{city-pass,port-tax,partner-event,experience}`, `payments/{id}`, `payments/by-reference/{ref}`, `payments/my/list` |
| Webhooks | 1 | `webhooks/wompi` |
| Push tokens | 4 | `users/push-token` POST/DELETE, `business/push-token` POST/DELETE |
| Notifications (user + partner inboxes) | 5 | `notifications`, `notifications/{id}/read`, `business/notifications`, `business/notifications/{id}/read`, `business/notifications/read-all` |
| Feedback / crash | 1 | `feedback` |
| Analytics (tracking + read) | 5 | `analytics/track`, `analytics/location`, `analytics/summary`, `analytics/dashboard`, `analytics/heatmap` |
| Business partner self-service | 7 | `business/me`, `business/membership`, `business/profile`, `business/events` GET/POST, `business/events/{id}` PUT/DELETE, `business/stats`, `business/upload-image` |
| Alcaldía / government dashboard | 6 | `business/admin/analytics`, `business/admin/users`, `business/admin/payments`, `business/admin/payouts`, `business/admin/memberships`, `business/admin/partners/{id}/membership` |
| Alcaldía CSV exports | 2 | `business/admin/export/users.csv`, `business/admin/export/payments.csv` |
| Admin moderation (UNAUTH'd) | 5 | `admin/moderation/*` — all in red-flag list above |
| Admin users (UNAUTH'd) | 1 | `admin/users` — red flag |
| Admin search analytics | 1 | `admin/search/analytics` (is_admin gated) |
| Admin port-tax config | 1 | `admin/port-tax/config` (is_admin gated) |
| Admin operator (HMAC-gated) | 5 | `admin/operator/login`, `admin/operator/partners` GET/POST, `admin/operator/partners/{id}/invite`, `admin/operator/partners/{id}/approval` |
| Partner self-activation (magic link) | 3 | `business/activation/{token}`, `business/activate`, `business/onboarding-status` |
| Static category lists | 2 | `event-types`, `partner-categories` |
| Emergency contacts | 1 | `emergency-contacts` |
| **TOTAL** | **143** | |

## 5. Headline Numbers

- **143** total routes across 5 backend files
- **49** completely public (no auth at all)
- **17** "admin"-named routes; of those, **6 are entirely unauthenticated** (the moderation set + `/admin/users`) — the largest single security gap in the audit
- **76** routes accept raw dicts via `request.json()` instead of typed Pydantic input models
- **4** unauthenticated LLM/Claude endpoints (cost-abuse vectors)
- **2** distinct admin-token systems: `is_admin` user flag (2 routes) and admin_operator HMAC (5 routes). Neither protects the 6 `/admin/moderation/*` + `/admin/users` routes.
