# LENSES: demographic lenses + Golden Hour map over the one catalog (design contract v1, 2026-09-30)

If code and this doc disagree, the doc wins until it is amended here first.

## 0. Honesty spine
- A **lens** is a saved filter + attribute set over the EXISTING venue/place catalog — never a new
  content silo. One venue can appear in many lenses. One database, many lenses — not many features.
- Lenses make **trust claims** ("women-verified", "family-safe", "step-free"). A lens that returns a
  near-empty or unverified result is worse than no lens — it fakes a promise. Therefore:
  **a lens does NOT ship to users until it has ≥ `min_fill` HIGH-confidence entries.** Below the
  threshold it appears as "En construcción" (coming soon) and its entries are NOT served publicly.
- Every tag and pin carries `source_url + source_name + last_verified + confidence HIGH|VERIFY`.
  A VERIFY entry never renders as a plain fact: the UI shows **"sin verificar"** and copy hedges.
  No tag is ever guessed. `women_verified.harassment_rating` comes ONLY from in-app women's
  ratings — never scraped, never seeded editorially, so the lens launches empty and gated.
- Luna answers lens questions from tagged data with the source, and **declines honestly** when
  coverage is thin (each lens carries a four-language `decline_line`). Luna never invents a tag.
- Prices and opening hours are NEVER duplicated into lens data. A pin that needs them links to the
  city hub module (e.g. Castillo → `/ciudad/monumentos`), which owns those facts.

## 1. Data — `backend/data/lenses.json` (committed; the base truth)
```
{ version, source_name, field_guide, updated,
  lenses: [ { key, kind: "places"|"venues"|"kit", min_fill, icon, label L4, tagline L4,
              luna: { triggers[], decline_line L4 } } ],
  access_tiers: { free|purchase|reservation|guest_only|paid_entry: L4 },
  pins: [ { id "gh-…", lens, name, venue_id|null, lat?/lng?/geo_precision "exact"|"approx", zone?,
            best_light ⊆ [sunrise,midday,sunset] (non-empty), access_tier (required),
            crowd_hotspot bool, photogenic L4, etiquette L4|null, link?,
            source_url, source_name, last_verified, confidence } ],
  venue_tags: [ { lens, venue_id, attrs{…bool|null}, note L4|null,
                  source_url, source_name, last_verified, confidence } ],
  port_day: { fare_module: "taxis", muelle_module, return_buffer_min,
              crowd: { hotspot_pins[], note L4, source_url, confidence },
              itineraries: [ { id, duration_h, editorial: true, title L4, note L4,
                               stops: [{ pin, minutes }] } ] }
}
```
- L4 = `{es,en,fr,pt}`, tú voice. `venue_id` refs the catalog (`ptr_*`/`attr_*`): coordinates,
  image and the `/partner/<id>` link resolve FROM the catalog at read/sync time and are never
  copied into this file. A pin without `venue_id` carries its own coords with `geo_precision`
  ("approx" = editorial street placement, shown as "ubicación aproximada").
- **F5 corrections are law**: no "Café del Mar" (→ Baluarte de la Gente), no Interno; Candé stays;
  Mvngata/Mangata, Gozne, Btexia, Eléctrica, Moni, Pergamino, Café Sofía, Coralina are HOLD —
  absent until verified. Tests enforce this.
- Lens attribute vocabularies (fixed keys, all optional, `null` = unknown, never guessed):
  - `women_verified`: harassment_rating (in-app only), staff_responsive, safe_ride_from, well_lit,
    women_only_event.
  - `family`: calm_water_beach, lifeguard, shade, high_chairs, kids_menu, stroller_feasible_route,
    child_life_jacket, car_seat_transfer.
  - `step_free`: ramp, ramp_height_note, accessible_toilet, step_free_entrance, accessible_transport.
- Growth paths (later, not this drop): venue self-report via the business portal (moderation-gated)
  and in-app women's ratings. Both write Mongo overlays merged over this file at read time; every
  overlay row carries the same provenance fields and a moderation trail.

## 2. Fill gate (the guardrail against empty-badge syndrome)
- `fill.high` = HIGH-confidence pins (kind "places") or HIGH-tagged distinct venues (kind "venues").
- `live = fill.high >= min_fill`. kind "kit" (port_day) is live when its data dependencies resolve
  (fare module present + ≥1 itinerary whose stops all resolve).
- A lens below threshold: appears in `GET /api/lenses` as `{live:false}` with its label + tagline
  (so the UI can show "En construcción"), and its content endpoint returns `coming_soon` WITHOUT
  pins/tags. `?preview=1` returns the content for verification/QA but the payload is marked
  `preview:true` and the client keeps every VERIFY/"sin verificar" treatment plus a builder banner.
- Launch state (seeded): golden_hour LIVE (19 HIGH ≥ 8) · port_day LIVE (kit) ·
  step_free GATED (2 VERIFY, min_fill 6) · family GATED (0) · women_verified GATED (0, by design).

## 3. API (backend; envelope + `_cache()` like the city hub)
- `GET /api/lenses` — public. Lens list with fill counts + live flags + access_tiers. Never the
  content of gated lenses.
- `GET /api/lenses/{key}` — public. Live lens → resolved payload (pins with coords/image/link
  resolved from the catalog; venue_tags joined with venue name/coords). Gated → `{coming_soon:true}`
  (+`?preview=1` as §2). Unknown key → 404.
- `GET /api/lenses/port-day` — the kit: fare rows copied at READ time from
  `backend/data/city_modules.json` (`fare_module`) so taxi facts have exactly one owner; itineraries
  with stops resolved to pins; `crowd_today` from the Mongo cache doc (`lens_state._id=cruise`),
  served ONLY when fresher than 26 h, else `null` (the badge hides; nothing is faked).
