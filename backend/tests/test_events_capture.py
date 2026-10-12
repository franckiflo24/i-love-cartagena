"""DROP 3A — field-capture intake ("Vi un evento ahora").

The capture is a REPORTED sighting that enters the same funnel as every pipeline
row: status review, source required, §15 Q geofilter, dedup. approve_event stays
the only door to published — these tests prove the full capture→review→approve
path AND every refusal rail.
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import events_elite as E  # noqa: E402
import test_events_pull as TP  # noqa: E402

UTC = timezone.utc
NOW = datetime(2026, 10, 1, 11, 0, tzinfo=UTC)  # 06:00 Bogotá, same local date

CAMELLON = {"id": "civ_camellon_martires", "lat": 10.4227, "lng": -75.5472}


def _capture(**over: Any) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "title": "Concierto de cierre",
        "venue_name": "Camellón de los Mártires",
        "date_mode": "today",
        "category": "concert",
        "civic": dict(CAMELLON),
    }
    body.update(over)
    return body


def _create(db: Any, **over: Any) -> Dict[str, Any]:
    return asyncio.run(E.create_capture_draft(db, _capture(**over), actor="admin:staff1", now=NOW))


# ── happy path ───────────────────────────────────────────────────────────────

def test_capture_lands_in_review_with_source_and_pin() -> None:
    db = TP.new_db()
    res = _create(db)
    assert res["status"] == "review" and res["pinned"] is True
    assert res["civic_id"] == "civ_camellon_martires"
    d = TP.docs(db)[0]
    assert d["status"] == "review" and d["status_reason"] == "field_capture"
    assert d["source_name"] == "Captura AMO"
    assert d["source_url"].endswith(res["capture_id"])
    assert d["country_check"] == "pass"
    assert (d["lat"], d["lng"]) == (CAMELLON["lat"], CAMELLON["lng"])
    assert d["geocode_source"] == "civic:civ_camellon_martires"
    assert d["start_date"] == "2026-10-01" and d["start_time"] is None
    assert d["evidence"][0]["tier"] == 2 and d["evidence"][0]["kind"] == "field_capture"
    assert d["origin"] == "pipeline" and d["ingest_kind"] == "field_capture"
    log = [r for r in db.city_events_log.rows if r.get("reason") == "capture"]
    assert log and log[0]["actor"] == "admin:staff1"


def test_capture_now_stamps_bogota_wall_clock() -> None:
    db = TP.new_db()
    _create(db, date_mode="now")
    d = TP.docs(db)[0]
    assert d["start_date"] == "2026-10-01"
    assert d["start_time"] == "06:00"  # 11:00Z = 06:00 −05, never the UTC hour
    assert d["time_confirmed"] is True


def test_capture_then_approve_publishes_the_full_funnel() -> None:
    """The Carlos Vives miss, now caught: capture → review → second staffer approves
    → published. Proves the capture doc shape passes the real gate."""
    db = TP.new_db()
    res = _create(db)
    out = asyncio.run(E.approve_event(db, res["event_id"], actor="admin:staff2", now=NOW))
    assert out["status"] == "published"
    d = TP.docs(db)[0]
    assert d["status"] == "published" and d["approved_by"] == "admin:staff2"


def test_capture_unresolved_venue_keeps_string_no_fake_pin_and_approves() -> None:
    db = TP.new_db()
    res = _create(db, venue_name="Baluarte San Miguel", civic=None)
    assert res["pinned"] is False and res["civic_id"] is None
    d = TP.docs(db)[0]
    assert "lat" not in d and "lng" not in d
    assert d["venue_name"] == "Baluarte San Miguel"
    out = asyncio.run(E.approve_event(db, res["event_id"], actor="admin:staff2", now=NOW))
    assert out["status"] == "published"


def test_capture_tbc_never_fabricates_a_date_and_approves_to_date_tbc() -> None:
    db = TP.new_db()
    res = _create(db, date_mode="tbc")
    d = TP.docs(db)[0]
    assert d["start_date"] is None and d["start_time"] is None
    assert d["tbc_window_end"] == "2026-10-31" and d["date_tbc_note"]["es"]
    out = asyncio.run(E.approve_event(db, res["event_id"], actor="admin:staff2", now=NOW))
    assert out["status"] == "date_tbc"


# ── refusal rails ────────────────────────────────────────────────────────────

def test_capture_spain_signal_rejected_at_intake() -> None:
    db = TP.new_db()
    with pytest.raises(HTTPException) as ei:
        _create(db, title="Concierto en el Teatro Romea de Murcia", civic=None)
    assert ei.value.status_code == 422 and ei.value.detail["error"] == "geofilter"
    assert TP.docs(db) == []


def test_capture_coords_outside_distrito_are_dropped_not_stored() -> None:
    db = TP.new_db()
    res = _create(db, civic={"id": "civ_fake", "lat": 37.98, "lng": -1.13})  # Murcia, Spain
    assert res["pinned"] is False
    d = TP.docs(db)[0]
    assert "lat" not in d and "lng" not in d


@pytest.mark.parametrize("over,err", [
    ({"title": "abc"}, "bad_title"),
    ({"date_mode": "mañana"}, "bad_date_mode"),
    ({"date_mode": "date", "start_date": "12/11/2026"}, "bad_start_date"),
    ({"date_mode": "date", "start_date": "2026-09-01"}, "past_date"),
    ({"date_mode": "date", "start_date": "2026-11-12", "start_time": "7pm"}, "bad_start_time"),
    ({"photo_data_url": "data:image/jpeg;base64," + "A" * 3_600_000}, "photo_too_large"),
])
def test_capture_validation(over: Dict[str, Any], err: str) -> None:
    db = TP.new_db()
    with pytest.raises(HTTPException) as ei:
        _create(db, **over)
    assert ei.value.status_code == 422 and ei.value.detail["error"] == err
    assert TP.docs(db) == []


def test_capture_exact_twin_refused_with_existing_id() -> None:
    """Identical title+venue+date = the same deterministic event_id: the intake
    answers already_exists carrying that id — the strongest no-blind-twin rail."""
    db = TP.new_db()
    first = _create(db)
    with pytest.raises(HTTPException) as ei:
        _create(db)
    assert ei.value.status_code == 422
    assert ei.value.detail["error"] == "already_exists"
    assert ei.value.detail["hint"] == first["event_id"]
    assert len(TP.docs(db)) == 1


def test_capture_duplicate_matches_folded_title_same_date() -> None:
    db = TP.new_db()
    first = _create(db)
    second = _create(db, title="CONCIERTO DE CIERRE", venue_name="otro escenario", civic=None)
    assert second["possible_duplicate_of"] == first["event_id"]


# ── public citable record ────────────────────────────────────────────────────

def test_capture_public_record_is_sanitized() -> None:
    db = TP.new_db()
    res = _create(db)
    rec = asyncio.run(E.capture_public_record(db, res["capture_id"]))
    assert rec is not None
    assert rec["reported_by"] == "Equipo AMO · Cartagena"
    assert "staff1" not in str(rec), "staff identity never leaves the admin log"
    assert rec["title"] == "Concierto de cierre"
    assert rec["event_id"] == res["event_id"] and rec["event_status"] == "review"


def test_capture_public_record_unknown_or_bad_id_is_none() -> None:
    db = TP.new_db()
    assert asyncio.run(E.capture_public_record(db, "deadbeef0000")) is None
    assert asyncio.run(E.capture_public_record(db, "../etc")) is None
