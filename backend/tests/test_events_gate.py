"""EVENTS-ELITE core gate tests: country gate (real saved pages), verification gate (§4 +
§15 R), read-time public_view, identity helpers, geocoding, parsers/detectors, and the
async runtime reads against a stub DB. Pure: no network, no Mongo, never imports server.py.

Run: cd backend && python -m pytest -q tests/test_events_gate.py
"""
from __future__ import annotations

import asyncio
import copy
import gzip
import html as _html
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

import events_gate as G  # noqa: E402
import events_runtime as R  # noqa: E402

FIX = os.path.join(BACKEND, "tests", "fixtures", "events", "gate")
UTC = timezone.utc
NOW = datetime(2026, 9, 28, 17, 0, tzinfo=UTC)  # 12:00 Bogotá, Monday 28 Sep 2026


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


# ═════════════════════════════════════════════════════════════════════════════
# Country gate against REAL saved pages
# ═════════════════════════════════════════════════════════════════════════════

with open(os.path.join(FIX, "cases.json"), encoding="utf-8") as _f:
    MANIFEST = json.load(_f)
with open(os.path.join(FIX, "catalog_sample.json"), encoding="utf-8") as _f:
    CATALOG = json.load(_f)["rows"]
with open(os.path.join(FIX, "atrapalo_princess_story_extracted.json"), encoding="utf-8") as _f:
    ATRAPALO = json.load(_f)


def _page(name: Optional[str], encoding: str = "utf-8") -> str:
    if not name:
        return ""
    with gzip.open(os.path.join(FIX, "pages", name), "rb") as g:
        return g.read().decode(encoding, errors="replace")


def _ws(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("\xa0", " ")).strip()


