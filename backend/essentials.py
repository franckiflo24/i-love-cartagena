"""Drop CAT — the ESSENTIALS LAYER (guest-need taxonomy, the city's OS spine).

A NEED-STATE taxonomy over the existing verified data. The hard rule (honesty
spine): a category is LIVE to users ONLY when it has real verified entries behind
it; an under-seeded category is HIDDEN and Luna declines it. No empty shelves.

Sources are all EXISTING + verified — never bulk-loaded junk:
- seed          → verified essentials in need_states.json (Decreto-0051 fares,
                  emergency 123, pharmacy chains, JCI hospital, water/tipping).
- collection    → an occasion collection (occasions.py) nested under a need-state;
                  LIVE only if it has >= live_gate publicly-visible partners.
- partners      → partner category/subcategory; LIVE only if >= live_gate public.
- zones         → the walkable core neighborhoods (verified in neighborhoods.json).
- trust_scam_cards → the "Cartagena sin sustos" cards from trust_knowledge.json.

Read-only, public. Situational/partner categories grow via the partner portal
(moderation-gated), not manual loading.
"""

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request

logger = logging.getLogger("essentials")

router = APIRouter()

db = None
_check_rate_limit = None

_DATA_DIR = os.path.join(os.path.dirname(__file__), "data")


def _load(name: str) -> Any:
    with open(os.path.join(_DATA_DIR, name), "r", encoding="utf-8") as f:
        return json.load(f)


try:
    _TAXONOMY: Dict[str, Any] = _load("need_states.json")
except Exception as _e:
    # Fail SOFT, never crash server startup: a malformed taxonomy disables the
    # essentials layer (empty → nothing renders, Luna declines all) rather than
    # taking the whole backend down. Honesty gate holds even on load failure.
    logging.getLogger("essentials").error(f"need_states.json failed to load — essentials disabled: {_e}")
    _TAXONOMY = {"version": "unloaded", "live_gate": 3, "need_states": []}
try:
    _TRUST: Dict[str, Any] = _load("trust_knowledge.json")
except Exception:
    _TRUST = {"scam_cards": []}

# Walkable core zones — verified in frontend/public/data/neighborhoods.json.
# Kept here so the backend stays self-contained (that file is frontend-static).
WALKABLE_ZONES = [
    {"slug": "centro", "name": "Centro Histórico", "character_es": "Ciudad amurallada, colonial, caminable", "character_en": "Walled colonial city, walkable", "safety": 4},
    {"slug": "san-diego", "name": "San Diego", "character_es": "Barrio tranquilo dentro de la muralla", "character_en": "Quiet quarter inside the wall", "safety": 4},
    {"slug": "getsemani", "name": "Getsemaní", "character_es": "Bohemio, arte callejero, vida nocturna", "character_en": "Bohemian, street art, nightlife", "safety": 3},
    {"slug": "bocagrande", "name": "Bocagrande", "character_es": "Moderno, playa urbana, bancos y farmacias", "character_en": "Modern, urban beach, banks & pharmacies", "safety": 4},
    {"slug": "manga", "name": "Manga", "character_es": "Residencial local, terminal de cruceros", "character_en": "Local residential, cruise terminal", "safety": 3},
    {"slug": "castillogrande", "name": "Castillogrande", "character_es": "Península tranquila, atardeceres, familias", "character_en": "Quiet peninsula, sunsets, families", "safety": 4},
]


def init(*, db_, check_rate_limit):
    global db, _check_rate_limit
    db = db_
    _check_rate_limit = check_rate_limit


async def _public_partner_count(query: Dict[str, Any]) -> int:
    from partner_visibility import PUBLIC_PARTNER_FILTER
    return await db.partners.count_documents({**PUBLIC_PARTNER_FILTER, **query})


async def _collection_count(collection_key: str) -> int:
    """Publicly-visible partner count for an occasion collection."""
    import occasions as _occ
    from partner_visibility import PUBLIC_PARTNER_FILTER
    c = _occ._BY_KEY.get(collection_key)
    if not c:
        return 0
    if c.get("curated_ids"):
        return await db.partners.count_documents({**PUBLIC_PARTNER_FILTER, "partner_id": {"$in": c["curated_ids"]}})
    return await db.partners.count_documents({**PUBLIC_PARTNER_FILTER, **_occ._query_for(c)})


