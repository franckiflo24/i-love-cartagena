"""
Restaurants & Bars EXTRA seed — Cartagena directory (Feb 2026, V2).
Source: user-provided spreadsheet "RESTAURANTES_EN_CARTAGENA.xlsx" (2nd version).

The new spreadsheet groups venues into TEN sub-categories:
  • INTERNACIONAL        → international
  • FAST FOOD            → fastfood
  • ITALIANO             → italian
  • VEGETARIANOS/HEALTY  → vegetarian
  • ARABE/MEDITERRANEO   → mediterranean
  • COLOMBIANO           → colombian
  • CAFÉ                 → cafe
  • PERÚ FUSION          → peruvian   (NEW key in frontend)
  • ASIATICO             → asian
  • GASTRONOMICOS        → gastronomic
  • LOUNGE (bars)        → bar  (category=club)

The merger in server.py will:
  • Match each entry by normalized name (case+accent insensitive) against
    existing partners.
  • If MATCHED: upgrade `subcategory` (preserving curated IG/website/rating).
  • If NEW: create the partner with auto-generated Instagram handle
    `{slug}cartagena`, empty website, default category banner, tier=popular.
"""

from typing import List, Dict, Any

# Sub-category mapping from Excel labels to canonical DB keys
SUB_MAP = {
    "INTERNACIONAL": "international",
    "FAST FOOD": "fastfood",
    "ITALIANO": "italian",
    "VEGETARIANOS/HEALTY": "vegetarian",
    "ARABE/MEDITERRANEO": "mediterranean",
    "COLOMBIANO": "colombian",
    "CAFÉ": "cafe",
    "CAFE": "cafe",
    "COFFEE SHOP": "cafe",
    "PERÚ FUSION": "peruvian",
    "PERU FUSION": "peruvian",
    "ASIATICO": "asian",
    "ASIÁTICO": "asian",
    "GASTRONOMICOS": "gastronomic",
    "LOUNGE": "bar",
    "BAR Y DISCOTECAS": "bar",
}

# Sub-category human labels (shown as filter chips in the UI)
SUB_LABELS_ES = {
    "international": "Internacional",
    "fastfood": "Fast Food",
    "italian": "Italiano",
    "vegetarian": "Vegetariano / Healthy",
    "mediterranean": "Árabe / Mediterráneo",
    "colombian": "Colombiano",
    "cafe": "Café",
    "peruvian": "Perú / Fusión",
    "asian": "Asiático",
    "gastronomic": "Gastronómicos",
    "bar": "Bar / Discoteca",
    "seafood": "Del Mar",
    "arab": "Árabe",
}

