"""EVENTS-ELITE: regression tests for the independent RE-CHECK findings (after the fixer).

Each test reproduces one recheck finding with the real events_* / luna_events / push / server-slice
code and fails on the pre-fix code:

  R1  'NUEVA FECHA' resolved against the date the notice ANNOUNCES (never loops an approved
      reschedule back to review; a dateless notice is acknowledged by approval, once).
  R2  a cross-source cancel / notice for ANOTHER performance never touches our row.
  R4  an Expo read timeout after the POST is 'uncertain' (claim + cap kept, never re-sent).
  R9  an itinerary stop is guarded as ONE claim (time + title + why).
  R6  landmark / street / chef names never replace a correct answer.

Pure: stub DB, httpx MockTransport pages, no network, never imports server.py.

Run: cd backend && python -m pytest -q tests/test_events_recheck_fixes.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

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
import luna_events as L  # noqa: E402
import push as P  # noqa: E402
import telegram_alerts as T  # noqa: E402
import test_events_pull as TP  # noqa: E402
import test_events_reminders as TR  # noqa: E402
import test_events_sentinel as TS  # noqa: E402
from events_service_stubs import server_block  # noqa: E402

UTC = timezone.utc
NEW = "Jueves 12 de noviembre de 2026 · 7:00 p. m."
OLD = "Viernes 30 de octubre de 2026 · 7:00 p. m."
TEATRO_URL = "https://www.teatroejemplo.co/eventos/concierto-sinfonico"
FILLER = ("Queremos agradecer a todo nuestro público por su paciencia y por el cariño que nos han demostrado "
          "durante estos meses de preparación. La orquesta ha trabajado con dedicación para ofrecer un programa "
          "renovado, con obras clásicas y arreglos especiales que sorprenderán a todos los asistentes.")


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


def _page(body: str, title: str = "Concierto Sinfónico") -> str:
    return (f"<html><head><title>{title}</title></head><body><h1>{title}</h1>{body}"
            f"<p>Teatro Adolfo Mejía, Cartagena de Indias</p></body></html>")


def _transport(page: str) -> httpx.MockTransport:
    return httpx.MockTransport(lambda r: httpx.Response(200, text=page, headers={"content-type": "text/html"}))


def _recheck(doc: Dict[str, Any], page: str, now: datetime) -> Dict[str, Any]:
    async def go() -> Dict[str, Any]:
        c = S.make_client(_transport(page))
        try:
            return await S.recheck_doc(c, doc, now_utc=now)
        finally:
            await c.aclose()
    return asyncio.run(go())


# ═════════════════════════════════════════════════════════════════════════════
# R1 — 'NUEVA FECHA' resolved against the announced date
# ═════════════════════════════════════════════════════════════════════════════


def test_notice_announcement_is_the_date_after_the_keyword() -> None:
    a = S.notice_announcement(f"Fecha original: {OLD}. NUEVA FECHA: {NEW}", ref_year=2026)
    assert a is not None and a["marker"] == "nueva fecha"
    assert (a["start_date"], a["end_date"], a["start_time"]) == ("2026-11-12", "2026-11-12", "19:00")
    assert a["quote"].startswith("NUEVA FECHA") and "12 de noviembre" in a["quote"]
    assert ["2026-10-30", "2026-10-30"] in a["original"]
    # 'Cambio de fecha' first, then the original, then the new one: the labelled original is skipped.
    b = S.notice_announcement(f"Cambio de fecha. Fecha original: {OLD}. Nueva fecha: {NEW}", ref_year=2026)
    assert b is not None and b["start_date"] == "2026-11-12"
    # Two notices announcing different dates: ambiguous, never resolved.
    c = S.notice_announcement(f"Nueva fecha: {OLD}. Nueva fecha: {NEW}", ref_year=2026)
    assert c is not None and c["start_date"] is None
    # A dateless notice: no date, a stable fingerprint.
    d1 = S.notice_announcement(f"¡NUEVA FECHA! {FILLER} {NEW}", ref_year=2026)
    d2 = S.notice_announcement(f"¡NUEVA FECHA! {FILLER} {NEW}", ref_year=2026)
    assert d1 is not None and d1["start_date"] is None and d1["fp"] == (d2 or {}).get("fp")
    assert S.notice_announcement("Sin avisos", ref_year=2026) is None


@pytest.mark.parametrize("body", [
    f"<p>Fecha original: {OLD}</p><p><b>NUEVA FECHA:</b> {NEW}</p>",
    f"<p><b>NUEVA FECHA:</b> {NEW}</p>",
])
def test_notice_announcing_the_stored_date_is_success_and_the_reminder_is_sent(body: str) -> None:
    """R1 repro (r1_notice_sticky): stored 12 Nov 19:00 (already moved + approved), the page
    keeps its banner. Pre-fix: date_changed → review daily, reminder suppressed."""
    page = _page(body, "Salsa a la Plaza")
    url = "https://www.teatroejemplo.co/eventos/salsa-a-la-plaza"

    def mk() -> Dict[str, Any]:
        return TR.ev_doc(source_url=url, recheck_url=url, source_name="Teatro (organizador)", source_tier=3,
                         evidence=[{"url": url, "name": "Teatro", "tier": 3, "fetched_at": TR.LV_TODAY,
                                    "http_status": 200, "date_text": NEW, "date_visible": True,
                                    "start_date": "2026-11-12", "end_date": "2026-11-12", "start_time": "19:00"}])

    rec = _recheck(mk(), page, TR.NOW - timedelta(hours=8))
    assert rec["outcome"] == "success", rec
    assert rec["parsed"] == {"start_date": "2026-11-12", "end_date": "2026-11-12", "start_time": "19:00"}
    t = E.sentinel_transition(mk(), rec, TR.NOW - timedelta(hours=8))
    assert "status" not in t["set"] and t["alert"] is None and t["set"].get("last_verified")
    db = TR.make_db(mk())
    senders = TR.Senders()
    out = asyncio.run(E.run_reminders(db, now=TR.NOW, recheck_fn=S.recheck_doc,
                                      client_factory=lambda: S.make_client(_transport(page)),
                                      push_fn=senders.push, webpush_fn=senders.webpush))
    assert out["sent"] == 1 and out["suppressed"] == []


def test_approved_reschedule_with_a_persistent_banner_stays_published_for_days(_reset: Dict[str, List[str]]) -> None:
    """R1b repro (r1b_notice_loop): three sentinel days on the real recheck. Pre-fix: review
    every day + 3 identical alerts."""
    page = _page(f"<p><b>NUEVA FECHA:</b> {NEW}</p>")
    d = TS.doc(url=TEATRO_URL, tier=3, source_name="Teatro (organizador)")
    d["evidence"] = [TS._ev(TEATRO_URL, NEW, 3)]
    db = TS._db(d)
    asyncio.run(db.city_events_state.update_one({"_id": "flags"}, {"$set": {"enabled": True}}, upsert=True))
    now = TS.NOW
    for _day in range(3):
        R.invalidate_caches()
        TS._unlease(db)
        out = asyncio.run(E.run_sentinel(db, now=now, recheck_fn=S.recheck_doc,
                                         client_factory=lambda: S.make_client(_transport(page))))
        r = TS.row(db)
        assert out.get("done") is True
        assert (r["status"], r.get("status_reason"), r["confidence"]) == ("published", None, "HIGH")
        now += timedelta(days=1)
    assert _reset["alerts"] == []


def test_notice_announcing_another_date_goes_to_review_with_the_announced_proposal() -> None:
    page = _page(f"<p>Fecha original: {NEW}</p><p><strong>NUEVA FECHA:</strong> Sábado 5 de diciembre de 2026 · 7:00 p. m.</p>")
    d = TS.doc(url=TEATRO_URL, tier=3)
    d["evidence"] = [TS._ev(TEATRO_URL, NEW, 3)]
    rec = _recheck(d, page, TS.NOW)
    assert rec["outcome"] == "date_changed" and str(rec["marker"]).startswith("date_notice")
    assert rec["parsed"]["start_date"] == "2026-12-05"          # the ANNOUNCED date, not the page's first
    t = E.sentinel_transition(d, rec, TS.NOW)
    assert (t["set"]["status"], t["set"]["status_reason"]) == ("review", "date_changed")
    assert t["set"]["proposed_dates"]["start_date"] == "2026-12-05"


def test_dateless_notice_is_acknowledged_by_approval_and_asks_again_when_it_changes(
        _reset: Dict[str, List[str]]) -> None:
    """A notice that names no parseable date: review once; approval acknowledges THAT notice for
    THESE dates; a changed notice asks again."""
    pages = {"ack": _page(f"<p><b>¡NUEVA FECHA!</b> {FILLER}</p><p>{NEW}</p>"),
             "changed": _page(f"<p><b>¡NUEVA FECHA POR CONFIRMAR!</b> Muy pronto les contaremos todos los "
                              f"detalles. {FILLER}</p><p>{NEW}</p>")}
    cur = {"page": pages["ack"]}
    d = TS.doc(url=TEATRO_URL, tier=3, source_name="Teatro (organizador)")
    d["evidence"] = [TS._ev(TEATRO_URL, NEW, 3)]
    db = TS._db(d)
    asyncio.run(db.city_events_state.update_one({"_id": "flags"}, {"$set": {"enabled": True}}, upsert=True))

    def day(now: datetime) -> Dict[str, Any]:
        R.invalidate_caches()
        TS._unlease(db)
        asyncio.run(E.run_sentinel(db, now=now, recheck_fn=S.recheck_doc,
                                   client_factory=lambda: S.make_client(_transport(cur["page"]))))
        return TS.row(db)

    r = day(TS.NOW)
    assert (r["status"], r["status_reason"]) == ("review", "date_changed") and r["pending_notice"]["fp"]
    assert "proposed_dates" not in r
    res = asyncio.run(E.approve_event(db, r["event_id"], actor="admin:phil", now=TS.NOW + timedelta(hours=1)))
    assert res["status"] == "published"
    r = TS.row(db)
    assert r["notice_ack"]["fp"] and r["notice_ack"]["start_date"] == "2026-11-12" and "pending_notice" not in r
    for i in (1, 2):
        r = day(TS.NOW + timedelta(days=i))
        assert (r["status"], r.get("status_reason"), r["confidence"]) == ("published", None, "HIGH")
    assert len(_reset["alerts"]) == 1
    cur["page"] = pages["changed"]
    r = day(TS.NOW + timedelta(days=3))
    assert (r["status"], r["status_reason"]) == ("review", "date_changed")


def _ncand(src: Dict[str, Any], *, url: str, native: str, start: str, event_text: str, date_text: str,
           markers: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    meta = {"url": url, "final_url": url, "fetched_at": TP.FETCHED, "http_status": 200}
    return S.make_candidate(src, meta, native_id=native, title="Concierto Sinfónico", start_date=start,
                            start_time="19:00", time_confirmed=True, date_text=date_text, date_visible=True,
                            event_text=event_text, page_text="TuBoleta Colombia · Cartagena de Indias, Bolívar",
                            venue_name="Teatro Adolfo Mejía", markers=markers)


def test_pull_reschedule_notice_is_proposed_then_an_approved_row_is_stable_on_re_pull(
        _reset: Dict[str, List[str]]) -> None:
    """Same source, banner kept: the adapter parses the ORIGINAL date first. Insert → review with
    the announced date proposed; approve publishes it; the next pull (same page) is an ordinary
    merge. Pre-fix: every same-source pull sent the row back to review/date_changed."""
    txt = f"Concierto Sinfónico · Teatro Adolfo Mejía · Fecha original: {OLD} · NUEVA FECHA: {NEW} · Cartagena de Indias"
    c = _ncand(TP.TB, url=TP.TB_URL, native="sinfonico", start="2026-10-30", event_text=txt, date_text=OLD,
               markers={"date_notice": "nueva fecha"})
    db = TP.new_db()
    TP.pull(db, [TP.entry(TP.TB, [c])])
    d = TP.docs(db)[0]
    assert (d["status"], d["status_reason"]) == ("review", "date_changed")
    assert d["proposed_dates"]["start_date"] == "2026-11-12" and d["proposed_dates"]["start_time"] == "19:00"
    assert d["evidence"][0]["start_date"] == "2026-11-12" and "NUEVA FECHA" in d["evidence"][0]["date_text"]
    res = asyncio.run(E.approve_event(db, d["event_id"], actor="admin:phil", now=TP.NOW))
    assert res["status"] == "published" and res["confidence"] == "HIGH"
    _reset["alerts"].clear()
    for i in (1, 2):
        TP._unlease(db)
        TP.pull(db, [TP.entry(TP.TB, [c])], now=TP.NOW + timedelta(days=i))
        d = TP.docs(db)[0]
        assert (d["start_date"], d["status"], d.get("status_reason"), d["confidence"]) == \
            ("2026-11-12", "published", None, "HIGH")
    assert not any("nueva fecha" in a for a in _reset["alerts"])


# ═════════════════════════════════════════════════════════════════════════════
# R2 — another performance's cancel / notice never touches our row
# ═════════════════════════════════════════════════════════════════════════════


def _our_row(db: Any) -> Dict[str, Any]:
    lt = TP.cand(TP.LT, url=TP.LT_URL, native="sinfonico-lt", start="2026-11-12")
    TP.pull(db, [TP.entry(TP.LT, [lt])])
    d = TP.docs(db)[0]
    assert (d["start_date"], d["status"], d["confidence"]) == ("2026-11-12", "published", "HIGH")
    TP._unlease(db)
    return d


@pytest.mark.parametrize("markers", [{"cancel": "cancelado"}, {"date_notice": "nueva fecha"}])
def test_cross_source_marker_for_another_performance_leaves_the_row_untouched(
        markers: Dict[str, Any], _reset: Dict[str, List[str]]) -> None:
    """R2 repro (r2_other_date_cancel). Pre-fix: our 12 Nov row hidden/cancel_marker (or
    review/date_changed) by TuBoleta's 20 Oct performance."""
    db = TP.new_db()
    before = dict(_our_row(db))
    _reset["alerts"].clear()
    tb = TP.cand(TP.TB, url=TP.TB_URL + "-20-oct", native="sinfonico-tb-20oct", start="2026-10-20",
                 date_text="20 de octubre de 2026 · 7:00 p. m.", markers=markers)
    out = TP.pull(db, [TP.entry(TP.TB, [tb])], now=TP.NOW + timedelta(days=1))
    d = TP.docs(db)[0]
    assert len(TP.docs(db)) == 1
    assert (d["start_date"], d["status"], d.get("status_reason"), d["confidence"]) == \
        ("2026-11-12", "published", None, "HIGH")
    assert d["evidence"] == before["evidence"] and d["source_keys"] == before["source_keys"]
    assert out["counts"].get("other_performance") == 1 and not out["counts"].get("dupes_merged")
    assert _reset["alerts"] == []


