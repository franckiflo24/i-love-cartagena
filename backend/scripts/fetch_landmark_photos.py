"""
Fetch real photos for AMO Cartagena landmarks + event categories using Google Places API.
Writes the resolved CDN URLs directly into events.json.
"""
import asyncio
import json
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

API_KEY = os.environ.get('GOOGLE_API_KEY', '')
if not API_KEY:
    print("ERROR: GOOGLE_API_KEY not set in backend/.env")
    sys.exit(1)

PLACES_SEARCH = "https://maps.googleapis.com/maps/api/place/findplacefromtext/json"
PLACES_PHOTO = "https://maps.googleapis.com/maps/api/place/photo"

EVENTS_PATH = ROOT.parent / "frontend" / "public" / "data" / "events.json"
DIST_EVENTS = ROOT.parent / "frontend" / "dist" / "data" / "events.json"

# Landmarks to search for (keyword in event title → Google Places query)
LANDMARK_QUERIES = {
    'castillo san felipe': 'Castillo San Felipe de Barajas Cartagena Colombia',
    'museo naval': 'Museo Naval del Caribe Cartagena Colombia',
    'teatro heredia': 'Teatro Adolfo Mejía Cartagena Colombia',
    'teatro adolfo': 'Teatro Adolfo Mejía Cartagena Colombia',
    'murallas': 'Murallas de Cartagena de Indias Colombia',
    'centro de convenciones': 'Centro de Convenciones Cartagena Colombia',
    'convento de la popa': 'Convento de la Popa Cartagena Colombia',
    'plaza santo domingo': 'Plaza Santo Domingo Cartagena Colombia',
    'torre del reloj': 'Torre del Reloj Cartagena Colombia',
    'san pedro claver': 'Iglesia San Pedro Claver Cartagena Colombia',
}

# Category queries (for events that don't match a landmark or venue)
CATEGORY_QUERIES = {
    'concert': 'live concert performance stage lights',
    'festival': 'Fiestas de Independencia Cartagena Colombia festival',
    'cultural': 'Centro Historico Cartagena Colombia colonial street',
    'nightlife': 'rooftop bar Cartagena Colombia nightlife',
    'market': 'mercado artesanal Cartagena Colombia handicraft market',
    'religious': 'Iglesia San Pedro Claver Cartagena Colombia church',
    'sports': 'marathon running race coast Cartagena Colombia',
}


async def fetch_photo(client: httpx.AsyncClient, query: str) -> str | None:
    """Search Google Places and return the resolved photo CDN URL."""
    try:
        resp = await client.get(PLACES_SEARCH, params={
            "input": query,
            "inputtype": "textquery",
            "fields": "place_id,name,photos",
            "key": API_KEY,
        }, timeout=10)

        data = resp.json()
        if data.get("status") != "OK" or not data.get("candidates"):
            print(f"  No results for: {query}")
            return None

        candidate = data["candidates"][0]
        photos = candidate.get("photos", [])
        if not photos:
            print(f"  No photos for: {candidate.get('name', query)}")
            return None

        photo_ref = photos[0]["photo_reference"]
        photo_url = f"{PLACES_PHOTO}?maxwidth=800&photo_reference={photo_ref}&key={API_KEY}"

        # Follow redirect to get CDN URL (don't expose API key)
        photo_resp = await client.get(photo_url, follow_redirects=True, timeout=10)
        if photo_resp.status_code == 200:
            final_url = str(photo_resp.url)
            print(f"  ✓ {candidate.get('name', query)}: {final_url[:80]}...")
            return final_url

    except Exception as e:
        print(f"  ERROR: {query}: {e}")
    return None


async def main():
    events = json.loads(EVENTS_PATH.read_text())
    print(f"Loaded {len(events)} events")

    async with httpx.AsyncClient() as client:
        # Pre-fetch all landmark photos
        print("\n=== Fetching landmark photos ===")
        landmark_urls: dict[str, str] = {}
        for keyword, query in LANDMARK_QUERIES.items():
            if keyword in landmark_urls:
                continue
            url = await fetch_photo(client, query)
            if url:
                landmark_urls[keyword] = url

        # Pre-fetch category photos
        print("\n=== Fetching category photos ===")
        category_urls: dict[str, str] = {}
        for cat, query in CATEGORY_QUERIES.items():
            url = await fetch_photo(client, query)
            if url:
                category_urls[cat] = url

        # Now update events
        print("\n=== Updating events ===")
        venue_matched = 0
        landmark_matched = 0
        category_matched = 0
        unchanged = 0

        for e in events:
            title = (e.get('name_es', '') or e.get('title', '')).lower()
            cat = e.get('category', '') or e.get('type', '')
            current_source = e.get('image_source', '')

            # Skip venue-matched (already have real partner photos)
            if current_source == 'venue':
                venue_matched += 1
                continue

            # Try landmark match
            matched = False
            for keyword, url in landmark_urls.items():
                if keyword in title:
                    e['image_url'] = url
                    e['image_source'] = 'landmark'
                    landmark_matched += 1
                    matched = True
                    break

            if matched:
                continue

            # Category fallback
            if cat in category_urls:
                e['image_url'] = category_urls[cat]
                e['image_source'] = 'category'
                category_matched += 1
            else:
                unchanged += 1

        # Save
        EVENTS_PATH.write_text(json.dumps(events, indent=2, ensure_ascii=False))
        if DIST_EVENTS.exists():
            DIST_EVENTS.write_text(json.dumps(events, indent=2, ensure_ascii=False))

        # Also update individual files
        for base in [EVENTS_PATH.parent / "events", DIST_EVENTS.parent / "events"]:
            if base.exists():
                for ev in events:
                    slug = ev.get('slug', ev.get('id', ''))
                    if slug:
                        (base / f"{slug}.json").write_text(
                            json.dumps(ev, indent=2, ensure_ascii=False)
                        )

        print(f"\n=== RESULTS ===")
        print(f"venue-matched (kept):     {venue_matched}")
        print(f"landmark-matched (new):   {landmark_matched}")
        print(f"category-matched (new):   {category_matched}")
        print(f"unchanged:                {unchanged}")

        # Verify zero unsplash
        unsplash = sum(1 for e in events if 'unsplash' in (e.get('image_url', '') or ''))
        print(f"unsplash remaining:       {unsplash}")


if __name__ == "__main__":
    asyncio.run(main())
