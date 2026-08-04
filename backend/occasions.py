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
        "desc_es": "Velas, patios coloniales y música para dos", "desc_en": "Candlelit colonial courtyards for two",
        "curated_ids": [
            "ptr_R102",
            "ptr_R104",
            "ptr_R105",
            "ptr_dv_008",
            "ptr_W100",
            "ptr_occ_001",
            "ptr_miss_001",
            "ptr_R101",
        ],
        "categories": ["restaurant", "bar"],
    },
    {
        "key": "rooftops-atardecer", "icon": "sunny",
        "title_es": "Rooftops al Atardecer", "title_en": "Sunset Rooftops",
        "desc_es": "La hora dorada sobre la ciudad amurallada", "desc_en": "Golden hour above the walled city",
        "curated_ids": [
            "ptr_W113",
            "ptr_007",
            "ptr_W111",
            "ptr_W112",
            "ptr_V001",
            "ptr_R022",
            "ptr_V003",
            "ptr_dv_022",
            "ptr_occ_017",
        ],
        "categories": ["bar", "restaurant", "hotel", "club"],
    },
    {
        "key": "primera-cita", "icon": "cafe",
        "title_es": "Primera Cita", "title_en": "First Date",
        "desc_es": "Con encanto, para conversar sin exagerar", "desc_en": "Charming and easy to talk over",
        "curated_ids": [
            "ptr_V002",
            "ptr_occ_004",
            "ptr_W120",
            "ptr_V001",
            "ptr_R022",
        ],
        "categories": ["bar", "cafe", "restaurant"],
    },
    {
        "key": "con-ninos", "icon": "happy",
        "title_es": "Con Niños", "title_en": "Kid-Friendly",
        "desc_es": "Donde los peques también gozan", "desc_en": "Where the little ones have fun too",
        "curated_ids": [
            "ptr_occ_002",
            "ptr_occ_003",
            "ptr_dv_028",
            "ptr_R021",
            "ptr_dv2_007",
            "ptr_occ_012",
            "ptr_X1123",
        ],
        "categories": ["cafe", "restaurant", "attraction", "beach_club"],
    },
    {
        "key": "dia-de-lluvia", "icon": "rainy",
        "title_es": "Día de Lluvia", "title_en": "Rainy Day",
        "desc_es": "Bajo techo y con aire — que llueva", "desc_en": "Indoors and cool — let it pour",
        "curated_ids": [
            "attr_007",
            "attr_006",
            "attr_013",
            "ptr_dv_015",
            "ptr_V054",
            "ptr_V012",
            "ptr_V010",
        ],
        "categories": ["attraction", "cafe", "activity"],
    },
    {
        "key": "musica-en-vivo", "icon": "musical-notes",
        "title_es": "Música en Vivo", "title_en": "Live Music",
        "desc_es": "Salsa, son y champeta en directo", "desc_en": "Salsa, son and champeta, live",
        "curated_ids": [
            "ptr_V008",
            "ptr_W130",
            "ptr_dv_020",
            "ptr_W110",
            "ptr_occ_009",
            "ptr_W100",
            "ptr_W121",
        ],
        "categories": ["bar", "club", "restaurant", "cafe"],
    },
    {
        "key": "favoritos-locales", "icon": "location",
        "title_es": "Favoritos Locales", "title_en": "Local Favorites",
        "desc_es": "Donde comen los cartageneros, no los tours", "desc_en": "Where cartageneros actually eat",
        "curated_ids": [
            "ptr_W101",
            "ptr_R012",
            "ptr_occ_006",
            "ptr_occ_007",
            "ptr_W106",
            "ptr_R031",
            "ptr_occ_018",
        ],
        "categories": ["restaurant", "cafe"],
    },
    {
        "key": "cafe-desayuno", "icon": "cafe",
        "title_es": "Café y Desayuno", "title_en": "Coffee & Breakfast",
        "desc_es": "Café de origen y el mejor arranque del día", "desc_en": "Origin coffee and the best start to the day",
        "curated_ids": [
            "ptr_W120",
            "ptr_V010",
            "ptr_V012",
            "ptr_W121",
            "ptr_V011",
            "ptr_R142",
        ],
        "categories": ["cafe", "restaurant"],
    },
    {
        "key": "brunch", "icon": "restaurant",
        "title_es": "Brunch", "title_en": "Brunch",
        "desc_es": "Media mañana de fin de semana, con ambiente", "desc_en": "Weekend late-morning, with ambiance",
        "curated_ids": [
            "ptr_W120",
            "ptr_W111",
            "ptr_007",
            "ptr_V013",
        ],
        "categories": ["cafe", "restaurant", "bar", "hotel"],
    },
    {
        "key": "ceviche-mariscos", "icon": "fish",
        "title_es": "Ceviche y Mariscos", "title_en": "Ceviche & Seafood",
        "desc_es": "Lo más fresco del Caribe", "desc_en": "The freshest of the Caribbean",
        "curated_ids": [
            "ptr_R031",
            "ptr_W105",
            "ptr_R022",
            "ptr_R026",
            "ptr_dv_008",
            "ptr_R021",
            "ptr_occ_020",
        ],
        "categories": ["restaurant"],
    },
    {
        "key": "street-food", "icon": "fast-food",
        "title_es": "Street Food", "title_en": "Street Food",
        "desc_es": "Arepa de huevo, pinchos y dulces al momento", "desc_en": "Arepa de huevo, pinchos and sweets, fresh",
        "curated_ids": [
            "ptr_occ_008",
            "ptr_W106",
            "ptr_dv_018",
            "ptr_occ_019",
        ],
        "categories": ["restaurant", "attraction"],
    },
    {
        "key": "cocteles", "icon": "wine",
        "title_es": "Coctelería de Autor", "title_en": "Cocktail Bars",
        "desc_es": "Los mejores tragos de la ciudad", "desc_en": "The city's best cocktails",
        "curated_ids": [
            "ptr_V001",
            "ptr_V002",
            "ptr_R022",
            "ptr_occ_004",
            "ptr_occ_005",
            "ptr_V023",
        ],
        "categories": ["bar", "club", "restaurant"],
    },
    {
        "key": "rumba", "icon": "musical-notes",
        "title_es": "Rumba y Baile", "title_en": "Dancing & Nightclubs",
        "desc_es": "Donde se baila hasta tarde (jue–sáb)", "desc_en": "Where the city dances late (Thu–Sat)",
        "curated_ids": [
            "ptr_W131",
            "ptr_V023",
            "ptr_W130",
            "ptr_V008",
            "ptr_occ_021",
        ],
        "categories": ["club", "bar"],
    },
    {
        "key": "grupo-fiesta", "icon": "people",
        "title_es": "Planes de Grupo", "title_en": "Group & Party",
        "desc_es": "Yates, islas de fiesta y noche en grupo", "desc_en": "Yachts, party islands and group nights",
        "curated_ids": [
            "ptr_occ_010",
            "ptr_W140",
            "ptr_W131",
            "ptr_dv2_002",
            "ptr_dv2_003",
        ],
        "categories": ["beach_club", "club", "yacht", "service"],
    },
    {
        "key": "beach-clubs", "icon": "umbrella",
        "title_es": "Beach Clubs", "title_en": "Beach Clubs",
        "desc_es": "Islas y playas — de fiesta a familia", "desc_en": "Islands and beaches — party to family",
        "curated_ids": [
            "ptr_W141",
            "ptr_W142",
            "ptr_W140",
            "ptr_X1123",
            "ptr_dv2_009",
            "ptr_X1215",
            "ptr_occ_011",
            "ptr_dv2_007",
            "ptr_occ_012",
            "ptr_X1189",
        ],
        "categories": ["beach_club", "hotel"],
    },
    {
        "key": "saludable", "icon": "leaf",
        "title_es": "Saludable y Veggie", "title_en": "Healthy & Vegan",
        "desc_es": "Bowls, veggie y opciones conscientes", "desc_en": "Bowls, veggie and mindful options",
        "curated_ids": [
            "ptr_R125",
            "ptr_R003",
            "ptr_occ_015",
        ],
        "categories": ["restaurant"],
    },
    {
        "key": "cafes-trabajo", "icon": "laptop",
        "title_es": "Cafés para Trabajar", "title_en": "Work-Friendly Cafés",
        "desc_es": "Wifi, enchufes y ambiente para portátil", "desc_en": "Wifi, outlets and a laptop-friendly vibe",
        "curated_ids": [
            "ptr_V010",
            "ptr_V012",
            "ptr_W120",
            "ptr_1327",
            "ptr_occ_014",
            "ptr_occ_022",
        ],
        "categories": ["cafe", "restaurant"],
    },
    {
        "key": "postres", "icon": "ice-cream",
        "title_es": "Postres y Dulces", "title_en": "Dessert & Sweets",
        "desc_es": "Gelato, paletas y patisserie para refrescar", "desc_en": "Gelato, popsicles and patisserie to cool off",
        "curated_ids": [
            "ptr_occ_002",
            "ptr_occ_003",
            "ptr_V013",
            "ptr_W104",
            "ptr_dv_018",
        ],
        "categories": ["cafe", "restaurant", "attraction"],
    },
    {
        "key": "spa-bienestar", "icon": "flower",
        "title_es": "Spa y Bienestar", "title_en": "Wellness & Spa",
        "desc_es": "Rituales y masajes en los mejores spas", "desc_en": "Rituals and massages at the top spas",
        "curated_ids": [
            "ptr_W152",
            "ptr_V040",
            "ptr_W154",
            "ptr_V042",
            "ptr_V044",
            "ptr_W150",
        ],
        "categories": ["spa"],
    },
    {
        "key": "ocasion-especial", "icon": "sparkles",
        "title_es": "Ocasión Especial", "title_en": "Special Occasion",
        "desc_es": "Para celebrar en grande — mesas icónicas", "desc_en": "To celebrate big — iconic tables",
        "curated_ids": [
            "ptr_R102",
            "ptr_R101",
            "ptr_R105",
            "ptr_dv_008",
            "ptr_occ_001",
            "ptr_R104",
            "ptr_W102",
        ],
        "categories": ["restaurant"],
    },
    {
        "key": "lujo-total", "icon": "diamond",
        "title_es": "Lujo Total", "title_en": "Pure Luxury",
        "desc_es": "Lo más elite de Cartagena — hoteles legendarios y alta cocina",
        "desc_en": "Cartagena's most elite — legendary hotels and fine dining",
        "curated_ids": [
            "ptr_ho_004", "ptr_ho_005", "ptr_ho_003", "ptr_1406", "ptr_1401",
            "ptr_miss_002", "ptr_dv_013", "ptr_007", "ptr_1403", "ptr_dv2_025",
            "ptr_dv2_024", "ptr_X1124",
            "ptr_R102", "ptr_R101", "ptr_R104", "ptr_W100", "ptr_R105",
            "ptr_dv_009", "ptr_R103", "ptr_dv2_017", "ptr_dv_008", "ptr_W102", "ptr_1300",
            "ptr_V050",
        ],
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
    curated = c.get("curated_ids")
    if curated:
        # Curated collection: return EXACTLY these venues, in this order
        # (missing ones simply drop). No algorithmic re-ranking — the
        # curation IS the ranking.
        found = {p["partner_id"]: p async for p in
                 db.partners.find({"partner_id": {"$in": curated}}, CARD_FIELDS)}
        rows = [found[pid] for pid in curated if pid in found][:limit]
    else:
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
        if c.get("curated_ids"):
            count = await db.partners.count_documents({"partner_id": {"$in": c["curated_ids"]}})
        else:
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
