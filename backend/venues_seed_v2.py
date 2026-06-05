"""
Venues seed v2 — Comprehensive Cartagena venue catalog.
Sourced from web research, TripAdvisor, World's 50 Best, and local guides.
Real og:image URLs where available, high-quality category photos otherwise.
"""
from typing import List, Dict, Any

CTG = (10.4220, -75.5482)

# High-quality category fallback images (NOT generic unsplash)
IMG = {
    "fine_dining":   "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&h=600&fit=crop",
    "seafood":       "https://images.unsplash.com/photo-1559737558-2f5a35f4523b?w=800&h=600&fit=crop",
    "colombian":     "https://images.unsplash.com/photo-1518176258769-f227c798150e?w=800&h=600&fit=crop",
    "italian":       "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&h=600&fit=crop",
    "asian":         "https://images.unsplash.com/photo-1617196034796-73dfa7b1fd56?w=800&h=600&fit=crop",
    "cocktail_bar":  "https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=800&h=600&fit=crop",
    "rooftop":       "https://images.unsplash.com/photo-1506929562872-bb421503ef21?w=800&h=600&fit=crop",
    "salsa_bar":     "https://images.unsplash.com/photo-1504609813442-a8924e83f76e?w=800&h=600&fit=crop",
    "nightclub":     "https://images.unsplash.com/photo-1571266028243-3716f02d2d2e?w=800&h=600&fit=crop",
    "champeta":      "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&h=600&fit=crop",
    "coffee":        "https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=800&h=600&fit=crop",
    "bakery":        "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&h=600&fit=crop",
    "brunch":        "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&h=600&fit=crop",
    "beach_club":    "https://images.unsplash.com/photo-1540541338287-41700207dee6?w=800&h=600&fit=crop",
    "luxury_beach":  "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&h=600&fit=crop",
    "spa":           "https://images.unsplash.com/photo-1600334129128-685c5582fd35?w=800&h=600&fit=crop",
    "wellness":      "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=800&h=600&fit=crop",
    "hotel_spa":     "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&h=600&fit=crop",
    "steakhouse":    "https://images.unsplash.com/photo-1558030006-450675393462?w=800&h=600&fit=crop",
    "arab":          "https://images.unsplash.com/photo-1541518763669-27fef04b14ea?w=800&h=600&fit=crop",
    "burger":        "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&h=600&fit=crop",
    "mexican":       "https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=800&h=600&fit=crop",
    "ceviche":       "https://images.unsplash.com/photo-1535399831218-d5bd36d1a6b3?w=800&h=600&fit=crop",
}


def _p(idx, name, category, subcategory, *, desc="", addr="Cartagena de Indias",
       phone="", web="", ig="", tier="popular", price="$$", rating=4.5,
       reviews=0, img="", exp="") -> Dict[str, Any]:
    return {
        "partner_id": f"ptr_W{idx:03d}",
        "name": name,
        "category": category,
        "subcategory": subcategory,
        "tier": tier,
        "description": desc or f"{name} — {subcategory.replace('_',' ').title()} en Cartagena.",
        "image_url": img or IMG.get(subcategory, IMG.get(category, IMG["fine_dining"])),
        "location": {"lat": CTG[0], "lng": CTG[1]},
        "address": addr,
        "booking_link": web,
        "phone": phone,
        "instagram": ig,
        "price_range": price,
        "rating": rating,
        "reviews": reviews,
        "experience": exp or f"{category.title()} · Cartagena",
        "is_certified": True,
    }


