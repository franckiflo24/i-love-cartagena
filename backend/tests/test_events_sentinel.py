"""EVENTS-ELITE sentinel (DESIGN.md §7, §13 F4/G, §15 S3/R1/R4): stub DB + fake recheck.

Every §15 S3 outcome: success, not_found (VERIFY at once, review/source_changed on the 2nd),
blocked (blocked_days per day, VERIFY + one alert per source per day after 3), gone (hides only on
the 2nd strike ≥ 6 h apart, revival to review within 7 days), cancel marker, date change (review +
alert, automatic only when 2 independent tier ≤ 3 pages agree), time-only change, head 'changed'.
Every case writes a city_events_log row. Pure: no network, no Atlas, never imports server.py.

Run: cd backend && python -m pytest -q tests/test_events_sentinel.py
"""
from __future__ import annotations

import asyncio
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
import events_runtime as R  # noqa: E402
import telegram_alerts as T  # noqa: E402
from events_service_stubs import StubDB, with_event_indexes  # noqa: E402

UTC = timezone.utc
NOW = datetime(2026, 10, 1, 16, 0, tzinfo=UTC)          # Thu 1 Oct 2026, 11:00 Bogotá
LV = (NOW - timedelta(hours=20)).strftime("%Y-%m-%dT%H:%M:%SZ")
TB = "https://tuboleta.com/es/eventos/concierto-sinfonico-cartagena"
IPCC = "https://ipcc.gov.co/programacion-concierto-sinfonico"
CCC = "https://cccartagena.com/events/concierto-sinfonico/"
EU = "https://www.eluniversal.com.co/cultural/concierto-sinfonico"
TEATRO = (10.4266111, -75.5511837)


def _ev(url: str, date_text: str, tier: int, *, start: str = "2026-11-12", time_: Optional[str] = "19:00",
        fetched: str = LV) -> Dict[str, Any]:
    return {"url": url, "name": "src", "tier": tier, "fetched_at": fetched, "http_status": 200,
            "date_text": date_text, "date_visible": True, "start_date": start, "end_date": start, "start_time": time_}


def doc(event_id: str = "ce-concierto-sinfonico-20261112-ab12", *, start: str = "2026-11-12", url: str = TB,
        tier: int = 2, **over: Any) -> Dict[str, Any]:
    d: Dict[str, Any] = {
        "event_id": event_id, "canonical_key": f"concierto sinfonico|2026|teatro adolfo mejia|{event_id}",
        "title": {"es": "Concierto Sinfónico"}, "description": {}, "category": "concert",
        "edition_year": 2026, "start_date": start, "end_date": start, "start_time": "19:00", "end_time": None,
        "time_confirmed": True, "venue_name": "Teatro Adolfo Mejía", "address": None, "zone": "centro",
        "lat": TEATRO[0], "lng": TEATRO[1], "geocode_source": "gazetteer",
        "price": {"is_free": None, "min_cop": 50000, "max_cop": None, "text": None},
        "ticket_url": url, "source_url": url, "source_name": "TuBoleta", "source_tier": tier,
        "source_key": None, "recheck_url": url, "source_keys": [f"test:{event_id}"],
        "evidence": [_ev(url, "Jueves 12 de noviembre de 2026 · 7:00 p. m.", tier, start=start)],
        "last_verified": LV, "verified_by": "pipeline", "country_check": "pass", "country_signals": ["pass:test"],
        "status": "published", "status_reason": None, "confidence": "HIGH", "notif_eligible": True,
        "origin": "pipeline", "sold_out": False, "parent_id": None, "is_umbrella": False,
        "blocked_days": 0, "not_found_count": 0, "gone_strikes": 0,
    }
    d.update(over)
    return d


class FakeClient:
    async def aclose(self) -> None:
        return None


