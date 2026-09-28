# EVENTS-ELITE: design contract (v1, 2026-09-28)

This is the single spec every builder codes against. If code and this doc disagree, the doc wins until it is amended here first.

## 0. The law (honesty spine)

An event shows, and a notification fires, only when all of these hold:
- it is **source-verified**: it has a real `source_url` that we fetched ourselves;
- it is **future-dated**, computed in Bogotá time;
- it is confirmed to be in **Cartagena de Indias, Bolívar, Colombia**, which here means the full Distrito including the islands.

The AI **never** invents or discovers an event. Deterministic parsers produce every candidate from pages we fetched. The LLM may only clean, translate, categorize and rewrite the description. It must never touch dates, venue, `source_url` or status, and if it fails, the answer is "no change". An LLM failure never means a drop, a hide or a publish.

When in doubt, choose the missed event over the wrong one. A true empty state beats a fake fill.

## 1. Owner decisions (Phil, 2026-09-28)

1. **Legacy data.** Every row in `db.events` (104 live, 165 ids) and all 12 `db.concerts` rows (fabricated seeds) are hidden from every public surface via a code/DB switch. Nothing is deleted. The raw backup is committed at `docs/events-elite/legacy-backup-2026-09-28/`. Legacy rows can come back only by being re-imported as `review` candidates and re-verified. Recurring tours and salsa nights are **not events**; they remain venues/partners.
2. **Push.**
   - Now, with no app update: a server push reminds users about **saved (favorited) HIGH** events. It is sent as `kind:'event_reminder'`, which the existing binaries already route to `/event/<id>`.
   - Proximity is **phone-side**, behind an explicit in-app opt-in that is OFF by default. The phone checks nearby HIGH events while the app is open and offers "Avísame". Tapping it saves the event, and the server sends the reminder.
   - **No location is ever stored server-side.**
   - This ships on the web now and on iOS in 1.1.2.
3. **Alerts.** A Telegram digest plus instant alerts go to Phil, alongside a web admin review page. Configuration comes from env `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALERT_CHAT_IDS` (comma-separated). If they are unset, alerts are logged only and never raise.

Defaults taken from the completeness critic:
- a new collection;
- the Distrito scope;
- an allowlist of sources;
- HIGH and VERIFY both appear in the feed, while push is HIGH-only;
- partner events count as a source at VERIFY;
- the feed is backend-first;
- a new `/que-pasa` screen;
- a deterministic Luna gate;
- copy in ES/EN/FR/PT.

## 2. Data contract: collection `city_events`

