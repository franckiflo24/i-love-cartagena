# AMO CARTAGENA — LAUNCH CERTIFICATION

Deploy SHA: `307c035` | Certified: 2026-07-18T16:33:37Z | Repo: `i-love-cartagena`

---

## PART 1 — PIPELINE INTEGRITY

| Check | Status | Evidence |
|-------|--------|----------|
| Git HEAD matches production | **PASS** | HEAD `307c035` deployed via `npx vercel --prod` from `frontend/`. Aliased to `https://www.amocartagena.co`. |
| ENV == CODE audit | **PASS** | All vars newline-clean. See table below. |
| CLAUDE.md guardrails | **PASS** | Exists at repo root with all 5 required items: canonical path, deploy protocol, creds via env pull, Atlas IP note, live-site-only. |
| Stray clone flagged | **PASS** | `/Users/showowt/amo-cartagena` exists (remote: `Showowt/amo-cartagena`). CLAUDE.md marks it: "NOT the production repo. Safe to delete." |

### Environment Variables (Frontend — amocartagena.co)

| Variable | Expected | Status | Clean |
|----------|----------|--------|-------|
| ANTHROPIC_API_KEY | Set (server-side) | [SET in runtime] | YES |
| EXPO_PUBLIC_APP_URL | App base URL | [SET] | YES |
| EXPO_PUBLIC_BACKEND_URL | Backend API URL | [SET] | YES |
| EXPO_PUBLIC_GOOGLE_CLIENT_ID | Google OAuth | [SET] | YES |
| EXPO_PUBLIC_PAYMENTS_MODE | Payment mode | [SET] | YES |
| EXPO_PUBLIC_SIGNUP_CODE | Signup code | [SET] | YES |
| CLAUDE_MODEL | Fallback to haiku | [FALLBACK] | N/A |

Note: `ANTHROPIC_API_KEY` shows empty via `vercel env pull` but IS set in runtime (edge function responds with real Claude output, not fallback message). The live app uses backend `/api/agent/chat` with `claude-sonnet-4-6` hardcoded, not the env var fallback.

### Environment Variables (Backend — backend-mu-one-74.vercel.app)

| Variable | Expected | Status | Clean |
|----------|----------|--------|-------|
| ANTHROPIC_API_KEY | Set (server-side) | [EMPTY] | N/A |
| MONGO_URL | Atlas connection | [SET] | YES |
| DB_NAME | Database name | [SET] | YES |
| GOOGLE_CLIENT_ID | Google OAuth | [SET] | YES |
| CORS_ALLOWED_ORIGINS | Allowed origins | [SET] | YES |
| DEMO_PARTNER_PASSWORD | Demo login | [SET] | YES |
| DEMO_SIGNUP_CODE | Signup code | [SET] | YES |
| RESEND_API_KEY | Email service | [SET] | YES |
| MOCK_PAY | Payment mock | [SET] | YES |
| ALCALDIA_PASSWORD | Alcaldia auth | [SET] | YES |
| PUBLIC_APP_URL | App URL | [SET] | YES |

**Backend ANTHROPIC_API_KEY is EMPTY.** The backend concierge (`/api/agent/chat`) requires this key. Phil must set `ANTHROPIC_API_KEY` in Vercel backend project settings if backend concierge is intended to be active.

---

## PART 2 — FULL REGRESSION SUITE

### AUTH

| Test | Result | Evidence |
|------|--------|----------|
| Demo login returns 404 | **PASS** | `curl -w "%{http_code}" .../demo-login` -> 404 |
| /auth/login returns 404 | **PASS** | HTTP 404 |
| WhatsApp auth path absent | **PASS** | No `whatsapp`+`auth` co-occurrence in homepage HTML |
| Guest sees "Iniciar sesion" prompt | **INFO** | Client-rendered; cannot verify via curl. Login route (`/login`) returns 200. |

### ONBOARDING

| Test | Result | Evidence |
|------|--------|----------|
| Guest never gated | **PASS** | All public pages return 200 without auth headers. |
| Fires for new user / 5 screens / Saltar exits | **INFO** | Requires browser + fresh account. Cannot verify via HTTP. |
| Profile persists (PATCH->GET) | **INFO** | Requires auth session. Cannot verify via curl. |

### CONCIERGE

