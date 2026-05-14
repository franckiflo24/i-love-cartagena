"""
Wellness, Beach Club & Hotel seed — Cartagena directory (Feb 2026).
Source: user-provided spreadsheet "BASE_DE_DATO_APP.xlsx" (sheets: WELLNESS,
BEACH CLUB, HOTEL).

The merger reuses the same logic as restaurants_extra.py:
  • Match each entry by normalized name (case+accent insensitive) against
    existing partners.
  • If MATCHED: upgrade `subcategory` / `category` (preserving curated fields).
  • If NEW: create the partner with auto-generated Instagram handle
    `{slug}cartagena`, default banner per sub-category, tier=popular
    (or premium/lujo for hotels using name-based heuristics).
"""

from typing import List, Dict, Any, Tuple
import unicodedata


# ─────────────────────────────────────────────────────────────────────
# WELLNESS  — 7 sub-categories
# ─────────────────────────────────────────────────────────────────────
WELLNESS_RAW: List[Tuple[str, str]] = [
    # ── SPA ──────────────────────────────────────────────────────────
    ("AURIUM", "spa"),
    ("MG SPA CENTRO", "spa"),
    ("SCHARLESTON SANTA TERESA SPA", "spa"),
    ("SPA BEAUTY LUZ ORTIZ", "spa"),
    ("SPA KALAMARI", "spa"),
    ("DIEGO MOYA BOCAGRANDE", "spa"),
    ("DIEGO MOYA CENTRO", "spa"),
    ("MG SPA BOCAGRANDE", "spa"),
    ("WELNESS SPA MOVIL", "spa"),
    ("AORAL SPA", "spa"),
    ("MONICA CRUZ CENTRO", "spa"),
    ("MONICA CRUZ MANGA", "spa"),
    ("MONICA CRUZ BOCAGRANDE", "spa"),
    ("DRA. MILENA OSORIO", "spa"),
    ("LUXURY CONCEPT", "spa"),
    ("SUPER WOW", "spa"),
    ("URBAN PLAZA", "spa"),
    ("AHAVA BEAUTY & WELNESS SPA", "spa"),
    ("HOUSE OF BAUTY", "spa"),
    ("LILI SPA MASSAGE", "spa"),

    # ── PELUQUERÍA / HAIR ────────────────────────────────────────────
    ("MORGAN´S BARBER CENTRO", "hair"),
    ("MORGAN´S BARBER BOCAGRANDE", "hair"),
    ("BARBA SANTA", "hair"),
    ("PELUQUERIA ANGIE JIMENEZ", "hair"),
    ("FIGARO BARBER SHOP", "hair"),
    ("CARLOS TORRES", "hair"),
    ("JERMAINE BARBERS", "hair"),
    ("ISABEL ROJAS", "hair"),
    ("DORIAN ZAMBRANO", "hair"),
    ("FELIPE WALKER HAIR SALON", "hair"),
    ("DM BAUTY SALON", "hair"),
    ("L'PELUQUERIA", "hair"),
    ("JULIETH HARMON SPA", "hair"),

    # ── UÑAS / NAILS ─────────────────────────────────────────────────
    ("MG SPA DE UÑAS CENTRO", "nails"),
    ("MG SPA DE UÑAS BOCAGRANDE", "nails"),
    ("NOIR BARBER & NAILS", "nails"),
    ("INVICTUS BARBER & NAILS", "nails"),
    ("SERENA NAILS SPA", "nails"),
    ("ANGEL´S PERFECT SPA", "nails"),
    ("NAILS OASI GETSEMANI", "nails"),
    ("NAILS ART GRICELYS", "nails"),
    ("BLESSING NAILS SPA", "nails"),
    ("DIEGO MOYA NAILS", "nails"),
    ("JESSICA RAMIREZ", "nails"),
    ("ISABEL ROJAS SPA", "nails"),
    ("FRANCYS NAILS", "nails"),

    # ── RECUPERACIÓN / RECOVERY ──────────────────────────────────────
    ("REBALANCE SUEROTERAPIA", "recovery"),
    ("PEREZ R", "recovery"),
    ("VALEO", "recovery"),

    # ── FITNESS ──────────────────────────────────────────────────────
    ("SPINNING SPORT CENTER", "fitness"),
    ("BODYTECH BOCAGRANDE", "fitness"),
    ("NARA STUDIO", "fitness"),
    ("STUDIO", "fitness"),
    ("PILATE PRO WORKS", "fitness"),
    ("PILATE POLI", "fitness"),
    ("MUEVETE A TU RITMO", "fitness"),

    # ── SPORT (surf · padel · paddle · kayak) ────────────────────────
    ("SHAKA SURF CLUB", "sport"),
    ("CLUB CARATEGNA", "sport"),
    ("POLYSURF", "sport"),
    ("WINDSPOT", "sport"),
    ("CARTAGENA SURF 420", "sport"),
    ("SURFING OHANA", "sport"),
    ("SOCIAL PADEL CLUB MANGA", "sport"),
    ("PADEL CLUB BOCAGRANDE", "sport"),
    ("EASY PADEL", "sport"),
    ("KARIB KAYAK CENTER", "sport"),
    ("PADDLE BOARD", "sport"),
    ("CARTACHO PADDLE", "sport"),
    ("PADDLE GLOBAL", "sport"),

    # ── YOGA ─────────────────────────────────────────────────────────
    ("SOMA YOGA", "yoga"),
    ("YOGA MAGDALENA LONGO", "yoga"),
    ("MARTESANA YOGA", "yoga"),
    ("VIVE YOGA", "yoga"),
    ("CASA CAROLINA YOGA", "yoga"),
    ("OMM WELLNESS", "yoga"),
    ("MANDALA YOGA", "yoga"),
]