- Cron `POST/GET /api/admin/lenses/cruise-pull` (every 6 h) — Bearer `CRON_SECRET` or
  `EVENTS_ADMIN_TOKEN`. Fetches the CruiseMapper port page WITH `?month=YYYY-MM` (the
  schedule is month-paginated server-side; without it the page serves a stale week —
  verified 2026-09-30), segments on its `newDay` date markers and counts today's
  `/ships/` links conservatively; ANY anomaly ⇒ stores `{ships:null}` (hide). Never
  blocks or fails a public read.
- Static mirror: `frontend/scripts/sync-lenses-data.mjs` validates (schema, F5 bans, L4
  completeness, refs resolve, provenance on every entry — the V1 "zero tags without a source"
  gate), resolves venue refs from `public/data/partners.json`, and writes
  `frontend/public/data/lenses.json`. Runs in the Vercel buildCommand before export; exit 1 blocks
  the deploy. The frontend is static-first: paint from the mirror, hydrate from the API.

## 4. Frontend
- **No new tabs.** Lenses are modes on the existing surfaces: chips on the map screen; the Golden
  Hour layer re-pins the map. `mapa?lens=golden_hour` deep-links a mode. `/lentes` exists only as a
  redirect-free hub IF the map cannot host a needed control; default is chips-on-map.
- **Golden Hour**: the signature interaction is the three-layer time toggle
  (Amanecer 6–9 / Día / Atardecer 5–6:30) re-filtering pins by `best_light`. Every pin sheet shows:
  photogenic note, access-tier chip, etiquette line, "Fuente: <source_name> · verificado <date>",
  "sin verificar" chip when VERIFY, "ubicación aproximada" when geo_precision=approx, catalog link
  ("Ver lugar") when venue-backed, and the cruise-crowd badge when `crowd_today` says so.
- **Port Day**: reachable from its chip; works with NO network — itinerary, fare card and a
  schematic stop map (SVG projection from bundled coords; no tile dependency) render from the
  bundled/cached static mirror. Return-to-ship countdown: user sets all-aboard time; banner counts
  down and flags `return_buffer_min` (90) before. Cruise badge appears only from live cached data.
- **Gated lenses** render the "En construcción" card (tagline + why + how it fills) — never an
  empty list, never a live-looking badge.
- **Images**: a pin shows ONLY the linked catalog venue's existing self-hosted image
  (`/images/partners/…`, already rights-cleared) or the SafeImage category placeholder. No scraped
  photos, no AI renders of real places. Credits stay with the catalog entry.
- i18n via `autoTrLenses.ts` in the `useTr` chain; data strings carry their own L4.
- Frontend rules: hooks above early returns; no module-scope Dimensions; SafeImage everywhere;
  44 px targets; ES/EN/FR at 390 px; WebHead only.

## 5. Luna
- `lenses.luna_context(text)` (backend/lenses.py) → deterministic reference injected into the agent
  context wherever `_city_context` is (same AUTORIDAD pattern: lens_reference MANDA):
  - LIVE lens triggered → up to 6 matching entries with name, one-line note, access tier and
    `Fuente: source_name`; Luna answers ONLY from them.
  - GATED lens triggered → **a deterministic HARD GATE, before any LLM call** (amended
    2026-09-30 after live verification: the prompt rule alone let the model append improvised
    "safe for women" venues right after reciting the decline). `lenses.gated_decline_payload`
    answers with the lens's `decline_line` verbatim (its text already carries the verified
    redirect: women → DATT taxi module), zero actions, zero recommendations. It sits in
    `run_agent_turn` after the CMW gate and before the events gate; any gated hit outranks a
    live hit on mixed questions, and women_verified outranks every other gated hit.
- `/search` inherits the same gate + context path. Luna NEVER invents a tag, a safety claim,
  or an accessibility claim: while a lens is gated, the LLM never speaks on its topic.

## 6. Tests (backend pytest, no network)
- `test_lenses_data.py` — schema; provenance on EVERY pin/tag (V1); access_tier on every pin (F3);
  best_light validity; L4 completeness; F5 bans + Candé/Baluarte presence; itinerary/hotspot refs
  resolve; venue_ids exist in the committed catalog snapshot; fill counts → expected live/gated set.
- `test_lenses_api.py` — gate semantics (gated lens leaks nothing publicly; preview keeps VERIFY
  marking; live lens serves resolved pins); port-day fare rows == city module rows; crowd served
  only when fresh; cruise parser: fixture page → count, mutilated page → null.
- `test_lenses_luna.py` — trigger routing per lens/language; live answer carries source; gated
  triggers return the decline_line and nothing else; a bank of ≥20 questions incl. the headline
  "¿es seguro para una mujer sola esta noche?" → honest decline, zero invented claims.
- Frontend: sync-script validation runs in build; tsc; live sweep per VERIFY V1–V8.

## 7. Verify-on-live checklist (drop gate)
V1 architecture/provenance · V2 one gated + one live lens proven · V3 "sin verificar" rendering ·
V4 port-day airplane-mode (itinerary+fares+schematic map) + crowd badge hide-on-fail ·
V5 golden-hour 3 layers + tiers + F5 corrections live · V6 images legal/credited/placeholder ·
V7 Luna answer-with-source + honest-decline transcripts · V8 chips on existing surfaces, ES/EN/FR,
390 px, tsc + backend suite green, DEPLOY-CARRIES-COMMIT.
