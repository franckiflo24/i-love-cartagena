"""EVENTS-ELITE routing + legacy surfaces through the FULL app router (DESIGN.md §8, §13 C/D/E/K,
§15 T/X), sliced from server.py — never imported (it opens Mongo and loads .env at import).

The app is rebuilt in server.py's own order: the events_elite router first, then EVERY
@api_router route in registration order. Event-related routes run their REAL handler source
(exec'd slices); every other route is a stub that echoes its path, so a route-order regression
(e.g. /events/feed swallowed by /events/{event_id}) is caught exactly as it would happen live.

Run: cd backend && python -m pytest -q tests/test_events_routes.py
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
import types
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

import httpx
import pytest
from fastapi import APIRouter, FastAPI, HTTPException, Request, Response
from fastapi.testclient import TestClient
from pydantic import BaseModel

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS = os.path.dirname(os.path.abspath(__file__))
for p in (BACKEND, TESTS):
    if p not in sys.path:
        sys.path.insert(0, p)

import events_elite as E  # noqa: E402
import events_gate as G  # noqa: E402
import events_runtime as R  # noqa: E402
import telegram_alerts as T  # noqa: E402
import webpush as W  # noqa: E402
from events_service_stubs import (StubDB, api_router_routes, server_block, server_span,  # noqa: E402
                                  server_src, with_event_indexes)
from events_time import filter_live, today_str, upcoming_query  # noqa: E402
from partner_visibility import (PARTNER_EVENT_PUBLIC, PUBLIC_EVENT_PROJECTION, PUBLIC_PARTNER_FILTER,  # noqa: E402
                                PUBLIC_PARTNER_PROJECTION)

UTC = timezone.utc
REAL_NOW = datetime.now(UTC)
LV = (REAL_NOW - timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
D1 = (REAL_NOW + timedelta(days=20)).astimezone(G.BOGOTA).date().isoformat()
D2 = (REAL_NOW + timedelta(days=30)).astimezone(G.BOGOTA).date().isoformat()
TB = "https://tuboleta.com/es/eventos/concierto-de-prueba"
EU = "https://www.eluniversal.com.co/cultural/concierto-de-prueba"
SRC = server_src()
REAL_TG_SEND = T.send          # captured before any fixture patches it


def _day_text(ymd: str) -> str:
    months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
              "noviembre", "diciembre"]
    y, m, d = map(int, ymd.split("-"))
    return f"{d} de {months[m - 1]} de {y} · 8:00 p. m."


def ev(event_id: str, *, start: str = D1, tier: int = 2, url: str = TB, visible: bool = True, category: str = "concert",
       **over: Any) -> Dict[str, Any]:
    d: Dict[str, Any] = {
        "event_id": event_id, "canonical_key": f"{event_id}|2026|v", "title": {"es": f"Concierto {event_id[-4:]}"},
        "description": {"es": "Una noche de música."}, "category": category, "edition_year": int(start[:4]),
        "start_date": start, "end_date": start, "start_time": "20:00", "end_time": None, "time_confirmed": True,
        "venue_name": "Teatro Adolfo Mejía", "address": None, "zone": "centro",
        "lat": 10.4266111, "lng": -75.5511837, "geocode_source": "gazetteer",
        "price": {"is_free": False, "min_cop": 80000, "max_cop": None, "text": None},
        "ticket_url": url, "source_url": url, "source_name": "TuBoleta", "source_tier": tier, "recheck_url": url,
        "source_keys": [f"t:{event_id}"],
        "evidence": [{"url": url, "name": "src", "tier": tier, "fetched_at": LV, "http_status": 200,
                      "date_text": _day_text(start), "date_visible": visible, "start_date": start,
                      "end_date": start, "start_time": "20:00"}],
        "last_verified": LV, "verified_by": "pipeline", "country_check": "pass", "country_signals": ["pass:t"],
        "status": "published", "status_reason": None, "confidence": "HIGH", "origin": "pipeline",
        "sold_out": False, "parent_id": None, "is_umbrella": False, "image_url": "/images/events/x.jpg",
    }
    d.update(over)
    return d


HIGH = "ce-concierto-alto-20261020-a1a1"
VERIFY = "ce-concierto-sin-confirmar-20261020-b2b2"
TBC = "ce-alumbrado-navideno-2026-202612tbc-c3c3"
HIDDEN = "ce-concierto-cancelado-20261020-d4d4"
UMBRELLA = "ce-fiestas-2026-20261020-e5e5"
FESTIVAL = "ce-festival-sin-geo-20261020-f6f6"


def seed_docs() -> List[Dict[str, Any]]:
    return [
        ev(HIGH, aliases=["ce-concierto-alto-viejo-20261020-0000"]),
        ev(VERIFY, tier=5, url=EU, source_name="El Universal"),
        ev(TBC, start=D2, category="cultural", status="date_tbc", start_date=None, end_date=None, start_time=None,
           tbc_window_end=D2, date_tbc_note={"es": "Diciembre 2026 · fecha por confirmar"},
           evidence=[{"url": TB, "tier": 2, "fetched_at": LV, "http_status": 200,
                      "date_text": "Alumbrado navideño 2026 · fecha por confirmar", "date_visible": True}]),
        ev(HIDDEN, status="hidden", status_reason="cancel_marker"),
        ev(UMBRELLA, start=D1, end_date=D2, category="festival", is_umbrella=True, lat=None, lng=None,
           geocode_source=None),
        ev(FESTIVAL, category="festival", lat=None, lng=None, geocode_source=None, venue_name="Varios escenarios"),
    ]


# ── the app: events_elite router, then every api_router route in server.py order ─────────


class Recorder:
    """Stands in for server.py's api_router while exec'ing slices: records (METHOD, path) → fn."""

    def __init__(self) -> None:
        self.routes: Dict[Tuple[str, str], Callable[..., Any]] = {}

    def _dec(self, method: str, path: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        def deco(fn: Callable[..., Any]) -> Callable[..., Any]:
            self.routes[(method, path)] = fn
            return fn
        return deco

    def get(self, path: str, **_k: Any) -> Any:
        return self._dec("GET", path)

    def post(self, path: str, **_k: Any) -> Any:
        return self._dec("POST", path)

    def put(self, path: str, **_k: Any) -> Any:
        return self._dec("PUT", path)

    def delete(self, path: str, **_k: Any) -> Any:
        return self._dec("DELETE", path)

    def patch(self, path: str, **_k: Any) -> Any:
        return self._dec("PATCH", path)


SLICES = [
    ("def _cache(response", None),
    ("# ── EVENTS-ELITE public feed", "# ── Venues"),
    ('@api_router.get("/partner-events")', "# ── Promotions"),
    ("# ── My Week", "# ── Event Types"),
    ('@api_router.get("/seasons")', "# ── FX (tasa de cambio del día)"),
    ("# ── Concerts (legacy shape", "# ── Favorites / Mi Agenda"),
    ("class FavoriteToggle(BaseModel):", '@api_router.post("/calendar")'),
    ('@api_router.delete("/auth/delete-account")', None),
    ('@api_router.post("/analytics/location")', None),
]


class Harness:
    def __init__(self, db: StubDB, *, user: Optional[Dict[str, Any]] = None, images: Tuple[str, ...] = ()) -> None:
        self.db = db
        self.user = user or {"user_id": "u1", "email": "u1@x.co", "my_week": []}
        self.images = set(images)
        rec = Recorder()

        async def get_current_user(request: Request) -> Dict[str, Any]:
            if request.headers.get("x-test-anon"):
                raise HTTPException(status_code=401, detail="Not authenticated")
            fresh = await db.users.find_one({"user_id": self.user["user_id"]}, {"_id": 0})
            return dict(fresh or self.user)

        async def require_admin(request: Request) -> Dict[str, Any]:
            u = await get_current_user(request)
            if not u.get("is_admin"):
                raise HTTPException(status_code=403, detail="Admin only")
            return u

        async def _check_rate_limit(*_a: Any, **_k: Any) -> None:
            return None

        async def _approved_partner_ids(pids: Any) -> set:
            ids = [p for p in set(pids or []) if p]
            return {p["partner_id"] async for p in db.partners.find({**PUBLIC_PARTNER_FILTER, "partner_id": {"$in": ids}})}

        self.ns: Dict[str, Any] = {
            "api_router": rec, "BaseModel": BaseModel, "HTTPException": HTTPException, "Request": Request,
            "Response": Response, "Optional": Optional, "db": db, "get_current_user": get_current_user,
            "require_admin": require_admin, "_check_rate_limit": _check_rate_limit, "_events_elite": E,
            "_events_runtime": R, "uuid": uuid, "datetime": datetime, "timezone": timezone,
            "logger": logging.getLogger("test"), "PUBLIC_PARTNER_FILTER": PUBLIC_PARTNER_FILTER,
            "PUBLIC_PARTNER_PROJECTION": PUBLIC_PARTNER_PROJECTION, "PUBLIC_EVENT_PROJECTION": PUBLIC_EVENT_PROJECTION,
            # server.py imports it from partner_visibility (shared with trips.py, §15 T4)
            "PARTNER_EVENT_PUBLIC": PARTNER_EVENT_PUBLIC,
            "upcoming_query": upcoming_query, "filter_live": filter_live, "_today_bogota": today_str,
            "_public_image_exists": lambda p: p in self.images, "_normalize_event_media": lambda evs, *a, **k: evs,
            "_approved_partner_ids": _approved_partner_ids, "_log_activity": _noop, "_client_ip": lambda r: "1.1.1.1",
        }
        parts = []
        for start, end in SLICES:
            parts.append(server_span(start, end, SRC) if end else server_block(start, SRC))
        exec(compile("\n\n".join(parts), "server.py[events-slices]", "exec"), self.ns)
        self.handlers = rec.routes

        E.init(db_=db, require_admin=require_admin)
        app = FastAPI()
        app.include_router(E.router, prefix="/api")          # mounted BEFORE api_router (§13 C2)
        full = APIRouter(prefix="/api")
        self.stubbed: List[Tuple[str, str]] = []
        for method, path, _off in api_router_routes(SRC):
            fn = self.handlers.get((method, path))
            if fn is None:
                fn = _stub(method, path)
                self.stubbed.append((method, path))
            full.add_api_route(path, fn, methods=[method])
        app.include_router(full)
        self.client = TestClient(app)


async def _noop(*_a: Any, **_k: Any) -> None:
    return None


def _stub(method: str, path: str) -> Callable[..., Any]:
    async def stub(request: Request) -> Dict[str, Any]:
        return {"stub": f"{method} {path}"}
    stub.__name__ = f"stub_{re.sub(r'[^a-z0-9]+', '_', (method + path).lower())}"
    return stub


def make_db(*, enabled: Optional[bool] = True, healthy: bool = True, docs: Optional[List[Dict[str, Any]]] = None,
            legacy: bool = True) -> StubDB:
    db = asyncio.run(with_event_indexes(StubDB()))

    async def seed() -> None:
        if enabled is not None:
            await db.city_events_state.insert_one({"_id": "flags", "enabled": enabled})
        if healthy:
            await db.city_events_runs.insert_one({"kind": "sentinel", "done": True,
                                                  "finished_at": (REAL_NOW - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")})
        for d in (docs if docs is not None else seed_docs()):
            await db.city_events.insert_one(d)
        if legacy:   # the fabricated legacy rows public paths must never read again
            await db.events.insert_one({"event_id": "evt_010", "title": "Jazz & Wine Night", "date": D1})
            await db.concerts.insert_one({"concert_id": "con_003", "artist": "Karol G", "date": D1, "genre": "Reggaeton"})
            await db.seasons.insert_one({"season_id": "season_001", "name": "Music Week", "start_date": D1,
                                         "end_date": D2, "event_count": 15, "is_active": True})
        await db.users.insert_one({"user_id": "u1", "email": "u1@x.co", "my_week": [HIGH, VERIFY, "evt_010"],
                                   "is_admin": False})

    asyncio.run(seed())
    db.accessed.clear()
    return db


@pytest.fixture(autouse=True)
def _reset(monkeypatch: pytest.MonkeyPatch) -> Dict[str, List[str]]:
    R.invalidate_caches()
    sent: Dict[str, List[str]] = {"alerts": []}

    async def fake_send(text: Any, **_k: Any) -> Dict[str, Any]:
        sent["alerts"].append(str(text))
        return {"configured": False, "sent": 0, "chats": 0, "errors": []}

    monkeypatch.setattr(T, "send", fake_send)
    monkeypatch.delenv("CRON_SECRET", raising=False)
    return sent


# ── route order (§13 C1) ─────────────────────────────────────────────────────


def test_feed_hits_the_feed_handler_through_the_full_router_not_get_event() -> None:
    h = Harness(make_db())
    r = h.client.get("/api/events/feed")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "generated_at" in body and "today" in body and "stub" not in body
    assert {e["event_id"] for e in body["events"]} == {HIGH, VERIFY, FESTIVAL, UMBRELLA}
    assert [e["event_id"] for e in body["date_tbc"]] == [TBC]
    assert "max-age=60" in r.headers["cache-control"] and "stale-while-revalidate=120" in r.headers["cache-control"]
    assert len(h.stubbed) > 100, "the table must be the FULL api_router route list"


def test_feed_routes_are_declared_above_get_event_in_server_py() -> None:
    order = [(m, p) for m, p, _ in api_router_routes(SRC)]
    i_get = order.index(("GET", "/events/{event_id}"))
    assert order.index(("GET", "/events/feed")) < i_get
    assert order.index(("GET", "/events/feed/item/{event_id}")) < i_get
    assert order.index(("GET", "/events/featured")) < i_get
    mount = SRC.index("app.include_router(_events_elite.router")
    assert mount < SRC.index("app.include_router(api_router)"), "events router mounts BEFORE api_router"


def test_reserved_ids_and_featured_never_reach_get_event_as_events() -> None:
    h = Harness(make_db())
    assert isinstance(h.client.get("/api/events/featured").json(), list)
    for rid in ("dates", "feed", "featured"):
        assert asyncio.run(E.legacy_event_item(h.db, rid)) is None
    assert h.client.get("/api/events/dates").status_code == 404


def test_feed_item_any_status_honest_nulls_and_aliases() -> None:
    h = Harness(make_db())
    hidden = h.client.get(f"/api/events/feed/item/{HIDDEN}").json()
    assert hidden["status"] == "hidden" and hidden["status_reason"] == "cancel_marker"
    assert hidden["start_date"] is None and hidden["ticket_url"] is None and hidden["start_time"] is None
    alias = h.client.get("/api/events/feed/item/ce-concierto-alto-viejo-20261020-0000").json()
    assert alias["event_id"] == HIGH and alias["confidence"] == "HIGH"
    assert h.client.get("/api/events/feed/item/evt_010").status_code == 404
    assert h.client.get("/api/events/feed/item/ce-no-existe-20261020-ffff").status_code == 404


def test_image_urls_only_when_the_manifest_ships_them() -> None:
    h = Harness(make_db(), images=("/images/events/x.jpg",))
    ev_ = next(e for e in h.client.get("/api/events/feed").json()["events"] if e["event_id"] == HIGH)
    assert ev_["image_url"] == "/images/events/x.jpg"
    h2 = Harness(make_db())
    ev2 = next(e for e in h2.client.get("/api/events/feed").json()["events"] if e["event_id"] == HIGH)
    assert ev2["image_url"] is None


# ── legacy endpoints (§13 D, §15 T1) ─────────────────────────────────────────

LEGACY_PATHS = ["/api/events", "/api/events/featured", "/api/events/dates/available", f"/api/events/{HIGH}",
                "/api/events/evt_010", "/api/concerts", "/api/concerts/dates", "/api/concerts/genres",
                f"/api/concerts/{HIGH}", "/api/concerts/con_003", "/api/seasons/s1/events", "/api/seasons",
                "/api/seasons/season_001", "/api/events/feed",
                f"/api/events/feed/item/{HIGH}", "/api/favorites", "/api/favorites/ids", "/api/my-week",
                "/api/calendar", "/api/partner-events"]


@pytest.mark.parametrize("enabled,healthy", [(True, True), (True, False), (False, True), (None, True)])
def test_public_event_paths_never_read_db_events_or_db_concerts(enabled: Optional[bool], healthy: bool) -> None:
    h = Harness(make_db(enabled=enabled, healthy=healthy))
    for path in LEGACY_PATHS:
        h.client.get(path)
    assert not h.db.touched("events"), [p for p in LEGACY_PATHS]
    assert not h.db.touched("concerts")
    assert not h.db.touched("seasons")


def test_legacy_events_serve_only_published_high_future_non_umbrella_rows_in_legacy_shape() -> None:
    h = Harness(make_db())
    rows = h.client.get("/api/events").json()
    assert [r["event_id"] for r in rows] == [HIGH, FESTIVAL] or sorted(r["event_id"] for r in rows) == sorted([HIGH, FESTIVAL])
    row = next(r for r in rows if r["event_id"] == HIGH)
    assert row["title"] == "Concierto a1a1" and row["confidence"] == "high" and row["category"] == "music"
    assert row["start_time"] == "20:00" and row["end_time"] == "" and row["price"] == 80000
    assert isinstance(row["is_free"], bool) and row["booking_link"].startswith("https://")
    assert "Fuente: TuBoleta" in row["description"] and row["source"] == [TB]
    assert "location" in row and "location" not in next(r for r in rows if r["event_id"] == FESTIVAL)
    assert h.client.get(f"/api/events/{VERIFY}").status_code == 404, "VERIFY never reaches an old binary"
    assert h.client.get(f"/api/events/{HIDDEN}").status_code == 404
    assert h.client.get(f"/api/events/{UMBRELLA}").status_code == 404
    assert h.client.get("/api/events/evt_010").status_code == 404
    assert h.client.get("/api/events/ce-concierto-alto-viejo-20261020-0000").json()["event_id"] == HIGH
    featured = h.client.get("/api/events/featured").json()
    assert {r["event_id"] for r in featured} == {HIGH, FESTIVAL}
    assert h.client.get("/api/events/dates/available").json() == [D1]
    assert [r["event_id"] for r in h.client.get(f"/api/events?date={D1}").json()] != []
    assert h.client.get("/api/events?venue_id=v_1").json() == []
    assert h.client.get("/api/seasons/s1/events").json() == []
    assert h.client.get("/api/seasons").json() == [], "§15 T5: the fabricated seasons are never served live"
    assert h.client.get("/api/seasons/season_001").status_code == 404


def test_legacy_concerts_come_from_city_events_only() -> None:
    h = Harness(make_db())
    rows = h.client.get("/api/concerts").json()
    assert [r["concert_id"] for r in rows] == [HIGH]
    assert rows[0]["ticket_link"].startswith("https://") and rows[0]["currency"] == "COP"
    assert h.client.get("/api/concerts/con_003").status_code == 404
    assert h.client.get(f"/api/concerts/{HIGH}").json()["concert_id"] == HIGH
    assert h.client.get("/api/concerts/genres").json() == ["Concierto"]
    assert h.client.get("/api/concerts/dates").json() == [D1]


def test_unhealthy_sentinel_empties_legacy_and_serves_the_feed_as_verify() -> None:
    h = Harness(make_db(healthy=False))
    assert h.client.get("/api/events").json() == []
    assert h.client.get("/api/concerts").json() == []
    assert h.client.get(f"/api/events/{HIGH}").status_code == 404
    feed = h.client.get("/api/events/feed").json()
    assert feed["events"] and all(e["confidence"] == "VERIFY" and not e["notif_eligible"] for e in feed["events"])


@pytest.mark.parametrize("enabled", [False, None])
def test_flags_missing_or_off_empty_every_event_surface(enabled: Optional[bool]) -> None:
    h = Harness(make_db(enabled=enabled))
    feed = h.client.get("/api/events/feed").json()
    assert feed["events"] == [] and feed["date_tbc"] == []
    assert h.client.get("/api/events").json() == []
    assert h.client.get("/api/concerts").json() == []
    assert h.client.get(f"/api/events/feed/item/{HIGH}").status_code == 404
    assert h.client.get(f"/api/events/{HIGH}").status_code == 404
    assert h.client.get("/api/my-week").json() == []


def test_flags_read_error_fails_closed() -> None:
    db = make_db()
    db.city_events_state.fail_reads = True
    h = Harness(db)
    assert h.client.get("/api/events/feed").json()["events"] == []


def test_old_binary_render_contract_for_every_legacy_row() -> None:
    """1.1.x price/booking logic: no NaN, no 'null', no free label on a paid or unknown event."""
    h = Harness(make_db())
    for r in h.client.get("/api/events").json() + h.client.get("/api/concerts").json():
        assert r.get("price") is None or isinstance(r["price"], int)
        assert r["start_time"] is not None and r["end_time"] is not None
        link = r.get("booking_link") or r.get("ticket_link")
        assert isinstance(link, str) and link.startswith(("http://", "https://")), "else old UI says 'Acceso libre'"
        if r.get("is_free"):
            assert not r.get("price")
        assert "null" not in json.dumps({k: v for k, v in r.items() if isinstance(v, str)})


# ── favorites / my-week / calendar (§15 T3, §13 D4) ──────────────────────────


def test_favorites_refuse_legacy_ids_and_accept_live_ce_ids() -> None:
    h = Harness(make_db())
    for body in ({"item_id": "evt_010", "item_type": "event"}, {"item_id": "con_003", "item_type": "concert"},
                 {"item_id": HIDDEN, "item_type": "event"}, {"item_id": "ce-no-existe-20261020-ffff", "item_type": "event"}):
        assert h.client.post("/api/favorites/toggle", json=body).status_code == 404, body
        assert h.client.post("/api/favorites/add", json=body).status_code == 404, body
    assert h.client.post("/api/favorites/add", json={"item_id": VERIFY, "item_type": "event"}).json()["status"] == "added"
    assert h.client.post("/api/favorites/add", json={"item_id": TBC, "item_type": "event"}).json()["status"] == "added"
    assert h.client.post("/api/favorites/add", json={"item_id": VERIFY, "item_type": "event"}).json()["status"] == "exists"
    assert h.client.post("/api/favorites/toggle", json={"item_id": VERIFY, "item_type": "event"}).json()["status"] == "removed"


def test_get_favorites_hydrates_legacy_ids_as_removed_and_hidden_rows_honestly() -> None:
    db = make_db()
    for iid in ("evt_010", HIDDEN, HIGH):
        asyncio.run(db.favorites.insert_one({"fav_id": f"f_{iid}", "user_id": "u1", "item_id": iid, "item_type": "event"}))
    asyncio.run(db.favorites.insert_one({"fav_id": "f_c", "user_id": "u1", "item_id": "con_003", "item_type": "concert"}))
    h = Harness(db)
    by_id = {f["item_id"]: f for f in h.client.get("/api/favorites").json()}
    assert by_id["evt_010"]["status"] == "removed" and by_id["con_003"]["status"] == "removed"
    assert by_id[HIDDEN]["status"] == "hidden" and by_id[HIDDEN]["start_date"] is None
    assert by_id[HIGH]["status"] == "published" and by_id[HIGH]["_fav_type"] == "event"
    assert "evidence" not in by_id[HIGH] and "canonical_key" not in by_id[HIGH]


def test_my_week_and_calendar_are_read_time_filtered_nothing_deleted() -> None:
    db = make_db()
    for iid, t in ((HIGH, "event"), ("evt_010", "event"), (HIDDEN, "event"), ("pe_1", "partner_event")):
        asyncio.run(db.user_calendar.insert_one({"user_id": "u1", "item_id": iid, "item_type": t, "date": "2020-01-01",
                                                 "title": "stale"}))
    h = Harness(db)
    week = h.client.get("/api/my-week").json()
    assert [r["event_id"] for r in week] == [HIGH], "legacy + VERIFY ids never reach old binaries"
    cal = h.client.get("/api/calendar").json()
    assert [c["item_id"] for c in cal] == [HIGH, "pe_1"]
    assert cal[0]["date"] == D1 and cal[0]["title"] == "Concierto a1a1", "live rows carry their current dates"
    assert len(db.user_calendar.rows) == 4 and db.users.rows[0]["my_week"] == [HIGH, VERIFY, "evt_010"]
    assert h.client.post("/api/my-week/toggle", json={"event_id": "evt_011"}).status_code == 404
    assert h.client.post("/api/my-week/toggle", json={"event_id": "evt_010"}).json()["action"] == "removed"


# ── privacy (§15 T6, U) ──────────────────────────────────────────────────────


def test_analytics_location_is_204_and_stores_nothing() -> None:
    h = Harness(make_db())
    for headers in ({}, {"x-test-anon": "1"}):
        r = h.client.post("/api/analytics/location", json={"lat": 10.42, "lng": -75.55, "zone": "centro"}, headers=headers)
        assert r.status_code == 204 and r.content == b""
    r = h.client.post("/api/analytics/location", content=b"not json")
    assert r.status_code == 204
    assert h.db.location_pings.rows == [] and not h.db.touched("location_pings")


def test_agent_chat_and_taste_pass_location_per_turn_and_history_timestamps() -> None:
    """§13 I3: body.location reaches run_agent_turn for THIS turn only (never persisted to
    chat_sessions); §15 V3: history carries created_at so luna_events.filter_history keeps the
    assistant turns written after the cutover and drops the older ones."""
    import luna_events as L

    db = StubDB()
    calls: List[Dict[str, Any]] = []
    appended: List[Dict[str, Any]] = []
    before = "2026-09-20T12:00:00+00:00"                      # pre-cutover (legacy-era) reply
    after = (REAL_NOW - timedelta(minutes=5)).isoformat()      # post-cutover reply

    async def get_or_create_session(_db: Any, user_id: str, session_id: Any) -> Dict[str, Any]:
        return {"session_id": "cs_1", "title": "Nuevo chat", "messages": [
            {"role": "user", "content": "hola", "created_at": before},
            {"role": "assistant", "content": "Jazz & Wine Night el jueves", "created_at": before},
            {"role": "user", "content": "¿y hoy?", "created_at": after},
            {"role": "assistant", "content": "Hoy no hay eventos confirmados.", "created_at": after},
        ]}

    async def run_agent_turn(_db: Any, **kw: Any) -> Dict[str, Any]:
        calls.append(kw)
        return {"message": "ok", "language": "es", "actions": [{"type": "navigate", "screen": "agenda"}]}

    async def append_messages(_db: Any, _sid: str, *msgs: Dict[str, Any]) -> None:
        appended.extend(msgs)

    async def get_current_user(_r: Request) -> Dict[str, Any]:
        return {"user_id": "u1"}

    async def _none(*_a: Any, **_k: Any) -> None:
        return None

    async def build_taste(*_a: Any, **_k: Any) -> Dict[str, Any]:
        return {}

    rec = Recorder()
    ns: Dict[str, Any] = {
        "api_router": rec, "Request": Request, "HTTPException": HTTPException, "datetime": datetime,
        "timezone": timezone, "db": db, "logger": logging.getLogger("test"), "get_current_user": get_current_user,
        "_check_rate_limit": _none, "_maybe_qr_stats_reply": _none, "_client_ip": lambda r: "1.1.1.1",
        "_LUNA_TASTE_DAILY_CAP": 100, "_taste": types.SimpleNamespace(build_taste=build_taste),
        "_ai_agent": types.SimpleNamespace(get_or_create_session=get_or_create_session,
                                           run_agent_turn=run_agent_turn, append_messages=append_messages),
    }
    src = "\n\n".join(server_block(a, SRC) for a in ('@api_router.post("/agent/taste")',
                                                     '@api_router.post("/agent/chat")'))
    exec(compile(src, "server.py[agent-slices]", "exec"), ns)
    app = FastAPI()
    for (method, path), fn in rec.routes.items():
        app.add_api_route("/api" + path, fn, methods=[method])
    client = TestClient(app)

    loc = {"lat": 10.4236, "lng": -75.5510}
    r = client.post("/api/agent/chat", json={"message": "¿eventos cerca de mí?", "location": loc})
    assert r.status_code == 200, r.text
    kw = calls[-1]
    assert kw["location"] == loc
    assert all("created_at" in m for m in kw["history"]), "history must carry created_at for the V3 cutover"
    kept = L.filter_history(kw["history"])
    assert [m["content"] for m in kept if m["role"] == "assistant"] == ["Hoy no hay eventos confirmados."]
    assert "Jazz & Wine Night el jueves" not in json.dumps(kept), "pre-cutover assistant replies never reach the LLM"
    assert appended and "10.4236" not in json.dumps(appended) and all("location" not in m for m in appended), \
        "the chat session never stores the location"
    client.post("/api/agent/chat", json={"message": "hola", "location": "10.4,-75.5"})
    assert calls[-1]["location"] is None, "only a {lat, lng} object is passed through"

    t = client.post("/api/agent/taste", json={"message": "¿qué eventos hay hoy?", "location": loc})
    assert t.status_code == 200 and calls[-1]["location"] == loc and calls[-1]["history"] == []
    assert t.json()["assistant"]["actions"] == [{"type": "navigate", "screen": "agenda"}]


def test_delete_account_purges_reminder_state_and_owner_keyed_push_tokens() -> None:
    db = make_db()
    uid = "u1"

    async def seed() -> None:
        await db.push_tokens.insert_one({"owner_type": "user", "owner_id": uid, "token": "ExponentPushToken[a]"})
        await db.push_tokens.insert_one({"owner_type": "partner", "owner_id": uid, "token": "ExponentPushToken[b]"})
        await db.push_subscriptions.insert_one({"user_id": uid, "endpoint": "https://push/1"})
        for coll in ("event_notif_prefs", "event_push_log", "event_reminders_sent", "favorites"):
            await getattr(db, coll).insert_one({"user_id": uid, "x": 1})

    asyncio.run(seed())
    h = Harness(db)
    assert h.client.delete("/api/auth/delete-account").json()["ok"] is True
    assert [t["owner_type"] for t in db.push_tokens.rows] == ["partner"]
    for coll in ("push_subscriptions", "event_notif_prefs", "event_push_log", "event_reminders_sent", "favorites"):
        assert getattr(db, coll).rows == [], coll


def test_event_notif_prefs_defaults_and_validation() -> None:
    h = Harness(make_db())
    assert h.client.get("/api/me/event-notif-prefs").json() == {
        "reminders_enabled": True, "nearby_enabled": False, "categories": list(G.CATEGORIES), "lang": "es"}
    r = h.client.put("/api/me/event-notif-prefs", json={"reminders_enabled": False, "lang": "fr",
                                                        "categories": ["concert", "bogus"], "lat": 10.4})
    assert r.status_code == 200 and r.json()["reminders_enabled"] is False and r.json()["categories"] == ["concert"]
    stored = h.db.event_notif_prefs.rows[0]
    assert "lat" not in stored and stored["lang"] == "fr", "no location is ever stored"
    assert h.client.put("/api/me/event-notif-prefs", json={"lang": "de"}).status_code == 400
    assert h.client.put("/api/me/event-notif-prefs", json={"reminders_enabled": "yes"}).status_code == 400


# ── partner surfaces (§15 T4) ────────────────────────────────────────────────


def test_partner_events_require_explicit_approval_and_no_publish_first_migration() -> None:
    db = make_db()

    async def seed() -> None:
        await db.partners.insert_one({"partner_id": "ptr_1", "name": "Bar"})
        base = {"partner_id": "ptr_1", "date": D1, "start_time": "20:00", "is_published": True, "title": "x"}
        await db.partner_events.insert_one({**base, "event_id": "pe_ok", "moderation_status": "approved"})
        await db.partner_events.insert_one({**base, "event_id": "pe_pending", "moderation_status": "pending"})
        await db.partner_events.insert_one({**base, "event_id": "pe_nostatus"})
        await db.partner_events.insert_one({**base, "event_id": "pe_past", "moderation_status": "approved",
                                            "date": "2020-01-01"})

    asyncio.run(seed())
    h = Harness(db)
    assert [e["event_id"] for e in h.client.get("/api/partner-events").json()] == ["pe_ok"]
    assert h.client.get("/api/partner-events/pe_pending").status_code == 404
    assert h.client.get("/api/partner-events/pe_past").status_code == 404
    assert h.client.get("/api/partner-events/pe_ok").status_code == 200
    assert "_migrate_stuck_pending_events" not in SRC
    assert 'is_published = (verdict == "AUTO_APPROVE")' in SRC
    assert '(verdict != "REJECT")' not in SRC


# ── admin / cron auth (§15 X1/X2) and flags (§13 E1, §15 T1) ────────────────


def test_cron_routes_require_the_cron_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CRON_SECRET", "s3cret")
    h = Harness(make_db(enabled=False))
    assert h.client.get("/api/admin/events/reminders").status_code in (401, 403)
    assert h.client.get("/api/admin/events/reminders", headers={"Authorization": "Bearer nope"}).status_code in (401, 403)
    r = h.client.get("/api/admin/events/reminders", headers={"Authorization": "Bearer s3cret"})
    assert r.status_code == 200 and r.json()["refused"] == "disabled"


def test_cron_routes_refuse_admin_sessions_even_through_the_mutation_check(monkeypatch: pytest.MonkeyPatch) -> None:
    """§15 X1: cron routes accept ONLY the cron secret — an admin Bearer session or the
    cookie + allowlisted Origin + X-AMO-Admin path (valid for admin mutations) never starts a run."""
    monkeypatch.setenv("CRON_SECRET", "s3cret")
    db = make_db(enabled=False)

    async def seed() -> None:
        await db.users.insert_one({"user_id": "adm", "is_admin": True})
        await db.user_sessions.insert_one({"session_token": "st_adm", "user_id": "adm",
                                           "expires_at": REAL_NOW + timedelta(days=1)})

    asyncio.run(seed())
    h = Harness(db, user={"user_id": "adm"})
    h.client.cookies.set("session_token", "st_adm")
    for path in ("pull", "enrich", "sentinel", "reminders"):
        url = f"/api/admin/events/{path}?dry=0"
        assert h.client.get(url, headers={"Authorization": "Bearer st_adm"}).status_code == 403, path
        assert h.client.post(url, headers={"Origin": "https://www.amocartagena.co",
                                           "X-AMO-Admin": "1"}).status_code == 401, path
    h.client.cookies.clear()
    assert len(db.city_events_runs.rows) == 1, "only the seeded health row: no run was started"
    assert db.city_events_state.rows == [r for r in db.city_events_state.rows if r["_id"] == "flags"], \
        "no cursor was claimed"


def test_admin_mutations_need_bearer_session_or_cookie_origin_and_header(monkeypatch: pytest.MonkeyPatch) -> None:
    db = make_db()

    async def seed() -> None:
        await db.users.insert_one({"user_id": "adm", "is_admin": True})
        await db.user_sessions.insert_one({"session_token": "st_adm", "user_id": "adm",
                                           "expires_at": REAL_NOW + timedelta(days=1)})

    asyncio.run(seed())
    h = Harness(db, user={"user_id": "adm"})
    body = {"enabled": False}
    assert h.client.patch("/api/admin/events/flags", json=body, cookies={"session_token": "st_adm"}).status_code == 403
    assert h.client.patch("/api/admin/events/flags", json=body, cookies={"session_token": "st_adm"},
                          headers={"Origin": "https://evil.example", "X-AMO-Admin": "1"}).status_code == 403
    ok = h.client.patch("/api/admin/events/flags", json=body, cookies={"session_token": "st_adm"},
                        headers={"Origin": "https://www.amocartagena.co", "X-AMO-Admin": "1"})
    assert ok.status_code == 200 and ok.json()["flags"]["enabled"] is False
    r = h.client.post("/api/admin/events/flags", json={"enabled": True}, headers={"Authorization": "Bearer st_adm"})
    assert r.status_code == 200 and r.json()["flags"] == {"enabled": True, "sources_disabled": []}
    assert h.client.post("/api/admin/events/flags", json={"legacy_hidden": True},
                         headers={"Authorization": "Bearer st_adm"}).status_code == 400
    assert h.client.post("/api/admin/events/flags", json={"sources_disabled": ["nope"]},
                         headers={"Authorization": "Bearer st_adm"}).status_code == 400
    r = h.client.post("/api/admin/events/flags", json={"sources_disabled": ["tuboleta"]},
                      headers={"Authorization": "Bearer st_adm"})
    assert r.json()["flags"] == {"enabled": True, "sources_disabled": ["tuboleta"]}, "PATCH keeps the other keys"
    assert h.client.post("/api/admin/events/flags", json={"enabled": True},
                         headers={"Authorization": "Bearer st_other"}).status_code == 401


def test_gate_check_refuses_private_and_non_http_urls() -> None:
    db = make_db()
    asyncio.run(db.users.update_one({"user_id": "u1"}, {"$set": {"is_admin": True}}))
    h = Harness(db)
    for url in ("http://127.0.0.1/admin", "http://10.0.0.5/", "file:///etc/passwd", "http://[::1]/",
                "https://tuboleta.com:8443/x"):
        r = h.client.get("/api/admin/events/gate-check", params={"url": url})
        assert r.status_code == 400, (url, r.text)


def test_approve_never_overrides_country_fail_or_aggregator_only() -> None:
    db = make_db(docs=[ev(HIGH, country_check="fail", status="hidden", status_reason="country_fail"),
                       ev(VERIFY, tier=6, url="https://cartagenaplay.com/event/x", status="review",
                          status_reason="aggregator_only")])
    for eid in (HIGH, VERIFY):
        with pytest.raises(HTTPException) as ei:
            asyncio.run(E.approve_event(db, eid, actor="admin:t"))
        assert ei.value.status_code == 409


# ── ops wiring: startup, crons, retired scheduler, static dump ───────────────


def test_startup_drops_the_scheduler_and_guards_dev_seeds(monkeypatch: pytest.MonkeyPatch) -> None:
    assert "start_reminder_scheduler" not in SRC and "stop_reminder_scheduler" not in SRC
    startup = SRC[SRC.index("async def startup():"):SRC.index('@app.on_event("shutdown")')]
    assert "ensure_events_indexes" in startup
    assert re.search(r"if _events_elite\.dev_seed_allowed\(\):\n\s+await seed_database\(\)", startup)
    assert re.search(r"if _events_elite\.dev_seed_allowed\(\):\n(?:.*\n){0,3}\s+await seed_concerts\(\)", startup)
    # the Ruta Musical itinerary seed (fabricated evt_0xx stops) is a dev seed too
    assert re.search(r'find_one\(\{"itinerary_id": "itn_004"\}\) if _events_elite\.dev_seed_allowed\(\) else True',
                     startup)
    monkeypatch.setenv("ALLOW_DEV_SEED", "1")
    monkeypatch.setenv("MONGO_URL", "mongodb+srv://x:y@cluster0.i4uvhfv.mongodb.net/")
    assert E.dev_seed_allowed() is False
    monkeypatch.setenv("MONGO_URL", "mongodb://localhost:27017")
    assert E.dev_seed_allowed() is True
    monkeypatch.delenv("ALLOW_DEV_SEED")
    assert E.dev_seed_allowed() is False


def test_reminders_module_can_no_longer_push() -> None:
    src = open(os.path.join(BACKEND, "reminders.py"), encoding="utf-8").read()
    assert "def " not in src and "push_to_user" not in src.split('"""')[-1]


