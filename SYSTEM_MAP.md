# AMO CARTAGENA — SYSTEM MAP (microscope view)
_Last verified live: 2026-08-20 · every number below measured against production, not assumed._

## 1 · Architecture
- **Frontend**: Expo Router (React Native Web), **static export** → Vercel project `frontend` → `www.amocartagena.co` (+apex). Manual `npx vercel --prod` from `frontend/` — git push does NOT deploy.
- **Backend**: FastAPI (Python) serverless → Vercel project `backend` → `backend-mu-one-74.vercel.app`. Manual deploy from `backend/`. **Repo backend has undeployed WIP** (server.py/reviews.py/auto_verify.py behavior changes) — env-only changes go out via `vercel env` + `vercel redeploy <current-prod-url>` (same source, new env).
- **Data**: MongoDB Atlas `amo_cartagena` (cluster0.i4uvhfv). Directly reachable from dev machine via `MONGO_URL` (backend/.env.production). 67 collections (census below).
- **Data flow**: static-first — screens paint from `/data/*.json` bundles (partners.json / catalog.json / events.json …), then hydrate from `/api/*`. Static partner snapshot 893 vs live 895 (2 added upstream — regen on next data pass).
- **Cache-bust**: `+html.tsx` stamps `APP_VERSION`; `scripts/stamp-sw.mjs` **reuses the same stamp** for sw.js (single version per deploy — INVARIANT, verify parity after build). SW_UPDATED handler + version check are per-tab guarded → max ONE reload per deploy, loops impossible.

## 2 · Auth systems (3 distinct principals)
| Principal | Credential | Storage | Gates |
|---|---|---|---|
| **App user** | email-code / Google OAuth (id_token → `/auth/google`) / WhatsApp-provisioned | `session_token` (AsyncStorage/localStorage + httpOnly cookie via same-origin `/api/auth/*` rewrite) | consumer features; `is_admin: true` unlocks admin surfaces |
| **Operator** | single master password `ADMIN_OPERATOR_PASSWORD` → `/admin/operator/login` → HMAC token | `admin_operator_token` | `/admin/operator/*` partner CRUD + `/api/admin/batch-update` (same secret) |
| **Business** | business login (`/business/login`) | business session | `/business/*`; `role: government` also moderates queue |

**Unified portal**: `/admin` = one door, accepts either app-admin session or operator key; capability-aware hub; locked cards route to sign-in.
**Logout**: `keepalive:true` fetch → deletes server session doc + cookie. Complete.

## 3 · Accounts census (live 2026-08-20)
- **users: 169 total** → by provider: email_local 133, email_verified 14, google 10, whatsapp_local 9, test 3.
  - **⚠️ 110 are TEST DEBRIS** (`@test.com`, `@example.com`, `@verify.com`, `@t.test`, `@internal.test`) from automated audits. **Real users ≈ 59.** Backup taken: `backups/test_users_purge_backup_20260820T120127.jsonl.gz` (incl. 141 sessions, 15 rewards accounts, 5 favorites, 4 profiles). Purge awaiting go.
- **is_admin accounts (exactly 3)**:
  - `machinemindconsulting@gmail.com` — Phil (google)
  - `azoulayfranck4@gmail.com` — Franck (google)
  - `33698576202@wa.amo.local` — Franck WhatsApp identity
- **business_users: 7**:
  - `elarsenal@amocartagena.app` (business, ptr_006)
  - `comercial@casaboheme.co` (business, ptr_V014 Casa Bohême)
  - `alcaldia@amocartagena.app` (government, ptr_alcaldia)
  - `machinemindconsulting@gmail.com` (government)
  - `machinemindconsulting+partner@gmail.com` (business)
  - **DEMO**: `demo@amocartagena.app` (business → `ptr_demo_sandbox`), `demo@alcaldia.local` (role `alcaldia_demo`)
- **Sessions**: user_sessions 200 stored / 15 unexpired; business_sessions 103.
- **partners: 895** live (893 static) across 13 categories: restaurant 185, hotel 120, beauty 109, service 91+1, wellness 84, activity 82, bar 57, beach_club 48, cafe 36, attraction 29, nightlife 28 (nightclub 21 incl. Bohême Lounge elite), yacht 23.

