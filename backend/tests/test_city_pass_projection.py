"""P0 (audit 2026-10-01): the City Pass `qr_secret` is the HMAC key behind the
AMOPASS1 rotating QR. tickets.py mints it on first /city-pass/qr; server.py must
never hand the stored doc to a client. These tests exec the real handlers out of
server.py (source slice — never import server.py) against a fake db whose pass
carries a key, and assert the key is absent from every response.
"""
import asyncio
import os
import re
import sys
import types
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

sys.path.insert(0, os.path.dirname(__file__))
from events_service_stubs import server_block, server_src  # noqa: E402

KEY = "0123456789abcdef0123456789abcdef"
PASS = {"pass_id": "cp_test123456", "user_id": "user_x", "plan_id": "classic", "status": "active",
        "payment_status": "paid", "is_active": True, "qr_secret": KEY,
        "activated_at": "2026-10-01T00:00:00+00:00", "expires_at": "2026-10-08T00:00:00+00:00"}


def _project(doc: Dict[str, Any], proj: Optional[Dict[str, int]]) -> Dict[str, Any]:
    if not proj:
        return dict(doc)
    excl = {k for k, v in proj.items() if v == 0}
    return {k: v for k, v in doc.items() if k not in excl}


class _Cursor:
    def __init__(self, rows):
        self._rows = rows

    def sort(self, *a, **k):
        return self

    def limit(self, n):
        self._rows = self._rows[:n]
        return self

    async def to_list(self, n):
        return self._rows[:n]


class _Coll:
    def __init__(self, rows):
        self.rows = [dict(r) for r in rows]

    async def find_one(self, q, proj=None):
        for r in self.rows:
            if all(r.get(k) == v for k, v in q.items()):
                return _project(r, proj)
        return None

    async def insert_one(self, doc):
        self.rows.append(dict(doc))

    def find(self, q, proj=None):
        rows = [_project(r, proj) for r in self.rows if all(r.get(k) == v for k, v in q.items())]
        return _Cursor(rows)


class _Req:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body


def _exec_handlers():
    src = server_src()

    class HTTPException(Exception):
        def __init__(self, status_code=400, detail=""):
            self.status_code, self.detail = status_code, detail

    async def get_current_user(request):
        return {"user_id": "user_x", "email": "x@example.com"}

    async def _check_rate_limit(*a, **k):  # the real one needs a Mongo store this unit env lacks
        return None

    deco = lambda *a, **k: (lambda f: f)  # noqa: E731
    ns: Dict[str, Any] = {
        "db": types.SimpleNamespace(city_passes=_Coll([PASS])),
        "os": os, "uuid": uuid, "datetime": datetime, "timedelta": timedelta, "timezone": timezone,
        "Request": object, "Response": object,
        "CITY_PASS_PLANS": {"classic": {"duration_days": 7}},
        "HTTPException": HTTPException, "get_current_user": get_current_user,
        "_check_rate_limit": _check_rate_limit,
        "api_router": types.SimpleNamespace(get=deco, post=deco),
    }
    exec(server_block('@api_router.post("/city-pass/activate")', src), ns)
    exec(server_block('@api_router.get("/city-pass/mine")', src), ns)
    return ns


def test_mine_never_returns_the_signing_key():
    ns = _exec_handlers()
    out = asyncio.run(ns["my_city_pass"](_Req()))
    assert out and out["pass_id"] == "cp_test123456"
    assert "qr_secret" not in out, "GET /city-pass/mine leaked the pass signing key"


def test_activate_already_active_never_returns_the_signing_key():
    ns = _exec_handlers()
    out = asyncio.run(ns["activate_city_pass"](_Req({"plan_id": "classic"})))
    assert out["status"] == "already_active"
    assert "qr_secret" not in out["pass"], "POST /city-pass/activate (already_active) leaked the key"


def test_every_city_pass_read_in_server_projects_out_the_key():
    """Source-level guard: any db.city_passes.find/find_one in server.py whose rows
    can reach a response must exclude qr_secret. The wompi-webhook existence check
    (never returned) is allow-listed by its exact query shape."""
    src = server_src()
    allowed_internal = ('{"user_id": user_id, "is_active": True}',)
    reads = list(re.finditer(r'db\.city_passes\.find(?:_one)?\(', src))
    assert reads, "expected city_passes reads in server.py"
    for m in reads:
        # take the call up to the matching close paren (reads here are single-expression)
        start = m.end()
        depth, i = 1, start
        while depth and i < len(src):
            depth += {"(": 1, ")": -1}.get(src[i], 0)
            i += 1
        call = src[start:i - 1]
        if any(a in call for a in allowed_internal):
            continue
        inclusion = re.search(r'"[a-z_]+":\s*1\b', call) and '"qr_secret": 1' not in call
        assert inclusion or '"qr_secret": 0' in call, \
            f"city_passes read without qr_secret projection: {call[:120]!r}"
