"""
Dump catalog data from local Mongo to /frontend/public/data/*.json
so the frontend can run in STATIC mode (no backend needed) for investor demos.

The output files mirror the GET API response shapes used by the app.

EVENTS-ELITE (DESIGN.md §13 D4, §15 T5): this script NEVER writes events, concerts,
seasons, partner-events or an events calendar again. Those used to be dumped unfiltered
from db.events / db.concerts (unsourced, past and fabricated rows) and the static copies
kept rendering them on old binaries. The only static events file is
public/data/events-feed.json, written by frontend/scripts/gen-events-static.mjs from the
verified /api/events/feed. calendar.json and seasons.json are written as [].

Usage:
    python3 scripts/dump_static.py
"""
import json
import os
from datetime import datetime
from pathlib import Path
from pymongo import MongoClient

BACKEND = Path(__file__).resolve().parent.parent
FRONTEND = BACKEND.parent / "frontend"
OUT = FRONTEND / "public" / "data"
OUT.mkdir(parents=True, exist_ok=True)

# Load .env
try:
    from dotenv import load_dotenv
    load_dotenv(BACKEND / ".env")
except ImportError:
    pass

url = os.environ.get("MONGO_URL_LOCAL") or os.environ.get("MONGO_URL", "mongodb://localhost:27017")
db_name = os.environ.get("DB_NAME", "amo_cartagena")
db = MongoClient(url)[db_name]

print(f"dumping from {db_name} → {OUT}\n")


def clean(docs):
    """Strip _id and convert datetimes to ISO strings."""
    out = []
    for d in docs:
        d.pop("_id", None)
        for k, v in list(d.items()):
            if isinstance(v, datetime):
                d[k] = v.isoformat()
            elif isinstance(v, dict):
                for kk, vv in list(v.items()):
                    if isinstance(vv, datetime):
                        v[kk] = vv.isoformat()
        out.append(d)
    return out


def write(rel_path: str, data):
    """Write data to OUT/<rel_path>.json"""
    p = OUT / rel_path
    p.parent.mkdir(parents=True, exist_ok=True)
    final = p.with_suffix(".json")
    final.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str))
    size = final.stat().st_size
    n = len(data) if isinstance(data, list) else 1
    print(f"  {rel_path:32s}  {n:>4} rows  ({size:>7} bytes)")


# ── Catalog collections ──────────────────────────────────────────
partners = clean(list(db.partners.find({}).sort("order", 1)))
write("partners", partners)

# events / events/featured / events/dates/available / concerts(/dates|/genres): never
# dumped again (EVENTS-ELITE). Old binaries read those paths through Vercel rewrites to
# the live, verified /api/events and /api/concerts (frontend/vercel.json, §15 T5).

venues = clean(list(db.venues.find({})))
write("venues", venues)

sponsors = clean(list(db.sponsors.find({"is_active": {"$ne": False}})))
write("sponsors", sponsors)

transport = clean(list(db.transport.find({})))
write("transport", transport)

emergency = clean(list(db.emergency_contacts.find({})))
write("emergency-contacts", emergency)

# Seasons grouped legacy db.events rows ("Music Week" and the like): scrubbed (§15 T5).
write("seasons", [])

# Promotions today — any partner_promotions active for current date
today = datetime.now().strftime("%Y-%m-%d")
promos = clean(list(db.partner_promotions.find({})))
active_promos = [
    p for p in promos
    if (not p.get("start_date") or p["start_date"] <= today)
    and (not p.get("end_date") or p["end_date"] >= today)
]
write("promotions/today", active_promos or promos[:10])

rewards = clean(list(db.rewards_offers.find({})))
write("rewards/offers", rewards)

# The port-tax product is retired (2026-09-26): nothing under port-tax/ is ever written again.
# iOS build 14 renders the legacy 31.500 card whenever /data/port-tax/config.json resolves,
# so recreating that file (even as {}) would resurrect the retired product on old devices.

