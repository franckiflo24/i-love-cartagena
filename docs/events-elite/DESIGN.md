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

---

# §13 AMENDMENTS v2 (2026-09-28, from the adversarial design review)

**These amendments SUPERSEDE §1–§12 wherever they conflict.** Builders implement §13 first.

## A. Identity and dedupe (replaces the §2 id rules)
- A1. `event_id` is minted **once**, on insert via `$setOnInsert`, and is never recomputed.
  - Dated events: `ce-<slug≤56>-<yyyymmdd>-<h4>`.
  - date_tbc events: `ce-<slug≤56>-<yyyy>-tbc-<h4>`.
  - `h4` is `sha1(canonical_key at insert)[:4]`.
  - The id is lowercase `[a-z0-9-]`.
- A2. `canonical_key` may be updated when dates change: the old key goes to `key_history` and the new key is written. It keeps its unique index. When the new key collides with another row, merge into the OLDER `event_id`, add the other's id to `aliases: [..]` and hide the newer row (`status_reason` `merged`).
- A3. `source_keys: ["<adapter>:<native_id>"]` holds the SecuTix productId, La Tiquetera slug, Ticketshop slug, Fever plan_id, TuBoleta slug and `anchor:<key>`. It has a unique multikey index.
  - Pull matching order: `source_keys`, then `canonical_key`, then `(title_norm, edition_year, venue_norm)` against date_tbc rows.
  - A date change edits start and end in place and appends `{at, from, to, source}` to `date_history`. It never inserts.
  - On `DuplicateKeyError`, retry once as an update on the conflicting row.
- A4. `feed/item/{id}` and legacy `/events/{id}` also resolve `aliases`.

## B. Read-time truth (new §4.9, mandatory on EVERY read)
- B1. The pure `public_view(doc, now_utc, sentinel_healthy: bool) -> PublicEvent | None` re-applies §4 rules 3–8 on every read using the STORED `country_check`. Only pull and sentinel recompute that, from fresh `page_text`. The same function serves the feed, feed/item, every legacy endpoint, search, Luna and the reminders.
  - It returns expired according to Bogotá date and time.
  - It downgrades HIGH to VERIFY when `last_verified` is older than 72 h.
  - It recomputes `notif_eligible`.
  - Stored status, confidence and notif_eligible are caches, never trusted alone.
- B2. **Sentinel health guard:** `sentinel_healthy` is true only if `city_events_runs` has a `kind='sentinel'` row with `finished_at` in the last 48 h and `done=true`. When it is false:
  - every row is served as VERIFY;
  - notif_eligible is false;
  - reminders do nothing;
  - the legacy HIGH-only endpoints serve `[]`.

  This is fail-closed: if the crons die, the app goes quiet and never serves stale "verificado" rows. The health value is computed with one cached query per 60 s per instance.
- B3. Every public Mongo query also filters `{$or: [{end_date: {$gte: today_bogota}}, {status: 'date_tbc'}]}`.

## C. Routing and registration
- C1. Declare `GET /api/events/feed` and `GET /api/events/feed/item/{event_id}` **in server.py, above `@api_router.get('/events/{event_id}')`** (currently server.py:4197), or include the events router before `api_router`. `get_event()` returns 404 for the reserved ids `feed`, `featured` and `dates`. A required test calls GET `/api/events/feed` through the FULL app router and gets 200 with `generated_at`.
- C2. The module layout is fixed:
  - `backend/events_gate.py`: pure. It holds country_check, evaluate, public_view, the canonical/slug/id helpers, the date/time normalizers, the tiers registry, the cancel/challenge/sold-out detectors and the registrable-domain helper, whose hardcoded public-suffix list includes co, com.co, gov.co, org.co, edu.co and net.co.
  - `backend/events_sources.py`: the adapters, the fetch helper and the SOURCES registry.
  - `backend/events_legacy.py`: the legacy-shape mappers, as pure functions.
  - `backend/events_elite.py`: a router mounted before `api_router`. It holds the admin/cron endpoints (pull, enrich, sentinel, reminders, seed-anchors, review/approve/hide/verify, runs, flags, gate-check, import-legacy) plus `ensure_events_indexes()`.
  - `backend/luna_events.py`: detect_event_intent, get_confirmed_events, decline_payload, sanitize and footer.
  - `backend/telegram_alerts.py`: `send(text)` and `digest(...)`, driven by env. They never raise, and time out after 5 s.
  - `backend/webpush.py`: add `send_to_subscriptions(db, user_id, title, body, url, scope)` (pywebpush in `asyncio.to_thread`, `timeout=5`, NO `push_log`).
  - server.py edits cover only: the feed routes, the legacy endpoint rewiring, favorites, calendar, my-week, search, the delete_account additions, the index block, the router mount and the removal of the reminders scheduler.

## D. Legacy compatibility (replaces the §8 legacy list)
- D1. **Old binaries' lists read the STATIC `/data/events.json`**, so serve it live:
  - delete `frontend/public/data/events.json`, `concerts.json`, `concerts/dates.json`, `concerts/genres.json`, and every file under `public/data/events/**` except `feed.json`, plus `public/data/concerts/*.json`;
  - add external rewrites in `frontend/vercel.json` from `/data/events.json` to `https://backend-mu-one-74.vercel.app/api/events`, and from `/data/concerts.json`, `/data/concerts/dates.json` and `/data/concerts/genres.json` to their API equivalents;
  - give those 4 paths a header rule `Cache-Control: public, max-age=60, stale-while-revalidate=120`, placed after the generic `/data/(.*)` rule.

  Vercel serves the filesystem before rewrites, so the files MUST be absent. Verify with `curl -I` after deploy.
- D2. The **legacy mapper** (`events_legacy.to_legacy_event`) produces exact field types:

  | Field | Value |
  |---|---|
  | `event_id`, `id`, `slug` | event_id |
  | `title` | title.es |
  | `description` | a VERIFY prefix `'Sin confirmar — verifica con el organizador. '` when VERIFY, then description.es, then `'\n\nFuente: <source_name> · verificado <d MMM>'` |
  | `date`, `date_start` | start_date |
  | `date_end` | end_date |
  | `start_time`, `end_time` | `''` when null (never null) |
  | `venue_name` | venue_name |
  | `category`, `type` | `LEGACY_CAT[category]` |
  | `is_free` | `price.is_free is True` |
  | `price`, `price_min_cop` | int or null, never an object |
  | `booking_link` | ticket_url, else source_url (http(s) only) |
  | `ticket_url` | ticket_url |
  | `image_url` | image_url, or `''` |
  | `source` | `[source_url]` |
  | `confidence` | `'high'` |
  | `location` | `{lat, lng}` only when geocoded; omit the key otherwise |
  | `featured` | bool |
  | `recurring` | false |

  The concert mapper follows the same rules in the concerts shape.

  A contract test renders each mapped row through a copy of the 1.1.x price/booking logic, asserting there is no `NaN`, no `'Acceso libre'` on a paid or unknown event, and no `'null'` in share text.
