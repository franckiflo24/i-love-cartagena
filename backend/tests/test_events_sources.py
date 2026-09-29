"""EVENTS-ELITE source adapters (backend/events_sources.py) — DESIGN.md §5, §13 F1/F2, §15 S1-S3.

Pure tests: no network, no Mongo. Every adapter parses a REAL saved page (trimmed) from
tests/fixtures/events/sources/; transport behaviour (redirects, walls, timeouts, rechecks) runs
through httpx.MockTransport.

Run:  cd backend && <venv>/bin/python -m pytest -q tests/test_events_sources.py
"""
from __future__ import annotations

import asyncio
import re
import json
import os
import sys
from datetime import date, datetime, timezone
from typing import Any, Callable, Optional

import httpx
import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

import events_sources as S  # noqa: E402

FIX = os.path.join(BACKEND, "tests", "fixtures", "events", "sources")
NOW = datetime(2026, 9, 28, 20, 0, tzinfo=timezone.utc)  # 15:00 Bogotá, the research day
TODAY = date(2026, 9, 28)


def rd(name: str) -> str:
    with open(os.path.join(FIX, name), encoding="utf-8") as f:
        return f.read()


def meta(url: str, final: Optional[str] = None, status: int = 200) -> dict[str, Any]:
    return {"url": url, "final_url": final or url, "fetched_at": "2026-09-28T20:00:00Z", "http_status": status}


def run(coro: Any) -> Any:
    return asyncio.run(coro)


