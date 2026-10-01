"""P0-A (audit 2026-10-01): "¡Publicado!" lied to vendors whose venue is not public.

admin_operator.activate_partner grants verified_owner but leaves is_public=False
until an admin approves, while every public read merges PUBLIC_PARTNER_FILTER
(is_public != False, status not suspended …). So an AI-approved event on such a
venue reaches nobody. The create/edit handlers now return `public_visible` +
`visibility_blocker` (response-only), `_require_content_owner` refuses a
SUSPENDED venue, and /business/onboarding-status reports the real filter verdict.

Handlers are exec'd out of server.py (source slice — never import server.py)
against the in-memory StubDB; the LLM and Telegram modules are faked via
sys.modules for the duration of each test.
"""
import asyncio
import logging
import os
import sys
import types
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

import pytest

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from events_service_stubs import StubDB, server_block, server_src  # noqa: E402
from partner_visibility import (  # noqa: E402
    is_publicly_visible, partner_visibility_blocker, PUBLIC_PARTNER_FILTER,
)

BIZ = {"business_id": "biz_t1", "partner_id": "ptr_t1", "role": "business", "email": "o@x.co"}


def _partner(**over: Any) -> Dict[str, Any]:
    base = {"partner_id": "ptr_t1", "name": "Casa Test", "claim_status": "verified_owner",
            "claimed_by": "biz_t1", "catalog_status": "approved", "status": "active"}
    base.update(over)
    return base


class _HTTPException(Exception):
    def __init__(self, status_code: int = 400, detail: Any = "") -> None:
        super().__init__(detail)
        self.status_code, self.detail = status_code, detail


class _Req:
    def __init__(self, body: Dict[str, Any]) -> None:
        self._body = body

    async def json(self) -> Dict[str, Any]:
        return self._body


def _ns(db: StubDB, partner: Dict[str, Any]) -> Dict[str, Any]:
    """Namespace with the real helper blocks + minimal stubs for the two handlers."""
    src = server_src()
    deco = lambda *a, **k: (lambda f: f)  # noqa: E731

    async def get_current_business(request: Any) -> Dict[str, Any]:
        return dict(BIZ)

    async def _check_rate_limit(key: str, max_calls: int = 10, window_sec: int = 60) -> None:
        return None

    async def _require_verified_owner(biz: Dict[str, Any], partner_id: str) -> Dict[str, Any]:
        return dict(partner)

    async def _json_body(request: Any) -> Dict[str, Any]:
        return await request.json()

    async def _noop(*a: Any, **k: Any) -> None:
        return None

    ns: Dict[str, Any] = {
        "db": db, "os": os, "uuid": uuid, "datetime": datetime, "timedelta": timedelta, "timezone": timezone,
        "Optional": Any, "Request": object, "HTTPException": _HTTPException,
        "api_router": types.SimpleNamespace(get=deco, post=deco, put=deco, delete=deco),
        "logger": logging.getLogger("test"),
        "get_current_business": get_current_business, "_check_rate_limit": _check_rate_limit,
        "_require_verified_owner": _require_verified_owner, "_json_body": _json_body,
        "_today_bogota": lambda: "2026-01-01",
        "_pc": types.SimpleNamespace(validate_image_value=lambda v: isinstance(v, str) and v.startswith("/images/")),
        "_emails_svc": types.SimpleNamespace(send_admin_alert=_noop),
        "partner_visibility_blocker": partner_visibility_blocker,
    }
    for anchor in ("def _bounded_int(", "def _now_iso(", "def _overnight_date_end(", "async def _mod_log(",
                   "async def _require_content_owner(", "def _event_public_visibility("):
        exec(server_block(anchor, src), ns)
    exec(server_block('@api_router.post("/business/events")', src), ns)
    exec(server_block('@api_router.put("/business/events/{event_id}")', src), ns)
    return ns


def _fake_modules(monkeypatch: pytest.MonkeyPatch, verdict: str = "AUTO_APPROVE") -> Dict[str, Any]:
    sent: Dict[str, Any] = {"tg": []}
    mod = types.ModuleType("ai_moderation")

    async def moderate_event(**kw: Any) -> Dict[str, Any]:
        return {"verdict": verdict, "category": kw.get("category", "music"), "category_changed": False,
                "completeness_score": 90, "improved_description": "", "tags": [], "reason": "ok", "issues": []}

    mod.moderate_event = moderate_event  # type: ignore[attr-defined]
    tg = types.ModuleType("telegram_alerts")

    async def send(text: Any, **_k: Any) -> Dict[str, Any]:
        sent["tg"].append(str(text))
        return {"configured": True, "sent": 1, "chats": 1, "errors": []}

    tg.send = send  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "ai_moderation", mod)
    monkeypatch.setitem(sys.modules, "telegram_alerts", tg)
    return sent