# ─────────────────────────────────────────────────────────────────────
# RAW_ENTRIES — (name, excel_sub_category)
# Curated manually from the Excel after column-by-column parsing.
# Fragmented multi-row venue names were merged and obvious duplicates
# kept once (dedup will further apply priority rules).
# ─────────────────────────────────────────────────────────────────────
RAW_ENTRIES: List[tuple] = [
    # ── INTERNACIONAL ────────────────────────────────────────────────
    ("JULIETTE & YOYO", "INTERNACIONAL"),
    ("CASA BOHEME", "INTERNACIONAL"),
    ("CARTA AJENA", "INTERNACIONAL"),
    ("CASA HISTORICA 1927", "INTERNACIONAL"),
    ("PALOSANTO", "INTERNACIONAL"),
    ("EL GOBERNADOR", "INTERNACIONAL"),
    ("ANA RESTAURANTE", "INTERNACIONAL"),
    ("MAGNOLIA", "INTERNACIONAL"),
    ("EL ARSENAL", "INTERNACIONAL"),
    ("CAFÉ KANUU", "INTERNACIONAL"),
    ("CAFÉ MONASTERIO", "INTERNACIONAL"),
    ("7 CIELOS", "INTERNACIONAL"),
    ("EL PASQUIN DE JOACO", "INTERNACIONAL"),
    ("TITO BRAVO", "INTERNACIONAL"),
    ("QUEBRACHO", "INTERNACIONAL"),
    ("LA CABRERA", "INTERNACIONAL"),
    ("LA CHULA", "INTERNACIONAL"),
    ("BUFFALO GRILL", "INTERNACIONAL"),
    ("CLERO", "INTERNACIONAL"),
    ("COLLAGE", "INTERNACIONAL"),
    ("CHARLADERO", "INTERNACIONAL"),
    ("MUNA D RES", "INTERNACIONAL"),
    ("LEÑA Y CARBON", "INTERNACIONAL"),
    ("LUCIA LUCENA", "INTERNACIONAL"),
    ("AMERICAN DREAM", "INTERNACIONAL"),
    ("PUNTO MULTIPLE", "INTERNACIONAL"),
    ("CHEF JULIAN", "INTERNACIONAL"),
    ("AUMA", "INTERNACIONAL"),
    ("OVEJA RESTAURANTE", "INTERNACIONAL"),

    # ── FAST FOOD ────────────────────────────────────────────────────
    ("HOME BURGERS", "FAST FOOD"),
    ("TACO BEACH", "FAST FOOD"),
    ("ATRIUM", "FAST FOOD"),
    ("DISTRITO", "FAST FOOD"),
    ("ONECHEEZ", "FAST FOOD"),
    ("REINA", "FAST FOOD"),
    ("EL CORRAL", "FAST FOOD"),
    ("TACOS EL GORDO", "FAST FOOD"),
    ("ELY D´GYROS", "FAST FOOD"),
    ("PORTHOS", "FAST FOOD"),
    ("LA PEPITA", "FAST FOOD"),
    ("BOURBON ST", "FAST FOOD"),
    ("EL BURGUES", "FAST FOOD"),
    ("AREPA MARIOLA", "FAST FOOD"),

    # ── ITALIANO ─────────────────────────────────────────────────────
    ("NORMA", "ITALIANO"),
    ("BENITTO", "ITALIANO"),
    ("FORNAIO", "ITALIANO"),
    ("CASA DELLA PASTA", "ITALIANO"),
    ("DON IGNAZIO", "ITALIANO"),
    ("DI SILVIO TRATTORIA", "ITALIANO"),
    ("DA PIETRO", "ITALIANO"),
    ("VITROLA", "ITALIANO"),
    ("TRATTORIA WIPPY", "ITALIANO"),
    ("MAMA´S PIZZA", "ITALIANO"),
    ("VERONA PIZZERIA", "ITALIANO"),
    ("LE GRAZIE", "ITALIANO"),
    ("FONTANA", "ITALIANO"),
    ("4 GATTI", "ITALIANO"),
    ("PIZZERIA PAVIA", "ITALIANO"),
    ("SEMOLINA", "ITALIANO"),

    # ── VEGETARIANO / HEALTHY ────────────────────────────────────────
    ("VEDANA", "VEGETARIANOS/HEALTY"),
    ("FIT CHOICES", "VEGETARIANOS/HEALTY"),
    ("VIDA", "VEGETARIANOS/HEALTY"),
    ("BAJO LA PALMA", "VEGETARIANOS/HEALTY"),
    ("GOKELA", "VEGETARIANOS/HEALTY"),
    ("SANTOCO", "VEGETARIANOS/HEALTY"),
    ("MANNA", "VEGETARIANOS/HEALTY"),
    ("EL ARTESANO", "VEGETARIANOS/HEALTY"),
    ("PAZETARIAN", "VEGETARIANOS/HEALTY"),

    # ── ÁRABE / MEDITERRÁNEO ─────────────────────────────────────────
    ("EL BURLADOR", "ARABE/MEDITERRANEO"),
    ("M COCINA ARABE", "ARABE/MEDITERRANEO"),
    ("HARISSA", "ARABE/MEDITERRANEO"),
    ("RESTAURANTE ARABE BOCAGRANDE", "ARABE/MEDITERRANEO"),
    ("HABBAB", "ARABE/MEDITERRANEO"),
    ("TAHINI KEBAB", "ARABE/MEDITERRANEO"),
    ("MARIA ROSA", "ARABE/MEDITERRANEO"),
    ("LA TAPERIA", "ARABE/MEDITERRANEO"),
    ("LA GARZA", "ARABE/MEDITERRANEO"),
    ("EGRA RESTAURANTE", "ARABE/MEDITERRANEO"),
    ("ROMAN RESTAURANTE", "ARABE/MEDITERRANEO"),

    # ── COLOMBIANO ───────────────────────────────────────────────────
    ("CANDÉ", "COLOMBIANO"),
    ("LUCIA LA MULATA", "COLOMBIANO"),
    ("SAN PASQUAL", "COLOMBIANO"),
    ("SANTO TORIBIO", "COLOMBIANO"),
    ("KAZABE", "COLOMBIANO"),
    ("MACARENA", "COLOMBIANO"),
    ("SAN NICOLAS", "COLOMBIANO"),
    ("DOÑA LOLA", "COLOMBIANO"),
    ("MORENA", "COLOMBIANO"),
    ("CARIBBEAN TABLE", "COLOMBIANO"),
    ("COLOMBIA GASTROBAR", "COLOMBIANO"),
    ("ANTILLAS", "COLOMBIANO"),
    ("EL SITIO", "COLOMBIANO"),
    ("MATIZ", "COLOMBIANO"),
    ("LA CATEDRAL", "COLOMBIANO"),
    ("SAN VALENTIN", "COLOMBIANO"),
    ("LUNATICO", "COLOMBIANO"),
    ("LA UNICA", "COLOMBIANO"),
    ("TIERRA CARTAGENA", "COLOMBIANO"),
    ("CASA BAR DEL TUNEL", "COLOMBIANO"),
    ("HAVANA", "COLOMBIANO"),
    ("GUATILA", "COLOMBIANO"),
    ("SALON TROPICAL", "COLOMBIANO"),
    ("EL CURATO", "COLOMBIANO"),
    ("ZONA 6", "COLOMBIANO"),

    # ── CAFÉ ─────────────────────────────────────────────────────────
    ("AL ALMA CAFÉ", "CAFÉ"),
    ("LA BRIOCHE", "CAFÉ"),
    ("SE VOLVIÓ PRISPI COFFEE SHOP", "CAFÉ"),
    ("SAN PEDRO CAFÉ", "CAFÉ"),
    ("NIA BAKERY", "CAFÉ"),
    ("CAFÉ SAN ALBERTO", "CAFÉ"),
    ("ERASE UN CAFÉ", "CAFÉ"),
    ("STEFANO BRUNCH", "CAFÉ"),
    ("LA ESQUINA DEL PANDEBONO", "CAFÉ"),
    ("PERCIMON", "CAFÉ"),
    ("EPOCA", "CAFÉ"),
    ("ABACO", "CAFÉ"),
    ("CA-FE", "CAFÉ"),
    ("BRUNCHE", "CAFÉ"),
    ("CAFÉ DE LA MAÑANA", "CAFÉ"),
    ("KATHERIN AARHUS", "CAFÉ"),
    ("CAFÉ CENTRAL", "CAFÉ"),
    ("COLIBRÍ", "CAFÉ"),
    ("CAFÉ CREME", "CAFÉ"),
    ("EUREKA CAFÉ", "CAFÉ"),
    ("AMASA", "CAFÉ"),

    # ── PERÚ / FUSIÓN ────────────────────────────────────────────────
    ("LA UNICA PERÚ", "PERÚ FUSION"),
    ("CUZCO", "PERÚ FUSION"),
    ("ABARE", "PERÚ FUSION"),
    ("HUMO", "PERÚ FUSION"),
    ("SIERPE", "PERÚ FUSION"),
    ("MONTESACRO", "PERÚ FUSION"),
    ("TAC RESTAURANTE", "PERÚ FUSION"),
    ("TEXAS RESTRO BAR", "PERÚ FUSION"),
    ("KOYO RIO STEAKHOUSE", "PERÚ FUSION"),
    ("CUIKO", "PERÚ FUSION"),
    ("RESTAURANTE OLANO", "PERÚ FUSION"),
    ("UMA", "PERÚ FUSION"),
    ("CASA PURA", "PERÚ FUSION"),
    ("BARUCO", "PERÚ FUSION"),

    # ── ASIÁTICO ─────────────────────────────────────────────────────
    ("NIKU", "ASIATICO"),
    ("NAMI", "ASIATICO"),
    ("HAMACHI", "ASIATICO"),
    ("KONA", "ASIATICO"),
    ("VIVE LA VIDA", "ASIATICO"),
    ("SR. MIYAGI", "ASIATICO"),
    ("MAKI BAR", "ASIATICO"),
    ("MASAKI", "ASIATICO"),
    ("TAE CENTENARIO", "ASIATICO"),
    ("CASA MAR", "ASIATICO"),
    ("MESTIZO", "ASIATICO"),
    ("TOWNHOUSE", "ASIATICO"),
    ("URANIA BY SOPHIA", "ASIATICO"),
    ("MISTURA", "ASIATICO"),
    ("SABINE", "ASIATICO"),
    ("KOKAU SIGNATURE", "ASIATICO"),
    ("TRENDI", "ASIATICO"),

    # ── GASTRONÓMICOS (incluye Del Mar / Carnes / Cocina de autor) ───
    ("CELELE", "GASTRONOMICOS"),
    ("CARMEN", "GASTRONOMICOS"),
    ("DONJUAN", "GASTRONOMICOS"),
    ("ALMA", "GASTRONOMICOS"),
    ("RESTAURANTE 1621", "GASTRONOMICOS"),
    ("INKANTO", "GASTRONOMICOS"),
    ("ERRE", "GASTRONOMICOS"),
    ("ANDRES CARNE DE RES", "GASTRONOMICOS"),
    ("AMACAGUA", "GASTRONOMICOS"),
    ("DEL MAR", "GASTRONOMICOS"),
    ("JUAN DEL MAR", "GASTRONOMICOS"),
    ("BUENA VIDA MARISQUERÍA", "GASTRONOMICOS"),
    ("RABO DE PEZ", "GASTRONOMICOS"),
    ("MAR DE LAS ANTILLAS", "GASTRONOMICOS"),
    ("MAR Y ZIELO", "GASTRONOMICOS"),
    ("MAREA DE INDIAS", "GASTRONOMICOS"),
    ("LOBO DE MAR", "GASTRONOMICOS"),
    ("MARDELEVA", "GASTRONOMICOS"),
    ("FUERTE SAN SEBASTIAN", "GASTRONOMICOS"),
    ("MANGLAR", "GASTRONOMICOS"),
    ("LA CEVICHERIA", "GASTRONOMICOS"),
    ("D PEZ", "GASTRONOMICOS"),
    ("CLERO RESTAURANT", "GASTRONOMICOS"),
    ("LA CASA DEL MARISCO", "GASTRONOMICOS"),
    ("SAMBAL", "GASTRONOMICOS"),
    ("TOMILLO", "GASTRONOMICOS"),
    ("LA VIEJA GUARDIA", "GASTRONOMICOS"),
    ("CANCHA", "GASTRONOMICOS"),
    ("LA PESCADERIA", "GASTRONOMICOS"),
    ("PORTON DE SAN SEBASTIAN", "GASTRONOMICOS"),
    ("TITOTÉ", "GASTRONOMICOS"),
    ("SAN MARINO", "GASTRONOMICOS"),
    ("DONDE OLANO", "GASTRONOMICOS"),
    ("TESOROS DEL MAR", "GASTRONOMICOS"),
    ("LA PICUA", "GASTRONOMICOS"),
    ("COSTA VITA", "GASTRONOMICOS"),

    # ── LOUNGE / BARES / DISCOTECAS ──────────────────────────────────
    ("BOHEME LOUNGE", "LOUNGE"),
    ("1811 ROOFTOP", "LOUNGE"),
    ("LA MOVIDA", "LOUNGE"),
    ("51 SKYBAR", "LOUNGE"),
    ("EL BARÓN", "LOUNGE"),
    ("LA JUGADA", "LOUNGE"),
    ("CASA PALENQUE", "LOUNGE"),
    ("BARRA 7", "LOUNGE"),
    ("LA JUMA BAR", "LOUNGE"),
    ("TUCANDELA", "LOUNGE"),
    ("THE SALOON", "LOUNGE"),
    ("MIRADOR CULTURE BAR", "LOUNGE"),
    ("MONDO COCKTAIL BAR", "LOUNGE"),
    ("CLAUSTRUM", "LOUNGE"),
    ("DONDE FIDEL", "LOUNGE"),
    ("SEVEN 7 TIMES", "LOUNGE"),
    ("EL CORO LOUNGE BAR", "LOUNGE"),
    ("EIVISSA", "LOUNGE"),
    ("BOURBON ST RD DISCO", "LOUNGE"),
    ("RD DISCO", "LOUNGE"),
    ("FUBAR", "LOUNGE"),
    ("PRESTIGE", "LOUNGE"),
    ("AJENO ROOFTOP BAR", "LOUNGE"),
    ("MONKEY BAR", "LOUNGE"),
    ("BAR SELINA", "LOUNGE"),
    ("CAFÉ HAVANA", "LOUNGE"),
    ("SKAPATE HOOKAH BAR", "LOUNGE"),
    ("ALQUIMICO", "LOUNGE"),
    ("SALON DE DESPECHO", "LOUNGE"),
    ("PINK DOLPHIN", "LOUNGE"),
    ("XO ROOFTOP", "LOUNGE"),
    ("TERTULIA DE GETSEMANÍ", "LOUNGE"),
    ("ZAZA CLUB", "LOUNGE"),
    ("LEON BAR", "LOUNGE"),
    ("TABOO", "LOUNGE"),
    ("TEMPO", "LOUNGE"),
    ("EL RINCÓN DE GETSEMANI", "LOUNGE"),
    ("CASA D", "LOUNGE"),
]