def must(x: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Narrow an Optional parse result (fails the test with a clear message when None)."""
    assert x is not None, "parser returned None"
    return x


def by_title(cands: list[dict[str, Any]], needle: str) -> dict[str, Any]:
    hits = [c for c in cands if needle.lower() in c["title"]["es"].lower()]
    assert hits, f"no candidate titled ~{needle!r} in {[c['title']['es'] for c in cands]}"
    return hits[0]


# ═══ registry ════════════════════════════════════════════════════════════════════════════════
def test_registry_order_and_fields() -> None:
    keys = [e["key"] for e in S.SOURCES]
    assert keys == ["cmf", "hay", "ficci", "ironman", "ipcc", "latiquetera", "tuboleta", "ticketshop",
                    "fever_co", "cccartagena", "eluniversal", "cartagenaplay"]
    required = {"key", "name", "tier", "domain", "scope", "min_gap_s", "cookie_jar", "max_items_per_call",
                "recheck", "enabled", "tz_policy", "adapter", "role"}
    for e in S.SOURCES:
        assert required <= set(e), e["key"]
        assert e["adapter"].key == e["key"] and e["adapter"].entry is e
        assert e["min_gap_s"] >= 1.0
    tiers = {e["key"]: e["tier"] for e in S.SOURCES}
    assert tiers["ipcc"] == 1 and tiers["cccartagena"] == 3 and tiers["eluniversal"] == 5 and tiers["cartagenaplay"] == 6
    assert S.SOURCES_BY_KEY["cartagenaplay"]["role"] == "review"
    assert S.SOURCES_BY_KEY["eluniversal"]["role"] == "corroborate" and S.SOURCES_BY_KEY["eluniversal"]["llm_text_ok"] is False
    assert S.SOURCES_BY_KEY["tuboleta"]["cookie_jar"] is True
    assert S.HOST_MIN_GAP_S[S.politeness_key("https://special.checkout.tuboleta.com/list/events")] == 6.0
    assert S.politeness_key("https://teatros.checkout.tuboleta.com/x") == S.politeness_key("https://special.checkout.tuboleta.com/y")
    json.dumps(S.public_sources())  # JSON-safe without the adapter objects
    assert S.UA.startswith("AMOLifeBot/1.0")


# ═══ CMF ═════════════════════════════════════════════════════════════════════════════════════
def test_cmf_home_newest_edition() -> None:
    cands, skips = S.parse_cmf_home(rd("cmf_home.html"), meta("https://cartagenamusicfestival.com/"))
    assert skips == [] and len(cands) == 1
    c = cands[0]
    assert (c["start_date"], c["end_date"], c["start_time"]) == ("2027-01-09", "2027-01-17", None)
    assert c["source_keys"] == ["cmf:festival-2027"] and c["edition_year"] == 2027
    assert c["title"]["es"] == "Cartagena Festival de Música 2027" and c["category"] == "festival"
    assert c["evidence"][0]["date_text"] == "Del 9 al 17 de enero de 2027" and c["evidence"][0]["visible"] is True
    assert c["event_text"].startswith("Del 9 al 17 de enero de 2027") and c["is_umbrella_hint"] is True
    assert c["source_tier"] == 1 and c["source_key"] == "cmf" and c["evidence"][0]["tier"] == 1


def test_cmf_edition_selection_ignores_older_editions() -> None:
    real = rd("cmf_home.html")
    older = real.replace("</body>", "<p>Del 7 al 15 de enero de 2026, la XX edición.</p></body>")
    cands, _ = S.parse_cmf_home(older, meta("https://cartagenamusicfestival.com/"))
    assert (cands[0]["start_date"], cands[0]["end_date"]) == ("2027-01-09", "2027-01-17")
    eds = [{"start": "2027-01-09", "end": "2027-01-17", "year": 2027}, {"start": "2027-01-10", "end": "2027-01-18", "year": 2027}]
    assert S.select_newest_edition(eds) == (None, "edition_dates_disagree")
    assert S.select_newest_edition([]) == (None, "no_edition_text")


def test_cmf_programme_and_show_pages() -> None:
    rows = S.parse_cmf_programme(rd("cmf_programacion.html"))
    assert len(rows) == 9
    assert [r["title"] for r in rows if r["private"]] == [
        "Casa Gabo: La noche de El coronel no tiene quien le escriba", "Casa Gabo: La noche de Cien Años de Soledad"]
    by_slug = {r["show_url"].rstrip("/").rsplit("/", 1)[-1]: r for r in rows}

    u = "https://cartagenamusicfestival.com/show-item/fuego-y-geometria/"
    c, why = S.parse_cmf_show(rd("cmf_show_fuego-y-geometria.html"), meta(u), by_slug["fuego-y-geometria"], 2027)
    assert why is None
    assert (c["start_date"], c["start_time"], c["time_confirmed"]) == ("2027-01-09", "19:00", True)
    assert c["venue_name"] == "Teatro Adolfo Mejía" and c["parent_source_key"] == "cmf:festival-2027"
    assert c["source_keys"] == ["cmf:show:fuego-y-geometria"] and c["evidence"][0]["date_text"].startswith("Sábado 9 de enero de 2027")

    # The launch concert is on the Cartagena festival site but in BOGOTÁ: emitted with an event_text
    # that names Bogotá so the country gate (event-scoped rule) rejects it.
    u = "https://cartagenamusicfestival.com/show-item/concierto-de-lanzamiento/"
    c, _ = S.parse_cmf_show(rd("cmf_show_concierto-de-lanzamiento.html"), meta(u), by_slug["concierto-de-lanzamiento"], 2027)
    assert c["start_date"] == "2026-10-17" and c["start_time"] == "16:00"
    assert "Bogotá" in c["event_text"] and "León de Greiff" in c["venue_name"]

    u = "https://cartagenamusicfestival.com/show-item/transmision-concierto-inaugural/"
    c, _ = S.parse_cmf_show(rd("cmf_show_transmision-concierto-inaugural.html"), meta(u), None, 2027)
    assert "broadcast" in c["flags"] and c["start_date"] == "2027-01-16"


def test_cmf_time_disagreement_nulls_time() -> None:
    row = {"title": "El milagro de la voz", "subtitle": "7:00 a.m. | Teatro Adolfo Mejía", "time": "07:00", "tc_url": None}
    u = "https://cartagenamusicfestival.com/show-item/el-milagro-de-la-voz/"
    c, _ = S.parse_cmf_show(rd("cmf_show_el-milagro-de-la-voz.html"), meta(u), row, 2027)
    assert c["start_date"] == "2027-01-12" and c["start_time"] is None and c["time_confirmed"] is False
    assert "time_disagree" in c["flags"]


# ═══ Hay ═════════════════════════════════════════════════════════════════════════════════════
def test_hay_inicio_and_cartagena_only_programmes() -> None:
    cands, _ = S.parse_hay_inicio(rd("hay_inicio.html"), meta("https://www.hayfestival.com/cartagena/inicio"))
    c = cands[0]
    assert (c["start_date"], c["end_date"]) == ("2027-01-28", "2027-01-31")
    assert c["evidence"][0]["date_text"] == "del 28 al 31 de enero del 2027"
    assert c["title"]["es"] == "Hay Festival Cartagena de Indias 2027" and "Cartagena de Indias" in c["event_text"]
    assert "Medellín" not in c["event_text"]  # the nav's Medellín39 banner is page chrome, not the event
    links = S.hay_programme_links(rd("hay_inicio.html"))
    assert [y for _, y in links] == [2026] and all("-cartagena-" in u for u, _ in links)  # m-234 'presenta' ignored
    assert S._hay_is_cartagena_url("https://www.hayfestival.com/cartagena/inicio")
    assert not S._hay_is_cartagena_url("https://www.hayfestival.com/m-236-arequipa-2026.aspx")


def test_hay_listing_times_and_markers() -> None:
    items, _ = S.parse_hay_listing(rd("hay_m222_cartagena_2026.html"), meta("https://www.hayfestival.com/m-222-cartagena-2026.aspx"),
                                   programme_year=2026)
    c = by_title(items, "Diego Luna")
    assert (c["start_date"], c["start_time"], c["time_confirmed"]) == ("2026-01-29", "12:00", True)
    assert c["markers"]["finished"] is True and c["detail_url"].startswith("https://www.hayfestival.com/p-24596-")
    assert c["source_url"] == "https://www.hayfestival.com/m-222-cartagena-2026.aspx" == c["evidence"][0]["url"]  # the page we fetched
    assert c["venue_name"] == "Teatro Adolfo Mejía" and c["parent_source_key"] == "hay:festival-2026"
    winter, _ = S.parse_hay_listing(rd("hay_m245_winter_weekend_2026.html"), meta("https://www.hayfestival.com/m-245-winter-weekend-2026.aspx"))
    sold = [w for w in winter if w["sold_out"]]
    free = [w for w in winter if w["price"]["is_free"] is True]
    assert len(sold) == 1 and sold[0]["markers"]["sold_out"] is True
    assert len(free) == 1 and free[0]["start_time"] == "17:35"


def test_hay_detail_page() -> None:
    u = "https://www.hayfestival.com/p-24610-mario-mendoza-in-conversation-with-ana-maria-parra.aspx"
    c = S.parse_hay_detail(rd("hay_p24610.html"), meta(u))
    assert c["start_date"] == "2026-01-29" and c["start_time"] == "17:30" and c["time_confirmed"] is False
    assert c["source_keys"] == ["hay:p-24610"]


# ═══ FICCI ═══════════════════════════════════════════════════════════════════════════════════
def test_ficci_home_and_real_utc_conversion() -> None:
    cands, _ = S.parse_ficci_home(rd("ficci_home.html"), meta("https://www.ficcifestival.com/"))
    assert (cands[0]["start_date"], cands[0]["end_date"]) == ("2027-04-06", "2027-04-11")
    assert cands[0]["evidence"][0]["date_text"] == "6 – 11 ABRIL 2027"
    items, skips = S.parse_ficci_eventos(rd("ficci_eventos_d1.html"), meta("https://www.ficcifestival.com/eventos?field_date_value=1"))
    assert skips == [] and len(items) == 3
    brasil = by_title(items, "CASA BRASIL")
    assert (brasil["start_date"], brasil["start_time"], brasil["end_time"], brasil["time_confirmed"]) == ("2026-04-14", "15:00", "17:00", True)
    # 2026-04-15T00:00:00Z is a REAL UTC instant: 14 Apr 19:00 in Bogotá (under 'Martes 14 de Abril').
    inaug = by_title(items, "Inauguración FICCI")
    assert (inaug["start_date"], inaug["start_time"]) == ("2026-04-14", "19:00")


# ═══ IRONMAN ═════════════════════════════════════════════════════════════════════════════════
def test_ironman_date_only_no_shift() -> None:
    c, why = S.parse_ironman(rd("ironman_im703_cartagena.html"), meta("https://www.ironman.com/races/im703-cartagena"))
    assert why is None
    # JSON-LD '2026-11-29T00:00:00+0000' must NOT become 28 Nov 19:00 Bogotá.
    assert (c["start_date"], c["end_date"], c["start_time"]) == ("2026-11-29", "2026-11-29", None)
    assert c["evidence"][0]["date_text"] == "November 29, 2026" and c["evidence"][0]["visible"] is True
    assert c["source_keys"] == ["ironman:im703-cartagena-2026"] and c["category"] == "sports"
    assert "registration_sold_out" in c["flags"] and c["sold_out"] is False
    assert c["lat"] is None and "coords_dropped_coarse" in c["flags"]  # JSON-LD geo 10.4/-75.5 is a centroid
    assert c["price"]["is_free"] is None  # never from JSON-LD isAccessibleForFree
    assert c["ld_location"]["addressCountry"] == "Colombia"


# ═══ IPCC + El Universal agenda rows ═════════════════════════════════════════════════════════
def test_ipcc_feed_rows() -> None:
    items, _ = S.parse_agenda_feed("ipcc", rd("ipcc_feed.xml"), "2026-09-28T20:00:00Z", 200)
    assert len(items) == 24 and all(c["source_tier"] == 1 and c["role"] == "corroborate" for c in items)
    assert all(c["start_date"].startswith("2026-") for c in items)  # year from the weekday, never a dateline
    bando = by_title(items, "Gran Desfile de Independencia")
    assert (bando["start_date"], bando["start_time"], bando["end_time"], bando["venue_name"]) == ("2026-11-12", "10:00", "12:00", "Avenida Santander")
    assert bando["time_confirmed"] is True
    assert bando["source_url"].startswith("https://ipcc.gov.co/alcaldia-de-cartagena-presento-la-programacion-oficial")
    nautico = by_title(items, "Festival Náutico")
    assert (nautico["start_date"], nautico["end_date"]) == ("2026-11-13", "2026-11-14")
    llaves = by_title(items, "Entrega de llaves")
    assert "tentative" in llaves["flags"] and llaves["venue_name"] is None and llaves["start_time"] is None
    assert "lineup" in by_title(items, "Jader Tremendo")["flags"]
    assert by_title(items, "Cabildo de Getsemaní")["start_date"] == "2026-11-15"


def test_eluniversal_feed_rows_are_tier5_corroboration() -> None:
    items, skips = S.parse_agenda_feed("eluniversal", rd("eluniversal_rss_farandula.xml"), "2026-09-28T20:00:00Z", 200)
    assert len(items) == 23 and all(c["source_tier"] == 5 and c["role"] == "corroborate" for c in items)
    assert by_title(items, "Preludio Localidad 2")["start_date"] == "2026-10-09"
    assert all("carlos-vives" not in c["source_url"] for c in items)


# ═══ La Tiquetera ════════════════════════════════════════════════════════════════════════════
def test_latiquetera_boxes_and_events() -> None:
    boxes = S.parse_latiquetera_boxes(rd("latiquetera_home.html"))
    assert sorted(b["url"] for b in boxes) == ["https://latiquetera.com/event/andres-cepeda-en-cartagena",
                                               "https://latiquetera.com/event/buena-vida-beach-2027"]
    u = "https://latiquetera.com/event/andres-cepeda-en-cartagena"
    c, why = S.parse_latiquetera_event(rd("latiquetera_ev_cepeda.html"), meta(u))
    assert why is None
    # og:description still says 'Sábado 26 de septiembre 2026' (stale); body + JSON-LD say 8 May 2027.
    assert (c["start_date"], c["start_time"], c["time_confirmed"], c["tz_offset"]) == ("2027-05-08", "19:00", True, "-05:00")
    assert c["lat"] == pytest.approx(10.40493, abs=1e-4) and c["lng"] == pytest.approx(-75.49797, abs=1e-4)
    assert "Cartagena de Indias" in c["event_text"] and c["ticket_url"] == u
    assert c["markers"]["finished"] is False and c["sold_out"] is False  # 'Finalizado' = ended PRICE STAGE, not the event
    c, _ = S.parse_latiquetera_event(rd("latiquetera_ev_buenavida.html"), meta("https://latiquetera.com/event/buena-vida-beach-2027"))
    assert (c["start_date"], c["end_date"], c["start_time"], c["ticket_url"]) == ("2027-01-08", "2027-01-10", "14:00", None)
    assert S.parse_latiquetera_event(rd("latiquetera_viewcanceled_darkcircus.html"),
                                     meta("https://latiquetera.com/events/view_canceled/dark-circus-stereoptik")) == (None, "canceled")
    assert S.parse_latiquetera_event(rd("latiquetera_ev_nonexistent.html"), meta("https://latiquetera.com/event/nope"))[0] is None


# ═══ TuBoleta + SecuTix ══════════════════════════════════════════════════════════════════════
def test_tuboleta_event_pages() -> None:
    cards = S.parse_tuboleta_search(rd("tuboleta_search_ctg.html"))
    assert {c["url"].rsplit("/", 1)[-1] for c in cards} == {"parque-tematico-caribe-aventura", "fragmentado-cartagena", "de-la-risa-al-llanto"}
    u = "https://tuboleta.com/es/eventos/fragmentado-cartagena"
    cands, _ = S.parse_tuboleta_event(rd("tuboleta_ev_fragmentado.html"), meta(u))
    c = cands[0]
    # JSON-LD says T07:00:00-0500 (placeholder); data-date + visible text say 20:00.
    assert (c["start_date"], c["start_time"], c["time_confirmed"]) == ("2026-10-15", "20:00", True)
    assert c["venue_name"] == "The Clock Pub" and c["price"]["min_cop"] == 50000 and c["price"]["is_free"] is False
    assert c["source_keys"] == ["tuboleta:fragmentado-cartagena", "secutix:10230513253155"]
    cands, _ = S.parse_tuboleta_event(rd("tuboleta_ev_risa.html"), meta("https://tuboleta.com/es/eventos/de-la-risa-al-llanto"))
    assert (cands[0]["start_time"], cands[0]["price"]["min_cop"], cands[0]["price"]["max_cop"]) == ("19:00", 25000, 50000)
    # Evergreen attraction at Km 51 Vía al Mar: no performance blocks → never a candidate.
    assert S.parse_tuboleta_event(rd("tuboleta_ev_caribeaventura.html"), meta("https://tuboleta.com/es/eventos/parque-tematico-caribe-aventura")) == ([], ["no_performance_blocks"])
    assert S.parse_tuboleta_event(rd("tuboleta_error403.html"), meta("https://tuboleta.com/es/eventos/x")) == ([], ["drupal_403"])


def test_secutix_lists_allowlist_and_false_z() -> None:
    cands, skips, n = S.parse_secutix_list(rd("secutix_special_list.html"), meta("https://special.checkout.tuboleta.com/list/events"))
    assert n == 14 and skips == [] and len(cands) == 9
    assert all(any(f.startswith("secutix_site_") and f[13:] in S.SECUTIX_CTG_SITES for f in c["flags"]) for c in cands)
    assert not any("CARPA" in c["title"]["es"] for c in cands)  # Carpa Delirio: 'CAR' prefix is NOT Cartagena
    c = by_title(cands, "Concierto inaugural")
    assert (c["start_date"], c["start_time"], c["time_confirmed"]) == ("2027-01-09", "19:00", True)
    assert c["detail_url"] == c["ticket_url"] == "https://special.checkout.tuboleta.com/selection/event/date?productId=10230585113834"
    assert c["source_url"] == c["recheck_url"] == c["evidence"][0]["url"] == "https://special.checkout.tuboleta.com/list/events"
    teatros, _, _ = S.parse_secutix_list(rd("secutix_teatros_list.html"), meta("https://teatros.checkout.tuboleta.com/list/events"))
    assert {c["title"]["es"] for c in teatros} == {"FREEDAY BAND - PUERTO DE INDIA", "FRAGMENTADO - CARTAGENA", "DE LA RISA AL LLANTO"}
    # Product page JSON-LD '2027-01-09T19:00:00Z' is Bogotá wall-clock: 19:00, NOT 14:00.
    p = S.parse_secutix_product(rd("secutix_product_10230585113834.html"),
                                meta("https://special.checkout.tuboleta.com/selection/event/date?productId=10230585113834"))
    assert (p["start_date"], p["start_time"], p["time_confirmed"]) == ("2027-01-09", "19:00", True)
    assert "ld_false_z_as_local" in p["flags"] and p["price"]["min_cop"] == 134900
    assert "Cartagena, CO" in p["event_text"]


# ═══ Ticketshop ══════════════════════════════════════════════════════════════════════════════
def test_ticketshop_city_filter_and_no_pii() -> None:
    rows, last = S.parse_ticketshop_list(rd("ticketshop_eventos_estado_1.json"))
    assert len(rows) == 6 and last == 1
    body = rd("ticketshop_evento_detone_cucuta.json")
    assert S.parse_ticketshop_event(body, meta("x")) == (None, "not_cartagena_city:773")  # Cúcuta
    d = json.loads(body)
    d["data"]["auditorio"]["id_ciudad"] = "176"  # same real event, re-homed to Cartagena's city id
    d["data"]["cliente"] = {"email": "promotor@example.com", "telefono": "3000000000"}
    c, why = S.parse_ticketshop_event(json.dumps(d), meta("https://api.ticketshop.com.co/api/evento/x"))
    assert why is None and (c["start_date"], c["start_time"]) == ("2026-11-14", "19:00")
    assert c["time_confirmed"] is False and c["evidence"][0]["visible"] is False  # API only, never HIGH on its own
    assert c["detail_url"] == "https://ticketshop.com.co/eventos/detone-y-abandone-tour-beele-cucuta"
    assert c["source_url"] == c["evidence"][0]["url"] == "https://api.ticketshop.com.co/api/evento/x"  # what we fetched
    blob = json.dumps(c, ensure_ascii=False)
    assert "promotor@example.com" not in blob and "3000000000" not in blob


# ═══ Fever ═══════════════════════════════════════════════════════════════════════════════════
def test_fever_colombia_only_dated_events() -> None:
    city, plans = S.parse_fever_city(rd("fever_ctg_city.html"))
    assert (city["country"], city["code"], city["currency"]) == ("CO", "CTG", "COP") and len(plans) == 44
    verdicts = [S.fever_plan_is_event(p, TODAY) for p in plans]
    assert not any(ok for ok, _ in verdicts)  # 0 dated events: tours, experiences, gift cards
    assert {why for _, why in verdicts} == {"timeless", "long_session_window"}
    c, _ = S.parse_fever_plan(rd("fever_plan_324036.html"), meta("https://feverup.com/m/324036/en"))
    assert (c["country_iso"], c["tz_offset"], c["currency"]) == ("CO", "-05:00", "COP") and c["start_time"] is None
    es, _ = S.parse_fever_plan(rd("fever_spain_plan_587428.html"), meta("https://feverup.com/m/587428"))
    assert (es["country_iso"], es["tz_offset"], es["currency"]) == ("ES", "+02:00", "EUR")  # the gate FAILs these
    spain_city, _ = S.parse_fever_city(rd("fever_spain_city.html"))
    assert spain_city["country"] == "ES" and spain_city["timezone"] == "Europe/Madrid"


# ═══ CCC ═════════════════════════════════════════════════════════════════════════════════════
def test_ccc_microdata_and_placeholder_times() -> None:
    sm = S.parse_ccc_sitemap(rd("ccc_ajde_events_sitemap.xml"))
    assert len(sm) == 14 and sm[0][1] >= sm[-1][1]
    c, _ = S.parse_ccc_event(rd("ccc_ev_cumbre-del-petroleo-y-gas-2026.html"), meta("https://cccartagena.com/events/cumbre-del-petroleo-y-gas-2026/"))
    # microdata '2026-11-1T07:30' is local; the ICS/JSON-LD values are never read.
    assert (c["start_date"], c["end_date"], c["start_time"], c["time_confirmed"]) == ("2026-11-01", "2026-11-06", "07:30", True)
    assert "professional" in c["flags"] and c["category"] == "civic" and c["source_keys"] == ["cccartagena:38428"]
    c, _ = S.parse_ccc_event(rd("ccc_ev_la-pelota-de-letras-de-andres-lopez.html"), meta("https://cccartagena.com/events/la-pelota-de-letras-de-andres-lopez/"))
    assert (c["start_date"], c["start_time"], c["time_confirmed"]) == ("2026-10-03", None, False)  # 1:00 a.m. placeholder
    assert "placeholder_time_dropped" in c["flags"]
    c, _ = S.parse_ccc_event(rd("ccc_ev_felipe-pelaez-sinfonico.html"), meta("https://cccartagena.com/events/felipe-pelaez-sinfonico/"))
    assert (c["start_date"], c["start_time"], c["end_time"]) == ("2026-08-29", "16:00", "23:30")
    assert not hasattr(S, "parse_ics") and "DTSTART:20300101T120000Z" in rd("ccc_38866.ics")  # the echoing ICS is banned
    assert S._ccc_bust("https://cccartagena.com/events/x/", NOW).startswith("https://cccartagena.com/events/x/?amo=")


# ═══ Cartagenaplay (tier 6) ══════════════════════════════════════════════════════════════════
def test_cartagenaplay_discovery_only() -> None:
    assert len(S.parse_cartagenaplay_sitemap(rd("cartagenaplay_job_listing_sitemap.xml"))) == 8
    cands, _ = S.parse_cartagenaplay_event(rd("cartagenaplay_ev_halloween-play-2026-prestige.html"),
                                           meta("https://cartagenaplay.com/event/halloween-play-2026-prestige/"))
    c = cands[0]
    # The header 'FECHA: 28 septiembre, 2026' is the load day, never the event date.
    assert (c["start_date"], c["start_time"], c["end_time"]) == ("2026-10-31", "19:00", None)
    assert c["source_tier"] == 6 and c["role"] == "review" and c["price"]["min_cop"] == 25000
    assert c["lat"] == pytest.approx(10.39533)
    assert S.parse_cartagenaplay_event(rd("cartagenaplay_ev_andres-cepeda-en-cartagena-2.html"),
                                       meta("https://cartagenaplay.com/event/andres-cepeda-en-cartagena-2/")) == ([], ["ended"])
    nautico, _ = S.parse_cartagenaplay_event(rd("cartagenaplay_ev_festival-nautico-en-cartagena.html"),
                                             meta("https://cartagenaplay.com/event/festival-nautico-en-cartagena/"))
    assert nautico[0]["start_date"] == "2026-11-13" and nautico[0]["start_time"] is None  # '12:00 am - 12:00 am'


# ═══ markers, challenge, helpers ═════════════════════════════════════════════════════════════
@pytest.mark.parametrize("text,expected", [
    ("Si el evento es cancelado o aplazado, el valor de la boleta será reembolsado.", None),
    ("CO Puntos de Venta La Tiquetera Eventos cancelados Iniciar sesión", None),
    ("Leave A Comment Cancelar respuesta", None),
    ("Política de cancelación y devoluciones", None),
    ("If the race is cancelled or postponed, entries roll over.", None),
    ("Concierto de Silvestre — CANCELADO por lluvia", "cancelado"),
    ("Festival aplazado para 2027", "aplazado"),
    ("Race postponed due to weather", "postponed"),
    ("El show fue reprogramado", "reprogramado"),
])
def test_cancel_markers_event_scoped(text: str, expected: Optional[str]) -> None:
    assert S.find_cancel_marker(text) == expected


def test_challenge_detection_on_real_pages() -> None:
    cf = rd("challenge_cloudflare_cartagena_gov_co.html")
    assert S.detect_challenge(403, "https://www.cartagena.gov.co/", {"cf-mitigated": "challenge"}, cf) == "cf_challenge"
    assert S.detect_challenge(403, "https://www.cartagena.gov.co/", {}, cf) == "challenge_page"
    assert S.detect_challenge(200, "https://www.atrapalo.com/entradas/murcia/cartagena/", {}, rd("challenge_atrapalo_client_challenge.html")) == "challenge_page"
    assert S.detect_challenge(200, "https://special.checkout.tuboleta.com/selection/event/date?productId=1", {}, rd("secutix_waiting_room.html")) == "waiting_room"
    assert S.detect_challenge(302, "https://special.checkout.tuboleta.com/cookieWarning", {}, "") == "cookie_wall"
    assert S.detect_challenge(302, "https://peak51.secutix.com/pkpcontroller/wp/wrcomar/index_es.html?queue=q-COMAR", {}, "") == "waiting_room"
    # Real event pages embed reCAPTCHA scripts: never a challenge.
    show = rd("cmf_show_fuego-y-geometria.html")
    assert S.detect_challenge(200, "https://cartagenamusicfestival.com/show-item/fuego-y-geometria/", {}, show) is None
    assert S.detect_challenge(403, "https://tuboleta.com/es/eventos/x", {}, rd("tuboleta_error403.html")) is None


def test_coords_free_and_time_helpers() -> None:
    assert S.clean_coords(10.4236, -75.5483)[2] == "placeholder"
    assert S.clean_coords(10.3932277, -75.4832311)[2] == "placeholder"  # Fever CTG city centroid
    assert S.clean_coords("10.4", "-75.5")[2] == "coarse"
    assert S.clean_coords(0, 0)[2] == "null_island"
    assert S.clean_coords("10.39533", "-75.49025") == (10.39533, -75.49025, None)
    assert S.is_free_from("Entrada libre hasta completar aforo", None) is None
    assert S.is_free_from("Concierto gratis por la paz", None) is True
    assert S.is_free_from("Entrada gratis para menores de 12 años", None) is None
    assert S.is_free_from("gratis", 25000) is False
    assert S.split_iso("2027-01-09T19:00:00Z") == {"date": "2027-01-09", "time": "19:00", "offset": "Z"}
    assert S.utc_to_bogota("2026-04-15T00:00:00Z") == {"date": "2026-04-14", "time": "19:00"}
    assert S.parse_clock("09.01.2027 - 19:00") == "19:00" and S.parse_clock("10.000 artistas") is None
    assert S.year_by_weekday(11, 12, 3, 2025) == 2026  # 'Jueves 12 de noviembre' → 2026, whatever the dateline says
    assert [h["start"] for h in S.find_date_expressions("Viernes 13 y Sábado 14 de noviembre", 2026)] == ["2026-11-13"]


# ═══ transport harness ═══════════════════════════════════════════════════════════════════════
class Router:
    """httpx.MockTransport handler: url → (status, body, headers); query-insensitive fallback;
    records every requested URL. Unknown URLs are 404."""

    def __init__(self, routes: dict[str, tuple[int, Any, dict[str, str]]]) -> None:
        self.routes = routes
        self.seen: list[str] = []
        self.methods: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.seen.append(url)
        self.methods.append(request.method)
        hit = self.routes.get(url) or self.routes.get(url.split("?")[0])
        if hit is None:
            return httpx.Response(404, text="<html><title>404</title>not found</html>")
        status, body, headers = hit
        content = body.encode("utf-8") if isinstance(body, str) else body
        return httpx.Response(status, content=content, headers={"content-type": "text/html; charset=utf-8", **headers})


def client_for(router: Router) -> httpx.AsyncClient:
    return S.make_client(transport=httpx.MockTransport(router))


class FakeClock:
    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t

    async def sleep(self, s: float) -> None:
        self.t += s
        await asyncio.sleep(0)


def fast_sched(deadline: Optional[float] = None) -> S.PoliteScheduler:
    fc = FakeClock()
    return S.PoliteScheduler(deadline=deadline, clock=fc, sleep=fc.sleep)


async def _with(router: Router, fn: Callable[[httpx.AsyncClient], Any]) -> Any:
    async with client_for(router) as c:
        return await fn(c)


# ═══ fetch() (§13 F1) ════════════════════════════════════════════════════════════════════════
def test_fetch_ok_and_body_cap() -> None:
    big = "<html>" + "x" * 2_000_000 + "</html>"
    r = Router({"https://a.example/ok": (200, "<html><title>ok</title>hola</html>", {}),
                "https://a.example/big": (200, big, {})})
    ok = run(_with(r, lambda c: S.fetch(c, "https://a.example/ok", source="cmf")))
    assert ok["status"] == 200 and ok["blocked_reason"] is None and "hola" in ok["text"] and ok["challenged"] is False
    capped = run(_with(r, lambda c: S.fetch(c, "https://a.example/big", source="cmf")))
    assert capped["truncated"] is True and len(capped["text"]) <= S.MAX_BODY_BYTES
    assert S.UA in json.dumps(dict(client_for(r).headers))


def test_fetch_redirect_limits_and_walls() -> None:
    r = Router({f"https://a.example/{i}": (302, "", {"location": f"/{i + 1}"}) for i in range(6)})
    res = run(_with(r, lambda c: S.fetch(c, "https://a.example/0")))
    assert res["blocked_reason"] == "too_many_redirects" and len(r.seen) == 4  # 1 + 3 hops, no more
    r = Router({"https://special.checkout.tuboleta.com/selection/event/date?productId=1": (302, "", {"location": "/cookieWarning"})})
    res = run(_with(r, lambda c: S.fetch(c, "https://special.checkout.tuboleta.com/selection/event/date?productId=1")))
    assert res["challenged"] is True and res["blocked_reason"] == "cookie_wall"
    assert r.seen == ["https://special.checkout.tuboleta.com/selection/event/date?productId=1"]  # the wall itself is never fetched
    r = Router({"https://www.cartagena.gov.co/": (403, rd("challenge_cloudflare_cartagena_gov_co.html"), {"cf-mitigated": "challenge"})})
    res = run(_with(r, lambda c: S.fetch(c, "https://cartagena.gov.co/noticias")))
    assert res["blocked_reason"] == "never_crawl" and r.seen == []  # §13 G: the Alcaldía site is never crawled
    r = Router({"https://www.atrapalo.com/entradas/": (200, rd("challenge_atrapalo_client_challenge.html"), {})})
    res = run(_with(r, lambda c: S.fetch(c, "https://www.atrapalo.com/entradas/")))
    assert res["status"] == 200 and res["challenged"] is True and res["blocked_reason"] == "challenge_page"
    r = Router({"https://a.example/down": (503, "down", {})})
    assert run(_with(r, lambda c: S.fetch(c, "https://a.example/down")))["blocked_reason"] == "http_503"


def test_fetch_timeout_and_network_error() -> None:
    async def slow(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(1.0)
        return httpx.Response(200, text="late")

    async def go() -> dict[str, Any]:
        async with S.make_client(transport=httpx.MockTransport(slow)) as c:
            return await S.fetch(c, "https://slow.example/", timeout_s=0.05)

    assert run(go())["blocked_reason"] == "timeout"

    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("dns failure for secret-token-host", request=request)

    async def go2() -> dict[str, Any]:
        async with S.make_client(transport=httpx.MockTransport(boom)) as c:
            return await S.fetch(c, "https://down.example/")

    assert run(go2())["blocked_reason"] == "network_error"


# ═══ scheduler (§13 F2) ══════════════════════════════════════════════════════════════════════
def test_scheduler_gap_single_flight_and_deadline() -> None:
    fc = FakeClock()
    sched = S.PoliteScheduler(deadline=100.0, clock=fc, sleep=fc.sleep)
    stamps: list[float] = []
    active = {"n": 0, "max": 0}

    async def hit() -> None:
        async with sched.slot("https://cartagenamusicfestival.com/x", min_gap_s=1.0):
            active["n"] += 1
            active["max"] = max(active["max"], active["n"])
            stamps.append(fc())
            await asyncio.sleep(0)
            active["n"] -= 1

    async def three() -> None:
        await asyncio.gather(hit(), hit(), hit())

    run(three())
    assert active["max"] == 1 and stamps == sorted(stamps) and all(b - a >= 1.0 for a, b in zip(stamps, stamps[1:]))

    fc2 = FakeClock()
    s2 = S.PoliteScheduler(deadline=5.0, clock=fc2, sleep=fc2.sleep)

    async def past_deadline() -> None:
        fc2.t = 5.0
        async with s2.slot("a.example"):
            pass

    with pytest.raises(S.DeadlineReached):
        run(past_deadline())

    s3 = S.PoliteScheduler(deadline=10.0, clock=fc2, sleep=fc2.sleep)
    fc2.t = 9.5
    s3._last["checkout.tuboleta.com"] = 9.0  # next SecuTix request allowed at 15.0 (6 s gap) > deadline

    async def gap_past_deadline() -> None:
        async with s3.slot("https://teatros.checkout.tuboleta.com/list/events"):
            pass

    with pytest.raises(S.DeadlineReached):
        run(gap_past_deadline())


def test_scheduler_max_four_domains_in_parallel() -> None:
    sched = S.PoliteScheduler(deadline=None, default_gap_s=0.0)

    async def one(host: str) -> None:
        async with sched.slot(f"https://{host}/", min_gap_s=0.0):
            await asyncio.sleep(0.02)

    async def many() -> None:
        await asyncio.gather(*(one(f"h{i}.example") for i in range(7)))

    run(many())
    assert sched.max_in_flight == 4 and sched.dispatched == 7


# ═══ recheck outcomes (§15 S3) ═══════════════════════════════════════════════════════════════
CEPEDA = "https://latiquetera.com/event/andres-cepeda-en-cartagena"


def cepeda_doc(**kw: Any) -> dict[str, Any]:
    d = {"source_key": "latiquetera", "source_url": CEPEDA, "recheck_url": CEPEDA, "title": {"es": "Andrés Cepeda en Cartagena"},
         "start_date": "2027-05-08", "end_date": "2027-05-08", "start_time": "19:00",
         "source_keys": ["latiquetera:andres-cepeda-en-cartagena"]}
    d.update(kw)
    return d


def recheck(router: Router, doc: dict[str, Any]) -> dict[str, Any]:
    return run(_with(router, lambda c: S.recheck_doc(c, doc, sched=fast_sched(), now_utc=NOW)))


def test_recheck_success_and_date_changed() -> None:
    r = Router({CEPEDA: (200, rd("latiquetera_ev_cepeda.html"), {})})
    out = recheck(r, cepeda_doc())
    assert out["outcome"] == "success" and out["parsed"]["start_date"] == "2027-05-08" and out["http_status"] == 200
    assert "08 de mayo de 2027" in out["found_date_text"]
    moved = recheck(r, cepeda_doc(start_date="2026-09-26", end_date="2026-09-26"))  # the stale og/aggregator date
    assert moved["outcome"] == "date_changed" and moved["parsed"]["start_date"] == "2027-05-08" and moved["time_only"] is False
    retimed = recheck(r, cepeda_doc(start_time="22:00"))
    assert retimed["outcome"] == "date_changed" and retimed["time_only"] is True


def test_recheck_not_found_blocked_gone_cancel() -> None:
    assert recheck(Router({CEPEDA: (200, rd("latiquetera_ev_nonexistent.html"), {})}), cepeda_doc())["outcome"] == "not_found"
    cf = recheck(Router({CEPEDA: (403, rd("challenge_cloudflare_cartagena_gov_co.html"), {"cf-mitigated": "challenge"})}), cepeda_doc())
    assert cf["outcome"] == "blocked" and cf["marker"] == "cf_challenge"
    assert recheck(Router({}), cepeda_doc())["outcome"] == "gone"  # 404
    assert recheck(Router({CEPEDA: (410, "gone", {})}), cepeda_doc())["outcome"] == "gone"
    off = recheck(Router({CEPEDA: (301, "", {"location": "https://latiquetera.com/"}),
                          "https://latiquetera.com/": (200, rd("latiquetera_home.html"), {})}), cepeda_doc())
    assert off["outcome"] == "gone" and off["marker"] == "redirect_off_slug"
    dc = "https://latiquetera.com/event/dark-circus-stereoptik"
    canc = recheck(Router({dc: (302, "", {"location": "/events/view_canceled/dark-circus-stereoptik"}),
                           "https://latiquetera.com/events/view_canceled/dark-circus-stereoptik": (200, rd("latiquetera_viewcanceled_darkcircus.html"), {})}),
                   cepeda_doc(source_url=dc, recheck_url=dc, title={"es": "Dark Circus Stereoptik"}))
    assert canc["outcome"] == "cancel_marker" and canc["marker"] == "view_canceled"


def test_recheck_secutix_cookie_wall_list_and_sold_out() -> None:
    prod = "https://special.checkout.tuboleta.com/selection/event/date?productId=10230585113834"
    lst = "https://special.checkout.tuboleta.com/list/events"
    doc = {"source_key": "tuboleta", "source_url": lst, "recheck_url": prod, "title": {"es": "Concierto inaugural: Fuego y geometría"},
           "start_date": "2027-01-09", "end_date": "2027-01-09", "start_time": "19:00",
           "source_keys": ["tuboleta:10230585113834", "secutix:10230585113834"]}
    walled = recheck(Router({prod: (302, "", {"location": "https://special.checkout.tuboleta.com/cookieWarning"})}), doc)
    assert walled["outcome"] == "blocked" and walled["marker"] == "cookie_wall"  # a wall never counts as 'removed'
    assert recheck(Router({prod: (200, rd("secutix_product_10230585113834.html"), {})}), doc)["outcome"] == "success"
    assert recheck(Router({prod: (200, rd("secutix_waiting_room.html"), {})}), doc)["outcome"] == "blocked"
    doc_l = {**doc, "recheck_url": lst}
    assert recheck(Router({lst: (200, rd("secutix_special_list.html"), {})}), doc_l)["outcome"] == "success"
    missing = {**doc_l, "source_keys": ["tuboleta:99999999"], "title": {"es": "Un concierto que ya no existe"}}
    gone = recheck(Router({lst: (200, rd("secutix_special_list.html"), {})}), missing)
    assert gone["outcome"] == "gone" and gone["marker"] == "missing_from_list"
    # 'sold_out' = date verified AND the status element says Agotado (stays published, not pushable).
    found = S.found_from_candidate(S._pick(S.parse_secutix_list(rd("secutix_special_list.html"), meta(lst))[0], doc_l, "tuboleta"))
    assert found["sold_out"] is False
    found["sold_out"] = True
    sold = S.compare_to_doc(doc_l, found, {"status": 200, "final_url": lst}, TODAY)
    assert sold["outcome"] == "sold_out" and sold["sold_out"] is True and sold["parsed"]["start_date"] == "2027-01-09"
    # The real sold-out SecuTix markup (p.buy_unavailable 'Agotado') is detected on the list page.
    sold_c = [c for c in S.parse_secutix_list(rd("secutix_special_list.html").replace("product_site_SNEO23", "product_site_CARTADME"), meta(lst))[0]
              if c["sold_out"]]
    assert sold_c and all(c["markers"]["sold_out"] for c in sold_c)


def test_recheck_tuboleta_drupal_403_is_gone() -> None:
    u = "https://tuboleta.com/es/eventos/fragmentado-cartagena"
    doc = {"source_key": "tuboleta", "source_url": u, "title": {"es": "FRAGMENTADO - CARTAGENA"}, "start_date": "2026-10-15",
           "start_time": "20:00", "source_keys": ["tuboleta:fragmentado-cartagena"]}
    assert recheck(Router({u: (200, rd("tuboleta_ev_fragmentado.html"), {})}), doc)["outcome"] == "success"
    out = recheck(Router({u: (403, rd("tuboleta_error403.html"), {})}), doc)
    assert out["outcome"] == "gone" and out["marker"] == "drupal_403"


def test_recheck_ipcc_rows_and_generic() -> None:
    art = "https://ipcc.gov.co/alcaldia-de-cartagena-presento-la-programacion-oficial-de-las-fiestas-de-independencia-del-11-de-noviembre-2026/"
    page = rd("ipcc_art_programacion_fiestas_2026.html")
    row = "Jueves 12 de noviembre: Gran Desfile de Independencia (Avenida Santander – 10:00 a.m. a 12:00 p.m.)."
    bando = {"source_key": "ipcc", "source_url": art, "recheck_url": art, "title": {"es": "Gran Desfile de Independencia"},
             "start_date": "2026-11-12", "end_date": "2026-11-12", "start_time": "10:00",
             "evidence": [{"url": art, "date_text": row}]}
    ok = recheck(Router({art: (200, page, {})}), bando)
    assert ok["outcome"] == "success" and ok["marker"] is None  # the page's 'Cancelar respuesta' form is boilerplate
    stale = {**bando, "title": {"es": "Cabildo de Getsemaní"}, "start_date": "2026-11-14", "end_date": "2026-11-14",
             "start_time": None, "evidence": []}  # the April PDF / 25 Sep article date
    moved = recheck(Router({art: (200, page, {})}), stale)
    assert moved["outcome"] == "date_changed" and moved["parsed"]["start_date"] == "2026-11-15"
    # Same page on a domain without an adapter → generic recheck finds the verbatim evidence text.
    other = "https://organizador.example.co/agenda-fiestas"
    gen = {**bando, "source_key": None, "source_url": other, "recheck_url": other, "evidence": [{"url": other, "date_text": row}]}
    g = recheck(Router({other: (200, page, {})}), gen)
    assert g["outcome"] == "success" and g["parsed"]["start_date"] == "2026-11-12"
    assert recheck(Router({other: (200, "<html><body>Otra cosa</body></html>", {})}), gen)["outcome"] == "not_found"
    alc = {**bando, "source_key": None, "source_url": "https://www.cartagena.gov.co/noticias/x", "recheck_url": None}
    assert recheck(Router({}), alc)["marker"] == "never_crawl"


def test_recheck_cancel_marker_generic_is_event_scoped() -> None:
    u = "https://venue.example.co/evento/noche-de-salsa"
    body = ("<html><body><h1>Noche de Salsa en la Plaza</h1><p>Sábado 14 de noviembre de 2026, 8:00 p.m.</p>"
            "<p>EVENTO CANCELADO por la organización.</p>" + "<p>relleno</p>" * 400 +
            "<footer>Términos: si el evento es cancelado o aplazado se reembolsa.</footer></body></html>")
    doc = {"source_url": u, "title": {"es": "Noche de Salsa en la Plaza"}, "start_date": "2026-11-14", "start_time": "20:00"}
    assert recheck(Router({u: (200, body, {})}), doc)["outcome"] == "cancel_marker"
    clean = body.replace("<p>EVENTO CANCELADO por la organización.</p>", "")
    assert recheck(Router({u: (200, clean, {})}), doc)["outcome"] == "success"


def test_head_recheck_pdf() -> None:
    pdf = "https://ipcc.gov.co/wp-content/uploads/2026/09/agenda-festiva-2026.pdf"
    hdr = {"etag": '"b4e6b6-65c278bfd37be"', "last-modified": "Wed, 23 Sep 2026 14:46:22 GMT", "content-length": "11855542",
           "content-type": "application/pdf"}
    r = Router({pdf: (200, b"", hdr)})
    base = {"recheck_url": pdf, "source_url": pdf}
    first = recheck(r, base)
    assert first["outcome"] == "not_found" and first["marker"] == "no_baseline" and first["head"]["etag"] == hdr["etag"]
    assert r.methods == ["HEAD"]
    same = recheck(r, {**base, "etag": hdr["etag"], "last_modified": hdr["last-modified"], "content_length": "11855542"})
    assert same["outcome"] == "success"
    changed = recheck(r, {**base, "etag": '"older"', "last_modified": "Wed, 16 Sep 2026 12:27:10 GMT"})
    assert changed["outcome"] == "changed" and changed["marker"] == "source_changed"


def test_recheck_ccc_uses_cache_buster_and_cache() -> None:
    u = "https://cccartagena.com/events/cumbre-del-petroleo-y-gas-2026/"
    r = Router({u: (200, rd("ccc_ev_cumbre-del-petroleo-y-gas-2026.html"), {})})
    doc = {"source_key": "cccartagena", "source_url": u, "title": {"es": "Cumbre Del Petroleo Y Gas 2026"},
           "start_date": "2026-11-01", "end_date": "2026-11-06", "start_time": "07:30", "source_keys": ["cccartagena:38428"]}
    cache: dict[str, Any] = {}

    async def twice(c: httpx.AsyncClient) -> list[dict[str, Any]]:
        a = await S.recheck_doc(c, doc, sched=fast_sched(), cache=cache, now_utc=NOW)
        b = await S.recheck_doc(c, doc, sched=fast_sched(), cache=cache, now_utc=NOW)
        return [a, b]

    outs = run(_with(r, twice))
    assert [o["outcome"] for o in outs] == ["success", "success"]
    assert len(r.seen) == 1 and "amo=" in r.seen[0]  # one fetch per URL per run (§13 F4), cache-busted


def test_recheck_ticketshop_and_fever_gone() -> None:
    api = "https://api.ticketshop.com.co/api/evento/detone-y-abandone-tour-beele-cucuta"
    doc = {"source_key": "ticketshop", "source_url": "https://ticketshop.com.co/eventos/detone-y-abandone-tour-beele-cucuta",
           "recheck_url": api, "start_date": "2026-11-14", "title": {"es": "x"}}
    assert recheck(Router({api: (404, '{"success":false}', {"content-type": "application/json"})}), doc)["outcome"] == "gone"
    plan = "https://feverup.com/m/380670/en"
    fdoc = {"source_key": "fever_co", "source_url": plan, "start_date": "2025-06-03", "title": {"es": "Candlelight"}}
    # Expired plans keep answering 200 but render '<title>- | Fever</title>': that is a gone page.
    out = recheck(Router({plan: (200, rd("fever_plan_380670_expired.html"), {})}), fdoc)
    assert out["outcome"] == "gone" and out["marker"] == "empty_plan"
    kayak = "https://feverup.com/m/324036/en"
    kdoc = {"source_key": "fever_co", "source_url": kayak, "start_date": "2026-09-29", "end_date": "2026-12-31", "title": {"es": "Sunset"}}
    assert recheck(Router({kayak: (200, rd("fever_plan_324036.html"), {})}), kdoc)["outcome"] == "success"


def test_adapter_for_and_dispatch() -> None:
    assert S.adapter_for({"source_key": "hay"}).key == "hay"
    assert S.adapter_for({"source_url": "https://www.hayfestival.com/p-1-x.aspx"}).key == "hay"
    assert S.adapter_for({"source_url": "https://teatros.checkout.tuboleta.com/selection/event/date?productId=1"}).key == "tuboleta"
    assert S.adapter_for({"source_url": "https://api.ticketshop.com.co/api/evento/x"}).key == "ticketshop"
    assert S.adapter_for({"source_url": "https://organizador.example.co/x"}) is None
    out = run(_with(Router({}), lambda c: S.recheck_doc(c, {"source_key": "hay", "source_url": "https://www.hayfestival.com/m-236-arequipa-2026.aspx"})))
    assert out["outcome"] == "blocked" and out["marker"] == "out_of_scope"
    off = run(_with(Router({}), lambda c: S.recheck_doc(c, {"source_key": "cmf", "source_url": "https://cartagenamusicfestival.com/"}, disabled=["cmf"])))
    assert off["marker"] == "source_disabled"


# ═══ pulls through the mock transport ════════════════════════════════════════════════════════
def test_cmf_pull_offsets_checkpoints_and_skips() -> None:
    base = "https://cartagenamusicfestival.com"
    r = Router({f"{base}/": (200, rd("cmf_home.html"), {}), f"{base}/programacion/": (200, rd("cmf_programacion.html"), {}),
                f"{base}/show-item/concierto-de-lanzamiento/": (200, rd("cmf_show_concierto-de-lanzamiento.html"), {}),
                f"{base}/show-item/fuego-y-geometria/": (200, rd("cmf_show_fuego-y-geometria.html"), {})})
    marks: list[tuple[int, str]] = []

    async def cp(i: int, url: str) -> None:
        marks.append((i, url))

    ad = S.SOURCES_BY_KEY["cmf"]["adapter"]
    res = run(_with(r, lambda c: ad.pull(c, None, sched=fast_sched(), checkpoint=cp, now_utc=NOW)))
    keys = [c["source_keys"][0] for c in res]
    assert keys[0] == "cmf:festival-2027" and "cmf:show:fuego-y-geometria" in keys and "cmf:show:concierto-de-lanzamiento" in keys
    assert [s["reason"] for s in res.skipped].count("private") == 2
    assert any(s["reason"] == "fetch_404" for s in res.skipped)  # show pages not in the fixture set
    assert res.total == 7 and res.next_offset is None and [i for i, _ in marks] == list(range(7))
    res2 = run(_with(r, lambda c: ad.pull(c, None, offset=5, sched=fast_sched(), now_utc=NOW)))
    assert "cmf:festival-2027" not in [c["source_keys"][0] for c in res2] and res2.cursor == 7


def test_pull_deadline_resumes_same_offset() -> None:
    fc = FakeClock()
    fc.t = 50.0
    sched = S.PoliteScheduler(deadline=30.0, clock=fc, sleep=fc.sleep)
    ad = S.SOURCES_BY_KEY["cmf"]["adapter"]
    res = run(_with(Router({}), lambda c: ad.pull(c, None, offset=3, sched=sched, now_utc=NOW)))
    assert res.deadline_hit is True and res.next_offset == 3 and list(res) == []


def test_hay_pull_programme_not_published_and_fever_spain_guard() -> None:
    r = Router({"https://www.hayfestival.com/cartagena/inicio": (200, rd("hay_inicio.html"), {})})
    res = run(_with(r, lambda c: S.SOURCES_BY_KEY["hay"]["adapter"].pull(c, None, sched=fast_sched(), now_utc=NOW)))
    assert [c["source_keys"][0] for c in res] == ["hay:festival-2027"]
    assert any(s["reason"] == "programme_not_published" for s in res.skipped)
    assert all("/cartagena/" in u or "-cartagena-" in u for u in r.seen)
    r = Router({S.FEVER_CITY: (200, rd("fever_spain_city.html"), {})})
    res = run(_with(r, lambda c: S.SOURCES_BY_KEY["fever_co"]["adapter"].pull(c, None, sched=fast_sched(), now_utc=NOW)))
    assert list(res) == [] and "fever_city_not_cartagena_co" in res.errors
    r = Router({S.FEVER_CITY: (200, rd("fever_ctg_city.html"), {})})
    res = run(_with(r, lambda c: S.SOURCES_BY_KEY["fever_co"]["adapter"].pull(c, None, sched=fast_sched(), now_utc=NOW)))
    assert list(res) == [] and len(res.skipped) == 44 and r.seen == [S.FEVER_CITY]


def test_tuboleta_pull_lists_and_event_pages() -> None:
    r = Router({S.TuBoletaAdapter.SEARCH: (200, rd("tuboleta_search_ctg.html"), {}),
                S.SECUTIX_LISTS[0]: (200, rd("secutix_special_list.html"), {}),
                S.SECUTIX_LISTS[1]: (200, rd("secutix_teatros_list.html"), {}),
                "https://tuboleta.com/es/eventos/fragmentado-cartagena": (200, rd("tuboleta_ev_fragmentado.html"), {}),
                "https://tuboleta.com/es/eventos/de-la-risa-al-llanto": (200, rd("tuboleta_ev_risa.html"), {}),
                "https://tuboleta.com/es/eventos/parque-tematico-caribe-aventura": (200, rd("tuboleta_ev_caribeaventura.html"), {})})
    ad = S.SOURCES_BY_KEY["tuboleta"]["adapter"]
    res = run(_with(r, lambda c: ad.pull(c, None, sched=fast_sched(), now_utc=NOW)))
    assert res.total == 5 and res.next_offset is None  # 2 SecuTix lists + 3 Cartagena event pages (cap 5)
    assert len(res) == 9 + 3 + 2
    assert any(s["reason"] == "no_performance_blocks" for s in res.skipped)
    shared = [c for c in res if "secutix:10230513253155" in c["source_keys"]]
    assert len(shared) == 2  # list + Drupal page share a key so the service merges them


def test_agenda_pull_and_ccc_pull() -> None:
    r = Router({"https://ipcc.gov.co/feed/": (200, rd("ipcc_feed.xml"), {"content-type": "application/rss+xml"})})
    res = run(_with(r, lambda c: S.SOURCES_BY_KEY["ipcc"]["adapter"].pull(c, None, sched=fast_sched(), now_utc=NOW)))
    assert len(res) == 24 and res.next_offset is None
    r = Router({S.CCC_SITEMAP: (200, rd("ccc_ajde_events_sitemap.xml"), {"content-type": "application/xml"})})
    res = run(_with(r, lambda c: S.SOURCES_BY_KEY["cccartagena"]["adapter"].pull(c, None, sched=fast_sched(), now_utc=NOW)))
    assert res.total == 12 and len(res) == 0 and res.next_offset == 10  # 12 recent sitemap URLs, cap 10 per call
    assert all("amo=" in u for u in r.seen[1:])


def test_ipcc_wp_rest_json_path() -> None:
    """The same real post, as WP REST /wp-json/wp/v2/posts would serve it (content.rendered)."""
    item = next(i for i in S.parse_rss_items(rd("ipcc_feed.xml")) if "programacion-oficial" in i["link"])
    posts = [{"id": 12451, "date_gmt": "2026-09-17T18:32:25", "link": item["link"],
              "title": {"rendered": item["title"]}, "content": {"rendered": item["content_html"]}}]
    cands = S.parse_wp_posts_json("ipcc", json.dumps(posts), "2026-09-28T20:00:00Z", 200)
    assert len(cands) == 24 and by_title(cands, "Gran Desfile")["start_date"] == "2026-11-12"
    assert S.parse_wp_posts_json("ipcc", "not json", "x", 200) == []
    rest = S.IpccAdapter.FEEDS[1]
    r = Router({S.IpccAdapter.FEEDS[0]: (200, rd("ipcc_feed.xml"), {}), rest: (200, json.dumps(posts), {"content-type": "application/json"})})
    res = run(_with(r, lambda c: S.SOURCES_BY_KEY["ipcc"]["adapter"].pull(c, None, sched=fast_sched(), now_utc=NOW)))
    assert len(res) == 24  # the REST copy of the same post is de-duplicated by source key


# ═══ §15 R3 4c: JSON-LD start == end == fetch day is a placeholder, never a date ═════════════
def test_jsonld_fetch_day_placeholder_rule() -> None:
    caribe = rd("tuboleta_ev_caribeaventura.html")  # REAL: evergreen row stamped start=end=2026-09-28
    ld = S.ld_events(caribe)[0]
    s, e = S.split_iso(ld["startDate"]), S.split_iso(ld["endDate"])
    assert S.ld_placeholder_date(s, e, "2026-09-28T20:00:00Z") is True
    assert S.ld_placeholder_date(s, e, "2026-09-29T04:59:00Z") is True    # still the 28th in Bogotá
    assert S.ld_placeholder_date(s, e, "2026-09-29T05:00:00Z") is False   # the 29th in Bogotá
    assert S.ld_placeholder_date(s, None, "2026-09-28T20:00:00Z") is True  # no endDate = same day
    assert S.parse_generic_jsonld(caribe, meta("https://tuboleta.com/es/eventos/parque-tematico-caribe-aventura"))[1] == ["ld_placeholder_date"]

    # SecuTix product whose JSON-LD collapsed to the fetch day: the visible <title> date wins.
    prod = "https://special.checkout.tuboleta.com/selection/event/date?productId=10230585113834"
    ph = rd("secutix_product_10230585113834.html").replace(
        '"startDate":"2027-01-09T19:00:00Z","endDate":"2027-01-09T20:00:00Z"',
        '"startDate":"2026-09-28T07:00:00Z","endDate":"2026-09-28T07:00:00Z"')
    c = must(S.parse_secutix_product(ph, meta(prod)))
    assert (c["start_date"], c["start_time"], c["time_confirmed"]) == ("2027-01-09", "19:00", True)
    assert "ld_placeholder_date" in c["flags"] and "ld_false_z_as_local" not in c["flags"]
    no_title = re.sub(r"<title>.*?</title>", "<title>Tuboleta</title>", ph, flags=re.S)
    assert S.parse_secutix_product(no_title, meta(prod)) is None  # placeholder LD + no visible date = nothing

    # IRONMAN: a fetch-day startDate is ignored; with no visible hero date there is no candidate.
    race = "https://www.ironman.com/races/im703-cartagena"
    im = rd("ironman_im703_cartagena.html").replace('"startDate": "2026-11-29T00:00:00+0000"', '"startDate": "2026-09-28T00:00:00+0000"')
    c0, why = S.parse_ironman(im, meta(race))
    c = must(c0)
    assert why is None and c["start_date"] == "2026-11-29" and "ld_placeholder_date" in c["flags"]
    assert S.parse_ironman(im.replace("November 29, 2026", ""), meta(race)) == (None, "no_date")

    # La Tiquetera: the visible function row stands alone; the page offset is still reported.
    lt = rd("latiquetera_ev_cepeda.html").replace("2027-05-08T19:00:00-05:00", "2026-09-28T19:00:00-05:00")
    c1, why = S.parse_latiquetera_event(lt, meta("https://latiquetera.com/event/andres-cepeda-en-cartagena"))
    c = must(c1)
    assert why is None and c["start_date"] == "2027-05-08" and c["tz_offset"] == "-05:00"
    assert "ld_placeholder_date" in c["flags"]


# ═══ §15 S2: per-adapter boilerplate denylists (real strings from the saved pages) ═══════════
def test_every_adapter_has_a_compiling_denylist() -> None:
    for e in S.SOURCES:
        deny = e["adapter"].denylist
        assert isinstance(deny, tuple) and deny, e["key"]
        for pat in deny:
            re.compile(pat, re.I)


def test_per_adapter_denylists_on_real_boilerplate() -> None:
    tb = S._deny(S.SOURCES_BY_KEY["tuboleta"])
    checkout = S.html_to_text(rd("secutix_product_10230585113834.html"))  # SecuTix cart chrome
    assert "El pedido ha sido cancelado" in checkout
    assert S.find_cancel_marker(checkout) == "cancelado"       # page-wide text would hide the concert…
    assert S.find_cancel_marker(checkout, tb) is None           # …the tuboleta denylist strips the cart chrome
    lt = S._deny(S.SOURCES_BY_KEY["latiquetera"])
    cepeda = S.html_to_text(rd("latiquetera_ev_cepeda.html"))
    assert S.find_finished(cepeda) is True                      # 'GENERAL Finalizado' price stages
    assert S.find_finished(cepeda, lt) is False                 # are never the event's status
    assert S.find_finished("Estado: Evento finalizado", lt) is True
    im = S._deny(S.SOURCES_BY_KEY["ironman"])
    assert S.find_sold_out("Registration Sold Out November 29, 2026") is True
    assert S.find_sold_out("Registration Sold Out November 29, 2026", im) is False
    # A real cancel INSIDE the event block survives every denylist.
    for key in ("latiquetera", "tuboleta", "ironman", "ipcc", "cartagenaplay"):
        assert S.find_cancel_marker("Andrés Cepeda en Cartagena | CANCELADO por la organización",
                                    S._deny(S.SOURCES_BY_KEY[key])) == "cancelado", key
    # The parsed candidates carry no false markers from their pages' boilerplate.
    p = must(S.parse_secutix_product(rd("secutix_product_10230585113834.html"),
                                     meta("https://special.checkout.tuboleta.com/selection/event/date?productId=10230585113834")))
    assert p["markers"]["cancel"] is None


# ═══ §15 S1: Fever honours only -05:00 ═══════════════════════════════════════════════════════
def test_fever_utc_offset_is_dropped_not_shifted() -> None:
    html = rd("fever_plan_324036.html").replace('"2026-09-29T00:00:00-05:00"', '"2026-09-29T02:00:00Z"')
    assert S.parse_fever_plan(html, meta("https://feverup.com/m/324036/en")) == (None, "tz_offset_not_bogota")


def test_ticketshop_placeholder_time_is_null() -> None:
    d = json.loads(rd("ticketshop_evento_detone_cucuta.json"))
    d["data"]["auditorio"]["id_ciudad"] = "176"
    d["data"]["hora_inicio"] = "00:00:00"
    c = must(S.parse_ticketshop_event(json.dumps(d), meta("https://api.ticketshop.com.co/api/evento/x"))[0])
    assert c["start_time"] is None and c["time_confirmed"] is False and c["evidence"][0]["start_time"] is None


# ═══ CCC: the human-visible date is EventON's box + weekday, cross-checked with microdata ═══
def test_ccc_visible_date_box_cross_check() -> None:
    u = "https://cccartagena.com/events/la-pelota-de-letras-de-andres-lopez/"
    html = rd("ccc_ev_la-pelota-de-letras-de-andres-lopez.html")
    c = must(S.parse_ccc_event(html, meta(u))[0])
    assert c["evidence"][0]["date_text"] == "03 Oct · (Sábado) 1:00 a.m. - 1:00 a.m." and c["evidence"][0]["visible"] is True
    moved = html.replace("<em class='date'>03</em>", "<em class='date'>04</em>")
    assert S.parse_ccc_event(moved, meta(u)) == (None, "visible_date_disagrees")
    wrong_day = html.replace("(Sábado)", "(Domingo)")
    assert S.parse_ccc_event(wrong_day, meta(u)) == (None, "weekday_mismatch")


def test_date_visible_only_when_visible_text_parses() -> None:
    u = "https://www.hayfestival.com/m-222-cartagena-2026.aspx"
    html = rd("hay_m222_cartagena_2026.html").replace(
        '<time datetime="2026-01-29 12:00">jueves 29 de enero 2026, 12.00h COT</time>',
        '<time datetime="2026-01-29 12:00">Ver horario</time>')
    items, _ = S.parse_hay_listing(html, meta(u), programme_year=2026)
    c = by_title(items, "Diego Luna")
    assert c["start_date"] == "2026-01-29" and c["evidence"][0]["visible"] is False and c["time_confirmed"] is False


# ═══ evidence carries this page's parse; contract with events_gate ═══════════════════════════
def test_evidence_carries_the_page_parse() -> None:
    items, _ = S.parse_agenda_feed("ipcc", rd("ipcc_feed.xml"), "2026-09-28T20:00:00Z", 200)
    nautico = by_title(items, "Festival Náutico")["evidence"][0]
    assert (nautico["start_date"], nautico["end_date"], nautico["start_time"]) == ("2026-11-13", "2026-11-14", None)
    bando = by_title(items, "Gran Desfile de Independencia")["evidence"][0]
    assert (bando["start_date"], bando["start_time"]) == ("2026-11-12", "10:00")
    d = json.loads(rd("ticketshop_evento_detone_cucuta.json"))
    d["data"]["auditorio"]["id_ciudad"] = "176"
    c = must(S.parse_ticketshop_event(json.dumps(d), meta("https://api.ticketshop.com.co/api/evento/x"))[0])
    assert c["start_time"] == "19:00" and c["evidence"][0]["start_time"] is None  # API time: never evidence of a time


def test_gate_contract_country_and_independent_agreement() -> None:
    import events_gate as G  # pure module (no Mongo)

    def verdict(c: Optional[dict[str, Any]]) -> str:
        return str(G.country_check(must(c))[0])

    assert verdict(S.parse_cmf_home(rd("cmf_home.html"), meta("https://cartagenamusicfestival.com/"))[0][0]) == "pass"
    assert verdict(S.parse_hay_inicio(rd("hay_inicio.html"), meta("https://www.hayfestival.com/cartagena/inicio"))[0][0]) == "pass"
    assert verdict(S.parse_ficci_home(rd("ficci_home.html"), meta("https://www.ficcifestival.com/"))[0][0]) == "pass"
    assert verdict(S.parse_ironman(rd("ironman_im703_cartagena.html"), meta("https://www.ironman.com/races/im703-cartagena"))[0]) == "pass"
    cepeda, _ = S.parse_latiquetera_event(rd("latiquetera_ev_cepeda.html"), meta(CEPEDA))
    assert verdict(cepeda) == "pass"
    rows = S.parse_cmf_programme(rd("cmf_programacion.html"))
    launch_row = next(r for r in rows if "lanzamiento" in r["show_url"])
    launch, _ = S.parse_cmf_show(rd("cmf_show_concierto-de-lanzamiento.html"),
                                 meta("https://cartagenamusicfestival.com/show-item/concierto-de-lanzamiento/"), launch_row, 2027)
    assert verdict(launch) == "fail"                                    # Bogotá launch on the CMF site
    es, _ = S.parse_fever_plan(rd("fever_spain_plan_587428.html"), meta("https://feverup.com/m/587428"))
    assert verdict(es) == "fail"                                        # Cartagena, Spain
    winter, _ = S.parse_hay_listing(rd("hay_m245_winter_weekend_2026.html"), meta("https://www.hayfestival.com/m-245-winter-weekend-2026.aspx"))
    assert all(verdict(w) == "fail" for w in winter)                     # Hay-on-Wye
    # Two independent tier<=3 pages (organizer show page + ticketer list) agree on date AND time.
    fuego_row = next(r for r in rows if "fuego-y-geometria" in r["show_url"])
    show, _ = S.parse_cmf_show(rd("cmf_show_fuego-y-geometria.html"),
                               meta("https://cartagenamusicfestival.com/show-item/fuego-y-geometria/"), fuego_row, 2027)
    lst, _, _ = S.parse_secutix_list(rd("secutix_special_list.html"), meta("https://special.checkout.tuboleta.com/list/events"))
    ticket = by_title(lst, "Concierto inaugural")
    ev = [must(show)["evidence"][0], ticket["evidence"][0]]
    assert G.independent_agreement(ev, "2027-01-09", "19:00") is True
    assert G.independent_agreement(ev, "2027-01-10") is False


# ═══ generic JSON-LD parser (admin gate-check only) ═══════════════════════════════════════════
def test_generic_jsonld_parser_for_gate_check() -> None:
    c, skips = S.parse_generic_jsonld(rd("latiquetera_ev_cepeda.html"), meta(CEPEDA))
    assert skips == [] and len(c) == 1
    c0 = c[0]
    assert (c0["start_date"], c0["start_time"], c0["time_confirmed"], c0["evidence"][0]["visible"]) == ("2027-05-08", "19:00", True, True)
    assert c0["source_key"] == "latiquetera" and c0["source_tier"] == 2 and "generic_jsonld" in c0["flags"]
    prod = "https://special.checkout.tuboleta.com/selection/event/date?productId=10230585113834"
    p = S.parse_generic_jsonld(rd("secutix_product_10230585113834.html"), meta(prod))[0][0]
    assert (p["start_date"], p["start_time"], p["time_confirmed"], p["tz_offset"]) == ("2027-01-09", "19:00", True, "Z")
    frag = S.parse_generic_jsonld(rd("tuboleta_ev_fragmentado.html"), meta("https://tuboleta.com/es/eventos/fragmentado-cartagena"))[0][0]
    assert frag["start_time"] is None  # T07:00-0500 is TuBoleta's placeholder, never a time
    im = S.parse_generic_jsonld(rd("ironman_im703_cartagena.html"), meta("https://www.ironman.com/races/im703-cartagena"))[0][0]
    assert (im["start_date"], im["start_time"], im["evidence"][0]["date_text"]) == ("2026-11-29", None, "November 29, 2026")
    assert S.parse_generic_jsonld(rd("hay_inicio.html"), meta("https://www.hayfestival.com/cartagena/inicio")) == ([], ["no_jsonld_event"])
    unknown = "https://organizador.example.co/evento"
    body = ('<html><body><h1>Noche de Boleros</h1><p>Sábado 14 de noviembre de 2026</p>'
            '<script type="application/ld+json">{"@type":"Event","name":"Noche de Boleros",'
            '"startDate":"2026-11-14T20:00:00-05:00","eventStatus":"https://schema.org/EventCancelled",'
            '"location":{"@type":"Place","name":"Teatro Adolfo Mejía"}}</script></body></html>')
    g = S.parse_generic_jsonld(body, meta(unknown))[0][0]
    assert g["source_key"] == "generic" and g["source_tier"] == 6 and g["markers"]["cancel"] == "cancelled"
    assert (g["start_date"], g["start_time"], g["time_confirmed"]) == ("2026-11-14", "20:00", False)  # -05:00, not visible


# ═══ §15 X4: URL guard, per redirect hop ═════════════════════════════════════════════════════
@pytest.mark.parametrize("url,reason", [
    ("http://127.0.0.1/", "private_address"),
    ("http://10.0.0.5/x", "private_address"),
    ("http://169.254.169.254/latest/meta-data", "private_address"),
    ("http://100.64.0.1/", "private_address"),
    ("http://[::1]/", "private_address"),
    ("http://[::ffff:127.0.0.1]/", "private_address"),
    ("https://example.com:8443/", "port_not_allowed"),
    ("ftp://example.com/", "bad_url"),
    ("https://user:pw@example.com/", "credentials_in_url"),
    ("https://93.184.216.34/evento", None),
])
def test_public_url_guard_literals(url: str, reason: Optional[str]) -> None:
    assert run(S.public_url_guard(url)) == reason


def test_public_url_guard_resolution_and_redirect_hops() -> None:
    def resolver(addrs: list[str], fail: bool = False) -> Callable[[str, int], Any]:
        async def res(host: str, port: int) -> list[str]:
            if fail:
                raise OSError("nxdomain")
            return addrs
        return res

    assert run(S.public_url_guard("https://intranet.example/", resolver=resolver(["10.1.2.3"]))) == "private_address"
    assert run(S.public_url_guard("https://mixed.example/", resolver=resolver(["93.184.216.34", "127.0.0.1"]))) == "private_address"
    assert run(S.public_url_guard("https://ok.example/", resolver=resolver(["93.184.216.34"]))) is None
    assert run(S.public_url_guard("https://nx.example/", resolver=resolver([], fail=True))) == "dns_error"
    r = Router({"https://93.184.216.34/start": (302, "", {"location": "http://127.0.0.1/admin"}),
                "http://127.0.0.1/admin": (200, "secret", {})})
    res = run(_with(r, lambda c: S.fetch(c, "https://93.184.216.34/start", url_guard=S.public_url_guard)))
    assert res["blocked_reason"] == "guard:private_address" and r.seen == ["https://93.184.216.34/start"]
    r2 = Router({"http://10.0.0.5/": (200, "x", {})})
    res2 = run(_with(r2, lambda c: S.fetch(c, "http://10.0.0.5/", url_guard=S.public_url_guard)))
    assert res2["blocked_reason"] == "guard:private_address" and r2.seen == []


# ═══ umbrella + verbatim-quote rechecks on the IPCC agenda article ═══════════════════════════
ART = "https://ipcc.gov.co/alcaldia-de-cartagena-presento-la-programacion-oficial-de-las-fiestas-de-independencia-del-11-de-noviembre-2026/"


def test_umbrella_recheck_checks_span_coverage() -> None:
    page = rd("ipcc_art_programacion_fiestas_2026.html")
    first_row = "Viernes 2 de octubre: Preludio Localidad 1 (Canapote) con Son Cartagena, Mr Black, Karen Lizarazo y David Pabón."
    umbrella = {"source_key": None, "source_url": ART, "recheck_url": ART, "is_umbrella": True,
                "title": {"es": "Fiestas de Independencia 2026"}, "start_date": "2026-10-02", "end_date": "2026-11-15",
                "start_time": None, "evidence": [{"url": ART, "date_text": first_row}]}
    ok = recheck(Router({ART: (200, page, {})}), umbrella)
    # never 'date_changed' because the first sub-row is a single day
    assert ok["outcome"] == "success" and ok["parsed"] == {"start_date": "2026-10-02", "end_date": "2026-11-15", "start_time": None}
    assert ok["detail"] == "umbrella_span_covered;page_span=2026-10-02..2026-11-16"  # wider page span is reported
    early = recheck(Router({ART: (200, page, {})}), {**umbrella, "start_date": "2026-09-25"})
    assert early["outcome"] == "date_changed" and early["marker"] == "umbrella_span_changed"
    assert early["parsed"]["start_date"] == "2026-10-02"
    empty = recheck(Router({ART: (200, "<html><body><p>Sin agenda</p></body></html>", {})}), umbrella)
    assert empty["outcome"] == "not_found"


def test_recheck_matches_a_verbatim_quote_prefix_of_the_row() -> None:
    page = rd("ipcc_art_programacion_fiestas_2026.html")
    jlg = {"source_key": None, "source_url": ART, "recheck_url": ART, "title": {"es": "Juan Luis Guerra (Festival Náutico)"},
           "start_date": "2026-11-13", "end_date": "2026-11-13", "start_time": None,
           "evidence": [{"url": ART, "date_text": "Viernes 13 de noviembre: Con Juan Luis Guerra, como gran artista central"}]}
    out = recheck(Router({ART: (200, page, {})}), jlg)
    assert out["outcome"] == "success" and out["parsed"]["start_date"] == "2026-11-13"
    # A quote too short to be unique never matches by containment.
    vague = {**jlg, "title": {"es": "Otro evento cualquiera"}, "evidence": [{"url": ART, "date_text": "13 de noviembre"}]}
    assert recheck(Router({ART: (200, page, {})}), vague)["outcome"] == "not_found"


def test_text_on_page_for_manual_verify() -> None:
    page = rd("hay_inicio.html")
    assert S.text_on_page(page, "del 28 al 31 de enero del 2027")
    assert S.text_on_page(page, "DEL 28 AL 31  de ENERO del 2027")      # case / spacing
    assert not S.text_on_page(page, "del 27 al 31 de enero del 2027")
    assert not S.text_on_page(page, "2027")                              # too short to prove anything
    ld_only = '<html><body><p>Hola</p><script type="application/ld+json">{"startDate":"2027-01-28"}</script></body></html>'
    assert not S.text_on_page(ld_only, "2027-01-28")                     # JSON-LD is not visible text


def test_redirect_into_never_crawl_host_is_not_followed() -> None:
    src = "https://ipcc.gov.co/agenda-alcaldia/"
    r = Router({src: (301, "", {"location": "https://www.cartagena.gov.co/noticias/agenda"}),
                "https://www.cartagena.gov.co/noticias/agenda": (200, "<html>x</html>", {})})
    res = run(_with(r, lambda c: S.fetch(c, src)))
    assert res["blocked_reason"] == "never_crawl" and r.seen == [src]