BODY = {"title": "Noche de jazz", "description": "Trío en vivo en el patio", "category": "music",
        "date": "2026-12-20", "start_time": "20:00", "end_time": "23:00", "flyer_url": "", "is_free": True}


# ── the single source of truth stays in lockstep ────────────────────────────

@pytest.mark.parametrize("partner,expected", [
    ({}, None),                                              # editorial venue: no flags at all
    ({"is_public": True, "status": "active"}, None),
    ({"is_public": False, "status": "active"}, "venue_not_public"),   # activated, awaiting approval
    ({"status": "suspended", "is_public": False}, "venue_suspended"),
    ({"catalog_status": "pending_review"}, "venue_pending_review"),
    ({"catalog_status": "rejected"}, "venue_rejected"),
    ({"catalog_status": "sandbox"}, "venue_sandbox"),
    ({"status": "needs_verification"}, "venue_needs_verification"),
    ({"status": "pending_review", "catalog_status": None}, "venue_pending_review"),
])
def test_blocker_matches_is_publicly_visible(partner: Dict[str, Any], expected: Any) -> None:
    assert partner_visibility_blocker(partner) == expected
    assert (partner_visibility_blocker(partner) is None) == is_publicly_visible(partner)


def test_blocker_covers_every_value_the_filter_hides() -> None:
    """Every value PUBLIC_PARTNER_FILTER $nin's must map to a venue_* blocker."""
    for field in ("catalog_status", "status"):
        for val in PUBLIC_PARTNER_FILTER[field]["$nin"]:
            assert partner_visibility_blocker({field: val}) == f"venue_{val}"


def test_event_public_visibility_truth_table() -> None:
    ns: Dict[str, Any] = {"partner_visibility_blocker": partner_visibility_blocker}
    exec(server_block("def _event_public_visibility("), ns)
    f = ns["_event_public_visibility"]
    live = {"moderation_status": "approved", "is_published": True}
    assert f(_partner(), live) == (True, None)
    assert f(_partner(is_public=False), live) == (False, "venue_not_public")
    assert f(_partner(status="suspended"), live) == (False, "venue_suspended")
    assert f(_partner(), {"moderation_status": "pending", "is_published": False}) == (False, "event_pending_moderation")
    assert f(_partner(), {"moderation_status": "rejected", "is_published": False}) == (False, "event_rejected")
    assert f(_partner(), {"moderation_status": "approved", "is_published": False}) == (False, "event_unpublished")
    # the venue gate is reported first — it is the one the vendor cannot fix from the form
    assert f(_partner(is_public=False), {"moderation_status": "pending"}) == (False, "venue_not_public")


# ── _require_content_owner: a suspended venue cannot publish into the void ───

def test_require_content_owner_rejects_a_suspended_venue() -> None:
    ns = _ns(StubDB(), _partner(status="suspended", is_public=False))
    with pytest.raises(_HTTPException) as ei:
        asyncio.run(ns["_require_content_owner"](dict(BIZ), "ptr_t1"))
    assert ei.value.status_code == 403 and "suspendido" in str(ei.value.detail)


def test_require_content_owner_still_allows_active_not_yet_public() -> None:
    """Not-yet-approved (is_public=False) stays ALLOWED — the response tells the truth instead."""
    ns = _ns(StubDB(), _partner(is_public=False))
    out = asyncio.run(ns["_require_content_owner"](dict(BIZ), "ptr_t1"))
    assert out["partner_id"] == "ptr_t1"


def test_require_content_owner_keeps_the_catalog_gate() -> None:
    ns = _ns(StubDB(), _partner(catalog_status="pending_review"))
    with pytest.raises(_HTTPException) as ei:
        asyncio.run(ns["_require_content_owner"](dict(BIZ), "ptr_t1"))
    assert ei.value.status_code == 403


# ── create: the response carries reach, the stored doc does not ─────────────

