"""
Focused tests for /api/payments/wompi/partner-event to verify the qty=0 coercion fix.

Per review request:
  1) Patch /app/backend/.env with fake Wompi sandbox keys, restart backend.
  2) Re-confirm GET /api/payments/config (enabled=false placeholders, enabled=true test keys).
  3) Run the focused partner-event tests:
     a) qty=0 → 400
     b) qty=51 → 400
     c) qty omitted → 200, amount_cop == price (qty defaults to 1)
     d) qty=2, pe_002 (ptr_005, 60000) → 200 amount 120000, split 3% / 3600 / 116400
     e) Gov partner ptr_alcaldia paid event → 200 commission_pct=0.0
     f) free event pe_8d14b39122 → 400, detail contains 'free'
     g) unknown event → 404
  4) Revert .env to placeholders and restart backend.
"""
from __future__ import annotations

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

load_dotenv(Path("/app/backend/.env"))
load_dotenv(Path("/app/frontend/.env"))

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
BACKEND_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("REACT_APP_BACKEND_URL")
assert BACKEND_URL, "EXPO_PUBLIC_BACKEND_URL not configured"
API = BACKEND_URL.rstrip("/") + "/api"
print(f"\n→ Using backend URL: {API}")

mongo = MongoClient(MONGO_URL)
db = mongo[DB_NAME]

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
    env_path = Path("/app/backend/.env")
    lines = env_path.read_text().splitlines()
    out, seen = [], set()
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
    for _ in range(30):
        try:
            r = requests.get(API + "/payments/config", timeout=3)
            if r.status_code == 200:
                return
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError("Backend failed to come back after restart")