WELLNESS_LABELS = {
    "spa": "Spa",
    "hair": "Peluquería",
    "nails": "Uñas",
    "recovery": "Recuperación",
    "fitness": "Fitness",
    "sport": "Sport",
    "yoga": "Yoga",
}

WELLNESS_BANNERS = {
    "spa":      "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=800&h=600&fit=crop",
    "hair":     "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800&h=600&fit=crop",
    "nails":    "https://images.unsplash.com/photo-1604654894610-df63bc536371?w=800&h=600&fit=crop",
    "recovery": "https://images.unsplash.com/photo-1599447421416-3414500d18a5?w=800&h=600&fit=crop",
    "fitness":  "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&h=600&fit=crop",
    "sport":    "https://images.unsplash.com/photo-1552674605-db6ffd4facb5?w=800&h=600&fit=crop",
    "yoga":     "https://images.unsplash.com/photo-1545205597-3d9d02c29597?w=800&h=600&fit=crop",
}


# ─────────────────────────────────────────────────────────────────────
# BEACH CLUB
# ─────────────────────────────────────────────────────────────────────
BEACH_CLUB_RAW: List[str] = [
    "BETHEL BELLINI", "FÉNIX BEACH", "CLUB KABANNA", "THE PINK MANGO",
    "CAPRI BEACH CLUB", "BORABORA", "PAO PAO", "MIRAMAR", "ATOLON",
    "MAKANI", "ROCHA BEACH CLUB", "ANAHO", "ISLA AMORES", "BOMBA BEACH CLUB",
    "WALA BEACH", "KALA BEACH", "ETEKA", "NAMASTÉ", "TAMARINDO BEACH HOUSE",
    "IBBIZA ISLAND BEACH CLUB", "FREEDOM BEACH CLUB", "MORENA BEACH CLUB",
    "MANTAS BEACH CLUB", "PA'UE", "BELA BEACH CLUB", "MAGATA", "DHARMA",
    "PLAYA CORAL", "BENDITA BEACH", "PALMARITO BEACH", "VIISTA MARE",
    "MARGARITA´S BEACH CLUB", "AMALIFE BEACH CLUB", "NENA BEACH",
    "KARIBANA BEACH CLUB", "MARAZAO", "MARINE BEACH", "ISLA DEL PIRATA",
    "BLUE APPLE",
]

BEACH_BANNER = "https://images.unsplash.com/photo-1546484458-6904289cd4f0?w=800&h=600&fit=crop"