def test_vercel_crons() -> None:
    cfg = json.load(open(os.path.join(BACKEND, "vercel.json"), encoding="utf-8"))
    crons = {(c["path"], c["schedule"]) for c in cfg["crons"]}
    # §16.4 self-healing schedule: pull */10 (cheap no-op once the day's pass is done), sentinel
    # */15 (sentinel_due_slot picks main / today / nothing), reminders */15.
    assert ("/api/admin/events/pull", "*/10 * * * *") in crons
    assert ("/api/admin/events/sentinel", "*/15 * * * *") in crons
    assert ("/api/admin/events/reminders", "*/15 * * * *") in crons
    assert not any(p.startswith("/api/admin/events/sentinel?") for p, _s in crons), "one sentinel cron (auto slot)"
    assert len(cfg["crons"]) == 5
    assert ("/api/admin/demand/refresh?days=30", "0 10 * * 1") in crons, "existing crons kept"
    assert ("/api/admin/local-picks/refresh", "0 8 * * *") in crons


def test_dump_static_never_writes_events_concerts_or_seasons_data() -> None:
    src = open(os.path.join(BACKEND, "scripts", "dump_static.py"), encoding="utf-8").read()
    body = src.split('"""', 2)[2]          # past the module docstring (it narrates the old behaviour)
    code = "\n".join(line for line in body.splitlines() if not line.strip().startswith("#"))
    for bad in ("db.events", "db.concerts", "db.seasons", 'write("events', 'write("concerts'):
        assert bad not in code, bad
    assert 'write("seasons", [])' in code and 'write("calendar", [])' in code


