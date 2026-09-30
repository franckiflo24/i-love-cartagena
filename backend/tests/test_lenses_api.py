"""LENSES routes: min_fill gate semantics, preview marking, port-day kit, crowd
freshness, cruise parser (docs/lenses/DESIGN.md §2/§3). Throwaway FastAPI app +
in-memory db, like test_cmw_program — server.py is never imported."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import lenses as L  # noqa: E402

DATA = json.loads((BACKEND / "data" / "lenses.json").read_text(encoding="utf-8"))
PARTNERS = json.loads((BACKEND.parent / "frontend" / "public" / "data" / "partners.json")
                      .read_text(encoding="utf-8"))
NOW = datetime.now(timezone.utc)


class _Cursor:
    def __init__(self, rows): self._rows = list(rows)
    def __aiter__(self): self._it = iter(self._rows); return self
    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration


class _Partners:
    def __init__(self, rows): self.rows = rows
    def find(self, q, proj=None):
        ids = set((q.get("partner_id") or {}).get("$in") or [])
        return _Cursor([dict(r) for r in self.rows if r.get("partner_id") in ids])


class _LensState:
    def __init__(self): self.doc = None
    async def find_one(self, q): return self.doc
    async def update_one(self, q, u, upsert=False): self.doc = dict(u["$set"])


class _DB:
    def __init__(self, partners): self.partners = _Partners(partners); self.lens_state = _LensState()


@pytest.fixture()
def client():
    L.init(_DB(PARTNERS))
    L._venue_cache.update(at=0.0, views={})
    app = FastAPI()
    app.include_router(L.router, prefix="/api")
    return TestClient(app)


def test_index_lists_all_lenses_never_their_content(client) -> None:
    r = client.get("/api/lenses")
    assert r.status_code == 200
    body = r.json()
    keys = {x["key"] for x in body["lenses"]}
    assert keys == {"golden_hour", "port_day", "step_free", "family", "women_verified"}
    for x in body["lenses"]:
        assert "pins" not in x and "venues" not in x and "luna" not in x
        assert set(x["fill"]) == {"high", "total", "min_fill"}
    assert body["sunset_by_month"]["9"] == "17:52"


def test_gated_lens_leaks_nothing_publicly(client) -> None:  # V2
    for key in ("women_verified", "family", "step_free"):
        body = client.get(f"/api/lenses/{key}").json()
        assert body["coming_soon"] is True and body["live"] is False
        assert "pins" not in body and "venues" not in body
    prev = client.get("/api/lenses/step_free?preview=1")
    assert prev.headers["cache-control"] == "no-store"
    b = prev.json()
    assert b["preview"] is True and b["coming_soon"] is True
    assert all(v["confidence"] == "VERIFY" for v in b["venues"])  # sin verificar stays


def test_live_lens_serves_resolved_pins(client) -> None:
    body = client.get("/api/lenses/golden_hour").json()
    assert body["live"] is True and "coming_soon" not in body
    pins = body["pins"]
    assert len(pins) >= 20
    by_id = {p["partner_id"]: p for p in PARTNERS}
    for p in pins:
        assert p["lat"] is not None and p["lng"] is not None, p["id"]
        assert p["access_tier"] in DATA["access_tiers"]
        for f in ("source_url", "source_name", "last_verified", "confidence"):
            assert p.get(f), (p["id"], f)
        if p.get("venue_id"):
            assert p["image_url"] == by_id[p["venue_id"]].get("image_url")
            assert p["link"].startswith(("/partner/", "/ciudad/"))
        else:
            assert p["image_url"] is None  # placeholder territory — never a scraped photo


def test_unknown_lens_404(client) -> None:
    assert client.get("/api/lenses/nope").status_code == 404


def test_port_day_kit_fares_come_from_the_city_module(client) -> None:
    body = client.get("/api/lenses/port_day").json()
    city = json.loads((BACKEND / "data" / "city_modules.json").read_text(encoding="utf-8"))
    taxis = next(m for m in city["modules"] if m["id"] == "taxis")
    assert [f["key"] for f in body["fares"]] == [f["key"] for f in taxis["facts"]]
    assert body["fare_link"] == "/ciudad/taxis"
    assert body["return_buffer_min"] == 90
    its = body["itineraries"]
    assert its and all(it["editorial"] for it in its)
    assert all(s["lat"] is not None for it in its for s in it["stops"])
    assert body["crowd_today"] is None  # no cache doc → badge hides


def test_crowd_served_only_when_fresh_today(client) -> None:
    today = NOW.astimezone(L.BOGOTA).date().isoformat()
    ok = {"_id": "cruise", "date": today, "ships": 3,
          "fetched_at": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"), "source_url": L.CRUISE_URL}
    L.db.lens_state.doc = dict(ok)
    assert client.get("/api/lenses/port_day").json()["crowd_today"] == {"date": today, "ships": 3}
    L.db.lens_state.doc = {**ok, "fetched_at": (NOW - timedelta(hours=27)).strftime("%Y-%m-%dT%H:%M:%SZ")}
    assert client.get("/api/lenses/port_day").json()["crowd_today"] is None  # stale → hide
    L.db.lens_state.doc = {**ok, "date": "2020-01-01"}
    assert client.get("/api/lenses/port_day").json()["crowd_today"] is None  # not today → hide
    L.db.lens_state.doc = {**ok, "ships": None}
    assert client.get("/api/lenses/port_day").json()["crowd_today"] is None  # parse failed → hide
    L.db.lens_state.doc = {**ok, "ships": 0}
    assert client.get("/api/lenses/port_day").json()["crowd_today"] == {"date": today, "ships": 0}


def test_cruise_pull_requires_bearer(client, monkeypatch) -> None:
    monkeypatch.setenv("CRON_SECRET", "s" * 32)
    assert client.get("/api/admin/lenses/cruise-pull").status_code == 401
    assert client.get("/api/admin/lenses/cruise-pull",
                      headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_cruise_pull_end_to_end_parses_and_stores(client, monkeypatch) -> None:
    """Regression for the FetchResult seam: fetch returns a DICT whose usable body is
    page['text'] with blocked_reason None — the pull must parse it and store the count
    (this exact seam shipped broken once: .text attr + inverted guard → always null)."""
    import types
    import lenses as L_
    today = NOW.astimezone(L_.BOGOTA).date()
    d = f"{today.day} {today.strftime('%B')}, {today.year}"
    page_html = _page(_day(d, 2))

    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False

    async def fake_fetch(client_, url, **kw):
        assert f"?month={today.strftime('%Y-%m')}" in url  # month pagination is required
        assert kw.get("url_guard") is not None
        return {"status": 200, "text": page_html, "blocked_reason": None, "challenged": False}

    fake_srcs = types.SimpleNamespace(make_client=lambda: _Client(), fetch=fake_fetch,
                                      public_url_guard=object())
    monkeypatch.setitem(sys.modules, "events_sources", fake_srcs)
    monkeypatch.setenv("CRON_SECRET", "s" * 32)
    r = client.post("/api/admin/lenses/cruise-pull", headers={"Authorization": "Bearer " + "s" * 32})
    assert r.status_code == 200 and r.json()["ships"] == 2
    assert L_.db.lens_state.doc["ships"] == 2 and L_.db.lens_state.doc["date"] == today.isoformat()
    # and a blocked page stores null (hide, never fake)
    async def blocked_fetch(client_, url, **kw):
        return {"status": 403, "text": "x", "blocked_reason": "challenge", "challenged": True}
    fake_srcs.fetch = blocked_fetch
    r2 = client.post("/api/admin/lenses/cruise-pull", headers={"Authorization": "Bearer " + "s" * 32})
    assert r2.status_code == 200 and r2.json()["ships"] is None
    assert L_.db.lens_state.doc["ships"] is None


def _day(d: str, ships: int) -> str:
    """One schedule day in the real CruiseMapper shape: a newDay marker row with
    the first ship, then plain rows for the rest of that day's ships."""
    rows = f'<tr class="newDay"><td><span>{d}</span></td>'
    for i in range(ships):
        sep = "" if i == 0 else "<tr>"
        rows += f'{sep}<td><a href="/ships/ship-{d[:6]}-{i}">Ship {i}</a></td><td>09:00</td></tr>'
    if ships == 0:
        rows += "</tr>"
    return rows


def _page(rows: str) -> str:
    return f"<html><table>{rows}</table></html>"


def test_cruise_parser_counts_today_zero_and_anomalies() -> None:
    today = datetime(2026, 9, 30, tzinfo=timezone.utc).date()
    page = _page(_day("29 September, 2026", 1) + _day("30 September, 2026", 3) + _day("1 October, 2026", 2))
    assert L.parse_cruise_ships(page, today) == 3
    assert L.parse_cruise_ships(_page(_day("30 Sep, 2026", 2)), today) == 2     # abbreviated month
    assert L.parse_cruise_ships(_page(_day("1 October, 2026", 2)), today) == 0  # honest quiet day
    assert L.parse_cruise_ships("<html>no ships here</html>", today) is None    # structure changed
    assert L.parse_cruise_ships(_page('<tr><td><a href="/ships/x">S</a></td></tr>'), today) is None  # no day markers
    assert L.parse_cruise_ships(_page(_day("30 September, 2026", 25)), today) is None  # sanity cap
