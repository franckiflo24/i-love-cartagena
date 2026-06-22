"""
Dedup AMO Cartagena partners by name.

For each duplicate-name group:
  1. SCORE every candidate on completeness + photo quality + tier + rating.
  2. KEEP the highest-scoring record as winner.
  3. BACKFILL the winner with any richer field values from losers
     (so we never lose a phone/booking_link/rating just because the winner
     happened to be missing it).
  4. REWIRE foreign keys in partner_events, partner_promotions, rewards_offers
     to point at the winner's partner_id.
  5. DELETE losers.

Idempotent + dry-run by default.

Usage:
    export MONGO_URL_LOCAL="mongodb://localhost:27017"
    export DB_NAME="amo_cartagena"
    python scripts/dedup_partners.py                # dry-run, prints plan
    python scripts/dedup_partners.py --apply        # commits to local Mongo

Run BEFORE migrate_to_atlas.py so Atlas ships clean.
"""

import argparse
import os
import sys
from collections import defaultdict
from typing import Any

from pymongo import MongoClient

# Collections (among those migrated to Atlas) that store partner_id as an FK
FK_COLLECTIONS = ("partner_events", "partner_promotions", "rewards_offers")

# Fields whose presence makes a partner record "richer"
CONTENT_FIELDS = (
    "image_url", "phone", "address", "booking_link", "instagram",
    "description", "experience", "price_range", "rating", "reviews",
    "subcategory", "default_payment_link", "location",
)

TIER_RANK = {"elite": 4, "premium": 3, "popular": 2, "institutional": 1, None: 0, "": 0}


def is_filled(v: Any) -> bool:
    if v is None or v == "" or v == [] or v == {}:
        return False
    return True


def photo_quality(url: str | None) -> int:
    """Higher = more stable / authentic photo source."""
    if not url:
        return 0
    if "lh3.googleusercontent.com" in url:
        return 3       # Google Places — stable + authentic
    if "images.unsplash.com" in url:
        return 2       # Stock — stable but generic
    if url.startswith("https://"):
        return 1       # Anything else https
    return 0


def score(p: dict) -> tuple:
    """Sort key — higher tuple wins."""
    completeness = sum(1 for f in CONTENT_FIELDS if is_filled(p.get(f)))
    tier = TIER_RANK.get(p.get("tier"), 0)
    photo = photo_quality(p.get("image_url"))
    rating = float(p.get("rating") or 0)
    reviews = int(p.get("reviews") or 0)
    # Prefer original Excel-seed IDs (ptr_NNN) over later venues_seed (ptr_WNNN)
    pid = p.get("partner_id", "")
    pid_priority = 1 if (pid.startswith("ptr_") and not pid.startswith("ptr_W")) else 0
    return (completeness, tier, photo, rating, reviews, pid_priority)


def merge_richer(winner: dict, loser: dict) -> dict:
    """Return dict of field updates to apply to winner from loser (fields where loser is better)."""
    updates = {}
    for f in CONTENT_FIELDS:
        w_val = winner.get(f)
        l_val = loser.get(f)
        if not is_filled(w_val) and is_filled(l_val):
            updates[f] = l_val
            continue
        # numeric fields: prefer higher
        if f in ("rating", "reviews"):
            w_num = float(w_val or 0)
            l_num = float(l_val or 0)
            if l_num > w_num:
                updates[f] = l_val
        # photo: prefer higher quality
        if f == "image_url" and photo_quality(l_val) > photo_quality(w_val):
            updates[f] = l_val
    return updates


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true", help="commit changes (default: dry-run)")
    args = p.parse_args()

    url = os.environ.get("MONGO_URL_LOCAL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "amo_cartagena")
    db = MongoClient(url)[db_name]

    print(f"db: {db_name} @ {url.split('@')[-1]}   mode: {'APPLY' if args.apply else 'dry-run'}\n")

    # Group by exact name (could also key by (name.lower(), category) — stricter)
    groups = defaultdict(list)
    for doc in db.partners.find({}):
        groups[doc["name"]].append(doc)
    dups = {n: docs for n, docs in groups.items() if len(docs) > 1}

    if not dups:
        print("No duplicates found.")
        return 0

    print(f"Found {len(dups)} duplicate names ({sum(len(v) for v in dups.values())} total docs, "
          f"{sum(len(v)-1 for v in dups.values())} to remove)\n")

    total_losers = 0
    total_fk_rewired = 0
    total_field_merges = 0

    for name, docs in sorted(dups.items()):
        scored = sorted(docs, key=score, reverse=True)
        winner = scored[0]
        losers = scored[1:]
        loser_ids = [l["partner_id"] for l in losers]

        # Compute field-merge updates from losers into winner
        merge_updates = {}
        for l in losers:
            for k, v in merge_richer(winner, l).items():
                merge_updates.setdefault(k, v)

        # Count FK rows that need rewiring (per collection)
        fk_counts = {}
        for coll in FK_COLLECTIONS:
            n = db[coll].count_documents({"partner_id": {"$in": loser_ids}})
            if n:
                fk_counts[coll] = n

        print(f"  {name!r}")
        print(f"    WINNER : {winner['partner_id']}  tier={winner.get('tier')} "
              f"photo={photo_quality(winner.get('image_url'))} score={score(winner)}")
        for l in losers:
            print(f"    LOSER  : {l['partner_id']}  tier={l.get('tier')} "
                  f"photo={photo_quality(l.get('image_url'))} score={score(l)}")
        if merge_updates:
            print(f"    MERGE  : {list(merge_updates.keys())} backfilled from losers into winner")
        if fk_counts:
            print(f"    REWIRE : {fk_counts} -> {winner['partner_id']}")
        print()

        if not args.apply:
            total_losers += len(losers)
            total_field_merges += len(merge_updates)
            total_fk_rewired += sum(fk_counts.values())
            continue

        # APPLY
        if merge_updates:
            db.partners.update_one({"partner_id": winner["partner_id"]}, {"$set": merge_updates})
            total_field_merges += len(merge_updates)

        for coll in FK_COLLECTIONS:
            r = db[coll].update_many(
                {"partner_id": {"$in": loser_ids}},
                {"$set": {"partner_id": winner["partner_id"]}},
            )
            total_fk_rewired += r.modified_count

        r = db.partners.delete_many({"partner_id": {"$in": loser_ids}})
        total_losers += r.deleted_count

    print("=" * 64)
    print(f"  duplicate docs {'removed' if args.apply else 'planned to remove'}: {total_losers}")
    print(f"  fields merged into winners:                            {total_field_merges}")
    print(f"  FK rows rewired in {FK_COLLECTIONS}: {total_fk_rewired}")
    if not args.apply:
        print("\nDry-run only. Re-run with --apply to commit.")
    else:
        remaining = db.partners.count_documents({})
        print(f"\nFinal partner count: {remaining}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