def _visible(html: str) -> str:
    t = re.sub(r"<script\b.*?</script>|<style\b.*?</style>", " ", html, flags=re.S | re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    return _ws(_html.unescape(t))


def _jsonld_event(html: str) -> Optional[Dict[str, Any]]:
    for m in re.finditer(r"<script[^>]*application/ld\+json[^>]*>(.*?)</script>", html, re.S | re.I):
        try:
            data = json.loads(m.group(1), strict=False)
        except ValueError:
            continue
        nodes = data.get("@graph", [data]) if isinstance(data, dict) else data
        for n in nodes if isinstance(nodes, list) else []:
            if isinstance(n, dict) and "Event" in str(n.get("@type", "")):
                return n
    return None


def _ld_location(ev: Dict[str, Any]) -> Dict[str, Any]:
    loc = ev.get("location") or {}
    addr = loc.get("address") or {}
    out = {"name": loc.get("name")}
    if isinstance(addr, dict):
        for k in ("streetAddress", "addressLocality", "addressRegion", "addressCountry", "postalCode"):
            if addr.get(k):
                out[k] = addr[k]
    if isinstance(loc.get("geo"), (dict, list)):
        out["geo"] = loc["geo"]
    return {k: v for k, v in out.items() if v}


def _server_state(html: str) -> Dict[str, Any]:
    m = re.search(r'<script id="serverapp-state"[^>]*>(.*?)</script>', html, re.S)
    assert m, "serverapp-state missing"
    return json.loads(m.group(1))


def _candidate(case: Dict[str, Any]) -> Dict[str, Any]:
    """Build the gate input the way an adapter would, from the saved page only."""
    html = _page(case.get("page"), case.get("encoding", "utf-8"))
    c: Dict[str, Any] = {"source_url": case["source_url"], "page_text": html}
    if case.get("page_text_from") == "atrapalo:footer":
        c["page_text"] = ATRAPALO["footer"]
    et = case.get("event_text")
    if case.get("event_text_from") == "atrapalo:listing_card_text":
        et = ATRAPALO["listing_card_text"]
    elif case.get("event_text_from") == "atrapalo:detail_title":
        et = ATRAPALO["detail_title"]
    c["event_text"] = et
    if case.get("ld") == "auto":
        node = _jsonld_event(html)
        assert node, f"{case['id']}: no JSON-LD Event on the saved page"
        c["ld_location"] = _ld_location(node)
        m = re.search(r"([+-]\d{2}:?\d{2}|Z)$", str(node.get("startDate") or ""))
        if m:
            c["tz_offset"] = m.group(1)
    if case.get("ld_from") == "atrapalo":
        ev = next(n for n in ATRAPALO["jsonld"] if "Event" in n["type"])
        prod = next(n for n in ATRAPALO["jsonld"] if n["type"] == "Product")
        loc = ev["location"]
        c["ld_location"] = {"name": loc["name"], **loc["address"], "geo": loc["geo"]}
        c["tz_offset"] = re.search(r"([+-]\d{2}:\d{2})$", ev["startDate"]).group(1)
        c["currency"] = prod["priceCurrency"]
    if case.get("fever_plan_state"):
        plan = _server_state(html)["PlanService.getPlanDetail." + case["fever_plan_state"]]
        place = plan["places"][0]
        c.update(country_iso=plan["cityCountryIsoCode"], currency=plan["priceInfo"]["currency"],
                 venue_name=place["name"], address=place["address"],
                 lat=place["latitude"], lng=place["longitude"], geocode_source="source")
    if case.get("fever_city_state"):
        city = _server_state(html)["CityService.bySlugAndLanguage.cartagenaes"]
        c.update(country_iso=city["country"], currency=city["currency"])
    if case.get("venue_name"):
        c["venue_name"] = case["venue_name"]
    if case.get("geocode_catalog"):
        g = G.geocode(c.get("venue_name"), c.get("address"), CATALOG, [])
        if g:
            c.update(lat=g["lat"], lng=g["lng"], geocode_source=g["geocode_source"])
    return c


CASES = MANIFEST["cases"]


def test_fixture_set_covers_the_required_pages():
    ids = {c["id"] for c in CASES}
    for required in ("es_cartagena_agenda_listing", "fever_es_cartagena_city", "atrapalo_murcia_listing",
                     "hay_on_wye_winter_weekend", "cmf_bogota_launch_event_page",
                     "tuboleta_multicity_barranquilla_card",
                     "cmf_programacion_espana_en_la_balanza", "hay_cartagena_inicio", "ficci_home",
                     "latiquetera_andres_cepeda_cartagena", "tuboleta_de_la_risa_al_llanto_tam"):
        assert required in ids
    assert sum(c["expect"] == "fail" for c in CASES) >= 10
    assert sum(c["expect"] == "pass" for c in CASES) >= 6


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_event_text_is_verbatim_from_the_saved_page(case):
    """No invented inputs: every event_text is visible text of the real saved page."""
    if case.get("event_text_from", "").startswith("atrapalo:"):
        field = case["event_text_from"].split(":", 1)[1]
        assert ATRAPALO[field]
        return
    visible = _visible(_page(case["page"], case.get("encoding", "utf-8")))
    assert _ws(case["event_text"]) in visible, case["id"]


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_country_gate_on_real_pages(case):
    verdict, signals = G.country_check(_candidate(case))
    assert verdict == case["expect"], (case["id"], signals)
    for s in case.get("must_signals", []):
        assert s in signals, (case["id"], s, signals)
    if case["expect"] == "pass":
        assert not [s for s in signals if s.startswith("fail:")], signals


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_country_gate_same_verdict_on_tag_stripped_page_text(case):
    """Adapters may pass visible text (tags stripped) instead of raw HTML as page_text;
    the tag-fenced location regexes must give the same verdict either way."""
    c = _candidate(case)
    html = c["page_text"]
    c["page_text"] = _visible(html) + " " + " ".join(
        m.group(1) for m in re.finditer(r"<script[^>]*application/ld\+json[^>]*>(.*?)</script>", html, re.S | re.I))
    verdict, signals = G.country_check(c)
    assert verdict == case["expect"], (case["id"], signals)


def test_colombia_pages_have_no_page_level_spain_false_positive():
    """Chrome traps from the research: CMF 'España en la balanza', FICCI guest 'España',
    Fever CO multi-currency config ['EUR'], Hay 'localesetting=es-ES', TuBoleta city nav."""
    for name in ("cmf_programacion.html.gz", "ficci_home.html.gz", "fever_co_plan_642707.html.gz",
                 "hay_cartagena_inicio.html.gz", "tuboleta_de_la_risa_al_llanto.html.gz",
                 "latiquetera_andres_cepeda_cartagena.html.gz"):
        verdict, signals = G.country_check({"source_url": "https://example.com.co/x", "page_text": _page(name),
                                            "event_text": "Cartagena de Indias"})
        assert verdict == "pass", (name, signals)


# ── country gate unit rules ──────────────────────────────────────────────────

def _c(**kw) -> Dict[str, Any]:
    base = {"source_url": "https://latiquetera.com/event/x", "page_text": "", "event_text": ""}
    base.update(kw)
    return base


def test_geo_box_exclusion_and_placeholders():
    assert G.country_check(_c(lat=10.4266, lng=-75.5512))[0] == "pass"            # Heredia / TAM
    v, s = G.country_check(_c(lat=10.274, lng=-75.443, event_text="Cartagena de Indias"))
    assert v == "fail" and "fail:event:geo_outside_distrito" in s                  # Turbaná
    v, s = G.country_check(_c(lat=37.6095, lng=-0.97871))
    assert v == "fail" and "fail:event:geo_outside_distrito" in s                  # Cartagena, Spain
    for plat, plng in G.PLACEHOLDER_COORDS:
        v, s = G.country_check(_c(lat=plat + 0.0005, lng=plng - 0.0005))
        assert v == "fail" and "note:geo_placeholder_ignored" in s and "fail:no_positive" in s
    v, s = G.country_check(_c(lat=0, lng=0))
    assert "note:geo_null_island_ignored" in s and v == "fail"
    assert G.in_distrito(10.18, -75.58) and not G.in_distrito(10.30, -75.46)       # Barú yes, exclusion no
    assert G.is_placeholder_coord(10.4236, -75.5483) and not G.is_placeholder_coord(10.4266, -75.5512)
    assert not G.is_placeholder_coord(None, -75.5) and not G.is_placeholder_coord("x", 1)


def test_text_positives_need_event_scope_and_a_colombia_marker():
    assert G.country_check(_c(event_text="Teatro Heredia, Cartagena de Indias"))[0] == "pass"
    assert G.country_check(_c(event_text="Cartagena, Bolívar"))[0] == "pass"
    assert G.country_check(_c(event_text="Cartagena · COP 50.000"))[0] == "pass"
    assert G.country_check(_c(event_text="Cartagena", currency="COP"))[0] == "pass"
    assert G.country_check(_c(event_text="Info +57 300 000 0000 Cartagena"))[0] == "pass"
    # the bare '$ price' positive is REMOVED (§15 Q4)
    v, s = G.country_check(_c(event_text="Cartagena $50.000"))
    assert v == "fail" and "fail:no_positive" in s
    # page-level 'Cartagena de Indias' is NOT an event positive
    v, s = G.country_check(_c(page_text="<footer>Cartagena de Indias</footer>", event_text="Show"))
    assert v == "fail" and "fail:no_positive" in s


def test_event_scoped_other_city_and_cdi_exception():
    v, s = G.country_check(_c(event_text="Concierto · Barranquilla · 6 may"))
    assert v == "fail" and "fail:event:other_city:barranquilla" in s
    # a performer named after a city, the event explicitly in Cartagena de Indias
    v, s = G.country_check(_c(event_text="Orquesta Filarmónica de Bogotá en Cartagena de Indias"))
    assert v == "pass" and "note:other_city_excepted:bogota" in s
    # …but never when the structured locality names the other city
    v, s = G.country_check(_c(event_text="Cartagena de Indias tour", ld_location={"addressLocality": "Bogotá"}))
    assert v == "fail" and "fail:event:other_city:bogota" in s
    # near-Cartagena municipalities / Chile / Chairá are never excepted
    for txt, sig in (("Cartagena de Indias · Turbaco", "outside_distrito:turbaco"),
                     ("Cartagena de Indias, vía a Turbaná", "outside_distrito:turbana"),
                     ("Cartagena, Chile", "outside_distrito:chile"),
                     ("Cartagena del Chairá, Caquetá", "outside_distrito:chaira"),
                     ("Parque a 30 minutos de Cartagena", "distance_from_cartagena"),
                     ("Desde Cartagena en bus", "desde_cartagena"),
                     ("Entrada CLP 15.000 Cartagena", "clp")):
        v, s = G.country_check(_c(event_text=txt))
        assert v == "fail" and f"fail:event:{sig}" in s, (txt, s)
    # page chrome listing other cities never fails (event scope only)
    v, _ = G.country_check(_c(page_text="<nav>Barranquilla Bogotá Medellín Cali</nav>",
                              event_text="Teatro Adolfo Mejía, Cartagena de Indias"))
    assert v == "pass"


def test_cartagena_landmarks_containing_fail_words_are_not_fails():
    v, s = G.country_check(_c(event_text="Concierto en la Catedral de Santa Catalina de Alejandría, Cartagena de Indias"))
    assert v == "pass", s
    v, s = G.country_check(_c(event_text="Baluarte de Santa Catalina, Cartagena de Indias"))
    assert v == "pass", s


def test_structured_signals():
    assert "fail:event:tz_offset_foreign" in G.country_check(_c(event_text="Cartagena de Indias", tz_offset="+02:00"))[1]
    assert "fail:event:tz_offset_foreign" in G.country_check(_c(event_text="Cartagena de Indias", tz_offset="-03:00"))[1]
    for ok in ("-05:00", "-0500", "Z"):
        assert G.country_check(_c(event_text="Cartagena de Indias", tz_offset=ok))[0] == "pass"
    assert "fail:event:country_iso_es" in G.country_check(_c(event_text="Cartagena de Indias", country_iso="ES"))[1]
    assert G.country_check(_c(event_text="Cartagena", country_iso="CO"))[0] == "pass"
    assert "fail:event:currency_eur" in G.country_check(_c(event_text="Cartagena de Indias", currency="EUR"))[1]
    assert "fail:event:address_country_es" in G.country_check(
        _c(event_text="Cartagena de Indias", ld_location={"addressCountry": "España"}))[1]
    assert "fail:event:address_country_foreign" in G.country_check(
        _c(event_text="Cartagena de Indias", ld_location={"addressCountry": "CL"}))[1]


def test_page_level_spain_signals_and_url_rules():
    cases = {
        "page:es_domain": _c(source_url="https://turismo.cartagena.es/listado_agenda.asp", event_text="Cartagena de Indias"),
        "page:fever_spain_city": _c(source_url="https://feverup.com/en/cartagena", event_text="Cartagena de Indias"),
        "page:atrapalo_murcia": _c(source_url="https://www.atrapalo.com/entradas/murcia/cartagena/", event_text="Cartagena de Indias"),
        "page:euro": _c(page_text='"priceCurrency": "EUR"', event_text="Cartagena de Indias"),
        "page:phone_34": _c(page_text="Tel (+34) 968 12 88 00", event_text="Cartagena de Indias"),
        "page:murcia": _c(page_text="Región de Murcia", event_text="Cartagena de Indias"),
        "page:espana": _c(page_text="30201 Cartagena (España)", event_text="Cartagena de Indias"),
        "page:postcode_30x": _c(page_text="C/ San Miguel 8, 30201 Cartagena", event_text="Cartagena de Indias"),
        "page:europe_madrid": _c(page_text='"timezone":"Europe/Madrid"', event_text="Cartagena de Indias"),
        "page:tz_spain": _c(page_text='"startDate":"2026-10-17T18:30:00+02:00"', event_text="Cartagena de Indias"),
    }
    for sig, c in cases.items():
        v, s = G.country_check(c)
        assert v == "fail" and f"fail:{sig}" in s, (sig, s)
    # the Colombian Fever city page is fine
    assert G.country_check(_c(source_url="https://feverup.com/en/cartagena-colombia/", event_text="Cartagena de Indias"))[0] == "pass"
    # JSON-escaped and entity-escaped text is unescaped before matching
    assert "fail:page:espana" in G.country_check(_c(page_text="Cartagena (Espa&ntilde;a)", event_text="x"))[1]
    assert "pass:cartagena_de_indias" in G.country_check(_c(event_text="Cartagena de Indias, Bol\\u00edvar"))[1]


def test_hay_rule_only_on_hayfestival_and_tier1_scoping():
    v, s = G.country_check(_c(source_url="https://www.hayfestival.com/cartagena/inicio", event_text="Hay Festival Medellín"))
    assert v == "fail" and "fail:event:hay_edition:medellin" in s
    v, s = G.country_check(_c(source_url="https://www.hayfestival.com/m-222-cartagena-2026.aspx?pagenum=1",
                              event_text="Mario Mendoza en conversación"))
    assert v == "pass" and "pass:tier1_scoped:hayfestival.com" in s
    v, s = G.country_check(_c(source_url="https://www.hayfestival.com/arequipa/inicio", event_text="Hay Festival"))
    assert v == "fail" and "fail:event:hay_non_cartagena_path" in s
    assert "pass:tier1_scoped:ironman.com" in G.country_check(
        _c(source_url="https://www.ironman.com/im703-cartagena", event_text="IRONMAN 70.3"))[1]
    v, s = G.country_check(_c(source_url="https://www.ironman.com/im703-panama", event_text="IRONMAN 70.3"))
    assert v == "fail" and "fail:no_positive" in s
    assert G.country_check(_c(source_url="https://ipcc.gov.co/agenda", event_text="Preludio"))[0] == "pass"


# ═════════════════════════════════════════════════════════════════════════════
# Identity, domains, tiers
# ═════════════════════════════════════════════════════════════════════════════

def test_match_key_has_no_date_and_perf_suffix_only_on_request():
    k = G.match_key("Fragmentado — Cartagena", 2026, "The Clock Pub")
    assert k == "fragmentado cartagena|2026|the clock pub"
    assert G.match_key("FRAGMENTADO - CARTAGENA", "2026", "the clock pub") == k
    assert G.match_key("Fragmentado", 2026, "Pub", perf_date="2026-10-15").endswith("|20261015")
    with pytest.raises(ValueError):
        G.match_key("x", None, "y")
    with pytest.raises(ValueError):
        G.match_key("x", 2026, "y", perf_date="15/10/2026")


def test_event_id_contract():
    key = G.match_key("Hay Festival Cartagena de Indias", 2027, "Varios escenarios")
    eid = G.make_event_id("Hay Festival Cartagena de Indias 2027", key, start_date="2027-01-28")
    assert eid.startswith("ce-hay-festival-cartagena-de-indias-2027-20270128-")
    assert G.EVENT_ID_RE.match(eid) and len(eid) <= 80
    assert eid == G.make_event_id("Hay Festival Cartagena de Indias 2027", key, start_date="2027-01-28")  # stable
    tbc = G.make_event_id("Señorita Colombia: Coronación", "senorita|2026|x", tbc_year=2026, tbc_month=11)
    assert re.match(r"^ce-senorita-colombia-coronacion-202611tbc-[0-9a-f]{4}$", tbc)
    long_id = G.make_event_id("x" * 300, "k", start_date="2026-11-12")
    assert len(long_id) <= 80 and G.EVENT_ID_RE.match(long_id)
    assert G.slug("¡¡!!") == "evento"
    for bad in ({}, {"start_date": "2026/11/12"}, {"tbc_year": 2026, "tbc_month": 13}):
        with pytest.raises(ValueError):
            G.make_event_id("t", "k", **bad)
    assert not G.EVENT_ID_RE.match("evt_010") and not G.EVENT_ID_RE.match("pe_abc")


def test_registrable_domain_tiers_and_mirrors():
    assert G.registrable_domain("https://www.cartagena.gov.co/noticias/x") == "cartagena.gov.co"
    assert G.registrable_domain("https://special.checkout.tuboleta.com/list/events") == "tuboleta.com"
    assert G.registrable_domain("api.ticketshop.com.co") == "ticketshop.com.co"
    assert G.registrable_domain("https://www.eluniversal.com.co/a") == "eluniversal.com.co"
    assert G.registrable_domain("https://cultura.cartagena.es/agenda.asp") == "cartagena.es"
    assert G.registrable_domain("") is None
    assert G.domain_tier("https://ipcc.gov.co/x") == 1                       # IPCC is tier 1 (§15 R2)
    assert G.domain_tier("https://cartagenaplay.com/event/x", declared=1) == 6  # registry beats the adapter
    assert G.domain_tier("https://venue-unknown.co/agenda", declared=3) == 3
    assert G.domain_tier("https://venue-unknown.co/agenda") == 6
    assert G.domain_tier("https://eticket.com.co/eventos.aspx") is None      # denylisted spam domain
    assert G.mirror_group("https://ipcc.gov.co/a") == G.mirror_group("https://www.cartagena.gov.co/b")
    assert G.mirror_group("https://qhubocartagena.com/x") == G.mirror_group("https://www.eluniversal.com.co/y")
    assert G.mirror_group("https://latiquetera.com/x") != G.mirror_group("https://tuboleta.com/y")


# ═════════════════════════════════════════════════════════════════════════════
# Geocoding
# ═════════════════════════════════════════════════════════════════════════════

def test_geocode_catalog_then_gazetteer_never_placeholder():
    g = G.geocode("Teatro Adolfo Mejía", None, CATALOG, [])
    assert g == {"lat": 10.4266111, "lng": -75.5511837, "geocode_source": "catalog", "venue_id": "attr_015"}
    # The Clock Pub's catalog point is within 1e-3 of the Centro placeholder -> never geocoded
    assert G.geocode("The Clock Pub", None, CATALOG, []) is None
    gaz = [{"name": "Plaza de Toros de Cartagena", "lat": 10.4089, "lng": -75.5251, "source_url": "https://osm.org/x"}]
    g = G.geocode("PLAZA DE TOROS DE CARTAGENA", None, CATALOG, gaz)
    assert g and g["geocode_source"] == "gazetteer" and g["venue_id"] is None
    assert G.geocode("Varios escenarios · Centro Histórico", None, CATALOG, gaz) is None
    assert G.geocode("", None, CATALOG, gaz) is None
    assert G.geocode("Unknown Hall", None, CATALOG, gaz) is None
    placeholder_only = [{"name": "Centro", "lat": 10.4236, "lng": -75.5483}]
    assert G.geocode("Centro", None, [], placeholder_only) is None


def test_geocode_ambiguous_names_never_guess():
    rows = [{"partner_id": "a", "name": "Casa Azul", "location": {"lat": 10.42, "lng": -75.55}, "address": "Cra 1 #1-1 Getsemaní"},
            {"partner_id": "b", "name": "Casa Azul", "location": {"lat": 10.39, "lng": -75.49}, "address": "Av 2 Manga"}]
    assert G.geocode("Casa Azul", None, rows, []) is None
    g = G.geocode("Casa Azul", "Av 2 Manga", rows, [])
    assert g and g["venue_id"] == "b"
    assert G.venue_keys("Teatro Adolfo Mejía (Heredia)") == ["teatro adolfo mejia heredia", "teatro adolfo mejia"]


def test_ambiguous_gazetteer_venue_is_never_the_only_proof_of_cartagena():
    """A name every Colombian city has (Plaza de Bolívar) geocodes to OUR plaza, but that match
    and its coordinates never prove the event is here; another positive must (missed > wrong)."""
    gaz = [{"id": "plaza-de-bolivar-cartagena", "name": "Plaza de Bolívar", "aliases": ["Plaza de Bolivar"],
            "lat": 10.4232347, "lng": -75.5514, "ambiguous": True},
           {"id": "teatro-adolfo-mejia", "name": "Teatro Adolfo Mejía", "aliases": [],
            "lat": 10.4266111, "lng": -75.5511837, "ambiguous": False}]
    geo = G.geocode("Plaza de Bolívar", None, [], gaz)
    assert geo and geo["geocode_source"] == "gazetteer" and geo["venue_ambiguous"] is True
    base = {"source_url": "https://www.tuboleta.com/es/eventos/concierto-plaza", "page_text": "",
            "venue_name": "Plaza de Bolívar", "address": None, **geo}
    verdict, signals = G.country_check({**base, "event_text": "Concierto sinfónico | Sábado 7 de noviembre"})
    assert verdict == "fail" and "fail:no_positive" in signals
    assert "note:venue_ambiguous_not_positive" in signals and "pass:geo_in_distrito" not in signals
    verdict, signals = G.country_check({**base, "event_text": "Concierto sinfónico · Cartagena de Indias"})
    assert verdict == "pass" and "pass:cartagena_de_indias" in signals
    # A non-ambiguous gazetteer row still counts on its own.
    geo2 = G.geocode("Teatro Adolfo Mejía", None, [], gaz)
    assert geo2 and "venue_ambiguous" not in geo2
    verdict, signals = G.country_check({"source_url": "https://www.tuboleta.com/es/eventos/x", "page_text": "",
                                        "event_text": "Concierto", "venue_name": "Teatro Adolfo Mejía", **geo2})
    assert verdict == "pass" and "pass:venue_match:gazetteer" in signals


# ═════════════════════════════════════════════════════════════════════════════
# Parsers and detectors
# ═════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("text,hint,expected", [
    ("Del 9 al 17 de enero de 2027", None, ("2027-01-09", "2027-01-17", None)),
    ("del 28 al 31 de enero del 2027", None, ("2027-01-28", "2027-01-31", None)),
    ("6 – 11 ABRIL 2027", None, ("2027-04-06", "2027-04-11", None)),
    ("Jueves 12 de noviembre: Gran Desfile (Avenida Santander – 10:00 a.m. a 12:00 p.m.)", 2026,
     ("2026-11-12", "2026-11-12", "10:00")),
    ("15 Oct / 2026 Jue / 8:00 PM", None, ("2026-10-15", "2026-10-15", "20:00")),
    ("Jue, 15/10/2026 - 20:00", None, ("2026-10-15", "2026-10-15", "20:00")),
    ("enero 12, 2027 7:00 am", None, ("2027-01-12", "2027-01-12", "07:00")),
    ("Thursday 26 November 2026, 7.30pm – 9pm", None, ("2026-11-26", "2026-11-26", "19:30")),
    ("Sábado, 08 de mayo de 2027, 07:00 pm", None, ("2027-05-08", "2027-05-08", "19:00")),
    ("13 y 14 de noviembre", 2026, ("2026-11-13", "2026-11-14", None)),
    ("29/10/2026 - 15/11/2026", None, ("2026-10-29", "2026-11-15", None)),
    ("Del 28 de diciembre al 3 de enero de 2027", None, ("2026-12-28", "2027-01-03", None)),
    ("2027-05-08T19:00:00-05:00", None, ("2027-05-08", "2027-05-08", "19:00")),
    ("12 de noviembre · aforo 1500 personas", 2026, ("2026-11-12", "2026-11-12", None)),
])
def test_parse_date_text(text, hint, expected):
    r = G.parse_date_text(text, hint)
    assert r is not None and (r["start_date"], r["end_date"], r["start_time"]) == expected


