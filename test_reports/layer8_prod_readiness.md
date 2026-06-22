# Layer 8 — Production Readiness Audit

**Date:** 2026-06-05
**Auditor:** Claude (read-only)
**Scope:** `/Users/showowt/i-love-cartagena/` — backend (FastAPI) + frontend (Expo)
**Live URLs:** frontend `https://dist-ten-omega-67.vercel.app`, backend = local Mongo via Cloudflare tunnel (fragile)
**Render deploy:** pending

---

## 1. TypeScript health — **WARN**

**Command:** `cd frontend && npx tsc --noEmit`

**Evidence (full output, only 1 error):**
```
app/(tabs)/index.tsx(375,29): error TS2339: Property 'aerial' does not exist on type
'{ readonly hero: ...; readonly login: ...; ... 38 more ...; readonly season_fallback: ... }'.
```

Root cause: typo. `frontend/src/constants/images.ts` exports `cartagena_aerial`, but `app/(tabs)/index.tsx:375` references `IMAGES.aerial`. Line 368 in the same file correctly uses `IMAGES.cartagena_aerial`, so the "Beach Clubs" card is currently rendering with `undefined` as image URI.

**Top file:** `frontend/app/(tabs)/index.tsx` (1 error, 1 file total)

**Verdict:** WARN — `tsc --noEmit` exits non-zero, so strict CI/Vercel build with type-check would fail. Today Expo/Metro happily ships it because TS errors don't block Metro bundling. But: per CLAUDE.md "TypeScript compiles without errors" is a deploy gate.

**Fix:** Change `IMAGES.aerial` → `IMAGES.cartagena_aerial` in `frontend/app/(tabs)/index.tsx:375`.

---

## 2. Python import health — **PASS (with one missing dep)**

**Command:** `cd backend && python3 -c "import server"` → exit 0, no output. Server imports cleanly on the local machine.

