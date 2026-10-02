"""P1-3 (audit 2026-10-01): four unthrottled write surfaces.

POST /business/signup (per IP 5/3600, fails closed), POST /reservations (per
user 20/3600), POST /reviews/{id}/report (per user 10/3600), POST
/business/activate (per IP 10/900, fails closed). reservations.py / reviews.py
take the limiter through init(check_rate_limit=…) like pulse/walking do;
admin_operator uses ratelimit.check + the TRUSTED client_ip directly (it cannot
import server at load). server.py is never imported here.
"""
import asyncio
import os
import re
import sys
from typing import Any, Dict

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from events_service_stubs import server_block, server_src  # noqa: E402
import ratelimit  # noqa: E402
import reservations as R  # noqa: E402
import reviews as V  # noqa: E402

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class _Req:
    """A request whose body must never be read before the limiter runs."""
    def __init__(self) -> None:
        self.body_read = False

    async def json(self) -> Dict[str, Any]:
        self.body_read = True
        return {}


class _Limiter:
    def __init__(self, deny: bool) -> None:
        self.deny, self.calls = deny, []

    async def __call__(self, key: str, max_calls: int = 10, window_sec: int = 60) -> None:
        self.calls.append((key, max_calls, window_sec))
        if self.deny:
            raise HTTPException(status_code=429, detail="Too many requests")


class _ExplodingDB:
    def __getattr__(self, name: str) -> Any:
        raise AssertionError(f"db.{name} touched before the rate limit")


async def _user(request: Any) -> Dict[str, Any]:
    return {"user_id": "user_x", "email": "x@example.com"}


# ── POST /reservations ──────────────────────────────────────────────────────

def test_reservations_create_is_capped_per_user_before_any_db_or_body_read() -> None:
    lim = _Limiter(deny=True)
    R.init(db=_ExplodingDB(), get_current_user=_user, get_current_business=_user,
           require_government_role=_user, check_rate_limit=lim)
    req = _Req()
    with pytest.raises(HTTPException) as ei:
        asyncio.run(R.create_reservation(req))
    assert ei.value.status_code == 429
    assert lim.calls == [("resvcreate:user_x", 20, 3600)]
    assert req.body_read is False


def test_reservations_init_without_limiter_still_works() -> None:
    """Older callers / tests that never pass check_rate_limit are not broken."""
    R.init(db=_ExplodingDB(), get_current_user=_user, get_current_business=_user, require_government_role=_user)
    req = _Req()
    with pytest.raises(HTTPException) as ei:          # falls through to validation (400), not a KeyError
        asyncio.run(R.create_reservation(req))
    assert ei.value.status_code == 400 and req.body_read is True


# ── POST /reviews/{id}/report ───────────────────────────────────────────────

def test_review_report_is_capped_per_user_before_any_db_or_body_read() -> None:
    lim = _Limiter(deny=True)
    V.init(db=_ExplodingDB(), get_current_user=_user, check_rate_limit=lim)
    req = _Req()
    with pytest.raises(HTTPException) as ei:
        asyncio.run(V.report_review(req, "rev_1"))
    assert ei.value.status_code == 429
    assert lim.calls == [("reviewreport:user_x", 10, 3600)]
    assert req.body_read is False


def test_review_report_allows_through_when_under_the_cap() -> None:
    class _Coll:
        async def find_one(self, *a: Any, **k: Any) -> Any:
            return None

    class _DB:
        reviews = _Coll()

    lim = _Limiter(deny=False)
    V.init(db=_DB(), get_current_user=_user, check_rate_limit=lim)
    with pytest.raises(HTTPException) as ei:          # review missing → 404 AFTER the limiter ran
        asyncio.run(V.report_review(_Req(), "rev_missing"))
    assert ei.value.status_code == 404 and lim.calls[0][0] == "reviewreport:user_x"


# ── POST /business/signup (server.py) + POST /business/activate (admin_operator) ──

def test_business_signup_has_a_trusted_ip_gate_first() -> None:
    blk = server_block('@api_router.post("/business/signup")')
    gate = 'await _check_rate_limit(f"bizsignup:{_client_ip(request)}", max_calls=5, window_sec=3600)'
    assert gate in blk
    assert blk.index(gate) < blk.index("await request.json()"), "gate runs before the body is parsed"


def test_business_activate_has_a_trusted_ip_gate_first() -> None:
    with open(os.path.join(BACKEND, "admin_operator.py"), encoding="utf-8") as f:
        src = f.read()
    blk = src[src.index('@public_router.post("/business/activate")'):]
    blk = blk[: blk.index("\n\n\n")]
    assert 'await _rl_check(f"bizactivate:{_rl_ip(request)}", max_calls=10, window_sec=900)' in blk
    assert "from ratelimit import check as _rl_check, client_ip as _rl_ip" in blk
    assert blk.index("_rl_check(") < blk.index("await request.json()")
    assert "request.client.host" not in blk, "the gate keys on the TRUSTED ip, never the raw socket/XFF"


# ── fail mode + wiring ───────────────────────────────────────────────────────

def test_auth_surfaces_fail_closed_and_browsing_caps_degrade() -> None:
    assert "bizsignup" in ratelimit.SENSITIVE_PREFIXES
    assert "bizactivate" in ratelimit.SENSITIVE_PREFIXES
    # a store blip must not block a traveller's reservation or report (degrades to the local bucket)
    assert "resvcreate" not in ratelimit.SENSITIVE_PREFIXES
    assert "reviewreport" not in ratelimit.SENSITIVE_PREFIXES


def test_server_wires_the_limiter_into_both_modules() -> None:
    src = server_src()
    resv = re.search(r"_reservations\.init\((.*?)\)\n", src, re.S)
    revs = re.search(r"_reviews\.init\((.*?)\)\n", src, re.S)
    assert resv and "check_rate_limit=_check_rate_limit" in resv.group(1)
    assert revs and "check_rate_limit=_check_rate_limit" in revs.group(1)
