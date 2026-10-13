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
    # step-free (LIVE since 4A)
    "¿restaurantes accesibles en silla de ruedas?": "step_free",
    "wheelchair accessible places in the walled city": "step_free",
    "lugares sin escalones": "step_free",
    "restaurants accessibles en fauteuil roulant": "step_free",
    # family (LIVE since 4B)
    "¿qué playa es buena para mi toddler?": "family",
    "calm beach for kids with lifeguard": "family",
    "restaurante con menú infantil y silla para niños": "family",
    # 4B live-probe regression: the SINGULAR never fired the lens and Luna freestyled an
    # invented "ride-hailing has car seats" claim — these must route to family forever.
    "vamos con un niño de 3 años, ¿qué planes hay?": "family",
    "¿consiguen silla de auto para el traslado?": "family",
    "traveling with my child, is there a car seat?": "family",
    "on voyage avec un enfant de 4 ans": "family",
    "viajo com uma criança pequena": "family",
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


def test_gated_lens_injects_only_its_decline_lines(monkeypatch) -> None:  # V7 machinery
    """All lenses are live since 4C — synthetically re-gate women to prove the gate
    still leaks nothing when a lens falls below threshold."""
    import copy
    import os as _os
    d2 = copy.deepcopy(DATA)
    next(l for l in d2["lenses"] if l["key"] == "women_verified")["min_fill"] = 99
    monkeypatch.setitem(L._cache, "lenses",
                        {"mtime": _os.path.getmtime(L._LENSES_PATH), "data": d2})
    L._trigger_cache.update(mtime=None, res=None)
    try:
        for q in ("¿es seguro para una mujer sola esta noche?",
                  "safe spots for a woman alone tonight"):
            hit = _lens(_ctx(q), "women_verified")
            assert hit["live"] is False
            assert "entries" not in hit, "a gated lens must not leak entries"
            dl = hit["decline_line"]
            assert all(isinstance(dl[k], str) and dl[k].strip() for k in ("es", "en", "fr", "pt"))
            body = json.dumps(hit, ensure_ascii=False).lower()
            # the real leak vector is venue material — a decline may name the attributes
            # it is waiting on, but never a venue or a rating
            for invented in ("ptr_", "attr_", "svc_", "harassment_rating"):
                assert invented not in body, f"{invented} leaked into a gated reference"
    finally:
        L._trigger_cache.update(mtime=None, res=None)


def test_live_step_free_entries_are_high_anchors_plus_advisories() -> None:  # 4A
    hit = _lens(_ctx("¿hay rampa para silla de ruedas?"), "step_free")
    assert hit["live"] is True and "decline_line" not in hit
    venue_entries = [e for e in hit["entries"] if e.get("kind") != "advisory"]
    advisories = [e for e in hit["entries"] if e.get("kind") == "advisory"]
    names = {e["name"] for e in venue_entries}
    assert {"Playa 5 (Bocagrande)", "Museo del Oro Zenú"} <= names
    for e in venue_entries:
        assert e["source_name"] and e["note_es"], e
        assert e["partner_id"], e  # open_partner stays actionable
    # VERIFY ("Reportado por viajeros") rows never reach the LLM
    assert "Castillo San Felipe de Barajas" not in names
    assert "Las Murallas" not in names
    # the honest-absence lines ride as entries — taxis adaptados stated as unconfirmed
    assert any("taxis adaptados" in (e.get("note_es") or "") for e in advisories)
    assert all(e.get("advisory_kind") in ("reported", "unverified") for e in advisories)


def test_live_family_entries_are_high_anchors_plus_advisories() -> None:  # 4B
    hit = _lens(_ctx("¿qué playa es buena para mi toddler?"), "family")
    assert hit["live"] is True and "decline_line" not in hit
    venue_entries = [e for e in hit["entries"] if e.get("kind") != "advisory"]
    advisories = [e for e in hit["entries"] if e.get("kind") == "advisory"]
    names = {e["name"] for e in venue_entries}
    assert {"Aviario Nacional de Colombia", "Museo del Oro Zenú", "Hospital Serena del Mar"} <= names
    for e in venue_entries:
        assert e["source_name"] and e["note_es"] and e["partner_id"], e
    # VERIFY ("Reportado por viajeros") picks never reach the LLM
    for reported in ("Playa de Castillogrande", "Isla del Sol", "Isla del Encanto",
                     "Palmarito Beach", "Castillo San Felipe de Barajas"):
        assert reported not in names, reported
    # the car-seat/life-jacket reality rides as an advisory entry (confirm at booking)
    assert any("al reservar" in (e.get("note_es") or "") for e in advisories)


def test_women_decline_redirects_only_to_verified_adjacent_data() -> None:
    # The decline_line stays in data as the regression gate (if fill ever drops below
    # min_fill again) — women is LIVE since 4C, so read it from DATA, not routing.
    dl = next(l for l in DATA["lenses"] if l["key"] == "women_verified")["luna"]["decline_line"]
    assert "DATT" in dl["es"] and "DATT" in dl["en"]  # taxi fares are the honest redirect
    assert "verificado" in dl["es"] or "verificadas" in dl["es"] or "reales" in dl["es"]