**Imports inventory (across all backend/*.py):**
- Listed in `requirements.txt`: fastapi, uvicorn, motor, pymongo, python-dotenv, python-jose, python-multipart, pydantic, httpx, bcrypt, passlib, stripe
- Imported but NOT in requirements.txt:
  - `emergentintegrations` — used in 7 AI files (`ai_agent.py`, `ai_moderation.py`, `ai_user_profile.py`, `ai_itinerary.py`, `ai_search.py`, `ai_image_moderation.py`, `concierge.py`). All wrapped in `try/except ImportError` and log "unavailable", so server boots — but **every AI feature silently degrades** to fallback behaviour in production. Concierge, moderation, itinerary, search will all return stubs.
  - `openpyxl` — used in `scripts/import_partners_xlsx.py` only. Script-only dep, lower priority.
- In requirements but never imported anywhere: `stripe==15.0.1` — **dead dependency**. (Payment provider is Wompi, not Stripe.)

**Versions:** Every dep is pinned to an exact version. Good.

**Verdict:** PASS for boot, **WARN** for functional completeness. AI features will appear broken in prod unless `emergentintegrations` is added to `requirements.txt` (or its absence is acknowledged as an intentional cutover).

**Fix:** Decide on the AI layer. Either:
1. Add `emergentintegrations` to `requirements.txt` (verify pip-installable on Render — it's a private/Emergent package, may need a custom index URL).
2. Or rip the dependency out and replace with direct Anthropic SDK calls (CLAUDE.md tech stack lists Claude API as canonical).

---

## 3. Secrets in repo — **WARN (low severity, but stains the history)**

**Commands & evidence:**
- `git log --all -p` for current secret patterns (`sk-ant-`, `sk_live`, `AKIA`, `mongodb+srv://user:pass@`): **0 hits**.
- Two historic commits show `.env` files were committed and later deleted (`1c6e4b2`, `9fb4c24`), but the contents were dev placeholders only:
  - `backend/.env`: `MONGO_URL="mongodb://localhost:27017"`, `DB_NAME="test_database"`
  - `frontend/.env`: emergent preview URLs, no secret material
- Current tree: hardcoded **fallback** secrets in `backend/admin_operator.py`:
  ```
  ADMIN_PASSWORD     = os.getenv("ADMIN_OPERATOR_PASSWORD", "amocartagena-admin-2026")
  ADMIN_TOKEN_SECRET = os.getenv("ADMIN_TOKEN_SECRET",      "change-me-in-prod-please")
  ```
  Plus `backend/server.py:5365`: `DEMO_PARTNER_PASSWORD` default `"amocartagena2026"`, `:5382` `ALCALDIA_PASSWORD` default `"AlcaldiaCTG2026!"`.
- These same literals appear in 9+ test files (`alcaldia_test.py`, `wompi_test.py`, `phase3_test.py`, etc.) — meaning the test suite *only* works when prod still uses the defaults. So if you rotate the env vars, tests break loudly. (That's actually fine; it forces you to rotate.)

**Verdict:** WARN. No real API keys in git. But the JWT-signing secret `ADMIN_TOKEN_SECRET` has a known default — anyone who has read this repo can forge admin tokens against any instance that didn't override the env var. Same for the admin login password.

**Fix:**
1. On Render, set `ADMIN_OPERATOR_PASSWORD`, `ADMIN_TOKEN_SECRET`, `ALCALDIA_PASSWORD`, `DEMO_PARTNER_PASSWORD` to long random values. Confirm `process.env` reads succeed before first prod traffic.
2. Optional but recommended: change the code to **fail-fast** if these env vars are not set, instead of silently falling back to the public default. Pattern:
   ```python
   ADMIN_TOKEN_SECRET = os.environ["ADMIN_TOKEN_SECRET"]  # raises at boot
   ```
3. Don't bother rewriting git history — the leaked values were either placeholders or are about to be rotated.

---

## 4. .env hygiene — **WARN**

**Files on disk:**
```
./backend/.env
./frontend/.env
./frontend/dist/.env.local   ← shipped inside the Vercel build output
```

**Git tracked?**
- `git ls-files | grep -E "\.env"` → **empty** today. Good.
- `git log --all --diff-filter=D` shows `backend/.env` and `frontend/.env` were committed once and later deleted (contents above — placeholders only).
- `.gitignore` covers `.env`, but the file is a disaster: the `# Environment and credential files` block is duplicated **14 times** (lines 83–225) due to a broken append loop, with stray `-e` lines from `echo -e` shell mistakes mixed in. Cosmetically embarrassing, functionally fine.

**`.env.example`:** **does not exist** anywhere in the repo. New deployers (you, on Render) have no documented list of required env vars.

**Env vars the code reads (from `os.environ.get` / `os.getenv` grep):**
| Variable | Where | Has default? |
|---|---|---|
| `MONGO_URL` | server.py:14 | NO — `os.environ['MONGO_URL']` crashes if missing |
| `DB_NAME` | server.py:16 | NO — same |
| `ADMIN_OPERATOR_PASSWORD` | admin_operator.py:39 | yes (public default) |
| `ADMIN_TOKEN_SECRET` | admin_operator.py:40 | yes (public default) |
| `ADMIN_TOKEN_TTL_HOURS` | admin_operator.py:41 | yes |
| `ACTIVATION_TOKEN_TTL_DAYS` | admin_operator.py:42 | yes |
| `PUBLIC_APP_URL` | admin_operator.py, server.py (4 places) | yes (emergentagent preview URL) |
| `EMERGENT_LLM_KEY` | 5 AI files | "" |
| `ANTHROPIC_API_KEY` | concierge.py:13 | "" |
| `WOMPI_ENV`, `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`, `WOMPI_INTEGRITY_SECRET`, `WOMPI_EVENTS_SECRET` | wompi.py | yes / "" |
| `APP_COMMISSION_PCT`, `RESERVATION_COMMISSION_PCT` | wompi.py | yes |
| `EXPO_PUSH_URL`, `EXPO_PUSH_TIMEOUT` | push.py | yes |
| `DEMO_PARTNER_PASSWORD` | server.py:5365 | yes (public default) |
| `ALCALDIA_PASSWORD` | server.py:5382 | yes (public default) |
| `VERCEL` | server.py (several) | optional flag |

Frontend reads:
| Variable | Where |
|---|---|
| `EXPO_PUBLIC_BACKEND_URL` | 8+ files (AuthContext, api.ts, wompi.ts, mapa.tsx, citypass.tsx, port-tax/checkout, AlcaldiaDashboard) |
| `METRO_CACHE_ROOT` | metro.config.js |

**Verdict:** WARN. No `.env.example` is a real onboarding/deploy blocker. `frontend/dist/.env.local` is suspicious — `EXPO_PUBLIC_*` values get inlined into the JS bundle at build time, so anything in that file is already public, but it shouldn't be in `dist/` either way (clean dist before deploy).

**Fix:**
1. Create `.env.example` (backend + frontend) listing every var above with placeholder values.
2. Add a startup check in `server.py` that asserts the secret-grade vars are set (`MONGO_URL`, `DB_NAME`, `ADMIN_TOKEN_SECRET`, `ADMIN_OPERATOR_PASSWORD`, `ALCALDIA_PASSWORD`, `WOMPI_PRIVATE_KEY`).
3. Clean up the duplicated `.gitignore` block.

---

## 5. Bundle size / cold start — **WARN**

**Frontend bundle:**
- `frontend/dist/_expo/static/js/web/entry-da138e6eac9e39fbfb69c5a9cb875284.js` = **2.5 MB** uncompressed (single file, no code-split). Whole `dist/` = 11 MB.
- Brotli/gzip on Vercel will probably knock this to ~700 KB on the wire, but mobile cold start on Cartagena 4G (typical 5–10 Mbps real-world) = **~1.5–3 s for the JS alone**, plus React Native Web hydration. Acceptable, not great.

**Backend:**
- `server.py` is **5,738 lines, 290 KB** in a single file.
- **115 routes** registered with `@api_router.{get,post,...}` + sub-routers (`reservations`, `rewards`, `reviews`) included via `app.include_router`. Real route count is closer to 150.
- On Vercel serverless (`api/index.py` shim exists), every cold start re-imports the whole file. Expect **3–6 s cold start** with motor + httpx + bcrypt + 5,738 LOC. Vercel Hobby has 10 s default function timeout — uncomfortably close.
- On Render web service (persistent process), cold start happens once per deploy/restart, no per-request issue.

**Verdict:** WARN. Bundle is acceptable for web. Backend mono-file is a maintainability bomb but not a runtime blocker on Render.

**Fix:**
1. Move backend to Render persistent (already in `render.yaml`) — avoids serverless cold starts entirely.
2. Don't bother splitting `server.py` for the launch; flag as tech-debt.
3. Frontend: enable Metro tree-shaking and check whether `react-native-maps`, the Wompi widget, or icon packs are imported globally. (Out of scope for this audit.)

---

## 6. Error tracking & logging — **CRITICAL**

**Commands & evidence:**
- `grep sentry` across the repo: **0 hits in source**, only 2 stale metro-cache files.
- No Datadog, no Logtail, no Better Stack, no Honeybadger, no Rollbar.
- Backend logging: every module has `logger = logging.getLogger(__name__)` and writes via `logger.info` / `logger.warning` / `logger.error`. That goes to stdout. On Render that's captured to the live log stream but is **not searchable, not alertable, not aggregated**. Disappears on container restart unless you tail it.
- Frontend logging: 97 `console.log` calls across 39 files in `frontend/src` and `frontend/app`. Per CLAUDE.md ("No `console.log` in production"), all of these should be removed or changed to `console.error` for actual errors.

**Verdict:** CRITICAL. Production errors **vanish**. A paying customer hits a 500 at 2 AM Saturday and you'll learn about it from a WhatsApp complaint, not from a page. For an app that takes money (Wompi, port-tax tickets, city-pass), this is the single biggest production gap.

**Fix:**
1. Backend: install `sentry-sdk[fastapi]`, initialise in `server.py` before `app = FastAPI()`, gate by `SENTRY_DSN` env var. ~10 lines.
2. Frontend: install `@sentry/react-native` (Expo plugin exists), wire `EXPO_PUBLIC_SENTRY_DSN`. Catches JS exceptions and unhandled promise rejections.
3. Sweep `console.log` → either delete or change to `console.error` where it's actually an error path.

---

## 7. CORS / security headers — **CRITICAL**

**Evidence — `backend/server.py:4055`:**
```python
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

This is **the canonical CORS misconfiguration**. `allow_credentials=True` + `allow_origins=["*"]` is explicitly forbidden by the CORS spec; **all modern browsers refuse to send credentials** to a server that returns `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true`. So either:
- The frontend is using bearer tokens in `Authorization` headers (not cookies) → `allow_credentials=True` is a no-op lie and the wildcard origin is fine but pointlessly permissive.
- Or cookies *are* in use, in which case **authenticated requests from the browser silently fail** (this matches the symptom in commit `edc0e75`: "Fix cross-origin credentials blocking API calls on mobile Safari").

**Other security headers:**
- `grep` for `X-Frame-Options`, `Content-Security-Policy`, `Strict-Transport-Security` → **0 hits**. No middleware sets any security header.
- No CSRF protection (acceptable if the app is purely bearer-token, no cookies).

**Verdict:** CRITICAL — both a security gap *and* a known cause of mobile Safari breakage.

**Fix:**
1. Replace wildcard origin with explicit list:
   ```python
   allow_origins=[
       "https://dist-ten-omega-67.vercel.app",
       "https://amocartagena.app",         # if/when the custom domain lands
       "http://localhost:8081",            # Expo dev
       "http://localhost:19006",
   ],
   allow_credentials=True,
   allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
   allow_headers=["Authorization", "Content-Type"],
   ```
2. Add Starlette `TrustedHostMiddleware` + a tiny middleware that sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and HSTS if behind HTTPS termination.

---

## 8. Database posture — **CRITICAL (data-loss on every restart)**

**Evidence:**
- `backend/server.py:14`: `mongo_url = os.environ['MONGO_URL']` — env-driven, no hardcoded fallback. PASS.
- `AsyncIOMotorClient(mongo_url)` — default pool size (100), no explicit retry, no `serverSelectionTimeoutMS` override.
- **Startup seeder (`seed_database` at line 3699):**
  ```python
  async def seed_database():
      # Always drop and re-seed seasons, events, and partner_events so dates stay current
      await db.seasons.delete_many({})
      await db.events.delete_many({})
      await db.partner_events.delete_many({})
      ...
  ```
  Wired to `@app.on_event("startup")` at line 4064. **Every Render restart wipes seasons, events, and partner_events** and re-inserts hardcoded demo data. Any partner who edited or added an event between restarts loses it. Any partner who paid for placement loses it.
- The Vercel branch skips this (`if os.environ.get("VERCEL"): return`), so it only bites on Render — i.e. the deployment you're about to do.

**Other startup work:** creates indexes (idempotent, fine), seeds rewards offers (`_rewards.seed_default_offers` — need to check if it deletes first), seeds analytics demo data once (guarded).

**Verdict:** CRITICAL for Render. This is the single most dangerous line of code in the repo if Render restarts are frequent (and they will be — free tier sleeps after 15 min idle, paid tier restarts on every deploy).

**Fix:**
1. Make seeding idempotent: replace `delete_many({})` with upsert per record. Pattern:
   ```python
   for season in seasons:
       await db.seasons.update_one(
           {"season_id": season["season_id"]},
           {"$setOnInsert": season},
           upsert=True,
       )
   ```
2. Or guard seeding behind `if os.environ.get("SEED_ON_BOOT") == "true"` so it never runs in prod unintentionally.
3. Add `serverSelectionTimeoutMS=5000`, `retryWrites=True` to the Mongo client (already on by default in modern motor but be explicit).

---

## 9. Deploy posture — **WARN**

**`backend/render.yaml`:**
```yaml
services:
  - type: web
    name: amo-cartagena-api
    runtime: python
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn server:app --host 0.0.0.0 --port $PORT
    envVars:
      - key: PYTHON_VERSION
        value: "3.12"
```
Looks correct. Missing: no env var declarations for `MONGO_URL`, `DB_NAME`, secrets — those must be set in Render dashboard manually. Worth adding `sync: false` placeholders to document them.

**`backend/runtime.txt`:** `python-3.12.7` — fine, matches `render.yaml`.

**`backend/vercel.json`:** Still present. Routes everything to `api/index.py` (the FastAPI shim). Since the plan is Render-only for backend, this file is **stale and confusing** — leaving it means a future deploy from this directory to Vercel still works and could create a split-brain.

**`frontend/.env`:** I can't read it (permission denied), but `EXPO_PUBLIC_BACKEND_URL` is the only var the prod build reads. Whatever URL is baked in **right now** is hardcoded into the 2.5 MB `dist/...entry.js` bundle on Vercel. Rebuild + redeploy required to change it.

**`frontend/dist/.env.local`:** present in the build output. Suspicious — shouldn't be inside `dist/`.

**Verdict:** WARN. Render config works for happy path but is undocumented re: required env vars. Vercel-for-backend leftovers risk a misfire.

**Fix:**
1. Delete `backend/vercel.json`, `backend/api/`, `backend/requirements-vercel.txt`, `backend/requirements.txt.bak`, `backend/.vercel/` once Render goes live.
2. Add the full env var list to `render.yaml` with `sync: false` (forces you to fill them in Render UI, fails build if missing).
3. Run `cat frontend/.env` and confirm `EXPO_PUBLIC_BACKEND_URL` points at the new Render URL before the next frontend build.
4. Add `dist/` to `.gitignore` (already there) and delete `dist/.env.local` from the working tree.

---

## 10. Anti-patterns — **WARN**

**a) `catch {}` (silent error swallow):**
- `grep "catch\s*\{"` in `frontend/app` → **43 occurrences across 22 files**. Most just suppress and continue. Examples:
  - `frontend/app/login.tsx:51`, `:81`, `:110` — three silent catches in the auth flow.
  - `frontend/app/(tabs)/index.tsx:103`, `:153` — home screen failures invisible.
  - `frontend/app/business/reservations.tsx` — 3 silent catches in the partner reservation flow.
  - `frontend/app/(tabs)/perfil.tsx:42`: `} catch (e) { /* silent */ }` — explicitly silenced with a comment.
- This is the pattern the user already flagged ("we just removed one"). 42 more to go.

**b) `console.log` in frontend:** **97 occurrences in 39 files** (counted across `frontend/src` and `frontend/app`). Per CLAUDE.md: "Never use `console.log` in production (use `console.error` for errors)." All 97 need a sweep.

**c) `TODO` / `FIXME` / `XXX`:**
- Real code TODOs: **only 2**, both legit:
  - `backend/server.py:2934`: `"status": "paid",  # TODO: set 'pending' once payment provider is wired` — this means **payment status is being lied about**. Reservations marked paid before payment confirms. Bigger deal than its line count suggests.
  - `frontend/app/business/profile-edit.tsx:165` — placeholder text, not a code TODO.