async def _resolve_count(source: Dict[str, Any], cat: Dict[str, Any]) -> int:
    """Verified-entry count for a category, by source type. This IS the live-gate
    numerator — honest, computed against real data."""
    t = source.get("type")
    if t == "seed":
        return len(cat.get("entries") or [])
    if t == "zones":
        return len(WALKABLE_ZONES)
    if t == "trust_scam_cards":
        return len(_TRUST.get("scam_cards") or [])
    if t == "collection":
        return await _collection_count(source.get("collection_key", ""))
    if t == "partners":
        q: Dict[str, Any] = {}
        if source.get("category"):
            q["category"] = source["category"]
        if source.get("subcategory"):
            q["subcategory"] = source["subcategory"]
        return await _public_partner_count(q)
    return 0


def _is_live(source_type: str, count: int, gate: int) -> bool:
    """Info-layer essentials (curated verified guidance) are LIVE when seeded at
    all; DIRECTORY categories (partners/collections) need critical mass (>= gate)
    to be useful — the anti-empty-shelf rule."""
    if source_type in ("seed", "zones", "trust_scam_cards"):
        return count >= 1
    return count >= gate


@router.get("/essentials/taxonomy")
async def essentials_taxonomy(request: Request, include_hidden: int = 0):
    """The 8 need-states with each category's LIVE/HIDDEN status computed from
    real verified counts. Users render only `categories` (live); `hidden` is the
    honesty-proof evidence (and what Luna must decline). No empty shelves."""
    if _check_rate_limit:
        ip = request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")
        await _check_rate_limit(f"essentials:{ip}", max_calls=60, window_sec=60)
    gate = int(_TAXONOMY.get("live_gate", 3))
    out_states = []
    for ns in _TAXONOMY.get("need_states", []):
        live_cats, hidden_cats = [], []
        for cat in ns.get("categories", []):
            source = cat.get("source", {})
            count = await _resolve_count(source, cat)
            live = _is_live(source.get("type", ""), count, gate)
            summary = {
                "key": cat["key"], "title_es": cat.get("title_es"), "title_en": cat.get("title_en"),
                "icon": cat.get("icon"), "tier": cat.get("tier"),
                "trust_required": bool(cat.get("trust_required")), "trust_flag": cat.get("trust_flag"),
                "verified_count": count, "source_type": source.get("type"),
            }
            (live_cats if live else hidden_cats).append(summary)
        state = {
            "key": ns["key"], "order": ns.get("order"), "icon": ns.get("icon"),
            "title_es": ns.get("title_es"), "title_en": ns.get("title_en"),
            "categories": live_cats,
        }
        if include_hidden:
            state["hidden"] = [{"key": h["key"], "title_es": h["title_es"], "verified_count": h["verified_count"], "needed": gate} for h in hidden_cats]
        else:
            state["hidden_count"] = len(hidden_cats)
        out_states.append(state)
    return {"version": _TAXONOMY.get("version"), "live_gate": gate, "need_states": out_states}


def _find_category(cat_key: str) -> Optional[Dict[str, Any]]:
    for ns in _TAXONOMY.get("need_states", []):
        for cat in ns.get("categories", []):
            if cat["key"] == cat_key:
                return {**cat, "_need_state": ns["key"]}
    return None


