"""CMW program: schema, the ten printed rows, the tba rules, merge / override rules and the
public + admin program routes (docs/cmw/DESIGN.md §1.1, §2, §3, §6).

Pure: the committed backend/data/cmw_program.json, an in-memory Mongo stub, the real cmw
router on a throwaway FastAPI app. No Atlas, no network, never imports server.py.

Run: cd backend && python -m pytest -q tests/test_cmw_program.py
"""
from __future__ import annotations

import asyncio
import copy
import json
import os
import re
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS = os.path.dirname(os.path.abspath(__file__))
for p in (BACKEND, TESTS):
    if p not in sys.path:
        sys.path.insert(0, p)

import cmw  # noqa: E402
import luna_events as L  # noqa: E402
from events_service_stubs import StubDB, server_src  # noqa: E402

LANGS = ("es", "en", "fr", "pt")
ADMIN_TOKEN = "cmw-test-admin-token-0123456789abcdef"
NOW = datetime(2026, 9, 29, 17, 0, tzinfo=timezone.utc)

# DESIGN §1.1, exactly as printed on the calendar page (title compared accent-insensitively:
# the deck prints "BOHÊME" with a circumflex, DESIGN §1.1 writes "Bohème").
PRINTED = [
    ("cmw-zamna-on-the-beach", "2026-12-31", "Zamna on the Beach", "Bethel Bellini", "ptr_dv_003", "party", {"time", "price"}),
    ("cmw-casa-boheme-we-are-us", "2026-12-31", "Casa Boheme × We Are Us", "Casa Boheme", "ptr_V014", "party", {"time", "price"}),
    ("cmw-after-new-year", "2027-01-01", "After New Year", None, None, "after", {"venue", "time", "price"}),
    ("cmw-wellness", "2027-01-02", "Wellness", "Bethel Bellini", "ptr_dv_003", "wellness", {"time", "price"}),
    ("cmw-catamaran-sunset-party", "2027-01-02", "Catamaran Sunset Party", None, None, "sunset", {"boarding_point", "time", "price"}),
    ("cmw-stardust-by-saraga", "2027-01-03", "Stardust by Saraga", "El Lago", None, "party", {"time", "price"}),
    ("cmw-main-event-jan-04", "2027-01-04", "Main Event", None, None, "main_event", {"artist", "venue", "time", "price"}),
    ("cmw-main-event-after", "2027-01-05", "Main Event After", "El Templo", None, "after", {"time", "price"}),
    ("cmw-main-event-jan-06", "2027-01-06", "Main Event", None, None, "main_event", {"artist", "venue", "time", "price"}),
    ("cmw-after-temple", "2027-01-07", "After Temple", "El Templo", None, "after", {"time", "price"}),
]

HHMM_RE = re.compile(r"(?<![\d:])(?:[01]?\d|2[0-3]):[0-5]\d(?!\d)")
CURRENCY_RE = re.compile(r"[$€£]\s?\d|\b\d[\d.,]*\s?(?:cop|usd|eur|pesos?|d[oó]lares|dollars?|euros?|reais)\b", re.I)


def _fold(s: str) -> str:
    return L.fold_keep(s)