def test_cross_source_cancel_of_the_same_date_still_hides_and_names_date_and_url(
        _reset: Dict[str, List[str]]) -> None:
    db = TP.new_db()
    _our_row(db)
    tb = TP.cand(TP.TB, url=TP.TB_URL, native="sinfonico-tb", start="2026-11-12", markers={"cancel": "cancelado"})
    TP.pull(db, [TP.entry(TP.TB, [tb])], now=TP.NOW + timedelta(days=1))
    d = TP.docs(db)[0]
    assert (d["status"], d["status_reason"]) == ("hidden", "cancel_marker")
    assert d["cancel_report"]["start_date"] == "2026-11-12"
    assert any("2026-11-12" in a and TP.TB_URL in a for a in _reset["alerts"])


def test_cross_source_notice_whose_original_date_is_ours_goes_to_review() -> None:
    """The other page already lists the NEW date (its parse), and labels OUR date as the original:
    that notice is about this row."""
    db = TP.new_db()
    lt = TP.cand(TP.LT, url=TP.LT_URL, native="sinfonico-lt", start="2026-10-30",
                 date_text="30 de octubre de 2026 · 7:00 p. m.")
    TP.pull(db, [TP.entry(TP.LT, [lt])])
    TP._unlease(db)
    txt = f"Concierto Sinfónico · Fecha original: {OLD} · NUEVA FECHA: {NEW} · Teatro Adolfo Mejía, Cartagena de Indias"
    tb = _ncand(TP.TB, url=TP.TB_URL, native="sinfonico-tb", start="2026-11-12", event_text=txt, date_text=NEW,
                markers={"date_notice": "nueva fecha"})
    TP.pull(db, [TP.entry(TP.TB, [tb])], now=TP.NOW + timedelta(days=1))
    d = TP.docs(db)[0]
    assert (d["start_date"], d["status"], d["status_reason"]) == ("2026-10-30", "review", "date_changed")
    assert d["proposed_dates"]["start_date"] == "2026-11-12"


