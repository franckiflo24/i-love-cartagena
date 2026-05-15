"""
Test the FULL reservation confirmation → user notification flow end-to-end
against the Amo Cartagena backend.

Sequence:
  1. Authenticate as a normal user (seeded via direct Mongo insert because the
     app uses Google OAuth and exposes no email/password endpoint for users).
  2. POST /api/reservations for casaboheme (partner_id=ptr_nc_007, plan=pro).
  3. GET /api/notifications → no reservation_confirmed yet.
  4. POST /api/business/login as casaboheme@amocartagena.app.
  5. PATCH /api/business/reservations/{id} {action:'confirm'}.
  6. GET /api/notifications → new reservation_confirmed notif present.
  7. GET /api/reservations/my → reservation status=confirmed + confirmed_at + payment link.
  8. PUT /api/notifications/{id}/read → notification marked read.

All test data created in this run is purged at the end.
"""

import json
import os
import sys
import uuid
import asyncio
from datetime import datetime, timezone, timedelta

import requests
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BACKEND_URL = "https://cartagena-live.preview.emergentagent.com"
API = f"{BACKEND_URL}/api"
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

CASA_BOHEME_PARTNER_ID = "ptr_nc_007"  # NC version that has business login
CASA_BOHEME_EMAIL = "casaboheme@amocartagena.app"
CASA_BOHEME_PWD = "amocartagena2026"

PASSES = 0
FAILS = 0
REPORT = []


def step(title: str):
    print(f"\n── {title} " + "─" * (76 - len(title)))


def check(label: str, cond: bool, detail: str = ""):
    global PASSES, FAILS
    mark = "✓" if cond else "✗"
    line = f"  {mark} {label}"
    if detail:
        line += f"  ({detail})"
    print(line)
    REPORT.append((cond, label, detail))
    if cond:
        PASSES += 1
    else:
        FAILS += 1


def show_resp(prefix: str, r: requests.Response):
    try:
        body = r.json()
    except Exception:
        body = r.text
    print(f"    {prefix} status={r.status_code} body={json.dumps(body, ensure_ascii=False)[:600]}")


async def seed_test_user(db) -> tuple[str, str]:
    uid = f"user_resnotif_{uuid.uuid4().hex[:8]}"
    token = f"st_resnotif_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    await db.users.insert_one({
        "user_id": uid,
        "email": f"{uid}@example.com",
        "name": "María Pérez (test)",
        "picture": "",
        "favorites": [],
        "my_week": [],
        "created_at": now.isoformat(),
    })
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": uid,
        "expires_at": now + timedelta(days=1),
        "created_at": now,
    })
    return uid, token


async def cleanup(db, user_id: str):
    await db.users.delete_many({"user_id": user_id})
    await db.user_sessions.delete_many({"user_id": user_id})
    await db.reservations.delete_many({"user_id": user_id})
    await db.notifications.delete_many({"user_id": user_id})
    # Also nuke any partner-side notifs that reference reservations we created
    # (they reference partner_id, so we delete by created_at window using user_id ref)
    # We'll instead leave any partner notifs in place as the create flow only emits to partner_id
    # We do delete partner-side notifs whose ref.reservation_id matches our test reservations.


