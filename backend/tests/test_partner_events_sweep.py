"""P0-B (audit 2026-10-01): NEEDS_REVIEW partner events dead-lettered.

One Telegram + email at submit time, then nothing: no cron read partner_events,
the digest counted city_events only, a pending event whose date passed stayed
pending forever (Casa Bohème Aug 22 → Sep 29). partner_events_sweep.run_sweep
expires past pending rows, counts the live queue and alerts (deduped 6 h).
In-memory StubDB + a fake Telegram sender; server.py is never imported.
"""
import asyncio
import logging
import os
import sys
import types
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from events_service_stubs import StubDB, server_block, server_src  # noqa: E402
import partner_events_sweep as S  # noqa: E402

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 2026-10-01 20:30 UTC = 15:30 Bogotá → today (Bogotá) = 2026-10-01
NOW = datetime(2026, 10, 1, 20, 30, tzinfo=timezone.utc)
TODAY = "2026-10-01"


def _ev(eid: str, *, date: str, date_end: Any = None, age_h: float = 0.5, status: str = "pending",
        partner_id: str = "ptr_boheme", title: str = "Noche de jazz") -> Dict[str, Any]:
    return {"event_id": eid, "partner_id": partner_id, "title": title, "date": date, "date_end": date_end,
            "moderation_status": status, "is_published": status == "approved",
            "created_at": (NOW - timedelta(hours=age_h)).isoformat()}


class _Sender:
    def __init__(self, sent: int = 1) -> None:
        self.texts: List[str] = []
        self.sent = sent

    async def __call__(self, text: str) -> Dict[str, Any]:
        self.texts.append(text)
        return {"configured": True, "sent": self.sent, "chats": 1, "errors": [] if self.sent else ["http_400"]}


def _db(*events: Dict[str, Any]) -> StubDB:
    db = StubDB()
    for e in events:
        asyncio.run(db.partner_events.insert_one(e))
    asyncio.run(db.partners.insert_one({"partner_id": "ptr_boheme", "name": "Casa Bohème"}))
    return db


def _run(db: StubDB, sender: _Sender, now: datetime = NOW, **kw: Any) -> Dict[str, Any]:
    return asyncio.run(S.run_sweep(db, now=now, send=sender, **kw))


# ── expire rule: date_end wins, else date; undated never expires ─────────────

def test_is_expired_uses_date_end_then_date() -> None:
    assert S.is_expired({"date": "2026-09-30"}, TODAY)                            # yesterday → expired
    assert not S.is_expired({"date": "2026-10-01"}, TODAY)                        # today → still reviewable
    assert not S.is_expired({"date": "2026-09-30", "date_end": "2026-10-01"}, TODAY)  # overnight into today
    assert not S.is_expired({"date": "2026-09-28", "date_end": "2026-10-05"}, TODAY)  # multi-day still running
    assert S.is_expired({"date": "2026-09-28", "date_end": "2026-09-30"}, TODAY)
    assert not S.is_expired({"date": "", "date_end": None}, TODAY)                # undated: never


def test_sweep_expires_past_pending_only_and_keeps_the_row() -> None:
    db = _db(
        _ev("pe_old", date="2026-09-20"),                                  # past, pending → expired
        _ev("pe_overnight", date="2026-09-30", date_end="2026-10-01"),      # ends today → live
        _ev("pe_future", date="2026-10-10"),                                # live
        _ev("pe_approved_old", date="2026-09-01", status="approved"),       # not pending → untouched
    )
    out = _run(db, _Sender())
    rows = {r["event_id"]: r for r in db.partner_events.rows}
    assert out["expired"] == 1 and out["pending_live"] == 2 and out["scanned"] == 3
    assert rows["pe_old"]["moderation_status"] == "expired_unreviewed"
    assert rows["pe_old"]["is_published"] is False and rows["pe_old"]["expired_unreviewed_at"]
    assert rows["pe_overnight"]["moderation_status"] == "pending"
    assert rows["pe_future"]["moderation_status"] == "pending"
    assert rows["pe_approved_old"]["moderation_status"] == "approved"
    assert len(db.partner_events.rows) == 4, "expired rows are never deleted"


def test_sweep_is_idempotent() -> None:
    db = _db(_ev("pe_old", date="2026-09-20"))
    _run(db, _Sender())
    out = _run(db, _Sender())
    assert out["expired"] == 0 and out["scanned"] == 0


# ── alert only when the oldest live pending is older than 2 h ────────────────

def test_no_alert_when_the_queue_is_fresh() -> None:
    db = _db(_ev("pe_a", date="2026-10-10", age_h=1.5), _ev("pe_b", date="2026-10-11", age_h=0.2))
    s = _Sender()
    out = _run(db, s)
    assert out["alert_due"] is False and out["alerted"] is False and out["alert_skipped"] == "not_due"
    assert s.texts == []


