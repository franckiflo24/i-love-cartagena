#!/usr/bin/env python3
"""
Bug B Fix: Kill Google Places URLs Permanently
===============================================
Phase 1: Sync individual JSON files from main files (zero-download, instant)
  - data/partners/*.json → sync image_url from partners.json
  - data/events/*.json → sync image_url from events.json
  - calendar.json → fix inline
  - partner-events.json → fix inline

Phase 2: For records with no self-hosted match, assign category Unsplash
  (Unsplash URLs are stable and don't expire like Google Places)

Result: Zero Google Places URLs in the entire data directory.
"""

import json
import glob
import os
import shutil
from collections import Counter
from datetime import datetime

DATA_DIR = "/Users/showowt/i-love-cartagena/frontend/public/data"
BACKUP_SUFFIX = datetime.now().strftime("%Y%m%d_%H%M%S")

# Category → Unsplash fallback for unmatched records
CATEGORY_FALLBACKS = {
    "restaurant": "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&q=80",
    "bar": "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&q=80",
    "cafe": "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=600&q=80",
    "hotel": "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&q=80",
    "beach_club": "https://images.unsplash.com/photo-1540541338287-41700207dee6?w=600&q=80",
    "wellness": "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=600&q=80",
    "spa": "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=600&q=80",
    "beauty": "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=600&q=80",
    "nightclub": "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=600&q=80",
    "club": "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=600&q=80",
    "shopping": "https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=600&q=80",
    "attraction": "https://images.unsplash.com/photo-1569154941061-e231b4725ef1?w=600&q=80",
    "transport": "https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=600&q=80",
    "activity": "https://images.unsplash.com/photo-1530789253388-582c481c54b0?w=600&q=80",
    "cultural": "https://images.unsplash.com/photo-1569154941061-e231b4725ef1?w=600&q=80",
    "yacht": "https://images.unsplash.com/photo-1567899378494-47b22a2ae96a?w=600&q=80",
}


def is_google_url(url: str) -> bool:
    if not url:
        return False
    return "googleusercontent.com" in url or "googleapis.com" in url


def get_category_fallback(category: str) -> str:
    if not category:
        return CATEGORY_FALLBACKS.get("attraction", "")
    return CATEGORY_FALLBACKS.get(category.lower(), CATEGORY_FALLBACKS.get("attraction", ""))


