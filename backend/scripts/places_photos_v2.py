#!/usr/bin/env python3
"""
Phase 1 — Fixed Places Photo Pipeline for AMO Cartagena.

Uses Google Places API (New) to fetch real business photos.
- Text Search with locationBias for Cartagena
- Address-token verification (reject mismatches)
- Follows redirect to stable lh3.googleusercontent.com URL
- Works on static JSON (no MongoDB required)

Usage:
  GOOGLE_PLACES_KEY=AIza... python3 places_photos_v2.py [--limit N] [--unsplash-only]
"""
import json
import os
import sys
import time
import urllib.request
import urllib.parse
import re
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPT_DIR.parent.parent / "frontend" / "public" / "data"
PARTNERS_FILE = DATA_DIR / "partners.json"

API_KEY = os.environ.get("GOOGLE_PLACES_KEY", "")
if not API_KEY:
    print("ERROR: Set GOOGLE_PLACES_KEY env var")
    sys.exit(1)

SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
MEDIA_URL = "https://places.googleapis.com/v1/{photo_name}/media"

# Cartagena center for location bias
CTG_LAT, CTG_LNG, CTG_RADIUS = 10.42, -75.53, 15000


def normalize(s: str) -> set:
    """Normalize a string to a set of lowercase tokens for address matching."""
    import unicodedata
    s = unicodedata.normalize('NFD', s.lower())
    s = re.sub(r'[\u0300-\u036f]', '', s)  # strip accents
    s = re.sub(r'[^a-z0-9\s]', ' ', s)
    return set(w for w in s.split() if len(w) >= 3)


def address_overlap(our_addr: str, api_addr: str) -> float:
    """Return fraction of our address tokens found in API address."""
    ours = normalize(our_addr)
    theirs = normalize(api_addr)
    if not ours:
        return 0.0
    return len(ours & theirs) / len(ours)


def name_overlap(our_name: str, api_name: str) -> float:
    """Return fraction of our name tokens found in API name (bidirectional best)."""
    ours = normalize(our_name)
    theirs = normalize(api_name)
    if not ours or not theirs:
        return 0.0
    fwd = len(ours & theirs) / len(ours)
    rev = len(ours & theirs) / len(theirs)
    return max(fwd, rev)


def is_in_cartagena(api_addr: str) -> bool:
    """Check if the API address contains Cartagena."""
    return 'cartagena' in api_addr.lower()


def search_place(name: str, address: str, category: str) -> dict | None:
    """Search for a business and return place_id, matched name, address, photo resource name."""
    query = f"{name} {category} {address} Cartagena Colombia" if address else f"{name} {category} Cartagena Colombia"

    body = json.dumps({
        "textQuery": query,
        "locationBias": {
            "circle": {
                "center": {"latitude": CTG_LAT, "longitude": CTG_LNG},
                "radius": CTG_RADIUS
            }
        }
    }).encode()

    req = urllib.request.Request(SEARCH_URL, data=body, method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('X-Goog-Api-Key', API_KEY)
    req.add_header('X-Goog-FieldMask', 'places.id,places.displayName,places.formattedAddress,places.photos,places.location')

    try:
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read())
    except Exception as e:
        return {"error": str(e)}

    places = data.get("places", [])
    if not places:
        return None

    place = places[0]
    api_name = place.get("displayName", {}).get("text", "")
    api_addr = place.get("formattedAddress", "")
    photos = place.get("photos", [])

    # Verification strategy:
    #   1. If our address has 3+ tokens (street-level), require address overlap >= 15%
    #   2. If our address is short (neighborhood only), accept if:
    #      - Name overlap >= 40% AND result is in Cartagena
    #   3. If no address at all, accept if name overlap >= 40% AND in Cartagena
    addr_tokens = normalize(address) if address else set()
    n_overlap = name_overlap(name, api_name)
    in_ctg = is_in_cartagena(api_addr)

    if len(addr_tokens) >= 3:
        overlap = address_overlap(address, api_addr)
        if overlap < 0.15:
            return {"rejected": True, "reason": f"address overlap {overlap:.0%}", "api_name": api_name, "api_addr": api_addr}
    elif address:
        # Short/neighborhood address — rely on name + city check
        if n_overlap < 0.4 and not in_ctg:
            return {"rejected": True, "reason": f"name overlap {n_overlap:.0%}, not in Cartagena", "api_name": api_name, "api_addr": api_addr}
        if n_overlap < 0.25:
            return {"rejected": True, "reason": f"name overlap too low {n_overlap:.0%}", "api_name": api_name, "api_addr": api_addr}
    else:
        if n_overlap < 0.4 or not in_ctg:
            return {"rejected": True, "reason": f"name overlap {n_overlap:.0%}, in_ctg={in_ctg}", "api_name": api_name, "api_addr": api_addr}

    if not photos:
        return {"place_id": place.get("id"), "api_name": api_name, "no_photos": True}

    return {
        "place_id": place.get("id"),
        "api_name": api_name,
        "api_addr": api_addr,
        "photo_resource": photos[0].get("name"),
        "location": place.get("location"),
    }