def test_parse_date_candidates_reads_every_date_in_prose():
    ficci = ("El Festival Internacional de Cine de Cartagena de Indias (FICCI) abre el 31 de agosto la "
             "convocatoria oficial para su edición 66, que se celebrará del 6 al 11 de abril de 2027")
    cands = G.parse_date_candidates(ficci, 2027)
    assert [(c["start_date"], c["end_date"]) for c in cands] == [("2027-08-31", "2027-08-31"),
                                                                 ("2027-04-06", "2027-04-11")]
    # the same date repeated back to back is one mention and keeps its time
    assert G.parse_date_candidates("Concierto 17 October octubre 17, 2026 4:00 pm", 2026) == [
        {"start_date": "2026-10-17", "end_date": "2026-10-17", "start_time": "16:00"}]
    # each date gets the time that follows it, never the next date's time
    two = G.parse_date_candidates("Jueves 12 de noviembre 10:00 a.m. · Viernes 13 de noviembre 8:00 p.m.", 2026)
    assert [(c["start_date"], c["start_time"]) for c in two] == [("2026-11-12", "10:00"), ("2026-11-13", "20:00")]
    # a weekday that contradicts only drops that one candidate
    mixed = G.parse_date_candidates("Sábado 12 de noviembre · Viernes 13 de noviembre", 2026)
    assert [c["start_date"] for c in mixed] == ["2026-11-13"]


