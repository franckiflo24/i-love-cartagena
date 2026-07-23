"""
intent_resolution.py — Intent-class resolution checking for the AMO demand report.

WHY THIS EXISTS
---------------
The demand report previously marked a query "resolved" when result_count > 0.
That produces false positives: "lancha a rosario" returned 23 results — every one a
DESTINATION in Islas del Rosario (Bora Bora, Coralina, Majagua...), zero boat operators.
The user's need went unanswered, but the flag cleared.

This module adds a third verdict between RESOLVED and ZERO_RESULTS:

    RESOLVED  — results returned AND they match the query's intent class
    MISMATCH  — results returned BUT none/few match the intent class   <-- the new one
    ZERO      — no results at all

MISMATCH is the valuable signal: it means the catalog has *something* but not the
*right thing*, which is a different (and usually cheaper) fix than a true gap.

Design notes:
  - Rule-based and deterministic. Mining thousands of historical queries with an LLM
    call each is slow and expensive; this runs in-process in milliseconds.
  - `classify_intent()` returns ALL matching intents (queries are often compound).
  - Optional LLM fallback hook for queries no rule matches (see `unclassified` verdict).
  - Zero external dependencies.

Integration: see integrate_demand_report() at the bottom.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field, asdict
from typing import Any, Iterable


# ─────────────────────────────────────────────────────────────────────────────
# Normalisation
# ─────────────────────────────────────────────────────────────────────────────

def _norm(text: str) -> str:
    """Lowercase, strip accents, collapse whitespace. 'Lancha a Rosario' -> 'lancha a rosario'"""
    if not text:
        return ""
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", text.lower()).strip()


# ─────────────────────────────────────────────────────────────────────────────
# Intent taxonomy
# ─────────────────────────────────────────────────────────────────────────────
# Each intent declares:
#   patterns          - trigger terms (matched as whole words on the normalised query)
#   categories        - catalog categories that SATISFY this intent
#   subcategories     - subcategories that satisfy it (stronger signal than category)
#   tags              - occasion/feature tags that satisfy it
#   priority          - when a query matches several intents, the highest priority is
#                       the PRIMARY intent that must be satisfied. Transport/service
#                       intents outrank destination intents, because "lancha a rosario"
#                       is fundamentally a request for a boat, not for an island.
#   needs_logistics   - answer should also carry knowledge-spine logistics
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Intent:
    key: str
    patterns: tuple[str, ...]
    categories: tuple[str, ...] = ()
    subcategories: tuple[str, ...] = ()
    tags: tuple[str, ...] = ()
    priority: int = 50
    needs_logistics: bool = False
    label_es: str = ""


INTENTS: tuple[Intent, ...] = (
    # ── Transport / charter — highest priority: these were the false positives ──
    Intent(
        key="transport_charter",
        patterns=(
            "lancha", "lanchita", "lanchas", "bote", "botes", "barco", "barcos",
            "catamaran", "velero", "yate", "yates", "charter", "chartear",
            "alquilar bote", "alquiler de lancha", "boat", "boat rental",
            "private boat", "rent a boat",
        ),
        categories=("yacht", "service"),
        subcategories=(
            "private_charter", "sunset_cruise", "catamaran", "bay_tour",
            "marina", "tour_operator",
        ),
        tags=("boat_departure", "transfer_included"),
        priority=90,
        needs_logistics=True,
        label_es="transporte marítimo / charter",
    ),
    Intent(
        key="transport_ground",
        patterns=(
            "taxi", "uber", "didi", "indrive", "transporte", "como llego",
            "como voy", "como me muevo", "traslado", "chofer", "conductor",
            "how do i get", "get around", "airport transfer", "transfer",
        ),
        categories=("service",),
        subcategories=("ride_hailing", "chauffeur", "tour_operator"),
        priority=88,
        needs_logistics=True,
        label_es="transporte terrestre",
    ),
    Intent(
        key="tour_guided",
        patterns=(
            "tour", "tours", "walking tour", "free tour", "city tour", "guia",
            "guide", "recorrido", "excursion", "chiva",
        ),
        categories=("service", "activity"),
        subcategories=("tour_operator", "walking_tour", "party_bus"),
        priority=80,
        needs_logistics=True,
        label_es="tour guiado",
    ),

    # ── Destinations / venues ──
    Intent(
        key="island_daypass",
        patterns=(
            "pasadia", "pasadias", "dia de playa", "day pass", "daypass",
            "beach club", "club de playa", "isla", "islas",
        ),
        categories=("beach_club", "hotel", "attraction"),
        subcategories=("island_day_pass", "mainland"),
        tags=("island_day", "day_pass", "beachfront"),
        priority=60,
        needs_logistics=True,
        label_es="pasadía / beach club",
    ),
    Intent(
        key="dining",
        patterns=(
            "comer", "comida", "restaurante", "restaurantes", "cena", "cenar",
            "almuerzo", "almorzar", "desayuno", "brunch", "mariscos", "ceviche",
            "langosta", "sushi", "pizza", "hamburguesa", "eat", "dinner",
            "lunch", "breakfast", "food", "restaurant",
        ),
        categories=("restaurant",),
        priority=70,
        label_es="gastronomía",
    ),
    Intent(
        key="drinks_nightlife",
        patterns=(
            "bar", "bares", "trago", "tragos", "coctel", "cocteles", "cocktail",
            "rooftop", "discoteca", "club nocturno", "salsa", "rumba", "fiesta",
            "drink", "drinks", "nightlife", "party", "martini", "mojito", "cerveza",
        ),
        categories=("bar", "club"),
        subcategories=("rooftop", "salsa", "cocktail"),
        tags=("rooftop", "live_music", "sunset_view"),
        priority=70,
        label_es="bares / vida nocturna",
    ),
    Intent(
        key="coffee",
        patterns=(
            "cafe", "cafeteria", "latte", "macchiato", "cortado", "capuchino",
            "tinto", "espresso", "coffee", "flat white",
        ),
        categories=("cafe",),
        priority=70,
        label_es="café",
    ),
    Intent(
        key="lodging",
        patterns=(
            "hotel", "hoteles", "hospedaje", "alojamiento", "donde dormir",
            "villa", "villas", "where to stay", "stay", "accommodation",
        ),
        categories=("hotel",),
        priority=70,
        label_es="alojamiento",
    ),
    Intent(
        key="wellness",
        patterns=(
            "spa", "masaje", "masajes", "sauna", "yoga", "gimnasio", "gym",
            "peluqueria", "salon", "uñas", "manicure", "massage",
        ),
        categories=("spa", "beauty"),
        priority=70,
        label_es="bienestar",
    ),
    Intent(
        key="shopping",
        patterns=(
            "compras", "comprar", "tienda", "tiendas", "artesanias", "souvenir",
            "souvenirs", "shopping", "mall", "centro comercial", "boutique",
            "joyeria", "esmeraldas", "emeralds",
        ),
        categories=("service", "attraction"),
        subcategories=("boutique_retail", "market_arcade"),
        priority=70,
        label_es="compras",
    ),
    Intent(
        key="culture_attraction",
        patterns=(
            "museo", "museos", "castillo", "muralla", "murallas", "iglesia",
            "monumento", "acuario", "oceanario", "aviario", "que ver",
            "que hacer", "atraccion", "museum", "castle", "what to see",
            "sightseeing", "history",
        ),
        categories=("attraction", "institutional"),
        subcategories=("museum", "aquarium", "bird_park", "landmark"),
        priority=65,
        label_es="cultura / atracciones",
    ),
    Intent(
        key="experience",
        patterns=(
            "cata", "degustacion", "taller", "clase de cocina", "cooking class",
            "ron", "rum tasting", "chocolate", "cacao", "chef privado",
            "private chef", "experiencia", "snorkel", "buceo", "diving",
        ),
        categories=("activity", "service"),
        subcategories=(
            "rum_tasting", "chocolate_workshop", "private_chef", "walking_tour",
        ),
        tags=("snorkeling",),
        priority=75,
        label_es="experiencias",
    ),

    # ── Essentials — never satisfied by venue results alone ──
    Intent(
        key="essentials_medical",
        patterns=(
            "clinica", "hospital", "medico", "doctor", "farmacia", "urgencias",
            "emergencia", "me duele", "lastime", "torci", "clinic", "pharmacy",
            "emergency", "hurt", "sprained", "sick",
        ),
        categories=("institutional", "service"),
        subcategories=("medical", "pharmacy"),
        tags=("english_friendly",),
        priority=95,
        needs_logistics=True,
        label_es="salud / emergencias",
    ),
)

# Destination modifiers: these NARROW a query, they never satisfy it on their own.
# This is the "rosario" in "lancha a rosario" — the thing that hijacked the results.
DESTINATION_TERMS: dict[str, tuple[str, ...]] = {
    "islas_del_rosario": ("rosario", "rosarios", "islas del rosario"),
    "baru": ("baru", "playa blanca"),
    "tierra_bomba": ("tierra bomba", "tierrabomba", "bomba"),
    "centro_historico": ("centro", "ciudad amurallada", "walled city", "old city"),
    "getsemani": ("getsemani",),
    "bocagrande": ("bocagrande", "boca grande"),
    "manga": ("manga",),
    "la_boquilla": ("boquilla",),
}


# ─────────────────────────────────────────────────────────────────────────────
# Classification
# ─────────────────────────────────────────────────────────────────────────────

def _contains_term(query_norm: str, term: str) -> bool:
    """Whole-word-ish match so 'bar' doesn't fire on 'barco' or 'baru'."""
    return re.search(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])", query_norm) is not None


