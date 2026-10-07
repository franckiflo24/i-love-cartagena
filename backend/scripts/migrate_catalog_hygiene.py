#!/usr/bin/env python3
"""CATALOG-HYGIENE v1 — one-off migration CLI (idempotent, reversible).

Mirrors POST /api/admin/maintenance/catalog-hygiene exactly (same shared
logic: catalog_hygiene.apply_hygiene). Prefer the ROUTE in normal ops — the
Atlas cluster is IP-whitelisted, so this direct-Mongo CLI only works from an
allowed IP (repo CLAUDE.md). Kept because the drop spec wants a standalone,
reviewable migration artifact.

Usage:
  MONGO_URL=... python3 scripts/migrate_catalog_hygiene.py --dry-run
  MONGO_URL=... python3 scripts/migrate_catalog_hygiene.py            # apply
  MONGO_URL=... python3 scripts/migrate_catalog_hygiene.py --reverse  # undo v1

Forward: preserve name_raw once; name := cleaned (unless name_verified);
STATUS_OVERRIDES applied; display_ready + hygiene_v stamped. Reverse: for
hygiene_v==HYGIENE_V, name := name_raw (unless name_verified) and unset
category_hint/display_ready/hygiene_v — status overrides are KEPT (spec).
Every mutating run snapshots prior fields into maintenance_backups first.
"""
from __future__ import annotations

import argparse
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import catalog_hygiene as H  # noqa: E402

FIELDS = {"_id": 0, "partner_id": 1, "name": 1, "name_raw": 1, "name_verified": 1,
          "status": 1, "status_note": 1, "address": 1, "location": 1, "geo": 1,
          "category_hint": 1, "display_ready": 1, "hygiene_v": 1}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--reverse", action="store_true")
    ap.add_argument("--db", default=os.environ.get("DB_NAME", "amo_cartagena"))
    args = ap.parse_args()

    url = os.environ.get("MONGO_URL", "").strip()
    if not url:
        print("ERROR: set MONGO_URL (or use the maintenance route — see docstring)")
        return 2
    from pymongo import MongoClient
    db = MongoClient(url, serverSelectionTimeoutMS=8000)[args.db]

    rows = list(db.partners.find({}, FIELDS))
    changes, hide, status_over = [], 0, 0
    for p in rows:
        pid = p.get("partner_id")
        if not pid:
            continue
        if args.reverse:
            if p.get("hygiene_v") != H.HYGIENE_V:
                continue
            st = {}
            if p.get("name_raw") and not p.get("name_verified"):
                st["name"] = p["name_raw"]
            changes.append((pid, {k: p.get(k) for k in ("name", "category_hint",
                            "display_ready", "hygiene_v")}, st,
                            ["category_hint", "display_ready", "hygiene_v"]))
            continue
        after = H.apply_hygiene(dict(p))
        st = {k: after.get(k) for k in ("name", "name_raw", "category_hint",
              "status", "status_note", "display_ready", "hygiene_v")
              if after.get(k) is not None and after.get(k) != p.get(k)}
        if not st:
            continue
        if after.get("display_ready") is False and p.get("display_ready") is not False:
            hide += 1
        if "status" in st:
            status_over += 1
        changes.append((pid, {k: p.get(k) for k in st}, st, []))

    print(f"scanned={len(rows)} would_change={len(changes)} "
          f"flips_to_not_ready={hide} status_overridden={status_over} "
          f"mode={'REVERSE' if args.reverse else 'FORWARD'}")
    for pid, prev, st, _ in changes[:40]:
        print(f"  {pid}: {prev.get('name')!r} -> {st.get('name')!r} "
              f"ready={st.get('display_ready')}")
    if args.dry_run:
        return 0

    backup_id = f"mb_{uuid.uuid4().hex[:10]}"
    db.maintenance_backups.insert_one({
        "backup_id": backup_id, "kind": "catalog_hygiene_v1", "reverse": args.reverse,
        "at": datetime.now(timezone.utc).isoformat(), "count": len(changes),
        "docs": [{"partner_id": pid, **prev} for pid, prev, _s, _u in changes]})
    applied = 0
    for pid, _prev, st, unset in changes:
        ops = {}
        if st:
            ops["$set"] = st
        if unset:
            ops["$unset"] = {k: "" for k in unset}
        if ops:
            applied += db.partners.update_one({"partner_id": pid}, ops).modified_count
    print(f"applied={applied} backup_id={backup_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
