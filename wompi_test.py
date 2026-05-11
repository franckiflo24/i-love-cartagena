"""
Backend tests for the new Wompi payment integration.
Endpoints under test:
  - GET  /api/payments/config
  - POST /api/payments/wompi/city-pass
  - POST /api/payments/wompi/port-tax
  - POST /api/payments/wompi/partner-event
  - POST /api/webhooks/wompi
  - GET  /api/payments/{payment_id}
  - GET  /api/payments/by-reference/{reference}
  - GET  /api/payments/my/list
  - GET  /api/business/admin/payouts

Run with:  python3 /app/wompi_test.py
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests
from dotenv import load_dotenv
from pymongo import MongoClient

# ── Load envs ─────────────────────────────────────────────────
load_dotenv(Path("/app/backend/.env"))
load_dotenv(Path("/app/frontend/.env"))

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
BACKEND_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("REACT_APP_BACKEND_URL")
)
assert BACKEND_URL, "EXPO_PUBLIC_BACKEND_URL not configured"
API = BACKEND_URL.rstrip("/") + "/api"

print(f"\n→ Using backend URL: {API}")

mongo = MongoClient(MONGO_URL)
db = mongo[DB_NAME]

# Fake Wompi sandbox keys we will patch into backend/.env
FAKE_KEYS = {
    "WOMPI_PUBLIC_KEY": "pub_test_TEST",
    "WOMPI_PRIVATE_KEY": "prv_test_TEST",
    "WOMPI_EVENTS_SECRET": "EVT_SECRET_TEST",
    "WOMPI_INTEGRITY_SECRET": "INTEG_SECRET_TEST",
}
PLACEHOLDER_KEYS = {
    "WOMPI_PUBLIC_KEY": "pub_test_REPLACE_ME",
    "WOMPI_PRIVATE_KEY": "prv_test_REPLACE_ME",
    "WOMPI_EVENTS_SECRET": "REPLACE_ME_EVENTS_SECRET",
    "WOMPI_INTEGRITY_SECRET": "REPLACE_ME_INTEGRITY_SECRET",
}


def patch_env(values: dict) -> None:
    """Rewrite /app/backend/.env with new Wompi key values and restart backend."""
    env_path = Path("/app/backend/.env")
    lines = env_path.read_text().splitlines()
    out = []
    seen = set()
    for ln in lines:
        if "=" in ln and not ln.strip().startswith("#"):
            k = ln.split("=", 1)[0].strip()
            if k in values:
                out.append(f"{k}={values[k]}")
                seen.add(k)
                continue
        out.append(ln)
    for k, v in values.items():
        if k not in seen:
            out.append(f"{k}={v}")
    env_path.write_text("\n".join(out) + "\n")


def restart_backend() -> None:
    subprocess.run(["sudo", "supervisorctl", "restart", "backend"], check=True, capture_output=True)
    # Wait for backend to be back
    for _ in range(30):
        try:
            r = requests.get(API + "/payments/config", timeout=3)
            if r.status_code == 200:
                return
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError("Backend failed to come back after restart")


def create_test_user(name: str, email_prefix: str) -> tuple[str, str, str]:
    """Returns (user_id, email, session_token)."""
    user_id = f"test_{uuid.uuid4().hex[:12]}"
    email = f"{email_prefix}.{uuid.uuid4().hex[:6]}@amocartagena.test"
    session_token = f"st_test_{uuid.uuid4().hex}"
    db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": name,
        "picture": "",
        "favorites": [],
        "my_week": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    return user_id, email, session_token


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


RESULTS: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    status = "PASS" if ok else "FAIL"
    RESULTS.append((name, ok, detail))
    print(f"  [{status}] {name}{(' — ' + detail) if detail else ''}")


def section(title: str) -> None:
    print(f"\n=== {title} ===")


# ─────────────────────────────────────────────────────────────
# Tracking lists for cleanup
CREATED_USERS: list[str] = []
CREATED_SESSIONS: list[str] = []
CREATED_FAKE_PAYMENTS: list[str] = []
CREATED_PARTNER_EVENT: str | None = None
CREATED_CITY_PASSES: list[str] = []
CREATED_PARTNER_BOOKINGS: list[str] = []
CREATED_PORT_TAX_TICKETS: list[str] = []
CREATED_PAYMENTS_FROM_API: list[str] = []


def mk_user(name: str, prefix: str) -> tuple[str, str, str]:
    uid, email, tok = create_test_user(name, prefix)
    CREATED_USERS.append(uid)
    CREATED_SESSIONS.append(tok)
    return uid, email, tok


# ─────────────────────────────────────────────────────────────
def test_config_unconfigured():
    section("1/A — GET /payments/config WITHOUT keys (placeholders)")
    r = requests.get(API + "/payments/config", timeout=10)
    record("status 200", r.status_code == 200, f"got {r.status_code}")
    j = r.json() if r.status_code == 200 else {}
    record("enabled == False", j.get("enabled") is False, f"got {j.get('enabled')}")
    record("env == 'sandbox'", j.get("env") == "sandbox", f"got {j.get('env')}")
    record("public_key empty", j.get("public_key") == "", f"got {j.get('public_key')!r}")
    record("commission_pct == 3.0", float(j.get("commission_pct", 0)) == 3.0, f"got {j.get('commission_pct')}")
    return j


def test_unconfigured_503():
    section("1/B — Payment endpoints return 503 when not configured")
    uid, email, tok = mk_user("Lucia Acosta", "lucia")
    r = requests.post(API + "/payments/wompi/city-pass",
                      json={"plan_id": "pass_classic"},
                      headers=auth_headers(tok), timeout=10)
    record("city-pass → 503 when unconfigured", r.status_code == 503,
           f"got {r.status_code}: {r.text[:150]}")
    detail = ""
    try:
        detail = (r.json() or {}).get("detail", "")
    except Exception:
        pass
    record("503 message contains 'Wompi no está configurado'",
           "Wompi no está configurado" in detail, f"got {detail!r}")

    r2 = requests.post(API + "/payments/wompi/port-tax",
                       json={"qty": 2, "travel_date": "2030-01-15"},
                       headers=auth_headers(tok), timeout=10)
    record("port-tax → 503 when unconfigured", r2.status_code == 503,
           f"got {r2.status_code}")

    r3 = requests.post(API + "/payments/wompi/partner-event",
                       json={"event_id": "pe_001", "qty": 2},
                       headers=auth_headers(tok), timeout=10)
    record("partner-event → 503 when unconfigured", r3.status_code == 503,
           f"got {r3.status_code}")


# ─────────────────────────────────────────────────────────────
def test_config_with_keys():
    section("2 — GET /payments/config WITH test keys patched")
    r = requests.get(API + "/payments/config", timeout=10)
    record("status 200", r.status_code == 200)
    j = r.json() if r.status_code == 200 else {}
    record("enabled == True", j.get("enabled") is True, f"got {j.get('enabled')}")
    record("env == 'sandbox'", j.get("env") == "sandbox", f"got {j.get('env')}")
    pk = j.get("public_key") or ""
    record("public_key startswith 'pub_test_'", pk.startswith("pub_test_"), f"got {pk!r}")
    record("commission_pct == 3.0", float(j.get("commission_pct", 0)) == 3.0,
           f"got {j.get('commission_pct')}")
    return j


def test_city_pass_with_keys():
    section("3 — POST /payments/wompi/city-pass (configured)")
    uid, email, tok = mk_user("Mariana Pérez", "mariana")

    # No auth → 401
    r0 = requests.post(API + "/payments/wompi/city-pass",
                       json={"plan_id": "pass_classic"}, timeout=10)
    record("no auth → 401", r0.status_code == 401, f"got {r0.status_code}")

    # Invalid plan → 400
    r_bad = requests.post(API + "/payments/wompi/city-pass",
                          json={"plan_id": "pass_notexist"},
                          headers=auth_headers(tok), timeout=10)
    record("invalid plan_id → 400", r_bad.status_code == 400, f"got {r_bad.status_code}")

    # Happy path
    r = requests.post(API + "/payments/wompi/city-pass",
                      json={"plan_id": "pass_classic"},
                      headers=auth_headers(tok), timeout=15)
    record("classic plan → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    p = r.json() if r.status_code == 200 else {}
    record("returns checkout_url", bool(p.get("checkout_url")), "")
    record("checkout_url contains pub_test_TEST", "pub_test_TEST" in (p.get("checkout_url") or ""), "")
    record("reference starts with 'PAY-'", (p.get("reference") or "").startswith("PAY-"), "")
    record("payment_id present", bool(p.get("payment_id")), "")
    record("amount_cop == 200000", int(p.get("amount_cop", 0)) == 200000, f"got {p.get('amount_cop')}")
    split = p.get("split") or {}
    record("split.gross == 200000", split.get("gross") == 200000, f"got {split.get('gross')}")
    record("split.app_commission == 0 (city_pass, no commission)",
           split.get("app_commission") == 0, f"got {split.get('app_commission')}")
    record("split.partner_amount == 200000",
           split.get("partner_amount") == 200000, f"got {split.get('partner_amount')}")
    record("split.commission_pct == 0.0 (city_pass)",
           float(split.get("commission_pct", -1)) == 0.0, f"got {split.get('commission_pct')}")
    if p.get("payment_id"):
        CREATED_PAYMENTS_FROM_API.append(p["payment_id"])
    return p, tok, uid


def test_port_tax_with_keys():
    section("4 — POST /payments/wompi/port-tax (configured)")
    uid, email, tok = mk_user("Tomás Rivera", "tomas")

    # validations: qty=0 → 400
    r1 = requests.post(API + "/payments/wompi/port-tax",
                       json={"qty": 0, "travel_date": "2030-02-10"},
                       headers=auth_headers(tok), timeout=10)
    record("qty=0 → 400", r1.status_code == 400, f"got {r1.status_code}")

    # qty=25 → 400
    r2 = requests.post(API + "/payments/wompi/port-tax",
                       json={"qty": 25, "travel_date": "2030-02-10"},
                       headers=auth_headers(tok), timeout=10)
    record("qty=25 → 400", r2.status_code == 400, f"got {r2.status_code}")

    # travel_date missing → 400
    r3 = requests.post(API + "/payments/wompi/port-tax",
                       json={"qty": 2},
                       headers=auth_headers(tok), timeout=10)
    record("missing travel_date → 400", r3.status_code == 400, f"got {r3.status_code}")

    # Happy: qty=3
    cfg = db.port_tax_config.find_one({"active": True}, {"_id": 0}) or {}
    price_per = int(cfg.get("price_per_person") or 31500)
    r = requests.post(API + "/payments/wompi/port-tax",
                      json={"qty": 3, "travel_date": "2030-02-20",
                            "passengers": ["A", "B", "C", "D"]},
                      headers=auth_headers(tok), timeout=15)
    record("happy path → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    p = r.json() if r.status_code == 200 else {}
    record("amount_cop == price*qty",
           int(p.get("amount_cop", 0)) == price_per * 3,
           f"got {p.get('amount_cop')} vs expected {price_per * 3}")
    record("returns checkout_url", bool(p.get("checkout_url")))
    record("reference starts with 'PAY-'", (p.get("reference") or "").startswith("PAY-"))
    split = p.get("split") or {}
    record("split.commission_pct == 0.0 (port_tax)",
           float(split.get("commission_pct", -1)) == 0.0, f"got {split.get('commission_pct')}")
    record("split.app_commission == 0", split.get("app_commission") == 0)
    if p.get("payment_id"):
        CREATED_PAYMENTS_FROM_API.append(p["payment_id"])
    return p, tok, uid


def test_partner_event_with_keys():
    section("5 — POST /payments/wompi/partner-event (configured)")
    uid, email, tok = mk_user("Daniela Mejía", "daniela")

    # Free event → 400
    r_free = requests.post(API + "/payments/wompi/partner-event",
                           json={"event_id": "pe_007", "qty": 1},
                           headers=auth_headers(tok), timeout=10)
    record("free event → 400", r_free.status_code == 400, f"got {r_free.status_code}")

    # Unknown event → 404
    r_unk = requests.post(API + "/payments/wompi/partner-event",
                          json={"event_id": "pe_notexist", "qty": 1},
                          headers=auth_headers(tok), timeout=10)
    record("unknown event → 404", r_unk.status_code == 404, f"got {r_unk.status_code}")

    # Paid event (regular partner, NOT government) → commission_pct=3.0
    # Use pe_002 (ptr_005, 60000 COP)
    r = requests.post(API + "/payments/wompi/partner-event",
                      json={"event_id": "pe_002", "qty": 2},
                      headers=auth_headers(tok), timeout=15)
    record("paid regular-partner event → 200", r.status_code == 200,
           f"got {r.status_code}: {r.text[:200]}")
    p = r.json() if r.status_code == 200 else {}
    record("amount_cop == 60000*2", int(p.get("amount_cop", 0)) == 120000,
           f"got {p.get('amount_cop')}")
    split = p.get("split") or {}
    record("commission_pct == 3.0 (regular partner)",
           float(split.get("commission_pct", -1)) == 3.0,
           f"got {split.get('commission_pct')}")
    expected_comm = int(round(120000 * 0.03))
    record(f"app_commission == {expected_comm}",
           split.get("app_commission") == expected_comm,
           f"got {split.get('app_commission')}")
    record("partner_amount == gross - commission",
           split.get("partner_amount") == 120000 - expected_comm,
           f"got {split.get('partner_amount')}")
    if p.get("payment_id"):
        CREATED_PAYMENTS_FROM_API.append(p["payment_id"])

    # Government partner (ptr_alcaldia) → commission_pct=0
    # We need a PAID alcaldia event; insert one temporarily.
    global CREATED_PARTNER_EVENT
    CREATED_PARTNER_EVENT = f"pe_test_{uuid.uuid4().hex[:8]}"
    db.partner_events.insert_one({
        "event_id": CREATED_PARTNER_EVENT,
        "partner_id": "ptr_alcaldia",
        "title": "Gala institucional (test)",
        "category": "cultura",
        "date": "2030-03-15",
        "start_time": "20:00",
        "is_free": False,
        "price": 50000,
        "currency": "COP",
        "moderation_status": "approved",
        "is_published": True,
        "views_count": 0,
        "reserve_clicks": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    r_gov = requests.post(API + "/payments/wompi/partner-event",
                          json={"event_id": CREATED_PARTNER_EVENT, "qty": 1},
                          headers=auth_headers(tok), timeout=15)
    record("government partner event → 200", r_gov.status_code == 200,
           f"got {r_gov.status_code}: {r_gov.text[:200]}")
    pg = r_gov.json() if r_gov.status_code == 200 else {}
    sp = pg.get("split") or {}
    record("commission_pct == 0.0 (government partner)",
           float(sp.get("commission_pct", -1)) == 0.0,
           f"got {sp.get('commission_pct')}")
    record("app_commission == 0 for government", sp.get("app_commission") == 0)
    if pg.get("payment_id"):
        CREATED_PAYMENTS_FROM_API.append(pg["payment_id"])

    return p, tok, uid


def test_payment_lookup(city_pass_payment: dict, tok: str):
    section("6 — GET /payments/{payment_id} & /payments/by-reference/{ref}")
    pid = city_pass_payment["payment_id"]
    ref = city_pass_payment["reference"]

    r0 = requests.get(API + f"/payments/{pid}", timeout=10)
    record("no auth → 401", r0.status_code == 401, f"got {r0.status_code}")

    r = requests.get(API + f"/payments/{pid}", headers=auth_headers(tok), timeout=15)
    record(f"GET /payments/{{id}} with auth → 200", r.status_code == 200, f"got {r.status_code}")
    j = r.json() if r.status_code == 200 else {}
    record("status still 'pending'", j.get("status") == "pending", f"got {j.get('status')}")
    record("payment_id matches", j.get("payment_id") == pid)

    r0b = requests.get(API + f"/payments/by-reference/{ref}", timeout=10)
    record("by-reference no auth → 401", r0b.status_code == 401, f"got {r0b.status_code}")

    rb = requests.get(API + f"/payments/by-reference/{ref}", headers=auth_headers(tok), timeout=15)
    record("GET /by-reference with auth → 200", rb.status_code == 200, f"got {rb.status_code}")
    jb = rb.json() if rb.status_code == 200 else {}
    record("returns matching reference", jb.get("reference") == ref)


def test_my_list(tok: str):
    section("7 — GET /payments/my/list")
    r0 = requests.get(API + "/payments/my/list", timeout=10)
    record("no auth → 401", r0.status_code == 401, f"got {r0.status_code}")
    r = requests.get(API + "/payments/my/list", headers=auth_headers(tok), timeout=15)
    record("with auth → 200", r.status_code == 200, f"got {r.status_code}")
    j = r.json() if r.status_code == 200 else []
    record("returns a list", isinstance(j, list), f"got {type(j).__name__}")
    record("at least 1 payment (city_pass created earlier)", len(j) >= 1, f"got {len(j)}")


def _build_wompi_webhook_payload(reference: str, amount_cop: int, status: str = "APPROVED") -> dict:
    """Build a Wompi-style event payload with a valid signature for our fake EVENTS_SECRET."""
    secret = FAKE_KEYS["WOMPI_EVENTS_SECRET"]
    tx_id = f"wt_test_{uuid.uuid4().hex[:10]}"
    amount_in_cents = amount_cop * 100
    timestamp = int(time.time())
    properties = ["transaction.id", "transaction.status", "transaction.amount_in_cents"]
    concat = f"{tx_id}{status}{amount_in_cents}{timestamp}{secret}"
    checksum = hashlib.sha256(concat.encode("utf-8")).hexdigest().upper()
    return {
        "event": "transaction.updated",
        "data": {
            "transaction": {
                "id": tx_id,
                "status": status,
                "amount_in_cents": amount_in_cents,
                "reference": reference,
                "currency": "COP",
                "payment_method": {"type": "CARD"},
            }
        },
        "timestamp": timestamp,
        "signature": {
            "properties": properties,
            "checksum": checksum,
        },
        "environment": "test",
        "sent_at": datetime.now(timezone.utc).isoformat(),
    }


def test_webhook(city_pass_payment: dict, user_id: str):
    section("8 — POST /webhooks/wompi (signature + idempotency)")
    ref = city_pass_payment["reference"]
    amount = city_pass_payment["amount_cop"]

    # Invalid signature → 401
    bad_payload = _build_wompi_webhook_payload(ref, amount, status="APPROVED")
    bad_payload["signature"]["checksum"] = "0" * 64
    r0 = requests.post(API + "/webhooks/wompi", json=bad_payload, timeout=15)
    record("invalid signature → 401", r0.status_code == 401, f"got {r0.status_code}")

    # Valid signature → 200, payment becomes approved, city pass created
    payload = _build_wompi_webhook_payload(ref, amount, status="APPROVED")
    r = requests.post(API + "/webhooks/wompi", json=payload, timeout=15)
    record("valid signature → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")

    # Verify DB state
    p = db.payments.find_one({"reference": ref}, {"_id": 0})
    record("DB payment.status == 'approved'", (p or {}).get("status") == "approved",
           f"got {(p or {}).get('status')}")
    record("DB payment.webhook_received == True", (p or {}).get("webhook_received") is True)
    record("DB payment.paid_at set", bool((p or {}).get("paid_at")))
    record("DB payment.wompi_status == 'APPROVED'", (p or {}).get("wompi_status") == "APPROVED")

    cp = db.city_passes.find_one({"user_id": user_id, "is_active": True}, {"_id": 0})
    record("city_pass row inserted for user (fulfillment)", bool(cp),
           f"found pass_id={cp.get('pass_id') if cp else None}")
    if cp:
        CREATED_CITY_PASSES.append(cp.get("pass_id"))
        record("city_pass linked to payment", cp.get("payment_id") == city_pass_payment["payment_id"],
               f"got {cp.get('payment_id')}")

    # Idempotency: send the same event again
    payload2 = _build_wompi_webhook_payload(ref, amount, status="APPROVED")
    r2 = requests.post(API + "/webhooks/wompi", json=payload2, timeout=15)
    record("second webhook → 200 (idempotent)", r2.status_code == 200, f"got {r2.status_code}")
    cp_count = db.city_passes.count_documents({"user_id": user_id, "is_active": True})
    record("still exactly 1 active city pass (no duplicate fulfillment)",
           cp_count == 1, f"got {cp_count}")


# ─────────────────────────────────────────────────────────────
def test_payouts():
    section("9 — GET /business/admin/payouts (government-only)")

    # 1. No token → 401
    r0 = requests.get(API + "/business/admin/payouts", timeout=10)
    record("no token → 401", r0.status_code == 401, f"got {r0.status_code}")

    # 2. Regular partner token → 403
    biz_r = requests.post(API + "/business/login",
                          json={"email": "casaboheme@amocartagena.app",
                                "password": "amocartagena2026"},
                          timeout=15)
    record("regular partner login → 200", biz_r.status_code == 200, f"got {biz_r.status_code}")
    biz_tok = (biz_r.json() or {}).get("token", "") if biz_r.status_code == 200 else ""
    r1 = requests.get(API + "/business/admin/payouts",
                      headers={"Authorization": f"Bearer {biz_tok}"}, timeout=10)
    record("regular partner → 403", r1.status_code == 403, f"got {r1.status_code}")

    # 3. Alcaldía token → 200
    alc_r = requests.post(API + "/business/login",
                          json={"email": "alcaldia@amocartagena.app",
                                "password": "AlcaldiaCTG2026!"},
                          timeout=15)
    record("alcaldia login → 200", alc_r.status_code == 200, f"got {alc_r.status_code}")
    alc_tok = (alc_r.json() or {}).get("token", "") if alc_r.status_code == 200 else ""

    # Empty state (no partner_event approved payments yet)
    # Clean any pre-existing approved partner_event payments from a previous run to be safe
    r2 = requests.get(API + "/business/admin/payouts",
                      headers={"Authorization": f"Bearer {alc_tok}"}, timeout=15)
    record("alcaldia → 200", r2.status_code == 200, f"got {r2.status_code}")
    j = r2.json() if r2.status_code == 200 else {}
    record("response has 'rows', 'totals', 'currency'",
           all(k in j for k in ("rows", "totals", "currency")),
           f"got keys={list(j.keys())}")
    record("currency == 'COP'", j.get("currency") == "COP")

    # 4. Insert a fake approved partner_event payment and re-aggregate
    fake_pid = f"pay_fake_{uuid.uuid4().hex[:10]}"
    fake_ref = f"PAY-FAKE-{uuid.uuid4().hex[:10].upper()}"
    CREATED_FAKE_PAYMENTS.append(fake_pid)
    db.payments.insert_one({
        "payment_id": fake_pid,
        "reference": fake_ref,
        "user_id": "user_fake_test",
        "kind": "partner_event",
        "partner_id": "ptr_002",
        "is_government": False,
        "amount_cop": 100000,
        "currency": "COP",
        "split": {
            "gross": 100000,
            "app_commission": 3000,
            "partner_amount": 97000,
            "commission_pct": 3.0,
        },
        "description": "Test partner event",
        "metadata": {"event_id": "test_event"},
        "status": "approved",
        "provider": "wompi",
        "wompi_env": "sandbox",
        "wompi_transaction_id": "wt_fake_test",
        "wompi_status": "APPROVED",
        "checkout_url": "https://fake",
        "webhook_received": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "paid_at": datetime.now(timezone.utc).isoformat(),
    })

    r3 = requests.get(API + "/business/admin/payouts",
                      headers={"Authorization": f"Bearer {alc_tok}"}, timeout=15)
    record("alcaldia → 200 (after fake payment)", r3.status_code == 200, f"got {r3.status_code}")
    j3 = r3.json() if r3.status_code == 200 else {}
    rows = j3.get("rows") or []
    row_002 = next((r for r in rows if r.get("partner_id") == "ptr_002"), None)
    record("ptr_002 row present", row_002 is not None,
           f"rows={[r.get('partner_id') for r in rows]}")
    if row_002:
        record("row.gross_cop == 100000", row_002.get("gross_cop") == 100000,
               f"got {row_002.get('gross_cop')}")
        record("row.app_commission_cop == 3000",
               row_002.get("app_commission_cop") == 3000,
               f"got {row_002.get('app_commission_cop')}")
        record("row.partner_amount_cop == 97000",
               row_002.get("partner_amount_cop") == 97000,
               f"got {row_002.get('partner_amount_cop')}")
        record("partner_name enriched (not '—')",
               (row_002.get("partner_name") or "") not in ("", "—"),
               f"got {row_002.get('partner_name')}")
    totals = j3.get("totals") or {}
    record("totals.gross_cop >= 100000",
           int(totals.get("gross_cop", 0)) >= 100000, f"got {totals.get('gross_cop')}")
    record("totals.app_commission_cop >= 3000",
           int(totals.get("app_commission_cop", 0)) >= 3000,
           f"got {totals.get('app_commission_cop')}")
    record("totals.partner_owed_cop >= 97000",
           int(totals.get("partner_owed_cop", 0)) >= 97000,
           f"got {totals.get('partner_owed_cop')}")


# ─────────────────────────────────────────────────────────────
def cleanup():
    section("CLEANUP")
    # 1. Revert .env to placeholders
    patch_env(PLACEHOLDER_KEYS)
    print("  ✓ /app/backend/.env reverted to REPLACE_ME placeholders")
    # 2. Drop test users + sessions + payments + fulfillments
    if CREATED_USERS:
        db.users.delete_many({"user_id": {"$in": CREATED_USERS}})
        db.user_sessions.delete_many({"user_id": {"$in": CREATED_USERS}})
        db.payments.delete_many({"user_id": {"$in": CREATED_USERS}})
        db.city_passes.delete_many({"user_id": {"$in": CREATED_USERS}})
        db.port_tax_tickets.delete_many({"user_id": {"$in": CREATED_USERS}})
        db.partner_bookings.delete_many({"user_id": {"$in": CREATED_USERS}})
    # 3. Drop fake admin payment
    if CREATED_FAKE_PAYMENTS:
        db.payments.delete_many({"payment_id": {"$in": CREATED_FAKE_PAYMENTS}})
    # 4. Drop temp paid alcaldia partner event
    if CREATED_PARTNER_EVENT:
        db.partner_events.delete_one({"event_id": CREATED_PARTNER_EVENT})
    print("  ✓ MongoDB test artefacts removed")
    # 5. Restart backend so it picks up the reverted .env
    try:
        restart_backend()
        print("  ✓ Backend restarted with placeholder keys")
    except Exception as e:
        print(f"  ✗ Backend restart failed: {e}")


# ─────────────────────────────────────────────────────────────
def main():
    print("━" * 70)
    print("  WOMPI INTEGRATION BACKEND TESTS")
    print("━" * 70)

    try:
        # Phase 1: keys NOT configured (.env still has REPLACE_ME)
        # Ensure starting state
        patch_env(PLACEHOLDER_KEYS)
        restart_backend()
        test_config_unconfigured()
        test_unconfigured_503()

        # Phase 2: patch fake keys and restart
        print("\n→ Patching /app/backend/.env with FAKE Wompi sandbox keys...")
        patch_env(FAKE_KEYS)
        restart_backend()
        print("  ✓ Backend restarted with FAKE keys")

        test_config_with_keys()
        city_pass_payment, cp_tok, cp_uid = test_city_pass_with_keys()
        test_port_tax_with_keys()
        test_partner_event_with_keys()
        test_payment_lookup(city_pass_payment, cp_tok)
        test_my_list(cp_tok)
        test_webhook(city_pass_payment, cp_uid)
        test_payouts()
    finally:
        cleanup()

    # ── Summary ──────────────────────────────────────────────
    print("\n" + "━" * 70)
    print("  SUMMARY")
    print("━" * 70)
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    failed = sum(1 for _, ok, _ in RESULTS if not ok)
    print(f"  Passed: {passed}   Failed: {failed}   Total: {len(RESULTS)}")
    if failed:
        print("\n  Failed assertions:")
        for name, ok, detail in RESULTS:
            if not ok:
                print(f"    ✗ {name}: {detail}")
    print()
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
