"""DROP A1 — autopublish audit stream: provenance, retract, suppression, restore.

The stream shows ONLY what the machine put public unattended (autopublished_at
set, approved_by absent). Retract = hidden/"operator_retracted" — and because
EVERY hidden is sticky (§15 R1), the next cron pulling the same clean candidate
must NOT republish it: that suppression rail is the load-bearing test here.

Run: cd backend && python -m pytest -q tests/test_autopublish_audit.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from typing import Any, Dict

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(TESTS)
for p in (BACKEND, TESTS):
    if p not in sys.path:
        sys.path.insert(0, p)

import events_elite as E  # noqa: E402
import events_runtime as R  # noqa: E402
import telegram_alerts as T  # noqa: E402
import test_events_pull as TP  # noqa: E402

NOW = TP.NOW


@pytest.fixture(autouse=True)
def _reset(monkeypatch: pytest.MonkeyPatch) -> None:
    R.invalidate_caches()

    async def fake_send(text: Any, **_k: Any) -> Dict[str, Any]:
        return {"configured": False, "sent": 0, "chats": 0, "errors": []}

    monkeypatch.setattr(T, "send", fake_send)


def _pull_one(db: Any) -> Dict[str, Any]:
    TP.pull(db, [TP.entry(TP.TB, [TP.cand(TP.TB)])])
    return TP.docs(db)[0]


def test_autopublish_stamps_provenance_and_streams_it() -> None:
    db = TP.new_db()
    d = _pull_one(db)
    assert d["status"] == "published"
    assert d.get("autopublished_at"), "machine-published rows must carry the stamp"
    assert not d.get("approved_by")
    rows = asyncio.run(E.list_autopublished(db))
    assert [r["event_id"] for r in rows] == [d["event_id"]]
    r = rows[0]
    assert r["source_key"] == d["source_key"] and r["status"] == "published"
    assert r["autopublished_at"] == d["autopublished_at"]
    assert r["min_evidence_tier"] is not None  # the why-it-passed facts ride along


def test_operator_approved_rows_never_appear() -> None:
    db = TP.new_db()
    d = _pull_one(db)
    res = asyncio.run(E.approve_event(db, d["event_id"], actor="admin:t", now=NOW))
    assert res["status"] == "published"
    assert asyncio.run(E.list_autopublished(db)) == []
    # and retract refuses a human-approved row (that is /hide's job)
    from fastapi import HTTPException as HX
    with pytest.raises(HX) as ex:
        asyncio.run(E.retract_event(db, d["event_id"], actor="admin:t", now=NOW))
    assert ex.value.status_code == 409


def test_retract_hides_and_the_next_cron_cannot_republish() -> None:
    """THE suppression rail: retract, then re-pull the SAME gate-clean candidate —
    the row must stay hidden (every hidden is sticky), not flip back to published."""
    db = TP.new_db()
    d = _pull_one(db)
    out = asyncio.run(E.retract_event(db, d["event_id"], actor="admin:t", note="bad row", now=NOW))
    assert out == {"event_id": d["event_id"], "status": "hidden", "status_reason": "operator_retracted"}
    row = TP.docs(db)[0]
    assert row["status"] == "hidden" and row["status_reason"] == "operator_retracted"
    assert row["retracted_by"] == "admin:t" and row["retracted_at"]
    # the next 3B cron run, same source, same clean candidate:
    TP.pull(db, [TP.entry(TP.TB, [TP.cand(TP.TB)])])
    after = TP.docs(db)
    assert len(after) == 1, "the cron must merge, never duplicate a suppressed row"
    assert after[0]["status"] == "hidden", "SUPPRESSION BROKEN: the cron republished a retracted row"
    assert after[0]["status_reason"] == "operator_retracted"
    # evaluate() directly agrees (structural stickiness, not a side effect)
    import events_gate as G
    ev = G.evaluate(after[0], NOW)
    assert ev["status"] == "hidden" and ev["status_reason"] == "operator_retracted"
    # still visible in the stream, marked retracted, with the un-retract facts
    rows = asyncio.run(E.list_autopublished(db))
    assert rows and rows[0]["retracted_at"] and rows[0]["status"] == "hidden"


def test_unretract_restores_to_machine_custody() -> None:
    db = TP.new_db()
    d = _pull_one(db)
    asyncio.run(E.retract_event(db, d["event_id"], actor="admin:t", now=NOW))
    res = asyncio.run(E.unretract_event(db, d["event_id"], actor="admin:t", now=NOW))
    assert res["status"] == "published"
    row = TP.docs(db)[0]
    assert row["status"] == "published" and not row.get("retracted_at")
    assert row["restored_by"] == "admin:t"
    assert not row.get("approved_by"), "restore hands the row BACK to the machine"
    rows = asyncio.run(E.list_autopublished(db))
    assert [r["event_id"] for r in rows] == [d["event_id"]]
    # a second restore is refused (nothing to reverse)
    from fastapi import HTTPException as HX
    with pytest.raises(HX):
        asyncio.run(E.unretract_event(db, d["event_id"], actor="admin:t", now=NOW))
