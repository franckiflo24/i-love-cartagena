"""
Restaurants & Bars EXTRA seed — Cartagena directory (Feb 2026).
Source: user-provided spreadsheet "RESTAURANTES_EN_CARTAGENA.xlsx".

This is the FULL city directory (~145 unique venues across 10 sub-categories).
The merger in server.py will:
  • Match each entry by normalized name (case+accent insensitive) against
    existing partners.
  • If MATCHED: just update the `subcategory` field (preserving the curated
    IG/website/rating/image already in the DB).
  • If NEW: create the partner with auto-generated Instagram handle
    `{slug}cartagena`, empty website, default category banner, tier=popular.

Sub-category mapping (Excel ES → DB key):
  ITALIANO            → italian
  FAST FOOD           → fastfood
  VEGETARIANOS/HEALTY → vegetarian
  GASTRONOMICOS       → gastronomic
  CAFÉ                → cafe
  COFFEE SHOP         → cafe
  ARABE/MEDITERRANEO  → mediterranean
  COLOMBIANO          → colombian
  ASIATICO            → asian
  BAR Y DISCOTECAS    → (category=club, subcategory=bar)
"""

from typing import List, Dict, Any

# Sub-category mapping from Excel labels to canonical DB keys
SUB_MAP = {
    "ITALIANO": "italian",
    "FAST FOOD": "fastfood",
    "VEGETARIANOS/HEALTY": "vegetarian",
    "GASTRONOMICOS": "gastronomic",
    "CAFÉ": "cafe",
    "COFFEE SHOP": "cafe",
    "ARABE/MEDITERRANEO": "mediterranean",
    "COLOMBIANO": "colombian",
    "ASIATICO": "asian",
    "BAR Y DISCOTECAS": "bar",
}

# Sub-category human labels (shown as filter chips in the UI)
SUB_LABELS_ES = {
    "italian": "Italiano",
    "fastfood": "Fast Food",
    "vegetarian": "Vegetariano / Healthy",
    "gastronomic": "Gastronómicos",
    "cafe": "Café",
    "mediterranean": "Árabe / Mediterráneo",
    "colombian": "Colombiano",
    "asian": "Asiático",
    "bar": "Bar y Discotecas",
    "international": "Internacional",
    "seafood": "Del Mar",
    "arab": "Árabe",
}

