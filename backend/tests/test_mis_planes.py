"""P1 "Mis Planes" — reservas + entradas merged into ONE chronological view.

Behavioral: a user with both sees both, correctly typed and ordered, each row
linking its REAL existing detail; statuses ship verbatim (pending stays pending,
never relabeled); no duplicate rows; secrets never ride; empty stays honest.
Throwaway FastAPI + the in-memory db fakes from test_tickets; server.py never
imported.

Run: cd backend && python -m pytest -q tests/test_mis_planes.py
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parent.parent
TESTS = Path(__file__).resolve().parent
for p in (str(BACKEND), str(TESTS)):
    if p not in sys.path:
        sys.path.insert(0, p)

import reservations as R  # noqa: E402
from test_tickets import _Coll  # noqa: E402 — the shared in-memory collection fake

NOW = datetime.now(timezone.utc)
TODAY_CTG = (NOW - timedelta(hours=5)).strftime("%Y-%m-%d")
YESTERDAY_CTG = (NOW - timedelta(hours=5) - timedelta(days=1)).strftime("%Y-%m-%d")


def _iso(dt: datetime) -> str:
    return dt.isoformat()


class _Db:
    def __init__(self) -> None:
        self.partners = _Coll([{
            "partner_id": "pX", "name": "Carmen", "image_url": "/images/partners/pX.jpg",
        }])
        self.reservations = _Coll([
            {  # upcoming, confirmed, in 5 days
                "reservation_id": "rsv_a", "user_id": "u1", "partner_id": "pX",
                "partner_name": "Carmen", "type": "table", "date": (NOW + timedelta(days=5)).strftime("%Y-%m-%d"),
                "time": "19:00", "party_size": 2, "status": "confirmed",
                "datetime_utc": _iso(NOW + timedelta(days=5)), "created_at": _iso(NOW),
            },
            {  # upcoming, STILL pending — must ship verbatim, never "confirmed"
                "reservation_id": "rsv_b", "user_id": "u1", "partner_id": "pX",
                "partner_name": "Carmen", "type": "table", "date": (NOW + timedelta(days=2)).strftime("%Y-%m-%d"),
                "time": "20:00", "party_size": 4, "status": "pending_confirmation",
                "datetime_utc": _iso(NOW + timedelta(days=2)), "created_at": _iso(NOW),
            },
            {  # past, completed
                "reservation_id": "rsv_c", "user_id": "u1", "partner_id": "pX",
                "partner_name": "Carmen", "type": "table", "date": (NOW - timedelta(days=10)).strftime("%Y-%m-%d"),
                "time": "19:00", "party_size": 2, "status": "completed",
                "datetime_utc": _iso(NOW - timedelta(days=10)), "created_at": _iso(NOW - timedelta(days=11)),
            },
            {  # someone else's row — must never appear
                "reservation_id": "rsv_z", "user_id": "u2", "partner_id": "pX",
                "partner_name": "Carmen", "type": "table", "status": "confirmed",
                "datetime_utc": _iso(NOW + timedelta(days=1)), "created_at": _iso(NOW),
            },
        ])
        self.amo_tickets = _Coll([
            {  # tonight, Cartagena calendar → upcoming; secret must never ride
                "ticket_id": "amt_1", "user_id": "u1", "kind": "event_rsvp", "event_id": "ev1",
                "title": "Noche de Museos", "venue_name": "Museo del Oro", "partner_id": "", "partner_name": "",
                "date": TODAY_CTG, "start_time": "21:00", "status": "issued", "used_at": None,
                "qr_secret": "NEVER-SHIP-THIS", "created_at": _iso(NOW),
            },
            {  # yesterday, scanned → past, status verbatim 'used'
                "ticket_id": "amt_2", "user_id": "u1", "kind": "event_rsvp", "event_id": "ev2",
                "title": "Concierto", "venue_name": "Camellón", "partner_id": "", "partner_name": "",
                "date": YESTERDAY_CTG, "start_time": "20:00", "status": "used",
                "used_at": _iso(NOW - timedelta(days=1)), "qr_secret": "NEVER-SHIP-THIS",
                "created_at": _iso(NOW - timedelta(days=2)),
            },
            {  # event published no date: unknown ≠ past → upcoming, sorted last
                "ticket_id": "amt_3", "user_id": "u1", "kind": "event_rsvp", "event_id": "ev3",
                "title": "Fecha por anunciar", "venue_name": "", "partner_id": "", "partner_name": "",
                "date": "", "start_time": "", "status": "issued", "used_at": None,
                "qr_secret": "NEVER-SHIP-THIS", "created_at": _iso(NOW),
            },
            {"ticket_id": "amt_z", "user_id": "u2", "kind": "event_rsvp", "event_id": "ev1",
             "title": "Ajena", "venue_name": "", "partner_id": "", "partner_name": "",
             "date": TODAY_CTG, "start_time": "", "status": "issued", "used_at": None,
             "qr_secret": "x", "created_at": _iso(NOW)},
        ])


CURRENT_USER = {"user_id": "u1"}


def _client() -> TestClient:
    async def fake_user(request):
        return dict(CURRENT_USER)
    R.init(db=_Db(), get_current_user=fake_user, get_current_business=fake_user,
           require_government_role=fake_user)
    app = FastAPI()
    app.include_router(R.router, prefix="/api")
    return TestClient(app)


def test_planes_merges_both_stores_typed_ordered_no_dupes() -> None:
    CURRENT_USER["user_id"] = "u1"
    res = _client().get("/api/me/planes")
    assert res.status_code == 200
    body = res.json()
    up, past = body["upcoming"], body["past"]
    assert body["total"] == len(up) + len(past) == 6

    # both kinds present in ONE list, every row typed
    assert {p["kind"] for p in up} == {"reserva", "entrada"}
    assert all(p["kind"] in ("reserva", "entrada") for p in up + past)

    # chronological: tonight's entrada → the 2-day reserva → the 5-day reserva →
    # the date-less entrada last (unknown ≠ past, but it can't claim a slot in time)
    assert [p["id"] for p in up] == ["amt_1", "rsv_b", "rsv_a", "amt_3"]
    whens = [p["when"] for p in up if p["when"]]
    assert whens == sorted(whens)
    assert up[-1]["id"] == "amt_3" and up[-1]["when"] == ""

    # past: most recent first, statuses verbatim
    assert [p["id"] for p in past] == ["amt_2", "rsv_c"]
    assert past[0]["status"] == "used" and past[1]["status"] == "completed"

    # honesty: pending stays pending — the merge never upgrades a state
    by_id = {p["id"]: p for p in up + past}
    assert by_id["rsv_b"]["status"] == "pending_confirmation"
    assert by_id["rsv_a"]["status"] == "confirmed" and by_id["amt_1"]["status"] == "issued"

    # each row links its REAL existing detail surface
    assert by_id["amt_1"]["href"] == "/ticket/amt_1"
    assert by_id["rsv_a"]["href"] == "/reservations?highlight=rsv_a"

    # no dupes, no leakage, no other user's rows
    ids = [p["id"] for p in up + past]
    assert len(ids) == len(set(ids))
    assert "rsv_z" not in ids and "amt_z" not in ids
    assert "NEVER-SHIP-THIS" not in res.text and "qr_secret" not in res.text

    # the reserva card can show its partner image; entradas carry none
    assert by_id["rsv_a"]["image_url"] == "/images/partners/pX.jpg"
    assert by_id["amt_1"]["image_url"] == ""


def test_planes_empty_is_honest() -> None:
    CURRENT_USER["user_id"] = "u_empty"
    res = _client().get("/api/me/planes")
    assert res.status_code == 200
    assert res.json() == {"upcoming": [], "past": [], "total": 0}
