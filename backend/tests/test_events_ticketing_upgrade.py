"""DROP 3B — cross-source date-conflict upgrade + per-source review probation.

The Buena Vida case, as tests: an aggregator row holding the WRONG date must be
matched (not twinned) by the primary ticketer's page, upgraded in place, and the
corrected date must land as PROPOSED — a human approve applies it. An aggregator
can never overwrite a primary. And flags.review_only_sources holds a source's
gate-clean NEW rows in review (sticky) until a human promotes them.
"""
from __future__ import annotations

import asyncio
import os
import sys
from typing import Any, Dict, Optional

import pytest
from fastapi import HTTPException

TESTS = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(TESTS)
for p in (BACKEND, TESTS):
    if p not in sys.path:
        sys.path.insert(0, p)

import events_elite as E  # noqa: E402
import events_gate as G  # noqa: E402
import events_runtime as R  # noqa: E402
import test_events_pull as TP  # noqa: E402

NOW = TP.NOW
LT = TP.LT
TB = TP.TB
CP = {"key": "cartagenaplay", "name": "Cartagenaplay (agregador)", "tier": 6, "role": "review"}

BV_TITLE = "Buena vida Beach 2027 - Cartagena"
CP_URL = "https://cartagenaplay.com/event/buena-vida-beach-2027-cartagena/"
LT_BV_URL = "https://latiquetera.com/event/buena-vida-beach-2027"


def _aggregator_row(**over: Any) -> Dict[str, Any]:
    """The ghost: an aggregator-sourced review row carrying the WRONG date (June)."""
    d: Dict[str, Any] = {
        "event_id": "ce-buena-vida-beach-2027-cartagena-20270608-aaaa",
        "canonical_key": "k-buena-vida-cp", "match_key": "k-buena-vida-cp",
        "title": {"es": BV_TITLE}, "category": "nightlife", "edition_year": 2027,
        "start_date": "2027-06-08", "end_date": "2027-06-08", "start_time": "16:00",
        "venue_name": "", "source_url": CP_URL,
        "source_name": "Cartagenaplay (agregador)", "source_tier": 6, "source_key": "cartagenaplay",
        "source_keys": ["cartagenaplay:buena-vida-beach-2027-cartagena"],
        "evidence": [{"url": CP_URL, "tier": 6, "fetched_at": "2026-09-30T12:00:00Z",
                      "http_status": 200, "date_text": "8 de junio de 2027", "date_visible": True}],
        "last_verified": "2026-09-30T12:00:00Z", "country_check": "pass", "country_signals": ["pass:t"],
        "status": "review", "status_reason": "aggregator_only", "confidence": "VERIFY",
        "notif_eligible": False, "origin": "pipeline",
    }
    d.update(over)
    return d


def _lt_candidate(**over: Any) -> Dict[str, Any]:
    kw: Dict[str, Any] = dict(
        url=LT_BV_URL, native="buena-vida-beach-2027", title=BV_TITLE,
        start="2027-01-08", time_="14:00", venue="Punta Canoas",
        date_text="8 de enero de 2027 · 2:00 p. m.",
        page_text="La Tiquetera · Cartagena de Indias, Bolívar, Colombia",
    )
    kw.update(over)
    return TP.cand(LT, **kw)


# ── the Buena Vida proof: conflict-match → upgrade in place → approve applies ──

def test_primary_corrects_aggregator_date_and_upgrades_source() -> None:
    db = TP.new_db()
    asyncio.run(db.city_events.insert_one(_aggregator_row()))
    out = TP.pull(db, [TP.entry(LT, [_lt_candidate()])])
    assert out.get("counts", {}).get("inserted", 0) == 0, "never a twin"
    rows = TP.docs(db)
    assert len(rows) == 1
    d = rows[0]
    # source upgraded in place; the aggregator is demoted, never erased
    assert d["source_name"] == "La Tiquetera" and d["source_tier"] == 2
    assert d["source_url"] == LT_BV_URL
    assert d["second_source_tier"] == 6 and "cartagenaplay" in d["second_source_url"]
    # the corrected date is PROPOSED, not silently applied
    assert d["status"] == "review" and d["status_reason"] == "date_changed"
    assert d["start_date"] == "2027-06-08", "stored date untouched until a human approves"
    assert d["proposed_dates"]["start_date"] == "2027-01-08"
    # a human approve applies the primary's date and publishes
    res = asyncio.run(E.approve_event(db, d["event_id"], actor="admin:t", now=NOW))
    assert res["status"] == "published"
    d2 = TP.docs(db)[0]
    assert (d2["start_date"], d2["end_date"]) == ("2027-01-08", "2027-01-08")
    assert d2["date_history"][-1]["to"]["start_date"] == "2027-01-08"