# ── webpush scopes + telegram hygiene ────────────────────────────────────────


def test_webpush_scopes_and_send_to_subscriptions_writes_no_push_log(monkeypatch: pytest.MonkeyPatch) -> None:
    assert W.parse_scopes(None) == ["passport"]
    assert W.parse_scopes(["events", "bogus", "events"]) == ["events"]
    assert W.scope_query("u", "events") == {"user_id": "u", "scopes": "events"}
    db = StubDB()

    async def seed() -> None:
        await db.push_subscriptions.insert_one({"user_id": "u", "endpoint": "https://p/old", "keys": {"a": 1}})
        await db.push_subscriptions.insert_one({"user_id": "u", "endpoint": "https://p/ev", "keys": {"a": 1},
                                                "scopes": ["passport", "events"]})

    asyncio.run(seed())
    sent: List[str] = []
    fake = types.ModuleType("pywebpush")

    class WebPushException(Exception):
        pass

    def webpush(subscription_info: Dict[str, Any], **_k: Any) -> None:
        sent.append(subscription_info["endpoint"])

    fake.webpush = webpush  # type: ignore[attr-defined]
    fake.WebPushException = WebPushException  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "pywebpush", fake)
    monkeypatch.setattr(W, "VAPID_PRIVATE", "k")
    monkeypatch.setattr(W, "VAPID_PUBLIC", "k")
    out = asyncio.run(W.send_to_subscriptions(db, "u", "t", "b", "/event/x", scope="events"))
    assert out["sent"] == 1 and sent == ["https://p/ev"], "only subscriptions that consented to 'events'"
    assert db.push_log.rows == [], "event reminders never consume the passport push_log cap"


