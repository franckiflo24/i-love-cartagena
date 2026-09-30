"""LENSES Luna wiring: deterministic trigger routing, live answers carry source,
gated lenses inject ONLY their decline lines (never an invented trust claim),
prompt-rule regression (docs/lenses/DESIGN.md §5 · V7). No LLM, no network."""
from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import lenses as L  # noqa: E402

DATA = json.loads((BACKEND / "data" / "lenses.json").read_text(encoding="utf-8"))

# question → the lens that must answer it (REQUIRED, test_city_context style)
REQUIRED = {
    # golden hour (live)
    "¿dónde tomo las mejores fotos al atardecer?": "golden_hour",
    "best sunset photo spot right now": "golden_hour",
    "los lugares más fotogénicos del centro": "golden_hour",
    "spots para fotos instagram": "golden_hour",
    "où voir le coucher de soleil": "golden_hour",
    "melhor lugar para o pôr do sol": "golden_hour",
    "quiero fotos en la hora dorada": "golden_hour",
    # port day (live) — multiword, so plain yacht-charter asks stay untouched
    "estoy de crucero, ¿qué hago en mi escala?": "port_day",
    "one day port day itinerary": "port_day",
    "mi barco sale a las 5, all aboard": "port_day",
    "¿cuánto es el taxi? estamos de escala": "port_day",
    # step-free (gated)
    "¿restaurantes accesibles en silla de ruedas?": "step_free",
    "wheelchair accessible places in the walled city": "step_free",
    "lugares sin escalones": "step_free",
    "restaurants accessibles en fauteuil roulant": "step_free",
    # family (gated)
    "¿qué playa es buena para mi toddler?": "family",
    "calm beach for kids with lifeguard": "family",
    "restaurante con menú infantil y silla para niños": "family",
    # women (gated) — the headline test
    "¿es seguro para una mujer sola esta noche?": "women_verified",
    "safe spots for a woman alone tonight": "women_verified",
    "viajo sola, ¿dónde puedo salir segura?": "women_verified",
}

FALSE_POSITIVES = [
    "quiero alquilar un yate de lujo",          # charter, not a port call
    "recomiéndame un rooftop para cenar",       # dining ask, no photo/sunset wording
    "¿cuánto cuesta el transcaribe?",           # city hub territory
    "música en vivo esta noche",
    "book me a table for two",
]


def _ctx(q: str):
    return L.luna_context(q)


def _lens(ctx, key):
    assert ctx is not None, "no lens_reference produced"
    hit = next((x for x in ctx["lenses"] if x["key"] == key), None)
    assert hit is not None, f"{key} not in {[x['key'] for x in ctx['lenses']]}"
    return hit


def test_required_questions_route_to_their_lens() -> None:
    for q, key in REQUIRED.items():
        _lens(_ctx(q), key)


def test_false_positives_stay_silent() -> None:
    for q in FALSE_POSITIVES:
        ctx = _ctx(q)
        assert ctx is None, f"unexpected lens_reference for: {q!r} -> {ctx and [x['key'] for x in ctx['lenses']]}"


def test_live_golden_hour_answers_carry_source_and_etiquette() -> None:
    hit = _lens(_ctx("best sunset photo spots"), "golden_hour")
    assert hit["live"] is True
    assert 1 <= len(hit["entries"]) <= 6
    for e in hit["entries"]:
        assert e["name"] and e["note_es"] and e["source_name"], e
        assert e["access_es"], e  # access tier always stated (F3)
    assert hit["sunset_by_month"]["9"] == "17:52"
    assert "decline_line" not in hit
    # palenquera etiquette reaches Luna wherever the pin carries it
    all_pins = {p["name"]: p for p in DATA["pins"]}
    trin = next((e for e in hit["entries"] if "Trinidad" in (e["name"] or "")), None)
    if trin is not None:
        assert "acuerda el precio" in (trin["etiquette_es"] or "")


def test_live_port_day_carries_official_fares_not_ship_names() -> None:
    hit = _lens(_ctx("estoy de crucero, escala de un día"), "port_day")
    assert hit["live"] is True
    kit = hit["entries"][0]
    assert kit["kind"] == "port_day"
    assert any(f["confidence"] == "HIGH" for f in kit["fares"])  # DATT rows, single owner
    body = json.dumps(hit, ensure_ascii=False)
    assert "Carnival" not in body and "cruisemapper" not in body.lower()  # never ship names to the LLM


def test_gated_lens_injects_only_its_decline_lines() -> None:  # V7 headline
    for q, key in (("¿es seguro para una mujer sola esta noche?", "women_verified"),
                   ("calm beach for my toddler", "family"),
                   ("¿hay rampa para silla de ruedas?", "step_free")):
        hit = _lens(_ctx(q), key)
        assert hit["live"] is False
        assert "entries" not in hit, f"{key}: a gated lens must not leak entries"
        dl = hit["decline_line"]
        assert all(isinstance(dl[k], str) and dl[k].strip() for k in ("es", "en", "fr", "pt"))
        body = json.dumps(hit, ensure_ascii=False).lower()
        # the real leak vector is venue material — a decline may name the attributes
        # it is waiting on ("lifeguards, high chairs"), but never a venue or a rating
        for invented in ("ptr_", "attr_", "svc_", "harassment_rating"):
            assert invented not in body, f"{key}: {invented} leaked into a gated reference"


def test_women_decline_redirects_only_to_verified_adjacent_data() -> None:
    dl = _lens(_ctx("safe for a woman alone?"), "women_verified")["decline_line"]
    assert "DATT" in dl["es"] and "DATT" in dl["en"]  # taxi fares are the honest redirect
    assert "verificado" in dl["es"] or "verificadas" in dl["es"] or "reales" in dl["es"]


def test_prompt_rule_present_and_binding() -> None:
    src = (BACKEND / "ai_agent.py").read_text(encoding="utf-8")
    assert "AUTORIDAD LENTES" in src
    assert "lens_reference" in src
    rule = src.split("AUTORIDAD LENTES", 1)[1][:1600]
    for must in ("decline_line", "PROHIBIDO", "open_partner", "sunset_by_month"):
        assert must in rule, must
    assert "_lens_context(user_text)" in src  # injected into build_context_snapshot


def test_question_bank_never_produces_untagged_claims() -> None:
    """≥20 questions: every produced reference is either live-with-sources or a
    pure decline. Nothing in between, in any language."""
    bank = list(REQUIRED) + [
        "fotos bonitas cerca de las murallas", "sunrise photo walk", "golden hour rooftops",
        "port day with kids", "escala corta, ¿alcanzo el castillo?",
        "acessível para cadeira de rodas?", "sécurité pour une femme seule",
        "playa tranquila para bebés", "photo spots getsemani",
    ]
    assert len(bank) >= 20
    for q in bank:
        ctx = _ctx(q)
        if ctx is None:
            continue
        for hit in ctx["lenses"]:
            if hit["live"]:
                assert all(e.get("source_name") or e.get("kind") == "port_day"
                           for e in hit["entries"]), q
            else:
                assert "entries" not in hit and hit["decline_line"], q
