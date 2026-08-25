#!/usr/bin/env python3
"""Remove permanently-closed venues from AMO — static data + MongoDB.

For each target venue:
  static (frontend/public/data/):
    - partners.json / partners/<pid>.json         -> entry + file removed
    - catalog.json, venues.json                   -> exact-name entries removed
    - concerts.json (+ concerts/<id>.json)        -> concerts AT the venue removed
    - calendar.json                               -> calendar entries AT the venue removed
    - promotions/today.json                       -> promos mentioning the venue removed
    - knowledge.json                              -> venue stripped from `ranked` lists
    - events.json (+ events/<slug>.json)          -> events AT the venue removed;
                                                     passing mentions stripped from descriptions
  Mongo (amo_cartagena):
    - partners     -> is_public=False, status="suspended", closed_permanently=True (soft, reversible)
    - venues       -> doc backed up into `venues_removed` then deleted
    - events       -> AT venue: moderation_status="rejected" + hidden_reason; mentions stripped
    - partner_events (by partner_id)              -> unpublished

Usage:
  MONGO_URL=... python3 remove_closed_venues.py [--dry-run]
Edit TARGETS below (or pass a JSON file as argv[1]) for future closures.
"""
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

TARGETS = [
    {"partner_id": "ptr_W113", "names": ["Café del Mar", "Cafe del Mar"],
     "reason": "Permanently closed (owner-confirmed, Aug 2026)"},
]

ROOT = Path(__file__).resolve().parent.parent.parent
DATA = ROOT / "frontend" / "public" / "data"
DRY = "--dry-run" in sys.argv
if len(sys.argv) > 1 and sys.argv[1].endswith(".json"):
    TARGETS = json.load(open(sys.argv[1]))

NOW = datetime.now(timezone.utc).isoformat()


def name_rx(names):
    # \b guards: a venue called "Norma" must not match inside "normal".
    return re.compile("|".join(rf"\b{re.escape(n)}\b" for n in names), re.IGNORECASE)


def is_exact(value, names):
    v = (value or "").strip().lower()
    return any(v == n.lower() for n in names)


def strip_mention(text, rx):
    """Remove a passing mention from prose: 'en X, Y y Z' -> 'en Y y Z'."""
    if not text:
        return text
    out = rx.sub("", text)
    out = re.sub(r"\s*,\s*,", ", ", out)          # ", ," left by removal
    out = re.sub(r"(\ben|\bat)\s*,\s*", r"\1 ", out, flags=re.IGNORECASE)
    out = re.sub(r"\s{2,}", " ", out)
    out = re.sub(r"\s+([,.])", r"\1", out)
    return out.strip()


def load(p):
    return json.load(open(p))


def save(p, obj):
    if DRY:
        return
    json.dump(obj, open(p, "w"), ensure_ascii=False, separators=(",", ":"))


def log(msg):
    print(("DRY  " if DRY else "DONE ") + msg)


def clean_static(target):
    names, rx = target["names"], name_rx(target["names"])
    pid = target.get("partner_id")
    # listing_only: remove just the partner/catalog listing (e.g. a duplicate) —
    # the entity itself still exists, so leave knowledge/events/calendar untouched.
    listing_only = bool(target.get("listing_only"))

    p = DATA / "partners.json"
    partners = load(p)
    kept = [x for x in partners if x.get("partner_id") != pid and not is_exact(x.get("name"), names)]
    if len(kept) != len(partners):
        save(p, kept)
        log(f"partners.json: removed {len(partners)-len(kept)}")
    slug = DATA / "partners" / f"{pid}.json"
    if pid and slug.exists():
        if not DRY:
            slug.unlink()
        log(f"deleted {slug.name}")

    for fname in ("catalog.json", "venues.json"):
        fp = DATA / fname
        if not fp.exists():
            continue
        items = load(fp)
        kept = [x for x in items if not is_exact(x.get("name"), names)]
        if len(kept) != len(items):
            save(fp, kept)
            log(f"{fname}: removed {len(items)-len(kept)}")

    if listing_only:
        return

    fp = DATA / "concerts.json"
    if fp.exists():
        items = load(fp)
        gone = [x for x in items if is_exact(x.get("venue_name") or x.get("venue"), names)]
        if gone:
            save(fp, [x for x in items if x not in gone])
            log(f"concerts.json: removed {len(gone)}")
            for c in gone:
                cf = DATA / "concerts" / f"{c.get('concert_id') or c.get('id')}.json"
                if cf.exists() and not DRY:
                    cf.unlink()

    fp = DATA / "calendar.json"
    if fp.exists():
        cal = load(fp)
        removed = 0
        for date in list(cal.keys()):
            kept = [x for x in cal[date] if not is_exact(x.get("venue"), names)]
            removed += len(cal[date]) - len(kept)
            if kept:
                cal[date] = kept
            else:
                del cal[date]
        if removed:
            save(fp, cal)
            log(f"calendar.json: removed {removed}")

    fp = DATA / "promotions" / "today.json"
    if fp.exists():
        promos = load(fp)
        kept = [x for x in promos if not rx.search(json.dumps(x, ensure_ascii=False))]
        if len(kept) != len(promos):
            save(fp, kept)
            log(f"promotions/today.json: removed {len(promos)-len(kept)}")

    fp = DATA / "knowledge.json"
    if fp.exists():
        know = load(fp)
        n = 0
        for entry in know:
            ranked = entry.get("ranked")
            if isinstance(ranked, list):
                kept = [v for v in ranked if not is_exact(v, names)]
                if len(kept) != len(ranked):
                    entry["ranked"] = kept
                    n += 1
        if n:
            save(fp, know)
            log(f"knowledge.json: stripped from {n} ranked lists")

    fp = DATA / "events.json"
    events = load(fp)
    kept, dropped = [], []
    for e in events:
        at_venue = is_exact(e.get("venue_name"), names) or rx.search(e.get("title") or e.get("name_es") or "")
        (dropped if at_venue else kept).append(e)
    for e in kept:  # passing mentions in surviving events
        for f in ("description", "description_es", "description_en"):
            if e.get(f) and rx.search(e[f]):
                e[f] = strip_mention(e[f], rx)
    if dropped or kept:
        save(fp, kept)
        log(f"events.json: removed {len(dropped)} events, mentions stripped")
        for e in dropped:
            slug = e.get("slug") or e.get("id") or e.get("event_id") or ""
            ef = DATA / "events" / f"{slug}.json"
            if slug and ef.exists() and not DRY:
                ef.unlink()


