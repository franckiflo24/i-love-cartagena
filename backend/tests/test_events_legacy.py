"""EVENTS-ELITE legacy mapper contract (§13 D2): what old binaries (1.1.0/1.1.1) render.

The 1.1.x client logic is FROZEN in shipped binaries, so it is replicated here with JS
semantics (template literals print null as 'null', Math.round({}) is NaN, …) from:
  frontend/src/utils/price.ts            eventPriceLabel
  frontend/app/event/[id].tsx            price row, 'Horario', booking CTA / 'Acceso libre', share text
  frontend/app/(tabs)/index.tsx          applyData() mapping + getBudgetStyle
  frontend/app/(tabs)/agenda.tsx         city-event mapping
  frontend/app/concerts.tsx              formatPrice, price badge, ticket CTA / 'Entrada libre', share
Every mapped row is rendered through all of them: no 'NaN', no 'null'/'undefined', no
'Acceso libre'/'Entrada libre' on a paid or unknown event, GRATIS only when truly free.

Run: cd backend && python -m pytest -q tests/test_events_legacy.py
"""
from __future__ import annotations

import math
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

import events_gate as G  # noqa: E402
import events_legacy as L  # noqa: E402

UTC = timezone.utc
NOW = datetime(2026, 9, 28, 17, 0, tzinfo=UTC)

# 1.1.x category keys the old UI renders (copied from the shipped sources, frozen):
# Home CAT_COLORS keys + Agenda PARTNER_CATEGORIES keys + detail EVENT_TYPE_LABELS keys.
OLD_HOME_CAT_COLORS = {"gastronomy", "music", "party", "wellness", "art", "popup", "daypass", "sunset",
                       "festival", "cultural", "sports", "religious", "holiday", "recurring", "literary"}
OLD_BUNDLED_PLACEHOLDER_KEYS = {"restaurant", "restaurants", "gastronomy", "fine_dining", "bar", "cocktail_bar",
                                "rooftop", "lounge", "cafe", "coffee", "bakery", "brunch", "nightlife", "club",
                                "nightclub", "party", "after_party", "beach_club", "beachclub", "beach", "daypass",
                                "day_pass", "sunset", "wellness", "spa", "beauty", "massage", "hotel", "hotels",
                                "yacht", "yachts", "activity", "activities", "tour", "sport", "sports",
                                "attraction", "cultural", "culture", "art", "religious", "museum", "concert",
                                "music", "festival", "live_music", "event", "events", "popup", "pop_up"}

# ── JS-semantics replica of the 1.1.x rendering logic ────────────────────────

UNDEF = object()


def js_str(v: Any) -> str:
    """`${v}` in a JS template literal."""
    if v is UNDEF:
        return "undefined"
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        if math.isnan(v):
            return "NaN"
        return str(int(v)) if v.is_integer() else repr(v)
    if isinstance(v, (dict, list)):
        return "[object Object]" if isinstance(v, dict) else ",".join(js_str(x) for x in v)
    return str(v)


def js_truthy(v: Any) -> bool:
    if v is UNDEF or v is None or v is False:
        return False
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return not (v == 0 or (isinstance(v, float) and math.isnan(v)))
    if isinstance(v, str):
        return v != ""
    return True


def js_number(v: Any) -> float:
    if v is UNDEF:
        return float("nan")
    if v is None or v is False:
        return 0.0
    if v is True:
        return 1.0
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v) if v.strip() else 0.0
        except ValueError:
            return float("nan")
    return float("nan")  # objects


def js_or(*vals: Any) -> Any:
    for v in vals[:-1]:
        if js_truthy(v):
            return v
    return vals[-1]


def js_le(a: Any, b: float) -> bool:
    n = js_number(a)
    return (not math.isnan(n)) and n <= b


def js_ge(a: Any, b: float) -> bool:
    n = js_number(a)
    return (not math.isnan(n)) and n >= b


def es_co_int(n: float) -> str:
    if math.isnan(n):
        return "NaN"
    return f"{int(round(n)):,}".replace(",", ".")


def event_price_label(price: Any, is_free: Any, cop: bool = True) -> str:
    """frontend/src/utils/price.ts eventPriceLabel."""
    if js_truthy(is_free):
        return "GRATIS"
    if not js_truthy(price) or js_le(price, 0):
        return "Consultar"
    n = js_number(price)
    return f"${es_co_int(n)} COP" if cop else f"${js_str(round(n / 1000) if not math.isnan(n) else n)}K"