# ═════════════════════════════════════════════════════════════════════════════
# R4 — Expo: a lost response is 'uncertain', a refused connection is 'not sent'
# ═════════════════════════════════════════════════════════════════════════════


def _patch_expo(monkeypatch: pytest.MonkeyPatch, exc: type, posts: List[str]) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        if exc is httpx.ConnectError:
            raise httpx.ConnectError("refused", request=req)       # nothing reached Expo
        posts.append(req.url.path)                                  # Expo received the batch …
        raise exc("response lost", request=req)                     # … the response never arrived

    orig = httpx.AsyncClient

    class _Client(orig):  # type: ignore[misc, valid-type]
        def __init__(self, *a: Any, **k: Any) -> None:
            k["transport"] = httpx.MockTransport(handler)
            super().__init__(*a, **k)

    monkeypatch.setattr(P.httpx, "AsyncClient", _Client)


@pytest.mark.parametrize("exc", [httpx.ReadTimeout, httpx.WriteTimeout, httpx.RemoteProtocolError])
def test_send_expo_push_reports_post_send_failures_as_uncertain(monkeypatch: pytest.MonkeyPatch, exc: type) -> None:
    posts: List[str] = []
    _patch_expo(monkeypatch, exc, posts)
    r = asyncio.run(P.send_expo_push(["ExponentPushToken[abcdefghijklmnop]"], "t", "b"))
    assert r["sent"] == 0 and r["uncertain"] == 1 and posts