```
event_id        str   "ce-<slug>-<yyyymmdd>" (lowercase [a-z0-9-], ≤80). NEVER starts with evt_ or pe_. Stable across re-pulls (built from canonical_key).
canonical_key   str   norm(title) + "|" + edition_year + "|" + start_date + "|" + norm(venue)   (dedupe key; unique index)
title           {es,en,fr,pt}  es required (original). Missing langs → client falls back to es.
description     {es,en,fr,pt}  our own rewrite (never a verbatim copy >200 chars of the source). may be empty.
category        concert|festival|cultural|nightlife|gastronomic|sports|family|civic
start_date      "YYYY-MM-DD" Bogotá, null only when status=date_tbc
end_date        "YYYY-MM-DD" Bogotá (= start_date for single-day), null when date_tbc
start_time      "HH:MM" Bogotá or null (unknown/all-day). NEVER a placeholder like 00:00 unless the source says midnight.
end_time        "HH:MM" or null
date_tbc_note   {es,en,fr,pt} | null   e.g. "Noviembre 2026 · fecha por confirmar"
venue_name      str (may be "Varios escenarios · Centro Histórico")
venue_id        str|null  catalog partner id when matched
address         str|null
zone            str|null  neighborhood slug (local_signals._nearest_neighborhood)
lat, lng        float|null
geocode_source  "catalog"|"gazetteer"|"source"|null     (null ⇒ not geocoded)
price           {is_free: bool|null, min_cop: int|null, max_cop: int|null, text: str|null}
                is_free is true ONLY when a first-party page says free (gratis/entrada libre). Never from JSON-LD isAccessibleForFree.
ticket_url      str|null (http/https only)
source_url      str   REQUIRED. The page that proves the event (organizer/official/ticketer/venue page).
source_name     str   human name ("Hay Festival (organizador)", "Alcaldía de Cartagena", "TuBoleta")
source_tier     int   1 organizer/official gov · 2 primary ticketer · 3 venue first-party/iCal · 4 institutional secondary (IPCC PDF/RSS) · 5 media · 6 aggregator/social (discovery only)
second_source_url  str|null ; second_source_name str|null ; second_source_tier int|null
evidence        [{url, name, tier, fetched_at, http_status, date_text}]   ≤6 entries, newest first. date_text = verbatim date snippet found on that page.
last_verified   ISO-8601 UTC timestamp of the last successful re-check that still found the event+date on a source page (or manual verification)
verified_by     "pipeline"|"manual"|"partner"
confidence      "HIGH"|"VERIFY"
status          "published"|"review"|"hidden"|"expired"|"date_tbc"
status_reason   str|null  machine code: source_gone|cancel_marker|date_changed|conflict|country_fail|admin_hide|stale|partner_pending|aggregator_only|...
country_check   "pass"|"fail" ; country_signals [str]
image_url       str|null  must be a /images/... path in the public manifest, else null (client shows category placeholder)
image_credit    str|null
notif_eligible  bool      DERIVED (see §4) — never set by hand
parent_id       str|null  umbrella event (e.g. Fiestas de Independencia 2026) for sub-events
origin          "anchor"|"pipeline"|"partner"|"legacy-import"
sold_out        bool
created_at, updated_at   ISO UTC
```
Indexes (startup create_index block, which runs on Vercel): `event_id` unique, `canonical_key` unique, `status`, `start_date`, `geo` 2dsphere (`geo: {type:'Point', coordinates:[lng,lat]}` present only when geocoded).

Other collections:
- `city_events_log` records every state change: `{event_id, at, actor, from, to, reason, detail}`. It is the sentinel/audit trail.
- `city_events_runs` is the pipeline/sentinel run ledger: `{run_id, kind: pull|sentinel|reminders|seed, source, started_at, finished_at, found, published, held_review, date_tbc, dropped_no_source, dropped_wrong_country, dropped_past, dupes_merged, errors: [..], cursor}`.
- `city_events_rejects` holds the last 500 rejected candidates, capped via TTL 30d: `{at, source, url, title, reason, signals}`. It proves the country gate.
- `city_events_state` holds singleton docs:
  - `{_id:'flags', enabled: bool, legacy_hidden: bool}`, the kill switch plus the legacy switch;
  - `{_id:'cursor:pull'|'cursor:sentinel', ...}`.
- `event_push_log` has a unique index on `(user_id, date)` with date in Bogotá. It is the separate daily event-push cap and is never shared with `push_log`.
- `event_reminders_sent` has a unique index on `(user_id, event_id)`, for dedupe.
- `event_notif_prefs` stores `{user_id, nearby_enabled: false, categories: [..], reminders_enabled: true, updated_at}`. It is added to `delete_account`, and so are `event_push_log` and `event_reminders_sent`.

## 3. Country gate (pure, `backend/events_gate.py::country_check(c) -> (verdict, signals)`)

Input is a candidate dict with these keys: `source_url`, `page_text` (≤20k chars), `venue_name`, `address`, `lat`, `lng`, `price_text`, `currency`.

