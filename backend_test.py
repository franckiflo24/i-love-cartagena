"""
Backend tests for the new Port Tax (Tasa Portuaria) endpoints.
Endpoints under test: /api/port-tax/* and /api/admin/port-tax/config

Uses public EXPO_PUBLIC_BACKEND_URL for HTTP.
Uses direct Mongo access only to seed test users + sessions and to set
the is_admin flag on a user (since the app uses Google OAuth in production).
"""
from __future__ import annotations

import os
import sys
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
assert BACKEND_URL, "EXPO_PUBLIC_BACKEND_URL / REACT_APP_BACKEND_URL not configured"
API = BACKEND_URL.rstrip("/") + "/api"

print(f"\n→ Using backend URL: {API}")

mongo = MongoClient(MONGO_URL)
db = mongo[DB_NAME]


def create_test_user(name: str, email_prefix: str, is_admin: bool = False) -> tuple[str, str]:
    """Create a fresh user + session directly in Mongo. Returns (user_id, session_token)."""
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
        "is_admin": bool(is_admin),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    return user_id, session_token


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
def test_config_public_and_idempotent():
    section("1. GET /api/port-tax/config (public + idempotent)")
    db.port_tax_config.delete_many({})

    r1 = requests.get(f"{API}/port-tax/config", timeout=15)
    record("GET config returns 200", r1.status_code == 200, f"got {r1.status_code}")
    if r1.status_code != 200:
        return
    cfg1 = r1.json()
    required = {"price_per_person", "currency", "season_label", "note", "active"}
    record("Config has required fields",
           required.issubset(cfg1.keys()),
           f"missing={required - cfg1.keys()}")
    record("Default price_per_person = 31500",
           cfg1.get("price_per_person") == 31500,
           f"got {cfg1.get('price_per_person')}")
    record("Default currency = COP", cfg1.get("currency") == "COP", f"got {cfg1.get('currency')}")
    record("active=True", cfg1.get("active") is True, f"got {cfg1.get('active')}")

    r2 = requests.get(f"{API}/port-tax/config", timeout=15)
    cfg2 = r2.json()
    record("Second GET returns same config_id",
           cfg1.get("config_id") == cfg2.get("config_id"),
           f"{cfg1.get('config_id')} vs {cfg2.get('config_id')}")
    active_count = db.port_tax_config.count_documents({"active": True})
    record("Only one active config in DB", active_count == 1, f"count={active_count}")


def test_checkout(user_a_token: str):
    section("2. POST /api/port-tax/checkout")

    r = requests.post(f"{API}/port-tax/checkout",
                      json={"qty": 2, "travel_date": "2026-02-15", "passengers": ["Ana", "Luis"]},
                      timeout=15)
    record("Unauthenticated → 401", r.status_code == 401, f"got {r.status_code}")

    r = requests.post(f"{API}/port-tax/checkout",
                      headers=auth_headers(user_a_token),
                      json={"qty": 0, "travel_date": "2026-02-15"}, timeout=15)
    record("qty=0 → 400", r.status_code == 400, f"got {r.status_code}")

    r = requests.post(f"{API}/port-tax/checkout",
                      headers=auth_headers(user_a_token),
                      json={"qty": 21, "travel_date": "2026-02-15"}, timeout=15)
    record("qty=21 → 400", r.status_code == 400, f"got {r.status_code}")

    r = requests.post(f"{API}/port-tax/checkout",
                      headers=auth_headers(user_a_token),
                      json={"qty": 2}, timeout=15)
    record("travel_date missing → 400", r.status_code == 400, f"got {r.status_code}")

    r = requests.post(f"{API}/port-tax/checkout",
                      headers=auth_headers(user_a_token),
                      json={"qty": 2, "travel_date": "15-02-2026"}, timeout=15)
    record("invalid date format → 400", r.status_code == 400, f"got {r.status_code}")

    travel = (datetime.now(timezone.utc).date() + timedelta(days=3)).isoformat()
    r = requests.post(f"{API}/port-tax/checkout",
                      headers=auth_headers(user_a_token),
                      json={"qty": 3,
                            "travel_date": travel,
                            "passengers": ["Ana García", "Luis Pérez", "María López", "Extra Trim"]},
                      timeout=15)
    record("Valid checkout → 200", r.status_code == 200, f"got {r.status_code} body={r.text[:200]}")
    if r.status_code != 200:
        return None
    t = r.json()
    record("Returns ticket_id", bool(t.get("ticket_id")), str(t.get("ticket_id")))
    record("qty == 3", t.get("qty") == 3, f"got {t.get('qty')}")
    record("price_per_person == 31500",
           t.get("price_per_person") == 31500, f"got {t.get('price_per_person')}")
    record("total_amount == 3*31500 = 94500",
           t.get("total_amount") == 31500 * 3, f"got {t.get('total_amount')}")
    record("currency == COP", t.get("currency") == "COP", f"got {t.get('currency')}")
    record("travel_date matches", t.get("travel_date") == travel, f"got {t.get('travel_date')}")
    record("status == paid", t.get("status") == "paid", f"got {t.get('status')}")
    record("passengers trimmed to qty",
           isinstance(t.get("passengers"), list) and len(t["passengers"]) == 3,
           f"len={len(t.get('passengers') or [])}")

    qr = t.get("qr_payload") or {}
    required_qr = {"type", "ticket_id", "user_id", "qty", "travel_date", "issued_at", "app"}
    record("qr_payload has all required keys",
           required_qr.issubset(qr.keys()), f"missing={required_qr - set(qr.keys())}")
    record("qr_payload.type == port_tax", qr.get("type") == "port_tax", f"got {qr.get('type')}")
    record("qr_payload.app == amo_cartagena",
           qr.get("app") == "amo_cartagena", f"got {qr.get('app')}")
    return t.get("ticket_id")


