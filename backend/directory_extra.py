"""Directory extra — Wellness, Beach Club, Hotel from BASE_DE_DATO_APP.xlsx."""
from typing import List, Dict, Any
from restaurants_extra import normalize_name, slug_handle

# (name, category, subcategory_hint)
WELLNESS_RAW = [
    "INVICTUS BARBER & NAILS","STUDIO WINDSPOT","VIVE YOGA","SPA KALAMARI",
    "MORGAN´S BARBER","SERENA NAILS SPA","PILATE PRO WORKS","CARTAGENA SURF",
    "CASA CAROLINA","DIEGO MOYA BOCAGRANDE","MORGAN´S BARBER BOCAGRANDE",
    "ANGEL´S PERFECT SPA","PILATE POLI","SURFING OHANA","OMM WELLNESS",
    "DIEGO MOYA CENTRO","BARBA SANTA NAILS","OASI GETSEMANI","MUEVETE A TU RITMO",
    "SOCIAL PADEL CLUB MANGA","MANDALA YOGA","MG SPA BOCAGRANDE",
    "PELUQUERIA ANGIE JIMENEZ","NAILS ART GRICELYS","PADEL CLUB BOCAGRANDE",
    "WELNESS SPA MOVIL","FIGARO BARBER SHOP","BLESSING NAILS SPA","EASY PADEL",
    "AORAL SPA","CARLOS TORRES","DIEGO MOYA","KARIB KAYAK CENTER","MONICA CRUZ CENTRO",
    "JERMAINE","BARBERS SUPER WOW","PADDLE BOARD","MONICA CRUZ MANGA","ISABEL ROJAS",
    "JESSICA RAMIREZ","CARTACHO PADDLE","MONICA CRUZ BOCAGRANDE","DORIAN ZAMBRANO",
    "HOUSE OF BAUTY","PADDLE GLOBAL","DRA. MILENA OSORIO","FELIPE WALKER HAIR SALON",
    "ISABEL ROJAS SPA","LUXURY CONCEPT DM BAUTY SALON","FRANCYS NAILS","SUPER WOW",
    "L'PELUQUERIA","URBAN PLAZA","JULIETH HARMON SPA","AHAVA BEAUTY & WELNESS SPA",
    "LILI SPA MASSAGE",
]
BEACH_RAW = [
    "BETHEL","BELLINI","MANTAS BEACH CLUB","FÉNIX BEACH","PA'UE CLUB","KABANNA",
    "BELA BEACH CLUB","THE PINK MANGO","MAGATA","CAPRI BEACH CLUB","DHARMA","BORABORA",
    "PLAYA CORAL","PAO PAO","BENDITA BEACH","MIRAMAR","PALMARITO BEACH","ATOLON",
    "VIISTA MARE","MAKANI","MARGARITA´S BEACH CLUB","ROCHA BEACH CLUB","AMALIFE BEACH CLUB",
    "ANAHO","NENA BEACH","ISLA AMORES","KARIBANA BEACH CLUB","BOMBA BEACH CLUB","MARAZAO",
    "WALA BEACH","WINDSPOT","KALA BEACH","MARINE BEACH","ETEKA","ISLA DEL PIRATA","NAMASTÉ",
    "BLUE APPLE","TAMARINDO BEACH HOUSE","IBBIZA ISLAND BEACH CLUB","FREEDOM BEACH CLUB",
    "MORENA BEACH CLUB",
]
HOTEL_RAW = [
    "Sofitel Legend Santa Clara Cartagena","OSH Hotel Cartagena","Hotel Casa Tere",
    "Charleston Santa Teresa Cartagena","Makani Luxury Wanderlust","Hotel Boutique Casa Santamarina",
    "Casa Pestagua","Ermita Cartagena","Tribute Portfolio Hotel","Hotel Casa Citella",
    "Hotel Movich Cartagena De Indias","Hotel Boutique Bóvedas de Santa Clara By Accor",
    "Hotel Boutique Casa Carolina","Hotel Casa San Agustin","Casa Jagua Hotel Boutique",
    "Hotel Casa Castel","Casa Bustamante Hotel Boutique","Hotel Boutique Casa Marquez",
    "Casa Claver Loft Boutique Hotel","Voilá Centro Histórico","Hotel Casa La Mantilla",
    "Hotel Casa La Factoria by Faranda Boutique","Voilá Signature","Casa Isabel Hotel Boutique",
    "Hotel Casa Evelina","Hotel Bantu By Faranda Boutique","Casa La Española",
    "Hotel Boutique Casa Blanquita","Casa de Alba Hotel Boutique","Casa Franco",
    "Hotel Casa Colonial Beach and Spa","Casa Diluca Hotel Boutique","Casa La Merced by Mustique",
    "Casa Amanzi Hotel Cartagena","Sophia Hotel","Casa Gastelbondo Hotel Boutique","Casa Mangle",
    "La Passion by Masaya Collection","Casa Quero Luxury Villa Hotel","Hotel Boutique Casa Rosada",
    "Hotel Santa Catalina Cartagena","Casa Cordoba Baru","Casa Roman Cartagena","Alfiz Hotel",
    "Casa Noel Cartagena","Casa Blue Cartagena","Cinco Quintas Hotel Boutique By SOHO",
    "Casa Gloria Getsemaní","Casa Verde Hotel Boutique","Sol De Alba Hotel Boutique",
    "Casa Jaguar Getsemaní Hotel Boutique","Casa Santa Ana Hotel","NH Cartagena Urban",
    "Royal Casa Portal de Getsemaní","Casa Palma Cartagena","Casa Lola Luxury Collection",
    "Casa Santiago Boutique","Casa Del Tejadillo","Anandá Hotel Boutique",
    "Casa Venecia Hotel Boutique","Hotel Casa Cano","Casa Don Sancho","Casa Movida Hostel Boutique",
    "Casa Zahri Boutique Hostel","Casa del Coliseo","Casa Pedro Romero","Casa Ebano 967",
    "Casa del Arzobispado","Casa Canabal by Faranda Hotel Boutique","Casa del Puerto",
    "Hotel Casa Don Luis","Armeria Real Luxury Hotel & Spa","San Lazaro Art Hotel",
    "Hotel Boutique Casa Ferrand","Leones de Alba Hotel Boutique",
    "Allure Chocolat by Karisma Hotel Boutique","Casa del Angel","Casa BuGo",
    "Allure Canela by Karisma","Hotel Casa Abril","I Amarla Boutique Hotel","Hotel Monterrey Cartagena",
    "Hotel Stil Cartagena","Casa Córdoba Estrella","Hotel Boutique Casa Valencia",
    "Casa Córdoba Román","Hotel Dorado Plaza Centro Histórico","Hotel Boutique Casa del Virrey",
    "Hotel Aguamarina","Hotel Luna Nueva","Hotel Boutique Casa Navarro","Hotel Casa Real Cartagena",
    "Hotel Boutique High Park","Casa India Catalina","Blue Apple Beach House","Hotel Isla del Encanto",
    "Hotel Casona del Porvenir","Sofitel Barú Calablanca Beach Resort","Delirio Hotel Aura",
    "Hotel Barú","Casa Mantilla 3-37","Hotel Las Islas","Nacar Hotel Cartagena Curio Collection by Hilton",
    "Decameron Barú","Bastion Luxury Hotel","Corales de Indias Hotel Boutique",
    "Casa Macia Townhouse Boutique Hotel","Casa del Reloj","Selina Cartagena","Sonesta Hotel Cartagena",
    "Radisson Ocean Pavillion Hotel","Hotel Casa Pizarro","Hotel Capellan de Getsemani",
    "Las Américas Casa de Playa","Casa Relax Hotel","Meliá Cartagena Karmairi","Karmairi Cartagena Spa",
    "GHL Arsenal Hotel","Hotel Summer Ocean Front","Hotel Cartagena Royal Inn","Hotel Vistamarina",
    "Hotel Don Pedro de Heredia","Hotel Cartagena Plaza","Casa del Curato",
    "Luxury Hyatt Regency Cartagena","Casa Esther Cartagena",
    "Estelar Cartagena de Indias Hotel & Centro de Convenciones",
    "InterContinental Cartagena de Indias Hotel","Hotel Capilla del Mar","Casa Fernández Madrid",
    "Hotel Dann Cartagena","Casa Arte Hotel Boutique","Holiday Inn Express Cartagena Bocagrande",
    "Casa del Cabrero","B&G Hotel Almirante Cartagena Colombia","Hotel Regatta Cartagena",
    "Oz Hotel Cartagena","Oz Hotel Luxury","Be Live Experience Cartagena","Dubai Hotel Boutique",
    "Hotel Bocagrande","Hotel Blue Concept Cartagena","Hotel Atlantic Lux","Hotel Dorado Plaza Bocagrande",
    "Hotel Costa del Sol Cartagena","Hotel San Pietro Boutique","Hotel Playa Club",
    "Hotel Bocagrande Suite By GEH Suites","Hotel Or Cartagena","Hotel Suite Bocagrande",
    "Hampton By Hilton Cartagena","Hotel Marina Suites","Hotel Poblado Plaza Cartagena",
    "Cartagena Millennium Hotel","Hotel Coral Reef Cartagena","Hilton Cartagena Hotel",
    "Hotel Caribe by Faranda Grand a member of Radisson Individuals","Hotel Caribbean Cartagena",
    "Hotel Golden Cartagena","Hotel Veleros Cartagena","Hotel Summer Frente al Mar",
    "Hotel Oceania Cartagena","Holiday Inn Cartagena Morros","Morros Eco Hotel",
    "Morros City Suites","Morros Ultra Cartagena","Hotel Ibis Cartagena Marbella",
    "Hotel Aixo Suites By GEH Suites","Hotel Avenida San Martin","Hotel Velamar Boutique",
    "Hotel Quadrifolio","Casa Pombo Hotel Boutique","Hotel Portal de San Diego","Hotel 3 Banderas",
    "Casa La Fe",
]

