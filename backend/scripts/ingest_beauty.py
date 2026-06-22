#!/usr/bin/env python3
"""
Phase 2 — Beauty Vertical Ingest for AMO Cartagena.

Uses Google Places API (New) Text Search to find beauty businesses in Cartagena.
Quality filters, deduplication, schema mapping, photo pipeline.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.parse
import re
import unicodedata
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPT_DIR.parent.parent / "frontend" / "public" / "data"
PARTNERS_FILE = DATA_DIR / "partners.json"

API_KEY = os.environ.get("GOOGLE_PLACES_KEY", "")
if not API_KEY:
    print("ERROR: Set GOOGLE_PLACES_KEY env var")
    sys.exit(1)

SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
CTG_LAT, CTG_LNG, CTG_RADIUS = 10.42, -75.53, 12000

# Cartagena bounding box
LAT_MIN, LAT_MAX = 10.30, 10.55
LNG_MIN, LNG_MAX = -75.62, -75.42

QUERIES = [
    ("salón de belleza Cartagena", "salon"),
    ("barbería Cartagena", "barbershop"),
    ("peluquería Cartagena", "salon"),
    ("spa facial Cartagena", "facial_spa"),
    ("centro estético Cartagena", "aesthetic_clinic"),
    ("maquillaje profesional Cartagena", "makeup"),
    ("uñas Cartagena", "nails"),
    ("nail salon Cartagena", "nails"),
    ("barbershop Cartagena", "barbershop"),
    ("cejas y pestañas Cartagena", "lashes_brows"),
    ("clínica estética Cartagena", "aesthetic_clinic"),
    ("depilación láser Cartagena", "aesthetic_clinic"),
]

FIELD_MASK = ",".join([
    "places.id", "places.displayName", "places.formattedAddress",
    "places.location", "places.nationalPhoneNumber", "places.internationalPhoneNumber",
    "places.rating", "places.userRatingCount", "places.photos",
    "places.regularOpeningHours", "places.websiteUri", "places.businessStatus",
])


def normalize_name(s: str) -> str:
    s = unicodedata.normalize('NFD', s.lower())
    s = re.sub(r'[\u0300-\u036f]', '', s)
    s = re.sub(r'[^a-z0-9\s]', '', s)
    return ' '.join(s.split())


def format_phone(intl: str, natl: str) -> str:
    """Format phone for wa.me — prefer international, strip to +57..."""
    phone = intl or natl or ""
    phone = re.sub(r'[^\d+]', '', phone)
    if not phone:
        return ""
    if phone.startswith('+'):
        return phone
    if phone.startswith('57'):
        return f'+{phone}'
    if len(phone) == 10 and phone.startswith('3'):
        return f'+57{phone}'
    if len(phone) == 7:
        return f'+57605{phone}'
    return f'+57{phone}'


def format_hours(opening_hours: dict | None) -> str:
    """Convert regularOpeningHours to readable string."""
    if not opening_hours:
        return "Lun-Sáb 09:00 - 19:00"
    descs = opening_hours.get("weekdayDescriptions", [])
    if descs:
        # Compact: take first and last day
        if len(descs) >= 5:
            return "; ".join(descs[:2]) + " ..."
        return "; ".join(descs)
    return "Lun-Sáb 09:00 - 19:00"


def resolve_photo(photo_resource: str) -> str | None:
    """Get stable lh3 URL from photo resource name."""
    url = f"https://places.googleapis.com/v1/{photo_resource}/media?key={API_KEY}&maxWidthPx=1200&skipHttpRedirect=false"
    try:
        req = urllib.request.Request(url)
        handler = urllib.request.HTTPRedirectHandler()
        opener = urllib.request.build_opener(handler)
        resp = opener.open(req, timeout=10)
        return resp.url if 'lh3.googleusercontent.com' in resp.url else resp.url
    except urllib.error.HTTPError as e:
        loc = e.headers.get('Location', '')
        return loc if loc else None
    except Exception:
        return None


def search_places(query: str) -> list:
    """Run a text search and return raw results."""
    body = json.dumps({
        "textQuery": query,
        "locationBias": {
            "circle": {
                "center": {"latitude": CTG_LAT, "longitude": CTG_LNG},
                "radius": CTG_RADIUS,
            }
        },
        "maxResultCount": 20,
    }).encode()

    req = urllib.request.Request(SEARCH_URL, data=body, method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('X-Goog-Api-Key', API_KEY)
    req.add_header('X-Goog-FieldMask', FIELD_MASK)

    try:
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read())
        return data.get("places", [])
    except Exception as e:
        print(f"    Search error: {e}")
        return []


def main():
    with open(PARTNERS_FILE) as f:
        existing = json.load(f)

    # Build dedup sets from existing partners
    existing_names = set()
    existing_ids = set()
    for p in existing:
        existing_names.add(normalize_name(p.get('name', '') + '|' + p.get('address', '')))
        existing_ids.add(p.get('partner_id', ''))

    # Track all discovered places by place_id for dedup
    seen_place_ids = set()
    candidates = []
    stats = {"found": 0, "filtered": 0, "dupes": 0}

    for query, default_subcat in QUERIES:
        print(f"\n  Searching: {query}")
        results = search_places(query)
        print(f"    Got {len(results)} results")

        for place in results:
            pid = place.get("id", "")

            # Dedupe by place_id
            if pid in seen_place_ids:
                stats["dupes"] += 1
                continue
            seen_place_ids.add(pid)

            name = place.get("displayName", {}).get("text", "")
            addr = place.get("formattedAddress", "")
            lat = place.get("location", {}).get("latitude", 0)
            lng = place.get("location", {}).get("longitude", 0)
            rating = place.get("rating", 0)
            reviews = place.get("userRatingCount", 0)
            status = place.get("businessStatus", "")
            photos = place.get("photos", [])
            phone_intl = place.get("internationalPhoneNumber", "")
            phone_natl = place.get("nationalPhoneNumber", "")
            hours = place.get("regularOpeningHours")
            website = place.get("websiteUri", "")

            stats["found"] += 1

            # QUALITY FILTER
            if status != "OPERATIONAL":
                stats["filtered"] += 1
                continue
            if rating < 4.0 or reviews < 15:
                stats["filtered"] += 1
                continue
            if not photos:
                stats["filtered"] += 1
                continue
            if not (LAT_MIN <= lat <= LAT_MAX and LNG_MIN <= lng <= LNG_MAX):
                stats["filtered"] += 1
                continue

            # Dedupe against existing catalog
            norm_key = normalize_name(name + '|' + addr)
            if norm_key in existing_names:
                stats["dupes"] += 1
                continue

            candidates.append({
                "place_id": pid,
                "name": name,
                "address": addr,
                "lat": lat,
                "lng": lng,
                "rating": rating,
                "reviews": reviews,
                "phone_intl": phone_intl,
                "phone_natl": phone_natl,
                "photos": photos,
                "hours": hours,
                "website": website,
                "subcategory": default_subcat,
            })

        time.sleep(0.5)

    print(f"\n{'='*60}")
    print(f"  Discovery: {stats['found']} found, {stats['filtered']} filtered, {stats['dupes']} dupes")
    print(f"  Candidates after filter: {len(candidates)}")
    print(f"{'='*60}")

    # Resolve photos and build partner records
    new_partners = []
    next_id = len(existing) + 1

    for c in candidates:
        photo_url = resolve_photo(c["photos"][0].get("name", "")) if c["photos"] else None
        if not photo_url:
            continue

        phone = format_phone(c["phone_intl"], c["phone_natl"])
        hours_str = format_hours(c["hours"])

        partner = {
            "partner_id": f"ptr_beauty_{next_id:04d}",
            "name": c["name"],
            "category": "beauty",
            "subcategory": c["subcategory"],
            "description": f"{c['name']} — servicios de belleza y cuidado personal en Cartagena.",
            "address": c["address"],
            "location": {"lat": c["lat"], "lng": c["lng"]},
            "phone": phone,
            "image_url": photo_url,
            "instagram": "",
            "booking_link": c["website"] or "",
            "rating": c["rating"],
            "reviews": c["reviews"],
            "price_range": "$$",
            "tier": "standard",
            "hours": hours_str,
            "is_certified": False,
            "is_government": False,
            "experience": "",
            "default_payment_link": "",
            "membership_status": "inactive",
            "membership_tier": "standard",
            "membership_plan": "none",
            "membership_paid_until": None,
            "cuisine": "",
        }
        new_partners.append(partner)
        next_id += 1
        print(f"  + {c['name']} [{c['subcategory']}] | {phone} | ★{c['rating']}")
        time.sleep(0.2)

    # Subcategory breakdown
    subcat_counts = {}
    for p in new_partners:
        sc = p["subcategory"]
        subcat_counts[sc] = subcat_counts.get(sc, 0) + 1

    print(f"\n{'='*60}")
    print(f"  BEAUTY VERTICAL INGEST SUMMARY")
    print(f"{'='*60}")
    print(f"  Total ingested: {len(new_partners)}")
    print(f"  By subcategory:")
    for sc, count in sorted(subcat_counts.items(), key=lambda x: -x[1]):
        print(f"    {sc}: {count}")

    # Merge into catalog
    merged = existing + new_partners
    with open(PARTNERS_FILE, 'w') as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)
    print(f"\n  Written {len(merged)} total partners to {PARTNERS_FILE}")
    print(f"  (was {len(existing)}, added {len(new_partners)})")


if __name__ == '__main__':
    main()