def test_send_expo_push_connect_error_is_plainly_not_sent(monkeypatch: pytest.MonkeyPatch) -> None:
    posts: List[str] = []
    _patch_expo(monkeypatch, httpx.ConnectError, posts)
    r = asyncio.run(P.send_expo_push(["ExponentPushToken[abcdefghijklmnop]"], "t", "b"))
    assert r["sent"] == 0 and r["uncertain"] == 0 and not posts and r["errors"]


def _expo_user_db() -> Any:
    db = TR.make_db(TR.ev_doc())
    asyncio.run(db.push_tokens.insert_one({"owner_type": "user", "owner_id": "u1", "active": True,
                                           "token": "ExponentPushToken[abcdefghijklmnop]"}))
    return db


def test_reminder_expo_read_timeout_keeps_claim_and_cap_and_is_never_resent(monkeypatch: pytest.MonkeyPatch) -> None:
    """R4 repro (r4_expo_timeout_resend) through the REAL push.push_to_user. Pre-fix: claim + cap
    deleted as 'no_channel' and the same reminder POSTed to Expo on every */15 tick."""
    posts: List[str] = []
    _patch_expo(monkeypatch, httpx.ReadTimeout, posts)
    db = _expo_user_db()
    web = TR.Senders(web_sent=0)
    skipped = []
    for tick in range(3):
        R.invalidate_caches()
        out = asyncio.run(E.run_reminders(db, now=TR.NOW + timedelta(minutes=15 * tick), recheck_fn=TR.Recheck(),
                                          client_factory=TR.FakeClient, webpush_fn=web.webpush))
        skipped.append(out["skipped"])
    assert len(posts) == 1
    assert skipped[0] == {"uncertain": 1} and skipped[1] == {"already_sent": 1}
    assert [r["state"] for r in db.event_reminders_sent.rows] == ["uncertain"] and len(db.event_push_log.rows) == 1


