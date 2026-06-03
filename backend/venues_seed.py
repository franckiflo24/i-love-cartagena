"""
Venues seed — Cartagena bars, cafes, clubs, spas & wellness.
Source: rewired-os enriched_businesses.csv + cartagena_tier_a_kill_list.csv
Curated for premium city app — no chains, no sketchy, no closed venues.
"""

from typing import List, Dict, Any

# Unsplash fallback per category
DEFAULT_IMG = {
    "bar":     "https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=800&h=600&fit=crop",
    "cafe":    "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800&h=600&fit=crop",
    "club":    "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800&h=600&fit=crop",
    "spa":     "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=800&h=600&fit=crop",
    "hotel":   "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&h=600&fit=crop",
    "wellness":"https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=800&h=600&fit=crop",
    "lounge":  "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&h=600&fit=crop",
    "rooftop": "https://images.unsplash.com/photo-1506929562872-bb421503ef21?w=800&h=600&fit=crop",
    "beach_club":"https://images.unsplash.com/photo-1540541338287-41700207dee6?w=800&h=600&fit=crop",
}

CTG = (10.4220, -75.5482)


def _v(idx: int, name: str, category: str, subcategory: str, *,
       description: str = "",
       address: str = "Cartagena de Indias, Colombia",
       phone: str = "",
       website: str = "",
       instagram: str = "",
       tier: str = "popular",
       price_range: str = "$$",
       rating: float = 4.5,
       reviews: int = 0,
       image_url: str = "",
       experience: str = "") -> Dict[str, Any]:
    return {
        "partner_id": f"ptr_V{idx:03d}",
        "name": name,
        "category": category,
        "subcategory": subcategory,
        "tier": tier,
        "description": description or f"{subcategory.replace('_',' ').title()} en Cartagena.",
        "image_url": image_url or DEFAULT_IMG.get(subcategory, DEFAULT_IMG.get(category, DEFAULT_IMG["bar"])),
        "location": {"lat": CTG[0], "lng": CTG[1]},
        "address": address,
        "booking_link": website,
        "phone": phone,
        "instagram": instagram,
        "price_range": price_range,
        "rating": rating,
        "reviews": reviews,
        "experience": experience or f"{category.title()} · Cartagena",
        "is_certified": True,
    }