def classify_intent(query: str) -> dict[str, Any]:
    """
    Returns:
      {
        "query": str,
        "matched": [intent_key, ...]      # all intents triggered, priority-sorted
        "primary": intent_key | None,     # the one that MUST be satisfied
        "destinations": [dest_key, ...],  # narrowing modifiers, never satisfying
        "compound": bool,                 # intent + destination (the failure case)
        "needs_logistics": bool,
      }
    """
    q = _norm(query)
    matched: list[Intent] = []
    for intent in INTENTS:
        if any(_contains_term(q, p) for p in intent.patterns):
            matched.append(intent)

    destinations = [
        key for key, terms in DESTINATION_TERMS.items()
        if any(_contains_term(q, t) for t in terms)
    ]

    matched.sort(key=lambda i: i.priority, reverse=True)
    primary = matched[0] if matched else None

    return {
        "query": query,
        "matched": [i.key for i in matched],
        "primary": primary.key if primary else None,
        "primary_label_es": primary.label_es if primary else "",
        "destinations": destinations,
        "compound": bool(primary and destinations),
        "needs_logistics": bool(primary and primary.needs_logistics),
    }


def _intent_by_key(key: str) -> Intent | None:
    return next((i for i in INTENTS if i.key == key), None)


# ─────────────────────────────────────────────────────────────────────────────
# Result matching
# ─────────────────────────────────────────────────────────────────────────────

