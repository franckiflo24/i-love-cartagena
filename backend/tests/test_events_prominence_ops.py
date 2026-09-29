"""EVENTS-ELITE §16: prominence (16.1) and autonomous operations (16.4).

  16.1  prominence(doc) exactly per the table; PublicEvent carries prominence + flagship; lists
        sort within a day by prominence; /api/events/featured and Luna's get_confirmed_events
        sort prominence desc then date; series / long_span rows are never promoted.
  16.4  Bearer EVENTS_ADMIN_TOKEN on the events admin + cron routes (header only, constant-time);
        pull seeds anchors first when anchors_version changed (idempotent, §15 W2); the */15
        sentinel picks its slot; EVENTS_ELITE_ENABLED defaults a MISSING flags doc; the history
        cutover is read from env at call time.

Pure: stub DB, the real anchors file, the real server.py route slices. Never imports server.py.

Run: cd backend && python -m pytest -q tests/test_events_prominence_ops.py
"""
from __future__ import annotations

import asyncio
import copy
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS = os.path.dirname(os.path.abspath(__file__))
for p in (BACKEND, TESTS):
    if p not in sys.path:
        sys.path.insert(0, p)

import events_elite as E  # noqa: E402
import events_gate as G  # noqa: E402
import events_legacy as LG  # noqa: E402
import events_runtime as R  # noqa: E402
import luna_events as L  # noqa: E402
import telegram_alerts as T  # noqa: E402
import test_events_routes as TRT  # noqa: E402
from events_service_stubs import StubDB, with_event_indexes  # noqa: E402

