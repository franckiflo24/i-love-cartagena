"""Focused tests for the REWRITTEN reservations module (lead-only / no Wompi).

Covers:
  1) Legacy 'prepaid' rejection
  2) Basic table reservation creation
  3) Partner profile update with new fields
  4) Confirm → payment_info surfaces
  5) Unified cancellation window (2h for ALL types)
  6) Idempotent cancel
  7) Stats endpoint new schema (no more prepaid revenue keys)
  8) Partner rejection with note
  9) Role gating still works (regular partner 403, alcaldia 200)

Cleanup: deletes test reservations, restores casaboheme's original payment fields.
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
TEST_PREFIX = "resv2_"

CASABOHEME_EMAIL = "casaboheme@amocartagena.app"
CASABOHEME_PASSWORD = "amocartagena2026"
ALCALDIA_EMAIL = "alcaldia@amocartagena.app"
ALCALDIA_PASSWORD = "AlcaldiaCTG2026!"

passed = 0
failed = 0
failures: list[str] = []
created_reservation_ids: list[str] = []


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
    """Seed a regular user directly in mongo (app uses Google OAuth only).
    Returns (user_id, token, email)."""
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    user_id = f"user_{TEST_PREFIX}{uuid.uuid4().hex[:10]}"
    token = f"st_{TEST_PREFIX}{uuid.uuid4().hex}"
    email = f"sofia.{TEST_PREFIX}{uuid.uuid4().hex[:6]}@example.com"
    await db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": "Sofía Castro",
        "picture": "",
        "phone": "+573009998877",
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


async def snapshot_partner_fields(partner_id: str) -> dict:
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    p = await db.partners.find_one(
        {"partner_id": partner_id},
        {"_id": 0, "default_payment_link": 1, "phone": 1, "whatsapp": 1, "email": 1},
    )
    c.close()
    return p or {}


async def restore_partner_fields(partner_id: str, snapshot: dict):
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    # Build a $set/$unset that returns the partner to its pre-test state.
    set_ops = {}
    unset_ops = {}
    for k in ("default_payment_link", "phone", "whatsapp", "email"):
        if k in snapshot:
            set_ops[k] = snapshot[k]
        else:
            unset_ops[k] = ""
    update = {}
    if set_ops:
        update["$set"] = set_ops
    if unset_ops:
        update["$unset"] = unset_ops
    if update:
        await db.partners.update_one({"partner_id": partner_id}, update)
    c.close()


async def cleanup(user_id: str, partner_id: str, partner_snapshot: dict):
    print("\n=== Cleanup ===")
    c = AsyncIOMotorClient(MONGO_URL)
    db = c[DB_NAME]
    # Delete test user + sessions
    await db.users.delete_many({"user_id": {"$regex": f"^user_{TEST_PREFIX}"}})
    await db.user_sessions.delete_many({"session_token": {"$regex": f"^st_{TEST_PREFIX}"}})
    # Delete any reservation made by the test user
    res_del = await db.reservations.delete_many({"user_id": {"$regex": f"^user_{TEST_PREFIX}"}})
    print(f"  Deleted {res_del.deleted_count} test reservations")
    c.close()
    # Restore casaboheme partner fields
    await restore_partner_fields(partner_id, partner_snapshot)
    print(f"  Restored partner {partner_id} fields to snapshot: {partner_snapshot}")


def business_login(email: str, password: str) -> str:
    r = requests.post(f"{BASE_URL}/business/login",
                      json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"business_login failed for {email}: {r.status_code} {r.text}")
    return r.json()["token"]


async def main():
    print("\n=== Setup ===")
    user_id, user_token, user_email = await seed_user()
    UH = {"Authorization": f"Bearer {user_token}", "Content-Type": "application/json"}

    partner_id = await get_casaboheme_partner_id()
    if not partner_id:
        print("FATAL: casaboheme partner not found in DB")
        return 1
    print(f"  user_id = {user_id}")
    print(f"  casaboheme partner_id = {partner_id}")

    casa_snapshot = await snapshot_partner_fields(partner_id)
    print(f"  partner snapshot = {casa_snapshot}")

    partner_token = business_login(CASABOHEME_EMAIL, CASABOHEME_PASSWORD)
    PH = {"Authorization": f"Bearer {partner_token}", "Content-Type": "application/json"}
    alcaldia_token = business_login(ALCALDIA_EMAIL, ALCALDIA_PASSWORD)
    AH = {"Authorization": f"Bearer {alcaldia_token}", "Content-Type": "application/json"}

    tomorrow = (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%d")
    today = datetime.now(timezone(timedelta(hours=-5))).strftime("%Y-%m-%d")
    in_1h_local = (datetime.now(timezone(timedelta(hours=-5))) + timedelta(hours=1)).strftime("%H:%M")
    print(f"  tomorrow = {tomorrow}   today = {today}   time-in-1h(local) = {in_1h_local}")

    # ─────────────────────────────────────────────────────────────
    # 1) Legacy 'prepaid' rejection
    # ─────────────────────────────────────────────────────────────
    print("\n=== 1) Legacy 'prepaid' rejection ===")
    r = requests.post(f"{BASE_URL}/reservations", headers=UH, json={
        "partner_id": partner_id,
        "type": "prepaid",
        "date": tomorrow,
        "time": "20:00",
        "party_size": 2,
        "amount_cop": 50000,
    }, timeout=30)
    check("1) POST type=prepaid → 400", r.status_code == 400,
          f"got {r.status_code}: {r.text[:300]}")
    if r.status_code == 400:
        detail = (r.json().get("detail") or "").lower()
        check("1) detail mentions payment no longer processed",
              ("pago" in detail) and ("app" in detail or "partner" in detail or "link" in detail),
              f"detail={detail!r}")

    # ─────────────────────────────────────────────────────────────
    # 2) Basic table reservation creation
    # ─────────────────────────────────────────────────────────────
    print("\n=== 2) Basic table reservation creation ===")
    r = requests.post(f"{BASE_URL}/reservations", headers=UH, json={
        "partner_id": partner_id,
        "type": "table",
        "date": tomorrow,
        "time": "20:00",
        "party_size": 2,
        "notes": "Aniversario",
    }, timeout=30)
    check("2) create table reservation → 200", r.status_code == 200,
          f"got {r.status_code}: {r.text[:300]}")
    main_reservation_id = None
    if r.status_code == 200:
        body = r.json()
        res = body.get("reservation") or {}
        main_reservation_id = res.get("reservation_id")
        if main_reservation_id:
            created_reservation_ids.append(main_reservation_id)
        check("2) status == pending_confirmation",
              res.get("status") == "pending_confirmation",
              f"got status={res.get('status')}")
        check("2) user_id populated", res.get("user_id") == user_id,
              f"got {res.get('user_id')}")
        check("2) user_email populated", res.get("user_email") == user_email,
              f"got {res.get('user_email')}")
        check("2) partner hydrated (partner.name present)",
              isinstance(res.get("partner"), dict) and bool(res["partner"].get("name")),
              f"got partner={res.get('partner')}")
        check("2) payment_info ABSENT (not yet confirmed)",
              "payment_info" not in res,
              f"got payment_info={res.get('payment_info')!r}")
        check("2) notes preserved",
              res.get("notes") == "Aniversario",
              f"got notes={res.get('notes')!r}")
        check("2) reservation_id starts with res_",
              isinstance(main_reservation_id, str) and main_reservation_id.startswith("res_"),
              f"got {main_reservation_id!r}")

    # ─────────────────────────────────────────────────────────────
    # 3) Partner profile update with new fields
    # ─────────────────────────────────────────────────────────────
    print("\n=== 3) PUT /business/profile with new payment/contact fields ===")
    new_fields = {
        "default_payment_link": "https://checkout.wompi.co/l/TEST123",
        "whatsapp": "+573001234567",
        "phone": "+5756601234",
        "email": "reservas@casaboheme.co",
    }
    r = requests.put(f"{BASE_URL}/business/profile", headers=PH, json=new_fields, timeout=30)
    check("3) PUT /business/profile → 200", r.status_code == 200,
          f"got {r.status_code}: {r.text[:300]}")
    if r.status_code == 200:
        rj = r.json()
        check("3) updated=true", rj.get("updated") is True, f"got {rj.get('updated')}")
        part = rj.get("partner") or {}
        for k, v in new_fields.items():
            check(f"3) returned partner.{k} == {v!r}",
                  part.get(k) == v,
                  f"got {part.get(k)!r}")

    # Verify persistence via GET /business/me
    r = requests.get(f"{BASE_URL}/business/me", headers=PH, timeout=30)
    check("3b) GET /business/me → 200", r.status_code == 200,
          f"got {r.status_code}")
    if r.status_code == 200:
        partner = (r.json() or {}).get("partner") or {}
        for k, v in new_fields.items():
            check(f"3b) /business/me partner.{k} persisted",
                  partner.get(k) == v,
                  f"got {partner.get(k)!r}")

    # Also via public GET /partners/{partner_id}
    r = requests.get(f"{BASE_URL}/partners/{partner_id}", timeout=30)
    check("3c) GET /partners/<id> → 200", r.status_code == 200,
          f"got {r.status_code}")
    if r.status_code == 200:
        public_partner = r.json() or {}
        for k, v in new_fields.items():
            check(f"3c) public /partners/<id> exposes {k}",
                  public_partner.get(k) == v,
                  f"got {public_partner.get(k)!r}")

    # ─────────────────────────────────────────────────────────────
    # 4) Confirm → payment_info surfaces
    # ─────────────────────────────────────────────────────────────
    print("\n=== 4) Partner confirms → user sees payment_info ===")
    if main_reservation_id:
        r = requests.patch(f"{BASE_URL}/business/reservations/{main_reservation_id}",
                           headers=PH, json={
                               "action": "confirm",
                               "note": "Te esperamos en la barra",
                           }, timeout=30)
        check("4) PATCH confirm → 200", r.status_code == 200,
              f"got {r.status_code}: {r.text[:300]}")
        if r.status_code == 200:
            updated = r.json()
            check("4) status == confirmed",
                  updated.get("status") == "confirmed",
                  f"got {updated.get('status')}")
            check("4) partner_note == 'Te esperamos en la barra'",
                  updated.get("partner_note") == "Te esperamos en la barra",
                  f"got {updated.get('partner_note')!r}")

        # GET as the original user
        r = requests.get(f"{BASE_URL}/reservations/{main_reservation_id}",
                         headers=UH, timeout=30)
        check("4) GET as user → 200", r.status_code == 200,
              f"got {r.status_code}: {r.text[:300]}")
        if r.status_code == 200:
            res = r.json()
            pinfo = res.get("payment_info")
            check("4) payment_info object present", isinstance(pinfo, dict),
                  f"got payment_info={pinfo!r}")
            if isinstance(pinfo, dict):
                check("4) payment_info.payment_link",
                      pinfo.get("payment_link") == "https://checkout.wompi.co/l/TEST123",
                      f"got {pinfo.get('payment_link')!r}")
                check("4) payment_info.whatsapp",
                      pinfo.get("whatsapp") == "+573001234567",
                      f"got {pinfo.get('whatsapp')!r}")
                check("4) payment_info.phone",
                      pinfo.get("phone") == "+5756601234",
                      f"got {pinfo.get('phone')!r}")
                check("4) payment_info.email",
                      pinfo.get("email") == "reservas@casaboheme.co",
                      f"got {pinfo.get('email')!r}")
                check("4) payment_info.note",
                      pinfo.get("note") == "Te esperamos en la barra",
                      f"got {pinfo.get('note')!r}")

    # ─────────────────────────────────────────────────────────────
    # 5) Unified cancellation window (2h for ALL types)
    # ─────────────────────────────────────────────────────────────
    print("\n=== 5) Unified cancellation window (2h for ALL types) ===")

    # 5a) Far-future reservation → free cancellation
    r = requests.post(f"{BASE_URL}/reservations", headers=UH, json={
        "partner_id": partner_id,
        "type": "table",
        "date": tomorrow,
        "time": "20:00",
        "party_size": 2,
        "notes": "Free cancel test",
    }, timeout=30)
    res_id_free = None
    check("5a) create far-future reservation → 200", r.status_code == 200,
          f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 200:
        res_id_free = r.json()["reservation"]["reservation_id"]
        created_reservation_ids.append(res_id_free)

    if res_id_free:
        r = requests.post(f"{BASE_URL}/reservations/{res_id_free}/cancel",
                          headers=UH, timeout=30)
        check("5a) cancel far-future → 200", r.status_code == 200,
              f"got {r.status_code}: {r.text[:300]}")
        if r.status_code == 200:
            d = r.json()
            check("5a) free_cancellation == True",
                  d.get("free_cancellation") is True,
                  f"got {d.get('free_cancellation')}")
            check("5a) status == cancelled_by_user",
                  d["reservation"].get("status") == "cancelled_by_user",
                  f"got {d['reservation'].get('status')}")

    # 5b) ~1h-away reservation → late cancellation
    r = requests.post(f"{BASE_URL}/reservations", headers=UH, json={
        "partner_id": partner_id,
        "type": "table",
        "date": today,
        "time": in_1h_local,
        "party_size": 2,
        "notes": "Late cancel test",
    }, timeout=30)
    res_id_late = None
    check("5b) create ~1h reservation → 200", r.status_code == 200,
          f"got {r.status_code}: {r.text[:300]}")
    if r.status_code == 200:
        res_id_late = r.json()["reservation"]["reservation_id"]
        created_reservation_ids.append(res_id_late)

    if res_id_late:
        r = requests.post(f"{BASE_URL}/reservations/{res_id_late}/cancel",
                          headers=UH, timeout=30)
        check("5b) cancel ~1h reservation → 200", r.status_code == 200,
              f"got {r.status_code}: {r.text[:300]}")
        if r.status_code == 200:
            d = r.json()
            check("5b) free_cancellation == False",
                  d.get("free_cancellation") is False,
                  f"got {d.get('free_cancellation')}")
            check("5b) status == cancelled_late",
                  d["reservation"].get("status") == "cancelled_late",
                  f"got {d['reservation'].get('status')}")

    # ─────────────────────────────────────────────────────────────
    # 6) Idempotent cancel — second cancel must return 400
    # ─────────────────────────────────────────────────────────────
    print("\n=== 6) Idempotent cancel — second cancel → 400 ===")
    if res_id_free:
        r2 = requests.post(f"{BASE_URL}/reservations/{res_id_free}/cancel",
                           headers=UH, timeout=30)
        check("6) second cancel → 400", r2.status_code == 400,
              f"got {r2.status_code}: {r2.text[:300]}")
        if r2.status_code == 400:
            detail = (r2.json().get("detail") or "")
            check("6) detail mentions current terminal status",
                  "cancelled_by_user" in detail,
                  f"detail={detail!r}")

    # ─────────────────────────────────────────────────────────────
    # 7) Stats endpoint new schema
    # ─────────────────────────────────────────────────────────────
    print("\n=== 7) Stats endpoint new schema (Alcaldía) ===")
    r = requests.get(f"{BASE_URL}/business/admin/reservations/stats?days=30",
                     headers=AH, timeout=30)
    check("7) GET stats → 200", r.status_code == 200,
          f"got {r.status_code}: {r.text[:300]}")
    if r.status_code == 200:
        stats = r.json()
        required_keys = {"period_days", "total", "by_status", "active_partners", "acceptance_rate_pct"}
        missing = required_keys - set(stats.keys())
        check("7) all required keys present", not missing,
              f"missing={missing} got={list(stats.keys())}")
        check("7) period_days == 30",
              stats.get("period_days") == 30,
              f"got {stats.get('period_days')}")
        check("7) by_status is dict",
              isinstance(stats.get("by_status"), dict),
              f"got {type(stats.get('by_status'))}")
        check("7) acceptance_rate_pct is number",
              isinstance(stats.get("acceptance_rate_pct"), (int, float)),
              f"got {type(stats.get('acceptance_rate_pct'))}")
        check("7) NO prepaid_revenue_cop key",
              "prepaid_revenue_cop" not in stats,
              f"unexpected key present: stats={stats}")
        check("7) NO prepaid_app_commission_cop key",
              "prepaid_app_commission_cop" not in stats,
              f"unexpected key present: stats={stats}")
        check("7) NO by_type key (old schema)",
              "by_type" not in stats,
              f"unexpected key present: stats={stats}")

    # ─────────────────────────────────────────────────────────────
    # 8) Partner rejection with note
    # ─────────────────────────────────────────────────────────────
    print("\n=== 8) Partner rejection with note ===")
    r = requests.post(f"{BASE_URL}/reservations", headers=UH, json={
        "partner_id": partner_id,
        "type": "table",
        "date": tomorrow,
        "time": "21:00",
        "party_size": 4,
        "notes": "Cumpleaños",
    }, timeout=30)
    res_id_reject = None
    check("8) create rejection-target reservation → 200", r.status_code == 200,
          f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 200:
        res_id_reject = r.json()["reservation"]["reservation_id"]
        created_reservation_ids.append(res_id_reject)

    if res_id_reject:
        r = requests.patch(f"{BASE_URL}/business/reservations/{res_id_reject}",
                           headers=PH, json={
                               "action": "reject",
                               "note": "Lleno completo ese día",
                           }, timeout=30)
        check("8) PATCH reject → 200", r.status_code == 200,
              f"got {r.status_code}: {r.text[:300]}")

        r = requests.get(f"{BASE_URL}/reservations/{res_id_reject}",
                         headers=UH, timeout=30)
        check("8) GET as user → 200", r.status_code == 200,
              f"got {r.status_code}")
        if r.status_code == 200:
            res = r.json()
            check("8) status == rejected_by_partner",
                  res.get("status") == "rejected_by_partner",
                  f"got {res.get('status')}")
            check("8) partner_rejection_reason == 'Lleno completo ese día'",
                  res.get("partner_rejection_reason") == "Lleno completo ese día",
                  f"got {res.get('partner_rejection_reason')!r}")

    # ─────────────────────────────────────────────────────────────
    # 9) Role gating still works
    # ─────────────────────────────────────────────────────────────
    print("\n=== 9) Role gating ===")
    r = requests.get(f"{BASE_URL}/business/admin/reservations",
                     headers=PH, timeout=30)
    check("9) /admin/reservations as regular partner → 403",
          r.status_code == 403,
          f"got {r.status_code}: {r.text[:200]}")
    r = requests.get(f"{BASE_URL}/business/admin/reservations",
                     headers=AH, timeout=30)
    check("9) /admin/reservations as alcaldia → 200",
          r.status_code == 200,
          f"got {r.status_code}: {r.text[:200]}")

    # ── Cleanup ──
    await cleanup(user_id, partner_id, casa_snapshot)

    print(f"\n=== SUMMARY: {passed} passed / {failed} failed ===")
    if failures:
        print("\nFailures:")
        for f in failures:
            print(f"  - {f}")
    return failed


if __name__ == "__main__":
    rc = asyncio.run(main())
    sys.exit(0 if rc == 0 else 1)
