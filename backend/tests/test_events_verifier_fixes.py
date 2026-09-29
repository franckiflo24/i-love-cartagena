"""EVENTS-ELITE: regression tests for the independent verifiers' findings (pipeline, sentinel,
reminders, platform). Each test fails on the pre-fix code and passes after the fix.

Pure: stub DB, httpx MockTransport pages, the real saved IPCC fixture. Never imports server.py.

Run: cd backend && python -m pytest -q tests/test_events_verifier_fixes.py
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
import types
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Tuple

import httpx
import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS = os.path.dirname(os.path.abspath(__file__))
for p in (BACKEND, TESTS):
    if p not in sys.path:
        sys.path.insert(0, p)

import events_elite as E  # noqa: E402
import events_gate as G  # noqa: E402
import events_runtime as R  # noqa: E402
import events_sources as S  # noqa: E402
import telegram_alerts as T  # noqa: E402
import test_events_pull as TP  # noqa: E402
import test_events_reminders as TR  # noqa: E402
import webpush as W  # noqa: E402
from events_service_stubs import StubDB, with_event_indexes  # noqa: E402

UTC = timezone.utc
_REAL_TG_SEND = T.send          # captured before the autouse fixture swaps in a fake
FIX = os.path.join(TESTS, "fixtures", "events", "sources", "ipcc_art_programacion_fiestas_2026.html")
NOW = datetime(2026, 10, 1, 11, 0, tzinfo=UTC)
OLD_DT = "Jueves 12 de noviembre de 2026 · 7:00 p. m."
NOTICE_PAGE = (f"<html><head><title>Concierto Sinfónico</title></head><body><main><h1>Concierto Sinfónico</h1>"
               f"<p>Fecha original: {OLD_DT}</p>"
               f"<p><strong>NUEVA FECHA:</strong> Sábado 5 de diciembre de 2026 · 7:00 p. m.</p>"
               f"<p>Teatro Adolfo Mejía, Cartagena de Indias</p></main></body></html>")


@pytest.fixture(autouse=True)
def _reset(monkeypatch: pytest.MonkeyPatch) -> Dict[str, List[str]]:
    R.invalidate_caches()
    sent: Dict[str, List[str]] = {"alerts": []}

    async def fake_send(text: Any, **_k: Any) -> Dict[str, Any]:
        sent["alerts"].append(str(text))
        return {"configured": False, "sent": 0, "chats": 0, "errors": []}

    async def fake_digest(title: str, lines: Any, **_k: Any) -> Dict[str, Any]:
        return {"configured": False, "sent": 0, "chats": 0, "errors": []}

    monkeypatch.setattr(T, "send", fake_send)
    monkeypatch.setattr(T, "digest", fake_digest)
    return sent


def _client(html: str) -> httpx.AsyncClient:
    return S.make_client(httpx.MockTransport(
        lambda r: httpx.Response(200, text=html, headers={"content-type": "text/html; charset=utf-8"})))


def _generic_doc(url: str = "https://www.teatroejemplo.co/eventos/concierto-sinfonico", **over: Any) -> Dict[str, Any]:
    d = {"event_id": "ce-concierto-sinfonico-20261112-a467", "title": {"es": "Concierto Sinfónico"},
         "start_date": "2026-11-12", "end_date": "2026-11-12", "start_time": "19:00",
         "source_url": url, "recheck_url": url,
         "evidence": [{"url": url, "date_text": OLD_DT, "tier": 3, "fetched_at": "2026-10-01T10:00:00Z",
                       "http_status": 200}]}
    d.update(over)
    return d


async def _recheck(doc: Dict[str, Any], html: str) -> Dict[str, Any]:
    client = _client(html)
    try:
        return await S.recheck_doc(client, doc, now_utc=NOW)
    finally:
        await client.aclose()


# ── H1: "nueva fecha" / "cambio de fecha" is a date change even with the old date printed ────


def test_nueva_fecha_notice_with_old_date_still_printed_is_date_changed() -> None:
    rec = asyncio.run(_recheck(_generic_doc(), NOTICE_PAGE))
    assert rec["outcome"] == "date_changed" and str(rec["marker"]).startswith("date_notice:")
    row = f"<html><body><h1>Concierto Sinfónico</h1><p>{OLD_DT} — Cambio de fecha: consulta la nueva programación</p></body></html>"
    rec2 = asyncio.run(_recheck(_generic_doc(), row))
    assert rec2["outcome"] == "date_changed" and "cambio de fecha" in str(rec2["marker"])


def test_sentinel_never_auto_clears_a_notice_that_parses_to_the_stored_date() -> None:
    doc = {**_generic_doc(), "status": "published", "status_reason": None, "venue_name": "Teatro Adolfo Mejía"}
    rec = S.make_recheck("date_changed", http_status=200, parsed={"start_date": "2026-11-12", "end_date": "2026-11-12",
                                                                 "start_time": "19:00"},
                         marker="date_notice:nueva fecha", found_date_text=OLD_DT)
    agreed = {"start_date": "2026-11-12", "end_date": "2026-11-12", "start_time": "19:00", "urls": [], "entries": []}
    tr = E.sentinel_transition(doc, rec, NOW, agreed=agreed)
    assert tr["set"].get("status") == "review" and tr["set"].get("status_reason") == "date_changed"
    assert "proposed_dates" not in tr["set"] and "last_verified" not in tr["set"]
    assert tr["alert"] and "nueva fecha" in tr["alert"]


def test_reminder_is_suppressed_when_the_source_announces_a_new_date() -> None:
    url = "https://www.teatroejemplo.co/eventos/salsa-a-la-plaza"
    dt = "Jueves 12 de noviembre de 2026 · 7:00 p. m."
    doc = TR.ev_doc(source_url=url, recheck_url=url, source_name="Teatro (organizador)", source_tier=3,
                    evidence=[{"url": url, "name": "Teatro", "tier": 3, "fetched_at": TR.LV_TODAY, "http_status": 200,
                               "date_text": dt, "date_visible": True, "start_date": "2026-11-12",
                               "end_date": "2026-11-12", "start_time": "19:00"}])
    page = (f"<html><body><h1>Salsa a la Plaza</h1><p>Fecha original: {dt}</p>"
            f"<p><b>NUEVA FECHA:</b> Sábado 5 de diciembre de 2026 · 7:00 p. m.</p>"
            f"<p>Plaza de la Aduana, Cartagena de Indias</p></body></html>")
    db = TR.make_db(doc)
    senders = TR.Senders()
    out = asyncio.run(E.run_reminders(db, now=TR.NOW, recheck_fn=S.recheck_doc, client_factory=lambda: _client(page),
                                      push_fn=senders.push, webpush_fn=senders.webpush))
    assert out["sent"] == 0 and senders.expo == [] and senders.web == []
    assert out["suppressed"] and out["suppressed"][0]["outcome"] == "date_changed"


def test_pull_same_source_date_notice_goes_to_review_and_new_notice_rows_are_held() -> None:
    db = TP.new_db()
    TP.pull(db, [TP.entry(TP.LT, [TP.cand(TP.LT, url=TP.LT_URL, native="sinfonico-lt")])])
    TP._unlease(db)
    again = TP.cand(TP.LT, url=TP.LT_URL, native="sinfonico-lt", markers={"date_notice": "nueva fecha"})
    TP.pull(db, [TP.entry(TP.LT, [again])], now=NOW + timedelta(days=1))
    d = TP.docs(db)[0]
    assert (d["status"], d["status_reason"]) == ("review", "date_changed")
    db2 = TP.new_db()
    TP.pull(db2, [TP.entry(TP.TB, [TP.cand(TP.TB, markers={"date_notice": "cambio de fecha"})])])
    d2 = TP.docs(db2)[0]
    assert (d2["status"], d2["status_reason"], d2["confidence"]) == ("review", "date_changed", "VERIFY")


# ── H2: a cancel marker from ANOTHER source is never merged as support ───────────────────────


def test_cross_source_cancel_hides_a_tier2_match_and_never_counts_as_evidence() -> None:
    db = TP.new_db()
    TP.pull(db, [TP.entry(TP.LT, [TP.cand(TP.LT, url=TP.LT_URL, native="sinfonico-lt")])])
    before = dict(TP.docs(db)[0])
    TP._unlease(db)
    tb = TP.cand(TP.TB, url=TP.TB_URL, native="sinfonico-tb", markers={"cancel": "cancelado"},
                 fetched="2026-10-02T10:59:00Z")
    TP.pull(db, [TP.entry(TP.TB, [tb])], now=NOW + timedelta(days=1))
    rows = TP.docs(db)
    assert len(rows) == 1
    d = rows[0]
    assert (d["status"], d["status_reason"]) == ("hidden", "cancel_marker")
    assert [e["url"] for e in d["evidence"]] == [TP.LT_URL]
    assert d["last_verified"] == before["last_verified"]
    assert not any(k.startswith("tuboleta:") for k in d.get("source_keys") or [])


def test_cross_source_cancel_from_a_tier5_page_holds_the_row_in_sticky_review() -> None:
    db = TP.new_db()
    TP.pull(db, [TP.entry(TP.LT, [TP.cand(TP.LT, url=TP.LT_URL, native="sinfonico-lt")])])
    TP._unlease(db)
    eu = {"key": "eluniversal", "name": "El Universal", "tier": 5, "role": "discover"}
    c = TP.cand(eu, url="https://www.eluniversal.com.co/cultural/concierto-sinfonico", native="sinfonico-eu",
                markers={"cancel": "aplazado"})
    TP.pull(db, [TP.entry(eu, [c])], now=NOW + timedelta(days=1))
    d = TP.docs(db)[0]
    assert (d["status"], d["status_reason"]) == ("review", "cancel_reported")
    assert "cancel_reported" in G.STICKY_REVIEW_REASONS
    assert G.evaluate(d, NOW + timedelta(days=1))["status"] == "review"


def test_reminder_is_vetoed_by_a_second_source_that_reports_a_cancellation() -> None:
    second = "https://latiquetera.com/evento/salsa-a-la-plaza"
    doc = TR.ev_doc(second_source_url=second, second_source_name="La Tiquetera", second_source_tier=2)

    async def recheck(client: Any, d: Dict[str, Any], **_k: Any) -> Dict[str, Any]:
        if d.get("recheck_url") == second:
            return {"outcome": "cancel_marker", "marker": "cancelado"}
        return {"outcome": "success", "marker": None}

    db = TR.make_db(doc)
    senders = TR.Senders()
    out = asyncio.run(E.run_reminders(db, now=TR.NOW, recheck_fn=recheck, client_factory=TR.FakeClient,
                                      push_fn=senders.push, webpush_fn=senders.webpush))
    assert out["sent"] == 0 and senders.expo == []
    assert out["suppressed"][0]["marker"].startswith("second_source:")


# ── H3: a cancellation outside the event row / ±400-char window ─────────────────────────────


async def _seeded_anchor(fragment: str) -> Dict[str, Any]:
    db = await with_event_indexes(StubDB())
    await E.seed_anchors(db, now=NOW)
    return next(d for d in db.city_events.rows if fragment in d["event_id"] and "guerra" not in d["event_id"])


def test_postponement_paragraph_outside_the_agenda_row_is_not_a_success() -> None:
    html = open(FIX, encoding="utf-8").read()
    marker = '<p class="wp-block-paragraph">Agenda oficial de las Fiestas de Independencia 2026</p>'
    notice = ('<p class="wp-block-paragraph"><strong>ACTUALIZACIÓN (10 de noviembre):</strong> la Alcaldía informa '
              'que el Festival Náutico de la Independencia y el Bololó del Arsenal quedan APLAZADOS.</p>')
    doc = asyncio.run(_seeded_anchor("nautico"))
    assert asyncio.run(_recheck(doc, html))["outcome"] == "success"
    rec = asyncio.run(_recheck(doc, html.replace(marker, notice + marker)))
    assert rec["outcome"] == "not_found" and rec["marker"].startswith("cancel_near_title:")
    tr = E.sentinel_transition(doc, rec, NOW)
    assert tr["set"]["not_found_count"] == 1 and tr["alert"]          # VERIFY at once + alert, never hidden
    assert "status" not in tr["set"]


def test_cancel_banner_far_from_the_date_line_is_not_a_success() -> None:
    page = ("<html><body><h1>Concierto Sinfónico</h1><div>EVENTO CANCELADO — se reembolsará el valor.</div>"
            + "<p>" + ("La Orquesta Sinfónica presenta un programa del Caribe. " * 14) + "</p>"
            + f"<p>Fecha: {OLD_DT}</p><p>Teatro, Cartagena de Indias</p></body></html>")
    client = _client(page)
    rec = asyncio.run(S.generic_recheck(client, _generic_doc(), now_utc=NOW))
    asyncio.run(client.aclose())
    assert rec["outcome"] == "not_found" and rec["marker"] == "cancel_near_title:cancelado"


def test_every_ipcc_anchor_still_rechecks_clean_on_the_real_page() -> None:
    """No false 'notice near title' / country / venue hits on the real saved page."""
    html = open(FIX, encoding="utf-8").read()

    async def go() -> List[Tuple[str, str, Any]]:
        db = await with_event_indexes(StubDB())
        await E.seed_anchors(db, now=NOW)
        out = []
        for d in db.city_events.rows:
            if "ipcc.gov.co" not in str(d.get("recheck_url")):
                continue
            rec = await _recheck(d, html)
            tr = E.sentinel_transition(d, rec, NOW)
            out.append((d["event_id"], rec["outcome"], tr["set"].get("status_reason")))
        return out

    rows = asyncio.run(go())
    assert len(rows) >= 15
    assert not [r for r in rows if r[1] == "not_found"]
    assert not [r for r in rows if r[2] in ("country_fail", "venue_changed")]


# ── H4: the source moves the event to another municipality / venue ───────────────────────────


def test_recheck_that_moves_the_event_to_turbaco_hides_it_as_country_fail() -> None:
    html = open(FIX, encoding="utf-8").read()
    old = "Noche de Candela y Jolgorio de Tambores (Plaza de los Coches)"
    assert old in html
    moved = html.replace(old, "Noche de Candela y Jolgorio de Tambores (Parque Principal de Turbaco)")
    doc = asyncio.run(_seeded_anchor("candela"))
    rec = asyncio.run(_recheck(doc, moved))
    assert rec["outcome"] == "success" and "Turbaco" in str(rec.get("venue"))
    tr = E.sentinel_transition(doc, rec, NOW)
    assert tr["set"]["country_check"] == "fail" and tr["set"]["status"] == "hidden"
    assert "last_verified" not in tr["set"] and tr["alert"]
    merged = {**doc, **tr["set"]}
    assert G.public_view(merged, NOW, True)["status"] == "hidden"


def test_recheck_naming_another_known_venue_goes_to_venue_changed_review() -> None:
    doc = {"event_id": "ce-x-20261112-aaaa", "title": {"es": "Concierto X"}, "venue_name": "Teatro Adolfo Mejía",
           "lat": 10.4266111, "lng": -75.5511837, "status": "published", "country_signals": [],
           "source_url": "https://tuboleta.com/es/eventos/x", "start_date": "2026-11-12"}
    rec = S.make_recheck("success", http_status=200, found_date_text="12 de noviembre de 2026",
                         parsed={"start_date": "2026-11-12", "end_date": "2026-11-12", "start_time": None},
                         event_text="Concierto X · Estadio Olímpico Jaime Morón León · 12 de noviembre",
                         venue="Estadio Olímpico Jaime Morón León")
    tr = E.sentinel_transition(doc, rec, NOW)
    assert (tr["set"]["status"], tr["set"]["status_reason"]) == ("review", "venue_changed")
    assert "last_verified" not in tr["set"]
    same = S.make_recheck("success", http_status=200, found_date_text="12 de noviembre de 2026",
                          parsed={"start_date": "2026-11-12", "end_date": "2026-11-12", "start_time": None},
                          venue="Teatro Adolfo Mejía")
    assert "status" not in E.sentinel_transition(doc, same, NOW)["set"]


# ── H8: an LLM description never carries a date; a date change clears the stale one ──────────


def test_enrich_rejects_dates_in_descriptions_even_when_verbatim_in_the_source() -> None:
    row = {"title": {"es": "Concierto Sinfónico"}, "venue_name": "Teatro Adolfo Mejía",
           "event_text": "Concierto Sinfónico · Teatro Adolfo Mejía · 12 de noviembre de 2026 · 7:00 p. m.",
           "origin": "pipeline"}
    fields, notes = E.enrich_fields(row, {"description": {
        "es": "Concierto Sinfónico el 12 de noviembre de 2026 en el Teatro Adolfo Mejía.",
        "en": "A symphonic concert at the Teatro Adolfo Mejía."}})
    assert "description.es" not in fields and any("date_in_description" in n for n in notes)
    assert fields.get("description.en")


def test_approving_new_dates_drops_a_description_that_states_the_old_date() -> None:
    db = asyncio.run(with_event_indexes(StubDB()))
    doc = TR.ev_doc(status="review", status_reason="date_changed",
                    description={"es": "Salsa el 12 de noviembre en la plaza.", "en": "Salsa at the plaza."},
                    enriched_at="2026-11-01T00:00:00Z", enrich_attempts=1,
                    proposed_dates={"start_date": "2026-11-13", "end_date": "2026-11-13", "start_time": "19:00"},
                    evidence=[{"url": TR.TB, "name": "TuBoleta", "tier": 2, "fetched_at": TR.LV_TODAY,
                               "http_status": 200, "date_text": "Viernes 13 de noviembre de 2026 · 7:00 p. m.",
                               "date_visible": True, "start_date": "2026-11-13", "end_date": "2026-11-13",
                               "start_time": "19:00"}])
    asyncio.run(db.city_events.insert_one(doc))
    asyncio.run(E.approve_event(db, doc["event_id"], actor="admin", now=TR.NOW))
    d = db.city_events.rows[0]
    assert d["start_date"] == "2026-11-13"
    assert "es" not in d.get("description", {}) and d["description"].get("en") == "Salsa at the plaza."
    assert "enriched_at" not in d and "enrich_attempts" not in d


# ── B1: the Telegram bot token never reaches any log record ───────────────────────────────────


def test_telegram_token_is_not_logged_by_httpx_at_info(monkeypatch: pytest.MonkeyPatch,
                                                         caplog: pytest.LogCaptureFixture) -> None:
    token = "123456789:AAFAKE-SECRET-TOKEN-xyz"
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", token)
    monkeypatch.setenv("TELEGRAM_ALERT_CHAT_IDS", "111")
    T.reset_budget()
    caplog.set_level(logging.DEBUG)
    out = asyncio.run(_REAL_TG_SEND("hola", transport=httpx.MockTransport(
        lambda r: httpx.Response(200, json={"ok": True}))))
    assert out["sent"] == 1
    assert not [r for r in caplog.records if token in r.getMessage()]
    assert any("api.telegram.org/bot<redacted>" in r.getMessage() for r in caplog.records if r.name == "httpx")


# ── B2: an unknown push outcome keeps the claim + daily cap (never resent every 15 min) ────────


def test_reminder_with_a_timed_out_channel_is_not_resent_next_tick(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(E, "PUSH_TIMEOUT_S", 0.05)
    delivered: List[str] = []

    async def slow_web(db: Any, uid: str, title: str, body: str, url: str, scope: str) -> Dict[str, Any]:
        await asyncio.sleep(0.3)
        delivered.append(uid)
        return {"sent": 1}

    async def no_expo(db: Any, uid: str, title: str, body: str, data: Dict[str, Any]) -> Dict[str, Any]:
        return {"sent": 0}

    db = TR.make_db(TR.ev_doc())
    out1 = asyncio.run(E.run_reminders(db, now=TR.NOW, recheck_fn=TR.Recheck(), client_factory=TR.FakeClient,
                                       push_fn=no_expo, webpush_fn=slow_web))
    assert out1["skipped"].get("uncertain") == 1
    assert db.event_reminders_sent.rows and db.event_reminders_sent.rows[0]["state"] == "uncertain"
    assert db.event_push_log.rows
    R.invalidate_caches()
    out2 = asyncio.run(E.run_reminders(db, now=TR.NOW + timedelta(minutes=15), recheck_fn=TR.Recheck(),
                                       client_factory=TR.FakeClient, push_fn=no_expo, webpush_fn=slow_web))
    assert out2["skipped"].get("already_sent") == 1 and out2["sent"] == 0


def test_webpush_returns_partial_counts_under_its_own_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = types.ModuleType("pywebpush")

    class WebPushException(Exception):
        response = None

    def webpush(subscription_info: Dict[str, Any], **_k: Any) -> None:
        time.sleep(0.02 if subscription_info["endpoint"].endswith("/fast") else 0.6)

    fake.webpush = webpush  # type: ignore[attr-defined]
    fake.WebPushException = WebPushException  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "pywebpush", fake)
    monkeypatch.setattr(W, "VAPID_PRIVATE", "priv")
    monkeypatch.setattr(W, "VAPID_PUBLIC", "pub")
    monkeypatch.setattr(W, "TOTAL_TIMEOUT_S", 0.3)
    db = StubDB()
    for ep in ("https://push.example/fast", "https://push.example/slow"):
        asyncio.run(db.push_subscriptions.insert_one({"user_id": "u1", "endpoint": ep, "scopes": ["events"],
                                                      "keys": {"p256dh": "k", "auth": "a"}}))
    async def go() -> Tuple[Dict[str, Any], float]:
        t0 = time.monotonic()
        res = await W.send_to_subscriptions(db, "u1", "t", "b", "/event/x", scope="events")
        return res, time.monotonic() - t0   # (asyncio.run later waits for the orphaned thread)

    out, took = asyncio.run(go())
    assert took < 0.5, took
    assert out["sent"] == 1 and out["uncertain"] == 1


# ── B3: a date_tbc row whose date an official page announces ──────────────────────────────────


def test_announced_date_for_a_tbc_row_is_proposed_for_review_and_approve_applies_it() -> None:
    db = TP.new_db()
    key = G.match_key("Concierto Sinfónico", 2026, "Teatro Adolfo Mejía")
    tbc = {"event_id": "ce-concierto-sinfonico-202611tbc-ab12", "canonical_key": key, "match_key": key,
           "title": {"es": "Concierto Sinfónico"}, "category": "concert", "edition_year": 2026,
           "start_date": None, "end_date": None, "start_time": None, "tbc_window_end": "2026-11-30",
           "date_tbc_note": {"es": "Noviembre 2026 · fecha por confirmar"}, "venue_name": "Teatro Adolfo Mejía",
           "source_url": "https://ipcc.gov.co/agenda-noviembre", "source_name": "IPCC", "source_tier": 1,
           "source_keys": ["anchor:concierto-sinfonico"],
           "evidence": [{"url": "https://ipcc.gov.co/agenda-noviembre", "tier": 1, "fetched_at": "2026-09-30T12:00:00Z",
                         "http_status": 200, "date_text": "Noviembre 2026 · fecha por confirmar", "date_visible": True}],
           "last_verified": "2026-09-30T12:00:00Z", "country_check": "pass", "country_signals": ["pass:t"],
           "status": "date_tbc", "status_reason": None, "confidence": "VERIFY", "origin": "anchor"}
    asyncio.run(db.city_events.insert_one(tbc))
    TP.pull(db, [TP.entry(TP.TB, [TP.cand(TP.TB)])])
    d = TP.docs(db)[0]
    assert (d["status"], d["status_reason"]) == ("review", "date_changed")
    assert d["proposed_dates"]["start_date"] == "2026-11-12"
    res = asyncio.run(E.approve_event(db, d["event_id"], actor="admin", now=NOW))
    d = TP.docs(db)[0]
    assert res["status"] == "published" and d["start_date"] == "2026-11-12"
    assert "tbc_window_end" not in d and d["date_history"]


# ── B4 / B5 (H10): the watchdog only trusts a main-slot sentinel run that really rechecked ────


def test_sentinel_query_failure_is_not_a_completed_healthy_run() -> None:
    db = asyncio.run(with_event_indexes(StubDB()))
    asyncio.run(db.city_events_state.insert_one({"_id": "flags", "enabled": True}))

    def boom(*_a: Any, **_k: Any) -> Any:
        raise RuntimeError("atlas blip")

    db.city_events.find = boom  # type: ignore[method-assign]
    out = asyncio.run(E.run_sentinel(db, now=NOW, recheck_fn=TR.Recheck(), client_factory=TR.FakeClient))
    assert out["done"] is False and "query_failed" in out["errors"]
    cur = next(r for r in db.city_events_state.rows if r["_id"] == "cursor:sentinel")
    assert cur["done"] is False
    R.invalidate_caches()
    assert asyncio.run(R.sentinel_healthy(db, NOW)) is False


def test_a_today_slot_run_never_makes_the_watchdog_healthy() -> None:
    db = asyncio.run(with_event_indexes(StubDB()))
    asyncio.run(db.city_events_state.insert_one({"_id": "flags", "enabled": True}))
    old = (NOW - timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
    asyncio.run(db.city_events_runs.insert_one({"kind": "sentinel", "slot": "main", "done": True, "finished_at": old}))
    out = asyncio.run(E.run_sentinel(db, now=NOW, slot="today", recheck_fn=TR.Recheck(), client_factory=TR.FakeClient))
    assert out["done"] is True and out["rows"] == 0
    R.invalidate_caches()
    assert asyncio.run(R.sentinel_healthy(db, NOW)) is False
    asyncio.run(db.city_events_runs.insert_one({"kind": "sentinel", "slot": "main", "done": True,
                                                "finished_at": NOW.strftime("%Y-%m-%dT%H:%M:%SZ")}))
    R.invalidate_caches()
    assert asyncio.run(R.sentinel_healthy(db, NOW)) is True


# ── B6: one politeness scheduler (and one client per source) for the whole pull invocation ───


def test_min_gap_holds_between_batches_of_the_same_source() -> None:
    hits: List[Tuple[float, str]] = []

    class Polite(S.Adapter):
        key = "politest"

        async def _pull(self, client: Any, sched: Any, res: Any, *, offset: int, checkpoint: Any, now_utc: Any) -> None:
            await self._get(client, sched, "https://politest.example.co/agenda/", res=res)
            items = [f"https://politest.example.co/agenda/e{i}" for i in range(3)]

            async def handle(u: str) -> None:
                await self._get(client, sched, u, res=res)

            await self._iterate(items, res, offset, checkpoint, handle, lambda u: u)

    def handler(request: httpx.Request) -> httpx.Response:
        hits.append((time.monotonic(), str(request.url)))
        return httpx.Response(200, text="<html><body>ok</body></html>")

    made: List[int] = []

    def factory() -> httpx.AsyncClient:
        made.append(1)
        return S.make_client(transport=httpx.MockTransport(handler))

    db = asyncio.run(with_event_indexes(StubDB()))
    entry = S._entry(Polite(), name="t", tier=3, domain="politest.example.co", scope="/agenda/",
                     role="discover", tz_policy="visible_text", min_gap_s=0.25, max_items_per_call=1)
    out = asyncio.run(E.run_pull(db, now=NOW, dry=True, source_list=[entry], run_enrich=False, client_factory=factory))
    assert out["done"] is True and len(hits) >= 5
    gaps = [b[0] - a[0] for a, b in zip(hits, hits[1:])]
    assert min(gaps) >= 0.2, gaps
    assert len(made) == 1


# ── H9: location fields naming a place outside the Distrito always FAIL ──────────────────────


@pytest.mark.parametrize("c,signal", [
    ({"event_text": "Concierto de Navidad", "venue_name": "Castillo San Felipe (Puerto Cabello, Venezuela)"},
     "fail:event:location_outside:venezuela"),
    ({"source_url": "https://ipcc.gov.co/2026/10/x/",
      "event_text": "Festival de Jazz de Mompox · Plaza de la Concepción, Mompox, Bolívar"},
     "fail:event:outside_distrito:mompox"),
    ({"source_url": "https://ipcc.gov.co/2026/10/x/",
      "event_text": "Festival de Tambores de San Basilio de Palenque, Bolívar"},
     "fail:event:outside_distrito:san_basilio_de_palenque"),
    ({"event_text": "FICCI · Festival Internacional de Cine de Cartagena de Indias", "venue_name": "Teatro Amira, Barranquilla"},
     "fail:event:other_city:barranquilla"),
])
def test_country_gate_fails_places_outside_the_distrito_in_location_fields(c: Dict[str, Any], signal: str) -> None:
    c = {"source_url": "https://latiquetera.com/evento/x", **c}
    verdict, signals = G.country_check(c)
    assert verdict == "fail" and signal in signals, signals


@pytest.mark.parametrize("text", [
    "Tras conquistar escenarios en México y Perú, la cantante llega al Teatro Adolfo Mejía, Cartagena de Indias.",
    "Feria artesanal con hamacas de San Jacinto y grupo de tambores de Palenque · Plaza de la Aduana, Cartagena de Indias",
])
def test_bios_and_crafts_that_mention_other_places_still_pass(text: str) -> None:
    verdict, signals = G.country_check({"source_url": "https://latiquetera.com/evento/x", "event_text": text,
                                        "venue_name": "Teatro Adolfo Mejía"})
    assert verdict == "pass", signals


# ── B7: trips never resolve an unmoderated or past partner event ─────────────────────────────


def test_trips_never_resolve_a_pending_partner_event() -> None:
    import trips
    from fastapi import HTTPException
    from partner_visibility import PUBLIC_PARTNER_FILTER
    db = StubDB()

    async def seed() -> None:
        partner = {"partner_id": "ptr_ok", "name": "Venue OK"}
        for k, v in PUBLIC_PARTNER_FILTER.items():
            if not str(k).startswith("$") and not isinstance(v, dict):
                partner[k] = v
        await db.partners.insert_one(partner)
        for eid, mod, day in (("pe_pending", "pending", "2099-11-20"), ("pe_ok", "approved", "2099-11-20"),
                              ("pe_past", "approved", "2020-01-01")):
            await db.partner_events.insert_one({"event_id": eid, "title": eid, "date": day, "start_time": "21:00",
                                                "partner_id": "ptr_ok", "category": "party",
                                                "is_published": True, "moderation_status": mod})

    asyncio.run(seed())
    trips.db = db
    with pytest.raises(HTTPException):
        asyncio.run(trips._ref_snapshot("experience", "pe_pending"))
    with pytest.raises(HTTPException):
        asyncio.run(trips._ref_snapshot("experience", "pe_past"))
    assert asyncio.run(trips._ref_snapshot("experience", "pe_ok")) == "pe_ok"
    items = asyncio.run(trips._enrich_items([{"ref_type": "experience", "ref_id": "pe_pending"}]))
    assert not items[0].get("resolved")


# ── H11: the itinerary reads Bogotá's day and its prose goes through the event guard ─────────


def test_itinerary_uses_bogota_today_and_guards_its_prose() -> None:
    from events_service_stubs import server_block, server_span
    import luna_events
    src = server_span("async def _generate_daily_itinerary(", '@api_router.get("/itineraries")')
    assert "today = _today_bogota()" in src and 'datetime.now(timezone.utc).strftime("%Y-%m-%d")' not in src
    ns: Dict[str, Any] = {"_luna_events": luna_events, "Any": Any}
    exec(compile(server_block("def _guard_itinerary_text("), "server.py[itinerary]", "exec"), ns)
    res = ns["_guard_itinerary_text"]({
        "description": "Una ruta caribeña. Esta noche hay concierto de Silvestre Dangond a las 21:00 en la muralla.",
        "stops": [{"title": "Cena", "venue": "Celele", "why": "Concierto de Karol G a las 22:00 en la terraza."},
                  {"title": "Paseo", "venue": "Muralla", "why": "Atardecer sobre el mar con brisa."}]},
        [{"title": "Jazz en Alma", "start_time": "20:00"}])
    assert "Silvestre" not in res["description"] and res["description"].startswith("Una ruta caribeña.")
    assert res["stops"][0]["why"] == "" and res["stops"][1]["why"] == "Atardecer sobre el mar con brisa."
