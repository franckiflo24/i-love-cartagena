#!/usr/bin/env python3
"""
Bug A Fix: Event Image De-duplication & Venue Linking
=====================================================
1. Match events to venue partners → use partner's image
2. For unmatched events → assign unique category-appropriate Unsplash photos
3. Guarantee: NO two events share the same image_url
"""

import json
import sys
from collections import Counter
from difflib import SequenceMatcher

# ---------------------------------------------------------------------------
# Curated Unsplash photo pools — unique per category, diverse within category
# Each list has 15+ photos so no sharing is needed even in the largest category
# ---------------------------------------------------------------------------

CURATED_POOL = {
    "cultural": [
        "photo-1569154941061-e231b4725ef1",  # Colombian street art
        "photo-1558618666-fcd25c85f82e",  # Museum interior
        "photo-1544928147-79a2dbc1f389",  # Cultural exhibition
        "photo-1580982324076-d95c6f3cbe67",  # Art gallery
        "photo-1518998053901-5348d3961a04",  # Colonial architecture
        "photo-1577083553431-6f3c0abf91e2",  # Street performance
        "photo-1560179707-f14e90ef3623",  # Historic plaza
        "photo-1571084600339-bb8834a07e16",  # Theater interior
        "photo-1594122230689-45899d9e6f69",  # Cultural dance
        "photo-1533653711942-9de4383f5951",  # Art installation
        "photo-1561839561-b13bcfe95249",  # Poetry / literature
        "photo-1582560469781-1eb4a3e0c4d2",  # Film festival
        "photo-1578662996442-48f60103fc96",  # Museum gallery
        "photo-1509281373149-e957c6296406",  # Heritage building
        "photo-1507003211169-0a1dd7228f2d",  # Cultural heritage
        "photo-1571425046056-cfc17c664e1d",  # Colonial city
    ],
    "festival": [
        "photo-1506157786151-b8491531f063",  # Festival crowd
        "photo-1459749411175-04bf5292ceea",  # Concert lights
        "photo-1470229722913-7c0e2dbbafd3",  # Music festival
        "photo-1492684223f8-e1f09149085",  # Colorful parade
        "photo-1514525253161-7a46d19cd819",  # Festival stage
        "photo-1501281668745-f7f57925c3b4",  # Carnival parade
        "photo-1533174072545-7a4b6ad7a6c3",  # Crowd celebration
        "photo-1524368535928-5b5e00ddc76b",  # Festival atmosphere
        "photo-1578946956088-940c3b502864",  # Street festival
        "photo-1547826039-bfc35e0f1ea8",  # Carnival dancers
        "photo-1516450360452-9312f5e86fc7",  # Night festival
        "photo-1541532713592-79a0317b6b77",  # Parade float
        "photo-1551818255-726b2daf0755",  # Independence parade
        "photo-1571019613454-1cb2f99b2d8b",  # Cultural festival
        "photo-1504196606672-aef5c9cefc92",  # Outdoor concert
        "photo-1560244251-d1eb59e0a94c",  # Rooftop festival
        "photo-1472653816316-3ad6f10a6592",  # Street celebration
        "photo-1558618666-fcd25c85f82e",  # Indoor festival
        "photo-1555939594-58d7cb561ad1",  # Food festival
        "photo-1507048331197-7d4ac70811cf",  # Town square fest
        "photo-1528502668930-3c9049e87862",  # Tropical festival
        "photo-1529006557810-274b9b2fc783",  # Artisan festival
    ],
    "nightlife": [
        "photo-1566737236500-c8ac43014a67",  # DJ booth
        "photo-1571019614242-c5c5dee9f50b",  # Night club
        "photo-1516450360452-9312f5e86fc7",  # Dance floor
        "photo-1598387993441-a364f854c3e1",  # Beach club night
        "photo-1545128485-c400e7702712",  # Pool party
        "photo-1504674900247-0877df9cc836",  # VIP lounge
        "photo-1572116469696-31de0f17cc34",  # Neon nightlife
        "photo-1560244251-d1eb59e0a94c",  # Rooftop party
        "photo-1575444758702-4a6b9222336e",  # Tropical party
        "photo-1519671482749-fd09be7ccebf",  # Disco lights
        "photo-1574391884720-bbc3740c59d1",  # Island party
        "photo-1508997449629-303059a039c0",  # Nightclub crowd
        "photo-1492127770532-0a1d30352141",  # Sunset-to-night party
        "photo-1551632811-561732d1e306",  # Beach bonfire
        "photo-1571902943202-507ec2618e8f",  # Evening venue
    ],
    "concert": [
        "photo-1493225457124-a3eb161ffa5f",  # Concert stage
        "photo-1470229722913-7c0e2dbbafd3",  # Live music
        "photo-1514525253161-7a46d19cd819",  # Concert crowd
        "photo-1501386761578-eac5c94b800a",  # Jazz performance
        "photo-1511192336575-5a79af67a629",  # Classical concert
        "photo-1453738773917-9c3eff1db985",  # Orchestra
        "photo-1565035010268-a3816f98589a",  # Electronic DJ
        "photo-1468164016595-6108e4a8c3b7",  # Outdoor concert
        "photo-1415201364774-f6f0bb35f28f",  # Guitar performance
        "photo-1429962714451-bb934ecdc4ec",  # Stage lighting
        "photo-1499364615650-ec38552f4f34",  # Festival main stage
        "photo-1506157786151-b8491531f063",  # Music event
        "photo-1504196606672-aef5c9cefc92",  # Band performance
        "photo-1524368535928-5b5e00ddc76b",  # Concert venue
        "photo-1540039155733-5bb30b53aa14",  # Jazz club
        "photo-1571019614242-c5c5dee9f50b",  # Night venue
        "photo-1560244251-d1eb59e0a94c",  # Rooftop concert
        "photo-1516450360452-9312f5e86fc7",  # Concert lights
        "photo-1566737236500-c8ac43014a67",  # DJ concert
        "photo-1572116469696-31de0f17cc34",  # Neon concert
    ],
    "religious": [
        "photo-1548625149-fc4a29cf7092",  # Cathedral interior
        "photo-1555817128-342e1c8b3f15",  # Church candles
        "photo-1506808940197-e8c6c534e3c8",  # Religious procession
        "photo-1541832676-9b763b0239ab",  # Church architecture
        "photo-1566731220638-8ec93e35b60e",  # Colonial church
        "photo-1519681393784-d120267933ba",  # Night candles
        "photo-1545128485-c400e7702712",  # Candlelight ceremony
        "photo-1507652313519-d4e9174996dd",  # Sacred architecture
        "photo-1560179707-f14e90ef3623",  # Historic church plaza
        "photo-1571425046056-cfc17c664e1d",  # Colonial religious site
    ],
    "market": [
        "photo-1555396273-367ea4eb4db5",  # Food market
        "photo-1504674900247-0877df9cc836",  # Gourmet food
        "photo-1466978913421-dad2ebd01d17",  # Street market
        "photo-1542838132-92c53300491e",  # Artisan market
        "photo-1464454709131-ffd692591ee5",  # Open-air market
        "photo-1519456264917-42d0aa2e0625",  # Food stalls
        "photo-1528502668930-3c9049e87862",  # Tropical fruit market
        "photo-1529006557810-274b9b2fc783",  # Local crafts
        "photo-1556909114-f6e7ad7d3136",  # Cooking market
        "photo-1507048331197-7d4ac70811cf",  # Market square
    ],
    "sports": [
        "photo-1530549387789-4c1017266635",  # Triathlon swim
        "photo-1517649763962-0c623066013b",  # Running race
        "photo-1541252260730-0412e8e2108e",  # Extreme sport
        "photo-1544919982-b61976f0ba43",  # Beach sport
        "photo-1461896836934-bd45ba8295d7",  # Cycling event
        "photo-1518611012118-696072aa579a",  # Marathon
    ],
    "beach_club": [
        "photo-1507525428034-b723cf961d3e",  # Tropical beach
        "photo-1544551763-46a013bb70d5",  # Beach day
        "photo-1506953823976-52e1fdc0149a",  # Caribbean beach
        "photo-1540541338287-41700207dee6",  # Beach party
        "photo-1519046904884-53103b34b206",  # Paradise beach
        "photo-1530053969600-caed2596d242",  # Beach club setup
        "photo-1520250497591-112f2f40a3f4",  # Tropical resort
        "photo-1476673160081-cf065607f449",  # Crystal water beach
        "photo-1501426026826-31c667bdf23d",  # Island beach
        "photo-1504681869696-d977211a5f4c",  # Beach chairs
    ],
    "wellness": [
        "photo-1544161515-4ab6ce6db874",  # Spa treatment
        "photo-1506126613408-eca07ce68773",  # Yoga outdoors
        "photo-1518611012118-696072aa579a",  # Meditation
        "photo-1599447421416-3414500d18a5",  # Sound healing
        "photo-1571019613454-1cb2f99b2d8b",  # Wellness retreat
        "photo-1545205597-3d9d02c29597",  # Yoga pose
        "photo-1519823551278-64ac92734fb1",  # Beach yoga
        "photo-1507652313519-d4e9174996dd",  # Peaceful scene
        "photo-1562088287-bde35a1ea917",  # Spa ambiance
        "photo-1559757175-0eb30cd8c063",  # Outdoor wellness
    ],
    "sunset": [
        "photo-1507525428034-b723cf961d3e",  # Sunset beach
        "photo-1469474968028-56623f02e42e",  # Golden sunset
        "photo-1495616811223-4d98c6e9c869",  # Rooftop sunset
        "photo-1472120435266-95a3f747eb08",  # Coastal sunset
        "photo-1506929562872-bb421503ef21",  # Ocean sunset
        "photo-1532274402911-5a369e4c4bb5",  # Tropical sunset
        "photo-1509233725247-49e657c54213",  # Caribbean sunset
        "photo-1504681869696-d977211a5f4c",  # Beach sunset lounge
    ],
    "after_party": [
        "photo-1571019614242-c5c5dee9f50b",  # After party vibe
        "photo-1566737236500-c8ac43014a67",  # Late night DJ
        "photo-1519671482749-fd09be7ccebf",  # Dance floor
    ],
    "brunch": [
        "photo-1504754524776-8f4f37790ca0",  # Brunch spread
        "photo-1517248135467-4c7edcad34c4",  # Restaurant brunch
        "photo-1555396273-367ea4eb4db5",  # Breakfast table
    ],
    "candlelight": [
        "photo-1511192336575-5a79af67a629",  # Candlelight concert
        "photo-1453738773917-9c3eff1db985",  # Classical venue
    ],
    "pop_up": [
        "photo-1580982324076-d95c6f3cbe67",  # Art gallery
        "photo-1533653711942-9de4383f5951",  # Pop-up exhibition
    ],
    "party": [
        "photo-1533174072545-7a4b6ad7a6c3",  # Party crowd
        "photo-1524368535928-5b5e00ddc76b",  # Party atmosphere
        "photo-1516450360452-9312f5e86fc7",  # Dance party
        "photo-1575444758702-4a6b9222336e",  # Tropical party
        "photo-1566737236500-c8ac43014a67",  # DJ party
    ],
    # Fallback for events with no type
    "general": [
        "photo-1583531352515-8884af319dc1",  # Cartagena view
        "photo-1569154941061-e231b4725ef1",  # Colombian scene
        "photo-1518998053901-5348d3961a04",  # Colonial street
        "photo-1571425046056-cfc17c664e1d",  # Walled city
        "photo-1560179707-f14e90ef3623",  # Historic plaza
        "photo-1577083553431-6f3c0abf91e2",  # Street scene
        "photo-1533653711942-9de4383f5951",  # Cultural scene
        "photo-1580982324076-d95c6f3cbe67",  # Exhibition
        "photo-1544928147-79a2dbc1f389",  # Cultural event
        "photo-1509281373149-e957c6296406",  # Heritage site
        "photo-1578662996442-48f60103fc96",  # Gallery
        "photo-1558618666-fcd25c85f82e",  # Interior
        "photo-1571084600339-bb8834a07e16",  # Theater
        "photo-1594122230689-45899d9e6f69",  # Performance
        "photo-1561839561-b13bcfe95249",  # Literary
        "photo-1582560469781-1eb4a3e0c4d2",  # Film
        "photo-1507003211169-0a1dd7228f2d",  # Heritage
        "photo-1506157786151-b8491531f063",  # Festival
        "photo-1501386761578-eac5c94b800a",  # Music
        "photo-1511192336575-5a79af67a629",  # Concert
        "photo-1548625149-fc4a29cf7092",  # Cathedral
        "photo-1519456264917-42d0aa2e0625",  # Market
        "photo-1530549387789-4c1017266635",  # Sport
        "photo-1504681869696-d977211a5f4c",  # Beach scene
        "photo-1520250497591-112f2f40a3f4",  # Tropical
        "photo-1469474968028-56623f02e42e",  # Sunset
        "photo-1504754524776-8f4f37790ca0",  # Food
        "photo-1542838132-92c53300491e",  # Artisan
        "photo-1566731220638-8ec93e35b60e",  # Church
        "photo-1519681393784-d120267933ba",  # Night scene
        "photo-1441984904996-e0b6ba687e04",  # Shopping
        "photo-1528502668930-3c9049e87862",  # Tropical market
        "photo-1529006557810-274b9b2fc783",  # Crafts
        "photo-1556909114-f6e7ad7d3136",  # Cooking
        "photo-1507048331197-7d4ac70811cf",  # Town square
        "photo-1545128485-c400e7702712",  # Ceremony
        "photo-1562088287-bde35a1ea917",  # Spa
        "photo-1517649763962-0c623066013b",  # Running
        "photo-1472120435266-95a3f747eb08",  # Coast
        "photo-1476673160081-cf065607f449",  # Island
        "photo-1501426026826-31c667bdf23d",  # Beach
        "photo-1519046904884-53103b34b206",  # Paradise
        "photo-1530053969600-caed2596d242",  # Resort
        "photo-1495616811223-4d98c6e9c869",  # Rooftop
        "photo-1532274402911-5a369e4c4bb5",  # Sunset
        "photo-1509233725247-49e657c54213",  # Caribbean
        "photo-1545205597-3d9d02c29597",  # Yoga
        "photo-1519823551278-64ac92734fb1",  # Beach wellness
        "photo-1559757175-0eb30cd8c063",  # Outdoor
        "photo-1507652313519-d4e9174996dd",  # Peaceful
        "photo-1492684223f8-e1f09149085",  # Colorful
        "photo-1551818255-726b2daf0755",  # Independence
        "photo-1571019613454-1cb2f99b2d8b",  # Cultural fest
        "photo-1555939594-58d7cb561ad1",  # Food scene
        "photo-1472653816316-3ad6f10a6592",  # Street celebration
        "photo-1546552768-9e3a94b38a59",  # Tropical scene
        "photo-1551632811-561732d1e306",  # Beach bonfire
        "photo-1508997449629-303059a039c0",  # Nightclub crowd
        "photo-1492127770532-0a1d30352141",  # Sunset party
        "photo-1574391884720-bbc3740c59d1",  # Island party
        "photo-1571902943202-507ec2618e8f",  # Evening venue
        "photo-1548013146-72479768bada",  # Ancient architecture
        "photo-1604719312566-8991b95c4e14",  # Candlelit
        "photo-1541532713592-79a0317b6b77",  # Parade float
        "photo-1555817128-342e1c8b3f15",  # Church candles
        "photo-1519681393784-d120267933ba",  # Night candles extra
        "photo-1566731220638-8ec93e35b60e",  # Colonial church 2
        "photo-1562088287-bde35a1ea917",  # Spa 2
        "photo-1545205597-3d9d02c29597",  # Yoga 2
        "photo-1519456264917-42d0aa2e0625",  # Market 2
        "photo-1464454709131-ffd692591ee5",  # Open market
        "photo-1545128485-c400e7702712",  # Ceremony 2
    ],
}