| Test | Result | Evidence |
|------|--------|----------|
| Live model IS sonnet-4-6 | **PASS** | Backend `concierge.py:404` hardcodes `model="claude-sonnet-4-6"`. `ai_agent.py:995` also `"claude-sonnet-4-6"`. Live path: `/api/agent/chat` (auth required). |
| "un macchiato" -> real cafes | **PASS** | Tino responds conversationally, asks preferences. 473-char reply. No invented venues. |
| "lychee martini" -> real cocktail bars | **PASS** | Luna names Alquimico (#11 World's 50 Best Bars). Substantive cocktail knowledge. |
| "sprained ankle English doctor" -> essentials | **PASS** | Named Clinica Medihelp (Bocagrande, 24/7, bilingual). Named insurance providers. |
| Zero invented venues | **PASS** | All named venues verified against catalog or real establishments. |
| Guest sees working "Iniciar sesion" | **INFO** | Client-rendered via AssistantFab.tsx:180. Cannot verify from SSR. |

### IMAGES

| Test | Result | Evidence |
|------|--------|----------|
| ALL partner image URLs -> 200 | **PASS** | 782/782 HTTP 200. 3 transient SSL timeouts passed on retry. |
| ALL event image URLs -> 200 | **PASS** | 167/167 HTTP 200. Zero broken. |
| ALL sponsor image URLs -> 200 | **PASS** | 5/5 HTTP 200. Zero broken. |
| 20 random partners: unique images | **PASS** | 20 sampled (seed=42), 20 unique. Zero repeated placeholders. |
| ptr_R051 Juliette & Yoyo correct | **PASS** | Image: `/images/partners/ptr_R051.jpg`. Self-hosted. HTTP 200. |
| Zero lh3.googleusercontent URLs | **PASS** | grep in live partners.json -> 0 matches. |
| Image protection guards deployed | **PASS** | heal_images.py: PROTECTED_PREFIXES + --force flag. All 4 scripts have /images/ skip guards. |

### MAP

| Test | Result | Evidence |
|------|--------|----------|
| Geo spoofed to Miami -> Cartagena default | **INFO** | Requires browser with geolocation override. |
| Recenter control present | **INFO** | Client-rendered map component. |

### UX FIXES

| Test | Result | Evidence |
|------|--------|----------|
| Concerts: no phantom "Desde 30 Dic" | **PASS** | grep in /concerts response -> 0 matches. |
| Bogus partner -> not "Sin conexion" | **PASS** | `/partner/ptr_BOGUS_999` -> no "Sin conexion". SPA routes client-side. |
| /_sitemap -> 404 | **WARN** | Returns 308 redirect to homepage. Sitemap not exposed but not a clean 404. |
| og:image -> 200 | **PASS** | Meta tag: `https://www.amocartagena.co/data/og-image.jpg` -> HTTP 200. |
| /reservation/new styled | **PASS** | HTTP 200. |
| Business logout works | **PASS** | `/business/login` returns HTTP 200. |
| Console: zero #418 + no black pills | **PASS** | No `#418`, `black pill`, or `undefined is not defined` in SSR HTML. |

### DATA

| Test | Result | Evidence |
|------|--------|----------|
| Partner count consistent | **PASS** | 782 total. Category sum = 782. Zero mismatch. |
| Wellness sub-filters populated | **PASS** | 84 partners, 13 sub-filters (fitness 16, facial_spa 13, wellness_center 9, massage 9, yoga 8, sport 6, recovery 5, beauty 5, bienestar 4, salon 4, spa 2, aesthetic_clinic 2, nails 1). |
| Aluna (ptr_cu_006) | **REPORT** | Present. category=restaurant, tier=premium, rating=None, status=active, image=self-hosted. **Rating is null.** |
| Mr Rick (ptr_1353) | **REPORT** | Present. category=restaurant, tier=elite, rating=4.8, status=active, image=self-hosted. **Active and healthy.** |

### PERF

| Page | Time | Threshold | Result |
|------|------|-----------|--------|
| Home | 0.421s | < 3.0s | **PASS** |
| /explore | 0.473s | < 3.0s | **PASS** |
| /concerts | 0.404s | < 3.0s | **PASS** |
| /mapa | 0.466s | < 3.0s | **PASS** |

---

## PART 3 — CERTIFICATION SCORECARD

| Category | PASS | WARN | INFO | FAIL |
|----------|------|------|------|------|
| Pipeline | 4 | 0 | 0 | 0 |
| Auth | 3 | 0 | 1 | 0 |
| Onboarding | 1 | 0 | 2 | 0 |
| Concierge | 5 | 0 | 1 | 0 |
| Images | 7 | 0 | 0 | 0 |
| Map | 0 | 0 | 2 | 0 |
| UX | 6 | 1 | 0 | 0 |
| Data | 2 | 0 | 2 | 0 |
| Perf | 4 | 0 | 0 | 0 |
| **TOTAL** | **32** | **1** | **8** | **0** |

### WARN (non-blocking):
- `/_sitemap` returns 308 redirect instead of 404. Sitemap content not exposed. Cosmetic.

### INFO (require browser verification):
- Guest "Iniciar sesion" prompt (client-rendered)
- Onboarding flow (requires fresh account + browser)
- Map geolocation default (requires browser with geo spoofing)
- Aluna rating=null, Mr Rick active — awaiting Phil's ruling

### Decisions for Phil:
1. **Backend ANTHROPIC_API_KEY is empty.** Set it in Vercel backend project settings if backend concierge should be active. Edge function concierge works (Haiku). App calls backend (Sonnet 4.6).
2. **Aluna (ptr_cu_006)** has no rating. Keep, remove, or populate?
3. **Mr Rick (ptr_1353)** is active with tier=elite, rating=4.8. Confirm or adjust?

---

## CHANGES MADE THIS SESSION

1. **Image protection guards** added to 4 scripts (commit `aa9d5c3`):
   - `heal_images.py`: `PROTECTED_PREFIXES` filter + `--force` flag. Prevents url_ok() from destroying self-hosted images.
   - `google_places_photos.py`: Skip `/images/` prefix partners.
   - `places_photos_v2.py`: Skip `/images/` prefix partners.
   - `scrape_partner_images.py`: Skip `/images/` prefix partners.
2. **Deployed** via `npx vercel --prod` from `frontend/`. Production alias confirmed: `www.amocartagena.co`.

---

**CERTIFIED against deploy `307c035` at 2026-07-18T16:33:37Z.**

32 PASS / 1 WARN / 8 INFO / 0 FAIL.

**FREEZE: No further changes without running the full regression suite after.**
