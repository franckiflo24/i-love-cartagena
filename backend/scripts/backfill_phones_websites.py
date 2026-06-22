"""
Backfill missing phone numbers and booking_link/website for partners
using Google Places API.

For each partner missing phone OR booking_link:
  1. findPlace by "<name> <category> Cartagena Colombia"
  2. placeDetails -> formatted_phone_number, international_phone_number, website
  3. Update Mongo

Idempotent: skips partners that already have both phone AND booking_link.
Dry-run by default. --apply to commit.

Usage:
    python scripts/backfill_phones_websites.py            # dry-run
    python scripts/backfill_phones_websites.py --apply    # write to Mongo
"""

import argparse
import os
import re
import sys
import time

import httpx
from pymongo import MongoClient

API_KEY = os.environ.get("GOOGLE_PLACES_KEY") or "AIzaSyDleYuNXfTaVRPy9hjLZcqc5B95Oy0CwdU"
FIND = "https://maps.googleapis.com/maps/api/place/findplacefromtext/json"
DETAILS = "https://maps.googleapis.com/maps/api/place/details/json"


def normalize_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    # Keep + and digits only; strip the rest
    cleaned = re.sub(r"[^\d+]", "", raw)
    # Prefer international +57 form; if local 7+ digits with no country code, prepend +57
    if cleaned.startswith("+"):
        return cleaned
    if re.fullmatch(r"\d{7,11}", cleaned):
        return f"+57{cleaned}" if not cleaned.startswith("57") else f"+{cleaned}"
    return cleaned or None


def lookup(client: httpx.Client, name: str, category: str) -> dict:
    """Return {'phone': str|None, 'website': str|None}."""
    query = f"{name} {category} Cartagena Colombia"
    out = {"phone": None, "website": None, "place_id": None}

    r = client.get(FIND, params={
        "input": query, "inputtype": "textquery",
        "fields": "place_id,name", "key": API_KEY,
    }, timeout=10)
    d = r.json()
    if d.get("status") != "OK" or not d.get("candidates"):
        return out
    pid = d["candidates"][0]["place_id"]
    out["place_id"] = pid

    r = client.get(DETAILS, params={
        "place_id": pid,
        "fields": "formatted_phone_number,international_phone_number,website",
        "key": API_KEY,
    }, timeout=10)
    d = r.json()
    if d.get("status") != "OK":
        return out
    res = d.get("result", {}) or {}
    out["phone"] = (
        normalize_phone(res.get("international_phone_number"))
        or normalize_phone(res.get("formatted_phone_number"))
    )
    out["website"] = res.get("website") or None
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="cap how many partners to process (0 = all)")
    args = ap.parse_args()

    db = MongoClient(os.environ.get("MONGO_URL_LOCAL", "mongodb://localhost:27017"))[
        os.environ.get("DB_NAME", "amo_cartagena")
    ]

    # Targets: partners missing EITHER phone OR booking_link
    query = {
        "$or": [
            {"phone": {"$in": [None, ""]}},
            {"booking_link": {"$in": [None, ""]}},
        ]
    }
    targets = list(db.partners.find(query, {
        "partner_id": 1, "name": 1, "category": 1, "phone": 1, "booking_link": 1,
    }))
    if args.limit:
        targets = targets[: args.limit]

    print(f"db: {db.name}   mode: {'APPLY' if args.apply else 'dry-run'}")
    print(f"targets: {len(targets)} partners missing phone and/or booking_link\n")

    filled_phone = 0
    filled_link = 0
    no_match = 0

    with httpx.Client(follow_redirects=True) as client:
        for i, p in enumerate(targets, 1):
            need_phone = not p.get("phone")
            need_link = not p.get("booking_link")
            try:
                info = lookup(client, p["name"], p.get("category", ""))
            except Exception as e:
                print(f"  [{i:3d}/{len(targets)}] {p['name'][:40]:40s} ERROR {e}")
                continue

            sets = {}
            if need_phone and info["phone"]:
                sets["phone"] = info["phone"]
            if need_link and info["website"]:
                sets["booking_link"] = info["website"]

            if not sets:
                no_match += 1
                if i <= 20 or i % 25 == 0:
                    print(f"  [{i:3d}/{len(targets)}] {p['name'][:40]:40s} (no data found)")
                time.sleep(0.05)
                continue

            if args.apply:
                db.partners.update_one({"partner_id": p["partner_id"]}, {"$set": sets})

            if "phone" in sets:
                filled_phone += 1
            if "booking_link" in sets:
                filled_link += 1
            tag = "FOUND" if args.apply else "would set"
            print(f"  [{i:3d}/{len(targets)}] {p['name'][:38]:38s} {tag}: "
                  f"{'📞' + sets.get('phone','')[:18]:22s} "
                  f"{'🔗' + (sets.get('booking_link','') or '')[:30]}")

            # Soft rate-limit — Google free tier allows plenty, this is courtesy
            time.sleep(0.08)

    print()
    print("=" * 64)
    print(f"  phones    {'set' if args.apply else 'would set'}: {filled_phone}")
    print(f"  websites  {'set' if args.apply else 'would set'}: {filled_link}")
    print(f"  no Google match (left as-is):  {no_match}")
    if not args.apply:
        print("\nDry-run only. Re-run with --apply to write to Mongo.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
