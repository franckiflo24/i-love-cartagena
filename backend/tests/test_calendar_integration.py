"""CALENDAR-INTEGRATION v1 — curator set-dates route + recheck-due watchlist cron.

set-dates is the §15 W2 companion (the anchors seed never rewrites dates on an existing doc):
it stamps proposed_dates and rides approve_event, the single date-mutation path, so the gate
still re-decides and a refused row is left untouched. recheck-due reads the anchors FILE (the
curation truth) and digests overdue watch rows to Telegram ops once per Bogota day until a
curator re-researches and edits the file.
"""
from __future__ import annotations

import asyncio
import os
import sys
import types
from datetime import datetime, timezone
from typing import Any, Dict, List

import pytest
from fastapi import HTTPException

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS = os.path.dirname(os.path.abspath(__file__))
for p in (BACKEND, TESTS):
    if p not in sys.path:
        sys.path.insert(0, p)

import events_elite as E  # noqa: E402
import events_time  # noqa: E402
import maintenance as M  # noqa: E402
import telegram_alerts as T  # noqa: E402
import test_events_pull as TP  # noqa: E402
from events_service_stubs import StubDB  # noqa: E402

UTC = timezone.utc
NOW = datetime(2026, 10, 1, 11, 0, tzinfo=UTC)   # same clock as the pull/approve suites


def _tbc_doc(eid: str = "ce-concierto-sinfonico-202611tbc-ab12", **over: Any) -> Dict[str, Any]:
    d = {"event_id": eid, "canonical_key": "k-concierto", "match_key": "k-concierto",
         "title": {"es": "Concierto Sinfónico"}, "category": "concert", "edition_year": 2026,
         "start_date": None, "end_date": None, "start_time": None, "tbc_window_end": "2026-11-30",
         "date_tbc_note": {"es": "Noviembre 2026 · fecha por confirmar"}, "venue_name": "Teatro Adolfo Mejía",
         "source_url": "https://ipcc.gov.co/agenda-noviembre", "source_name": "IPCC", "source_tier": 1,
         "source_keys": ["anchor:concierto-sinfonico"],
         "evidence": [{"url": "https://ipcc.gov.co/agenda-noviembre", "tier": 1,
                       "fetched_at": "2026-09-30T12:00:00Z", "http_status": 200,
                       "date_text": "Noviembre 2026 · fecha por confirmar", "date_visible": True}],
         "last_verified": "2026-09-30T12:00:00Z", "country_check": "pass", "country_signals": ["pass:t"],
         "status": "date_tbc", "status_reason": None, "confidence": "VERIFY", "origin": "anchor"}
    d.update(over)
    return d


BODY = {"start_date": "2026-11-12", "end_date": "2026-11-12", "start_time": "19:00",
        "source_url": "https://ipcc.gov.co/agenda-noviembre-actualizada", "reason": "fecha publicada por el IPCC"}


def test_set_dates_resolves_a_tbc_row() -> None:
    db = TP.new_db()
    doc = _tbc_doc()
    asyncio.run(db.city_events.insert_one(doc))
    res = asyncio.run(E.set_event_dates(db, doc["event_id"], BODY, actor="admin:t", now=NOW))
    assert res["status"] == "published"
    d = TP.docs(db)[0]
    assert (d["start_date"], d["end_date"], d["start_time"]) == ("2026-11-12", "2026-11-12", "19:00")
    assert d.get("time_confirmed") is True
    assert "tbc_window_end" not in d and "date_tbc_note" not in d
    assert "proposed_dates" not in d, "the stamp is consumed by approve, never left behind"
    assert d["date_history"] and d["date_history"][-1]["to"]["start_date"] == "2026-11-12"
    log = [r for r in db.city_events_log.rows if r.get("reason") == "set_dates"]
    assert log and log[0]["detail"]["proposed"]["url"] == BODY["source_url"]
    assert log[0]["detail"]["proposed"]["reason"] == BODY["reason"]