# Default banners for new directory entries (Unsplash placeholders)
DEFAULT_BANNERS = {
    "international": "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&h=600&fit=crop",
    "italian":       "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&h=600&fit=crop",
    "fastfood":      "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&h=600&fit=crop",
    "vegetarian":    "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&h=600&fit=crop",
    "gastronomic":   "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&h=600&fit=crop",
    "cafe":          "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800&h=600&fit=crop",
    "mediterranean": "https://images.unsplash.com/photo-1544025162-d76694265947?w=800&h=600&fit=crop",
    "colombian":     "https://images.unsplash.com/photo-1518176258769-f227c798150e?w=800&h=600&fit=crop",
    "asian":         "https://images.unsplash.com/photo-1617196034796-73dfa7b1fd56?w=800&h=600&fit=crop",
    "peruvian":      "https://images.unsplash.com/photo-1547573854-74d2a71d0826?w=800&h=600&fit=crop",
    "bar":           "https://images.unsplash.com/photo-1572116469696-31de0f17cc34?w=800&h=600&fit=crop",
}


def normalize_name(name: str) -> str:
    """Lowercase, strip accents/special chars for dedup matching."""
    import unicodedata
    s = unicodedata.normalize("NFKD", name).encode("ASCII", "ignore").decode().lower()
    out = "".join(c if c.isalnum() or c.isspace() else " " for c in s)
    return " ".join(out.split())