UTC = timezone.utc
TOKEN = "t" * 20 + "0123456789abcdefghijklmnopqrstuvwxyz"   # ≥ 32 chars, like the minted 48-byte token
NOW = datetime(2026, 10, 1, 16, 0, tzinfo=UTC)               # Thu 1 Oct 2026, 11:00 Bogotá
LV = (NOW - timedelta(hours=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
TEATRO = (10.4266111, -75.5511837)


@pytest.fixture(autouse=True)
def _reset(monkeypatch: pytest.MonkeyPatch) -> Dict[str, List[str]]:
    R.invalidate_caches()
    sent: Dict[str, List[str]] = {"alerts": []}

    async def fake_send(text: Any, **_k: Any) -> Dict[str, Any]:
        sent["alerts"].append(str(text))
        return {"configured": False, "sent": 0, "chats": 0, "errors": []}

    async def fake_digest(title: str, lines: Any, **_k: Any) -> Dict[str, Any]:
        return {"configured": False, "sent": 0, "chats": 0, "errors": []}

    monkeypatch.setattr(T, "send", fake_send)
    monkeypatch.setattr(T, "digest", fake_digest)
    for k in ("CRON_SECRET", "EVENTS_ADMIN_TOKEN", "EVENTS_ELITE_ENABLED", "EVENTS_ELITE_CUTOVER"):
        monkeypatch.delenv(k, raising=False)
    return sent


def row(eid: str, *, category: str = "concert", start: str = "2026-11-12", end: Optional[str] = None,
        time_: Optional[str] = "19:00", tier: int = 2, url: str = "https://tuboleta.com/es/eventos/x",
        **over: Any) -> Dict[str, Any]:
    d: Dict[str, Any] = {
        "event_id": eid, "canonical_key": f"{eid}|2026|teatro", "title": {"es": eid.replace("-", " ").title()},
        "description": {}, "category": category, "edition_year": 2026, "start_date": start, "end_date": end or start,
        "start_time": time_, "end_time": None, "time_confirmed": bool(time_), "venue_name": "Teatro Adolfo Mejía",
        "address": None, "zone": "centro", "lat": TEATRO[0], "lng": TEATRO[1], "geocode_source": "gazetteer",
        "price": {"is_free": True, "min_cop": None, "max_cop": None, "text": "Entrada libre"},
        "ticket_url": url, "source_url": url, "source_name": "Fuente", "source_tier": tier, "recheck_url": url,
        "source_keys": [f"test:{eid}"],
        "evidence": [{"url": url, "name": "Fuente", "tier": tier, "fetched_at": LV, "http_status": 200,
                      "date_text": f"{start} {time_ or ''}", "date_visible": True, "start_date": start,
                      "end_date": end or start, "start_time": time_}],
        "last_verified": LV, "country_check": "pass", "country_signals": ["pass:t"], "status": "published",
        "status_reason": None, "confidence": "HIGH", "origin": "pipeline", "sold_out": False, "parent_id": None,
        "is_umbrella": False, "blocked_days": 0, "not_found_count": 0, "gone_strikes": 0,
    }
    d.update(over)
    return d


def stub_db(*docs: Dict[str, Any], enabled: Optional[bool] = True, healthy: bool = True) -> StubDB:
    db = asyncio.run(with_event_indexes(StubDB()))

    async def seed() -> None:
        if enabled is not None:
            await db.city_events_state.insert_one({"_id": "flags", "enabled": enabled})
        if healthy:
            await db.city_events_runs.insert_one({"kind": "sentinel", "done": True, "slot": "main",
                                                  "finished_at": (NOW - timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%SZ")})
        for d in docs:
            await db.city_events.insert_one(d)

    asyncio.run(seed())
    return db


# ═════════════════════════════════════════════════════════════════════════════
# 16.1 prominence
# ═════════════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize("category,base", [
    ("festival", 40), ("concert", 35), ("sports", 25), ("cultural", 20), ("gastronomic", 15), ("family", 15),
    ("nightlife", 10), ("civic", 10), ("bogus", 20),
])
def test_prominence_category_base(category: str, base: int) -> None:
    assert G.prominence({"category": category}) == base


def test_prominence_components_exactly_per_the_table() -> None:
    base = {"category": "festival", "source_url": "https://tuboleta.com/x", "source_tier": 2, "confidence": "VERIFY"}
    assert G.prominence(base) == 40
    assert G.prominence({**base, "flagship": True}) == 90
    assert G.prominence({**base, "flagship": "yes"}) == 40, "flagship counts only as a literal True"
    assert G.prominence({**base, "is_umbrella": True}) == 50
    assert G.prominence({**base, "source_url": "https://ipcc.gov.co/x", "source_tier": 1}) == 50   # tier 1 (registry)
    assert G.prominence({**base, "confidence": "HIGH"}) == 50
    assert G.prominence({**base, "parent_id": "ce-fiestas-20261002-aaaa"}) == 30
    assert G.prominence({**base, "origin": "partner"}) == 35
    top = {"category": "festival", "flagship": True, "is_umbrella": True, "source_url": "https://ipcc.gov.co/x",
           "confidence": "HIGH"}
    assert G.prominence(top) == 40 + 50 + 10 + 10 + 10


def test_series_and_long_span_are_never_promoted() -> None:
    top = {"category": "festival", "flagship": True, "confidence": "HIGH", "source_url": "https://ipcc.gov.co/x"}
    assert G.prominence({**top, "series": True}) == 0
    assert G.prominence({**top, "recurring": True}) == 0
    assert G.prominence({**top, "flags": ["series"]}) == 0
    assert G.prominence({**top, "status_reason": "long_span"}) == 0
    assert G.prominence({**top, "start_date": "2026-10-01", "end_date": "2026-12-01"}) == 0
    # an umbrella or a sub-event may span > 21 days (it is not long_span)
    assert G.prominence({**top, "start_date": "2026-10-02", "end_date": "2026-11-15", "is_umbrella": True}) == 120


def test_public_view_carries_prominence_and_flagship_with_read_time_confidence() -> None:
    d = row("ce-fest-20261112-aa11", category="festival", flagship=True)
    pv = G.public_view(d, NOW, True)
    assert pv is not None and set(pv) == set(G.PUBLIC_FIELDS)
    assert pv["flagship"] is True and pv["confidence"] == "HIGH" and pv["prominence"] == 40 + 50 + 10
    sick = G.public_view(d, NOW, False)          # unhealthy sentinel: served as VERIFY → no HIGH points
    assert sick is not None and sick["confidence"] == "VERIFY" and sick["prominence"] == 90
    plain = G.public_view(row("ce-plain-20261112-aa12"), NOW, True)
    assert plain is not None and plain["flagship"] is False and plain["prominence"] == 45


def test_public_field_list_is_the_documented_contract() -> None:
    assert G.PUBLIC_FIELDS[-2:] == ("prominence", "flagship")
    assert len(G.PUBLIC_FIELDS) == len(set(G.PUBLIC_FIELDS)) == 33


def test_lists_sort_within_a_day_by_prominence_then_time() -> None:
    a: Dict[str, Any] = {"start_date": "2026-11-12", "start_time": "18:00", "prominence": 20}
    b: Dict[str, Any] = {"start_date": "2026-11-12", "start_time": "21:00", "prominence": 90}
    c: Dict[str, Any] = {"start_date": "2026-11-12", "start_time": None, "prominence": 90}
    d: Dict[str, Any] = {"start_date": "2026-11-11", "start_time": "23:00", "prominence": 0}
    rows: List[Dict[str, Any]] = [a, b, c, d]
    assert sorted(rows, key=G.public_sort_key) == [d, b, c, a]


def _legacy(pv: Dict[str, Any]) -> Dict[str, Any]:
    out = LG.to_legacy_event(pv)
    assert out is not None
    return out


def test_legacy_featured_sorts_prominence_desc_then_date_and_keeps_the_row_shape() -> None:
    early = G.public_view(row("ce-early-20261020-aa01", start="2026-10-20"), NOW, True)
    top = G.public_view(row("ce-top-20261201-aa02", category="festival", start="2026-12-01", flagship=True), NOW, True)
    mid = G.public_view(row("ce-mid-20261105-aa03", category="festival", start="2026-11-05"), NOW, True)
    assert early and top and mid
    rows = [_legacy(early), _legacy(top), _legacy(mid)]
    prom = {pv["event_id"]: pv["prominence"] for pv in (early, top, mid)}
    feat = LG.legacy_featured(rows, prominence=prom)
    assert [r["event_id"] for r in feat] == [top["event_id"], mid["event_id"], early["event_id"]]
    assert "prominence" not in feat[0] and set(feat[0]) == set(rows[1]), "old binaries get the exact legacy shape"
    assert [r["event_id"] for r in LG.legacy_featured(rows)] == [early["event_id"], mid["event_id"], top["event_id"]]


def test_featured_route_puts_the_flagship_first() -> None:
    db = stub_db(row("ce-early-20261020-aa01", start="2026-10-20"),
                 row("ce-top-20261201-aa02", category="festival", start="2026-12-01", flagship=True))
    out = asyncio.run(E.legacy_featured_rows(db, now=NOW))
    assert [r["event_id"] for r in out] == ["ce-top-20261201-aa02", "ce-early-20261020-aa01"]
    h = TRT.Harness(db)
    r = h.client.get("/api/events/featured")
    assert r.status_code == 200
    # the route runs at the real clock: only assert it is the prominence-aware handler
    assert "legacy_featured_rows" in TRT.server_block('@api_router.get("/events/featured")', TRT.SRC)


def test_luna_confirmed_events_sort_prominence_desc_then_date() -> None:
    db = stub_db(row("ce-early-20261020-aa01", start="2026-10-20"),
                 row("ce-top-20261201-aa02", category="festival", start="2026-12-01", flagship=True),
                 row("ce-mid-20261105-aa03", category="festival", start="2026-11-05"),
                 row("ce-weekly-20261021-aa04", category="nightlife", start="2026-10-21", series=True))
    out = asyncio.run(L.get_confirmed_events(db, "upcoming", limit=8, now=NOW))
    assert [r["event_id"] for r in out] == ["ce-top-20261201-aa02", "ce-mid-20261105-aa03",
                                            "ce-early-20261020-aa01", "ce-weekly-20261021-aa04"]
    # a title the user named still leads
    out = asyncio.run(L.get_confirmed_events(db, "upcoming", limit=8, query="¿cuándo es Early?", now=NOW))
    assert out[0]["event_id"] == "ce-early-20261020-aa01"


# ═════════════════════════════════════════════════════════════════════════════
# 16.1 flagship anchors + 16.4 anchors as a source
# ═════════════════════════════════════════════════════════════════════════════

SEED_NOW = datetime(2026, 9, 29, 15, 0, tzinfo=UTC)


def test_flagship_anchors_seed_with_flagship_and_the_highest_prominence() -> None:
    db = stub_db(enabled=True)
    rep = asyncio.run(E.seed_anchors(db, now=SEED_NOW))
    assert not rep["errors"], rep["errors"]
    docs = {d["anchor_key"]: d for d in db.city_events.rows}
    flag = {k for k, d in docs.items() if d.get("flagship") is True}
    assert flag == {"cartagena-festival-musica-2027", "hay-festival-cartagena-2027", "ficci-66-2027",
                    "ironman-70-3-cartagena-2026", "fiestas-independencia-2026",
                    "fiestas-2026-gran-desfile-de-independencia", "fiestas-2026-festival-nautico-y-bololo-del-arsenal"}
    assert docs["fiestas-2026-juan-luis-guerra-festival-nautico"].get("flagship") is False
    fiestas = G.prominence(docs["fiestas-independencia-2026"])
    salsa = G.prominence(docs["fiestas-2026-salsa-a-la-plaza"])
    bando = G.prominence(docs["fiestas-2026-gran-desfile-de-independencia"])
    assert fiestas > bando > salsa


def test_pull_seeds_anchors_first_when_the_version_changes_and_is_idempotent(monkeypatch: pytest.MonkeyPatch) -> None:
    version, anchors = E.load_anchors_file()
    assert isinstance(version, int) and len(anchors) >= 20
    db = stub_db(enabled=True)
    out = asyncio.run(E.run_pull(db, now=SEED_NOW, source_list=[], seed_anchors_first=True, run_enrich=False))
    assert out["anchors"]["anchors_version"] == version and out["anchors"]["inserted"] == len(anchors)
    state = next(r for r in db.city_events_state.rows if r["_id"] == E.ANCHORS_STATE_ID)
    assert state["anchors_version"] == version
    n_docs = len(db.city_events.rows)
    # the day's pass is already done: the next */10 tick is a no-op that does NOT reseed
    out = asyncio.run(E.run_pull(db, now=SEED_NOW + timedelta(minutes=10), source_list=[], seed_anchors_first=True,
                                 run_enrich=False))
    assert out.get("noop") is True and "anchors" not in out and len(db.city_events.rows) == n_docs

    # A sentinel moved one row to review; then the file's version is bumped with a descriptive change.
    fest = next(r for r in db.city_events.rows if r["anchor_key"] == "cartagena-festival-musica-2027")
    fest.update(status="review", status_reason="date_changed", last_verified="2026-09-29T12:00:00Z",
                start_date="2027-01-10")
    bumped = copy.deepcopy(anchors)
    for a in bumped:
        if a["key"] == "cartagena-festival-musica-2027":
            a["anchor_version"] += 1
            a["description"] = {**a["description"], "es": "Descripción nueva."}
            a["start_date"] = "2027-01-09"
    monkeypatch.setattr(E, "load_anchors_file", lambda: (version + 1, bumped))
    out = asyncio.run(E.run_pull(db, now=SEED_NOW + timedelta(minutes=20), source_list=[], seed_anchors_first=True,
                                 run_enrich=False))
    assert out.get("noop") is True, "the day's pass stays done"
    assert out["anchors"]["anchors_version"] == version + 1 and out["anchors"]["inserted"] == 0
    assert out["anchors"]["descriptive_updated"] == 1
    fest = next(r for r in db.city_events.rows if r["anchor_key"] == "cartagena-festival-musica-2027")
    assert fest["description"]["es"] == "Descripción nueva."
    # §15 W2: status, reason, dates and last_verified of an existing doc are never rewritten
    assert (fest["status"], fest["status_reason"], fest["start_date"], fest["last_verified"]) == \
        ("review", "date_changed", "2027-01-10", "2026-09-29T12:00:00Z")
    assert len(db.city_events.rows) == n_docs


def test_existing_anchor_docs_pick_up_flagship_when_anchor_version_grew() -> None:
    _v, anchors = E.load_anchors_file()
    old = copy.deepcopy(anchors)
    for a in old:
        a.pop("flagship", None)
        a["anchor_version"] = 1
    db = stub_db(enabled=True)
    asyncio.run(E.seed_anchors(db, now=SEED_NOW, anchors=old))
    assert not any("flagship" in r for r in db.city_events.rows)
    asyncio.run(E.seed_anchors(db, now=SEED_NOW, anchors=anchors))
    by = {r["anchor_key"]: r for r in db.city_events.rows}
    assert by["hay-festival-cartagena-2027"]["flagship"] is True
    assert "flagship" not in by["fiestas-2026-salsa-a-la-plaza"], "unbumped anchors keep their stored fields"


def test_default_pull_seeds_only_on_the_real_registry() -> None:
    db = stub_db(enabled=True)
    out = asyncio.run(E.run_pull(db, now=SEED_NOW, source_list=[], run_enrich=False))
    assert "anchors" not in out and db.city_events.rows == []
    out = asyncio.run(E.run_pull(db, now=SEED_NOW, source_list=[], dry=True, seed_anchors_first=True, run_enrich=False))
    assert "anchors" not in out and db.city_events.rows == [], "a dry run never seeds"


# ═════════════════════════════════════════════════════════════════════════════
# 16.4 EVENTS_ADMIN_TOKEN
# ═════════════════════════════════════════════════════════════════════════════


def _auth(tok: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {tok}"}


def test_admin_token_runs_cron_routes_and_admin_routes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EVENTS_ADMIN_TOKEN", TOKEN)
    h = TRT.Harness(TRT.make_db(enabled=False))
    r = h.client.get("/api/admin/events/reminders", headers=_auth(TOKEN))
    assert r.status_code == 200 and r.json()["refused"] == "disabled"
    r = h.client.get("/api/admin/events/flags", headers=_auth(TOKEN))
    assert r.status_code == 200 and r.json()["flags"]["enabled"] is False
    r = h.client.patch("/api/admin/events/flags", json={"enabled": True}, headers=_auth(TOKEN))
    assert r.status_code == 200 and r.json()["flags"]["enabled"] is True
    flag_logs = [x for x in h.db.city_events_log.rows if x.get("reason") == "flags"]
    assert flag_logs and flag_logs[-1]["actor"] == "admin:events-admin-token", "audited as the token"
    rv = h.client.get("/api/admin/events/review", headers=_auth(TOKEN))
    assert rv.status_code == 200


def test_admin_token_never_from_a_cookie_and_never_a_wrong_or_weak_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EVENTS_ADMIN_TOKEN", TOKEN)
    db = TRT.make_db(enabled=False)
    h = TRT.Harness(db, user={"user_id": "nobody"})
    assert h.client.get("/api/admin/events/reminders", headers=_auth(TOKEN + "x")).status_code == 403
    assert h.client.get("/api/admin/events/reminders").status_code == 401
    h.client.cookies.set("session_token", TOKEN)
    assert h.client.get("/api/admin/events/reminders").status_code == 401, "a cookie never carries the token"
    assert h.client.post("/api/admin/events/flags", json={"enabled": True},
                         headers={"Origin": "https://www.amocartagena.co", "X-AMO-Admin": "1"}).status_code in (401, 403)
    h.client.cookies.clear()
    assert h.client.post("/api/admin/events/flags", json={"enabled": True},
                         headers=_auth(TOKEN[:-1])).status_code == 401
    monkeypatch.setenv("EVENTS_ADMIN_TOKEN", "short-token")                  # < 32 chars never authenticates
    assert h.client.get("/api/admin/events/reminders", headers=_auth("short-token")).status_code == 403
    monkeypatch.delenv("EVENTS_ADMIN_TOKEN")
    assert h.client.get("/api/admin/events/reminders", headers=_auth(TOKEN)).status_code == 403
    assert db.city_events_state.rows == [r for r in db.city_events_state.rows if r["_id"] == "flags"]
    assert next(r for r in db.city_events_state.rows if r["_id"] == "flags")["enabled"] is False


def test_cron_secret_still_works_alongside_the_admin_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CRON_SECRET", "s3cret")
    monkeypatch.setenv("EVENTS_ADMIN_TOKEN", TOKEN)
    h = TRT.Harness(TRT.make_db(enabled=False))
    assert h.client.get("/api/admin/events/reminders", headers=_auth("s3cret")).status_code == 200
    assert h.client.get("/api/admin/events/reminders", headers=_auth(TOKEN)).status_code == 200
    # the cron secret is NOT an admin credential for mutations
    assert h.client.post("/api/admin/events/flags", json={"enabled": True}, headers=_auth("s3cret")).status_code == 401


def test_admin_token_compare_is_constant_time() -> None:
    import inspect
    src = inspect.getsource(E.is_events_admin_token)
    assert "hmac.compare_digest" in src and "cookies" not in src


# ═════════════════════════════════════════════════════════════════════════════
# 16.4 self-healing sentinel slot
# ═════════════════════════════════════════════════════════════════════════════


def _runs_db(*runs: Dict[str, Any]) -> StubDB:
    db = asyncio.run(with_event_indexes(StubDB()))
    for r in runs:
        asyncio.run(db.city_events_runs.insert_one(r))
    return db


def _run(slot: str, finished: datetime, done: bool = True) -> Dict[str, Any]:
    return {"kind": "sentinel", "slot": slot, "done": done, "finished_at": finished.strftime("%Y-%m-%dT%H:%M:%SZ")}


def test_sentinel_due_slot() -> None:
    t10 = datetime(2026, 10, 1, 10, 0, tzinfo=UTC)
    t17 = datetime(2026, 10, 1, 17, 0, tzinfo=UTC)
    due = E.sentinel_due_slot
    assert asyncio.run(due(_runs_db(), t10)) == "main"                                      # never ran
    assert asyncio.run(due(_runs_db(_run("main", t10 - timedelta(hours=13))), t10)) == "main"   # > 12 h
    assert asyncio.run(due(_runs_db(_run("main", t10 - timedelta(hours=2), done=False)), t10)) == "main"
    assert asyncio.run(due(_runs_db(_run("main", t10 - timedelta(hours=2))), t10)) is None      # before 16:00 UTC
    assert asyncio.run(due(_runs_db(_run("main", t17 - timedelta(hours=6))), t17)) == "today"
    assert asyncio.run(due(_runs_db(_run("main", t17 - timedelta(hours=6)),
                                    _run("today", t17 - timedelta(minutes=30))), t17)) is None
    assert asyncio.run(due(_runs_db(_run("main", t17 - timedelta(hours=6)),
                                    _run("today", t17 - timedelta(hours=20))), t17)) == "today"   # yesterday's
    # The day's main pass finished 13 h ago (05:xx UTC) and its cursor is done: main is NOT due
    # again (it would only no-op) — the 'today' slot must still get its turn after 16:00 UTC.
    t18 = datetime(2026, 10, 1, 18, 30, tzinfo=UTC)
    db = _runs_db(_run("main", t18 - timedelta(hours=13)))
    asyncio.run(db.city_events_state.insert_one({"_id": "cursor:sentinel", "day": "2026-10-01", "done": True}))
    assert asyncio.run(due(db, t18)) == "today"
    assert asyncio.run(due(db, datetime(2026, 10, 1, 15, 0, tzinfo=UTC))) is None
    # a new Bogotá day (05:00 UTC) with yesterday's cursor: main is due again
    assert asyncio.run(due(db, datetime(2026, 10, 2, 5, 15, tzinfo=UTC))) == "main"

    class Broken(StubDB):
        @property
        def city_events_runs(self) -> Any:  # type: ignore[override]
            raise RuntimeError("down")

    assert asyncio.run(due(Broken(), t17)) == "main", "a failed read never starves the watchdog"


def test_sentinel_route_without_slot_is_a_no_op_when_nothing_is_due(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CRON_SECRET", "s3cret")
    db = TRT.make_db(enabled=False)
    fresh = datetime.now(UTC) - timedelta(minutes=5)
    asyncio.run(db.city_events_runs.insert_one(_run("main", fresh)))
    if datetime.now(UTC).hour >= 16:
        asyncio.run(db.city_events_runs.insert_one(_run("today", fresh)))
    h = TRT.Harness(db)
    r = h.client.get("/api/admin/events/sentinel", headers=_auth("s3cret"))
    assert r.status_code == 200 and r.json() == {"skipped": "not_due", "slot": None}
    assert not any(str(x.get("_id", "")).startswith("cursor:") for x in db.city_events_state.rows)


# ═════════════════════════════════════════════════════════════════════════════
# 16.4 EVENTS_ELITE_ENABLED default + cutover from env
# ═════════════════════════════════════════════════════════════════════════════


def _flags(db: Any) -> Dict[str, Any]:
    R.invalidate_caches()
    return asyncio.run(R.get_flags(db))


def test_env_enabled_defaults_only_a_missing_flags_doc(monkeypatch: pytest.MonkeyPatch) -> None:
    missing = stub_db(enabled=None)
    assert _flags(missing)["enabled"] is False, "fail-closed without the env"
    monkeypatch.setenv("EVENTS_ELITE_ENABLED", "1")
    assert _flags(missing)["enabled"] is True
    assert _flags(stub_db(enabled=False))["enabled"] is False, "enabled:false always wins (kill switch)"
    assert _flags(stub_db(enabled=True))["enabled"] is True
    no_key = stub_db(enabled=None)
    asyncio.run(no_key.city_events_state.insert_one({"_id": "flags", "sources_disabled": ["tuboleta"]}))
    assert _flags(no_key) == {"enabled": True, "sources_disabled": ["tuboleta"]}

    class Broken(StubDB):
        @property
        def city_events_state(self) -> Any:  # type: ignore[override]
            raise RuntimeError("down")

    assert _flags(Broken())["enabled"] is False, "a read error is always disabled"
    monkeypatch.setenv("EVENTS_ELITE_ENABLED", "0")
    assert _flags(missing)["enabled"] is False
    monkeypatch.setenv("EVENTS_ELITE_ENABLED", "yes please")
    assert _flags(missing)["enabled"] is False


def test_history_cutover_is_read_from_env_at_call_time(monkeypatch: pytest.MonkeyPatch) -> None:
    hist = [{"role": "user", "content": "hola"},
            {"role": "assistant", "content": "vieja", "created_at": "2026-10-01T10:00:00Z"},
            {"role": "assistant", "content": "nueva", "created_at": "2026-10-03T10:00:00Z"}]
    assert [m["content"] for m in L.filter_history(hist)] == ["hola", "vieja", "nueva"]
    monkeypatch.setenv("EVENTS_ELITE_CUTOVER", "2026-10-02T00:00:00Z")
    assert [m["content"] for m in L.filter_history(hist)] == ["hola", "nueva"]
    monkeypatch.setenv("EVENTS_ELITE_CUTOVER", "garbage")
    assert [m["content"] for m in L.filter_history(hist)] == ["hola", "vieja", "nueva"]


def test_backend_vercel_crons_are_self_healing_and_keep_the_other_crons() -> None:
    cfg = json.load(open(os.path.join(BACKEND, "vercel.json"), encoding="utf-8"))
    crons = [(c["path"], c["schedule"]) for c in cfg["crons"]]
    assert ("/api/admin/events/pull", "*/10 * * * *") in crons
    assert ("/api/admin/events/sentinel", "*/15 * * * *") in crons
    assert ("/api/admin/events/reminders", "*/15 * * * *") in crons
    assert ("/api/admin/demand/refresh?days=30", "0 10 * * 1") in crons
    assert ("/api/admin/local-picks/refresh", "0 8 * * *") in crons