def rec(outcome: str, **kw: Any) -> Dict[str, Any]:
    base = {"outcome": outcome, "http_status": kw.pop("http_status", 200), "found_date_text": None, "parsed": None,
            "marker": None, "final_url": None, "sold_out": False, "time_only": False, "detail": None, "head": None,
            "checked_at": NOW.strftime("%Y-%m-%dT%H:%M:%SZ")}
    base.update(kw)
    return base


class FakeRecheck:
    """Per-URL scripted recheck results; counts real 'fetches' through the shared run cache."""

    def __init__(self, by_url: Dict[str, Dict[str, Any]]) -> None:
        self.by_url = by_url
        self.calls: List[str] = []
        self.fetches: List[str] = []

    async def __call__(self, client: Any, d: Dict[str, Any], *, sched: Any = None, cache: Any = None,
                       now_utc: Any = None, disabled: Any = ()) -> Dict[str, Any]:
        url = str(d.get("recheck_url") or d.get("source_url") or "")
        self.calls.append(url)
        if cache is not None:
            if url not in cache:
                cache[url] = True
                self.fetches.append(url)
        else:
            self.fetches.append(url)
        return dict(self.by_url.get(url) or rec("blocked", marker="unscripted"))


@pytest.fixture(autouse=True)
def _reset(monkeypatch: pytest.MonkeyPatch) -> Dict[str, List[str]]:
    R.invalidate_caches()
    sent: Dict[str, List[str]] = {"alerts": [], "digests": []}

    async def fake_send(text: Any, **_k: Any) -> Dict[str, Any]:
        sent["alerts"].append(str(text))
        return {"configured": False, "sent": 0, "chats": 0, "errors": []}

    async def fake_digest(title: str, lines: Any, **_k: Any) -> Dict[str, Any]:
        sent["digests"].append(title + "\n" + "\n".join(lines))
        return {"configured": False, "sent": 0, "chats": 0, "errors": []}

    monkeypatch.setattr(T, "send", fake_send)
    monkeypatch.setattr(T, "digest", fake_digest)
    return sent


def _db(*docs: Dict[str, Any]) -> StubDB:
    db = asyncio.run(with_event_indexes(StubDB()))
    for d in docs:
        asyncio.run(db.city_events.insert_one(d))
    return db


def run(db: StubDB, fake: FakeRecheck, now: datetime = NOW, **kw: Any) -> Dict[str, Any]:
    return asyncio.run(E.run_sentinel(db, now=now, recheck_fn=fake, client_factory=FakeClient, **kw))


def row(db: StubDB, eid: str = "ce-concierto-sinfonico-20261112-ab12") -> Dict[str, Any]:
    return next(r for r in db.city_events.rows if r["event_id"] == eid)


def logs(db: StubDB, eid: str = "ce-concierto-sinfonico-20261112-ab12") -> List[Dict[str, Any]]:
    return [r for r in db.city_events_log.rows if r.get("event_id") == eid]


def pv(db: StubDB, now: datetime = NOW) -> Dict[str, Any]:
    out = G.public_view(row(db), now, True)
    assert out is not None
    return out


def _unlease(db: StubDB) -> None:
    for r in db.city_events_state.rows:
        r.pop("lease_until", None)
        if r.get("_id", "").startswith("cursor:"):
            r["day"] = "reset"   # a fresh day for the next scripted run


# ── success ──────────────────────────────────────────────────────────────────


def test_success_sets_last_verified_resets_counters_and_logs() -> None:
    db = _db(doc(not_found_count=1, blocked_days=2, gone_strikes=1, gone_first_at=LV))
    fake = FakeRecheck({TB: rec("success", parsed={"start_date": "2026-11-12", "end_date": "2026-11-12",
                                                   "start_time": "19:00"},
                                found_date_text="Jueves 12 de noviembre de 2026 · 7:00 p. m.")})
    out = run(db, fake)
    r = row(db)
    assert out["done"] is True and out["counts"]["success"] == 1
    assert r["last_verified"] == "2026-10-01T16:00:00Z"
    assert (r["not_found_count"], r["blocked_days"], r["gone_strikes"]) == (0, 0, 0)
    assert "gone_first_at" not in r
    assert r["evidence"][0]["fetched_at"] == "2026-10-01T16:00:00Z" and r["evidence"][0]["date_visible"] is True
    assert r["status"] == "published" and pv(db)["confidence"] == "HIGH"
    assert len(logs(db)) == 1 and logs(db)[0]["actor"] == "sentinel"