def slug_handle(name: str) -> str:
    """Generate Instagram handle slug from name."""
    import unicodedata
    s = unicodedata.normalize("NFKD", name).encode("ASCII", "ignore").decode().lower()
    out = "".join(c for c in s if c.isalnum())
    return out[:30] or "partner"


def build_extra_partners() -> List[Dict[str, Any]]:
    """Return the deduplicated list as partner-shaped dicts.

    Dedup priority: when the same normalized name appears in more than one
    sub-category, prefer LOUNGE → cuisine-specific → GASTRONOMICOS (generic).
    """
    PRIORITY = {
        "LOUNGE": 1, "BAR Y DISCOTECAS": 1,
        "CAFÉ": 2, "COFFEE SHOP": 2,
        "ARABE/MEDITERRANEO": 2,
        "VEGETARIANOS/HEALTY": 2,
        "ITALIANO": 2,
        "FAST FOOD": 2,
        "COLOMBIANO": 2,
        "ASIATICO": 2,
        "PERÚ FUSION": 2,
        "INTERNACIONAL": 3,
        "GASTRONOMICOS": 9,  # generic fallback (lowest priority)
    }
    best: dict = {}
    first_idx: dict = {}
    for idx, (name, excel_sub) in enumerate(RAW_ENTRIES):
        nk = normalize_name(name)
        if not nk:
            continue
        prio = PRIORITY.get(excel_sub.strip().upper(), 5)
        if nk not in best or prio < best[nk][1]:
            best[nk] = (name, prio, excel_sub)
            first_idx[nk] = idx

    partners = []
    for nk, (name, _, excel_sub) in best.items():
        idx = first_idx[nk]
        sub = SUB_MAP.get(excel_sub.strip().upper(), "gastronomic")
        is_bar = sub == "bar"
        category = "club" if is_bar else "restaurant"
        slug = slug_handle(name)
        ig_handle = f"{slug}cartagena"
        partner_id = f"ptr_X{idx:03d}"
        sub_label = SUB_LABELS_ES.get(sub, sub.capitalize())
        partners.append({
            "partner_id": partner_id,
            "_normalized_name": nk,
            "name": name.title().replace("´", "'"),
            "category": category,
            "subcategory": sub,
            "tier": "popular",
            "description": f"{sub_label} en Cartagena. Directorio oficial Amo Cartagena.",
            "image_url": DEFAULT_BANNERS.get(sub, DEFAULT_BANNERS["gastronomic"]),
            "location": {"lat": 10.4220, "lng": -75.5482},
            "address": "Cartagena de Indias, Colombia",
            "booking_link": "",
            "instagram": ig_handle,
            "price_range": "$$",
            "cuisine": sub_label,
            "rating": 4.3,
            "reviews": 0,
            "experience": f"{sub_label} · Cartagena",
            "is_certified": False,
            "directory_only": True,
            "order": 5000 + idx,
        })
    return partners