def test_hard_gate_is_now_the_safety_guard() -> None:
    """§5 (4C): every lens is live, so gated_decline is None — the deterministic slot
    is the SAFETY GUARD: women/safety questions answer with resource_line verbatim."""
    w = next(ln for ln in DATA["lenses"] if ln["key"] == "women_verified")
    for q, lg in (("safe spots for a woman alone tonight", "en"),
                  ("¿es seguro para una mujer sola esta noche?", "es"),
                  ("des endroits sûrs pour une femme seule ?", "fr"),
                  ("é seguro para uma mulher sozinha à noite?", "pt")):
        assert L.gated_decline_payload(q, lg) is None, q  # women is live
        p = L.safety_guard_payload(q, lg)
        assert p is not None, q
        assert p["lens_gate"] == "women_safety" and p["language"] == lg
        assert p["message"] == w["luna"]["resource_line"][lg].strip()
        assert p["recommendations"] == []
        assert p["actions"] == [{"type": "navigate", "screen": "ayuda",
                                 "label": L._SAFETY_ACTION_LABEL[lg]}]
    # live lenses still answer their topics through lens_reference + LLM
    assert L.gated_decline_payload("best sunset photo spots", "en") is None
    assert L.gated_decline_payload("estoy de crucero, mi escala", "es") is None
    assert L.gated_decline_payload("restaurants accessibles en fauteuil roulant", "fr") is None
    assert L.gated_decline_payload("¿qué playa es buena para mi toddler?", "es") is None
    # mixed photo+woman → the safety guard wins (deterministic resources, never freestyle)
    mixed = L.safety_guard_payload("fotos del atardecer para una mujer sola", "es")
    assert mixed is not None and mixed["lens_gate"] == "women_safety"
    # no safety topic at all → None
    assert L.safety_guard_payload("cena romántica para dos", "es") is None


def test_safety_guard_probe_bank_catches_the_misses() -> None:  # 4C — the drop's real work
    """The 4C recon matrix: 16 of these MISSED every gate pre-4C and freestyled.
    Each must now answer deterministically (guard) — across languages, singular,
    slang, indirect and incident phrasings."""
    must_guard = [
        "¿es seguro para una mujer sola esta noche?", "safe spots for a woman alone tonight",
        "viajo sola, ¿dónde puedo salir?", "des endroits sûrs pour une femme seule ?",
        "é seguro para uma mulher sozinha?",
        "mi hija viaja sola a cartagena",
        "una amiga viaja sola, ¿consejos?",
        "¿es peligroso getsemaní de noche?",
        "is it dangerous to walk at night?",
        "¿me pueden drogar la bebida?",
        "scopolamine drink spiking cartagena?",
        "tengo una cita de tinder, ¿precauciones?",
        "me da miedo salir de noche sola",
        "¿van a robarme en el centro?",
        "qué tan seguro es getsemaní?",
        "is it sketchy at night downtown?",
        "c'est dangereux de sortir seule la nuit ?",
        "é perigoso andar à noite?",
        "como mujer, ¿qué zonas evito?",
        "any areas to avoid as a woman?",
        "me siguieron anoche, ¿a quién llamo?",
        "¿dónde denuncio un acoso?",
    ]
    for q in must_guard:
        p = L.safety_guard_payload(q, "es")
        assert p is not None and p["lens_gate"] == "women_safety", f"guard missed: {q!r}"
    # negatives: food/water/swim/insurance and family-calm questions keep their own
    # authorities — the guard must NOT swallow them
    for q in ("is the tap water safe to drink?",
              "¿es seguro comer ceviche callejero?",
              "is it safe to swim at playa blanca?",
              "¿qué playa es segura para mi toddler?",
              "necesito un seguro de viaje, ¿recomiendas?",
              "mejores playas para niños"):
        assert L.safety_guard_payload(q, "es") is None, f"guard overreached: {q!r}"


def test_agent_wires_the_hard_gate_before_the_llm() -> None:
    src = (BACKEND / "ai_agent.py").read_text(encoding="utf-8")
    assert "_lens_gated_payload(user_text, decl_lang)" in src
    gate_pos = src.index("_lens_gated_payload(user_text, decl_lang)")
    assert gate_pos < src.index("detect_event_intent(user_text"), "gate must sit before the events gate"
    assert src.index("cmw_payload is not None") < gate_pos, "CMW gate stays first"


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
                # three honest entry shapes: sourced venue/pin, the port_day kit, or a 4A
                # advisory (an "unverified" advisory is sourceless BY DESIGN — it states
                # that something is NOT confirmed, which is the opposite of a claim).
                assert all(e.get("source_name") or e.get("kind") in ("port_day", "advisory")
                           for e in hit["entries"]), q
            else:
                assert "entries" not in hit and hit["decline_line"], q