def is_http_url(u: Any) -> bool:
    return isinstance(u, str) and re.match(r"^https?://[^\s]+$", u.strip(), re.I) is not None


def get(row: Dict[str, Any], k: str) -> Any:
    return row[k] if k in row else UNDEF


def render_event_detail(e: Dict[str, Any]) -> Dict[str, str]:
    """app/event/[id].tsx (1.1.x)."""
    price_text = event_price_label(get(e, "price"), get(e, "is_free"))
    return {
        "price_row": price_text,
        "horario": f"{js_str(get(e, 'start_time'))} - {js_str(get(e, 'end_time'))}",
        "cta": "Reservar" if is_http_url(get(e, "booking_link")) else "Acceso libre",
        "share": (f"🎉 {js_str(get(e, 'title'))}\n📍 {js_str(get(e, 'venue_name'))}\n🗓 {js_str(get(e, 'date'))} · "
                  f"{js_str(get(e, 'start_time'))}\n💰 {price_text}\n\nDescarga AMO Life para ver todo el programa 🎧"),
        "badge": js_str(get(e, "type")),
        "desc": js_str(get(e, "description")),
        "venue": js_str(get(e, "venue_name")),
    }


def render_home_card(e: Dict[str, Any]) -> Dict[str, str]:
    """app/(tabs)/index.tsx applyData() + getBudgetStyle (1.1.x)."""
    price = js_number(js_or(get(e, "price_min_cop"), get(e, "price"), 0))
    is_free = get(e, "is_free")
    if js_truthy(is_free):
        label = "GRATIS"
    elif not js_truthy(price):
        label = "Consultar"
    else:
        label = f"${js_str(float(round(price / 1000)))}K"
    return {
        "title": js_str(js_or(get(e, "name_es"), get(e, "title"), "")),
        "time": js_str(js_or(get(e, "time_start"), get(e, "start_time"), "")),
        "venue": js_str(js_or(get(e, "venue"), get(e, "venue_name"), "")),
        "budget": label,
        "type": js_str(js_or(get(e, "category"), get(e, "type"), "")),
    }


def render_agenda_row(e: Dict[str, Any]) -> Dict[str, str]:
    """app/(tabs)/agenda.tsx city-event mapping (1.1.x)."""
    return {
        "title": js_str(js_or(get(e, "name_es"), get(e, "title"), "")),
        "start_time": js_str(js_or(get(e, "time_start"), get(e, "start_time"), "")),
        "price": js_str(js_or(get(e, "price_min_cop"), get(e, "price"), 0)),
        "chip": js_str(js_or(get(e, "category"), get(e, "type"), "")).upper(),
    }


def format_price_concert(price: Any) -> str:
    """app/concerts.tsx formatPrice."""
    if js_ge(price, 1000):
        return f"${js_str(float(round(js_number(price) / 1000)))}K"
    return f"${js_str(price)}"


def render_concert(c: Dict[str, Any]) -> Dict[str, str]:
    """app/concerts.tsx card + expanded + share (1.1.x)."""
    price_text = event_price_label(get(c, "price"), get(c, "is_free"))
    badge = "GRATIS" if js_truthy(get(c, "is_free")) else f"{format_price_concert(get(c, 'price'))} COP"
    return {
        "badge": badge,
        "cta": "Comprar entrada" if js_truthy(get(c, "ticket_link")) else "Entrada libre",
        "share": (f"🎵 {js_str(get(c, 'artist'))} - {js_str(get(c, 'title'))}\n📍 {js_str(get(c, 'venue_name'))}\n"
                  f"🗓 {js_str(get(c, 'date'))} · {js_str(get(c, 'start_time'))}-{js_str(get(c, 'end_time'))}\n"
                  f"🎶 {js_str(get(c, 'genre'))}\n💰 {price_text}\n\nDescarga AMO Life para ver todo el programa 🎧"),
        "meta_time": f"{js_str(get(c, 'start_time'))} - {js_str(get(c, 'end_time'))}",
        "genre_lower": js_str(get(c, "genre")).lower(),
        "artist": js_str(get(c, "artist")),
    }


BAD_TOKENS = ("NaN", "null", "undefined", "[object Object]")


def assert_clean(rendered: Dict[str, str], where: str) -> None:
    for k, v in rendered.items():
        for tok in BAD_TOKENS:
            assert tok not in v, (where, k, v)


# ── PublicEvent fixtures (as events_gate.public_view emits them) ─────────────