def test_reminder_expo_connect_error_releases_the_claim_for_a_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    posts: List[str] = []
    _patch_expo(monkeypatch, httpx.ConnectError, posts)
    db = _expo_user_db()
    web = TR.Senders(web_sent=0)
    out = asyncio.run(E.run_reminders(db, now=TR.NOW, recheck_fn=TR.Recheck(), client_factory=TR.FakeClient,
                                      webpush_fn=web.webpush))
    assert out["skipped"] == {"no_channel": 1}
    assert db.event_reminders_sent.rows == [] and db.event_push_log.rows == []


# ═════════════════════════════════════════════════════════════════════════════
# R9 — an itinerary stop is ONE claim (time + title + why)
# ═════════════════════════════════════════════════════════════════════════════


def _itinerary_guard() -> Any:
    ns: Dict[str, Any] = {"_luna_events": L, "Any": Any}
    exec(compile(server_block("def _guard_itinerary_text("), "server.py[itinerary]", "exec"), ns)
    return ns["_guard_itinerary_text"]


def test_itinerary_invented_timed_events_are_blanked_as_one_claim() -> None:
    """R9 repro (r9_itinerary_stop). Pre-fix: titles passed unchanged; a blanked `why` let the
    app show the unguarded title as the blurb."""
    guard = _itinerary_guard()
    partners = ["Celele", "Alquímico", "Café Havana"]
    out = guard({"stops": [
        {"time": "19:00", "title": "Cena caribeña", "venue": "Celele", "why": "Cocina de autor."},
        {"time": "22:00", "title": "Concierto de Silvestre Dangond", "venue": "Alquímico", "why": "Cierra la noche en grande."},
        {"time": "23:30", "title": "Show en vivo de Grupo Niche", "venue": "Café Havana", "why": "La mejor salsa de la ciudad."},
    ]}, [], partner_names=partners)
    s = out["stops"]
    assert (s[0]["title"], s[0]["why"]) == ("Cena caribeña", "Cocina de autor.")
    assert (s[1]["title"], s[1]["why"]) == ("Alquímico", "")
    assert (s[2]["title"], s[2]["why"]) == ("Café Havana", "")
    out = guard({"stops": [
        {"time": "22:00", "title": "Cierre musical", "venue": "Alquímico", "why": "Silvestre Dangond en vivo para cerrar la noche."},
        {"time": "22:30", "title": "Salsa", "venue": "Café Havana", "why": "Toca Grupo Niche en vivo, imperdible."},
        {"time": "21:00", "title": "Gran concierto de Karol G", "venue": "Alquímico", "why": "Concierto de Karol G esta noche."},
    ]}, [], partner_names=partners)
    for st in out["stops"]:
        assert st["title"] == st["venue"] and st["why"] == ""


