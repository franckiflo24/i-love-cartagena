#!/usr/bin/env python3
"""
verify_catalog.py — Single-pass catalog verification for AMO Cartagena.

Checks every partner in frontend/public/data/partners.json for:
  1. image_url present + HTTP 200
  2. category in the canonical set
  3. subcategory present and consistent with category
  4. no duplicates by name+address

Outputs a table: total / passing / failing with reasons.
"""
import json
import os
import sys
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, '..', '..', 'frontend', 'public', 'data')
PARTNERS_FILE = os.path.join(DATA_DIR, 'partners.json')

# Canonical categories
VALID_CATEGORIES = {
    'restaurant', 'hotel', 'activity', 'wellness', 'bar', 'beach_club',
    'club', 'spa', 'cafe', 'realestate', 'yacht', 'institutional', 'beauty',
}

# Valid subcategories per category
VALID_SUBCATEGORIES = {
    'restaurant': {'international', 'seafood', 'colombian', 'italian', 'asian', 'vegetarian',
                   'gastronomic', 'fastfood', 'brunch', 'cafe', 'cocktail_bar', 'mediterranean', 'arab'},
    'hotel':      {'boutique', 'lujo', 'premium', 'cultural', 'popular'},
    'activity':   {'cultural', 'sport', 'gastronomic', 'concierge', 'yacht', 'beach_club'},
    'wellness':   {'wellness_center', 'massage', 'beauty', 'fitness', 'spa', 'yoga', 'hair', 'nails', 'recovery', 'sport'},
    'bar':        {'cocktail_bar', 'rooftop', 'lounge', 'live_music', 'salsa_bar'},
    'beach_club': {'beach_club', 'cocktail_bar', 'boutique', 'nightclub', 'cultural'},
    'club':       {'nightclub', 'live_music', 'lounge', 'champeta'},
    'spa':        {'massage', 'beauty', 'wellness_center', 'spa'},
    'cafe':       {'coffee', 'cafe', 'brunch', 'bakery'},
    'beauty':     {'salon', 'barbershop', 'nails', 'makeup', 'facial_spa', 'aesthetic_clinic', 'lashes_brows'},
    'realestate': {'lujo'},
    'yacht':      {'yacht'},
    'institutional': {'cultural', 'concierge', 'government'},
}


def check_url(url: str) -> tuple[str, int | str]:
    try:
        req = urllib.request.Request(url, method='HEAD')
        req.add_header('User-Agent', 'AMO-Verify/1.0')
        resp = urllib.request.urlopen(req, timeout=10)
        return url, resp.status
    except Exception as e:
        return url, str(e)[:60]


def main():
    if not os.path.exists(PARTNERS_FILE):
        print(f"ERROR: {PARTNERS_FILE} not found")
        sys.exit(1)

    with open(PARTNERS_FILE) as f:
        partners = json.load(f)

    total = len(partners)
    failures: list[dict] = []
    url_map: dict[str, str] = {}  # url -> partner_name for broken URL reporting

    # Collect all image URLs for parallel checking
    for p in partners:
        url = p.get('image_url', '')
        if url and url.startswith('http'):
            url_map[url] = p.get('name', '?')

    # Check URLs in parallel
    broken_urls: set[str] = set()
    print(f"Checking {len(url_map)} unique image URLs...")
    with ThreadPoolExecutor(max_workers=20) as ex:
        futures = {ex.submit(check_url, u): u for u in url_map}
        for fut in as_completed(futures):
            url, status = fut.result()
            if status != 200:
                broken_urls.add(url)

    # Check each partner
    seen_names: dict[str, list[str]] = defaultdict(list)  # name+address -> partner_ids

    for p in partners:
        pid = p.get('partner_id', '?')
        name = p.get('name', '?')
        cat = p.get('category', '')
        sub = p.get('subcategory', '')
        img = p.get('image_url', '')
        addr = p.get('address', '')

        errs = []

        # 1. Image URL
        if not img:
            errs.append('NO_IMAGE: missing image_url')
        elif not img.startswith('http'):
            errs.append(f'BAD_IMAGE: not a URL ({img[:40]})')
        elif img in broken_urls:
            errs.append(f'BROKEN_IMAGE: HTTP error')

        # 2. Category
        if not cat:
            errs.append('NO_CATEGORY')
        elif cat not in VALID_CATEGORIES:
            errs.append(f'INVALID_CATEGORY: "{cat}"')

        # 3. Subcategory
        if not sub:
            errs.append('NO_SUBCATEGORY')
        elif cat in VALID_SUBCATEGORIES and sub not in VALID_SUBCATEGORIES[cat]:
            errs.append(f'INCONSISTENT_SUBCATEGORY: "{sub}" not valid for category "{cat}"')

        # 4. Duplicate check
        key = f"{name.lower().strip()}|{addr.lower().strip()}"
        seen_names[key].append(pid)

        if errs:
            failures.append({'id': pid, 'name': name, 'errors': errs})

    # Check duplicates
    for key, ids in seen_names.items():
        if len(ids) > 1:
            name_part = key.split('|')[0]
            for pid in ids[1:]:
                failures.append({'id': pid, 'name': name_part, 'errors': [f'DUPLICATE: same name+address as {ids[0]}']})

    passing = total - len(failures)

    print(f"\n{'='*60}")
    print(f"  AMO Cartagena Catalog Verification")
    print(f"{'='*60}")
    print(f"  Total partners:  {total}")
    print(f"  Passing:         {passing}")
    print(f"  Failing:         {len(failures)}")
    print(f"  Image URLs:      {len(url_map)} unique, {len(broken_urls)} broken")
    print(f"{'='*60}")

    if failures:
        print(f"\n{'─'*60}")
        print(f"  FAILURES:")
        print(f"{'─'*60}")
        for f in failures:
            print(f"  [{f['id'][:12]}] {f['name']}")
            for e in f['errors']:
                print(f"    → {e}")
        print(f"{'─'*60}")
    else:
        print(f"\n  ✅ ALL {total} PARTNERS PASS ALL CHECKS")

    sys.exit(0 if not failures else 1)


if __name__ == '__main__':
    main()