BEACH_BANNER = "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&h=600&fit=crop"
HOTEL_BANNER = "https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=800&h=600&fit=crop"
WELL_BANNER  = "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=800&h=600&fit=crop"

def _wellness_sub(name: str) -> str:
    u = name.upper()
    if "PADEL" in u or "PADDLE" in u or "SURF" in u or "KAYAK" in u:
        return "sport"
    if "YOGA" in u or "MUEVETE" in u or "RITMO" in u or "PILATE" in u:
        return "yoga"
    if "NAILS" in u or "UÑAS" in u:
        return "nails"
    if "BARBER" in u or "PELUQ" in u or "HAIR" in u:
        return "hair"
    if "BEAUTY" in u or "BAUTY" in u or "MAKEUP" in u:
        return "beauty"
    if "SPA" in u or "MASSAGE" in u or "WELLNESS" in u or "WELNESS" in u:
        return "spa"
    if "DRA." in u:
        return "recovery"
    return "spa"


def _hotel_tier(name: str) -> str:
    u = name.upper()
    luxury = ["SOFITEL","HYATT","HILTON","INTERCONTINENTAL","CHARLESTON","CASA PESTAGUA",
              "CASA SAN AGUSTIN","BASTION","NACAR","SANTA CLARA","LAS ISLAS","BLUE APPLE","HOTEL LAS ISLAS"]
    premium = ["MOVICH","BOUTIQUE","ALLURE","SONESTA","RADISSON","MELIA","ESTELAR","CARIBE",
               "HOLIDAY INN","HAMPTON","NH ","DECAMERON","ARMERIA","DELIRIO","ERMITA","DORADO PLAZA"]
    if any(k in u for k in luxury):
        return "lujo"
    if any(k in u for k in premium):
        return "premium"
    return "popular"