def clean_mongo(db, target):
    names, rx_pat = target["names"], "|".join(rf"\b{re.escape(n)}\b" for n in target["names"])
    rx = name_rx(names)
    pid = target.get("partner_id")
    reason = target.get("reason", "permanently closed")

    marks = {"is_public": False, "status": "suspended", "closed_permanently": True,
             "closed_reason": reason, "closed_at": NOW}
    q = {"partner_id": pid} if target.get("listing_only") else {"$or": [{"partner_id": pid}, {"name": {"$in": names}}]}
    if not DRY:
        r = db.partners.update_many(q, {"$set": marks})
        log(f"mongo partners: hidden {r.modified_count}")
    else:
        log(f"mongo partners would hide {db.partners.count_documents(q)}")
    if target.get("listing_only"):
        return

    for v in db.venues.find({"name": {"$in": names}}):
        if not DRY:
            v.pop("_id", None)
            db.venues_removed.insert_one({**v, "removed_at": NOW, "removed_reason": reason})
            db.venues.delete_one({"venue_id": v["venue_id"]})
        log(f"mongo venues: removed {v.get('venue_id')} ({v.get('name')})")

    q = {"$or": [{"venue_name": {"$in": names}},
                 {"title": {"$regex": rx_pat, "$options": "i"}}]}
    if not DRY:
        r = db.events.update_many(q, {"$set": {"moderation_status": "rejected",
                                               "is_published": False,
                                               "hidden_reason": f"venue {reason}", "hidden_at": NOW}})
        log(f"mongo events at venue: hidden {r.modified_count}")
    for e in db.events.find({"moderation_status": {"$ne": "rejected"},
                             "$or": [{"description_es": {"$regex": rx_pat, "$options": "i"}},
                                     {"description_en": {"$regex": rx_pat, "$options": "i"}},
                                     {"description": {"$regex": rx_pat, "$options": "i"}}]}):
        upd = {f: strip_mention(e[f], rx) for f in ("description", "description_es", "description_en")
               if e.get(f) and rx.search(e[f])}
        if upd and not DRY:
            db.events.update_one({"_id": e["_id"]}, {"$set": upd})
        log(f"mongo events: stripped mention in {e.get('event_id') or e.get('slug')}")

    if pid and not DRY:
        r = db.partner_events.update_many({"partner_id": pid},
                                          {"$set": {"is_published": False,
                                                    "hidden_reason": f"venue {reason}", "hidden_at": NOW}})
        if r.modified_count:
            log(f"mongo partner_events: unpublished {r.modified_count}")


def main():
    for t in TARGETS:
        print(f"── {t['names'][0]} ({t.get('partner_id')}) ──")
        clean_static(t)
    url = os.environ.get("MONGO_URL", "")
    if not url:
        print("MONGO_URL not set — static-only run (set it to also clean Mongo)")
        return
    import pymongo
    db = pymongo.MongoClient(url, serverSelectionTimeoutMS=10000)[os.environ.get("DB_NAME", "amo_cartagena")]
    for t in TARGETS:
        clean_mongo(db, t)


if __name__ == "__main__":
    main()