**Hard FAIL. Any single signal is enough:**
- The source domain is `cartagena.es`, `*.cartagena.es`, or any `.es` domain.
- The URL matches `feverup.com/*/cartagena/` without the `-colombia` suffix.
- The URL matches `atrapalo.*/murcia/`.
- The text matches `Región de Murcia` or `Murcia` as a word, or `€`/`EUR`, or `+34`, or a 5-digit postal code matching `\b30[23]\d\d\b` near "Cartagena".
- The venue is in the Spain venue list. It must include: Auditorio El Batel, Teatro Circo, Nuevo Teatro Circo, Plaza de España Cartagena, Parque Torres, Castillo de la Concepción, Palacio de Deportes Cartagena, Cartagena Puerto de Culturas.
- It is another Hay edition. Venue or text matches Hay-on-Wye, Castle Marquee, Richard Booth, Segovia, Arequipa, Querétaro, Forum, Medellín, Jericó or Mompox, or the URL is a Hay path other than `/cartagena/`.
- Explicit text names another Colombian city as the location: Barranquilla, Valledupar, Bogotá, Medellín, Cali, Santa Marta, Cúcuta, Montería or Sincelejo. The exception is text that also says "Cartagena de Indias" for this event.
- Lat/lng exist but fall outside the Distrito box. The box is lat ∈ [10.10, 10.62] and lng ∈ [-75.82, -75.42]. Exclude Turbaco and Arjona: lng > -75.43 with lat < 10.36 fails.

**PASS** requires no FAIL signal plus at least one positive signal:
- the venue matches the catalog or the gazetteer (both are in Cartagena);
- lat/lng fall inside the Distrito box and are **not** the placeholder `(10.4236, -75.5483)` within 1e-4;
- the text contains "Cartagena de Indias", or "Cartagena" together with "Bolívar", "Colombia", "COP" or a `$` price with thousands separators ≥ 1.000;
- the source is a Tier-1 registry domain scoped to Cartagena de Indias: `cartagenamusicfestival.com`, `ficcifestival.com`, `hayfestival.com/cartagena/`, `cartagena.gov.co`, `ipcc.gov.co`, `cccartagena.com`, `ironman.com` with a path containing `cartagena` — *and* none of the FAIL signals.

Every rejection goes to `city_events_rejects` with its signals. Fixtures in `backend/tests/fixtures/events/` must include the real saved Spain pages (cartagena.es agenda, fever `/es/cartagena/`, atrápalo Murcia), the Hay-on-Wye markers and the CMF Bogotá launch. Each must be REJECTED. The same fixture set must include the real Colombia pages, which must PASS.

## 4. Verification gate (pure, `events_gate.evaluate(doc, now_utc) -> dict`)

The gate returns `{status, status_reason, confidence, notif_eligible}`. It never mutates anything else. Rules are applied in this order:

1. If there is no `source_url`, or it is not http(s), the result is DROP. The candidate is never stored, only logged as `dropped_no_source`.
2. If `country_check` is fail, the result is DROP (logged as a reject).
3. If `status` is hidden and `status_reason` is `admin_hide`, `source_gone` or `cancel_marker`, it stays hidden (sticky; only admin/sentinel can revive).
4. If the dates are unknown or unannounced, the result is `date_tbc`, with confidence VERIFY and `notif_eligible` false.
5. If `end_date` (or `start_date`) is earlier than Bogotá today, the result is `expired`. An event ending today is still live until its `end_time`, or `start_time` if there is no end time.
6. **Confidence:**
   - HIGH if the event was found on at least one source with tier ∈ {1, 2, 3} and that page's `date_text` matched our dates, or if 2 independent sources (different registrable domains, tier ≤ 5) agree on `start_date`. Otherwise it is VERIFY.
   - Staleness decay: if confidence was HIGH but `now - last_verified > 3 days`, it becomes VERIFY with `status_reason` `stale`, until it is re-verified.
7. **Status:**
   - `origin == partner`: `published` with confidence capped at VERIFY, but only when moderation passed. If moderation is pending or failed, the status is `review` with reason `partner_pending`. Moderation never fails open.
   - Only tier-6 sources: `review` with reason `aggregator_only`, never published.
   - Conflicting dates between the top two sources: `review` with reason `conflict`.
   - Otherwise: `published`.