def _strings(node: Any, path: str = "") -> List[tuple]:
    out: List[tuple] = []
    if isinstance(node, dict):
        for k, v in node.items():
            out += _strings(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            out += _strings(v, f"{path}[{i}]")
    elif isinstance(node, str):
        out.append((path, node))
    return out


@pytest.fixture(autouse=True)
def _fresh(monkeypatch: pytest.MonkeyPatch):
    cmw.reset_program_cache()
    cmw.reset_indexes_flag()
    monkeypatch.delenv("EVENTS_ADMIN_TOKEN", raising=False)
    yield
    cmw.reset_program_cache()
    cmw.reset_indexes_flag()


def _db(*, partners: bool = True) -> StubDB:
    db = StubDB()
    if partners:
        async def seed() -> None:
            await db.partners.insert_one({"partner_id": "ptr_dv_003", "name": "Bethel Bellini Beach Club",
                                          "zone": "Tierra Bomba", "location": {"lat": 10.382, "lng": -75.568},
                                          "address": "never copied"})
            await db.partners.insert_one({"partner_id": "ptr_V014", "name": "Casa Bohême", "neighborhood": "Centro",
                                          "location": {"lat": 10.4241036, "lng": -75.5518067}})
            await db.partners.insert_one({"partner_id": "ptr_hidden", "name": "Sandbox", "catalog_status": "sandbox",
                                          "location": {"lat": 10.42, "lng": -75.55}})
        asyncio.run(seed())
    return db


def _app(db: StubDB) -> TestClient:
    cmw.init(db_=db)
    app = FastAPI()
    app.include_router(cmw.router, prefix="/api")
    return TestClient(app)


# ── the base file (§1.1, §2) ─────────────────────────────────────────────────


def test_base_program_validates_and_is_read_once_per_process(monkeypatch: pytest.MonkeyPatch) -> None:
    program = cmw.load_program()
    assert cmw.validate_program(program) == []
    assert program["version"] == 1 and program["source_name"] == "Programa oficial Cartagena Music Week"
    assert program["brand"]["start_date"] == "2026-12-31" and program["brand"]["end_date"] == "2027-01-07"
    assert program["brand"]["concierge"]["whatsapp_e164"] == "+573116844492"
    assert program["brand"]["concierge"]["display"] == "+57 311 6844492"
    assert program["brand"]["concierge"]["assistant"] == "Valentina"
    assert [p["key"] for p in program["brand"]["pillars"]] == ["music", "culture", "wellness", "gastronomy", "ocean", "people"]
    opened: List[str] = []
    real_open = open

    def spy(path: Any, *a: Any, **k: Any):
        opened.append(str(path))
        return real_open(path, *a, **k)

    monkeypatch.setattr("builtins.open", spy)
    cmw.load_program()
    cmw.load_program()
    assert not any(p.endswith("cmw_program.json") for p in opened), "read once per process"
    # a copy: mutating the result never touches the cache
    prog = cmw.load_program()
    prog["events"][0]["time"] = "22:00"
    assert cmw.load_program()["events"][0]["time"] is None


def test_exactly_the_ten_printed_rows_in_calendar_order() -> None:
    program = cmw.load_program()
    events = program["events"]
    assert len(events) == 10
    assert [e["id"] for e in events] == [row[0] for row in PRINTED]
    for ev, (eid, day, title, venue, venue_id, category, tba) in zip(events, PRINTED):
        assert ev["date"] == day, eid
        assert _fold(ev["title"]) == _fold(title), eid
        assert ev["venue_name"] is None if venue is None else _fold(ev["venue_name"]) == _fold(venue), eid
        assert ev["venue_id"] == venue_id, eid
        assert ev["category"] == category, eid
        assert set(ev["tba"]) == tba, eid
        assert ev["booking_type"] == "concierge"
        assert ev["lat"] is None and ev["lng"] is None, "coordinates come only from the catalog"
        assert ev["day_index"] == (cmw.parse_ymd(day) - cmw.parse_ymd("2026-12-31")).days + 1
    assert {e["date"] for e in events} == {"2026-12-31"} | {f"2027-01-0{d}" for d in range(1, 8)}, "eight days"


def test_every_l4_complete_in_four_languages() -> None:
    program = cmw.load_program()
    brand = program["brand"]
    for key in ("tagline", "access_note", "days_label"):
        assert cmw.l4_ok(brand[key]), key
    for t in brand["taglines"]:
        assert cmw.l4_ok(t)
    for p in brand["pillars"]:
        assert cmw.l4_ok(p["label"])
    for key in ("intro", "assistant_note"):
        assert cmw.l4_ok(brand["concierge"][key])
    for s in brand["concierge"]["services"]:
        assert cmw.l4_ok(s)
    for pr in brand["practical"]:
        assert cmw.l4_ok(pr["title"]) and cmw.l4_ok(pr["body"])
        assert pr["link"] in (None, "/ciudad")
    for ev in program["events"]:
        assert cmw.l4_ok(ev["description"]), ev["id"]
        if ev["subtitle"] is not None:
            assert cmw.l4_ok(ev["subtitle"]), ev["id"]


def test_no_value_on_any_tba_field_and_only_the_placeholder_artist() -> None:
    program = cmw.load_program()
    for ev in program["events"]:
        tba = set(ev["tba"])
        if "time" in tba:
            assert ev["time"] is None and ev["end_time"] is None, ev["id"]
        if "price" in tba:
            assert ev["price_info"] is None, ev["id"]
        if "venue" in tba:
            assert ev["venue_name"] is None and ev["venue_id"] is None, ev["id"]
        if "artist" in tba:
            assert ev["artist_status"] == "tba" and ev["artist"] == "Very Special Guest", ev["id"]
        else:
            assert ev["artist_status"] == "none" and ev["artist"] is None, ev["id"]
        # every printed row: time and price are unannounced
        assert {"time", "price"} <= tba
        assert ev["status"] == ("tba" if tba & {"venue", "artist", "boarding_point"} else "confirmed")
    artists = {ev["artist"] for ev in program["events"]} - {None}
    assert artists == {"Very Special Guest"}


def test_regex_scan_no_times_prices_or_person_names_anywhere_in_the_program() -> None:
    program = cmw.load_program()
    texts = _strings(program)
    for path, s in texts:
        assert not HHMM_RE.search(s), (path, s)
        assert not CURRENCY_RE.search(s), (path, s)
    # a capitalised person-like name next to "Main Event" (any language)
    known = set()
    for ev in program["events"]:
        known.update(L._norm_words(ev["title"]).split())
        known.update(L._norm_words(ev["venue_name"] or "").split())
    known.update(L._norm_words("Cartagena Music Week Very Special Guest AMO Life Valentina").split())
    for path, s in texts:
        for m in re.finditer(r"main event", s, re.I):
            for wm in re.finditer(r"(?<![.!?]\s)\b[A-ZÁÉÍÓÚÑÜÇÀÂÊÔÃÕ][\w'’-]{2,}", s):
                if not m.end() <= wm.start() <= m.end() + 80:
                    continue
                w = wm.group(0)
                tok = L._alnum(L.fold_keep(w))
                assert tok in known or tok in L._ENTITY_STOP or tok in L._NAME_GENERIC_WORDS, (path, w, s)
            assert not L._unknown_name_spans(s, known), (path, s)
    raw = json.dumps(program, ensure_ascii=False).lower()
    for banned in ("headliner", "line-up", "lineup", "dj ", "confirmado con", "featuring"):
        assert banned not in raw, banned


def test_validate_program_catches_every_rule() -> None:
    base = cmw.load_program()

    def broken(mut) -> List[str]:
        p = copy.deepcopy(base)
        mut(p)
        return cmw.validate_program(p, base)

    def ev(p: Dict[str, Any], eid: str) -> Dict[str, Any]:
        return next(e for e in p["events"] if e["id"] == eid)

    assert broken(lambda p: p["events"].pop()) and any("exactly the ids" in x for x in broken(lambda p: p["events"].pop()))
    assert any("exactly the ids" in x for x in broken(lambda p: p["events"].append(dict(p["events"][0], id="cmw-extra"))))
    assert any(".time:" in x for x in broken(lambda p: ev(p, "cmw-zamna-on-the-beach").update(time="22:00")))
    assert any("price_info" in x for x in broken(lambda p: ev(p, "cmw-zamna-on-the-beach").update(price_info="$100")))
    assert any("venue_name" in x for x in broken(lambda p: ev(p, "cmw-after-new-year").update(venue_name="Somewhere")))
    assert any("artist" in x for x in broken(lambda p: ev(p, "cmw-main-event-jan-04").update(artist="Some Name")))
    assert any("artist" in x for x in broken(lambda p: ev(p, "cmw-zamna-on-the-beach").update(artist="Some Name")))
    assert any("title" in x for x in broken(lambda p: ev(p, "cmw-zamna-on-the-beach").update(title="Zamna!")))
    assert any("L4" in x for x in broken(lambda p: ev(p, "cmw-wellness")["description"].pop("fr")))
    assert any("lat/lng" in x for x in broken(lambda p: ev(p, "cmw-wellness").update(lat=10.4)))
    assert any("description: states a time" in x for x in broken(
        lambda p: ev(p, "cmw-wellness")["description"].update(es="Yoga a las 7:00 am frente al mar.")))
    assert any("description: states a price" in x for x in broken(
        lambda p: ev(p, "cmw-wellness")["description"].update(en="Entry $50 USD.")))
    assert any("status" in x for x in broken(lambda p: ev(p, "cmw-main-event-jan-04").update(status="confirmed")))
    assert any("whatsapp_e164" in x for x in broken(lambda p: p["brand"]["concierge"].update(whatsapp_e164="+571234567")))
    assert cmw.validate_program({"brand": {}, "events": []}) and cmw.validate_program("nope") == ["program: not an object"]


# ── merge / override rules (§2) ──────────────────────────────────────────────


def test_override_with_source_note_moves_a_field_from_tba_to_confirmed() -> None:
    base = cmw.load_program()
    merged = cmw.apply_overrides(base, [{"event_id": "cmw-zamna-on-the-beach", "fields": {"time": "21:00", "end_time": "04:00"},
                                         "source_note": "Confirmed by the organiser on 2026-12-01"}])
    ev = cmw.event_by_id(merged, "cmw-zamna-on-the-beach")
    assert ev["time"] == "21:00" and ev["end_time"] == "04:00" and ev["tba"] == ["price"]
    assert cmw.validate_program(merged, base) == []
    # the base is untouched and the other rows are unchanged
    assert cmw.event_by_id(base, "cmw-zamna-on-the-beach")["time"] is None
    assert cmw.event_by_id(merged, "cmw-wellness") == cmw.event_by_id(base, "cmw-wellness")


def test_override_without_source_note_is_refused_strict_and_skipped_on_read() -> None:
    base = cmw.load_program()
    doc = {"event_id": "cmw-zamna-on-the-beach", "fields": {"time": "21:00"}, "source_note": ""}
    with pytest.raises(cmw.OverrideError) as exc:
        cmw.apply_overrides(base, [doc], strict=True)
    assert exc.value.code == "source_note_required" and exc.value.field == "time"
    merged = cmw.apply_overrides(base, [doc])            # read path: skipped, the program survives
    assert cmw.event_by_id(merged, "cmw-zamna-on-the-beach")["time"] is None
    assert "time" in cmw.event_by_id(merged, "cmw-zamna-on-the-beach")["tba"]
    # a note-less override may still change a non-fact field (image / description)
    merged2 = cmw.apply_overrides(base, [{"event_id": "cmw-zamna-on-the-beach", "fields": {"image": "/images/cmw/zamna.jpg"}}])
    assert cmw.event_by_id(merged2, "cmw-zamna-on-the-beach")["image"] == "/images/cmw/zamna.jpg"


def test_override_rules_artist_venue_date_and_unknowns() -> None:
    base = cmw.load_program()
    note = "Confirmed by the promoter 2026-12-20"
    # an artist override that is still the placeholder keeps the row tba
    m = cmw.apply_overrides(base, [{"event_id": "cmw-main-event-jan-04", "fields": {"artist": "Very Special Guest"}, "source_note": note}])
    e = cmw.event_by_id(m, "cmw-main-event-jan-04")
    assert e["artist_status"] == "tba" and "artist" in e["tba"] and e["status"] == "tba"
    # a named artist confirms it, but venue + time stay unannounced so the row stays tba
    m = cmw.apply_overrides(base, [{"event_id": "cmw-main-event-jan-04", "fields": {"artist": "Nombre Confirmado"}, "source_note": note}])
    e = cmw.event_by_id(m, "cmw-main-event-jan-04")
    assert e["artist_status"] == "confirmed" and "artist" not in e["tba"] and e["status"] == "tba"
    assert cmw.validate_program(m, base) == []
    # venue_name clears the venue tag; a date move recomputes day_index and keeps date order
    m = cmw.apply_overrides(base, [{"event_id": "cmw-after-new-year", "fields": {"venue_name": "Nuevo Lugar", "date": "2027-01-02"},
                                    "source_note": note}])
    e = cmw.event_by_id(m, "cmw-after-new-year")
    assert e["venue_name"] == "Nuevo Lugar" and "venue" not in e["tba"] and e["day_index"] == 3
    assert [x["id"] for x in m["events"]][:5] == ["cmw-zamna-on-the-beach", "cmw-casa-boheme-we-are-us", "cmw-after-new-year",
                                                  "cmw-wellness", "cmw-catamaran-sunset-party"], "sorted by date, then printed order"
    assert [x["id"] for x in cmw.events_on(m, "2027-01-01")] == []
    # unknown ids / fields / bad values are ignored on read
    m = cmw.apply_overrides(base, [{"event_id": "cmw-nope", "fields": {"time": "20:00"}, "source_note": note},
                                   {"event_id": "cmw-wellness", "fields": {"lat": 10.4, "time": "25:00"}, "source_note": note}])
    assert cmw.validate_program(m, base) == [] and cmw.event_by_id(m, "cmw-wellness")["time"] is None
    with pytest.raises(cmw.OverrideError):
        cmw.apply_overrides(base, [{"event_id": "cmw-wellness", "fields": {"time": "25:00"}, "source_note": note}], strict=True)


def test_merged_program_resolves_catalog_venues_only_and_keeps_nulls_elsewhere() -> None:
    db = _db()
    program = asyncio.run(cmw.merged_program(db))
    assert program["_degraded"] is False
    zamna = cmw.event_by_id(program, "cmw-zamna-on-the-beach")
    assert zamna["venue"] == {"id": "ptr_dv_003", "name": "Bethel Bellini Beach Club", "lat": 10.382, "lng": -75.568,
                              "neighborhood": "Tierra Bomba"}
    assert zamna["lat"] == 10.382 and zamna["lng"] == -75.568
    assert "address" not in json.dumps(zamna["venue"]), "the catalog address is never copied"
    boheme = cmw.event_by_id(program, "cmw-casa-boheme-we-are-us")
    assert boheme["venue"]["id"] == "ptr_V014" and boheme["venue"]["neighborhood"] == "Centro"
    for eid in ("cmw-stardust-by-saraga", "cmw-main-event-after", "cmw-after-temple", "cmw-main-event-jan-04",
                "cmw-after-new-year", "cmw-catamaran-sunset-party"):
        e = cmw.event_by_id(program, eid)
        assert e["venue"] is None and e["lat"] is None and e["lng"] is None, eid
    # a venue missing from the catalog / hidden by the visibility filter: no pin, never a guess
    db2 = _db(partners=False)
    program2 = asyncio.run(cmw.merged_program(db2))
    assert cmw.event_by_id(program2, "cmw-zamna-on-the-beach")["venue"] is None
    public = cmw.public_program(program2, NOW)
    assert "_degraded" not in public and public["generated_at"].endswith("Z")


def test_merged_program_serves_the_base_when_overrides_are_unreadable_or_invalid() -> None:
    db = _db()
    db.cmw_overrides.fail_reads = True
    program = asyncio.run(cmw.merged_program(db))
    assert program["_degraded"] is True
    base = cmw.load_program()
    for ev in program["events"]:
        b = cmw.event_by_id(base, ev["id"])
        assert (ev["time"], ev["price_info"], ev["artist"], ev["tba"]) == (b["time"], b["price_info"], b["artist"], b["tba"])
    db2 = _db()
    asyncio.run(db2.cmw_overrides.insert_one({"event_id": "cmw-zamna-on-the-beach", "fields": {"title": "Zamna!!", "time": "22:00"},
                                              "source_note": "x"}))
    program2 = asyncio.run(cmw.merged_program(db2, use_cache=False))
    assert cmw.event_by_id(program2, "cmw-zamna-on-the-beach")["time"] == "22:00"
    assert cmw.event_by_id(program2, "cmw-zamna-on-the-beach")["title"] == "Zamna on the Beach", "title is not overridable"


# ── routes (§3) ──────────────────────────────────────────────────────────────


def test_get_program_is_public_cached_and_shaped() -> None:
    client = _app(_db())
    r = client.get("/api/cmw/program")
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"data", "error", "message"} and body["error"] is None
    data = body["data"]
    assert data["generated_at"] and len(data["events"]) == 10 and data["brand"]["name"] == "Cartagena Music Week"
    assert "requests" not in json.dumps(data) and "cmw_log" not in json.dumps(data)
    assert r.headers["cache-control"] == "public, max-age=300, s-maxage=300, stale-while-revalidate=600"
    ev = next(e for e in data["events"] if e["id"] == "cmw-zamna-on-the-beach")
    assert ev["venue"]["id"] == "ptr_dv_003" and ev["lat"] == 10.382
    main = next(e for e in data["events"] if e["id"] == "cmw-main-event-jan-04")
    assert main["artist"] == "Very Special Guest" and main["artist_status"] == "tba" and main["venue"] is None
    for e in data["events"]:
        assert e["time"] is None and e["price_info"] is None