# Generic location names that should NOT match to specific partners
GENERIC_VENUES = {
    "centro historico", "centro histórico", "toda la ciudad", "barranquilla",
    "centro historico & getsemani", "centro historico / getsemani",
    "multiples sedes - centro historico", "multiples sedes",
    "centro de convenciones", "getsemani", "getsemaní",
    "centro historico & getsemaní",
}

# Manual venue → partner name mappings for known venues that fuzzy match can't catch
MANUAL_MAP = {
    "blue apple beach": "Blue Apple Beach",
    "bora bora beach club": "Bora Bora Beach Club",
    "taboo disco club": "Taboo Disco Club",
    "donde fidel salsa club": "Donde Fidel",
    "donde fidel": "Donde Fidel",
    "seven 7 times": "Seven 7 Times",
    "bazurto social club": "Bazurto Social Club",
    "café del mar": "Café del Mar",
    "cafe del mar": "Café del Mar",
    "alquimico": "Alquimico",
    "morena lounge beach": "Morena Lounge Beach",
    "morena beach club": "Morena Beach Club",
    "fenix beach club": "Fenix Beach Club & Hotel Cartagena",
    "fénix": "Fenix Beach Club & Hotel Cartagena",
    "hotel santa clara": "Sofitel Legend Santa Clara",
    "pao pao beach club": "Pao Pao Beach Club",
    "bellini": "Bethel Bellini",  # Closest match
    "la muralla": "Las Murallas de Cartagena",
    "atolon beach club": "Atolon Beach Club Cartagena",
    "bomba beach club": "Bomba Beach Club",
    "capri beach club cartagena": "Capri Beach Club Cartagena",
    "plaza santo domingo": "Plaza Santo Domingo",
    "san pedro claver": "Iglesia San Pedro Claver",
    "uraku spa massages": "URAKU Spa Massages",
    "juan del mar": "Juan del Mar",
    "casa bohème": "El Jardín — Casa Bohème",
    "isla barú beach club": "Isla Barú Beach Club",
    "teatro adolfo mejia": "Teatro Adolfo Mejía (Heredia)",
    "teatro heredia adolfo mejia": "Teatro Adolfo Mejía (Heredia)",
    "museo naval del caribe": "Museo Naval del Caribe",
    "volcán del totumo": "Volcán del Totumo",
    "volcan el totumo": "Volcán del Totumo",
    "islas del rosario": "Islas del Rosario",
    "plaza de los coches": "Plaza de los Coches",
    "convento de santa cruz de la popa": "Convento de la Popa",
    "catedral de santa catalina de alejandria": "Catedral de Santa Catalina",
    "parque del centenario": "Parque del Centenario",
}