def main():
    stats = {
        "partners_synced": 0,
        "partners_fallback": 0,
        "partners_already_ok": 0,
        "partners_no_match": 0,
        "events_synced": 0,
        "events_fallback": 0,
        "events_already_ok": 0,
        "events_no_match": 0,
        "calendar_fixed": 0,
        "partner_events_fixed": 0,
        "google_urls_killed": 0,
    }

    # ===================================================================
    # PHASE 1: SYNC INDIVIDUAL PARTNER FILES
    # ===================================================================
    print("=" * 60)
    print("PHASE 1: Syncing individual partner files")
    print("=" * 60)

    # Load main partners.json
    with open(os.path.join(DATA_DIR, "partners.json")) as f:
        main_partners = json.load(f)

    # Build lookup: partner_id → record, name → record
    partner_by_id = {}
    partner_by_name = {}
    for p in main_partners:
        pid = p.get("partner_id", "")
        name = p.get("name", "").strip().lower()
        if pid:
            partner_by_id[pid] = p
        if name:
            partner_by_name[name] = p

    # Process each individual partner file
    partner_files = sorted(glob.glob(os.path.join(DATA_DIR, "partners", "*.json")))
    print(f"  Found {len(partner_files)} individual partner files")

    # Backup the entire partners directory
    backup_dir = os.path.join(DATA_DIR, f"partners_backup_{BACKUP_SUFFIX}")
    shutil.copytree(os.path.join(DATA_DIR, "partners"), backup_dir)
    print(f"  Backup created: {backup_dir}")

    for fp in partner_files:
        with open(fp) as f:
            record = json.load(f)

        url = record.get("image_url", "")
        pid = record.get("partner_id", "")
        name = record.get("name", "").strip().lower()
        category = record.get("category", "")

        if not is_google_url(url):
            stats["partners_already_ok"] += 1
            continue

        # Try to find match in main file
        main_record = partner_by_id.get(pid) or partner_by_name.get(name)

        if main_record:
            main_img = main_record.get("image_url", "")
            if main_img and not is_google_url(main_img):
                record["image_url"] = main_img
                stats["partners_synced"] += 1
                stats["google_urls_killed"] += 1
            else:
                # Main file also has Google URL or empty — use category fallback
                fallback = get_category_fallback(category)
                if fallback:
                    record["image_url"] = fallback
                    stats["partners_fallback"] += 1
                    stats["google_urls_killed"] += 1
                else:
                    stats["partners_no_match"] += 1
        else:
            # No match in main file — use category fallback
            fallback = get_category_fallback(category)
            if fallback:
                record["image_url"] = fallback
                stats["partners_fallback"] += 1
                stats["google_urls_killed"] += 1
            else:
                stats["partners_no_match"] += 1

        with open(fp, "w") as f:
            json.dump(record, f, indent=2, ensure_ascii=False)

    print(f"  Synced from main: {stats['partners_synced']}")
    print(f"  Category fallback: {stats['partners_fallback']}")
    print(f"  Already OK: {stats['partners_already_ok']}")
    print(f"  No match: {stats['partners_no_match']}")
    print()

    # ===================================================================
    # PHASE 2: SYNC INDIVIDUAL EVENT FILES
    # ===================================================================
    print("=" * 60)
    print("PHASE 2: Syncing individual event files")
    print("=" * 60)

    with open(os.path.join(DATA_DIR, "events.json")) as f:
        main_events = json.load(f)

    # Build lookup: event_id/slug → record
    event_by_id = {}
    event_by_slug = {}
    for e in main_events:
        eid = e.get("event_id", "")
        slug = e.get("slug", "")
        if eid:
            event_by_id[eid] = e
        if slug:
            event_by_slug[slug] = e

    event_files = sorted(glob.glob(os.path.join(DATA_DIR, "events", "*.json")))
    print(f"  Found {len(event_files)} individual event files")

    # Backup events directory
    events_backup = os.path.join(DATA_DIR, f"events_backup_{BACKUP_SUFFIX}")
    if os.path.exists(os.path.join(DATA_DIR, "events")):
        shutil.copytree(os.path.join(DATA_DIR, "events"), events_backup)
        print(f"  Backup created: {events_backup}")

    for fp in event_files:
        with open(fp) as f:
            record = json.load(f)

        url = record.get("image_url", "")

        if not is_google_url(url):
            stats["events_already_ok"] += 1
            continue

        # Try to find match — use slug (filename without .json) or event_id
        slug = os.path.splitext(os.path.basename(fp))[0]
        eid = record.get("event_id", "")

        main_record = event_by_id.get(eid) or event_by_slug.get(slug)

        if main_record:
            main_img = main_record.get("image_url", "")
            if main_img and not is_google_url(main_img):
                record["image_url"] = main_img
                stats["events_synced"] += 1
                stats["google_urls_killed"] += 1
            else:
                event_type = record.get("type", "") or record.get("category", "")
                fallback = get_category_fallback(event_type)
                if fallback:
                    record["image_url"] = fallback
                    stats["events_fallback"] += 1
                    stats["google_urls_killed"] += 1
                else:
                    stats["events_no_match"] += 1
        else:
            event_type = record.get("type", "") or record.get("category", "")
            fallback = get_category_fallback(event_type)
            if fallback:
                record["image_url"] = fallback
                stats["events_fallback"] += 1
                stats["google_urls_killed"] += 1
            else:
                stats["events_no_match"] += 1

        with open(fp, "w") as f:
            json.dump(record, f, indent=2, ensure_ascii=False)

    print(f"  Synced from main: {stats['events_synced']}")
    print(f"  Category fallback: {stats['events_fallback']}")
    print(f"  Already OK: {stats['events_already_ok']}")
    print(f"  No match: {stats['events_no_match']}")
    print()

    # ===================================================================
    # PHASE 3: FIX calendar.json
    # ===================================================================
    print("=" * 60)
    print("PHASE 3: Fixing calendar.json")
    print("=" * 60)

    calendar_path = os.path.join(DATA_DIR, "calendar.json")
    if os.path.exists(calendar_path):
        shutil.copy2(calendar_path, f"{calendar_path}.bak.{BACKUP_SUFFIX}")

        with open(calendar_path) as f:
            calendar = json.load(f)

        if isinstance(calendar, list):
            for item in calendar:
                url = item.get("image_url", "")
                if is_google_url(url):
                    cat = item.get("category", "") or item.get("type", "")
                    item["image_url"] = get_category_fallback(cat)
                    stats["calendar_fixed"] += 1
                    stats["google_urls_killed"] += 1
        elif isinstance(calendar, dict):
            for key, items in calendar.items():
                if isinstance(items, list):
                    for item in items:
                        url = item.get("image_url", "")
                        if is_google_url(url):
                            cat = item.get("category", "") or item.get("type", "")
                            item["image_url"] = get_category_fallback(cat)
                            stats["calendar_fixed"] += 1
                            stats["google_urls_killed"] += 1

        with open(calendar_path, "w") as f:
            json.dump(calendar, f, indent=2, ensure_ascii=False)

        print(f"  Fixed: {stats['calendar_fixed']} Google URLs")
    else:
        print("  calendar.json not found (skipped)")
    print()

    # ===================================================================
    # PHASE 4: FIX partner-events.json
    # ===================================================================
    print("=" * 60)
    print("PHASE 4: Fixing partner-events.json")
    print("=" * 60)

    pe_path = os.path.join(DATA_DIR, "partner-events.json")
    if os.path.exists(pe_path):
        shutil.copy2(pe_path, f"{pe_path}.bak.{BACKUP_SUFFIX}")

        with open(pe_path) as f:
            pe_data = json.load(f)

        if isinstance(pe_data, list):
            for item in pe_data:
                for field in ["image_url", "partner_image"]:
                    url = item.get(field, "")
                    if is_google_url(url):
                        # Try to find this partner's image from main file
                        pname = item.get("partner_name", "").strip().lower()
                        main_p = partner_by_name.get(pname)
                        if main_p and not is_google_url(main_p.get("image_url", "")):
                            item[field] = main_p["image_url"]
                        else:
                            cat = item.get("category", "")
                            item[field] = get_category_fallback(cat)
                        stats["partner_events_fixed"] += 1
                        stats["google_urls_killed"] += 1

        with open(pe_path, "w") as f:
            json.dump(pe_data, f, indent=2, ensure_ascii=False)

        print(f"  Fixed: {stats['partner_events_fixed']} Google URLs")
    else:
        print("  partner-events.json not found (skipped)")
    print()

    # ===================================================================
    # FINAL VERIFICATION
    # ===================================================================
    print("=" * 60)
    print("FINAL VERIFICATION: Scanning ALL data files for Google URLs")
    print("=" * 60)

    remaining_google = 0
    all_json_files = glob.glob(os.path.join(DATA_DIR, "**", "*.json"), recursive=True)
    # Exclude backups
    all_json_files = [f for f in all_json_files if "_backup_" not in f and ".bak." not in f]

    for fp in all_json_files:
        with open(fp) as f:
            content = f.read()
        if "googleusercontent.com" in content or "googleapis.com/maps" in content:
            # Find which fields
            try:
                data = json.loads(content)
                if isinstance(data, dict):
                    for k, v in data.items():
                        if isinstance(v, str) and is_google_url(v):
                            remaining_google += 1
                            print(f"  REMAINING: {os.path.basename(fp)} → {k}: {v[:60]}")
                elif isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict):
                            for k, v in item.items():
                                if isinstance(v, str) and is_google_url(v):
                                    remaining_google += 1
                                    # Don't print every one
            except json.JSONDecodeError:
                pass

    print()
    print("=" * 60)
    print("BUG B FIX REPORT: Google Places URL Elimination")
    print("=" * 60)
    print(f"Google URLs killed: {stats['google_urls_killed']}")
    print(f"  Partners synced: {stats['partners_synced']}")
    print(f"  Partners fallback: {stats['partners_fallback']}")
    print(f"  Events synced: {stats['events_synced']}")
    print(f"  Events fallback: {stats['events_fallback']}")
    print(f"  Calendar fixed: {stats['calendar_fixed']}")
    print(f"  Partner-events fixed: {stats['partner_events_fixed']}")
    print()
    if remaining_google == 0:
        print("VERIFIED: ZERO Google Places URLs remain in data directory.")
    else:
        print(f"WARNING: {remaining_google} Google Places URLs still remain!")
    print()


if __name__ == "__main__":
    main()