def result_satisfies_intent(result: dict[str, Any], intent: Intent) -> bool:
    """
    A result satisfies an intent if its category, subcategory, or tags fall inside
    the intent's expectation set. Subcategory is the strongest signal.
    """
    cat = _norm(str(result.get("category") or ""))
    sub = _norm(str(result.get("subcategory") or ""))
    tags = {_norm(str(t)) for t in (result.get("tags") or [])}

    if intent.subcategories and sub in {_norm(s) for s in intent.subcategories}:
        return True
    if intent.categories and cat in {_norm(c) for c in intent.categories}:
        return True
    if intent.tags and tags & {_norm(t) for t in intent.tags}:
        return True
    return False


def result_serves_destination(result: dict[str, Any], destinations: Iterable[str]) -> bool:
    """
    A venue serves a destination if it IS there (zone/neighborhood) or it TAKES you
    there (serves_destinations). The second half is the field that was missing —
    Bona Vida sits in Centro but serves Islas del Rosario.
    """
    dests = {_norm(d) for d in destinations}
    if not dests:
        return True

    own = {
        _norm(str(result.get(k) or ""))
        for k in ("zone", "neighborhood", "neighbourhood", "area")
    } - {""}
    serves = {_norm(str(d)) for d in (result.get("serves_destinations") or [])}
    return bool((own | serves) & dests)


# ─────────────────────────────────────────────────────────────────────────────
# The verdict
# ─────────────────────────────────────────────────────────────────────────────

RESOLVED = "RESOLVED"
MISMATCH = "MISMATCH"
ZERO = "ZERO_RESULTS"
UNCLASSIFIED = "UNCLASSIFIED"

# How many of the top N results must satisfy the primary intent to count as resolved.
DEFAULT_TOP_N = 5
DEFAULT_MIN_MATCHES = 2


