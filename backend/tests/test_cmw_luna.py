"""CMW Luna (docs/cmw/DESIGN.md §5, §6): deterministic Music Week answers, never the LLM.

V5 (a) a day/program question, (b) a TBA (artist) question, (c) during the week a GENERAL event
question gets the official program first, then the verified city agenda — each in es/en/fr/pt
with an explicit `now` inside the window. Plus: before-window honesty, a bank of ≥ 30 questions
(venue-only questions are NOT CMW), no llm_complete call, the sanitizer allowlist, the hook
placement and the guard that replaces an LLM reply naming an artist for the Main Event.

Pure: in-memory Mongo stub, patched llm.llm_complete, the real events gate / runtime read path.
No Atlas, no network, never imports server.py.

Run: cd backend && python -m pytest -q tests/test_cmw_luna.py
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS = os.path.dirname(os.path.abspath(__file__))
for p in (BACKEND, TESTS):
    if p not in sys.path:
        sys.path.insert(0, p)

import ai_agent as A  # noqa: E402
import cmw  # noqa: E402
import events_runtime as R  # noqa: E402
import llm as LLM  # noqa: E402
import luna_cmw as LC  # noqa: E402
import luna_events as L  # noqa: E402
from events_service_stubs import StubDB, with_event_indexes  # noqa: E402

UTC = timezone.utc
IN_WINDOW = datetime(2027, 1, 2, 20, 0, tzinfo=UTC)      # Sat 2 Jan 2027, 15:00 Bogotá (day 3 of 8)
MAIN_DAY = datetime(2027, 1, 4, 20, 0, tzinfo=UTC)       # Mon 4 Jan 2027: Main Event day
BEFORE = datetime(2026, 9, 29, 17, 0, tzinfo=UTC)        # today (design date)
AFTER = datetime(2027, 1, 20, 17, 0, tzinfo=UTC)
LANGS = ("es", "en", "fr", "pt")
OFFICIAL = {"es": "Programa oficial Cartagena Music Week", "en": "Official Cartagena Music Week program",
            "fr": "Programme officiel Cartagena Music Week", "pt": "Programa oficial da Cartagena Music Week"}
PHONE = "+57 311 6844492"
TB = "https://tuboleta.com/es/eventos/salsa-en-la-plaza-2027"
SALSA = "ce-salsa-en-la-plaza-20270102-a1a1"
ARTIST_NAMES = ("David Guetta", "Shakira", "Bad Bunny", "Tiësto", "Carlos Vives", "Solomun", "Karol G")


def _lv(now: datetime) -> str:
    return (now - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _row(now: datetime) -> Dict[str, Any]:
    day = now.astimezone(L.BOGOTA).date().isoformat()
    return {
        "event_id": SALSA, "canonical_key": "salsa en la plaza|2027|plaza de la aduana", "title": {"es": "Salsa en la Plaza"},
        "description": {"es": "interna"}, "category": "concert", "edition_year": 2027, "start_date": day, "end_date": day,
        "start_time": "20:00", "end_time": None, "time_confirmed": True, "venue_name": "Plaza de la Aduana", "address": None,
        "zone": "centro", "lat": 10.4225, "lng": -75.5497, "geocode_source": "gazetteer",
        "price": {"is_free": False, "min_cop": 50000, "max_cop": None, "text": None},
        "ticket_url": TB, "source_url": TB, "source_name": "TuBoleta", "source_tier": 2, "recheck_url": TB,
        "source_keys": ["t:salsa"],
        "evidence": [{"url": TB, "name": "src", "tier": 2, "fetched_at": _lv(now), "http_status": 200,
                      "date_text": f"{day} · 8:00 p. m.", "date_visible": True, "start_date": day, "end_date": day,
                      "start_time": "20:00"}],
        "last_verified": _lv(now), "verified_by": "pipeline", "country_check": "pass", "country_signals": ["pass:t"],
        "status": "published", "status_reason": None, "confidence": "HIGH", "origin": "pipeline", "sold_out": False,
        "parent_id": None, "is_umbrella": False, "image_url": None,
    }


def make_db(now: datetime = IN_WINDOW, *, city_rows: bool = True, enabled: bool = True) -> StubDB:
    db = asyncio.run(with_event_indexes(StubDB()))

    async def seed() -> None:
        await db.city_events_state.insert_one({"_id": "flags", "enabled": enabled})
        await db.city_events_runs.insert_one({"kind": "sentinel", "done": True,
                                              "finished_at": (now - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")})
        if city_rows:
            await db.city_events.insert_one(_row(now))
        await db.partners.insert_one({"partner_id": "ptr_dv_003", "name": "Bethel Bellini Beach Club", "zone": "Tierra Bomba",
                                      "location": {"lat": 10.382, "lng": -75.568}})
        await db.partners.insert_one({"partner_id": "ptr_V014", "name": "Casa Bohême", "neighborhood": "Centro",
                                      "location": {"lat": 10.4241036, "lng": -75.5518067}})
        await db.partners.insert_one({"partner_id": "ptr_celele", "name": "Celele", "category": "restaurant",
                                      "location": {"lat": 10.426, "lng": -75.546}})

    asyncio.run(seed())
    db.accessed.clear()
    return db


class FakeLLM:
    """Records calls; `reply` is what the LLM answers, None = never expected to be called."""

    def __init__(self, reply: Optional[Dict[str, Any]] = None) -> None:
        self.reply = reply
        self.calls: List[str] = []

    async def __call__(self, system: str, user_text: str, **kw: Any) -> Optional[str]:
        self.calls.append(user_text)
        if self.reply is None:
            raise AssertionError("llm_complete must not be called on this turn")
        return json.dumps(self.reply, ensure_ascii=False)


def _reply(message: str, **extra: Any) -> Dict[str, Any]:
    out = {"message": message, "language": "es", "recommendations": [], "actions": [], "suggestions": []}
    out.update(extra)
    return out


@pytest.fixture(autouse=True)
def _fresh() -> Any:
    cmw.reset_program_cache()
    cmw.invalidate_cache()
    R.invalidate_caches()
    yield
    cmw.reset_program_cache()
    cmw.invalidate_cache()
    R.invalidate_caches()


def turn(db: StubDB, text: str, fake: FakeLLM, monkeypatch: pytest.MonkeyPatch, *, now: datetime = IN_WINDOW,
         **kw: Any) -> Dict[str, Any]:
    monkeypatch.setattr(LLM, "llm_complete", fake)
    kw.setdefault("history", [])
    return asyncio.run(A.run_agent_turn(db, user=None, user_text=text, now=now, **kw))


def _program(db: StubDB) -> Dict[str, Any]:
    return asyncio.run(cmw.merged_program(db, use_cache=False))


def _assert_honest(payload: Dict[str, Any], program: Dict[str, Any], lang: str) -> None:
    """Every deterministic payload: allowed action types / URLs only, never an artist name, a
    time, a price or a 'confirmed' booking state, and the guard finds nothing to object to."""
    assert payload["language"] == lang
    for a in payload["actions"]:
        assert a["type"] in ("external_link", "open_partner", "navigate"), a
        if a["type"] == "external_link":
            assert L.cmw_url_allowed(a["url"]), a["url"]
        if a["type"] == "navigate":
            assert a["screen"] in ("ciudad", "agenda"), a
        if a["type"] == "open_partner":
            assert a["partner_id"] in ("ptr_dv_003", "ptr_V014"), a
    assert len(payload["actions"]) <= 4
    text = payload["message"]
    for name in ARTIST_NAMES:
        assert name not in text
    low = text.lower()
    for banned in ("confirmado tu", "reservado", "checkout", "booked", "your booking is confirmed", "pago", "payment"):
        assert banned not in low, banned
    assert not re.search(r"(?<![\d:])(?:[01]?\d|2[0-3]):[0-5]\d(?!\d)", text), "no time in a program with no times"
    assert not re.search(r"[$€£]\s?\d|\bcop\b|\busd\b", text, re.I)
    assert LC.find_cmw_violations(text, program, lang) == [], text
    for s in payload["suggestions"]:
        assert LC.detect_cmw_intent(s, lang, IN_WINDOW)["is_cmw"], "quick replies stay on the deterministic path"


# ── V5 (a): a day / program question, four languages ─────────────────────────


@pytest.mark.parametrize("lang,text", [
    ("es", "¿Qué hay hoy en Music Week?"),
    ("en", "What's on tonight at Music Week?"),
    ("fr", "Qu'est-ce qu'il y a ce soir à la Music Week ?"),
    ("pt", "O que tem hoje na Music Week?"),
])
def test_v5a_day_question_lists_the_official_program_with_tba_fields(lang: str, text: str, monkeypatch) -> None:
    db = make_db()
    fake = FakeLLM()
    p = turn(db, text, fake, monkeypatch, forced_language=lang)
    assert fake.calls == [], "no LLM"
    msg = p["message"]
    assert msg.startswith(OFFICIAL[lang]), msg
    assert "Wellness" in msg and "Catamaran Sunset Party" in msg and "Bethel Bellini" in msg
    assert "Zamna" not in msg and "Main Event" not in msg, "only today's events"
    tba_time = {"es": "hora por confirmar", "en": "time to be confirmed", "fr": "heure à confirmer", "pt": "horário a confirmar"}[lang]
    boarding = {"es": "punto de embarque por confirmar", "en": "boarding point to be confirmed",
                "fr": "point d'embarquement à confirmer", "pt": "ponto de embarque a confirmar"}[lang]
    assert tba_time in msg and boarding in msg and PHONE in msg
    urls = [a["url"] for a in p["actions"] if a["type"] == "external_link"]
    assert any(u.startswith("https://www.amocartagena.co/music-week") for u in urls)
    assert any(u.startswith("https://wa.me/573116844492?text=") for u in urls)
    _assert_honest(p, _program(db), lang)


@pytest.mark.parametrize("lang,text", [
    ("es", "¿Cuál es el programa de Cartagena Music Week?"),
    ("en", "Tell me about Cartagena Music Week"),
    ("fr", "C'est quoi la Cartagena Music Week ?"),
    ("pt", "Como é a programação da Cartagena Music Week?"),
])
def test_v5a_program_question_lists_all_ten_events_over_eight_days(lang: str, text: str, monkeypatch) -> None:
    db = make_db()
    fake = FakeLLM()
    p = turn(db, text, fake, monkeypatch, forced_language=lang)
    assert fake.calls == []
    msg = p["message"]
    assert msg.startswith(OFFICIAL[lang])
    program = _program(db)
    for ev in program["events"]:
        assert ev["title"] in msg, ev["title"]
    assert msg.count("Very Special Guest") == 2 and msg.count("El Templo") == 2
    assert {"es": "Ocho días", "en": "Eight days", "fr": "Huit jours", "pt": "Oito dias"}[lang] in msg
    _assert_honest(p, program, lang)


# ── V5 (b): a TBA question, four languages ───────────────────────────────────


@pytest.mark.parametrize("lang,text", [
    ("es", "¿Quién toca en el Main Event?"),
    ("en", "Who is playing the Main Event?"),
    ("fr", "Qui joue au Main Event ?"),
    ("pt", "Quem toca no Main Event?"),
])
def test_v5b_artist_question_is_por_confirmar_plus_the_concierge(lang: str, text: str, monkeypatch) -> None:
    db = make_db()
    fake = FakeLLM()
    p = turn(db, text, fake, monkeypatch, forced_language=lang)
    assert fake.calls == []
    msg = p["message"]
    phrase = {"es": "El artista aún está por confirmar — el concierge te puede ayudar.",
              "en": "The artist is still to be confirmed — the concierge can help you.",
              "fr": "L'artiste est encore à confirmer — le concierge peut t'aider.",
              "pt": "O artista ainda está a confirmar — o concierge pode ajudar você."}[lang]
    assert phrase in msg and "Very Special Guest" in msg and PHONE in msg and "Valentina" in msg
    assert "Main Event" in msg and ("4" in msg and "6" in msg), "both Main Event days"
    urls = [a["url"] for a in p["actions"] if a["type"] == "external_link"]
    assert any(u.startswith("https://wa.me/573116844492?text=") for u in urls)
    _assert_honest(p, _program(db), lang)


@pytest.mark.parametrize("lang,text,field", [
    ("es", "¿A qué hora empieza Zamna?", "time"),
    ("en", "How much is Stardust by Saraga?", "price"),
    ("fr", "Où a lieu le Main Event ?", "venue"),
    ("pt", "De onde sai o Catamaran Sunset Party?", "boarding_point"),
])
def test_v5b_other_tba_fields(lang: str, text: str, field: str, monkeypatch) -> None:
    db = make_db()
    intent = LC.detect_cmw_intent(text, lang, IN_WINDOW)
    assert intent["is_cmw"] and intent["kind"] == "tba" and intent["field"] == field, intent
    p = turn(db, text, FakeLLM(), monkeypatch, forced_language=lang)
    key = {"time": "tba_time", "price": "tba_price", "venue": "tba_venue", "boarding_point": "tba_boarding_point"}[field]
    assert LC._T[lang][key] in p["message"]
    _assert_honest(p, _program(db), lang)


# ── V5 (c): during the week a GENERAL event question = program first, then the city ────────


@pytest.mark.parametrize("lang,text", [
    ("es", "¿Qué eventos hay hoy?"),
    ("en", "What's on tonight?"),
    ("fr", "Quels événements ce soir ?"),
    ("pt", "Que eventos tem hoje?"),
])
def test_v5c_general_event_question_during_the_week_is_program_then_city(lang: str, text: str, monkeypatch) -> None:
    assert not LC.detect_cmw_intent(text, lang, IN_WINDOW)["is_cmw"], "no CMW keyword"
    assert L.detect_event_intent(text, lang, now=IN_WINDOW)["is_event"]
    db = make_db()
    fake = FakeLLM()
    p = turn(db, text, fake, monkeypatch, forced_language=lang)
    assert fake.calls == [], "deterministic: no LLM"
    msg = p["message"]
    assert msg.startswith(OFFICIAL[lang]), msg
    i_cmw, i_city = msg.index("Wellness"), msg.index("Salsa en la Plaza")
    assert i_cmw < msg.index(LC._T[lang]["city_header"]) < i_city, "program FIRST, then the city agenda"
    assert "TuBoleta" in msg, "the city part keeps its source footer"
    assert "20:00" in msg[i_city:] and "20:00" not in msg[:i_city], "the only time is the city event's own"
    kinds = [r["kind"] for r in p["recommendations"]]
    assert kinds == ["event"] and p["recommendations"][0]["event_id"] == SALSA
    types = [a["type"] for a in p["actions"]]
    assert types[:2] == ["external_link", "external_link"] and "navigate" in types
    for a in p["actions"]:
        if a["type"] == "external_link":
            assert L.cmw_url_allowed(a["url"])
    assert p["language"] == lang
    for name in ARTIST_NAMES:
        assert name not in msg


def test_v5c_combined_answer_when_the_city_has_nothing_or_is_in_maintenance(monkeypatch) -> None:
    db = make_db(city_rows=False)
    p = turn(db, "¿Qué eventos hay hoy?", FakeLLM(), monkeypatch)
    assert p["message"].startswith(OFFICIAL["es"]) and "Wellness" in p["message"]
    assert "No tengo eventos confirmados para hoy" in p["message"] and p["recommendations"] == []
    db2 = make_db(enabled=False)
    R.invalidate_caches()          # the flags cache is process-wide, not per stub db
    p2 = turn(db2, "¿Qué eventos hay hoy?", FakeLLM(), monkeypatch)
    assert p2["message"].startswith(OFFICIAL["es"]) and L._T["es"]["maintenance"] in p2["message"]


def test_v5c_main_event_day_general_question_never_names_or_hints_an_artist(monkeypatch) -> None:
    db = make_db(MAIN_DAY)
    p = turn(db, "¿Quién toca hoy?", FakeLLM(), monkeypatch, now=MAIN_DAY)
    msg = p["message"]
    assert msg.startswith(OFFICIAL["es"]) and "Main Event" in msg and "Very Special Guest (artista por confirmar)" in msg
    assert "lugar por confirmar" in msg and "hora por confirmar" in msg
    for name in ARTIST_NAMES:
        assert name not in msg


def test_general_question_with_a_named_artist_or_outside_the_week_takes_the_normal_events_path(monkeypatch) -> None:
    db = make_db()
    fake = FakeLLM(_reply("No tengo eso confirmado."))
    p = turn(db, "¿Cuándo toca Karol G?", fake, monkeypatch)
    assert OFFICIAL["es"] not in p["message"], "a named artist is not a general question: no CMW block"
    db2 = make_db(BEFORE)
    p2 = turn(db2, "¿Qué eventos hay hoy?", FakeLLM(_reply("x")), monkeypatch, now=BEFORE)
    assert OFFICIAL["es"] not in p2["message"] and "Music Week" not in p2["message"]
    # during the week, a date outside the program (tomorrow after the last day) = the normal path
    db3 = make_db(datetime(2027, 1, 7, 20, 0, tzinfo=UTC))
    p3 = turn(db3, "¿Qué eventos hay mañana?", FakeLLM(_reply("x")), monkeypatch, now=datetime(2027, 1, 7, 20, 0, tzinfo=UTC))
    assert OFFICIAL["es"] not in p3["message"]


# ── before the window ────────────────────────────────────────────────────────


@pytest.mark.parametrize("lang,text", [
    ("es", "¿Qué hay hoy en Music Week?"),
    ("en", "What's on tonight at Music Week?"),
    ("fr", "Il y a quoi ce soir à la Music Week ?"),
    ("pt", "O que tem hoje na Music Week?"),
])
def test_before_the_window_today_answers_the_dates_honestly_plus_the_program(lang: str, text: str, monkeypatch) -> None:
    db = make_db(BEFORE)
    p = turn(db, text, FakeLLM(), monkeypatch, now=BEFORE, forced_language=lang)
    msg = p["message"]
    lead = {"es": "Cartagena Music Week todavía no empieza: va del 31 dic 2026 al 7 ene 2027.",
            "en": "Cartagena Music Week hasn't started yet: it runs Dec 31, 2026 – Jan 7, 2027.",
            "fr": "Cartagena Music Week n'a pas encore commencé : du 31 déc. 2026 au 7 janv. 2027.",
            "pt": "A Cartagena Music Week ainda não começou: vai de 31 dez 2026 a 7 jan 2027."}[lang]
    assert msg.startswith(lead), msg
    assert "Zamna on the Beach" in msg and "After Temple" in msg and msg.count("Very Special Guest") == 2
    assert "hoy," not in msg and "today," not in msg, "no relative day labels before the week"
    _assert_honest(p, _program(db), lang)


def test_before_the_window_an_explicit_program_date_lists_that_day(monkeypatch) -> None:
    db = make_db(BEFORE)
    p = turn(db, "¿Qué hay en Music Week el 3 de enero?", FakeLLM(), monkeypatch, now=BEFORE)
    assert p["message"].startswith("Programa oficial Cartagena Music Week · 3 ene:")
    assert "Stardust by Saraga" in p["message"] and "El Lago" in p["message"] and "Wellness" not in p["message"]
    p2 = turn(db, "music week el 15 de enero", FakeLLM(), monkeypatch, now=BEFORE)
    assert p2["message"].startswith("Ese día no está en el programa")


def test_after_the_window_every_cmw_question_says_it_is_over_without_a_booking_cta(monkeypatch) -> None:
    db = make_db(AFTER)
    for text in ("¿Qué hay hoy en Music Week?", "Quiero entradas para el Main Event", "¿Quién toca en Zamna?"):
        p = turn(db, text, FakeLLM(), monkeypatch, now=AFTER)
        assert p["message"] == "Cartagena Music Week fue del 31 dic 2026 al 7 ene 2027 y ya terminó."
        assert [a["type"] for a in p["actions"]] == ["external_link"] and "wa.me" not in json.dumps(p["actions"])


# ── booking + directions (concierge-led, catalog venues) ─────────────────────


@pytest.mark.parametrize("lang,text", [
    ("es", "Quiero reservar mesa para Zamna on the Beach"),
    ("en", "How do I get tickets for Music Week?"),
    ("fr", "Je veux réserver pour le Main Event"),
    ("pt", "Quero ingressos para o After Temple"),
])
def test_booking_routes_to_the_concierge_flow_never_a_checkout(lang: str, text: str, monkeypatch) -> None:
    db = make_db()
    intent = LC.detect_cmw_intent(text, lang, IN_WINDOW)
    assert intent["kind"] == "booking"
    p = turn(db, text, FakeLLM(), monkeypatch, forced_language=lang)
    urls = [a["url"] for a in p["actions"] if a["type"] == "external_link"]
    assert any(u.startswith("https://wa.me/573116844492?text=") for u in urls)
    assert any(u.startswith("https://www.amocartagena.co/music-week") for u in urls)
    low = p["message"].lower()
    for banned in ("checkout", "pago", "payment", "paiement", "pagamento", "confirmado", "confirmed", "reservado", "booked"):
        assert banned not in low, banned
    assert "concierge" in low
    _assert_honest(p, _program(db), lang)


def test_directions_give_a_venue_card_for_a_catalog_venue_and_a_city_link(monkeypatch) -> None:
    db = make_db()
    p = turn(db, "¿Cómo llego a Zamna?", FakeLLM(), monkeypatch)
    assert "Bethel Bellini" in p["message"] and "El concierge coordina los traslados." in p["message"]
    assert p["recommendations"] == [{"kind": "partner", "partner_id": "ptr_dv_003", "name": "Bethel Bellini Beach Club",
                                     "type": "", "vibe": "Programa oficial Cartagena Music Week", "price_range": "",
                                     "address": "Tierra Bomba", "reason": "Zamna on the Beach · 31 dic"}]
    types = {a["type"]: a for a in p["actions"]}
    assert types["open_partner"]["partner_id"] == "ptr_dv_003" and types["navigate"]["screen"] == "ciudad"
    assert "Isla Tierra Bomba" not in json.dumps(p) and "Muelle" not in json.dumps(p), "never the catalog address"
    # a venue the deck only names (El Lago) has no card and no address; a TBA venue says so
    p2 = turn(db, "¿Dónde queda Stardust by Saraga?", FakeLLM(), monkeypatch)
    assert "El Lago" in p2["message"] and "La dirección está por confirmar" in p2["message"] and p2["recommendations"] == []
    p3 = turn(db, "¿Dónde es el After New Year?", FakeLLM(), monkeypatch)
    assert "El lugar aún está por confirmar" in p3["message"] and p3["recommendations"] == []
    _assert_honest(p, _program(db), "es")


# ── the question bank (≥ 30) ─────────────────────────────────────────────────

BANK = [
    # CMW: (text, lang, kind)
    ("¿Qué hay hoy en Music Week?", "es", "day"),
    ("What's on at Music Week tomorrow?", "en", "day"),
    ("Programme de la Music Week le 5 janvier", "fr", "day"),
    ("Music Week no sábado", "pt", "day"),
    ("cmw hoy", "es", "day"),
    ("programa cartagena music week", "es", "program"),
    ("When is Cartagena Music Week?", "en", "program"),
    ("Zamna on the Beach", "es", "event"),
    ("we are us casa boheme", "es", "event"),
    ("after new year", "en", "event"),
    ("stardust by saraga", "es", "event"),
    ("after temple", "en", "event"),
    ("main event after", "es", "event"),
    ("catamaran sunset party", "en", "event"),
    ("¿Quién es el Very Special Guest?", "es", "tba"),
    ("who's playing at zamna?", "en", "tba"),
    ("¿A qué hora es el Main Event?", "es", "tba"),
    ("combien coûte la Music Week ?", "fr", "tba"),
    ("quanto custa o Main Event?", "pt", "tba"),
    ("¿Dónde es el Main Event?", "es", "tba"),
    ("quiero reservar para music week", "es", "booking"),
    ("book a table for Stardust by Saraga", "en", "booking"),
    ("acceso VIP al main event", "es", "booking"),
    ("¿Cómo llego a Zamna?", "es", "directions"),
    ("how do I get to the After Temple?", "en", "directions"),
    ("traslados para music week", "es", "directions"),
    # NOT CMW: venue-only, generic, other
    ("¿A qué hora abre Bellini?", "es", None),
    ("Mesa en Casa Bohème esta noche", "es", None),
    ("Is Bethel Bellini open on Sundays?", "en", None),
    ("Casa Bohème brunch", "fr", None),
    ("¿Dónde cenar hoy?", "es", None),
    ("What's on tonight?", "en", None),
    ("conciertos este fin de semana", "es", None),
    ("clase de yoga en Bocagrande", "es", None),
    ("catamarán a las islas del Rosario", "es", None),
    ("¿Cuándo viene Karol G?", "es", None),
    ("special guest de mi hotel", "es", None),
    ("la semana que viene hay música en vivo?", "es", None),
]


def test_question_bank_is_large_and_classified() -> None:
    assert len(BANK) >= 30
    for text, lang, kind in BANK:
        intent = LC.detect_cmw_intent(text, lang, IN_WINDOW)
        assert intent["is_cmw"] is (kind is not None), (text, intent)
        if kind is not None:
            assert intent["kind"] == kind, (text, intent)
            assert intent["kind"] in LC.KINDS


def test_venue_only_questions_are_never_cmw_even_during_the_week(monkeypatch) -> None:
    db = make_db()
    for text in ("¿A qué hora abre Bellini?", "Mesa en Casa Bohème esta noche", "Bethel Bellini Beach Club",
                 "Casa Bohême brunch", "El Templo Cartagena", "el lago"):
        assert not LC.detect_cmw_intent(text, "es", IN_WINDOW)["is_cmw"], text
    fake = FakeLLM(_reply("Bellini abre desde las 10 a. m."))
    p = turn(db, "¿A qué hora abre Bellini?", fake, monkeypatch)
    assert len(fake.calls) == 1 and OFFICIAL["es"] not in p["message"], "a normal venue question"


def test_every_bank_answer_is_deterministic_and_honest(monkeypatch) -> None:
    db = make_db()
    program = _program(db)
    for text, lang, kind in BANK:
        if kind is None:
            continue
        p = turn(db, text, FakeLLM(), monkeypatch, forced_language=lang)
        _assert_honest(p, program, lang)
        assert p["message"].strip() and PHONE in p["message"]
        # a Main Event line always carries the placeholder, never a name ("Main Event After" is another row)
        if re.search(r"Main Event(?! After)", p["message"]) and kind in ("event", "program", "day"):
            assert "Very Special Guest" in p["message"], text


def test_no_llm_call_and_no_city_events_read_on_a_pure_cmw_turn(monkeypatch) -> None:
    db = make_db()
    fake = FakeLLM()
    turn(db, "¿Qué hay en Music Week el 4 de enero?", fake, monkeypatch)
    assert fake.calls == []
    assert not db.touched("city_events") and not db.touched("events") and not db.touched("concerts")
    assert db.touched("partners") and db.touched("cmw_overrides")


def test_answer_language_is_the_app_language_or_the_question_language(monkeypatch) -> None:
    db = make_db()
    assert turn(db, "Zamna on the Beach", FakeLLM(), monkeypatch)["language"] == "es", "a printed title is not English"
    assert turn(db, "What time does the Main Event start?", FakeLLM(), monkeypatch)["language"] == "en"
    assert turn(db, "Où est le Main Event ?", FakeLLM(), monkeypatch)["language"] == "fr"
    assert turn(db, "Quem toca no Main Event hoje?", FakeLLM(), monkeypatch)["language"] == "pt"
    assert turn(db, "What time does the Main Event start?", FakeLLM(), monkeypatch, forced_language="es")["language"] == "es"


def test_follow_up_after_a_cmw_turn_stays_deterministic_but_a_new_topic_does_not(monkeypatch) -> None:
    db = make_db()
    ts = (IN_WINDOW - timedelta(minutes=3)).isoformat()
    history = [{"role": "user", "content": "¿Qué hay en Music Week el 3 de enero?", "created_at": ts},
               {"role": "assistant", "content": "Programa oficial…", "created_at": ts}]
    fake = FakeLLM()
    p = turn(db, "¿y a qué hora empieza?", fake, monkeypatch, history=history)
    assert fake.calls == [] and "Stardust by Saraga" in p["message"] and "hora aún está por confirmar" in p["message"]
    fake2 = FakeLLM(_reply("Un taxi al aeropuerto cuesta unos 30 mil pesos."))
    p2 = turn(db, "¿cuánto cuesta un taxi al aeropuerto?", fake2, monkeypatch, history=history)
    assert len(fake2.calls) == 1 and "taxi" in p2["message"]
    old = [{"role": "user", "content": "¿Qué hay en Music Week hoy?", "created_at": (IN_WINDOW - timedelta(days=2)).isoformat()}]
    fake3 = FakeLLM(_reply("¿A qué hora empieza qué? Cuéntame más."))
    turn(db, "¿y a qué hora empieza?", fake3, monkeypatch, history=old)
    assert len(fake3.calls) == 1, "a day-old CMW turn is not a follow-up context"


# ── program truth: an admin override is what Luna states ─────────────────────


def test_luna_states_a_confirmed_override_and_nothing_more(monkeypatch) -> None:
    db = make_db()
    asyncio.run(db.cmw_overrides.insert_one({"event_id": "cmw-zamna-on-the-beach", "fields": {"time": "21:00"},
                                             "source_note": "Organiser, 2026-12-10"}))
    p = turn(db, "¿A qué hora es Zamna?", FakeLLM(), monkeypatch)
    assert "Zamna on the Beach (31 dic): 21:00." in p["message"]
    p2 = turn(db, "¿A qué hora es el Main Event?", FakeLLM(), monkeypatch)
    assert "21:00" not in p2["message"] and "La hora aún está por confirmar" in p2["message"]
    program = _program(db)
    assert LC.find_cmw_violations(p["message"], program, "es") == []


# ── the sanitizer allowlist (§5) ─────────────────────────────────────────────


def test_sanitizer_allowlist_is_exactly_the_two_cmw_prefixes() -> None:
    assert L.CMW_URL_PREFIXES == (cmw.WA_BASE, cmw.HUB_URL) == ("https://wa.me/573116844492", "https://www.amocartagena.co/music-week")
    ok = ["https://wa.me/573116844492", "https://wa.me/573116844492?text=Hola",
          "https://www.amocartagena.co/music-week", "https://www.amocartagena.co/music-week/cmw-zamna-on-the-beach",
          "https://www.amocartagena.co/music-week?utm=luna", "https://www.amocartagena.co/music-week#programa"]
    bad = ["https://wa.me/573116844493", "https://wa.me/5731168444920", "https://wa.me/573116844492/../3001234567",
           "https://wa.me/573116844492/x", "http://wa.me/573116844492", "https://www.amocartagena.co/music-weekend",
           "https://www.amocartagena.co/music-week/../admin", "https://amocartagena.co/music-week",
           "https://www.amocartagena.co/music-week\\evil", "https://www.amocartagena.co/music-week ?x", "", None, 42,
           "https://evil.example/https://wa.me/573116844492"]
    for u in ok:
        assert L.cmw_url_allowed(u), u
    for u in bad:
        assert not L.cmw_url_allowed(u), u
    recs, actions = L.sanitize([], [
        {"type": "external_link", "url": "https://www.amocartagena.co/music-week", "label": "Programa"},
        {"type": "external_link", "url": "https://wa.me/573116844492?text=Hola", "label": "WhatsApp"},
        {"type": "external_link", "url": "https://wa.me/573001112233", "label": "otro"},
        {"type": "external_link", "url": "https://tickets.example/checkout", "label": "Comprar"},
    ], [], lang="es")
    assert [a["url"] for a in actions] == ["https://www.amocartagena.co/music-week", "https://wa.me/573116844492?text=Hola"]


# ── the hook placement (§5) ──────────────────────────────────────────────────


def test_hook_sits_at_the_top_of_run_agent_turn_before_the_events_gate() -> None:
    with open(os.path.join(BACKEND, "ai_agent.py"), encoding="utf-8") as f:
        src = f.read()
    start = src.index("async def run_agent_turn(")
    body = src[start:]
    i_cmw = body.index("_luna_cmw.gate(")
    i_events = body.index("_luna_events.detect_event_intent(user_text, decl_lang")
    i_llm = body.index("await llm_complete(")
    assert i_cmw < i_events < i_llm
    assert body.index("_luna_cmw.guard_turn(") > i_llm


# ── the guard (§5) ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("lang,reply", [
    ("es", "Cena en Celele. El Very Special Guest del Main Event es Bad Bunny."),
    ("en", "Try Celele. The Main Event headliner is David Guetta, by the way."),
    ("fr", "Dîne au Celele. Le Main Event de la Music Week, c'est avec Solomun."),
    ("pt", "Jante no Celele. O Main Event da Music Week é com Carlos Vives."),
])
def test_guard_replaces_an_llm_reply_that_names_an_artist_for_the_main_event(lang: str, reply: str, monkeypatch) -> None:
    db = make_db()
    fake = FakeLLM(_reply(reply, language=lang, suggestions=["Ver el Main Event con Bad Bunny", "¿Dónde desayunar?"]))
    p = turn(db, "¿Dónde cenar hoy?", fake, monkeypatch, forced_language=lang)
    assert len(fake.calls) == 1, "a normal turn: the LLM answered"
    msg = p["message"]
    for name in ARTIST_NAMES:
        assert name not in msg
    assert msg.startswith(OFFICIAL[lang]) and "Very Special Guest" in msg, msg
    assert "Bad Bunny" not in json.dumps(p) and "¿Dónde desayunar?" not in p["suggestions"]


def test_guard_catches_a_time_or_a_price_next_to_a_cmw_term_but_not_honest_prose(monkeypatch) -> None:
    db = make_db()
    program = _program(db)
    bad = [
        "Zamna on the Beach empieza a las 10 pm en Bellini.",
        "Stardust by Saraga cuesta $150 USD la entrada.",
        "El Main Event es gratis con la pulsera VIP.",
        "Music Week runs Dec 30 – Jan 10 this year.",
        "We Are Us trae a Tiësto y a Karol G.",
        "Main Event: Shakira en vivo.",
        "Saraga presenta a Solomun el 3 de enero.",
    ]
    for text in bad:
        assert LC.find_cmw_violations(text, program, "es"), text
    honest = [
        "Cartagena Music Week va del 31 dic al 7 ene; el programa oficial está en la app.",
        "El Main Event tiene un Very Special Guest por confirmar.",
        "Celele abre a las 12:00 y cierra a las 22:00. Getsemaní está a 10 minutos.",
        "Zamna on the Beach es en Bethel Bellini el 31 de diciembre.",
        "Puedes escribir al concierge de Music Week al +57 311 6844492 (asistencia 24/7).",
        "La chef Leonor Espinosa cocina en Celele esta noche.",
    ]
    for text in honest:
        assert LC.find_cmw_violations(text, program, "es") == [], text
    # the prose the guard writes itself never trips the guard
    for lang in LANGS:
        for kind in ("program", "booking", "directions"):
            payload = LC.answer(program, {"kind": kind, "event_ids": [], "dates": []}, lang, IN_WINDOW)
            assert LC.find_cmw_violations(payload["message"], program, lang) == [], (lang, kind)


def test_guard_leaves_non_cmw_replies_alone_and_scrubs_side_channels(monkeypatch) -> None:
    db = make_db()
    program = _program(db)
    payload = {"message": "Celele es un restaurante en Getsemaní.", "language": "es",
               "recommendations": [{"kind": "partner", "partner_id": "ptr_celele", "name": "Celele", "type": "", "vibe": "",
                                    "price_range": "", "address": "", "reason": "Cena con Bad Bunny después del Main Event"}],
               "actions": [{"type": "external_link", "url": cmw.HUB_URL, "label": "Main Event con Bad Bunny"}],
               "suggestions": ["¿Qué hay en Music Week?"]}
    out = asyncio.run(LC.guard_turn(db, payload, lang="es", now=IN_WINDOW))
    assert out["message"] == payload["message"], "no violation in the message: untouched"
    assert out["recommendations"][0]["reason"] == "" and out["recommendations"][0]["name"] == "Celele"
    assert out["actions"][0]["label"] == "Ver programa oficial" and out["suggestions"] == ["¿Qué hay en Music Week?"]
    assert not db.touched("city_events")
    plain = {"message": "Celele.", "language": "es", "recommendations": [], "actions": [], "suggestions": ["Más"]}
    assert asyncio.run(LC.guard_turn(db, plain, lang="es", now=IN_WINDOW)) == plain
    assert LC.find_cmw_violations("", program) == [] and not LC.mentions_cmw(None)


def test_guard_fails_closed_when_the_program_cannot_be_read(monkeypatch) -> None:
    db = make_db()

    async def broken(*_a: Any, **_k: Any) -> Any:
        raise RuntimeError("no program")

    monkeypatch.setattr(cmw, "merged_program", broken)
    monkeypatch.setattr(cmw, "load_program", lambda: (_ for _ in ()).throw(cmw.ProgramError("x")))
    payload = {"message": "El Main Event es con Shakira.", "language": "es", "recommendations": [], "actions": [],
               "suggestions": []}
    out = asyncio.run(LC.guard_turn(db, payload, lang="es", now=IN_WINDOW))
    assert "Shakira" not in out["message"] and PHONE in out["message"]


# ── QA fixes (2026-09-29): follow-ups, /search order, guard breadth, false positives ────────


FOLLOWUPS_AFTER_A_CMW_TURN = [
    ("¿y cuánto vale la entrada?", "Las entradas suelen costar entre 200.000 y 400.000 pesos; te recomiendo comprarlas pronto."),
    ("¿y la boleta cuánto es?", "La boleta general está alrededor de 250 mil pesos."),
    ("¿y a qué hora abre?", "Abre a las 9 de la noche y cierra a las 4 de la mañana."),
    ("¿y hay mesas VIP?", "Sí, hay mesas VIP desde 2 millones de pesos, escríbeles para reservar."),
    ("e o ingresso?", "O ingresso custa cerca de 300 mil pesos."),
    ("and the headliner?", "The headliner is David Guetta, it was announced last week."),
    ("y quién es el invitado?", "El invitado especial es Shakira."),
]


@pytest.mark.parametrize("text,reply", FOLLOWUPS_AFTER_A_CMW_TURN)
def test_natural_follow_ups_after_a_cmw_turn_never_pass_an_llm_answer_through(text: str, reply: str, monkeypatch) -> None:
    db = make_db()
    ts = (IN_WINDOW - timedelta(minutes=3)).isoformat()
    history = [{"role": "user", "content": "¿Qué hay en Music Week el 4 de enero?", "created_at": ts},
               {"role": "assistant", "content": "Programa oficial Cartagena Music Week · 4 ene:\n• Main Event — lugar por "
                                                "confirmar · hora por confirmar · Very Special Guest (artista por confirmar)",
                "created_at": ts}]
    fake = FakeLLM(_reply(reply))
    p = turn(db, text, fake, monkeypatch, history=history, forced_language="es")
    assert fake.calls == [], "a bare follow-up on the Main Event is answered from the program, never the LLM"
    assert "Main Event" in p["message"] and "por confirmar" in p["message"]
    for banned in ("Shakira", "Guetta", "200.000", "250 mil", "300 mil", "2 millones", "9 de la noche", "4 de la mañana"):
        assert banned not in p["message"], banned


def test_cmw_context_guard_replaces_an_llm_follow_up_that_states_a_fact_but_leaves_other_topics(monkeypatch) -> None:
    db = make_db()
    ts = (IN_WINDOW - timedelta(minutes=3)).isoformat()
    history = [{"role": "user", "content": "¿Qué hay en Music Week el 4 de enero?", "created_at": ts},
               {"role": "assistant", "content": "Programa oficial…", "created_at": ts}]
    # a follow-up the bare detector does not classify still cannot carry an invented fact
    assert LC.in_cmw_context(history, "¿y el invitado sorpresa quién es?", "es", IN_WINDOW)
    fake = FakeLLM(_reply("El invitado sorpresa es Shakira, llega a las 22:00."))
    p = turn(db, "¿y el invitado sorpresa quién es?", fake, monkeypatch, history=history, forced_language="es")
    assert "Shakira" not in p["message"] and "22:00" not in p["message"] and OFFICIAL["es"] in p["message"]
    # a new topic in the same conversation keeps its LLM answer (times and all)
    assert not LC.in_cmw_context(history, "¿dónde queda Alquímico y a qué hora abre?", "es", IN_WINDOW)
    assert not LC.in_cmw_context(history, "¿dónde ceno esta noche?", "es", IN_WINDOW)
    fake2 = FakeLLM(_reply("Alquímico queda en la Calle del Arsenal y abre a las 17:00."))
    p2 = turn(db, "¿dónde queda Alquímico y a qué hora abre?", fake2, monkeypatch, history=history, forced_language="es")
    assert len(fake2.calls) == 1 and "17:00" in p2["message"]
    assert not LC.in_cmw_context([], "¿y a qué hora abre?", "es", IN_WINDOW)


def test_search_slice_answers_a_cmw_question_with_the_program_before_the_events_gate() -> None:
    from events_service_stubs import server_span
    src = server_span("    # ── CMW (docs/cmw/DESIGN.md §5): a Music Week question", "    # ── FULL CONCIERGE AGENT ──")
    assert "_luna_cmw.gate(" in src and src.index("_luna_cmw.gate(") < src.index("detect_event_intent(q, user_lang)")
    fn_src = ("async def search_slice(db, q, user_lang, matches, search_id, partners, user_id, _luna_events, _luna_cmw, "
              "logger, _track_impressions):\n" + src + "\n    return None\n")
    ns: Dict[str, Any] = {}
    exec(compile(fn_src, "server.py[search-cmw-gate]", "exec"), ns)
    seen: List[Dict[str, Any]] = []

    async def _track_impressions(_partners: Any, _uid: Any, extra: Any = None) -> None:
        seen.append(dict(extra or {}))

    db = make_db()
    import logging
    for q in ("¿Qué hay hoy en Music Week?", "¿Quién toca en el Main Event?", "eventos music week 4 de enero"):
        res = asyncio.run(ns["search_slice"](db, q, "es", {"partners": [], "events": []}, "s1", [], "u1", L, LC,
                                             logging.getLogger("test"), _track_impressions))
        assert res is not None and "Music Week" in res["ai"]["answer"], q
        assert res["ai"]["intent"] == "event" and res["ai"]["highlights"] == []
        for name in ARTIST_NAMES:
            assert name not in res["ai"]["answer"]
    assert all(x.get("ai_intent") == "cmw" and x.get("ai_used") is False for x in seen)
    res = asyncio.run(ns["search_slice"](db, "¿dónde ceno hoy?", "es", {"partners": [], "events": []}, "s1", [], "u1", L, LC,
                                         logging.getLogger("test"), _track_impressions))
    assert res is None, "a non-event, non-CMW question falls through to the concierge agent"


@pytest.mark.parametrize("text,lang", [
    ("Where can I have brunch after New Year's Day?", "en"),
    ("restaurantes abiertos after new year", "es"),
    ("what's the main event at the Hay Festival?", "en"),
    ("catamaran sunset tour to Rosario islands price?", "en"),
    ("catamaran sunset cruise tomorrow", "en"),
    ("who won the main event at the boxing?", "en"),
])
def test_ordinary_phrases_that_happen_to_be_printed_titles_are_not_cmw(text: str, lang: str) -> None:
    assert not LC.detect_cmw_intent(text, lang, IN_WINDOW)["is_cmw"], text


@pytest.mark.parametrize("text,lang,kind", [
    ("Where is the Main Event?", "en", "tba"),
    ("¿Hay after del main event el 5?", "es", "event"),
    ("acceso VIP al main event", "es", "booking"),
    ("MAIN EVENT", "es", "event"),
    ("catamaran sunset party", "en", "event"),
    ("after temple", "en", "event"),
])
def test_printed_titles_used_as_titles_stay_cmw(text: str, lang: str, kind: str) -> None:
    intent = LC.detect_cmw_intent(text, lang, IN_WINDOW)
    assert intent["is_cmw"] and intent["kind"] == kind, (text, intent)


def test_guard_catches_invented_venues_sales_addresses_and_lowercase_claims(monkeypatch) -> None:
    db = make_db()
    program = _program(db)
    bad = [
        "El Main Event será en la Plaza de la Aduana.",
        "El Catamaran Sunset Party sale del Muelle de la Bodeguita.",
        "Las entradas de Music Week ya están en venta en la app, ¡compra ya!",
        "Music Week Main Event: sold out.",
        "El Templo (Music Week) queda en la Calle 38 #9-20.",
        "Main Event de Music Week: solo mayores de 21, dress code blanco.",
        "Zamna on the Beach: aforo 3000 personas.",
        "el very special guest del main event es bad bunny",
        "Music Week trae al dj solomun",
        "Zamna on the Beach cuesta doscientos mil pesos la entrada",
        "Mesas VIP en el Main Event desde 2 millones de pesos.",
    ]
    for text in bad:
        assert LC.find_cmw_violations(text, program, "es"), text
    honest = [
        "Zamna on the Beach es en Bethel Bellini; Wellness también es en Bethel Bellini.",
        "Main Event After y After Temple son en El Templo; Stardust by Saraga es en El Lago.",
        "El Main Event tiene un Very Special Guest por confirmar; el artista aún está por confirmar.",
        "Cartagena Music Week: Música · Cultura · Bienestar · Gastronomía · Mar · Personas.",
    ]
    for text in honest:
        assert LC.find_cmw_violations(text, program, "es") == [], text
    # the deterministic answers never trip the widened guard, in any language
    for lang in LANGS:
        for kind, field in (("program", None), ("booking", None), ("directions", None), ("tba", "artist"),
                            ("tba", "price"), ("tba", "venue"), ("tba", "boarding_point")):
            payload = LC.answer(program, {"kind": kind, "event_ids": [], "dates": [], "field": field}, lang, IN_WINDOW)
            assert LC.find_cmw_violations(payload["message"], program, lang) == [], (lang, kind, field)
    # context: no CMW term at all, yet a time / a name is a violation
    assert LC.find_cmw_violations("Abre a las 9 de la noche y cierra a las 4.", program, "es", context=True)
    assert LC.find_cmw_violations("El invitado especial es Shakira.", program, "es", context=True)
    assert LC.find_cmw_violations("Abre a las 9 de la noche.", program, "es") == []


def test_guard_always_words_hub_and_concierge_links_itself_and_drops_purchase_chips(monkeypatch) -> None:
    db = make_db()
    payload = {"message": "Cena en Celele, es un clásico.", "language": "es", "recommendations": [],
               "actions": [{"type": "external_link", "url": cmw.HUB_URL, "label": "Comprar entradas Music Week"},
                           {"type": "external_link", "url": f"{cmw.WA_BASE}?text=hola", "label": "Ver"}],
               "suggestions": ["Comprar entradas Main Event", "Main Event sold out?", "¿Dónde desayunar?"]}
    out = asyncio.run(LC.guard_turn(db, payload, lang="es", now=IN_WINDOW))
    assert out["message"] == payload["message"]
    assert [a["label"] for a in out["actions"]] == ["Ver programa oficial", "Escribir al concierge"]
    assert out["suggestions"] == ["¿Dónde desayunar?"]


def test_directions_answer_lists_a_shared_catalog_venue_once(monkeypatch) -> None:
    db = make_db()
    p = turn(db, "How do I get to Bellini for Music Week?", FakeLLM(), monkeypatch, forced_language="en")
    ids = [r.get("partner_id") for r in p["recommendations"]]
    assert ids == ["ptr_dv_003"], ids


def test_a_city_row_naming_music_week_never_reaches_the_public_feed_or_luna(monkeypatch) -> None:
    db = make_db()
    fake_row = _row(IN_WINDOW)
    fake_row.update({"event_id": "ce-main-event-20270102-b2b2", "canonical_key": "main event|2027|x",
                     "title": {"es": "Cartagena Music Week Main Event"}, "venue_name": "El Templo", "start_time": "22:00",
                     "price": {"is_free": False, "min_cop": 400000, "max_cop": None, "text": None},
                     "source_keys": ["t:main"], "description": {"es": "Very Special Guest: David Guetta"}})
    asyncio.run(db.city_events.insert_one(fake_row))
    rows = asyncio.run(R.public_rows(db, statuses=("published",), min_confidence="VERIFY", now=IN_WINDOW))
    assert [r["event_id"] for r in rows] == [SALSA]
    assert asyncio.run(R.public_item(db, "ce-main-event-20270102-b2b2", now=IN_WINDOW)) is None
    assert asyncio.run(R.public_item(db, SALSA, now=IN_WINDOW)) is not None
    p = turn(db, "¿Qué eventos hay hoy?", FakeLLM(), monkeypatch)
    assert "El Templo" not in p["message"] and "22:00" not in p["message"] and "Salsa en la Plaza" in p["message"]
    import events_gate as G
    assert G.cmw_conflict({"title": {"es": "Fiesta de fin de año"}, "description": {"es": "Music Week vibes"}})
    assert G.cmw_conflict({"title": "Main Event", "description": {"es": "boxeo"}})
    assert not G.cmw_conflict({"title": {"es": "Salsa en la Plaza"}, "description": {"es": "reabre after New Year"}})
