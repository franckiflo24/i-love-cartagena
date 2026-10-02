# Cloud drop handoff — 2026-10-01 (audit P0s + P1 quick wins)

Base: `c7c5a2b6` (P0: /auth/signup per-email bucket). Branch: `main`.
Everything below is **committed, pushed to origin/main, deployed to production
and verified** (backend `backend-mu-one-74.vercel.app`, frontend
`www.amocartagena.co`). Nothing in this drop touched `frontend/app.json`,
`store-assets/`, the App Store 1.1.3 submission, the review accounts,
`backend/maintenance.py`, or the four stop-the-bleed commits shipped earlier today.

## Commits (in order)

| Key | Commit | Files | Test file (count) |
|---|---|---|---|
| P0-A | `1004046b` | backend/server.py, backend/partner_visibility.py, backend/admin_operator.py, frontend/app/business/event-form.tsx, frontend/app/business/dashboard.tsx | tests/test_partner_event_visibility.py (23) |
| P0-B | `3df79cf2` | backend/partner_events_sweep.py (new), backend/server.py, backend/events_elite.py, backend/vercel.json | tests/test_partner_events_sweep.py (17); tests/test_events_routes.py cron guard 6→7 |
| P0-C | `00820b49` | frontend/app/business/admin/queue.tsx, frontend/app/admin/moderation.tsx, frontend/app/admin.tsx | tests/test_admin_queue_fail_loud.py (3, cross-tree source guards) |
| P1-1 | `5279cc4e` | backend/server.py (`_csv_escape`) | tests/test_csv_escape.py (9) |
| P1-2 | `04fd1a1d` | backend/qr_credential.py, backend/civic_demo.py | tests/test_qr_token_shape.py (12) |
| P1-3 | `1af741a4` | backend/server.py, backend/reservations.py, backend/reviews.py, backend/admin_operator.py, backend/ratelimit.py | tests/test_rate_limits_p1.py (8) |
| P1-4 | `5a7f8e4b` | backend/blob_storage.py, backend/partner_claims.py | tests/test_blob_host_check.py (23) |
| P1-5 | `1fc2c0e3` | backend/server.py (`_normalize_event_media`), backend/partner_visibility.py, frontend/src/components/PartnerEventCard.tsx | tests/test_event_media_and_projection.py (6) |

## Tests

- `cd backend && python3 -m pytest -q` → **32 failed, 1246 passed** (baseline before
  the drop: 32 failed, 1143 passed). The 32 are the pre-existing environmental set:
  `tests/test_api_endpoints.py` (13) + `tests/test_admin_operator_onboarding.py` (19)
  hit a dead preview URL (404) / `localhost:27017` (connection refused). No test
  imports `server.py`; the new tests exec handler slices against the in-memory
  StubDB (`tests/events_service_stubs.py`) with `ai_moderation` / `telegram_alerts`
  / `server` faked in `sys.modules` where needed.
- `cd frontend && npx tsc --noEmit` → 0 errors after every frontend commit.
- Full `frontend/vercel.json` buildCommand run locally for P0-C (sync-cmw-data,
  sync-lenses-data, `expo export --platform web`, check-no-legacy-events, 404 copy,
  stamp-sw) → OK.

## Deploys (both phases)

Backend: `dpl_9fWpk8UWaYgHAQtwba1zxLSdnRRF` (after Phase 1) then
`dpl_J9PvzqLoFxccDNURutaDkqed9X67` (after Phase 2); alias
`backend-mu-one-74.vercel.app` moved both times (`npx vercel inspect` Ready);
`/api/health` 200; `/api/cron/partner-events/sweep` without the secret → 403;
`/api/partner-events?upcoming=true` → 200, no internal fields in the payload,
the live event's vendor Blob flyer now resolves as `image_url`.

Frontend: `dpl_33kpYoZ2phuh9xrjNRosDG5wsvzm` then `dpl_6dQoeGQJAQf8dQKnyfy2oX19czQj`;
alias `www.amocartagena.co` moved both times; `/`, `/tickets`, `/business/scanner`,
`/gobierno`, `/admin`, `/admin/moderation`, `/business/admin/queue`,
`/business/dashboard` → 200; `node scripts/verify-images.mjs` → IMAGES OK 856/856
after each deploy.

Redeploy recipe (logged-in machine, repo root):

```sh
git pull origin main
cd backend  && npx vercel link --yes --scope showowts-projects --project backend  && npx vercel --prod --yes
npx vercel inspect backend-mu-one-74.vercel.app          # status Ready, url = the new deployment
curl -s https://backend-mu-one-74.vercel.app/api/health
cd ../frontend && npx vercel link --yes --scope showowts-projects --project frontend && npx vercel --prod --yes
npx vercel inspect www.amocartagena.co
for p in / /tickets /business/scanner /gobierno; do curl -s -o /dev/null -w "$p %{http_code}\n" https://www.amocartagena.co$p; done
node scripts/verify-images.mjs                            # non-zero exit = broken images
```

`vercel link` writes a `.env.local` with development env values into each
directory — gitignored (`.env.*`), never commit or print it.