def test_telegram_never_raises_and_never_logs_the_token(monkeypatch: pytest.MonkeyPatch,
                                                         caplog: pytest.LogCaptureFixture) -> None:
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:SECRET")
    monkeypatch.setenv("TELEGRAM_ALERT_CHAT_IDS", "42")
    T.reset_budget()

    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"cannot reach {request.url}")

    with caplog.at_level(logging.INFO):
        out = asyncio.run(REAL_TG_SEND("hola", transport=httpx.MockTransport(boom)))
    assert out["configured"] is True and out["sent"] == 0 and out["errors"] == ["ConnectError"]
    assert "SECRET" not in caplog.text and "api.telegram.org" not in caplog.text
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN")
    assert asyncio.run(REAL_TG_SEND("sin token"))["configured"] is False


# ── verifier fixes: /favorites/ids and legacy cache headers ──────────────────────────────────


def test_favorite_ids_never_count_legacy_event_or_concert_ids() -> None:
    db = make_db()
    for iid, t in (("evt_010", "event"), ("con_003", "concert"), ("hay-festival-cartagena-2027", "event"),
                   (HIGH, "event"), ("ptr_x", "venue")):
        asyncio.run(db.favorites.insert_one({"fav_id": f"f_{iid}", "user_id": "u1", "item_id": iid, "item_type": t}))
    ids = {f["item_id"] for f in Harness(db).client.get("/api/favorites/ids").json()}
    assert ids == {HIGH, "ptr_x"}


def test_legacy_event_endpoints_use_the_feed_cache_window() -> None:
    h = Harness(make_db())
    for path in ("/api/events", "/api/events/featured", "/api/events/dates/available", f"/api/events/{HIGH}",
                 "/api/concerts", "/api/concerts/dates", "/api/concerts/genres"):
        r = h.client.get(path)
        assert r.status_code == 200, path
        assert "stale-while-revalidate=120" in r.headers["cache-control"], (path, r.headers["cache-control"])
