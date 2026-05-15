"""Phase 3 backend tests — Membership endpoints + In-app Notifications via reservation lifecycle.

Hits the external preview URL (EXPO_PUBLIC_BACKEND_URL) per system rules.

Auth strategy:
  • User auth: insert a `users` row + `user_sessions` row directly via the same
    Mongo URL the backend uses, then send `Authorization: Bearer <token>`.
  • Business auth (casaboheme / Alcaldía): POST /api/business/login.

Cleanup:
  • Delete created reservations + test notifications + test users.
  • Restore casaboheme.membership_tier / membership_paid_until to its pre-test state.
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

TEST_PREFIX = "p3test_"

ALCALDIA_EMAIL = "alcaldia@amocartagena.app"
ALCALDIA_PWD = "AlcaldiaCTG2026!"
PARTNER_EMAIL = "casaboheme@amocartagena.app"
PARTNER_PWD = "amocartagena2026"
PARTNER_PARTNER_ID = "ptr_nc_007"  # Casa Bohème — premium

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


# ────────────────────────────────────────────────────────────────────────────
# Mongo helpers
# ────────────────────────────────────────────────────────────────────────────
async def seed_user(name: str, email_suffix: str) -> tuple[str, str]:
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    user_id = f"user_{TEST_PREFIX}{uuid.uuid4().hex[:10]}"
    token = f"st_{TEST_PREFIX}{uuid.uuid4().hex}"
    await db.users.insert_one({
        "user_id": user_id,
        "email": f"{TEST_PREFIX}{email_suffix}@test.amocartagena.app",
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


async def db_handle():
    return AsyncIOMotorClient(MONGO_URL)[DB_NAME]


async def snapshot_partner_membership(partner_id: str) -> dict:
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    p = await db.partners.find_one(
        {"partner_id": partner_id},
        {"_id": 0, "membership_tier": 1, "membership_status": 1, "membership_paid_until": 1, "tier": 1},
    ) or {}
    c.close()
    return p


async def restore_partner_membership(partner_id: str, snap: dict):
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    update_set: dict = {}
    unset: dict = {}
    for k in ("membership_tier", "membership_status", "membership_paid_until"):
        if k in snap:
            update_set[k] = snap[k]
        else:
            unset[k] = ""
    upd: dict = {}
    if update_set:
        upd["$set"] = update_set
    if unset:
        upd["$unset"] = unset
    if upd:
        await db.partners.update_one({"partner_id": partner_id}, upd)
    c.close()


async def cleanup(user_ids: list[str], reservation_ids: list[str], extra_notif_ids: list[str]):
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    if user_ids:
        await db.users.delete_many({"user_id": {"$in": user_ids}})
        await db.user_sessions.delete_many({"user_id": {"$in": user_ids}})
        await db.notifications.delete_many({"user_id": {"$in": user_ids}})
        # also reservation-derived notifs reference users via partner notif body; safer to delete by ref
        await db.notifications.delete_many({"ref.reservation_id": {"$in": reservation_ids}})
    if reservation_ids:
        await db.reservations.delete_many({"reservation_id": {"$in": reservation_ids}})
    if extra_notif_ids:
        await db.notifications.delete_many({"notification_id": {"$in": extra_notif_ids}})
    c.close()


# ────────────────────────────────────────────────────────────────────────────
# HTTP helpers
# ────────────────────────────────────────────────────────────────────────────
def auth_headers(token: str | None) -> dict:
    return {"Authorization": f"Bearer {token}"} if token else {}


def biz_login(email: str, password: str) -> str:
    r = requests.post(f"{BASE_URL}/business/login", json={"email": email, "password": password}, timeout=20)
    r.raise_for_status()
    return r.json()["token"]


# ────────────────────────────────────────────────────────────────────────────
# Main test
# ────────────────────────────────────────────────────────────────────────────
async def main():
    print(f"\nBASE_URL = {BASE_URL}\n")

    # Snapshot partner state for restore
    snap = await snapshot_partner_membership(PARTNER_PARTNER_ID)
    print(f"Snapshot casaboheme membership: {snap}\n")

    # Tokens
    print("→ Logging in business accounts ...")
    alc_token = biz_login(ALCALDIA_EMAIL, ALCALDIA_PWD)
    cb_token = biz_login(PARTNER_EMAIL, PARTNER_PWD)
    check("alcaldia login token", isinstance(alc_token, str) and alc_token.startswith("biz_"))
    check("casaboheme login token", isinstance(cb_token, str) and cb_token.startswith("biz_"))

    # Seed test user
    user_id, user_token = await seed_user("Alicia Test", "alicia")
    user_ids = [user_id]
    reservation_ids: list[str] = []
    extra_notif_ids: list[str] = []

    try:
        # ════════════════════════════════════════════════════════════
        # 1) MEMBERSHIP ENDPOINTS
        # ════════════════════════════════════════════════════════════
        print("\n──── 1a) GET /api/business/membership ────")

        r = requests.get(f"{BASE_URL}/business/membership", timeout=15)
        check("GET /business/membership 401 no-auth", r.status_code == 401, f"got {r.status_code}")

        r = requests.get(f"{BASE_URL}/business/membership", headers=auth_headers(cb_token), timeout=15)
        check("GET /business/membership 200 casaboheme", r.status_code == 200, f"got {r.status_code} body={r.text[:200]}")
        if r.status_code == 200:
            body = r.json()
            for k in ("partner_id", "membership_tier", "membership_status", "membership_paid_until",
                      "days_left", "monthly_fee_cop", "currency"):
                check(f"membership has key '{k}'", k in body, f"body={body}")
            check("membership_status == 'active'", body.get("membership_status") == "active", f"got {body.get('membership_status')}")
            check("currency == 'COP'", body.get("currency") == "COP")
            tier = body.get("membership_tier")
            fee = body.get("monthly_fee_cop")
            check("monthly_fee_cop is number", isinstance(fee, int), f"got {type(fee)}")
            expected_fee = {"popular": 0, "premium": 150_000, "elite": 500_000}.get(tier, None)
            check(f"monthly_fee_cop matches tier pricing ({tier} → {expected_fee})", fee == expected_fee, f"got {fee}")
            # days_left number or null
            check("days_left is None or number", body.get("days_left") is None or isinstance(body.get("days_left"), int))

        # ────────────────────────────────────────────────────────────
        print("\n──── 1b) PATCH /api/business/admin/partners/{partner_id}/membership ────")
        patch_url = f"{BASE_URL}/business/admin/partners/{PARTNER_PARTNER_ID}/membership"

        r = requests.patch(patch_url, json={"membership_tier": "premium"}, timeout=15)
        check("PATCH membership 401 no-auth", r.status_code == 401, f"got {r.status_code}")

        r = requests.patch(patch_url, json={"membership_tier": "premium"}, headers=auth_headers(cb_token), timeout=15)
        check("PATCH membership 403 with regular partner token", r.status_code == 403, f"got {r.status_code}")

        # Valid PATCH
        r = requests.patch(
            patch_url,
            json={"membership_tier": "premium", "membership_paid_until": "2026-12-31"},
            headers=auth_headers(alc_token), timeout=15,
        )
        check("PATCH membership 200 alcaldia", r.status_code == 200, f"got {r.status_code} body={r.text[:300]}")
        if r.status_code == 200:
            body = r.json()
            partner = body.get("partner") or {}
            check("partner.membership_tier == 'premium'", partner.get("membership_tier") == "premium")
            mp_until = partner.get("membership_paid_until")
            check("partner.membership_paid_until is ISO string", isinstance(mp_until, str) and "2026-12-31" in mp_until,
                  f"got {mp_until}")

        # Verify casaboheme sees premium with proper fee + days_left>0
        r = requests.get(f"{BASE_URL}/business/membership", headers=auth_headers(cb_token), timeout=15)
        check("GET membership reflects premium after PATCH", r.status_code == 200)
        if r.status_code == 200:
            body = r.json()
            check("after PATCH membership_tier == 'premium'", body.get("membership_tier") == "premium",
                  f"got {body.get('membership_tier')}")
            check("after PATCH monthly_fee_cop == 150000", body.get("monthly_fee_cop") == 150_000,
                  f"got {body.get('monthly_fee_cop')}")
            dl = body.get("days_left")
            check("after PATCH days_left is numeric > 0", isinstance(dl, int) and dl > 0, f"got {dl}")

        # Validation: invalid tier
        r = requests.patch(patch_url, json={"membership_tier": "basic"}, headers=auth_headers(alc_token), timeout=15)
        check("PATCH invalid tier 'basic' → 400", r.status_code == 400, f"got {r.status_code}")

        # Validation: invalid status
        r = requests.patch(patch_url, json={"membership_status": "pro"}, headers=auth_headers(alc_token), timeout=15)
        check("PATCH invalid status 'pro' → 400", r.status_code == 400, f"got {r.status_code}")

        # Validation: invalid paid_until
        r = requests.patch(patch_url, json={"membership_paid_until": "not-a-date"}, headers=auth_headers(alc_token), timeout=15)
        check("PATCH invalid paid_until 'not-a-date' → 400", r.status_code == 400, f"got {r.status_code}")

        # Validation: all fields missing
        r = requests.patch(patch_url, json={}, headers=auth_headers(alc_token), timeout=15)
        check("PATCH empty body → 400", r.status_code == 400, f"got {r.status_code}")

        # ────────────────────────────────────────────────────────────
        print("\n──── 1c) GET /api/business/admin/memberships ────")
        list_url = f"{BASE_URL}/business/admin/memberships"

        r = requests.get(list_url, timeout=15)
        check("GET admin/memberships 401 no-auth", r.status_code == 401, f"got {r.status_code}")

        r = requests.get(list_url, headers=auth_headers(cb_token), timeout=15)
        check("GET admin/memberships 403 partner", r.status_code == 403, f"got {r.status_code}")

        r = requests.get(list_url, headers=auth_headers(alc_token), timeout=15)
        check("GET admin/memberships 200 alcaldia", r.status_code == 200, f"got {r.status_code}")
        if r.status_code == 200:
            body = r.json()
            for k in ("partners", "count", "by_status", "by_tier"):
                check(f"admin/memberships has key '{k}'", k in body)
            check("count == len(partners)", body.get("count") == len(body.get("partners", [])))
            sum_status = sum(body.get("by_status", {}).values())
            sum_tier = sum(body.get("by_tier", {}).values())
            check("sum(by_status) == count", sum_status == body.get("count"), f"{sum_status} vs {body.get('count')}")
            check("sum(by_tier) == count", sum_tier == body.get("count"), f"{sum_tier} vs {body.get('count')}")
            partners = body.get("partners") or []
            check("each partner has membership_tier", all("membership_tier" in p for p in partners))
            check("each partner has membership_status", all("membership_status" in p for p in partners))

        # filter ?status=active
        r = requests.get(f"{list_url}?status=active", headers=auth_headers(alc_token), timeout=15)
        check("GET admin/memberships?status=active 200", r.status_code == 200)
        if r.status_code == 200:
            body = r.json()
            partners = body.get("partners") or []
            check("filter status=active returns subset (all active)",
                  all(p.get("membership_status") == "active" for p in partners),
                  f"non-active rows found: {[p['membership_status'] for p in partners if p.get('membership_status') != 'active']}")

        # filter ?tier=premium
        r = requests.get(f"{list_url}?tier=premium", headers=auth_headers(alc_token), timeout=15)
        check("GET admin/memberships?tier=premium 200", r.status_code == 200)
        if r.status_code == 200:
            body = r.json()
            partners = body.get("partners") or []
            check("filter tier=premium returns subset (all premium)",
                  all(p.get("membership_tier") == "premium" for p in partners),
                  f"non-premium rows found")

        # ════════════════════════════════════════════════════════════
        # 2) NOTIFICATIONS via reservation lifecycle
        # ════════════════════════════════════════════════════════════
        print("\n──── 2d) Reservation creation → partner notification ────")
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
        r = requests.post(
            f"{BASE_URL}/reservations",
            json={"partner_id": PARTNER_PARTNER_ID, "type": "table", "date": tomorrow,
                  "time": "20:30", "party_size": 2, "notes": "Cumpleaños"},
            headers=auth_headers(user_token), timeout=15,
        )
        check("POST /reservations 200", r.status_code == 200, f"got {r.status_code} body={r.text[:300]}")
        res1_id = None
        if r.status_code == 200:
            body = r.json()
            res1 = body.get("reservation") or {}
            res1_id = res1.get("reservation_id")
            check("reservation_id returned", isinstance(res1_id, str) and res1_id.startswith("res_"),
                  f"got {res1_id}")
            if res1_id:
                reservation_ids.append(res1_id)

        # Partner sees the fresh notification
        r = requests.get(f"{BASE_URL}/business/notifications?unread_only=true",
                         headers=auth_headers(cb_token), timeout=15)
        check("GET /business/notifications 200", r.status_code == 200, f"got {r.status_code}")
        if r.status_code == 200:
            body = r.json()
            notifs = body.get("notifications") or []
            unread_count = body.get("unread_count")
            check("unread_count >= 1", isinstance(unread_count, int) and unread_count >= 1,
                  f"got {unread_count}")
            match = [n for n in notifs if n.get("kind") == "reservation_request"
                     and (n.get("ref") or {}).get("reservation_id") == res1_id]
            check("fresh notification with kind='reservation_request' present", len(match) >= 1,
                  f"notifs={[(n.get('kind'), n.get('ref')) for n in notifs[:5]]}")
            if match:
                n0 = match[0]
                check("notif is_read==False", n0.get("is_read") is False)
                # Verify audience in DB (response may not include private field)
                db = await db_handle()
                doc = await db.notifications.find_one({"notification_id": n0.get("notification_id")}, {"_id": 0})
                check("DB notif audience=='partner'", (doc or {}).get("audience") == "partner",
                      f"got {(doc or {}).get('audience')}")

        # ────────────────────────────────────────────────────────────
        print("\n──── 2e) Confirm → user notification ────")
        if res1_id:
            r = requests.patch(
                f"{BASE_URL}/business/reservations/{res1_id}",
                json={"action": "confirm", "note": "Te esperamos"},
                headers=auth_headers(cb_token), timeout=15,
            )
            check("PATCH confirm 200", r.status_code == 200, f"got {r.status_code} body={r.text[:300]}")

            r = requests.get(f"{BASE_URL}/notifications", headers=auth_headers(user_token), timeout=15)
            check("GET /notifications (user) 200", r.status_code == 200, f"got {r.status_code}")
            if r.status_code == 200:
                notifs = r.json()
                match = [n for n in notifs if n.get("kind") == "reservation_confirmed"
                         and (n.get("ref") or {}).get("reservation_id") == res1_id]
                check("user notif kind='reservation_confirmed' for res1", len(match) >= 1,
                      f"got kinds={[n.get('kind') for n in notifs[:10]]}")

        # ────────────────────────────────────────────────────────────
        print("\n──── 2f) Reject → user notification ────")
        r = requests.post(
            f"{BASE_URL}/reservations",
            json={"partner_id": PARTNER_PARTNER_ID, "type": "table", "date": tomorrow,
                  "time": "21:00", "party_size": 4, "notes": "Reject me"},
            headers=auth_headers(user_token), timeout=15,
        )
        check("POST /reservations #2 200", r.status_code == 200, f"got {r.status_code}")
        res2_id = None
        if r.status_code == 200:
            res2_id = (r.json().get("reservation") or {}).get("reservation_id")
            if res2_id:
                reservation_ids.append(res2_id)

        rejection_note = "Lleno completo, intenta mañana"
        if res2_id:
            r = requests.patch(
                f"{BASE_URL}/business/reservations/{res2_id}",
                json={"action": "reject", "note": rejection_note},
                headers=auth_headers(cb_token), timeout=15,
            )
            check("PATCH reject 200", r.status_code == 200, f"got {r.status_code}")
            r = requests.get(f"{BASE_URL}/notifications", headers=auth_headers(user_token), timeout=15)
            if r.status_code == 200:
                notifs = r.json()
                match = [n for n in notifs if n.get("kind") == "reservation_rejected"
                         and (n.get("ref") or {}).get("reservation_id") == res2_id]
                check("user notif kind='reservation_rejected' for res2", len(match) >= 1,
                      f"got kinds={[n.get('kind') for n in notifs[:10]]}")
                if match:
                    check("rejection note in body", rejection_note in (match[0].get("body") or ""),
                          f"body={match[0].get('body')}")

        # ════════════════════════════════════════════════════════════
        # 3) MARK-READ
        # ════════════════════════════════════════════════════════════
        print("\n──── 3g) PUT mark single notif read ────")
        # Grab a fresh unread one for partner
        r = requests.get(f"{BASE_URL}/business/notifications?unread_only=true",
                         headers=auth_headers(cb_token), timeout=15)
        notifs_before = r.json().get("notifications") if r.status_code == 200 else []
        unread_before = r.json().get("unread_count") if r.status_code == 200 else None
        check("partner has at least 1 unread before mark-read", len(notifs_before) >= 1)
        if notifs_before:
            nid = notifs_before[0].get("notification_id")
            r = requests.put(f"{BASE_URL}/business/notifications/{nid}/read",
                             headers=auth_headers(cb_token), timeout=15)
            check("PUT /business/notifications/{id}/read 200", r.status_code == 200, f"got {r.status_code}")
            if r.status_code == 200:
                check("ok == True", r.json().get("ok") is True)
            # Verify gone from unread list
            r = requests.get(f"{BASE_URL}/business/notifications?unread_only=true",
                             headers=auth_headers(cb_token), timeout=15)
            if r.status_code == 200:
                body = r.json()
                ids_after = [n.get("notification_id") for n in (body.get("notifications") or [])]
                check("marked notif no longer in unread_only", nid not in ids_after)
                if isinstance(unread_before, int):
                    check("unread_count decremented", body.get("unread_count") == unread_before - 1,
                          f"{body.get('unread_count')} vs {unread_before - 1}")

        # ────────────────────────────────────────────────────────────
        print("\n──── 3h) PUT mark-all read ────")
        r = requests.put(f"{BASE_URL}/business/notifications/read-all",
                         headers=auth_headers(cb_token), timeout=15)
        check("PUT read-all 200", r.status_code == 200, f"got {r.status_code}")
        if r.status_code == 200:
            body = r.json()
            check("read-all ok==True", body.get("ok") is True)
            check("read-all marked >= 0", isinstance(body.get("marked"), int) and body.get("marked") >= 0,
                  f"got {body.get('marked')}")
        r = requests.get(f"{BASE_URL}/business/notifications?unread_only=true",
                         headers=auth_headers(cb_token), timeout=15)
        if r.status_code == 200:
            body = r.json()
            check("after read-all unread list empty", len(body.get("notifications") or []) == 0,
                  f"got {len(body.get('notifications') or [])}")
            check("after read-all unread_count == 0", body.get("unread_count") == 0,
                  f"got {body.get('unread_count')}")

        # ════════════════════════════════════════════════════════════
        # 4) AUDIENCE ISOLATION
        # ════════════════════════════════════════════════════════════
        print("\n──── 4i) Partner-only notif must NOT appear for the user ────")
        db = await db_handle()
        partner_only_id = f"notif_{TEST_PREFIX}{uuid.uuid4().hex[:8]}"
        await db.notifications.insert_one({
            "notification_id": partner_only_id,
            "partner_id": PARTNER_PARTNER_ID,
            "audience": "partner",
            "kind": "test_partner_only",
            "title": "Should not reach user",
            "body": "test",
            "ref": {},
            "is_read": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        extra_notif_ids.append(partner_only_id)

        r = requests.get(f"{BASE_URL}/notifications", headers=auth_headers(user_token), timeout=15)
        check("GET /notifications (user) 200", r.status_code == 200)
        if r.status_code == 200:
            notifs = r.json()
            ids = [n.get("notification_id") for n in notifs]
            check("user does NOT see audience='partner' notif", partner_only_id not in ids,
                  f"ids={ids[:10]}")

        # ────────────────────────────────────────────────────────────
        print("\n──── 4j) User-only / no-audience notif must NOT appear for partner ────")
        user_only_id = f"notif_{TEST_PREFIX}{uuid.uuid4().hex[:8]}"
        await db.notifications.insert_one({
            "notification_id": user_only_id,
            "user_id": user_id,
            "audience": "user",
            "kind": "test_user_only",
            "title": "Should not reach partner",
            "body": "test",
            "ref": {},
            "is_read": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        extra_notif_ids.append(user_only_id)

        # Also one with no audience field (legacy notif)
        legacy_user_id = f"notif_{TEST_PREFIX}{uuid.uuid4().hex[:8]}"
        await db.notifications.insert_one({
            "notification_id": legacy_user_id,
            "user_id": user_id,
            "kind": "test_legacy",
            "title": "Legacy notif (no audience field)",
            "body": "test",
            "ref": {},
            "is_read": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        extra_notif_ids.append(legacy_user_id)

        r = requests.get(f"{BASE_URL}/business/notifications", headers=auth_headers(cb_token), timeout=15)
        check("GET /business/notifications 200", r.status_code == 200)
        if r.status_code == 200:
            ids = [n.get("notification_id") for n in (r.json().get("notifications") or [])]
            check("partner does NOT see audience='user' notif", user_only_id not in ids)
            check("partner does NOT see legacy (no audience) notif", legacy_user_id not in ids)

        # Also verify the user CAN see their own user-audience notifs
        r = requests.get(f"{BASE_URL}/notifications", headers=auth_headers(user_token), timeout=15)
        if r.status_code == 200:
            ids = [n.get("notification_id") for n in r.json()]
            check("user CAN see their audience='user' test notif", user_only_id in ids)
            check("user CAN see legacy (no audience) notif", legacy_user_id in ids)

        # ════════════════════════════════════════════════════════════
        # Final PATCH cleanup — restore casaboheme to its pre-test state
        # ════════════════════════════════════════════════════════════
        print("\n──── Cleanup: PATCH casaboheme back to pre-test snapshot ────")
        original_tier = snap.get("membership_tier") or "premium"
        r = requests.patch(
            patch_url,
            json={"membership_tier": original_tier, "membership_paid_until": None},
            headers=auth_headers(alc_token), timeout=15,
        )
        check(f"PATCH back to {original_tier} / paid_until=None 200",
              r.status_code == 200, f"got {r.status_code}")

    finally:
        await cleanup(user_ids, reservation_ids, extra_notif_ids)
        # Final safety: ensure partner snapshot is restored even if PATCH cleanup failed
        await restore_partner_membership(PARTNER_PARTNER_ID, snap)
        after = await snapshot_partner_membership(PARTNER_PARTNER_ID)
        print(f"\nFinal casaboheme membership state: {after}")

    # ────────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")
    print("=" * 60)
    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(f"  • {f}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
