# CMW: Cartagena Music Week, in-app official program + concierge booking (design contract v1, 2026-09-29)

If code and this doc disagree, the doc wins until it is amended here first.

## 0. Honesty spine
- Cartagena Music Week (CMW) is AMO's own flagship event. **The source of truth is the official printed program**: the decks `DECK CARTAGENA MUSIC WEEK - ESPAÑOL.pdf` and `- ENGLISH.pdf`, created 2026-09-28. Text extracts are in `scratchpad/cmw/es.txt` and `en.txt`; page renders in `scratchpad/cmw/es/` and `en/`; the clean embedded photos in `scratchpad/cmw/img/`.
- Spelling follows the deck and the catalog: **Casa Bohême** (circumflex), **Bethel Bellini**.
- Only what the deck PRINTS is confirmed. Everything else shows **"Por confirmar"**. NEVER invent an artist, a lineup, a time, a price, an address, a boarding point or a venue. The "Very Special Guest" is never named, guessed or hinted at, anywhere: not in the data, the UI, Luna, the tests or the translations.
- Booking is **concierge-led**, exactly as the deck promises. There is NO checkout, NO payment and NO "confirmed" state until a human confirms. The honest state after a request is "Un concierge te contactará".
- CMW is a curated dataset, **separate from `city_events`**. A scraped or general event can never carry the CMW official badge, and CMW rows never pass through the scraper pipeline.

## 1. Facts printed in the deck (verbatim; the ONLY facts the app may state)
- **Dates:** "DIC 31, 2026 — ENE 07, 2027", "OCHO DÍAS" / "EIGHT DAYS".
- **Pillars** (six): Música · Cultura · Bienestar · Gastronomía · Mar · Personas (EN: Music · Culture · Wellness · Gastronomy · Ocean · People).
- **Taglines:**
  - "La historia se encuentra con nuevos ritmos." / "History meets new rhythms."
  - "Más que eventos. Un estilo de vida."
  - "Una ciudad. Una semana. Un estilo de vida."
  - "Aquí la música no es solo el evento. Es el hilo conductor."
- **Access:** "Asegura con anticipación tus entradas, mesas y experiencias VIP para los diferentes eventos oficiales de Cartagena Music Week. La información y asistencia estarán disponibles a través de AMO LIFE y nuestro equipo de concierge."
- **Concierge:** "Nuestro equipo está disponible para ayudarte durante toda la semana con reservas, traslados, experiencias y planes de último minuto." Services: Reservas · Servicio de conserje personal · Itinerarios a medida · Asistencia 24/7. **Contacto: +57 311 6844492**, "Nuestra asistente Valentina lo pondrá en contacto con el concierge oficial".
- **Practical info sections:** Cómo llegar (Aeropuerto Internacional Rafael Núñez, CTG), Dónde alojarse, Cómo desplazarse, Acceso a eventos, Botes y traslados.
- **Experiences:** Ciudad Amurallada · En el agua · Del día a la noche.
- **Islands:** Bellini Beach Club · Islas del Rosario · Barú · Nature & Adventure · Botes privados.