def test_itinerary_honest_stops_and_a_grounded_partner_event_are_kept() -> None:
    guard = _itinerary_guard()
    stops = [
        {"time": "10:00", "title": "Paseo por la Ciudad Amurallada", "venue": "Celele", "why": "Recorre la Torre del Reloj y la Plaza Santo Domingo."},
        {"time": "13:00", "title": "Almuerzo en Celele", "venue": "Celele", "why": "Cocina del chef Jaime Rodríguez."},
        {"time": "20:00", "title": "Jazz en Alma", "venue": "Alma", "why": "Concierto de jazz en vivo en Alma."},
        {"time": "22:30", "title": "Noche en Café Havana", "venue": "Café Havana", "why": "Salsa clásica en la Calle de la Media Luna."},
    ]
    out = guard({"stops": [dict(s) for s in stops]}, [{"title": "Jazz en Alma", "start_time": "20:00", "venue": "Alma"}],
                partner_names=["Celele", "Alma", "Café Havana"])
    assert out["stops"] == stops


# ═════════════════════════════════════════════════════════════════════════════
# R6 — landmark / street / chef names never replace a correct answer
# ═════════════════════════════════════════════════════════════════════════════

NOW_L = datetime(2026, 11, 14, 15, 0, tzinfo=UTC)
JAZZ = {"event_id": "ce-noche-de-jazz-20261114-aa11", "title": {"es": "Noche de Jazz", "en": "Jazz Night"},
        "start_date": "2026-11-14", "end_date": "2026-11-14", "start_time": "20:00", "venue_name": "Teatro Heredia",
        "source_name": "IPCC", "confidence": "HIGH", "status": "published"}


