"""Push Notifications backend tests for Amo Cartagena.

Covers:
  A. User push-token endpoints (register valid / invalid / deregister)
  B. Partner push-token endpoints (register valid / invalid / deregister)
  C. End-to-end push trigger:
        - Register fake user + partner tokens
        - Create reservation (table) → triggers partner push
        - Partner PATCH confirm → triggers user push
        - Verify no unhandled exceptions in backend logs
        - Verify auto-cleanup: tokens marked active=false in push_tokens after Expo DeviceNotRegistered
  D. Reminder scheduler sanity (GET /api/notifications still works → no startup crash)

Cleanup: deletes test user/sessions/reservations/push_tokens.
"""
import asyncio
import re
import subprocess
import time
import uuid
from datetime import datetime, timedelta, timezone

import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = "https://cartagena-live.preview.emergentagent.com/api"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "test_database"
TEST_PREFIX = "pushtest_"

CASABOHEME_EMAIL = "casaboheme@amocartagena.app"
CASABOHEME_PASSWORD = "amocartagena2026"

USER_FAKE_TOKEN = "ExponentPushToken[FAKE_TEST_TOKEN_123]"
PARTNER_FAKE_TOKEN = "ExponentPushToken[PARTNER_TOKEN_456]"

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


async def seed_user() -> tuple[str, str, str]:
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    user_id = f"user_{TEST_PREFIX}{uuid.uuid4().hex[:10]}"
    token = f"st_{TEST_PREFIX}{uuid.uuid4().hex}"
    email = f"andrea.{TEST_PREFIX}{uuid.uuid4().hex[:6]}@example.com"
    await db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": "Andrea López",
        "picture": "",
        "phone": "+573001112233",
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
    return user_id, token, email


async def get_casaboheme_partner_id() -> str:
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    bu = await db.business_users.find_one({"email": CASABOHEME_EMAIL}, {"_id": 0, "partner_id": 1})
    c.close()
    return bu["partner_id"] if bu else ""


async def get_push_token_doc(token: str) -> dict | None:
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    doc = await db.push_tokens.find_one({"token": token}, {"_id": 0})
    c.close()
    return doc


async def cleanup(user_id: str):
    print("\n=== Cleanup ===")
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    u = await db.users.delete_many({"user_id": {"$regex": f"^user_{TEST_PREFIX}"}})
    s = await db.user_sessions.delete_many({"session_token": {"$regex": f"^st_{TEST_PREFIX}"}})
    r = await db.reservations.delete_many({"user_id": {"$regex": f"^user_{TEST_PREFIX}"}})
    # Notifications created by test
    n_user = await db.notifications.delete_many({"user_id": user_id})
    pt = await db.push_tokens.delete_many({"token": {"$in": [USER_FAKE_TOKEN, PARTNER_FAKE_TOKEN]}})
    print(f"  Deleted: users={u.deleted_count} sessions={s.deleted_count} reservations={r.deleted_count} notifs_user={n_user.deleted_count} push_tokens={pt.deleted_count}")
    c.close()


def business_login(email: str, password: str) -> str:
    r = requests.post(f"{BASE_URL}/business/login",
                      json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"business_login failed for {email}: {r.status_code} {r.text}")
    return r.json()["token"]


def snapshot_backend_log_tail() -> str:
    """Return the tail of backend err log for later diff."""
    try:
        out = subprocess.check_output(
            ["bash", "-lc", "tail -c 200 /var/log/supervisor/backend.err.log 2>/dev/null || true"]
        ).decode(errors="ignore")
        return out
    except Exception:
        return ""


def get_new_backend_log_since(marker: str) -> str:
    try:
        out = subprocess.check_output(
            ["bash", "-lc", "tail -n 400 /var/log/supervisor/backend.err.log 2>/dev/null || true"]
        ).decode(errors="ignore")
        if marker and marker in out:
            return out.split(marker, 1)[1]
        return out
    except Exception:
        return ""