- D3. The legacy endpoints (`/events`, `/events/featured`, `/events/dates/available`, `/events/{id}`, `/concerts`, `/concerts/{id}`, `/concerts/dates`, `/concerts/genres`) serve ONLY `public_view` rows that are published, HIGH and in the future. **VERIFY is excluded from every legacy endpoint.** `/events/{id}` returns 404 otherwise.
  - While `legacy_hidden` is false, they return today's legacy data unchanged.
  - Once it is true, they never read `db.events` or `db.concerts`.
  - `/events/featured` returns the HIGH rows that are geocoded or festivals, sorted by start date, first 10.
  - `/events` keeps accepting `date` and returns rows whose range contains that date.
- D4. More legacy paths go through city_events when `legacy_hidden` is true:
  - `GET /favorites`, `/favorites/ids`, `POST /favorites/toggle`, and a new **`POST /favorites/add`**. `add` is idempotent and returns `{status: 'added'|'exists'}`. For `item_type ∈ {event, concert}` it accepts only city_events ids (including aliases) with status ∈ {published, date_tbc}.
  - `/calendar` and `/my-week`: read-time filters. Items whose event is not a live city_events row are omitted. Nothing is deleted.
  - The AI profile and itinerary enrichers (server.py about 4588 and 6509) read city_events.
  - `/seasons/{id}/events` returns `[]`.
  - `reminders.start_reminder_scheduler` and `_scan_once` are removed, and the startup call is deleted.
  - `backend/scripts/dump_static.py` has its events, concerts, seasons and partner-events sections stripped.
  - `/search`: event and concert hits come from `public_view` published rows. When `detect_event_intent` is true, `ai.answer` becomes the deterministic grounded list or the decline (no LLM), and highlights are limited to injected ids.
- D5. **Partner events** (`partner_events`, pe_ ids) are out of scope for city_events in v1. They remain on their own surface, with these fixes:
  - moderation fails closed (NEEDS_REVIEW or an LLM failure means not published);
  - GET `/partner-events` no longer runs `_migrate_stuck_pending_events`; that becomes admin-only;
  - they are never push-eligible and never in Luna's events context (drop `_slim_partner_events`);
  - clients label them "Publicado por <venue_name>" in a neutral colour.