def pv(**over) -> Dict[str, Any]:
    d: Dict[str, Any] = {
        "event_id": "ce-de-la-risa-al-llanto-20261029-ab12",
        "title": {"es": "De la risa al llanto", "en": "From laughter to tears"},
        "description": {"es": "Dos historias, dos mujeres."},
        "category": "cultural",
        "start_date": "2026-10-29", "end_date": "2026-10-29", "start_time": "19:00", "end_time": None,
        "date_tbc_note": None, "venue_name": "Teatro Adolfo Mejía", "zone": "centro",
        "lat": 10.4266111, "lng": -75.5511837,
        "price": {"is_free": None, "min_cop": 25000, "max_cop": 60000, "text": "Desde $25.000"},
        "ticket_url": "https://tuboleta.com/es/eventos/de-la-risa-al-llanto",
        "source_url": "https://tuboleta.com/es/eventos/de-la-risa-al-llanto",
        "source_name": "TuBoleta", "second_source_name": None,
        "last_verified": "2026-09-28T16:00:00Z", "confidence": "HIGH", "status": "published",
        "sold_out": False, "image_url": "/images/events/risa.jpg", "image_credit": "TuBoleta",
        "notif_eligible": True, "parent_id": None, "is_verified": True, "origin": "pipeline",
        "status_reason": None, "address": None, "is_umbrella": False,
    }
    d.update(over)
    return d


MATRIX: Dict[str, Dict[str, Any]] = {
    "paid_known": pv(),
    "free_confirmed": pv(price={"is_free": True, "min_cop": None, "max_cop": None, "text": "Entrada libre"}),
    "price_unknown": pv(price={"is_free": None, "min_cop": None, "max_cop": None, "text": None}),
    "is_free_false_no_price": pv(price={"is_free": False, "min_cop": None, "max_cop": None, "text": None}),
    "free_contradicted_by_price": pv(price={"is_free": True, "min_cop": 30000, "max_cop": None, "text": None}),
    "price_missing_entirely": {k: v for k, v in pv().items() if k != "price"},
    "price_garbage": pv(price={"is_free": "yes", "min_cop": {"$numberInt": "1"}, "max_cop": float("nan")}),
    "price_float_and_string": pv(price={"is_free": None, "min_cop": 45000.6, "max_cop": "80000"}),
    "no_times": pv(start_time=None, end_time=None),
    "no_ticket_url": pv(ticket_url=None),
    "js_ticket_url": pv(ticket_url="javascript:alert(1)"),
    "verify_row": pv(confidence="VERIFY", is_verified=False),
    "not_geocoded": pv(lat=None, lng=None),
    "no_description": pv(description={}),
    "no_image": pv(image_url=None, image_credit=None),
    "multi_day_festival": pv(category="festival", start_date="2027-01-09", end_date="2027-01-17", start_time=None,
                             venue_name="Varios escenarios · Centro Histórico", lat=None, lng=None,
                             source_url="https://cartagenamusicfestival.com/programacion/", ticket_url=None,
                             source_name="Cartagena Festival de Música (organizador)"),
    "no_source_name": pv(source_name=None),
    "concert_paid": pv(category="concert", title={"es": "Andrés Cepeda en Cartagena"}, start_date="2027-05-08",
                       end_date="2027-05-08", price={"is_free": None, "min_cop": 100000, "max_cop": None, "text": None}),
}


@pytest.mark.parametrize("name", list(MATRIX))
def test_legacy_event_exact_types(name):
    row = L.to_legacy_event(MATRIX[name])
    assert row is not None, name
    for k in ("event_id", "id", "slug"):
        assert row[k] == MATRIX[name]["event_id"]
    assert isinstance(row["title"], str) and row["title"]
    assert isinstance(row["description"], str)
    for k in ("date", "date_start", "date_end", "start_time", "end_time", "venue_name", "category", "type",
              "booking_link", "image_url"):
        assert isinstance(row[k], str), (name, k)
    assert row["price"] is None or (type(row["price"]) is int and row["price"] > 0), (name, row["price"])
    assert row["price_min_cop"] == row["price"]
    assert type(row["is_free"]) is bool and type(row["featured"]) is bool
    assert row["recurring"] is False and row["confidence"] == "high"
    assert is_http_url(row["booking_link"])
    assert row["ticket_url"] is None or is_http_url(row["ticket_url"])
    assert row["source"] == [MATRIX[name]["source_url"]]
    assert row["category"] == row["type"] == L.LEGACY_CAT[MATRIX[name].get("category", "cultural")]
    if MATRIX[name].get("lat") is None:
        assert "location" not in row
    else:
        assert row["location"] == {"lat": MATRIX[name]["lat"], "lng": MATRIX[name]["lng"]}


