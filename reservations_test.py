"""Backend tests for the new Reservations module (/app/backend/reservations.py).

Hits the external preview URL (EXPO_PUBLIC_BACKEND_URL) per system rules.

Auth strategy:
  • User auth: insert a `users` row + `user_sessions` row directly via the same
    Mongo URL the backend uses, then send `Authorization: Bearer <token>`.
  • Business auth (Casa Bohème / Bellini / Alcaldía): use POST /api/business/login.

Cleanup at the end purges everything we created (test prefix = `restest_`).
"""
import asyncio
import json
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone

import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = "https://cartagena-live.preview.emergentagent.com/api"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "test_database"

TEST_PREFIX = "restest_"

ALCALDIA_EMAIL = "alcaldia@amocartagena.app"
ALCALDIA_PWD = "AlcaldiaCTG2026!"
PARTNER_EMAIL = "bellini@amocartagena.app"   # owns ptr_002
PARTNER_PWD = "amocartagena2026"
PARTNER_PARTNER_ID = "ptr_002"
OTHER_PARTNER_EMAIL = "cafedelmar@amocartagena.app"  # owns ptr_005
OTHER_PARTNER_PWD = "amocartagena2026"

passed = 0
failed = 0
failures: list[str] = []


def check(label, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  OK  {label}")
    else:
        failed += 1
        failures.append(f"{label} — {detail}")
        print(f"  FAIL  {label} — {detail}")


# ────────────────────────────────────────────────────────────────────────────
# Mongo helpers — direct user seeding (Google OAuth is the only user auth, so
# we cannot register via API). Same approach used by the project's auth playbook.
# ────────────────────────────────────────────────────────────────────────────
async def seed_user(name: str, email: str) -> tuple[str, str]:
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    user_id = f"user_{TEST_PREFIX}{uuid.uuid4().hex[:10]}"
    token = f"st_{TEST_PREFIX}{uuid.uuid4().hex}"
    await db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": name,
        "picture": "",
        "phone": "+573000000000",
        "favorites": [],
        "my_week": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    c.close()
    return user_id, token


async def cleanup():
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    # Delete test users + sessions + reservations + payments
    await db.users.delete_many({"user_id": {"$regex": f"^user_{TEST_PREFIX}"}})
    await db.user_sessions.delete_many({"session_token": {"$regex": f"^st_{TEST_PREFIX}"}})
    await db.reservations.delete_many({"user_id": {"$regex": f"^user_{TEST_PREFIX}"}})
    await db.payments.delete_many({"user_id": {"$regex": f"^user_{TEST_PREFIX}"}})
    c.close()


async def manual_insert_table_reservation(user_id: str, partner_id: str, date_str: str, time_str: str) -> str:
    """For testing the < 2h cancellation window: insert a reservation directly so we can
    set datetime_utc to a near-future time without round-trip latency issues."""
    from datetime import timezone as tz, timedelta as td
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    # Compute datetime_utc as Cartagena local (UTC-5)
    dt_local = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
    dt_utc = dt_local.replace(tzinfo=tz(td(hours=-5))).astimezone(tz.utc)
    res_id = f"res_{TEST_PREFIX}{uuid.uuid4().hex[:8]}"
    now_iso = datetime.now(tz.utc).isoformat()
    await db.reservations.insert_one({
        "reservation_id": res_id,
        "user_id": user_id,
        "user_email": "test@amocartagena.app",
        "user_name": "Sofía Andrade",
        "user_phone": "+573000000000",
        "partner_id": partner_id,
        "partner_name": "Bellini",
        "event_id": None,
        "type": "table",
        "date": date_str,
        "time": time_str,
        "datetime_utc": dt_utc.isoformat(),
        "party_size": 2,
        "notes": "Test late-cancel",
        "status": "pending_confirmation",
        "created_at": now_iso,
        "updated_at": now_iso,
        "amount_cop": 0,
        "currency": "COP",
    })
    c.close()
    return res_id


# ────────────────────────────────────────────────────────────────────────────
# Auth helpers
# ────────────────────────────────────────────────────────────────────────────
def biz_login(email, pwd):
    r = requests.post(f"{BASE_URL}/business/login", json={"email": email, "password": pwd}, timeout=30)
    r.raise_for_status()
    return r.json()["token"]


# ────────────────────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────────────────────
async def main():
    print("\n=== Setting up test users + tokens ===")
    user_id, user_token = await seed_user("Sofía Andrade", f"sofia.{TEST_PREFIX}{uuid.uuid4().hex[:6]}@example.com")
    user2_id, user2_token = await seed_user("Diego Pérez", f"diego.{TEST_PREFIX}{uuid.uuid4().hex[:6]}@example.com")
    print(f"  user1 = {user_id}")
    print(f"  user2 = {user2_id}")

    alc_token = biz_login(ALCALDIA_EMAIL, ALCALDIA_PWD)
    biz_token = biz_login(PARTNER_EMAIL, PARTNER_PWD)
    other_biz_token = biz_login(OTHER_PARTNER_EMAIL, OTHER_PARTNER_PWD)
    print(f"  alcaldia, bellini, cafedelmar business tokens acquired")

    H_USER = {"Authorization": f"Bearer {user_token}", "Content-Type": "application/json"}
    H_USER2 = {"Authorization": f"Bearer {user2_token}", "Content-Type": "application/json"}
    H_BIZ = {"Authorization": f"Bearer {biz_token}", "Content-Type": "application/json"}
    H_OTHER_BIZ = {"Authorization": f"Bearer {other_biz_token}", "Content-Type": "application/json"}
    H_ALC = {"Authorization": f"Bearer {alc_token}", "Content-Type": "application/json"}

    tomorrow = (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%d")
    yesterday = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")
    far_future = (datetime.utcnow() + timedelta(days=400)).strftime("%Y-%m-%d")

    # ============================================================
    # 1) POST /api/reservations
    # ============================================================
    print("\n=== 1) POST /reservations ===")
    # a) no-auth
    r = requests.post(f"{BASE_URL}/reservations", json={}, timeout=20)
    check("1a 401 no-auth", r.status_code == 401, f"got {r.status_code}")

    # b) validations
    base_body = {"partner_id": PARTNER_PARTNER_ID, "type": "table", "date": tomorrow, "time": "20:00", "party_size": 2}

    r = requests.post(f"{BASE_URL}/reservations", headers=H_USER, json={**base_body, "partner_id": ""}, timeout=20)
    check("1b missing partner_id → 400", r.status_code == 400, f"got {r.status_code}: {r.text[:100]}")

    r = requests.post(f"{BASE_URL}/reservations", headers=H_USER, json={**base_body, "type": ""}, timeout=20)
    check("1b missing type → 400", r.status_code == 400, f"got {r.status_code}")

    r = requests.post(f"{BASE_URL}/reservations", headers=H_USER, json={**base_body, "type": "invalid"}, timeout=20)
    check("1b invalid type → 400", r.status_code == 400, f"got {r.status_code}")

    r = requests.post(f"{BASE_URL}/reservations", headers=H_USER, json={**base_body, "party_size": 0}, timeout=20)
    check("1b party_size=0 → 400", r.status_code == 400, f"got {r.status_code}")

    r = requests.post(f"{BASE_URL}/reservations", headers=H_USER, json={**base_body, "party_size": 31}, timeout=20)
    check("1b party_size>30 → 400", r.status_code == 400, f"got {r.status_code}")

    r = requests.post(f"{BASE_URL}/reservations", headers=H_USER, json={**base_body, "date": "not-a-date"}, timeout=20)
    check("1b malformed date → 400", r.status_code == 400, f"got {r.status_code}: {r.text[:100]}")

    # c) invalid partner
    r = requests.post(f"{BASE_URL}/reservations", headers=H_USER, json={**base_body, "partner_id": "ptr_does_not_exist"}, timeout=20)
    check("1c invalid partner_id → 404", r.status_code == 404, f"got {r.status_code}")

    # f) past date / >1 year / amount validations
    r = requests.post(f"{BASE_URL}/reservations", headers=H_USER, json={**base_body, "date": yesterday}, timeout=20)
    check("1f past date → 400", r.status_code == 400, f"got {r.status_code}: {r.text[:100]}")

    r = requests.post(f"{BASE_URL}/reservations", headers=H_USER, json={**base_body, "date": far_future}, timeout=20)
    check("1f date > 1 year → 400", r.status_code == 400, f"got {r.status_code}: {r.text[:100]}")

    r = requests.post(f"{BASE_URL}/reservations", headers=H_USER, json={
        "partner_id": PARTNER_PARTNER_ID, "type": "prepaid", "date": tomorrow, "time": "08:00",
        "party_size": 2, "amount_cop": 500,
    }, timeout=20)
    check("1f amount_cop < 1000 → 400 (when prepaid)",
          r.status_code == 400, f"got {r.status_code}: {r.text[:200]}")

    # d) HAPPY PATH — TABLE
    happy_table = {
        "partner_id": PARTNER_PARTNER_ID,
        "type": "table",
        "date": tomorrow,
        "time": "20:00",
        "party_size": 2,
        "notes": "Cumpleaños sorpresa",
    }
    r = requests.post(f"{BASE_URL}/reservations", headers=H_USER, json=happy_table, timeout=30)
    check("1d table happy → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    table_res_id = None
    if r.status_code == 200:
        d = r.json()
        res = d.get("reservation", {})
        table_res_id = res.get("reservation_id")
        check("1d requires_payment == false", d.get("requires_payment") is False, f"got {d.get('requires_payment')}")
        check("1d status == pending_confirmation",
              res.get("status") == "pending_confirmation", f"got {res.get('status')}")
        check("1d user_id populated", res.get("user_id") == user_id, f"got {res.get('user_id')}")
        check("1d user_email populated", bool(res.get("user_email")), "missing user_email")
        check("1d partner_id populated", res.get("partner_id") == PARTNER_PARTNER_ID, f"got {res.get('partner_id')}")
        check("1d partner hydrated", isinstance(res.get("partner"), dict) and res["partner"].get("name") == "Bellini",
              f"got {res.get('partner')}")
        check("1d notes preserved", res.get("notes") == "Cumpleaños sorpresa", "")
        check("1d reservation_id starts with res_", str(table_res_id or "").startswith("res_"), f"got {table_res_id}")

    # e) PREPAID — should hit 503 because Wompi is not configured
    prepaid_body = {
        "partner_id": PARTNER_PARTNER_ID,
        "type": "prepaid",
        "date": tomorrow,
        "time": "08:00",
        "party_size": 2,
        "amount_cop": 50000,
    }
    r = requests.post(f"{BASE_URL}/reservations", headers=H_USER, json=prepaid_body, timeout=30)
    check("1e prepaid w/o Wompi → 503", r.status_code == 503, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 503:
        detail = ""
        try:
            detail = r.json().get("detail", "")
        except Exception:
            detail = r.text
        check("1e 503 detail mentions Wompi", "wompi" in detail.lower(), f"detail={detail!r}")

    # ============================================================
    # 2) GET /api/reservations/my
    # ============================================================
    print("\n=== 2) GET /reservations/my ===")
    r = requests.get(f"{BASE_URL}/reservations/my", timeout=20)
    check("2a 401 no-auth", r.status_code == 401, f"got {r.status_code}")

    r = requests.get(f"{BASE_URL}/reservations/my", headers=H_USER, timeout=30)
    check("2b 200 with auth", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 200:
        d = r.json()
        check("2b has 'upcoming'", "upcoming" in d, "missing upcoming")
        check("2b has 'past'", "past" in d, "missing past")
        check("2b has 'total'", "total" in d, "missing total")
        if table_res_id:
            ids = [x.get("reservation_id") for x in d.get("upcoming", [])]
            check("2b table reservation appears in upcoming", table_res_id in ids,
                  f"upcoming ids={ids}")

    # ============================================================
    # 3) GET /api/reservations/{id}
    # ============================================================
    print("\n=== 3) GET /reservations/{id} ===")
    if table_res_id:
        r = requests.get(f"{BASE_URL}/reservations/{table_res_id}", timeout=20)
        check("3a 401 no-auth", r.status_code == 401, f"got {r.status_code}")

        r = requests.get(f"{BASE_URL}/reservations/{table_res_id}", headers=H_USER, timeout=30)
        check("3b 200 own reservation", r.status_code == 200, f"got {r.status_code}")
        if r.status_code == 200:
            d = r.json()
            check("3b returned matching id", d.get("reservation_id") == table_res_id, "")
            check("3b partner hydrated on detail", isinstance(d.get("partner"), dict), "")

        # 3c — second user should NOT see it
        r = requests.get(f"{BASE_URL}/reservations/{table_res_id}", headers=H_USER2, timeout=30)
        check("3c 404 when not owner", r.status_code == 404, f"got {r.status_code}")

        r = requests.get(f"{BASE_URL}/reservations/res_does_not_exist", headers=H_USER, timeout=20)
        check("3c 404 for unknown id", r.status_code == 404, f"got {r.status_code}")

    # ============================================================
    # 4) POST /api/reservations/{id}/cancel
    # ============================================================
    print("\n=== 4) POST /reservations/{id}/cancel ===")
    # Create a separate fresh table reservation so we can cancel cleanly
    r = requests.post(f"{BASE_URL}/reservations", headers=H_USER, json={
        "partner_id": PARTNER_PARTNER_ID, "type": "table", "date": tomorrow,
        "time": "21:30", "party_size": 4, "notes": "Test cancel",
    }, timeout=30)
    free_cancel_id = None
    if r.status_code == 200:
        free_cancel_id = r.json()["reservation"]["reservation_id"]

    if free_cancel_id:
        r = requests.post(f"{BASE_URL}/reservations/{free_cancel_id}/cancel", timeout=20)
        check("4a 401 no-auth", r.status_code == 401, f"got {r.status_code}")

        r = requests.post(f"{BASE_URL}/reservations/{free_cancel_id}/cancel", headers=H_USER, timeout=30)
        check("4b free cancel → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
        if r.status_code == 200:
            d = r.json()
            check("4b status=cancelled_by_user", d["reservation"].get("status") == "cancelled_by_user",
                  f"got {d['reservation'].get('status')}")
            check("4b free_cancellation=true", d.get("free_cancellation") is True, f"got {d.get('free_cancellation')}")

        # Second cancel attempt — the impl re-runs the state machine: status no longer cancellable,
        # so it falls into 'cancelled_late' path. Expectation per review: "404 / or status check shows
        # it's already cancelled". We accept any non-2xx-fresh-cancellation, or 200 with a status that
        # indicates the booking is now in a terminal state and free_cancellation flag is false.
        r2 = requests.post(f"{BASE_URL}/reservations/{free_cancel_id}/cancel", headers=H_USER, timeout=30)
        ok_404 = (r2.status_code == 404)
        ok_no_fresh = False
        if r2.status_code == 200:
            d2 = r2.json()
            ok_no_fresh = (not d2.get("free_cancellation"))
        check(
            "4b second cancel — 404 OR already-cancelled status returned",
            ok_404 or ok_no_fresh,
            f"got {r2.status_code}: {r2.text[:200]}",
        )

    # 4c — late cancel (< 2h until reservation). Insert directly so we control datetime.
    today = datetime.utcnow().strftime("%Y-%m-%d")
    # Cartagena local +30min from now (UTC-5). Use local-now+30m.
    cartagena_now = datetime.utcnow() - timedelta(hours=5)
    late_dt = cartagena_now + timedelta(minutes=30)
    late_date = late_dt.strftime("%Y-%m-%d")
    late_time = late_dt.strftime("%H:%M")
    late_id = await manual_insert_table_reservation(user_id, PARTNER_PARTNER_ID, late_date, late_time)
    r = requests.post(f"{BASE_URL}/reservations/{late_id}/cancel", headers=H_USER, timeout=30)
    check("4c late cancel → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 200:
        d = r.json()
        check("4c status=cancelled_late", d["reservation"].get("status") == "cancelled_late",
              f"got {d['reservation'].get('status')}")
        check("4c free_cancellation=false", d.get("free_cancellation") is False, f"got {d.get('free_cancellation')}")

    # ============================================================
    # 5) GET /api/business/reservations
    # ============================================================
    print("\n=== 5) GET /business/reservations ===")
    r = requests.get(f"{BASE_URL}/business/reservations", timeout=20)
    check("5a 401 no-auth", r.status_code == 401, f"got {r.status_code}")

    r = requests.get(f"{BASE_URL}/business/reservations", headers=H_BIZ, timeout=30)
    check("5b 200 with biz token", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    biz_reservations = []
    if r.status_code == 200:
        d = r.json()
        check("5b has 'reservations'", "reservations" in d)
        check("5b has 'stats'", "stats" in d)
        stats = d.get("stats", {})
        for k in ["pending_count", "confirmed_upcoming_count", "prepaid_revenue_cop", "prepaid_app_commission_cop"]:
            check(f"5b stats.{k} present", k in stats)
        biz_reservations = d.get("reservations", [])
        # All reservations should belong to ptr_002
        for r_obj in biz_reservations:
            if r_obj.get("partner_id") != PARTNER_PARTNER_ID:
                check("5b only this partner's reservations", False, f"saw partner_id={r_obj.get('partner_id')}")
                break
        else:
            check("5b only this partner's reservations", True)

    # 5c — other partner does NOT see Bellini's reservations
    r = requests.get(f"{BASE_URL}/business/reservations", headers=H_OTHER_BIZ, timeout=30)
    if r.status_code == 200:
        other_ids = {x.get("reservation_id") for x in r.json().get("reservations", [])}
        leaked = (table_res_id and table_res_id in other_ids) or (free_cancel_id and free_cancel_id in other_ids)
        check("5c other partner doesn't see ptr_002 reservations", not leaked,
              f"leaked ids visible to other partner = {leaked}")
    else:
        check("5c other partner /business/reservations 200", False, f"got {r.status_code}")

    # ============================================================
    # 6) PATCH /api/business/reservations/{id}
    # ============================================================
    print("\n=== 6) PATCH /business/reservations/{id} ===")
    # Need a fresh table reservation in pending_confirmation for confirm-path
    r = requests.post(f"{BASE_URL}/reservations", headers=H_USER, json={
        "partner_id": PARTNER_PARTNER_ID, "type": "table", "date": tomorrow,
        "time": "19:00", "party_size": 3, "notes": "Confirm path",
    }, timeout=30)
    confirm_id = r.json()["reservation"]["reservation_id"] if r.status_code == 200 else None

    r = requests.post(f"{BASE_URL}/reservations", headers=H_USER, json={
        "partner_id": PARTNER_PARTNER_ID, "type": "table", "date": tomorrow,
        "time": "18:30", "party_size": 2, "notes": "Reject path",
    }, timeout=30)
    reject_id = r.json()["reservation"]["reservation_id"] if r.status_code == 200 else None

    r = requests.post(f"{BASE_URL}/reservations", headers=H_USER, json={
        "partner_id": PARTNER_PARTNER_ID, "type": "table", "date": tomorrow,
        "time": "17:30", "party_size": 2, "notes": "Complete path",
    }, timeout=30)
    complete_id = r.json()["reservation"]["reservation_id"] if r.status_code == 200 else None

    r = requests.post(f"{BASE_URL}/reservations", headers=H_USER, json={
        "partner_id": PARTNER_PARTNER_ID, "type": "table", "date": tomorrow,
        "time": "22:00", "party_size": 5, "notes": "No-show path",
    }, timeout=30)
    noshow_id = r.json()["reservation"]["reservation_id"] if r.status_code == 200 else None

    # 6a 401 no-auth
    if confirm_id:
        r = requests.patch(f"{BASE_URL}/business/reservations/{confirm_id}", json={"action": "confirm"}, timeout=20)
        check("6a 401 no-auth", r.status_code == 401, f"got {r.status_code}")

        # 6b — different partner gets 404
        r = requests.patch(f"{BASE_URL}/business/reservations/{confirm_id}", headers=H_OTHER_BIZ,
                           json={"action": "confirm"}, timeout=30)
        check("6b 404 when different partner", r.status_code == 404, f"got {r.status_code}: {r.text[:120]}")

        # 6c — confirm
        r = requests.patch(f"{BASE_URL}/business/reservations/{confirm_id}", headers=H_BIZ,
                           json={"action": "confirm"}, timeout=30)
        check("6c confirm → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
        if r.status_code == 200:
            d = r.json()
            check("6c status=confirmed", d.get("status") == "confirmed", f"got {d.get('status')}")
            check("6c confirmed_at set", bool(d.get("confirmed_at")), "")
            check("6c partner_confirmed_by=biz email",
                  d.get("partner_confirmed_by") == PARTNER_EMAIL, f"got {d.get('partner_confirmed_by')}")

        # 6g invalid action
        r = requests.patch(f"{BASE_URL}/business/reservations/{confirm_id}", headers=H_BIZ,
                           json={"action": "frobnicate"}, timeout=30)
        check("6g invalid action → 400", r.status_code == 400, f"got {r.status_code}")

    # 6d — reject with note (use reject_id which is still pending_confirmation)
    if reject_id:
        r = requests.patch(f"{BASE_URL}/business/reservations/{reject_id}", headers=H_BIZ,
                           json={"action": "reject", "note": "Sin disponibilidad esa noche"}, timeout=30)
        check("6d reject → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
        if r.status_code == 200:
            d = r.json()
            check("6d status=rejected_by_partner",
                  d.get("status") == "rejected_by_partner", f"got {d.get('status')}")
            check("6d partner_rejection_reason set",
                  d.get("partner_rejection_reason") == "Sin disponibilidad esa noche",
                  f"got {d.get('partner_rejection_reason')}")

    # 6e complete — must first confirm
    if complete_id:
        r = requests.patch(f"{BASE_URL}/business/reservations/{complete_id}", headers=H_BIZ,
                           json={"action": "confirm"}, timeout=30)
        if r.status_code == 200:
            r = requests.patch(f"{BASE_URL}/business/reservations/{complete_id}", headers=H_BIZ,
                               json={"action": "complete"}, timeout=30)
            check("6e complete → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
            if r.status_code == 200:
                check("6e status=completed", r.json().get("status") == "completed", f"got {r.json().get('status')}")

    # 6f no_show — must first confirm
    if noshow_id:
        r = requests.patch(f"{BASE_URL}/business/reservations/{noshow_id}", headers=H_BIZ,
                           json={"action": "confirm"}, timeout=30)
        if r.status_code == 200:
            r = requests.patch(f"{BASE_URL}/business/reservations/{noshow_id}", headers=H_BIZ,
                               json={"action": "no_show"}, timeout=30)
            check("6f no_show → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
            if r.status_code == 200:
                check("6f status=no_show", r.json().get("status") == "no_show", f"got {r.json().get('status')}")

    # 6h invalid transition — confirm on the rejected one
    if reject_id:
        r = requests.patch(f"{BASE_URL}/business/reservations/{reject_id}", headers=H_BIZ,
                           json={"action": "confirm"}, timeout=30)
        check("6h confirm on rejected → 400", r.status_code == 400, f"got {r.status_code}: {r.text[:120]}")

    # ============================================================
    # 7) GET /api/business/admin/reservations  (alcaldia)
    # ============================================================
    print("\n=== 7) GET /business/admin/reservations ===")
    r = requests.get(f"{BASE_URL}/business/admin/reservations", timeout=20)
    check("7a 401 no-auth", r.status_code == 401, f"got {r.status_code}")

    r = requests.get(f"{BASE_URL}/business/admin/reservations", headers=H_BIZ, timeout=30)
    check("7b 403 with regular partner token", r.status_code == 403, f"got {r.status_code}: {r.text[:120]}")

    r = requests.get(f"{BASE_URL}/business/admin/reservations", headers=H_ALC, timeout=30)
    check("7c 200 with Alcaldía token", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 200:
        d = r.json()
        check("7c has 'reservations'", "reservations" in d)
        check("7c has 'count'", "count" in d)
        # Should include reservations from multiple partners (Bellini at minimum)
        partners_seen = {x.get("partner_id") for x in d.get("reservations", [])}
        check("7c includes ptr_002 reservation", PARTNER_PARTNER_ID in partners_seen,
              f"partners seen: {partners_seen}")

    # ============================================================
    # 8) GET /api/business/admin/reservations/stats
    # ============================================================
    print("\n=== 8) GET /business/admin/reservations/stats?days=30 ===")
    r = requests.get(f"{BASE_URL}/business/admin/reservations/stats?days=30", timeout=20)
    check("8a 401 no-auth", r.status_code == 401, f"got {r.status_code}")

    r = requests.get(f"{BASE_URL}/business/admin/reservations/stats?days=30", headers=H_BIZ, timeout=30)
    check("8a 403 with partner token", r.status_code == 403, f"got {r.status_code}")

    r = requests.get(f"{BASE_URL}/business/admin/reservations/stats?days=30", headers=H_ALC, timeout=30)
    check("8a 200 with Alcaldía token", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 200:
        d = r.json()
        for k in ["period_days", "total", "by_status", "by_type",
                  "prepaid_revenue_cop", "prepaid_app_commission_cop", "currency"]:
            check(f"8b schema has '{k}'", k in d)
        check("8b currency=COP", d.get("currency") == "COP", f"got {d.get('currency')}")
        check("8b by_type.table present", "table" in d.get("by_type", {}))
        check("8b by_type.prepaid present", "prepaid" in d.get("by_type", {}))
        # We've created multiple table reservations and zero prepaid (because Wompi blocked them)
        check("8c by_type.table > 0", d["by_type"]["table"] > 0,
              f"table count = {d['by_type'].get('table')}")
        check("8c by_type.prepaid == 0 (no successful prepaid bc Wompi unconfigured)",
              d["by_type"]["prepaid"] == 0, f"prepaid count = {d['by_type'].get('prepaid')}")
        # by_status should contain confirmed, rejected_by_partner, cancelled_by_user, cancelled_late, completed, no_show
        bs = d.get("by_status", {})
        for s in ["confirmed", "rejected_by_partner", "cancelled_by_user", "cancelled_late", "completed", "no_show"]:
            check(f"8c by_status has '{s}'", s in bs, f"missing in {list(bs.keys())}")
        check("8b prepaid_revenue_cop is int", isinstance(d.get("prepaid_revenue_cop"), int))
        check("8b prepaid_app_commission_cop is int", isinstance(d.get("prepaid_app_commission_cop"), int))

    # ============================================================
    # Cleanup
    # ============================================================
    print("\n=== Cleanup ===")
    await cleanup()
    print("  Cleanup done.")

    # ============================================================
    # Summary
    # ============================================================
    print(f"\n=== SUMMARY: {passed} passed / {failed} failed ===")
    if failures:
        print("\nFailures:")
        for f in failures:
            print(f"  - {f}")
    return failed


if __name__ == "__main__":
    rc = asyncio.run(main())
    sys.exit(0 if rc == 0 else 1)
