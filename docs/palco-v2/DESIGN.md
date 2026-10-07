# PALCO-V2 — ONE CREDENTIAL ENGINE (design contract v1, 2026-10-06)

If code and this doc disagree, the doc wins until amended here first.

**IP:** The engine is **MachineMind property** (PALCO Credential Engine v2), licensed into AMO
(and to the city) — never transferred. It lives in its own packages (`backend/palco/`,
`frontend/src/palco/`), every file carries the license header, and AMO **imports** it.
`backend/qr_credential.py` (PALCO1 scheme) is the engine's v1 tier — extended, never rebuilt.

## 0. Honesty spine (non-negotiable)

- **Every security claim a user or the city reads is a claim a test in this repo proves.**
  Banned in all UI/doc copy: "unhackable", "imposible de falsificar/hackear", "100% seguro",
  "inviolable", "unforgeable". Enforced by a source sweep test (pattern of the existing
  payments-language sweep). What we MAY say, because tests prove it: "código firmado en este
  dispositivo", "rota cada 10 segundos", "una captura de pantalla deja de servir en ≤20 s",
  "verificable sin señal".
- **No feature is shown as live before it is live.** Products carry `status: live |
  waiting_agreement`; `waiting_agreement` renders as "Próximamente" / "sujeto a acuerdo con
  el operador" — never a dead CTA, never a fake price.
- **PAYMENT GATE (hard):** no live charge until ALL of: AMO-01 fulfillment tests pass (§8) ·
  external pentest covers this engine · Wompi production approved · e-invoicing (DIAN) +
  refund policy + Ley 1581 consent exist. Until the gate opens every purchase surface reads
  "Próximamente" — no "Pago seguro" badges, no "Pagar" CTAs. (House rule since F-PAY-1/2.)
- **Residual risks are stated, not hidden.** The two-offline-validators window (§7) is
  documented in the city brief verbatim; DUPLICADO-OFFLINE is flagged on sync, not silently
  merged.
- **AMO informs where it doesn't operate.** Verticals without a signed issuer agreement keep
  the city-hub truth: AMO sells nothing there; copy + Luna say where to pay off-app.
- Nothing in any QR contains PII. Validators show the holder's first name from the
  server/manifest, never from the wire. Scan logs carry no PII (§7.4).

## 1. Product model — every purchasable thing is ONE kind of object

### 1.1 Credential (collection `credentials`)
```
{ cred_id: "crd_<12hex>", namespace: AMOEVT|AMORIDE|AMOPASS|AMOCIV (future AMOBUS),
  product_id, product_type: event_ticket|ride|pass|recharge,
  entitlement: { uses_total, uses_left, valid_from, valid_to, grace_min,
                 scope: { event_id? | route_id? | vessel_id? | operator_id? | monument_ids[]? } },
  holder: { user_id, phone_hash, display_name },      // display_name = first name shown at gate
  device_key_id,                                      // null ⇒ LEGACY tier (v1 HMAC wire)
  tier: "hw" | "legacy",
  status: issued|active|used|exhausted|transferred|revoked|refunded|expired,
  payment_id, issuer_id, price_cop, tax_cop,
  created_at, last_counter, transfer_count }
```
Legacy rows (`amo_tickets`, `city_passes`, `civic_demo_tickets`) stay where they are and are
served through the v1 adapter — they are NOT migrated in Stage A.

### 1.2 Product catalog = config, not code
`backend/data/palco_products.json` (single source, validated by loader at import; invalid
catalog ⇒ fail loud, engine refuses to issue). Per product: `product_id, product_type,
namespace, issuer_id, name (es/en), price_cop, tax_cop, entitlement template, transfer_rules
{ allowed, not_after_first_use, lock_minutes_before_start, max_transfers, require_named_id,
face_value_cap }, tier_floor: hw|legacy, status: live|waiting_agreement, agreement:
{ holder, signed_at, dimar_auth? } | null`.
Adding a vertical = adding a product config + an issuer agreement. Nothing else changes.