def test_aggregator_never_overwrites_a_primary_row() -> None:
    """The mirror case: the WRONG-date candidate arrives from the aggregator while the
    primary-sourced row already exists. It must not touch the primary — it twins into
    review (aggregator_only), where a human can kill it."""
    db = TP.new_db()
    primary = _aggregator_row(
        event_id="ce-buena-vida-beach-2027-cartagena-20270108-bbbb",
        canonical_key="k-buena-vida-lt", match_key="k-buena-vida-lt",
        start_date="2027-01-08", end_date="2027-01-08", start_time="14:00",
        venue_name="Punta Canoas", source_url=LT_BV_URL, source_name="La Tiquetera",
        source_tier=2, source_key="latiquetera", source_keys=["latiquetera:buena-vida-beach-2027"],
        evidence=[{"url": LT_BV_URL, "tier": 2, "fetched_at": "2026-09-30T12:00:00Z",
                   "http_status": 200, "date_text": "8 de enero de 2027", "date_visible": True}],
        status="published", status_reason=None,
    )
    asyncio.run(db.city_events.insert_one(primary))
    cp_cand = TP.cand(CP, url=CP_URL, native="buena-vida-cp", title=BV_TITLE,
                      start="2027-06-08", time_="16:00", venue=None,
                      date_text="8 de junio de 2027",
                      page_text="Cartagenaplay · Cartagena de Indias, Bolívar")
    TP.pull(db, [TP.entry(CP, [cp_cand])])
    rows = TP.docs(db)
    keep = [r for r in rows if r["event_id"] == primary["event_id"]][0]
    assert keep["source_name"] == "La Tiquetera" and keep["source_tier"] == 2
    assert keep["start_date"] == "2027-01-08" and keep["status"] == "published"
    others = [r for r in rows if r["event_id"] != primary["event_id"]]
    assert all(r["status"] == "review" for r in others), "the aggregator twin waits for a human"


def test_same_date_rows_still_take_the_fuzzy_merge_path() -> None:
    """Same dates = the existing fuzzy merge (source upgrade, no date drama)."""
    db = TP.new_db()
    asyncio.run(db.city_events.insert_one(_aggregator_row(
        start_date="2027-01-08", end_date="2027-01-08", start_time=None)))
    TP.pull(db, [TP.entry(LT, [_lt_candidate()])])
    rows = TP.docs(db)
    assert len(rows) == 1
    d = rows[0]
    assert d["source_name"] == "La Tiquetera" and d["source_tier"] == 2
    assert d["status_reason"] != "date_changed"
    assert d["start_date"] == "2027-01-08"


# ── review probation (flags.review_only_sources) ─────────────────────────────

def _set_flags(db: Any, **flags: Any) -> None:
    asyncio.run(db.city_events_state.update_one(
        {"_id": "flags"}, {"$set": {"enabled": True, **flags}}, upsert=True))
    R.invalidate_caches()


def test_review_only_source_holds_gate_clean_insert_sticky_until_approve() -> None:
    db = TP.new_db()
    _set_flags(db, review_only_sources=["tuboleta"])
    TP.pull(db, [TP.entry(TB, [TP.cand(TB)])])
    d = TP.docs(db)[0]
    assert d["status"] == "review" and d["status_reason"] == "source_probation"
    # sticky: a later evaluate() must NOT flip it live on its own
    ev = G.evaluate(d, NOW)
    assert ev["status"] == "review" and ev["status_reason"] == "source_probation"
    # a human approve clears probation and publishes
    res = asyncio.run(E.approve_event(db, d["event_id"], actor="admin:t", now=NOW))
    assert res["status"] == "published"


def test_unflagged_source_publishes_gate_clean_as_before() -> None:
    db = TP.new_db()
    _set_flags(db, review_only_sources=[])
    TP.pull(db, [TP.entry(TB, [TP.cand(TB)])])
    d = TP.docs(db)[0]
    assert d["status"] == "published"


def test_patch_flags_review_only_validation_and_roundtrip() -> None:
    db = TP.new_db()
    with pytest.raises(HTTPException) as ei:
        asyncio.run(E.patch_flags(db, {"review_only_sources": ["no-such-source"]}, actor="admin:t"))
    assert ei.value.status_code == 400 and ei.value.detail["error"] == "unknown_sources"
    out = asyncio.run(E.patch_flags(db, {"enabled": True, "review_only_sources": ["latiquetera"]}, actor="admin:t"))
    assert out["flags"]["review_only_sources"] == ["latiquetera"]