8. `notif_eligible` requires all of the following:
   - status `published`;
   - confidence HIGH;
   - `geocode_source ∈ {catalog, gazetteer, source}` with lat/lng present;
   - a start in the future, or an ongoing multi-day event with a future `start_time` today;
   - origin not partner;
   - `sold_out` false.

## 5. Sources and adapters (`backend/events_sources.py`)

All adapters use the stdlib only (`re`, `json`, `html.parser`, `xml.etree`) plus `httpx`. There is no bs4. Fetches use UA `AMOLifeBot/1.0 (+https://www.amocartagena.co; contacto)`. Each fetch has an 8s timeout and a 1.5 MB body cap. Domains are hit politely, one at a time with at least 1 s between requests. Each adapter:
```
async def pull(client) -> list[Candidate]            # discovery for the daily pull
async def recheck(client, doc) -> Recheck             # sentinel: {ok, http_status, found_date_text, dates|None, cancel_marker|None, sold_out|None, blocked: bool}
```
A `Candidate` has the §2 fields that the adapter knows, plus `page_text` for the gate and `evidence[0]`.

The registry is `SOURCES = [ {key, name, tier, domain, scope, adapter, enabled} ]`, wired in this order:
- **Tier 1:**
  - `cmf`: cartagenamusicfestival.com. Parse the text "Del N al M de <mes> de YYYY", edition-aware; ignore older editions.
  - `hay`: hayfestival.com/cartagena/inicio. Parse "del 28 al 31 de enero del 2027" plus `<time datetime>`; only `/cartagena/`.
  - `ficci`: the homepage h1 "6 – 11 ABRIL 2027".
  - `ironman`: the official race page JSON-LD `startDate`. It is a DATE; convert it without a timezone shift.
  - `alcaldia` / `ipcc`: IPCC RSS plus the Agenda Festiva PDF. These are used for corroboration and recheck; the Fiestas sub-events come in as anchors.
- **Tier 2:**
  - `latiquetera`: the Cartagena filter list plus the event pages' JSON-LD `Event`.
  - `tuboleta`: event pages' JSON-LD `Event`. Keep only venues in Cartagena.
  - `ticketshop`: its public JSON API, filtered to Cartagena.
  - `fever_co`: `/en/cartagena-colombia/` only.
- **Tier 3:** `cccartagena`, from EventON per-event iCal/microdata. ICS `Z` times convert to Bogotá (UTC-5).
- **Tier 5:** `eluniversal`, from RSS plus NewsArticle JSON-LD. Corroboration only; never the sole source for HIGH.
- **Tier 6:** `cartagenaplay`. Discovery only; results go to review.

Dead ends: eTicket (DNS), TuBoleta Pásala (resale), Eventbrite search, Bandsintown, Instagram.

## 6. Anchors (manually verified seed, `backend/data/events_anchors.json`, committed)

Anchors are seeded idempotently via `POST /api/admin/events/seed-anchors`. Each anchor carries its verbatim evidence quote and URL, taken from `scratchpad/events-research`. Seeding upserts by `event_id` and never overwrites fields the sentinel changed later; only the evidence is refreshed.

The minimum set:
- **CMF 2027:** 9–17 Jan 2027, HIGH, from cartagenamusicfestival.com.
- **Hay Festival Cartagena 2027:** 28–31 Jan 2027, HIGH. Source is hayfestival.com/cartagena/inicio, with the quote "del 28 al 31 de enero del 2027".
- **FICCI 66:** 6–11 Apr 2027, HIGH, from ficcifestival.com.
- **IRONMAN 70.3 Cartagena:** 29 Nov 2026, HIGH, from the official page JSON-LD.
- **Fiestas de Independencia 2026** umbrella (parent). Its sub-events come from the NEWEST official agenda: the IPCC Agenda Festiva PDF of 23 Sep, corroborated by the Alcaldía and El Universal.
  - Gran Desfile/Bando: 12 Nov, 10:00–12:00, Av. Santander.
  - Festival Náutico: 13–14 Nov, with Juan Luis Guerra on 13 Nov.
  - Cabildo de Getsemaní.
  - Other sub-events: only the rows where the newest official sources agree. Where official sources conflict, the row goes to `review`.