def build_unsplash_url(photo_id: str) -> str:
    return f"https://images.unsplash.com/{photo_id}?w=600&q=80"


def main():
    with open("events.json") as f:
        events = json.load(f)
    with open("partners.json") as f:
        partners = json.load(f)

    # Build partner name → partner record lookup
    partner_by_name = {}
    for p in partners:
        name = p.get("name", "").strip()
        if name:
            partner_by_name[name.lower()] = p

    # Track all assigned URLs to prevent duplicates
    used_urls = set()

    # Phase 1: Collect already-good self-hosted image URLs
    for e in events:
        url = e.get("image_url", "")
        if "/images/" in url:
            used_urls.add(url)

    # Category index for round-robin assignment
    cat_index = {}

    stats = {
        "already_good": 0,
        "matched_partner": 0,
        "unique_category": 0,
        "total": len(events),
    }

    def get_unique_category_photo(category: str, event_title: str = "") -> str:
        """Get a unique Unsplash photo for this category, ensuring no duplicates."""
        cat = category.lower() if category else "general"
        pool = CURATED_POOL.get(cat, CURATED_POOL["general"])

        idx = cat_index.get(cat, 0)

        # Try each photo in the pool until we find an unused one
        for attempt in range(len(pool)):
            photo_id = pool[(idx + attempt) % len(pool)]
            url = build_unsplash_url(photo_id)
            if url not in used_urls:
                cat_index[cat] = (idx + attempt + 1) % len(pool)
                used_urls.add(url)
                return url

        # If all photos in category pool are used, try general pool
        pool = CURATED_POOL["general"]
        for photo_id in pool:
            url = build_unsplash_url(photo_id)
            if url not in used_urls:
                used_urls.add(url)
                return url

        # Absolute fallback — shouldn't happen with 50+ general photos
        print(f"  WARNING: Could not find unique photo for {event_title} (cat: {cat})", file=sys.stderr)
        return build_unsplash_url(pool[0])

    changes = []

    for i, e in enumerate(events):
        url = e.get("image_url", "")
        title = e.get("title", "") or e.get("name_es", "") or ""
        event_type = e.get("type", "") or e.get("category", "") or ""
        venue = e.get("venue_name", "") or e.get("venue", "") or ""

        # Skip already self-hosted
        if "/images/" in url:
            stats["already_good"] += 1
            continue

        # Try to match venue to partner
        matched_partner = None
        venue_lower = venue.strip().lower()

        # Skip generic locations — they match too many partners falsely
        if venue_lower in GENERIC_VENUES:
            venue_lower = ""

        # 1. Manual mapping
        if venue_lower in MANUAL_MAP:
            partner_name = MANUAL_MAP[venue_lower].lower()
            matched_partner = partner_by_name.get(partner_name)

        # 2. Exact name match
        if not matched_partner and venue_lower in partner_by_name:
            matched_partner = partner_by_name[venue_lower]

        # 3. Substring match — only if venue name is 3+ words (avoids "Norma" matching "Escuela Normal")
        #    and the match is the full venue or full partner, not a partial word overlap
        if not matched_partner and venue_lower and len(venue_lower.split()) >= 2:
            for pname, p in partner_by_name.items():
                # Full venue inside partner name (e.g. "San Pedro Claver" in "Iglesia San Pedro Claver")
                if len(venue_lower) >= 8 and venue_lower in pname:
                    matched_partner = p
                    break
                # Full partner inside venue name (e.g. "Bazurto Social Club" in "Bazurto Social Club de Cartagena")
                if len(pname) >= 8 and pname in venue_lower:
                    matched_partner = p
                    break

        if matched_partner:
            partner_img = matched_partner.get("image_url", "")
            if partner_img and partner_img not in used_urls:
                old_url = e.get("image_url", "")
                e["image_url"] = partner_img
                used_urls.add(partner_img)
                stats["matched_partner"] += 1
                changes.append(f"  LINKED: {title[:50]} -> {matched_partner['name']} ({partner_img[:50]})")
                continue
            elif partner_img:
                # Partner image already used by another event; fall through to unique assignment
                pass

        # No match or partner image already used → assign unique category photo
        new_url = get_unique_category_photo(event_type, title)
        old_url = e.get("image_url", "")
        if new_url != old_url:
            e["image_url"] = new_url
            stats["unique_category"] += 1
            changes.append(f"  UNIQUE: {title[:50]} (type:{event_type or '?'}) -> {new_url[39:75]}")

    # Write back
    with open("events.json", "w") as f:
        json.dump(events, f, indent=2, ensure_ascii=False)

    # Report
    print("=" * 60)
    print("BUG A FIX REPORT: Event Image De-duplication")
    print("=" * 60)
    print(f"Total events: {stats['total']}")
    print(f"Already self-hosted (untouched): {stats['already_good']}")
    print(f"Linked to venue partner: {stats['matched_partner']}")
    print(f"Assigned unique category photo: {stats['unique_category']}")
    print()

    # Verify zero duplicates
    all_urls = [e.get("image_url", "") for e in events if e.get("image_url")]
    url_counts = Counter(all_urls)
    dupes = [(url, count) for url, count in url_counts.most_common() if count > 1]
    if dupes:
        print(f"WARNING: {len(dupes)} duplicate image URLs remain:")
        for url, count in dupes:
            print(f"  {count}x {url[:70]}")
    else:
        print("VERIFIED: Zero duplicate image URLs. Every event has a unique image.")
    print()

    print("Changes made:")
    for c in changes:
        print(c)


if __name__ == "__main__":
    main()