def test_my_tickets(user_a_token, user_b_token, user_a_ticket_id):
    section("3. GET /api/port-tax/my-tickets (ownership scope)")

    r = requests.get(f"{API}/port-tax/my-tickets", timeout=15)
    record("Unauthenticated → 401", r.status_code == 401, f"got {r.status_code}")

    r = requests.get(f"{API}/port-tax/my-tickets",
                     headers=auth_headers(user_a_token), timeout=15)
    record("User A → 200", r.status_code == 200, f"got {r.status_code}")
    tix = r.json() if r.status_code == 200 else []
    record("User A sees own ticket",
           any(t["ticket_id"] == user_a_ticket_id for t in tix), f"count={len(tix)}")

    travel = (datetime.now(timezone.utc).date() + timedelta(days=5)).isoformat()
    r2 = requests.post(f"{API}/port-tax/checkout",
                       headers=auth_headers(user_a_token),
                       json={"qty": 1, "travel_date": travel}, timeout=15)
    new_id = r2.json().get("ticket_id") if r2.status_code == 200 else None
    r = requests.get(f"{API}/port-tax/my-tickets",
                     headers=auth_headers(user_a_token), timeout=15)
    tix = r.json()
    record("Tickets sorted by created_at desc",
           bool(tix) and tix[0]["ticket_id"] == new_id,
           f"first={tix[0].get('ticket_id') if tix else None} expected={new_id}")

    r = requests.get(f"{API}/port-tax/my-tickets",
                     headers=auth_headers(user_b_token), timeout=15)
    tix_b = r.json() if r.status_code == 200 else []
    record("User B does NOT see User A tickets",
           not any(t["ticket_id"] == user_a_ticket_id for t in tix_b),
           f"len_b={len(tix_b)}")


def test_ticket_detail(user_a_token, user_b_token, ticket_id):
    section("4. GET /api/port-tax/tickets/{id}")
    r = requests.get(f"{API}/port-tax/tickets/{ticket_id}",
                     headers=auth_headers(user_a_token), timeout=15)
    record("Owner → 200", r.status_code == 200, f"got {r.status_code}")
    record("Returns same ticket_id",
           r.status_code == 200 and r.json().get("ticket_id") == ticket_id, "")

    r = requests.get(f"{API}/port-tax/tickets/{ticket_id}",
                     headers=auth_headers(user_b_token), timeout=15)
    record("Non-owner → 404", r.status_code == 404, f"got {r.status_code}")

    r = requests.get(f"{API}/port-tax/tickets/pt_nonexistent_xxxxx",
                     headers=auth_headers(user_a_token), timeout=15)
    record("Unknown ticket → 404", r.status_code == 404, f"got {r.status_code}")

    r = requests.get(f"{API}/port-tax/tickets/{ticket_id}", timeout=15)
    record("Unauth → 401", r.status_code == 401, f"got {r.status_code}")


