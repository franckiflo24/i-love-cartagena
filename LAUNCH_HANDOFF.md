# AMO CARTAGENA — LAUNCH HANDOFF (the 4 tasks + what's left for Phil)
_2026-08-20. Companion to LAUNCH_AUDIT_LEDGER.md (the audit) and APP_STORE_HANDOFF.md (native)._

## 1 · LOAD / SCALE — ✅ done + characterized
- **Ran a 60s / 200-worker burst** against the 5 heaviest read endpoints while sampling Atlas live.
- **Finding**: uncapped Motor pool (default 100/instance) × Vercel fan-out drove connections 118→774 **still climbing** (never plateaued); under a 2nd burst it hit 1336/1500 (89%). 6–8% 500s + p90 11s were **saturation symptoms** — every endpoint is 200/1-2s at rest.
- **Fix (deployed)**: `maxPoolSize=5, minPoolSize=0, maxIdleTimeMS=30000` on the Motor client (server.py:28). Halves the connection ceiling, reaps idle sockets. Verified connections drain after load.
- **Reality**: fine for a soft launch (a Cartagena city guide won't see 200 concurrent day 1). **If you expect a viral spike** (influencer post, press), the real levers are: (a) bump Atlas tier, (b) make `/api/partners` honor `?limit` + a projection server-side (it currently ships all 893 docs every call — the single biggest latency source). Both are scaling projects, not launch-day.

## 2 · OBSERVABILITY — ✅ crash alerting live + hourly uptime monitor running
- **Client-crash beacon (deployed)**: the app's ErrorBoundary now reports every real user crash (message/stack/route/app-version/lang) to `POST /api/client-error` → stored in Mongo `client_errors` → **emails you + Sergio instantly** (storm-braked to 6/hr) → red "App crashes 24h" KPI in Eagle (`/admin/eagle`). You'll now SEE crashes, not hear about them on WhatsApp. _(Verified: synthetic crash stored + endpoint 200, then cleaned.)_
- **Uptime monitor (running)**: a cloud routine "**AMO uptime monitor**" (https://claude.ai/code/routines/trig_01TZF8ymL3u2SGeBwnpfhaJ3) checks the site + backend health + /api/partners **every hour** and emails you if anything fails. Cloud-scheduler minimum is 1 hour.
- **⏳ YOUR 2-MINUTE UPGRADE for sub-hour uptime**: add https://uptimerobot.com (free) — monitor `https://www.amocartagena.co` + `https://backend-mu-one-74.vercel.app/api/health`, 5-min interval, email/SMS/push alert. It's external to both Vercel and Anthropic, so it catches total outages the hourly routine might miss between runs. This is the one genuinely-better uptime tool and it needs your signup.
- **Optional**: Sentry (frontend `@sentry/react-native` + a DSN) for full stack-trace aggregation beyond the email beacon — nice-to-have, not launch-blocking.

## 3 · CONTENT — ✅ app never looks empty; real content is yours
- **Verified**: the home **already falls back to real upcoming events** when "today" is empty, and hides empty promotion rails cleanly — so with 0 promos / 0 upcoming partner-events, the screen is still full (hero, quick-nav, 119 real events, collections, partners). No fabrication (you purged fake data for a reason — I kept the honesty spine).
- **⏳ YOUR real-content checklist for a strong launch week** (only you have the real data):
  - **Events dated Aug 20–27** — there are 119 events but few land *today*; a handful covering this week makes "Qué pasa hoy" sing.
  - **A few promotions** (`/promotions/today` is empty) — the "Ofertas del día" rail is hidden until you add real ones.
  - **A few real reviews** on flagship venues — post-purge every partner shows 0; even 3–5 real ones build trust. (Never fabricate — invite real early users to review.)
  - I can insert any of these via the sanctioned admin path the moment you give me real data.

## 4 · APP STORE — ✅ reject-risk fixed; native track is yours → see APP_STORE_HANDOFF.md
- **Fixed (deployed)**: the "Sign in with Apple" button was mislabeled — it called the Google handler (Guideline 4.8 near-certain rejection). Now gated off (`APPLE_SIGNIN_ENABLED=false`, iOS-only) until real SIWA ships. Google + email login unchanged.
- **⏳ YOURS (documented step-by-step in APP_STORE_HANDOFF.md)**: `eas init` + real Apple Team ID / ASC App ID (placeholders today — I can't invent them), implement real Sign-in-with-Apple (needs an `/auth/apple` backend route too), and decide what City Pass shows a reviewer (its "Próximamente" dead-end is a Guideline 2.1 risk — hide the tab in the first binary or make it explicit "coming soon"). Also flip `supportsTablet` or prepare iPad screenshots.

---
**Bottom line**: all four are handled to the limit of what I can do without your credentials/real-data. The four ⏳ items above are the genuine you-only tasks; none block a soft web launch today.
