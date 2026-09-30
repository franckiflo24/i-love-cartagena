"""CMW concierge requests: validation matrix, honeypot, both rate limits, the WhatsApp URL,
alert failure tolerance, the delete_account purge, admin status changes and privacy in logs
(docs/cmw/DESIGN.md §2, §3, §6).

Pure: in-memory Mongo stub (also as the rate-limit store), patched alert senders, the real cmw
router on a throwaway FastAPI app, the delete-account handler exec'd from a server.py slice
(server.py itself is never imported). No Atlas, no network.

Run: cd backend && python -m pytest -q tests/test_cmw_requests.py
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, unquote, urlsplit

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS = os.path.dirname(os.path.abspath(__file__))
for p in (BACKEND, TESTS):
    if p not in sys.path:
        sys.path.insert(0, p)

import cmw  # noqa: E402
import emails  # noqa: E402
import ratelimit  # noqa: E402
import telegram_alerts  # noqa: E402
from events_service_stubs import StubDB, server_block  # noqa: E402

ADMIN_TOKEN = "cmw-test-admin-token-0123456789abcdef"
IP = "203.0.113.10"
NAME = "Ana María Pérez"
PHONE = "+57 300 123 4567"
EMAIL = "Ana.Perez@Example.com"
NOTE = "Somos 4, llegamos el 31"
PERSONAL = ("ana", "pérez", "perez", "3001234567", "300 123 4567", "example.com", "somos 4")


def _ok_body(**over: Any) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "event_id": "cmw-zamna-on-the-beach", "name": NAME, "party_size": 4,
        "contact": {"type": "whatsapp", "value": PHONE}, "note": NOTE, "lang": "es", "consent": True, "website": "",
    }
    body.update(over)
    return body


class Sent:
    def __init__(self) -> None:
        self.telegram: List[str] = []
        self.email: List[Dict[str, Any]] = []


@pytest.fixture()
def env(monkeypatch: pytest.MonkeyPatch) -> Tuple[StubDB, TestClient, Sent]:
    cmw.reset_program_cache()
    cmw.reset_indexes_flag()
    db = StubDB()

    async def seed() -> None:
        await db.partners.insert_one({"partner_id": "ptr_dv_003", "name": "Bethel Bellini Beach Club",
                                      "location": {"lat": 10.382, "lng": -75.568}})
        await db.partners.insert_one({"partner_id": "ptr_V014", "name": "Casa Bohême",
                                      "location": {"lat": 10.4241, "lng": -75.5518}})

    asyncio.run(seed())
    sent = Sent()

    async def fake_tg(text: Any, **_k: Any) -> Dict[str, Any]:
        sent.telegram.append(str(text))
        return {"configured": True, "sent": 1, "chats": 1, "errors": []}

    async def fake_mail(*, subject: str, title: str, lines: list) -> bool:
        sent.email.append({"subject": subject, "title": title, "lines": list(lines)})
        return True

    monkeypatch.setattr(telegram_alerts, "send", fake_tg)
    monkeypatch.setattr(telegram_alerts, "configured", lambda: True)
    monkeypatch.setattr(emails, "send_admin_alert", fake_mail)
    monkeypatch.setenv("CMW_IP_SALT", "unit-test-salt-0123456789")
    monkeypatch.delenv("EVENTS_ADMIN_TOKEN", raising=False)
    monkeypatch.setattr(ratelimit, "db", db)
    ratelimit._local_buckets.clear()
    cmw.init(db_=db)
    app = FastAPI()
    app.include_router(cmw.router, prefix="/api")
    client = TestClient(app)
    yield db, client, sent
    cmw.reset_program_cache()
    cmw.reset_indexes_flag()


def _post(client: TestClient, body: Any, ip: str = IP, **headers: str):
    h = {"x-real-ip": ip, **headers}
    if isinstance(body, (bytes, str)):
        return client.post("/api/cmw/requests", content=body, headers={**h, "content-type": "application/json"})
    return client.post("/api/cmw/requests", json=body, headers=h)


# ── the happy path ───────────────────────────────────────────────────────────


def test_request_is_stored_alerted_and_answered_with_a_whatsapp_url(env) -> None:
    db, client, sent = env
    r = _post(client, _ok_body())
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"data", "error", "message"} and body["error"] is None
    assert " / " in body["message"] and "recibida" in body["message"] and "received" in body["message"]
    data = body["data"]
    assert set(data) == {"request_id", "status", "whatsapp_url"}
    assert re.fullmatch(r"cmw-r-[a-z2-7]{8}", data["request_id"])
    assert data["status"] == "received"
    raw = json.dumps(body).lower()
    for banned in ("confirmed", "confirmado", "reservado", "booked", "checkout", "pago"):
        assert banned not in raw, banned
    assert r.headers["cache-control"] == "no-store"
    # the WhatsApp URL: the deck's number, url-encoded text naming the event, date, party size, id
    u = urlsplit(data["whatsapp_url"])
    assert (u.scheme, u.netloc, u.path) == ("https", "wa.me", "/573116844492")
    text = parse_qs(u.query)["text"][0]
    assert text == unquote(data["whatsapp_url"].split("text=", 1)[1])
    assert "Zamna on the Beach" in text and "31 dic 2026" in text and "4 personas" in text and data["request_id"] in text
    assert "573116844492" in data["whatsapp_url"]
    for personal in (NAME, "3001234567", "Ana"):
        assert personal not in text, "the prefilled message never carries personal data"
    # the stored row
    row = db.cmw_requests.rows[0]
    assert row["request_id"] == data["request_id"] and row["status"] == "received"
    assert row["event_id"] == "cmw-zamna-on-the-beach" and row["event_title"] == "Zamna on the Beach"
    assert row["event_date"] == "2026-12-31" and row["party_size"] == 4 and row["lang"] == "es"
    assert row["name"] == NAME and row["contact"] == {"type": "whatsapp", "value": "+573001234567"}
    assert row["note"] == NOTE and row["user_id"] is None and row["client"] == "web"
    assert isinstance(row["created_at_dt"], datetime) and row["created_at"].endswith("Z")
    assert re.fullmatch(r"[0-9a-f]{32}", row["ip_hash"]) and IP not in json.dumps(row, default=str)
    assert row["alerts"] == {"telegram": True, "email": True}
    # both alerts went out, with the id; the email carries the contact for the concierge
    assert len(sent.telegram) == 1 and data["request_id"] in sent.telegram[0]
    assert len(sent.email) == 1 and data["request_id"] in sent.email[0]["subject"]
    assert any("+573001234567" in ln for ln in sent.email[0]["lines"])


def test_general_enquiry_email_contact_session_user_and_client_stamp(env) -> None:
    db, client, sent = env
    exp = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    asyncio.run(db.user_sessions.insert_one({"session_token": "sess-abc", "user_id": "u-42", "expires_at": exp}))
    client.cookies.set("session_token", "sess-abc")
    r = _post(client, _ok_body(event_id=None, contact={"type": "email", "value": EMAIL}, party_size=1, lang="en",
                               note=None), **{"x-amo-client": "ios/1.1.2 (build 20)"})
    client.cookies.clear()
    assert r.status_code == 200, r.text
    row = db.cmw_requests.rows[0]
    assert row["user_id"] == "u-42" and row["event_id"] is None and row["event_title"] == "Cartagena Music Week"
    assert row["contact"] == {"type": "email", "value": "ana.perez@example.com"} and row["note"] is None
    assert row["client"] == "ios/1.1.2 build 20"
    text = unquote(r.json()["data"]["whatsapp_url"].split("text=", 1)[1])
    assert "Cartagena Music Week" in text and "Dec 31, 2026" in text and "1 person" in text
    # an expired session is nobody
    asyncio.run(db.user_sessions.insert_one({"session_token": "sess-old", "user_id": "u-43",
                                             "expires_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()}))
    client.cookies.set("session_token", "sess-old")
    _post(client, _ok_body(), ip="203.0.113.11")
    client.cookies.clear()
    assert db.cmw_requests.rows[1]["user_id"] is None


# ── validation matrix (§3) ───────────────────────────────────────────────────


@pytest.mark.parametrize("over,code", [
    ({"name": "A"}, "invalid_name"),
    ({"name": "x" * 81}, "invalid_name"),
    ({"name": "1234"}, "invalid_name"),
    ({"name": "<script>"}, "invalid_name"),
    ({"party_size": 0}, "invalid_party_size"),
    ({"party_size": 51}, "invalid_party_size"),
    ({"party_size": True}, "invalid_party_size"),
    ({"party_size": "muchos"}, "invalid_party_size"),
    ({"contact": {"type": "phone", "value": PHONE}}, "invalid_contact"),
    ({"contact": {"type": "whatsapp", "value": "123456"}}, "invalid_contact"),
    ({"contact": {"type": "whatsapp", "value": "+57 300 ABC 4567"}}, "invalid_contact"),
    ({"contact": {"type": "whatsapp", "value": "1234567890123456"}}, "invalid_contact"),
    ({"contact": {"type": "email", "value": "not-an-email"}}, "invalid_contact"),
    ({"contact": {"type": "email", "value": "a..b@example.com"}}, "invalid_contact"),
    ({"contact": {"type": "whatsapp", "value": ""}}, "invalid_contact"),
    ({"contact": "3001234567"}, "invalid_contact"),
    ({"note": "n" * 501}, "invalid_note"),
    ({"event_id": "cmw-nope"}, "unknown_event"),
    ({"event_id": "evt_010"}, "unknown_event"),
    ({"lang": "de"}, "invalid_lang"),
    ({"consent": False}, "consent_required"),
    ({"consent": "yes"}, "consent_required"),
])
def test_validation_matrix(env, over: Dict[str, Any], code: str) -> None:
    db, client, sent = env
    r = _post(client, _ok_body(**over))
    assert r.status_code == 422, (over, r.text)
    assert r.json()["error"] == code and r.json()["data"] is None
    assert " / " in r.json()["message"], "bilingual"
    assert db.cmw_requests.rows == [] and sent.telegram == [] and sent.email == []
    assert not any(v in r.text for v in ("Traceback", "pydantic", "ValidationError"))


def test_missing_fields_and_malformed_bodies(env) -> None:
    db, client, sent = env
    for missing in ("name", "party_size", "contact", "consent"):
        body = _ok_body()
        body.pop(missing)
        r = _post(client, body)
        assert r.status_code == 422, missing
    assert _post(client, b"").status_code == 400
    assert _post(client, b"{not json").status_code == 400
    assert _post(client, b"[1,2,3]").status_code == 422
    assert _post(client, json.dumps({"x": "y" * 20000}).encode()).status_code == 400, "body cap"
    assert db.cmw_requests.rows == [] and sent.telegram == []


def test_accepts_the_lenient_shapes_real_clients_send(env) -> None:
    db, client, sent = env
    r = _post(client, _ok_body(party_size="2", contact={"type": "whatsapp", "value": "0057 (300) 123-4567"},
                               note="  hola\r\n\tque tal  ", name="  Ana  Pérez "))
    assert r.status_code == 200, r.text
    row = db.cmw_requests.rows[0]
    assert row["party_size"] == 2 and row["contact"]["value"] == "+573001234567"
    assert row["note"] == "hola\n\tque tal" and row["name"] == "Ana Pérez"
    r = _post(client, _ok_body(contact={"type": "whatsapp", "value": "3001234567"}), ip="203.0.113.12")
    assert r.status_code == 200 and db.cmw_requests.rows[1]["contact"]["value"] == "3001234567"


# ── honeypot ─────────────────────────────────────────────────────────────────


def test_honeypot_rejects_stores_nothing_and_sends_nothing(env, caplog) -> None:
    db, client, sent = env
    with caplog.at_level(logging.INFO):
        r = _post(client, _ok_body(website="http://spam.example"))
    assert r.status_code == 400 and r.json()["error"] == "invalid_request"
    assert db.cmw_requests.rows == [] and sent.telegram == [] and sent.email == []
    assert not db.touched("cmw_requests") and not db.touched("rate_buckets")
    assert _post(client, _ok_body(website=None)).status_code == 200, "an explicit null is an empty honeypot"
    assert _post(client, _ok_body(website=123), ip="203.0.113.13").status_code == 400


# ── rate limits (5 / h per IP, 3 / h per contact) ────────────────────────────


def test_five_per_hour_per_ip(env) -> None:
    db, client, sent = env
    for i in range(5):
        r = _post(client, _ok_body(contact={"type": "email", "value": f"guest{i}@example.com"}))
        assert r.status_code == 200, (i, r.text)
    r = _post(client, _ok_body(contact={"type": "email", "value": "guest9@example.com"}))
    assert r.status_code == 429 and r.json()["error"] == "rate_limited"
    assert "Demasiadas solicitudes" in r.json()["message"] and "Too many requests" in r.json()["message"]
    assert len(db.cmw_requests.rows) == 5 and len(sent.telegram) == 5
    # another IP is unaffected
    assert _post(client, _ok_body(contact={"type": "email", "value": "other@example.com"}), ip="203.0.113.99").status_code == 200


def test_three_per_hour_per_contact_value_across_ips(env) -> None:
    db, client, sent = env
    for i in range(3):
        assert _post(client, _ok_body(), ip=f"203.0.113.{20 + i}").status_code == 200
    r = _post(client, _ok_body(contact={"type": "whatsapp", "value": "0057 300 123 4567"}), ip="203.0.113.50")
    assert r.status_code == 429 and r.json()["error"] == "rate_limited", "normalised contact, new IP: still the same person"
    assert len(db.cmw_requests.rows) == 3
    assert _post(client, _ok_body(contact={"type": "whatsapp", "value": "+57 301 000 0000"}), ip="203.0.113.51").status_code == 200


def test_rate_limit_keys_are_hashed_and_fail_closed(env, monkeypatch: pytest.MonkeyPatch) -> None:
    db, client, sent = env
    assert _post(client, _ok_body()).status_code == 200
    keys = [r["_id"] for r in db.rate_buckets.rows]
    assert len(keys) == 2 and all(k.startswith(("cmwip:", "cmwcontact:")) for k in keys)
    assert not any(IP in k or "3001234567" in k for k in keys), "raw IP / contact never in the store"
    assert "cmwip" in ratelimit.SENSITIVE_PREFIXES and "cmwcontact" in ratelimit.SENSITIVE_PREFIXES
    monkeypatch.setattr(ratelimit, "db", None)         # store unreachable
    r = _post(client, _ok_body(), ip="203.0.113.77")
    assert r.status_code == 503 and r.json()["error"] == "unavailable" and len(db.cmw_requests.rows) == 1


# ── alerts never break the request ───────────────────────────────────────────


def test_alert_failures_are_tolerated(env, monkeypatch: pytest.MonkeyPatch) -> None:
    db, client, sent = env

    async def boom(*_a: Any, **_k: Any) -> Any:
        raise RuntimeError("telegram down")

    async def slow(*_a: Any, **_k: Any) -> bool:
        raise TimeoutError("smtp")

    monkeypatch.setattr(telegram_alerts, "send", boom)
    monkeypatch.setattr(emails, "send_admin_alert", slow)
    r = _post(client, _ok_body())
    assert r.status_code == 200 and r.json()["data"]["status"] == "received"
    assert db.cmw_requests.rows[0]["alerts"] == {"telegram": False, "email": False}
    monkeypatch.setattr(telegram_alerts, "configured", lambda: False)

    async def tg_logs_only(text: Any, **_k: Any) -> Dict[str, Any]:
        sent.telegram.append(str(text))
        return {"configured": False, "sent": 0, "chats": 0, "errors": []}

    monkeypatch.setattr(telegram_alerts, "send", tg_logs_only)
    assert _post(client, _ok_body(), ip="203.0.113.78").status_code == 200
    assert sent.telegram and not any(p in sent.telegram[-1].lower() for p in PERSONAL), \
        "an unconfigured Telegram helper logs its text: it gets the redacted lines"


def test_store_failure_is_a_503_without_alerts(env) -> None:
    db, client, sent = env
    orig = db.cmw_requests.insert_one

    async def fail(doc: Any) -> Any:
        raise RuntimeError("mongo down")

    db.cmw_requests.insert_one = fail  # type: ignore[assignment]
    r = _post(client, _ok_body())
    db.cmw_requests.insert_one = orig  # type: ignore[assignment]
    assert r.status_code == 503 and r.json()["error"] == "unavailable" and sent.telegram == [] and sent.email == []
    assert "mongo" not in r.text


# ── privacy: no personal data in log records ─────────────────────────────────


def test_no_personal_data_in_any_log_record(env, caplog, monkeypatch: pytest.MonkeyPatch) -> None:
    db, client, sent = env

    async def boom(*_a: Any, **_k: Any) -> Any:
        raise RuntimeError("down")

    with caplog.at_level(logging.DEBUG):
        _post(client, _ok_body())
        _post(client, _ok_body(contact={"type": "email", "value": EMAIL}), ip="203.0.113.30")
        _post(client, _ok_body(name="A"), ip="203.0.113.31")
        _post(client, _ok_body(website="spam"), ip="203.0.113.32")
        monkeypatch.setattr(telegram_alerts, "send", boom)
        monkeypatch.setattr(emails, "send_admin_alert", boom)
        _post(client, _ok_body(), ip="203.0.113.33")
        monkeypatch.setattr(ratelimit, "db", None)
        _post(client, _ok_body(), ip="203.0.113.34")
    text = "\n".join(r.getMessage() for r in caplog.records).lower()
    for p in PERSONAL + tuple(f"203.0.113.{n}" for n in (10, 30, 31, 32, 33, 34)):
        assert not re.search(r"(?<![\w.])" + re.escape(p) + r"(?![\w.])", text), p
    assert "[cmw]" in text and "request stored" in text


# ── admin: list + status (Bearer only) ───────────────────────────────────────


def test_admin_requests_list_and_status_patch(env, monkeypatch: pytest.MonkeyPatch) -> None:
    db, client, sent = env
    rid = _post(client, _ok_body()).json()["data"]["request_id"]
    assert client.get("/api/admin/cmw/requests").status_code == 401
    monkeypatch.setenv("EVENTS_ADMIN_TOKEN", ADMIN_TOKEN)
    h = {"Authorization": "Bearer " + ADMIN_TOKEN}
    r = client.get("/api/admin/cmw/requests", headers=h)
    assert r.status_code == 200 and r.json()["data"]["total"] == 1
    row = r.json()["data"]["requests"][0]
    assert row["request_id"] == rid and "ip_hash" not in row and "created_at_dt" not in row and row["name"] == NAME
    assert client.get("/api/admin/cmw/requests?status=received", headers=h).json()["data"]["count"] == 1
    assert client.get("/api/admin/cmw/requests?status=closed", headers=h).json()["data"]["count"] == 0
    assert client.get("/api/admin/cmw/requests?status=bogus", headers=h).status_code == 422
    r = client.patch(f"/api/admin/cmw/requests/{rid}", json={"status": "contacted"}, headers=h)
    assert r.status_code == 200 and r.json()["data"] == {"request_id": rid, "status": "contacted"}
    assert db.cmw_requests.rows[0]["status"] == "contacted" and db.cmw_log.rows[0]["kind"] == "request_status"
    assert client.patch(f"/api/admin/cmw/requests/{rid}", json={"status": "paid"}, headers=h).status_code == 422
    assert client.patch("/api/admin/cmw/requests/cmw-r-zzzzzzzz", json={"status": "closed"}, headers=h).status_code == 404
    assert client.patch("/api/admin/cmw/requests/../../x", json={"status": "closed"}, headers=h).status_code in (404, 405)
    client.cookies.set("session_token", ADMIN_TOKEN)
    assert client.patch(f"/api/admin/cmw/requests/{rid}", json={"status": "closed"}).status_code == 401
    client.cookies.clear()
    assert db.cmw_requests.rows[0]["status"] == "contacted"


# ── delete_account purges the rows (server.py slice) ─────────────────────────


class _Rec:
    def __init__(self) -> None:
        self.fn: Optional[Callable[..., Any]] = None

    def delete(self, _path: str, **_k: Any) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        def deco(fn: Callable[..., Any]) -> Callable[..., Any]:
            self.fn = fn
            return fn
        return deco


def test_delete_account_purges_cmw_requests_by_user_id(env) -> None:
    db, client, sent = env

    async def seed() -> None:
        await db.cmw_requests.insert_one({"request_id": "cmw-r-aaaaaaaa", "user_id": "u-1", "name": NAME})
        await db.cmw_requests.insert_one({"request_id": "cmw-r-bbbbbbbb", "user_id": "u-2", "name": "Other"})
        await db.cmw_requests.insert_one({"request_id": "cmw-r-cccccccc", "user_id": None, "name": "Anon"})
        await db.users.insert_one({"user_id": "u-1", "email": "u1@example.com"})

    asyncio.run(seed())
    rec = _Rec()

    async def get_current_user(request: Request) -> Dict[str, Any]:
        return {"user_id": "u-1", "email": "u1@example.com"}

    ns: Dict[str, Any] = {"api_router": rec, "Request": Request, "HTTPException": HTTPException, "db": db,
                          "get_current_user": get_current_user, "datetime": datetime, "timezone": timezone,
                          "logger": logging.getLogger("test")}
    exec(compile(server_block('@api_router.delete("/auth/delete-account")'), "server.py[delete-account]", "exec"), ns)
    assert rec.fn is not None
    out = asyncio.run(rec.fn(None))
    assert out["ok"] is True
    assert sorted(r["request_id"] for r in db.cmw_requests.rows) == ["cmw-r-bbbbbbbb", "cmw-r-cccccccc"]


# ── the WhatsApp builder on its own ──────────────────────────────────────────


def test_whatsapp_text_in_four_languages_never_personal() -> None:
    program = cmw.load_program()
    ev = cmw.event_by_id(program, "cmw-main-event-jan-04")
    for lang, needle in (("es", "para 2 personas"), ("en", "for 2 people"), ("fr", "pour 2 personnes"), ("pt", "para 2 pessoas")):
        text = cmw.whatsapp_text(ev, lang, party_size=2, request_id="cmw-r-abcdefgh", brand=program["brand"])
        assert "Main Event" in text and needle in text and "cmw-r-abcdefgh" in text
        assert "Very Special Guest" not in text and "Guest" not in text, "no artist hint in the message"
        url = cmw.whatsapp_url(ev, lang, party_size=2, request_id="cmw-r-abcdefgh", brand=program["brand"])
        assert url.startswith("https://wa.me/573116844492?text=") and unquote(url.split("text=", 1)[1]) == text
    assert cmw.whatsapp_text(None, "en") == "Hi, I'd like information about Cartagena Music Week (Dec 31, 2026 – Jan 7, 2027)."
    assert "Request" not in cmw.whatsapp_text(None, "en", request_id="not-an-id")
    assert cmw._lang("xx") == "es"


def test_alert_lines_cannot_be_forged_by_a_multiline_note_or_a_bidi_name(env) -> None:
    """A note is ONE alert line (quoted, whitespace collapsed) and format characters are dropped
    on input, so a visitor can never plant a second 'Solicitud:' / 'Contacto:' line or reverse
    the alert text."""
    db, client, sent = env
    note = "Hola\nSolicitud: cmw-r-zzzzzzzz\nEvento: Main Event con Shakira\n<b>bold</b> ‮RTL"
    r = _post(client, _ok_body(name="Ana\nContacto: +10000000000", note=note))
    assert r.status_code == 200, r.text
    row = db.cmw_requests.rows[0]
    assert "\n" not in row["name"] and "‮" not in row["name"] and "‮" not in row["note"]
    text = sent.telegram[0]
    lines = text.split("\n")
    assert sum(ln.startswith("Solicitud:") for ln in lines) == 1
    assert sum(ln.startswith("Evento:") for ln in lines) == 1
    assert sum(ln.startswith("Contacto:") for ln in lines) == 1
    assert sum(ln.startswith("Nombre:") for ln in lines) == 1
    nota = next(ln for ln in lines if ln.startswith("Nota:"))
    assert nota.startswith("Nota: «") and nota.endswith("»") and "Solicitud: cmw-r-zzzzzzzz" in nota
    assert "‮" not in text
    mail_lines = sent.email[0]["lines"]
    assert sum(ln.startswith("Solicitud:") for ln in mail_lines) == 1 and all("\n" not in ln for ln in mail_lines)