# ─────────────────────────────────────────────────────────────────────
# HOTEL  (tier-based: popular / premium / lujo)
# ─────────────────────────────────────────────────────────────────────
HOTEL_RAW: List[str] = [
    "Sofitel Legend Santa Clara Cartagena",
    "Charleston Santa Teresa Cartagena",
    "Casa Pestagua",
    "Hotel Movich Cartagena De Indias",
    "Hotel Casa San Agustin",
    "Casa Carolina Hotel",
    "Casa Claver Loft Boutique Hotel",
    "Hotel Casa La Factoria by Faranda Boutique",
    "Hotel Bantu By Faranda Boutique",
    "Casa de Alba Hotel Boutique",
    "Casa Diluca Hotel Boutique",
    "Sophia Hotel",
    "La Passion by Masaya Collection",
    "Hotel Santa Catalina Cartagena",
    "Alfiz Hotel",
    "Cinco Quintas Hotel Boutique By SOHO",
    "Sol De Alba Hotel Boutique",
    "Hotel NH Cartagena Urban Royal",
    "Casa Lola Luxury Collection",
    "Anandá Hotel Boutique",
    "Casa Don Sancho",
    "Casa del Coliseo",
    "Casa del Arzobispado",
    "Hotel Casa Don Luis",
    "Hotel Casa La Merced",
    "Leones de Alba Hotel Boutique",
    "Casa BuGo",
    "Amarla Boutique Hotel",
    "Casa Córdoba Estrella",
    "Casa Córdoba Román",
    "Hotel Aguamarina",
    "Hotel Casa Real Cartagena",
    "Casa India Catalina",
    "Hotel Boutique Casona del Colegio",
    "Hotel Casona del Porvenir",
    "Delirio Hotel",
    "Casa Mantilla 3-37",
    "Nacar Hotel Cartagena Curio Collection by Hilton",
    "Bastion Luxury Hotel",
    "Townhouse Boutique Hotel",
    "Selina Cartagena",
    "Hotel Boutique Santo Toribio",
    "Casa Pizarro Hotel Boutique",
    "Hotel Capellan de Getsemani",
    "Casa Relax Hotel",
    "Hotel Monterrey Cartagena",
    "GHL Arsenal Hotel",
    "Hotel Cartagena Royal Inn",
    "Casa Canabal Hotel Boutique",
    "Hotel Stil Cartagena",
    "Hotel Don Pedro de Heredia",
    "Hotel Cartagena Plaza",
    "Hyatt Regency Cartagena",
    "Estelar Cartagena de Indias Hotel",
    "InterContinental Cartagena de Indias",
    "Hotel Capilla del Mar",
    "Hotel Dann Cartagena",
    "Holiday Inn Express Cartagena Bocagrande",
    "Hotel Almirante Cartagena Colombia",
    "Hotel Regatta Cartagena",
    "Oz Hotel Cartagena",
    "Oz Hotel Luxury",
    "Be Live Experience Cartagena Dubai",
    "Hotel Bocagrande",
    "Hotel Blue Concept Cartagena",
    "Hotel Atlantic Lux",
    "Hotel Dorado Plaza Bocagrande",
    "Hotel Costa del Sol Cartagena",
    "Hotel San Pietro Boutique",
    "Hotel Playa Club",
    "Hotel Bocagrande Suite By GEH Suites",
    "Hotel Or Cartagena",
    "Hotel Suite Bocagrande",
    "Hampton By Hilton Cartagena",
    "Hotel Marina Suites",
    "Hotel Poblado Plaza Cartagena",
    "Hotel Cartagena Millennium",
    "Hotel Coral Reef Cartagena",
    "Hotel Casa Tere Boutique",
    "Hotel Viaggio Puerto de Cartagena",
    "Hotel Zi One Luxury",
    "Hotel Boutique Castillo Ines Maria",
    "Hilton Cartagena",
    "Hotel Caribe by Faranda Grand",
    "Hotel Caribbean Cartagena",
    "Hotel Golden Cartagena",
    "Hotel Veleros Cartagena",
    "Hotel Summer Frente al Mar",
    "Hotel Oceania Cartagena",
    "Hotel Las Americas Casa de Playa",
    "Hotel Las Americas Torre del Mar",
    "Radisson Cartagena Ocean Pavillion Hotel",
    "Holiday Inn Cartagena Morros",
    "Morros Eco Hotel",
    "Los Morros Cartagena",
    "Morros Epic Cartagena",
    "Hotel Ibis Cartagena Marbella",
    "Hotel Velamar Boutique",
    "OSH Hotel Cartagena",
    "Makani Luxury Wanderlust",
    "Ermita Cartagena Tribute Portfolio Hotel",
    "Hotel Boutique Bóvedas de Santa Clara By Accor",
    "Casa Jagua Hotel Boutique",
    "Casa Bustamante Hotel Boutique",
    "Voilá Centro Histórico",
    "Voilá Signature Casa Isabel",
    "Casa La Española",
    "Casa Franco Hotel",
    "Casa La Merced by Mustique",
    "Casa Gastelbondo",
    "Casa Quero Luxury Villa Hotel",
    "Casa Cordoba Baru",
    "Casa Noel Cartagena",
    "Casa Gloria Getsemaní",
    "Casa Jaguar Getsemaní",
    "Casa Portal de Getsemaní",
    "Casa Santiago Boutique",
    "Casa Venecia Hotel Boutique",
    "Casa Movida Hostel Boutique",
    "Casa Pedro Romero",
    "Casa Canabal by Faranda",
    "Armeria Real Luxury Hotel & Spa",
    "San Lazaro Art Hotel",
    "Allure Chocolat by Karisma",
    "Allure Canela by Karisma",
    "Hotel Luna Nueva",
    "Hotel Boutique High Park",
    "Blue Apple Beach House",
    "Hotel Isla del Encanto",
    "Sofitel Barú Calablanca Beach Resort",
    "Aura Hotel Barú",
    "Hotel Las Islas",
    "Decameron Barú",
    "Corales de Indias",
    "GHL Corales de Indias",
    "Sonesta Hotel Cartagena",
    "Meliá Cartagena Karmairi",
    "Karmairi Cartagena Spa",
    "Hotel Casa Tere",
    "Hotel Boutique Casa Santamarina",
    "Hotel Casa Citella",
    "Hotel Boutique Casa Carolina",
    "Hotel Casa Castel",
    "Hotel Boutique Casa Marquez",
    "Hotel Casa La Mantilla",
    "Hotel Boutique Casa Evelina",
    "Hotel Boutique Casa Blanquita",
    "Casa Colonial Beach and Spa",
    "Casa Amanzi Hotel Cartagena",
    "Hotel Boutique Casa Mangle",
    "Hotel Boutique Casa Rosada",
    "Casa Roman Cartagena",
    "Casa Blue Cartagena",
    "Casa Verde Hotel Boutique",
    "Hotel Boutique Casa Santa Ana",
    "Casa Palma Cartagena",
    "Casa Del Tejadillo",
    "Hotel Casa Cano",
    "Casa Zahri Boutique Hostel",
    "Casa Ebano 967",
    "Hotel Boutique Casa del Puerto",
    "Casa Hotel Terraza",
    "Hotel Boutique Casa Ferrand",
    "Hotel Boutique Casa del Angel",
    "Hotel Casa Abril I",
    "Hotel Casa Abril II",
    "Hotel Boutique Casa Valencia",
    "Hotel Boutique Casa del Virrey",
    "Hotel Boutique Casa Navarro",
]