def test_alert_fires_with_count_age_titles_partner_and_link() -> None:
    db = _db(_ev("pe_a", date="2026-10-10", age_h=26, title="Noche de jazz"),
             _ev("pe_b", date="2026-10-11", age_h=3, title="Brunch & Beats"))
    s = _Sender()
    out = _run(db, s)
    assert out["alert_due"] and out["alerted"] is True and out["oldest_age_h"] == 26.0
    assert len(s.texts) == 1
    txt = s.texts[0]
    assert "2 pendientes" in txt and "26 h" in txt
    assert "Casa Bohème" in txt and "Noche de jazz" in txt and "Brunch & Beats" in txt
    assert S.ADMIN_QUEUE_URL in txt


def test_alert_caps_titles_at_five() -> None:
    db = _db(*[_ev(f"pe_{i}", date="2026-10-10", age_h=5 + i, title=f"Evento {i}") for i in range(8)])
    s = _Sender()
    _run(db, s)
    assert s.texts[0].count("• ") == 5 and "y 3 más" in s.texts[0]


def test_expired_rows_do_not_count_toward_the_alert() -> None:
    db = _db(_ev("pe_old", date="2026-09-01", age_h=700))   # expired this run, nothing live
    s = _Sender()
    out = _run(db, s)
    assert out["expired"] == 1 and out["pending_live"] == 0
    assert out["alert_due"] is False and s.texts == []


# ── dedupe: once per 6 h, released when Telegram did not deliver ─────────────

def test_alert_is_deduped_within_six_hours_and_resumes_after() -> None:
    db = _db(_ev("pe_a", date="2026-10-20", age_h=10))
    s = _Sender()
    assert _run(db, s)["alerted"] is True
    again = _run(db, s, now=NOW + timedelta(hours=1))
    assert again["alerted"] is False and again["alert_skipped"] == "deduped"
    assert _run(db, s, now=NOW + timedelta(hours=5, minutes=59))["alert_skipped"] == "deduped"
    assert len(s.texts) == 1
    later = _run(db, s, now=NOW + timedelta(hours=6, minutes=1))
    assert later["alerted"] is True and len(s.texts) == 2
    state = db.cron_state.rows[0]
    assert state["_id"] == S.STATE_ID and state["last_alert_at"].startswith("2026-10-02T02:31")


def test_undelivered_alert_releases_the_slot_for_the_next_tick(caplog: pytest.LogCaptureFixture) -> None:
    db = _db(_ev("pe_a", date="2026-10-20", age_h=10))
    dead = _Sender(sent=0)
    with caplog.at_level(logging.WARNING, logger="partner_events_sweep"):
        out = _run(db, dead)
    assert out["alerted"] is False and out["alert_skipped"] == "not_delivered"
    assert any("not delivered" in r.getMessage() for r in caplog.records)
    assert "last_alert_at" not in db.cron_state.rows[0]
    ok = _Sender()
    assert _run(db, ok, now=NOW + timedelta(minutes=30))["alerted"] is True   # retried, not burned for 6 h


def test_dry_run_writes_nothing_and_never_alerts() -> None:
    db = _db(_ev("pe_old", date="2026-09-20"), _ev("pe_a", date="2026-10-20", age_h=10))
    s = _Sender()
    out = _run(db, s, dry=True)
    assert out["dry"] is True and out["expired"] == 0 and out["would_expire"] == 1 and out["alert_due"] is True
    assert out["alerted"] is False and s.texts == []
    assert {r["moderation_status"] for r in db.partner_events.rows} == {"pending"}
    assert db.cron_state.rows == []


# ── digest summary ───────────────────────────────────────────────────────────

def test_pending_summary_counts_live_pending_and_oldest_age() -> None:
    db = _db(_ev("pe_old", date="2026-09-01", age_h=700), _ev("pe_a", date="2026-10-20", age_h=30),
             _ev("pe_b", date="2026-10-21", age_h=2))
    out = asyncio.run(S.pending_summary(db, NOW))
    assert out == {"count": 2, "oldest_age_h": 30.0}
    assert asyncio.run(S.pending_summary(StubDB(), NOW)) == {"count": 0, "oldest_age_h": None}


def test_digest_includes_the_partner_events_line() -> None:
    with open(os.path.join(BACKEND, "events_elite.py"), encoding="utf-8") as f:
        src = f.read()
    blk = src[src.index("async def _send_digest("):]
    blk = blk[: blk.index("\n\n\n")]
    assert "partner_events_sweep" in blk and "pending_summary(db_, now)" in blk
    assert "Eventos de partners pendientes de revisión" in blk
    assert blk.index("pending_summary") < blk.index("telegram_alerts.digest("), "summary must be built before the send"