@router.get("/essentials/category/{cat_key}")
async def essentials_category(cat_key: str, request: Request):
    """Verified entries for a LIVE category. A HIDDEN (under-seeded) category
    returns live:false + empty — never fabricated content. Honest by construction."""
    if _check_rate_limit:
        ip = request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")
        await _check_rate_limit(f"essentials:{ip}", max_calls=60, window_sec=60)
    cat = _find_category(cat_key)
    if not cat:
        raise HTTPException(status_code=404, detail="unknown category")
    gate = int(_TAXONOMY.get("live_gate", 3))
    source = cat.get("source", {})
    count = await _resolve_count(source, cat)
    live = _is_live(source.get("type", ""), count, gate)
    base = {
        "key": cat["key"], "need_state": cat["_need_state"],
        "title_es": cat.get("title_es"), "title_en": cat.get("title_en"),
        "icon": cat.get("icon"), "tier": cat.get("tier"),
        "trust_required": bool(cat.get("trust_required")), "trust_flag": cat.get("trust_flag"),
        "guidance_es": cat.get("guidance_es"), "guidance_en": cat.get("guidance_en"),
        "verified_count": count, "live": live,
    }
    if not live:
        return {**base, "entries": [], "note": "Aún no cubierto — no hay suficientes entradas verificadas. / Not yet covered — not enough verified entries."}
    t = source.get("type")
    if t == "seed":
        base["entries"] = cat.get("entries") or []
    elif t == "zones":
        base["entries"] = WALKABLE_ZONES
    elif t == "trust_scam_cards":
        base["entries"] = _TRUST.get("scam_cards") or []
    else:
        # collection / partners → resolved live by the existing endpoints
        # (/api/collections/{key}, /api/nearby?category=). We surface the route,
        # not a duplicated venue list (single source of truth).
        base["entries"] = []
        base["resolve_via"] = (f"/api/collections/{source.get('collection_key')}" if t == "collection"
                               else f"/api/nearby?category={source.get('category', '')}")
    return base


@router.get("/essentials/pins")
async def essentials_pins(request: Request):
    """Coordinate-carrying essentials (verified hospitals) for the MAP. The seed
    safety layer isn't in the partner catalog, so without this the single most
    safety-critical essential — hospitals — has no pin. Only entries with a REAL
    lat/lng (from Google Places, verified) are returned; never a fabricated point."""
    if _check_rate_limit:
        ip = request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")
        await _check_rate_limit(f"essentials:{ip}", max_calls=60, window_sec=60)
    pins = []
    for ns in _TAXONOMY.get("need_states", []):
        for cat in ns.get("categories", []):
            if (cat.get("source") or {}).get("type") != "seed":
                continue
            for e in (cat.get("entries") or []):
                if isinstance(e.get("lat"), (int, float)) and isinstance(e.get("lng"), (int, float)):
                    pins.append({
                        "name": e.get("label_es"), "name_en": e.get("label_en"),
                        "lat": e["lat"], "lng": e["lng"],
                        "need_state": ns["key"], "category": cat["key"], "icon": cat.get("icon"),
                        "trust_flag": cat.get("trust_flag"), "note": e.get("value_text"),
                        "place_id": e.get("place_id"),
                    })
    return {"pins": pins}


# ── Luna essentials context (honesty boundary) ──────────────────────────────
async def essentials_coverage() -> Dict[str, Any]:
    """For Luna's grounding, built from the SAME live-gate as the user taxonomy so
    Luna and the UI never disagree:
      - live_essentials  = LIVE seed categories (answer from their guidance/entries)
      - live_directory   = LIVE partner/collection/zone/trust categories that DO
                           have real coverage but are answered from relevant_partners
                           / the map (NOT a seed block). Surfaced so Luna does not
                           wrongly decline a category the app shows as live.
      - hidden_categories = under-seeded (< gate) — must be honestly declined."""
    gate = int(_TAXONOMY.get("live_gate", 3))
    live: Dict[str, Any] = {}
    live_directory: List[str] = []
    hidden: List[str] = []
    for ns in _TAXONOMY.get("need_states", []):
        for cat in ns.get("categories", []):
            source = cat.get("source", {})
            count = await _resolve_count(source, cat)
            if not _is_live(source.get("type", ""), count, gate):
                hidden.append(cat["key"])
                continue
            if source.get("type") == "seed":
                live[cat["key"]] = {
                    "title": cat.get("title_es"),
                    "guidance": cat.get("guidance_es"),
                    "entries": cat.get("entries") or [],
                    "trust_flag": cat.get("trust_flag"),
                }
            else:
                live_directory.append(cat["key"])
    return {"live_essentials": live, "live_directory": live_directory, "hidden_categories": hidden,
            "_rule": "Answer seed essentials ONLY from live_essentials. live_directory categories ARE covered — answer them from relevant_partners/the map, never decline. For any hidden_category or anything in neither, say honestly it's not yet covered — NEVER invent a pharmacy, clinic, fare, or number."}


