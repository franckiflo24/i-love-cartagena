#!/usr/bin/env python3
"""
Fetch REAL Google Places photos for the dossier venue batch — and SELF-HOST them.

Unlike places_photos_v2.py (which stored external lh3 URLs), this DOWNLOADS the
image bytes to frontend/public/images/partners/<partner_id>.jpg, matching AMO's
"self-host all images, zero runtime Google dependency" standard. image_url on each
ptr_dv_* record already points at that local path, so no record change is needed
beyond stamping google_place_id.

Verification (reused from places_photos_v2): Places Text Search with Cartagena
location bias + name/address-overlap gating, so a wrong venue's photo is rejected
rather than published. A clean category fallback beats a wrong photo.

Usage:
  GOOGLE_PLACES_KEY=AIza... python3 scripts/fetch_dossier_photos.py [--prefix ptr_dv_] [--limit N] [--dry-run]

Requires a Google Cloud key with **Places API (New)** enabled + billing.
Idempotent: re-run to fill in the ones that missed. Writes only verified matches.
"""
import argparse
import json
import os
import re
import sys
import time
import unicodedata
import urllib.request

from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO = SCRIPT_DIR.parent.parent
PARTNERS_FILE = REPO / "frontend" / "public" / "data" / "partners.json"
PARTNER_DIR = REPO / "frontend" / "public" / "data" / "partners"
IMG_DIR = REPO / "frontend" / "public" / "images" / "partners"

API_KEY = os.environ.get("GOOGLE_PLACES_KEY") or os.environ.get("GOOGLE_API_KEY", "")
if not API_KEY:
    print("ERROR: set GOOGLE_PLACES_KEY (Places API New + billing enabled)")
    sys.exit(1)

SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
CTG_LAT, CTG_LNG, CTG_RADIUS = 10.42, -75.53, 20000


def norm(s: str) -> set:
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = re.sub(r"[̀-ͯ]", "", s)
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return {w for w in s.split() if len(w) >= 3}


def name_overlap(a: str, b: str) -> float:
    x, y = norm(a), norm(b)
    if not x or not y:
        return 0.0
    return max(len(x & y) / len(x), len(x & y) / len(y))


def search_place(name: str, address: str, category: str) -> dict | None:
    query = f"{name} {category} {address} Cartagena Colombia".strip()
    body = json.dumps({
        "textQuery": query,
        "locationBias": {"circle": {"center": {"latitude": CTG_LAT, "longitude": CTG_LNG}, "radius": CTG_RADIUS}},
    }).encode()
    req = urllib.request.Request(SEARCH_URL, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Goog-Api-Key", API_KEY)
    req.add_header("X-Goog-FieldMask", "places.id,places.displayName,places.formattedAddress,places.photos")
    try:
        resp = urllib.request.urlopen(req, timeout=12)
        data = json.loads(resp.read())
    except Exception as e:
        return {"error": str(e)}
    places = data.get("places", [])
    if not places:
        return None
    p = places[0]
    api_name = p.get("displayName", {}).get("text", "")
    api_addr = p.get("formattedAddress", "")
    if "cartagena" not in api_addr.lower():
        return {"rejected": f"not in Cartagena ({api_addr[:40]})"}
    if name_overlap(name, api_name) < 0.34:
        return {"rejected": f"name mismatch (got '{api_name}')"}
    photos = p.get("photos", [])
    return {"place_id": p.get("id"), "api_name": api_name,
            "photo_resource": photos[0].get("name") if photos else None}


def download_photo(photo_resource: str, dest: Path) -> bool:
    """Download the actual image bytes (follows the media redirect) to dest."""
    url = f"https://places.googleapis.com/v1/{photo_resource}/media?key={API_KEY}&maxWidthPx=1600"
    try:
        req = urllib.request.Request(url, method="GET")
        resp = urllib.request.urlopen(req, timeout=20)  # follows redirect to lh3, returns bytes
        data = resp.read()
        if len(data) < 2000:  # too small to be a real photo
            return False
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        return True
    except Exception as e:
        print(f"      download error: {str(e)[:80]}")
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prefix", default="ptr_dv_")
    ap.add_argument("--limit", type=int, default=200)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    partners = json.loads(PARTNERS_FILE.read_text())
    targets = [p for p in partners if p["partner_id"].startswith(args.prefix)][:args.limit]
    print(f"Targets ({args.prefix}): {len(targets)}\n")

    ok = miss = 0
    for p in targets:
        pid, name = p["partner_id"], p["name"]
        print(f"  {pid}  {name[:42]}")
        res = search_place(name, p.get("address", ""), p.get("category", ""))
        if not res or res.get("error") or res.get("rejected") or not res.get("photo_resource"):
            reason = (res or {}).get("rejected") or (res or {}).get("error") or "no photo/no match"
            print(f"      MISS — {reason}")
            miss += 1
            time.sleep(0.3)
            continue
        p["google_place_id"] = res["place_id"]
        if args.dry_run:
            print(f"      OK (dry) — {res['api_name']} | {res['place_id']}")
            ok += 1
            time.sleep(0.3)
            continue
        if download_photo(res["photo_resource"], IMG_DIR / f"{pid}.jpg"):
            print(f"      SAVED /images/partners/{pid}.jpg  ({res['api_name']})")
            ok += 1
        else:
            print(f"      MISS — photo download failed")
            miss += 1
        time.sleep(0.3)

    if not args.dry_run and ok > 0:
        # persist google_place_id back into partners.json + per-partner files
        PARTNERS_FILE.write_text(json.dumps(partners, ensure_ascii=False, indent=2))
        by_id = {p["partner_id"]: p for p in partners}
        for pid in [p["partner_id"] for p in targets if "google_place_id" in by_id[p["partner_id"]]]:
            f = PARTNER_DIR / f"{pid}.json"
            if f.exists():
                rec = json.loads(f.read_text())
                rec["google_place_id"] = by_id[pid]["google_place_id"]
                f.write_text(json.dumps(rec, ensure_ascii=False, indent=2))

    print(f"\nDone: {ok} photos saved, {miss} missed. "
          f"{'(dry-run — nothing written)' if args.dry_run else 'Rebuild + deploy frontend to publish.'}")


if __name__ == "__main__":
    main()