def mk_test_user(name: str, prefix: str) -> tuple[str, str]:
    user_id = f"test_{uuid.uuid4().hex[:12]}"
    email = f"{prefix}.{uuid.uuid4().hex[:6]}@amocartagena.test"
    session_token = f"st_test_{uuid.uuid4().hex}"
    db.users.insert_one({
        "user_id": user_id, "email": email, "name": name,
        "picture": "", "favorites": [], "my_week": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "session_token": session_token, "user_id": user_id,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    return user_id, session_token


def auth(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


RESULTS: list[tuple[str, bool, str]] = []
CREATED_USERS: list[str] = []
CREATED_TEMP_EVENT: str | None = None


def record(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' — ' + detail) if detail else ''}")


def section(t: str) -> None:
    print(f"\n=== {t} ===")


def test_config_placeholders():
    section("0/A — GET /payments/config with REPLACE_ME placeholders → enabled=false")
    r = requests.get(API + "/payments/config", timeout=10)
    record("status 200", r.status_code == 200, f"got {r.status_code}")
    j = r.json() if r.status_code == 200 else {}
    record("enabled == False", j.get("enabled") is False, f"got {j.get('enabled')}")
    record("public_key empty", j.get("public_key") == "", f"got {j.get('public_key')!r}")


def test_config_fake_keys():
    section("0/B — GET /payments/config with FAKE test keys → enabled=true")
    r = requests.get(API + "/payments/config", timeout=10)
    record("status 200", r.status_code == 200, f"got {r.status_code}")
    j = r.json() if r.status_code == 200 else {}
    record("enabled == True", j.get("enabled") is True, f"got {j.get('enabled')}")
    pk = j.get("public_key") or ""
    record("public_key == 'pub_test_TEST'", pk == "pub_test_TEST", f"got {pk!r}")
    record("env == 'sandbox'", j.get("env") == "sandbox", f"got {j.get('env')}")


def test_qty_zero_returns_400():
    section("a) POST /payments/wompi/partner-event qty=0 → 400 (regression fix)")
    uid, tok = mk_test_user("Sofia Restrepo", "sofia")
    CREATED_USERS.append(uid)
    r = requests.post(
        API + "/payments/wompi/partner-event",
        json={"event_id": "pe_002", "qty": 0},
        headers=auth(tok), timeout=15,
    )
    record("qty=0 → 400 (NOT 200)", r.status_code == 400, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 400:
        detail = (r.json() or {}).get("detail", "")
        record("detail mentions qty", "qty" in detail.lower(), f"got {detail!r}")


def test_qty_51_returns_400():
    section("b) POST /payments/wompi/partner-event qty=51 → 400")
    uid, tok = mk_test_user("Carolina Vargas", "carolina")
    CREATED_USERS.append(uid)
    r = requests.post(
        API + "/payments/wompi/partner-event",
        json={"event_id": "pe_002", "qty": 51},
        headers=auth(tok), timeout=15,
    )
    record("qty=51 → 400", r.status_code == 400, f"got {r.status_code}: {r.text[:200]}")


def test_qty_omitted_defaults_to_1():
    section("c) POST /payments/wompi/partner-event qty OMITTED → 200, amount_cop == price")
    uid, tok = mk_test_user("Andrés Castaño", "andres")
    CREATED_USERS.append(uid)
    # pe_002 = Sunset Sessions ft. DJ Local, price=60000, ptr_005
    ev = db.partner_events.find_one({"event_id": "pe_002"}, {"_id": 0}) or {}
    price = int(ev.get("price") or 60000)
    body = {"event_id": "pe_002"}  # no qty key
    r = requests.post(
        API + "/payments/wompi/partner-event",
        json=body, headers=auth(tok), timeout=15,
    )
    record("qty omitted → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:250]}")
    if r.status_code == 200:
        p = r.json()
        record(f"amount_cop == price ({price})",
               int(p.get("amount_cop", -1)) == price,
               f"got {p.get('amount_cop')}")
        record("returns checkout_url", bool(p.get("checkout_url")))
        record("reference starts with 'PAY-'", (p.get("reference") or "").startswith("PAY-"))


def test_paid_regular_partner_qty_2():
    section("d) POST /payments/wompi/partner-event qty=2 pe_002 (ptr_005) → 200 split 3%")
    uid, tok = mk_test_user("Valeria Torres", "valeria")
    CREATED_USERS.append(uid)
    r = requests.post(
        API + "/payments/wompi/partner-event",
        json={"event_id": "pe_002", "qty": 2},
        headers=auth(tok), timeout=15,
    )
    record("status 200", r.status_code == 200, f"got {r.status_code}: {r.text[:250]}")
    if r.status_code == 200:
        p = r.json()
        record("amount_cop == 120000", int(p.get("amount_cop", -1)) == 120000, f"got {p.get('amount_cop')}")
        s = p.get("split") or {}
        record("split.commission_pct == 3.0", float(s.get("commission_pct", -1)) == 3.0, f"got {s.get('commission_pct')}")
        record("split.app_commission == 3600", s.get("app_commission") == 3600, f"got {s.get('app_commission')}")
        record("split.partner_amount == 116400", s.get("partner_amount") == 116400, f"got {s.get('partner_amount')}")


def test_government_partner_zero_commission():
    section("e) POST /payments/wompi/partner-event for ptr_alcaldia paid event → split.commission_pct == 0.0")
    uid, tok = mk_test_user("Mateo Salazar", "mateo")
    CREATED_USERS.append(uid)
    global CREATED_TEMP_EVENT
    CREATED_TEMP_EVENT = f"pe_test_{uuid.uuid4().hex[:8]}"
    db.partner_events.insert_one({
        "event_id": CREATED_TEMP_EVENT,
        "partner_id": "ptr_alcaldia",
        "title": "Concierto Patrimonio (test)",
        "category": "cultura",
        "date": "2030-05-20",
        "start_time": "20:00",
        "is_free": False,
        "price": 80000,
        "currency": "COP",
        "moderation_status": "approved",
        "is_published": True,
        "views_count": 0,
        "reserve_clicks": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    r = requests.post(
        API + "/payments/wompi/partner-event",
        json={"event_id": CREATED_TEMP_EVENT, "qty": 2},
        headers=auth(tok), timeout=15,
    )
    record("status 200", r.status_code == 200, f"got {r.status_code}: {r.text[:250]}")
    if r.status_code == 200:
        p = r.json()
        s = p.get("split") or {}
        record("split.commission_pct == 0.0 (gov bypass)",
               float(s.get("commission_pct", -1)) == 0.0,
               f"got {s.get('commission_pct')}")
        record("split.app_commission == 0", s.get("app_commission") == 0, f"got {s.get('app_commission')}")
        record("amount_cop == 160000", int(p.get("amount_cop", -1)) == 160000, f"got {p.get('amount_cop')}")


def test_free_event_returns_400():
    section("f) POST /payments/wompi/partner-event for free event → 400 with 'free'")
    uid, tok = mk_test_user("Laura Beltrán", "laura")
    CREATED_USERS.append(uid)
    # Find any free event published (per request hint: pe_8d14b39122)
    free_event = db.partner_events.find_one({"is_free": True}, {"_id": 0})
    if not free_event:
        record("ERROR: no free partner event in DB", False, "could not locate any is_free=True event")
        return
    free_id = free_event.get("event_id")
    r = requests.post(
        API + "/payments/wompi/partner-event",
        json={"event_id": free_id, "qty": 1},
        headers=auth(tok), timeout=15,
    )
    record(f"free event {free_id} → 400", r.status_code == 400, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 400:
        detail = ((r.json() or {}).get("detail") or "").lower()
        record("detail contains 'free'", "free" in detail, f"got {detail!r}")


def test_unknown_event_returns_404():
    section("g) POST /payments/wompi/partner-event unknown event_id → 404")
    uid, tok = mk_test_user("Pablo Naranjo", "pablo")
    CREATED_USERS.append(uid)
    r = requests.post(
        API + "/payments/wompi/partner-event",
        json={"event_id": "pe_doesnotexist_xyz", "qty": 1},
        headers=auth(tok), timeout=15,
    )
    record("unknown event_id → 404", r.status_code == 404, f"got {r.status_code}: {r.text[:200]}")


def cleanup():
    section("CLEANUP")
    patch_env(PLACEHOLDER_KEYS)
    print("  ✓ /app/backend/.env reverted to REPLACE_ME placeholders")
    if CREATED_USERS:
        db.users.delete_many({"user_id": {"$in": CREATED_USERS}})
        db.user_sessions.delete_many({"user_id": {"$in": CREATED_USERS}})
        db.payments.delete_many({"user_id": {"$in": CREATED_USERS}})
        db.city_passes.delete_many({"user_id": {"$in": CREATED_USERS}})
        db.partner_bookings.delete_many({"user_id": {"$in": CREATED_USERS}})
    if CREATED_TEMP_EVENT:
        db.partner_events.delete_one({"event_id": CREATED_TEMP_EVENT})
    print("  ✓ MongoDB test artefacts removed")
    try:
        restart_backend()
        print("  ✓ Backend restarted with placeholder keys")
    except Exception as e:
        print(f"  ✗ Backend restart failed: {e}")


def main():
    print("━" * 70)
    print("  WOMPI PARTNER-EVENT qty=0 FIX REGRESSION TEST")
    print("━" * 70)
    try:
        patch_env(PLACEHOLDER_KEYS)
        restart_backend()
        test_config_placeholders()

        print("\n→ Patching /app/backend/.env with FAKE Wompi sandbox keys...")
        patch_env(FAKE_KEYS)
        restart_backend()
        print("  ✓ Backend restarted with FAKE keys")

        test_config_fake_keys()
        test_qty_zero_returns_400()
        test_qty_51_returns_400()
        test_qty_omitted_defaults_to_1()
        test_paid_regular_partner_qty_2()
        test_government_partner_zero_commission()
        test_free_event_returns_400()
        test_unknown_event_returns_404()
    finally:
        cleanup()

    print("\n" + "━" * 70)
    print("  SUMMARY")
    print("━" * 70)
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    failed = sum(1 for _, ok, _ in RESULTS if not ok)
    print(f"  Passed: {passed}   Failed: {failed}   Total: {len(RESULTS)}")
    if failed:
        print("\n  Failed assertions:")
        for n, ok, d in RESULTS:
            if not ok:
                print(f"    ✗ {n}: {d}")
    print()
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