- **date_tbc:**
  - Señorita Colombia coronation (Concurso Nacional de Belleza): "Noviembre 2026 · fecha por confirmar";
  - the Christmas lighting ("Alumbrado navideño"): "Diciembre 2026 · fecha por confirmar".

  Both need a real source page that names them without a date.

## 7. Pipeline, sentinel, reminders

Everything runs through Vercel crons. Each call is authorized by Bearer `CRON_SECRET` or `require_admin` (the `demand._auth` pattern) and supports GET+POST. Every invocation has a hard **40 s budget**, checkpoints a cursor in `city_events_state`, and is a no-op once the day's work is done.

- **`GET /api/admin/events/pull`** (cron `*/5 10 * * *` UTC, i.e. 05:00–05:55 Bogotá): each call advances through `SOURCES`. For each candidate:
  1. normalize;
  2. geocode (catalog, then gazetteer);
  3. run the country gate;
  4. build the canonical_key and dedupe (merge `evidence`, keep the most authoritative `source_url`, since lower tier is better);
  5. evaluate;
  6. upsert;
  7. log counts to `city_events_runs`.

  `?source=<key>` runs a single source (for admin/tests), and `?dry=1` returns the candidates and gate verdicts without writing.
- **Enrich step:** run inside `pull` only when budget remains, or separately at `GET /api/admin/events/enrich`. It calls `llm_complete` (haiku, temperature 0) to translate EN/FR/PT, categorize and rewrite the description, at most 3 rows per call. A result of `None` leaves fields as they are. It never touches dates, venue, source or status.
- **`GET /api/admin/events/sentinel`** (cron `*/10 11 * * *` UTC): for every `published` or `date_tbc` event, it runs `adapter.recheck`, or a generic recheck (fetch `source_url`, look for the date text and cancel markers).

  | Recheck result | Action |
  |---|---|
  | 404/410 | `hidden` with reason `source_gone` |
  | Cancel marker (`cancelad[oa]`, `suspendid[oa]`, `aplazad[oa]`, `postergad[oa]`) | `hidden` with reason `cancel_marker` |
  | "nueva fecha", "cambio de fecha", or a parsed date that differs | `review` with reason `date_changed` (a Tier ≤ 3 source with a confident parse instead updates the dates and stays at its re-evaluated confidence; the change is logged) |
  | `terminado`/`finalizado` | `expired` |
  | `agotado`/`sold out` | `sold_out` true (stays published, not notif-eligible) |
  | Success | `last_verified` set to now |
  | Blocked/timeout | Not a change. After 3 consecutive days, decay to VERIFY and send a Telegram alert "re-verificar a mano" |

  Every change is written to `city_events_log`. Every unpublish or date change sends an **instant Telegram** alert, and the run ends with a **digest**. The same cron also expires past events.
- **`GET /api/admin/events/reminders`** (cron `*/15 * * * *` UTC) targets users who favorited an event (`db.favorites`, where `item_id` is the `event_id` and `item_type` is `'event'`) whose event is notif-eligible and **starts within the next 3 h**. It sends only if all of these hold:
  - the time is 09:00–21:00 Bogotá;
  - the user's `event_notif_prefs.reminders_enabled` is not false;
  - there is no row in `event_reminders_sent` for (user, event);
  - the `event_push_log` insert for (user, Bogotá date) succeeds, i.e. at most **1 event push per user per day**;
  - an **immediate re-read** of the event still passes evaluate with HIGH, published and notif-eligible. This is the F5 suppression rule.

  It sends via `push.push_to_user` with `data = {kind: 'event_reminder', event_id}`, plus web push to the user's subscriptions with url `/event/<id>`. Web push uses its own send path, not `notify_user`, so it doesn't consume `push_log`. It also inserts a notification-inbox row.

  The text is ES by default, plus EN when the user profile language is en. It states title, venue and time, and ends with the "Fuente: <source_name>" line. `?dry=1` lists who would get what.