@pytest.mark.parametrize("patch,err", [
    ({"start_date": "12/11/2026"}, "bad_start_date"),
    ({"end_date": "2026-11-01"}, "bad_range"),
    ({"start_date": "2026-09-01", "end_date": "2026-09-02"}, "past_dates"),
    ({"start_time": "7pm"}, "bad_start_time"),
    ({"source_url": None}, "source_url_required"),
    ({"source_url": "ftp://x.y/z"}, "source_url_required"),
    ({"reason": " a "}, "reason_required"),
])
def test_set_dates_validation(patch: Dict[str, Any], err: str) -> None:
    db = TP.new_db()
    doc = _tbc_doc()
    asyncio.run(db.city_events.insert_one(doc))
    body = {**BODY, **patch}
    with pytest.raises(HTTPException) as ei:
        asyncio.run(E.set_event_dates(db, doc["event_id"], body, actor="admin:t", now=NOW))
    assert ei.value.status_code == 422 and ei.value.detail["error"] == err
    d = TP.docs(db)[0]
    assert d["status"] == "date_tbc" and "proposed_dates" not in d


def test_set_dates_rolls_back_the_stamp_when_the_gate_refuses() -> None:
    db = TP.new_db()
    doc = _tbc_doc(country_check="fail")
    asyncio.run(db.city_events.insert_one(doc))
    with pytest.raises(HTTPException) as ei:
        asyncio.run(E.set_event_dates(db, doc["event_id"], BODY, actor="admin:t", now=NOW))
    assert ei.value.status_code == 409
    d = TP.docs(db)[0]
    assert "proposed_dates" not in d, "a refused row keeps no dangling curator proposal"
    assert d["status"] == "date_tbc" and d["start_date"] is None


def test_set_dates_unknown_event_404s() -> None:
    db = TP.new_db()
    with pytest.raises(HTTPException) as ei:
        asyncio.run(E.set_event_dates(db, "ce-nope-000000-zz99", BODY, actor="admin:t", now=NOW))
    assert ei.value.status_code == 404


# ── recheck-due watchlist (reads the real anchors file) ──────────────────────


class _Req:
    def __init__(self, token: str) -> None:
        self.headers = {"Authorization": f"Bearer {token}"}


def _run_recheck(monkeypatch: pytest.MonkeyPatch, day: datetime, sends: List[str]) -> Dict[str, Any]:
    monkeypatch.setenv("EVENTS_ADMIN_TOKEN", "tok-events-admin")
    monkeypatch.setattr(events_time, "now_bogota", lambda: day)

    async def fake_send(text: str, **_k: Any) -> bool:
        sends.append(text)
        return True

    monkeypatch.setattr(T, "send", fake_send)
    return asyncio.run(M.recheck_due(_Req("tok-events-admin")))  # type: ignore[arg-type]


def test_recheck_due_quiet_before_any_watch_date(monkeypatch: pytest.MonkeyPatch) -> None:
    M.db = StubDB()
    sends: List[str] = []
    out = _run_recheck(monkeypatch, datetime(2026, 10, 10, 6, 0), sends)
    assert out["count"] == 0 and out["digest_sent"] is False and sends == []


def test_recheck_due_digests_once_per_bogota_day(monkeypatch: pytest.MonkeyPatch) -> None:
    M.db = StubDB()
    sends: List[str] = []
    out = _run_recheck(monkeypatch, datetime(2026, 10, 21, 6, 0), sends)
    assert out["count"] >= 1 and out["digest_sent"] is True
    assert "senorita-colombia-2026-eleccion-y-coronacion" in out["due"]
    assert len(sends) == 1 and "senorita-colombia-2026-eleccion-y-coronacion" in sends[0]
    assert "events_anchors.json" in sends[0], "the alert says where the fix goes"
    # same day again: the file is unchanged, the digest is not re-sent
    out2 = _run_recheck(monkeypatch, datetime(2026, 10, 21, 9, 0), sends)
    assert out2["count"] == out["count"] and out2["digest_sent"] is False
    assert len(sends) == 1
    health = next(r for r in M.db.system_health.rows if r["_id"] == "events_recheck")
    assert health["digest_day"] == "2026-10-21" and health["due"] == out["count"]


def test_recheck_due_rejects_bad_token(monkeypatch: pytest.MonkeyPatch) -> None:
    M.db = StubDB()
    monkeypatch.setenv("EVENTS_ADMIN_TOKEN", "tok-events-admin")
    monkeypatch.setenv("CRON_SECRET", "tok-cron")
    with pytest.raises(HTTPException) as ei:
        asyncio.run(M.recheck_due(_Req("wrong")))  # type: ignore[arg-type]
    assert ei.value.status_code in (401, 403)
