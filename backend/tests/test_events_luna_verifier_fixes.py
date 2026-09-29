"""EVENTS-ELITE Luna: regression tests for the independent verifiers' findings (detector, prose
guard, side channels, follow-ups, cards). Each test fails on the pre-fix code and passes after.

Drives ai_agent.run_agent_turn end to end with the builders' stub DB + a fake LLM
(tests/test_events_luna.py helpers). Pure: no network, no Atlas, never imports server.py.

Run: cd backend && python -m pytest -q tests/test_events_luna_verifier_fixes.py
"""
from __future__ import annotations

import os
import sys
from typing import Any, Dict, List

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS = os.path.dirname(os.path.abspath(__file__))
for p in (BACKEND, TESTS):
    if p not in sys.path:
        sys.path.insert(0, p)

import events_gate as G  # noqa: E402
import events_runtime as R  # noqa: E402
import luna_events as L  # noqa: E402
import test_events_luna as TL  # noqa: E402

NOW = TL.NOW  # Mon 28 Sep 2026, 12:00 Bogotá
TONIGHT = "ce-noche-de-jazz-teatro-heredia-20260928-9a9a"
REPLACED = ("No puedo confirmarte", "I can't confirm", "Je ne peux pas", "Não consigo")


@pytest.fixture(autouse=True)
def _reset() -> None:
    R.invalidate_caches()


def _docs_with_tonight() -> List[Dict[str, Any]]:
    return TL._docs() + [TL._row(TONIGHT, "Noche de Jazz en el Teatro Heredia", "2026-09-28", category="concert",
                                 venue="Teatro Adolfo Mejía (Heredia)", date_text="28 de septiembre de 2026, 8:00 p.m.",
                                 lat=10.4262, lng=-75.5476, start_time="20:00", end_time="22:00",
                                 time_confirmed=True)]


def _ask(text: str, message: str, monkeypatch: pytest.MonkeyPatch, *, db: Any = None, lang: str = "es",
         **extra: Any) -> Dict[str, Any]:
    fake = TL._FakeLLM(TL._reply(message, language=lang, **extra))
    out = TL._turn(db or TL._DB(), text, fake, monkeypatch, forced_language=lang)
    out["_llm_calls"] = len(fake.calls)
    out["_ctx"] = fake.payload["context"] if fake.calls else {}
    return out


# ── umbrella rows no longer ground every date in their span (blocker) ────────────────────────


@pytest.mark.parametrize("q,msg", [
    ("¿Cuándo es el desfile de independencia?",
     "El Gran Desfile de Independencia (Bando) es el 10 de noviembre en la Avenida Santander."),
    ("fechas de las fiestas de independencia",
     "Las Fiestas de Independencia 2026 van del 2 de octubre al 15 de noviembre, y el Bando es el 9 de noviembre."),
    ("¿Qué eventos hay en las Fiestas de Independencia?",
     "Dentro de las Fiestas de Independencia 2026, el 3 de noviembre hay un concierto de Karol G en el Estadio."),
])
def test_an_umbrella_never_grounds_an_invented_date_inside_its_span(q: str, msg: str,
                                                                   monkeypatch: pytest.MonkeyPatch) -> None:
    out = _ask(q, msg, monkeypatch)
    assert out["_llm_calls"] == 1 and out["message"].startswith(REPLACED), out["message"]


def test_an_umbrella_s_own_first_and_last_day_are_still_grounded(monkeypatch: pytest.MonkeyPatch) -> None:
    msg = "Las Fiestas de Independencia 2026 van del 2 de octubre al 15 de noviembre."
    out = _ask("fechas de las fiestas de independencia", msg, monkeypatch)
    assert out["message"].startswith(msg) and "Fuente:" in out["message"]


# ── artist / named-event questions are event questions (blocker) ─────────────────────────────


@pytest.mark.parametrize("q", ["Is Karol G coming?", "When is Shakira playing?", "karol g viene a cartagena?",
                               "¿Cuándo es el Bando?", "¿Juan Luis Guerra cuándo toca?",
                               "Is Juan Luis Guerra playing in Cartagena?", "O que tem no dia 6 de novembro?"])