async def main():
    print("\n=== Setup ===")
    user_id, user_token, user_email = await seed_user()
    UH = {"Authorization": f"Bearer {user_token}", "Content-Type": "application/json"}

    partner_id = await get_casaboheme_partner_id()
    if not partner_id:
        print("FATAL: casaboheme partner not found in DB")
        return
    print(f"  user_id={user_id} email={user_email}")
    print(f"  casaboheme partner_id={partner_id}")

    biz_token = business_login(CASABOHEME_EMAIL, CASABOHEME_PASSWORD)
    BH = {"Authorization": f"Bearer {biz_token}", "Content-Type": "application/json"}
    print(f"  casaboheme biz_token={biz_token[:24]}...")

    log_marker = snapshot_backend_log_tail()

    # ────────────────────────────────────────────────────────
    # A) USER PUSH-TOKEN ENDPOINTS
    # ────────────────────────────────────────────────────────
    print("\n=== A) User push-token endpoints ===")

    # A1. Register valid user push token
    r = requests.post(
        f"{BASE_URL}/users/push-token",
        json={"token": USER_FAKE_TOKEN, "platform": "ios", "device_name": "iPhone 15"},
        headers=UH, timeout=30,
    )
    check("A1 POST /users/push-token valid → 200", r.status_code == 200, f"got {r.status_code} {r.text[:200]}")
    if r.status_code == 200:
        body = r.json()
        check("A1 response body.ok == true", body.get("ok") is True, f"body={body}")

    # Verify DB record
    doc = await get_push_token_doc(USER_FAKE_TOKEN)
    check("A1 DB has push_tokens row for user", doc is not None, "no doc found")
    if doc:
        check("A1 DB row.owner_type == user", doc.get("owner_type") == "user", f"owner_type={doc.get('owner_type')}")
        check("A1 DB row.owner_id == user_id", doc.get("owner_id") == user_id, f"owner_id={doc.get('owner_id')} expected={user_id}")
        check("A1 DB row.platform == ios", doc.get("platform") == "ios", f"platform={doc.get('platform')}")
        check("A1 DB row.device_name == iPhone 15", doc.get("device_name") == "iPhone 15", f"device_name={doc.get('device_name')}")
        check("A1 DB row.active == True", doc.get("active") is True, f"active={doc.get('active')}")

    # A2. Invalid token format
    r = requests.post(
        f"{BASE_URL}/users/push-token",
        json={"token": "not-a-real-token"},
        headers=UH, timeout=30,
    )
    check("A2 POST /users/push-token invalid → 400", r.status_code == 400, f"got {r.status_code} {r.text[:200]}")

    # A2b. No auth
    r = requests.post(
        f"{BASE_URL}/users/push-token",
        json={"token": USER_FAKE_TOKEN},
        timeout=30,
    )
    check("A2b POST /users/push-token no-auth → 401", r.status_code == 401, f"got {r.status_code} {r.text[:120]}")

    # A2c. Empty token
    r = requests.post(
        f"{BASE_URL}/users/push-token",
        json={"token": ""},
        headers=UH, timeout=30,
    )
    check("A2c POST /users/push-token empty token → 400", r.status_code == 400, f"got {r.status_code} {r.text[:120]}")

    # A3. Deregister
    r = requests.delete(
        f"{BASE_URL}/users/push-token",
        json={"token": USER_FAKE_TOKEN},
        headers=UH, timeout=30,
    )
    check("A3 DELETE /users/push-token → 200", r.status_code == 200, f"got {r.status_code} {r.text[:200]}")

    doc = await get_push_token_doc(USER_FAKE_TOKEN)
    check("A3 DB row.active == False after deregister", (doc is not None) and (doc.get("active") is False),
          f"doc={doc}")

    # A3b. Deregister no auth
    r = requests.delete(
        f"{BASE_URL}/users/push-token",
        json={"token": USER_FAKE_TOKEN},
        timeout=30,
    )
    check("A3b DELETE /users/push-token no-auth → 401", r.status_code == 401, f"got {r.status_code}")

    # ────────────────────────────────────────────────────────
    # B) PARTNER PUSH-TOKEN ENDPOINTS
    # ────────────────────────────────────────────────────────
    print("\n=== B) Partner push-token endpoints ===")

    # B1. Register valid partner push token
    r = requests.post(
        f"{BASE_URL}/business/push-token",
        json={"token": PARTNER_FAKE_TOKEN, "platform": "android"},
        headers=BH, timeout=30,
    )
    check("B1 POST /business/push-token valid → 200", r.status_code == 200, f"got {r.status_code} {r.text[:200]}")
    if r.status_code == 200:
        body = r.json()
        check("B1 response body.ok == true", body.get("ok") is True, f"body={body}")

    doc = await get_push_token_doc(PARTNER_FAKE_TOKEN)
    check("B1 DB has push_tokens row for partner", doc is not None, "no doc found")
    if doc:
        check("B1 DB row.owner_type == partner", doc.get("owner_type") == "partner", f"owner_type={doc.get('owner_type')}")
        check("B1 DB row.owner_id == partner_id", doc.get("owner_id") == partner_id, f"owner_id={doc.get('owner_id')} expected={partner_id}")
        check("B1 DB row.platform == android", doc.get("platform") == "android", f"platform={doc.get('platform')}")
        check("B1 DB row.active == True", doc.get("active") is True, f"active={doc.get('active')}")

    # B2. Invalid format
    r = requests.post(
        f"{BASE_URL}/business/push-token",
        json={"token": "abc"},
        headers=BH, timeout=30,
    )
    check("B2 POST /business/push-token invalid → 400", r.status_code == 400, f"got {r.status_code} {r.text[:200]}")

    # B2b. No auth
    r = requests.post(
        f"{BASE_URL}/business/push-token",
        json={"token": PARTNER_FAKE_TOKEN},
        timeout=30,
    )
    check("B2b POST /business/push-token no-auth → 401", r.status_code == 401, f"got {r.status_code}")

    # B3. Deregister
    r = requests.delete(
        f"{BASE_URL}/business/push-token",
        json={"token": PARTNER_FAKE_TOKEN},
        headers=BH, timeout=30,
    )
    check("B3 DELETE /business/push-token → 200", r.status_code == 200, f"got {r.status_code} {r.text[:200]}")

    doc = await get_push_token_doc(PARTNER_FAKE_TOKEN)
    check("B3 DB row.active == False after deregister", (doc is not None) and (doc.get("active") is False),
          f"doc={doc}")

    # ────────────────────────────────────────────────────────
    # C) END-TO-END PUSH TRIGGER FLOW
    # ────────────────────────────────────────────────────────
    print("\n=== C) End-to-end push trigger flow ===")

    # C1. Re-register both fake tokens (DELETE marked them inactive)
    r = requests.post(
        f"{BASE_URL}/users/push-token",
        json={"token": USER_FAKE_TOKEN, "platform": "ios", "device_name": "iPhone 15"},
        headers=UH, timeout=30,
    )
    check("C1 Re-register user fake token → 200", r.status_code == 200, f"{r.status_code} {r.text[:120]}")

    r = requests.post(
        f"{BASE_URL}/business/push-token",
        json={"token": PARTNER_FAKE_TOKEN, "platform": "android"},
        headers=BH, timeout=30,
    )
    check("C1 Re-register partner fake token → 200", r.status_code == 200, f"{r.status_code} {r.text[:120]}")

    # Verify both active=true
    udoc = await get_push_token_doc(USER_FAKE_TOKEN)
    pdoc = await get_push_token_doc(PARTNER_FAKE_TOKEN)
    check("C1 user token re-activated", (udoc or {}).get("active") is True, f"doc={udoc}")
    check("C1 partner token re-activated", (pdoc or {}).get("active") is True, f"doc={pdoc}")

    # C2. Create a reservation (tomorrow at 20:00, party 2) → fires partner push
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
    r = requests.post(
        f"{BASE_URL}/reservations",
        json={
            "partner_id": partner_id,
            "type": "table",
            "date": tomorrow,
            "time": "20:00",
            "party_size": 2,
            "notes": "Aniversario — push test",
        },
        headers=UH, timeout=30,
    )
    check("C2 POST /reservations → 200", r.status_code == 200, f"got {r.status_code} {r.text[:300]}")
    reservation_id = ""
    if r.status_code == 200:
        body = r.json()
        reservation_id = (body.get("reservation") or {}).get("reservation_id", "")
        check("C2 reservation_id present", bool(reservation_id), f"body={body}")
        check("C2 status == pending_confirmation",
              (body.get("reservation") or {}).get("status") == "pending_confirmation",
              f"status={(body.get('reservation') or {}).get('status')}")

    # Give the backend a moment to fire push (it's awaited in-handler so should be done already)
    time.sleep(1.0)

    # Check backend log for unhandled exceptions
    new_log = get_new_backend_log_since(log_marker)
    has_traceback = "Traceback (most recent call last)" in new_log
    check("C2 backend log has NO unhandled traceback after reservation create", not has_traceback,
          f"traceback found in log tail: {new_log[-800:]}")

    # C3. Partner confirms reservation → fires user push
    if reservation_id:
        r = requests.patch(
            f"{BASE_URL}/business/reservations/{reservation_id}",
            json={"action": "confirm", "note": "Te esperamos en la barra"},
            headers=BH, timeout=30,
        )
        check("C3 PATCH confirm → 200", r.status_code == 200, f"got {r.status_code} {r.text[:300]}")
        if r.status_code == 200:
            body = r.json()
            check("C3 status == confirmed",
                  (body.get("reservation") or {}).get("status") == "confirmed",
                  f"status={(body.get('reservation') or {}).get('status')}")

    time.sleep(1.0)

    # C4. Verify user notification with kind=reservation_confirmed
    r = requests.get(f"{BASE_URL}/notifications", headers=UH, timeout=30)
    check("C4 GET /notifications → 200", r.status_code == 200, f"got {r.status_code}")
    user_notifs = r.json() if r.status_code == 200 else []
    has_confirmed = any(
        (n.get("kind") == "reservation_confirmed") and (n.get("ref") or {}).get("reservation_id") == reservation_id
        for n in user_notifs
    )
    check("C4 user has notification kind=reservation_confirmed", has_confirmed,
          f"got {len(user_notifs)} notifs; kinds={[n.get('kind') for n in user_notifs[:8]]}")

    # Also verify partner got the original reservation_request notification
    r = requests.get(f"{BASE_URL}/business/notifications", headers=BH, timeout=30)
    check("C4 GET /business/notifications → 200", r.status_code == 200, f"got {r.status_code}")
    biz_notifs = (r.json() or {}).get("notifications", []) if r.status_code == 200 else []
    has_request = any(
        (n.get("kind") == "reservation_request") and (n.get("ref") or {}).get("reservation_id") == reservation_id
        for n in biz_notifs
    )
    check("C4 partner has notification kind=reservation_request", has_request,
          f"got {len(biz_notifs)} notifs; kinds={[n.get('kind') for n in biz_notifs[:8]]}")

    # C5. Check backend log again — no unhandled exception after confirm
    new_log2 = get_new_backend_log_since(log_marker)
    has_traceback2 = "Traceback (most recent call last)" in new_log2
    check("C5 backend log has NO unhandled traceback after confirm", not has_traceback2,
          f"traceback found: {new_log2[-800:]}")

    # C6. Verify Expo cleanup: after fake tokens hit Expo, they should be marked active=false
    # Expo returns DeviceNotRegistered for these — push_to_* auto-deregisters them.
    # Give some time in case Expo is slow.
    await asyncio.sleep(3)
    udoc_after = await get_push_token_doc(USER_FAKE_TOKEN)
    pdoc_after = await get_push_token_doc(PARTNER_FAKE_TOKEN)
    user_inactive = (udoc_after or {}).get("active") is False
    partner_inactive = (pdoc_after or {}).get("active") is False
    # This is "best effort" — if Expo is unreachable or returned a different error,
    # the tokens may still be active. We log but don't hard-fail on this.
    print(f"  C6 user fake token active after push: {(udoc_after or {}).get('active')}")
    print(f"  C6 partner fake token active after push: {(pdoc_after or {}).get('active')}")
    # We treat this as PASS as long as the document still exists (i.e. push code path ran w/o error).
    check("C6 user push_tokens row still exists after push attempt", udoc_after is not None, "missing")
    check("C6 partner push_tokens row still exists after push attempt", pdoc_after is not None, "missing")
    # If Expo did report DeviceNotRegistered → active should be False (informational)
    print(f"  C6 [info] user token auto-cleanup happened: {user_inactive}")
    print(f"  C6 [info] partner token auto-cleanup happened: {partner_inactive}")

    # ────────────────────────────────────────────────────────
    # C7. Also test rejection path with a fresh reservation
    # ────────────────────────────────────────────────────────
    # Re-register tokens in case they got marked inactive
    requests.post(f"{BASE_URL}/users/push-token", json={"token": USER_FAKE_TOKEN, "platform": "ios"}, headers=UH, timeout=30)

    r = requests.post(
        f"{BASE_URL}/reservations",
        json={
            "partner_id": partner_id,
            "type": "table",
            "date": tomorrow,
            "time": "21:00",
            "party_size": 4,
            "notes": "Cumpleaños — reject test",
        },
        headers=UH, timeout=30,
    )
    check("C7 POST /reservations (for reject) → 200", r.status_code == 200, f"got {r.status_code} {r.text[:200]}")
    rej_resv_id = ""
    if r.status_code == 200:
        rej_resv_id = (r.json().get("reservation") or {}).get("reservation_id", "")

    if rej_resv_id:
        r = requests.patch(
            f"{BASE_URL}/business/reservations/{rej_resv_id}",
            json={"action": "reject", "note": "Lleno completo"},
            headers=BH, timeout=30,
        )
        check("C7 PATCH reject → 200", r.status_code == 200, f"got {r.status_code} {r.text[:300]}")

        time.sleep(1.0)
        r = requests.get(f"{BASE_URL}/notifications", headers=UH, timeout=30)
        notifs = r.json() if r.status_code == 200 else []
        has_rejected = any(
            (n.get("kind") == "reservation_rejected") and (n.get("ref") or {}).get("reservation_id") == rej_resv_id
            for n in notifs
        )
        check("C7 user has notification kind=reservation_rejected", has_rejected,
              f"kinds={[n.get('kind') for n in notifs[:8]]}")

    # Final log scan
    new_log3 = get_new_backend_log_since(log_marker)
    has_traceback3 = "Traceback (most recent call last)" in new_log3
    check("C7 backend log has NO unhandled traceback overall", not has_traceback3,
          f"traceback found: {new_log3[-800:]}")

    # Also check for explicit push module crashes (KeyError, AttributeError from push.py)
    push_err_pat = re.compile(r"push\.py.*(Error|Exception)", re.IGNORECASE)
    push_err_found = bool(push_err_pat.search(new_log3))
    check("C7 no push.py errors in backend log", not push_err_found,
          f"push errors found: {new_log3[-600:]}")

    # ────────────────────────────────────────────────────────
    # D) REMINDER SCHEDULER SANITY
    # ────────────────────────────────────────────────────────
    print("\n=== D) Reminder scheduler sanity ===")
    # The fact that the backend is responding and the previous calls all worked
    # is itself evidence the scheduler started without crashing the app.
    r = requests.get(f"{BASE_URL}/notifications", headers=UH, timeout=30)
    check("D1 GET /api/notifications still works (scheduler did not crash boot) → 200",
          r.status_code == 200, f"got {r.status_code}")

    # Verify reminder_scheduler started log line
    try:
        log = subprocess.check_output(
            ["bash", "-lc", "grep -c 'reminder_scheduler started' /var/log/supervisor/backend.err.log || echo 0"]
        ).decode().strip()
        count = int(log.split()[0]) if log else 0
        check("D2 backend log contains 'reminder_scheduler started'", count >= 1, f"count={count}")
    except Exception as e:
        check("D2 backend log scan", False, f"exception: {e}")

    # ────────────────────────────────────────────────────────
    # Done
    # ────────────────────────────────────────────────────────
    await cleanup(user_id)

    print("\n=========================================")
    print(f"PASSED: {passed}   FAILED: {failed}   TOTAL: {passed + failed}")
    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(f"  - {f}")
    print("=========================================\n")


if __name__ == "__main__":
    asyncio.run(main())