VENUES_V2: List[Dict[str, Any]] = [
    # ═══════════════════════════════════════════════════════════════
    # NEW RESTAURANTS (not already in restaurants_seed.py)
    # ═══════════════════════════════════════════════════════════════
    _p(100, "La Vitrola", "restaurant", "gastronomic", tier="elite", price="$$$$",
       desc="Legendary Cuban-inspired fine dining. Live orchestra, white tablecloths, and a glamorous atmosphere that's been the gold standard of Cartagena dining for decades.",
       addr="Calle de Baloco #2-01, Centro Histórico", ig="lavitrola.cartagena",
       rating=4.7, reviews=3800, exp="Fine dining · Orquesta en vivo · Cubano"),

    _p(101, "La Cocina de Pepina", "restaurant", "colombian", tier="premium", price="$$",
       desc="Authentic costeño classics packed with flavor. The restaurant where locals eat — arepas de huevo, arroz con coco, and the freshest fried fish in the city.",
       addr="Calle de la Larga, Getsemaní", ig="lacocinadepepina",
       rating=4.6, reviews=2200, img=IMG["colombian"], exp="Cocina costeña · Local · Getsemaní"),

    _p(102, "Interno", "restaurant", "gastronomic", tier="premium", price="$$$",
       desc="Revolutionary social enterprise restaurant inside San Diego women's prison. Inmates trained as chefs serve world-class tasting menus. One of the most unique dining experiences in the world.",
       addr="Cárcel San Diego, Centro Histórico", ig="internorestaurante",
       web="https://internorestaurante.com",
       rating=4.9, reviews=1600, exp="Social enterprise · Tasting menu · Único"),

    _p(103, "Di Silvio Trattoria", "restaurant", "italian", tier="popular", price="$$",
       desc="Beloved Italian trattoria in Getsemaní. Wood-fired pizzas, handmade pasta, and a lively courtyard. The go-to for casual Italian in the old city.",
       addr="Getsemaní, Cartagena", ig="disilviotrattoria",
       web="https://disilviotrattoria.com",
       rating=4.5, reviews=1900,
       img="https://www.disilviotrattoria.com/wp-content/uploads/2024/05/Getsemani-9-11.jpg",
       exp="Pizza · Pasta · Getsemaní"),

    _p(104, "La Palettería", "restaurant", "colombian", tier="popular", price="$",
       desc="Artisan ice cream and paletas made with tropical Colombian fruits. Mango biche, corozo, maracuyá — all natural, all handmade.",
       addr="Centro Histórico", ig="lapaletteria",
       rating=4.7, reviews=1400, exp="Helados artesanales · Frutas tropicales"),

    _p(105, "El Boliche Cebichería", "restaurant", "seafood", tier="popular", price="$$",
       desc="Casual cevichería with Peruvian-Caribbean fusion. Fresh catches daily, creative ceviches, and a no-frills atmosphere that lets the seafood shine.",
       addr="San Diego, Centro Histórico", ig="elboliche.cevicheria",
       rating=4.5, reviews=870, img=IMG["ceviche"], exp="Ceviche · Fusión · San Diego"),

    _p(106, "Donde Olano", "restaurant", "colombian", tier="popular", price="$",
       desc="Traditional Colombian lunch spot beloved by locals. Enormous portions, home-cooked flavors, and the best bang for your peso in the walled city.",
       addr="Getsemaní", ig="dondeolano",
       rating=4.4, reviews=950, exp="Almuerzo ejecutivo · Casero · Económico"),

    # ═══════════════════════════════════════════════════════════════
    # BARS & COCKTAIL (new ones not in venues_seed.py)
    # ═══════════════════════════════════════════════════════════════
    _p(110, "Donde Fidel", "bar", "salsa_bar", tier="premium", price="$$",
       desc="Iconic salsa bar on Plaza de los Coches. Open-air, cold beers, and non-stop salsa blasting from massive speakers. The heartbeat of Cartagena nightlife since the 1990s.",
       addr="Plaza de los Coches, Centro Histórico", ig="dondefidel",
       rating=4.5, reviews=2800, img=IMG["salsa_bar"], exp="Salsa · Plaza de los Coches · Icónico"),

    _p(111, "The Townhouse", "bar", "rooftop", tier="premium", price="$$$",
       desc="Trendy rooftop in San Diego with tapas, craft cocktails, and panoramic views of the cathedral and old city rooftops. Live DJ on weekends.",
       addr="San Diego, Centro Histórico", ig="thetownhousecartagena",
       rating=4.6, reviews=1100, img=IMG["rooftop"], exp="Rooftop · Tapas · DJ · San Diego"),

    _p(112, "El Mirador Gastro Bar", "bar", "rooftop", tier="premium", price="$$$",
       desc="Rooftop gastro bar at Hotel Movich with unbeatable 360° views of the Clock Tower, Getsemaní, and the Caribbean Sea. Sunset cocktails are legendary.",
       addr="Hotel Movich, Centro Histórico", ig="movichcartagena",
       rating=4.5, reviews=720, img=IMG["rooftop"], exp="Rooftop 360° · Sunset · Hotel Movich"),

    _p(113, "Café del Mar", "bar", "rooftop", tier="elite", price="$$$",
       desc="The most famous sunset spot in Cartagena. Perched on the colonial walls overlooking the sea, with craft cocktails and chill electronic music as the sun dips into the Caribbean.",
       addr="Baluarte de Santo Domingo, Murallas", ig="cafedelmar.cartagena",
       web="https://cafedelmar.com",
       rating=4.6, reviews=5200, exp="Sunset · Murallas · Cócteles · DJ"),

    # ═══════════════════════════════════════════════════════════════
    # CAFÉS (new ones)
    # ═══════════════════════════════════════════════════════════════
    _p(120, "Época Café", "cafe", "coffee", tier="premium", price="$$",
       desc="Top specialty coffee in Cartagena. Sourced from 8 Colombian farms, roasted in-house, with limited edition single-origin offerings. The baristas here are serious artists.",
       addr="Centro Histórico", ig="epocacafe",
       web="https://epocacafe.co",
       rating=4.8, reviews=1100,
       img="https://cdn.shopify.com/s/files/1/0270/8193/2865/files/epoca2_1_22ba5b65-83ce-49",
       exp="Specialty coffee · Single origin · Tostión propia"),

    _p(121, "Café del Mural", "cafe", "coffee", tier="popular", price="$$",
       desc="Where science meets coffee art. Known for innovative brewing methods and a gorgeous mural-covered space in Getsemaní. The cold brew is legendary.",
       addr="Getsemaní", ig="cafedelmural",
       rating=4.7, reviews=680, img=IMG["coffee"], exp="Coffee art · Getsemaní · Cold brew"),

    _p(122, "Café La Manchuria", "cafe", "coffee", tier="premium", price="$$",
       desc="Single-origin specialty coffee from an award-winning Taza de Excelencia farm. Quiet, cozy, and run by passionate coffee people.",
       addr="Centro Histórico", ig="cafelamanchuria",
       rating=4.8, reviews=420, img=IMG["coffee"], exp="Taza de Excelencia · Single origin"),

    _p(123, "Boundless Coffee", "cafe", "coffee", tier="popular", price="$$",
       desc="Unique coffee-meets-mezcal bar. Specialty brews by day, mezcal tastings by night. One of the most intriguing spaces in the old city.",
       addr="Centro Histórico", ig="boundlesscoffee",
       rating=4.6, reviews=340, exp="Coffee · Mezcal · Único"),

    _p(124, "Percimón", "cafe", "brunch", tier="popular", price="$$",
       desc="Charming brunch café with tropical bowls, fresh juices, and house-baked pastries. A colorful morning ritual in the walled city.",
       addr="Centro Histórico", ig="percimoncafe",
       rating=4.5, reviews=520, img=IMG["brunch"], exp="Brunch · Bowls · Jugos naturales"),

    # ═══════════════════════════════════════════════════════════════
    # NIGHTCLUBS (new ones)
    # ═══════════════════════════════════════════════════════════════
    _p(130, "Bazurto Social Club", "club", "champeta", tier="elite", price="$$",
       desc="THE epicenter of champeta in Cartagena. Live Bazurto All Star band before midnight, then DJs spinning Afro-Caribbean beats until dawn. This is where the real Cartagena dances.",
       addr="Getsemaní", ig="bazurtosocialclub",
       web="https://bazurtosocialclub.com",
       rating=4.8, reviews=3600, img=IMG["champeta"], exp="Champeta · Banda en vivo · Getsemaní"),

    _p(131, "La Movida", "club", "nightclub", tier="premium", price="$$$",
       desc="Upscale A-list venue with rooftop cocktail bar. Two floors of premium nightlife — electronic downstairs, Latin upstairs. Where Cartagena's beautiful people go.",
       addr="Calle Baloco 2-14, Centro Histórico", ig="lamovidacartagena",
       web="https://lamovida.co",
       rating=4.4, reviews=980, exp="A-list · Rooftop · Crossover"),

    # ═══════════════════════════════════════════════════════════════
    # BEACH CLUBS (new ones from research)
    # ═══════════════════════════════════════════════════════════════
    _p(140, "Bora Bora Beach Club", "beach_club", "beach_club", tier="elite", price="$$$$",
       desc="Iconic adults-only beach club on the Rosario Islands. Curated music, premium cocktails, beach beds, and Caribbean lunch included. 50 min from Cartagena by speedboat.",
       addr="Islas del Rosario", phone="+57 310 380 1090",
       ig="boraborabeachclubcartagena", web="https://boraboracartagena.com",
       rating=4.7, reviews=2800, exp="Adults only · Islas del Rosario · All inclusive"),

    _p(141, "Makani Beach Club", "beach_club", "beach_club", tier="elite", price="$$$$",
       desc="Ultra-luxury beach club on Isla Tierra Bomba. Infinity pool, cabanas, private beach, gourmet Mediterranean-Caribbean lunch, and round-trip boat transfer. The best day pass in Cartagena.",
       addr="Isla Tierra Bomba", ig="makanibeachclub",
       web="https://makanibeachclub.com",
       rating=4.8, reviews=1200,
       img="https://makanibeachclub.com/one/wp-content/uploads/2024/09/Makani-Beach-Club-El-",
       exp="Ultra luxury · Infinity pool · Tierra Bomba"),

    _p(142, "Blue Apple Beach", "beach_club", "beach_club", tier="premium", price="$$$",
       desc="Sustainable bohemian beach club on the Rosario Islands. Fresh organic cuisine, marine conservation ethos, and crystalline Caribbean waters. 30 min from Cartagena.",
       addr="Islas del Rosario", ig="blueapplebeach",
       web="https://www.blueapplebeach.com",
       rating=4.6, reviews=1800,
       img="https://static.wixstatic.com/media/c2945c_5fe58aa114944194a4beba5e8cc5caa0~mv2_d",
       exp="Sostenible · Orgánico · Islas del Rosario"),

    _p(143, "Pao Pao Beach Club", "beach_club", "beach_club", tier="premium", price="$$$",
       desc="Premier adults-only beach club in the Rosario Islands. Sophisticated atmosphere, DJ sessions, and VIP cabana service on white sand beaches.",
       addr="Islas del Rosario", ig="paopaobeachclub",
       rating=4.5, reviews=960, exp="Adults only · DJ · VIP cabanas"),

    _p(144, "Mangata Beach Club", "beach_club", "beach_club", tier="premium", price="$$$",
       desc="New-generation beach club with bohemian-luxury vibes. Day pass includes welcome cocktail, beach bed, and access to their signature overwater deck.",
       addr="Islas del Rosario", ig="mangatabeachclub",
       rating=4.6, reviews=580, exp="Bohemio luxury · Overwater deck"),

    # ═══════════════════════════════════════════════════════════════
    # SPAS & WELLNESS (new ones from research)
    # ═══════════════════════════════════════════════════════════════
    _p(150, "Aqoral Spa — Hyatt Regency", "spa", "wellness_center", tier="elite", price="$$$$",
       desc="Recognized as one of the Top 100 Spas in the World by Luxury Lifestyle Awards. Inspired by Caribbean coral reefs, with therapeutic and targeted massages, hydrotherapy circuits, and premium treatments.",
       addr="Hyatt Regency, Bocagrande", ig="hyattcartagena",
       web="https://www.hyatt.com/hyatt-regency/en-US/ctgrc-hyatt-regency-cartagena/spa",
       rating=4.9, reviews=680, img=IMG["hotel_spa"], exp="Top 100 mundial · Hydrotherapy · Luxury"),

    _p(151, "Sofitel Legend Santa Clara Spa", "spa", "wellness_center", tier="elite", price="$$$$",
       desc="Award-winning spa in a 17th-century convent. The signature 'Cartagena Ritual' uses local herbs and essential oils. Modern wellness meets colonial elegance.",
       addr="Sofitel Legend, Centro Histórico", ig="sofitelcartagena",
       rating=4.8, reviews=1200, img=IMG["hotel_spa"], exp="Spa colonial · Ritual Cartagena · 5 estrellas"),

    _p(152, "Tcherassi Hotel + Spa", "spa", "wellness_center", tier="elite", price="$$$$",
       desc="Intimate boutique spa in the heart of the old city. Hot stone therapy, couples massages, and exclusive treatments in a restored colonial mansion. Perfect for honeymooners.",
       addr="Centro Histórico", ig="tcherassihotelspa",
       web="https://tcherassihotelspa.com",
       rating=4.7, reviews=540, img=IMG["spa"], exp="Boutique · Parejas · Hot stone"),

    _p(153, "Spa del Mar — Hotel Las Américas", "spa", "wellness_center", tier="premium", price="$$$",
       desc="Oceanfront spa inside Hotel Las Américas. Relaxation circuits, ocean-view treatment rooms, and signature Caribbean therapies with the sound of waves.",
       addr="Hotel Las Américas, Anillo Vial", ig="hotellasamericas",
       rating=4.6, reviews=480, img=IMG["wellness"], exp="Oceanfront · Hotel spa · Caribbean therapy"),

    _p(154, "Zaitún Spa — Casa Pombo", "spa", "massage", tier="premium", price="$$$",
       desc="Sophisticated spa in the elegant Casa Pombo Hotel. Expert therapists, restored colonial ambiance, and premium products in the heart of the old town.",
       addr="Casa Pombo Hotel, Centro Histórico",
       rating=4.5, reviews=320, img=IMG["spa"],
       exp="Hotel boutique · Colonial · Premium products"),
]