# Heuristics for hotel tier
LUJO_KEYWORDS = (
    "Sofitel", "Hyatt", "Hilton", "Charleston", "InterContinental",
    "Movich", "Conrad", "Ritz", "Four Seasons", "Casa San Agustin",
    "Sophia Hotel", "Bastion Luxury", "Nacar", "Casa Lola Luxury",
    "Hotel Las Islas", "Sofitel Barú", "Casa Pestagua", "Armeria Real",
    "Karmairi", "Bovedas", "Bóvedas",
)
PREMIUM_KEYWORDS = (
    "Boutique", "Selina", "Casa Pizarro", "Casa Bustamante", "Casa Jagua",
    "Allure", "Karisma", "Casa Quero", "Casa Diluca", "Casa Carolina",
    "Amarla", "Casa Claver", "Casa BuGo", "Casa Don Sancho", "Casa de Alba",
    "Alfiz", "Anandá", "Voilá", "Voila", "Casa Don Luis", "Cinco Quintas",
    "Casa Canabal", "Casa Capellán", "Casa Capellan", "OSH Hotel", "Makani Luxury",
    "Ermita", "Casa Castel", "Casa Tere", "Hotel Or Cartagena",
)


def _hotel_tier(name: str) -> str:
    """Heuristic-based tier assignment for hotels."""
    n = name.lower()
    for kw in LUJO_KEYWORDS:
        if kw.lower() in n:
            return "lujo"
    for kw in PREMIUM_KEYWORDS:
        if kw.lower() in n:
            return "premium"
    return "popular"


HOTEL_BANNERS = {
    "popular": "https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=800&h=600&fit=crop",
    "premium": "https://images.unsplash.com/photo-1582719508461-905c673771fd?w=800&h=600&fit=crop",
    "lujo":    "https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=800&h=600&fit=crop",
}