# (name, excel_sub_category)
# Already deduped (case-insensitive on normalized name).
RAW_ENTRIES: List[tuple] = [
    ("JULIETTE & YOYO - CASA BOHEME", "ITALIANO"),
    ("HOME BURGERS", "FAST FOOD"),
    ("NORMA", "VEGETARIANOS/HEALTY"),
    ("VEDANA CARTA AJENA", "VEGETARIANOS/HEALTY"),
    ("TACO BEACH", "FAST FOOD"),
    ("BENITTO FIT", "VEGETARIANOS/HEALTY"),
    ("CHOICES", "VEGETARIANOS/HEALTY"),
    ("CASA HISTORICA 1927", "GASTRONOMICOS"),
    ("ATRIUM", "GASTRONOMICOS"),
    ("FORNAIO", "ITALIANO"),
    ("VIDA", "GASTRONOMICOS"),
    ("PALOSANTO", "GASTRONOMICOS"),
    ("DISTRITO", "GASTRONOMICOS"),
    ("CASA DELLA PASTA", "ITALIANO"),
    ("DON IGNAZIO", "ITALIANO"),
    ("BAJO LA PALMA", "GASTRONOMICOS"),
    ("EL GOBERNADOR", "GASTRONOMICOS"),
    ("ONECHEEZ", "FAST FOOD"),
    ("DI SILVIO TRATTORIA", "ITALIANO"),
    ("GOKELA", "GASTRONOMICOS"),
    ("ANA RESTAURANTE", "GASTRONOMICOS"),
    ("DA PIETRO", "ITALIANO"),
    ("SANTOCO", "GASTRONOMICOS"),
    ("REINA", "GASTRONOMICOS"),
    ("AREPA MARIOLA", "COLOMBIANO"),
    ("MANNA", "GASTRONOMICOS"),
    ("EL CORRAL", "FAST FOOD"),
    ("VITROLA", "GASTRONOMICOS"),
    ("EL ARTESANO", "GASTRONOMICOS"),
    ("MAGNOLIA", "GASTRONOMICOS"),
    ("TACOS EL GORDO", "FAST FOOD"),
    ("TRATTORIA WIPPY", "ITALIANO"),
    ("ELY D´GYROS", "FAST FOOD"),
    ("MAMA´S PIZZA", "ITALIANO"),
    ("EL ARSENAL", "GASTRONOMICOS"),
    ("PORTHOS", "GASTRONOMICOS"),
    ("VERONA PIZZERIA", "ITALIANO"),
    ("CAFÉ KANUU", "CAFÉ"),
    ("LA PEPITA", "GASTRONOMICOS"),
    ("LE GRAZIE", "ITALIANO"),
    ("AL ALMA", "GASTRONOMICOS"),
    ("CAFÉ MONASTERIO", "CAFÉ"),
    ("BOURBON ST", "BAR Y DISCOTECAS"),
    ("LA BRIOCHE", "GASTRONOMICOS"),
    ("7 CIELOS", "BAR Y DISCOTECAS"),
    ("EL BURGUES", "FAST FOOD"),
    ("FONTANA", "GASTRONOMICOS"),
    ("SE VOLVIÓ PRISPI", "CAFÉ"),
    ("EL PASQUIN DE JOACO", "BAR Y DISCOTECAS"),
    ("4 GATTI", "ITALIANO"),
    ("SAN PEDRO CAFÉ", "CAFÉ"),
    ("TITO BRAVO", "GASTRONOMICOS"),
    ("NIA BAKERY", "GASTRONOMICOS"),
    ("QUEBRACHO", "GASTRONOMICOS"),
    ("EL BURLADOR", "GASTRONOMICOS"),
    ("PIZZERIA PAVIA", "ITALIANO"),
    ("CAFÉ SAN ALBERTO", "CAFÉ"),
    ("LA CABRERA", "GASTRONOMICOS"),
    ("M COCINA ARABE", "ARABE/MEDITERRANEO"),
    ("SEMOLINA", "GASTRONOMICOS"),
    ("ERASE UN CAFÉ", "CAFÉ"),
    ("LA CHULA", "GASTRONOMICOS"),
    ("HARISSA", "ARABE/MEDITERRANEO"),
    ("STEFANO BRUNCH", "GASTRONOMICOS"),
    ("BUFFALO GRILL", "GASTRONOMICOS"),
    ("RESTAURANTE ARABE BOCAGRANDE", "ARABE/MEDITERRANEO"),
    ("ERASE UN CAFÉ CLERO", "GASTRONOMICOS"),
    ("HABBAB", "ARABE/MEDITERRANEO"),
    ("CELELE", "GASTRONOMICOS"),
    ("LA ESQUINA DEL PANDEBONO", "COLOMBIANO"),
    ("COLLAGE", "GASTRONOMICOS"),
    ("CHARLADERO", "GASTRONOMICOS"),
    ("TAHINI KEBAB", "ARABE/MEDITERRANEO"),
    ("CARMEN", "GASTRONOMICOS"),
    ("PERCIMON", "GASTRONOMICOS"),
    ("MARIA ROSA", "GASTRONOMICOS"),
    ("DONJUAN", "GASTRONOMICOS"),
    ("MUNA D RES", "GASTRONOMICOS"),
    ("LA TAPERIA", "GASTRONOMICOS"),
    ("ALMA", "GASTRONOMICOS"),
    ("EPOCA", "GASTRONOMICOS"),
    ("LA GARZA", "GASTRONOMICOS"),
    ("EGRA RESTAURANTE", "GASTRONOMICOS"),
    ("1621", "GASTRONOMICOS"),
    ("LEÑA Y CARBON", "GASTRONOMICOS"),
    ("ROMAN RESTAURANTE", "GASTRONOMICOS"),
    ("INKANTO", "GASTRONOMICOS"),
    ("ABACO", "GASTRONOMICOS"),
    ("ERRE", "GASTRONOMICOS"),
    ("LUCIA", "GASTRONOMICOS"),
    ("LUCENA CA-FE", "CAFÉ"),
    ("BRUNCHE", "GASTRONOMICOS"),
    ("AMERICAN DREAM", "GASTRONOMICOS"),
    ("COLOMBIANO ZONA 6", "COLOMBIANO"),
    ("CAFÉ DE LA MAÑANA", "CAFÉ"),
    ("PUNTO MULTIPLE", "GASTRONOMICOS"),
    ("CANDÉ", "GASTRONOMICOS"),
    ("KOKAU", "GASTRONOMICOS"),
    ("SIGNATURE", "GASTRONOMICOS"),
    ("KATHERIN", "GASTRONOMICOS"),
    ("AARHUS", "GASTRONOMICOS"),
    ("LA MULATA", "GASTRONOMICOS"),
    ("KANUU CAFÉ", "CAFÉ"),
    ("CENTRAL CHEF JULIAN", "GASTRONOMICOS"),
    ("SAN PASQUAL", "GASTRONOMICOS"),
    ("CASA PURA", "GASTRONOMICOS"),
    ("COLIBRÍ", "GASTRONOMICOS"),
    ("AUMA", "GASTRONOMICOS"),
    ("SANTO TORIBIO", "GASTRONOMICOS"),
    ("CREME", "GASTRONOMICOS"),
    ("OVEJA RESTAURANTE", "GASTRONOMICOS"),
    ("KAZABE", "GASTRONOMICOS"),
    ("BARUCO", "GASTRONOMICOS"),
    ("EUREKA CAFÉ", "CAFÉ"),
    ("PERÚ FUSION", "GASTRONOMICOS"),
    ("MACARENA", "GASTRONOMICOS"),
    ("TRENDI", "GASTRONOMICOS"),
    ("AMASA", "GASTRONOMICOS"),
    ("SAN NICOLAS", "GASTRONOMICOS"),
    ("MESTIZO", "GASTRONOMICOS"),
    ("COSTA VITA", "GASTRONOMICOS"),
    ("LA UNICA", "GASTRONOMICOS"),
    ("DOÑA LOLA", "GASTRONOMICOS"),
    ("TOWNHOUSE", "GASTRONOMICOS"),
    ("CUZCO", "GASTRONOMICOS"),
    ("MORENA", "GASTRONOMICOS"),
    ("ANDRES CARNE DE RES", "GASTRONOMICOS"),
    ("ABARE", "GASTRONOMICOS"),
    ("CASA MAR", "GASTRONOMICOS"),
    ("TAC RESTAURANTE", "GASTRONOMICOS"),
    ("URANIA BY SOPHIA", "GASTRONOMICOS"),
    ("HOTEL NIKU", "GASTRONOMICOS"),
    ("HUMO", "GASTRONOMICOS"),
    ("CARIBBEAN TABLE", "GASTRONOMICOS"),
    ("MISTURA", "GASTRONOMICOS"),
    ("NAMI", "GASTRONOMICOS"),
    ("SIERPE", "GASTRONOMICOS"),
    ("COLOMBIA GASTROBAR", "GASTRONOMICOS"),
    ("SABINE", "GASTRONOMICOS"),
    ("PAZETARIAN", "VEGETARIANOS/HEALTY"),
    ("MONTESACRO", "GASTRONOMICOS"),
    ("ANTILLAS", "GASTRONOMICOS"),
    ("AMACAGUA", "GASTRONOMICOS"),
    ("HAMACHI", "GASTRONOMICOS"),
    ("EL SITIO", "GASTRONOMICOS"),
    ("KONA", "GASTRONOMICOS"),
    ("MATIZ", "GASTRONOMICOS"),
    ("DEL MAR", "GASTRONOMICOS"),
    ("VIVE LA VIDA", "BAR Y DISCOTECAS"),
    ("TEXAS RESTRO BAR", "GASTRONOMICOS"),
    ("LA CATEDRAL", "GASTRONOMICOS"),
    ("JUAN DEL MAR", "GASTRONOMICOS"),
    ("KOYO RIO STEAKHOUSE", "GASTRONOMICOS"),
    ("SAN VALENTIN", "GASTRONOMICOS"),
    ("BUENA VIDA", "GASTRONOMICOS"),
    ("MARISQUERÍA", "GASTRONOMICOS"),
    ("SR. MIYAGI", "GASTRONOMICOS"),
    ("CUIKO", "GASTRONOMICOS"),
    ("RABO DE PEZ", "GASTRONOMICOS"),
    ("MAKI BAR", "GASTRONOMICOS"),
    ("RESTAURANTE OLANO", "GASTRONOMICOS"),
    ("LUNATICO", "GASTRONOMICOS"),
    ("MAR DE LAS ANTILLAS", "GASTRONOMICOS"),
    ("MASAKI", "GASTRONOMICOS"),
    ("UMA", "GASTRONOMICOS"),
    ("MAR Y ZIELO", "GASTRONOMICOS"),
    ("TAE CENTENARIO", "GASTRONOMICOS"),
    ("MAREA DE INDIAS", "GASTRONOMICOS"),
    ("LOBO DE MAR", "GASTRONOMICOS"),
    ("SAMBAL", "GASTRONOMICOS"),
    ("MARDELEVA", "GASTRONOMICOS"),
    ("FUERTE SAN SEBASTIAN", "GASTRONOMICOS"),
    ("TIERRA CARTAGENA", "GASTRONOMICOS"),
    ("MANGLAR", "GASTRONOMICOS"),
    ("CASA BAR DEL TUNEL", "GASTRONOMICOS"),
    ("LA CEVICHERIA", "GASTRONOMICOS"),
    ("HAVANA", "GASTRONOMICOS"),
    ("D PEZ", "GASTRONOMICOS"),
    ("GUATILA", "GASTRONOMICOS"),
    ("CLERO RESTAURANT", "GASTRONOMICOS"),
    ("SALON TROPICAL", "GASTRONOMICOS"),
    ("LA CASA DEL MARISCO", "GASTRONOMICOS"),
    ("EL CURATO", "GASTRONOMICOS"),
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
    ("BOHEME LOUNGE", "BAR Y DISCOTECAS"),
    ("1811 ROOFTOP", "BAR Y DISCOTECAS"),
    ("LA MOVIDA", "BAR Y DISCOTECAS"),
    ("51 SKYBAR", "BAR Y DISCOTECAS"),
    ("EL BARÓN", "BAR Y DISCOTECAS"),
    ("LA JUGADA", "BAR Y DISCOTECAS"),
    ("CASA PALENQUE", "BAR Y DISCOTECAS"),
    ("BARRA 7", "BAR Y DISCOTECAS"),
    ("LA JUMA BAR", "BAR Y DISCOTECAS"),
    ("TUCANDELA", "BAR Y DISCOTECAS"),
    ("THE SALOON", "BAR Y DISCOTECAS"),
    ("MIRADOR CULTURE BAR", "BAR Y DISCOTECAS"),
    ("MONDO COCKTAIL BAR", "BAR Y DISCOTECAS"),
    ("CLAUSTRUM", "BAR Y DISCOTECAS"),
    ("DONDE FIDEL", "BAR Y DISCOTECAS"),
    ("SEVEN 7 TIMES", "BAR Y DISCOTECAS"),
    ("EL CORO LOUNGE BAR", "BAR Y DISCOTECAS"),
    ("EIVISSA", "BAR Y DISCOTECAS"),
    ("BOURBON ST RD DISCO", "BAR Y DISCOTECAS"),
    ("FUBAR", "BAR Y DISCOTECAS"),
    ("PRESTIGE", "BAR Y DISCOTECAS"),
    ("AJENO ROOFTOP BAR", "BAR Y DISCOTECAS"),
    ("MONKEY BAR", "BAR Y DISCOTECAS"),
    ("BAR SELINA", "BAR Y DISCOTECAS"),
    ("CAFÉ HAVANA", "CAFÉ"),
    ("SKAPATE HOOKAH BAR", "BAR Y DISCOTECAS"),
    ("ALQUIMICO", "BAR Y DISCOTECAS"),
    ("SALON DE DESPECHO", "BAR Y DISCOTECAS"),
    ("PINK DOLPHIN", "BAR Y DISCOTECAS"),
    ("XO ROOFTOP", "BAR Y DISCOTECAS"),
    ("TERTULIA DE GETSEMANÍ", "BAR Y DISCOTECAS"),
    ("ZAZA CLUB", "BAR Y DISCOTECAS"),
    ("LEON BAR", "BAR Y DISCOTECAS"),
    ("TABOO", "BAR Y DISCOTECAS"),
    ("TEMPO", "BAR Y DISCOTECAS"),
    ("EL RINCÓN DE GETSEMANI", "BAR Y DISCOTECAS"),
    ("CASA D", "BAR Y DISCOTECAS"),
]


