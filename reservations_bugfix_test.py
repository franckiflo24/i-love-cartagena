"""Focused retest for the 2 bug fixes in /app/backend/reservations.py.

BUG 1: party_size=0 must return 400 (and qty=0 on prepaid must return 400).
BUG 2: Double-cancel must be rejected (400 with detail mentioning current status).
"""
import asyncio
import sys
import uuid
from datetime import datetime, timedelta, timezone

import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = "https://cartagena-live.preview.emergentagent.com/api"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "test_database"
TEST_PREFIX = "resbugfix_"

PARTNER_ID = "ptr_002"  # Bellini (non-government)

passed = 0
failed = 0
failures: list[str] = []


def check(label, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  OK   {label}")
    else:
        failed += 1
        failures.append(f"{label} — {detail}")
        print(f"  FAIL {label} — {detail}")


async def seed_user() -> tuple[str, str]:
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    user_id = f"user_{TEST_PREFIX}{uuid.uuid4().hex[:10]}"
    token = f"st_{TEST_PREFIX}{uuid.uuid4().hex}"
    await db.users.insert_one({
        "user_id": user_id,
        "email": f"sofia.{TEST_PREFIX}{uuid.uuid4().hex[:6]}@example.com",
        "name": "Sofía Test",
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
    await db.users.delete_many({"user_id": {"$regex": f"^user_{TEST_PREFIX}"}})
    await db.user_sessions.delete_many({"session_token": {"$regex": f"^st_{TEST_PREFIX}"}})
    await db.reservations.delete_many({"user_id": {"$regex": f"^user_{TEST_PREFIX}"}})
    await db.payments.delete_many({"user_id": {"$regex": f"^user_{TEST_PREFIX}"}})
    c.close()


async def get_reservation_from_db(reservation_id: str) -> dict | None:
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    doc = await db.reservations.find_one({"reservation_id": reservation_id}, {"_id": 0})
    c.close()
    return doc


async def main():
    print("\n=== Setup ===")
    user_id, token = await seed_user()
    H = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    tomorrow = (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%d")
    print(f"  user_id = {user_id}")
    print(f"  tomorrow = {tomorrow}")

    # ── BUG 1: party_size=0 on table must return 400 ──
    print("\n=== BUG 1a: POST /reservations type=table party_size=0 → 400 ===")
    r = requests.post(f"{BASE_URL}/reservations", headers=H, json={
        "partner_id": PARTNER_ID,
        "type": "table",
        "date": tomorrow,
        "time": "20:00",
        "party_size": 0,
    }, timeout=30)
    check("Bug1a party_size=0 returns 400", r.status_code == 400,
          f"got {r.status_code}: body={r.text[:300]}")
    if r.status_code == 400:
        try:
            detail = r.json().get("detail", "")
            check("Bug1a detail mentions party_size 1-30",
                  "party_size" in detail.lower() or "1" in detail,
                  f"detail={detail!r}")
        except Exception:
            pass

    # Verify no reservation was created in DB for this user
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    count_after = await db.reservations.count_documents({"user_id": user_id})
    c.close()
    check("Bug1a no reservation created in DB for party_size=0",
          count_after == 0, f"db has {count_after} reservations for user")

    # ── BUG 1b: qty=0 on prepaid must return 400 BEFORE hitting Wompi ──
    print("\n=== BUG 1b: POST /reservations type=prepaid qty=0 → 400 ===")
    r = requests.post(f"{BASE_URL}/reservations", headers=H, json={
        "partner_id": PARTNER_ID,
        "type": "prepaid",
        "date": tomorrow,
        "time": "08:00",
        "party_size": 2,
        "qty": 0,
        "amount_cop": 50000,
    }, timeout=30)
    check("Bug1b qty=0 returns 400 (not 503 Wompi)", r.status_code == 400,
          f"got {r.status_code}: body={r.text[:300]}")
    if r.status_code == 400:
        try:
            detail = r.json().get("detail", "")
            check("Bug1b detail mentions 'qty debe ser al menos 1'",
                  "qty" in detail.lower(),
                  f"detail={detail!r}")
        except Exception:
            pass

    # ── BUG 2: Double-cancel must be rejected ──
    print("\n=== BUG 2: Idempotent / double-cancel rejection ===")
    # 1. Create a tomorrow-table reservation
    r = requests.post(f"{BASE_URL}/reservations", headers=H, json={
        "partner_id": PARTNER_ID,
        "type": "table",
        "date": tomorrow,
        "time": "20:30",
        "party_size": 2,
        "notes": "Double cancel test",
    }, timeout=30)
    check("Bug2 prep: create reservation → 200", r.status_code == 200,
          f"got {r.status_code}: {r.text[:200]}")
    reservation_id = None
    if r.status_code == 200:
        reservation_id = r.json()["reservation"]["reservation_id"]
        check("Bug2 prep: reservation_id returned",
              bool(reservation_id), f"got {reservation_id}")

    if reservation_id:
        # 2. First cancel
        r = requests.post(f"{BASE_URL}/reservations/{reservation_id}/cancel",
                          headers=H, timeout=30)
        check("Bug2 first cancel → 200", r.status_code == 200,
              f"got {r.status_code}: {r.text[:200]}")
        if r.status_code == 200:
            d = r.json()
            check("Bug2 first cancel status=cancelled_by_user",
                  d["reservation"].get("status") == "cancelled_by_user",
                  f"got {d['reservation'].get('status')}")
            check("Bug2 first cancel free_cancellation=true",
                  d.get("free_cancellation") is True,
                  f"got {d.get('free_cancellation')}")

        # Snapshot the original cancelled_at from DB
        doc1 = await get_reservation_from_db(reservation_id)
        original_cancelled_at = doc1.get("cancelled_at") if doc1 else None
        original_status = doc1.get("status") if doc1 else None
        check("Bug2 original status in DB is cancelled_by_user",
              original_status == "cancelled_by_user",
              f"got {original_status}")
        check("Bug2 original cancelled_at recorded in DB",
              bool(original_cancelled_at),
              f"got {original_cancelled_at!r}")

        # 3. Second cancel — should return 400
        r2 = requests.post(f"{BASE_URL}/reservations/{reservation_id}/cancel",
                           headers=H, timeout=30)
        check("Bug2 SECOND cancel → 400 (NOT 200)", r2.status_code == 400,
              f"got {r2.status_code}: {r2.text[:300]}")
        if r2.status_code == 400:
            try:
                detail = r2.json().get("detail", "")
                check(
                    "Bug2 second cancel detail mentions 'ya está en estado'",
                    "ya está en estado" in detail and "cancelled_by_user" in detail,
                    f"detail={detail!r}",
                )
            except Exception:
                pass

        # 4. Verify DB: status still cancelled_by_user AND cancelled_at unchanged
        doc2 = await get_reservation_from_db(reservation_id)
        check("Bug2 DB still status=cancelled_by_user (not overwritten to cancelled_late)",
              doc2 and doc2.get("status") == "cancelled_by_user",
              f"got status={doc2.get('status') if doc2 else None}")
        check("Bug2 DB cancelled_at preserved (not overwritten)",
              doc2 and doc2.get("cancelled_at") == original_cancelled_at,
              f"original={original_cancelled_at!r} now={doc2.get('cancelled_at') if doc2 else None!r}")

    # ── Cleanup ──
    print("\n=== Cleanup ===")
    await cleanup()
    print("  Done.")

    print(f"\n=== SUMMARY: {passed} passed / {failed} failed ===")
    if failures:
        print("\nFailures:")
        for f in failures:
            print(f"  - {f}")
    return failed


if __name__ == "__main__":
    rc = asyncio.run(main())
    sys.exit(0 if rc == 0 else 1)