def test_parse_date_text_refuses_to_guess():
    assert G.parse_date_text("12 de noviembre", None) is None           # no year, no hint
    assert G.parse_date_text("Sábado 12 de noviembre de 2026") is None  # 12 Nov 2026 is a Thursday
    assert G.parse_date_text("Próximamente") is None
    assert G.parse_date_text("") is None and G.parse_date_text(None) is None


def test_clean_time_and_jsonld_placeholder():
    assert G.clean_time("07:00", visible_confirmed=False) is None       # TuBoleta JSON-LD placeholder
    assert G.clean_time("07:00", visible_confirmed=True) == "07:00"
    assert G.clean_time("01:00", visible_confirmed=False) is None       # CCC placeholder
    assert G.clean_time("20:00", visible_confirmed=False) == "20:00"
    assert G.clean_time("8pm", visible_confirmed=True) is None
    assert G.is_jsonld_placeholder_date("2026-09-28", "2026-09-28", "2026-09-28T15:00:00Z")
    assert not G.is_jsonld_placeholder_date("2026-10-15", "2026-10-15", "2026-09-28T15:00:00Z")
    # 03:00Z on the 29th is still the 28th in Bogotá
    assert G.is_jsonld_placeholder_date("2026-09-28", None, "2026-09-29T03:00:00Z")


def test_cancel_markers_event_scoped_with_boilerplate_denylist():
    assert G.find_cancel_marker("EVENTO CANCELADO") == "cancelado"
    assert G.find_cancel_marker("Race postponed due to weather") == "postponed"
    assert G.find_cancel_marker("Concierto reprogramado") == "reprogramado"
    assert G.find_cancel_marker("Si el evento es cancelado o aplazado se devolverá el dinero") is None
    assert G.find_cancel_marker("Ver eventos cancelados") is None
    assert G.find_cancel_marker("Política: reembolso si se suspende", boilerplate=["si se suspende"]) is None
    assert G.status_marker("AGOTADO") == "sold_out" and G.status_marker("Finalizado") == "finished"
    assert G.status_marker("Próximamente") is None


def test_challenge_detection_is_size_guarded():
    assert G.is_challenge(200, {}, "<title>Client Challenge</title>", "https://www.atrapalo.com/x")
    assert G.is_challenge(403, {"cf-mitigated": "challenge"}, "", "https://www.cartagena.gov.co/")
    assert G.is_challenge(200, {}, "", "https://special.checkout.tuboleta.com/cookieWarning")
    assert G.is_challenge(200, {}, "", "https://peak51.secutix.com/pkpcontroller/wp/x")
    # real CMF / La Tiquetera pages embed reCAPTCHA: a full page is NOT a challenge
    big = _page("cmf_programacion.html.gz")
    assert "captcha" in big.lower() and not G.is_challenge(200, {}, big, "https://cartagenamusicfestival.com/programacion/")
    assert G.classify_fetch(None, {}, "", "https://x.co") == "blocked"
    assert G.classify_fetch(404, {}, "", "https://x.co") == "gone"
    assert G.classify_fetch(410, {}, "", "https://x.co") == "gone"
    assert G.classify_fetch(429, {}, "", "https://x.co") == "blocked"
    assert G.classify_fetch(503, {}, "", "https://x.co") == "blocked"
    assert G.classify_fetch(200, {}, big, "https://latiquetera.com/", expected_token="andres-cepeda") == "gone"
    assert G.classify_fetch(200, {}, big, "https://latiquetera.com/event/andres-cepeda-en-cartagena",
                            expected_token="andres-cepeda") == "ok"


def test_is_free_only_unqualified_and_unpriced():
    assert G.detect_is_free("Entrada libre", [])
    assert G.detect_is_free("Evento gratis para todo el público")
    assert not G.detect_is_free("Niños menores de 3 años gratis", [])
    assert not G.detect_is_free("Parqueadero gratis", [])
    assert not G.detect_is_free("Entrada libre", [50000])
    assert not G.detect_is_free("Boletas desde $50.000", [])


def test_tbc_helpers():
    assert G.tbc_window_end(2026, 11) == "2026-11-30" and G.tbc_window_end(2026, 12) == "2026-12-31"
    assert G.tbc_window_end(2028, 2) == "2028-02-29"
    note = G.make_date_tbc_note(2026, 11)
    assert note["es"] == "Noviembre 2026 · fecha por confirmar" and set(note) == {"es", "en", "fr", "pt"}


# ═════════════════════════════════════════════════════════════════════════════
# Verification gate: evaluate()
# ═════════════════════════════════════════════════════════════════════════════

SRC = "https://tuboleta.com/es/eventos/de-la-risa-al-llanto"


def evd(url: str = SRC, date_text: Optional[str] = "29 Oct / 2026 Jue / 7:00 PM", *, tier: Optional[int] = 2,
        fetched: Optional[datetime] = None, status: Optional[int] = 200, **kw) -> Dict[str, Any]:
    e = {"url": url, "name": "src", "tier": tier, "fetched_at": iso(fetched or NOW - timedelta(hours=1)),
         "http_status": status, "date_text": date_text}
    e.update(kw)
    return e


def doc(**over) -> Dict[str, Any]:
    d: Dict[str, Any] = {
        "event_id": "ce-de-la-risa-al-llanto-20261029-ab12",
        "title": {"es": "De la risa al llanto"},
        "description": {"es": "Dos historias, dos mujeres."},
        "category": "cultural",
        "edition_year": 2026,
        "start_date": "2026-10-29", "end_date": "2026-10-29",
        "start_time": "19:00", "end_time": None, "time_confirmed": True,
        "venue_name": "Teatro Adolfo Mejía", "venue_id": "attr_015", "address": None, "zone": "centro",
        "lat": 10.4266111, "lng": -75.5511837, "geocode_source": "catalog",
        "price": {"is_free": None, "min_cop": 25000, "max_cop": 60000, "text": "Desde $25.000"},
        "ticket_url": SRC, "source_url": SRC, "source_name": "TuBoleta", "source_tier": 2,
        "second_source_name": None,
        "evidence": [evd()],
        "last_verified": iso(NOW - timedelta(hours=1)), "verified_by": "pipeline",
        "country_check": "pass", "country_signals": ["pass:venue_match:catalog"],
        "status": "published", "status_reason": None, "confidence": "HIGH",
        "origin": "pipeline", "sold_out": False, "parent_id": None, "is_umbrella": False,
        "image_url": "/images/events/risa.jpg", "image_credit": "TuBoleta",
    }
    d.update(over)
    return d


