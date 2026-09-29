"""EVENTS-ELITE reminders (DESIGN.md §7, §13 H, §15 U): stub DB, fake recheck, fake push senders.

Exact §15 U order: public_view notif-eligible + verified today + timed → live recheck (Success
only, else suppress + log + alert) → per user: skip missing/deleted → unique claim → daily cap
(dup → delete claim) → send (Expo data {kind:'event_reminder', event_id} + web push scope
'events') → state 'sent', or delete both rows when no channel succeeded. Timing: first tick in
[start−180, start−30] ∩ [09:00, 21:00] Bogotá. Plus favorites/add with a ce- id through the
REAL server.py handler slice. Pure: no network, no Atlas, never imports server.py.

Run: cd backend && python -m pytest -q tests/test_events_reminders.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import pytest
from fastapi import APIRouter, FastAPI, HTTPException, Request
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
from events_service_stubs import StubDB, server_span, with_event_indexes  # noqa: E402
from partner_visibility import PUBLIC_PARTNER_FILTER  # noqa: E402

UTC = timezone.utc
# Thu 12 Nov 2026, 16:30 Bogotá — a 19:00 event is 150 min away (inside [−180, −30]).
NOW = datetime(2026, 11, 12, 21, 30, tzinfo=UTC)
LV_TODAY = "2026-11-12T13:00:00Z"             # 08:00 Bogotá, today
LV_YESTERDAY = "2026-11-11T22:00:00Z"         # 17:00 Bogotá yesterday (still < 72 h: HIGH, but not today)
TB = "https://tuboleta.com/es/eventos/salsa-a-la-plaza"
EID = "ce-salsa-a-la-plaza-20261112-5a1a"
PLAZA = (10.4225, -75.5497)


def ev_doc(event_id: str = EID, **over: Any) -> Dict[str, Any]:
    d: Dict[str, Any] = {
        "event_id": event_id, "canonical_key": f"salsa a la plaza|2026|plaza de la aduana|{event_id}",
        "title": {"es": "Salsa a la Plaza", "en": "Salsa at the Plaza"}, "description": {}, "category": "concert",
        "edition_year": 2026, "start_date": "2026-11-12", "end_date": "2026-11-12", "start_time": "19:00",
        "end_time": None, "time_confirmed": True, "venue_name": "Plaza de la Aduana", "address": None,
        "zone": "centro", "lat": PLAZA[0], "lng": PLAZA[1], "geocode_source": "gazetteer",
        "price": {"is_free": True, "min_cop": None, "max_cop": None, "text": "Entrada libre"},
        "ticket_url": None, "source_url": TB, "source_name": "TuBoleta", "source_tier": 2,
        "recheck_url": TB, "source_keys": [f"test:{event_id}"],
        "evidence": [{"url": TB, "name": "TuBoleta", "tier": 2, "fetched_at": LV_TODAY, "http_status": 200,
                      "date_text": "Jueves 12 de noviembre de 2026 · 7:00 p. m.", "date_visible": True,
                      "start_date": "2026-11-12", "end_date": "2026-11-12", "start_time": "19:00"}],
        "last_verified": LV_TODAY, "verified_by": "pipeline", "country_check": "pass", "country_signals": ["pass:t"],
        "status": "published", "status_reason": None, "confidence": "HIGH", "notif_eligible": True,
        "origin": "pipeline", "sold_out": False, "parent_id": None, "is_umbrella": False,
        "blocked_days": 0, "not_found_count": 0, "gone_strikes": 0,
    }
    d.update(over)
    return d


class FakeClient:
    async def aclose(self) -> None:
        return None


class Recheck:
    def __init__(self, outcome: str = "success") -> None:
        self.outcome = outcome
        self.calls: List[str] = []

    async def __call__(self, client: Any, doc: Dict[str, Any], *, sched: Any = None, cache: Any = None,
                       now_utc: Any = None, disabled: Any = ()) -> Dict[str, Any]:
        self.calls.append(str(doc.get("event_id")))
        return {"outcome": self.outcome, "marker": None if self.outcome == "success" else "http_403"}


class Senders:
    def __init__(self, expo_sent: int = 1, web_sent: int = 1) -> None:
        self.expo: List[Tuple[str, str, str, Dict[str, Any]]] = []
        self.web: List[Tuple[str, str, str, str, str]] = []
        self.expo_sent = expo_sent
        self.web_sent = web_sent

    async def push(self, db: Any, uid: str, title: str, body: str, data: Dict[str, Any]) -> Dict[str, Any]:
        self.expo.append((uid, title, body, dict(data)))
        return {"sent": self.expo_sent}

    async def webpush(self, db: Any, uid: str, title: str, body: str, url: str, scope: str) -> Dict[str, Any]:
        self.web.append((uid, title, body, url, scope))
        return {"sent": self.web_sent}


@pytest.fixture(autouse=True)
def _reset(monkeypatch: pytest.MonkeyPatch) -> Dict[str, List[str]]:
    R.invalidate_caches()
    sent: Dict[str, List[str]] = {"alerts": []}

    async def fake_send(text: Any, **_k: Any) -> Dict[str, Any]:
        sent["alerts"].append(str(text))
        return {"configured": False, "sent": 0, "chats": 0, "errors": []}

    monkeypatch.setattr(T, "send", fake_send)
    return sent


def make_db(*docs: Dict[str, Any], users: Tuple[str, ...] = ("u1",), favs: Optional[List[Tuple[str, str]]] = None,
            enabled: bool = True, healthy: bool = True) -> StubDB:
    db = asyncio.run(with_event_indexes(StubDB()))

    async def seed() -> None:
        if enabled is not None:
            await db.city_events_state.insert_one({"_id": "flags", "enabled": enabled})
        if healthy:
            await db.city_events_runs.insert_one({"kind": "sentinel", "done": True,
                                                  "finished_at": (NOW - timedelta(hours=5)).strftime("%Y-%m-%dT%H:%M:%SZ")})
        for d in docs:
            await db.city_events.insert_one(d)
        for u in users:
            await db.users.insert_one({"user_id": u, "email": f"{u}@x.co"})
        for uid, eid in (favs if favs is not None else [(u, EID) for u in users]):
            await db.favorites.insert_one({"fav_id": f"fav_{uid}_{eid}", "user_id": uid, "item_id": eid,
                                           "item_type": "event"})

    asyncio.run(seed())
    return db


def run(db: StubDB, *, now: datetime = NOW, recheck: Optional[Recheck] = None, senders: Optional[Senders] = None,
        dry: bool = False) -> Tuple[Dict[str, Any], Senders, Recheck]:
    rc = recheck or Recheck()
    s = senders or Senders()
    out = asyncio.run(E.run_reminders(db, now=now, dry=dry, recheck_fn=rc, client_factory=FakeClient,
                                      push_fn=s.push, webpush_fn=s.webpush))
    return out, s, rc


# ── the happy path + payload ─────────────────────────────────────────────────


def test_sends_expo_and_web_with_kind_event_reminder_payload_and_inbox_row() -> None:
    db = make_db(ev_doc())
    out, s, rc = run(db)
    assert out["sent"] == 1 and rc.calls == [EID]
    uid, title, body, data = s.expo[0]
    assert (uid, data) == ("u1", {"kind": "event_reminder", "event_id": EID})
    assert title == "Salsa a la Plaza"
    assert "Hoy a las 19:00" in body and "Plaza de la Aduana" in body and body.endswith("Fuente: TuBoleta")
    assert len(title) <= 120 and len(body) <= 240
    wuid, wtitle, wbody, url, scope = s.web[0]
    assert (wuid, url, scope) == ("u1", f"/event/{EID}", "events")
    assert len(wtitle) <= 80 and len(wbody) <= 160 and "Fuente: TuBoleta" in wbody
    claim = db.event_reminders_sent.rows[0]
    assert (claim["user_id"], claim["event_id"], claim["state"]) == ("u1", EID, "sent")
    assert db.event_push_log.rows[0]["date"] == "2026-11-12"
    inbox = db.notifications.rows[0]
    assert inbox["user_id"] == "u1" and inbox["type"] == "event_reminder"
    assert inbox["ref"] == {"event_id": EID} and inbox["read"] is False


def test_language_follows_event_notif_prefs() -> None:
    db = make_db(ev_doc())
    asyncio.run(db.event_notif_prefs.insert_one({"user_id": "u1", "lang": "en", "reminders_enabled": True}))
    _, s, _ = run(db)
    _, title, body, _ = s.expo[0]
    assert title == "Salsa at the Plaza" and "Today at 19:00" in body and body.endswith("Source: TuBoleta")


def test_dedupe_second_tick_never_resends() -> None:
    db = make_db(ev_doc())
    run(db)
    out, s, _ = run(db, now=NOW + timedelta(minutes=15))
    assert out["sent"] == 0 and s.expo == [] and out["skipped"].get("already_sent") == 1


def test_one_event_push_per_user_per_day() -> None:
    other = ev_doc("ce-otro-concierto-20261112-0b0b", canonical_key="otro|2026|plaza", source_keys=["test:o"],
                   start_time="18:30",
                   evidence=[{"url": TB + "-2", "name": "TuBoleta", "tier": 2, "fetched_at": LV_TODAY,
                              "http_status": 200, "date_text": "Jueves 12 de noviembre de 2026 · 6:30 p. m.",
                              "date_visible": True, "start_date": "2026-11-12", "end_date": "2026-11-12",
                              "start_time": "18:30"}], source_url=TB + "-2", recheck_url=TB + "-2")
    db = make_db(ev_doc(), other, favs=[("u1", EID), ("u1", "ce-otro-concierto-20261112-0b0b")])
    out, s, _ = run(db)
    assert out["sent"] == 1 and len(s.expo) == 1
    assert out["skipped"].get("daily_cap") == 1
    assert len(db.event_reminders_sent.rows) == 1, "the losing claim is deleted when the daily cap is hit"


def test_claim_race_existing_claim_is_skipped() -> None:
    db = make_db(ev_doc())
    asyncio.run(db.event_reminders_sent.insert_one({"user_id": "u1", "event_id": EID, "state": "claimed"}))
    out, s, _ = run(db)
    assert out["sent"] == 0 and s.expo == [] and out["skipped"].get("already_sent") == 1
    assert db.event_push_log.rows == []


def test_no_channel_deletes_both_rows_so_a_later_tick_can_retry() -> None:
    db = make_db(ev_doc())
    out, _, _ = run(db, senders=Senders(expo_sent=0, web_sent=0))
    assert out["sent"] == 0 and out["skipped"].get("no_channel") == 1
    assert db.event_reminders_sent.rows == [] and db.event_push_log.rows == [] and db.notifications.rows == []


def test_web_only_channel_counts_as_delivered() -> None:
    db = make_db(ev_doc())
    out, _, _ = run(db, senders=Senders(expo_sent=0, web_sent=1))
    assert out["sent"] == 1 and db.event_reminders_sent.rows[0]["state"] == "sent"


# ── suppression / eligibility ────────────────────────────────────────────────


def test_suppressed_when_the_live_recheck_is_not_success(_reset: Any) -> None:
    for outcome in ("blocked", "not_found", "date_changed", "gone", "cancel_marker", "sold_out"):
        db = make_db(ev_doc())
        out, s, _ = run(db, recheck=Recheck(outcome))
        assert out["sent"] == 0 and s.expo == [] and s.web == [], outcome
        assert out["suppressed"][0]["outcome"] == outcome
        assert db.event_reminders_sent.rows == [] and db.event_push_log.rows == []
        assert any(lg["reason"] == "reminder_suppressed" for lg in db.city_events_log.rows), outcome
        assert db.city_events.rows[0]["status"] == "published", "a failed recheck never changes the feed"
    assert any("suprimido" in a for a in _reset["alerts"])


@pytest.mark.parametrize("over", [
    {"geocode_source": None, "lat": None, "lng": None},                           # not geocoded
    {"lat": 10.4236, "lng": -75.5483},                                             # placeholder coordinate
    {"start_time": None, "time_confirmed": False},                                 # no time
    {"time_confirmed": False},                                                     # time not visible
    {"evidence": [{"url": TB, "tier": 2, "fetched_at": LV_TODAY, "http_status": 200,
                   "date_text": "startDate 2026-11-12T19:00", "date_visible": False,
                   "start_date": "2026-11-12", "start_time": "19:00"}]},           # JSON-LD only → VERIFY
    {"status": "date_tbc", "start_date": None, "end_date": None, "tbc_window_end": "2026-11-30"},
    {"is_umbrella": True},
    {"parent_id": "ce-fiestas-de-independencia-2026-20261002-f3a4"},
    {"sold_out": True},
    {"origin": "partner", "moderation_status": "approved"},
    {"status": "review", "status_reason": "date_changed"},
    {"last_verified": LV_YESTERDAY},                                               # not verified TODAY
])
def test_only_high_geocoded_published_timed_verified_today_events_notify(over: Dict[str, Any]) -> None:
    db = make_db(ev_doc(**over))
    out, s, rc = run(db)
    assert out["sent"] == 0 and s.expo == [] and rc.calls == [], over


def test_sentinel_unhealthy_refuses_and_alerts_once(_reset: Any) -> None:
    db = make_db(ev_doc(), healthy=False)
    out, s, _ = run(db)
    assert out.get("refused") == "sentinel_unhealthy" and s.expo == []
    R.invalidate_caches()
    run(db, now=NOW + timedelta(minutes=15))
    assert sum("Centinela" in a for a in _reset["alerts"]) == 1


def test_kill_switch_stops_reminders() -> None:
    db = make_db(ev_doc(), enabled=False)
    out, s, _ = run(db)
    assert out.get("refused") == "disabled" and s.expo == []


def test_prefs_off_and_deleted_or_missing_users_are_skipped() -> None:
    db = make_db(ev_doc(), users=("u1", "u2"), favs=[("u1", EID), ("u2", EID), ("ghost", EID)])
    asyncio.run(db.event_notif_prefs.insert_one({"user_id": "u1", "reminders_enabled": False}))
    asyncio.run(db.users.update_one({"user_id": "u2"}, {"$set": {"deleted_at": "2026-11-01T00:00:00Z"}}))
    out, s, _ = run(db)
    assert out["sent"] == 0 and s.expo == []
    assert out["skipped"] == {"prefs_off": 1, "user_missing": 2}


# ── timing ───────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("bogota_hm,due", [
    ("15:59", False),   # 181 min before 19:00
    ("16:00", True),    # 180 min
    ("18:30", True),    # 30 min
    ("18:31", False),   # 29 min
])
def test_send_window_is_start_minus_180_to_minus_30(bogota_hm: str, due: bool) -> None:
    h, m = map(int, bogota_hm.split(":"))
    now = datetime(2026, 11, 12, h + 5, m, tzinfo=UTC)
    pv = G.public_view(ev_doc(), now, True)
    assert pv is not None and E.reminder_due(pv, now) is due


def test_quiet_hours_refuse_and_early_events_never_remind() -> None:
    db = make_db(ev_doc())
    out, s, _ = run(db, now=datetime(2026, 11, 12, 11, 30, tzinfo=UTC))   # 06:30 Bogotá
    assert out.get("refused") == "quiet_hours" and s.expo == []
    early = ev_doc(start_time="08:00", evidence=[dict(ev_doc()["evidence"][0], start_time="08:00",
                                                      date_text="Jueves 12 de noviembre de 2026 · 8:00 a. m.")])
    for hm in ((14, 0), (15, 0)):   # 09:00 / 10:00 Bogotá: after the window [05:00, 07:30] closed
        now = datetime(2026, 11, 12, *hm, tzinfo=UTC)
        pv = G.public_view(early, now, True)
        assert pv is None or not E.reminder_due(pv, now)


def test_multi_day_events_are_reminded_on_their_first_day_only() -> None:
    two_day = ev_doc(start_date="2026-11-11", end_date="2026-11-12",
                     evidence=[dict(ev_doc()["evidence"][0], start_date="2026-11-11", end_date="2026-11-12",
                                    date_text="Miércoles 11 de noviembre de 2026 · 7:00 p. m.")])
    pv = G.public_view(two_day, NOW, True)
    assert pv is not None and E.reminder_due(pv, NOW) is False


def test_dry_run_lists_who_gets_what_and_writes_nothing() -> None:
    db = make_db(ev_doc(), users=("u1", "u2"))
    out, s, _ = run(db, dry=True)
    assert [w["user_id"] for w in out["would_send"]] == ["u1", "u2"]
    assert s.expo == [] and s.web == []
    assert db.event_reminders_sent.rows == [] and db.event_push_log.rows == [] and db.city_events_runs.rows[1:] == []


# ── favorites/add through the REAL server.py handler slice ──────────────────


def _favorites_app(db: StubDB, user: Dict[str, Any]) -> TestClient:
    async def get_current_user(request: Request) -> Dict[str, Any]:
        return dict(user)

    async def _check_rate_limit(*_a: Any, **_k: Any) -> None:
        return None

    ns: Dict[str, Any] = {
        "api_router": APIRouter(prefix="/api"), "BaseModel": BaseModel, "HTTPException": HTTPException,
        "Request": Request, "db": db, "get_current_user": get_current_user, "_check_rate_limit": _check_rate_limit,
        "PUBLIC_PARTNER_FILTER": PUBLIC_PARTNER_FILTER, "_events_elite": E, "uuid": uuid,
        "datetime": datetime, "timezone": timezone,
    }
    src = server_span("class FavoriteToggle(BaseModel):", '@api_router.get("/favorites")')
    exec(compile(src, "server.py[favorites]", "exec"), ns)
    app = FastAPI()
    app.include_router(ns["api_router"])
    return TestClient(app)


def test_favorites_add_with_ce_id_then_reminder_fires(monkeypatch: pytest.MonkeyPatch) -> None:
    db = make_db(ev_doc(aliases=["ce-salsa-plaza-old-alias-20261112-0000"]), users=("u9",), favs=[])
    monkeypatch.setattr(G, "as_utc", lambda now=None: NOW if now is None else (
        now.replace(tzinfo=UTC) if now.tzinfo is None else now.astimezone(UTC)))
    client = _favorites_app(db, {"user_id": "u9", "email": "u9@x.co"})
    r1 = client.post("/api/favorites/add", json={"item_id": "ce-salsa-plaza-old-alias-20261112-0000",
                                                 "item_type": "event"})
    assert r1.status_code == 200 and r1.json() == {"status": "added", "item_id": EID}, r1.text
    r2 = client.post("/api/favorites/add", json={"item_id": EID, "item_type": "event"})
    assert r2.json()["status"] == "exists", "add is idempotent and never removes"
    assert client.post("/api/favorites/add", json={"item_id": "evt_010", "item_type": "event"}).status_code == 404
    assert client.post("/api/favorites/toggle", json={"item_id": "con_003", "item_type": "concert"}).status_code == 404
    assert [f["item_id"] for f in db.favorites.rows] == [EID], "stored under the canonical id"
    out, s, _ = run(db)
    assert out["sent"] == 1 and s.expo[0][0] == "u9" and s.expo[0][3] == {"kind": "event_reminder", "event_id": EID}


def test_favorites_toggle_can_still_remove_a_legacy_favorite() -> None:
    db = make_db(ev_doc(), users=("u9",), favs=[("u9", "evt_010")])
    db.favorites.rows[0]["item_type"] = "event"
    client = _favorites_app(db, {"user_id": "u9"})
    r = client.post("/api/favorites/toggle", json={"item_id": "evt_010", "item_type": "event"})
    assert r.json()["status"] == "removed" and db.favorites.rows == []