@dataclass
class ResolutionVerdict:
    query: str
    verdict: str
    primary_intent: str | None
    primary_label_es: str
    destinations: list[str]
    compound: bool
    result_count: int
    top_n_checked: int
    intent_matches_in_top_n: int
    matching_names: list[str] = field(default_factory=list)
    offending_names: list[str] = field(default_factory=list)
    needs_logistics: bool = False
    reason_es: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def check_resolution(
    query: str,
    results: list[dict[str, Any]],
    *,
    top_n: int = DEFAULT_TOP_N,
    min_matches: int = DEFAULT_MIN_MATCHES,
) -> ResolutionVerdict:
    """
    THE CORE FUNCTION. Replaces `resolved = len(results) > 0`.

    results: list of dicts with at least name/category; optionally subcategory,
             tags, zone/neighborhood, serves_destinations.
    """
    intent_info = classify_intent(query)
    primary_key = intent_info["primary"]
    destinations = intent_info["destinations"]
    count = len(results)

    base = dict(
        query=query,
        primary_intent=primary_key,
        primary_label_es=intent_info["primary_label_es"],
        destinations=destinations,
        compound=intent_info["compound"],
        result_count=count,
        top_n_checked=0,
        intent_matches_in_top_n=0,
        needs_logistics=intent_info["needs_logistics"],
    )

    if count == 0:
        return ResolutionVerdict(
            **base, verdict=ZERO,
            reason_es="Sin resultados — brecha real de catálogo.",
        )

    if primary_key is None:
        # No rule fired. Don't guess — surface it for review / optional LLM fallback.
        return ResolutionVerdict(
            **base, verdict=UNCLASSIFIED,
            reason_es="Intención no clasificada — revisar y añadir patrón.",
        )

    intent = _intent_by_key(primary_key)
    top = results[:top_n]
    base["top_n_checked"] = len(top)

    matching, offending = [], []
    for r in top:
        name = str(r.get("name") or r.get("partner_id") or "?")
        ok_intent = result_satisfies_intent(r, intent)
        ok_dest = result_serves_destination(r, destinations)
        (matching if (ok_intent and ok_dest) else offending).append(name)

    base["intent_matches_in_top_n"] = len(matching)

    if len(matching) >= min_matches:
        return ResolutionVerdict(
            **base, verdict=RESOLVED,
            matching_names=matching, offending_names=offending,
            reason_es=(
                f"{len(matching)} de {len(top)} resultados coinciden con la intención "
                f"'{intent.label_es}'."
            ),
        )

    # Results came back, but they're the wrong class. THIS is the case the old
    # count>0 check silently passed.
    dest_note = ""
    if intent_info["compound"]:
        dest_note = (
            f" La consulta es compuesta (intención '{intent.label_es}' + destino "
            f"{', '.join(destinations)}); es probable que el destino esté dominando el "
            f"ranking y excluyendo a los operadores."
        )
    return ResolutionVerdict(
        **base, verdict=MISMATCH,
        matching_names=matching, offending_names=offending,
        reason_es=(
            f"{count} resultados devueltos, pero solo {len(matching)} de {len(top)} "
            f"coinciden con la intención '{intent.label_es}'.{dest_note}"
        ),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Demand-report integration
# ─────────────────────────────────────────────────────────────────────────────

def summarise_verdicts(verdicts: list[ResolutionVerdict]) -> dict[str, Any]:
    """Roll up for the /intel dashboard."""
    buckets: dict[str, list[ResolutionVerdict]] = {
        RESOLVED: [], MISMATCH: [], ZERO: [], UNCLASSIFIED: [],
    }
    for v in verdicts:
        buckets[v.verdict].append(v)

    total = len(verdicts) or 1
    return {
        "total_queries": len(verdicts),
        "counts": {k: len(v) for k, v in buckets.items()},
        "true_resolution_rate": round(len(buckets[RESOLVED]) / total * 100, 1),
        # The number that used to be reported — kept so you can see the gap it hid.
        "naive_resolution_rate": round(
            (len(buckets[RESOLVED]) + len(buckets[MISMATCH])) / total * 100, 1
        ),
        "mismatches": [v.to_dict() for v in buckets[MISMATCH]],
        "true_gaps": [v.to_dict() for v in buckets[ZERO]],
        "unclassified": [v.to_dict() for v in buckets[UNCLASSIFIED]],
    }


async def integrate_demand_report(db, *, days: int = 30, search_fn=None) -> dict[str, Any]:
    """
    Drop-in for the demand-report job.

    REPLACES logic shaped like:
        resolved = doc.get("result_count", 0) > 0
    WITH:
        verdict = check_resolution(query, results)

    `search_fn(query) -> list[dict]` must return the SAME results the live search
    returns (import the real search function — do not re-implement it, or the report
    will measure something the user never sees).
    """
    from datetime import datetime, timedelta, timezone

    since = datetime.now(timezone.utc) - timedelta(days=days)
    cursor = db.search_history.find({"timestamp": {"$gte": since}}, {"_id": 0, "query": 1})

    seen: set[str] = set()
    verdicts: list[ResolutionVerdict] = []
    async for doc in cursor:
        q = (doc.get("query") or "").strip()
        key = _norm(q)
        if not q or key in seen:
            continue
        seen.add(key)
        results = await search_fn(q) if search_fn else []
        verdicts.append(check_resolution(q, results))

    return summarise_verdicts(verdicts)


# ─────────────────────────────────────────────────────────────────────────────
# Self-test — the real failing cases from production
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # The exact 23 destination results that "lancha a rosario" returned.
    rosario_destinations = [
        {"name": "Bora Bora Beach Club", "category": "beach_club",
         "subcategory": "island_day_pass", "zone": "islas_del_rosario"},
        {"name": "Coralina Island", "category": "hotel",
         "subcategory": "boutique", "zone": "islas_del_rosario"},
        {"name": "Hotel San Pedro de Majagua", "category": "hotel",
         "subcategory": "boutique", "zone": "islas_del_rosario"},
        {"name": "Eco Hotel Islabela", "category": "hotel",
         "subcategory": "boutique", "zone": "islas_del_rosario"},
        {"name": "Corona Island", "category": "hotel",
         "subcategory": "boutique", "zone": "islas_del_rosario"},
    ]
    # What the answer SHOULD look like once serves_destinations exists.
    correct_results = [
        {"name": "Bona Vida Catamaranes", "category": "yacht",
         "subcategory": "sunset_cruise", "zone": "centro_historico",
         "serves_destinations": ["islas_del_rosario", "bahia_cartagena"]},
        {"name": "Todomar Marina", "category": "service", "subcategory": "marina",
         "zone": "bocagrande",
         "serves_destinations": ["islas_del_rosario", "baru", "tierra_bomba"]},
        *rosario_destinations[:3],
    ]

    cases = [
        ("lancha a rosario", rosario_destinations, "expect MISMATCH"),
        ("lancha a rosario", correct_results, "expect RESOLVED"),
        ("cena romantica", [
            {"name": "Sambal", "category": "restaurant", "tags": ["romantic"]},
            {"name": "1621", "category": "restaurant", "tags": ["romantic"]},
        ], "expect RESOLVED"),
        ("un buen macchiato", [
            {"name": "Epoca Cafe", "category": "cafe"},
            {"name": "Cafe San Alberto", "category": "cafe"},
        ], "expect RESOLVED"),
        ("clinica que hable ingles", [
            {"name": "Bora Bora Beach Club", "category": "beach_club"},
        ], "expect MISMATCH"),
        ("rooftop shisha", [], "expect ZERO"),
        ("asdfgh", [{"name": "Whatever", "category": "bar"}], "expect UNCLASSIFIED"),
    ]

    print("=" * 78)
    print("INTENT RESOLUTION — SELF TEST")
    print("=" * 78)
    verdicts = []
    for q, res, expectation in cases:
        v = check_resolution(q, res)
        verdicts.append(v)
        print(f"\nQuery      : {q!r}   ({expectation})")
        print(f"Verdict    : {v.verdict}")
        print(f"Intent     : {v.primary_intent} ({v.primary_label_es})")
        print(f"Destinations: {v.destinations}  compound={v.compound}")
        print(f"Matches    : {v.intent_matches_in_top_n}/{v.top_n_checked}"
              f"   ok={v.matching_names}  wrong={v.offending_names}")
        print(f"Razón      : {v.reason_es}")

    print("\n" + "=" * 78)
    summary = summarise_verdicts(verdicts)
    print("SUMMARY")
    print(f"  counts               : {summary['counts']}")
    print(f"  TRUE resolution rate : {summary['true_resolution_rate']}%")
    print(f"  naive (old) rate     : {summary['naive_resolution_rate']}%  "
          f"<-- what the report used to claim")
    print("=" * 78)