def test_create_reports_not_visible_when_the_venue_is_not_public(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_modules(monkeypatch, "AUTO_APPROVE")
    db = StubDB()
    ns = _ns(db, _partner(is_public=False))
    out = asyncio.run(ns["business_create_event"](_Req(dict(BODY))))
    assert out["moderation_verdict"] == "AUTO_APPROVE" and out["is_published"] is True
    assert out["public_visible"] is False
    assert out["visibility_blocker"] == "venue_not_public"
    stored = db.partner_events.rows[0]
    assert "public_visible" not in stored and "visibility_blocker" not in stored, "response-only fields leaked into the doc"


def test_create_reports_visible_on_a_public_venue(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_modules(monkeypatch, "AUTO_APPROVE")
    ns = _ns(StubDB(), _partner())
    out = asyncio.run(ns["business_create_event"](_Req(dict(BODY))))
    assert out["public_visible"] is True and out["visibility_blocker"] is None


def test_create_reports_pending_moderation_on_a_public_venue(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_modules(monkeypatch, "NEEDS_REVIEW")
    ns = _ns(StubDB(), _partner())
    out = asyncio.run(ns["business_create_event"](_Req(dict(BODY))))
    assert out["is_published"] is False
    assert out["public_visible"] is False and out["visibility_blocker"] == "event_pending_moderation"


def test_create_on_a_suspended_venue_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_modules(monkeypatch, "AUTO_APPROVE")
    db = StubDB()
    ns = _ns(db, _partner(status="suspended", is_public=False))
    with pytest.raises(_HTTPException) as ei:
        asyncio.run(ns["business_create_event"](_Req(dict(BODY))))
    assert ei.value.status_code == 403
    assert db.partner_events.rows == []


# ── edit: same truth on the PUT response ────────────────────────────────────

def _seed_live_event(db: StubDB) -> None:
    asyncio.run(db.partner_events.insert_one({
        "event_id": "pe_t1", "partner_id": "ptr_t1", "title": "Noche de jazz", "description": "Trío",
        "category": "music", "date": "2026-12-20", "start_time": "20:00", "end_time": "23:00",
        "flyer_url": "", "is_free": True, "price": 0, "is_published": True, "moderation_status": "approved",
    }))


def test_edit_reports_not_visible_when_the_venue_is_not_public() -> None:
    db = StubDB()
    _seed_live_event(db)
    ns = _ns(db, _partner(is_public=False))
    out = asyncio.run(ns["business_update_event"]("pe_t1", _Req({"price": 50000})))  # no re-moderation path
    assert out["public_visible"] is False and out["visibility_blocker"] == "venue_not_public"
    assert "public_visible" not in db.partner_events.rows[0]


def test_edit_pause_reports_event_unpublished() -> None:
    db = StubDB()
    _seed_live_event(db)
    ns = _ns(db, _partner())
    out = asyncio.run(ns["business_update_event"]("pe_t1", _Req({"is_published": False})))
    assert out["is_published"] is False
    assert out["public_visible"] is False and out["visibility_blocker"] == "event_unpublished"


def test_edit_reports_visible_on_a_public_venue() -> None:
    db = StubDB()
    _seed_live_event(db)
    ns = _ns(db, _partner())
    out = asyncio.run(ns["business_update_event"]("pe_t1", _Req({"price": 50000})))
    assert out["public_visible"] is True and out["visibility_blocker"] is None


# ── source guards: both handlers return the fields; onboarding-status tells the truth ──

def test_both_handlers_return_the_reach_fields() -> None:
    for anchor in ('@api_router.post("/business/events")', '@api_router.put("/business/events/{event_id}")'):
        blk = server_block(anchor)
        assert '"public_visible"' in blk and '"visibility_blocker"' in blk, anchor
        assert "_event_public_visibility(" in blk, anchor


def test_onboarding_status_reports_the_filter_verdict_not_the_raw_flag() -> None:
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "admin_operator.py")
    with open(path, encoding="utf-8") as f:
        src = f.read()
    blk = src[src.index('@public_router.get("/business/onboarding-status")'):]
    assert '"is_public": is_publicly_visible(partner)' in blk
    assert '"visibility_blocker": partner_visibility_blocker(partner)' in blk
    assert '"is_public": bool(partner.get("is_public"))' not in blk, \
        "raw flag misreports the 422 editorial venues as hidden"