@pytest.mark.parametrize("name", list(MATRIX))
def test_old_client_rendering_contract(name):
    """Render every mapped row through the frozen 1.1.x logic."""
    src = MATRIX[name]
    row = L.to_legacy_event(src)
    truly_free = isinstance(src.get("price"), dict) and src["price"].get("is_free") is True \
        and not L._int_cop(src["price"].get("min_cop")) and not L._int_cop(src["price"].get("max_cop"))
    detail = render_event_detail(row)
    assert_clean(detail, f"detail:{name}")
    assert detail["cta"] == "Reservar"                                   # never 'Acceso libre'
    assert (detail["price_row"] == "GRATIS") == truly_free, (name, detail["price_row"])
    home = render_home_card(row)
    assert_clean(home, f"home:{name}")
    assert (home["budget"] == "GRATIS") == truly_free
    agenda = render_agenda_row(row)
    assert_clean(agenda, f"agenda:{name}")
    if not truly_free and row["price"] is None:
        assert detail["price_row"] == "Consultar" and home["budget"] == "Consultar"


@pytest.mark.parametrize("name", list(MATRIX))
def test_old_concerts_rendering_contract(name):
    src = dict(MATRIX[name], category="concert")
    c = L.to_legacy_concert(src)
    base = L.to_legacy_event(src)
    if c is None:
        # only skipped when the old card cannot render the price honestly
        assert base is not None and not base["is_free"] and base["price"] is None, name
        return
    r = render_concert(c)
    assert_clean(r, f"concert:{name}")
    assert r["cta"] == "Comprar entrada" and is_http_url(c["ticket_link"])
    assert (r["badge"] == "GRATIS") == c["is_free"]
    assert c["price"] is None or type(c["price"]) is int
    assert isinstance(c["genre"], str) and c["genre"] and isinstance(c["artist"], str) and c["artist"]
    assert c["concert_id"] == c["event_id"] == src["event_id"]
    assert isinstance(c["lineup"], list) and isinstance(c["tags"], list) and c["currency"] == "COP"


def test_replica_catches_the_bugs_it_guards_against():
    """Sanity: the replica really reproduces the 1.1.x failure modes."""
    bad = {"title": "X", "venue_name": "V", "date": "2026-10-29", "start_time": None, "end_time": None,
           "price": {"min_cop": 1}, "is_free": False, "booking_link": ""}
    r = render_event_detail(bad)
    assert r["price_row"] == "$NaN COP" and r["cta"] == "Acceso libre" and "null" in r["share"]
    assert render_concert({"price": None, "is_free": False, "ticket_link": ""})["badge"] == "$null COP"
    assert render_concert({"price": None, "is_free": False, "ticket_link": ""})["cta"] == "Entrada libre"


def test_description_verify_prefix_and_footer():
    row = L.to_legacy_event(pv())
    assert row["description"] == "Dos historias, dos mujeres.\n\nFuente: TuBoleta · verificado 28 sep"
    v = L.to_legacy_event(pv(confidence="VERIFY"))
    assert v["description"].startswith("Sin confirmar — verifica con el organizador. Dos historias")
    assert v["description"].endswith("\n\nFuente: TuBoleta · verificado 28 sep")
    # the verification date is the BOGOTÁ day: 03:00Z on 29 Sep is 22:00 on 28 Sep
    assert L.to_legacy_event(pv(last_verified="2026-09-29T03:00:00Z"))["description"].endswith("verificado 28 sep")
    assert L.to_legacy_event(pv(last_verified="2026-12-01T12:00:00Z"))["description"].endswith("verificado 1 dic")
    assert L.to_legacy_event(pv(last_verified=None))["description"].endswith("\n\nFuente: TuBoleta")
    assert L.to_legacy_event(pv(description={}))["description"] == "Fuente: TuBoleta · verificado 28 sep"
    assert L.to_legacy_event(pv(source_name=None))["description"].endswith("Fuente: tuboleta.com · verificado 28 sep")


def test_booking_link_prefers_ticket_then_source_http_only():
    assert L.to_legacy_event(pv(ticket_url="https://t.co/buy"))["booking_link"] == "https://t.co/buy"
    r = L.to_legacy_event(pv(ticket_url="javascript:alert(1)"))
    assert r["booking_link"] == pv()["source_url"] and r["ticket_url"] is None
    assert L.to_legacy_event(pv(ticket_url=None, source_url="ftp://x")) is None
    assert L.to_legacy_event(pv(ticket_url="https://t.co/ a b", source_url=None)) is None