def resolve_photo_url(photo_resource: str) -> str | None:
    """Follow the media redirect to get the stable lh3 URL."""
    url = f"https://places.googleapis.com/v1/{photo_resource}/media?key={API_KEY}&maxWidthPx=1200&skipHttpRedirect=false"
    try:
        req = urllib.request.Request(url, method='GET')
        # Don't follow redirect — just get the Location header
        handler = urllib.request.HTTPRedirectHandler()
        opener = urllib.request.build_opener(handler)
        resp = opener.open(req, timeout=10)
        # If we get here, it followed the redirect
        final = resp.url
        if 'lh3.googleusercontent.com' in final:
            return final
        return final
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 303, 307, 308):
            loc = e.headers.get('Location', '')
            if loc:
                return loc
        return None
    except Exception:
        return None


def check_url(url: str) -> int:
    """HEAD check a URL, return HTTP status."""
    try:
        req = urllib.request.Request(url, method='HEAD')
        req.add_header('User-Agent', 'AMO-PhotoCheck/1.0')
        resp = urllib.request.urlopen(req, timeout=8)
        return resp.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=5)
    parser.add_argument('--unsplash-only', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    with open(PARTNERS_FILE) as f:
        partners = json.load(f)

    # Find partners needing real photos
    # PROTECTED: Partners with self-hosted images (/images/) are never touched.
    targets = []
    for p in partners:
        img = p.get('image_url', '')
        if img.startswith('/images/'):
            continue
        if args.unsplash_only and 'unsplash.com' not in img:
            continue
        if not args.unsplash_only and 'unsplash.com' not in img and img:
            continue
        targets.append(p)

    print(f"Partners needing photos: {len(targets)} (limit: {args.limit})")
    targets = targets[:args.limit]

    results = []
    for p in targets:
        name = p['name']
        addr = p.get('address', '')
        cat = p.get('category', '')
        pid = p['partner_id']

        print(f"\n  Searching: {name} [{cat}]...")
        place = search_place(name, addr, cat)

        if not place:
            print(f"    NO MATCH")
            results.append({"name": name, "pid": pid, "status": "NO_MATCH"})
            time.sleep(0.3)
            continue

        if place.get("error"):
            print(f"    ERROR: {place['error']}")
            results.append({"name": name, "pid": pid, "status": "ERROR", "detail": place['error']})
            time.sleep(0.3)
            continue

        if place.get("rejected"):
            print(f"    REJECTED: {place['reason']} (API: {place['api_name']} @ {place['api_addr']})")
            results.append({"name": name, "pid": pid, "status": "REJECTED", "detail": place['reason']})
            time.sleep(0.3)
            continue

        if place.get("no_photos"):
            print(f"    MATCHED but no photos: {place['api_name']}")
            results.append({"name": name, "pid": pid, "status": "NO_PHOTOS", "place_id": place['place_id']})
            time.sleep(0.3)
            continue

        # Resolve photo URL
        photo_url = resolve_photo_url(place['photo_resource'])
        if not photo_url:
            print(f"    MATCHED but photo resolve failed")
            results.append({"name": name, "pid": pid, "status": "PHOTO_FAIL", "place_id": place['place_id']})
            time.sleep(0.3)
            continue

        # Verify URL returns 200
        status = check_url(photo_url)
        match_conf = "HIGH" if place['api_name'].lower().strip() in name.lower() or name.lower() in place['api_name'].lower() else "MEDIUM"

        print(f"    FOUND: {place['api_name']} | {place['place_id']}")
        print(f"    Photo: {photo_url[:80]}... | HTTP {status}")
        print(f"    Match: {match_conf}")

        results.append({
            "name": name,
            "pid": pid,
            "status": "OK",
            "place_id": place['place_id'],
            "api_name": place['api_name'],
            "photo_url": photo_url,
            "http_status": status,
            "match_confidence": match_conf,
        })

        # Update partner in memory
        if not args.dry_run and status == 200:
            for pp in partners:
                if pp['partner_id'] == pid:
                    pp['image_url'] = photo_url
                    break

        time.sleep(0.3)  # rate limit

    # Summary
    print(f"\n{'='*70}")
    print(f"{'Name':<35} {'Place ID':<30} {'Photo URL':<25} {'HTTP':<5} {'Match'}")
    print(f"{'='*70}")
    for r in results:
        if r['status'] == 'OK':
            print(f"  {r['name']:<33} {r['place_id']:<28} {r['photo_url'][:22]}... {r['http_status']:<5} {r['match_confidence']}")
        else:
            print(f"  {r['name']:<33} {r['status']:<28}")
    print(f"{'='*70}")

    ok = sum(1 for r in results if r['status'] == 'OK')
    print(f"\nResults: {ok}/{len(results)} photos found")

    if not args.dry_run and ok > 0:
        with open(PARTNERS_FILE, 'w') as f:
            json.dump(partners, f, ensure_ascii=False, indent=2)
        print(f"Written {ok} updated photos to {PARTNERS_FILE}")

    return results


if __name__ == '__main__':
    main()