## 4 · Demo machinery (env-driven)
`DEMO_LOGIN_ENABLED`, `DEMO_PARTNER_PASSWORD` (demo@amocartagena.app → sandbox partner `ptr_demo_sandbox`), `DEMO_SIGNUP_CODE` (public signup code), `ALCALDIA_DEMO_PASSCODE` + `ALCALDIA_PASSWORD` (government demo/real), `MOCK_PAY`, `PORT_TAX_AUTO_PAY`, `SEED_RESET`.

## 5 · Integrations (by env refs in code)
- **AI**: Anthropic (`ANTHROPIC_API_KEY`; Luna chat = Sonnet, taste/moderation = Haiku; `AMO_LLM_MODEL`, `LUNA_TASTE_DAILY_CAP` ~1/IP/day) · legacy `EMERGENT_LLM_KEY`.
- **Auth**: `GOOGLE_CLIENT_ID` (+ frontend `EXPO_PUBLIC_GOOGLE_CLIENT_ID`).
- **Comms**: Resend (`RESEND_API_KEY`, email codes) · WhatsApp Cloud API (`WHATSAPP_TOKEN/PHONE_NUMBER_ID/APP_SECRET/VERIFY_TOKEN` — partner pulse webhook; token config pending Meta console) · Web Push (`VAPID_*`, sw.js push handlers).
- **Payments**: Wompi (`WOMPI_*`, `payments/config.enabled=false` → all purchase CTAs honestly dead-end "Próximamente"; City Pass, Port Tax (`PORT_TAX_AUTO_PAY`), commissions `APP_COMMISSION_PCT`/`RESERVATION_COMMISSION_PCT`). Consumer reservations = WhatsApp deep-links (wa.me), zero-infra.
- **Storage**: Vercel Blob (`BLOB_READ_WRITE_TOKEN`) for uploaded partner media.
- **Ops**: `CRON_SECRET` (weekly demand report Mon 10:00 UTC + admin cron routes), `CORS_ALLOWED_ORIGINS`, `ADMIN_TOKEN_SECRET` (operator HMAC).

## 6 · Route surface
- **Frontend ~75 routes**: 9 tabs (index/explore/mapa/pasaporte/bookings/perfil/agenda/partners/citypass) + partner/[id], partner-event/[id], event/[id], experience/[id]+booking, collections/[key], search, favorites, esenciales, seguridad, rutas, transport(e), viaje/*+shared/[code], rewards/*, port-tax/*, reservation/new, review/new, concierge, onboarding, login, admin portal (admin, eagle, moderation, operator*), business suite (13 screens), legal (terminos/privacidad/ayuda). All dynamic routes have vercel.json rewrites (static export requirement).
- **Backend 243 routes / 17 routers**: core api_router + admin_operator, biz_activation, reservations, rewards, reviews, pulse (WhatsApp), demand, tagging, occasions, essentials, taste (anon Luna), local_signals, walking, webpush, referral, trips.
- **Luna (AssistantFab)**: guest → instant catalog cards (bundled catalog.json 893) + `/agent/taste` (no auth, capped) → 2 exchanges → localized login invite (next preserved, sheet reopens post-auth). Logged-in → `/agent/chat` (Sonnet, Bearer). 14s timeout, venue-card fallback — Luna can never show a dead error.

## 7 · Known boundaries / next backend deploy package
1. Review + ship backend WIP (server.py/reviews.py/auto_verify.py — committed at checkpoint af4b7daa, never deployed).
2. Single-principal admin auth (operator token accepted by is_admin routes; per-user operator accounts; rotate the shared master password).
3. `/business/admin/{payments,analytics,users}` accept business sessions only (no portal screen calls them today).
4. Operator partner list caps at 500 of 895.
5. FastAPI `/docs`+`/openapi.json` public → `docs_url=None`.
6. `/api/partners` anon payload leaks business-internal fields (membership/rank metrics; email+NIT on 7 listings).
7. Regenerate static: partners.json (893→895), events.json fallback (38 past events).
8. Test-account purge (110 users + related docs; backup already on disk).