def test_success_marks_row_checked_and_run_is_done_and_healthy() -> None:
    db = _db(doc())
    fake = FakeRecheck({TB: rec("success", parsed={"start_date": "2026-11-12", "end_date": "2026-11-12",
                                                   "start_time": "19:00"})})
    run(db, fake)
    assert row(db)["sentinel_day"] == "2026-10-01"
    runs = [x for x in db.city_events_runs.rows if x["kind"] == "sentinel"]
    assert runs and runs[-1]["done"] is True
    R.invalidate_caches()
    assert asyncio.run(R.sentinel_healthy(db, NOW)) is True
    # a second invocation the same day is a no-op (cursor done)
    again = run(db, fake, now=NOW + timedelta(minutes=10))
    assert again.get("noop") is True and len(fake.calls) == 1


def test_sold_out_verifies_and_sets_sold_out_not_notif_eligible() -> None:
    db = _db(doc())
    fake = FakeRecheck({TB: rec("sold_out", sold_out=True,
                                parsed={"start_date": "2026-11-12", "end_date": "2026-11-12", "start_time": "19:00"})})
    run(db, fake)
    r = row(db)
    assert r["sold_out"] is True and r["status"] == "published" and r["last_verified"] == "2026-10-01T16:00:00Z"
    assert pv(db)["notif_eligible"] is False


# ── not_found ────────────────────────────────────────────────────────────────


def test_not_found_first_time_is_verify_immediately_second_is_review_source_changed(_reset: Any) -> None:
    db = _db(doc())
    fake = FakeRecheck({TB: rec("not_found", detail="event_block_absent")})
    run(db, fake)
    r = row(db)
    assert r["not_found_count"] == 1 and r["status"] == "published"
    assert pv(db)["confidence"] == "VERIFY" and pv(db)["notif_eligible"] is False
    assert r["last_verified"] == LV, "not_found is never a verification"
    assert len(logs(db)) == 1 and logs(db)[0]["reason"] == "not_found"
    _unlease(db)
    run(db, fake, now=NOW + timedelta(days=1))
    r = row(db)
    assert (r["status"], r["status_reason"]) == ("review", "source_changed")
    assert any("revisión" in a for a in _reset["alerts"])
    assert logs(db)[-1]["to"] == "review"


# ── blocked ──────────────────────────────────────────────────────────────────


def test_blocked_counts_once_per_day_pure() -> None:
    first = E.sentinel_transition(doc(), rec("blocked", marker="timeout"), NOW)
    assert first["set"] == {"blocked_days": 1, "blocked_last_day": "2026-10-01"}
    again = E.sentinel_transition(doc(blocked_days=1, blocked_last_day="2026-10-01"), rec("blocked"),
                                  NOW + timedelta(hours=6))
    assert again["set"] == {}, "a second blocked result the same Bogotá day never double-counts"
    third = E.sentinel_transition(doc(blocked_days=2, blocked_last_day="2026-10-01"), rec("blocked"),
                                  NOW + timedelta(days=1))
    assert third["set"]["blocked_days"] == 3 and third["source_alert"]