- **Admin:**
  - `POST /api/admin/events/seed-anchors`;
  - `GET /api/admin/events/review`;
  - `POST /api/admin/events/{id}/approve|hide|verify` (verify records a manual `last_verified` with an evidence note);
  - `GET /api/admin/events/runs`;
  - `POST /api/admin/events/flags` with `{enabled, legacy_hidden}`.
  - A `?url=` test hook for the country gate: `GET /api/admin/events/gate-check?url=` fetches the url, parses it with the generic JSON-LD adapter and returns the verdict without storing anything (used for V3).

## 8. Public API (backend-first; CDN `_cache(60, swr=120)`)

- `GET /api/events/feed` has no query params, so the static mirror `/data/events/feed.json` works. It returns
  `{generated_at, today, events: [PublicEvent], date_tbc: [PublicEvent]}` for statuses published and date_tbc with confidence HIGH or VERIFY. The payload is capped at 400.

  `PublicEvent` is the §2 fields minus the internal ones (evidence, canonical_key, `city_events_*`), plus `is_verified: confidence==HIGH`. The fields are: event_id, title, description, category, start_date, end_date, start_time, end_time, date_tbc_note, venue_name, zone, lat, lng, price, ticket_url, source_url, source_name, second_source_name, last_verified, confidence, status, sold_out, image_url, image_credit, notif_eligible, parent_id.
- `GET /api/events/feed/item/{event_id}` returns the PublicEvent for **any** status, including hidden or expired with `status_reason`, so new clients can render the honest state. Hidden rows expose only the reason, never a stale date as if it were live.
- **Legacy compatibility.** Existing binaries (1.1.0/1.1.1) and the current web keep working, but show only verified events:
  - `GET /api/events` returns city_events that are **published, HIGH and in the future**, mapped to the legacy shape: `event_id, title (es), description (es), date=start_date, date_start, date_end, start_time, end_time, venue_name, type=category, category, is_free, price, image_url, ticket_url, source (list with source_url), confidence ('high'), location {lat,lng}, featured`.

    Once `legacy_hidden` is true, db.events rows are **never** returned. VERIFY rows are excluded here because old UIs cannot show the label.
  - `/api/events/featured`: the same as `/api/events`, restricted to HIGH rows that are geocoded or festivals, first 10.
  - `/api/events/dates/available`: derived from the same set.
  - `/api/events/{event_id}`: a city_events published row in legacy shape. Otherwise it returns **404**: legacy rows once legacy_hidden, and hidden, expired or review rows. That makes old binaries show "Evento no encontrado" instead of a dead event.
  - `/api/concerts*`: city_events with category concert, published and HIGH, in legacy concert shape. It never returns the 12 seeds.
  - `/api/search`: event and concert hits come only from city_events that are published and in the future.
  - `/api/seasons/{id}/events`: `[]` for legacy.
- **Private (auth):**
  - `GET/PUT /api/me/event-notif-prefs`;
  - `GET /api/me/events/nearby-offer?lat=&lng=` (optional). **Avoid it: proximity is phone-side, and the client computes from the feed. No location is sent.**
- **Kill switch.** When `flags.enabled` is false:
  - the feed returns an empty list;
  - Luna event questions decline with "La agenda está en mantenimiento";
  - reminders stop;
  - the legacy endpoints return empty (while `legacy_hidden` is true).

## 9. Luna (`backend/luna_events.py`, hooked from `/agent/chat` and `/agent/taste`)

