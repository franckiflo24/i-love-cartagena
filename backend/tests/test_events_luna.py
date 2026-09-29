"""EVENTS-ELITE Luna gate (DESIGN.md §9, §13 I, §15 V): Luna never invents an event.

Pure: stub Mongo collections, a monkeypatched llm.llm_complete, real events_gate /
events_runtime read path. No network, no Atlas, never imports server.py.

Run: cd backend && python -m pytest -q tests/test_events_luna.py
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

import ai_agent as A  # noqa: E402
import events_gate as G  # noqa: E402
import events_runtime as R  # noqa: E402
import llm as LLM  # noqa: E402
import luna_events as L  # noqa: E402

UTC = timezone.utc
NOW = datetime(2026, 9, 28, 17, 0, tzinfo=UTC)  # Monday 28 Sep 2026, 12:00 Bogotá (pre-cutover day)
LV = (NOW - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")  # "verificado 28 sep"

IPCC = "https://ipcc.gov.co/agenda-festiva-fiestas-de-independencia-2026"
IPCC_NAME = "IPCC · Alcaldía de Cartagena (agenda oficial)"
EU = "https://www.eluniversal.com.co/cultural/juan-luis-guerra-festival-nautico-2026"
HAY = "https://www.hayfestival.com/cartagena/inicio"
IRON = "https://www.ironman.com/im703-cartagena"
USER_LOC = {"lat": 10.4231, "lng": -75.5502}  # a few metres from Plaza de la Aduana


# ── fixtures: real city_events docs that pass the real gate ──────────────────


def _evd(url: str, date_text: str, tier: int) -> Dict[str, Any]:
    return {"url": url, "name": "src", "tier": tier, "fetched_at": LV, "http_status": 200,
            "date_text": date_text, "date_visible": True}


def _row(event_id: str, title: str, start: str, end: Optional[str] = None, *, category: str = "cultural",
         venue: str = "Centro Histórico", date_text: str, source_url: str = IPCC, source_name: str = IPCC_NAME,
         tier: int = 1, lat: Optional[float] = None, lng: Optional[float] = None, **over: Any) -> Dict[str, Any]:
    d: Dict[str, Any] = {
        "event_id": event_id,
        "title": {"es": title},
        "description": {"es": "Descripción interna: NO debe llegar al LLM. 25 de diciembre."},
        "category": category,
        "edition_year": int(start[:4]),
        "start_date": start, "end_date": end or start,
        "start_time": None, "end_time": None, "time_confirmed": False,
        "venue_name": venue, "address": None, "zone": "centro",
        "lat": lat, "lng": lng, "geocode_source": "gazetteer" if lat is not None else None,
        "price": {"is_free": None, "min_cop": None, "max_cop": None, "text": None},
        "ticket_url": None, "source_url": source_url, "source_name": source_name, "source_tier": tier,
        "second_source_name": None,
        "evidence": [_evd(source_url, date_text, tier)],
        "last_verified": LV, "verified_by": "pipeline",
        "country_check": "pass", "country_signals": ["pass:test"],
        "status": "published", "status_reason": None, "confidence": "HIGH",
        "origin": "anchor", "sold_out": False, "parent_id": None, "is_umbrella": False,
        "image_url": None, "image_credit": None,
    }
    d.update(over)
    return d


BANDO = "ce-gran-desfile-de-independencia-20261112-a1b2"
JLG = "ce-juan-luis-guerra-festival-nautico-20261113-c3d4"
SALSA = "ce-salsa-a-la-plaza-20261114-e5f6"
BOCACHICA = "ce-cabildo-vivo-de-bocachica-20261106-a7b8"
IRONMAN = "ce-ironman-70-3-cartagena-20261129-b9c0"
HAYF = "ce-hay-festival-cartagena-de-indias-20270128-d1e2"
FIESTAS = "ce-fiestas-de-independencia-2026-20261002-f3a4"
PRELUDIO = "ce-preludio-localidad-1-canapote-20261002-a5a5"
HIDDEN = "ce-concierto-cancelado-20261003-dead"
PAST = "ce-evento-pasado-20260901-beef"


def _docs() -> List[Dict[str, Any]]:
    return [
        _row(BANDO, "Gran Desfile de Independencia (Bando)", "2026-11-12", venue="Avenida Santander",
             date_text="12 de noviembre de 2026"),
        _row(JLG, "Juan Luis Guerra (Festival Náutico)", "2026-11-13", category="concert",
             venue="Festival Náutico de la Independencia (escenario por confirmar)",
             date_text="13 de noviembre de 2026", source_url=EU, source_name="El Universal", tier=5),
        _row(SALSA, "Salsa a la Plaza", "2026-11-14", category="concert", venue="Plaza de la Aduana",
             date_text="14 de noviembre de 2026", lat=10.4225, lng=-75.5497),
        _row(BOCACHICA, "Cabildo Vivo de Bocachica", "2026-11-06", venue="Bocachica",
             date_text="6 de noviembre de 2026", lat=10.3208, lng=-75.5836),
        _row(IRONMAN, "IRONMAN 70.3 Cartagena", "2026-11-29", category="sports",
             venue="Recorrido: bahía de las Ánimas, costa y Centro Histórico", date_text="29 de noviembre de 2026",
             source_url=IRON, source_name="IRONMAN (organizador)"),
        _row(HAYF, "Hay Festival Cartagena de Indias 2027", "2027-01-28", "2027-01-31", category="festival",
             venue="Varios escenarios · Cartagena de Indias", date_text="del 28 al 31 de enero del 2027",
             source_url=HAY, source_name="Hay Festival (organizador)"),
        _row(FIESTAS, "Fiestas de Independencia 2026", "2026-10-02", "2026-11-15", category="festival",
             venue="Varios escenarios · Cartagena de Indias", is_umbrella=True,
             date_text="Del 2 de octubre al 15 de noviembre de 2026"),
        _row(PRELUDIO, "Preludio Localidad 1 · Canapote", "2026-10-02", venue="Canapote",
             date_text="2 de octubre de 2026", parent_id=FIESTAS),
        _row(HIDDEN, "Concierto cancelado", "2026-10-03", category="concert", date_text="3 de octubre de 2026",
             status="hidden", status_reason="cancel_marker"),
        _row(PAST, "Evento pasado", "2026-09-01", date_text="1 de septiembre de 2026"),
    ]


PARTNERS = [
    {"partner_id": "ptr_celele", "name": "Celele", "category": "restaurant", "subcategory": "caribbean",
     "rank_score": 9, "rating": 4.8},
    {"partner_id": "ptr_carmen", "name": "Carmen", "category": "restaurant", "subcategory": "fine_dining",
     "rank_score": 8, "rating": 4.7},
]


# ── stub Mongo ───────────────────────────────────────────────────────────────


def _get(doc: Dict[str, Any], key: str) -> Any:
    cur: Any = doc
    for part in key.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def _match(doc: Dict[str, Any], q: Optional[Dict[str, Any]]) -> bool:
    for k, cond in (q or {}).items():
        if k == "$and":
            if not all(_match(doc, c) for c in cond):
                return False
            continue
        if k == "$or":
            if not any(_match(doc, c) for c in cond):
                return False
            continue
        v = _get(doc, k)
        if isinstance(cond, dict) and cond and all(str(op).startswith("$") for op in cond):
            for op, arg in cond.items():
                if op == "$in" and not (v in arg or (isinstance(v, list) and any(x in arg for x in v))):
                    return False
                if op == "$nin" and v in arg:
                    return False
                if op == "$ne" and v == arg:
                    return False
                if op == "$gte" and (v is None or v < arg):
                    return False
                if op == "$gt" and (v is None or v <= arg):
                    return False
                if op == "$regex" and not re.search(str(arg), str(v or ""), re.I):
                    return False
        elif cond is None:
            if v is not None:
                return False
        elif isinstance(v, list):
            if cond not in v:
                return False
        elif v != cond:
            return False
    return True


class _Cursor:
    def __init__(self, rows: List[Dict[str, Any]]):
        self.rows = rows

    def sort(self, key: Any = None, direction: int = 1) -> "_Cursor":
        if isinstance(key, str):
            self.rows.sort(key=lambda r: (r.get(key) is None, str(r.get(key) or "")), reverse=direction < 0)
        return self

    def limit(self, n: int) -> "_Cursor":
        self.rows = self.rows[:n]
        return self

    async def to_list(self, length: Optional[int] = None) -> List[Dict[str, Any]]:
        return [dict(r) for r in self.rows][: length or None]

    def __aiter__(self) -> "_Cursor":
        self._it = iter([dict(r) for r in self.rows])
        return self

    async def __anext__(self) -> Dict[str, Any]:
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration


class _Coll:
    def __init__(self, rows: Optional[List[Dict[str, Any]]] = None):
        self.rows = list(rows or [])
        self.reads = 0

    def find(self, query: Optional[Dict[str, Any]] = None, projection: Any = None) -> _Cursor:
        self.reads += 1
        return _Cursor([dict(r) for r in self.rows if _match(r, query)])

    async def find_one(self, query: Optional[Dict[str, Any]] = None, projection: Any = None,
                       sort: Any = None) -> Optional[Dict[str, Any]]:
        self.reads += 1
        hits = [r for r in self.rows if _match(r, query)]
        if sort:
            k, d = sort[0]
            hits.sort(key=lambda r: str(r.get(k) or ""), reverse=d < 0)
        return dict(hits[0]) if hits else None

    async def count_documents(self, query: Optional[Dict[str, Any]] = None) -> int:
        return len([r for r in self.rows if _match(r, query)])

    async def distinct(self, key: str) -> List[Any]:
        return sorted({r.get(key) for r in self.rows if r.get(key)})


class _DB:
    def __init__(self, *, enabled: Optional[bool] = True, healthy: bool = True,
                 events: Optional[List[Dict[str, Any]]] = None):
        flags = [] if enabled is None else [{"_id": "flags", "enabled": enabled, "sources_disabled": []}]
        runs = [{"kind": "sentinel", "done": True,
                 "finished_at": (NOW - timedelta(hours=5)).strftime("%Y-%m-%dT%H:%M:%SZ")}] if healthy else []
        self.city_events = _Coll(_docs() if events is None else events)
        self.city_events_state = _Coll(flags)
        self.city_events_runs = _Coll(runs)
        self.partners = _Coll(PARTNERS)
        self.partner_pulses = _Coll()
        # Legacy collections: Luna must NEVER read them again (§15 T1 / §13 D5).
        self.events = _Coll([{"event_id": "evt_010", "title": "Jazz & Wine Night", "date": "2026-10-01"}])
        self.partner_events = _Coll([{"event_id": "pe_1", "title": "Sunset Session", "date": "2026-10-01",
                                      "is_published": True}])


class _FakeLLM:
    def __init__(self, reply: Optional[Dict[str, Any]] = None, raw: Optional[str] = None):
        self.reply, self.raw = reply, raw
        self.calls: List[Dict[str, Any]] = []

    async def __call__(self, system: str, user_text: str, **kw: Any) -> Optional[str]:
        self.calls.append({"system": system, "user": user_text, **kw})
        if self.raw is not None:
            return self.raw
        return json.dumps(self.reply, ensure_ascii=False) if self.reply is not None else None

    @property
    def payload(self) -> Dict[str, Any]:
        return json.loads(self.calls[-1]["user"])


@pytest.fixture(autouse=True)
def _fresh_caches():
    R.invalidate_caches()
    yield
    R.invalidate_caches()


def _turn(db: _DB, text: str, fake: _FakeLLM, monkeypatch: pytest.MonkeyPatch, **kw: Any) -> Dict[str, Any]:
    monkeypatch.setattr(LLM, "llm_complete", fake)
    kw.setdefault("history", [])
    return asyncio.run(A.run_agent_turn(db, user=None, user_text=text, now=NOW, **kw))


def _reply(message: str, **extra: Any) -> Dict[str, Any]:
    out = {"message": message, "language": "es", "recommendations": [], "actions": [], "suggestions": ["Ver más"]}
    out.update(extra)
    return out


# ── fixture sanity: the rows really are HIGH / VERIFY through the real gate ──


def test_fixture_rows_pass_the_real_gate():
    by = {d["event_id"]: G.evaluate(d, NOW) for d in _docs()}
    for eid in (BANDO, SALSA, BOCACHICA, IRONMAN, HAYF, FIESTAS, PRELUDIO):
        assert (by[eid]["status"], by[eid]["confidence"]) == ("published", "HIGH"), (eid, by[eid])
    assert (by[JLG]["status"], by[JLG]["confidence"]) == ("published", "VERIFY")
    assert by[HIDDEN]["status"] == "hidden"
    assert by[PAST]["status"] == "expired"


# ── (a) a date WITH events -> grounded answer + source footer ────────────────


def test_a_date_with_events_lists_them_with_source_footer(monkeypatch):
    fake = _FakeLLM(_reply(
        "El 12 de noviembre es el Gran Desfile de Independencia (Bando) en la Avenida Santander, "
        "dentro de las Fiestas de Independencia 2026.",
        recommendations=[{"kind": "event", "event_id": BANDO, "name": "x", "reason": "a las 5 pm, gratis"}],
        actions=[{"type": "open_event", "event_id": BANDO, "label": "Ver"}],
    ))
    db = _DB()
    out = _turn(db, "¿Qué eventos hay el 12 de noviembre?", fake, monkeypatch)

    assert len(fake.calls) == 1
    ctx = fake.payload["context"]
    injected = [e["event_id"] for e in ctx["confirmed_events"]]
    assert BANDO in injected and HAYF not in injected and SALSA not in injected   # range-filtered
    assert HIDDEN not in injected and PAST not in injected
    for gone in ("events", "partner_events", "live_tonight"):
        assert gone not in ctx
    serialized = fake.calls[-1]["user"]
    assert "Descripción interna" not in serialized            # §15 S4: structured fields only
    assert db.events.reads == 0 and db.partner_events.reads == 0   # legacy never read

    assert out["message"].startswith("El 12 de noviembre es el Gran Desfile")
    assert f"Fuente: {IPCC_NAME} · verificado 28 sep" in out["message"]
    card = out["recommendations"][0]
    assert card["event_id"] == BANDO and card["reason"] == "12 nov" and "5 pm" not in json.dumps(card)
    assert card["address"] == "Avenida Santander"
    assert out["actions"] == [{"type": "open_event", "event_id": BANDO, "label": "Ver"}]


# ── (b) a date with NONE -> deterministic decline, no LLM ────────────────────


def test_b_date_without_events_declines_without_llm(monkeypatch):
    fake = _FakeLLM(_reply("Hay un concierto de Karol G el 20 de diciembre."))
    out = _turn(_DB(), "¿Qué conciertos hay el 20 de diciembre?", fake, monkeypatch)

    assert fake.calls == []
    msg = out["message"]
    assert msg.startswith("No tengo conciertos confirmados para el 20 dic.")
    assert "Confirmado:" in msg and "Sin confirmar (verifica con el organizador):" in msg
    assert "• Juan Luis Guerra (Festival Náutico) — 13 nov" in msg
    assert "Karol G" not in msg
    assert out["actions"] == [{"type": "navigate", "screen": "agenda", "label": "Ver agenda verificada"}]
    assert out["recommendations"] == []
    # every listed event is cited; VERIFY is hedged
    assert "Juan Luis Guerra (Festival Náutico) — Fuente: El Universal · verificado 28 sep (sin confirmar)" in msg


def test_b_decline_is_deterministic_in_four_languages(monkeypatch):
    for text, lead in (("What concerts are on December 20?", "I don't have any confirmed concerts for 20 Dec."),
                       ("Quels concerts le 20 décembre ?", "Je n'ai pas de concerts confirmés pour le 20 déc. "),
                       ("Quais concertos tem no dia 20 de dezembro?", "Não tenho shows confirmados para o dia 20 dez."),
                       ("Quais shows tem no dia 20 de dezembro?", "Não tenho eventos confirmados para o dia 20 dez.")):
        fake = _FakeLLM(_reply("x"))
        out = _turn(_DB(), text, fake, monkeypatch)
        assert fake.calls == [], text
        assert out["message"].startswith(lead), out["message"]
    R.invalidate_caches()
    fake = _FakeLLM(_reply("x"))
    out = _turn(_DB(), "What's on December 20?", fake, monkeypatch, forced_language="pt")
    assert fake.calls == [] and out["language"] == "pt" and out["message"].startswith("Não tenho eventos")


# ── (c) 'cerca de mí' -> only nearby rows; location never persisted/logged ───


def test_c_near_me_with_location_injects_only_nearby_rows(monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    fake = _FakeLLM(_reply("Cerca de ti está Salsa a la Plaza el 14 de noviembre en la Plaza de la Aduana."))
    out = _turn(_DB(), "eventos cerca de mí", fake, monkeypatch, location=dict(USER_LOC))

    ctx = fake.payload["context"]
    rows = ctx["confirmed_events"]
    assert [r["event_id"] for r in rows] == [SALSA]                 # Bocachica (~11 km) and ungeocoded rows out
    assert 0 <= rows[0]["distance_m"] < 3000
    serialized = fake.calls[-1]["user"]
    assert "10.4231" not in serialized and "-75.5502" not in serialized   # the user's position never reaches the LLM
    assert "10.4231" not in caplog.text and "75.5502" not in caplog.text
    assert "Salsa a la Plaza" in out["message"] and "Fuente: IPCC" in out["message"]


def test_c_near_me_nothing_within_3km_declines_without_llm(monkeypatch):
    fake = _FakeLLM(_reply("x"))
    out = _turn(_DB(), "eventos cerca de mí", fake, monkeypatch, location={"lat": 10.475, "lng": -75.49})
    assert fake.calls == []
    assert out["message"].startswith("No tengo eventos confirmados cerca de ti (a menos de 3 km)")


def test_c_near_me_without_location_declines_the_proximity_part(monkeypatch):
    fake = _FakeLLM(_reply("x"))
    for loc in (None, {"lat": "abc", "lng": 1}, {"lat": 0, "lng": 0}, {"lat": 95, "lng": -75.5}):
        R.invalidate_caches()
        out = _turn(_DB(), "eventos cerca de mí", fake, monkeypatch, location=loc)
        assert fake.calls == []
        assert out["message"].startswith("No tengo tu ubicación en este chat")
        assert "Confirmado:" in out["message"]                         # the city-wide offer


def test_c_get_confirmed_events_haversine_filter_and_sort():
    rows = asyncio.run(L.get_confirmed_events(_DB(), "upcoming", near=dict(USER_LOC), now=NOW))
    assert [r["event_id"] for r in rows] == [SALSA]
    far = asyncio.run(L.get_confirmed_events(_DB(), "upcoming", near={"lat": 10.3210, "lng": -75.5830}, now=NOW))
    assert [r["event_id"] for r in far] == [BOCACHICA]


# ── (d) a fake open_event id is stripped ─────────────────────────────────────


def test_d_fake_open_event_ids_and_links_are_stripped(monkeypatch):
    fake = _FakeLLM(_reply(
        "El 12 de noviembre es el Gran Desfile de Independencia (Bando).",
        recommendations=[
            {"kind": "event", "event_id": "ce-karol-g-20261112-ffff", "name": "Karol G"},
            {"kind": "event", "event_id": "evt_010", "name": "Jazz & Wine Night"},
            {"kind": "event", "event_id": BANDO, "name": "Bando"},
            {"kind": "partner", "partner_id": "ptr_celele", "name": "Celele"},
        ],
        actions=[
            {"type": "open_event", "event_id": "evt_010", "label": "Jazz"},
            {"type": "open_event", "event_id": "ce-karol-g-20261112-ffff", "label": "Karol G"},
            {"type": "external_link", "url": "https://evil.example.com/tickets", "label": "Boletas"},
            {"type": "external_link", "url": IPCC, "label": "Agenda oficial"},
        ],
    ))
    out = _turn(_DB(), "¿Qué eventos hay el 12 de noviembre?", fake, monkeypatch)
    assert [a.get("event_id") or a.get("url") for a in out["actions"]] == [IPCC]
    kinds = [(r["kind"], r.get("event_id") or r.get("partner_id")) for r in out["recommendations"]]
    assert kinds == [("event", BANDO), ("partner", "ptr_celele")]


def test_d_sanitize_unit():
    rows = [{"event_id": BANDO, "title": {"es": "Bando"}, "start_date": "2026-11-12", "end_date": "2026-11-12",
             "confidence": "HIGH", "source_url": IPCC, "ticket_url": "https://tuboleta.com/bando",
             "source_name": "IPCC", "venue_name": "Av. Santander", "category": "cultural"}]
    recs, acts = L.sanitize(
        [{"kind": "event", "event_id": "pe_9"}, {"event_id": BANDO}, {"event_id": BANDO}],
        [{"type": "open_event", "event_id": "pe_9"}, {"type": "open_event", "event_id": BANDO},
         {"type": "external_link", "url": "https://tuboleta.com/bando"},
         {"type": "external_link", "url": "https://tuboleta.com/otro"},
         {"type": "external_link", "url": "https://www.etcar.com.co/", "label": "ETCAR"},
         {"type": "navigate", "screen": "agenda"}],
        rows, allowed_urls=["https://www.etcar.com.co/"], now=NOW)
    assert [r["event_id"] for r in recs] == [BANDO]
    assert [a.get("event_id") or a.get("url") or a.get("screen") for a in acts] == [
        BANDO, "https://tuboleta.com/bando", "https://www.etcar.com.co/", "agenda"]


# ── (e) the prose guard replaces an invented 'Karol G el 12 de noviembre' ────


def test_e_prose_guard_replaces_invented_event_date_unit():
    rows = asyncio.run(L.get_confirmed_events(_DB(), "upcoming", now=NOW))
    rows = [r for r in rows if r["event_id"] in (HAYF, IRONMAN)]
    bad = "¡Sí! Karol G tiene concierto el 12 de noviembre en el Estadio Jaime Morón."
    out = L.prose_guard(bad, rows, "es", now=NOW)
    assert "Karol G" not in out and "12 de noviembre" not in out
    assert out.startswith("No puedo confirmarte eso con fuentes verificadas.")
    assert "• IRONMAN 70.3 Cartagena — 29 nov" in out and "• Hay Festival Cartagena de Indias 2027 — 28–31 ene 2027" in out
    # a grounded sentence is left alone; a time token with no event word never trips it
    ok = "El IRONMAN 70.3 Cartagena es el domingo 29 de noviembre."
    assert L.prose_guard(ok, rows, "es", now=NOW) == ok
    assert L.prose_guard("Celele abre a las 19:00, ideal para cenar.", [], "es", now=NOW) == \
        "Celele abre a las 19:00, ideal para cenar."
    # an invented TIME next to an event word trips it too (row has no start_time)
    assert L.prose_guard("El IRONMAN 70.3 Cartagena arranca a las 6:30 a.m.", rows, "es", now=NOW) != \
        "El IRONMAN 70.3 Cartagena arranca a las 6:30 a.m."


def test_e_invented_artist_on_a_real_date_is_replaced_end_to_end(monkeypatch):
    # Nov 12 IS a real row date (Bando), so the §15 V2 date check alone would pass; the
    # unknown-name check catches an artist the verified feed does not have.
    fake = _FakeLLM(_reply("¡Sí! Karol G tiene concierto el 12 de noviembre en el Estadio.",
                           recommendations=[{"kind": "event", "event_id": BANDO}]))
    out = _turn(_DB(), "¿Karol G viene?", fake, monkeypatch)
    assert len(fake.calls) == 1
    assert "Karol G" not in out["message"]
    assert out["message"].startswith("No puedo confirmarte eso con fuentes verificadas.")
    assert "Confirmado:" in out["message"] and "Fuente:" in out["message"]


# ── (f) 'dónde cenar hoy' is NOT an event question ───────────────────────────

MUST_FIRE = ["qué conciertos hay este fin", "¿qué pasa hoy en Cartagena?", "eventos cerca de mí",
             "what's on tonight", "fiestas de independencia", "¿cuándo es el Hay Festival?", "¿Karol G viene?",
             "¿Cuándo toca Juan Luis Guerra?", "O que tem hoje à noite?", "Qu'est-ce qui se passe ce soir ?"]
MUST_NOT = ["dónde cenar hoy", "restaurante abierto esta noche", "qué hago hoy en la playa",
            "show me the best restaurants", "quiero ir de fiesta esta noche", "¿qué hay para comer hoy?",
            "necesito un lugar para un evento corporativo", "agrega esto a mi agenda", "¿Juan viene conmigo?",
            "Me toca pagar en efectivo?"]


@pytest.mark.parametrize("text", MUST_FIRE)
def test_f_event_questions_fire(text):
    assert L.detect_event_intent(text, L.guess_lang(text), now=NOW)["is_event"] is True


@pytest.mark.parametrize("text", MUST_NOT)
def test_f_non_event_questions_do_not_fire(text):
    assert L.detect_event_intent(text, L.guess_lang(text), now=NOW)["is_event"] is False


def test_f_intent_shape_ranges_and_category():
    d = L.detect_event_intent("qué conciertos hay este fin", "es", now=NOW)
    assert d == {"is_event": True, "range": "weekend", "near": False, "category": "concert"}
    assert L.detect_event_intent("what's on tonight", "en", now=NOW)["range"] == "tonight"
    assert L.detect_event_intent("¿qué pasa hoy en Cartagena?", "es", now=NOW)["range"] == "today"
    assert L.detect_event_intent("¿hay eventos el 12 de noviembre?", "es", now=NOW)["range"] == "date:2026-11-12"
    assert L.detect_event_intent("eventos cerca de mí", "es", now=NOW)["near"] is True


def test_f_dinner_question_goes_to_llm_without_event_data(monkeypatch):
    fake = _FakeLLM(_reply(
        "Celele abre a las 19:00 y es ideal para cenar hoy. Esta noche hay concierto de salsa a las 22:00 en la Plaza.",
        recommendations=[{"kind": "partner", "partner_id": "ptr_celele", "name": "Celele"}]))
    db = _DB()
    out = _turn(db, "dónde cenar hoy", fake, monkeypatch)
    assert len(fake.calls) == 1
    ctx = fake.payload["context"]
    assert "confirmed_events" not in ctx and "events" not in ctx and "partner_events" not in ctx
    assert db.city_events.reads == 0                         # no event read at all on a venue question
    assert out["message"] == "Celele abre a las 19:00 y es ideal para cenar hoy."   # invented concert sentence stripped
    assert out["recommendations"][0]["partner_id"] == "ptr_celele"


# ── (g) maintenance decline when flags.enabled is false ──────────────────────


def test_g_kill_switch_declines_maintenance_without_llm(monkeypatch):
    for enabled in (False, None):  # explicit off, and a MISSING flags doc (fail closed)
        R.invalidate_caches()
        fake = _FakeLLM(_reply("x"))
        db = _DB(enabled=enabled)
        out = _turn(db, "¿qué conciertos hay este fin?", fake, monkeypatch)
        assert fake.calls == []
        assert out["message"].startswith("La agenda de eventos está en mantenimiento")
        assert out["actions"][0] == {"type": "navigate", "screen": "agenda", "label": "Ver agenda verificada"}
        assert db.city_events.reads == 0


# ── (h) VERIFY rows are hedged 'sin confirmar' ───────────────────────────────


def test_h_verify_rows_are_hedged_in_llm_answers(monkeypatch):
    fake = _FakeLLM(_reply("Juan Luis Guerra se presenta el 13 de noviembre en el Festival Náutico.",
                           recommendations=[{"kind": "event", "event_id": JLG, "vibe": "¡Confirmadísimo!"}]))
    out = _turn(_DB(), "¿Cuándo toca Juan Luis Guerra?", fake, monkeypatch)
    ctx_rows = {r["event_id"]: r for r in fake.payload["context"]["confirmed_events"]}
    assert ctx_rows[JLG]["confidence"] == "VERIFY"
    assert list(ctx_rows)[0] == JLG                              # the named event is floated first
    assert "Fuente: El Universal · verificado 28 sep (sin confirmar)" in out["message"]
    # A VERIFY row is named (hedged) in the text but never becomes a card: 1.1.x opens cards via
    # the legacy /events/{id}, which serves HIGH rows only → 'Evento no encontrado' (verifier LC1).
    assert all(r.get("event_id") != JLG for r in out["recommendations"])
    assert "Confirmadísimo" not in str(out)


def test_h_unhealthy_sentinel_serves_everything_as_sin_confirmar(monkeypatch):
    fake = _FakeLLM(_reply("x"))
    out = _turn(_DB(healthy=False), "¿Qué conciertos hay el 20 de diciembre?", fake, monkeypatch)
    assert fake.calls == []
    assert "\nConfirmado:" not in out["message"]
    assert "Sin confirmar (verifica con el organizador):" in out["message"]


# ── history cutover, prompt hygiene, fallbacks ───────────────────────────────


def test_history_drops_pre_cutover_and_untimestamped_assistant_turns(monkeypatch):
    history = [
        {"role": "user", "content": "hola", "created_at": "2026-09-20T10:00:00Z"},
        {"role": "assistant", "content": "Jazz & Wine Night en Bellini hoy", "created_at": "2026-09-20T10:00:01Z"},
        {"role": "assistant", "content": "sin fecha: Sunset Session"},
        {"role": "assistant", "content": "Respuesta nueva", "created_at": "2026-09-29T00:00:05Z"},
    ]
    fake = _FakeLLM(_reply("Te recomiendo Celele para cenar."))
    _turn(_DB(), "dónde cenar", fake, monkeypatch, history=history)
    sent = fake.payload["history"]
    assert sent == [{"role": "user", "content": "hola"}, {"role": "assistant", "content": "Respuesta nueva"}]
    assert L.EVENTS_ELITE_CUTOVER == "2026-09-29T00:00:00Z"


def test_prompt_no_longer_teaches_invented_events_or_ghost_keys():
    p = A.SYSTEM_PROMPT
    for stale in ("evt_010", "Jazz & Wine", "Sunset Session", "6 de noviembre", "upcoming_confirmed",
                  "all_partners_directory", "inventory_summary", "semantic_filters_detected",
                  "partner_curated_events", "upcoming_events", "context.partner_events"):
        assert stale not in p, stale
    assert "AUTORIDAD EVENTOS" in p and "confirmed_events" in p and "según el local" in p
    assert not hasattr(A, "_slim_upcoming_events") and not hasattr(A, "_slim_partner_events")


def test_seasonal_context_carries_no_event_dates():
    sc = A._seasonal_context("qué festival hay en noviembre, fiestas de independencia")
    assert sc is None or "upcoming_confirmed" not in sc


def test_llm_failure_on_event_question_returns_grounded_list(monkeypatch):
    fake = _FakeLLM(raw="not json at all")
    out = _turn(_DB(), "¿Qué eventos hay el 12 de noviembre?", fake, monkeypatch)
    assert len(fake.calls) == 1
    assert out["message"].startswith("Esto es lo que tengo confirmado para el 12 nov:")
    assert "Gran Desfile de Independencia (Bando)" in out["message"] and "Fuente: IPCC" in out["message"]
    assert all(r["kind"] == "event" for r in out["recommendations"])


def test_events_no_llm_answers_deterministically(monkeypatch):
    fake = _FakeLLM(_reply("x"))
    out = _turn(_DB(), "¿cuándo es el Hay Festival?", fake, monkeypatch, events_no_llm=True)
    assert fake.calls == []
    assert "• Hay Festival Cartagena de Indias 2027 — 28–31 ene 2027" in out["message"]
    assert [r["event_id"] for r in out["recommendations"]][0] == HAYF    # title match floated first


def test_umbrella_is_excluded_from_weekend_but_sub_events_are_not():
    # Mon 28 Sep -> the weekend is Fri 2 – Sun 4 Oct: the Fiestas umbrella starts on the 2nd.
    rows = asyncio.run(L.get_confirmed_events(_DB(), "weekend", now=NOW))
    ids = [r["event_id"] for r in rows]
    assert PRELUDIO in ids and FIESTAS not in ids and HIDDEN not in ids
    week = asyncio.run(L.get_confirmed_events(_DB(), "date:2026-10-20", now=NOW))
    assert [r["event_id"] for r in week] == [FIESTAS]                 # a specific date may show the umbrella


def test_citation_footer_only_for_mentioned_events():
    rows = asyncio.run(L.get_confirmed_events(_DB(), "upcoming", now=NOW))
    msg = "Te recomiendo el IRONMAN 70.3 Cartagena."
    out = L.citation_footer(msg, [], [], rows, "es")
    assert out == msg + "\n\nFuente: IRONMAN (organizador) · verificado 28 sep"
    assert L.citation_footer("Nada de eventos aquí.", [], [], rows, "es") == "Nada de eventos aquí."
    en = L.citation_footer("The Hay Festival is in January.", [], [], rows, "en")
    assert en.endswith("Source: Hay Festival (organizer) · verified 28 Sep") or \
        en.endswith("Source: Hay Festival (organizador) · verified 28 Sep")