## E. Flags and kill switch
- E1. `POST /api/admin/events/flags` is a PATCH: only the keys sent are `$set`. Setting `legacy_hidden=false` also requires `confirm_unhide_legacy: true`.
  - A missing doc means `{enabled: false, legacy_hidden: false}` (today's behaviour).
  - A Mongo read error means `enabled=false, legacy_hidden=true` (fail-closed).
  - Flags are cached per instance for 30 s.
- E2. `flags.sources_disabled: [keys]` disables a blocked source without a deploy.
- E3. Latency to reach users: up to 30 s of instance cache plus CDN time (feed 180 s, legacy up to 360 s). This is documented in the admin page.

## F. Fetching, budgets, cursors
- F1. `fetch()` is `asyncio.wait_for(streamed read capped at 1.5 MB, 8 s)`, with `follow_redirects=True` and at most 3 hops. It returns `{status, final_url, headers, text, challenged: bool}`.
- F2. Each SOURCES entry has `{min_gap_s` (default 1, 6 for SecuTix hosts)`, cookie_jar: bool, max_items_per_call, recheck: 'adapter'|'generic'|'head'}`. At most 4 domains run in parallel with one request in flight per domain, and nothing new is dispatched after 30 s elapsed.
- F3. The cursor doc is `{_id, day (Bogotá), idx, offset, inflight, lease_until, run_id, done}`.
  - Claim it with `find_one_and_update` where `lease_until < now`, with a 55 s lease.
  - Save the cursor BEFORE each fetch.
  - An item that is still `inflight` from a dead lease is skipped as `poison`, and the skip is logged.
  - Each invocation writes one `city_events_runs` row. A daily digest goes to Telegram when the day's sentinel reaches `done`.
- F4. The sentinel fetches each unique URL once per run and fans the result out to every row citing it. It orders rows by `last_verified` ascending.

## G. Sentinel recheck table (extends §7)
| Recheck result | Action |
|---|---|
| 200, and the date text for the event is found | success: set `last_verified` |
| 200 without the date text | `unconfirmed`: no change, and it is NOT a verification |
| Challenge: 403/503 with `cf-mitigated`, a body under 15 KB containing "Just a moment", "Client Challenge" or "Waiting Room", or a final path containing `cookieWarning` or `pkpcontroller` | `blocked`: no change |
| Redirect to a final URL that lacks the event slug or id | treated as 404 |
| Final path contains `view_canceled` | `cancel_marker` |
| 404/410 | hides only on the **2nd consecutive run at least 6 h apart** (the first sets `gone_strikes=1`); `source_gone` rows are rechecked daily for 7 days and revived to `review` if the page returns with the date |
| Unconfirmed or blocked for 3 consecutive days | VERIFY, plus one Telegram alert per source per day (not per row) |
| `recheck: 'head'` (PDF evidence) | compare ETag, Last-Modified and Content-Length with the stored values; unchanged means OK, changed means `review` with reason `source_changed`, plus an alert |

**Anchors** use an HTML `source_url` that states the date: the IPCC WordPress post, El Universal or the Alcaldía article. Image-only PDFs appear only in `evidence` with `recheck: 'head'`. `www.cartagena.gov.co` is never crawled automatically; its articles are anchor evidence only. **A second sentinel cron at `*/10 17 * * *` UTC** covers events that start today.

## H. Reminders (replaces the §7 reminders bullet)
- H1. Targets are favorites with `item_type ∈ {event, concert}` whose `item_id` resolves to a city_events id (including aliases). Timing:
  - Send at the first cron tick in `[start−180 min, start−30 min] ∩ [09:00, 21:00]` Bogotá.
  - If `start_time` is null, send at the first tick ≥ 09:00 on `start_date`.
  - Multi-day events are reminded on their first day only.
- H2. Order, per event per run:
  1. `public_view` must be notif-eligible.
  2. A **live `recheck` of the source**, once per event per run: it must be `ok`, with no cancel marker and no date change. A `blocked` or `unconfirmed` result suppresses the push without changing the feed.
  3. For each user: insert into `event_reminders_sent`, the unique claim; if it already exists, skip.
  4. Insert into `event_push_log`, the per-day cap; if it already exists, delete the claim and skip.
  5. Send via Expo `push_to_user` with `data={kind: 'event_reminder', event_id}`, plus `webpush.send_to_subscriptions(scope='events')`.
  6. If every channel failed or none exists, delete both rows.
- H3. Web push `push_subscriptions` gain `scopes: [..]`. Existing rows count as `['passport']`, and event reminders use only the `'events'` scope. The new web consent row reads "Recordatorios de eventos que guardas — máximo 1 al día".
- H4. An inbox row is written: `{notification_id, user_id (never null), type: 'event_reminder', title, body, ref: {event_id}, read: false, created_at}`.
- H5. Push language comes from `event_notif_prefs.lang`, which the 1.1.2 app and web set, and defaults to ES. The text states title, venue and time, followed by "Fuente: <source_name>". Expo limits are 120/240 characters; web limits are 80/160.

## I. Luna (replaces §9 hook placement)
- I1. The event gate lives in `ai_agent.run_agent_turn`, so `/agent/chat`, `/agent/taste` and the `/search` AI path all inherit it.
  - It runs `detect_event_intent` and, when true, `get_confirmed_events`.
  - If the result is empty, or the kill switch is on, or the sentinel is unhealthy, it returns `decline_payload` WITHOUT calling the LLM.
  - Otherwise it injects `confirmed_events` in place of `_slim_upcoming_events`. The sanitizer and the footer then apply.
- I2. `decline_payload` emits the action `{type: 'navigate', screen: 'agenda'}`, which old binaries map to the Agenda tab, the verified set. Web and 1.1.2 map `agenda` to `/que-pasa`. No new screen keys are introduced.
- I3. "Cerca de mí" reads `lat` and `lng` from the POST body field `location: {lat, lng}` only. It is never persisted to `chat_sessions` or logged, and it is ignored when absent. Old binaries don't send it, so they get a decline for the proximity part with an offer of the full list. `GET /me/events/nearby-offer` is REMOVED from the contract.
- I4. Stamps without `source_url` are excluded from `upcoming_confirmed`, and the few-shot `evt_010` is removed.

## J. Frontend (web now; 1.1.2)
- J1. `eventsFeed.ts` does NOT use `api.get`'s fallback.
  - A live 200 is used.
  - A 404 shows the error state.
  - A network error or 5xx falls back to the swr copy or the static `feed.json` ONLY if its `generated_at` is ≤ 36 h old. It then renders the banner "Sin conexión · agenda del <d MMM HH:mm>", replaces the trust line with "sin actualizar", and disables NearbyEventsCard and Avísame. Past rows are dropped.
  - Anything older than 36 h shows "No pudimos cargar la agenda" plus Reintentar.

  The cache entry is `{data, fetchedAt, day}`. It revalidates on focus and on AppState `active` when older than 10 min, and recomputes buckets when `bogotaToday()` changes. Exports: `getCachedFeed()`, `loadFeed({force})`, `bucket(events, 'hoy'|'semana'|'proximos')`, `onDay(events, ymd)`.
  - `semana` is today+1 through today+6.
  - `proximos` is everything after that.
  - Multi-day events appear in every bucket they overlap.
  - Sort by start_date, then start_time, with nulls last.
- J2. `event/[id]` renders dates, time, price, the ticket CTA and Avísame ONLY when status is `published`.
  - `date_tbc` shows "Fecha por confirmar".
  - `hidden` or `review` shows the title plus "Este evento ya no está confirmado" and a localized reason: `source_gone` → "La página oficial del evento ya no está disponible", `cancel_marker` → "La fuente lo anuncia como cancelado o aplazado", `date_changed`/`conflict` → "La fecha cambió y la estamos verificando". Any other reason shows no reason line.
  - A status_reason code is never printed.
  - For hidden and review rows, `feed/item` nulls the dates, times and ticket_url server-side.
  - `sold_out` shows an "Agotado" chip and no ticket CTA.
- J3. **Home:**
  - If the today bucket is non-empty, show the Hoy/Noche rails, with a "Sin confirmar" chip on VERIFY rows.
  - If it is empty, or in remote mode, show ONE row "Próximos confirmados" with the next ≤ 6 events plus "Nada confirmado hoy · Ver todo →" linking to `/que-pasa`. Never show two empty slots.
  - First paint comes from HOME_CACHE, then `getCachedFeed()`, then `feed.json` if `generated_at` ≤ 24 h. The live response replaces it.
  - The 2×3 grid is unchanged, except the Agenda tile routes to `/que-pasa`.
- J4. `/que-pasa`:
  - a header action "Mi agenda" goes to `goTab(router, '/(tabs)/agenda?mode=mi_agenda')`;
  - category chips;
  - "Ver en el mapa" goes to `/(tabs)/mapa?layer=eventos`;
  - a "Por confirmar" section inside Próximos;
  - an honest empty state per bucket;
  - VERIFY chip text "Sin confirmar · verifica con el organizador", and for partner rows "Publicado por <venue>".
- J5. Every web and 1.1.2 event reader uses eventsFeed: the Explore rail, the search static merge, favorites (the feed plus feed/item for missing ids, with honest status), Luna `show_events` → `/que-pasa`, and `/concerts` → `/que-pasa?cat=concert`.
- J6. **Avísame** calls `ensureFavorite(id)` (`POST /favorites/add`) and is never a toggle.
  - A guest's tap stores `{event_id, exp}` under AsyncStorage `@amo_pending_avisame`, then goes to `/login?next=<path>`; the favorite is applied after login.
  - The button appears only when a channel is usable (native permission granted or still requestable, or web push subscribed or subscribable, subscribing with the events scope inside the tap) **and** the H1 send window is still ahead. Otherwise it reads "Guardar", and the confirmation says "Guardado · no podremos avisarte a tiempo".
  - Success copy: "Listo · te avisamos antes de que empiece (máx. 1 aviso de eventos al día)".
  - When the event is already saved, the button is disabled and reads "Te avisaremos".
- J7. **Perfil › Notificaciones** (web now, native in 1.1.2) has two rows:
  - "Recordatorios de eventos guardados": default ON, stored via `PUT /me/event-notif-prefs {reminders_enabled, lang}`.
  - "Eventos verificados cerca de mí": default OFF, stored locally as `@amo_nearby_optin` (works for guests) and mirrored when logged in. Subtitle: "Para esta función tu ubicación se usa solo en tu teléfono; no la enviamos a AMO."

  In 1.1.2 the `mapa.tsx` location ping to `/analytics/location` is removed, or gated behind its own explicit consent. The privacy policy (`privacidad.tsx` and `public/privacy/index.html`) is updated to match: saved-event reminders up to 3 h before, 09:00–21:00, at most 1 a day; nearby alerts computed on the phone.
- J8. 1.1.2 `PushBootstrap` handles the cold start with `getLastNotificationResponseAsync()` (deduped by request id) and routes `event_reminder` to `/event/<id>`. It also sends the header `X-AMO-Client: <ios|web>/<version>`.
- J9. `frontend/scripts/gen-events-static.mjs` writes ONLY `public/data/events/feed.json`. It fetches with `?_gen=<epoch>` and exits 1 (no deploy) unless all of these hold: HTTP 200, every `event_id` starts with `ce-`, every row has a `source_url`, and `generated_at` is < 10 min old. It never keeps an old file on failure. It deletes the stale files listed in D1. `verify-images.mjs` is updated so it no longer requires `events.json`, and it reads the feed instead.
- J10. **File ownership** for parallel builders: see §14 (written with the build plan).

## K. Indexes
- K1. The city_events* indexes live in their OWN try-block in startup.
- K2. `ensure_events_indexes()` runs once per instance at the top of pull, sentinel, seed, reminders and import. Writers refuse to write (503 plus an alert) if the unique indexes on `event_id` and `canonical_key` are missing.
- K3. Indexes:
  - city_events: `{status:1, start_date:1}`, `{status:1, last_verified:1}`, `{parent_id:1}`, unique `source_keys`, `aliases`, and 2dsphere `geo` (sparse).
  - favorites: `{item_type:1, item_id:1}`.
  - city_events_rejects: TTL on `at_dt` (a BSON Date, 30 days).
  - city_events_log: `{event_id:1, at:-1}`.
  - city_events_runs: `{kind:1, started_at:-1}`.
  - event_push_log: unique `(user_id, date)`.
  - event_reminders_sent: unique `(user_id, event_id)`.
- K4. Timestamps are ISO `YYYY-MM-DDTHH:MM:SSZ` strings, with a BSON Date companion `*_dt` wherever a TTL or range query needs one.

## L. Legacy import (admin, optional)
`POST /api/admin/events/import-legacy` copies legacy rows into city_events as `status='review'` with `status_reason='legacy_unverified'` and `origin='legacy-import'`. It takes only rows that meet all of these:
- have at least one source URL;
- are not recurring;
- span ≤ 30 days;
- are in the future;
- sit inside the district.

On a `canonical_key` or `source_keys` conflict the existing (anchor/pipeline) row wins and the import is skipped. Imported rows become published only when an adapter recheck verifies them from a tier ≤ 3 source, or when Phil approves them.

# §14 BUILD PLAN AND FILE OWNERSHIP

Each builder edits ONLY its own files. It does not commit, deploy or call any write endpoint on prod. If it needs a change in someone else's file, it writes that need under `integration_notes` in its report.

**Stage 1 runs in parallel:**
- **core** (backend, pure and runtime):
  - modules: `backend/events_gate.py`, `backend/events_legacy.py`, `backend/events_sources.py`, `backend/events_runtime.py`;
  - fixtures: `backend/tests/fixtures/events/**`;
  - tests: `backend/tests/test_events_gate.py`, `test_events_sources.py`, `test_events_legacy.py`.

  `events_runtime.py` is async and database-backed. It provides:
  - `get_flags(db)`, cached 30 s, with the §13 E1 defaults;
  - `sentinel_healthy(db)`, cached 60 s;
  - `public_rows(db, *, statuses, min_confidence, extra_query, limit) -> list[PublicEvent]`, which applies `public_view`;
  - `resolve_event(db, id_or_alias) -> doc | None`.
- **anchors**: the data only.
  - `backend/data/events_anchors.json`: every anchor carries `source_url` as an HTML page with a verbatim date quote, plus `evidence[]`, `anchor_version` and `source_keys: ['anchor:<key>']`.
  - `backend/data/events_gazetteer.json`: public venues with lat/lng from OpenStreetMap Nominatim or our own catalog, each with a citation URL. Nominatim use is one-off at build time: 1 req/s, descriptive UA.
  - `backend/tests/test_events_anchors.py`: schema checks. Every anchor passes `country_check` and `evaluate` from its evidence text, and no anchor is dated in the past.
- **luna**:
  - `backend/luna_events.py`;
  - edits to `backend/ai_agent.py`: run_agent_turn, context and prompt, sanitizer, footer, removing `evt_010` and the unsourced stamps, and dropping `_slim_partner_events`;
  - `backend/tests/test_events_luna.py`.
- **fe-feed** (frontend feed UI):
  - new files: `frontend/src/lib/eventsFeed.ts` and `frontend/app/que-pasa/index.tsx`;
  - edits: `frontend/app/event/[id].tsx`, `frontend/app/(tabs)/index.tsx`, `frontend/app/(tabs)/agenda.tsx`, `frontend/app/(tabs)/explore.tsx`, `frontend/app/search.tsx`, `frontend/app/favorites.tsx`, `frontend/app/favoritos.tsx`, `frontend/app/concerts.tsx`, `frontend/app/conciertos.tsx`, `frontend/src/components/AssistantFab.tsx`, `frontend/app/concierge.tsx` (the navigate/show_events mapping only);
  - strings: `frontend/src/i18n/autoTrEvents.ts`.

  It *uses* `AvisameButton` and `NearbyEventsCard`, which fe-nearby creates.
- **fe-nearby** (proximity, map, notifications, privacy):
  - new files: `frontend/src/components/AvisameButton.tsx` and `frontend/src/components/NearbyEventsCard.tsx`;
  - edits: `frontend/app/(tabs)/mapa.tsx`, `frontend/app/(tabs)/perfil.tsx`, `frontend/src/components/GrowthCards.tsx`, `frontend/src/context/FavoritesContext.tsx`, `frontend/src/components/PushBootstrap.tsx`, `frontend/src/lib/push.ts` (and its web twin), `frontend/src/constants/api.ts` (the X-AMO-Client header only), `frontend/app/privacidad.tsx`, `frontend/public/privacy/index.html`;
  - strings: `frontend/src/i18n/autoTrNearby.ts`.

  The component props are fixed:
  - `AvisameButton({ event: PublicEvent, compact?: boolean })`;
  - `NearbyEventsCard({ events: PublicEvent[] })`, which returns null unless eligible.
- **fe-static**:
  - `frontend/vercel.json`: the `/que-pasa` route and its capitalised redirects, plus the §13 D1 external rewrites and headers;
  - `frontend/app/_layout.tsx`: the Stack.Screen entry for `que-pasa/index` (card);
  - `frontend/scripts/gen-events-static.mjs` and `frontend/scripts/verify-images.mjs`;
  - deletion of the legacy static files listed in §13 D1.

**Stage 2 runs after core:**
- **service** (backend service and wiring):
  - new files: `backend/events_elite.py` (router) and `backend/telegram_alerts.py`;
  - edits: `backend/webpush.py` (`send_to_subscriptions` plus scopes), `backend/server.py` (every edit listed in §13 C2, D and K), `backend/reminders.py` (removal), `backend/scripts/dump_static.py` (strip), `backend/vercel.json` (crons: pull `*/5 10 * * *`, sentinel `*/10 11 * * *` and `*/10 17 * * *`, reminders `*/15 * * * *`);
  - tests: `backend/tests/test_events_sentinel.py`, `test_events_reminders.py`, `test_events_routes.py`.

  The route-order test runs against the FULL app router, sliced or stubbed. It also covers the favorites add/toggle for `ce-` ids, the legacy endpoints under both flag states, and the contract test for old-binary rendering.

**Commands:**
- backend tests: `cd backend && /private/tmp/claude-501/-Users-showowt/97dbf969-6103-4fac-bbd6-136aea56934d/scratchpad/venv-events/bin/python -m pytest -q tests/test_events_*.py`. Tests never import server.py directly at module import, because it connects to Mongo; use the slice/stub pattern from `test_port_tax_retired.py`.
- frontend: `cd frontend && npx tsc --noEmit && npx eslint <changed files>`.

---

# §15 AMENDMENTS v3 (honesty & safety review). SUPERSEDES §1–§14 AND §13 WHERE THEY CONFLICT

## P. Identity (final)
- P1. `match_key = norm(title) | edition_year | norm(venue)`, with **no date**. `edition_year` is a new required field: the year of the edition, taken from the source text, or else from the start_date year.
  - Several dates for the same match_key **from the same page** are distinct performances; append `|yyyymmdd` for those rows only.
  - Different dates for the same match_key **from different sources** mean ONE doc with `status review` and reason `conflict`.
  - `canonical_key := match_key`. It is set at insert and **never recomputed**.
- P2. `event_id` is `ce-<slug≤56>-<yyyymmdd first seen | yyyymm+'tbc'>-<sha1(match_key)[:4]>`. It is IMMUTABLE.
  - Date changes edit fields and append to `date_history`.
  - Merges keep the older id and add `aliases`.
  - `source_keys` stays as in §13 A3.
- P3. New per-row fields:
  - `source_key` (the adapter key);
  - `recheck_url` (for Alcaldía anchors, the IPCC HTML mirror);
  - `blocked_days`, `not_found_count`, `gone_strikes`;
  - `etag`, `last_modified`, `content_length` (for head rechecks);
  - `tbc_window_end` (the last day of the stated month, for date_tbc rows);
  - `is_umbrella` (true when the row has children), which the pull/seed sets whenever a child references it.

## Q. Country gate (final, replaces §3)
- Q1. Input: `c = {source_url, page_text, event_text, ld_location{name, streetAddress, addressLocality, addressRegion, addressCountry, postalCode, geo}, tz_offset, currency, country_iso, venue_name, address, lat, lng}`. Here `event_text` is ONLY the text of the specific Event node, card or row whose date we took.
- Q2. **Page-level hard FAIL**, from the raw page plus the URL: a `.es` domain; `€`/`EUR`; `+34`; `Murcia`; `España`; a 302xx/303xx postcode near "Cartagena"; `addressCountry` ES or España; `Europe/Madrid`; a tz offset of `+01:00` or `+02:00`; feverup `/cartagena/` without `-colombia`; atrápalo `/murcia/`.
- Q3. **Event-scoped hard FAIL**, from `event_text`, `ld_location` and `venue_name` only:
  - another city: Barranquilla, Valledupar, Bogotá, Medellín, Cali, Santa Marta, Cúcuta, Montería, Sincelejo, Chairá, Caquetá, Chile, Valparaíso, Turbaco, Turbaná, Arjona, Santa Catalina, Tolú or Coveñas;
  - "Vía al Mar", `a \d+ (min|minutos|km) de Cartagena`, or "Desde Cartagena";
  - `CLP` or `+56`.

  The "Cartagena de Indias" exception counts ONLY inside event_text or ld_location. The Hay-edition rule applies only on hayfestival.com, using the event node.
- Q4. **PASS** requires no FAIL signal and at least one of the following:
  - a catalog or gazetteer venue match;
  - geocoded coordinates inside the box with no placeholder match;
  - event_text or ld_location contains "Cartagena de Indias", or "Cartagena" together with one of "Bolívar", "COP" or "+57";
  - a Tier-1 domain scoped to Cartagena, as in §3.

  The bare "$ price" positive is REMOVED.
- Q5. **Geo:**
  - box: lat ∈ [10.10, 10.62] and lng ∈ [-75.82, -75.42];
  - exclusion: FAIL if lat < 10.36 and lng > -75.47;
  - **placeholder list** (within 1e-3): (10.4236,-75.5483), (10.3932277,-75.4832311), (10.3910,-75.4794), (10.3997,-75.5144). These are never "geocoded".

  The list lives in `events_gate.PLACEHOLDER_COORDS` and is mirrored in `frontend/src/lib/eventsFeed.ts`.
- Q6. `country_check` is recomputed only by pull and sentinel, from fresh text, and stored. `evaluate` on a stored doc uses the stored verdict and fails closed if it is missing. A stored `fail` becomes `hidden` with reason `country_fail`, which is sticky.

## R. Verification gate (final changes to §4)
- R1. **Sticky:** every `hidden` state, and `review` with any of these reasons: date_changed, conflict, country_fail, aggregator_only, partner_pending, long_span, stale_long, source_changed, legacy_unverified, merged. `evaluate()` returns them unchanged. Only these can clear them:
  - admin `approve`;
  - a sentinel re-parse in which ≥ 2 independent tier ≤ 3 pages agree on the new values in the same run.

  Every clear writes `city_events_log`.
- R2. **HIGH** requires either of these, and it counts only the **newest evidence entry per URL**:
  - (a) a tier 1–3 source whose **human-visible date text** (not JSON-LD alone) matches start_date, and start_time when one is set;
  - (b) a tier 1–3 source plus any tier ≤ 5 source that agrees.

  Two tier 4/5 sources alone give VERIFY. The `MIRRORS` groups count as ONE source: `{ipcc.gov.co, cartagena.gov.co}`, and `{eluniversal.com.co, qhubo…}`. **IPCC is tier 1**, because it is the official organizer of the Fiestas and the Agenda Cultural. It is mirror-grouped with the Alcaldía.
- R3. New rules:
  - 4b: `end_date − start_date > 21 days` with no parent_id and not an umbrella → `review` with reason `long_span`.
  - 4c: JSON-LD `start==end==fetch day` → discard that date as a placeholder.
  - 6b: `now − last_verified > 10 days` → `review` with reason `stale_long` (sticky, with an alert). A published VERIFY row must have `last_verified` within 10 days.
  - date_tbc: `today > tbc_window_end` → `expired`.
- R4. Read-time evaluation (§13 B) stays. The watchdog threshold is **26 h**, since the sentinel runs twice a day. When it trips: every row is served as VERIFY, reminders are refused, the legacy HIGH-only endpoints return `[]`, and a Telegram alert fires.
- R5. `notif_eligible` additionally requires all of these:
  - `parent_id` null, and not an umbrella;
  - `end_date − start_date ≤ 3 days`;
  - a single catalog or gazetteer venue;
  - `start_time` not null;
  - the time is confirmed by visible text (`time_confirmed: true`).

  Umbrellas and multi-venue rows have lat/lng null. Umbrellas are excluded from the Hoy/Noche buckets, from Luna's today/tonight/weekend ranges, and from every legacy endpoint.
- R6. `is_free` is true only when "gratis", "entrada libre" or "sin costo" appears in event_text, no price > 0 was parsed for the event, and the phrase is not qualified by "menores", "niños", "parqueadero", "envío", "hasta completar" or "zona".

## S. Adapters: time zones and markers (additions to §5)
- S1. `tz_policy` per adapter:

  | Adapter | Policy |
  |---|---|
  | ccc | microdata `meta[itemprop=startDate]` only. ICS is banned. 01:00 → null. Always add a cache-busting query. |
  | tuboleta / secutix | treat the JSON-LD suffix as local wall-clock. The time comes from `data-date` or visible text; if the two disagree, start_time is null. |
  | ironman | date only |
  | fever / latiquetera | honour an explicit `-05:00`; any other offset is a country FAIL |
  | all adapters | the placeholder times {00:00, 01:00, 07:00 (TuBoleta)} become null unless visible text states them |

  `time_confirmed` is true only when visible text states the time.
- S2. **Cancel markers** are matched only in the event-scoped block, with a per-adapter boilerplate denylist:
  - Set: `cancelad[oa]|suspendid[oa]|aplazad[oa]|postergad[oa]|reprogramad[oa]|cancel(l)?ed|postponed|called off`.
  - `finalizad[oa]` and `agotad[oa]` count only as the event's status element, never inside a price or stage block.
  - The sentinel never sets `expired`; only evaluate's date rule does.
- S3. **Sentinel outcomes** (final):

  | Outcome | Definition | Action |
  |---|---|---|
  | Success | HTTP 200, no challenge, AND the event-scoped date text parses to our start_date (and to start_time when set) | set `last_verified` and reset the counters |
  | not_found | 200, but the event block or date is absent | the first time: VERIFY immediately, not notif-eligible. Twice in a row: `review` with reason `source_changed` plus an instant alert |
  | blocked | 403/429/5xx/timeout; a redirect to cookieWarning, waiting-room or challenge; or a body matching `/Just a moment|Client Challenge|cf-mitigated|captcha/i` | no change to `last_verified`, but `blocked_days++`; a manual verify resets `blocked_days` |
  | gone | 404/410, or a redirect off the event slug | hide on the 2nd strike at least 6 h apart, with revival as in §13 G |
  | Parsed date or time change | | `review` with reason `date_changed` plus an instant alert. An automatic update happens only when ≥ 2 independent tier ≤ 3 pages agree in the same run. A time-only disagreement sets start_time to null and confidence to VERIFY. |

  Priority order: rows that start within 48 h and are notif-eligible first, then by `last_verified` ascending.
- S4. **Enrich validator:** the LLM output is rejected, and the old value kept, if it contains any of the following that is not verbatim in the source event_text: a digit sequence, a month or weekday, a time, a currency or price, a URL, a phone, an email, or a capitalized multi-word name. Title translations must preserve every digit. `date_tbc_note` is built from a template of `{month, year}` and never passes through the LLM. Luna gets structured fields only, never descriptions.

## T. Legacy (final)
- T1. **One-way cutover.** There is NO `legacy_hidden` flag. The legacy endpoints read ONLY city_events, via `events_legacy` and `public_view`: HIGH, published, future, not umbrella. The code never reads `db.events` or `db.concerts` on public paths again. `flags` keeps only `enabled` and `sources_disabled`.
  - A missing or unreadable flags doc means `enabled=false`, and every event surface is empty (fail-closed).
  - Rollout: deploy, then seed anchors, then run pull and sentinel, then verify through admin, then `PATCH flags {enabled: true}`.
- T2. Remove the invocation of `reminders.start_reminder_scheduler`, plus the invocations of `seed_concerts` and `seed_database`. They may stay only behind `ALLOW_DEV_SEED=1`, which refuses to run when MONGO_URL contains the prod cluster host `cluster0.i4uvhfv`.
- T3. Favorites: legacy event/concert ids hydrate to `{item_id, item_type, status: 'removed'}`, and toggle/add refuse legacy ids. `ce-` ids are accepted only when `public_view` gives published or date_tbc.
- T4. Partner surfaces: `/api/partner-events*`, `/api/experiences*` and the partner hits in `/api/search` require `moderation_status == 'approved'` explicitly, plus a future date and an approved venue. Delete `_migrate_stuck_pending_events` and the publish-first-on-LLM-failure branch. Luna drops `partner_events` and `live_tonight` from the context when `is_event`; otherwise it labels them "según el local". The partner → city_events path is **out of scope for v1**.
- T5. Static: delete `public/data/events.json`, `events/**`, `concerts.json` and `concerts/**`. Scrub `calendar.json` and `seasons.json` to `[]`.
  - Rewrites: `/data/events.json` → `/api/events`; `/data/concerts.json` → `/api/concerts`; `/data/concerts/dates.json` → `/api/concerts/dates`; `/data/concerts/genres.json` → `/api/concerts/genres`; the per-id `/data/events/<id>.json` → `/api/events/<id>` (fe-static tests the Vercel pattern syntax).
  - The new static feed lives at **`/data/events-feed.json`**, not under `events/`.
  - `frontend/scripts/check-no-legacy-events.mjs` fails, which blocks the deploy, if `public/data` or `dist/data` contains any id from the legacy backup or `evt_0`/`con_0`.
- T6. `POST /api/analytics/location` returns 204 WITHOUT storing anything, which covers existing binaries too. 1.1.2 removes the call. A test asserts that `location_pings` receives no insert.
- T7. `api.ts`: a 404 on `/events*` is final, with no static or swr fallback (owned by fe-nearby, since it owns api.ts).

## U. Reminders (final order, replaces §13 H2)
Per event, per run:
1. `public_view(now)` is notif-eligible, AND `last_verified ≥ today 00:00 Bogotá`, AND start_time is not null.
2. A live `recheck`, once per event per invocation and cached, must be Success. Otherwise suppress, log and send an instant alert.

Then, per user:
1. Skip missing or deleted users.
2. `insert_one event_reminders_sent {user_id, event_id, state: 'claimed'}`, which is the unique atomic claim.
3. Insert `event_push_log`. On a duplicate, delete the claim and stop.
4. Send.
5. Set state `sent`, or delete both rows if no channel succeeded.

Timing: the first tick in `[start−180, start−30] ∩ [09:00, 21:00]` Bogotá. No reminder is sent for a null start_time, and multi-day events are reminded on the first day only.

Prerequisites, which ship in the same change:
- `delete_account` purges `push_tokens` by `{owner_type: 'user', owner_id}`, plus `push_subscriptions`, `favorites`, `event_notif_prefs`, `event_push_log` and `event_reminders_sent`.
- Web push is sent only to subscriptions whose scope includes `events`.

## V. Luna (final additions to §9 and §13 I)
- V1. The hook, in `run_agent_turn`:
  - if `is_event` and `flags.enabled` is false → the maintenance decline;
  - elif `is_event` and there are no rows for the range → the no-events decline;
  - otherwise, inject.

  No LLM call happens on either decline.
- V2. **Prose guard** after every LLM reply. If the reply contains an event word (`concierto|festival|evento|show|fiesta|presentación|se presenta|toca|tocará|concert|gig|spectacle|espetáculo`) within 80 characters of a date or time token that does not appear in any injected `confirmed_events` row, the message is replaced by the deterministic grounded-list template. A time token by itself, as in a dinner answer, never triggers it.
- V3. Drop assistant turns created before the `EVENTS_ELITE_CUTOVER` timestamp (a constant) from the history fed to the LLM. Delete the stale lines at `ai_agent.py:1670`, `:1785` ("Fiestas arrancan el 6 de noviembre") and `:1897-1918`, along with the references to nonexistent keys. When `is_event`, suppress `curated_recommendations` for concert/festival categories. **Delete `upcoming_confirmed` from `_seasonal_context` entirely.**
- V4. Decline text lists `Confirmado:` (the top 3 HIGH rows) and `Sin confirmar:` (VERIFY rows). The footer adds one line per injected event whose id appears in the recommendations or actions, or whose title in any language appears as a substring of the message.

## W. Anchors (final additions to §6)
- W1. "Juan Luis Guerra (Festival Náutico)" becomes its own sub-event at VERIFY. It is never in the Náutico title, and it is never notif-eligible until a source dated within 7 days of the event confirms it. The Bando keeps `start_time = null` unless it is reconfirmed within 7 days.
- W2. Seeding never writes status, status_reason, dates, confidence or last_verified on an EXISTING doc. New evidence entries are appended with their original `fetched_at`. `anchor_version` gates updates of descriptive fields only.
- W3. Every anchor has a `recheck_url` that is reachable automatically. It is an HTML page; the IPCC post serves as the mirror for Alcaldía articles.

## X. Admin security
- X1. Cron routes accept ONLY Bearer `CRON_SECRET`.
- X2. Admin mutations require either an `Authorization: Bearer <admin session token>` header, or the cookie plus an `Origin` in the allowlist plus the header `X-AMO-Admin: 1`. Admin mutations are approve, hide, verify, flags, seed, import and any `?dry=0` run.
- X3. `approve` cannot override rules 1–2 or a tier-6-only row. `verify` requires `{evidence_url (tier ≤ 3), date_text}`; the server fetches that URL and must find `date_text` before it sets `last_verified`.
- X4. `gate-check` accepts only http(s) on ports 80/443. It resolves DNS and rejects private, loopback and link-local addresses, never follows a redirect to one, and keeps the 1.5 MB cap.
- X5. The Telegram helper logs only `type(exc).__name__` and the status code, never `str(exc)` or the URL. Alerts contain no state-changing links.

## Y. Open items for Phil
- Rotate the bot token: it was pasted into chat. Send `/revoke` to BotFather, and I will set the new one.
- Confirm that CRON_SECRET runs the existing crons; the first pull and sentinel runs will prove it through `city_events_runs`.

---

# §16 PROMINENCE, CLEAN CALENDAR, AUTONOMOUS OPS (Phil, 2026-09-29): SUPERSEDES earlier UI/ops text where it conflicts

Phil's direction: *"all the top events are always showing first, not just the recurring. We need to push and promote events, so make this clean. We want to push people to events and to what's happening in real time. The date and calendar must be clean and organized, not cluttered, easy to look at and easy to find what you're looking for."*

## 16.1 Prominence (backend, deterministic, in `events_gate`)
- New anchor/doc field `flagship: bool`. It marks the city's headline events. The flagship anchors are:
  - Cartagena Festival de Música 2027;
  - Hay Festival Cartagena 2027;
  - FICCI 66;
  - IRONMAN 70.3 Cartagena;
  - the Fiestas de Independencia 2026 umbrella;
  - the Gran Desfile/Bando;
  - the Festival Náutico.

  Juan Luis Guerra is NOT flagship while VERIFY. The pipeline may set flagship ONLY from a registry allowlist of organizer domains and series; it never comes from an LLM.
- `prominence(doc) -> int`, computed from these components:

  | Component | Points |
  |---|---|
  | Category: festival | 40 |
  | Category: concert | 35 |
  | Category: sports | 25 |
  | Category: cultural | 20 |
  | Category: gastronomic or family | 15 |
  | Category: nightlife or civic | 10 |
  | `flagship` | +50 |
  | `is_umbrella` | +10 |
  | Tier-1 source | +10 |
  | Confidence HIGH | +10 |
  | Sub-event (`parent_id` set) | −10 |
  | `origin == partner` | −5 |

  The function is pure, and the score is exposed on PublicEvent as `prominence` together with `flagship`.
- Every list sorts **within a day** by prominence (desc), then start_time (nulls last). `/api/events/featured`, the legacy feed for old binaries, sorts by prominence desc, then date, so top events come first there too. Luna's `get_confirmed_events` sorts by prominence desc, then date, within the requested range.
- **Recurring or evergreen rows are never promoted.** `long_span` rows stay in review, and anything flagged `series` gets prominence 0.

## 16.2 "Destacados": top events always first
- `eventsFeed.destacados(events, now, max=6)` selects published, dated rows that start within the next 90 days or are ongoing, and sorts them by prominence desc, then start_date asc.
  - An umbrella hides its own sub-events from Destacados, except a flagship sub-event starting within 7 days (e.g. the Bando in its week).
  - date_tbc rows are never included.
  - HIGH rows outrank VERIFY rows.
  - Rows with prominence ≤ 0 (series/recurring, "never promoted" in §16.1) are never included.
  - When fewer than `max` rows qualify inside the 90 days, the rail is backfilled with the flagship rows beyond the window (prominence desc, then start_date asc), so the city's headline festivals are always on the rail (amended 2026-09-29: on the real anchors only 3 rows fall inside 90 days and a stand-up show outranked three flagships).
- **/que-pasa** opens with a **Destacados** hero rail: large cards with image or category art, title, date range ("9–17 ene"), venue, and the trust line. The Hoy / Esta semana / Próximos control and the lists come below it.
- **Home**, in this order:
  1. **"Ahora en Cartagena"**, only when something is ongoing today or starts within 3 h. It gets an "En curso" or "Empieza a las 20:00" chip.
  2. **"Destacados"**: a rail of the top 6, which never disappears while the feed has rows.
  3. "Hoy" or the "Nada confirmado hoy · Ver todo" line.

  Never two empty slots. The 2×3 grid is unchanged.

## 16.3 Clean calendar
- **Esta semana**: a 7-day date strip. Each chip shows the weekday and day number, plus a dot/count when that day has events; tapping a chip filters to that day. The list shows day headers ("Hoy · mar 29 sep", "Mañana", "Sáb 3 oct").
- **Próximos** is grouped by month under sticky headers ("Octubre 2026 · 9 eventos"). Each row has a date-badge column on the left (the day number, plus a weekday abbreviation) and a compact card on the right: title in 2 lines max, venue, time, and category tint.
- **Umbrella festivals** (Fiestas de Independencia) appear as ONE group card: the name, the date range, "16 eventos del programa" and "Ver programa". The card expands in place into a day-grouped sub-list (rendered under the card as day blocks whose headers stick: "Jue 12 nov · Fiestas de Independencia"). On their own day (Hoy/Semana), sub-events also appear individually, with a small "Parte de: Fiestas de Independencia" tag. A **flagship sub-event** (the Bando, the Festival Náutico) is also listed as its own row in its real month of Próximos, with the same tag and the gold star; inside the program it is starred and sorts first within its day.
- **Counts:** every count (tab badge, day header, date-strip chip, month header, Agenda) counts EVENT rows only. An umbrella is a group card, never counted as an event; its own count is "N eventos del programa", and a month header whose card folds rows away reads "2 eventos · +16 del programa" (or "16 eventos del programa" when the card is the month's only item).
- One scroll row of category chips ("Todos" by default). No duplicate filters and no nested tabs.
- Visual rules: 16 px gutters, 12 px between cards, max 2 lines per title, one accent colour per category, no more than 3 badges per card, and no boxed empty states (one line plus a link).
- **Agenda tab ("Salir hoy")** uses the same 14-day date strip with count dots and the same row component, ordered flagship first within each day.
- All bucket and date math runs after mount, in Bogotá time (no SSR date text).

## 16.4 Autonomous operations (no Phil credentials needed)
- **`EVENTS_ADMIN_TOKEN`** is a new random 48-byte token in the backend Vercel env, stored locally only in `~/.claude/scripts/amo-events-admin.json` and never in git. Events admin routes accept `Authorization: Bearer <EVENTS_ADMIN_TOKEN>`, as do the cron routes, in addition to CRON_SECRET. It never comes from a cookie, so there is no CSRF risk. It amends §15 X1/X2.
- **Anchors as a source.** `pull` runs `seed_anchors` first (idempotent, §15 W2 rules) whenever the stored `anchors_version` differs from the file's. No manual seed is needed.
- **Self-healing crons** (UTC):
  - pull `*/10 * * * *`: runs one full pass per Bogotá day, and is a cheap no-op once `done`;
  - sentinel `*/15 * * * *`: runs a slot when no done sentinel run exists within 12 h, or when the 'today' slot for events starting today has not run since 16:00 UTC; otherwise a no-op;
  - reminders `*/15 * * * *`.

  The cron count stays within the limits.
- **Enabled default.** Env `EVENTS_ELITE_ENABLED=1` makes a MISSING flags doc read as enabled. A flags doc with `enabled: false` always wins as the kill switch, and a read error still means disabled (fail-closed).