- `def detect_event_intent(text, lang) -> {is_event: bool, range: 'today'|'tonight'|'weekend'|'week'|'date:<YYYY-MM-DD>'|'upcoming', near: bool, category|None}`. This is a strict detector. Event words: evento(s), concierto(s), festival, agenda, fiesta(s) (de independencia), "qué hay/pasa hoy|esta noche|este fin|el sábado", event/concert/show/gig in EN/FR/PT, "cerca de mí" together with an event word. "Dónde cenar hoy" is NOT an event question.
- `async def get_confirmed_events(db, range, near=None, category=None, limit=8) -> list[PublicEvent]` reads published HIGH+VERIFY rows only, with the same gate as the feed. `near` sorts by haversine and keeps events ≤ 3 km.
- `def decline_payload(lang, upcoming_top3) -> assistant_payload` is deterministic, in 4 languages: "No tengo eventos confirmados para <rango>. Lo que sí está confirmado: …", plus a navigate action to `/que-pasa`.
- **Hook** in the `/agent/chat` handler (server.py): if `is_event` holds, the result is empty and the kill switch is on or off, **return the decline without calling the LLM**. If there are results, inject them into the context under a new key `confirmed_events`, which replaces `_slim_upcoming_events` for events and never includes legacy rows. The post-LLM sanitizer then:
  - drops any `open_event` whose id is not in the injected set;
  - drops event recommendations whose id is not in the set;
  - drops `external_link` actions to URLs that are not ticket or source URLs of the injected events;
  - appends a deterministic citation footer to the message text: "Fuente: <source_name> · verificado <dd MMM>" for each event mentioned, where VERIFY rows get "(sin confirmar)".
- The prompt block `AUTORIDAD EVENTOS` says to only use `confirmed_events`, cite the source, hedge VERIFY, and never add events or dates.
- Remove the unsourced seasonal-stamp event injection. Stamps without `source_url` are excluded from `upcoming_confirmed`. Also remove few-shot `evt_010`.
- `/agent/taste` (guest) gets the same gate: decline, or grounded text with the footer.

## 10. Frontend

Web ships now; iOS gets it in 1.1.2.
- `src/lib/eventsFeed.ts` is the loader. It reads `api.get('/events/feed')` backend-first, with the static `/data/events/feed.json` offline fallback. It uses a module cache and provides these helpers, all in Bogotá time via `eventTime.ts`:
  - `bucket(events, 'hoy'|'semana'|'proximos')`, with multi-day overlap;
  - `pickL(l4, lang)`;
  - `isNear(ev, pos, 1500)`;
  - `startsWithin(ev, hours)`.