# ─────────────────────────────────────────────────────────────────────
# BARS & COCKTAIL BARS
# ─────────────────────────────────────────────────────────────────────
VENUES: List[Dict[str, Any]] = [
    _v(1, "Alquimico", "bar", "cocktail_bar", tier="elite", price_range="$$$",
       description="World-renowned cocktail bar in the Walled City. Three floors of handcrafted drinks, rooftop terrace, and some of the best mixology in Latin America. Ranked among World's 50 Best Bars.",
       address="Cl. del Colegio #34-24, El Centro, Cartagena",
       instagram="alquimico", website="https://alquimico.com",
       rating=4.8, reviews=3200,
       image_url="https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=800&h=600&fit=crop",
       experience="Cócteles de autor · Rooftop · Mixología"),

    _v(2, "El Barón", "bar", "cocktail_bar", tier="premium", price_range="$$$",
       description="Sophisticated cafe-bar on Plaza San Pedro Claver. Artisanal cocktails, premium wines, and European-style ambiance in the heart of the Walled City.",
       address="Cl. San Pedro Claver #31-7, El Centro, Cartagena",
       instagram="elbaroncartagena",
       rating=4.7, reviews=2100,
       image_url="https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&h=600&fit=crop",
       experience="Cócteles · Vinos · Plaza San Pedro"),

    _v(3, "51 Sky Bar", "bar", "rooftop", tier="premium", price_range="$$$",
       description="Rooftop bar with panoramic views of the Cartagena skyline. Sunset cocktails, DJ sessions, and a premium lounge atmosphere above the city.",
       address="Cra. 1 #11-116, Bocagrande, Cartagena",
       rating=4.5, reviews=680,
       image_url="https://images.unsplash.com/photo-1506929562872-bb421503ef21?w=800&h=600&fit=crop",
       experience="Rooftop · Sunset · Cócteles"),

    _v(4, "7 Cielos", "bar", "rooftop", tier="popular", price_range="$$",
       description="Elevated bar with Caribbean vibes and craft cocktails. Stunning sunset views over Bocagrande's skyline.",
       address="Cra. 3 #10-59, Piso 7, Bocagrande, Cartagena",
       rating=4.4, reviews=420,
       experience="Rooftop · Vista al mar · Cocktails"),

    _v(5, "Morena Lounge Beach", "bar", "lounge", tier="premium", price_range="$$$",
       description="Beachfront lounge with live music, sunset sessions, and Caribbean cuisine. The perfect blend of sand, sea, and cocktails.",
       address="Cra. 1 #9-6, Bocagrande, Cartagena",
       instagram="morenaloungebeach",
       rating=4.5, reviews=540,
       image_url="https://images.unsplash.com/photo-1540541338287-41700207dee6?w=800&h=600&fit=crop",
       experience="Beach · Live music · Sunset"),

    _v(6, "Buena Vida Marisquería", "bar", "cocktail_bar", tier="popular", price_range="$$",
       description="Seafood-forward cocktail bar in the historic center. Fresh ceviches, creative cocktails, and a lively atmosphere.",
       address="Cl. del Porvenir, Centro Histórico, Cartagena",
       rating=4.4, reviews=380,
       experience="Mariscos · Cócteles · Centro Histórico"),

    _v(7, "Restaurante-Bar San Nicolás", "bar", "cocktail_bar", tier="popular", price_range="$$",
       description="Charming bar in the heart of Getsemaní. Live music, local cocktails, and authentic neighborhood energy.",
       address="Cl. 25 #8b-162, Getsemaní, Cartagena",
       rating=4.3, reviews=290,
       experience="Getsemaní · Live music · Local vibes"),

    _v(8, "Café Havana", "bar", "lounge", tier="elite", price_range="$$$",
       description="Legendary salsa bar in Getsemaní. Live Cuban bands every night, vintage Havana atmosphere, and the most iconic nightlife spot in Cartagena. A must-visit institution.",
       address="Getsemaní, Cartagena",
       instagram="cafehavanacartagena",
       rating=4.7, reviews=4500,
       image_url="https://images.unsplash.com/photo-1504609813442-a8924e83f76e?w=800&h=600&fit=crop",
       experience="Salsa en vivo · Cuba vibes · Getsemaní"),

    _v(9, "Ely Café Bocagrande", "bar", "lounge", tier="popular", price_range="$$",
       description="Relaxed café-bar in Bocagrande with craft coffees by day and cocktails by night. Trendy local hangout.",
       address="Cl. 7 #2-50, Bocagrande, Cartagena",
       rating=4.3, reviews=210,
       experience="Café · Cócteles · Bocagrande"),

    # ─────────────────────────────────────────────────────────────────────
    # CAFÉS
    # ─────────────────────────────────────────────────────────────────────
    _v(10, "Café San Alberto", "cafe", "coffee", tier="premium", price_range="$$",
       description="Colombia's premier single-origin coffee experience. Direct from Buenavista, Quindío, served in a stunning colonial setting on Plaza Santo Domingo.",
       address="Cra. 3 #35-18, Plaza Santo Domingo, Cartagena",
       instagram="cafesanalberto", website="https://cafesanalberto.com",
       rating=4.8, reviews=2800,
       image_url="https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=800&h=600&fit=crop",
       experience="Café de origen · Plaza Santo Domingo"),

    _v(11, "Libertario Coffee Roasters", "cafe", "coffee", tier="premium", price_range="$$",
       description="Specialty coffee roasters in Getsemaní. Third-wave brewing, single-origin beans, and a modern space with industrial charm.",
       address="Cra. 10 #30-14, Getsemaní, Cartagena",
       instagram="libertariocoffee",
       rating=4.7, reviews=1200,
       experience="Specialty coffee · Getsemaní"),

    _v(12, "Ábaco Libros y Café", "cafe", "coffee", tier="premium", price_range="$$",
       description="Bookstore-café in a colonial mansion. Browse art books and rare editions while sipping excellent coffee. A cultural landmark of the Walled City.",
       address="Cl. 36 #3-86, El Centro, Cartagena",
       instagram="abacolibrosycafe",
       rating=4.7, reviews=1800,
       image_url="https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=800&h=600&fit=crop",
       experience="Libros · Café · Arte"),

    _v(13, "Mila Pastelería", "cafe", "bakery", tier="popular", price_range="$$",
       description="Artisan pastry shop in the historic center. French-inspired cakes, croissants, and brunch in a beautifully restored colonial space.",
       address="Cl. de la Iglesia #35-76, Centro Histórico, Cartagena",
       instagram="milapasteleria",
       rating=4.6, reviews=920,
       experience="Pastelería · Brunch · Colonial"),

    _v(14, "Casa Bohême", "cafe", "brunch", tier="popular", price_range="$$",
       description="Bohemian-chic café in the Walled City. All-day brunch, healthy bowls, and creative juices in a charming courtyard setting.",
       address="Cl. 35 #3-30, El Centro, Cartagena",
       instagram="casaboheme",
       rating=4.5, reviews=640,
       experience="Brunch · Healthy · Bohemio"),

    _v(15, "LA BRIOCHE", "cafe", "bakery", tier="popular", price_range="$$",
       description="French bakery in the heart of the historic center. Fresh croissants, baguettes, and artisan bread baked daily.",
       address="Cl. 36 #6-106, El Centro, Cartagena",
       rating=4.5, reviews=580,
       experience="Panadería francesa · Centro Histórico"),

    _v(16, "Manna Breakfast & Lunch", "cafe", "brunch", tier="popular", price_range="$$",
       description="Popular brunch spot in Getsemaní. Organic ingredients, açaí bowls, fresh juices, and a relaxed tropical atmosphere.",
       address="Cl. de San Juan #25-118, Getsemaní, Cartagena",
       instagram="mannacartagena",
       rating=4.6, reviews=750,
       experience="Brunch · Orgánico · Getsemaní"),

    _v(17, "Café de la Mañana", "cafe", "coffee", tier="popular", price_range="$",
       description="Local morning café with authentic Colombian coffee, arepas, and pastries. The real Cartagena breakfast experience.",
       address="Calle Estanco del Aguardiente #05-80, El Centro, Cartagena",
       rating=4.3, reviews=320,
       experience="Café colombiano · Desayuno local"),

    _v(18, "Colibri Café", "cafe", "coffee", tier="popular", price_range="$$",
       description="Cozy neighborhood café in Bocagrande with specialty coffee, homemade pastries, and a welcoming ambiance.",
       address="Cra. 3 #9-97, Bocagrande, Cartagena",
       rating=4.4, reviews=280,
       experience="Café · Bocagrande"),

    # ─────────────────────────────────────────────────────────────────────
    # CLUBS & NIGHTLIFE
    # ─────────────────────────────────────────────────────────────────────
    _v(20, "Seven 7 Times", "club", "nightclub", tier="premium", price_range="$$$",
       description="Cartagena's premier mega-club. Four distinct environments across multiple floors — electronic, crossover, Latin, and VIP. International DJs and immersive production.",
       address="Calle Media Luna #9-79, Getsemaní, Cartagena",
       phone="+57 312 256 3705",
       instagram="seven7timescartagena", website="https://seven7times.com",
       rating=4.4, reviews=1600,
       image_url="https://images.unsplash.com/photo-1571266028243-3716f02d2d2e?w=800&h=600&fit=crop",
       experience="Nightclub · 4 ambientes · VIP"),

    _v(21, "Delirium Social Club", "club", "nightclub", tier="premium", price_range="$$$",
       description="Upscale gastrobar and nightclub. Premium bottle service (Moët, Hennessy, Patrón), electronic music, and a sophisticated late-night crowd.",
       address="Dg. 21 #48-72, El Bosque, Cartagena",
       phone="+57 318 535 1287",
       instagram="deliriumsocialclub", website="https://deliriumsocialclub.com",
       rating=4.7, reviews=890,
       experience="Bottle service · Premium · Nightclub"),

    _v(22, "EIVISSA Cartagena", "club", "nightclub", tier="premium", price_range="$$$",
       description="Ibiza-inspired rooftop club in the Walled City. Open-air dancing, international DJs, and a Mediterranean party atmosphere with Caribbean flair.",
       address="Calle Portocarrero #7-33, Piso 4, El Centro, Cartagena",
       instagram="eivissacartagena", website="https://eivissa-cartagena.cluvi.co",
       rating=4.3, reviews=520,
       experience="Rooftop · Ibiza vibes · Centro"),

    _v(23, "La Jugada Club House", "club", "lounge", tier="popular", price_range="$$",
       description="Multi-level gastrobar and club in the Walled City. Three floors plus rooftop with VIP room. Same group as La Movida.",
       address="Cra. 6 #34-25, Centro Histórico, Cartagena",
       phone="+57 318 139 9919",
       instagram="lajugadaclubhouse",
       rating=4.3, reviews=440,
       experience="Gastrobar · Rooftop · VIP"),

    _v(24, "El Pasquín de Joaco", "club", "live_music", tier="popular", price_range="$$",
       description="Live music venue and cultural hub. Local bands, salsa nights, and an authentic Cartagena nightlife experience away from the tourist circuit.",
       address="Calle Portocarrero #34-09, Cartagena",
       phone="+57 317 401 1798",
       instagram="elpasquindejoaco", website="https://elpasquindejoaco.com",
       rating=4.4, reviews=380,
       experience="Música en vivo · Salsa · Cultural"),

    _v(25, "Casa Palenque", "club", "live_music", tier="popular", price_range="$$",
       description="Afro-Colombian cultural club celebrating Palenque heritage. Live champeta, drums, and dance in an electric atmosphere.",
       address="Cl. 29 #10B-08, Cartagena",
       phone="+57 318 784 1589",
       instagram="casapalenquecartagena",
       rating=4.5, reviews=620,
       image_url="https://images.unsplash.com/photo-1504609813442-a8924e83f76e?w=800&h=600&fit=crop",
       experience="Champeta · Cultura afro · Live music"),

    _v(26, "RD Disco Club", "club", "nightclub", tier="popular", price_range="$$",
       description="High-energy disco club in Getsemaní. Crossover music, themed nights, and a vibrant local crowd.",
       address="Calle de la Media Luna, Getsemaní, Cartagena",
       phone="+57 300 500 9172",
       rating=4.9, reviews=340,
       experience="Disco · Crossover · Getsemaní"),

    _v(27, "The Clock Pub", "club", "lounge", tier="popular", price_range="$$",
       description="British-style pub on Plaza de los Coches. Craft beers, live music some nights, and a relaxed international crowd.",
       address="Cl. 34 #7-33, Plaza de los Coches, Cartagena",
       phone="+57 305 444 6051",
       website="http://clockpub.com",
       rating=4.5, reviews=410,
       experience="Pub · Cervezas · Plaza de los Coches"),

    _v(28, "Euphoria Cartagena", "club", "nightclub", tier="popular", price_range="$$",
       description="Party venue in the historic center. Energetic crossover music, affordable drinks, and a young local vibe.",
       address="Centro Histórico, Cartagena",
       phone="+57 316 925 6057",
       rating=4.7, reviews=290,
       experience="Fiesta · Crossover · Centro"),

    _v(29, "Pose Club", "club", "nightclub", tier="popular", price_range="$$",
       description="Trendy Getsemaní nightclub with a fashion-forward crowd. Electronic and crossover music in a stylish setting.",
       address="Cra. 9 #31-46, Getsemaní, Cartagena",
       rating=4.7, reviews=260,
       experience="Fashion · Electronic · Getsemaní"),

    _v(30, "Live Lula Pub", "club", "live_music", tier="popular", price_range="$$",
       description="Intimate live music pub in Getsemaní. Rock, blues, and acoustic sets in a cozy underground space.",
       address="Cl. 24 #8b-115, Getsemaní, Cartagena",
       phone="+57 314 839 1872",
       rating=4.7, reviews=310,
       experience="Live music · Rock · Getsemaní"),

    _v(31, "Taboo Disco Club", "club", "nightclub", tier="popular", price_range="$$",
       description="Inclusive crossover club in Getsemaní. LGBTQ+ friendly with a diverse crowd, great music, and a welcoming atmosphere.",
       address="Cl. 24 #10-55, Getsemaní, Cartagena",
       instagram="taboodiscoclub", website="https://taboodiscoclub.com",
       rating=4.4, reviews=480,
       experience="Crossover · Inclusivo · Getsemaní"),

    _v(32, "Prestige Club", "club", "nightclub", tier="premium", price_range="$$$",
       description="VIP nightclub experience. Bottle service, exclusive atmosphere, and premium production for Cartagena's nightlife elite.",
       address="San Antonio, Cartagena",
       phone="+57 300 500 9172",
       instagram="prestigeclubctg",
       rating=4.4, reviews=220,
       experience="VIP · Bottle service · Exclusivo"),

    # ─────────────────────────────────────────────────────────────────────
    # SPA & WELLNESS
    # ─────────────────────────────────────────────────────────────────────
    _v(40, "Bastión Luxury Hotel & Spa", "spa", "wellness_center", tier="elite", price_range="$$$$",
       description="Five-star spa in a restored colonial fortress. World-class treatments, thermal circuit, and luxury wellness in the Walled City's most exclusive hotel.",
       address="Calle del Sargento Mayor No. 6-87, Centro Histórico, Cartagena",
       instagram="bastionluxuryhotel",
       rating=4.8, reviews=1400,
       image_url="https://images.unsplash.com/photo-1600334129128-685c5582fd35?w=800&h=600&fit=crop",
       experience="Spa de lujo · Hotel boutique · Colonial"),

    _v(41, "Hom Spa Cartagena", "spa", "massage", tier="popular", price_range="$$",
       description="Relaxation spa in the Walled City. Professional massages, facials, and body treatments in a serene colonial setting.",
       address="Calle de la Cruz #9-110, Piso 2, Centro, Cartagena",
       rating=4.6, reviews=480,
       experience="Masajes · Faciales · Centro Histórico"),

    _v(42, "URAKU Spa Massages", "spa", "massage", tier="premium", price_range="$$$",
       description="Premium massage studio inside the Walled City. Deep tissue, aromatherapy, and couples treatments in an intimate setting near Plaza de la Bomba.",
       address="Cl. de la Bomba #36-55, Centro Histórico, Cartagena",
       instagram="urakuspa",
       rating=4.7, reviews=560,
       experience="Masajes premium · Parejas · Aromaterapia"),

    _v(43, "Relax Spa Cartagena", "spa", "massage", tier="popular", price_range="$$",
       description="Affordable wellness studio offering a range of massage therapies and relaxation treatments in the old city.",
       address="Cl. de la Cruz #9-96, Centro Histórico, Cartagena",
       rating=4.4, reviews=320,
       experience="Masajes · Relajación · Accesible"),

    _v(44, "Oasi Spa Getsemaní", "spa", "wellness_center", tier="premium", price_range="$$$",
       description="Boutique wellness center in Getsemaní. Thai massage, reflexology, and holistic treatments in a tranquil garden oasis.",
       address="Cra. 10 #29-84, Getsemaní, Cartagena",
       instagram="oasispacartagena",
       rating=4.6, reviews=440,
       experience="Wellness · Thai massage · Getsemaní"),

    _v(45, "HOSH Wellness Center", "spa", "wellness_center", tier="premium", price_range="$$$",
       description="Full-service wellness center in Manga. Yoga, meditation, spa treatments, and holistic health programs with ocean views.",
       address="Cra. 22 #25-150, Manga, Cartagena",
       instagram="hoshwellness",
       rating=4.5, reviews=280,
       experience="Yoga · Meditación · Wellness integral"),

    _v(46, "Mucura Hotel & Spa", "spa", "wellness_center", tier="premium", price_range="$$$",
       description="Beachside hotel spa in Bocagrande. Caribbean-inspired treatments, pool access, and a full relaxation circuit steps from the sea.",
       address="Cra. 3 #65-104, Bocagrande, Cartagena",
       rating=4.4, reviews=360,
       experience="Hotel spa · Playa · Bocagrande"),

    _v(47, "Voila Getsemaní", "spa", "wellness_center", tier="popular", price_range="$$",
       description="Boutique hotel with in-house spa in the creative heart of Getsemaní. Relaxation massages and beauty treatments for guests and walk-ins.",
       address="Cl. 30 #9, Getsemaní, Cartagena",
       rating=4.3, reviews=190,
       experience="Hotel spa · Getsemaní"),

    # ─────────────────────────────────────────────────────────────────────
    # BOAT CHARTERS & EXPERIENCES (from Tier A kill list)
    # ─────────────────────────────────────────────────────────────────────
    _v(50, "Savage Yacht Charter", "activity", "yacht", tier="elite", price_range="$$$$",
       description="Premium yacht charters to the Rosario Islands. Full-day luxury experiences with captain, crew, open bar, and island hopping.",
       phone="+57 313 789 0069",
       website="https://www.savageyacht.co",
       instagram="savageyachtco",
       rating=5.0, reviews=320,
       image_url="https://images.unsplash.com/photo-1567899378494-47b22a2ae96a?w=800&h=600&fit=crop",
       experience="Yate · Islas del Rosario · Lujo"),

    _v(51, "Nauty 360", "activity", "yacht", tier="premium", price_range="$$$",
       description="VIP boat rentals and yacht experiences. Island tours, sunset cruises, and private celebrations on the Caribbean.",
       phone="+57 300 723 8576",
       website="https://www.nauty360.com/en",
       instagram="nauty360",
       rating=4.9, reviews=480,
       experience="Yates · VIP · Islas del Rosario"),

    _v(52, "Botegena Boat Rentals", "activity", "yacht", tier="premium", price_range="$$$",
       description="Cartagena's go-to boat rental. Day trips to Cholón, Rosario Islands, and Barú with full crew and onboard service.",
       phone="+1 785-632-1824",
       website="https://www.botegena.com",
       rating=5.0, reviews=390,
       experience="Lanchas · Cholón · Barú"),

    _v(53, "Boats4U", "activity", "yacht", tier="popular", price_range="$$",
       description="Accessible boat experiences for groups. Island hopping, snorkeling, and beach club access at competitive prices.",
       phone="+57 304 459 4905",
       website="https://www.boats4u.co",
       rating=4.9, reviews=260,
       experience="Botes · Islas · Snorkel"),

    _v(54, "Lunático Experience", "activity", "cultural", tier="premium", price_range="$$",
       description="Immersive cooking classes and rum tasting experiences. Learn Caribbean cuisine from local chefs and taste Colombia's finest spirits.",
       phone="+57 310 238 5804",
       website="https://www.lunaticoexperience.com",
       instagram="lunaticoexperience",
       rating=4.9, reviews=720,
       image_url="https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&h=600&fit=crop",
       experience="Cooking class · Ron · Gastronomía"),

    _v(55, "Beyond Colombia Walking Tours", "activity", "cultural", tier="popular", price_range="$",
       description="Free walking tours through Cartagena's historic districts. Expert local guides sharing 500 years of history, culture, and hidden gems.",
       phone="+57 322 898 8557",
       website="https://www.beyondcolombia.com/cartagena",
       instagram="beyondcolombia",
       rating=4.9, reviews=1800,
       image_url="https://images.unsplash.com/photo-1558029137-a49d75b36fd8?w=800&h=600&fit=crop",
       experience="Walking tour · Historia · Gratis"),

    _v(56, "Rolling Playas", "activity", "beach_club", tier="popular", price_range="$$",
       description="Beach day experiences across Colombia's Caribbean coast. Playa Blanca, Rosario Islands, and exclusive beach club access.",
       phone="+57 323 441 0869",
       website="https://rollingplayas.com",
       rating=4.9, reviews=340,
       image_url="https://images.unsplash.com/photo-1540541338287-41700207dee6?w=800&h=600&fit=crop",
       experience="Playas · Islas · Beach club"),

    # ─────────────────────────────────────────────────────────────────────
    # CONCIERGE & LUXURY SERVICES (from Tier A)
    # ─────────────────────────────────────────────────────────────────────
    _v(60, "LB Concierge Colombia", "activity", "concierge", tier="elite", price_range="$$$$",
       description="Full-service luxury concierge. Private chefs, yacht charters, villa rentals, and bespoke experiences across Cartagena.",
       phone="+57 300 448 3590",
       website="https://www.lbconcierge.com.co",
       rating=5.0, reviews=180,
       experience="Concierge de lujo · Experiencias VIP"),

    _v(61, "Poseidon Lifestyle", "activity", "concierge", tier="elite", price_range="$$$$",
       description="Luxury concierge and travel experiences. Villa management, private events, and curated Cartagena itineraries for discerning travelers.",
       phone="+57 314 216 7269",
       website="https://poseidonlifestyle.oursite.co",
       rating=5.0, reviews=150,
       experience="Luxury travel · Villas · Eventos"),

    _v(62, "Cartagena Dreams", "activity", "concierge", tier="premium", price_range="$$$",
       description="Premium travel planning and concierge services. Airport transfers, guided tours, restaurant reservations, and local insider access.",
       phone="+57 301 706 4163",
       website="https://cartagenadreams.com",
       rating=5.0, reviews=420,
       experience="Travel planning · Tours · Reservas"),
]
