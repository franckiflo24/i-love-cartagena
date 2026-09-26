"""City hub (ciudad) — Luna routing + honesty guards. Pure unit tests: no network, no Mongo.

Run from the repo root:  python3 -m pytest backend/tests/test_city_context.py -q
"""
import importlib.util
import json
import os
import re
import sys

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(BACKEND)
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

import ai_agent as A  # noqa: E402


def _route(text):
    ctx = A._city_context(text)
    return [m["id"] for m in (ctx or {}).get("modules", [])]


# Real city-hub intents → the module that must come FIRST.
REQUIRED = {
    "cuánto cuesta el bus": "transcaribe",
    "cuánto vale el bus": "transcaribe",
    "how much is transcaribe": "transcaribe",
    "buseta a bocagrande": "transcaribe",
    "quiero ir a las islas del rosario": "muelle-bodeguita",
    "cuánto es la tasa portuaria": "muelle-bodeguita",
    "quiero pagar la tasa": "muelle-bodeguita",
    "how much is the pier fee": "muelle-bodeguita",
    "cuánto es el pasaje a barú": "muelle-bodeguita",
    "je veux prendre un bateau pour les îles du rosario": "muelle-bodeguita",
    "cuánto cuesta el castillo san felipe": "monumentos",
    "how much is the fort": "monumentos",
    "precio del monumento": "monumentos",
    "can I buy the city pass in AMO": "monumentos",
    "combien coûte le château": "monumentos",
    "cuánto vale la carroza": "coches-electricos",
    "cuánto cuesta el coche por el centro": "coches-electricos",
    "paseo en coche eléctrico": "coches-electricos",
    "transcaribe acuático cuando arranca": "transcaribe-acuatico",
    "cuánto cuesta el taxi al aeropuerto": "taxis",
    "how much from the airport to the old city": "taxis",
    "cuánto cobran del aeropuerto a bocagrande": "taxis",
}

# Unrelated messages that used to drag a ~3K-token module in through substring triggers.
FALSE_POSITIVES = [
    "where is the toilet", "my mobile phone died", "se me pierde el vuelo", "quiero una botella de vino",
    "hay legislación sobre esto", "candidiasis", "un fuerte dolor de cabeza", "the hotel has a chateau vibe",
    "hotel en castillogrande", "quiero un café bien fuerte", "dónde está la gorda de botero",
    "where can I buy a mobile sim card", "comida con chile", "me duele la pierna, farmacia cerca",
    "un lugar aislado y tranquilo", "electric bike rental", "alquiler de coches", "best rooftop in the city",
    "is the tap water safe", "cuál es la tasa de cambio hoy", "busco un restaurante", "muévete rápido",
]


@pytest.mark.parametrize("text,expected", sorted(REQUIRED.items()))
def test_required_prompt_routes_to_module(text, expected):
    got = _route(text)
    assert got and got[0] == expected, f"{text!r} -> {got}"


@pytest.mark.parametrize("text", FALSE_POSITIVES)
def test_unrelated_message_fires_no_module(text):
    assert _route(text) == [], f"{text!r} fired {_route(text)}"


def test_plain_bus_question_never_pulls_the_water_bus():
    assert _route("cuánto vale el bus") == ["transcaribe"]


def test_trigger_regex_is_word_bounded_but_keeps_spaced_edges():
    assert A._city_trigger_re("ile").search("mobile") is None
    assert A._city_trigger_re("ile").search("une ile") is not None
    # "bus to " keeps its open trailing edge so "bus to bocagrande" still matches
    assert A._city_trigger_re("bus to ").search("take the bus to bocagrande") is not None


def test_city_compact_forwards_decline_lines_in_four_languages():
    ctx = A._city_context("cuánto es la tasa portuaria")
    luna = ctx["modules"][0]["luna"]
    for lang in ("es", "en", "fr", "pt"):
        assert luna.get(f"decline_line_{lang}"), lang
    assert luna["amo_sells"] is False


def test_prompt_no_longer_teaches_a_single_port_tax():
    assert re.search(r"31[.,]500", A.SYSTEM_PROMPT) is None
    assert "open_port_tax_checkout\", \"qty\"" not in A.SYSTEM_PROMPT
    assert "Tasa Portuaria" not in A.AGENT_BIO
    assert "payments_live" in A.SYSTEM_PROMPT
    # The knowledge block may only mention 31,500 to debunk it.
    for hit in re.finditer(r"31[.,]500", json.dumps(A.CARTAGENA_KNOWLEDGE, ensure_ascii=False)):
        window = json.dumps(A.CARTAGENA_KNOWLEDGE, ensure_ascii=False)[max(0, hit.start() - 60):hit.start()]
        assert "NO single official 'tasa portuaria' of" in window, window


def test_every_module_declines_selling():
    data = json.load(open(os.path.join(BACKEND, "data", "city_modules.json"), encoding="utf-8"))
    for m in data["modules"]:
        assert m["status"] != "en_vivo", m["id"]
        assert m["luna"]["amo_sells"] is False, m["id"]


def test_public_view_strips_internal_keys():
    spec = importlib.util.spec_from_file_location(
        "sync_city_data", os.path.join(REPO, "scripts", "sync-city-data.py"))
    sync = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sync)
    data = json.load(open(os.path.join(BACKEND, "data", "city_modules.json"), encoding="utf-8"))
    public = sync.public_view(data)
    for m in public["modules"]:
        assert "research_notes" not in m and "luna" not in m, m["id"]
    # the source of truth keeps them
    assert all("luna" in m and "research_notes" in m for m in data["modules"])
    # and the shipped frontend copy IS the public view
    shipped = json.load(open(os.path.join(REPO, "frontend", "public", "data", "city", "modules.json"), encoding="utf-8"))
    assert shipped == public
