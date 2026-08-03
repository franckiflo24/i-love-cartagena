#!/usr/bin/env python3
"""geocode_from_place_ids.py — fix the 162 partners stuck at the DEFAULT
centroid (10.4220,-75.5482) by resolving their REAL coordinates from their
stored google_place_id via Places Details (grounded, deterministic — no name
guessing). Discovered during Walking Layer Drop 3: the 75m passport gate
rejects honest check-ins at any venue still sitting on the phantom point.

Constitution:
  1. FULL partners backup before any write (backend/data/backups/).
  2. Image-hash (image_url/photos/images/logo_url) asserted identical pre/post.
  3. $set ONLY location + geo (kept consistent, GeoJSON lng-first).
  4. Cartagena-box sanity on every resolved point; out-of-box → skipped+reported.
  5. No place_id / API miss → venue left untouched and REPORTED, never guessed.

Run:  GOOGLE_PLACES_KEY=... python3 backend/scripts/geocode_from_place_ids.py [--apply]
      (dry-run by default; --apply writes)
"""

import gzip
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from dotenv import dotenv_values
import pymongo

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BACKUP_DIR = os.path.join(REPO, "backend", "data", "backups")
D_LAT, D_LNG = 10.4220, -75.5482
LAT_MIN, LAT_MAX, LNG_MIN, LNG_MAX = 9.5, 11.0, -76.5, -74.5
IMAGE_FIELDS = ("image_url", "photos", "images", "logo_url")
DETAILS = "https://maps.googleapis.com/maps/api/place/details/json"


def mongo_db():
    vals = {}
    for f in (".env", ".env.production"):
        p = os.path.join(REPO, "backend", f)
        if os.path.exists(p):
            vals.update({k: v for k, v in dotenv_values(p).items() if v})
    return pymongo.MongoClient(vals["MONGO_URL"], serverSelectionTimeoutMS=10000)["amo_cartagena"]


def image_hash(db) -> str:
    rows = []
    proj = {"_id": 0, "partner_id": 1, **{f: 1 for f in IMAGE_FIELDS}}
    for p in db.partners.find({}, proj).sort("partner_id", 1):
        rows.append(json.dumps([p.get("partner_id")] + [p.get(f) for f in IMAGE_FIELDS], ensure_ascii=False))
    return hashlib.sha256("\n".join(rows).encode()).hexdigest()


def resolve(place_id: str, key: str):
    url = f"{DETAILS}?place_id={urllib.parse.quote(place_id)}&fields=geometry&key={key}"
    try:
        d = json.loads(urllib.request.urlopen(url, timeout=15).read())
    except Exception as exc:
        return None, f"http:{exc}"
    if d.get("status") != "OK":
        return None, d.get("status")
    loc = ((d.get("result") or {}).get("geometry") or {}).get("location") or {}
    lat, lng = loc.get("lat"), loc.get("lng")
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return None, "no-geometry"
    if not (LAT_MIN < lat < LAT_MAX and LNG_MIN < lng < LNG_MAX):
        return None, f"out-of-box:{lat},{lng}"
    return (lat, lng), "OK"


def main():
    apply = "--apply" in sys.argv
    key = os.environ.get("GOOGLE_PLACES_KEY") or dotenv_values(os.path.expanduser("~/.env.keys")).get("GOOGLE_PLACES_KEY")
    if not key:
        print("FATAL: no GOOGLE_PLACES_KEY")
        sys.exit(2)
    db = mongo_db()

    stuck = list(db.partners.find(
        {"location.lat": D_LAT, "location.lng": D_LNG},
        {"_id": 0, "partner_id": 1, "name": 1, "google_place_id": 1},
    ).sort("partner_id", 1))
    print(f"partners at default centroid: {len(stuck)}  mode={'APPLY' if apply else 'DRY-RUN'}")

    if apply:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_path = os.path.join(BACKUP_DIR, f"partners_pre_placeid_geocode_{stamp}.json.gz")
        docs = list(db.partners.find({}))
        for d in docs:
            d["_id"] = str(d["_id"])
        with gzip.open(backup_path, "wt", encoding="utf-8") as f:
            json.dump(docs, f, ensure_ascii=False, default=str)
        print(f"BACKUP: {backup_path} ({len(docs)} docs)")
        pre_hash = image_hash(db)
        print(f"image-hash pre : {pre_hash}")

    fixed, no_pid, api_miss = 0, [], []
    for p in stuck:
        pid = p["partner_id"]
        gpid = (p.get("google_place_id") or "").strip()
        if not gpid:
            no_pid.append(pid)
            continue
        coords, status = resolve(gpid, key)
        if not coords:
            api_miss.append((pid, p["name"][:28], status))
            continue
        lat, lng = coords
        moved = ((lat - D_LAT) ** 2 + (lng - D_LNG) ** 2) ** 0.5 * 111000
        if apply:
            db.partners.update_one(
                {"partner_id": pid},
                {"$set": {"location": {"lat": lat, "lng": lng},
                          "geo": {"type": "Point", "coordinates": [lng, lat]}}},  # LNG FIRST
            )
        fixed += 1
        print(f"  {'SET' if apply else 'would-set'} {pid:16s} {p['name'][:30]:30s} -> ({lat:.6f},{lng:.6f}) moved~{moved:.0f}m")
        time.sleep(0.06)

    if apply:
        post_hash = image_hash(db)
        print(f"image-hash post: {post_hash}")
        if pre_hash != post_hash:
            print("FATAL: IMAGE HASH CHANGED — restore from backup NOW")
            sys.exit(1)
        print("image-hash diff: 0 ✓")
        left = db.partners.count_documents({"location.lat": D_LAT, "location.lng": D_LNG})
        print(f"still at default after apply: {left}")

    print(f"\nREPORT: resolved={fixed} no_place_id={len(no_pid)} api_miss={len(api_miss)}")
    if no_pid:
        print("  no place_id (left untouched):", no_pid)
    for m in api_miss:
        print("  api-miss (left untouched):", m)


if __name__ == "__main__":
    main()
