"""
Backfill the dossier-venue batch (2026-07) into the source-of-truth DB (Atlas).

The static frontend (partners.json + per-partner files) already carries these 29
venues and is live. This script syncs them into the `partners` collection so the
backend-driven surfaces (AI concierge, /api/search ranking, direct /api/partners/:id)
also know them.

IMPORTANT — Atlas is IP-whitelisted. Run this from a whitelisted context:
  • add your current IP under Atlas → Network Access, OR
  • run it from the deployed backend / a whitelisted CI box.

Usage:
  # Read creds from the pulled prod env (see CLAUDE.md):
  cd backend && npx vercel env pull .env.production --environment production --yes
  python3 scripts/upsert_dossier_venues.py --env .env.production --dry-run   # preview
  python3 scripts/upsert_dossier_venues.py --env .env.production             # apply

After applying, regenerate the static export from Atlas so both stay in sync:
  python3 scripts/dump_static.py     # (with the same Atlas creds in env)

Idempotent: upserts by partner_id. Never wipes. Safe to re-run.
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
SEED = BACKEND / "data" / "dossier_venues_2026-07.json"


def load_env(env_path: str) -> None:
    """Minimal .env loader (no external dep needed)."""
    p = Path(env_path)
    if not p.exists():
        return
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", default=".env.production", help="env file with MONGO_URL/DB_NAME")
    ap.add_argument("--dry-run", action="store_true", help="preview without writing")
    args = ap.parse_args()

    load_env(args.env)
    url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME", "amo_cartagena")
    if not url or "mongodb.net" not in url:
        print(f"[error] MONGO_URL not an Atlas URL (got: {'set' if url else 'empty'}). "
              f"Pull prod env first (see header).", file=sys.stderr)
        return 2

    records = json.loads(SEED.read_text())
    print(f"[seed] {len(records)} dossier venues from {SEED.name}")

    if args.dry_run:
        for r in records:
            print(f"  would upsert {r['partner_id']:14s} {r['name']}")
        print("[dry-run] no writes performed")
        return 0

    from pymongo import MongoClient
    try:
        db = MongoClient(url, serverSelectionTimeoutMS=8000)[db_name]
        before = db.partners.count_documents({})
    except Exception as e:
        print(f"[error] Atlas unreachable ({type(e).__name__}). Is your IP whitelisted? "
              f"{str(e)[:120]}", file=sys.stderr)
        return 3

    upserted, modified = 0, 0
    for i, r in enumerate(records):
        r.setdefault("order", 9000 + i)  # sort after existing curated ordering in backend list
        res = db.partners.update_one({"partner_id": r["partner_id"]}, {"$set": r}, upsert=True)
        if res.upserted_id is not None:
            upserted += 1
        elif res.modified_count:
            modified += 1

    after = db.partners.count_documents({})
    print(f"[done] upserted(new)={upserted} updated(existing)={modified} | partners {before} -> {after}")
    print("[next] run scripts/dump_static.py (same Atlas creds) to re-sync partners.json from Atlas")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
