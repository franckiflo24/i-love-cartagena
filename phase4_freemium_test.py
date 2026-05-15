"""
Phase 4 — FREEMIUM reservation gating tests.

Exercises:
  1) Reservation creation gates by partner plan (PRO vs FREE)
  2) Partner views own reservations with plan-aware response (censored for FREE)
  3) Partner action (PATCH) gated by PRO; state machine still validates
  4) Notifications differ by plan (reservation_request vs locked_lead)

Auth notes:
  - End-user auth is Google OAuth; we seed users directly into Mongo with a
    matching session token (prefix 'free4test_') so we can call /api endpoints
    via Bearer.
  - Business auth via POST /api/business/login.

Cleanup: deletes everything we created (users, sessions, reservations,
notifications), restores casaboheme.membership_plan = 'pro'.
"""

import asyncio
import os
import re
import sys
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any

import requests
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

BACKEND_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
API = f"{BACKEND_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

PRO_PARTNER = "ptr_nc_007"   # Casa Bohème (PRO)
PRO_EMAIL = "casaboheme@amocartagena.app"
PRO_PASSWORD = "amocartagena2026"

FREE_PARTNER = "ptr_006"     # El Arsenal Wellness (FREE) — has business user

TEST_PREFIX = "free4test"
results: list[tuple[bool, str]] = []
created_user_ids: set[str] = set()
created_session_tokens: set[str] = set()
created_reservation_ids: set[str] = set()


def check(cond: bool, msg: str):
    results.append((bool(cond), msg))
    marker = "✓" if cond else "✗"
    print(f"  {marker} {msg}")
    if not cond:
        print(f"      FAIL")