# Default banners for new directory entries (Unsplash placeholders)
DEFAULT_BANNERS = {
    "italian":       "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&h=600&fit=crop",
    "fastfood":      "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&h=600&fit=crop",
    "vegetarian":    "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&h=600&fit=crop",
    "gastronomic":   "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&h=600&fit=crop",
    "cafe":          "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800&h=600&fit=crop",
    "mediterranean": "https://images.unsplash.com/photo-1544025162-d76694265947?w=800&h=600&fit=crop",
    "colombian":     "https://images.unsplash.com/photo-1518176258769-f227c798150e?w=800&h=600&fit=crop",
    "asian":         "https://images.unsplash.com/photo-1617196034796-73dfa7b1fd56?w=800&h=600&fit=crop",
    "bar":           "https://images.unsplash.com/photo-1572116469696-31de0f17cc34?w=800&h=600&fit=crop",
}


def normalize_name(name: str) -> str:
    """Lowercase, strip accents/special chars for dedup matching."""
    import unicodedata
    s = unicodedata.normalize("NFKD", name).encode("ASCII", "ignore").decode().lower()
    # Remove punctuation, keep letters+digits+space
    out = "".join(c if c.isalnum() or c.isspace() else " " for c in s)
    return " ".join(out.split())


def slug_handle(name: str) -> str:
    """Generate Instagram handle slug from name."""
    import unicodedata
    s = unicodedata.normalize("NFKD", name).encode("ASCII", "ignore").decode().lower()
    out = "".join(c for c in s if c.isalnum())
    return out[:30] or "partner"


def build_extra_partners() -> List[Dict[str, Any]]:
    """Return the deduplicated list as partner-shaped dicts."""
    seen = set()
    partners = []
    for idx, (name, excel_sub) in enumerate(RAW_ENTRIES):
        key = normalize_name(name)
        if not key or key in seen:
            continue
        seen.add(key)
        sub = SUB_MAP.get(excel_sub.strip().upper(), "gastronomic")
        is_bar = sub == "bar"
        category = "club" if is_bar else "restaurant"
        slug = slug_handle(name)
        ig_handle = f"{slug}cartagena"
        partner_id = f"ptr_X{idx:03d}"
        sub_label = SUB_LABELS_ES.get(sub, sub.capitalize())
        partners.append({
            "partner_id": partner_id,
            "_normalized_name": key,  # used by merger
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
            "is_certified": False,  # directory-only (not yet partnered)
            "directory_only": True,  # flag the merger uses
            "order": 5000 + idx,
        })
    return partners
