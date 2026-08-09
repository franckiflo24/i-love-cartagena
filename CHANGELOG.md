# CHANGELOG

## 2026-08-09 — Launch-Readiness Adversarial Audit + Gap Closure (Round 1)

Six-pass fresh-session adversarial audit (dead-end walk, state grid, failure
injection, security/honesty/leak, payments, launch polish) → severity-ordered
closure with pasted proof + Constitution battery every 5 closures.

### Findings by severity (originating audit)
- **P0: 5** (4 active + 1 dormant) · **P1: ~13** · **P2: ~10** · **P3: ~10**
- P0/P1 share ≈ 47% of findings → a **second full adversarial audit is mandatory**
  (in progress) before SHIP, per the closure protocol.

### CLOSED — P0 (verified on live prod)
- **F-SEC-2/3/4** — 3 unauthenticated wildcard-CORS LLM proxies (`frontend/api/{concierge,itinerary,ai-search}`) held `ANTHROPIC_API_KEY`, burnable by anyone. DELETED. PROOF: `POST /api/{concierge,itinerary,ai-search}` → **404** (were 200).
- **F-SEC-1** — 845/895 prod partners showed fabricated `4.8★ (N reviews)` with no backing reviews. Unset on prod (backed up), recomputed 3 real ratings from `db.reviews`, stripped static `partners.json`. PROOF: live static partners rating>0 **0/894**; `/reviews/partner/ptr_yt_001` aggregate `4.8/320` → **null**.

### CLOSED — P1
- **F-SEC-5** — `/admin/batch-update` gated on the PUBLIC signup code → dedicated admin secret, constant-time, rate-limited. PROOF: wrong secret → **403** (reachable, not 500).
- **F-SEC-6** — master admin login had no throttle → 8/15min per IP, constant-time, fail-closed `adminlogin` SENSITIVE_PREFIX.
- **F-FAIL-3** — Anthropic client had no timeout (600s vs 60s Vercel ceiling → Luna/pulse 504) → `timeout=20, max_retries=1`.
- **F-DEAD-1** — bookings port-tax row pushed nonexistent `/port-tax` (bounced Home) → `/port-tax/tickets`.
- **F-DEAD-2** — Rewards "Redeem" was a stub → routes to `/rewards/offers` (real redemption).
- **F-STATE-1** — `viaje/[id]` crashed the WHOLE app on a `[]`/bad trip payload → shape guard.
- **F-PAY-1/2** — City-Pass + Experience paid CTAs dead-ended in a dev message to tourists (Wompi off) → honest "Próximamente" + experience gated on `checkWompiEnabled`.
- **F-PAY-3** — `MOCK_PAY=1` was set in PROD, arming free-ticket minting on 2 auth-only endpoints → hard-disabled in prod via `VERCEL_ENV`.
- **F-POLISH-1** — mandatory `verify-images.mjs` crashed when run from `frontend/` as documented → canonical `frontend/scripts/` copy (5-file coverage) + root shim. PROOF: `cd frontend && node scripts/verify-images.mjs` → **IMAGES OK 1023/1023**.
- **F-POLISH-3** — i18n gaps on core conversion screens (home CTA, search Luna gate, mapa permission, explore header) → wrapped + ~14 ES/EN/FR/PT dict entries.

### CLOSED — P2
- **F-SEC-7** — `GET /agent/session/{id}` leaked null-owner sessions to any caller → require auth + strict ownership.
- **Mongo timeout** — `serverSelectionTimeoutMS=5000` (was 30s).
- **`[]`-truthy not-found bypass** — citypass tab fake "PASS ACTIVO" QR; `event/[id]`, `partner-event/[id]`, `experience/[id]`, `viaje/shared` blank pages → shape guards.

### ACCEPTED (documented risk)
- **F-POLISH-2** — external Unsplash images are decorative placeholders rendered via SafeImage (CLAUDE.md permits "Unsplash for placeholders"), all 200, now gate-monitored.
- **F-FAIL-4** — STATIC_MODE fake-writes: latent (prod ships non-static; critical pulse path r.ok-guarded).
- **P3s**: `eventos`/`admin`/`intel` orphan routes (internal/intentional); support email `@amocartagena.app` vs `.co` domain (verify mailbox); admin non-admin infinite spinner; PWA maskable icon + `twitter:image` + screenshots; `complete-profile` orphan modal; manual-`.get()` vs Pydantic on some writes.

