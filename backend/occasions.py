"""Curated occasion collections — the user-facing face of the knowledge tags.

Each collection is a tag-powered query ("Cenas Románticas" = tags:romantic on
restaurants, boosted by sea_view/sunset_view), ranked by boost + rating, with
live pulses attached. Public read-only endpoints; the catalog behind them
improves automatically as tags are refined and partners send pulses.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException

logger = logging.getLogger("occasions")

router = APIRouter()

db = None
_get_active_pulse_map = None

COLLECTIONS: List[Dict[str, Any]] = [
    {
        "key": "cena-romantica", "icon": "heart",
        "title_es": "Cenas Románticas", "title_en": "Romantic Dinners",
        "desc_es": "Velas, vista y ambiente para dos",
        "desc_en": "Candles, views and a table for two",
        "tags_any": ["romantic"], "boost_tags": ["sea_view", "sunset_view", "rooftop"],
        "categories": ["restaurant", "bar"],
    },
    {
        "key": "rooftops-atardecer", "icon": "sunny",
        "title_es": "Rooftops al Atardecer", "title_en": "Sunset Rooftops",
        "desc_es": "La hora dorada sobre la ciudad amurallada",
        "desc_en": "Golden hour above the walled city",
        "tags_any": ["rooftop", "sunset_view"], "boost_tags": ["sunset_view", "sea_view"],
        "categories": ["bar", "restaurant", "club", "hotel"],
    },
    {
        "key": "primera-cita", "icon": "cafe",
        "title_es": "Primera Cita", "title_en": "First Date",
        "desc_es": "Con encanto, sin exagerar",
        "desc_en": "Charming without trying too hard",
        "tags_any": ["first_date"], "boost_tags": ["outdoor_terrace", "romantic"],
        "categories": ["restaurant", "cafe", "bar"],
    },
    {
        "key": "con-ninos", "icon": "happy",
        "title_es": "Con Niños", "title_en": "Kid-Friendly",
        "desc_es": "Planes donde los peques también gozan",
        "desc_en": "Places where the little ones have fun too",
        "tags_any": ["kid_friendly", "family"], "boost_tags": ["kid_friendly"],
        "categories": [],
    },
    {
        "key": "dia-de-lluvia", "icon": "rainy",
        "title_es": "Día de Lluvia", "title_en": "Rainy Day",
        "desc_es": "Bajo techo y con aire — que llueva lo que quiera",
        "desc_en": "Indoors and air-conditioned — let it pour",
        "tags_any": ["indoor"], "boost_tags": [],
        "categories": [],
    },
    {
        "key": "musica-en-vivo", "icon": "musical-notes",
        "title_es": "Música en Vivo", "title_en": "Live Music",
        "desc_es": "Salsa, jazz y champeta en directo",
        "desc_en": "Salsa, jazz and champeta, live",
        "tags_any": ["live_music"], "boost_tags": ["late_night"],
        "categories": [],
    },
    {
        "key": "favoritos-locales", "icon": "location",
        "title_es": "Favoritos Locales", "title_en": "Local Favorites",
        "desc_es": "Donde comen los cartageneros, no los tours",
        "desc_en": "Where cartageneros actually eat",
        "tags_any": ["local_favorite"], "boost_tags": ["budget"],
        "categories": [],
    },
    {
        "key": "lujo-total", "icon": "diamond",
        "title_es": "Lujo Total", "title_en": "Pure Luxury",
        "desc_es": "La experiencia premium de Cartagena",
        "desc_en": "Cartagena at its most premium",
        "tags_any": ["luxury"], "boost_tags": ["sea_view", "rooftop"],
        "categories": ["restaurant", "hotel", "beach_club", "yacht", "spa"],
    },
]

_BY_KEY = {c["key"]: c for c in COLLECTIONS}

CARD_FIELDS = {
    "_id": 0, "partner_id": 1, "name": 1, "category": 1, "subcategory": 1,
    "cuisine": 1, "tier": 1, "price_range": 1, "address": 1, "rating": 1,
    "reviews": 1, "image_url": 1, "tags": 1,
}


def init(*, db_, get_active_pulse_map):
    global db, _get_active_pulse_map
    db = db_
    _get_active_pulse_map = get_active_pulse_map


def _query_for(c: Dict[str, Any]) -> Dict[str, Any]:
    q: Dict[str, Any] = {"tags": {"$in": c["tags_any"]}}
    if c.get("categories"):
        q["category"] = {"$in": c["categories"]}
    return q


async def _collection_partners(c: Dict[str, Any], limit: int = 30) -> List[Dict[str, Any]]:
    rows = await db.partners.find(_query_for(c), CARD_FIELDS).to_list(300)
    boost = set(c.get("boost_tags") or [])

    def score(p):
        rating = p.get("rating") or 0
        b = sum(0.25 for t in (p.get("tags") or []) if t in boost)
        return rating + b

    rows.sort(key=score, reverse=True)
    rows = rows[:limit]
    try:
        pulse_map = await _get_active_pulse_map(db, [p["partner_id"] for p in rows])
        for p in rows:
            pu = pulse_map.get(p["partner_id"])
            if pu:
                p["live_pulse"] = {k: pu.get(k) for k in ("type", "title", "details", "start_time", "end_time")}
    except Exception as exc:
        logger.warning(f"[occasions] pulse attach failed: {exc}")
    return rows


@router.get("/collections")
async def list_collections():
    out = []
    for c in COLLECTIONS:
        count = await db.partners.count_documents(_query_for(c))
        out.append({
            "key": c["key"], "icon": c["icon"],
            "title_es": c["title_es"], "title_en": c["title_en"],
            "desc_es": c["desc_es"], "desc_en": c["desc_en"],
            "count": count,
        })
    return {"collections": out}


@router.get("/collections/{key}")
async def get_collection(key: str):
    c = _BY_KEY.get(key)
    if not c:
        raise HTTPException(status_code=404, detail="Collection not found")
    partners = await _collection_partners(c)
    return {
        "key": c["key"], "icon": c["icon"],
        "title_es": c["title_es"], "title_en": c["title_en"],
        "desc_es": c["desc_es"], "desc_en": c["desc_en"],
        "partners": partners,
    }