async def run():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    user_id, user_token = await seed_test_user(db)
    print(f"Seeded test user_id={user_id} session_token={user_token[:24]}…")

    user_headers = {"Authorization": f"Bearer {user_token}"}
    created_reservation_id = None
    confirmation_notif = None
    bn_token = None

    try:
        # ── STEP 1: verify auth works ──
        step("STEP 1 — User auth")
        r = requests.get(f"{API}/auth/me", headers=user_headers, timeout=20)
        check("GET /auth/me returns 200", r.status_code == 200, f"status={r.status_code}")
        if r.status_code == 200:
            check("user_id matches seeded", r.json().get("user_id") == user_id)

        # ── STEP 2: Create reservation ──
        step("STEP 2 — POST /api/reservations")
        tomorrow_plus_4 = (datetime.now(timezone.utc) + timedelta(days=4)).strftime("%Y-%m-%d")
        payload = {
            "partner_id": CASA_BOHEME_PARTNER_ID,
            "type": "request",
            "date": tomorrow_plus_4,
            "time": "20:00",
            "party_size": 4,
            "notes": "Mesa cerca de la ventana",
        }
        r = requests.post(f"{API}/reservations", json=payload, headers=user_headers, timeout=20)
        show_resp("POST /reservations →", r)
        check("POST /reservations status 200/201", r.status_code in (200, 201), f"status={r.status_code}")
        if r.status_code in (200, 201):
            body = r.json()
            res = body.get("reservation") or {}
            created_reservation_id = res.get("reservation_id")
            check("reservation_id present", bool(created_reservation_id),
                  f"reservation_id={created_reservation_id}")
            check("status == 'pending_confirmation' (partner is PRO)",
                  res.get("status") == "pending_confirmation",
                  f"got={res.get('status')} partner_plan={body.get('partner_plan')}")
            check("party_size echoed", res.get("party_size") == 4, f"got={res.get('party_size')}")
            check("notes preserved", res.get("notes") == "Mesa cerca de la ventana")
            check("partner.name hydrated", bool(res.get("partner", {}).get("name")),
                  f"partner.name={res.get('partner', {}).get('name')}")

        if not created_reservation_id:
            print("\n⚠️  Cannot continue without reservation_id. Aborting.")
            return

        # ── STEP 3: User should NOT have a reservation_confirmed notification yet ──
        step("STEP 3 — GET /api/notifications (before confirm)")
        r = requests.get(f"{API}/notifications", headers=user_headers, timeout=20)
        check("GET /notifications status 200", r.status_code == 200, f"status={r.status_code}")
        notifs_pre = r.json() if r.status_code == 200 else []
        kinds_pre = [n.get("kind") for n in notifs_pre]
        print(f"    notifications BEFORE confirm: count={len(notifs_pre)} kinds={kinds_pre}")
        check(
            "No 'reservation_confirmed' notification yet",
            all(n.get("kind") != "reservation_confirmed" for n in notifs_pre),
        )

        # ── STEP 4: Login as casaboheme partner ──
        step("STEP 4 — POST /api/business/login")
        r = requests.post(
            f"{API}/business/login",
            json={"email": CASA_BOHEME_EMAIL, "password": CASA_BOHEME_PWD},
            timeout=20,
        )
        check("Business login status 200", r.status_code == 200, f"status={r.status_code}")
        if r.status_code != 200:
            show_resp("Business login →", r)
            return
        body = r.json()
        bn_token = body.get("token")
        partner_pid = (body.get("business") or {}).get("partner_id")
        check("Business token returned", bool(bn_token), f"token={bn_token[:20]+'…' if bn_token else None}")
        check("Token's partner_id == ptr_nc_007",
              partner_pid == CASA_BOHEME_PARTNER_ID,
              f"got={partner_pid}")
        biz_headers = {"Authorization": f"Bearer {bn_token}"}

        # ── STEP 5: Partner confirms the reservation ──
        step("STEP 5 — PATCH /api/business/reservations/{id} {action: confirm}")
        r = requests.patch(
            f"{API}/business/reservations/{created_reservation_id}",
            json={"action": "confirm"},
            headers=biz_headers,
            timeout=20,
        )
        show_resp("PATCH confirm →", r)
        check("PATCH confirm status 200", r.status_code == 200, f"status={r.status_code}")
        if r.status_code == 200:
            cb = r.json()
            check("Response status == 'confirmed'", cb.get("status") == "confirmed",
                  f"got={cb.get('status')}")
            check("confirmed_at set in response", bool(cb.get("confirmed_at")),
                  f"confirmed_at={cb.get('confirmed_at')}")

        # ── STEP 6: User now has a 'reservation_confirmed' notification ──
        step("STEP 6 — GET /api/notifications (after confirm)")
        r = requests.get(f"{API}/notifications", headers=user_headers, timeout=20)
        check("GET /notifications status 200", r.status_code == 200, f"status={r.status_code}")
        notifs_post = r.json() if r.status_code == 200 else []
        kinds_post = [n.get("kind") for n in notifs_post]
        print(f"    notifications AFTER confirm: count={len(notifs_post)} kinds={kinds_post}")
        confirmation_notif = next(
            (n for n in notifs_post if n.get("kind") == "reservation_confirmed"), None
        )
        check("'reservation_confirmed' notification appears", confirmation_notif is not None)
        if confirmation_notif:
            print("\n  📄 Full notification JSON:")
            print("  " + json.dumps(confirmation_notif, ensure_ascii=False, indent=2).replace("\n", "\n  "))
            check("notification_id field present", "notification_id" in confirmation_notif)
            check("title == '¡Reserva confirmada!'",
                  confirmation_notif.get("title") == "¡Reserva confirmada!",
                  f"got={confirmation_notif.get('title')}")
            check("body field present and non-empty",
                  bool(confirmation_notif.get("body")),
                  f"body={confirmation_notif.get('body')}")
            check("body mentions partner name (Casa Bohème)",
                  "Casa Bohème" in (confirmation_notif.get("body") or "")
                  or "casa boheme" in (confirmation_notif.get("body") or "").lower(),
                  f"body={confirmation_notif.get('body')}")
            check("body mentions date",
                  tomorrow_plus_4 in (confirmation_notif.get("body") or ""),
                  f"body={confirmation_notif.get('body')}")
            check("kind == 'reservation_confirmed'",
                  confirmation_notif.get("kind") == "reservation_confirmed")
            check("is_read == False", confirmation_notif.get("is_read") is False,
                  f"is_read={confirmation_notif.get('is_read')}")
            check("created_at present", bool(confirmation_notif.get("created_at")))
            ref = confirmation_notif.get("ref") or {}
            check("ref is an object", isinstance(ref, dict))
            check("ref.reservation_id matches",
                  ref.get("reservation_id") == created_reservation_id,
                  f"got={ref.get('reservation_id')}")
            check("ref.partner_id matches",
                  ref.get("partner_id") == CASA_BOHEME_PARTNER_ID,
                  f"got={ref.get('partner_id')}")

        # ── STEP 7: /reservations/my reflects the new status ──
        step("STEP 7 — GET /api/reservations/my")
        r = requests.get(f"{API}/reservations/my", headers=user_headers, timeout=20)
        check("GET /reservations/my status 200", r.status_code == 200)
        if r.status_code == 200:
            data = r.json()
            all_items = (data.get("upcoming") or []) + (data.get("past") or [])
            mine = next((x for x in all_items if x.get("reservation_id") == created_reservation_id), None)
            check("Created reservation found in /reservations/my", mine is not None)
            if mine:
                check("status == 'confirmed'", mine.get("status") == "confirmed",
                      f"got={mine.get('status')}")
                check("confirmed_at set", bool(mine.get("confirmed_at")),
                      f"confirmed_at={mine.get('confirmed_at')}")
                partner_obj = mine.get("partner") or {}
                payment_info = mine.get("payment_info") or {}
                has_partner_link = bool(partner_obj.get("default_payment_link"))
                has_payment_info_link = bool(payment_info.get("payment_link"))
                check(
                    "Partner's default_payment_link OR payment_info.payment_link exposed (may be None if partner has not set one)",
                    has_partner_link or has_payment_info_link or (
                        # If partner did not set one, payment_info still appears (with None values)
                        "payment_info" in mine
                    ),
                    f"partner.default_payment_link={partner_obj.get('default_payment_link')} "
                    f"payment_info.payment_link={payment_info.get('payment_link')}",
                )
                print(f"    payment_info on confirmed reservation: {json.dumps(payment_info, ensure_ascii=False)}")

        # ── STEP 8: Mark notification as read ──
        step("STEP 8 — PUT /api/notifications/{id}/read")
        if confirmation_notif:
            nid = confirmation_notif["notification_id"]
            r = requests.put(f"{API}/notifications/{nid}/read", headers=user_headers, timeout=20)
            check("PUT mark-read status 200", r.status_code == 200, f"status={r.status_code}")
            # Re-fetch
            r = requests.get(f"{API}/notifications", headers=user_headers, timeout=20)
            if r.status_code == 200:
                updated_notif = next(
                    (n for n in r.json() if n.get("notification_id") == nid), None
                )
                check("Notification still present", updated_notif is not None)
                if updated_notif:
                    check("is_read flipped to True",
                          updated_notif.get("is_read") is True,
                          f"is_read={updated_notif.get('is_read')}")

    finally:
        # ── Cleanup ──
        step("CLEANUP")
        await cleanup(db, user_id)
        if created_reservation_id:
            await db.notifications.delete_many({"ref.reservation_id": created_reservation_id})
            await db.reservations.delete_many({"reservation_id": created_reservation_id})
        # Business logout
        if bn_token:
            try:
                requests.post(f"{API}/business/logout",
                              headers={"Authorization": f"Bearer {bn_token}"}, timeout=10)
            except Exception:
                pass
        print(f"  Test user/data purged (user_id={user_id}, reservation_id={created_reservation_id})")

    # ── Summary ──
    print("\n" + "=" * 80)
    total = PASSES + FAILS
    print(f"RESULTS: {PASSES}/{total} assertions passed  ({FAILS} failed)")
    if FAILS:
        print("\nFailed assertions:")
        for ok, label, detail in REPORT:
            if not ok:
                print(f"  ✗ {label}  {detail}")
    return FAILS == 0


if __name__ == "__main__":
    ok = asyncio.run(run())
    sys.exit(0 if ok else 1)