### DEFERRED — pre-Wompi-enable (dormant while Wompi off in prod)
- **F-FAIL-1 (P0-class)** — payment marked `approved` before fulfillment; a swallowed fulfillment error is then blocked from retry → charged-but-no-ticket. Cannot fire (Wompi unconfigured). **Fix required before enabling Wompi**: mark approved only after fulfillment succeeds (or a `fulfilled` flag) + a sweeper.
- **Double-fulfillment race** — non-atomic idempotency guard → duplicate tickets. Same dormancy; fix with a compare-and-set before Wompi goes live.

### Owner action items (env — outside code)
- Unset/`0` `MOCK_PAY` in prod backend env (code now neuters it, but clean it up).
- `enrich_partners.py` ops script: set its `BATCH_SECRET` to `ADMIN_OPERATOR_PASSWORD`.
- Confirm the `@amocartagena.app` support/privacy mailbox receives mail.

## 2026-08-09 — Round 2 (mandatory second adversarial audit — siblings + regression)

Triggered because >20% of round-1 findings were P0/P1. 3 fresh agents. Round-1 fixes
confirmed LIVE + non-regressed (52/52 routes resolve, 0 leaked `${tr}`, home mounts
0 console errors, tsc 0). New siblings found + closed:

### CLOSED
- **R2-P0#1** — `reviewsStore.ts` fell back to `/data/reviews.json` (796KB of fabricated
  testimonials, `is_verified:true`) for the ~892 partners with 0 real reviews → fake
  reviews + a star aggregate still rendered. Removed the fallback; emptied reviews.json
  to `{}`. `AggregateHeader` returns null at total=0 → honest empty state. (The parallel
  path round-1's number-only fix missed.)
- **R2-P1#4** — 769/806 per-partner static files (`data/partners/*.json`, the fallback
  when a partner 404s / on Atlas blip) still carried fabricated ratings → stripped (0 remain).
- **R2-P1#5** — `port-tax/ticket/[id]` `[]`-truthy bypass → false "ACTIVO" over a broken
  QR at the pier. Shape-guarded.
- **R2-P2#7** — `reservation/new` `[]`-truthy blank form → shape-guarded.
- **R2-auth-P1#1** — `PORT_TAX_AUTO_PAY` free-ticket flag missing the `VERCEL_ENV` guard
  (sibling of MOCK_PAY) → hard-disabled in prod. (Currently UNSET in prod — latent.)
- **R2-auth-P1#2** — `CRON_SECRET` compared non-constant-time; the 3 high-value admin
  routes (unlock-login/ensure-alcaldia/purge, which can un-throttle brute-force) → `hmac.compare_digest`.
- **R2-auth-P2#5** — WhatsApp webhook failed OPEN when `WHATSAPP_APP_SECRET` unset
  (fake-pulse injection) → now fail-closed (503).
- **R2-P0#2** — fabricated `city_passes` generator that inflated the Alcaldía government
  dashboard removed. (0 fabricated rows in prod today — verified — generator was the relapse hazard.)

### ACCEPTED (documented)
- `CRON_SECRET` constant-time on 5 analytics cron routes (demand/tagging/local_signals/
  walking/webpush) — remote timing attack on a cron secret is impractical; hygiene only.
- `session_token` in web localStorage (native uses SecureStore) — pre-existing architecture,
  no stored-XSS found; consider CSP header.
- `experience/[id]` rating render (dormant — reads the now-unset field); `business/claim/[id]`
  unguarded (shows raw id, harmless); `safety_rating` bare render (editorially sourced, not fabricated);
  `catalog.ts`/`catalog-allowlist.ts` orphaned dead code (no build break); itineraries.tsx P3 i18n.

### 🔴 OWNER ACTIONS (env — required, cannot be done in code)
1. **`admin_operator` router is UNMOUNTED in prod** (live probe: `/api/admin/operator/login` → 404)
   because `ADMIN_OPERATOR_PASSWORD` + `ADMIN_TOKEN_SECRET` are UNSET. Consequences:
   `/business/activate` (partner magic-link onboarding) is DEAD, and `/admin/batch-update`
   now safely fail-closes (403). **Set both env vars in the `backend` Vercel prod project
   + redeploy** to restore them. (`enrich_partners.py` ops script: set its `BATCH_SECRET`
   to the same `ADMIN_OPERATOR_PASSWORD`.)