### 1.3 Issuers (collection-less registry inside the catalog)
AMO (events, passes) · each boat/water-taxi operator (DIMAR authorization stored on the
agreement — no DIMAR auth, no `live`) · ETCAR (monuments) · city (civic). Every credential
carries `issuer_id`; payouts and dashboards key on it.

## 2. Wire v2 — device-bound, rotating, replay-proof

```
AMO2.<cred_id>.<counter>.<key_id>.<sig>
```
- `counter = floor(epoch_seconds / 10)`, accepted at ±1 **against the VALIDATOR's clock**
  (holder clock manipulation buys ≤ ~20 s and nothing else). Strict grammar on v2:
  `^[0-9]{1,12}$` — no signs, no underscores, no unicode digits.
- `sig` = ECDSA P-256, raw r‖s (64 B) base64url (86 chars), over the UTF-8 string
  `"<namespace>|<cred_id>|<counter>|<key_id>"`. The namespace is INSIDE the signature
  (v1's HMAC omitted it; collections+regexes were the only separation).
- `key_id` = first 12 hex of SHA-256 of the device public key (JWK thumbprint input, RFC 7638).
- Total ≈ 131 chars — under the existing 200-char wire cap, low-density QR, sunlight-scannable.
- Signed ON DEVICE by a non-exportable P-256 key (iOS Secure Enclave / Android
  Keystore+StrongBox). The server stores ONLY public keys (`credential_devices`). The class
  of bug that leaked `qr_secret` (4 unprojected `city_passes` reads, fixed `688c7a89`)
  cannot exist: there is no server-side per-credential secret to leak on the hw tier.
- **Replay:** per-credential `last_counter` is monotonic server-side AND per offline
  validator. `counter ≤ last_counter` ⇒ DUPLICADO even inside the ±1 window. Counters are
  canonicalized (int → str) before comparison on BOTH tiers (v1's `int()` accepted
  `+1_0` spellings).
- **Offline by design:** the phone computes `counter` locally and signs without signal; the
  validator verifies against cached public keys from its manifest (§7). No polling on hw tier.
- **Clock integrity:** wallet stores a server-time delta (refreshed on any online call) and
  computes counters from corrected time; the Validador records the delta at manifest pull and
  tracks elapsed time with a monotonic clock.

## 3. Trust tiers + migration

- **hw** — v2 wire, device-bound. Required where `tier_floor: hw` (any paid product above the
  configured value floor).
- **legacy** — PALCO1-scheme wires (`AMOTKT1`/`AMOPASS1`/`AMOCIV1`, HMAC, online verify),
  allowed for low-value products only (config), labeled honestly in wallet + scanner
  ("credencial clásica — verificación en línea").
- Byte-compat is contractual: v1 grammar `<NS>.<id>.<counter>.<12hex>`, HMAC-SHA256(UTF-8 of
  hex secret, `"id|counter"`)[:12], vector `("tkt_demo1","s3cret",178080000) → 5d22f5379637`,
  10 s step ±1, polling shape `{wire, step_ms, expires_in_ms, …}` — all locked by existing
  tests that MUST stay green. Literal `PALCO1.` wires stay rejected.
- Migration: dual-accept per namespace → per-namespace cutover flags → v1-only wires refused
  (V6 proof). v1 RSVP tickets have no expiry ⇒ cutover per namespace waits until its
  outstanding v1 credentials settle (used / event past).

## 4. Verdicts (superset; backend + every client ship lockstep)

`VALIDO · DUPLICADO · FALSIFICADO · EXPIRADO · FUERA_DE_ALCANCE · REVOCADO · TRANSFERIDO ·
PASE · RECIBO`

Precedence (first match wins): malformed/unknown-credential/unknown-or-foreign-key/bad-sig →
FALSIFICADO · counter outside ±1 → EXPIRADO (`codigo_vencido`) · replay: counter ≤ last_counter
→ DUPLICADO (`repetido`; the advance is atomic on consume; **RECIBO products are exempt** —
receipts never admit, so "already seen" has no meaning for them) · status revoked/refunded →
REVOCADO · transferred → TRANSFERIDO · already used/exhausted (single-use) → DUPLICADO
(`ya_usada`, with first_used_at/first_gate) · scope mismatch (event/vessel/route/monument ∉
validator scope) → FUERA_DE_ALCANCE · now ∉ [valid_from−grace, valid_to+grace] or backing
event/sailing cancelled/absent → EXPIRADO with named reason (fail closed on missing data —
a credential whose backing state cannot be re-read is NEVER admitted: `estado_inaccesible`) ·
then admit: single-use → VALIDO (atomic flip) · counted pass → PASE with uses_left (atomic
decrement; exhausted → DUPLICADO `sin_usos`) · recharge → RECIBO.
- **Enrichment is in-scope-only, on EVERY verdict** (closure-audit amendment V-A4b,
  2026-10-06): the guest panel, `first_used_at`/`first_gate`, and any holder detail attach
  only when the scanner is in scope (own venue or government). An out-of-scope response
  carries the verdict alone, so a forged wire naming a real foreign credential is
  byte-identical to one naming a ghost — no existence oracle by status code OR body shape,
  and holder PII never crosses venues (§0).
- **Verify-only mode** (inspector/city) returns the verdict WITHOUT consuming: no flip, no
  decrement, no last_counter advance; logged as `mode:"verify"`.
- Every rejection carries a named `reason` (machine key + es/en line). The scanner shows it.
- **The pre-verify cross-venue 403 is retired**: scope mismatch is a VERDICT
  (FUERA_DE_ALCANCE) issued only after signature verification, killing the ticket-ID
  existence oracle.

## 5. Identity, wallet, transfer (P2 — Stage B scope, contract fixed now)

- Identity = verified WhatsApp number (OTP via **Meta Cloud API**; email OTP remains as
  fallback channel) + enrolled device. Consent (Ley 1581) recorded SERVER-SIDE at OTP:
  `{user_id, policy_version, consented_at, channel}` — the current client-only checkbox is
  not consent.
- Enrollment: server challenge (≥16 B) → `@expo/app-integrity` attestation (iOS App Attest /
  Android Play Integrity) covering SHA-256(challenge ‖ device_pubkey_jwk) → server verifies
  (pyattest / Play Integrity decode) → stores public JWK in `credential_devices`
  {device_key_id, user_id, platform, hw_tier: enclave|strongbox|tee, attested_at, status}.
  Emulators/rooted/re-signed apps fail attestation ⇒ cannot enroll (A4).
- ONE active device per credential. New phone = OTP re-bind: new enrollment, old key status
  → revoked, propagates via manifests (A14).
- Transfer: holder → recipient WhatsApp number → accept link → recipient OTP + enrollment →
  a NEW credential is minted bound to the recipient's device; the original flips
  TRANSFERIDO (dead at any gate, A6). Ledger (`credential_ledger`): from_phone_hash,
  to_phone_hash, device ids, ts, ip, reason — phone numbers only ever hashed
  (`palco.phone_hash`, HMAC-SHA256 with server pepper). Per-product rules from the catalog
  (§1.2). Buyer and issuer can read the chain.
- Deletion path (Ley 1581): `delete_account` extends to credentials (holder → tombstone),
  credential_devices, ledger rows (hash-tombstoned, chain integrity kept), scan logs carry no
  PII by construction. The found gaps (payments `wompi_raw`+email/name vs. the live privacy
  policy; `amo_tickets.holder_name`; `city_passes`) are closed in Stage B's A12 work.

## 6. Checkout + fulfillment (P3 — Stage D scope, contract fixed now)

- Wompi hosted/in-app widget (cards, PSE, Nequi, Bancolombia); AMO = merchant of record;
  per-issuer commission in the catalog; payouts keyed to issuer_id.
- **AMO-01 pattern (the only fulfillment path):** payment state ≠ fulfillment state. Atomic
  claim `find_one_and_update({payment_id, fulfillment_state:"pending"} → "claimed")`;
  exactly one credential set per payment; failed provisioning flips back RETRYABLE; a
  reconciler cron retries and Telegram-alerts paid-but-unfulfilled > 10 min. Closes
  CHANGELOG F-FAIL-1 (approved-before-fulfillment) and the webhook/poll double-fulfill race.
  Webhook additionally checks amount_in_cents + currency against the stored payment.
- Refund → credential REVOCADO; event cancelled → bulk revoke + notify holders; partial-use
  passes prorated per policy. Luna sells only `live` products and declines honestly otherwise.

## 7. AMO VALIDADOR (P4 — Stage C scope, contract fixed now)

1. Separate app target (sibling Expo app importing `frontend/src/palco/`): full-screen
   camera, verdict in ≤3 s (green/red/amber + sound + haptic + big text), manual wire entry
   as fallback. **No "Simular escaneo" in production builds.**
2. Enrollment by admin (QR + PIN), own device key, remotely revocable. Roles: operator
   (consumes) · inspector (verify-only) · supervisor (counts) · city (aggregates). Every
   validator is ASSIGNED a scope (event/vessel/route/monument/day) and cannot consume
   outside it (FUERA_DE_ALCANCE).
3. Offline: pre-shift SIGNED manifest (Ed25519, key `PALCO_MANIFEST_SK` server-side, public
   key pinned in the app) for its scope: credential ids, public keys, entitlements,
   revocations. Local use-once enforcement; scans queue and sync on any connectivity.
   **Stated residual:** two OFFLINE validators in the same scope could each accept one
   credential once before sync; sync flags DUPLICADO-OFFLINE for investigation. Mitigation:
   scope assignment + short sync windows. This limitation appears in the city brief.
4. Audit: immutable `palco_scan_log` (cred_id, validator_id, verdict, mode, ts, scope — NO
   PII). City dashboard = aggregates only; CSV export formula-escaped. Issuer dashboards see
   their own scope only.
5. Fraud ops → Telegram (Phil + Sergio, existing `telegram_alerts.py`): impossible geo/time
   velocity, transfer chains > N, repeated FALSIFICADO per validator/device, refund abuse,
   chargeback spikes. Device/phone blocklist. Chargeback discipline: protect the merchant
   account over recovering single disputes.

## 8. Adversarial matrix → proof mapping

| # | Case | Proven by |
|---|------|-----------|
| A1 | screenshot replayed >10 s → EXPIRADO | `test_palco_engine.py` (server) + device walk |
| A2 | same code at two gates inside window → 2nd DUPLICADO | engine test (monotonic last_counter) |
| A3 | cloned app, no enrolled key → FALSIFICADO | engine test (unknown key_id) + device walk |
| A4 | emulator/rooted enrollment refused | attestation verify tests (Stage B) + device walk |
| A5 | forged/tampered/wrong-ns/skewed → FALSIFICADO/EXPIRADO | engine tests |
| A6 | transferred cred: original TRANSFERIDO, recipient VALIDO | transfer tests (Stage B) + 2-phone walk |
| A7 | cancelled event / past validity / wrong vessel / missing data → named reject | engine tests (fail-closed re-read) |
| A8 | inspector verify-only consumes nothing | engine test |
| A9 | offline validator: accept → DUPLICADO → cross-validator flag on sync | Validador tests (Stage C) |
| A10 | revocation reaches next manifest | manifest tests (server half Stage A) |
| A11 | payment → exactly one credential; retry never 0 or 2; concurrent → one | fulfillment tests (Stage D) |
| A12 | account deletion → zero PII in credentials/ledger/scan logs | deletion tests (Stage B) |
| A13 | validator outside scope → FUERA_DE_ALCANCE | engine test |
| A14 | re-bind → old key dead | enrollment tests (Stage B) + device walk |

## 9. Payment-gate checklist (every line has an owner; none claimed done until proven)

| Item | Owner | Status 2026-10-06 |
|---|---|---|
| AMO-01 fulfillment tests pass (A11) | engine (Stage D) | not started |
| External pentest covers this engine | Phil commissions | not started |
| Wompi production approval (keys exist: NO — not even sandbox) | Phil | not started |
| DIAN e-invoicing per sale (company NIT "en trámite") | Phil + counsel | blocked on NIT |
| Refund policy published (es/en) | Phil + engine | not started |
| Ley 1581 server-side consent records | engine (Stage B) | not started |
| Day-to-day ops owner for refunds/revocations/fraud triage | Phil names | **unassigned** |

## 10. Stage layout

- **A (this drop): engine core, backend-first.** `backend/palco/` package · collections ·
  AMO2 verify pipeline (software-key testable) · v1 adapter dual-accept · catalog (events
  live, boats/monuments/carriages/water-taxi waiting_agreement, Transcaribe recharge-only
  and NEVER a purchasable bus fare before validator acceptance) · revocation · signed
  manifests (server half) · v1 hardening: prod-gated simulate-scan, scope-after-verify
  (403 oracle retired), City Pass mint race fix, RSVP atomic upsert + unique index (API
  backup first), counter canonicalization, verify-only endpoint · tests (§8 server rows) ·
  deploy + live probes.
- **B: iOS device binding + wallet + transfer + consent/deletion (binary 1.1.6, absorbs the
  committed OTA enablement).**
- **Play track (parallel):** Play Console org account, `com.amocartagena.app` internal
  testing AAB, listing + data-safety, Google Cloud project reserved. Android ENGINE work
  starts after iOS is fully complete (owner decision 2026-10-06); Android rides legacy tier
  meanwhile, labeled honestly.
- **C: AMO Validador** (second target + own listings; store scripts parametrized).
- **D: checkout sandbox-only** (gate stays closed; §6).
- **E: verticals live-vs-waiting in-app · civic view on the real engine · dual-accept
  cutover (V6) · Android enrollment on green-light.**

## 11. §14 Build plan & file ownership (Stage A)

- `backend/palco/*` — NEW, engine (license header mandatory).
- `backend/data/palco_products.json` — NEW, catalog.
- `backend/tickets.py` — EXTENDED: simulate gate, scope-after-verify, mint race, RSVP
  upsert, scan-log ticket_id, verify-only wiring. Wire/polling contract UNCHANGED.
- `backend/server.py` — mount `palco` router (same pattern as tickets, line ~8757) + env.
- `backend/requirements.txt` — + `cryptography`.
- `backend/tests/test_palco_engine.py`, `test_palco_compat.py` — NEW.
- `frontend/src/components/tickets/scannerApi.ts` + `app/business/scanner.tsx` — MINIMAL
  lockstep: verdict map += FUERA_DE_ALCANCE/REVOCADO/TRANSFERIDO (+ dict keys).
- Existing engine tests are the compat lock and MUST NOT be weakened.

## 12. Verify-on-live checklist (Stage A drop gate)

- V-A1 full backend suite green (incl. new engine tests) · `tsc --noEmit` 0.
- V-A2 live: v1 ticket QR poll + scan unchanged (old binaries 1.1.0–1.1.5 unaffected).
- V-A3 live: simulate-scan refused in prod (unless `PALCO_SIMULATE_ENABLED=1`).
- V-A4 live: cross-venue scan returns FUERA_DE_ALCANCE verdict (no 403 oracle).
- V-A5 live: `/api/palco/products` serves the catalog with honest statuses; no
  waiting_agreement product exposes a price CTA anywhere.
- V-A6 live: v2 namespaces reject unknown key_id (FALSIFICADO) — probed with a scripted wire.
- V-A7 banned-claims sweep green over frontend+backend sources.
- V-A8 alias moved (`vercel inspect`), DEPLOY-CARRIES-COMMIT, verify-images if frontend shipped.
- Builder never closes own drop: closure audit = separate session against this §.
