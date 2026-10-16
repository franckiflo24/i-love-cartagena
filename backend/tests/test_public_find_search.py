"""Busca-primero drop (2026-10-15): /business/catalog/search is PUBLIC.

An owner can check whether their business is already on AMO before creating an
account. The contract under test:
  1. anonymous (401 from the session guard) → allowed, but IP-bucketed via
     `bizfindip:` — and the results are the same catalog-public trim;
  2. a valid business session skips the anonymous bucket entirely;
  3. the bucket's 429 propagates to the caller;
  4. a non-401 from the auth guard (e.g. 503 session-store blip) is NOT
     swallowed into the anonymous path — it re-raises unchanged;
  5. `bizfindip` stays OUT of ratelimit.SENSITIVE_PREFIXES: a public read of
     public data degrades, it never 503s the front door;
  6. the trimmed result exposes exactly the catalog-public fields — the public
     surface can never silently grow.

Handler exec'd out of server.py source (never import server.py), per suite
convention (events_service_stubs.server_block).
"""
import asyncio
import os
import sys
import types
from typing import Any, Dict, List

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from events_service_stubs import server_block  # noqa: E402
import ratelimit  # noqa: E402

ANCHOR = '@api_router.get("/business/catalog/search")'

CANDS: List[Dict[str, Any]] = [
    {"partner_id": "ptr_a", "name": "Spa del Mar", "neighborhood": "Bocagrande",
     "category": "wellness", "image_url": "/images/partners/ptr_a.jpg",
     "claim_status": None, "_score": 0.91, "internal_note": "NEVER-PUBLIC"},
    {"partner_id": "ptr_b", "name": "Mar y Zielo", "neighborhood": "Centro",
     "category": "restaurant", "image_url": "", "claim_status": "verified_owner",
     "_score": 0.52, "email": "owner@secret.co"},
]


def _build(auth_behavior, rl_calls: List[str], rl_raises: bool = False):
    """Exec the handler with fakes; returns the async handler callable."""
    ns: Dict[str, Any] = {}

    def _route_passthrough(*_a, **_k):
        def deco(fn):
            ns["HANDLER"] = fn
            return fn
        return deco

    async def get_current_business(request):
        return auth_behavior(request)

    async def _check_rate_limit(key: str, max_calls: int = 10, window_sec: int = 60):
        rl_calls.append(f"{key}|{max_calls}|{window_sec}")
        if rl_raises:
            raise HTTPException(status_code=429, detail="Too many requests")

    async def _catalog_candidates():
        return [dict(c) for c in CANDS]

    ns.update({
        "api_router": types.SimpleNamespace(get=_route_passthrough),
        "Request": object, "HTTPException": HTTPException,
        "get_current_business": get_current_business,
        "_check_rate_limit": _check_rate_limit,
        "_catalog_candidates": _catalog_candidates,
        "_client_ip": lambda req: "203.0.113.9",
        "_hood_of": lambda r: r.get("neighborhood") or "",
        "_pc": types.SimpleNamespace(search_catalog=lambda q, hood, cands: list(cands)),
    })
    exec(server_block(ANCHOR), ns)  # noqa: S102 — suite convention
    return ns["HANDLER"]


def _anon(request):
    raise HTTPException(status_code=401, detail="Not authenticated as business")


def _authed(request):
    return {"business_id": "biz_t1"}


class _Req:  # the handler only passes it through to the fakes
    headers: Dict[str, str] = {}


def test_anonymous_search_allowed_and_ip_bucketed():
    calls: List[str] = []
    handler = _build(_anon, calls)
    out = asyncio.run(handler(_Req(), q="spa"))
    assert [r["partner_id"] for r in out["results"]] == ["ptr_a", "ptr_b"]
    assert len(calls) == 1 and calls[0].startswith("bizfindip:203.0.113.9|60|3600")


def test_authed_search_skips_anon_bucket():
    calls: List[str] = []
    handler = _build(_authed, calls)
    out = asyncio.run(handler(_Req(), q="spa"))
    assert out["results"] and calls == []


def test_anon_429_propagates():
    calls: List[str] = []
    handler = _build(_anon, calls, rl_raises=True)
    with pytest.raises(HTTPException) as ei:
        asyncio.run(handler(_Req(), q="spa"))
    assert ei.value.status_code == 429


def test_non_401_auth_error_reraises_not_swallowed():
    calls: List[str] = []

    def _blip(request):
        raise HTTPException(status_code=503, detail="session store down")

    handler = _build(_blip, calls)
    with pytest.raises(HTTPException) as ei:
        asyncio.run(handler(_Req(), q="spa"))
    assert ei.value.status_code == 503 and calls == []


def test_bizfindip_not_sensitive_prefix():
    assert "bizfindip" not in ratelimit.SENSITIVE_PREFIXES


def test_trim_is_exactly_catalog_public_fields():
    handler = _build(_anon, [])
    out = asyncio.run(handler(_Req(), q="spa"))
    for row in out["results"]:
        assert set(row.keys()) == {"partner_id", "name", "neighborhood",
                                   "category", "image_url", "claim_status", "score"}
    assert out["results"][0]["claim_status"] == "unclaimed"  # None coerces
    assert out["results"][1]["claim_status"] == "verified_owner"


def test_short_query_returns_empty_without_bucket():
    calls: List[str] = []
    handler = _build(_anon, calls)
    out = asyncio.run(handler(_Req(), q="s"))
    assert out == {"results": [], "query": "s"}
    assert len(calls) == 1  # bucket charged before the length check — probe-proof