async def seed_user(db, label: str) -> tuple[dict, str]:
    """Insert a user + session row directly into Mongo. Returns (user, token)."""
    uid = f"user_{TEST_PREFIX}_{uuid.uuid4().hex[:10]}"
    token = f"sess_{TEST_PREFIX}_{uuid.uuid4().hex[:20]}"
    user_doc = {
        "user_id": uid,
        "email": f"{label}.{uuid.uuid4().hex[:6]}@amocartagena.test",
        "name": f"María {label.capitalize()} Restrepo",
        "phone": "+573001112233",
        "whatsapp": "+573001112233",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(dict(user_doc))
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": uid,
        "email": user_doc["email"],
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    created_user_ids.add(uid)
    created_session_tokens.add(token)
    return user_doc, token


def biz_login(email: str, password: str) -> str:
    r = requests.post(f"{API}/business/login", json={"email": email, "password": password}, timeout=20)
    r.raise_for_status()
    j = r.json()
    return j.get("token") or j.get("session_token")


def bearer(t: str) -> dict:
    return {"Authorization": f"Bearer {t}"}


async def main():
    print(f"\n=== PHASE 4 FREEMIUM TEST against {API} ===\n")
    if not BACKEND_URL:
        print("EXPO_PUBLIC_BACKEND_URL missing")
        sys.exit(1)

    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    # Snapshot casaboheme plan to make absolutely sure we restore it
    original_casa = await db.partners.find_one({"partner_id": PRO_PARTNER}, {"_id": 0, "membership_plan": 1})
    print(f"[snapshot] casaboheme (ptr_nc_007).membership_plan = {original_casa.get('membership_plan') if original_casa else 'MISSING'}\n")

    try:
        # ─────────────────────────────────────────────────────────
        # 1) Reservation creation gates by partner plan
        # ─────────────────────────────────────────────────────────
        print("[1] Reservation creation gates by partner plan")
        user_a, ta = await seed_user(db, "alpha")
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=2)).date().isoformat()

        # 1a) PRO partner ptr_nc_007 (Casa Bohème)
        body = {"partner_id": PRO_PARTNER, "type": "table", "date": tomorrow, "time": "20:30",
                "party_size": 2, "notes": "Aniversario freemium PRO"}
        r = requests.post(f"{API}/reservations", json=body, headers=bearer(ta), timeout=20)
        check(r.status_code == 200, f"1a POST /reservations against PRO partner → 200 (got {r.status_code})")
        if r.status_code == 200:
            j = r.json()
            check(j.get("locked") is False, f"1a response.locked == false (got {j.get('locked')})")
            check(j.get("partner_plan") == "pro", f"1a response.partner_plan == 'pro' (got {j.get('partner_plan')})")
            check(j["reservation"]["status"] == "pending_confirmation",
                  f"1a reservation.status == 'pending_confirmation' (got {j['reservation']['status']})")
            check("partner" in (j.get("message") or "").lower() and "confirm" in (j.get("message") or "").lower(),
                  f"1a message in Spanish about partner confirming → got: {j.get('message')!r}")
            pro_res_id = j["reservation"]["reservation_id"]
            created_reservation_ids.add(pro_res_id)
        else:
            print(f"      body={r.text[:300]}")
            pro_res_id = None

        # 1b) FREE partner
        body = {"partner_id": FREE_PARTNER, "type": "table", "date": tomorrow, "time": "19:00",
                "party_size": 3, "notes": "Cena freemium FREE"}
        r = requests.post(f"{API}/reservations", json=body, headers=bearer(ta), timeout=20)
        check(r.status_code == 200, f"1b POST /reservations against FREE partner → 200 (got {r.status_code})")
        free_res_id = None
        if r.status_code == 200:
            j = r.json()
            check(j.get("locked") is True, f"1b response.locked == true (got {j.get('locked')})")
            check(j.get("partner_plan") == "free", f"1b response.partner_plan == 'free' (got {j.get('partner_plan')})")
            check(j["reservation"]["status"] == "pending_partner_activation",
                  f"1b reservation.status == 'pending_partner_activation' (got {j['reservation']['status']})")
            msg = (j.get("message") or "").lower()
            check("gestiona" in msg or "reservas" in msg or "amo cartagena" in msg or "aún no" in msg,
                  f"1b message in Spanish about partner not yet managing reservations → got: {j.get('message')!r}")
            free_res_id = j["reservation"]["reservation_id"]
            created_reservation_ids.add(free_res_id)
        else:
            print(f"      body={r.text[:300]}")

        # ─────────────────────────────────────────────────────────
        # 4) Notifications
        # ─────────────────────────────────────────────────────────
        print("\n[4] Notifications by plan")
        if pro_res_id:
            notif_pro = await db.notifications.find_one({
                "partner_id": PRO_PARTNER, "audience": "partner",
                "ref.reservation_id": pro_res_id,
            })
            check(bool(notif_pro), f"4h PRO reservation produced a partner notification")
            if notif_pro:
                check(notif_pro.get("kind") == "reservation_request",
                      f"4h PRO notification kind == 'reservation_request' (got {notif_pro.get('kind')})")
        if free_res_id:
            notif_free = await db.notifications.find_one({
                "partner_id": FREE_PARTNER, "audience": "partner",
                "ref.reservation_id": free_res_id,
            })
            check(bool(notif_free), f"4i FREE reservation produced a partner notification")
            if notif_free:
                check(notif_free.get("kind") == "locked_lead",
                      f"4i FREE notification kind == 'locked_lead' (got {notif_free.get('kind')})")
                check(notif_free.get("ref", {}).get("locked") is True,
                      f"4i FREE notification ref.locked === true (got {notif_free.get('ref',{}).get('locked')})")

        # ─────────────────────────────────────────────────────────
        # 2) Partner views own reservations with plan-aware response
        # ─────────────────────────────────────────────────────────
        print("\n[2] Partner views own reservations with plan-aware response")

        # 2c) PRO casaboheme
        pro_biz_token = biz_login(PRO_EMAIL, PRO_PASSWORD)
        r = requests.get(f"{API}/business/reservations", headers=bearer(pro_biz_token), timeout=20)
        check(r.status_code == 200, f"2c GET /business/reservations as PRO casaboheme → 200 (got {r.status_code})")
        if r.status_code == 200:
            j = r.json()
            check(j.get("membership_plan") == "pro", f"2c membership_plan == 'pro' (got {j.get('membership_plan')})")
            check(j.get("upgrade_required") is False, f"2c upgrade_required == false (got {j.get('upgrade_required')})")
            stats = j.get("stats") or {}
            check("locked_leads_count" in stats, f"2c stats.locked_leads_count present (got {list(stats.keys())})")
            check("estimated_locked_value_cop" in stats, f"2c stats.estimated_locked_value_cop present")
            # Find our PRO reservation in the list and verify it shows real values
            target = next((x for x in j.get("reservations", []) if x.get("reservation_id") == pro_res_id), None)
            if target:
                check(not target.get("is_locked"), f"2c PRO reservation is_locked is falsy (got {target.get('is_locked')})")
                check(target.get("user_email") == user_a["email"],
                      f"2c PRO reservation user_email is REAL (got {target.get('user_email')!r})")
                check(target.get("user_name") == user_a["name"],
                      f"2c PRO reservation user_name is REAL (got {target.get('user_name')!r})")
                check("•" not in (target.get("user_phone") or ""), f"2c PRO user_phone not censored (got {target.get('user_phone')!r})")
            else:
                check(False, f"2c could not find our PRO reservation in list")

        # 2d) FREE view — flip casaboheme to FREE, GET, then flip back
        print("\n[2d] Flipping casaboheme to FREE temporarily for censorship test")
        await db.partners.update_one({"partner_id": PRO_PARTNER}, {"$set": {"membership_plan": "free"}})
        try:
            r = requests.get(f"{API}/business/reservations", headers=bearer(pro_biz_token), timeout=20)
            check(r.status_code == 200, f"2d GET /business/reservations as (now-FREE) casaboheme → 200 (got {r.status_code})")
            if r.status_code == 200:
                j = r.json()
                check(j.get("membership_plan") == "free", f"2d membership_plan == 'free' (got {j.get('membership_plan')})")
                check(j.get("upgrade_required") is True, f"2d upgrade_required == true (got {j.get('upgrade_required')})")
                target = next((x for x in j.get("reservations", []) if x.get("reservation_id") == pro_res_id), None)
                if target:
                    check(target.get("is_locked") is True, f"2d FREE reservation is_locked == true (got {target.get('is_locked')})")
                    un = target.get("user_name") or ""
                    check(re.match(r"^[A-Z]•••$", un) is not None or un == "Cliente",
                          f"2d FREE user_name matches 'X•••' or 'Cliente' (got {un!r})")
                    check(target.get("user_email") == "•••@•••",
                          f"2d FREE user_email == '•••@•••' (got {target.get('user_email')!r})")
                    check(target.get("user_phone") == "+57 ••• •• •••",
                          f"2d FREE user_phone censored (got {target.get('user_phone')!r})")
                    check(target.get("user_whatsapp") == "+57 ••• •• •••",
                          f"2d FREE user_whatsapp censored (got {target.get('user_whatsapp')!r})")
                    # Numeric/data fields not censored
                    check(target.get("date") == tomorrow, f"2d FREE date NOT censored (got {target.get('date')!r})")
                    check(target.get("time") == "20:30", f"2d FREE time NOT censored (got {target.get('time')!r})")
                    check(target.get("party_size") == 2, f"2d FREE party_size NOT censored (got {target.get('party_size')!r})")
                else:
                    check(False, f"2d could not find our reservation in list")

            # ─────────────────────────────────────────────────────────
            # 3f) FREE partner PATCH → 402
            # ─────────────────────────────────────────────────────────
            print("\n[3f] PATCH as FREE partner → 402")
            # Create a fresh reservation against casaboheme (now FREE), so its status will be pending_partner_activation
            user_b, tb = await seed_user(db, "bravo")
            body = {"partner_id": PRO_PARTNER, "type": "table", "date": tomorrow, "time": "21:00",
                    "party_size": 2, "notes": "Para test 3g"}
            r = requests.post(f"{API}/reservations", json=body, headers=bearer(tb), timeout=20)
            free_pending_id = None
            if r.status_code == 200:
                free_pending_id = r.json()["reservation"]["reservation_id"]
                created_reservation_ids.add(free_pending_id)
                check(r.json()["reservation"]["status"] == "pending_partner_activation",
                      f"3f preparation: reservation status pending_partner_activation")

                # Attempt PATCH as FREE casaboheme
                r2 = requests.patch(f"{API}/business/reservations/{free_pending_id}",
                                    json={"action": "confirm", "note": "test"},
                                    headers=bearer(pro_biz_token), timeout=20)
                check(r2.status_code == 402, f"3f PATCH as FREE partner → 402 (got {r2.status_code})")
                if r2.status_code == 402:
                    detail = (r2.json().get("detail") or "")
                    check("PRO" in detail, f"3f 402 detail mentions 'PRO' (got {detail!r})")
            else:
                check(False, f"3f could not create reservation against FREE casaboheme (got {r.status_code})")
        finally:
            # Always restore casaboheme to PRO before continuing
            print("\n[flip back] Restoring casaboheme to PRO")
            await db.partners.update_one({"partner_id": PRO_PARTNER}, {"$set": {"membership_plan": "pro"}})

        # ─────────────────────────────────────────────────────────
        # 3e) PRO casaboheme can confirm the original PRO reservation
        # ─────────────────────────────────────────────────────────
        print("\n[3e] PATCH confirm as PRO casaboheme")
        if pro_res_id:
            r = requests.patch(f"{API}/business/reservations/{pro_res_id}",
                               json={"action": "confirm", "note": "test"},
                               headers=bearer(pro_biz_token), timeout=20)
            check(r.status_code == 200, f"3e PATCH confirm as PRO → 200 (got {r.status_code})")
            if r.status_code == 200:
                check(r.json().get("status") == "confirmed",
                      f"3e status == 'confirmed' (got {r.json().get('status')})")

        # ─────────────────────────────────────────────────────────
        # 3g) State-machine: cannot confirm pending_partner_activation even after PRO restore
        # ─────────────────────────────────────────────────────────
        print("\n[3g] State-machine rejects confirm on pending_partner_activation (even as PRO)")
        if free_pending_id:
            # casaboheme is now PRO again, the reservation is still pending_partner_activation
            r = requests.patch(f"{API}/business/reservations/{free_pending_id}",
                               json={"action": "confirm", "note": "test"},
                               headers=bearer(pro_biz_token), timeout=20)
            check(r.status_code == 400, f"3g PATCH confirm on pending_partner_activation → 400 (got {r.status_code})")
            if r.status_code == 400:
                detail = (r.json().get("detail") or "").lower()
                check("pending_partner_activation" in detail,
                      f"3g detail mentions 'pending_partner_activation' (got {r.json().get('detail')!r})")

    finally:
        # ── CLEANUP ──
        print("\n[cleanup]")
        # 1) Restore casaboheme to whatever it was originally
        target_plan = (original_casa or {}).get("membership_plan") or "pro"
        await db.partners.update_one({"partner_id": PRO_PARTNER}, {"$set": {"membership_plan": target_plan}})
        post = await db.partners.find_one({"partner_id": PRO_PARTNER}, {"_id": 0, "membership_plan": 1})
        check(post and post.get("membership_plan") == "pro",
              f"cleanup: casaboheme.membership_plan restored to 'pro' (got {post.get('membership_plan') if post else None})")

        # 2) Delete reservations + lifecycle notifications we created
        if created_reservation_ids:
            rdel = await db.reservations.delete_many({"reservation_id": {"$in": list(created_reservation_ids)}})
            ndel = await db.notifications.delete_many({"ref.reservation_id": {"$in": list(created_reservation_ids)}})
            print(f"  deleted {rdel.deleted_count} reservations, {ndel.deleted_count} notifications")

        # 3) Delete test users + sessions
        if created_user_ids:
            await db.users.delete_many({"user_id": {"$in": list(created_user_ids)}})
        if created_session_tokens:
            await db.user_sessions.delete_many({"session_token": {"$in": list(created_session_tokens)}})

        # 4) Belt-and-braces: nuke anything left over from this prefix
        await db.users.delete_many({"user_id": {"$regex": f"^user_{TEST_PREFIX}_"}})
        await db.user_sessions.delete_many({"session_token": {"$regex": f"^sess_{TEST_PREFIX}_"}})

        client.close()

    # Summary
    print("\n" + "=" * 60)
    passed = sum(1 for ok, _ in results if ok)
    failed = [m for ok, m in results if not ok]
    print(f"PASSED: {passed}/{len(results)}")
    if failed:
        print("FAILED:")
        for m in failed:
            print(f"  ✗ {m}")
        sys.exit(1)
    else:
        print("ALL ASSERTIONS PASSED")


if __name__ == "__main__":
    asyncio.run(main())