def ev(d: Dict[str, Any], now: datetime = NOW) -> Dict[str, Any]:
    out = G.evaluate(d, now)
    assert set(out) == {"status", "status_reason", "confidence", "notif_eligible"}
    return out


def test_baseline_is_published_high_and_notif_eligible():
    assert ev(doc()) == {"status": "published", "status_reason": None, "confidence": "HIGH", "notif_eligible": True}


def test_evaluate_is_pure():
    d = doc()
    before = copy.deepcopy(d)
    ev(d)
    assert d == before


def test_rule1_source_url_required():
    for bad in (None, "", "ftp://x.co/a", "javascript:alert(1)", "tuboleta.com/x", "https://eticket.com.co/x"):
        assert ev(doc(source_url=bad))["status"] == "drop"


def test_rule2_country_verdict_is_stored_and_fails_closed():
    assert ev(doc(country_check="fail")) == {"status": "hidden", "status_reason": "country_fail",
                                             "confidence": "VERIFY", "notif_eligible": False}
    r = ev(doc(country_check=None))
    assert (r["status"], r["status_reason"]) == ("review", "country_unchecked")
    r = ev(doc(country_check=None, status="hidden", status_reason="admin_hide"))
    assert (r["status"], r["status_reason"]) == ("hidden", "admin_hide")


@pytest.mark.parametrize("reason", ["admin_hide", "source_gone", "cancel_marker", "merged", "country_fail", "whatever"])
def test_rule3_every_hidden_is_sticky(reason):
    r = ev(doc(status="hidden", status_reason=reason))
    assert r == {"status": "hidden", "status_reason": reason, "confidence": "VERIFY", "notif_eligible": False}


@pytest.mark.parametrize("reason", sorted(G.STICKY_REVIEW_REASONS))
def test_rule3_sticky_review_reasons(reason):
    assert ev(doc(status="review", status_reason=reason))["status"] == "review"
    assert ev(doc(status="review", status_reason=reason))["status_reason"] == reason


def test_rule3_non_sticky_review_is_recomputed():
    assert ev(doc(status="review", status_reason="unverified"))["status"] == "published"
    assert ev(doc(status="expired", status_reason=None))["status"] == "published"


def test_rule4_date_tbc_and_window_expiry():
    tbc = doc(start_date=None, end_date=None, start_time=None, tbc_window_end="2026-11-30",
              date_tbc_note={"es": "Noviembre 2026 · fecha por confirmar"},
              evidence=[evd(date_text="Noviembre 2026 · fecha por confirmar", tier=1,
                            url="https://www.ipcc.gov.co/agenda")])
    assert ev(tbc) == {"status": "date_tbc", "status_reason": None, "confidence": "VERIFY", "notif_eligible": False}
    late = dict(tbc, last_verified=iso(datetime(2026, 11, 30, 12, tzinfo=UTC)))
    assert ev(late, datetime(2026, 12, 1, 12, tzinfo=UTC))["status"] == "expired"
    assert ev(late, datetime(2026, 12, 1, 4, tzinfo=UTC))["status"] == "date_tbc"   # still 30 Nov in Bogotá
    no_window = dict(tbc, tbc_window_end=None)
    assert (ev(no_window)["status"], ev(no_window)["status_reason"]) == ("review", "tbc_no_window")
    stale = dict(tbc, last_verified=iso(NOW - timedelta(days=11)))
    assert ev(stale)["status_reason"] == "stale_long"


def test_rule4b_long_span():
    long = doc(start_date="2026-10-02", end_date="2026-11-15")
    assert (ev(long)["status"], ev(long)["status_reason"]) == ("review", "long_span")
    assert ev(dict(long, is_umbrella=True))["status"] == "published"
    assert ev(dict(long, parent_id="ce-fiestas-independencia-2026-20261002-aaaa"))["status"] == "published"
    assert ev(doc(end_date="2026-11-19"))["status"] == "published"   # exactly 21 days


def test_rule4c_jsonld_start_eq_end_eq_fetch_day():
    fetch = datetime(2026, 9, 28, 15, 0, tzinfo=UTC)
    d = doc(start_date="2026-09-28", end_date="2026-09-28", start_time=None, time_confirmed=False,
            evidence=[evd(date_text="2026-09-28T07:00:00-0500", fetched=fetch, date_source="jsonld")])
    assert (ev(d)["status"], ev(d)["status_reason"]) == ("review", "placeholder_date")
    visible = dict(d, evidence=[evd(date_text="28 Sep / 2026 Lun", fetched=fetch)])
    assert ev(visible)["status"] == "published"


def test_rule5_expired_in_bogota_time():
    today = doc(start_date="2026-09-28", end_date="2026-09-28", start_time="19:00", end_time="22:00",
                evidence=[evd(date_text="28 Sep / 2026 Lun / 7:00 PM")])
    assert ev(today, datetime(2026, 9, 29, 2, 0, tzinfo=UTC))["status"] == "published"  # 21:00 Bogotá
    assert ev(today, datetime(2026, 9, 29, 3, 30, tzinfo=UTC))["status"] == "expired"   # 22:30 Bogotá
    no_end = dict(today, end_time=None)
    assert ev(no_end, datetime(2026, 9, 28, 23, 59, tzinfo=UTC))["status"] == "published"  # 18:59
    assert ev(no_end, datetime(2026, 9, 29, 0, 30, tzinfo=UTC))["status"] == "expired"     # 19:30
    overnight = dict(today, start_time="22:00", end_time="03:00",
                     evidence=[evd(date_text="28 Sep / 2026 Lun / 10:00 PM")])
    assert ev(overnight, datetime(2026, 9, 29, 4, 0, tzinfo=UTC))["status"] == "published"  # 23:00
    past = doc(start_date="2026-09-20", end_date="2026-09-27")
    assert ev(past)["status"] == "expired"
    ongoing = doc(start_date="2026-09-26", end_date="2026-09-29", start_time="19:00",
                  evidence=[evd(date_text="Del 26 al 29 de septiembre de 2026 · 7:00 p.m.")])
    assert ev(ongoing)["status"] == "published"
    untimed_today = dict(today, start_time=None, end_time=None, time_confirmed=False,
                         evidence=[evd(date_text="28 Sep / 2026 Lun")])
    assert ev(untimed_today, datetime(2026, 9, 29, 4, 59, tzinfo=UTC))["status"] == "published"


def test_rule6_high_requires_visible_tier_1_3_date_match():
    jsonld_only = doc(evidence=[evd(date_text="2026-10-29T07:00:00-0500", date_source="jsonld")])
    assert ev(jsonld_only)["confidence"] == "VERIFY"
    wrong_time = doc(evidence=[evd(date_text="29 Oct / 2026 Jue / 8:00 PM")])
    r = ev(wrong_time)
    assert r["confidence"] == "VERIFY" and r["status_reason"] == "time_conflict"
    untimed_text = doc(evidence=[evd(date_text="29 Oct / 2026 Jue")])
    assert ev(untimed_text)["confidence"] == "VERIFY"      # start_time set but not visible
    media_only = doc(source_url="https://www.eluniversal.com.co/a",
                     evidence=[evd(url="https://www.eluniversal.com.co/a", tier=5)])
    assert ev(media_only)["confidence"] == "VERIFY"
    explicit = doc(evidence=[evd(date_text="jueves 29", start_date="2026-10-29", start_time="19:00",
                                 date_visible=True)])
    assert ev(explicit)["confidence"] == "HIGH"
    # events_sources.make_candidate spells the flag `visible`
    assert ev(doc(evidence=[evd(visible=False)]))["confidence"] == "VERIFY"
    assert ev(doc(evidence=[evd(visible=True)]))["confidence"] == "HIGH"


def test_rule6_high_by_corroboration_and_mirrors_count_once():
    jl = evd(date_text="2026-10-29T19:00:00Z", date_source="jsonld")
    eu = evd(url="https://www.eluniversal.com.co/cultural/x", tier=5, date_text="jueves 29 de octubre")
    assert ev(doc(evidence=[jl, eu]))["confidence"] == "HIGH"                        # (b) tier-2 + tier-5
    eu2 = evd(url="https://qhubocartagena.com/x", tier=5, date_text="29 de octubre")
    assert ev(doc(source_url=eu["url"], evidence=[eu, eu2]))["confidence"] == "VERIFY"  # two tier-5 = VERIFY
    ipcc = evd(url="https://ipcc.gov.co/p/1", tier=1, date_text="2026-10-29", date_source="jsonld")
    alc = evd(url="https://www.cartagena.gov.co/n/1", tier=1, date_text="2026-10-29", date_source="jsonld")
    d = doc(source_url=ipcc["url"], evidence=[ipcc, alc])
    assert ev(d)["confidence"] == "VERIFY"                                           # mirrors = one source
    assert ev(dict(d, evidence=[ipcc, alc, eu]))["confidence"] == "HIGH"