# ── route: cron secret only, GET + POST (Vercel invokes crons with GET) ───────

def _client(monkeypatch: pytest.MonkeyPatch, db: StubDB) -> TestClient:
    fake_server = types.ModuleType("server")

    async def _check_rate_limit(key: str, max_calls: int = 10, window_sec: int = 60) -> None:
        return None

    fake_server._check_rate_limit = _check_rate_limit  # type: ignore[attr-defined]
    fake_server._client_ip = lambda request: "1.2.3.4"  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "server", fake_server)
    monkeypatch.setenv("CRON_SECRET", "s3cret-cron")
    S.init(db_=db)
    app = FastAPI()
    app.include_router(S.router, prefix="/api")
    return TestClient(app)


def test_route_requires_the_cron_bearer(monkeypatch: pytest.MonkeyPatch) -> None:
    c = _client(monkeypatch, _db())
    assert c.get("/api/cron/partner-events/sweep").status_code == 403
    assert c.post("/api/cron/partner-events/sweep", headers={"Authorization": "Bearer nope"}).status_code == 403
    r = c.get("/api/cron/partner-events/sweep", headers={"Authorization": "Bearer s3cret-cron"})
    assert r.status_code == 200 and r.json()["scanned"] == 0
    r2 = c.post("/api/cron/partner-events/sweep?dry=1", headers={"Authorization": "Bearer s3cret-cron"})
    assert r2.status_code == 200 and r2.json()["dry"] is True


def test_route_without_secret_configured_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    c = _client(monkeypatch, _db())
    monkeypatch.delenv("CRON_SECRET", raising=False)
    assert c.get("/api/cron/partner-events/sweep", headers={"Authorization": "Bearer "}).status_code == 403


# ── wiring guards ────────────────────────────────────────────────────────────

def test_cron_is_scheduled_and_router_mounted() -> None:
    import json
    with open(os.path.join(BACKEND, "vercel.json"), encoding="utf-8") as f:
        crons = {c["path"]: c["schedule"] for c in json.load(f)["crons"]}
    assert crons.get("/api/cron/partner-events/sweep") == "*/30 * * * *"
    src = server_src()
    assert "import partner_events_sweep as _partner_events_sweep" in src
    assert "app.include_router(_partner_events_sweep.router, prefix=\"/api\")" in src
    assert src.index("_partner_events_sweep.router") < src.index("app.include_router(api_router)")


# ── submit-time alert: LLM-unavailable is named, undelivered sends are logged ─

def test_submit_alert_distinguishes_llm_unavailable_and_logs_no_delivery(
        monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    from test_partner_event_visibility import BODY, _Req, _ns, _partner  # the P0-A exec harness

    mod = types.ModuleType("ai_moderation")

    async def moderate_event(**kw: Any) -> Dict[str, Any]:   # ai_moderation's own fallback shape
        return {"verdict": "NEEDS_REVIEW", "category": "music", "category_changed": False, "completeness_score": 50,
                "improved_description": "", "tags": [], "reason": "Moderación IA no disponible — revisar manualmente",
                "issues": ["llm_unavailable"]}

    mod.moderate_event = moderate_event  # type: ignore[attr-defined]
    tg = types.ModuleType("telegram_alerts")
    texts: List[str] = []

    async def send(text: Any, **_k: Any) -> Dict[str, Any]:
        texts.append(str(text))
        return {"configured": False, "sent": 0, "chats": 0, "errors": []}   # not configured → dropped

    tg.send = send  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "ai_moderation", mod)
    monkeypatch.setitem(sys.modules, "telegram_alerts", tg)
    ns = _ns(StubDB(), _partner())
    with caplog.at_level(logging.WARNING, logger="test"):
        out = asyncio.run(ns["business_create_event"](_Req(dict(BODY))))
    assert out["moderation_status"] == "pending" and out["is_published"] is False
    assert len(texts) == 1 and "NO DISPONIBLE" in texts[0] and "SIN revisar" in texts[0]
    assert any("NOT delivered" in r.getMessage() for r in caplog.records)


def test_submit_alert_keeps_the_plain_hold_wording_for_a_real_review() -> None:
    blk = server_block('@api_router.post("/business/events")')
    assert "🔎 Evento de partner EN REVISIÓN — NO publicado" in blk
    assert "⚠️ Moderación IA NO DISPONIBLE" in blk
    assert 'llm_down = "llm_unavailable" in (mod.get("issues") or [])' in blk
    edit = server_block('@api_router.put("/business/events/{event_id}")')
    assert "NOT delivered" in blk and "NOT delivered" in edit