### 1.1 Calendar, exactly as printed on the calendar page (p. 5)
| id | date | title (as printed) | venue (as printed) | catalog venue | category | unannounced (→ "Por confirmar") |
|---|---|---|---|---|---|---|
| cmw-zamna-on-the-beach | 2026-12-31 | Zamna on the Beach | Bethel Bellini | Bethel Bellini Beach Club `ptr_dv_003` | party | time, price |
| cmw-casa-boheme-we-are-us | 2026-12-31 | Casa Bohême × We Are Us | Casa Bohême | `ptr_V014` (the catalog's "Casa Bohême") | party | time, price |
| cmw-after-new-year | 2027-01-01 | After New Year | not printed | none | after | **venue**, time, price |
| cmw-wellness | 2027-01-02 | Wellness | Bethel Bellini | `ptr_dv_003` | wellness | time, price |
| cmw-catamaran-sunset-party | 2027-01-02 | Catamaran Sunset Party | not printed | none | sunset | **boarding point**, time, price |
| cmw-stardust-by-saraga | 2027-01-03 | Stardust by Saraga | El Lago | none (not in the catalog) | party | time, price |
| cmw-main-event-jan-04 | 2027-01-04 | Main Event | not printed | none | main_event | **artist ("Very Special Guest")**, venue, time, price |
| cmw-main-event-after | 2027-01-05 | Main Event After | El Templo | none (not in the catalog) | after | time, price |
| cmw-main-event-jan-06 | 2027-01-06 | Main Event | not printed | none | main_event | **artist ("Very Special Guest")**, venue, time, price |
| cmw-after-temple | 2027-01-07 | After Temple | El Templo | none | after | time, price |

That is ten events over eight days. El Lago and El Templo have no address in the deck and are not in the catalog, so they have **no coordinates and no map pin**, and only the venue name is shown.

### 1.2 Known discrepancies. DECIDED by Phil 2026-09-29: the printed calendar page wins for all four (and for the dates). These are NOT open items.
1. The cover's small print says "DEC 30 / JAN 10"; the calendar page says Dec 31 – Jan 7, and "ocho días" matches that. → The app uses Dec 31 – Jan 7.
2. Phil's brief lists Casa Bohème × We Are Us on **Jan 1** (as the "After New Year"); the deck prints it under **Dec 31**.
3. Phil's brief lists the Catamaran Sunset Party on **Jan 3** (with Stardust); the deck prints it under **Jan 2**.
4. Phil's brief says the Zamna venue is to be confirmed; the deck prints **Bethel Bellini** under it.
5. Phil's brief says "Jan 6 Main Event + Temple after"; the deck prints "After Temple · El Templo" on **Jan 7**.

## 2. Data
- **`backend/data/cmw_program.json`** is committed and is the base truth:
  ```
  { "version": 1, "source_name": "Programa oficial Cartagena Music Week", "source_date": "2026-09-28",
    "brand": { "name", "start_date": "2026-12-31", "end_date": "2027-01-07", "tagline": L4, "taglines": [L4], "pillars": [{key, label: L4, icon}],
               "hero_image", "image_credit": "Cartagena Music Week", "concierge": {"whatsapp_e164": "+573116844492", "display": "+57 311 6844492", "assistant": "Valentina", "services": [L4]},
               "access_note": L4, "practical": [{key, title: L4, body: L4, link: "/ciudad" | null}] },
    "events": [ { "id", "date", "day_index" (1..8), "title" (as printed, not translated), "subtitle": L4|null,
                  "venue_name": str|null, "venue_id": str|null, "lat": null, "lng": null,
                  "category": "main_event|after|wellness|party|sunset|dining|island",
                  "status": "confirmed|tba",          // tba when venue or headline artist is unannounced
                  "time": null, "end_time": null, "artist": null | "Very Special Guest", "artist_status": "tba|confirmed|none",
                  "price_info": null, "booking_type": "concierge", "image", "image_credit", "description": L4,
                  "tba": ["time","price","venue","artist","boarding_point"]  // which fields render "Por confirmar"
                } ] }
  ```
  L4 means `{es, en, fr, pt}`. Titles stay exactly as printed, since they are brand names. Descriptions are ONE neutral sentence built only from section 1 facts, e.g. "Parte del programa oficial de Cartagena Music Week." plus the deck's pillar copy for wellness. While an artist, a venue or a boarding point is unannounced, a description may name no person and no place the program does not print (validate_program rejects it, for the base file and for overrides alike).
- Coordinates come ONLY from the catalog for catalog venues. Bethel Bellini and Casa Bohème are resolved at read time through the catalog by `venue_id`; they are not copied into the file.
- **Overrides:** Mongo `cmw_overrides {event_id, fields{...}, source_note, updated_at, updated_by}` is merged over the JSON at read time, and `cmw_log` records every change. To move a field from tba to confirmed, the override MUST carry the value and a non-empty `source_note` saying who confirmed it and when. An override can change time, end_time, artist, price_info, venue_name, venue_id, date, description, image and status. A `description` override needs a `source_note` too (it prints as fact); only `image` is free.
- **`cmw_requests`:** `{request_id "cmw-r-<8 base32>", event_id|null, event_title, name, party_size, contact{type: "whatsapp"|"email", value}, note, lang, user_id|null, status "received"|"contacted"|"confirmed"|"closed", created_at, created_at_dt, ip_hash, client}`. Index `request_id` unique, plus `created_at_dt`. `delete_account` purges rows by `user_id`.

## 3. API (every response is `{data, error, message}`)
- `GET /api/cmw/program` is public, with `_cache(300, swr=600)`. It returns the merged program plus `generated_at`. It never includes requests or logs.
- `POST /api/cmw/requests` is public.
  - Validation (pydantic): `name` 2–80 chars; `party_size` 1–50; `contact.type` whatsapp|email; `contact.value` a valid E.164-ish phone (7–15 digits) or an email; `note` ≤ 500; `event_id` must exist in the program or be null (a general enquiry); `lang` es|en|fr|pt; `consent` must be true; the honeypot field `website` must be empty.
  - Rate limits: 5 per hour per IP and 3 per hour per contact value; over the limit it returns 429 with a bilingual message.
  - It stores the row, then sends a Telegram alert (`telegram_alerts.send`) and the admin email (existing `emails.send_admin_alert`). Both are fire-safe: a failed alert never fails the request.
  - It returns `{request_id, status: "received", whatsapp_url}`, where `whatsapp_url = https://wa.me/573116844492?text=<prefilled, url-encoded>` names the event, date, party size and request id. It NEVER returns "confirmed".
- `GET /api/admin/cmw/requests?status=` and `PATCH /api/admin/cmw/requests/{id} {status}` require Bearer `EVENTS_ADMIN_TOKEN`.
- `PATCH /api/admin/cmw/events/{id}` writes overrides (Bearer `EVENTS_ADMIN_TOKEN`), and `GET /api/admin/cmw/log` reads the log.
- User-facing errors are bilingual (es + en). Internal error details are never exposed.

## 4. Frontend
- **Routes:** `/music-week` is the hub and `/music-week/[id]` the event detail. `/cmw`, `/musicweek` and `/Music-week` redirect to the hub with a 308. They need `vercel.json` rewrites and capitalised redirects, a `Stack.Screen` in `_layout.tsx`, and the deep link `amocartagena://music-week`.
- **`src/lib/cmw.ts`:**
  - the types;
  - `loadProgram()`, backend-first from `GET /cmw/program`, with the static mirror `${ASSET_ORIGIN}/data/cmw-program.json` as offline fallback and a module cache with a 10-minute TTL;
  - `phase(now)`: `'before' | 'during' | 'after'`, in Bogotá time;
  - `eventsOn(ymd)` and `todayEvents(now)`;
  - `whatsappUrl(event|null, lang, extras)`;
  - `tbaLabel(field)`;
  - `submitRequest(body)`.
- **Static mirror:** `frontend/scripts/sync-cmw-data.mjs` validates `backend/data/cmw_program.json` (all four languages present; no time, price or artist value on a field listed in `tba`; every `venue_id` exists in `public/data/partners.json`) and writes `frontend/public/data/cmw-program.json`. It runs before the web build.
- **Hub design:** match the deck. That means sunset amber, coral and gold over the app's dark background, white editorial serif display type for headings, generous spacing and premium photography. Per the project rule, the palette comes from the deck and is NOT a black-and-gold default. The hub contains, in order:
  1. A hero: deck photo, "CARTAGENA MUSIC WEEK", "31 dic 2026 — 7 ene 2027 · Ocho días", the tagline, a primary CTA "Ver programa" and a secondary CTA "Hablar con concierge".
  2. The six pillars as one clean row or grid.
  3. **Day by day:** an 8-chip date strip (Dec 31 → Jan 7); each day section shows its event cards.
  4. Experiences and islands, from the deck copy, linking to catalog venues where they exist.
  5. "Información práctica": Cómo desplazarse → `/ciudad`; Botes y traslados → `/ciudad` (the muelle module); Acceso a eventos (deck copy).
  6. The concierge card: services and the WhatsApp CTA.
- **Event card and detail:** title, day and date, venue or "Lugar por confirmar", time or "Hora por confirmar", the category chip, the image with its credit, and the badge **"Programa oficial"**. Main events show "Very Special Guest · artista por confirmar". Price shows "Consultar". CTA: **"Solicitar acceso"**. A catalog venue shows a "Ver lugar" link to `/partner/<venue_id>`. "Cómo llegar" appears only when the venue has catalog coordinates.
- **Request flow:** the CTA opens a sheet: name, party size (stepper), contact (WhatsApp number or email), an optional note, and the consent line "Al enviar, aceptas que el concierge de Cartagena Music Week te contacte." It POSTs, then shows the success state: "Solicitud recibida · Un concierge te contactará", the request id, and the button "Escribir por WhatsApp ahora" (opens `whatsapp_url`). If the POST fails, it shows a bilingual error plus the WhatsApp button, which still works with no request id. It never says "confirmado" or "reservado".
- **Home:** `src/components/cmw/CmwHomeCard.tsx` is self-contained and returns null once the phase is `after`.
  - `before`: a compact premium promo card, "Cartagena Music Week · 31 dic – 7 ene", linking to the hub.
  - `during`: the hero card "Hoy en Music Week" with today's events, mounted ABOVE the city events rails.
- **/que-pasa:** `src/components/cmw/CmwBanner.tsx` sits at the very top, above Destacados, in the `before` and `during` phases. CMW events are NEVER mixed into eventsFeed lists, and general events never show the "Programa oficial" badge.
- **Strings:** `src/i18n/autoTrCmw.ts` (es → en/fr/pt, tú voice), added to the `useTr` lookup chain.
- **Images:** chosen from `scratchpad/cmw/img/`, resized to ≤ 1400 px progressive JPEG (quality about 80, each ≤ 300 KB), self-hosted under `frontend/public/images/cmw/`, credited "Cartagena Music Week".
- **Frontend rules:** hooks above early returns; no module-scope Dimensions; WebHead only; SafeImage; date math after mount, in Bogotá time; tap targets ≥ 44 px; no horizontal scroll; ES/EN/FR at phone width.

## 5. Luna ("Valentina" is the concierge's assistant on WhatsApp; Luna is AMO's in-app AI)
- **`backend/luna_cmw.py`** is deterministic and makes NO LLM call for CMW questions.
  - `detect_cmw_intent(text, lang, now) -> {is_cmw, kind: program|day|event|tba|booking|directions, date|None, event_id|None}`.
  - `answer(program, intent, lang, now) -> assistant_payload`, in es/en/fr/pt.
- It is hooked at the top of `ai_agent.run_agent_turn`, **before** the general events gate, so `/agent/chat`, `/agent/taste` and `/search` all inherit it.
- **Answers:**
  - A day or program question lists the day's events with the venue, or "lugar por confirmar", and the time, or "hora por confirmar".
  - A TBA question gets "El artista aún está por confirmar — el concierge te puede ayudar", plus the concierge contact.
  - A booking question is routed to the concierge flow (the hub link plus the WhatsApp link). No checkout is mentioned.
  - A directions question gets a venue card for a catalog venue plus a link to `/ciudad`. Boat transfers are described only as "el concierge coordina los traslados" (the deck's copy).
- **Actions** use only types the existing binaries understand: `external_link` to `https://wa.me/573116844492?...` and to `https://www.amocartagena.co/music-week`, and `open_partner` for catalog venues. The Luna sanitizer's allowlist is extended to exactly those two URL prefixes.
- **Guard:** on any non-CMW turn where the LLM text mentions "Music Week", "Very Special Guest", Zamna, Stardust, Saraga or "We Are Us" together with a time, a price, a person's name, a place or a street address that is not in the program, or a sale / sold-out / age / dress-code / capacity claim, the text is replaced by the deterministic program answer. When the previous user turn was CMW and this turn reads as a short follow-up, the reply is checked as if it named Music Week. Any action to the hub or the concierge WhatsApp carries the deterministic label.
- **Detector:** the brand-unique tokens (Music Week, CMW, Zamna, Stardust, Saraga, We Are Us, Very Special Guest) make a turn CMW on their own; the printed titles that are also ordinary phrases (Main Event, After New Year, After Temple, Catamaran Sunset Party) only in Title Case, with a program date, or when the question names no venue, dish or other event ("brunch after New Year's Day" and "the main event at the Hay Festival" are not CMW).
- **/search:** the CMW gate runs BEFORE the city-events block of `/search`, so a Music Week question on the search bar gets the official program, never "no confirmed events".
- **city_events:** a scraped row that names Music Week (an anchor term in its title or description, or a printed title as its own title) is dropped at read time (`events_gate.cmw_conflict`) so only the curated program speaks about it.

## 6. Tests
Backend (pytest, no Atlas, no network):
- `test_cmw_program.py`: schema; exactly the ten rows of section 1.1; no value on any tba field; every L4 complete; no artist string other than "Very Special Guest"; merge and override rules.
- `test_cmw_requests.py`: validation, rate limits, honeypot, never "confirmed", the WhatsApp URL, alert failure tolerance, and the delete_account purge.
- `test_cmw_luna.py`: the three V5 cases in four languages, no LLM call, the guard, and a bank of at least 30 questions.

Frontend: `tsc`, `eslint`, the sync script's validation, and a Playwright sweep of the hub, an event detail and the request flow in ES/EN/FR at 390 px.