# ── Partner self-service → need-state slotting (D1/D2, anti-flood growth) ────
CATEGORY_TO_NEED_STATE = {
    "restaurant": "experiences", "bar": "experiences", "cafe": "experiences",
    "club": "experiences", "beach_club": "experiences", "yacht": "experiences",
    "activity": "experiences", "attraction": "experiences", "spa": "experiences",
    "hotel": "services", "beauty": "services", "service": "services",
}


def need_state_for_category(category: str, subcategory: str = "") -> str:
    """Tag a moderation-gated partner submission with its need-state (for
    organization/routing), from its category/subcategory.

    HONEST NOTE on the live-gate: the taxonomy's live-gate (_resolve_count's
    "partners" branch) counts approved partners by each CATEGORY's own
    source.category/subcategory in need_states.json — it does NOT read this stored
    need_state field. So an approved submission grows a category's coverage ONLY
    where that category is source.type:"partners" (today: the Services categories
    — laundry, coworking, luggage_storage, veterinary — which DO go LIVE at
    live_gate). Seed info-categories (pharmacy chains, hospitals, official fares)
    are always-live curated blocks and do not grow by partner count. To let info-
    categories grow via partners later, wire _resolve_count to also read need_state."""
    cat = (category or "").lower().strip()
    sub = (subcategory or "").lower().strip()
    if sub in {"laundry", "coworking", "luggage_storage", "veterinary", "rental", "tattoo", "barbershop"}:
        return "services"
    if sub in {"pharmacy", "grocery", "supermarket"}:
        return "daily_essentials"
    if sub in {"medical", "clinic", "hospital"}:
        return "health_safety"
    if sub in {"currency_exchange", "bank", "atm", "sim_card"}:
        return "arrival"
    if sub in {"transport_app", "taxi", "transport"}:
        return "getting_around"
    return CATEGORY_TO_NEED_STATE.get(cat, "services")


# ── Search integration: surface the essentials hub for essentials-shaped queries ──
_ESSENTIALS_QUERY_MAP = {
    "aeropuerto": "airport_transfer", "airport": "airport_transfer", "traslado": "airport_transfer",
    "cajero": "money_atm_exchange", "atm": "money_atm_exchange", "cambio": "money_atm_exchange",
    "dólares": "money_atm_exchange", "dolares": "money_atm_exchange", "exchange": "money_atm_exchange",
    "sim": "connectivity_sim", "esim": "connectivity_sim", "chip": "connectivity_sim",
    "taxi": "taxi", "tarifa": "taxi",
    "farmacia": "pharmacy", "pharmacy": "pharmacy", "droguería": "pharmacy", "drogueria": "pharmacy", "medicamento": "pharmacy",
    "supermercado": "supermarket", "supermarket": "supermarket", "grocery": "supermarket",
    "agua": "drinking_water", "water": "drinking_water",
    "emergencia": "emergency", "emergency": "emergency", "ambulancia": "emergency", "policía": "emergency", "policia": "emergency",
    "hospital": "hospitals", "clínica": "hospitals", "clinica": "hospitals", "clinic": "hospitals",
    "médico": "hospitals", "medico": "hospitals", "doctor": "hospitals",
    "vacuna": "health_info", "fiebre": "health_info", "dengue": "health_info", "repelente": "health_info",
    "esenciales": "airport_transfer", "essentials": "airport_transfer",
}


def match_essentials_query(text: str) -> Optional[Dict[str, Any]]:
    """The best-matching essentials category for a search query (word-boundary), or
    None. Lets /search surface the VERIFIED essentials hub for terms the partner
    catalog can't answer (airport fares, 123, hospitals) — findability, never
    invention. Returns a small card the frontend routes to /esenciales."""
    t = (text or "").lower().strip()
    if len(t) < 2:
        return None
    for kw, cat_key in _ESSENTIALS_QUERY_MAP.items():
        if re.search(rf"(?<!\w){re.escape(kw)}(?!\w)", t):
            cat = _find_category(cat_key)
            if not cat:
                continue
            return {
                "category": cat_key, "need_state": cat["_need_state"],
                "title_es": cat.get("title_es"), "title_en": cat.get("title_en"),
                "icon": cat.get("icon"), "trust_flag": cat.get("trust_flag"),
                "route": "/esenciales",
            }
    return None
