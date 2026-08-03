# AMO Cartagena — Project Context

## Canonical Repo
- **Path**: `/Users/showowt/i-love-cartagena`
- **Remote**: `https://github.com/franckiflo24/i-love-cartagena.git`
- **Stray clone**: `/Users/showowt/amo-cartagena` (remote: `Showowt/amo-cartagena`) — NOT the production repo. Safe to delete.

## Deploy
- **Frontend** (amocartagena.co): `cd frontend && npx vercel --prod`
- **Backend** (backend-mu-one-74.vercel.app): `cd backend && npx vercel --prod`
- **`git push` does NOT auto-deploy.** The Vercel projects are `frontend` and `backend`, linked via `.vercel/project.json`, not via GitHub integration.
- After every push, you MUST run `npx vercel --prod` from the correct subdirectory.
- **MANDATORY after every deploy: `node scripts/verify-images.mjs`** — HEAD-checks every live partner/event image; non-zero exit = broken images on prod.
- **Stale-client cache-bust is AUTOMATIC since Aug 3 2026**: `app/+html.tsx` stamps `APP_VERSION` at build time and `scripts/stamp-sw.mjs` (wired into `buildCommand`) stamps `dist/sw.js`. Returning devices hard-reload once per deploy. NEVER hardcode a version again — the 3.1.0 era required a manual bump per deploy; five deploys shipped without one and returning users (including Phil) stayed on the old bundle while fresh browsers saw the new one.
- **`vercel --prod` can FAIL while printing a Production URL.** Always confirm with `npx vercel inspect www.amocartagena.co` that the alias moved to the new deployment (an Error build leaves the previous deploy serving silently).

## Credentials
- Pull from Vercel: `cd frontend && npx vercel env pull .env.production --environment production --yes`
- Backend env: `cd backend && npx vercel env pull .env.production --environment production --yes`
- Never ask the user for credentials. Never print secrets.

## MongoDB Atlas
- Connection string is in `backend/.env` and Vercel env vars (`MONGO_URL`).
- **IP whitelist**: The Atlas cluster (`cluster0.i4uvhfv.mongodb.net`) requires IP whitelisting. Local pymongo connections will fail with SSL handshake errors if your IP isn't whitelisted. Use the backend API (`https://backend-mu-one-74.vercel.app/api/...`) instead.
- Database: `amo_cartagena`, primary collection: `partners`

## Architecture
- **Frontend**: Expo Router (React Native Web), static export, deployed to Vercel
- **Backend**: FastAPI (Python), deployed to Vercel as serverless functions
- **Data flow**: Frontend reads from `/data/*.json` (static files) first, then hydrates from backend API
- **Images**: Self-hosted in `public/images/` (partners + events). Unsplash for placeholders. Zero Google API dependency.
- **Concierge**: Two implementations exist:
  - `/api/concierge` (edge function, Haiku, no auth) — orphan, nothing calls it
  - `/api/agent/chat` (backend, Sonnet 4.6, auth required) — the LIVE path

## Key Patterns
- SafeImage component (`src/components/SafeImage.tsx`): 4-stage fallback chain for all images. Use it everywhere — never use raw `<Image>`.
- `tr()` / `s()` for all user-facing strings (ES/EN/FR/PT).
- Static-first data loading: paint from `/data/*.json`, then hydrate from backend.