def test_blocked_decays_to_verify_after_three_days(_reset: Any) -> None:
    db = _db(doc(), doc("ce-otro-concierto-20261112-cd34", source_keys=["test:2"],
                        canonical_key="otro|2026|teatro"))
    fake = FakeRecheck({TB: rec("blocked", marker="http_403", http_status=403)})
    for day in range(3):
        _unlease(db)
        run(db, fake, now=NOW + timedelta(days=day))
    r = row(db)
    assert r["blocked_days"] == 3 and r["last_verified"] == LV
    # VERIFY by the blocked cap (the row keeps its HIGH evidence, but not the badge)
    out = G.public_view(dict(r, last_verified=(NOW + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ")),
                        NOW + timedelta(days=2), True)
    assert out and out["confidence"] == "VERIFY" and out["status_reason"] == "blocked"
    blocked_alerts = [a for a in _reset["alerts"] if "bloqueada 3 días" in a]
    assert len(blocked_alerts) == 1, "one alert per source per day, not per row"
    assert all(lg["reason"] == "blocked" for lg in logs(db))


def test_manual_verify_resets_blocked_days(monkeypatch: pytest.MonkeyPatch) -> None:
    db = _db(doc(blocked_days=3))

    async def fetch(client: Any, url: str, **_k: Any) -> Dict[str, Any]:
        return {"status": 200, "blocked_reason": None, "fetched_at": "2026-10-01T16:00:00Z",
                "text": "<html><body><p>Jueves 12 de noviembre de 2026 · 7:00 p. m.</p></body></html>"}

    async def guard(url: str) -> Optional[str]:
        return None

    monkeypatch.setattr(E.sources, "fetch", fetch)
    out = asyncio.run(E.verify_event(db, "ce-concierto-sinfonico-20261112-ab12", TB,
                                     "Jueves 12 de noviembre de 2026 · 7:00 p. m.", actor="admin:u1", now=NOW,
                                     client_factory=FakeClient, url_guard=guard))
    r = row(db)
    assert r["blocked_days"] == 0 and r["verified_by"] == "manual" and out["confidence"] == "HIGH"
    assert any(lg["reason"] == "manual_verify" for lg in logs(db))


# ── gone ─────────────────────────────────────────────────────────────────────


def test_gone_second_strike_under_six_hours_waits_pure() -> None:
    d = doc(gone_strikes=1, gone_first_at="2026-10-01T16:00:00Z")
    early = E.sentinel_transition(d, rec("gone", marker="http_404"), NOW + timedelta(hours=2))
    assert early["set"] == {} and early["log_reason"] == "gone_strike_wait"
    late = E.sentinel_transition(d, rec("gone", marker="http_404"), NOW + timedelta(hours=6))
    assert (late["set"]["status"], late["set"]["status_reason"]) == ("hidden", "source_gone")


def test_404_hides_only_on_second_strike_at_least_six_hours_apart(_reset: Any) -> None:
    db = _db(doc())
    fake = FakeRecheck({TB: rec("gone", marker="http_404", http_status=404)})
    run(db, fake)
    r = row(db)
    assert r["gone_strikes"] == 1 and r["status"] == "published"
    assert not any("desapareció" in a for a in _reset["alerts"]), "a single 404 never hides"
    _unlease(db)
    run(db, fake, now=NOW + timedelta(days=1))
    r = row(db)
    assert (r["status"], r["status_reason"]) == ("hidden", "source_gone")
    assert any("desapareció" in a for a in _reset["alerts"])
    assert len(logs(db)) == 2
    hidden = G.public_view(r, NOW + timedelta(days=1), True)
    assert hidden and hidden["start_date"] is None and hidden["ticket_url"] is None


def test_source_gone_row_is_revived_to_review_when_the_page_returns() -> None:
    db = _db(doc(status="hidden", status_reason="source_gone", hidden_at="2026-09-29T12:00:00Z", gone_strikes=2))
    fake = FakeRecheck({TB: rec("success", parsed={"start_date": "2026-11-12", "end_date": "2026-11-12",
                                                   "start_time": "19:00"})})
    run(db, fake)
    r = row(db)
    assert (r["status"], r["status_reason"]) == ("review", "source_changed")
    assert r["gone_strikes"] == 0


def test_source_gone_older_than_seven_days_is_not_rechecked() -> None:
    db = _db(doc(status="hidden", status_reason="source_gone", hidden_at="2026-09-01T12:00:00Z"))
    fake = FakeRecheck({TB: rec("success")})
    run(db, fake)
    assert fake.calls == [] and row(db)["status"] == "hidden"


# ── cancel marker / head changed ─────────────────────────────────────────────


def test_cancel_marker_hides_alerts_and_logs(_reset: Any) -> None:
    db = _db(doc())
    run(db, FakeRecheck({TB: rec("cancel_marker", marker="cancelado")}))
    r = row(db)
    assert (r["status"], r["status_reason"]) == ("hidden", "cancel_marker")
    assert any("cancelado" in a for a in _reset["alerts"])
    assert logs(db)[-1]["to"] == "hidden"
    # sticky: a later success never revives a cancel marker on its own
    _unlease(db)
    run(db, FakeRecheck({TB: rec("success")}), now=NOW + timedelta(days=1))
    assert row(db)["status"] == "hidden"


def test_head_changed_goes_to_review_source_changed(_reset: Any) -> None:
    db = _db(doc())
    run(db, FakeRecheck({TB: rec("changed", marker="source_changed", head={"etag": "b"})}))
    r = row(db)
    assert (r["status"], r["status_reason"]) == ("review", "source_changed")
    assert any("PDF" in a for a in _reset["alerts"])


# ── date / time changes ──────────────────────────────────────────────────────


def test_date_change_single_source_goes_to_review_with_alert_and_dates_untouched(_reset: Any) -> None:
    db = _db(doc())
    fake = FakeRecheck({TB: rec("date_changed", marker="nueva fecha",
                                parsed={"start_date": "2026-11-20", "end_date": "2026-11-20", "start_time": "19:00"})})
    run(db, fake)
    r = row(db)
    assert (r["status"], r["status_reason"]) == ("review", "date_changed")
    assert r["start_date"] == "2026-11-12", "a single page never moves a date"
    assert r["proposed_dates"]["start_date"] == "2026-11-20"
    assert any("2026-11-20" in a for a in _reset["alerts"])
    assert logs(db)[-1]["to"] == "review"
    view = G.public_view(r, NOW, True)
    assert view and view["start_date"] is None, "review rows never expose a date"


def test_date_change_applied_when_two_independent_tier1_3_pages_agree() -> None:
    d = doc(url=IPCC, tier=1, second_source_url=CCC, second_source_name="CCC", second_source_tier=3,
            evidence=[_ev(IPCC, "Jueves 12 de noviembre de 2026", 1), _ev(CCC, "Jueves 12 de noviembre de 2026", 3)])
    db = _db(d)
    new = {"start_date": "2026-11-19", "end_date": "2026-11-19", "start_time": None}
    fake = FakeRecheck({IPCC: rec("date_changed", parsed=new, found_date_text="Jueves 19 de noviembre de 2026"),
                        CCC: rec("date_changed", parsed=new, found_date_text="19 de noviembre de 2026")})
    run(db, fake)
    r = row(db)
    assert r["start_date"] == "2026-11-19" and r["status"] == "published"
    assert r["date_history"][-1]["from"]["start_date"] == "2026-11-12"
    assert r["date_history"][-1]["to"]["start_date"] == "2026-11-19"
    assert r["canonical_key"] == d["canonical_key"], "canonical_key is never recomputed (§15 P1)"
    assert r["event_id"] == d["event_id"], "event_id is immutable (§15 P2)"
    assert any(lg["reason"] is None or lg.get("detail") for lg in logs(db))


def test_mirror_pages_do_not_count_as_two_sources() -> None:
    alc = "https://www.cartagena.gov.co/noticias/concierto-sinfonico"
    d = doc(url=IPCC, tier=1, second_source_url=alc, second_source_tier=1,
            evidence=[_ev(IPCC, "12 de noviembre de 2026", 1), _ev(alc, "12 de noviembre de 2026", 1)])
    db = _db(d)
    new = {"start_date": "2026-11-19", "end_date": "2026-11-19", "start_time": None}
    run(db, FakeRecheck({IPCC: rec("date_changed", parsed=new), alc: rec("date_changed", parsed=new)}))
    r = row(db)
    assert (r["status"], r["status_reason"], r["start_date"]) == ("review", "date_changed", "2026-11-12")


def test_time_only_change_nulls_start_time_and_forces_verify(_reset: Any) -> None:
    db = _db(doc())
    run(db, FakeRecheck({TB: rec("date_changed", time_only=True, marker="time_changed",
                                 parsed={"start_date": "2026-11-12", "end_date": "2026-11-12", "start_time": "20:00"})}))
    r = row(db)
    assert r["start_time"] is None and r["time_confirmed"] is False and r["status"] == "published"
    view = pv(db)
    assert view["confidence"] == "VERIFY" and view["notif_eligible"] is False
    assert any("hora" in a for a in _reset["alerts"])


def test_review_conflict_cleared_only_when_two_independent_pages_agree() -> None:
    d = doc(url=IPCC, tier=1, status="review", status_reason="conflict", second_source_url=CCC,
            second_source_tier=3,
            evidence=[_ev(IPCC, "12 de noviembre de 2026", 1), _ev(CCC, "12 de noviembre de 2026", 3)])
    db = _db(d)
    same = {"start_date": "2026-11-12", "end_date": "2026-11-12", "start_time": "19:00"}
    run(db, FakeRecheck({IPCC: rec("success", parsed=same), CCC: rec("success", parsed=same)}))
    r = row(db)
    assert r["status"] == "published" and r["status_reason"] is None

    lone = _db(doc(url=IPCC, tier=1, status="review", status_reason="conflict",
                   evidence=[_ev(IPCC, "12 de noviembre de 2026", 1)]))
    run(lone, FakeRecheck({IPCC: rec("success", parsed=same)}))
    assert (row(lone)["status"], row(lone)["status_reason"]) == ("review", "conflict"), "one page never clears R1"


# ── run mechanics ────────────────────────────────────────────────────────────


def test_every_outcome_writes_a_log_row() -> None:
    outcomes = {"success": rec("success"), "not_found": rec("not_found"), "blocked": rec("blocked", marker="timeout"),
                "gone": rec("gone", marker="http_410", http_status=410),
                "cancel_marker": rec("cancel_marker", marker="aplazado"),
                "date_changed": rec("date_changed", parsed={"start_date": "2026-11-13", "end_date": "2026-11-13",
                                                            "start_time": None})}
    for name, r_ in outcomes.items():
        db = _db(doc())
        run(db, FakeRecheck({TB: r_}))
        assert logs(db), f"{name}: no city_events_log row"


def test_url_fan_out_fetches_each_url_once_and_orders_by_priority() -> None:
    soon = (NOW + timedelta(hours=30)).astimezone(G.BOGOTA).date().isoformat()
    urgent = doc("ce-urgente-20261002-aa11", start=soon, source_keys=["test:u"], canonical_key="urgente|2026|t",
                 last_verified="2026-09-30T23:00:00Z",
                 evidence=[_ev(TB, f"{soon} 19:00", 2, start=soon, fetched="2026-09-30T23:00:00Z")])
    old = doc("ce-viejo-20261112-bb22", source_keys=["test:v"], canonical_key="viejo|2026|t",
              last_verified="2026-09-29T10:00:00Z")
    fresh = doc("ce-fresco-20261112-cc33", source_keys=["test:f"], canonical_key="fresco|2026|t",
                last_verified="2026-10-01T10:00:00Z")
    db = _db(fresh, old, urgent)
    fake = FakeRecheck({TB: rec("blocked", marker="timeout")})
    run(db, fake)
    assert fake.fetches == [TB], "one fetch per unique URL per run (§13 F4)"
    order = [lg["event_id"] for lg in db.city_events_log.rows]
    assert order[0] == "ce-urgente-20261002-aa11", order
    assert order[1:] == ["ce-viejo-20261112-bb22", "ce-fresco-20261112-cc33"], order


def test_dry_run_writes_nothing() -> None:
    db = _db(doc())
    before = [dict(r) for r in db.city_events.rows]
    out = run(db, FakeRecheck({TB: rec("cancel_marker", marker="cancelado")}), dry=True)
    assert out["dry"] is True and out["changes"][0]["outcome"] == "cancel_marker"
    assert db.city_events.rows == before
    assert db.city_events_log.rows == [] and db.city_events_runs.rows == []


def test_lease_held_is_a_noop() -> None:
    db = _db(doc())
    asyncio.run(db.city_events_state.insert_one({"_id": "cursor:sentinel", "lease_until": "2099-01-01T00:00:00Z"}))
    fake = FakeRecheck({TB: rec("success")})
    out = run(db, fake)
    assert out.get("skipped") == "lease_held" and fake.calls == []


def test_poison_row_from_a_dead_lease_is_skipped_and_logged() -> None:
    db = _db(doc())
    asyncio.run(db.city_events_state.insert_one({"_id": "cursor:sentinel", "day": "2026-10-01", "done": False,
                                                 "inflight": "ce-concierto-sinfonico-20261112-ab12",
                                                 "lease_until": "2026-10-01T15:00:00Z"}))
    fake = FakeRecheck({TB: rec("success")})
    run(db, fake)
    assert fake.calls == [], "the row that killed the previous invocation is skipped today"
    assert any(lg["reason"] == "poison_skipped" for lg in logs(db))


def test_expired_rows_are_expired_by_the_sentinel_never_by_a_marker() -> None:
    past = doc("ce-pasado-20260920-dd44", start="2026-09-20", source_keys=["test:p"], canonical_key="pasado|2026|t",
               evidence=[_ev(TB, "20 de septiembre de 2026", 2, start="2026-09-20")])
    db = _db(past)
    run(db, FakeRecheck({}))
    assert row(db, "ce-pasado-20260920-dd44")["status"] == "expired"


def test_digest_is_sent_once_when_the_main_slot_is_done(_reset: Any) -> None:
    db = _db(doc())
    fake = FakeRecheck({TB: rec("success")})
    run(db, fake)
    assert len(_reset["digests"]) == 1 and "published" in _reset["digests"][0]
    asyncio.run(E._send_digest(db, NOW))
    assert len(_reset["digests"]) == 1


def test_today_slot_only_rechecks_events_starting_today() -> None:
    today = doc("ce-hoy-20261001-ee55", start="2026-10-01", source_keys=["test:h"], canonical_key="hoy|2026|t",
                evidence=[_ev(TB, "1 de octubre de 2026", 2, start="2026-10-01")])
    db = _db(today, doc())
    fake = FakeRecheck({TB: rec("success")})
    out = run(db, fake, slot="today")
    assert out["slot"] == "today" and out["rows"] == 1
    assert row(db, "ce-hoy-20261001-ee55")["sentinel_today_day"] == "2026-10-01"


def test_transition_is_pure_and_never_sets_expired() -> None:
    d = doc()
    for outcome in ("success", "not_found", "blocked", "gone", "cancel_marker", "date_changed", "changed"):
        tr = E.sentinel_transition(d, rec(outcome, parsed={"start_date": "2026-11-13", "end_date": "2026-11-13",
                                                          "start_time": None}), NOW)
        assert tr["set"].get("status") != "expired", outcome
    assert d == doc(), "sentinel_transition must not mutate its input"