- **`app/que-pasa/index.tsx`**, "Qué pasa en Cartagena", styled like /ciudad:
  - a segmented Hoy / Esta semana / Próximos control;
  - category chips;
  - "Ver en el mapa", which goes to `/(tabs)/mapa?layer=eventos`;
  - cards showing the title, date and time, venue, category, image with credit or the SafeImage category placeholder, and a subtle trust line "Fuente: X · verificado 28 sep";
  - a VERIFY chip "Sin confirmar · verifica con el organizador";
  - a "Por confirmar" section at the bottom of Próximos for date_tbc rows ("Fecha por confirmar", never a date);
  - an honest empty state: "No hay eventos confirmados para hoy — mira los próximos" plus a button.

  Hooks sit above the early returns, there is no module-scope Dimensions, bucket computations happen after mount (no SSR date text, avoiding #418), and it uses WebHead.
- **`app/event/[id].tsx`** loads `/events/feed/item/{id}` first and falls back to the legacy `/events/{id}`. It renders:
  - a source block: source name linked, second source, "verificado <fecha>", and the confidence chip;
  - status honesty: hidden gives "Este evento ya no está confirmado por su fuente (<reason>)" with no date or ticket CTA, expired gives "Este evento ya pasó", and date_tbc gives "Fecha por confirmar";
  - the ticket CTA only for published rows;
  - price honesty: GRATIS only when `is_free` is true, otherwise "Consultar".
- **Home** "What's on today" plus the Hoy/Noche rails read from `eventsFeed`, today bucket, HIGH or VERIFY with the chip. The honest empty slot shows one line plus a link to `/que-pasa`. The Agenda tile and "Ver todos" go to `/que-pasa`.
- **Agenda tab** "Salir hoy" reads `eventsFeed` for the selected day. "Mi agenda" is unchanged.
- **Map:** an `eventos` layer and FILTER, with pins from geocoded feed events. The `layer=eventos` param preselects it. Pins use real coordinates only, and the detail path is `/event/<id>`.
- **Proximity**, default OFF. It is a `NearbyEventsCard` shown on Home and /que-pasa when all of these hold:
  - the user opted in, via a toggle in Perfil › Notificaciones ("Eventos verificados cerca de mí"), explaining that location stays on the phone;
  - geo is already granted (never prompt from here);
  - there is a notif-eligible event ≤ 1.5 km away that starts within 3 h and matches the chosen categories.

  It shows at most 2 offers per day, capped in AsyncStorage. "Avísame" favorites the event (behind the login gate if needed), and the server sends the reminder. No local notifications. No location leaves the device.
- **Static:** `scripts/gen-events-static.mjs` writes `public/data/events/feed.json` from the live `/api/events/feed`, plus `public/data/events.json` from the legacy-shape `/api/events` (the verified set). It **deletes** every legacy per-id file in `public/data/events/*.json` except `feed.json`, so a 404 can never resurrect them. It also rewrites `public/data/concerts.json` from `/api/concerts`. `verify-images.mjs` is updated to accept this. **Run it before every web deploy.**
- **i18n:** new strings go in `src/i18n/autoTrEvents.ts` (the feed UI owner) and `src/i18n/autoTrNearby.ts` (the proximity/map owner), each ES→{en, fr, pt} in tú voice (PT você). The lookup already merges them.

## 11. Tests (must pass before deploy)

Backend tests use pytest with no Atlas, backed by stub collections, pure modules and saved fixtures:
- `test_events_gate.py` covers the country gate (all Spain/Hay-on-Wye/other-city fixtures REJECTED, Colombia fixtures PASS, the placeholder coordinate is not geocoded), evaluate (every rule in §4, including decay, date_tbc, expired and conflict), `notif_eligible` and the canonical_key/dedupe.
- `test_events_sources.py`: every adapter parses its saved fixture. It covers ICS Z to Bogotá, JSON-LD dates with no timezone shift, cancel and sold-out markers, and CMF edition selection.
- `test_events_sentinel.py`: with a stub DB and a fake fetch, a 404 hides the event, "cancelado" hides it, a date change sends it to review or updates it, blocked for 3 days decays it, and every case writes a log row.
- `test_events_reminders.py`: only HIGH, geocoded, published events notify. VERIFY and date_tbc never do. Quiet hours hold, the 1/day cap holds, dedupe holds, suppression works when confidence dropped, and the payload has `kind` event_reminder plus event_id.
- `test_events_luna.py`: a date with events lists them with the source footer; a date without events gives a deterministic decline with no LLM call; "cerca de mí" returns nearby events; an injected fake `open_event` id is stripped.

Frontend: `tsc --noEmit` passes, eslint has 0 errors, the i18n coverage check passes, and a Playwright sweep covers /que-pasa (buckets, empty state, VERIFY and date_tbc labels, map pins, no hydration errors) in ES/EN/FR at 390 px.

## 12. Rollout

The order is safe: each step is verified live before the next.
1. Commit the backup under `docs/events-elite/legacy-backup-2026-09-28/`.
2. Deploy the backend with `flags.enabled=true, legacy_hidden=false`. The new endpoints are additive.
3. Run `seed-anchors`, the `pull` loop and the `sentinel`, then verify V1–V6 through the admin endpoints.
4. Flip `legacy_hidden=true`, so the legacy endpoints serve only the verified set, then verify the public endpoints.
5. Run `gen-events-static` and deploy the frontend web.
6. Verify V7–V9 live.
7. Set the Telegram env and test the alert.
8. iOS 1.1.2: build after 1.1.1 is approved, then do a simulator walk that includes /que-pasa, /concierge and proximity, then get Phil's go to submit.