# ─────────────────────────────────────────────────────────────────────
# Helpers (shared with restaurants_extra.py)
# ─────────────────────────────────────────────────────────────────────
def normalize_name(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ASCII", "ignore").decode().lower()
    out = "".join(c if c.isalnum() or c.isspace() else " " for c in s)
    return " ".join(out.split())


def slug_handle(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ASCII", "ignore").decode().lower()
    out = "".join(c for c in s if c.isalnum())
    return out[:30] or "partner"


# ─────────────────────────────────────────────────────────────────────
# Builder
# ─────────────────────────────────────────────────────────────────────
def build_wellness_partners() -> List[Dict[str, Any]]:
    partners = []
    # ── WELLNESS ────────────────────────────────────────────────────
    for idx, (name, sub) in enumerate(WELLNESS_RAW):
        nk = normalize_name(name)
        slug = slug_handle(name)
        sub_label = WELLNESS_LABELS.get(sub, sub.capitalize())
        partners.append({
            "partner_id": f"ptr_W{idx:03d}",
            "_normalized_name": nk,
            "name": name.title().replace("´", "'"),
            "category": "wellness",
            "subcategory": sub,
            "tier": "popular",
            "description": f"{sub_label} en Cartagena. Directorio oficial Amo Cartagena.",
            "image_url": WELLNESS_BANNERS.get(sub, WELLNESS_BANNERS["spa"]),
            "location": {"lat": 10.4220, "lng": -75.5482},
            "address": "Cartagena de Indias, Colombia",
            "booking_link": "",
            "instagram": f"{slug}cartagena",
            "price_range": "$$",
            "cuisine": sub_label,
            "rating": 4.3,
            "reviews": 0,
            "experience": f"{sub_label} · Cartagena",
            "is_certified": False,
            "directory_only": True,
            "order": 6000 + idx,
        })

    # ── BEACH CLUB ──────────────────────────────────────────────────
    for idx, name in enumerate(BEACH_CLUB_RAW):
        nk = normalize_name(name)
        slug = slug_handle(name)
        partners.append({
            "partner_id": f"ptr_B{idx:03d}",
            "_normalized_name": nk,
            "name": name.title().replace("´", "'"),
            "category": "beach_club",
            "subcategory": "beach_club",
            "tier": "popular",
            "description": "Beach club en Cartagena. Directorio oficial Amo Cartagena.",
            "image_url": BEACH_BANNER,
            "location": {"lat": 10.4015, "lng": -75.5510},  # Bocagrande / Barú approx
            "address": "Cartagena de Indias, Colombia",
            "booking_link": "",
            "instagram": f"{slug}cartagena",
            "price_range": "$$",
            "cuisine": "Beach Club",
            "rating": 4.3,
            "reviews": 0,
            "experience": "Playa · Cócteles · Música",
            "is_certified": False,
            "directory_only": True,
            "order": 7000 + idx,
        })

    # ── HOTEL ───────────────────────────────────────────────────────
    for idx, name in enumerate(HOTEL_RAW):
        nk = normalize_name(name)
        slug = slug_handle(name)
        tier = _hotel_tier(name)
        partners.append({
            "partner_id": f"ptr_H{idx:03d}",
            "_normalized_name": nk,
            "name": name,
            "category": "hotel",
            "subcategory": tier,  # popular / premium / lujo
            "tier": tier,
            "description": f"Hotel en Cartagena ({tier.title()}). Directorio oficial Amo Cartagena.",
            "image_url": HOTEL_BANNERS[tier],
            "location": {"lat": 10.4220, "lng": -75.5482},
            "address": "Cartagena de Indias, Colombia",
            "booking_link": "",
            "instagram": f"{slug}cartagena",
            "price_range": "$$$" if tier == "premium" else ("$$$$" if tier == "lujo" else "$$"),
            "cuisine": "Hotel",
            "rating": 4.3 if tier == "popular" else (4.5 if tier == "premium" else 4.7),
            "reviews": 0,
            "experience": f"Alojamiento · {tier.title()}",
            "is_certified": False,
            "directory_only": True,
            "order": 8000 + idx,
        })

    # Dedup by normalized name (keep first occurrence)
    seen = set()
    out = []
    for p in partners:
        nk = p["_normalized_name"]
        if nk in seen:
            continue
        seen.add(nk)
        out.append(p)
    return out