## What changed, operationally

### P0-A — reach truth
- `POST/PUT /business/events` responses now carry `public_visible: bool` and
  `visibility_blocker: str|null` (`venue_not_public | venue_suspended |
  venue_pending_review | venue_rejected | venue_sandbox | venue_needs_verification |
  event_pending_moderation | event_rejected | event_unpublished`). Response-only;
  never stored on the doc.
- `_require_content_owner` now 403s a venue with `status: "suspended"`.
- `GET /business/onboarding-status` `is_public` now mirrors `PUBLIC_PARTNER_FILTER`
  (it previously returned `bool(partner.is_public)`, which was False for the ~422
  editorial venues that have no `is_public` field — they ARE public). New field
  `visibility_blocker`. The dashboard banner is wired to this endpoint again.

### P0-B — dead-letter sweep
- New cron `GET|POST /api/cron/partner-events/sweep` (Bearer `CRON_SECRET`), scheduled
  `*/30 * * * *` in `backend/vercel.json`. Vercel invokes cron paths with **GET** and
  sends `Authorization: Bearer $CRON_SECRET` automatically — the route accepts both
  methods. The project already runs `*/10` and `*/15` crons, so sub-daily schedules
  are allowed on this plan.
- Expires pending events whose last day (`date_end`, else `date`) is before today
  (Bogotá) → `moderation_status: "expired_unreviewed"` + `expired_unreviewed_at`.
  **Never deletes.** Those rows are still visible to the owner in `/business/events`
  and no longer count as pending anywhere.
- Alerts once the oldest live pending event is > 2 h old; at most once per 6 h,
  slot stored in `cron_state` `{_id: "partner_events_sweep", last_alert_at}`.
  If Telegram reports no delivery the slot is released so the next tick retries.
- Dry run: `curl -H "Authorization: Bearer $CRON_SECRET" "https://backend-mu-one-74.vercel.app/api/cron/partner-events/sweep?dry=1"`
  → counts only (`would_expire`, `pending_live`, `oldest_age_h`, `alert_due`).
- Daily digest (`events_elite._send_digest`) gained the line
  "Eventos de partners pendientes de revisión: N · el más antiguo lleva X h".
- Submit-time Telegram/email now say "Moderación IA NO DISPONIBLE — evento en cola
  SIN revisar" when `ai_moderation` fell back (`issues: ["llm_unavailable"]`), and a
  send whose result has `sent == 0` logs `[AutoVerify] … NOT delivered`.
- **Not run against prod data by me** (no DB access from this environment). The
  first scheduled tick will expire whatever is already past-dated and pending.
  To preview first: run the `?dry=1` call above.

### P0-C — admin queues fail loud
- `/business/admin/queue`, `/admin/moderation`: a failed fetch shows the red banner
  "No se pudo cargar la cola. Esto NO significa que esté vacía." with Reintentar,
  keeps the last good data, and the "nothing pending" states render only after an
  error-free load. `/admin` keeps the moderation badge's last count and shows an
  amber "!" when the stats refresh failed.

### P1
- CSV exports prefix `'` to cells starting with `= + - @ \t \r`.
- QR wire tokens must be `^[0-9a-f]{12}$` at parse time; civic verdicts go through
  `qr_credential.verify` (cross-runtime vector `5d22f5379637` unchanged).
- New rate-limit prefixes: `bizsignup` (5/3600 per IP, fails closed), `bizactivate`
  (10/900 per IP, fails closed), `resvcreate` (20/3600 per user), `reviewreport`
  (10/3600 per user). `reservations.init` / `reviews.init` take
  `check_rate_limit=` (optional).
- Blob URL trust is host-exact: `https` + host ending `.public.blob.vercel-storage.com`.
- `_normalize_event_media` and `PartnerEventCard.partnerEventImage` treat our Blob
  host as self-hosted; `INTERNAL_EVENT_FIELDS` now also strips `moderation_verdict`,
  `moderation_issues`, `moderation_score`, `original_category`, `moderated_by_admin`,
  `moderated_at`, `rejection_reason`, `views_count`, `reserve_clicks`.

## Human-blocked items (nothing in code can do these)

1. **Franck must make the GitHub repo private** — the Showowt account has push but
   not admin on `franckiflo24/i-love-cartagena`.
2. **Phil rotates `DEMO_PARTNER_PASSWORD` in Vercel (backend project), then
   redeploys the backend** (recipe above). Env vars were not changed in this drop.
3. **Sergio's Telegram chat id must be added to `TELEGRAM_ALERT_CHAT_IDS`** (comma
   separated, backend project env) so the sweep alerts and the digest reach him;
   redeploy the backend after.
4. Optional first-run preview of the sweep against prod: the `?dry=1` call under
   P0-B (needs `CRON_SECRET`).

## Not done / skipped

- No P1 item was skipped. No backend behaviour was verified against prod data
  (no Atlas access); everything is proven by tests + the live route smoke checks
  listed above.
- `event-form.tsx` has no `tr()` usage, so the new copy is ES-only per the brief
  (no i18n infrastructure added).