- Comments/markdown: a few TODO mentions in store listing text and elsewhere. Negligible.

**d) `any` types in frontend TypeScript:**
- `:any` or `<any>` → 97 occurrences across 39 files. Per CLAUDE.md "No `any` types" rule, this is everywhere. Concentrated in: `app/admin.tsx` (5), `app/search.tsx` (7), `app/business/stats.tsx` (5), `app/business/event-form.tsx` (4), `app/transport.tsx` (4), `src/components/AlcaldiaDashboard.tsx` (11).

**Verdict:** WARN for typing & console.log (cosmetic / quality), CRITICAL for the `# TODO: set 'pending'` payment lie.

**Fix:**
1. **server.py:2934** — actually wire payment status to Wompi webhook before taking real money. Until then, any reservation that goes through this code path is recorded as paid regardless of whether Wompi succeeded.
2. Silent catches: at minimum, change to `} catch (e) { console.error('[ContextName]', e); }`. Even better, surface user-visible errors per CLAUDE.md "Never silent failures."
3. `console.log` sweep + `any` sweep: pin as tech-debt, not a deploy blocker.

---

## Top 10 Blockers (ordered: highest priority first)

| # | Severity | Item | Where | Why it blocks prod |
|---|---|---|---|---|
| 1 | **CRITICAL** | `seed_database()` deletes seasons/events/partner_events on every startup | `backend/server.py:3699-3703` (called from `:4071`) | Render restarts wipe live data. Partners lose edits. Demo data overwrites real bookings. |
| 2 | **CRITICAL** | No error tracking (no Sentry, no Datadog, nothing) | Whole repo | Production crashes are invisible. Paying-customer bugs only surface via complaint. |
| 3 | **CRITICAL** | CORS misconfigured: `allow_credentials=True` + `allow_origins=["*"]` | `backend/server.py:4055-4061` | Browsers reject the combination → known mobile Safari breakage. Also lazy security posture. |
| 4 | **CRITICAL** | Auth leak: admin endpoints return data with no auth (carried over from Layer 2) | `GET /admin/users`, `GET /admin/moderation/*` | Anyone on the internet can list every user. Not new in this audit — already flagged in `layer2_summary.md`. Still unfixed. |
| 5 | **CRITICAL** | Payment status hardcoded to `"paid"` before Wompi confirms | `backend/server.py:2934` | Reservations marked paid even if payment never settles. Revenue leak + customer confusion. |
| 6 | **HIGH** | `emergentintegrations` imported but not in `requirements.txt` | 7 backend files | Every AI feature (concierge, moderation, itinerary, search, image moderation) silently fails on Render. App "works" but loses its differentiator. |
| 7 | **HIGH** | Hardcoded fallback admin/alcaldia passwords + JWT secret | `admin_operator.py:39-40`, `server.py:5365`, `:5382` | If env vars aren't set on Render, anyone can mint admin tokens (`"change-me-in-prod-please"`) or log in as Alcaldía with the public default. |
| 8 | **HIGH** | No `.env.example`, no env-var assertion at boot | repo-wide | Easy to deploy with missing vars → silent fallback to insecure defaults (see #7) or crash on first request (`MONGO_URL`). |
| 9 | **MEDIUM** | TypeScript build fails: `IMAGES.aerial` typo | `frontend/app/(tabs)/index.tsx:375` | One Beach Clubs card renders broken. Strict-CI deploy would fail. |
| 10 | **MEDIUM** | Stale Vercel-for-backend config + 43 silent `catch {}` blocks + 97 `console.log` + 97 `:any` | `backend/vercel.json`, `frontend/app/**/*.tsx` | Split-brain deploy risk; debuggability black hole; violates CLAUDE.md standards. |

---

## Summary

- **Total CRITICAL:** 5 (items #1–#5)
- **Total HIGH:** 3 (items #6–#8)
- **Total MEDIUM:** 2 (items #9–#10)
- **Total WARN (per-section verdicts):** 7
- **Total PASS:** 1 (Python imports)

**Bottom line:** the app is functional on a happy path but is not ready to accept paying customers reliably. The three things that MUST land before the Render cutover are:
1. Make the seeder idempotent (data-loss bomb).
2. Wire Sentry on both ends (errors invisible today).
3. Fix CORS to explicit origins and remove the credentials/wildcard conflict (mobile Safari + security).

Everything else can ship as a fast-follow within the first week of live traffic.