def test_rule6_multi_date_prose_is_not_a_conflict_and_still_proves_the_date():
    ficci_art = evd(url="https://www.ficcifestival.com/articulos/ficci-66", tier=1,
                    date_text="abre el 31 de agosto la convocatoria oficial para su edición 66, que se "
                              "celebrará del 6 al 11 de abril de 2027")
    d = doc(source_url="https://www.ficcifestival.com/", ticket_url=None, edition_year=2027,
            start_date="2027-04-06", end_date="2027-04-11", start_time=None, time_confirmed=False,
            evidence=[ficci_art, evd(url="https://www.ficcifestival.com/", tier=1,
                                     date_text="Festival Internacional de Cine de Cartagena de Indias 6 – 11 ABRIL 2027")])
    assert ev(d) == {"status": "published", "status_reason": None, "confidence": "HIGH", "notif_eligible": False}


def test_rule6_por_confirmar_never_supports_high():
    """Official agenda row: 'Entrega de llaves … (Baluarte San Miguel – por confirmar)'."""
    row = "Lunes 9 de noviembre: Entrega de llaves a las candidatas del Concurso Nacional de Belleza (Baluarte San Miguel – por confirmar)."
    d = doc(start_date="2026-11-09", end_date="2026-11-09", start_time=None, time_confirmed=False,
            source_url="https://ipcc.gov.co/p/1",
            evidence=[evd(url="https://ipcc.gov.co/p/1", tier=1, date_text=row),
                      evd(url="https://www.eluniversal.com.co/x", tier=5, date_text=row)])
    assert ev(d) == {"status": "published", "status_reason": None, "confidence": "VERIFY", "notif_eligible": False}
    lt = evd(url="https://latiquetera.com/event/x", date_text="9 de noviembre de 2026 · hora por confirmar")
    tb = evd(url="https://tuboleta.com/es/eventos/x", date_text="09 Nov / 2026 Lun")
    assert not G.independent_agreement([lt, tb], "2026-11-09")


def test_rule6_only_newest_evidence_per_url_counts():
    """Andrés Cepeda moved 26 Sep -> 8 May 2027: an older fetch of the same URL with the
    old date must never keep (or restore) the old date as HIGH/published."""
    url = "https://latiquetera.com/event/andres-cepeda-en-cartagena"
    old = evd(url=url, date_text="Sábado, 26 de septiembre de 2026, 07:00 pm", fetched=NOW - timedelta(days=2))
    new = evd(url=url, date_text="Sábado, 08 de mayo de 2027, 07:00 pm", fetched=NOW - timedelta(hours=1))
    d = doc(source_url=url, ticket_url=url, start_date="2026-10-03", end_date="2026-10-03",
            evidence=[old, new])
    r = ev(d)
    assert r["status"] == "review" and r["status_reason"] == "conflict"
    moved = doc(source_url=url, ticket_url=url, start_date="2027-05-08", end_date="2027-05-08",
                evidence=[old, new])
    assert ev(moved)["confidence"] == "HIGH"


def test_rule6_decay_and_stale_long():
    assert ev(doc(last_verified=iso(NOW - timedelta(hours=71))))["confidence"] == "HIGH"
    r = ev(doc(last_verified=iso(NOW - timedelta(hours=73))))
    assert (r["status"], r["confidence"], r["status_reason"], r["notif_eligible"]) == ("published", "VERIFY", "stale", False)
    r = ev(doc(last_verified=iso(NOW - timedelta(days=10, hours=1))))
    assert (r["status"], r["status_reason"]) == ("review", "stale_long")
    r = ev(doc(last_verified=None))
    assert (r["status"], r["status_reason"]) == ("review", "unverified")


def test_rule6_sentinel_counters_and_caps():
    assert ev(doc(not_found_count=1))["confidence"] == "VERIFY"
    assert ev(doc(blocked_days=2))["confidence"] == "HIGH"
    assert ev(doc(blocked_days=3))["status_reason"] == "blocked"
    assert ev(doc(confidence_cap="VERIFY"))["confidence"] == "VERIFY"
    assert ev(doc(not_found_count=True))["confidence"] == "HIGH"      # bools are not counters
    # W1: HIGH only once a tier<=3 source fetched within 7 days of the event confirms it
    jlg = doc(recent_confirmation_days=7)
    assert ev(jlg)["status_reason"] == "awaiting_recent_confirmation"
    fresh = dict(jlg, evidence=[evd(fetched=datetime(2026, 10, 23, 15, tzinfo=UTC))],
                 last_verified=iso(datetime(2026, 10, 23, 15, tzinfo=UTC)))
    assert ev(fresh, datetime(2026, 10, 24, 12, tzinfo=UTC))["confidence"] == "HIGH"


def test_independent_agreement_clears_sticky_only_with_two_groups():
    lt = evd(url="https://latiquetera.com/event/andres-cepeda-en-cartagena", date_text="Sábado, 08 de mayo de 2027, 07:00 pm")
    tb = evd(url="https://tuboleta.com/es/eventos/andres-cepeda", date_text="08 May / 2027 Sáb / 7:00 PM")
    ipcc = evd(url="https://ipcc.gov.co/p/1", tier=1, date_text="8 de mayo de 2027")
    alc = evd(url="https://www.cartagena.gov.co/n/1", tier=1, date_text="8 de mayo de 2027")
    media = evd(url="https://www.eluniversal.com.co/x", tier=5, date_text="8 de mayo de 2027")
    assert G.independent_agreement([lt, tb], "2027-05-08", "19:00")
    assert not G.independent_agreement([lt, tb], "2027-05-08", "20:00")
    assert not G.independent_agreement([lt], "2027-05-08")
    assert not G.independent_agreement([ipcc, alc], "2027-05-08")        # mirrors = one source
    assert not G.independent_agreement([lt, media], "2027-05-08")        # tier 5 cannot clear
    assert G.independent_agreement([ipcc, lt], "2027-05-08")
    assert not G.independent_agreement([lt, dict(tb, http_status=404)], "2027-05-08")
    assert not G.independent_agreement([lt, tb], "not-a-date")


def test_rule7_partner_aggregator_conflict_no_evidence():
    p = doc(origin="partner", evidence=[], moderation_status="approved")
    assert ev(p) == {"status": "published", "status_reason": None, "confidence": "VERIFY", "notif_eligible": False}
    for mod in (None, "pending", "NEEDS_REVIEW", "rejected"):
        r = ev(dict(p, moderation_status=mod))
        assert (r["status"], r["status_reason"]) == ("review", "partner_pending")
    agg = doc(source_url="https://cartagenaplay.com/event/x",
              evidence=[evd(url="https://cartagenaplay.com/event/x", tier=6)])
    assert (ev(agg)["status"], ev(agg)["status_reason"]) == ("review", "aggregator_only")
    assert ev(doc(evidence=[]))["status_reason"] == "no_evidence"
    assert ev(doc(evidence=[evd(status=404)]))["status_reason"] == "no_evidence"
    # Cabildo de Getsemaní: 15 Nov (23 Sep PDF) vs 14 Nov (25 Sep article) -> review/conflict
    cab = doc(title={"es": "Cabildo de Getsemaní"}, source_url="https://ipcc.gov.co/p/agenda",
              start_date="2026-11-15", end_date="2026-11-15", start_time=None, time_confirmed=False,
              evidence=[evd(url="https://ipcc.gov.co/p/agenda", tier=1, date_text="Domingo 15 de noviembre"),
                        evd(url="https://www.cartagena.gov.co/noticias/agenda", tier=1, date_text="Sábado 14 de noviembre")])
    assert (ev(cab)["status"], ev(cab)["status_reason"]) == ("review", "conflict")
    # a partial date inside the event's range is not a conflict (Náutico 13-14, JLG on 13)
    nautico = doc(start_date="2026-11-13", end_date="2026-11-14", start_time=None, time_confirmed=False,
                  source_url="https://ipcc.gov.co/p/agenda",
                  evidence=[evd(url="https://ipcc.gov.co/p/agenda", tier=1, date_text="13 y 14 de noviembre"),
                            evd(url="https://www.eluniversal.com.co/x", tier=5, date_text="viernes 13 de noviembre")])
    assert ev(nautico) == {"status": "published", "status_reason": None, "confidence": "HIGH", "notif_eligible": False}