def test_mapper_refuses_rows_old_clients_cannot_show():
    assert L.to_legacy_event(pv(start_date=None)) is None        # date_tbc never reaches old clients
    assert L.to_legacy_event(pv(title={})) is None
    assert L.to_legacy_event(pv(title={"en": "Only English"})) is None
    assert L.to_legacy_event(pv(event_id=None)) is None
    assert L.to_legacy_concert(pv(category="concert", price={"is_free": None})) is None


def test_legacy_categories_are_ones_the_old_ui_renders():
    assert set(L.LEGACY_CAT) == set(G.CATEGORIES)
    for cat, legacy in L.LEGACY_CAT.items():
        assert legacy in OLD_HOME_CAT_COLORS, cat
        assert legacy in OLD_BUNDLED_PLACEHOLDER_KEYS, cat
    assert L.LEGACY_CAT["concert"] == "music" and L.LEGACY_CAT["nightlife"] == "party"
    assert L.to_legacy_event(pv(category="bogus"))["category"] == "cultural"


def test_featured_dates_genres_and_date_filter_helpers():
    rows = L.legacy_events([MATRIX["paid_known"], MATRIX["multi_day_festival"], MATRIX["not_geocoded"],
                            pv(start_date=None)])
    assert len(rows) == 3
    feat = L.legacy_featured(rows)
    assert [r["event_id"] for r in feat] == [MATRIX["paid_known"]["event_id"], MATRIX["multi_day_festival"]["event_id"]]
    assert feat[1]["featured"] is True
    assert L.legacy_dates(rows) == ["2026-10-29", "2027-01-09"]
    assert [r["date_start"] for r in L.rows_on_date(rows, "2027-01-12")] == ["2027-01-09"]
    assert L.rows_on_date(rows, "2026-10-30") == []
    concerts = L.legacy_concerts([MATRIX["concert_paid"], MATRIX["paid_known"],
                                  pv(category="concert", price={"is_free": None})])
    assert [c["title"] for c in concerts] == ["Andrés Cepeda en Cartagena"]
    assert L.legacy_concert_genres(concerts) == ["Concierto"]
    assert L.legacy_dates(concerts) == ["2027-05-08"]


def test_end_to_end_from_stored_doc_through_public_view():
    """Stored city_events doc -> public_view (read-time truth) -> legacy row -> old UI."""
    stored = {
        "event_id": "ce-hay-festival-cartagena-de-indias-2027-20270128-8124",
        "title": {"es": "Hay Festival Cartagena de Indias 2027"}, "description": {"es": "Literatura e ideas."},
        "category": "festival", "edition_year": 2027,
        "start_date": "2027-01-28", "end_date": "2027-01-31", "start_time": None, "end_time": None,
        "venue_name": "Varios escenarios · Centro Histórico", "lat": None, "lng": None, "geocode_source": None,
        "price": {"is_free": None, "min_cop": None, "max_cop": None, "text": None},
        "ticket_url": None, "source_url": "https://www.hayfestival.com/cartagena/inicio",
        "source_name": "Hay Festival (organizador)",
        "evidence": [{"url": "https://www.hayfestival.com/cartagena/inicio", "name": "Hay Festival", "tier": 1,
                      "fetched_at": "2026-09-28T16:00:00Z", "http_status": 200,
                      "date_text": "se celebrará del 28 al 31 de enero del 2027"}],
        "last_verified": "2026-09-28T16:00:00Z", "country_check": "pass", "status": "published",
        "origin": "anchor", "sold_out": False, "parent_id": None, "is_umbrella": False,
    }
    view = G.public_view(stored, NOW, True)
    assert view["status"] == "published" and view["confidence"] == "HIGH" and view["notif_eligible"] is False
    row = L.to_legacy_event(view)
    assert row["booking_link"] == "https://www.hayfestival.com/cartagena/inicio" and row["featured"] is True
    assert "location" not in row and row["price"] is None and row["is_free"] is False
    r = render_event_detail(row)
    assert_clean(r, "e2e")
    assert r["cta"] == "Reservar" and r["price_row"] == "Consultar"
    # four days later with no re-verification: public_view decays to VERIFY -> legacy excluded upstream
    later = G.public_view(stored, NOW + timedelta(days=4), True)
    assert later["confidence"] == "VERIFY"
