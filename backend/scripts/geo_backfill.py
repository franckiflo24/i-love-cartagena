#!/usr/bin/env python3
"""geo_backfill.py — Walking Layer Drop 1a: complete the partners `geo` field.

Constitution-compliant data write:
  1. FULL backup of the partners collection to backend/data/backups/ (gzip JSON)
     BEFORE any write.
  2. SHA-256 hash of every (partner_id, image_url) pair before and after —
     asserts the write touched zero image fields.
  3. $set ONLY the named `geo` field, per-doc, computed from location.lat/lng.
     GeoJSON order is [lng, lat] — LONGITUDE FIRST — and every write asserts
     lng ∈ (-76.5, -74.5) and lat ∈ (9.5, 11.0) (Cartagena box), which makes a
     swapped-order bug a hard crash, not silent data corruption.
  4. Verifies the 2dsphere index on `geo` exists (creates only if missing).
  5. Reports: total, already-had-geo, backfilled, missing-coords list (backlog,
     never silently dropped), mismatches between geo and location (must be 0).

Idempotent: docs whose geo already matches location are left untouched.
Run:  python3 backend/scripts/geo_backfill.py          (from repo root)
"""

import gzip
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

from dotenv import dotenv_values
import pymongo

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BACKUP_DIR = os.path.join(REPO, "backend", "data", "backups")

# Cartagena bounding box — geo order assertion (lng FIRST in GeoJSON)
LNG_MIN, LNG_MAX = -76.5, -74.5
LAT_MIN, LAT_MAX = 9.5, 11.0


def mongo_url() -> str:
    vals = {}
    for f in (".env", ".env.production"):
        p = os.path.join(REPO, "backend", f)
        if os.path.exists(p):
            vals.update({k: v for k, v in dotenv_values(p).items() if v})
    url = vals.get("MONGO_URL") or vals.get("MONGODB_URI")
    if not url:
        print("FATAL: no MONGO_URL in backend/.env*")
        sys.exit(2)
    return url


IMAGE_FIELDS = ("image_url", "photos", "images", "logo_url")


def image_hash(db) -> str:
    """SHA-256 over EVERY image-bearing field, sorted by partner_id."""
    rows = []
    proj = {"_id": 0, "partner_id": 1, **{f: 1 for f in IMAGE_FIELDS}}
    for p in db.partners.find({}, proj).sort("partner_id", 1):
        rows.append(json.dumps([p.get("partner_id")] + [p.get(f) for f in IMAGE_FIELDS], ensure_ascii=False))
    return hashlib.sha256("\n".join(rows).encode()).hexdigest()


def main():
    db = pymongo.MongoClient(mongo_url(), serverSelectionTimeoutMS=10000)["amo_cartagena"]
    total = db.partners.count_documents({})
    print(f"partners total: {total}")

    # ── 1. BACKUP (before any write) ─────────────────────────────────
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = os.path.join(BACKUP_DIR, f"partners_pre_geo_backfill_{stamp}.json.gz")
    docs = list(db.partners.find({}))
    for d in docs:
        d["_id"] = str(d["_id"])
    with gzip.open(backup_path, "wt", encoding="utf-8") as f:
        json.dump(docs, f, ensure_ascii=False, default=str)
    size = os.path.getsize(backup_path)
    print(f"BACKUP: {backup_path} ({len(docs)} docs, {size/1024:.0f} KB)")
    if len(docs) != total:
        print("FATAL: backup doc count != collection count")
        sys.exit(2)

    # ── 2. Pre-write image hash ──────────────────────────────────────
    pre_hash = image_hash(db)
    print(f"image-hash pre : {pre_hash}")

    # ── 3. Backfill ──────────────────────────────────────────────────
    had_geo, backfilled, missing, mismatched_fixed = 0, 0, [], 0
    for p in db.partners.find({}, {"_id": 0, "partner_id": 1, "location": 1, "geo": 1}):
        pid = p["partner_id"]
        loc = p.get("location") or {}
        lat, lng = loc.get("lat"), loc.get("lng")
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            missing.append(pid)
            continue
        # ORDER ASSERTION: GeoJSON = [lng, lat]. Cartagena lng ≈ -75.5, lat ≈ 10.4.
        assert LNG_MIN < lng < LNG_MAX, f"{pid}: lng {lng} outside Cartagena box — order bug?"
        assert LAT_MIN < lat < LAT_MAX, f"{pid}: lat {lat} outside Cartagena box — order bug?"
        want = {"type": "Point", "coordinates": [lng, lat]}  # LNG FIRST
        cur = p.get("geo")
        if cur == want:
            had_geo += 1
            continue
        if isinstance(cur, dict) and cur.get("type") == "Point":
            mismatched_fixed += 1
        db.partners.update_one({"partner_id": pid}, {"$set": {"geo": want}})
        backfilled += 1

    # ── 4. Post-write image hash — MUST equal pre ────────────────────
    post_hash = image_hash(db)
    print(f"image-hash post: {post_hash}")
    if pre_hash != post_hash:
        print("FATAL: IMAGE HASH CHANGED — restore from backup NOW")
        sys.exit(1)
    print("image-hash diff: 0 ✓")

    # ── 5. Index + final verify ──────────────────────────────────────
    idx = {i["name"]: i for i in db.partners.list_indexes()}
    if "geo_2dsphere" in idx:
        print(f"index geo_2dsphere: exists ({dict(idx['geo_2dsphere']['key'])})")
    else:
        db.partners.create_index([("geo", pymongo.GEOSPHERE)])
        print("index geo_2dsphere: CREATED")

    with_geo = db.partners.count_documents({"geo.type": "Point"})
    print()
    print(f"REPORT: total={total} already_ok={had_geo} backfilled={backfilled} "
          f"(of which corrected={mismatched_fixed}) with_geo_now={with_geo}")
    print(f"missing-coords backlog ({len(missing)}): {missing if missing else 'EMPTY — all partners have valid coordinates'}")
    if with_geo + len(missing) != total:
        print("FATAL: with_geo + missing != total — investigate")
        sys.exit(1)
    print("GEO BACKFILL: OK")


if __name__ == "__main__":
    main()