def test_rule8_notif_eligible_every_condition():
    assert ev(doc())["notif_eligible"] is True
    off = {
        "verify": dict(evidence=[evd(date_text="2026-10-29", date_source="jsonld")]),
        "geocode_source_source": dict(geocode_source="source"),
        "no_geocode": dict(geocode_source=None),
        "placeholder": dict(lat=10.4236, lng=-75.5483),
        "outside_box": dict(lat=10.30, lng=-75.46),
        "child": dict(parent_id="ce-fiestas-2026-20261002-aaaa"),
        "umbrella": dict(is_umbrella=True),
        "span_4_days": dict(end_date="2026-11-02"),
        "no_time": dict(start_time=None),
        "time_not_confirmed": dict(time_confirmed=False),
        "time_confirmed_truthy_not_true": dict(time_confirmed="yes"),
        "sold_out": dict(sold_out=True),
        "partner": dict(origin="partner", moderation_status="approved"),
    }
    for name, over in off.items():
        r = ev(doc(**over))
        assert r["notif_eligible"] is False, name
    assert ev(doc(sold_out=True))["status"] == "published"
    assert ev(doc(end_date="2026-11-01"))["notif_eligible"] is True                      # 3-day span ok
    started = doc(start_date="2026-09-28", end_date="2026-09-28", start_time="11:00",
                  evidence=[evd(date_text="28 Sep / 2026 Lun / 11:00 AM")])
    assert ev(started)["notif_eligible"] is False                                        # started at 11:00
    multi = doc(start_date="2026-09-27", end_date="2026-09-29", start_time="19:00",
                evidence=[evd(date_text="Del 27 al 29 de septiembre de 2026 7:00 p.m.")])
    assert ev(multi)["notif_eligible"] is True                                           # tonight 19:00
    assert ev(multi, datetime(2026, 9, 29, 0, 30, tzinfo=UTC))["notif_eligible"] is False  # 19:30 now


# ═════════════════════════════════════════════════════════════════════════════
# public_view (read-time truth)
# ═════════════════════════════════════════════════════════════════════════════

def test_public_view_fields_and_values():
    pv = G.public_view(doc(), NOW, True)
    assert set(pv) == set(G.PUBLIC_FIELDS)
    for internal in ("evidence", "canonical_key", "country_signals", "venue_id", "source_tier", "verified_by"):
        assert internal not in pv
    assert pv["is_verified"] is True and pv["notif_eligible"] is True and pv["status"] == "published"
    assert pv["lat"] == 10.4266111 and pv["price"] == {"is_free": None, "min_cop": 25000, "max_cop": 60000,
                                                       "text": "Desde $25.000"}
    assert pv["origin"] == "pipeline" and pv["is_umbrella"] is False and pv["status_reason"] is None


def test_public_view_sentinel_unhealthy_serves_verify():
    pv = G.public_view(doc(), NOW, False)
    assert (pv["confidence"], pv["is_verified"], pv["notif_eligible"], pv["status_reason"]) == \
        ("VERIFY", False, False, "sentinel_unhealthy")


def test_public_view_hidden_and_review_rows_expose_no_dates():
    for over in (dict(status="hidden", status_reason="cancel_marker"),
                 dict(status="review", status_reason="date_changed")):
        pv = G.public_view(doc(**over), NOW, True)
        assert pv["status"] == over["status"] and pv["status_reason"] == over["status_reason"]
        for k in ("start_date", "end_date", "start_time", "end_time", "ticket_url", "date_tbc_note"):
            assert pv[k] is None, k
        assert pv["notif_eligible"] is False and pv["is_verified"] is False
    exp = G.public_view(doc(start_date="2026-09-01", end_date="2026-09-01"), NOW, True)
    assert exp["status"] == "expired" and exp["start_date"] == "2026-09-01"
    assert G.public_view(doc(source_url=None), NOW, True) is None


def test_public_view_sanitizes_display_fields():
    pv = G.public_view(doc(is_umbrella=True, ticket_url="javascript:alert(1)", image_url="https://cdn.x/y.jpg",
                           price={"is_free": True, "min_cop": 50000.4, "max_cop": "nan", "text": ""},
                           category="rave", title="Solo es"), NOW, True)
    assert pv["lat"] is None and pv["lng"] is None                      # umbrellas are never pinned
    assert pv["ticket_url"] is None and pv["image_url"] is None and pv["image_credit"] is None
    assert pv["price"] == {"is_free": False, "min_cop": 50000, "max_cop": None, "text": None}
    assert pv["category"] == "cultural" and pv["title"] == {"es": "Solo es"}
    assert G.public_view(doc(lat=10.4236, lng=-75.5483), NOW, True)["lat"] is None


def test_public_sort_key_nulls_last():
    rows = [{"start_date": None, "start_time": None}, {"start_date": "2026-10-02", "start_time": None},
            {"start_date": "2026-10-02", "start_time": "18:00"}, {"start_date": "2026-10-01", "start_time": "21:00"}]
    rows.sort(key=G.public_sort_key)
    assert [(r["start_date"], r["start_time"]) for r in rows] == [
        ("2026-10-01", "21:00"), ("2026-10-02", "18:00"), ("2026-10-02", None), (None, None)]


# ═════════════════════════════════════════════════════════════════════════════
# events_runtime against a stub Motor DB
# ═════════════════════════════════════════════════════════════════════════════

def _get(d: Dict[str, Any], k: str) -> Any:
    return d.get(k)


def _match(doc_: Dict[str, Any], q: Dict[str, Any]) -> bool:
    for k, cond in q.items():
        if k == "$and":
            if not all(_match(doc_, sub) for sub in cond):
                return False
        elif k == "$or":
            if not any(_match(doc_, sub) for sub in cond):
                return False
        else:
            v = _get(doc_, k)
            if isinstance(cond, dict):
                for op, arg in cond.items():
                    if op == "$in" and v not in arg:
                        return False
                    if op == "$gte" and (v is None or v < arg):
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

    def sort(self, key, direction=1):
        self.rows.sort(key=lambda r: (r.get(key) is not None, r.get(key) or ""), reverse=direction < 0)
        return self

    def limit(self, n):
        self.rows = self.rows[:n]
        return self

    async def to_list(self, length=None):
        return [dict(r) for r in self.rows][: length or None]


class _Coll:
    def __init__(self, rows=None, fail=False):
        self.rows = list(rows or [])
        self.fail = fail
        self.queries: List[Dict[str, Any]] = []

    def find(self, query=None, projection=None):
        if self.fail:
            raise RuntimeError("boom")
        self.queries.append(query or {})
        return _Cursor([r for r in self.rows if _match(r, query or {})])

    async def find_one(self, query=None, projection=None, sort=None):
        if self.fail:
            raise RuntimeError("boom")
        self.queries.append(query or {})
        hits = [r for r in self.rows if _match(r, query or {})]
        if sort:
            k, d = sort[0]
            hits.sort(key=lambda r: r.get(k) or "", reverse=d < 0)
        return dict(hits[0]) if hits else None


class _DB:
    def __init__(self, events=None, flags=None, runs=None, fail=()):
        self.city_events = _Coll(events, "events" in fail)
        self.city_events_state = _Coll([flags] if flags else [], "state" in fail)
        self.city_events_runs = _Coll(runs, "runs" in fail)


def run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _fresh_runtime_caches():
    R.invalidate_caches()
    yield
    R.invalidate_caches()


FLAGS_ON = {"_id": "flags", "enabled": True, "sources_disabled": ["fever_co"]}
HEALTHY = [{"kind": "sentinel", "done": True, "finished_at": iso(NOW - timedelta(hours=5))}]


def test_get_flags_fail_closed_and_cached():
    assert run(R.get_flags(_DB())) == {"enabled": False, "sources_disabled": []}
    R.invalidate_caches()
    assert run(R.get_flags(_DB(fail=("state",)))) == {"enabled": False, "sources_disabled": []}
    R.invalidate_caches()
    db = _DB(flags=dict(FLAGS_ON))
    assert run(R.get_flags(db)) == {"enabled": True, "sources_disabled": ["fever_co"]}
    db.city_events_state.rows[0]["enabled"] = False
    assert run(R.get_flags(db))["enabled"] is True        # 30 s instance cache
    R.invalidate_caches()
    assert run(R.get_flags(db))["enabled"] is False
    R.invalidate_caches()
    assert run(R.get_flags(_DB(flags={"_id": "flags", "enabled": "true"})))["enabled"] is False  # strict bool