2. **Unset `MOCK_PAY`** in prod (code now neuters it in prod, but clean it up).
3. **Set `WHATSAPP_APP_SECRET`** if using WhatsApp pulse ingestion (webhook now 503s without it — safe).

## 2026-08-09 — Round 3 (convergence audit — deeper siblings + a public-repo leak)

Two convergence agents (honesty+state, security+regression) + a spec-miner. The
regression, honesty-fix, and round-1/2-verification dimensions came back CLEAN (tsc 0,
py_compile 0, live smoke green, 3 LLM proxies 404, batch-update 403, WhatsApp 503,
IDOR fixed). New/deeper findings found + closed:

### CLOSED (code)
- **R3-P0 (honesty)**: fabricated star ratings were ALSO in partner `description` prose
  (170 partners) — stripped from prod DB + static json + per-partner files (0 remain);
  legit claims (Sofitel/PADI/real-Michelin) preserved; Michelin attribution clarified.
- **R3-P1 (my regression)**: viaje/shared guard checked `trip_id` (never returned) →
  broke 100% of share links → now checks share_code/name.
- **R3-P1**: City Pass post-payment reload lacked the []-guard → fake "PASS ACTIVO" →
  guarded (both screens).
- **R3sec-P0**: hardcoded Google API key fallback in backfill_phones_websites.py (public
  repo) → removed (fail-loud on unset). 🔴 KEY MUST BE ROTATED (see owner actions).
- **R3sec-P1**: GET /search ran the paid LLM concierge with NO rate limit → added the
  same 15/60s guard as /agent/chat.
- **R3sec-P1**: deleted leftover POST /auth/session (third-party session minting, 0 callers).
- **R3sec-P2**: rewards redeem TOCTOU double-spend → atomic guarded `$inc` decrement.
- **R3sec-P2**: 5 more CRON_SECRET non-constant-time compares (demand/local_signals/
  tagging/walking/webpush) → hmac.compare_digest.
- **R3-P2**: favorites blank-card + orphan review + citypass reload — all guarded/cleaned.
- **R3sec-P1 (CSRF, partial)**: added X-Requested-With to the api client (defense +
  enables enforcement); full server-side enforcement flagged (see owner actions).

### ACCEPTED / FLAGGED (P2/P3)
- Reservations create has no per-user rate limit (auth-required; bounded) — wire check_rate_limit.
- reviews/{id}/helpful no idempotency/rate-limit (low-stakes social-proof inflation).
- A dev-placeholder backend/.env sat in git history (no real secret) — add a pre-commit secret scanner.
- Dead PaymentSheet in city-pass.tsx; payment provider hardcoded Mock (labeled).

### 🔴 OWNER ACTIONS (cannot be done in code / require your credentials)
1. **ROTATE the leaked Google API key** in Google Cloud immediately (public repo = permanently
   disclosed) + restrict the new key to Places API + referrer/IP allowlist. (Code no longer embeds it.)
2. **Set `ADMIN_OPERATOR_PASSWORD` + `ADMIN_TOKEN_SECRET`** in backend Vercel prod → mounts
   admin_operator (fixes /business/activate) + re-enables /admin/batch-update (currently fail-closed).
3. **Unset `MOCK_PAY`** in prod (code neuters it, but clean it up).
4. **Set `WHATSAPP_APP_SECRET`** if using WhatsApp pulse (webhook now 503s without it).
5. **Delete the stray `deploy-backend` Vercel project** (broken duplicate of the backend, undocumented surface).
6. **Add a pre-commit secret scanner** (gitleaks/git-secrets) — the auto-commit flow bypassed .gitignore once.
7. **Enforce CSRF** server-side (require X-Requested-With on mutating cookie-auth routes; client now sends it)
   + make `/admin/local-picks/refresh` GET cron-secret-only.
8. `enrich_partners.py`: set `BATCH_SECRET` = `ADMIN_OPERATOR_PASSWORD`. Verify `@amocartagena.app` mailbox.

### Deliverable
- **MASTER_SPEC.md** created — reverse-compiled as-built map (11 sections: modules, 82 routes,
  ~258 endpoints, 68 collections, integrations, flows, failure modes, non-functional floor, non-goals).