def build_directory_extras() -> List[Dict[str, Any]]:
    out = []
    seen = set()
    idx = 0

    def add(name, category, sub, banner, tier="popular", price="$$"):
        nonlocal idx
        nk = normalize_name(name)
        if not nk or nk in seen:
            return
        seen.add(nk)
        slug = slug_handle(name)
        out.append({
            "partner_id": f"ptr_Y{idx:03d}",
            "_normalized_name": nk,
            "name": name.replace("´", "'"),
            "category": category,
            "subcategory": sub,
            "tier": tier,
            "description": f"{category.replace('_',' ').title()} en Cartagena. Directorio oficial Amo Cartagena.",
            "image_url": banner,
            "location": {"lat": 10.4220, "lng": -75.5482},
            "address": "Cartagena de Indias, Colombia",
            "booking_link": "",
            "instagram": f"{slug}cartagena",
            "price_range": price,
            "cuisine": category.replace("_", " ").title(),
            "rating": 4.3,
            "reviews": 0,
            "experience": f"{category.replace('_',' ').title()} · Cartagena",
            "is_certified": False,
            "directory_only": True,
            "order": 6000 + idx,
        })
        idx += 1

    for n in WELLNESS_RAW:
        add(n, "wellness", _wellness_sub(n), WELL_BANNER, "popular", "$$")
    for n in BEACH_RAW:
        add(n, "beach_club", "general", BEACH_BANNER, "popular", "$$$")
    for n in HOTEL_RAW:
        t = _hotel_tier(n)
        price = "$$$$" if t == "lujo" else ("$$$" if t == "premium" else "$$")
        add(n, "hotel", t, HOTEL_BANNER, t, price)
    return out