# Static config / constants
write("payments/config", {"public_key": "", "mock": True, "wompi_configured": False})
write("partner-categories", [
    {"key": "restaurant", "label": "Restaurantes"},
    {"key": "hotel", "label": "Hoteles"},
    {"key": "activity", "label": "Actividades"},
    {"key": "wellness", "label": "Wellness & Spa"},
    {"key": "bar", "label": "Bares & Clubs"},
    {"key": "beach_club", "label": "Beach Clubs"},
    {"key": "realestate", "label": "Inmobiliario"},
])
write("event-types", [
    {"key": "concert", "label": "Concierto"},
    {"key": "party", "label": "Fiesta"},
    {"key": "festival", "label": "Festival"},
    {"key": "wellness", "label": "Wellness"},
    {"key": "cultural", "label": "Cultural"},
])

# City pass plans (read from collection if exists, else static demo)
try:
    cp_plans = clean(list(db.city_pass_plans.find({})))
except Exception:
    cp_plans = []
if not cp_plans:
    cp_plans = [
        {"plan_id": "day_pass", "name": "Day Pass", "price_cop": 75000, "duration_days": 1,
         "perks": ["Transporte ilimitado", "Descuentos en restaurantes", "Acceso prioritario"]},
        {"plan_id": "weekend", "name": "Weekend Pass", "price_cop": 180000, "duration_days": 3,
         "perks": ["Day Pass beneficios", "Acceso a beach clubs", "Yacht discount"]},
        {"plan_id": "week", "name": "Week Pass", "price_cop": 380000, "duration_days": 7,
         "perks": ["Weekend Pass beneficios", "Spa session gratis", "Cena de bienvenida"]},
    ]
write("city-pass/plans", cp_plans)

# ── Partner-events / events calendar: NOT dumped (EVENTS-ELITE §13 D4) ───
# This block used to SYNTHESIZE partner-events by pairing db.events rows with a
# "plausible" partner (a guessed venue), and to write an events calendar from the
# unfiltered db.events. Both presented unverified, invented pairings as real events.
# Partner events are served live by /api/partner-events (moderation_status approved
# only); city events only by the verified feed. The calendar file stays [].
write("calendar", [])
write("partner-events", [])

# User-scoped endpoints — empty for static demo
for empty_path in [
    "my-week", "favorites", "favorites/ids", "notifications",
    "city-pass/mine", "experience-bookings",
    "reservations/my", "rewards/me",
]:
    write(empty_path, [])

# Auth/business endpoints — null so the UI falls back to "logged-out" state cleanly
for null_path in ["auth/me", "profile", "business/me", "business/membership",
                  "business/onboarding-status", "business/stats", "business/events",
                  "business/reservations"]:
    write(null_path, None)

# Experiences featured (uses partners with category=activity)
activities = [p for p in partners if p.get("category") in ("activity", "yacht")][:8]
write("experiences/featured", activities)

# Guard: the retired port-tax static files must never come back (see comment above).
assert not (OUT / "port-tax").exists(), f"retired port-tax static files present under {OUT / 'port-tax'} — delete them"

# Guard (EVENTS-ELITE §15 T5): legacy event/concert static files must never come back.
# Vercel serves a file before any rewrite, so a stale copy would shadow the live, verified
# /api/events and /api/concerts that old binaries read through /data/*.json.
_legacy_event_files = [OUT / "events.json", OUT / "concerts.json"]
_legacy_event_files += [p for d in ("events", "concerts") if (OUT / d).is_dir() for p in (OUT / d).rglob("*.json")]
assert not any(p.exists() for p in _legacy_event_files), (
    f"legacy event static files present ({[str(p) for p in _legacy_event_files if p.exists()][:5]}) — delete them")

print(f"\n✅ dumped to {OUT}")
print(f"   total files: {sum(1 for _ in OUT.rglob('*.json'))}")