def test_artist_and_named_event_questions_fire(q: str) -> None:
    assert L.detect_event_intent(q, L.guess_lang(q), now=NOW)["is_event"] is True


@pytest.mark.parametrize("q,msg,bad", [
    ("Is Karol G coming?", "Yes! Karol G performs at Estadio Jaime Morón on December 20 at 8 p.m.", "December 20"),
    ("When is Shakira playing?", "Shakira plays at the Estadio Jaime Morón on December 12.", "December 12"),
    ("karol g viene a cartagena?", "¡Sí! Karol G llega al Estadio Jaime Morón el 20 de diciembre.", "20 de diciembre"),
    ("¿Cuándo es el Bando?", "El Bando es el 11 de noviembre y arranca a las 2 de la tarde por la Avenida Santander.",
     "11 de noviembre"),
])
def test_invented_artist_dates_never_reach_the_user(q: str, msg: str, bad: str, monkeypatch: pytest.MonkeyPatch) -> None:
    lang = "en" if q[0] in "IW" else "es"
    out = _ask(q, msg, monkeypatch, lang=lang)
    assert bad not in out["message"]


# ── PT 'novembro' is a month ─────────────────────────────────────────────────────────────────


def test_portuguese_november_is_a_date_token_and_the_guard_sees_it(monkeypatch: pytest.MonkeyPatch) -> None:
    assert L._scan_tokens(L.fold_keep("...no dia 21 de novembro."), "pt")
    assert L.detect_event_intent("O que tem no dia 6 de novembro?", "pt", now=NOW)["range"] == "date:2026-11-06"
    out = _ask("O que tem no dia 14 de novembro?", "Salsa a la Plaza é no dia 17 de novembro em Plaza de la Aduana.",
               monkeypatch, lang="pt")
    assert "17 de novembro" not in out["message"]


# ── follow-up turns inside an event conversation ─────────────────────────────────────────────


@pytest.mark.parametrize("q,msg", [
    ("¿Y a qué hora empieza?", "El Bando arranca a las 2:00 p.m. desde el Parque del Centenario."),
    ("¿Seguro que es ese día?", "Sí, el Bando es el 11 de noviembre, siempre el día de la independencia."),
])
def test_a_follow_up_is_grounded_on_the_previous_event_question(q: str, msg: str,
                                                                monkeypatch: pytest.MonkeyPatch) -> None:
    hist = [{"role": "user", "content": "¿Qué eventos hay el 12 de noviembre?", "created_at": "2026-09-28T16:50:00Z"},
            {"role": "assistant", "content": "El 12 de noviembre es el Gran Desfile de Independencia (Bando).",
             "created_at": "2026-09-28T16:50:02Z"}]
    fake = TL._FakeLLM(TL._reply(msg))
    out = TL._turn(TL._DB(), q, fake, monkeypatch, history=hist)
    assert len(fake.calls) == 1
    assert TL.BANDO in [r["event_id"] for r in fake.payload["context"].get("confirmed_events") or []]
    assert out["message"].startswith(REPLACED), out["message"]


def test_an_old_or_non_event_previous_question_does_not_make_a_follow_up(monkeypatch: pytest.MonkeyPatch) -> None:
    hist = [{"role": "user", "content": "¿Dónde cenar hoy?", "created_at": "2026-09-28T16:50:00Z"}]
    fake = TL._FakeLLM(TL._reply("Te recomiendo Celele, abre a las 19:00."))
    out = TL._turn(TL._DB(), "¿y algo más barato?", fake, monkeypatch, history=hist)
    assert "confirmed_events" not in fake.payload["context"]
    assert out["message"] == "Te recomiendo Celele, abre a las 19:00."


# ── an invented event on a real date / a relative date / a month alone ──────────────────────


def test_invented_event_on_the_same_day_as_a_real_row_is_caught(monkeypatch: pytest.MonkeyPatch) -> None:
    db = TL._DB(events=_docs_with_tonight())
    msg = ("Tonight: Noche de Jazz en el Teatro Heredia at 20:00. And tonight there's also a Marc Anthony concert "
           "at Castillo San Felipe.")
    out = _ask("What's on tonight?", msg, monkeypatch, db=db, lang="en")
    assert "Marc Anthony" not in out["message"] and out["message"].startswith(REPLACED)