def test_admin_routes_accept_only_the_bearer_token_never_a_cookie(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _app(_db())
    assert client.get("/api/admin/cmw/log").status_code == 401
    assert client.get("/api/admin/cmw/requests").status_code == 401
    monkeypatch.setenv("EVENTS_ADMIN_TOKEN", ADMIN_TOKEN)
    assert client.get("/api/admin/cmw/log", headers={"Authorization": "Bearer wrong"}).status_code == 403
    client.cookies.set("session_token", ADMIN_TOKEN)
    assert client.get("/api/admin/cmw/log").status_code == 401, "a cookie is never an admin credential"
    client.cookies.clear()
    r = client.get("/api/admin/cmw/log", headers={"Authorization": "Bearer " + ADMIN_TOKEN})
    assert r.status_code == 200 and r.json()["data"]["log"] == [] and r.headers["cache-control"] == "no-store"
    monkeypatch.delenv("EVENTS_ADMIN_TOKEN")
    assert client.get("/api/admin/cmw/log", headers={"Authorization": "Bearer " + ADMIN_TOKEN}).status_code == 403, \
        "no token configured = nobody is admin"


def test_admin_event_override_requires_source_note_writes_log_and_invalidates(monkeypatch: pytest.MonkeyPatch) -> None:
    db = _db()
    client = _app(db)
    monkeypatch.setenv("EVENTS_ADMIN_TOKEN", ADMIN_TOKEN)
    h = {"Authorization": "Bearer " + ADMIN_TOKEN}
    r = client.patch("/api/admin/cmw/events/cmw-zamna-on-the-beach", json={"fields": {"time": "21:00"}}, headers=h)
    assert r.status_code == 422 and r.json()["error"] == "source_note_required" and " / " in r.json()["message"]
    assert db.cmw_overrides.rows == [] and db.cmw_log.rows == []
    r = client.patch("/api/admin/cmw/events/cmw-zamna-on-the-beach",
                     json={"fields": {"time": "21:00"}, "source_note": "Organiser email, 2026-12-01"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["event"]["time"] == "21:00" and r.json()["data"]["changes"]["time"] == {"from": None, "to": "21:00"}
    assert r.json()["data"]["changes"]["tba"] == {"from": ["time", "price"], "to": ["price"]}
    assert db.cmw_overrides.rows[0]["event_id"] == "cmw-zamna-on-the-beach" and db.cmw_overrides.rows[0]["updated_by"] == "admin:token"
    log = db.cmw_log.rows[0]
    assert log["kind"] == "event_override" and log["source_note"] == "Organiser email, 2026-12-01" and log["actor"] == "admin:token"
    # the public program reflects it (cache invalidated)
    ev = next(e for e in client.get("/api/cmw/program").json()["data"]["events"] if e["id"] == "cmw-zamna-on-the-beach")
    assert ev["time"] == "21:00" and ev["tba"] == ["price"]
    # the placeholder never counts as a confirmed artist; an unknown catalog venue is refused
    r = client.patch("/api/admin/cmw/events/cmw-main-event-jan-04",
                     json={"fields": {"artist": "Very Special Guest"}, "source_note": "x"}, headers=h)
    assert r.status_code == 200 and r.json()["data"]["event"]["artist_status"] == "tba"
    r = client.patch("/api/admin/cmw/events/cmw-main-event-jan-04",
                     json={"fields": {"venue_id": "ptr_nope", "venue_name": "Nuevo Lugar"}, "source_note": "x"}, headers=h)
    assert r.status_code == 422 and r.json()["error"] == "unknown_venue"
    r = client.patch("/api/admin/cmw/events/cmw-main-event-jan-04",
                     json={"fields": {"venue_id": "ptr_hidden", "venue_name": "Nuevo Lugar"}, "source_note": "x"}, headers=h)
    assert r.status_code == 422, "a non-public partner is not a venue"
    r = client.patch("/api/admin/cmw/events/cmw-main-event-jan-04", json={"fields": {"title": "New"}, "source_note": "x"}, headers=h)
    assert r.status_code == 422 and r.json()["error"] == "invalid_field"
    assert client.patch("/api/admin/cmw/events/cmw-nope", json={"fields": {"time": "20:00"}, "source_note": "x"}, headers=h).status_code == 404
    assert client.patch("/api/admin/cmw/events/cmw-wellness", json={"fields": {"time": "20:00"}, "source_note": "x"}).status_code == 401
    # null clears an override back to the base
    r = client.patch("/api/admin/cmw/events/cmw-zamna-on-the-beach", json={"fields": {"time": None}, "source_note": "revert"}, headers=h)
    assert r.status_code == 200 and r.json()["data"]["event"]["time"] is None and "time" in r.json()["data"]["event"]["tba"]


def test_cmw_router_is_mounted_before_api_router_and_purges_requests_on_delete() -> None:
    src = server_src()
    mount = src.index("app.include_router(_cmw.router, prefix=\"/api\")")
    assert src.index("app.include_router(_events_elite.router") < mount < src.index("app.include_router(api_router)")
    assert "_cmw.init(db_=db)" in src
    block = src[src.index('@api_router.delete("/auth/delete-account")'):]
    block = block[: block.index("\n\n\n")]
    assert 'db.cmw_requests.delete_many({"user_id": user_id})' in block


def test_indexes_are_created_idempotently() -> None:
    db = _db()
    assert asyncio.run(cmw.ensure_cmw_indexes(db)) is True
    assert asyncio.run(cmw.ensure_cmw_indexes(db)) is True
    req_ix = asyncio.run(db.cmw_requests.index_information())
    assert req_ix["request_id_1"]["unique"] is True and "created_at_dt_1" in req_ix
    assert asyncio.run(db.cmw_overrides.index_information())["event_id_1"]["unique"] is True


def test_description_override_needs_a_note_and_may_not_name_the_guest_or_hint_a_venue(monkeypatch: pytest.MonkeyPatch) -> None:
    """§0: the guest is never named or hinted at; a venue / boarding point is never hinted at.
    The description prints as fact on the detail page and in Luna, so it is a fact field."""
    db = _db()
    client = _app(db)
    monkeypatch.setenv("EVENTS_ADMIN_TOKEN", ADMIN_TOKEN)
    h = {"Authorization": "Bearer " + ADMIN_TOKEN}
    l4 = lambda s: {k: s for k in LANGS}  # noqa: E731
    r = client.patch("/api/admin/cmw/events/cmw-main-event-jan-04", json={"fields": {"description": l4("Con Shakira como invitada especial.")}}, headers=h)
    assert r.status_code == 422 and r.json()["error"] == "source_note_required"
    r = client.patch("/api/admin/cmw/events/cmw-main-event-jan-04",
                     json={"fields": {"description": l4("Con Shakira como invitada especial.")}, "source_note": "Promoter, 2026-12-20"}, headers=h)
    assert r.status_code == 422 and r.json()["error"] == "invalid_override"
    assert any("names a person or a place" in p for p in r.json()["data"]["problems"])
    r = client.patch("/api/admin/cmw/events/cmw-after-new-year",
                     json={"fields": {"description": l4("En La Movida, Getsemaní.")}, "source_note": "Promoter, 2026-12-20"}, headers=h)
    assert r.status_code == 422 and r.json()["error"] == "invalid_override"
    r = client.patch("/api/admin/cmw/events/cmw-catamaran-sunset-party",
                     json={"fields": {"description": l4("Sale del Muelle de la Bodeguita.")}, "source_note": "Promoter, 2026-12-20"}, headers=h)
    assert r.status_code == 422 and r.json()["error"] == "invalid_override"
    # neutral prose with a note is fine; once the artist is confirmed, naming them is fine too
    r = client.patch("/api/admin/cmw/events/cmw-main-event-jan-04",
                     json={"fields": {"description": l4("Parte del programa oficial de Cartagena Music Week.")}, "source_note": "Editorial, 2026-12-20"}, headers=h)
    assert r.status_code == 200, r.text
    r = client.patch("/api/admin/cmw/events/cmw-main-event-jan-04",
                     json={"fields": {"artist": "Nombre Confirmado", "venue_name": "Nuevo Lugar",
                                      "description": l4("Con Nombre Confirmado en Nuevo Lugar.")}, "source_note": "Promoter, 2026-12-20"}, headers=h)
    assert r.status_code == 200, r.text
    ev = next(e for e in client.get("/api/cmw/program").json()["data"]["events"] if e["id"] == "cmw-main-event-jan-04")
    assert ev["description"]["es"] == "Con Nombre Confirmado en Nuevo Lugar."
    assert cmw.PLACEHOLDER_ARTIST not in ev["description"]["es"]
