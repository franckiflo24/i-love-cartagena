#!/usr/bin/env python3
"""verify_coords_catalogwide.py — Drop 4 B1: place_id-verify the ENTIRE catalog.

The Aug-3 pass fixed the 161 partners stuck on the default centroid. This
sweep covers the REST: for every partner with a google_place_id, resolve the
authoritative location via Place Details and compare with stored coords.

  drift <= DRIFT_OK_M      → verified, untouched
  drift >  DRIFT_OK_M      → corrected ($set location+geo only) in --apply
  no place_id              → reported backlog (never guessed)
  place_id out-of-box      → reported HOLD (like ptr_V056), never auto-applied

Constitution: full backup before writes; image-hash (image_url/photos/images/
logo_url) asserted identical pre/post; GeoJSON lng-first; dry-run by default.

Run: python3 backend/scripts/verify_coords_catalogwide.py [--apply]
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
LAT_MIN, LAT_MAX, LNG_MIN, LNG_MAX = 9.5, 11.0, -76.5, -74.5
IMAGE_FIELDS = ("image_url", "photos", "images", "logo_url")
DETAILS = "https://maps.googleapis.com/maps/api/place/details/json"
DRIFT_OK_M = 150.0  # within GPS/pin noise for a venue — leave untouched
CACHE_PATH = os.path.join(REPO, "backend", "data", "backups", "placeid_resolutions_cache.json")


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


def haversine_m(lat1, lng1, lat2, lng2):
    import math
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def resolve(place_id: str, key: str, cache: dict):
    if place_id in cache:
        return cache[place_id].get("coords"), cache[place_id].get("status")
    url = f"{DETAILS}?place_id={urllib.parse.quote(place_id)}&fields=geometry&key={key}"
    try:
        d = json.loads(urllib.request.urlopen(url, timeout=15).read())
    except Exception as exc:
        return None, f"http:{exc}"
    status = d.get("status")
    coords = None
    if status == "OK":
        loc = ((d.get("result") or {}).get("geometry") or {}).get("location") or {}
        lat, lng = loc.get("lat"), loc.get("lng")
        if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
            coords = (lat, lng)
    cache[place_id] = {"coords": coords, "status": status}
    return coords, status


def main():
    apply = "--apply" in sys.argv
    key = os.environ.get("GOOGLE_PLACES_KEY") or dotenv_values(os.path.expanduser("~/.env.keys")).get("GOOGLE_PLACES_KEY")
    if not key:
        print("FATAL: no GOOGLE_PLACES_KEY")
        sys.exit(2)
    db = mongo_db()
    cache = {}
    if os.path.exists(CACHE_PATH):
        try:
            cache = json.load(open(CACHE_PATH))
            # json round-trip turns tuples into lists — normalize
            for k, v in cache.items():
                if v.get("coords"):
                    v["coords"] = tuple(v["coords"])
        except Exception:
            cache = {}

    partners = list(db.partners.find(
        {}, {"_id": 0, "partner_id": 1, "name": 1, "google_place_id": 1, "location": 1},
    ).sort("partner_id", 1))
    total = len(partners)
    print(f"catalog: {total}  mode={'APPLY' if apply else 'DRY-RUN'}  drift_ok={DRIFT_OK_M:.0f}m")

    if apply:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_path = os.path.join(BACKUP_DIR, f"partners_pre_catalogwide_coords_{stamp}.json.gz")
        docs = list(db.partners.find({}))
        for d in docs:
            d["_id"] = str(d["_id"])
        with gzip.open(backup_path, "wt", encoding="utf-8") as f:
            json.dump(docs, f, ensure_ascii=False, default=str)
        print(f"BACKUP: {backup_path} ({len(docs)} docs)")
        pre_hash = image_hash(db)
        print(f"image-hash pre : {pre_hash}")

    verified, corrected, no_pid, holds, api_miss = 0, [], [], [], []
    for i, p in enumerate(partners):
        pid = p["partner_id"]
        gpid = (p.get("google_place_id") or "").strip()
        loc = p.get("location") or {}
        slat, slng = loc.get("lat"), loc.get("lng")
        if not gpid:
            no_pid.append((pid, p["name"][:30]))
            continue
        coords, status = resolve(gpid, key, cache)
        if coords is None:
            api_miss.append((pid, p["name"][:28], status))
            continue
        glat, glng = coords
        if not (LAT_MIN < glat < LAT_MAX and LNG_MIN < glng < LNG_MAX):
            holds.append((pid, p["name"][:28], f"resolves out-of-box ({glat:.4f},{glng:.4f})"))
            continue
        if not isinstance(slat, (int, float)) or not isinstance(slng, (int, float)):
            drift = float("inf")
        else:
            drift = haversine_m(slat, slng, glat, glng)
        if drift <= DRIFT_OK_M:
            verified += 1
        else:
            corrected.append((pid, p["name"][:30], round(drift), glat, glng))
            if apply:
                db.partners.update_one(
                    {"partner_id": pid},
                    {"$set": {"location": {"lat": glat, "lng": glng},
                              "geo": {"type": "Point", "coordinates": [glng, glat]}}},  # LNG FIRST
                )
        if (i + 1) % 100 == 0:
            print(f"  …{i+1}/{total} (cache {len(cache)})")
            json.dump(cache, open(CACHE_PATH, "w"))
        time.sleep(0.05)
    json.dump(cache, open(CACHE_PATH, "w"))

    if apply:
        post_hash = image_hash(db)
        print(f"image-hash post: {post_hash}")
        if pre_hash != post_hash:
            print("FATAL: IMAGE HASH CHANGED — restore from backup NOW")
            sys.exit(1)
        print("image-hash diff: 0 ✓")

    print(f"\nREPORT: total={total}")
    print(f"  place_id-verified within {DRIFT_OK_M:.0f}m : {verified}")
    print(f"  drift-corrected ({'applied' if apply else 'would apply'}): {len(corrected)}")
    for c in corrected[:40]:
        print(f"    {c[0]:16s} {c[1]:30s} drift {c[2]}m -> ({c[3]:.6f},{c[4]:.6f})")
    if len(corrected) > 40:
        print(f"    … +{len(corrected)-40} more")
    print(f"  HOLD (place_id out-of-box, untouched): {len(holds)}")
    for h in holds:
        print(f"    {h[0]:16s} {h[1]:28s} {h[2]}")
    print(f"  api-miss (untouched): {len(api_miss)}")
    for m in api_miss:
        print(f"    {m[0]:16s} {m[1]:28s} {m[2]}")
    print(f"  NO place_id (unverifiable backlog): {len(no_pid)}")
    for n in no_pid[:30]:
        print(f"    {n[0]:16s} {n[1]}")
    if len(no_pid) > 30:
        print(f"    … +{len(no_pid)-30} more")
    # accounting: nothing silently dropped
    assert verified + len(corrected) + len(holds) + len(api_miss) + len(no_pid) == total, "accounting mismatch"
    print("ACCOUNTING OK — zero partners silently dropped")


if __name__ == "__main__":
    main()