@pytest.mark.parametrize("msg,lang", [
    ("Tonight: Noche de Jazz en el Teatro Heredia at 20:00, a short walk from the Clock Tower in the Old City.", "en"),
    ("Ce soir : Noche de Jazz au Teatro Heredia à 20:00, à deux pas de la Tour de l'Horloge.", "fr"),
    ("Hoje à noite: Noche de Jazz no Teatro Heredia às 20:00, perto da Cidade Amuralhada.", "pt"),
    ("Esta noche: Noche de Jazz en el Teatro Heredia a las 20:00, a pasos de la Torre del Reloj.", "es"),
])
def test_landmark_names_never_trip_the_event_turn_guard(msg: str, lang: str) -> None:
    assert L.find_violations(msg, [JAZZ], lang, now=NOW_L, names=True) == []


@pytest.mark.parametrize("reason", [
    "La chef Leonor Espinosa cocina esta noche un menú de degustación.",
    "Cocina del chef Jaime Rodríguez, ideal para hoy.",
    "Queda en la Calle de la Media Luna, abre hoy desde las 6 pm.",
])
def test_partner_copy_naming_a_chef_or_a_street_is_kept_on_non_event_turns(reason: str) -> None:
    rec = {"kind": "partner", "partner_id": "ptr_celele", "name": "Celele", "reason": reason}
    recs, _a, _s = L.guard_side_channels([rec], [], [], [], "es", now=NOW_L, partner_names={"ptr_celele": "Celele"})
    assert recs[0]["reason"] == reason


def test_invented_names_are_still_caught() -> None:
    # Non-event turn: an unknown name next to an explicit date is a claim even without an event word.
    rec = {"kind": "partner", "partner_id": "ptr_celele", "name": "Celele",
           "reason": "Silvestre Dangond el sábado 21 de noviembre en la terraza."}
    recs, _a, _s = L.guard_side_channels([rec], [], [], [], "es", now=NOW_L, partner_names={"ptr_celele": "Celele"})
    assert recs[0]["reason"] == ""
    # Event turn: an unknown name next to 'esta noche' in a card is blanked.
    rec2 = {"kind": "partner", "partner_id": "ptr_celele", "name": "Celele", "reason": "Karol G esta noche en Celele."}
    recs, _a, _s = L.guard_side_channels([rec2], [], [], [JAZZ], "es", now=NOW_L,
                                         partner_names={"ptr_celele": "Celele"}, event_turn=True)
    assert recs[0]["reason"] == ""
    # Prose on an event turn: a performer next to the landmark is still an invented act.
    msg = "Esta noche Marc Anthony toca a las 22:00 junto a la Torre del Reloj."
    assert L.find_violations(msg, [JAZZ], "es", now=NOW_L, names=True)
    # A chef named as a PERFORMER claim with an event word still counts.
    assert L.find_violations("Concierto de Carlos Vives a las 23:00 en la Calle del Arsenal.", [JAZZ], "es",
                             now=NOW_L, names=True)


def test_landmark_alias_tokens_are_place_tokens() -> None:
    toks = L._place_tokens()
    for w in ("clock", "tower", "lhorloge", "cidade", "amuralhada", "reloj"):
        assert w in toks
    assert G is not None   # the gate module is importable alongside (sanity)
