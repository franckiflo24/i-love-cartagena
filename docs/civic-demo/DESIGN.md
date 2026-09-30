# CIVIC DEMO + PARTNER-FLAWLESS (design contract v1, 2026-09-30)

If code and this doc disagree, the doc wins until amended here first.

## 0. Honesty spine (non-negotiable)
- This is a **DEMONSTRATION for the Alcaldía/Distrito**, not a product. Every civic-demo screen
  wears a persistent `DEMO` badge + the line **"Demostración — ningún pago real. En el modelo
  propuesto, la entidad pública recauda directamente; AMO es el canal tecnológico."** Private-company
  framing per the gov-alignment rule: NEVER "programa del gobierno", no seals, no official branding.
- **The city is the merchant of record.** The demo's money story: user pays in-app → funds settle to
  the entity's account (Distrito/ETCAR/SITM) → AMO issues the QR credential. AMO never holds funds.
- The retired public port-tax product STAYS retired: `/port-tax/*` keeps its 410/redirects; the city
  hub keeps "AMO no vende ni opera"; **Luna never mentions or links the demo** (no triggers, no
  context injection — the demo is reached by URL/pitch, not discovery).
- Fares quoted in the demo come ONLY from `city_modules.json` facts, cited with confidence: HIGH
  states the decree; VERIFY says "aprox., confirma en taquilla". Nothing invented.
- Demo tickets are ephemeral (TTL 48 h), carry `demo: true`, and are excluded from every real
  surface (passport, bookings, analytics).

## 1. Partner self-service — FLAWLESS (workstream A)
Ceiling: **≤ 3 steps** per job-to-be-done, and a published thing is ALWAYS publicly visible or the
vendor sees exactly why not.
- **A1 Instant-publish guidance:** the event form shows the AUTO_APPROVE rubric inline ("para
  publicación inmediata: descripción ≥ N, hora, precio/gratis, categoría correcta") + a live
  "publicación inmediata ✓ / pasará a revisión" indicator derived from the same criteria the AI uses.
- **A2 Queue alerting (SHIPPED 2026-09-30):** every NEEDS_REVIEW/REJECT fires Telegram (ops chat)
  with venue, title, reason, backlog count, deep link `/business/admin/queue` — email alone left the
  queue dead 5+ weeks. Plus a daily pending-digest via `telegram_alerts.digest` if backlog > 0.
- **A3 Vendor notification:** on human approve/reject the vendor gets an email (emails.py) with the
  public link or the fix-list; portal submissions screen shows status + moderation_reason.
- **A4 Step audits:** account setup, event, photo flows each measured; any flow > 3 steps gets cut
  (findings from the funnel audit drive the exact edits).
- **A5 Public-visibility truth:** approved ⇒ visible on home rail/agenda/venue page within cache TTL
  (60 s); an approved-but-invisible state is structurally impossible (venue visibility gate is the
  only other filter and the portal warns when the VENUE itself is not public).

## 2. Civic demo (workstream B) — routes
`/gobierno` (hub, ES-first + EN): the pitch surface — model explainer (3-way split diagram:
ciudadano → paga → entidad recauda; AMO = canal + credencial QR), service cards, live "recaudo de
la demo" counter, link to validator. `/gobierno/pagar/[service]` demo checkout (fare from city
module, fee line "$0 — modelo por convenio", DEMO pay button, no card fields). `/gobierno/boleta/[id]`
the live credential (rotating QR + countdown ring + service + amount + "recaudó: <entidad>").
`/gobierno/validador` operator screen (paste/scan wire → verdict card VÁLIDO / DUPLICADO /
FALSIFICADO / EXPIRADO + guest/service panel + today's scan ledger). Services v1: `muelle`
(18.000 + 13.500 + seguro VERIFY), `transcaribe` (3.900 recarga), `monumentos` (Castillo ETCAR),
`taxis` (info-only card — fares fixed, no payment), `acuatico` (próximamente card), `citypass`
(AMO's own pass, marked "producto AMO, no municipal").

## 3. Security — the PALCO-proven credential (workstream B core)
- **Wire `AMOCIV1.<ticketId>.<counter>.<token>`** — the PALCO1 scheme ported byte-identically
  (proven cross-runtime: py `5d22f5379637` == node): counter = floor(epoch/10s), token =
  hex(HMAC-SHA256(secret, "ticketId|counter"))[:12], gate skew ±1 step. A screenshot dies in ≤20 s.
- Secrets are SERVER-ONLY (`db.civic_demo_tickets.qr_secret`); the client polls
  `GET /api/civic/demo/tickets/{id}/qr` each step and receives `{wire, matrix, expires_in_ms}` —
  matrix generated server-side (`qrcode` pure-py, no PIL), rendered client-side as SVG rects
  (react-native-svg, zero new frontend deps).
- **Atomic admission** (`POST /api/civic/demo/scan`, PALCO admit_ticket semantics): one Mongo
  `find_one_and_update` flips `issued→used` only on a valid current token; verdicts distinguish
  FALSIFICADO (bad HMAC) from EXPIRADO (genuine, stale) from DUPLICADO (valid code, already used —
  returns first-use time/gate). Every scan (incl. rejects) lands in `db.civic_demo_scans` — the
  validator's fraud feed.
- Production path documented in the pitch: **Ed25519 (PALCO2)** — server signs, gates hold only the
  public key and can never forge (already live in palco-core, migration 007). The demo copy says so.
- Endpoints rate-limited per IP; issue endpoint capped (≤10 live demo tickets/IP).

## 4. City Pass cleanup
Per audit findings: the tab reads clean at 390 px, plans honest ("Próximamente" while
payments_live=false), no retired promises; a "Visión ciudad" footnote links `/gobierno` discreetly.

## 5. Tests
Backend: derivation vectors (== the JS reference), verdict matrix incl. skew edges, duplicate
atomicity under concurrent scans, TTL expiry, retired `/port-tax/*` still 410, `/gobierno` data
quotes city-module facts verbatim (no drift), Luna: civic-demo terms trigger NOTHING (no context,
no gate), rate limits. Frontend: tsc, sync gates, live sweep ES/EN at 390 px.

## 6. Verify-live
Issue→rotate (watch token change ≤10 s)→validate VÁLIDO→re-validate DUPLICADO→tampered FALSIFICADO→
stale EXPIRADO; recaudo counter increments to the entity line; retired routes 410; Luna silent on
"tasa portuaria demo"; partner A1-A3 proofs (form indicator, Telegram ping, vendor email).