def test_invented_event_with_a_month_only_date_is_caught(monkeypatch: pytest.MonkeyPatch) -> None:
    msg = ("El Hay Festival Cartagena de Indias 2027 es del 28 al 31 de enero. Y en diciembre llega un gran "
           "concierto de Marc Anthony al Estadio.")
    out = _ask("¿Cuándo es el Hay Festival?", msg, monkeypatch)
    assert "Marc Anthony" not in out["message"]


def test_correct_grounded_answer_is_kept(monkeypatch: pytest.MonkeyPatch) -> None:
    msg = "El Gran Desfile de Independencia (Bando) es el 12 de noviembre en la Avenida Santander."
    out = _ask("¿Qué eventos hay el 12 de noviembre?", msg, monkeypatch)
    assert out["message"].startswith(msg) and "Fuente:" in out["message"]


@pytest.mark.parametrize("q,msg", [
    ("¿Dónde tomar algo esta noche?",
     "Te recomiendo Celele. Esta noche hay concierto en vivo de Silvestre Dangond en Alquímico."),
    ("¿Dónde cenar hoy?", "Te recomiendo Celele para cenar. Además hoy toca Carlos Vives en la muralla."),
    ("Where can I have dinner tonight?",
     "Try Celele for dinner. At 10 p.m. there's a Marc Anthony concert at the Castillo."),
])
def test_non_event_turn_strips_relative_day_event_claims(q: str, msg: str, monkeypatch: pytest.MonkeyPatch) -> None:
    lang = "en" if q.startswith("Where") else "es"
    out = _ask(q, msg, monkeypatch, lang=lang)
    assert out["message"].startswith(("Te recomiendo Celele", "Try Celele")), out["message"]
    for bad in ("Silvestre", "Carlos Vives", "Marc Anthony"):
        assert bad not in out["message"]


# ── the guard covers every LLM string, not only `message` ────────────────────────────────────


def test_partner_cards_labels_and_suggestions_cannot_carry_invented_events(monkeypatch: pytest.MonkeyPatch) -> None:
    out = _ask("¿Qué eventos hay el 12 de noviembre?",
               "El 12 de noviembre es el Gran Desfile de Independencia (Bando) en la Avenida Santander.",
               monkeypatch,
               recommendations=[{"kind": "event", "event_id": TL.BANDO},
                                {"kind": "partner", "partner_id": "ptr_celele", "name": "Celele",
                                 "reason": "Esa noche: concierto de Marc Anthony a las 10 pm en su terraza",
                                 "vibe": "Karol G en vivo el 20 de diciembre"}],
               actions=[{"type": "open_event", "event_id": TL.BANDO, "label": "Boletas Karol G · 20 dic"}],
               suggestions=["¿Boletas para Karol G el 20 de diciembre?", "Marc Anthony 21 dic", "¿Dónde cenar?"])
    celele = next(r for r in out["recommendations"] if r.get("partner_id") == "ptr_celele")
    assert celele["name"] == "Celele" and celele["vibe"] == "" and celele["reason"] == ""
    assert [a["label"] for a in out["actions"]] == ["Ver"]
    assert out["suggestions"] == ["¿Dónde cenar?"]


def test_non_event_turn_side_channels_are_guarded_too(monkeypatch: pytest.MonkeyPatch) -> None:
    out = _ask("dónde cenar hoy", "Celele es ideal para cenar hoy.", monkeypatch,
               recommendations=[{"kind": "partner", "partner_id": "ptr_celele", "name": "Celele",
                                 "reason": "Hoy concierto de Marc Anthony a las 10 pm en la terraza"}],
               suggestions=["¿Boletas para el concierto de Karol G el 20 de diciembre?"])
    assert out["recommendations"][0]["reason"] == "" and out["suggestions"] == []


# ── detector false positives on everyday tourist questions ───────────────────────────────────


