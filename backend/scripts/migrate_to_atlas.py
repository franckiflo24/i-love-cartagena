"""
Migrate the AMO Cartagena catalog from local Mongo -> Atlas.

Copies ONLY catalog/seed collections (partners, events, venues, etc.).
Skips user/session/analytics/reservation data so Atlas starts clean for production.

Usage:
    export MONGO_URL_LOCAL="mongodb://localhost:27017"
    export MONGO_URL_ATLAS="mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?retryWrites=true&w=majority"
    export DB_NAME="amo_cartagena"
    python scripts/migrate_to_atlas.py            # dry-run: shows counts only
    python scripts/migrate_to_atlas.py --apply    # actually copies
    python scripts/migrate_to_atlas.py --apply --wipe-target  # delete-then-insert in Atlas

Idempotent: re-running with --apply upserts by the canonical id field of each collection.
"""

import argparse
import os
import sys
from pathlib import Path
from pymongo import MongoClient, UpdateOne

# Load .env from backend/ directory directly — bypasses zsh quoting issues
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

# Collections to migrate: name -> identifier field for upsert
CATALOG_COLLECTIONS = {
    "partners": "partner_id",
    "events": "event_id",
    "partner_events": "event_id",
    "seasons": "season_id",
    "concerts": "concert_id",
    "venues": "venue_id",
    "sponsors": "sponsor_id",
    "emergency_contacts": "contact_id",
    "transport": "transport_id",
    "rewards_offers": "offer_id",
    "port_tax_config": None,        # singleton — full replace
    "partner_promotions": "promo_id",
}

# Collections explicitly skipped (user/dev data)
SKIP = {
    "users", "user_sessions", "user_profiles", "business_users",
    "reservations", "favorites", "feedback", "city_passes",
    "analytics", "analytics_daily", "analytics_hourly", "analytics_demographics",
    "location_pings", "search_history", "ai_itineraries", "itineraries",
    "chat_sessions", "notifications", "review_reports", "reviews",
    "rewards_accounts", "rewards_history", "rewards_redemptions",
    "port_tax_tickets", "transport_tickets",
}


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true", help="actually write to Atlas (default: dry-run)")
    p.add_argument("--wipe-target", action="store_true", help="delete all docs in target collection before copying")
    args = p.parse_args()

    local_url = os.environ.get("MONGO_URL_LOCAL")
    atlas_url = os.environ.get("MONGO_URL_ATLAS")
    db_name = os.environ.get("DB_NAME", "amo_cartagena")

    if not local_url or not atlas_url:
        print("ERROR: set MONGO_URL_LOCAL and MONGO_URL_ATLAS", file=sys.stderr)
        return 2

    print(f"source: {local_url.split('@')[-1]} / db={db_name}")
    print(f"target: atlas / db={db_name}")
    print(f"mode:   {'APPLY' if args.apply else 'dry-run'}{' + WIPE' if args.wipe_target else ''}")
    print()

    src = MongoClient(local_url)[db_name]
    dst = MongoClient(atlas_url, serverSelectionTimeoutMS=10000)[db_name]

    # Probe Atlas
    try:
        dst.command("ping")
    except Exception as e:
        print(f"ERROR: cannot reach Atlas: {e}", file=sys.stderr)
        return 3

    src_names = set(src.list_collection_names())
    unknown = src_names - set(CATALOG_COLLECTIONS) - SKIP
    if unknown:
        print(f"[warn] collections present in source but neither catalog nor skip: {sorted(unknown)}")
        print(f"       -> these will NOT be migrated. Add to CATALOG_COLLECTIONS if needed.\n")

    total_src = 0
    total_written = 0

    for coll, id_field in CATALOG_COLLECTIONS.items():
        if coll not in src_names:
            print(f"  - {coll:22s}  (not in source, skipped)")
            continue
        src_count = src[coll].count_documents({})
        dst_count_before = dst[coll].count_documents({}) if args.apply or args.wipe_target else None
        total_src += src_count

        line = f"  - {coll:22s} src={src_count:>5}"
        if dst_count_before is not None:
            line += f"  dst_before={dst_count_before:>5}"

        if not args.apply:
            print(line + "  [dry]")
            continue

        if args.wipe_target:
            dst[coll].delete_many({})

        docs = list(src[coll].find({}))
        for d in docs:
            # _id is ObjectId — let target generate its own to avoid collisions
            d.pop("_id", None)

        if not docs:
            print(line + "  (empty)")
            continue

        if id_field and not args.wipe_target:
            # Upsert by id_field
            ops = []
            for d in docs:
                key = d.get(id_field)
                if key is None:
                    # fall back to insert
                    dst[coll].insert_one(d)
                    continue
                ops.append(UpdateOne({id_field: key}, {"$set": d}, upsert=True))
            if ops:
                res = dst[coll].bulk_write(ops, ordered=False)
                wrote = (res.upserted_count or 0) + (res.modified_count or 0)
            else:
                wrote = 0
        else:
            # Singleton or wipe -> insert all
            dst[coll].insert_many(docs, ordered=False)
            wrote = len(docs)

        dst_count_after = dst[coll].count_documents({})
        total_written += wrote
        print(line + f"  wrote={wrote:>5}  dst_after={dst_count_after:>5}")

    print()
    print(f"source catalog rows: {total_src}")
    if args.apply:
        print(f"rows written:        {total_written}")
        print("DONE.")
    else:
        print("dry-run only. re-run with --apply to copy.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
