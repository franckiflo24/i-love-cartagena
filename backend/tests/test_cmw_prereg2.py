"""CMW-2 growth layer: required Instagram, apellido/género, personal referral codes,
funnel events (client whitelist + server-stamped conversions), CSV export + download log.

Pure: StubDB in-memory Mongo (unique indexes raise DuplicateKeyError — the referral
mint retry is exercised for real), ratelimit.check monkeypatched to record keys.
cmw_prereg is imported directly (it is its own module; server.py is never imported).

Run: cd backend && python -m pytest -q tests/test_cmw_prereg2.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from typing import Any, Dict, List, Optional

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS = os.path.dirname(os.path.abspath(__file__))
for p in (BACKEND, TESTS):
    if p not in sys.path:
        sys.path.insert(0, p)

import cmw_prereg  # noqa: E402
import ratelimit  # noqa: E402
from events_service_stubs import StubDB  # noqa: E402

IP = "203.0.113.77"


def _body(**over: Any) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "full_name": "Ana María",
        "last_name": "Pérez",
        "email": "ana.cmw2@example.com",
        "whatsapp": "+57 300 123 4567",
        "instagram": "@ana.perez",
        "gender": "femenino",
        "city": "Medellín",
        "country": "Colombia",
        "dob": "1996-05-10",
        "lang": "es",
        "consent": {"accepted": True, "version": cmw_prereg.CONSENT_VERSION},
        "marketing_opt_in": True,
        "source": {"utm_source": "ig", "ref": None, "landing": "web"},
    }
    body.update(over)
    return body


@pytest.fixture()
def env(monkeypatch: pytest.MonkeyPatch):
    cmw_prereg._indexes_done = False
    db = StubDB()
    rl_keys: List[str] = []

    async def fake_check(key: str, max_calls: int, window_sec: int) -> None:
        rl_keys.append(key)

    monkeypatch.setattr(ratelimit, "check", fake_check)
    return db, rl_keys


def _create(db: StubDB, body: Dict[str, Any], *, ip: str = IP,
            user_id: Optional[str] = None):
    return asyncio.run(cmw_prereg.create_prereg(db, body, ip=ip, user_id=user_id, client="test"))


# ── field rules ────────────────────────────────────────────────────────────────

def test_instagram_is_required_and_nothing_is_stored(env) -> None:
    db, _ = env
    status, payload = _create(db, _body(instagram=""))
    assert (status, payload["error"]) == (422, "invalid_instagram")
    status, payload = _create(db, _body(instagram=None))
    assert (status, payload["error"]) == (422, "invalid_instagram")
    assert asyncio.run(db.cmw_preregistrations.count_documents({})) == 0
    assert asyncio.run(db.cmw_funnel_events.count_documents({})) == 0


def test_last_name_and_gender_stored_and_optional(env) -> None:
    db, _ = env
    status, payload = _create(db, _body())
    assert status == 200
    row = asyncio.run(db.cmw_preregistrations.find_one({"email": "ana.cmw2@example.com"}))
    assert row["last_name"] == "Pérez"
    assert row["gender"] == "femenino"
    # omitted on a re-submit → kept, never erased
    status, _ = _create(db, _body(last_name=None, gender=None, city=None))
    assert status == 200
    row = asyncio.run(db.cmw_preregistrations.find_one({"email": "ana.cmw2@example.com"}))
    assert row["last_name"] == "Pérez" and row["gender"] == "femenino" and row["city"] == "Medellín"


def test_invalid_gender_rejected(env) -> None:
    db, _ = env
    status, payload = _create(db, _body(gender="attack-helicopter"))
    assert (status, payload["error"]) == (422, "invalid_gender")
    assert asyncio.run(db.cmw_preregistrations.count_documents({})) == 0


def test_under_18_still_zero_storage(env) -> None:
    db, _ = env
    status, payload = _create(db, _body(dob="2012-01-01"))
    assert (status, payload["error"]) == (422, "under_18")
    assert asyncio.run(db.cmw_preregistrations.count_documents({})) == 0
    assert asyncio.run(db.cmw_funnel_events.count_documents({})) == 0


# ── referral codes ────────────────────────────────────────────────────────────

def test_referral_code_minted_and_shaped(env) -> None:
    db, _ = env
    status, payload = _create(db, _body())
    assert status == 200
    code = payload["data"]["referral_code"]
    assert cmw_prereg.REFERRAL_RE.match(code), code
    row = asyncio.run(db.cmw_preregistrations.find_one({"email": "ana.cmw2@example.com"}))
    assert row["referral_code"] == code


def test_referred_by_set_on_insert_only_and_never_self(env) -> None:
    db, _ = env
    _, p1 = _create(db, _body())
    code = p1["data"]["referral_code"]
    # friend arrives through ana's link (lowercase, no dash → still matches)
    status, p2 = _create(db, _body(
        email="luis.cmw2@example.com", instagram="luis.c",
        source={"utm_source": "wa", "ref": code.replace("-", "").lower(), "landing": "web"}))
    assert status == 200
    luis = asyncio.run(db.cmw_preregistrations.find_one({"email": "luis.cmw2@example.com"}))
    assert luis["referred_by"] == p1["data"]["prereg_id"]
    # self-referral is ignored
    status, _ = _create(db, _body(source={"ref": code, "landing": "web"}))
    ana = asyncio.run(db.cmw_preregistrations.find_one({"email": "ana.cmw2@example.com"}))
    assert "referred_by" not in ana
    # a partner tag never resolves
    status, p3 = _create(db, _body(
        email="eva.cmw2@example.com", instagram="eva",
        source={"ref": "casaboheme", "landing": "web"}))
    eva = asyncio.run(db.cmw_preregistrations.find_one({"email": "eva.cmw2@example.com"}))
    assert "referred_by" not in eva


def test_referral_backfill_for_cmw1_rows(env) -> None:
    db, _ = env

    async def seed() -> None:
        await cmw_prereg.ensure_prereg_indexes(db)
        await db.cmw_preregistrations.insert_one({
            "prereg_id": "cmw-p-aaaaaaaa", "email": "old.cmw1@example.com",
            "full_name": "Old Row", "whatsapp": "+573001112233", "dob": "1990-01-01",
            "created_at": "2026-10-14T00:00:00+00:00", "marketing_opt_in": False,
        })

    asyncio.run(seed())
    status, payload = _create(db, _body(email="old.cmw1@example.com", instagram="old.row"))
    assert status == 200
    assert payload["data"]["updated"] is True
    code = payload["data"]["referral_code"]
    assert code and cmw_prereg.REFERRAL_RE.match(code)
    row = asyncio.run(db.cmw_preregistrations.find_one({"email": "old.cmw1@example.com"}))
    assert row["referral_code"] == code


def test_normalize_referral_shapes() -> None:
    assert cmw_prereg.normalize_referral("CMW-A2B3C4") == "CMW-A2B3C4"
    assert cmw_prereg.normalize_referral("cmwa2b3c4") == "CMW-A2B3C4"
    assert cmw_prereg.normalize_referral("casaboheme") is None
    assert cmw_prereg.normalize_referral("CMW-SHORT") is None
    assert cmw_prereg.normalize_referral(None) is None


# ── funnel events ─────────────────────────────────────────────────────────────

def test_completada_stamped_server_side(env) -> None:
    db, _ = env
    status, payload = _create(db, _body())
    assert status == 200
    evs = asyncio.run(db.cmw_funnel_events.find({}).to_list(None))
    assert [e["event"] for e in evs] == ["preinscripcion_completada"]
    assert evs[0]["prereg_id"] == payload["data"]["prereg_id"]
    # no raw ip, no PII in the event row
    blob = str(evs[0])
    assert IP not in blob and "ana.cmw2" not in blob and "Ana" not in blob


def test_cuenta_creada_on_link(env) -> None:
    db, _ = env
    _create(db, _body())
    asyncio.run(cmw_prereg.link_user_by_email(db, email="ANA.CMW2@example.com", user_id="user_1"))
    events = [e["event"] for e in asyncio.run(db.cmw_funnel_events.find({}).to_list(None))]
    assert "cuenta_creada" in events
    # idempotent: a second link moves nothing → no second event
    asyncio.run(cmw_prereg.link_user_by_email(db, email="ana.cmw2@example.com", user_id="user_1"))
    events = [e["event"] for e in asyncio.run(db.cmw_funnel_events.find({}).to_list(None))]
    assert events.count("cuenta_creada") == 1


def test_event_route_core_whitelist(env, monkeypatch: pytest.MonkeyPatch) -> None:
    db, rl_keys = env
    monkeypatch.setattr(cmw_prereg, "db", db)

    class _Req:
        def __init__(self, body: bytes) -> None:
            self._b = body
            self.headers: Dict[str, str] = {}
            self.query_params: Dict[str, str] = {}
            self.cookies: Dict[str, str] = {}
            self.client = type("C", (), {"host": IP})()

        async def body(self) -> bytes:
            return self._b

    import json as _json

    def post(payload: Dict[str, Any]):
        return asyncio.run(cmw_prereg.funnel_event_route(_Req(_json.dumps(payload).encode())))

    r = post({"event": "cmw_link_abierto", "lang": "es", "source": {"utm_source": "ig", "landing": "web"}})
    assert r.status_code == 200
    # server-stamped kinds are rejected from the client
    r = post({"event": "preinscripcion_completada"})
    assert r.status_code == 422
    r = post({"event": "cuenta_creada"})
    assert r.status_code == 422
    r = post({"event": "not-a-kind"})
    assert r.status_code == 422
    rows = asyncio.run(db.cmw_funnel_events.find({}).to_list(None))
    assert [e["event"] for e in rows] == ["cmw_link_abierto"]
    assert any(":evt:" in k for k in rl_keys)
    monkeypatch.setattr(cmw_prereg, "db", None)


# ── rate bucket namespaces unchanged ─────────────────────────────────────────

def test_prereg_rate_buckets_still_pre_namespaced(env) -> None:
    db, rl_keys = env
    _create(db, _body())
    assert any(k.startswith("cmwip:pre:") for k in rl_keys)
    assert any(k.startswith("cmwcontact:pre:") for k in rl_keys)