@pytest.mark.parametrize("q", ["¿Qué hay para hacer hoy?", "¿Qué hay para hacer hoy en Cartagena?",
                               "Qu'est-ce qu'il y a à faire aujourd'hui ?", "O que tem para fazer hoje?",
                               "¿Qué pasa si llueve mañana?", "¿Qué hay en Cartagena para niños?",
                               "Mi novia Laura llega mañana, ¿qué plan le armo?",
                               "My sister Anna comes tomorrow, what should we do?",
                               "¿qué hay de bueno por hacer este fin de semana?", "¿Qué pasa con el clima esta semana?"])
def test_everyday_questions_are_not_event_questions(q: str) -> None:
    assert L.detect_event_intent(q, L.guess_lang(q), now=NOW)["is_event"] is False


# ── sentence split never separates "10 p.m." from its claim; idioms are not events ───────────


def test_ampm_does_not_split_a_claim_into_harmless_halves() -> None:
    msg = "Try Celele for dinner. At 10 p.m. there's a Marc Anthony concert at the Castillo."
    assert L.strip_ungrounded(msg, [], "en", now=NOW) == "Try Celele for dinner."
    assert L._sentences("A las 10 p. m. hay concierto. Fin.")[0] == "A las 10 p. m. hay concierto."


@pytest.mark.parametrize("q,msg,lang", [
    ("quiero bailar salsa esta noche",
     "Café Havana es el clásico para bailar salsa: la orquesta en vivo arranca a las 22:00 y es todo un show.", "es"),
    ("dónde tomar un coctel esta noche",
     "Alquímico es el mejor bar de coctelería; desde las 21:00 la terraza es una fiesta.", "es"),
    ("Où dîner ce soir ?", "Celele, à 19h30 : cuisine caribéenne d'auteur, c'est un vrai spectacle dans l'assiette.",
     "fr"),
    ("Onde jantar hoje à noite?", "O Celele abre às 19:00; a cozinha é um espetáculo à parte.", "pt"),
    ("quiero ir de fiesta esta noche", "Para rumba, Eivissa abre a las 23:00; es la fiesta más grande de Bocagrande.",
     "es"),
])
def test_idiomatic_show_or_fiesta_on_a_venue_answer_is_kept(q: str, msg: str, lang: str,
                                                            monkeypatch: pytest.MonkeyPatch) -> None:
    out = _ask(q, msg, monkeypatch, lang=lang)
    assert out["message"] == msg


# ── cards only for rows every client (incl. 1.1.x legacy /events/{id}) can open ──────────────


def test_cards_and_open_event_actions_never_point_at_umbrella_or_verify_rows() -> None:
    rows = [G.public_view(r, NOW, True) for r in TL._docs() if r["event_id"] in (TL.FIESTAS, TL.JLG, TL.BANDO)]
    assert {r["event_id"]: r["confidence"] for r in rows}[TL.JLG] == "VERIFY"
    pay = L.grounded_payload(rows, "es", now=NOW)
    assert [c["event_id"] for c in pay["recommendations"]] == [TL.BANDO]
    recs, acts = L.sanitize([{"kind": "event", "event_id": TL.FIESTAS}, {"kind": "event", "event_id": TL.JLG}],
                            [{"type": "open_event", "event_id": TL.FIESTAS, "label": "Ver"},
                             {"type": "open_event", "event_id": TL.BANDO, "label": "Ver"}], rows, now=NOW)
    assert recs == [] and [a["event_id"] for a in acts] == [TL.BANDO]


# ── history cutover can be set to the real deploy time ───────────────────────────────────────


def test_cutover_reads_a_valid_env_override_and_ignores_garbage(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EVENTS_ELITE_CUTOVER", "2026-10-02T15:30:00Z")
    assert L._cutover_from_env() == "2026-10-02T15:30:00Z"
    monkeypatch.setenv("EVENTS_ELITE_CUTOVER", "not-a-date")
    assert L._cutover_from_env() == L._CUTOVER_DEFAULT
    monkeypatch.setenv("EVENTS_ELITE_CUTOVER", "2025-01-01T00:00:00Z")   # never EARLIER than the design cutover
    assert L._cutover_from_env() == L._CUTOVER_DEFAULT