def test_redeem(user_a_token, user_b_token):
    section("5. POST /api/port-tax/tickets/{id}/redeem")
    travel = (datetime.now(timezone.utc).date() + timedelta(days=2)).isoformat()
    r = requests.post(f"{API}/port-tax/checkout",
                      headers=auth_headers(user_a_token),
                      json={"qty": 2, "travel_date": travel}, timeout=15)
    assert r.status_code == 200, r.text
    tid = r.json()["ticket_id"]

    r = requests.post(f"{API}/port-tax/tickets/{tid}/redeem",
                      headers=auth_headers(user_b_token), timeout=15)
    record("Non-owner redeem → 404", r.status_code == 404, f"got {r.status_code}")

    r = requests.post(f"{API}/port-tax/tickets/{tid}/redeem",
                      headers=auth_headers(user_a_token), timeout=15)
    record("First redeem → 200", r.status_code == 200, f"got {r.status_code} body={r.text[:200]}")
    body = r.json() if r.status_code == 200 else {}
    record("Status moves paid → used", body.get("status") == "used", f"got {body.get('status')}")
    record("used_at is set", bool(body.get("used_at")), f"got {body.get('used_at')}")

    db_row = db.port_tax_tickets.find_one({"ticket_id": tid})
    record("DB row reflects used", db_row and db_row.get("status") == "used",
           f"db_status={db_row and db_row.get('status')}")

    r = requests.post(f"{API}/port-tax/tickets/{tid}/redeem",
                      headers=auth_headers(user_a_token), timeout=15)
    record("Second redeem → 409", r.status_code == 409, f"got {r.status_code}")

    travel_old = (datetime.now(timezone.utc).date() - timedelta(days=3)).isoformat()
    r = requests.post(f"{API}/port-tax/checkout",
                      headers=auth_headers(user_a_token),
                      json={"qty": 1, "travel_date": travel_old}, timeout=15)
    expired_tid = r.json()["ticket_id"]
    db.port_tax_tickets.update_one({"ticket_id": expired_tid},
                                   {"$set": {"status": "expired"}})
    r = requests.post(f"{API}/port-tax/tickets/{expired_tid}/redeem",
                      headers=auth_headers(user_a_token), timeout=15)
    record("Redeem expired → 409", r.status_code == 409, f"got {r.status_code}")

    r = requests.post(f"{API}/port-tax/tickets/pt_doesnotexist/redeem",
                      headers=auth_headers(user_a_token), timeout=15)
    record("Redeem unknown → 404", r.status_code == 404, f"got {r.status_code}")

    r = requests.post(f"{API}/port-tax/tickets/{tid}/redeem", timeout=15)
    record("Unauth redeem → 401", r.status_code == 401, f"got {r.status_code}")


def test_expiration_logic(user_a_token, user_a_id):
    section("6. Expiration auto-mark in /my-tickets")

    expired_ticket_id = f"pt_expired_{uuid.uuid4().hex[:8]}"
    past_date = (datetime.now(timezone.utc).date() - timedelta(days=3)).isoformat()
    db.port_tax_tickets.insert_one({
        "ticket_id": expired_ticket_id,
        "user_id": user_a_id,
        "qty": 1,
        "passengers": [],
        "price_per_person": 31500,
        "total_amount": 31500,
        "currency": "COP",
        "travel_date": past_date,
        "status": "paid",
        "qr_payload": {"type": "port_tax", "ticket_id": expired_ticket_id,
                       "user_id": user_a_id, "qty": 1, "travel_date": past_date,
                       "issued_at": datetime.now(timezone.utc).isoformat(),
                       "app": "amo_cartagena"},
        "paid_at": datetime.now(timezone.utc).isoformat(),
        "used_at": None,
        "created_at": (datetime.now(timezone.utc) - timedelta(days=3)).isoformat(),
    })

    r = requests.get(f"{API}/port-tax/my-tickets",
                     headers=auth_headers(user_a_token), timeout=15)
    record("my-tickets → 200", r.status_code == 200, f"got {r.status_code}")
    tix = r.json() if r.status_code == 200 else []
    found = next((t for t in tix if t["ticket_id"] == expired_ticket_id), None)
    record("Past-travel ticket present in response", found is not None, "")
    record("Past-travel ticket auto-marked status=expired in response",
           bool(found) and found.get("status") == "expired",
           f"got {(found or {}).get('status')}")

    db_row = db.port_tax_tickets.find_one({"ticket_id": expired_ticket_id})
    record("DB row also set to expired",
           db_row and db_row.get("status") == "expired",
           f"db_status={(db_row or {}).get('status')}")