def test_sentinel_healthy_watchdog_26h():
    assert run(R.sentinel_healthy(_DB(), NOW)) is False
    R.invalidate_caches()
    assert run(R.sentinel_healthy(_DB(runs=HEALTHY), NOW)) is True
    R.invalidate_caches()
    old = [{"kind": "sentinel", "done": True, "finished_at": iso(NOW - timedelta(hours=27))}]
    assert run(R.sentinel_healthy(_DB(runs=old), NOW)) is False
    R.invalidate_caches()
    not_done = [{"kind": "sentinel", "done": False, "finished_at": iso(NOW - timedelta(hours=1))}]
    assert run(R.sentinel_healthy(_DB(runs=not_done), NOW)) is False
    R.invalidate_caches()
    pull_only = [{"kind": "pull", "done": True, "finished_at": iso(NOW - timedelta(hours=1))}]
    assert run(R.sentinel_healthy(_DB(runs=pull_only), NOW)) is False
    R.invalidate_caches()
    assert run(R.sentinel_healthy(_DB(fail=("runs",)), NOW)) is False
    R.invalidate_caches()
    skew = [{"kind": "sentinel", "done": True, "finished_at": iso(NOW + timedelta(minutes=2))}]
    assert run(R.sentinel_healthy(_DB(runs=skew), NOW)) is True
    R.invalidate_caches()
    future = [{"kind": "sentinel", "done": True, "finished_at": iso(NOW + timedelta(hours=3))}]
    assert run(R.sentinel_healthy(_DB(runs=future), NOW)) is False
    R.invalidate_caches()
    bson_dt = [{"kind": "sentinel", "done": True, "finished_at_dt": (NOW - timedelta(hours=1)).replace(tzinfo=None)}]
    assert run(R.sentinel_healthy(_DB(runs=bson_dt), NOW)) is True     # Motor returns naive UTC
    R.invalidate_caches()
    newest_wins = [{"kind": "sentinel", "done": True, "finished_at": iso(NOW - timedelta(hours=40))},
                   {"kind": "sentinel", "done": True, "finished_at": iso(NOW - timedelta(hours=2))}]
    assert run(R.sentinel_healthy(_DB(runs=newest_wins), NOW)) is True


def _feed_docs() -> List[Dict[str, Any]]:
    tbc = doc(event_id="ce-senorita-colombia-202611tbc-aaaa", start_date=None, end_date=None, start_time=None,
              status="date_tbc", tbc_window_end="2026-11-30", time_confirmed=False,
              evidence=[evd(url="https://ipcc.gov.co/p/1", tier=1, date_text="Noviembre 2026")],
              source_url="https://ipcc.gov.co/p/1")
    later = doc(event_id="ce-b-20261030-bbbb", start_date="2026-10-30", end_date="2026-10-30", start_time=None,
                time_confirmed=False, evidence=[evd(date_text="30 Oct / 2026 Vie")])
    early_evening = doc(event_id="ce-a-20261029-aaaa")
    early_morning = doc(event_id="ce-c-20261029-cccc", start_time="09:00",
                        evidence=[evd(date_text="29 Oct / 2026 Jue / 9:00 AM")])
    verify = doc(event_id="ce-v-20261031-vvvv", start_date="2026-10-31", end_date="2026-10-31",
                 evidence=[evd(date_text="2026-10-31", date_source="jsonld")])
    umbrella = doc(event_id="ce-fiestas-20261002-uuuu", start_date="2026-10-02", end_date="2026-11-15",
                   is_umbrella=True, start_time=None, time_confirmed=False,
                   evidence=[evd(date_text="Del 2 de octubre al 15 de noviembre de 2026")])
    hidden = doc(event_id="ce-h-20261029-hhhh", status="hidden", status_reason="cancel_marker")
    past = doc(event_id="ce-p-20260901-pppp", start_date="2026-09-01", end_date="2026-09-01")
    stored_published_now_stale = doc(event_id="ce-s-20261029-ssss", last_verified=iso(NOW - timedelta(days=12)))
    return [tbc, later, early_evening, early_morning, verify, umbrella, hidden, past, stored_published_now_stale]


def test_public_rows_kill_switch():
    assert run(R.public_rows(_DB(events=_feed_docs(), runs=HEALTHY), now=NOW)) == []
    R.invalidate_caches()
    db = _DB(events=_feed_docs(), runs=HEALTHY, flags={"_id": "flags", "enabled": False})
    assert run(R.public_rows(db, now=NOW)) == []
    assert db.city_events.queries == []                       # disabled -> no event read at all


def test_public_rows_feed_filters_and_sorts():
    db = _DB(events=_feed_docs(), flags=dict(FLAGS_ON), runs=HEALTHY)
    rows = run(R.public_rows(db, now=NOW))
    ids = [r["event_id"] for r in rows]
    assert ids == ["ce-fiestas-20261002-uuuu", "ce-c-20261029-cccc", "ce-a-20261029-aaaa",
                   "ce-b-20261030-bbbb", "ce-v-20261031-vvvv", "ce-senorita-colombia-202611tbc-aaaa"]
    q = db.city_events.queries[0]
    assert q["status"] == {"$in": ["date_tbc", "published"]}
    assert {"status": "date_tbc"} in q["$or"] and {"end_date": {"$gte": "2026-09-28"}} in q["$or"]
    by = {r["event_id"]: r for r in rows}
    assert by["ce-v-20261031-vvvv"]["confidence"] == "VERIFY"
    assert by["ce-senorita-colombia-202611tbc-aaaa"]["status"] == "date_tbc"
    high = run(R.public_rows(db, min_confidence="HIGH", now=NOW))
    assert "ce-v-20261031-vvvv" not in [r["event_id"] for r in high]
    assert len(run(R.public_rows(db, limit=2, now=NOW))) == 2


def test_public_rows_legacy_is_high_published_non_umbrella_only():
    db = _DB(events=_feed_docs(), flags=dict(FLAGS_ON), runs=HEALTHY)
    rows = run(R.public_rows(db, legacy=True, now=NOW))
    assert [r["event_id"] for r in rows] == ["ce-c-20261029-cccc", "ce-a-20261029-aaaa", "ce-b-20261030-bbbb"]
    assert all(r["confidence"] == "HIGH" and r["status"] == "published" and not r["is_umbrella"] for r in rows)
    R.invalidate_caches()
    unhealthy = _DB(events=_feed_docs(), flags=dict(FLAGS_ON), runs=[])
    assert run(R.public_rows(unhealthy, legacy=True, now=NOW)) == []          # watchdog: legacy goes empty
    feed = run(R.public_rows(unhealthy, now=NOW))
    assert feed and all(r["confidence"] == "VERIFY" and not r["notif_eligible"] for r in feed)


def test_public_rows_db_error_is_empty_and_extra_query_is_anded():
    db = _DB(events=_feed_docs(), flags=dict(FLAGS_ON), runs=HEALTHY, fail=("events",))
    assert run(R.public_rows(db, now=NOW)) == []
    R.invalidate_caches()
    db = _DB(events=_feed_docs(), flags=dict(FLAGS_ON), runs=HEALTHY)
    rows = run(R.public_rows(db, extra_query={"category": "cultural", "event_id": "ce-a-20261029-aaaa"}, now=NOW))
    assert [r["event_id"] for r in rows] == ["ce-a-20261029-aaaa"]
    assert "$and" in db.city_events.queries[-1]


def test_resolve_event_by_id_and_alias_only_ce_ids():
    rows = [doc(event_id="ce-a-20261029-aaaa", aliases=["ce-a-20261029-zzzz"])]
    db = _DB(events=rows, flags=dict(FLAGS_ON), runs=HEALTHY)
    assert run(R.resolve_event(db, "ce-a-20261029-aaaa"))["event_id"] == "ce-a-20261029-aaaa"
    assert run(R.resolve_event(db, "ce-a-20261029-zzzz"))["event_id"] == "ce-a-20261029-aaaa"
    n = len(db.city_events.queries)
    for legacy in ("evt_010", "con_001", "festival-internacional-musica-cartagena-2027", "", None, "ce-" + "a" * 90):
        assert run(R.resolve_event(db, legacy)) is None
    assert len(db.city_events.queries) == n                  # legacy ids never hit the DB
    assert run(R.resolve_event(_DB(fail=("events",)), "ce-a-20261029-aaaa")) is None


def test_public_item_and_legacy_item():
    rows = [doc(event_id="ce-a-20261029-aaaa"),
            doc(event_id="ce-h-20261029-hhhh", status="hidden", status_reason="source_gone"),
            doc(event_id="ce-v-20261031-vvvv", evidence=[evd(date_text="2026-10-29", date_source="jsonld")])]
    db = _DB(events=rows, flags=dict(FLAGS_ON), runs=HEALTHY)
    hidden = run(R.public_item(db, "ce-h-20261029-hhhh", now=NOW))
    assert hidden["status"] == "hidden" and hidden["start_date"] is None and hidden["status_reason"] == "source_gone"
    assert run(R.legacy_item(db, "ce-h-20261029-hhhh", now=NOW)) is None
    assert run(R.legacy_item(db, "ce-v-20261031-vvvv", now=NOW)) is None      # VERIFY never reaches old clients
    assert run(R.legacy_item(db, "ce-a-20261029-aaaa", now=NOW))["event_id"] == "ce-a-20261029-aaaa"
    R.invalidate_caches()
    off = _DB(events=rows, flags={"_id": "flags", "enabled": False}, runs=HEALTHY)
    assert run(R.public_item(off, "ce-a-20261029-aaaa", now=NOW)) is None