def test_admin_update_config(non_admin_token, admin_token):
    section("7. PUT /api/admin/port-tax/config (admin only)")

    r = requests.put(f"{API}/admin/port-tax/config",
                     json={"price_per_person": 35000}, timeout=15)
    record("Unauth → 401", r.status_code == 401, f"got {r.status_code}")

    r = requests.put(f"{API}/admin/port-tax/config",
                     headers=auth_headers(non_admin_token),
                     json={"price_per_person": 35000,
                           "season_label": "Should not apply",
                           "note": "nope"}, timeout=15)
    record("Non-admin → 403", r.status_code == 403, f"got {r.status_code}")

    before = requests.get(f"{API}/port-tax/config", timeout=15).json()
    before_id = before.get("config_id")

    r = requests.put(f"{API}/admin/port-tax/config",
                     headers=auth_headers(admin_token),
                     json={"price_per_person": 35000,
                           "season_label": "Temporada Alta 2026",
                           "note": "Tasa actualizada — test."}, timeout=15)
    record("Admin update → 200", r.status_code == 200, f"got {r.status_code} body={r.text[:200]}")
    new_cfg = r.json() if r.status_code == 200 else {}
    record("Returns new price 35000",
           new_cfg.get("price_per_person") == 35000, f"got {new_cfg.get('price_per_person')}")

    after = requests.get(f"{API}/port-tax/config", timeout=15).json()
    record("Subsequent GET returns new price",
           after.get("price_per_person") == 35000, f"got {after.get('price_per_person')}")
    record("Subsequent GET reflects new season_label",
           after.get("season_label") == "Temporada Alta 2026",
           f"got {after.get('season_label')}")
    record("New config_id is different",
           after.get("config_id") != before_id,
           f"before={before_id} after={after.get('config_id')}")

    old = db.port_tax_config.find_one({"config_id": before_id}) if before_id else None
    record("Old config marked active=False",
           old is None or old.get("active") is False,
           f"old.active={(old or {}).get('active')}")
    active_count = db.port_tax_config.count_documents({"active": True})
    record("Exactly one active config remains", active_count == 1, f"count={active_count}")

    r = requests.put(f"{API}/admin/port-tax/config",
                     headers=auth_headers(admin_token),
                     json={"price_per_person": -100}, timeout=15)
    record("Invalid (negative) price → 400", r.status_code == 400, f"got {r.status_code}")

    r = requests.put(f"{API}/admin/port-tax/config",
                     headers=auth_headers(admin_token),
                     json={"price_per_person": 999999}, timeout=15)
    record("Excessive price (>200k) → 400", r.status_code == 400, f"got {r.status_code}")

    # Restore default 31500
    requests.put(f"{API}/admin/port-tax/config",
                 headers=auth_headers(admin_token),
                 json={"price_per_person": 31500,
                       "season_label": "Temporada actual 2026",
                       "note": "Tasa portuaria oficial Muelle La Bodeguita — Islas del Rosario / Barú / Tierra Bomba."},
                 timeout=15)


def cleanup(user_ids: list[str]):
    db.users.delete_many({"user_id": {"$in": user_ids}})
    db.user_sessions.delete_many({"user_id": {"$in": user_ids}})
    db.port_tax_tickets.delete_many({"user_id": {"$in": user_ids}})


def main():
    print("\n========================================")
    print("  PORT TAX BACKEND TESTS")
    print("========================================")

    user_a_id, user_a_token = create_test_user("Andrea Restrepo", "andrea")
    user_b_id, user_b_token = create_test_user("Bruno Castillo", "bruno")
    admin_id, admin_token = create_test_user("Alicia Admin", "alicia", is_admin=True)

    print(f"  user_a={user_a_id}")
    print(f"  user_b={user_b_id}")
    print(f"  admin ={admin_id}")

    try:
        test_config_public_and_idempotent()
        ticket_id = test_checkout(user_a_token)
        if ticket_id:
            test_my_tickets(user_a_token, user_b_token, ticket_id)
            test_ticket_detail(user_a_token, user_b_token, ticket_id)
        test_redeem(user_a_token, user_b_token)
        test_expiration_logic(user_a_token, user_a_id)
        test_admin_update_config(user_a_token, admin_token)
    finally:
        cleanup([user_a_id, user_b_id, admin_id])

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    failed = sum(1 for _, ok, _ in RESULTS if not ok)
    print("\n========================================")
    print(f"  RESULTS: {passed} passed / {failed} failed (total {len(RESULTS)})")
    print("========================================")
    if failed:
        print("\nFailures:")
        for n, ok, d in RESULTS:
            if not ok:
                print(f"  X {n} — {d}")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
